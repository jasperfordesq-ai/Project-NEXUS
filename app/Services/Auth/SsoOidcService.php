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
use App\Support\OutboundUrlGuard;
use Firebase\JWT\JWK;
use Firebase\JWT\JWT;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use App\Support\UserDisplayName;

/**
 * SSO engine (IT-Sec-05) — generic OpenID Connect relying party.
 *
 * Lets a tenant accept logins from any spec-compliant OIDC identity
 * provider (Microsoft Entra ID, Google Workspace, Hivebrite, Keycloak,
 * …) configured as a row in tenant_sso_providers. Endpoints are
 * discovered from the issuer's /.well-known/openid-configuration, so
 * adding a provider is configuration, not code.
 *
 * Flow security:
 *  - Authorization Code + PKCE (S256); the code verifier and the OIDC
 *    nonce live server-side in cache, keyed by the state nonce.
 *  - State is an HMAC-signed payload binding tenant + provider key,
 *    same scheme as SocialAuthService.
 *  - The ID token signature is verified against the issuer's JWKS
 *    (cached 1h, refreshed once on unknown kid), then iss/aud/nonce
 *    are checked explicitly.
 *
 * Identity linkage reuses oauth_identities with provider strings of
 * the form "sso:{tenant_id}:{provider_key}" — tenant-qualified so the
 * same upstream account can exist independently per tenant, unlike
 * the global google/apple/facebook identities.
 *
 * Provisioning guard: when allowed_email_domains is set, every login
 * through the provider requires a matching email domain; new-account
 * creation additionally requires auto_provision to be on.
 */
class SsoOidcService
{
    public const PRESETS = ['generic', 'entra', 'hivebrite'];

    private const STATE_TTL_SECONDS = 900;
    /** State intents. Link states use a value the social OAuth state parser rejects. */
    private const INTENT_LOGIN = 'login';
    private const INTENT_LINK = 'sso_link';
    private const DISCOVERY_CACHE_SECONDS = 3600;
    private const JWKS_CACHE_SECONDS = 3600;
    private const HTTP_TIMEOUT_SECONDS = 10;
    /**
     * F-268: key inside oauth_identities.raw_payload under which NEXUS records
     * the provider configuration (issuer URL, client id) and token issuer an
     * SSO identity was bound under. Written only by this service, never taken
     * from an ID token (safeClaims() strips a claim of the same name).
     */
    private const IDENTITY_BINDING_KEY = 'nexus_sso_binding';

    /**
     * Public metadata for the tenant's enabled providers (login buttons).
     *
     * @return array<int, array{key:string, display_name:string, preset:string}>
     */
    public function enabledProviders(int $tenantId): array
    {
        if (! \Schema::hasTable('tenant_sso_providers')) {
            return [];
        }
        return DB::table('tenant_sso_providers')
            ->where('tenant_id', $tenantId)
            ->where('is_enabled', 1)
            ->orderBy('display_name')
            ->get(['provider_key', 'display_name', 'preset'])
            ->map(static fn ($r) => [
                'key' => $r->provider_key,
                'display_name' => $r->display_name,
                'preset' => $r->preset,
            ])->all();
    }

    /**
     * Build the upstream authorization URL for a provider.
     *
     * @return array{url:string, state:string}
     */
    public function redirectUrl(
        int $tenantId,
        string $providerKey,
        ?string $browserChallenge = null
    ): array
    {
        return $this->buildAuthorizationRedirect($tenantId, $providerKey, $browserChallenge, null);
    }

    /**
     * Build the upstream authorization URL for a signed-in member linking
     * this provider to their own account. The signed state carries a LINK
     * intent bound to the member and tenant; the callback then binds the
     * verified subject to that member and never signs anyone in by email.
     *
     * @return array{url:string, state:string}
     */
    public function linkRedirectUrl(
        int $tenantId,
        string $providerKey,
        int $userId,
        ?string $browserChallenge = null
    ): array {
        if ($userId < 1) {
            throw new \InvalidArgumentException('SSO link intent requires a user.');
        }
        $this->requireActiveTenantUser($tenantId, $userId);

        return $this->buildAuthorizationRedirect($tenantId, $providerKey, $browserChallenge, $userId);
    }

    /**
     * @return array{url:string, state:string}
     */
    private function buildAuthorizationRedirect(
        int $tenantId,
        string $providerKey,
        ?string $browserChallenge,
        ?int $linkUserId
    ): array {
        $browserChallenge = OAuthBrowserBinding::requireChallenge($browserChallenge);
        $provider = $this->getEnabledProvider($tenantId, $providerKey);
        $discovery = $this->discover($provider->issuer_url);
        // Discovery is cached; revalidate the browser destination immediately
        // before returning it so a later DNS/config change fails closed.
        $this->assertPublicHttpsUrl($discovery['authorization_endpoint']);

        $stateNonce = Str::random(32);
        $oidcNonce = Str::random(32);
        $codeVerifier = Str::random(96);

        $flow = [
            'code_verifier' => $codeVerifier,
            'oidc_nonce' => $oidcNonce,
            'browser_challenge' => $browserChallenge,
            'intent' => $linkUserId === null ? self::INTENT_LOGIN : self::INTENT_LINK,
        ];
        if ($linkUserId !== null) {
            // Pin the exact provider configuration the member agreed to link.
            // An admin edit while the member is at the IdP must not let a
            // different issuer or client bind an identity to their account.
            $flow['link_user_id'] = $linkUserId;
            $flow['issuer_url'] = (string) $provider->issuer_url;
            $flow['client_id'] = (string) $provider->client_id;
        }
        Cache::put($this->flowCacheKey($stateNonce), $flow, self::STATE_TTL_SECONDS);

        $state = $this->buildState(
            $tenantId,
            $providerKey,
            $stateNonce,
            $browserChallenge,
            $linkUserId
        );

        $params = http_build_query([
            'response_type' => 'code',
            'client_id' => $provider->client_id,
            'redirect_uri' => $this->redirectUri(),
            'scope' => $provider->scopes ?: 'openid profile email',
            'state' => $state,
            'nonce' => $oidcNonce,
            'code_challenge' => $this->pkceChallenge($codeVerifier),
            'code_challenge_method' => 'S256',
        ]);

        return [
            'url' => $discovery['authorization_endpoint'] . '?' . $params,
            'state' => $state,
        ];
    }

    /**
     * Handle the OIDC callback: exchange the code, validate the ID
     * token, and resolve a NEXUS user.
     *
     * @return array{
     *   user:User,
     *   is_new:bool,
     *   tenant_id:int,
     *   provider_key:string,
     *   upstream_mfa_verified:bool,
     *   authentication_started_at:int,
     *   browser_challenge:string
     * }
     */
    /**
     * Resolve the tenant id from a signed state token without running the
     * full callback — lets the controller target the correct tenant
     * frontend for the post-login redirect (incl. the error path), since
     * the OIDC round-trip lands on the tenant-less api host. Returns null
     * if the state is missing or its signature does not verify.
     */
    public function tenantIdFromState(string $state): ?int
    {
        try {
            return $this->verifyState($state)['tenant_id'];
        } catch (\Throwable $e) {
            return null;
        }
    }

    /**
     * True when the signed state carries a LINK intent. Signature and expiry
     * are verified; an invalid state is reported as not-a-link (the callback
     * then fails on the sign-in path, which re-verifies it).
     */
    public function isLinkState(string $state): bool
    {
        try {
            return $this->verifyState($state)['intent'] === self::INTENT_LINK;
        } catch (\Throwable $e) {
            return false;
        }
    }

    public function handleCallback(string $state, string $code): array
    {
        $payload = $this->verifyState($state);
        $tenantId = $payload['tenant_id'];
        $providerKey = $payload['provider_key'];
        // A link state must never complete a sign-in. Checked before the flow
        // is consumed so a misrouted state cannot burn the member's link.
        if ($payload['intent'] !== self::INTENT_LOGIN) {
            throw new \RuntimeException('SSO state is not a sign-in state.');
        }

        $flow = Cache::pull($this->flowCacheKey($payload['state_nonce']));
        if (! is_array($flow) || empty($flow['code_verifier']) || empty($flow['oidc_nonce'])) {
            throw new \RuntimeException('SSO flow state expired or already used.');
        }
        if (($flow['intent'] ?? self::INTENT_LOGIN) !== self::INTENT_LOGIN) {
            throw new \RuntimeException('SSO flow is not a sign-in flow.');
        }
        $flowBrowserChallenge = $flow['browser_challenge'] ?? null;
        if (
            !is_string($flowBrowserChallenge)
            || !hash_equals($payload['browser_challenge'], $flowBrowserChallenge)
        ) {
            throw new \RuntimeException('SSO browser challenge mismatch.');
        }

        $provider = $this->getEnabledProvider($tenantId, $providerKey);
        $discovery = $this->discover($provider->issuer_url);

        $claims = $this->exchangeAndValidate($provider, $discovery, $code, $flow);

        $email = $this->extractEmail($claims);
        $emailVerified = $this->emailIsVerified($claims);
        $this->assertDomainAllowed($provider, $email, $emailVerified);

        $result = $this->findOrCreateFromClaims(
            $provider,
            $claims,
            $email,
            $emailVerified,
            $payload['authentication_started_at']
        );
        $result['provider_key'] = $providerKey;
        $result['sso_provider_context'] = [
            'tenant_id' => (int) $provider->tenant_id, 'provider_key' => (string) $provider->provider_key,
            'issuer_url' => (string) $provider->issuer_url, 'client_id' => (string) $provider->client_id,
        ];
        $result['upstream_mfa_verified'] = $this->hasUpstreamMfaAssurance($claims);
        // Only the signed authentication time describes the upstream ceremony.
        // Local callback arrival must never turn historical MFA into fresh MFA.
        $authTime = $claims['auth_time'] ?? null;
        $result['upstream_mfa_verified_at'] = is_int($authTime) && $authTime > 0 && $authTime <= time()
            ? $authTime : null;
        $result['authentication_started_at'] = $payload['authentication_started_at'];
        $result['browser_challenge'] = $payload['browser_challenge'];
        return $result;
    }

    /**
     * Handle the OIDC callback for a LINK state: validate the ID token and
     * resolve the pending identity link for the member named in the state.
     *
     * Never signs anyone in and never matches by email — the verified
     * subject is bound only to the state's member. Nothing durable changes
     * here: the caller publishes a browser-bound pending-link code, and the
     * identity is written only when the initiating tab exchanges it.
     *
     * @return array{
     *   user:User,
     *   tenant_id:int,
     *   provider_key:string,
     *   identity_link:array<string,mixed>,
     *   sso_provider_context:array<string,mixed>,
     *   authentication_started_at:int,
     *   browser_challenge:string
     * }
     */
    public function handleLinkCallback(string $state, string $code): array
    {
        $payload = $this->verifyState($state);
        $tenantId = $payload['tenant_id'];
        $providerKey = $payload['provider_key'];
        $userId = (int) ($payload['user_id'] ?? 0);
        if ($payload['intent'] !== self::INTENT_LINK || $userId < 1) {
            throw new \RuntimeException('SSO state is not a link state.');
        }

        $flow = Cache::pull($this->flowCacheKey($payload['state_nonce']));
        if (! is_array($flow) || empty($flow['code_verifier']) || empty($flow['oidc_nonce'])) {
            throw new \RuntimeException('SSO flow state expired or already used.');
        }
        $flowBrowserChallenge = $flow['browser_challenge'] ?? null;
        if (
            ($flow['intent'] ?? null) !== self::INTENT_LINK
            || (int) ($flow['link_user_id'] ?? 0) !== $userId
            || ! is_string($flowBrowserChallenge)
            || ! hash_equals($payload['browser_challenge'], $flowBrowserChallenge)
        ) {
            throw new \RuntimeException('SSO link flow does not match its signed state.');
        }

        $provider = $this->getEnabledProvider($tenantId, $providerKey);
        if (
            ! hash_equals((string) ($flow['issuer_url'] ?? ''), (string) $provider->issuer_url)
            || ! hash_equals((string) ($flow['client_id'] ?? ''), (string) $provider->client_id)
        ) {
            throw new \RuntimeException('SSO provider configuration changed during the link.');
        }

        $user = $this->requireActiveTenantUser($tenantId, $userId);
        // Privileged accounts may use only a host-approved provider; refuse
        // now with a clear outcome rather than at the exchange.
        self::assertPrivilegedProviderTrusted($user, (array) $provider);

        $discovery = $this->discover($provider->issuer_url);
        $claims = $this->exchangeAndValidate($provider, $discovery, $code, $flow);

        $email = $this->extractEmail($claims);
        $emailVerified = $this->emailIsVerified($claims);
        // Every later sign-in through the provider enforces the domain gate,
        // so a link that could never be used is refused up front.
        $this->assertDomainAllowed($provider, $email, $emailVerified);

        $identityProvider = $this->identityProviderString($tenantId, (string) $provider->provider_key);
        $subject = (string) $claims['sub'];

        $owner = DB::table('oauth_identities')
            ->where('provider', $identityProvider)
            ->where('provider_user_id', $subject)
            ->first(['user_id', 'tenant_id']);
        if ($owner !== null && ((int) $owner->user_id !== $userId || (int) $owner->tenant_id !== $tenantId)) {
            throw new SsoIdentityInUseException('This SSO identity is already linked to another account.');
        }
        $current = DB::table('oauth_identities')
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->where('provider', $identityProvider)
            ->value('provider_user_id');
        if ($current !== null && (string) $current !== $subject) {
            throw new \RuntimeException('A different identity is already linked for this provider; unlink it first.');
        }

        $context = [
            'tenant_id' => (int) $provider->tenant_id, 'provider_key' => (string) $provider->provider_key,
            'issuer_url' => (string) $provider->issuer_url, 'client_id' => (string) $provider->client_id,
        ];

        return [
            'user' => $user,
            'tenant_id' => $tenantId,
            'provider_key' => $providerKey,
            'identity_link' => [
                'provider' => $identityProvider,
                'provider_user_id' => $subject,
                // Metadata only — never an ownership signal on this path.
                'provider_email' => $emailVerified ? $email : null,
                'avatar_url' => null,
                'raw_payload' => $this->withIdentityBinding($this->safeClaims($claims), $provider, $claims),
                'authentication_started_at' => $payload['authentication_started_at'],
                'expected_verified_email' => null,
                'sso_provider_context' => $context,
            ],
            'sso_provider_context' => $context,
            'authentication_started_at' => $payload['authentication_started_at'],
            'browser_challenge' => $payload['browser_challenge'],
        ];
    }

    /**
     * The community's enabled SSO providers and whether this member has
     * linked each one (connected-accounts settings).
     *
     * @return array<int, array{
     *   key:string, display_name:string, preset:string, linked:bool,
     *   provider_email:?string, linked_at:mixed, last_used_at:mixed
     * }>
     */
    public function connectedProviders(int $tenantId, int $userId): array
    {
        $providers = $this->enabledProviders($tenantId);
        if ($providers === []) {
            return [];
        }
        $identities = DB::table('oauth_identities')
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->where('provider', 'like', 'sso:' . $tenantId . ':%')
            ->get(['provider', 'provider_email', 'linked_at', 'last_used_at'])
            ->keyBy('provider');

        return array_map(function (array $provider) use ($identities, $tenantId): array {
            $identity = $identities->get($this->identityProviderString($tenantId, $provider['key']));

            return [
                'key' => $provider['key'],
                'display_name' => $provider['display_name'],
                'preset' => $provider['preset'],
                'linked' => $identity !== null,
                'provider_email' => $identity->provider_email ?? null,
                'linked_at' => $identity->linked_at ?? null,
                'last_used_at' => $identity->last_used_at ?? null,
            ];
        }, $providers);
    }

    /**
     * The member a link is bound to must still exist and be active in the
     * state's community.
     */
    private function requireActiveTenantUser(int $tenantId, int $userId): User
    {
        $user = User::query()
            ->whereKey($userId)
            ->where('tenant_id', $tenantId)
            ->whereNull('deleted_at')
            ->whereNull('anonymized_at')
            ->first();
        if ($user === null || strtolower(trim((string) ($user->status ?? 'active'))) !== 'active') {
            throw new \RuntimeException('SSO link member is not an active member of this community.');
        }

        return $user;
    }

    // ------------------------------------------------------------ admin CRUD

    /**
     * @return array<int, array<string, mixed>> secret never included
     */
    public function listForAdmin(int $tenantId): array
    {
        return DB::table('tenant_sso_providers')
            ->where('tenant_id', $tenantId)
            ->orderBy('display_name')
            ->get()
            ->map(fn ($r) => $this->adminRow($r))
            ->all();
    }

    /**
     * Create or update a provider. $input keys: provider_key,
     * display_name, preset, issuer_url, client_id, client_secret
     * (optional on update — blank keeps the stored secret), scopes,
     * allowed_email_domains (array), auto_provision, is_enabled.
     *
     * @return array<string, mixed> the stored row, secret masked
     */
    public function upsert(int $tenantId, array $input, int $adminUserId): array
    {
        $key = strtolower(trim((string) ($input['provider_key'] ?? '')));
        if (! preg_match('/^[a-z0-9][a-z0-9_-]{1,19}$/', $key)) {
            throw new \InvalidArgumentException(__('api.sso_invalid_provider_key'));
        }

        $issuer = trim((string) ($input['issuer_url'] ?? ''));
        if (! str_starts_with($issuer, 'https://') || filter_var($issuer, FILTER_VALIDATE_URL) === false) {
            throw new \InvalidArgumentException(__('api.sso_invalid_issuer'));
        }

        $clientId = trim((string) ($input['client_id'] ?? ''));
        if ($clientId === '') {
            throw new \InvalidArgumentException(__('api.sso_client_id_required'));
        }

        $preset = (string) ($input['preset'] ?? 'generic');
        if (! in_array($preset, self::PRESETS, true)) {
            $preset = 'generic';
        }

        $domains = $this->normaliseDomains($input['allowed_email_domains'] ?? null);

        $row = [
            'tenant_id' => $tenantId,
            'provider_key' => $key,
            'display_name' => Str::limit(trim((string) ($input['display_name'] ?? $key)), 100, ''),
            'preset' => $preset,
            'issuer_url' => rtrim($issuer, '/'),
            'client_id' => $clientId,
            'scopes' => Str::limit(trim((string) ($input['scopes'] ?? 'openid profile email')), 255, ''),
            'allowed_email_domains' => $domains === [] ? null : json_encode($domains),
            'auto_provision' => (bool) ($input['auto_provision'] ?? true),
            'is_enabled' => (bool) ($input['is_enabled'] ?? false),
            'updated_by' => $adminUserId,
            'updated_at' => now(),
        ];

        $secret = (string) ($input['client_secret'] ?? '');
        if ($secret !== '') {
            $row['client_secret_encrypted'] = Crypt::encryptString($secret);
        }

        $existing = DB::table('tenant_sso_providers')
            ->where('tenant_id', $tenantId)
            ->where('provider_key', $key)
            ->first();

        if ($existing) {
            DB::table('tenant_sso_providers')->where('id', $existing->id)->update($row);
            $id = (int) $existing->id;
        } else {
            $row['created_at'] = now();
            $id = (int) DB::table('tenant_sso_providers')->insertGetId($row);
        }

        // Config changed — drop cached discovery so a corrected issuer
        // URL takes effect immediately.
        Cache::forget($this->discoveryCacheKey($row['issuer_url']));

        $stored = DB::table('tenant_sso_providers')->where('id', $id)->first();
        return $this->adminRow($stored);
    }

    public function delete(int $tenantId, string $providerKey): void
    {
        DB::table('tenant_sso_providers')
            ->where('tenant_id', $tenantId)
            ->where('provider_key', $providerKey)
            ->delete();
    }

    // ---------------------------------------------------------------- OIDC core

    /**
     * Fetch + cache the issuer's discovery document.
     *
     * @return array{issuer:string, authorization_endpoint:string, token_endpoint:string, jwks_uri:string}
     */
    public function discover(string $issuerUrl): array
    {
        $issuerUrl = rtrim($issuerUrl, '/');

        return Cache::remember($this->discoveryCacheKey($issuerUrl), self::DISCOVERY_CACHE_SECONDS, function () use ($issuerUrl) {
            $discoveryUrl = $issuerUrl . '/.well-known/openid-configuration';
            $response = $this->guardedHttpClient($discoveryUrl)->get($discoveryUrl);

            if ($response->status() >= 300 && $response->status() < 400) {
                throw new \RuntimeException('OIDC discovery redirects are not allowed.');
            }

            if (! $response->ok()) {
                throw new \RuntimeException("OIDC discovery failed for {$issuerUrl} (HTTP {$response->status()}).");
            }

            $doc = $response->json();
            foreach (['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri'] as $field) {
                if (empty($doc[$field]) || ! is_string($doc[$field])) {
                    throw new \RuntimeException("OIDC discovery document missing '{$field}'.");
                }
            }

            // The endpoints come from the (admin-configured) issuer's
            // document but are fetched/posted-to by the server — enforce
            // https + public address so a misconfigured or hostile issuer
            // cannot turn discovery into an SSRF probe or redirect the
            // client-secret POST to an internal/attacker host.
            $this->assertPublicHttpsUrl($doc['authorization_endpoint']);
            $this->assertPublicHttpsUrl($doc['token_endpoint']);
            $this->assertPublicHttpsUrl($doc['jwks_uri']);

            return [
                'issuer' => $doc['issuer'],
                'authorization_endpoint' => $doc['authorization_endpoint'],
                'token_endpoint' => $doc['token_endpoint'],
                'jwks_uri' => $doc['jwks_uri'],
            ];
        });
    }

    /**
     * Exchange the authorization code and validate the returned ID token.
     *
     * @param array{code_verifier:string, oidc_nonce:string} $flow
     * @return array<string, mixed> validated ID token claims
     */
    private function exchangeAndValidate(object $provider, array $discovery, string $code, array $flow): array
    {
        $form = [
            'grant_type' => 'authorization_code',
            'code' => $code,
            'redirect_uri' => $this->redirectUri(),
            'client_id' => $provider->client_id,
            'code_verifier' => $flow['code_verifier'],
        ];
        if (! empty($provider->client_secret_encrypted)) {
            $form['client_secret'] = Crypt::decryptString($provider->client_secret_encrypted);
        }

        // Re-assert before sending the secret — discovery is cached, so this
        // also covers a token_endpoint that became internal after caching.
        $response = $this->guardedHttpClient($discovery['token_endpoint'])
            ->asForm()
            ->post($discovery['token_endpoint'], $form);

        if ($response->status() >= 300 && $response->status() < 400) {
            throw new \RuntimeException('SSO token endpoint redirects are not allowed.');
        }

        if (! $response->ok()) {
            Log::warning('[SSO] token exchange failed', [
                'issuer' => $discovery['issuer'],
                'status' => $response->status(),
                'error' => (string) ($response->json('error') ?? ''),
            ]);
            throw new \RuntimeException('SSO token exchange was rejected by the identity provider.');
        }

        $idToken = (string) ($response->json('id_token') ?? '');
        if ($idToken === '') {
            throw new \RuntimeException('Identity provider did not return an ID token.');
        }

        $claims = (array) $this->decodeIdToken($idToken, $discovery['jwks_uri']);

        // iss — must match the discovery document exactly.
        if (($claims['iss'] ?? '') !== $discovery['issuer']) {
            throw new \RuntimeException('ID token issuer mismatch.');
        }
        // aud — string or array; must include our client_id.
        $aud = $claims['aud'] ?? '';
        $audList = is_array($aud) ? $aud : [$aud];
        if (! in_array($provider->client_id, $audList, true)) {
            throw new \RuntimeException('ID token audience mismatch.');
        }
        // nonce — must round-trip from our redirect.
        if (($claims['nonce'] ?? '') !== $flow['oidc_nonce']) {
            throw new \RuntimeException('ID token nonce mismatch.');
        }
        if (empty($claims['sub']) || ! is_string($claims['sub'])) {
            throw new \RuntimeException('ID token has no subject.');
        }

        return $claims;
    }

    /**
     * Verify the ID token signature against the issuer's JWKS.
     * exp/nbf/iat are enforced by JWT::decode.
     */
    private function decodeIdToken(string $idToken, string $jwksUri): array
    {
        JWT::$leeway = 60;

        $jwks = $this->fetchJwks($jwksUri, false);
        try {
            $decoded = JWT::decode($idToken, $this->asymmetricKeySet($jwks));
        } catch (\Throwable $first) {
            // Only a genuinely unknown key id (key rotation) warrants a
            // refetch. Signature, expiry and audience failures must NOT
            // trigger one — otherwise a flood of bad tokens would defeat
            // the JWKS cache and hammer the issuer (self-inflicted DoS /
            // rate-limit). Re-throw everything except a missing kid.
            if (! $this->kidMissingFromSet($idToken, $jwks)) {
                throw $first;
            }
            $jwks = $this->fetchJwks($jwksUri, true);
            $decoded = JWT::decode($idToken, $this->asymmetricKeySet($jwks));
        }

        return json_decode((string) json_encode($decoded), true) ?: [];
    }

    /**
     * Fetch the JWKS, cached. $forceRefresh evicts the cache first (used
     * once on a key-rotation miss).
     *
     * @return array<string, mixed>
     */
    private function fetchJwks(string $jwksUri, bool $forceRefresh): array
    {
        $cacheKey = $this->jwksCacheKey($jwksUri);
        if ($forceRefresh) {
            Cache::forget($cacheKey);
        }
        return Cache::remember($cacheKey, self::JWKS_CACHE_SECONDS, function () use ($jwksUri) {
            $response = $this->guardedHttpClient($jwksUri)->get($jwksUri);
            if ($response->status() >= 300 && $response->status() < 400) {
                throw new \RuntimeException('SSO JWKS endpoint redirects are not allowed.');
            }
            if (! $response->ok() || ! is_array($response->json('keys'))) {
                throw new \RuntimeException('Could not fetch identity provider signing keys.');
            }
            return $response->json();
        });
    }

    /**
     * Parse the JWKS and keep ONLY asymmetric signing keys. Defence in
     * depth against algorithm-confusion: a JWKS that (maliciously or by
     * accident) carries a symmetric `oct`/HS* key — whose `k` is public —
     * must never be usable to forge a token, even though firebase/php-jwt
     * already binds token.alg to key.alg.
     *
     * @param array<string, mixed> $jwks
     * @return array<string, \Firebase\JWT\Key>
     */
    private function asymmetricKeySet(array $jwks): array
    {
        $allowed = ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512'];
        $safe = [];
        foreach (JWK::parseKeySet($jwks, 'RS256') as $kid => $key) {
            if (in_array($key->getAlgorithm(), $allowed, true)) {
                $safe[$kid] = $key;
            }
        }
        if ($safe === []) {
            throw new \RuntimeException('Identity provider JWKS contains no usable asymmetric signing keys.');
        }
        return $safe;
    }

    /**
     * True when the token's `kid` header is absent from the given JWKS
     * (i.e. a refetch could plausibly help). A present kid means the key
     * is known and the failure was something else (bad signature, expiry).
     *
     * @param array<string, mixed> $jwks
     */
    private function kidMissingFromSet(string $idToken, array $jwks): bool
    {
        $parts = explode('.', $idToken);
        if (count($parts) < 2) {
            return false;
        }
        $header = json_decode((string) base64_decode(strtr($parts[0], '-_', '+/'), true), true);
        $kid = is_array($header) ? ($header['kid'] ?? null) : null;
        if (! $kid) {
            return true;
        }
        foreach (($jwks['keys'] ?? []) as $k) {
            if (is_array($k) && ($k['kid'] ?? null) === $kid) {
                return false;
            }
        }
        return true;
    }

    /**
     * Reject any URL that is not https or that resolves to a non-public
     * address (loopback, link-local incl. 169.254.169.254, private,
     * reserved) — SSRF guard for admin-supplied issuer/endpoint URLs.
     */
    private function assertPublicHttpsUrl(string $url): void
    {
        try {
            OutboundUrlGuard::assertSafeHttpUrl(
                $url,
                requireHttps: true,
                message: 'Unsafe SSO endpoint.'
            );
        } catch (\InvalidArgumentException $e) {
            throw new \RuntimeException(
                'SSO endpoint must resolve to a public https address.',
                0,
                $e
            );
        }
    }

    /**
     * Build a no-redirect HTTP client whose hostname is pinned to the public
     * address validated for this exact request. No pin means no request.
     */
    private function guardedHttpClient(string $url): PendingRequest
    {
        try {
            $options = OutboundUrlGuard::httpClientOptions($url, requireHttps: true);
        } catch (\InvalidArgumentException $e) {
            throw new \RuntimeException(
                'SSO endpoint must resolve to a public https address.',
                0,
                $e
            );
        }

        return Http::withOptions($options)
            ->withoutRedirecting()
            ->timeout(self::HTTP_TIMEOUT_SECONDS);
    }

    // ------------------------------------------------------- user resolution

    /**
     * Mirror of SocialAuthService::findOrCreateFromOauth with the SSO
     * provisioning rules applied.
     *
     * @param array<string, mixed> $claims
     * @return array{user:User, is_new:bool, tenant_id:int}
     */
    private function findOrCreateFromClaims(
        object $provider,
        array $claims,
        ?string $email,
        bool $emailVerified,
        int $authenticationStartedAt
    ): array
    {
        $tenantId = (int) $provider->tenant_id;
        $identityProvider = $this->identityProviderString($tenantId, $provider->provider_key);
        $subject = (string) $claims['sub'];
        $name = isset($claims['name']) && is_string($claims['name']) ? $claims['name'] : null;
        $rawPayload = $this->safeClaims($claims);

        // 1. Existing identity?
        $existing = DB::selectOne(
            'SELECT user_id, raw_payload FROM oauth_identities WHERE tenant_id = ? AND provider = ? AND provider_user_id = ? LIMIT 1',
            [$tenantId, $identityProvider, $subject]
        );
        if ($existing) {
            // F-268: the subject is opaque and chosen by whoever signs the
            // token. A linked identity signs in only through the issuer and
            // client it was bound under, so a provider an admin repoints at
            // an IdP they control cannot mint a linked member's `sub`.
            $storedPayload = json_decode((string) ($existing->raw_payload ?? ''), true);
            $storedPayload = is_array($storedPayload) ? $storedPayload : [];
            if (! $this->linkedIdentityBindingHolds($provider, $claims, $storedPayload)) {
                Log::warning('[SSO] refused linked identity: issuer or client differs from the one it was bound under', [
                    'tenant_id' => $tenantId,
                    'provider_key' => (string) $provider->provider_key,
                    'user_id' => (int) $existing->user_id,
                    'bound' => is_array($storedPayload[self::IDENTITY_BINDING_KEY] ?? null),
                ]);
                throw new \RuntimeException(__('api.sso_login_failed'));
            }

            $user = User::query()
                ->whereKey((int) $existing->user_id)
                ->where('tenant_id', $tenantId)
                ->first();
            if ($user === null) {
                throw new \RuntimeException('Linked user not found.');
            }
            self::assertPrivilegedProviderTrusted($user, (array) $provider);

            if ($emailVerified && $email !== null) {
                DB::update(
                    'UPDATE oauth_identities SET last_used_at = NOW(), provider_email = ?, raw_payload = ?, updated_at = NOW() WHERE tenant_id = ? AND provider = ? AND provider_user_id = ?',
                    [$email, json_encode($this->withIdentityBinding($rawPayload, $provider, $claims)), $tenantId, $identityProvider, $subject]
                );
            } else {
                // The signed subject preserves an established tenant-bound
                // identity when no domain gate applies. An unverified email
                // must not replace trusted metadata or influence ownership;
                // only the (just verified) binding is recorded alongside it.
                DB::update(
                    'UPDATE oauth_identities SET last_used_at = NOW(), raw_payload = ?, updated_at = NOW() WHERE tenant_id = ? AND provider = ? AND provider_user_id = ?',
                    [json_encode($this->withIdentityBinding($storedPayload, $provider, $claims)), $tenantId, $identityProvider, $subject]
                );
            }
            return ['user' => $user, 'is_new' => false, 'tenant_id' => $tenantId];
        }

        // New ownership decisions (email-link or auto-provision) may use only
        // a standards-compliant boolean assertion covered by the validated ID
        // token signature. Missing, false, and type-confused values fail closed.
        if (! $emailVerified) {
            throw new \RuntimeException(__('api.sso_login_failed'));
        }
        if ($email === null) {
            throw new \RuntimeException(__('api.sso_email_missing'));
        }

        // 2. Email match within an existing local account.
        //
        // 🔴 nOAuth guard: auto-linking by email is account takeover unless
        // BOTH sides are trustworthy. We require the IdP to assert
        // `email_verified: true` for THIS login (the email/UPN claim is
        // owner-mutable in Entra and many generic IdPs — an attacker can
        // self-assert victim@council.gov.uk) AND the local account to be
        // verified. If either is missing we refuse and steer the user to
        // the explicit, authenticated account-link flow rather than silently
        // binding a stranger's `sub` to an existing user.
        if ($email) {
            $emailMatch = DB::selectOne(
                'SELECT * FROM users WHERE tenant_id = ? AND email = ? LIMIT 1',
                [$tenantId, $email]
            );
            if ($emailMatch) {
                self::assertPrivilegedProviderTrusted($emailMatch, (array) $provider);
                // F-244: a community admin can point a provider at an issuer
                // they control and have it assert `email_verified: true` (and
                // MFA) for any member's address. Only a provider the host has
                // approved may claim an existing account by email; every other
                // provider must be linked by the member while signed in.
                // Already-linked identities (step 1) and new accounts (step 3)
                // are unaffected.
                if (! self::isHostApprovedProvider($tenantId, (array) $provider)) {
                    Log::notice('[SSO] refused email match to an existing account via a provider not host-approved', [
                        'tenant_id' => $tenantId,
                        'provider_key' => (string) $provider->provider_key,
                        'user_id' => (int) $emailMatch->id,
                    ]);
                    // Same exception as "provisioning disabled" below, so the
                    // outcome is not an account-existence oracle there.
                    throw new SsoLinkRequiredException(__('api.sso_account_exists_link_required'));
                }
                if (! empty($emailMatch->email_verified_at)) {
                    $user = (new User())->newFromBuilder((array) $emailMatch);

                    return [
                        'user' => $user,
                        'is_new' => false,
                        'tenant_id' => $tenantId,
                        'identity_link' => [
                            'provider' => $identityProvider,
                            'provider_user_id' => $subject,
                            'provider_email' => $email,
                            'avatar_url' => null,
                            'raw_payload' => $this->withIdentityBinding($rawPayload, $provider, $claims),
                            'authentication_started_at' => $authenticationStartedAt,
                            'expected_verified_email' => $email,
                        ],
                    ];
                }
                // The local
                // account is unverified — refuse rather than risk takeover.
                throw new \RuntimeException(__('api.sso_account_exists_unverified'));
            }
        }

        // 3. Create a new user — only when the provider allows it.
        if (! (bool) $provider->auto_provision) {
            // Reported exactly like the F-244 email-match refusal above: when
            // provisioning is off, "no account" and "account exists" must be
            // indistinguishable to whoever controls the ID token.
            throw new SsoLinkRequiredException(__('api.sso_account_exists_link_required'));
        }
        if (! $email) {
            throw new \RuntimeException(__('api.sso_email_missing'));
        }

        // F-270: a new account obeys the community's registration policy, as
        // SocialAuthService::findOrCreateFromOauth() does. An ID token carries
        // no invitation proof, so invite-only is treated exactly like closed.
        // Refused the same way as "provisioning disabled" above, so a closed
        // community is not an account-existence oracle for the token's author.
        $registrationPolicy = RegistrationPolicyService::getEffectivePolicy($tenantId);
        $registrationMode = (string) ($registrationPolicy['registration_mode'] ?? 'closed');
        if (in_array($registrationMode, ['closed', 'invite_only'], true)) {
            Log::info('[SSO] refused to provision: community registration policy does not allow it', [
                'tenant_id' => $tenantId,
                'provider_key' => (string) $provider->provider_key,
                'registration_mode' => $registrationMode,
            ]);
            throw new SsoLinkRequiredException(__('api.sso_account_exists_link_required'));
        }
        if (! in_array(
            $registrationMode,
            ['open', 'open_with_approval', 'verified_identity', 'government_id', 'waitlist'],
            true
        )) {
            throw new \RuntimeException('SSO registration policy is unsupported.');
        }

        $names = $this->splitName($name, $email);
        $userId = DB::transaction(function () use (
            $tenantId,
            $names,
            $email,
            $registrationMode,
            $identityProvider,
            $subject,
            $rawPayload,
            $provider,
            $claims
        ): int {
            $isOpen = $registrationMode === 'open';
            $userId = (int) DB::table('users')->insertGetId([
                'tenant_id' => $tenantId,
                'first_name' => $names['first'],
                'last_name' => $names['last'],
                // `users.name` is NOT NULL and feeds most display paths; SSO
                // provisioning never wrote it, leaving an empty stored name.
                'name' => UserDisplayName::forStorage(null, null, $names['first'], $names['last']),
                'email' => $email,
                'password' => password_hash(Str::random(48), PASSWORD_BCRYPT),
                // Provisioning is reachable only after a signed literal-boolean
                // `email_verified: true` assertion for this exact address.
                'email_verified_at' => now(),
                'preferred_language' => 'en',
                'status' => $isOpen ? 'active' : 'pending',
                'is_approved' => $isOpen ? 1 : 0,
                'role' => 'member',
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            $this->insertIdentity(
                $userId,
                $tenantId,
                $identityProvider,
                $subject,
                $email,
                $this->withIdentityBinding($rawPayload, $provider, $claims)
            );

            // Keep the user, identity and policy-driven account state in one
            // SQL unit, as the social sign-in path does.
            RegistrationOrchestrationService::processRegistration($userId, $tenantId);

            return $userId;
        }, 3);

        $user = User::query()
            ->whereKey($userId)
            ->where('tenant_id', $tenantId)
            ->first();
        if ($user === null) {
            throw new \RuntimeException('SSO user creation failed.');
        }

        return ['user' => $user, 'is_new' => true, 'tenant_id' => $tenantId];
    }

    // ---------------------------------------------------------------- helpers

    public function identityProviderString(int $tenantId, string $providerKey): string
    {
        return "sso:{$tenantId}:{$providerKey}";
    }

    private function getEnabledProvider(int $tenantId, string $providerKey): object
    {
        $row = DB::table('tenant_sso_providers')
            ->where('tenant_id', $tenantId)
            ->where('provider_key', $providerKey)
            ->where('is_enabled', 1)
            ->first();
        if (! $row) {
            throw new \RuntimeException(__('api.sso_provider_not_enabled'));
        }
        return $row;
    }

    private function assertDomainAllowed(
        object $provider,
        ?string $email,
        bool $emailVerified
    ): void
    {
        $domains = json_decode((string) ($provider->allowed_email_domains ?? ''), true);
        if (! is_array($domains) || $domains === []) {
            return;
        }
        if (! $emailVerified || $email === null) {
            throw new \RuntimeException(__('api.sso_domain_not_allowed'));
        }
        $emailDomain = strtolower((string) strstr($email, '@'));
        foreach ($domains as $domain) {
            if ($emailDomain === '@' . strtolower(ltrim((string) $domain, '@'))) {
                return;
            }
        }
        throw new \RuntimeException(__('api.sso_domain_not_allowed'));
    }

    /**
     * The email used for matching/provisioning. Only the standard `email`
     * claim is honoured — `preferred_username`/`upn` are display/login
     * hints that are owner-mutable and unverified in Entra and other IdPs,
     * so trusting them as an email identity is an account-takeover vector.
     */
    private function extractEmail(array $claims): ?string
    {
        $candidate = $claims['email'] ?? null;
        if (is_string($candidate) && filter_var($candidate, FILTER_VALIDATE_EMAIL)) {
            return strtolower($candidate);
        }
        return null;
    }

    /**
     * Whether the IdP asserted the email address is verified. Defaults to
     * false (fail closed) when the claim is absent — many IdPs, including
     * single-tenant Entra, omit it, in which case the email is treated as
     * unverified and never auto-links to an existing account. Only the literal
     * JSON boolean true is accepted; strings and integers are malformed.
     */
    private function emailIsVerified(array $claims): bool
    {
        return ($claims['email_verified'] ?? null) === true;
    }

    /**
     * @param mixed $value
     * @return array<int, string>
     */
    private function normaliseDomains($value): array
    {
        if (is_string($value)) {
            $value = preg_split('/[\s,]+/', $value, -1, PREG_SPLIT_NO_EMPTY);
        }
        if (! is_array($value)) {
            return [];
        }
        $out = [];
        foreach ($value as $domain) {
            $domain = strtolower(ltrim(trim((string) $domain), '@'));
            if ($domain !== '' && preg_match('/^[a-z0-9.-]+\.[a-z]{2,}$/', $domain)) {
                $out[] = $domain;
            }
        }
        return array_values(array_unique($out));
    }

    private function buildState(
        int $tenantId,
        string $providerKey,
        string $stateNonce,
        string $browserChallenge,
        ?int $linkUserId = null
    ): string {
        $payload = [
            't' => $tenantId,
            'p' => $providerKey,
            'n' => $stateNonce,
            'x' => now()->timestamp,
            'b' => OAuthBrowserBinding::requireChallenge($browserChallenge),
        ];
        if ($linkUserId !== null) {
            // Sign-in states carry no intent (the historical format), so an
            // older in-flight state still reads as a sign-in.
            $payload['i'] = self::INTENT_LINK;
            $payload['u'] = $linkUserId;
        }
        $body = base64_encode((string) json_encode($payload));
        $sig = hash_hmac('sha256', $body, (string) config('app.key'));
        return $body . '.' . $sig;
    }

    /**
     * @return array{
     *   tenant_id:int,
     *   provider_key:string,
     *   state_nonce:string,
     *   authentication_started_at:int,
     *   browser_challenge:string,
     *   intent:string,
     *   user_id:?int
     * }
     */
    private function verifyState(string $state): array
    {
        if (! str_contains($state, '.')) {
            throw new \RuntimeException('Invalid SSO state token.');
        }
        [$body, $sig] = explode('.', $state, 2);
        $expected = hash_hmac('sha256', $body, (string) config('app.key'));
        if (! hash_equals($expected, $sig)) {
            throw new \RuntimeException('SSO state signature mismatch.');
        }
        $decoded = json_decode((string) base64_decode($body, true), true);
        if (! is_array($decoded) || empty($decoded['t']) || empty($decoded['p']) || empty($decoded['n'])) {
            throw new \RuntimeException('Malformed SSO state token.');
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
            throw new \RuntimeException('SSO state token has expired.');
        }
        $intent = isset($decoded['i']) ? $decoded['i'] : self::INTENT_LOGIN;
        if (! in_array($intent, [self::INTENT_LOGIN, self::INTENT_LINK], true)) {
            throw new \RuntimeException('Malformed SSO state token.');
        }
        $linkUserId = null;
        if ($intent === self::INTENT_LINK) {
            if (! isset($decoded['u']) || ! is_int($decoded['u']) || $decoded['u'] < 1) {
                throw new \RuntimeException('Malformed SSO state token.');
            }
            $linkUserId = $decoded['u'];
        }
        return [
            'tenant_id' => (int) $decoded['t'],
            'provider_key' => (string) $decoded['p'],
            'state_nonce' => (string) $decoded['n'],
            'authentication_started_at' => $authenticationStartedAt,
            'browser_challenge' => $browserChallenge,
            'intent' => $intent,
            'user_id' => $linkUserId,
        ];
    }

    private function pkceChallenge(string $verifier): string
    {
        return rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=');
    }

    private function redirectUri(): string
    {
        $base = (string) (config('services.sso.redirect_base') ?: config('app.url'));
        return rtrim($base, '/') . '/api/v2/auth/sso/callback';
    }

    private function insertIdentity(
        int $userId,
        int $tenantId,
        string $identityProvider,
        string $subject,
        ?string $email,
        array $rawPayload
    ): void {
        DB::statement(
            'INSERT INTO oauth_identities
                (user_id, tenant_id, provider, provider_user_id, provider_email, raw_payload, linked_at, last_used_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW(), NOW())
             ON DUPLICATE KEY UPDATE
                provider_email = VALUES(provider_email),
                raw_payload = VALUES(raw_payload),
                last_used_at = NOW(),
                updated_at = NOW()',
            [$userId, $tenantId, $identityProvider, $subject, $email, json_encode($rawPayload)]
        );
    }

    /**
     * Claims stripped of anything token-like before persisting.
     *
     * @param array<string, mixed> $claims
     * @return array<string, mixed>
     */
    private function safeClaims(array $claims): array
    {
        // The binding key is NEXUS-owned: an IdP must never be able to plant it.
        unset($claims['at_hash'], $claims['c_hash'], $claims['nonce'], $claims[self::IDENTITY_BINDING_KEY]);
        return $claims;
    }

    /**
     * The issuer and client an SSO identity is bound under (F-268): the
     * provider configuration used for this validated sign-in plus the token's
     * issuer, which exchangeAndValidate() has already matched to discovery.
     *
     * @param array<string, mixed> $claims validated ID token claims
     * @return array{issuer_url:string, client_id:string, iss:string}
     */
    private function identityBinding(object $provider, array $claims): array
    {
        return [
            'issuer_url' => rtrim((string) ($provider->issuer_url ?? ''), '/'),
            'client_id' => (string) ($provider->client_id ?? ''),
            'iss' => is_string($claims['iss'] ?? null) ? $claims['iss'] : '',
        ];
    }

    /**
     * @param array<string, mixed> $payload
     * @param array<string, mixed> $claims validated ID token claims
     * @return array<string, mixed>
     */
    private function withIdentityBinding(array $payload, object $provider, array $claims): array
    {
        $payload[self::IDENTITY_BINDING_KEY] = $this->identityBinding($provider, $claims);

        return $payload;
    }

    /**
     * F-268: may this validated token sign in through an existing identity?
     *
     * Bound identity (written since F-268): the provider's issuer URL and
     * client id, and the token's issuer, must all equal what was recorded.
     *
     * Identity written before the binding existed: every creation path has
     * always stored the verified ID-token claims, so the row carries the
     * `iss` (and `aud`) it was last verified under. It may sign in — and is
     * then bound — only when the token's issuer equals that recorded `iss`,
     * the recorded `aud` (if any) includes the current client id, AND the
     * configured issuer URL is that same issuer (OIDC Discovery 1.0 §4.3).
     * The last condition stops a repointed provider whose discovery document
     * merely claims the original issuer. A row with no recorded issuer cannot
     * be proved unchanged and is refused; the member re-links while signed in.
     *
     * @param array<string, mixed> $claims validated ID token claims
     * @param array<string, mixed> $stored the identity's stored raw_payload
     */
    private function linkedIdentityBindingHolds(object $provider, array $claims, array $stored): bool
    {
        $current = $this->identityBinding($provider, $claims);
        if ($current['issuer_url'] === '' || $current['client_id'] === '' || $current['iss'] === '') {
            return false;
        }

        $recorded = $stored[self::IDENTITY_BINDING_KEY] ?? null;
        if (is_array($recorded)) {
            foreach ($current as $field => $value) {
                if (! is_string($recorded[$field] ?? null) || $recorded[$field] !== $value) {
                    return false;
                }
            }

            return true;
        }

        $recordedIssuer = $stored['iss'] ?? null;
        if (! is_string($recordedIssuer) || $recordedIssuer === '' || $recordedIssuer !== $current['iss']) {
            return false;
        }
        if (array_key_exists('aud', $stored)) {
            $recordedAudience = is_array($stored['aud']) ? $stored['aud'] : [$stored['aud']];
            if (! in_array($current['client_id'], $recordedAudience, true)) {
                return false;
            }
        }

        return rtrim($current['iss'], '/') === $current['issuer_url'];
    }

    /**
     * Tenant-managed identity providers need independent host approval before
     * authenticating accounts with administrative authority.
     */
    public static function assertPrivilegedProviderTrusted(object|array $user, array $provider): void
    {
        if (!\App\Support\Authorization\AdminTier::allows($user)
            && !data_get($user, 'is_super_admin') && !data_get($user, 'is_god')
            && data_get($user, 'role') !== 'org_admin') {
            return;
        }
        if (self::isHostApprovedProvider((int) data_get($user, 'tenant_id'), $provider)) {
            return;
        }
        throw new \RuntimeException(__('api.sso_login_failed'));
    }

    /**
     * True only when the host operator has approved this exact provider
     * (tenant + issuer + client + key) in SSO_PRIVILEGED_PROVIDERS. A
     * community admin can edit the provider row but not this host list, and
     * any edit to issuer/client/key stops the row matching.
     */
    private static function isHostApprovedProvider(int $tenantId, array $provider): bool
    {
        $approved = config('services.sso.privileged_providers', []);
        foreach (is_array($approved) ? $approved : [] as $entry) {
            if (is_array($entry)
                && (int) ($entry['tenant_id'] ?? 0) === $tenantId
                && (int) ($provider['tenant_id'] ?? 0) === $tenantId
                && !empty($entry['issuer_url']) && !empty($entry['client_id']) && !empty($entry['provider_key'])
                && ($entry['issuer_url'] ?? null) === ($provider['issuer_url'] ?? null)
                && ($entry['client_id'] ?? null) === ($provider['client_id'] ?? null)
                && ($entry['provider_key'] ?? null) === ($provider['provider_key'] ?? null)) {
                return true;
            }
        }
        return false;
    }

    /** Accept explicit MFA evidence only from an already validated ID token. */
    public function hasUpstreamMfaAssurance(array $claims): bool
    {
        $amr = $claims['amr'] ?? null;
        if (is_array($amr)) {
            $methods = array_map(
                static fn (mixed $method): string => strtolower(trim(is_string($method) ? $method : '')),
                $amr
            );
            // RFC 8176: otp/hwk/swk individually describe possession, not MFA.
            // Require explicit MFA assurance or password plus possession.
            if (in_array('mfa', $methods, true)
                || (in_array('pwd', $methods, true)
                    && array_intersect($methods, ['otp', 'hwk', 'swk']) !== [])) {
                return true;
            }
        }

        $acr = is_string($claims['acr'] ?? null) ? trim((string) $claims['acr']) : '';
        if ($acr === '') {
            return false;
        }

        $configured = array_filter(array_map(
            'trim',
            explode(',', (string) config('services.sso.mfa_acr_values', 'urn:nist:ac:classes:aal2,urn:nist:ac:classes:aal3'))
        ));

        return in_array($acr, $configured, true);
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

    private function adminRow(object $r): array
    {
        return [
            'id' => (int) $r->id,
            'provider_key' => $r->provider_key,
            'display_name' => $r->display_name,
            'preset' => $r->preset,
            'issuer_url' => $r->issuer_url,
            'client_id' => $r->client_id,
            'has_client_secret' => ! empty($r->client_secret_encrypted),
            'scopes' => $r->scopes,
            'allowed_email_domains' => json_decode((string) ($r->allowed_email_domains ?? ''), true) ?: [],
            'auto_provision' => (bool) $r->auto_provision,
            'is_enabled' => (bool) $r->is_enabled,
            'updated_at' => $r->updated_at,
        ];
    }

    private function flowCacheKey(string $stateNonce): string
    {
        return 'sso:flow:' . hash('sha256', $stateNonce);
    }

    private function discoveryCacheKey(string $issuerUrl): string
    {
        return 'sso:discovery:' . hash('sha256', $issuerUrl);
    }

    private function jwksCacheKey(string $jwksUri): string
    {
        return 'sso:jwks:' . hash('sha256', $jwksUri);
    }
}
