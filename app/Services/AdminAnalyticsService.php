<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * AdminAnalyticsService — Laravel DI-based service for admin dashboard analytics.
 *
 * All queries are tenant-scoped via explicit tenant_id parameter or HasTenantScope trait.
 */
class AdminAnalyticsService
{
    public function __construct(
        private readonly User $user,
        private readonly Transaction $transaction,
    ) {}

    /**
     * Get overall dashboard metrics for a tenant.
     */
    public function getDashboard(int $tenantId): array
    {
        $thirtyDaysAgo = now()->subDays(30);

        $totalCredits = (float) $this->user->newQuery()
            ->where('tenant_id', $tenantId)
            ->sum('balance');

        $txnVolume30d = (float) $this->transaction->newQuery()
            ->where('tenant_id', $tenantId)
            ->where('created_at', '>=', $thirtyDaysAgo)
            ->sum('amount');

        $txnCount30d = (int) $this->transaction->newQuery()
            ->where('tenant_id', $tenantId)
            ->where('created_at', '>=', $thirtyDaysAgo)
            ->count();

        $newUsers30d = (int) $this->user->newQuery()
            ->where('tenant_id', $tenantId)
            ->where('created_at', '>=', $thirtyDaysAgo)
            ->count();

        $avgTxnSize = (float) $this->transaction->newQuery()
            ->where('tenant_id', $tenantId)
            ->avg('amount');

        return [
            'total_credits_circulation' => $totalCredits,
            'transaction_volume_30d' => $txnVolume30d,
            'transaction_count_30d' => $txnCount30d,
            'new_users_30d' => $newUsers30d,
            'avg_transaction_size' => round($avgTxnSize, 2),
        ];
    }

    /**
     * Get user statistics broken down by status.
     */
    public function getUserStats(int $tenantId): array
    {
        $statuses = $this->user->newQuery()
            ->where('tenant_id', $tenantId)
            ->selectRaw('status, COUNT(*) as count')
            ->groupBy('status')
            ->pluck('count', 'status')
            ->all();

        $total = array_sum($statuses);

        $activeLastWeek = (int) $this->user->newQuery()
            ->where('tenant_id', $tenantId)
            ->where('last_active_at', '>=', now()->subDays(7))
            ->count();

        return [
            'total' => $total,
            'by_status' => $statuses,
            'active_last_week' => $activeLastWeek,
        ];
    }

    /**
     * Get overall timebanking statistics (consolidated query).
     */
    public function getOverallStats(): array
    {
        $tenantId = TenantContext::getId();
        $thirtyDaysAgo = now()->subDays(30);

        $totalCredits = (float) DB::table('users')
            ->where('tenant_id', $tenantId)
            ->sum('balance');

        $txnVolume30d = (float) DB::table('transactions')
            ->where('tenant_id', $tenantId)
            ->where('created_at', '>=', $thirtyDaysAgo)
            ->sum('amount');

        $txnCount30d = (int) DB::table('transactions')
            ->where('tenant_id', $tenantId)
            ->where('created_at', '>=', $thirtyDaysAgo)
            ->count();

        // Active traders (unique senders + receivers in last 30 days)
        // Uses SQL UNION + COUNT(DISTINCT) instead of loading all IDs into PHP memory
        $activeTradersRow = DB::selectOne(
            "SELECT COUNT(DISTINCT user_id) as cnt FROM (
                SELECT sender_id as user_id FROM transactions WHERE tenant_id = ? AND created_at >= ?
                UNION
                SELECT receiver_id as user_id FROM transactions WHERE tenant_id = ? AND created_at >= ?
            ) as active_users",
            [$tenantId, $thirtyDaysAgo, $tenantId, $thirtyDaysAgo]
        );
        $activeTraders = (int) ($activeTradersRow->cnt ?? 0);

        $avgTxnSize = (float) DB::table('transactions')
            ->where('tenant_id', $tenantId)
            ->avg('amount');

        $newUsers30d = (int) DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('created_at', '>=', $thirtyDaysAgo)
            ->count();

        $pendingAbuseAlerts = 0;
        try {
            $pendingAbuseAlerts = (int) DB::table('abuse_alerts')
                ->where('tenant_id', $tenantId)
                ->whereIn('status', ['new', 'reviewing'])
                ->count();
        } catch (\Throwable $e) {
            // Table may not exist
        }

        return [
            'total_credits_circulation' => $totalCredits,
            'transaction_volume_30d' => $txnVolume30d,
            'transaction_count_30d' => $txnCount30d,
            'active_traders_30d' => $activeTraders,
            'avg_transaction_size' => round($avgTxnSize, 2),
            'new_users_30d' => $newUsers30d,
            'pending_abuse_alerts' => $pendingAbuseAlerts,
        ];
    }

    /**
     * Get monthly transaction trends.
     */
    public function getMonthlyTrends(int $months = 12): array
    {
        $tenantId = TenantContext::getId();

        return DB::table('transactions')
            ->where('tenant_id', $tenantId)
            ->where('created_at', '>=', now()->subMonths($months))
            ->selectRaw("DATE_FORMAT(created_at, '%Y-%m') as month")
            ->selectRaw('COUNT(*) as transaction_count')
            ->selectRaw('SUM(amount) as total_volume')
            ->selectRaw('COUNT(DISTINCT sender_id) as unique_senders')
            ->selectRaw('COUNT(DISTINCT receiver_id) as unique_receivers')
            ->groupBy('month')
            ->orderBy('month')
            ->get()
            ->map(fn ($row) => (array) $row)
            ->all();
    }

    /**
     * Get weekly transaction trends.
     */
    public function getWeeklyTrends(int $weeks = 12): array
    {
        $tenantId = TenantContext::getId();

        return DB::table('transactions')
            ->where('tenant_id', $tenantId)
            ->where('created_at', '>=', now()->subWeeks($weeks))
            ->selectRaw('YEARWEEK(created_at, 1) as week')
            ->selectRaw('MIN(DATE(created_at)) as week_start')
            ->selectRaw('COUNT(*) as transaction_count')
            ->selectRaw('SUM(amount) as total_volume')
            ->groupBy('week')
            ->orderBy('week')
            ->get()
            ->map(fn ($row) => (array) $row)
            ->all();
    }

    /**
     * Get top earners for a period.
     */
    public function getTopEarners(int $days = 30, int $limit = 10): array
    {
        $tenantId = TenantContext::getId();

        return DB::table('transactions as t')
            ->join('users as u', 't.receiver_id', '=', 'u.id')
            ->where('t.tenant_id', $tenantId)
            ->where('t.created_at', '>=', now()->subDays($days))
            ->select(
                'u.id',
                'u.first_name',
                'u.last_name', 'u.profile_type', 'u.organization_name',
                'u.email',
                DB::raw('SUM(t.amount) as total_earned'),
                DB::raw('COUNT(t.id) as transaction_count')
            )
            // profile_type/organization_name are grouped too: they are
            // functionally dependent on u.id so MariaDB's default mode does not
            // require it, but a server with ONLY_FULL_GROUP_BY would reject the
            // query outright.
            ->groupBy('u.id', 'u.first_name', 'u.last_name', 'u.profile_type', 'u.organization_name', 'u.email')
            ->orderByDesc('total_earned')
            ->limit($limit)
            ->get()
            ->map(fn ($row) => (array) $row)
            ->all();
    }

    /**
     * Get top spenders for a period.
     */
    public function getTopSpenders(int $days = 30, int $limit = 10): array
    {
        $tenantId = TenantContext::getId();

        return DB::table('transactions as t')
            ->join('users as u', 't.sender_id', '=', 'u.id')
            ->where('t.tenant_id', $tenantId)
            ->where('t.created_at', '>=', now()->subDays($days))
            ->select(
                'u.id',
                'u.first_name',
                'u.last_name', 'u.profile_type', 'u.organization_name',
                'u.email',
                DB::raw('SUM(t.amount) as total_spent'),
                DB::raw('COUNT(t.id) as transaction_count')
            )
            ->groupBy('u.id', 'u.first_name', 'u.last_name', 'u.profile_type', 'u.organization_name', 'u.email')
            ->orderByDesc('total_spent')
            ->limit($limit)
            ->get()
            ->map(fn ($row) => (array) $row)
            ->all();
    }
}
