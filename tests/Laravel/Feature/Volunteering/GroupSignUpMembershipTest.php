<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Volunteering;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\ShiftGroupReservationService;
use App\Services\VolunteerCheckInService;
use App\Services\VolunteerService;
use App\Services\VolunteerShiftCapacityService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Group sign-ups (8 Oct 2026): a member a group leader names on a reservation
 * must be a REAL shift sign-up — the same vol_applications row an ordinary
 * sign-up creates — so they appear in My shifts, can check in with the QR code
 * and earn hours. The reservation already holds the places, so the sign-up
 * consumes a reserved place instead of being refused as "full", and a member
 * is never counted twice (once as a reserved place, once as a sign-up).
 *
 * Nobody used to be told: the member now gets a bell and an email in their own
 * language, can leave by themselves, and the leader hears when they do.
 */
class GroupSignUpMembershipTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode(['volunteering' => true, 'organisations' => true, 'groups' => true]),
        ]);
        TenantContext::setById($this->testTenantId);
    }

    public function test_adding_a_member_creates_a_real_shift_sign_up_and_tells_them_in_their_language(): void
    {
        $fixture = $this->publicShift(5);
        $leader = $this->user(['name' => 'Lena Leader', 'first_name' => 'Lena', 'last_name' => 'Leader']);
        // German: one of the locales the test bootstrap loads (app.test_translation_locales).
        $member = $this->user(['name' => 'Max Mitglied', 'first_name' => 'Max', 'last_name' => 'Mitglied', 'preferred_language' => 'de']);
        $groupId = $this->group($leader, 'Les Jardiniers');
        $reservationId = $this->reservation($fixture['shiftId'], $groupId, (int) $leader->id, 3);

        $this->assertTrue(
            ShiftGroupReservationService::addMember($reservationId, (int) $member->id, (int) $leader->id),
            json_encode(ShiftGroupReservationService::getErrors())
        );

        // The same row an ordinary sign-up creates: an approved application on the shift.
        $application = DB::table('vol_applications')
            ->where('opportunity_id', $fixture['oppId'])->where('user_id', $member->id)->where('tenant_id', $this->testTenantId)
            ->get();
        $this->assertCount(1, $application);
        $this->assertSame('approved', $application[0]->status);
        $this->assertSame($fixture['shiftId'], (int) $application[0]->shift_id);
        $this->assertSame(1, (int) DB::table('vol_shift_group_reservations')->where('id', $reservationId)->value('filled_slots'));

        // ...so the check-in code (which reads vol_applications) can issue them a QR token.
        TenantContext::setById($this->testTenantId);
        $this->assertNotNull(VolunteerCheckInService::generateToken($fixture['shiftId'], (int) $member->id));

        // The member is told — bell + email — in THEIR language (de), not the leader's (en).
        $bell = DB::table('notifications')->where('user_id', $member->id)->where('type', 'vol_group_signup_added')->first();
        $this->assertNotNull($bell, 'the member gets a bell');
        $this->assertStringContainsString('Lena Leader', $bell->message);
        $this->assertStringContainsString('Les Jardiniers', $bell->message);
        $this->assertStringContainsString('hat Sie zur Gruppe', $bell->message);
        $queued = DB::table('notification_queue')->where('user_id', $member->id)->where('activity_type', 'vol_group_signup_added')->first();
        $this->assertNotNull($queued, 'the member gets an email');
        $this->assertSame('instant', $queued->frequency);
        $this->assertStringContainsString('Les Jardiniers', (string) $queued->email_body);
        $this->assertStringContainsString('Lena Leader', (string) $queued->email_body);
    }

    public function test_reserved_places_and_ordinary_sign_ups_are_not_double_counted(): void
    {
        $fixture = $this->publicShift(5);
        $leader = $this->user();
        $groupId = $this->group($leader);
        $reservationId = $this->reservation($fixture['shiftId'], $groupId, (int) $leader->id, 3);

        $memberA = $this->user();
        $memberB = $this->user();
        $this->assertTrue(ShiftGroupReservationService::addMember($reservationId, (int) $memberA->id, (int) $leader->id), json_encode(ShiftGroupReservationService::getErrors()));
        $this->assertTrue(ShiftGroupReservationService::addMember($reservationId, (int) $memberB->id, (int) $leader->id), json_encode(ShiftGroupReservationService::getErrors()));

        // 5 places, 3 reserved (2 of them now filled): two ordinary volunteers still fit...
        $this->assertSame(2, VolunteerShiftCapacityService::availableSlots($fixture['shiftId'], $this->testTenantId, 5));
        $ordinary1 = $this->user();
        $ordinary2 = $this->user();
        $ordinary3 = $this->user();
        foreach ([$ordinary1, $ordinary2, $ordinary3] as $volunteer) {
            $this->approvedApplication($fixture['oppId'], (int) $volunteer->id);
        }
        TenantContext::setById($this->testTenantId);
        $this->assertTrue(VolunteerService::signUpForShift($fixture['shiftId'], (int) $ordinary1->id), json_encode(VolunteerService::getErrors()));
        $this->assertTrue(VolunteerService::signUpForShift($fixture['shiftId'], (int) $ordinary2->id), json_encode(VolunteerService::getErrors()));
        // ...and the third is refused: 3 reserved + 2 ordinary = 5.
        $this->assertFalse(VolunteerService::signUpForShift($fixture['shiftId'], (int) $ordinary3->id));
        $this->assertSame('VALIDATION_ERROR', VolunteerService::getErrors()[0]['code'] ?? null);
        $this->assertSame(0, VolunteerShiftCapacityService::availableSlots($fixture['shiftId'], $this->testTenantId, 5));

        // The shift is full for ordinary volunteers, but the group still holds its
        // third place, so the leader can still fill it.
        $memberC = $this->user();
        $this->assertTrue(ShiftGroupReservationService::addMember($reservationId, (int) $memberC->id, (int) $leader->id), json_encode(ShiftGroupReservationService::getErrors()));
        $this->assertSame(0, VolunteerShiftCapacityService::availableSlots($fixture['shiftId'], $this->testTenantId, 5));

        // The public shift list agrees with the capacity service.
        $shifts = VolunteerService::getShiftsForOpportunity($fixture['oppId']);
        $this->assertSame(0, $shifts[0]['spots_available']);
        $this->assertSame(2, $shifts[0]['signup_count'], 'group members are not listed as ordinary sign-ups');
        $this->assertSame(3, $shifts[0]['reserved_count']);
    }

    public function test_a_member_who_already_signed_up_is_not_duplicated_and_a_declined_applicant_is_refused(): void
    {
        $fixture = $this->publicShift(5);
        $leader = $this->user();
        $groupId = $this->group($leader);
        $reservationId = $this->reservation($fixture['shiftId'], $groupId, (int) $leader->id, 3);

        $alreadySignedUp = $this->user();
        $this->approvedApplication($fixture['oppId'], (int) $alreadySignedUp->id, $fixture['shiftId']);
        $this->assertTrue(ShiftGroupReservationService::addMember($reservationId, (int) $alreadySignedUp->id, (int) $leader->id), json_encode(ShiftGroupReservationService::getErrors()));
        $this->assertSame(1, DB::table('vol_applications')->where('user_id', $alreadySignedUp->id)->where('opportunity_id', $fixture['oppId'])->count());
        // Counted once, through the reservation: 5 - 3 reserved = 2, not 1.
        $this->assertSame(2, VolunteerShiftCapacityService::availableSlots($fixture['shiftId'], $this->testTenantId, 5));

        $declined = $this->user();
        DB::table('vol_applications')->insert([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $fixture['oppId'],
            'user_id' => $declined->id,
            'status' => 'declined',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        TenantContext::setById($this->testTenantId);
        $this->assertFalse(ShiftGroupReservationService::addMember($reservationId, (int) $declined->id, (int) $leader->id));
        $this->assertSame('VALIDATION_ERROR', ShiftGroupReservationService::getErrors()[0]['code']);
        $this->assertSame(0, DB::table('vol_shift_group_members')->where('reservation_id', $reservationId)->where('user_id', $declined->id)->count());
    }

    public function test_removing_a_member_cancels_their_sign_up_and_tells_them(): void
    {
        $fixture = $this->publicShift(5);
        $leader = $this->user();
        $member = $this->user();
        $groupId = $this->group($leader);
        $reservationId = $this->reservation($fixture['shiftId'], $groupId, (int) $leader->id, 3);
        $this->assertTrue(ShiftGroupReservationService::addMember($reservationId, (int) $member->id, (int) $leader->id), json_encode(ShiftGroupReservationService::getErrors()));

        $this->assertTrue(ShiftGroupReservationService::removeMember($reservationId, (int) $member->id, (int) $leader->id), json_encode(ShiftGroupReservationService::getErrors()));

        $this->assertNull(DB::table('vol_applications')->where('user_id', $member->id)->where('opportunity_id', $fixture['oppId'])->value('shift_id'));
        $this->assertSame('cancelled', DB::table('vol_shift_group_members')->where('reservation_id', $reservationId)->where('user_id', $member->id)->value('status'));
        $this->assertSame(0, (int) DB::table('vol_shift_group_reservations')->where('id', $reservationId)->value('filled_slots'));
        $this->assertDatabaseHas('notifications', ['user_id' => $member->id, 'type' => 'vol_group_signup_removed']);

        // Only confirmed members are listed to the group.
        $mine = ShiftGroupReservationService::getUserReservations((int) $leader->id, $this->testTenantId);
        $this->assertCount(1, $mine);
        $this->assertSame([], $mine[0]['members']);
        $this->assertSame('active', $mine[0]['status']);
    }

    public function test_a_member_can_leave_through_the_api_and_the_leader_is_told(): void
    {
        $fixture = $this->publicShift(5);
        $leader = $this->user();
        $member = $this->user(['name' => 'Molly Member', 'first_name' => 'Molly', 'last_name' => 'Member']);
        $bystander = $this->user();
        $groupId = $this->group($leader);
        $reservationId = $this->reservation($fixture['shiftId'], $groupId, (int) $leader->id, 3);
        $this->assertTrue(ShiftGroupReservationService::addMember($reservationId, (int) $member->id, (int) $leader->id), json_encode(ShiftGroupReservationService::getErrors()));

        // Someone else cannot remove the member.
        Sanctum::actingAs($bystander);
        $this->apiDelete("/v2/volunteering/group-reservations/{$reservationId}/members/{$member->id}")->assertStatus(403);
        $this->assertSame('confirmed', DB::table('vol_shift_group_members')->where('reservation_id', $reservationId)->where('user_id', $member->id)->value('status'));

        // The member can remove THEMSELVES, and their sign-up goes with them.
        Sanctum::actingAs($member);
        $this->apiDelete("/v2/volunteering/group-reservations/{$reservationId}/members/{$member->id}")->assertStatus(204);
        $this->assertSame('cancelled', DB::table('vol_shift_group_members')->where('reservation_id', $reservationId)->where('user_id', $member->id)->value('status'));
        $this->assertNull(DB::table('vol_applications')->where('user_id', $member->id)->where('opportunity_id', $fixture['oppId'])->value('shift_id'));

        $bell = DB::table('notifications')->where('user_id', $leader->id)->where('type', 'vol_group_signup_left')->first();
        $this->assertNotNull($bell, 'the leader is told');
        $this->assertStringContainsString('Molly Member', $bell->message);
    }

    public function test_cancelling_the_reservation_cancels_every_members_sign_up(): void
    {
        $fixture = $this->publicShift(5);
        $leader = $this->user();
        $memberA = $this->user();
        $memberB = $this->user();
        $groupId = $this->group($leader);
        $reservationId = $this->reservation($fixture['shiftId'], $groupId, (int) $leader->id, 3);
        $this->assertTrue(ShiftGroupReservationService::addMember($reservationId, (int) $memberA->id, (int) $leader->id), json_encode(ShiftGroupReservationService::getErrors()));
        $this->assertTrue(ShiftGroupReservationService::addMember($reservationId, (int) $memberB->id, (int) $leader->id), json_encode(ShiftGroupReservationService::getErrors()));
        $this->assertSame(2, VolunteerShiftCapacityService::availableSlots($fixture['shiftId'], $this->testTenantId, 5));

        $this->assertTrue(ShiftGroupReservationService::cancelReservation($reservationId, (int) $leader->id), json_encode(ShiftGroupReservationService::getErrors()));

        $this->assertSame('cancelled', DB::table('vol_shift_group_reservations')->where('id', $reservationId)->value('status'));
        foreach ([$memberA, $memberB] as $member) {
            $this->assertNull(DB::table('vol_applications')->where('user_id', $member->id)->where('opportunity_id', $fixture['oppId'])->value('shift_id'));
            $this->assertDatabaseHas('notifications', ['user_id' => $member->id, 'type' => 'vol_group_signup_cancelled']);
        }
        // Every place is free again.
        $this->assertSame(5, VolunteerShiftCapacityService::availableSlots($fixture['shiftId'], $this->testTenantId, 5));
    }

    // ── fixtures ──────────────────────────────────────────────────────────────

    private function user(array $attributes = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create($attributes + [
            'status' => 'active',
            'is_approved' => true,
            'preferred_language' => 'en',
        ]);
        // User::factory() drifts TenantContext to tenant 1 — re-pin it.
        TenantContext::setById($this->testTenantId);

        return $user;
    }

    /** @return array{owner: User, orgId: int, oppId: int, shiftId: int} */
    private function publicShift(int $capacity): array
    {
        $owner = $this->user();
        $orgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'name' => 'Group Sign-up Org',
            'status' => 'approved',
            'created_at' => now(),
        ]);
        $oppId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $orgId,
            'title' => 'Riverbank Clean-up',
            'description' => 'Test',
            'status' => 'active',
            'is_active' => 1,
            'created_by' => $owner->id,
            'created_at' => now(),
        ]);
        $shiftId = (int) DB::table('vol_shifts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $oppId,
            'start_time' => now()->addDays(3)->setTime(10, 0),
            'end_time' => now()->addDays(3)->setTime(13, 0),
            'capacity' => $capacity,
        ]);

        return ['owner' => $owner, 'orgId' => $orgId, 'oppId' => $oppId, 'shiftId' => $shiftId];
    }

    private function group(User $owner, string $name = 'Group Sign-up Team'): int
    {
        return (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $owner->id,
            'creator_id' => $owner->id,
            'name' => $name,
            'slug' => 'group-signup-team-' . uniqid(),
            'visibility' => 'public',
            'status' => 'active',
            'is_active' => 1,
            'created_at' => now(),
        ]);
    }

    private function reservation(int $shiftId, int $groupId, int $leaderId, int $slots): int
    {
        return (int) DB::table('vol_shift_group_reservations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'shift_id' => $shiftId,
            'group_id' => $groupId,
            'reserved_slots' => $slots,
            'filled_slots' => 0,
            'reserved_by' => $leaderId,
            'status' => 'active',
            'created_at' => now(),
        ]);
    }

    private function approvedApplication(int $oppId, int $userId, ?int $shiftId = null): int
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
}
