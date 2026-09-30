<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E065;

use Illuminate\Support\Facades\DB;
use Tests\Laravel\Feature\Security\E065\Concerns\RacesFederatedTransfer;
use Tests\Laravel\TestCase;

/**
 * F-376 (E-065 slice M) — a cross-community credit transfer must not land on a
 * recipient who opted out of federation, or whose account was deactivated,
 * while it was in flight.
 *
 * Same root cause as F-344: the recipient row and its federation settings were
 * read UNLOCKED before the money transaction opened and never re-read inside
 * it. Separately, the credit statement carried no `status` filter at all —
 * `UPDATE users SET balance = balance + ? WHERE id = ? AND tenant_id = ?` —
 * while the debit was conditional on `balance >= ?`. That is the F-105 shape
 * ("credits reach a suspended account") on the federated path, which the F-105
 * fix did not cover.
 *
 * Adapted from the E-065 reproduction
 * `.local-docs-archive/security-log/E-065/repro/m/FederatedTransferConcurrencyTest.php`,
 * which FAILS while the bug exists ("BAD OUTCOME:"). That polarity is kept.
 *
 * 🔴 Honest limit, carried over from E-065: these prove the ABSENCE OF A
 * RE-CHECK, not that the production window is wide.
 */
final class F376FederatedTransferRecipientRecheckTest extends TestCase
{
    use RacesFederatedTransfer;

    protected function setUp(): void
    {
        parent::setUp();
        $this->requireForking();
        $this->setUpFederatedTransferFixture();
    }

    protected function tearDown(): void
    {
        $this->tearDownFederatedTransferFixture();
        parent::tearDown();
    }

    /* =====================================================================
     * CONTROL A — a recipient who has already opted out is refused before the
     * transfer starts, and nothing moves. This is the property under test.
     * ================================================================== */
    public function test_control_opted_out_recipient_refuses_when_not_raced(): void
    {
        $sender = $this->makeFederatedUser($this->sourceTenantId, 30);
        $receiver = $this->makeFederatedUser($this->destTenantId, 0);

        DB::table('federation_user_settings')
            ->where('user_id', $receiver)
            ->update(['federation_optin' => 0, 'transactions_enabled_federated' => 0, 'updated_at' => now()]);

        $response = $this->callSendTransaction(
            $sender,
            $receiver,
            $this->destTenantId,
            10,
            'F376 optout control',
            'f376-optout-ctl-' . bin2hex(random_bytes(6))
        );

        self::assertSame(404, $response->getStatusCode(), (string) $response->getContent());
        self::assertSame(30, $this->balance($sender), 'control: nothing moved');
        self::assertSame(0, $this->balance($receiver), 'control: nothing moved');
    }

    /* =====================================================================
     * CONTROL B — a recipient who has already been deactivated is refused
     * before the transfer starts.
     * ================================================================== */
    public function test_control_deactivated_recipient_refuses_when_not_raced(): void
    {
        $sender = $this->makeFederatedUser($this->sourceTenantId, 30);
        $receiver = $this->makeFederatedUser($this->destTenantId, 0);

        DB::table('users')->where('id', $receiver)->update(['status' => 'inactive', 'updated_at' => now()]);

        $response = $this->callSendTransaction(
            $sender,
            $receiver,
            $this->destTenantId,
            10,
            'F376 deactivate control',
            'f376-deact-ctl-' . bin2hex(random_bytes(6))
        );

        self::assertSame(404, $response->getStatusCode(), (string) $response->getContent());
        self::assertSame(30, $this->balance($sender), 'control: nothing moved');
        self::assertSame(0, $this->balance($receiver), 'control: nothing moved');
    }

    /* =====================================================================
     * RACE A — the recipient withdraws consent to federation inside the
     * window.
     * ================================================================== */
    public function test_credits_do_not_land_on_a_receiver_who_opted_out_mid_transfer(): void
    {
        $sender = $this->makeFederatedUser($this->sourceTenantId, 30);
        $receiver = $this->makeFederatedUser($this->destTenantId, 0);

        $report = $this->raceAgainst(
            $sender,
            $receiver,
            $this->destTenantId,
            10,
            'F376 optout race',
            'f376-optout-' . bin2hex(random_bytes(6)),
            function () use ($receiver): void {
                DB::table('federation_user_settings')
                    ->where('user_id', $receiver)
                    ->update([
                        'federation_optin' => 0,
                        'transactions_enabled_federated' => 0,
                        'updated_at' => now(),
                    ]);

                self::assertSame(
                    0,
                    (int) DB::table('federation_user_settings')->where('user_id', $receiver)->value('federation_optin'),
                    'the opt-out must have committed first',
                );
            }
        );

        $senderBalance = $this->balance($sender);
        $receiverBalance = $this->balance($receiver);
        $optin = (int) DB::table('federation_user_settings')->where('user_id', $receiver)->value('federation_optin');

        self::assertFalse(
            $optin === 0 && $senderBalance === 20 && $receiverBalance === 10,
            "BAD OUTCOME: receiver federation_optin=0 committed BEFORE the money moved, yet 10 credits "
            . "still landed (sender {$senderBalance}, receiver {$receiverBalance}); child reported "
            . json_encode($report),
        );

        self::assertSame(30, $senderBalance, 'the sender must not be debited');
        self::assertSame(0, $receiverBalance, 'a member who withdrew consent must not be credited');
        self::assertSame(0, $this->federatedRowCount($sender), 'no federated ledger row may be written');
    }

    /* =====================================================================
     * RACE B — an administrator deactivates the recipient inside the window.
     * ================================================================== */
    public function test_credits_do_not_land_on_a_receiver_deactivated_mid_transfer(): void
    {
        $sender = $this->makeFederatedUser($this->sourceTenantId, 30);
        $receiver = $this->makeFederatedUser($this->destTenantId, 0);

        $report = $this->raceAgainst(
            $sender,
            $receiver,
            $this->destTenantId,
            10,
            'F376 deactivate race',
            'f376-deact-' . bin2hex(random_bytes(6)),
            function () use ($receiver): void {
                DB::table('users')->where('id', $receiver)->update(['status' => 'inactive', 'updated_at' => now()]);
                self::assertSame(
                    'inactive',
                    (string) DB::table('users')->where('id', $receiver)->value('status'),
                    'the deactivation must have committed first',
                );
            }
        );

        $senderBalance = $this->balance($sender);
        $receiverBalance = $this->balance($receiver);
        $status = (string) DB::table('users')->where('id', $receiver)->value('status');

        self::assertFalse(
            $status !== 'active' && $senderBalance === 20 && $receiverBalance === 10,
            "BAD OUTCOME: receiver status='{$status}' committed BEFORE the money moved, yet 10 credits "
            . "still landed (sender {$senderBalance}, receiver {$receiverBalance}); child reported "
            . json_encode($report),
        );

        self::assertSame(30, $senderBalance, 'the sender must not be debited');
        self::assertSame(0, $receiverBalance, 'a deactivated account must not be credited');
        self::assertSame(0, $this->federatedRowCount($sender), 'no federated ledger row may be written');
    }
}
