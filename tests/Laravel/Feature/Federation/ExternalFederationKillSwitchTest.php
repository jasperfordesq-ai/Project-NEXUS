<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Federation;

use App\Services\FederationFeatureService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\Laravel\TestCase;

/**
 * Coverage proof for the external partner federation kill switch.
 *
 * Several of these surfaces had NO federation gating at all before the switch
 * existed — all 17 Credit Commons routes, 16 of 17 Komunitin routes, the whole
 * legacy v1 API including the OAuth token mint, the caring hour-transfer
 * inbound endpoint, and the public aggregates endpoint. Turning "federation"
 * off did not stop any of them. This test exists so that never regresses.
 *
 * 59 external routes are gated in total: komunitin 17, credit_commons 17,
 * legacy_v1 15, nexus 7, webhooks 1, hour_transfer 1, aggregates 1.
 */
final class ExternalFederationKillSwitchTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        $this->disableExternalFederation();
    }

    private function disableExternalFederation(): void
    {
        $row = ['external_federation_enabled' => 0, 'updated_at' => now()];
        foreach (FederationFeatureService::externalProtocolNames() as $protocol) {
            $row[(string) FederationFeatureService::externalProtocolColumn($protocol)] = 0;
        }
        DB::table('federation_system_control')->updateOrInsert(['id' => 1], $row);
        app(FederationFeatureService::class)->clearCache();
    }

    /** @param array<int, string> $protocols */
    private function enableExternal(array $protocols): void
    {
        $row = [
            'federation_enabled' => 1,
            'emergency_lockdown_active' => 0,
            'external_federation_enabled' => 1,
            'updated_at' => now(),
        ];
        foreach (FederationFeatureService::externalProtocolNames() as $protocol) {
            $row[(string) FederationFeatureService::externalProtocolColumn($protocol)]
                = in_array($protocol, $protocols, true) ? 1 : 0;
        }
        DB::table('federation_system_control')->updateOrInsert(['id' => 1], $row);
        app(FederationFeatureService::class)->clearCache();
    }

    /**
     * Every inbound external surface must answer 503 with the kill-switch code
     * when the switch is off.
     *
     * @dataProvider externalRouteProvider
     */
    public function test_external_route_is_blocked_when_switch_off(string $method, string $uri): void
    {
        $response = $this->json($method, $uri);

        $response->assertStatus(503);
        $this->assertStringContainsString(
            'FEDERATION_EXTERNAL_DISABLED',
            (string) $response->getContent(),
            "{$method} {$uri} did not report the kill switch",
        );
        $this->assertSame(
            '3600',
            $response->headers->get('Retry-After'),
            "{$method} {$uri} is missing Retry-After",
        );
    }

    /** @return array<string, array{0: string, 1: string}> */
    public static function externalRouteProvider(): array
    {
        return [
            // --- Credit Commons: previously ZERO federation gating ---
            'cc about' => ['GET', '/api/v2/federation/cc/about'],
            'cc accounts' => ['GET', '/api/v2/federation/cc/accounts'],
            'cc account stats' => ['GET', '/api/v2/federation/cc/account'],
            'cc account history' => ['GET', '/api/v2/federation/cc/account/history'],
            'cc create transaction' => ['POST', '/api/v2/federation/cc/transaction'],
            'cc transactions' => ['GET', '/api/v2/federation/cc/transactions'],
            'cc relay transaction' => ['POST', '/api/v2/federation/cc/transaction/relay'],
            'cc entries' => ['GET', '/api/v2/federation/cc/entries'],
            'cc forms' => ['GET', '/api/v2/federation/cc/forms'],
            'cc propose' => ['POST', '/api/v2/federation/cc/transactions/propose'],
            'cc validate' => ['POST', '/api/v2/federation/cc/transactions/abc-123/validate'],
            'cc commit' => ['POST', '/api/v2/federation/cc/transactions/abc-123/commit'],

            // --- Komunitin: only createTransfer was gated, and only on the JSON flag ---
            'komunitin currencies' => ['GET', '/api/v2/federation/komunitin/currencies'],
            'komunitin create currency' => ['POST', '/api/v2/federation/komunitin/currencies'],
            'komunitin currency' => ['GET', '/api/v2/federation/komunitin/EUR/currency'],
            'komunitin delete currency' => ['DELETE', '/api/v2/federation/komunitin/EUR/currency'],
            'komunitin accounts' => ['GET', '/api/v2/federation/komunitin/EUR/accounts'],
            'komunitin create account' => ['POST', '/api/v2/federation/komunitin/EUR/accounts'],
            'komunitin delete account' => ['DELETE', '/api/v2/federation/komunitin/EUR/accounts/1'],
            'komunitin transfers' => ['GET', '/api/v2/federation/komunitin/EUR/transfers'],
            'komunitin create transfer' => ['POST', '/api/v2/federation/komunitin/EUR/transfers'],
            'komunitin delete transfer' => ['DELETE', '/api/v2/federation/komunitin/EUR/transfers/1'],

            // --- Nexus native ingest ---
            'ingest reviews' => ['POST', '/api/v2/federation/ingest/reviews'],
            'ingest listings' => ['POST', '/api/v2/federation/ingest/listings'],
            'ingest events' => ['POST', '/api/v2/federation/ingest/events'],
            'ingest groups' => ['POST', '/api/v2/federation/ingest/groups'],
            'ingest connections' => ['POST', '/api/v2/federation/ingest/connections'],
            'ingest volunteering' => ['POST', '/api/v2/federation/ingest/volunteering'],
            'ingest members sync' => ['POST', '/api/v2/federation/ingest/members/sync'],

            // --- Legacy v1: index/health/oauth/webhook-test never reach fedAuth(),
            //     so only the route-group wrap covers them ---
            'v1 index' => ['GET', '/api/v1/federation'],
            'v1 health' => ['GET', '/api/v1/federation/health'],
            'v1 timebanks' => ['GET', '/api/v1/federation/timebanks'],
            'v1 members' => ['GET', '/api/v1/federation/members'],
            'v1 listings' => ['GET', '/api/v1/federation/listings'],
            'v1 messages read' => ['GET', '/api/v1/federation/messages'],
            'v1 reviews read' => ['GET', '/api/v1/federation/reviews'],
            'v1 send message' => ['POST', '/api/v1/federation/messages'],
            'v1 create transaction' => ['POST', '/api/v1/federation/transactions'],
            'v1 create review' => ['POST', '/api/v1/federation/reviews'],
            'v1 oauth token mint' => ['POST', '/api/v1/federation/oauth/token'],
            'v1 webhook test' => ['POST', '/api/v1/federation/webhooks/test'],

            // --- Unauthenticated surfaces ---
            'partner webhook receiver' => ['POST', '/api/v2/federation/external/webhooks/receive'],
            'hour transfer inbound' => ['POST', '/api/v2/federation/hour-transfer/inbound'],
            'aggregates' => ['GET', '/api/v2/federation/aggregates'],
        ];
    }

    /** Nexus ingest keeps the canonical errors[] contract even when blocked. */
    public function test_ingest_blocked_response_uses_errors_contract(): void
    {
        $response = $this->postJson('/api/v2/federation/ingest/listings');

        $response->assertStatus(503);
        $response->assertJsonStructure(['errors' => [['code', 'message']]]);
        $response->assertJsonPath('errors.0.code', 'FEDERATION_EXTERNAL_DISABLED');
    }

    /** Other federation surfaces keep the legacy error envelope. */
    public function test_legacy_blocked_response_uses_error_envelope(): void
    {
        $response = $this->getJson('/api/v1/federation/health');

        $response->assertStatus(503);
        $response->assertJsonPath('error', true);
        $response->assertJsonPath('code', 'FEDERATION_EXTERNAL_DISABLED');
    }

    /**
     * The response must not name the protocol — an unauthenticated caller
     * should not be able to enumerate which protocols this install supports.
     */
    public function test_blocked_response_does_not_leak_protocol_names(): void
    {
        foreach (['/api/v2/federation/cc/about', '/api/v1/federation/health', '/api/v2/federation/aggregates'] as $uri) {
            $body = (string) $this->getJson($uri)->getContent();
            foreach (['komunitin', 'credit_commons', 'legacy_v1', 'hour_transfer'] as $protocol) {
                $this->assertStringNotContainsString($protocol, $body, "{$uri} leaked protocol name");
            }
        }
    }

    /** Protocols re-open one at a time as their audit passes. */
    public function test_protocols_can_be_re_enabled_independently(): void
    {
        $this->enableExternal([FederationFeatureService::EXTERNAL_PROTOCOL_AGGREGATES]);

        // Aggregates is no longer switch-blocked (it may still 404 on consent).
        $this->assertNotSame(503, $this->getJson('/api/v2/federation/aggregates')->getStatusCode());

        // Everything else stays blocked.
        $this->getJson('/api/v2/federation/cc/about')->assertStatus(503);
        $this->getJson('/api/v1/federation/health')->assertStatus(503);
        $this->postJson('/api/v2/federation/ingest/listings')->assertStatus(503);
    }

    /**
     * The core promise: the external switch must not touch internal
     * cross-tenant federation. These member-facing routes are internal and
     * must answer with auth errors, never the kill switch.
     */
    public function test_internal_cross_tenant_routes_are_not_blocked(): void
    {
        foreach ([
            '/api/v2/federation/status',
            '/api/v2/federation/partners',
            '/api/v2/federation/listings',
            '/api/v2/federation/members',
            '/api/v2/federation/messages',
            '/api/v2/federation/events',
            '/api/v2/federation/groups',
            '/api/v2/federation/connections',
            '/api/v2/federation/activity',
            '/api/v2/federation/settings',
        ] as $uri) {
            $response = $this->getJson($uri);

            $this->assertNotSame(503, $response->getStatusCode(), "{$uri} was blocked by the external switch");
            $this->assertStringNotContainsString(
                'FEDERATION_EXTERNAL_DISABLED',
                (string) $response->getContent(),
                "{$uri} was blocked by the external switch",
            );
        }
    }

    /**
     * Outbound must be blocked without sending anything, and — critically —
     * without tripping the circuit breaker, or re-enabling the switch would
     * appear not to work for the breaker's cooldown period.
     */
    public function test_outbound_is_blocked_without_http_and_without_tripping_breaker(): void
    {
        Http::fake();

        $partnerId = (int) DB::table('federation_external_partners')->insertGetId([
            'tenant_id' => 2,
            'name' => 'Kill switch test partner',
            'base_url' => 'https://partner.invalid',
            'protocol_type' => 'nexus',
            'status' => 'active',
            'auth_method' => 'api_key',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // More consecutive blocked calls than the breaker threshold.
        for ($i = 0; $i < 8; $i++) {
            $result = \App\Services\FederationExternalApiClient::post($partnerId, '/ingest/listings', ['x' => 1]);
            $this->assertFalse($result['success']);
            $this->assertTrue($result['blocked'] ?? false, 'blocked flag missing on attempt ' . $i);
        }

        Http::assertNothingSent();

        // Re-enable and confirm the blocked attempts did not open the circuit
        // breaker — otherwise flipping the switch back on would appear to do
        // nothing for the breaker's cooldown period. The call still fails (the
        // fixture host is deliberately unroutable), but it must fail for a
        // different reason than either the switch or the breaker.
        $this->enableExternal([FederationFeatureService::EXTERNAL_PROTOCOL_NEXUS]);

        $after = \App\Services\FederationExternalApiClient::post($partnerId, '/ingest/listings', ['x' => 1]);

        $this->assertFalse($after['blocked'] ?? false, 'still reported as switch-blocked after re-enabling');
        $this->assertStringNotContainsStringIgnoringCase(
            'circuit breaker',
            (string) ($after['error'] ?? ''),
            '8 switch-blocked calls tripped the circuit breaker; re-enabling the switch would not take effect immediately',
        );
    }

    /** An unknown partner protocol_type must fail closed on outbound. */
    public function test_outbound_unknown_protocol_type_fails_closed(): void
    {
        Http::fake();
        $this->enableExternal(FederationFeatureService::externalProtocolNames());

        $partnerId = (int) DB::table('federation_external_partners')->insertGetId([
            'tenant_id' => 2,
            'name' => 'Unknown protocol partner',
            'base_url' => 'https://partner.invalid',
            'protocol_type' => 'not_a_protocol',
            'status' => 'active',
            'auth_method' => 'api_key',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $result = \App\Services\FederationExternalApiClient::post($partnerId, '/ingest/listings', ['x' => 1]);

        $this->assertFalse($result['success']);
        $this->assertTrue($result['blocked'] ?? false);
        Http::assertNothingSent();
    }
}
