<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E073;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\FederationFeatureService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-428 — the monthly inbound-credit ceiling must not be refundable by the
 * partner it bounds.
 *
 * F-407 (`3053a453e`) added
 * `FederationExternalWebhookController::inboundCreditCeilingRefusal()`, which
 * refuses an inbound external credit that would take the community past the
 * `max_monthly_credits` on its active `federation_credit_agreements` row. Its
 * month-to-date sum filtered `->where('status', 'completed')`.
 *
 * The same authenticated partner moves a row out of `completed` whenever it
 * likes: `handleTransactionCancelled()` writes `disputed` when the member has
 * already spent the credit (nothing is taken back — the member keeps it) and
 * `cancelled` when the reversal succeeds. Both terminal states dropped out of
 * the sum, so every cancellation handed the month's budget back and the
 * ceiling bounded nothing.
 *
 * The fix removes the status filter, matching the sound model this control was
 * copied from — `FederationCreditCommonsController::inboundCreditCeilingRefusal()`
 * (`:1735-1740`), which has never filtered — and matching the v1 partner API's
 * F-440 fix, which pins the same rule.
 *
 * Why `cancelled` counts as well as `disputed`. Both credit paths in this
 * controller insert `status = 'completed'` inside the same database
 * transaction as the balance change and roll back together, so the only rows
 * in this shape are credits that really were delivered; "no filter" therefore
 * means "every hour this partner pushed into the community this month", which
 * is exactly the quantity the agreement bounds. A cancellation is not proof
 * the same credit came back either: the reversal only checks
 * `balance >= amount` on the receiving member, so it can take hours the member
 * earned locally while the delivered credit sits with someone else. Counting
 * every delivered hour is the conservative reading and it keeps one rule
 * across all three inbound protocols. The cost is stated plainly: a partner
 * that cancels a transfer in good faith does not get that part of its monthly
 * budget back until the next month.
 *
 * Observation point, stated honestly: like F-407's own regression test and
 * E-073's reproduction, these drive the handlers through
 * `processTrustedEvent()`, which runs the same `handleEvent()` the HTTP route
 * runs — platform kill switch, tenant federation switch, tenant `federation`
 * feature and the partner's `allow_transactions` flag all apply. They do NOT
 * exercise the HMAC/Bearer authentication or the nonce replay store in
 * `receive()`; a separate engagement drove that layer and found it sound.
 */
final class F428ExternalWebhookCeilingSurvivesCancellationTest extends TestCase
{
    use DatabaseTransactions;

    /**
     * CORRECT BEHAVIOUR — a partner cannot mint past the community's agreed
     * monthly ceiling by cancelling transfers the member has already spent.
     *
     * The cancellation takes nothing back (the row goes to `disputed`), so the
     * hours are still out in the community and must still count.
     */
    public function test_cancelling_a_spent_transfer_does_not_refund_the_monthly_budget(): void
    {
        $this->enableFederation();
        $partner = $this->partner('spent', ['allow_transactions' => 1]);
        $member = $this->member();
        $this->creditAgreement(maxMonthlyCredits: 30.0);

        // Round 1: a lawful 24 hours inside the 30-hour ceiling.
        $first = $this->drive($partner, $this->payload($member, 'f428-spent-1', 24.0));
        $this->assertNotSame('rejected', $first['status'] ?? null, 'the first transfer is inside the ceiling');
        $this->assertSame(24.0, $this->balance($member), 'the member was credited 24 hours');

        // The member spends it — any local spend does this. All the cancellation
        // handler cares about is that the balance is no longer >= the amount.
        $this->spendEverything($member);

        // The partner "cancels" the transfer it has already delivered.
        $cancelled = $this->drive(
            $partner,
            ['external_transaction_id' => 'f428-spent-1', 'reason' => 'f428 synthetic cancellation'],
            'transaction.cancelled'
        );
        $this->assertSame(
            'reversal_failed',
            $cancelled['status'] ?? null,
            'precondition: the reversal fails because the member already spent the credit'
        );
        $this->assertSame(
            'disputed',
            (string) DB::table('federation_transactions')
                ->where('external_transaction_id', 'f428-spent-1')
                ->where('external_partner_id', (int) $partner->id)
                ->value('status'),
            'precondition: the ledger row has left "completed"'
        );
        $this->assertSame(0.0, $this->balance($member), 'precondition: nothing was taken back');

        // Round 2: the budget must NOT have been handed back.
        $refused = $this->drive($partner, $this->payload($member, 'f428-spent-2', 24.0));

        $this->assertSame(
            'rejected',
            $refused['status'] ?? null,
            'the ceiling still counts the disputed hours, so the second transfer is refused'
        );
        $this->assertSame(0.0, $this->balance($member), 'nothing was credited past the ceiling');
        $this->assertSame(
            24.0,
            $this->externallyOriginatedThisMonth(),
            'only the one lawful transfer reached the community against a 30-hour agreement'
        );
        $this->assertSame(
            1,
            (int) DB::table('federation_transactions')
                ->where('external_partner_id', (int) $partner->id)
                ->where('receiver_tenant_id', $this->testTenantId)
                ->count(),
            'no ledger row was written for the refused transfer'
        );
    }

    /**
     * CORRECT BEHAVIOUR — the same rule for a clean cancellation. Even when the
     * credit is genuinely taken back, the month's budget is not reissued; the
     * agreement bounds how much a partner may push through in a month.
     */
    public function test_a_clean_cancellation_does_not_refund_the_monthly_budget(): void
    {
        $this->enableFederation();
        $partner = $this->partner('clean', ['allow_transactions' => 1]);
        $member = $this->member();
        $this->creditAgreement(maxMonthlyCredits: 30.0);

        $this->drive($partner, $this->payload($member, 'f428-clean-1', 24.0));
        $this->assertSame(24.0, $this->balance($member), 'precondition: the member holds the credit');

        $cancelled = $this->drive(
            $partner,
            ['external_transaction_id' => 'f428-clean-1', 'reason' => 'f428 synthetic cancellation'],
            'transaction.cancelled'
        );
        $this->assertSame('cancelled', $cancelled['status'] ?? null, 'precondition: the reversal succeeds');
        $this->assertSame(0.0, $this->balance($member), 'precondition: the credit was taken back');

        $refused = $this->drive($partner, $this->payload($member, 'f428-clean-2', 24.0));

        $this->assertSame(
            'rejected',
            $refused['status'] ?? null,
            'a cancelled transfer does not return the month\'s budget'
        );
        $this->assertSame(0.0, $this->balance($member), 'nothing was credited past the ceiling');
    }

    /**
     * CORRECT BEHAVIOUR — the loop the finding drove. Three rounds of
     * credit / spend / cancel delivered 72 hours against a 30-hour agreement.
     * Now only the first round lands.
     */
    public function test_the_cancel_and_recredit_loop_delivers_no_more_than_the_agreement(): void
    {
        $this->enableFederation();
        $partner = $this->partner('loop', ['allow_transactions' => 1]);
        $member = $this->member();
        $this->creditAgreement(maxMonthlyCredits: 30.0);

        $delivered = 0.0;

        for ($round = 1; $round <= 3; $round++) {
            $ref = 'f428-loop-' . $round;

            $result = $this->drive($partner, $this->payload($member, $ref, 24.0));
            if (($result['status'] ?? null) !== 'rejected') {
                $delivered += 24.0;
                $this->spendEverything($member);
                $this->drive(
                    $partner,
                    ['external_transaction_id' => $ref, 'reason' => 'f428 synthetic cancellation'],
                    'transaction.cancelled'
                );
            }
        }

        $this->assertSame(24.0, $delivered, 'the loop cannot deliver more than the agreement allows');
        $this->assertLessThanOrEqual(
            30.0,
            $this->externallyOriginatedThisMonth(),
            'the community never received more external credit than its agreement permits'
        );
    }

    /**
     * CONTROL — legitimate access. A partner making genuine transfers inside
     * its agreed ceiling still succeeds; the fix is a bound, not a block.
     */
    public function test_control_genuine_transfers_inside_the_ceiling_still_succeed(): void
    {
        $this->enableFederation();
        $partner = $this->partner('lawful', ['allow_transactions' => 1]);
        $member = $this->member();
        $this->creditAgreement(maxMonthlyCredits: 100.0);

        $this->drive($partner, $this->payload($member, 'f428-lawful-1', 24.0));
        $this->drive($partner, $this->payload($member, 'f428-lawful-2', 24.0));
        $this->drive($partner, $this->payload($member, 'f428-lawful-3', 24.0));

        $this->assertSame(72.0, $this->balance($member), 'control: three lawful transfers are all credited');
        $this->assertSame(
            3,
            (int) DB::table('federation_transactions')
                ->where('external_partner_id', (int) $partner->id)
                ->where('receiver_tenant_id', $this->testTenantId)
                ->where('status', 'completed')
                ->count(),
            'control: all three ledger rows exist and are completed'
        );
    }

    /**
     * CONTROL — a genuine reversal must still work. Cancelling a transfer the
     * member still holds takes the credit back and marks the row `cancelled`,
     * exactly as before.
     */
    public function test_control_a_genuine_reversal_still_takes_the_credit_back(): void
    {
        $this->enableFederation();
        $partner = $this->partner('reversal', ['allow_transactions' => 1]);
        $member = $this->member();
        $this->creditAgreement(maxMonthlyCredits: 100.0);

        $this->drive($partner, $this->payload($member, 'f428-reversal-1', 24.0));
        $this->assertSame(24.0, $this->balance($member), 'control: the member holds the credit');

        $cancelled = $this->drive(
            $partner,
            ['external_transaction_id' => 'f428-reversal-1', 'reason' => 'partner sent it in error'],
            'transaction.cancelled'
        );

        $this->assertSame('cancelled', $cancelled['status'] ?? null, 'control: the cancellation is honoured');
        $this->assertSame(0.0, $this->balance($member), 'control: the credit was taken back');
        $this->assertSame(
            'cancelled',
            (string) DB::table('federation_transactions')
                ->where('external_transaction_id', 'f428-reversal-1')
                ->where('external_partner_id', (int) $partner->id)
                ->value('status'),
            'control: the ledger records the cancellation'
        );
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    private function controller(): \App\Http\Controllers\Api\FederationExternalWebhookController
    {
        return app(\App\Http\Controllers\Api\FederationExternalWebhookController::class);
    }

    /** @return array<string,mixed> */
    private function payload(User $member, string $externalTxId, float $amount): array
    {
        return [
            'external_transaction_id' => $externalTxId,
            'amount' => $amount,
            'recipient_id' => (int) $member->id,
            'sender_id' => 'remote-sender',
            'sender_name' => 'F428 remote sender',
            'reason' => 'F428 synthetic inbound credit',
            'description' => 'F428 synthetic inbound credit',
        ];
    }

    /**
     * Drive one inbound event.
     *
     * The credit handler commits the money and THEN dispatches the notification
     * email; there is no reachable SMTP host in this container, so the delivery
     * half returns false and the handler throws AFTER the commit. A refusal
     * returns before delivery is reached. Same helper shape as the F-407
     * regression test.
     *
     * @param array<string,mixed> $payload
     * @return array<string,mixed>
     */
    private function drive(object $partner, array $payload, string $event = 'transaction.requested'): array
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

    /** Stand-in for any local spend of the delivered credit. */
    private function spendEverything(User $user): void
    {
        DB::table('users')
            ->where('id', (int) $user->id)
            ->where('tenant_id', $this->testTenantId)
            ->update(['balance' => 0]);
    }

    /** Every externally-originated hour that reached this community this month. */
    private function externallyOriginatedThisMonth(): float
    {
        return (float) DB::table('federation_transactions')
            ->where('receiver_tenant_id', $this->testTenantId)
            ->where('sender_tenant_id', 0)
            ->whereNotNull('external_partner_id')
            ->where('created_at', '>=', now()->startOfMonth())
            ->sum('amount');
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => 1,
            'balance' => 0,
        ]);
    }

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
            'name' => 'F428 partner ' . $tag,
            'base_url' => 'https://f428-' . $tag . '.example.org',
            'api_path' => '/api/v1',
            'protocol_type' => 'nexus',
            'auth_method' => 'api_key',
            'api_key' => 'f428-fixture-key-' . $tag,
            'signing_secret' => 'f428-fixture-secret-' . $tag,
            'status' => 'active',
            'created_at' => now(),
        ], $flags));

        return DB::table('federation_external_partners')->where('id', $id)->first();
    }
}
