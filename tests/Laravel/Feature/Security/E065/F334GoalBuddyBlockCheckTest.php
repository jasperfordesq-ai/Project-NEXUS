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
use App\Services\GoalService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-334 (E-065) — goal buddy offers are the same forgotten-block-check defect.
 *
 * GoalService::offerBuddy applied the safeguarding contact policy and no block
 * check, so a blocked member could put a pending request on the blocker's goal
 * and bell- and push-notify them with an attacker-chosen display name, ten
 * times a minute (rate limit `goal_buddy` 10/60s).
 *
 * `acceptBuddyRequest` and `createBuddyNote` in the same file were unchecked
 * too, so a stale pending request could still be turned into a live buddy
 * relationship and the buddy's free-text accountability note could still reach
 * a goal owner who had since blocked them. All three are fixed.
 *
 * Adapted from the E-065 slice-H reproduction
 * `.local-docs-archive/security-log/E-065/repro/h/BlockCheckSweepResidualsTest.php`
 * (a "passes while broken" test); the attack assertions are inverted.
 */
class F334GoalBuddyBlockCheckTest extends TestCase
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

    private function publicGoal(int $ownerId, string $title): int
    {
        return (int) DB::table('goals')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'title' => $title,
            'is_public' => 1,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_a_blocked_member_cannot_notify_the_blocker_through_a_goal_buddy_offer(): void
    {
        $attackerName = 'F334 Stop Ignoring Me';
        $attacker = $this->member();
        // The display name is member-editable, so it is attacker-chosen text.
        DB::table('users')->where('id', $attacker->id)->update(['name' => $attackerName]);
        $victim = $this->member();

        BlockUserService::block((int) $victim->id, (int) $attacker->id, 'F334 harassment');

        $goalId = $this->publicGoal((int) $victim->id, 'F334 public goal');

        Sanctum::actingAs($attacker, ['*']);
        $response = $this->apiPost('/v2/goals/' . $goalId . '/buddy', []);

        $this->assertSame(403, $response->status(), 'the buddy offer must be refused: ' . $response->getContent());
        $this->assertSame('BLOCKED', $response->json('errors.0.code'), $response->getContent());

        $this->assertFalse(
            DB::table('goal_buddy_requests')
                ->where('tenant_id', $this->testTenantId)
                ->where('goal_id', $goalId)
                ->where('requester_id', $attacker->id)
                ->exists(),
            'no pending request from the blocked member may sit on the blocker\'s goal'
        );

        $this->assertFalse(
            DB::table('notifications')
                ->where('tenant_id', $this->testTenantId)
                ->where('user_id', $victim->id)
                ->where('type', 'goal_buddy')
                ->exists(),
            'the blocker must not be bell-notified by the member they blocked'
        );
    }

    public function test_a_goal_owner_cannot_accept_a_pending_request_from_someone_they_have_since_blocked(): void
    {
        $requester = $this->member();
        $owner = $this->member();
        $goalId = $this->publicGoal((int) $owner->id, 'F334 accept goal');

        // The offer is made before the block exists.
        $service = app(GoalService::class);
        $offer = $service->offerBuddy($goalId, (int) $requester->id);
        $this->assertNotNull($offer, 'precondition: the unblocked offer is accepted');

        // The owner then blocks the requester.
        BlockUserService::block((int) $owner->id, (int) $requester->id, 'F334 harassment');

        $threw = false;
        try {
            $service->acceptBuddyRequest($goalId, (int) $offer['request_id'], (int) $owner->id);
        } catch (SafeguardingPolicyException $e) {
            $threw = true;
            $this->assertSame('BLOCKED', $e->reasonCode);
        }

        $this->assertTrue($threw, 'accepting a request from a blocked member must be refused');
        $this->assertNull(
            DB::table('goals')->where('id', $goalId)->value('mentor_id'),
            'no buddy relationship may be established between a blocked pair'
        );
    }

    public function test_a_buddy_cannot_send_an_accountability_note_to_an_owner_who_has_since_blocked_them(): void
    {
        $buddy = $this->member();
        $owner = $this->member();
        $goalId = $this->publicGoal((int) $owner->id, 'F334 note goal');

        $service = app(GoalService::class);
        $offer = $service->offerBuddy($goalId, (int) $buddy->id);
        $this->assertNotNull($offer, 'precondition: the unblocked offer is accepted');
        $accepted = $service->acceptBuddyRequest($goalId, (int) $offer['request_id'], (int) $owner->id);
        $this->assertSame('accepted', $accepted['status'], 'precondition: the buddy relationship exists');

        // The owner then blocks the buddy.
        BlockUserService::block((int) $owner->id, (int) $buddy->id, 'F334 harassment');

        $threw = false;
        try {
            $service->createBuddyNote($goalId, (int) $buddy->id, [
                'type' => 'note',
                'message' => 'F334 unwanted accountability note',
            ]);
        } catch (SafeguardingPolicyException $e) {
            $threw = true;
            $this->assertSame('BLOCKED', $e->reasonCode);
        }

        $this->assertTrue($threw, 'a buddy note to a member who blocked the buddy must be refused');
    }

    public function test_the_block_is_real_and_an_unblocked_buddy_offer_still_works(): void
    {
        // Control 1 — the same fixture block DOES stop the canonical check.
        $attacker = $this->member();
        $victim = $this->member();
        BlockUserService::block((int) $victim->id, (int) $attacker->id, 'F334 harassment');

        $refused = false;
        try {
            BlockUserService::assertNoBlockBetween((int) $attacker->id, (int) $victim->id);
        } catch (SafeguardingPolicyException $e) {
            $refused = true;
            $this->assertSame('BLOCKED', $e->reasonCode);
        }
        $this->assertTrue($refused, 'CONTROL: the canonical block check refuses this pair');

        // Control 2 — no block, same route: offer, accept and note all work.
        $owner = $this->member();
        $buddy = $this->member(['name' => 'F334 Willing Buddy']);
        $goalId = $this->publicGoal((int) $owner->id, 'F334 control goal');

        Sanctum::actingAs($buddy, ['*']);
        $ok = $this->apiPost('/v2/goals/' . $goalId . '/buddy', []);
        $this->assertSame(200, $ok->status(), 'CONTROL: an ordinary buddy offer still works: ' . $ok->getContent());
        $this->assertTrue(
            DB::table('goal_buddy_requests')
                ->where('tenant_id', $this->testTenantId)
                ->where('goal_id', $goalId)
                ->where('requester_id', $buddy->id)
                ->exists(),
            'CONTROL: the rightful buddy request is written'
        );

        $requestId = (int) DB::table('goal_buddy_requests')
            ->where('tenant_id', $this->testTenantId)
            ->where('goal_id', $goalId)
            ->where('requester_id', $buddy->id)
            ->value('id');

        $service = app(GoalService::class);
        $accepted = $service->acceptBuddyRequest($goalId, $requestId, (int) $owner->id);
        $this->assertSame('accepted', $accepted['status'], 'CONTROL: the owner can still accept an unblocked request');

        $note = $service->createBuddyNote($goalId, (int) $buddy->id, [
            'type' => 'note',
            'message' => 'F334 ordinary accountability note',
        ]);
        $this->assertNotNull($note, 'CONTROL: an unblocked buddy can still send an accountability note');
    }
}
