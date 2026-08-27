<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * AuditLogService — Audit logging for organization wallet operations and admin actions.
 *
 * Tracks all significant actions with IP addresses, user agents, and detailed context.
 * All write operations are tenant-scoped.
 *
 * This service was converted from static to instance methods as part of the TD9
 * service layer DI refactor. Resolve via DI (constructor inject) or
 * `app(AuditLogService::class)`. See docs/SERVICE_LAYER.md for the migration pattern.
 */
class AuditLogService
{
    // ─── Action type constants ───────────────────────────────────────
    public const ACTION_WALLET_DEPOSIT = 'wallet_deposit';
    public const ACTION_WALLET_WITHDRAWAL = 'wallet_withdrawal';
    public const ACTION_TRANSFER_REQUEST = 'transfer_request';
    public const ACTION_TRANSFER_APPROVE = 'transfer_approve';
    public const ACTION_TRANSFER_REJECT = 'transfer_reject';
    public const ACTION_TRANSFER_CANCEL = 'transfer_cancel';
    public const ACTION_MEMBER_ADDED = 'member_added';
    public const ACTION_MEMBER_REMOVED = 'member_removed';
    public const ACTION_MEMBER_ROLE_CHANGED = 'member_role_changed';
    public const ACTION_OWNERSHIP_TRANSFERRED = 'ownership_transferred';
    public const ACTION_SETTINGS_CHANGED = 'settings_changed';
    public const ACTION_LIMITS_CHANGED = 'limits_changed';
    public const ACTION_BULK_APPROVE = 'bulk_approve';
    public const ACTION_BULK_REJECT = 'bulk_reject';

    // Admin user management actions
    public const ACTION_ADMIN_USER_CREATED = 'admin_user_created';
    public const ACTION_ADMIN_USER_UPDATED = 'admin_user_updated';
    public const ACTION_ADMIN_USER_DELETED = 'admin_user_deleted';
    public const ACTION_ADMIN_USER_SUSPENDED = 'admin_user_suspended';
    public const ACTION_ADMIN_USER_BANNED = 'admin_user_banned';
    public const ACTION_ADMIN_USER_REACTIVATED = 'admin_user_reactivated';
    public const ACTION_ADMIN_USER_APPROVED = 'admin_user_approved';
    public const ACTION_ADMIN_ROLE_CHANGED = 'admin_role_changed';
    public const ACTION_ADMIN_2FA_RESET = 'admin_2fa_reset';
    public const ACTION_ADMIN_USER_IMPERSONATED = 'admin_user_impersonated';
    public const ACTION_ADMIN_SUPER_ADMIN_REVOKED = 'admin_super_admin_revoked';
    public const ACTION_ADMIN_BULK_IMPORT = 'admin_bulk_import';

    // ─── Action labels ───────────────────────────────────────────────
    private const ACTION_LABELS = [
        self::ACTION_WALLET_DEPOSIT => 'Wallet Deposit',
        self::ACTION_WALLET_WITHDRAWAL => 'Wallet Withdrawal',
        self::ACTION_TRANSFER_REQUEST => 'Transfer Request Created',
        self::ACTION_TRANSFER_APPROVE => 'Transfer Request Approved',
        self::ACTION_TRANSFER_REJECT => 'Transfer Request Rejected',
        self::ACTION_TRANSFER_CANCEL => 'Transfer Request Cancelled',
        self::ACTION_MEMBER_ADDED => 'Member Added',
        self::ACTION_MEMBER_REMOVED => 'Member Removed',
        self::ACTION_MEMBER_ROLE_CHANGED => 'Member Role Changed',
        self::ACTION_OWNERSHIP_TRANSFERRED => 'Ownership Transferred',
        self::ACTION_SETTINGS_CHANGED => 'Settings Changed',
        self::ACTION_LIMITS_CHANGED => 'Limits Changed',
        self::ACTION_BULK_APPROVE => 'Bulk Approval',
        self::ACTION_BULK_REJECT => 'Bulk Rejection',
        self::ACTION_ADMIN_USER_CREATED => 'Admin Created User',
        self::ACTION_ADMIN_USER_UPDATED => 'Admin Updated User',
        self::ACTION_ADMIN_USER_DELETED => 'Admin Deleted User',
        self::ACTION_ADMIN_USER_SUSPENDED => 'Admin Suspended User',
        self::ACTION_ADMIN_USER_BANNED => 'Admin Banned User',
        self::ACTION_ADMIN_USER_REACTIVATED => 'Admin Reactivated User',
        self::ACTION_ADMIN_USER_APPROVED => 'Admin Approved User',
        self::ACTION_ADMIN_ROLE_CHANGED => 'Admin Changed User Role',
        self::ACTION_ADMIN_2FA_RESET => 'Admin Reset 2FA',
        self::ACTION_ADMIN_USER_IMPERSONATED => 'Admin Impersonated User',
        self::ACTION_ADMIN_SUPER_ADMIN_REVOKED => 'Super Admin Revoked',
        self::ACTION_ADMIN_BULK_IMPORT => 'Admin Bulk Import Users',
    ];

    // ─── Instance method (DI-friendly) ──────────────────────────────

    /**
     * Log an auditable action (explicit tenant signature — legacy helper).
     */
    public function logAction(
        int $tenantId,
        string $action,
        ?int $userId = null,
        array $details = [],
        ?int $organizationId = null,
        ?int $targetUserId = null,
    ): int {
        return DB::table('org_audit_log')->insertGetId([
            'tenant_id'       => $tenantId,
            'organization_id' => $organizationId,
            'user_id'         => $userId,
            'target_user_id'  => $targetUserId,
            'action'          => $action,
            'details'         => !empty($details) ? json_encode($details) : null,
            'ip_address'      => request()->ip(),
            'user_agent'      => request()->userAgent(),
            'created_at'      => now(),
        ]);
    }

    /**
     * Get recent audit log entries for a tenant.
     */
    public function getRecent(int $tenantId, int $limit = 50, ?int $organizationId = null): array
    {
        $query = DB::table('org_audit_log as a')
            ->leftJoin('users as u', 'a.user_id', '=', 'u.id')
            ->where('a.tenant_id', $tenantId)
            ->select([
                'a.id', 'a.action', 'a.details', 'a.ip_address',
                'a.created_at', 'a.user_id', 'a.target_user_id',
                DB::raw(UserDisplayName::sql('u', 'actor_name')),
            ])
            ->orderByDesc('a.created_at')
            ->limit($limit);

        if ($organizationId !== null) {
            $query->where('a.organization_id', $organizationId);
        }

        return $query->get()->map(function ($row) {
            $row->details = $row->details ? json_decode($row->details, true) : null;
            return (array) $row;
        })->all();
    }

    // ─── Logging helpers ─────────────────────────────────────────────

    /**
     * Log an action.
     */
    public function log($action, $organizationId = null, $userId = null, $details = [], $targetUserId = null)
    {
        $tenantId = TenantContext::getId();

        try {
            return DB::table('org_audit_log')->insertGetId([
                'tenant_id'       => $tenantId,
                'organization_id' => $organizationId,
                'user_id'         => $userId,
                'target_user_id'  => $targetUserId,
                'action'          => $action,
                'details'         => !empty($details) ? json_encode($details) : null,
                'ip_address'      => request()->ip(),
                'user_agent'      => request()->userAgent(),
                'created_at'      => now(),
            ]);
        } catch (\Exception $e) {
            Log::warning('AuditLogService: Failed to log action - ' . $e->getMessage());
            return null;
        }
    }

    /**
     * Log an admin user management action (no organization context).
     */
    public function logAdminAction($action, $adminUserId, $targetUserId = null, $details = [])
    {
        return $this->log($action, null, $adminUserId, $details, $targetUserId);
    }

    public function logUserUpdated($adminUserId, $targetUserId, $changedFields = [])
    {
        return $this->logAdminAction(self::ACTION_ADMIN_USER_UPDATED, $adminUserId, $targetUserId, [
            'changed_fields' => $changedFields,
        ]);
    }

    public function logAdminRoleChanged($adminUserId, $targetUserId, $oldRole, $newRole)
    {
        return $this->logAdminAction(self::ACTION_ADMIN_ROLE_CHANGED, $adminUserId, $targetUserId, [
            'old_role' => $oldRole,
            'new_role' => $newRole,
        ]);
    }

    public function logUserCreated($adminUserId, $targetUserId, $targetEmail = '')
    {
        return $this->logAdminAction(self::ACTION_ADMIN_USER_CREATED, $adminUserId, $targetUserId, [
            'created_email' => $targetEmail,
        ]);
    }

    public function logUserApproved($adminUserId, $targetUserId, $targetEmail = '')
    {
        return $this->logAdminAction(self::ACTION_ADMIN_USER_APPROVED, $adminUserId, $targetUserId, [
            'approved_email' => $targetEmail,
        ]);
    }

    public function logUserSuspended($adminUserId, $targetUserId, $reason = '')
    {
        return $this->logAdminAction(self::ACTION_ADMIN_USER_SUSPENDED, $adminUserId, $targetUserId, [
            'reason' => $reason,
        ]);
    }

    public function logUserBanned($adminUserId, $targetUserId, $reason = '')
    {
        return $this->logAdminAction(self::ACTION_ADMIN_USER_BANNED, $adminUserId, $targetUserId, [
            'reason' => $reason,
        ]);
    }

    public function logUserReactivated($adminUserId, $targetUserId, $previousStatus = '')
    {
        return $this->logAdminAction(self::ACTION_ADMIN_USER_REACTIVATED, $adminUserId, $targetUserId, [
            'previous_status' => $previousStatus,
        ]);
    }

    public function logUserDeleted($adminUserId, $targetUserId, $targetEmail = '')
    {
        return $this->logAdminAction(self::ACTION_ADMIN_USER_DELETED, $adminUserId, $targetUserId, [
            'deleted_email' => $targetEmail,
        ]);
    }

    public function log2faReset($adminUserId, $targetUserId, $reason = '')
    {
        return $this->logAdminAction(self::ACTION_ADMIN_2FA_RESET, $adminUserId, $targetUserId, [
            'reason' => $reason,
        ]);
    }

    public function logUserImpersonated($adminUserId, $targetUserId, $targetEmail = '')
    {
        return $this->logAdminAction(self::ACTION_ADMIN_USER_IMPERSONATED, $adminUserId, $targetUserId, [
            'impersonated_email' => $targetEmail,
        ]);
    }

    public function logSuperAdminRevoked($adminUserId, $targetUserId, $targetEmail = '')
    {
        return $this->logAdminAction(self::ACTION_ADMIN_SUPER_ADMIN_REVOKED, $adminUserId, $targetUserId, [
            'revoked_email' => $targetEmail,
        ]);
    }

    public function logBulkImport($adminUserId, $importedCount, $skippedCount, $totalRows)
    {
        return $this->logAdminAction(self::ACTION_ADMIN_BULK_IMPORT, $adminUserId, null, [
            'imported_count' => $importedCount,
            'skipped_count' => $skippedCount,
            'total_rows' => $totalRows,
        ]);
    }

    // ─── Organization-level audit helpers ────────────────────────────

    public function logTransaction($organizationId, $userId, $type, $amount, $recipientId = null, $description = '')
    {
        $action = $type === 'deposit' ? self::ACTION_WALLET_DEPOSIT : self::ACTION_WALLET_WITHDRAWAL;
        return $this->log($action, $organizationId, $userId, [
            'amount' => $amount,
            'description' => $description,
            'recipient_id' => $recipientId,
        ], $recipientId);
    }

    public function logTransferRequest($organizationId, $requesterId, $recipientId, $amount, $description = '')
    {
        return $this->log(self::ACTION_TRANSFER_REQUEST, $organizationId, $requesterId, [
            'amount' => $amount,
            'description' => $description,
        ], $recipientId);
    }

    public function logTransferApproval($organizationId, $approverId, $requestId, $recipientId, $amount)
    {
        return $this->log(self::ACTION_TRANSFER_APPROVE, $organizationId, $approverId, [
            'request_id' => $requestId,
            'amount' => $amount,
        ], $recipientId);
    }

    public function logTransferRejection($organizationId, $approverId, $requestId, $recipientId, $reason = '')
    {
        return $this->log(self::ACTION_TRANSFER_REJECT, $organizationId, $approverId, [
            'request_id' => $requestId,
            'reason' => $reason,
        ], $recipientId);
    }

    public function logMemberAdded($organizationId, $addedBy, $memberId, $role)
    {
        return $this->log(self::ACTION_MEMBER_ADDED, $organizationId, $addedBy, [
            'role' => $role,
        ], $memberId);
    }

    public function logMemberRemoved($organizationId, $removedBy, $memberId, $reason = '')
    {
        return $this->log(self::ACTION_MEMBER_REMOVED, $organizationId, $removedBy, [
            'reason' => $reason,
        ], $memberId);
    }

    public function logRoleChanged($organizationId, $changedBy, $memberId, $oldRole, $newRole)
    {
        return $this->log(self::ACTION_MEMBER_ROLE_CHANGED, $organizationId, $changedBy, [
            'old_role' => $oldRole,
            'new_role' => $newRole,
        ], $memberId);
    }

    public function logOwnershipTransfer($organizationId, $oldOwnerId, $newOwnerId)
    {
        return $this->log(self::ACTION_OWNERSHIP_TRANSFERRED, $organizationId, $oldOwnerId, [
            'previous_owner_id' => $oldOwnerId,
        ], $newOwnerId);
    }

    public function logSettingsChanged($organizationId, $userId, $changes)
    {
        return $this->log(self::ACTION_SETTINGS_CHANGED, $organizationId, $userId, [
            'changes' => $changes,
        ]);
    }

    public function logLimitsChanged($organizationId, $userId, $oldLimits, $newLimits)
    {
        return $this->log(self::ACTION_LIMITS_CHANGED, $organizationId, $userId, [
            'old_limits' => $oldLimits,
            'new_limits' => $newLimits,
        ]);
    }

    public function logBulkApproval($organizationId, $approverId, $requestIds, $successCount, $failCount)
    {
        return $this->log(self::ACTION_BULK_APPROVE, $organizationId, $approverId, [
            'request_ids' => $requestIds,
            'approved_count' => $successCount,
            'failed_count' => $failCount,
        ]);
    }

    public function logBulkRejection($organizationId, $approverId, $requestIds, $successCount, $failCount, $reason = '')
    {
        return $this->log(self::ACTION_BULK_REJECT, $organizationId, $approverId, [
            'request_ids' => $requestIds,
            'rejected_count' => $successCount,
            'failed_count' => $failCount,
            'reason' => $reason,
        ]);
    }

    // ─── Query helpers ───────────────────────────────────────────────

    /**
     * Get audit log for an organization.
     */
    public function getLog($organizationId, $filters = [], $limit = 50, $offset = 0)
    {
        $tenantId = TenantContext::getId();

        $query = DB::table('org_audit_log as al')
            ->leftJoin('users as u', 'al.user_id', '=', 'u.id')
            ->leftJoin('users as tu', 'al.target_user_id', '=', 'tu.id')
            ->where('al.tenant_id', $tenantId)
            ->where('al.organization_id', $organizationId)
            ->select([
                'al.*',
                'u.first_name', 'u.last_name', 'u.profile_type', 'u.organization_name',
                DB::raw(UserDisplayName::sql('u', 'user_name')),
                DB::raw("tu.first_name as target_first_name"),
                DB::raw("tu.last_name as target_last_name"),
                DB::raw(UserDisplayName::sql('tu', 'target_user_name')),
            ]);

        if (!empty($filters['action'])) {
            $query->where('al.action', $filters['action']);
        }

        if (!empty($filters['userId'])) {
            $query->where(function ($q) use ($filters) {
                $q->where('al.user_id', $filters['userId'])
                  ->orWhere('al.target_user_id', $filters['userId']);
            });
        }

        if (!empty($filters['startDate'])) {
            $query->where('al.created_at', '>=', $filters['startDate'] . ' 00:00:00');
        }

        if (!empty($filters['endDate'])) {
            $query->where('al.created_at', '<=', $filters['endDate'] . ' 23:59:59');
        }

        try {
            $logs = $query->orderByDesc('al.created_at')
                ->limit((int) $limit)
                ->offset((int) $offset)
                ->get()
                ->map(function ($row) {
                    $row = (array) $row;
                    $row['details'] = $row['details'] ? json_decode($row['details'], true) : [];
                    return $row;
                })
                ->all();

            return $logs;
        } catch (\Exception $e) {
            Log::warning('[AuditLog] Failed to fetch audit logs: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Get audit log count for pagination.
     */
    public function getLogCount($organizationId, $filters = [])
    {
        $tenantId = TenantContext::getId();

        $query = DB::table('org_audit_log')
            ->where('tenant_id', $tenantId)
            ->where('organization_id', $organizationId);

        if (!empty($filters['action'])) {
            $query->where('action', $filters['action']);
        }

        if (!empty($filters['userId'])) {
            $query->where(function ($q) use ($filters) {
                $q->where('user_id', $filters['userId'])
                  ->orWhere('target_user_id', $filters['userId']);
            });
        }

        try {
            return (int) $query->count();
        } catch (\Exception $e) {
            Log::warning('[AuditLog] Failed to count audit logs: ' . $e->getMessage());
            return 0;
        }
    }

    /**
     * Get action summary for dashboard.
     */
    public function getActionSummary($organizationId, $days = 30)
    {
        $tenantId = TenantContext::getId();

        try {
            return DB::table('org_audit_log')
                ->where('tenant_id', $tenantId)
                ->where('organization_id', $organizationId)
                ->where('created_at', '>=', DB::raw("DATE_SUB(NOW(), INTERVAL " . ((int) $days) . " DAY)"))
                ->select('action', DB::raw('COUNT(*) as count'))
                ->groupBy('action')
                ->orderByDesc('count')
                ->get()
                ->map(fn ($row) => (array) $row)
                ->all();
        } catch (\Exception $e) {
            Log::warning('[AuditLog] Failed to fetch action summary: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Get recent activity for a user.
     */
    public function getUserActivity($userId, $limit = 20)
    {
        $tenantId = TenantContext::getId();

        try {
            $logs = DB::table('org_audit_log as al')
                ->leftJoin('vol_organizations as vo', 'al.organization_id', '=', 'vo.id')
                ->where('al.tenant_id', $tenantId)
                ->where(function ($q) use ($userId) {
                    $q->where('al.user_id', $userId)
                      ->orWhere('al.target_user_id', $userId);
                })
                ->select('al.*', 'vo.name as org_name')
                ->orderByDesc('al.created_at')
                ->limit($limit)
                ->get()
                ->map(function ($row) {
                    $row = (array) $row;
                    $row['details'] = $row['details'] ? json_decode($row['details'], true) : [];
                    return $row;
                })
                ->all();

            return $logs;
        } catch (\Exception $e) {
            Log::warning('[AuditLog] Failed to fetch user activity: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Get human-readable action label.
     *
     * Remains static because labels are pure data (no state, no dependencies).
     */
    public static function getActionLabel($action)
    {
        return self::ACTION_LABELS[$action] ?? ucwords(str_replace('_', ' ', $action));
    }

    /**
     * Export audit log to CSV.
     */
    public function exportToCSV($organizationId, $filters = [])
    {
        $logs = $this->getLog($organizationId, $filters, 10000, 0);

        if (empty($logs)) {
            return '';
        }

        $output = fopen('php://temp', 'r+');
        fwrite($output, "\xEF\xBB\xBF"); // UTF-8 BOM

        fputcsv($output, ['Date', 'Action', 'User', 'Target User', 'Details', 'IP Address']);

        foreach ($logs as $log) {
            $detailsStr = '';
            if (!empty($log['details'])) {
                $parts = [];
                foreach ($log['details'] as $key => $value) {
                    if (is_array($value)) {
                        $value = json_encode($value);
                    }
                    $parts[] = "$key: $value";
                }
                $detailsStr = implode('; ', $parts);
            }

            // CSV injection prevention: sanitize user-controlled values
            $row = array_map(function ($v) {
                return is_string($v) && preg_match('/^[=+\-@\t\r]/', $v) ? "'" . $v : $v;
            }, [
                $log['created_at'],
                self::getActionLabel($log['action']),
                $log['user_name'] ?? 'System',
                $log['target_user_name'] ?? '-',
                $detailsStr,
                $log['ip_address'] ?? '-',
            ]);
            fputcsv($output, $row);
        }

        rewind($output);
        $csv = stream_get_contents($output);
        fclose($output);

        return $csv;
    }

    /**
     * Clean up old audit logs.
     *
     * @return int Number of deleted entries
     */
    public function cleanup($daysToKeep = 365)
    {
        try {
            return DB::table('org_audit_log')
                ->where('created_at', '<', DB::raw("DATE_SUB(NOW(), INTERVAL " . ((int) $daysToKeep) . " DAY)"))
                ->delete();
        } catch (\Exception $e) {
            Log::warning('AuditLogService: Cleanup failed - ' . $e->getMessage());
            return 0;
        }
    }
}
