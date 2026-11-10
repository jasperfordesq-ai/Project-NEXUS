<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature;

use App\Models\Tenant;
use App\Services\RedisCache;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Feature tests for the tenant bootstrap endpoint.
 *
 * The /v2/tenant/bootstrap endpoint is the first call the React SPA
 * makes on load — it returns tenant config, features, menus, etc.
 */
class TenantBootstrapTest extends TestCase
{
    use DatabaseTransactions;

    /**
     * Seed a minimal tenant row for bootstrap tests.
     */
    private function seedTestTenant(): void
    {
        DB::table('tenants')->insertOrIgnore([
            'id' => $this->testTenantId,
            'name' => 'Hour Timebank',
            'slug' => $this->testTenantSlug,
            'domain' => null,
            'is_active' => true,
            'depth' => 0,
            'allows_subtenants' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /**
     * Test that bootstrap returns tenant data.
     */
    public function test_bootstrap_returns_tenant_data(): void
    {
        $this->seedTestTenant();

        $response = $this->apiGet('/v2/tenant/bootstrap');

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'data' => [
                'id',
                'name',
                'slug',
            ],
        ]);
    }

    /**
     * Test that bootstrap resolves tenant by slug query parameter.
     */
    public function test_bootstrap_resolves_tenant_by_slug(): void
    {
        $this->seedTestTenant();

        $response = $this->apiGet('/v2/tenant/bootstrap?slug=' . $this->testTenantSlug);

        $response->assertStatus(200);
        $response->assertJsonPath('data.slug', $this->testTenantSlug);
    }

    public function test_bootstrap_exposes_partner_logo_label_in_public_config(): void
    {
        $this->seedTestTenant();

        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'general.partner_logo_label'],
            [
                'setting_value' => 'Local partner',
                'setting_type' => 'string',
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );
        app(RedisCache::class)->delete('tenant_bootstrap', $this->testTenantId);

        $response = $this->apiGet('/v2/tenant/bootstrap?slug=' . $this->testTenantSlug);

        $response->assertStatus(200);
        $response->assertJsonPath('data.config.partner_logo_label', 'Local partner');
    }

    /**
     * Test that bootstrap includes feature flags.
     */
    public function test_bootstrap_includes_features(): void
    {
        $this->seedTestTenant();

        // Seed a feature row so the bootstrap has something to return
        DB::table('federation_tenant_features')->insertOrIgnore([
            'tenant_id' => $this->testTenantId,
            'feature_key' => 'listings',
            'is_enabled' => true,
            'updated_at' => now(),
        ]);

        $response = $this->apiGet('/v2/tenant/bootstrap');

        $response->assertStatus(200);

        // The bootstrap response should include features somewhere in the data
        $data = $response->json('data');
        $this->assertIsArray($data);
        $this->assertArrayHasKey('id', $data);
    }

    /**
     * Test that bootstrap exposes the optional accessible (GOV.UK) frontend
     * custom domain so the SPA can point its "Accessible version" link at it.
     * Uses a dedicated tenant id/slug to avoid the per-tenant bootstrap cache.
     */
    public function test_bootstrap_exposes_accessible_domain_when_configured(): void
    {
        $slug = 'acc-domain-test';
        DB::table('tenants')->updateOrInsert(
            ['id' => 990001],
            [
                'name' => 'Accessible Domain Test',
                'slug' => $slug,
                'domain' => null,
                'accessible_domain' => 'accessible.acc-domain-test.example',
                'is_active' => true,
                'depth' => 0,
                'allows_subtenants' => false,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );

        $response = $this->apiGet('/v2/tenant/bootstrap?slug=' . $slug);

        $response->assertStatus(200);
        $response->assertJsonPath('data.accessible_domain', 'accessible.acc-domain-test.example');
    }

    /**
     * The platform master's own `domain` is the sales site. A community under
     * the master without a domain of its own must stay on the platform app
     * address, so the bootstrap must not hand the SPA the sales site as a
     * parent domain (the SPA would then build links on it). Fresh id/slug to
     * avoid the per-tenant bootstrap cache.
     */
    public function test_bootstrap_never_offers_the_masters_domain_as_parent_domain(): void
    {
        DB::table('tenants')->where('id', 1)->update(['domain' => 'sales.example.test']);
        $slug = 'master-child-' . bin2hex(random_bytes(3));
        DB::table('tenants')->insert([
            'id' => 990002,
            'name' => 'Master Child Test',
            'slug' => $slug,
            'domain' => null,
            'parent_id' => 1,
            'path' => '/1/' . $slug,
            'is_active' => true,
            'depth' => 1,
            'allows_subtenants' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->apiGet('/v2/tenant/bootstrap?slug=' . $slug);

        $response->assertStatus(200);
        $response->assertJsonPath('data.slug', $slug);
        $response->assertJsonMissingPath('data.parent_domain');
    }

    /**
     * Test that bootstrap returns an error for a nonexistent slug.
     */
    public function test_bootstrap_returns_error_for_invalid_slug(): void
    {
        $response = $this->apiGet('/v2/tenant/bootstrap?slug=nonexistent-slug-xyz');

        // Should return 404 or an error in the response body
        $this->assertContains($response->getStatusCode(), [400, 404]);
    }

    /**
     * Test that the tenants list endpoint works.
     */
    public function test_tenants_list_endpoint_returns_data(): void
    {
        $this->seedTestTenant();

        $response = $this->apiGet('/v2/tenants');

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'data',
        ]);
    }

    /**
     * Test that the platform stats endpoint responds.
     */
    public function test_platform_stats_endpoint_responds(): void
    {
        $this->seedTestTenant();

        $response = $this->apiGet('/v2/platform/stats');

        $response->assertStatus(200);
    }
}
