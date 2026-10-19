<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Volunteering;

use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\Models\User;
use App\Services\SafeguardingInteractionPolicy;
use App\Services\ShiftSwapService;
use App\Services\ShiftWaitlistService;
use App\Services\VolunteerService;
use App\Services\VolunteeringConfigurationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * Regression tests for the 2026-06-11 deep-audit fixes:
 *
 * The shift waitlist was feature-dead — nothing ever transitioned entries
 * from 'waiting' to 'notified', so promoteUser() (which requires 'notified')
 * could never succeed and joined users waited forever. These tests cover the
 * full lifecycle that now exists: slot frees → next in line notified →
 * claim (capacity-rechecked) → promoted, plus offer expiry cascade and the
 * leave-while-notified handoff. Also covers the new past-shift guard on
 * swap execution.
 */
class WaitlistFlowTest extends TestCase
{
    use DatabaseTransactions;

    /** @return array{shiftId: int, oppId: int, ownerId: int} */
    private function createShift(int $capacity = 1, bool $past = false): array
    {
        TenantContext::setById($this->testTenantId);

        $orgOwner = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);

        $orgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $orgOwner->id,
            'name' => 'Waitlist Test Org',
            'status' => 'approved',
            'created_at' => now(),
        ]);

        $oppId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $orgId,
            'title' => 'Waitlist Test Opportunity',
            'description' => 'Test',
            'status' => 'active',
            'is_active' => 1,
            'created_by' => $orgOwner->id,
            'created_at' => now(),
        ]);

        $shiftId = (int) DB::table('vol_shifts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $oppId,
            'start_time' => $past ? now()->subDay() : now()->addDay(),
            'end_time' => $past ? now()->subDay()->addHours(2) : now()->addDay()->addHours(2),
            'capacity' => $capacity,
        ]);

        return ['shiftId' => $shiftId, 'oppId' => $oppId, 'ownerId' => (int) $orgOwner->id];
    }

    private function enableVolunteeringFeature(): void
    {
        $features = json_decode((string) DB::table('tenants')->where('id', $this->testTenantId)->value('features'), true);
        $features = is_array($features) ? $features : [];
        $features['volunteering'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);
    }

    private function addApprovedSignup(int $oppId, int $shiftId, int $userId): int
    {
        return (int) DB::table('vol_applications')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $oppId,
            'shift_id' => $shiftId,
            'user_id' => $userId,
            'status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function addWaitlistEntry(int $shiftId, int $userId, int $position, string $status = 'waiting', ?string $notifiedAt = null): int
    {
        return (int) DB::table('vol_shift_waitlist')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'shift_id' => $shiftId,
            'user_id' => $userId,
            'position' => $position,
            'status' => $status,
            'notified_at' => $notifiedAt,
            'created_at' => now(),
        ]);
    }

    private function waitlistStatus(int $entryId): string
    {
        return (string) DB::table('vol_shift_waitlist')->where('id', $entryId)->value('status');
    }

    // ================================================================
    // notifyNext
    // ================================================================

    public function test_notify_next_offers_spot_to_first_in_line(): void
    {
        ['shiftId' => $shiftId] = $this->createShift(2);
        $u1 = User::factory()->forTenant($this->testTenantId)->create();
        $u2 = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);
        $e1 = $this->addWaitlistEntry($shiftId, (int) $u1->id, 1);
        $e2 = $this->addWaitlistEntry($shiftId, (int) $u2->id, 2);

        $result = ShiftWaitlistService::notifyNext($shiftId, $this->testTenantId);

        $this->assertTrue($result);
        $this->assertSame('notified', $this->waitlistStatus($e1));
        $this->assertSame('waiting', $this->waitlistStatus($e2));
        $this->assertNotNull(DB::table('vol_shift_waitlist')->where('id', $e1)->value('notified_at'));
    }

    public function test_notify_next_noop_when_shift_full(): void
    {
        ['shiftId' => $shiftId, 'oppId' => $oppId] = $this->createShift(1);
        $occupant = User::factory()->forTenant($this->testTenantId)->create();
        $waiter = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);
        $this->addApprovedSignup($oppId, $shiftId, (int) $occupant->id);
        $entry = $this->addWaitlistEntry($shiftId, (int) $waiter->id, 1);

        $result = ShiftWaitlistService::notifyNext($shiftId, $this->testTenantId);

        $this->assertFalse($result);
        $this->assertSame('waiting', $this->waitlistStatus($entry));
    }

    public function test_notify_next_counts_outstanding_offers_against_capacity(): void
    {
        ['shiftId' => $shiftId] = $this->createShift(1);
        $u1 = User::factory()->forTenant($this->testTenantId)->create();
        $u2 = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);
        $this->addWaitlistEntry($shiftId, (int) $u1->id, 1, 'notified', now()->toDateTimeString());
        $e2 = $this->addWaitlistEntry($shiftId, (int) $u2->id, 2);

        $result = ShiftWaitlistService::notifyNext($shiftId, $this->testTenantId);

        // Capacity 1, one outstanding offer — no second offer may go out
        $this->assertFalse($result);
        $this->assertSame('waiting', $this->waitlistStatus($e2));
    }

    public function test_notify_next_policy_denial_leaves_offer_waiting(): void
    {
        ['shiftId' => $shiftId, 'ownerId' => $ownerId] = $this->createShift(1);
        $waiter = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);
        $entry = $this->addWaitlistEntry($shiftId, (int) $waiter->id, 1);

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertLocalContactAllowed')
            ->once()
            ->with($waiter->id, $ownerId, $this->testTenantId, 'volunteer_shift_waitlist_spot_offer')
            ->andThrow(new SafeguardingPolicyException('VETTING_REQUIRED', 'Vetting required'));
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $this->assertFalse(ShiftWaitlistService::notifyNext($shiftId, $this->testTenantId));
        $this->assertSame('waiting', $this->waitlistStatus($entry));
        $this->assertNull(DB::table('vol_shift_waitlist')->where('id', $entry)->value('notified_at'));
    }

    public function test_waitlist_join_api_denial_writes_no_entry(): void
    {
        $this->enableVolunteeringFeature();
        ['shiftId' => $shiftId, 'oppId' => $oppId, 'ownerId' => $ownerId] = $this->createShift(1);
        $occupant = User::factory()->forTenant($this->testTenantId)->create();
        $waiter = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);
        $this->addApprovedSignup($oppId, $shiftId, (int) $occupant->id);
        DB::table('vol_applications')->insert([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $oppId,
            'shift_id' => null,
            'user_id' => $waiter->id,
            'status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        Sanctum::actingAs($waiter, ['*']);

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertLocalContactAllowed')
            ->once()
            ->with($waiter->id, $ownerId, $this->testTenantId, 'volunteer_shift_waitlist_join')
            ->andThrow(new SafeguardingPolicyException('VETTING_REQUIRED', 'Vetting required'));
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $response = $this->apiPost("/v2/volunteering/shifts/{$shiftId}/waitlist");

        $response->assertStatus(403)->assertJsonPath('errors.0.code', 'VETTING_REQUIRED');
        $this->assertDatabaseMissing('vol_shift_waitlist', [
            'tenant_id' => $this->testTenantId,
            'shift_id' => $shiftId,
            'user_id' => $waiter->id,
        ]);
    }

    // ================================================================
    // Slot-freeing hooks
    // ================================================================

    public function test_cancelling_shift_signup_notifies_next_in_line(): void
    {
        ['shiftId' => $shiftId, 'oppId' => $oppId] = $this->createShift(1);
        $occupant = User::factory()->forTenant($this->testTenantId)->create();
        $waiter = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);
        $this->addApprovedSignup($oppId, $shiftId, (int) $occupant->id);
        $entry = $this->addWaitlistEntry($shiftId, (int) $waiter->id, 1);

        $ok = VolunteerService::cancelShiftSignup($shiftId, (int) $occupant->id);

        $this->assertTrue($ok, json_encode(VolunteerService::getErrors()));
        $this->assertSame('notified', $this->waitlistStatus($entry));
    }

    /**
     * 2026-06-17 audit: the admin-configurable cancellation_deadline_hours
     * setting was a no-op (cancelShiftSignup only blocked after a shift had
     * already started). It now binds — a cancellation inside the configured
     * advance-notice window is rejected. Unset (default 0) preserves the old
     * "cancel any time before start" behaviour (covered by the test above).
     */
    public function test_cancellation_blocked_within_configured_deadline(): void
    {
        ['oppId' => $oppId] = $this->createShift(1);
        TenantContext::setById($this->testTenantId);
        // A shift starting in 6 hours — inside a 24h cancellation deadline.
        $soonShiftId = (int) DB::table('vol_shifts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $oppId,
            'start_time' => now()->addHours(6),
            'end_time' => now()->addHours(8),
            'capacity' => 1,
        ]);
        $user = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);
        $this->addApprovedSignup($oppId, $soonShiftId, (int) $user->id);

        VolunteeringConfigurationService::set(
            VolunteeringConfigurationService::CONFIG_CANCELLATION_DEADLINE_HOURS,
            24,
        );

        $ok = VolunteerService::cancelShiftSignup($soonShiftId, (int) $user->id);

        $this->assertFalse($ok, 'cancellation within the configured deadline should be rejected');
        $errors = VolunteerService::getErrors();
        $this->assertNotEmpty($errors);
        $this->assertSame('VALIDATION_ERROR', $errors[0]['code']);
    }

    /**
     * 2026-06-17 audit: switching to another shift in the same opportunity
     * silently freed the original shift's slot without offering it to that
     * shift's waitlist (signUpForShift overwrote shift_id with no notifyNext).
     */
    public function test_switching_shifts_notifies_the_vacated_shifts_waitlist(): void
    {
        ['shiftId' => $shiftA, 'oppId' => $oppId] = $this->createShift(1);
        TenantContext::setById($this->testTenantId);
        $shiftB = (int) DB::table('vol_shifts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $oppId,
            'start_time' => now()->addDays(2),
            'end_time' => now()->addDays(2)->addHours(2),
            'capacity' => 1,
        ]);

        $mover = User::factory()->forTenant($this->testTenantId)->create();
        $waiter = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);
        // Mover is approved on the opportunity and currently attached to shift A.
        $this->addApprovedSignup($oppId, $shiftA, (int) $mover->id);
        // Someone is waiting on shift A.
        $entry = $this->addWaitlistEntry($shiftA, (int) $waiter->id, 1);

        // Mover switches to shift B — shift A's spot frees.
        $ok = VolunteerService::signUpForShift($shiftB, (int) $mover->id);

        $this->assertTrue($ok, json_encode(VolunteerService::getErrors()));
        $this->assertSame('notified', $this->waitlistStatus($entry));
    }

    // ================================================================
    // promoteUser (claim)
    // ================================================================

    public function test_notified_user_can_claim_spot(): void
    {
        ['shiftId' => $shiftId, 'oppId' => $oppId] = $this->createShift(1);
        $waiter = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);
        DB::table('vol_applications')->insert([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $oppId,
            'shift_id' => null,
            'user_id' => $waiter->id,
            'status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $entry = $this->addWaitlistEntry($shiftId, (int) $waiter->id, 1, 'notified', now()->toDateTimeString());

        $ok = ShiftWaitlistService::promoteUser($entry, $this->testTenantId);

        $this->assertTrue($ok, json_encode(ShiftWaitlistService::getErrors()));
        $this->assertSame('promoted', $this->waitlistStatus($entry));

        $app = DB::table('vol_applications')
            ->where('shift_id', $shiftId)
            ->where('user_id', $waiter->id)
            ->where('tenant_id', $this->testTenantId)
            ->first();
        $this->assertNotNull($app);
        $this->assertSame('approved', $app->status);
        $this->assertSame($oppId, (int) $app->opportunity_id);
    }

    public function test_waiting_user_cannot_claim_before_being_notified(): void
    {
        ['shiftId' => $shiftId] = $this->createShift(1);
        $waiter = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);
        $entry = $this->addWaitlistEntry($shiftId, (int) $waiter->id, 1);

        $ok = ShiftWaitlistService::promoteUser($entry, $this->testTenantId);

        $this->assertFalse($ok);
        $errors = ShiftWaitlistService::getErrors();
        $this->assertSame('VALIDATION_ERROR', $errors[0]['code'] ?? null);
        $this->assertSame('waiting', $this->waitlistStatus($entry));
    }

    public function test_claim_fails_when_spot_taken_in_the_meantime(): void
    {
        ['shiftId' => $shiftId, 'oppId' => $oppId] = $this->createShift(1);
        $waiter = User::factory()->forTenant($this->testTenantId)->create();
        $sniper = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);
        $entry = $this->addWaitlistEntry($shiftId, (int) $waiter->id, 1, 'notified', now()->toDateTimeString());

        // Someone else takes the last spot through another path
        $this->addApprovedSignup($oppId, $shiftId, (int) $sniper->id);

        $ok = ShiftWaitlistService::promoteUser($entry, $this->testTenantId);

        $this->assertFalse($ok);
        $this->assertSame('notified', $this->waitlistStatus($entry));
        $this->assertSame(0, DB::table('vol_applications')
            ->where('shift_id', $shiftId)->where('user_id', $waiter->id)->count());
    }

    public function test_waitlist_promotion_api_rechecks_policy_before_application_write(): void
    {
        $this->enableVolunteeringFeature();
        ['shiftId' => $shiftId, 'oppId' => $oppId, 'ownerId' => $ownerId] = $this->createShift(1);
        $waiter = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);
        DB::table('vol_applications')->insert([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $oppId,
            'shift_id' => null,
            'user_id' => $waiter->id,
            'status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $entry = $this->addWaitlistEntry($shiftId, (int) $waiter->id, 1, 'notified', now()->toDateTimeString());
        Sanctum::actingAs($waiter, ['*']);

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertLocalContactAllowed')
            ->once()
            ->with($waiter->id, $ownerId, $this->testTenantId, 'volunteer_shift_waitlist_promotion')
            ->andThrow(new SafeguardingPolicyException('SAFEGUARDING_POLICY_UNAVAILABLE', 'Policy unavailable'));
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $response = $this->apiPost("/v2/volunteering/shifts/{$shiftId}/waitlist/promote");

        $response->assertStatus(503)->assertJsonPath('errors.0.code', 'SAFEGUARDING_POLICY_UNAVAILABLE');
        $this->assertSame('notified', $this->waitlistStatus($entry));
        $this->assertNull(DB::table('vol_applications')
            ->where('tenant_id', $this->testTenantId)
            ->where('opportunity_id', $oppId)
            ->where('user_id', $waiter->id)
            ->value('shift_id'));
    }

    public function test_waitlist_leave_remains_available_without_policy_check(): void
    {
        $this->enableVolunteeringFeature();
        ['shiftId' => $shiftId] = $this->createShift(1);
        $waiter = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);
        $entry = $this->addWaitlistEntry($shiftId, (int) $waiter->id, 1, 'waiting');
        Sanctum::actingAs($waiter, ['*']);

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldNotReceive('assertLocalContactAllowed');
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $this->apiDelete("/v2/volunteering/shifts/{$shiftId}/waitlist")->assertNoContent();
        $this->assertSame('cancelled', $this->waitlistStatus($entry));
    }

    // ================================================================
    // Offer expiry cascade
    // ================================================================

    public function test_stale_offers_expire_and_cascade_to_next(): void
    {
        ['shiftId' => $shiftId] = $this->createShift(1);
        $u1 = User::factory()->forTenant($this->testTenantId)->create();
        $u2 = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);
        $e1 = $this->addWaitlistEntry($shiftId, (int) $u1->id, 1, 'notified', now()->subHours(72)->toDateTimeString());
        $e2 = $this->addWaitlistEntry($shiftId, (int) $u2->id, 2);

        $expired = ShiftWaitlistService::expireStaleNotifications(48);

        $this->assertSame(1, $expired);
        $this->assertSame('expired', $this->waitlistStatus($e1));
        $this->assertSame('notified', $this->waitlistStatus($e2));
    }

    public function test_fresh_offers_are_not_expired(): void
    {
        ['shiftId' => $shiftId] = $this->createShift(1);
        $u1 = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);
        $e1 = $this->addWaitlistEntry($shiftId, (int) $u1->id, 1, 'notified', now()->subHours(2)->toDateTimeString());

        $expired = ShiftWaitlistService::expireStaleNotifications(48);

        $this->assertSame(0, $expired);
        $this->assertSame('notified', $this->waitlistStatus($e1));
    }

    // ================================================================
    // Leaving while holding an offer
    // ================================================================

    public function test_leaving_while_notified_passes_offer_to_next(): void
    {
        ['shiftId' => $shiftId] = $this->createShift(1);
        $u1 = User::factory()->forTenant($this->testTenantId)->create();
        $u2 = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);
        $e1 = $this->addWaitlistEntry($shiftId, (int) $u1->id, 1, 'notified', now()->toDateTimeString());
        $e2 = $this->addWaitlistEntry($shiftId, (int) $u2->id, 2);

        $ok = ShiftWaitlistService::leave($shiftId, (int) $u1->id);

        $this->assertTrue($ok, json_encode(ShiftWaitlistService::getErrors()));
        $this->assertSame('cancelled', $this->waitlistStatus($e1));
        $this->assertSame('notified', $this->waitlistStatus($e2));
    }

    // ================================================================
    // Swap past-shift guard
    // ================================================================

    public function test_swap_cannot_execute_once_shift_started(): void
    {
        ['shiftId' => $pastShiftId, 'oppId' => $pastOppId] = $this->createShift(5, true);
        ['shiftId' => $futureShiftId, 'oppId' => $futureOppId] = $this->createShift(5);
        $alice = User::factory()->forTenant($this->testTenantId)->create();
        $bob = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);
        $this->addApprovedSignup($pastOppId, $pastShiftId, (int) $alice->id);
        $this->addApprovedSignup($futureOppId, $futureShiftId, (int) $bob->id);

        $swapId = (int) DB::table('vol_shift_swap_requests')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'from_user_id' => $alice->id,
            'to_user_id' => $bob->id,
            'from_shift_id' => $pastShiftId,
            'to_shift_id' => $futureShiftId,
            'status' => 'pending',
            'requires_admin_approval' => 0,
            'created_at' => now(),
        ]);

        $ok = ShiftSwapService::respond($swapId, (int) $bob->id, 'accept');

        $this->assertFalse($ok);

        // Assignments must be untouched
        $this->assertSame($pastShiftId, (int) DB::table('vol_applications')
            ->where('user_id', $alice->id)->where('tenant_id', $this->testTenantId)->value('shift_id'));
        $this->assertSame($futureShiftId, (int) DB::table('vol_applications')
            ->where('user_id', $bob->id)->where('tenant_id', $this->testTenantId)->value('shift_id'));
    }

    // ================================================================
    // Polish pass, 19 Oct 2026 — rejoin, queue positions, deadline, direct sign-up
    // ================================================================

    private function addApprovedApplicationWithoutShift(int $oppId, int $userId): int
    {
        return (int) DB::table('vol_applications')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $oppId,
            'shift_id' => null,
            'user_id' => $userId,
            'status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function waitlistPosition(int $entryId): int
    {
        return (int) DB::table('vol_shift_waitlist')->where('id', $entryId)->value('position');
    }

    public function test_a_member_who_left_can_join_the_same_waitlist_again(): void
    {
        // vol_shift_waitlist has UNIQUE (shift_id, user_id): a second INSERT after
        // leaving threw, and join() reported it as a generic failure.
        ['shiftId' => $shiftId, 'oppId' => $oppId] = $this->createShift(1);
        $occupant = User::factory()->forTenant($this->testTenantId)->create();
        $waiter = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);
        $this->addApprovedSignup($oppId, $shiftId, (int) $occupant->id);
        $this->addApprovedApplicationWithoutShift($oppId, (int) $waiter->id);
        $old = $this->addWaitlistEntry($shiftId, (int) $waiter->id, 1, 'cancelled');

        $entryId = ShiftWaitlistService::join($shiftId, (int) $waiter->id);

        $this->assertNotNull($entryId, json_encode(ShiftWaitlistService::getErrors()));
        $this->assertSame($old, $entryId, 'the existing row is reused, not duplicated');
        $this->assertSame('waiting', $this->waitlistStatus($entryId));
        $this->assertSame(1, $this->waitlistPosition($entryId));
        $this->assertSame(1, DB::table('vol_shift_waitlist')->where('shift_id', $shiftId)->where('user_id', $waiter->id)->count());
    }

    public function test_a_member_holding_an_offer_cannot_join_again(): void
    {
        // With an outstanding offer the shift has a free place, so the old check
        // answered "this shift is not full" instead of "you are already on it".
        ['shiftId' => $shiftId, 'oppId' => $oppId] = $this->createShift(1);
        $waiter = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);
        $this->addApprovedApplicationWithoutShift($oppId, (int) $waiter->id);
        $this->addWaitlistEntry($shiftId, (int) $waiter->id, 1, 'notified', now()->toDateTimeString());

        $this->assertNull(ShiftWaitlistService::join($shiftId, (int) $waiter->id));
        $this->assertSame('ALREADY_EXISTS', ShiftWaitlistService::getErrors()[0]['code']);
    }

    public function test_queue_positions_close_up_after_a_claim(): void
    {
        ['shiftId' => $shiftId, 'oppId' => $oppId] = $this->createShift(1);
        $first = User::factory()->forTenant($this->testTenantId)->create();
        $second = User::factory()->forTenant($this->testTenantId)->create();
        $third = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);
        $this->addApprovedApplicationWithoutShift($oppId, (int) $first->id);
        $e1 = $this->addWaitlistEntry($shiftId, (int) $first->id, 1, 'notified', now()->toDateTimeString());
        $e2 = $this->addWaitlistEntry($shiftId, (int) $second->id, 2);
        $e3 = $this->addWaitlistEntry($shiftId, (int) $third->id, 3);

        $this->assertTrue(ShiftWaitlistService::promoteUser($e1, $this->testTenantId), json_encode(ShiftWaitlistService::getErrors()));

        // Until now the two still waiting kept reading "position 2" and "position 3".
        $this->assertSame(1, $this->waitlistPosition($e2));
        $this->assertSame(2, $this->waitlistPosition($e3));
    }

    public function test_queue_positions_close_up_after_an_offer_expires(): void
    {
        ['shiftId' => $shiftId] = $this->createShift(1);
        $first = User::factory()->forTenant($this->testTenantId)->create();
        $second = User::factory()->forTenant($this->testTenantId)->create();
        $third = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);
        $e1 = $this->addWaitlistEntry($shiftId, (int) $first->id, 1, 'notified', now()->subHours(49)->toDateTimeString());
        $e2 = $this->addWaitlistEntry($shiftId, (int) $second->id, 2);
        $e3 = $this->addWaitlistEntry($shiftId, (int) $third->id, 3);

        $this->assertSame(1, ShiftWaitlistService::expireStaleNotifications(48));

        $this->assertSame('expired', $this->waitlistStatus($e1));
        $this->assertSame('notified', $this->waitlistStatus($e2), 'the offer cascades to the next in line');
        $this->assertSame(1, $this->waitlistPosition($e2));
        $this->assertSame(2, $this->waitlistPosition($e3));
    }

    public function test_entries_for_shifts_that_have_started_are_expired_by_the_sweep(): void
    {
        ['shiftId' => $pastShiftId] = $this->createShift(1, true);
        ['shiftId' => $futureShiftId] = $this->createShift(1);
        $waiter = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);
        $stale = $this->addWaitlistEntry($pastShiftId, (int) $waiter->id, 1);
        $live = $this->addWaitlistEntry($futureShiftId, (int) $waiter->id, 1);

        ShiftWaitlistService::expireStaleNotifications(48);

        $this->assertSame('expired', $this->waitlistStatus($stale));
        $this->assertSame('waiting', $this->waitlistStatus($live));
    }

    public function test_my_waitlists_carries_the_claim_deadline_and_skips_started_shifts(): void
    {
        ['shiftId' => $pastShiftId] = $this->createShift(1, true);
        ['shiftId' => $offeredShiftId] = $this->createShift(1);
        ['shiftId' => $waitingShiftId] = $this->createShift(1);
        $waiter = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);
        $this->addWaitlistEntry($pastShiftId, (int) $waiter->id, 1);
        $notifiedAt = now()->subHours(10)->startOfSecond();
        $offered = $this->addWaitlistEntry($offeredShiftId, (int) $waiter->id, 1, 'notified', $notifiedAt->toDateTimeString());
        $waiting = $this->addWaitlistEntry($waitingShiftId, (int) $waiter->id, 1);

        $entries = ShiftWaitlistService::getUserWaitlists((int) $waiter->id, $this->testTenantId);

        $byId = collect($entries)->keyBy('id');
        $this->assertEqualsCanonicalizing([$offered, $waiting], $byId->keys()->all(), 'a shift that has started is not something you can still wait for');
        $this->assertSame(
            $notifiedAt->copy()->addHours(ShiftWaitlistService::OFFER_WINDOW_HOURS)->toDateTimeString(),
            $byId[$offered]['expires_at'],
        );
        $this->assertNull($byId[$waiting]['expires_at']);
    }

    public function test_signing_up_directly_settles_the_members_own_offer(): void
    {
        // The accessible website tells a notified member to "sign up from the
        // opportunity page". That worked, but the offer stayed 'notified' for 48
        // hours and "My waitlists" kept shouting "a place is free" for a shift the
        // member already held.
        $this->enableVolunteeringFeature();
        ['shiftId' => $shiftId, 'oppId' => $oppId] = $this->createShift(1);
        $waiter = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);
        $this->addApprovedApplicationWithoutShift($oppId, (int) $waiter->id);
        $entry = $this->addWaitlistEntry($shiftId, (int) $waiter->id, 1, 'notified', now()->toDateTimeString());

        $ok = VolunteerService::signUpForShift($shiftId, (int) $waiter->id);

        $this->assertTrue($ok, json_encode(VolunteerService::getErrors()));
        $this->assertSame('promoted', $this->waitlistStatus($entry));
        $this->assertNotNull(DB::table('vol_shift_waitlist')->where('id', $entry)->value('promoted_at'));
    }
}
