<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use App\I18n\LocaleContext;
use App\Models\ActivityLog;
use App\Support\UserDisplayName;

/**
 * AdminWalletGrantController -- Admin time credit grants.
 *
 * Allows admins to grant time credits to users and view grant history.
 * All methods require admin authentication.
 */
class AdminWalletGrantController extends BaseApiController
{
    protected bool $isV2Api = true;

    /**
     * GET /api/v2/admin/wallet/grants -- List admin grant history
     *
     * Query params:
     *   page     (int, default 1)
     *   per_page (int, default 20, max 100)
     *   search   (string, optional — filters by recipient name/email)
     */
    public function index(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $page = $this->queryInt('page', 1, 1);
        $perPage = $this->queryInt('per_page', 20, 1, 100);
        $search = $this->query('search');
        $offset = ($page - 1) * $perPage;

        $query = "SELECT t.*, u.first_name, u.last_name, u.email,
                  admin.first_name as admin_first_name, admin.last_name as admin_last_name,
 admin.profile_type as admin_profile_type,
 admin.organization_name as admin_organization_name
                  FROM transactions t
                  JOIN users u ON t.receiver_id = u.id
                  LEFT JOIN users admin ON t.sender_id = admin.id
                  WHERE t.tenant_id = ? AND t.transaction_type = 'admin_grant'";

        $countQuery = "SELECT COUNT(*) as total
                       FROM transactions t
                       JOIN users u ON t.receiver_id = u.id
                       WHERE t.tenant_id = ? AND t.transaction_type = 'admin_grant'";

        $params = [$tenantId];
        $countParams = [$tenantId];

        if ($search !== null && $search !== '') {
            $searchWildcard = '%' . $search . '%';
            $searchClause = " AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ?)";
            $query .= $searchClause;
            $countQuery .= $searchClause;
            $params[] = $searchWildcard;
            $params[] = $searchWildcard;
            $params[] = $searchWildcard;
            $countParams[] = $searchWildcard;
            $countParams[] = $searchWildcard;
            $countParams[] = $searchWildcard;
        }

        $totalRow = DB::selectOne($countQuery, $countParams);
        $total = (int) ($totalRow->total ?? 0);

        $query .= " ORDER BY t.created_at DESC LIMIT ? OFFSET ?";
        $params[] = $perPage;
        $params[] = $offset;

        $rows = DB::select($query, $params);

        $grants = array_map(function ($row) {
            return [
                'id' => (int) $row->id,
                'sender_id' => $row->sender_id ? (int) $row->sender_id : null,
                'receiver_id' => (int) $row->receiver_id,
                'amount' => round((float) $row->amount, 2),
                'description' => $row->description ?? '',
                'status' => $row->status ?? 'completed',
                'created_at' => $row->created_at,
                'recipient_name' => UserDisplayName::resolve($row),
                'recipient_email' => $row->email ?? '',
                'admin_name' => UserDisplayName::resolvePrefixed($row, 'admin_'),
            ];
        }, $rows);

        return $this->respondWithData([
            'grants' => $grants,
            'total' => $total,
            'page' => $page,
            'per_page' => $perPage,
        ]);
    }

    /**
     * POST /api/v2/admin/wallet/grant -- Grant time credits to a user
     *
     * Body params:
     *   user_id (int, required)
     *   amount  (float, required, must be > 0)
     *   reason  (string, optional)
     */
    public function store(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $input = $this->getAllInput();

        $userId = isset($input['user_id']) ? (int) $input['user_id'] : 0;
        $amount = isset($input['amount']) ? (float) $input['amount'] : 0;
        $reason = $input['reason'] ?? null;

        // Validate required fields
        if ($userId <= 0) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.user_id_positive_integer_required'), 'user_id', 422);
        }

        if ($amount <= 0) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.amount_gt_zero_required'), 'amount', 422);
        }

        if ($amount > 10000) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.grant_amount_max_10000'), 'amount', 422);
        }

        // Validate user exists and belongs to current tenant.
        // preferred_language is selected so the grant notification below renders
        // in the RECIPIENT's locale, not the admin's request locale.
        $user = DB::selectOne(
            "SELECT id, first_name, last_name, preferred_language FROM users WHERE id = ? AND tenant_id = ?",
            [$userId, $tenantId]
        );

        if (!$user) {
            return $this->respondWithError('USER_NOT_FOUND', __('api.user_not_found_in_tenant'), 'user_id', 404);
        }

        // Atomic: insert transaction + update balance
        $grantId = DB::transaction(function () use ($tenantId, $adminId, $userId, $amount, $reason) {
            DB::insert(
                "INSERT INTO transactions (tenant_id, sender_id, receiver_id, amount, transaction_type, description, status, created_at)
                 VALUES (?, ?, ?, ?, 'admin_grant', ?, 'completed', NOW())",
                [$tenantId, $adminId, $userId, $amount, $reason ?? 'Admin credit grant']
            );

            $id = (int) DB::getPdo()->lastInsertId();

            DB::update(
                "UPDATE users SET balance = balance + ? WHERE id = ? AND tenant_id = ?",
                [$amount, $userId, $tenantId]
            );

            return $id;
        });

        $userName = UserDisplayName::resolve($user);
        ActivityLog::log($adminId, 'admin_grant_credits', "Granted {$amount} credits to user #{$userId} ({$userName}). Reason: " . ($reason ?? 'Admin credit grant'));

        // Notify user of credit grant — rendered in the recipient's preferred
        // language (bell + device push), not the admin's request locale.
        try {
            LocaleContext::withLocale($user, function () use ($userId, $amount) {
                $unit = trans_choice('api_controllers_3.wallet_admin.hours_unit', (float) $amount);
                $msg = __('api_controllers_3.wallet_admin.grant_received', ['amount' => $amount, 'unit' => $unit]);
                \App\Models\Notification::createNotification(
                    $userId,
                    $msg,
                    '/wallet',
                    'transaction'
                );
                \App\Services\NotificationDispatcher::fanOutPush((int) ($userId), 'transaction', $msg, '/wallet');
            });
        } catch (\Throwable $e) {
            \Log::warning('Admin grant notification failed', ['user_id' => $userId, 'error' => $e->getMessage()]);
        }

        return $this->respondWithData([
            'grant' => [
                'id' => $grantId,
                'user_id' => $userId,
                'user_name' => $userName,
                'amount' => round($amount, 2),
                'reason' => $reason ?? 'Admin credit grant',
                'admin_id' => $adminId,
                'status' => 'completed',
            ],
            'message' => __('api_controllers_1.admin_wallet_grant.credits_granted'),
        ]);
    }
}
