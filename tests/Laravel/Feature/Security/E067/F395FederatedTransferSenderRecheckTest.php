<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E067;

use Illuminate\Support\Facades\DB;
use Tests\Laravel\Feature\Security\E065\Concerns\RacesFederatedTransfer;
use Tests\Laravel\TestCase;

/**
 * F-395 (E-067) — the mirror image of F-344 / F-376, on the SENDER's side.
 *
 * FederationV2Controller::sendTransaction() re-checks the partnership, the
 * partner community's own switches and the recipient inside the money
 * transaction (F-344, F-376). The sender's OWN community gate
 * (requireFederationOperation('transactions')) and the sender's own federation
 * opt-in were read only before the transaction opened. So a transfer already
 * past the pre-check still went through after the sender's community switched
 * federated transactions off, or after the sender opted out of federation.
 *
 * Reproduced here with the E-065/E-066 rig: a real pcntl_fork() child parked
 * before sendTransaction()'s first `users … FOR UPDATE`, i.e. after every
 * unlocked pre-check, while the parent commits the change.
 *
 * 🔴 Honest limit (as F-344): the barrier holds the window open, so this proves
 * the absence of a re-check, not how wide the production window is.
 */
final class F395FederatedTransferSenderRecheckTest extends TestCase
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

    public function test_control_an_uncontested_transfer_completes(): void
    {
        $sender = $this->makeFederatedUser($this->sourceTenantId, 30);
        $receiver = $this->makeFederatedUser($this->destTenantId, 0);

        $response = $this->callSendTransaction($sender, $receiver, $this->destTenantId, 10, 'F395 control', 'f395-ctl-' . bin2hex(random_bytes(6)));

        self::assertSame(201, $response->getStatusCode(), (string) $response->getContent());
        self::assertSame(20, $this->balance($sender));
        self::assertSame(10, $this->balance($receiver));
    }

    public function test_credits_do_not_cross_after_the_senders_community_disables_transactions(): void
    {
        $sender = $this->makeFederatedUser($this->sourceTenantId, 30);
        $receiver = $this->makeFederatedUser($this->destTenantId, 0);

        $report = $this->raceAgainst(
            $sender,
            $receiver,
            $this->destTenantId,
            10,
            'F395 sender community disable race',
            'f395-sdis-' . bin2hex(random_bytes(6)),
            function (): void {
                DB::table('federation_tenant_features')
                    ->where('tenant_id', $this->sourceTenantId)
                    ->update(['is_enabled' => 0, 'updated_at' => now()]);
                DB::table('federation_tenant_whitelist')->where('tenant_id', $this->sourceTenantId)->delete();
                self::assertSame(0, (int) DB::table('federation_tenant_whitelist')->where('tenant_id', $this->sourceTenantId)->count(),
                    'the sender\'s community must be off the whitelist first');
            }
        );

        $this->assertNothingCrossed($sender, $receiver, $report);
    }

    public function test_credits_do_not_cross_after_the_sender_opts_out_of_federation(): void
    {
        $sender = $this->makeFederatedUser($this->sourceTenantId, 30);
        $receiver = $this->makeFederatedUser($this->destTenantId, 0);

        $report = $this->raceAgainst(
            $sender,
            $receiver,
            $this->destTenantId,
            10,
            'F395 sender opt-out race',
            'f395-sopt-' . bin2hex(random_bytes(6)),
            function () use ($sender): void {
                DB::table('federation_user_settings')->where('user_id', $sender)
                    ->update(['federation_optin' => 0, 'transactions_enabled_federated' => 0, 'updated_at' => now()]);
                self::assertSame(0, (int) DB::table('federation_user_settings')->where('user_id', $sender)->value('federation_optin'),
                    'the opt-out must have committed first');
            }
        );

        $this->assertNothingCrossed($sender, $receiver, $report);
    }

    /** @param array<string,mixed> $report */
    private function assertNothingCrossed(int $sender, int $receiver, array $report): void
    {
        self::assertTrue($report['reached_barrier'] ?? false, json_encode($report));
        self::assertSame(30, $this->balance($sender), 'the sender must not be debited: ' . json_encode($report));
        self::assertSame(0, $this->balance($receiver), 'the receiver must not be credited');
        self::assertSame(0, $this->federatedRowCount($sender), 'no federated ledger row may be written');
        self::assertSame(403, $report['status'] ?? null, 'the raced transfer must be refused: ' . json_encode($report));
    }
}
