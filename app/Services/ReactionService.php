<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\Support\FeedItemTables;
use Illuminate\Support\Facades\DB;
use App\Support\UserDisplayName;

/**
 * ReactionService — Manages emoji reactions on posts and comments.
 *
 * Supports 8 reaction types: love, like, laugh, wow, sad, celebrate, clap, time_credit.
 * Each user can have at most one reaction per entity. Toggling the same type removes it;
 * choosing a different type replaces the existing one.
 *
 * Uses the unified `reactions` table with `target_type` / `target_id` / `emoji` columns.
 */
class ReactionService
{
    /** Valid reaction types */
    public const VALID_TYPES = ['love', 'like', 'laugh', 'wow', 'sad', 'celebrate', 'clap', 'time_credit'];

    /**
     * Valid target types for the reactions table.
     *
     * Reactions are polymorphic — any module that surfaces a card in the feed
     * (post, listing, event, goal, poll, review, volunteer opportunity, challenge)
     * can be reacted to, plus comments. This list MUST stay in sync with
     * `feed_activity.source_type` values so the feed reload finds them.
     *
     * Notification-style cards (level_up, badge_earned) are intentionally excluded —
     * they're not user-authored content.
     */
    public const VALID_TARGET_TYPES = [
        'post',
        'comment',
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
     * Toggle a reaction on a post or comment.
     *
     * - If the user has no reaction: adds the given type.
     * - If the user has the same reaction type: removes it.
     * - If the user has a different reaction type: updates to the new type.
     *
     * @return array{action: string, reaction_type: string|null, reactions: array}
     */
    public function toggleReaction(int $entityId, string $entityType, string $reactionType, int $userId): array
    {
        $tenantId = TenantContext::getId();

        if (!in_array($entityType, self::VALID_TARGET_TYPES, true)) {
            throw new \InvalidArgumentException("Invalid entity type: {$entityType}");
        }

        if (!in_array($reactionType, self::VALID_TYPES, true)) {
            throw new \InvalidArgumentException("Invalid reaction type: {$reactionType}");
        }

        if (!FeedItemTables::canView($entityType, $entityId, $userId)) {
            throw new \RuntimeException('target_not_found');
        }

        // Serialise concurrent toggles for the same (user, entity) to avoid duplicate inserts.
        // Belt-and-braces: a DB-level unique index `reactions_unique` on
        // (tenant_id, user_id, target_type, target_id) is also enforced — see
        // 2026_04_12_140000_add_unique_index_to_reactions migration.
        [$action, $resultType] = DB::transaction(function () use ($tenantId, $entityType, $entityId, $userId, $reactionType) {
            $existing = DB::table('reactions')
                ->where('tenant_id', $tenantId)
                ->where('target_type', $entityType)
                ->where('target_id', $entityId)
                ->where('user_id', $userId)
                ->lockForUpdate()
                ->first();

            if ($existing) {
                if ($existing->emoji === $reactionType) {
                    // Same type: remove
                    DB::table('reactions')
                        ->where('id', $existing->id)
                        ->where('tenant_id', $tenantId)
                        ->delete();

                    return ['removed', null];
                }

                $this->assertReactionContactAllowed($entityType, $entityId, $userId, $tenantId);

                // Different type: update
                DB::table('reactions')
                    ->where('id', $existing->id)
                    ->where('tenant_id', $tenantId)
                    ->update([
                        'emoji' => $reactionType,
                        'created_at' => now(),
                    ]);

                return ['updated', $reactionType];
            }

            $this->assertReactionContactAllowed($entityType, $entityId, $userId, $tenantId);

            // No existing reaction: insert
            DB::table('reactions')->insert([
                'tenant_id' => $tenantId,
                'target_type' => $entityType,
                'target_id' => $entityId,
                'user_id' => $userId,
                'emoji' => $reactionType,
                'created_at' => now(),
            ]);

            return ['added', $reactionType];
        });

        // Return updated reaction state
        $reactions = $this->getReactions($entityId, $entityType, $userId);

        return [
            'action' => $action,
            'reaction_type' => $resultType,
            'reactions' => $reactions,
        ];
    }

    /**
     * Reactions are directed contact because they are stored against a
     * member-authored item and notify that member. Removal is handled before
     * this assertion so a member can always withdraw an existing reaction.
     */
    private function assertReactionContactAllowed(
        string $entityType,
        int $entityId,
        int $senderId,
        int $tenantId,
    ): void {
        $ownerId = SocialNotificationService::getContentOwnerId($entityType, $entityId);
        if ($ownerId === null || $ownerId <= 0) {
            throw new SafeguardingPolicyException(
                'SAFEGUARDING_POLICY_UNAVAILABLE',
                __('safeguarding.errors.policy_unavailable'),
            );
        }

        if ($ownerId === $senderId) {
            return;
        }

        app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
            $senderId,
            $ownerId,
            $tenantId,
            'reaction',
        );
    }

    /**
     * Get grouped reaction counts for an entity, plus current user's reaction.
     *
     * @return array{counts: array<string, int>, total: int, user_reaction: string|null, top_reactors: array}
     */
    public function getReactions(int $entityId, string $entityType, ?int $userId = null): array
    {
        $tenantId = TenantContext::getId();

        if (!in_array($entityType, self::VALID_TARGET_TYPES, true)) {
            throw new \InvalidArgumentException("Invalid entity type: {$entityType}");
        }

        // Get grouped counts
        $rows = DB::table('reactions')
            ->where('tenant_id', $tenantId)
            ->where('target_type', $entityType)
            ->where('target_id', $entityId)
            ->select('emoji', DB::raw('COUNT(*) as count'))
            ->groupBy('emoji')
            ->get();

        $counts = [];
        $total = 0;
        foreach ($rows as $row) {
            $counts[$row->emoji] = (int) $row->count;
            $total += (int) $row->count;
        }

        // Get current user's reaction
        $userReaction = null;
        if ($userId) {
            $userRow = DB::table('reactions')
                ->where('tenant_id', $tenantId)
                ->where('target_type', $entityType)
                ->where('target_id', $entityId)
                ->where('user_id', $userId)
                ->first();

            if ($userRow) {
                $userReaction = $userRow->emoji;
            }
        }

        // Get a few recent reactor names for the summary
        $topReactors = DB::table('reactions as r')
            ->join('users as u', function ($join) use ($tenantId) {
                $join->on('r.user_id', '=', 'u.id')
                    ->where('u.tenant_id', '=', $tenantId);
            })
            ->where('r.tenant_id', $tenantId)
            ->where('r.target_type', $entityType)
            ->where('r.target_id', $entityId)
            ->orderByDesc('r.created_at')
            ->limit(3)
            ->select('u.id', DB::raw(UserDisplayName::sql('u', 'name')), 'u.avatar_url')
            ->get()
            ->map(fn ($r) => [
                'id' => (int) $r->id,
                'name' => trim($r->name),
                'avatar_url' => $r->avatar_url,
            ])
            ->all();

        return [
            'counts' => $counts,
            'total' => $total,
            'user_reaction' => $userReaction,
            'top_reactors' => $topReactors,
        ];
    }

    /**
     * Get paginated list of users who reacted with a specific type.
     *
     * @return array{users: array, total: int, has_more: bool}
     */
    public function getReactors(int $entityId, string $entityType, string $reactionType, int $page = 1, int $perPage = 20): array
    {
        $tenantId = TenantContext::getId();

        if (!in_array($entityType, self::VALID_TARGET_TYPES, true)) {
            throw new \InvalidArgumentException("Invalid entity type: {$entityType}");
        }

        $query = DB::table('reactions as r')
            ->join('users as u', function ($join) use ($tenantId) {
                $join->on('r.user_id', '=', 'u.id')
                    ->where('u.tenant_id', '=', $tenantId);
            })
            ->where('r.tenant_id', $tenantId)
            ->where('r.target_type', $entityType)
            ->where('r.target_id', $entityId)
            ->where('r.emoji', $reactionType);

        $total = $query->count();

        $users = (clone $query)
            ->orderByDesc('r.created_at')
            ->offset(($page - 1) * $perPage)
            ->limit($perPage)
            ->select(
                'u.id',
                DB::raw(UserDisplayName::sql('u', 'name')),
                'u.avatar_url',
                'r.created_at as reacted_at'
            )
            ->get()
            ->map(fn ($r) => [
                'id' => (int) $r->id,
                'name' => trim($r->name),
                'avatar_url' => $r->avatar_url,
                'reacted_at' => $r->reacted_at,
            ])
            ->all();

        return [
            'users' => $users,
            'total' => $total,
            'has_more' => ($page * $perPage) < $total,
        ];
    }

    /**
     * Get reaction data for multiple posts at once (for feed listing).
     *
     * @deprecated Use getReactionsForItems() — this hardcodes target_type='post'
     *             and silently returns empty for listing/event/goal/etc. items,
     *             which is the root cause of the "reactions don't persist" bug
     *             that has regressed repeatedly.
     *
     * @param int[] $postIds
     * @return array<int, array{counts: array, total: int, user_reaction: string|null}>
     */
    public function getReactionsForPosts(array $postIds, ?int $userId = null): array
    {
        $items = array_map(fn ($id) => ['type' => 'post', 'id' => (int) $id], $postIds);
        $byKey = $this->getReactionsForItems($items, $userId);
        $result = [];
        foreach ($postIds as $pid) {
            $result[(int) $pid] = $byKey['post:' . (int) $pid]
                ?? ['counts' => [], 'total' => 0, 'user_reaction' => null];
        }
        return $result;
    }

    /**
     * Get reaction data for a heterogeneous batch of feed items at once.
     *
     * This is THE method to use from feed loaders — it correctly handles
     * polymorphic feed items (post, listing, event, goal, poll, review,
     * volunteer, challenge, resource). Returned map is keyed by "type:id".
     *
     * @param array<int, array{type: string, id: int}> $items
     * @param int|null $userId Current viewer (for user_reaction)
     * @return array<string, array{counts: array<string,int>, total: int, user_reaction: string|null}>
     */
    public function getReactionsForItems(array $items, ?int $userId = null): array
    {
        // Filter to reactable types and dedupe
        $byType = [];
        $resultKeys = [];
        foreach ($items as $item) {
            $type = (string) ($item['type'] ?? '');
            $id   = (int) ($item['id'] ?? 0);
            if ($id <= 0 || !in_array($type, self::VALID_TARGET_TYPES, true)) {
                continue;
            }
            $byType[$type] ??= [];
            $byType[$type][$id] = true;
            $resultKeys[] = $type . ':' . $id;
        }

        $result = [];
        foreach ($resultKeys as $k) {
            $result[$k] = ['counts' => [], 'total' => 0, 'user_reaction' => null, 'top_reactors' => []];
        }

        if (empty($byType)) {
            return $result;
        }

        $tenantId = TenantContext::getId();

        // Per-type batch queries — keeps the WHERE clause simple and uses the
        // (target_type, target_id) index efficiently.
        foreach ($byType as $type => $idMap) {
            $ids = array_keys($idMap);
            $placeholders = implode(',', array_fill(0, count($ids), '?'));

            $rows = DB::select(
                "SELECT target_id, emoji, COUNT(*) as count
                 FROM reactions
                 WHERE tenant_id = ? AND target_type = ? AND target_id IN ({$placeholders})
                 GROUP BY target_id, emoji",
                array_merge([$tenantId, $type], $ids)
            );
            foreach ($rows as $row) {
                $key = $type . ':' . (int) $row->target_id;
                $result[$key]['counts'][$row->emoji] = (int) $row->count;
                $result[$key]['total'] += (int) $row->count;
            }

            if ($userId) {
                $userRows = DB::select(
                    "SELECT target_id, emoji
                     FROM reactions
                     WHERE tenant_id = ? AND target_type = ? AND target_id IN ({$placeholders}) AND user_id = ?",
                    array_merge([$tenantId, $type], $ids, [$userId])
                );
                foreach ($userRows as $row) {
                    $key = $type . ':' . (int) $row->target_id;
                    $result[$key]['user_reaction'] = $row->emoji;
                }
            }

            // Top 3 most-recent reactors per item (window function) so feed
            // cards can render the "Anna, Bob and 5 others" summary without a
            // per-item follow-up request. Same shape as getReactions().
            $reactorRows = DB::select(
                "SELECT target_id, user_id, name, avatar_url FROM (
                    SELECT r.target_id, r.user_id,
                           " . UserDisplayName::sql('u', 'name') . ",
                           u.avatar_url,
                           ROW_NUMBER() OVER (PARTITION BY r.target_id ORDER BY r.created_at DESC) AS rn
                    FROM reactions r
                    JOIN users u ON u.id = r.user_id AND u.tenant_id = r.tenant_id
                    WHERE r.tenant_id = ? AND r.target_type = ? AND r.target_id IN ({$placeholders})
                 ) ranked WHERE rn <= 3",
                array_merge([$tenantId, $type], $ids)
            );
            foreach ($reactorRows as $row) {
                $key = $type . ':' . (int) $row->target_id;
                $result[$key]['top_reactors'][] = [
                    'id' => (int) $row->user_id,
                    'name' => trim((string) $row->name),
                    'avatar_url' => $row->avatar_url,
                ];
            }
        }

        return $result;
    }
}
