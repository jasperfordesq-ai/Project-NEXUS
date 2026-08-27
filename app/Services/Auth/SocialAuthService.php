<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\Auth;

use App\Models\User;
use App\Services\Identity\RegistrationOrchestrationService;
use App\Services\Identity\RegistrationPolicyService;
use App\Services\TenantSettingsService;
use App\Services\TokenService;
use App\Services\TotpService;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use App\Support\UserDisplayName;

/**
 * SOC13 — Social login (OAuth).
 *
 * Wraps Laravel Socialite to handle vetted Google / Facebook sign-in.
 * Tenant context is propagated through a state token so the callback
 * can re-establish the tenant after the redirect round-trip.
 *
 * Identity linkage rules:
 *  - (provider, provider_user_id) is globally unique → same Google
 *    account cannot create two NEXUS users across tenants.
 *  - (user_id, provider) is unique → a user has at most one identity
 *    per provider; re-linking refreshes the existing row.
 */
class SocialAuthService
{
    public const SUPPORTED_PROVIDERS = ['google', 'facebook'];

    private const STATE_TTL_SECONDS = 3600;
    private const CALLBACK_CODE_TTL_SECONDS = 300;
    private const CALLBACK_CODE_LOCK_SECONDS = 5;

    public function __construct(
        private readonly TenantSettingsService $tenantSettings,
        private readonly TokenService $tokens,
        private readonly TotpService $totp,
    ) {
    }

    /**
     * Build the redirect URL for the given provider.
     *
     * Returns ['url' => string, 'state' => string]. The state token is a
     * signed payload encoding tenant id + intent (login|register|link)
     * + a random nonce. Verified on callback.
     */
    public function redirectUrl(
        string $provider,
        int $tenantId,
        string $intent = 'login',
        ?int $userId = null,
        ?string $browserChallenge = null
    ): array {
        $this->assertProviderSupported($provider);
        $this->assertProviderEnabledForTenant($provider, $tenantId);

        $browserChallenge = OAuthBrowserBinding::requireChallenge($browserChallenge);
        $state = $this->buildState(
            $tenantId,
            $intent,
            $userId,
            $browserChallenge
        );

        if (! class_exists(\Laravel\Socialite\Facades\Socialite::class)) {
            // Socialite not installed yet — return a synthetic URL so the
            // controller can still report a useful error to the frontend.
            return [
                'url' => '',
                'state' => $state,
                'error' => 'socialite_not_installed',
            ];
        }

        /** @var \Laravel\Socialite\Two\AbstractProvider $driver */
        $driver = \Laravel\Socialite\Facades\Socialite::driver($provider)->stateless();

        if ($provider === 'google') {
            $driver = $driver->scopes(['openid', 'profile', 'email']);
        }

        $url = $driver->with(['state' => $state])->redirect()->getTargetUrl();

        return ['url' => $url, 'state' => $state];
    }

    /**
     * Process an OAuth callback. Returns ['user' => User, 'is_new' => bool, 'tenant_id' => int].
     */
    public function handleCallback(string $provider, string $state): array
    {
        $this->assertProviderSupported($provider);

        $payload = $this->verifyState($state);
        $tenantId = $payload['tenant_id'];
        $intent = $payload['intent'];
        $linkUserId = $payload['user_id'] ?? null;
        $authenticationStartedAt = $payload['authentication_started_at'];

        // A provider or the global OAuth kill switch may be disabled while the
        // user is at the upstream provider. Signed state proves initiation, not
        // that the provider remains authorised at callback time.
        $this->assertProviderEnabledForTenant($provider, $tenantId);

        if (! class_exists(\Laravel\Socialite\Facades\Socialite::class)) {
            throw new \RuntimeException('Laravel Socialite is not installed. Run: composer require laravel/socialite');
        }

        /** @var \Laravel\Socialite\Two\User|\Laravel\Socialite\AbstractUser $providerUser */
        $providerUser = \Laravel\Socialite\Facades\Socialite::driver($provider)->stateless()->user();

        if ($intent === 'link' && $linkUserId) {
            $user = User::query()
                ->whereKey((int) $linkUserId)
                ->where('tenant_id', $tenantId)
                ->first();
            if ($user === null) {
                throw new \RuntimeException('User not found for link intent.');
            }

            $rawPayload = $this->extractRawPayload($providerUser);
            $providerEmail = $providerUser->getEmail();
            $providerEmail = is_string($providerEmail) && trim($providerEmail) !== ''
                ? trim($providerEmail)
                : null;
            $emailOwnershipVerified = $this->providerEmailOwnershipIsVerified(
                $provider,
                $providerEmail,
                $rawPayload
            );
            $trustedProviderEmail = $emailOwnershipVerified
                ? $providerEmail
                : null;

            return [
                'user' => $user,
                'is_new' => false,
                'tenant_id' => (int) $user->tenant_id,
                'identity_link' => $this->callbackIdentityLink(
                    $provider,
                    (string) $providerUser->getId(),
                    $trustedProviderEmail,
                    method_exists($providerUser, 'getAvatar') ? $providerUser->getAvatar() : null,
                    $this->providerPayloadForPersistence($rawPayload, $emailOwnershipVerified),
                    $authenticationStartedAt
                ),
            ];
        }

        $result = $this->findOrCreateFromOauth(
            $provider,
            $providerUser,
            $tenantId,
            $authenticationStartedAt,
            $intent === 'register'
        );
        if ((int) $result['tenant_id'] !== $tenantId) {
            throw new \RuntimeException('OAuth identity belongs to another community.');
        }

        return $result;
    }

    /**
     * Resolve the signed tenant/authentication-start context before the provider
     * callback is processed. The controller uses this to restore tenant context
     * and bind later credential issuance to the start of the OAuth round-trip.
     *
     * @return array{
     *   tenant_id:int,
     *   authentication_started_at:int,
     *   intent:string,
     *   browser_challenge:string
     * }|null
     */
    public function stateContext(string $state): ?array
    {
        try {
            $payload = $this->verifyState($state);

            return [
                'tenant_id' => $payload['tenant_id'],
                'authentication_started_at' => $payload['authentication_started_at'],
                'intent' => $payload['intent'],
                'browser_challenge' => $payload['browser_challenge'],
            ];
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * Find or create a user from a Socialite provider response.
     *
     * Lookup order:
     *  1. Existing oauth_identity by (provider, provider_user_id) → return its user
     *  2. Existing user by verified email match (in tenant) → link new identity
     *  3. Create a brand-new user + identity
     */
    public function findOrCreateFromOauth(
        string $provider,
        $providerUser,
        int $tenantId,
        int $authenticationStartedAt,
        bool $allowProvision = false
    ): array
    {
        $this->assertProviderSupported($provider);
        $providerUserId = (string) $providerUser->getId();
        $providerEmailValue = $providerUser->getEmail();
        $providerEmail = is_string($providerEmailValue) && trim($providerEmailValue) !== ''
            ? trim($providerEmailValue)
            : null;
        $name = method_exists($providerUser, 'getName') ? $providerUser->getName() : null;
        $avatar = method_exists($providerUser, 'getAvatar') ? $providerUser->getAvatar() : null;
        $rawPayload = $this->extractRawPayload($providerUser);
        $emailOwnershipVerified = $this->providerEmailOwnershipIsVerified(
            $provider,
            $providerEmail,
            $rawPayload
        );
        $persistentRawPayload = $this->providerPayloadForPersistence($rawPayload, $emailOwnershipVerified);

        // 1. Existing identity?
        $existing = DB::selectOne(
            'SELECT user_id, tenant_id FROM oauth_identities WHERE provider = ? AND provider_user_id = ? AND tenant_id = ? LIMIT 1',
            [$provider, $providerUserId, $tenantId]
        );
        if ($existing === null) {
            $belongsToAnotherTenant = DB::table('oauth_identities')
                ->where('provider', $provider)
                ->where('provider_user_id', $providerUserId)
                ->where('tenant_id', '<>', $tenantId)
                ->exists();
            if ($belongsToAnotherTenant) {
                throw new \RuntimeException('OAuth identity belongs to another community.');
            }
        }
        if ($existing) {
            if ($emailOwnershipVerified && $providerEmail !== null) {
                DB::update(
                    'UPDATE oauth_identities SET last_used_at = NOW(), provider_email = ?, avatar_url = ?, raw_payload = ?, updated_at = NOW() WHERE provider = ? AND provider_user_id = ? AND tenant_id = ?',
                    [$providerEmail, $avatar, json_encode($persistentRawPayload), $provider, $providerUserId, $tenantId]
                );
            } else {
                DB::update(
                    'UPDATE oauth_identities SET last_used_at = NOW(), avatar_url = ?, raw_payload = ?, updated_at = NOW() WHERE provider = ? AND provider_user_id = ? AND tenant_id = ?',
                    [$avatar, json_encode($persistentRawPayload), $provider, $providerUserId, $tenantId]
                );
            }
            $user = User::query()
                ->whereKey((int) $existing->user_id)
                ->where('tenant_id', $tenantId)
                ->first();
            if ($user === null) {
                throw new \RuntimeException('Linked user not found.');
            }
            return ['user' => $user, 'is_new' => false, 'tenant_id' => (int) $user->tenant_id];
        }

        if ($providerEmail === null) {
            throw new \RuntimeException('OAuth provider did not return an email address. Cannot create account.');
        }
        if (!$emailOwnershipVerified) {
            throw new \RuntimeException(
                'OAuth provider did not prove current ownership of the email address. Cannot link or create account.'
            );
        }

        // 2. Email match within tenant? Email must be verified to auto-link.
        $emailMatch = DB::selectOne(
            'SELECT id, tenant_id, email_verified_at FROM users WHERE tenant_id = ? AND email = ? LIMIT 1',
            [$tenantId, $providerEmail]
        );
        if ($emailMatch && ! empty($emailMatch->email_verified_at)) {
            $user = User::query()
                ->whereKey((int) $emailMatch->id)
                ->where('tenant_id', (int) $emailMatch->tenant_id)
                ->first();
            if ($user === null) {
                throw new \RuntimeException('Linked user not found.');
            }

            return [
                'user' => $user,
                'is_new' => false,
                'tenant_id' => (int) $user->tenant_id,
                'identity_link' => $this->callbackIdentityLink(
                    $provider,
                    $providerUserId,
                    $providerEmail,
                    $avatar,
                    $persistentRawPayload,
                    $authenticationStartedAt,
                    $providerEmail
                ),
            ];
        }

        if (!$allowProvision) {
            throw new \RuntimeException(
                'OAuth login cannot create a new account. Start OAuth registration instead.'
            );
        }

        // 3. Create new user.

        $registrationPolicy = RegistrationPolicyService::getEffectivePolicy($tenantId);
        $registrationMode = (string) ($registrationPolicy['registration_mode'] ?? 'closed');
        if (in_array($registrationMode, ['closed', 'invite_only'], true)) {
            // OAuth supplies no tenant invite proof, so invite-only must be
            // treated exactly like a closed registration path here.
            throw new \RuntimeException('OAuth registration is not permitted by community policy.');
        }
        if (!in_array(
            $registrationMode,
            ['open', 'open_with_approval', 'verified_identity', 'government_id', 'waitlist'],
            true
        )) {
            throw new \RuntimeException('OAuth registration policy is unsupported.');
        }

        $names = $this->splitName($name, $providerEmail);
        return DB::transaction(function () use (
            $tenantId,
            $provider,
            $providerUserId,
            $providerEmail,
            $avatar,
            $persistentRawPayload,
            $names,
            $registrationMode,
            $authenticationStartedAt
        ): array {
            // Re-check the tenant-scoped email inside the creation transaction.
            // This closes the race between the earlier auto-link lookup and a
            // concurrent registration of the same verified address.
            $emailMatch = DB::table('users')
                ->where('tenant_id', $tenantId)
                ->where('email', $providerEmail)
                ->lockForUpdate()
                ->first(['id', 'tenant_id', 'email_verified_at']);
            if ($emailMatch !== null) {
                if (empty($emailMatch->email_verified_at)) {
                    throw new \RuntimeException('Existing account email is not verified.');
                }

                $user = User::query()
                    ->whereKey((int) $emailMatch->id)
                    ->where('tenant_id', (int) $emailMatch->tenant_id)
                    ->first();
                if ($user === null) {
                    throw new \RuntimeException('Linked user not found.');
                }

                return [
                    'user' => $user,
                    'is_new' => false,
                    'tenant_id' => (int) $user->tenant_id,
                    'identity_link' => $this->callbackIdentityLink(
                        $provider,
                        $providerUserId,
                        $providerEmail,
                        $avatar,
                        $persistentRawPayload,
                        $authenticationStartedAt,
                        $providerEmail
                    ),
                ];
            }

            $isOpen = $registrationMode === 'open';
            $userId = DB::table('users')->insertGetId([
                'tenant_id' => $tenantId,
                'first_name' => $names['first'],
                'last_name' => $names['last'],
                // `users.name` is NOT NULL and is the column most display paths
                // read. Social sign-up never set it, so every such account
                // stored an empty string and rendered as a blank name.
                'name' => UserDisplayName::forStorage(null, null, $names['first'], $names['last']),
                'email' => $providerEmail,
                'password' => password_hash(Str::random(48), PASSWORD_BCRYPT),
                'email_verified_at' => now(),
                'avatar_url' => $avatar,
                'preferred_language' => $this->detectLanguage(),
                'status' => $isOpen ? 'active' : 'pending',
                'is_approved' => $isOpen ? 1 : 0,
                'role' => 'member',
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            $this->insertIdentity(
                (int) $userId,
                $tenantId,
                $provider,
                $providerUserId,
                $providerEmail,
                $avatar,
                $persistentRawPayload
            );

            // Keep the user, identity, and policy-driven account state in one
            // SQL unit. A failure in orchestration rolls back the new identity.
            RegistrationOrchestrationService::processRegistration((int) $userId, $tenantId);

            $user = User::query()
                ->whereKey((int) $userId)
                ->where('tenant_id', $tenantId)
                ->first();
            if ($user === null) {
                throw new \RuntimeException('OAuth user creation failed.');
            }

            return ['user' => $user, 'is_new' => true, 'tenant_id' => $tenantId];
        }, 3);
    }

    /**
     * Link a provider to an already-authenticated user.
     */
    public function linkExistingAccount(
        int $userId,
        string $provider,
        string $providerUserId,
        ?string $providerEmail,
        ?string $avatarUrl,
        array $rawPayload
    ): void {
        $this->assertProviderSupported($provider);

        // Reject if this provider identity is already attached to a different user.
        $existing = DB::selectOne(
            'SELECT user_id FROM oauth_identities WHERE provider = ? AND provider_user_id = ? LIMIT 1',
            [$provider, $providerUserId]
        );
        if ($existing && (int) $existing->user_id !== $userId) {
            throw new \RuntimeException('This account is already linked to another NEXUS user.');
        }

        $user = User::find($userId);
        if (! $user) {
            throw new \RuntimeException('User not found.');
        }

        $this->insertIdentity(
            $userId,
            (int) $user->tenant_id,
            $provider,
            $providerUserId,
            $providerEmail,
            $avatarUrl,
            $rawPayload
        );
    }

    /**
     * @return array{
     *   provider:string,
     *   provider_user_id:string,
     *   provider_email:?string,
     *   avatar_url:?string,
     *   raw_payload:array<string,mixed>,
     *   authentication_started_at:int,
     *   expected_verified_email:?string
     * }
     */
    private function callbackIdentityLink(
        string $provider,
        string $providerUserId,
        ?string $providerEmail,
        ?string $avatarUrl,
        array $rawPayload,
        int $authenticationStartedAt,
        ?string $expectedVerifiedEmail = null
    ): array {
        if (
            $provider === ''
            || $providerUserId === ''
            || $authenticationStartedAt < 1
        ) {
            throw new \InvalidArgumentException('OAuth callback identity context is invalid.');
        }

        return [
            'provider' => $provider,
            'provider_user_id' => $providerUserId,
            'provider_email' => $providerEmail,
            'avatar_url' => $avatarUrl,
            'raw_payload' => $rawPayload,
            'authentication_started_at' => $authenticationStartedAt,
            'expected_verified_email' => $expectedVerifiedEmail,
        ];
    }

    /**
     * Unlink a provider from a user. Refuses to remove the user's last
     * remaining authentication method.
     */
    public function unlinkProvider(int $userId, string $provider): void
    {
        $this->assertProviderSupported($provider);

        $user = User::find($userId);
        if (! $user) {
            throw new \RuntimeException('User not found.');
        }

        $tenantId = (int) $user->tenant_id;
        DB::transaction(function () use ($provider, $tenantId, $userId): void {
            if (!AuthenticationMethodGuard::hasAlternativeToOauthProvider(
                $userId,
                $tenantId,
                $provider,
                true
            )) {
                throw new \RuntimeException(__('api.cannot_remove_last_sign_in_method'));
            }

            $deleted = DB::table('oauth_identities')
                ->where('user_id', $userId)
                ->where('tenant_id', $tenantId)
                ->where('provider', $provider)
                ->delete();
            if ($deleted !== 1) {
                throw new \RuntimeException('OAuth identity was not found for this community.');
            }

            // Removing an identity changes the account's authentication
            // surface. Revoke every extant session while the shared user-row
            // lock is still held; TokenService returns zero when persistence
            // fails, which must roll back the unlink as well.
            if ($this->tokens->revokeAllTokensForUser($userId, 'oauth_identity_unlinked') < 1) {
                throw new \RuntimeException('Unable to revoke sessions after unlinking OAuth identity.');
            }
        });
    }

    /**
     * List all linked identities for the given user.
     */
    public function listIdentities(int $userId): array
    {
        $rows = DB::table('oauth_identities')
            ->where('user_id', $userId)
            ->orderBy('linked_at', 'desc')
            ->get(['provider', 'provider_email', 'avatar_url', 'linked_at', 'last_used_at']);

        return $rows->map(static fn ($r) => [
            'provider' => $r->provider,
            'provider_email' => $r->provider_email,
            'avatar_url' => $r->avatar_url,
            'linked_at' => $r->linked_at,
            'last_used_at' => $r->last_used_at,
        ])->all();
    }

    /**
     * Re-read the resolved account under the shared users-row issuance lock,
     * enforce current login policy, and mint the credential pair while the lock
     * is held. The one-time callback code is published only after SQL commit.
     * Logout-all and password changes use this same lock.
     *
     * @param array<string,mixed>|null $identityLink
     * @return array{status:string,callback_code?:string,gate?:array<string,mixed>}
     */
    public function issueLoginCallbackCode(
        int $userId,
        int $tenantId,
        string $provider,
        bool $isNew,
        int $authenticationStartedAt,
        string $browserChallenge,
        ?array $identityLink = null,
        bool $upstreamMfaVerified = false
    ): array {
        if ($userId < 1 || $tenantId < 1 || $authenticationStartedAt < 1) {
            throw new \InvalidArgumentException('OAuth login issuance context is invalid.');
        }
        $browserChallenge = OAuthBrowserBinding::requireChallenge($browserChallenge);

        if ($identityLink !== null) {
            return $this->issuePendingIdentityCallbackCode(
                $userId,
                $tenantId,
                $provider,
                $isNew,
                $authenticationStartedAt,
                $browserChallenge,
                $identityLink,
                $upstreamMfaVerified
            );
        }

        $issuance = $this->issueLoginCredentials(
            $userId,
            $tenantId,
            $authenticationStartedAt,
            null,
            $upstreamMfaVerified
        );

        if (($issuance['status'] ?? null) !== 'credentials_issued') {
            return $issuance;
        }

        // Cache is externally durable and is not rolled back with SQL. Publish
        // the exchangeable one-time code only after the credential transaction
        // has committed, so a later rollback can never leak a usable access JWT.
        $callbackCode = $this->issueCallbackCode(
            (string) $issuance['access_token'],
            $provider,
            $isNew,
            $tenantId,
            $browserChallenge,
            (string) $issuance['refresh_token'],
            $this->tokens->getAccessTokenExpiry(false),
            $this->tokens->getRefreshTokenExpiry(false)
        );

        return ['status' => 'issued', 'callback_code' => $callbackCode];
    }

    /**
     * Publish a browser-bound link callback without changing durable identity
     * state or minting credentials. The final exchange consumes this context
     * only after the initiating tab proves possession of the verifier.
     *
     * @param array<string,mixed> $identityLink
     * @return array{status:string,callback_code:string}
     */
    public function issuePendingLinkCallbackCode(
        int $userId,
        int $tenantId,
        string $provider,
        int $authenticationStartedAt,
        string $browserChallenge,
        array $identityLink
    ): array {
        $this->assertProviderSupported($provider);
        return $this->issuePendingIdentityCallbackCode(
            $userId,
            $tenantId,
            $provider,
            false,
            $authenticationStartedAt,
            $browserChallenge,
            $identityLink
        );
    }

    /**
     * @param array<string,mixed> $identityLink
     * @return array{status:string,callback_code:string}
     */
    private function issuePendingIdentityCallbackCode(
        int $userId,
        int $tenantId,
        string $provider,
        bool $isNew,
        int $authenticationStartedAt,
        string $browserChallenge,
        array $identityLink,
        bool $upstreamMfaVerified = false
    ): array {
        $identityProvider = (string) ($identityLink['provider'] ?? '');
        $expectedIdentityProvider = str_starts_with($provider, 'sso:')
            ? 'sso:' . $tenantId . ':' . substr($provider, 4)
            : $provider;
        if (
            $userId < 1
            || $tenantId < 1
            || $authenticationStartedAt < 1
            || $provider === ''
            || $identityProvider !== $expectedIdentityProvider
            || (int) ($identityLink['authentication_started_at'] ?? 0) !== $authenticationStartedAt
            || empty($identityLink['provider_user_id'])
            || !is_array($identityLink['raw_payload'] ?? null)
        ) {
            throw new \InvalidArgumentException('OAuth identity issuance context is invalid.');
        }

        $browserChallenge = OAuthBrowserBinding::requireChallenge($browserChallenge);
        $callbackCode = $this->cacheCallbackCode([
            'kind' => 'pending_identity',
            'provider' => $provider,
            'is_new' => $isNew,
            'tenant_id' => $tenantId,
            'browser_challenge' => $browserChallenge,
            'pending_issuance' => [
                'user_id' => $userId,
                'authentication_started_at' => $authenticationStartedAt,
                'identity_link' => $identityLink,
                'upstream_mfa_verified' => $upstreamMfaVerified,
            ],
        ]);

        return ['status' => 'issued', 'callback_code' => $callbackCode];
    }

    /**
     * Re-check current account policy and mint a credential generation while
     * holding the same tenant-scoped users-row lock used by revocation flows.
     *
     * @param array<string,mixed>|null $identityLink
     * @return array{status:string,access_token?:string,refresh_token?:string,gate?:array<string,mixed>}
     */
    private function issueLoginCredentials(
        int $userId,
        int $tenantId,
        int $authenticationStartedAt,
        ?array $identityLink,
        bool $upstreamMfaVerified = false
    ): array {
        return DB::transaction(function () use (
            $userId,
            $tenantId,
            $authenticationStartedAt,
            $identityLink,
            $upstreamMfaVerified
        ): array {
            $lockedRow = DB::table('users')
                ->where('id', $userId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();
            if ($lockedRow === null) {
                return ['status' => 'user_not_found'];
            }

            if (!$this->tokens->isAuthenticationStartValid($userId, $authenticationStartedAt)) {
                return ['status' => 'authentication_invalidated'];
            }

            $user = (array) $lockedRow;
            $gateBlock = $this->tenantSettings->checkLoginGatesForUser($user);
            if ($gateBlock !== null) {
                return ['status' => 'gate_blocked', 'gate' => $gateBlock];
            }

            // The OAuth callback page cannot complete the established local
            // TOTP challenge contract, so enabled untrusted TOTP fails closed.
            if (
                $this->totp->isEnabled($userId, $tenantId)
                && !$this->totp->isTrustedDevice($userId, null, $tenantId)
                && !$upstreamMfaVerified
            ) {
                return ['status' => 'two_factor_required'];
            }

            $isAdmin = in_array((string) ($user['role'] ?? ''), ['admin', 'tenant_admin', 'org_admin', 'super_admin'], true)
                || !empty($user['is_super_admin'])
                || !empty($user['is_tenant_super_admin']);
            if (
                (bool) config('auth.force_admin_2fa', false)
                && $isAdmin
                && !$this->totp->isEnabled($userId, $tenantId)
                && !$upstreamMfaVerified
            ) {
                return ['status' => 'two_factor_setup_required'];
            }

            if ($identityLink !== null) {
                $this->applyCallbackIdentityLink(
                    $user,
                    $identityLink,
                    $authenticationStartedAt
                );
            }

            $accessToken = $this->tokens->generateToken(
                $userId,
                $tenantId,
                [
                    'role' => $user['role'],
                    'email' => $user['email'],
                    'is_super_admin' => !empty($user['is_super_admin']),
                    'is_tenant_super_admin' => !empty($user['is_tenant_super_admin']),
                    'is_god' => !empty($user['is_god']),
                ],
                false
            );
            $refreshToken = $this->tokens->generateRefreshToken($userId, $tenantId, false);

            return [
                'status' => 'credentials_issued',
                'access_token' => $accessToken,
                'refresh_token' => $refreshToken,
            ];
        }, 3);
    }

    /**
     * Apply a pending identity while the caller holds this user's row lock.
     *
     * @param array<string,mixed> $currentUser
     * @param array<string,mixed> $identityLink
     */
    private function applyCallbackIdentityLink(
        array $currentUser,
        array $identityLink,
        int $authenticationStartedAt
    ): void {
        $userId = (int) ($currentUser['id'] ?? 0);
        $tenantId = (int) ($currentUser['tenant_id'] ?? 0);
        $provider = (string) ($identityLink['provider'] ?? '');
        $providerUserId = (string) ($identityLink['provider_user_id'] ?? '');
        $linkStartedAt = (int) ($identityLink['authentication_started_at'] ?? 0);
        $rawPayload = $identityLink['raw_payload'] ?? null;
        if (
            $userId < 1
            || $tenantId < 1
            || $provider === ''
            || $providerUserId === ''
            || $linkStartedAt !== $authenticationStartedAt
            || !is_array($rawPayload)
        ) {
            throw new \RuntimeException('OAuth callback identity context is invalid.');
        }

        $providerEmail = isset($identityLink['provider_email'])
            && is_string($identityLink['provider_email'])
                ? $identityLink['provider_email']
                : null;
        $avatarUrl = isset($identityLink['avatar_url'])
            && is_string($identityLink['avatar_url'])
                ? $identityLink['avatar_url']
                : null;
        $expectedVerifiedEmail = isset($identityLink['expected_verified_email'])
            && is_string($identityLink['expected_verified_email'])
                ? $identityLink['expected_verified_email']
                : null;

        if (
            $expectedVerifiedEmail !== null
            && (
                empty($currentUser['email_verified_at'])
                || strcasecmp(
                    trim((string) ($currentUser['email'] ?? '')),
                    trim($expectedVerifiedEmail)
                ) !== 0
            )
        ) {
            throw new \RuntimeException('Existing account email is not verified for identity linking.');
        }

        $existingOwner = DB::table('oauth_identities')
            ->where('provider', $provider)
            ->where('provider_user_id', $providerUserId)
            ->lockForUpdate()
            ->first(['user_id', 'tenant_id']);
        if (
            $existingOwner !== null
            && (
                (int) $existingOwner->user_id !== $userId
                || (int) $existingOwner->tenant_id !== $tenantId
            )
        ) {
            throw new \RuntimeException('This account is already linked to another NEXUS user.');
        }

        /** @var array<string,mixed> $rawPayload */
        $this->insertIdentity(
            $userId,
            $tenantId,
            $provider,
            $providerUserId,
            $providerEmail,
            $avatarUrl,
            $rawPayload
        );
    }

    public function issueCallbackCode(
        string $token,
        string $provider,
        bool $isNew,
        int $tenantId,
        string $browserChallenge,
        ?string $refreshToken = null,
        ?int $expiresIn = null,
        ?int $refreshExpiresIn = null
    ): string
    {
        $browserChallenge = OAuthBrowserBinding::requireChallenge($browserChallenge);

        return $this->cacheCallbackCode([
            'kind' => 'credentials',
            'token' => $token,
            'refresh_token' => $refreshToken,
            'expires_in' => $expiresIn,
            'refresh_expires_in' => $refreshExpiresIn,
            'provider' => $provider,
            'is_new' => $isNew,
            'tenant_id' => $tenantId,
            'browser_challenge' => $browserChallenge,
        ]);
    }

    /** @param array<string,mixed> $payload */
    private function cacheCallbackCode(array $payload): string
    {
        $code = Str::random(64);
        Cache::put(
            $this->callbackCodeCacheKey($code),
            $payload,
            self::CALLBACK_CODE_TTL_SECONDS
        );

        return $code;
    }

    /**
     * @return array{token:string,refresh_token:?string,expires_in:?int,refresh_expires_in:?int,provider:string,is_new:bool,tenant_id:int}
     */
    public function consumeCallbackCode(string $code, ?string $browserVerifier = null): array
    {
        if (!preg_match('/^[A-Za-z0-9]{40,128}$/', $code)) {
            throw new \RuntimeException('OAuth callback code is invalid or expired.');
        }

        $cacheKey = $this->callbackCodeCacheKey($code);
        $lock = Cache::lock(
            $this->callbackCodeLockKey($code),
            self::CALLBACK_CODE_LOCK_SECONDS
        );

        try {
            $acquired = $lock->get();
        } catch (\Throwable $e) {
            throw new \RuntimeException('OAuth callback code is invalid or expired.', 0, $e);
        }
        if (!$acquired) {
            // Never wait behind another consumer. Contention means this
            // exchange cannot prove it is the one authorised consumption.
            throw new \RuntimeException('OAuth callback code is invalid or expired.');
        }

        /** @var array<string,mixed>|null $result */
        $result = null;
        try {
            $payload = Cache::get($cacheKey);
            if (!is_array($payload) || empty($payload['provider'])) {
                Cache::forget($cacheKey);
                throw new \RuntimeException('OAuth callback code is invalid or expired.');
            }

            $browserChallenge = $payload['browser_challenge'] ?? null;
            if (!is_string($browserChallenge)) {
                Cache::forget($cacheKey);
                throw new \RuntimeException('OAuth callback code is invalid or expired.');
            }
            if (!OAuthBrowserBinding::verifierMatches($browserChallenge, $browserVerifier)) {
                // A verifier mismatch is not consumption. The initiating tab
                // can still complete the one-time exchange after a transferred
                // callback URL is rejected in another browser.
                throw new \RuntimeException('OAuth callback code is invalid or expired.');
            }

            $kind = (string) ($payload['kind'] ?? 'credentials');
            $pending = $payload['pending_issuance'] ?? null;
            if ($kind === 'credentials') {
                if (empty($payload['token'])) {
                    Cache::forget($cacheKey);
                    throw new \RuntimeException('OAuth callback code is invalid or expired.');
                }
            } elseif (
                $kind !== 'pending_identity'
                || !is_array($pending)
                || (int) ($pending['user_id'] ?? 0) < 1
                || (int) ($pending['authentication_started_at'] ?? 0) < 1
                || !is_array($pending['identity_link'] ?? null)
                || (int) ($payload['tenant_id'] ?? 0) < 1
            ) {
                Cache::forget($cacheKey);
                throw new \RuntimeException('OAuth callback code is invalid or expired.');
            }

            // Consume the proof-bearing code before any pending identity mutation.
            // A later SQL failure is safely retryable only by restarting the
            // provider flow; no replayable code survives a durable mutation.
            if (!Cache::forget($cacheKey)) {
                throw new \RuntimeException('OAuth callback code is invalid or expired.');
            }

            if ($kind === 'pending_identity') {
                /** @var array<string,mixed> $pending */
                /** @var array<string,mixed> $identityLink */
                $identityLink = $pending['identity_link'];
                $issuance = $this->issueLoginCredentials(
                    (int) $pending['user_id'],
                    (int) $payload['tenant_id'],
                    (int) $pending['authentication_started_at'],
                    $identityLink,
                    (bool) ($pending['upstream_mfa_verified'] ?? false)
                );
                if (($issuance['status'] ?? null) !== 'credentials_issued') {
                    throw new \RuntimeException('OAuth callback code is invalid or expired.');
                }

                $result = [
                    'token' => (string) $issuance['access_token'],
                    'refresh_token' => (string) $issuance['refresh_token'],
                    'expires_in' => $this->tokens->getAccessTokenExpiry(false),
                    'refresh_expires_in' => $this->tokens->getRefreshTokenExpiry(false),
                    'provider' => (string) $payload['provider'],
                    'is_new' => (bool) ($payload['is_new'] ?? false),
                    'tenant_id' => (int) $payload['tenant_id'],
                ];
            } else {
                $result = [
                    'token' => (string) $payload['token'],
                    'refresh_token' => isset($payload['refresh_token']) && is_string($payload['refresh_token'])
                        ? $payload['refresh_token']
                        : null,
                    'expires_in' => isset($payload['expires_in']) ? (int) $payload['expires_in'] : null,
                    'refresh_expires_in' => isset($payload['refresh_expires_in'])
                        ? (int) $payload['refresh_expires_in']
                        : null,
                    'provider' => (string) $payload['provider'],
                    'is_new' => (bool) ($payload['is_new'] ?? false),
                    'tenant_id' => (int) ($payload['tenant_id'] ?? 0),
                ];
            }
        } finally {
            $lock->release();
        }

        if ($result === null) {
            throw new \RuntimeException('OAuth callback code is invalid or expired.');
        }

        return $result;
    }

    /**
     * Get the list of OAuth providers enabled for a tenant.
     *
     * 🔴 GLOBAL KILL SWITCH: when env OAUTH_ENABLED=false (default), no providers
     * are returned regardless of tenant setting. Set OAUTH_ENABLED=true in .env
     * once real Google/Facebook OAuth credentials are configured.
     *
     * Otherwise, the tenant must explicitly opt in through
     * `auth.oauth.enabled_providers`. Missing, empty, or malformed settings
     * fail closed; the environment flag is a global ceiling, not tenant consent.
     */
    public function enabledProviders(int $tenantId): array
    {
        // Global kill switch — ON only when explicitly enabled in env
        if (! filter_var(env('OAUTH_ENABLED', false), FILTER_VALIDATE_BOOLEAN)) {
            return [];
        }
        $raw = $this->tenantSettings->get($tenantId, 'auth.oauth.enabled_providers');
        if ($raw === null || (is_string($raw) && trim($raw) === '')) {
            return [];
        }
        $decoded = is_array($raw) ? $raw : json_decode((string) $raw, true);
        if (!is_array($decoded) || !array_is_list($decoded)) {
            return [];
        }
        foreach ($decoded as $provider) {
            if (!is_string($provider)) {
                return [];
            }
        }

        return array_values(array_unique(array_intersect($decoded, self::SUPPORTED_PROVIDERS)));
    }

    // ---------------------------------------------------------------- helpers

    private function assertProviderSupported(string $provider): void
    {
        if ($provider === 'apple') {
            throw new \InvalidArgumentException(
                'Apple OAuth is unavailable because no vetted Socialite driver is installed.'
            );
        }
        if (! in_array($provider, self::SUPPORTED_PROVIDERS, true)) {
            throw new \InvalidArgumentException("Unsupported OAuth provider: {$provider}");
        }
    }

    private function assertProviderEnabledForTenant(string $provider, int $tenantId): void
    {
        $enabled = $this->enabledProviders($tenantId);
        if (! in_array($provider, $enabled, true)) {
            throw new \RuntimeException("OAuth provider '{$provider}' is disabled for this community.");
        }
    }

    private function buildState(
        int $tenantId,
        string $intent,
        ?int $userId,
        string $browserChallenge
    ): string {
        $payload = [
            't' => $tenantId,
            'i' => $intent,
            'u' => $userId,
            'n' => Str::random(16),
            'x' => now()->timestamp,
            'b' => OAuthBrowserBinding::requireChallenge($browserChallenge),
        ];

        if ($intent === 'link') {
            if (!$userId) {
                throw new \RuntimeException('OAuth link intent requires a user.');
            }
        }

        $body = base64_encode(json_encode($payload));
        $sig = hash_hmac('sha256', $body, (string) config('app.key'));
        return $body . '.' . $sig;
    }

    /**
     * @return array{
     *   tenant_id:int,
     *   intent:string,
     *   user_id:?int,
     *   state_nonce:string,
     *   authentication_started_at:int,
     *   browser_challenge:string
     * }
     */
    private function verifyState(string $state): array
    {
        if (! str_contains($state, '.')) {
            throw new \RuntimeException('Invalid OAuth state token.');
        }
        [$body, $sig] = explode('.', $state, 2);
        $expected = hash_hmac('sha256', $body, (string) config('app.key'));
        if (! hash_equals($expected, $sig)) {
            throw new \RuntimeException('OAuth state signature mismatch.');
        }
        $decoded = json_decode((string) base64_decode($body, true), true);
        if (! is_array($decoded) || empty($decoded['t']) || empty($decoded['i'])) {
            throw new \RuntimeException('Malformed OAuth state token.');
        }
        $intent = (string) $decoded['i'];
        if (!in_array($intent, ['login', 'register', 'link'], true)) {
            throw new \RuntimeException('Malformed OAuth state token.');
        }
        $browserChallenge = OAuthBrowserBinding::requireChallenge(
            isset($decoded['b']) && is_string($decoded['b']) ? $decoded['b'] : null
        );
        $now = now()->timestamp;
        $authenticationStartedAt = (int) ($decoded['x'] ?? 0);
        if (
            $authenticationStartedAt < 1
            || $authenticationStartedAt > $now
            || ($now - $authenticationStartedAt) > self::STATE_TTL_SECONDS
        ) {
            throw new \RuntimeException('OAuth state token has expired.');
        }
        return [
            'tenant_id' => (int) $decoded['t'],
            'intent' => $intent,
            'user_id' => isset($decoded['u']) ? (int) $decoded['u'] : null,
            'state_nonce' => (string) ($decoded['n'] ?? ''),
            'authentication_started_at' => $authenticationStartedAt,
            'browser_challenge' => $browserChallenge,
        ];
    }

    private function callbackCodeCacheKey(string $code): string
    {
        return 'oauth:callback-code:' . hash('sha256', $code);
    }

    private function callbackCodeLockKey(string $code): string
    {
        return 'oauth:callback-code-lock:' . hash('sha256', $code);
    }

    private function insertIdentity(
        int $userId,
        int $tenantId,
        string $provider,
        string $providerUserId,
        ?string $providerEmail,
        ?string $avatarUrl,
        array $rawPayload
    ): void {
        DB::statement(
            'INSERT INTO oauth_identities
                (user_id, tenant_id, provider, provider_user_id, provider_email, avatar_url, raw_payload, linked_at, last_used_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW(), NOW())
             ON DUPLICATE KEY UPDATE
                provider_email = VALUES(provider_email),
                avatar_url = VALUES(avatar_url),
                raw_payload = VALUES(raw_payload),
                last_used_at = NOW(),
                updated_at = NOW()',
            [
                $userId,
                $tenantId,
                $provider,
                $providerUserId,
                $providerEmail,
                $avatarUrl,
                json_encode($rawPayload),
            ]
        );

        $owner = DB::selectOne(
            'SELECT user_id, tenant_id FROM oauth_identities WHERE provider = ? AND provider_user_id = ? LIMIT 1',
            [$provider, $providerUserId]
        );
        if (
            $owner === null
            || (int) $owner->user_id !== $userId
            || (int) $owner->tenant_id !== $tenantId
        ) {
            throw new \RuntimeException('This account is already linked to another NEXUS user.');
        }
    }

    /**
     * Pull the raw provider payload, redacting any access/refresh tokens.
     */
    private function extractRawPayload($providerUser): array
    {
        $raw = method_exists($providerUser, 'getRaw') ? $providerUser->getRaw() : [];
        if (! is_array($raw)) {
            $raw = [];
        }
        unset(
            $raw['access_token'],
            $raw['refresh_token'],
            $raw['id_token'],
            $raw['token'],
            $raw['client_secret']
        );
        return $raw;
    }

    /**
     * Decide whether a provider has proved current ownership of the returned
     * address strongly enough for automatic email linking or provisioning.
     *
     * Google's `email_verified` claim alone is not current-ownership evidence
     * for an external mailbox. A canonical Gmail address is Google-owned, while
     * a non-empty hosted-domain (`hd`) claim identifies a managed Workspace
     * account. The installed Facebook Graph driver only exposes the generic
     * account-level `verified` field, so Facebook email ownership fails closed.
     *
     * @param array<string,mixed> $rawPayload
     */
    private function providerEmailOwnershipIsVerified(
        string $provider,
        ?string $providerEmail,
        array $rawPayload
    ): bool
    {
        if (
            $provider !== 'google'
            || $providerEmail === null
            || ($rawPayload['email_verified'] ?? null) !== true
        ) {
            return false;
        }

        $normalisedEmail = strtolower(trim($providerEmail));
        if (str_ends_with($normalisedEmail, '@gmail.com')) {
            return true;
        }

        $hostedDomain = $rawPayload['hd'] ?? null;
        return is_string($hostedDomain) && trim($hostedDomain) !== '';
    }

    /**
     * Do not refresh stored identity email metadata from an unverified claim.
     * The verification flag itself is retained for audit/debugging.
     *
     * @param array<string,mixed> $rawPayload
     * @return array<string,mixed>
     */
    private function providerPayloadForPersistence(array $rawPayload, bool $emailOwnershipVerified): array
    {
        if (!$emailOwnershipVerified) {
            unset(
                $rawPayload['email'],
                $rawPayload['emails'],
                $rawPayload['email_address'],
                $rawPayload['mail'],
                $rawPayload['upn'],
                $rawPayload['preferred_username']
            );
        }

        return $rawPayload;
    }

    private function splitName(?string $name, string $email): array
    {
        $first = $last = '';
        if ($name) {
            $parts = preg_split('/\s+/', trim($name), 2);
            $first = $parts[0] ?? '';
            $last = $parts[1] ?? '';
        }
        if ($first === '') {
            $local = strstr($email, '@', true) ?: $email;
            $first = ucfirst($local);
        }
        return ['first' => $first, 'last' => $last];
    }

    private function detectLanguage(): string
    {
        $supported = ['en', 'ga', 'de', 'fr', 'it', 'pt', 'es', 'nl', 'pl', 'ja', 'ar'];
        $header = request()->header('Accept-Language', '');
        if ($header) {
            foreach (explode(',', (string) $header) as $part) {
                $code = strtolower(substr(trim($part), 0, 2));
                if (in_array($code, $supported, true)) {
                    return $code;
                }
            }
        }
        return 'en';
    }
}
