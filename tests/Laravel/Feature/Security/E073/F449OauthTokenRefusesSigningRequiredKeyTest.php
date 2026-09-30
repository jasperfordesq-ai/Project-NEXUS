<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E073;

use App\Core\FederationApiMiddleware;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Concerns\EnablesExternalFederation;
use Tests\Laravel\TestCase;

/**
 * F-449 (E-073, slice F finding F-4) — the OAuth token endpoint traded a
 * signing-required API key for a plain Bearer token, defeating the HMAC
 * requirement.
 *
 * `federation_api_keys.signing_enabled` is the v1 partner API's second factor:
 * with it set, `FederationApiMiddleware::authenticateWithApiKey()` refuses the
 * key presented on its own (401 `HMAC_REQUIRED`) and the caller must also hold
 * the separate `signing_secret` and sign method + path + timestamp + nonce +
 * body.
 *
 * `FederationJwtService::handleTokenRequest()` never read that column, and
 * neither did the JWT arm's own DB re-check in
 * `FederationApiMiddleware::authenticateWithJwt()`. Possession of the key alone
 * therefore bought a one-hour Bearer JWT carrying the key's full scope set,
 * usable with no signature, no nonce and no timestamp — two factors collapsing
 * into one.
 *
 * The fix refuses at both points: the mint will not issue a token for a
 * signing-required key, and the JWT arm refuses a token whose key has since
 * been switched to signing-required.
 *
 * The legitimate-access control is that a key WITHOUT `signing_enabled` still
 * mints a token and still reaches a route with it — the endpoint must not
 * simply stop working.
 */
final class F449OauthTokenRefusesSigningRequiredKeyTest extends TestCase
{
    use DatabaseTransactions;
    use EnablesExternalFederation;

    protected function setUp(): void
    {
        parent::setUp();
        $this->enableExternalFederation();
        FederationApiMiddleware::reset();

        // The signing secret is an environment value; production sets it and the
        // local container does not. Set it explicitly so the JWT arm is actually
        // exercised rather than short-circuiting on a null secret.
        config([
            'federation.jwt_secret' => 'e073-f449-federation-jwt-secret-value',
            'federation.jwt_issuer' => config('app.url', 'project-nexus'),
        ]);
    }

    protected function tearDown(): void
    {
        FederationApiMiddleware::reset();
        unset($_SERVER['HTTP_X_API_KEY'], $_SERVER['HTTP_AUTHORIZATION']);
        parent::tearDown();
    }

    // ------------------------------------------------------------------
    //  The protection that was being bypassed really does exist
    // ------------------------------------------------------------------

    public function test_a_signing_required_key_presented_on_its_own_is_refused(): void
    {
        $this->federatedMember();
        $apiKey = $this->partnerApiKey(signingEnabled: true);

        $this->useApiKey($apiKey, 'GET', '/api/v1/federation/members');
        $response = $this->apiGet('/v1/federation/members', ['X-API-Key' => $apiKey]);

        $this->assertSame(401, $response->status(), $response->getContent());
        $response->assertJsonPath('code', 'HMAC_REQUIRED');
    }

    // ------------------------------------------------------------------
    //  THE FIX — the mint refuses the same credential
    // ------------------------------------------------------------------

    public function test_the_token_endpoint_refuses_a_signing_required_key(): void
    {
        $this->federatedMember();
        $apiKey = $this->partnerApiKey(signingEnabled: true);

        $this->atTokenEndpoint();
        $token = $this->apiPost('/v1/federation/oauth/token', [
            'grant_type' => 'client_credentials',
            'client_id' => substr($apiKey, 0, 8),
            'client_secret' => $apiKey,
        ]);

        $this->assertSame(400, $token->status(), $token->getContent());
        $token->assertJsonPath('error', 'invalid_client');
        $this->assertNull(
            $token->json('access_token'),
            'a signing-required key must not be exchanged for a bearer token',
        );
    }

    // ------------------------------------------------------------------
    //  THE FIX — a token minted before the switch stops working after it
    // ------------------------------------------------------------------

    public function test_a_token_minted_before_signing_was_required_stops_working_after(): void
    {
        $member = $this->federatedMember();
        $apiKey = $this->partnerApiKey(signingEnabled: false);

        $this->atTokenEndpoint();
        $token = $this->apiPost('/v1/federation/oauth/token', [
            'grant_type' => 'client_credentials',
            'client_id' => substr($apiKey, 0, 8),
            'client_secret' => $apiKey,
        ]);
        $this->assertSame(200, $token->status(), $token->getContent());
        $accessToken = (string) $token->json('access_token');
        $this->assertNotSame('', $accessToken, $token->getContent());

        // It works while the key is a plain bearer credential…
        $this->withBearer($accessToken);
        $before = $this->apiGet('/v1/federation/members', ['Authorization' => 'Bearer ' . $accessToken]);
        $this->assertSame(200, $before->status(), $before->getContent());
        $this->assertContains(
            (int) $member->id,
            array_map(static fn (array $r): int => (int) ($r['id'] ?? 0), $before->json('data') ?? []),
        );

        // …and must stop the moment the operator turns request signing on.
        DB::table('federation_api_keys')
            ->where('key_hash', hash('sha256', $apiKey))
            ->update(['signing_enabled' => 1]);

        $this->withBearer($accessToken);
        $after = $this->apiGet('/v1/federation/members', ['Authorization' => 'Bearer ' . $accessToken]);

        $this->assertSame(401, $after->status(), $after->getContent());
        $after->assertJsonPath('code', 'HMAC_REQUIRED');
    }

    // ------------------------------------------------------------------
    //  LEGITIMATE-ACCESS CONTROL — the endpoint must not simply stop working
    // ------------------------------------------------------------------

    public function test_control_a_key_without_signing_still_mints_a_token_that_reaches_a_route(): void
    {
        $member = $this->federatedMember();
        $apiKey = $this->partnerApiKey(signingEnabled: false);

        $this->atTokenEndpoint();
        $token = $this->apiPost('/v1/federation/oauth/token', [
            'grant_type' => 'client_credentials',
            'client_id' => substr($apiKey, 0, 8),
            'client_secret' => $apiKey,
        ]);

        $this->assertSame(200, $token->status(), $token->getContent());
        $this->assertSame('Bearer', $token->json('token_type'));
        $accessToken = (string) $token->json('access_token');
        $this->assertNotSame('', $accessToken, $token->getContent());

        $this->withBearer($accessToken);
        $read = $this->apiGet('/v1/federation/members?per_page=100', [
            'Authorization' => 'Bearer ' . $accessToken,
        ]);

        $this->assertSame(200, $read->status(), $read->getContent());
        $this->assertContains(
            (int) $member->id,
            array_map(static fn (array $r): int => (int) ($r['id'] ?? 0), $read->json('data') ?? []),
            'the legitimate partner flow must keep working',
        );
    }

    /**
     * The same key, differing from the refused one only in `signing_enabled`,
     * is still accepted when presented directly.
     */
    public function test_control_a_key_without_signing_is_still_accepted_directly(): void
    {
        $this->federatedMember();
        $apiKey = $this->partnerApiKey(signingEnabled: false);

        $this->useApiKey($apiKey, 'GET', '/api/v1/federation/members');
        $response = $this->apiGet('/v1/federation/members', ['X-API-Key' => $apiKey]);

        $this->assertSame(200, $response->status(), $response->getContent());
    }

    // ------------------------------------------------------------------
    //  Fixtures
    // ------------------------------------------------------------------

    private function federatedMember(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        DB::table('federation_user_settings')->updateOrInsert(
            ['user_id' => (int) $user->id],
            [
                'federation_optin' => 1,
                'profile_visible_federated' => 1,
                'appear_in_federated_search' => 1,
                'messaging_enabled_federated' => 1,
                'transactions_enabled_federated' => 1,
                'show_reviews_federated' => 1,
                'updated_at' => now(),
            ],
        );

        return $user;
    }

    /**
     * @param array<int,string> $permissions
     */
    private function partnerApiKey(bool $signingEnabled, array $permissions = ['members:read', 'messages:read']): string
    {
        $apiKey = 'e073f449' . bin2hex(random_bytes(12));
        DB::table('federation_api_keys')->insert([
            'tenant_id' => $this->testTenantId,
            'name' => 'E-073 F449 partner',
            'key_hash' => hash('sha256', $apiKey),
            'key_prefix' => substr($apiKey, 0, 8),
            'signing_enabled' => $signingEnabled ? 1 : 0,
            'signing_secret' => FederationApiMiddleware::generateSigningSecret(),
            'platform_id' => 'e073-f449-' . bin2hex(random_bytes(4)),
            'permissions' => json_encode($permissions),
            'rate_limit' => 100000,
            'status' => 'active',
            'created_by' => 1,
            'created_at' => now(),
            'updated_at' => now(),
            'hourly_request_count' => 0,
        ]);

        return $apiKey;
    }

    private function useApiKey(string $apiKey, string $method, string $uri): void
    {
        FederationApiMiddleware::reset();
        unset($_SERVER['HTTP_AUTHORIZATION']);
        $_SERVER['HTTP_X_API_KEY'] = $apiKey;
        $_SERVER['REQUEST_METHOD'] = $method;
        $_SERVER['REQUEST_URI'] = $uri;
        $_SERVER['REMOTE_ADDR'] = '127.0.0.1';
    }

    private function atTokenEndpoint(): void
    {
        FederationApiMiddleware::reset();
        unset($_SERVER['HTTP_X_API_KEY'], $_SERVER['HTTP_AUTHORIZATION']);
        $_SERVER['REQUEST_METHOD'] = 'POST';
        $_SERVER['REQUEST_URI'] = '/api/v1/federation/oauth/token';
        $_SERVER['REMOTE_ADDR'] = '127.0.0.1';
    }

    private function withBearer(string $accessToken): void
    {
        FederationApiMiddleware::reset();
        unset($_SERVER['HTTP_X_API_KEY']);
        $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $accessToken;
        $_SERVER['REQUEST_METHOD'] = 'GET';
        $_SERVER['REQUEST_URI'] = '/api/v1/federation/members';
        $_SERVER['REMOTE_ADDR'] = '127.0.0.1';
    }
}
