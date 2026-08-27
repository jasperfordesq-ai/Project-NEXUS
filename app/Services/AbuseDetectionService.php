<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Models\AbuseAlert;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * AbuseDetectionService
 *
 * Detects suspicious patterns in timebanking activity.
 * Creates alerts for admin review when anomalies are found.
 *
 * All queries are tenant-scoped via TenantContext::getId().
 */
class AbuseDetectionService
{
    /** Configuration thresholds (can be overridden per tenant) */
    public const LARGE_TRANSFER_THRESHOLD = 50;
    public const HIGH_VELOCITY_THRESHOLD = 10;
    public const CIRCULAR_WINDOW_HOURS = 24;
    public const INACTIVE_DAYS_THRESHOLD = 90;
    public const HIGH_BALANCE_THRESHOLD = 10;

    /**
     * Run all detection checks.
     *
     * @return array Summary of alerts created
     */
    public function runAllChecks(): array
    {
        return [
            'large_transfers' => $this->checkLargeTransfers(),
            'high_velocity' => $this->checkHighVelocity(),
            'circular_transfers' => $this->checkCircularTransfers(),
            'inactive_high_balance' => $this->checkInactiveHighBalances(),
        ];
    }

    /**
     * Check for large transfers (amount > threshold).
     *
     * @param float|null $threshold Override default threshold
     * @return int Number of alerts created
     */
    public function checkLargeTransfers($threshold = null): int
    {
        $tenantId = TenantContext::getId();
        $threshold = $threshold ?? self::LARGE_TRANSFER_THRESHOLD;

        $largeTransactions = DB::table('transactions as t')
            ->join('users as s', 't.sender_id', '=', 's.id')
            ->join('users as r', 't.receiver_id', '=', 'r.id')
            ->where('t.tenant_id', $tenantId)
            ->where('t.amount', '>=', $threshold)
            ->where('t.created_at', '>=', DB::raw('DATE_SUB(NOW(), INTERVAL 24 HOUR)'))
            ->whereNotIn('t.id', function ($q) use ($tenantId) {
                $q->select(DB::raw("JSON_UNQUOTE(JSON_EXTRACT(details, '$.transaction_id'))"))
                    ->from('abuse_alerts')
                    ->where('tenant_id', $tenantId)
                    ->where('alert_type', 'large_transfer');
            })
            ->select([
                't.*',
                DB::raw(UserDisplayName::sql('s', 'sender_name')),
                DB::raw(UserDisplayName::sql('r', 'receiver_name')),
            ])
            ->get();

        $alertsCreated = 0;
        foreach ($largeTransactions as $txn) {
            $this->createAlert(
                'large_transfer',
                $txn->amount >= $threshold * 2 ? 'high' : 'medium',
                $txn->sender_id,
                $txn->id,
                [
                    'transaction_id' => $txn->id,
                    'amount' => $txn->amount,
                    'sender_name' => $txn->sender_name,
                    'receiver_name' => $txn->receiver_name,
                    'threshold' => $threshold,
                ]
            );
            $alertsCreated++;
        }

        return $alertsCreated;
    }

    /**
     * Check for high velocity trading (many transactions in short time).
     *
     * @param int|null $threshold Override default threshold
     * @return int Number of alerts created
     */
    public function checkHighVelocity($threshold = null): int
    {
        $tenantId = TenantContext::getId();
        $threshold = $threshold ?? self::HIGH_VELOCITY_THRESHOLD;

        $highVelocityUsers = DB::select(
            "SELECT user_id, transaction_count FROM (
                SELECT sender_id as user_id, COUNT(*) as transaction_count
                FROM transactions
                WHERE tenant_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
                GROUP BY sender_id
                HAVING transaction_count >= ?
                UNION
                SELECT receiver_id as user_id, COUNT(*) as transaction_count
                FROM transactions
                WHERE tenant_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
                GROUP BY receiver_id
                HAVING transaction_count >= ?
             ) as velocity
             WHERE user_id NOT IN (
                 SELECT JSON_UNQUOTE(JSON_EXTRACT(details, '$.user_id'))
                 FROM abuse_alerts
                 WHERE tenant_id = ? AND alert_type = 'high_velocity'
                 AND created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
             )",
            [$tenantId, $threshold, $tenantId, $threshold, $tenantId]
        );

        $alertsCreated = 0;
        $userIds = array_unique(array_map(static fn ($r) => (int) $r->user_id, $highVelocityUsers));
        $users = !empty($userIds)
            ? User::whereIn('id', $userIds)->get()->keyBy('id')
            : collect();
        foreach ($highVelocityUsers as $row) {
            $user = $users->get((int) $row->user_id);
            $userName = $user ? UserDisplayName::resolve($user) : 'Unknown';

            $this->createAlert(
                'high_velocity',
                $row->transaction_count >= $threshold * 2 ? 'high' : 'medium',
                $row->user_id,
                null,
                [
                    'user_id' => $row->user_id,
                    'user_name' => $userName,
                    'transaction_count' => $row->transaction_count,
                    'threshold' => $threshold,
                    'time_window' => '1 hour',
                ]
            );
            $alertsCreated++;
        }

        return $alertsCreated;
    }

    /**
     * Check for circular transfers (A->B->A within window).
     *
     * @param int|null $windowHours Override default window
     * @return int Number of alerts created
     */
    public function checkCircularTransfers($windowHours = null): int
    {
        $tenantId = TenantContext::getId();
        $windowHours = $windowHours ?? self::CIRCULAR_WINDOW_HOURS;

        $circularTransfers = DB::select(
            "SELECT t1.sender_id as user_a, t1.receiver_id as user_b,
                    t1.id as first_txn_id, t2.id as return_txn_id,
                    t1.amount as first_amount, t2.amount as return_amount,
                    t1.created_at as first_time, t2.created_at as return_time
             FROM transactions t1
             JOIN transactions t2 ON t1.sender_id = t2.receiver_id
                                  AND t1.receiver_id = t2.sender_id
                                  AND t2.created_at > t1.created_at
             WHERE t1.tenant_id = ?
             AND t1.created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
             AND t2.created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
             AND CONCAT(LEAST(t1.id, t2.id), '-', GREATEST(t1.id, t2.id)) NOT IN (
                 SELECT JSON_UNQUOTE(JSON_EXTRACT(details, '$.txn_pair'))
                 FROM abuse_alerts WHERE tenant_id = ? AND alert_type = 'circular_transfer'
             )",
            [$tenantId, $windowHours, $windowHours, $tenantId]
        );

        $alertsCreated = 0;
        $circularUserIds = [];
        foreach ($circularTransfers as $c) {
            $circularUserIds[] = (int) $c->user_a;
            $circularUserIds[] = (int) $c->user_b;
        }
        $circularUserIds = array_unique($circularUserIds);
        $circularUsers = !empty($circularUserIds)
            ? User::whereIn('id', $circularUserIds)->get()->keyBy('id')
            : collect();
        foreach ($circularTransfers as $circular) {
            $userA = $circularUsers->get((int) $circular->user_a);
            $userB = $circularUsers->get((int) $circular->user_b);

            $this->createAlert(
                'circular_transfer',
                'medium',
                $circular->user_a,
                $circular->first_txn_id,
                [
                    'user_a_id' => $circular->user_a,
                    'user_a_name' => $userA ? UserDisplayName::resolve($userA) : 'Unknown',
                    'user_b_id' => $circular->user_b,
                    'user_b_name' => $userB ? UserDisplayName::resolve($userB) : 'Unknown',
                    'first_amount' => $circular->first_amount,
                    'return_amount' => $circular->return_amount,
                    'first_txn_id' => $circular->first_txn_id,
                    'return_txn_id' => $circular->return_txn_id,
                    'txn_pair' => min($circular->first_txn_id, $circular->return_txn_id) . '-' .
                                  max($circular->first_txn_id, $circular->return_txn_id),
                    'window_hours' => $windowHours,
                ]
            );
            $alertsCreated++;
        }

        return $alertsCreated;
    }

    /**
     * Check for inactive users with high balances (potential credit hoarding).
     *
     * @return int Number of alerts created
     */
    public function checkInactiveHighBalances(): int
    {
        $tenantId = TenantContext::getId();
        $inactiveDays = self::INACTIVE_DAYS_THRESHOLD;
        $balanceThreshold = self::HIGH_BALANCE_THRESHOLD;

        $inactiveUsers = DB::select(
            "SELECT u.id, u.first_name, u.last_name, u.balance,
                    MAX(t.created_at) as last_transaction
             FROM users u
             LEFT JOIN transactions t ON (t.sender_id = u.id OR t.receiver_id = u.id)
             WHERE u.tenant_id = ? AND u.balance >= ?
             AND u.id NOT IN (
                 SELECT JSON_UNQUOTE(JSON_EXTRACT(details, '$.user_id'))
                 FROM abuse_alerts WHERE tenant_id = ? AND alert_type = 'inactive_high_balance'
                 AND status IN ('new', 'reviewing')
             )
             GROUP BY u.id, u.first_name, u.last_name, u.balance
             HAVING last_transaction IS NULL
                OR last_transaction < DATE_SUB(NOW(), INTERVAL ? DAY)",
            [$tenantId, $balanceThreshold, $tenantId, $inactiveDays]
        );

        $alertsCreated = 0;
        foreach ($inactiveUsers as $user) {
            $this->createAlert(
                'inactive_high_balance',
                'low',
                $user->id,
                null,
                [
                    'user_id' => $user->id,
                    'user_name' => UserDisplayName::resolve($user),
                    'balance' => $user->balance,
                    'last_transaction' => $user->last_transaction,
                    'inactive_days' => $inactiveDays,
                ]
            );
            $alertsCreated++;
        }

        return $alertsCreated;
    }

    /**
     * Create an abuse alert.
     *
     * @param string $alertType Type of alert
     * @param string $severity low, medium, high, critical
     * @param int|null $userId Related user
     * @param int|null $transactionId Related transaction
     * @param array $details Additional details
     * @return int Alert ID
     */
    public function createAlert(string $alertType, string $severity, ?int $userId = null, ?int $transactionId = null, array $details = []): int
    {
        $alert = AbuseAlert::create([
            'tenant_id' => TenantContext::getId(),
            'alert_type' => $alertType,
            'severity' => $severity,
            'user_id' => $userId,
            'transaction_id' => $transactionId,
            'details' => $details,
        ]);

        return $alert->id;
    }

    /**
     * Update alert status.
     *
     * @param int $id Alert ID
     * @param string $status new, reviewing, resolved, dismissed
     * @param int|null $resolvedBy User ID resolving
     * @param string|null $notes Resolution notes
     * @return bool
     */
    /**
     * Get alert counts by status for the current tenant (used by daily report).
     *
     * @return array{new: int, reviewing: int, resolved: int, dismissed: int}
     */
    public static function getAlertCounts(): array
    {
        $tenantId = TenantContext::getId();
        $rows = DB::select(
            "SELECT status, COUNT(*) as cnt FROM abuse_alerts WHERE tenant_id = ? GROUP BY status",
            [$tenantId]
        );
        $counts = [];
        foreach ($rows as $row) {
            $counts[$row->status] = (int) $row->cnt;
        }
        return $counts;
    }

    public function updateAlertStatus(int $id, string $status, ?int $resolvedBy = null, ?string $notes = null): bool
    {
        $alert = AbuseAlert::find($id);
        if (!$alert) {
            return false;
        }

        $updateData = [
            'status' => $status,
            'resolved_by' => $resolvedBy,
            'resolution_notes' => $notes,
        ];

        if (in_array($status, ['resolved', 'dismissed'])) {
            $updateData['resolved_at'] = now();
        } else {
            $updateData['resolved_at'] = null;
        }

        $alert->update($updateData);

        return true;
    }
}
