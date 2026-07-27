<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Federation;

use App\Services\FederationFeatureService;
use App\Services\PartnerApi\PartnerApiKillSwitch;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * The AG60 Partner API kill switch — a SIBLING of the external federation
 * switch, not part of it.
 *
 * The Partner API is a different external system: third-party bearer tokens
 * reading members, listings and wallet balances, writing wallet credits, and
 * receiving outbound webhooks. Turning external partner federation off never
 * covered it, so "external access off" was not true. These tests pin both the
 * blocking and — just as importantly — the independence of the two switches,
 * because a switch whose label overstates its reach is the bug being fixed.
 */
final class PartnerApiKillSwitchTest extends TestCase
{
    use DatabaseTransactions;

    /** Every /partner/v1 route, including the token mint outside partner.api. */
    private const ROUTES = [
        ['POST', '/api/partner/v1/oauth/token'],
        ['POST', '/api/partner/v1/oauth/revoke'],
        ['GET', '/api/partner/v1/users'],
        ['GET', '/api/partner/v1/users/1'],
        ['GET', '/api/partner/v1/listings'],
        ['GET', '/api/partner/v1/wallet/balance/1'],
        ['POST', '/api/partner/v1/wallet/credit'],
        ['GET', '/api/partner/v1/aggregates/community'],
        ['GET', '/api/partner/v1/webhooks/subscriptions'],
        ['POST', '/api/partner/v1/webhooks/subscriptions'],
    ];

    /** @param array<string, mixed> $overrides */
    private function seedControls(array $overrides = []): void
    {
        DB::table('federation_system_control')->updateOrInsert(['id' => 1], array_merge([
            'federation_enabled' => 1,
            'whitelist_mode_enabled' => 0,
            'emergency_lockdown_active' => 0,
            'partner_api_enabled' => 0,
            'updated_at' => now(),
        ], $overrides));

        app(PartnerApiKillSwitch::class)->clearCache();
        app(FederationFeatureService::class)->clearCache();
    }

    public function test_every_partner_api_route_is_blocked_when_disabled(): void
    {
        $this->seedControls(['partner_api_enabled' => 0]);

        foreach (self::ROUTES as [$method, $uri]) {
            $response = $this->json($method, $uri);

            $response->assertStatus(503);
            $response->assertJsonPath('errors.0.code', 'partner_api_disabled');
            $this->assertSame(
                '3600',
                $response->headers->get('Retry-After'),
                "{$method} {$uri} is missing Retry-After",
            );
        }
    }

    /** The token mint sits outside partner.api, so only the block-level gate covers it. */
    public function test_token_mint_is_blocked(): void
    {
        $this->seedControls(['partner_api_enabled' => 0]);

        $this->postJson('/api/partner/v1/oauth/token', [
            'grant_type' => 'client_credentials',
            'client_id' => 'x',
            'client_secret' => 'y',
        ])->assertStatus(503)->assertJsonPath('errors.0.code', 'partner_api_disabled');
    }

    public function test_enabling_lets_requests_reach_authentication(): void
    {
        $this->seedControls(['partner_api_enabled' => 1]);

        // Still unauthorised (no bearer token) — but no longer switch-blocked,
        // which is what proves the gate opened rather than auth masking it.
        $response = $this->getJson('/api/partner/v1/users');

        $this->assertNotSame(503, $response->getStatusCode());
        $this->assertStringNotContainsString('partner_api_disabled', (string) $response->getContent());
    }

    public function test_emergency_lockdown_also_blocks_the_partner_api(): void
    {
        $this->seedControls(['partner_api_enabled' => 1, 'emergency_lockdown_active' => 1]);

        $this->assertFalse(app(PartnerApiKillSwitch::class)->isEnabled());
        $this->getJson('/api/partner/v1/users')->assertStatus(503);
    }

    /**
     * The two switches must be genuinely independent in both directions —
     * this is the whole reason the Partner API got its own control.
     */
    public function test_switches_are_independent(): void
    {
        // Federation off, Partner API on.
        $this->seedControls(['partner_api_enabled' => 1, 'external_federation_enabled' => 0]);
        $this->assertTrue(app(PartnerApiKillSwitch::class)->isEnabled());
        $this->assertFalse(app(FederationFeatureService::class)->isExternalFederationEnabled());
        $this->getJson('/api/v2/federation/cc/about')->assertStatus(503);
        $this->assertNotSame(503, $this->getJson('/api/partner/v1/users')->getStatusCode());

        // Federation on, Partner API off.
        $this->seedControls([
            'partner_api_enabled' => 0,
            'external_federation_enabled' => 1,
            'external_protocol_credit_commons_enabled' => 1,
        ]);
        $this->assertFalse(app(PartnerApiKillSwitch::class)->isEnabled());
        $this->assertTrue(app(FederationFeatureService::class)->isExternalFederationEnabled());
        $this->getJson('/api/partner/v1/users')->assertStatus(503);
        $this->assertNotSame(503, $this->getJson('/api/v2/federation/cc/about')->getStatusCode());
    }

    public function test_kill_switch_fails_closed_when_control_row_is_missing(): void
    {
        DB::table('federation_system_control')->where('id', 1)->delete();
        app(PartnerApiKillSwitch::class)->clearCache();

        $this->assertFalse(app(PartnerApiKillSwitch::class)->isEnabled());
        $this->getJson('/api/partner/v1/users')->assertStatus(503);
    }
}
