<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Support\FeedItemTables;
use Illuminate\Support\Facades\DB;

/**
 * ShareService — Polymorphic repost / share logic for every feed item type.
 *
 * Mirrors the BookmarkService pattern. Uses the pre-existing
 * `post_shares.original_type` + `post_shares.original_post_id` columns
 * (formerly always 'post') so every feed item type can be shared.
 *
 * Unique constraint: `post_shares_uniq_share` on
 *   (tenant_id, user_id, original_type, original_post_id)
 * prevents the same user sharing the same item twice.
 */
class ShareService
{
    /**
     * Every shareable feed item type. Must stay in sync with:
     *   - react-frontend/src/components/feed/FeedCard.tsx::SHAREABLE_TYPES
     *   - react-frontend/src/components/feed/ShareButton.tsx
     */
    public const VALID_TYPES = [
        'post', 'listing', 'event', 'poll', 'job',
        'blog', 'discussion', 'goal', 'challenge', 'volunteer',
    ];

    /**
     * Per-type source table + owner column.
     * Used for existence checks, self-share prevention, and author notifications.
     *
     * @var array<string, array{table: string, owner_col: string}>
     */
    private const SOURCE_MAP = [
        'post'       => ['table' => 'feed_posts',           'owner_col' => 'user_id'],
        'listing'    => ['table' => 'listings',             'owner_col' => 'user_id'],
        'event'      => ['table' => 'events',               'owner_col' => 'user_id'],
        'poll'       => ['table' => 'polls',                'owner_col' => 'user_id'],
        'job'        => ['table' => 'job_vacancies',        'owner_col' => 'user_id'],
        'blog'       => ['table' => 'posts',                'owner_col' => 'author_id'],
        'discussion' => ['table' => 'group_discussions',    'owner_col' => 'user_id'],
        'goal'       => ['table' => 'goals',                'owner_col' => 'user_id'],
        'challenge'  => ['table' => 'ideation_challenges',  'owner_col' => 'user_id'],
        'volunteer'  => ['table' => 'vol_opportunities',    'owner_col' => 'created_by'],
    ];

    /**
     * Toggle a share for a feed item.
     *
     * @return array{shared: bool, count: int, share_id: ?int, self_share: bool}
     * @throws \InvalidArgumentException on unknown type
     * @throws \RuntimeException         if the source item does not exist
     */
    public function toggle(int $userId, string $type, int $id, ?string $comment = null): array
    {
        $this->validateType($type);
        $tenantId = TenantContext::getId();

        // Existing share → toggle OFF
        $existing = DB::table('post_shares')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->where('original_type', $type)
            ->where('original_post_id', $id)
            ->first();

        if ($existing) {
            DB::table('post_shares')
                ->where('id', $existing->id)
                ->where('tenant_id', $tenantId)
                ->delete();

            // Decrement aggregated counter on feed_posts (posts only — typed items
            // don't carry a denormalized count).
            if ($type === 'post') {
                DB::table('feed_posts')
                    ->where('id', $id)
                    ->where('tenant_id', $tenantId)
                    ->update(['share_count' => DB::raw('GREATEST(share_count - 1, 0)')]);
            }

            return [
                'shared'     => false,
                'count'      => $this->getShareCount($type, $id, $tenantId),
                'share_id'   => null,
                'self_share' => false,
            ];
        }

        if (!FeedItemTables::canView($type, $id, $userId)) {
            throw new \RuntimeException('not_found');
        }

        $ownerId = $this->resolveOwnerId($type, $id, $tenantId);
        if ($ownerId === null) {
            throw new \RuntimeException('not_found');
        }

        // Self-share is not allowed
        if ($ownerId === $userId) {
            throw new \DomainException('self_share');
        }

        // E-035 F-158 sibling: sharing someone's content notifies them, so a
        // block in either direction must stop it, as it stops likes/comments.
        BlockUserService::assertNoBlockBetween($userId, $ownerId);

        app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
            $userId,
            $ownerId,
            (int) $tenantId,
            'feed_share',
        );

        // Sanitize comment
        $comment = $comment === null ? null : mb_substr(strip_tags($comment), 0, 1000);
        if ($comment === '') {
            $comment = null;
        }

        // Atomic insert — relies on post_shares_uniq_share unique index.
        $shareId = DB::table('post_shares')->insertGetId([
            'user_id'          => $userId,
            'tenant_id'        => $tenantId,
            'original_type'    => $type,
            'original_post_id' => $id,
            'comment'          => $comment,
            // Legacy columns on the table — populate sensible defaults.
            // `post_id` = 0 historically held the new shared feed_posts.id; unused here.
            'post_id'          => 0,
            'created_at'       => now(),
        ]);

        if ($type === 'post') {
            DB::table('feed_posts')
                ->where('id', $id)
                ->where('tenant_id', $tenantId)
                ->increment('share_count');
        }

        // Best-effort notification to the original author.
        $this->notifyOwner($userId, $ownerId, $type, $id, $tenantId);

        return [
            'shared'     => true,
            'count'      => $this->getShareCount($type, $id, $tenantId),
            'share_id'   => (int) $shareId,
            'self_share' => false,
        ];
    }

    /**
     * Does this user have a share for this item?
     */
    public function isShared(int $userId, string $type, int $id, ?int $tenantId = null): bool
    {
        $this->validateType($type);
        return DB::table('post_shares')
            ->where('tenant_id', $tenantId ?? TenantContext::getId())
            ->where('user_id', $userId)
            ->where('original_type', $type)
            ->where('original_post_id', $id)
            ->exists();
    }

    /**
     * Total share count for an item across all users.
     */
    public function getShareCount(string $type, int $id, ?int $tenantId = null): int
    {
        $this->validateType($type);
        return (int) DB::table('post_shares')
            ->where('tenant_id', $tenantId ?? TenantContext::getId())
            ->where('original_type', $type)
            ->where('original_post_id', $id)
            ->count();
    }

    /**
     * Batch fetch {type, id} → count map. Used by FeedService to hydrate
     * share_count for typed items without N+1 queries.
     *
     * @param  array<string, int[]>  $typeToIds  e.g. ['listing' => [1,2,3], 'event' => [4]]
     * @return array<string, array<int, int>>    nested: [type][id] => count
     */
    public function batchShareCount(array $typeToIds, int $tenantId): array
    {
        if (empty($typeToIds)) {
            return [];
        }
        $result = [];
        foreach ($typeToIds as $type => $ids) {
            if (!in_array($type, self::VALID_TYPES, true) || empty($ids)) {
                continue;
            }
            $rows = DB::table('post_shares')
                ->where('tenant_id', $tenantId)
                ->where('original_type', $type)
                ->whereIn('original_post_id', array_unique($ids))
                ->select('original_post_id', DB::raw('COUNT(*) as c'))
                ->groupBy('original_post_id')
                ->get();
            foreach ($rows as $row) {
                $result[$type][(int) $row->original_post_id] = (int) $row->c;
            }
        }
        return $result;
    }

    /**
     * Batch fetch {type, id} → bool for a user. Returns nested map.
     *
     * @param  array<string, int[]>  $typeToIds
     * @return array<string, array<int, bool>>
     */
    public function batchIsShared(int $userId, array $typeToIds, int $tenantId): array
    {
        if (empty($typeToIds)) {
            return [];
        }
        $result = [];
        foreach ($typeToIds as $type => $ids) {
            if (!in_array($type, self::VALID_TYPES, true) || empty($ids)) {
                continue;
            }
            $sharedIds = DB::table('post_shares')
                ->where('tenant_id', $tenantId)
                ->where('user_id', $userId)
                ->where('original_type', $type)
                ->whereIn('original_post_id', array_unique($ids))
                ->pluck('original_post_id')
                ->all();
            $flip = array_flip($sharedIds);
            foreach ($ids as $id) {
                $result[$type][(int) $id] = isset($flip[(int) $id]);
            }
        }
        return $result;
    }

    /**
     * Resolve the owner user_id for a given (type, id). Returns null if not found.
     * Scoped by tenant to prevent cross-tenant share references.
     */
    public function resolveOwnerId(string $type, int $id, int $tenantId): ?int
    {
        $this->validateType($type);
        $source = self::SOURCE_MAP[$type];
        $row = DB::table($source['table'])
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->select($source['owner_col'] . ' as owner_id')
            ->first();
        return $row ? (int) $row->owner_id : null;
    }

    /**
     * Validate that the type is shareable.
     *
     * @throws \InvalidArgumentException
     */
    public function validateType(string $type): void
    {
        if (!in_array($type, self::VALID_TYPES, true)) {
            throw new \InvalidArgumentException('invalid_shareable_type');
        }
    }

    private function notifyOwner(int $sharerId, int $ownerId, string $type, int $id, int $tenantId): void
    {
        $previousTenantId = TenantContext::currentId();

        try {
            if (!TenantContext::setById($tenantId)) {
                return;
            }

            SocialNotificationService::notifyShare($ownerId, $sharerId, $type, $id);
        } catch (\Throwable $e) {
            // Never let a notification failure block the share.
        } finally {
            if ($previousTenantId !== null) {
                TenantContext::setById((int) $previousTenantId);
            } else {
                TenantContext::reset();
            }
        }
    }
}
