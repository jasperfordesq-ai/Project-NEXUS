<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Volunteering;

use App\Models\User;
use App\Services\ShiftSwapService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * A volunteer asking for a swap, without being shown who is on the other shift.
 *
 * 🔴 Until 2026-08-24 nothing on the platform could create a swap request. The endpoint
 * demanded `to_user_id`, and no client could supply it: nothing tells a volunteer who holds
 * which shift, and exposing that is a privacy and safeguarding decision. So the response
 * half worked, the request half existed only as a curl command, and the website's own empty
 * state promised members a page that had never been built (journey 4.17).
 *
 * The counterpart is now resolved server-side from the shift. These tests pin the two
 * properties that matter: the request reaches the right volunteer, and the requester is
 * never told who that is.
 */
class ShiftSwapRequestByShiftTest extends TestCase
{
    use DatabaseTransactions;

    private function makeOpportunityWithTwoShifts(): array
    {
        $orgId = DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'organization_id' => null,
            'title' => 'Swap fixture opportunity',
            'description' => 'Two shifts, one volunteer each.',
            'is_active' => 1,
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $shiftA = DB::table('vol_shifts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $orgId,
            'start_time' => now()->addDays(7),
            'end_time' => now()->addDays(7)->addHours(2),
            'capacity' => 1,
            'created_at' => now(),
        ]);
        $shiftB = DB::table('vol_shifts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $orgId,
            'start_time' => now()->addDays(9),
            'end_time' => now()->addDays(9)->addHours(2),
            'capacity' => 1,
            'created_at' => now(),
        ]);

        return [$orgId, $shiftA, $shiftB];
    }

    private function approveOnShift(int $userId, int $opportunityId, int $shiftId): void
    {
        DB::table('vol_applications')->insert([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $opportunityId,
            'shift_id' => $shiftId,
            'user_id' => $userId,
            'status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_a_swap_can_be_requested_by_shift_alone(): void
    {
        [$opportunityId, $shiftA, $shiftB] = $this->makeOpportunityWithTwoShifts();
        $asker = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $holder = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $this->approveOnShift($asker->id, $opportunityId, $shiftA);
        $this->approveOnShift($holder->id, $opportunityId, $shiftB);

        // No to_user_id — the member picked a shift, not a person.
        $swapId = ShiftSwapService::requestSwap($asker->id, [
            'from_shift_id' => $shiftA,
            'to_shift_id' => $shiftB,
            'message' => 'Away that weekend, could we swap?',
        ]);

        $this->assertNotNull($swapId, 'a swap request should be created: ' . json_encode(ShiftSwapService::getErrors()));
        $row = DB::table('vol_shift_swap_requests')->where('id', $swapId)->first();
        $this->assertSame((int) $asker->id, (int) $row->from_user_id);
        // Addressed to the volunteer who actually holds the shift.
        $this->assertSame((int) $holder->id, (int) $row->to_user_id);
        $this->assertSame($shiftA, (int) $row->from_shift_id);
        $this->assertSame($shiftB, (int) $row->to_shift_id);
        $this->assertSame('pending', $row->status);
    }

    public function test_it_refuses_kindly_when_nobody_is_on_the_other_shift(): void
    {
        [$opportunityId, $shiftA, $shiftB] = $this->makeOpportunityWithTwoShifts();
        $asker = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $this->approveOnShift($asker->id, $opportunityId, $shiftA);
        // Nobody on shift B.

        $swapId = ShiftSwapService::requestSwap($asker->id, [
            'from_shift_id' => $shiftA,
            'to_shift_id' => $shiftB,
        ]);

        $this->assertNull($swapId);
        $errors = ShiftSwapService::getErrors();
        $this->assertSame('VALIDATION_ERROR', $errors[0]['code']);
        // A member-facing sentence, not "to_user_id is required".
        $this->assertStringContainsString('no one to swap with', $errors[0]['message']);
    }

    public function test_it_never_addresses_the_request_back_to_the_asker(): void
    {
        [$opportunityId, $shiftA, $shiftB] = $this->makeOpportunityWithTwoShifts();
        $asker = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $this->approveOnShift($asker->id, $opportunityId, $shiftA);
        // The asker is on BOTH shifts — a real possibility when capacity allows it.
        $this->approveOnShift($asker->id, $opportunityId, $shiftB);

        $swapId = ShiftSwapService::requestSwap($asker->id, [
            'from_shift_id' => $shiftA,
            'to_shift_id' => $shiftB,
        ]);

        // Swapping with yourself is meaningless, and it must not be reported as success.
        $this->assertNull($swapId);
    }

    /**
     * 🔴 Added because a mutation survived: removing the "not me" filter from the resolver
     * left every test green. The self-swap check downstream catches the simple case, so the
     * filter only earns its place here — the asker is on the target shift TOO, alongside
     * someone else, and the request must go to that someone else rather than failing.
     */
    public function test_it_looks_past_the_asker_when_they_are_also_on_the_target_shift(): void
    {
        [$opportunityId, $shiftA, $shiftB] = $this->makeOpportunityWithTwoShifts();
        DB::table('vol_shifts')->where('id', $shiftB)->update(['capacity' => 2]);
        $asker = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $holder = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $this->approveOnShift($asker->id, $opportunityId, $shiftA);
        // The asker's own row on shift B comes FIRST by id, so an unfiltered resolver picks it.
        $this->approveOnShift($asker->id, $opportunityId, $shiftB);
        $this->approveOnShift($holder->id, $opportunityId, $shiftB);

        $swapId = ShiftSwapService::requestSwap($asker->id, [
            'from_shift_id' => $shiftA,
            'to_shift_id' => $shiftB,
        ]);

        $this->assertNotNull($swapId, json_encode(ShiftSwapService::getErrors()));
        $row = DB::table('vol_shift_swap_requests')->where('id', $swapId)->first();
        $this->assertSame((int) $holder->id, (int) $row->to_user_id);
    }

    public function test_it_prefers_a_volunteer_who_has_no_pending_swap_on_that_shift(): void
    {
        [$opportunityId, $shiftA, $shiftB] = $this->makeOpportunityWithTwoShifts();
        DB::table('vol_shifts')->where('id', $shiftB)->update(['capacity' => 3]);
        $asker = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $busyHolder = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $freeHolder = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $this->approveOnShift($asker->id, $opportunityId, $shiftA);
        $this->approveOnShift($busyHolder->id, $opportunityId, $shiftB);
        $this->approveOnShift($freeHolder->id, $opportunityId, $shiftB);

        // Somebody else already asked the first holder. A real member, because the table has
        // a foreign key on from_user_id.
        $otherAsker = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        DB::table('vol_shift_swap_requests')->insert([
            'tenant_id' => $this->testTenantId,
            'from_user_id' => $otherAsker->id,
            'to_user_id' => $busyHolder->id,
            'from_shift_id' => $shiftA,
            'to_shift_id' => $shiftB,
            'status' => 'pending',
            'created_at' => now(),
        ]);

        $swapId = ShiftSwapService::requestSwap($asker->id, [
            'from_shift_id' => $shiftA,
            'to_shift_id' => $shiftB,
        ]);

        $this->assertNotNull($swapId, json_encode(ShiftSwapService::getErrors()));
        $row = DB::table('vol_shift_swap_requests')->where('id', $swapId)->first();
        // Not queued behind the volunteer who already has one pending.
        $this->assertSame((int) $freeHolder->id, (int) $row->to_user_id);
    }

    public function test_an_explicit_to_user_id_still_works(): void
    {
        [$opportunityId, $shiftA, $shiftB] = $this->makeOpportunityWithTwoShifts();
        $asker = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $holder = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $this->approveOnShift($asker->id, $opportunityId, $shiftA);
        $this->approveOnShift($holder->id, $opportunityId, $shiftB);

        $swapId = ShiftSwapService::requestSwap($asker->id, [
            'from_shift_id' => $shiftA,
            'to_shift_id' => $shiftB,
            'to_user_id' => $holder->id,
        ]);

        $this->assertNotNull($swapId, json_encode(ShiftSwapService::getErrors()));
    }
}
