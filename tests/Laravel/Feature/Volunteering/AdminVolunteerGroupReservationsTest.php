<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Volunteering;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\ShiftGroupReservationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Group bookings admin page (8 Oct 2026): community admins can see every group
 * reservation on their shifts — who reserved it, how many places, who has been
 * named — and cancel one, which releases the places and the members' sign-ups.
 */
class AdminVolunteerGroupReservationsTest extends TestCase
{
    use DatabaseTransactions;

    private User $leader;
    private User $member;
    private int $oppId;
    private int $shiftId;
    private int $reservationId;

    protected function setUp(): void
    {
        parent::setUp();
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode(['volunteering' => true, 'organisations' => true, 'groups' => true]),
        ]);
        TenantContext::setById($this->testTenantId);

        $owner = $this->user();
        $this->leader = $this->user(['name' => 'Larry Leader', 'first_name' => 'Larry', 'last_name' => 'Leader']);
        $this->member = $this->user(['name' => 'Mina Member', 'first_name' => 'Mina', 'last_name' => 'Member']);

        $orgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'name' => 'Admin Bookings Org',
            'status' => 'approved',
            'created_at' => now(),
        ]);
        $this->oppId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $orgId,
            'title' => 'Beach Litter Pick',
            'description' => 'Test',
            'status' => 'active',
            'is_active' => 1,
            'created_by' => $owner->id,
            'created_at' => now(),
        ]);
        $this->shiftId = (int) DB::table('vol_shifts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $this->oppId,
            'start_time' => now()->addDays(2)->setTime(9, 0),
            'end_time' => now()->addDays(2)->setTime(12, 0),
            'capacity' => 5,
        ]);
        $groupId = (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $this->leader->id,
            'creator_id' => $this->leader->id,
            'name' => 'Sandcastle Crew',
            'slug' => 'sandcastle-crew-' . uniqid(),
            'visibility' => 'public',
            'status' => 'active',
            'is_active' => 1,
            'created_at' => now(),
        ]);
        $this->reservationId = (int) DB::table('vol_shift_group_reservations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'shift_id' => $this->shiftId,
            'group_id' => $groupId,
            'reserved_slots' => 3,
            'filled_slots' => 0,
            'reserved_by' => $this->leader->id,
            'status' => 'active',
            'created_at' => now(),
        ]);
        $this->assertTrue(
            ShiftGroupReservationService::addMember($this->reservationId, (int) $this->member->id, (int) $this->leader->id),
            json_encode(ShiftGroupReservationService::getErrors())
        );
    }

    private function user(array $attributes = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create($attributes + [
            'status' => 'active',
            'is_approved' => true,
            'preferred_language' => 'en',
        ]);
        TenantContext::setById($this->testTenantId);

        return $user;
    }

    private function actAsAdmin(): User
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        return $admin;
    }

    public function test_admin_lists_group_bookings_with_shift_group_leader_and_members(): void
    {
        $this->actAsAdmin();

        $response = $this->apiGet('/v2/admin/volunteering/group-reservations?q=sandcastle')->assertOk();
        $item = collect($response->json('data.items'))->firstWhere('id', $this->reservationId);
        $this->assertNotNull($item);
        $this->assertSame('active', $item['status']);
        $this->assertSame(3, $item['reserved_slots']);
        $this->assertSame(1, $item['filled_slots']);
        $this->assertSame('Sandcastle Crew', $item['group']['name']);
        $this->assertSame((int) $this->leader->id, $item['leader']['id']);
        $this->assertSame('Larry Leader', $item['leader']['name']);
        $this->assertSame($this->shiftId, $item['shift']['id']);
        $this->assertNotEmpty($item['shift']['start_time']);
        $this->assertSame('Beach Litter Pick', $item['opportunity']['title']);
        $this->assertSame('Admin Bookings Org', $item['organization']['name']);
        $this->assertSame([(int) $this->member->id], array_column($item['members'], 'id'));
        $this->assertSame('Mina Member', $item['members'][0]['name']);
        $this->assertGreaterThanOrEqual(1, $response->json('data.counts.active'));

        // Search matches the leader's name too; a wrong word or status finds nothing.
        $this->assertNotNull(collect($this->apiGet('/v2/admin/volunteering/group-reservations?q=larry')->json('data.items'))->firstWhere('id', $this->reservationId));
        $this->assertNull(collect($this->apiGet('/v2/admin/volunteering/group-reservations?q=nobody-by-this-name')->json('data.items'))->firstWhere('id', $this->reservationId));
        $this->assertNull(collect($this->apiGet('/v2/admin/volunteering/group-reservations?status=cancelled')->json('data.items'))->firstWhere('id', $this->reservationId));
    }

    public function test_admin_cancels_a_group_booking_and_the_group_is_told(): void
    {
        $this->actAsAdmin();

        $this->apiDelete("/v2/admin/volunteering/group-reservations/{$this->reservationId}")->assertOk()->assertJsonPath('data.cancelled', true);

        $this->assertSame('cancelled', DB::table('vol_shift_group_reservations')->where('id', $this->reservationId)->value('status'));
        $this->assertSame('cancelled', DB::table('vol_shift_group_members')->where('reservation_id', $this->reservationId)->where('user_id', $this->member->id)->value('status'));
        $this->assertNull(DB::table('vol_applications')->where('user_id', $this->member->id)->where('opportunity_id', $this->oppId)->value('shift_id'));
        $this->assertDatabaseHas('notifications', ['user_id' => $this->member->id, 'type' => 'vol_group_signup_cancelled']);
        $this->assertDatabaseHas('notifications', ['user_id' => $this->leader->id, 'type' => 'vol_group_signup_cancelled']);

        // A second cancel is refused; the booking now shows under "cancelled".
        $this->apiDelete("/v2/admin/volunteering/group-reservations/{$this->reservationId}")->assertStatus(404);
        $cancelled = $this->apiGet('/v2/admin/volunteering/group-reservations?status=cancelled')->json('data');
        $this->assertNotNull(collect($cancelled['items'])->firstWhere('id', $this->reservationId));
        $this->assertGreaterThanOrEqual(1, $cancelled['counts']['cancelled']);
    }

    public function test_another_communitys_booking_is_invisible_and_untouchable(): void
    {
        $this->actAsAdmin();
        $foreignId = (int) DB::table('vol_shift_group_reservations')->insertGetId([
            'tenant_id' => $this->testTenantId + 1,
            'shift_id' => $this->shiftId,
            'group_id' => 999998,
            'reserved_slots' => 1,
            'filled_slots' => 0,
            'reserved_by' => $this->leader->id,
            'status' => 'active',
            'created_at' => now(),
        ]);

        $this->assertNull(collect($this->apiGet('/v2/admin/volunteering/group-reservations')->json('data.items'))->firstWhere('id', $foreignId));
        $this->apiDelete("/v2/admin/volunteering/group-reservations/{$foreignId}")->assertStatus(404);
        $this->assertSame('active', DB::table('vol_shift_group_reservations')->where('id', $foreignId)->value('status'));
    }

    public function test_members_and_leaders_cannot_use_the_admin_endpoints(): void
    {
        Sanctum::actingAs($this->leader);

        $this->apiGet('/v2/admin/volunteering/group-reservations')->assertStatus(403);
        $this->apiDelete("/v2/admin/volunteering/group-reservations/{$this->reservationId}")->assertStatus(403);
        $this->assertSame('active', DB::table('vol_shift_group_reservations')->where('id', $this->reservationId)->value('status'));
    }
}
