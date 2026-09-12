<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use Tests\Laravel\TestCase;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use App\Models\User;

/**
 * Feature tests for VolunteerCertificateController — certificates & credentials.
 */
class VolunteerCertificateControllerTest extends TestCase
{
    use DatabaseTransactions;

    private function authenticatedUser(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    public function test_my_certificates_requires_auth(): void
    {
        $response = $this->apiGet('/v2/volunteering/certificates');

        $response->assertStatus(401);
    }

    public function test_my_credentials_requires_auth(): void
    {
        $response = $this->apiGet('/v2/volunteering/credentials');

        $response->assertStatus(401);
    }

    public function test_my_certificates_authenticated_smoke(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/volunteering/certificates');

        $response->assertOk()
            ->assertJsonStructure(['data', 'meta']);
    }

    public function test_my_credentials_authenticated_smoke(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/volunteering/credentials');

        $response->assertOk()
            ->assertJsonStructure(['data' => ['credentials'], 'meta']);
    }

    public function test_generic_credential_upload_rejects_vetting_types_before_storing_a_file(): void
    {
        $user = $this->authenticatedUser();
        Storage::fake('local');

        foreach (['dbs_enhanced', 'garda_vetting', 'pvg_scotland', 'access_ni', 'police_check'] as $type) {
            $response = $this->post('/api/v2/volunteering/credentials', [
                'credential_type' => $type,
                'file' => UploadedFile::fake()->create('certificate.pdf', 1, 'application/pdf'),
            ], $this->withTenantHeader());

            $response->assertStatus(422)
                ->assertJsonPath('errors.0.code', 'VETTING_EVIDENCE_PROHIBITED');
        }

        $this->assertDatabaseMissing('vol_credentials', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
        ]);
        $this->assertSame([], Storage::disk('local')->allFiles());
    }

    public function test_unknown_credential_upload_is_unsupported_without_being_labelled_as_vetting(): void
    {
        $user = $this->authenticatedUser();
        Storage::fake('local');

        $response = $this->post('/api/v2/volunteering/credentials', [
            'credential_type' => 'custom_community_badge',
            'file' => UploadedFile::fake()->create('badge.pdf', 1, 'application/pdf'),
        ], $this->withTenantHeader());

        $response->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'UNSUPPORTED_CREDENTIAL_TYPE');
        $this->assertDatabaseMissing('vol_credentials', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
        ]);
        $this->assertSame([], Storage::disk('local')->allFiles());
    }

    public function test_credential_listing_distinguishes_explicit_vetting_aliases_from_unknown_types(): void
    {
        $user = $this->authenticatedUser();
        $now = now();
        $legacyId = (int) DB::table('vol_credentials')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'credential_type' => ' DBS_ENHANCED ',
            'file_url' => 'private:volunteer-credentials/' . $this->testTenantId . '/legacy.pdf',
            'file_name' => 'legacy.pdf',
            'status' => 'verified',
            'expires_at' => $now->copy()->addYear()->toDateString(),
            'notes' => null,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        $unknownId = (int) DB::table('vol_credentials')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'credential_type' => 'custom_community_badge',
            'file_url' => 'private:volunteer-credentials/' . $this->testTenantId . '/custom.pdf',
            'file_name' => 'custom.pdf',
            'status' => 'verified',
            'expires_at' => $now->copy()->addYear()->toDateString(),
            'notes' => null,
            'created_at' => $now->copy()->subSecond(),
            'updated_at' => $now,
        ]);

        $response = $this->apiGet('/v2/volunteering/credentials')->assertOk();
        $credentials = collect($response->json('data.credentials'));
        $legacy = $credentials->firstWhere('id', $legacyId);
        $unknown = $credentials->firstWhere('id', $unknownId);

        $this->assertIsArray($legacy);
        $this->assertTrue($legacy['legacy_vetting_evidence']);
        $this->assertFalse($legacy['manual_review_required']);
        $this->assertNull($legacy['file_url']);
        $this->assertNull($legacy['file_name']);
        $this->assertNull($legacy['expires_at']);
        $this->assertIsArray($unknown);
        $this->assertFalse($unknown['legacy_vetting_evidence']);
        $this->assertTrue($unknown['manual_review_required']);
        $this->assertNull($unknown['file_url']);
        $this->assertNull($unknown['file_name']);
        $this->assertNull($unknown['expires_at']);
    }

    public function test_credential_delete_removes_the_private_file_before_removing_the_row(): void
    {
        $user = $this->authenticatedUser();
        Storage::fake('local');
        $path = 'volunteer-credentials/' . $this->testTenantId . '/synthetic-first-aid.pdf';
        Storage::disk('local')->put($path, 'synthetic');
        $credentialId = (int) DB::table('vol_credentials')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'credential_type' => 'first_aid',
            'file_url' => 'private:' . $path,
            'file_name' => 'synthetic-first-aid.pdf',
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->apiDelete('/v2/volunteering/credentials/' . $credentialId)
            ->assertStatus(200)
            ->assertJsonPath('data.success', true);

        Storage::disk('local')->assertMissing($path);
        $this->assertDatabaseMissing('vol_credentials', ['id' => $credentialId]);
    }

    public function test_member_can_explicitly_delete_an_unknown_custom_credential(): void
    {
        $user = $this->authenticatedUser();
        Storage::fake('local');
        $path = 'volunteer-credentials/' . $this->testTenantId . '/custom-community-badge.pdf';
        Storage::disk('local')->put($path, 'synthetic');
        $credentialId = (int) DB::table('vol_credentials')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'credential_type' => 'custom_community_badge',
            'file_url' => 'private:' . $path,
            'file_name' => 'custom-community-badge.pdf',
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->apiDelete('/v2/volunteering/credentials/' . $credentialId)
            ->assertStatus(200)
            ->assertJsonPath('data.success', true);

        Storage::disk('local')->assertMissing($path);
        $this->assertDatabaseMissing('vol_credentials', ['id' => $credentialId]);
    }

    public function test_credential_delete_preserves_a_redacted_cleanup_tombstone_when_path_is_refused(): void
    {
        $user = $this->authenticatedUser();
        Storage::fake('local');
        $credentialId = (int) DB::table('vol_credentials')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'credential_type' => 'dbs_enhanced',
            'file_url' => 'private:volunteer-credentials/999/wrong-tenant.pdf',
            'file_name' => 'must-be-redacted.pdf',
            'status' => 'verified',
            'verified_by' => $user->id,
            'verified_at' => now(),
            'expires_at' => now()->addYear()->toDateString(),
            'notes' => 'must be redacted',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->apiDelete('/v2/volunteering/credentials/' . $credentialId)
            ->assertStatus(503)
            ->assertJsonPath('errors.0.code', 'CREDENTIAL_DELETE_FAILED');

        $this->assertDatabaseHas('vol_credentials', [
            'id' => $credentialId,
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'file_url' => 'private:volunteer-credentials/999/wrong-tenant.pdf',
            'file_name' => null,
            'status' => 'rejected',
            'verified_by' => null,
            'notes' => \App\Services\LegacyVettingEvidenceManager::GDPR_CLEANUP_PENDING_MARKER,
        ]);
    }

    public function test_verify_certificate_requires_authentication(): void
    {
        $response = $this->apiGet('/v2/volunteering/certificates/verify/FAKE-CODE');

        $response->assertUnauthorized()
            ->assertJsonStructure(['errors' => [['code', 'message']]]);
    }

    /**
     * fix(volunteering): certificate verification codes are now 16-char uppercase
     * alphanumeric. The lookup column collates case-insensitively, so uppercasing
     * a mixed-case random adds no entropy — the length is what matters.
     */
    public function test_generated_certificate_code_is_16_char_uppercase_alphanumeric(): void
    {
        \App\Core\TenantContext::setById($this->testTenantId);

        $user = User::factory()->forTenant($this->testTenantId)->create();

        DB::table('vol_logs')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'organization_id' => null,
            'date_logged' => now()->toDateString(),
            'hours' => 5.0,
            'status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Creating the fixture user above re-resolves TenantContext to the
        // default tenant; re-assert it so generate() scopes vol_logs to the
        // tenant the approved hours were seeded under.
        \App\Core\TenantContext::setById($this->testTenantId);

        $cert = \App\Services\VolunteerCertificateService::generate($user->id);

        $this->assertNotNull($cert, 'certificate should generate for approved hours');
        $this->assertArrayHasKey('verification_code', $cert);
        $this->assertMatchesRegularExpression('/^[A-Z0-9]{16}$/', (string) $cert['verification_code']);
    }

    public function test_certificate_response_loss_retry_returns_the_original_certificate(): void
    {
        $user = $this->authenticatedUser();
        DB::table('vol_logs')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'organization_id' => null,
            'date_logged' => now()->toDateString(),
            'hours' => 4.0,
            'status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $headers = ['Idempotency-Key' => 'mobile-certificate-retry-1'];
        $first = $this->apiPost('/v2/volunteering/certificates', [], $headers)->assertCreated();
        $replay = $this->apiPost('/v2/volunteering/certificates', [], $headers)->assertCreated();

        $this->assertSame($first->json('data.id'), $replay->json('data.id'));
        $this->assertSame(1, DB::table('vol_certificates')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)
            ->where('creation_idempotency_key_hash', hash('sha256', 'mobile-certificate-retry-1'))
            ->count());
    }

    public function test_verify_certificate_is_tenant_scoped(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($user, ['*']);

        DB::table('vol_certificates')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'verification_code' => 'TENANT2CERT',
            'total_hours' => 12.5,
            'date_range_start' => '2026-01-01',
            'date_range_end' => '2026-02-01',
            'organizations' => json_encode([['name' => 'Green Streets', 'hours' => 12.5]]),
            'generated_at' => now(),
        ]);

        $this->apiGet('/v2/volunteering/certificates/verify/TENANT2CERT')
            ->assertOk()
            ->assertJsonPath('data.verification_code', 'TENANT2CERT');

        $otherTenantUser = User::factory()->forTenant(999)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($otherTenantUser, ['*']);
        $this->withTenant(999);
        $this->apiGet('/v2/volunteering/certificates/verify/TENANT2CERT')
            ->assertNotFound();
    }
}
