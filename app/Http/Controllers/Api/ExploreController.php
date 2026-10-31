<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Services\Translation\TaxonomyNameLocalizer;
use App\Core\TenantContext;
use App\Services\ExploreService;
use App\Services\MatchLearningService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * ExploreController — Discover/Explore page API endpoints.
 *
 * Serves aggregated discovery data for the frontend Explore page.
 *
 * Endpoints (v2):
 *   GET  /api/v2/explore                    index()
 *   GET  /api/v2/explore/trending           trending()
 *   GET  /api/v2/explore/popular-listings   popularListings()
 *   GET  /api/v2/explore/category/{slug}    category()
 *   POST /api/v2/explore/track              track()
 *   POST /api/v2/explore/dismiss            dismiss()
 */
class ExploreController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly ExploreService $exploreService,
        private readonly MatchLearningService $matchLearning,
    ) {}

    /**
     * Get full explore page data — all sections in one call.
     */
    public function index(): JsonResponse
    {
        $userId = $this->requireAuth();
        $data = $this->exploreService->getExploreData($userId);
        // Category names in the reader's language (cached sections hold the stored names).
        $data = is_array($data) ? TaxonomyNameLocalizer::localizePayload($data) : $data;

        return $this->respondWithData($data);
    }

    /**
     * Get the unified "For You" mixed content feed.
     * Returns a paginated feed mixing posts, listings, events, groups, members, and blogs.
     */
    public function forYou(): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();
        $page = $this->queryInt('page', 1, 1);
        $perPage = $this->queryInt('per_page', 20, 1, 50);

        $result = $this->exploreService->getForYouFeed($tenantId, $userId, $page, $perPage);
        // Category names in the reader's language (cached sections hold the stored names).
        $result = is_array($result) ? TaxonomyNameLocalizer::localizePayload($result) : $result;

        return $this->respondWithPaginatedCollection(
            $result['items'],
            $result['total'],
            $result['page'],
            $result['per_page']
        );
    }

    /**
     * Get trending posts with pagination.
     */
    public function trending(): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();
        $page = $this->queryInt('page', 1, 1);
        $perPage = $this->queryInt('per_page', 20, 1, 100);

        $result = $this->exploreService->getTrendingPostsPaginated($tenantId, $userId, $page, $perPage);

        return $this->respondWithPaginatedCollection(
            $result['items'],
            $result['total'],
            $result['page'],
            $result['per_page']
        );
    }

    /**
     * Get popular listings with pagination.
     */
    public function popularListings(): JsonResponse
    {
        $this->requireAuth();
        $tenantId = $this->getTenantId();
        $page = $this->queryInt('page', 1, 1);
        $perPage = $this->queryInt('per_page', 20, 1, 100);

        $result = $this->exploreService->getPopularListingsPaginated($tenantId, $page, $perPage);
        // Category names in the reader's language (cached sections hold the stored names).
        $result = is_array($result) ? TaxonomyNameLocalizer::localizePayload($result) : $result;

        return $this->respondWithPaginatedCollection(
            $result['items'],
            $result['total'],
            $result['page'],
            $result['per_page']
        );
    }

    /**
     * Browse listings by category.
     */
    public function category(string $slug): JsonResponse
    {
        $this->requireAuth();
        $tenantId = $this->getTenantId();
        $page = $this->queryInt('page', 1, 1);
        $perPage = $this->queryInt('per_page', 20, 1, 100);

        $result = $this->exploreService->getListingsByCategory($tenantId, $slug, $page, $perPage);
        // Category names in the reader's language (cached sections hold the stored names).
        $result = is_array($result) ? TaxonomyNameLocalizer::localizePayload($result) : $result;

        if ($result['category'] === null) {
            return $this->respondWithError('CATEGORY_NOT_FOUND', __('api.category_not_found'), null, 404);
        }

        return $this->respondWithPaginatedCollection(
            $result['items'],
            $result['total'],
            $result['page'],
            $result['per_page'],
        );
    }

    /**
     * Track an explore interaction (impression, click, save, dwell).
     * Feeds into MatchLearningService for future recommendation quality.
     */
    public function track(): JsonResponse
    {
        $userId = $this->requireAuth();
        $input = request()->all();

        $itemType = $input['item_type'] ?? null; // listing, post, event, group, member
        $itemId = (int) ($input['item_id'] ?? 0);
        $action = $input['action'] ?? 'view'; // impression, click, save, dwell

        if (!$itemId || !$itemType) {
            return $this->respondWithError('INVALID_INPUT', __('api.item_type_and_id_required'), null, 422);
        }

        // Validate item_type against allowlist to prevent cache poisoning / log injection
        $validItemTypes = ['listing', 'post', 'event', 'group', 'member', 'job', 'vol_opportunity', 'blog'];
        if (!in_array($itemType, $validItemTypes, true)) {
            return $this->respondWithError('INVALID_INPUT', __('api.invalid_item_type'), 'item_type', 422);
        }

        // Map explore actions to match_history actions
        $actionMap = [
            'impression' => 'impression',
            'click' => 'view',
            'save' => 'save',
            'dwell' => 'view',
        ];
        $historyAction = $actionMap[$action] ?? 'view';

        // Only record listing interactions in match_history (other types can be extended later)
        if ($itemType === 'listing') {
            $this->matchLearning->recordInteraction($userId, $itemId, $historyAction, [
                'source' => 'explore',
                'original_action' => $action,
            ]);
        }

        return $this->respondWithData(['tracked' => true]);
    }

    /**
     * Dismiss an explore recommendation. Stores in match_dismissals and
     * invalidates the user's personalized explore cache.
     */
    public function dismiss(): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();
        $input = request()->all();

        $itemType = $input['item_type'] ?? 'listing';
        $itemId = (int) ($input['item_id'] ?? 0);
        $reason = $input['reason'] ?? null; // not_relevant, already_seen, not_interested

        if (!$itemId) {
            return $this->respondWithError('INVALID_INPUT', __('api.item_id_required'), null, 422);
        }

        try {
            if ($itemType === 'listing') {
                // Record dismissal
                DB::table('match_dismissals')->insertOrIgnore([
                    'tenant_id' => $tenantId,
                    'user_id' => $userId,
                    'listing_id' => $itemId,
                    'reason' => $reason,
                    'created_at' => now(),
                ]);

                // Also record in match_history for learning
                $this->matchLearning->recordInteraction($userId, $itemId, 'dismiss', [
                    'source' => 'explore',
                    'reason' => $reason,
                ]);
            }

            // Invalidate user's personalized explore cache
            $cacheKey = "nexus:explore:{$tenantId}:{$userId}";
            \Illuminate\Support\Facades\Cache::forget($cacheKey);

            return $this->respondWithData(['dismissed' => true]);
        } catch (\Throwable $e) {
            return $this->respondWithError('DISMISS_FAILED', __('api.failed_dismiss_item'), null, 500);
        }
    }

    /**
     * Get explore analytics for admin dashboard (Phase 6.2).
     * Returns interaction stats, dismissal data, and cache status.
     */
    public function analytics(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $data = $this->exploreService->getExploreAnalytics($tenantId);

        return $this->respondWithData($data);
    }

    /**
     * Get the current user's A/B experiment cohort (Phase 6.3).
     */
    public function experiments(): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();

        $data = $this->exploreService->getUserExperimentCohort($tenantId, $userId);

        return $this->respondWithData($data);
    }
}
