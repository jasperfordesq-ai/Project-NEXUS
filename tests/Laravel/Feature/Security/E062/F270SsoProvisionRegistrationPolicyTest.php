<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E062;

use App\Http\Controllers\Auth\SsoAuthController;
use App\Services\Auth\SocialAuthService;
use App\Services\Auth\SsoOidcService;
use App\Services\Identity\RegistrationPolicyService;
use App\Services\TenantSettingsService;
use Firebase\JWT\JWT;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\Laravel\TestCase;

/**
 * F-270 (E-062) — an account created through a community's own OIDC identity
 * provider must obey that community's registration policy, exactly as the
 * sibling social sign-in path (SocialAuthService::findOrCreateFromOauth) does:
 *
 *   - `closed` / `invite_only`: no account is created (an ID token carries no
 *     invitation proof);
 *   - `open_with_approval`, `waitlist`, identity-verified modes: the account
 *     is created `pending` / unapproved and no session is issued;
 *   - `open`: the account is live and the member is signed in (control).
 *
 * Drives the real callback: signed state from redirectUrl(), an RS256 ID token
 * checked against a faked JWKS, SsoAuthController and the one-time code
 * exchange.
 */
class F270SsoProvisionRegistrationPolicyTest extends TestCase
{
    use DatabaseTransactions;

    private const BROWSER_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    private const BROWSER_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

    private string $issuer;
    private string $providerKey;
    private string $clientId;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        config(['services.sso.privileged_providers' => []]);

        $suffix = bin2hex(random_bytes(4));
        $this->issuer = 'https://93.184.216.34/f270-' . $suffix;
        $this->providerKey = 'f270' . substr($suffix, 0, 6);
        $this->clientId = 'f270-client-' . $suffix;

        DB::table('tenant_sso_providers')->insert([
            'tenant_id' => $this->testTenantId,
            'provider_key' => $this->providerKey,
            'display_name' => 'Community IdP',
            'preset' => 'generic',
            'issuer_url' => $this->issuer,
            'client_id' => $this->clientId,
            'client_secret_encrypted' => null,
            'scopes' => 'openid profile email',
            // The shipped defaults: auto-provision on, no domain allowlist.
            'allowed_email_domains' => null,
            'auto_provision' => 1,
            'is_enabled' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_closed_community_creates_no_account_and_issues_no_session(): void
    {
        $this->seedRegistrationMode('closed');
        $this->assertSame('closed', $this->effectiveMode(), 'precondition: community must be closed');

        $email = 'f270-closed-' . bin2hex(random_bytes(4)) . '@example.test';
        $query = $this->runCallback($email);

        $this->assertArrayNotHasKey('code', $query, 'a closed community must not issue a sign-in code');
        // Same outcome as "provisioning disabled", so a closed community is not
        // an account-existence oracle for whoever controls the ID token.
        $this->assertSame('sso_link_required', $query['error'] ?? null);
        $this->assertDatabaseMissing('users', ['tenant_id' => $this->testTenantId, 'email' => $email]);
    }

    public function test_invite_only_community_creates_no_account(): void
    {
        $this->seedRegistrationMode('invite_only');
        $this->assertSame('invite_only', $this->effectiveMode(), 'precondition: community must be invite-only');

        $email = 'f270-invite-' . bin2hex(random_bytes(4)) . '@example.test';
        $query = $this->runCallback($email);

        $this->assertArrayNotHasKey('code', $query);
        $this->assertSame('sso_link_required', $query['error'] ?? null);
        $this->assertDatabaseMissing('users', ['tenant_id' => $this->testTenantId, 'email' => $email]);
    }

    public function test_approval_required_community_holds_the_new_account_and_issues_no_session(): void
    {
        $this->seedRegistrationMode('open_with_approval');
        $this->assertSame('open_with_approval', $this->effectiveMode());

        $email = 'f270-appr-' . bin2hex(random_bytes(4)) . '@example.test';
        $query = $this->runCallback($email);

        $this->assertArrayNotHasKey('code', $query, 'a held account must not receive a sign-in code');

        $row = $this->userRow($email);
        $this->assertNotNull($row, 'the account is created, but held');
        $this->assertSame('pending', (string) $row->status);
        $this->assertSame(0, (int) $row->is_approved);
        $this->assertNotNull(
            app(TenantSettingsService::class)->checkLoginGatesForUser((array) $row),
            'the held account must not pass the sign-in gate'
        );
        // The identity is still linked, so the member signs in through the
        // provider once an administrator approves them.
        $this->assertDatabaseHas('oauth_identities', [
            'tenant_id' => $this->testTenantId,
            'user_id' => (int) $row->id,
            'provider' => 'sso:' . $this->testTenantId . ':' . $this->providerKey,
        ]);
    }

    public function test_identity_verified_community_marks_the_new_account_pending_verification(): void
    {
        $this->seedRegistrationMode('government_id', 'mock');
        $this->assertSame('government_id', $this->effectiveMode());

        $email = 'f270-govid-' . bin2hex(random_bytes(4)) . '@example.test';
        $query = $this->runCallback($email);

        $this->assertArrayNotHasKey('code', $query);
        $row = $this->userRow($email);
        $this->assertNotNull($row);
        $this->assertSame('pending', (string) $row->status);
        $this->assertSame(0, (int) $row->is_approved);
        $this->assertSame('pending', (string) $row->verification_status);
    }

    /**
     * CONTROL — an open community still provisions a live member and signs
     * them in, so the refusals above are not a blanket refusal.
     */
    public function test_control_open_community_provisions_and_signs_in(): void
    {
        $this->seedRegistrationMode('open');
        $this->assertSame('open', $this->effectiveMode());

        $email = 'f270-open-' . bin2hex(random_bytes(4)) . '@example.test';
        $query = $this->runCallback($email);

        $this->assertArrayNotHasKey('error', $query, 'open community SSO sign-up should succeed');
        $row = $this->userRow($email);
        $this->assertNotNull($row);
        $this->assertSame('active', (string) $row->status);
        $this->assertSame(1, (int) $row->is_approved);

        $payload = app(SocialAuthService::class)
            ->consumeCallbackCode($query['code'], self::BROWSER_VERIFIER);
        $this->assertNotEmpty($payload['token'] ?? null, 'a session token is issued');
        $this->assertTrue((bool) ($payload['is_new'] ?? false));
    }

    // ------------------------------------------------------------------ helpers

    private function effectiveMode(): string
    {
        return (string) RegistrationPolicyService::getEffectivePolicy($this->testTenantId)['registration_mode'];
    }

    private function userRow(string $email): ?object
    {
        return DB::table('users')
            ->where('tenant_id', $this->testTenantId)
            ->where('email', $email)
            ->first();
    }

    private function seedRegistrationMode(string $mode, ?string $verificationProvider = null): void
    {
        $generalMode = $mode === 'closed' ? 'closed' : 'open';
        $policyMode = $mode === 'closed' ? 'open' : $mode;

        foreach (['general.registration_mode', 'registration_mode'] as $settingKey) {
            DB::table('tenant_settings')->updateOrInsert(
                ['tenant_id' => $this->testTenantId, 'setting_key' => $settingKey],
                ['setting_value' => $generalMode, 'setting_type' => 'string', 'updated_at' => now()]
            );
        }
        app(TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);

        DB::table('tenant_registration_policies')->updateOrInsert(
            ['tenant_id' => $this->testTenantId],
            [
                'registration_mode' => $policyMode,
                'verification_provider' => $verificationProvider,
                'verification_level' => $verificationProvider !== null ? 'document_only' : 'none',
                'post_verification' => $mode === 'open' ? 'activate' : 'admin_approval',
                'fallback_mode' => 'none',
                'require_email_verify' => 0,
                'provider_config' => null,
                'is_active' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );
    }

    /**
     * @return array<string,string>
     */
    private function runCallback(string $email): array
    {
        [$privateKey, $jwks] = $this->makeKeypairAndJwks('f270-key');
        $idToken = '';
        Http::fake([
            $this->issuer . '/.well-known/openid-configuration' => Http::response([
                'issuer' => $this->issuer,
                'authorization_endpoint' => $this->issuer . '/authorize',
                'token_endpoint' => $this->issuer . '/token',
                'jwks_uri' => $this->issuer . '/keys',
            ]),
            $this->issuer . '/keys' => Http::response($jwks),
            $this->issuer . '/token' => function () use (&$idToken) {
                return Http::response(['id_token' => $idToken]);
            },
        ]);

        $sso = app(SsoOidcService::class);
        $redirect = $sso->redirectUrl($this->testTenantId, $this->providerKey, self::BROWSER_CHALLENGE);
        parse_str((string) parse_url($redirect['url'], PHP_URL_QUERY), $authorizeQuery);

        $idToken = JWT::encode([
            'iss' => $this->issuer,
            'aud' => $this->clientId,
            'nonce' => (string) $authorizeQuery['nonce'],
            'iat' => time(),
            'exp' => time() + 300,
            'sub' => 'f270-sub-' . bin2hex(random_bytes(4)),
            'email' => $email,
            'email_verified' => true,
            'name' => 'Idp Person',
        ], $privateKey, 'RS256', 'f270-key');

        $controller = new SsoAuthController($sso, app(SocialAuthService::class));
        $response = $controller->callback(Request::create('/api/v2/auth/sso/callback', 'GET', [
            'state' => $redirect['state'],
            'code' => 'authorization-code',
        ]));

        parse_str((string) parse_url($response->getTargetUrl(), PHP_URL_QUERY), $query);

        return $query;
    }

    /**
     * @return array{0:\OpenSSLAsymmetricKey, 1:array{keys:array<int,array<string,string>>}}
     */
    private function makeKeypairAndJwks(string $kid): array
    {
        $res = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
        $this->assertNotFalse($res, 'openssl_pkey_new failed');
        $details = openssl_pkey_get_details($res);
        $b64url = static fn (string $bin) => rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');

        return [$res, ['keys' => [[
            'kty' => 'RSA',
            'kid' => $kid,
            'use' => 'sig',
            'alg' => 'RS256',
            'n' => $b64url($details['rsa']['n']),
            'e' => $b64url($details['rsa']['e']),
        ]]]];
    }
}
