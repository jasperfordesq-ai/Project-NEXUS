<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E055;

use App\Http\Controllers\Auth\SsoAuthController;
use App\Models\User;
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
 * F-244 (E-055 F-1) — a community admin can register an OIDC provider whose
 * issuer they control. That provider must never auto-link, by email, to an
 * account that already exists in the community: otherwise the admin's own IdP
 * can mint `email_verified: true` + `amr: [mfa]` for any ordinary member or
 * broker and receive a full session, skipping the member's own 2FA.
 *
 * Owner decision: "Member must link it." New accounts can still be created
 * through the provider, and an identity already linked keeps signing in.
 *
 * Drives the real callback path: signed state + flow from redirectUrl(), a
 * real RS256 ID token checked against a faked JWKS, SsoAuthController, and the
 * one-time code exchange in SocialAuthService.
 */
class F244SsoNoEmailAutoLinkTest extends TestCase
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
        $this->issuer = 'https://93.184.216.34/f244-' . $suffix;
        $this->providerKey = 'f244' . substr($suffix, 0, 6);
        $this->clientId = 'f244-client-' . $suffix;

        DB::table('tenant_sso_providers')->insert([
            'tenant_id' => $this->testTenantId,
            'provider_key' => $this->providerKey,
            'display_name' => 'Community IdP',
            'preset' => 'generic',
            'issuer_url' => $this->issuer,
            'client_id' => $this->clientId,
            'client_secret_encrypted' => null,
            'scopes' => 'openid profile email',
            'allowed_email_domains' => null,
            'auto_provision' => 1,
            'is_enabled' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // F-270: SSO provisioning obeys the community's registration policy,
        // so this test establishes an open community instead of inheriting one.
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'general.registration_mode'],
            ['setting_value' => 'open', 'setting_type' => 'string', 'updated_at' => now()]
        );
        RegistrationPolicyService::upsertPolicy($this->testTenantId, [
            'registration_mode' => 'open',
            'require_email_verify' => false,
        ]);
        app(TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);
    }

    public function test_email_match_to_existing_member_without_totp_does_not_sign_in_or_link(): void
    {
        $member = $this->makeVerifiedUser('member');
        $subject = 'attacker-sub-' . bin2hex(random_bytes(4));

        $query = $this->runCallback([
            'sub' => $subject,
            'email' => $member->email,
            'email_verified' => true,
        ]);

        $this->assertRefusedWithoutLink($query, $subject, $member);
    }

    public function test_email_match_to_existing_member_with_totp_does_not_sign_in_even_with_upstream_mfa(): void
    {
        $member = $this->makeVerifiedUser('member');
        $this->enableTotp($member);
        $subject = 'attacker-mfa-sub-' . bin2hex(random_bytes(4));

        $query = $this->runCallback([
            'sub' => $subject,
            'email' => $member->email,
            'email_verified' => true,
            'amr' => ['pwd', 'mfa'],
            'auth_time' => time() - 5,
        ]);

        $this->assertRefusedWithoutLink($query, $subject, $member);
    }

    public function test_email_match_to_existing_broker_does_not_sign_in_or_link(): void
    {
        $broker = $this->makeVerifiedUser('broker');
        $subject = 'attacker-broker-sub-' . bin2hex(random_bytes(4));

        $query = $this->runCallback([
            'sub' => $subject,
            'email' => $broker->email,
            'email_verified' => true,
            'amr' => ['mfa'],
            'auth_time' => time() - 5,
        ]);

        $this->assertRefusedWithoutLink($query, $subject, $broker);
    }

    public function test_control_new_email_still_creates_an_account_and_signs_in(): void
    {
        $email = 'f244-new-' . bin2hex(random_bytes(4)) . '@example.test';
        $subject = 'new-sub-' . bin2hex(random_bytes(4));

        $query = $this->runCallback([
            'sub' => $subject,
            'email' => $email,
            'email_verified' => true,
            'name' => 'New Person',
        ]);

        $this->assertArrayNotHasKey('error', $query);
        $payload = app(SocialAuthService::class)->consumeCallbackCode($query['code'], self::BROWSER_VERIFIER);
        $this->assertNotEmpty($payload['token'] ?? null);
        $this->assertTrue((bool) $payload['is_new']);

        $user = DB::table('users')->where('tenant_id', $this->testTenantId)->where('email', $email)->first();
        $this->assertNotNull($user);
        $this->assertDatabaseHas('oauth_identities', [
            'user_id' => (int) $user->id,
            'tenant_id' => $this->testTenantId,
            'provider' => $this->identityProvider(),
            'provider_user_id' => $subject,
        ]);
    }

    public function test_control_identity_already_linked_by_the_member_still_signs_in(): void
    {
        $member = $this->makeVerifiedUser('member');
        $subject = 'linked-sub-' . bin2hex(random_bytes(4));
        DB::table('oauth_identities')->insert([
            'user_id' => (int) $member->id,
            'tenant_id' => $this->testTenantId,
            'provider' => $this->identityProvider(),
            'provider_user_id' => $subject,
            'provider_email' => $member->email,
            // As the application stores it: the verified claims, incl. `iss`
            // and `aud` — F-268 refuses a linked row with no recorded issuer.
            'raw_payload' => json_encode(['sub' => $subject, 'iss' => $this->issuer, 'aud' => $this->clientId]),
            'linked_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $query = $this->runCallback([
            'sub' => $subject,
            'email' => $member->email,
            'email_verified' => true,
        ]);

        $this->assertArrayNotHasKey('error', $query);
        $payload = app(SocialAuthService::class)->consumeCallbackCode($query['code'], self::BROWSER_VERIFIER);
        $this->assertNotEmpty($payload['token'] ?? null);
        $this->assertFalse((bool) $payload['is_new']);
        $this->assertSame(
            1,
            DB::table('users')->where('tenant_id', $this->testTenantId)->where('email', $member->email)->count()
        );
    }

    public function test_control_host_approved_provider_still_links_an_existing_member_by_email(): void
    {
        // A provider the platform operator has approved in SSO_PRIVILEGED_PROVIDERS
        // (exact tenant + issuer + client + key) is not community-controlled, so
        // its email linking is unchanged — this is how first sign-in works for
        // an organisation's own staff directory.
        config(['services.sso.privileged_providers' => [[
            'tenant_id' => $this->testTenantId,
            'issuer_url' => $this->issuer,
            'client_id' => $this->clientId,
            'provider_key' => $this->providerKey,
        ]]]);
        $member = $this->makeVerifiedUser('member');
        $subject = 'approved-sub-' . bin2hex(random_bytes(4));

        $query = $this->runCallback([
            'sub' => $subject,
            'email' => $member->email,
            'email_verified' => true,
        ]);

        $this->assertArrayNotHasKey('error', $query);
        $payload = app(SocialAuthService::class)->consumeCallbackCode($query['code'], self::BROWSER_VERIFIER);
        $this->assertNotEmpty($payload['token'] ?? null);
        $this->assertDatabaseHas('oauth_identities', [
            'user_id' => (int) $member->id,
            'tenant_id' => $this->testTenantId,
            'provider' => $this->identityProvider(),
            'provider_user_id' => $subject,
        ]);
    }

    // ------------------------------------------------------------------ helpers

    /**
     * @param array<string,mixed> $query
     */
    private function assertRefusedWithoutLink(array $query, string $subject, User $target): void
    {
        // Since the SSO link flow the refusal carries its own code, so the
        // frontend can tell the person to sign in and link from settings.
        $this->assertSame('sso_link_required', $query['error'] ?? null, 'The callback must refuse, not sign in.');
        $this->assertArrayNotHasKey('code', $query, 'No one-time sign-in code may be issued.');
        $this->assertDatabaseMissing('oauth_identities', [
            'provider' => $this->identityProvider(),
            'provider_user_id' => $subject,
        ]);
        $this->assertSame(
            0,
            DB::table('oauth_identities')->where('user_id', (int) $target->id)->count(),
            'No identity may be bound to the existing account.'
        );
        $this->assertSame(
            1,
            DB::table('users')->where('tenant_id', $this->testTenantId)->where('email', $target->email)->count(),
            'No duplicate account may be provisioned for the existing email.'
        );
    }

    private function makeVerifiedUser(string $role): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'f244-' . $role . '-' . bin2hex(random_bytes(4)) . '@example.test',
            'role' => $role,
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ]);
    }

    private function enableTotp(User $user): void
    {
        DB::table('user_totp_settings')->insert([
            'user_id' => (int) $user->id,
            'tenant_id' => $this->testTenantId,
            'totp_secret_encrypted' => null,
            'is_enabled' => 1,
            'is_pending_setup' => 0,
            'enabled_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function identityProvider(): string
    {
        return 'sso:' . $this->testTenantId . ':' . $this->providerKey;
    }

    /**
     * Start a real flow, answer it with a signed ID token, and return the
     * frontend redirect's query parameters.
     *
     * @param array<string,mixed> $claimOverrides
     * @return array<string,string>
     */
    private function runCallback(array $claimOverrides): array
    {
        [$privateKey, $jwks] = $this->makeKeypairAndJwks('f244-key');
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

        $idToken = JWT::encode(array_replace([
            'iss' => $this->issuer,
            'aud' => $this->clientId,
            'nonce' => (string) $authorizeQuery['nonce'],
            'iat' => time(),
            'exp' => time() + 300,
        ], $claimOverrides), $privateKey, 'RS256', 'f244-key');

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
