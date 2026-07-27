<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\I18n\LocaleContext;
use App\Services\FederationActivityService;
use App\Services\FederationAuditService;
use App\Services\FederationDirectoryService;
use App\Services\FederationFeatureService;
use App\Services\FederationInternalLedgerService;
use App\Services\FederationPartnershipService;
use App\Models\Notification;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Core\TenantContext;

/**
 * AdminFederationController -- Federation management.
 *
 * Converted from legacy delegation to direct DB/service calls.
 * CSV export methods remain as delegation (write to php://output).
 */
class AdminFederationController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly FederationDirectoryService $federationDirectoryService,
        private readonly FederationPartnershipService $federationPartnershipService,
    ) {}

    private const ALLOWED_TABLES = [
        'federation_partnerships', 'federation_transactions', 'federation_messages',
        'federation_api_keys', 'federation_user_settings', 'federation_audit_log',
        'federation_connections', 'transactions',
    ];

    private function tableExists(string $table): bool
    {
        if (!in_array($table, self::ALLOWED_TABLES, true)) { return false; }
        try { DB::select("SELECT 1 FROM `{$table}` LIMIT 1"); return true; } catch (\Exception $e) { return false; }
    }

    private function setTenantFeature(int $tenantId, string $feature, bool $enabled, ?int $adminId = null): void
    {
        DB::statement(
            "REPLACE INTO federation_tenant_features
             (tenant_id, feature_key, is_enabled, updated_at, updated_by)
             VALUES (?, ?, ?, NOW(), ?)",
            [$tenantId, $feature, $enabled ? 1 : 0, $adminId]
        );

        try {
            app(FederationFeatureService::class)->clearCache();
        } catch (\Throwable) {
            // Best-effort cache clear; the DB row is the source of truth.
        }
    }

    /**
     * Notify admin users in a partner tenant about a federation event.
     *
     * Uses explicit tenantId parameter on createNotification() for cross-tenant writes.
     */
    private function notifyPartnerAdmins(int $partnerTenantId, string $messageKey, array $messageParams = [], string $type = 'federation', ?string $link = '/admin/federation'): void
    {
        try {
            $admins = DB::select(
                "SELECT id, preferred_language FROM users WHERE tenant_id = ? AND role IN ('admin', 'tenant_admin') AND status = 'active'",
                [$partnerTenantId]
            );
            foreach ($admins as $admin) {
                // Render message text inside each recipient's preferred_language
                // so the bell text appears in THEIR locale, not the caller's.
                LocaleContext::withLocale($admin, function () use ($admin, $messageKey, $messageParams, $link, $type, $partnerTenantId) {
                    $message = __($messageKey, $messageParams);
                    Notification::createNotification(
                        (int) $admin->id,
                        $message,
                        $link,
                        $type,
                        true,
                        $partnerTenantId
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) ((int) $admin->id), (string) $type, $message, $link);
                });
            }
        } catch (\Exception $e) {
            Log::warning('[Federation] Failed to notify partner admins', [
                'partner_tenant_id' => $partnerTenantId,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Get the current tenant's display name.
     */
    private function getTenantName(int $tenantId): string
    {
        try {
            $tenant = DB::selectOne("SELECT name FROM tenants WHERE id = ?", [$tenantId]);
            return $tenant->name ?? 'A partner community';
        } catch (\Exception $e) {
            return 'A partner community';
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Already converted methods
    // ─────────────────────────────────────────────────────────────────────────

    /** GET /api/v2/admin/federation */
    public function index(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $features = DB::select('SELECT * FROM federation_tenant_features WHERE tenant_id = ?', [$tenantId]);
        $whitelist = DB::select('SELECT * FROM federation_tenant_whitelist WHERE tenant_id = ?', [$tenantId]);
        return $this->respondWithData(['features' => $features, 'whitelist' => $whitelist]);
    }

    // SEC-004 (removed 2026-06-21): the unrouted timebanks() method ran an UNSCOPED
    // `SELECT id,name,slug,domain FROM tenants WHERE is_active = 1` gated only by
    // requireAdmin(), which would have leaked the full tenant directory to any tenant
    // admin had a route ever been wired to it. It was dead code (no route, no callers);
    // deleted to remove the latent leak. The live, partnership-scoped directory is
    // GET /v1/federation/timebanks -> FederationController::timebanks (fedAuth-gated).

    /** GET /api/v2/admin/federation/controls */
    public function controls(): JsonResponse
    {
        $this->requireAdmin();
        $row = DB::selectOne('SELECT * FROM federation_system_control WHERE id = 1');
        if (!$row) {
            return $this->respondWithData([]);
        }
        $result = (array) $row;
        unset($result['id'], $result['created_at'], $result['updated_at'], $result['updated_by']);
        return $this->respondWithData($result);
    }

    /** PUT /api/v2/admin/federation/controls */
    public function updateControls(): JsonResponse
    {
        $adminId = $this->requireSuperAdmin();
        $data = $this->getAllInput();

        $allowedColumns = [
            'federation_enabled', 'whitelist_mode_enabled', 'max_federation_level',
            'cross_tenant_profiles_enabled', 'cross_tenant_messaging_enabled',
            'cross_tenant_transactions_enabled', 'cross_tenant_listings_enabled',
            'cross_tenant_events_enabled', 'cross_tenant_groups_enabled',
            'emergency_lockdown_active', 'emergency_lockdown_reason',
        ];

        $updates = [];
        $bindings = [];
        foreach ($data as $key => $value) {
            if (in_array($key, $allowedColumns, true)) {
                $updates[] = "`{$key}` = ?";
                $bindings[] = $value;
            }
        }

        if (empty($updates)) {
            return $this->respondWithData(['updated' => 0]);
        }

        $bindings[] = $adminId;
        $sql = 'UPDATE federation_system_control SET ' . implode(', ', $updates) . ', updated_by = ? WHERE id = 1';
        $updated = DB::update($sql, $bindings);

        return $this->respondWithData(['updated' => $updated]);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Settings
    // ─────────────────────────────────────────────────────────────────────────

    public function settings(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $featureService = app(FederationFeatureService::class);
        $tenantFeatures = $featureService->getAllTenantFeatures($tenantId);

        $data = [
            'federation_enabled' => (bool) ($tenantFeatures[FederationFeatureService::TENANT_FEDERATION_ENABLED]['enabled'] ?? false),
            'system_federation_enabled' => $featureService->isGloballyEnabled(),
            // External partner federation kill switch. Surfaced here (rather
            // than only on the platform-super-admin endpoint) so the Partner
            // Timebanks panel can tell its operators — who may be tenant super
            // admins — that external protocol traffic is currently blocked.
            'external_federation' => $featureService->externalProtocolStatus(),
            'tenant_features' => $tenantFeatures,
            'tenant_id' => $tenantId,
            'settings' => ['allow_inbound_partnerships' => true, 'auto_approve_partners' => false, 'shared_categories' => [], 'max_partnerships' => 10],
        ];

        try {
            $row = DB::selectOne("SELECT configuration FROM tenants WHERE id = ?", [$tenantId]);
            if ($row && !empty($row->configuration)) {
                $config = json_decode($row->configuration, true);
                if (isset($config['federation']) && is_array($config['federation'])) {
                    $fc = $config['federation'];
                    $data['settings'] = array_merge($data['settings'], array_diff_key($fc, ['federation_enabled' => '']));
                }
            }
        } catch (\Exception $e) { Log::warning('Stats query failed in ' . __METHOD__, ['error' => $e->getMessage()]); }

        return $this->respondWithData($data);
    }

    public function updateSettings(): JsonResponse
    {
        $adminId = $this->requireSuperAdmin();
        $tenantId = TenantContext::getId();
        $input = $this->getAllInput();
        $featureMap = [
            'appear_in_directory' => FederationFeatureService::TENANT_APPEAR_IN_DIRECTORY,
            'auto_accept_hierarchy' => FederationFeatureService::TENANT_AUTO_ACCEPT_HIERARCHY,
            'profiles_enabled' => FederationFeatureService::TENANT_PROFILES_ENABLED,
            'messaging_enabled' => FederationFeatureService::TENANT_MESSAGING_ENABLED,
            'transactions_enabled' => FederationFeatureService::TENANT_TRANSACTIONS_ENABLED,
            'listings_enabled' => FederationFeatureService::TENANT_LISTINGS_ENABLED,
            'events_enabled' => FederationFeatureService::TENANT_EVENTS_ENABLED,
            'groups_enabled' => FederationFeatureService::TENANT_GROUPS_ENABLED,
        ];

        try {
            $row = DB::selectOne("SELECT configuration FROM tenants WHERE id = ?", [$tenantId]);
            $config = json_decode($row->configuration ?? '{}', true) ?: [];

            $federationSettings = $config['federation'] ?? [];
            if (isset($input['settings']) && is_array($input['settings'])) {
                $allowedSettingKeys = [
                    'allow_inbound_partnerships', 'auto_approve_partners',
                    'shared_categories', 'max_partnerships',
                ];
                $filtered = array_intersect_key($input['settings'], array_flip($allowedSettingKeys));
                $federationSettings = array_merge($federationSettings, $filtered);

                foreach ($featureMap as $inputKey => $featureKey) {
                    if (array_key_exists($inputKey, $input['settings'])) {
                        $this->setTenantFeature($tenantId, $featureKey, (bool) $input['settings'][$inputKey], $adminId);
                    }
                }
            }
            if (isset($input['federation_enabled'])) {
                $this->setTenantFeature($tenantId, FederationFeatureService::TENANT_FEDERATION_ENABLED, (bool) $input['federation_enabled'], $adminId);
            }
            $config['federation'] = $federationSettings;

            DB::update("UPDATE tenants SET configuration = ? WHERE id = ?", [json_encode($config), $tenantId]);
            try { app(\App\Services\RedisCache::class)->delete('tenant_bootstrap', $tenantId); } catch (\Exception $e) { Log::warning('Stats query failed in ' . __METHOD__, ['error' => $e->getMessage()]); }

            $featureService = app(FederationFeatureService::class);
            $tenantFeatures = $featureService->getAllTenantFeatures($tenantId);

            return $this->respondWithData([
                'federation_enabled' => (bool) ($tenantFeatures[FederationFeatureService::TENANT_FEDERATION_ENABLED]['enabled'] ?? false),
                'system_federation_enabled' => $featureService->isGloballyEnabled(),
                'tenant_features' => $tenantFeatures,
                'tenant_id' => $tenantId,
                'settings' => array_diff_key($federationSettings, ['federation_enabled' => '']),
            ]);
        } catch (\Exception $e) {
            return $this->respondWithError('UPDATE_FAILED', __('api.update_failed', ['resource' => 'federation settings']), null, 500);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Partnerships
    // ─────────────────────────────────────────────────────────────────────────

    public function partnerships(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        if (!$this->tableExists('federation_partnerships')) { return $this->respondWithData([]); }

        try {
            $items = DB::select(
                "SELECT fp.*, t.name as partner_name, t.slug as partner_slug
                 FROM federation_partnerships fp
                 LEFT JOIN tenants t ON t.id = CASE WHEN fp.tenant_id = ? THEN fp.partner_tenant_id ELSE fp.tenant_id END
                 WHERE fp.tenant_id = ? OR fp.partner_tenant_id = ?
                 ORDER BY fp.created_at DESC",
                [$tenantId, $tenantId, $tenantId]
            );
            return $this->respondWithData(array_map(fn($r) => (array)$r, $items) ?: []);
        } catch (\Exception $e) { return $this->respondWithData([]); }
    }

    public function approvePartnership($id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $id = (int) $id;

        if (!$id || !$this->tableExists('federation_partnerships')) {
            return $this->respondWithError('NOT_FOUND', __('api.partnership_not_found'), null, 404);
        }

        try {
            $result = FederationPartnershipService::approvePartnership($id, $adminId);

            if (!$result['success']) {
                $statusCode = str_contains($result['error'] ?? '', 'not found') ? 404 : 409;
                return $this->respondWithError('APPROVE_FAILED', $result['error'], null, $statusCode);
            }

            // Notify the initiating tenant's admins that partnership was approved
            $partnership = FederationPartnershipService::getPartnershipById($id);
            if ($partnership) {
                $initiatorTenantId = (int) $partnership['tenant_id'];
                $tenantName = $this->getTenantName($tenantId);
                $this->notifyPartnerAdmins(
                    $initiatorTenantId,
                    'svc_notifications_2.federation.notify_partnership_approved',
                    ['tenant_name' => $tenantName],
                    'federation_partnership_approved'
                );
            }

            return $this->respondWithData(['message' => __('api.partnership_approved')]);
        } catch (\Exception $e) {
            return $this->respondWithError('UPDATE_FAILED', __('api.approve_failed', ['resource' => 'partnership']));
        }
    }

    public function rejectPartnership($id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $id = (int) $id;
        $input = $this->getAllInput();
        $reason = isset($input['reason']) ? substr(trim($input['reason']), 0, 1000) : null;

        if (!$id || !$this->tableExists('federation_partnerships')) {
            return $this->respondWithError('NOT_FOUND', __('api.partnership_not_found'), null, 404);
        }

        try {
            // Fetch partnership before rejection so we can notify the right tenant
            $partnership = FederationPartnershipService::getPartnershipById($id);

            $result = FederationPartnershipService::rejectPartnership($id, $adminId, $reason);

            if (!$result['success']) {
                $statusCode = str_contains($result['error'] ?? '', 'not found') ? 404 : 409;
                return $this->respondWithError('REJECT_FAILED', $result['error'], null, $statusCode);
            }

            // Notify the other tenant's admins that partnership was rejected
            if ($partnership) {
                $otherTenantId = ((int) $partnership['tenant_id'] === $tenantId)
                    ? (int) $partnership['partner_tenant_id']
                    : (int) $partnership['tenant_id'];
                $tenantName = $this->getTenantName($tenantId);
                $this->notifyPartnerAdmins(
                    $otherTenantId,
                    'svc_notifications_2.federation.notify_partnership_rejected',
                    ['tenant_name' => $tenantName],
                    'federation_partnership_rejected'
                );
            }

            return $this->respondWithData(['message' => __('api.partnership_rejected')]);
        } catch (\Exception $e) {
            return $this->respondWithError('UPDATE_FAILED', __('api.reject_failed', ['resource' => 'partnership']));
        }
    }

    public function terminatePartnership($id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $id = (int) $id;
        $input = $this->getAllInput();
        $reason = isset($input['reason']) ? substr(trim($input['reason']), 0, 1000) : null;

        if (!$id || !$this->tableExists('federation_partnerships')) {
            return $this->respondWithError('NOT_FOUND', __('api.partnership_not_found'), null, 404);
        }

        try {
            // Fetch partnership before termination so we can notify the right tenant
            $partnership = FederationPartnershipService::getPartnershipById($id);

            $result = FederationPartnershipService::terminatePartnership($id, $adminId, $reason);

            if (!$result['success']) {
                $statusCode = str_contains($result['error'] ?? '', 'not found') ? 404 : 409;
                return $this->respondWithError('TERMINATE_FAILED', $result['error'], null, $statusCode);
            }

            // Notify the other tenant's admins that partnership was terminated
            if ($partnership) {
                $otherTenantId = ((int) $partnership['tenant_id'] === $tenantId)
                    ? (int) $partnership['partner_tenant_id']
                    : (int) $partnership['tenant_id'];
                $tenantName = $this->getTenantName($tenantId);
                $this->notifyPartnerAdmins(
                    $otherTenantId,
                    'svc_notifications_2.federation.notify_partnership_terminated',
                    ['tenant_name' => $tenantName],
                    'federation_partnership_terminated'
                );
            }

            return $this->respondWithData(['message' => __('api.partnership_terminated')]);
        } catch (\Exception $e) {
            return $this->respondWithError('UPDATE_FAILED', __('api.update_failed', ['resource' => 'partnership']));
        }
    }

    public function reactivatePartnership($id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $id = (int) $id;

        if (!$id || !$this->tableExists('federation_partnerships')) {
            return $this->respondWithError('NOT_FOUND', __('api.partnership_not_found'), null, 404);
        }

        try {
            $result = FederationPartnershipService::reactivatePartnership($id, $adminId);

            if (!$result['success']) {
                $statusCode = str_contains($result['error'] ?? '', 'not found') ? 404 : 409;
                return $this->respondWithError('REACTIVATE_FAILED', $result['error'], null, $statusCode);
            }

            // Notify the other tenant's admins that partnership was reactivated
            $partnership = FederationPartnershipService::getPartnershipById($id);
            if ($partnership) {
                $otherTenantId = ((int) $partnership['tenant_id'] === $tenantId)
                    ? (int) $partnership['partner_tenant_id']
                    : (int) $partnership['tenant_id'];
                $tenantName = $this->getTenantName($tenantId);
                $this->notifyPartnerAdmins(
                    $otherTenantId,
                    'svc_notifications_2.federation.notify_partnership_reactivated',
                    ['tenant_name' => $tenantName],
                    'federation_partnership_reactivated'
                );
            }

            return $this->respondWithData(['message' => __('api.partnership_reactivated')]);
        } catch (\Exception $e) {
            return $this->respondWithError('UPDATE_FAILED', __('api.update_failed', ['resource' => 'partnership']));
        }
    }

    public function requestPartnership(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $userId = $this->getUserId();
        $input = $this->getAllInput();
        $targetTenantId = (int)($input['target_tenant_id'] ?? 0);
        $notes = isset($input['notes']) ? substr(trim($input['notes']), 0, 1000) : null;

        if ($targetTenantId <= 0) { return $this->respondWithError('VALIDATION_ERROR', __('api.target_community_required'), 'target_tenant_id'); }
        if ($targetTenantId === $tenantId) { return $this->respondWithError('VALIDATION_ERROR', __('api.cannot_partner_with_self')); }

        try {
            $result = $this->federationPartnershipService->requestPartnership($tenantId, $targetTenantId, $userId, FederationPartnershipService::LEVEL_DISCOVERY, $notes);
            if ($result['success']) { return $this->respondWithData($result, null, 201); }
            return $this->respondWithError('REQUEST_FAILED', $result['error'] ?? __('api_controllers_1.admin_federation.partnership_request_failed'));
        } catch (\Exception $e) { return $this->respondWithError('REQUEST_FAILED', __('api_controllers_1.admin_federation.partnership_request_failed')); }
    }

    /** GET /api/v2/admin/federation/partnerships/{id} — Full partnership detail */
    public function partnershipDetail($id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $id = (int) $id;

        if (!$id || !$this->tableExists('federation_partnerships')) {
            return $this->respondWithError('NOT_FOUND', __('api.partnership_not_found'), null, 404);
        }

        try {
            $partnership = $this->federationPartnershipService->getPartnershipById($id, $tenantId);
            if (!$partnership) {
                return $this->respondWithError('NOT_FOUND', __('api.partnership_not_found'), null, 404);
            }

            $isInitiator = (int) $partnership['tenant_id'] === $tenantId;
            $partnerTenantId = $isInitiator ? (int) $partnership['partner_tenant_id'] : (int) $partnership['tenant_id'];
            $partnerName = $isInitiator ? ($partnership['partner_name'] ?? '') : ($partnership['tenant_name'] ?? '');

            $partnership['is_initiator'] = $isInitiator;
            $partnership['resolved_partner_tenant_id'] = $partnerTenantId;
            $partnership['resolved_partner_name'] = $partnerName;

            return $this->respondWithData($partnership);
        } catch (\Exception $e) {
            return $this->respondWithError('FETCH_FAILED', __('api_controllers_1.admin_federation.partnership_detail_failed'), null, 500);
        }
    }

    /** POST /api/v2/admin/federation/partnerships/{id}/counter-propose */
    public function counterProposePartnership($id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $id = (int) $id;
        $input = $this->getAllInput();

        $level = (int) ($input['level'] ?? FederationPartnershipService::LEVEL_DISCOVERY);
        $permissions = $input['permissions'] ?? [];
        $message = isset($input['message']) ? substr(trim($input['message']), 0, 1000) : null;

        if ($level < 1 || $level > 4) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.level_must_be_1_to_4'), 'level');
        }

        // Clamp to the system-wide maximum federation level: acceptance copies
        // counter_proposed_level straight into federation_level, so an
        // uncapped counter-proposal would bypass the platform ceiling.
        // (0 means "no ceiling configured" — skip the clamp in that case.)
        $maxLevel = app(FederationFeatureService::class)->getMaxFederationLevel();
        if ($maxLevel >= 1 && $level > $maxLevel) {
            $level = $maxLevel;
        }

        try {
            $result = FederationPartnershipService::counterPropose($id, $adminId, $level, $permissions, $message);
            if ($result['success']) {
                return $this->respondWithData($result);
            }
            return $this->respondWithError('COUNTER_PROPOSE_FAILED', $result['error'] ?? __('api_controllers_1.admin_federation.counter_propose_failed'));
        } catch (\Exception $e) {
            return $this->respondWithError('COUNTER_PROPOSE_FAILED', __('api_controllers_1.admin_federation.counter_proposal_send_failed'));
        }
    }

    /** PUT /api/v2/admin/federation/partnerships/{id}/permissions */
    public function updatePartnershipPermissions($id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $id = (int) $id;
        $input = $this->getAllInput();
        $permissions = $input['permissions'] ?? [];

        try {
            $result = FederationPartnershipService::updatePermissions($id, $adminId, $permissions);
            if ($result['success']) {
                return $this->respondWithData($result);
            }
            return $this->respondWithError('UPDATE_FAILED', $result['error'] ?? __('api_controllers_1.admin_federation.permissions_update_failed'));
        } catch (\Exception $e) {
            return $this->respondWithError('UPDATE_FAILED', __('api_controllers_1.admin_federation.partnership_permissions_update_failed'));
        }
    }

    /** GET /api/v2/admin/federation/partnerships/{id}/audit-log */
    public function partnershipAuditLog($id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $id = (int) $id;

        if (!$this->tableExists('federation_audit_log') || !$this->tableExists('federation_partnerships')) {
            return $this->respondWithData([]);
        }

        try {
            $partnership = DB::selectOne(
                "SELECT tenant_id, partner_tenant_id FROM federation_partnerships WHERE id = ? AND (tenant_id = ? OR partner_tenant_id = ?)",
                [$id, $tenantId, $tenantId]
            );
            if (!$partnership) {
                return $this->respondWithError('NOT_FOUND', __('api.partnership_not_found'), null, 404);
            }

            $t1 = (int) $partnership->tenant_id;
            $t2 = (int) $partnership->partner_tenant_id;

            $logs = DB::select(
                "SELECT fal.*, u.first_name, u.last_name
                 FROM federation_audit_log fal
                 LEFT JOIN users u ON fal.actor_user_id = u.id
                 WHERE fal.category = 'partnership'
                   AND ((fal.source_tenant_id = ? AND fal.target_tenant_id = ?)
                     OR (fal.source_tenant_id = ? AND fal.target_tenant_id = ?))
                 ORDER BY fal.created_at DESC
                 LIMIT 50",
                [$t1, $t2, $t2, $t1]
            );

            return $this->respondWithData(array_map(fn($r) => (array)$r, $logs));
        } catch (\Exception $e) {
            return $this->respondWithData([]);
        }
    }

    /** GET /api/v2/admin/federation/partnerships/{id}/stats */
    public function partnershipStats($id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $id = (int) $id;

        $stats = ['messages_exchanged' => 0, 'transactions_completed' => 0, 'connections_made' => 0];

        try {
            $partnership = DB::selectOne(
                "SELECT tenant_id, partner_tenant_id FROM federation_partnerships WHERE id = ? AND (tenant_id = ? OR partner_tenant_id = ?)",
                [$id, $tenantId, $tenantId]
            );
            if (!$partnership) {
                return $this->respondWithError('NOT_FOUND', __('api.partnership_not_found'), null, 404);
            }

            $t1 = (int) $partnership->tenant_id;
            $t2 = (int) $partnership->partner_tenant_id;

            if ($this->tableExists('federation_messages')) {
                try {
                    $row = DB::selectOne(
                        "SELECT COUNT(*) as total FROM federation_messages
                         WHERE direction = 'outbound'
                           AND external_partner_id IS NULL
                           AND (
                            (sender_tenant_id = ? AND receiver_tenant_id = ?)
                            OR (sender_tenant_id = ? AND receiver_tenant_id = ?)
                           )",
                        [$t1, $t2, $t2, $t1]
                    );
                    $stats['messages_exchanged'] = (int) ($row->total ?? 0);
                } catch (\Exception $e) { Log::warning('Stats query failed in ' . __METHOD__, ['error' => $e->getMessage()]); }
            }

            try {
                $stats['transactions_completed'] = FederationInternalLedgerService::countCompletedBetweenTenants($t1, $t2);
            } catch (\Exception $e) { Log::warning('Stats query failed in ' . __METHOD__, ['error' => $e->getMessage()]); }

            if ($this->tableExists('federation_connections')) {
                try {
                    $row = DB::selectOne(
                        "SELECT COUNT(*) as total FROM federation_connections
                         WHERE status = 'accepted'
                           AND (
                            (requester_tenant_id = ? AND receiver_tenant_id = ?)
                            OR (requester_tenant_id = ? AND receiver_tenant_id = ?)
                           )",
                        [$t1, $t2, $t2, $t1]
                    );
                    $stats['connections_made'] = (int) ($row->total ?? 0);
                } catch (\Exception $e) { Log::warning('Stats query failed in ' . __METHOD__, ['error' => $e->getMessage()]); }
            }

            return $this->respondWithData($stats);
        } catch (\Exception $e) {
            return $this->respondWithData($stats);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Directory & Profile
    // ─────────────────────────────────────────────────────────────────────────

    public function directory(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $filters = [];
        $search = $this->query('search'); if ($search) { $filters['search'] = substr(trim($search), 0, 200); }
        $region = $this->query('region'); if ($region) { $filters['region'] = substr(trim($region), 0, 100); }
        $category = $this->query('category'); if ($category) { $filters['category'] = substr(trim($category), 0, 100); }
        $topic = $this->query('topic'); if ($topic) { $filters['topic'] = substr(trim($topic), 0, 100); }
        if ($this->queryBool('exclude_partnered')) { $filters['exclude_partnered'] = true; }

        try {
            $communities = $this->federationDirectoryService->getDiscoverableTimebanks($tenantId, $filters);
            $regions = $this->federationDirectoryService->getAvailableRegions();
            $categories = $this->federationDirectoryService->getAvailableCategories();
            $topics = $this->federationDirectoryService->getActiveTopics();
            return $this->respondWithData(['communities' => $communities, 'regions' => $regions, 'categories' => $categories, 'topics' => $topics]);
        } catch (\Exception $e) {
            Log::warning('[FederationDirectory] Admin directory failed closed', ['tenant_id' => $tenantId, 'error' => $e->getMessage()]);
            return $this->respondWithData(['communities' => [], 'regions' => [], 'categories' => [], 'topics' => []]);
        }
    }

    public function profile(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        try {
            $profile = FederationDirectoryService::getTimebankProfile($tenantId);
            if (!$profile) {
                return $this->respondWithData([]);
            }

            $tenantRow = DB::selectOne("SELECT configuration FROM tenants WHERE id = ?", [$tenantId]);
            $config = json_decode($tenantRow->configuration ?? '{}', true) ?: [];
            $legacy = $config['federation_profile'] ?? [];

            $tenant = [
                'id' => $profile['id'],
                'name' => $profile['name'],
                'slug' => $profile['slug'],
                'is_active' => $profile['is_active'],
                'status' => $profile['is_active'] ? 'active' : 'inactive',
                'created_at' => $profile['created_at'],
                'tagline' => $profile['tagline'] ?? null,
                'logo_url' => $profile['logo_url'] ?? null,
                'cover_image_url' => $profile['cover_image_url'] ?? null,
                'country_code' => $profile['country_code'] ?? null,
                'region' => $profile['region'] ?? null,
                'city' => $profile['city'] ?? null,
                'show_member_count' => $profile['show_member_count'] ?? true,
                'show_activity_stats' => $profile['show_activity_stats'] ?? false,
                'show_location' => $profile['show_location'] ?? true,
                'federation_profile' => [
                    'description' => $profile['description'] ?? '',
                    'contact_email' => $legacy['contact_email'] ?? '',
                    'website' => $profile['website_url'] ?? ($legacy['website'] ?? ''),
                    'categories' => $legacy['categories'] ?? [],
                ],
            ];
            return $this->respondWithData($tenant);
        } catch (\Exception $e) { return $this->respondWithData([]); }
    }

    public function updateProfile(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $input = $this->getAllInput();

        try {
            $row = DB::selectOne("SELECT configuration FROM tenants WHERE id = ?", [$tenantId]);
            $config = json_decode($row->configuration ?? '{}', true) ?: [];
            $profileInput = isset($input['federation_profile']) && is_array($input['federation_profile'])
                ? $input['federation_profile']
                : $input;

            $directoryUpdate = [];
            if (isset($input['name'])) {
                $directoryUpdate['display_name'] = substr(trim((string) $input['name']), 0, 200);
            }
            if (isset($profileInput['description'])) {
                // Clamp like display_name/website — this text is published to
                // other tenants' directory UIs and must not be unbounded.
                $directoryUpdate['description'] = substr(trim((string) $profileInput['description']), 0, 2000);
            }
            if (isset($profileInput['website'])) {
                $directoryUpdate['website_url'] = substr(trim((string) $profileInput['website']), 0, 500);
            }
            if (isset($profileInput['website_url'])) {
                $directoryUpdate['website_url'] = substr(trim((string) $profileInput['website_url']), 0, 500);
            }

            if (!empty($directoryUpdate) && !FederationDirectoryService::updateDirectoryProfile($tenantId, $directoryUpdate)) {
                return $this->respondWithError('UPDATE_FAILED', __('api.update_failed', ['resource' => 'federation profile']), null, 500);
            }

            $legacyAllowedProfileKeys = ['contact_email', 'categories'];
            $filtered = array_intersect_key($profileInput, array_flip($legacyAllowedProfileKeys));
            if (!empty($filtered)) {
                $config['federation_profile'] = array_merge($config['federation_profile'] ?? [], $filtered);
            }
            DB::update("UPDATE tenants SET configuration = ? WHERE id = ?", [json_encode($config), $tenantId]);
            try { app(\App\Services\RedisCache::class)->delete('tenant_bootstrap', $tenantId); } catch (\Exception $e) { Log::warning('Stats query failed in ' . __METHOD__, ['error' => $e->getMessage()]); }
            return $this->profile();
        } catch (\Exception $e) {
            return $this->respondWithError('UPDATE_FAILED', __('api.update_failed', ['resource' => 'federation profile']), null, 500);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Topic / Interest Tags
    // ─────────────────────────────────────────────────────────────────────────

    /** GET /api/v2/admin/federation/topics — All predefined topics. */
    public function topics(): JsonResponse
    {
        $this->requireAdmin();
        $topics = $this->federationDirectoryService->getAllTopics();
        return $this->respondWithData($topics);
    }

    /** GET /api/v2/admin/federation/topics/mine — This tenant's selected topics. */
    public function myTopics(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $topics = $this->federationDirectoryService->getTenantTopics($tenantId);
        return $this->respondWithData($topics);
    }

    /** PUT /api/v2/admin/federation/topics/mine — Set this tenant's topics. */
    public function updateMyTopics(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $input = $this->getAllInput();

        $topicIds = array_map('intval', $input['topic_ids'] ?? []);
        $primaryIds = array_map('intval', $input['primary_ids'] ?? []);

        if (count($topicIds) > 10) {
            return $this->respondWithError('VALIDATION_ERROR', __('api_controllers_1.admin_federation.max_topics_exceeded'), null, 422);
        }

        $ok = $this->federationDirectoryService->setTenantTopics($tenantId, $topicIds, $primaryIds);
        if ($ok) {
            return $this->respondWithData($this->federationDirectoryService->getTenantTopics($tenantId));
        }
        return $this->respondWithError('UPDATE_FAILED', __('api.update_failed', ['resource' => 'topics']), null, 500);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Analytics, API Keys, Data Management
    // ─────────────────────────────────────────────────────────────────────────

    public function analytics(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $data = ['total_partnerships' => 0, 'active_partnerships' => 0, 'pending_requests' => 0, 'cross_community_transactions' => 0, 'cross_community_messages' => 0];

        if ($this->tableExists('federation_partnerships')) {
            try { $row = DB::selectOne("SELECT COUNT(*) as total, SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) as active_count, SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending FROM federation_partnerships WHERE tenant_id = ? OR partner_tenant_id = ?", [$tenantId, $tenantId]); $data['total_partnerships'] = (int)($row->total ?? 0); $data['active_partnerships'] = (int)($row->active_count ?? 0); $data['pending_requests'] = (int)($row->pending ?? 0); } catch (\Exception $e) { Log::warning('Stats query failed in ' . __METHOD__, ['error' => $e->getMessage()]); }
        }
        try {
            $data['cross_community_transactions'] = FederationInternalLedgerService::countForTenant($tenantId);
        } catch (\Exception $e) { Log::warning('Stats query failed in ' . __METHOD__, ['error' => $e->getMessage()]); }
        if ($this->tableExists('federation_messages')) {
            try {
                $row = DB::selectOne(
                    "SELECT COUNT(*) as total FROM federation_messages
                     WHERE (
                        external_partner_id IS NULL
                        AND direction = 'outbound'
                        AND (sender_tenant_id = ? OR receiver_tenant_id = ?)
                     ) OR (
                        external_partner_id IS NOT NULL
                        AND (
                            (direction = 'outbound' AND sender_tenant_id = ?)
                            OR (direction = 'inbound' AND receiver_tenant_id = ?)
                        )
                     )",
                    [$tenantId, $tenantId, $tenantId, $tenantId]
                );
                $data['cross_community_messages'] = (int)($row->total ?? 0);
            } catch (\Exception $e) { Log::warning('Stats query failed in ' . __METHOD__, ['error' => $e->getMessage()]); }
        }
        return $this->respondWithData($data);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Activity Feed
    // ─────────────────────────────────────────────────────────────────────────

    /** GET /api/v2/admin/federation/activity */
    public function activityFeed(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        if (!$this->tableExists('federation_audit_log')) {
            return $this->respondWithData(['items' => [], 'total' => 0, 'has_more' => false]);
        }

        $request = request();
        $limit = min(max((int) $request->input('limit', 25), 1), 100);
        $cursor = $request->input('cursor'); // ISO timestamp for cursor-based pagination
        $eventTypes = $request->input('event_type'); // comma-separated
        $partnerTenantId = $request->input('partner_tenant_id');
        $dateFrom = $request->input('date_from');
        $dateTo = $request->input('date_to');
        $search = $request->input('search');

        try {
            $query = DB::table('federation_audit_log')
                ->where(function ($q) use ($tenantId) {
                    $q->where('source_tenant_id', $tenantId)
                      ->orWhere('target_tenant_id', $tenantId);
                });

            // Filter by event types
            if (!empty($eventTypes)) {
                $types = array_filter(array_map('trim', explode(',', $eventTypes)));
                if (!empty($types)) {
                    $query->whereIn('action_type', $types);
                }
            }

            // Filter by partner tenant
            if (!empty($partnerTenantId)) {
                $partnerId = (int) $partnerTenantId;
                $query->where(function ($q) use ($partnerId) {
                    $q->where('source_tenant_id', $partnerId)
                      ->orWhere('target_tenant_id', $partnerId);
                });
            }

            // Date range filters
            if (!empty($dateFrom)) {
                $query->where('created_at', '>=', $dateFrom . ' 00:00:00');
            }
            if (!empty($dateTo)) {
                $query->where('created_at', '<=', $dateTo . ' 23:59:59');
            }

            // Search filter
            if (!empty($search)) {
                $term = '%' . $search . '%';
                $query->where(function ($q) use ($term) {
                    $q->where('actor_name', 'LIKE', $term)
                      ->orWhere('action_type', 'LIKE', $term)
                      ->orWhere('data', 'LIKE', $term);
                });
            }

            // Cursor-based pagination
            if (!empty($cursor)) {
                $query->where('created_at', '<', $cursor);
            }

            // Get total count (without cursor) for stats
            $countQuery = DB::table('federation_audit_log')
                ->where(function ($q) use ($tenantId) {
                    $q->where('source_tenant_id', $tenantId)
                      ->orWhere('target_tenant_id', $tenantId);
                });
            $total = $countQuery->count();

            $rows = $query->orderByDesc('created_at')
                ->limit($limit + 1) // fetch one extra to detect has_more
                ->get();

            $hasMore = $rows->count() > $limit;
            $items = $rows->take($limit);

            // Collect partner tenant IDs for batch lookup
            $partnerIds = [];
            foreach ($items as $row) {
                $pid = ((int) $row->source_tenant_id === $tenantId)
                    ? $row->target_tenant_id
                    : $row->source_tenant_id;
                if ($pid) {
                    $partnerIds[(int) $pid] = true;
                }
            }

            // Batch fetch partner tenant names
            $tenantNames = [];
            if (!empty($partnerIds)) {
                $ids = array_keys($partnerIds);
                $placeholders = implode(',', array_fill(0, count($ids), '?'));
                $tenants = DB::select("SELECT id, name, slug FROM tenants WHERE id IN ({$placeholders})", $ids);
                foreach ($tenants as $t) {
                    $tenantNames[(int) $t->id] = ['name' => $t->name, 'slug' => $t->slug];
                }
            }

            // Format items
            $formatted = $items->map(function ($row) use ($tenantId, $tenantNames) {
                $data = $row->data ? json_decode($row->data, true) : [];
                $isIncoming = ((int) $row->target_tenant_id === $tenantId);
                $partnerTid = $isIncoming ? (int) $row->source_tenant_id : (int) $row->target_tenant_id;

                return [
                    'id' => (int) $row->id,
                    'type' => $row->action_type,
                    'category' => $row->category ?? 'system',
                    'level' => $row->level ?? 'info',
                    'description' => FederationAuditService::getActionLabel($row->action_type),
                    'detail' => $data['description'] ?? ($data['preview'] ?? null),
                    'actor_name' => $row->actor_name,
                    'actor_user_id' => $row->actor_user_id ? (int) $row->actor_user_id : null,
                    'direction' => $isIncoming ? 'inbound' : 'outbound',
                    'partner_tenant_id' => $partnerTid ?: null,
                    'partner_tenant_name' => $tenantNames[$partnerTid]['name'] ?? null,
                    'partner_tenant_slug' => $tenantNames[$partnerTid]['slug'] ?? null,
                    'timestamp' => $row->created_at,
                    'data' => $data,
                ];
            })->values()->all();

            $nextCursor = $hasMore && !empty($formatted)
                ? $formatted[count($formatted) - 1]['timestamp']
                : null;

            return $this->respondWithData([
                'items' => $formatted,
                'total' => $total,
                'has_more' => $hasMore,
                'next_cursor' => $nextCursor,
            ]);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::error('[AdminFederation] activityFeed error: ' . $e->getMessage());
            return $this->respondWithData(['items' => [], 'total' => 0, 'has_more' => false]);
        }
    }

    public function apiKeys(): JsonResponse
    {
        $this->requireSuperAdmin();
        $tenantId = TenantContext::getId();
        if (!$this->tableExists('federation_api_keys')) { return $this->respondWithData([]); }

        try {
            $partnerCol = \Illuminate\Support\Facades\Schema::hasColumn('federation_api_keys', 'external_partner_id')
                ? ', external_partner_id'
                : '';
            $keyRows = DB::select("SELECT id, name, key_prefix, status, permissions, last_used_at, expires_at, created_at{$partnerCol} FROM federation_api_keys WHERE tenant_id = ? ORDER BY created_at DESC", [$tenantId]);
            $keys = array_map(function($k) { $arr = (array)$k; $arr['scopes'] = !empty($arr['permissions']) ? (json_decode($arr['permissions'], true) ?: []) : []; unset($arr['permissions']); return $arr; }, $keyRows);
            return $this->respondWithData($keys);
        } catch (\Exception $e) { return $this->respondWithData([]); }
    }

    public function createApiKey(): JsonResponse
    {
        $this->requireSuperAdmin();
        $tenantId = TenantContext::getId();
        $name = $this->input('name');
        $scopes = $this->input('scopes', []);
        if (!$name) { return $this->respondWithError('VALIDATION_ERROR', __('api_controllers_1.admin_federation.api_key_name_required'), 'name'); }
        if (!$this->tableExists('federation_api_keys')) { return $this->respondWithError('TABLE_MISSING', __('api_controllers_1.admin_federation.api_keys_table_not_configured'), null, 503); }

        // Scope allow-list + privilege gate. Validate against the known federation
        // scope vocabulary, and require a PLATFORM super-admin to issue value-bearing
        // scopes — a tenant admin must not be able to self-mint a key that can move
        // credits (transactions:write) or act as admin across the federation surface.
        $validScopes = ['members:read', 'members:write', 'transactions:read', 'transactions:write', 'ingest:write', 'admin'];
        $privilegedScopes = ['members:write', 'transactions:write', 'ingest:write', 'admin'];
        $scopes = is_array($scopes) ? array_values(array_unique(array_map('strval', $scopes))) : [];
        $invalidScopes = array_diff($scopes, $validScopes);
        if (!empty($invalidScopes)) {
            return $this->respondWithError('INVALID_SCOPE', __('api_controllers_1.admin_federation.api_key_invalid_scope', ['scopes' => implode(', ', $invalidScopes)]), 'scopes', 422);
        }
        if (array_intersect($scopes, $privilegedScopes) && !$this->isPlatformSuperAdmin()) {
            return $this->respondWithError('FORBIDDEN_SCOPE', __('api_controllers_1.admin_federation.api_key_privileged_scope_forbidden'), 'scopes', 403);
        }

        $expiresAt = $this->input('expires_at');

        // Optional binding to a federation_external_partners row: the native
        // ingest endpoints resolve the acting partner (and its allow_* flags)
        // from this server-side link — never from a client header (audit M3).
        // Must reference a partner in THIS tenant.
        $externalPartnerId = (int) $this->input('external_partner_id', 0);
        if ($externalPartnerId > 0) {
            $partnerExists = DB::table('federation_external_partners')
                ->where('id', $externalPartnerId)
                ->where('tenant_id', $tenantId)
                ->exists();
            if (!$partnerExists) {
                return $this->respondWithError('NOT_FOUND', __('api.federation.partner_not_found'), 'external_partner_id', 404);
            }
        }

        try {
            $keyValue = bin2hex(random_bytes(32));
            $prefix = substr($keyValue, 0, 8);
            DB::insert(
                "INSERT INTO federation_api_keys (tenant_id, name, key_hash, key_prefix, permissions, status, expires_at, external_partner_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, NOW())",
                [$tenantId, $name, hash('sha256', $keyValue), $prefix, json_encode($scopes), $expiresAt ?: null, $externalPartnerId > 0 ? $externalPartnerId : null, $this->getUserId()]
            );
            \Illuminate\Support\Facades\Log::info('[Federation] API key created', ['tenant_id' => $tenantId, 'key_prefix' => $prefix, 'external_partner_id' => $externalPartnerId ?: null, 'created_by' => $this->getUserId()]);
            return $this->respondWithData(['id' => DB::getPdo()->lastInsertId(), 'name' => $name, 'api_key' => $keyValue, 'key_prefix' => $prefix, 'external_partner_id' => $externalPartnerId ?: null, 'warning' => __('api_controllers_1.admin_federation.api_key_shown_once_warning')], null, 201);
        } catch (\Exception $e) { return $this->respondWithError('CREATE_FAILED', __('api_controllers_1.admin_federation.api_key_create_failed')); }
    }

    /** POST /api/v2/admin/federation/api-keys/{id}/revoke */
    public function revokeApiKey($id): JsonResponse
    {
        $this->requireSuperAdmin();
        $tenantId = TenantContext::getId();
        $id = (int) $id;

        if (!$this->tableExists('federation_api_keys')) {
            return $this->respondWithError('TABLE_MISSING', __('api_controllers_1.admin_federation.api_keys_table_not_configured'), null, 503);
        }

        try {
            $key = DB::selectOne("SELECT id, status FROM federation_api_keys WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
            if (!$key) {
                return $this->respondWithError('NOT_FOUND', __('api_controllers_1.admin_federation.api_key_not_found'), null, 404);
            }
            if ($key->status === 'revoked') {
                return $this->respondWithError('ALREADY_REVOKED', __('api_controllers_1.admin_federation.api_key_already_revoked'), null, 409);
            }

            DB::update("UPDATE federation_api_keys SET status = 'revoked', updated_at = NOW() WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
            \Illuminate\Support\Facades\Log::info('[Federation] API key revoked', ['tenant_id' => $tenantId, 'key_id' => $id, 'revoked_by' => $this->getUserId()]);
            return $this->respondWithData(['id' => $id, 'status' => 'revoked']);
        } catch (\Exception $e) {
            return $this->respondWithError('REVOKE_FAILED', __('api_controllers_1.admin_federation.api_key_revoke_failed'));
        }
    }

    public function dataManagement(): JsonResponse
    {
        $this->requireSuperAdmin();
        return $this->respondWithData([
            'export_formats' => ['json', 'csv'],
            'available_exports' => ['users' => 'Member directory', 'partnerships' => 'Partnership records', 'transactions' => 'Cross-community transactions', 'audit' => 'Audit log'],
            'import_supported' => true, 'last_export_at' => null, 'last_import_at' => null,
        ]);
    }

    /** GET /api/v2/admin/federation/export/{type} */
    public function exportData($type)
    {
        $this->requireSuperAdmin();
        $tenantId = TenantContext::getId();
        $type = (string) $type;

        $allowedTypes = ['users', 'partnerships', 'transactions', 'audit'];
        if (!in_array($type, $allowedTypes, true)) {
            return $this->respondWithError('INVALID_TYPE', __('api_controllers_1.admin_federation.invalid_export_type', ['types' => implode(', ', $allowedTypes)]), null, 400);
        }

        try {
            $rows = [];
            $headers = [];

            switch ($type) {
                case 'users':
                    if (!$this->tableExists('federation_user_settings')) {
                        return $this->respondWithError('NO_DATA', __('api_controllers_1.admin_federation.federation_user_settings_not_found'), null, 404);
                    }
                    $rows = array_map(fn($r) => (array)$r, DB::select("
                        SELECT u.id, u.first_name, u.last_name, u.email, u.username,
                               fus.federation_optin, fus.profile_visible_federated, fus.service_reach,
                               fus.created_at, fus.updated_at
                        FROM federation_user_settings fus
                        JOIN users u ON u.id = fus.user_id
                        WHERE u.tenant_id = ? AND fus.federation_optin = 1
                        ORDER BY u.first_name, u.last_name
                    ", [$tenantId]));
                    $headers = ['ID', 'First Name', 'Last Name', 'Email', 'Username', 'Opted In', 'Privacy Level', 'Service Reach', 'Created', 'Updated'];
                    break;

                case 'partnerships':
                    if (!$this->tableExists('federation_partnerships')) {
                        return $this->respondWithError('NO_DATA', __('api_controllers_1.admin_federation.federation_partnerships_not_found'), null, 404);
                    }
                    $rows = array_map(fn($r) => (array)$r, DB::select("
                        SELECT fp.id, t1.name AS tenant_name, t2.name AS partner_name,
                               fp.status, fp.federation_level, fp.created_at, fp.updated_at
                        FROM federation_partnerships fp
                        LEFT JOIN tenants t1 ON t1.id = fp.tenant_id
                        LEFT JOIN tenants t2 ON t2.id = fp.partner_tenant_id
                        WHERE fp.tenant_id = ? OR fp.partner_tenant_id = ?
                        ORDER BY fp.created_at DESC
                    ", [$tenantId, $tenantId]));
                    $headers = ['ID', 'Tenant', 'Partner', 'Status', 'Level', 'Created', 'Updated'];
                    break;

                case 'transactions':
                    if (!$this->tableExists('transactions') && !$this->tableExists('federation_transactions')) {
                        return $this->respondWithError('NO_DATA', __('api_controllers_1.admin_federation.federation_transactions_not_found'), null, 404);
                    }
                    $rows = [];
                    if ($this->tableExists('transactions')) {
                        $rows = array_merge($rows, array_map(fn($r) => (array)$r, DB::select("
                            SELECT tx.id, tx.sender_id AS sender_user_id, tx.receiver_id AS receiver_user_id,
                                   tx.amount, tx.description, tx.status,
                                   tx.created_at, tx.updated_at AS completed_at,
                                   'transactions' AS ledger_source
                            FROM transactions tx
                            WHERE tx.is_federated = 1
                              AND (tx.sender_tenant_id = ? OR tx.receiver_tenant_id = ?)
                            ORDER BY tx.created_at DESC
                            LIMIT 5000
                        ", [$tenantId, $tenantId])));
                    }
                    if ($this->tableExists('federation_transactions')) {
                        $rows = array_merge($rows, array_map(fn($r) => (array)$r, DB::select("
                            SELECT ft.id, ft.sender_user_id, ft.receiver_user_id,
                                   ft.amount, ft.description, ft.status,
                                   ft.created_at, ft.completed_at,
                                   'federation_transactions' AS ledger_source
                            FROM federation_transactions ft
                            WHERE ft.sender_tenant_id = ? OR ft.receiver_tenant_id = ?
                            ORDER BY ft.created_at DESC
                            LIMIT 5000
                        ", [$tenantId, $tenantId])));
                    }
                    usort($rows, static fn(array $a, array $b): int => strcmp((string) ($b['created_at'] ?? ''), (string) ($a['created_at'] ?? '')));
                    $headers = ['ID', 'Sender ID', 'Receiver ID', 'Amount', 'Description', 'Status', 'Created', 'Completed', 'Ledger Source'];
                    break;

                case 'audit':
                    if (!$this->tableExists('federation_audit_log')) {
                        return $this->respondWithError('NO_DATA', __('api_controllers_1.admin_federation.federation_audit_log_not_found'), null, 404);
                    }
                    $rows = array_map(fn($r) => (array)$r, DB::select("
                        SELECT id, action_type, category, level, actor_user_id,
                               source_tenant_id, target_tenant_id, data, created_at
                        FROM federation_audit_log
                        WHERE source_tenant_id = ? OR target_tenant_id = ?
                        ORDER BY created_at DESC LIMIT 5000
                    ", [$tenantId, $tenantId]));
                    $headers = ['ID', 'Action', 'Category', 'Level', 'Actor ID', 'Source Tenant', 'Target Tenant', 'Details', 'Created'];
                    break;
            }

            $filename = "federation_{$type}_" . date('Y-m-d_His') . '.csv';

            return new \Symfony\Component\HttpFoundation\StreamedResponse(function () use ($headers, $rows) {
                $output = fopen('php://output', 'w');
                fwrite($output, "\xEF\xBB\xBF"); // BOM for Excel UTF-8 compatibility
                fputcsv($output, $headers);
                foreach ($rows as $row) {
                    fputcsv($output, array_values($row));
                }
                fclose($output);
            }, 200, [
                'Content-Type' => 'text/csv; charset=utf-8',
                'Content-Disposition' => "attachment; filename=\"{$filename}\"",
                'Cache-Control' => 'no-cache, no-store, must-revalidate',
            ]);

        } catch (\Throwable $e) {
            return $this->respondWithError('EXPORT_FAILED', __('api_controllers_1.admin_federation.export_failed'), null, 500);
        }
    }
}
