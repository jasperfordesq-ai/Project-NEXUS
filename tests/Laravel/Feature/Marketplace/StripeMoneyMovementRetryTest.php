<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Marketplace;

use App\Core\TenantContext;
use App\Models\MarketplaceEscrow;
use App\Models\MarketplaceOrder;
use App\Models\User;
use App\Services\EmailDispatchService;
use App\Services\MarketplaceEscrowService;
use App\Services\MarketplacePaymentService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-283 — a Stripe money movement must happen at most once, even when the
 * reply to the first attempt is lost and the retry comes after Stripe has
 * forgotten the idempotency key (24 h).
 *
 * The fake Stripe below is stateful and deliberately does NOT honour
 * idempotency keys: it behaves like Stripe more than 24 hours after the first
 * attempt, which is the case that used to pay twice. Every test that proves a
 * refusal also has a legitimate path proving the money still moves once.
 */
final class StripeMoneyMovementRetryTest extends TestCase
{
    use DatabaseTransactions;

    /** @var object{requests: array, transfers: array, refunds: array, reversals: array, failNextPost: ?string} */
    private object $stripe;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
        config(['services.stripe.secret' => 'sk_test_f283_money_movement']);

        $this->stripe = new class implements \Stripe\HttpClient\ClientInterface {
            /** @var list<array{method:string,path:string,params:array,headers:array}> */
            public array $requests = [];
            /** @var array<string,array> */
            public array $transfers = [];
            /** @var array<string,array> */
            public array $refunds = [];
            /** @var array<string,list<array>> */
            public array $reversals = [];
            /** null | 'lost_reply' (Stripe acts, reply lost) | 'not_reached' (Stripe never sees it) | 'refused' (400) */
            public ?string $failNextPost = null;
            private int $sequence = 0;

            public function request($method, $absUrl, $headers, $params, $hasFile, $apiMode = 'v1'): array
            {
                $method = strtolower((string) $method);
                $path = (string) parse_url((string) $absUrl, PHP_URL_PATH);
                $params = is_array($params) ? $params : [];
                $this->requests[] = ['method' => $method, 'path' => $path, 'params' => $params, 'headers' => $headers];

                $failure = $method === 'post' ? $this->failNextPost : null;
                if ($failure !== null) {
                    $this->failNextPost = null;
                }
                if ($failure === 'not_reached') {
                    throw new \Stripe\Exception\ApiConnectionException('simulated: connection refused before Stripe saw the request');
                }
                if ($failure === 'refused') {
                    return [json_encode(['error' => [
                        'type' => 'invalid_request_error',
                        'message' => 'simulated: Stripe refused the request',
                    ]], JSON_THROW_ON_ERROR), 400, []];
                }

                $body = $this->handle($method, $path, $params);

                if ($failure === 'lost_reply') {
                    throw new \Stripe\Exception\ApiConnectionException('simulated: Stripe processed the request, the reply was lost');
                }

                return [json_encode($body, JSON_THROW_ON_ERROR), 200, []];
            }

            private function handle(string $method, string $path, array $params): array
            {
                if (preg_match('#^/v1/transfers/([^/]+)/reversals$#', $path, $m) === 1) {
                    if ($method === 'post') {
                        $reversal = ['id' => 'trr_f283_' . (++$this->sequence), 'object' => 'transfer_reversal',
                            'amount' => (int) ($params['amount'] ?? 0), 'transfer' => $m[1],
                            'metadata' => $params['metadata'] ?? []];
                        $this->reversals[$m[1]][] = $reversal;

                        return $reversal;
                    }

                    return $this->listOf($this->reversals[$m[1]] ?? [], $path);
                }
                if ($path === '/v1/transfers') {
                    if ($method === 'post') {
                        $transfer = ['id' => 'tr_f283_' . (++$this->sequence), 'object' => 'transfer',
                            'amount' => (int) ($params['amount'] ?? 0), 'currency' => (string) ($params['currency'] ?? 'eur'),
                            'destination' => $params['destination'] ?? null,
                            'transfer_group' => $params['transfer_group'] ?? null,
                            'metadata' => $params['metadata'] ?? []];
                        $this->transfers[$transfer['id']] = $transfer;

                        return $transfer;
                    }
                    $group = $params['transfer_group'] ?? null;

                    return $this->listOf(array_values(array_filter(
                        $this->transfers,
                        static fn (array $t): bool => $group === null || $t['transfer_group'] === $group,
                    )), $path);
                }
                if ($path === '/v1/refunds') {
                    if ($method === 'post') {
                        $refund = ['id' => 're_f283_' . (++$this->sequence), 'object' => 'refund',
                            'amount' => (int) ($params['amount'] ?? 0), 'payment_intent' => $params['payment_intent'] ?? null,
                            'status' => 'succeeded', 'metadata' => $params['metadata'] ?? []];
                        $this->refunds[$refund['id']] = $refund;

                        return $refund;
                    }
                    $pi = $params['payment_intent'] ?? null;

                    return $this->listOf(array_values(array_filter(
                        $this->refunds,
                        static fn (array $r): bool => $pi === null || $r['payment_intent'] === $pi,
                    )), $path);
                }

                throw new \LogicException("unexpected Stripe call {$method} {$path}");
            }

            private function listOf(array $data, string $path): array
            {
                return ['object' => 'list', 'data' => $data, 'has_more' => false, 'url' => $path];
            }

            public function posts(string $pathSuffix): int
            {
                return count(array_filter(
                    $this->requests,
                    static fn (array $r): bool => $r['method'] === 'post' && str_ends_with($r['path'], $pathSuffix),
                ));
            }
        };
        \Stripe\ApiRequestor::setHttpClient($this->stripe);

        app()->instance(EmailDispatchService::class, new class extends EmailDispatchService {
            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                return true;
            }
        });
    }

    protected function tearDown(): void
    {
        \Stripe\ApiRequestor::setHttpClient(null);
        parent::tearDown();
    }

    // -----------------------------------------------------------------
    //  Seller payout (MarketplaceEscrowService::releaseFunds)
    // -----------------------------------------------------------------

    public function test_a_lost_payout_reply_followed_by_a_re_release_sends_exactly_once(): void
    {
        $f = $this->heldEscrow();

        $this->stripe->failNextPost = 'lost_reply';
        $firstError = null;
        try {
            MarketplaceEscrowService::releaseFunds($this->escrow($f['escrow_id']), 'admin_override');
        } catch (\Throwable $e) {
            $firstError = $e;
        }
        $statusAfterLostReply = DB::table('marketplace_payments')->where('id', $f['payment_id'])->value('payout_status');

        // Days later: an admin presses release again (or the hourly cron runs).
        MarketplaceEscrowService::releaseFunds($this->escrow($f['escrow_id']), 'admin_override');

        $this->assertCount(1, $this->stripe->transfers, 'the seller must be paid exactly once');
        $this->assertSame(1, $this->stripe->posts('/v1/transfers'), 'the re-release must not POST the transfer again');
        $this->assertNotNull($firstError, 'the lost reply must surface as an error to the first caller');
        $this->assertNotSame('failed', $statusAfterLostReply, 'an ambiguous outcome must not be recorded as a definite failure');

        $transferId = array_key_first($this->stripe->transfers);
        $this->assertDatabaseHas('marketplace_payments', [
            'id' => $f['payment_id'], 'payout_status' => 'paid', 'payout_id' => $transferId,
        ]);
        $this->assertDatabaseHas('marketplace_escrow', ['id' => $f['escrow_id'], 'status' => 'released']);
        $this->assertDatabaseHas('stripe_money_operations', [
            'operation_key' => "marketplace-payout-{$this->testTenantId}-{$f['payment_id']}",
            'status' => 'succeeded', 'stripe_object_id' => $transferId,
        ]);
    }

    public function test_the_lost_reply_is_recorded_as_unknown_and_the_payout_stays_claimed(): void
    {
        $f = $this->heldEscrow();

        $this->stripe->failNextPost = 'lost_reply';
        try {
            MarketplaceEscrowService::releaseFunds($this->escrow($f['escrow_id']), 'admin_override');
            $this->fail('a lost reply must not look like a success');
        } catch (\RuntimeException) {
        }

        $this->assertDatabaseHas('stripe_money_operations', [
            'operation_key' => "marketplace-payout-{$this->testTenantId}-{$f['payment_id']}",
            'status' => 'unknown', 'kind' => 'marketplace_payout',
        ]);
        $this->assertDatabaseHas('marketplace_payments', ['id' => $f['payment_id'], 'payout_status' => 'scheduled']);
        $this->assertDatabaseHas('marketplace_escrow', ['id' => $f['escrow_id'], 'status' => 'held']);

        // While the payout's outcome is unknown, a refund must wait rather than
        // refund the buyer of money that may already be with the seller.
        $order = MarketplaceOrder::withoutGlobalScopes()->findOrFail($f['order_id']);
        try {
            MarketplacePaymentService::processRefund($order, null, 'buyer asked');
            $this->fail('a refund must wait while the payout outcome is unknown');
        } catch (\RuntimeException) {
        }
        $this->assertSame(0, $this->stripe->posts('/v1/refunds'));
    }

    public function test_a_payout_that_never_reached_stripe_is_sent_once_on_re_release(): void
    {
        $f = $this->heldEscrow();

        $this->stripe->failNextPost = 'not_reached';
        try {
            MarketplaceEscrowService::releaseFunds($this->escrow($f['escrow_id']), 'admin_override');
        } catch (\Throwable) {
        }
        $this->assertCount(0, $this->stripe->transfers);

        MarketplaceEscrowService::releaseFunds($this->escrow($f['escrow_id']), 'admin_override');

        $this->assertCount(1, $this->stripe->transfers, 'a payout Stripe never saw is still paid, once');
        $this->assertDatabaseHas('marketplace_payments', [
            'id' => $f['payment_id'], 'payout_status' => 'paid', 'payout_id' => array_key_first($this->stripe->transfers),
        ]);
    }

    public function test_a_payout_stripe_refused_is_failed_and_can_be_released_again(): void
    {
        $f = $this->heldEscrow();

        $this->stripe->failNextPost = 'refused';
        try {
            MarketplaceEscrowService::releaseFunds($this->escrow($f['escrow_id']), 'admin_override');
        } catch (\Throwable) {
        }
        $this->assertDatabaseHas('marketplace_payments', ['id' => $f['payment_id'], 'payout_status' => 'failed']);
        $this->assertDatabaseHas('stripe_money_operations', [
            'operation_key' => "marketplace-payout-{$this->testTenantId}-{$f['payment_id']}", 'status' => 'failed',
        ]);

        MarketplaceEscrowService::releaseFunds($this->escrow($f['escrow_id']), 'admin_override');

        $this->assertCount(1, $this->stripe->transfers);
        $this->assertDatabaseHas('marketplace_escrow', ['id' => $f['escrow_id'], 'status' => 'released']);
    }

    public function test_an_ordinary_release_sends_one_transfer_without_a_lookup(): void
    {
        $f = $this->heldEscrow();

        MarketplaceEscrowService::releaseFunds($this->escrow($f['escrow_id']), 'admin_override');

        $this->assertCount(1, $this->stripe->transfers);
        $this->assertSame(1, count($this->stripe->requests), 'one call, no look-up, on the ordinary path');
        $transfer = reset($this->stripe->transfers);
        $key = "marketplace-payout-{$this->testTenantId}-{$f['payment_id']}";
        $this->assertSame($key, $transfer['metadata']['nexus_operation_key'] ?? null);
        $this->assertSame($key, $this->idempotencyKey($this->stripe->requests[0]));
        $this->assertDatabaseHas('marketplace_escrow', ['id' => $f['escrow_id'], 'status' => 'released']);
    }

    public function test_a_payout_already_sent_by_older_code_is_adopted_not_resent(): void
    {
        // Before this record existed, a lost reply left payout_status=failed.
        $f = $this->heldEscrow(['payout_status' => 'failed']);
        $this->stripe->transfers['tr_f283_legacy'] = [
            'id' => 'tr_f283_legacy', 'object' => 'transfer', 'amount' => 950, 'currency' => 'eur',
            'destination' => 'acct_f283', 'transfer_group' => 'marketplace_order_' . $f['order_id'],
            'metadata' => [
                'nexus_tenant_id' => (string) $this->testTenantId,
                'nexus_order_id' => (string) $f['order_id'],
                'nexus_payment_id' => (string) $f['payment_id'],
                'nexus_type' => 'marketplace_payout',
            ],
        ];

        MarketplaceEscrowService::releaseFunds($this->escrow($f['escrow_id']), 'admin_override');

        $this->assertSame(0, $this->stripe->posts('/v1/transfers'), 'the earlier transfer must be found, not repeated');
        $this->assertDatabaseHas('marketplace_payments', [
            'id' => $f['payment_id'], 'payout_status' => 'paid', 'payout_id' => 'tr_f283_legacy',
        ]);
    }

    // -----------------------------------------------------------------
    //  Buyer refund (MarketplacePaymentService::processRefund)
    // -----------------------------------------------------------------

    public function test_a_lost_refund_reply_followed_by_a_retry_refunds_exactly_once(): void
    {
        $f = $this->paidDestinationChargeOrder();
        $order = MarketplaceOrder::withoutGlobalScopes()->findOrFail($f['order_id']);

        $this->stripe->failNextPost = 'lost_reply';
        try {
            MarketplacePaymentService::processRefund($order, null, 'buyer asked');
        } catch (\Throwable) {
        }

        MarketplacePaymentService::processRefund($order->fresh(), null, 'buyer asked');

        $this->assertCount(1, $this->stripe->refunds, 'the buyer must be refunded exactly once');
        $refundId = array_key_first($this->stripe->refunds);
        $this->assertDatabaseHas('marketplace_payment_refunds', ['payment_id' => $f['payment_id'], 'stripe_refund_id' => $refundId]);
        $this->assertDatabaseHas('marketplace_payments', ['id' => $f['payment_id'], 'status' => 'refunded']);
    }

    public function test_a_different_refund_waits_while_an_earlier_one_may_have_gone_through(): void
    {
        $f = $this->paidDestinationChargeOrder();
        $order = MarketplaceOrder::withoutGlobalScopes()->findOrFail($f['order_id']);

        $this->stripe->failNextPost = 'lost_reply';
        try {
            MarketplacePaymentService::processRefund($order, 5.0, 'part refund');
        } catch (\Throwable) {
        }

        try {
            MarketplacePaymentService::processRefund($order->fresh(), 3.0, 'a different part refund');
            $this->fail('a new refund must wait while an earlier one is unrecorded but real');
        } catch (\RuntimeException) {
        }

        $this->assertCount(1, $this->stripe->refunds, 'no second refund while the first is unrecorded');
        $this->assertDatabaseHas('stripe_money_operations', [
            'subject_id' => $f['payment_id'], 'kind' => 'marketplace_refund', 'status' => 'succeeded',
            'stripe_object_id' => array_key_first($this->stripe->refunds),
        ]);
    }

    public function test_a_different_refund_proceeds_once_the_earlier_one_is_confirmed_absent(): void
    {
        $f = $this->paidDestinationChargeOrder();
        $order = MarketplaceOrder::withoutGlobalScopes()->findOrFail($f['order_id']);

        $this->stripe->failNextPost = 'not_reached';
        try {
            MarketplacePaymentService::processRefund($order, 5.0, 'part refund');
        } catch (\Throwable) {
        }

        MarketplacePaymentService::processRefund($order->fresh(), 3.0, 'a different part refund');

        $this->assertCount(1, $this->stripe->refunds);
        $this->assertSame(300, (int) reset($this->stripe->refunds)['amount']);
        $this->assertDatabaseHas('marketplace_payments', ['id' => $f['payment_id'], 'status' => 'partially_refunded']);
    }

    public function test_an_ordinary_refund_is_sent_once(): void
    {
        $f = $this->paidDestinationChargeOrder();

        MarketplacePaymentService::processRefund(
            MarketplaceOrder::withoutGlobalScopes()->findOrFail($f['order_id']),
            null,
            'buyer asked',
        );

        $this->assertCount(1, $this->stripe->refunds);
        $this->assertSame(1, count($this->stripe->requests));
        $this->assertDatabaseHas('marketplace_payments', ['id' => $f['payment_id'], 'status' => 'refunded']);
    }

    // -----------------------------------------------------------------
    //  Won-dispute reimbursement (webhook re-entry)
    // -----------------------------------------------------------------

    public function test_a_lost_dispute_reimbursement_reply_is_not_resent_on_webhook_retry(): void
    {
        $f = $this->heldEscrow(['payout_status' => 'paid', 'payout_id' => 'tr_f283_original', 'paid_out_at' => now()]);
        $chargeId = DB::table('marketplace_payments')->where('id', $f['payment_id'])->value('stripe_charge_id');
        $dispute = (object) ['id' => 'dp_f283_' . uniqid(), 'charge' => $chargeId, 'amount' => 1000, 'status' => 'needs_response'];

        MarketplacePaymentService::handleWebhookEvent('charge.dispute.created', $dispute);
        $this->assertCount(1, $this->stripe->reversals['tr_f283_original'] ?? []);

        $won = clone $dispute;
        $won->status = 'won';
        $this->stripe->failNextPost = 'lost_reply';
        try {
            MarketplacePaymentService::handleWebhookEvent('charge.dispute.closed', $won);
        } catch (\Throwable) {
        }

        // Stripe re-delivers the failed event (or someone presses Resend) days later.
        MarketplacePaymentService::handleWebhookEvent('charge.dispute.closed', $won);

        $this->assertCount(1, $this->stripe->transfers, 'the seller must be reimbursed exactly once');
        $this->assertSame(1, $this->stripe->posts('/v1/transfers'));
        $this->assertDatabaseHas('marketplace_payment_refunds', [
            'stripe_refund_id' => 'dispute:' . $won->id, 'reason' => 'stripe_dispute_won',
        ]);
    }

    // -----------------------------------------------------------------
    //  Fixtures
    // -----------------------------------------------------------------

    /** @return array{order_id:int,payment_id:int,escrow_id:int,seller_id:int} */
    private function heldEscrow(array $payment = []): array
    {
        $buyer = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $seller = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        DB::table('marketplace_seller_profiles')->insert([
            'tenant_id' => $this->testTenantId, 'user_id' => $seller->id, 'seller_type' => 'private',
            'stripe_account_id' => 'acct_f283', 'stripe_onboarding_complete' => 1,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $orderId = $this->order($buyer, $seller, 'delivered');
        $paymentId = (int) DB::table('marketplace_payments')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId, 'order_id' => $orderId,
            'stripe_payment_intent_id' => DB::table('marketplace_orders')->where('id', $orderId)->value('payment_intent_id'),
            'stripe_charge_id' => 'ch_' . uniqid(), 'funds_flow' => 'separate_charge_transfer',
            'amount' => 10.00, 'currency' => 'EUR', 'platform_fee' => 0.50, 'seller_payout' => 9.50,
            'status' => 'succeeded', 'payout_status' => 'pending', 'created_at' => now(), 'updated_at' => now(),
        ], $payment));
        $escrowId = (int) DB::table('marketplace_escrow')->insertGetId([
            'tenant_id' => $this->testTenantId, 'order_id' => $orderId, 'payment_id' => $paymentId,
            'amount' => 9.50, 'currency' => 'EUR', 'status' => 'held', 'held_at' => now()->subDays(3),
            'release_after' => now()->subHour(), 'created_at' => now(), 'updated_at' => now(),
        ]);

        return ['order_id' => $orderId, 'payment_id' => $paymentId, 'escrow_id' => $escrowId, 'seller_id' => (int) $seller->id];
    }

    /** @return array{order_id:int,payment_id:int} */
    private function paidDestinationChargeOrder(): array
    {
        $buyer = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $seller = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $orderId = $this->order($buyer, $seller, 'paid');
        $paymentId = (int) DB::table('marketplace_payments')->insertGetId([
            'tenant_id' => $this->testTenantId, 'order_id' => $orderId,
            'stripe_payment_intent_id' => DB::table('marketplace_orders')->where('id', $orderId)->value('payment_intent_id'),
            'stripe_charge_id' => 'ch_' . uniqid(), 'funds_flow' => 'destination_charge',
            'amount' => 10.00, 'currency' => 'EUR', 'platform_fee' => 0.50, 'seller_payout' => 9.50,
            'status' => 'succeeded', 'payout_status' => 'paid', 'created_at' => now(), 'updated_at' => now(),
        ]);

        return ['order_id' => $orderId, 'payment_id' => $paymentId];
    }

    private function order(User $buyer, User $seller, string $status): int
    {
        $listingId = (int) DB::table('marketplace_listings')->insertGetId([
            'tenant_id' => $this->testTenantId, 'user_id' => $seller->id, 'title' => 'F-283 fixture',
            'description' => 'F-283 regression fixture.', 'price' => 10.00, 'price_currency' => 'EUR',
            'price_type' => 'fixed', 'quantity' => 1, 'inventory_count' => 0, 'status' => 'sold',
            'moderation_status' => 'approved', 'seller_type' => 'private', 'created_at' => now(), 'updated_at' => now(),
        ]);

        return (int) DB::table('marketplace_orders')->insertGetId([
            'tenant_id' => $this->testTenantId, 'order_number' => 'MKT-F283-' . strtoupper(uniqid('', true)),
            'buyer_id' => $buyer->id, 'seller_id' => $seller->id, 'marketplace_listing_id' => $listingId,
            'quantity' => 1, 'unit_price' => 10.00, 'total_price' => 10.00, 'currency' => 'EUR',
            'status' => $status, 'payment_intent_id' => 'pi_' . uniqid(), 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function escrow(int $id): MarketplaceEscrow
    {
        return MarketplaceEscrow::withoutGlobalScopes()->findOrFail($id);
    }

    private function idempotencyKey(array $request): string
    {
        foreach ($request['headers'] as $header) {
            if (stripos((string) $header, 'Idempotency-Key:') === 0) {
                return trim(substr((string) $header, strlen('Idempotency-Key:')));
            }
        }

        return '';
    }
}
