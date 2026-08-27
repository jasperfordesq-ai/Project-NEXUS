<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\MarketplaceDispute;
use App\Models\MarketplaceOrder;
use App\Models\Notification;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use InvalidArgumentException;
use RuntimeException;
use App\Support\UserDisplayName;

/** Admin review and resolution for marketplace order disputes. */
final class MarketplaceDisputeService
{
    /**
     * @return array{items:array<int,array<string,mixed>>,total:int,page:int,per_page:int}
     */
    public function paginate(?string $status, int $page, int $perPage): array
    {
        $query = MarketplaceDispute::query()->with([
            'openedBy:id,first_name,last_name,profile_type,organization_name,avatar_url',
            'order:id,order_number,buyer_id,seller_id,marketplace_listing_id,total_price,currency,time_credits_used,status',
            'order.listing:id,title',
            'order.buyer:id,first_name,last_name,profile_type,organization_name,avatar_url',
            'order.seller:id,first_name,last_name,profile_type,organization_name,avatar_url',
        ]);

        if ($status !== null && $status !== '') {
            $query->where('status', $status);
        } else {
            $query->whereIn('status', ['open', 'under_review', 'escalated']);
        }

        $total = (clone $query)->count();
        $items = $query->orderBy('created_at')
            ->forPage($page, $perPage)
            ->get()
            ->map(fn (MarketplaceDispute $dispute): array => $this->format($dispute))
            ->all();

        return [
            'items' => $items,
            'total' => $total,
            'page' => $page,
            'per_page' => $perPage,
        ];
    }

    /**
     * @param array{resolution:string,resolution_notes:string,refund_amount?:float|null} $data
     */
    public function resolve(int $disputeId, int $adminId, array $data): MarketplaceDispute
    {
        $tenantId = (int) TenantContext::getId();
        $dispute = MarketplaceDispute::query()
            ->with('order')
            ->whereKey($disputeId)
            ->firstOrFail();
        if (! in_array((string) $dispute->status, ['open', 'under_review', 'escalated'], true)) {
            throw new InvalidArgumentException(__('api.marketplace_dispute_already_resolved'));
        }

        $claimed = MarketplaceDispute::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($disputeId)
            ->whereIn('status', ['open', 'under_review', 'escalated'])
            ->where(function ($query) use ($adminId): void {
                $query->whereNull('resolved_by')->orWhere('resolved_by', $adminId);
            })
            ->update([
                'status' => 'under_review',
                'resolved_by' => $adminId,
                'updated_at' => now(),
            ]);
        if ($claimed !== 1) {
            throw new InvalidArgumentException(__('api.marketplace_dispute_resolution_claimed'));
        }
        $dispute->status = 'under_review';
        $dispute->resolved_by = $adminId;

        $resolution = (string) $data['resolution'];
        if (! in_array($resolution, ['buyer', 'seller', 'closed'], true)) {
            throw new InvalidArgumentException(__('api.marketplace_dispute_invalid_resolution'));
        }

        $order = $dispute->order;
        if (! $order) {
            throw new RuntimeException(__('api.marketplace_order_not_found'));
        }

        $refundAmount = isset($data['refund_amount']) ? (float) $data['refund_amount'] : null;
        if ($resolution !== 'buyer' && $refundAmount !== null) {
            throw new InvalidArgumentException(__('api.marketplace_dispute_refund_buyer_only'));
        }

        if ($resolution === 'buyer') {
            if ($order->wallet_transaction_id !== null) {
                $fullAmount = round((float) $order->time_credits_used, 2);
                if ($refundAmount !== null && abs($refundAmount - $fullAmount) > 0.005) {
                    throw new InvalidArgumentException(__('api.marketplace_dispute_time_credit_full_refund_only'));
                }
                $order = app(MarketplaceTimeCreditSettlementService::class)
                    ->refund($order, (string) $data['resolution_notes']);
                $refundAmount = $fullAmount;
            } elseif ((float) $order->total_price > 0) {
                MarketplacePaymentService::processRefund(
                    $order,
                    $refundAmount,
                    (string) $data['resolution_notes'],
                );
                $order->refresh();
                $refundAmount ??= (float) $order->total_price;
            } else {
                DB::transaction(function () use ($order, $tenantId): void {
                    $lockedOrder = MarketplaceOrder::withoutGlobalScopes()
                        ->where('tenant_id', $tenantId)
                        ->whereKey($order->id)
                        ->lockForUpdate()
                        ->firstOrFail();
                    if ($lockedOrder->status !== 'refunded') {
                        $lockedOrder->status = 'refunded';
                        $lockedOrder->save();
                        MarketplaceOrderService::restoreInventoryForRefund($lockedOrder);
                    }
                });
                $refundAmount = 0.0;
                $order->refresh();
            }
        }

        $resolved = DB::transaction(function () use (
            $disputeId,
            $adminId,
            $data,
            $resolution,
            $refundAmount,
            $tenantId,
        ): MarketplaceDispute {
            $lockedDispute = MarketplaceDispute::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereKey($disputeId)
                ->lockForUpdate()
                ->firstOrFail();
            if (! in_array((string) $lockedDispute->status, ['open', 'under_review', 'escalated'], true)) {
                throw new InvalidArgumentException(__('api.marketplace_dispute_already_resolved'));
            }
            if ((int) $lockedDispute->resolved_by !== $adminId) {
                throw new InvalidArgumentException(__('api.marketplace_dispute_resolution_claimed'));
            }

            $lockedOrder = MarketplaceOrder::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereKey($lockedDispute->order_id)
                ->lockForUpdate()
                ->firstOrFail();

            $lockedDispute->status = match ($resolution) {
                'buyer' => 'resolved_buyer',
                'seller' => 'resolved_seller',
                default => 'closed',
            };
            $lockedDispute->resolution_notes = $data['resolution_notes'];
            $lockedDispute->resolved_by = $adminId;
            $lockedDispute->resolved_at = now();
            $lockedDispute->refund_amount = $resolution === 'buyer' ? $refundAmount : null;
            $lockedDispute->save();

            if ($lockedOrder->status === 'disputed') {
                $lockedOrder->status = $resolution === 'buyer' && $refundAmount !== null
                    && $refundAmount >= (float) $lockedOrder->total_price - 0.005
                    ? 'refunded'
                    : ((string) ($lockedDispute->prior_order_status ?: 'paid'));
                $lockedOrder->save();
            }

            // A full buyer refund has already moved escrow to `refunded`.
            // Every other resolution, including a partial buyer refund, must
            // release the remaining seller balance from the disputed hold.
            DB::table('marketplace_escrow')
                ->where('tenant_id', $tenantId)
                ->where('order_id', $lockedOrder->id)
                ->where('status', 'disputed')
                ->update([
                    'status' => 'held',
                    'release_after' => now(),
                    'updated_at' => now(),
                ]);

            return $lockedDispute;
        });

        $this->notifyParticipants($resolved, $resolution);

        return $resolved->fresh(['order', 'openedBy', 'resolvedBy']) ?? $resolved;
    }

    private function notifyParticipants(MarketplaceDispute $dispute, string $resolution): void
    {
        $order = MarketplaceOrder::withoutGlobalScopes()
            ->where('tenant_id', $dispute->tenant_id)
            ->whereKey($dispute->order_id)
            ->first();
        if (! $order) {
            return;
        }

        $recipients = DB::table('users')
            ->where('tenant_id', $dispute->tenant_id)
            ->whereIn('id', [(int) $order->buyer_id, (int) $order->seller_id])
            ->get(['id', 'preferred_language']);
        foreach ($recipients as $recipient) {
            try {
                LocaleContext::withLocale($recipient, function () use ($recipient, $order, $resolution, $dispute): void {
                    Notification::createNotification(
                        (int) $recipient->id,
                        __('api.marketplace_dispute_resolved_' . $resolution, [
                            'order' => $order->order_number,
                        ]),
                        '/marketplace/orders/' . $order->id,
                        'marketplace_dispute_resolved',
                        true,
                        (int) $dispute->tenant_id,
                    );
                });
            } catch (\Throwable $exception) {
                Log::warning('[MarketplaceDisputeService] participant notification failed', [
                    'dispute_id' => $dispute->id,
                    'user_id' => $recipient->id,
                    'error' => $exception->getMessage(),
                ]);
            }
        }
    }

    /** @return array<string,mixed> */
    private function format(MarketplaceDispute $dispute): array
    {
        $order = $dispute->order;

        return [
            'id' => (int) $dispute->id,
            'order_id' => (int) $dispute->order_id,
            'reason' => $dispute->reason,
            'description' => $dispute->description,
            'evidence_urls' => $dispute->evidence_urls,
            'status' => $dispute->status,
            'prior_order_status' => $dispute->prior_order_status,
            'resolution_notes' => $dispute->resolution_notes,
            'refund_amount' => $dispute->refund_amount !== null ? (float) $dispute->refund_amount : null,
            'created_at' => $dispute->created_at?->toISOString(),
            'resolved_at' => $dispute->resolved_at?->toISOString(),
            'opened_by' => $dispute->openedBy ? [
                'id' => (int) $dispute->openedBy->id,
                'name' => UserDisplayName::resolve($dispute->openedBy),
                'avatar_url' => $dispute->openedBy->avatar_url,
            ] : null,
            'order' => $order ? [
                'id' => (int) $order->id,
                'order_number' => $order->order_number,
                'total_price' => (float) $order->total_price,
                'time_credits_used' => (float) $order->time_credits_used,
                'currency' => $order->currency,
                'status' => $order->status,
                'listing' => $order->listing ? [
                    'id' => (int) $order->listing->id,
                    'title' => $order->listing->title,
                ] : null,
                'buyer' => $this->formatPerson($order->buyer),
                'seller' => $this->formatPerson($order->seller),
            ] : null,
        ];
    }

    /** @return array<string,mixed>|null */
    private function formatPerson(?object $user): ?array
    {
        if (! $user) {
            return null;
        }

        return [
            'id' => (int) $user->id,
            'name' => UserDisplayName::resolve($user),
            'avatar_url' => $user->avatar_url,
        ];
    }
}
