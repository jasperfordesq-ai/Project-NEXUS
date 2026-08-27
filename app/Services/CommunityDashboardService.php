<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Models\Connection;
use App\Models\FeedPost;
use App\Models\Listing;
use App\Models\Review;
use App\Models\Transaction;
use App\Models\User;
use App\Models\UserBadge;
use App\Models\VolLog;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * CommunityDashboardService — community impact stats, personal journey, member spotlight.
 *
 * Uses ALL available data sources: users.xp, user_badges, vol_logs, listings,
 * connections, reviews, feed_posts, AND transactions (when available).
 */
class CommunityDashboardService
{
    /**
     * Get aggregate community impact stats for the current tenant.
     */
    public static function getCommunityImpact(?int $tenantId = null): array
    {
        $tenantId = $tenantId ?? TenantContext::getId();

        $thisMonthStart = now()->startOfMonth();
        $lastMonthStart = now()->subMonth()->startOfMonth();
        $lastMonthEnd = now()->subMonth()->endOfMonth();

        try {
            $currentMonth = self::getMonthStats($tenantId, $thisMonthStart, now());
            $lastMonth = self::getMonthStats($tenantId, $lastMonthStart, $lastMonthEnd);

            // All-time aggregate stats from all data sources
            $totalMembers = (int) User::where('tenant_id', $tenantId)
                ->where('is_approved', true)->count();

            $totalXP = (int) User::where('tenant_id', $tenantId)->sum('xp');

            $totalBadges = (int) UserBadge::where('tenant_id', $tenantId)->count();

            $totalVolunteerHours = (float) VolLog::where('tenant_id', $tenantId)
                ->where('status', 'approved')->sum('hours');

            $totalListings = (int) Listing::where('tenant_id', $tenantId)->count();

            $totalConnections = (int) Connection::where('tenant_id', $tenantId)
                ->where('status', 'accepted')->count();

            // Transactions may be sparse — include but don't rely on them
            $totalExchanges = (int) Transaction::where('tenant_id', $tenantId)
                ->where('status', 'completed')->count();

            $totalReviews = (int) Review::where('tenant_id', $tenantId)->count();

            return [
                'total_members' => $totalMembers,
                'total_xp' => $totalXP,
                'total_badges_awarded' => $totalBadges,
                'total_volunteer_hours' => round($totalVolunteerHours, 1),
                'total_listings' => $totalListings,
                'total_connections' => $totalConnections,
                'total_exchanges' => $totalExchanges,
                'total_reviews' => $totalReviews,
                'this_month' => $currentMonth,
                'last_month' => $lastMonth,
                'trends' => self::calculateTrends($currentMonth, $lastMonth),
            ];
        } catch (\Throwable $e) {
            Log::error('CommunityDashboardService::getCommunityImpact failed: ' . $e->getMessage());
            return [
                'total_members' => 0, 'total_xp' => 0, 'total_badges_awarded' => 0,
                'total_volunteer_hours' => 0, 'total_listings' => 0,
                'total_connections' => 0, 'total_exchanges' => 0, 'total_reviews' => 0,
                'this_month' => [], 'last_month' => [], 'trends' => [],
            ];
        }
    }

    /**
     * Get personal journey data for a specific user.
     */
    public static function getPersonalJourney(?int $tenantId = null, ?int $userId = null): array
    {
        $tenantId = $tenantId ?? TenantContext::getId();

        if (! $userId) {
            return [];
        }

        try {
            return [
                'monthly_activity' => self::getMonthlyActivityTimeline($tenantId, $userId),
                'badge_progression' => self::getBadgeProgression($userId),
                'milestones' => self::getPersonalMilestones($tenantId, $userId),
                'summary' => self::getPersonalSummary($tenantId, $userId),
            ];
        } catch (\Throwable $e) {
            Log::error('CommunityDashboardService::getPersonalJourney failed: ' . $e->getMessage());
            return [
                'monthly_activity' => [], 'badge_progression' => [],
                'milestones' => [], 'summary' => [],
            ];
        }
    }

    /**
     * Get randomly spotlighted active members — daily rotation.
     * Uses XP, badges, and activity to find active members (not just transactions).
     */
    public static function getMemberSpotlight(?int $tenantId = null, int $limit = 3): array
    {
        $tenantId = $tenantId ?? TenantContext::getId();

        try {
            // Find members with real activity: XP > 0 OR badges earned recently OR vol hours
            $activeUsers = User::where('tenant_id', $tenantId)
                ->where('is_approved', true)
                ->where(function ($q) {
                    $q->where('xp', '>', 0)
                      ->orWhereExists(function ($sub) {
                          $sub->select(DB::raw(1))
                              ->from('user_badges')
                              ->whereColumn('user_badges.user_id', 'users.id');
                      });
                })
                ->orderByRaw('RAND(' . ((int) now()->format('Ymd')) . ')')
                ->limit($limit)
                ->get(['id', 'first_name', 'last_name', 'profile_type', 'organization_name', 'avatar_url', 'bio', 'xp', 'level', 'created_at']);

            if ($activeUsers->isEmpty()) {
                return [];
            }

            return $activeUsers->map(function ($user) {
                $badgeCount = (int) UserBadge::where('user_id', $user->id)->count();
                $activity = $badgeCount > 0
                    ? "Earned {$badgeCount} " . ($badgeCount === 1 ? 'badge' : 'badges')
                    : 'Active community member';

                return [
                    'id' => $user->id,
                    'first_name' => $user->first_name,
                    'last_name' => $user->last_name,
                    'avatar_url' => $user->avatar_url,
                    'bio' => $user->bio ? mb_substr($user->bio, 0, 120) : null,
                    'member_since' => $user->created_at?->format('M Y'),
                    'level' => (int) ($user->level ?? 1),
                    'xp' => (int) ($user->xp ?? 0),
                    'recent_activity' => $activity,
                ];
            })->values()->toArray();
        } catch (\Throwable $e) {
            Log::error('CommunityDashboardService::getMemberSpotlight failed: ' . $e->getMessage());
            return [];
        }
    }

    // =========================================================================
    // PRIVATE HELPERS
    // =========================================================================

    /**
     * Get stats for a specific date range — uses ALL data sources.
     */
    private static function getMonthStats(int $tenantId, $start, $end): array
    {
        $newMembers = (int) User::where('tenant_id', $tenantId)
            ->where('is_approved', true)
            ->whereBetween('created_at', [$start, $end])->count();

        $badgesAwarded = (int) UserBadge::where('tenant_id', $tenantId)
            ->whereBetween('awarded_at', [$start, $end])->count();

        $newListings = (int) Listing::where('tenant_id', $tenantId)
            ->whereBetween('created_at', [$start, $end])->count();

        $newConnections = (int) Connection::where('tenant_id', $tenantId)
            ->where('status', 'accepted')
            ->whereBetween('created_at', [$start, $end])->count();

        $volHours = round((float) VolLog::where('tenant_id', $tenantId)
            ->where('status', 'approved')
            ->whereBetween('created_at', [$start, $end])->sum('hours'), 1);

        $newPosts = (int) FeedPost::where('tenant_id', $tenantId)
            ->whereBetween('created_at', [$start, $end])->count();

        return [
            'new_members' => $newMembers,
            'badges_awarded' => $badgesAwarded,
            'new_listings' => $newListings,
            'new_connections' => $newConnections,
            'volunteer_hours' => $volHours,
            'new_posts' => $newPosts,
        ];
    }

    private static function calculateTrends(array $current, array $last): array
    {
        $trends = [];
        foreach ($current as $key => $value) {
            $prev = $last[$key] ?? 0;
            if ($prev > 0) {
                $trends[$key] = round((($value - $prev) / $prev) * 100, 1);
            } else {
                $trends[$key] = $value > 0 ? 100.0 : 0.0;
            }
        }
        return $trends;
    }

    /**
     * Monthly activity timeline — badges, listings, vol hours, posts per month.
     */
    private static function getMonthlyActivityTimeline(int $tenantId, int $userId): array
    {
        $startDate = now()->subMonths(11)->startOfMonth();

        // Badges earned per month
        $badgeData = collect(DB::select("
            SELECT DATE_FORMAT(awarded_at, '%Y-%m') AS ym, COUNT(*) AS cnt
            FROM user_badges WHERE tenant_id = ? AND user_id = ? AND awarded_at >= ?
            GROUP BY ym
        ", [$tenantId, $userId, $startDate]))->keyBy('ym');

        // XP log per month
        $xpData = collect(DB::select("
            SELECT DATE_FORMAT(created_at, '%Y-%m') AS ym, SUM(xp_amount) AS xp
            FROM user_xp_log WHERE tenant_id = ? AND user_id = ? AND created_at >= ?
            GROUP BY ym
        ", [$tenantId, $userId, $startDate]))->keyBy('ym');

        $timeline = [];
        for ($i = 11; $i >= 0; $i--) {
            $date = now()->subMonths($i)->startOfMonth();
            $ym = $date->format('Y-m');

            $timeline[] = [
                'month' => $date->format('M Y'),
                'badges' => (int) ($badgeData->get($ym)?->cnt ?? 0),
                'xp_earned' => (int) ($xpData->get($ym)?->xp ?? 0),
            ];
        }

        return $timeline;
    }

    private static function getBadgeProgression(int $userId): array
    {
        return UserBadge::where('user_id', $userId)
            ->orderBy('awarded_at')
            ->get(['badge_key', 'name', 'icon', 'awarded_at'])
            ->map(fn ($b) => [
                'badge_key' => $b->badge_key,
                'name' => $b->name,
                'icon' => $b->icon,
                'earned_at' => $b->awarded_at?->format('Y-m-d'),
            ])->toArray();
    }

    private static function getPersonalMilestones(int $tenantId, int $userId): array
    {
        $milestones = [];

        // First badge
        $firstBadge = UserBadge::where('user_id', $userId)
            ->orderBy('awarded_at')->first(['name', 'icon', 'awarded_at']);
        if ($firstBadge) {
            $milestones[] = [
                'type' => 'first_badge',
                'label' => "Earned \"{$firstBadge->name}\" {$firstBadge->icon}",
                'date' => $firstBadge->awarded_at?->format('M d, Y'),
            ];
        }

        // Badge count milestones
        $badgeCount = (int) UserBadge::where('user_id', $userId)->count();
        foreach ([5, 10, 25, 50, 100] as $m) {
            if ($badgeCount >= $m) {
                $milestones[] = ['type' => 'badge_milestone', 'label' => "{$m} badges earned", 'date' => null];
            }
        }

        // XP milestones
        $xp = (int) (User::where('id', $userId)->value('xp') ?? 0);
        foreach ([100, 500, 1000, 5000, 10000, 50000] as $m) {
            if ($xp >= $m) {
                $milestones[] = ['type' => 'xp_milestone', 'label' => number_format($m) . ' XP reached', 'date' => null];
            }
        }

        // First listing
        $firstListing = Listing::where('tenant_id', $tenantId)
            ->where('user_id', $userId)->orderBy('created_at')->first(['created_at']);
        if ($firstListing) {
            $milestones[] = [
                'type' => 'first_listing',
                'label' => 'First listing posted',
                'date' => $firstListing->created_at?->format('M d, Y'),
            ];
        }

        // Volunteer hours
        $volHours = (float) VolLog::where('tenant_id', $tenantId)
            ->where('user_id', $userId)->where('status', 'approved')->sum('hours');
        if ($volHours > 0) {
            $milestones[] = [
                'type' => 'volunteer',
                'label' => round($volHours, 1) . ' volunteer hours logged',
                'date' => null,
            ];
        }

        return $milestones;
    }

    private static function getPersonalSummary(int $tenantId, int $userId): array
    {
        $user = User::find($userId, ['xp', 'level', 'created_at']);

        return [
            'xp' => (int) ($user->xp ?? 0),
            'level' => (int) ($user->level ?? 1),
            'level_name' => GamificationService::getLevelName((int) ($user->level ?? 1)),
            'total_badges' => (int) UserBadge::where('user_id', $userId)->count(),
            'total_listings' => (int) Listing::where('tenant_id', $tenantId)
                ->where('user_id', $userId)->count(),
            'volunteer_hours' => round((float) VolLog::where('tenant_id', $tenantId)
                ->where('user_id', $userId)->where('status', 'approved')->sum('hours'), 1),
            'total_connections' => (int) Connection::where('tenant_id', $tenantId)
                ->where('status', 'accepted')
                ->where(function ($q) use ($userId) {
                    $q->where('requester_id', $userId)->orWhere('receiver_id', $userId);
                })->count(),
            'total_reviews' => (int) Review::where('tenant_id', $tenantId)
                ->where('reviewer_id', $userId)->count(),
            'member_since' => $user?->created_at?->format('M Y'),
        ];
    }
}
