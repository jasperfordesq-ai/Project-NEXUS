<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use App\Core\ApiErrorCodes;
use App\Core\Validator;
use App\Core\SuperPanelAccess;
use App\Models\Tenant;
use App\Models\User;
use App\Services\FederationAuditService;
use App\Services\FederationFeatureService;
use App\Services\FederationPartnershipService;
use App\Services\SuperAdminAuditService;
use App\Services\TenantBillingService;
use App\Services\TenantHierarchyService;
use App\Services\TenantVisibilityService;

/**
 * AdminSuperController -- Super-admin tenant and cross-tenant user management.
 *
 * This controller manages ~38 endpoints for the super admin panel including:
 * - Dashboard stats across all tenants
 * - Tenant CRUD (create, list, edit, delete, reactivate, toggle-hub, move, hierarchy)
 * - Cross-tenant user management (create, edit, super admin grant/revoke, move tenant)
 * - Bulk operations (move users, update tenants)
 * - Audit log
 * - Federation system controls (lockdown, whitelist, partnerships, tenant features)
 *
 * All methods are native Laravel — no legacy delegation remains.
 */
class AdminSuperController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly FederationAuditService $federationAuditService,
        private readonly FederationFeatureService $federationFeatureService,
        private readonly FederationPartnershipService $federationPartnershipService,
        private readonly SuperAdminAuditService $superAdminAuditService,
        private readonly TenantHierarchyService $tenantHierarchyService,
        private readonly TenantVisibilityService $tenantVisibilityService,
        private readonly \App\Services\TenantSettingsService $tenantSettingsService,
    ) {}

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Override requireSuperAdmin for stateless JWT API auth.
     *
     * Passes the JWT user ID directly to SuperPanelAccess::getAccess($userId),
     * completely bypassing $_SESSION dependency. This is critical because
     * session_start() can fail silently in containerized/Docker environments,
     * causing all super admin API calls to return 403.
     *
     * Also syncs to $_SESSION as a fallback for any code that still reads it.
     */
    protected function requireSuperAdmin(): int
    {
        $userId = parent::requireSuperAdmin();

        // Reset any stale cached access from earlier in this request
        SuperPanelAccess::reset();

        // Pass user ID directly — no session dependency
        $access = SuperPanelAccess::getAccess($userId);

        if (!$access['granted']) {
            throw new \Illuminate\Http\Exceptions\HttpResponseException(
                $this->respondWithError(ApiErrorCodes::SUPER_PANEL_ACCESS_DENIED, __('api.super_panel_access_denied', ['reason' => $access['reason'] ?? __('api.unknown_reason')]),
                    null,
                    403
                )
            );
        }

        // Best-effort session sync for any legacy code that reads session data
        try {
            $session = request()->session();
            $session->put('user_id', $userId);
            $session->put('tenant_id', $access['tenant_id']);
            $session->put('user_role', 'admin');
            $session->put('is_super_admin', 1);
            $session->put('is_tenant_super_admin', 1);
        } catch (\Throwable $e) {
            // Session sync is best-effort — API works without it
        }

        return $userId;
    }

    /**
     * Require god role (is_god flag in DB). Uses the authenticated user ID from JWT.
     */
    private function requireGod(int $userId): void
    {
        if (!User::isGod($userId)) {
            throw new \Illuminate\Http\Exceptions\HttpResponseException(
                $this->respondWithError(
                    ApiErrorCodes::AUTH_INSUFFICIENT_PERMISSIONS,
                    __('api.god_level_access_required'),
                    null,
                    403
                )
            );
        }
    }

    /** @param array{success:bool,moved:int,failed:array<string>} $moveResult */
    private function respondWithUserMoveFailure(array $moveResult): JsonResponse
    {
        if (self::moveRequiresPasskeyRecovery($moveResult)) {
            return $this->respondWithError(
                ApiErrorCodes::USER_MOVE_PASSKEY_RECOVERY_REQUIRED,
                __('api.super_move_user_passkey_recovery_required'),
                null,
                409
            );
        }

        return $this->respondWithError(
            ApiErrorCodes::SERVER_INTERNAL_ERROR,
            __('api.super_move_user_failed'),
            null,
            500
        );
    }

    /** @param array{failed?:array<string>} $moveResult */
    private static function moveRequiresPasskeyRecovery(array $moveResult): bool
    {
        return in_array('passkey_recovery_required', $moveResult['failed'] ?? [], true);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Dashboard
    // ─────────────────────────────────────────────────────────────────────────

    /** GET /api/v2/super-admin/dashboard */
    public function dashboard(): JsonResponse
    {
        $this->requireSuperAdmin();

        $stats = $this->tenantVisibilityService->getDashboardStats();

        return $this->respondWithData($stats);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Tenant Management
    // ─────────────────────────────────────────────────────────────────────────

    /** GET /api/v2/super-admin/tenants */
    public function tenantList(): JsonResponse
    {
        $this->requireSuperAdmin();

        $filters = array_filter([
            'search' => $this->query('search'),
            'is_active' => $this->query('is_active') !== null ? (int) $this->query('is_active') : null,
            'allows_subtenants' => $this->query('hub') !== null ? 1 : null,
        ], fn($v) => $v !== null);

        $tenants = $this->tenantVisibilityService->getTenantList($filters);

        return $this->respondWithData($tenants);
    }

    /** GET /api/v2/super-admin/tenants/hierarchy */
    public function tenantHierarchy(): JsonResponse
    {
        $this->requireSuperAdmin();

        $tree = $this->tenantVisibilityService->getHierarchyTree();

        return $this->respondWithData($tree);
    }

    /** GET /api/v2/super-admin/tenants/{id} */
    public function tenantShow(int $id): JsonResponse
    {
        $this->requireSuperAdmin();

        $tenant = $this->tenantVisibilityService->getTenant($id);
        if (!$tenant) {
            return $this->respondWithError(ApiErrorCodes::RESOURCE_NOT_FOUND, __('api.tenant_not_found'), null, 404);
        }

        $children = Tenant::getChildren($id);
        $admins = $this->tenantVisibilityService->getTenantAdmins($id);
        $breadcrumb = Tenant::getBreadcrumb($id);

        // Decode features JSON for the frontend
        $features = [];
        if (!empty($tenant['features'])) {
            $features = is_string($tenant['features'])
                ? (json_decode($tenant['features'], true) ?: [])
                : $tenant['features'];
        }
        unset($tenant['features']);

        // Decode configuration JSON for the frontend
        $configuration = [];
        if (!empty($tenant['configuration'])) {
            $configuration = is_string($tenant['configuration'])
                ? (json_decode($tenant['configuration'], true) ?: [])
                : $tenant['configuration'];
        }
        unset($tenant['configuration']);

        return $this->respondWithData(array_merge($tenant, [
            'features' => $features,
            'configuration' => $configuration,
            'children' => $children,
            'admins' => $admins,
            'breadcrumb' => $breadcrumb,
        ]));
    }

    /** POST /api/v2/super-admin/tenants */
    public function tenantCreate(): JsonResponse
    {
        $userId = $this->requireSuperAdmin();

        $input = $this->getAllInput();

        $parentId = (int) ($input['parent_id'] ?? 0);
        if (!$parentId) {
            // Default to Master tenant (ID 1) for god/master-level admins
            $access = SuperPanelAccess::getAccess();
            if ($access['level'] === 'master') {
                $parentId = 1;
            } else {
                // Regional admins must specify their own tenant as parent
                $parentId = $access['tenant_id'] ?? 0;
            }
            if (!$parentId) {
                return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.parent_id_required'), 'parent_id', 422);
            }
        }

        // Verify access to parent tenant regardless of source
        if (!SuperPanelAccess::canAccessTenant($parentId)) {
            return $this->respondWithError(ApiErrorCodes::SUPER_PANEL_ACCESS_DENIED, __('api.super_no_access_parent_tenant'), null, 403);
        }

        $name = trim($input['name'] ?? '');
        if (empty($name)) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.name_is_required'), 'name', 422);
        }

        // Validate slug format (alphanumeric + hyphens only, no leading/trailing hyphens)
        $slug = trim($input['slug'] ?? '');
        if ($slug !== '' && !preg_match('/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/', $slug)) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.slug_format_invalid'), 'slug', 422);
        }

        // Validate domain format if provided
        $domain = trim($input['domain'] ?? '');
        if ($domain !== '' && !preg_match('/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i', $domain)) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.domain_format_invalid'), 'domain', 422);
        }

        // Validate accessible (GOV.UK) frontend domain format if provided
        $accessibleDomain = trim($input['accessible_domain'] ?? '');
        if ($accessibleDomain !== '' && !preg_match('/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i', $accessibleDomain)) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.domain_format_invalid'), 'accessible_domain', 422);
        }

        // Validate contact email if provided
        $contactEmail = trim($input['contact_email'] ?? '');
        if ($contactEmail !== '' && !filter_var($contactEmail, FILTER_VALIDATE_EMAIL)) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.contact_email_invalid'), 'contact_email', 422);
        }

        // Validate contact phone if provided (international E.164 format)
        $contactPhone = trim($input['contact_phone'] ?? '');
        if ($contactPhone !== '' && !Validator::isPhone($contactPhone)) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.contact_phone_invalid'), 'contact_phone', 422);
        }

        // Validate latitude/longitude if provided
        $latitude = $input['latitude'] ?? '';
        $longitude = $input['longitude'] ?? '';
        if ($latitude !== '' && (float)$latitude !== 0.0 && ((float)$latitude < -90 || (float)$latitude > 90)) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.latitude_range'), 'latitude', 422);
        }
        if ($longitude !== '' && (float)$longitude !== 0.0 && ((float)$longitude < -180 || (float)$longitude > 180)) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.longitude_range'), 'longitude', 422);
        }

        $data = [
            'name' => $name,
            'slug' => $slug,
            'domain' => $domain,
            'accessible_domain' => $accessibleDomain,
            'tagline' => $input['tagline'] ?? '',
            'description' => $input['description'] ?? '',
            'allows_subtenants' => !empty($input['allows_subtenants']),
            'max_depth' => (int) ($input['max_depth'] ?? 2),
            'is_active' => isset($input['is_active']) ? (int) (bool) $input['is_active'] : 1,
            'features' => $input['features'] ?? null,
            'contact_email' => $contactEmail,
            'contact_phone' => $contactPhone,
            'address' => $input['address'] ?? '',
            // SEO fields
            'meta_title' => $input['meta_title'] ?? '',
            'meta_description' => $input['meta_description'] ?? '',
            'h1_headline' => $input['h1_headline'] ?? '',
            'hero_intro' => $input['hero_intro'] ?? '',
            'og_image_url' => $input['og_image_url'] ?? '',
            'robots_directive' => $input['robots_directive'] ?? '',
            'seo_organization_type' => $input['seo_organization_type'] ?? '',
            // Location fields
            'location_name' => $input['location_name'] ?? '',
            'country_code' => $input['country_code'] ?? '',
            'service_area' => $input['service_area'] ?? '',
            'latitude' => $latitude,
            'longitude' => $longitude,
            // Social media fields
            'social_facebook' => $input['social_facebook'] ?? '',
            'social_twitter' => $input['social_twitter'] ?? '',
            'social_instagram' => $input['social_instagram'] ?? '',
            'social_linkedin' => $input['social_linkedin'] ?? '',
            'social_youtube' => $input['social_youtube'] ?? '',
            // Configuration JSON (languages, etc.)
            'configuration' => $input['configuration'] ?? null,
        ];

        $result = $this->tenantHierarchyService->createTenant($data, $parentId);

        if ($result['success']) {
            return $this->respondWithData([
                'tenant_id' => $result['tenant_id'],
                'message' => __('api_controllers_1.admin_super.tenant_created', ['name' => $name]),
            ], null, 201);
        }

        return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, $result['error'], null, 422);
    }

    /** PUT /api/v2/super-admin/tenants/{id} */
    public function tenantUpdate(int $id): JsonResponse
    {
        $this->requireSuperAdmin();

        if (!SuperPanelAccess::canAccessTenant($id)) {
            return $this->respondWithError(ApiErrorCodes::SUPER_PANEL_ACCESS_DENIED, __('api.super_no_access_tenant'), null, 403);
        }

        $input = $this->getAllInput();

        if (empty($input)) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.request_body_empty'), null, 422);
        }

        // Validate slug format if being updated
        if (isset($input['slug']) && trim($input['slug']) !== '') {
            $slug = trim($input['slug']);
            if (!preg_match('/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/', $slug)) {
                return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.slug_format_invalid'), 'slug', 422);
            }
        }

        // Validate domain format if being updated
        if (isset($input['domain']) && trim($input['domain']) !== '') {
            $domain = trim($input['domain']);
            if (!preg_match('/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i', $domain)) {
                return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.domain_format_invalid'), 'domain', 422);
            }
        }

        // Validate accessible (GOV.UK) frontend domain format if being updated
        if (isset($input['accessible_domain']) && trim($input['accessible_domain']) !== '') {
            $accessibleDomain = trim($input['accessible_domain']);
            if (!preg_match('/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i', $accessibleDomain)) {
                return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.domain_format_invalid'), 'accessible_domain', 422);
            }
        }

        // Validate contact email if being updated
        if (isset($input['contact_email']) && trim($input['contact_email']) !== '') {
            if (!filter_var(trim($input['contact_email']), FILTER_VALIDATE_EMAIL)) {
                return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.contact_email_invalid'), 'contact_email', 422);
            }
        }

        // Validate contact phone if being updated (international E.164 format)
        if (isset($input['contact_phone']) && trim($input['contact_phone']) !== '') {
            if (!Validator::isPhone(trim($input['contact_phone']))) {
                return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.contact_phone_invalid'), 'contact_phone', 422);
            }
        }

        // Validate latitude/longitude if being updated
        if (isset($input['latitude']) && $input['latitude'] !== '' && (float)$input['latitude'] !== 0.0) {
            if ((float)$input['latitude'] < -90 || (float)$input['latitude'] > 90) {
                return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.latitude_range'), 'latitude', 422);
            }
        }
        if (isset($input['longitude']) && $input['longitude'] !== '' && (float)$input['longitude'] !== 0.0) {
            if ((float)$input['longitude'] < -180 || (float)$input['longitude'] > 180) {
                return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.longitude_range'), 'longitude', 422);
            }
        }

        $result = $this->tenantHierarchyService->updateTenant($id, $input);

        if ($result['success']) {
            return $this->respondWithData(['updated' => true, 'tenant_id' => $id]);
        }

        $code = (string) ($result['code'] ?? ApiErrorCodes::VALIDATION_ERROR);
        $response = $this->respondWithError(
            $code,
            (string) $result['error'],
            null,
            $code === 'PASSKEY_RP_CHANGE_BLOCKED' ? 409 : 422
        );
        if (isset($result['security_impact']) && is_array($result['security_impact'])) {
            $payload = $response->getData(true);
            $payload['meta']['security_impact'] = $result['security_impact'];
            $response->setData($payload);
        }

        return $response;
    }

    /**
     * DELETE /api/v2/super-admin/tenants/{id}
     *
     * DEACTIVATES a tenant (is_active = 0) — a reversible action any super-admin
     * may perform. Permanent, irreversible removal is the separate god-only purge
     * endpoint below; there is no "hard delete via query param" any more.
     */
    public function tenantDelete(int $id): JsonResponse
    {
        $this->requireSuperAdmin();

        if (!SuperPanelAccess::canAccessTenant($id)) {
            return $this->respondWithError(ApiErrorCodes::SUPER_PANEL_ACCESS_DENIED, __('api.super_no_access_tenant'), null, 403);
        }

        $result = $this->tenantHierarchyService->deleteTenant($id, false);

        if ($result['success']) {
            return $this->respondWithData(['deleted' => true, 'tenant_id' => $id]);
        }

        return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, $result['error'], null, 422);
    }

    /**
     * GET /api/v2/super-admin/tenants/{id}/purge-preview
     *
     * God-only dry run: reports the row counts and external resources a purge
     * would remove, without deleting anything. Powers the confirmation dialog.
     */
    public function tenantPurgePreview(int $id): JsonResponse
    {
        $userId = $this->requireSuperAdmin();
        $this->requireGod($userId);

        if (!SuperPanelAccess::canAccessTenant($id)) {
            return $this->respondWithError(ApiErrorCodes::SUPER_PANEL_ACCESS_DENIED, __('api.super_no_access_tenant'), null, 403);
        }

        $report = \App\Services\TenantProvisioning\TenantPurgeService::purge($id, ['dry_run' => true]);

        if (!($report['success'] ?? false)) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, $report['error'] ?? __('api.super_purge_failed'), null, 422);
        }

        return $this->respondWithData($report);
    }

    /**
     * POST /api/v2/super-admin/tenants/{id}/purge
     *
     * God-only, irreversible. Enqueues a background purge of the tenant and ALL
     * of its data. The tenant must already be deactivated. Returns 202 — the work
     * runs on the queue because a full purge can take minutes.
     */
    public function tenantPurge(int $id): JsonResponse
    {
        $userId = $this->requireSuperAdmin();
        $this->requireGod($userId);

        if (!SuperPanelAccess::canAccessTenant($id)) {
            return $this->respondWithError(ApiErrorCodes::SUPER_PANEL_ACCESS_DENIED, __('api.super_no_access_tenant'), null, 403);
        }

        // Re-check the destructive guards synchronously so the god-admin gets an
        // immediate, actionable error instead of a silent queue failure.
        if ($id === 1) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.super_purge_master_forbidden'), null, 422);
        }
        $tenant = DB::table('tenants')->where('id', $id)->first();
        if (!$tenant) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.super_tenant_not_found'), null, 404);
        }
        if ((int) $tenant->is_active === 1) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.super_purge_requires_deactivation'), null, 422);
        }
        if (DB::table('tenants')->where('parent_id', $id)->count() > 0) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.super_purge_has_children'), null, 422);
        }

        \App\Jobs\PurgeTenantJob::dispatch($id);

        return $this->respondWithData([
            'purge_started' => true,
            'tenant_id'     => $id,
        ], null, 202);
    }

    /** POST /api/v2/super-admin/tenants/{id}/reactivate */
    public function tenantReactivate(int $id): JsonResponse
    {
        $this->requireSuperAdmin();

        if (!SuperPanelAccess::canAccessTenant($id)) {
            return $this->respondWithError(ApiErrorCodes::SUPER_PANEL_ACCESS_DENIED, __('api.super_no_access_tenant'), null, 403);
        }

        $result = $this->tenantHierarchyService->updateTenant($id, ['is_active' => 1]);

        if ($result['success']) {
            return $this->respondWithData(['reactivated' => true, 'tenant_id' => $id]);
        }

        return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, $result['error'], null, 422);
    }

    /** POST /api/v2/super-admin/tenants/{id}/toggle-hub */
    public function tenantToggleHub(int $id): JsonResponse
    {
        $this->requireSuperAdmin();

        if (!SuperPanelAccess::canAccessTenant($id)) {
            return $this->respondWithError(ApiErrorCodes::SUPER_PANEL_ACCESS_DENIED, __('api.super_no_access_tenant'), null, 403);
        }

        $input = $this->getAllInput();
        $enable = !empty($input['enable']);

        $result = $this->tenantHierarchyService->toggleSubtenantCapability($id, $enable);

        if ($result['success']) {
            return $this->respondWithData([
                'tenant_id' => $id,
                'hub_enabled' => $enable,
            ]);
        }

        return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, $result['error'], null, 422);
    }

    /** POST /api/v2/super-admin/tenants/{id}/move */
    public function tenantMove(int $id): JsonResponse
    {
        $this->requireSuperAdmin();

        if (!SuperPanelAccess::canAccessTenant($id)) {
            return $this->respondWithError(ApiErrorCodes::SUPER_PANEL_ACCESS_DENIED, __('api.super_no_access_tenant'), null, 403);
        }

        $input = $this->getAllInput();
        $newParentId = (int) ($input['new_parent_id'] ?? 0);

        if (!$newParentId) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.new_parent_id_required'), 'new_parent_id', 422);
        }

        if (!SuperPanelAccess::canAccessTenant($newParentId)) {
            return $this->respondWithError(ApiErrorCodes::SUPER_PANEL_ACCESS_DENIED, __('api.super_no_access_destination'), null, 403);
        }

        $result = $this->tenantHierarchyService->moveTenant($id, $newParentId);

        if ($result['success']) {
            return $this->respondWithData([
                'moved' => true,
                'tenant_id' => $id,
                'new_parent_id' => $newParentId,
            ]);
        }

        $code = (string) ($result['code'] ?? ApiErrorCodes::VALIDATION_ERROR);
        $response = $this->respondWithError(
            $code,
            (string) $result['error'],
            null,
            $code === 'PASSKEY_RP_CHANGE_BLOCKED' ? 409 : 422
        );
        if (isset($result['security_impact']) && is_array($result['security_impact'])) {
            $payload = $response->getData(true);
            $payload['meta']['security_impact'] = $result['security_impact'];
            $response->setData($payload);
        }

        return $response;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // User Management
    // ─────────────────────────────────────────────────────────────────────────

    /** GET /api/v2/super-admin/users */
    public function userList(): JsonResponse
    {
        $this->requireSuperAdmin();

        $page = $this->queryInt('page', 1, 1);
        $limit = $this->queryInt('limit', 50, 1, 200);

        $filters = array_filter([
            'search' => $this->query('search'),
            'tenant_id' => $this->query('tenant_id') !== null ? (int) $this->query('tenant_id') : null,
            'role' => $this->query('role'),
            'is_tenant_super_admin' => $this->query('super_admins') !== null ? 1 : null,
            'limit' => $limit,
            'offset' => ($page - 1) * $limit,
        ], fn($v) => $v !== null);

        $users = $this->tenantVisibilityService->getUserList($filters);

        return $this->respondWithData($users);
    }

    /** GET /api/v2/super-admin/users/{id} */
    public function userShow(int $id): JsonResponse
    {
        $this->requireSuperAdmin();

        // Super-admin: cross-tenant by design — tenant scope enforced via SuperPanelAccess::canAccessTenant() below
        $user = User::findById($id, false);

        if (!$user) {
            return $this->respondWithError(ApiErrorCodes::RESOURCE_NOT_FOUND, __('api.user_not_found'), null, 404);
        }

        if (!SuperPanelAccess::canAccessTenant((int) $user['tenant_id'])) {
            return $this->respondWithError(ApiErrorCodes::SUPER_PANEL_ACCESS_DENIED, __('api.super_no_access_user_tenant'), null, 403);
        }

        $tenant = Tenant::find($user['tenant_id']);

        return $this->respondWithData(array_merge($user, [
            'tenant_name' => $tenant['name'] ?? null,
            'name' => trim(($user['first_name'] ?? '') . ' ' . ($user['last_name'] ?? '')),
        ]));
    }

    /** POST /api/v2/super-admin/users */
    public function userCreate(): JsonResponse
    {
        $userId = $this->requireSuperAdmin();

        $input = $this->getAllInput();

        $tenantId = (int) ($input['tenant_id'] ?? 0);
        if (!$tenantId) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.tenant_id_is_required'), 'tenant_id', 422);
        }

        if (!SuperPanelAccess::canAccessTenant($tenantId)) {
            return $this->respondWithError(ApiErrorCodes::SUPER_PANEL_ACCESS_DENIED, __('api.super_no_access_tenant'), null, 403);
        }

        $firstName = trim($input['first_name'] ?? '');
        $lastName = trim($input['last_name'] ?? '');
        $email = trim($input['email'] ?? '');
        $password = $input['password'] ?? '';
        $role = $input['role'] ?? 'member';

        if (empty($firstName) || empty($email) || empty($password)) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.super_user_create_required_fields'), null, 422);
        }

        $allowedRoles = ['member', 'admin', 'broker', 'super_admin'];
        if (!in_array($role, $allowedRoles, true)) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.invalid_role_allowed', ['roles' => implode(', ', $allowedRoles)]), 'role', 422);
        }

        // Check email uniqueness
        $existing = User::findGlobalByEmail($email);
        if ($existing) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.email_already_exists_system'), 'email', 422);
        }

        $options = [
            'location' => $input['location'] ?? null,
            'phone' => $input['phone'] ?? null,
            'is_approved' => 1,
            'is_tenant_super_admin' => !empty($input['is_tenant_super_admin']) ? 1 : 0,
        ];

        // createWithTenant(array $data, int $tenantId): build the data array it
        // actually expects (was previously called with 7 positional args, which
        // is a TypeError against the (array $data, int $tenantId) signature).
        $data = array_merge($options, [
            'first_name' => $firstName,
            'last_name'  => $lastName,
            'email'      => $email,
            'password'   => $password,
            'role'       => $role,
        ]);
        $newUserId = User::createWithTenant($data, $tenantId);

        if ($newUserId) {
            $this->superAdminAuditService->log(
                'user_created',
                'user',
                $newUserId,
                "{$firstName} {$lastName}",
                null,
                ['tenant_id' => $tenantId, 'email' => $email, 'role' => $role],
                "Created user '{$firstName} {$lastName}' in tenant ID {$tenantId}"
            );

            return $this->respondWithData(['user_id' => $newUserId], null, 201);
        }

        return $this->respondWithError(ApiErrorCodes::SERVER_INTERNAL_ERROR, __('api.user_created_failed'), null, 500);
    }

    /** PUT /api/v2/super-admin/users/{id} */
    public function userUpdate(int $id): JsonResponse
    {
        $this->requireSuperAdmin();

        // Super-admin: cross-tenant by design — tenant scope enforced via SuperPanelAccess::canAccessTenant() below
        $user = User::findById($id, false);

        if (!$user) {
            return $this->respondWithError(ApiErrorCodes::RESOURCE_NOT_FOUND, __('api.user_not_found'), null, 404);
        }

        if (!SuperPanelAccess::canAccessTenant((int) $user['tenant_id'])) {
            return $this->respondWithError(ApiErrorCodes::SUPER_PANEL_ACCESS_DENIED, __('api.super_no_access_user_tenant'), null, 403);
        }

        $input = $this->getAllInput();

        $firstName = trim($input['first_name'] ?? $user['first_name']);
        $lastName = trim($input['last_name'] ?? $user['last_name'] ?? '');
        $email = trim($input['email'] ?? $user['email']);
        $role = $input['role'] ?? $user['role'];
        $location = isset($input['location']) ? trim($input['location']) : ($user['location'] ?? null);
        $phone = isset($input['phone']) ? trim($input['phone']) : ($user['phone'] ?? null);

        if (empty($firstName) || empty($email)) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.super_user_edit_required_fields'), null, 422);
        }

        $allowedRoles = ['member', 'admin', 'broker', 'super_admin'];
        if (!in_array($role, $allowedRoles, true)) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.invalid_role_allowed', ['roles' => implode(', ', $allowedRoles)]), 'role', 422);
        }

        // Check email uniqueness if changed
        if ($email !== $user['email']) {
            $existing = User::findGlobalByEmail($email);
            if ($existing && (int) $existing['id'] !== $id) {
                return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.email_already_exists'), 'email', 422);
            }
        }

        DB::update(
            "UPDATE users SET first_name = ?, last_name = ?, email = ?, role = ?, location = ?, phone = ?, updated_at = NOW() WHERE id = ?",
            [$firstName, $lastName, $email, $role, $location ?: null, $phone ?: null, $id]
        );

        return $this->respondWithData(['updated' => true, 'user_id' => $id]);
    }

    /** POST /api/v2/super-admin/users/{id}/grant-super */
    public function userGrantSuperAdmin(int $id): JsonResponse
    {
        $this->requireSuperAdmin();

        // Super-admin: cross-tenant by design — tenant scope enforced via SuperPanelAccess::canAccessTenant() below
        $user = User::findById($id, false);

        if (!$user) {
            return $this->respondWithError(ApiErrorCodes::RESOURCE_NOT_FOUND, __('api.user_not_found'), null, 404);
        }

        if (!SuperPanelAccess::canAccessTenant((int) $user['tenant_id'])) {
            return $this->respondWithError(ApiErrorCodes::SUPER_PANEL_ACCESS_DENIED, __('api.super_no_access_user_tenant'), null, 403);
        }

        // Tenant must allow sub-tenants
        $tenant = Tenant::find($user['tenant_id']);
        if (!$tenant || !$tenant['allows_subtenants']) {
            return $this->respondWithError(
                ApiErrorCodes::VALIDATION_ERROR,
                __('api.super_grant_denied_not_hub'),
                null,
                422
            );
        }

        $result = $this->tenantHierarchyService->assignTenantSuperAdmin($id, (int) $user['tenant_id']);

        if ($result['success']) {
            return $this->respondWithData(['granted' => true, 'user_id' => $id]);
        }

        return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, $result['error'], null, 422);
    }

    /** POST /api/v2/super-admin/users/{id}/revoke-super */
    public function userRevokeSuperAdmin(int $id): JsonResponse
    {
        $userId = $this->requireSuperAdmin();

        // Super-admin: cross-tenant by design — tenant scope enforced via SuperPanelAccess::canAccessTenant() below
        $user = User::findById($id, false);

        if (!$user) {
            return $this->respondWithError(ApiErrorCodes::RESOURCE_NOT_FOUND, __('api.user_not_found'), null, 404);
        }

        if (!SuperPanelAccess::canAccessTenant((int) $user['tenant_id'])) {
            return $this->respondWithError(ApiErrorCodes::SUPER_PANEL_ACCESS_DENIED, __('api.super_no_access_user_tenant'), null, 403);
        }

        // Cannot revoke from a global super admin unless caller is god
        if (!empty($user['is_super_admin']) && !User::isGod($userId)) {
            return $this->respondWithError(
                ApiErrorCodes::AUTH_INSUFFICIENT_PERMISSIONS,
                __('api.super_revoke_denied_global'),
                null,
                403
            );
        }

        $result = $this->tenantHierarchyService->revokeTenantSuperAdmin($id);

        if ($result['success']) {
            return $this->respondWithData(['revoked' => true, 'user_id' => $id]);
        }

        return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, $result['error'], null, 422);
    }

    /** POST /api/v2/super-admin/users/{id}/grant-global */
    public function userGrantGlobalSuperAdmin(int $id): JsonResponse
    {
        $userId = $this->requireSuperAdmin();
        $this->requireGod($userId);

        // Super-admin: cross-tenant by design — restricted to "god" users via requireGod() above
        $user = User::findById($id, false);

        if (!$user) {
            return $this->respondWithError(ApiErrorCodes::RESOURCE_NOT_FOUND, __('api.user_not_found'), null, 404);
        }

        DB::update(
            "UPDATE users SET is_super_admin = 1, role = CASE WHEN role = 'member' THEN 'admin' ELSE role END WHERE id = ?",
            [$id]
        );

        SuperAdminAuditService::log(
            'global_super_admin_granted',
            'user',
            $id,
            ($user['first_name'] ?? '') . ' ' . ($user['last_name'] ?? ''),
            ['is_super_admin' => 0],
            ['is_super_admin' => 1],
            "Granted global super admin to user #{$id}"
        );

        return $this->respondWithData(['granted' => true, 'user_id' => $id, 'level' => 'global']);
    }

    /** POST /api/v2/super-admin/users/{id}/revoke-global */
    public function userRevokeGlobalSuperAdmin(int $id): JsonResponse
    {
        $userId = $this->requireSuperAdmin();
        $this->requireGod($userId);

        // Super-admin: cross-tenant by design — restricted to "god" users via requireGod() above
        $user = User::findById($id, false);

        if (!$user) {
            return $this->respondWithError(ApiErrorCodes::RESOURCE_NOT_FOUND, __('api.user_not_found'), null, 404);
        }

        // Cannot revoke from yourself
        if ($id === $userId) {
            return $this->respondWithError(
                ApiErrorCodes::VALIDATION_ERROR,
                __('api.super_cannot_revoke_self'),
                null,
                422
            );
        }

        DB::update("UPDATE users SET is_super_admin = 0 WHERE id = ?", [$id]);

        SuperAdminAuditService::log(
            'global_super_admin_revoked',
            'user',
            $id,
            ($user['first_name'] ?? '') . ' ' . ($user['last_name'] ?? ''),
            ['is_super_admin' => 1],
            ['is_super_admin' => 0],
            "Revoked global super admin from user #{$id}"
        );

        return $this->respondWithData(['revoked' => true, 'user_id' => $id, 'level' => 'global']);
    }

    /** POST /api/v2/super-admin/users/{id}/move-tenant */
    /**
     * POST /api/v2/admin/super/users/{id}/impersonate
     *
     * Cross-tenant impersonation proof for the super-admin panel.
     *
     * The tenant-scoped /v2/admin/users/{id}/impersonate endpoint refuses any
     * target outside the current tenant, which made it useless from a panel
     * whose whole purpose is browsing other communities. Access here is bounded
     * by SuperPanelAccess instead: a regional (hub) super admin stays inside its
     * own subtree, master level sees everything.
     */
    public function userImpersonate(int $id): JsonResponse
    {
        $adminId = $this->requireSuperAdmin();

        // Super-admin: cross-tenant by design — tenant scope enforced via SuperPanelAccess::canAccessTenant() below
        $user = User::findById($id, false);

        if (!$user) {
            return $this->respondWithError(ApiErrorCodes::RESOURCE_NOT_FOUND, __('api.user_not_found'), null, 404);
        }

        $targetTenantId = (int) $user['tenant_id'];
        if (!SuperPanelAccess::canAccessTenant($targetTenantId)) {
            return $this->respondWithError(
                ApiErrorCodes::SUPER_PANEL_ACCESS_DENIED,
                __('api.super_no_access_user_source_tenant'),
                null,
                403
            );
        }

        if ($id === $adminId) {
            return $this->respondWithError(
                ApiErrorCodes::VALIDATION_ERROR,
                __('api.cannot_impersonate_self'),
                null,
                422
            );
        }

        // A platform administrator is never an impersonation target, whatever
        // the actor's own level. Impersonation must not become privilege
        // escalation between peers.
        if (!empty($user['is_super_admin']) || !empty($user['is_god'])
            || in_array($user['role'] ?? '', ['super_admin', 'god'], true)) {
            return $this->respondWithError(
                ApiErrorCodes::AUTH_INSUFFICIENT_PERMISSIONS,
                __('api.insufficient_permissions'),
                null,
                403
            );
        }

        if (($user['status'] ?? '') !== 'active') {
            return $this->respondWithError(
                ApiErrorCodes::VALIDATION_ERROR,
                __('api.impersonation_target_unavailable'),
                null,
                422
            );
        }

        $tokenService = app(\App\Services\TokenService::class);
        $token = $tokenService->generateImpersonationToken($id, $targetTenantId, $adminId);

        $tenantSlug = DB::table('tenants')->where('id', $targetTenantId)->value('slug');

        $userName = trim(($user['first_name'] ?? '') . ' ' . ($user['last_name'] ?? '')) ?: $user['email'];

        // Audited through the same path as the tenant-scoped endpoint rather than
        // superAdminAuditService: 'user_impersonated' is not a member of the
        // super_admin_audit_log.action_type enum, so that write would succeed and
        // silently store an empty action.
        \App\Models\ActivityLog::log(
            $adminId,
            'admin_impersonate',
            "Impersonated user #{$id} ({$user['email']}) in tenant #{$targetTenantId}"
        );
        app(\App\Services\AuditLogService::class)->logUserImpersonated($adminId, $id, $user['email']);

        return $this->respondWithData([
            'token' => $token,
            'user_id' => $id,
            'user_name' => $userName,
            'tenant_id' => $targetTenantId,
            'tenant_slug' => $tenantSlug,
        ]);
    }

    public function userMoveTenant(int $id): JsonResponse
    {
        $userId = $this->requireSuperAdmin();

        // Super-admin: cross-tenant by design — tenant scope enforced via SuperPanelAccess::canAccessTenant() below (both source and destination tenants)
        $user = User::findById($id, false);

        if (!$user) {
            return $this->respondWithError(ApiErrorCodes::RESOURCE_NOT_FOUND, __('api.user_not_found'), null, 404);
        }

        if (!SuperPanelAccess::canAccessTenant((int) $user['tenant_id'])) {
            return $this->respondWithError(ApiErrorCodes::SUPER_PANEL_ACCESS_DENIED, __('api.super_no_access_user_source_tenant'), null, 403);
        }

        $input = $this->getAllInput();
        $newTenantId = (int) ($input['new_tenant_id'] ?? 0);

        if (!$newTenantId) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.new_tenant_id_required'), 'new_tenant_id', 422);
        }

        if (!SuperPanelAccess::canAccessTenant($newTenantId)) {
            return $this->respondWithError(ApiErrorCodes::SUPER_PANEL_ACCESS_DENIED, __('api.super_no_access_destination'), null, 403);
        }

        $oldTenantId = $user['tenant_id'];

        $moveResult = User::moveTenant($id, $newTenantId);
        if (!$moveResult['success']) {
            return $this->respondWithUserMoveFailure($moveResult);
        }

        // Revoke super admin if moving to a tenant without sub-tenant capability
        $newTenant = Tenant::find($newTenantId);
        if ($newTenant && !$newTenant['allows_subtenants']) {
            DB::update("UPDATE users SET is_tenant_super_admin = 0 WHERE id = ?", [$id]);
        }

        // Audit
        $userName = trim(($user['first_name'] ?? '') . ' ' . ($user['last_name'] ?? '')) ?: $user['email'];
        $this->superAdminAuditService->log(
            'user_moved',
            'user',
            $id,
            $userName,
            ['tenant_id' => $oldTenantId],
            ['tenant_id' => $newTenantId],
            "Moved '{$userName}' to tenant '{$newTenant['name']}'"
        );

        return $this->respondWithData([
            'moved' => true,
            'user_id' => $id,
            'old_tenant_id' => $oldTenantId,
            'new_tenant_id' => $newTenantId,
            'records_moved' => $moveResult['moved'],
            'tables_failed' => $moveResult['failed'],
        ]);
    }

    /**
     * POST /api/v2/admin/super/users/{id}/move-and-promote
     *
     * (The path was previously documented here as
     * `/api/v2/super-admin/users/{id}/move-promote`, which does not exist — see
     * routes/api.php for the registered path.)
     *
     * Scoping: SuperPanelAccess::canAccessTenant() is checked on BOTH the source
     * and the destination tenant, so a `regional`-level super admin (a hub
     * tenant's own super admin) can only move users within their own subtree.
     * Only `master` level (god, or the master tenant's super admin) is
     * unrestricted. Preserve that both-ends check in any change here.
     *
     * 🔴 See User::moveTenant(): the move updates users.tenant_id ONLY. The
     * member's transactions, listings, messages and group memberships keep the
     * old tenant_id, so balance travels with them while history does not. The
     * `records_moved` / `tables_failed` response fields describe that single-row
     * update and a passkey precondition — they are not a multi-table migration
     * report.
     */
    public function userMoveAndPromote(int $id): JsonResponse
    {
        $userId = $this->requireSuperAdmin();

        $user = User::findById($id, false);

        if (!$user) {
            return $this->respondWithError(ApiErrorCodes::RESOURCE_NOT_FOUND, __('api.user_not_found'), null, 404);
        }

        if (!SuperPanelAccess::canAccessTenant((int) $user['tenant_id'])) {
            return $this->respondWithError(ApiErrorCodes::SUPER_PANEL_ACCESS_DENIED, __('api.super_no_access_user_source_tenant'), null, 403);
        }

        $input = $this->getAllInput();
        $targetTenantId = (int) ($input['target_tenant_id'] ?? 0);

        if (!$targetTenantId) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.target_tenant_id_required'), 'target_tenant_id', 422);
        }

        if (!SuperPanelAccess::canAccessTenant($targetTenantId)) {
            return $this->respondWithError(ApiErrorCodes::SUPER_PANEL_ACCESS_DENIED, __('api.super_no_access_target'), null, 403);
        }

        // Target must be a hub tenant
        $targetTenant = Tenant::find($targetTenantId);
        if (!$targetTenant || !$targetTenant['allows_subtenants']) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.target_must_be_hub'),
                'target_tenant_id',
                422
            );
        }

        $oldTenantId = $user['tenant_id'];

        // Step 1: Move user
        $moveResult = User::moveTenant($id, $targetTenantId);
        if (!$moveResult['success']) {
            return $this->respondWithUserMoveFailure($moveResult);
        }

        // Step 2: Grant super admin (role merged into admin; the flag carries the power)
        DB::update(
            "UPDATE users SET is_tenant_super_admin = 1, role = 'admin' WHERE id = ?",
            [$id]
        );

        // Audit
        $userName = trim(($user['first_name'] ?? '') . ' ' . ($user['last_name'] ?? '')) ?: $user['email'];
        $this->superAdminAuditService->log(
            'user_moved',
            'user',
            $id,
            $userName,
            ['tenant_id' => $oldTenantId, 'is_tenant_super_admin' => $user['is_tenant_super_admin'] ?? 0],
            ['tenant_id' => $targetTenantId, 'is_tenant_super_admin' => 1],
            "Moved '{$userName}' to '{$targetTenant['name']}' and granted Super Admin privileges"
        );

        return $this->respondWithData([
            'moved' => true,
            'promoted' => true,
            'user_id' => $id,
            'old_tenant_id' => $oldTenantId,
            'new_tenant_id' => $targetTenantId,
        ]);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Bulk Operations
    // ─────────────────────────────────────────────────────────────────────────

    /** POST /api/v2/super-admin/bulk/move-users */
    public function bulkMoveUsers(): JsonResponse
    {
        $userId = $this->requireSuperAdmin();

        $input = $this->getAllInput();

        $userIds = $input['user_ids'] ?? [];
        $targetTenantId = (int) ($input['target_tenant_id'] ?? 0);
        $grantSuperAdmin = !empty($input['grant_super_admin']);

        if (empty($userIds) || !is_array($userIds)) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.user_ids_required'), 'user_ids', 422);
        }

        if (!$targetTenantId) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.target_tenant_id_required'), 'target_tenant_id', 422);
        }

        $targetTenant = Tenant::find($targetTenantId);
        if (!$targetTenant) {
            return $this->respondWithError(ApiErrorCodes::RESOURCE_NOT_FOUND, __('api.target_tenant_not_found'), null, 404);
        }

        if (!SuperPanelAccess::canAccessTenant($targetTenantId)) {
            return $this->respondWithError(ApiErrorCodes::SUPER_PANEL_ACCESS_DENIED, __('api.super_no_access_target'), null, 403);
        }

        if ($grantSuperAdmin && !$targetTenant['allows_subtenants']) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.super_grant_denied_not_hub_target'),
                null,
                422
            );
        }

        // Pre-validate ALL users before moving any (prevents partial failures)
        $validatedUsers = [];
        $errors = [];

        foreach ($userIds as $uid) {
            $uid = (int) $uid;
            $user = User::findById($uid, false);

            if (!$user) {
                $errors[] = ['code' => 'USER_NOT_FOUND', 'params' => ['user_id' => $uid]];
                continue;
            }

            if ((int) $user['tenant_id'] === $targetTenantId) {
                $errors[] = ['code' => 'USER_ALREADY_IN_TARGET_TENANT', 'params' => ['user_id' => $uid]];
                continue;
            }

            if (!SuperPanelAccess::canAccessTenant((int) $user['tenant_id'])) {
                $errors[] = ['code' => 'USER_TENANT_ACCESS_DENIED', 'params' => ['user_id' => $uid]];
                continue;
            }

            $validatedUsers[] = $uid;
        }

        // If pre-validation found errors and no valid users, return early
        if (empty($validatedUsers) && !empty($errors)) {
            return $this->respondWithData([
                'updated_count' => 0,
                'errors' => $errors,
            ]);
        }

        // Move all validated users
        $movedCount = 0;
        $failures = [];

        foreach ($validatedUsers as $uid) {
            try {
                $moveResult = User::moveTenant($uid, $targetTenantId);
                if (!$moveResult['success']) {
                    if (self::moveRequiresPasskeyRecovery($moveResult)) {
                        $issue = [
                            'code' => ApiErrorCodes::USER_MOVE_PASSKEY_RECOVERY_REQUIRED,
                            'params' => ['user_id' => $uid],
                        ];
                        $errors[] = $issue;
                        $failures[] = [
                            'user_id' => $uid,
                            ...$issue,
                        ];
                    } else {
                        $errors[] = ['code' => 'USER_MOVE_FAILED', 'params' => ['user_id' => $uid]];
                    }
                    continue;
                }

                if ($grantSuperAdmin) {
                    DB::update(
                        "UPDATE users SET is_tenant_super_admin = 1, role = 'admin' WHERE id = ?",
                        [$uid]
                    );
                } elseif (!$targetTenant['allows_subtenants']) {
                    DB::update("UPDATE users SET is_tenant_super_admin = 0 WHERE id = ?", [$uid]);
                }

                $movedCount++;
            } catch (\Exception $e) {
                $errors[] = ['code' => 'USER_MOVE_FAILED', 'params' => ['user_id' => $uid]];
            }
        }

        $this->superAdminAuditService->log(
            'bulk_users_moved',
            'bulk',
            null,
            $this->structuredAuditDisplay('bulk_users_move_target', ['tenant' => $targetTenant['name']]),
            ['user_count' => count($userIds)],
            ['target_tenant_id' => $targetTenantId, 'moved_count' => $movedCount, 'grant_super_admin' => $grantSuperAdmin],
            $this->structuredAuditDisplay(
                $grantSuperAdmin ? 'bulk_users_moved_with_super_admin' : 'bulk_users_moved',
                ['count' => $movedCount, 'tenant' => $targetTenant['name']],
            )
        );

        return $this->respondWithData([
            'moved_count' => $movedCount,
            'total_requested' => count($userIds),
            'errors' => $errors,
            'failures' => $failures,
        ]);
    }

    /** POST /api/v2/super-admin/bulk/update-tenants */
    public function bulkUpdateTenants(): JsonResponse
    {
        $userId = $this->requireSuperAdmin();

        $input = $this->getAllInput();

        $tenantIds = $input['tenant_ids'] ?? [];
        $action = $input['action'] ?? '';

        if (empty($tenantIds) || !is_array($tenantIds)) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.tenant_ids_array_required'), 'tenant_ids', 422);
        }

        if (!in_array($action, ['activate', 'deactivate', 'enable_hub', 'disable_hub'], true)) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.super_bulk_invalid_action'), 'action', 422);
        }

        $updatedCount = 0;
        $errors = [];

        foreach ($tenantIds as $tid) {
            $tid = (int) $tid;

            if ($tid === 1) {
                $errors[] = ['code' => 'MASTER_TENANT_IMMUTABLE', 'params' => ['tenant_id' => $tid]];
                continue;
            }

            $tenant = Tenant::find($tid);
            if (!$tenant) {
                $errors[] = ['code' => 'TENANT_NOT_FOUND', 'params' => ['tenant_id' => $tid]];
                continue;
            }

            if (!SuperPanelAccess::canAccessTenant($tid)) {
                $errors[] = ['code' => 'TENANT_ACCESS_DENIED', 'params' => ['tenant_id' => $tid]];
                continue;
            }

            try {
                switch ($action) {
                    case 'activate':
                        DB::update("UPDATE tenants SET is_active = 1 WHERE id = ?", [$tid]);
                        break;
                    case 'deactivate':
                        DB::update("UPDATE tenants SET is_active = 0 WHERE id = ?", [$tid]);
                        break;
                    case 'enable_hub':
                        $result = $this->tenantHierarchyService->toggleSubtenantCapability($tid, true);
                        if (!$result['success']) {
                            $errors[] = [
                                'code' => $result['code'] ?? 'TENANT_UPDATE_FAILED',
                                'params' => ['tenant_id' => $tid],
                            ];
                            continue 2;
                        }
                        break;
                    case 'disable_hub':
                        $result = $this->tenantHierarchyService->toggleSubtenantCapability($tid, false);
                        if (!$result['success']) {
                            $errors[] = [
                                'code' => $result['code'] ?? 'TENANT_UPDATE_FAILED',
                                'params' => ['tenant_id' => $tid],
                            ];
                            continue 2;
                        }
                        break;
                }
                $updatedCount++;
            } catch (\Exception $e) {
                $errors[] = ['code' => 'TENANT_UPDATE_FAILED', 'params' => ['tenant_id' => $tid]];
            }
        }

        $this->superAdminAuditService->log(
            'bulk_tenants_updated',
            'bulk',
            null,
            $this->structuredAuditDisplay('bulk_tenants_update_target', ['action' => $action]),
            ['tenant_count' => count($tenantIds)],
            ['action' => $action, 'updated_count' => $updatedCount],
            $this->structuredAuditDisplay('bulk_tenants_updated', [
                'action' => $action,
                'count' => $updatedCount,
            ])
        );

        return $this->respondWithData([
            'updated_count' => $updatedCount,
            'total_requested' => count($tenantIds),
            'action' => $action,
            'errors' => $errors,
        ]);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Audit
    // ─────────────────────────────────────────────────────────────────────────

    /** @param array<string, bool|int|string> $params */
    private function structuredAuditDisplay(string $code, array $params): string
    {
        return json_encode(
            ['code' => $code, 'params' => $params],
            JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE,
        );
    }

    /**
     * @return array{code: ?string, params: array<string, mixed>, legacy: ?string}
     */
    private function decodeAuditDisplay(?string $value): array
    {
        if ($value === null || !str_starts_with(trim($value), '{')) {
            return ['code' => null, 'params' => [], 'legacy' => $value];
        }

        $decoded = json_decode($value, true);
        if (!is_array($decoded) || !is_string($decoded['code'] ?? null)) {
            return ['code' => null, 'params' => [], 'legacy' => $value];
        }

        return [
            'code' => $decoded['code'],
            'params' => is_array($decoded['params'] ?? null) ? $decoded['params'] : [],
            'legacy' => null,
        ];
    }

    /** GET /api/v2/super-admin/audit */
    public function audit(): JsonResponse
    {
        $this->requireSuperAdmin();

        $page = $this->queryInt('page', 1, 1);
        $limit = $this->queryInt('limit', 50, 1, 100);

        $filters = array_filter([
            'action_type' => $this->query('action_type'),
            'target_type' => $this->query('target_type'),
            'search' => $this->query('search'),
            'date_from' => $this->query('date_from'),
            'date_to' => $this->query('date_to'),
            'limit' => $limit,
            'offset' => ($page - 1) * $limit,
        ], fn($v) => $v !== null);

        $logs = $this->superAdminAuditService->getLog($filters);

        // Map DB columns to frontend field names
        $mapped = array_map(function ($row) {
            $targetDisplay = $this->decodeAuditDisplay($row['target_name'] ?? null);
            $descriptionDisplay = $this->decodeAuditDisplay($row['description'] ?? null);

            return [
                'id' => $row['id'] ?? null,
                'action_type' => $row['action_type'] ?? '',
                'target_type' => $row['target_type'] ?? '',
                'target_id' => $row['target_id'] ?? null,
                'target_label' => $targetDisplay['legacy'],
                'target_label_code' => $targetDisplay['code'],
                'target_label_params' => $targetDisplay['params'],
                'actor_id' => $row['actor_user_id'] ?? null,
                'actor_name' => $row['actor_name'] ?? null,
                'actor_email' => $row['actor_email'] ?? null,
                'old_value' => $row['old_values'] ?? null,
                'new_value' => $row['new_values'] ?? null,
                'description' => $descriptionDisplay['legacy'],
                'description_code' => $descriptionDisplay['code'],
                'description_params' => $descriptionDisplay['params'],
                'created_at' => $row['created_at'] ?? '',
            ];
        }, $logs);

        return $this->respondWithData($mapped);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Federation System Controls
    // ─────────────────────────────────────────────────────────────────────────

    /** GET /api/v2/super-admin/federation */
    public function federationOverview(): JsonResponse
    {
        $this->requireSuperAdmin();

        $systemControls = $this->federationFeatureService->getSystemControls();
        $partnershipStats = $this->federationPartnershipService->getStats();
        $whitelistedTenants = $this->federationFeatureService->getWhitelistedTenants();
        $recentAudit = $this->federationAuditService->getLog(['limit' => 20]);

        return $this->respondWithData([
            'system_controls' => $systemControls,
            'partnership_stats' => $partnershipStats,
            'whitelisted_count' => count($whitelistedTenants),
            'recent_audit' => $recentAudit,
        ]);
    }

    /** GET /api/v2/super-admin/federation/system-controls */
    public function federationGetSystemControls(): JsonResponse
    {
        $this->requireSuperAdmin();

        $controls = $this->federationFeatureService->getSystemControls();

        return $this->respondWithData($controls);
    }

    /**
     * GET /api/v2/admin/super/federation/jwt-status
     *
     * Returns whether FEDERATION_JWT_SECRET is configured on this server.
     * NEVER returns the secret itself — only a boolean status plus the
     * configured issuer string. Used by the admin UI to surface a clear
     * "configured / not configured" indicator plus setup instructions.
     */
    public function federationGetJwtStatus(): JsonResponse
    {
        $this->requireSuperAdmin();

        $secret = (string) config('federation.jwt_secret', '');
        $issuer = (string) config('federation.jwt_issuer', config('app.url', ''));

        // Key length in bits (hex chars × 4). "base64:..." prefix is common,
        // so strip that when measuring.
        $raw = str_starts_with($secret, 'base64:') ? base64_decode(substr($secret, 7)) : $secret;
        $bits = $secret === '' ? 0 : (ctype_xdigit($raw) ? strlen($raw) * 4 : strlen($raw) * 8);

        return $this->respondWithData([
            'configured' => $secret !== '',
            'issuer' => $issuer,
            'key_bits' => $bits,
            'recommended_bits' => 256,
        ]);
    }

    /** PUT /api/v2/super-admin/federation/system-controls */
    public function federationUpdateSystemControls(): JsonResponse
    {
        $userId = $this->requirePlatformSuperAdmin();

        $input = $this->getAllInput();

        $allowedFields = [
            'federation_enabled',
            'whitelist_mode_enabled',
            'max_federation_level',
            'cross_tenant_profiles_enabled',
            'cross_tenant_messaging_enabled',
            'cross_tenant_transactions_enabled',
            'cross_tenant_listings_enabled',
            'cross_tenant_events_enabled',
            'cross_tenant_groups_enabled',
            // External partner federation kill switch: master + per protocol.
            'external_federation_enabled',
            // AG60 Partner API kill switch — a sibling switch, deliberately
            // separate from federation so each label stays accurate.
            'partner_api_enabled',
            ...array_values(array_map(
                static fn (string $protocol): string => (string) FederationFeatureService::externalProtocolColumn($protocol),
                FederationFeatureService::externalProtocolNames(),
            )),
        ];

        $updates = [];
        $params = [];
        $touchesExternalFederation = false;
        $touchesPartnerApi = false;

        foreach ($allowedFields as $field) {
            if (isset($input[$field])) {
                $updates[] = "{$field} = ?";
                if ($field === 'max_federation_level') {
                    $params[] = max(0, min(4, (int) $input[$field]));
                } else {
                    $params[] = $input[$field] ? 1 : 0;
                }
                if (str_starts_with($field, 'external_')) {
                    $touchesExternalFederation = true;
                } elseif ($field === 'partner_api_enabled') {
                    $touchesPartnerApi = true;
                }
            }
        }

        if (empty($updates)) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.no_valid_fields'), null, 422);
        }

        $reason = isset($input['reason']) ? mb_substr(trim((string) $input['reason']), 0, 255) : null;

        // Each switch keeps its own attribution trail, so "who turned this off
        // and why" stays answerable per system rather than being overwritten by
        // an unrelated toggle.
        if ($touchesExternalFederation) {
            $updates[] = "external_federation_updated_at = NOW()";
            $updates[] = "external_federation_updated_by = ?";
            $params[] = $userId;

            if (array_key_exists('external_federation_enabled', $input)) {
                $updates[] = "external_federation_disabled_reason = ?";
                $params[] = $input['external_federation_enabled'] ? null : $reason;
            }
        }

        if ($touchesPartnerApi) {
            $updates[] = "partner_api_updated_at = NOW()";
            $updates[] = "partner_api_updated_by = ?";
            $params[] = $userId;
            $updates[] = "partner_api_disabled_reason = ?";
            $params[] = $input['partner_api_enabled'] ? null : $reason;
        }

        $updates[] = "updated_at = NOW()";
        $updates[] = "updated_by = ?";
        $params[] = $userId;

        DB::update(
            "UPDATE federation_system_control SET " . implode(', ', $updates) . " WHERE id = 1",
            $params
        );

        $this->federationFeatureService->clearCache();
        app(\App\Services\PartnerApi\PartnerApiKillSwitch::class)->clearCache();

        $this->federationAuditService->log(
            'system_controls_updated',
            null,
            null,
            $userId,
            ['changes' => $input],
            // Withdrawing or restoring external access — federation or the
            // Partner API — is a security-posture change, not routine config.
            $touchesExternalFederation || $touchesPartnerApi
                ? FederationAuditService::LEVEL_CRITICAL
                : FederationAuditService::LEVEL_WARNING
        );

        return $this->respondWithData(['updated' => true]);
    }

    /**
     * GET /api/v2/admin/super/federation/external-status
     *
     * Effective external federation posture plus a 24h blocked-attempt count
     * per protocol, so the operator can see whether partners are still trying.
     */
    public function federationGetExternalStatus(): JsonResponse
    {
        $this->requirePlatformSuperAdmin();

        $status = $this->federationFeatureService->externalProtocolStatus();

        // Advisory only: blocked outbound attempts are recorded against the
        // partner, so the protocol comes from the partner row.
        $blocked = [];
        try {
            $rows = DB::table('federation_external_partner_logs as l')
                ->join('federation_external_partners as p', 'p.id', '=', 'l.partner_id')
                ->select('p.protocol_type', DB::raw('COUNT(*) as total'))
                ->where('l.created_at', '>=', now()->subDay())
                ->where('l.success', 0)
                ->where('l.error_message', 'like', '%external federation disabled%')
                ->groupBy('p.protocol_type')
                ->get();

            foreach ($rows as $row) {
                $protocol = FederationFeatureService::protocolForPartnerType(
                    $row->protocol_type !== null ? (string) $row->protocol_type : null,
                );
                if ($protocol === null) {
                    continue;
                }
                $blocked[$protocol] = ($blocked[$protocol] ?? 0) + (int) $row->total;
            }
        } catch (\Throwable) {
            // Counters must never fail the status read.
            $blocked = [];
        }

        return $this->respondWithData($status + [
            'blocked_last_24h' => $blocked,
            // Sibling switch, reported alongside so one call answers "what
            // external access is currently open?".
            'partner_api' => app(\App\Services\PartnerApi\PartnerApiKillSwitch::class)->status(),
        ]);
    }

    /** POST /api/v2/super-admin/federation/emergency-lockdown */
    public function federationEmergencyLockdown(): JsonResponse
    {
        // Platform-wide action: defense-in-depth beyond the route middleware —
        // a tenant-scoped super-admin must never reach this even if the
        // middleware stack changes.
        $userId = $this->requirePlatformSuperAdmin();

        $input = $this->getAllInput();
        $reason = $input['reason'] ?? 'Emergency lockdown triggered via API';

        $result = $this->federationFeatureService->triggerEmergencyLockdown($userId, $reason);

        if ($result) {
            return $this->respondWithData(['lockdown' => true, 'message' => __('api_controllers_1.admin_super.lockdown_activated')]);
        }

        return $this->respondWithError(ApiErrorCodes::SERVER_INTERNAL_ERROR, __('api.federation_lockdown_activate_failed'), null, 500);
    }

    /** POST /api/v2/super-admin/federation/lift-lockdown */
    public function federationLiftLockdown(): JsonResponse
    {
        $userId = $this->requirePlatformSuperAdmin();

        $result = $this->federationFeatureService->liftEmergencyLockdown($userId);

        if ($result) {
            return $this->respondWithData(['lockdown' => false, 'message' => __('api_controllers_1.admin_super.lockdown_lifted')]);
        }

        return $this->respondWithError(ApiErrorCodes::SERVER_INTERNAL_ERROR, __('api.federation_lockdown_lift_failed'), null, 500);
    }

    /** GET /api/v2/super-admin/federation/whitelist */
    public function federationGetWhitelist(): JsonResponse
    {
        $this->requireSuperAdmin();

        $whitelisted = $this->federationFeatureService->getWhitelistedTenants();

        return $this->respondWithData($whitelisted);
    }

    /** POST /api/v2/super-admin/federation/whitelist */
    public function federationAddToWhitelist(): JsonResponse
    {
        $userId = $this->requirePlatformSuperAdmin();

        $input = $this->getAllInput();
        $tenantId = (int) ($input['tenant_id'] ?? 0);
        $notes = $input['notes'] ?? null;

        if ($tenantId <= 0) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.tenant_id_is_required'), 'tenant_id', 422);
        }

        $result = $this->federationFeatureService->addToWhitelist($tenantId, $userId, $notes);

        if ($result) {
            return $this->respondWithData(['added' => true, 'tenant_id' => $tenantId]);
        }

        return $this->respondWithError(ApiErrorCodes::SERVER_INTERNAL_ERROR, __('api.federation_whitelist_add_failed'), null, 500);
    }

    /** DELETE /api/v2/super-admin/federation/whitelist/{tenantId} */
    public function federationRemoveFromWhitelist($tenantId): JsonResponse
    {
        $userId = $this->requirePlatformSuperAdmin();

        $tenantId = (int) $tenantId;

        if ($tenantId <= 0) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.invalid_tenant_id'), 'tenantId', 400);
        }

        $result = $this->federationFeatureService->removeFromWhitelist($tenantId, $userId);

        if ($result) {
            return $this->respondWithData(['removed' => true, 'tenant_id' => $tenantId]);
        }

        return $this->respondWithError(ApiErrorCodes::SERVER_INTERNAL_ERROR, __('api.federation_whitelist_remove_failed'), null, 500);
    }

    /** GET /api/v2/super-admin/federation/partnerships */
    public function federationPartnerships(): JsonResponse
    {
        $this->requireSuperAdmin();

        $partnerships = $this->federationPartnershipService->getAllPartnerships(null, 100);
        $stats = $this->federationPartnershipService->getStats();

        return $this->respondWithData([
            'partnerships' => $partnerships,
            'stats' => $stats,
        ]);
    }

    /** POST /api/v2/super-admin/federation/partnerships/{id}/suspend */
    public function federationSuspendPartnership($id): JsonResponse
    {
        $userId = $this->requirePlatformSuperAdmin();

        $partnershipId = (int) $id;

        if ($partnershipId <= 0) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.invalid_partnership_id'), 'id', 400);
        }

        $input = $this->getAllInput();
        $reason = $input['reason'] ?? 'Suspended by super admin via API';

        $result = $this->federationPartnershipService->suspendPartnership($partnershipId, $userId, $reason);

        if (is_array($result) && !empty($result['success'])) {
            return $this->respondWithData(['suspended' => true, 'partnership_id' => $partnershipId]);
        }

        $error = is_array($result) ? ($result['error'] ?? 'Failed to suspend partnership') : 'Failed to suspend partnership';
        return $this->respondWithError(ApiErrorCodes::SERVER_INTERNAL_ERROR, $error, null, 500);
    }

    /** POST /api/v2/admin/super/federation/partnerships/{id}/reactivate */
    public function federationReactivatePartnership($id): JsonResponse
    {
        $userId = $this->requirePlatformSuperAdmin();

        $partnershipId = (int) $id;

        if ($partnershipId <= 0) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.invalid_partnership_id'), 'id', 400);
        }

        $result = $this->federationPartnershipService->reactivatePartnership($partnershipId, $userId);

        if (is_array($result) && !empty($result['success'])) {
            return $this->respondWithData(['reactivated' => true, 'partnership_id' => $partnershipId]);
        }

        $error = is_array($result) ? ($result['error'] ?? __('api.partnership_reactivate_failed')) : __('api.partnership_reactivate_failed');
        return $this->respondWithError(ApiErrorCodes::SERVER_INTERNAL_ERROR, $error, null, 500);
    }

    /** POST /api/v2/super-admin/federation/partnerships/{id}/terminate */
    public function federationTerminatePartnership($id): JsonResponse
    {
        $userId = $this->requirePlatformSuperAdmin();

        $partnershipId = (int) $id;

        if ($partnershipId <= 0) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.invalid_partnership_id'), 'id', 400);
        }

        $input = $this->getAllInput();
        $reason = $input['reason'] ?? 'Terminated by super admin via API';

        $result = $this->federationPartnershipService->terminatePartnership($partnershipId, $userId, $reason);

        if (is_array($result) && !empty($result['success'])) {
            return $this->respondWithData(['terminated' => true, 'partnership_id' => $partnershipId]);
        }

        $error = is_array($result) ? ($result['error'] ?? 'Failed to terminate partnership') : 'Failed to terminate partnership';
        return $this->respondWithError(ApiErrorCodes::SERVER_INTERNAL_ERROR, $error, null, 500);
    }

    /** GET /api/v2/super-admin/federation/tenant/{id}/features */
    public function federationGetTenantFeatures($id): JsonResponse
    {
        $this->requireSuperAdmin();

        $tenantId = (int) $id;

        if ($tenantId <= 0) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.invalid_tenant_id'), 'id', 400);
        }

        $tenant = Tenant::find($tenantId);
        if (!$tenant) {
            return $this->respondWithError(ApiErrorCodes::RESOURCE_NOT_FOUND, __('api.tenant_not_found'), null, 404);
        }

        if (!SuperPanelAccess::canAccessTenant($tenantId)) {
            return $this->respondWithError(ApiErrorCodes::SUPER_PANEL_ACCESS_DENIED, __('api.super_no_access_tenant'), null, 403);
        }

        $features = $this->federationFeatureService->getAllTenantFeatures($tenantId);
        $isWhitelisted = $this->federationFeatureService->isTenantWhitelisted($tenantId);
        $partnerships = $this->federationPartnershipService->getTenantPartnerships($tenantId);

        return $this->respondWithData([
            'tenant' => $tenant,
            'features' => $features,
            'is_whitelisted' => $isWhitelisted,
            'partnerships' => $partnerships,
        ]);
    }

    /** PUT /api/v2/super-admin/federation/tenant/{id}/features */
    public function federationUpdateTenantFeature($id): JsonResponse
    {
        $this->requireSuperAdmin();

        $tenantId = (int) $id;

        if ($tenantId <= 0) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.invalid_tenant_id'), 'id', 400);
        }

        if (!SuperPanelAccess::canAccessTenant($tenantId)) {
            return $this->respondWithError(ApiErrorCodes::SUPER_PANEL_ACCESS_DENIED, __('api.super_no_access_tenant'), null, 403);
        }

        $input = $this->getAllInput();
        $feature = $input['feature'] ?? '';
        $enabled = (bool) ($input['enabled'] ?? false);

        if (empty($feature)) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.feature_name_required'), 'feature', 422);
        }

        if ($enabled) {
            $result = $this->federationFeatureService->enableTenantFeature($feature, $tenantId);
        } else {
            $result = $this->federationFeatureService->disableTenantFeature($feature, $tenantId);
        }

        if ($result) {
            return $this->respondWithData([
                'updated' => true,
                'tenant_id' => $tenantId,
                'feature' => $feature,
                'enabled' => $enabled,
            ]);
        }

        return $this->respondWithError(ApiErrorCodes::SERVER_INTERNAL_ERROR, __('api.feature_update_failed'), null, 500);
    }

    /**
     * PUT /api/v2/admin/super/identity/fee
     *
     * Set the identity verification fee for a tenant. Super admin only.
     * Body: { "tenant_id": 2, "fee_cents": 500 }
     * Set fee_cents to 0 for free verification.
     */
    public function setIdentityVerificationFee(): JsonResponse
    {
        $this->requireSuperAdmin();

        $input = $this->getAllInput();
        $tenantId = (int) ($input['tenant_id'] ?? 0);
        $feeCents = (int) ($input['fee_cents'] ?? -1);

        if ($tenantId <= 0) {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.tenant_id_is_required'), 'tenant_id', 422);
        }
        if ($feeCents < 0) {
            return $this->respondWithError('VALIDATION_INVALID_FORMAT', __('api.fee_cents_non_negative'), 'fee_cents', 422);
        }

        $this->tenantSettingsService->set($tenantId, 'identity_verification_fee_cents', (string) $feeCents, 'integer');

        return $this->respondWithData([
            'tenant_id' => $tenantId,
            'fee_cents' => $feeCents,
            'fee_display' => '€' . number_format($feeCents / 100, 2),
        ]);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Billing
    // ─────────────────────────────────────────────────────────────────────────

    /** GET /api/v2/admin/super/billing/snapshot */
    public function getBillingSnapshot(): JsonResponse
    {
        $userId = $this->requireSuperAdmin();
        $this->requireGod($userId);
        $snapshot = TenantBillingService::getBillingSnapshot();
        return $this->respondWithData($snapshot);
    }

    /** POST /api/v2/admin/super/billing/assign-plan */
    public function assignPlan(): JsonResponse
    {
        $userId = $this->requireSuperAdmin();
        $this->requireGod($userId);
        $input    = $this->getAllInput();
        $tenantId = (int) ($input['tenant_id'] ?? 0);
        $planId   = (int) ($input['pay_plan_id'] ?? 0);
        if ($tenantId < 1 || $planId < 1) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.tenant_and_plan_required'), null, 422);
        }
        if (!DB::selectOne('SELECT id FROM tenants WHERE id = ?', [$tenantId])) {
            return $this->respondWithError('NOT_FOUND', __('api.tenant_not_found'), null, 404);
        }
        if (!DB::selectOne('SELECT id FROM pay_plans WHERE id = ? AND is_active = 1', [$planId])) {
            return $this->respondWithError('NOT_FOUND', __('api.plan_not_found'), null, 404);
        }

        $expiresAt = !empty($input['expires_at']) ? $input['expires_at'] : null;
        $notes     = !empty($input['notes']) ? trim($input['notes']) : null;

        // Pricing overrides and discount.
        $customPriceMonthly = isset($input['custom_price_monthly']) && $input['custom_price_monthly'] !== ''
            ? (float) $input['custom_price_monthly']
            : null;
        $customPriceYearly = isset($input['custom_price_yearly']) && $input['custom_price_yearly'] !== ''
            ? (float) $input['custom_price_yearly']
            : null;
        $discountPct = max(0, min(100, (int) ($input['discount_percentage'] ?? 0)));
        $discountReason = !empty($input['discount_reason']) ? trim($input['discount_reason']) : null;
        $nonprofitVerified = !empty($input['nonprofit_verified']);

        TenantBillingService::assignPlan(
            $tenantId, $planId, $expiresAt, $notes, $userId,
            $customPriceMonthly, $customPriceYearly,
            $discountPct, $discountReason, $nonprofitVerified
        );
        return $this->respondWithData(['assigned' => true]);
    }

    /** GET /api/v2/admin/super/billing/revenue */
    public function getRevenueDashboard(): JsonResponse
    {
        $userId = $this->requireSuperAdmin();
        $this->requireGod($userId);
        return $this->respondWithData(TenantBillingService::getRevenueDashboard());
    }

    /** GET /api/v2/admin/super/billing/export */
    public function exportBillingCsv(): \Illuminate\Http\Response
    {
        $userId = $this->requireSuperAdmin();
        $this->requireGod($userId);
        $csv = TenantBillingService::exportCsv();
        return response($csv, 200, [
            'Content-Type'        => 'text/csv',
            'Content-Disposition' => 'attachment; filename="nexus-billing-' . date('Y-m-d') . '.csv"',
        ]);
    }

    /** POST /api/v2/admin/super/billing/delegate/grant */
    public function grantBillingDelegate(): JsonResponse
    {
        $userId = $this->requireSuperAdmin();
        $this->requireGod($userId);
        $input        = $this->getAllInput();
        $targetUserId = (int) ($input['user_id'] ?? 0);
        $scope        = $input['scope'] ?? '';
        if (!in_array($scope, ['view_billing', 'edit_own_price', 'manage_children'], true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_delegate_scope'), null, 422);
        }
        TenantBillingService::grantDelegate($targetUserId, $scope, $userId);
        return $this->respondWithData(['granted' => true]);
    }

    /** POST /api/v2/admin/super/billing/delegate/revoke */
    public function revokeBillingDelegate(): JsonResponse
    {
        $userId = $this->requireSuperAdmin();
        $this->requireGod($userId);
        $input        = $this->getAllInput();
        $targetUserId = (int) ($input['user_id'] ?? 0);
        $scope        = $input['scope'] ?? '';
        if (!in_array($scope, ['view_billing', 'edit_own_price', 'manage_children'], true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_delegate_scope'), null, 422);
        }
        TenantBillingService::revokeDelegate($targetUserId, $scope, $userId);
        return $this->respondWithData(['revoked' => true]);
    }

    /** POST /api/v2/admin/super/billing/pause */
    public function pauseTenantBilling(): JsonResponse
    {
        $userId   = $this->requireSuperAdmin();
        $this->requireGod($userId);
        $input    = $this->getAllInput();
        $tenantId = (int) ($input['tenant_id'] ?? 0);
        if ($tenantId < 1) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.tenant_id_is_required'), 'tenant_id', 422);
        }
        TenantBillingService::pauseBilling($tenantId, $userId);
        return $this->respondWithData(['paused' => true, 'tenant_id' => $tenantId]);
    }

    /** POST /api/v2/admin/super/billing/resume */
    public function resumeTenantBilling(): JsonResponse
    {
        $userId   = $this->requireSuperAdmin();
        $this->requireGod($userId);
        $input    = $this->getAllInput();
        $tenantId = (int) ($input['tenant_id'] ?? 0);
        if ($tenantId < 1) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.tenant_id_is_required'), 'tenant_id', 422);
        }
        TenantBillingService::resumeBilling($tenantId, $userId);
        return $this->respondWithData(['resumed' => true, 'tenant_id' => $tenantId]);
    }

    /** POST /api/v2/admin/super/billing/grace-period */
    public function setBillingGracePeriod(): JsonResponse
    {
        $userId   = $this->requireSuperAdmin();
        $this->requireGod($userId);
        $input    = $this->getAllInput();
        $tenantId = (int) ($input['tenant_id'] ?? 0);
        $days     = (int) ($input['days'] ?? 0);
        if ($tenantId < 1) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.tenant_id_is_required'), 'tenant_id', 422);
        }
        if ($days < 1 || $days > 365) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.grace_period_days_invalid'), 'days', 422);
        }
        TenantBillingService::setGracePeriod($tenantId, $days, $userId);
        return $this->respondWithData(['grace_period_set' => true, 'tenant_id' => $tenantId, 'days' => $days]);
    }
}
