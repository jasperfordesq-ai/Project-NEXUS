<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\Models\MarketplaceOrder;
use App\Services\MarketplaceOrderService;
use App\Services\MarketplacePaymentService;
use App\Services\MarketplaceRatingService;
use Illuminate\Http\JsonResponse;

/**
 * MarketplaceOrderController — Order lifecycle, ratings, and disputes.
 */
class MarketplaceOrderController extends BaseApiController
{
    protected bool $isV2Api = true;

    private function ensureFeature(): void
    {
        if (!TenantContext::hasFeature('marketplace')) {
        abort(403, __('api.marketplace_feature_disabled'));
        }
    }

    // -----------------------------------------------------------------
    //  Orders
    // -----------------------------------------------------------------

    /** Look up a committed checkout without re-running purchase validation or payment. */
    public function checkoutOutcome(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAuth();
        $this->rateLimit('marketplace_order_read', 30, 60);
        $data = request()->validate(['idempotency_key' => 'required|string|min:16|max:100']);
        $order = MarketplaceOrder::withoutGlobalScopes()
            ->where('tenant_id', TenantContext::getId())
            ->where('buyer_id', $userId)
            ->where('checkout_key', hash('sha256', trim($data['idempotency_key'])))
            ->first();

        // Absence is only a snapshot, not permission to rotate the key: an earlier
        // request could still commit. Corrections must retain this purchase key.
        return $this->respondWithData(['order' => $order ? [
            'id' => (int) $order->id,
            'order_number' => $order->order_number,
            'status' => $order->status,
        ] : null]);
    }

    /**
     * POST /v2/marketplace/orders — Create order (buy now or from accepted offer).
     */
    public function store(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAuth();
        $this->rateLimit('marketplace_order_create', 10, 60);

        $data = request()->validate([
            'listing_id' => 'required|integer|exists:marketplace_listings,id',
            'offer_id' => 'nullable|integer|exists:marketplace_offers,id',
            'quantity' => 'nullable|integer|min:1|max:100',
            // Shipping prices are resolved from a tenant-scoped seller option
            // inside MarketplaceOrderService. Never accept a client supplied
            // price: it would let a buyer choose the amount charged.
            'shipping_option_id' => 'nullable|integer|min:1',
            'shipping_method' => 'nullable|string|in:pickup,community_delivery',
            'pickup_slot_id' => 'nullable|integer|min:1',
            'delivery_address' => 'nullable|array',
            'delivery_notes' => 'nullable|string|max:500',
            'coupon_code' => 'nullable|string|max:64',
            'idempotency_key' => 'required|string|min:16|max:100',
            'loyalty_redemption_id' => 'nullable|integer|min:1',
            'payment_method' => 'nullable|string|in:cash,time_credits,free',
        ]);

        try {
            if (!empty($data['offer_id'])) {
                $offer = \App\Models\MarketplaceOffer::findOrFail($data['offer_id']);
                if ($offer->buyer_id !== $userId) {
                return $this->respondWithError('FORBIDDEN', __('api.marketplace_order_offer_buyer_required'), null, 403);
                }
                $order = MarketplaceOrderService::createFromOffer($offer, $data);
            } else {
                $order = MarketplaceOrderService::createDirectPurchase($userId, $data['listing_id'], $data);
            }

            return $this->respondWithData(MarketplaceOrderService::formatOrder($order), null, 201);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        }
    }

    /**
     * GET /v2/marketplace/orders/{id} — Order detail.
     */
    public function show(int $id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAuth();
        $this->rateLimit('marketplace_order_read', 30, 60);

        $order = MarketplaceOrderService::getById($id);
        if (!$order) {
                return $this->respondWithError('NOT_FOUND', __('api.marketplace_order_not_found'), null, 404);
        }

        if ($order->buyer_id !== $userId && $order->seller_id !== $userId) {
                return $this->respondWithError('FORBIDDEN', __('api.marketplace_order_participant_required'), null, 403);
        }

        return $this->respondWithData(MarketplaceOrderService::formatOrder($order));
    }

    /**
     * GET /v2/marketplace/orders/purchases — Buyer's purchase history.
     */
    public function purchases(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAuth();
        $this->rateLimit('marketplace_order_read', 30, 60);

        $result = MarketplaceOrderService::getBuyerOrders(
            $userId,
            $this->query('status'),
            $this->queryInt('limit', 20, 1, 100),
            $this->query('cursor')
        );

        return $this->respondWithCollection(
            $result['items'],
            $result['cursor'],
            $this->queryInt('limit', 20),
            $result['has_more']
        );
    }

    /**
     * GET /v2/marketplace/orders/sales — Seller's sales history.
     */
    public function sales(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAuth();
        $this->rateLimit('marketplace_order_read', 30, 60);

        $result = MarketplaceOrderService::getSellerOrders(
            $userId,
            $this->query('status'),
            $this->queryInt('limit', 20, 1, 100),
            $this->query('cursor')
        );

        return $this->respondWithCollection(
            $result['items'],
            $result['cursor'],
            $this->queryInt('limit', 20),
            $result['has_more']
        );
    }

    /**
     * PUT /v2/marketplace/orders/{id}/ship — Mark order as shipped.
     */
    public function ship(int $id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAuth();
        $this->rateLimit('marketplace_order_update', 15, 60);

        $order = MarketplaceOrder::findOrFail($id);
        if ($order->seller_id !== $userId) {
                return $this->respondWithError('FORBIDDEN', __('api.marketplace_order_seller_ship_required'), null, 403);
        }

        $data = request()->validate([
            'tracking_number' => 'nullable|string|max:255',
            'tracking_url' => 'nullable|string|max:500|url',
        ]);

        try {
            $order = MarketplaceOrderService::markShipped($order, $data);
            return $this->respondWithData(MarketplaceOrderService::formatOrder($order));
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        }
    }

    /**
     * PUT /v2/marketplace/orders/{id}/confirm-delivery — Buyer confirms receipt.
     */
    public function confirmDelivery(int $id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAuth();
        $this->rateLimit('marketplace_order_update', 15, 60);

        $order = MarketplaceOrder::findOrFail($id);
        if ($order->buyer_id !== $userId) {
                return $this->respondWithError('FORBIDDEN', __('api.marketplace_order_buyer_delivery_required'), null, 403);
        }

        try {
            $order = MarketplaceOrderService::confirmDelivery($order);
            return $this->respondWithData(MarketplaceOrderService::formatOrder($order));
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        }
    }

    /**
     * PUT /v2/marketplace/orders/{id}/cancel — Cancel order.
     */
    public function cancel(int $id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAuth();
        $this->rateLimit('marketplace_order_update', 15, 60);

        $order = MarketplaceOrder::findOrFail($id);
        if ($order->buyer_id !== $userId && $order->seller_id !== $userId) {
                return $this->respondWithError('FORBIDDEN', __('api.marketplace_order_participant_required'), null, 403);
        }

        $data = request()->validate([
            'reason' => 'required|string|max:500',
        ]);

        try {
            if ((string) $order->status === 'pending_payment'
                && ! MarketplacePaymentService::prepareOrderForExpiry($order)) {
                return $this->respondWithError(
                    'PAYMENT_RECONCILIATION_REQUIRED',
                    __('api.marketplace_order_cancel_payment_pending'),
                    null,
                    409,
                );
            }
            $order->refresh();
            $order = MarketplaceOrderService::cancel($order, $data['reason']);
            return $this->respondWithData(MarketplaceOrderService::formatOrder($order));
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        }
    }

    // -----------------------------------------------------------------
    //  Ratings
    // -----------------------------------------------------------------

    /**
     * POST /v2/marketplace/orders/{id}/rate — Rate a completed order.
     */
    public function rate(int $id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAuth();
        $this->rateLimit('marketplace_rate', 10, 60);

        $data = request()->validate([
            'rating' => 'required|integer|min:1|max:5',
            'comment' => 'nullable|string|max:1000',
            'is_anonymous' => 'nullable|boolean',
        ]);

        $order = MarketplaceOrder::findOrFail($id);
        $role = $order->buyer_id === $userId ? 'buyer' : ($order->seller_id === $userId ? 'seller' : null);

        if (!$role) {
            return $this->respondWithError('FORBIDDEN', __('api.marketplace_order_participant_required'), null, 403);
        }

        try {
            $rating = MarketplaceRatingService::rateOrder($id, $userId, $role, $data, TenantContext::getId());
            return $this->respondWithData($rating->toArray(), null, 201);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        }
    }

    /**
     * GET /v2/marketplace/orders/{id}/ratings — Get ratings for an order.
     */
    public function orderRatings(int $id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAuth();
        $this->rateLimit('marketplace_rate', 30, 60);

        $order = MarketplaceOrder::where('id', $id)
            ->where('tenant_id', TenantContext::getId())
            ->firstOrFail();
        if ((int) $order->buyer_id !== $userId && (int) $order->seller_id !== $userId) {
            return $this->respondWithError('FORBIDDEN', __('api.marketplace_order_participant_required'), null, 403);
        }

        return $this->respondWithData(MarketplaceRatingService::getOrderRatings($id));
    }

    // -----------------------------------------------------------------
    //  Disputes
    // -----------------------------------------------------------------

    /**
     * POST /v2/marketplace/orders/{id}/dispute — Open a dispute.
     */
    public function dispute(int $id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAuth();
        $this->rateLimit('marketplace_dispute', 5, 60);

        $data = request()->validate([
            'reason' => 'required|string|in:not_received,not_as_described,damaged,wrong_item,other',
            'description' => 'required|string|max:2000',
            'evidence_urls' => 'nullable|array|max:10',
            'evidence_urls.*' => ['string', 'max:500', 'url:http,https'],
        ]);

        try {
            $dispute = MarketplaceRatingService::openDispute($id, $userId, $data, TenantContext::getId());
            return $this->respondWithData($dispute->toArray(), null, 201);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        }
    }
}
