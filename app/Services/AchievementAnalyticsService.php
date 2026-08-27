<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * AchievementAnalyticsService — Eloquent/DB query builder service for gamification analytics.
 *
 * Provides overall stats, badge trends, popular/rarest badges, top earners, etc.
 * All queries are tenant-scoped via explicit where clauses.
 */
class AchievementAnalyticsService
{
    /**
     * Get overall gamification statistics.
     */
    public function getOverallStats(): array
    {
        $tenantId = TenantContext::getId();

        // Total XP earned across all users
        $xpStats = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->selectRaw('COALESCE(SUM(xp), 0) as total_xp, COALESCE(AVG(xp), 0) as avg_xp, MAX(xp) as max_xp')
            ->first();

        // Total badges earned
        $badgeStats = DB::table('user_badges as ub')
            ->join('users as u', 'ub.user_id', '=', 'u.id')
            ->where('u.tenant_id', $tenantId)
            ->selectRaw('COUNT(*) as total_badges, COUNT(DISTINCT ub.user_id) as users_with_badges')
            ->first();

        // User engagement
        $userStats = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->selectRaw("
                COUNT(*) as total_users,
                SUM(CASE WHEN xp > 0 THEN 1 ELSE 0 END) as engaged_users,
                SUM(CASE WHEN level >= 5 THEN 1 ELSE 0 END) as advanced_users
            ")
            ->first();

        // Level distribution
        $levelDist = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->select('level', DB::raw('COUNT(*) as count'))
            ->groupBy('level')
            ->orderBy('level')
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();

        return [
            'total_xp' => (int) ($xpStats->total_xp ?? 0),
            'avg_xp' => round((float) ($xpStats->avg_xp ?? 0), 1),
            'max_xp' => (int) ($xpStats->max_xp ?? 0),
            'total_badges' => (int) ($badgeStats->total_badges ?? 0),
            'users_with_badges' => (int) ($badgeStats->users_with_badges ?? 0),
            'total_users' => (int) ($userStats->total_users ?? 0),
            'engaged_users' => (int) ($userStats->engaged_users ?? 0),
            'advanced_users' => (int) ($userStats->advanced_users ?? 0),
            'engagement_rate' => $userStats->total_users > 0
                ? round(($userStats->engaged_users / $userStats->total_users) * 100, 1)
                : 0,
            'level_distribution' => $levelDist,
        ];
    }

    /**
     * Get badge earning trends over time.
     */
    public function getBadgeTrends(int $days = 30): array
    {
        $tenantId = TenantContext::getId();

        return DB::table('user_badges as ub')
            ->join('users as u', 'ub.user_id', '=', 'u.id')
            ->where('u.tenant_id', $tenantId)
            ->whereRaw('ub.awarded_at >= DATE_SUB(NOW(), INTERVAL ? DAY)', [$days])
            ->selectRaw('DATE(ub.awarded_at) as date, COUNT(*) as count')
            ->groupByRaw('DATE(ub.awarded_at)')
            ->orderBy('date')
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();
    }

    /**
     * Get most popular badges.
     */
    public function getPopularBadges(int $limit = 10): array
    {
        $tenantId = TenantContext::getId();

        $badges = DB::table('user_badges as ub')
            ->join('users as u', 'ub.user_id', '=', 'u.id')
            ->where('u.tenant_id', $tenantId)
            ->select('ub.badge_key', DB::raw('COUNT(*) as award_count'))
            ->groupBy('ub.badge_key')
            ->orderByDesc('award_count')
            ->limit($limit)
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();

        // Batch-fetch custom badge definitions to avoid N+1 queries
        $customIds = array_values(array_filter(array_map(
            fn ($b) => str_starts_with($b['badge_key'] ?? '', 'custom_')
                ? str_replace('custom_', '', $b['badge_key'])
                : null,
            $badges
        )));

        $customBadgeMap = [];
        if (!empty($customIds)) {
            $rows = DB::table('custom_badges')
                ->where('tenant_id', \App\Core\TenantContext::getId())
                ->whereIn('id', $customIds)
                ->get(['id', 'name', 'icon', 'xp']);
            foreach ($rows as $row) {
                $customBadgeMap[$row->id] = (array) $row;
            }
        }

        // Enrich with custom badge definitions from map
        foreach ($badges as &$badge) {
            if (str_starts_with($badge['badge_key'] ?? '', 'custom_')) {
                $id = str_replace('custom_', '', $badge['badge_key']);
                $custom = $customBadgeMap[$id] ?? null;
            } else {
                $custom = null;
            }

            if ($custom) {
                $badge['name'] = $custom['name'] ?? $badge['badge_key'];
                $badge['icon'] = $custom['icon'] ?? '🏆';
                $badge['xp'] = $custom['xp'] ?? 0;
            } else {
                $badge['name'] = $badge['badge_key'];
                $badge['icon'] = '🏆';
                $badge['xp'] = 0;
            }
        }

        return $badges;
    }

    /**
     * Get rarest badges (least earned).
     */
    public function getRarestBadges(int $limit = 10): array
    {
        $tenantId = TenantContext::getId();

        $totalUsers = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->count();

        $badges = DB::table('user_badges as ub')
            ->join('users as u', 'ub.user_id', '=', 'u.id')
            ->where('u.tenant_id', $tenantId)
            ->select('ub.badge_key', DB::raw('COUNT(*) as award_count'))
            ->groupBy('ub.badge_key')
            ->orderBy('award_count')
            ->limit($limit)
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();

        foreach ($badges as &$badge) {
            $badge['name'] = $badge['badge_key'];
            $badge['icon'] = '🏆';
            $badge['rarity_percent'] = $totalUsers > 0
                ? round(($badge['award_count'] / $totalUsers) * 100, 1)
                : 0;
        }

        return $badges;
    }

    /**
     * Get top XP earners.
     */
    public function getTopEarners(int $limit = 10): array
    {
        $tenantId = TenantContext::getId();

        $badgeCounts = DB::table('user_badges')
            ->where('tenant_id', $tenantId)
            ->selectRaw('user_id, COUNT(*) as badge_count')
            ->groupBy('user_id');

        return DB::table('users as u')
            ->where('u.tenant_id', $tenantId)
            ->leftJoinSub($badgeCounts, 'bc', 'bc.user_id', '=', 'u.id')
            ->select([
                'u.id', 'u.first_name', 'u.last_name', 'u.profile_type', 'u.organization_name', 'u.avatar_url', 'u.xp', 'u.level',
                DB::raw('COALESCE(bc.badge_count, 0) as badge_count'),
            ])
            ->orderByDesc('u.xp')
            ->limit($limit)
            ->get()
            ->map(fn ($r) => (array) $r)
            ->all();
    }
}
