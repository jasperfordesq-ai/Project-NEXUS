<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Models\MarketplaceCollection;
use App\Services\MarketplaceDiscoveryService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * MarketplaceDiscoveryController — Saved searches and collections endpoints.
 *
 * All endpoints require authentication (auth:sanctum).
 */
class MarketplaceDiscoveryController extends BaseApiController
{
    protected bool $isV2Api = true;

    // =====================================================================
    //  Feature gate
    // =====================================================================

    private function ensureFeature(): void
    {
        if (!TenantContext::hasFeature('marketplace')) {
            throw new \Illuminate\Http\Exceptions\HttpResponseException(
                $this->respondWithError('FEATURE_DISABLED', __('api.marketplace_feature_disabled'), null, 403)
            );
        }
    }

    // =====================================================================
    //  Saved Searches
    // =====================================================================

    /**
     * GET /v2/marketplace/saved-searches
     */
    public function listSavedSearches(Request $request): JsonResponse
    {
        $this->ensureFeature();
        $userId = $request->user()->id;

        $searches = MarketplaceDiscoveryService::getSavedSearches($userId);

        return $this->respondWithData(
            array_map(fn ($s) => [
                'id' => $s->id,
                'name' => $s->name,
                'search_query' => $s->search_query,
                'filters' => $s->filters,
                'alert_frequency' => $s->alert_frequency,
                'alert_channel' => $s->alert_channel,
                'is_active' => $s->is_active,
                'last_alerted_at' => $s->last_alerted_at?->toISOString(),
                'created_at' => $s->created_at?->toISOString(),
            ], $searches)
        );
    }

    /**
     * POST /v2/marketplace/saved-searches
     */
    public function storeSavedSearch(Request $request): JsonResponse
    {
        $this->ensureFeature();
        $userId = $request->user()->id;

        $validated = $request->validate([
            'name' => 'required|string|max:100',
            'search_query' => 'nullable|string|max:255',
            'filters' => 'nullable|array',
            'filters.category_id' => ['nullable', 'integer', $this->availableCategoryRule()],
            'filters.price_min' => 'nullable|numeric|min:0',
            'filters.price_max' => 'nullable|numeric|min:0',
            'filters.condition' => 'nullable|string',
            'filters.location' => 'nullable|string|max:255',
            'filters.radius' => 'nullable|numeric|min:0|max:500',
            'alert_frequency' => 'nullable|in:instant,daily,weekly',
            'alert_channel' => 'nullable|in:email,push,both',
        ]);

        $search = MarketplaceDiscoveryService::createSavedSearch($userId, $validated);

        return $this->respondWithData([
            'id' => $search->id,
            'name' => $search->name,
            'search_query' => $search->search_query,
            'filters' => $search->filters,
            'alert_frequency' => $search->alert_frequency,
            'alert_channel' => $search->alert_channel,
            'is_active' => $search->is_active,
            'created_at' => $search->created_at?->toISOString(),
        ], null, 201);
    }

    /**
     * DELETE /v2/marketplace/saved-searches/{id}
     */
    public function destroySavedSearch(Request $request, int $id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $request->user()->id;

        MarketplaceDiscoveryService::deleteSavedSearch($id, $userId);

        return $this->respondWithData(['deleted' => true]);
    }

    // =====================================================================
    //  Collections
    // =====================================================================

    /**
     * GET /v2/marketplace/collections
     */
    public function listCollections(Request $request): JsonResponse
    {
        $this->ensureFeature();
        $userId = $request->user()->id;

        $collections = MarketplaceDiscoveryService::getCollections($userId);

        return $this->respondWithData(
            array_map(fn ($c) => [
                'id' => $c->id,
                'name' => $c->name,
                'description' => $c->description,
                'is_public' => $c->is_public,
                'item_count' => $c->item_count,
                'created_at' => $c->created_at?->toISOString(),
                'updated_at' => $c->updated_at?->toISOString(),
            ], $collections)
        );
    }

    /**
     * POST /v2/marketplace/collections
     */
    public function storeCollection(Request $request): JsonResponse
    {
        $this->ensureFeature();
        $userId = $request->user()->id;

        $validated = $request->validate([
            'name' => 'required|string|max:100',
            'description' => 'nullable|string|max:500',
            'is_public' => 'nullable|boolean',
        ]);

        $collection = MarketplaceDiscoveryService::createCollection($userId, $validated);

        return $this->respondWithData([
            'id' => $collection->id,
            'name' => $collection->name,
            'description' => $collection->description,
            'is_public' => $collection->is_public,
            'item_count' => 0,
            'created_at' => $collection->created_at?->toISOString(),
        ], null, 201);
    }

    /**
     * PUT /v2/marketplace/collections/{id}
     */
    public function updateCollection(Request $request, int $id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $request->user()->id;

        $collection = MarketplaceCollection::where('id', $id)
            ->where('user_id', $userId)
            ->first();

        if (!$collection) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.marketplace_collection_not_found'), null, 404);
        }

        $validated = $request->validate([
            'name' => 'sometimes|required|string|max:100',
            'description' => 'nullable|string|max:500',
            'is_public' => 'nullable|boolean',
        ]);

        $collection = MarketplaceDiscoveryService::updateCollection($collection, $validated);

        return $this->respondWithData([
            'id' => $collection->id,
            'name' => $collection->name,
            'description' => $collection->description,
            'is_public' => $collection->is_public,
            'item_count' => $collection->item_count,
            'updated_at' => $collection->updated_at?->toISOString(),
        ]);
    }

    /**
     * DELETE /v2/marketplace/collections/{id}
     */
    public function destroyCollection(Request $request, int $id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $request->user()->id;

        MarketplaceDiscoveryService::deleteCollection($id, $userId);

        return $this->respondWithData(['deleted' => true]);
    }

    /**
     * POST /v2/marketplace/collections/{id}/items
     */
    public function addCollectionItem(Request $request, int $id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $request->user()->id;

        // Verify collection ownership
        $collection = MarketplaceCollection::where('id', $id)
            ->where('user_id', $userId)
            ->first();

        if (!$collection) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.marketplace_collection_not_found'), null, 404);
        }

        $request->validate([
            'listing_id' => [
                'required',
                'integer',
                Rule::exists('marketplace_listings', 'id')
                    ->where('tenant_id', TenantContext::getId())
                    ->where(static function ($query) use ($userId): void {
                        $query->where(static function ($visibilityQuery) use ($userId): void {
                            $visibilityQuery->where('user_id', $userId)
                                ->orWhere(static function ($publicQuery): void {
                                    $publicQuery->where('status', 'active')
                                        ->where('moderation_status', 'approved')
                                        ->where(static function ($expiryQuery): void {
                                            $expiryQuery->whereNull('expires_at')
                                                ->orWhere('expires_at', '>', now());
                                        });
                                });
                        });
                    }),
            ],
            'note' => 'nullable|string|max:500',
        ]);

        MarketplaceDiscoveryService::addToCollection(
            $id,
            (int) $request->input('listing_id'),
            $request->input('note')
        );

        return $this->respondWithData(['added' => true], null, 201);
    }

    /**
     * DELETE /v2/marketplace/collections/{id}/items/{listingId}
     */
    public function removeCollectionItem(Request $request, int $id, int $listingId): JsonResponse
    {
        $this->ensureFeature();
        $userId = $request->user()->id;

        // Verify collection ownership
        $collection = MarketplaceCollection::where('id', $id)
            ->where('user_id', $userId)
            ->first();

        if (!$collection) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.marketplace_collection_not_found'), null, 404);
        }

        // F-503: a delete path, so the affected-row count is the right test
        // (O-174 — it is update paths where zero rows can still mean success).
        // Same refusal for a foreign listing and an invented id: no oracle.
        if (!MarketplaceDiscoveryService::removeFromCollection($id, $listingId)) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.marketplace_listing_not_found'), null, 404);
        }

        return $this->respondWithData(['removed' => true]);
    }

    /**
     * GET /v2/marketplace/collections/{id}/items
     */
    public function listCollectionItems(Request $request, int $id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $request->user()->id;

        // Verify collection ownership or is_public
        $collection = MarketplaceCollection::where('id', $id)
            ->where(function ($q) use ($userId) {
                $q->where('user_id', $userId)
                  ->orWhere('is_public', true);
            })
            ->first();

        if (!$collection) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.marketplace_collection_not_found'), null, 404);
        }

        $limit = max(1, min((int) $request->query('limit', 20), 100));
        $cursor = $request->query('cursor');

        $result = MarketplaceDiscoveryService::getCollectionItems(
            $id,
            $limit,
            $cursor,
            (int) $collection->user_id !== $userId,
            $userId
        );

        return $this->respondWithData($result['items'], [
            'cursor' => $result['cursor'],
            'has_more' => $result['has_more'],
        ], 200);
    }

    /**
     * Saved-search category filters may reference a tenant category or a
     * globally seeded system category, but never another tenant's category.
     */
    private function availableCategoryRule(): \Illuminate\Validation\Rules\Exists
    {
        $tenantId = TenantContext::getId();

        return Rule::exists('marketplace_categories', 'id')
            ->where(static function ($query) use ($tenantId): void {
                $query->where('is_active', true)
                    ->where(static function ($tenantQuery) use ($tenantId): void {
                        $tenantQuery->where('tenant_id', $tenantId)
                            ->orWhereNull('tenant_id');
                    });
            });
    }
}
