<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Exceptions\SafeguardingPolicyException;
use App\Services\FeedService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;

/**
 * FeedController - Community feed (posts, likes, hide, mute, report).
 *
 * All endpoints migrated to native DB facade — no legacy delegation.
 *
 * Endpoints (v2):
 *   GET   /api/v2/feed            feed()
 *   POST  /api/v2/feed            createPost()
 *   POST  /api/v2/feed/like       like()
 *   POST  /api/v2/feed/hide       hidePost()
 *   POST  /api/v2/feed/mute       muteUser()
 *   POST  /api/v2/feed/report     reportPost()
 */
class FeedController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly FeedService $feedService,
    ) {}

    /**
     * Get the community feed with EdgeRank-sorted items.
     *
     * Query params: type, cursor, per_page.
     */
    public function feed(): JsonResponse
    {
        $tenantId = $this->getTenantId();
        $this->rateLimit("feed_get:{$tenantId}", 60, 60);

        $userId = $this->getOptionalUserId();

        $filters = [
            'limit' => $this->queryInt('per_page', 20, 1, 100),
        ];

        // Allowlist for the type (feed filter) param
        // 'badge_earned' / 'level_up' were listed here and are deliberately gone:
        // gamification milestones are no longer feed content, so there is no
        // filter that can select them (see FeedService::EXCLUDED_SOURCE_TYPES).
        $allowedFilters = ['all', 'posts', 'listings', 'events', 'polls', 'goals', 'jobs',
                           'challenges', 'volunteering', 'blogs', 'discussions',
                           'following', 'trending', 'for_you', 'groups', 'saved'];
        $typeParam = $this->query('type', 'all');
        if (!in_array($typeParam, $allowedFilters, true)) {
            $typeParam = 'all';
        }
        $filters['type'] = $typeParam;

        // Allowlist for the mode param
        $allowedModes = ['ranked', 'chronological'];
        $modeParam = $this->query('mode', 'ranked');
        if (!in_array($modeParam, $allowedModes, true)) {
            $modeParam = 'ranked';
        }
        $filters['mode'] = $modeParam;

        if ($this->query('cursor')) {
            $filters['cursor'] = $this->query('cursor');
        }
        if ($this->query('user_id')) {
            $profileUserId = (int) $this->query('user_id');
            $currentUserId = $userId;

            // H6: Enforce profile privacy_profile setting before returning another user's posts
            if ($profileUserId && $profileUserId !== $currentUserId) {
                $profile = DB::selectOne(
                    'SELECT privacy_profile FROM users WHERE id = ? AND tenant_id = ?',
                    [$profileUserId, $tenantId]
                );
                if (!$profile) {
                    // Profile not found in this tenant — return empty
                    return $this->respondWithCollection([], null, $filters['limit'] ?? 20, false);
                }
                if ($profile->privacy_profile === 'connections') {
                    // 'connections' — only visible to connected members; check connection
                    $isConnected = $currentUserId && DB::table('connections')
                        ->where('tenant_id', $tenantId)
                        ->where(function ($q) use ($currentUserId, $profileUserId) {
                            $q->where(function ($q2) use ($currentUserId, $profileUserId) {
                                $q2->where('requester_id', $currentUserId)->where('receiver_id', $profileUserId);
                            })->orWhere(function ($q2) use ($currentUserId, $profileUserId) {
                                $q2->where('requester_id', $profileUserId)->where('receiver_id', $currentUserId);
                            });
                        })
                        ->where('status', 'accepted')
                        ->exists();
                    if (!$isConnected) {
                        return $this->respondWithCollection([], null, $filters['limit'] ?? 20, false);
                    }
                }
                // 'members' means any logged-in member can see — no extra check needed
                // 'public' means anyone can see — no extra check needed
            }

            $filters['user_id'] = $profileUserId;
        }
        if ($this->query('group_id')) {
            $filters['group_id'] = (int) $this->query('group_id');
        }

        $result = $this->feedService->getFeed($userId, $filters);

        return $this->respondWithCollection(
            $result['items'],
            $result['cursor'] ?? null,
            $filters['limit'],
            $result['has_more'] ?? false
        );
    }

    /**
     * Create a new feed post. Requires authentication.
     */
    public function createPost(): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();
        // Fix 3: key rate limits on both tenant AND user to prevent one user exhausting tenant quota
        $this->rateLimit("feed_post:{$tenantId}:{$userId}", 10, 60);

        try {
            $post = $this->feedService->createPost($userId, $this->getAllInput());
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        // Handle validation errors from FeedService
        if (is_array($post) && isset($post['error'])) {
            return $this->respondWithError('VALIDATION_ERROR', $post['error'], null, 422);
        }

        // Award XP for creating a post
        try {
            \App\Services\GamificationService::awardXP($userId, \App\Services\GamificationService::XP_VALUES['create_post'], 'create_post', 'Created a feed post');
        } catch (\Throwable $e) {
            \Log::warning('Gamification XP award failed', ['action' => 'create_post', 'user' => $userId, 'error' => $e->getMessage()]);
        }

        return $this->respondWithData($post, null, 201);
    }

    /**
     * Like or unlike a feed item. Requires authentication.
     */
    public function like(): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();
        // Fix 3: key rate limits on both tenant AND user to prevent one user exhausting tenant quota
        $this->rateLimit("feed_like:{$tenantId}:{$userId}", 60, 60);

        $input = $this->getAllInput();
        $postId = (int) ($input['post_id'] ?? $input['target_id'] ?? 0);

        if ($postId <= 0) {
            return $this->respondWithError('INVALID_INPUT', __('api.invalid_post_id'));
        }

        try {
            $result = $this->feedService->like($postId, $userId);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('NOT_FOUND', __('api.post_not_found'), null, 404);
        }

        return $this->respondWithData($result);
    }

    /**
     * POST /api/v2/feed/hide
     *
     * Hide a post from the current user's feed.
     * Body: { "post_id": 123 }
     * Response: { "success": true }
     */
    public function hidePost(): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();
        // Fix 3: key rate limits on both tenant AND user to prevent one user exhausting tenant quota
        $this->rateLimit("feed_moderate:{$tenantId}:{$userId}", 30, 60);

        $postId = (int) ($this->input('post_id', 0));

        if ($postId <= 0) {
            return $this->respondWithError('INVALID_INPUT', __('api.invalid_post_id'));
        }

        // Fix 1: verify the post belongs to this tenant before hiding (IDOR prevention)
        $post = DB::table('feed_posts')
            ->where('id', $postId)
            ->where('tenant_id', $tenantId)
            ->select(['id', 'is_official'])
            ->first();

        if (!$post) {
            return $this->respondWithError('NOT_FOUND', __('api.post_not_found'), null, 404);
        }

        // AG14: official municipality announcements cannot be hidden by members
        if (!empty($post->is_official)) {
            return $this->respondWithError('FORBIDDEN', __('api.cannot_hide_official_post'), null, 403);
        }

        try {
            DB::table('user_hidden_posts')->insertOrIgnore([
                'user_id'    => $userId,
                'post_id'    => $postId,
                'tenant_id'  => $tenantId,
                'created_at' => now(),
            ]);

            return $this->respondWithData(['success' => true]);
        } catch (\Exception $e) {
            return $this->respondWithError('DATABASE_ERROR', __('api.database_error'), null, 500);
        }
    }

    /**
     * POST /api/v2/feed/mute
     *
     * Mute a user so their posts are hidden from the current user's feed.
     * Body: { "user_id": 456 }
     * Response: { "success": true }
     */
    public function muteUser(): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();
        // Fix 3: key rate limits on both tenant AND user to prevent one user exhausting tenant quota
        $this->rateLimit("feed_moderate:{$tenantId}:{$userId}", 30, 60);

        $mutedUserId = (int) ($this->input('user_id', 0));

        if ($mutedUserId <= 0 || $mutedUserId === $userId) {
            return $this->respondWithError('INVALID_INPUT', __('api.invalid_user'));
        }

        // Fix 2: verify the target user belongs to this tenant before muting
        $targetExists = DB::table('users')
            ->where('id', $mutedUserId)
            ->where('tenant_id', $tenantId)
            ->exists();

        if (!$targetExists) {
            return $this->respondWithError('NOT_FOUND', __('api.user_not_found'), null, 404);
        }

        try {
            DB::table('user_muted_users')->insertOrIgnore([
                'user_id'       => $userId,
                'muted_user_id' => $mutedUserId,
                'tenant_id'     => $tenantId,
                'created_at'    => now(),
            ]);

            return $this->respondWithData(['success' => true]);
        } catch (\Exception $e) {
            return $this->respondWithError('DATABASE_ERROR', __('api.database_error'), null, 500);
        }
    }

    /**
     * POST /api/v2/feed/report
     *
     * Report a post for moderation.
     * Body: { "post_id": 123, "target_type"?: "post" }
     * Response: { "success": true }
     */
    public function reportPost(): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();
        // Fix 3: key rate limits on both tenant AND user to prevent one user exhausting tenant quota
        $this->rateLimit("feed_moderate:{$tenantId}:{$userId}", 30, 60);

        $postId = (int) ($this->input('post_id', 0));

        $allowedTargetTypes = ['post', 'comment', 'story'];
        $targetType = $this->input('target_type', 'post');
        if (!in_array($targetType, $allowedTargetTypes, true)) {
            return $this->respondWithError('INVALID_INPUT', __('api.invalid_target_type'), null, 422);
        }

        if ($postId <= 0) {
            return $this->respondWithError('INVALID_INPUT', __('api.invalid_post_id'));
        }

        // M2: Verify the target actually exists in this tenant before recording the report
        if ($targetType === 'post') {
            $exists = DB::table('feed_posts')
                ->where('id', $postId)
                ->where('tenant_id', $tenantId)
                ->exists();
            if (!$exists) {
                return $this->respondWithError('NOT_FOUND', __('api.post_not_found'), null, 404);
            }
        }

        // Prevent duplicate reports from the same user
        $existing = DB::table('reports')
            ->where('target_id', $postId)
            ->where('reporter_id', $userId)
            ->where('tenant_id', $tenantId)
            ->exists();
        if ($existing) {
            return $this->respondWithError('DUPLICATE', __('api.already_reported'), null, 409);
        }

        try {
            $reason = (string) __('api.feed_report_default_reason');
            $reportId = DB::table('reports')->insertGetId([
                'tenant_id'   => $tenantId,
                'reporter_id' => $userId,
                'target_type' => $targetType,
                'target_id'   => $postId,
                'reason'      => $reason,
                'status'      => 'open',
                'created_at'  => now(),
            ]);

            // Alert moderators a new report awaits review — these reports were
            // previously written with no admin signal (silent moderation queue).
            try {
                \App\Services\NotificationDispatcher::notifyModerationAdmins(
                    'feed_report_created',
                    '/admin/reports',
                    'svc_notifications_2.feed_report.admin_alert',
                    'emails_misc.moderation.feed_subject',
                    'emails_misc.moderation.feed_body',
                    ['post_type' => $targetType, 'reason' => $reason, 'report_id' => $reportId]
                );
            } catch (\Throwable $notifyError) {
                \Illuminate\Support\Facades\Log::warning('Feed report admin alert failed: ' . $notifyError->getMessage());
            }

            return $this->respondWithData(['success' => true]);
        } catch (\Exception $e) {
            return $this->respondWithError('DATABASE_ERROR', __('api.database_error'), null, 500);
        }
    }
}
