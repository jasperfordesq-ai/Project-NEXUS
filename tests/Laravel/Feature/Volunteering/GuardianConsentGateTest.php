<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Volunteering;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\VolunteeringConfigurationService;
use App\Services\VolunteerService;
use App\Services\ShiftWaitlistService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Guardian-consent enforcement (2026-06-12): members under 18 (by
 * date_of_birth) must hold an ACTIVE guardian consent before applying to a
 * volunteering opportunity, signing up for a shift, or joining a waitlist.
 * Adults are unaffected. When the gate is enabled, an absent or invalid date
 * of birth must fail closed until the member supplies a valid value.
 */
class GuardianConsentGateTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
        VolunteeringConfigurationService::set(
            VolunteeringConfigurationService::CONFIG_GUARDIAN_CONSENT_REQUIRED,
            true
        );
    }

    private function makeOpportunityWithShift(): array
    {
        $orgOwner = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);

        $orgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $orgOwner->id,
            'name' => 'Consent Gate Test Org',
            'status' => 'approved',
            'created_at' => now(),
        ]);

        $oppId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $orgId,
            'created_by' => $orgOwner->id,
            'title' => 'Consent Gate Test Opportunity',
            'description' => 'x',
            'status' => 'active',
            'is_active' => 1,
            'created_at' => now(),
        ]);
        $shiftId = (int) DB::table('vol_shifts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $oppId,
            'start_time' => now()->addDays(2)->format('Y-m-d H:i:s'),
            'end_time' => now()->addDays(2)->addHours(2)->format('Y-m-d H:i:s'),
            'capacity' => 5,
        ]);

        return [$oppId, $shiftId];
    }

    private function actingAsUserWithDob(?string $dob): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);
        if ($dob !== null) {
            DB::table('users')->where('id', $user->id)->update(['date_of_birth' => $dob]);
        }
        Sanctum::actingAs($user->fresh());

        return $user;
    }

    public function test_minor_without_consent_is_blocked_from_applying(): void
    {
        [$oppId] = $this->makeOpportunityWithShift();
        $this->actingAsUserWithDob(now()->subYears(15)->toDateString());

        $response = $this->apiPost("/v2/volunteering/opportunities/{$oppId}/apply", ['message' => 'hi']);

        $response->assertStatus(403);
        $this->assertSame('GUARDIAN_CONSENT_REQUIRED', $response->json('errors.0.code'));
    }

    public function test_minor_without_consent_is_blocked_from_shift_signup_and_waitlist(): void
    {
        [, $shiftId] = $this->makeOpportunityWithShift();
        $this->actingAsUserWithDob(now()->subYears(16)->toDateString());

        $signup = $this->apiPost("/v2/volunteering/shifts/{$shiftId}/signup");
        $signup->assertStatus(403);
        $this->assertSame('GUARDIAN_CONSENT_REQUIRED', $signup->json('errors.0.code'));

        $waitlist = $this->apiPost("/v2/volunteering/shifts/{$shiftId}/waitlist");
        $waitlist->assertStatus(403);
        $this->assertSame('GUARDIAN_CONSENT_REQUIRED', $waitlist->json('errors.0.code'));
    }

    public function test_minor_with_active_consent_can_apply(): void
    {
        [$oppId] = $this->makeOpportunityWithShift();
        $minor = $this->actingAsUserWithDob(now()->subYears(15)->toDateString());

        DB::table('vol_guardian_consents')->insert([
            'tenant_id' => $this->testTenantId,
            'minor_user_id' => $minor->id,
            'guardian_name' => 'Test Guardian',
            'guardian_email' => 'guardian@example.com',
            'relationship' => 'parent',
            'consent_token' => bin2hex(random_bytes(32)),
            'status' => 'active',
            'expires_at' => now()->addDays(200)->format('Y-m-d H:i:s'),
            'created_at' => now(),
        ]);

        $response = $this->apiPost("/v2/volunteering/opportunities/{$oppId}/apply", ['message' => 'hi']);

        $response->assertStatus(201);
    }

    public function test_adult_is_not_gated(): void
    {
        [$oppId] = $this->makeOpportunityWithShift();
        $this->actingAsUserWithDob(now()->subYears(30)->toDateString());

        $response = $this->apiPost("/v2/volunteering/opportunities/{$oppId}/apply", ['message' => 'hi']);

        $response->assertStatus(201);
    }

    public function test_user_without_dob_is_blocked_until_age_can_be_determined(): void
    {
        [$oppId] = $this->makeOpportunityWithShift();
        $user = $this->actingAsUserWithDob(null);

        $response = $this->apiPost("/v2/volunteering/opportunities/{$oppId}/apply", ['message' => 'hi']);

        $response->assertStatus(422);
        $this->assertSame('VALIDATION_REQUIRED_FIELD', $response->json('errors.0.code'));
        $this->assertSame('date_of_birth', $response->json('errors.0.field'));
        $this->assertDatabaseMissing('vol_applications', [
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $oppId,
            'user_id' => $user->id,
        ]);
    }

    public function test_user_with_future_dob_is_blocked_until_age_can_be_determined(): void
    {
        [$oppId] = $this->makeOpportunityWithShift();
        $this->actingAsUserWithDob(now()->addYear()->toDateString());

        $response = $this->apiPost("/v2/volunteering/opportunities/{$oppId}/apply", ['message' => 'hi']);

        $response->assertStatus(422);
        $this->assertSame('VALIDATION_INVALID_FORMAT', $response->json('errors.0.code'));
        $this->assertSame('date_of_birth', $response->json('errors.0.field'));
    }

    public function test_user_without_dob_is_unchanged_when_guardian_gate_is_disabled(): void
    {
        VolunteeringConfigurationService::set(
            VolunteeringConfigurationService::CONFIG_GUARDIAN_CONSENT_REQUIRED,
            false
        );
        [$oppId] = $this->makeOpportunityWithShift();
        $this->actingAsUserWithDob(null);

        $this->apiPost("/v2/volunteering/opportunities/{$oppId}/apply", ['message' => 'hi'])
            ->assertStatus(201);
    }

    public function test_unknown_age_is_blocked_from_shift_signup_and_waitlist(): void
    {
        [, $shiftId] = $this->makeOpportunityWithShift();
        $this->actingAsUserWithDob(null);

        foreach ([
            "/v2/volunteering/shifts/{$shiftId}/signup",
            "/v2/volunteering/shifts/{$shiftId}/waitlist",
        ] as $path) {
            $response = $this->apiPost($path);
            $response->assertStatus(422);
            $this->assertSame('VALIDATION_REQUIRED_FIELD', $response->json('errors.0.code'));
            $this->assertSame('date_of_birth', $response->json('errors.0.field'));
        }
    }

    /**
     * Service-level enforcement (2026-07): the guardian-consent gate lived only
     * in VolunteerController, so callers that invoke the service directly — the
     * accessible (GOV.UK) frontend and group reservations — bypassed it. These
     * tests exercise the service methods directly (no HTTP controller in front).
     */
    public function test_service_apply_blocks_minor_without_consent(): void
    {
        [$oppId] = $this->makeOpportunityWithShift();
        $minor = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);
        DB::table('users')->where('id', $minor->id)->update(['date_of_birth' => now()->subYears(15)->toDateString()]);

        $this->assertTrue(VolunteerService::guardianConsentBlocks($minor->id, $oppId));

        $threw = false;
        try {
            VolunteerService::apply($oppId, $minor->id, ['message' => 'hi']);
        } catch (\RuntimeException $e) {
            $threw = true;
            $this->assertSame(403, $e->getCode());
        }
        $this->assertTrue($threw, 'apply() must throw for a consent-less minor');
        $this->assertDatabaseMissing('vol_applications', [
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $oppId,
            'user_id' => $minor->id,
        ]);
    }

    public function test_service_apply_blocks_user_without_dob(): void
    {
        [$oppId] = $this->makeOpportunityWithShift();
        $user = User::factory()->forTenant($this->testTenantId)->create(['date_of_birth' => null]);
        TenantContext::setById($this->testTenantId);

        try {
            VolunteerService::apply($oppId, $user->id, ['message' => 'hi']);
            $this->fail('apply() must fail closed when age cannot be determined');
        } catch (\RuntimeException $e) {
            $this->assertSame(422, $e->getCode());
        }

        $this->assertDatabaseMissing('vol_applications', [
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $oppId,
            'user_id' => $user->id,
        ]);
    }

    public function test_service_waitlist_blocks_user_without_dob(): void
    {
        [, $shiftId] = $this->makeOpportunityWithShift();
        $user = User::factory()->forTenant($this->testTenantId)->create(['date_of_birth' => null]);
        TenantContext::setById($this->testTenantId);

        $this->assertNull(ShiftWaitlistService::join($shiftId, $user->id));
        $this->assertSame('VALIDATION_REQUIRED_FIELD', ShiftWaitlistService::getErrors()[0]['code'] ?? null);
        $this->assertSame('date_of_birth', ShiftWaitlistService::getErrors()[0]['field'] ?? null);
    }

    public function test_waitlist_promotion_rechecks_age_before_assigning_shift(): void
    {
        [$oppId, $shiftId] = $this->makeOpportunityWithShift();
        $user = User::factory()->forTenant($this->testTenantId)->create(['date_of_birth' => null]);
        TenantContext::setById($this->testTenantId);
        $applicationId = (int) DB::table('vol_applications')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $oppId,
            'user_id' => $user->id,
            'status' => 'approved',
            'created_at' => now(),
        ]);
        $waitlistId = (int) DB::table('vol_shift_waitlist')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'shift_id' => $shiftId,
            'user_id' => $user->id,
            'position' => 1,
            'status' => 'notified',
            'notified_at' => now(),
            'created_at' => now(),
        ]);

        $this->assertFalse(ShiftWaitlistService::promoteUser($waitlistId, $this->testTenantId));
        $this->assertSame('VALIDATION_REQUIRED_FIELD', ShiftWaitlistService::getErrors()[0]['code'] ?? null);
        $this->assertSame('notified', DB::table('vol_shift_waitlist')->where('id', $waitlistId)->value('status'));
        $this->assertNull(DB::table('vol_applications')->where('id', $applicationId)->value('shift_id'));
    }

    public function test_service_signup_rechecks_consent_after_approval(): void
    {
        [$oppId, $shiftId] = $this->makeOpportunityWithShift();
        $minor = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);
        DB::table('users')->where('id', $minor->id)->update(['date_of_birth' => now()->subYears(16)->toDateString()]);

        // The minor already has an APPROVED application (consent has since lapsed).
        DB::table('vol_applications')->insert([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $oppId,
            'user_id' => $minor->id,
            'status' => 'approved',
            'created_at' => now(),
        ]);

        $ok = VolunteerService::signUpForShift($shiftId, $minor->id);

        $this->assertFalse($ok);
        $this->assertSame('GUARDIAN_CONSENT_REQUIRED', VolunteerService::getErrors()[0]['code'] ?? null);
    }

    public function test_verify_post_grants_pending_consent_without_auth(): void
    {
        TenantContext::setById($this->testTenantId);
        $token = bin2hex(random_bytes(32));
        $id = $this->insertPendingConsent($token);

        $response = $this->apiPost("/v2/volunteering/guardian-consents/verify/{$token}");

        $response->assertStatus(200);
        $this->assertSame('active', DB::table('vol_guardian_consents')->where('id', $id)->value('status'));
    }

    /**
     * 2026-07-10 audit H1: the verify GET used to perform the pending → active
     * grant, so any unauthenticated prefetch (mail scanner, token holder)
     * could record legal consent. GET must now be a read-only lookup.
     */
    public function test_verify_get_is_read_only_and_does_not_grant(): void
    {
        TenantContext::setById($this->testTenantId);
        $token = bin2hex(random_bytes(32));
        $id = $this->insertPendingConsent($token);

        $response = $this->apiGet("/v2/volunteering/guardian-consents/verify/{$token}");

        $response->assertStatus(200);
        $this->assertSame('pending', $response->json('data.status'));
        $this->assertArrayNotHasKey('consent_token', (array) $response->json('data'));
        $this->assertSame('pending', DB::table('vol_guardian_consents')->where('id', $id)->value('status'));

        $this->apiGet('/v2/volunteering/guardian-consents/verify/not-a-real-token')->assertStatus(400);
    }

    /**
     * 2026-07-10 audit C1: the minor's own consent-list endpoint returned every
     * column including consent_token, letting the minor grant their own
     * consent via the public verify URL. The token must never reach the minor.
     */
    public function test_minor_cannot_obtain_consent_token_or_self_grant(): void
    {
        $this->actingAsUserWithDob(now()->subYears(15)->toDateString());

        $create = $this->apiPost('/v2/volunteering/guardian-consents', [
            'guardian_name' => 'Real Guardian',
            'guardian_email' => 'real-guardian@example.com',
            'relationship' => 'parent',
        ]);
        $create->assertStatus(201);
        $this->assertArrayNotHasKey('consent_token', (array) $create->json('data'));

        $list = $this->apiGet('/v2/volunteering/guardian-consents');
        $list->assertStatus(200);
        $rows = $list->json('data');
        $this->assertNotEmpty($rows);
        foreach ($rows as $row) {
            $this->assertArrayNotHasKey('consent_token', $row);
            $this->assertArrayNotHasKey('consent_ip', $row);
        }

        // Even with the real token (worst case: obtained out-of-band), the GET
        // redemption vehicle no longer mutates — consent stays pending.
        $consentId = $rows[0]['id'];
        $token = DB::table('vol_guardian_consents')->where('id', $consentId)->value('consent_token');
        $this->apiGet("/v2/volunteering/guardian-consents/verify/{$token}")->assertStatus(200);
        $this->assertSame('pending', DB::table('vol_guardian_consents')->where('id', $consentId)->value('status'));
    }

    private function insertPendingConsent(string $token): int
    {
        return (int) DB::table('vol_guardian_consents')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'minor_user_id' => 1,
            'guardian_name' => 'Test Guardian',
            'guardian_email' => 'guardian@example.com',
            'relationship' => 'parent',
            'consent_token' => $token,
            'status' => 'pending',
            'expires_at' => now()->addDays(30)->format('Y-m-d H:i:s'),
            'created_at' => now(),
        ]);
    }
}
