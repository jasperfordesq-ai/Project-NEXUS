<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E065;

use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\Models\User;
use App\Services\BlockUserService;
use App\Services\ShiftSwapService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-369 (E-065) — volunteer shift swaps applied the safeguarding contact policy
 * and no block check, so a blocked volunteer could address a swap request, with
 * a free-text message, at the specific volunteer who had blocked them.
 *
 * E-065 rated this `suspected` (read and classified, not driven). This test
 * drives it: both volunteers on approved shifts of the same opportunity, with a
 * live block between them.
 */
class F369ShiftSwapBlockCheckTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        $this->app['auth']->forgetGuards();
        Cache::flush();
        TenantContext::setById($this->testTenantId);
    }

    /** @param array<string,mixed> $overrides */
    private function member(array $overrides = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'onboarding_completed' => true,
            'role' => 'member',
        ], $overrides));
    }

    /** @return array{0:int,1:int,2:int} */
    private function opportunityWithTwoShifts(string $title): array
    {
        $opportunityId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'organization_id' => null,
            'title' => $title,
            'description' => 'Two shifts, one volunteer each.',
            'is_active' => 1,
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $shiftA = (int) DB::table('vol_shifts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $opportunityId,
            'start_time' => now()->addDays(7),
            'end_time' => now()->addDays(7)->addHours(2),
            'capacity' => 1,
            'created_at' => now(),
        ]);
        $shiftB = (int) DB::table('vol_shifts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $opportunityId,
            'start_time' => now()->addDays(9),
            'end_time' => now()->addDays(9)->addHours(2),
            'capacity' => 1,
            'created_at' => now(),
        ]);

        return [$opportunityId, $shiftA, $shiftB];
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

    public function test_a_blocked_volunteer_cannot_address_a_swap_request_at_the_blocker(): void
    {
        [$opportunityId, $shiftA, $shiftB] = $this->opportunityWithTwoShifts('F369 swap opportunity');
        $attacker = $this->member();
        $victim = $this->member();
        $this->approveOnShift((int) $attacker->id, $opportunityId, $shiftA);
        $this->approveOnShift((int) $victim->id, $opportunityId, $shiftB);

        BlockUserService::block((int) $victim->id, (int) $attacker->id, 'F369 harassment');
        $this->assertTrue(
            BlockUserService::isBlockedEither((int) $attacker->id, (int) $victim->id),
            'precondition: the block is live'
        );

        $threw = false;
        try {
            ShiftSwapService::requestSwap((int) $attacker->id, [
                'from_shift_id' => $shiftA,
                'to_shift_id' => $shiftB,
                'message' => 'F369 unwanted swap message reaching the member who blocked me',
            ]);
        } catch (SafeguardingPolicyException $e) {
            $threw = true;
            $this->assertSame('BLOCKED', $e->reasonCode);
        }

        $this->assertTrue($threw, 'the swap request must be refused');
        $this->assertFalse(
            DB::table('vol_shift_swap_requests')
                ->where('tenant_id', $this->testTenantId)
                ->where('from_user_id', $attacker->id)
                ->where('to_user_id', $victim->id)
                ->exists(),
            'no swap request row addressed at the blocker may be written'
        );
    }

    public function test_the_block_is_real_and_an_unblocked_swap_request_still_works(): void
    {
        // Control 1 — the same fixture block DOES stop the canonical check.
        $attacker = $this->member();
        $victim = $this->member();
        BlockUserService::block((int) $victim->id, (int) $attacker->id, 'F369 harassment');

        $refused = false;
        try {
            BlockUserService::assertNoBlockBetween((int) $attacker->id, (int) $victim->id);
        } catch (SafeguardingPolicyException $e) {
            $refused = true;
            $this->assertSame('BLOCKED', $e->reasonCode);
        }
        $this->assertTrue($refused, 'CONTROL: the canonical block check refuses this pair');

        // Control 2 — no block, same call shape.
        [$opportunityId, $shiftA, $shiftB] = $this->opportunityWithTwoShifts('F369 control opportunity');
        $asker = $this->member();
        $holder = $this->member();
        $this->approveOnShift((int) $asker->id, $opportunityId, $shiftA);
        $this->approveOnShift((int) $holder->id, $opportunityId, $shiftB);

        $swapId = ShiftSwapService::requestSwap((int) $asker->id, [
            'from_shift_id' => $shiftA,
            'to_shift_id' => $shiftB,
            'message' => 'F369 ordinary swap request',
        ]);

        $this->assertNotNull(
            $swapId,
            'CONTROL: an ordinary swap request still works: ' . json_encode(ShiftSwapService::getErrors())
        );
        $this->assertTrue(
            DB::table('vol_shift_swap_requests')
                ->where('id', $swapId)
                ->where('from_user_id', $asker->id)
                ->where('to_user_id', $holder->id)
                ->exists(),
            'CONTROL: the rightful swap request row is written'
        );
    }
}
