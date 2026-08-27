<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Exceptions\SafeguardingPolicyException;
use App\Models\Notification;
use App\Models\User;
use App\Services\FeedService;
use App\Services\FeedSocialService;
use App\Services\ShareService;
use App\Support\FeedItemTables;
use App\Support\CursorSigner;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use App\Core\TenantContext;

/**
 * FeedSocialController — Social features for the feed (shares, hashtags).
 *
 * Native Eloquent implementation — no legacy delegation.
 */
class FeedSocialController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly FeedSocialService $socialService,
        private readonly ShareService $shareService,
    ) {}

    // =============================================
    // POST SHARING / REPOSTING
    // =============================================

    /**
     * POST /api/v2/feed/posts/{id}/share
     *
     * Legacy: share a native feed post. Delegates to ShareService with type='post'.
     * New polymorphic clients should call POST /api/v2/shares instead.
     */
    public function sharePost(int $id): JsonResponse
    {
        return $this->doShare('post', $id);
    }

    /**
     * DELETE /api/v2/feed/posts/{id}/share
     *
     * Legacy: remove a share on a native feed post.
     */
    public function unsharePost(int $id): JsonResponse
    {
        return $this->doUnshare('post', $id);
    }

    /**
     * POST /api/v2/shares
     * Body: { type: string, id: int, comment?: string }
     *
     * Polymorphic toggle-style share for ANY feed item type
     * (post, listing, event, poll, job, blog, discussion, goal, challenge, volunteer).
     * If the user already shared this item, this acts as an UNSHARE (toggles off).
     *
     * @return JsonResponse { data: { shared: bool, count: int, share_id: ?int } }
     */
    public function share(): JsonResponse
    {
        $type = (string) ($this->input('type') ?? '');
        $id = (int) ($this->input('id') ?? 0);
        $comment = $this->input('comment');
        $comment = $comment === null ? null : (string) $comment;

        if ($type === '' || $id <= 0) {
            return $this->respondWithError('INVALID_INPUT', __('api.invalid_input'), null, 422);
        }

        return $this->doShare($type, $id, $comment);
    }

    /**
     * DELETE /api/v2/shares
     * Body: { type: string, id: int }
     *
     * Explicit unshare endpoint (idempotent — returns 200 even if no row existed).
     */
    public function unshare(): JsonResponse
    {
        $type = (string) ($this->input('type') ?? '');
        $id = (int) ($this->input('id') ?? 0);

        if ($type === '' || $id <= 0) {
            return $this->respondWithError('INVALID_INPUT', __('api.invalid_input'), null, 422);
        }

        return $this->doUnshare($type, $id);
    }

    /**
     * Shared share/toggle path used by both the legacy post-specific endpoint and
     * the new polymorphic /v2/shares endpoint.
     */
    private function doShare(string $type, int $id, ?string $comment = null): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('feed_share', 20, 60);

        try {
            $result = $this->shareService->toggle($userId, $type, $id, $comment);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('INVALID_INPUT', __('api.invalid_shareable_type'), null, 422);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('NOT_FOUND', __('api.post_not_found'), null, 404);
        } catch (\DomainException $e) {
            return $this->respondWithError('SELF_SHARE', __('api.cannot_share_own_post'), null, 422);
        }

        return $this->respondWithData([
            'shared'   => $result['shared'],
            'count'    => $result['count'],
            'share_id' => $result['share_id'],
            'type'     => $type,
            'id'       => $id,
        ], null, $result['shared'] ? 201 : 200);
    }

    /**
     * Shared unshare path. Idempotent: returns success even if no existing share.
     */
    private function doUnshare(string $type, int $id): JsonResponse
    {
        $userId = $this->requireAuth();

        try {
            $this->shareService->validateType($type);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('INVALID_INPUT', __('api.invalid_shareable_type'), null, 422);
        }

        // If a share exists, toggle() will remove it. Otherwise this is a no-op.
        if (!$this->shareService->isShared($userId, $type, $id)) {
            return $this->respondWithData([
                'shared' => false,
                'count'  => $this->shareService->getShareCount($type, $id),
                'type'   => $type,
                'id'     => $id,
            ]);
        }

        try {
            $result = $this->shareService->toggle($userId, $type, $id);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('NOT_FOUND', __('api.post_not_found'), null, 404);
        } catch (\DomainException $e) {
            // Can't happen on an unshare (self-share check only triggers on new shares).
            return $this->respondWithError('INVALID_INPUT', __('api.invalid_input'), null, 422);
        }

        return $this->respondWithData([
            'shared' => $result['shared'],
            'count'  => $result['count'],
            'type'   => $type,
            'id'     => $id,
        ]);
    }

    /**
     * GET /api/v2/feed/posts/{id}/sharers[?type=]
     *
     * Get users who shared an item. `type` defaults to 'post' for backwards
     * compatibility with the /feed/posts/{id}/sharers URL shape.
     */
    public function getSharers(int $id): JsonResponse
    {
        $tenantId = $this->getTenantId();
        $this->rateLimit('feed_sharers', 30, 60);

        $type = (string) $this->query('type', 'post');
        if (!in_array($type, ShareService::VALID_TYPES, true)) {
            $type = 'post';
        }

        $viewerId = $this->getOptionalUserId();
        if (!FeedItemTables::canView($type, $id, $viewerId)) {
            return $this->respondWithError('NOT_FOUND', __('api.target_not_found'), null, 404);
        }

        $limit = $this->queryInt('limit', 20, 1, 100);

        $sharers = DB::table('post_shares as ps')
            ->join('users as u', function ($join) use ($tenantId) {
                $join->on('ps.user_id', '=', 'u.id')
                    ->where('u.tenant_id', '=', $tenantId);
            })
            ->where('ps.original_type', $type)
            ->where('ps.original_post_id', $id)
            ->where('ps.tenant_id', $tenantId)
            ->orderByDesc('ps.created_at')
            ->limit($limit)
            ->select('u.id', 'u.first_name', 'u.last_name', 'u.profile_type', 'u.organization_name', 'u.avatar_url', 'ps.comment', 'ps.created_at')
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();

        $shareCount = $this->shareService->getShareCount($type, $id, $tenantId);

        $hasShared = false;
        if ($viewerId) {
            $hasShared = $this->shareService->isShared($viewerId, $type, $id, $tenantId);
        }

        return $this->respondWithData([
            'sharers'     => $sharers,
            'share_count' => $shareCount,
            'has_shared'  => $hasShared,
            'type'        => $type,
            'id'          => $id,
        ]);
    }

    // =============================================
    // HASHTAGS
    // =============================================

    /**
     * GET /api/v2/feed/hashtags/trending
     *
     * Get currently trending hashtags.
     */
    public function getTrendingHashtags(): JsonResponse
    {
        $tenantId = $this->getTenantId();
        $this->rateLimit('hashtags_trending', 30, 60);

        $limit = $this->queryInt('limit', 10, 1, 50);
        $days = $this->queryInt('days', 7, 1, 90);

        $since = now()->subDays($days);

        $trending = DB::table('hashtags')
            ->where('tenant_id', $tenantId)
            ->where('last_used_at', '>=', $since)
            ->where('post_count', '>', 0)
            ->orderByDesc('post_count')
            ->limit($limit)
            ->select('id', 'tag', 'post_count', 'last_used_at')
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();

        return $this->respondWithData($trending);
    }

    /**
     * GET /api/v2/feed/hashtags/search
     *
     * Search/autocomplete hashtags.
     */
    public function searchHashtags(): JsonResponse
    {
        $tenantId = $this->getTenantId();
        $this->rateLimit('hashtags_search', 60, 60);

        $query = $this->query('q', '');
        if (strlen($query) < 1) {
            return $this->respondWithData([]);
        }

        $limit = $this->queryInt('limit', 10, 1, 50);

        // M3: Strip LIKE wildcard characters to prevent pattern injection
        $escapedQuery = preg_replace('/[%_]/', '', $query);
        $likePattern = strtolower($escapedQuery) . '%';

        $results = DB::table('hashtags')
            ->where('tenant_id', $tenantId)
            ->where('tag', 'LIKE', $likePattern)
            ->orderByDesc('post_count')
            ->limit($limit)
            ->select('id', 'tag', 'post_count')
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();

        return $this->respondWithData($results);
    }

    /**
     * GET /api/v2/feed/hashtags/{tag}
     *
     * Get posts with a specific hashtag.
     */
    public function getHashtagPosts(string $tag): JsonResponse
    {
        $tenantId = $this->getTenantId();
        $viewerId = $this->getOptionalUserId();
        $this->rateLimit('hashtags_posts', 30, 60);

        $limit = $this->queryInt('limit', 20, 1, 100);
        $cursor = $this->query('cursor');

        $normalizedTag = strtolower(ltrim($tag, '#'));

        // Find the hashtag
        $hashtag = DB::table('hashtags')
            ->where('tenant_id', $tenantId)
            ->where('tag', $normalizedTag)
            ->first();

        if (! $hashtag) {
            return $this->respondWithCollection([], null, $limit, false, ['total_items' => 0]);
        }

        $baseQuery = DB::table('post_hashtags as ph')
            ->join('feed_posts as fp', 'ph.post_id', '=', 'fp.id')
            ->where('ph.hashtag_id', $hashtag->id)
            ->where('ph.tenant_id', $tenantId)
            ->where('fp.tenant_id', $tenantId)
            ->whereNull('fp.deleted_at')
            ->where(function ($q) {
                $q->whereNull('fp.publish_status')
                    ->orWhere('fp.publish_status', 'published');
            })
            ->where(function ($q) {
                $q->whereNull('fp.is_hidden')
                    ->orWhere('fp.is_hidden', 0);
            });

        $this->applyPostVisibility($baseQuery, $tenantId, $viewerId);

        // Count total viewable posts for this hashtag (without cursor/limit)
        $totalCount = (int) (clone $baseQuery)->distinct()->count('fp.id');

        $query = (clone $baseQuery)->select('fp.id');

        if ($cursor !== null) {
            // HMAC-signed cursor — same scheme as FeedService::getFeedItems().
            // Prevents tampering (skipping to arbitrary post ids) and reverse-
            // iteration scraping by clients constructing their own cursors.
            $payload = CursorSigner::decode($cursor);
            if ($payload !== null && isset($payload['id'])) {
                $query->where('fp.id', '<', (int) $payload['id']);
            }
        }

        $items = $query->orderByDesc('fp.id')->limit($limit + 1)->get();
        $hasMore = $items->count() > $limit;
        if ($hasMore) {
            $items->pop();
        }

        $feedService = app(FeedService::class);
        $feedItems = $items
            ->map(fn ($i) => $feedService->getItem('post', (int) $i->id, $viewerId))
            ->filter()
            ->values()
            ->all();

        $nextCursor = $hasMore && $items->isNotEmpty()
            ? CursorSigner::encode(['id' => (int) $items->last()->id])
            : null;

        return $this->respondWithCollection(
            $feedItems,
            $nextCursor,
            $limit,
            $hasMore,
            ['total_items' => $totalCount]
        );
    }

    /**
     * Alias for getTrendingHashtags (used by some routes).
     */
    public function trendingHashtags(): JsonResponse
    {
        return $this->getTrendingHashtags();
    }

    /**
     * Alias for getHashtagPosts (used by some routes).
     */
    public function hashtagPosts(string $tag): JsonResponse
    {
        return $this->getHashtagPosts($tag);
    }

    private function applyPostVisibility($query, int $tenantId, ?int $viewerId): void
    {
        $query->where(function ($q) use ($tenantId, $viewerId) {
            $q->whereNull('fp.group_id');

            if ($viewerId) {
                $q->orWhereExists(function ($sub) use ($tenantId, $viewerId) {
                    $sub->select(DB::raw(1))
                        ->from('groups as g')
                        ->whereColumn('g.id', 'fp.group_id')
                        ->where('g.tenant_id', $tenantId)
                        ->where('g.status', 'active')
                        ->where(function ($groupAccess) use ($tenantId, $viewerId) {
                            $groupAccess->where('g.owner_id', $viewerId)
                                ->orWhereExists(function ($member) use ($tenantId, $viewerId) {
                                    $member->select(DB::raw(1))
                                        ->from('group_members as gm')
                                        ->whereColumn('gm.group_id', 'g.id')
                                        ->where('gm.tenant_id', $tenantId)
                                        ->where('gm.user_id', $viewerId)
                                        ->where('gm.status', 'active');
                                });
                        });
                });
            }
        });

        $query->where(function ($q) use ($tenantId, $viewerId) {
            $q->whereNull('fp.visibility')
                ->orWhere('fp.visibility', 'public');

            if ($viewerId) {
                $q->orWhere('fp.user_id', $viewerId)
                    ->orWhere(function ($connections) use ($tenantId, $viewerId) {
                        $connections->whereIn('fp.visibility', ['friends', 'connections'])
                            ->whereExists(function ($sub) use ($tenantId, $viewerId) {
                                $sub->select(DB::raw(1))
                                    ->from('connections as c')
                                    ->where('c.tenant_id', $tenantId)
                                    ->where('c.status', 'accepted')
                                    ->where(function ($pair) use ($viewerId) {
                                        $pair->where(function ($a) use ($viewerId) {
                                            $a->where('c.requester_id', $viewerId)
                                                ->whereColumn('c.receiver_id', 'fp.user_id');
                                        })->orWhere(function ($b) use ($viewerId) {
                                            $b->whereColumn('c.requester_id', 'fp.user_id')
                                                ->where('c.receiver_id', $viewerId);
                                        });
                                    });
                            });
                    });
            }
        });
    }
}
