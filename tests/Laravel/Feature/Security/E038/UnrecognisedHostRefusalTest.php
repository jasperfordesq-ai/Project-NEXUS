<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E038;

use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Laravel\TestCase;

/**
 * F-035 (E-021, owner decision 26 Sep 2026, fixed in E-038): an unrecognised
 * hostname was silently served the MASTER tenant instead of being refused.
 * `nexuscivic.ie`, the domain of a deleted community, kept answering
 * `GET /api/v2/tenant/bootstrap` with tenant 1 ("Project NEXUS").
 *
 * Decision: an API request whose Host is neither a community's domain, a
 * community's accessible domain, a configured platform host nor an internal
 * name (IP literal, single-label container name, .localhost/.test/.internal/
 * .local) gets a plain 404. Every legitimate way in keeps working — those
 * cases are the bulk of this file, because a wrong allowlist here takes the
 * whole platform offline.
 */
class UnrecognisedHostRefusalTest extends TestCase
{
    use DatabaseTransactions;

    private const KNOWN_TENANT_ID = 990381;
    private const KNOWN_DOMAIN = 'e038-known-community.example';
    private const KNOWN_ACCESSIBLE_DOMAIN = 'accessible.e038-known-community.example';

    protected function setUp(): void
    {
        parent::setUp();

        DB::table('tenants')->updateOrInsert(
            ['id' => self::KNOWN_TENANT_ID],
            [
                'name' => 'E038 Known Community',
                'slug' => 'e038-known-community',
                'domain' => self::KNOWN_DOMAIN,
                'accessible_domain' => self::KNOWN_ACCESSIBLE_DOMAIN,
                'is_active' => true,
                'depth' => 0,
                'allows_subtenants' => false,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );

        // Deterministic platform configuration for every case below; individual
        // tests override what they exercise.
        config([
            'tenancy.refuse_unknown_hosts' => true,
            'tenancy.platform_hosts' => ['api.e038-platform.example'],
        ]);
    }

    private function bootstrapOn(string $host, array $headers = []): TestResponse
    {
        return $this->getJson("http://{$host}/api/v2/tenant/bootstrap", $headers);
    }

    // ---------------------------------------------------------------- refused

    public function test_unrecognised_host_is_refused_not_served_the_master_tenant(): void
    {
        $response = $this->bootstrapOn('deleted-community.example');

        $response->assertStatus(404);
        $this->assertNotSame(1, $response->json('data.id'), 'An unknown host must never be served the master tenant.');
        $this->assertStringNotContainsString('Project NEXUS', (string) $response->getContent());
    }

    public function test_unrecognised_www_host_is_refused(): void
    {
        $this->bootstrapOn('www.deleted-community.example')->assertStatus(404);
    }

    public function test_unrecognised_host_is_refused_even_with_a_valid_tenant_header(): void
    {
        // On a stray host the host IS the tenant signal; a header must not turn a
        // domain nobody configured into a working copy of a community.
        $this->bootstrapOn('deleted-community.example', ['X-Tenant-Slug' => $this->testTenantSlug])
            ->assertStatus(404);
        $this->bootstrapOn('deleted-community.example', ['X-Tenant-ID' => (string) $this->testTenantId])
            ->assertStatus(404);
    }

    public function test_refusal_applies_to_other_api_routes_too(): void
    {
        $this->getJson('http://deleted-community.example/api/v2/tenants')->assertStatus(404);
    }

    // ------------------------------------------------------- keeps working

    public function test_community_custom_domain_still_resolves_that_community(): void
    {
        $this->bootstrapOn(self::KNOWN_DOMAIN)
            ->assertStatus(200)
            ->assertJsonPath('data.id', self::KNOWN_TENANT_ID);
        $this->bootstrapOn('www.' . self::KNOWN_DOMAIN)
            ->assertStatus(200)
            ->assertJsonPath('data.id', self::KNOWN_TENANT_ID);
    }

    public function test_community_accessible_domain_still_resolves_that_community(): void
    {
        $this->bootstrapOn(self::KNOWN_ACCESSIBLE_DOMAIN)
            ->assertStatus(200)
            ->assertJsonPath('data.id', self::KNOWN_TENANT_ID);
    }

    public function test_inactive_community_domain_is_not_turned_into_a_404(): void
    {
        DB::table('tenants')->where('id', self::KNOWN_TENANT_ID)->update(['is_active' => false]);

        // It keeps the existing "community unavailable" answer, not "unknown host".
        $this->assertNotSame(404, $this->bootstrapOn(self::KNOWN_DOMAIN)->getStatusCode());
    }

    public function test_domain_stored_in_a_non_canonical_form_is_not_refused(): void
    {
        DB::table('tenants')->where('id', self::KNOWN_TENANT_ID)
            ->update(['domain' => 'HTTPS://Odd-Format.E038.example/']);

        // The resolver's exact match misses this row today; refusing it would turn
        // a community's own domain into a 404, so the "is it known" test is lenient.
        $this->assertNotSame(404, $this->bootstrapOn('odd-format.e038.example')->getStatusCode());
    }

    public function test_configured_platform_host_keeps_header_and_master_behaviour(): void
    {
        $this->bootstrapOn('api.e038-platform.example', ['X-Tenant-Slug' => $this->testTenantSlug])
            ->assertStatus(200)
            ->assertJsonPath('data.id', $this->testTenantId);

        $this->bootstrapOn('api.e038-platform.example')->assertStatus(200);
    }

    public function test_hosts_from_app_frontend_and_accessible_urls_are_platform_hosts(): void
    {
        config([
            'app.url' => 'https://api.e038-derived.example',
            'app.frontend_url' => 'https://app.e038-derived.example',
            'app.accessible_frontend_url' => 'https://accessible.e038-derived.example',
        ]);

        foreach (['api.e038-derived.example', 'app.e038-derived.example', 'accessible.e038-derived.example'] as $host) {
            $this->bootstrapOn($host, ['X-Tenant-Slug' => $this->testTenantSlug])
                ->assertStatus(200)
                ->assertJsonPath('data.id', $this->testTenantId);
        }
    }

    public function test_cors_allowed_origins_are_platform_hosts(): void
    {
        // The React app and the API are on different origins on staging, so every
        // browser origin the API serves is already in the CORS list.
        config(['cors.allowed_origins' => ['https://react.e038-cors.example:8443']]);

        $this->bootstrapOn('react.e038-cors.example', ['X-Tenant-Slug' => $this->testTenantSlug])
            ->assertStatus(200)
            ->assertJsonPath('data.id', $this->testTenantId);
    }

    public function test_internal_and_developer_hosts_are_never_refused(): void
    {
        $hosts = [
            'localhost',              // PHPUnit / local dev
            '127.0.0.1',              // blue/green candidate smoke tests
            'nexus-green-php-app',    // web-uk server-side calls (Node fetch drops Host)
            'nexus-php-app',
            'host.docker.internal',   // web-uk in local Docker
            'app.localhost',
            'nexus.test',
        ];

        foreach ($hosts as $host) {
            $this->bootstrapOn($host, ['X-Tenant-Slug' => $this->testTenantSlug])
                ->assertStatus(200)
                ->assertJsonPath('data.id', $this->testTenantId);
        }
    }

    public function test_shipped_defaults_keep_the_production_platform_hosts(): void
    {
        // Guard against the list being "tidied": dropping one of these would 404
        // the mobile app, webhooks (api.) or the React app (app.) in production.
        $shipped = require config_path('tenancy.php');
        config(['tenancy.platform_hosts' => $shipped['platform_hosts']]);

        $hosts = \App\Support\Tenancy\PlatformHostPolicy::platformHosts();
        foreach (['api.project-nexus.ie', 'app.project-nexus.ie', 'project-nexus.ie', 'accessible.project-nexus.ie'] as $host) {
            $this->assertContains($host, $hosts);
        }
        $this->assertTrue($shipped['refuse_unknown_hosts']);
    }

    public function test_kill_switch_restores_the_previous_behaviour(): void
    {
        config(['tenancy.refuse_unknown_hosts' => false]);

        $this->bootstrapOn('deleted-community.example')
            ->assertStatus(200)
            ->assertJsonPath('data.id', 1);
    }
}
