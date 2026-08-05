<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Services\AuditLogService;
use App\Services\BrokerControlConfigService;
use App\Services\ExchangeWorkflowService;
use App\Services\ListingRiskTagService;
use App\Services\BrokerMessageVisibilityService;
use App\Services\NotificationDispatcher;
use App\Models\Notification;

/**
 * AdminBrokerController -- Admin time-broker exchange monitoring and risk management.
 *
 * Converted from legacy delegation to direct DB/service calls.
 */
class AdminBrokerController extends BaseApiController
{
    protected bool $isV2Api = true;

    /** @var list<string> */
    private const RETIRED_VETTING_CONFIG_KEYS = [
        'vetting_enabled',
        'enforce_vetting_on_exchanges',
        'vetting_expiry_warning_days',
    ];

    public function __construct(
        private readonly BrokerControlConfigService $brokerControlConfigService,
        private readonly BrokerMessageVisibilityService $brokerMessageVisibilityService,
        private readonly ExchangeWorkflowService $exchangeWorkflowService,
        private readonly NotificationDispatcher $notificationDispatcher,
        private readonly AuditLogService $auditLogService,
    ) {}

    /** @param array<string, mixed> $config @return array<string, mixed> */
    private function withoutRetiredVettingConfig(array $config): array
    {
        return array_diff_key($config, array_flip(self::RETIRED_VETTING_CONFIG_KEYS));
    }

    // ============================================
    // HELPERS
    // ============================================
    //
    // NOTE — SQL injection safety:
    // All dynamic WHERE / ORDER BY clauses in this controller are built from
    // hardcoded, whitelisted SQL fragments stored in $conditions arrays.
    // User input is NEVER interpolated into SQL strings; it is always bound
    // via parameterised placeholders (?).  The $where variable only ever
    // contains literal strings assembled by this controller, not raw request data.
    // ORDER BY columns are validated against explicit whitelists before use.

    /**
     * Platform-level super admin check — used to gate cross-tenant access via
     * `?tenant_id=` query overrides on the broker dashboard, exchanges,
     * messages, etc.
     *
     * IMPORTANT: this MUST NOT include `is_tenant_super_admin`. A
     * tenant-super-admin is scoped to their own tenant by design — letting
     * them pass `?tenant_id=N` to read another tenant's broker data is a
     * cross-tenant data-leak. Only true platform-level admins
     * (role=super_admin/god or is_super_admin flag) get the override.
     */
    private function isSuperAdmin(): bool
    {
        $user = $this->resolveUserObject();
        $role = $user->role ?? 'member';
        if (in_array($role, ['super_admin', 'god'], true)) {
            return true;
        }
        return (bool) ($user->is_super_admin ?? false);
    }

    /**
     * Caller's role label for audit-log context. Brokers, coordinators, and
     * admins all reach these endpoints via broker-or-admin middleware; the
     * audit log treated them identically until this helper. Tagging the role
     * lets a downstream auditor distinguish a broker's flag/approve from an
     * admin's, which matters for accountability and for spotting privilege
     * misuse without joining back to users.role at audit-read time.
     */
    private function resolveActorRole(): string
    {
        $user = $this->resolveUserObject();
        $role = (string) ($user->role ?? '');
        if ($role !== '') {
            return $role;
        }
        if (($user->is_super_admin ?? false) || ($user->is_god ?? false)) {
            return 'super_admin';
        }
        if (($user->is_tenant_super_admin ?? false)) {
            return 'tenant_super_admin';
        }
        if (($user->is_admin ?? false)) {
            return 'admin';
        }
        return 'unknown';
    }

    private function resolveUserObject(): object
    {
        $user = \Illuminate\Support\Facades\Auth::user();
        if ($user) {
            return $user;
        }
        $userId = \Illuminate\Support\Facades\Auth::id() ?? $this->getOptionalUserId();
        if ($userId) {
            $row = DB::selectOne(
                "SELECT id, role, is_super_admin, is_tenant_super_admin FROM users WHERE id = ?",
                [$userId]
            );
            if ($row) {
                return $row;
            }
        }
        return (object) ['role' => 'member'];
    }

    private function resolveEffectiveTenantId(bool $isSuperAdmin, int $tenantId): ?int
    {
        $filterRaw = request()->query('tenant_id');
        if ($isSuperAdmin) {
            if ($filterRaw === 'all') {
                \Illuminate\Support\Facades\Log::warning('Super admin accessed all-tenant data', [
                    'admin_user_id' => \Illuminate\Support\Facades\Auth::id() ?? request()->header('X-User-Id'),
                    'endpoint'      => request()->path(),
                    'ip'            => request()->ip(),
                ]);
                return null;
            }
            if ($filterRaw !== null && is_numeric($filterRaw)) {
                \Illuminate\Support\Facades\Log::info('Super admin filtered to specific tenant', [
                    'admin_user_id'    => \Illuminate\Support\Facades\Auth::id() ?? request()->header('X-User-Id'),
                    'target_tenant_id' => (int) $filterRaw,
                    'endpoint'         => request()->path(),
                    'ip'               => request()->ip(),
                ]);
                return (int) $filterRaw;
            }
            return $tenantId;
        }
        return $tenantId;
    }

    // ============================================
    // DASHBOARD
    // ============================================

    /** GET /api/v2/admin/broker/dashboard */
    public function dashboard(): JsonResponse
    {
        $this->requireBrokerOrAdmin();
        $isSuperAdmin = $this->isSuperAdmin();
        $tenantId = TenantContext::getId();
        $effectiveTenantId = $this->resolveEffectiveTenantId($isSuperAdmin, $tenantId);

        // Single-source tenant boundary: a non-super-admin who somehow
        // reaches this method without a bound tenant (auth without tenant
        // slug, middleware ordering bug) must NOT see cross-tenant
        // aggregates. Previously this guard only existed before the
        // recent_activity query — the eight count queries above it ran
        // with `WHERE 1=1` in that case and silently aggregated across
        // every tenant. Keep the guard here so every metric below
        // benefits.
        if (!$isSuperAdmin && $effectiveTenantId === null) {
            return $this->respondWithError('TENANT_CONTEXT_ERROR', __('api.tenant_context_error'), null, 403);
        }

        $tenantWhere = $effectiveTenantId !== null ? 'tenant_id = ?' : '1=1';
        $tenantParams = $effectiveTenantId !== null ? [$effectiveTenantId] : [];

        // Track which metrics failed to load so the response shape lets the
        // frontend distinguish "real zero" from "we couldn't compute this".
        // A safeguarding dashboard that silently coerces DB errors to zero
        // is dangerous — the user sees a clean dashboard during exactly the
        // moments they need it most.
        $failedMetrics = [];

        $pendingExchanges = 0;
        try {
            $row = DB::selectOne(
                "SELECT COUNT(*) as cnt FROM exchange_requests WHERE {$tenantWhere} AND status IN ('pending_broker', 'disputed')",
                $tenantParams
            );
            $pendingExchanges = (int) ($row->cnt ?? 0);
        } catch (\Exception $e) {
            $failedMetrics[] = 'pending_exchanges';
            \Illuminate\Support\Facades\Log::warning('[AdminBroker] Dashboard pending_exchanges failed: ' . $e->getMessage());
        }

        $unreviewedMessages = 0;
        try {
            $row = DB::selectOne(
                "SELECT COUNT(*) as cnt FROM broker_message_copies WHERE {$tenantWhere} AND reviewed_at IS NULL",
                $tenantParams
            );
            $unreviewedMessages = (int) ($row->cnt ?? 0);
        } catch (\Exception $e) {
            $failedMetrics[] = 'unreviewed_messages';
            \Illuminate\Support\Facades\Log::warning('[AdminBroker] Dashboard unreviewed_messages failed: ' . $e->getMessage());
        }

        $highRiskListings = 0;
        try {
            $row = DB::selectOne(
                "SELECT COUNT(*) as cnt FROM listing_risk_tags WHERE {$tenantWhere} AND risk_level IN ('high', 'critical')",
                $tenantParams
            );
            $highRiskListings = (int) ($row->cnt ?? 0);
        } catch (\Exception $e) {
            $failedMetrics[] = 'high_risk_listings';
            \Illuminate\Support\Facades\Log::warning('[AdminBroker] Dashboard high_risk_listings failed: ' . $e->getMessage());
        }

        $monitoredUsers = 0;
        try {
            $row = DB::selectOne(
                "SELECT COUNT(*) as cnt FROM user_messaging_restrictions WHERE {$tenantWhere} AND under_monitoring = 1 AND (monitoring_expires_at IS NULL OR monitoring_expires_at > NOW())",
                $tenantParams
            );
            $monitoredUsers = (int) ($row->cnt ?? 0);
        } catch (\Exception $e) {
            $failedMetrics[] = 'monitored_users';
            \Illuminate\Support\Facades\Log::warning('[AdminBroker] Dashboard monitored_users failed: ' . $e->getMessage());
        }

        $vettingReviewRequests = 0;
        try {
            $row = DB::selectOne(
                "SELECT COUNT(*) as cnt
                 FROM safeguarding_vetting_review_requests
                 WHERE {$tenantWhere} AND status = 'pending'",
                $tenantParams
            );
            $vettingReviewRequests = (int) ($row->cnt ?? 0);
        } catch (\Exception $e) {
            $failedMetrics[] = 'vetting_review_requests';
            \Illuminate\Support\Facades\Log::warning('[AdminBroker] Dashboard vetting review queue failed: ' . $e->getMessage());
        }

        $safeguardingAlerts = 0;
        try {
            // abuse_alerts.status enum is ('new','reviewing','resolved','dismissed')
            // — there is NO 'open' value (the previous query was silently
            // returning zero forever). Match the canonical "open alert"
            // semantics used by AbuseDetectionService::getAlertCounts and
            // the auto-dismiss cron in CronJobRunner: anything not
            // resolved/dismissed is open. The dashboard tile is tagged
            // 'critical' in its deep-link so we further restrict to
            // high+critical severity, which matches CronJobRunner's
            // notify-on-new criteria and the user expectation that the
            // tile reflects ESCALATION-WORTHY alerts, not noise.
            $row = DB::selectOne(
                "SELECT COUNT(*) as cnt FROM abuse_alerts
                 WHERE {$tenantWhere}
                   AND status IN ('new', 'reviewing')
                   AND severity IN ('high', 'critical')",
                $tenantParams
            );
            $safeguardingAlerts = (int) ($row->cnt ?? 0);
        } catch (\Exception $e) {
            $failedMetrics[] = 'safeguarding_alerts';
            \Illuminate\Support\Facades\Log::warning('[AdminBroker] Dashboard safeguarding_alerts failed: ' . $e->getMessage());
        }

        $onboardingSafeguardingFlags = 0;
        try {
            // Match the other dashboard counts: when super-admin views
            // all-tenants, drop the tenant filter; otherwise scope to caller.
            $uspWhere  = $effectiveTenantId !== null ? 'usp.tenant_id = ?' : '1=1';
            $uspParams = $effectiveTenantId !== null ? [$effectiveTenantId] : [];
            // The "already reviewed" subquery now also constrains tenant
            // — without that, a `safeguarding_flag_reviewed` action_log row
            // in tenant A could suppress the count in tenant B if user_ids
            // ever overlap (federation, identity merges, future schema
            // changes). Defensive correctness.
            $row = DB::selectOne(
                "SELECT COUNT(DISTINCT usp.user_id) as cnt
                 FROM user_safeguarding_preferences usp
                 JOIN tenant_safeguarding_options tso ON tso.id = usp.option_id
                 WHERE {$uspWhere} AND usp.revoked_at IS NULL AND tso.is_active = 1
                 AND (
                     (tso.option_type = 'checkbox' AND LOWER(TRIM(COALESCE(usp.selected_value, ''))) IN ('1', 'true', 'yes', 'on'))
                     OR (tso.option_type = 'select' AND TRIM(COALESCE(usp.selected_value, '')) <> '')
                 )
                 AND tso.triggers IS NOT NULL
                 AND NOT EXISTS (
                     SELECT 1 FROM activity_log al
                     WHERE al.entity_type = 'user'
                       AND al.entity_id = usp.user_id
                       AND al.tenant_id = usp.tenant_id
                       AND al.action = 'safeguarding_flag_reviewed'
                 )",
                $uspParams
            );
            $onboardingSafeguardingFlags = (int) ($row->cnt ?? 0);
        } catch (\Exception $e) {
            $failedMetrics[] = 'onboarding_safeguarding_flags';
            \Illuminate\Support\Facades\Log::warning('[AdminBroker] Dashboard onboarding_safeguarding_flags failed: ' . $e->getMessage());
        }

        $recentActivity = [];
        try {
            // Activity feed reads from BOTH activity_log and org_audit_log,
            // because insurance and broker actions are split between them.
            // Safeguarding contact decisions have their own append-only event
            // table and are deliberately not represented as legacy vetting
            // record or document actions here.
            //
            // Each branch returns a literal `source` column ('activity' /
            // 'audit') so the frontend can build a stable composite React
            // key — without it, id=1 from activity_log collides with id=1
            // from org_audit_log and React mis-reconciles list rows.
            $actWhere      = $effectiveTenantId !== null ? 'al.tenant_id = ?' : '1=1';
            $auditWhere    = $effectiveTenantId !== null ? 'oal.tenant_id = ?' : '1=1';
            $actParams     = $effectiveTenantId !== null ? [$effectiveTenantId] : [];
            $unionParams   = array_merge($actParams, $actParams);
            $recentActivity = DB::select(
                // ActivityLog::log writes the specific action key to the
                // `action` column and the broad category ('admin', 'system',
                // ...) to `action_type`. Filter on `action`.
                // The two tables have different default collations on
                // production (activity_log = utf8mb4_general_ci,
                // org_audit_log = utf8mb4_unicode_ci) and the `action` /
                // `details` columns inherited those defaults. Without
                // explicit COLLATE clauses, MySQL's UNION ALL fails with
                // ER 1271 ("Illegal mix of collations") and the entire
                // recent_activity feed silently falls into the catch-all
                // (now reported via _partial). Force both branches to
                // utf8mb4_unicode_ci so the UNION is robust regardless
                // of which side wins the collation negotiation. action
                // values are ASCII-safe enum keys; details are short
                // JSON strings — neither cares which Unicode collation
                // we pick, only that they match.
                "(SELECT al.id, 'activity' AS source,
                         al.tenant_id, al.user_id,
                         al.action COLLATE utf8mb4_unicode_ci AS action_type,
                         CONVERT(al.details USING utf8mb4) COLLATE utf8mb4_unicode_ci AS details,
                         al.created_at,
                         u.first_name, u.last_name, t.name as tenant_name
                  FROM activity_log al
                  LEFT JOIN users u ON u.id = al.user_id
                  LEFT JOIN tenants t ON al.tenant_id = t.id
                  WHERE {$actWhere} AND al.action IN (
                      'insurance_cert_created', 'insurance_cert_updated',
                      'insurance_cert_verified', 'insurance_cert_rejected',
                      'insurance_cert_deleted'
                  ))
                 UNION ALL
                 (SELECT oal.id, 'audit' AS source,
                         oal.tenant_id, oal.user_id,
                         oal.action COLLATE utf8mb4_unicode_ci AS action_type,
                         CONVERT(oal.details USING utf8mb4) COLLATE utf8mb4_unicode_ci AS details,
                         oal.created_at,
                         u.first_name, u.last_name, t.name as tenant_name
                  FROM org_audit_log oal
                  LEFT JOIN users u ON u.id = oal.user_id
                  LEFT JOIN tenants t ON oal.tenant_id = t.id
                  WHERE {$auditWhere} AND oal.action IN (
                      'exchange_approved', 'exchange_rejected',
                      'broker_message_reviewed', 'broker_message_approved',
                      'broker_message_flagged',
                      'listing_risk_tag_created', 'listing_risk_tag_updated',
                      'listing_risk_tag_removed',
                      'user_monitoring_added', 'user_monitoring_removed',
                      'broker_config_updated'
                  ))
                 ORDER BY created_at DESC
                 LIMIT 20",
                $unionParams
            );
            $recentActivity = array_map(fn($r) => (array)$r, $recentActivity);
        } catch (\Exception $e) {
            $failedMetrics[] = 'recent_activity';
            \Illuminate\Support\Facades\Log::warning('[AdminBroker] Dashboard recent_activity failed: ' . $e->getMessage());
        }

        return $this->respondWithData([
            'pending_exchanges' => in_array('pending_exchanges', $failedMetrics, true) ? null : $pendingExchanges,
            'unreviewed_messages' => in_array('unreviewed_messages', $failedMetrics, true) ? null : $unreviewedMessages,
            'high_risk_listings' => in_array('high_risk_listings', $failedMetrics, true) ? null : $highRiskListings,
            'monitored_users' => in_array('monitored_users', $failedMetrics, true) ? null : $monitoredUsers,
            'vetting_review_requests' => in_array('vetting_review_requests', $failedMetrics, true) ? null : $vettingReviewRequests,
            'safeguarding_alerts' => in_array('safeguarding_alerts', $failedMetrics, true) ? null : $safeguardingAlerts,
            'onboarding_safeguarding_flags' => in_array('onboarding_safeguarding_flags', $failedMetrics, true) ? null : $onboardingSafeguardingFlags,
            'recent_activity' => $recentActivity,
            // Frontend uses this to render a banner when one or more
            // metrics dropped to null instead of a real number, so a DB
            // hiccup doesn't masquerade as "no risk".
            '_partial' => !empty($failedMetrics),
            '_failed_metrics' => $failedMetrics,
        ]);
    }

    // ============================================
    // EXCHANGES
    // ============================================

    /** GET /api/v2/admin/broker/exchanges */
    public function exchanges(): JsonResponse
    {
        $this->requireBrokerOrAdmin();
        $isSuperAdmin = $this->isSuperAdmin();
        $tenantId = TenantContext::getId();
        $page = $this->queryInt('page', 1, 1);
        $perPage = $this->queryInt('per_page', 20, 1, 100);
        $status = $this->query('status');
        $offset = ($page - 1) * $perPage;

        try {
            $conditions = [];
            $params = [];

            $effectiveTenantId = $this->resolveEffectiveTenantId($isSuperAdmin, $tenantId);
            if (!$isSuperAdmin && $effectiveTenantId === null) {
                return $this->respondWithError('TENANT_CONTEXT_ERROR', __('api.tenant_context_error'), null, 403);
            }
            if ($effectiveTenantId !== null) {
                $conditions[] = 'er.tenant_id = ?';
                $params[] = $effectiveTenantId;
            }

            if ($status && $status !== 'all') {
                $conditions[] = 'er.status = ?';
                $params[] = $status;
            }

            $where = !empty($conditions) ? implode(' AND ', $conditions) : '1=1';

            $countRow = DB::selectOne(
                "SELECT COUNT(*) as cnt FROM exchange_requests er WHERE {$where}",
                $params
            );
            $total = (int) ($countRow->cnt ?? 0);

            $queryParams = array_merge($params, [$perPage, $offset]);
            $items = DB::select(
                "SELECT er.*,
                    CONCAT(req.first_name, ' ', req.last_name) as requester_name,
                    CONCAT(prov.first_name, ' ', prov.last_name) as provider_name,
                    l.title as listing_title,
                    t.name as tenant_name
                FROM exchange_requests er
                JOIN users req ON er.requester_id = req.id
                JOIN users prov ON er.provider_id = prov.id
                LEFT JOIN listings l ON er.listing_id = l.id
                LEFT JOIN tenants t ON er.tenant_id = t.id
                WHERE {$where}
                ORDER BY er.created_at DESC
                LIMIT ? OFFSET ?",
                $queryParams
            );
            $items = array_map(fn($r) => (array)$r, $items);

            foreach ($items as &$item) {
                $item['tenant_name'] = $item['tenant_name'] ?? 'Unknown';
            }
            unset($item);

            return $this->respondWithPaginatedCollection($items, $total, $page, $perPage);
        } catch (\Exception $e) {
            return $this->respondWithPaginatedCollection([], 0, $page, $perPage);
        }
    }

    /** GET /api/v2/admin/broker/exchanges/{id} */
    public function showExchange(int $id): JsonResponse
    {
        $this->requireBrokerOrAdmin();
        $isSuperAdmin = $this->isSuperAdmin();
        $tenantId = TenantContext::getId();

        try {
            if ($isSuperAdmin) {
                $exchange = DB::selectOne(
                    "SELECT er.*,
                        CONCAT(req.first_name, ' ', req.last_name) as requester_name,
                        req.email as requester_email, req.avatar_url as requester_avatar,
                        CONCAT(prov.first_name, ' ', prov.last_name) as provider_name,
                        prov.email as provider_email, prov.avatar_url as provider_avatar,
                        l.title as listing_title, l.type as listing_type, l.hours_estimate as hours_offered,
                        t.name as tenant_name
                    FROM exchange_requests er
                    JOIN users req ON er.requester_id = req.id
                    JOIN users prov ON er.provider_id = prov.id
                    LEFT JOIN listings l ON er.listing_id = l.id
                    LEFT JOIN tenants t ON er.tenant_id = t.id
                    WHERE er.id = ?",
                    [$id]
                );
            } else {
                $exchange = DB::selectOne(
                    "SELECT er.*,
                        CONCAT(req.first_name, ' ', req.last_name) as requester_name,
                        req.email as requester_email, req.avatar_url as requester_avatar,
                        CONCAT(prov.first_name, ' ', prov.last_name) as provider_name,
                        prov.email as provider_email, prov.avatar_url as provider_avatar,
                        l.title as listing_title, l.type as listing_type, l.hours_estimate as hours_offered,
                        t.name as tenant_name
                    FROM exchange_requests er
                    JOIN users req ON er.requester_id = req.id
                    JOIN users prov ON er.provider_id = prov.id
                    LEFT JOIN listings l ON er.listing_id = l.id
                    LEFT JOIN tenants t ON er.tenant_id = t.id
                    WHERE er.id = ? AND er.tenant_id = ?",
                    [$id, $tenantId]
                );
            }

            if (!$exchange) {
                return $this->respondWithError('NOT_FOUND', __('api.exchange_not_found'), null, 404);
            }

            $exchange = (array) $exchange;
            $exchange['tenant_name'] = $exchange['tenant_name'] ?? 'Unknown';
            $exchangeTenantId = (int) $exchange['tenant_id'];

            $history = [];
            try {
                $history = DB::select(
                    "SELECT eh.*, CONCAT(u.first_name, ' ', u.last_name) as actor_name
                    FROM exchange_history eh
                    LEFT JOIN users u ON eh.actor_id = u.id
                    WHERE eh.exchange_id = ?
                    ORDER BY eh.created_at ASC",
                    [$id]
                );
                $history = array_map(fn($r) => (array)$r, $history);
            } catch (\Exception $e) { \Illuminate\Support\Facades\Log::warning('[AdminBroker] Dashboard query failed: ' . $e->getMessage()); }

            $riskTag = null;
            if (!empty($exchange['listing_id'])) {
                try {
                    $riskTagRow = DB::selectOne(
                        "SELECT * FROM listing_risk_tags WHERE listing_id = ? AND tenant_id = ?",
                        [$exchange['listing_id'], $exchangeTenantId]
                    );
                    $riskTag = $riskTagRow ? (array) $riskTagRow : null;
                } catch (\Exception $e) { \Illuminate\Support\Facades\Log::warning('[AdminBroker] Dashboard query failed: ' . $e->getMessage()); }
            }

            return $this->respondWithData([
                'exchange' => $exchange,
                'history' => $history,
                'risk_tag' => $riskTag,
            ]);
        } catch (\Exception $e) {
            return $this->respondWithError('SERVER_ERROR', __('api.fetch_failed', ['resource' => 'exchange']), null, 500);
        }
    }

    /** POST /api/v2/admin/broker/exchanges/{id}/approve */
    public function approveExchange(int $id): JsonResponse
    {
        $adminId = $this->requireBrokerOrAdmin();
        $tenantId = TenantContext::getId();
        $notes = $this->input('notes', '');

        // Cross-tenant write paths previously looked up exchanges across all
        // tenants for super admins, but the downstream ExchangeWorkflowService
        // is auto tenant-scoped (HasTenantScope) and silently failed. Always
        // operate on the caller's tenant — platform super-admins who need to
        // act in another tenant should switch context first.

        try {
            $exchange = DB::selectOne(
                "SELECT id, status, tenant_id, requester_id, provider_id FROM exchange_requests WHERE id = ? AND tenant_id = ?",
                [$id, $tenantId]
            );

            if (!$exchange) {
                return $this->respondWithError('NOT_FOUND', __('api.exchange_not_found'), null, 404);
            }
            if ($exchange->status !== 'pending_broker') {
                return $this->respondWithError('INVALID_STATUS', __('api.exchange_not_pending'));
            }
            // Conflict-of-interest: a broker/admin who is a party to the
            // exchange must not sign it off themselves.
            if ((int) $exchange->requester_id === (int) $adminId
                || (int) $exchange->provider_id === (int) $adminId) {
                return $this->respondWithError('FORBIDDEN', __('api.cannot_broker_own_exchange'), null, 403);
            }

            $success = $this->exchangeWorkflowService->approveExchange($id, $adminId, $notes);
            if (!$success) {
                return $this->respondWithError('SERVER_ERROR', __('api.approve_failed', ['resource' => 'exchange']), null, 500);
            }

            $this->auditLogService->log('exchange_approved', null, $adminId, ['exchange_id' => $id, 'notes' => $notes, 'actor_role' => $this->resolveActorRole()]);

            return $this->respondWithData(['id' => $id, 'status' => 'accepted']);
        } catch (\Exception $e) {
            return $this->respondWithError('SERVER_ERROR', __('api.approve_failed', ['resource' => 'exchange']), null, 500);
        }
    }

    /**
     * POST /api/v2/admin/broker/exchanges/{id}/resolve-dispute
     *
     * Arbitrate a DISPUTED exchange by setting the final hours figure.
     *
     * A disputed exchange was previously unresolvable by anyone — see
     * ExchangeWorkflowService::resolveDispute() for the full history. This is the
     * action the broker dashboard's "needs attention" count and the disputed-age
     * SLO check have always implied existed.
     *
     * `final_hours` is clamped service-side to the same proposed ± variance window
     * a participant's own confirmation would be, and `notes` is mandatory and is
     * written to exchange_history, which both members can see.
     */
    public function resolveExchangeDispute(int $id): JsonResponse
    {
        $adminId = $this->requireBrokerOrAdmin();
        $tenantId = TenantContext::getId();

        $notes = trim((string) $this->input('notes', ''));
        if ($notes === '') {
            return $this->respondWithError('VALIDATION_ERROR', __('api.reason_required'), 'notes');
        }

        $rawHours = $this->input('final_hours');
        if (!is_numeric($rawHours)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.amount_invalid'), 'final_hours');
        }
        $finalHours = (float) $rawHours;

        try {
            $exchange = DB::selectOne(
                "SELECT id, status, tenant_id, requester_id, provider_id FROM exchange_requests WHERE id = ? AND tenant_id = ?",
                [$id, $tenantId]
            );

            if (!$exchange) {
                return $this->respondWithError('NOT_FOUND', __('api.exchange_not_found'), null, 404);
            }
            if ($exchange->status !== 'disputed') {
                // Reusing the generic `invalid_status` rather than adding a new
                // `exchange_not_disputed` key: new PHP lang keys must be filled in
                // all eleven locales via scripts/translate-php-lang-gaps.mjs, which
                // requires a PHP CLI to verify what it writes. A more specific
                // message is worth adding on a machine that has one.
                return $this->respondWithError('INVALID_STATUS', __('api.invalid_status'));
            }
            // Conflict of interest matters more here than anywhere: arbitrating a
            // dispute you are a party to decides your own credits.
            if ((int) $exchange->requester_id === (int) $adminId
                || (int) $exchange->provider_id === (int) $adminId) {
                return $this->respondWithError('FORBIDDEN', __('api.cannot_broker_own_exchange'), null, 403);
            }

            $result = $this->exchangeWorkflowService::resolveDispute($id, $adminId, $finalHours, $notes);
            if (!($result['ok'] ?? false)) {
                $code = (string) ($result['error'] ?? 'SERVER_ERROR');
                $status = in_array($code, ['NOT_FOUND'], true) ? 404
                    : (in_array($code, ['UNAUTHORIZED'], true) ? 403
                    : (in_array($code, ['NOT_DISPUTED', 'REASON_REQUIRED', 'INVALID_HOURS'], true) ? 400 : 500));
                return $this->respondWithError($code, __('api.exchange_complete_failed'), null, $status);
            }

            $this->auditLogService->log('exchange_dispute_resolved', null, $adminId, [
                'exchange_id' => $id,
                'final_hours' => $result['final_hours'] ?? null,
                'notes' => $notes,
                'actor_role' => $this->resolveActorRole(),
            ]);

            return $this->respondWithData([
                'id' => $id,
                'status' => 'completed',
                'final_hours' => $result['final_hours'] ?? null,
            ]);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::error('Exchange dispute resolution failed', ['exchange_id' => $id, 'error' => $e->getMessage()]);
            return $this->respondWithError('SERVER_ERROR', __('api.exchange_complete_failed'), null, 500);
        }
    }

    /**
     * POST /api/v2/admin/broker/exchanges/{id}/reverse
     *
     * Reverse a COMPLETED exchange, restoring both members' credits.
     *
     * See ExchangeWorkflowService::reverseCompletedExchange() for the full
     * rationale and the safety properties. A mandatory reason is recorded in the
     * exchange's own history (visible to both members) and in the tenant audit log.
     *
     * This does not re-post at a corrected figure — reverse, then create the
     * exchange again at the right hours.
     */
    public function reverseExchange(int $id): JsonResponse
    {
        $adminId = $this->requireBrokerOrAdmin();
        $tenantId = TenantContext::getId();

        $reason = trim((string) $this->input('reason', ''));
        if ($reason === '') {
            return $this->respondWithError('VALIDATION_ERROR', __('api.reason_required'), 'reason');
        }

        try {
            $exchange = DB::selectOne(
                "SELECT id, status, tenant_id, requester_id, provider_id FROM exchange_requests WHERE id = ? AND tenant_id = ?",
                [$id, $tenantId]
            );

            if (!$exchange) {
                return $this->respondWithError('NOT_FOUND', __('api.exchange_not_found'), null, 404);
            }
            // Reversing an exchange you are a party to moves your own credits.
            if ((int) $exchange->requester_id === (int) $adminId
                || (int) $exchange->provider_id === (int) $adminId) {
                return $this->respondWithError('FORBIDDEN', __('api.cannot_broker_own_exchange'), null, 403);
            }

            $result = $this->exchangeWorkflowService::reverseCompletedExchange($id, $adminId, $reason);
            if (!($result['ok'] ?? false)) {
                $code = (string) ($result['error'] ?? 'SERVER_ERROR');
                $status = match ($code) {
                    'NOT_FOUND' => 404,
                    'UNAUTHORIZED' => 403,
                    'REASON_REQUIRED', 'NOT_COMPLETED', 'NO_TRANSACTION',
                    'ORIGINAL_NOT_FOUND', 'INVALID_AMOUNT', 'ORIGINAL_NOT_TWO_SIDED' => 400,
                    default => 500,
                };
                return $this->respondWithError($code, __('api.update_failed', ['resource' => 'exchange']), null, $status);
            }

            return $this->respondWithData([
                'id' => $id,
                'reversal_transaction_id' => $result['reversal_transaction_id'] ?? null,
                'amount' => $result['amount'] ?? null,
                'already_reversed' => $result['already_reversed'] ?? false,
            ]);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::error('Exchange reversal endpoint failed', ['exchange_id' => $id, 'error' => $e->getMessage()]);
            return $this->respondWithError('SERVER_ERROR', __('api.update_failed', ['resource' => 'exchange']), null, 500);
        }
    }

    /** POST /api/v2/admin/broker/exchanges/{id}/reject */
    public function rejectExchange(int $id): JsonResponse
    {
        $adminId = $this->requireBrokerOrAdmin();
        $tenantId = TenantContext::getId();
        $reason = $this->input('reason', '');

        if (empty($reason)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.reason_required_reject_exchange'), 'reason');
        }

        // Always operate on caller's tenant — see approveExchange comment.
        try {
            $exchange = DB::selectOne(
                "SELECT id, status, tenant_id, requester_id, provider_id FROM exchange_requests WHERE id = ? AND tenant_id = ?",
                [$id, $tenantId]
            );

            if (!$exchange) {
                return $this->respondWithError('NOT_FOUND', __('api.exchange_not_found'), null, 404);
            }
            if ($exchange->status !== 'pending_broker') {
                return $this->respondWithError('INVALID_STATUS', __('api.exchange_not_pending'));
            }
            if ((int) $exchange->requester_id === (int) $adminId
                || (int) $exchange->provider_id === (int) $adminId) {
                return $this->respondWithError('FORBIDDEN', __('api.cannot_broker_own_exchange'), null, 403);
            }

            $success = $this->exchangeWorkflowService->rejectExchange($id, $adminId, $reason);
            if (!$success) {
                return $this->respondWithError('SERVER_ERROR', __('api.reject_failed', ['resource' => 'exchange']), null, 500);
            }

            $this->auditLogService->log('exchange_rejected', null, $adminId, ['exchange_id' => $id, 'reason' => $reason, 'actor_role' => $this->resolveActorRole()]);

            return $this->respondWithData(['id' => $id, 'status' => 'cancelled']);
        } catch (\Exception $e) {
            return $this->respondWithError('SERVER_ERROR', __('api.reject_failed', ['resource' => 'exchange']), null, 500);
        }
    }

    // ============================================
    // RISK TAGS
    // ============================================

    /** GET /api/v2/admin/broker/risk-tags */
    public function riskTags(): JsonResponse
    {
        $this->requireBrokerOrAdmin();
        $isSuperAdmin = $this->isSuperAdmin();
        $tenantId = TenantContext::getId();
        $riskLevel = $this->query('risk_level');

        try {
            $conditions = [];
            $params = [];

            $effectiveTenantId = $this->resolveEffectiveTenantId($isSuperAdmin, $tenantId);
            if ($effectiveTenantId !== null) {
                $conditions[] = 'rt.tenant_id = ?';
                $params[] = $effectiveTenantId;
            }

            if ($riskLevel && $riskLevel !== 'all') {
                $conditions[] = 'rt.risk_level = ?';
                $params[] = $riskLevel;
            }

            $where = !empty($conditions) ? implode(' AND ', $conditions) : '1=1';

            $items = DB::select(
                "SELECT rt.*, l.title as listing_title, u.name as owner_name,
                    tagger.name as tagged_by_name, t.name as tenant_name
                FROM listing_risk_tags rt
                LEFT JOIN listings l ON rt.listing_id = l.id
                LEFT JOIN users u ON l.user_id = u.id
                LEFT JOIN users tagger ON rt.tagged_by = tagger.id
                LEFT JOIN tenants t ON rt.tenant_id = t.id
                WHERE {$where}
                ORDER BY FIELD(rt.risk_level, 'critical', 'high', 'medium', 'low'), rt.created_at DESC",
                $params
            );
            $items = array_map(fn($r) => (array)$r, $items);

            foreach ($items as &$item) {
                $item['tenant_name'] = $item['tenant_name'] ?? 'Unknown';
            }
            unset($item);

            return $this->respondWithData($items);
        } catch (\Exception $e) {
            return $this->respondWithData([]);
        }
    }

    /** POST /api/v2/admin/broker/listings/{lid}/risk-tag */
    public function saveRiskTag(int $listingId): JsonResponse
    {
        $adminId = $this->requireBrokerOrAdmin();
        $tenantId = TenantContext::getId();

        $riskLevel = $this->input('risk_level', 'low');
        $riskCategory = trim($this->input('risk_category', ''));
        $riskNotes = trim($this->input('risk_notes', ''));
        $memberVisibleNotes = trim($this->input('member_visible_notes', ''));
        $requiresApproval = (bool) $this->input('requires_approval', false);
        $insuranceRequired = (bool) $this->input('insurance_required', false);
        $hasRoleVettingInput = request()->has('dbs_required');
        $dbsRequired = $hasRoleVettingInput ? (bool) $this->input('dbs_required', false) : null;
        if ($dbsRequired === true) {
            return $this->respondWithError(
                'ROLE_VETTING_POLICY_UNAVAILABLE',
                __('safeguarding.errors.listing_role_feature_unavailable'),
                'dbs_required',
                409,
            );
        }

        $allowedLevels = ['low', 'medium', 'high', 'critical'];
        if (!in_array($riskLevel, $allowedLevels)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_risk_level'), 'risk_level');
        }
        if (empty($riskCategory)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.risk_category_required'), 'risk_category');
        }
        $allowedCategories = array_keys(\App\Services\ListingRiskTagService::CATEGORIES);
        if (!in_array($riskCategory, $allowedCategories, true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_risk_category'), 'risk_category', 422);
        }
        if (mb_strlen($riskNotes) > 2000) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.risk_notes_max_length'), 'risk_notes');
        }
        if (mb_strlen($memberVisibleNotes) > 500) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.member_visible_notes_max_length'), 'member_visible_notes');
        }

        // Always operate on caller's tenant — see approveExchange comment.
        // Cross-tenant writes are unsupported because they produce a split
        // audit trail (data lands in target tenant, audit row in caller's).
        try {
            $listing = DB::selectOne(
                "SELECT id, tenant_id FROM listings WHERE id = ? AND tenant_id = ?",
                [$listingId, $tenantId]
            );

            if (!$listing) {
                return $this->respondWithError('NOT_FOUND', __('api.listing_not_found'), null, 404);
            }

            $listingTenantId = (int) $listing->tenant_id;

            $existing = DB::selectOne(
                "SELECT id, risk_level, dbs_required FROM listing_risk_tags WHERE listing_id = ? AND tenant_id = ?",
                [$listingId, $listingTenantId]
            );

            if ($existing) {
                $oldRiskLevel = $existing->risk_level;
                $effectiveDbsRequired = $dbsRequired ?? (bool) $existing->dbs_required;
                DB::update(
                    "UPDATE listing_risk_tags SET risk_level = ?, risk_category = ?, risk_notes = ?, member_visible_notes = ?, requires_approval = ?, insurance_required = ?, dbs_required = ?, tagged_by = ?, updated_at = NOW() WHERE listing_id = ? AND tenant_id = ?",
                    [$riskLevel, $riskCategory, $riskNotes, $memberVisibleNotes, $requiresApproval ? 1 : 0, $insuranceRequired ? 1 : 0, $effectiveDbsRequired ? 1 : 0, $adminId, $listingId, $listingTenantId]
                );
                $tagId = $existing->id;
                $this->auditLogService->log('listing_risk_tag_updated', null, $adminId, ['listing_id' => $listingId, 'old_risk_level' => $oldRiskLevel, 'new_risk_level' => $riskLevel, 'actor_role' => $this->resolveActorRole()]);

                $highLevels = [ListingRiskTagService::RISK_HIGH, ListingRiskTagService::RISK_CRITICAL];
                if (in_array($riskLevel, $highLevels, true) && !in_array($oldRiskLevel, $highLevels, true)) {
                    $this->notifyAdminsOfRiskTagChange($listingId, $riskLevel, $adminId);
                }
            } else {
                DB::insert(
                    "INSERT INTO listing_risk_tags (listing_id, tenant_id, risk_level, risk_category, risk_notes, member_visible_notes, requires_approval, insurance_required, dbs_required, tagged_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())",
                    [$listingId, $listingTenantId, $riskLevel, $riskCategory, $riskNotes, $memberVisibleNotes, $requiresApproval ? 1 : 0, $insuranceRequired ? 1 : 0, 0, $adminId]
                );
                $tagId = (int) DB::getPdo()->lastInsertId();
                $this->auditLogService->log('listing_risk_tag_created', null, $adminId, ['listing_id' => $listingId, 'tag_id' => $tagId, 'risk_level' => $riskLevel, 'actor_role' => $this->resolveActorRole()]);

                if (in_array($riskLevel, [ListingRiskTagService::RISK_HIGH, ListingRiskTagService::RISK_CRITICAL], true)) {
                    $this->notifyAdminsOfRiskTagChange($listingId, $riskLevel, $adminId);
                }
            }

            return $this->respondWithData(['id' => $tagId, 'listing_id' => $listingId, 'risk_level' => $riskLevel]);
        } catch (\Exception $e) {
            return $this->respondWithError('SERVER_ERROR', __('api.create_failed', ['resource' => 'risk tag']), null, 500);
        }
    }

    /** DELETE /api/v2/admin/broker/listings/{lid}/risk-tag */
    public function removeRiskTag(int $listingId): JsonResponse
    {
        $adminId = $this->requireBrokerOrAdmin();
        $tenantId = TenantContext::getId();

        // Always operate on caller's tenant — see approveExchange comment.
        try {
            $existing = DB::selectOne(
                "SELECT id, tenant_id, risk_level FROM listing_risk_tags WHERE listing_id = ? AND tenant_id = ?",
                [$listingId, $tenantId]
            );

            if (!$existing) {
                return $this->respondWithError('NOT_FOUND', __('api.not_found', ['model' => 'Risk tag']), null, 404);
            }

            DB::delete("DELETE FROM listing_risk_tags WHERE listing_id = ? AND tenant_id = ?", [$listingId, $tenantId]);

            $this->auditLogService->log('listing_risk_tag_removed', null, $adminId, ['listing_id' => $listingId, 'previous_risk_level' => $existing->risk_level ?? null, 'actor_role' => $this->resolveActorRole()]);

            return $this->respondWithData(['listing_id' => $listingId, 'removed' => true]);
        } catch (\Exception $e) {
            return $this->respondWithError('SERVER_ERROR', __('api.delete_failed', ['resource' => 'risk tag']), null, 500);
        }
    }

    // ============================================
    // MESSAGES
    // ============================================

    /** GET /api/v2/admin/broker/messages */
    public function messages(): JsonResponse
    {
        $this->requireBrokerOrAdmin();
        $isSuperAdmin = $this->isSuperAdmin();
        $tenantId = TenantContext::getId();
        $page = $this->queryInt('page', 1, 1);
        $perPage = $this->queryInt('per_page', 20, 1, 100);
        $filter = $this->query('filter', 'all');
        $offset = ($page - 1) * $perPage;

        try {
            $conditions = [];
            $params = [];

            $effectiveTenantId = $this->resolveEffectiveTenantId($isSuperAdmin, $tenantId);
            if ($effectiveTenantId !== null) {
                $conditions[] = 'bmc.tenant_id = ?';
                $params[] = $effectiveTenantId;
            }

            if ($filter === 'unreviewed') {
                $conditions[] = 'bmc.reviewed_at IS NULL';
            } elseif ($filter === 'flagged') {
                $conditions[] = 'bmc.flagged = 1';
            } elseif ($filter === 'reviewed') {
                $conditions[] = 'bmc.reviewed_at IS NOT NULL';
            }

            $where = !empty($conditions) ? implode(' AND ', $conditions) : '1=1';

            $countRow = DB::selectOne("SELECT COUNT(*) as cnt FROM broker_message_copies bmc WHERE {$where}", $params);
            $total = (int) ($countRow->cnt ?? 0);

            $queryParams = array_merge($params, [$perPage, $offset]);
            $items = DB::select(
                "SELECT bmc.*, CONCAT(s.first_name, ' ', s.last_name) as sender_name,
                    CONCAT(r.first_name, ' ', r.last_name) as receiver_name,
                    l.title as listing_title, t.name as tenant_name
                FROM broker_message_copies bmc
                LEFT JOIN users s ON bmc.sender_id = s.id
                LEFT JOIN users r ON bmc.receiver_id = r.id
                LEFT JOIN listings l ON bmc.related_listing_id = l.id
                LEFT JOIN tenants t ON bmc.tenant_id = t.id
                WHERE {$where}
                ORDER BY bmc.created_at DESC
                LIMIT ? OFFSET ?",
                $queryParams
            );
            $items = array_map(fn($r) => (array)$r, $items);

            foreach ($items as &$item) {
                $item['flagged'] = (bool) ($item['flagged'] ?? false);
                $item['tenant_name'] = $item['tenant_name'] ?? 'Unknown';
            }
            unset($item);

            return $this->respondWithPaginatedCollection($items, $total, $page, $perPage);
        } catch (\Exception $e) {
            return $this->respondWithPaginatedCollection([], 0, $page, $perPage);
        }
    }

    /** GET /api/v2/admin/broker/messages/{id} */
    public function showMessage(int $id): JsonResponse
    {
        $this->requireBrokerOrAdmin();
        $isSuperAdmin = $this->isSuperAdmin();
        $tenantId = TenantContext::getId();

        try {
            $baseSelect = "SELECT bmc.*, CONCAT(s.first_name, ' ', s.last_name) as sender_name,
                CONCAT(r.first_name, ' ', r.last_name) as receiver_name,
                l.title as listing_title, t.name as tenant_name
                FROM broker_message_copies bmc
                LEFT JOIN users s ON bmc.sender_id = s.id
                LEFT JOIN users r ON bmc.receiver_id = r.id
                LEFT JOIN listings l ON bmc.related_listing_id = l.id
                LEFT JOIN tenants t ON bmc.tenant_id = t.id";

            if ($isSuperAdmin) {
                $copy = DB::selectOne("{$baseSelect} WHERE bmc.id = ?", [$id]);
            } else {
                $copy = DB::selectOne("{$baseSelect} WHERE bmc.id = ? AND bmc.tenant_id = ?", [$id, $tenantId]);
            }

            if (!$copy) {
                return $this->respondWithError('NOT_FOUND', __('api.broker_message_not_found'), null, 404);
            }

            $copy = (array) $copy;
            $copy['flagged'] = (bool) ($copy['flagged'] ?? false);
            $copy['tenant_name'] = $copy['tenant_name'] ?? 'Unknown';
            $copyTenantId = (int) $copy['tenant_id'];

            $thread = DB::select(
                "SELECT m.id, m.sender_id, m.receiver_id, m.body, m.created_at, m.is_deleted,
                    CONCAT(u.first_name, ' ', u.last_name) as sender_name
                FROM messages m LEFT JOIN users u ON m.sender_id = u.id
                WHERE m.tenant_id = ?
                  AND ((m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?))
                ORDER BY m.created_at ASC LIMIT 200",
                [$copyTenantId, $copy['sender_id'], $copy['receiver_id'], $copy['receiver_id'], $copy['sender_id']]
            );
            $thread = array_map(fn($r) => (array)$r, $thread);

            foreach ($thread as &$msg) {
                if (!empty($msg['is_deleted'])) {
                    $msg['body'] = '[Message deleted]';
                }
            }
            unset($msg);

            $archive = null;
            if (!empty($copy['archive_id'])) {
                $archiveRow = DB::selectOne(
                    "SELECT id, decision, decision_notes, decided_by_name, decided_at, flag_reason, flag_severity
                    FROM broker_review_archives WHERE id = ? AND tenant_id = ?",
                    [$copy['archive_id'], $copyTenantId]
                );
                $archive = $archiveRow ? (array) $archiveRow : null;
            }

            return $this->respondWithData(['copy' => $copy, 'thread' => $thread, 'archive' => $archive]);
        } catch (\Exception $e) {
            return $this->respondWithError('SERVER_ERROR', __('api.fetch_failed', ['resource' => 'message detail']), null, 500);
        }
    }

    /** POST /api/v2/admin/broker/messages/{id}/review */
    public function reviewMessage(int $id): JsonResponse
    {
        $adminId = $this->requireBrokerOrAdmin();
        $tenantId = TenantContext::getId();
        $notes = trim((string) $this->input('notes', ''));

        // Cross-tenant write: removed (always caller's tenant). Super-admins
        // who need to act in another tenant should switch context first.
        try {
            $message = DB::selectOne(
                "SELECT id, tenant_id FROM broker_message_copies WHERE id = ? AND tenant_id = ?",
                [$id, $tenantId]
            );

            if (!$message) {
                return $this->respondWithError('NOT_FOUND', __('api.not_found', ['model' => 'Message']), null, 404);
            }

            DB::update(
                "UPDATE broker_message_copies SET reviewed_by = ?, reviewed_at = NOW(), review_notes = ? WHERE id = ? AND tenant_id = ?",
                [$adminId, $notes !== '' ? $notes : null, $id, $tenantId]
            );

            $this->auditLogService->log('broker_message_reviewed', null, $adminId, [
                'message_id' => $id,
                'has_notes' => $notes !== '',
                'actor_role' => $this->resolveActorRole(),
            ]);

            return $this->respondWithData(['id' => $id, 'reviewed' => true]);
        } catch (\Exception $e) {
            return $this->respondWithError('SERVER_ERROR', __('api.update_failed', ['resource' => 'message review']), null, 500);
        }
    }

    /** POST /api/v2/admin/broker/messages/{id}/approve */
    public function approveMessage(int $id): JsonResponse
    {
        $adminId = $this->requireBrokerOrAdmin();
        $tenantId = TenantContext::getId();
        $notes = trim($this->input('notes', ''));

        // Always operate on caller's tenant — see approveExchange comment.
        try {
            $baseSelect = "SELECT bmc.*, CONCAT(s.first_name, ' ', s.last_name) as sender_name,
                CONCAT(r.first_name, ' ', r.last_name) as receiver_name, l.title as listing_title
                FROM broker_message_copies bmc
                LEFT JOIN users s ON bmc.sender_id = s.id
                LEFT JOIN users r ON bmc.receiver_id = r.id
                LEFT JOIN listings l ON bmc.related_listing_id = l.id";

            $copy = DB::selectOne("{$baseSelect} WHERE bmc.id = ? AND bmc.tenant_id = ?", [$id, $tenantId]);

            if (!$copy) {
                return $this->respondWithError('NOT_FOUND', __('api.broker_message_not_found'), null, 404);
            }

            $copy = (array) $copy;
            $copyTenantId = (int) $copy['tenant_id'];

            if (!empty($copy['archive_id'])) {
                return $this->respondWithError('ALREADY_ARCHIVED', __('api.already_archived'), null, 409);
            }

            $adminRow = DB::selectOne("SELECT CONCAT(first_name, ' ', last_name) as name FROM users WHERE id = ? AND tenant_id = ?", [$adminId, $tenantId]);
            $adminName = $adminRow->name ?? 'Unknown';

            $conversationRows = DB::select(
                "SELECT m.id, m.sender_id, m.body, m.created_at, m.is_deleted,
                    CONCAT(u.first_name, ' ', u.last_name) as sender_name
                FROM messages m LEFT JOIN users u ON m.sender_id = u.id
                WHERE m.tenant_id = ?
                  AND ((m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?))
                ORDER BY m.created_at ASC LIMIT 500",
                [$copyTenantId, $copy['sender_id'], $copy['receiver_id'], $copy['receiver_id'], $copy['sender_id']]
            );
            $conversationRows = array_map(fn($r) => (array)$r, $conversationRows);

            foreach ($conversationRows as &$msg) {
                if (!empty($msg['is_deleted'])) {
                    $msg['body'] = '[Message deleted]';
                }
                unset($msg['is_deleted']);
            }
            unset($msg);

            $conversationSnapshot = json_encode($conversationRows);
            $decision = !empty($copy['flagged']) ? 'flagged' : 'approved';

            DB::insert(
                "INSERT INTO broker_review_archives
                    (tenant_id, broker_copy_id, sender_id, sender_name, receiver_id, receiver_name,
                     related_listing_id, listing_title, copy_reason, target_message_body, target_message_sent_at,
                     conversation_snapshot, decision, decision_notes, decided_by, decided_by_name,
                     decided_at, flag_reason, flag_severity, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, NOW())",
                [
                    $copyTenantId, $id, $copy['sender_id'], $copy['sender_name'] ?? '', $copy['receiver_id'],
                    $copy['receiver_name'] ?? '', $copy['related_listing_id'], $copy['listing_title'],
                    $copy['copy_reason'], $copy['message_body'] ?? '', $copy['sent_at'],
                    $conversationSnapshot, $decision, $notes ?: null, $adminId, $adminName,
                    $copy['flag_reason'], $copy['flag_severity'],
                ]
            );

            $archiveId = (int) DB::getPdo()->lastInsertId();

            DB::update(
                "UPDATE broker_message_copies SET archived_at = NOW(), archive_id = ?,
                     reviewed_by = COALESCE(reviewed_by, ?), reviewed_at = COALESCE(reviewed_at, NOW())
                 WHERE id = ? AND tenant_id = ?",
                [$archiveId, $adminId, $id, $copyTenantId]
            );

            // Audit — approveMessage archives the message + writes a snapshot,
            // the most consequential broker review action.
            $this->auditLogService->log('broker_message_approved', null, $adminId, [
                'message_id' => $id,
                'archive_id' => $archiveId,
                'decision'   => $decision,
                'has_notes'  => $notes !== '',
                'actor_role' => $this->resolveActorRole(),
            ]);

            return $this->respondWithData(['id' => $id, 'archive_id' => $archiveId, 'decision' => $decision, 'decided_by' => $adminName]);
        } catch (\Exception $e) {
            return $this->respondWithError('SERVER_ERROR', __('api.update_failed', ['resource' => 'message archive']), null, 500);
        }
    }

    /** POST /api/v2/admin/broker/messages/{id}/flag */
    public function flagMessage(int $id): JsonResponse
    {
        $adminId = $this->requireBrokerOrAdmin();
        $tenantId = TenantContext::getId();
        $reason = trim($this->input('reason', ''));
        $severity = $this->input('severity', 'concern');

        if (empty($reason)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.reason_required_flag_message'), 'reason');
        }

        $allowedSeverities = ['info', 'warning', 'concern', 'urgent'];
        if (!in_array($severity, $allowedSeverities, true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_flag_severity'), 'severity');
        }

        // Always operate on caller's tenant — see approveExchange comment.
        try {
            $message = DB::selectOne(
                "SELECT id, tenant_id FROM broker_message_copies WHERE id = ? AND tenant_id = ?",
                [$id, $tenantId]
            );

            if (!$message) {
                return $this->respondWithError('NOT_FOUND', __('api.not_found', ['model' => 'Message']), null, 404);
            }

            DB::update(
                "UPDATE broker_message_copies SET flagged = 1, flag_reason = ?, flag_severity = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ? AND tenant_id = ?",
                [$reason, $severity, $adminId, $id, $tenantId]
            );

            $this->auditLogService->log('broker_message_flagged', null, $adminId, [
                'message_id' => $id,
                'severity'   => $severity,
                'reason'     => $reason,
                'actor_role' => $this->resolveActorRole(),
            ]);

            return $this->respondWithData(['id' => $id, 'flagged' => true, 'flag_reason' => $reason, 'flag_severity' => $severity]);
        } catch (\Exception $e) {
            return $this->respondWithError('SERVER_ERROR', __('api.update_failed', ['resource' => 'message flag']), null, 500);
        }
    }

    // ============================================
    // MONITORING
    // ============================================

    /** GET /api/v2/admin/broker/monitoring */
    public function monitoring(): JsonResponse
    {
        $this->requireBrokerOrAdmin();
        $isSuperAdmin = $this->isSuperAdmin();
        $tenantId = TenantContext::getId();

        try {
            $conditions = ['umr.under_monitoring = 1', '(umr.monitoring_expires_at IS NULL OR umr.monitoring_expires_at > NOW())'];
            $params = [];

            $effectiveTenantId = $this->resolveEffectiveTenantId($isSuperAdmin, $tenantId);
            if ($effectiveTenantId !== null) {
                $conditions[] = 'umr.tenant_id = ?';
                $params[] = $effectiveTenantId;
            }

            $where = implode(' AND ', $conditions);

            $items = DB::select(
                "SELECT umr.*, CONCAT(u.first_name, ' ', u.last_name) as user_name, t.name as tenant_name
                FROM user_messaging_restrictions umr
                LEFT JOIN users u ON umr.user_id = u.id
                LEFT JOIN tenants t ON umr.tenant_id = t.id
                WHERE {$where}
                ORDER BY umr.monitoring_started_at DESC",
                $params
            );
            $items = array_map(fn($r) => (array)$r, $items);

            foreach ($items as &$item) {
                $item['under_monitoring'] = (bool) ($item['under_monitoring'] ?? false);
                $item['messaging_disabled'] = (bool) ($item['messaging_disabled'] ?? false);
                $item['tenant_name'] = $item['tenant_name'] ?? 'Unknown';
            }
            unset($item);

            return $this->respondWithData($items);
        } catch (\Exception $e) {
            return $this->respondWithData([]);
        }
    }

    /** POST /api/v2/admin/broker/users/{userId}/monitoring */
    public function setMonitoring(int $userId): JsonResponse
    {
        $adminId = $this->requireBrokerOrAdmin();
        $tenantId = TenantContext::getId();
        $underMonitoring = (bool) $this->input('under_monitoring', true);
        $reason = trim($this->input('reason', ''));
        $messagingDisabled = (bool) $this->input('messaging_disabled', false);
        $expiresDays = $this->input('expires_days', null);

        // Always operate on caller's tenant — see approveExchange comment.
        try {
            // preferred_language is fetched so the bell notification renders
            // in the recipient's locale, not the broker's. See CLAUDE.md
            // "EMAIL & NOTIFICATION LOCALE — MUST WRAP IN LocaleContext".
            $user = DB::selectOne(
                "SELECT id, tenant_id, first_name, last_name, preferred_language FROM users WHERE id = ? AND tenant_id = ?",
                [$userId, $tenantId]
            );

            if (!$user) {
                return $this->respondWithError('NOT_FOUND', __('api.user_not_found'), null, 404);
            }

            $userTenantId = (int) $user->tenant_id;
            $userName = trim(($user->first_name ?? '') . ' ' . ($user->last_name ?? ''));

            $existing = DB::selectOne("SELECT id FROM user_messaging_restrictions WHERE user_id = ? AND tenant_id = ?", [$userId, $userTenantId]);

            if ($underMonitoring) {
                if (empty($reason)) {
                    return $this->respondWithError('VALIDATION_ERROR', __('api.reason_required_monitoring'), 'reason');
                }

                $expiresAt = null;
                if ($expiresDays !== null && (int) $expiresDays > 0) {
                    $expiresAt = date('Y-m-d H:i:s', strtotime('+' . (int) $expiresDays . ' days'));
                }

                if ($existing) {
                    DB::update(
                        "UPDATE user_messaging_restrictions SET under_monitoring = 1, monitoring_reason = ?, restriction_reason = ?, messaging_disabled = ?, monitoring_started_at = NOW(), monitoring_expires_at = ?, restricted_by = ? WHERE user_id = ? AND tenant_id = ?",
                        [$reason, $reason, $messagingDisabled ? 1 : 0, $expiresAt, $adminId, $userId, $userTenantId]
                    );
                } else {
                    DB::insert(
                        "INSERT INTO user_messaging_restrictions (user_id, tenant_id, under_monitoring, monitoring_reason, restriction_reason, messaging_disabled, monitoring_started_at, monitoring_expires_at, restricted_by) VALUES (?, ?, 1, ?, ?, ?, NOW(), ?, ?)",
                        [$userId, $userTenantId, $reason, $reason, $messagingDisabled ? 1 : 0, $expiresAt, $adminId]
                    );
                }

                $this->auditLogService->log('user_monitoring_added', null, $adminId, [
                    'user_id' => $userId, 'user_name' => $userName, 'reason' => $reason,
                    'messaging_disabled' => $messagingDisabled,
                    'expires_days' => $expiresDays ? (int) $expiresDays : null, 'expires_at' => $expiresAt,
                    'actor_role' => $this->resolveActorRole(),
                ]);

                try {
                    LocaleContext::withLocale($user, function () use ($userId, $messagingDisabled) {
                        $msg = $messagingDisabled
                            ? __('api_controllers_3.admin_bells.monitoring_restricted')
                            : __('api_controllers_3.admin_bells.monitoring_under_review');
                        Notification::createNotification($userId, $msg, '/messages', 'system', true);
                        \App\Services\NotificationDispatcher::fanOutPush((int) ($userId), 'system', $msg, '/messages');
                    });
                } catch (\Throwable $e) { \Log::warning('[AdminBroker] monitoring notification failed', ['user_id' => $userId, 'error' => $e->getMessage()]); }

                return $this->respondWithData(['user_id' => $userId, 'under_monitoring' => true]);
            } else {
                if ($existing) {
                    // Check if monitoring was set by safeguarding triggers — warn admin
                    $existingRow = DB::selectOne(
                        "SELECT monitoring_reason, requires_broker_approval FROM user_messaging_restrictions WHERE user_id = ? AND tenant_id = ?",
                        [$userId, $userTenantId]
                    );
                    $isSafeguardingSet = $existingRow && str_starts_with($existingRow->monitoring_reason ?? '', 'Safeguarding:');

                    // Preserve audit trail: don't null out monitoring_reason or monitoring_started_at
                    // They record WHY monitoring was originally set, which is legally required
                    DB::update(
                        "UPDATE user_messaging_restrictions
                         SET under_monitoring = 0, messaging_disabled = 0, monitoring_expires_at = NULL,
                             restriction_reason = CONCAT(COALESCE(restriction_reason, ''), ' [Removed by admin ', ?, ']')
                         WHERE user_id = ? AND tenant_id = ?",
                        [(int) $adminId, $userId, $userTenantId]
                    );

                    // If safeguarding-set, also clear requires_broker_approval
                    // (admin explicitly chose to remove protections)
                    if ($isSafeguardingSet) {
                        DB::update(
                            "UPDATE user_messaging_restrictions SET requires_broker_approval = 0 WHERE user_id = ? AND tenant_id = ?",
                            [$userId, $userTenantId]
                        );
                    }
                }

                $this->auditLogService->log('user_monitoring_removed', null, $adminId, ['user_id' => $userId, 'user_name' => $userName, 'actor_role' => $this->resolveActorRole()]);

                try {
                    LocaleContext::withLocale($user, function () use ($userId) {
                        Notification::createNotification($userId, __('api_controllers_3.admin_bells.monitoring_lifted'), '/messages', 'system', true);
                        \App\Services\NotificationDispatcher::fanOutPush((int) ($userId), 'system', __('api_controllers_3.admin_bells.monitoring_lifted'), '/messages');
                    });
                } catch (\Throwable $e) { \Log::warning('[AdminBroker] restrictions-lifted notification failed', ['user_id' => $userId, 'error' => $e->getMessage()]); }

                return $this->respondWithData(['user_id' => $userId, 'under_monitoring' => false]);
            }
        } catch (\Exception $e) {
            return $this->respondWithError('SERVER_ERROR', __('api.update_failed', ['resource' => 'monitoring']), null, 500);
        }
    }

    // ============================================
    // ARCHIVES
    // ============================================

    /** GET /api/v2/admin/broker/archives */
    public function archives(): JsonResponse
    {
        $this->requireBrokerOrAdmin();
        $isSuperAdmin = $this->isSuperAdmin();
        $tenantId = TenantContext::getId();

        $page = $this->queryInt('page', 1, 1);
        $perPage = $this->queryInt('per_page', 20, 1, 100);
        $decision = $this->query('decision');
        $search = $this->query('search');
        $from = $this->query('from');
        $to = $this->query('to');
        $offset = ($page - 1) * $perPage;

        if ($from) {
            try {
                Carbon::createFromFormat('Y-m-d', $from);
            } catch (\Exception $e) {
                return $this->respondWithError(
                    'VALIDATION_ERROR',
                    __('api.invalid_date_format', ['field' => 'from', 'format' => 'Y-m-d']),
                    'from',
                    422,
                );
            }
        }
        if ($to) {
            try {
                Carbon::createFromFormat('Y-m-d', $to);
            } catch (\Exception $e) {
                return $this->respondWithError(
                    'VALIDATION_ERROR',
                    __('api.invalid_date_format', ['field' => 'to', 'format' => 'Y-m-d']),
                    'to',
                    422,
                );
            }
        }

        try {
            $conditions = [];
            $params = [];

            $effectiveTenantId = $this->resolveEffectiveTenantId($isSuperAdmin, $tenantId);
            if ($effectiveTenantId !== null) {
                $conditions[] = 'bra.tenant_id = ?';
                $params[] = $effectiveTenantId;
            }
            if ($decision && $decision !== 'all') {
                $conditions[] = 'bra.decision = ?';
                $params[] = $decision;
            }
            if ($search) {
                $conditions[] = '(bra.sender_name LIKE ? OR bra.receiver_name LIKE ?)';
                $params[] = "%{$search}%";
                $params[] = "%{$search}%";
            }
            if ($from) {
                $conditions[] = 'bra.decided_at >= ?';
                $params[] = $from;
            }
            if ($to) {
                $conditions[] = 'bra.decided_at <= ?';
                $params[] = $to . ' 23:59:59';
            }

            $where = !empty($conditions) ? implode(' AND ', $conditions) : '1=1';

            $countRow = DB::selectOne("SELECT COUNT(*) as cnt FROM broker_review_archives bra WHERE {$where}", $params);
            $total = (int) ($countRow->cnt ?? 0);

            $queryParams = array_merge($params, [$perPage, $offset]);
            $items = DB::select(
                "SELECT bra.id, bra.tenant_id, bra.broker_copy_id, bra.sender_id, bra.sender_name, bra.receiver_id, bra.receiver_name,
                    bra.related_listing_id, bra.listing_title, bra.copy_reason, bra.decision, bra.decision_notes,
                    bra.decided_by, bra.decided_by_name, bra.decided_at, bra.flag_reason, bra.flag_severity, bra.created_at,
                    t.name as tenant_name
                FROM broker_review_archives bra
                LEFT JOIN tenants t ON bra.tenant_id = t.id
                WHERE {$where}
                ORDER BY bra.decided_at DESC
                LIMIT ? OFFSET ?",
                $queryParams
            );
            $items = array_map(fn($r) => (array)$r, $items);

            foreach ($items as &$item) {
                $item['tenant_name'] = $item['tenant_name'] ?? 'Unknown';
            }
            unset($item);

            return $this->respondWithPaginatedCollection($items, $total, $page, $perPage);
        } catch (\Exception $e) {
            return $this->respondWithPaginatedCollection([], 0, $page, $perPage);
        }
    }

    /** GET /api/v2/admin/broker/archives/{id} */
    public function showArchive(int $id): JsonResponse
    {
        $this->requireBrokerOrAdmin();
        $isSuperAdmin = $this->isSuperAdmin();
        $tenantId = TenantContext::getId();

        try {
            if ($isSuperAdmin) {
                $archive = DB::selectOne(
                    "SELECT bra.*, t.name as tenant_name FROM broker_review_archives bra LEFT JOIN tenants t ON bra.tenant_id = t.id WHERE bra.id = ?",
                    [$id]
                );
            } else {
                $archive = DB::selectOne(
                    "SELECT bra.*, t.name as tenant_name FROM broker_review_archives bra LEFT JOIN tenants t ON bra.tenant_id = t.id WHERE bra.id = ? AND bra.tenant_id = ?",
                    [$id, $tenantId]
                );
            }

            if (!$archive) {
                return $this->respondWithError('NOT_FOUND', __('api.not_found', ['model' => 'Archive']), null, 404);
            }

            $archive = (array) $archive;
            $archive['tenant_name'] = $archive['tenant_name'] ?? 'Unknown';

            if (!empty($archive['conversation_snapshot'])) {
                $archive['conversation_snapshot'] = json_decode($archive['conversation_snapshot'], true) ?? [];
            } else {
                $archive['conversation_snapshot'] = [];
            }

            return $this->respondWithData($archive);
        } catch (\Exception $e) {
            return $this->respondWithError('SERVER_ERROR', __('api.fetch_failed', ['resource' => 'archive']), null, 500);
        }
    }

    // ============================================
    // CONFIGURATION
    // ============================================

    /** GET /api/v2/admin/broker/configuration */
    public function getConfiguration(): JsonResponse
    {
        $this->requireBrokerOrAdmin();
        $isSuperAdmin = $this->isSuperAdmin();
        $tenantId = TenantContext::getId();
        $effectiveTenantId = $this->resolveEffectiveTenantId($isSuperAdmin, $tenantId);

        $defaults = [
            'broker_messaging_enabled' => true, 'broker_copy_all_messages' => false,
            'broker_copy_threshold_hours' => 5, 'new_member_monitoring_days' => 30,
            'require_exchange_for_listings' => false, 'risk_tagging_enabled' => true,
            'auto_flag_high_risk' => true, 'require_approval_high_risk' => false,
            'notify_on_high_risk_match' => true, 'broker_approval_required' => true,
            'auto_approve_low_risk' => false, 'exchange_timeout_days' => 7,
            'max_hours_without_approval' => 5, 'confirmation_deadline_hours' => 48,
            'allow_hour_adjustment' => false, 'max_hour_variance_percent' => 20,
            'expiry_hours' => 168, 'broker_visible_to_members' => false,
            'show_broker_name' => false, 'broker_contact_email' => '',
            'copy_first_contact' => true, 'copy_new_member_messages' => true,
            'copy_high_risk_listing_messages' => true, 'random_sample_percentage' => 0,
            'retention_days' => 90,
            'insurance_enabled' => false,
            'enforce_insurance_on_exchanges' => false,
            'insurance_expiry_warning_days' => 30,
        ];

        $scopeTenantId = $effectiveTenantId ?? $tenantId;

        try {
            if ($effectiveTenantId === null) {
                $rows = DB::select(
                    "SELECT t.id as tenant_id, t.name as tenant_name, ts.setting_value
                     FROM tenants t
                     LEFT JOIN tenant_settings ts
                       ON ts.tenant_id = t.id AND ts.setting_key = 'broker_config'
                     ORDER BY t.name ASC"
                );

                $allConfigs = [];
                foreach ($rows as $r) {
                    $saved = json_decode($r->setting_value, true) ?? [];
                    $runtimeConfig = BrokerControlConfigService::nestedToFlat(
                        BrokerControlConfigService::getConfigForTenant((int) $r->tenant_id)
                    );
                    $allConfigs[] = [
                        'tenant_id' => (int) $r->tenant_id,
                        'tenant_name' => $r->tenant_name ?? 'Unknown',
                        'config' => $this->withoutRetiredVettingConfig(
                            array_merge($defaults, $runtimeConfig, $saved),
                        ),
                    ];
                }
                return $this->respondWithData($allConfigs);
            }

            $row = DB::selectOne(
                "SELECT setting_value FROM tenant_settings WHERE tenant_id = ? AND setting_key = 'broker_config'",
                [$scopeTenantId]
            );

            $config = array_merge(
                $defaults,
                BrokerControlConfigService::nestedToFlat(
                    BrokerControlConfigService::getConfigForTenant($scopeTenantId)
                )
            );
            if ($row && !empty($row->setting_value)) {
                $saved = json_decode($row->setting_value, true) ?? [];
                $config = array_merge($config, $saved);
            }

            $config = $this->withoutRetiredVettingConfig($config);

            return $this->respondWithData($config);
        } catch (\Exception $e) {
            return $this->respondWithData($defaults);
        }
    }

    /** PUT /api/v2/admin/broker/configuration */
    public function saveConfiguration(): JsonResponse
    {
        $adminId = $this->requireBrokerOrAdmin();
        $tenantId = TenantContext::getId();

        $body = $this->getAllInput();

        // Cross-tenant config writes are NOT supported here. The legacy
        // body.tenant_id override let a super-admin write tenant B's
        // tenant_settings row while the downstream BrokerControlConfigService
        // (which uses TenantContext::getId() internally) wrote tenant A's
        // tenants.configuration JSON — a silent split that left the two
        // halves of the config in different tenants. Always operate on
        // the caller's home tenant. Super admins who need to edit
        // another tenant's broker config should switch tenant first.
        $targetTenantId = $tenantId;

        $allowedKeys = [
            'broker_messaging_enabled', 'broker_copy_all_messages', 'broker_copy_threshold_hours',
            'new_member_monitoring_days', 'require_exchange_for_listings',
            'risk_tagging_enabled', 'auto_flag_high_risk', 'require_approval_high_risk',
            'notify_on_high_risk_match', 'broker_approval_required', 'require_broker_approval',
            'exchange_workflow_enabled', 'require_broker_approval_new_members',
            'require_broker_approval_high_risk', 'require_broker_approval_over_hours',
            'auto_approve_low_risk',
            'exchange_timeout_days', 'max_hours_without_approval', 'confirmation_deadline_hours',
            'allow_hour_adjustment', 'max_hour_variance_percent', 'expiry_hours',
            'broker_visible_to_members', 'show_broker_name', 'broker_contact_email',
            'copy_first_contact', 'copy_new_member_messages', 'copy_high_risk_listing_messages',
            'random_sample_percentage', 'retention_days',
            'insurance_enabled', 'enforce_insurance_on_exchanges',
            'insurance_expiry_warning_days',
        ];

        // Privilege boundary: brokers/coordinators tune their day-to-day
        // operating thresholds (e.g. monitoring days, retention, copy
        // criteria), but tenant-wide enforcement toggles — insurance gating,
        // approval requirements, blanket message copying — are
        // policy decisions reserved for admins. Without this gate a broker
        // could disable platform-wide vetting enforcement for their tenant.
        $adminOnlyKeys = [
            'broker_messaging_enabled', 'broker_copy_all_messages',
            'risk_tagging_enabled', 'auto_flag_high_risk', 'require_approval_high_risk',
            'notify_on_high_risk_match', 'broker_approval_required', 'require_broker_approval',
            'exchange_workflow_enabled', 'require_broker_approval_new_members',
            'require_broker_approval_high_risk', 'require_broker_approval_over_hours',
            'auto_approve_low_risk', 'max_hours_without_approval',
            'insurance_enabled', 'enforce_insurance_on_exchanges',
            'require_exchange_for_listings',
        ];
        $callerUser = $this->resolveUserObject();
        $callerRole = (string) ($callerUser->role ?? 'member');
        $isAdminTier = in_array($callerRole, ['admin', 'tenant_admin', 'super_admin', 'god'], true)
            || ($callerUser->is_admin ?? false)
            || ($callerUser->is_super_admin ?? false)
            || ($callerUser->is_tenant_super_admin ?? false)
            || ($callerUser->is_god ?? false);

        $config = [];
        $rejectedAdminOnly = [];
        foreach ($allowedKeys as $key) {
            if (!array_key_exists($key, $body)) {
                continue;
            }
            if (in_array($key, $adminOnlyKeys, true) && !$isAdminTier) {
                $rejectedAdminOnly[] = $key;
                continue;
            }
            $config[$key] = $body[$key];
        }

        if (!empty($rejectedAdminOnly)) {
            return $this->respondWithError(
                'FORBIDDEN',
                __('api.broker_config_admin_only_keys', ['keys' => implode(', ', $rejectedAdminOnly)]),
                null,
                403
            );
        }

        try {
            $existing = DB::selectOne(
                "SELECT id, setting_value FROM tenant_settings WHERE tenant_id = ? AND setting_key = 'broker_config'",
                [$targetTenantId]
            );

            $savedConfig = [];
            if ($existing && !empty($existing->setting_value)) {
                $savedConfig = json_decode($existing->setting_value, true) ?? [];
            }

            // Partial updates must preserve previously saved policy keys.
            // Otherwise a broker saving an allowed threshold can wipe
            // admin-owned controls from tenant_settings.broker_config.
            $mergedConfig = $this->withoutRetiredVettingConfig(array_merge($savedConfig, $config));
            $json = json_encode($mergedConfig);
            if ($existing) {
                DB::update(
                    "UPDATE tenant_settings SET setting_value = ?, updated_at = NOW() WHERE tenant_id = ? AND setting_key = 'broker_config'",
                    [$json, $targetTenantId]
                );
            } else {
                DB::insert(
                    "INSERT INTO tenant_settings (tenant_id, setting_key, setting_value, created_at, updated_at) VALUES (?, 'broker_config', ?, NOW(), NOW())",
                    [$targetTenantId, $json]
                );
            }

            // Workflow keys gate when an exchange needs broker sign-off. They
            // are platform-wide policy and require admin tier — the same
            // boundary as the JSON-stored broker_config above. Brokers may
            // already have helped author the policy, but flipping the
            // toggles is an admin decision.
            $workflowKeys = [
                'require_broker_approval', 'auto_approve_low_risk', 'max_hours_without_approval',
                'exchange_workflow_enabled', 'require_broker_approval_new_members',
                'require_broker_approval_high_risk', 'require_broker_approval_over_hours',
            ];
            // Boolean workflow flags — cast explicitly so string 'false' / '0' / ''
            // values from JSON-decoded request bodies are never treated as truthy.
            $booleanWorkflowKeys = [
                'require_broker_approval', 'auto_approve_low_risk',
                'exchange_workflow_enabled', 'require_broker_approval_new_members',
                'require_broker_approval_high_risk', 'require_broker_approval_over_hours',
            ];
            $workflowConfig = [];
            foreach ($workflowKeys as $key) {
                if (array_key_exists($key, $body)) {
                    $workflowConfig[$key] = in_array($key, $booleanWorkflowKeys, true)
                        ? (bool) $body[$key]
                        : $body[$key];
                }
            }
            if (!empty($workflowConfig) && !$isAdminTier) {
                return $this->respondWithError(
                    'FORBIDDEN',
                    __('api.broker_config_admin_only_keys', ['keys' => implode(', ', array_keys($workflowConfig))]),
                    null,
                    403
                );
            }
            if (!empty($workflowConfig)) {
                $this->brokerControlConfigService->updateConfig($workflowConfig);
            }
            if (!empty($config)) {
                $this->brokerControlConfigService->updateConfig($config);
            }

            // Audit log — broker config governs platform-wide messaging
            // visibility, vetting/insurance enforcement, and approval rules.
            // Changes MUST be auditable. AuditLogService::log signature is
            // ($action, $organizationId, $userId, $details, $targetUserId).
            $this->auditLogService->log(
                'broker_config_updated',
                null,
                $adminId,
                ['updated_keys' => array_keys($config), 'actor_role' => $this->resolveActorRole()]
            );

            return $this->respondWithData($mergedConfig);
        } catch (\Exception $e) {
            return $this->respondWithError('SERVER_ERROR', __('api.failed_to_save_config'), null, 500);
        }
    }

    /** GET /api/v2/admin/broker/unreviewed-count */
    public function unreviewedCount(): JsonResponse
    {
        $this->requireBrokerOrAdmin();

        $count = $this->brokerMessageVisibilityService->countUnreviewed();

        return $this->respondWithData(['count' => $count]);
    }

    // ============================================
    // PRIVATE HELPERS
    // ============================================

    private function notifyAdminsOfRiskTagChange(int $listingId, string $riskLevel, int $brokerId): void
    {
        try {
            $listing = DB::selectOne(
                "SELECT l.title, u.name as owner_name FROM listings l LEFT JOIN users u ON l.user_id = u.id WHERE l.id = ?",
                [$listingId]
            );

            if ($listing) {
                // Don't pass an explicit $message — let notifyAdmins fall back
                // to its built-in NotificationDispatcher::buildNotificationContent
                // which renders via __('notifications.listing_risk_tagged', ...)
                // per-recipient (each admin gets the bell in their own locale).
                $this->notificationDispatcher->notifyAdmins(
                    'listing_risk_tagged',
                    [
                        'listing_id' => $listingId,
                        'listing_title' => $listing->title ?? 'Unknown',
                        'owner_name' => $listing->owner_name ?? 'Unknown',
                        'risk_level' => $riskLevel,
                        'tagged_by' => $brokerId,
                        'title' => $listing->title ?? '',
                        'level' => $riskLevel,
                    ]
                );
            }
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("Failed to notify admins of risk tag: " . $e->getMessage());
        }
    }
}
