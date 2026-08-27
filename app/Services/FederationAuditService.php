<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * FederationAuditService — Comprehensive audit logging for federation operations.
 *
 * Every cross-tenant interaction is logged for compliance, security monitoring,
 * debugging, usage analytics, and emergency incident investigation.
 */
class FederationAuditService
{
    /** Log levels */
    public const LEVEL_DEBUG = 'debug';
    public const LEVEL_INFO = 'info';
    public const LEVEL_WARNING = 'warning';
    public const LEVEL_CRITICAL = 'critical';

    /** Action categories */
    public const CATEGORY_SYSTEM = 'system';
    public const CATEGORY_TENANT = 'tenant';
    public const CATEGORY_PARTNERSHIP = 'partnership';
    public const CATEGORY_PROFILE = 'profile';
    public const CATEGORY_MESSAGING = 'messaging';
    public const CATEGORY_TRANSACTION = 'transaction';
    public const CATEGORY_LISTING = 'listing';
    public const CATEGORY_EVENT = 'event';
    public const CATEGORY_GROUP = 'group';
    public const CATEGORY_SEARCH = 'search';

    /**
     * Log a federation action.
     */
    public static function log(
        string $actionType,
        ?int $sourceTenantId = null,
        ?int $targetTenantId = null,
        ?int $actorUserId = null,
        array $data = [],
        string $level = self::LEVEL_INFO
    ): bool {
        // Auto-determine source tenant if not provided
        if ($sourceTenantId === null) {
            try {
                $sourceTenantId = TenantContext::getId();
            } catch (\Exception $e) {
                $sourceTenantId = null;
            }
        }

        // Get actor info if available
        // NOTE: actor_email is redacted to domain-only ('***@domain.com') to prevent
        // cross-tenant email address leakage when admins from different tenants view
        // the shared federation audit log. The actor_id field links to the users table
        // where authorised viewers can look up the full email if needed.
        $actorName = null;
        $actorEmail = null;
        if ($actorUserId) {
            try {
                $actor = DB::table('users')
                    ->where('id', $actorUserId)
                    ->select('first_name', 'last_name', 'profile_type', 'organization_name', 'email')
                    ->first();

                if ($actor) {
                    $actorName = UserDisplayName::resolve($actor);
                    if (!empty($actor->email)) {
                        $parts = explode('@', $actor->email);
                        $actorEmail = '***@' . ($parts[1] ?? 'unknown');
                    }
                }
            } catch (\Exception $e) {
                // Actor lookup failed — continue without actor details
            }
        }

        $category = self::getCategoryFromAction($actionType);
        $actionType = substr($actionType, 0, 255);

        try {
            DB::table('federation_audit_log')->insert([
                'action_type' => $actionType,
                'category' => $category,
                'level' => $level,
                'source_tenant_id' => $sourceTenantId,
                'target_tenant_id' => $targetTenantId,
                'actor_user_id' => $actorUserId,
                'actor_name' => $actorName,
                'actor_email' => $actorEmail,
                'data' => !empty($data) ? json_encode($data) : null,
                'ip_address' => request()->ip(),
                'user_agent' => substr(request()->userAgent() ?? '', 0, 500) ?: null,
                'created_at' => now(),
            ]);

            if ($level === self::LEVEL_CRITICAL) {
                Log::critical("[FEDERATION CRITICAL] {$actionType}", [
                    'source_tenant' => $sourceTenantId,
                    'target_tenant' => $targetTenantId,
                    'actor' => $actorUserId,
                    'data' => $data,
                ]);
            }

            return true;
        } catch (\Exception $e) {
            Log::error('FederationAuditService::log error: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Log a federated search query.
     */
    public static function logSearch(string $searchType, array $filters, int $resultsCount, ?int $actorUserId = null): bool
    {
        return self::log(
            'federated_search',
            null,
            null,
            $actorUserId,
            ['search_type' => $searchType, 'filters' => $filters, 'results_count' => $resultsCount],
            self::LEVEL_DEBUG
        );
    }

    /**
     * Log a cross-tenant profile view.
     */
    public static function logProfileView(int $viewerUserId, int $viewerTenantId, int $viewedUserId, int $viewedTenantId): bool
    {
        return self::log(
            'cross_tenant_profile_view',
            $viewerTenantId,
            $viewedTenantId,
            $viewerUserId,
            ['viewed_user_id' => $viewedUserId],
            self::LEVEL_DEBUG
        );
    }

    /**
     * Log a cross-tenant message.
     */
    public static function logMessage(int $senderUserId, int $senderTenantId, int $recipientUserId, int $recipientTenantId, ?int $messageId = null): bool
    {
        return self::log(
            'cross_tenant_message',
            $senderTenantId,
            $recipientTenantId,
            $senderUserId,
            ['recipient_user_id' => $recipientUserId, 'message_id' => $messageId],
            self::LEVEL_INFO
        );
    }

    /**
     * Log a cross-tenant transaction.
     */
    public static function logTransaction(int $initiatorUserId, int $initiatorTenantId, int $counterpartyUserId, int $counterpartyTenantId, int $transactionId, string $transactionType, float $amount): bool
    {
        return self::log(
            'cross_tenant_transaction',
            $initiatorTenantId,
            $counterpartyTenantId,
            $initiatorUserId,
            [
                'counterparty_user_id' => $counterpartyUserId,
                'transaction_id' => $transactionId,
                'transaction_type' => $transactionType,
                'amount' => $amount,
            ],
            self::LEVEL_INFO
        );
    }

    /**
     * Log a partnership status change.
     */
    public static function logPartnershipChange(int $tenantId, int $partnerTenantId, string $newStatus, ?int $actorUserId = null, ?string $reason = null): bool
    {
        return self::log(
            'partnership_status_changed',
            $tenantId,
            $partnerTenantId,
            $actorUserId,
            ['new_status' => $newStatus, 'reason' => $reason],
            self::LEVEL_INFO
        );
    }

    /**
     * Get audit log entries with filters.
     */
    public static function getLog(array $filters = []): array
    {
        try {
            $query = DB::table('federation_audit_log');

            if (!empty($filters['category'])) {
                $query->where('category', $filters['category']);
            }
            if (!empty($filters['level'])) {
                $query->where('level', $filters['level']);
            }
            if (!empty($filters['action_type'])) {
                $query->where('action_type', $filters['action_type']);
            }
            if (!empty($filters['source_tenant_id'])) {
                $query->where('source_tenant_id', $filters['source_tenant_id']);
            }
            if (!empty($filters['target_tenant_id'])) {
                $query->where('target_tenant_id', $filters['target_tenant_id']);
            }
            if (!empty($filters['actor_user_id'])) {
                $query->where('actor_user_id', $filters['actor_user_id']);
            }
            if (!empty($filters['date_from'])) {
                $query->where('created_at', '>=', $filters['date_from'] . ' 00:00:00');
            }
            if (!empty($filters['date_to'])) {
                $query->where('created_at', '<=', $filters['date_to'] . ' 23:59:59');
            }
            if (!empty($filters['search'])) {
                $searchTerm = '%' . $filters['search'] . '%';
                $query->where(function ($q) use ($searchTerm) {
                    $q->where('action_type', 'LIKE', $searchTerm)
                      ->orWhere('data', 'LIKE', $searchTerm)
                      ->orWhere('actor_name', 'LIKE', $searchTerm);
                });
            }

            $limit = min((int) ($filters['limit'] ?? 100), 1000);
            $query->orderByDesc('created_at')->limit($limit);

            if (!empty($filters['offset'])) {
                $query->offset((int) $filters['offset']);
            }

            $results = $query->get()->map(function ($row) {
                $row = (array) $row;
                $row['data'] = $row['data'] ? json_decode($row['data'], true) : null;
                return $row;
            })->all();

            return $results;
        } catch (\Exception $e) {
            Log::error('FederationAuditService::getLog error: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Get audit statistics.
     */
    public static function getStats(int $days = 30): array
    {
        $since = now()->subDays($days);

        try {
            $total = DB::table('federation_audit_log')
                ->where('created_at', '>=', $since)
                ->count();

            $byCategory = DB::table('federation_audit_log')
                ->select('category', DB::raw('COUNT(*) as count'))
                ->where('created_at', '>=', $since)
                ->groupBy('category')
                ->orderByDesc('count')
                ->get()->toArray();

            $byLevel = DB::table('federation_audit_log')
                ->select('level', DB::raw('COUNT(*) as count'))
                ->where('created_at', '>=', $since)
                ->groupBy('level')
                ->orderByDesc('count')
                ->get()->toArray();

            $criticalCount = DB::table('federation_audit_log')
                ->where('created_at', '>=', $since)
                ->where('level', 'critical')
                ->count();

            $topActions = DB::table('federation_audit_log')
                ->select('action_type', DB::raw('COUNT(*) as count'))
                ->where('created_at', '>=', $since)
                ->groupBy('action_type')
                ->orderByDesc('count')
                ->limit(10)
                ->get()->toArray();

            $activePairs = DB::table('federation_audit_log')
                ->select('source_tenant_id', 'target_tenant_id', DB::raw('COUNT(*) as interactions'))
                ->where('created_at', '>=', $since)
                ->whereNotNull('source_tenant_id')
                ->whereNotNull('target_tenant_id')
                ->groupBy('source_tenant_id', 'target_tenant_id')
                ->orderByDesc('interactions')
                ->limit(10)
                ->get()->toArray();

            return [
                'total_actions' => $total,
                'by_category' => $byCategory,
                'by_level' => $byLevel,
                'critical_count' => $criticalCount,
                'top_actions' => $topActions,
                'active_pairs' => $activePairs,
                'period_days' => $days,
            ];
        } catch (\Exception $e) {
            Log::error('FederationAuditService::getStats error: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Get recent critical events.
     */
    public static function getRecentCritical(int $limit = 10): array
    {
        return self::getLog(['level' => self::LEVEL_CRITICAL, 'limit' => $limit]);
    }

    /**
     * Purge old audit logs (retention policy).
     */
    public static function purgeOld(int $retentionDays = 365): int
    {
        $cutoffDate = now()->subDays($retentionDays);
        $criticalCutoff = now()->subDays($retentionDays * 2);

        try {
            $deleted = DB::table('federation_audit_log')
                ->where(function ($q) use ($cutoffDate, $criticalCutoff) {
                    $q->where(function ($q2) use ($cutoffDate) {
                        $q2->where('level', '!=', 'critical')
                           ->where('created_at', '<', $cutoffDate);
                    })->orWhere(function ($q2) use ($criticalCutoff) {
                        $q2->where('level', 'critical')
                           ->where('created_at', '<', $criticalCutoff);
                    });
                })
                ->delete();

            self::log(
                'audit_log_purged',
                null, null, null,
                ['deleted_count' => $deleted, 'retention_days' => $retentionDays, 'cutoff_date' => $cutoffDate->toDateTimeString()],
                self::LEVEL_INFO
            );

            return $deleted;
        } catch (\Exception $e) {
            Log::error('FederationAuditService::purgeOld error: ' . $e->getMessage());
            return 0;
        }
    }

    /**
     * Get human-readable action label.
     */
    public static function getActionLabel(string $actionType): string
    {
        $labels = [
            'emergency_lockdown_triggered' => 'audit.emergency_lockdown_triggered',
            'emergency_lockdown_lifted' => 'audit.emergency_lockdown_lifted',
            'system_feature_changed' => 'audit.system_feature_changed',
            'tenant_feature_changed' => 'audit.tenant_feature_changed',
            'tenant_whitelisted' => 'audit.tenant_whitelisted',
            'tenant_removed_from_whitelist' => 'audit.tenant_removed_from_whitelist',
            'partnership_requested' => 'audit.partnership_requested',
            'partnership_approved' => 'audit.partnership_approved',
            'partnership_rejected' => 'audit.partnership_rejected',
            'partnership_status_changed' => 'audit.partnership_status_changed',
            'cross_tenant_profile_view' => 'audit.cross_tenant_profile_view',
            'cross_tenant_message' => 'audit.cross_tenant_message',
            'cross_tenant_transaction' => 'audit.cross_tenant_transaction',
            'federated_search' => 'audit.federated_search',
            'audit_log_purged' => 'audit.audit_log_purged',
        ];

        if (isset($labels[$actionType])) {
            return __('federation.' . $labels[$actionType]);
        }

        return __('federation.audit.unknown', [
            'action' => ucwords(str_replace('_', ' ', $actionType)),
        ]);
    }

    /**
     * Get icon class for action type.
     */
    public static function getActionIcon(string $actionType): string
    {
        $icons = [
            'emergency_lockdown_triggered' => 'fa-exclamation-triangle text-danger',
            'emergency_lockdown_lifted' => 'fa-check-circle text-success',
            'tenant_whitelisted' => 'fa-user-check text-success',
            'tenant_removed_from_whitelist' => 'fa-user-times text-warning',
            'partnership_requested' => 'fa-handshake text-info',
            'partnership_approved' => 'fa-check text-success',
            'partnership_rejected' => 'fa-times text-danger',
            'cross_tenant_profile_view' => 'fa-eye text-muted',
            'cross_tenant_message' => 'fa-envelope text-primary',
            'cross_tenant_transaction' => 'fa-exchange-alt text-success',
            'federated_search' => 'fa-search text-info',
        ];

        return $icons[$actionType] ?? 'fa-circle';
    }

    /**
     * Get level badge class.
     */
    public static function getLevelBadge(string $level): string
    {
        $badges = [
            self::LEVEL_DEBUG => 'badge-secondary',
            self::LEVEL_INFO => 'badge-info',
            self::LEVEL_WARNING => 'badge-warning',
            self::LEVEL_CRITICAL => 'badge-danger',
        ];

        return $badges[$level] ?? 'badge-secondary';
    }

    /**
     * Determine category from action type.
     */
    private static function getCategoryFromAction(string $actionType): string
    {
        $categoryMap = [
            'emergency_lockdown_triggered' => self::CATEGORY_SYSTEM,
            'emergency_lockdown_lifted' => self::CATEGORY_SYSTEM,
            'system_feature_changed' => self::CATEGORY_SYSTEM,
            'whitelist_mode_changed' => self::CATEGORY_SYSTEM,
            'audit_log_purged' => self::CATEGORY_SYSTEM,
            'tenant_feature_changed' => self::CATEGORY_TENANT,
            'tenant_whitelisted' => self::CATEGORY_TENANT,
            'tenant_removed_from_whitelist' => self::CATEGORY_TENANT,
            'tenant_federation_enabled' => self::CATEGORY_TENANT,
            'tenant_federation_disabled' => self::CATEGORY_TENANT,
            'partnership_requested' => self::CATEGORY_PARTNERSHIP,
            'partnership_approved' => self::CATEGORY_PARTNERSHIP,
            'partnership_rejected' => self::CATEGORY_PARTNERSHIP,
            'partnership_revoked' => self::CATEGORY_PARTNERSHIP,
            'partnership_status_changed' => self::CATEGORY_PARTNERSHIP,
            'cross_tenant_profile_view' => self::CATEGORY_PROFILE,
            'profile_visibility_changed' => self::CATEGORY_PROFILE,
            'cross_tenant_message' => self::CATEGORY_MESSAGING,
            'cross_tenant_message_blocked' => self::CATEGORY_MESSAGING,
            'cross_tenant_transaction' => self::CATEGORY_TRANSACTION,
            'cross_tenant_transaction_failed' => self::CATEGORY_TRANSACTION,
            'listing_federated' => self::CATEGORY_LISTING,
            'listing_unfederated' => self::CATEGORY_LISTING,
            'event_federated' => self::CATEGORY_EVENT,
            'event_unfederated' => self::CATEGORY_EVENT,
            'cross_tenant_event_join' => self::CATEGORY_EVENT,
            'group_federation_enabled' => self::CATEGORY_GROUP,
            'cross_tenant_group_join' => self::CATEGORY_GROUP,
            'federated_search' => self::CATEGORY_SEARCH,
        ];

        return $categoryMap[$actionType] ?? self::CATEGORY_SYSTEM;
    }
}
