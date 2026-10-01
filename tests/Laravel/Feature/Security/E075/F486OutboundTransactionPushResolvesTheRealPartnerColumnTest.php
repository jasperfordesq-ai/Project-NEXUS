<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E075;

use App\Core\TenantContext;
use App\Events\TransactionCompleted;
use App\Listeners\PushTransactionToFederatedPartner;
use App\Models\Transaction;
use App\Models\User;
use App\Services\FederationFeatureService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\Concerns\EnablesExternalFederation;
use Tests\Laravel\TestCase;

/**
 * F-486 (E-075 slice G, G-4) — a completed outbound external transfer must
 * actually be pushed to the partner it was addressed to.
 *
 * `PushTransactionToFederatedPartner:65-70` read
 * `$transaction->external_partner_id` and returned when it was 0.
 * `transactions` has NO such column, so the listener returned cleanly on every
 * transaction and no completed transfer was ever announced: `$tries`, the
 * backoff, the circuit-breaker handling and `isRetryablePartnerFailure()` were
 * all unreached code, and the failure was silent.
 *
 * The platform stores the outbound partner in `transactions.receiver_tenant_id`
 * — that is what `FederationV2Controller::sendExternalTransaction()` writes
 * (`:4143-4156`) and how `ReconcileFederationPendingTxJob` finds it
 * (`:70-73`, `->on('ep.id', '=', 'tx.receiver_tenant_id')`).
 *
 * 🔴 That column carries TWO identifier spaces (F-487): a real `tenants.id` on
 * an INTERNAL cross-community transfer, a `federation_external_partners.id` on
 * an outbound EXTERNAL one. So the fix must not simply treat the value as a
 * partner id — an internal transfer whose receiver community id happened to
 * equal a partner id would then be pushed, amount and member-written
 * description included, to a partner that has nothing to do with it. The
 * discriminator is the one `sendExternalTransaction()` itself writes and only
 * it writes: `federation_partner_idempotency_key`.
 *
 * These tests assert the CORRECT behaviour and fail before the fix.
 *
 * OBSERVATION POINT, stated honestly. `Http::fake()` intercepts the request, so
 * no bytes leave the container and no real partner is contacted — the container
 * has no outbound DNS, which is why the partner fixture uses a public-IP
 * literal. What is proven is that the platform resolved the partner and handed
 * the push to the transport. Real wire transmission is not exercised.
 */
final class F486OutboundTransactionPushResolvesTheRealPartnerColumnTest extends TestCase
{
    use DatabaseTransactions;
    use EnablesExternalFederation;

    /** federation_external_partners has UNIQUE (tenant_id, base_url). */
    private static int $urlSeq = 0;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
        $this->enableTenantFederation();
        $this->enableExternalFederation();
        Http::fake(['*' => Http::response(['success' => true], 200)]);
    }

    /** The outbound external transfer must reach the partner it was addressed to. */
    public function test_a_completed_external_transaction_is_pushed_to_its_partner(): void
    {
        $partnerId = $this->partner('f486-outbound');
        [$transaction, $sender, $receiver] = $this->externalTransaction($partnerId);

        $this->runListener($transaction, $sender, $receiver);

        Http::assertSentCount(1);
    }

    /** The cause, pinned so a rename cannot quietly reopen this. */
    public function test_the_column_the_listener_used_to_read_does_not_exist(): void
    {
        self::assertFalse(
            Schema::hasColumn('transactions', 'external_partner_id'),
            'transactions has no external_partner_id column — this is why the push never happened'
        );
        self::assertTrue(
            Schema::hasColumn('transactions', 'receiver_tenant_id'),
            'the outbound partner is stored in receiver_tenant_id'
        );
        self::assertTrue(
            Schema::hasColumn('transactions', 'federation_partner_idempotency_key'),
            'and an OUTBOUND EXTERNAL transfer is the only kind that carries this key'
        );
    }

    /**
     * CONTROL — the platform's own reconcile join resolves the partner on the
     * same row under the other column name. This is the settled convention the
     * fix follows.
     */
    public function test_control_the_reconcile_jobs_join_resolves_the_partner_for_the_same_row(): void
    {
        $partnerId = $this->partner('f486-reconcile');
        [$transaction] = $this->externalTransaction($partnerId);

        $resolved = DB::table('transactions as tx')
            ->leftJoin('federation_external_partners as ep', function ($join): void {
                $join->on('ep.id', '=', 'tx.receiver_tenant_id')
                    ->on('ep.tenant_id', '=', 'tx.tenant_id');
            })
            ->where('tx.id', (int) $transaction->id)
            ->value('ep.id');

        self::assertSame($partnerId, (int) $resolved, 'control: the partner is on the row, under receiver_tenant_id');
    }

    /**
     * CONTROL — the dangerous neighbour (F-487). An INTERNAL cross-community
     * transfer whose receiver community id happens to equal a partner id must
     * still send NOTHING. It differs from the pushed case above only in that it
     * carries no outbound partner idempotency key.
     */
    public function test_control_an_internal_transfer_with_a_colliding_id_is_not_pushed(): void
    {
        $partnerId = $this->partner('f486-internal');

        $sender = $this->member();
        $receiver = $this->member();

        // Recorded the way FederationV2Controller::sendTransaction() records an
        // internal cross-community transfer: receiver_tenant_id is a REAL
        // tenants.id, and no partner idempotency key is written. The id is made
        // to collide with the partner id above on purpose.
        $txId = (int) DB::table('transactions')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'sender_id' => (int) $sender->id,
            'receiver_id' => (int) $receiver->id,
            'amount' => 3.0,
            'description' => 'E076 F-486 internal control transfer',
            'status' => 'completed',
            'is_federated' => 1,
            'sender_tenant_id' => $this->testTenantId,
            'receiver_tenant_id' => $partnerId,
            'created_at' => now(),
        ]);

        $transaction = Transaction::withoutGlobalScopes()->findOrFail($txId);

        $this->runListener($transaction, $sender, $receiver);

        Http::assertNothingSent();
    }

    // ── harness ─────────────────────────────────────────────────────────────

    private function runListener(Transaction $transaction, User $sender, User $receiver): void
    {
        $previous = TenantContext::currentId();
        try {
            (new PushTransactionToFederatedPartner(app(FederationFeatureService::class)))
                ->handle(new TransactionCompleted($transaction, $sender, $receiver, $this->testTenantId));
        } finally {
            TenantContext::restoreAfterScopedListener($previous);
        }
    }

    /**
     * A transaction recorded exactly the way
     * FederationV2Controller::sendExternalTransaction() records one.
     *
     * @return array{0: Transaction, 1: User, 2: User}
     */
    private function externalTransaction(int $partnerId): array
    {
        $sender = $this->member();
        $receiver = $this->member();

        $txId = (int) DB::table('transactions')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'sender_id' => (int) $sender->id,
            'receiver_id' => (int) $receiver->id,
            'amount' => 5.0,
            'description' => 'E076 F-486 outbound external transfer',
            'status' => 'completed',
            'is_federated' => 1,
            'sender_tenant_id' => $this->testTenantId,
            // The OUTBOUND PARTNER id — the position sendExternalTransaction()
            // binds $externalPartnerId into.
            'receiver_tenant_id' => $partnerId,
            'federation_partner_idempotency_key' => 'f486-' . $partnerId . '-' . uniqid('', true),
            'created_at' => now(),
        ]);

        return [Transaction::withoutGlobalScopes()->findOrFail($txId), $sender, $receiver];
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    /** Established explicitly rather than inherited from a developer `.env`. */
    private function enableTenantFederation(): void
    {
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

    private function partner(string $tag): int
    {
        return (int) DB::table('federation_external_partners')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'E076 F-486 partner ' . $tag,
            // A public-IP LITERAL: OutboundUrlGuard short-circuits on IP
            // literals, so no DNS is needed. Nothing leaves the container —
            // Http::fake() intercepts every request.
            'base_url' => 'https://93.184.216.' . (1 + (self::$urlSeq++ % 254)),
            'api_path' => '/api/v1',
            'protocol_type' => 'nexus',
            'auth_method' => 'api_key',
            'api_key' => 'f486-fixture-key-' . $tag,
            'signing_secret' => 'f486-fixture-secret-' . $tag,
            'status' => 'active',
            'allow_transactions' => 1,
            'created_at' => now(),
        ]);
    }

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => 1,
            'balance' => 0,
        ]);
    }
}
