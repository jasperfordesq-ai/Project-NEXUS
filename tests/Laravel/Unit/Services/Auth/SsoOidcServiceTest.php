<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services\Auth;

use App\Models\User;
use App\Services\Auth\SsoOidcService;
use Firebase\JWT\JWT;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\Laravel\TestCase;

/**
 * SSO engine (IT-Sec-05) — focused service coverage: state signing,
 * PKCE, domain gating, email extraction, OIDC discovery, and full
 * ID-token validation against a real RS256 keypair.
 */
class SsoOidcServiceTest extends TestCase
{
    use DatabaseTransactions;

    private const BROWSER_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

    private SsoOidcService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = app(SsoOidcService::class);
        Cache::flush();
    }

    private function invokePrivate(string $method, ...$args)
    {
        $ref = new \ReflectionMethod(SsoOidcService::class, $method);
        return $ref->invoke($this->service, ...$args);
    }

    // ------------------------------------------------------------ state

    public function test_state_round_trips(): void
    {
        $state = $this->invokePrivate(
            'buildState',
            7,
            'entra',
            'nonce123',
            self::BROWSER_CHALLENGE
        );
        $payload = $this->invokePrivate('verifyState', $state);

        $this->assertSame(7, $payload['tenant_id']);
        $this->assertSame('entra', $payload['provider_key']);
        $this->assertSame('nonce123', $payload['state_nonce']);
        $this->assertSame(self::BROWSER_CHALLENGE, $payload['browser_challenge']);
        $this->assertGreaterThan(0, $payload['authentication_started_at']);
    }

    public function test_upstream_mfa_requires_explicit_assurance_evidence(): void
    {
        $this->assertFalse($this->service->hasUpstreamMfaAssurance(['amr' => ['pwd']]));
        $this->assertFalse($this->service->hasUpstreamMfaAssurance(['acr' => 'arbitrary-high']));
        $this->assertTrue($this->service->hasUpstreamMfaAssurance(['amr' => ['pwd', 'mfa']]));
        $this->assertFalse($this->service->hasUpstreamMfaAssurance(['amr' => ['otp']]));
        $this->assertFalse($this->service->hasUpstreamMfaAssurance(['amr' => ['hwk']]));
        $this->assertFalse($this->service->hasUpstreamMfaAssurance(['amr' => ['swk']]));
        $this->assertFalse($this->service->hasUpstreamMfaAssurance(['amr' => ['hwk', 'swk']]));
        $this->assertTrue($this->service->hasUpstreamMfaAssurance(['amr' => ['pwd', 'otp']]));
        $this->assertTrue($this->service->hasUpstreamMfaAssurance(['acr' => 'urn:nist:ac:classes:aal2']));
    }

    public function test_state_without_signed_authentication_start_is_rejected(): void
    {
        $body = base64_encode((string) json_encode([
            't' => 7,
            'p' => 'entra',
            'n' => 'nonce123',
            'b' => self::BROWSER_CHALLENGE,
        ]));
        $state = $body . '.' . hash_hmac('sha256', $body, (string) config('app.key'));

        $this->expectExceptionMessage('SSO state token has expired.');
        $this->invokePrivate('verifyState', $state);
    }

    public function test_state_without_browser_challenge_is_rejected(): void
    {
        $body = base64_encode((string) json_encode([
            't' => 7,
            'p' => 'entra',
            'n' => 'nonce123',
            'x' => now()->timestamp,
        ]));
        $state = $body . '.' . hash_hmac('sha256', $body, (string) config('app.key'));

        $this->expectExceptionMessage('OAuth browser challenge is invalid.');
        $this->invokePrivate('verifyState', $state);
    }

    public function test_tampered_state_is_rejected(): void
    {
        $state = $this->invokePrivate(
            'buildState',
            7,
            'entra',
            'nonce123',
            self::BROWSER_CHALLENGE
        );
        [$body, $sig] = explode('.', $state, 2);
        $forged = base64_encode(json_encode(['t' => 999, 'p' => 'entra', 'n' => 'nonce123', 'x' => now()->timestamp]));

        $this->expectExceptionMessage('SSO state signature mismatch.');
        $this->invokePrivate('verifyState', $forged . '.' . $sig);
    }

    // ------------------------------------------------------------ PKCE

    public function test_pkce_challenge_matches_rfc7636_vector(): void
    {
        // RFC 7636 appendix B test vector
        $verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
        $this->assertSame(
            'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
            $this->invokePrivate('pkceChallenge', $verifier)
        );
    }

    // ------------------------------------------------------ domain gating

    public function test_domain_allow_list_blocks_other_domains(): void
    {
        $provider = (object) ['allowed_email_domains' => json_encode(['coventry.gov.uk'])];

        // Allowed domain passes
        $this->invokePrivate('assertDomainAllowed', $provider, 'jane@coventry.gov.uk', true);

        // Different domain is rejected
        $this->expectExceptionMessage(__('api.sso_domain_not_allowed'));
        $this->invokePrivate('assertDomainAllowed', $provider, 'jane@evil.example', true);
    }

    public function test_empty_allow_list_permits_any_domain(): void
    {
        $provider = (object) ['allowed_email_domains' => null];
        $this->invokePrivate('assertDomainAllowed', $provider, 'anyone@anywhere.example', false);
        $this->assertTrue(true);
    }

    public function test_subdomain_does_not_satisfy_allow_list(): void
    {
        $provider = (object) ['allowed_email_domains' => json_encode(['coventry.gov.uk'])];
        $this->expectExceptionMessage(__('api.sso_domain_not_allowed'));
        $this->invokePrivate('assertDomainAllowed', $provider, 'jane@sub.coventry.gov.uk', true);
    }

    public function test_normalise_domains_accepts_csv_and_strips_at(): void
    {
        $this->assertSame(
            ['coventry.gov.uk', 'example.org'],
            $this->invokePrivate('normaliseDomains', "@Coventry.gov.uk, example.org\n coventry.gov.uk")
        );
        $this->assertSame([], $this->invokePrivate('normaliseDomains', 'not a domain'));
    }

    // ------------------------------------------------------------ claims

    public function test_extract_email_only_trusts_the_email_claim(): void
    {
        // The verified `email` claim is honoured (lower-cased)...
        $this->assertSame('a@b.example', $this->invokePrivate('extractEmail', ['email' => 'A@b.example', 'preferred_username' => 'x@y.example']));
        // ...but preferred_username / upn are owner-mutable login hints and
        // MUST NOT be treated as an email identity (nOAuth takeover vector).
        $this->assertNull($this->invokePrivate('extractEmail', ['preferred_username' => 'x@y.example']));
        $this->assertNull($this->invokePrivate('extractEmail', ['upn' => 'x@y.example']));
        $this->assertNull($this->invokePrivate('extractEmail', ['email' => 'not-an-email']));
    }

    public function test_email_verified_claim_parsing_fails_closed(): void
    {
        $this->assertTrue($this->invokePrivate('emailIsVerified', ['email_verified' => true]));
        $this->assertFalse($this->invokePrivate('emailIsVerified', ['email_verified' => 'true']));
        $this->assertFalse($this->invokePrivate('emailIsVerified', ['email_verified' => 1]));
        // Absent or false → unverified (fail closed).
        $this->assertFalse($this->invokePrivate('emailIsVerified', []));
        $this->assertFalse($this->invokePrivate('emailIsVerified', ['email_verified' => false]));
        $this->assertFalse($this->invokePrivate('emailIsVerified', ['email_verified' => 'false']));
        $this->assertFalse($this->invokePrivate('emailIsVerified', ['email_verified' => 0]));
    }

    public function test_signed_unverified_email_is_rejected_by_allowed_domain_gate(): void
    {
        $claims = $this->validatedSignedClaims([
            'sub' => 'unverified-domain-subject',
            'email' => 'attacker@coventry.gov.uk',
            'email_verified' => false,
        ]);
        $email = $this->invokePrivate('extractEmail', $claims);
        $emailVerified = $this->invokePrivate('emailIsVerified', $claims);

        $this->assertSame('attacker@coventry.gov.uk', $email);
        $this->assertFalse($emailVerified);

        $provider = (object) [
            'allowed_email_domains' => json_encode(['coventry.gov.uk']),
        ];
        $this->expectExceptionMessage(__('api.sso_domain_not_allowed'));
        $this->invokePrivate('assertDomainAllowed', $provider, $email, $emailVerified);
    }

    public function test_signed_verified_allowed_domain_claim_can_auto_provision(): void
    {
        $email = 'verified-' . bin2hex(random_bytes(6)) . '@coventry.gov.uk';
        $subject = 'verified-subject-' . bin2hex(random_bytes(6));
        $claims = $this->validatedSignedClaims([
            'sub' => $subject,
            'email' => $email,
            'email_verified' => true,
            'name' => 'Verified Member',
        ]);
        $extractedEmail = $this->invokePrivate('extractEmail', $claims);
        $emailVerified = $this->invokePrivate('emailIsVerified', $claims);
        $provider = (object) [
            'tenant_id' => $this->testTenantId,
            'provider_key' => 'entra-verified',
            'allowed_email_domains' => json_encode(['coventry.gov.uk']),
            'auto_provision' => true,
        ];

        $this->assertTrue($emailVerified);
        $this->invokePrivate('assertDomainAllowed', $provider, $extractedEmail, $emailVerified);
        $result = $this->invokePrivate(
            'findOrCreateFromClaims',
            $provider,
            $claims,
            $extractedEmail,
            $emailVerified,
            time()
        );

        $this->assertTrue($result['is_new']);
        $this->assertSame($this->testTenantId, (int) $result['user']->tenant_id);
        $this->assertSame($email, $result['user']->email);
        $this->assertDatabaseHas('oauth_identities', [
            'user_id' => (int) $result['user']->id,
            'tenant_id' => $this->testTenantId,
            'provider' => 'sso:' . $this->testTenantId . ':entra-verified',
            'provider_user_id' => $subject,
            'provider_email' => $email,
        ]);
    }

    public function test_signed_unverified_email_cannot_auto_provision_without_domain_gate(): void
    {
        $email = 'unverified-' . bin2hex(random_bytes(6)) . '@example.test';
        $claims = $this->validatedSignedClaims([
            'sub' => 'unverified-provision-subject-' . bin2hex(random_bytes(6)),
            'email' => $email,
            'email_verified' => false,
        ]);
        $provider = (object) [
            'tenant_id' => $this->testTenantId,
            'provider_key' => 'entra-unverified',
            'allowed_email_domains' => null,
            'auto_provision' => true,
        ];
        $extractedEmail = $this->invokePrivate('extractEmail', $claims);
        $emailVerified = $this->invokePrivate('emailIsVerified', $claims);

        // An empty allow-list does not make an email ownership decision, but
        // provisioning still must require the verified issuer assertion.
        $this->invokePrivate('assertDomainAllowed', $provider, $extractedEmail, $emailVerified);
        try {
            $this->invokePrivate(
                'findOrCreateFromClaims',
                $provider,
                $claims,
                $extractedEmail,
                $emailVerified,
                time()
            );
            $this->fail('An unverified email claim must not auto-provision a user.');
        } catch (\RuntimeException $e) {
            $this->assertSame(__('api.sso_login_failed'), $e->getMessage());
        }

        $this->assertDatabaseMissing('users', [
            'tenant_id' => $this->testTenantId,
            'email' => $email,
        ]);
    }

    public function test_existing_tenant_subject_survives_unverified_email_without_metadata_rebind(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();
        $providerKey = 'entra-existing';
        $identityProvider = 'sso:' . $this->testTenantId . ':' . $providerKey;
        $subject = 'existing-subject-' . bin2hex(random_bytes(6));
        $trustedEmail = 'trusted-' . bin2hex(random_bytes(6)) . '@example.test';
        $trustedPayload = ['email' => $trustedEmail, 'email_verified' => true];
        DB::table('oauth_identities')->insert([
            'user_id' => (int) $user->id,
            'tenant_id' => $this->testTenantId,
            'provider' => $identityProvider,
            'provider_user_id' => $subject,
            'provider_email' => $trustedEmail,
            'raw_payload' => json_encode($trustedPayload),
            'linked_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $claims = $this->validatedSignedClaims([
            'sub' => $subject,
            'email' => 'unverified-attacker@example.test',
            'email_verified' => false,
        ]);
        $provider = (object) [
            'tenant_id' => $this->testTenantId,
            'provider_key' => $providerKey,
            'allowed_email_domains' => null,
            'auto_provision' => true,
        ];
        $extractedEmail = $this->invokePrivate('extractEmail', $claims);
        $emailVerified = $this->invokePrivate('emailIsVerified', $claims);

        $this->invokePrivate('assertDomainAllowed', $provider, $extractedEmail, $emailVerified);
        $result = $this->invokePrivate(
            'findOrCreateFromClaims',
            $provider,
            $claims,
            $extractedEmail,
            $emailVerified,
            time()
        );

        $this->assertFalse($result['is_new']);
        $this->assertSame((int) $user->id, (int) $result['user']->id);
        $identity = DB::table('oauth_identities')
            ->where('provider', $identityProvider)
            ->where('provider_user_id', $subject)
            ->first();
        $this->assertNotNull($identity);
        $this->assertSame($trustedEmail, $identity->provider_email);
        $this->assertSame($trustedPayload, json_decode((string) $identity->raw_payload, true));
        $this->assertNotNull($identity->last_used_at);
    }

    public function test_ssrf_guard_blocks_non_public_and_non_https_urls(): void
    {
        // Literal internal/loopback/link-local IPs are rejected outright.
        foreach ([
            'https://169.254.169.254/.well-known/openid-configuration',
            'https://127.0.0.1/x',
            'https://10.0.0.5/x',
            'https://192.168.1.1/x',
            'http://login.microsoftonline.com/x',
        ] as $bad) {
            $threw = false;
            try {
                $this->invokePrivate('assertPublicHttpsUrl', $bad);
            } catch (\Throwable $e) {
                $threw = true;
            }
            $this->assertTrue($threw, "Expected rejection for {$bad}");
        }

        // A public https literal IP is allowed.
        $this->invokePrivate('assertPublicHttpsUrl', 'https://8.8.8.8/x');
        $this->assertTrue(true);
    }

    public function test_asymmetric_key_set_drops_symmetric_keys(): void
    {
        // A JWKS carrying only a symmetric oct/HS256 key must yield no
        // usable keys (alg-confusion defence in depth).
        $jwks = ['keys' => [[
            'kty' => 'oct',
            'kid' => 'sym-1',
            'alg' => 'HS256',
            'k' => rtrim(strtr(base64_encode('public-symmetric-secret'), '+/', '-_'), '='),
        ]]];

        $this->expectExceptionMessage('no usable asymmetric signing keys');
        $this->invokePrivate('asymmetricKeySet', $jwks);
    }

    public function test_identity_provider_string_is_tenant_qualified(): void
    {
        $this->assertSame('sso:7:entra', $this->service->identityProviderString(7, 'entra'));
    }

    public function test_existing_email_link_is_deferred_to_locked_issuance_boundary(): void
    {
        $authenticationStartedAt = time() - 10;
        $provider = (object) [
            'tenant_id' => 7,
            'provider_key' => 'entra',
        ];
        $claims = [
            'sub' => 'oidc-subject-revoked',
            'name' => 'Existing Person',
            'email' => 'existing@example.test',
            'email_verified' => true,
        ];

        DB::shouldReceive('selectOne')
            ->twice()
            ->andReturn(
                null,
                (object) [
                    'id' => 77,
                    'tenant_id' => 7,
                    'email' => 'existing@example.test',
                    'email_verified_at' => now(),
                ]
            );
        DB::shouldReceive('statement')->never();

        $service = new SsoOidcService();
        $method = new \ReflectionMethod(SsoOidcService::class, 'findOrCreateFromClaims');
        $result = $method->invoke(
            $service,
            $provider,
            $claims,
            'existing@example.test',
            true,
            $authenticationStartedAt
        );

        $this->assertSame(77, (int) $result['user']->id);
        $this->assertSame('sso:7:entra', $result['identity_link']['provider']);
        $this->assertSame('oidc-subject-revoked', $result['identity_link']['provider_user_id']);
        $this->assertSame($authenticationStartedAt, $result['identity_link']['authentication_started_at']);
        $this->assertSame('existing@example.test', $result['identity_link']['expected_verified_email']);
    }

    // --------------------------------------------------------- discovery

    public function test_discovery_fetches_and_validates_document(): void
    {
        Http::fake([
            'https://93.184.216.34/.well-known/openid-configuration' => Http::response([
                'issuer' => 'https://93.184.216.34',
                'authorization_endpoint' => 'https://93.184.216.34/authorize',
                'token_endpoint' => 'https://93.184.216.34/token',
                'jwks_uri' => 'https://93.184.216.34/keys',
            ]),
        ]);

        $doc = $this->service->discover('https://93.184.216.34/');
        $this->assertSame('https://93.184.216.34/authorize', $doc['authorization_endpoint']);
    }

    public function test_discovery_rejects_incomplete_document(): void
    {
        Http::fake([
            'https://93.184.216.35/.well-known/openid-configuration' => Http::response([
                'issuer' => 'https://93.184.216.35',
            ]),
        ]);

        $this->expectExceptionMessage("missing 'authorization_endpoint'");
        $this->service->discover('https://93.184.216.35');
    }

    public function test_discovery_rejects_redirect_response(): void
    {
        $issuer = 'https://93.184.216.34/redirecting-discovery';
        Http::fake([
            $issuer . '/.well-known/openid-configuration' => Http::response(
                '',
                302,
                ['Location' => 'https://127.0.0.1/internal']
            ),
        ]);

        $this->expectExceptionMessage('OIDC discovery redirects are not allowed.');
        $this->service->discover($issuer);
    }

    public function test_discovery_rejects_private_authorization_endpoint(): void
    {
        $issuer = 'https://93.184.216.34/private-authorization';
        Http::fake([
            $issuer . '/.well-known/openid-configuration' => Http::response([
                'issuer' => $issuer,
                'authorization_endpoint' => 'https://127.0.0.1/authorize',
                'token_endpoint' => 'https://93.184.216.34/token',
                'jwks_uri' => 'https://93.184.216.34/keys',
            ]),
        ]);

        $this->expectExceptionMessage('public https address');
        $this->service->discover($issuer);
    }

    public function test_token_exchange_rejects_redirect_response(): void
    {
        $issuer = 'https://93.184.216.34/token-redirect';
        $discovery = [
            'issuer' => $issuer,
            'authorization_endpoint' => $issuer . '/authorize',
            'token_endpoint' => $issuer . '/token',
            'jwks_uri' => $issuer . '/keys',
        ];
        $provider = (object) [
            'client_id' => 'client-id',
            'client_secret_encrypted' => null,
        ];
        Http::fake([
            $issuer . '/token' => Http::response(
                '',
                307,
                ['Location' => 'https://127.0.0.1/token']
            ),
        ]);

        $this->expectExceptionMessage('SSO token endpoint redirects are not allowed.');
        $this->invokePrivate(
            'exchangeAndValidate',
            $provider,
            $discovery,
            'authorization-code',
            ['code_verifier' => 'verifier', 'oidc_nonce' => 'nonce']
        );
    }

    public function test_jwks_fetch_rejects_redirect_response(): void
    {
        $jwksUri = 'https://93.184.216.34/redirecting-keys';
        Http::fake([
            $jwksUri => Http::response(
                '',
                302,
                ['Location' => 'https://127.0.0.1/keys']
            ),
        ]);

        $this->expectExceptionMessage('SSO JWKS endpoint redirects are not allowed.');
        $this->invokePrivate('fetchJwks', $jwksUri, true);
    }

    // ------------------------------------------- ID token validation (RS256)

    /**
     * Full code-exchange validation against a locally generated RSA
     * keypair: good token passes; wrong nonce, audience and signature
     * are each rejected.
     */
    public function test_exchange_validates_real_rs256_id_token(): void
    {
        [$privateKey, $jwks] = $this->makeKeypairAndJwks('test-key-1');

        $issuer = 'https://93.184.216.34/v2.0';
        $discovery = [
            'issuer' => $issuer,
            'authorization_endpoint' => $issuer . '/authorize',
            'token_endpoint' => $issuer . '/token',
            'jwks_uri' => $issuer . '/keys',
        ];
        $provider = (object) [
            'client_id' => 'client-abc',
            'client_secret_encrypted' => null,
        ];
        $flow = ['code_verifier' => str_repeat('v', 96), 'oidc_nonce' => 'nonce-xyz'];

        $claims = [
            'iss' => $issuer,
            'aud' => 'client-abc',
            'sub' => 'user-123',
            'email' => 'jane@coventry.gov.uk',
            'name' => 'Jane Smith',
            'nonce' => 'nonce-xyz',
            'iat' => time(),
            'exp' => time() + 300,
        ];
        $idToken = JWT::encode($claims, $privateKey, 'RS256', 'test-key-1');

        Http::fake([
            $issuer . '/token' => Http::response(['id_token' => $idToken]),
            $issuer . '/keys' => Http::response($jwks),
        ]);

        $validated = $this->invokePrivate('exchangeAndValidate', $provider, $discovery, 'auth-code', $flow);
        $this->assertSame('user-123', $validated['sub']);
        $this->assertSame('jane@coventry.gov.uk', $validated['email']);
    }

    public function test_exchange_rejects_wrong_nonce(): void
    {
        [$privateKey, $jwks] = $this->makeKeypairAndJwks('test-key-1');
        $issuer = 'https://93.184.216.34/v2.0';
        $discovery = [
            'issuer' => $issuer,
            'authorization_endpoint' => $issuer . '/authorize',
            'token_endpoint' => $issuer . '/token',
            'jwks_uri' => $issuer . '/keys',
        ];
        $provider = (object) ['client_id' => 'client-abc', 'client_secret_encrypted' => null];

        $idToken = JWT::encode([
            'iss' => $issuer, 'aud' => 'client-abc', 'sub' => 'user-123',
            'nonce' => 'attacker-nonce', 'iat' => time(), 'exp' => time() + 300,
        ], $privateKey, 'RS256', 'test-key-1');

        Http::fake([
            $issuer . '/token' => Http::response(['id_token' => $idToken]),
            $issuer . '/keys' => Http::response($jwks),
        ]);

        $this->expectExceptionMessage('ID token nonce mismatch.');
        $this->invokePrivate('exchangeAndValidate', $provider, $discovery, 'auth-code', [
            'code_verifier' => 'v', 'oidc_nonce' => 'real-nonce',
        ]);
    }

    public function test_exchange_rejects_wrong_audience(): void
    {
        [$privateKey, $jwks] = $this->makeKeypairAndJwks('test-key-1');
        $issuer = 'https://93.184.216.34/v2.0';
        $discovery = [
            'issuer' => $issuer,
            'authorization_endpoint' => $issuer . '/authorize',
            'token_endpoint' => $issuer . '/token',
            'jwks_uri' => $issuer . '/keys',
        ];
        $provider = (object) ['client_id' => 'client-abc', 'client_secret_encrypted' => null];

        $idToken = JWT::encode([
            'iss' => $issuer, 'aud' => 'some-other-app', 'sub' => 'user-123',
            'nonce' => 'n', 'iat' => time(), 'exp' => time() + 300,
        ], $privateKey, 'RS256', 'test-key-1');

        Http::fake([
            $issuer . '/token' => Http::response(['id_token' => $idToken]),
            $issuer . '/keys' => Http::response($jwks),
        ]);

        $this->expectExceptionMessage('ID token audience mismatch.');
        $this->invokePrivate('exchangeAndValidate', $provider, $discovery, 'auth-code', [
            'code_verifier' => 'v', 'oidc_nonce' => 'n',
        ]);
    }

    public function test_exchange_rejects_token_signed_by_unknown_key(): void
    {
        [, $jwks] = $this->makeKeypairAndJwks('test-key-1');
        [$attackerKey] = $this->makeKeypairAndJwks('attacker-key');

        $issuer = 'https://93.184.216.34/v2.0';
        $discovery = [
            'issuer' => $issuer,
            'authorization_endpoint' => $issuer . '/authorize',
            'token_endpoint' => $issuer . '/token',
            'jwks_uri' => $issuer . '/keys',
        ];
        $provider = (object) ['client_id' => 'client-abc', 'client_secret_encrypted' => null];

        // Signed by a key that is NOT in the issuer's JWKS (kid matches
        // nothing after refresh either).
        $idToken = JWT::encode([
            'iss' => $issuer, 'aud' => 'client-abc', 'sub' => 'user-123',
            'nonce' => 'n', 'iat' => time(), 'exp' => time() + 300,
        ], $attackerKey, 'RS256', 'attacker-key');

        Http::fake([
            $issuer . '/token' => Http::response(['id_token' => $idToken]),
            $issuer . '/keys' => Http::response($jwks),
        ]);

        $this->expectException(\Throwable::class);
        $this->invokePrivate('exchangeAndValidate', $provider, $discovery, 'auth-code', [
            'code_verifier' => 'v', 'oidc_nonce' => 'n',
        ]);
    }

    // ---------------------------------------------------------------- helpers

    /**
     * Validate claims from a genuinely signed ID token before exercising the
     * email-authorization and account-resolution boundaries.
     *
     * @param array<string, mixed> $overrides
     * @return array<string, mixed>
     */
    private function validatedSignedClaims(array $overrides): array
    {
        [$privateKey, $jwks] = $this->makeKeypairAndJwks('email-claims-key');
        $issuer = 'https://93.184.216.34/email-claims';
        $claims = array_replace([
            'iss' => $issuer,
            'aud' => 'email-claims-client',
            'sub' => 'default-subject',
            'email' => 'member@example.test',
            'email_verified' => true,
            'nonce' => 'email-claims-nonce',
            'iat' => time(),
            'exp' => time() + 300,
        ], $overrides);
        $idToken = JWT::encode($claims, $privateKey, 'RS256', 'email-claims-key');
        $discovery = [
            'issuer' => $issuer,
            'authorization_endpoint' => $issuer . '/authorize',
            'token_endpoint' => $issuer . '/token',
            'jwks_uri' => $issuer . '/keys',
        ];
        $provider = (object) [
            'client_id' => 'email-claims-client',
            'client_secret_encrypted' => null,
        ];
        Http::fake([
            $issuer . '/token' => Http::response(['id_token' => $idToken]),
            $issuer . '/keys' => Http::response($jwks),
        ]);

        return $this->invokePrivate(
            'exchangeAndValidate',
            $provider,
            $discovery,
            'authorization-code',
            [
                'code_verifier' => str_repeat('v', 96),
                'oidc_nonce' => 'email-claims-nonce',
            ]
        );
    }

    /**
     * @return array{0:\OpenSSLAsymmetricKey, 1:array{keys:array<int,array<string,string>>}}
     */
    private function makeKeypairAndJwks(string $kid): array
    {
        $config = [
            'private_key_bits' => 2048,
            'private_key_type' => OPENSSL_KEYTYPE_RSA,
        ];
        // Windows PHP ships openssl.cnf in extras/ssl but doesn't load it
        // by default — without it openssl_pkey_new() returns false.
        $cnf = dirname(PHP_BINARY) . '/extras/ssl/openssl.cnf';
        if (is_file($cnf)) {
            $config['config'] = $cnf;
        }
        $res = openssl_pkey_new($config);
        $this->assertNotFalse($res, 'openssl_pkey_new failed: ' . (string) openssl_error_string());
        $details = openssl_pkey_get_details($res);

        $b64url = static fn (string $bin) => rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');

        $jwks = ['keys' => [[
            'kty' => 'RSA',
            'kid' => $kid,
            'use' => 'sig',
            'alg' => 'RS256',
            'n' => $b64url($details['rsa']['n']),
            'e' => $b64url($details['rsa']['e']),
        ]]];

        return [$res, $jwks];
    }
}
