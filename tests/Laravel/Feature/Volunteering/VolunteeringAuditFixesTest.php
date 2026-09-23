<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Volunteering;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\ShiftGroupReservationService;
use App\Services\ShiftWaitlistService;
use App\Services\VolunteerService;
use App\Services\VolunteeringConfigurationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Regression tests for the 2026-06-11 volunteering module audit fixes:
 *
 * 1. Admin "mark completed" path for offline donations — previously offline
 *    donations stayed 'pending' forever and never counted toward giving-day
 *    totals (no webhook, no admin action existed).
 * 2. ShiftGroupReservationService::addMember — previously inserted member
 *    rows without tenant_id (defaulting to tenant 1) and failed with a
 *    duplicate-key SERVER_ERROR when re-adding a previously removed member.
 */
class VolunteeringAuditFixesTest extends TestCase
{
    use DatabaseTransactions;

    private function actingAsAdmin(): User
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        return $admin;
    }

    private function createGivingDay(): int
    {
        return (int) DB::table('vol_giving_days')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'title' => 'Audit Test Giving Day',
            'goal_amount' => 1000.00,
            'raised_amount' => 0.00,
            'start_date' => now()->subDay()->toDateString(),
            'end_date' => now()->addDay()->toDateString(),
            'is_active' => 1,
            'created_by' => 1,
            'created_at' => now(),
        ]);
    }

    private function createDonation(int $givingDayId, string $paymentMethod = 'bank_transfer', string $status = 'pending', ?int $tenantId = null): int
    {
        return (int) DB::table('vol_donations')->insertGetId([
            'tenant_id' => $tenantId ?? $this->testTenantId,
            'user_id' => null,
            'giving_day_id' => $givingDayId,
            'amount' => 25.00,
            'currency' => 'EUR',
            'payment_method' => $paymentMethod,
            'status' => $status,
            'created_at' => now(),
        ]);
    }

    // ================================================================
    // Donation completion — POST /v2/admin/volunteering/donations/{id}/complete
    // ================================================================

    public function test_admin_completes_pending_offline_donation_and_increments_giving_day(): void
    {
        $this->actingAsAdmin();
        $givingDayId = $this->createGivingDay();
        $donationId = $this->createDonation($givingDayId);

        $response = $this->apiPost("/v2/admin/volunteering/donations/{$donationId}/complete");

        $response->assertStatus(200);

        $donation = DB::table('vol_donations')->where('id', $donationId)->first();
        $this->assertSame('completed', $donation->status);

        $day = DB::table('vol_giving_days')->where('id', $givingDayId)->first();
        $this->assertSame(25.00, (float) $day->raised_amount);
    }

    public function test_completing_twice_does_not_double_increment(): void
    {
        $this->actingAsAdmin();
        $givingDayId = $this->createGivingDay();
        $donationId = $this->createDonation($givingDayId);

        $this->apiPost("/v2/admin/volunteering/donations/{$donationId}/complete")->assertStatus(200);
        $second = $this->apiPost("/v2/admin/volunteering/donations/{$donationId}/complete");

        $second->assertStatus(200);
        $this->assertTrue((bool) ($second->json('data.already_completed') ?? $second->json('already_completed')));

        $day = DB::table('vol_giving_days')->where('id', $givingDayId)->first();
        $this->assertSame(25.00, (float) $day->raised_amount);
    }

    public function test_stripe_donations_cannot_be_completed_manually(): void
    {
        $this->actingAsAdmin();
        $givingDayId = $this->createGivingDay();
        $donationId = $this->createDonation($givingDayId, 'stripe');

        $response = $this->apiPost("/v2/admin/volunteering/donations/{$donationId}/complete");

        $response->assertStatus(422);
        $this->assertSame('pending', DB::table('vol_donations')->where('id', $donationId)->value('status'));
    }

    public function test_refunded_donations_cannot_be_completed(): void
    {
        $this->actingAsAdmin();
        $givingDayId = $this->createGivingDay();
        $donationId = $this->createDonation($givingDayId, 'bank_transfer', 'refunded');

        $response = $this->apiPost("/v2/admin/volunteering/donations/{$donationId}/complete");

        $response->assertStatus(422);
    }

    public function test_cross_tenant_donation_is_not_found(): void
    {
        $this->actingAsAdmin();
        $givingDayId = $this->createGivingDay();
        $donationId = $this->createDonation($givingDayId, 'bank_transfer', 'pending', $this->testTenantId + 1);

        $response = $this->apiPost("/v2/admin/volunteering/donations/{$donationId}/complete");

        $response->assertStatus(404);
    }

    public function test_complete_requires_admin(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);
        $givingDayId = $this->createGivingDay();
        $donationId = $this->createDonation($givingDayId);

        $response = $this->apiPost("/v2/admin/volunteering/donations/{$donationId}/complete");

        $response->assertStatus(403);
    }

    public function test_complete_requires_auth(): void
    {
        $response = $this->apiPost('/v2/admin/volunteering/donations/1/complete');

        $response->assertStatus(401);
    }

    // ================================================================
    // Group reservation addMember — tenant_id + re-add + capacity
    // ================================================================

    private function createReservation(int $leaderId, int $reservedSlots = 2): int
    {
        // User::factory() drifts TenantContext to tenant 1 — re-pin it for
        // the tenant-scoped service calls under test (known test gotcha).
        \App\Core\TenantContext::setById($this->testTenantId);

        $orgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $leaderId,
            'name' => 'Audit Test Org',
        ]);

        $oppId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $orgId,
            'title' => 'Audit Test Opportunity',
            'description' => 'Test',
        ]);

        $shiftId = (int) DB::table('vol_shifts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $oppId,
            'start_time' => now()->addDay(),
            'end_time' => now()->addDay()->addHours(2),
        ]);

        return (int) DB::table('vol_shift_group_reservations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'shift_id' => $shiftId,
            'group_id' => 999999,
            'reserved_slots' => $reservedSlots,
            'filled_slots' => 0,
            'reserved_by' => $leaderId,
            'status' => 'active',
            'created_at' => now(),
        ]);
    }

    public function test_add_member_sets_tenant_id_on_member_row(): void
    {
        $leader = User::factory()->forTenant($this->testTenantId)->create();
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $reservationId = $this->createReservation((int) $leader->id);

        $ok = ShiftGroupReservationService::addMember($reservationId, (int) $member->id, (int) $leader->id);

        $this->assertTrue($ok, json_encode(ShiftGroupReservationService::getErrors()));
        $row = DB::table('vol_shift_group_members')
            ->where('reservation_id', $reservationId)
            ->where('user_id', $member->id)
            ->first();
        $this->assertNotNull($row);
        $this->assertSame($this->testTenantId, (int) $row->tenant_id);
        $this->assertSame('confirmed', $row->status);
    }

    public function test_group_reservation_rejects_member_without_dob_when_guardian_gate_enabled(): void
    {
        VolunteeringConfigurationService::set(
            VolunteeringConfigurationService::CONFIG_GUARDIAN_CONSENT_REQUIRED,
            true
        );
        $leader = User::factory()->forTenant($this->testTenantId)->create();
        $member = User::factory()->forTenant($this->testTenantId)->create(['date_of_birth' => null]);
        $reservationId = $this->createReservation((int) $leader->id);

        $this->assertFalse(
            ShiftGroupReservationService::addMember($reservationId, (int) $member->id, (int) $leader->id)
        );
        $this->assertSame('VALIDATION_REQUIRED_FIELD', ShiftGroupReservationService::getErrors()[0]['code'] ?? null);
        $this->assertSame('date_of_birth', ShiftGroupReservationService::getErrors()[0]['field'] ?? null);
        $this->assertDatabaseMissing('vol_shift_group_members', [
            'tenant_id' => $this->testTenantId,
            'reservation_id' => $reservationId,
            'user_id' => $member->id,
        ]);
    }

    public function test_re_adding_removed_member_succeeds(): void
    {
        $leader = User::factory()->forTenant($this->testTenantId)->create();
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $reservationId = $this->createReservation((int) $leader->id);

        $this->assertTrue(ShiftGroupReservationService::addMember($reservationId, (int) $member->id, (int) $leader->id));
        $this->assertTrue(ShiftGroupReservationService::removeMember($reservationId, (int) $member->id, (int) $leader->id));

        // Previously this hit the unique_reservation_user key and returned SERVER_ERROR
        $ok = ShiftGroupReservationService::addMember($reservationId, (int) $member->id, (int) $leader->id);

        $this->assertTrue($ok, json_encode(ShiftGroupReservationService::getErrors()));
        $this->assertSame('confirmed', DB::table('vol_shift_group_members')
            ->where('reservation_id', $reservationId)
            ->where('user_id', $member->id)
            ->value('status'));
        $this->assertSame(1, (int) DB::table('vol_shift_group_reservations')
            ->where('id', $reservationId)
            ->value('filled_slots'));
    }

    public function test_add_member_rejects_when_slots_filled(): void
    {
        $leader = User::factory()->forTenant($this->testTenantId)->create();
        $m1 = User::factory()->forTenant($this->testTenantId)->create();
        $m2 = User::factory()->forTenant($this->testTenantId)->create();
        $reservationId = $this->createReservation((int) $leader->id, 1);

        $this->assertTrue(ShiftGroupReservationService::addMember($reservationId, (int) $m1->id, (int) $leader->id));
        $this->assertFalse(ShiftGroupReservationService::addMember($reservationId, (int) $m2->id, (int) $leader->id));

        $errors = ShiftGroupReservationService::getErrors();
        $this->assertSame('VALIDATION_ERROR', $errors[0]['code'] ?? null);
        $this->assertSame(1, (int) DB::table('vol_shift_group_reservations')
            ->where('id', $reservationId)
            ->value('filled_slots'));
    }

    public function test_duplicate_confirmed_member_rejected(): void
    {
        $leader = User::factory()->forTenant($this->testTenantId)->create();
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $reservationId = $this->createReservation((int) $leader->id);

        $this->assertTrue(ShiftGroupReservationService::addMember($reservationId, (int) $member->id, (int) $leader->id));
        $this->assertFalse(ShiftGroupReservationService::addMember($reservationId, (int) $member->id, (int) $leader->id));

        $errors = ShiftGroupReservationService::getErrors();
        $this->assertSame('ALREADY_EXISTS', $errors[0]['code'] ?? null);
        $this->assertSame(1, (int) DB::table('vol_shift_group_reservations')
            ->where('id', $reservationId)
            ->value('filled_slots'));
    }

    /** @return array{owner: User, orgId: int, oppId: int, shiftId: int} */
    private function createPublicShiftFixture(int $capacity = 1): array
    {
        TenantContext::setById($this->testTenantId);
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);

        $orgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'name' => 'Capacity Audit Org',
            'status' => 'approved',
            'created_at' => now(),
        ]);

        $oppId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $orgId,
            'title' => 'Capacity Audit Opportunity',
            'description' => 'Test',
            'status' => 'active',
            'is_active' => 1,
            'created_by' => $owner->id,
            'created_at' => now(),
        ]);

        $shiftId = (int) DB::table('vol_shifts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $oppId,
            'start_time' => now()->addDay(),
            'end_time' => now()->addDay()->addHours(2),
            'capacity' => $capacity,
        ]);

        return ['owner' => $owner, 'orgId' => $orgId, 'oppId' => $oppId, 'shiftId' => $shiftId];
    }

    private function createManagedGroup(User $owner): int
    {
        TenantContext::setById($this->testTenantId);

        return (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $owner->id,
            'creator_id' => $owner->id,
            'name' => 'Capacity Audit Group ' . uniqid('', true),
            'slug' => 'capacity-audit-group-' . uniqid(),
            'visibility' => 'public',
            'status' => 'active',
            'is_active' => 1,
            'created_at' => now(),
        ]);
    }

    private function addApprovedApplication(int $oppId, int $userId, ?int $shiftId = null): int
    {
        TenantContext::setById($this->testTenantId);

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

    private function addActiveReservation(int $shiftId, int $groupId, int $reservedBy, int $slots): int
    {
        TenantContext::setById($this->testTenantId);

        return (int) DB::table('vol_shift_group_reservations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'shift_id' => $shiftId,
            'group_id' => $groupId,
            'reserved_slots' => $slots,
            'filled_slots' => 0,
            'reserved_by' => $reservedBy,
            'status' => 'active',
            'created_at' => now(),
        ]);
    }

    public function test_shift_list_counts_group_reservations_against_available_spots(): void
    {
        $fixture = $this->createPublicShiftFixture(2);
        $groupId = $this->createManagedGroup($fixture['owner']);
        $this->addActiveReservation($fixture['shiftId'], $groupId, (int) $fixture['owner']->id, 2);

        $shifts = VolunteerService::getShiftsForOpportunity($fixture['oppId']);

        $this->assertCount(1, $shifts);
        $this->assertSame(0, $shifts[0]['signup_count']);
        $this->assertSame(2, $shifts[0]['reserved_count']);
        $this->assertSame(0, $shifts[0]['spots_available']);
    }

    public function test_direct_shift_signup_rejects_when_group_reservation_consumes_capacity(): void
    {
        $fixture = $this->createPublicShiftFixture(1);
        $groupId = $this->createManagedGroup($fixture['owner']);
        $this->addActiveReservation($fixture['shiftId'], $groupId, (int) $fixture['owner']->id, 1);

        $volunteer = User::factory()->forTenant($this->testTenantId)->create();
        $appId = $this->addApprovedApplication($fixture['oppId'], (int) $volunteer->id);

        $ok = VolunteerService::signUpForShift($fixture['shiftId'], (int) $volunteer->id);

        $this->assertFalse($ok);
        $errors = VolunteerService::getErrors();
        $this->assertSame('VALIDATION_ERROR', $errors[0]['code'] ?? null);
        $this->assertNull(DB::table('vol_applications')->where('id', $appId)->value('shift_id'));
    }

    public function test_shift_application_rejects_when_group_reservation_consumes_capacity(): void
    {
        $fixture = $this->createPublicShiftFixture(1);
        $groupId = $this->createManagedGroup($fixture['owner']);
        $this->addActiveReservation($fixture['shiftId'], $groupId, (int) $fixture['owner']->id, 1);

        $volunteer = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionCode(422);

        VolunteerService::apply($fixture['oppId'], (int) $volunteer->id, ['shift_id' => $fixture['shiftId']]);
    }

    public function test_direct_shift_signup_rechecks_opportunity_visibility(): void
    {
        $fixture = $this->createPublicShiftFixture(1);
        $volunteer = User::factory()->forTenant($this->testTenantId)->create();
        $this->addApprovedApplication($fixture['oppId'], (int) $volunteer->id);

        DB::table('vol_opportunities')
            ->where('id', $fixture['oppId'])
            ->where('tenant_id', $this->testTenantId)
            ->update(['is_active' => 0, 'updated_at' => now()]);

        $ok = VolunteerService::signUpForShift($fixture['shiftId'], (int) $volunteer->id);

        $this->assertFalse($ok);
        $errors = VolunteerService::getErrors();
        $this->assertSame('NOT_FOUND', $errors[0]['code'] ?? null);
    }

    public function test_waitlist_join_treats_reserved_slots_as_full_capacity(): void
    {
        $fixture = $this->createPublicShiftFixture(1);
        $groupId = $this->createManagedGroup($fixture['owner']);
        $this->addActiveReservation($fixture['shiftId'], $groupId, (int) $fixture['owner']->id, 1);

        $volunteer = User::factory()->forTenant($this->testTenantId)->create();
        $this->addApprovedApplication($fixture['oppId'], (int) $volunteer->id);

        $entryId = ShiftWaitlistService::join($fixture['shiftId'], (int) $volunteer->id);

        $this->assertIsInt($entryId, json_encode(ShiftWaitlistService::getErrors()));
        $this->assertDatabaseHas('vol_shift_waitlist', [
            'id' => $entryId,
            'tenant_id' => $this->testTenantId,
            'shift_id' => $fixture['shiftId'],
            'user_id' => $volunteer->id,
            'status' => 'waiting',
        ]);
    }

    public function test_group_reservation_rejects_slots_taken_by_direct_signup(): void
    {
        $fixture = $this->createPublicShiftFixture(1);
        $volunteer = User::factory()->forTenant($this->testTenantId)->create();
        $this->addApprovedApplication($fixture['oppId'], (int) $volunteer->id, $fixture['shiftId']);
        $groupId = $this->createManagedGroup($fixture['owner']);

        $reservationId = ShiftGroupReservationService::reserve($fixture['shiftId'], $groupId, (int) $fixture['owner']->id, 1);

        $this->assertNull($reservationId);
        $errors = ShiftGroupReservationService::getErrors();
        $this->assertSame('VALIDATION_ERROR', $errors[0]['code'] ?? null);
    }

    public function test_failed_expense_submission_deletes_stored_receipt(): void
    {
        Storage::fake('local');
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode(['volunteering' => true]),
        ]);
        TenantContext::setById($this->testTenantId);

        $volunteer = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($volunteer);
        TenantContext::setById($this->testTenantId);

        $response = $this->post('/api/v2/volunteering/expenses', [
            'organization_id' => 999999,
            'expense_type' => 'travel',
            'amount' => '12.50',
            'description' => 'Taxi after a late volunteer shift',
            'receipt' => UploadedFile::fake()->image('receipt.jpg'),
        ], $this->withTenantHeader());

        $response->assertStatus(404);
        $this->assertSame([], Storage::disk('local')->allFiles("volunteer-expenses/{$this->testTenantId}"));
    }
}
