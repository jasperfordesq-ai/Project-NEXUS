<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Support\Authorization\AdminTier;
use App\Support\FeedItemTables;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * PostAnalyticsController — Analytics for post authors.
 *
 * Endpoints (v2):
 *   GET /api/v2/feed/posts/{id}/analytics  analytics()
 *   POST /api/v2/feed/posts/{id}/view      recordView()
 */
class PostAnalyticsController extends BaseApiController
{
    protected bool $isV2Api = true;

    /**
     * GET /api/v2/feed/posts/{id}/analytics
     *
     * Only accessible by the post author or admins.
     */
    public function analytics(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();

        // Fetch the post
        $post = DB::table('feed_posts')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$post) {
            return $this->respondWithError('NOT_FOUND', __('api.post_not_found'), null, 404);
        }

        // Check ownership or admin
        // F-466: admin authority is the four boolean flags as well as the role
        // string — a network administrator is granted the flag alone — so
        // AdminTier is the only safe predicate. It still refuses broker and
        // coordinator.
        $user = \Illuminate\Support\Facades\Auth::user();
        $isAdmin = AdminTier::allows($user);

        if ((int) $post->user_id !== $userId && !$isAdmin) {
            return $this->respondWithError('FORBIDDEN', __('api.post_analytics_own_only'), null, 403);
        }

        // Gather analytics
        $viewsCount = (int) ($post->views_count ?? 0);
        $likesCount = (int) ($post->likes_count ?? 0);
        $commentsQuery = DB::table('comments')
            ->where('target_type', 'post')
            ->where('target_id', $id)
            ->where('tenant_id', $tenantId);

        if (\Illuminate\Support\Facades\Schema::hasColumn('comments', 'deleted_at')) {
            $commentsQuery->whereNull('deleted_at');
        }

        $commentsCount = (int) $commentsQuery->count();

        // Shares count
        $sharesCount = (int) DB::table('post_shares')
            ->where('original_type', 'post')
            ->where('original_post_id', $id)
            ->where('tenant_id', $tenantId)
            ->count();

        // Reaction breakdown
        $reactionsBreakdown = DB::table('reactions')
            ->where('target_type', 'post')
            ->where('target_id', $id)
            ->where('tenant_id', $tenantId)
            ->select('emoji', DB::raw('COUNT(*) as count'))
            ->groupBy('emoji')
            ->pluck('count', 'emoji')
            ->toArray();

        // Unique viewers (reach estimate)
        $uniqueViewers = DB::table('post_views')
            ->where('post_id', $id)
            ->where('tenant_id', $tenantId)
            ->count();

        return $this->respondWithData([
            'post_id' => $id,
            'views_count' => $viewsCount,
            'likes_count' => $likesCount,
            'comments_count' => $commentsCount,
            'shares_count' => $sharesCount,
            'reactions_breakdown' => $reactionsBreakdown,
            'reach_estimate' => $uniqueViewers,
        ]);
    }

    /**
     * POST /api/v2/feed/posts/{id}/view — Record a post view.
     * Fire-and-forget from frontend.
     */
    public function recordView(int $id): JsonResponse
    {
        $userId = $this->getOptionalUserId();
        if (!FeedItemTables::canView('post', $id, $userId)) {
            return $this->respondWithError('NOT_FOUND', __('api.post_not_found'), null, 404);
        }

        $ipHash = hash('sha256', request()->ip() . ':' . $this->getTenantId());

        try {
            $viewService = app(\App\Services\PostViewService::class);
            $viewService->recordView($id, $userId, $ipHash);
        } catch (\Throwable $e) {
            // Non-critical — don't fail the request
            \Log::debug('View recording failed', ['post_id' => $id, 'error' => $e->getMessage()]);
        }

        return $this->respondWithData(['success' => true]);
    }
}
