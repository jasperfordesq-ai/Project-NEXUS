<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use Illuminate\Support\Facades\DB;
use App\Support\UserDisplayName;

/**
 * HoursReportService — Native Eloquent implementation for admin hours reporting.
 *
 * Provides breakdowns of time-credit transactions by category, member, and period.
 * All queries are tenant-scoped.
 */
class HoursReportService
{
    public function __construct()
    {
    }

    /**
     * Get hours grouped by listing category.
     *
     * @param int   $tenantId
     * @param array $dateRange ['from' => 'Y-m-d', 'to' => 'Y-m-d']
     * @return array
     */
    public function getHoursByCategory(int $tenantId, array $dateRange = []): array
    {
        $dateConditions = $this->buildDateConditions($dateRange, 't.created_at');
        $dateBindings = $this->buildDateBindings($dateRange);

        $query = "SELECT
                c.id AS category_id,
                c.name AS category_name,
                c.color AS category_color,
                COALESCE(SUM(t.amount), 0) AS total_hours,
                COUNT(*) AS transaction_count,
                COUNT(DISTINCT t.sender_id) AS unique_providers,
                COUNT(DISTINCT t.receiver_id) AS unique_receivers
            FROM transactions t
            LEFT JOIN listings l ON l.id = t.listing_id AND l.tenant_id = t.tenant_id
            LEFT JOIN categories c ON c.id = l.category_id AND c.tenant_id = t.tenant_id
            WHERE t.tenant_id = ? AND t.status = 'completed'
            {$dateConditions}
            GROUP BY c.id, c.name, c.color
            ORDER BY total_hours DESC";

        $rows = DB::select($query, array_merge([$tenantId], $dateBindings));

        return array_map(function ($row) {
            return [
                'category_id'       => $row->category_id,
                'category_name'     => $row->category_name ?? 'Uncategorized',
                'category_color'    => $row->category_color ?? '#6B7280',
                'total_hours'       => round((float) $row->total_hours, 2),
                'transaction_count' => (int) $row->transaction_count,
                'unique_providers'  => (int) $row->unique_providers,
                'unique_receivers'  => (int) $row->unique_receivers,
            ];
        }, $rows);
    }

    /**
     * Get hours grouped by member.
     *
     * @param int    $tenantId
     * @param array  $dateRange
     * @param string $sortBy   'total' | 'given' | 'received' | 'name'
     * @param int    $limit
     * @param int    $offset
     * @return array
     */
    public function getHoursByMember(int $tenantId, array $dateRange = [], string $sortBy = 'total', int $limit = 50, int $offset = 0): array
    {
        $dateConditions = $this->buildDateConditions($dateRange);
        $dateBindings = $this->buildDateBindings($dateRange);

        // Subquery: hours given (as sender)
        $givenSub = "SELECT sender_id AS user_id, COALESCE(SUM(amount), 0) AS hours_given, COUNT(*) AS given_count
            FROM transactions
            WHERE tenant_id = ? AND status = 'completed' {$dateConditions}
            GROUP BY sender_id";

        // Subquery: hours received (as receiver)
        $receivedSub = "SELECT receiver_id AS user_id, COALESCE(SUM(amount), 0) AS hours_received, COUNT(*) AS received_count
            FROM transactions
            WHERE tenant_id = ? AND status = 'completed' {$dateConditions}
            GROUP BY receiver_id";

        $orderBy = match ($sortBy) {
            'given'    => 'hours_given DESC',
            'received' => 'hours_received DESC',
            'name'     => 'u.name ASC',
            default    => 'total_hours DESC',
        };

        $query = "SELECT
                u.id AS user_id,
                u.name,
                u.first_name,
                u.last_name,
                u.profile_type,
                u.organization_name,
                u.avatar_url,
                COALESCE(g.hours_given, 0) AS hours_given,
                COALESCE(r.hours_received, 0) AS hours_received,
                COALESCE(g.hours_given, 0) + COALESCE(r.hours_received, 0) AS total_hours,
                COALESCE(g.given_count, 0) AS given_count,
                COALESCE(r.received_count, 0) AS received_count,
                COALESCE(g.given_count, 0) + COALESCE(r.received_count, 0) AS total_transactions
            FROM users u
            LEFT JOIN ({$givenSub}) g ON g.user_id = u.id
            LEFT JOIN ({$receivedSub}) r ON r.user_id = u.id
            WHERE u.tenant_id = ? AND u.is_approved = 1
                AND (g.user_id IS NOT NULL OR r.user_id IS NOT NULL)
            ORDER BY {$orderBy}
            LIMIT ? OFFSET ?";

        $bindings = array_merge(
            [$tenantId],
            $dateBindings,
            [$tenantId],
            $dateBindings,
            [$tenantId, $limit, $offset]
        );

        $rows = DB::select($query, $bindings);

        // Get total count for pagination
        $countQuery = "SELECT COUNT(*) AS total FROM users u
            LEFT JOIN ({$givenSub}) g ON g.user_id = u.id
            LEFT JOIN ({$receivedSub}) r ON r.user_id = u.id
            WHERE u.tenant_id = ? AND u.is_approved = 1
                AND (g.user_id IS NOT NULL OR r.user_id IS NOT NULL)";

        $countBindings = array_merge(
            [$tenantId],
            $dateBindings,
            [$tenantId],
            $dateBindings,
            [$tenantId]
        );

        $totalResult = DB::selectOne($countQuery, $countBindings);
        $total = (int) ($totalResult->total ?? 0);

        $members = array_map(function ($row) {
            $name = UserDisplayName::resolve($row);
            if (empty($name)) {
                $name = $row->name ?? 'Unknown';
            }
            return [
                'user_id'            => (int) $row->user_id,
                'name'               => $name,
                'avatar_url'         => $row->avatar_url,
                'hours_given'        => round((float) $row->hours_given, 2),
                'hours_received'     => round((float) $row->hours_received, 2),
                'total_hours'        => round((float) $row->total_hours, 2),
                'given_count'        => (int) $row->given_count,
                'received_count'     => (int) $row->received_count,
                'total_transactions' => (int) $row->total_transactions,
            ];
        }, $rows);

        return [
            'data'  => $members,
            'total' => $total,
        ];
    }

    /**
     * Get hours grouped by time period (monthly).
     *
     * @param int   $tenantId
     * @param array $dateRange
     * @return array
     */
    public function getHoursByPeriod(int $tenantId, array $dateRange = []): array
    {
        $dateConditions = $this->buildDateConditions($dateRange);
        $dateBindings = $this->buildDateBindings($dateRange);

        // Default to last 12 months if no date range specified
        $periodCondition = '';
        if (empty($dateRange)) {
            $periodCondition = ' AND created_at >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)';
        }

        $query = "SELECT
                DATE_FORMAT(created_at, '%Y-%m') AS period,
                DATE_FORMAT(created_at, '%M %Y') AS period_label,
                COALESCE(SUM(amount), 0) AS total_hours,
                COUNT(*) AS transaction_count,
                COUNT(DISTINCT sender_id) AS unique_providers,
                COUNT(DISTINCT receiver_id) AS unique_receivers,
                COUNT(DISTINCT sender_id) + COUNT(DISTINCT receiver_id) AS unique_participants
            FROM transactions
            WHERE tenant_id = ? AND status = 'completed'
            {$dateConditions}
            {$periodCondition}
            GROUP BY DATE_FORMAT(created_at, '%Y-%m'), DATE_FORMAT(created_at, '%M %Y')
            ORDER BY period ASC";

        $rows = DB::select($query, array_merge([$tenantId], $dateBindings));

        return array_map(function ($row) {
            return [
                'period'              => $row->period,
                'period_label'        => $row->period_label,
                'total_hours'         => round((float) $row->total_hours, 2),
                'transaction_count'   => (int) $row->transaction_count,
                'unique_providers'    => (int) $row->unique_providers,
                'unique_receivers'    => (int) $row->unique_receivers,
                'unique_participants' => (int) $row->unique_participants,
            ];
        }, $rows);
    }

    /**
     * Get overall hours summary.
     *
     * @param int   $tenantId
     * @param array $dateRange
     * @return array
     */
    public function getHoursSummary(int $tenantId, array $dateRange = []): array
    {
        $dateConditions = $this->buildDateConditions($dateRange);
        $dateBindings = $this->buildDateBindings($dateRange);

        // Overall totals
        $summaryQuery = "SELECT
                COALESCE(SUM(amount), 0) AS total_hours,
                COUNT(*) AS total_transactions,
                COALESCE(AVG(amount), 0) AS avg_hours_per_transaction,
                COALESCE(MAX(amount), 0) AS max_single_transaction,
                COUNT(DISTINCT sender_id) AS unique_providers,
                COUNT(DISTINCT receiver_id) AS unique_receivers
            FROM transactions
            WHERE tenant_id = ? AND status = 'completed'
            {$dateConditions}";

        $summary = DB::selectOne($summaryQuery, array_merge([$tenantId], $dateBindings));

        // Total members for context
        $totalMembers = (int) DB::selectOne(
            "SELECT COUNT(*) AS cnt FROM users WHERE tenant_id = ? AND is_approved = 1",
            [$tenantId]
        )->cnt;

        $uniqueProviders = (int) ($summary->unique_providers ?? 0);
        $uniqueReceivers = (int) ($summary->unique_receivers ?? 0);
        $totalHours = (float) ($summary->total_hours ?? 0);
        $totalTransactions = (int) ($summary->total_transactions ?? 0);

        // Participation rate
        $participationRate = $totalMembers > 0
            ? round((($uniqueProviders + $uniqueReceivers) / $totalMembers) * 100, 1)
            : 0;

        // This month vs last month comparison
        $thisMonthQuery = "SELECT COALESCE(SUM(amount), 0) AS hours, COUNT(*) AS transactions
            FROM transactions
            WHERE tenant_id = ? AND status = 'completed'
            AND YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE())";
        $thisMonth = DB::selectOne($thisMonthQuery, [$tenantId]);

        $lastMonthQuery = "SELECT COALESCE(SUM(amount), 0) AS hours, COUNT(*) AS transactions
            FROM transactions
            WHERE tenant_id = ? AND status = 'completed'
            AND YEAR(created_at) = YEAR(DATE_SUB(CURDATE(), INTERVAL 1 MONTH))
            AND MONTH(created_at) = MONTH(DATE_SUB(CURDATE(), INTERVAL 1 MONTH))";
        $lastMonth = DB::selectOne($lastMonthQuery, [$tenantId]);

        $thisMonthHours = (float) ($thisMonth->hours ?? 0);
        $lastMonthHours = (float) ($lastMonth->hours ?? 0);
        $monthOverMonthChange = $lastMonthHours > 0
            ? round((($thisMonthHours - $lastMonthHours) / $lastMonthHours) * 100, 1)
            : ($thisMonthHours > 0 ? 100 : 0);

        return [
            'total_hours'               => round($totalHours, 2),
            'total_transactions'        => $totalTransactions,
            'avg_hours_per_transaction' => round((float) ($summary->avg_hours_per_transaction ?? 0), 2),
            'max_single_transaction'    => round((float) ($summary->max_single_transaction ?? 0), 2),
            'unique_providers'          => $uniqueProviders,
            'unique_receivers'          => $uniqueReceivers,
            'total_members'             => $totalMembers,
            'participation_rate'        => $participationRate,
            'this_month' => [
                'hours'        => round($thisMonthHours, 2),
                'transactions' => (int) ($thisMonth->transactions ?? 0),
            ],
            'last_month' => [
                'hours'        => round($lastMonthHours, 2),
                'transactions' => (int) ($lastMonth->transactions ?? 0),
            ],
            'month_over_month_change' => $monthOverMonthChange,
            'date_range'              => $dateRange,
        ];
    }

    /**
     * Build SQL date condition fragment.
     */
    private function buildDateConditions(array $dateRange, string $column = 'created_at'): string
    {
        $conditions = '';
        if (!empty($dateRange['from'])) {
            $conditions .= " AND {$column} >= ?";
        }
        if (!empty($dateRange['to'])) {
            // 🔴 `{$column} <= '2026-06-30'` against a DATETIME column compares
            // against 2026-06-30 00:00:00 and therefore silently DROPS the whole
            // of the last requested day. A "1–30 June" report returned 1–29 June,
            // on screen and in every export. Use an exclusive upper bound on the
            // following midnight instead: still index-friendly (unlike wrapping
            // the column in DATE()), and inclusive of the final day.
            $conditions .= " AND {$column} < DATE_ADD(?, INTERVAL 1 DAY)";
        }
        return $conditions;
    }

    /**
     * Build bindings array for date conditions.
     */
    private function buildDateBindings(array $dateRange): array
    {
        $bindings = [];
        if (!empty($dateRange['from'])) {
            $bindings[] = $dateRange['from'];
        }
        if (!empty($dateRange['to'])) {
            $bindings[] = $dateRange['to'];
        }
        return $bindings;
    }
}
