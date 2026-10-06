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
 * Organisers and admins creating, changing and removing one-off shifts.
 *
 * Until 2026-10-06 no screen and no endpoint could create a single shift, so
 * every shift feature was unreachable for a real organisation. These tests pin
 * who may do it, what is refused, and what happens to the volunteers on a shift
 * that is removed.
 */
class VolunteerShiftManagementTest extends TestCase
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

    /** @return array{0: int, 1: int} [organisationId, opportunityId] */
    private function makeOpportunityOwnedBy(User $owner): array
    {
        $orgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'name' => 'Shift fixture organisation',
            'slug' => 'shift-fixture-org-' . uniqid(),
            'description' => 'Owns one opportunity.',
            'status' => 'approved',
            'created_at' => now(),
        ]);
        $oppId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $orgId,
            'created_by' => $owner->id,
            'title' => 'Shift fixture opportunity',
            'description' => 'Needs shifts.',
            'is_active' => 1,
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return [$orgId, $oppId];
    }

    private function makeShift(int $oppId, string $start, string $end, ?int $capacity = 3): int
    {
        return (int) DB::table('vol_shifts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $oppId,
            'start_time' => $start,
            'end_time' => $end,
            'capacity' => $capacity,
            'created_at' => now(),
        ]);
    }

    private function approveOnShift(int $userId, int $oppId, int $shiftId): int
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

    public function test_the_organisation_owner_can_create_a_one_off_shift(): void
    {
        $this->enableVolunteering();
        $owner = $this->member();
        [, $oppId] = $this->makeOpportunityOwnedBy($owner);
        Sanctum::actingAs($owner, ['*']);

        $start = now()->addDays(3)->setTime(10, 0)->format('Y-m-d H:i:s');
        $end = now()->addDays(3)->setTime(13, 0)->format('Y-m-d H:i:s');

        $response = $this->apiPost("/v2/volunteering/opportunities/{$oppId}/shifts", [
            'start_time' => $start,
            'end_time' => $end,
            'capacity' => 4,
        ])->assertCreated();

        $shiftId = (int) $response->json('data.id');
        $this->assertGreaterThan(0, $shiftId);
        $this->assertSame(4, $response->json('data.capacity'));
        $this->assertSame(0, $response->json('data.signup_count'));
        $this->assertSame(4, $response->json('data.spots_available'));
        $this->assertNull($response->json('data.recurring_pattern_id'));

        $row = DB::table('vol_shifts')->where('id', $shiftId)->first();
        $this->assertSame($this->testTenantId, (int) $row->tenant_id);
        $this->assertSame($oppId, (int) $row->opportunity_id);
        $this->assertSame($start, (string) $row->start_time);
        $this->assertSame($end, (string) $row->end_time);
    }

    public function test_a_community_admin_can_create_a_shift_on_any_opportunity(): void
    {
        $this->enableVolunteering();
        $owner = $this->member();
        [, $oppId] = $this->makeOpportunityOwnedBy($owner);
        $admin = $this->member(['role' => 'admin']);
        Sanctum::actingAs($admin, ['*']);

        $this->apiPost("/v2/volunteering/opportunities/{$oppId}/shifts", [
            'start_time' => now()->addDays(2)->setTime(9, 0)->format('Y-m-d H:i:s'),
            'end_time' => now()->addDays(2)->setTime(11, 0)->format('Y-m-d H:i:s'),
        ])->assertCreated()
            ->assertJsonPath('data.capacity', null)
            ->assertJsonPath('data.spots_available', null);
    }

    public function test_an_ordinary_member_is_refused(): void
    {
        $this->enableVolunteering();
        $owner = $this->member();
        [, $oppId] = $this->makeOpportunityOwnedBy($owner);
        $stranger = $this->member();
        Sanctum::actingAs($stranger, ['*']);

        $this->apiPost("/v2/volunteering/opportunities/{$oppId}/shifts", [
            'start_time' => now()->addDays(2)->setTime(9, 0)->format('Y-m-d H:i:s'),
            'end_time' => now()->addDays(2)->setTime(11, 0)->format('Y-m-d H:i:s'),
        ])->assertStatus(403);

        $this->assertSame(0, DB::table('vol_shifts')->where('opportunity_id', $oppId)->count());
    }

    public function test_creating_a_shift_requires_sign_in(): void
    {
        $this->enableVolunteering();
        $this->apiPost('/v2/volunteering/opportunities/1/shifts', [])->assertStatus(401);
    }

    public function test_a_shift_must_end_after_it_starts_and_start_in_the_future(): void
    {
        $this->enableVolunteering();
        $owner = $this->member();
        [, $oppId] = $this->makeOpportunityOwnedBy($owner);
        Sanctum::actingAs($owner, ['*']);

        $this->apiPost("/v2/volunteering/opportunities/{$oppId}/shifts", [
            'start_time' => now()->addDays(2)->setTime(12, 0)->format('Y-m-d H:i:s'),
            'end_time' => now()->addDays(2)->setTime(10, 0)->format('Y-m-d H:i:s'),
        ])->assertStatus(400)->assertJsonPath('errors.0.field', 'end_time');

        $this->apiPost("/v2/volunteering/opportunities/{$oppId}/shifts", [
            'start_time' => now()->subDay()->format('Y-m-d H:i:s'),
            'end_time' => now()->subDay()->addHours(2)->format('Y-m-d H:i:s'),
        ])->assertStatus(400)->assertJsonPath('errors.0.field', 'start_time');

        $this->apiPost("/v2/volunteering/opportunities/{$oppId}/shifts", [
            'start_time' => 'not a date',
            'end_time' => now()->addDays(2)->format('Y-m-d H:i:s'),
        ])->assertStatus(400)->assertJsonPath('errors.0.field', 'start_time');

        $this->apiPost("/v2/volunteering/opportunities/{$oppId}/shifts", [
            'start_time' => now()->addDays(2)->setTime(9, 0)->format('Y-m-d H:i:s'),
            'end_time' => now()->addDays(2)->setTime(11, 0)->format('Y-m-d H:i:s'),
            'capacity' => 0,
        ])->assertStatus(400)->assertJsonPath('errors.0.field', 'capacity');

        $this->assertSame(0, DB::table('vol_shifts')->where('opportunity_id', $oppId)->count());
    }

    public function test_a_shift_can_be_moved_but_not_shrunk_below_the_volunteers_on_it(): void
    {
        $this->enableVolunteering();
        $owner = $this->member();
        [, $oppId] = $this->makeOpportunityOwnedBy($owner);
        $shiftId = $this->makeShift(
            $oppId,
            now()->addDays(4)->setTime(10, 0)->format('Y-m-d H:i:s'),
            now()->addDays(4)->setTime(12, 0)->format('Y-m-d H:i:s'),
            3,
        );
        $this->approveOnShift($this->member()->id, $oppId, $shiftId);
        $this->approveOnShift($this->member()->id, $oppId, $shiftId);
        Sanctum::actingAs($owner, ['*']);

        // Two volunteers hold places: one place is refused, two is fine.
        $this->apiPut("/v2/volunteering/shifts/{$shiftId}", ['capacity' => 1])
            ->assertStatus(400)
            ->assertJsonPath('errors.0.field', 'capacity');

        $newStart = now()->addDays(5)->setTime(14, 0)->format('Y-m-d H:i:s');
        $newEnd = now()->addDays(5)->setTime(16, 30)->format('Y-m-d H:i:s');
        $this->apiPut("/v2/volunteering/shifts/{$shiftId}", [
            'start_time' => $newStart,
            'end_time' => $newEnd,
            'capacity' => 2,
        ])->assertOk()
            ->assertJsonPath('data.capacity', 2)
            ->assertJsonPath('data.signup_count', 2)
            ->assertJsonPath('data.spots_available', 0);

        $row = DB::table('vol_shifts')->where('id', $shiftId)->first();
        $this->assertSame($newStart, (string) $row->start_time);
        $this->assertSame($newEnd, (string) $row->end_time);
        $this->assertSame(2, (int) $row->capacity);
    }

    public function test_a_shift_that_has_started_cannot_be_changed_or_removed(): void
    {
        $this->enableVolunteering();
        $owner = $this->member();
        [, $oppId] = $this->makeOpportunityOwnedBy($owner);
        $shiftId = $this->makeShift(
            $oppId,
            now()->subHour()->format('Y-m-d H:i:s'),
            now()->addHours(2)->format('Y-m-d H:i:s'),
        );
        Sanctum::actingAs($owner, ['*']);

        $this->apiPut("/v2/volunteering/shifts/{$shiftId}", ['capacity' => 9])->assertStatus(400);
        $this->apiDelete("/v2/volunteering/shifts/{$shiftId}")->assertStatus(400);
        $this->assertNotNull(DB::table('vol_shifts')->where('id', $shiftId)->first());
    }

    public function test_removing_a_shift_keeps_the_volunteers_applications_and_tells_them(): void
    {
        $this->enableVolunteering();
        $owner = $this->member();
        [, $oppId] = $this->makeOpportunityOwnedBy($owner);
        $shiftId = $this->makeShift(
            $oppId,
            now()->addDays(6)->setTime(10, 0)->format('Y-m-d H:i:s'),
            now()->addDays(6)->setTime(12, 0)->format('Y-m-d H:i:s'),
        );
        $volunteer = $this->member(['preferred_language' => 'de']);
        $applicationId = $this->approveOnShift($volunteer->id, $oppId, $shiftId);
        DB::table('vol_shift_waitlist')->insert([
            'tenant_id' => $this->testTenantId,
            'shift_id' => $shiftId,
            'user_id' => $this->member()->id,
            'position' => 1,
            'created_at' => now(),
        ]);
        Sanctum::actingAs($owner, ['*']);

        $this->apiDelete("/v2/volunteering/shifts/{$shiftId}")
            ->assertOk()
            ->assertJsonPath('data.deleted', true)
            ->assertJsonPath('data.affected_volunteers', 1);

        $this->assertNull(DB::table('vol_shifts')->where('id', $shiftId)->first());
        $this->assertSame(0, DB::table('vol_shift_waitlist')->where('shift_id', $shiftId)->count());

        // The volunteer is still approved for the opportunity, just no longer on a shift.
        $application = DB::table('vol_applications')->where('id', $applicationId)->first();
        $this->assertSame('approved', $application->status);
        $this->assertNull($application->shift_id);

        // And they were told, in their own language.
        $notification = DB::table('notifications')
            ->where('user_id', $volunteer->id)
            ->where('type', 'vol_shift_cancelled')
            ->orderByDesc('id')
            ->first();
        $this->assertNotNull($notification, 'the volunteer should have been notified');
        $this->assertStringContainsString('Shift fixture opportunity', (string) $notification->message);
        $this->assertStringContainsString('abgesagt', (string) $notification->message);
    }

    public function test_a_stranger_cannot_change_or_remove_a_shift(): void
    {
        $this->enableVolunteering();
        $owner = $this->member();
        [, $oppId] = $this->makeOpportunityOwnedBy($owner);
        $shiftId = $this->makeShift(
            $oppId,
            now()->addDays(6)->setTime(10, 0)->format('Y-m-d H:i:s'),
            now()->addDays(6)->setTime(12, 0)->format('Y-m-d H:i:s'),
        );
        Sanctum::actingAs($this->member(), ['*']);

        $this->apiPut("/v2/volunteering/shifts/{$shiftId}", ['capacity' => 9])->assertStatus(403);
        $this->apiDelete("/v2/volunteering/shifts/{$shiftId}")->assertStatus(403);
        $this->assertNotNull(DB::table('vol_shifts')->where('id', $shiftId)->first());
    }

    public function test_saving_a_repeating_pattern_creates_its_first_shifts_straight_away(): void
    {
        $this->enableVolunteering();
        $owner = $this->member();
        [, $oppId] = $this->makeOpportunityOwnedBy($owner);
        Sanctum::actingAs($owner, ['*']);

        $response = $this->apiPost("/v2/volunteering/opportunities/{$oppId}/recurring-patterns", [
            'frequency' => 'daily',
            'start_time' => '09:00:00',
            'end_time' => '11:00:00',
            'capacity' => 2,
            'start_date' => now()->addDay()->format('Y-m-d'),
            'max_occurrences' => 3,
        ])->assertCreated();

        $this->assertSame(3, $response->json('data.shifts_generated'));
        $patternId = (int) $response->json('data.id');
        $this->assertSame(3, DB::table('vol_shifts')->where('recurring_pattern_id', $patternId)->count());
    }
}
