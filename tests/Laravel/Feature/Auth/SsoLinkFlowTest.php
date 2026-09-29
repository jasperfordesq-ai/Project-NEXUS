<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Auth;

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
 * Community SSO link flow (follow-up to F-244 / E-060).
 *
 * F-244 stopped community-configured OIDC providers from claiming an existing
 * account by email. The owner's decision: an existing member may use such a
 * provider only after linking it themselves while signed in. This drives that
 * flow end to end — the authenticated link start (with the F-056 fresh
 * security confirmation), a signed link-intent state, a real RS256 ID token
 * checked against a faked JWKS, the single SSO callback, and the browser-bound
 * one-time code exchange — and proves the link binds the provider subject to
 * the member named in the state, never to whoever owns the asserted email.
 */
class SsoLinkFlowTest extends TestCase
{
    use DatabaseTransactions;

    private const BROWSER_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    private const BROWSER_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    private const KID = 'sso-link-key';

    private string $issuer;
    private string $providerKey;
    private string $clientId;
    private string $idToken = '';
    /** @var \OpenSSLAsymmetricKey */
    private $privateKey;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        config(['services.sso.privileged_providers' => []]);

        $suffix = bin2hex(random_bytes(4));
        $this->issuer = 'https://93.184.216.34/sso-link-' . $suffix;
        $this->providerKey = 'lnk' . substr($suffix, 0, 6);
        $this->clientId = 'sso-link-client-' . $suffix;

        $this->insertProvider($this->testTenantId, $this->providerKey, $this->issuer, $this->clientId);

        [$this->privateKey, $jwks] = $this->makeKeypairAndJwks(self::KID);
        Http::fake([
            $this->issuer . '/.well-known/openid-configuration' => Http::response([
                'issuer' => $this->issuer,
                'authorization_endpoint' => $this->issuer . '/authorize',
                'token_endpoint' => $this->issuer . '/token',
                'jwks_uri' => $this->issuer . '/keys',
            ]),
            $this->issuer . '/keys' => Http::response($jwks),
            $this->issuer . '/token' => fn () => Http::response(['id_token' => $this->idToken]),
        ]);
    }

    // ------------------------------------------------------------ link start

    public function test_link_requires_sign_in(): void
    {
        $this->apiPost('/v2/auth/sso/' . $this->providerKey . '/link', [
            'browser_challenge' => self::BROWSER_CHALLENGE,
        ])->assertStatus(401)->assertJsonMissingPath('redirect_url');
    }

    public function test_link_requires_a_fresh_security_confirmation_for_this_member(): void
    {
        $member = $this->makeVerifiedUser('member');
        $other = $this->makeVerifiedUser('member');
        Sanctum::actingAs($member);

        $this->apiPost('/v2/auth/sso/' . $this->providerKey . '/link', [
            'browser_challenge' => self::BROWSER_CHALLENGE,
        ])->assertStatus(403)
            ->assertJsonPath('errors.0.code', 'SECURITY_CONFIRMATION_REQUIRED')
            ->assertJsonMissingPath('redirect_url');

        // Another member's proof does not unlock this account.
        $this->apiPost('/v2/auth/sso/' . $this->providerKey . '/link', [
            'browser_challenge' => self::BROWSER_CHALLENGE,
            'security_confirmation_token' => $this->confirmationToken($other),
        ])->assertStatus(403)->assertJsonMissingPath('redirect_url');

        // An ordinary access token is not a security confirmation.
        $access = app(TokenService::class)->generateToken((int) $member->id, $this->testTenantId);
        $this->apiPost('/v2/auth/sso/' . $this->providerKey . '/link', [
            'browser_challenge' => self::BROWSER_CHALLENGE,
            'security_confirmation_token' => $access,
        ])->assertStatus(403)->assertJsonMissingPath('redirect_url');
    }

    public function test_provider_of_another_community_cannot_be_linked(): void
    {
        $member = $this->makeVerifiedUser('member');
        $foreignKey = 'fx' . bin2hex(random_bytes(3));
        $this->insertProvider(
            $this->testTenantId + 1000,
            $foreignKey,
            'https://93.184.216.34/foreign-' . $foreignKey,
            'foreign-client'
        );
        Sanctum::actingAs($member);

        $this->apiPost('/v2/auth/sso/' . $foreignKey . '/link', [
            'browser_challenge' => self::BROWSER_CHALLENGE,
            'security_confirmation_token' => $this->confirmationToken($member),
        ])->assertStatus(400)
            ->assertJsonPath('error', 'sso_link_failed')
            ->assertJsonMissingPath('redirect_url');
    }

    // ------------------------------------------------------------- callback

    public function test_successful_link_binds_subject_to_state_user_and_sso_sign_in_then_works(): void
    {
        $member = $this->makeVerifiedUser('member');
        $subject = 'link-sub-' . bin2hex(random_bytes(4));

        $flow = $this->startLink($member);
        $query = $this->runCallback($flow, [
            'sub' => $subject,
            // The IdP's email is deliberately unrelated to the member's: the
            // link binds to the signed-in member, never by email.
            'email' => 'idp-' . bin2hex(random_bytes(4)) . '@example.test',
            'email_verified' => true,
        ]);

        $this->assertArrayNotHasKey('error', $query);
        $this->assertSame('link', $query['intent'] ?? null);
        $this->assertSame('sso:' . $this->providerKey, $query['provider'] ?? null);
        $this->assertSame(self::BROWSER_CHALLENGE, $query['flow'] ?? null);

        $payload = app(SocialAuthService::class)->consumeCallbackCode($query['code'], self::BROWSER_VERIFIER);
        $this->assertSame((int) $member->id, $this->tokenUserId((string) $payload['token']));
        $this->assertFalse((bool) $payload['is_new']);

        $identity = DB::table('oauth_identities')
            ->where('tenant_id', $this->testTenantId)
            ->where('provider', $this->identityProvider())
            ->where('provider_user_id', $subject)
            ->first();
        $this->assertNotNull($identity);
        $this->assertSame((int) $member->id, (int) $identity->user_id);
        $stored = json_decode((string) $identity->raw_payload, true);
        $this->assertSame($this->issuer, $stored['iss'] ?? null, 'The issuer is recorded with the subject.');

        // Afterwards ordinary "Sign in with <provider>" resolves the member
        // through the linked-identity path — no F-244 refusal.
        $login = $this->runLoginCallback([
            'sub' => $subject,
            'email' => $member->email,
            'email_verified' => true,
        ]);
        $this->assertArrayNotHasKey('error', $login);
        $this->assertArrayNotHasKey('intent', $login);
        $loginPayload = app(SocialAuthService::class)->consumeCallbackCode($login['code'], self::BROWSER_VERIFIER);
        $this->assertSame((int) $member->id, $this->tokenUserId((string) $loginPayload['token']));
    }

    public function test_link_callback_issues_no_credentials_and_never_uses_email_matching(): void
    {
        $member = $this->makeVerifiedUser('member');
        $emailOwner = $this->makeVerifiedUser('member');
        $subject = 'link-owner-sub-' . bin2hex(random_bytes(4));

        $flow = $this->startLink($member);
        $query = $this->runCallback($flow, [
            'sub' => $subject,
            'email' => $emailOwner->email,
            'email_verified' => true,
            'amr' => ['mfa'],
            'auth_time' => time() - 5,
        ]);

        $this->assertArrayNotHasKey('error', $query);
        foreach (['token', 'access_token', 'refresh_token'] as $credential) {
            $this->assertArrayNotHasKey($credential, $query);
        }
        // The callback publishes only a pending, browser-bound link context:
        // nothing is bound and no credential exists until the initiating tab
        // proves possession of the verifier.
        $pending = Cache::get('oauth:callback-code:' . hash('sha256', $query['code']));
        $this->assertIsArray($pending);
        $this->assertSame('pending_identity', $pending['kind'] ?? null);
        $this->assertArrayNotHasKey('token', $pending);
        $this->assertSame((int) $member->id, (int) ($pending['pending_issuance']['user_id'] ?? 0));
        $this->assertFalse((bool) ($pending['pending_issuance']['upstream_mfa_verified'] ?? true));
        $this->assertDatabaseMissing('oauth_identities', [
            'provider' => $this->identityProvider(),
            'provider_user_id' => $subject,
        ]);

        $payload = app(SocialAuthService::class)->consumeCallbackCode($query['code'], self::BROWSER_VERIFIER);
        $this->assertSame((int) $member->id, $this->tokenUserId((string) $payload['token']));
        $this->assertSame(
            0,
            DB::table('oauth_identities')->where('user_id', (int) $emailOwner->id)->count(),
            'The owner of the asserted email must never receive the identity.'
        );
        $this->assertDatabaseHas('oauth_identities', [
            'user_id' => (int) $member->id,
            'provider' => $this->identityProvider(),
            'provider_user_id' => $subject,
        ]);
    }

    public function test_identity_already_linked_to_another_account_is_refused(): void
    {
        $member = $this->makeVerifiedUser('member');
        $owner = $this->makeVerifiedUser('member');
        $subject = 'taken-sub-' . bin2hex(random_bytes(4));
        $this->insertIdentity($owner, $subject);

        $flow = $this->startLink($member);
        $query = $this->runCallback($flow, [
            'sub' => $subject,
            'email' => $member->email,
            'email_verified' => true,
        ]);

        $this->assertSame('sso_identity_in_use', $query['error'] ?? null);
        $this->assertSame('link', $query['intent'] ?? null);
        $this->assertArrayNotHasKey('code', $query);
        $this->assertSame(
            (int) $owner->id,
            (int) DB::table('oauth_identities')
                ->where('provider', $this->identityProvider())
                ->where('provider_user_id', $subject)
                ->value('user_id')
        );
        $this->assertSame(0, DB::table('oauth_identities')->where('user_id', (int) $member->id)->count());
    }

    public function test_link_state_replay_is_refused(): void
    {
        $member = $this->makeVerifiedUser('member');
        $subject = 'replay-sub-' . bin2hex(random_bytes(4));
        $flow = $this->startLink($member);
        $claims = ['sub' => $subject, 'email' => $member->email, 'email_verified' => true];

        $first = $this->runCallback($flow, $claims);
        $this->assertArrayHasKey('code', $first);

        $replay = $this->runCallback($flow, $claims);
        $this->assertSame('sso_link_failed', $replay['error'] ?? null);
        $this->assertArrayNotHasKey('code', $replay);
    }

    public function test_link_is_refused_when_the_provider_changed_after_the_link_started(): void
    {
        $member = $this->makeVerifiedUser('member');
        $flow = $this->startLink($member);

        // A community admin repoints the provider while the member is away at
        // the IdP: the callback must not bind an identity from the new issuer.
        DB::table('tenant_sso_providers')
            ->where('tenant_id', $this->testTenantId)
            ->where('provider_key', $this->providerKey)
            ->update(['client_id' => 'repointed-client']);

        $query = $this->runCallback($flow, [
            'sub' => 'changed-sub',
            'email' => $member->email,
            'email_verified' => true,
            'aud' => 'repointed-client',
        ]);

        $this->assertSame('sso_link_failed', $query['error'] ?? null);
        $this->assertArrayNotHasKey('code', $query);
        $this->assertSame(0, DB::table('oauth_identities')->where('user_id', (int) $member->id)->count());
    }

    public function test_link_is_refused_when_the_state_user_is_no_longer_active(): void
    {
        $member = $this->makeVerifiedUser('member');
        $flow = $this->startLink($member);
        DB::table('users')->where('id', (int) $member->id)->update(['status' => 'suspended']);

        $query = $this->runCallback($flow, [
            'sub' => 'suspended-sub',
            'email' => $member->email,
            'email_verified' => true,
        ]);

        $this->assertSame('sso_link_failed', $query['error'] ?? null);
        $this->assertArrayNotHasKey('code', $query);
        $this->assertSame(0, DB::table('oauth_identities')->where('user_id', (int) $member->id)->count());
    }

    public function test_link_state_cannot_be_used_as_a_login_state_and_vice_versa(): void
    {
        $member = $this->makeVerifiedUser('member');
        $sso = app(SsoOidcService::class);

        $flow = $this->startLink($member);
        try {
            $sso->handleCallback($flow['state'], 'authorization-code');
            $this->fail('A link state must not complete a sign-in.');
        } catch (\RuntimeException) {
            // expected
        }
        // Nor may a community SSO link state pose as a Google/Facebook state.
        $this->assertNull(app(SocialAuthService::class)->stateContext($flow['state']));

        $login = $sso->redirectUrl($this->testTenantId, $this->providerKey, self::BROWSER_CHALLENGE);
        try {
            $sso->handleLinkCallback($login['state'], 'authorization-code');
            $this->fail('A sign-in state must not complete a link.');
        } catch (\RuntimeException) {
            // expected
        }

        // Refusing on intent must not burn the flow: the genuine link can
        // still complete.
        $query = $this->runCallback($flow, [
            'sub' => 'intent-sub-' . bin2hex(random_bytes(4)),
            'email' => $member->email,
            'email_verified' => true,
        ]);
        $this->assertArrayHasKey('code', $query);
    }

    // ------------------------------------------------------------ F-244 code

    public function test_f244_refusal_now_tells_the_person_to_link_from_settings(): void
    {
        $member = $this->makeVerifiedUser('member');
        $subject = 'f244-sub-' . bin2hex(random_bytes(4));

        $query = $this->runLoginCallback([
            'sub' => $subject,
            'email' => $member->email,
            'email_verified' => true,
        ]);

        $this->assertSame('sso_link_required', $query['error'] ?? null);
        $this->assertSame(__('api.sso_account_exists_link_required'), $query['message'] ?? null);
        $this->assertArrayNotHasKey('code', $query);
        $this->assertSame(0, DB::table('oauth_identities')->where('user_id', (int) $member->id)->count());
    }

    public function test_provisioning_disabled_gives_the_same_code_so_it_is_not_an_existence_oracle(): void
    {
        DB::table('tenant_sso_providers')
            ->where('tenant_id', $this->testTenantId)
            ->where('provider_key', $this->providerKey)
            ->update(['auto_provision' => 0]);

        $query = $this->runLoginCallback([
            'sub' => 'nobody-sub-' . bin2hex(random_bytes(4)),
            'email' => 'nobody-' . bin2hex(random_bytes(4)) . '@example.test',
            'email_verified' => true,
        ]);

        $this->assertSame('sso_link_required', $query['error'] ?? null);
        $this->assertArrayNotHasKey('code', $query);
    }

    public function test_other_sso_failures_keep_the_generic_code(): void
    {
        $query = $this->runLoginCallback([
            'sub' => 'unverified-sub-' . bin2hex(random_bytes(4)),
            'email' => 'unverified-' . bin2hex(random_bytes(4)) . '@example.test',
            'email_verified' => false,
        ]);

        $this->assertSame('sso_failed', $query['error'] ?? null);
    }

    // ------------------------------------------------------- list and unlink

    public function test_connected_accounts_lists_community_sso_providers_and_link_state(): void
    {
        $member = $this->makeVerifiedUser('member');
        $subject = 'listed-sub-' . bin2hex(random_bytes(4));
        $this->insertIdentity($member, $subject);
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/auth/oauth/me/identities')->assertOk();

        // Existing Google/Facebook consumers keep their shape.
        $response->assertJsonStructure(['identities', 'enabled_providers', 'supported_providers', 'sso_providers']);
        $this->assertSame(['google', 'facebook'], $response->json('supported_providers'));

        $entry = collect($response->json('sso_providers'))->firstWhere('key', $this->providerKey);
        $this->assertNotNull($entry);
        $this->assertSame('Community IdP', $entry['display_name']);
        $this->assertTrue($entry['linked']);
        $this->assertSame($member->email, $entry['provider_email']);
    }

    public function test_member_can_unlink_a_community_sso_identity(): void
    {
        $member = $this->makeVerifiedUser('member');
        DB::table('users')->where('id', (int) $member->id)->update([
            'password_hash' => password_hash('correct horse battery', PASSWORD_BCRYPT),
        ]);
        $this->insertIdentity($member, 'unlink-sub-' . bin2hex(random_bytes(4)));
        Sanctum::actingAs($member);

        $this->apiDelete('/v2/auth/sso/' . $this->providerKey . '/unlink')
            ->assertOk()
            ->assertJsonPath('success', true);

        $this->assertSame(
            0,
            DB::table('oauth_identities')
                ->where('user_id', (int) $member->id)
                ->where('provider', $this->identityProvider())
                ->count()
        );
    }

    // ------------------------------------------------------------------ helpers

    private function insertProvider(int $tenantId, string $key, string $issuer, string $clientId): void
    {
        DB::table('tenant_sso_providers')->insert([
            'tenant_id' => $tenantId,
            'provider_key' => $key,
            'display_name' => 'Community IdP',
            'preset' => 'generic',
            'issuer_url' => $issuer,
            'client_id' => $clientId,
            'client_secret_encrypted' => null,
            'scopes' => 'openid profile email',
            'allowed_email_domains' => null,
            'auto_provision' => 1,
            'is_enabled' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function insertIdentity(User $user, string $subject): void
    {
        DB::table('oauth_identities')->insert([
            'user_id' => (int) $user->id,
            'tenant_id' => $this->testTenantId,
            'provider' => $this->identityProvider(),
            'provider_user_id' => $subject,
            'provider_email' => $user->email,
            'raw_payload' => json_encode(['sub' => $subject, 'iss' => $this->issuer]),
            'linked_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function makeVerifiedUser(string $role): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'sso-link-' . $role . '-' . bin2hex(random_bytes(4)) . '@example.test',
            'role' => $role,
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ]);
    }

    private function confirmationToken(User $user): string
    {
        return app(TokenService::class)->generateSecurityConfirmationToken(
            (int) $user->id,
            $this->testTenantId,
            'password'
        );
    }

    private function identityProvider(): string
    {
        return 'sso:' . $this->testTenantId . ':' . $this->providerKey;
    }

    private function tokenUserId(string $token): int
    {
        $payload = app(TokenService::class)->validateToken($token);
        $this->assertIsArray($payload);

        return (int) ($payload['user_id'] ?? 0);
    }

    /**
     * Start a link as the signed-in member over HTTP and return the signed
     * state plus the OIDC nonce from the provider redirect.
     *
     * @return array{state:string, nonce:string}
     */
    private function startLink(User $member): array
    {
        Sanctum::actingAs($member);
        $response = $this->apiPost('/v2/auth/sso/' . $this->providerKey . '/link', [
            'browser_challenge' => self::BROWSER_CHALLENGE,
            'security_confirmation_token' => $this->confirmationToken($member),
        ])->assertOk()->assertJsonPath('success', true);

        $url = (string) $response->json('redirect_url');
        $this->assertStringStartsWith($this->issuer . '/authorize?', $url);
        parse_str((string) parse_url($url, PHP_URL_QUERY), $authorizeQuery);

        return ['state' => (string) $authorizeQuery['state'], 'nonce' => (string) $authorizeQuery['nonce']];
    }

    /**
     * @param array{state:string, nonce:string} $flow
     * @param array<string,mixed> $claimOverrides
     * @return array<string,string>
     */
    private function runCallback(array $flow, array $claimOverrides): array
    {
        $this->idToken = JWT::encode(array_replace([
            'iss' => $this->issuer,
            'aud' => $this->clientId,
            'nonce' => $flow['nonce'],
            'iat' => time(),
            'exp' => time() + 300,
        ], $claimOverrides), $this->privateKey, 'RS256', self::KID);

        $controller = new SsoAuthController(app(SsoOidcService::class), app(SocialAuthService::class));
        $response = $controller->callback(Request::create('/api/v2/auth/sso/callback', 'GET', [
            'state' => $flow['state'],
            'code' => 'authorization-code',
        ]));

        parse_str((string) parse_url($response->getTargetUrl(), PHP_URL_QUERY), $query);

        return $query;
    }

    /**
     * @param array<string,mixed> $claimOverrides
     * @return array<string,string>
     */
    private function runLoginCallback(array $claimOverrides): array
    {
        $redirect = app(SsoOidcService::class)->redirectUrl(
            $this->testTenantId,
            $this->providerKey,
            self::BROWSER_CHALLENGE
        );
        parse_str((string) parse_url($redirect['url'], PHP_URL_QUERY), $authorizeQuery);

        return $this->runCallback(
            ['state' => $redirect['state'], 'nonce' => (string) $authorizeQuery['nonce']],
            $claimOverrides
        );
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
