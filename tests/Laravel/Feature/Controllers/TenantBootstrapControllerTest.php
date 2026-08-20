<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Services\AuthenticationConfigurationService;
use App\Services\RedisCache;
use App\Services\TenantHierarchyService;
use App\Services\TenantSettingsService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Feature tests for TenantBootstrapController.
 *
 * Covers the three public endpoints that the React SPA calls on init:
 *   GET /api/v2/tenant/bootstrap
 *   GET /api/v2/tenants
 *   GET /api/v2/platform/stats
 */
class TenantBootstrapControllerTest extends TestCase
{
    use DatabaseTransactions;

    // ================================================================
    // BOOTSTRAP — Happy path
    // ================================================================

    public function test_bootstrap_returns_200_with_data_structure(): void
    {
        $response = $this->apiGet('/v2/tenant/bootstrap');

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'data' => [
                'id',
                'name',
                'slug',
                'currency',
                'features',
                'modules',
                'settings',
                'compliance',
            ],
        ]);
    }

    public function test_bootstrap_exposes_the_tenant_payment_currency_in_uppercase(): void
    {
        app(TenantSettingsService::class)->set(
            $this->testTenantId,
            'general.default_currency',
            'jpy'
        );
        app(RedisCache::class)->delete('tenant_bootstrap', $this->testTenantId);

        try {
            $this->apiGet('/v2/tenant/bootstrap?slug=' . $this->testTenantSlug)
                ->assertOk()
                ->assertJsonPath('data.currency', 'JPY');
        } finally {
            app(TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);
            app(RedisCache::class)->delete('tenant_bootstrap', $this->testTenantId);
        }
    }

    public function test_bootstrap_exposes_typed_authentication_configuration(): void
    {
        DB::table('tenant_settings')->updateOrInsert(
            [
                'tenant_id' => $this->testTenantId,
                'setting_key' => AuthenticationConfigurationService::CONFIG_TWO_FACTOR_TRUSTED_DEVICE_DAYS,
            ],
            [
                'setting_value' => '14',
                'setting_type' => 'integer',
                'category' => 'authentication',
                'updated_at' => now(),
            ]
        );
        AuthenticationConfigurationService::clearCache($this->testTenantId);
        app(RedisCache::class)->delete('tenant_bootstrap', $this->testTenantId);

        try {
            $response = $this->apiGet('/v2/tenant/bootstrap?slug=' . $this->testTenantSlug);

            $response->assertStatus(200);
            $authenticationConfig = $response->json('data.authentication_config');
            $this->assertSame(14, $authenticationConfig['two_factor.trusted_device_days']);
            $this->assertTrue($authenticationConfig['passkeys.conditional_autofill']);
        } finally {
            AuthenticationConfigurationService::clearCache($this->testTenantId);
            app(RedisCache::class)->delete('tenant_bootstrap', $this->testTenantId);
        }
    }

    // ================================================================
    // BOOTSTRAP — Slug resolution
    // ================================================================

    public function test_bootstrap_with_valid_slug_returns_tenant_data(): void
    {
        $response = $this->apiGet('/v2/tenant/bootstrap?slug=' . $this->testTenantSlug);

        $response->assertStatus(200);
        $response->assertJsonPath('data.slug', $this->testTenantSlug);
        $response->assertJsonPath('data.id', $this->testTenantId);
    }

    public function test_bootstrap_exposes_child_tenants_for_tenant_switcher_with_resolved_urls(): void
    {
        DB::table('tenants')->updateOrInsert(
            ['id' => 990101],
            [
                'name' => 'UK Timebank Global',
                'slug' => 'uk-timebank-global-test',
                'domain' => 'uk.timebank.global',
                'parent_id' => null,
                'path' => '/990101/',
                'depth' => 0,
                'allows_subtenants' => true,
                'is_active' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );
        DB::table('tenants')->updateOrInsert(
            ['id' => 990102],
            [
                'name' => 'Cardiff Timebank',
                'slug' => 'cardiff-timebank-test',
                'domain' => null,
                'parent_id' => 990101,
                'path' => '/990101/990102/',
                'depth' => 1,
                'allows_subtenants' => false,
                'is_active' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );
        DB::table('tenants')->updateOrInsert(
            ['id' => 990103],
            [
                'name' => 'Bristol Timebank',
                'slug' => 'bristol-timebank-test',
                'domain' => 'bristol.timebank.example',
                'parent_id' => 990101,
                'path' => '/990101/990103/',
                'depth' => 1,
                'allows_subtenants' => false,
                'is_active' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );
        DB::table('tenants')->updateOrInsert(
            ['id' => 990104],
            [
                'name' => 'Inactive Timebank',
                'slug' => 'inactive-switcher-test',
                'domain' => null,
                'parent_id' => 990101,
                'path' => '/990101/990104/',
                'depth' => 1,
                'allows_subtenants' => false,
                'is_active' => false,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );
        app(RedisCache::class)->delete('tenant_bootstrap', 990101);

        $response = $this->apiGet('/v2/tenant/bootstrap?slug=uk-timebank-global-test');

        $response->assertStatus(200);
        $response->assertJsonPath('data.tenant_switcher.source', 'children');
        $response->assertJsonCount(2, 'data.tenant_switcher.items');

        $items = collect($response->json('data.tenant_switcher.items'))->keyBy('slug');
        $this->assertSame('https://uk.timebank.global/cardiff-timebank-test', $items['cardiff-timebank-test']['url']);
        $this->assertSame('https://bristol.timebank.example', $items['bristol-timebank-test']['url']);
        $this->assertFalse($items->has('inactive-switcher-test'));
    }

    public function test_creating_child_tenant_invalidates_parent_switcher_cache(): void
    {
        DB::table('tenants')->updateOrInsert(
            ['id' => 990201],
            [
                'name' => 'Cached Parent Timebank',
                'slug' => 'cached-parent-timebank-test',
                'domain' => 'cached-parent.timebank.example',
                'parent_id' => null,
                'path' => '/990201/',
                'depth' => 0,
                'allows_subtenants' => true,
                'max_depth' => 2,
                'is_active' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );

        app(RedisCache::class)->delete('tenant_bootstrap', 990201);

        try {
            $initialResponse = $this->apiGet('/v2/tenant/bootstrap?slug=cached-parent-timebank-test');
            $initialResponse->assertStatus(200);
            $initialResponse->assertJsonCount(0, 'data.tenant_switcher.items');

            $result = TenantHierarchyService::createTenant([
                'name' => 'Leeds Timebank',
                'slug' => 'leeds-cache-switcher-test',
                'is_active' => true,
            ], 990201);

            $this->assertTrue($result['success'], $result['error'] ?? 'Tenant creation failed');

            $response = $this->apiGet('/v2/tenant/bootstrap?slug=cached-parent-timebank-test');
            $response->assertStatus(200);

            $items = collect($response->json('data.tenant_switcher.items'))->keyBy('slug');
            $this->assertSame('https://cached-parent.timebank.example/leeds-cache-switcher-test', $items['leeds-cache-switcher-test']['url']);
        } finally {
            app(RedisCache::class)->delete('tenant_bootstrap', 990201);
        }
    }

    /**
     * 🔴 Origin-based resolution must match `accessible_domain`, not only `domain`.
     *
     * The accessible frontend is Node, and `fetch` FORBIDS setting a `Host` header — so it
     * forwards the browser's host as `Origin` and depends on this fallback. While this
     * matched `domain` alone, a community whose own ACCESSIBLE host was configured resolved
     * to nothing and the request fell through to the community chooser instead of that
     * community. Found 2026-08-13 by seeding such a community and walking it; the path had
     * never been exercised BY web-uk. 🔴 It is NOT unused in production: TWO communities
     * have an accessible domain today — accessible-uk.timebank.global and
     * accessible-minehead-and-coast.timebank.global — both currently served by the BLADE
     * accessible frontend. So this fix is a PREREQUISITE for moving either of them to
     * web-uk, not a tidy-up of dead code.
     */
    public function test_bootstrap_resolves_a_tenant_from_its_accessible_domain_origin(): void
    {
        DB::table('tenants')->updateOrInsert(
            ['id' => 990120],
            [
                'name'              => 'Accessible Domain Community',
                'slug'              => 'accessible-domain-test',
                'domain'            => null,
                'accessible_domain' => 'accessible-domain-test.example',
                'parent_id'         => null,
                'path'              => '/990120/',
                'depth'             => 0,
                'is_active'         => true,
                'created_at'        => now(),
                'updated_at'        => now(),
            ]
        );

        // 🔴 `$_SERVER['HTTP_ORIGIN']` must be set DIRECTLY. The controller reads the
        // superglobal rather than `request()->header('Origin')`, and Laravel's test HTTP
        // kernel does NOT populate `$_SERVER` from a headers array — so passing the header
        // to `getJson()` sets nothing and the fallback never runs. (Same family as the
        // recorded `$_SERVER['REQUEST_METHOD']` trap: code reading superglobals behaves
        // differently under test than in production.)
        $_SERVER['HTTP_ORIGIN'] = 'https://accessible-domain-test.example';

        try {
            // 🔴 Deliberately NOT `apiGet()`. That helper adds the suite's tenant header,
            // which resolves TenantContext to the test community — and the Origin fallback
            // runs ONLY when the host resolved to master (`$tenantId <= 1`), by design, so
            // that a real custom domain is never overridden by a request's Origin.
            $response = $this->getJson('/api/v2/tenant/bootstrap');
            $response->assertStatus(200);
            $this->assertSame('accessible-domain-test', $response->json('data.slug'));
        } finally {
            unset($_SERVER['HTTP_ORIGIN']);
        }
    }

    /**
     * `domain` keeps precedence, so an existing custom domain behaves exactly as before even
     * when another community happens to use the same host as its accessible domain.
     */
    public function test_bootstrap_prefers_the_main_domain_over_an_accessible_domain_on_a_clash(): void
    {
        DB::table('tenants')->updateOrInsert(
            ['id' => 990121],
            [
                'name'       => 'Main Domain Owner',
                'slug'       => 'main-domain-owner-test',
                'domain'     => 'clashing-host-test.example',
                'parent_id'  => null,
                'path'       => '/990121/',
                'depth'      => 0,
                'is_active'  => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );
        DB::table('tenants')->updateOrInsert(
            ['id' => 990122],
            [
                'name'              => 'Accessible Domain Claimant',
                'slug'              => 'accessible-claimant-test',
                'domain'            => null,
                'accessible_domain' => 'clashing-host-test.example',
                'parent_id'         => null,
                'path'              => '/990122/',
                'depth'             => 0,
                'is_active'         => true,
                'created_at'        => now(),
                'updated_at'        => now(),
            ]
        );

        // 🔴 `$_SERVER['HTTP_ORIGIN']` must be set DIRECTLY. The controller reads the
        // superglobal rather than `request()->header('Origin')`, and Laravel's test HTTP
        // kernel does NOT populate `$_SERVER` from a headers array — so passing the header
        // to `getJson()` sets nothing and the fallback never runs. (Same family as the
        // recorded `$_SERVER['REQUEST_METHOD']` trap: code reading superglobals behaves
        // differently under test than in production.)
        $_SERVER['HTTP_ORIGIN'] = 'https://clashing-host-test.example';

        try {
            // 🔴 Deliberately NOT `apiGet()`. That helper adds the suite's tenant header,
            // which resolves TenantContext to the test community — and the Origin fallback
            // runs ONLY when the host resolved to master (`$tenantId <= 1`), by design, so
            // that a real custom domain is never overridden by a request's Origin.
            $response = $this->getJson('/api/v2/tenant/bootstrap');
            $response->assertStatus(200);
            $this->assertSame('main-domain-owner-test', $response->json('data.slug'));
        } finally {
            unset($_SERVER['HTTP_ORIGIN']);
        }
    }

    public function test_bootstrap_returns_404_for_unknown_slug(): void
    {
        $response = $this->apiGet('/v2/tenant/bootstrap?slug=nonexistent-slug-xyz');

        $response->assertStatus(404);
    }

    public function test_bootstrap_slug_lookup_is_case_insensitive_trimmed(): void
    {
        // Passing a slug with surrounding whitespace that trim() handles.
        // A slug with leading/trailing spaces should still resolve (controller trims it).
        $response = $this->apiGet('/v2/tenant/bootstrap?slug=' . urlencode(' ' . $this->testTenantSlug . ' '));

        $response->assertStatus(200);
        $response->assertJsonPath('data.slug', $this->testTenantSlug);
    }

    // ================================================================
    // BOOTSTRAP — Inactive tenant guard
    // ================================================================

    public function test_bootstrap_returns_404_for_inactive_tenant_slug(): void
    {
        // Insert a second tenant that is inactive
        DB::table('tenants')->insertOrIgnore([
            'id' => 99901,
            'name' => 'Inactive Timebank',
            'slug' => 'inactive-timebank-test',
            'domain' => null,
            'is_active' => false,
            'depth' => 0,
            'allows_subtenants' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->apiGet('/v2/tenant/bootstrap?slug=inactive-timebank-test');

        // Inactive tenants must NOT be returned — controller checks is_active = 1
        $response->assertStatus(404);
    }

    // ================================================================
    // TENANTS LIST — Happy path
    // ================================================================

    public function test_list_returns_200_with_data_array(): void
    {
        $response = $this->apiGet('/v2/tenants');

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'data',
        ]);

        $data = $response->json('data');
        $this->assertIsArray($data);
    }

    /**
     * 🔴 An empty cached community list must never be served or written.
     *
     * Found live on 2026-08-20: the picker on the sign-in screen said "No communities
     * found." while the database held four active tenants. Redis was holding `a:0:{}`
     * under `tenants_list_public`, and the old code skipped the cache only on `null`, so
     * one query that came back empty blanked the sign-in entry point for five minutes and
     * every request re-served the emptiness instead of re-checking. No error would appear
     * anywhere — just a platform that seemed to contain no communities.
     */
    public function test_list_ignores_an_empty_cached_list_instead_of_serving_it(): void
    {
        /** @var RedisCache $cache */
        $cache = app(RedisCache::class);
        $cache->set('tenants_list_public', [], 300);

        $response = $this->apiGet('/v2/tenants');

        $response->assertStatus(200);
        $slugs = array_column($response->json('data'), 'slug');
        $this->assertContains(
            $this->testTenantSlug,
            $slugs,
            'An empty cache entry was served instead of being re-read from the database.'
        );
    }

    /**
     * The read guard's other half: a real answer still gets cached, so the fix does not
     * quietly turn a cached endpoint into an uncached one.
     *
     * 🔴 Deliberately NOT tested by forcing the query to return nothing. Deactivating
     * every tenant is the only way to do that, and it also breaks tenant resolution for
     * the request itself — the endpoint is never reached and the assertion passes for the
     * wrong reason. An earlier version of this test did exactly that and failed with
     * "Unable to resolve tenant".
     */
    public function test_list_still_caches_a_real_answer(): void
    {
        /** @var RedisCache $cache */
        $cache = app(RedisCache::class);
        $cache->delete('tenants_list_public');

        $this->apiGet('/v2/tenants')->assertStatus(200);

        $cached = $cache->get('tenants_list_public');
        $this->assertNotEmpty($cached, 'A real tenant list should be cached.');
        $this->assertContains($this->testTenantSlug, array_column($cached, 'slug'));
    }

    public function test_list_contains_test_tenant(): void
    {
        $response = $this->apiGet('/v2/tenants');

        $response->assertStatus(200);

        $slugs = array_column($response->json('data'), 'slug');
        $this->assertContains($this->testTenantSlug, $slugs);
    }

    public function test_list_exposes_each_tenants_conditional_passkey_autofill_policy(): void
    {
        DB::table('tenant_settings')->updateOrInsert(
            [
                'tenant_id' => $this->testTenantId,
                'setting_key' => AuthenticationConfigurationService::CONFIG_PASSKEYS_CONDITIONAL_AUTOFILL,
            ],
            [
                'setting_value' => 'false',
                'setting_type' => 'boolean',
                'category' => 'authentication',
                'updated_at' => now(),
            ]
        );
        app(RedisCache::class)->delete('tenants_list_public');

        try {
            $response = $this->apiGet('/v2/tenants');

            $response->assertStatus(200);
            $tenant = collect($response->json('data'))->firstWhere('id', $this->testTenantId);
            $this->assertNotNull($tenant);
            $this->assertFalse($tenant['authentication_config']['passkeys.conditional_autofill']);
        } finally {
            app(RedisCache::class)->delete('tenants_list_public');
        }
    }

    public function test_platform_passkey_emergency_switch_is_exposed_to_login_clients(): void
    {
        config(['webauthn.authentication_enabled' => false]);
        app(RedisCache::class)->delete('tenant_bootstrap', $this->testTenantId);
        app(RedisCache::class)->delete('tenants_list_public');

        try {
            $this->apiGet('/v2/tenant/bootstrap?slug=' . $this->testTenantSlug)
                ->assertOk()
                ->assertJsonPath('data.features.biometric_login', false);

            $tenant = collect($this->apiGet('/v2/tenants')->assertOk()->json('data'))
                ->firstWhere('id', $this->testTenantId);
            $this->assertNotNull($tenant);
            $this->assertFalse($tenant['features']['biometric_login']);
        } finally {
            config(['webauthn.authentication_enabled' => true]);
            app(RedisCache::class)->delete('tenant_bootstrap', $this->testTenantId);
            app(RedisCache::class)->delete('tenants_list_public');
        }
    }

    public function test_list_excludes_master_tenant_by_default(): void
    {
        $response = $this->apiGet('/v2/tenants');

        $response->assertStatus(200);

        $ids = array_column($response->json('data'), 'id');
        $this->assertNotContains(1, $ids, 'Master tenant (id=1) should not appear without include_master=true');
    }

    // ================================================================
    // PLATFORM STATS — Happy path
    // ================================================================

    public function test_platform_stats_returns_200_with_expected_keys(): void
    {
        $response = $this->apiGet('/v2/platform/stats');

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'data' => [
                'members',
                'hours_exchanged',
                'listings',
                'skills',
                'communities',
            ],
        ]);
    }

    public function test_platform_stats_values_are_non_negative_integers(): void
    {
        $response = $this->apiGet('/v2/platform/stats');

        $response->assertStatus(200);

        $data = $response->json('data');
        foreach (['members', 'hours_exchanged', 'listings', 'skills', 'communities'] as $key) {
            $this->assertIsInt($data[$key], "Expected integer for key: {$key}");
            $this->assertGreaterThanOrEqual(0, $data[$key], "Expected non-negative value for key: {$key}");
        }
    }
}
