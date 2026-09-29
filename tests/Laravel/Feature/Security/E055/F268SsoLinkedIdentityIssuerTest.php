<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E055;

use App\Http\Controllers\Auth\SsoAuthController;
use App\Models\User;
use App\Services\Auth\SocialAuthService;
use App\Services\Auth\SsoOidcService;
use App\Services\TokenService;
use Firebase\JWT\JWT;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-268 — sign-in through an already-linked community SSO identity matched
 * only provider key + `sub`. A community admin who later repoints the
 * provider's issuer (or client) at an IdP they control could mint a token
 * carrying a linked member's opaque `sub` and sign in as that member.
 *
 * A linked identity may now sign in only through the issuer and client it was
 * bound under. Covers all three ways an identity row is created (first-sign-in
 * provisioning, the member's own link flow, and rows written before the
 * binding existed), plus the controls: the unchanged provider keeps working.
 *
 * Drives the real callback path: signed state + flow, real RS256 ID tokens
 * checked against faked JWKS, SsoAuthController and the one-time code exchange.
 */
class F268SsoLinkedIdentityIssuerTest extends TestCase
{
    use DatabaseTransactions;

    private const BROWSER_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    private const BROWSER_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

    private string $issuer;
    private string $attackerIssuer;
    private string $providerKey;
    private string $clientId;
    private string $idToken = '';
    /** @var array<string, \OpenSSLAsymmetricKey> signing key per IdP base URL */
    private array $keys = [];
    private int $adminId;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        config(['services.sso.privileged_providers' => []]);

        $suffix = bin2hex(random_bytes(4));
        $this->issuer = 'https://93.184.216.34/f268-idp-' . $suffix;
        $this->attackerIssuer = 'https://93.184.216.34/f268-rogue-' . $suffix;
        $this->providerKey = 'f268' . substr($suffix, 0, 6);
        $this->clientId = 'f268-client-' . $suffix;

        $this->adminId = (int) User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'admin',
            'status' => 'active',
            'is_approved' => true,
        ])->id;

        // The legitimate IdP advertises itself; the admin's rogue IdP by
        // default advertises itself too (spoofing variants override it).
        $this->fakeIdp($this->issuer, $this->issuer);
        $this->fakeIdp($this->attackerIssuer, $this->attackerIssuer);

        $this->configureProvider($this->issuer, $this->clientId);
    }

    // --------------------------------------------------- provisioned identity

    public function test_provisioned_identity_refuses_a_token_from_a_repointed_issuer(): void
    {
        [$userId, $subject, $email] = $this->provisionThroughLegitimateIdp();

        // Control: the unchanged provider signs the new account in again.
        $again = $this->login($this->issuer, ['sub' => $subject, 'email' => $email, 'email_verified' => true]);
        $this->assertSignedInAs($again, $userId);

        // The admin repoints the provider at an issuer they control.
        $this->configureProvider($this->attackerIssuer, $this->clientId);
        $forged = $this->login($this->attackerIssuer, [
            'iss' => $this->attackerIssuer,
            'sub' => $subject,
            'email' => $email,
            'email_verified' => true,
            'amr' => ['mfa'],
        ]);

        $this->assertRefused($forged);
    }

    public function test_repointed_issuer_that_advertises_the_original_issuer_is_refused(): void
    {
        [, $subject, $email] = $this->provisionThroughLegitimateIdp();

        // The rogue discovery document claims to be the original issuer and
        // its token carries the original `iss` — but it is served from, and
        // signed by, the admin's own host.
        $this->fakeIdp($this->attackerIssuer . '/spoof', $this->issuer);
        $this->configureProvider($this->attackerIssuer . '/spoof', $this->clientId);
        $forged = $this->login($this->attackerIssuer . '/spoof', [
            'iss' => $this->issuer,
            'sub' => $subject,
            'email' => $email,
            'email_verified' => true,
        ]);

        $this->assertRefused($forged);
    }

    public function test_changed_client_id_refuses_the_linked_identity(): void
    {
        [, $subject, $email] = $this->provisionThroughLegitimateIdp();

        $this->configureProvider($this->issuer, 'f268-other-client');
        $forged = $this->login($this->issuer, [
            'aud' => 'f268-other-client',
            'sub' => $subject,
            'email' => $email,
            'email_verified' => true,
        ]);

        $this->assertRefused($forged);
    }

    // -------------------------------------------------- member's link flow

    public function test_identity_linked_by_the_member_refuses_a_repointed_issuer(): void
    {
        $member = $this->makeVerifiedUser();
        $subject = 'f268-linked-' . bin2hex(random_bytes(4));

        $flow = $this->startLink($member);
        $linked = $this->runCallback($this->issuer, $flow, [
            'sub' => $subject,
            'email' => 'idp-' . bin2hex(random_bytes(4)) . '@example.test',
            'email_verified' => true,
        ]);
        $this->assertSame('link', $linked['intent'] ?? null);
        app(SocialAuthService::class)->consumeCallbackCode($linked['code'], self::BROWSER_VERIFIER);

        // Control: the unchanged provider signs the member in.
        $ok = $this->login($this->issuer, ['sub' => $subject, 'email' => $member->email, 'email_verified' => true]);
        $this->assertSignedInAs($ok, (int) $member->id);

        $this->configureProvider($this->attackerIssuer, $this->clientId);
        $forged = $this->login($this->attackerIssuer, [
            'iss' => $this->attackerIssuer,
            'sub' => $subject,
            'email' => $member->email,
            'email_verified' => true,
        ]);

        $this->assertRefused($forged);
    }

    // ------------------------------------ rows written before the binding existed

    public function test_legacy_identity_signs_in_through_the_unchanged_issuer_and_is_then_bound(): void
    {
        $member = $this->makeVerifiedUser();
        $subject = 'f268-legacy-ok-' . bin2hex(random_bytes(4));
        $this->insertLegacyIdentity($member, $subject, $this->issuer);

        $ok = $this->login($this->issuer, ['sub' => $subject, 'email' => $member->email, 'email_verified' => true]);
        $this->assertSignedInAs($ok, (int) $member->id);

        $stored = json_decode((string) DB::table('oauth_identities')
            ->where('provider', $this->identityProvider())
            ->where('provider_user_id', $subject)
            ->value('raw_payload'), true);
        $this->assertSame([
            'issuer_url' => $this->issuer,
            'client_id' => $this->clientId,
            'iss' => $this->issuer,
        ], $stored['nexus_sso_binding'] ?? null, 'The first good sign-in records the binding.');

        // The issuer is now recorded, so a later repoint is refused.
        $this->configureProvider($this->attackerIssuer, $this->clientId);
        $forged = $this->login($this->attackerIssuer, [
            'iss' => $this->attackerIssuer,
            'sub' => $subject,
            'email' => $member->email,
            'email_verified' => true,
        ]);
        $this->assertRefused($forged);
    }

    public function test_legacy_identity_refuses_a_repointed_issuer(): void
    {
        $member = $this->makeVerifiedUser();
        $subject = 'f268-legacy-' . bin2hex(random_bytes(4));
        $this->insertLegacyIdentity($member, $subject, $this->issuer);

        $this->configureProvider($this->attackerIssuer, $this->clientId);
        $forged = $this->login($this->attackerIssuer, [
            'iss' => $this->attackerIssuer,
            'sub' => $subject,
            'email' => $member->email,
            'email_verified' => true,
        ]);
        $this->assertRefused($forged);

        // Spoofed variant: the rogue discovery claims the original issuer.
        $this->fakeIdp($this->attackerIssuer . '/spoof', $this->issuer);
        $this->configureProvider($this->attackerIssuer . '/spoof', $this->clientId);
        $spoofed = $this->login($this->attackerIssuer . '/spoof', [
            'iss' => $this->issuer,
            'sub' => $subject,
            'email' => $member->email,
            'email_verified' => true,
        ]);
        $this->assertRefused($spoofed);
    }

    public function test_legacy_identity_with_no_recorded_issuer_is_refused(): void
    {
        $member = $this->makeVerifiedUser();
        $subject = 'f268-noiss-' . bin2hex(random_bytes(4));
        DB::table('oauth_identities')->insert([
            'user_id' => (int) $member->id,
            'tenant_id' => $this->testTenantId,
            'provider' => $this->identityProvider(),
            'provider_user_id' => $subject,
            'provider_email' => $member->email,
            'raw_payload' => json_encode(['sub' => $subject]),
            'linked_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->assertRefused(
            $this->login($this->issuer, ['sub' => $subject, 'email' => $member->email, 'email_verified' => true])
        );
    }

    // ------------------------------------------------------------------ helpers

    /**
     * @return array{0:int, 1:string, 2:string} user id, subject, email
     */
    private function provisionThroughLegitimateIdp(): array
    {
        $email = 'f268-new-' . bin2hex(random_bytes(4)) . '@example.test';
        $subject = 'f268-sub-' . bin2hex(random_bytes(4));

        $query = $this->login($this->issuer, [
            'sub' => $subject,
            'email' => $email,
            'email_verified' => true,
            'name' => 'New Person',
        ]);
        $this->assertArrayNotHasKey('error', $query);
        $payload = app(SocialAuthService::class)->consumeCallbackCode($query['code'], self::BROWSER_VERIFIER);
        $this->assertTrue((bool) $payload['is_new']);

        $userId = (int) DB::table('users')
            ->where('tenant_id', $this->testTenantId)
            ->where('email', $email)
            ->value('id');
        $this->assertGreaterThan(0, $userId);

        return [$userId, $subject, $email];
    }

    /**
     * @param array<string,string> $query
     */
    private function assertSignedInAs(array $query, int $userId): void
    {
        $this->assertArrayNotHasKey('error', $query);
        $payload = app(SocialAuthService::class)->consumeCallbackCode($query['code'], self::BROWSER_VERIFIER);
        $this->assertFalse((bool) $payload['is_new']);
        $token = app(TokenService::class)->validateToken((string) $payload['token']);
        $this->assertIsArray($token);
        $this->assertSame($userId, (int) ($token['user_id'] ?? 0));
    }

    /**
     * @param array<string,string> $query
     */
    private function assertRefused(array $query): void
    {
        $this->assertSame('sso_failed', $query['error'] ?? null, 'A linked identity must not sign in through another issuer or client.');
        $this->assertArrayNotHasKey('code', $query, 'No one-time sign-in code may be issued.');
    }

    /** Admin edit through the real service, as the admin panel does it. */
    private function configureProvider(string $issuerUrl, string $clientId): void
    {
        app(SsoOidcService::class)->upsert($this->testTenantId, [
            'provider_key' => $this->providerKey,
            'display_name' => 'Community IdP',
            'preset' => 'generic',
            'issuer_url' => $issuerUrl,
            'client_id' => $clientId,
            'scopes' => 'openid profile email',
            'auto_provision' => true,
            'is_enabled' => true,
        ], $this->adminId);
    }

    /** A row exactly as the pre-binding code wrote it: the verified ID-token claims. */
    private function insertLegacyIdentity(User $user, string $subject, string $issuer): void
    {
        DB::table('oauth_identities')->insert([
            'user_id' => (int) $user->id,
            'tenant_id' => $this->testTenantId,
            'provider' => $this->identityProvider(),
            'provider_user_id' => $subject,
            'provider_email' => $user->email,
            'raw_payload' => json_encode([
                'iss' => $issuer,
                'aud' => $this->clientId,
                'sub' => $subject,
                'email' => $user->email,
                'email_verified' => true,
                'iat' => time() - 86400,
                'exp' => time() - 86100,
            ]),
            'linked_at' => now()->subDay(),
            'created_at' => now()->subDay(),
            'updated_at' => now()->subDay(),
        ]);
    }

    private function fakeIdp(string $base, string $advertisedIssuer): void
    {
        $kid = 'f268-' . substr(hash('sha256', $base), 0, 8);
        [$this->keys[$base], $jwks] = $this->makeKeypairAndJwks($kid);
        Http::fake([
            $base . '/.well-known/openid-configuration' => Http::response([
                'issuer' => $advertisedIssuer,
                'authorization_endpoint' => $base . '/authorize',
                'token_endpoint' => $base . '/token',
                'jwks_uri' => $base . '/keys',
            ]),
            $base . '/keys' => Http::response($jwks),
            $base . '/token' => fn () => Http::response(['id_token' => $this->idToken]),
        ]);
    }

    /**
     * Run an ordinary "Sign in with <provider>" against the IdP at $base.
     *
     * @param array<string,mixed> $claims
     * @return array<string,string>
     */
    private function login(string $base, array $claims): array
    {
        $redirect = app(SsoOidcService::class)->redirectUrl(
            $this->testTenantId,
            $this->providerKey,
            self::BROWSER_CHALLENGE
        );
        parse_str((string) parse_url($redirect['url'], PHP_URL_QUERY), $authorizeQuery);

        return $this->runCallback(
            $base,
            ['state' => $redirect['state'], 'nonce' => (string) $authorizeQuery['nonce']],
            $claims
        );
    }

    /**
     * @return array{state:string, nonce:string}
     */
    private function startLink(User $member): array
    {
        Sanctum::actingAs($member);
        $confirmation = app(TokenService::class)->generateSecurityConfirmationToken(
            (int) $member->id,
            $this->testTenantId,
            'password'
        );
        $response = $this->apiPost('/v2/auth/sso/' . $this->providerKey . '/link', [
            'browser_challenge' => self::BROWSER_CHALLENGE,
            'security_confirmation_token' => $confirmation,
        ])->assertOk();

        parse_str((string) parse_url((string) $response->json('redirect_url'), PHP_URL_QUERY), $authorizeQuery);

        return ['state' => (string) $authorizeQuery['state'], 'nonce' => (string) $authorizeQuery['nonce']];
    }

    /**
     * @param array{state:string, nonce:string} $flow
     * @param array<string,mixed> $claims
     * @return array<string,string>
     */
    private function runCallback(string $base, array $flow, array $claims): array
    {
        $kid = 'f268-' . substr(hash('sha256', $base), 0, 8);
        $this->idToken = JWT::encode(array_replace([
            'iss' => $this->issuer,
            'aud' => $this->clientId,
            'nonce' => $flow['nonce'],
            'iat' => time(),
            'exp' => time() + 300,
        ], $claims), $this->keys[$base], 'RS256', $kid);

        $controller = new SsoAuthController(app(SsoOidcService::class), app(SocialAuthService::class));
        $response = $controller->callback(Request::create('/api/v2/auth/sso/callback', 'GET', [
            'state' => $flow['state'],
            'code' => 'authorization-code',
        ]));

        parse_str((string) parse_url($response->getTargetUrl(), PHP_URL_QUERY), $query);

        return $query;
    }

    private function makeVerifiedUser(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'f268-member-' . bin2hex(random_bytes(4)) . '@example.test',
            'role' => 'member',
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ]);
    }

    private function identityProvider(): string
    {
        return 'sso:' . $this->testTenantId . ':' . $this->providerKey;
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
