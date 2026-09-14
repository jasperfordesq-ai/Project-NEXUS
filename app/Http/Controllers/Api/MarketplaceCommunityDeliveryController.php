<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Exceptions\SafeguardingPolicyException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use App\Core\TenantContext;
use App\Services\MarketplaceCommunityDeliveryService;
use Illuminate\Auth\Access\AuthorizationException;

/**
 * MarketplaceCommunityDeliveryController — Community delivery endpoints.
 *
 * Handles the lifecycle of community-powered delivery offers:
 * offer, accept, confirm, and list delivery offers for an order.
 */
class MarketplaceCommunityDeliveryController extends BaseApiController
{
    protected bool $isV2Api = true;

    private function ensureFeature(): void
    {
        if (!TenantContext::hasFeature('marketplace')) {
            throw new \Illuminate\Http\Exceptions\HttpResponseException(
                $this->respondWithError('FEATURE_DISABLED', __('api_controllers_2.marketplace_delivery.feature_disabled'), null, 403)
            );
        }
    }

    /**
     * GET /v2/marketplace/orders/deliveries
     *
     * List privacy-safe community-delivery opportunities for members who are
     * neither the buyer nor seller. The member's own latest offer is included
     * so an accepted write can be reconciled after its HTTP response is lost.
     */
    public function opportunities(Request $request): JsonResponse
    {
        $this->ensureFeature();
        $this->rateLimit('marketplace_order_read', 30, 60);

        $userId = $request->user()?->id;
        if (! $userId) {
            return $this->respondWithError('UNAUTHORIZED', __('api_controllers_2.marketplace_delivery.auth_required'), null, 401);
        }

        $limit = $this->queryInt('limit', 20, 1, 100);
        $result = MarketplaceCommunityDeliveryService::getDeliveryOpportunities(
            (int) $userId,
            $limit,
            $this->query('cursor'),
        );

        return $this->respondWithCollection(
            $result['items'],
            $result['cursor'],
            $limit,
            $result['has_more'],
        );
    }

    /**
     * POST /v2/marketplace/orders/{orderId}/delivery-offers
     *
     * Community member offers to deliver an order for time credits.
     */
    public function store(Request $request, int $orderId): JsonResponse
    {
        $this->ensureFeature();

        $userId = $request->user()?->id;
        if (!$userId) {
            return $this->respondWithError('UNAUTHORIZED', __('api_controllers_2.marketplace_delivery.auth_required'), null, 401);
        }

        $data = $request->validate([
            'time_credits' => 'required|numeric|min:0.25|max:100',
            'estimated_minutes' => 'nullable|integer|min:5|max:1440',
            'notes' => 'nullable|string|max:500',
        ]);

        try {
            $offer = MarketplaceCommunityDeliveryService::offerDelivery($orderId, $userId, $data);
            return $this->respondWithData($offer, null, 201);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('DELIVERY_OFFER_ERROR', $e->getMessage(), null, 400);
        }
    }

    /**
     * GET /v2/marketplace/orders/{orderId}/delivery-offers
     *
     * List all delivery offers for an order.
     */
    public function index(Request $request, int $orderId): JsonResponse
    {
        $this->ensureFeature();

        $userId = $request->user()?->id;
        if (!$userId) {
            return $this->respondWithError('UNAUTHORIZED', __('api_controllers_2.marketplace_delivery.auth_required'), null, 401);
        }

        try {
            $offers = MarketplaceCommunityDeliveryService::getDeliveryOffers($orderId, (int) $userId);
            return $this->respondWithData($offers);
        } catch (AuthorizationException $e) {
            return $this->respondWithError('FORBIDDEN', $e->getMessage(), null, 403);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('DELIVERY_OFFER_ERROR', $e->getMessage(), null, 400);
        }
    }

    /**
     * PUT /v2/marketplace/orders/{orderId}/delivery-offers/{delivererId}/accept
     *
     * Accept a delivery offer. Declines all other pending offers.
     */
    public function accept(Request $request, int $orderId, int $delivererId): JsonResponse
    {
        $this->ensureFeature();

        $userId = $request->user()?->id;
        if (!$userId) {
            return $this->respondWithError('UNAUTHORIZED', __('api_controllers_2.marketplace_delivery.auth_required'), null, 401);
        }

        try {
            MarketplaceCommunityDeliveryService::acceptDeliveryOffer($orderId, $delivererId, (int) $userId);
            return $this->respondWithData(['message' => __('api_controllers_2.marketplace_delivery.offer_accepted')]);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        } catch (AuthorizationException $e) {
            return $this->respondWithError('FORBIDDEN', $e->getMessage(), null, 403);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('DELIVERY_ACCEPT_ERROR', $e->getMessage(), null, 400);
        }
    }

    /**
     * PUT /v2/marketplace/orders/{orderId}/delivery-offers/{delivererId}/confirm
     *
     * Confirm delivery completion and award time credits.
     */
    public function confirm(Request $request, int $orderId, int $delivererId): JsonResponse
    {
        $this->ensureFeature();

        $userId = $request->user()?->id;
        if (!$userId) {
            return $this->respondWithError('UNAUTHORIZED', __('api_controllers_2.marketplace_delivery.auth_required'), null, 401);
        }

        try {
            MarketplaceCommunityDeliveryService::confirmDelivery($orderId, $delivererId, (int) $userId);
            return $this->respondWithData(['message' => __('api_controllers_2.marketplace_delivery.delivery_confirmed')]);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        } catch (AuthorizationException $e) {
            return $this->respondWithError('FORBIDDEN', $e->getMessage(), null, 403);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('DELIVERY_CONFIRM_ERROR', $e->getMessage(), null, 400);
        }
    }
}
