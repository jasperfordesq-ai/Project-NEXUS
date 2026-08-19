<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Services\SearchService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * SearchController - Unified search across content types.
 *
 * Endpoints (v2):
 *   GET  /api/v2/search              index()        — unified search
 *   GET  /api/v2/search/suggestions  suggestions()  — autocomplete
 *   GET  /api/v2/search/trending     trending()     — trending terms
 */
class SearchController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly SearchService $searchService,
    ) {}

    // -----------------------------------------------------------------
    //  GET /api/v2/search
    // -----------------------------------------------------------------

    /**
     * Unified search across listings, users, events, groups, and podcasts.
     *
     * Query params: q (required, min 2), type (all|listings|users|events|groups|podcasts),
     *               cursor, per_page (default 20, max 50), category_id,
     *               sort (relevance|newest|oldest), skills.
     */
    public function index(): JsonResponse
    {
        $this->rateLimit('search', 60, 60);

        $query = trim($this->query('q', ''));

        if (strlen($query) < 2) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.search_query_min_length'), 'q', 400);
        }

        if (mb_strlen($query) > 500) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.search_query_too_long'), 'q', 422);
        }

        // Validate type param
        $type = $this->query('type');
        if ($type !== null) {
            $validTypes = ['all', 'listings', 'users', 'events', 'groups', 'podcasts'];
            if (! in_array($type, $validTypes, true)) {
                return $this->respondWithError(
                    'VALIDATION_ERROR',
                    __('api.invalid_search_type', ['types' => implode(', ', $validTypes)]),
                    'type',
                    400
                );
            }
        }

        $userId = $this->getOptionalUserId();

        $filters = [
            'limit' => $this->queryInt('per_page', 20, 1, 50),
        ];

        if ($type) {
            $filters['type'] = $type;
        }
        if ($this->query('cursor')) {
            $filters['cursor'] = $this->query('cursor');
        }
        if ($this->query('category_id')) {
            $filters['category_id'] = $this->queryInt('category_id');
        }
        if ($this->query('sort')) {
            $validSorts = ['relevance', 'newest', 'oldest'];
            $sort = $this->query('sort');
            if (in_array($sort, $validSorts, true)) {
                $filters['sort'] = $sort;
            }
        }
        if ($this->query('skills')) {
            $filters['skills'] = $this->query('skills');
        }

        $result = $this->searchService->unifiedSearch($query, $userId, $filters);

        return $this->respondWithData($result['items'], [
            'pagination' => [
                'cursor'   => $result['cursor'],
                'per_page' => $filters['limit'],
                'has_more' => $result['has_more'],
            ],
            'search' => [
                'query' => $result['query'],
                'total' => $result['total'],
                'type'  => $filters['type'] ?? 'all',
            ],
        ]);
    }

    // -----------------------------------------------------------------
    //  GET /api/v2/search/suggestions
    // -----------------------------------------------------------------

    /**
     * Get autocomplete suggestions for a partial query.
     *
     * Query params: q (required, min 2), limit (default 5, max 10).
     */
    public function suggestions(): JsonResponse
    {
        $this->rateLimit('search_suggestions', 120, 60);

        $query = trim($this->query('q', ''));

        if (strlen($query) < 2) {
            return $this->respondWithData([
                'listings' => [],
                'users'    => [],
                'events'   => [],
                'groups'   => [],
            ]);
        }

        $limit = $this->queryInt('limit', 5, 1, 10);

        $suggestions = $this->searchService->suggestions($query, $limit);

        return $this->respondWithData($suggestions);
    }

    // -----------------------------------------------------------------
    //  GET /api/v2/search/trending
    // -----------------------------------------------------------------

    /**
     * Get trending search terms for the current tenant.
     *
     * Query params: days (default 7, max 30), limit (default 10, max 50).
     */
    public function trending(): JsonResponse
    {
        $this->rateLimit('search_trending', 30, 60);

        $days = $this->queryInt('days', 7, 1, 30);
        $limit = $this->queryInt('limit', 10, 1, 50);

        $trending = $this->searchService->trending($days, $limit);

        return $this->respondWithData($trending);
    }

    // -----------------------------------------------------------------
    //  GET /api/v2/search/saved
    // -----------------------------------------------------------------

    /**
     * List the authenticated user's saved searches.
     */
    public function savedSearches(): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = TenantContext::getId();

        $rows = DB::table('saved_searches')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->orderBy('created_at', 'desc')
            ->get();

        return $this->respondWithData($rows->map(fn ($r) => [
            'id'                => $r->id,
            'name'              => $r->name,
            'query_params'      => json_decode($r->query_params, true) ?? [],
            'notify_on_new'     => (bool) $r->notify_on_new,
            'last_run_at'       => $r->last_run_at,
            'last_result_count' => $r->last_result_count,
            'created_at'        => $r->created_at,
        ])->all());
    }

    // -----------------------------------------------------------------
    //  POST /api/v2/search/saved
    // -----------------------------------------------------------------

    /**
     * Save the current search for later re-use.
     *
     * Body: name (required), query_params (object), notify_on_new (bool).
     */
    public function saveSearch(): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = TenantContext::getId();

        $input = $this->getAllInput();
        $name = trim($input['name'] ?? '');

        if ($name === '') {
            return $this->respondWithError('VALIDATION_ERROR', __('api.name_required'), 'name', 400);
        }

        if (mb_strlen($name) > 255) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.name_max_length'), 'name', 400);
        }

        $queryParams = $input['query_params'] ?? [];
        if (! is_array($queryParams)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.query_params_must_be_object'), 'query_params', 400);
        }

        $notifyOnNew = ! empty($input['notify_on_new']);

        $id = DB::table('saved_searches')->insertGetId([
            'tenant_id'     => $tenantId,
            'user_id'       => $userId,
            'name'          => $name,
            'query_params'  => json_encode($queryParams),
            'notify_on_new' => $notifyOnNew ? 1 : 0,
            'created_at'    => now(),
            'updated_at'    => now(),
        ]);

        return $this->respondWithData([
            'id'                => $id,
            'name'              => $name,
            'query_params'      => $queryParams,
            'notify_on_new'     => $notifyOnNew,
            'last_run_at'       => null,
            'last_result_count' => null,
            'created_at'        => now()->toDateTimeString(),
        ], [], 201);
    }

    // -----------------------------------------------------------------
    //  DELETE /api/v2/search/saved/{id}
    // -----------------------------------------------------------------

    /**
     * Delete a saved search (owner only).
     */
    public function deleteSavedSearch(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = TenantContext::getId();

        $deleted = DB::table('saved_searches')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->delete();

        if (! $deleted) {
            return $this->respondWithError('NOT_FOUND', __('api.saved_search_not_found'), null, 404);
        }

        return $this->respondWithData(['deleted' => true]);
    }

    // -----------------------------------------------------------------
    //  POST /api/v2/search/saved/{id}/run
    // -----------------------------------------------------------------

    /**
     * Record a run of a saved search (updates last_run_at).
     *
     * Body: result_count (int, optional).
     */
    public function runSavedSearch(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = TenantContext::getId();

        $row = DB::table('saved_searches')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->first();

        if (! $row) {
            return $this->respondWithError('NOT_FOUND', __('api.saved_search_not_found'), null, 404);
        }

        $input = $this->getAllInput();
        $resultCount = isset($input['result_count']) ? (int) $input['result_count'] : null;

        DB::table('saved_searches')
            ->where('id', $id)
            ->update([
                'last_run_at'       => now(),
                'last_result_count' => $resultCount,
                'updated_at'        => now(),
            ]);

        return $this->respondWithData([
            'id'                => $row->id,
            'query_params'      => json_decode($row->query_params, true) ?? [],
            'last_run_at'       => now()->toDateTimeString(),
            'last_result_count' => $resultCount,
        ]);
    }
}
