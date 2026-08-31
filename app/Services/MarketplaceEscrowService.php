<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\MarketplaceEscrow;
use App\Models\MarketplaceOrder;
use App\Models\MarketplacePayment;
use App\Models\MarketplaceSellerProfile;
use App\Models\Notification;
use App\Support\StripeCurrency;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/**
 * MarketplaceEscrowService — Escrow lifecycle for marketplace payments.
 *
 * Manages fund holds between payment and seller payout: hold on payment,
 * release on buyer confirmation / auto-timeout / admin override,
 * and refund on dispute resolution.
 */
class MarketplaceEscrowService
{
    // -----------------------------------------------------------------
    //  Escrow lifecycle
    // -----------------------------------------------------------------

    /**
     * Create an escrow hold for a paid order.
     *
     * Sets the release_after date based on the tenant's escrow config
     * (default 14 days).
     *
     * @param MarketplaceOrder   $order   The paid order
     * @param MarketplacePayment $payment The succeeded payment
     * @return MarketplaceEscrow
     */
    public static function holdFunds(MarketplaceOrder $order, MarketplacePayment $payment): MarketplaceEscrow
    {
        if ($payment->funds_flow !== 'separate_charge_transfer') {
            throw new \InvalidArgumentException(
                __('api.marketplace_escrow_separate_charge_required'),
            );
        }
        if (! in_array($payment->status, ['succeeded', 'partially_refunded'], true)
            || empty($payment->stripe_charge_id)) {
            throw new \InvalidArgumentException(__('api.marketplace_escrow_captured_charge_required'));
        }
        // Idempotency: check if escrow already exists for this order
        $existing = MarketplaceEscrow::where('order_id', $order->id)->first();
        if ($existing) {
            return $existing;
        }

        $autoReleaseDays = (int) MarketplaceConfigurationService::get(
            MarketplaceConfigurationService::CONFIG_ESCROW_AUTO_RELEASE_DAYS,
            14
        );

        $escrow = new MarketplaceEscrow();
        $escrow->order_id = $order->id;
        $escrow->payment_id = $payment->id;
        $escrow->amount = $payment->seller_payout;
        $escrow->currency = $payment->currency;
        $escrow->status = 'held';
        $escrow->held_at = now();
        $escrow->release_after = now()->addDays($autoReleaseDays);

        try {
            $escrow->save();
        } catch (\Illuminate\Database\UniqueConstraintViolationException) {
            // UNIQUE(order_id) backstop: a concurrent holdFunds won the
            // race between our exists-check and save — return its row.
            return MarketplaceEscrow::where('order_id', $order->id)->firstOrFail();
        }

        Log::info('MarketplaceEscrow: funds held', [
            'escrow_id' => $escrow->id,
            'order_id' => $order->id,
            'payment_id' => $payment->id,
            'amount' => $escrow->amount,
            'release_after' => $escrow->release_after->toISOString(),
        ]);

        return $escrow;
    }

    /**
     * Release escrowed funds to the seller.
     *
     * Triggers a Stripe Transfer to the seller's connected account
     * and updates the payment record's payout status.
     *
     * @param MarketplaceEscrow $escrow  The escrow to release
     * @param string            $trigger One of: buyer_confirmed, auto_timeout, admin_override, dispute_resolved
     */
    public static function releaseFunds(MarketplaceEscrow $escrow, string $trigger): void
    {
        $tenantId = (int) ($escrow->tenant_id ?: TenantContext::getId());
        try {
            Cache::lock("marketplace-money-movement:{$tenantId}:{$escrow->payment_id}", 180)
                ->block(10, static function () use ($escrow, $trigger): void {
                    self::releaseFundsLocked($escrow, $trigger);
                });
        } catch (\Illuminate\Contracts\Cache\LockTimeoutException $exception) {
            throw new \RuntimeException(__('api.marketplace_payout_processing'), previous: $exception);
        }
    }

    /** Release funds while holding the cross-process payment movement claim. */
    private static function releaseFundsLocked(MarketplaceEscrow $escrow, string $trigger): void
    {
        if ($escrow->status === 'released') {
            return;
        }
        if ($escrow->status !== 'held') {
            throw new \InvalidArgumentException(__('api.marketplace_escrow_not_held', ['status' => $escrow->status]));
        }

        $validTriggers = ['buyer_confirmed', 'auto_timeout', 'admin_override', 'dispute_resolved'];
        if (!in_array($trigger, $validTriggers, true)) {
            throw new \InvalidArgumentException(__('api.marketplace_escrow_invalid_release_trigger', ['trigger' => $trigger]));
        }

        $tenantId = (int) ($escrow->tenant_id ?: TenantContext::getId());
        $context = DB::transaction(function () use ($escrow, $tenantId, $trigger): array {
            $lockedEscrow = MarketplaceEscrow::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereKey($escrow->id)
                ->lockForUpdate()
                ->firstOrFail();
            $payment = MarketplacePayment::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereKey($lockedEscrow->payment_id)
                ->lockForUpdate()
                ->firstOrFail();
            $order = MarketplaceOrder::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereKey($lockedEscrow->order_id)
                ->lockForUpdate()
                ->firstOrFail();

            if ($lockedEscrow->status === 'released' && $payment->payout_id) {
                return [$lockedEscrow, $payment, $order, true];
            }
            if ($lockedEscrow->status !== 'held') {
                throw new \InvalidArgumentException(
                    __('api.marketplace_escrow_not_held', ['status' => $lockedEscrow->status]),
                );
            }
            $hasActiveDispute = DB::table('marketplace_disputes')
                ->where('tenant_id', $tenantId)
                ->where('order_id', $lockedEscrow->order_id)
                ->whereIn('status', ['open', 'under_review', 'escalated'])
                ->exists();
            if ($hasActiveDispute) {
                throw new \InvalidArgumentException(__('api.marketplace_escrow_dispute_active'));
            }
            if ($trigger === 'auto_timeout'
                && ($order->status !== 'delivered'
                    || $order->auto_complete_at === null
                    || $order->auto_complete_at->isFuture()
                    || $lockedEscrow->release_after === null
                    || $lockedEscrow->release_after->isFuture())) {
                throw new \InvalidArgumentException(__('api.marketplace_escrow_transfer_ineligible'));
            }
            if ($payment->funds_flow !== 'separate_charge_transfer'
                || ! in_array($payment->status, ['succeeded', 'partially_refunded'], true)
                || empty($payment->stripe_charge_id)) {
                throw new \RuntimeException(__('api.marketplace_escrow_transfer_ineligible'));
            }

            $payment->payout_status = 'scheduled';
            $payment->save();
            return [$lockedEscrow, $payment, $order, false];
        });

        /** @var MarketplaceEscrow $claimedEscrow */
        /** @var MarketplacePayment $payment */
        /** @var MarketplaceOrder $order */
        [$claimedEscrow, $payment, $order, $alreadyReleased] = $context;
        if ($alreadyReleased) {
            return;
        }

        $sellerProfile = MarketplaceSellerProfile::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('user_id', $order->seller_id)
            ->first();
        if (! $sellerProfile || ! $sellerProfile->stripe_onboarding_complete
            || empty($sellerProfile->stripe_account_id)) {
            MarketplacePayment::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereKey($payment->id)
                ->where('payout_status', 'scheduled')
                ->update(['payout_status' => 'failed']);
            throw new \RuntimeException(__('api.marketplace_escrow_seller_payout_unavailable'));
        }

        $client = StripeService::client();
        try {
            $transfer = $client->transfers->create([
                'amount' => StripeCurrency::toMinor(
                    (float) $claimedEscrow->amount,
                    (string) $claimedEscrow->currency,
                ),
                'currency' => strtolower((string) $claimedEscrow->currency),
                'destination' => $sellerProfile->stripe_account_id,
                'source_transaction' => $payment->stripe_charge_id,
                'transfer_group' => 'marketplace_order_' . $order->id,
                'metadata' => [
                    'nexus_tenant_id' => (string) $tenantId,
                    'nexus_order_id' => (string) $order->id,
                    'nexus_payment_id' => (string) $payment->id,
                    'nexus_type' => 'marketplace_payout',
                ],
            ], [
                'idempotency_key' => "marketplace-payout-{$tenantId}-{$payment->id}",
            ]);
        } catch (\Throwable $exception) {
            MarketplacePayment::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereKey($payment->id)
                ->where('payout_status', 'scheduled')
                ->update(['payout_status' => 'failed']);
            Log::error('MarketplaceEscrow: Stripe transfer failed', [
                'escrow_id' => $escrow->id,
                'payment_id' => $payment->id,
                'order_id' => $order->id,
                'error' => $exception->getMessage(),
            ]);
            throw new \RuntimeException(__('api.marketplace_payout_failed'));
        }

        $stateChangedAfterTransfer = false;
        DB::transaction(function () use (
            $claimedEscrow,
            $payment,
            $trigger,
            $transfer,
            $tenantId,
            &$stateChangedAfterTransfer,
        ): void {
            $lockedEscrow = MarketplaceEscrow::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereKey($claimedEscrow->id)
                ->lockForUpdate()
                ->firstOrFail();
            $lockedPayment = MarketplacePayment::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereKey($payment->id)
                ->lockForUpdate()
                ->firstOrFail();
            if ($lockedEscrow->status === 'released'
                && $lockedPayment->payout_status === 'paid'
                && (string) $lockedPayment->payout_id === (string) $transfer->id) {
                return;
            }
            // Persist the remote transfer identity before interpreting any
            // concurrently changed escrow state. This makes compensation and
            // webhook recovery possible even if another state transition won.
            $lockedPayment->payout_status = 'paid';
            $lockedPayment->payout_id = (string) $transfer->id;
            $lockedPayment->paid_out_at = now();
            $lockedPayment->save();

            if ($lockedEscrow->status !== 'held') {
                $stateChangedAfterTransfer = true;
                return;
            }

            $lockedEscrow->status = 'released';
            $lockedEscrow->released_at = now();
            $lockedEscrow->release_trigger = $trigger;
            $lockedEscrow->save();
        });
        if ($stateChangedAfterTransfer) {
            throw new \RuntimeException(__('api.marketplace_escrow_state_changed'));
        }

        $escrow->refresh();
        $order->refresh();
        if (in_array($order->status, ['delivered', 'paid', 'shipped'], true)) {
            MarketplaceOrderService::complete($order);
        }

        Log::info('MarketplaceEscrow: funds released', [
            'escrow_id' => $escrow->id,
            'order_id' => $escrow->order_id,
            'trigger' => $trigger,
            'amount' => $escrow->amount,
        ]);

        // P0.2: tell the seller their payout was released — previously silent.
        // Tenant-safe (createNotification forces the recipient's tenant_id),
        // rendered in the seller's language, and fail-safe so a bell error can
        // never unwind the already-committed release.
        try {
            $order = $escrow->order;
            $sellerId = (int) ($order->seller_id ?? 0);
            if ($order && $sellerId > 0) {
                $seller = DB::table('users')
                    ->where('id', $sellerId)
                    ->where('tenant_id', $order->tenant_id)
                    ->select(['id', 'preferred_language'])
                    ->first();
                LocaleContext::withLocale($seller, function () use ($sellerId, $escrow, $order) {
                    Notification::createNotification(
                        $sellerId,
                        __('svc_notifications.marketplace_payout.payout_sent_bell', [
                            'amount' => $escrow->amount,
                            'order'  => $order->id,
                        ]),
                        '/marketplace/orders/sales?order_id=' . $order->id,
                        'marketplace_payout'
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) ($sellerId), 'marketplace_payout', __('svc_notifications.marketplace_payout.payout_sent_bell', [
                        'amount' => $escrow->amount,
                        'order'  => $order->id,
                    ]), '/marketplace/orders/sales?order_id=' . $order->id);
                });
            }
        } catch (\Throwable $e) {
            Log::warning('MarketplaceEscrow: seller payout bell failed', [
                'escrow_id' => $escrow->id,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Refund escrowed funds back to the buyer.
     *
     * Marks the escrow as refunded. The actual Stripe refund should be
     * handled by MarketplacePaymentService::processRefund() before calling this.
     *
     * @param MarketplaceEscrow $escrow The escrow to refund
     */
    public static function refundEscrow(MarketplaceEscrow $escrow): void
    {
        if (!in_array($escrow->status, ['held', 'disputed'], true)) {
            throw new \InvalidArgumentException(__('api.marketplace_escrow_refund_status_invalid', ['status' => $escrow->status]));
        }

        DB::transaction(function () use ($escrow) {
            $payment = MarketplacePayment::withoutGlobalScopes()
                ->where('tenant_id', $escrow->tenant_id)
                ->whereKey($escrow->payment_id)
                ->lockForUpdate()
                ->first();
            if ($payment && in_array($payment->payout_status, ['scheduled', 'paid'], true)) {
                throw new \InvalidArgumentException(
                    __('api.marketplace_escrow_payout_refund_flow_required'),
                );
            }

            // Atomic claim — the in-memory status check above can race a
            // concurrent releaseFunds() (buyer confirm / auto-release cron).
            // An unconditional save() here would overwrite 'released' with
            // 'refunded' AFTER the seller was paid: buyer refunded AND seller
            // paid out for the same order. Exactly one transition wins.
            $claimed = MarketplaceEscrow::query()
                ->whereKey($escrow->id)
                ->whereIn('status', ['held', 'disputed'])
                ->update([
                    'status' => 'refunded',
                    'released_at' => now(),
                    'release_trigger' => null,
                ]);

            if ($claimed === 0) {
                $escrow->refresh();
                throw new \InvalidArgumentException(__('api.marketplace_escrow_refund_status_invalid', ['status' => $escrow->status]));
            }

            $escrow->refresh();

            // Update payment payout status
            if ($payment) {
                $payment->payout_status = 'failed';
                $payment->save();
            }
        });

        Log::info('MarketplaceEscrow: funds refunded', [
            'escrow_id' => $escrow->id,
            'order_id' => $escrow->order_id,
            'amount' => $escrow->amount,
        ]);
    }

    /**
     * Process auto-releases for escrows past their release_after date.
     *
     * Intended to be run as a scheduled job (hourly). Releases all escrows
     * where release_after has passed, the order is in an appropriate state,
     * and no dispute is open.
     *
     * @return int Number of escrows released
     */
    public static function processAutoReleases(): int
    {
        $count = 0;

        // Query across all tenants — use withoutGlobalScopes to bypass tenant scope
        $escrows = MarketplaceEscrow::withoutGlobalScopes()
            ->where('status', 'held')
            ->where('release_after', '<=', now())
            ->limit(100) // Process in batches to avoid long-running queries
            ->get();

        foreach ($escrows as $escrow) {
            $previousTenantId = TenantContext::currentId();

            try {
                // Set tenant context before any scoped operations
                TenantContext::setById($escrow->tenant_id);

                // Check for open disputes on this order
                $hasDispute = DB::table('marketplace_disputes')
                    ->where('tenant_id', $escrow->tenant_id)
                    ->where('order_id', $escrow->order_id)
                    ->whereIn('status', ['open', 'under_review', 'escalated'])
                    ->exists();

                if ($hasDispute) {
                    Log::info('MarketplaceEscrow: auto-release blocked by open dispute', [
                        'escrow_id' => $escrow->id,
                        'order_id' => $escrow->order_id,
                    ]);
                    continue;
                }

                // Payment age alone is not delivery evidence. Auto-release is
                // eligible only after the buyer-confirmed completion window;
                // admin/dispute release triggers remain available separately.
                $orderReady = DB::table('marketplace_orders')
                    ->where('tenant_id', $escrow->tenant_id)
                    ->where('id', $escrow->order_id)
                    ->where('status', 'delivered')
                    ->whereNotNull('auto_complete_at')
                    ->where('auto_complete_at', '<=', now())
                    ->exists();
                if (! $orderReady) {
                    continue;
                }

                self::releaseFunds($escrow, 'auto_timeout');
                $count++;
            } catch (\Exception $e) {
                Log::error('MarketplaceEscrow: auto-release failed', [
                    'escrow_id' => $escrow->id,
                    'order_id' => $escrow->order_id,
                    'error' => $e->getMessage(),
                ]);
            } finally {
                if ($previousTenantId !== null) {
                    TenantContext::setById($previousTenantId);
                } else {
                    TenantContext::reset();
                }
            }
        }

        if ($count > 0) {
            Log::info('MarketplaceEscrow: auto-release batch completed', [
                'released_count' => $count,
            ]);
        }

        return $count;
    }

    // -----------------------------------------------------------------
    //  Read
    // -----------------------------------------------------------------

    /**
     * Get the escrow record for an order.
     *
     * @param int $orderId Order ID
     * @return MarketplaceEscrow|null
     */
    public static function getByOrderId(int $orderId): ?MarketplaceEscrow
    {
        return MarketplaceEscrow::where('order_id', $orderId)->first();
    }
}
