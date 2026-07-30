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
use App\Services\LegalDocumentService;

/**
 * AdminEnterpriseController -- Enterprise: roles, GDPR, monitoring, health, logs, secrets, legal docs.
 *
 * Converted from legacy delegation to direct DB/service calls.
 */
class AdminEnterpriseController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly LegalDocumentService $legalDocumentService,
    ) {}

    private const PERMISSIONS = [
        'users' => ['users.view','users.create','users.edit','users.delete','users.suspend','users.ban','users.impersonate'],
        'listings' => ['listings.view','listings.create','listings.edit','listings.delete','listings.approve'],
        'content' => ['content.blog.manage','content.pages.manage','content.categories.manage','content.menus.manage'],
        'wallet' => ['wallet.view','wallet.transfer','wallet.adjust','wallet.org_wallets'],
        'events' => ['events.view','events.create','events.edit','events.delete'],
        'groups' => ['groups.view','groups.create','groups.edit','groups.delete','groups.moderate'],
        'messages' => ['messages.view','messages.moderate'],
        'gamification' => ['gamification.manage','gamification.award_badges','gamification.campaigns'],
        'matching' => ['matching.config','matching.approvals','matching.analytics'],
        'caring' => ['caring.view','caring.configure','caring.workflow.review','caring.workflow.assign','caring.reports.view','caring.reports.export'],
        'volunteering' => ['volunteering.hours.review','volunteering.organisations.manage','volunteering.opportunities.manage'],
        'safeguarding' => ['safeguarding.view'],
        'federation' => ['federation.nodes.view','federation.manage','federation.partnerships','federation.api_keys'],
        'gdpr' => ['gdpr.requests','gdpr.consents','gdpr.breaches','gdpr.audit'],
        'system' => ['system.config','system.monitoring','system.logs','system.secrets','system.cache','system.cron'],
        'admin' => ['admin.roles.manage','admin.legal_docs.manage','admin.newsletters.manage','admin.tenant_features'],
    ];

    /** GET /api/v2/admin/enterprise/dashboard */
    public function dashboard(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        try { $userCount = (int)(DB::selectOne("SELECT COUNT(*) as cnt FROM users WHERE tenant_id = ?", [$tenantId])->cnt ?? 0); } catch (\Exception $e) { \Illuminate\Support\Facades\Log::warning('[AdminEnterprise] User count query failed: ' . $e->getMessage()); $userCount = 0; }

        $roleCount = 0;
        try { $roleCount = (int)(DB::selectOne("SELECT COUNT(*) as cnt FROM roles WHERE tenant_id = ?", [$tenantId])->cnt ?? 0); } catch (\Exception $e) { \Illuminate\Support\Facades\Log::warning('[AdminEnterprise] Role count query failed: ' . $e->getMessage()); }

        $pendingGdpr = 0;
        try { $pendingGdpr = (int)(DB::selectOne("SELECT COUNT(*) as cnt FROM gdpr_requests WHERE tenant_id = ? AND status = 'pending'", [$tenantId])->cnt ?? 0); } catch (\Exception $e) { \Illuminate\Support\Facades\Log::warning('[AdminEnterprise] GDPR pending count query failed: ' . $e->getMessage()); }

        $dbConnected = true;
        try { DB::select("SELECT 1"); } catch (\Exception $e) { $dbConnected = false; }

        $redisConnected = false;
        try { $stats = app(\App\Services\RedisCache::class)->getStats(); $redisConnected = !empty($stats['enabled']); } catch (\Throwable $e) { \Illuminate\Support\Facades\Log::warning('AdminEnterpriseController: ' . $e->getMessage(), ['context' => __METHOD__]); }

        $healthStatus = ($dbConnected && $redisConnected) ? 'healthy' : ($dbConnected ? 'degraded' : 'unhealthy');

        $memPercent = 0;
        try {
            $memUsage = memory_get_usage(true);
            $memLimitStr = ini_get('memory_limit');
            $memLimit = (int)$memLimitStr;
            if (stripos($memLimitStr, 'G') !== false) $memLimit *= 1024 * 1024 * 1024;
            elseif (stripos($memLimitStr, 'M') !== false) $memLimit *= 1024 * 1024;
            elseif (stripos($memLimitStr, 'K') !== false) $memLimit *= 1024;
            if ($memLimit > 0) $memPercent = round(($memUsage / $memLimit) * 100, 1);
        } catch (\Exception $e) { \Illuminate\Support\Facades\Log::warning('AdminEnterpriseController: ' . $e->getMessage(), ['context' => __METHOD__]); }

        $diskPercent = 0;
        try {
            $diskFree = disk_free_space('/');
            $diskTotal = disk_total_space('/');
            if ($diskTotal > 0 && $diskFree !== false) $diskPercent = round((1 - $diskFree / $diskTotal) * 100, 1);
        } catch (\Exception $e) { \Illuminate\Support\Facades\Log::warning('AdminEnterpriseController: ' . $e->getMessage(), ['context' => __METHOD__]); }

        $recentActivity = [];
        try {
            $recentActivity = array_map(fn($r) => (array)$r, DB::select(
                "SELECT gal.id, gal.action, gal.entity_type, gal.created_at, u.name as user_name FROM gdpr_audit_log gal LEFT JOIN users u ON u.id = gal.admin_id WHERE gal.tenant_id = ? ORDER BY gal.created_at DESC LIMIT 5",
                [$tenantId]
            ));
        } catch (\Exception $e) { \Illuminate\Support\Facades\Log::warning('AdminEnterpriseController: ' . $e->getMessage(), ['context' => __METHOD__]); }

        return $this->respondWithData([
            'user_count' => $userCount, 'role_count' => $roleCount,
            'pending_gdpr_requests' => $pendingGdpr, 'health_status' => $healthStatus,
            'db_connected' => $dbConnected, 'redis_connected' => $redisConnected,
            'memory_percent' => $memPercent, 'disk_percent' => $diskPercent,
            'recent_gdpr_activity' => $recentActivity,
        ]);
    }

    /** GET /api/v2/admin/enterprise/roles */
    public function roles(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        try {
            $roles = array_map(fn($r) => (array)$r, DB::select(
                "SELECT r.id, r.name, r.display_name, r.description, r.is_system, r.level, r.created_at, r.updated_at,
                        (SELECT COUNT(*) FROM user_roles ur WHERE ur.role_id = r.id) as users_count,
                        GROUP_CONCAT(p.name) as permission_names
                 FROM roles r LEFT JOIN role_permissions rp ON r.id = rp.role_id LEFT JOIN permissions p ON rp.permission_id = p.id
                 WHERE r.tenant_id = ? GROUP BY r.id ORDER BY r.name ASC",
                [$tenantId]
            ));

            foreach ($roles as &$role) {
                $role['permissions'] = $role['permission_names'] ? explode(',', $role['permission_names']) : [];
                unset($role['permission_names']);
            }
            unset($role);

            return $this->respondWithData($roles);
        } catch (\Exception $e) {
            return $this->respondWithData([]);
        }
    }

    /** GET /api/v2/admin/enterprise/roles/{id} */
    public function showRole(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        try {
            $result = DB::selectOne(
                "SELECT r.*, (SELECT COUNT(*) FROM user_roles ur WHERE ur.role_id = r.id) as users_count FROM roles r WHERE r.id = ? AND r.tenant_id = ?",
                [$id, $tenantId]
            );

            if (!$result) { return $this->respondWithError('NOT_FOUND', __('api.role_not_found'), null, 404); }
            $role = (array)$result;
            $role['permissions'] = json_decode($role['permissions'] ?? '[]', true) ?: [];
            return $this->respondWithData($role);
        } catch (\Exception $e) {
            return $this->respondWithError('NOT_FOUND', __('api.role_not_found_or_unavailable'), null, 404);
        }
    }

    /** POST /api/v2/admin/enterprise/roles */
    public function createRole(): JsonResponse
    {
        $this->requireAdmin();
        $data = $this->getAllInput();
        $tenantId = TenantContext::getId();

        if (empty($data['name'])) { return $this->respondWithError('VALIDATION_ERROR', __('api.role_name_required'), 'name', 422); }

        $name = trim($data['name']);
        $displayName = $data['display_name'] ?? $name;
        $description = $data['description'] ?? null;
        $level = (int)($data['level'] ?? 10);
        $permissions = $data['permissions'] ?? [];

        try {
            DB::beginTransaction();
            DB::insert("INSERT INTO roles (name, display_name, description, level, tenant_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())", [$name, $displayName, $description, $level, $tenantId]);
            $roleId = DB::getPdo()->lastInsertId();

            if (!empty($permissions)) {
                foreach ($permissions as $permName) {
                    $perm = DB::selectOne("SELECT id FROM permissions WHERE name = ? LIMIT 1", [$permName]);
                    if (!empty($perm)) {
                        DB::insert("INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [$roleId, $perm->id]);
                    }
                }
            }
            DB::commit();

            $result = DB::selectOne(
                "SELECT r.*, GROUP_CONCAT(p.name) as permission_names FROM roles r LEFT JOIN role_permissions rp ON r.id = rp.role_id LEFT JOIN permissions p ON rp.permission_id = p.id WHERE r.id = ? AND r.tenant_id = ? GROUP BY r.id",
                [$roleId, $tenantId]
            );
            $resultArr = $result ? (array)$result : [];
            $resultArr['permissions'] = !empty($resultArr['permission_names']) ? explode(',', $resultArr['permission_names']) : [];
            unset($resultArr['permission_names']);

            return $this->respondWithData($resultArr, null, 201);
        } catch (\Exception $e) {
            DB::rollBack();
            return $this->respondWithError('CREATE_FAILED', __('api.role_create_failed'), null, 500);
        }
    }

    /** PUT /api/v2/admin/enterprise/roles/{id} */
    public function updateRole(int $id): JsonResponse
    {
        $this->requireAdmin();
        $data = $this->getAllInput();
        $tenantId = TenantContext::getId();

        try {
            DB::beginTransaction();
            $setParts = []; $params = [];
            if (isset($data['name'])) { $setParts[] = 'name = ?'; $params[] = $data['name']; }
            if (isset($data['display_name'])) { $setParts[] = 'display_name = ?'; $params[] = $data['display_name']; }
            if (isset($data['description'])) { $setParts[] = 'description = ?'; $params[] = $data['description']; }
            if (isset($data['level'])) { $setParts[] = 'level = ?'; $params[] = (int)$data['level']; }

            if (!empty($setParts)) {
                $setParts[] = 'updated_at = NOW()'; $params[] = $id; $params[] = $tenantId;
                DB::update("UPDATE roles SET " . implode(', ', $setParts) . " WHERE id = ? AND tenant_id = ?", $params);
            }

            if (isset($data['permissions']) && is_array($data['permissions'])) {
                $roleCheck = DB::selectOne("SELECT id FROM roles WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
                if (!$roleCheck) { DB::rollBack(); return $this->respondWithError('NOT_FOUND', __('api.role_not_found_in_tenant'), null, 404); }
                DB::delete("DELETE FROM role_permissions WHERE role_id = ? AND tenant_id = ?", [$id, $tenantId]);
                foreach ($data['permissions'] as $permName) {
                    $perm = DB::selectOne("SELECT id FROM permissions WHERE name = ? LIMIT 1", [$permName]);
                    if (!empty($perm)) {
                        DB::insert("INSERT INTO role_permissions (role_id, permission_id, tenant_id) VALUES (?, ?, ?)", [$id, $perm->id, $tenantId]);
                    }
                }
            }
            DB::commit();

            $result = DB::selectOne(
                "SELECT r.*, GROUP_CONCAT(p.name) as permission_names FROM roles r LEFT JOIN role_permissions rp ON r.id = rp.role_id LEFT JOIN permissions p ON rp.permission_id = p.id WHERE r.id = ? AND r.tenant_id = ? GROUP BY r.id",
                [$id, $tenantId]
            );

            if (empty($result)) { return $this->respondWithError('NOT_FOUND', __('api.role_not_found'), null, 404); }
            $resultArr = (array)$result;
            $resultArr['permissions'] = !empty($resultArr['permission_names']) ? explode(',', $resultArr['permission_names']) : [];
            unset($resultArr['permission_names']);
            return $this->respondWithData($resultArr);
        } catch (\Exception $e) {
            DB::rollBack();
            return $this->respondWithError('UPDATE_FAILED', __('api.role_update_failed'), null, 500);
        }
    }

    /** DELETE /api/v2/admin/enterprise/roles/{id} */
    public function deleteRole(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();
        try {
            DB::delete("DELETE FROM roles WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
            return $this->respondWithData(['deleted' => true]);
        } catch (\Exception $e) {
            return $this->respondWithError('DELETE_FAILED', __('api.role_delete_failed'), null, 500);
        }
    }

    /** GET /api/v2/admin/enterprise/permissions */
    public function permissions(): JsonResponse
    {
        $this->requireAdmin();
        return $this->respondWithData(self::PERMISSIONS);
    }

    /** GET /api/v2/admin/enterprise/gdpr */
    public function gdprDashboard(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $pending = 0; $total = 0;
        try { $row = DB::selectOne("SELECT COUNT(*) as total, SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending FROM gdpr_requests WHERE tenant_id = ?", [$tenantId]); $pending = (int)($row->pending ?? 0); $total = (int)($row->total ?? 0); } catch (\Exception $e) { \Illuminate\Support\Facades\Log::warning('[AdminEnterprise] GDPR dashboard query failed: ' . $e->getMessage()); }

        $consents = 0;
        try { $consents = (int)(DB::selectOne("SELECT COUNT(*) as cnt FROM user_consents WHERE tenant_id = ?", [$tenantId])->cnt ?? 0); } catch (\Exception $e) { \Illuminate\Support\Facades\Log::warning('[AdminEnterprise] Consents count query failed: ' . $e->getMessage()); }

        $breaches = 0;
        try { $breaches = (int)(DB::selectOne("SELECT COUNT(*) as cnt FROM data_breach_log WHERE tenant_id = ?", [$tenantId])->cnt ?? 0); } catch (\Exception $e) { \Illuminate\Support\Facades\Log::warning('[AdminEnterprise] Breaches count query failed: ' . $e->getMessage()); }

        return $this->respondWithData(['total_requests' => $total, 'pending_requests' => $pending, 'total_consents' => $consents, 'total_breaches' => $breaches]);
    }

    /** GET /api/v2/admin/enterprise/gdpr/requests */
    public function gdprRequests(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $page = $this->queryInt('page', 1, 1);
        $perPage = $this->queryInt('per_page', 20, 1, 100);
        $status = $this->query('status');
        $offset = ($page - 1) * $perPage;

        try {
            $where = "gr.tenant_id = ?"; $params = [$tenantId];
            if ($status && $status !== 'all') { $where .= " AND gr.status = ?"; $params[] = $status; }

            $total = (int)(DB::selectOne("SELECT COUNT(*) as cnt FROM gdpr_requests gr WHERE $where", $params)->cnt ?? 0);
            $fetchParams = array_merge($params, [$perPage, $offset]);
            $requests = array_map(fn($r) => (array)$r, DB::select(
                "SELECT gr.*, gr.request_type as type, u.name as user_name, u.email as user_email FROM gdpr_requests gr LEFT JOIN users u ON u.id = gr.user_id WHERE $where ORDER BY gr.created_at DESC LIMIT ? OFFSET ?",
                $fetchParams
            ));
            return $this->respondWithPaginatedCollection($requests, $total, $page, $perPage);
        } catch (\Exception $e) {
            return $this->respondWithPaginatedCollection([], 0, 1, $perPage);
        }
    }

    /** PUT /api/v2/admin/enterprise/gdpr/requests/{id} */
    public function updateGdprRequest(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $status = $this->input('status'); $notes = $this->input('notes');
        if (empty($status)) { return $this->respondWithError('VALIDATION_ERROR', __('api.status_required'), 'status', 422); }

        try {
            $updates = ["status = ?", "updated_at = NOW()"]; $params = [$status];
            if ($notes !== null) { $updates[] = "notes = ?"; $params[] = $notes; }
            if ($status === 'completed') { $updates[] = "processed_at = NOW()"; $updates[] = "processed_by = ?"; $params[] = $this->getUserId(); }
            $params[] = $id; $params[] = $tenantId;
            DB::update("UPDATE gdpr_requests SET " . implode(', ', $updates) . " WHERE id = ? AND tenant_id = ?", $params);
            return $this->respondWithData(['id' => $id, 'status' => $status, 'updated' => true]);
        } catch (\Exception $e) {
            return $this->respondWithError('UPDATE_FAILED', __('api.gdpr_request_update_failed'), null, 500);
        }
    }

    /** GET /api/v2/admin/enterprise/gdpr/consents */
    public function gdprConsents(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $page = max(1, (int) request()->query('page', 1));
        $perPage = min(100, max(1, (int) request()->query('per_page', 25)));
        $offset = ($page - 1) * $perPage;

        try {
            $total = (int) (DB::selectOne("SELECT COUNT(*) as cnt FROM user_consents WHERE tenant_id = ?", [$tenantId])->cnt ?? 0);
            $consents = array_map(fn($r) => (array)$r, DB::select("SELECT uc.*, uc.consent_given as consented, uc.given_at as consented_at, u.name as user_name,
                        (SELECT ct.name FROM consent_types ct
                         WHERE ct.slug = uc.consent_type LIMIT 1) as consent_type_name
                 FROM user_consents uc
                 LEFT JOIN users u ON u.id = uc.user_id
                 WHERE uc.tenant_id = ?
                 ORDER BY uc.created_at DESC LIMIT ? OFFSET ?", [$tenantId, $perPage, $offset]));
            return $this->respondWithData($consents, ['total' => $total, 'page' => $page, 'per_page' => $perPage]);
        } catch (\Exception $e) { return $this->respondWithData([], ['total' => 0, 'page' => $page, 'per_page' => $perPage]); }
    }

    /** GET /api/v2/admin/enterprise/gdpr/breaches */
    public function gdprBreaches(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $page = max(1, (int) request()->query('page', 1));
        $perPage = min(100, max(1, (int) request()->query('per_page', 25)));
        $offset = ($page - 1) * $perPage;

        try {
            $total = (int) (DB::selectOne("SELECT COUNT(*) as cnt FROM data_breach_log WHERE tenant_id = ?", [$tenantId])->cnt ?? 0);
            $breaches = array_map(fn($r) => (array)$r, DB::select("SELECT *, breach_type as title, detected_at as reported_at FROM data_breach_log WHERE tenant_id = ? ORDER BY detected_at DESC LIMIT ? OFFSET ?", [$tenantId, $perPage, $offset]));
            return $this->respondWithData($breaches, ['total' => $total, 'page' => $page, 'per_page' => $perPage]);
        } catch (\Exception $e) { return $this->respondWithData([], ['total' => 0, 'page' => $page, 'per_page' => $perPage]); }
    }

    /** POST /api/v2/admin/enterprise/gdpr/breaches */
    public function createBreach(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $input = $this->getAllInput();
        $breachType = trim($input['breach_type'] ?? $input['title'] ?? '');
        if (!$breachType) { return $this->respondWithError('VALIDATION_ERROR', __('api.breach_type_required'), 'breach_type', 422); }

        try {
            DB::insert(
                "INSERT INTO data_breach_log (tenant_id, breach_type, description, severity, status, detected_at, created_by, created_at) VALUES (?, ?, ?, ?, 'open', NOW(), ?, NOW())",
                [$tenantId, $breachType, $input['description'] ?? '', $input['severity'] ?? 'medium', $this->getUserId()]
            );
            return $this->respondWithData(['id' => DB::getPdo()->lastInsertId(), 'message' => __('api_controllers_1.admin_enterprise.breach_reported')], null, 201);
        } catch (\Exception $e) {
            return $this->respondWithError('CREATE_FAILED', __('api.breach_report_failed'), null, 500);
        }
    }

    /** GET /api/v2/admin/enterprise/gdpr/audit */
    public function gdprAudit(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $page = max(1, (int) request()->query('page', 1));
        $perPage = min(100, max(1, (int) request()->query('per_page', 25)));
        $offset = ($page - 1) * $perPage;

        // Build dynamic WHERE clause for filters
        $where = "gal.tenant_id = ?";
        $params = [$tenantId];

        $action = request()->query('action');
        if ($action && $action !== 'all') {
            $where .= " AND gal.action = ?";
            $params[] = $action;
        }

        $entityType = request()->query('entity_type');
        if ($entityType && $entityType !== 'all') {
            $where .= " AND gal.entity_type = ?";
            $params[] = $entityType;
        }

        $dateFrom = request()->query('date_from');
        if ($dateFrom && preg_match('/^\d{4}-\d{2}-\d{2}$/', $dateFrom)) {
            $where .= " AND gal.created_at >= ?";
            $params[] = $dateFrom . ' 00:00:00';
        }

        $dateTo = request()->query('date_to');
        if ($dateTo && preg_match('/^\d{4}-\d{2}-\d{2}$/', $dateTo)) {
            $where .= " AND gal.created_at <= ?";
            $params[] = $dateTo . ' 23:59:59';
        }

        $userId = request()->query('user_id');
        if ($userId && is_numeric($userId)) {
            $where .= " AND gal.admin_id = ?";
            $params[] = (int) $userId;
        }

        try {
            $total = (int) (DB::selectOne("SELECT COUNT(*) as cnt FROM gdpr_audit_log gal WHERE $where", $params)->cnt ?? 0);
            $fetchParams = array_merge($params, [$perPage, $offset]);
            $entries = array_map(fn($r) => (array)$r, DB::select(
                "SELECT gal.id, gal.tenant_id, gal.admin_id, gal.action, gal.entity_type, gal.entity_id, gal.old_value, gal.new_value, gal.ip_address, gal.created_at, u.name as user_name FROM gdpr_audit_log gal LEFT JOIN users u ON u.id = gal.admin_id WHERE $where ORDER BY gal.created_at DESC LIMIT ? OFFSET ?",
                $fetchParams
            ));
            return $this->respondWithPaginatedCollection($entries, $total, $page, $perPage);
        } catch (\Exception $e) { return $this->respondWithPaginatedCollection([], 0, 1, $perPage); }
    }

    /** GET /api/v2/admin/enterprise/gdpr/audit/export */
    public function gdprAuditExport(): \Symfony\Component\HttpFoundation\StreamedResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        // Build dynamic WHERE clause for filters (same as gdprAudit)
        $where = "gal.tenant_id = ?";
        $params = [$tenantId];

        $action = request()->query('action');
        if ($action && $action !== 'all') {
            $where .= " AND gal.action = ?";
            $params[] = $action;
        }

        $entityType = request()->query('entity_type');
        if ($entityType && $entityType !== 'all') {
            $where .= " AND gal.entity_type = ?";
            $params[] = $entityType;
        }

        $dateFrom = request()->query('date_from');
        if ($dateFrom && preg_match('/^\d{4}-\d{2}-\d{2}$/', $dateFrom)) {
            $where .= " AND gal.created_at >= ?";
            $params[] = $dateFrom . ' 00:00:00';
        }

        $dateTo = request()->query('date_to');
        if ($dateTo && preg_match('/^\d{4}-\d{2}-\d{2}$/', $dateTo)) {
            $where .= " AND gal.created_at <= ?";
            $params[] = $dateTo . ' 23:59:59';
        }

        $userId = request()->query('user_id');
        if ($userId && is_numeric($userId)) {
            $where .= " AND gal.admin_id = ?";
            $params[] = (int) $userId;
        }

        return response()->streamDownload(function () use ($where, $params) {
            $handle = fopen('php://output', 'w');
            fputcsv($handle, ['ID', 'Admin', 'Action', 'Entity Type', 'Entity ID', 'Old Value', 'New Value', 'IP Address', 'Date']);

            try {
                $rows = DB::select(
                    "SELECT gal.id, gal.action, gal.entity_type, gal.entity_id, gal.old_value, gal.new_value, gal.ip_address, gal.created_at, u.name as user_name
                     FROM gdpr_audit_log gal
                     LEFT JOIN users u ON u.id = gal.admin_id
                     WHERE $where
                     ORDER BY gal.created_at DESC",
                    $params
                );

                foreach ($rows as $row) {
                    fputcsv($handle, [
                        $row->id,
                        $row->user_name ?? '',
                        $row->action ?? '',
                        $row->entity_type ?? '',
                        $row->entity_id ?? '',
                        $row->old_value ?? '',
                        $row->new_value ?? '',
                        $row->ip_address ?? '',
                        $row->created_at ?? '',
                    ]);
                }
            } catch (\Exception $e) {
                \Illuminate\Support\Facades\Log::warning('AdminEnterpriseController: GDPR audit export query failed: ' . $e->getMessage());
                fputcsv($handle, ['Error exporting data', '', '', '', '', '', '', '', '']);
            }

            fclose($handle);
        }, 'gdpr-audit-log.csv', ['Content-Type' => 'text/csv']);
    }

    /** GET /api/v2/admin/enterprise/monitoring */
    public function monitoring(): JsonResponse
    {
        $this->requireAdmin();
        $memUsage = memory_get_usage(true);

        // Real DB connectivity check (never hardcode true)
        $dbConnected = false;
        try { DB::select("SELECT 1"); $dbConnected = true; } catch (\Exception $e) { \Illuminate\Support\Facades\Log::warning('[AdminEnterprise] DB ping failed: ' . $e->getMessage()); }

        $dbSize = '0 MB';
        try { $dbName = getenv('DB_NAME') ?: 'nexus'; $row = DB::selectOne("SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) AS size_mb FROM information_schema.tables WHERE table_schema = ?", [$dbName]); $dbSize = ($row->size_mb ?? '0') . ' MB'; } catch (\Exception $e) { \Illuminate\Support\Facades\Log::warning('[AdminEnterprise] DB size query failed: ' . $e->getMessage()); }

        $uptime = 'N/A';
        try { $rows = DB::select("SHOW GLOBAL STATUS LIKE 'Uptime'"); $row = $rows[0] ?? null; if ($row) { $s = (int)($row->Value ?? 0); $uptime = floor($s/86400) . 'd ' . floor(($s%86400)/3600) . 'h'; } } catch (\Exception $e) { \Illuminate\Support\Facades\Log::warning('[AdminEnterprise] Uptime query failed: ' . $e->getMessage()); }

        $redisConnected = false; $redisMemory = 'N/A';
        try { $stats = app(\App\Services\RedisCache::class)->getStats(); $redisConnected = !empty($stats['enabled']); if ($redisConnected) { $redisMemory = $stats['memory_used'] ?? 'N/A'; } } catch (\Throwable $e) { \Illuminate\Support\Facades\Log::warning('AdminEnterpriseController: ' . $e->getMessage(), ['context' => __METHOD__]); }

        // System memory from /proc/meminfo (Linux containers)
        $sysMem = ['total' => 'N/A', 'available' => 'N/A', 'used' => 'N/A'];
        try {
            $meminfo = @file_get_contents('/proc/meminfo');
            if ($meminfo) {
                preg_match('/MemTotal:\s+(\d+)\s+kB/', $meminfo, $totalM);
                preg_match('/MemAvailable:\s+(\d+)\s+kB/', $meminfo, $availM);
                if (!empty($totalM[1]) && !empty($availM[1])) {
                    $totalKb  = (int) $totalM[1];
                    $availKb  = (int) $availM[1];
                    $usedKb   = $totalKb - $availKb;
                    $sysMem   = [
                        'total'     => $this->formatBytes($totalKb * 1024),
                        'available' => $this->formatBytes($availKb * 1024),
                        'used'      => $this->formatBytes($usedKb  * 1024),
                        'used_pct'  => $totalKb > 0 ? round(($usedKb / $totalKb) * 100, 1) : 0,
                    ];
                }
            }
        } catch (\Throwable $e) { /* non-fatal */ }

        return $this->respondWithData([
            'php_version' => PHP_VERSION,
            'memory_usage' => $this->formatBytes($memUsage),
            'memory_limit' => ini_get('memory_limit'),
            'db_connected' => $dbConnected,
            'db_size' => $dbSize,
            'redis_connected' => $redisConnected,
            'redis_memory' => $redisMemory,
            'uptime' => $uptime,
            'server_time' => date('Y-m-d H:i:s T'),
            'os' => PHP_OS,
            'sys_memory' => $sysMem,
        ]);
    }

    /** GET /api/v2/admin/enterprise/health */
    public function healthCheck(): JsonResponse
    {
        $this->requireAdmin();
        $dbOk = false; try { DB::select("SELECT 1"); $dbOk = true; } catch (\Exception $e) { \Illuminate\Support\Facades\Log::warning('AdminEnterpriseController: ' . $e->getMessage(), ['context' => __METHOD__]); }
        $redisOk = false; try { $stats = app(\App\Services\RedisCache::class)->getStats(); $redisOk = !empty($stats['enabled']); } catch (\Throwable $e) { \Illuminate\Support\Facades\Log::warning('AdminEnterpriseController: ' . $e->getMessage(), ['context' => __METHOD__]); }

        $diskOk = false; $diskFree = null; $diskTotal = null;
        try { $f = disk_free_space('/'); $t = disk_total_space('/'); if ($f !== false && $t !== false) { $diskOk = true; $diskFree = $this->formatBytes($f); $diskTotal = $this->formatBytes($t); } } catch (\Exception $e) { \Illuminate\Support\Facades\Log::warning('AdminEnterpriseController: ' . $e->getMessage(), ['context' => __METHOD__]); }

        $checks = [
            ['code' => 'database', 'status' => $dbOk ? 'ok' : 'fail'],
            ['code' => 'redis', 'status' => $redisOk ? 'ok' : 'fail'],
            ['code' => 'disk', 'status' => $diskOk ? 'ok' : 'fail', 'free' => $diskFree, 'total' => $diskTotal],
        ];

        foreach (['pdo_mysql','redis','zip','mbstring','gd','curl','json','openssl'] as $ext) {
            $checks[] = ['code' => 'php_extension', 'params' => ['extension' => $ext], 'status' => extension_loaded($ext) ? 'ok' : 'fail'];
        }
        $checks[] = ['code' => 'php_version_minimum', 'params' => ['version' => '8.2'], 'status' => version_compare(PHP_VERSION, '8.2.0', '>=') ? 'ok' : 'fail'];

        $hasFailures = !empty(array_filter($checks, fn($c) => $c['status'] === 'fail'));
        $overallStatus = $hasFailures ? 'unhealthy' : 'healthy';

        // Record in health_check_history
        try {
            DB::insert(
                "INSERT INTO health_check_history (tenant_id, status, checks, created_at) VALUES (?, ?, ?, NOW())",
                [$this->getTenantId(), $overallStatus, json_encode($checks)]
            );
        } catch (\Exception $e) {
            // Table may not exist yet — don't break the health check
            \Illuminate\Support\Facades\Log::warning('AdminEnterpriseController: health_check_history insert failed: ' . $e->getMessage());
        }

        return $this->respondWithData(['status' => $overallStatus, 'checks' => $checks]);
    }

    /** GET /api/v2/admin/enterprise/logs */
    public function logs(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $page = $this->queryInt('page', 1, 1);
        $perPage = $this->queryInt('per_page', 50, 1, 200);
        $offset = ($page - 1) * $perPage;

        try {
            $total = (int)(DB::selectOne("SELECT COUNT(*) as cnt FROM activity_log WHERE tenant_id = ? AND (action LIKE '%error%' OR action LIKE '%fail%' OR action LIKE '%exception%')", [$tenantId])->cnt ?? 0);
            $logs = array_map(fn($r) => (array)$r, DB::select("SELECT al.*, u.name as user_name FROM activity_log al LEFT JOIN users u ON u.id = al.user_id WHERE al.tenant_id = ? AND (al.action LIKE '%error%' OR al.action LIKE '%fail%' OR al.action LIKE '%exception%') ORDER BY al.created_at DESC LIMIT ? OFFSET ?", [$tenantId, $perPage, $offset]));
            return $this->respondWithPaginatedCollection($logs, $total, $page, $perPage);
        } catch (\Exception $e) {
            return $this->respondWithPaginatedCollection([], 0, 1, $perPage);
        }
    }

    /**
     * Settings source map: where each System Config setting actually lives.
     * 'column'  → direct column on the tenants table
     * 'setting' → key-value row in tenant_settings table
     * 'config'  → key in tenants.configuration JSON (default for unmapped keys)
     */
    private const CONFIG_DIRECT_COLUMNS = [
        'site_name' => 'name',
        'site_description' => 'description',
        'contact_email' => 'contact_email',
        'contact_phone' => 'contact_phone',
    ];

    private const CONFIG_TENANT_SETTINGS = [
        // General
        'timezone' => 'general.timezone',
        'registration_enabled' => 'general.registration_mode',
        'require_approval' => 'general.admin_approval',
        'require_email_verification' => 'general.email_verification',
        'maintenance_mode' => 'general.maintenance_mode',
        'welcome_message' => 'general.welcome_message',
        'starting_balance' => 'wallet.starting_balance',
        'footer_text' => 'general.footer_text',
        'locale' => 'general.default_locale',
        'onboarding_enabled' => 'onboarding.enabled',
        // Wallet
        'max_transaction' => 'wallet.max_transaction',
        'currency_name' => 'wallet.currency_name',
        'currency_symbol' => 'wallet.currency_symbol',
        // Content & Moderation
        'auto_approve_listings' => 'content.auto_approve_listings',
        'auto_approve_blog' => 'content.auto_approve_blog',
        'profanity_filter' => 'content.profanity_filter',
        'max_listing_images' => 'listing.max_images',
        // Notifications
        'email_notifications_enabled' => 'notifications.email_enabled',
        'push_notifications_enabled' => 'notifications.push_enabled',
        'digest_frequency' => 'notifications.digest_frequency',
        // Limits
        'max_listings_per_user' => 'listing.max_per_user',
        'max_groups_per_user' => 'limits.max_groups_per_user',
        'max_file_upload_mb' => 'general.max_upload_size_mb',
    ];

    /** Schema defaults — ensures every key is always present in the API response */
    private const CONFIG_DEFAULTS = [
        'site_name' => '',
        'site_description' => '',
        'contact_email' => '',
        'contact_phone' => '',
        'timezone' => 'UTC',
        'registration_enabled' => true,
        'require_approval' => false,
        'require_email_verification' => true,
        'maintenance_mode' => false,
        'welcome_message' => '',
        'starting_balance' => 0,
        'footer_text' => '',
        'locale' => 'en',
        'onboarding_enabled' => true,
        'max_transaction' => 0,
        'currency_name' => 'Hours',
        'currency_symbol' => 'h',
        'auto_approve_listings' => true,
        'auto_approve_blog' => false,
        'profanity_filter' => false,
        'max_listing_images' => 5,
        'email_notifications_enabled' => true,
        'push_notifications_enabled' => true,
        'digest_frequency' => 'monthly',
        'max_listings_per_user' => 0,
        'max_groups_per_user' => 0,
        'max_file_upload_mb' => 10,
    ];

    /** GET /api/v2/admin/enterprise/config */
    public function config(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();
        try {
            // Start with schema defaults so every key is always present
            $config = self::CONFIG_DEFAULTS;

            // 1. Read configuration JSON + direct columns from tenants table
            $directCols = array_unique(array_values(self::CONFIG_DIRECT_COLUMNS));
            $columns = implode(', ', array_merge(['configuration'], $directCols));
            $row = DB::selectOne("SELECT {$columns} FROM tenants WHERE id = ?", [$tenantId]);
            $jsonConfig = json_decode($row->configuration ?? '{}', true) ?: [];

            // Merge JSON config (non-schema keys only — schema keys come from proper sources)
            foreach ($jsonConfig as $k => $v) {
                if (!array_key_exists($k, self::CONFIG_DEFAULTS)) {
                    $config[$k] = $v;
                }
            }

            // 2. Merge direct columns (override defaults)
            foreach (self::CONFIG_DIRECT_COLUMNS as $configKey => $dbColumn) {
                $val = $row->$dbColumn ?? null;
                if ($val !== null && $val !== '') {
                    $config[$configKey] = $val;
                }
            }

            // 3. Read tenant_settings and merge (override defaults)
            try {
                $settingKeys = array_values(self::CONFIG_TENANT_SETTINGS);
                $placeholders = implode(',', array_fill(0, count($settingKeys), '?'));
                $settings = DB::select(
                    "SELECT setting_key, setting_value, setting_type FROM tenant_settings WHERE tenant_id = ? AND setting_key IN ({$placeholders})",
                    array_merge([$tenantId], $settingKeys)
                );

                $settingValues = [];
                foreach ($settings as $s) {
                    $settingValues[$s->setting_key] = $this->castSettingValue($s->setting_value, $s->setting_type);
                }

                foreach (self::CONFIG_TENANT_SETTINGS as $configKey => $settingKey) {
                    if (isset($settingValues[$settingKey])) {
                        $value = $settingValues[$settingKey];
                        // registration_mode is 'open'/'closed'/'invite_only' — convert to boolean
                        if ($configKey === 'registration_enabled') {
                            $config[$configKey] = ($value === 'open' || $value === true || $value === '1');
                        } else {
                            $config[$configKey] = $value;
                        }
                    }
                }
            } catch (\Exception $e) {
                \Illuminate\Support\Facades\Log::warning('[AdminEnterprise] tenant_settings read failed: ' . $e->getMessage());
            }

            return $this->respondWithData($config);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::error('[AdminEnterprise] config() failed: ' . $e->getMessage());
            return $this->respondWithError('CONFIG_LOAD_FAILED', __('api.config_load_failed'), null, 500);
        }
    }

    /** Cast a tenant_settings value based on its setting_type */
    private function castSettingValue(?string $value, ?string $type): mixed
    {
        if ($value === null) return null;
        return match ($type) {
            'boolean' => filter_var($value, FILTER_VALIDATE_BOOLEAN),
            'integer' => (int) $value,
            'float' => (float) $value,
            'json', 'array' => json_decode($value, true) ?? $value,
            // Some boolean settings are stored with setting_type='string' but value 'true'/'false'
            default => in_array($value, ['true', 'false'], true) ? ($value === 'true') : $value,
        };
    }

    /** PUT /api/v2/admin/enterprise/config */
    public function updateConfig(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $adminId = $this->getUserId();
        $newConfig = $this->getAllInput();
        if (empty($newConfig)) { return $this->respondWithError('VALIDATION_ERROR', __('api.no_configuration_data'), null, 422); }

        try {
            DB::beginTransaction();

            $jsonConfig = $newConfig;

            // 1. Extract and update direct tenant columns
            $directUpdates = [];
            foreach (self::CONFIG_DIRECT_COLUMNS as $configKey => $dbColumn) {
                if (array_key_exists($configKey, $jsonConfig)) {
                    $directUpdates[$dbColumn] = $jsonConfig[$configKey];
                    unset($jsonConfig[$configKey]);
                }
            }
            if (!empty($directUpdates)) {
                $setParts = [];
                $params = [];
                foreach ($directUpdates as $col => $val) {
                    $setParts[] = "{$col} = ?";
                    $params[] = $val;
                }
                $params[] = $tenantId;
                DB::update("UPDATE tenants SET " . implode(', ', $setParts) . " WHERE id = ?", $params);
            }

            // 2. Extract and update tenant_settings entries
            foreach (self::CONFIG_TENANT_SETTINGS as $configKey => $settingKey) {
                if (!array_key_exists($configKey, $jsonConfig)) continue;

                $value = $jsonConfig[$configKey];
                unset($jsonConfig[$configKey]);

                // Convert registration_enabled boolean back to registration_mode string
                if ($configKey === 'registration_enabled') {
                    $value = $value ? 'open' : 'closed';
                    $settingType = 'string';
                } elseif (is_bool($value)) {
                    $settingType = 'string';
                    $value = $value ? 'true' : 'false';
                } elseif (is_int($value) || is_float($value) || (is_string($value) && is_numeric($value) && !str_contains($value, '.'))) {
                    $settingType = 'integer';
                    $value = (string) (int) $value;
                } else {
                    $settingType = 'string';
                    $value = (string) $value;
                }

                DB::statement(
                    "INSERT INTO tenant_settings (tenant_id, setting_key, setting_value, setting_type, updated_by, updated_at)
                     VALUES (?, ?, ?, ?, ?, NOW())
                     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), setting_type = VALUES(setting_type), updated_by = VALUES(updated_by), updated_at = NOW()",
                    [$tenantId, $settingKey, $value, $settingType, $adminId]
                );
            }

            // 3. Remaining keys go into configuration JSON
            $row = DB::selectOne("SELECT configuration FROM tenants WHERE id = ?", [$tenantId]);
            $existing = json_decode($row->configuration ?? '{}', true) ?: [];
            $merged = array_merge($existing, $jsonConfig);
            DB::update("UPDATE tenants SET configuration = ? WHERE id = ?", [json_encode($merged), $tenantId]);

            DB::commit();

            // Invalidate cache (outside transaction — non-critical)
            try { app(\App\Services\RedisCache::class)->delete('tenant_bootstrap', $tenantId); } catch (\Throwable $e) { \Illuminate\Support\Facades\Log::warning('[AdminEnterprise] Cache invalidation failed: ' . $e->getMessage()); }
            try { app(\App\Services\TenantSettingsService::class)->clearCacheForTenant($tenantId); } catch (\Throwable $e) { \Illuminate\Support\Facades\Log::warning('[AdminEnterprise] Tenant settings cache invalidation failed: ' . $e->getMessage()); }

            // Return full merged view by re-reading
            return $this->config();
        } catch (\Exception $e) {
            DB::rollBack();
            \Illuminate\Support\Facades\Log::error('[AdminEnterprise] updateConfig failed: ' . $e->getMessage());
            return $this->respondWithError('UPDATE_FAILED', __('api.config_update_failed'), null, 500);
        }
    }

    /** POST /api/v2/admin/enterprise/config/reset */
    // Keys that require special handling — maintenance_mode needs file + DB layers (CLI only)
    private const SHARED_KEYS = [
        'maintenance_mode',  // CLI-only (scripts/maintenance.sh) — file + DB layers
    ];

    public function resetConfig(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $keys = $this->input('keys');

        try {
            if (!empty($keys) && is_array($keys)) {
                // Reset specific keys — from JSON blob and tenant_settings
                $row = DB::selectOne("SELECT configuration FROM tenants WHERE id = ?", [$tenantId]);
                $config = json_decode($row->configuration ?? '{}', true) ?: [];
                foreach ($keys as $key) {
                    unset($config[$key]);
                    // Skip shared keys to avoid cross-page conflicts
                    if (in_array($key, self::SHARED_KEYS, true)) continue;
                    if (isset(self::CONFIG_TENANT_SETTINGS[$key])) {
                        DB::delete("DELETE FROM tenant_settings WHERE tenant_id = ? AND setting_key = ?", [$tenantId, self::CONFIG_TENANT_SETTINGS[$key]]);
                    }
                }
                DB::update("UPDATE tenants SET configuration = ? WHERE id = ?", [json_encode($config), $tenantId]);
            } else {
                // Reset all — clear JSON blob and enterprise-only tenant_settings (skip shared keys)
                DB::update("UPDATE tenants SET configuration = '{}' WHERE id = ?", [$tenantId]);
                $resettableKeys = [];
                foreach (self::CONFIG_TENANT_SETTINGS as $configKey => $settingKey) {
                    if (!in_array($configKey, self::SHARED_KEYS, true)) {
                        $resettableKeys[] = $settingKey;
                    }
                }
                if (!empty($resettableKeys)) {
                    $placeholders = implode(',', array_fill(0, count($resettableKeys), '?'));
                    DB::delete(
                        "DELETE FROM tenant_settings WHERE tenant_id = ? AND setting_key IN ({$placeholders})",
                        array_merge([$tenantId], $resettableKeys)
                    );
                }
            }
            try { app(\App\Services\RedisCache::class)->delete('tenant_bootstrap', $tenantId); } catch (\Throwable $e) { \Illuminate\Support\Facades\Log::warning('AdminEnterpriseController: ' . $e->getMessage(), ['context' => __METHOD__]); }
            return $this->respondWithData(['reset' => true]);
        } catch (\Exception $e) {
            return $this->respondWithError('RESET_FAILED', __('api_controllers_1.admin_enterprise.config_reset_failed'), null, 500);
        }
    }

    /** GET /api/v2/admin/enterprise/secrets */
    public function secrets(): JsonResponse
    {
        $this->requirePlatformSuperAdmin();

        $categoryMap = [
            'DB_HOST' => 'database', 'DB_NAME' => 'database', 'DB_USER' => 'database', 'DB_PASS' => 'database',
            'PUSHER_APP_ID' => 'push', 'PUSHER_KEY' => 'push', 'PUSHER_SECRET' => 'push', 'PUSHER_CLUSTER' => 'push',
            'OPENAI_API_KEY' => 'ai',
            'GMAIL_CLIENT_ID' => 'email', 'GMAIL_CLIENT_SECRET' => 'email', 'GMAIL_REFRESH_TOKEN' => 'email',
            'JWT_SECRET' => 'auth',
            'REDIS_HOST' => 'cache', 'REDIS_PORT' => 'cache', 'REDIS_PASSWORD' => 'cache',
            'FCM_SERVER_KEY' => 'push', 'VAPID_PUBLIC_KEY' => 'push', 'VAPID_PRIVATE_KEY' => 'push',
        ];

        $secrets = [];
        foreach ($categoryMap as $key => $category) {
            $value = getenv($key);
            $isSet = $value !== false && $value !== '';
            $maskedValue = null;
            if ($isSet && strlen($value) > 4) {
                $maskedValue = substr($value, 0, 2) . '****' . substr($value, -2);
            } elseif ($isSet) {
                $maskedValue = '****';
            }
            $secrets[] = [
                'key' => $key,
                'is_set' => $isSet,
                'category' => $category,
                'masked_value' => $maskedValue,
            ];
        }
        return $this->respondWithData($secrets);
    }

    // ─── GDPR Request Detail & Management ─────────────────────────────

    /** GET /api/v2/admin/enterprise/gdpr/requests/{id} */
    public function showGdprRequest(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        try {
            $request = DB::selectOne(
                "SELECT gr.*, gr.request_type as type, u.name as user_name, u.email as user_email,
                        au.name as assigned_to_name
                 FROM gdpr_requests gr
                 LEFT JOIN users u ON u.id = gr.user_id
                 LEFT JOIN users au ON au.id = gr.assigned_to
                 WHERE gr.id = ? AND gr.tenant_id = ?",
                [$id, $tenantId]
            );

            if (!$request) {
                return $this->respondWithError('NOT_FOUND', __('api_controllers_1.admin_enterprise.gdpr_request_not_found'), null, 404);
            }

            $result = (array) $request;

            // Timeline from audit log
            try {
                $timeline = array_map(fn($r) => (array) $r, DB::select(
                    "SELECT gal.id, gal.action, gal.old_value, gal.new_value, gal.ip_address, gal.created_at,
                            u.name as admin_name
                     FROM gdpr_audit_log gal
                     LEFT JOIN users u ON u.id = gal.admin_id
                     WHERE gal.entity_type = 'gdpr_request' AND gal.entity_id = ? AND gal.tenant_id = ?
                     ORDER BY gal.created_at ASC",
                    [$id, $tenantId]
                ));
            } catch (\Exception $e) {
                \Illuminate\Support\Facades\Log::warning('AdminEnterpriseController: timeline fetch failed: ' . $e->getMessage());
                $timeline = [];
            }

            $result['timeline'] = $timeline;

            // SLA calculation (30 days from created_at)
            $createdAt = strtotime($result['created_at'] ?? 'now');
            $slaDeadline = date('Y-m-d H:i:s', $createdAt + (30 * 86400));
            $slaDaysRemaining = max(0, (int) ceil(($createdAt + (30 * 86400) - time()) / 86400));
            $result['sla_deadline'] = $slaDeadline;
            $result['sla_days_remaining'] = $slaDaysRemaining;

            return $this->respondWithData($result);
        } catch (\Exception $e) {
            return $this->respondWithError('FETCH_FAILED', __('api_controllers_1.admin_enterprise.gdpr_request_fetch_failed'), null, 500);
        }
    }

    /** POST /api/v2/admin/enterprise/gdpr/requests */
    public function createGdprRequest(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $input = $this->getAllInput();

        $userId = (int) ($input['user_id'] ?? 0);
        $type = trim($input['type'] ?? '');
        $priority = trim($input['priority'] ?? 'normal');
        $notes = $input['notes'] ?? null;

        if (!$userId) {
            return $this->respondWithError('VALIDATION_ERROR', __('api_controllers_1.admin_enterprise.user_id_required'), 'user_id', 422);
        }

        $validTypes = ['access', 'erasure', 'portability', 'rectification', 'restriction', 'objection'];
        if (!in_array($type, $validTypes, true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api_controllers_1.admin_enterprise.invalid_request_type', ['types' => implode(', ', $validTypes)]), 'type', 422);
        }

        try {
            DB::insert(
                "INSERT INTO gdpr_requests (tenant_id, user_id, request_type, priority, notes, status, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, 'pending', NOW(), NOW())",
                [$tenantId, $userId, $type, $priority, $notes]
            );
            $requestId = (int) DB::getPdo()->lastInsertId();

            // Log the action
            try {
                DB::insert(
                    "INSERT INTO gdpr_audit_log (tenant_id, admin_id, action, entity_type, entity_id, new_value, ip_address, created_at)
                     VALUES (?, ?, 'create_request', 'gdpr_request', ?, ?, ?, NOW())",
                    [$tenantId, $this->getUserId(), $requestId, json_encode(['type' => $type, 'user_id' => $userId]), request()->ip()]
                );
            } catch (\Exception $e) {
                // Audit log failure should not break the main operation
                \Illuminate\Support\Facades\Log::warning('AdminEnterpriseController: audit log insert failed: ' . $e->getMessage());
            }

            return $this->respondWithData(['id' => $requestId, 'message' => __('api_controllers_1.admin_enterprise.gdpr_request_created')], null, 201);
        } catch (\Exception $e) {
            return $this->respondWithError('CREATE_FAILED', __('api_controllers_1.admin_enterprise.gdpr_request_create_failed'), null, 500);
        }
    }

    /** PUT /api/v2/admin/enterprise/gdpr/requests/{id}/assign */
    public function assignGdprRequest(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $assignedTo = (int) ($this->input('assigned_to') ?? 0);

        if (!$assignedTo) {
            return $this->respondWithError('VALIDATION_ERROR', __('api_controllers_1.admin_enterprise.assigned_to_required'), 'assigned_to', 422);
        }

        try {
            $affected = DB::update(
                "UPDATE gdpr_requests SET assigned_to = ?, updated_at = NOW() WHERE id = ? AND tenant_id = ?",
                [$assignedTo, $id, $tenantId]
            );

            if ($affected === 0) {
                return $this->respondWithError('NOT_FOUND', __('api_controllers_1.admin_enterprise.gdpr_request_not_found'), null, 404);
            }

            try {
                DB::insert(
                    "INSERT INTO gdpr_audit_log (tenant_id, admin_id, action, entity_type, entity_id, new_value, ip_address, created_at)
                     VALUES (?, ?, 'assign_request', 'gdpr_request', ?, ?, ?, NOW())",
                    [$tenantId, $this->getUserId(), $id, json_encode(['assigned_to' => $assignedTo]), request()->ip()]
                );
            } catch (\Exception $e) { \Illuminate\Support\Facades\Log::warning('AdminEnterpriseController: ' . $e->getMessage(), ['context' => __METHOD__]); }

            return $this->respondWithData(['id' => $id, 'assigned_to' => $assignedTo, 'updated' => true]);
        } catch (\Exception $e) {
            return $this->respondWithError('UPDATE_FAILED', __('api_controllers_1.admin_enterprise.gdpr_request_assign_failed'), null, 500);
        }
    }

    /** POST /api/v2/admin/enterprise/gdpr/requests/{id}/notes */
    public function addGdprRequestNote(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $note = trim($this->input('note') ?? '');

        if ($note === '') {
            return $this->respondWithError('VALIDATION_ERROR', __('api_controllers_1.admin_enterprise.note_text_required'), 'note', 422);
        }

        try {
            $request = DB::selectOne("SELECT notes FROM gdpr_requests WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
            if (!$request) {
                return $this->respondWithError('NOT_FOUND', __('api_controllers_1.admin_enterprise.gdpr_request_not_found'), null, 404);
            }

            // Get admin name
            $adminName = 'Admin';
            try {
                $admin = DB::selectOne("SELECT name FROM users WHERE id = ?", [$this->getUserId()]);
                if ($admin) { $adminName = $admin->name; }
            } catch (\Exception $e) { \Illuminate\Support\Facades\Log::warning('AdminEnterpriseController: ' . $e->getMessage(), ['context' => __METHOD__]); }

            $timestamp = date('Y-m-d H:i:s');
            $existingNotes = $request->notes ?? '';
            $newNotes = $existingNotes
                ? $existingNotes . "\n[{$timestamp}] {$adminName}: {$note}"
                : "[{$timestamp}] {$adminName}: {$note}";

            DB::update(
                "UPDATE gdpr_requests SET notes = ?, updated_at = NOW() WHERE id = ? AND tenant_id = ?",
                [$newNotes, $id, $tenantId]
            );

            try {
                DB::insert(
                    "INSERT INTO gdpr_audit_log (tenant_id, admin_id, action, entity_type, entity_id, new_value, ip_address, created_at)
                     VALUES (?, ?, 'add_note', 'gdpr_request', ?, ?, ?, NOW())",
                    [$tenantId, $this->getUserId(), $id, json_encode(['note' => $note]), request()->ip()]
                );
            } catch (\Exception $e) { \Illuminate\Support\Facades\Log::warning('AdminEnterpriseController: ' . $e->getMessage(), ['context' => __METHOD__]); }

            return $this->respondWithData(['id' => $id, 'notes' => $newNotes, 'updated' => true]);
        } catch (\Exception $e) {
            return $this->respondWithError('UPDATE_FAILED', __('api_controllers_1.admin_enterprise.gdpr_request_note_failed'), null, 500);
        }
    }

    /** POST /api/v2/admin/enterprise/gdpr/requests/{id}/export */
    public function generateGdprExport(int $id): JsonResponse
    {
        $this->requireAdmin();
        // Exports can produce 100MB+ ZIPs. Cap to a handful of runs per hour
        // per admin so a loop (or compromised session) cannot fill storage.
        $this->rateLimit('gdpr_export', 5, 3600);
        $tenantId = $this->getTenantId();

        try {
            $request = DB::selectOne("SELECT * FROM gdpr_requests WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
            if (!$request) {
                return $this->respondWithError('NOT_FOUND', __('api_controllers_1.admin_enterprise.gdpr_request_not_found'), null, 404);
            }

            $gdprService = new \App\Services\Enterprise\GdprService($tenantId);
            $filePath = $gdprService->generateDataExport((int) $request->user_id, $id);

            $expiresAt = date('Y-m-d H:i:s', strtotime('+30 days'));
            DB::update(
                "UPDATE gdpr_requests SET export_file_path = ?, export_expires_at = ?, updated_at = NOW() WHERE id = ? AND tenant_id = ?",
                [$filePath, $expiresAt, $id, $tenantId]
            );

            try {
                DB::insert(
                    "INSERT INTO gdpr_audit_log (tenant_id, admin_id, action, entity_type, entity_id, new_value, ip_address, created_at)
                     VALUES (?, ?, 'generate_export', 'gdpr_request', ?, ?, ?, NOW())",
                    [$tenantId, $this->getUserId(), $id, json_encode(['file_path' => $filePath]), request()->ip()]
                );
            } catch (\Exception $e) { \Illuminate\Support\Facades\Log::warning('AdminEnterpriseController: ' . $e->getMessage(), ['context' => __METHOD__]); }

            return $this->respondWithData([
                'id' => $id,
                'export_file_path' => $filePath,
                'export_expires_at' => $expiresAt,
                'message' => __('api_controllers_1.admin_enterprise.data_export_generated'),
            ]);
        } catch (\Exception $e) {
            Log::error('GDPR export failed', ['id' => $id, 'error' => $e->getMessage()]);
            return $this->respondWithError('EXPORT_FAILED', __('api_controllers_1.admin_enterprise.data_export_failed'), null, 500);
        }
    }

    // ─── GDPR Consent Type Management ────────────────────────────────
    //
    // 🔴 `consent_types` is a PLATFORM-GLOBAL catalogue, not a tenant-scoped
    // table. It has no `tenant_id` column: `slug` is its unique key, and both
    // `tenant_consent_overrides.consent_type_slug` and
    // `consent_version_history.consent_type_slug` are foreign keys onto it.
    // Per-tenant customisation is the OVERRIDE table (version + text), which
    // GdprService::getEffectiveConsentVersion() COALESCEs over the global row.
    //
    // Because the catalogue is shared, every MUTATION here is a cross-tenant
    // write and is gated on requirePlatformSuperAdmin(). A tenant admin
    // deleting a row would cascade away every other tenant's overrides and
    // version history for that consent type. Reads stay open to tenant admins;
    // the consent counts are scoped to the caller's own tenant.

    /** GET /api/v2/admin/enterprise/gdpr/consent-types */
    public function consentTypes(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        try {
            $types = array_map(fn($r) => (array) $r, DB::select(
                "SELECT ct.*,
                        COALESCE((SELECT COUNT(*) FROM user_consents uc WHERE uc.consent_type = ct.slug AND uc.tenant_id = ? AND uc.consent_given = 1), 0) as granted_count,
                        COALESCE((SELECT COUNT(*) FROM user_consents uc WHERE uc.consent_type = ct.slug AND uc.tenant_id = ? AND uc.consent_given = 0), 0) as denied_count
                 FROM consent_types ct
                 ORDER BY ct.display_order ASC, ct.name ASC",
                [$tenantId, $tenantId]
            ));
            return $this->respondWithData($types);
        } catch (\Exception $e) {
            // Do NOT return [] here: an empty list is indistinguishable from
            // "no consent types configured", which is exactly how the phantom
            // ct.tenant_id filter kept this page blank without anyone noticing.
            Log::error('List consent types failed', ['error' => $e->getMessage()]);
            return $this->respondWithError('SERVER_INTERNAL_ERROR', __('api.server_error'), null, 500);
        }
    }

    /** POST /api/v2/admin/enterprise/gdpr/consent-types */
    public function createConsentType(): JsonResponse
    {
        $this->requirePlatformSuperAdmin();
        $input = $this->getAllInput();

        $slug = trim($input['slug'] ?? '');
        $name = trim($input['name'] ?? '');
        if (!$slug || !$name) {
            return $this->respondWithError('VALIDATION_ERROR', __('api_controllers_1.admin_enterprise.slug_and_name_required'), null, 422);
        }

        // current_text is NOT NULL with no default — omitting it fails the
        // insert just as surely as the phantom tenant_id column did.
        $currentText = trim((string) ($input['current_text'] ?? $input['description'] ?? $name));

        try {
            DB::insert(
                "INSERT INTO consent_types (slug, name, description, category, is_required, legal_basis, retention_days, display_order, is_active, current_version, current_text, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())",
                [
                    $slug, $name,
                    $input['description'] ?? null,
                    $input['category'] ?? 'general',
                    (int) ($input['is_required'] ?? 0),
                    $input['legal_basis'] ?? null,
                    isset($input['retention_days']) ? (int) $input['retention_days'] : null,
                    (int) ($input['display_order'] ?? 0),
                    (int) ($input['is_active'] ?? 1),
                    trim((string) ($input['current_version'] ?? '1.0')) ?: '1.0',
                    $currentText,
                ]
            );
            $newId = (int) DB::getPdo()->lastInsertId();

            $created = DB::selectOne("SELECT * FROM consent_types WHERE id = ?", [$newId]);
            return $this->respondWithData($created ? (array) $created : ['id' => $newId], null, 201);
        } catch (\Exception $e) {
            Log::error('Create consent type failed', ['error' => $e->getMessage()]);
            return $this->respondWithError('CREATE_FAILED', __('api_controllers_1.admin_enterprise.consent_type_create_failed'), null, 500);
        }
    }

    /** PUT /api/v2/admin/enterprise/gdpr/consent-types/{id} */
    public function updateConsentType(int $id): JsonResponse
    {
        $this->requirePlatformSuperAdmin();
        $input = $this->getAllInput();

        $allowedFields = ['slug', 'name', 'description', 'category', 'is_required', 'legal_basis', 'retention_days', 'display_order', 'is_active'];
        $setParts = [];
        $params = [];

        foreach ($allowedFields as $field) {
            if (isset($input[$field])) {
                $setParts[] = "{$field} = ?";
                $params[] = in_array($field, ['is_required', 'is_active', 'retention_days', 'display_order'])
                    ? (int) $input[$field]
                    : $input[$field];
            }
        }

        if (empty($setParts)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api_controllers_1.admin_enterprise.no_fields_to_update'), null, 422);
        }

        $setParts[] = 'updated_at = NOW()';
        $params[] = $id;

        try {
            $affected = DB::update("UPDATE consent_types SET " . implode(', ', $setParts) . " WHERE id = ?", $params);
            if ($affected === 0) {
                return $this->respondWithError('NOT_FOUND', __('api_controllers_1.admin_enterprise.consent_type_not_found'), null, 404);
            }
            $updated = DB::selectOne("SELECT * FROM consent_types WHERE id = ?", [$id]);
            return $this->respondWithData($updated ? (array) $updated : ['id' => $id, 'updated' => true]);
        } catch (\Exception $e) {
            Log::error('Update consent type failed', ['id' => $id, 'error' => $e->getMessage()]);
            return $this->respondWithError('UPDATE_FAILED', __('api_controllers_1.admin_enterprise.consent_type_update_failed'), null, 500);
        }
    }

    /** DELETE /api/v2/admin/enterprise/gdpr/consent-types/{id} */
    public function deleteConsentType(int $id): JsonResponse
    {
        $this->requirePlatformSuperAdmin();

        try {
            DB::delete("DELETE FROM consent_types WHERE id = ?", [$id]);
            return $this->respondWithData(['deleted' => true]);
        } catch (\Exception $e) {
            Log::error('Delete consent type failed', ['id' => $id, 'error' => $e->getMessage()]);
            return $this->respondWithError('DELETE_FAILED', __('api_controllers_1.admin_enterprise.consent_type_delete_failed'), null, 500);
        }
    }

    /** GET /api/v2/admin/enterprise/gdpr/consent-types/{slug}/users */
    public function consentTypeUsers(string $slug): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $page = $this->queryInt('page', 1, 1);
        $perPage = $this->queryInt('per_page', 20, 1, 100);
        $offset = ($page - 1) * $perPage;

        try {
            $total = (int) (DB::selectOne(
                "SELECT COUNT(*) as cnt FROM user_consents WHERE consent_type = ? AND tenant_id = ?",
                [$slug, $tenantId]
            )->cnt ?? 0);

            $users = array_map(fn($r) => (array) $r, DB::select(
                "SELECT uc.id, uc.user_id, uc.consent_type, uc.consent_given, uc.given_at, uc.ip_address,
                        u.name as user_name, u.email as user_email
                 FROM user_consents uc
                 LEFT JOIN users u ON u.id = uc.user_id
                 WHERE uc.consent_type = ? AND uc.tenant_id = ?
                 ORDER BY uc.given_at DESC
                 LIMIT ? OFFSET ?",
                [$slug, $tenantId, $perPage, $offset]
            ));

            return $this->respondWithPaginatedCollection($users, $total, $page, $perPage);
        } catch (\Exception $e) {
            return $this->respondWithPaginatedCollection([], 0, 1, $perPage);
        }
    }

    /** GET /api/v2/admin/enterprise/gdpr/consent-types/{slug}/export */
    public function exportConsentTypeUsers(string $slug): \Symfony\Component\HttpFoundation\StreamedResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        return response()->streamDownload(function () use ($slug, $tenantId) {
            $handle = fopen('php://output', 'w');
            fputcsv($handle, ['user_name', 'user_email', 'consent_given', 'given_at', 'ip_address']);

            try {
                $rows = DB::select(
                    "SELECT u.name as user_name, u.email as user_email, uc.consent_given, uc.given_at, uc.ip_address
                     FROM user_consents uc
                     LEFT JOIN users u ON u.id = uc.user_id
                     WHERE uc.consent_type = ? AND uc.tenant_id = ?
                     ORDER BY uc.given_at DESC",
                    [$slug, $tenantId]
                );

                foreach ($rows as $row) {
                    fputcsv($handle, [
                        $row->user_name ?? '',
                        $row->user_email ?? '',
                        $row->consent_given ? 'Yes' : 'No',
                        $row->given_at ?? '',
                        $row->ip_address ?? '',
                    ]);
                }
            } catch (\Exception $e) {
                // Write error row
                \Illuminate\Support\Facades\Log::warning('AdminEnterpriseController: consent export query failed: ' . $e->getMessage());
                fputcsv($handle, ['Error exporting data', '', '', '', '']);
            }

            fclose($handle);
        }, "consent-{$slug}-users.csv", ['Content-Type' => 'text/csv']);
    }

    // ─── GDPR Breach Detail ─────────────────────────────────────────

    /** GET /api/v2/admin/enterprise/gdpr/breaches/{id} */
    public function showBreach(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        try {
            $breach = DB::selectOne(
                "SELECT dbl.*, u.name as created_by_name
                 FROM data_breach_log dbl
                 LEFT JOIN users u ON u.id = dbl.created_by
                 WHERE dbl.id = ? AND dbl.tenant_id = ?",
                [$id, $tenantId]
            );

            if (!$breach) {
                return $this->respondWithError('NOT_FOUND', __('api_controllers_1.admin_enterprise.breach_record_not_found'), null, 404);
            }

            return $this->respondWithData((array) $breach);
        } catch (\Exception $e) {
            return $this->respondWithError('FETCH_FAILED', __('api_controllers_1.admin_enterprise.breach_record_fetch_failed'), null, 500);
        }
    }

    /** PUT /api/v2/admin/enterprise/gdpr/breaches/{id} */
    public function updateBreach(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $input = $this->getAllInput();

        $allowedFields = [
            'status', 'root_cause', 'remediation_actions', 'lessons_learned',
            'prevention_measures', 'contained_at', 'resolved_at',
        ];

        $setParts = [];
        $params = [];

        foreach ($allowedFields as $field) {
            if (isset($input[$field])) {
                $setParts[] = "{$field} = ?";
                $params[] = $input[$field];
            }
        }

        if (empty($setParts)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api_controllers_1.admin_enterprise.no_fields_to_update'), null, 422);
        }

        $setParts[] = 'updated_at = NOW()';
        $params[] = $id;
        $params[] = $tenantId;

        try {
            $affected = DB::update("UPDATE data_breach_log SET " . implode(', ', $setParts) . " WHERE id = ? AND tenant_id = ?", $params);
            if ($affected === 0) {
                return $this->respondWithError('NOT_FOUND', __('api_controllers_1.admin_enterprise.breach_record_not_found'), null, 404);
            }

            try {
                DB::insert(
                    "INSERT INTO gdpr_audit_log (tenant_id, admin_id, action, entity_type, entity_id, new_value, ip_address, created_at)
                     VALUES (?, ?, 'update_breach', 'data_breach', ?, ?, ?, NOW())",
                    [$tenantId, $this->getUserId(), $id, json_encode(array_intersect_key($input, array_flip($allowedFields))), request()->ip()]
                );
            } catch (\Exception $e) { \Illuminate\Support\Facades\Log::warning('AdminEnterpriseController: ' . $e->getMessage(), ['context' => __METHOD__]); }

            return $this->respondWithData(['id' => $id, 'updated' => true]);
        } catch (\Exception $e) {
            return $this->respondWithError('UPDATE_FAILED', __('api_controllers_1.admin_enterprise.breach_record_update_failed'), null, 500);
        }
    }

    /** POST /api/v2/admin/enterprise/gdpr/breaches/{id}/notify-dpa */
    public function notifyDpa(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        try {
            $affected = DB::update(
                "UPDATE data_breach_log SET dpa_notified_at = NOW(), reported_to_authority = 1, updated_at = NOW() WHERE id = ? AND tenant_id = ?",
                [$id, $tenantId]
            );

            if ($affected === 0) {
                return $this->respondWithError('NOT_FOUND', __('api_controllers_1.admin_enterprise.breach_record_not_found'), null, 404);
            }

            try {
                DB::insert(
                    "INSERT INTO gdpr_audit_log (tenant_id, admin_id, action, entity_type, entity_id, new_value, ip_address, created_at)
                     VALUES (?, ?, 'notify_dpa', 'data_breach', ?, ?, ?, NOW())",
                    [$tenantId, $this->getUserId(), $id, json_encode(['dpa_notified' => true]), request()->ip()]
                );
            } catch (\Exception $e) { \Illuminate\Support\Facades\Log::warning('AdminEnterpriseController: ' . $e->getMessage(), ['context' => __METHOD__]); }

            return $this->respondWithData(['id' => $id, 'dpa_notified' => true, 'message' => __('api_controllers_1.admin_enterprise.dpa_notification_recorded')]);
        } catch (\Exception $e) {
            return $this->respondWithError('UPDATE_FAILED', __('api_controllers_1.admin_enterprise.dpa_notification_failed'), null, 500);
        }
    }

    // ─── GDPR Statistics ─────────────────────────────────────────────

    /** GET /api/v2/admin/enterprise/gdpr/statistics */
    public function gdprStatistics(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        try {
            $gdprService = new \App\Services\Enterprise\GdprService($tenantId);
            $stats = $gdprService->getStatistics();
            return $this->respondWithData($stats);
        } catch (\Exception $e) {
            // Fall back to manual computation
            \Illuminate\Support\Facades\Log::warning('AdminEnterpriseController: GdprService::getStatistics failed, falling back to manual: ' . $e->getMessage());
        }

        try {
            // Request counts by status
            $statusCounts = [];
            $rows = DB::select(
                "SELECT status, COUNT(*) as cnt FROM gdpr_requests WHERE tenant_id = ? GROUP BY status",
                [$tenantId]
            );
            foreach ($rows as $row) {
                $statusCounts[$row->status] = (int) $row->cnt;
            }

            // Request counts by type
            $typeCounts = [];
            $rows = DB::select(
                "SELECT request_type, COUNT(*) as cnt FROM gdpr_requests WHERE tenant_id = ? GROUP BY request_type",
                [$tenantId]
            );
            foreach ($rows as $row) {
                $typeCounts[$row->request_type] = (int) $row->cnt;
            }

            // Average processing time
            $avgRow = DB::selectOne(
                "SELECT AVG(TIMESTAMPDIFF(HOUR, created_at, processed_at)) as avg_hours
                 FROM gdpr_requests WHERE tenant_id = ? AND status = 'completed' AND processed_at IS NOT NULL",
                [$tenantId]
            );
            $avgProcessingHours = round((float) ($avgRow->avg_hours ?? 0), 1);

            // Active breaches
            $activeBreaches = (int) (DB::selectOne(
                "SELECT COUNT(*) as cnt FROM data_breach_log WHERE tenant_id = ? AND status IN ('open', 'investigating')",
                [$tenantId]
            )->cnt ?? 0);

            $totalBreaches = (int) (DB::selectOne(
                "SELECT COUNT(*) as cnt FROM data_breach_log WHERE tenant_id = ?",
                [$tenantId]
            )->cnt ?? 0);

            // Overdue requests (pending/processing where created_at + 30 days < NOW())
            $overdueCount = (int) (DB::selectOne(
                "SELECT COUNT(*) as cnt FROM gdpr_requests
                 WHERE tenant_id = ? AND status IN ('pending', 'processing') AND DATE_ADD(created_at, INTERVAL 30 DAY) < NOW()",
                [$tenantId]
            )->cnt ?? 0);

            // Consent coverage
            $totalUsers = (int) (DB::selectOne("SELECT COUNT(*) as cnt FROM users WHERE tenant_id = ?", [$tenantId])->cnt ?? 0);
            $usersWithConsent = (int) (DB::selectOne(
                "SELECT COUNT(DISTINCT user_id) as cnt FROM user_consents WHERE tenant_id = ? AND consent_given = 1",
                [$tenantId]
            )->cnt ?? 0);
            $consentCoverage = $totalUsers > 0 ? round($usersWithConsent / $totalUsers, 4) : 0;

            // Compliance score
            $totalRequests = array_sum($statusCounts);
            $completedOnTime = 0;
            try {
                $completedOnTime = (int) (DB::selectOne(
                    "SELECT COUNT(*) as cnt FROM gdpr_requests
                     WHERE tenant_id = ? AND status = 'completed' AND processed_at IS NOT NULL
                     AND TIMESTAMPDIFF(DAY, created_at, processed_at) <= 30",
                    [$tenantId]
                )->cnt ?? 0);
            } catch (\Exception $e) { \Illuminate\Support\Facades\Log::warning('AdminEnterpriseController: ' . $e->getMessage(), ['context' => __METHOD__]); }

            $complianceScore = 0;
            if ($totalRequests > 0) {
                $complianceScore += ($completedOnTime / $totalRequests) * 40;
            } else {
                $complianceScore += 40; // No requests = perfect request compliance
            }
            $complianceScore += $consentCoverage * 30;
            $complianceScore += (1 - ($activeBreaches / max($totalBreaches, 1))) * 30;
            $complianceScore = (int) min(100, max(0, round($complianceScore)));

            return $this->respondWithData([
                'requests_by_status' => $statusCounts,
                'requests_by_type' => $typeCounts,
                'avg_processing_hours' => $avgProcessingHours,
                'active_breaches' => $activeBreaches,
                'total_breaches' => $totalBreaches,
                'overdue_requests' => $overdueCount,
                'total_users' => $totalUsers,
                'users_with_consent' => $usersWithConsent,
                'consent_coverage' => $consentCoverage,
                'compliance_score' => $complianceScore,
            ]);
        } catch (\Exception $e) {
            return $this->respondWithData([
                'requests_by_status' => [],
                'requests_by_type' => [],
                'avg_processing_hours' => 0,
                'active_breaches' => 0,
                'total_breaches' => 0,
                'overdue_requests' => 0,
                'total_users' => 0,
                'users_with_consent' => 0,
                'consent_coverage' => 0,
                'compliance_score' => 0,
            ]);
        }
    }

    // ─── GDPR Trends ──────────────────────────────────────────────────

    /** GET /api/v2/admin/enterprise/gdpr/trends */
    public function gdprTrends(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        try {
            $months = [];
            $requests = [];
            $breaches = [];

            // Get last 6 months of data
            for ($i = 5; $i >= 0; $i--) {
                $monthStart = date('Y-m-01', strtotime("-{$i} months"));
                $monthEnd = date('Y-m-t', strtotime("-{$i} months"));
                $monthLabel = date('M Y', strtotime("-{$i} months"));
                $months[] = $monthLabel;

                $reqCount = 0;
                try {
                    $reqCount = (int)(DB::selectOne(
                        "SELECT COUNT(*) as cnt FROM gdpr_requests WHERE tenant_id = ? AND created_at >= ? AND created_at <= ?",
                        [$tenantId, $monthStart, $monthEnd . ' 23:59:59']
                    )->cnt ?? 0);
                } catch (\Exception $e) { \Illuminate\Support\Facades\Log::warning('AdminEnterpriseController: ' . $e->getMessage(), ['context' => __METHOD__]); }
                $requests[] = $reqCount;

                $breachCount = 0;
                try {
                    $breachCount = (int)(DB::selectOne(
                        "SELECT COUNT(*) as cnt FROM data_breach_log WHERE tenant_id = ? AND created_at >= ? AND created_at <= ?",
                        [$tenantId, $monthStart, $monthEnd . ' 23:59:59']
                    )->cnt ?? 0);
                } catch (\Exception $e) { \Illuminate\Support\Facades\Log::warning('AdminEnterpriseController: ' . $e->getMessage(), ['context' => __METHOD__]); }
                $breaches[] = $breachCount;
            }

            // Previous period comparison (this month vs last month)
            $thisMonthStart = date('Y-m-01');
            $lastMonthStart = date('Y-m-01', strtotime('-1 month'));
            $lastMonthEnd = date('Y-m-t', strtotime('-1 month'));

            $thisMonthRequests = 0;
            $lastMonthRequests = 0;
            try {
                $thisMonthRequests = (int)(DB::selectOne("SELECT COUNT(*) as cnt FROM gdpr_requests WHERE tenant_id = ? AND created_at >= ?", [$tenantId, $thisMonthStart])->cnt ?? 0);
                $lastMonthRequests = (int)(DB::selectOne("SELECT COUNT(*) as cnt FROM gdpr_requests WHERE tenant_id = ? AND created_at >= ? AND created_at <= ?", [$tenantId, $lastMonthStart, $lastMonthEnd . ' 23:59:59'])->cnt ?? 0);
            } catch (\Exception $e) { \Illuminate\Support\Facades\Log::warning('AdminEnterpriseController: ' . $e->getMessage(), ['context' => __METHOD__]); }

            $thisMonthCompleted = 0;
            $lastMonthCompleted = 0;
            try {
                $thisMonthCompleted = (int)(DB::selectOne("SELECT COUNT(*) as cnt FROM gdpr_requests WHERE tenant_id = ? AND status = 'completed' AND processed_at >= ?", [$tenantId, $thisMonthStart])->cnt ?? 0);
                $lastMonthCompleted = (int)(DB::selectOne("SELECT COUNT(*) as cnt FROM gdpr_requests WHERE tenant_id = ? AND status = 'completed' AND processed_at >= ? AND processed_at <= ?", [$tenantId, $lastMonthStart, $lastMonthEnd . ' 23:59:59'])->cnt ?? 0);
            } catch (\Exception $e) { \Illuminate\Support\Facades\Log::warning('AdminEnterpriseController: ' . $e->getMessage(), ['context' => __METHOD__]); }

            return $this->respondWithData([
                'months' => $months,
                'requests' => $requests,
                'breaches' => $breaches,
                'comparison' => [
                    'this_month_requests' => $thisMonthRequests,
                    'last_month_requests' => $lastMonthRequests,
                    'this_month_completed' => $thisMonthCompleted,
                    'last_month_completed' => $lastMonthCompleted,
                ],
            ]);
        } catch (\Exception $e) {
            return $this->respondWithData([
                'months' => [], 'requests' => [], 'breaches' => [],
                'comparison' => ['this_month_requests' => 0, 'last_month_requests' => 0, 'this_month_completed' => 0, 'last_month_completed' => 0],
            ]);
        }
    }

    // ─── Monitoring — Log Files ──────────────────────────────────────

    /** GET /api/v2/admin/enterprise/monitoring/log-files */
    public function logFiles(): JsonResponse
    {
        $this->requirePlatformSuperAdmin();

        try {
            $logDir = storage_path('logs');
            $files = [];

            if (is_dir($logDir)) {
                foreach (scandir($logDir) as $file) {
                    if ($file === '.' || $file === '..') continue;
                    if (!str_ends_with($file, '.log')) continue;

                    $fullPath = $logDir . DIRECTORY_SEPARATOR . $file;
                    if (!is_file($fullPath)) continue;

                    $sizeBytes = filesize($fullPath);
                    $lineCount = 0;

                    // Count lines but cap file read at 10MB to avoid OOM
                    if ($sizeBytes > 0 && $sizeBytes <= 10 * 1024 * 1024) {
                        $content = file_get_contents($fullPath);
                        $lineCount = substr_count($content, "\n");
                        unset($content);
                    } elseif ($sizeBytes > 10 * 1024 * 1024) {
                        $content = file_get_contents($fullPath, false, null, 0, 10 * 1024 * 1024);
                        $lineCount = substr_count($content, "\n");
                        unset($content);
                    }

                    $files[] = [
                        'name' => $file,
                        'size' => $this->formatBytes($sizeBytes),
                        'size_bytes' => $sizeBytes,
                        'modified_at' => date('Y-m-d H:i:s', filemtime($fullPath)),
                        'line_count' => $lineCount,
                    ];
                }
            }

            // Sort by modified_at descending
            usort($files, fn($a, $b) => strcmp($b['modified_at'], $a['modified_at']));

            return $this->respondWithData($files);
        } catch (\Exception $e) {
            return $this->respondWithData([]);
        }
    }

    /** GET /api/v2/admin/enterprise/monitoring/log-files/{filename} */
    public function viewLogFile(string $filename): JsonResponse
    {
        $this->requirePlatformSuperAdmin();

        // Security: no path traversal
        if (str_contains($filename, '/') || str_contains($filename, '\\') || str_contains($filename, '..')) {
            return $this->respondWithError('VALIDATION_ERROR', __('api_controllers_1.admin_enterprise.invalid_log_filename'), 'filename', 400);
        }
        if (!str_ends_with($filename, '.log')) {
            return $this->respondWithError('VALIDATION_ERROR', __('api_controllers_1.admin_enterprise.log_file_only_allowed'), 'filename', 400);
        }

        $filePath = storage_path('logs') . DIRECTORY_SEPARATOR . $filename;
        if (!is_file($filePath)) {
            return $this->respondWithError('NOT_FOUND', __('api_controllers_1.admin_enterprise.log_file_not_found'), null, 404);
        }

        $maxLines = $this->queryInt('lines', 200, 1, 1000);
        $levelFilter = $this->query('level'); // ERROR, WARNING, INFO, DEBUG

        try {
            $allLines = file($filePath, FILE_IGNORE_NEW_LINES);
            $totalLines = count($allLines);

            // Take the last N lines (most recent)
            $lines = array_slice($allLines, -$maxLines);
            unset($allLines);

            // Apply level filter if provided
            $filtered = [];
            if ($levelFilter) {
                $levelFilter = strtoupper($levelFilter);
                foreach ($lines as $idx => $line) {
                    if (stripos($line, ".{$levelFilter}:") !== false || stripos($line, "[{$levelFilter}]") !== false) {
                        $filtered[] = ['line_number' => $totalLines - count($lines) + $idx + 1, 'text' => $line];
                    }
                }
            } else {
                foreach ($lines as $idx => $line) {
                    $filtered[] = ['line_number' => $totalLines - count($lines) + $idx + 1, 'text' => $line];
                }
            }

            return $this->respondWithData([
                'filename' => $filename,
                'content' => $filtered,
                'total_lines' => $totalLines,
                'filtered_count' => count($filtered),
            ]);
        } catch (\Exception $e) {
            return $this->respondWithError('READ_FAILED', __('api_controllers_1.admin_enterprise.log_file_read_failed'), null, 500);
        }
    }

    /** DELETE /api/v2/admin/enterprise/monitoring/log-files/{filename} */
    public function clearLogFile(string $filename): JsonResponse
    {
        $this->requirePlatformSuperAdmin();

        if (str_contains($filename, '/') || str_contains($filename, '\\') || str_contains($filename, '..')) {
            return $this->respondWithError('VALIDATION_ERROR', __('api_controllers_1.admin_enterprise.invalid_log_filename'), 'filename', 400);
        }
        if (!str_ends_with($filename, '.log')) {
            return $this->respondWithError('VALIDATION_ERROR', __('api_controllers_1.admin_enterprise.log_file_only_allowed'), 'filename', 400);
        }

        $filePath = storage_path('logs') . DIRECTORY_SEPARATOR . $filename;
        if (!is_file($filePath)) {
            return $this->respondWithError('NOT_FOUND', __('api_controllers_1.admin_enterprise.log_file_not_found'), null, 404);
        }

        try {
            file_put_contents($filePath, '');
            return $this->respondWithData(['filename' => $filename, 'cleared' => true, 'message' => __('api_controllers_1.admin_enterprise.log_file_cleared')]);
        } catch (\Exception $e) {
            return $this->respondWithError('CLEAR_FAILED', __('api_controllers_1.admin_enterprise.log_file_clear_failed'), null, 500);
        }
    }

    // ─── Monitoring — System Requirements ────────────────────────────

    /** GET /api/v2/admin/enterprise/monitoring/requirements */
    public function systemRequirements(): JsonResponse
    {
        $this->requireAdmin();

        // PHP version
        $php = [
            'version' => PHP_VERSION,
            'meets_minimum' => version_compare(PHP_VERSION, '8.2.0', '>='),
        ];

        // Extensions
        $requiredExtensions = ['pdo_mysql', 'redis', 'zip', 'mbstring', 'gd', 'curl', 'json', 'openssl', 'fileinfo', 'bcmath', 'ctype', 'dom', 'iconv', 'tokenizer', 'xml'];
        $extensions = [];
        foreach ($requiredExtensions as $ext) {
            $extensions[] = [
                'name' => $ext,
                'loaded' => extension_loaded($ext),
                'required' => true,
            ];
        }

        // Writable directories
        $dirs = [
            storage_path(),
            storage_path('logs'),
            storage_path('framework/cache'),
            storage_path('framework/sessions'),
        ];
        $writableDirs = [];
        foreach ($dirs as $dir) {
            $writableDirs[] = [
                'path' => $dir,
                'writable' => is_dir($dir) && is_writable($dir),
            ];
        }

        // Services
        $dbOk = false;
        try { DB::select("SELECT 1"); $dbOk = true; } catch (\Exception $e) { \Illuminate\Support\Facades\Log::warning('AdminEnterpriseController: ' . $e->getMessage(), ['context' => __METHOD__]); }

        $redisOk = false;
        try { $stats = app(\App\Services\RedisCache::class)->getStats(); $redisOk = !empty($stats['enabled']); } catch (\Throwable $e) { \Illuminate\Support\Facades\Log::warning('AdminEnterpriseController: ' . $e->getMessage(), ['context' => __METHOD__]); }

        $services = [
            ['name' => 'database', 'connected' => $dbOk],
            ['name' => 'redis', 'connected' => $redisOk],
        ];

        // INI settings
        $iniSettings = [
            'max_execution_time' => ini_get('max_execution_time'),
            'memory_limit' => ini_get('memory_limit'),
            'upload_max_filesize' => ini_get('upload_max_filesize'),
            'post_max_size' => ini_get('post_max_size'),
            'max_input_vars' => ini_get('max_input_vars'),
        ];

        return $this->respondWithData([
            'php' => $php,
            'extensions' => $extensions,
            'writable_directories' => $writableDirs,
            'services' => $services,
            'ini_settings' => $iniSettings,
        ]);
    }

    // ─── Monitoring — Health Check History ───────────────────────────

    /** GET /api/v2/admin/enterprise/monitoring/health-history */
    public function healthCheckHistory(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        try {
            $history = array_map(fn($r) => (array) $r, DB::select(
                "SELECT * FROM health_check_history WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 10",
                [$tenantId]
            ));
            return $this->respondWithData($history);
        } catch (\Exception $e) {
            // Table may not exist yet
            \Illuminate\Support\Facades\Log::warning('AdminEnterpriseController: health_check_history query failed: ' . $e->getMessage());
            return $this->respondWithData([]);
        }
    }

    // ─── Config — Feature Flags ──────────────────────────────────────

    /** GET /api/v2/admin/enterprise/config/features */
    public function featureFlags(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        try {
            $row = DB::selectOne("SELECT features, configuration FROM tenants WHERE id = ?", [$tenantId]);
            $features = json_decode($row->features ?? '{}', true) ?: [];
            $configuration = json_decode($row->configuration ?? '{}', true) ?: [];
            $modules = $configuration['modules'] ?? [];

            return $this->respondWithData([
                'features' => $features,
                'modules' => $modules,
            ]);
        } catch (\Exception $e) {
            return $this->respondWithData(['features' => [], 'modules' => []]);
        }
    }

    /** PATCH /api/v2/admin/enterprise/config/features */
    public function updateFeatureFlag(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $input = $this->getAllInput();

        $key = trim($input['key'] ?? '');
        $value = (bool) ($input['value'] ?? false);
        $type = trim($input['type'] ?? 'feature');

        if (!$key) {
            return $this->respondWithError('VALIDATION_ERROR', __('api_controllers_1.admin_enterprise.feature_key_required'), 'key', 422);
        }

        if (!in_array($type, ['feature', 'module'], true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api_controllers_1.admin_enterprise.feature_type_invalid'), 'type', 422);
        }

        try {
            $row = DB::selectOne("SELECT features, configuration FROM tenants WHERE id = ?", [$tenantId]);

            if ($type === 'feature') {
                $features = json_decode($row->features ?? '{}', true) ?: [];
                $features[$key] = $value;
                DB::update("UPDATE tenants SET features = ? WHERE id = ?", [json_encode($features), $tenantId]);
            } else {
                $configuration = json_decode($row->configuration ?? '{}', true) ?: [];
                $modules = $configuration['modules'] ?? [];
                $modules[$key] = $value;
                $configuration['modules'] = $modules;
                DB::update("UPDATE tenants SET configuration = ? WHERE id = ?", [json_encode($configuration), $tenantId]);
            }

            // Invalidate tenant bootstrap cache
            try {
                app(\App\Services\RedisCache::class)->delete('tenant_bootstrap', $tenantId);
            } catch (\Throwable $e) { \Illuminate\Support\Facades\Log::warning('AdminEnterpriseController: ' . $e->getMessage(), ['context' => __METHOD__]); }

            return $this->respondWithData(['key' => $key, 'value' => $value, 'type' => $type, 'updated' => true]);
        } catch (\Exception $e) {
            return $this->respondWithError('UPDATE_FAILED', __('api_controllers_1.admin_enterprise.feature_flag_update_failed'), null, 500);
        }
    }

    // ─── Config — Secrets Management Enhancement ─────────────────────

    /** POST /api/v2/admin/enterprise/config/secrets/{key}/rotate */
    public function rotateSecret(string $key): JsonResponse
    {
        $this->requireAdmin();

        return $this->respondWithData([
            'key' => $key,
            'manual_required' => true,
            'message' => __('api_controllers_1.admin_enterprise.secret_rotation_requires_ssh'),
        ]);
    }

    /** DELETE /api/v2/admin/enterprise/config/secrets/{key} */
    public function deleteSecret(string $key): JsonResponse
    {
        $this->requireAdmin();

        return $this->respondWithData([
            'key' => $key,
            'manual_required' => true,
            'message' => __('api_controllers_1.admin_enterprise.secret_deletion_requires_ssh'),
        ]);
    }

    /** POST /api/v2/admin/enterprise/config/secrets/test-vault */
    public function testVaultConnection(): JsonResponse
    {
        $this->requireAdmin();

        $checks = [
            'DB_HOST' => getenv('DB_HOST') !== false && getenv('DB_HOST') !== '',
            'REDIS_HOST' => getenv('REDIS_HOST') !== false && getenv('REDIS_HOST') !== '',
            'PUSHER_KEY' => getenv('PUSHER_KEY') !== false && getenv('PUSHER_KEY') !== '',
        ];

        $allSet = !in_array(false, $checks, true);

        return $this->respondWithData([
            'status' => $allSet ? 'connected' : 'partial',
            'checks' => $checks,
        ]);
    }

    // ─── Legal Documents ─────────────────────────────────────────────

    /** GET /api/v2/admin/legal-documents */
    public function legalDocs(): JsonResponse
    {
        $this->requireAdmin();
        try {
            $docs = $this->legalDocumentService->getAllForTenant(TenantContext::getId(), includeInactive: true);
            return $this->respondWithData($docs);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning('AdminEnterpriseController: legalDocs query failed: ' . $e->getMessage());
            return $this->respondWithData([]);
        }
    }

    private const LEGAL_DOC_TYPES = ['terms', 'privacy', 'cookies', 'accessibility', 'community_guidelines', 'acceptable_use'];
    private const LEGAL_ACCEPTANCE_MODES = ['registration', 'login', 'first_use', 'none'];

    /** POST /api/v2/admin/legal-documents */
    public function createLegalDoc(): JsonResponse
    {
        $this->requireAdmin();
        $data = $this->getAllInput();
        if (empty($data['title'])) { return $this->respondWithError('VALIDATION_ERROR', __('api.title_required'), 'title', 422); }

        $type = $data['type'] ?? $data['document_type'] ?? 'terms';
        if (!in_array($type, self::LEGAL_DOC_TYPES, true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_type'), 'type', 422);
        }
        $acceptanceFor = $data['acceptance_required_for'] ?? 'registration';
        if (!in_array($acceptanceFor, self::LEGAL_ACCEPTANCE_MODES, true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_type'), 'acceptance_required_for', 422);
        }

        try {
            $doc = $this->legalDocumentService->createDocument([
                'title' => $data['title'], 'document_type' => $type,
                'slug' => $data['slug'] ?? null, 'requires_acceptance' => $data['requires_acceptance'] ?? true,
                'acceptance_required_for' => $acceptanceFor,
                'notify_on_update' => $data['notify_on_update'] ?? false,
                'is_active' => $data['is_active'] ?? true, 'created_by' => $this->getUserId(),
            ]);
            return $this->respondWithData($doc, null, 201);
        } catch (\Illuminate\Database\QueryException $e) {
            // unique (tenant_id, document_type) — one document per type per tenant
            if (str_contains($e->getMessage(), 'unique_tenant_document') || (string) $e->getCode() === '23000') {
                return $this->respondWithError('VALIDATION_ERROR', __('api.legal_doc_type_exists'), 'type', 422);
            }
            return $this->respondWithError('CREATE_FAILED', __('api.legal_doc_create_failed'), null, 500);
        } catch (\Exception $e) {
            return $this->respondWithError('CREATE_FAILED', __('api.legal_doc_create_failed'), null, 500);
        }
    }

    /** GET /api/v2/admin/legal-documents/{id} */
    public function showLegalDoc($id): JsonResponse
    {
        $this->requireAdmin();
        $id = (int) $id;
        $tenantId = $this->getTenantId();
        try {
            $result = DB::selectOne("SELECT *, document_type as type FROM legal_documents WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
            if (!$result) { return $this->respondWithError('NOT_FOUND', __('api.legal_doc_not_found'), null, 404); }
            $doc = (array)$result;
            return $this->respondWithData($doc);
        } catch (\Exception $e) {
            return $this->respondWithError('NOT_FOUND', __('api.legal_doc_not_found'), null, 404);
        }
    }

    /** PUT /api/v2/admin/legal-documents/{id} */
    public function updateLegalDoc($id): JsonResponse
    {
        $this->requireAdmin();
        $data = $this->getAllInput();
        $id = (int) $id;
        $tenantId = $this->getTenantId();

        try {
            $existing = DB::selectOne(
                "SELECT document_type FROM legal_documents WHERE id = ? AND tenant_id = ?",
                [$id, $tenantId]
            );
            if (!$existing) { return $this->respondWithError('NOT_FOUND', __('api.document_not_found'), null, 404); }

            // Type is immutable after creation — unique (tenant_id, document_type) and every
            // published version + user acceptance is anchored to the type. Reject any change.
            $requestedType = $data['type'] ?? $data['document_type'] ?? null;
            if ($requestedType !== null && $requestedType !== $existing->document_type) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.legal_doc_type_locked'), 'type', 422);
            }
            if (isset($data['acceptance_required_for'])
                && !in_array($data['acceptance_required_for'], self::LEGAL_ACCEPTANCE_MODES, true)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_type'), 'acceptance_required_for', 422);
            }

            $updateData = [];
            if (isset($data['title'])) $updateData['title'] = $data['title'];
            if (isset($data['slug'])) $updateData['slug'] = $data['slug'];
            if (isset($data['is_active'])) $updateData['is_active'] = $data['is_active'];
            if (isset($data['requires_acceptance'])) $updateData['requires_acceptance'] = $data['requires_acceptance'];
            if (isset($data['acceptance_required_for'])) $updateData['acceptance_required_for'] = $data['acceptance_required_for'];
            if (isset($data['notify_on_update'])) $updateData['notify_on_update'] = $data['notify_on_update'];

            if (empty($updateData)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.no_valid_fields'), null, 422);
            }

            $doc = $this->legalDocumentService->updateDocument($id, $updateData);
            if (!$doc) { return $this->respondWithError('NOT_FOUND', __('api.document_not_found'), null, 404); }
            return $this->respondWithData($doc);
        } catch (\Exception $e) {
            return $this->respondWithError('UPDATE_FAILED', __('api.legal_doc_update_failed'), null, 500);
        }
    }

    /** DELETE /api/v2/admin/legal-documents/{id} */
    public function deleteLegalDoc($id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $id = (int) $id;
        try {
            DB::delete("DELETE FROM legal_documents WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
            return $this->respondWithData(['deleted' => true]);
        } catch (\Exception $e) {
            return $this->respondWithError('DELETE_FAILED', __('api.legal_doc_delete_failed'), null, 500);
        }
    }

    private function formatBytes(int|float $bytes, int $precision = 2): string
    {
        $units = ['B', 'KB', 'MB', 'GB', 'TB'];
        $bytes = max($bytes, 0);
        $pow = floor(($bytes ? log($bytes) : 0) / log(1024));
        $pow = min($pow, count($units) - 1);
        $bytes /= (1 << (10 * $pow));
        return round($bytes, $precision) . ' ' . $units[$pow];
    }
}
