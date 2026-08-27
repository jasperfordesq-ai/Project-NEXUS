<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Models\BlockedUser;
use App\Models\Connection;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use App\Support\UserDisplayName;

/**
 * BlockUserService — manages user blocking/unblocking.
 *
 * Block relationships are tenant-scoped to avoid cross-community effects.
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

        if (Schema::hasColumn('user_blocks', 'tenant_id')) {
            $data['tenant_id'] = TenantContext::getId();
        }

        DB::table('user_blocks')->insertOrIgnore($data);

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
     * Get all users blocked by the given user.
     */
    public static function getBlockedUsers(int $userId): Collection
    {
        $tenantId = TenantContext::getId();

        $query = DB::table('user_blocks')
            ->join('users', 'user_blocks.blocked_user_id', '=', 'users.id')
            ->where('user_blocks.user_id', $userId)
            ->where('users.tenant_id', $tenantId);

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
            ])
            ->orderByDesc('user_blocks.created_at')
            ->get()
            ->map(function ($row) {
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
