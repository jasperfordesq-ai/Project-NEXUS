<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E075;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\FederationFeatureService;
use App\Services\WalletService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-491 (second half) — when an external partner cancels a transfer it already
 * delivered, the member's wallet must record that the hours left their account.
 *
 * `WalletService::getFederationTransactions()` filtered `ft.status = 'completed'`,
 * so the moment `handleTransactionCancelled()` moved the row to `cancelled` it
 * disappeared from the member's wallet entirely, and no local `transactions` row
 * is ever written for a federation credit or its reversal. The balance simply
 * dropped with nothing on the member's history to account for it.
 *
 * A `disputed` row is the opposite case: the reversal did NOT succeed, the
 * member still holds the hours, and the row was hidden from them just the same.
 *
 * 🔴 The OTHER half of F-491 — that the reversal's `balance >= amount` guard
 * cannot tell "the member still holds the delivered credits" from "the member
 * spent them and has since earned their own" — is NOT fixed here and has no
 * test in this file. A fungible balance plus no balance history cannot express
 * that distinction; see the engagement report.
 *
 * Observation point, stated honestly: these tests drive the webhook through
 * `processTrustedEvent()`, as F-407's, F-428's and F-484's regression tests do.
 * They do NOT exercise the HMAC / Bearer authentication or the nonce replay
 * store in `receive()`.
 */
final class F491FederationReversalIsVisibleInTheWalletTest extends TestCase
{
    use DatabaseTransactions;

    /**
     * CORRECT BEHAVIOUR — after the partner cancels, the member's wallet shows
     * hours leaving their account, and the figure matches the balance drop.
     */
    public function test_a_cancelled_federation_credit_is_recorded_in_the_members_wallet(): void
    {
        $this->enableFederation();
        $partner = $this->partner('cancelled', ['allow_transactions' => 1]);
        $member = $this->member();
        $this->creditAgreement(100.0);

        $this->credit($partner, $this->payload($member, 'f491-cancel-1', 5.0));
        $this->assertSame(5.0, $this->balance($member), 'precondition: the member holds the delivered hours');

        $before = $this->balance($member);
        $cancel = $this->credit(
            $partner,
            ['external_transaction_id' => 'f491-cancel-1', 'reason' => 'partner withdrew it'],
            'transaction.cancelled'
        );
        $this->assertSame('cancelled', $cancel['status'] ?? null, 'the partner cancellation is accepted');

        $after = $this->balance($member);
        $this->assertSame(0.0, $after, 'the hours left the account');

        $rows = $this->walletRows($member);
        $reversal = $this->firstFederationRow($rows);

        $this->assertNotNull($reversal, 'the member can see the movement that emptied their wallet');
        $this->assertSame('debit', $reversal['type'], 'it is shown as hours leaving the account');
        $this->assertSame('cancelled', $reversal['status'], 'it carries its true state');
        $this->assertSame(
            $before - $after,
            (float) $reversal['amount'],
            'the figure on the wallet matches the hours that actually left'
        );
    }

    /**
     * CORRECT BEHAVIOUR — a reversal the platform could NOT complete is marked
     * disputed. The member keeps the hours, so it stays a credit, and it must
     * not vanish from their wallet either.
     */
    public function test_a_disputed_federation_credit_stays_visible_as_a_credit(): void
    {
        $this->enableFederation();
        $partner = $this->partner('disputed', ['allow_transactions' => 1]);
        $member = $this->member();
        $this->creditAgreement(100.0);

        $this->credit($partner, $this->payload($member, 'f491-disputed-1', 5.0));
        // The member spends the hours, so the reversal cannot take them back.
        DB::table('users')->where('id', (int) $member->id)->update(['balance' => 0]);

        $cancel = $this->credit(
            $partner,
            ['external_transaction_id' => 'f491-disputed-1', 'reason' => 'partner withdrew it'],
            'transaction.cancelled'
        );
        $this->assertSame('reversal_failed', $cancel['status'] ?? null, 'the reversal could not complete');
        $this->assertSame(
            'disputed',
            (string) DB::table('federation_transactions')
                ->where('external_transaction_id', 'f491-disputed-1')
                ->value('status'),
            'precondition: the row is disputed'
        );

        $row = $this->firstFederationRow($this->walletRows($member));

        $this->assertNotNull($row, 'a disputed delivery is still on the member\'s record');
        $this->assertSame('credit', $row['type'], 'the hours were not taken, so it is still a credit');
        $this->assertSame('disputed', $row['status'], 'it carries its true state');
    }

    /**
     * CONTROL — legitimate access. An ordinary, uncancelled federation credit is
     * still shown exactly as before: a credit, status completed, same amount.
     * The two cases differ only in whether the partner cancelled.
     */
    public function test_control_a_completed_federation_credit_is_unchanged(): void
    {
        $this->enableFederation();
        $partner = $this->partner('completed', ['allow_transactions' => 1]);
        $member = $this->member();
        $this->creditAgreement(100.0);

        $this->credit($partner, $this->payload($member, 'f491-completed-1', 5.0));

        $row = $this->firstFederationRow($this->walletRows($member));

        $this->assertNotNull($row, 'control: the delivery is on the wallet');
        $this->assertSame('credit', $row['type'], 'control: it is hours arriving');
        $this->assertSame('completed', $row['status'], 'control: its state is unchanged');
        $this->assertSame(5.0, (float) $row['amount'], 'control: the amount is unchanged');
        $this->assertSame(5.0, $this->balance($member), 'control: the member holds the hours');
    }

    /**
     * CONTROL — an ordinary local transfer is returned by the identical wallet
     * call, so an empty federation result is the status filter and not a fixture
     * or tenant-scoping accident.
     */
    public function test_control_an_ordinary_local_transfer_is_returned_by_the_same_call(): void
    {
        $this->enableFederation();
        $giver = $this->member();
        $member = $this->member();
        DB::table('users')->where('id', (int) $giver->id)->update(['balance' => 10]);

        DB::table('transactions')->insert([
            'tenant_id' => $this->testTenantId,
            'sender_id' => (int) $giver->id,
            'giver_id' => (int) $giver->id,
            'receiver_id' => (int) $member->id,
            'amount' => 3.0,
            'description' => 'F491 local transfer control',
            'status' => 'completed',
            'transaction_type' => 'transfer',
            'created_at' => now(),
        ]);

        $rows = $this->walletRows($member);
        $local = array_values(array_filter(
            $rows,
            static fn (array $r): bool => ($r['source'] ?? '') !== 'federation'
        ));

        $this->assertNotEmpty($local, 'control: an ordinary local transfer is on the wallet');
        $this->assertSame(3.0, (float) $local[0]['amount'], 'control: with the right amount');
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    private function controller(): \App\Http\Controllers\Api\FederationExternalWebhookController
    {
        return app(\App\Http\Controllers\Api\FederationExternalWebhookController::class);
    }

    /** @return array<int,array<string,mixed>> */
    private function walletRows(User $member): array
    {
        return app(WalletService::class)->getTransactions((int) $member->id, ['limit' => 20])['items'];
    }

    /**
     * @param array<int,array<string,mixed>> $rows
     * @return array<string,mixed>|null
     */
    private function firstFederationRow(array $rows): ?array
    {
        foreach ($rows as $row) {
            if (($row['source'] ?? '') === 'federation') {
                return $row;
            }
        }

        return null;
    }

    /** @return array<string,mixed> */
    private function payload(User $member, string $externalTxId, float $amount): array
    {
        return [
            'external_transaction_id' => $externalTxId,
            'amount' => $amount,
            'recipient_id' => (int) $member->id,
            'sender_id' => 'remote-sender',
            'sender_name' => 'F491 remote sender',
            'reason' => 'F491 synthetic inbound credit',
            'description' => 'F491 synthetic inbound credit',
        ];
    }

    /**
     * @param array<string,mixed> $payload
     * @return array<string,mixed>
     */
    private function credit(object $partner, array $payload, string $event = 'transaction.requested'): array
    {
        try {
            return $this->controller()->processTrustedEvent($event, $payload, $partner);
        } catch (\RuntimeException $e) {
            $this->assertSame(
                'Email dispatch returned false',
                $e->getMessage(),
                'the only expected post-commit throw in this environment is the delivery one'
            );

            return ['status' => 'committed_then_threw'];
        }
    }

    private function balance(User $user): float
    {
        return (float) DB::table('users')
            ->where('id', (int) $user->id)
            ->where('tenant_id', $this->testTenantId)
            ->value('balance');
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    private function creditAgreement(?float $maxMonthlyCredits): void
    {
        DB::table('federation_credit_agreements')->insert([
            'from_tenant_id' => 0,
            'to_tenant_id' => $this->testTenantId,
            'exchange_rate' => 1.0,
            'status' => 'active',
            'max_monthly_credits' => $maxMonthlyCredits,
            'created_at' => now(),
        ]);
    }

    private function enableFederation(): void
    {
        DB::statement(
            "INSERT INTO federation_system_control (id, federation_enabled, whitelist_mode_enabled, emergency_lockdown_active, max_federation_level, created_at)
             VALUES (1, 1, 0, 0, 4, NOW())
             ON DUPLICATE KEY UPDATE federation_enabled = 1, whitelist_mode_enabled = 0, emergency_lockdown_active = 0"
        );

        DB::table('federation_tenant_features')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'feature_key' => FederationFeatureService::TENANT_FEDERATION_ENABLED],
            ['is_enabled' => 1]
        );

        $features = json_decode((string) DB::table('tenants')->where('id', $this->testTenantId)->value('features'), true);
        $features = is_array($features) ? $features : [];
        $features['federation'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);

        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
    }

    /** @param array<string,int> $flags */
    private function partner(string $tag, array $flags): object
    {
        $id = (int) DB::table('federation_external_partners')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'name' => 'F491 partner ' . $tag,
            'base_url' => 'https://f491-' . $tag . '.example.org',
            'api_path' => '/api/v1',
            'protocol_type' => 'nexus',
            'auth_method' => 'api_key',
            'api_key' => 'f491-fixture-key-' . $tag,
            'signing_secret' => 'f491-fixture-secret-' . $tag,
            'status' => 'active',
            'created_at' => now(),
        ], $flags));

        return DB::table('federation_external_partners')->where('id', $id)->first();
    }

    private function member(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => 1,
            'balance' => 0,
            'email' => 'f491-' . bin2hex(random_bytes(6)) . '@f491-fixture.org',
        ]);

        // F-484 — inbound external credit requires the member's own recorded
        // federation consent. This file is about the reversal, not consent.
        DB::table('federation_user_settings')->updateOrInsert(
            ['user_id' => (int) $user->id],
            [
                'federation_optin' => 1,
                'transactions_enabled_federated' => 1,
                'updated_at' => now(),
            ]
        );

        return $user;
    }
}
