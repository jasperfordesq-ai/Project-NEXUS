<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Services\AbuseDetectionService;

/**
 * AdminTimebankingController -- Admin timebanking stats, alerts, balance adjustments, org wallets, user reports.
 *
 * All methods require admin authentication.
 * CSV export (userStatement with format=csv) delegates to legacy for direct output.
 */
class AdminTimebankingController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly AbuseDetectionService $abuseDetectionService,
    ) {}

    /** GET /api/v2/admin/timebanking/stats */
    public function stats(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $txRow = DB::selectOne(
            "SELECT COUNT(*) as total_transactions, COALESCE(SUM(amount), 0) as total_volume, COALESCE(AVG(amount), 0) as avg_transaction
             FROM transactions WHERE tenant_id = ? AND status = 'completed'",
            [$tenantId]
        );

        $topEarners = DB::select(
            "SELECT u.id as user_id, CONCAT(u.first_name, ' ', u.last_name) as user_name, COALESCE(SUM(t.amount), 0) as amount
             FROM transactions t JOIN users u ON t.receiver_id = u.id
             WHERE t.tenant_id = ? AND t.status = 'completed' GROUP BY u.id ORDER BY amount DESC LIMIT 5",
            [$tenantId]
        );

        $topSpenders = DB::select(
            "SELECT u.id as user_id, CONCAT(u.first_name, ' ', u.last_name) as user_name, COALESCE(SUM(t.amount), 0) as amount
             FROM transactions t JOIN users u ON t.sender_id = u.id
             WHERE t.tenant_id = ? AND t.status = 'completed' GROUP BY u.id ORDER BY amount DESC LIMIT 5",
            [$tenantId]
        );

        $activeAlerts = 0;
        try {
            $activeAlerts = (int) DB::selectOne(
                "SELECT COUNT(*) as cnt FROM abuse_alerts WHERE tenant_id = ? AND status IN ('new', 'reviewing')",
                [$tenantId]
            )->cnt;
        } catch (\Throwable $e) { Log::warning('Stats query failed in ' . __METHOD__, ['error' => $e->getMessage()]); }

        return $this->respondWithData([
            'total_transactions' => (int) ($txRow->total_transactions ?? 0),
            'total_volume' => round((float) ($txRow->total_volume ?? 0), 1),
            'avg_transaction' => round((float) ($txRow->avg_transaction ?? 0), 2),
            'active_alerts' => $activeAlerts,
            'top_earners' => array_map(fn($r) => ['user_id' => (int) $r->user_id, 'user_name' => $r->user_name, 'amount' => round((float) $r->amount, 1)], $topEarners),
            'top_spenders' => array_map(fn($r) => ['user_id' => (int) $r->user_id, 'user_name' => $r->user_name, 'amount' => round((float) $r->amount, 1)], $topSpenders),
        ]);
    }

    /** GET /api/v2/admin/timebanking/alerts */
    public function alerts(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $status = $this->query('status');
        $page = $this->queryInt('page', 1, 1);
        $perPage = $this->queryInt('per_page', 20, 1, 100);
        $offset = ($page - 1) * $perPage;

        $total = 0;
        $items = [];

        try {
            $countSql = "SELECT COUNT(*) as cnt FROM abuse_alerts WHERE tenant_id = ?";
            $countParams = [$tenantId];
            if ($status && $status !== 'all') {
                $countSql .= " AND status = ?";
                $countParams[] = $status;
            }
            $total = (int) DB::selectOne($countSql, $countParams)->cnt;

            $sql = "SELECT a.id, a.user_id, a.alert_type, a.severity, a.status, a.details, a.created_at, a.resolved_at, a.resolution_notes,
                           CONCAT(u.first_name, ' ', u.last_name) as user_name
                    FROM abuse_alerts a LEFT JOIN users u ON a.user_id = u.id WHERE a.tenant_id = ?";
            $params = [$tenantId];
            if ($status && $status !== 'all') {
                $sql .= " AND a.status = ?";
                $params[] = $status;
            }
            $sql .= " ORDER BY CASE a.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 END, a.created_at DESC LIMIT ? OFFSET ?";
            $params[] = $perPage;
            $params[] = $offset;

            $items = DB::select($sql, $params);
        } catch (\Throwable $e) { Log::warning('Stats query failed in ' . __METHOD__, ['error' => $e->getMessage()]); }

        $formatted = array_map(fn($r) => [
            'id' => (int) $r->id,
            'user_id' => (int) ($r->user_id ?? 0),
            'user_name' => $r->user_name ?? 'Unknown',
            'alert_type' => $r->alert_type ?? '',
            'severity' => $r->severity ?? 'low',
            'status' => $r->status ?? 'new',
            'description' => $r->details ?? '',
            'created_at' => $r->created_at ?? '',
            'resolved_at' => $r->resolved_at ?? null,
            'resolution_notes' => $r->resolution_notes ?? null,
        ], $items);

        return $this->respondWithPaginatedCollection($formatted, $total, $page, $perPage);
    }

    /** PUT /api/v2/admin/timebanking/alerts/{id} */
    public function updateAlert(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $status = $this->input('status', '');
        $validStatuses = ['new', 'reviewing', 'resolved', 'dismissed'];
        if (!in_array($status, $validStatuses)) {
            return $this->respondWithError('INVALID_STATUS', __('api.status_must_be_one_of', ['statuses' => implode(', ', $validStatuses)]), 'status', 400);
        }

        try {
            $alert = DB::selectOne("SELECT id FROM abuse_alerts WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
            if (!$alert) {
                return $this->respondWithError('NOT_FOUND', __('api.alert_not_found'), null, 404);
            }

            $resolvedBy = in_array($status, ['resolved', 'dismissed']) ? $this->getUserId() : null;
            $notes = $this->input('notes', '');
            $this->abuseDetectionService->updateAlertStatus($id, $status, $resolvedBy, $notes);
        } catch (\Throwable $e) {
            return $this->respondWithError('UPDATE_FAILED', __('api.alert_update_failed'), null, 500);
        }

        return $this->respondWithData(['id' => $id, 'status' => $status]);
    }

    /** POST /api/v2/admin/timebanking/adjust-balance */
    public function adjustBalance(): JsonResponse
    {
        // broker-or-admin: brokers may credit/debit a member's time balance, with
        // a mandatory reason.
        //
        // Audited to `org_audit_log` as `member_balance_adjusted`, with the actor,
        // the target member, the reason and the before/after balances — written
        // INSIDE the same DB transaction as the balance change, so an adjustment
        // can never land without its record. For most of this endpoint's life two
        // comments claimed it was audited while nothing was written at all; if you
        // refactor this method, keep the audit write inside the transaction.
        //
        // The ledger entry is one-sided (NULL counterparty, transaction_type
        // 'admin_grant') because administration creates or destroys the credits —
        // see the note at the INSERT below for why naming the admin there was
        // wrong.
        $adminId = $this->requireBrokerOrAdmin();
        $tenantId = $this->getTenantId();

        $userId = $this->inputInt('user_id');
        $rawAmount = $this->input('amount', 0);
        $amount = (float) $rawAmount;
        $reason = trim($this->input('reason', ''));

        if (!$userId) return $this->respondWithError('VALIDATION_ERROR', __('api.user_id_required'), 'user_id', 400);
        // Self-dealing guard: a broker/coordinator must not adjust their OWN
        // balance (they could otherwise mint themselves time credits). Admins
        // retain full latitude. See BrokerUserActionsAuthorizationTest.
        if ($userId === $adminId && !$this->callerIsAdminTier()) {
            return $this->respondWithError('AUTH_INSUFFICIENT_PERMISSIONS', __('api.broker_cannot_adjust_own_balance'), null, 403);
        }
        if ($amount == 0) return $this->respondWithError('VALIDATION_ERROR', __('api.amount_must_be_nonzero'), 'amount', 400);
        // Reject NaN / infinity / scientific-notation silliness, and cap the
        // adjustment at a sane hour-credit ceiling so a typo can't inflate a
        // user's balance by 1e100.
        if (is_nan($amount) || is_infinite($amount) || !is_numeric($rawAmount)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.amount_invalid'), 'amount', 400);
        }
        if (abs($amount) > 100000) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.amount_out_of_range'), 'amount', 400);
        }
        if (empty($reason)) return $this->respondWithError('VALIDATION_ERROR', __('api.reason_required'), 'reason', 400);

        // Verify user exists (non-locking read for early 404). preferred_language
        // is selected so the balance-adjustment notification below renders in the
        // RECIPIENT's locale, not the admin's/broker's request locale.
        $user = DB::selectOne("SELECT id, first_name, last_name, balance, preferred_language FROM users WHERE id = ? AND tenant_id = ?", [$userId, $tenantId]);
        if (!$user) return $this->respondWithError('NOT_FOUND', __('api.user_not_found'), null, 404);

        try {
            $result = DB::transaction(function () use ($userId, $tenantId, $adminId, $amount, $reason) {
                // Lock the user row to prevent concurrent balance modifications (race condition fix)
                $lockedUser = DB::selectOne(
                    "SELECT id, first_name, last_name, balance FROM users WHERE id = ? AND tenant_id = ? FOR UPDATE",
                    [$userId, $tenantId]
                );

                if (!$lockedUser) {
                    throw new \RuntimeException(__('api.user_not_found'));
                }

                $currentBalance = (float) ($lockedUser->balance ?? 0);
                $newBalance = $currentBalance + $amount;

                if ($newBalance < 0) {
                    throw new \DomainException(__('api.balance_adjustment_negative'));
                }

                // Atomic balance update using relative arithmetic
                DB::update(
                    "UPDATE users SET balance = balance + ?, updated_at = NOW() WHERE id = ? AND tenant_id = ?",
                    [$amount, $userId, $tenantId]
                );

                $absAmount = abs($amount);

                // One-sided treasury movement: credits are created or destroyed by
                // administration, so the OTHER side of the entry is NULL rather
                // than the acting admin. Recording the admin there was actively
                // harmful — their own users.balance was never moved, so the ledger
                // did not reconcile for them, and stats()/userReport() derive
                // total_earned/total_spent with SUM(amount) GROUP BY
                // receiver_id/sender_id, which meant every adjustment inflated the
                // acting admin's apparent totals on the admin dashboard.
                // Same shape as WalletService::reclaimFromMember().
                // transaction_type is set explicitly so an administrative
                // adjustment is distinguishable from a member-to-member transfer;
                // it previously fell back to the 'transfer' column default.
                DB::insert(
                    "INSERT INTO transactions (tenant_id, sender_id, receiver_id, amount, description, transaction_type, status, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, 'admin_grant', 'completed', NOW(), NOW())",
                    $amount > 0
                        ? [$tenantId, null, $userId, $absAmount, '[Admin Adjustment] ' . $reason]
                        : [$tenantId, $userId, null, $absAmount, '[Admin Adjustment] ' . $reason]
                );

                // Audit INSIDE the transaction, deliberately: a balance correction
                // without a durable record of who made it and why is exactly the
                // hole this endpoint had for its whole life (two comments claimed
                // it was audited; nothing was). logAction() uses a raw insertGetId
                // and does NOT swallow failures, so if the audit row cannot be
                // written the adjustment rolls back with it. That is the intended
                // trade: no silent unaudited money movement.
                app(\App\Services\AuditLogService::class)->logAction(
                    $tenantId,
                    'member_balance_adjusted',
                    $adminId,
                    [
                        'reason' => $reason,
                        'adjustment' => $amount,
                        'previous_balance' => $currentBalance,
                        'new_balance' => $newBalance,
                    ],
                    null,
                    $userId,
                );

                return [
                    'previous_balance' => $currentBalance,
                    'new_balance' => $newBalance,
                    'user_name' => trim($lockedUser->first_name . ' ' . $lockedUser->last_name),
                ];
            });
        } catch (\DomainException $e) {
            return $this->respondWithError('INSUFFICIENT_BALANCE', $e->getMessage(), null, 400);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::error('Balance adjustment failed', ['user' => $userId, 'error' => $e->getMessage()]);
            return $this->respondWithError('SERVER_ERROR', __('api.balance_adjust_failed'), null, 500);
        }

        // Notify user of balance adjustment — rendered in the recipient's
        // preferred language (bell + device push), not the actor's request locale.
        try {
            $absAmount = abs($amount);
            LocaleContext::withLocale($user, function () use ($userId, $amount, $absAmount) {
                $unit = trans_choice('api_controllers_3.wallet_admin.hours_unit', (float) $absAmount);
                $msg = $amount > 0
                    ? __('api_controllers_3.wallet_admin.balance_adjusted_added', ['amount' => $absAmount, 'unit' => $unit])
                    : __('api_controllers_3.wallet_admin.balance_adjusted_removed', ['amount' => $absAmount, 'unit' => $unit]);
                \App\Models\Notification::createNotification(
                    $userId,
                    $msg,
                    '/wallet',
                    'transaction'
                );
                \App\Services\NotificationDispatcher::fanOutPush((int) ($userId), 'transaction', $msg, '/wallet');
            });
        } catch (\Throwable $e) {
            \Log::warning('Balance adjustment notification failed', ['user_id' => $userId, 'error' => $e->getMessage()]);
        }

        return $this->respondWithData([
            'user_id' => $userId,
            'user_name' => $result['user_name'],
            'previous_balance' => $result['previous_balance'],
            'adjustment' => $amount,
            'new_balance' => $result['new_balance'],
        ]);
    }

    /** GET /api/v2/admin/timebanking/org-wallets */
    public function orgWallets(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $wallets = [];

        try {
            // Read the LIVE volunteer-org wallet (vol_organizations.balance +
            // vol_org_transactions ledger + org_type='volunteer' members). The
            // previous query read the abandoned community-org tables
            // (org_wallets / org_transactions / org_type='community'), which no
            // code ever writes to, so this dashboard always showed empty rows.
            // In vol_org_transactions, deposits/positive admin adjustments are
            // amount > 0 (money in) and volunteer payments/negative adjustments
            // are amount < 0 (money out).
            $rowResults = DB::select(
                "SELECT vo.id, vo.id as org_id, vo.name as org_name,
                        ROUND(COALESCE(vo.balance, 0), 1) as balance,
                        vo.created_at,
                        COUNT(DISTINCT om.id) as member_count,
                        COALESCE(vt_in.total_in, 0) as total_in,
                        COALESCE(vt_out.total_out, 0) as total_out
                 FROM vol_organizations vo
                 LEFT JOIN org_members om
                     ON om.organization_id = vo.id
                    AND om.tenant_id = vo.tenant_id
                    AND om.org_type = 'volunteer'
                    AND om.status = 'active'
                 LEFT JOIN (
                     SELECT vol_organization_id, ROUND(SUM(amount), 1) as total_in
                     FROM vol_org_transactions
                     WHERE tenant_id = ? AND amount > 0
                     GROUP BY vol_organization_id
                 ) vt_in ON vt_in.vol_organization_id = vo.id
                 LEFT JOIN (
                     SELECT vol_organization_id, ROUND(SUM(-amount), 1) as total_out
                     FROM vol_org_transactions
                     WHERE tenant_id = ? AND amount < 0
                     GROUP BY vol_organization_id
                 ) vt_out ON vt_out.vol_organization_id = vo.id
                 WHERE vo.tenant_id = ?
                 GROUP BY vo.id, vo.name, vo.balance, vo.created_at, vt_in.total_in, vt_out.total_out
                 ORDER BY vo.balance DESC",
                [$tenantId, $tenantId, $tenantId]
            );

            foreach ($rowResults as $row) {
                $wallets[] = [
                    'id' => (int) $row->id,
                    'org_id' => (int) $row->org_id,
                    'org_name' => $row->org_name ?? 'Unknown',
                    'balance' => round((float) ($row->balance ?? 0), 1),
                    'total_in' => round((float) ($row->total_in ?? 0), 1),
                    'total_out' => round((float) ($row->total_out ?? 0), 1),
                    'member_count' => (int) ($row->member_count ?? 0),
                    'created_at' => $row->created_at ?? '',
                ];
            }
        } catch (\Throwable $e) { Log::warning('Stats query failed in ' . __METHOD__, ['error' => $e->getMessage()]); }

        return $this->respondWithData($wallets);
    }

    /** GET /api/v2/admin/timebanking/user-report */
    public function userReport(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $page = $this->queryInt('page', 1, 1);
        $perPage = $this->queryInt('per_page', 20, 1, 100);
        $search = trim($this->query('search', ''));
        $offset = ($page - 1) * $perPage;

        $where = "u.tenant_id = ?";
        $params = [$tenantId];

        if ($search !== '') {
            $where .= " AND (CONCAT(u.first_name, ' ', u.last_name) LIKE ? OR u.email LIKE ?)";
            $searchTerm = '%' . $search . '%';
            $params[] = $searchTerm;
            $params[] = $searchTerm;
        }

        $total = (int) DB::selectOne(
            "SELECT COUNT(*) as cnt FROM users u WHERE {$where}",
            $params
        )->cnt;

        $userResults = DB::select(
            "SELECT u.id, u.first_name, u.last_name, u.email, u.avatar_url, u.balance,
                    COALESCE(earned.total, 0) as total_earned,
                    COALESCE(spent.total, 0) as total_spent,
                    COALESCE(earned.cnt, 0) + COALESCE(spent.cnt, 0) as transaction_count
             FROM users u
             LEFT JOIN (
                 SELECT receiver_id, SUM(amount) as total, COUNT(*) as cnt
                 FROM transactions WHERE tenant_id = ? AND status = 'completed' GROUP BY receiver_id
             ) earned ON earned.receiver_id = u.id
             LEFT JOIN (
                 SELECT sender_id, SUM(amount) as total, COUNT(*) as cnt
                 FROM transactions WHERE tenant_id = ? AND status = 'completed' GROUP BY sender_id
             ) spent ON spent.sender_id = u.id
             WHERE {$where}
             ORDER BY u.balance DESC
             LIMIT ? OFFSET ?",
            array_merge([$tenantId, $tenantId], $params, [$perPage, $offset])
        );
        $users = array_map(fn($r) => (array)$r, $userResults);

        $formatted = array_map(fn($row) => [
            'id' => (int) $row['id'],
            'name' => trim($row['first_name'] . ' ' . $row['last_name']),
            'first_name' => $row['first_name'],
            'last_name' => $row['last_name'],
            'email' => $row['email'],
            'avatar_url' => $row['avatar_url'] ?? null,
            'balance' => round((float) ($row['balance'] ?? 0), 1),
            'total_earned' => round((float) ($row['total_earned'] ?? 0), 1),
            'total_spent' => round((float) ($row['total_spent'] ?? 0), 1),
            'transaction_count' => (int) ($row['transaction_count'] ?? 0),
        ], $users);

        return $this->respondWithPaginatedCollection($formatted, $total, $page, $perPage);
    }

    /** GET /api/v2/admin/timebanking/user-statement */
    public function userStatement(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $userId = $this->queryInt('user_id');
        if (!$userId) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.user_id_required'), 'user_id', 400);
        }

        $startDate = $this->query('start_date', date('Y-m-01', strtotime('-12 months')));
        $endDate = $this->query('end_date', date('Y-m-d'));
        $format = $this->query('format', 'json');

        $userRow = DB::selectOne(
            "SELECT id, first_name, last_name, email, balance FROM users WHERE id = ? AND tenant_id = ?",
            [$userId, $tenantId]
        );
        $user = $userRow ? (array)$userRow : null;

        if (!$user) {
            return $this->respondWithError('NOT_FOUND', __('api.user_not_found'), null, 404);
        }

        $txResults = DB::select(
            "SELECT t.*,
                    sender.first_name as sender_first_name, sender.last_name as sender_last_name,
                    receiver.first_name as receiver_first_name, receiver.last_name as receiver_last_name,
                    l.title as listing_title
             FROM transactions t
             LEFT JOIN users sender ON sender.id = t.sender_id
             LEFT JOIN users receiver ON receiver.id = t.receiver_id
             LEFT JOIN listings l ON l.id = t.listing_id
             WHERE t.tenant_id = ?
               AND (t.sender_id = ? OR t.receiver_id = ?)
               AND t.created_at BETWEEN ? AND ?
             ORDER BY t.created_at DESC",
            [$tenantId, $userId, $userId, $startDate . ' 00:00:00', $endDate . ' 23:59:59']
        );
        $transactions = array_map(fn($r) => (array)$r, $txResults);

        $earned = 0;
        $spent = 0;
        foreach ($transactions as $t) {
            if ((int) $t['receiver_id'] === $userId) $earned += (float) $t['amount'];
            if ((int) $t['sender_id'] === $userId) $spent += (float) $t['amount'];
        }

        $statement = [
            'user' => [
                'id' => (int) $user['id'],
                'first_name' => $user['first_name'],
                'last_name' => $user['last_name'],
                'email' => $user['email'],
                'balance' => (float) ($user['balance'] ?? 0),
            ],
            'period' => ['start' => $startDate, 'end' => $endDate],
            'summary' => [
                'total_transactions' => count($transactions),
                'hours_earned' => round($earned, 2),
                'hours_spent' => round($spent, 2),
                'net_change' => round($earned - $spent, 2),
                'current_balance' => (float) ($user['balance'] ?? 0),
            ],
            'transactions' => $transactions,
        ];

        if ($format === 'csv') {
            return $this->sendCsvStatementResponse($statement);
        }

        return $this->respondWithData($statement);
    }

    /** GET /api/v2/admin/timebanking/user-search */
    public function userSearchApi(): JsonResponse
    {
        $this->requireAdmin();

        $query = trim($this->query('q', ''));

        if (strlen($query) < 2) {
            return $this->respondWithData(['users' => []]);
        }

        $tenantId = $this->getTenantId();
        $searchTerm = '%' . $query . '%';

        $userResults = DB::select(
            "SELECT id, first_name, last_name, email, balance
             FROM users
             WHERE tenant_id = ?
             AND (CONCAT(first_name, ' ', last_name) LIKE ? OR email LIKE ? OR id = ?)
             ORDER BY first_name, last_name
             LIMIT 20",
            [$tenantId, $searchTerm, $searchTerm, (int) $query]
        );
        $users = array_map(fn($r) => (array)$r, $userResults);

        return $this->respondWithData(['users' => $users]);
    }

    /** Generate CSV response for user statement */
    private function sendCsvStatementResponse(array $statement): JsonResponse
    {
        $csv = "Date,Type,Description,Amount,Balance After\n";
        $runningBalance = $statement['summary']['current_balance'];

        foreach ($statement['transactions'] as $t) {
            $isEarned = ((int) $t['receiver_id'] === $statement['user']['id']);
            $type = $isEarned ? 'Earned' : 'Spent';
            $amount = $isEarned ? '+' . $t['amount'] : '-' . $t['amount'];
            $desc = str_replace('"', '""', $t['description'] ?? $t['listing_title'] ?? '');
            $csv .= "\"{$t['created_at']}\",\"{$type}\",\"{$desc}\",\"{$amount}\",\"{$runningBalance}\"\n";
        }

        return $this->respondWithData([
            'csv' => $csv,
            'filename' => "statement_{$statement['user']['id']}_{$statement['period']['start']}_{$statement['period']['end']}.csv",
        ]);
    }
}
