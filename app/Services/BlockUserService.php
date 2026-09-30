<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\Models\BlockedUser;
use App\Models\Connection;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use App\Support\UserDisplayName;

/**
 * BlockUserService — manages user blocking/unblocking.
 *
 * A block row belongs to the BLOCKER's community: `user_blocks.tenant_id` is
 * the blocker's tenant when the block was made, and every same-community read
 * below is scoped to it. Since F-284 (owner decision, 29 Sep 2026) a member may
 * also block a member of a partner community on the same installation; such a
 * row still carries the blocker's tenant, so it is enforced on the internal
 * federation paths through isBlockedEitherAcrossCommunities(), which honours a
 * row only while it matches its blocker's current community.
 */
class BlockUserService
{
    private static function scopedBlocks()
    {
        $query = DB::table('user_blocks');

        if (Schema::hasColumn('user_blocks', 'tenant_id')) {
            $query->where('tenant_id', TenantContext::getId());
        }

        return $query;
    }

    /**
     * Block a user.
     *
     * @throws \RuntimeException
     */
    public static function block(int $userId, int $blockedUserId, ?string $reason = null): void
    {
        if ($userId === $blockedUserId) {
            throw new \RuntimeException(__('api.cannot_block_yourself'));
        }

        // Insert block record (ignore if already exists)
        $data = [
            'user_id' => $userId,
            'blocked_user_id' => $blockedUserId,
            'reason' => $reason,
            'created_at' => now(),
        ];

        $hasTenantColumn = Schema::hasColumn('user_blocks', 'tenant_id');
        if ($hasTenantColumn) {
            $data['tenant_id'] = TenantContext::getId();
        }

        $inserted = DB::table('user_blocks')->insertOrIgnore($data);

        // F-285: the table's UNIQUE key is (user_id, blocked_user_id) with no
        // tenant_id, while every read is tenant-scoped. After a super admin
        // moves members between communities (User::moveTenant rewrites
        // users.tenant_id only), a row for this pair can still carry the old
        // community's tenant_id — invisible here, yet it made the insert above
        // a silent no-op, so the member was told "blocked" and nothing was
        // enforced. Re-home that stale row into this community.
        //
        // A row belongs to its blocker's community, and a member is in exactly
        // one community. So the pair's row is stale only when it carries a
        // community other than the one the BLOCKER is in now — and only then is
        // it re-homed. A repeat block in the same community stays the
        // idempotent no-op it always was, and (F-284) a cross-community block,
        // whose row carries the blocker's own community while the blocked
        // member is elsewhere, is never moved or dropped by this.
        if ($inserted === 0 && $hasTenantColumn) {
            $tenantId = (int) TenantContext::getId();
            $blockerIsHere = DB::table('users')
                ->where('id', $userId)
                ->where('tenant_id', $tenantId)
                ->exists();

            if ($blockerIsHere) {
                DB::table('user_blocks')
                    ->where('user_id', $userId)
                    ->where('blocked_user_id', $blockedUserId)
                    ->where(function ($q) use ($tenantId) {
                        $q->where('tenant_id', '!=', $tenantId)->orWhereNull('tenant_id');
                    })
                    ->update([
                        'tenant_id' => $tenantId,
                        'reason' => $reason,
                        'created_at' => now(),
                    ]);
            }
        }

        // Auto-disconnect if connected
        try {
            $tenantId = TenantContext::getId();
            Connection::query()
                ->where(function (Builder $q) use ($userId, $blockedUserId) {
                    $q->where(function (Builder $q2) use ($userId, $blockedUserId) {
                        $q2->where('requester_id', $userId)->where('receiver_id', $blockedUserId);
                    })->orWhere(function (Builder $q2) use ($userId, $blockedUserId) {
                        $q2->where('requester_id', $blockedUserId)->where('receiver_id', $userId);
                    });
                })
                ->delete();
        } catch (\Throwable $e) {
            Log::warning('Failed to auto-disconnect on block', [
                'user_id' => $userId,
                'blocked_user_id' => $blockedUserId,
                'error' => $e->getMessage(),
            ]);
        }

        // F-284: the same for an internal cross-community connection, pending or
        // accepted, so the blocked member's request no longer sits with the
        // blocker. User ids are installation-wide, so the pair identifies it.
        try {
            DB::table('federation_connections')
                ->where(function ($q) use ($userId, $blockedUserId) {
                    $q->where(function ($q2) use ($userId, $blockedUserId) {
                        $q2->where('requester_user_id', $userId)->where('receiver_user_id', $blockedUserId);
                    })->orWhere(function ($q2) use ($userId, $blockedUserId) {
                        $q2->where('requester_user_id', $blockedUserId)->where('receiver_user_id', $userId);
                    });
                })
                ->delete();
        } catch (\Throwable $e) {
            Log::warning('Failed to remove federated connection on block', [
                'user_id' => $userId,
                'blocked_user_id' => $blockedUserId,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Unblock a user.
     */
    public static function unblock(int $userId, int $blockedUserId): bool
    {
        return self::scopedBlocks()
            ->where('user_id', $userId)
            ->where('blocked_user_id', $blockedUserId)
            ->delete() > 0;
    }

    /**
     * Check if userId has blocked targetUserId.
     */
    public static function isBlocked(int $userId, int $targetUserId): bool
    {
        return self::scopedBlocks()
            ->where('user_id', $userId)
            ->where('blocked_user_id', $targetUserId)
            ->exists();
    }

    /**
     * Check if either user has blocked the other.
     */
    public static function isBlockedEither(int $userA, int $userB): bool
    {
        return self::scopedBlocks()
            ->where(function ($q) use ($userA, $userB) {
                $q->where(function ($inner) use ($userA, $userB) {
                    $inner->where('user_id', $userA)->where('blocked_user_id', $userB);
                })->orWhere(function ($inner) use ($userA, $userB) {
                    $inner->where('user_id', $userB)->where('blocked_user_id', $userA);
                });
            })
            ->exists();
    }

    /**
     * F-284: is there a block, in either direction, between two members who may
     * be in DIFFERENT communities? Used on the internal federation paths, where
     * the tenant context is the acting member's community while the other
     * member's block row carries theirs, so isBlockedEither() cannot see it.
     *
     * A row counts only while it matches its blocker's current community — the
     * same rule the tenant-scoped reads apply, so a row left behind by a
     * community move stays inert here too until the member blocks again
     * (see the F-285 re-home in block()).
     */
    public static function isBlockedEitherAcrossCommunities(int $userA, int $userB): bool
    {
        if ($userA <= 0 || $userB <= 0 || $userA === $userB) {
            return false;
        }

        $query = DB::table('user_blocks as ub')
            ->where(function ($q) use ($userA, $userB) {
                $q->where(function ($inner) use ($userA, $userB) {
                    $inner->where('ub.user_id', $userA)->where('ub.blocked_user_id', $userB);
                })->orWhere(function ($inner) use ($userA, $userB) {
                    $inner->where('ub.user_id', $userB)->where('ub.blocked_user_id', $userA);
                });
            });

        if (Schema::hasColumn('user_blocks', 'tenant_id')) {
            $query->join('users as blocker', 'blocker.id', '=', 'ub.user_id')
                ->whereColumn('blocker.tenant_id', 'ub.tenant_id');
        }

        return $query->exists();
    }

    /**
     * Remove candidates that have a block in either direction with the viewer.
     *
     * The correlated NOT EXISTS keeps discovery queries bounded in SQL instead
     * of first materialising every blocked member into a WHERE NOT IN list.
     */
    public static function applyBilateralExclusion(
        Builder|QueryBuilder $query,
        int $tenantId,
        int $viewerId,
        string $candidateIdColumn = 'users.id',
    ): Builder|QueryBuilder {
        if ($viewerId <= 0) {
            return $query;
        }

        // Callers pass a fixed table/alias column, never request input.
        $candidateIdColumn = preg_replace('/[^A-Za-z0-9_.]/', '', $candidateIdColumn) ?: 'users.id';

        return $query->whereNotExists(function ($blocks) use ($tenantId, $viewerId, $candidateIdColumn): void {
            $blocks->selectRaw('1')
                ->from('user_blocks as ai_blocks');

            if (Schema::hasColumn('user_blocks', 'tenant_id')) {
                $blocks->where('ai_blocks.tenant_id', $tenantId);
            }

            $blocks->where(function ($directions) use ($viewerId, $candidateIdColumn): void {
                $directions->where(function ($outbound) use ($viewerId, $candidateIdColumn): void {
                    $outbound->where('ai_blocks.user_id', $viewerId)
                        ->whereColumn('ai_blocks.blocked_user_id', $candidateIdColumn);
                })->orWhere(function ($inbound) use ($viewerId, $candidateIdColumn): void {
                    $inbound->whereColumn('ai_blocks.user_id', $candidateIdColumn)
                        ->where('ai_blocks.blocked_user_id', $viewerId);
                });
            });
        });
    }

    /**
     * Refuse a member-to-member interaction (a comment on their content, a
     * reply, a reaction, a review, an endorsement, an appreciation) when
     * either member has blocked the other.
     *
     * The error is deliberately direction-neutral, like messaging's BLOCKED
     * response, so the actor cannot tell whether they were blocked or are the
     * blocker. Callers run this BEFORE the safeguarding contact policy so a
     * blocked member cannot probe the other member's safeguarding settings.
     *
     * @throws SafeguardingPolicyException with reason code BLOCKED
     */
    public static function assertNoBlockBetween(int $actorId, int $otherUserId): void
    {
        if ($actorId <= 0 || $otherUserId <= 0 || $actorId === $otherUserId) {
            return;
        }

        if (self::isBlockedEither($actorId, $otherUserId)) {
            throw new SafeguardingPolicyException('BLOCKED', __('safeguarding.errors.blocked_interaction'));
        }
    }

    /**
     * Drop every user that has a block (either direction) with $userId.
     * Keys are preserved so username => id maps survive the filter.
     *
     * @template TKey of array-key
     * @param array<TKey, int|string> $userIds
     * @return array<TKey, int|string>
     */
    public static function withoutBlockedPairs(int $userId, array $userIds): array
    {
        if ($userId <= 0 || $userIds === []) {
            return $userIds;
        }

        $blocked = array_map('intval', self::getBlockedPairIds($userId));
        if ($blocked === []) {
            return $userIds;
        }

        return array_filter(
            $userIds,
            static fn (int|string $id): bool => ! in_array((int) $id, $blocked, true),
        );
    }

    /**
     * Get all users blocked by the given user.
     */
    /**
     * F-381: whether a member of ANOTHER community may be blocked by a member
     * of $tenantId. Only while internal federation could actually put them in
     * front of that member: an ACTIVE partnership between the two communities
     * and a target who has opted in to federation (every cross-community
     * channel — messages, connection requests, transfers — requires the sender
     * to be opted in). Anyone else is answered as a missing id, so blocking is
     * neither an existence check nor a way to put a hidden member's name into
     * the block list.
     */
    public static function isReachableAcrossCommunities(int $tenantId, int $targetUserId): bool
    {
        $targetTenantId = DB::table('users as u')
            ->join('federation_user_settings as fus', 'fus.user_id', '=', 'u.id')
            ->where('u.id', $targetUserId)
            ->where('u.tenant_id', '<>', $tenantId)
            ->where('fus.federation_optin', 1)
            ->value('u.tenant_id');

        return $targetTenantId !== null && self::hasActivePartnership($tenantId, (int) $targetTenantId);
    }

    private static function hasActivePartnership(int $tenantA, int $tenantB): bool
    {
        return DB::table('federation_partnerships')
            ->where('status', 'active')
            ->where(function ($q) use ($tenantA, $tenantB) {
                $q->where(fn ($p) => $p->where('tenant_id', $tenantA)->where('partner_tenant_id', $tenantB))
                    ->orWhere(fn ($p) => $p->where('tenant_id', $tenantB)->where('partner_tenant_id', $tenantA));
            })
            ->exists();
    }

    /** F-381: the federated-member visibility rule, applied to a block-list row. */
    private static function isVisibleAcrossCommunities(object $row, int $tenantId): bool
    {
        return (int) ($row->federation_optin ?? 0) === 1
            && (int) ($row->profile_visible_federated ?? 0) === 1
            && ($row->blocked_status ?? null) === 'active'
            && self::hasActivePartnership($tenantId, (int) $row->blocked_tenant_id);
    }

    public static function getBlockedUsers(int $userId): Collection
    {
        $tenantId = TenantContext::getId();

        // The blocked member's own community is deliberately NOT filtered: a
        // block of a partner-community member (F-284) belongs to this list too,
        // so the member can see it and remove it. The row's tenant_id (below)
        // is what scopes the list to blocks made in this community.
        $query = DB::table('user_blocks')
            ->join('users', 'user_blocks.blocked_user_id', '=', 'users.id')
            ->leftJoin('federation_user_settings as fus', 'fus.user_id', '=', 'users.id')
            ->where('user_blocks.user_id', $userId);

        if (Schema::hasColumn('user_blocks', 'tenant_id')) {
            $query->where('user_blocks.tenant_id', $tenantId);
        }

        return $query
            ->select([
                'user_blocks.id as block_id',
                'user_blocks.blocked_user_id as user_id',
                'users.first_name',
                'users.last_name',
                'users.avatar_url',
                'users.organization_name',
                'users.profile_type',
                'user_blocks.reason',
                'user_blocks.created_at as blocked_at',
                'users.tenant_id as blocked_tenant_id',
                'users.status as blocked_status',
                'fus.federation_optin',
                'fus.profile_visible_federated',
            ])
            ->orderByDesc('user_blocks.created_at')
            ->get()
            ->map(function ($row) use ($tenantId) {
                // F-381: a partner-community member is named only while they
                // are visible across communities — the rule the federated
                // member profile applies. A block made earlier of someone who
                // has since hidden stays listed (so it can be removed) under
                // a neutral label, with no surname or photo.
                if ((int) $row->blocked_tenant_id !== (int) $tenantId
                    && !self::isVisibleAcrossCommunities($row, (int) $tenantId)
                ) {
                    return [
                        'block_id' => $row->block_id,
                        'user_id' => $row->user_id,
                        'name' => __('api.group_welcome_member_fallback'),
                        'first_name' => '',
                        'last_name' => '',
                        'avatar_url' => null,
                        'reason' => $row->reason,
                        'blocked_at' => $row->blocked_at,
                    ];
                }

                $name = ($row->profile_type === 'organisation' && !empty($row->organization_name))
                    ? $row->organization_name
                    : UserDisplayName::resolve($row);
                return [
                    'block_id' => $row->block_id,
                    'user_id' => $row->user_id,
                    'name' => $name,
                    'first_name' => $row->first_name,
                    'last_name' => $row->last_name,
                    'avatar_url' => $row->avatar_url,
                    'reason' => $row->reason,
                    'blocked_at' => $row->blocked_at,
                ];
            });
    }

    /**
     * Get all users who have blocked the given user.
     */
    public static function getBlockedByUsers(int $userId): Collection
    {
        return self::scopedBlocks()
            ->where('blocked_user_id', $userId)
            ->get();
    }

    /**
     * Get all user IDs that should be excluded from results for the given user.
     * Returns IDs of users blocked BY the user AND users who HAVE blocked the user.
     */
    public static function getBlockedPairIds(int $userId): array
    {
        $blockedByMe = self::scopedBlocks()
            ->where('user_id', $userId)
            ->pluck('blocked_user_id')
            ->all();

        $blockedMe = self::scopedBlocks()
            ->where('blocked_user_id', $userId)
            ->pluck('user_id')
            ->all();

        return array_unique(array_merge($blockedByMe, $blockedMe));
    }
}
