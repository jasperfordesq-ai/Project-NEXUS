<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Exceptions\SafeguardingPolicyException;
use App\Services\CommentService;
use App\Services\FeedActivityService;
use App\Services\FeedRankingService;
use App\Services\FeedService;
use App\Services\LinkPreviewService;
use App\Services\PersonalisedFeedService;
use App\Services\PollService;
use App\Services\PostMediaService;
use App\Services\ReactionService;
use App\Services\SocialNotificationService;
use App\Core\TenantContext;
use App\Support\FeedItemTables;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Models\FeedPost;

/**
 * SocialController -- Social feed posts, likes, polls, comments, reactions.
 *
 * All methods are native — no legacy delegation. File uploads use Laravel's
 * request()->file() instead of $_FILES.
 */
class SocialController extends BaseApiController
{
    protected bool $isV2Api = true;

    /**
     * Valid target types for likes.
     *
     * MUST stay aligned with feed_activity.source_type values so a like applied
     * from the feed reaches the same row that the feed query reads. 'volunteer'
     * is the canonical name (singular, matching feed_activity); 'volunteering'
     * is accepted as a legacy alias and normalised in likeV2().
     */
    private const VALID_LIKE_TARGETS = [
        'post', 'listing', 'event', 'poll', 'goal',
        'resource', 'volunteer', 'volunteering', 'review', 'challenge', 'comment',
        'job', 'blog', 'discussion',
    ];

    public function __construct(
        private readonly FeedService $feedService,
        private readonly SocialNotificationService $socialNotificationService,
        private readonly CommentService $commentService,
        private readonly FeedRankingService $feedRankingService,
        private readonly FeedActivityService $feedActivityService,
        private readonly PollService $pollService,
        private readonly PostMediaService $postMediaService,
        private readonly PersonalisedFeedService $personalisedFeedService,
        private readonly ReactionService $reactionService,
    ) {}

    /**
     * GET /api/v2/feed
     *
     * Returns paginated feed items from the feed_activity table.
     * Native Eloquent — no delegation.
     */
    public function feedV2(): JsonResponse
    {
        $userId = $this->getOptionalUserId();

        $userLimit = $this->queryInt('per_page', 20, 1, 100);

        $filters = [
            'limit' => $userLimit,
        ];

        if ($this->query('type')) {
            $filters['type'] = $this->query('type');
        }
        if ($this->query('user_id')) {
            $filters['user_id'] = $this->queryInt('user_id');
        }
        if ($this->query('group_id')) {
            $filters['group_id'] = $this->queryInt('group_id');
        }
        if ($this->query('subtype')) {
            $filters['subtype'] = $this->query('subtype');
        }
        if ($this->query('cursor')) {
            $filters['cursor'] = $this->query('cursor');
        }

        // AG35 — personalised feed. Tenant + user toggles can opt out.
        $personalised = $this->resolvePersonalisedFlag($userId);
        if ($personalised) {
            $filters['mode'] = 'ranked';
        } else {
            $filters['mode'] = 'chronological';
        }

        $result = $this->feedService->getFeed($userId, $filters);

        // AG35 — apply additional personalised re-ranking on top of FeedRankingService.
        if ($personalised && $userId && !empty($result['items'])) {
            $result['items'] = $this->personalisedFeedService->rank($userId, 'feed', $result['items']);
        }

        // Collect post IDs for batch media loading + a polymorphic items list
        // for batch reaction loading (post, listing, event, goal, poll, review,
        // volunteer, challenge, resource — all reactable feed types).
        $postIds = [];
        $reactableItems = [];
        foreach ($result['items'] as $item) {
            $type = $item['type'] ?? '';
            $id = (int) ($item['id'] ?? 0);
            if ($id <= 0) {
                continue;
            }
            if ($type === 'post') {
                $postIds[] = $id;
            }
            if (in_array($type, \App\Services\ReactionService::VALID_TARGET_TYPES, true)) {
                $reactableItems[] = ['type' => $type, 'id' => $id];
            }
        }

        // Batch load media for all posts in the feed
        $mediaByPost = [];
        if (!empty($postIds)) {
            $mediaByPost = $this->postMediaService->getMediaForPosts($postIds);
        }

        // Batch load reactions for ALL reactable items (polymorphic).
        // This restores user_reaction across page refresh for every type, not
        // just posts — see project_recipient_locale_rollout.md and the
        // ReactionPersistenceTest regression suite.
        $reactionsByKey = !empty($reactableItems)
            ? $this->reactionService->getReactionsForItems($reactableItems, $userId)
            : [];

        // Strip internal cursor fields and attach media + reactions
        foreach ($result['items'] as &$item) {
            unset($item['_activity_id'], $item['_activity_created_at']);

            $type = $item['type'] ?? '';
            $id = (int) ($item['id'] ?? 0);

            // Media is post-only
            if ($type === 'post' && $id > 0) {
                $item['media'] = $mediaByPost[$id] ?? [];
            }

            // Reactions for any reactable type
            if ($id > 0 && in_array($type, \App\Services\ReactionService::VALID_TARGET_TYPES, true)) {
                $item['reactions'] = $reactionsByKey[$type . ':' . $id]
                    ?? ['counts' => [], 'total' => 0, 'user_reaction' => null];
            }
        }
        unset($item);

        return $this->respondWithCollection(
            $result['items'],
            $result['cursor'],
            $userLimit,
            $result['has_more']
        );
    }

    /**
     * AG35 — resolve whether the feed should be personalised for this request.
     *
     * Precedence: explicit ?personalised=true|false → user pref → tenant setting (default true).
     * Anonymous requests always fall through to chronological recency.
     */
    private function resolvePersonalisedFlag(?int $userId): bool
    {
        if (!$userId) {
            return false;
        }
        $explicit = $this->query('personalised');
        if ($explicit !== null) {
            return filter_var($explicit, FILTER_VALIDATE_BOOLEAN);
        }
        // Per-user preference
        try {
            $prefersChrono = (bool) DB::table('users')
                ->where('id', $userId)
                ->value('prefers_chronological_feed');
            if ($prefersChrono) {
                return false;
            }
        } catch (\Throwable $e) {
            // ignore
        }
        // Tenant setting (default enabled)
        $tenantEnabled = TenantContext::getSetting('feed.personalisation.enabled', true);
        return (bool) $tenantEnabled;
    }

    // -----------------------------------------------------------------
    //  GET /api/v2/feed/posts/{id}
    // -----------------------------------------------------------------

    /**
     * Fetch a single feed post by its ID (feed_posts.id / feed_activity.source_id).
     * Returns the same shape as a feed item from feedV2.
     */
    /**
     * Get the current user's scheduled posts.
     */
    public function scheduledPosts(): JsonResponse
    {
        $userId = $this->requireAuth();
        $result = $this->feedService->getScheduledPosts($userId);
        return $this->respondWithData($result);
    }

    public function showPost(int $id): JsonResponse
    {
        $userId = $this->getOptionalUserId();

        // 🔴 `full_content`: this is the post's own page. Without it the reader gets the
        // list's 500-character preview and no way to see the rest — measured 2026-08-24,
        // a 1,268-character post came back as 503 characters.
        $result = $this->feedService->getFeed($userId, [
            'post_id' => $id,
            'limit' => 1,
            'full_content' => true,
        ]);

        if (empty($result['items'])) {
            return $this->respondWithError('NOT_FOUND', __('api.post_not_found'), null, 404);
        }

        $item = $result['items'][0];

        $mediaByPost = $this->postMediaService->getMediaForPosts([$id]);
        $item['media'] = $mediaByPost[$id] ?? [];

        // Polymorphic reactions — same pattern as feedV2. The detail page must
        // surface user_reaction so the heart stays filled on refresh.
        $type = (string) ($item['type'] ?? 'post');
        $itemId = (int) ($item['id'] ?? $id);
        if ($itemId > 0 && in_array($type, \App\Services\ReactionService::VALID_TARGET_TYPES, true)) {
            $reactionsByKey = $this->reactionService->getReactionsForItems(
                [['type' => $type, 'id' => $itemId]],
                $userId
            );
            $item['reactions'] = $reactionsByKey[$type . ':' . $itemId]
                ?? ['counts' => [], 'total' => 0, 'user_reaction' => null];
        }

        unset($item['_activity_id'], $item['_activity_created_at']);

        return $this->respondWithData($item);
    }

    /**
     * GET /api/v2/feed/items/{type}/{id}
     *
     * Polymorphic single-feed-item lookup. Returns a feed item of any
     * reactable source_type with the same shape as feedV2 (media, reactions,
     * like state, etc.). Used by the React PostDetailPage so deep-links to
     * listings, events, polls, goals, etc. resolve correctly instead of 404ing
     * when only feed_posts is consulted.
     */
    public function showItem(string $type, int $id): JsonResponse
    {
        $userId = $this->getOptionalUserId();
        // Restrict to canonical reactable types. Excludes notification cards
        // (badge_earned, level_up) and 'comment' (which has its own endpoint).
        $allowed = ['post', 'listing', 'event', 'poll', 'goal', 'review',
                    'volunteer', 'challenge', 'resource', 'blog', 'discussion', 'job'];
        if (!in_array($type, $allowed, true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.social_invalid_target_type'), 'type', 400);
        }

        // Verify the entity exists in the current tenant before hitting the
        // feed query, so non-existent IDs cleanly 404 rather than returning
        // an empty feed result (defence-in-depth — feed_activity also scopes
        // by tenant, but the source table is the source of truth).
        if (!FeedItemTables::canView($type, $id, $userId)) {
            return $this->respondWithError('NOT_FOUND', __('api.target_not_found'), null, 404);
        }

        $result = $this->feedService->getFeed($userId, [
            'entity_id' => $id,
            'entity_type' => $type,
            'limit' => 1,
        ]);

        if (empty($result['items'])) {
            return $this->respondWithError('NOT_FOUND', __('api.post_not_found'), null, 404);
        }

        $item = $result['items'][0];

        // Attach media for posts (feed posts carry multi-image media)
        if ($type === 'post') {
            $mediaByPost = $this->postMediaService->getMediaForPosts([$id]);
            $item['media'] = $mediaByPost[$id] ?? [];
        }

        // Polymorphic reactions — same pattern as feedV2 + showPost
        $itemType = (string) ($item['type'] ?? $type);
        $itemId = (int) ($item['id'] ?? $id);
        if ($itemId > 0 && in_array($itemType, \App\Services\ReactionService::VALID_TARGET_TYPES, true)) {
            $reactionsByKey = $this->reactionService->getReactionsForItems(
                [['type' => $itemType, 'id' => $itemId]],
                $userId
            );
            $item['reactions'] = $reactionsByKey[$itemType . ':' . $itemId]
                ?? ['counts' => [], 'total' => 0, 'user_reaction' => null];
        }

        unset($item['_activity_id'], $item['_activity_created_at']);

        return $this->respondWithData($item);
    }

    /**
     * POST /api/v2/feed/like
     *
     * Toggle like on content. Native Eloquent — no delegation.
     *
     * Request Body: { "target_type": "post|listing|event|...", "target_id": int }
     */
    public function likeV2(): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();
        $this->rateLimit('feed_like', 60, 60);

        $targetType = (string) $this->input('target_type');
        $targetId = $this->inputInt('target_id');

        if (empty($targetType) || ! $targetId) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.social_target_required'), null, 400);
        }

        if (! in_array($targetType, self::VALID_LIKE_TARGETS, true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.social_invalid_target_type'), 'target_type', 400);
        }

        // Normalise legacy alias — feed_activity emits 'volunteer' for opportunities,
        // so the canonical likes target_type is 'volunteer'. Old clients sending
        // 'volunteering' get rewritten to keep DB rows consistent.
        if ($targetType === 'volunteering') {
            $targetType = 'volunteer';
        }

        if (!FeedItemTables::canView($targetType, (int) $targetId, $userId)) {
            return $this->respondWithError('NOT_FOUND', __('api.target_not_found'), null, 404);
        }

        // Check existing like (tenant-scoped)
        $existing = DB::table('likes')
            ->where('user_id', $userId)
            ->where('target_type', $targetType)
            ->where('target_id', $targetId)
            ->where('tenant_id', $tenantId)
            ->first();

        if ($existing) {
            // Unlike
            DB::table('likes')
                ->where('id', $existing->id)
                ->where('tenant_id', $tenantId)
                ->delete();

            if ($targetType === 'post') {
                DB::table('feed_posts')
                    ->where('id', $targetId)
                    ->where('tenant_id', $tenantId)
                    ->update(['likes_count' => DB::raw('GREATEST(likes_count - 1, 0)')]);
            }

            $action = 'unliked';
        } else {
            // Like — use INSERT IGNORE to prevent duplicates from concurrent requests
            // (protected by uk_likes_user_target unique constraint)
            $affected = DB::affectingStatement(
                'INSERT IGNORE INTO likes (user_id, target_type, target_id, tenant_id, created_at) VALUES (?, ?, ?, ?, NOW())',
                [$userId, $targetType, $targetId, $tenantId]
            );

            if ($affected > 0 && $targetType === 'post') {
                $updated = DB::table('feed_posts')
                    ->where('id', $targetId)
                    ->where('tenant_id', $tenantId)
                    ->increment('likes_count');

                if ($updated === 0) {
                    // Post was deleted between our exists-check and increment; clean up the orphaned like
                    DB::table('likes')
                        ->where('user_id', $userId)
                        ->where('target_type', $targetType)
                        ->where('target_id', $targetId)
                        ->where('tenant_id', $tenantId)
                        ->delete();
                }
            }

            $action = 'liked';

            // Send platform + email notification to content owner
            try {
                $contentOwnerId = SocialNotificationService::getContentOwnerId($targetType, $targetId);
                if ($contentOwnerId && $contentOwnerId !== $userId) {
                    $preview = SocialNotificationService::getContentPreview($targetType, $targetId);
                    SocialNotificationService::notifyLike($contentOwnerId, $userId, $targetType, $targetId, $preview);
                }
            } catch (\Throwable $e) {
                Log::warning('SocialController::likeV2 notification failed', ['error' => $e->getMessage()]);
            }
        }

        // Get updated count (tenant-scoped)
        $count = (int) DB::table('likes')
            ->where('target_type', $targetType)
            ->where('target_id', $targetId)
            ->where('tenant_id', $tenantId)
            ->count();

        return $this->respondWithData([
            'action'      => $action,
            'likes_count' => $count,
        ]);
    }

    // ========================================================================
    // Post creation endpoints — native (no delegation)
    // ========================================================================

    /**
     * POST /api/v2/feed/posts — Create a new feed post (V2 format)
     *
     * Accepts multipart/form-data with optional image upload.
     */
    public function createPostV2(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('feed_create', 20, 60);

        $data = $this->getAllInput();

        try {
            FeedService::assertMentionContactsAllowed(
                (string) ($data['content'] ?? $data['body'] ?? ''),
                $userId,
                $this->getTenantId(),
                'feed_post_create',
            );
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        // Handle image upload if present (multipart/form-data)
        $imageUrl = $this->handleImageUpload();
        if ($imageUrl) {
            $data['image_url'] = $imageUrl;
        }

        try {
            $postObj = $this->feedService->createPost($userId, $data);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        if (is_array($postObj) && isset($postObj['error'])) {
            return $this->respondWithError('VALIDATION_ERROR', (string) $postObj['error'], null, 422);
        }

        if ($postObj === null) {
            $errors = $this->feedService->getErrors();
            $status = 422;

            foreach ($errors as $error) {
                if ($error['code'] === 'FORBIDDEN') {
                    $status = 403;
                    break;
                }
            }

            return $this->respondWithErrors($errors, $status);
        }

        $postId = (int) ($postObj->id ?? $postObj);

        // Handle multi-image uploads (media[] or image_0, image_1, etc.)
        $mediaFiles = $this->collectMediaFiles();
        if (!empty($mediaFiles)) {
            $altTexts = request()->input('alt_texts', []);
            $this->postMediaService->attachMedia($postId, $mediaFiles, is_array($altTexts) ? $altTexts : []);
        }

        // Process link previews from post content (async-safe, non-blocking)
        $linkPreviews = [];
        try {
            $content = $data['content'] ?? '';
            if ($content) {
                $linkPreviewService = app(LinkPreviewService::class);
                $linkPreviews = $linkPreviewService->processPostUrls($postId, $content);
            }
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::debug('Link preview processing failed', [
                'post_id' => $postId,
                'error' => $e->getMessage(),
            ]);
        }

        // Get the created post with media
        $post = $this->feedService->getItem('post', $postId, $userId);

        if ($post) {
            $post['media'] = $this->postMediaService->getMediaForPost($postId);
        }

        if (! empty($linkPreviews)) {
            $post['link_previews'] = $linkPreviews;
        }

        return $this->respondWithData($post, null, 201);
    }

    /**
     * POST /api/social/create-post — Create a new feed post (V1 format)
     *
     * Accepts multipart/form-data with optional image upload.
     */
    public function createPost(): JsonResponse
    {
        $this->rateLimit('social_create_post', 20, 60);
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();

        $content = trim($this->input('content', ''));
        $emoji = $this->input('emoji');
        $imageUrl = $this->input('image_url');
        $visibility = $this->input('visibility', 'public');

        // Validate visibility
        $validVisibility = ['public', 'private', 'friends'];
        if (! in_array($visibility, $validVisibility, true)) {
            $visibility = 'public';
        }
        $groupId = $this->inputInt('group_id', 0);

        if (empty($content) && empty($imageUrl)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.social_post_content_required'), null, 400);
        }

        // If posting to a group, verify membership
        if ($groupId > 0) {
            $membership = DB::table('group_members')
                ->where('group_id', $groupId)
                ->where('user_id', $userId)
                ->where('status', 'active')
                ->first();

            if (! $membership) {
                return $this->respondWithError('FORBIDDEN', __('api.social_group_membership_required'), null, 403);
            }
        }

        try {
            // Handle image upload if present (file upload takes precedence over URL)
            $uploadedUrl = $this->handleImageUpload();
            if ($uploadedUrl) {
                $imageUrl = $uploadedUrl;
            }

            // Build insert data
            $insertData = [
                'user_id'     => $userId,
                'tenant_id'   => $tenantId,
                'content'     => $content,
                'emoji'       => $emoji,
                'image_url'   => $imageUrl,
                'likes_count' => 0,
                'visibility'  => $visibility,
                'created_at'  => now(),
            ];

            // Check if group_id column exists (backward compatibility)
            $hasGroupColumn = false;
            try {
                $columns = DB::select("SHOW COLUMNS FROM feed_posts LIKE 'group_id'");
                $hasGroupColumn = ! empty($columns);
            } catch (\Exception $e) {
                // Column doesn't exist
            }

            if ($hasGroupColumn && $groupId > 0) {
                $insertData['group_id'] = $groupId;
            }

            $postId = DB::table('feed_posts')->insertGetId($insertData);

            // Record in feed_activity so post appears in the feed
            try {
                $this->feedActivityService->recordActivity($tenantId, $userId, 'post', (int) $postId, [
                    'content'    => $content,
                    'image_url'  => $imageUrl,
                    'group_id'   => $groupId ?: null,
                    'created_at' => date('Y-m-d H:i:s'),
                ]);
            } catch (\Exception $faEx) {
                \Illuminate\Support\Facades\Log::warning('SocialController::createPost feed_activity failed: ' . $faEx->getMessage());
            }

            // Handle multi-image uploads
            $mediaFiles = $this->collectMediaFiles();
            $media = [];
            if (!empty($mediaFiles)) {
                $altTexts = request()->input('alt_texts', []);
                $media = $this->postMediaService->attachMedia((int) $postId, $mediaFiles, is_array($altTexts) ? $altTexts : []);
            }

            return $this->respondWithData([
                'status'  => 'success',
                'post_id' => $postId,
                'media'   => $media,
            ]);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("Create Post Error: " . $e->getMessage());
            return $this->respondWithError('OPERATION_FAILED', __('api.social_post_create_failed'), null, 500);
        }
    }

    // ========================================================================
    // V2 endpoints — native (no delegation)
    // ========================================================================

    /** PUT /api/v2/feed/posts/{id} — Edit own post content */
    public function updatePostV2(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('feed_edit', 30, 60);

        $data = $this->getAllInput();

        try {
            $result = $this->feedService->updatePost($id, $userId, $data);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        if (!$result['success']) {
            $status = str_contains($result['error'] ?? '', 'not found') ? 404 : 422;
            return $this->respondWithError('UPDATE_FAILED', $result['error'], null, $status);
        }

        // Return the updated post with media
        $post = $this->feedService->getItem('post', $id, $userId);
        if ($post) {
            $post['media'] = $this->postMediaService->getMediaForPost($id);
        }

        return $this->respondWithData($post);
    }

    /** POST /api/v2/feed/posts/{id}/not-interested — Algorithm feedback */
    public function notInterested(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();

        $targetType = $this->input('type', 'post');
        $validTypes = ['post', 'listing', 'event', 'poll', 'goal', 'review', 'job',
                       'challenge', 'volunteer', 'resource', 'blog', 'discussion'];
        if (!in_array($targetType, $validTypes, true)) {
            $targetType = 'post';
        }

        // Verify the target actually exists in this tenant before writing to
        // feed_hidden. Otherwise a malicious client could poison the table
        // with arbitrary IDs to bias EdgeRank against unrelated content.
        if (!FeedItemTables::canView($targetType, $id, $userId)) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.target_not_found'), null, 404);
        }

        // Record as hidden (reuses feed_hidden table — the EdgeRank negative signal
        // treats all hidden items equally for now)
        DB::table('feed_hidden')->insertOrIgnore([
            'user_id'     => $userId,
            'tenant_id'   => $tenantId,
            'target_type' => $targetType,
            'target_id'   => $id,
            'created_at'  => now(),
        ]);

        return $this->respondWithData(['success' => true, 'post_id' => $id]);
    }

    /** POST /api/v2/feed/posts/{id}/hide */
    public function hidePostV2(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();

        // Accept optional type parameter so non-post feed items (listings, events, etc.)
        // can be hidden correctly. Falls back to 'post' for backward compatibility.
        $targetType = $this->input('type', 'post');
        $validTypes = ['post', 'listing', 'event', 'poll', 'goal', 'review', 'job',
                       'challenge', 'volunteer', 'resource', 'blog', 'discussion'];
        if (!in_array($targetType, $validTypes, true)) {
            $targetType = 'post';
        }

        // Tenant-scoped existence check — see notInterested() above.
        if (!FeedItemTables::canView($targetType, $id, $userId)) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.target_not_found'), null, 404);
        }

        DB::table('feed_hidden')->insertOrIgnore([
            'user_id'     => $userId,
            'tenant_id'   => $tenantId,
            'target_type' => $targetType,
            'target_id'   => $id,
            'created_at'  => now(),
        ]);

        return $this->respondWithData(['hidden' => true, 'post_id' => $id]);
    }

    /** POST /api/v2/feed/posts/{id}/delete */
    public function deletePostV2(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();

        $post = DB::table('feed_posts')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->first();

        if (! $post) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.post_not_found'), null, 404);
        }

        if ((int) $post->user_id !== $userId) {
            return $this->respondWithError('FORBIDDEN', __('api.social_post_delete_own_only'), null, 403);
        }

        DB::table('feed_posts')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->delete();

        try {
            $this->feedActivityService->removeActivity('post', $id);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("SocialController::deletePostV2 feed_activity remove failed: " . $e->getMessage());
        }

        return $this->respondWithData(['deleted' => true, 'id' => $id]);
    }

    /**
     * POST /api/v2/feed/posts/{id}/impression — legacy post-only wrapper.
     *
     * Accepts an optional `type` body param so callers that already know the
     * target type can fan out to listings/events/etc. without hitting a
     * different route. Falls back to 'post' for backward-compat.
     */
    public function recordImpression(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $targetType = $this->resolvePolymorphicType($this->input('type', 'post'));
        if ($id <= 0 || !FeedItemTables::canView($targetType, $id, $userId)) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.target_not_found'), null, 404);
        }
        $this->feedRankingService->recordImpression($id, $userId, $targetType);
        return $this->respondWithData(['recorded' => true]);
    }

    /**
     * POST /api/v2/feed/impression — polymorphic impression tracking.
     *
     * Body: { target_type: string, target_id: int }
     * Validates target_type against ReactionService::VALID_TARGET_TYPES so
     * EdgeRank gets a CTR signal across every reactable surface.
     */
    public function recordImpressionV2(): JsonResponse
    {
        $userId = $this->requireAuth();
        $targetType = $this->input('target_type', 'post');
        $targetId = $this->inputInt('target_id');

        if (!in_array($targetType, \App\Services\ReactionService::VALID_TARGET_TYPES, true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.social_invalid_target_type'), 'target_type', 400);
        }
        if ($targetId <= 0) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.social_invalid_target'), 'target_id', 400);
        }

        if (!FeedItemTables::canView($targetType, $targetId, $userId)) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.target_not_found'), null, 404);
        }
        $this->feedRankingService->recordImpression($targetId, $userId, $targetType);
        return $this->respondWithData(['recorded' => true]);
    }

    /**
     * Normalise a free-form `type` body param to a value the ranking service
     * can persist — anything not in ReactionService::VALID_TARGET_TYPES
     * collapses to 'post' to keep the legacy endpoint forgiving.
     */
    private function resolvePolymorphicType(string $type): string
    {
        return in_array($type, \App\Services\ReactionService::VALID_TARGET_TYPES, true) ? $type : 'post';
    }

    /** POST /api/v2/feed/polls */
    public function createPollV2(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('feed_create_poll', 10, 60);

        $data = $this->getAllInput();
        $question = trim($data['question'] ?? '');
        $options = $data['options'] ?? [];

        if (empty($question)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.social_question_required'), 'question', 400);
        }

        if (! is_array($options) || count($options) < 2) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.social_min_2_options'), 'options', 400);
        }

        $pollData = [
            'question'   => $question,
            'options'    => $options,
            'expires_at' => $data['expires_at'] ?? null,
            'visibility' => $data['visibility'] ?? 'public',
        ];

        $createdPoll = $this->pollService->create($userId, $pollData);
        $pollId = (int) $createdPoll->id;
        $poll = $this->pollService->getById($pollId, $userId);

        try {
            DB::table('feed_activity')->insertOrIgnore([
                'tenant_id'   => TenantContext::getId(),
                'user_id'     => $userId,
                'source_type' => 'poll',
                'source_id'   => $pollId,
                'title'       => $question,
                'content'     => $question,
                'metadata'    => null,
                'is_visible'  => true,
                'is_hidden'   => false,
                'created_at'  => now(),
            ]);
        } catch (\Throwable $e) {
            Log::warning('SocialController::createPollV2 feed_activity sync failed', [
                'poll_id' => $pollId,
                'user_id' => $userId,
                'error' => $e->getMessage(),
            ]);
        }

        return $this->respondWithData($poll, null, 201);
    }

    /** GET /api/v2/feed/polls/{id} */
    public function getPollV2($id): JsonResponse
    {
        $userId = $this->getOptionalUserId();
        $this->rateLimit('feed_poll_get', 60, 60);

        $poll = $this->pollService->getById((int) $id, $userId);

        if (! $poll) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.poll_not_found'), null, 404);
        }

        return $this->respondWithData($poll);
    }

    /** POST /api/v2/feed/polls/{id}/vote */
    public function votePollV2($id): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('feed_poll_vote', 30, 60);

        $optionId = $this->inputInt('option_id');

        if (! $optionId) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.social_option_id_required'), 'option_id', 400);
        }

        try {
            $success = $this->pollService->vote((int) $id, $optionId, $userId);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        if (! $success) {
            $errors = $this->pollService->getErrors();
            return $this->respondWithErrors($errors, 400);
        }

        $poll = $this->pollService->getById((int) $id, $userId);
        return $this->respondWithData($poll);
    }

    /** POST /api/v2/feed/posts/{id}/report */
    public function reportPostV2($id): JsonResponse
    {
        return $this->reportItemV2((string) $this->input('target_type', $this->input('type', 'post')), (int) $id);
    }

    public function reportItemV2(string $type, int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();
        $this->rateLimit("feed_report:{$tenantId}:{$userId}", 30, 60);
        $targetType = $type === 'volunteering' ? 'volunteer' : $type;
        $reason = trim($this->input('reason', ''));

        if (!in_array($targetType, \App\Services\ReactionService::VALID_TARGET_TYPES, true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.social_invalid_target_type'), 'target_type', 400);
        }

        if ($id <= 0 || !FeedItemTables::canView($targetType, $id, $userId)) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.target_not_found'), null, 404);
        }

        if ($reason === '') {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.reason_required'), 'reason', 400);
        }

        if (mb_strlen($reason) > 1000) {
            $reason = mb_substr($reason, 0, 1000);
        }

        $alreadyReported = DB::table('reports')
            ->where('reporter_id', $userId)
            ->where('tenant_id', $tenantId)
            ->where('target_type', $targetType)
            ->where('target_id', $id)
            ->exists();

        if ($alreadyReported) {
            return $this->respondWithError('DUPLICATE', __('api.already_reported'), null, 409);
        }

        $reportId = DB::table('reports')->insertGetId([
            'reporter_id' => $userId,
            'tenant_id'   => $tenantId,
            'target_type' => $targetType,
            'target_id'   => $id,
            'reason'      => $reason,
            'status'      => 'open',
            'created_at'  => now(),
        ]);

        // Alert moderators a new report awaits review (previously a silent queue).
        try {
            \App\Services\NotificationDispatcher::notifyModerationAdmins(
                'social_report_created',
                '/admin/reports',
                'svc_notifications_2.social_report.admin_alert',
                'emails_misc.moderation.social_subject',
                'emails_misc.moderation.social_body',
                ['target_type' => $targetType, 'reason' => $reason, 'report_id' => $reportId]
            );
        } catch (\Throwable $notifyError) {
            \Illuminate\Support\Facades\Log::warning('Social report admin alert failed: ' . $notifyError->getMessage());
        }

        return $this->respondWithData(['reported' => true, 'target_type' => $targetType, 'target_id' => $id]);
    }

    /** POST /api/v2/feed/users/{id}/mute */
    public function muteUserV2($id): JsonResponse
    {
        $currentUserId = $this->requireAuth();
        $tenantId = $this->getTenantId();
        $mutedUserId = (int) $id;

        if ($mutedUserId <= 0 || $mutedUserId === $currentUserId) {
            return $this->respondWithError('INVALID_INPUT', __('api.invalid_user'), null, 422);
        }

        $targetExists = DB::table('users')
            ->where('id', $mutedUserId)
            ->where('tenant_id', $tenantId)
            ->exists();

        if (!$targetExists) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.user_not_found'), null, 404);
        }

        DB::table('feed_muted_users')->insertOrIgnore([
            'user_id'       => $currentUserId,
            'tenant_id'     => $tenantId,
            'muted_user_id' => $mutedUserId,
            'created_at'    => now(),
        ]);

        return $this->respondWithData(['muted' => true, 'user_id' => $mutedUserId]);
    }

    /**
     * POST /api/v2/feed/posts/{id}/click — legacy post-only wrapper.
     * Accepts an optional `type` body param; see recordImpression() above.
     */
    public function recordClick($id): JsonResponse
    {
        $userId = $this->requireAuth();
        $targetType = $this->resolvePolymorphicType($this->input('type', 'post'));
        $targetId = (int) $id;
        if ($targetId <= 0 || !FeedItemTables::canView($targetType, $targetId, $userId)) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.target_not_found'), null, 404);
        }
        $this->feedRankingService->recordClick($targetId, $userId, $targetType);
        return $this->respondWithData(['recorded' => true]);
    }

    /**
     * POST /api/v2/feed/click — polymorphic click tracking.
     *
     * Body: { target_type: string, target_id: int }
     */
    public function recordClickV2(): JsonResponse
    {
        $userId = $this->requireAuth();
        $targetType = $this->input('target_type', 'post');
        $targetId = $this->inputInt('target_id');

        if (!in_array($targetType, \App\Services\ReactionService::VALID_TARGET_TYPES, true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.social_invalid_target_type'), 'target_type', 400);
        }
        if ($targetId <= 0) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.social_invalid_target'), 'target_id', 400);
        }

        if (!FeedItemTables::canView($targetType, $targetId, $userId)) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.target_not_found'), null, 404);
        }
        $this->feedRankingService->recordClick($targetId, $userId, $targetType);
        return $this->respondWithData(['recorded' => true]);
    }

    /** GET /api/social/test — admin debug endpoint */
    public function test(): JsonResponse
    {
        $this->requireAdmin();

        $debug = [
            'api_working'        => true,
            'request_method'     => request()->method(),
            'likes_table_exists' => false,
        ];

        try {
            DB::table('likes')->count();
            $debug['likes_table_exists'] = true;
        } catch (\Exception) {
            $debug['likes_error'] = 'Database error';
        }

        return $this->respondWithData($debug);
    }

    // ========================================================================
    // Legacy V1 social endpoints — native (no delegation)
    // ========================================================================

    /** POST /api/social/like */
    public function like(): JsonResponse
    {
        $this->rateLimit('social_like', 60, 60);
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();

        $targetType = $this->input('target_type', '');
        $targetId = $this->inputInt('target_id');

        if (empty($targetType) || ! $targetId || $targetId <= 0) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.social_invalid_target'), null, 400);
        }

        if (! in_array($targetType, self::VALID_LIKE_TARGETS, true)) {
            return $this->respondWithError('INVALID_INPUT', __('api.social_invalid_target_type'), 'target_type', 400);
        }

        try {
            $existing = DB::table('likes')
                ->where('user_id', $userId)
                ->where('target_type', $targetType)
                ->where('target_id', $targetId)
                ->where('tenant_id', $tenantId)
                ->first();

            if ($existing) {
                DB::table('likes')->where('id', $existing->id)->where('tenant_id', $tenantId)->delete();

                if ($targetType === 'post') {
                    DB::table('feed_posts')
                        ->where('id', $targetId)
                        ->where('tenant_id', $tenantId)
                        ->update(['likes_count' => DB::raw('GREATEST(likes_count - 1, 0)')]);
                }

                $action = 'unliked';
            } else {
                // Use INSERT IGNORE to prevent duplicates from concurrent requests
                // (protected by uk_likes_user_target unique constraint)
                DB::affectingStatement(
                    'INSERT IGNORE INTO likes (user_id, target_type, target_id, tenant_id, created_at) VALUES (?, ?, ?, ?, NOW())',
                    [$userId, $targetType, $targetId, $tenantId]
                );

                if ($targetType === 'post') {
                    DB::table('feed_posts')
                        ->where('id', $targetId)
                        ->where('tenant_id', $tenantId)
                        ->increment('likes_count');
                }

                $action = 'liked';

                // Send notification to content owner
                try {
                    $contentOwnerId = $this->socialNotificationService->getContentOwnerId($targetType, $targetId);
                    if ($contentOwnerId && $contentOwnerId != $userId) {
                        $this->socialNotificationService->notifyLike($contentOwnerId, $userId, $targetType, $targetId, '');
                    }
                } catch (\Throwable $e) {
                    \Illuminate\Support\Facades\Log::warning("notifyLike error (non-critical): " . $e->getMessage());
                }
            }

            $count = (int) DB::table('likes')
                ->where('target_type', $targetType)
                ->where('target_id', $targetId)
                ->where('tenant_id', $tenantId)
                ->count();

            return $this->respondWithData([
                'status'      => $action,
                'likes_count' => $count,
            ]);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("Social Like Error: " . $e->getMessage());
            return $this->respondWithError('OPERATION_FAILED', __('api.social_like_failed'), null, 500);
        }
    }

    /** POST /api/social/likers */
    public function likers(): JsonResponse
    {
        $targetType = $this->input('target_type', '');
        $targetId = $this->inputInt('target_id');
        $page = max(1, $this->inputInt('page', 1));
        $limit = min(50, max(5, $this->inputInt('limit', 20)));
        $offset = ($page - 1) * $limit;
        $tenantId = $this->getTenantId();

        if (empty($targetType) || ! $targetId || $targetId <= 0) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.social_invalid_target'), null, 400);
        }

        try {
            $likers = DB::select(
                "SELECT u.id, COALESCE(u.name, CONCAT(u.first_name, ' ', u.last_name)) as name,
                        u.avatar_url, l.created_at as liked_at
                 FROM likes l JOIN users u ON l.user_id = u.id
                 WHERE l.target_type = ? AND l.target_id = ? AND l.tenant_id = ?
                 ORDER BY l.created_at DESC LIMIT ? OFFSET ?",
                [$targetType, $targetId, $tenantId, $limit, $offset]
            );

            $likers = array_map(function ($l) {
                $l = (array) $l;
                if (empty($l['avatar_url'])) {
                    $l['avatar_url'] = '/assets/img/defaults/default_avatar.png';
                }
                $l['liked_at_formatted'] = date('M j, Y', strtotime($l['liked_at']));
                return $l;
            }, $likers);

            $totalCount = (int) DB::table('likes')
                ->where('target_type', $targetType)
                ->where('target_id', $targetId)
                ->where('tenant_id', $tenantId)
                ->count();

            return $this->respondWithData([
                'likers'      => $likers,
                'total_count' => $totalCount,
                'page'        => $page,
                'has_more'    => ($offset + count($likers)) < $totalCount,
            ]);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("Get Likers Error: " . $e->getMessage());
            return $this->respondWithError('OPERATION_FAILED', __('api.social_likers_failed'), null, 500);
        }
    }

    /** POST /api/social/comments */
    public function comments(): JsonResponse
    {
        $this->rateLimit('social_comments', 60, 60);
        $action = $this->input('action', '');
        $targetType = $this->input('target_type', '');
        $targetId = $this->inputInt('target_id');

        if (empty($targetType) || ! $targetId || $targetId <= 0) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.social_invalid_target'), null, 400);
        }

        switch ($action) {
            case 'fetch':
            case 'fetch_comments':
                return $this->fetchComments($targetType, $targetId);
            case 'submit':
            case 'submit_comment':
                return $this->submitComment($targetType, $targetId);
            default:
                return $this->respondWithError('INVALID_INPUT', __('api.social_invalid_action'), 'action', 400);
        }
    }

    private function fetchComments(string $targetType, int $targetId): JsonResponse
    {
        try {
            $userId = $this->getOptionalUserId() ?? 0;
            $comments = $this->commentService->fetchComments($targetType, $targetId, $userId);
            return $this->respondWithData([
                'comments'            => $comments,
                'available_reactions' => $this->commentService->getAvailableReactions(),
            ]);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("Fetch Comments Error: " . $e->getMessage());
            return $this->respondWithError('OPERATION_FAILED', __('api.social_comments_failed'), null, 500);
        }
    }

    private function submitComment(string $targetType, int $targetId): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();
        $this->rateLimit('feed_comment:' . $tenantId, 30, 60);
        $content = trim($this->input('content', ''));

        if (empty($content)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.social_comment_empty'), 'content', 400);
        }

        try {
            $result = $this->commentService->addComment($userId, $tenantId, $targetType, $targetId, $content);

            if (($result['status'] ?? '') === 'success') {
                $this->notifyComment($userId, $targetType, $targetId, $content);
            }

            return $this->respondWithData($result);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("Submit Comment Error: " . $e->getMessage());
            return $this->respondWithError('OPERATION_FAILED', __('api.social_comment_post_failed'), null, 500);
        }
    }

    private function notifyComment(int $userId, string $targetType, int $targetId, string $content): void
    {
        try {
            $contentOwnerId = $this->socialNotificationService->getContentOwnerId($targetType, $targetId);
            if ($contentOwnerId && $contentOwnerId != $userId) {
                $this->socialNotificationService->notifyComment($contentOwnerId, $userId, $targetType, $targetId, $content);
            }
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning("notifyComment error (non-critical): " . $e->getMessage());
        }
    }

    /** POST /api/social/share */
    public function share(): JsonResponse
    {
        $this->rateLimit('social_share', 20, 60);
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();

        $parentType = $this->input('parent_type', '');
        $parentId = $this->inputInt('parent_id');

        if (empty($parentType) || ! $parentId || $parentId <= 0) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.social_share_content_required'), null, 400);
        }

        $content = trim($this->input('content', ''));

        try {
            if (class_exists(FeedPost::class)) {
                // tenant_id is auto-set by HasTenantScope; timestamps + likes_count default.
                FeedPost::create([
                    'user_id'     => $userId,
                    'content'     => $content,
                    'parent_id'   => $parentId,
                    'parent_type' => $parentType,
                    'visibility'  => 'public',
                ]);
            } else {
                DB::table('feed_posts')->insert([
                    'user_id'     => $userId,
                    'tenant_id'   => $tenantId,
                    'content'     => $content,
                    'likes_count' => 0,
                    'visibility'  => 'public',
                    'created_at'  => now(),
                    'parent_id'   => $parentId,
                    'parent_type' => $parentType,
                ]);
            }

            try {
                $contentOwnerId = $this->socialNotificationService->getContentOwnerId($parentType, $parentId);
                if ($contentOwnerId && $contentOwnerId != $userId) {
                    $this->socialNotificationService->notifyShare($contentOwnerId, $userId, $parentType, $parentId);
                }
            } catch (\Throwable $e) {
                // Non-critical
            }

            return $this->respondWithData(['message' => __('api.shared_successfully')]);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("Share Error: " . $e->getMessage());
            return $this->respondWithError('OPERATION_FAILED', __('api.social_share_failed'), null, 500);
        }
    }

    /** POST /api/social/delete */
    public function delete(): JsonResponse
    {
        $this->rateLimit('social_delete', 20, 60);
        $userId = $this->requireAuth();
        $targetType = $this->input('target_type', '');
        $targetId = $this->inputInt('target_id');
        $tenantId = $this->getTenantId();

        if (empty($targetType) || ! $targetId || $targetId <= 0) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.social_invalid_target'), null, 400);
        }

        try {
            // Canonical types match feed_activity.source_type and the post-
            // normalisation form in VALID_LIKE_TARGETS. 'volunteering' is
            // accepted as a legacy alias and rewritten before lookup.
            if ($targetType === 'volunteering') {
                $targetType = 'volunteer';
            }
            $tableMap = [
                'post'      => ['table' => 'feed_posts', 'owner_col' => 'user_id'],
                'listing'   => ['table' => 'listings', 'owner_col' => 'user_id'],
                'event'     => ['table' => 'events', 'owner_col' => 'user_id'],
                'poll'      => ['table' => 'polls', 'owner_col' => 'user_id'],
                'goal'      => ['table' => 'goals', 'owner_col' => 'user_id'],
                'volunteer' => ['table' => 'vol_opportunities', 'owner_col' => 'created_by'],
                'challenge' => ['table' => 'ideation_challenges', 'owner_col' => 'user_id'],
                'review'    => ['table' => 'reviews', 'owner_col' => 'reviewer_id'],
            ];

            if (! isset($tableMap[$targetType])) {
                return $this->respondWithError('INVALID_INPUT', __('api.social_unsupported_delete_type'), 'target_type', 400);
            }

            $config = $tableMap[$targetType];
            $record = DB::table($config['table'])
                ->where('id', $targetId)
                ->where('tenant_id', $tenantId)
                ->first();

            if (! $record) {
                return $this->respondWithError('NOT_FOUND', __('api.social_content_not_found', ['type' => ucfirst($targetType)]), null, 404);
            }

            $ownerId = $record->{$config['owner_col']};
            $isAdmin = $this->isUserAdmin();

            if ($ownerId != $userId && ! $isAdmin) {
                return $this->respondWithError('FORBIDDEN', __('api.social_delete_unauthorized'), null, 403);
            }

            // Delete associated likes and comments
            DB::table('likes')->where('target_type', $targetType)->where('target_id', $targetId)->where('tenant_id', $tenantId)->delete();
            DB::table('comments')->where('target_type', $targetType)->where('target_id', $targetId)->where('tenant_id', $tenantId)->delete();

            if ($targetType === 'listing') {
                DB::table($config['table'])->where('id', $targetId)->where('tenant_id', $tenantId)->update(['status' => 'deleted']);
            } elseif ($targetType === 'poll') {
                DB::table('poll_votes')->where('poll_id', $targetId)->whereIn('poll_id', function ($q) use ($tenantId) {
                    $q->select('id')->from('polls')->where('tenant_id', $tenantId);
                })->delete();
                DB::table('poll_options')->where('poll_id', $targetId)->whereIn('poll_id', function ($q) use ($tenantId) {
                    $q->select('id')->from('polls')->where('tenant_id', $tenantId);
                })->delete();
                DB::table($config['table'])->where('id', $targetId)->where('tenant_id', $tenantId)->delete();
            } elseif ($targetType === 'volunteer') {
                // Volunteer opportunities are SOFT-deleted (is_active = 0), never
                // hard-deleted. The previous branch tested 'volunteering' — a value
                // that can never occur (the table map key is 'volunteer'), so this
                // fell through to the generic hard DELETE below, which orphaned
                // vol_applications (no FK on opportunity_id) plus donations, alerts
                // and guardian consents, and destroyed the hour-log audit trail.
                // The owner/admin check above already authorised the caller; the
                // canonical VolunteerService::deleteOpportunity endpoint additionally
                // notifies volunteers and issues a federation retraction.
                DB::table($config['table'])->where('id', $targetId)->where('tenant_id', $tenantId)->update(['is_active' => 0]);
            } else {
                DB::table($config['table'])->where('id', $targetId)->where('tenant_id', $tenantId)->delete();
            }

            if ($targetType === 'post') {
                try {
                    $this->feedActivityService->removeActivity('post', $targetId);
                } catch (\Exception $e) {
                    \Illuminate\Support\Facades\Log::warning("SocialController::delete feed_activity remove failed: " . $e->getMessage());
                }
            }

            return $this->respondWithData(['status' => 'deleted']);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("Delete Post Error: " . $e->getMessage());
            return $this->respondWithError('OPERATION_FAILED', __('api.social_delete_failed'), null, 500);
        }
    }

    /** POST /api/social/reaction */
    public function reaction(): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();

        $commentId = $this->inputInt('comment_id');
        $targetType = $this->input('target_type', 'comment');
        $targetId = $this->inputInt('target_id');
        $emoji = $this->input('emoji', '');

        if ($targetId && $targetId > 0) {
            $commentId = $targetId;
        }

        if (! $commentId || $commentId <= 0 || empty($emoji)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.social_invalid_reaction'), null, 400);
        }

        // Standardise on ReactionService::VALID_TYPES (named types) — comment reactions
        // share the same `reactions` table as polymorphic post reactions, so the type
        // alphabet must match (love, like, laugh, wow, sad, celebrate, clap, time_credit).
        if (!in_array($emoji, \App\Services\ReactionService::VALID_TYPES, true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_reaction'), null, 422);
        }

        try {
            $result = $this->commentService->toggleReaction($userId, $tenantId, $commentId, $emoji);
            return $this->respondWithData($result);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("Reaction Error: " . $e->getMessage());
            return $this->respondWithError('OPERATION_FAILED', __('api.social_reaction_failed'), null, 500);
        }
    }

    /** POST /api/social/reply */
    public function reply(): JsonResponse
    {
        $this->rateLimit('social_reply', 30, 60);
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();

        $parentId = $this->inputInt('parent_id');
        $targetType = $this->input('target_type', '');
        $targetId = $this->inputInt('target_id');
        $content = trim($this->input('content', ''));

        if (! $parentId || $parentId <= 0 || empty($content)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.social_invalid_reply'), null, 400);
        }

        try {
            $result = $this->commentService->addComment($userId, $tenantId, $targetType, $targetId, $content, $parentId);

            if (($result['status'] ?? '') === 'success') {
                $this->notifyComment($userId, $targetType, $targetId, $content);
            }

            return $this->respondWithData($result);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("Reply Comment Error: " . $e->getMessage());
            return $this->respondWithError('OPERATION_FAILED', __('api.social_reply_failed'), null, 500);
        }
    }

    /** POST /api/social/edit-comment */
    public function editComment(): JsonResponse
    {
        $this->rateLimit('social_edit_comment', 30, 60);
        $userId = $this->requireAuth();
        $commentId = $this->inputInt('comment_id');
        $content = trim($this->input('content', ''));
        $tenantId = $this->getTenantId();

        if (! $commentId || $commentId <= 0 || empty($content)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.social_invalid_edit'), null, 400);
        }

        try {
            $result = $this->commentService->editComment($commentId, $userId, $content);
            return $this->respondWithData($result);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("Edit Comment Error: " . $e->getMessage());
            return $this->respondWithError('OPERATION_FAILED', __('api.social_edit_failed'), null, 500);
        }
    }

    /** POST /api/social/delete-comment */
    public function deleteComment(): JsonResponse
    {
        $this->rateLimit('social_delete_comment', 20, 60);
        $userId = $this->requireAuth();
        $commentId = $this->inputInt('comment_id');
        $tenantId = $this->getTenantId();

        if (! $commentId || $commentId <= 0) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.social_invalid_comment_id'), 'comment_id', 400);
        }

        try {
            $result = $this->commentService->deleteComment($commentId, $userId, $this->isUserAdmin());
            return $this->respondWithData($result);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("Delete Comment Error: " . $e->getMessage());
            return $this->respondWithError('OPERATION_FAILED', __('api.social_comment_delete_failed'), null, 500);
        }
    }

    /** POST /api/social/mention-search */
    public function mentionSearch(): JsonResponse
    {
        $this->rateLimit('social_mention_search', 30, 60);
        $this->requireAuth();
        $tenantId = $this->getTenantId();

        $query = trim($this->input('query', ''));

        if (strlen($query) < 1) {
            return $this->respondWithData(['users' => []]);
        }

        try {
            $users = $this->commentService->searchUsersForMention($query, $tenantId, 10);

            return $this->respondWithData(['users' => $users]);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("Mention Search Error: " . $e->getMessage());
            return $this->respondWithError('OPERATION_FAILED', __('api.social_search_failed'), null, 500);
        }
    }

    /**
     * POST /api/social/feed — Aggregated feed with posts, listings, events, polls, goals.
     *
     * Supports filtering by type, user_id, group_id. Offset/page pagination.
     */
    public function feed(): JsonResponse
    {
        $this->rateLimit('social_feed', 60, 60);
        $currentUserId = $this->getOptionalUserId();
        $tenantId = $this->getTenantId();

        $page = max(1, $this->inputInt('page', 1));
        $limit = min(50, max(5, $this->inputInt('limit', 20)));
        $filter = $this->input('filter', 'all');
        $profileUserId = $this->inputInt('user_id', 0);
        $groupId = $this->inputInt('group_id', 0);

        // Support offset-based pagination as well as page-based
        $offset = $this->inputInt('offset', 0);
        if ($offset === 0) {
            $offset = ($page - 1) * $limit;
        }

        try {
            $items = [];

            if ($groupId > 0) {
                $items = $this->loadGroupFeed($groupId, $currentUserId, $tenantId, $limit, $offset);
            } elseif ($profileUserId > 0) {
                $items = $this->loadUserPosts($profileUserId, $currentUserId, $tenantId, $limit, $offset);
            } else {
                $items = $this->loadAggregatedFeed($currentUserId, $tenantId, $filter, $limit, $offset);
            }

            return $this->respondWithData([
                'items'    => $items,
                'page'     => $page,
                'has_more' => count($items) >= $limit,
            ]);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("Feed Load Error: " . $e->getMessage());
            return $this->respondWithError('OPERATION_FAILED', __('api.social_feed_failed'), null, 500);
        }
    }

    // ========================================================================
    // Private helpers
    // ========================================================================

    /**
     * Check if current user is an admin
     */
    private function isUserAdmin(): bool
    {
        try {
            $userId = $this->getOptionalUserId();
            if (! $userId) {
                return false;
            }
            $user = DB::table('users')->where('id', $userId)->where('tenant_id', \App\Core\TenantContext::getId())->first(['role', 'is_super_admin', 'is_tenant_super_admin']);
            if (! $user) {
                return false;
            }
            return in_array($user->role, ['admin', 'super_admin', 'tenant_admin', 'god'])
                || ($user->is_super_admin ?? false)
                || ($user->is_tenant_super_admin ?? false);
        } catch (\Throwable) {
            return false;
        }
    }

    /**
     * Handle image upload from the request.
     *
     * Validates MIME type, file size, and extension. Returns the public URL
     * path on success, or null if no file or validation fails.
     */
    private function handleImageUpload(): ?string
    {
        $request = request();

        if (! $request->hasFile('image') || ! $request->file('image')->isValid()) {
            return null;
        }

        $file = $request->file('image');

        // Enforce server-side file size limit (5MB)
        $maxSize = 5 * 1024 * 1024;
        if ($file->getSize() > $maxSize) {
            return null;
        }

        // Validate actual MIME type
        $allowedTypes = [
            'image/jpeg' => ['jpg', 'jpeg'],
            'image/png'  => ['png'],
            'image/gif'  => ['gif'],
            'image/webp' => ['webp'],
        ];

        $actualMime = $file->getMimeType();
        if (! isset($allowedTypes[$actualMime])) {
            return null;
        }

        // Validate extension matches MIME type
        $ext = strtolower($file->getClientOriginalExtension());
        if (! in_array($ext, $allowedTypes[$actualMime], true)) {
            $ext = $allowedTypes[$actualMime][0];
        }

        // Verify it's a valid image
        $imageInfo = @getimagesize($file->getPathname());
        if ($imageInfo === false) {
            return null;
        }

        $uploadDir = base_path('httpdocs/uploads/posts');
        if (! is_dir($uploadDir)) {
            mkdir($uploadDir, 0755, true);
        }

        // Use cryptographically secure random filename
        $filename = 'post_' . bin2hex(random_bytes(16)) . '.' . $ext;

        $file->move($uploadDir, $filename);

        return '/uploads/posts/' . $filename;
    }

    /**
     * Collect additional media files from the request.
     *
     * @return \Illuminate\Http\UploadedFile[]
     */
    private function collectMediaFiles(): array
    {
        $request = request();
        $files = [];

        if ($request->hasFile('media')) {
            $mediaFiles = $request->file('media');
            if (is_array($mediaFiles)) {
                $files = array_merge($files, $mediaFiles);
            } else {
                $files[] = $mediaFiles;
            }
        }

        for ($i = 1; $i < 10; $i++) {
            $key = "image_{$i}";
            if ($request->hasFile($key)) {
                $files[] = $request->file($key);
            }
        }

        return $files;
    }

    /**
     * Load feed posts for a specific group.
     */
    private function loadGroupFeed(int $groupId, ?int $currentUserId, int $tenantId, int $limit, int $offset): array
    {
        // Check if group_id column exists
        try {
            $columns = DB::select("SHOW COLUMNS FROM feed_posts LIKE 'group_id'");
            if (empty($columns)) {
                return [];
            }
        } catch (\Exception $e) {
            return [];
        }

        $currentUserId = (int) $currentUserId;
        $isLikedSub = $currentUserId
            ? "(SELECT COUNT(*) FROM likes lk WHERE lk.user_id = {$currentUserId} AND lk.target_type = 'post' AND lk.target_id = p.id AND lk.tenant_id = {$tenantId})"
            : '0';

        $rows = DB::select(
            "SELECT p.id, p.content, p.image_url, p.created_at, p.likes_count, p.user_id,
                    'post' as type,
                    COALESCE(u.name, CONCAT(u.first_name, ' ', u.last_name)) as author_name,
                    u.avatar_url as author_avatar,
                    p.user_id as author_id,
                    (SELECT COUNT(*) FROM comments cm WHERE cm.target_type = 'post' AND cm.target_id = p.id AND cm.tenant_id = ?) as comments_count,
                    {$isLikedSub} as is_liked
             FROM feed_posts p
             JOIN users u ON p.user_id = u.id
             WHERE p.group_id = ? AND p.tenant_id = ?
             ORDER BY p.created_at DESC
             LIMIT ? OFFSET ?",
            [$tenantId, $groupId, $tenantId, $limit, $offset]
        );

        return array_map(fn ($r) => (array) $r, $rows);
    }

    /**
     * Load feed posts for a specific user's profile.
     */
    private function loadUserPosts(int $userId, ?int $currentUserId, int $tenantId, int $limit, int $offset): array
    {
        $currentUserId = (int) $currentUserId;
        $isLikedSub = $currentUserId
            ? "(SELECT COUNT(*) FROM likes lk WHERE lk.user_id = {$currentUserId} AND lk.target_type = 'post' AND lk.target_id = p.id AND lk.tenant_id = {$tenantId})"
            : '0';

        $rows = DB::select(
            "SELECT p.id, p.content, p.image_url, p.created_at, p.likes_count,
                    'post' as type,
                    COALESCE(u.name, CONCAT(u.first_name, ' ', u.last_name)) as author_name,
                    u.avatar_url as author_avatar,
                    p.user_id as author_id,
                    (SELECT COUNT(*) FROM comments cm WHERE cm.target_type = 'post' AND cm.target_id = p.id AND cm.tenant_id = ?) as comments_count,
                    {$isLikedSub} as is_liked
             FROM feed_posts p
             JOIN users u ON p.user_id = u.id
             WHERE p.user_id = ? AND p.tenant_id = ? AND p.visibility = 'public'
             ORDER BY p.created_at DESC
             LIMIT ? OFFSET ?",
            [$tenantId, $userId, $tenantId, $limit, $offset]
        );

        return array_map(fn ($r) => (array) $r, $rows);
    }

    /**
     * Load aggregated feed combining posts, listings, events, polls, and goals.
     *
     * Fetches content from multiple tables, merges, sorts by created_at,
     * and returns a paginated slice.
     */
    private function loadAggregatedFeed(?int $currentUserId, int $tenantId, string $filter, int $limit, int $offset): array
    {
        $currentUserId = (int) $currentUserId;
        $items = [];

        // Posts
        if ($filter === 'all' || $filter === 'posts') {
            $isLiked = $currentUserId
                ? "(SELECT COUNT(*) FROM likes WHERE user_id = {$currentUserId} AND target_type = 'post' AND target_id = p.id AND tenant_id = {$tenantId})"
                : '0';
            $commentsSub = "(SELECT COUNT(*) FROM comments cm WHERE cm.target_type = 'post' AND cm.target_id = p.id AND cm.tenant_id = {$tenantId})";
            $postLimit = ($filter === 'posts') ? $limit : 30;

            $rows = DB::select(
                "SELECT p.id, p.content, p.image_url, p.created_at, p.likes_count,
                        'post' as type,
                        COALESCE(u.name, CONCAT(u.first_name, ' ', u.last_name)) as author_name,
                        u.avatar_url as author_avatar,
                        p.user_id as author_id,
                        {$commentsSub} as comments_count,
                        {$isLiked} as is_liked
                 FROM feed_posts p
                 JOIN users u ON p.user_id = u.id
                 WHERE p.tenant_id = ? AND p.visibility = 'public'
                 ORDER BY p.created_at DESC
                 LIMIT {$postLimit}",
                [$tenantId]
            );
            $items = array_merge($items, array_map(fn ($r) => (array) $r, $rows));
        }

        // Listings
        if ($filter === 'all' || $filter === 'listings') {
            $isLiked = $currentUserId
                ? "(SELECT COUNT(*) FROM likes WHERE user_id = {$currentUserId} AND target_type = 'listing' AND target_id = l.id AND tenant_id = {$tenantId})"
                : '0';
            $likesSub = "(SELECT COUNT(*) FROM likes lk WHERE lk.target_type = 'listing' AND lk.target_id = l.id AND lk.tenant_id = {$tenantId})";
            $commentsSub = "(SELECT COUNT(*) FROM comments cm WHERE cm.target_type = 'listing' AND cm.target_id = l.id AND cm.tenant_id = {$tenantId})";
            $listingLimit = ($filter === 'listings') ? $limit : 15;

            $rows = DB::select(
                "SELECT l.id, l.title, l.description as content, l.image_url, l.created_at,
                        'listing' as type,
                        COALESCE(u.name, CONCAT(u.first_name, ' ', u.last_name)) as author_name,
                        u.avatar_url as author_avatar,
                        l.user_id as author_id,
                        {$likesSub} as likes_count,
                        {$commentsSub} as comments_count,
                        {$isLiked} as is_liked
                 FROM listings l
                 JOIN users u ON l.user_id = u.id
                 WHERE l.tenant_id = ? AND l.status = 'active'
                 ORDER BY l.created_at DESC
                 LIMIT {$listingLimit}",
                [$tenantId]
            );
            $items = array_merge($items, array_map(fn ($r) => (array) $r, $rows));
        }

        // Events
        if ($filter === 'all' || $filter === 'events') {
            $isLiked = $currentUserId
                ? "(SELECT COUNT(*) FROM likes WHERE user_id = {$currentUserId} AND target_type = 'event' AND target_id = e.id AND tenant_id = {$tenantId})"
                : '0';
            $likesSub = "(SELECT COUNT(*) FROM likes lk WHERE lk.target_type = 'event' AND lk.target_id = e.id AND lk.tenant_id = {$tenantId})";
            $commentsSub = "(SELECT COUNT(*) FROM comments cm WHERE cm.target_type = 'event' AND cm.target_id = e.id AND cm.tenant_id = {$tenantId})";
            $eventLimit = ($filter === 'events') ? $limit : 10;

            $rows = DB::select(
                "SELECT e.id, e.title, e.description as content, e.cover_image as image_url, e.created_at, e.start_time as start_date,
                        'event' as type,
                        COALESCE(u.name, CONCAT(u.first_name, ' ', u.last_name)) as author_name,
                        u.avatar_url as author_avatar,
                        e.user_id as author_id,
                        {$likesSub} as likes_count,
                        {$commentsSub} as comments_count,
                        {$isLiked} as is_liked
                 FROM events e
                 JOIN users u ON e.user_id = u.id
                 WHERE e.tenant_id = ?
                 ORDER BY e.created_at DESC
                 LIMIT {$eventLimit}",
                [$tenantId]
            );
            $items = array_merge($items, array_map(fn ($r) => (array) $r, $rows));
        }

        // Polls
        if ($filter === 'all' || $filter === 'polls') {
            $isLiked = $currentUserId
                ? "(SELECT COUNT(*) FROM likes WHERE user_id = {$currentUserId} AND target_type = 'poll' AND target_id = po.id AND tenant_id = {$tenantId})"
                : '0';
            $likesSub = "(SELECT COUNT(*) FROM likes lk WHERE lk.target_type = 'poll' AND lk.target_id = po.id AND lk.tenant_id = {$tenantId})";
            $commentsSub = "(SELECT COUNT(*) FROM comments cm WHERE cm.target_type = 'poll' AND cm.target_id = po.id AND cm.tenant_id = {$tenantId})";
            $pollLimit = ($filter === 'polls') ? $limit : 10;

            $rows = DB::select(
                "SELECT po.id, po.question as title, po.question as content, po.created_at,
                        'poll' as type,
                        COALESCE(u.name, CONCAT(u.first_name, ' ', u.last_name)) as author_name,
                        u.avatar_url as author_avatar,
                        po.user_id as author_id,
                        {$likesSub} as likes_count,
                        {$commentsSub} as comments_count,
                        {$isLiked} as is_liked
                 FROM polls po
                 JOIN users u ON po.user_id = u.id
                 WHERE po.tenant_id = ? AND po.is_active = 1
                 ORDER BY po.created_at DESC
                 LIMIT {$pollLimit}",
                [$tenantId]
            );
            $items = array_merge($items, array_map(fn ($r) => (array) $r, $rows));
        }

        // Goals
        if ($filter === 'all' || $filter === 'goals') {
            $isLiked = $currentUserId
                ? "(SELECT COUNT(*) FROM likes WHERE user_id = {$currentUserId} AND target_type = 'goal' AND target_id = g.id AND tenant_id = {$tenantId})"
                : '0';
            $likesSub = "(SELECT COUNT(*) FROM likes lk WHERE lk.target_type = 'goal' AND lk.target_id = g.id AND lk.tenant_id = {$tenantId})";
            $commentsSub = "(SELECT COUNT(*) FROM comments cm WHERE cm.target_type = 'goal' AND cm.target_id = g.id AND cm.tenant_id = {$tenantId})";
            $goalLimit = ($filter === 'goals') ? $limit : 10;

            $rows = DB::select(
                "SELECT g.id, g.title, g.description as content, g.created_at,
                        'goal' as type,
                        COALESCE(u.name, CONCAT(u.first_name, ' ', u.last_name)) as author_name,
                        u.avatar_url as author_avatar,
                        g.user_id as author_id,
                        {$likesSub} as likes_count,
                        {$commentsSub} as comments_count,
                        {$isLiked} as is_liked
                 FROM goals g
                 JOIN users u ON g.user_id = u.id
                 WHERE g.tenant_id = ?
                 ORDER BY g.created_at DESC
                 LIMIT {$goalLimit}",
                [$tenantId]
            );
            $items = array_merge($items, array_map(fn ($r) => (array) $r, $rows));
        }

        // Sort by created_at descending and apply pagination
        usort($items, function ($a, $b) {
            return strtotime($b['created_at']) - strtotime($a['created_at']);
        });

        return array_slice($items, $offset, $limit);
    }
}
