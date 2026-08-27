<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Events\TransactionCompleted;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * MarketplaceCommunityDeliveryService — Community-powered delivery for marketplace.
 *
 * NEXUS differentiator: community members can offer to deliver marketplace items
 * for time credits, leveraging the timebanking ecosystem. This creates a
 * peer-to-peer delivery network where deliverers earn time credits.
 *
 * Flow:
 * 1. Listing has delivery_method = 'community_delivery'
 * 2. Community members browse deliverable orders and offer to deliver
 * 3. The buyer accepts a delivery offer and its time-credit price
 * 4. The buyer confirms completion and pays the deliverer atomically
 *
 * Uses the `marketplace_delivery_offers` table (created by migration).
 */
class MarketplaceCommunityDeliveryService
{
    /**
     * Offer to deliver an order for time credits.
     *
     * @param int $orderId The marketplace order ID
     * @param int $delivererId The user offering to deliver
     * @param array{time_credits: float, estimated_minutes?: int, notes?: string} $data
     * @return array The created delivery offer
     *
     * @throws \InvalidArgumentException On validation failure
     * @throws \RuntimeException On business logic violations
     */
    public static function offerDelivery(int $orderId, int $delivererId, array $data): array
    {
        $tenantId = TenantContext::getId();
        $timeCredits = (float) ($data['time_credits'] ?? 0);
        $estimatedMinutes = (int) ($data['estimated_minutes'] ?? 0);
        $notes = trim($data['notes'] ?? '');

        if ($timeCredits <= 0) {
            throw new \InvalidArgumentException(__('api.marketplace_delivery_time_credit_positive'));
        }

        if ($timeCredits > 100) {
            throw new \InvalidArgumentException(__('api.marketplace_delivery_time_credit_max'));
        }

        // Verify the order exists and belongs to this tenant
        $order = DB::table('marketplace_orders')
            ->where('id', $orderId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$order) {
            throw new \RuntimeException(__('api.marketplace_delivery_order_not_found'));
        }

        // Cannot deliver your own order
        if ((int) $order->buyer_id === $delivererId || (int) $order->seller_id === $delivererId) {
            throw new \RuntimeException(__('api.marketplace_delivery_own_order_forbidden'));
        }

        // Check order status allows delivery offers
        if (!in_array($order->status, ['paid', 'shipped'], true)) {
            throw new \RuntimeException(__('api.marketplace_delivery_order_unavailable'));
        }
        if (($order->shipping_method ?? null) !== 'community_delivery') {
            throw new \RuntimeException(__('api.marketplace_delivery_order_method_required'));
        }

        // Check if delivery method is community_delivery
        $listing = DB::table('marketplace_listings')
            ->where('id', $order->marketplace_listing_id)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$listing || $listing->delivery_method !== 'community_delivery') {
            throw new \RuntimeException(__('api.marketplace_delivery_listing_method_required'));
        }

        // Check for duplicate offer from same deliverer
        $existingOffer = DB::table('marketplace_delivery_offers')
            ->where('order_id', $orderId)
            ->where('deliverer_id', $delivererId)
            ->where('tenant_id', $tenantId)
            ->whereIn('status', ['pending', 'accepted'])
            ->first();

        if ($existingOffer) {
            throw new \RuntimeException(__('api.marketplace_delivery_offer_duplicate'));
        }

        // A delivery offer starts a new working relationship and may carry a
        // free-text note. Check every participant direction before persisting
        // either the relationship or its message-like content.
        self::assertDeliveryContactsAllowed(
            $order,
            $delivererId,
            $tenantId,
            'marketplace_community_delivery_offer',
        );

        $offerId = DB::transaction(function () use (
            $tenantId,
            $orderId,
            $delivererId,
            $timeCredits,
            $estimatedMinutes,
            $notes,
        ): int {
            $lockedOrder = DB::table('marketplace_orders')
                ->where('id', $orderId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();
            if (! $lockedOrder
                || ! in_array($lockedOrder->status, ['paid', 'shipped'], true)
                || ($lockedOrder->shipping_method ?? null) !== 'community_delivery') {
                throw new \RuntimeException(__('api.marketplace_delivery_order_unavailable'));
            }
            $duplicate = DB::table('marketplace_delivery_offers')
                ->where('order_id', $orderId)
                ->where('deliverer_id', $delivererId)
                ->where('tenant_id', $tenantId)
                ->whereIn('status', ['pending', 'accepted'])
                ->exists();
            if ($duplicate) {
                throw new \RuntimeException(__('api.marketplace_delivery_offer_duplicate'));
            }

            return (int) DB::table('marketplace_delivery_offers')->insertGetId([
                'tenant_id' => $tenantId,
                'order_id' => $orderId,
                'deliverer_id' => $delivererId,
                'time_credits' => $timeCredits,
                'estimated_minutes' => $estimatedMinutes > 0 ? $estimatedMinutes : null,
                'notes' => $notes ?: null,
                'status' => 'pending',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        });

        return self::formatOffer(
            DB::table('marketplace_delivery_offers')->where('id', $offerId)->where('tenant_id', TenantContext::getId())->first()
        );
    }

    /**
     * Accept a delivery offer.
     *
     * Called by the seller or buyer to accept a specific delivery offer.
     * Declines all other pending offers for the same order.
     *
     * @param int $orderId
     * @param int $delivererId The deliverer whose offer to accept
     * @return void
     *
     * @throws AuthorizationException If the actor is not the buyer or seller
     * @throws \RuntimeException If offer not found or invalid state
     */
    public static function acceptDeliveryOffer(int $orderId, int $delivererId, int $actorId): void
    {
        $tenantId = TenantContext::getId();
        $order = self::requireOrderBuyer($orderId, $tenantId, $actorId);

        $offer = DB::table('marketplace_delivery_offers')
            ->where('order_id', $orderId)
            ->where('deliverer_id', $delivererId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'pending')
            ->first();

        if (!$offer) {
            throw new \RuntimeException(__('api.marketplace_delivery_offer_unavailable'));
        }

        // Re-check at acceptance rather than trusting the earlier offer-time
        // decision: preferences, restrictions, or vetting can change while an
        // offer is pending. No offer status is changed on denial/unavailability.
        self::assertDeliveryContactsAllowed(
            $order,
            $delivererId,
            $tenantId,
            'marketplace_community_delivery_acceptance',
        );

        DB::transaction(function () use ($orderId, $offer, $tenantId): void {
            // Lock the order to serialize competing acceptance requests.
            $lockedOrder = DB::table('marketplace_orders')
                ->where('id', $orderId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();
            if (! $lockedOrder || ! in_array($lockedOrder->status, ['paid', 'shipped'], true)
                || $lockedOrder->shipping_method !== 'community_delivery') {
                throw new \RuntimeException(__('api.marketplace_delivery_order_unavailable'));
            }

            $accepted = DB::table('marketplace_delivery_offers')
                ->where('id', $offer->id)
                ->where('tenant_id', $tenantId)
                ->where('status', 'pending')
                ->update([
                    'status' => 'accepted',
                    'accepted_at' => now(),
                    'updated_at' => now(),
                ]);
            if ($accepted !== 1) {
                throw new \RuntimeException(__('api.marketplace_delivery_offer_unavailable'));
            }

            // Decline all other pending offers for this order
            DB::table('marketplace_delivery_offers')
                ->where('order_id', $orderId)
                ->where('tenant_id', $tenantId)
                ->where('id', '!=', $offer->id)
                ->where('status', 'pending')
                ->update([
                    'status' => 'declined',
                    'updated_at' => now(),
                ]);
        });

        Log::info('Community delivery offer accepted', [
            'order_id' => $orderId,
            'deliverer_id' => $delivererId,
            'actor_id' => $actorId,
            'time_credits' => $offer->time_credits,
        ]);
    }

    /**
     * Confirm delivery completion and award time credits to the deliverer.
     *
     * This is the final step: the buyer/seller confirms the item was delivered,
     * and the deliverer receives the agreed time credits from the buyer.
     *
     * @param int $orderId
     * @param int $delivererId
     * @return void
     *
     * @throws AuthorizationException If the actor is not the buyer or seller
     * @throws \RuntimeException If offer not found, wrong state, or insufficient balance
     */
    public static function confirmDelivery(int $orderId, int $delivererId, int $actorId): void
    {
        $tenantId = TenantContext::getId();
        $order = self::requireOrderBuyer($orderId, $tenantId, $actorId);

        $offer = DB::table('marketplace_delivery_offers')
            ->where('order_id', $orderId)
            ->where('deliverer_id', $delivererId)
            ->where('tenant_id', $tenantId)
            ->whereIn('status', ['accepted', 'completed'])
            ->first();

        if (!$offer) {
            throw new \RuntimeException(__('api.marketplace_delivery_accepted_offer_not_found'));
        }
        if ($offer->status === 'completed' && $offer->wallet_transaction_id !== null) {
            return;
        }

        // Completion moves credits as well as closing the delivery
        // relationship. Re-check every direction immediately before the
        // transaction so a revoked confirmation cannot be bypassed by an old
        // accepted offer.
        self::assertDeliveryContactsAllowed(
            $order,
            $delivererId,
            $tenantId,
            'marketplace_community_delivery_confirmation',
        );

        $settlement = DB::transaction(function () use ($offer, $order, $tenantId): array {
            $lockedOrder = DB::table('marketplace_orders')
                ->where('id', $order->id)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();
            if (! $lockedOrder || ! in_array($lockedOrder->status, ['paid', 'shipped', 'delivered'], true)
                || $lockedOrder->shipping_method !== 'community_delivery') {
                throw new \RuntimeException(__('api.marketplace_delivery_order_unavailable'));
            }

            $lockedOffer = DB::table('marketplace_delivery_offers')
                ->where('id', $offer->id)
                ->where('tenant_id', $tenantId)
                ->where('order_id', $order->id)
                ->where('deliverer_id', $offer->deliverer_id)
                ->lockForUpdate()
                ->first();
            if ($lockedOffer
                && $lockedOffer->status === 'completed'
                && $lockedOffer->wallet_transaction_id !== null) {
                return [null, null, null];
            }
            if (! $lockedOffer || $lockedOffer->status !== 'accepted') {
                throw new \RuntimeException(__('api.marketplace_delivery_offer_unavailable'));
            }
            if ($lockedOffer->wallet_transaction_id !== null) {
                return [null, null, null];
            }

            $buyerId = (int) $lockedOrder->buyer_id;
            $lockedDelivererId = (int) $lockedOffer->deliverer_id;
            $amount = round((float) $lockedOffer->time_credits, 2);
            foreach ([min($buyerId, $lockedDelivererId), max($buyerId, $lockedDelivererId)] as $userId) {
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
            $deliverer = User::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereKey($lockedDelivererId)
                ->firstOrFail();
            if ((float) $buyer->balance < $amount) {
                throw new \RuntimeException(__('api.wallet_transfer_insufficient_balance'));
            }
            if (in_array((string) $deliverer->status, ['banned', 'suspended', 'inactive', 'deactivated'], true)) {
                throw new \RuntimeException(__('api.wallet_transfer_recipient_inactive'));
            }

            $transaction = new Transaction();
            $transaction->tenant_id = $tenantId;
            $transaction->sender_id = $buyerId;
            $transaction->receiver_id = $lockedDelivererId;
            $transaction->amount = $amount;
            $transaction->description = __('api.marketplace_delivery_transaction_description', [
                'order' => $lockedOrder->order_number,
            ]);
            $transaction->transaction_type = 'community_delivery';
            $transaction->status = 'completed';
            $transaction->save();

            $buyer->decrement('balance', $amount);
            $deliverer->increment('balance', $amount);
            DB::table('marketplace_delivery_offers')
                ->where('id', $lockedOffer->id)
                ->where('tenant_id', $tenantId)
                ->where('status', 'accepted')
                ->update([
                    'status' => 'completed',
                    'completed_at' => now(),
                    'wallet_transaction_id' => $transaction->id,
                    'updated_at' => now(),
                ]);

            return [
                $transaction->fresh(['sender', 'receiver']),
                $buyer->fresh(),
                $deliverer->fresh(),
            ];
        });

        [$transaction, $buyer, $deliverer] = $settlement;
        if ($transaction instanceof Transaction && $buyer instanceof User && $deliverer instanceof User) {
            try {
                WalletAlertService::checkAndSendLowBalanceAlert(
                    $tenantId,
                    (int) $buyer->id,
                    (float) $buyer->balance,
                );
                event(new TransactionCompleted($transaction, $buyer, $deliverer, $tenantId));
            } catch (\Throwable $exception) {
                Log::warning('Community delivery post-commit notification failed', [
                    'order_id' => $orderId,
                    'transaction_id' => $transaction->id,
                    'error' => $exception->getMessage(),
                ]);
            }
        }

        Log::info('Community delivery confirmed and time credits awarded', [
            'order_id' => $orderId,
            'deliverer_id' => $delivererId,
            'actor_id' => $actorId,
            'time_credits' => $offer->time_credits,
        ]);
    }

    /**
     * Get all delivery offers for an order.
     *
     * @param int $orderId
     * @return array List of delivery offers with deliverer info
     */
    public static function getDeliveryOffers(int $orderId, int $actorId): array
    {
        $tenantId = TenantContext::getId();
        self::requireOrderParticipant($orderId, $tenantId, $actorId);

        $offers = DB::table('marketplace_delivery_offers as mdo')
            ->leftJoin('users as u', function ($join): void {
                $join->on('u.id', '=', 'mdo.deliverer_id')
                    ->on('u.tenant_id', '=', 'mdo.tenant_id');
            })
            ->where('mdo.order_id', $orderId)
            ->where('mdo.tenant_id', $tenantId)
            ->select(
                'mdo.*',
                'u.first_name',
                'u.last_name', 'u.profile_type', 'u.organization_name',
                'u.avatar_url',
                'u.is_verified'
            )
            ->orderByDesc('mdo.created_at')
            ->get();

        return $offers->map(fn ($o) => self::formatOfferWithUser($o))->all();
    }

    // -----------------------------------------------------------------
    //  Formatting helpers
    // -----------------------------------------------------------------

    private static function formatOffer(object $offer): array
    {
        return [
            'id' => $offer->id,
            'order_id' => $offer->order_id,
            'deliverer_id' => $offer->deliverer_id,
            'time_credits' => (float) $offer->time_credits,
            'estimated_minutes' => $offer->estimated_minutes ? (int) $offer->estimated_minutes : null,
            'notes' => $offer->notes,
            'status' => $offer->status,
            'accepted_at' => $offer->accepted_at ?? null,
            'completed_at' => $offer->completed_at ?? null,
            'created_at' => $offer->created_at,
        ];
    }

    private static function formatOfferWithUser(object $offer): array
    {
        return [
            'id' => $offer->id,
            'order_id' => $offer->order_id,
            'deliverer_id' => $offer->deliverer_id,
            'time_credits' => (float) $offer->time_credits,
            'estimated_minutes' => $offer->estimated_minutes ? (int) $offer->estimated_minutes : null,
            'notes' => $offer->notes,
            'status' => $offer->status,
            'accepted_at' => $offer->accepted_at ?? null,
            'completed_at' => $offer->completed_at ?? null,
            'created_at' => $offer->created_at,
            'deliverer' => [
                'id' => $offer->deliverer_id,
                'name' => UserDisplayName::resolve($offer),
                'avatar_url' => $offer->avatar_url ?? null,
                'is_verified' => (bool) ($offer->is_verified ?? false),
            ],
        ];
    }

    /**
     * Buyer or seller authorization gate for delivery lifecycle actions.
     *
     * @throws AuthorizationException
     */
    private static function requireOrderParticipant(int $orderId, int $tenantId, int $actorId): object
    {
        $order = DB::table('marketplace_orders')
            ->where('id', $orderId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$order) {
            throw new \RuntimeException(__('api.marketplace_delivery_order_not_found'));
        }

        if ((int) $order->buyer_id !== $actorId && (int) $order->seller_id !== $actorId) {
            throw new AuthorizationException(__('api.marketplace_delivery_participant_required'));
        }

        return $order;
    }

    /** Only the buyer may consent to a debit from the buyer's wallet. */
    private static function requireOrderBuyer(int $orderId, int $tenantId, int $actorId): object
    {
        $order = self::requireOrderParticipant($orderId, $tenantId, $actorId);
        if ((int) $order->buyer_id !== $actorId) {
            throw new AuthorizationException(__('api.marketplace_delivery_buyer_required'));
        }

        return $order;
    }

    /**
     * A community delivery creates a two-way relationship between the
     * deliverer and both order participants. The shared policy is directional,
     * so both sides must be evaluated explicitly.
     */
    private static function assertDeliveryContactsAllowed(
        object $order,
        int $delivererId,
        int $tenantId,
        string $channel,
    ): void {
        $participantIds = array_values(array_unique([
            (int) $order->buyer_id,
            (int) $order->seller_id,
        ]));

        $policy = app(SafeguardingInteractionPolicy::class);
        $policy->assertManyLocalContactsAllowed(
            $delivererId,
            $participantIds,
            $tenantId,
            $channel,
        );

        foreach ($participantIds as $participantId) {
            $policy->assertLocalContactAllowed(
                $participantId,
                $delivererId,
                $tenantId,
                $channel,
            );
        }
    }
}
