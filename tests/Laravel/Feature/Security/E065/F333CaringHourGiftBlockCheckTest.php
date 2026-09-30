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
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-333 (E-065) — Caring Community hour gifts are the same "applied the
 * safeguarding policy, forgot the block check" defect as F-332 / F-279 / F-070.
 *
 * CaringHourGiftService::send stored up to 500 characters of the sender's free
 * text in `caring_hour_gifts.message` AND in `transactions.description`, and
 * served it back to the blocker (with the sender's name and avatar) on their
 * own inbox route. F-130 closed exactly this in the same module for caregiver
 * link requests; the two sibling money paths were not swept with it.
 *
 * Adapted from the E-065 slice-H reproduction
 * `.local-docs-archive/security-log/E-065/repro/h/BlockCheckSweepResidualsTest.php`,
 * whose attack assertions asserted the BAD outcome. They are inverted here.
 */
class F333CaringHourGiftBlockCheckTest extends TestCase
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

    private function setFeature(string $key, bool $enabled): void
    {
        $row = DB::table('tenants')->where('id', $this->testTenantId)->first(['features']);
        $features = json_decode($row->features ?? '{}', true) ?: [];
        $features[$key] = $enabled;
        DB::table('tenants')->where('id', $this->testTenantId)
            ->update(['features' => json_encode($features, JSON_THROW_ON_ERROR)]);
        TenantContext::setById($this->testTenantId);
    }

    public function test_a_blocked_member_cannot_put_free_text_in_the_blockers_hour_gift_inbox(): void
    {
        $this->setFeature('caring_community', true);

        $attacker = $this->member(['balance' => 10.0]);
        $victim = $this->member(['balance' => 0.0]);

        BlockUserService::block((int) $victim->id, (int) $attacker->id, 'F333 harassment');
        $this->assertTrue(
            BlockUserService::isBlockedEither((int) $attacker->id, (int) $victim->id),
            'precondition: the block is live'
        );

        $note = 'F333 unwanted hour-gift note reaching the member who blocked me';

        Sanctum::actingAs($attacker, ['*']);
        $response = $this->apiPost('/v2/caring-community/hour-gifts/send', [
            'recipient_user_id' => (int) $victim->id,
            'hours' => 0.25,
            'message' => $note,
        ]);

        $this->assertSame(403, $response->status(), 'the gift must be refused: ' . $response->getContent());
        $this->assertSame('BLOCKED', $response->json('errors.0.code'), $response->getContent());

        $this->assertFalse(
            DB::table('caring_hour_gifts')
                ->where('tenant_id', $this->testTenantId)
                ->where('sender_user_id', $attacker->id)
                ->where('recipient_user_id', $victim->id)
                ->exists(),
            'no gift row may be written for the blocker'
        );

        $this->assertFalse(
            DB::table('transactions')
                ->where('tenant_id', $this->testTenantId)
                ->where('sender_id', $attacker->id)
                ->where('receiver_id', $victim->id)
                ->where('transaction_type', 'caring_hour_gift')
                ->exists(),
            'the attacker\'s text must not reach the shared transaction ledger'
        );

        $this->assertEquals(
            10.0,
            (float) DB::table('users')->where('id', $attacker->id)->value('balance'),
            'the refused gift must not debit the sender'
        );

        // And the blocker's own inbox must not serve it.
        Sanctum::actingAs($victim, ['*']);
        $inbox = $this->apiGet('/v2/caring-community/hour-gifts/inbox');
        $this->assertSame(200, $inbox->status(), $inbox->getContent());
        $this->assertStringNotContainsString(
            'F333 unwanted hour-gift note',
            (string) $inbox->getContent(),
            'the blocker\'s inbox must not serve the blocked member\'s free text'
        );
    }

    public function test_the_block_is_real_and_an_unblocked_hour_gift_still_works(): void
    {
        $this->setFeature('caring_community', true);

        // Control 1 — the same fixture block DOES stop the canonical check.
        $attacker = $this->member(['balance' => 10.0]);
        $victim = $this->member(['balance' => 0.0]);
        BlockUserService::block((int) $victim->id, (int) $attacker->id, 'F333 harassment');

        $refused = false;
        try {
            BlockUserService::assertNoBlockBetween((int) $attacker->id, (int) $victim->id);
        } catch (SafeguardingPolicyException $e) {
            $refused = true;
            $this->assertSame('BLOCKED', $e->reasonCode);
        }
        $this->assertTrue($refused, 'CONTROL: the canonical block check refuses this pair');

        // Control 2 — no block, same route, same body shape.
        $sender = $this->member(['balance' => 10.0]);
        $recipient = $this->member(['balance' => 0.0]);

        Sanctum::actingAs($sender, ['*']);
        $ok = $this->apiPost('/v2/caring-community/hour-gifts/send', [
            'recipient_user_id' => (int) $recipient->id,
            'hours' => 0.25,
            'message' => 'F333 ordinary gift',
        ]);
        $this->assertSame(201, $ok->status(), 'CONTROL: an ordinary hour gift still works: ' . $ok->getContent());
        $this->assertTrue(
            DB::table('caring_hour_gifts')
                ->where('tenant_id', $this->testTenantId)
                ->where('sender_user_id', $sender->id)
                ->where('recipient_user_id', $recipient->id)
                ->exists(),
            'CONTROL: the rightful gift row is written'
        );
    }
}
