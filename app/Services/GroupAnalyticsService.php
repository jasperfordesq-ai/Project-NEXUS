<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use Illuminate\Support\Facades\DB;
use App\Core\TenantContext;

/**
 * GroupAnalyticsService — Comprehensive analytics and reporting for groups.
 *
 * Provides member growth, engagement metrics, top contributors,
 * content performance, retention/churn, and comparative analytics.
 */
class GroupAnalyticsService
{
    public const MIN_DAYS = 1;
    public const MAX_DAYS = 365;
    public const MIN_MONTHS = 1;
    public const MAX_MONTHS = 24;
    public const MIN_LIMIT = 1;
    public const MAX_LIMIT = 100;

    /**
     * Get comprehensive analytics dashboard for a group.
     */
    public static function getDashboard(int $groupId, int $days = 30): array
    {
        $days = self::boundedDays($days);
        $engagement = self::getEngagementMetrics($groupId, $days);
        $overview = self::getOverview($groupId);

        return [
            'overview' => $overview,
            'kpi' => [
                'total_members' => (int) ($overview['total_members'] ?? 0),
                'active_members' => (int) ($engagement['summary']['active_members'] ?? 0),
                'participation_rate' => (float) ($engagement['summary']['participation_rate'] ?? 0),
                'avg_posts_per_day' => (float) ($engagement['summary']['avg_posts_per_day'] ?? 0),
            ],
            'member_growth' => self::getMemberGrowth($groupId, $days),
            'engagement' => $engagement,
            'top_contributors' => self::getTopContributors($groupId, $days),
            'content_performance' => self::getContentPerformance($groupId, $days),
            'activity_breakdown' => self::getActivityBreakdown($groupId, $days),
            'retention' => self::getRetentionMetrics($groupId, min(6, self::MAX_MONTHS)),
            'comparative' => self::getComparativeAnalytics($groupId),
        ];
    }

    /**
     * Group overview stats.
     */
    public static function getOverview(int $groupId): array
    {
        $tenantId = TenantContext::getId();

        $group = DB::table('groups')
            ->where('id', $groupId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$group) {
            return [];
        }

        $totalMembers = DB::table('group_members')
            ->where('group_id', $groupId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->count();

        $totalDiscussions = DB::table('group_discussions')
            ->where('group_id', $groupId)
            ->where('tenant_id', $tenantId)
            ->count();

        $totalPosts = DB::table('group_posts as gp')
            ->join('group_discussions as gd', 'gp.discussion_id', '=', 'gd.id')
            ->where('gd.group_id', $groupId)
            ->where('gp.tenant_id', $tenantId)
            ->count();

        $totalEvents = DB::table('events')
            ->where('group_id', $groupId)
            ->where('tenant_id', $tenantId)
            ->count();

        $totalFiles = DB::table('group_files')
            ->where('group_id', $groupId)
            ->where('tenant_id', $tenantId)
            ->count();

        $pendingRequests = DB::table('group_members')
            ->where('group_id', $groupId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'pending')
            ->count();

        return [
            'total_members' => $totalMembers,
            'total_discussions' => $totalDiscussions,
            'total_posts' => $totalPosts,
            'total_events' => $totalEvents,
            'total_files' => $totalFiles,
            'pending_requests' => $pendingRequests,
            'created_at' => $group->created_at,
            'visibility' => $group->visibility,
        ];
    }

    /**
     * Member growth over time (daily counts).
     */
    public static function getMemberGrowth(int $groupId, int $days = 30): array
    {
        $days = self::boundedDays($days);
        $tenantId = TenantContext::getId();
        $since = self::periodStart($days);

        $joins = DB::table('group_members')
            ->where('group_id', $groupId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->where('created_at', '>=', $since)
            ->selectRaw('DATE(created_at) as date, COUNT(*) as count')
            ->groupByRaw('DATE(created_at)')
            ->orderBy('date')
            ->get()
            ->keyBy('date');

        // Build complete date series
        $result = [];
        $current = $since->copy();
        $cumulative = DB::table('group_members')
            ->where('group_id', $groupId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->where('created_at', '<', $since)
            ->count();

        while ($current->lte(now())) {
            $dateStr = $current->format('Y-m-d');
            $dayJoins = $joins->has($dateStr) ? (int) $joins[$dateStr]->count : 0;
            $cumulative += $dayJoins;

            $result[] = [
                'date' => $dateStr,
                'new_members' => $dayJoins,
                'total_members' => $cumulative,
            ];

            $current->addDay();
        }

        return $result;
    }

    /**
     * Engagement metrics (posts, replies, active members over time).
     */
    public static function getEngagementMetrics(int $groupId, int $days = 30): array
    {
        $days = self::boundedDays($days);
        $tenantId = TenantContext::getId();
        $since = self::periodStart($days);

        // Discussion posts per day
        $postsPerDay = DB::table('group_posts as gp')
            ->join('group_discussions as gd', 'gp.discussion_id', '=', 'gd.id')
            ->where('gd.group_id', $groupId)
            ->where('gp.tenant_id', $tenantId)
            ->where('gp.created_at', '>=', $since)
            ->selectRaw('DATE(gp.created_at) as date, COUNT(*) as count')
            ->groupByRaw('DATE(gp.created_at)')
            ->get()
            ->keyBy('date');

        // Active members per day (posted or created discussion)
        $activeMembersPerDay = DB::table('group_posts as gp')
            ->join('group_discussions as gd', 'gp.discussion_id', '=', 'gd.id')
            ->where('gd.group_id', $groupId)
            ->where('gp.tenant_id', $tenantId)
            ->where('gp.created_at', '>=', $since)
            ->selectRaw('DATE(gp.created_at) as date, COUNT(DISTINCT gp.user_id) as count')
            ->groupByRaw('DATE(gp.created_at)')
            ->get()
            ->keyBy('date');

        // New discussions per day
        $discussionsPerDay = DB::table('group_discussions')
            ->where('group_id', $groupId)
            ->where('tenant_id', $tenantId)
            ->where('created_at', '>=', $since)
            ->selectRaw('DATE(created_at) as date, COUNT(*) as count')
            ->groupByRaw('DATE(created_at)')
            ->get()
            ->keyBy('date');

        // Build timeline
        $result = [];
        $current = $since->copy();
        while ($current->lte(now())) {
            $dateStr = $current->format('Y-m-d');
            $result[] = [
                'date' => $dateStr,
                'posts' => $postsPerDay->has($dateStr) ? (int) $postsPerDay[$dateStr]->count : 0,
                'discussions' => $discussionsPerDay->has($dateStr) ? (int) $discussionsPerDay[$dateStr]->count : 0,
                'active_members' => $activeMembersPerDay->has($dateStr) ? (int) $activeMembersPerDay[$dateStr]->count : 0,
            ];
            $current->addDay();
        }

        // Summary
        $totalMembers = DB::table('group_members')
            ->where('group_id', $groupId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->count();

        $uniqueActive = DB::table('group_posts as gp')
            ->join('group_discussions as gd', 'gp.discussion_id', '=', 'gd.id')
            ->where('gd.group_id', $groupId)
            ->where('gp.tenant_id', $tenantId)
            ->where('gp.created_at', '>=', $since)
            ->distinct('gp.user_id')
            ->count('gp.user_id');

        return [
            'timeline' => $result,
            'summary' => [
                'total_members' => $totalMembers,
                'active_members' => $uniqueActive,
                'participation_rate' => $totalMembers > 0 ? round(($uniqueActive / $totalMembers) * 100, 1) : 0,
                'avg_posts_per_day' => round(array_sum(array_column($result, 'posts')) / max(1, count($result)), 1),
            ],
        ];
    }

    /**
     * Top contributors (by posts, discussions, events).
     */
    public static function getTopContributors(int $groupId, int $days = 30, int $limit = 10): array
    {
        $days = self::boundedDays($days);
        $limit = self::boundedLimit($limit);
        $tenantId = TenantContext::getId();
        $since = self::periodStart($days);

        return DB::table('group_posts as gp')
            ->join('group_discussions as gd', 'gp.discussion_id', '=', 'gd.id')
            ->join('users as u', 'gp.user_id', '=', 'u.id')
            ->where('gd.group_id', $groupId)
            ->where('gp.tenant_id', $tenantId)
            ->where('gp.created_at', '>=', $since)
            ->selectRaw('gp.user_id, u.name, u.avatar_url, COUNT(*) as post_count')
            ->groupBy('gp.user_id', 'u.name', 'u.avatar_url')
            ->orderByDesc('post_count')
            ->limit($limit)
            ->get()
            ->map(fn ($row) => (array) $row)
            ->toArray();
    }

    /**
     * Content performance — most active discussions.
     */
    public static function getContentPerformance(int $groupId, int $days = 30, int $limit = 10): array
    {
        $days = self::boundedDays($days);
        $limit = self::boundedLimit($limit);
        $tenantId = TenantContext::getId();
        $since = self::periodStart($days);

        return DB::table('group_discussions as gd')
            ->leftJoin('group_posts as gp', 'gd.id', '=', 'gp.discussion_id')
            ->join('users as u', 'gd.user_id', '=', 'u.id')
            ->where('gd.group_id', $groupId)
            ->where('gd.tenant_id', $tenantId)
            ->where('gd.created_at', '>=', $since)
            ->selectRaw('gd.id, gd.title, gd.created_at, u.name as author_name, COUNT(gp.id) as reply_count, COUNT(DISTINCT gp.user_id) as unique_participants')
            ->groupBy('gd.id', 'gd.title', 'gd.created_at', 'u.name')
            ->orderByDesc('reply_count')
            ->limit($limit)
            ->get()
            ->map(fn ($row) => (array) $row)
            ->toArray();
    }

    /**
     * Activity breakdown by type.
     */
    public static function getActivityBreakdown(int $groupId, int $days = 30): array
    {
        $days = self::boundedDays($days);
        $tenantId = TenantContext::getId();
        $since = self::periodStart($days);

        $discussions = DB::table('group_discussions')
            ->where('group_id', $groupId)
            ->where('tenant_id', $tenantId)
            ->where('created_at', '>=', $since)
            ->count();

        $posts = DB::table('group_posts as gp')
            ->join('group_discussions as gd', 'gp.discussion_id', '=', 'gd.id')
            ->where('gd.group_id', $groupId)
            ->where('gp.tenant_id', $tenantId)
            ->where('gp.created_at', '>=', $since)
            ->count();

        $events = DB::table('events')
            ->where('group_id', $groupId)
            ->where('tenant_id', $tenantId)
            ->where('created_at', '>=', $since)
            ->count();

        $files = DB::table('group_files')
            ->where('group_id', $groupId)
            ->where('tenant_id', $tenantId)
            ->where('created_at', '>=', $since)
            ->count();

        $memberJoins = DB::table('group_members')
            ->where('group_id', $groupId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->where('created_at', '>=', $since)
            ->count();

        return [
            ['type' => 'discussions', 'count' => $discussions],
            ['type' => 'posts', 'count' => $posts],
            ['type' => 'events', 'count' => $events],
            ['type' => 'files', 'count' => $files],
            ['type' => 'member_joins', 'count' => $memberJoins],
        ];
    }

    /**
     * Retention metrics — cohort analysis.
     */
    public static function getRetentionMetrics(int $groupId, int $months = 6): array
    {
        $months = max(self::MIN_MONTHS, min($months, self::MAX_MONTHS));
        $tenantId = TenantContext::getId();
        $firstMonth = now()->subMonths($months - 1)->startOfMonth();

        // Two fixed queries regardless of the number of requested cohorts:
        // one for current active memberships and one for recently active users.
        $memberships = DB::table('group_members')
            ->where('group_id', $groupId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->where('created_at', '>=', $firstMonth)
            ->select('user_id', 'created_at')
            ->get();

        $recentlyActive = DB::table('group_posts as gp')
            ->join('group_discussions as gd', 'gp.discussion_id', '=', 'gd.id')
            ->where('gd.group_id', $groupId)
            ->where('gd.tenant_id', $tenantId)
            ->where('gp.tenant_id', $tenantId)
            ->where('gp.created_at', '>=', now()->subDays(30))
            ->distinct()
            ->pluck('gp.user_id')
            ->map(static fn (mixed $id): int => (int) $id)
            ->flip();

        $cohortCounts = [];
        foreach ($memberships as $membership) {
            $month = \Illuminate\Support\Carbon::parse($membership->created_at)->format('Y-m');
            $cohortCounts[$month] ??= ['joined' => 0, 'still_active' => 0];
            $cohortCounts[$month]['joined']++;
            if ($recentlyActive->has((int) $membership->user_id)) {
                $cohortCounts[$month]['still_active']++;
            }
        }

        $cohorts = [];
        for ($i = $months - 1; $i >= 0; $i--) {
            $month = now()->subMonths($i)->format('Y-m');
            $joined = (int) ($cohortCounts[$month]['joined'] ?? 0);
            $stillActive = (int) ($cohortCounts[$month]['still_active'] ?? 0);
            $rate = $joined > 0 ? round(($stillActive / $joined) * 100, 1) : 0.0;

            $cohorts[] = [
                'month' => $month,
                'joined' => $joined,
                'still_active' => $stillActive,
                'retention_rate' => $rate,
                'retention_pct' => $rate,
            ];
        }

        return $cohorts;
    }

    /**
     * Comparative analytics — rank group against others in tenant.
     */
    public static function getComparativeAnalytics(int $groupId): array
    {
        $tenantId = TenantContext::getId();

        $group = DB::table('groups')
            ->where('id', $groupId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$group) {
            return [];
        }

        $allGroups = DB::table('groups')
            ->where('tenant_id', $tenantId)
            ->where('status', \App\Enums\GroupStatus::Active->value)
            ->select('id', 'cached_member_count')
            ->get();

        $totalGroups = $allGroups->count();
        $memberCounts = $allGroups->pluck('cached_member_count')->sort()->values()->toArray();
        $groupIds = $allGroups->pluck('id')->map(static fn (mixed $id): int => (int) $id)->all();

        // Calculate percentile
        $groupMembers = (int) $group->cached_member_count;
        $belowCount = count(array_filter($memberCounts, fn ($c) => $c < $groupMembers));
        $percentile = $totalGroups > 0 ? round(($belowCount / $totalGroups) * 100) : 0;

        // Average stats
        $avgMembers = $totalGroups > 0 ? round(array_sum($memberCounts) / $totalGroups) : 0;

        $activityCounts = array_fill_keys($groupIds, 0);
        if ($groupIds !== []) {
            $since = self::periodStart(30);
            $discussionCounts = DB::table('group_discussions')
                ->where('tenant_id', $tenantId)
                ->whereIn('group_id', $groupIds)
                ->where('created_at', '>=', $since)
                ->selectRaw('group_id, COUNT(*) as aggregate')
                ->groupBy('group_id')
                ->pluck('aggregate', 'group_id');
            $postCounts = DB::table('group_posts as gp')
                ->join('group_discussions as gd', 'gp.discussion_id', '=', 'gd.id')
                ->where('gp.tenant_id', $tenantId)
                ->where('gd.tenant_id', $tenantId)
                ->whereIn('gd.group_id', $groupIds)
                ->where('gp.created_at', '>=', $since)
                ->selectRaw('gd.group_id, COUNT(*) as aggregate')
                ->groupBy('gd.group_id')
                ->pluck('aggregate', 'gd.group_id');

            foreach ($groupIds as $candidateGroupId) {
                $activityCounts[$candidateGroupId] = (int) ($discussionCounts[$candidateGroupId] ?? 0)
                    + (int) ($postCounts[$candidateGroupId] ?? 0);
            }
        }

        $groupActivity = (int) ($activityCounts[$groupId] ?? 0);
        $avgActivity = $totalGroups > 0 ? round(array_sum($activityCounts) / $totalGroups, 1) : 0.0;

        return [
            'group_members' => $groupMembers,
            'your_members' => $groupMembers,
            'avg_members' => $avgMembers,
            'percentile' => $percentile,
            'percentile_rank' => $percentile,
            'total_groups' => $totalGroups,
            'rank' => $totalGroups - $belowCount,
            'your_activity' => $groupActivity,
            'avg_activity' => $avgActivity,
        ];
    }

    /**
     * Export group data as associative arrays for CSV generation.
     *
     * Any member can create a group, so a group owner/admin receives only the
     * active roster without contact details — the same data the member list
     * shows. Email and pending/banned rows are reserved for tenant admins.
     */
    public static function exportMembers(int $groupId, bool $includeContactDetails = false): array
    {
        $tenantId = TenantContext::getId();

        $columns = $includeContactDetails
            ? ['u.name', 'u.email', 'gm.role', 'gm.status', 'gm.created_at as joined_at']
            : ['u.name', 'gm.role', 'gm.status', 'gm.created_at as joined_at'];
        $statuses = $includeContactDetails
            ? ['active', 'pending', 'invited', 'banned']
            : ['active'];

        return DB::table('group_members as gm')
            ->join('users as u', 'gm.user_id', '=', 'u.id')
            ->join('groups as g', 'gm.group_id', '=', 'g.id')
            ->where('gm.group_id', $groupId)
            ->where('g.tenant_id', $tenantId)
            ->whereIn('gm.status', $statuses)
            ->select($columns)
            ->orderBy('gm.created_at')
            ->get()
            ->map(fn ($row) => (array) $row)
            ->toArray();
    }

    /**
     * Export activity data for CSV.
     */
    public static function exportActivity(int $groupId, int $days = 30): array
    {
        $days = self::boundedDays($days);
        $tenantId = TenantContext::getId();
        $since = self::periodStart($days);

        return DB::table('group_posts as gp')
            ->join('group_discussions as gd', 'gp.discussion_id', '=', 'gd.id')
            ->join('users as u', 'gp.user_id', '=', 'u.id')
            ->where('gd.group_id', $groupId)
            ->where('gp.tenant_id', $tenantId)
            ->where('gp.created_at', '>=', $since)
            ->select('gd.title as discussion_title', 'u.name as author', 'gp.content', 'gp.created_at')
            ->orderByDesc('gp.created_at')
            ->get()
            ->map(fn ($row) => (array) $row)
            ->toArray();
    }

    private static function boundedDays(int $days): int
    {
        return max(self::MIN_DAYS, min($days, self::MAX_DAYS));
    }

    private static function boundedLimit(int $limit): int
    {
        return max(self::MIN_LIMIT, min($limit, self::MAX_LIMIT));
    }

    private static function periodStart(int $days): \Illuminate\Support\Carbon
    {
        return now()->subDays(max(0, $days - 1))->startOfDay();
    }
}
