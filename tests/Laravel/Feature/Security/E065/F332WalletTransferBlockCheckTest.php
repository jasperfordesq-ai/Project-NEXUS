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
 * F-332 (E-065) — the sixth and seventh members of the F-279 / F-070 family.
 *
 * WalletService::transfer and CreditDonationService::donate applied the
 * safeguarding contact policy and no block check, so a member who had been
 * blocked could still move credits to the blocker with an attacker-chosen
 * free-text note — and NotifyTransactionCompleted delivered that note to the
 * blocker as a bell notification, a push notification and an email.
 *
 * Both paths must now refuse the pair with the direction-neutral BLOCKED
 * error, move no credits and write no notification. Unblocked transfers and
 * donations on the same routes are unaffected.
 *
 * Adapted from the E-065 slice-B reproduction
 * `.local-docs-archive/security-log/E-065/repro/b/WalletTransferIgnoresBlockTest.php`,
 * which asserted the BAD outcome (it passed while the bug existed). Every
 * attack assertion below is inverted.
 */
class F332WalletTransferBlockCheckTest extends TestCase
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

    public function test_a_blocked_member_cannot_send_credits_with_a_note_to_the_blocker(): void
    {
        $attacker = $this->member(['balance' => 10.0]);
        $victim = $this->member(['balance' => 0.0]);

        BlockUserService::block((int) $victim->id, (int) $attacker->id, 'F332 harassment');

        $this->assertTrue(
            BlockUserService::isBlockedEither((int) $attacker->id, (int) $victim->id),
            'precondition: the block is live and visible to the platform'
        );

        $note = 'F332 unwanted message reaching a member who blocked me';

        Sanctum::actingAs($attacker, ['*']);
        $response = $this->apiPost('/v2/wallet/transfer', [
            'recipient' => (string) $victim->id,
            'amount' => 0.25,
            'description' => $note,
        ]);

        $this->assertSame(403, $response->status(), 'the transfer must be refused: ' . $response->getContent());
        $this->assertSame('BLOCKED', $response->json('errors.0.code'), $response->getContent());

        $this->assertEquals(
            0.0,
            (float) DB::table('users')->where('id', $victim->id)->value('balance'),
            'no credits may reach the member who blocked the sender'
        );
        $this->assertEquals(
            10.0,
            (float) DB::table('users')->where('id', $attacker->id)->value('balance'),
            'the refused transfer must not debit the sender either'
        );

        $this->assertFalse(
            DB::table('notifications')
                ->where('tenant_id', $this->testTenantId)
                ->where('user_id', $victim->id)
                ->where('message', 'like', '%F332 unwanted message%')
                ->exists(),
            'the blocked sender\'s free text must not be delivered to the blocker'
        );

        $this->assertFalse(
            DB::table('transactions')
                ->where('tenant_id', $this->testTenantId)
                ->where('sender_id', $attacker->id)
                ->where('receiver_id', $victim->id)
                ->exists(),
            'no ledger row may carry the blocked sender\'s text'
        );
    }

    public function test_a_blocked_member_cannot_donate_credits_to_the_blocker(): void
    {
        $attacker = $this->member(['balance' => 10.0]);
        $victim = $this->member(['balance' => 0.0]);

        BlockUserService::block((int) $victim->id, (int) $attacker->id, 'F332 harassment');

        Sanctum::actingAs($attacker, ['*']);
        $response = $this->apiPost('/v2/wallet/donate', [
            'recipient_type' => 'user',
            'recipient_id' => (int) $victim->id,
            'amount' => 0.5,
            'message' => 'F332 unwanted donation note',
        ]);

        $this->assertSame(403, $response->status(), 'the donation must be refused: ' . $response->getContent());
        $this->assertSame('BLOCKED', $response->json('errors.0.code'), $response->getContent());

        $this->assertEquals(
            0.0,
            (float) DB::table('users')->where('id', $victim->id)->value('balance'),
            'a blocked member must not be able to donate credits to the blocker'
        );
    }

    public function test_the_block_is_real_and_an_unblocked_transfer_and_donation_still_work(): void
    {
        // Control 1 — the same fixture block DOES stop the canonical check, so
        // the fixture is a real block and not a broken one.
        $attacker = $this->member(['balance' => 10.0]);
        $victim = $this->member(['balance' => 0.0]);
        BlockUserService::block((int) $victim->id, (int) $attacker->id, 'F332 harassment');

        $refused = false;
        try {
            BlockUserService::assertNoBlockBetween((int) $attacker->id, (int) $victim->id);
        } catch (SafeguardingPolicyException $e) {
            $refused = true;
            $this->assertSame('BLOCKED', $e->reasonCode);
        }
        $this->assertTrue($refused, 'CONTROL: the canonical block check refuses this pair');

        // Control 2 — the rightful case: no block, same route, same shape.
        $sender = $this->member(['balance' => 10.0]);
        $recipient = $this->member(['balance' => 0.0]);

        Sanctum::actingAs($sender, ['*']);
        $ok = $this->apiPost('/v2/wallet/transfer', [
            'recipient' => (string) $recipient->id,
            'amount' => 0.25,
            'description' => 'F332 ordinary transfer',
        ]);

        $this->assertSame(201, $ok->status(), 'CONTROL: an ordinary transfer still works: ' . $ok->getContent());
        $this->assertEquals(
            0.25,
            (float) DB::table('users')->where('id', $recipient->id)->value('balance'),
            'CONTROL: the rightful recipient is credited'
        );

        // Control 3 — the donation route, no block.
        $donor = $this->member(['balance' => 10.0]);
        $beneficiary = $this->member(['balance' => 0.0]);

        Sanctum::actingAs($donor, ['*']);
        $okDonation = $this->apiPost('/v2/wallet/donate', [
            'recipient_type' => 'user',
            'recipient_id' => (int) $beneficiary->id,
            'amount' => 0.5,
            'message' => 'F332 ordinary donation',
        ]);

        $this->assertSame(201, $okDonation->status(), 'CONTROL: an ordinary donation still works: ' . $okDonation->getContent());
        $this->assertEquals(
            0.5,
            (float) DB::table('users')->where('id', $beneficiary->id)->value('balance'),
            'CONTROL: the rightful beneficiary is credited'
        );
    }
}
