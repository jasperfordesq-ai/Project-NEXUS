<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * LeaderboardService — Multi-type leaderboard system.
 *
 * Supports 9 leaderboard types (credits earned/spent, volunteer hours, badges, XP,
 * connections, reviews, posts, streaks) with weekly/monthly/all-time periods.
 * All queries are tenant-scoped.
 */
class LeaderboardService
{
    public const LEADERBOARD_TYPES = [
        'credits_earned' => 'Time Credits Earned',
        'credits_spent'  => 'Time Credits Spent',
        'vol_hours'      => 'Volunteer Hours',
        'badges'         => 'Badges Earned',
        'xp'             => 'Experience Points',
        'connections'    => 'Connections Made',
        'reviews'        => 'Reviews Given',
        'posts'          => 'Posts Created',
        'streak'         => 'Login Streak',
    ];

    public const PERIODS = ['all_time', 'monthly', 'weekly'];

    /** Cache TTL for leaderboard queries (60 seconds — short TTL keeps rankings fresh). */
    public const CACHE_TTL_SECONDS = 60;

    /**
     * Build cache key for a leaderboard slice.
     */
    private static function cacheKey(int $tenantId, string $type, string $period, int $limit, ?int $currentUserId = null): string
    {
        // currentUserId only affects the is_current_user flag, NOT the underlying
        // ranked dataset — keep it out of the cache key and apply per-call below.
        return "leaderboard:{$tenantId}:{$type}:{$period}:{$limit}";
    }

    /**
     * Invalidate ALL cached leaderboard slices for a tenant.
     * Call from XP award / transaction commit handlers.
     */
    public static function invalidate(int $tenantId): void
    {
        try {
            // Bump a per-tenant version counter — cheap and avoids needing
            // Cache::tags() (not supported on file/database stores).
            $versionKey = "leaderboard:{$tenantId}:version";
            Cache::increment($versionKey);
        } catch (\Throwable $e) {
            // Best-effort — never let cache invalidation break a write path.
            Log::warning('Leaderboard invalidate failed: ' . $e->getMessage());
        }
    }

    private static function versionedKey(int $tenantId, string $base): string
    {
        try {
            $version = (int) Cache::get("leaderboard:{$tenantId}:version", 0);
        } catch (\Throwable $e) {
            $version = 0;
        }
        return "{$base}:v{$version}";
    }

    /**
     * Get leaderboard data.
     */
    public static function getLeaderboard(int $tenantId, string $period = 'monthly', int $limit = 20): array
    {
        // Default to credits_earned for backward compatibility
        return (new self())->getLeaderboardByType($tenantId, 'credits_earned', $period, $limit);
    }

    /**
     * Get leaderboard for a specific type.
     */
    public function getLeaderboardByType(int $tenantId, string $type = 'credits_earned', string $period = 'all_time', int $limit = 10, ?int $currentUserId = null): array
    {
        if (!array_key_exists($type, self::LEADERBOARD_TYPES)) {
            return [];
        }

        try {
            $cacheKey = self::versionedKey(
                $tenantId,
                self::cacheKey($tenantId, $type, $period, $limit)
            );

            $results = Cache::remember($cacheKey, self::CACHE_TTL_SECONDS, function () use ($type, $period, $tenantId, $limit) {
                $query = $this->buildLeaderboardQuery($type, $period, $tenantId, $limit);
                if (!$query) {
                    return [];
                }
                $rows = DB::select($query['sql'], $query['params']);
                $rows = array_map(fn ($r) => (array) $r, $rows);
                $rank = 1;
                foreach ($rows as &$row) {
                    $row['rank'] = $rank++;
                }
                return $rows;
            });

            // Apply per-request is_current_user flag AFTER cache fetch
            // so the cached payload is shareable across users.
            foreach ($results as &$row) {
                $row['is_current_user'] = ($currentUserId && (int) $row['user_id'] === (int) $currentUserId);
            }

            return $results;
        } catch (\Throwable $e) {
            Log::warning('Leaderboard Error: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Get a user's rank for a leaderboard type.
     */
    public function getUserRank(int $tenantId, int $userId): ?array
    {
        try {
            $cacheKey = self::versionedKey($tenantId, "leaderboard:{$tenantId}:userrank:{$userId}");

            return Cache::remember($cacheKey, self::CACHE_TTL_SECONDS, function () use ($tenantId, $userId) {
                $user = DB::table('users')
                    ->where('id', $userId)
                    ->where('tenant_id', $tenantId)
                    ->select('id as user_id', 'name', 'first_name', 'last_name', 'profile_type', 'organization_name', 'avatar_url', DB::raw('COALESCE(xp, 0) as score'))
                    ->first();

                if (!$user) {
                    return null;
                }

                $user = (array) $user;

                $rank = (int) DB::table('users')
                    ->where('tenant_id', $tenantId)
                    ->where('is_approved', 1)
                    ->where(DB::raw('COALESCE(xp, 0)'), '>', $user['score'])
                    ->count() + 1;

                $user['rank'] = $rank;
                return $user;
            });
        } catch (\Throwable $e) {
            Log::warning('User Rank Error: ' . $e->getMessage());
            return null;
        }
    }

    /**
     * Get top members by XP.
     */
    public function getTopMembers(int $tenantId, int $limit = 10): array
    {
        return $this->getLeaderboardByType($tenantId, 'xp', 'all_time', $limit);
    }

    /**
     * Format a numeric score for display based on leaderboard type.
     */
    public function formatScore($score, string $type): string
    {
        switch ($type) {
            case 'credits_earned':
            case 'credits_spent':
                return number_format($score) . ' credits';
            case 'vol_hours':
                return number_format($score, 1) . ' hours';
            case 'badges':
                return number_format($score) . ' badges';
            case 'xp':
                return number_format($score) . ' XP';
            case 'connections':
                return number_format($score) . ' connections';
            case 'reviews':
                return number_format($score) . ' reviews';
            case 'posts':
                return number_format($score) . ' posts';
            case 'streak':
                return number_format($score) . ' days';
            default:
                return number_format($score);
        }
    }

    /**
     * Get medal icon for rank position.
     */
    public function getMedalIcon(int $rank): string
    {
        return match ($rank) {
            1 => "\xF0\x9F\xA5\x87",
            2 => "\xF0\x9F\xA5\x88",
            3 => "\xF0\x9F\xA5\x89",
            default => '',
        };
    }

    // ─── Private helpers ─────────────────────────────────────────────

    /**
     * Real member exchanges only — mirrors GamificationService::realExchangesOnly().
     * System grants (starting balance, admin grants, legacy '[Welcome Bonus]'
     * self-transfers) must not score on the credit leaderboards, otherwise
     * every new member ranks from their signup credits.
     */
    private const REAL_EXCHANGE_SQL = "AND t.sender_id > 0 AND t.sender_id <> t.receiver_id
                              AND t.transaction_type NOT IN ('starting_balance', 'admin_grant')
                              AND (t.description IS NULL OR t.description NOT LIKE '[Welcome Bonus]%')";

    private function buildLeaderboardQuery(string $type, string $period, int $tenantId, int $limit): ?array
    {
        $dateFilter = $this->getDateFilter($period);
        $limit = (int) $limit;

        switch ($type) {
            case 'credits_earned':
                $dateFilterWithTable = str_replace('AND created_at', 'AND t.created_at', $dateFilter);
                return [
                    'sql' => "SELECT u.id as user_id, u.name, u.first_name, u.last_name, u.avatar_url,
                              COALESCE(SUM(t.amount), 0) as score
                              FROM users u
                              LEFT JOIN transactions t ON u.id = t.receiver_id AND t.deleted_for_receiver = 0 " . self::REAL_EXCHANGE_SQL . " {$dateFilterWithTable}
                              WHERE u.tenant_id = ? AND u.is_approved = 1 AND COALESCE(u.show_on_leaderboard, 1) = 1
                              GROUP BY u.id
                              HAVING score > 0
                              ORDER BY score DESC
                              LIMIT {$limit}",
                    'params' => [$tenantId],
                ];

            case 'credits_spent':
                $dateFilterWithTable = str_replace('AND created_at', 'AND t.created_at', $dateFilter);
                return [
                    'sql' => "SELECT u.id as user_id, u.name, u.first_name, u.last_name, u.avatar_url,
                              COALESCE(SUM(t.amount), 0) as score
                              FROM users u
                              LEFT JOIN transactions t ON u.id = t.sender_id AND t.deleted_for_sender = 0 " . self::REAL_EXCHANGE_SQL . " {$dateFilterWithTable}
                              WHERE u.tenant_id = ? AND u.is_approved = 1 AND COALESCE(u.show_on_leaderboard, 1) = 1
                              GROUP BY u.id
                              HAVING score > 0
                              ORDER BY score DESC
                              LIMIT {$limit}",
                    'params' => [$tenantId],
                ];

            case 'vol_hours':
                $dateFilterWithTable = str_replace('AND created_at', 'AND v.created_at', $dateFilter);
                return [
                    'sql' => "SELECT u.id as user_id, u.name, u.first_name, u.last_name, u.avatar_url,
                              COALESCE(SUM(v.hours), 0) as score
                              FROM users u
                              LEFT JOIN vol_logs v ON u.id = v.user_id AND v.status = 'approved' {$dateFilterWithTable}
                              WHERE u.tenant_id = ? AND u.is_approved = 1 AND COALESCE(u.show_on_leaderboard, 1) = 1
                              GROUP BY u.id
                              HAVING score > 0
                              ORDER BY score DESC
                              LIMIT {$limit}",
                    'params' => [$tenantId],
                ];

            case 'badges':
                $dateFilterWithTable = str_replace('AND created_at', 'AND ub.awarded_at', $dateFilter);
                return [
                    'sql' => "SELECT u.id as user_id, u.name, u.first_name, u.last_name, u.avatar_url,
                              COUNT(ub.id) as score
                              FROM users u
                              LEFT JOIN user_badges ub ON u.id = ub.user_id {$dateFilterWithTable}
                              WHERE u.tenant_id = ? AND u.is_approved = 1 AND COALESCE(u.show_on_leaderboard, 1) = 1
                              GROUP BY u.id
                              HAVING score > 0
                              ORDER BY score DESC
                              LIMIT {$limit}",
                    'params' => [$tenantId],
                ];

            case 'xp':
                return [
                    'sql' => "SELECT u.id as user_id, u.name, u.first_name, u.last_name, u.avatar_url,
                              COALESCE(u.xp, 0) as score, COALESCE(u.level, 1) as level
                              FROM users u
                              WHERE u.tenant_id = ? AND u.is_approved = 1 AND COALESCE(u.show_on_leaderboard, 1) = 1
                              AND COALESCE(u.xp, 0) > 0
                              ORDER BY score DESC
                              LIMIT {$limit}",
                    'params' => [$tenantId],
                ];

            case 'connections':
                $dateFilterWithTable = str_replace('AND created_at', 'AND c.created_at', $dateFilter);
                return [
                    'sql' => "SELECT u.id as user_id, u.name, u.first_name, u.last_name, u.avatar_url,
                              COUNT(DISTINCT c.id) as score
                              FROM users u
                              LEFT JOIN connections c ON (u.id = c.requester_id OR u.id = c.receiver_id) AND c.status = 'accepted' {$dateFilterWithTable}
                              WHERE u.tenant_id = ? AND u.is_approved = 1 AND COALESCE(u.show_on_leaderboard, 1) = 1
                              GROUP BY u.id
                              HAVING score > 0
                              ORDER BY score DESC
                              LIMIT {$limit}",
                    'params' => [$tenantId],
                ];

            case 'reviews':
                $dateFilterWithTable = str_replace('AND created_at', 'AND r.created_at', $dateFilter);
                return [
                    'sql' => "SELECT u.id as user_id, u.name, u.first_name, u.last_name, u.avatar_url,
                              COUNT(r.id) as score
                              FROM users u
                              LEFT JOIN reviews r ON u.id = r.reviewer_id {$dateFilterWithTable}
                              WHERE u.tenant_id = ? AND u.is_approved = 1 AND COALESCE(u.show_on_leaderboard, 1) = 1
                              GROUP BY u.id
                              HAVING score > 0
                              ORDER BY score DESC
                              LIMIT {$limit}",
                    'params' => [$tenantId],
                ];

            case 'posts':
                $dateFilterWithTable = str_replace('AND created_at', 'AND fp.created_at', $dateFilter);
                return [
                    'sql' => "SELECT u.id as user_id, u.name, u.first_name, u.last_name, u.avatar_url,
                              COUNT(fp.id) as score
                              FROM users u
                              LEFT JOIN feed_posts fp ON u.id = fp.user_id {$dateFilterWithTable}
                              WHERE u.tenant_id = ? AND u.is_approved = 1 AND COALESCE(u.show_on_leaderboard, 1) = 1
                              GROUP BY u.id
                              HAVING score > 0
                              ORDER BY score DESC
                              LIMIT {$limit}",
                    'params' => [$tenantId],
                ];

            case 'streak':
                return [
                    'sql' => "SELECT u.id as user_id, u.name, u.first_name, u.last_name, u.avatar_url,
                              COALESCE(us.current_streak, 0) as score, COALESCE(us.longest_streak, 0) as longest
                              FROM users u
                              LEFT JOIN user_streaks us ON u.id = us.user_id AND us.streak_type = 'login'
                              WHERE u.tenant_id = ? AND u.is_approved = 1 AND COALESCE(u.show_on_leaderboard, 1) = 1
                              AND COALESCE(us.current_streak, 0) > 0
                              ORDER BY score DESC, longest DESC
                              LIMIT {$limit}",
                    'params' => [$tenantId],
                ];

            default:
                return null;
        }
    }

    private function getDateFilter(string $period): string
    {
        return match ($period) {
            'weekly' => "AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)",
            'monthly' => "AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)",
            default => "",
        };
    }
}
