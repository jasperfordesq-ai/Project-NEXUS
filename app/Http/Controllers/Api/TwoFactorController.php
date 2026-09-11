<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Core\EmailTemplate;
use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\Notification;
use App\Models\User;
use App\Services\EmailDispatchService;
use App\Services\TotpService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * TwoFactorController -- Two-factor authentication setup.
 *
 * All methods use Laravel DI services.
 */
class TwoFactorController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly TotpService $totpService,
        private readonly \App\Services\TwoFactorChallengeManager $challengeManager,
        private readonly \App\Services\TokenService $tokenService,
    ) {}

    /**
     * Resolve the acting user ID from either:
     *   - a normal authenticated request (Bearer / session), OR
     *   - a 2FA setup challenge token submitted as `two_factor_token`
     *     (created by AuthController::login when an admin without 2FA
     *     authenticates). The challenge must have method='totp_setup'.
     *
     * Returns the user ID, setup token, and tenant that owns the account.
     * An explicitly supplied invalid challenge fails closed; it must not
     * silently select the transport's authenticated account instead.
     */
    private function resolveSetupIdentity(): array
    {
        $allInput = $this->getAllInput();
        $setupToken = $allInput['two_factor_token'] ?? null;
        if ($setupToken !== null) {
            if (!is_string($setupToken) || $setupToken === '') {
                $this->rejectSetupChallenge();
            }
            $challenge = $this->challengeManager->get($setupToken);
            if (
                $challenge
                && !empty($challenge['tenant_id'])
                && in_array('totp_setup', $challenge['methods'] ?? [], true)
            ) {
                return [(int) $challenge['user_id'], $setupToken, (int) $challenge['tenant_id']];
            }
            $this->rejectSetupChallenge();
        }
        return [$this->requireAuth(), null, (int) TenantContext::getId()];
    }

    private function rejectSetupChallenge(): never
    {
        throw new HttpResponseException($this->respondWithError(
            'AUTH_2FA_TOKEN_EXPIRED', __('api.session_expired'), null, 401
        ));
    }

    /** Called inside the transaction, before any enrollment or token mutation. */
    private function lockSetupIdentity(int $userId, ?string $setupToken, int $tenantId): void
    {
        $user = DB::table('users')->where('id', $userId)->where('tenant_id', $tenantId)
            ->lockForUpdate()->first();
        if (!$user || ($user->status ?? '') !== 'active') {
            $this->rejectSetupChallenge();
        }
        if ($setupToken === null) {
            $claims = $this->tokenService->validateToken((string) request()->bearerToken(), true);
            if (!$claims || (int) ($claims['user_id'] ?? 0) !== $userId
                || (int) ($claims['tenant_id'] ?? 0) !== $tenantId
                || !empty($claims['impersonated_by'])
                || (app(\App\Services\TwoFactorPolicy::class)->required($user)
                    && !app(\App\Services\TwoFactorPolicy::class)->satisfied($claims))) {
                $this->rejectSetupChallenge();
            }
            return;
        }
        $challenge = $this->challengeManager->get($setupToken);
        $startedAt = (int) ($challenge['authentication_started_at'] ?? 0);
        if ($startedAt < 1) {
            $startedAt = (int) strtotime((string) ($challenge['created_at'] ?? ''));
        }
        if (!$challenge || (int) ($challenge['user_id'] ?? 0) !== $userId
            || (int) ($challenge['tenant_id'] ?? 0) !== $tenantId
            || !in_array('totp_setup', $challenge['methods'] ?? [], true)
            || !$this->tokenService->isAuthenticationStartValid($userId, $startedAt)) {
            $this->rejectSetupChallenge();
        }
        if (is_array($challenge['sso_provider_context'] ?? null)) {
            try {
                \App\Services\Auth\SsoOidcService::assertPrivilegedProviderTrusted($user, $challenge['sso_provider_context']);
            } catch (\RuntimeException $e) {
                $this->rejectSetupChallenge();
            }
        }
        $gate = app(\App\Services\TenantSettingsService::class)->checkLoginGatesForUser((array) $user);
        if ($gate) {
            throw new HttpResponseException($this->respondWithError($gate['code'], $gate['message'], null, 403));
        }
    }

    /** GET auth/2fa/status */
    public function status(): JsonResponse
    {
        $userId = $this->requireAuth();

        return $this->respondWithData([
            'enabled' => $this->totpService->isEnabled($userId),
            'enrollment_allowed' => TenantContext::hasFeature('two_factor_authentication') || app(\App\Services\TwoFactorPolicy::class)->required(auth()->user()),
            'enforcement_required' => app(\App\Services\TwoFactorPolicy::class)->required(auth()->user()),
            'setup_required' => $this->totpService->isSetupRequired($userId),
            'backup_codes_remaining' => $this->totpService->getBackupCodeCount($userId),
        ]);
    }

    /** POST auth/2fa/setup */
    public function setup(): JsonResponse
    {
        return DB::transaction(fn (): JsonResponse => $this->setupWithinTransaction());
    }

    private function setupWithinTransaction(): JsonResponse
    {
        [$userId, $setupToken, $tenantId] = $this->resolveSetupIdentity();
        $this->lockSetupIdentity($userId, $setupToken, $tenantId);
        $enrollmentAllowed = TenantContext::runForTenant(
            $tenantId,
            fn (): bool => TenantContext::hasFeature('two_factor_authentication')
        );
        if (!$enrollmentAllowed && !app(\App\Services\TwoFactorPolicy::class)->required(
            DB::table('users')->where('id', $userId)->where('tenant_id', $tenantId)->first()
        )) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.feature_disabled'), null, 403);
        }
        $this->rateLimit('2fa_setup', 5, 300, "mfa-user:{$tenantId}:{$userId}");

        if ($this->totpService->isEnabled($userId, $tenantId)) {
            return $this->respondWithError(
                'ALREADY_ENABLED',
                '2FA is already enabled on your account',
                null,
                409
            );
        }

        try {
            $result = $this->totpService->initializeSetup($userId, $tenantId);

            // Convert raw SVG to data URI for use in <img src="...">
            $svgDataUri = 'data:image/svg+xml;base64,' . base64_encode($result['qr_code']);

            return $this->respondWithData([
                'qr_code_url' => $svgDataUri,
                'secret' => $result['secret'],
                'backup_codes' => [],
            ]);
        } catch (\Exception $e) {
            return $this->respondWithError(
                'SETUP_FAILED',
                'Failed to initialize 2FA setup',
                null,
                500
            );
        }
    }

    /** POST auth/2fa/verify */
    public function verify(): JsonResponse
    {
        return DB::transaction(fn (): JsonResponse => $this->verifyWithinTransaction());
    }

    private function verifyWithinTransaction(): JsonResponse
    {
        [$userId, $setupToken, $tenantId] = $this->resolveSetupIdentity();
        $this->lockSetupIdentity($userId, $setupToken, $tenantId);
        $enrollmentAllowed = TenantContext::runForTenant(
            $tenantId,
            fn (): bool => TenantContext::hasFeature('two_factor_authentication')
        );
        if (!$enrollmentAllowed && !app(\App\Services\TwoFactorPolicy::class)->required(
            DB::table('users')->where('id', $userId)->where('tenant_id', $tenantId)->first()
        )) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.feature_disabled'), null, 403);
        }
        $this->rateLimit('2fa_verify', 10, 300, "mfa-user:{$tenantId}:{$userId}");

        $data = $this->getAllInput();
        $code = is_string($data['code'] ?? null) ? trim($data['code']) : '';

        if (empty($code)) {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                'Verification code is required',
                'code',
                400
            );
        }

        $result = $this->totpService->completeSetup($userId, $code, $tenantId);

        if (!$result['success']) {
            return $this->respondWithError(
                'VERIFICATION_FAILED',
                $result['error'] ?? 'Invalid verification code',
                'code',
                400
            );
        }

        $completedChallenge = $setupToken ? $this->challengeManager->get($setupToken) : null;
        if (is_array($completedChallenge['pending_identity_link'] ?? null)) {
            $user = (array) DB::table('users')->where('id', $userId)->where('tenant_id', $tenantId)->first();
            app(\App\Services\Auth\SocialAuthService::class)->applyCallbackIdentityLink(
                $user, $completedChallenge['pending_identity_link'], (int) $completedChallenge['authentication_started_at']
            );
        }

        // Security notification + email: render in the user's preferred_language
        // so both bell text and the email match the recipient's locale, not the
        // request caller's (which can differ for impersonation/admin flows).
        DB::afterCommit(function () use ($userId, $tenantId): void {
            try {
                TenantContext::runForTenant(
                    $tenantId,
                    function () use ($userId, $tenantId): void {
                        $user = User::query()
                            ->whereKey($userId)
                            ->where('tenant_id', $tenantId)
                            ->first();
                        $userLocale = $user?->preferred_language;

                        LocaleContext::withLocale($userLocale, function () use ($user, $userId, $tenantId) {
                            try {
                                Notification::createNotification(
                                    $userId,
                                    __('api_controllers_2.two_factor.enabled_notification'),
                                    '/settings?tab=security',
                                    '2fa_enabled'
                                );
                                \App\Services\NotificationDispatcher::fanOutPush(
                                    $userId,
                                    '2fa_enabled',
                                    __('api_controllers_2.two_factor.enabled_notification'),
                                    '/settings?tab=security'
                                );
                            } catch (\Throwable $e) {
                                Log::warning('[2FA] Failed to create 2FA enabled notification: ' . $e->getMessage(), ['user_id' => $userId]);
                            }

                            if (!$user || !$user->email) {
                                return;
                            }

                            $tenantName = TenantContext::get()['name'] ?? 'Project NEXUS';
                            $userName   = $user->first_name ?? $user->name ?? '';

                            $html = EmailTemplateBuilder::make()
                                ->theme('success')
                                ->title(__('emails_security_alerts.2fa_enabled.title'))
                                ->previewText(__('emails_security_alerts.2fa_enabled.preview'))
                                ->greeting($userName)
                                ->paragraph(__('emails_security_alerts.2fa_enabled.body'))
                                ->paragraph(__('emails_security_alerts.2fa_enabled.warning'))
                                ->render();

                            $subject = __('emails_security_alerts.2fa_enabled.subject', ['community' => $tenantName]);
                            if (!EmailDispatchService::sendRaw($user->email, $subject, $html, null, null, null, 'security_alert', ['tenant_id' => $tenantId])) {
                                Log::warning('[2FA] Failed to send 2FA enabled email', ['user_id' => $userId]);
                            }
                        });
                    }
                );
            } catch (\Throwable $e) {
                Log::warning('[2FA] Failed to send 2FA enabled email: ' . $e->getMessage(), ['user_id' => $userId]);
            }
        });

        // If we were authenticated via a 2FA setup token (first-time admin
        // setup flow), issue real access + refresh tokens under the challenge
        // tenant. Consume the challenge only after both tokens are available.
        $issuedTokens = null;
        if ($setupToken !== null) {
            try {
                $issuedTokens = TenantContext::runForTenant(
                    $tenantId,
                    function () use ($userId, $tenantId): array {
                        $userRow = User::query()
                            ->whereKey($userId)
                            ->where('tenant_id', $tenantId)
                            ->first();
                        if (!$userRow) {
                            throw new \RuntimeException('2FA setup user could not be resolved in the challenge tenant.');
                        }

                        $isMobile = $this->tokenService->isMobileRequest();
                        $accessToken = $this->tokenService->generateToken(
                            (int) $userRow->id,
                            $tenantId,
                            [
                                ...\App\Services\TwoFactorPolicy::claims('totp'),
                                'role' => $userRow->role,
                                'email' => $userRow->email,
                                'is_super_admin' => !empty($userRow->is_super_admin),
                                'is_tenant_super_admin' => !empty($userRow->is_tenant_super_admin),
                                'is_god' => !empty($userRow->is_god),
                            ],
                            $isMobile
                        );
                        $refreshToken = $this->tokenService->generateRefreshToken(
                            (int) $userRow->id,
                            $tenantId,
                            $isMobile,
                            \App\Services\TwoFactorPolicy::claims('totp')
                        );

                        return [
                            'access_token' => $accessToken,
                            'refresh_token' => $refreshToken,
                            'token_type' => 'Bearer',
                            'expires_in' => $this->tokenService->getAccessTokenExpiry($isMobile),
                            'refresh_expires_in' => $this->tokenService->getRefreshTokenExpiry($isMobile),
                        ];
                    }
                );
            } catch (\Throwable $e) {
                Log::error('[2FA] Failed to issue setup login tokens: ' . $e->getMessage(), [
                    'user_id' => $userId,
                    'tenant_id' => $tenantId,
                ]);

                throw new HttpResponseException($this->respondWithError('SETUP_FAILED', __('api.server_error'), null, 500));
            }

            if (!$this->challengeManager->consume($setupToken)) {
                $this->rejectSetupChallenge();
            }
        }

        $payload = ['backup_codes' => $result['backup_codes'] ?? []];
        if ($issuedTokens !== null) {
            $payload['login_complete'] = true;
            $payload = array_merge($payload, $issuedTokens);
        }
        return $this->respondWithData($payload);
    }

    /** Replace recovery codes only after a new, single-use authenticator proof. */
    public function regenerateRecoveryCodes(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('2fa_recovery_codes', 5, 300);
        $claims = request()->attributes->get('verified_auth_claims', []);
        if (!empty($claims['impersonated_by'])) {
            return $this->respondWithError('AUTH_INSUFFICIENT_PERMISSIONS', __('api.insufficient_permissions'), null, 403);
        }
        $code = $this->input('code', '');
        if (!is_string($code) || !preg_match('/^[0-9]{6}$/D', $code)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.code_required'), 'code', 422);
        }
        $tenantId = (int) auth()->user()->tenant_id;
        $result = DB::transaction(function () use ($userId, $tenantId, $code): array {
            $user = DB::table('users')->where('id', $userId)->where('tenant_id', $tenantId)->lockForUpdate()->first();
            if (!$user || $user->status !== 'active') {
                return ['success' => false];
            }
            // Revalidate the bearer after taking the same lock as security resets.
            if (!$this->tokenService->validateToken((string) request()->bearerToken(), true)) {
                return ['success' => false];
            }
            $verified = $this->totpService->verifyLogin($userId, $code, $tenantId);
            if (!$verified['success']) {
                return ['success' => false]; // Commit the failed-attempt counter.
            }
            $codes = $this->totpService->generateBackupCodes($userId, $tenantId);
            $this->totpService->recordAttempt($userId, true, 'totp', 'recovery_codes_regenerated', $tenantId);
            DB::afterCommit(fn () => TotpService::notifySecurityChange($userId, $tenantId));
            return ['success' => true, 'backup_codes' => $codes];
        });
        if (!$result['success']) {
            return $this->respondWithError('VERIFICATION_FAILED', __('api.validation_failed'), 'code', 422);
        }
        return $this->respondWithData(['backup_codes' => $result['backup_codes']]);
    }

    /** Trusted-device removal does not weaken MFA or change the current session. */
    public function revokeTrustedDevices(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('2fa_revoke_devices', 5, 300);
        if (!empty(request()->attributes->get('verified_auth_claims', [])['impersonated_by'])) {
            return $this->respondWithError('AUTH_INSUFFICIENT_PERMISSIONS', __('api.insufficient_permissions'), null, 403);
        }
        $count = $this->totpService->revokeAllDevices($userId);
        return $this->respondWithData(['revoked_count' => $count])
            ->withCookie(cookie()->forget(TotpService::trustedDeviceCookieName()));
    }

    /** POST auth/2fa/disable */
    public function disable(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('2fa_disable', 3, 3600);
        if (app(\App\Services\TwoFactorPolicy::class)->required(auth()->user())) {
            return $this->respondWithError('MFA_REQUIRED', __('mfa.disable_forbidden'), null, 403);
        }

        $data = $this->getAllInput();
        $password = $data['password'] ?? '';

        if (empty($password)) {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                'Password is required',
                'password',
                400
            );
        }

        $result = $this->totpService->disable($userId, $password);

        if (!$result['success']) {
            return $this->respondWithError(
                'DISABLE_FAILED',
                $result['error'] ?? 'Failed to disable 2FA',
                'password',
                403
            );
        }

        // Security notification + email: render in the user's preferred_language.
        try {
            $user = User::query()->find($userId);
            $userLocale = $user->preferred_language ?? null;

            LocaleContext::withLocale($userLocale, function () use ($userId) {
                try {
                    Notification::createNotification(
                        $userId,
                        __('api_controllers_2.two_factor.disabled_notification'),
                        '/settings?tab=security',
                        '2fa_disabled'
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) ($userId), '2fa_disabled', __('api_controllers_2.two_factor.disabled_notification'), '/settings?tab=security');
                } catch (\Throwable $e) {
                    Log::warning('[2FA] Failed to create 2FA disabled notification: ' . $e->getMessage(), ['user_id' => $userId]);
                }
            });

            if ($user && $user->email) {
                $tenantId = (int) ($user->tenant_id ?? TenantContext::getId());
                TenantContext::runForTenant($tenantId, function () use ($user, $userId, $userLocale, $tenantId): void {
                    LocaleContext::withLocale($userLocale, function () use ($user, $userId, $tenantId) {
                        $tenantName = TenantContext::get()['name'] ?? 'Project NEXUS';
                        $userName   = $user->first_name ?? $user->name ?? '';

                        $html = EmailTemplateBuilder::make()
                            ->theme('danger')
                            ->title(__('emails_security_alerts.2fa_disabled.title'))
                            ->previewText(__('emails_security_alerts.2fa_disabled.preview'))
                            ->greeting($userName)
                            ->paragraph(__('emails_security_alerts.2fa_disabled.body'))
                            ->paragraph(__('emails_security_alerts.2fa_disabled.warning'))
                            ->render();

                        $subject = __('emails_security_alerts.2fa_disabled.subject', ['community' => $tenantName]);
                        if (!EmailDispatchService::sendRaw($user->email, $subject, $html, null, null, null, 'security_alert', ['tenant_id' => $tenantId])) {
                            Log::warning('[2FA] Failed to send 2FA disabled email', ['user_id' => $userId]);
                        }
                    });
                });
            }
        } catch (\Throwable $e) {
            Log::warning('[2FA] Failed to send 2FA disabled email: ' . $e->getMessage(), ['user_id' => $userId]);
        }

        $response = $this->respondWithData([
            'message' => __('api_controllers_2.two_factor.disabled'),
        ]);
        $response->withCookie(cookie()->forget(TotpService::trustedDeviceCookieName()));

        return $response;
    }
}
