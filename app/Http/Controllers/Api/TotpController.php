<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Services\TenantSettingsService;
use App\Services\TokenService;
use App\Services\TotpService;
use App\Services\TwoFactorChallengeManager;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use App\Core\ApiErrorCodes;
use App\Core\Csrf;
use App\Core\TenantContext;

/**
 * TotpController -- TOTP two-factor authentication verify + status.
 */
class TotpController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly TenantSettingsService $tenantSettingsService,
        private readonly TwoFactorChallengeManager $twoFactorChallengeManager,
        private readonly TokenService $tokenService,
        private readonly TotpService $totpService,
    ) {}

    /**
     * POST totp/verify
     *
     * Accepts either:
     * - { "two_factor_token": "...", "code": "123456" } (stateless)
     * - { "csrf_token": "...", "code": "123456" } (session-based)
     */
    public function verify(): JsonResponse
    {

        $input = $this->getAllInput();
        $rawTwoFactorToken = $input['two_factor_token'] ?? null;
        $twoFactorToken = is_string($rawTwoFactorToken) && $rawTwoFactorToken !== ''
            ? $rawTwoFactorToken
            : null;
        $rawCode = $input['code'] ?? '';
        $code = is_string($rawCode) ? trim($rawCode) : '';
        $useBackupCode = !empty($input['use_backup_code'] ?? false);
        $trustDevice = !empty($input['trust_device'] ?? false);

        // Determine which auth flow we're using
        $isStateless = !empty($twoFactorToken);

        $userId = null;
        $tenantId = null;
        $authenticationStartedAt = null;
        $allowedMethods = ['totp', 'backup_code'];

        if ($isStateless) {
            // Stateless flow - validate two_factor_token
            $challengeData = $this->twoFactorChallengeManager->get($twoFactorToken);

            if (!$challengeData || empty($challengeData['tenant_id'])) {
                return $this->respondWithError(
                    ApiErrorCodes::AUTH_2FA_TOKEN_EXPIRED,
                    __('api.session_expired'),
                    null,
                    401
                );
            }

            $userId = (int) $challengeData['user_id'];
            $tenantId = (int) $challengeData['tenant_id'];
            $authenticationStartedAt = $this->authenticationStartFromChallenge($challengeData);
            if ($authenticationStartedAt === null) {
                return $this->respondWithError(
                    ApiErrorCodes::AUTH_2FA_TOKEN_EXPIRED,
                    __('api.session_expired'),
                    null,
                    401
                );
            }
            $allowedMethods = $challengeData['methods'] ?? [];
        } else {
            // Session-based flow - check CSRF and session
            $csrfToken = $input['csrf_token'] ?? $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';

            // Start session if needed
            if (session_status() === PHP_SESSION_NONE) {
                session_start();
            }

            // Validate CSRF for session-based requests
            if (!Csrf::verify($csrfToken)) {
                return $this->respondWithError(ApiErrorCodes::AUTH_CSRF_INVALID, __('api.invalid_csrf_token'), null, 403);
            }

            // Check for pending 2FA session
            if (
                empty($_SESSION['pending_2fa_user_id'])
                || empty($_SESSION['pending_2fa_tenant_id'])
                || empty($_SESSION['pending_2fa_started_at'])
                || empty($_SESSION['pending_2fa_challenge_token'])
            ) {
                return $this->respondWithError(ApiErrorCodes::AUTH_2FA_EXPIRED, __('api.no_pending_2fa_session'), null, 401);
            }

            // Check session expiry
            if (($_SESSION['pending_2fa_expires'] ?? 0) < time()) {
                unset(
                    $_SESSION['pending_2fa_user_id'],
                    $_SESSION['pending_2fa_tenant_id'],
                    $_SESSION['pending_2fa_started_at'],
                    $_SESSION['pending_2fa_challenge_token'],
                    $_SESSION['pending_2fa_expires']
                );
                return $this->respondWithError(ApiErrorCodes::AUTH_2FA_EXPIRED, __('api.session_expired'), null, 401);
            }

            $userId = (int)$_SESSION['pending_2fa_user_id'];
            $tenantId = (int)$_SESSION['pending_2fa_tenant_id'];
            $twoFactorToken = is_string($_SESSION['pending_2fa_challenge_token'])
                ? $_SESSION['pending_2fa_challenge_token']
                : null;
            $challengeData = $twoFactorToken !== null
                ? $this->twoFactorChallengeManager->get($twoFactorToken)
                : null;
            $authenticationStartedAt = is_array($challengeData)
                ? $this->authenticationStartFromChallenge($challengeData)
                : null;
            if (
                $challengeData === null
                || $authenticationStartedAt === null
                || (int) ($challengeData['user_id'] ?? 0) !== $userId
                || (int) ($challengeData['tenant_id'] ?? 0) !== $tenantId
                || $authenticationStartedAt !== (int) $_SESSION['pending_2fa_started_at']
            ) {
                unset(
                    $_SESSION['pending_2fa_user_id'],
                    $_SESSION['pending_2fa_tenant_id'],
                    $_SESSION['pending_2fa_started_at'],
                    $_SESSION['pending_2fa_challenge_token'],
                    $_SESSION['pending_2fa_expires']
                );
                return $this->respondWithError(
                    ApiErrorCodes::AUTH_2FA_EXPIRED,
                    __('api.session_expired'),
                    null,
                    401
                );
            }
            $allowedMethods = $challengeData['methods'] ?? [];
        }

        // Both API-token and legacy session completion paths consume the same
        // cache-backed handle and share its attempt cap.
        $attemptResult = $this->twoFactorChallengeManager->recordAttempt((string) $twoFactorToken);
        if (!$attemptResult['allowed']) {
            return $this->respondWithError(
                ApiErrorCodes::AUTH_2FA_MAX_ATTEMPTS,
                __('api.too_many_attempts'),
                null,
                401
            );
        }

        // Validate code is provided
        if (empty($code)) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_REQUIRED_FIELD, __('api.code_required'), 'code', 400);
        }

        $verificationMethod = $useBackupCode ? 'backup_code' : 'totp';
        if (!in_array($verificationMethod, $allowedMethods, true)) {
            return $this->respondWithError(
                ApiErrorCodes::AUTH_2FA_TOKEN_EXPIRED,
                __('api.session_expired'),
                null,
                401
            );
        }

        $this->rateLimit('totp_verify', 5, 300, "mfa-user:{$tenantId}:{$userId}");
        DB::beginTransaction();
        try {
            // Password changes and logout-all take this same row lock. Keeping
            // it through token issuance totally orders those operations with a
            // pending 2FA login and prevents post-revocation credentials.
            $lockedUser = DB::table('users')
                ->where('id', $userId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();
            if ($lockedUser === null) {
                DB::rollBack();
                return $this->respondWithError(ApiErrorCodes::RESOURCE_NOT_FOUND, __('api.user_not_found'), null, 401);
            }

            if (!$this->tokenService->isAuthenticationStartValid($userId, (int) $authenticationStartedAt)) {
                DB::rollBack();
                return $this->respondWithError(
                    $isStateless ? ApiErrorCodes::AUTH_2FA_TOKEN_EXPIRED : ApiErrorCodes::AUTH_2FA_EXPIRED,
                    __('api.session_expired'),
                    null,
                    401
                );
            }

            // Re-read the cache-backed challenge after acquiring the issuance
            // lock so concurrent submissions cannot both mint credentials.
            $liveChallenge = is_string($twoFactorToken)
                ? $this->twoFactorChallengeManager->get($twoFactorToken)
                : null;
            if (
                $liveChallenge === null
                || (int) ($liveChallenge['user_id'] ?? 0) !== $userId
                || (int) ($liveChallenge['tenant_id'] ?? 0) !== $tenantId
                || $this->authenticationStartFromChallenge($liveChallenge) !== (int) $authenticationStartedAt
                || !in_array($verificationMethod, $liveChallenge['methods'] ?? [], true)
            ) {
                DB::rollBack();
                return $this->respondWithError(
                    $isStateless ? ApiErrorCodes::AUTH_2FA_TOKEN_EXPIRED : ApiErrorCodes::AUTH_2FA_EXPIRED,
                    __('api.session_expired'),
                    null,
                    401
                );
            }

        // The opaque challenge binds both the user and the tenant that owns the
        // TOTP secret. Never re-resolve this identity from the request host.
        $userRow = DB::selectOne("
            SELECT u.id, u.first_name, u.last_name, u.email, u.avatar_url, u.role, u.tenant_id,
                   u.is_super_admin, u.is_tenant_super_admin, u.is_god, u.email_verified_at,
                   u.is_approved, u.status, u.onboarding_completed, t.configuration
            FROM users u
            LEFT JOIN tenants t ON u.tenant_id = t.id
            WHERE u.id = ? AND u.tenant_id = ?
        ", [$userId, $tenantId]);
        // Authorization fields must come from the locking current read, not
        // from an older REPEATABLE READ snapshot of the joined profile query.
        $user = $userRow ? array_replace((array) $userRow, (array) $lockedUser) : null;

        if (!$user) {
            DB::rollBack();
            return $this->respondWithError(ApiErrorCodes::RESOURCE_NOT_FOUND, __('api.user_not_found'), null, 401);
        }

        if (is_array($liveChallenge['sso_provider_context'] ?? null)) {
            try {
                \App\Services\Auth\SsoOidcService::assertPrivilegedProviderTrusted($user, $liveChallenge['sso_provider_context']);
            } catch (\RuntimeException $e) {
                DB::rollBack();
                return $this->respondWithError(ApiErrorCodes::AUTH_2FA_TOKEN_EXPIRED, __('api.session_expired'), null, 401);
            }
        }

        // Verify the code
        if ($useBackupCode) {
            $result = $this->totpService->verifyBackupCode($userId, $code, $tenantId);
        } else {
            $result = $this->totpService->verifyLogin($userId, $code, $tenantId);
        }

        if (!$result['success']) {
            // Keep the verification-attempt audit/rate-limit writes.
            DB::commit();
            return $this->respondWithError(
                ApiErrorCodes::AUTH_2FA_INVALID,
                $result['error'] ?? __('api.validation_failed'),
                null,
                401
            );
        }

        // =========================================================
        // 2FA SUCCESSFUL - Complete login
        // =========================================================

        // Consume the challenge token (single-use)
        if (!is_string($twoFactorToken) || !$this->twoFactorChallengeManager->consume($twoFactorToken)) {
            DB::rollBack();
            return $this->respondWithError(
                $isStateless ? ApiErrorCodes::AUTH_2FA_TOKEN_EXPIRED : ApiErrorCodes::AUTH_2FA_EXPIRED,
                __('api.session_expired'),
                null,
                401
            );
        }

        // Clear session-based pending state
        unset(
            $_SESSION['pending_2fa_user_id'],
            $_SESSION['pending_2fa_tenant_id'],
            $_SESSION['pending_2fa_started_at'],
            $_SESSION['pending_2fa_challenge_token'],
            $_SESSION['pending_2fa_expires']
        );

        // SECURITY: Block suspended/banned users from completing 2FA login
        if (($user['status'] ?? 'active') !== 'active') {
            DB::commit();
            return $this->respondWithError(ApiErrorCodes::AUTH_ACCOUNT_SUSPENDED, __('api.account_suspended'), null, 403);
        }

        // SECURITY: Enforce registration policy gates after 2FA completion
        $gateBlock = $this->tenantSettingsService->checkLoginGates($user);
        if ($gateBlock) {
            DB::commit();
            return $this->respondWithError($gateBlock['code'], $gateBlock['message'], null, 403);
        }

        if (is_array($liveChallenge['pending_identity_link'] ?? null)) {
            app(\App\Services\Auth\SocialAuthService::class)->applyCallbackIdentityLink(
                $user, $liveChallenge['pending_identity_link'], (int) $authenticationStartedAt
            );
        }

        // Return the plain trusted-device token for the frontend only after
        // every account-policy gate has passed.
        $trustedDeviceToken = $trustDevice && !app(\App\Services\TwoFactorPolicy::class)->required($user)
            ? $this->totpService->trustDevice($userId, null, $tenantId)
            : null;

        // Generate login tokens under the tenant bound to the challenge. This
        // keeps tenant-aware persistence on the account's home tenant even
        // when the request host differs.
        $isMobile = $this->tokenService->isMobileRequest();
        [$accessToken, $refreshToken] = TenantContext::runForTenant(
            $tenantId,
            function () use ($user, $isMobile, $useBackupCode): array {
                $accessToken = $this->tokenService->generateToken(
                    (int) $user['id'],
                    (int) $user['tenant_id'],
                    [
                        ...\App\Services\TwoFactorPolicy::claims($useBackupCode ? 'recovery_code' : 'totp'),
                        'role' => $user['role'],
                        'email' => $user['email'],
                        'is_super_admin' => !empty($user['is_super_admin']),
                        'is_tenant_super_admin' => !empty($user['is_tenant_super_admin']),
                        'is_god' => !empty($user['is_god']),
                    ],
                    $isMobile
                );
                $refreshToken = $this->tokenService->generateRefreshToken(
                    (int) $user['id'],
                    (int) $user['tenant_id'],
                    $isMobile,
                    \App\Services\TwoFactorPolicy::claims($useBackupCode ? 'recovery_code' : 'totp')
                );

                return [$accessToken, $refreshToken];
            }
        );

            DB::table('users')
                ->where('id', $userId)
                ->where('tenant_id', $tenantId)
                ->update(['last_login_at' => now()]);
            DB::commit();
        } catch (\Throwable $e) {
            DB::rollBack();
            throw $e;
        }

        // User-login Sanctum tokens are intentionally not issued because they
        // do not share the short JWT lifetime. Keep compatibility fields while
        // ensuring every bearer alias points at the access JWT.
        // Return success response with tokens — MUST match AuthController::login() response shape
        $response = [
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
        ];

        // Include backup codes remaining if a backup code was used
        if ($useBackupCode && isset($result['codes_remaining'])) {
            $response['codes_remaining'] = $result['codes_remaining'];
        }

        // Native stateless clients keep the token in secure storage. Browsers
        // receive only an HttpOnly cookie so injected JavaScript cannot read it.
        if ($trustedDeviceToken && $isMobile) {
            $response['trusted_device_token'] = $trustedDeviceToken;
        }

        $jsonResponse = response()->json($response);
        // Carries live credentials; never storable by a browser, proxy or CDN.
        $jsonResponse->headers->set('Cache-Control', 'private, no-store');
        $jsonResponse->headers->set('Pragma', 'no-cache');
        if ($trustedDeviceToken && ! $isMobile) {
            $secure = request()->secure() || app()->environment('production');
            $jsonResponse->withCookie(cookie(
                TotpService::trustedDeviceCookieName(),
                $trustedDeviceToken,
                TotpService::trustedDeviceLifetimeMinutes($tenantId),
                '/',
                null,
                $secure,
                true,
                false,
                $secure ? 'none' : 'lax',
            ));
        }

        return $jsonResponse;
    }

    /**
     * Resolve the password-authentication start bound into a challenge.
     *
     * `created_at` remains a rolling-upgrade fallback for challenges created
     * by an earlier application instance before the explicit field existed.
     */
    private function authenticationStartFromChallenge(array $challenge): ?int
    {
        $startedAt = (int) ($challenge['authentication_started_at'] ?? 0);
        if ($startedAt < 1) {
            $parsed = strtotime((string) ($challenge['created_at'] ?? ''));
            $startedAt = $parsed === false ? 0 : $parsed;
        }

        return $startedAt > 0 && $startedAt <= time() ? $startedAt : null;
    }

    /** GET totp/status */
    public function status(): JsonResponse
    {
        $userId = $this->requireAuth();

        return response()->json([
            'success' => true,
            'enabled' => $this->totpService->isEnabled($userId),
            'setup_required' => $this->totpService->isSetupRequired($userId),
            'backup_codes_remaining' => $this->totpService->getBackupCodeCount($userId),
            'trusted_devices' => $this->totpService->getTrustedDeviceCount($userId)
        ]);
    }
}
