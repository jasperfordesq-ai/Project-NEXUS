<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\Events\TransactionCompleted;
use App\Models\MarketplaceOrder;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use RuntimeException;
use Throwable;

/** Atomic buyer-to-seller wallet settlement for time-credit marketplace orders. */
final class MarketplaceTimeCreditSettlementService
{
    public function settle(MarketplaceOrder $order): MarketplaceOrder
    {
        $tenantId = (int) ($order->tenant_id ?: TenantContext::getId());

        /** @var array{0:MarketplaceOrder,1:Transaction|null,2:User|null,3:User|null} $result */
        $result = TenantContext::runForTenant($tenantId, function () use ($order, $tenantId): array {
            return DB::transaction(function () use ($order, $tenantId): array {
                $lockedOrder = MarketplaceOrder::withoutGlobalScopes()
                    ->where('tenant_id', $tenantId)
                    ->whereKey($order->id)
                    ->lockForUpdate()
                    ->firstOrFail();

                if ($lockedOrder->wallet_transaction_id !== null) {
                    return [$lockedOrder, null, null, null];
                }
                if ($lockedOrder->status !== 'pending_payment') {
                    throw new RuntimeException(__('api.marketplace_time_credit_order_invalid_state'));
                }

                $amount = round((float) $lockedOrder->time_credits_used, 2);
                if ($amount <= 0) {
                    throw new RuntimeException(__('api.marketplace_time_credit_order_invalid_amount'));
                }

                $buyerId = (int) $lockedOrder->buyer_id;
                $sellerId = (int) $lockedOrder->seller_id;
                foreach ([min($buyerId, $sellerId), max($buyerId, $sellerId)] as $userId) {
                    User::withoutGlobalScopes()
                        ->where('tenant_id', $tenantId)
                        ->whereKey($userId)
                        ->lockForUpdate()
                        ->firstOrFail();
                }

                $buyer = User::withoutGlobalScopes()
                    ->where('tenant_id', $tenantId)
                    ->whereKey($buyerId)
                    ->firstOrFail();
                $seller = User::withoutGlobalScopes()
                    ->where('tenant_id', $tenantId)
                    ->whereKey($sellerId)
                    ->firstOrFail();
                if (!WalletService::canReceiveCredits((string) $seller->status)) {
                    throw new RuntimeException(__('api.wallet_transfer_recipient_inactive'));
                }
                if ((float) $buyer->balance < $amount) {
                    throw new RuntimeException(__('api.wallet_transfer_insufficient_balance'));
                }

                $transaction = new Transaction();
                $transaction->tenant_id = $tenantId;
                $transaction->sender_id = $buyerId;
                $transaction->receiver_id = $sellerId;
                $transaction->amount = $amount;
                $transaction->description = __('api.marketplace_time_credit_order_description', [
                    'order' => $lockedOrder->order_number,
                ]);
                $transaction->transaction_type = 'marketplace_purchase';
                $transaction->status = 'completed';
                $transaction->save();

                $buyer->decrement('balance', $amount);
                $seller->increment('balance', $amount);

                $lockedOrder->wallet_transaction_id = $transaction->id;
                $lockedOrder->status = 'paid';
                $lockedOrder->payment_expires_at = null;
                $lockedOrder->save();

                return [
                    $lockedOrder,
                    $transaction->fresh(['sender', 'receiver']),
                    $buyer->fresh(),
                    $seller->fresh(),
                ];
            });
        });

        [$settledOrder, $transaction, $buyer, $seller] = $result;
        if ($transaction && $buyer && $seller) {
            try {
                WalletAlertService::checkAndSendLowBalanceAlert(
                    $tenantId,
                    (int) $buyer->id,
                    (float) $buyer->balance,
                );
                event(new TransactionCompleted($transaction, $buyer, $seller, $tenantId));
            } catch (Throwable $exception) {
                Log::warning('[MarketplaceTimeCreditSettlement] post-commit notification failed', [
                    'order_id' => $settledOrder->id,
                    'transaction_id' => $transaction->id,
                    'error' => $exception->getMessage(),
                ]);
            }
        }

        return $settledOrder;
    }

    /**
     * Reverse a settled time-credit order exactly once.
     *
     * Time-credit refunds are deliberately full-order reversals. A separate
     * compensating transaction preserves the immutable wallet ledger while the
     * order-level unique reference makes retries idempotent.
     */
    public function refund(MarketplaceOrder $order, string $reason): MarketplaceOrder
    {
        $tenantId = (int) ($order->tenant_id ?: TenantContext::getId());

        /** @var array{0:MarketplaceOrder,1:Transaction|null,2:User|null,3:User|null} $result */
        $result = TenantContext::runForTenant($tenantId, function () use ($order, $reason, $tenantId): array {
            return DB::transaction(function () use ($order, $reason, $tenantId): array {
                $lockedOrder = MarketplaceOrder::withoutGlobalScopes()
                    ->where('tenant_id', $tenantId)
                    ->whereKey($order->id)
                    ->lockForUpdate()
                    ->firstOrFail();

                if ($lockedOrder->wallet_refund_transaction_id !== null) {
                    return [$lockedOrder, null, null, null];
                }
                if ($lockedOrder->wallet_transaction_id === null
                    || ! in_array((string) $lockedOrder->status, ['paid', 'shipped', 'delivered', 'completed', 'disputed'], true)) {
                    throw new RuntimeException(__('api.marketplace_time_credit_refund_invalid_state'));
                }

                $originalTransaction = Transaction::withoutGlobalScopes()
                    ->where('tenant_id', $tenantId)
                    ->whereKey($lockedOrder->wallet_transaction_id)
                    ->where('transaction_type', 'marketplace_purchase')
                    ->where('status', 'completed')
                    ->lockForUpdate()
                    ->firstOrFail();
                $amount = round((float) $originalTransaction->amount, 2);
                if ($amount <= 0) {
                    throw new RuntimeException(__('api.marketplace_time_credit_order_invalid_amount'));
                }

                $buyerId = (int) $lockedOrder->buyer_id;
                $sellerId = (int) $lockedOrder->seller_id;
                foreach ([min($buyerId, $sellerId), max($buyerId, $sellerId)] as $userId) {
                    User::withoutGlobalScopes()
                        ->where('tenant_id', $tenantId)
                        ->whereKey($userId)
                        ->lockForUpdate()
                        ->firstOrFail();
                }

                $buyer = User::withoutGlobalScopes()
                    ->where('tenant_id', $tenantId)
                    ->whereKey($buyerId)
                    ->firstOrFail();
                $seller = User::withoutGlobalScopes()
                    ->where('tenant_id', $tenantId)
                    ->whereKey($sellerId)
                    ->firstOrFail();

                $refund = new Transaction();
                $refund->tenant_id = $tenantId;
                $refund->sender_id = $sellerId;
                $refund->receiver_id = $buyerId;
                $refund->amount = $amount;
                $refund->description = __('api.marketplace_time_credit_refund_description', [
                    'order' => $lockedOrder->order_number,
                    'reason' => $reason,
                ]);
                $refund->transaction_type = 'marketplace_refund';
                $refund->status = 'completed';
                $refund->save();

                // A refund must make the buyer whole even when the seller has
                // spent the received credits; timebank balances may therefore
                // go negative as an explicit debt represented by the ledger.
                $seller->decrement('balance', $amount);
                $buyer->increment('balance', $amount);

                $lockedOrder->wallet_refund_transaction_id = $refund->id;
                $lockedOrder->status = 'refunded';
                $lockedOrder->save();

                MarketplaceOrderService::restoreInventoryForRefund($lockedOrder);

                return [
                    $lockedOrder,
                    $refund->fresh(['sender', 'receiver']),
                    $seller->fresh(),
                    $buyer->fresh(),
                ];
            });
        });

        [$refundedOrder, $transaction, $sender, $receiver] = $result;
        if ($transaction && $sender && $receiver) {
            try {
                event(new TransactionCompleted($transaction, $sender, $receiver, $tenantId));
            } catch (Throwable $exception) {
                Log::warning('[MarketplaceTimeCreditSettlement] refund notification failed', [
                    'order_id' => $refundedOrder->id,
                    'transaction_id' => $transaction->id,
                    'error' => $exception->getMessage(),
                ]);
            }
        }

        return $refundedOrder;
    }
}
