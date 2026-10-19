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

    /**
     * Gap B15 (7 Oct 2026): qualifications are recorded, never uploaded (owner
     * decision), so the document upload endpoint is gone. This replaces two tests
     * that proved vetting documents and unknown types were refused: now nothing
     * is accepted, whatever its type, and nothing is stored.
     */
    public function test_credential_documents_can_no_longer_be_uploaded(): void
    {
        $user = $this->authenticatedUser();
        Storage::fake('local');

        foreach (['first_aid', 'dbs_enhanced', 'custom_community_badge'] as $type) {
            $status = $this->post('/api/v2/volunteering/credentials', [
                'credential_type' => $type,
                'file' => UploadedFile::fake()->create('certificate.pdf', 1, 'application/pdf'),
            ], $this->withTenantHeader())->getStatusCode();

            $this->assertContains($status, [404, 405], "upload of {$type} answered {$status}");
        }

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

    /**
     * The signed-in lookup this used was removed as dead code on 7 Oct 2026; the
     * public check is the remaining way to verify a code, so tenancy is pinned there.
     */
    public function test_verify_certificate_is_tenant_scoped(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'first_name' => 'Tess',
            'last_name' => 'Tenant',
            'name' => 'Tess Tenant',
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

        $this->apiPost('/v2/volunteering/certificates/check', ['code' => 'TENANT2CERT', 'name' => 'Tess Tenant'])
            ->assertOk()
            ->assertJsonPath('data.valid', true);

        $otherTenantUser = User::factory()->forTenant(999)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($otherTenantUser, ['*']);
        $this->withTenant(999);
        $this->apiPost('/v2/volunteering/certificates/check', ['code' => 'TENANT2CERT', 'name' => 'Tess Tenant'])
            ->assertOk()
            ->assertJsonPath('data.valid', false);
    }

    /** A holder with one certificate on record; returns [user, code]. */
    private function certificateOnRecord(array $organisations, array $overrides = []): array
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'first_name' => 'Tess',
            'last_name' => 'Tenant',
            'name' => 'Tess Tenant',
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($user, ['*']);
        \App\Core\TenantContext::setById($this->testTenantId);

        $code = strtoupper(substr(md5((string) $user->id), 0, 16));
        DB::table('vol_certificates')->insert(array_merge([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'verification_code' => $code,
            'total_hours' => 12.5,
            'date_range_start' => '2026-01-03',
            'date_range_end' => '2026-09-28',
            'organizations' => json_encode($organisations),
            'generated_at' => '2026-10-19 09:30:00',
        ], $overrides));

        return [$user, $code];
    }

    /**
     * The printable certificate (redesigned 19 Oct 2026) names the community that
     * issued it, never the platform; shows the hours and period in words; carries
     * the code, the public check address and a QR code of it; escapes everything
     * it prints; and makes no outside request, so the saved file renders offline.
     */
    public function test_printable_certificate_carries_the_community_and_the_check_details(): void
    {
        [, $code] = $this->certificateOnRecord([
            ['name' => 'Riverside Community Garden', 'hours' => 4.5],
            ['name' => 'Tom <b>&</b> Jerry\'s Soup Kitchen', 'hours' => 8],
        ]);

        $response = $this->apiGet('/v2/volunteering/certificates/' . $code . '/html');
        $response->assertOk();
        $this->assertStringStartsWith('text/html', (string) $response->headers->get('Content-Type'));
        $html = $response->getContent();

        $this->assertStringContainsString('Tess Tenant', $html);
        $this->assertStringContainsString('Hour Timebank', $html, 'the issuing community is named');
        $this->assertStringNotContainsString('Project NEXUS Community Platform', $html, 'the platform is not the issuer');
        $this->assertStringContainsString('>12.5<small>hours</small>', $html);
        $this->assertStringContainsString('between 3 January 2026 and 28 September 2026', $html);
        $this->assertStringContainsString('Issued on 19 October 2026', $html);
        $this->assertStringContainsString('<code>' . $code . '</code>', $html);
        $this->assertStringContainsString(\App\Services\VolunteerCertificateService::publicCheckUrl(), $html);
        $this->assertStringContainsString('<svg', $html, 'a QR code is drawn inline');
        $this->assertStringContainsString('size: A4 landscape', $html);

        // Escaping: the organisation's markup is printed as text, not run.
        $this->assertStringContainsString('Tom &lt;b&gt;&amp;&lt;/b&gt; Jerry&#039;s Soup Kitchen', $html);
        $this->assertStringNotContainsString('<b>&</b>', $html);
        // Largest contribution first.
        $this->assertLessThan(strpos($html, 'Riverside Community Garden'), strpos($html, 'Soup Kitchen'));

        // Self-contained: no scripts and nothing fetched from elsewhere.
        $this->assertStringNotContainsString('<script', $html);
        $this->assertStringNotContainsString('<link', $html);
        $this->assertDoesNotMatchRegularExpression('/\bsrc="https?:/', $html);

        $this->assertNotNull(DB::table('vol_certificates')->where('verification_code', $code)->value('downloaded_at'), 'printing marks the certificate downloaded');
    }

    public function test_printable_certificate_lists_six_organisations_and_summarises_the_rest(): void
    {
        $organisations = [];
        for ($i = 1; $i <= 8; $i++) {
            $organisations[] = ['name' => 'Organisation ' . $i, 'hours' => $i];
        }
        [, $code] = $this->certificateOnRecord($organisations, ['total_hours' => 36]);

        $html = $this->apiGet('/v2/volunteering/certificates/' . $code . '/html')->assertOk()->getContent();

        foreach ([8, 7, 6, 5, 4, 3] as $n) {
            $this->assertStringContainsString('<td>Organisation ' . $n . '</td>', $html);
        }
        $this->assertStringNotContainsString('<td>Organisation 2</td>', $html);
        $this->assertStringNotContainsString('<td>Organisation 1</td>', $html);
        $this->assertStringContainsString('and 2 more, listed when this certificate is checked online', $html);
        $this->assertStringContainsString('>36<small>hours</small>', $html);
    }

    public function test_single_day_certificate_names_the_day_and_one_hour_is_singular(): void
    {
        [, $code] = $this->certificateOnRecord(
            [['name' => 'Riverside Community Garden', 'hours' => 1]],
            ['total_hours' => 1, 'date_range_start' => '2026-08-20', 'date_range_end' => '2026-08-20']
        );

        $html = $this->apiGet('/v2/volunteering/certificates/' . $code . '/html')->assertOk()->getContent();

        $this->assertStringContainsString('>1<small>hour</small>', $html);
        $this->assertStringContainsString('on 20 August 2026', $html);
        $this->assertStringNotContainsString('between 20 August 2026', $html);
    }

    public function test_withdrawn_certificate_is_not_printed_for_its_holder_but_the_admin_copy_is_watermarked(): void
    {
        [, $code] = $this->certificateOnRecord(
            [['name' => 'Riverside Community Garden', 'hours' => 12.5]],
            ['revoked_at' => '2026-10-01 12:00:00', 'revoke_reason' => 'Logged against the wrong member']
        );

        $this->apiGet('/v2/volunteering/certificates/' . $code . '/html')->assertNotFound();
        $this->assertNull(\App\Services\VolunteerCertificateService::generateHtml($code));

        $adminCopy = \App\Services\VolunteerCertificateService::generateHtml($code, true);
        $this->assertNotNull($adminCopy);
        $this->assertStringContainsString('class="withdrawn"', $adminCopy);
        $this->assertStringContainsString('The community withdrew this certificate on 1 October 2026.', $adminCopy);
        $this->assertStringNotContainsString('wrong member', $adminCopy, 'the reason stays between the admins');
    }

    public function test_public_check_ignores_spaces_typed_into_the_code(): void
    {
        [, $code] = $this->certificateOnRecord([['name' => 'Riverside Community Garden', 'hours' => 12.5]]);
        $spaced = implode(' ', str_split($code, 4));

        $this->apiPost('/v2/volunteering/certificates/check', ['code' => strtolower($spaced), 'name' => 'tess tenant'])
            ->assertOk()
            ->assertJsonPath('data.valid', true);
    }
}
