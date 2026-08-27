<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Models\Comment;
use App\Models\Notification;
use App\Models\User;
use App\Services\MentionService;
use App\Support\FeedItemTables;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * CommentService — Eloquent-based service for comment operations.
 *
 * Uses the comments table with polymorphic target_type/target_id columns.
 * Supports threaded comments via parent_id and emoji reactions.
 */
class CommentService
{
    /**
     * Comment reactions share the same `reactions` table as post/listing/event
     * reactions, so the named-type alphabet from ReactionService::VALID_TYPES
     * is the canonical list. Frontend ReactionPicker and FeedRankingService
     * also use these named types — never raw emoji.
     */
    private static array $availableReactions = ReactionService::VALID_TYPES;

    /**
     * Get comments for a given entity, threaded by parent_id.
     *
     * @return array Top-level comments with nested replies
     */
    public static function getForEntity(string $targetType, int $targetId, int $currentUserId = 0): array
    {
        $targetType = self::normalizeTargetType($targetType);
        if (!self::targetIsCommentableAndVisible($targetType, $targetId, $currentUserId ?: null)) {
            return [];
        }

        $rows = Comment::with(['user:id,first_name,last_name,profile_type,organization_name,avatar_url'])
            ->where('tenant_id', TenantContext::getId())
            ->where('target_type', $targetType)
            ->where('target_id', $targetId)
            ->orderBy('created_at')
            ->get();

        // Get reactions for all comment IDs
        $commentIds = $rows->pluck('id')->all();
        $reactions = [];
        $userReactions = [];

        if (!empty($commentIds)) {
            $tenantId = TenantContext::getId();

            $reactionRows = DB::table('reactions')
                ->where('tenant_id', $tenantId)
                ->where('target_type', 'comment')
                ->whereIn('target_id', $commentIds)
                ->selectRaw('target_id, emoji, COUNT(*) as count')
                ->groupBy('target_id', 'emoji')
                ->get();

            foreach ($reactionRows as $r) {
                $reactions[$r->target_id][$r->emoji] = (int) $r->count;
            }

            if ($currentUserId > 0) {
                $userReactionRows = DB::table('reactions')
                    ->where('tenant_id', $tenantId)
                    ->where('target_type', 'comment')
                    ->whereIn('target_id', $commentIds)
                    ->where('user_id', $currentUserId)
                    ->get();

                foreach ($userReactionRows as $r) {
                    $userReactions[$r->target_id][] = $r->emoji;
                }
            }
        }

        // Build threaded structure
        $byId = [];
        $topLevel = [];

        foreach ($rows as $comment) {
            $cid = $comment->id;
            $user = $comment->user;
            $item = [
                'id' => $cid,
                'content' => $comment->content ?? '',
                'created_at' => $comment->created_at?->toIso8601String(),
                'edited' => $comment->updated_at && $comment->updated_at->gt($comment->created_at),
                'is_own' => (int) $comment->user_id === $currentUserId,
                'author' => [
                    'id' => (int) $comment->user_id,
                    'name' => $user ? UserDisplayName::resolve($user) : __('api.unknown_user'),
                    'avatar' => $user->avatar_url ?? null,
                ],
                'reactions' => $reactions[$cid] ?? (object) [],
                'user_reactions' => $userReactions[$cid] ?? [],
                'replies' => [],
            ];
            $byId[$cid] = $item;
        }

        foreach ($byId as $cid => &$c) {
            $comment = $rows->firstWhere('id', $cid);
            if ($comment->parent_id && isset($byId[$comment->parent_id])) {
                $byId[$comment->parent_id]['replies'][] = &$c;
            } else {
                $topLevel[] = &$c;
            }
        }

        return $topLevel;
    }

    public static function normalizeTargetType(string $targetType): string
    {
        return match ($targetType) {
            'feed_post' => 'post',
            'blog_post' => 'blog',
            'volunteering', 'volunteering_opportunity' => 'volunteer',
            'ideation_challenge' => 'challenge',
            default => $targetType,
        };
    }

    public static function targetIsCommentableAndVisible(string $targetType, int $targetId, ?int $viewerId): bool
    {
        $targetType = self::normalizeTargetType($targetType);

        return FeedItemTables::isCommentable($targetType)
            && FeedItemTables::canView($targetType, $targetId, $viewerId);
    }

    /**
     * Count all comments including replies.
     */
    public static function countAll(array $comments): int
    {
        $count = count($comments);
        foreach ($comments as $c) {
            if (!empty($c['replies'])) {
                $count += self::countAll($c['replies']);
            }
        }
        return $count;
    }

    /**
     * Create a comment on an entity.
     */
    public static function create(string $targetType, int $targetId, int $userId, int $tenantId, array $data): Comment
    {
        $targetType = self::normalizeTargetType($targetType);

        // Server-side XSS prevention: sanitize HTML content before storage
        $content = \App\Helpers\HtmlSanitizer::sanitize(trim($data['content']));

        $parentId = isset($data['parent_id']) && $data['parent_id'] !== null
            ? (int) $data['parent_id']
            : null;

        // Check post visibility — prevent commenting on deleted/hidden posts
        if (!self::targetIsCommentableAndVisible($targetType, $targetId, $userId)) {
            throw new \InvalidArgumentException(__('api.target_not_found'));
        }

        // M4: Wrap depth check + insert in a transaction to prevent TOCTOU race
        // where two concurrent requests both pass the depth check before either inserts.
        return DB::transaction(function () use ($targetType, $targetId, $userId, $tenantId, $content, $parentId, $data) {
        // Enforce nesting depth limit to prevent infinite recursion attacks
        if (!empty($parentId)) {
            $depth = 0;
            $currentId = (int)$parentId;
            while ($currentId && $depth < 15) {
                $parent = DB::selectOne(
                    'SELECT parent_id, target_type, target_id FROM comments WHERE id = ? AND tenant_id = ?',
                    [$currentId, $tenantId]
                );
                if (!$parent) {
                    throw new \InvalidArgumentException(__('api.parent_comment_not_found'));
                }
                if ((string) $parent->target_type !== $targetType || (int) $parent->target_id !== $targetId) {
                    throw new \InvalidArgumentException(__('api.parent_comment_target_mismatch'));
                }
                $currentId = (int)$parent->parent_id;
                $depth++;
            }
            if ($depth >= 10) {
                throw new \InvalidArgumentException(__('api.comment_nesting_too_deep'));
            }
        }

        $mentionedUserIds = self::resolveMentionRecipientIds($content, $tenantId);
        self::assertCommentContactAllowed(
            $targetType,
            $targetId,
            $parentId,
            $userId,
            $tenantId,
            $mentionedUserIds,
            'comment_create',
        );

        $comment = Comment::create([
            'target_type' => $targetType,
            'target_id' => $targetId,
            'user_id' => $userId,
            'tenant_id' => $tenantId,
            'content' => $content,
            'parent_id' => $parentId,
        ]);

        // Process @mentions in comment content
        try {
            MentionService::processText($content, $comment->id, 'comment', $userId);
        } catch (\Exception $e) {
            Log::warning("CommentService::create mention processing failed: " . $e->getMessage());
        }

        $replyRecipientId = null;
        if (!empty($parentId)) {
            try {
                $replyRecipientId = self::notifyParentCommentAuthor($comment, $userId, $tenantId);
            } catch (\Throwable $e) {
                Log::warning('CommentService::create parent comment notification failed', [
                    'comment_id' => $comment->id,
                    'parent_id' => $parentId,
                    'user_id' => $userId,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        // Notify the content owner that someone commented on their content (platform + email)
        try {
            $ownerId = self::resolveContentOwnerId($targetType, $targetId, $tenantId);

            if ($ownerId && $ownerId !== $userId && $ownerId !== $replyRecipientId) {
                SocialNotificationService::notifyComment(
                    $ownerId,
                    $userId,
                    $targetType,
                    $targetId,
                    $content,
                    (int) $comment->id
                );
            }
        } catch (\Throwable $e) {
            Log::warning('CommentService::create content owner notification failed', [
                'target_type' => $targetType,
                'target_id' => $targetId,
                'user_id' => $userId,
                'error' => $e->getMessage(),
            ]);
        }

        return $comment;
        }); // end DB::transaction
    }

    /**
     * Update a comment's content (owner only).
     *
     * @return string|null Sanitized stored content, or null when not allowed/found.
     */
    public static function update(int $commentId, int $userId, string $content): ?string
    {
        $tenantId = TenantContext::getId();

        $comment = Comment::where('id', $commentId)
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->first();

        if (!$comment) {
            return null;
        }

        // Server-side XSS prevention: sanitize HTML content before storage
        $trimmedContent = \App\Helpers\HtmlSanitizer::sanitize(trim($content));

        return DB::transaction(function () use ($comment, $commentId, $userId, $tenantId, $trimmedContent): string {
            $mentionedUserIds = self::resolveMentionRecipientIds($trimmedContent, $tenantId);
            self::assertCommentContactAllowed(
                (string) $comment->target_type,
                (int) $comment->target_id,
                $comment->parent_id !== null ? (int) $comment->parent_id : null,
                $userId,
                $tenantId,
                $mentionedUserIds,
                'comment_update',
            );

            $comment->content = $trimmedContent;
            $comment->save();

            // Re-process @mentions only after the protected-contact assertion.
            try {
                MentionService::deleteMentionsForEntity($commentId, 'comment');
                MentionService::processText($trimmedContent, $commentId, 'comment', $userId);
            } catch (\Exception $e) {
                Log::warning("CommentService::update mention re-processing failed: " . $e->getMessage());
            }

            return $trimmedContent;
        });
    }

    /**
     * Delete a comment (owner only).
     */
    public static function delete(int $commentId, int $userId): int
    {
        $tenantId = TenantContext::getId();

        $comment = Comment::where('id', $commentId)
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->first();

        if (!$comment) {
            return 0;
        }

        $ids = [$commentId];
        $frontier = [$commentId];

        while (!empty($frontier)) {
            $children = DB::table('comments')
                ->where('tenant_id', $tenantId)
                ->whereIn('parent_id', $frontier)
                ->pluck('id')
                ->map(fn ($id) => (int) $id)
                ->all();

            $children = array_values(array_diff($children, $ids));
            if (empty($children)) {
                break;
            }

            $ids = array_merge($ids, $children);
            $frontier = $children;
        }

        return Comment::where('tenant_id', $tenantId)
            ->whereIn('id', $ids)
            ->delete();
    }

    /**
     * Fetch threaded comments for a target.
     *
     * @return array Threaded comments array
     */
    public static function fetchComments(string $targetType, int $targetId, int $currentUserId = 0): array
    {
        $tenantId = TenantContext::getId();
        $targetType = self::normalizeTargetType($targetType);
        if (!self::targetIsCommentableAndVisible($targetType, $targetId, $currentUserId ?: null)) {
            return [];
        }

        $allComments = DB::table('comments as c')
            ->leftJoin('users as u', 'c.user_id', '=', 'u.id')
            ->where('c.target_type', $targetType)
            ->where('c.target_id', $targetId)
            ->where('c.tenant_id', $tenantId)
            ->whereNull('c.deleted_at')
            ->select([
                'c.id', 'c.user_id', 'c.content', 'c.parent_id', 'c.created_at', 'c.updated_at',
                DB::raw("COALESCE(u.avatar_url, '/assets/img/defaults/default_avatar.png') as author_avatar"),
            ])
            ->selectRaw(
                "COALESCE(NULLIF(u.name, ''), NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''), ?) as author_name",
                [__('api.unknown_user')]
            )
            ->orderBy('c.created_at')
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();

        $commentIds = array_column($allComments, 'id');
        $reactionsByComment = [];
        $userReactionsByComment = [];

        if (!empty($commentIds)) {
            // Get reaction counts grouped by emoji (tenant-scoped)
            $reactionRows = DB::table('reactions')
                ->where('tenant_id', $tenantId)
                ->where('target_type', 'comment')
                ->whereIn('target_id', $commentIds)
                ->selectRaw('target_id, emoji, COUNT(*) as count')
                ->groupBy('target_id', 'emoji')
                ->get();

            foreach ($reactionRows as $row) {
                $reactionsByComment[$row->target_id][$row->emoji] = (int) $row->count;
            }

            // Get current user's reactions (tenant-scoped)
            if ($currentUserId) {
                $userReactionRows = DB::table('reactions')
                    ->where('tenant_id', $tenantId)
                    ->where('target_type', 'comment')
                    ->whereIn('target_id', $commentIds)
                    ->where('user_id', $currentUserId)
                    ->get();

                foreach ($userReactionRows as $row) {
                    $userReactionsByComment[$row->target_id][] = $row->emoji;
                }
            }
        }

        // Build threaded structure
        $commentsById = [];
        $rootComments = [];

        foreach ($allComments as &$comment) {
            // Ensure created_at includes timezone for correct client-side relative time
            if (!empty($comment['created_at']) && !str_contains($comment['created_at'], 'T')) {
                $comment['created_at'] = \Carbon\Carbon::parse($comment['created_at'], 'UTC')->toIso8601String();
            }
            if (!empty($comment['updated_at']) && !str_contains($comment['updated_at'], 'T')) {
                $comment['updated_at'] = \Carbon\Carbon::parse($comment['updated_at'], 'UTC')->toIso8601String();
            }
            $comment['reactions'] = $reactionsByComment[$comment['id']] ?? [];
            $comment['user_reactions'] = $userReactionsByComment[$comment['id']] ?? [];
            $comment['is_owner'] = ($currentUserId && (int) $comment['user_id'] === $currentUserId);
            $comment['is_edited'] = ($comment['updated_at'] !== $comment['created_at']);
            $comment['replies'] = [];
            $commentsById[$comment['id']] = &$comment;
        }
        unset($comment);

        foreach ($allComments as &$comment) {
            if ($comment['parent_id'] && isset($commentsById[$comment['parent_id']])) {
                $commentsById[$comment['parent_id']]['replies'][] = &$commentsById[$comment['id']];
            } else {
                $rootComments[] = &$commentsById[$comment['id']];
            }
        }

        return $rootComments;
    }

    /**
     * Add a comment or reply.
     */
    public static function addComment(int $userId, int $tenantId, string $targetType, int $targetId, string $content, ?int $parentId = null): array
    {
        $targetType = self::normalizeTargetType($targetType);

        // Server-side XSS prevention: sanitize HTML content before storage
        $content = \App\Helpers\HtmlSanitizer::sanitize(trim($content));
        if (empty($content)) {
            return ['success' => false, 'error' => __('api.comment_cannot_be_empty')];
        }

        if (!self::targetIsCommentableAndVisible($targetType, $targetId, $userId)) {
            return ['success' => false, 'error' => __('api.target_not_found')];
        }

        // If replying, verify parent exists
        if ($parentId) {
            $parentExists = DB::table('comments')
                ->where('id', $parentId)
                ->where('tenant_id', $tenantId)
                ->where('target_type', $targetType)
                ->where('target_id', $targetId)
                ->exists();

            if (!$parentExists) {
                return ['success' => false, 'error' => __('api.parent_comment_not_found')];
            }
        }

        $mentions = self::extractMentions($content);
        $mentionedUsers = self::resolveLegacyMentionUsers($mentions, $tenantId);

        return DB::transaction(function () use (
            $userId,
            $tenantId,
            $targetType,
            $targetId,
            $parentId,
            $content,
            $mentions,
            $mentionedUsers,
        ): array {
            self::assertCommentContactAllowed(
                $targetType,
                $targetId,
                $parentId,
                $userId,
                $tenantId,
                array_values($mentionedUsers),
                'comment_create',
            );

            $commentId = DB::table('comments')->insertGetId([
                'user_id' => $userId,
                'tenant_id' => $tenantId,
                'target_type' => $targetType,
                'target_id' => $targetId,
                'parent_id' => $parentId,
                'content' => $content,
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            if (!empty($mentions)) {
                self::saveMentions($commentId, $mentions, $userId, $tenantId, $mentionedUsers);
            }

            // Get the created comment with author info
            $comment = DB::table('comments as c')
                ->leftJoin('users as u', 'c.user_id', '=', 'u.id')
                ->where('c.id', $commentId)
                ->select([
                    'c.*',
                    DB::raw("COALESCE(u.avatar_url, '/assets/img/defaults/default_avatar.png') as author_avatar"),
                ])
                ->selectRaw(
                    "COALESCE(NULLIF(u.name, ''), NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''), ?) as author_name",
                    [__('api.unknown_user')]
                )
                ->first();

            return [
                'success' => true,
                'status' => 'success',
                'comment' => $comment ? (array) $comment : null,
                'is_reply' => $parentId !== null,
            ];
        });
    }

    /**
     * Delete a comment (owner or super admin).
     */
    public static function deleteComment(int $commentId, int $userId, bool $isSuperAdmin = false): array
    {
        $tenantId = TenantContext::getId();

        $comment = DB::table('comments')
            ->where('id', $commentId)
            ->where('tenant_id', $tenantId)
            ->select(['id', 'user_id'])
            ->first();

        if (!$comment) {
            return ['success' => false, 'error' => __('api.comment_not_found')];
        }

        if ((int) $comment->user_id !== $userId && !$isSuperAdmin) {
            return ['success' => false, 'error' => __('api.comment_unauthorized')];
        }

        DB::table('comments')
            ->where('id', $commentId)
            ->where('tenant_id', $tenantId)
            ->delete();

        return ['success' => true, 'status' => 'success', 'message' => __('svc_notifications_2.comment.deleted')];
    }

    /**
     * Edit a comment (owner only).
     */
    public static function editComment(int $commentId, int $userId, string $newContent): array
    {
        $tenantId = TenantContext::getId();
        // Server-side XSS prevention: sanitize HTML content before storage
        $newContent = \App\Helpers\HtmlSanitizer::sanitize(trim($newContent));

        if (empty($newContent)) {
            return ['success' => false, 'error' => __('api.comment_cannot_be_empty')];
        }

        $comment = DB::table('comments')
            ->where('id', $commentId)
            ->where('tenant_id', $tenantId)
            ->select(['id', 'user_id', 'target_type', 'target_id', 'parent_id'])
            ->first();

        if (!$comment) {
            return ['success' => false, 'error' => __('api.comment_not_found')];
        }

        if ((int) $comment->user_id !== $userId) {
            return ['success' => false, 'error' => __('api.comment_unauthorized')];
        }

        $mentions = self::extractMentions($newContent);
        $mentionedUsers = self::resolveLegacyMentionUsers($mentions, $tenantId);

        return DB::transaction(function () use (
            $comment,
            $commentId,
            $userId,
            $tenantId,
            $newContent,
            $mentions,
            $mentionedUsers,
        ): array {
            self::assertCommentContactAllowed(
                (string) $comment->target_type,
                (int) $comment->target_id,
                property_exists($comment, 'parent_id') && $comment->parent_id !== null
                    ? (int) $comment->parent_id
                    : null,
                $userId,
                $tenantId,
                array_values($mentionedUsers),
                'comment_update',
            );

            DB::table('comments')
                ->where('id', $commentId)
                ->where('tenant_id', $tenantId)
                ->update(['content' => $newContent, 'updated_at' => now()]);

            // Re-process mentions only after the protected-contact assertion.
            DB::table('mentions')
                ->where('comment_id', $commentId)
                ->where('tenant_id', $tenantId)
                ->delete();

            if (!empty($mentions)) {
                self::saveMentions($commentId, $mentions, $userId, $tenantId, $mentionedUsers);
            }

            return [
                'success' => true,
                'status' => 'success',
                'content' => $newContent,
                'is_edited' => true,
            ];
        });
    }

    /**
     * Get validation errors (interface compatibility).
     */
    public static function getErrors(): array
    {
        return [];
    }

    /**
     * Get the list of available reaction emojis.
     */
    public static function getAvailableReactions(): array
    {
        return self::$availableReactions;
    }

    /**
     * Search users for @mention autocomplete.
     */
    public static function searchUsersForMention(string $query, int $tenantId, int $limit = 10): array
    {
        $searchTerm = '%' . $query . '%';

        return DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where(function ($q) use ($searchTerm) {
                $q->where('name', 'LIKE', $searchTerm)
                  ->orWhere('first_name', 'LIKE', $searchTerm)
                  ->orWhere('username', 'LIKE', $searchTerm);
            })
            ->select(['id', 'name', 'first_name', 'username', 'avatar_url'])
            ->limit($limit)
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();
    }

    /**
     * Toggle a reaction on a comment.
     *
     * The `$emoji` argument is now a NAMED reaction type from
     * ReactionService::VALID_TYPES (love, like, laugh, wow, sad, celebrate,
     * clap, time_credit) — NOT a raw emoji glyph. The legacy parameter name
     * is kept only because the same string is what gets stored in the
     * `reactions.emoji` column and returned to the frontend.
     */
    public static function toggleReaction(int $userId, int $tenantId, int $commentId, string $emoji): array
    {
        if (!in_array($emoji, ReactionService::VALID_TYPES, true)) {
            throw new \InvalidArgumentException('Invalid reaction type: ' . $emoji);
        }

        if (!FeedItemTables::canView('comment', $commentId, $userId)) {
            throw new \RuntimeException('comment_not_found');
        }

        $action = DB::transaction(function () use ($tenantId, $commentId, $userId, $emoji): string {
            $existing = DB::table('reactions')
                ->where('tenant_id', $tenantId)
                ->where('target_type', 'comment')
                ->where('target_id', $commentId)
                ->where('user_id', $userId)
                ->lockForUpdate()
                ->first();

            if ($existing) {
                if ($existing->emoji === $emoji) {
                    // Same type: remove
                    DB::table('reactions')
                        ->where('id', $existing->id)
                        ->where('tenant_id', $tenantId)
                        ->delete();
                    return 'removed';
                }

                self::assertReactionContactAllowed($commentId, $userId, $tenantId);

                // Different type: update
                DB::table('reactions')
                    ->where('id', $existing->id)
                    ->where('tenant_id', $tenantId)
                    ->update(['emoji' => $emoji, 'created_at' => now()]);
                return 'updated';
            }

            self::assertReactionContactAllowed($commentId, $userId, $tenantId);

            DB::table('reactions')->insert([
                'tenant_id'   => $tenantId,
                'target_type' => 'comment',
                'target_id'   => $commentId,
                'user_id'     => $userId,
                'emoji'       => $emoji,
                'created_at'  => now(),
            ]);
            return 'added';
        });

        // Aggregate updated reactions for this comment
        $reactionCounts = DB::table('reactions')
            ->where('tenant_id', $tenantId)
            ->where('target_type', 'comment')
            ->where('target_id', $commentId)
            ->selectRaw('emoji, COUNT(*) as count')
            ->groupBy('emoji')
            ->pluck('count', 'emoji')
            ->all();

        return [
            'action' => $action,
            'reactions' => empty($reactionCounts) ? (object) [] : $reactionCounts,
        ];
    }

    // =========================================================================
    // PRIVATE HELPERS
    // =========================================================================

    /**
     * Resolve every member who would receive directed contact from a comment,
     * then assert the indivisible write before storing the comment or mentions.
     *
     * @param list<int> $mentionedUserIds
     */
    private static function assertCommentContactAllowed(
        string $targetType,
        int $targetId,
        ?int $parentId,
        int $senderId,
        int $tenantId,
        array $mentionedUserIds,
        string $channel,
    ): void {
        if ((int) TenantContext::getId() !== $tenantId) {
            self::throwPolicyUnavailable($tenantId, $channel, 'tenant_context_mismatch');
        }

        try {
            $recipientIds = $mentionedUserIds;
            $ownerId = self::resolveContentOwnerId($targetType, $targetId, $tenantId);
            if ($ownerId !== null) {
                $recipientIds[] = $ownerId;
            }

            if ($parentId !== null) {
                $parentAuthorId = DB::table('comments')
                    ->where('id', $parentId)
                    ->where('tenant_id', $tenantId)
                    ->value('user_id');
                if ($parentAuthorId !== null) {
                    $recipientIds[] = (int) $parentAuthorId;
                }
            }
        } catch (\Throwable $e) {
            self::throwPolicyUnavailable($tenantId, $channel, 'comment_recipient_lookup_failed', $e);
        }

        $recipientIds = array_values(array_unique(array_filter(
            array_map(static fn (mixed $id): int => (int) $id, $recipientIds),
            static fn (int $id): bool => $id > 0 && $id !== $senderId,
        )));
        sort($recipientIds, SORT_NUMERIC);

        if ($recipientIds === []) {
            return;
        }

        app(SafeguardingInteractionPolicy::class)->assertManyLocalContactsAllowed(
            $senderId,
            $recipientIds,
            $tenantId,
            $channel,
        );
    }

    /** @return list<int> */
    private static function resolveMentionRecipientIds(string $content, int $tenantId): array
    {
        try {
            return array_values(MentionService::resolveMentions(
                MentionService::extractMentions($content),
                $tenantId,
            ));
        } catch (\Throwable $e) {
            self::throwPolicyUnavailable($tenantId, 'comment_mention', 'mention_recipient_lookup_failed', $e);
        }
    }

    /**
     * Resolve the strict legacy mention syntax used by addComment/editComment.
     *
     * @param list<string> $usernames
     * @return array<string, int>
     */
    private static function resolveLegacyMentionUsers(array $usernames, int $tenantId): array
    {
        if ($usernames === []) {
            return [];
        }

        try {
            $resolved = [];
            foreach ($usernames as $username) {
                $userId = DB::table('users')
                    ->where('tenant_id', $tenantId)
                    ->where(function ($query) use ($username) {
                        $query->whereRaw('LOWER(username) = ?', [strtolower($username)])
                            ->orWhereRaw('LOWER(SUBSTRING_INDEX(email, "@", 1)) = ?', [strtolower($username)])
                            ->orWhereRaw('LOWER(name) = ?', [strtolower($username)]);
                    })
                    ->value('id');

                if ($userId !== null) {
                    $resolved[$username] = (int) $userId;
                }
            }

            return $resolved;
        } catch (\Throwable $e) {
            self::throwPolicyUnavailable($tenantId, 'comment_mention', 'mention_recipient_lookup_failed', $e);
        }
    }

    private static function assertReactionContactAllowed(int $commentId, int $senderId, int $tenantId): void
    {
        if ((int) TenantContext::getId() !== $tenantId) {
            self::throwPolicyUnavailable($tenantId, 'reaction', 'tenant_context_mismatch');
        }

        try {
            $ownerId = DB::table('comments')
                ->where('id', $commentId)
                ->where('tenant_id', $tenantId)
                ->value('user_id');
        } catch (\Throwable $e) {
            self::throwPolicyUnavailable($tenantId, 'reaction', 'reaction_recipient_lookup_failed', $e);
        }

        if ($ownerId === null || (int) $ownerId <= 0) {
            self::throwPolicyUnavailable($tenantId, 'reaction', 'reaction_recipient_missing');
        }

        if ((int) $ownerId === $senderId) {
            return;
        }

        app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
            $senderId,
            (int) $ownerId,
            $tenantId,
            'reaction',
        );
    }

    private static function throwPolicyUnavailable(
        int $tenantId,
        string $channel,
        string $reason,
        ?\Throwable $exception = null,
    ): never {
        Log::error('Safeguarding contact recipient resolution unavailable', array_filter([
            'tenant_id' => $tenantId,
            'channel' => $channel,
            'reason_code' => $reason,
            'exception_class' => $exception !== null ? $exception::class : null,
        ], static fn (mixed $value): bool => $value !== null));

        throw new \App\Exceptions\SafeguardingPolicyException(
            'SAFEGUARDING_POLICY_UNAVAILABLE',
            __('safeguarding.errors.policy_unavailable'),
        );
    }

    /**
     * Extract @mentions from content.
     */
    private static function extractMentions(string $content): array
    {
        preg_match_all('/@(\w+)/', $content, $matches);
        return array_unique($matches[1] ?? []);
    }

    /**
     * Resolve the owner (user_id / author_id) of the content being commented on.
     *
     * Maps target_type to its database table and owner column, then queries for
     * the owner. Returns null when the target type is unknown or the row is missing.
     */
    private static function resolveContentOwnerId(string $targetType, int $targetId, int $tenantId): ?int
    {
        // Map target_type → [table, owner_column]
        $map = [
            'blog_post'             => ['posts',              'author_id'],
            'blog'                  => ['posts',              'author_id'],
            'listing'               => ['listings',           'user_id'],
            'feed_post'             => ['feed_posts',         'user_id'],
            'post'                  => ['feed_posts',         'user_id'],
            'event'                 => ['events',             'user_id'],
            'goal'                  => ['goals',              'user_id'],
            'poll'                  => ['polls',              'user_id'],
            'review'                => ['reviews',            'reviewer_id'],
            'resource'              => ['resources',          'user_id'],
            'volunteering'          => ['vol_opportunities',  'created_by'],
            'volunteering_opportunity' => ['vol_opportunities', 'created_by'],
            'volunteer'             => ['vol_opportunities',  'created_by'],
            'ideation_challenge'    => ['ideation_challenges', 'user_id'],
            'challenge'             => ['ideation_challenges', 'user_id'],
            'job'                   => ['job_vacancies',      'user_id'],
            'discussion'            => ['group_discussions',  'user_id'],
        ];

        $entry = $map[$targetType] ?? null;
        if (! $entry) {
            return null;
        }

        [$table, $ownerColumn] = $entry;

        $row = DB::table($table)
            ->where('id', $targetId)
            ->where('tenant_id', $tenantId)
            ->select([$ownerColumn])
            ->first();

        return $row ? (int) $row->{$ownerColumn} : null;
    }

    /**
     * Notify the direct parent comment author that their comment received a reply.
     *
     * Returns the resolved recipient ID so callers can avoid sending a duplicate
     * generic content-owner notification when the post owner is also the comment
     * author.
     */
    private static function notifyParentCommentAuthor(Comment $reply, int $replierId, int $tenantId): ?int
    {
        if (!$reply->parent_id) {
            return null;
        }

        $parent = DB::table('comments')
            ->where('id', (int) $reply->parent_id)
            ->where('tenant_id', $tenantId)
            ->select(['id', 'user_id'])
            ->first();

        if (!$parent) {
            return null;
        }

        $recipientId = (int) $parent->user_id;
        if ($recipientId === $replierId) {
            return $recipientId;
        }

        SocialNotificationService::notifyCommentReply(
            $recipientId,
            $replierId,
            (int) $reply->id,
            (string) $reply->target_type,
            (int) $reply->target_id,
            (string) $reply->content
        );

        return $recipientId;
    }

    /**
     * Return a human-readable label for a comment target type.
     */
    private static function contentTypeLabel(string $targetType): string
    {
        return match ($targetType) {
            'blog_post', 'blog' => 'post',
            'listing'           => 'listing',
            'feed_post', 'post' => 'post',
            'event'             => 'event',
            default             => 'content',
        };
    }

    /**
     * Save mentions to database and notify users.
     */
    private static function saveMentions(
        int $commentId,
        array $usernames,
        int $mentioningUserId,
        int $tenantId,
        ?array $resolvedUsers = null,
    ): void {
        // Look up the comment's target so mention notifications link to the right content
        $comment = DB::table('comments')
            ->where('id', $commentId)
            ->where('tenant_id', $tenantId)
            ->select(['target_type', 'target_id', 'content'])
            ->first();

        $resolvedUsers ??= self::resolveLegacyMentionUsers($usernames, $tenantId);
        foreach (array_values(array_unique($resolvedUsers)) as $mentionedUserId) {
            $mentionedUserId = (int) $mentionedUserId;
            // Strict-only matching to prevent a privacy/spam regression where
            // `@John` notified every John in the tenant. Resolution order:
            //   1. username exact (case-insensitive)
            //   2. email local-part exact (case-insensitive) — `@alice` => alice@…
            //   3. display name (`name`) exact (case-insensitive)
            // Any non-resolving mention is silently dropped — better to miss a
            // notification than spam unrelated users.
            if ($mentionedUserId !== $mentioningUserId) {
                try {
                    DB::table('mentions')->insert([
                        'comment_id' => $commentId,
                        'mentioned_user_id' => $mentionedUserId,
                        'mentioning_user_id' => $mentioningUserId,
                        'tenant_id' => $tenantId,
                        'created_at' => now(),
                    ]);

                    if ($comment) {
                        SocialNotificationService::notifyComment(
                            $mentionedUserId,
                            $mentioningUserId,
                            $comment->target_type,
                            (int) $comment->target_id,
                            $comment->content ?? ''
                        );
                    }
                } catch (\Exception $e) {
                    // Ignore duplicate mention errors
                }
            }
        }
    }
}
