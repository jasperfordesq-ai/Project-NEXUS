<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Volunteering;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Who is on a shift, and who turned up.
 *
 * Until 2026-10-06 an organiser saw only "1 of 2 places taken": no names, and
 * no attendance on any screen (gap A1 of the volunteering journey walk). The
 * roster lists the volunteers placed on the shift with their check-in state,
 * the group bookings with their members, and the waitlist — to the people who
 * may manage the opportunity and nobody else.
 */
class VolunteerShiftRosterTest extends TestCase
{
    use DatabaseTransactions;

    private function enableVolunteering(): void
    {
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode(['volunteering' => true, 'organisations' => true]),
        ]);
        TenantContext::setById($this->testTenantId);
    }

    private function member(array $overrides = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));
    }

    /** @return array{0: int, 1: int, 2: int} [organisationId, opportunityId, shiftId] */
    private function opportunityWithShift(User $owner, string $startsIn = '+3 days'): array
    {
        $orgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'name' => 'Roster fixture organisation',
            'slug' => 'roster-fixture-org-' . uniqid(),
            'status' => 'approved',
            'created_at' => now(),
        ]);
        $oppId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $orgId,
            'created_by' => $owner->id,
            'title' => 'Roster fixture opportunity',
            'description' => 'Has one shift.',
            'is_active' => 1,
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $start = new \DateTimeImmutable($startsIn);
        $shiftId = (int) DB::table('vol_shifts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $oppId,
            'start_time' => $start->format('Y-m-d 10:00:00'),
            'end_time' => $start->format('Y-m-d 12:00:00'),
            'capacity' => 5,
            'created_at' => now(),
        ]);

        return [$orgId, $oppId, $shiftId];
    }

    private function placeOnShift(User $volunteer, int $oppId, int $shiftId, string $status = 'approved'): void
    {
        DB::table('vol_applications')->insert([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $oppId,
            'shift_id' => $shiftId,
            'user_id' => $volunteer->id,
            'status' => $status,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function checkIn(User $volunteer, int $shiftId, string $status): void
    {
        DB::table('vol_shift_checkins')->insert([
            'tenant_id' => $this->testTenantId,
            'shift_id' => $shiftId,
            'user_id' => $volunteer->id,
            'qr_token' => bin2hex(random_bytes(16)),
            'status' => $status,
            'checked_in_at' => in_array($status, ['checked_in', 'checked_out'], true) ? now() : null,
            'checked_out_at' => $status === 'checked_out' ? now() : null,
            'created_at' => now(),
        ]);
    }

    public function test_the_organiser_sees_who_is_on_the_shift_and_who_checked_in(): void
    {
        $this->enableVolunteering();
        $owner = $this->member();
        [, $oppId, $shiftId] = $this->opportunityWithShift($owner, '-1 day');
        $arrived = $this->member(['first_name' => 'Ada', 'last_name' => 'Arrived', 'name' => 'Ada Arrived']);
        $missing = $this->member(['first_name' => 'Bo', 'last_name' => 'Absent', 'name' => 'Bo Absent']);
        $pending = $this->member(['first_name' => 'Cy', 'last_name' => 'Pending', 'name' => 'Cy Pending']);
        $this->placeOnShift($arrived, $oppId, $shiftId);
        $this->placeOnShift($missing, $oppId, $shiftId);
        $this->placeOnShift($pending, $oppId, $shiftId, 'pending');
        $this->checkIn($arrived, $shiftId, 'checked_in');
        $this->checkIn($missing, $shiftId, 'no_show');

        Sanctum::actingAs($owner, ['*']);
        $response = $this->apiGet("/v2/volunteering/shifts/{$shiftId}/roster")->assertOk();

        $volunteers = collect($response->json('data.volunteers'));
        $this->assertCount(2, $volunteers, 'only volunteers approved onto the shift are listed');
        $this->assertSame('checked_in', $volunteers->firstWhere('user.id', $arrived->id)['check_in_status']);
        $this->assertNotNull($volunteers->firstWhere('user.id', $arrived->id)['checked_in_at']);
        $this->assertSame('no_show', $volunteers->firstWhere('user.id', $missing->id)['check_in_status']);
        $this->assertNull($volunteers->firstWhere('user.id', $pending->id));

        $this->assertSame(1, $response->json('data.summary.checked_in'));
        $this->assertSame(2, $response->json('data.summary.signed_up'));
    }

    public function test_a_volunteer_with_no_check_in_row_shows_as_not_yet(): void
    {
        $this->enableVolunteering();
        $owner = $this->member();
        [, $oppId, $shiftId] = $this->opportunityWithShift($owner);
        $volunteer = $this->member();
        $this->placeOnShift($volunteer, $oppId, $shiftId);

        Sanctum::actingAs($owner, ['*']);
        $this->apiGet("/v2/volunteering/shifts/{$shiftId}/roster")
            ->assertOk()
            ->assertJsonPath('data.volunteers.0.user.id', $volunteer->id)
            ->assertJsonPath('data.volunteers.0.check_in_status', null);
    }

    public function test_group_bookings_and_the_waitlist_are_listed(): void
    {
        $this->enableVolunteering();
        $owner = $this->member();
        [, , $shiftId] = $this->opportunityWithShift($owner);
        $leader = $this->member(['name' => 'Gina Leader']);
        $groupMember = $this->member(['name' => 'Gus Member']);
        $waiting = $this->member(['name' => 'Wes Waiting']);

        $groupId = (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $leader->id,
            'name' => 'Roster Rovers',
            'created_at' => now(),
        ]);
        $reservationId = (int) DB::table('vol_shift_group_reservations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'shift_id' => $shiftId,
            'group_id' => $groupId,
            'reserved_slots' => 3,
            'filled_slots' => 1,
            'reserved_by' => $leader->id,
            'status' => 'active',
        ]);
        DB::table('vol_shift_group_members')->insert([
            'reservation_id' => $reservationId,
            'tenant_id' => $this->testTenantId,
            'user_id' => $groupMember->id,
            'status' => 'confirmed',
        ]);
        DB::table('vol_shift_waitlist')->insert([
            'tenant_id' => $this->testTenantId,
            'shift_id' => $shiftId,
            'user_id' => $waiting->id,
            'position' => 1,
            'status' => 'waiting',
        ]);

        Sanctum::actingAs($owner, ['*']);
        $response = $this->apiGet("/v2/volunteering/shifts/{$shiftId}/roster")->assertOk();

        $this->assertSame('Roster Rovers', $response->json('data.groups.0.group_name'));
        $this->assertSame(3, $response->json('data.groups.0.reserved_slots'));
        $this->assertSame($leader->id, $response->json('data.groups.0.leader.id'));
        $this->assertSame($groupMember->id, $response->json('data.groups.0.members.0.id'));
        $this->assertSame($waiting->id, $response->json('data.waitlist.0.user.id'));
        $this->assertSame(1, $response->json('data.waitlist.0.position'));
    }

    public function test_a_community_admin_can_see_any_roster(): void
    {
        $this->enableVolunteering();
        [, , $shiftId] = $this->opportunityWithShift($this->member());

        Sanctum::actingAs($this->member(['role' => 'admin']), ['*']);
        $this->apiGet("/v2/volunteering/shifts/{$shiftId}/roster")->assertOk();
    }

    public function test_a_volunteer_on_the_shift_cannot_see_the_roster(): void
    {
        $this->enableVolunteering();
        $owner = $this->member();
        [, $oppId, $shiftId] = $this->opportunityWithShift($owner);
        $volunteer = $this->member();
        $this->placeOnShift($volunteer, $oppId, $shiftId);

        Sanctum::actingAs($volunteer, ['*']);
        $this->apiGet("/v2/volunteering/shifts/{$shiftId}/roster")->assertForbidden();
    }

    public function test_an_unknown_shift_is_not_found(): void
    {
        $this->enableVolunteering();
        Sanctum::actingAs($this->member(['role' => 'admin']), ['*']);

        $this->apiGet('/v2/volunteering/shifts/999999999/roster')->assertNotFound();
    }

    public function test_another_communitys_shift_is_not_found(): void
    {
        $this->enableVolunteering();
        $owner = $this->member();
        [, , $shiftId] = $this->opportunityWithShift($owner);
        DB::table('vol_shifts')->where('id', $shiftId)->update(['tenant_id' => 999]);

        Sanctum::actingAs($owner, ['*']);
        $this->apiGet("/v2/volunteering/shifts/{$shiftId}/roster")->assertNotFound();
    }
}
