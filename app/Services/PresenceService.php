<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Redis;

/**
 * PresenceService — Real-time user presence tracking.
 *
 * Uses Redis for fast lookups with DB persistence for durability.
 * All queries are tenant-scoped via TenantContext::getId().
 *
 * Redis key patterns:
 * - nexus:presence:{tenant_id}:{user_id}  — JSON payload, TTL 300s
 * - nexus:presence:online:{tenant_id}     — SET of online user IDs
 * - nexus:presence:throttle:{user_id}     — rate-limit DB writes (TTL 60s)
 */
class PresenceService
{
    /** How long before a user is considered "away" (seconds) */
    private const AWAY_THRESHOLD = 300; // 5 minutes

    /** How long before a user is considered "offline" (seconds) */
    private const OFFLINE_THRESHOLD = 900; // 15 minutes

    /** Redis cache TTL for presence data (seconds) */
    private const CACHE_TTL = 300; // 5 minutes

    /** Minimum interval between DB writes per user (seconds) */
    private const DB_WRITE_THROTTLE = 60; // 1 minute

    // ─────────────────────────────────────────────────────────────────────────
    // Heartbeat
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Record a heartbeat for the given user.
     *
     * Always updates Redis (fast). Only writes to DB at most once per 60 seconds
     * to avoid excessive write load.
     */
    public static function heartbeat(int $userId): void
    {
        $tenantId = TenantContext::getId();
        $now = now()->toDateTimeString();

        // Always update Redis — this is the source of truth for "online" status
        $redisKey = self::redisKey($tenantId, $userId);
        $onlineSetKey = self::onlineSetKey($tenantId);

        try {
            // Get current presence to preserve custom status / DND
            $existing = self::getFromRedis($tenantId, $userId);
            $status = 'online';

            // Preserve DND if manually set
            if ($existing && $existing['status'] === 'dnd') {
                $status = 'dnd';
            }

            $payload = [
                'user_id' => $userId,
                'tenant_id' => $tenantId,
                'status' => $status,
                'custom_status' => $existing['custom_status'] ?? null,
                'status_emoji' => $existing['status_emoji'] ?? null,
                'last_activity_at' => $now,
                'last_seen_at' => $now,
                // Rebuilt after the 5-minute entry expires: re-read the stored
                // setting, never default to visible (F-088).
                'hide_presence' => self::hidePresenceFor($userId, $existing),
            ];

            Redis::setex($redisKey, self::CACHE_TTL, json_encode($payload));
            Redis::sadd($onlineSetKey, $userId);
            Redis::expire($onlineSetKey, self::CACHE_TTL);
        } catch (\Throwable $e) {
            Log::warning('Presence Redis update failed', ['user_id' => $userId, 'error' => $e->getMessage()]);
        }

        // Throttle DB writes — only write once per minute
        $throttleKey = "nexus:presence:throttle:{$tenantId}:{$userId}";
        try {
            $wasSet = Redis::set($throttleKey, '1', 'EX', self::DB_WRITE_THROTTLE, 'NX');
            if (!$wasSet) {
                return; // Already written within the throttle window
            }
        } catch (\Throwable $e) {
            // If Redis fails, still write to DB
            Log::warning('Presence throttle check failed, writing to DB', ['error' => $e->getMessage()]);
        }

        // Write to DB
        try {
            DB::statement(
                "INSERT INTO user_presence (user_id, tenant_id, status, last_seen_at, last_activity_at)
                 VALUES (?, ?, 'online', ?, ?)
                 ON DUPLICATE KEY UPDATE
                    status = IF(status = 'dnd', 'dnd', 'online'),
                    last_seen_at = VALUES(last_seen_at),
                    last_activity_at = VALUES(last_activity_at),
                    updated_at = CURRENT_TIMESTAMP",
                [$userId, $tenantId, $now, $now]
            );
        } catch (\Throwable $e) {
            Log::error('Presence DB write failed', ['user_id' => $userId, 'error' => $e->getMessage()]);
        }

        // Bridge: keep users.last_active_at fresh for the legacy is_online consumers
        // (MessageService, UserService, GroupConversationService, FeedSidebarController, …).
        // The React SPA only pings /v2/presence/heartbeat — it never calls /auth/heartbeat,
        // which is the ONLY other writer of users.last_active_at. Without this bridge,
        // last_active_at goes stale ~5 min into every session and those surfaces show an
        // actively-online user as "offline". Rides the same once-per-60s throttle above, and
        // is wrapped in its own try so a users-row failure can never abort the presence write.
        try {
            DB::table('users')
                ->where('id', $userId)
                ->where('tenant_id', $tenantId)
                ->update(['last_active_at' => $now]);
        } catch (\Throwable $e) {
            Log::warning('Presence last_active_at bridge write failed', [
                'user_id' => $userId,
                'error' => $e->getMessage(),
            ]);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Read presence
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Get a single user's presence.
     *
     * @return array{status: string, last_seen_at: string|null, custom_status: string|null, status_emoji: string|null, hide_presence: bool}
     */
    public static function getPresence(int $userId): array
    {
        $tenantId = TenantContext::getId();

        // Try Redis first
        $cached = self::getFromRedis($tenantId, $userId);
        if ($cached !== null) {
            // If hide_presence is true, return offline to non-self callers
            return self::formatPresence($cached);
        }

        // Fall back to DB
        $row = DB::selectOne(
            "SELECT status, last_seen_at, last_activity_at, custom_status, status_emoji, hide_presence
             FROM user_presence
             WHERE user_id = ? AND tenant_id = ?",
            [$userId, $tenantId]
        );

        if (!$row) {
            return self::offlinePresence();
        }

        $data = [
            'status' => self::computeStatus((array) $row),
            'last_seen_at' => $row->last_seen_at,
            'last_activity_at' => $row->last_activity_at,
            'custom_status' => $row->custom_status,
            'status_emoji' => $row->status_emoji,
            'hide_presence' => (bool) $row->hide_presence,
        ];

        // Cache in Redis for next lookup
        try {
            $redisKey = self::redisKey($tenantId, $userId);
            Redis::setex($redisKey, self::CACHE_TTL, json_encode(array_merge($data, [
                'user_id' => $userId,
                'tenant_id' => $tenantId,
            ])));
        } catch (\Throwable) {
            // Non-critical
        }

        return self::formatPresence($data);
    }

    /**
     * Get presence for multiple users in a single batch.
     *
     * @param int[] $userIds
     * @return array<int, array{status: string, last_seen_at: string|null, custom_status: string|null, status_emoji: string|null}>
     */
    public static function getBulkPresence(array $userIds): array
    {
        if (empty($userIds)) {
            return [];
        }

        $tenantId = TenantContext::getId();
        $result = [];
        $missingIds = [];

        // Try Redis first for all requested users
        foreach ($userIds as $id) {
            $cached = self::getFromRedis($tenantId, (int) $id);
            if ($cached !== null) {
                $result[(int) $id] = self::formatPresence($cached);
            } else {
                $missingIds[] = (int) $id;
            }
        }

        // Fetch remaining from DB
        if (!empty($missingIds)) {
            $placeholders = implode(',', array_fill(0, count($missingIds), '?'));
            $rows = DB::select(
                "SELECT user_id, status, last_seen_at, last_activity_at, custom_status, status_emoji, hide_presence
                 FROM user_presence
                 WHERE user_id IN ({$placeholders}) AND tenant_id = ?",
                array_merge($missingIds, [$tenantId])
            );

            $foundIds = [];
            foreach ($rows as $row) {
                $data = [
                    'status' => self::computeStatus((array) $row),
                    'last_seen_at' => $row->last_seen_at,
                    'last_activity_at' => $row->last_activity_at,
                    'custom_status' => $row->custom_status,
                    'status_emoji' => $row->status_emoji,
                    'hide_presence' => (bool) $row->hide_presence,
                ];

                $result[(int) $row->user_id] = self::formatPresence($data);
                $foundIds[] = (int) $row->user_id;

                // Cache in Redis
                try {
                    $redisKey = self::redisKey($tenantId, (int) $row->user_id);
                    Redis::setex($redisKey, self::CACHE_TTL, json_encode(array_merge($data, [
                        'user_id' => (int) $row->user_id,
                        'tenant_id' => $tenantId,
                    ])));
                } catch (\Throwable) {
                    // Non-critical
                }
            }

            // Users with no presence record are offline
            foreach ($missingIds as $id) {
                if (!in_array($id, $foundIds, true)) {
                    $result[$id] = self::offlinePresence();
                }
            }
        }

        return $result;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Set status / privacy
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Manually set a user's status (e.g. DND, custom status).
     */
    public static function setStatus(int $userId, string $status, ?string $customStatus = null, ?string $emoji = null): void
    {
        $tenantId = TenantContext::getId();
        $now = now()->toDateTimeString();

        // Validate status
        $validStatuses = ['online', 'away', 'dnd', 'offline'];
        if (!in_array($status, $validStatuses, true)) {
            $status = 'online';
        }

        // Truncate custom status
        if ($customStatus !== null) {
            $customStatus = mb_substr(trim($customStatus), 0, 80);
        }

        // Truncate emoji
        if ($emoji !== null) {
            $emoji = mb_substr(trim($emoji), 0, 10);
        }

        // Update DB
        try {
            DB::statement(
                "INSERT INTO user_presence (user_id, tenant_id, status, custom_status, status_emoji, last_seen_at, last_activity_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    status = VALUES(status),
                    custom_status = VALUES(custom_status),
                    status_emoji = VALUES(status_emoji),
                    last_seen_at = VALUES(last_seen_at),
                    updated_at = CURRENT_TIMESTAMP",
                [$userId, $tenantId, $status, $customStatus, $emoji, $now, $now]
            );
        } catch (\Throwable $e) {
            Log::error('Presence setStatus DB failed', ['user_id' => $userId, 'error' => $e->getMessage()]);
        }

        // Update Redis
        try {
            $redisKey = self::redisKey($tenantId, $userId);
            $existing = self::getFromRedis($tenantId, $userId) ?? [];

            $payload = array_merge($existing, [
                'user_id' => $userId,
                'tenant_id' => $tenantId,
                'status' => $status,
                'custom_status' => $customStatus,
                'status_emoji' => $emoji,
                'last_seen_at' => $now,
                'hide_presence' => self::hidePresenceFor($userId, $existing),
            ]);

            Redis::setex($redisKey, self::CACHE_TTL, json_encode($payload));

            $onlineSetKey = self::onlineSetKey($tenantId);
            if (in_array($status, ['online', 'away', 'dnd'], true)) {
                Redis::sadd($onlineSetKey, $userId);
                Redis::expire($onlineSetKey, self::CACHE_TTL);
            } else {
                Redis::srem($onlineSetKey, $userId);
            }
        } catch (\Throwable $e) {
            Log::warning('Presence setStatus Redis failed', ['error' => $e->getMessage()]);
        }
    }

    /**
     * Toggle presence visibility for a user.
     */
    public static function setPrivacy(int $userId, bool $hidePresence): void
    {
        $tenantId = TenantContext::getId();

        try {
            DB::statement(
                "INSERT INTO user_presence (user_id, tenant_id, hide_presence)
                 VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE hide_presence = VALUES(hide_presence), updated_at = CURRENT_TIMESTAMP",
                [$userId, $tenantId, $hidePresence ? 1 : 0]
            );
        } catch (\Throwable $e) {
            Log::error('Presence setPrivacy DB failed', ['user_id' => $userId, 'error' => $e->getMessage()]);
        }

        // Update Redis cache
        try {
            $redisKey = self::redisKey($tenantId, $userId);
            $existing = self::getFromRedis($tenantId, $userId);
            if ($existing) {
                $existing['hide_presence'] = $hidePresence;
                Redis::setex($redisKey, self::CACHE_TTL, json_encode($existing));
            }
        } catch (\Throwable) {
            // Non-critical
        }
    }

    /**
     * Which of these members have chosen "hide my presence".
     *
     * Read from user_presence.hide_presence, the durable copy of the setting,
     * for surfaces that derive "online" from users.last_active_at (messages,
     * group participants) rather than from this service (F-088). If the read
     * fails every member is treated as hidden: showing someone as online who
     * asked not to be is the outcome to avoid.
     *
     * @param array<int|string> $userIds
     * @return list<int>
     */
    public static function hiddenUserIds(array $userIds): array
    {
        $userIds = array_values(array_unique(array_filter(
            array_map('intval', $userIds),
            static fn (int $id): bool => $id > 0,
        )));
        if ($userIds === []) {
            return [];
        }

        try {
            return DB::table('user_presence')
                ->where('tenant_id', TenantContext::getId())
                ->whereIn('user_id', $userIds)
                ->where('hide_presence', 1)
                ->pluck('user_id')
                ->map(static fn ($id): int => (int) $id)
                ->values()
                ->all();
        } catch (\Throwable $e) {
            Log::error('Presence hiddenUserIds lookup failed; treating members as hidden', [
                'error' => $e->getMessage(),
            ]);

            return $userIds;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Online count
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Get count of online users for a tenant.
     */
    public static function getOnlineCount(int $tenantId): int
    {
        // Try Redis SET first
        try {
            $count = Redis::scard(self::onlineSetKey($tenantId));
            if ($count > 0) {
                return (int) $count;
            }
        } catch (\Throwable) {
            // Fall through to DB
        }

        // Fallback: count from DB
        try {
            $row = DB::selectOne(
                "SELECT COUNT(*) as cnt FROM user_presence
                 WHERE tenant_id = ? AND status IN ('online', 'away', 'dnd')
                 AND last_activity_at >= DATE_SUB(NOW(), INTERVAL ? SECOND)",
                [$tenantId, self::OFFLINE_THRESHOLD]
            );

            return $row ? (int) $row->cnt : 0;
        } catch (\Throwable $e) {
            Log::error('Presence getOnlineCount failed', ['error' => $e->getMessage()]);
            return 0;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Cleanup (cron)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Mark stale users as offline.
     * Should be called by a scheduled task every 5 minutes.
     */
    public static function cleanupStale(): void
    {
        try {
            $affected = DB::update(
                "UPDATE user_presence
                 SET status = 'offline', updated_at = CURRENT_TIMESTAMP
                 WHERE status IN ('online', 'away')
                 AND last_activity_at < DATE_SUB(NOW(), INTERVAL ? SECOND)",
                [self::OFFLINE_THRESHOLD]
            );

            if ($affected > 0) {
                Log::info("Presence cleanup: marked {$affected} users as offline");
            }
        } catch (\Throwable $e) {
            Log::error('Presence cleanup failed', ['error' => $e->getMessage()]);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Private helpers
    // ─────────────────────────────────────────────────────────────────────────

    private static function redisKey(int $tenantId, int $userId): string
    {
        return "nexus:presence:{$tenantId}:{$userId}";
    }

    private static function onlineSetKey(int $tenantId): string
    {
        return "nexus:presence:online:{$tenantId}";
    }

    /**
     * Get presence data from Redis.
     *
     * @return array|null  Decoded JSON or null if not found.
     */
    private static function getFromRedis(int $tenantId, int $userId): ?array
    {
        try {
            $data = Redis::get(self::redisKey($tenantId, $userId));
            if ($data) {
                $decoded = json_decode($data, true);
                return is_array($decoded) ? $decoded : null;
            }
        } catch (\Throwable) {
            // Redis unavailable — fall through
        }

        return null;
    }

    /**
     * The hide_presence value to write into a rebuilt Redis entry. A live
     * entry that already carries the flag is trusted (setPrivacy keeps it in
     * step); otherwise the stored setting is re-read.
     */
    private static function hidePresenceFor(int $userId, ?array $existing): bool
    {
        if (is_array($existing) && array_key_exists('hide_presence', $existing)) {
            return (bool) $existing['hide_presence'];
        }

        return in_array($userId, self::hiddenUserIds([$userId]), true);
    }

    /**
     * Compute the effective status based on last_activity_at timestamps.
     * If the stored status is 'dnd', preserve it regardless of activity.
     */
    private static function computeStatus(array $data): string
    {
        $storedStatus = $data['status'] ?? 'offline';

        // DND is always preserved — it's manually set
        if ($storedStatus === 'dnd') {
            return 'dnd';
        }

        $lastActivity = $data['last_activity_at'] ?? null;
        if (!$lastActivity) {
            return 'offline';
        }

        $secondsAgo = time() - strtotime($lastActivity);

        if ($secondsAgo <= self::AWAY_THRESHOLD) {
            return 'online';
        }

        if ($secondsAgo <= self::OFFLINE_THRESHOLD) {
            return 'away';
        }

        return 'offline';
    }

    /**
     * Format presence for API output.
     * Respects hide_presence: returns offline for hidden users.
     */
    private static function formatPresence(array $data): array
    {
        $hidden = !empty($data['hide_presence']);

        if ($hidden) {
            return self::offlinePresence();
        }

        return [
            'status' => $data['status'] ?? 'offline',
            'last_seen_at' => $data['last_seen_at'] ?? null,
            'custom_status' => $data['custom_status'] ?? null,
            'status_emoji' => $data['status_emoji'] ?? null,
        ];
    }

    /**
     * Default offline presence response.
     */
    private static function offlinePresence(): array
    {
        return [
            'status' => 'offline',
            'last_seen_at' => null,
            'custom_status' => null,
            'status_emoji' => null,
        ];
    }
}
