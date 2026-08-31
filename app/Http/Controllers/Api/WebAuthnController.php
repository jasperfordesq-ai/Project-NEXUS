<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Core\EmailTemplate;
use App\Core\EmailTemplateBuilder;
use App\I18n\LocaleContext;
use App\Models\Notification;
use App\Models\User;
use App\Services\AuthenticationConfigurationService;
use App\Services\EmailDispatchService;
use App\Services\Auth\AuthenticationMethodGuard;
use App\Services\TenantSettingsService;
use App\Services\TokenService;
use App\Services\TotpService;
use App\Services\WebAuthnCeremonyVerifier;
use App\Services\WebAuthnChallengeStore;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\QueryException;
use App\Core\ApiErrorCodes;
use App\Core\TenantContext;
use lbuchs\WebAuthn\WebAuthnException;
use App\Support\UserDisplayName;

/**
 * WebAuthnController -- WebAuthn/Passkey authentication.
 */
class WebAuthnController extends BaseApiController
{
    protected bool $isV2Api = true;

    private const MAX_CREDENTIALS_PER_USER = 20;
    private const MAX_CREDENTIAL_ID_BYTES = 1023;
    private const MAX_CLIENT_DATA_BYTES = 8192;
    private const MAX_ATTESTATION_BYTES = 1048576;
    private const MAX_AUTHENTICATOR_DATA_BYTES = 4096;
    private const MAX_SIGNATURE_BYTES = 16384;
    private const ALLOWED_TRANSPORTS = ['usb', 'nfc', 'ble', 'smart-card', 'hybrid', 'internal'];

    public function __construct(
        private readonly TenantSettingsService $tenantSettingsService,
        private readonly WebAuthnChallengeStore $webAuthnChallengeStore,
        private readonly WebAuthnCeremonyVerifier $ceremonyVerifier,
        private readonly TokenService $tokenService,
    ) {}

    /** POST /api/webauthn/register-challenge */
    public function registerChallenge(): JsonResponse
    {
        $this->rateLimit('webauthn_register_challenge', 10, 60);

        $userId = $this->requireAuth();
        if (!$this->passkeyAuthenticationEnabled() || !$this->passkeyEnrollmentEnabled()) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.feature_disabled'), null, 403);
        }
        $registrationInput = $this->getAllInput();
        $confirmationError = $this->requireSecurityConfirmation($userId, TenantContext::getId(), $registrationInput);
        if ($confirmationError !== null) {
            return $confirmationError;
        }

        // Per-user rate limit on challenge generation. Generous enough that a
        // user retrying after client-side ceremony failures (browser rejection,
        // cancelled Windows Hello prompt) isn't locked out for 10 minutes.
        $this->rateLimit("webauthn_register_user_{$userId}", 10, 600);
        $user = $this->getWebAuthnUser($userId);

        if (!$user) {
            return $this->respondWithError(ApiErrorCodes::RESOURCE_NOT_FOUND, __('api.user_not_found'), null, 404);
        }

        $context = $this->resolveWebAuthnContext();
        if ($context === null) {
            return $this->noStore($this->respondWithError(
                'AUTH_WEBAUTHN_ORIGIN_NOT_ALLOWED',
                __('api.webauthn_registration_failed'),
                null,
                400
            ));
        }

        // Get existing credentials to exclude (prevent re-registration)
        $tenantId = TenantContext::getId();
        $existingCredentials = DB::select(
            "SELECT credential_id FROM webauthn_credentials
             WHERE user_id = ? AND tenant_id = ? AND (rp_id = ? OR rp_id IS NULL)",
            [$userId, $tenantId, $context['rp_id']]
        );

        $credentialCount = (int) DB::table('webauthn_credentials')
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->count();
        if ($credentialCount >= $this->maxCredentialsPerUser()) {
            return $this->noStore($this->respondWithError(
                'WEBAUTHN_CREDENTIAL_LIMIT',
                __('api.validation_failed'),
                null,
                409
            ));
        }

        $excludeCredentials = array_map(function ($row) {
            return [
                'type' => 'public-key',
                'id' => $row->credential_id,
            ];
        }, $existingCredentials);

        // Stable, secret-derived opaque handle. It is persisted with the
        // credential, so a future application-key rotation cannot strand it.
        $userHandle = $this->createUserHandle($userId, $tenantId);

        $challenge = random_bytes(32);
        $challengeB64 = $this->base64UrlEncode($challenge);
        try {
            $challengeId = $this->webAuthnChallengeStore->create(
                $challengeB64,
                $userId,
                'register',
                [
                    'origin' => $context['origin'],
                    'rp_id' => $context['rp_id'],
                    'user_handle' => $userHandle,
                    'routing_fingerprint' => $this->currentTenantRoutingFingerprint($tenantId),
                ]
            );
        } catch (\Throwable $e) {
            Log::error('[WebAuthn] Challenge storage unavailable', [
                'tenant_id' => $tenantId,
                'ceremony' => 'register',
                'error' => $e->getMessage(),
            ]);

            return $this->noStore($this->respondWithError(
                'AUTH_WEBAUTHN_UNAVAILABLE',
                __('api.service_unavailable'),
                null,
                503
            ));
        }

        $options = [
            'challenge' => $challengeB64,
            'challenge_id' => $challengeId,
            'rp' => [
                'name' => TenantContext::get()['name'] ?? 'Project NEXUS',
                'id' => $context['rp_id'],
            ],
            'user' => [
                'id' => $userHandle,
                'name' => $user['email'],
                'displayName' => $user['name'],
            ],
            'pubKeyCredParams' => [
                ['type' => 'public-key', 'alg' => -7],   // ES256
                ['type' => 'public-key', 'alg' => -8],   // EdDSA
                ['type' => 'public-key', 'alg' => -257],  // RS256
            ],
            'authenticatorSelection' => [
                'userVerification' => 'required',
                'residentKey' => 'required',
                'requireResidentKey' => true,
            ],
            'timeout' => 60000,
            'attestation' => 'none',
            'excludeCredentials' => $excludeCredentials,
        ];

        return $this->noStore($this->respondWithData($options));
    }

    /** POST /api/webauthn/register-verify */
    public function registerVerify(): JsonResponse
    {
        $this->rateLimit('webauthn_register_verify', 10, 60);

        $userId = $this->requireAuth();
        if (!$this->passkeyAuthenticationEnabled() || !$this->passkeyEnrollmentEnabled()) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.feature_disabled'), null, 403);
        }
        $input = $this->getAllInput();
        $tenantId = TenantContext::getId();
        $securityConfirmationToken = $input['security_confirmation_token']
            ?? request()->headers->get('X-Security-Confirmation');
        if (
            !is_string($securityConfirmationToken)
            || $securityConfirmationToken === ''
            || $this->tokenService->validateSecurityConfirmationToken(
                $securityConfirmationToken,
                $userId,
                $tenantId
            ) === null
        ) {
            return $this->securityConfirmationFailed();
        }

        try {
            $credentialId = $this->decodeCredentialId($input['id'] ?? null);
            $rawCredentialId = $this->decodeCredentialId($input['rawId'] ?? null);
            if (!hash_equals($credentialId, $rawCredentialId)) {
                throw new \InvalidArgumentException('Credential id/rawId mismatch');
            }
            if (($input['type'] ?? null) !== 'public-key' || !is_array($input['response'] ?? null)) {
                throw new \InvalidArgumentException('Invalid credential type');
            }
            $clientDataJson = $this->decodeBase64UrlField(
                $input['response']['clientDataJSON'] ?? null,
                self::MAX_CLIENT_DATA_BYTES
            );
            $attestationObject = $this->decodeBase64UrlField(
                $input['response']['attestationObject'] ?? null,
                self::MAX_ATTESTATION_BYTES
            );
        } catch (\InvalidArgumentException) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_REQUIRED_FIELD, __('api.webauthn_invalid_credential'), null, 400);
        }

        // Atomically pull before verification. A second request using the same
        // ceremony is rejected even for synced credentials whose counter is 0.
        $challengeData = $this->pullStoredChallenge($input, 'register', $userId);
        if ($challengeData instanceof JsonResponse) {
            return $challengeData;
        }

        $context = $this->validateChallengeContext($challengeData);
        if ($context instanceof JsonResponse) {
            return $context;
        }

        if (!$this->clientDataMatches($clientDataJson, 'webauthn.create', $context['origin'])) {
            return $this->noStore($this->respondWithError(
                ApiErrorCodes::AUTH_WEBAUTHN_FAILED,
                __('api.webauthn_registration_failed'),
                null,
                400
            ));
        }

        try {
            $challengeBytes = $this->decodeBase64UrlField($challengeData['challenge'] ?? null, 64);
        } catch (\InvalidArgumentException) {
            return $this->noStore($this->respondWithError(
                ApiErrorCodes::AUTH_WEBAUTHN_CHALLENGE_INVALID,
                __('api.webauthn_challenge_expired'),
                null,
                401
            ));
        }

        $rpName = TenantContext::get()['name'] ?? 'Project NEXUS';

        try {
            $verified = $this->ceremonyVerifier->verifyRegistration(
                $rpName,
                $context['rp_id'],
                $clientDataJson,
                $attestationObject,
                $challengeBytes
            );
        } catch (\Throwable $e) {
            Log::warning('[WebAuthn] Registration verification failed', [
                'tenant_id' => TenantContext::getId(),
                'user_id' => $userId,
                'reason' => $e instanceof WebAuthnException ? 'verification_rejected' : 'verifier_error',
            ]);
            return $this->noStore($this->respondWithError(ApiErrorCodes::AUTH_WEBAUTHN_FAILED, __('api.webauthn_registration_failed'), null, 400));
        }

        if (
            !hash_equals($credentialId, $verified['credential_id'])
            || !$verified['user_verified']
            || ($verified['backup_state'] && !$verified['backup_eligible'])
        ) {
            return $this->noStore($this->respondWithError(ApiErrorCodes::AUTH_WEBAUTHN_FAILED, __('api.webauthn_registration_failed'), null, 400));
        }

        $credentialIdB64 = $this->base64UrlEncode($verified['credential_id']);

        // Transport hints for future allowCredentials
        $transports = null;
        $transportData = $input['transports'] ?? $input['response']['transports'] ?? null;
        if (is_array($transportData)) {
            $transportData = array_values(array_unique(array_filter(
                $transportData,
                static fn (mixed $value): bool => is_string($value) && in_array($value, self::ALLOWED_TRANSPORTS, true)
            )));
            if ($transportData !== []) {
                $transports = json_encode($transportData, JSON_THROW_ON_ERROR);
            }
        }

        // Device name from client
        $deviceName = null;
        if (!empty($input['device_name']) && is_string($input['device_name'])) {
            $deviceName = mb_substr(trim($input['device_name']), 0, 100);
            if ($deviceName === '' || preg_match('/[\x00-\x1F\x7F]/u', $deviceName)) {
                $deviceName = null;
            }
        }

        // Authenticator attachment type
        $authenticatorType = $input['authenticatorAttachment'] ?? null;
        if (!in_array($authenticatorType, ['platform', 'cross-platform'], true)) {
            $authenticatorType = null;
        }

        $maxCredentials = $this->maxCredentialsPerUser();
        try {
            $registrationPersisted = DB::transaction(function () use (
                $userId,
                $tenantId,
                $maxCredentials,
                $securityConfirmationToken,
                $credentialIdB64,
                $verified,
                $transports,
                $deviceName,
                $authenticatorType,
                $context,
                $challengeData
            ): bool {
                // Routing mutations lock this tenant boundary before they
                // re-check RP impact. Taking the same lock first prevents a
                // registration from committing in the gap between a mutation's
                // safety check and its parent/domain update.
                $routingTenant = DB::table('tenants')
                    ->where('id', $tenantId)
                    ->lockForUpdate()
                    ->first(['id']);
                $storedRoutingFingerprint = $challengeData['metadata']['routing_fingerprint'] ?? null;
                if (
                    $routingTenant === null
                    || !is_string($storedRoutingFingerprint)
                    || strlen($storedRoutingFingerprint) !== 64
                    || !hash_equals(
                        $storedRoutingFingerprint,
                        $this->currentTenantRoutingFingerprint($tenantId)
                    )
                ) {
                    throw new \UnexpectedValueException('WebAuthn registration routing changed.');
                }

                // Serialize registrations on the user row. The challenge-time
                // count is only an early UX guard; without this second check,
                // parallel ceremonies could exceed the configured limit.
                $userExists = DB::table('users')
                    ->where('id', $userId)
                    ->where('tenant_id', $tenantId)
                    ->lockForUpdate()
                    ->first(['id']);
                if ($userExists === null) {
                    throw new \RuntimeException('WebAuthn registration user no longer exists.');
                }

                $credentialCount = DB::table('webauthn_credentials')
                    ->where('user_id', $userId)
                    ->where('tenant_id', $tenantId)
                    ->count();
                if ($credentialCount >= $maxCredentials) {
                    throw new \OverflowException('WebAuthn credential limit reached.');
                }

                // Revalidate the exact proof accepted at request entry while
                // holding the same tenant-scoped user lock as password changes,
                // password resets, and logout-all. A revocation that committed
                // first advances the global cutoff and invalidates this token;
                // a revocation that starts later must wait for enrollment.
                if ($this->tokenService->validateSecurityConfirmationTokenUnderUserLock(
                    $securityConfirmationToken,
                    $userId,
                    $tenantId
                ) === null) {
                    return false;
                }

                DB::insert(
                    "INSERT INTO webauthn_credentials
                        (user_id, tenant_id, credential_id, public_key, sign_count, transports,
                         device_name, authenticator_type, attestation_type, rp_id,
                         registration_origin, user_handle, aaguid, backup_eligible,
                         backup_state, user_verified, credential_discoverable, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())",
                    [
                        $userId,
                        $tenantId,
                        $credentialIdB64,
                        $verified['public_key'],
                        $verified['sign_count'],
                        $transports,
                        $deviceName,
                        $authenticatorType,
                        $verified['attestation_format'],
                        $context['rp_id'],
                        $context['origin'],
                        (string) ($challengeData['metadata']['user_handle'] ?? ''),
                        $verified['aaguid'],
                        $verified['backup_eligible'] ? 1 : 0,
                        $verified['backup_state'] ? 1 : 0,
                        1,
                        1,
                    ]
                );

                return true;
            });

            if (!$registrationPersisted) {
                Log::notice('[WebAuthn] Registration confirmation invalidated before persistence', [
                    'tenant_id' => $tenantId,
                    'user_id' => $userId,
                ]);

                return $this->securityConfirmationFailed();
            }
        } catch (\OverflowException) {
            return $this->noStore($this->respondWithError(
                'WEBAUTHN_CREDENTIAL_LIMIT',
                __('api.validation_failed'),
                null,
                409
            ));
        } catch (\UnexpectedValueException) {
            Log::notice('[WebAuthn] Registration rejected after routing changed', [
                'tenant_id' => $tenantId,
                'user_id' => $userId,
            ]);

            return $this->noStore($this->respondWithError(
                ApiErrorCodes::AUTH_WEBAUTHN_FAILED,
                __('api.webauthn_registration_failed'),
                null,
                409
            ));
        } catch (QueryException $e) {
            $duplicate = (int) ($e->errorInfo[1] ?? 0) === 1062
                || str_contains(strtolower($e->getMessage()), 'duplicate entry');
            Log::notice('[WebAuthn] Credential persistence rejected', [
                'tenant_id' => $tenantId,
                'user_id' => $userId,
                'duplicate' => $duplicate,
            ]);

            return $this->noStore($this->respondWithError(
                $duplicate ? 'WEBAUTHN_CREDENTIAL_EXISTS' : ApiErrorCodes::AUTH_WEBAUTHN_FAILED,
                __('api.webauthn_registration_failed'),
                null,
                $duplicate ? 409 : 400
            ));
        } catch (\Throwable $e) {
            Log::error('[WebAuthn] Credential persistence failed', [
                'tenant_id' => $tenantId,
                'user_id' => $userId,
                'exception' => $e::class,
            ]);

            return $this->noStore($this->respondWithError(
                ApiErrorCodes::AUTH_WEBAUTHN_FAILED,
                __('api.service_unavailable'),
                null,
                503
            ));
        }

        // Security notification + email — both rendered in user's preferred_language.
        try {
            $user = User::query()->find($userId);
            $userLocale = $user->preferred_language ?? null;

            LocaleContext::withLocale($userLocale, function () use ($userId) {
                try {
                    Notification::createNotification(
                        $userId,
                        __('emails_security_alerts.passkey_registered.body', ['community' => TenantContext::get()['name'] ?? 'Project NEXUS']),
                        '/settings/security',
                        'passkey_registered'
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) ($userId), 'passkey_registered', __('emails_security_alerts.passkey_registered.body', ['community' => TenantContext::get()['name'] ?? 'Project NEXUS']), '/settings/security');
                } catch (\Throwable $e) {
                    \Illuminate\Support\Facades\Log::warning("Failed to create passkey registered notification: " . $e->getMessage());
                }
            });

            if ($user && $user->email) {
                $tenantId = (int) ($user->tenant_id ?? TenantContext::getId());
                TenantContext::runForTenant($tenantId, function () use ($user, $userId, $userLocale, $tenantId): void {
                    LocaleContext::withLocale($userLocale, function () use ($user, $userId, $tenantId) {
                        $tenantName = TenantContext::get()['name'] ?? 'Project NEXUS';
                        $userName   = $user->first_name ?? $user->name ?? '';

                        $html = EmailTemplateBuilder::make()
                            ->theme('warning')
                            ->title(__('emails_security_alerts.passkey_registered.title'))
                            ->previewText(__('emails_security_alerts.passkey_registered.preview'))
                            ->greeting($userName)
                            ->paragraph(__('emails_security_alerts.passkey_registered.body', ['community' => $tenantName]))
                            ->paragraph(__('emails_security_alerts.passkey_registered.warning'))
                            ->render();

                        $subject = __('emails_security_alerts.passkey_registered.subject', ['community' => $tenantName]);
                        if (!EmailDispatchService::sendRaw($user->email, $subject, $html, null, null, null, 'security_alert', ['tenant_id' => $tenantId])) {
                            \Illuminate\Support\Facades\Log::warning("Failed to send passkey registered email to user {$userId}");
                        }
                    });
                });
            }
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning("Failed to send passkey registered email: " . $e->getMessage());
        }

        Log::info('[WebAuthn] Passkey registered', [
            'tenant_id' => $tenantId,
            'user_id' => $userId,
            'credential_ref' => $this->credentialReference($credentialIdB64),
            'rp_id' => $context['rp_id'],
            'backup_eligible' => $verified['backup_eligible'],
        ]);

        return $this->noStore($this->respondWithData(['message' => __('api_controllers_2.webauthn.passkey_registered')]));
    }

    /** POST /api/webauthn/auth-challenge */
    public function authChallenge(): JsonResponse
    {
        $this->rateLimit('webauthn_auth_challenge', 10, 60);

        if (!$this->passkeyAuthenticationEnabled()) {
            return $this->noStore($this->respondWithError('FEATURE_DISABLED', __('api.feature_disabled'), null, 403));
        }

        $input = $this->getAllInput();
        $context = $this->resolveWebAuthnContext();
        if ($context === null) {
            return $this->noStore($this->respondWithError(
                'AUTH_WEBAUTHN_ORIGIN_NOT_ALLOWED',
                __('api.webauthn_auth_failed'),
                null,
                400
            ));
        }

        // Determine user context (may be null for discoverable credential flow)
        $userId = null;
        $email = $input['email'] ?? null;
        if ($email !== null && !is_string($email)) {
            return $this->noStore($this->respondWithError(
                ApiErrorCodes::VALIDATION_ERROR,
                __('api.validation_failed'),
                'email',
                400
            ));
        }
        $email = is_string($email) ? mb_strtolower(trim($email)) : null;
        if ($email === '') {
            $email = null;
        }
        if ($email !== null && (mb_strlen($email) > 254 || filter_var($email, FILTER_VALIDATE_EMAIL) === false)) {
            return $this->noStore($this->respondWithError(
                ApiErrorCodes::VALIDATION_ERROR,
                __('api.validation_failed'),
                'email',
                400
            ));
        }

        // Check if user is already authenticated (re-auth scenario)
        $authUserId = $this->getOptionalUserId();

        // Build allowCredentials list
        $allowCredentials = [];
        $tenantId = TenantContext::getId();

        if ($authUserId) {
            $userId = $authUserId;
            $credentials = DB::select(
                "SELECT credential_id, transports FROM webauthn_credentials
                 WHERE user_id = ? AND tenant_id = ? AND (rp_id = ? OR rp_id IS NULL)",
                [$userId, $tenantId, $context['rp_id']]
            );

            $allowCredentials = $this->formatAllowCredentials(array_map(fn($r) => (array)$r, $credentials));
        }

        $realAllowedIds = array_map(
            static fn (array $credential): string => (string) $credential['id'],
            $authUserId ? $allowCredentials : []
        );

        // Bind the authentication window to the server-side challenge. A
        // logout-all or password change at or after this point invalidates the
        // ceremony even when the authenticator assertion is otherwise valid.
        $authenticationStartedAt = time();
        $challengeB64 = $this->base64UrlEncode(random_bytes(32));
        try {
            $challengeId = $this->webAuthnChallengeStore->create(
                $challengeB64,
                $userId,
                'authenticate',
                [
                    'origin' => $context['origin'],
                    'rp_id' => $context['rp_id'],
                    'allowed_credential_ids' => $realAllowedIds,
                    'authentication_started_at' => $authenticationStartedAt,
                    // Signed-out login always uses resident/discoverable
                    // credentials. Looking up descriptor IDs by email creates
                    // an unavoidable timing distinction between real IDs and
                    // decoys during verification, so public challenges never
                    // bind to or reveal an account.
                    'account_bound' => $authUserId !== null,
                    'discoverable' => $authUserId === null,
                ]
            );
        } catch (\Throwable $e) {
            Log::error('[WebAuthn] Challenge storage unavailable', [
                'tenant_id' => $tenantId,
                'ceremony' => 'authenticate',
                'error' => $e->getMessage(),
            ]);

            return $this->noStore($this->respondWithError(
                'AUTH_WEBAUTHN_UNAVAILABLE',
                __('api.service_unavailable'),
                null,
                503
            ));
        }

        $options = [
            'challenge' => $challengeB64,
            'challenge_id' => $challengeId,
            'rpId' => $context['rp_id'],
            'timeout' => 60000,
            'userVerification' => 'required',
        ];

        if (!empty($allowCredentials)) {
            $options['allowCredentials'] = $allowCredentials;
        }

        return $this->noStore($this->respondWithData($options));
    }

    /** POST /api/webauthn/auth-verify */
    public function authVerify(): JsonResponse
    {
        $this->rateLimit('webauthn_auth_verify', 10, 60);

        if (!$this->passkeyAuthenticationEnabled()) {
            return $this->noStore($this->respondWithError('FEATURE_DISABLED', __('api.feature_disabled'), null, 403));
        }

        $input = $this->getAllInput();

        try {
            $credentialIdBytes = $this->decodeCredentialId($input['id'] ?? null);
            $rawCredentialId = $this->decodeCredentialId($input['rawId'] ?? null);
            if (!hash_equals($credentialIdBytes, $rawCredentialId)) {
                throw new \InvalidArgumentException('Credential id/rawId mismatch');
            }
            if (($input['type'] ?? null) !== 'public-key' || !is_array($input['response'] ?? null)) {
                throw new \InvalidArgumentException('Invalid assertion type');
            }
            $clientDataJson = $this->decodeBase64UrlField(
                $input['response']['clientDataJSON'] ?? null,
                self::MAX_CLIENT_DATA_BYTES
            );
            $authenticatorData = $this->decodeBase64UrlField(
                $input['response']['authenticatorData'] ?? null,
                self::MAX_AUTHENTICATOR_DATA_BYTES
            );
            $signature = $this->decodeBase64UrlField(
                $input['response']['signature'] ?? null,
                self::MAX_SIGNATURE_BYTES
            );
            if (strlen($authenticatorData) < 37) {
                throw new \InvalidArgumentException('Authenticator data too short');
            }
        } catch (\InvalidArgumentException) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_REQUIRED_FIELD, __('api.webauthn_invalid_assertion'), null, 400);
        }

        $challengeData = $this->pullStoredChallenge($input, 'authenticate', null);
        if ($challengeData instanceof JsonResponse) {
            return $challengeData;
        }

        $context = $this->validateChallengeContext($challengeData);
        if ($context instanceof JsonResponse) {
            return $context;
        }

        if (!$this->clientDataMatches($clientDataJson, 'webauthn.get', $context['origin'])) {
            return $this->authVerificationFailed();
        }

        try {
            $challengeBytes = $this->decodeBase64UrlField($challengeData['challenge'] ?? null, 64);
        } catch (\InvalidArgumentException) {
            return $this->authVerificationFailed();
        }

        $credentialId = $this->base64UrlEncode($credentialIdBytes);
        $metadata = is_array($challengeData['metadata'] ?? null) ? $challengeData['metadata'] : [];
        // The top-level creation time keeps in-flight challenges from an older
        // release compatible during a rolling deployment. New challenges bind
        // the same timestamp explicitly in their authentication metadata.
        $authenticationStartedAt = $metadata['authentication_started_at']
            ?? $challengeData['created_at']
            ?? null;
        if (
            !is_int($authenticationStartedAt)
            || $authenticationStartedAt < 1
            || $authenticationStartedAt > time()
        ) {
            return $this->authVerificationFailed();
        }
        $allowedIds = is_array($metadata['allowed_credential_ids'] ?? null)
            ? array_values(array_filter($metadata['allowed_credential_ids'], 'is_string'))
            : [];
        $accountBound = ($metadata['account_bound'] ?? false) === true;
        if (($accountBound && $allowedIds === []) || ($allowedIds !== [] && !in_array($credentialId, $allowedIds, true))) {
            return $this->authVerificationFailed();
        }

        $tenantId = TenantContext::getId();
        $rpName = TenantContext::get()['name'] ?? 'Project NEXUS';
        // Native passkeys are not implemented in the mobile client yet. Do not
        // let spoofable public headers upgrade this browser ceremony to a
        // longer-lived mobile credential.
        $isMobile = false;

        try {
            $result = DB::transaction(function () use (
                $tenantId,
                $credentialId,
                $challengeData,
                $metadata,
                $input,
                $rpName,
                $context,
                $clientDataJson,
                $authenticatorData,
                $signature,
                $challengeBytes,
                $authenticationStartedAt,
                $isMobile
            ): array {
                // Resolve the owner first, then take the exact users-row lock
                // used by TokenService::revokeAllTokensForUser(). This totally
                // orders token issuance with logout-all and password changes.
                $credentialOwner = DB::table('webauthn_credentials')
                    ->where('credential_id', $credentialId)
                    ->where('tenant_id', $tenantId)
                    ->where(function ($query) use ($context): void {
                        $query->where('rp_id', $context['rp_id'])
                            ->orWhereNull('rp_id');
                    })
                    ->first(['user_id']);
                if ($credentialOwner === null) {
                    return ['failed' => true];
                }

                $lockedUser = DB::table('users')
                    ->where('id', (int) $credentialOwner->user_id)
                    ->where('tenant_id', $tenantId)
                    ->lockForUpdate()
                    ->first([
                        'id',
                        'first_name',
                        'last_name', 'profile_type', 'organization_name',
                        'email',
                        'role',
                        'tenant_id',
                        'is_super_admin',
                        'is_tenant_super_admin',
                        'is_god',
                        'status',
                        'verification_status',
                        'email_verified_at',
                        'is_approved',
                    ]);
                if ($lockedUser === null) {
                    return ['failed' => true];
                }

                $row = DB::table('webauthn_credentials as wc')
                    ->where('wc.credential_id', $credentialId)
                    ->where('wc.user_id', (int) $lockedUser->id)
                    ->where('wc.tenant_id', $tenantId)
                    ->where(function ($query) use ($context): void {
                        $query->where('wc.rp_id', $context['rp_id'])
                            ->orWhereNull('wc.rp_id');
                    })
                    ->select([
                        'wc.id as credential_row_id',
                        'wc.user_id as credential_user_id',
                        'wc.tenant_id as credential_tenant_id',
                        'wc.credential_id',
                        'wc.public_key',
                        'wc.sign_count',
                        'wc.rp_id',
                        'wc.user_handle',
                        'wc.backup_eligible',
                        'wc.user_verified',
                    ])
                    ->lockForUpdate()
                    ->first();

                if ($row === null) {
                    return ['failed' => true];
                }

                $credential = array_merge(
                    (array) $row,
                    (array) $lockedUser,
                    [
                        'user_id' => (int) $lockedUser->id,
                        'user_tenant_id' => (int) $lockedUser->tenant_id,
                    ]
                );
                $boundUserId = $challengeData['user_id'] ?? null;
                if ($boundUserId !== null && (int) $boundUserId !== (int) $credential['user_id']) {
                    return ['failed' => true];
                }

                $discoverable = ($metadata['discoverable'] ?? false) === true;
                $responseUserHandle = $input['response']['userHandle'] ?? null;
                if ($discoverable && (!is_string($responseUserHandle) || $responseUserHandle === '')) {
                    return ['failed' => true];
                }
                if ($responseUserHandle !== null) {
                    try {
                        $returnedHandle = $this->decodeBase64UrlField($responseUserHandle, 64);
                        $storedHandle = $this->decodeBase64UrlField($credential['user_handle'] ?? null, 64);
                    } catch (\InvalidArgumentException) {
                        return ['failed' => true];
                    }
                    if (!hash_equals($storedHandle, $returnedHandle)) {
                        return ['failed' => true];
                    }
                }

                $newSignCount = $this->ceremonyVerifier->verifyAuthentication(
                    $rpName,
                    $context['rp_id'],
                    $clientDataJson,
                    $authenticatorData,
                    $signature,
                    (string) $credential['public_key'],
                    $challengeBytes,
                    (int) $credential['sign_count']
                );

                $flags = ord($authenticatorData[32]);
                $backupEligible = ($flags & 0x08) !== 0;
                $backupState = ($flags & 0x10) !== 0;
                if ($backupState && !$backupEligible) {
                    return ['failed' => true];
                }
                // The BE flag is fixed when a credential is created. A change
                // is an authenticator-state inconsistency and must fail. Legacy
                // rows have user_verified=NULL/0 until their first hardened UV
                // assertion establishes trustworthy metadata.
                if (
                    (bool) ($credential['user_verified'] ?? false)
                    && $backupEligible !== (bool) ($credential['backup_eligible'] ?? false)
                ) {
                    return ['failed' => true];
                }

                // Possession has now been established. While the issuance lock
                // is still held, fail closed if logout-all or a password change
                // committed at any point since this challenge began.
                if (!$this->tokenService->isAuthenticationStartValid(
                    (int) $credential['user_id'],
                    $authenticationStartedAt
                )) {
                    return ['failed' => true];
                }

                // Verify possession before evaluating account policy. Email-bound
                // challenges intentionally contain padded credential IDs; returning
                // a gate-specific response for the real ID before signature
                // verification would turn those IDs into an account-enumeration
                // oracle. A valid assertion may receive the applicable gate, but an
                // invalid assertion always receives the generic WebAuthn failure.
                $gateBlock = $this->tenantSettingsService->checkLoginGatesForUser($credential);
                if ($gateBlock !== null) {
                    return ['gate' => $gateBlock];
                }

                DB::table('webauthn_credentials')
                    ->where('id', (int) $credential['credential_row_id'])
                    ->where('tenant_id', $tenantId)
                    ->update([
                        'sign_count' => $newSignCount,
                        'last_used_at' => now(),
                        'backup_eligible' => $backupEligible ? 1 : 0,
                        'backup_state' => $backupState ? 1 : 0,
                        'user_verified' => 1,
                        'rp_id' => $context['rp_id'],
                        'updated_at' => now(),
                    ]);

                DB::table('users')
                    ->where('id', (int) $credential['user_id'])
                    ->where('tenant_id', $tenantId)
                    ->update(['last_login_at' => now()]);

                $accessToken = $this->tokenService->generateToken(
                    (int) $credential['user_id'],
                    (int) $credential['user_tenant_id'],
                    [
                        'role' => $credential['role'],
                        'email' => $credential['email'],
                        'is_super_admin' => !empty($credential['is_super_admin']),
                        'is_tenant_super_admin' => !empty($credential['is_tenant_super_admin']),
                        'is_god' => !empty($credential['is_god']),
                        'amr' => ['passkey', 'user_verification'],
                        'acr' => 'urn:nexus:aal2',
                        'credential_ref' => $this->credentialReference($credentialId),
                    ],
                    $isMobile
                );
                $refreshToken = $this->tokenService->generateRefreshToken(
                    (int) $credential['user_id'],
                    (int) $credential['user_tenant_id'],
                    $isMobile
                );
                $securityConfirmationToken = $this->tokenService->generateSecurityConfirmationToken(
                    (int) $credential['user_id'],
                    (int) $credential['user_tenant_id'],
                    'passkey_uv'
                );

                return [
                    'credential' => $credential,
                    'access_token' => $accessToken,
                    'refresh_token' => $refreshToken,
                    'security_confirmation_token' => $securityConfirmationToken,
                ];
            });
        } catch (\Throwable $e) {
            Log::warning('[WebAuthn] Authentication verification failed', [
                'tenant_id' => $tenantId,
                'credential_ref' => $this->credentialReference($credentialId),
                'reason' => $e instanceof WebAuthnException ? 'verification_rejected' : 'verification_error',
            ]);

            return $this->authVerificationFailed();
        }

        if (isset($result['gate']) && is_array($result['gate'])) {
            return $this->noStore($this->respondWithError(
                (string) $result['gate']['code'],
                (string) $result['gate']['message'],
                null,
                403
            ));
        }
        if (
            !isset(
                $result['credential'],
                $result['access_token'],
                $result['refresh_token'],
                $result['security_confirmation_token']
            )
            || !is_array($result['credential'])
            || !is_string($result['access_token'])
            || !is_string($result['refresh_token'])
            || !is_string($result['security_confirmation_token'])
        ) {
            return $this->authVerificationFailed();
        }

        $credential = $result['credential'];
        $accessToken = $result['access_token'];
        $refreshToken = $result['refresh_token'];
        $securityConfirmationToken = $result['security_confirmation_token'];

        // Keep passkey authentication on the frontend's established JWT token
        // family. Issuing a second Sanctum bearer plus a raw PHP session would
        // multiply revocation surfaces for the same ceremony. The response key
        // remains for backwards-compatible clients, but is deliberately null.
        $sanctumToken = null;

        Log::info('[WebAuthn] Passkey authentication succeeded', [
            'tenant_id' => $tenantId,
            'user_id' => (int) $credential['user_id'],
            'credential_ref' => $this->credentialReference($credentialId),
            'rp_id' => $context['rp_id'],
            'user_verified' => true,
        ]);

        // Auth success response — follows the same contract as AuthController/TotpController
        // (success, user, tokens). Frontend explicitly handles this shape.
        return response()->json([
            'success' => true,
            'message' => __('api_controllers_2.webauthn.auth_successful'),
            'user' => [
                'id' => $credential['user_id'],
                'first_name' => $credential['first_name'],
                'last_name' => $credential['last_name'],
                'email' => $credential['email'],
            ],
            'access_token' => $accessToken,
            'refresh_token' => $refreshToken,
            'sanctum_token' => $sanctumToken,
            'security_confirmation_token' => $securityConfirmationToken,
            'security_confirmation_expires_in' => 300,
            'token_type' => 'Bearer',
            'expires_in' => $this->tokenService->getAccessTokenExpiry($isMobile),
            'is_mobile' => $isMobile,
        ])->withHeaders([
            'Cache-Control' => 'no-store, private',
            'Pragma' => 'no-cache',
        ]);
    }

    /** POST /api/webauthn/security-confirm */
    public function confirmSecurityAction(): JsonResponse
    {
        $this->rateLimit('webauthn_security_confirm', 10, 600);
        $userId = $this->requireAuth();
        $tenantId = TenantContext::getId();
        $input = $this->getAllInput();

        return DB::transaction(function () use ($userId, $tenantId, $input): JsonResponse {
            // Password changes, reset completion, and logout-all take this same
            // tenant-user lock before advancing the global revocation cutoff.
            // Keep factor verification and confirmation issuance under it so a
            // credential proven before revocation cannot mint a fresh token
            // after the revocation transaction commits.
            $user = DB::table('users')
                ->where('id', $userId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first(['password_hash', 'status']);
            if ($user === null || strtolower((string) $user->status) !== 'active') {
                return $this->noStore($this->respondWithError(
                    ApiErrorCodes::AUTH_ACCOUNT_SUSPENDED,
                    __('api.account_suspended'),
                    null,
                    403
                ));
            }

            $method = null;
            $password = $input['current_password'] ?? null;
            $totpCode = $input['totp_code'] ?? null;
            $backupCode = $input['backup_code'] ?? null;

            if (is_string($password) && $password !== '') {
                $dummyHash = '$argon2id$v=19$m=65536,t=4,p=1$V1Jna0owWXBLNC55ajFQRQ$h0+cXUsJzOi6TzES3RPuquTJpwPbpYmVHS4A3ArHHXo';
                if (!password_verify($password, $user->password_hash ?: $dummyHash)) {
                    return $this->securityConfirmationFailed();
                }
                $method = 'password';
            } elseif (is_string($totpCode) && $totpCode !== '') {
                $verified = TotpService::verifyLogin(
                    $userId,
                    preg_replace('/\s+/', '', $totpCode),
                    $tenantId
                );
                if (($verified['success'] ?? false) !== true) {
                    return $this->securityConfirmationFailed();
                }
                $method = 'totp';
            } elseif (is_string($backupCode) && $backupCode !== '') {
                $verified = TotpService::verifyBackupCode($userId, $backupCode, $tenantId);
                if (($verified['success'] ?? false) !== true) {
                    return $this->securityConfirmationFailed();
                }
                $method = 'backup_code';
            } else {
                // A UV passkey sign-in already proved possession plus local user
                // verification. Honour that proof for its original five-minute
                // security-confirmation window without prompting for a password
                // the member may not have. Revalidation occurs only after the
                // issuance lock is held, so a concurrent global revocation wins.
                $bearerToken = request()->bearerToken();
                $jwtPayload = is_string($bearerToken) && $bearerToken !== ''
                    ? $this->tokenService->validateToken($bearerToken)
                    : null;
                $amr = is_array($jwtPayload['amr'] ?? null) ? $jwtPayload['amr'] : [];
                $issuedAt = (int) ($jwtPayload['iat'] ?? 0);
                $isRecentPasskey = is_array($jwtPayload)
                    && (int) ($jwtPayload['user_id'] ?? 0) === $userId
                    && (int) ($jwtPayload['tenant_id'] ?? 0) === $tenantId
                    && in_array('passkey', $amr, true)
                    && in_array('user_verification', $amr, true)
                    && $issuedAt >= time() - 300
                    && $issuedAt <= time() + 30;

                if ($isRecentPasskey) {
                    $method = 'passkey_uv';
                }

                $accessToken = request()->user()?->currentAccessToken();
                $tokenName = strtolower((string) ($accessToken->name ?? ''));
                $createdAt = $accessToken->created_at ?? null;
                $isRecentFederated = $createdAt !== null
                    && $createdAt->greaterThanOrEqualTo(now()->subMinutes(5))
                    && (str_starts_with($tokenName, 'oauth-')
                        || str_starts_with($tokenName, 'sso-')
                        || str_starts_with($tokenName, 'oidc-'));
                if ($method === null && !$isRecentFederated) {
                    return $this->securityConfirmationFailed();
                }
                $method ??= 'federated_login';
            }

            $token = $this->tokenService->generateSecurityConfirmationToken(
                $userId,
                $tenantId,
                $method
            );

            Log::info('[WebAuthn] Security action confirmed', [
                'tenant_id' => $tenantId,
                'user_id' => $userId,
                'method' => $method,
            ]);

            return $this->noStore($this->respondWithData([
                'security_confirmation_token' => $token,
                'expires_in' => 300,
            ]));
        }, 3);
    }

    /** POST /api/webauthn/remove */
    public function remove(): JsonResponse
    {
        $userId = $this->requireAuth();
        $input = $this->getAllInput();
        $tenantId = TenantContext::getId();
        $confirmationError = $this->requireSecurityConfirmation($userId, $tenantId, $input);
        if ($confirmationError !== null) {
            return $confirmationError;
        }
        $credentialId = $input['credential_id'] ?? null;
        if (!is_string($credentialId) || trim($credentialId) === '') {
            return $this->respondWithError(
                ApiErrorCodes::VALIDATION_ERROR,
                __('api.missing_required_field', ['field' => 'credential_id']),
                'credential_id',
                422
            );
        }
        try {
            $credentialId = $this->base64UrlEncode($this->decodeCredentialId(trim($credentialId)));
        } catch (\InvalidArgumentException) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.webauthn_invalid_credential'), 'credential_id', 422);
        }
        try {
            $result = DB::transaction(function () use ($credentialId, $tenantId, $userId): array {
                // Lock the user first so passkey removal and OAuth unlinking cannot
                // concurrently delete the two methods after each sees the other.
                $hasAlternative = AuthenticationMethodGuard::hasAlternativeToPasskeys(
                    $userId,
                    $tenantId,
                    true
                );

                $credentials = DB::table('webauthn_credentials')
                    ->where('user_id', $userId)
                    ->where('tenant_id', $tenantId)
                    ->lockForUpdate()
                    ->pluck('credential_id');

                if (!$credentials->contains($credentialId)) {
                    return ['deleted' => 0, 'blocked' => false];
                }

                if ($credentials->count() === 1 && !$hasAlternative) {
                    return ['deleted' => 0, 'blocked' => true];
                }

                $deleted = DB::table('webauthn_credentials')
                    ->where('user_id', $userId)
                    ->where('tenant_id', $tenantId)
                    ->where('credential_id', $credentialId)
                    ->delete();
                if ($deleted > 0) {
                    $this->revokeSessionsAfterFactorRemoval($userId);
                }

                return ['deleted' => $deleted, 'blocked' => false];
            });
        } catch (\Throwable $e) {
            Log::error('[WebAuthn] Passkey removal transaction failed', [
                'tenant_id' => $tenantId,
                'user_id' => $userId,
                'exception' => $e::class,
            ]);

            return $this->noStore($this->respondWithError(
                'AUTH_WEBAUTHN_UNAVAILABLE',
                __('api.service_unavailable'),
                null,
                503
            ));
        }

        if ($result['blocked']) {
            return $this->respondWithError(
                'LAST_SIGN_IN_METHOD',
                __('api.cannot_remove_last_sign_in_method'),
                null,
                409
            );
        }

        $deleted = (int) $result['deleted'];

        if ($deleted === 0) {
            return $this->respondWithData(['message' => __('api_controllers_2.webauthn.credentials_removed')]);
        }

        // Security notification + email — both rendered in user's preferred_language.
        try {
            $user = User::query()->find($userId);
            $userLocale = $user->preferred_language ?? null;

            LocaleContext::withLocale($userLocale, function () use ($userId) {
                try {
                    Notification::createNotification(
                        $userId,
                        __('api_controllers_2.webauthn.passkey_removed_bell'),
                        '/settings/security',
                        'passkey_removed'
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) ($userId), 'passkey_removed', __('api_controllers_2.webauthn.passkey_removed_bell'), '/settings/security');
                } catch (\Throwable $e) {
                    Log::warning('[WebAuthn] Failed to create passkey removed notification: ' . $e->getMessage(), ['user_id' => $userId]);
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
                            ->title(__('emails_security_alerts.passkey_removed.title'))
                            ->previewText(__('emails_security_alerts.passkey_removed.preview'))
                            ->greeting($userName)
                            ->paragraph(__('emails_security_alerts.passkey_removed.body', ['community' => $tenantName]))
                            ->paragraph(__('emails_security_alerts.passkey_removed.warning'))
                            ->render();

                        $subject = __('emails_security_alerts.passkey_removed.subject', ['community' => $tenantName]);
                        if (!EmailDispatchService::sendRaw($user->email, $subject, $html, null, null, null, 'security_alert', ['tenant_id' => $tenantId])) {
                            Log::warning('[WebAuthn] Failed to send passkey removed email', ['user_id' => $userId]);
                        }
                    });
                });
            }
        } catch (\Throwable $e) {
            Log::warning('[WebAuthn] Failed to send passkey removed email: ' . $e->getMessage(), ['user_id' => $userId]);
        }

        return $this->respondWithData([
            'message' => __('api_controllers_2.webauthn.credentials_removed'),
            'sessions_revoked' => true,
        ]);
    }

    /** POST /api/webauthn/rename */
    public function rename(): JsonResponse
    {
        $userId = $this->requireAuth();
        $input = $this->getAllInput();
        $tenantId = TenantContext::getId();
        $confirmationError = $this->requireSecurityConfirmation($userId, $tenantId, $input);
        if ($confirmationError !== null) {
            return $confirmationError;
        }
        $credentialId = $input['credential_id'] ?? null;
        $newName = $input['device_name'] ?? null;

        if (!is_string($credentialId) || !is_string($newName) || trim($credentialId) === '' || trim($newName) === '') {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.webauthn_name_fields_required'), null, 400);
        }

        try {
            $credentialId = $this->base64UrlEncode($this->decodeCredentialId(trim($credentialId)));
        } catch (\InvalidArgumentException) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.webauthn_invalid_credential'), 'credential_id', 422);
        }

        $newName = mb_substr(trim($newName), 0, 100);
        if ($newName === '' || preg_match('/[\x00-\x1F\x7F]/u', $newName)) {
            return $this->respondWithError(ApiErrorCodes::VALIDATION_ERROR, __('api.webauthn_name_empty'), 'device_name', 400);
        }

        $affected = DB::update(
            "UPDATE webauthn_credentials SET device_name = ? WHERE credential_id = ? AND user_id = ? AND tenant_id = ?",
            [$newName, $credentialId, $userId, $tenantId]
        );

        if ($affected === 0) {
            return $this->respondWithError(ApiErrorCodes::RESOURCE_NOT_FOUND, __('api.webauthn_credential_not_found'), null, 404);
        }

        return $this->respondWithData(['device_name' => $newName]);
    }

    /** POST /api/webauthn/remove-all */
    public function removeAll(): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = TenantContext::getId();
        $input = $this->getAllInput();
        $confirmationError = $this->requireSecurityConfirmation($userId, $tenantId, $input);
        if ($confirmationError !== null) {
            return $confirmationError;
        }
        try {
            $result = DB::transaction(function () use ($tenantId, $userId): array {
                $hasAlternative = AuthenticationMethodGuard::hasAlternativeToPasskeys(
                    $userId,
                    $tenantId,
                    true
                );
                $credentialIds = DB::table('webauthn_credentials')
                    ->where('user_id', $userId)
                    ->where('tenant_id', $tenantId)
                    ->lockForUpdate()
                    ->pluck('credential_id');
                $count = $credentialIds->count();

                if ($count > 0 && !$hasAlternative) {
                    return ['count' => $count, 'blocked' => true];
                }

                DB::table('webauthn_credentials')
                    ->where('user_id', $userId)
                    ->where('tenant_id', $tenantId)
                    ->delete();
                if ($count > 0) {
                    $this->revokeSessionsAfterFactorRemoval($userId);
                }

                return ['count' => $count, 'blocked' => false];
            });
        } catch (\Throwable $e) {
            Log::error('[WebAuthn] Remove-all transaction failed', [
                'tenant_id' => $tenantId,
                'user_id' => $userId,
                'exception' => $e::class,
            ]);

            return $this->noStore($this->respondWithError(
                'AUTH_WEBAUTHN_UNAVAILABLE',
                __('api.service_unavailable'),
                null,
                503
            ));
        }

        if ($result['blocked']) {
            return $this->respondWithError(
                'LAST_SIGN_IN_METHOD',
                __('api.cannot_remove_last_sign_in_method'),
                null,
                409
            );
        }

        $count = (int) $result['count'];

        // Security notification + email for all passkeys removed — rendered in
        // the user's preferred_language.
        if ($count > 0) {
            try {
                $user = User::query()->find($userId);
                $userLocale = $user->preferred_language ?? null;

                LocaleContext::withLocale($userLocale, function () use ($userId, $count) {
                    try {
                        Notification::createNotification(
                            $userId,
                            __('api_controllers_2.webauthn.all_passkeys_removed_bell', ['count' => $count]),
                            '/settings/security',
                            'passkey_removed'
                        );
                        \App\Services\NotificationDispatcher::fanOutPush((int) ($userId), 'passkey_removed', __('api_controllers_2.webauthn.all_passkeys_removed_bell', ['count' => $count]), '/settings/security');
                    } catch (\Throwable $e) {
                        Log::warning('[WebAuthn] Failed to create all-passkeys removed notification: ' . $e->getMessage(), ['user_id' => $userId]);
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
                                ->title(__('emails_security_alerts.passkey_removed.title'))
                                ->previewText(__('emails_security_alerts.passkey_removed.preview'))
                                ->greeting($userName)
                                ->paragraph(__('emails_security_alerts.passkey_removed.body', ['community' => $tenantName]))
                                ->paragraph(__('emails_security_alerts.passkey_removed.warning'))
                                ->render();

                            $subject = __('emails_security_alerts.passkey_removed.subject', ['community' => $tenantName]);
                            if (!EmailDispatchService::sendRaw($user->email, $subject, $html, null, null, null, 'security_alert', ['tenant_id' => $tenantId])) {
                                Log::warning('[WebAuthn] Failed to send all-passkeys removed email', ['user_id' => $userId]);
                            }
                        });
                    });
                }
            } catch (\Throwable $e) {
                Log::warning('[WebAuthn] Failed to send all-passkeys removed email: ' . $e->getMessage(), ['user_id' => $userId]);
            }
        }

        return $this->respondWithData([
            'message' => __('api_controllers_2.webauthn.all_removed', ['count' => $count]),
            'removed_count' => $count,
            'sessions_revoked' => $count > 0,
        ]);
    }

    /** GET /api/webauthn/credentials */
    public function credentials(): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = TenantContext::getId();

        $results = DB::select(
            "SELECT credential_id, device_name, authenticator_type, rp_id, aaguid,
                    backup_eligible, backup_state, user_verified,
                    credential_discoverable, created_at, last_used_at
             FROM webauthn_credentials
             WHERE user_id = ? AND tenant_id = ?
             ORDER BY created_at DESC",
            [$userId, $tenantId]
        );
        $credentials = array_map(static function (object $row): array {
            $credential = (array) $row;
            foreach (['backup_eligible', 'backup_state', 'user_verified', 'credential_discoverable'] as $field) {
                if (array_key_exists($field, $credential) && $credential[$field] !== null) {
                    $credential[$field] = (bool) $credential[$field];
                }
            }

            return $credential;
        }, $results);

        return $this->respondWithData([
            'credentials' => $credentials,
            'count' => count($credentials),
        ]);
    }

    /** GET /api/webauthn/status */
    public function status(): JsonResponse
    {
        $userId = $this->getOptionalUserId();
        $context = $this->resolveWebAuthnContext();

        if (!$userId) {
            return $this->respondWithData([
                'registered' => false,
                'count' => 0,
                'authentication_allowed' => $this->passkeyAuthenticationEnabled(),
                'enrollment_allowed' => false,
                'current_rp_id' => $context['rp_id'] ?? null,
                'max_credentials' => $this->maxCredentialsPerUser(),
            ]);
        }

        $tenantId = TenantContext::getId();
        $result = DB::selectOne(
            "SELECT COUNT(*) as count FROM webauthn_credentials WHERE user_id = ? AND tenant_id = ?",
            [$userId, $tenantId]
        );
        $hasPassword = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->whereNotNull('password_hash')
            ->where('password_hash', '!=', '')
            ->exists();
        $hasTotp = Schema::hasTable('user_totp_settings') && DB::table('user_totp_settings')
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->where('is_enabled', 1)
            ->exists();

        return $this->respondWithData([
            'registered' => $result->count > 0,
            'count' => (int)$result->count,
            'authentication_allowed' => $this->passkeyAuthenticationEnabled(),
            'enrollment_allowed' => $this->passkeyAuthenticationEnabled() && $this->passkeyEnrollmentEnabled(),
            'current_rp_id' => $context['rp_id'] ?? null,
            'max_credentials' => $this->maxCredentialsPerUser(),
            'confirmation_methods' => [
                'password' => $hasPassword,
                'passkey' => (int) $result->count > 0 && $this->passkeyAuthenticationEnabled(),
                'totp' => $hasTotp,
            ],
        ]);
    }

    // ========================================================================
    // HELPER METHODS
    // ========================================================================

    private function getWebAuthnUser(int $userId): ?array
    {
        $row = DB::selectOne(
            "SELECT id, " . UserDisplayName::sql('', 'name') . ", email FROM users WHERE id = ? AND tenant_id = ?",
            [$userId, TenantContext::getId()]
        );
        return $row ? (array)$row : null;
    }

    /** @return array{origin: string, rp_id: string}|null */
    private function resolveWebAuthnContext(): ?array
    {
        $originValue = request()->headers->get('Origin');
        if (!is_string($originValue) || $originValue === '') {
            $host = strtolower((string) request()->getHost());
            if (!app()->environment('testing') && !in_array($host, ['localhost', '127.0.0.1', '::1'], true)) {
                return null;
            }
            $originValue = request()->getSchemeAndHttpHost();
        }

        $origin = $this->normalizeOrigin($originValue);

        return $origin === null ? null : ($this->allowedOriginMap()[$origin] ?? null);
    }

    /** @return array<string, array{origin: string, rp_id: string}> */
    private function allowedOriginMap(): array
    {
        $map = [];
        $tenant = TenantContext::get() ?? [];
        $tenantHosts = [$tenant['domain'] ?? null, $tenant['accessible_domain'] ?? null];

        if (empty($tenant['domain']) && !empty($tenant['parent_id'])) {
            $parent = DB::selectOne(
                'SELECT domain, accessible_domain FROM tenants WHERE id = ? AND is_active = 1',
                [(int) $tenant['parent_id']]
            );
            if ($parent !== null) {
                $tenantHosts[] = $parent->domain;
                $tenantHosts[] = $parent->accessible_domain;
            }
        }

        foreach ($tenantHosts as $host) {
            if (!is_string($host) || trim($host) === '') {
                continue;
            }
            $host = strtolower(rtrim(trim($host), '.'));
            $origin = $this->normalizeOrigin('https://' . $host);
            if ($origin !== null) {
                $map[$origin] = ['origin' => $origin, 'rp_id' => $host];
            }
        }

        $platformRpId = strtolower(rtrim(trim((string) config('webauthn.rp_id', '')), '.'));
        $configuredOrigins = config('webauthn.allowed_origins', []);
        if (!is_array($configuredOrigins)) {
            $configuredOrigins = [];
        }
        $configuredOrigins[] = config('app.frontend_url');
        $configuredOrigins[] = config('app.accessible_frontend_url');
        if (app()->environment(['local', 'development', 'testing'])) {
            $configuredOrigins = array_merge($configuredOrigins, [
                'http://localhost',
                'http://localhost:5173',
                'http://localhost:8090',
                'http://127.0.0.1',
                'http://127.0.0.1:5173',
                'http://127.0.0.1:8090',
            ]);
        }

        foreach ($configuredOrigins as $configuredOrigin) {
            if (!is_string($configuredOrigin)) {
                continue;
            }
            $origin = $this->normalizeOrigin($configuredOrigin);
            if ($origin === null) {
                continue;
            }
            $host = strtolower((string) parse_url($origin, PHP_URL_HOST));
            $isLoopback = in_array($host, ['localhost', '127.0.0.1', '::1'], true);
            if ($isLoopback && !app()->environment(['local', 'development', 'testing'])) {
                continue;
            }
            $rpId = $isLoopback ? 'localhost' : $platformRpId;
            if ($rpId !== '' && ($host === $rpId || str_ends_with($host, '.' . $rpId))) {
                $map[$origin] = ['origin' => $origin, 'rp_id' => $rpId];
            }
        }

        return $map;
    }

    /**
     * Bind a registration challenge to the tenant routing state that selected
     * its RP ID. The lineage is included for domain-inheriting tenants, and the
     * platform inputs cover the shared application origins. A hierarchy/domain
     * mutation during the ceremony therefore invalidates the stale challenge
     * after the tenant-row lock is acquired and before a credential is inserted.
     */
    private function currentTenantRoutingFingerprint(int $tenantId): string
    {
        $lineage = [];
        $visited = [];
        $currentId = $tenantId;

        while ($currentId > 0 && !isset($visited[$currentId]) && count($lineage) < 32) {
            $visited[$currentId] = true;
            $tenant = DB::table('tenants')
                ->where('id', $currentId)
                ->first(['id', 'parent_id', 'domain', 'accessible_domain', 'is_active', 'updated_at']);
            if ($tenant === null) {
                break;
            }

            $domain = strtolower(rtrim(trim((string) ($tenant->domain ?? '')), '.'));
            $lineage[] = [
                'id' => (int) $tenant->id,
                'parent_id' => $tenant->parent_id === null ? null : (int) $tenant->parent_id,
                'domain' => $domain,
                'accessible_domain' => strtolower(rtrim(trim((string) ($tenant->accessible_domain ?? '')), '.')),
                'is_active' => (int) ($tenant->is_active ?? 0),
                'updated_at' => (string) ($tenant->updated_at ?? ''),
            ];

            if ($domain !== '' || empty($tenant->parent_id)) {
                break;
            }
            $currentId = (int) $tenant->parent_id;
        }

        return hash('sha256', json_encode([
            'tenant_id' => $tenantId,
            'lineage' => $lineage,
            'platform_rp_id' => strtolower(rtrim(trim((string) config('webauthn.rp_id', '')), '.')),
            'allowed_origins' => array_values(array_filter(
                (array) config('webauthn.allowed_origins', []),
                'is_string'
            )),
            'frontend_url' => (string) config('app.frontend_url', ''),
            'accessible_frontend_url' => (string) config('app.accessible_frontend_url', ''),
        ], JSON_THROW_ON_ERROR));
    }

    private function normalizeOrigin(string $value): ?string
    {
        if ($value === '' || $value === 'null') {
            return null;
        }
        $parts = parse_url($value);
        if (
            !is_array($parts)
            || !isset($parts['scheme'], $parts['host'])
            || isset($parts['user'])
            || isset($parts['pass'])
            || isset($parts['query'])
            || isset($parts['fragment'])
            || (isset($parts['path']) && !in_array($parts['path'], ['', '/'], true))
        ) {
            return null;
        }

        $scheme = strtolower((string) $parts['scheme']);
        $host = strtolower(rtrim((string) $parts['host'], '.'));
        $isLoopback = in_array($host, ['localhost', '127.0.0.1', '::1'], true);
        if ($scheme !== 'https' && !($scheme === 'http' && $isLoopback)) {
            return null;
        }

        $displayHost = str_contains($host, ':') ? '[' . $host . ']' : $host;
        $port = isset($parts['port']) ? (int) $parts['port'] : null;
        $includePort = $port !== null
            && !(($scheme === 'https' && $port === 443) || ($scheme === 'http' && $port === 80));

        return $scheme . '://' . $displayHost . ($includePort ? ':' . $port : '');
    }

    private function decodeBase64UrlField(mixed $data, int $maxBytes): string
    {
        if (!is_string($data) || $data === '' || strlen($data) > (int) ceil($maxBytes * 4 / 3) + 4) {
            throw new \InvalidArgumentException('Invalid base64url value');
        }
        if (!preg_match('/^[A-Za-z0-9_-]+$/', $data)) {
            throw new \InvalidArgumentException('Invalid base64url alphabet');
        }

        $decoded = base64_decode(
            strtr($data, '-_', '+/') . str_repeat('=', (4 - strlen($data) % 4) % 4),
            true
        );
        if (!is_string($decoded) || $decoded === '' || strlen($decoded) > $maxBytes) {
            throw new \InvalidArgumentException('Invalid base64url length');
        }
        if (!hash_equals($data, $this->base64UrlEncode($decoded))) {
            throw new \InvalidArgumentException('Non-canonical base64url value');
        }

        return $decoded;
    }

    private function decodeCredentialId(mixed $value): string
    {
        return $this->decodeBase64UrlField($value, self::MAX_CREDENTIAL_ID_BYTES);
    }

    private function createUserHandle(int $userId, int $tenantId): string
    {
        $secret = (string) config('app.key');
        if ($secret === '') {
            throw new \RuntimeException('APP_KEY is required for passkey user handles');
        }

        return $this->base64UrlEncode(hash_hmac(
            'sha256',
            "nexus-webauthn-user-handle:{$tenantId}:{$userId}",
            $secret,
            true
        ));
    }

    private function base64UrlEncode(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    /**
     * Format allowCredentials array for auth challenge response
     */
    private function formatAllowCredentials(array $credentials): array
    {
        return array_map(function ($row) {
            $cred = [
                'type' => 'public-key',
                'id' => $row['credential_id'],
            ];
            if (!empty($row['transports'])) {
                $decoded = json_decode($row['transports'], true);
                if (is_array($decoded)) {
                    $transports = array_values(array_unique(array_filter(
                        $decoded,
                        static fn (mixed $value): bool => is_string($value)
                            && in_array($value, self::ALLOWED_TRANSPORTS, true)
                    )));
                    if ($transports !== []) {
                        $cred['transports'] = $transports;
                    }
                }
            }
            return $cred;
        }, $credentials);
    }

    /** @return array<string, mixed>|JsonResponse */
    private function pullStoredChallenge(array $input, string $expectedType, ?int $expectedUserId): array|JsonResponse
    {
        $challengeId = $input['challenge_id'] ?? null;
        if (!is_string($challengeId) || !preg_match('/^[a-f0-9]{64}$/', $challengeId)) {
            return $this->noStore($this->respondWithError(
                ApiErrorCodes::AUTH_WEBAUTHN_CHALLENGE_INVALID,
                __('api.webauthn_challenge_expired'),
                null,
                401
            ));
        }

        try {
            $challengeData = $this->webAuthnChallengeStore->pull($challengeId);
        } catch (\Throwable $e) {
            Log::error('[WebAuthn] Challenge retrieval unavailable', [
                'tenant_id' => TenantContext::getId(),
                'ceremony' => $expectedType,
                'error' => $e->getMessage(),
            ]);

            return $this->noStore($this->respondWithError(
                'AUTH_WEBAUTHN_UNAVAILABLE',
                __('api.service_unavailable'),
                null,
                503
            ));
        }

        if (!is_array($challengeData)) {
            return $this->noStore($this->respondWithError(
                ApiErrorCodes::AUTH_WEBAUTHN_CHALLENGE_EXPIRED,
                __('api.webauthn_challenge_expired'),
                null,
                401
            ));
        }
        if (($challengeData['type'] ?? null) !== $expectedType) {
            return $this->noStore($this->respondWithError(
                ApiErrorCodes::AUTH_WEBAUTHN_CHALLENGE_INVALID,
                __('api.webauthn_challenge_invalid_type'),
                null,
                401
            ));
        }
        if (!isset($challengeData['tenant_id']) || (int) $challengeData['tenant_id'] !== TenantContext::getId()) {
            return $this->noStore($this->respondWithError(
                ApiErrorCodes::AUTH_WEBAUTHN_CHALLENGE_INVALID,
                __('api.webauthn_challenge_tenant_mismatch'),
                null,
                401
            ));
        }
        if ($expectedUserId !== null && (int) ($challengeData['user_id'] ?? 0) !== $expectedUserId) {
            return $this->noStore($this->respondWithError(
                ApiErrorCodes::AUTH_WEBAUTHN_CHALLENGE_INVALID,
                __('api.webauthn_challenge_user_mismatch'),
                null,
                401
            ));
        }

        return $challengeData;
    }

    /** @return array{origin: string, rp_id: string}|JsonResponse */
    private function validateChallengeContext(array $challengeData): array|JsonResponse
    {
        $metadata = is_array($challengeData['metadata'] ?? null) ? $challengeData['metadata'] : [];
        $storedOrigin = $metadata['origin'] ?? null;
        $storedRpId = $metadata['rp_id'] ?? null;
        $requestContext = $this->resolveWebAuthnContext();

        if (
            !is_string($storedOrigin)
            || !is_string($storedRpId)
            || $requestContext === null
            || !hash_equals($storedOrigin, $requestContext['origin'])
            || !hash_equals($storedRpId, $requestContext['rp_id'])
        ) {
            return $this->noStore($this->respondWithError(
                'AUTH_WEBAUTHN_ORIGIN_NOT_ALLOWED',
                __('api.webauthn_auth_failed'),
                null,
                401
            ));
        }

        return $requestContext;
    }

    private function clientDataMatches(string $clientDataJson, string $expectedType, string $expectedOrigin): bool
    {
        try {
            $data = json_decode($clientDataJson, true, 16, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return false;
        }
        if (!is_array($data) || ($data['type'] ?? null) !== $expectedType) {
            return false;
        }

        $signedOrigin = isset($data['origin']) && is_string($data['origin'])
            ? $this->normalizeOrigin($data['origin'])
            : null;

        return $signedOrigin !== null
            && hash_equals($expectedOrigin, $signedOrigin)
            && ($data['crossOrigin'] ?? false) === false
            && !array_key_exists('topOrigin', $data);
    }

    private function authVerificationFailed(): JsonResponse
    {
        return $this->noStore($this->respondWithError(
            ApiErrorCodes::AUTH_WEBAUTHN_FAILED,
            __('api.webauthn_auth_failed'),
            null,
            401
        ));
    }

    private function noStore(JsonResponse $response): JsonResponse
    {
        $response->headers->set('Cache-Control', 'no-store, private');
        $response->headers->set('Pragma', 'no-cache');

        return $response;
    }

    private function credentialReference(string $credentialId): string
    {
        $key = (string) config('app.key', 'nexus');

        return substr(hash_hmac('sha256', $credentialId, $key), 0, 16);
    }

    private function passkeyAuthenticationEnabled(): bool
    {
        return (bool) config('webauthn.authentication_enabled', true)
            && TenantContext::hasFeature('biometric_login');
    }

    private function passkeyEnrollmentEnabled(): bool
    {
        return AuthenticationConfigurationService::get(
            AuthenticationConfigurationService::CONFIG_PASSKEYS_ENROLLMENT_ENABLED,
            true,
            TenantContext::getId()
        ) === true;
    }

    private function maxCredentialsPerUser(): int
    {
        $configured = (int) AuthenticationConfigurationService::get(
            AuthenticationConfigurationService::CONFIG_PASSKEYS_MAX_CREDENTIALS,
            10,
            TenantContext::getId()
        );

        return max(1, min(self::MAX_CREDENTIALS_PER_USER, $configured));
    }

    private function requireSecurityConfirmation(int $userId, int $tenantId, array $input): ?JsonResponse
    {
        $token = $input['security_confirmation_token']
            ?? request()->headers->get('X-Security-Confirmation');
        if (!is_string($token) || $token === '') {
            return $this->securityConfirmationFailed();
        }

        return $this->tokenService->validateSecurityConfirmationToken($token, $userId, $tenantId) === null
            ? $this->securityConfirmationFailed()
            : null;
    }

    private function securityConfirmationFailed(): JsonResponse
    {
        return $this->noStore($this->respondWithError(
            'SECURITY_CONFIRMATION_REQUIRED',
            __('api.validation_failed'),
            'security_confirmation',
            403
        ));
    }

    private function revokeSessionsAfterFactorRemoval(int $userId): void
    {
        if ($this->tokenService->revokeAllTokensForUser($userId) < 1) {
            throw new \RuntimeException('Unable to revoke legacy sessions after passkey removal.');
        }
        $user = User::withoutGlobalScopes()
            ->whereKey($userId)
            ->where('tenant_id', TenantContext::getId())
            ->first();
        if ($user === null) {
            throw new \RuntimeException('Unable to resolve user for session revocation.');
        }
        $user->tokens()->delete();

        if (session_status() === PHP_SESSION_ACTIVE && (int) ($_SESSION['user_id'] ?? 0) === $userId) {
            $_SESSION = [];
            session_regenerate_id(true);
        }
        if (request()->hasSession()) {
            request()->session()->invalidate();
            request()->session()->regenerateToken();
        }

        Log::notice('[WebAuthn] Sessions revoked after passkey removal', [
            'user_id' => $userId,
            'tenant_id' => TenantContext::getId(),
        ]);
    }

}
