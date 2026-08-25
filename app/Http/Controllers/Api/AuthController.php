<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Services\RateLimitService;
use App\Services\TenantSettingsService;
use App\Services\TokenService;
use App\Services\TotpService;
use App\Services\TwoFactorChallengeManager;
use App\Services\AuthenticationConfigurationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use App\Core\ApiErrorCodes;
use App\Core\TenantContext;

/**
 * AuthController — Authentication: login, logout, token refresh, session management.
 */
class AuthController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly RateLimitService $rateLimitService,
        private readonly TenantSettingsService $tenantSettingsService,
        private readonly TokenService $tokenService,
        private readonly TotpService $totpService,
        private readonly TwoFactorChallengeManager $twoFactorChallengeManager,
    ) {}

    /**
     * Helper to return auth error response.
     *
     * Uses respondWithError() from BaseApiController for standard cases.
     * Falls back to a direct response when extra fields are needed to
     * preserve the auth-specific response contract (retry_after, etc.).
     */
    private function authError(string $message, string $code, int $status = 400, array $extra = []): JsonResponse
    {
        if (empty($extra)) {
            return $this->respondWithError($code, $message, null, $status);
        }

        // When extra fields are present, build a combined error envelope
        // that includes both the standard error structure and auth-specific fields.
        $response = array_merge([
            'errors' => [['code' => $code, 'message' => $message]],
            'success' => false,
        ], $extra);

        return response()->json($response, $status, [
            'API-Version' => '2.0',
        ]);
    }

    /**
     * POST /api/auth/login
     */
    public function login(): JsonResponse
    {
        $data = $this->getAllInput();
        $email = $data['email'] ?? '';
        $password = $data['password'] ?? '';

        // Defensive coercion: attackers send email[]=foo to break type-hinted helpers.
        if (!is_string($email)) {
            $email = '';
        }
        if (!is_string($password)) {
            $password = '';
        }

        if (empty($email) || empty($password)) {
            return $this->authError(
                __('api.email_and_password_required'),
                ApiErrorCodes::VALIDATION_REQUIRED_FIELD,
                400
            );
        }

        // Login Turnstile gate removed 2026-05-16 — member feedback found the
        // widget too confusing and the false-positive rate unacceptable. Bot
        // defence on this endpoint is the DB-backed per-email + per-IP brute
        // force limiter below + route-level throttle:nexus-route-30-per-1m.
        // SECURITY: Database-based brute force protection (tracks FAILED attempts only)
        // Route-level throttle:nexus-route-30-per-1m middleware handles general request-rate DoS protection.
        $ip = \App\Core\ClientIp::get();
        if (!empty($email)) {
            $emailLimit = \App\Core\RateLimiter::check($email, 'email');
            if ($emailLimit['limited']) {
                $message = \App\Core\RateLimiter::getRetryMessage($emailLimit['retry_after']);
                return $this->authError(
                    $message,
                    ApiErrorCodes::RATE_LIMIT_EXCEEDED,
                    429,
                    ['retry_after' => $emailLimit['retry_after']]
                );
            }
        }

        // Check rate limit by IP
        $ipLimit = \App\Core\RateLimiter::check($ip, 'ip');
        if ($ipLimit['limited']) {
            $message = \App\Core\RateLimiter::getRetryMessage($ipLimit['retry_after']);
            return $this->authError(
                $message,
                ApiErrorCodes::RATE_LIMIT_EXCEEDED,
                429,
                ['retry_after' => $ipLimit['retry_after']]
            );
        }

        // Start the authentication clock before reading/verifying the password.
        // A password change or logout-all that commits anywhere after this
        // point must invalidate a later second-factor completion.
        $authenticationStartedAt = time();

        // Scope login by tenant when tenant context is available.
        // Use a single UNION query that atomically checks both the tenant-scoped user
        // row and any super-admin cross-tenant row in one round-trip. This eliminates
        // the timing difference between a normal login and a super-admin login that
        // would otherwise create a username oracle (two separate queries ≠ equal timing).
        $tenantId = TenantContext::getId();
        $user = null;

        if ($tenantId) {
            // Priority 1: exact tenant match
            // Priority 2: platform-level administrator from any tenant
            // (cross-tenant fallback). Tenant administrators remain scoped to
            // their own community.
            // Priority 3: a member of a sub-community BENEATH the tenant this
            // request resolved to. A sub-tenant with no domain of its own is
            // only reachable at `<parent-domain>/<slug>`; arriving at the parent
            // domain root resolves the PARENT, so without this arm the member's
            // account is invisible and login fails with no explanation. The
            // boundary is the resolved tenant's own subtree — never "any
            // tenant" — see App\Support\Tenancy\TenantSubtree.
            //
            // The subtree is resolved BEFORE the user lookup and does not depend
            // on the submitted email, so it adds no email-enumeration timing
            // signal. It stays folded into the one UNION for the same reason the
            // super-admin arm is: two separate queries ≠ equal timing.
            $subtreeIds = \App\Support\Tenancy\TenantSubtree::descendantIds((int) $tenantId);

            $sql = "SELECT u.*, t.configuration, 1 AS _match_priority
                 FROM users u LEFT JOIN tenants t ON u.tenant_id = t.id
                 WHERE u.email = ? AND u.tenant_id = ?
                 UNION
                 SELECT u.*, t.configuration, 2 AS _match_priority
                 FROM users u LEFT JOIN tenants t ON u.tenant_id = t.id
                 WHERE u.email = ?
                   AND (
                       u.is_super_admin = 1
                       OR u.is_god = 1
                       OR u.role IN ('super_admin', 'god')
                   )";
            $bindings = [$email, $tenantId, $email];

            if ($subtreeIds !== []) {
                // Never interpolate the IDs — build placeholders (repo rule:
                // no arrays in query parameters).
                $placeholders = implode(',', array_fill(0, count($subtreeIds), '?'));
                $sql .= "
                 UNION
                 SELECT u.*, t.configuration, 3 AS _match_priority
                 FROM users u LEFT JOIN tenants t ON u.tenant_id = t.id
                 WHERE u.email = ? AND u.tenant_id IN ({$placeholders}) AND u.deleted_at IS NULL";
                $bindings[] = $email;
                foreach ($subtreeIds as $subtreeId) {
                    $bindings[] = $subtreeId;
                }
            }

            // Deterministic tie-break: exact tenant wins, then platform admin,
            // then the lowest-numbered sub-community. Fetch two rows so an
            // ambiguous sub-community match is visible rather than silent.
            $sql .= "
                 ORDER BY _match_priority ASC, tenant_id ASC
                 LIMIT 2";

            $rows = DB::select($sql, $bindings);
            $userRow = $rows[0] ?? null;
            $user = $userRow ? (array)$userRow : null;

            if (
                $user
                && (int) ($user['_match_priority'] ?? 0) === 3
                && isset($rows[1])
                && (int) (((array) $rows[1])['_match_priority'] ?? 0) === 3
            ) {
                // The same address exists in two sub-communities of this hub.
                // We sign them into the lowest-numbered one; reaching the other
                // requires its slug URL. Logged at warning so it is visible in
                // production, where the log level is `warning`.
                \Illuminate\Support\Facades\Log::warning('[Auth] ambiguous sub-community login match', [
                    'email_masked' => substr($email, 0, 2) . '***@' . (explode('@', $email)[1] ?? '***'),
                    'resolved_tenant_id' => (int) $tenantId,
                    'chosen_tenant_id' => (int) ($user['tenant_id'] ?? 0),
                ]);
            }

            // Remove internal sorting column from user array
            if ($user) {
                unset($user['_match_priority']);
            }
        } else {
            $userRow = DB::selectOne("SELECT u.*, t.configuration FROM users u LEFT JOIN tenants t ON u.tenant_id = t.id WHERE u.email = ?", [$email]);
            $user = $userRow ? (array)$userRow : null;
        }

        // Constant-time comparison
        $dummyHash = '$argon2id$v=19$m=65536,t=4,p=1$V1Jna0owWXBLNC55ajFQRQ$h0+cXUsJzOi6TzES3RPuquTJpwPbpYmVHS4A3ArHHXo';
        $passwordValid = password_verify($password, $user['password_hash'] ?? $dummyHash);

        if ($user && $passwordValid) {
            // Record successful login and clear failed attempts
            if (!empty($email)) {
                \App\Core\RateLimiter::recordAttempt($email, 'email', true);
            }
            \App\Core\RateLimiter::recordAttempt($ip, 'ip', true);

            // (DB brute force counters already cleared by recordAttempt with success=true)

            // Registration policy enforcement
            $gateBlock = $this->tenantSettingsService->checkLoginGatesForUser($user);
            if ($gateBlock) {
                return $this->authError(
                    $gateBlock['message'],
                    $gateBlock['code'],
                    403,
                    $gateBlock['extra']
                );
            }

            // Detect if this is a mobile/API request
            $isMobile = $this->tokenService->isMobileRequest();
            $wantsStateless = $isMobile || isset($_SERVER['HTTP_X_STATELESS_AUTH']);
            $userTenantId = (int) $user['tenant_id'];

            // ADMIN 2FA ENFORCEMENT — DISABLED until the dedicated setup UI
            // ships. Re-enable via the FORCE_ADMIN_2FA env flag once the
            // first-time setup page is in place. See temporary rollback at
            // commit 7fecb5b13 → unblock at <next>.
            $has2faEnabled = $this->totpService->isEnabled((int)$user['id'], $userTenantId);
            $isAdminAccount = in_array(($user['role'] ?? ''), ['admin', 'tenant_admin', 'org_admin', 'super_admin'], true)
                || !empty($user['is_super_admin'])
                || !empty($user['is_tenant_super_admin']);

            if (
                filter_var(env('FORCE_ADMIN_2FA', false), FILTER_VALIDATE_BOOLEAN)
                && TenantContext::runForTenant(
                    $userTenantId,
                    static fn (): bool => TenantContext::hasFeature('two_factor_authentication')
                )
                && $isAdminAccount
                && !$has2faEnabled
            ) {
                $setupToken = $this->twoFactorChallengeManager->create(
                    (int)$user['id'],
                    ['totp_setup'],
                    $userTenantId,
                    $authenticationStartedAt
                );
                return response()->json([
                    'success' => false,
                    'requires_2fa_setup' => true,
                    'two_factor_token' => $setupToken,
                    'code' => 'AUTH_2FA_SETUP_REQUIRED',
                    'message' => __('api_controllers_1.auth.two_factor_setup_required'),
                    'user' => [
                        'id' => $user['id'],
                        'first_name' => $user['first_name'],
                        'email_masked' => $this->maskEmail($user['email']),
                    ],
                ], 200);
            }

            // 2FA CHECK — ENFORCED FOR ALL USERS WHO HAVE IT ENABLED
            // user_totp_settings.is_enabled is the single source of truth.
            // The users.totp_enabled column can drift (e.g. initializeSetup resets
            // the settings row to is_enabled=0 but leaves users.totp_enabled=1),
            // which would gate login on 2FA the verify endpoint can't satisfy.
            $isTrustedDevice = $has2faEnabled
                && $this->totpService->isTrustedDevice((int)$user['id'], null, $userTenantId);

            if ($has2faEnabled && !$isTrustedDevice) {
                $authenticationConfig = app(AuthenticationConfigurationService::class)
                    ->getAll($userTenantId);
                // 2FA required - create challenge token
                $twoFactorToken = $this->twoFactorChallengeManager->create(
                    (int)$user['id'],
                    ['totp', 'backup_code'],
                    $userTenantId,
                    $authenticationStartedAt
                );

                // For session-based clients, also store in session
                if (!$wantsStateless) {
                    if (session_status() == PHP_SESSION_NONE) {
                        session_start();
                    }
                    $_SESSION['pending_2fa_user_id'] = $user['id'];
                    $_SESSION['pending_2fa_tenant_id'] = $userTenantId;
                    $_SESSION['pending_2fa_started_at'] = $authenticationStartedAt;
                    $_SESSION['pending_2fa_challenge_token'] = $twoFactorToken;
                    $_SESSION['pending_2fa_expires'] = time() + 300;
                }

                return response()->json([
                    'success' => false,
                    'requires_2fa' => true,
                    'two_factor_token' => $twoFactorToken,
                    'methods' => ['totp', 'backup_code'],
                    'allow_trusted_device' => (bool) ($authenticationConfig['two_factor.allow_trusted_devices'] ?? true),
                    'trusted_device_days' => (int) ($authenticationConfig['two_factor.trusted_device_days'] ?? 30),
                    'code' => ApiErrorCodes::AUTH_2FA_REQUIRED,
                    'message' => __('api_controllers_1.auth.two_factor_required'),
                    'user' => [
                        'id' => $user['id'],
                        'first_name' => $user['first_name'],
                        'email_masked' => $this->maskEmail($user['email'])
                    ]
                ], 200);
            }

            // NO 2FA or TRUSTED DEVICE - Complete login normally

            // Ordinary API login is JWT-only. Re-read and verify the password
            // while holding the same user-row lock used by session revocation,
            // then issue both credentials before releasing it. A concurrent
            // password change can therefore never mint a session from the old hash.
            $issuance = DB::transaction(function () use (
                $user,
                $password,
                $isMobile,
                $authenticationStartedAt
            ): array {
                $lockedRow = DB::table('users')
                    ->where('id', (int) $user['id'])
                    ->where('tenant_id', (int) $user['tenant_id'])
                    ->lockForUpdate()
                    ->first();
                if (
                    $lockedRow === null
                    || !password_verify($password, (string) ($lockedRow->password_hash ?? ''))
                ) {
                    return ['status' => 'credentials_changed'];
                }

                // Logout-all uses this same row lock and advances the global
                // revocation cutoff. If it committed after this password flow
                // began, do not recreate a session immediately after the user
                // explicitly revoked every session.
                if (!$this->tokenService->isAuthenticationStartValid(
                    (int) $user['id'],
                    $authenticationStartedAt
                )) {
                    return ['status' => 'authentication_invalidated'];
                }

                $lockedUser = array_merge($user, (array) $lockedRow);
                $lockedGateBlock = $this->tenantSettingsService->checkLoginGatesForUser($lockedUser);
                if ($lockedGateBlock) {
                    return ['status' => 'gate_blocked', 'gate' => $lockedGateBlock];
                }

                $accessToken = $this->tokenService->generateToken(
                    (int) $lockedUser['id'],
                    (int) $lockedUser['tenant_id'],
                    [
                        'role' => $lockedUser['role'],
                        'email' => $lockedUser['email'],
                        'is_super_admin' => !empty($lockedUser['is_super_admin']),
                        'is_tenant_super_admin' => !empty($lockedUser['is_tenant_super_admin']),
                        'is_god' => !empty($lockedUser['is_god']),
                    ],
                    $isMobile
                );
                $refreshToken = $this->tokenService->generateRefreshToken(
                    (int) $lockedUser['id'],
                    (int) $lockedUser['tenant_id'],
                    $isMobile
                );

                DB::table('users')
                    ->where('id', (int) $lockedUser['id'])
                    ->where('tenant_id', (int) $lockedUser['tenant_id'])
                    ->update(['last_login_at' => now()]);

                return [
                    'status' => 'issued',
                    'user' => $lockedUser,
                    'access_token' => $accessToken,
                    'refresh_token' => $refreshToken,
                ];
            }, 3);

            if (($issuance['status'] ?? null) === 'gate_blocked') {
                $lockedGateBlock = $issuance['gate'];
                return $this->authError(
                    $lockedGateBlock['message'],
                    $lockedGateBlock['code'],
                    403,
                    $lockedGateBlock['extra']
                );
            }

            if (($issuance['status'] ?? null) === 'authentication_invalidated') {
                return $this->authError(
                    __('api.invalid_credentials'),
                    ApiErrorCodes::AUTH_INVALID_CREDENTIALS,
                    401
                );
            }

            if (($issuance['status'] ?? null) === 'issued') {
                $user = $issuance['user'];
                $accessToken = $issuance['access_token'];
                $refreshToken = $issuance['refresh_token'];

                return response()->json([
                    'success' => true,
                    'user' => [
                        'id' => $user['id'],
                        'first_name' => $user['first_name'],
                        'last_name' => $user['last_name'],
                        'email' => $user['email'],
                        'avatar_url' => $user['avatar_url'],
                        'tenant_id' => $user['tenant_id'],
                        'role' => $user['role'] ?? 'member',
                        'is_admin' => in_array($user['role'] ?? '', ['admin', 'tenant_admin', 'super_admin']) || !empty($user['is_super_admin']) || !empty($user['is_tenant_super_admin']),
                        'is_super_admin' => !empty($user['is_super_admin']),
                        'is_god' => !empty($user['is_god']),
                        'is_tenant_super_admin' => !empty($user['is_tenant_super_admin']),
                        'onboarding_completed' => (bool)($user['onboarding_completed'] ?? false),
                    ],
                    'access_token' => $accessToken,
                    'refresh_token' => $refreshToken,
                    'token_type' => 'Bearer',
                    'expires_in' => $this->tokenService->getAccessTokenExpiry($isMobile),
                    'refresh_expires_in' => $this->tokenService->getRefreshTokenExpiry($isMobile),
                    'is_mobile' => $isMobile,
                    'token' => $accessToken,
                    'sanctum_token' => null,
                    'config' => json_decode($user['configuration'] ?? '{"modules": {"events": true, "polls": true, "goals": true, "volunteering": true, "resources": true}}', true)
                ]);
            }
        }

        // Record failed login attempt
        if (!empty($email)) {
            \App\Core\RateLimiter::recordAttempt($email, 'email', false);
        }
        \App\Core\RateLimiter::recordAttempt($ip, 'ip', false);

        // Log failed login to application logs for security monitoring
        // Email is masked to prevent PII leakage in logs
        $maskedEmail = !empty($email) ? substr($email, 0, 2) . '***@' . (explode('@', $email)[1] ?? '***') : 'empty';
        \Illuminate\Support\Facades\Log::warning('Failed login attempt', [
            'email_masked' => $maskedEmail,
            'ip' => $ip,
            'tenant_id' => $tenantId,
            'user_agent' => request()->userAgent(),
        ]);

        return $this->authError(
            __('api.invalid_credentials'),
            ApiErrorCodes::AUTH_INVALID_CREDENTIALS,
            401
        );
    }

    /**
     * POST /api/auth/logout
     */
    public function logout(Request $request): JsonResponse
    {
        if (session_status() == PHP_SESSION_NONE) {
            session_start();
        }

        // Get user ID before clearing session
        $userId = $_SESSION['user_id'] ?? null;

        // Also check Bearer token for user ID
        if (!$userId) {
            $userId = $this->getOptionalUserId();
        }

        // Revoke the current Sanctum token if present
        $sanctumTokenRevoked = false;
        try {
            if ($request->user() && $request->user()->currentAccessToken()) {
                $request->user()->currentAccessToken()->delete();
                $sanctumTokenRevoked = true;
            }
        } catch (\Throwable $e) {
            // Sanctum may not be fully set up yet — ignore gracefully
            \Illuminate\Support\Facades\Log::warning('[AuthController] Sanctum token revocation failed: ' . $e->getMessage());
        }

        // Revoke a submitted refresh family even when the short-lived access
        // token has already expired. TokenService validates the signed token
        // and persisted tenant/user binding before revoking its own family.
        $data = $this->getAllInput();
        $refreshToken = $data['refresh_token'] ?? '';
        if (!is_string($refreshToken)) {
            $refreshToken = '';
        }
        $tokenRevoked = false;
        $accessTokenRevoked = false;

        $accessToken = $request->bearerToken();
        if (is_string($accessToken) && $accessToken !== '') {
            $accessTokenRevoked = $this->tokenService->revokeAccessToken($accessToken, $userId);
        }

        if ($refreshToken !== '') {
            $tokenRevoked = $this->tokenService->revokeToken($refreshToken, $userId);
        }

        // Clear all session data
        $_SESSION = [];

        // Delete session cookie
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(
                session_name(),
                '',
                time() - 42000,
                $params['path'],
                $params['domain'],
                $params['secure'],
                $params['httponly']
            );
        }

        // Destroy the session
        session_destroy();

        $response = [
            'success' => true,
            'message' => __('api_controllers_1.auth.logged_out')
        ];

        if ($tokenRevoked) {
            $response['refresh_token_revoked'] = true;
        }

        if ($accessTokenRevoked) {
            $response['access_token_revoked'] = true;
        }

        if ($sanctumTokenRevoked) {
            $response['sanctum_token_revoked'] = true;
        }

        return response()->json($response);
    }

    /**
     * POST /api/auth/refresh-token
     */
    public function refreshToken(): JsonResponse
    {
        // Rate limiting
        $ip = \App\Core\ClientIp::get();
        if (!$this->rateLimitService->increment("auth:refresh:$ip", 10, 60)) {
            return $this->authError(
                __('api.too_many_attempts'),
                ApiErrorCodes::RATE_LIMIT_EXCEEDED,
                429,
                ['retry_after' => 60]
            );
        }

        $data = $this->getAllInput();
        $refreshToken = $data['refresh_token'] ?? '';
        if (!is_string($refreshToken)) {
            $refreshToken = '';
        }

        // Also check Authorization header
        if (empty($refreshToken)) {
            $authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
            if (preg_match('/Bearer\s+(.+)$/i', $authHeader, $matches)) {
                $refreshToken = $matches[1];
            }
        }

        if (empty($refreshToken)) {
            return $this->authError(
                __('api.refresh_token_required'),
                ApiErrorCodes::AUTH_TOKEN_MISSING,
                400
            );
        }

        // Inspect tracked state without consuming it yet. This deliberately
        // leaves consumed rows visible so the atomic rotation step can detect
        // reuse and revoke the token family.
        $payload = $this->tokenService->inspectRefreshTokenForRotation($refreshToken);

        if (!$payload) {
            return $this->authError(
                __('api.invalid_or_expired_refresh_token'),
                ApiErrorCodes::AUTH_TOKEN_EXPIRED,
                401
            );
        }

        $userId = $payload['user_id'] ?? null;
        $tenantId = $payload['tenant_id'] ?? null;

        if (!$userId || !$tenantId) {
            return $this->authError(
                __('api.invalid_token_payload'),
                ApiErrorCodes::AUTH_TOKEN_INVALID,
                401
            );
        }

        // A refresh token is a tenant-bound capability. Reject a valid token
        // presented through another tenant before rotation can mutate it.
        if ((int) TenantContext::getId() !== (int) $tenantId) {
            return $this->authError(
                __('api.invalid_or_expired_refresh_token'),
                ApiErrorCodes::AUTH_TOKEN_INVALID,
                401
            );
        }

        $isMobile = $this->tokenService->isMobileRequest();

        // Hold the user lock across policy re-check, refresh rotation, and
        // replacement access-token issuance. Logout-all/password changes take
        // the same lock, so revocation can only happen wholly before or after
        // this credential pair is minted.
        $issuance = DB::transaction(function () use (
            $refreshToken,
            $userId,
            $tenantId,
            $isMobile
        ): array {
            $userRow = DB::table('users')
                ->where('id', (int) $userId)
                ->where('tenant_id', (int) $tenantId)
                ->lockForUpdate()
                ->first([
                    'id',
                    'email',
                    'role',
                    'status',
                    'is_super_admin',
                    'is_tenant_super_admin',
                    'tenant_id',
                    'email_verified_at',
                    'is_approved',
                ]);
            if ($userRow === null) {
                return ['status' => 'user_not_found'];
            }
            $user = (array) $userRow;

            if (($user['status'] ?? 'active') === 'suspended') {
                return ['status' => 'suspended'];
            }

            $gateBlock = $this->tenantSettingsService->checkLoginGatesForUser($user);
            if ($gateBlock) {
                return ['status' => 'gate_blocked', 'gate' => $gateBlock];
            }

            $rotation = $this->tokenService->rotateRefreshToken($refreshToken);
            if ($rotation === null) {
                return ['status' => 'rotation_failed'];
            }
            if (
                ($rotation['outcome'] ?? null)
                === TokenService::REFRESH_ROTATION_OUTCOME_RECENTLY_CONSUMED
            ) {
                return ['status' => 'refresh_superseded'];
            }
            if (
                ($rotation['outcome'] ?? null)
                !== TokenService::REFRESH_ROTATION_OUTCOME_ROTATED
            ) {
                return ['status' => 'rotation_failed'];
            }
            $refreshFamilyId = $rotation['payload']['family_id'] ?? null;
            if (!is_string($refreshFamilyId) || $refreshFamilyId === '') {
                return ['status' => 'rotation_failed'];
            }

            $accessToken = $this->tokenService->generateToken(
                (int) $userId,
                (int) $tenantId,
                [
                    'role' => $user['role'],
                    'email' => $user['email'],
                    'is_super_admin' => !empty($user['is_super_admin']),
                    'is_tenant_super_admin' => !empty($user['is_tenant_super_admin']),
                    'refresh_family_id' => $refreshFamilyId,
                ],
                $isMobile
            );

            return [
                'status' => 'issued',
                'access_token' => $accessToken,
                'rotation' => $rotation,
            ];
        }, 3);

        if (($issuance['status'] ?? null) === 'user_not_found') {
            return $this->authError(
                __('api.user_not_found'),
                ApiErrorCodes::RESOURCE_NOT_FOUND,
                401
            );
        }
        if (($issuance['status'] ?? null) === 'suspended') {
            return $this->authError(
                __('api.account_suspended'),
                ApiErrorCodes::AUTH_ACCOUNT_SUSPENDED,
                403
            );
        }
        if (($issuance['status'] ?? null) === 'gate_blocked') {
            $gateBlock = $issuance['gate'];
            return $this->authError(
                $gateBlock['message'],
                $gateBlock['code'],
                403,
                $gateBlock['extra']
            );
        }
        if (($issuance['status'] ?? null) === 'refresh_superseded') {
            return $this->authError(
                __('api.refresh_token_superseded'),
                ApiErrorCodes::AUTH_REFRESH_SUPERSEDED,
                409,
                ['success' => false]
            );
        }
        if (($issuance['status'] ?? null) !== 'issued') {
            return $this->authError(
                __('api.invalid_or_expired_refresh_token'),
                ApiErrorCodes::AUTH_TOKEN_EXPIRED,
                401
            );
        }

        $newAccessToken = $issuance['access_token'];
        $rotation = $issuance['rotation'];

        $response = [
            'success' => true,
            'access_token' => $newAccessToken,
            'token_type' => 'Bearer',
            'expires_in' => $this->tokenService->getAccessTokenExpiry($isMobile),
            'is_mobile' => $isMobile,
            'token' => $newAccessToken,
            'refresh_token' => $rotation['refresh_token'],
            'refresh_expires_in' => $rotation['expires_in'],
        ];

        return response()->json($response);
    }

    /**
     * POST /api/v2/auth/impersonate/exchange
     *
     * Exchange a single-use impersonation proof (issued by an admin through
     * /v2/admin/users/{id}/impersonate) for a real access token scoped to the
     * target member.
     *
     * Unauthenticated by design: the caller holds no session for the target
     * user yet, which is the entire point of the exchange. The proof itself is
     * the credential — signed, five-minute, single-use, and consumed here.
     */
    public function impersonateExchange(): JsonResponse
    {
        $data = $this->getAllInput();
        $proof = trim((string) ($data['token'] ?? $data['impersonation_token'] ?? ''));

        if ($proof === '') {
            return $this->authError(
                __('api.impersonation_token_required'),
                ApiErrorCodes::VALIDATION_ERROR,
                422
            );
        }

        // Single-use: this consumes the proof, so every failure below is final
        // and the admin must start a fresh impersonation.
        $payload = $this->tokenService->validateImpersonationToken($proof);
        if ($payload === null) {
            return $this->authError(
                __('api.impersonation_token_invalid'),
                ApiErrorCodes::AUTH_TOKEN_EXPIRED,
                401
            );
        }

        $targetId = (int) ($payload['user_id'] ?? 0);
        $tokenTenantId = (int) ($payload['tenant_id'] ?? 0);
        $adminId = (int) ($payload['impersonated_by'] ?? 0);

        // The proof is bound to one community. Refuse to spend it against a
        // different tenant host even though the signature would still verify.
        $resolvedTenantId = TenantContext::getId();
        if ($resolvedTenantId && $tokenTenantId !== (int) $resolvedTenantId) {
            return $this->authError(
                __('api.impersonation_token_wrong_tenant'),
                ApiErrorCodes::AUTH_INSUFFICIENT_PERMISSIONS,
                403
            );
        }

        $target = DB::table('users')
            ->where('id', $targetId)
            ->where('tenant_id', $tokenTenantId)
            ->first();

        if ($target === null || ($target->status ?? '') !== 'active') {
            return $this->authError(
                __('api.impersonation_target_unavailable'),
                ApiErrorCodes::AUTH_INSUFFICIENT_PERMISSIONS,
                403
            );
        }

        // Re-check both tiers at spend time. The proof was authorised up to five
        // minutes ago; a promotion in between must not become a route into a
        // platform-administrator session.
        if (!empty($target->is_super_admin) || !empty($target->is_god)
            || in_array($target->role ?? '', ['super_admin', 'god'], true)) {
            return $this->authError(
                __('api.impersonation_target_unavailable'),
                ApiErrorCodes::AUTH_INSUFFICIENT_PERMISSIONS,
                403
            );
        }

        $admin = DB::table('users')->where('id', $adminId)->first();
        if ($admin === null || ($admin->status ?? '') !== 'active'
            || !\App\Support\Authorization\AdminTier::allows($admin)) {
            return $this->authError(
                __('api.impersonation_actor_unavailable'),
                ApiErrorCodes::AUTH_INSUFFICIENT_PERMISSIONS,
                403
            );
        }

        $session = $this->tokenService->generateImpersonationSessionToken(
            $targetId,
            $tokenTenantId,
            $adminId
        );

        \Illuminate\Support\Facades\Log::info('[Auth] Impersonation session started', [
            'admin_id' => $adminId,
            'target_user_id' => $targetId,
            'tenant_id' => $tokenTenantId,
        ]);

        return response()->json([
            'success' => true,
            'access_token' => $session['token'],
            'token' => $session['token'],
            'token_type' => 'Bearer',
            'expires_in' => $session['expires_in'],
            // Deliberately absent: refresh_token. See
            // TokenService::generateImpersonationSessionToken().
            'impersonation' => [
                'active' => true,
                'user_id' => $targetId,
                'user_name' => trim((string) ($target->first_name ?? '') . ' ' . (string) ($target->last_name ?? '')),
                'tenant_id' => $tokenTenantId,
                'admin_id' => $adminId,
                'admin_name' => trim((string) ($admin->first_name ?? '') . ' ' . (string) ($admin->last_name ?? '')),
                'expires_in' => $session['expires_in'],
            ],
        ]);
    }

    /**
     * POST /api/v2/auth/impersonate/end
     *
     * Ends the calling impersonated session only. The member's own sessions are
     * untouched — this is not a logout-everywhere.
     */
    public function impersonateEnd(Request $request): JsonResponse
    {
        $header = (string) $request->header('Authorization', '');
        $token = str_starts_with($header, 'Bearer ') ? substr($header, 7) : (string) $request->cookie('auth_token');

        if ($token === '') {
            return $this->authError(
                __('api.impersonation_session_not_found'),
                ApiErrorCodes::VALIDATION_ERROR,
                422
            );
        }

        $revoked = $this->tokenService->revokeImpersonationSession($token);
        if (!$revoked) {
            return $this->authError(
                __('api.impersonation_session_not_found'),
                ApiErrorCodes::VALIDATION_ERROR,
                422
            );
        }

        return $this->respondWithData(['ended' => true]);
    }

    /**
     * POST /api/auth/heartbeat
     */
    public function heartbeat(): JsonResponse
    {
        if (session_status() == PHP_SESSION_NONE) {
            session_start();
        }

        $sessionIdentity = $this->resolveValidApiSessionIdentity();
        $isSessionAuth = $sessionIdentity !== null;

        // Check Bearer token authentication
        $tokenInfo = null;
        $isBearerAuth = false;
        $bearerUserId = null;
        $bearerTenantId = null;
        $authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
        if (preg_match('/Bearer\s+(.+)$/i', $authHeader, $matches)) {
            $token = $matches[1];
            $payload = $this->tokenService->validateToken($token);
            if ($payload) {
                $tokenInfo = [
                    'valid' => true,
                    'expires_at' => date('c', $payload['exp']),
                    'time_remaining' => $payload['exp'] - time(),
                    'needs_refresh' => $this->tokenService->needsRefresh($token)
                ];
                $isBearerAuth = true;
                $bearerUserId = $payload['user_id'];
                $bearerTenantId = $payload['tenant_id'];
            } else {
                $tokenInfo = [
                    'valid' => false,
                    'needs_refresh' => true
                ];
            }
        }

        $isAuthenticated = $isSessionAuth || $isBearerAuth;

        if (!$isAuthenticated) {
            return $this->authError(
                __('api.unauthorized'),
                ApiErrorCodes::AUTH_TOKEN_MISSING,
                401,
                ['authenticated' => false, 'token' => $tokenInfo]
            );
        }

        $userId = $isBearerAuth ? $bearerUserId : ($sessionIdentity['user_id'] ?? null);
        $tenantId = $isBearerAuth ? $bearerTenantId : ($sessionIdentity['tenant_id'] ?? null);

        // For Bearer-authenticated requests, verify user still exists
        if ($isBearerAuth && $bearerUserId) {
            try {
                $bearerUser = \App\Models\User::findById((int)$bearerUserId, false);
                if (!$bearerUser || ($bearerUser['status'] ?? 'active') === 'suspended') {
                    return $this->authError(
                        __('api.user_not_found'),
                        ApiErrorCodes::AUTH_ACCOUNT_DELETED,
                        401,
                        ['authenticated' => false, 'should_reauth' => true]
                    );
                }
            } catch (\Throwable $e) {
                \Illuminate\Support\Facades\Log::warning('[Heartbeat] Bearer user check failed: ' . $e->getMessage());
            }
        }

        // For session-authenticated requests, perform session-related operations
        if (!$isBearerAuth && $isSessionAuth) {
            $lastUserCheck = $_SESSION['_last_user_check'] ?? 0;
            if (time() - $lastUserCheck >= 300) {
                try {
                    $user = \App\Models\User::findById($sessionIdentity['user_id'], false);

                    if (!$user) {
                        $maxRetries = 3;
                        for ($i = 0; $i < $maxRetries && !$user; $i++) {
                            usleep(200000);
                            $user = \App\Models\User::findById($sessionIdentity['user_id'], false);
                        }
                    }

                    if (!$user) {
                        \Illuminate\Support\Facades\Log::warning('[Heartbeat] Session user not found after retries', [
                            'user_id' => $sessionIdentity['user_id'],
                        ]);
                        return $this->authError(
                            __('api.user_not_found'),
                            ApiErrorCodes::AUTH_ACCOUNT_DELETED,
                            401,
                            ['authenticated' => false, 'should_reauth' => true]
                        );
                    }
                    $_SESSION['_last_user_check'] = time();
                } catch (\Throwable $e) {
                    \Illuminate\Support\Facades\Log::warning('[Heartbeat] User check failed: ' . $e->getMessage());
                }
            }

            $_SESSION['_last_heartbeat'] = time();
        }

        // A compatibility session inherits the source access token's fixed
        // expiry. Heartbeats never extend this security boundary.
        $sessionLifetime = $sessionIdentity === null
            ? 0
            : max(0, $sessionIdentity['expires_at'] - time());
        $expiresAt = $sessionIdentity === null
            ? null
            : date('c', $sessionIdentity['expires_at']);

        // Update user's last_active_at in database (throttled)
        static $lastActiveUpdated = false;
        if (!$lastActiveUpdated && $userId) {
            $shouldUpdate = $isBearerAuth;
            if (!$isBearerAuth) {
                $lastUpdate = $_SESSION['_last_active_update'] ?? 0;
                $shouldUpdate = (time() - $lastUpdate >= 60);
            }

            if ($shouldUpdate) {
                try {
                    if (class_exists('\App\Models\User')) {
                        \App\Models\User::updateLastActive((int)$userId);
                        if (!$isBearerAuth) {
                            $_SESSION['_last_active_update'] = time();
                        }
                        $lastActiveUpdated = true;
                    }
                } catch (\Throwable $e) {
                    // Silently fail
                }
            }
        }

        // Also trigger presence heartbeat so auth heartbeat doubles as presence ping
        if ($userId) {
            try {
                \App\Services\PresenceService::heartbeat((int) $userId);
            } catch (\Throwable) {
                // Non-critical — presence is best-effort
            }
        }

        $response = [
            'success' => true,
            'authenticated' => true,
            'auth_type' => $isBearerAuth ? 'bearer' : 'session',
            'user_id' => $userId
        ];

        if (!$isBearerAuth) {
            $response['expires_at'] = $expiresAt;
            $response['session_lifetime'] = $sessionLifetime;
        }

        if ($tokenInfo !== null) {
            $response['token'] = $tokenInfo;
        }

        return response()->json($response);
    }

    /**
     * GET /api/auth/check-session
     */
    public function checkSession(): JsonResponse
    {
        if (session_status() == PHP_SESSION_NONE) {
            session_start();
        }

        $sessionIdentity = $this->resolveValidApiSessionIdentity();
        if ($sessionIdentity !== null) {
            return response()->json([
                'success' => true,
                'authenticated' => true,
                'user' => [
                    'id' => $sessionIdentity['user_id'],
                    'role' => $_SESSION['user_role'] ?? 'member',
                    'tenant_id' => $sessionIdentity['tenant_id']
                ]
            ]);
        }

        return $this->authError(
            __('api.not_authenticated'),
            ApiErrorCodes::AUTH_TOKEN_MISSING,
            401,
            ['authenticated' => false]
        );
    }

    /**
     * POST /api/auth/refresh-session
     */
    public function refreshSession(): JsonResponse
    {
        if (session_status() == PHP_SESSION_NONE) {
            session_start();
        }

        $sessionIdentity = $this->resolveValidApiSessionIdentity();
        if ($sessionIdentity === null) {
            return $this->authError(
                __('api.unauthorized'),
                ApiErrorCodes::AUTH_TOKEN_MISSING,
                401
            );
        }

        $_SESSION['_session_refreshed_at'] = time();

        $sessionLifetime = max(0, $sessionIdentity['expires_at'] - time());
        $expiresAt = date('c', $sessionIdentity['expires_at']);

        return response()->json([
            'success' => true,
            'message' => __('api_controllers_1.auth.session_refreshed'),
            'expires_at' => $expiresAt,
            'session_lifetime' => $sessionLifetime
        ]);
    }

    /**
     * POST /api/auth/restore-session
     *
     * @deprecated Sunset: 2026-08-01
     */
    public function restoreSession(): JsonResponse
    {
        if (session_status() == PHP_SESSION_NONE) {
            session_start();
        }

        // Check Bearer token
        $authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
        if (empty($authHeader) || !preg_match('/Bearer\s+(.+)$/i', $authHeader, $matches)) {
            return $this->authError(
                __('api.bearer_token_required'),
                ApiErrorCodes::AUTH_TOKEN_MISSING,
                400
            );
        }

        $token = $matches[1];
        $payload = $this->tokenService->validateToken($token);

        if (!$payload || ($payload['type'] ?? 'access') !== 'access') {
            return $this->authError(
                __('api.invalid_or_expired_token'),
                ApiErrorCodes::AUTH_TOKEN_INVALID,
                401
            );
        }

        $userId = $payload['user_id'] ?? null;

        if (!$userId) {
            return $this->authError(
                __('api.invalid_token_payload'),
                ApiErrorCodes::AUTH_TOKEN_INVALID,
                401
            );
        }

        // Fetch user data to populate session — scoped by tenant to prevent cross-tenant session restore
        $tenantId = TenantContext::getId();
        $userRow = DB::selectOne(
            "SELECT id, first_name, last_name, email, role, status, avatar_url, tenant_id, is_super_admin, is_tenant_super_admin, email_verified_at, is_approved FROM users WHERE id = ? AND tenant_id = ?",
            [$userId, $tenantId]
        );
        $user = $userRow ? (array)$userRow : null;

        if (!$user) {
            return $this->authError(
                __('api.user_not_found'),
                ApiErrorCodes::RESOURCE_NOT_FOUND,
                401
            );
        }

        if ((int) ($payload['tenant_id'] ?? 0) !== (int) $user['tenant_id']) {
            return $this->authError(
                __('api.invalid_token_payload'),
                ApiErrorCodes::AUTH_TOKEN_INVALID,
                401
            );
        }

        // Enforce registration policy gates on session restore
        $gateBlock = $this->tenantSettingsService->checkLoginGatesForUser($user);
        if ($gateBlock) {
            return $this->authError(
                $gateBlock['message'],
                $gateBlock['code'],
                403,
                $gateBlock['extra']
            );
        }

        // Restore a bounded compatibility session. It inherits the access
        // token's issue/expiry window and remains subject to global revocation.
        session_regenerate_id(true);
        if (!$this->stampApiSessionAccessWindow($payload)) {
            $this->clearApiSessionAuthentication();
            return $this->authError(
                __('api.invalid_or_expired_token'),
                ApiErrorCodes::AUTH_TOKEN_INVALID,
                401
            );
        }

        $_SESSION['user_id'] = $user['id'];
        $_SESSION['user_name'] = $user['first_name'] . ' ' . $user['last_name'];
        $_SESSION['user_email'] = $user['email'];
        $_SESSION['user_role'] = $user['role'] ?? 'member';
        $_SESSION['role'] = $user['role'] ?? 'member';
        $_SESSION['is_super_admin'] = $user['is_super_admin'] ?? 0;
        $_SESSION['is_tenant_super_admin'] = $user['is_tenant_super_admin'] ?? 0;
        $_SESSION['tenant_id'] = $user['tenant_id'];
        $_SESSION['user_avatar'] = $user['avatar_url'] ?? '/assets/img/defaults/default_avatar.png';
        $_SESSION['is_logged_in'] = true;

        $adminRoles = ['admin', 'super_admin', 'tenant_admin'];
        $_SESSION['is_admin'] = in_array($user['role'], $adminRoles) ? 1 : 0;

        return response()->json([
            'success' => true,
            'message' => __('api_controllers_1.auth.session_restored'),
            'user_id' => $user['id'],
            'session_id' => session_id(),
            '_deprecated' => [
                'message' => __('api_controllers_1.auth.session_deprecated'),
                'sunset' => '2026-08-01',
                'replacement' => 'Use Authorization: Bearer <token> header on all API requests'
            ]
        ], 200, [
            'X-API-Deprecated' => 'true',
            'Sunset' => 'Sat, 01 Aug 2026 00:00:00 GMT',
        ]);
    }

    /**
     * POST /api/auth/validate-token
     */
    public function validateToken(): JsonResponse
    {
        $token = null;

        // Check Authorization header first
        $authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
        if (preg_match('/Bearer\s+(.+)$/i', $authHeader, $matches)) {
            $token = $matches[1];
        }

        // Fallback to request body
        if (!$token) {
            $data = $this->getAllInput();
            $token = $data['token'] ?? $data['access_token'] ?? '';
            if (!is_string($token)) {
                $token = '';
            }
        }

        if (empty($token)) {
            return $this->authError(
                __('api.token_required'),
                ApiErrorCodes::AUTH_TOKEN_MISSING,
                400
            );
        }

        $payload = $this->tokenService->validateToken($token);

        if (!$payload) {
            return $this->authError(
                __('api.invalid_or_expired_token'),
                ApiErrorCodes::AUTH_TOKEN_INVALID,
                401,
                ['valid' => false]
            );
        }

        return response()->json([
            'success' => true,
            'valid' => true,
            'user_id' => $payload['user_id'],
            'tenant_id' => $payload['tenant_id'],
            'type' => $payload['type'] ?? 'access',
            'expires_at' => date('c', $payload['exp']),
            'time_remaining' => $payload['exp'] - time(),
            'needs_refresh' => $this->tokenService->needsRefresh($token)
        ]);
    }

    /**
     * POST /api/auth/revoke
     */
    public function revokeToken(): JsonResponse
    {
        $userId = $this->getOptionalUserId();
        if (!$userId) {
            return $this->authError(
                __('api.auth_required'),
                ApiErrorCodes::AUTH_TOKEN_MISSING,
                401
            );
        }

        $data = $this->getAllInput();
        $refreshToken = $data['refresh_token'] ?? '';
        if (!is_string($refreshToken)) {
            $refreshToken = '';
        }

        if (empty($refreshToken)) {
            return $this->authError(
                __('api.refresh_token_required'),
                ApiErrorCodes::VALIDATION_REQUIRED_FIELD,
                400
            );
        }

        $revoked = $this->tokenService->revokeToken($refreshToken, $userId);

        if (!$revoked) {
            return $this->authError(
                __('api.invalid_refresh_token_or_revoked'),
                ApiErrorCodes::AUTH_TOKEN_INVALID,
                400
            );
        }

        return response()->json([
            'success' => true,
            'data' => ['revoked' => true]
        ]);
    }

    /**
     * POST /api/auth/revoke-all
     */
    public function revokeAllTokens(): JsonResponse
    {
        $userId = $this->getOptionalUserId();
        if (!$userId) {
            return $this->authError(
                __('api.auth_required'),
                ApiErrorCodes::AUTH_TOKEN_MISSING,
                401
            );
        }

        $revokedCount = $this->tokenService->revokeAllTokensForUser($userId);
        if ($revokedCount < 1) {
            return $this->authError(
                __('api.server_error'),
                ApiErrorCodes::SERVER_INTERNAL_ERROR,
                500
            );
        }

        if (session_status() === PHP_SESSION_ACTIVE) {
            $this->clearApiSessionAuthentication();
        }

        return response()->json([
            'success' => true,
            'data' => [
                'revoked_count' => $revokedCount,
                'message' => __('api_controllers_1.auth.tokens_revoked')
            ]
        ]);
    }

    /**
     * POST /api/auth/admin-session
     */
    public function adminSession(): JsonResponse
    {
        $input = $this->getAllInput();
        $token = $input['token'] ?? '';
        $redirect = $input['redirect'] ?? '/admin';

        // Sanitize redirect: this bridge may only enter the maintained React admin.
        if ($redirect !== '/admin' && !str_starts_with($redirect, '/admin/')) {
            $redirect = '/admin';
        }

        if (empty($token)) {
            return $this->authError(__('api.missing_token'), ApiErrorCodes::AUTH_TOKEN_MISSING, 400);
        }

        // Validate the JWT
        $payload = $this->tokenService->validateToken($token);
        if (!$payload) {
            return $this->authError(__('api.invalid_or_expired_token'), ApiErrorCodes::AUTH_TOKEN_INVALID, 401);
        }

        $userId = $payload['user_id'] ?? $payload['sub'] ?? null;
        if (!$userId) {
            return $this->authError(__('api.invalid_token_payload'), ApiErrorCodes::AUTH_TOKEN_INVALID, 401);
        }

        // Load user from DB — tenant-scoped, with super-admin bypass
        $tenantId = TenantContext::getId();

        // First try tenant-scoped lookup
        $userRow = DB::selectOne(
            "SELECT id, first_name, last_name, email, role, tenant_id, avatar_url, is_super_admin, is_tenant_super_admin, is_god, is_admin FROM users WHERE id = ? AND tenant_id = ?",
            [(int)$userId, $tenantId]
        );
        $user = $userRow ? (array)$userRow : null;

        // Super-admin cross-tenant fallback: if not found in current tenant,
        // check if user is a super-admin who can access any tenant's admin panel
        if (!$user && $tenantId) {
            $candidateRow = DB::selectOne(
                "SELECT id, first_name, last_name, email, role, tenant_id, avatar_url, is_super_admin, is_tenant_super_admin, is_god, is_admin FROM users WHERE id = ?",
                [(int)$userId]
            );
            $candidate = $candidateRow ? (array)$candidateRow : null;
            if ($candidate && (!empty($candidate['is_super_admin']) || !empty($candidate['is_god']))) {
                $user = $candidate;
            }
        }

        if (!$user) {
            return $this->authError(__('api.user_not_found'), ApiErrorCodes::RESOURCE_NOT_FOUND, 404);
        }

        // Check admin privileges
        $adminRoles = ['admin', 'super_admin', 'tenant_admin'];
        $isAdmin = in_array($user['role'], $adminRoles) || !empty($user['is_super_admin']) || !empty($user['is_tenant_super_admin']) || !empty($user['is_god']);
        if (!$isAdmin) {
            return $this->authError(__('api.admin_access_required'), ApiErrorCodes::AUTH_INSUFFICIENT_PERMISSIONS, 403);
        }

        if ((int) ($payload['tenant_id'] ?? 0) !== (int) $user['tenant_id']) {
            return $this->authError(__('api.invalid_token_payload'), ApiErrorCodes::AUTH_TOKEN_INVALID, 401);
        }

        // Create a bounded compatibility session from the validated JWT.
        if (session_status() == PHP_SESSION_NONE) {
            session_start();
        }
        session_regenerate_id(true);
        if (!$this->stampApiSessionAccessWindow($payload)) {
            $this->clearApiSessionAuthentication();
            return $this->authError(__('api.invalid_or_expired_token'), ApiErrorCodes::AUTH_TOKEN_INVALID, 401);
        }
        $_SESSION['user_id'] = $user['id'];
        $_SESSION['user_name'] = $user['first_name'] . ' ' . $user['last_name'];
        $_SESSION['user_email'] = $user['email'];
        $_SESSION['user_role'] = $user['role'] ?? 'member';
        $_SESSION['role'] = $user['role'] ?? 'member';
        $_SESSION['is_super_admin'] = $user['is_super_admin'] ?? 0;
        $_SESSION['is_tenant_super_admin'] = $user['is_tenant_super_admin'] ?? 0;
        $_SESSION['is_god'] = $user['is_god'] ?? 0;
        $_SESSION['tenant_id'] = $user['tenant_id'];
        $_SESSION['user_avatar'] = $user['avatar_url'] ?? '/assets/img/defaults/default_avatar.png';
        $_SESSION['is_admin'] = in_array($user['role'], $adminRoles) ? 1 : 0;
        $_SESSION['is_logged_in'] = true;

        // Redirect to maintained React admin
        return response()->json(null, 302, ['Location' => $redirect]);
    }

    /**
     * GET /api/auth/csrf-token
     */
    public function getCsrfToken(): JsonResponse
    {
        // Rate limit this endpoint (10 per minute per IP)
        $ip = \App\Core\ClientIp::get();
        $rateLimitResult = \App\Core\RateLimiter::check($ip . ':csrf', 'csrf_token');

        if ($rateLimitResult['limited']) {
            return $this->authError(
                __('api.rate_limit_exceeded'),
                ApiErrorCodes::RATE_LIMIT_EXCEEDED,
                429
            );
        }

        \App\Core\RateLimiter::recordAttempt($ip . ':csrf', 'csrf_token', true);

        // Generate and return the CSRF token
        $token = \App\Core\Csrf::generate();

        return response()->json([
            'success' => true,
            'data' => [
                'csrf_token' => $token
            ]
        ]);
    }

    /**
     * Mask email address for display (e.g., j***@example.com)
     */
    private function maskEmail(string $email): string
    {
        $parts = explode('@', $email);
        if (count($parts) !== 2) {
            return '***@***';
        }

        $local = $parts[0];
        $domain = $parts[1];

        $maskedLocal = strlen($local) > 1
            ? $local[0] . str_repeat('*', min(strlen($local) - 1, 5))
            : '*';

        return $maskedLocal . '@' . $domain;
    }
}
