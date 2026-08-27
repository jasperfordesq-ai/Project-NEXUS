<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * MemberReportService — Comprehensive member reporting for admin dashboards.
 *
 * Provides active member tracking, registration trends, retention analysis,
 * engagement metrics, and contributor rankings. All methods are tenant-scoped.
 */
class MemberReportService
{
    /**
     * Get active members (logged in within N days).
     */
    public function getActiveMembers(int $tenantId, int $days = 30, int $limit = 50, int $offset = 0): array
    {
        $limit = min(200, max(1, $limit));
        $offset = max(0, $offset);
        $cutoff = now()->subDays($days)->toDateTimeString();

        $total = (int) DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->where('last_login_at', '>=', $cutoff)
            ->count();

        $rows = DB::table('users as u')
            ->where('u.tenant_id', $tenantId)
            ->where('u.status', 'active')
            ->where('u.last_login_at', '>=', $cutoff)
            ->select(['u.id', 'u.first_name', 'u.last_name', 'u.profile_type', 'u.organization_name', 'u.email', 'u.last_login_at', 'u.created_at', 'u.avatar_url'])
            ->selectRaw(
                "(SELECT COUNT(*) FROM transactions t WHERE (t.sender_id = u.id OR t.receiver_id = u.id) AND t.tenant_id = ? AND t.status = 'completed') as transaction_count,
                 (SELECT COALESCE(SUM(t.amount), 0) FROM transactions t WHERE t.sender_id = u.id AND t.tenant_id = ? AND t.status = 'completed') as hours_given,
                 (SELECT COALESCE(SUM(t.amount), 0) FROM transactions t WHERE t.receiver_id = u.id AND t.tenant_id = ? AND t.status = 'completed') as hours_received",
                [$tenantId, $tenantId, $tenantId]
            )
            ->orderByDesc('u.last_login_at')
            ->limit($limit)
            ->offset($offset)
            ->get();

        $members = $rows->map(function ($row) {
            return [
                'id' => (int) $row->id,
                'name' => UserDisplayName::resolve($row),
                'email' => $row->email,
                'last_login_at' => $row->last_login_at,
                'created_at' => $row->created_at,
                'profile_image_url' => $row->avatar_url,
                'transaction_count' => (int) $row->transaction_count,
                'hours_given' => round((float) $row->hours_given, 1),
                'hours_received' => round((float) $row->hours_received, 1),
            ];
        })->all();

        return [
            'members' => $members,
            'total' => $total,
            'period_days' => $days,
        ];
    }

    /**
     * Get new registrations by period (daily, weekly, monthly).
     */
    public function getNewRegistrations(int $tenantId, string $period = 'monthly', int $months = 12): array
    {
        $from = now()->subMonths($months)->toDateTimeString();

        switch ($period) {
            case 'daily':
                $groupBy = DB::raw("DATE(created_at)");
                $selectAs = DB::raw("DATE(created_at) as period_key");
                break;
            case 'weekly':
                $groupBy = DB::raw("YEARWEEK(created_at, 1)");
                $selectAs = DB::raw("CONCAT(YEAR(created_at), '-W', LPAD(WEEK(created_at, 1), 2, '0')) as period_key");
                break;
            case 'monthly':
            default:
                $groupBy = DB::raw("DATE_FORMAT(created_at, '%Y-%m')");
                $selectAs = DB::raw("DATE_FORMAT(created_at, '%Y-%m') as period_key");
                break;
        }

        $data = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('created_at', '>=', $from)
            ->select($selectAs, DB::raw('COUNT(*) as registrations'))
            ->groupBy($groupBy)
            ->orderBy('period_key')
            ->get()
            ->map(fn ($row) => [
                'period' => $row->period_key,
                'registrations' => (int) $row->registrations,
            ])
            ->all();

        $total = (int) DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('created_at', '>=', $from)
            ->count();

        return [
            'period_type' => $period,
            'months_back' => $months,
            'total_registrations' => $total,
            'data' => $data,
        ];
    }

    /**
     * Get member retention metrics.
     *
     * Measures what percentage of members who joined N months ago
     * are still active (logged in within last 30 days).
     */
    public function getMemberRetention(int $tenantId, int $months = 12): array
    {
        $cohorts = [];
        $thirtyDaysAgo = now()->subDays(30)->toDateTimeString();

        for ($i = $months; $i >= 1; $i--) {
            $cohortStart = now()->subMonths($i)->startOfMonth()->toDateTimeString();
            $cohortEnd = now()->subMonths($i)->endOfMonth()->toDateTimeString();
            $cohortLabel = now()->subMonths($i)->format('M Y');
            $cohortMonth = now()->subMonths($i)->format('Y-m');

            $joined = (int) DB::table('users')
                ->where('tenant_id', $tenantId)
                ->whereBetween('created_at', [$cohortStart, $cohortEnd])
                ->count();

            $retained = (int) DB::table('users')
                ->where('tenant_id', $tenantId)
                ->whereBetween('created_at', [$cohortStart, $cohortEnd])
                ->where('last_login_at', '>=', $thirtyDaysAgo)
                ->where('status', 'active')
                ->count();

            $cohorts[] = [
                'cohort' => $cohortLabel,
                'cohort_month' => $cohortMonth,
                'joined' => $joined,
                'retained' => $retained,
                'retention_rate' => $joined > 0 ? round($retained / $joined, 3) : 0,
            ];
        }

        $totalJoined = array_sum(array_column($cohorts, 'joined'));
        $totalRetained = array_sum(array_column($cohorts, 'retained'));

        return [
            'cohorts' => $cohorts,
            'overall' => [
                'total_joined' => $totalJoined,
                'total_retained' => $totalRetained,
                'overall_retention_rate' => $totalJoined > 0 ? round($totalRetained / $totalJoined, 3) : 0,
            ],
        ];
    }

    /**
     * Get engagement metrics overview.
     */
    public function getEngagementMetrics(int $tenantId, int $days = 30): array
    {
        $cutoff = now()->subDays($days)->toDateTimeString();

        $totalUsers = (int) DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->count();

        $loggedIn = (int) DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->where('last_login_at', '>=', $cutoff)
            ->count();

        $traders = (int) DB::selectOne(
            "SELECT COUNT(DISTINCT user_id) as cnt FROM (
                SELECT sender_id as user_id FROM transactions WHERE tenant_id = ? AND created_at >= ? AND status = 'completed'
                UNION
                SELECT receiver_id as user_id FROM transactions WHERE tenant_id = ? AND created_at >= ? AND status = 'completed'
            ) t",
            [$tenantId, $cutoff, $tenantId, $cutoff]
        )->cnt;

        $posts = 0;
        try {
            $posts = (int) DB::table('feed_posts')
                ->where('tenant_id', $tenantId)
                ->where('created_at', '>=', $cutoff)
                ->count();
        } catch (\Exception $e) { Log::warning('MemberReportService metric query failed', ['error' => $e->getMessage()]); }

        $comments = 0;
        try {
            $comments = (int) DB::table('comments')
                ->where('tenant_id', $tenantId)
                ->where('created_at', '>=', $cutoff)
                ->count();
        } catch (\Exception $e) { Log::warning('MemberReportService metric query failed', ['error' => $e->getMessage()]); }

        $rsvps = 0;
        try {
            $rsvps = (int) DB::table('event_rsvps')
                ->where('tenant_id', $tenantId)
                ->where('created_at', '>=', $cutoff)
                ->where('status', 'going')
                ->count();
        } catch (\Exception $e) { Log::warning('MemberReportService metric query failed', ['error' => $e->getMessage()]); }

        $connections = 0;
        try {
            $connections = (int) DB::table('connections')
                ->where('tenant_id', $tenantId)
                ->where('created_at', '>=', $cutoff)
                ->where('status', 'accepted')
                ->count();
        } catch (\Exception $e) { Log::warning('MemberReportService metric query failed', ['error' => $e->getMessage()]); }

        return [
            'period_days' => $days,
            'total_users' => $totalUsers,
            'active_users' => $loggedIn,
            'login_rate' => $totalUsers > 0 ? round($loggedIn / $totalUsers, 3) : 0,
            'trading_users' => $traders,
            'trading_rate' => $totalUsers > 0 ? round($traders / $totalUsers, 3) : 0,
            'posts_created' => $posts,
            'comments_created' => $comments,
            'event_rsvps' => $rsvps,
            'new_connections' => $connections,
        ];
    }

    /**
     * Get top contributors.
     */
    public function getTopContributors(int $tenantId, int $days = 30, int $limit = 20): array
    {
        $limit = min(100, max(1, $limit));
        $cutoff = now()->subDays($days)->toDateTimeString();

        $rows = DB::table('users as u')
            ->where('u.tenant_id', $tenantId)
            ->where('u.status', 'active')
            ->select(['u.id', 'u.first_name', 'u.last_name', 'u.profile_type', 'u.organization_name', 'u.avatar_url'])
            ->selectRaw(
                "COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.sender_id = u.id AND t.tenant_id = ? AND t.status = 'completed' AND t.created_at >= ?), 0) as hours_given,
                 COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.receiver_id = u.id AND t.tenant_id = ? AND t.status = 'completed' AND t.created_at >= ?), 0) as hours_received,
                 COALESCE((SELECT COUNT(*) FROM transactions t WHERE (t.sender_id = u.id OR t.receiver_id = u.id) AND t.tenant_id = ? AND t.status = 'completed' AND t.created_at >= ?), 0) as transaction_count",
                [$tenantId, $cutoff, $tenantId, $cutoff, $tenantId, $cutoff]
            )
            ->havingRaw('(hours_given + hours_received) > 0')
            ->orderByRaw('(hours_given + hours_received) DESC')
            ->limit($limit)
            ->get();

        return $rows->map(function ($row) {
            return [
                'id' => (int) $row->id,
                'name' => UserDisplayName::resolve($row),
                'profile_image_url' => $row->avatar_url,
                'hours_given' => round((float) $row->hours_given, 1),
                'hours_received' => round((float) $row->hours_received, 1),
                'total_hours' => round((float) $row->hours_given + (float) $row->hours_received, 1),
                'transaction_count' => (int) $row->transaction_count,
            ];
        })->all();
    }

    /**
     * Get least active members.
     */
    public function getLeastActiveMembers(int $tenantId, int $days = 90, int $limit = 50, int $offset = 0): array
    {
        $limit = min(200, max(1, $limit));
        $offset = max(0, $offset);
        $cutoff = now()->subDays($days)->toDateTimeString();

        $total = (int) DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->where(function ($q) use ($cutoff) {
                $q->whereNull('last_login_at')
                  ->orWhere('last_login_at', '<', $cutoff);
            })
            ->count();

        $rows = DB::table('users as u')
            ->where('u.tenant_id', $tenantId)
            ->where('u.status', 'active')
            ->where(function ($q) use ($cutoff) {
                $q->whereNull('u.last_login_at')
                  ->orWhere('u.last_login_at', '<', $cutoff);
            })
            ->select('u.id', 'u.first_name', 'u.last_name', 'u.profile_type', 'u.organization_name', 'u.email', 'u.last_login_at', 'u.created_at')
            ->orderBy('u.last_login_at')
            ->orderBy('u.created_at')
            ->limit($limit)
            ->offset($offset)
            ->get();

        $members = $rows->map(function ($row) {
            return [
                'id' => (int) $row->id,
                'name' => UserDisplayName::resolve($row),
                'email' => $row->email,
                'last_login_at' => $row->last_login_at,
                'created_at' => $row->created_at,
                'days_inactive' => $row->last_login_at
                    ? (int) ((time() - strtotime($row->last_login_at)) / 86400)
                    : null,
            ];
        })->all();

        return [
            'members' => $members,
            'total' => $total,
            'threshold_days' => $days,
        ];
    }
}
