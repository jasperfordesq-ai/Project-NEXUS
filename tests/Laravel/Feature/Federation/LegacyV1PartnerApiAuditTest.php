<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Federation;

use App\Services\FederationFeatureService;
use App\Services\FederationJwtService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Tests\Laravel\TestCase;

/**
 * Phase 2 audit of `legacy_v1` — the /api/v1/federation/* partner API.
 *
 * v1 is NOT superseded. It is the only partner-facing READ API in this
 * platform's own native format; the v2 families do a different job (`nexus` is
 * seven inbound pushes, the rest are ingest or internal member routes). The
 * owner's decision of 2026-07-29 is that v1 stays and gets audited so it can be
 * re-enabled — and that the OWNER enables it, never a session. Nothing here
 * turns anything on in production.
 *
 * This file covers the two questions the audit turns on:
 *
 *  1. **Can a route be added to this surface ungated?** ExternalFederationKillSwitchTest
 *     already proves the 12 routes it lists are blocked, but it lists them BY
 *     HAND — so a fifteenth or sixteenth route added tomorrow is covered by
 *     nothing. The enumeration here is derived from the router instead, which is
 *     the only shape that can fail on a route nobody remembered to add.
 *  2. **What can a minted OAuth token actually do?** The token mint is
 *     deliberately outside the federation authenticator (it has to be, to
 *     exchange credentials for a token), which makes it the sharpest
 *     authenticated surface on the platform.
 */
final class LegacyV1PartnerApiAuditTest extends TestCase
{
    use DatabaseTransactions;

    /**
     * The four routes that do not call fedAuth(), verified non-leaking:
     * the endpoint catalogue, health, the OAuth mint, and the HMAC webhook probe.
     */
    private const UNAUTHENTICATED_ROUTES = [
        'api/v1/federation',
        'api/v1/federation/health',
        'api/v1/federation/oauth/token',
        'api/v1/federation/webhooks/test',
    ];

    protected function setUp(): void
    {
        parent::setUp();
        $this->setExternalProtocols([]);
    }

    /**
     * `federation_system_control` is a singleton whose SQL defaults are the
     * INVERSE of the application's, so a partial seed silently reads as
     * "everything on". Delete the row first, then write every column.
     *
     * @param array<int, string> $enabled
     */
    private function setExternalProtocols(array $enabled): void
    {
        DB::table('federation_system_control')->where('id', 1)->delete();

        $row = [
            'id' => 1,
            'federation_enabled' => 1,
            'emergency_lockdown_active' => 0,
            'external_federation_enabled' => $enabled === [] ? 0 : 1,
            'updated_at' => now(),
        ];
        foreach (FederationFeatureService::externalProtocolNames() as $protocol) {
            $row[(string) FederationFeatureService::externalProtocolColumn($protocol)]
                = in_array($protocol, $enabled, true) ? 1 : 0;
        }

        DB::table('federation_system_control')->insert($row);
        app(FederationFeatureService::class)->clearCache();
    }

    /**
     * @return list<array{method: string, uri: string, middleware: list<string>}>
     */
    private static function legacyV1Routes(): array
    {
        $found = [];

        foreach (Route::getRoutes() as $route) {
            $uri = $route->uri();
            if ($uri !== 'api/v1/federation' && ! str_starts_with($uri, 'api/v1/federation/')) {
                continue;
            }

            foreach ($route->methods() as $method) {
                if ($method === 'HEAD') {
                    continue;
                }
                $found[] = [
                    'method' => $method,
                    'uri' => $uri,
                    'middleware' => array_values($route->gatherMiddleware()),
                ];
            }
        }

        usort($found, fn (array $a, array $b): int => [$a['uri'], $a['method']] <=> [$b['uri'], $b['method']]);

        return $found;
    }

    public function test_the_v1_surface_is_still_the_fifteen_routes_that_were_audited(): void
    {
        $routes = self::legacyV1Routes();

        self::assertCount(
            15,
            $routes,
            "The legacy_v1 surface changed size. Every route here was individually audited on "
            . '2026-07-29; a new one has not been. Audit it, then update this count in the same '
            . "commit.\nCurrent surface:\n  "
            . implode("\n  ", array_map(fn (array $r): string => "{$r['method']} /{$r['uri']}", $routes))
        );
    }

    /**
     * Derived from the router, so a route added without the protocol middleware
     * fails here even though no test mentions it by name.
     */
    public function test_every_v1_route_carries_the_legacy_v1_protocol_gate(): void
    {
        $ungated = [];

        foreach (self::legacyV1Routes() as $route) {
            $hasGate = false;
            foreach ($route['middleware'] as $middleware) {
                if (str_starts_with($middleware, 'federation.external:')) {
                    $hasGate = $middleware === 'federation.external:legacy_v1' ? true : false;
                    if ($middleware !== 'federation.external:legacy_v1') {
                        $ungated[] = "{$route['method']} /{$route['uri']} — gated as {$middleware}, expected legacy_v1";
                    }
                    break;
                }
            }
            if (! $hasGate && ! str_contains(implode(',', $ungated), $route['uri'])) {
                $ungated[] = "{$route['method']} /{$route['uri']} — no federation.external gate at all";
            }
        }

        self::assertSame(
            [],
            $ungated,
            'Every /api/v1/federation route must declare federation.external:legacy_v1. Without it '
            . 'the route answers partners regardless of the kill switch, which is the exact defect '
            . 'the switch was built for.'
        );
    }

    /**
     * The kill switch is the outermost control, so it has to hold even on the
     * four routes that never reach the authenticator — including the token mint,
     * which is the one route an attacker most wants reachable.
     */
    public function test_the_whole_surface_including_the_token_mint_is_blocked_while_the_switch_is_off(): void
    {
        foreach (self::legacyV1Routes() as $route) {
            $uri = '/' . $route['uri'];
            if (str_contains($uri, '{')) {
                $uri = preg_replace('/\{[^}]+\}/', '1', $uri) ?? $uri;
            }

            $response = $this->json($route['method'], $uri, ['grant_type' => 'client_credentials']);

            self::assertSame(
                503,
                $response->getStatusCode(),
                "{$route['method']} {$uri} answered {$response->getStatusCode()} with legacy_v1 off. "
                . 'Blocked external federation must be 503 + Retry-After, never 403 — a sustained 403 '
                . 'reads to a partner as permanent key revocation.'
            );
        }
    }

    /**
     * The pre-condition for handing this back to the owner: switching legacy_v1
     * on must open legacy_v1 and nothing else. ExternalFederationKillSwitchTest
     * proves this shape for `aggregates`; legacy_v1 is the protocol actually
     * queued for enablement, and it is the widest of the seven, so it gets its
     * own proof rather than an argument by analogy.
     */
    public function test_enabling_legacy_v1_opens_legacy_v1_and_leaves_the_other_protocols_blocked(): void
    {
        $this->setExternalProtocols(['legacy_v1']);

        self::assertNotSame(
            503,
            $this->getJson('/api/v1/federation/health')->getStatusCode(),
            'legacy_v1 was switched on but its own health route is still switch-blocked.'
        );

        // One representative inbound route per remaining external protocol.
        foreach ([
            'credit_commons' => ['GET', '/api/v2/federation/cc/about'],
            'nexus' => ['POST', '/api/v2/federation/ingest/listings'],
            'aggregates' => ['GET', '/api/v2/federation/aggregates'],
        ] as $protocol => [$method, $uri]) {
            self::assertSame(
                503,
                $this->json($method, $uri)->getStatusCode(),
                "Enabling legacy_v1 also opened {$protocol}. Each protocol has its own column and "
                . 'must be switched on individually by the owner after its own audit.'
            );
        }
    }

    // ── What a minted token can do ───────────────────────────────────────────

    /**
     * @param list<string> $permissions
     */
    private function seedApiKey(array $permissions, int $tenantId = 2, string $status = 'active'): array
    {
        $clientSecret = 'secret-' . bin2hex(random_bytes(16));
        $clientId = 'fedkey' . bin2hex(random_bytes(8));

        $id = DB::table('federation_api_keys')->insertGetId([
            'tenant_id' => $tenantId,
            'name' => 'Audit partner',
            'platform_id' => 'audit-' . bin2hex(random_bytes(4)),
            'key_prefix' => substr($clientId, 0, 8),
            'key_hash' => hash('sha256', $clientSecret),
            'permissions' => json_encode($permissions),
            'status' => $status,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return ['id' => $id, 'client_id' => $clientId, 'client_secret' => $clientSecret];
    }

    private function mintToken(array $key, ?string $scope = null): array
    {
        $payload = [
            'grant_type' => 'client_credentials',
            'client_id' => $key['client_id'],
            'client_secret' => $key['client_secret'],
        ];
        if ($scope !== null) {
            $payload['scope'] = $scope;
        }

        return (array) $this->postJson('/api/v1/federation/oauth/token', $payload)->json();
    }

    public function test_the_mint_refuses_every_grant_type_except_client_credentials(): void
    {
        $this->setExternalProtocols(['legacy_v1']);
        $key = $this->seedApiKey(['members:read']);

        foreach (['password', 'authorization_code', 'implicit', 'CLIENT_CREDENTIALS', 'client-credentials', ''] as $grantType) {
            $response = $this->postJson('/api/v1/federation/oauth/token', [
                'grant_type' => $grantType,
                'client_id' => $key['client_id'],
                'client_secret' => $key['client_secret'],
            ]);

            self::assertSame(400, $response->getStatusCode(), "grant_type={$grantType} was not rejected.");
            self::assertSame('unsupported_grant_type', $response->json('error'));
        }
    }

    /**
     * The grant_type check is an exact string comparison, but it sits behind
     * Laravel's global TrimStrings middleware, so `"client_credentials "` reaches
     * it already trimmed and is accepted. That is normalisation, not a bypass —
     * recorded because an exact comparison next to a normalising middleware reads
     * like a defect until you check which one runs first, and because removing
     * TrimStrings from the global stack would silently change this endpoint.
     */
    public function test_surrounding_whitespace_in_grant_type_is_normalised_not_a_bypass(): void
    {
        $this->setExternalProtocols(['legacy_v1']);
        $key = $this->seedApiKey(['members:read']);

        $response = $this->postJson('/api/v1/federation/oauth/token', [
            'grant_type' => '  client_credentials  ',
            'client_id' => $key['client_id'],
            'client_secret' => $key['client_secret'],
        ]);

        self::assertSame(200, $response->getStatusCode());
        self::assertArrayHasKey('access_token', (array) $response->json());
    }

    public function test_the_mint_refuses_an_unknown_or_wrong_secret_without_saying_which(): void
    {
        $this->setExternalProtocols(['legacy_v1']);
        $key = $this->seedApiKey(['members:read']);

        $wrongSecret = $this->mintToken(['client_id' => $key['client_id'], 'client_secret' => 'not-the-secret']);
        $unknownClient = $this->mintToken(['client_id' => 'nosuchkey000000', 'client_secret' => 'whatever']);

        self::assertSame('invalid_client', $wrongSecret['error'] ?? null);
        self::assertSame('invalid_client', $unknownClient['error'] ?? null);
        self::assertSame(
            $wrongSecret['error_description'] ?? null,
            $unknownClient['error_description'] ?? null,
            'A wrong secret and an unknown client id must be indistinguishable, or the mint becomes '
            . 'an oracle for which client ids exist.'
        );
    }

    public function test_a_revoked_or_expired_key_cannot_mint(): void
    {
        $this->setExternalProtocols(['legacy_v1']);

        $revoked = $this->seedApiKey(['members:read'], status: 'revoked');
        self::assertSame('invalid_client', $this->mintToken($revoked)['error'] ?? null);

        $expiring = $this->seedApiKey(['members:read']);
        DB::table('federation_api_keys')->where('id', $expiring['id'])->update(['expires_at' => now()->subDay()]);
        self::assertSame('invalid_client', $this->mintToken($expiring)['error'] ?? null);
    }

    /**
     * THE CENTRAL QUESTION. A token must never carry more authority than the key
     * that minted it, and it must never be able to name a different tenant.
     */
    public function test_a_token_cannot_widen_its_own_scope_beyond_the_key(): void
    {
        $this->setExternalProtocols(['legacy_v1']);
        $key = $this->seedApiKey(['members:read']);

        $escalated = $this->mintToken($key, 'members:read transactions:write reviews:write');

        if (isset($escalated['error'])) {
            self::assertSame('invalid_scope', $escalated['error']);

            return;
        }

        $claims = FederationJwtService::validateTokenStatic((string) $escalated['access_token']);
        self::assertIsArray($claims, 'The mint returned a token that does not validate.');

        self::assertSame(
            ['members:read'],
            array_values((array) ($claims['scopes'] ?? [])),
            'A key holding only members:read must not be able to mint transactions:write. The mint '
            . 'intersects the requested scope with the key permissions; if that intersection is ever '
            . 'replaced by the request, a read-only partner can write.'
        );
    }

    public function test_a_token_is_bound_to_the_keys_own_tenant(): void
    {
        $this->setExternalProtocols(['legacy_v1']);
        $key = $this->seedApiKey(['members:read'], tenantId: 2);

        $minted = $this->mintToken($key);
        self::assertArrayNotHasKey('error', $minted, 'Minting failed: ' . json_encode($minted));

        $claims = FederationJwtService::validateTokenStatic((string) $minted['access_token']);
        self::assertIsArray($claims);

        self::assertSame(
            2,
            (int) ($claims['tenant_id'] ?? 0),
            'The token must carry the tenant of the key that minted it. FederationApiMiddleware '
            . 'prefers the token claim over the live DB row when scoping queries, so a token that '
            . 'could name another tenant would read that tenant\'s data.'
        );
        self::assertSame((string) $key['id'], (string) ($claims['sub'] ?? ''), 'sub must be the API key id.');
    }

    /**
     * A tampered payload must not validate. This is what makes every claim above
     * trustworthy — the middleware reads tenant_id and scopes FROM the token.
     */
    public function test_a_tampered_token_payload_is_rejected(): void
    {
        $this->setExternalProtocols(['legacy_v1']);
        $key = $this->seedApiKey(['members:read'], tenantId: 2);

        $minted = $this->mintToken($key);
        self::assertArrayNotHasKey('error', $minted, 'Minting failed: ' . json_encode($minted));

        [$header, $payload, $signature] = explode('.', (string) $minted['access_token']);

        $claims = json_decode(base64_decode(strtr($payload, '-_', '+/')) ?: '', true);
        self::assertIsArray($claims);
        $claims['tenant_id'] = 9999;
        $claims['scopes'] = ['*'];

        $forgedPayload = rtrim(strtr(base64_encode((string) json_encode($claims)), '+/', '-_'), '=');

        self::assertNull(
            FederationJwtService::validateTokenStatic("{$header}.{$forgedPayload}.{$signature}"),
            'A payload edited to claim another tenant and full scopes still validated. The middleware '
            . 'trusts these claims, so this would be cross-tenant read access with a valid-looking token.'
        );
    }

    /**
     * Tokens are bearer snapshots, so narrowing a key does not retroactively
     * narrow tokens already issued. That is normal OAuth, but the exposure window
     * has to be a known, bounded number rather than an assumption — and the
     * middleware's live DB re-check must still catch a fully revoked key.
     */
    public function test_the_token_lifetime_bounds_the_scope_revocation_window(): void
    {
        self::assertSame(3600, FederationJwtService::DEFAULT_TOKEN_LIFETIME);
        self::assertSame(86400, FederationJwtService::MAX_TOKEN_LIFETIME);

        $this->setExternalProtocols(['legacy_v1']);
        $key = $this->seedApiKey(['members:read', 'transactions:write']);
        $minted = $this->mintToken($key);
        self::assertArrayNotHasKey('error', $minted, 'Minting failed: ' . json_encode($minted));

        self::assertLessThanOrEqual(
            FederationJwtService::MAX_TOKEN_LIFETIME,
            (int) ($minted['expires_in'] ?? PHP_INT_MAX),
            'A minted token must expire within the maximum lifetime: until it does, narrowing the '
            . 'key\'s permissions has no effect on it, because the middleware reads scopes from the '
            . 'token and only re-checks that the key is still active.'
        );
    }
}
