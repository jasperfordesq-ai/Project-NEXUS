<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\User;
use App\Models\Notification;
use App\Models\ActivityLog;
use App\Services\AuditLogService;
use App\Services\EmailDispatchService;
use App\Services\Enterprise\GdprService;
use App\Services\GamificationService;
use App\Services\PasswordHistoryService;
use App\Services\StartingBalanceService;
use App\Services\TenantSettingsService;
use App\Services\TokenService;
use App\Core\EmailTemplateBuilder;
use Illuminate\Support\Facades\Log;

/**
 * AdminUsersController — Admin user management (list, view, create, update, approve, suspend, ban, etc.).
 *
 * All methods require admin authentication.
 * Fully converted to direct service/DB calls — no legacy delegation.
 */
class AdminUsersController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly GamificationService $gamificationService,
        private readonly GdprService $gdprService,
        private readonly TenantSettingsService $tenantSettingsService,
        private readonly TokenService $tokenService,
        private readonly AuditLogService $auditLogService,
    ) {}

    // =========================================================================
    // List & Show
    // =========================================================================

    /** GET /api/v2/admin/users */
    public function index(): JsonResponse
    {
        $this->requireBrokerOrAdmin();
        $tenantId = $this->getTenantId();

        $page = $this->queryInt('page', 1, 1);
        $limit = $this->queryInt('limit', 20, 1, 100);
        $offset = ($page - 1) * $limit;
        $status = $this->query('status');
        $search = $this->query('search');
        $role = $this->query('role');
        $sort = $this->query('sort', 'created_at');
        $order = strtoupper($this->query('order', 'DESC')) === 'ASC' ? 'ASC' : 'DESC';

        $allowedSorts = ['name', 'email', 'role', 'created_at', 'balance', 'status'];
        if (!in_array($sort, $allowedSorts, true)) {
            $sort = 'created_at';
        }

        $conditions = ['u.tenant_id = ?'];
        $params = [$tenantId];

        if ($status && $status !== 'all') {
            switch ($status) {
                case 'pending':
                    $conditions[] = 'u.is_approved = 0';
                    break;
                case 'active':
                    $conditions[] = "u.is_approved = 1 AND (u.status IS NULL OR u.status = 'active')";
                    break;
                case 'suspended':
                    $conditions[] = "u.status = 'suspended'";
                    break;
                case 'banned':
                    $conditions[] = "u.status = 'banned'";
                    break;
                case 'never_logged_in':
                    $conditions[] = 'u.is_approved = 1 AND u.last_login_at IS NULL';
                    break;
                case 'onboarding_incomplete':
                    $conditions[] = 'u.is_approved = 1 AND (u.onboarding_completed = 0 OR u.onboarding_completed IS NULL)';
                    break;
            }
        }

        if ($role) {
            $conditions[] = 'u.role = ?';
            $params[] = $role;
        }

        if ($search) {
            $searchTerm = '%' . addcslashes($search, '%_') . '%';
            $searchConditions = [
                'u.first_name LIKE ?',
                'u.last_name LIKE ?',
                'u.email LIKE ?',
                'u.username LIKE ?',
                'u.phone LIKE ?',
                'u.location LIKE ?',
                'u.organization_name LIKE ?',
                "CONCAT(u.first_name, ' ', u.last_name) LIKE ?",
            ];
            $params = array_merge($params, array_fill(0, count($searchConditions), $searchTerm));

            if (ctype_digit((string) $search)) {
                $searchConditions[] = 'u.id = ?';
                $params[] = (int) $search;
            }

            $conditions[] = '(' . implode(' OR ', $searchConditions) . ')';
        }

        // Safety: $where is built exclusively from hardcoded SQL fragments above.
        // All user values are bound via parameterised ? placeholders in $params.
        // No user input is ever interpolated directly into the SQL string.
        $where = implode(' AND ', $conditions);

        // Safety: $sortColumn is resolved from a whitelist map — never raw user input.
        // $order is sanitised to 'ASC'|'DESC' via the ternary on line above (strtoupper check).
        $sortColumnMap = [
            'name' => 'name',
            'email' => 'u.email',
            'role' => 'u.role',
            'created_at' => 'u.created_at',
            'balance' => 'COALESCE(u.balance, 0)',
            'status' => "CASE WHEN u.is_approved = 0 THEN 'pending' WHEN u.status = 'suspended' THEN 'suspended' WHEN u.status = 'banned' THEN 'banned' ELSE 'active' END",
        ];
        $sortColumn = $sortColumnMap[$sort] ?? 'u.created_at';

        $total = (int) DB::selectOne("SELECT COUNT(*) as cnt FROM users u WHERE {$where}", $params)->cnt;

        $users = DB::select(
            "SELECT u.id, u.first_name, u.last_name,
                CASE
                    WHEN u.profile_type = 'organisation' AND u.organization_name IS NOT NULL AND u.organization_name != ''
                        THEN u.organization_name
                    ELSE CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))
                END as name,
                u.email, u.email_verified_at, u.avatar_url, u.location, u.role, u.is_approved, u.is_super_admin, u.is_tenant_super_admin,
                u.status, u.created_at, u.last_active_at, u.last_login_at, u.onboarding_completed, u.profile_type, u.organization_name,
                u.tenant_id,
                t.name as tenant_name,
                COALESCE(u.balance, 0) as balance,
                (SELECT COUNT(*) FROM listings l WHERE l.user_id = u.id AND l.status = 'active') as listing_count
             FROM users u
             LEFT JOIN tenants t ON u.tenant_id = t.id
             WHERE {$where}
             ORDER BY {$sortColumn} {$order}
             LIMIT ? OFFSET ?",
            array_merge($params, [$limit, $offset])
        );

        $formatted = array_map(function ($row) {
            $status = $this->formatAdminUserStatus($row->status ?? null, $row->is_approved ?? null);

            return [
                'id' => (int) $row->id,
                'name' => trim($row->name),
                'first_name' => $row->first_name ?? '',
                'last_name' => $row->last_name ?? '',
                'email' => $row->email,
                'email_verified_at' => $row->email_verified_at ?? null,
                'avatar_url' => $row->avatar_url ?? null,
                'location' => $row->location ?? null,
                'role' => $row->role ?? 'member',
                'status' => $status,
                'is_super_admin' => (bool) ($row->is_super_admin ?? false),
                'is_tenant_super_admin' => (bool) ($row->is_tenant_super_admin ?? false),
                'balance' => (float) ($row->balance ?? 0),
                'listing_count' => (int) ($row->listing_count ?? 0),
                'profile_type' => $row->profile_type ?? 'individual',
                'tenant_id' => (int) $row->tenant_id,
                'tenant_name' => $row->tenant_name ?? 'Unknown',
                'has_2fa_enabled' => false,
                'created_at' => $row->created_at,
                'last_active_at' => $row->last_active_at ?? null,
                'last_login_at' => $row->last_login_at ?? null,
                'onboarding_completed' => (bool) ($row->onboarding_completed ?? false),
            ];
        }, $users);

        return $this->respondWithPaginatedCollection($formatted, $total, $page, $limit);
    }

    /** GET /api/v2/admin/users/{id} */
    public function show(int $id): JsonResponse
    {
        $this->requireBrokerOrAdmin();
        $tenantId = $this->getTenantId();

        $user = DB::selectOne(
            "SELECT u.id, u.first_name, u.last_name, u.email, u.avatar_url, u.location, u.bio, u.tagline, u.phone,
                    u.role, u.status, u.is_approved, u.is_super_admin, u.is_god, u.is_tenant_super_admin, u.balance, u.profile_type,
                    u.organization_name, u.insurance_status, u.created_at, u.last_active_at,
                    u.email_verified_at, u.is_verified, u.date_of_birth,
                    u.tenant_id, t.name as tenant_name
             FROM users u
             LEFT JOIN tenants t ON u.tenant_id = t.id
             WHERE u.id = ? AND u.tenant_id = ?",
            [$id, $tenantId]
        );

        if (!$user) {
            return $this->respondWithError('NOT_FOUND', __('api.user_not_found'), null, 404);
        }

        $status = $this->formatAdminUserStatus($user->status ?? null, $user->is_approved ?? null);

        $badges = [];
        try {
            $badgeRows = DB::select(
                "SELECT ub.id, ub.badge_key, ub.awarded_at,
                        COALESCE(b.name, ub.name, NULLIF(ub.title, ''), ub.badge_key) AS badge_name,
                        COALESCE(b.description, '') AS badge_description,
                        COALESCE(b.icon, ub.icon) AS badge_icon
                 FROM user_badges ub
                 LEFT JOIN badges b ON b.badge_key = ub.badge_key AND b.tenant_id = ub.tenant_id
                 WHERE ub.user_id = ? AND ub.tenant_id = ?
                 ORDER BY ub.awarded_at DESC",
                [$id, $tenantId]
            );
            $badges = array_map(fn($b) => [
                'id' => (int) $b->id,
                'name' => $b->badge_name ?? $b->badge_key ?? '',
                'slug' => $b->badge_key ?? '',
                'description' => $b->badge_description ?? '',
                'icon' => $b->badge_icon ?? null,
                'awarded_at' => $b->awarded_at ?? '',
            ], $badgeRows);
        } catch (\Throwable $e) { Log::warning('Stats query failed in ' . __METHOD__, ['error' => $e->getMessage()]); }

        $roles = [];
        try {
            $roleRows = DB::select(
                "SELECT r.name FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = ? AND ur.tenant_id = ?",
                [$id, $tenantId]
            );
            $roles = array_column(array_map(fn($r) => ['name' => $r->name], $roleRows), 'name');
        } catch (\Throwable $e) { Log::warning('Roles query failed in ' . __METHOD__, ['error' => $e->getMessage()]); }

        return $this->respondWithData([
            'id' => (int) $user->id,
            'name' => trim(($user->first_name ?? '') . ' ' . ($user->last_name ?? '')),
            'first_name' => $user->first_name ?? '',
            'last_name' => $user->last_name ?? '',
            'email' => $user->email,
            'avatar_url' => $user->avatar_url ?? null,
            'location' => $user->location ?? null,
            'bio' => $user->bio ?? null,
            'tagline' => $user->tagline ?? null,
            'phone' => $user->phone ?? null,
            'role' => $user->role ?? 'member',
            'status' => $status,
            'is_super_admin' => (bool) ($user->is_super_admin ?? false),
            'is_god' => (bool) ($user->is_god ?? false),
            'is_tenant_super_admin' => (bool) ($user->is_tenant_super_admin ?? false),
            'is_admin' => in_array($user->role ?? '', ['admin', 'tenant_admin']),
            'balance' => (float) ($user->balance ?? 0),
            'profile_type' => $user->profile_type ?? 'individual',
            'organization_name' => $user->organization_name ?? null,
            'tenant_id' => (int) $user->tenant_id,
            'tenant_name' => $user->tenant_name ?? 'Unknown',
            'badges' => $badges,
            'is_approved' => (bool) ($user->is_approved ?? false),
            'email_verified_at' => $user->email_verified_at ?? null,
            'is_verified' => (bool) ($user->is_verified ?? false),
            'insurance_status' => $user->insurance_status ?? 'none',
            'created_at' => $user->created_at,
            'last_active_at' => $user->last_active_at ?? null,
            'roles' => $roles,
        ]);
    }

    // =========================================================================
    // Update
    // =========================================================================

    /** PUT /api/v2/admin/users/{id} */
    public function update(int $id): JsonResponse
    {
        $adminId = $this->requireBrokerOrAdmin();
        $tenantId = $this->getTenantId();

        $user = User::findById($id, true);
        if (!$user || $user['tenant_id'] != $tenantId) {
            return $this->respondWithError('NOT_FOUND', __('api.user_not_found'), null, 404);
        }
        $input = $this->getAllInput();

        // Profile edits may be delegated, but changing an account's identity,
        // role, or lifecycle state is a security mutation. A tenant admin must
        // never be able to redirect password recovery for a peer/higher-tier
        // administrator by replacing that account's email address.
        $requiresSecurityAuthorization = false;
        foreach (['email', 'role', 'status'] as $securityField) {
            if (
                array_key_exists($securityField, $input)
                && !$this->canManageSecurityTarget($adminId, $user)
            ) {
                return $this->respondWithError(
                    'AUTH_INSUFFICIENT_PERMISSIONS',
                    __('api.insufficient_permissions'),
                    $securityField,
                    403
                );
            }
            $requiresSecurityAuthorization = $requiresSecurityAuthorization
                || array_key_exists($securityField, $input);
        }

        // SECURITY: brokers/coordinators may edit only non-privileged profile
        // fields. Role, status, email, profile type and organisation identity
        // stay admin-only so a broker can never escalate privileges, ban a
        // member, or change an identity via this endpoint. Admin-tier callers
        // retain full access. See tests/Laravel/Feature/Controllers/
        // BrokerUserActionsAuthorizationTest.php.
        if (!$this->callerIsAdminTier()) {
            $brokerReservedFields = ['role', 'status', 'email', 'profile_type', 'organization_name'];
            foreach ($brokerReservedFields as $reserved) {
                if (array_key_exists($reserved, $input)) {
                    return $this->respondWithError('AUTH_INSUFFICIENT_PERMISSIONS', __('api.broker_cannot_edit_field'), $reserved, 403);
                }
            }
        }

        $updates = [];
        $params = [];
        $statusForNotification = null;

        // SECURITY: Restrict role values to prevent privilege escalation (SEC-007)
        $allowedRoles = ['member', 'admin', 'broker'];
        // tenant_admin has been merged into admin and is no longer an assignable
        // role. Tenant super-admin is granted via the dedicated toggle
        // (PUT /v2/admin/users/{id}/super-admin); super_admin/god via their own
        // endpoints. Reject all three as role-field assignment targets.
        if (isset($input['role']) && in_array($input['role'], ['tenant_admin', 'super_admin', 'god'], true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.use_super_admin_endpoints'), 'role', 422);
        }

        $fieldMap = ['first_name', 'last_name', 'email', 'role', 'location', 'phone', 'bio', 'tagline', 'organization_name'];
        foreach ($fieldMap as $field) {
            if (isset($input[$field])) {
                $value = is_string($input[$field]) ? trim($input[$field]) : $input[$field];
                if ($field === 'email' && !filter_var($value, FILTER_VALIDATE_EMAIL)) {
                    return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_email'), 'email', 422);
                }
                // SECURITY: Validate role against allowed values
                if ($field === 'role' && !in_array($value, $allowedRoles, true)) {
                    return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_role'), 'role', 422);
                }
                $updates[] = "{$field} = ?";
                $params[] = $value;
            }
        }

        if (isset($input['profile_type']) && in_array($input['profile_type'], ['individual', 'organisation'])) {
            $updates[] = 'profile_type = ?';
            $params[] = $input['profile_type'];
        }

        $approvingViaStatusChange = false;
        if (array_key_exists('status', $input)) {
            $newStatus = is_string($input['status']) ? trim($input['status']) : $input['status'];
            if (!in_array($newStatus, ['active', 'pending', 'suspended', 'banned'], true)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_status'), 'status', 422);
            }
            $updates[] = 'status = ?';
            $params[] = $newStatus;
            $statusForNotification = $newStatus;
            if ($newStatus === 'active') {
                $updates[] = 'is_approved = 1';
                // Detect first-time approval via the generic update path (pending → active)
                // so we can grant welcome credits and send the approval email below.
                if (empty($user['is_approved'])) {
                    $approvingViaStatusChange = true;
                }
            } elseif ($newStatus === 'pending') {
                $updates[] = 'is_approved = 0';
            }
        }

        if (empty($updates)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.no_fields_to_update'), null, 422);
        }

        // Capture old status before the update for change detection
        $oldStatus = $this->formatAdminUserStatus($user['status'] ?? null, $user['is_approved'] ?? null);

        $params[] = $id;
        $params[] = $tenantId;

        if ($requiresSecurityAuthorization) {
            $updated = DB::transaction(function () use ($adminId, $id, $tenantId, $updates, $params): bool {
                if ($this->lockManageableSecurityTarget($adminId, $id, $tenantId) === null) {
                    return false;
                }

                DB::update(
                    "UPDATE users SET " . implode(', ', $updates) . " WHERE id = ? AND tenant_id = ?",
                    $params
                );
                return true;
            }, 3);
            if (!$updated) {
                return $this->respondWithError(
                    'AUTH_INSUFFICIENT_PERMISSIONS',
                    __('api.insufficient_permissions'),
                    null,
                    403
                );
            }
        } else {
            DB::update("UPDATE users SET " . implode(', ', $updates) . " WHERE id = ? AND tenant_id = ?", $params);
        }

        ActivityLog::log($adminId, 'admin_update_user', "Updated user #{$id}");
        $this->auditLogService->logUserUpdated($adminId, $id, array_keys($input));

        // If this update is effectively an approval (pending → active), grant welcome credits
        // and send the approval welcome email — same as the dedicated /approve endpoint.
        if ($approvingViaStatusChange) {
            ActivityLog::log($adminId, 'admin_approve_user', "Approved user #{$id} ({$user['email']}) via status change");
            $this->auditLogService->logUserApproved($adminId, $id, $user['email']);
            $creditsAwarded = $this->grantWelcomeCredits($user, $adminId);
            $this->sendApprovalWelcomeEmail($user, $creditsAwarded);
            $this->sendApprovalInAppNotification($user, $creditsAwarded);
        }

        if (isset($input['role']) && ($user['role'] ?? 'member') !== $input['role']) {
            $this->auditLogService->logAdminRoleChanged($adminId, $id, $user['role'] ?? 'member', $input['role']);
        }

        // Notify user when status changes to suspended/banned via the generic update path
        // (The dedicated suspend()/ban() endpoints have their own richer notifications)
        if ($statusForNotification !== null && $statusForNotification !== $oldStatus) {
            try {
                $recipientLocale = $user['preferred_language'] ?? null;
                if ($statusForNotification === 'suspended') {
                    LocaleContext::withLocale($recipientLocale, function () use ($id) {
                        Notification::createNotification(
                            $id,
                            __('api_controllers_3.admin_bells.account_suspended'),
                            null,
                            'system',
                            true
                        );
                        \App\Services\NotificationDispatcher::fanOutPush((int) $id, 'system', __('api_controllers_3.admin_bells.account_suspended'), null);
                    });
                } elseif ($statusForNotification === 'banned') {
                    LocaleContext::withLocale($recipientLocale, function () use ($id) {
                        Notification::createNotification(
                            $id,
                            __('api_controllers_3.admin_bells.account_banned'),
                            null,
                            'system',
                            true
                        );
                        \App\Services\NotificationDispatcher::fanOutPush((int) $id, 'system', __('api_controllers_3.admin_bells.account_banned'), null);
                    });
                }
            } catch (\Throwable $e) {
                Log::warning("AdminUsersController::update status notification failed for user #{$id}: " . $e->getMessage());
            }
        }

        return $this->show($id);
    }

    private function formatAdminUserStatus(mixed $rawStatus, mixed $isApproved): string
    {
        $status = is_string($rawStatus) ? $rawStatus : '';
        if (in_array($status, ['banned', 'suspended'], true)) {
            return $status;
        }
        if ($status === 'pending' || !$isApproved) {
            return 'pending';
        }
        return 'active';
    }

    // =========================================================================
    // Create
    // =========================================================================

    /** POST /api/v2/admin/users */
    public function store(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $input = $this->getAllInput();

        $firstName = trim($input['first_name'] ?? '');
        $lastName = trim($input['last_name'] ?? '');
        $email = trim($input['email'] ?? '');
        $password = $input['password'] ?? '';
        $role = $input['role'] ?? 'member';
        $location = trim($input['location'] ?? '');

        // SECURITY: Restrict role to prevent privilege escalation via user creation (SEC-009)
        $allowedRoles = ['member', 'admin', 'broker'];
        // tenant_admin is no longer assignable (merged into admin); tenant
        // super-admin is granted post-creation via the dedicated super-admin toggle.
        if (!in_array($role, $allowedRoles, true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_role_allowed', ['roles' => implode(', ', $allowedRoles)]), 'role', 422);
        }

        // Auto-generate password if not provided
        if (empty($password)) {
            $password = bin2hex(random_bytes(12));
        }

        // Validation
        $errors = [];
        if (empty($firstName)) {
            $errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.first_name_required'), 'field' => 'first_name'];
        }
        if (empty($lastName)) {
            $errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.last_name_required'), 'field' => 'last_name'];
        }
        if (empty($email) || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.valid_email_required'), 'field' => 'email'];
        }
        if (strlen($password) < 8) {
            $errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.password_min_length'), 'field' => 'password'];
        }

        if (!empty($errors)) {
            return $this->respondWithErrors($errors, 422);
        }

        // Check duplicate email
        $existing = User::findByEmail($email);
        if ($existing) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.email_already_exists'), 'email', 422);
        }

        // Create user via createWithTenant (direct DB insert, not Eloquent::create)
        $newUserId = User::createWithTenant([
            'first_name' => $firstName,
            'last_name' => $lastName,
            'email' => $email,
            'password' => $password,
            'location' => $location ?: null,
            'role' => $role,
            'is_approved' => 1,
        ], $tenantId);

        if (!$newUserId) {
            return $this->respondWithError('SERVER_ERROR', __('api.user_created_failed'), null, 500);
        }

        ActivityLog::log($adminId, 'admin_create_user', "Created user: {$email}");
        $this->auditLogService->logUserCreated($adminId, $newUserId, $email);

        // Admin-created accounts are active immediately and never pass through
        // the approval flow, so grant the tenant-configured starting balance
        // here (wallet.starting_balance / legacy general.welcome_credits).
        // Idempotent and non-fatal — a wallet failure must never fail creation.
        try {
            StartingBalanceService::applyToNewUser((int) $newUserId);
        } catch (\Throwable $e) {
            Log::warning("[AdminUsers] Starting balance grant failed for admin-created user #{$newUserId}: " . $e->getMessage());
        }

        // Record GDPR consents (admin-created accounts)
        try {
            $consentText = "Account created by administrator. User agrees to Terms of Service and Privacy Policy upon first login.";
            $consentVersion = '1.0';
            $this->gdprService->recordConsent($newUserId, 'terms_of_service', true, $consentText, $consentVersion);
            $this->gdprService->recordConsent($newUserId, 'privacy_policy', true, $consentText, $consentVersion);
        } catch (\Throwable $e) {
            Log::warning('[AdminUsers] GDPR consent recording failed for admin-created user: ' . $e->getMessage());
        }

        // Send welcome email if requested. The newly-created user has no
        // preferred_language preference yet, so this renders in the app default
        // (English). Locale-switch to the new user's row for consistency so future
        // preference changes flow through automatically via findById.
        $sendWelcomeEmail = !empty($input['send_welcome_email']);
        if ($sendWelcomeEmail) {
            try {
                $newUser = User::findById($newUserId, true);
                LocaleContext::withLocale($newUser['preferred_language'] ?? null, function () use ($email, $password, $tenantId) {
                    $tenant = TenantContext::get();
                    $tenantName = $tenant['name'] ?? 'Project NEXUS';
                    $loginLink = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . "/login";

                    $html = EmailTemplateBuilder::make()
                        ->title(__('emails_misc.admin_actions.welcome_created_title'))
                        ->previewText(__('emails_misc.admin_actions.welcome_created_preview'))
                        ->greeting(__('emails_misc.admin_actions.welcome_created_greeting', ['community' => $tenantName]))
                        ->paragraph(__('emails_misc.admin_actions.welcome_created_body_intro', ['community' => $tenantName]))
                        ->paragraph(__('emails_misc.admin_actions.welcome_created_body_credentials'))
                        // infoCard escapes at render — pre-escaping corrupted
                        // displayed passwords containing & ' < (user would
                        // copy-paste a broken credential).
                        ->infoCard([
                            __('emails_misc.admin_actions.welcome_created_info_email')    => $email,
                            __('emails_misc.admin_actions.welcome_created_info_password') => $password,
                        ])
                        ->paragraph(__('emails_misc.admin_actions.welcome_created_body_change_pass'))
                        ->button(__('emails_misc.admin_actions.welcome_created_cta'), $loginLink)
                        ->render();

                    if (!EmailDispatchService::sendRaw($email, __('emails_misc.admin_actions.welcome_created_subject', ['community' => $tenantName]), $html, null, null, null, 'admin_welcome', ['tenant_id' => $tenantId])) {
                        Log::warning('[AdminUsers] Welcome email returned false for admin-created user', [
                            'email' => $email,
                        ]);
                    }
                });
            } catch (\Throwable $e) {
                Log::warning('[AdminUsers] Welcome email failed for admin-created user: ' . $e->getMessage());
            }
        }

        return $this->respondWithData([
            'id' => $newUserId,
            'name' => trim($firstName . ' ' . $lastName),
            'email' => $email,
            'role' => $role,
            'status' => 'active',
        ], null, 201);
    }

    // =========================================================================
    // Approve
    // =========================================================================

    /** POST /api/v2/admin/users/{id}/approve */
    /**
     * POST /api/v2/admin/users/{id}/reject
     *
     * Reject a PENDING registration, with a mandatory reason.
     *
     * 🔴 There was no way to do this. A community could approve, suspend, ban or
     * hard-delete a pending applicant and nothing else — so in practice a
     * registration was declined by leaving it pending forever, invisibly and
     * unreasoned, or by banning someone who had never been a member. `users` had no
     * `rejection_reason` column at all, so even suspension and ban reasons survived
     * only as free text inside an audit blob.
     *
     * Modelled on ListingModerationService::reject(), which has enforced a non-empty
     * reason at the service layer for years. The reason is stored on the row (not
     * only in a log), the actor and time are recorded, and the applicant is told —
     * in their own language — so a decision is never silently absorbed.
     *
     * Deliberately reversible: `approve()` clears the rejection, so a community can
     * change its mind without the applicant having to register again.
     */
    public function reject(int $id): JsonResponse
    {
        $adminId = $this->requireBrokerOrAdmin();
        $tenantId = $this->getTenantId();

        $reason = trim((string) $this->input('reason', ''));
        if ($reason === '') {
            return $this->respondWithError('VALIDATION_ERROR', __('api.reason_required'), 'reason');
        }

        $user = User::findById($id, true);
        if (!$user || $user['tenant_id'] != $tenantId) {
            return $this->respondWithError('NOT_FOUND', __('api.user_not_found'), null, 404);
        }
        if (!$this->canManageSecurityTarget($adminId, $user)) {
            return $this->respondWithError('AUTH_INSUFFICIENT_PERMISSIONS', __('api.insufficient_permissions'), null, 403);
        }

        $outcome = DB::transaction(function () use ($adminId, $id, $tenantId, $reason): array {
            $target = $this->lockManageableSecurityTarget($adminId, $id, $tenantId);
            if ($target === null) {
                return ['status' => 'denied'];
            }

            // Only a pending applicant can be rejected. An already-approved member
            // is suspended or banned instead — those are different decisions with
            // different consequences, and conflating them would let "reject" be used
            // to quietly remove an active member.
            if (!empty($target['is_approved']) || (string) ($target['status'] ?? '') !== 'pending') {
                return ['status' => 'not_pending'];
            }

            DB::update(
                "UPDATE users
                    SET status = 'rejected',
                        is_approved = 0,
                        rejection_reason = ?,
                        rejected_at = NOW(),
                        rejected_by = ?,
                        updated_at = NOW()
                  WHERE id = ? AND tenant_id = ?",
                [mb_substr($reason, 0, 500), $adminId, $id, $tenantId]
            );

            return ['status' => 'rejected', 'user' => $target];
        }, 3);

        if (($outcome['status'] ?? null) === 'denied') {
            return $this->respondWithError('AUTH_INSUFFICIENT_PERMISSIONS', __('api.insufficient_permissions'), null, 403);
        }
        if (($outcome['status'] ?? null) === 'not_pending') {
            return $this->respondWithError('INVALID_STATUS', __('api.invalid_status'), null, 400);
        }

        $target = $outcome['user'];

        ActivityLog::log($adminId, 'admin_reject_user', "Rejected user #{$id} ({$target['email']}): {$reason}");
        $this->auditLogService->logAction(
            $tenantId,
            'member_registration_rejected',
            $adminId,
            ['reason' => $reason, 'email' => $target['email'] ?? null],
            null,
            $id,
        );

        // Tell the applicant, in their own language. A rejection the person never
        // hears about is indistinguishable from being ignored.
        //
        // NB: pass the locale STRING, not the row. withLocale() accepts
        // string|object|null — handing it the array from findById()/the locked
        // target raises a TypeError which the catch below would swallow, silently
        // losing the notification. `preferred_language` comes from
        // User::findByIdSelectColumns(), which includes it precisely so
        // notification paths can honour the recipient's language.
        try {
            LocaleContext::withLocale($user['preferred_language'] ?? null, function () use ($id, $reason) {
                Notification::createNotification(
                    $id,
                    __('api_controllers_2.registration.rejected_notice', ['reason' => $reason]),
                    '/contact',
                    'system',
                );
            });
        } catch (\Throwable $e) {
            Log::warning('Failed to notify rejected applicant', ['user_id' => $id, 'error' => $e->getMessage()]);
        }

        return $this->respondWithData(['rejected' => true, 'id' => $id]);
    }

    public function approve(int $id): JsonResponse
    {
        $adminId = $this->requireBrokerOrAdmin();
        $tenantId = $this->getTenantId();

        $user = User::findById($id, true);
        if (!$user || $user['tenant_id'] != $tenantId) {
            return $this->respondWithError('NOT_FOUND', __('api.user_not_found'), null, 404);
        }
        if (!$this->canManageSecurityTarget($adminId, $user)) {
            return $this->respondWithError('AUTH_INSUFFICIENT_PERMISSIONS', __('api.insufficient_permissions'), null, 403);
        }

        $approval = DB::transaction(function () use ($adminId, $id, $tenantId): array {
            $target = $this->lockManageableSecurityTarget($adminId, $id, $tenantId);
            if ($target === null) {
                return ['status' => 'denied'];
            }

            // Idempotency: prevent double-approval (and double welcome credits).
            // Still lift a leftover pending status from the pre-fix path.
            if (!empty($target['is_approved'])) {
                $this->activatePendingStatus($id, $tenantId);
                return ['status' => 'already_approved', 'user' => $target];
            }

            User::updateAdminFields($id, [
                'role' => $target['role'] ?? 'member',
                'is_approved' => 1,
                'tenant_id' => $tenantId,
            ]);
            // Approving clears any earlier rejection, so a community can change its
            // mind without the applicant having to register again. Also lifts a
            // 'rejected' status, which activatePendingStatus() only handles for
            // 'pending'.
            DB::update(
                "UPDATE users
                    SET rejection_reason = NULL, rejected_at = NULL, rejected_by = NULL,
                        status = CASE WHEN status = 'rejected' THEN 'active' ELSE status END,
                        updated_at = NOW()
                  WHERE id = ? AND tenant_id = ?",
                [$id, $tenantId]
            );
            $this->activatePendingStatus($id, $tenantId);
            return ['status' => 'approved', 'user' => $target];
        }, 3);
        if (($approval['status'] ?? null) === 'denied') {
            return $this->respondWithError('AUTH_INSUFFICIENT_PERMISSIONS', __('api.insufficient_permissions'), null, 403);
        }
        if (($approval['status'] ?? null) === 'already_approved') {
            return $this->respondWithData(['approved' => true, 'id' => $id, 'already_approved' => true]);
        }
        $user = $approval['user'];

        ActivityLog::log($adminId, 'admin_approve_user', "Approved user #{$id} ({$user['email']})");
        $this->auditLogService->logUserApproved($adminId, $id, $user['email']);

        // Grant welcome credits + send combined welcome email + in-app notification
        $creditsAwarded = $this->grantWelcomeCredits($user, $adminId);
        $emailSent = $this->sendApprovalWelcomeEmail($user, $creditsAwarded);
        $this->sendApprovalInAppNotification($user, $creditsAwarded);

        return $this->respondWithData([
            'approved' => true,
            'id' => $id,
            'email_sent' => $emailSent,
            'welcome_credits' => $creditsAwarded,
        ]);
    }

    /**
     * Approval must also lift a registration-pending status: the login gate
     * rejects status='pending' before it ever reads is_approved, so setting
     * is_approved alone sends the welcome email while leaving the member
     * locked out.
     */
    private function activatePendingStatus(int $userId, int $tenantId): void
    {
        DB::update(
            "UPDATE users SET status = 'active' WHERE id = ? AND tenant_id = ? AND LOWER(TRIM(status)) = 'pending'",
            [$userId, $tenantId]
        );
    }

    // =========================================================================
    // Status Changes
    // =========================================================================

    /** POST /api/v2/admin/users/{id}/suspend */
    public function suspend($id): JsonResponse
    {
        $adminId = $this->requireBrokerOrAdmin();
        $tenantId = $this->getTenantId();
        $id = (int) $id;

        if ($id === $adminId) {
            return $this->respondWithError('AUTH_INSUFFICIENT_PERMISSIONS', __('api.cannot_suspend_own_account'), null, 403);
        }

        $user = User::findById($id, true);
        if (!$user || $user['tenant_id'] != $tenantId) {
            return $this->respondWithError('NOT_FOUND', __('api.user_not_found'), null, 404);
        }

        if (!$this->canManageSecurityTarget($adminId, $user)) {
            return $this->respondWithError('AUTH_INSUFFICIENT_PERMISSIONS', __('api.insufficient_permissions'), null, 403);
        }

        $reason = $this->input('reason', __('svc_notifications.suspended_by_admin'));

        $lockedUser = DB::transaction(function () use ($adminId, $id, $tenantId): ?array {
            $target = $this->lockManageableSecurityTarget($adminId, $id, $tenantId);
            if ($target === null) {
                return null;
            }
            DB::update("UPDATE users SET status = 'suspended' WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
            return $target;
        }, 3);
        if ($lockedUser === null) {
            return $this->respondWithError('AUTH_INSUFFICIENT_PERMISSIONS', __('api.insufficient_permissions'), null, 403);
        }
        $user = $lockedUser;

        ActivityLog::log($adminId, 'admin_suspend_user', "Suspended user #{$id}: {$reason}");
        $this->auditLogService->logUserSuspended($adminId, $id, $reason);

        $this->notifySuspendedUser($user, $id);

        return $this->respondWithData(['suspended' => true, 'id' => $id]);
    }

    /** POST /api/v2/admin/users/{id}/ban */
    public function ban($id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $id = (int) $id;

        if ($id === $adminId) {
            return $this->respondWithError('AUTH_INSUFFICIENT_PERMISSIONS', __('api.cannot_ban_own_account'), null, 403);
        }

        $user = User::findById($id, true);
        if (!$user || $user['tenant_id'] != $tenantId) {
            return $this->respondWithError('NOT_FOUND', __('api.user_not_found'), null, 404);
        }

        if (!$this->canManageSecurityTarget($adminId, $user)) {
            return $this->respondWithError('AUTH_INSUFFICIENT_PERMISSIONS', __('api.insufficient_permissions'), null, 403);
        }

        $reason = $this->input('reason', __('svc_notifications.banned_by_admin'));

        $lockedUser = DB::transaction(function () use ($adminId, $id, $tenantId): ?array {
            $target = $this->lockManageableSecurityTarget($adminId, $id, $tenantId);
            if ($target === null) {
                return null;
            }
            DB::update("UPDATE users SET status = 'banned' WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
            return $target;
        }, 3);
        if ($lockedUser === null) {
            return $this->respondWithError('AUTH_INSUFFICIENT_PERMISSIONS', __('api.insufficient_permissions'), null, 403);
        }
        $user = $lockedUser;

        ActivityLog::log($adminId, 'admin_ban_user', "Banned user #{$id}: {$reason}");
        $this->auditLogService->logUserBanned($adminId, $id, $reason);

        // Notify the banned user (email only — they can't log in at all)
        try {
            LocaleContext::withLocale($user['preferred_language'] ?? null, function () use ($user, $id) {
                $tenant = $this->resolveUserTenant($user);
                $firstName = htmlspecialchars($user['first_name'] ?? __('emails.common.fallback_name'), ENT_QUOTES, 'UTF-8');
                $tenantName = $tenant['name'];

                $html = EmailTemplateBuilder::make()
                    ->theme('danger')
                    ->greeting(__('emails_misc.admin_actions.ban_greeting', ['name' => $firstName]))
                    ->paragraph(__('emails_misc.admin_actions.ban_body', ['community' => $tenantName]))
                    ->paragraph(__('emails_misc.admin_actions.ban_help'))
                    ->render();

                if (!EmailDispatchService::sendRaw(
                    $user['email'],
                    __('emails_misc.admin_actions.ban_subject', ['community' => $tenantName]),
                    $html,
                    null,
                    null,
                    null,
                    'admin_user_status',
                    ['tenant_id' => $tenant['tenant_id']]
                )) {
                    Log::warning("[AdminUsers] Ban email send returned false for user #{$id}");
                }
            });
        } catch (\Throwable $e) {
            Log::warning("[AdminUsers] Failed to send ban email to user #{$id}: " . $e->getMessage());
        }

        return $this->respondWithData(['banned' => true, 'id' => $id]);
    }

    /** POST /api/v2/admin/users/{id}/reactivate */
    public function reactivate($id): JsonResponse
    {
        $adminId = $this->requireBrokerOrAdmin();
        $tenantId = $this->getTenantId();
        $id = (int) $id;

        $user = User::findById($id, true);
        if (!$user || $user['tenant_id'] != $tenantId) {
            return $this->respondWithError('NOT_FOUND', __('api.user_not_found'), null, 404);
        }
        if (!$this->canManageSecurityTarget($adminId, $user)) {
            return $this->respondWithError('AUTH_INSUFFICIENT_PERMISSIONS', __('api.insufficient_permissions'), null, 403);
        }

        $lockedUser = DB::transaction(function () use ($adminId, $id, $tenantId): ?array {
            $target = $this->lockManageableSecurityTarget($adminId, $id, $tenantId);
            if ($target === null) {
                return null;
            }
            DB::update("UPDATE users SET status = 'active', is_approved = 1 WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
            return $target;
        }, 3);
        if ($lockedUser === null) {
            return $this->respondWithError('AUTH_INSUFFICIENT_PERMISSIONS', __('api.insufficient_permissions'), null, 403);
        }
        $user = $lockedUser;

        ActivityLog::log($adminId, 'admin_reactivate_user', "Reactivated user #{$id} ({$user['email']})");
        $this->auditLogService->logUserReactivated($adminId, $id, $user['status'] ?? 'unknown');

        // Notify the reactivated user (email + in-app)
        $emailSent = $this->sendReactivationNotificationEmail($user);
        $this->sendReactivationInAppNotification($user);

        return $this->respondWithData(['reactivated' => true, 'id' => $id, 'email_sent' => $emailSent]);
    }

    // =========================================================================
    // Delete
    // =========================================================================

    /** DELETE /api/v2/admin/users/{id} */
    public function destroy($id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $id = (int) $id;

        if ($id === $adminId) {
            return $this->respondWithError('AUTH_INSUFFICIENT_PERMISSIONS', __('api.cannot_delete_own_account'), null, 403);
        }

        $user = User::findById($id, true);
        if (!$user || $user['tenant_id'] != $tenantId) {
            return $this->respondWithError('NOT_FOUND', __('api.user_not_found'), null, 404);
        }

        if (!$this->canManageSecurityTarget($adminId, $user)) {
            return $this->respondWithError('AUTH_INSUFFICIENT_PERMISSIONS', __('api.insufficient_permissions'), null, 403);
        }

        // Send deletion email BEFORE the actual deletion (user record must still exist)
        try {
            LocaleContext::withLocale($user['preferred_language'] ?? null, function () use ($user, $id) {
                $tenant = $this->resolveUserTenant($user);
                $firstName = htmlspecialchars($user['first_name'] ?? __('emails.common.fallback_name'), ENT_QUOTES, 'UTF-8');
                $tenantName = $tenant['name'];

                $html = EmailTemplateBuilder::make()
                    ->theme('warning')
                    ->greeting(__('emails_misc.admin_actions.deletion_greeting', ['name' => $firstName]))
                    ->paragraph(__('emails_misc.admin_actions.deletion_body', ['community' => $tenantName]))
                    ->paragraph(__('emails_misc.admin_actions.deletion_help'))
                    ->render();

                if (!EmailDispatchService::sendRaw(
                    $user['email'],
                    __('emails_misc.admin_actions.deletion_subject', ['community' => $tenantName]),
                    $html,
                    null,
                    null,
                    null,
                    'admin_user_status',
                    ['tenant_id' => $tenant['tenant_id']]
                )) {
                    Log::warning("[AdminUsers] Deletion email send returned false for user #{$id}");
                }
            });
        } catch (\Throwable $e) {
            Log::warning("[AdminUsers] Failed to send deletion email to user #{$id}: " . $e->getMessage());
        }

        // Route through GDPR erasure instead of a raw DELETE. A hard delete
        // orphaned every child table that lacks an ON DELETE cascade — safeguarding
        // incidents, wellbeing/mood records, guardian consents, accessibility needs,
        // reviews, donations (donor PII), org memberships — and left uploaded
        // credential/expense-receipt files on disk. executeAccountDeletion
        // anonymises the users row in place (status='inactive', PII wiped) and
        // performs the full cross-module PII + file cleanup, so an admin "delete"
        // now leaves no orphaned personal data behind.
        $adminEmail = $user['email'];
        try {
            $erased = DB::transaction(function () use ($adminId, $id, $tenantId): bool {
                if ($this->lockManageableSecurityTarget($adminId, $id, $tenantId) === null) {
                    return false;
                }
                (new \App\Services\Enterprise\GdprService($tenantId))->executeAccountDeletion($id, $adminId);
                return true;
            }, 3);
            if (!$erased) {
                return $this->respondWithError(
                    'AUTH_INSUFFICIENT_PERMISSIONS',
                    __('api.insufficient_permissions'),
                    null,
                    403
                );
            }
        } catch (\Throwable $e) {
            Log::error("[AdminUsers] GDPR erasure failed for user #{$id}: " . $e->getMessage());
            return $this->respondWithError('SERVER_ERROR', __('api.delete_failed', ['resource' => 'User']), null, 500);
        }

        ActivityLog::log($adminId, 'admin_delete_user', "Erased user #{$id} ({$adminEmail})");
        $this->auditLogService->logUserDeleted($adminId, $id, $adminEmail);

        return $this->respondWithData(['deleted' => true, 'id' => $id]);
    }

    // =========================================================================
    // 2FA, Badges, Password, Consents
    // =========================================================================

    /** POST /api/v2/admin/users/{id}/reset-2fa */
    public function reset2fa($id): JsonResponse
    {
        // broker-or-admin: brokers help members who are locked out of 2FA.
        $adminId = $this->requireBrokerOrAdmin();
        $tenantId = $this->getTenantId();
        $id = (int) $id;

        $user = User::findById($id, true);
        if (!$user || $user['tenant_id'] != $tenantId) {
            return $this->respondWithError('NOT_FOUND', __('api.user_not_found'), null, 404);
        }
        if (!$this->canManageSecurityTarget($adminId, $user)) {
            return $this->respondWithError('AUTH_INSUFFICIENT_PERMISSIONS', __('api.insufficient_permissions'), null, 403);
        }

        $reason = $this->input('reason', __('svc_notifications.reset_by_admin'));

        try {
            DB::delete("DELETE FROM user_totp_settings WHERE user_id = ? AND tenant_id = ?", [$id, $tenantId]);
            DB::delete("DELETE FROM user_backup_codes WHERE user_id = ? AND tenant_id = ?", [$id, $tenantId]);
            DB::update("UPDATE users SET totp_enabled = 0 WHERE id = ? AND tenant_id = ?", [$id, $tenantId]);
            DB::update("UPDATE user_trusted_devices SET is_revoked = 1, revoked_at = NOW(), revoked_reason = 'admin_reset' WHERE user_id = ? AND tenant_id = ?", [$id, $tenantId]);
        } catch (\Throwable $e) {
            return $this->respondWithError('SERVER_ERROR', __('api.update_failed', ['resource' => '2FA']), null, 500);
        }

        ActivityLog::log($adminId, 'admin_reset_2fa', "Reset 2FA for user #{$id}: {$reason}");
        $this->auditLogService->log2faReset($adminId, $id, $reason);

        // Notify the user (bell + email — security-critical action)
        $recipientLocale = $user['preferred_language'] ?? null;
        try {
            LocaleContext::withLocale($recipientLocale, function () use ($id) {
                Notification::createNotification(
                    $id,
                    __('emails_misc.admin_actions.reset_2fa_bell'),
                    '/settings/security',
                    'security',
                    true
                );
                \App\Services\NotificationDispatcher::fanOutPush((int) $id, 'security', __('emails_misc.admin_actions.reset_2fa_bell'), '/settings/security');
            });
        } catch (\Throwable $e) {
            Log::warning("[AdminUsers] Failed to create 2FA reset bell notification for user #{$id}: " . $e->getMessage());
        }

        try {
            LocaleContext::withLocale($recipientLocale, function () use ($user, $id) {
                $tenant = $this->resolveUserTenant($user);
                $firstName = htmlspecialchars($user['first_name'] ?? __('emails.common.fallback_name'), ENT_QUOTES, 'UTF-8');
                $tenantName = $tenant['name'];
                $loginUrl = $tenant['frontend_url'] . $tenant['slug_prefix'] . '/login';

                $html = EmailTemplateBuilder::make()
                    ->theme('warning')
                    ->title(__('emails_misc.admin_actions.reset_2fa_title'))
                    ->previewText(__('emails_misc.admin_actions.reset_2fa_preview'))
                    ->greeting(__('emails_misc.admin_actions.reset_2fa_greeting', ['name' => $firstName]))
                    ->paragraph(__('emails_misc.admin_actions.reset_2fa_body', ['community' => $tenantName]))
                    ->paragraph(__('emails_misc.admin_actions.reset_2fa_body_reenable'))
                    ->paragraph(__('emails_misc.admin_actions.reset_2fa_body_contact'))
                    ->button(__('emails_misc.admin_actions.reset_2fa_cta'), $loginUrl)
                    ->render();

                if (!EmailDispatchService::sendRaw(
                    $user['email'],
                    __('emails_misc.admin_actions.reset_2fa_subject', ['community' => $tenantName]),
                    $html,
                    null,
                    null,
                    null,
                    'security_alert',
                    ['tenant_id' => $tenant['tenant_id']]
                )) {
                    Log::warning("[AdminUsers] 2FA reset email send returned false for user #{$id}");
                }
            });
        } catch (\Throwable $e) {
            Log::warning("[AdminUsers] Failed to send 2FA reset email to user #{$id}: " . $e->getMessage());
        }

        return $this->respondWithData(['reset' => true, 'id' => $id]);
    }

    /** POST /api/v2/admin/users/{id}/badges */
    public function addBadge($id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $id = (int) $id;

        $user = User::findById($id, true);
        if (!$user || $user['tenant_id'] != $tenantId) {
            return $this->respondWithError('NOT_FOUND', __('api.user_not_found'), null, 404);
        }

        $badgeSlug = trim($this->input('badge_slug', ''));
        if (empty($badgeSlug)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.badge_slug_required'), 'badge_slug', 422);
        }

        try {
            $this->gamificationService->awardBadgeByKey($id, $badgeSlug);
            ActivityLog::log($adminId, 'admin_award_badge', "Awarded badge '{$badgeSlug}' to user #{$id}");

            // Notify the user (bell notification only)
            try {
                $badgeDisplayName = ucwords(str_replace(['-', '_'], ' ', $badgeSlug));
                Notification::createNotification(
                    $id,
                    "You've been awarded the {$badgeDisplayName} badge!",
                    '/achievements',
                    'achievement',
                    false
                );
                \App\Services\NotificationDispatcher::fanOutPush((int) $id, 'achievement', "You've been awarded the {$badgeDisplayName} badge!", '/achievements');
            } catch (\Throwable $e) {
                Log::warning("[AdminUsers] Failed to create badge award bell notification for user #{$id}: " . $e->getMessage());
            }

            return $this->respondWithData(['awarded' => true, 'user_id' => $id, 'badge_slug' => $badgeSlug], null, 201);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning("[AdminUsers] Failed to award badge to user #{$id}: " . $e->getMessage());
            return $this->respondWithError('SERVER_ERROR', __('api.create_failed', ['resource' => 'badge award']), null, 500);
        }
    }

    /** DELETE /api/v2/admin/users/{id}/badges/{badgeId} */
    public function removeBadge($id, $badgeId): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $id = (int) $id;
        $badgeId = (int) $badgeId;

        $badge = DB::selectOne(
            "SELECT * FROM user_badges WHERE id = ? AND user_id = ? AND tenant_id = ?",
            [$badgeId, $id, $tenantId]
        );

        if (!$badge) {
            return $this->respondWithError('NOT_FOUND', __('api.badge_not_found'), null, 404);
        }

        DB::delete("DELETE FROM user_badges WHERE id = ? AND user_id = ? AND tenant_id = ?", [$badgeId, $id, $tenantId]);
        ActivityLog::log($adminId, 'admin_remove_badge', "Removed badge #{$badgeId} from user #{$id}");

        // Notify the user (bell notification only)
        try {
            $badgeDisplayName = $badge->badge_name ?? ucwords(str_replace(['-', '_'], ' ', $badge->badge_key ?? 'Unknown'));
            Notification::createNotification(
                $id,
                "The {$badgeDisplayName} badge has been removed from your profile.",
                '/achievements',
                'system',
                false
            );
            \App\Services\NotificationDispatcher::fanOutPush((int) $id, 'system', "The {$badgeDisplayName} badge has been removed from your profile.", '/achievements');
        } catch (\Throwable $e) {
            Log::warning("[AdminUsers] Failed to create badge removal bell notification for user #{$id}: " . $e->getMessage());
        }

        return $this->respondWithData(['removed' => true, 'user_id' => $id, 'badge_id' => $badgeId]);
    }

    /** POST /api/v2/admin/users/{id}/badges/recheck */
    public function recheckBadges($id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $id = (int) $id;

        $user = User::findById($id, true);
        if (!$user || $user['tenant_id'] != $tenantId) {
            return $this->respondWithError('NOT_FOUND', __('api.user_not_found'), null, 404);
        }

        try {
            $this->gamificationService->runAllBadgeChecks($id);
            ActivityLog::log($adminId, 'admin_recheck_badges', "Rechecked badges for user #{$id}");

            $badgeRows = DB::select(
                "SELECT ub.id, ub.badge_key, ub.awarded_at, ub.badge_name, ub.badge_description, ub.badge_icon
                 FROM user_badges ub WHERE ub.user_id = ? ORDER BY ub.awarded_at DESC",
                [$id]
            );

            $badges = array_map(fn($b) => [
                'id' => (int) $b->id,
                'name' => $b->badge_name ?? $b->badge_key ?? '',
                'slug' => $b->badge_key ?? '',
                'description' => $b->badge_description ?? '',
                'icon' => $b->badge_icon ?? null,
                'awarded_at' => $b->awarded_at ?? '',
            ], $badgeRows);

            return $this->respondWithData(['rechecked' => true, 'user_id' => $id, 'badges' => $badges]);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning("[AdminUsers] Badge recheck failed for user #{$id}: " . $e->getMessage());
            return $this->respondWithError('SERVER_ERROR', __('api.badge_recheck_failed'), null, 500);
        }
    }

    /** GET /api/v2/admin/users/{id}/consents */
    public function getConsents($id): JsonResponse
    {
        // broker-or-admin: read-only view of a member's GDPR consents.
        $this->requireBrokerOrAdmin();
        $tenantId = $this->getTenantId();
        $id = (int) $id;

        $user = User::findById($id, true);
        if (!$user || $user['tenant_id'] != $tenantId) {
            return $this->respondWithError('NOT_FOUND', __('api.user_not_found'), null, 404);
        }

        try {
            $consents = $this->gdprService->getUserConsents($id);

            $formatted = array_map(fn($c) => [
                'consent_type' => $c['consent_type_slug'] ?? $c['consent_type'] ?? '',
                'name' => $c['name'] ?? ucwords(str_replace('_', ' ', $c['consent_type_slug'] ?? '')),
                'description' => $c['description'] ?? null,
                'category' => $c['category'] ?? null,
                'is_required' => (bool) ($c['is_required'] ?? false),
                'consent_given' => (bool) ($c['consent_given'] ?? false),
                'consent_version' => $c['consent_version'] ?? null,
                'given_at' => $c['given_at'] ?? null,
                'withdrawn_at' => $c['withdrawn_at'] ?? null,
            ], $consents);

            return $this->respondWithData($formatted);
        } catch (\Throwable $e) {
            return $this->respondWithData([]);
        }
    }

    /** POST /api/v2/admin/users/{id}/password */
    public function setPassword($id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $id = (int) $id;

        $user = User::findById($id, true);
        if (!$user || $user['tenant_id'] != $tenantId) {
            return $this->respondWithError('NOT_FOUND', __('api.user_not_found'), null, 404);
        }
        if (!$this->canManageSecurityTarget($adminId, $user)) {
            return $this->respondWithError('AUTH_INSUFFICIENT_PERMISSIONS', __('api.insufficient_permissions'), null, 403);
        }

        $password = $this->input('password', '');
        if (strlen($password) < 8) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.password_min_length'), 'password', 422);
        }

        $hashed = password_hash($password, PASSWORD_ARGON2ID);
        try {
            $passwordUpdated = DB::transaction(function () use (
                $adminId,
                $id,
                $tenantId,
                $password,
                $hashed
            ): bool {
                $lockedUser = $this->lockManageableSecurityTarget($adminId, $id, $tenantId);
                if ($lockedUser === null) {
                    throw new \RuntimeException('Password target is no longer manageable.');
                }

                $currentHash = is_string($lockedUser['password_hash'] ?? null)
                    ? $lockedUser['password_hash']
                    : null;
                if (PasswordHistoryService::isReused($id, $tenantId, $password, $currentHash)) {
                    return false;
                }

                DB::update(
                    "UPDATE users SET password_hash = ? WHERE id = ? AND tenant_id = ?",
                    [$hashed, $id, $tenantId]
                );
                PasswordHistoryService::record($id, $tenantId, $currentHash);

                // A previously issued reset link must never remain a second
                // route back into an account after an administrator replaces
                // its password. Keep this invalidation inside the same locked
                // transaction as the hash change and session revocation.
                DB::table('password_resets')
                    ->where('tenant_id', $tenantId)
                    ->whereRaw('LOWER(email) = ?', [strtolower(trim((string) ($lockedUser['email'] ?? '')))])
                    ->delete();

                if ($this->tokenService->revokeAllTokensForUser($id, 'admin_password_change') < 1) {
                    throw new \RuntimeException('Could not revoke sessions after admin password change.');
                }

                return true;
            });
        } catch (\Throwable $e) {
            Log::error('[AdminUsers] Password transaction failed', [
                'admin_id' => $adminId,
                'user_id' => $id,
                'tenant_id' => $tenantId,
                'error' => $e->getMessage(),
            ]);
            return $this->respondWithError('SERVER_ERROR', __('api.server_error'), null, 500);
        }

        if (!$passwordUpdated) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.password_reused'), 'password', 422);
        }

        ActivityLog::log($adminId, 'admin_set_password', "Admin set password for user #{$id} ({$user['email']})");
        $this->auditLogService->logAdminAction('admin_set_password', $adminId, $id, ['email' => $user['email']]);

        // Notify the user (email only — they need to know their old password no longer works)
        // CRITICAL: Do NOT include the new password in the email
        try {
            LocaleContext::withLocale($user['preferred_language'] ?? null, function () use ($user, $id) {
                $tenant = $this->resolveUserTenant($user);
                $firstName = htmlspecialchars($user['first_name'] ?? __('emails.common.fallback_name'), ENT_QUOTES, 'UTF-8');
                $tenantName = $tenant['name'];
                $loginUrl = $tenant['frontend_url'] . $tenant['slug_prefix'] . '/login';

                $html = EmailTemplateBuilder::make()
                    ->theme('warning')
                    ->greeting(__('emails_misc.admin_actions.set_password_greeting', ['name' => $firstName]))
                    ->paragraph(__('emails_misc.admin_actions.set_password_body', ['community' => $tenantName]))
                    ->paragraph(__('emails_misc.admin_actions.set_password_body_old_pass'))
                    ->paragraph(__('emails_misc.admin_actions.set_password_body_contact'))
                    ->button(__('emails_misc.admin_actions.set_password_cta'), $loginUrl)
                    ->render();

                if (!EmailDispatchService::sendRaw(
                    $user['email'],
                    __('emails_misc.admin_actions.set_password_subject', ['community' => $tenantName]),
                    $html,
                    null,
                    null,
                    null,
                    'security_alert',
                    ['tenant_id' => $tenant['tenant_id']]
                )) {
                    Log::warning("[AdminUsers] Password-changed email returned false for user #{$id}");
                }
            });
        } catch (\Throwable $e) {
            Log::warning("[AdminUsers] Failed to send password reset email to user #{$id}: " . $e->getMessage());
        }

        return $this->respondWithData(['password_set' => true, 'id' => $id]);
    }

    // =========================================================================
    // Impersonate & Super Admin
    // =========================================================================

    /** POST /api/v2/admin/users/{id}/impersonate */
    public function impersonate($id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $id = (int) $id;

        $user = User::findById($id, true);
        if (!$user || $user['tenant_id'] != $tenantId) {
            return $this->respondWithError('NOT_FOUND', __('api.user_not_found'), null, 404);
        }

        // Prevent self-impersonation
        if ($id === $adminId) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.cannot_impersonate_self'), null, 422);
        }
        if (!$this->canManageSecurityTarget($adminId, $user)) {
            return $this->respondWithError('AUTH_INSUFFICIENT_PERMISSIONS', __('api.insufficient_permissions'), null, 403);
        }

        // Check if target user is blocked by registration policy gates
        $userTenantId = (int) $user['tenant_id'];
        $gateBlock = $this->tenantSettingsService->checkLoginGatesForUser($user);

        try {
            // Generate the proof while the actor and target tiers are locked so
            // a concurrent promotion cannot turn a permitted member
            // impersonation into a peer/higher-tier administrator session.
            $token = DB::transaction(function () use ($adminId, $id, $tenantId, $userTenantId): ?string {
                if ($this->lockManageableSecurityTarget($adminId, $id, $tenantId) === null) {
                    return null;
                }
                return $this->tokenService->generateImpersonationToken($id, $userTenantId, $adminId);
            }, 3);
            if ($token === null) {
                return $this->respondWithError(
                    'AUTH_INSUFFICIENT_PERMISSIONS',
                    __('api.insufficient_permissions'),
                    null,
                    403
                );
            }

            // Resolve the target user's tenant slug so the frontend can open the
            // new tab on that tenant's URL — without it, the new tab inherits
            // the admin's tenant slug from localStorage and the impersonation
            // token is rejected as a cross-tenant mismatch.
            $tenantSlug = \Illuminate\Support\Facades\DB::table('tenants')
                ->where('id', $userTenantId)
                ->value('slug');

            ActivityLog::log($adminId, 'admin_impersonate', "Impersonated user #{$id} ({$user['email']})");
            $this->auditLogService->logUserImpersonated($adminId, $id, $user['email']);

            $responseData = [
                'token'        => $token,
                'user_id'      => $id,
                'user_name'    => trim(($user['first_name'] ?? '') . ' ' . ($user['last_name'] ?? '')),
                'tenant_id'    => $userTenantId,
                'tenant_slug'  => $tenantSlug,
            ];
            if ($gateBlock) {
                $responseData['gate_warning'] = $gateBlock['message'];
                $responseData['gate_code'] = $gateBlock['code'];
            }

            return $this->respondWithData($responseData);
        } catch (\Throwable $e) {
            return $this->respondWithError('SERVER_ERROR', __('api.create_failed', ['resource' => 'impersonation token']), null, 500);
        }
    }

    /** PUT /api/v2/admin/users/{id}/super-admin */
    public function setSuperAdmin($id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $id = (int) $id;

        // Only super admins can grant/revoke tenant super admin status
        if (!$this->isCallerSuperAdmin($adminId)) {
            return $this->respondWithError('AUTH_INSUFFICIENT_PERMISSIONS', __('api.only_super_admins_manage_status'), null, 403);
        }

        // Prevent self-modification
        if ($id === $adminId) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.cannot_modify_own_super_admin'), null, 422);
        }

        $grant = (bool) ($this->input('grant', false));

        try {
            // SECURITY: Scope user lookup by tenant_id to prevent cross-tenant IDOR
            $user = DB::selectOne(
                "SELECT id, email, first_name, last_name, tenant_id FROM users WHERE id = ? AND tenant_id = ?",
                [$id, $tenantId]
            );

            if (!$user) {
                return $this->respondWithError('NOT_FOUND', __('api.user_not_found'), null, 404);
            }

            // SECURITY: Scope UPDATE by tenant_id to prevent cross-tenant modification
            if ($grant) {
                DB::update(
                    "UPDATE users SET is_tenant_super_admin = 1, role = 'admin' WHERE id = ? AND tenant_id = ?",
                    [$id, $tenantId]
                );
            } else {
                DB::update(
                    "UPDATE users SET is_tenant_super_admin = 0 WHERE id = ? AND tenant_id = ?",
                    [$id, $tenantId]
                );
            }

            $action = $grant ? 'grant_tenant_super_admin' : 'revoke_tenant_super_admin';
            ActivityLog::log($adminId, $action, ($grant ? 'Granted' : 'Revoked') . " tenant super admin for user #{$id}: {$user->email} (tenant {$user->tenant_id})");
            $this->auditLogService->logAdminAction($action, $adminId, $id, ['email' => $user->email]);

            // Notify the user of role change (bell notification, in recipient's locale)
            try {
                $recipient = DB::table('users')
                    ->where('id', $id)
                    ->where('tenant_id', $tenantId)
                    ->select(['preferred_language'])
                    ->first();
                LocaleContext::withLocale($recipient, function () use ($id, $grant) {
                    $message = $grant
                        ? __('api_controllers_3.admin_bells.super_admin_granted')
                        : __('api_controllers_3.admin_bells.super_admin_revoked');
                    Notification::createNotification(
                        $id,
                        $message,
                        null,
                        'system',
                        true
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) $id, 'system', $message, null);
                });
            } catch (\Throwable $e) {
                Log::warning("[AdminUsers] Failed to create super admin role change notification for user #{$id}: " . $e->getMessage());
            }

            return $this->respondWithData(['id' => $id, 'is_tenant_super_admin' => $grant]);
        } catch (\Exception $e) {
            Log::error('AdminUsersController::setTenantSuperAdmin failed', [
                'user_id' => $id,
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
            ]);
            return $this->respondWithError('SERVER_ERROR', __('api.update_failed', ['resource' => 'super admin status']), null, 500);
        }
    }

    /** PUT /api/v2/admin/users/{id}/global-super-admin */
    public function setGlobalSuperAdmin($id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $id = (int) $id;

        // Only god users can set global super admin
        if (!User::isGod($adminId)) {
            return $this->respondWithError('AUTH_INSUFFICIENT_PERMISSIONS', __('api.only_god_manage_global_super_admin'), null, 403);
        }

        // Prevent self-modification
        if ($id === $adminId) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.cannot_modify_own_super_admin'), null, 422);
        }

        $grant = (bool) ($this->input('grant', false));

        try {
            // SECURITY: Scope user lookup by tenant_id to prevent cross-tenant IDOR
            $user = DB::selectOne(
                "SELECT id, email, first_name, last_name, tenant_id FROM users WHERE id = ? AND tenant_id = ?",
                [$id, $tenantId]
            );

            if (!$user) {
                return $this->respondWithError('NOT_FOUND', __('api.user_not_found'), null, 404);
            }

            // SECURITY: Scope UPDATE by tenant_id to prevent cross-tenant modification
            DB::update(
                "UPDATE users SET is_super_admin = ? WHERE id = ? AND tenant_id = ?",
                [$grant ? 1 : 0, $id, $tenantId]
            );

            $action = $grant ? 'grant_global_super_admin' : 'revoke_global_super_admin';
            ActivityLog::log($adminId, $action, ($grant ? 'Granted' : 'Revoked') . " global super admin for user #{$id}: {$user->email} (tenant {$user->tenant_id})");
            $this->auditLogService->logAdminAction($action, $adminId, $id, ['email' => $user->email]);

            // Notify the user of role change (bell notification, in recipient's locale)
            try {
                $recipient = DB::table('users')
                    ->where('id', $id)
                    ->where('tenant_id', $tenantId)
                    ->select(['preferred_language'])
                    ->first();
                LocaleContext::withLocale($recipient, function () use ($id, $grant) {
                    $message = $grant
                        ? 'You have been granted Global Super Admin privileges.'
                        : 'Your Global Super Admin privileges have been removed.';
                    Notification::createNotification(
                        $id,
                        $message,
                        null,
                        'system',
                        true
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) $id, 'system', $message, null);
                });
            } catch (\Throwable $e) {
                Log::warning("[AdminUsers] Failed to create global super admin role change notification for user #{$id}: " . $e->getMessage());
            }

            return $this->respondWithData(['id' => $id, 'is_super_admin' => $grant]);
        } catch (\Exception $e) {
            Log::error('AdminUsersController::setGlobalSuperAdmin failed', [
                'user_id' => $id,
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
            ]);
            return $this->respondWithError('SERVER_ERROR', __('api.update_failed', ['resource' => 'global super admin status']), null, 500);
        }
    }

    // =========================================================================
    // Email-sending methods
    // =========================================================================

    /** POST /api/v2/admin/users/{id}/send-password-reset */
    public function sendPasswordReset($id): JsonResponse
    {
        // broker-or-admin: emails the member a self-service reset link.
        $adminId = $this->requireBrokerOrAdmin();
        $tenantId = $this->getTenantId();
        $id = (int) $id;

        $user = User::findById($id, true);
        if (!$user || $user['tenant_id'] != $tenantId) {
            return $this->respondWithError('NOT_FOUND', __('api.user_not_found'), null, 404);
        }
        if (!$this->canManageSecurityTarget($adminId, $user)) {
            return $this->respondWithError('AUTH_INSUFFICIENT_PERMISSIONS', __('api.insufficient_permissions'), null, 403);
        }

        try {
            $token = bin2hex(random_bytes(32));
            // Must use SHA-256 (not bcrypt) — PasswordResetController::findResetTokenCandidate()
            // looks up by hashed token column using hash('sha256', $token).
            $hashedToken = hash('sha256', $token);
            $userTenantId = (int) $user['tenant_id'];

            $existingResetRows = DB::table('password_resets')
                ->where('email', $user['email'])
                ->where('tenant_id', $userTenantId)
                ->get()
                ->map(fn ($row): array => (array) $row)
                ->all();

            DB::transaction(function () use ($user, $userTenantId, $hashedToken): void {
                DB::delete("DELETE FROM password_resets WHERE email = ? AND tenant_id = ?", [$user['email'], $userTenantId]);
                DB::insert(
                    "INSERT INTO password_resets (email, tenant_id, token, created_at) VALUES (?, ?, ?, NOW())",
                    [$user['email'], $userTenantId, $hashedToken]
                );
            });

            try {
                $resetEmailSent = (bool) LocaleContext::withLocale($user['preferred_language'] ?? null, function () use ($user, $id, $token) {
                    $tenant = $this->resolveUserTenant($user);
                    $tenantNameSafe = htmlspecialchars($tenant['name'], ENT_QUOTES, 'UTF-8');

                    $resetLink = $tenant['frontend_url'] . $tenant['slug_prefix'] . "/password/reset?token={$token}";

                    $firstName = htmlspecialchars($user['first_name'] ?? '', ENT_QUOTES, 'UTF-8');
                    $html = \App\Core\EmailTemplateBuilder::make()
                        ->theme('warning')
                        ->title(__('emails_misc.admin_actions.password_reset_title'))
                        ->greeting(__('emails_misc.admin_actions.password_reset_greeting', ['name' => $firstName]))
                        ->paragraph(__('emails_misc.admin_actions.password_reset_body'))
                        ->button(__('emails_misc.admin_actions.password_reset_cta'), $resetLink)
                        ->render();

                    return EmailDispatchService::sendRaw(
                        $user['email'],
                        __('emails_misc.admin_actions.password_reset_subject', ['community' => $tenantNameSafe]),
                        $html,
                        null,
                        null,
                        null,
                        'password_reset',
                        ['tenant_id' => $tenant['tenant_id']]
                    );
                });
            } catch (\Throwable $sendException) {
                $this->restorePasswordResetRows($user['email'], $userTenantId, $existingResetRows);
                throw $sendException;
            }

            if (!$resetEmailSent) {
                $this->restorePasswordResetRows($user['email'], $userTenantId, $existingResetRows);
                throw new \RuntimeException('Password reset email send returned false');
            }

            ActivityLog::log($adminId, 'admin_send_password_reset', "Sent password reset email to user #{$id} ({$user['email']})");

            return $this->respondWithData(['sent' => true, 'id' => $id]);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning("[AdminUsers] Failed to send password reset email for user #{$id}: " . $e->getMessage());
            return $this->respondWithError('SERVER_ERROR', __('api.create_failed', ['resource' => 'password reset email']), null, 500);
        }
    }

    /**
     * @param list<array<string,mixed>> $rows
     */
    private function restorePasswordResetRows(string $email, int $tenantId, array $rows): void
    {
        DB::transaction(function () use ($email, $tenantId, $rows): void {
            DB::delete("DELETE FROM password_resets WHERE email = ? AND tenant_id = ?", [$email, $tenantId]);

            foreach ($rows as $row) {
                DB::table('password_resets')->insert([
                    'email' => $row['email'],
                    'tenant_id' => $row['tenant_id'],
                    'token' => $row['token'],
                    'created_at' => $row['created_at'],
                ]);
            }
        });
    }

    /** POST /api/v2/admin/users/{id}/send-welcome-email */
    public function sendWelcomeEmail($id): JsonResponse
    {
        // broker-or-admin: (re)sends the onboarding welcome email.
        $adminId = $this->requireBrokerOrAdmin();
        $tenantId = $this->getTenantId();
        $id = (int) $id;

        $user = User::findById($id, true);
        if (!$user || $user['tenant_id'] != $tenantId) {
            return $this->respondWithError('NOT_FOUND', __('api.user_not_found'), null, 404);
        }

        try {
            LocaleContext::withLocale($user['preferred_language'] ?? null, function () use ($user, $adminId, $id) {
                // Resolve tenant from the USER's tenant_id
                $resolvedTenant = $this->resolveUserTenant($user);
                $userTenantId = $resolvedTenant['tenant_id'];
                $tenantName = $resolvedTenant['name'];
                $tenantNameSafe = htmlspecialchars($tenantName, ENT_QUOTES, 'UTF-8');

                // Read tenant configuration for custom welcome email content
                $tenantRow = DB::selectOne("SELECT configuration FROM tenants WHERE id = ?", [$userTenantId]);
                $config = json_decode($tenantRow->configuration ?? '{}', true);
                $welcomeConfig = $config['welcome_email'] ?? [];

                $subject = !empty($welcomeConfig['subject']) ? $welcomeConfig['subject'] : __('emails_misc.admin_actions.welcome_resend_subject', ['community' => $tenantNameSafe]);

                $firstName = htmlspecialchars($user['first_name'] ?? '', ENT_QUOTES, 'UTF-8');

                if (!empty($welcomeConfig['body'])) {
                    $mainMessage = $welcomeConfig['body'];
                } else {
                    $mainMessage = '<p>' . __('emails_misc.admin_actions.welcome_resend_greeting', ['name' => $firstName]) . '</p>'
                        . '<p>' . __('emails_misc.admin_actions.welcome_resend_body', ['community' => $tenantNameSafe]) . '</p>';
                }

                $loginLink = $resolvedTenant['frontend_url'] . $resolvedTenant['slug_prefix'] . "/login";

                if (stripos($mainMessage, '<!DOCTYPE') !== false || stripos($mainMessage, '<html') !== false) {
                    $html = $mainMessage;
                } else {
                    $html = \App\Core\EmailTemplateBuilder::make()
                        ->theme('brand')
                        ->title(__('emails_misc.admin_actions.welcome_resend_title'))
                        ->paragraph($mainMessage)
                        ->button(__('emails_misc.admin_actions.welcome_resend_cta'), $loginLink)
                        ->render();
                }

                if (!EmailDispatchService::sendRaw($user['email'], $subject, $html, null, null, null, 'welcome', ['tenant_id' => $userTenantId])) {
                    throw new \RuntimeException('Welcome email send returned false');
                }

                ActivityLog::log($adminId, 'admin_resend_welcome', "Resent welcome email to user #{$id} ({$user['email']})");
            });

            return $this->respondWithData(['sent' => true, 'id' => $id]);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning("[AdminUsers] Failed to send welcome email for user #{$id}: " . $e->getMessage());
            return $this->respondWithError('SERVER_ERROR', __('api.create_failed', ['resource' => 'welcome email']), null, 500);
        }
    }

    // =========================================================================
    // Import
    // =========================================================================

    /** POST /api/v2/admin/users/import */
    public function import(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        if (!isset($_FILES['csv_file']) || $_FILES['csv_file']['error'] !== UPLOAD_ERR_OK) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.csv_no_file'), null, 400);
        }

        $file = $_FILES['csv_file'];

        // SECURITY: Sanitize the original filename defensively — strip path components
        // and restrict to safe characters before it ever appears in logs or error output.
        $safeName = basename((string) ($file['name'] ?? 'upload.csv'));
        $safeName = preg_replace('/[^A-Za-z0-9._-]/', '_', $safeName) ?: 'upload.csv';
        $file['name'] = $safeName;

        // SECURITY: Tighten MIME allowlist to the two canonical CSV types. Some
        // browsers also report application/csv / text/plain; keep those but drop
        // anything else that was historically accepted.
        $allowedTypes = ['text/csv', 'application/vnd.ms-excel', 'application/csv', 'text/plain'];
        if (!in_array($file['type'], $allowedTypes, true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.csv_invalid_type'), null, 400);
        }

        $handle = fopen($file['tmp_name'], 'r');
        if (!$handle) {
            return $this->respondWithError('SERVER_ERROR', __('api.csv_could_not_read'), null, 500);
        }

        // Read header row
        $header = fgetcsv($handle);
        if (!$header) {
            fclose($handle);
            return $this->respondWithError('VALIDATION_ERROR', __('api.csv_empty'), null, 400);
        }

        // Normalize headers (lowercase, trim, underscores)
        $header = array_map(function ($h) {
            return strtolower(trim(str_replace([' ', '-'], '_', $h)));
        }, $header);

        // Validate required columns
        $requiredColumns = ['first_name', 'last_name', 'email'];
        $missing = array_diff($requiredColumns, $header);
        if (!empty($missing)) {
            fclose($handle);
            return $this->respondWithError('VALIDATION_ERROR', __('api.csv_missing_columns', ['columns' => implode(', ', $missing)]), null, 400);
        }

        $results = ['imported' => 0, 'skipped' => 0, 'errors' => []];
        $row = 1;
        $defaultRole = request()->input('default_role', 'member');

        // SECURITY: Restrict allowed roles for CSV import to prevent privilege escalation (SEC-008)
        $allowedImportRoles = ['member', 'admin', 'broker'];
        if (!in_array($defaultRole, $allowedImportRoles, true)) {
            $defaultRole = 'member';
        }

        while (($data = fgetcsv($handle)) !== false) {
            $row++;
            if (count($data) !== count($header)) {
                $results['errors'][] = "Row {$row}: Column count mismatch";
                $results['skipped']++;
                continue;
            }

            $record = array_combine($header, $data);
            $email = trim($record['email'] ?? '');
            $firstName = trim($record['first_name'] ?? '');
            $lastName = trim($record['last_name'] ?? '');

            // Validate email
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                $results['errors'][] = "Row {$row}: Invalid email '{$email}'";
                $results['skipped']++;
                continue;
            }

            if (empty($firstName) || empty($lastName)) {
                $results['errors'][] = "Row {$row}: First name and last name are required";
                $results['skipped']++;
                continue;
            }

            // Check if user already exists in this tenant
            try {
                $existing = DB::selectOne(
                    "SELECT id FROM users WHERE email = ? AND tenant_id = ?",
                    [$email, $tenantId]
                );

                if ($existing) {
                    $results['errors'][] = "Row {$row}: User with email '{$email}' already exists";
                    $results['skipped']++;
                    continue;
                }

                // Create user with random temp password
                $password = bin2hex(random_bytes(16));
                $hashedPassword = password_hash($password, PASSWORD_ARGON2ID);

                DB::insert(
                    "INSERT INTO users (tenant_id, name, first_name, last_name, email, password_hash, phone, role, status, is_approved, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, NOW())",
                    [
                        $tenantId,
                        trim($firstName . ' ' . $lastName),
                        $firstName,
                        $lastName,
                        $email,
                        $hashedPassword,
                        trim($record['phone'] ?? ''),
                        // SECURITY: Validate per-row role against allowlist (SEC-008)
                        in_array($record['role'] ?? $defaultRole, $allowedImportRoles, true) ? ($record['role'] ?? $defaultRole) : $defaultRole,
                    ]
                );

                // Seed federation settings for the new user
                $newUserId = (int) DB::getPdo()->lastInsertId();
                if ($newUserId > 0) {
                    try {
                        DB::statement(
                            "INSERT IGNORE INTO federation_user_settings (
                                user_id, federation_optin, profile_visible_federated,
                                messaging_enabled_federated, transactions_enabled_federated,
                                appear_in_federated_search, show_skills_federated,
                                show_location_federated, service_reach, opted_in_at, created_at
                            ) VALUES (?, 0, 0, 0, 0, 0, 0, 0, 'local_only', NULL, NOW())",
                            [$newUserId]
                        );
                    } catch (\Exception $e) {
                        // Non-critical — federation settings can be seeded later
                        Log::error('AdminUsersController::importUsers federation_user_settings seed failed', [
                            'user_id' => $newUserId,
                            'error' => $e->getMessage(),
                            'trace' => $e->getTraceAsString(),
                        ]);
                    }
                }

                $results['imported']++;
            } catch (\Exception $e) {
                \Illuminate\Support\Facades\Log::warning("CSV import row {$row} failed", ['error' => $e->getMessage()]);
                $results['errors'][] = "Row {$row}: Failed to import user. Check data format.";
                $results['skipped']++;
            }
        }

        fclose($handle);

        ActivityLog::log($adminId, 'admin_bulk_import_users', "Bulk imported {$results['imported']} users ({$results['skipped']} skipped)");
        $this->auditLogService->logBulkImport($adminId, $results['imported'], $results['skipped'], $row - 1);

        return $this->respondWithData([
            'imported' => $results['imported'],
            'skipped' => $results['skipped'],
            'errors' => array_slice($results['errors'], 0, 50),
            'total_rows' => $row - 1,
        ]);
    }

    /** GET /api/v2/admin/users/import/template */
    public function importTemplate(): Response
    {
        $this->requireAdmin();

        // Build CSV content for template download
        $csvLines = [];
        $csvLines[] = ['first_name', 'last_name', 'email', 'phone', 'role'];
        $csvLines[] = ['Jane', 'Doe', 'jane@example.com', '+15551234567', 'member'];
        $csvLines[] = ['John', 'Smith', 'john@example.com', '', 'member'];

        // Build CSV string
        $output = fopen('php://temp', 'r+');
        // UTF-8 BOM for Excel compatibility
        fprintf($output, chr(0xEF) . chr(0xBB) . chr(0xBF));
        foreach ($csvLines as $line) {
            fputcsv($output, $line);
        }
        rewind($output);
        $csv = stream_get_contents($output);
        fclose($output);

        return response($csv, 200, [
            'Content-Type' => 'text/csv; charset=utf-8',
            'Content-Disposition' => 'attachment; filename="user_import_template.csv"',
        ]);
    }

    // =========================================================================
    // Private Helpers
    // =========================================================================

    /**
     * Check if the calling admin is a super admin (is_super_admin or is_tenant_super_admin).
     *
     * @param int $adminId The admin's user ID
     * @return bool
     */
    private function isCallerSuperAdmin(int $adminId): bool
    {
        $row = DB::selectOne(
            "SELECT is_super_admin, is_tenant_super_admin FROM users WHERE id = ?",
            [$adminId]
        );

        if (!$row) {
            return false;
        }

        return !empty($row->is_super_admin) || !empty($row->is_tenant_super_admin);
    }

    /**
     * Prevent lower/equal admin tiers from resetting security state for peers
     * or higher-tier admins.
     *
     * @param array<string,mixed> $targetUser
     */
    private function canManageSecurityTarget(int $adminId, array $targetUser): bool
    {
        $actor = User::findById($adminId, true);
        if (!$actor) {
            return false;
        }

        return $this->securityActorCanManageTarget($actor, $targetUser);
    }

    /**
     * Lock the actor and target in deterministic ID order, then re-evaluate the
     * hierarchy at the mutation boundary. Call only inside a DB transaction.
     *
     * @return array<string,mixed>|null Locked target row when authorised.
     */
    private function lockManageableSecurityTarget(int $adminId, int $targetId, int $tenantId): ?array
    {
        $ids = array_values(array_unique([$adminId, $targetId]));
        sort($ids, SORT_NUMERIC);

        $rows = DB::table('users')
            ->whereIn('id', $ids)
            ->orderBy('id')
            ->lockForUpdate()
            ->get()
            ->mapWithKeys(static fn ($row): array => [(int) $row->id => (array) $row])
            ->all();

        $actor = $rows[$adminId] ?? null;
        $target = $rows[$targetId] ?? null;
        if (
            !is_array($actor)
            || !is_array($target)
            || (int) ($target['tenant_id'] ?? 0) !== $tenantId
            || !$this->securityActorCanManageTarget($actor, $target)
        ) {
            return null;
        }

        return $target;
    }

    /**
     * @param array<string,mixed> $actor
     * @param array<string,mixed> $targetUser
     */
    private function securityActorCanManageTarget(array $actor, array $targetUser): bool
    {
        $actorTier = $this->securityTier($actor);
        $targetTier = $this->securityTier($targetUser);

        if ($actorTier >= 4) {
            return true;
        }

        return $actorTier > $targetTier;
    }

    /**
     * @param array<string,mixed> $user
     */
    private function securityTier(array $user): int
    {
        $role = (string) ($user['role'] ?? 'member');
        if ($role === 'god' || !empty($user['is_god'])) {
            return 4;
        }
        if ($role === 'super_admin' || !empty($user['is_super_admin'])) {
            return 3;
        }
        if (
            in_array($role, ['admin', 'tenant_admin'], true)
            || !empty($user['is_admin'])
            || !empty($user['is_tenant_super_admin'])
        ) {
            return 2;
        }
        // Brokers/coordinators outrank ordinary members (so they can reset a
        // member's 2FA or trigger a password reset) but never each other or any
        // admin — canManageSecurityTarget() requires a strictly-higher tier.
        if (in_array($role, ['broker', 'coordinator'], true)) {
            return 1;
        }

        return 0;
    }

    /**
     * Resolve the tenant name and slug for a user's tenant.
     * Uses the user's tenant_id to look up the correct values.
     *
     * @param array $user User record from the database
     * @return array{tenant_id: int, name: string, slug_prefix: string, frontend_url: string}
     */
    private function resolveUserTenant(array $user): array
    {
        if (empty($user['tenant_id'])) {
            throw new \RuntimeException(__('api.user_missing_tenant_id'));
        }
        $userTenantId = (int) $user['tenant_id'];
        $tenantName   = 'Project NEXUS';
        $slugPrefix   = '';
        $frontendUrl  = \App\Core\Env::get('FRONTEND_URL', 'https://app.project-nexus.ie');

        $tenant = DB::selectOne(
            "SELECT t.name, t.slug, t.domain, p.domain AS parent_domain
             FROM tenants t
             LEFT JOIN tenants p ON p.id = t.parent_id AND p.is_active = 1
             WHERE t.id = ?",
            [$userTenantId]
        );

        if ($tenant) {
            $tenantName = $tenant->name;
            $slug       = $tenant->slug ?? '';

            if (!empty($tenant->domain)) {
                // Tenant owns its custom domain — no slug prefix in URLs
                $frontendUrl = 'https://' . rtrim((string) $tenant->domain, '/');
                $slugPrefix  = '';
            } elseif (!empty($tenant->parent_domain)) {
                // Sub-tenant sharing parent's custom domain (e.g. timebanking.uk/cardiff)
                $frontendUrl = 'https://' . rtrim((string) $tenant->parent_domain, '/');
                $slugPrefix  = $slug ? '/' . $slug : '';
            } else {
                // Shared platform host (app.project-nexus.ie/slug)
                $slugPrefix = $slug ? '/' . $slug : '';
            }
        }

        return [
            'tenant_id'    => $userTenantId,
            'name'         => $tenantName,
            'slug_prefix'  => $slugPrefix,
            'frontend_url' => $frontendUrl,
        ];
    }

    private function notifySuspendedUser(array $user, int $id): void
    {
        $recipientLocale = $user['preferred_language'] ?? null;
        try {
            LocaleContext::withLocale($recipientLocale, function () use ($id) {
                Notification::createNotification(
                    $id,
                    __('emails_misc.admin_actions.suspension_bell'),
                    null,
                    'system',
                    true
                );
                \App\Services\NotificationDispatcher::fanOutPush((int) $id, 'system', __('emails_misc.admin_actions.suspension_bell'), null);
            });
        } catch (\Throwable $e) {
            Log::warning("[AdminUsers] Failed to create suspension bell notification for user #{$id}: " . $e->getMessage());
        }

        try {
            LocaleContext::withLocale($recipientLocale, function () use ($user, $id) {
                $tenant = $this->resolveUserTenant($user);
                $firstName = htmlspecialchars($user['first_name'] ?? __('emails.common.fallback_name'), ENT_QUOTES, 'UTF-8');
                $tenantName = $tenant['name'];

                $html = EmailTemplateBuilder::make()
                    ->theme('warning')
                    ->greeting(__('emails_misc.admin_actions.suspension_greeting', ['name' => $firstName]))
                    ->paragraph(__('emails_misc.admin_actions.suspension_body', ['community' => $tenantName]))
                    ->paragraph(__('emails_misc.admin_actions.suspension_help'))
                    ->render();

                if (!EmailDispatchService::sendRaw(
                    $user['email'],
                    __('emails_misc.admin_actions.suspension_subject', ['community' => $tenantName]),
                    $html,
                    null,
                    null,
                    null,
                    'admin_user_status',
                    ['tenant_id' => $tenant['tenant_id']]
                )) {
                    Log::warning("[AdminUsers] Suspension email send returned false for user #{$id}");
                }
            });
        } catch (\Throwable $e) {
            Log::warning("[AdminUsers] Failed to send suspension email to user #{$id}: " . $e->getMessage());
        }
    }

    /**
     * Grant welcome time credits to a newly approved user.
     *
     * Amount is configurable per tenant via the 'welcome_credits' setting
     * (defaults to 5). Set to 0 to disable welcome credits for a tenant.
     *
     * @param array $user User record from the database
     * @param int $adminId ID of the approving admin
     * @return int The number of credits awarded (0 if disabled or on error)
     */
    private function grantWelcomeCredits(array $user, int $adminId): int
    {
        try {
            if (empty($user['tenant_id'])) {
                throw new \RuntimeException(__('api.user_missing_tenant_id'));
            }
            $userTenantId = (int) $user['tenant_id'];
            $userId = (int) $user['id'];

            // Read the welcome credits amount from the wallet settings key that the
            // admin Settings page writes to. Falls back to 'general.welcome_credits'
            // (legacy key) then to a hardcoded default of 5 so existing tenants that
            // haven't saved the setting yet still get the expected behaviour.
            $creditAmount = (int) $this->tenantSettingsService->get($userTenantId, 'wallet.starting_balance',
                $this->tenantSettingsService->get($userTenantId, 'general.welcome_credits', 5)
            );
            if ($creditAmount <= 0) {
                return 0;
            }

            DB::beginTransaction();

            try {
                // Lock the user row to prevent concurrent double-credit (TOCTOU race)
                DB::select(
                    "SELECT id FROM users WHERE id = ? AND tenant_id = ? FOR UPDATE",
                    [$userId, $userTenantId]
                );

                // Check if a welcome bonus was already granted (true idempotency key).
                // Also treat a 'starting_balance' transaction as already-granted so
                // this path can never stack on top of StartingBalanceService grants
                // (self-serve verification / admin-created users).
                $existing = DB::selectOne(
                    "SELECT id FROM transactions WHERE tenant_id = ? AND receiver_id = ? AND (description LIKE '[Welcome Bonus]%' OR transaction_type = 'starting_balance') LIMIT 1",
                    [$userTenantId, $userId]
                );

                if ($existing) {
                    DB::rollBack();
                    try { \Illuminate\Support\Facades\Log::warning("[AdminUsers] Welcome credits already exist for user #{$userId} (tenant {$userTenantId}) — skipping"); } catch (\Throwable) {}
                    return 0;
                }

                // Update user balance (scoped by user's tenant)
                DB::update(
                    "UPDATE users SET balance = balance + ? WHERE id = ? AND tenant_id = ?",
                    [$creditAmount, $userId, $userTenantId]
                );

                // Create transaction record for audit trail. sender_id=0 (system)
                // and transaction_type='starting_balance' — welcome credits are a
                // system grant, not a member exchange, and must never be written
                // as a self-'transfer' (that made gamification count them as the
                // member's first exchange/earn/spend).
                DB::insert(
                    "INSERT INTO transactions (tenant_id, sender_id, receiver_id, amount, description, status, transaction_type, created_at)
                     VALUES (?, 0, ?, ?, ?, 'completed', 'starting_balance', NOW())",
                    [$userTenantId, $userId, $creditAmount, "[Welcome Bonus] New member welcome credits (approved by admin #{$adminId})"]
                );

                DB::commit();
            } catch (\Throwable $e) {
                DB::rollBack();
                throw $e;
            }

            // Post-commit: activity log and diagnostic log — failures here are non-fatal
            // and must NOT re-throw (a log permission error must never roll back credits
            // that have already committed, and must never surface as a 500).
            try { ActivityLog::log($adminId, 'welcome_credits_issued', "Awarded {$creditAmount} welcome credits to user #{$userId} ({$user['email']}) on approval"); } catch (\Throwable) {}
            try { \Illuminate\Support\Facades\Log::info("[AdminUsers] Granted {$creditAmount} welcome credits to user #{$userId} (tenant {$userTenantId})"); } catch (\Throwable) {}

            return $creditAmount;
        } catch (\Throwable $e) {
            try { \Illuminate\Support\Facades\Log::warning("[AdminUsers] Failed to grant welcome credits to user #{$user['id']}: " . $e->getMessage()); } catch (\Throwable) {}
            return 0;
        }
    }

    /**
     * Send the combined welcome email when a user is approved.
     *
     * @param array $user User record from the database
     * @param int $creditsAwarded Number of welcome credits awarded (0 = none)
     * @return bool Whether the email was sent successfully
     */
    private function sendApprovalWelcomeEmail(array $user, int $creditsAwarded): bool
    {
        try {
            return LocaleContext::withLocale($user['preferred_language'] ?? null, function () use ($user, $creditsAwarded) {
                $tenant = $this->resolveUserTenant($user);
                $firstName = htmlspecialchars($user['first_name'] ?? __('emails.common.fallback_name'), ENT_QUOTES, 'UTF-8');
                $loginUrl = $tenant['frontend_url'] . $tenant['slug_prefix'] . '/login';
                $tenantNameSafe = htmlspecialchars($tenant['name'], ENT_QUOTES, 'UTF-8');

                $plural = $creditsAwarded !== 1 ? 's' : '';

                $builder = \App\Core\EmailTemplateBuilder::make()
                    ->theme('success')
                    ->title(__('emails_misc.admin_actions.approval_title'))
                    ->greeting(__('emails_misc.admin_actions.approval_greeting', ['name' => $firstName]))
                    ->paragraph(__('emails_misc.admin_actions.approval_body_intro', ['community' => $tenantNameSafe]));

                if ($creditsAwarded > 0) {
                    $builder->paragraph(__('emails_misc.admin_actions.approval_body_credits', [
                        'credits' => $creditsAwarded,
                        'plural'  => $plural,
                    ]));
                }

                $stepsHtml = '<p>' . __('emails_misc.admin_actions.approval_body_next_steps') . '</p>'
                    . '<ul style="padding-left: 20px; margin: 10px 0;">'
                    . '<li style="margin-bottom: 8px;">' . __('emails_misc.admin_actions.approval_list_browse') . '</li>'
                    . '<li style="margin-bottom: 8px;">' . __('emails_misc.admin_actions.approval_list_create_listing') . '</li>'
                    . '<li style="margin-bottom: 8px;">' . __('emails_misc.admin_actions.approval_list_connect') . '</li>'
                    . '<li style="margin-bottom: 8px;">' . __('emails_misc.admin_actions.approval_list_events') . '</li>'
                    . '</ul>';

                $html = $builder
                    ->paragraph($stepsHtml)
                    ->paragraph(__('emails_misc.admin_actions.approval_body_closing'))
                    ->button(__('emails_misc.admin_actions.approval_cta'), $loginUrl)
                    ->render();

                $subject = $creditsAwarded > 0
                    ? __('emails_misc.admin_actions.approval_subject_credits', ['community' => $tenantNameSafe, 'credits' => $creditsAwarded])
                    : __('emails_misc.admin_actions.approval_subject_approved', ['community' => $tenantNameSafe]);

                $result = EmailDispatchService::sendRaw($user['email'], $subject, $html, null, null, null, 'approval', ['tenant_id' => $tenant['tenant_id']]);

                if ($result) {
                    try { \Illuminate\Support\Facades\Log::info("[AdminUsers] Welcome email sent to user #{$user['id']} (credits: {$creditsAwarded})"); } catch (\Throwable) {}
                } else {
                    try { \Illuminate\Support\Facades\Log::warning("[AdminUsers] Mailer returned false for welcome email to user #{$user['id']} — check SMTP/Gmail config"); } catch (\Throwable) {}
                }

                return (bool) $result;
            });
        } catch (\Throwable $e) {
            try { \Illuminate\Support\Facades\Log::warning("[AdminUsers] Failed to send welcome email to user #{$user['id']}: " . $e->getMessage()); } catch (\Throwable) {}
            return false;
        }
    }

    /**
     * Create an in-app notification for the approved user.
     *
     * @param array $user User record from the database
     * @param int $creditsAwarded Number of welcome credits awarded (0 = none)
     */
    private function sendApprovalInAppNotification(array $user, int $creditsAwarded = 0): void
    {
        try {
            LocaleContext::withLocale($user['preferred_language'] ?? null, function () use ($user, $creditsAwarded) {
                $tenant = $this->resolveUserTenant($user);

                if ($creditsAwarded > 0) {
                    $plural = $creditsAwarded !== 1 ? 's' : '';
                    $message = __('emails_misc.admin_actions.approval_bell_credits', [
                        'community' => $tenant['name'],
                        'credits'   => $creditsAwarded,
                        'plural'    => $plural,
                    ]);
                } else {
                    $message = __('emails_misc.admin_actions.approval_bell', ['community' => $tenant['name']]);
                }

                Notification::createNotification(
                    (int) $user['id'],
                    $message,
                    '/dashboard',
                    'system',
                    true,
                    $tenant['tenant_id']
                );
                \App\Services\NotificationDispatcher::fanOutPush((int) $user['id'], 'system', $message, '/dashboard');
            });
        } catch (\Throwable $e) {
            try { \Illuminate\Support\Facades\Log::warning("[AdminUsers] Failed to create approval notification for user #{$user['id']}: " . $e->getMessage()); } catch (\Throwable) {}
        }
    }

    /**
     * Send reactivation notification email to a reactivated user.
     *
     * @param array $user User record from the database
     * @return bool Whether the email was sent successfully
     */
    private function sendReactivationNotificationEmail(array $user): bool
    {
        try {
            return LocaleContext::withLocale($user['preferred_language'] ?? null, function () use ($user) {
                $tenant = $this->resolveUserTenant($user);
                $firstName = htmlspecialchars($user['first_name'] ?? __('emails.common.fallback_name'), ENT_QUOTES, 'UTF-8');
                $tenantNameSafe = htmlspecialchars($tenant['name'], ENT_QUOTES, 'UTF-8');
                $loginUrl = $tenant['frontend_url'] . $tenant['slug_prefix'] . '/login';

                $html = \App\Core\EmailTemplateBuilder::make()
                    ->theme('brand')
                    ->title(__('svc_notifications.account_reactivated_title'))
                    ->greeting(__('emails_misc.admin_actions.reactivation_greeting', ['name' => $firstName]))
                    ->paragraph(__('emails_misc.admin_actions.reactivation_body', ['community' => $tenantNameSafe]))
                    ->paragraph(__('emails_misc.admin_actions.reactivation_body_access'))
                    ->button(__('emails_misc.admin_actions.reactivation_cta'), $loginUrl)
                    ->render();

                $result = EmailDispatchService::sendRaw(
                    $user['email'],
                    __('emails_misc.admin_actions.reactivation_subject', ['community' => $tenantNameSafe]),
                    $html,
                    null,
                    null,
                    null,
                    'admin_user_status',
                    ['tenant_id' => $tenant['tenant_id']]
                );

                if ($result) {
                    \Illuminate\Support\Facades\Log::info("[AdminUsers] Reactivation email sent to user #{$user['id']}");
                } else {
                    \Illuminate\Support\Facades\Log::warning("[AdminUsers] Mailer returned false for reactivation email to user #{$user['id']} — check SMTP/Gmail config");
                }

                return (bool) $result;
            });
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning("[AdminUsers] Failed to send reactivation email to user #{$user['id']}: " . $e->getMessage());
            return false;
        }
    }

    /**
     * Create an in-app notification for a reactivated user.
     *
     * @param array $user User record from the database
     */
    private function sendReactivationInAppNotification(array $user): void
    {
        try {
            LocaleContext::withLocale($user['preferred_language'] ?? null, function () use ($user) {
                $tenant = $this->resolveUserTenant($user);

                Notification::createNotification(
                    (int) $user['id'],
                    __('api_controllers_3.admin_bells.account_reactivated', ['community' => $tenant['name']]),
                    '/dashboard',
                    'system',
                    true,
                    $tenant['tenant_id']
                );
                \App\Services\NotificationDispatcher::fanOutPush((int) $user['id'], 'system', __('api_controllers_3.admin_bells.account_reactivated', ['community' => $tenant['name']]), '/dashboard');
            });
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning("[AdminUsers] Failed to create reactivation notification for user #{$user['id']}: " . $e->getMessage());
        }
    }

    // =========================================================================
    // Bulk Actions (TD11 — admin bulk-action parity)
    // =========================================================================

    private const BULK_MAX = 100;

    /**
     * Normalise and validate a bulk ID list from the request.
     *
     * @return array{0: ?array<int>, 1: ?JsonResponse}
     */
    private function parseBulkIds(string $field): array
    {
        $raw = $this->input($field, []);
        if (!is_array($raw) || empty($raw)) {
            return [null, $this->respondWithError(
                'VALIDATION_FAILED',
                __('api.bulk_ids_required'),
                $field,
                422
            )];
        }
        $ids = [];
        foreach ($raw as $v) {
            $id = (int) $v;
            if ($id > 0) {
                $ids[$id] = true;
            }
        }
        $ids = array_keys($ids);
        if (empty($ids)) {
            return [null, $this->respondWithError(
                'VALIDATION_FAILED',
                __('api.bulk_ids_required'),
                $field,
                422
            )];
        }
        if (count($ids) > self::BULK_MAX) {
            return [null, $this->respondWithError(
                'VALIDATION_FAILED',
                __('api.bulk_too_many', ['max' => self::BULK_MAX]),
                $field,
                422
            )];
        }
        return [$ids, null];
    }

    /** POST /api/v2/admin/users/bulk-approve */
    public function bulkApprove(): JsonResponse
    {
        // broker-or-admin: brokers clear the pending-approval queue in bulk.
        $adminId = $this->requireBrokerOrAdmin();
        $tenantId = $this->getTenantId();
        $this->rateLimit('admin_users_bulk', 10, 60);

        [$ids, $err] = $this->parseBulkIds('user_ids');
        if ($err) return $err;

        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $eligible = DB::select(
            "SELECT id, email, first_name, preferred_language, tenant_id, role, is_approved,
                    is_admin, is_super_admin, is_tenant_super_admin, is_god
             FROM users WHERE tenant_id = ? AND id IN ({$placeholders})",
            array_merge([$tenantId], $ids)
        );

        $eligibleById = [];
        foreach ($eligible as $row) {
            $eligibleById[(int) $row->id] = $row;
        }

        $success = 0;
        $failed = 0;
        $skippedIds = [];
        $touchedIds = [];

        foreach ($ids as $id) {
            if (!isset($eligibleById[$id])) {
                $skippedIds[] = $id;
                $failed++;
                continue;
            }
            $row = $eligibleById[$id];
            if (!$this->canManageSecurityTarget($adminId, (array) $row)) {
                $skippedIds[] = $id;
                $failed++;
                continue;
            }
            if (!empty($row->is_approved)) {
                // Repair pre-fix approvals that left status='pending'.
                $this->activatePendingStatus((int) $id, (int) $tenantId);
                $skippedIds[] = $id;
                continue;
            }
            try {
                $updated = DB::transaction(function () use ($adminId, $id, $tenantId): bool {
                    if ($this->lockManageableSecurityTarget($adminId, $id, $tenantId) === null) {
                        return false;
                    }
                    User::updateAdminFields($id, [
                        'role' => 'member',
                        'is_approved' => 1,
                        'tenant_id' => $tenantId,
                    ]);
                    $this->activatePendingStatus((int) $id, (int) $tenantId);
                    return true;
                }, 3);
                if (!$updated) {
                    $failed++;
                    $skippedIds[] = $id;
                    continue;
                }
                $userArr = (array) $row;
                $creditsAwarded = $this->grantWelcomeCredits($userArr, $adminId);
                $this->sendApprovalWelcomeEmail($userArr, $creditsAwarded);
                $this->sendApprovalInAppNotification($userArr, $creditsAwarded);
                $touchedIds[] = $id;
                $success++;
            } catch (\Throwable $e) {
                Log::warning("[AdminUsers] bulk-approve failed for user #{$id}: " . $e->getMessage());
                $failed++;
                $skippedIds[] = $id;
            }
        }

        ActivityLog::log(
            $adminId,
            'admin_bulk_approve_users',
            'Bulk approved ' . count($touchedIds) . ' users'
        );
        $this->auditLogService->log('admin_bulk_approve_users', null, $adminId, [
            'user_ids' => $touchedIds,
            'skipped_ids' => $skippedIds,
            'success' => $success,
            'failed' => $failed,
        ]);

        return $this->respondWithData([
            'success' => $success,
            'failed' => $failed,
            'skipped_ids' => $skippedIds,
        ]);
    }

    /** POST /api/v2/admin/users/bulk-suspend */
    public function bulkSuspend(): JsonResponse
    {
        // broker-or-admin: suspension is reversible; ban/delete stay admin-only.
        $adminId = $this->requireBrokerOrAdmin();
        $tenantId = $this->getTenantId();
        $this->rateLimit('admin_users_bulk', 10, 60);

        [$ids, $err] = $this->parseBulkIds('user_ids');
        if ($err) return $err;

        $reason = (string) $this->input('reason', __('svc_notifications.suspended_by_admin'));

        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $eligible = DB::select(
            "SELECT id, tenant_id, email, first_name, preferred_language, role,
                    is_admin, is_super_admin, is_tenant_super_admin, is_god
             FROM users WHERE tenant_id = ? AND id IN ({$placeholders})",
            array_merge([$tenantId], $ids)
        );

        $eligibleById = [];
        foreach ($eligible as $row) {
            $eligibleById[(int) $row->id] = $row;
        }

        $success = 0;
        $failed = 0;
        $skippedIds = [];
        $touchedIds = [];

        foreach ($ids as $id) {
            if ($id === $adminId) {
                $skippedIds[] = $id;
                $failed++;
                continue;
            }
            if (!isset($eligibleById[$id])) {
                $skippedIds[] = $id;
                $failed++;
                continue;
            }
            $row = $eligibleById[$id];
            if (!$this->canManageSecurityTarget($adminId, (array) $row)) {
                $skippedIds[] = $id;
                $failed++;
                continue;
            }
            try {
                $updated = DB::transaction(function () use ($adminId, $id, $tenantId): bool {
                    if ($this->lockManageableSecurityTarget($adminId, $id, $tenantId) === null) {
                        return false;
                    }
                    DB::update(
                        "UPDATE users SET status = 'suspended' WHERE id = ? AND tenant_id = ?",
                        [$id, $tenantId]
                    );
                    return true;
                }, 3);
                if (!$updated) {
                    $failed++;
                    $skippedIds[] = $id;
                    continue;
                }
                $this->notifySuspendedUser([
                    'id' => (int) $row->id,
                    'tenant_id' => (int) $row->tenant_id,
                    'email' => (string) $row->email,
                    'first_name' => $row->first_name ?? null,
                    'preferred_language' => $row->preferred_language ?? null,
                ], $id);
                $touchedIds[] = $id;
                $success++;
            } catch (\Throwable $e) {
                Log::warning("[AdminUsers] bulk-suspend failed for user #{$id}: " . $e->getMessage());
                $failed++;
                $skippedIds[] = $id;
            }
        }

        ActivityLog::log(
            $adminId,
            'admin_bulk_suspend_users',
            'Bulk suspended ' . count($touchedIds) . " users: {$reason}"
        );
        $this->auditLogService->log('admin_bulk_suspend_users', null, $adminId, [
            'user_ids' => $touchedIds,
            'skipped_ids' => $skippedIds,
            'success' => $success,
            'failed' => $failed,
            'reason' => $reason,
        ]);

        return $this->respondWithData([
            'success' => $success,
            'failed' => $failed,
            'skipped_ids' => $skippedIds,
        ]);
    }
}
