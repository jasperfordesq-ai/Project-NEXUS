<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use App\Core\TenantContext;

/**
 * FeedItemTables — canonical map of feed-surface target_type → backing table.
 *
 * Used by every controller that needs to verify a polymorphic
 * (target_type, target_id) pair exists in the current tenant before
 * writing to a polymorphic table (reactions, feed_hidden, etc.).
 *
 * MUST stay aligned with `ReactionService::VALID_TARGET_TYPES` and
 * `FeedActivityService::VALID_TYPES`.
 */
final class FeedItemTables
{
    /**
     * Polymorphic target_type → DB table name.
     *
     * Notification-style virtual feed types (badge_earned, level_up) are
     * intentionally absent — they aren't user-actionable rows that can
     * be hidden or reacted to.
     */
    public const TABLES = [
        'post'      => 'feed_posts',
        'comment'   => 'comments',
        'listing'   => 'listings',
        'event'     => 'events',
        'goal'      => 'goals',
        'poll'      => 'polls',
        'review'    => 'reviews',
        'volunteer' => 'vol_opportunities',
        'volunteer_hours' => 'vol_logs',
        'challenge' => 'ideation_challenges',
        'resource'  => 'resources',
        'job'       => 'job_vacancies',
        'blog'      => 'posts',
        'discussion' => 'group_discussions',
    ];

    public const COMMENTABLE_TYPES = [
        'post',
        'listing',
        'event',
        'goal',
        'poll',
        'review',
        'volunteer',
        'challenge',
        'resource',
        'job',
        'blog',
        'discussion',
    ];

    /**
     * Verify a (target_type, target_id) pair resolves to a real row in the
     * current tenant. Fail-closed on unknown types or DB errors.
     */
    public static function exists(string $targetType, int $targetId): bool
    {
        if ($targetId <= 0) {
            return false;
        }

        $table = self::TABLES[$targetType] ?? null;
        if (!$table) {
            return false;
        }

        $tenantId = TenantContext::getId();
        if (!$tenantId) {
            return false;
        }

        try {
            return DB::table($table)
                ->where('id', $targetId)
                ->where('tenant_id', $tenantId)
                ->exists();
        } catch (\Throwable $e) {
            Log::warning("[FeedItemTables] existence check failed for {$targetType}: " . $e->getMessage());
            return false;
        }
    }

    public static function isCommentable(string $targetType): bool
    {
        return in_array($targetType, self::COMMENTABLE_TYPES, true);
    }

    public static function canView(string $targetType, int $targetId, ?int $viewerId = null): bool
    {
        if ($targetId <= 0 || !isset(self::TABLES[$targetType])) {
            return false;
        }

        $tenantId = TenantContext::getId();
        if (!$tenantId) {
            return false;
        }

        try {
            if ($targetType === 'comment') {
                return self::canViewComment($targetId, $viewerId, $tenantId);
            }

            if ($targetType === 'post') {
                return self::canViewPost($targetId, $viewerId, $tenantId);
            }

            if ($targetType === 'discussion') {
                // Group discussions are members-only and are NOT feed_activity
                // rows, so the generic fallback below would return true and let a
                // non-member react to / enumerate reactors of a private group's
                // discussions. Gate on group membership like the read endpoints.
                return self::canViewDiscussion($targetId, $viewerId, $tenantId);
            }

            if (!self::exists($targetType, $targetId)) {
                return false;
            }

            // F-071: goals and ideation challenges keep their feed row after
            // they stop being public (a goal switched to private; a challenge
            // is recorded on creation, while still a draft), so their own read
            // rule applies whether or not a feed row exists.
            if ($targetType === 'goal' && !self::canViewGoal($targetId, $viewerId, $tenantId)) {
                return false;
            }
            if ($targetType === 'challenge' && !self::canViewChallenge($targetId, $viewerId)) {
                return false;
            }
            // F-157: a review keeps its feed row after an admin hides or flags
            // it, or its author deletes it, so the review's own read rule must
            // apply whether or not a visible feed row exists.
            if ($targetType === 'review' && !self::canViewReview($targetId, $viewerId, $tenantId)) {
                return false;
            }

            $activity = DB::table('feed_activity')
                ->where('tenant_id', $tenantId)
                ->where('source_type', $targetType)
                ->where('source_id', $targetId)
                ->select(['group_id', 'is_visible', 'is_hidden'])
                ->first();

            if ($activity) {
                if ((int) ($activity->is_visible ?? 1) !== 1 || (int) ($activity->is_hidden ?? 0) === 1) {
                    return false;
                }

                return self::canViewGroup($activity->group_id !== null ? (int) $activity->group_id : null, $viewerId, $tenantId);
            }

            // F-071: no feed row. This used to return true, which opened
            // comments and reactions on private goals and on draft or
            // unmoderated items to everyone. Fail closed unless the item's own
            // module says the viewer may read it.
            return self::canViewWithoutFeedRow($targetType, $targetId, $viewerId, $tenantId);
        } catch (\Throwable $e) {
            Log::warning("[FeedItemTables] visibility check failed for {$targetType}: " . $e->getMessage());
            return false;
        }
    }

    public static function canViewProfile(int $profileUserId, ?int $viewerId = null): bool
    {
        $tenantId = TenantContext::getId();
        if (!$tenantId || $profileUserId <= 0) {
            return false;
        }

        if ($viewerId && $profileUserId === $viewerId) {
            return true;
        }

        $profile = DB::table('users')
            ->where('id', $profileUserId)
            ->where('tenant_id', $tenantId)
            ->select(['id', 'privacy_profile'])
            ->first();

        if (!$profile) {
            return false;
        }

        $privacy = $profile->privacy_profile ?? 'public';
        if ($privacy === 'public') {
            return true;
        }

        if (!$viewerId) {
            return false;
        }

        if ($privacy === 'members') {
            return true;
        }

        if ($privacy === 'connections') {
            return self::usersAreConnected($viewerId, $profileUserId, $tenantId);
        }

        return false;
    }

    public static function canPostInGroup(int $groupId, int $userId): bool
    {
        if (!TenantContext::getId() || $groupId <= 0 || $userId <= 0) {
            return false;
        }

        return \App\Services\GroupAccessService::canWriteContent($groupId, $userId);
    }

    public static function canViewGroup(?int $groupId, ?int $viewerId, int $tenantId): bool
    {
        if (!$groupId) {
            return true;
        }

        return $viewerId !== null
            && (int) TenantContext::getId() === $tenantId
            && \App\Services\GroupAccessService::canViewMemberContent($groupId, $viewerId);
    }

    /**
     * Access check for a group discussion (reactable target_type 'discussion').
     *
     * Mirrors the discussion read/post endpoints: active membership is required
     * regardless of the group's visibility (the owner always passes). The
     * membership lookup intentionally omits tenant_id — some legacy
     * group_members rows carry tenant_id=1 instead of the group's real tenant,
     * and group_id already scopes the row to one tenant's group.
     */
    private static function canViewDiscussion(int $discussionId, ?int $viewerId, int $tenantId): bool
    {
        if (!$viewerId) {
            return false;
        }

        $row = DB::table('group_discussions as d')
            ->join('groups as g', 'g.id', '=', 'd.group_id')
            ->where('d.id', $discussionId)
            ->where('d.tenant_id', $tenantId)
            ->where('g.tenant_id', $tenantId)
            ->select(['d.group_id', 'g.owner_id'])
            ->first();

        if (!$row) {
            return false;
        }

        return \App\Services\GroupAccessService::canViewMemberContent(
            (int) $row->group_id,
            $viewerId,
        );
    }

    /**
     * Read rule for an item that has no feed_activity row (F-071).
     *
     * Each branch reuses the owning module's own read rule. Unknown types are
     * refused, and so is a guest for every type whose rule needs a viewer.
     */
    private static function canViewWithoutFeedRow(string $targetType, int $targetId, ?int $viewerId, int $tenantId): bool
    {
        return match ($targetType) {
            // Already checked against the goal / challenge rule above.
            'goal', 'challenge' => true,
            // A poll's group lives on its feed row; a poll without one belongs
            // to no group, and polls have no draft or hidden state.
            'poll' => true,
            // Mirrors ListingService / job / EventPolicy / resource read rules.
            'listing', 'event', 'job', 'resource' => $viewerId !== null
                && SavedItemVisibility::canView($targetType, $targetId, $viewerId),
            'volunteer' => \App\Services\VolunteerService::getOpportunityById($targetId, $viewerId) !== null,
            'volunteer_hours' => self::canViewVolunteerHours($targetId, $viewerId, $tenantId),
            'review' => self::canViewReview($targetId, $viewerId, $tenantId),
            'blog' => self::canViewBlogPost($targetId, $viewerId, $tenantId),
            default => false,
        };
    }

    /** Same rule as GoalsController::canViewGoal(): public, or the owner, or the goal's mentor. */
    private static function canViewGoal(int $goalId, ?int $viewerId, int $tenantId): bool
    {
        $goal = DB::table('goals')
            ->where('id', $goalId)
            ->where('tenant_id', $tenantId)
            ->first(['user_id', 'mentor_id', 'is_public']);

        if (!$goal) {
            return false;
        }
        if ((bool) $goal->is_public) {
            return true;
        }

        return $viewerId !== null
            && ((int) $goal->user_id === $viewerId || (int) ($goal->mentor_id ?? 0) === $viewerId);
    }

    /** IdeationChallengeService applies canViewChallengeRecord(): draft/archived are creator/admin only. */
    private static function canViewChallenge(int $challengeId, ?int $viewerId): bool
    {
        return app(\App\Services\IdeationChallengeService::class)->getById($challengeId, $viewerId) !== null;
    }

    /** Pending or declined hours are private to the volunteer; approved hours are feed content. */
    private static function canViewVolunteerHours(int $logId, ?int $viewerId, int $tenantId): bool
    {
        $log = DB::table('vol_logs')
            ->where('id', $logId)
            ->where('tenant_id', $tenantId)
            ->first(['user_id', 'status']);

        if (!$log) {
            return false;
        }
        if ($viewerId !== null && (int) $log->user_id === $viewerId) {
            return true;
        }

        return $viewerId !== null && ($log->status ?? null) === 'approved';
    }

    /** Pending, rejected or author-deleted reviews are visible only to the reviewer and the receiver. */
    private static function canViewReview(int $reviewId, ?int $viewerId, int $tenantId): bool
    {
        $review = DB::table('reviews')
            ->where('id', $reviewId)
            ->where('tenant_id', $tenantId)
            ->first(['reviewer_id', 'receiver_id', 'status', 'deleted_by_author_at']);

        if (!$review || $viewerId === null) {
            return false;
        }
        if ((int) ($review->reviewer_id ?? 0) === $viewerId || (int) $review->receiver_id === $viewerId) {
            return true;
        }

        return in_array($review->status ?? null, [null, 'approved'], true)
            && $review->deleted_by_author_at === null;
    }

    /** Blog articles (`posts`): BlogService shows only published posts; drafts are the author's. */
    private static function canViewBlogPost(int $postId, ?int $viewerId, int $tenantId): bool
    {
        $post = DB::table('posts')
            ->where('id', $postId)
            ->where('tenant_id', $tenantId)
            ->first(['author_id', 'status']);

        if (!$post) {
            return false;
        }
        if (($post->status ?? null) === 'published') {
            return true;
        }

        return $viewerId !== null && (int) $post->author_id === $viewerId;
    }

    private static function canViewComment(int $commentId, ?int $viewerId, int $tenantId): bool
    {
        $comment = DB::table('comments')
            ->where('id', $commentId)
            ->where('tenant_id', $tenantId);

        if (Schema::hasColumn('comments', 'deleted_at')) {
            $comment->whereNull('deleted_at');
        }

        $comment = $comment->select(['target_type', 'target_id'])->first();

        if (!$comment) {
            return false;
        }

        return self::canView((string) $comment->target_type, (int) $comment->target_id, $viewerId);
    }

    private static function canViewPost(int $postId, ?int $viewerId, int $tenantId): bool
    {
        $query = DB::table('feed_posts')
            ->where('id', $postId)
            ->where('tenant_id', $tenantId);

        if (Schema::hasColumn('feed_posts', 'deleted_at')) {
            $query->whereNull('deleted_at');
        }

        if (Schema::hasColumn('feed_posts', 'publish_status')) {
            $query->where(function ($q) {
                $q->whereNull('publish_status')
                    ->orWhere('publish_status', 'published');
            });
        }

        if (Schema::hasColumn('feed_posts', 'is_hidden')) {
            $query->where(function ($q) {
                $q->whereNull('is_hidden')
                    ->orWhere('is_hidden', 0);
            });
        }

        $post = $query->select(['id', 'user_id', 'group_id', 'visibility'])->first();
        if (!$post) {
            return false;
        }

        if (!self::canViewGroup($post->group_id !== null ? (int) $post->group_id : null, $viewerId, $tenantId)) {
            return false;
        }

        return self::canViewPostVisibility((int) $post->user_id, (string) ($post->visibility ?? 'public'), $viewerId, $tenantId);
    }

    private static function canViewPostVisibility(int $authorId, string $visibility, ?int $viewerId, int $tenantId): bool
    {
        if ($visibility === 'public') {
            return true;
        }

        if (!$viewerId) {
            return false;
        }

        if ($authorId === $viewerId) {
            return true;
        }

        if (in_array($visibility, ['friends', 'connections'], true)) {
            return self::usersAreConnected($viewerId, $authorId, $tenantId);
        }

        return false;
    }

    private static function usersAreConnected(int $viewerId, int $profileUserId, int $tenantId): bool
    {
        return DB::table('connections')
            ->where('tenant_id', $tenantId)
            ->where('status', 'accepted')
            ->where(function ($q) use ($viewerId, $profileUserId) {
                $q->where(function ($q2) use ($viewerId, $profileUserId) {
                    $q2->where('requester_id', $viewerId)
                        ->where('receiver_id', $profileUserId);
                })->orWhere(function ($q2) use ($viewerId, $profileUserId) {
                    $q2->where('requester_id', $profileUserId)
                        ->where('receiver_id', $viewerId);
                });
            })
            ->exists();
    }
}
