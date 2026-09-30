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
 * F-344 (E-065 slice M) — a cross-community credit transfer must not ignore a
 * partnership an administrator suspended while it was in flight, nor a partner
 * community that switched its own federated transactions off.
 *
 * FederationV2Controller::sendTransaction() read the partnership status and
 * `transactions_enabled`, and the F-156 partner-community check, UNLOCKED and
 * BEFORE the money transaction opened; neither was consulted again inside it,
 * and the transaction locked only the two members' `users` rows. A transfer
 * already past the pre-check therefore committed anyway, with 201, a ledger
 * row, a bell, a push and two emails — so the platform could not answer
 * "after the suspension, did any credits cross?"
 *
 * Internal cross-community federation is live and ungated by design, so this is
 * reachable in production. Extends the F-156 fix, which added the partner
 * community check but placed it outside the lock.
 *
 * Adapted from the E-065 reproduction
 * `.local-docs-archive/security-log/E-065/repro/m/FederatedTransferConcurrencyTest.php`,
 * which FAILS while the bug exists ("BAD OUTCOME:"). That polarity is kept.
 *
 * 🔴 Honest limit, carried over from E-065: the barrier holds the child open as
 * long as the parent needs, so these prove the ABSENCE OF A RE-CHECK, not that
 * the production window is wide. How often an unassisted race lands was never
 * measured.
 */
final class F344FederatedTransferPartnershipRecheckTest extends TestCase
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

    private function partnershipStatus(): string
    {
        return (string) DB::table('federation_partnerships')
            ->where('tenant_id', $this->sourceTenantId)
            ->where('partner_tenant_id', $this->destTenantId)
            ->value('status');
    }

    /* =====================================================================
     * CONTROL A — the legitimate path. One uncontested federated transfer
     * completes exactly once. Every race below differs ONLY in what happens
     * inside the window, so this must keep passing.
     * ================================================================== */
    public function test_control_uncontested_transfer_completes_exactly_once(): void
    {
        $sender = $this->makeFederatedUser($this->sourceTenantId, 25);
        $receiver = $this->makeFederatedUser($this->destTenantId, 4);

        $response = $this->callSendTransaction(
            $sender,
            $receiver,
            $this->destTenantId,
            10,
            'F344 control',
            'f344-control-' . bin2hex(random_bytes(6))
        );

        self::assertSame(201, $response->getStatusCode(), (string) $response->getContent());
        self::assertSame(15, $this->balance($sender), 'control: sender debited 10');
        self::assertSame(14, $this->balance($receiver), 'control: receiver credited 10');
        self::assertSame(1, $this->federatedRowCount($sender), 'control: exactly one ledger row');
    }

    /* =====================================================================
     * CONTROL B — the verified idempotency guard. The SAME transfer submitted
     * twice concurrently with the SAME explicit key must still produce exactly
     * one debit, one credit and one ledger row. E-065 measured this as sound;
     * the new in-transaction re-checks must not disturb it.
     * ================================================================== */
    public function test_same_idempotency_key_submitted_concurrently_debits_once(): void
    {
        $sender = $this->makeFederatedUser($this->sourceTenantId, 50);
        $receiver = $this->makeFederatedUser($this->destTenantId, 0);
        $key = 'f344-dup-' . bin2hex(random_bytes(8));

        $parentStatus = null;
        $report = $this->raceAgainst(
            $sender,
            $receiver,
            $this->destTenantId,
            10,
            'F344 duplicate',
            $key,
            function () use ($sender, $receiver, $key, &$parentStatus): void {
                $r = $this->callSendTransaction(
                    $sender,
                    $receiver,
                    $this->destTenantId,
                    10,
                    'F344 duplicate',
                    $key
                );
                $parentStatus = $r->getStatusCode();
            }
        );

        self::assertSame(201, $parentStatus, 'the first of the two concurrent submissions must succeed');
        self::assertSame(40, $this->balance($sender), 'exactly one debit of 10 from 50: ' . json_encode($report));
        self::assertSame(10, $this->balance($receiver), 'exactly one credit of 10');
        self::assertSame(1, $this->federatedRowCount($sender), 'exactly one federated ledger row');
    }

    /* =====================================================================
     * CONTROL C — the verified overdraw guard. Two DIFFERENT concurrent
     * transfers of 60 from a balance of 100 must leave exactly one committed.
     * ================================================================== */
    public function test_two_concurrent_transfers_cannot_overdraw_the_sender(): void
    {
        $sender = $this->makeFederatedUser($this->sourceTenantId, 100);
        $receiverA = $this->makeFederatedUser($this->destTenantId, 0);
        $receiverB = $this->makeFederatedUser($this->destTenantId, 0);

        $parentStatus = null;
        $report = $this->raceAgainst(
            $sender,
            $receiverA,
            $this->destTenantId,
            60,
            'F344 overdraw A',
            'f344-over-a-' . bin2hex(random_bytes(6)),
            function () use ($sender, $receiverB, &$parentStatus): void {
                $r = $this->callSendTransaction(
                    $sender,
                    $receiverB,
                    $this->destTenantId,
                    60,
                    'F344 overdraw B',
                    'f344-over-b-' . bin2hex(random_bytes(6))
                );
                $parentStatus = $r->getStatusCode();
            }
        );

        $senderBalance = $this->balance($sender);
        $total = $senderBalance + $this->balance($receiverA) + $this->balance($receiverB);

        self::assertSame(201, $parentStatus, 'the first transfer must succeed');
        self::assertSame(40, $senderBalance, 'exactly one 60-hour debit committed: ' . json_encode($report));
        self::assertSame(100, $total, 'nothing minted or burned');
    }

    /* =====================================================================
     * CONTROL D — the suspension refuses the transfer when it is applied
     * BEFORE the transfer starts. This proves the suspension is the property
     * under test in the race below.
     * ================================================================== */
    public function test_control_suspended_partnership_refuses_when_not_raced(): void
    {
        $sender = $this->makeFederatedUser($this->sourceTenantId, 30);
        $receiver = $this->makeFederatedUser($this->destTenantId, 0);

        DB::table('federation_partnerships')
            ->where('tenant_id', $this->sourceTenantId)
            ->where('partner_tenant_id', $this->destTenantId)
            ->update(['status' => 'suspended', 'transactions_enabled' => 0, 'updated_at' => now()]);

        $response = $this->callSendTransaction(
            $sender,
            $receiver,
            $this->destTenantId,
            10,
            'F344 suspend control',
            'f344-susp-ctl-' . bin2hex(random_bytes(6))
        );

        self::assertSame(403, $response->getStatusCode(), (string) $response->getContent());
        self::assertSame(30, $this->balance($sender), 'control: nothing moved');
        self::assertSame(0, $this->balance($receiver), 'control: nothing moved');
    }

    /* =====================================================================
     * RACE A — an administrator SUSPENDS the partnership inside the window.
     * ================================================================== */
    public function test_credits_do_not_cross_a_partnership_suspended_mid_transfer(): void
    {
        $sender = $this->makeFederatedUser($this->sourceTenantId, 30);
        $receiver = $this->makeFederatedUser($this->destTenantId, 0);

        $report = $this->raceAgainst(
            $sender,
            $receiver,
            $this->destTenantId,
            10,
            'F344 suspend race',
            'f344-susp-' . bin2hex(random_bytes(6)),
            function (): void {
                DB::table('federation_partnerships')
                    ->where('tenant_id', $this->sourceTenantId)
                    ->where('partner_tenant_id', $this->destTenantId)
                    ->update(['status' => 'suspended', 'transactions_enabled' => 0, 'updated_at' => now()]);

                self::assertSame(
                    'suspended',
                    $this->partnershipStatus(),
                    'the suspension must have committed first',
                );
            }
        );

        $senderBalance = $this->balance($sender);
        $receiverBalance = $this->balance($receiver);
        $status = $this->partnershipStatus();

        self::assertFalse(
            $status === 'suspended' && $senderBalance === 20 && $receiverBalance === 10,
            "BAD OUTCOME: partnership status='{$status}' and transactions_enabled=0 committed BEFORE the "
            . "money moved, yet 10 credits still crossed the boundary (sender {$senderBalance}, "
            . "receiver {$receiverBalance}); child reported " . json_encode($report),
        );

        self::assertSame(30, $senderBalance, 'the sender must not be debited');
        self::assertSame(0, $receiverBalance, 'the receiver must not be credited');
        self::assertSame(0, $this->federatedRowCount($sender), 'no federated ledger row may be written');
        self::assertSame(403, $report['status'] ?? null, 'the raced transfer must be refused: ' . json_encode($report));
    }

    /* =====================================================================
     * RACE B — the PARTNER COMMUNITY turns its own federated transactions off
     * inside the window. partnerTenantAllowsOperation() is the F-156 fix and
     * was also only an unlocked pre-check.
     * ================================================================== */
    public function test_credits_do_not_cross_after_the_partner_community_disables_transactions(): void
    {
        $sender = $this->makeFederatedUser($this->sourceTenantId, 30);
        $receiver = $this->makeFederatedUser($this->destTenantId, 0);

        $report = $this->raceAgainst(
            $sender,
            $receiver,
            $this->destTenantId,
            10,
            'F344 partner disable race',
            'f344-pdis-' . bin2hex(random_bytes(6)),
            function (): void {
                DB::table('federation_tenant_features')
                    ->where('tenant_id', $this->destTenantId)
                    ->update(['is_enabled' => 0, 'updated_at' => now()]);
                DB::table('federation_tenant_whitelist')->where('tenant_id', $this->destTenantId)->delete();

                self::assertSame(
                    0,
                    (int) DB::table('federation_tenant_whitelist')->where('tenant_id', $this->destTenantId)->count(),
                    'the partner community must be off the whitelist first',
                );
            }
        );

        $senderBalance = $this->balance($sender);
        $receiverBalance = $this->balance($receiver);

        self::assertFalse(
            $senderBalance === 20 && $receiverBalance === 10,
            'BAD OUTCOME: the partner community disabled federated transactions BEFORE the money moved, '
            . "yet 10 credits still crossed (sender {$senderBalance}, receiver {$receiverBalance}); "
            . 'child reported ' . json_encode($report),
        );

        self::assertSame(30, $senderBalance, 'the sender must not be debited');
        self::assertSame(0, $receiverBalance, 'the receiver must not be credited');
        self::assertSame(0, $this->federatedRowCount($sender), 'no federated ledger row may be written');
        self::assertSame(403, $report['status'] ?? null, 'the raced transfer must be refused: ' . json_encode($report));
    }
}
