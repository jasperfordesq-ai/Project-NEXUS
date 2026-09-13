<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Console;

use App\Services\PrerenderService;
use App\Services\SitemapService;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * Tests for the prerender:plan-routes Artisan command.
 *
 * The command:
 *   1. Queries the `tenants` table for ALL active tenants, master (id=1) included.
 *      Master is planned at the app host with no slug prefix; every other tenant
 *      uses its own domain, else its parent's domain + /slug, else the app host.
 *   2. For each tenant calls PrerenderService::routesForTenant() for the static floor.
 *   3. Optionally calls SitemapService::generateForTenant() for dynamic routes.
 *   4. Outputs JSON: { "tenants": [ { tenant_id, slug, host, prefix, routes } ] }.
 *
 * We bind mocks for PrerenderService and SitemapService to avoid any
 * filesystem / HTTP / headless-renderer calls.
 *
 * Artisan::call() + Artisan::output() is used to capture the JSON output.
 */
class PrerenderPlanRoutesTest extends TestCase
{
    use \Illuminate\Foundation\Testing\DatabaseTransactions;

    /** Unique tenant id scoped to this test file. */
    private const TENANT_ID   = 99716;
    private const TENANT_SLUG = 'test-plan-99716';

    private \Mockery\MockInterface $prerenderMock;
    private \Mockery\MockInterface $sitemapMock;

    protected function setUp(): void
    {
        parent::setUp();

        Queue::fake();

        // Ensure our unique test tenant exists and is active.
        DB::table('tenants')->updateOrInsert(
            ['id' => self::TENANT_ID],
            [
                'name'       => 'Plan Test Tenant 99716',
                'slug'       => self::TENANT_SLUG,
                'domain'     => null,
                'is_active'  => 1,
                'depth'      => 0,
                'allows_subtenants' => 0,
                'features'   => '{}',
                'configuration' => '{"modules":{}}',
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );

        \App\Core\TenantContext::setById(self::TENANT_ID);

        $this->prerenderMock = Mockery::mock(PrerenderService::class);
        $this->sitemapMock   = Mockery::mock(SitemapService::class);

        $this->app->instance(PrerenderService::class, $this->prerenderMock);
        $this->app->instance(SitemapService::class,   $this->sitemapMock);
    }

    // -------------------------------------------------------------------------
    // Helper: call the command and decode its JSON output.
    // -------------------------------------------------------------------------

    /**
     * Run prerender:plan-routes and return the decoded JSON array.
     *
     * Uses Artisan::call() + Artisan::output() so the Symfony output buffer
     * is captured (ob_start/get_clean does not capture Symfony output).
     */
    private function callAndDecode(array $args = []): array
    {
        Artisan::call('prerender:plan-routes', $args);
        $raw = trim(Artisan::output());
        $decoded = json_decode($raw, true);
        $this->assertIsArray($decoded, "Command output must be valid JSON, got: {$raw}");
        return $decoded;
    }

    /** Find our test tenant's row in the decoded output, or null. */
    private function findRow(array $decoded, string $slug = self::TENANT_SLUG): ?array
    {
        foreach ($decoded['tenants'] ?? [] as $t) {
            if (($t['slug'] ?? '') === $slug) return $t;
        }
        return null;
    }

    private function expectValidHomepageSitemap(): void
    {
        $this->sitemapMock
            ->shouldReceive('generateForTenant')
            ->andReturnUsing(static function (int $tenantId, ?string $baseUrl): string {
                $home = rtrim((string) $baseUrl, '/') . '/';
                return '<urlset><url><loc>'
                    . htmlspecialchars($home, ENT_XML1 | ENT_QUOTES, 'UTF-8')
                    . '</loc></url></urlset>';
            });
    }

    // =========================================================================
    // The platform master (id=1) is planned, at the APP HOST.
    // =========================================================================

    /**
     * Regression: the query carried `->where('id', '<>', 1)`, so the master
     * tenant was never planned and `app.project-nexus.ie` — its public front
     * page, which lists every community — had no snapshots at all while taking
     * ~156 crawler visits a day, every one served the empty SPA shell.
     *
     * Master must also NOT be planned at its own `tenants.domain`
     * (`project-nexus.ie`): Apache routes that hostname to the separate
     * sales-site container, so snapshots written there are never read. 48 such
     * orphans accumulated before this was found.
     */
    public function test_master_tenant_is_planned_at_the_app_host_not_its_own_domain(): void
    {
        DB::table('tenants')->where('id', 1)->update([
            'domain'    => 'project-nexus.ie',
            'is_active' => 1,
        ]);

        $this->prerenderMock->shouldReceive('routesForTenant')->andReturn(['/']);
        $this->expectValidHomepageSitemap();

        $decoded = $this->callAndDecode(['--include-sitemap' => 0]);

        $master = null;
        foreach ($decoded['tenants'] ?? [] as $t) {
            if ((int) ($t['tenant_id'] ?? 0) === 1) { $master = $t; break; }
        }

        $this->assertNotNull($master, 'The platform master (id=1) must appear in the route plan');
        $this->assertSame('', $master['prefix'], 'Master is served at the host root, with no slug prefix');
        $this->assertNotSame(
            'project-nexus.ie',
            $master['host'],
            'Master must NOT be planned at its own domain — that hostname belongs to the sales site'
        );
        $this->assertNotEmpty($master['routes'], 'Master must have routes planned');
    }

    // =========================================================================
    // Output structure always contains a "tenants" key.
    // =========================================================================

    public function test_output_is_valid_json_with_tenants_key(): void
    {
        $this->prerenderMock->shouldReceive('routesForTenant')->andReturn([]);
        $this->expectValidHomepageSitemap();

        $decoded = $this->callAndDecode();
        $this->assertArrayHasKey('tenants', $decoded);
    }

    // =========================================================================
    // Our test tenant appears in the plan with correct fields.
    // =========================================================================

    public function test_plan_includes_test_tenant_with_correct_fields(): void
    {
        $this->prerenderMock->shouldReceive('routesForTenant')->andReturn(['/']);
        $this->expectValidHomepageSitemap();

        $decoded = $this->callAndDecode();
        $row = $this->findRow($decoded);

        $this->assertIsArray($row, 'Test tenant slug must appear in plan output');
        $this->assertSame(self::TENANT_ID, $row['tenant_id']);
        $this->assertArrayHasKey('host',   $row);
        $this->assertArrayHasKey('prefix', $row);
        $this->assertArrayHasKey('routes', $row);
        $this->assertIsArray($row['routes']);
    }

    // =========================================================================
    // Static-floor routes (from routesForTenant) are included in the output.
    // =========================================================================

    public function test_static_floor_routes_included_in_plan(): void
    {
        $staticRoutes = ['/', '/about', '/privacy'];

        $this->prerenderMock->shouldReceive('routesForTenant')->andReturn($staticRoutes);
        $this->expectValidHomepageSitemap();

        $decoded = $this->callAndDecode(['--tenant' => self::TENANT_SLUG]);
        $row = $decoded['tenants'][0] ?? null;
        $this->assertIsArray($row);

        foreach ($staticRoutes as $route) {
            $this->assertContains($route, $row['routes'], "Static route {$route} must appear");
        }
    }

    // =========================================================================
    // --include-static=0 → routesForTenant NOT called.
    // =========================================================================

    public function test_include_static_off_skips_routes_for_tenant(): void
    {
        $this->prerenderMock->shouldNotReceive('routesForTenant');
        $this->expectValidHomepageSitemap();

        $this->artisan('prerender:plan-routes', ['--include-static' => '0'])
            ->assertExitCode(0);
    }

    // =========================================================================
    // --include-sitemap=0 → generateForTenant NOT called.
    // =========================================================================

    public function test_include_sitemap_off_skips_sitemap_service(): void
    {
        $this->prerenderMock->shouldReceive('routesForTenant')->andReturn(['/']);
        $this->sitemapMock->shouldNotReceive('generateForTenant');

        $this->artisan('prerender:plan-routes', ['--include-sitemap' => '0'])
            ->assertExitCode(0);
    }

    // =========================================================================
    // Sitemap routes (dynamic) are merged with static floor; deduplication.
    // =========================================================================

    public function test_sitemap_routes_merged_with_static_routes_no_duplicates(): void
    {
        $staticRoutes = ['/', '/about'];

        $this->prerenderMock->shouldReceive('routesForTenant')->andReturn($staticRoutes);

        // Resolve the app host the same way the command does.
        $appHost = parse_url((string) env('FRONTEND_URL', 'https://app.project-nexus.ie'), PHP_URL_HOST)
                   ?: 'app.project-nexus.ie';
        $prefix  = '/' . self::TENANT_SLUG;

        // Sitemap includes /about (duplicate) and a public CMS page (new).
        $sitemapXml = "<?xml version=\"1.0\"?><urlset>"
            . "<url><loc>https://{$appHost}{$prefix}/about</loc></url>"
            . "<url><loc>https://{$appHost}{$prefix}/page/post-1</loc></url>"
            . "</urlset>";

        $this->sitemapMock->shouldReceive('generateForTenant')->andReturn($sitemapXml);

        $decoded = $this->callAndDecode(['--tenant' => self::TENANT_SLUG]);
        $row     = $decoded['tenants'][0] ?? null;
        $this->assertIsArray($row);

        $routes = $row['routes'];
        // /about must appear exactly once (dedup).
        $this->assertSame(1, count(array_filter($routes, fn ($r) => $r === '/about')));
        $this->assertContains('/page/post-1', $routes);
    }

    public function test_public_blog_detail_from_sitemap_is_included_in_plan(): void
    {
        $this->prerenderMock->shouldReceive('routesForTenant')->andReturn(['/', '/blog']);

        $appHost = parse_url((string) env('FRONTEND_URL', 'https://app.project-nexus.ie'), PHP_URL_HOST)
            ?: 'app.project-nexus.ie';
        $prefix = '/' . self::TENANT_SLUG;
        $this->sitemapMock->shouldReceive('generateForTenant')->andReturn(
            "<urlset><url><loc>https://{$appHost}{$prefix}/blog/public-editorial-post</loc></url></urlset>"
        );

        $decoded = $this->callAndDecode(['--tenant' => self::TENANT_SLUG]);

        $this->assertContains('/blog', $decoded['tenants'][0]['routes'] ?? []);
        $this->assertContains('/blog/public-editorial-post', $decoded['tenants'][0]['routes'] ?? []);
    }

    public function test_sitemap_authenticated_route_fails_closed(): void
    {
        $this->prerenderMock->shouldReceive('routesForTenant')->andReturn(['/']);

        $appHost = parse_url((string) env('FRONTEND_URL', 'https://app.project-nexus.ie'), PHP_URL_HOST)
            ?: 'app.project-nexus.ie';
        $prefix = '/' . self::TENANT_SLUG;
        $this->sitemapMock->shouldReceive('generateForTenant')->andReturn(
            "<urlset><url><loc>https://{$appHost}{$prefix}/events/123</loc></url></urlset>"
        );

        $exit = Artisan::call('prerender:plan-routes', ['--tenant' => self::TENANT_SLUG]);

        $this->assertSame(\Illuminate\Console\Command::FAILURE, $exit);
        $this->assertStringContainsString('route requires authentication', Artisan::output());
    }

    // =========================================================================
    // --tenant filter limits output to ONE tenant.
    // =========================================================================

    public function test_tenant_filter_limits_to_one_tenant(): void
    {
        $this->prerenderMock->shouldReceive('routesForTenant')->andReturn(['/']);
        $this->expectValidHomepageSitemap();

        $decoded = $this->callAndDecode(['--tenant' => self::TENANT_SLUG]);

        $this->assertCount(1, $decoded['tenants'], 'Only one tenant should be in the filtered output');
        $this->assertSame(self::TENANT_SLUG, $decoded['tenants'][0]['slug']);
    }

    // =========================================================================
    // Invalid tenant slug → exit code INVALID (2).
    // =========================================================================

    public function test_invalid_tenant_slug_returns_invalid_exit_code(): void
    {
        // Neither service should be called for an invalid slug.
        $this->prerenderMock->shouldNotReceive('routesForTenant');
        $this->sitemapMock->shouldNotReceive('generateForTenant');

        $this->artisan('prerender:plan-routes', ['--tenant' => '../evil/slug'])
            ->assertExitCode(\Illuminate\Console\Command::INVALID);
    }

    // =========================================================================
    // --limit cap is fail-closed: a partial tenant plan is never emitted.
    // =========================================================================

    public function test_limit_rejects_partial_tenant_plan(): void
    {
        // Static floor with 3 routes.
        $this->prerenderMock->shouldReceive('routesForTenant')->andReturn(['/', '/about', '/privacy']);

        // Sitemap adds 10 more dynamic routes.
        $appHost  = parse_url((string) env('FRONTEND_URL', 'https://app.project-nexus.ie'), PHP_URL_HOST)
                    ?: 'app.project-nexus.ie';
        $prefix   = '/' . self::TENANT_SLUG;
        $urlParts = '';
        for ($i = 1; $i <= 10; $i++) {
            $urlParts .= "<url><loc>https://{$appHost}{$prefix}/page/post-{$i}</loc></url>";
        }
        $sitemapXml = "<?xml version=\"1.0\"?><urlset>{$urlParts}</urlset>";

        $this->sitemapMock->shouldReceive('generateForTenant')->andReturn($sitemapXml);

        $exit = Artisan::call('prerender:plan-routes', [
            '--tenant' => self::TENANT_SLUG,
            '--limit' => '5',
        ]);

        $this->assertSame(
            \Illuminate\Console\Command::FAILURE,
            $exit,
            'Reaching the route limit must fail instead of emitting a partial tenant plan'
        );
        $this->assertStringContainsString('refusing to emit a partial plan', Artisan::output());
        $this->assertNull(json_decode(trim(Artisan::output()), true));
    }

    // =========================================================================
    // Sitemap errors fail closed; no incomplete static-only plan is emitted.
    // =========================================================================

    public function test_sitemap_error_fails_without_emitting_partial_plan(): void
    {
        $staticRoutes = ['/', '/about'];

        $this->prerenderMock->shouldReceive('routesForTenant')->andReturn($staticRoutes);
        $this->sitemapMock->shouldReceive('generateForTenant')
            ->andThrow(new \RuntimeException('sitemap unavailable'));

        $exit = Artisan::call('prerender:plan-routes', ['--tenant' => self::TENANT_SLUG]);
        $this->assertSame(\Illuminate\Console\Command::FAILURE, $exit);
        $this->assertNull(json_decode(trim(Artisan::output()), true));
    }

    public function test_sitemap_without_locations_fails_closed(): void
    {
        $this->prerenderMock->shouldReceive('routesForTenant')->andReturn(['/']);
        $this->sitemapMock->shouldReceive('generateForTenant')->andReturn('<urlset></urlset>');

        $exit = Artisan::call('prerender:plan-routes', ['--tenant' => self::TENANT_SLUG]);

        $this->assertSame(\Illuminate\Console\Command::FAILURE, $exit);
        $this->assertStringContainsString('contains no route locations', Artisan::output());
        $this->assertNull(json_decode(trim(Artisan::output()), true));
    }

    public function test_sitemap_with_only_off_host_locations_fails_closed(): void
    {
        $this->prerenderMock->shouldReceive('routesForTenant')->andReturn(['/']);
        $this->sitemapMock->shouldReceive('generateForTenant')->andReturn(
            '<urlset><url><loc>https://wrong-tenant.example/blog/post</loc></url></urlset>'
        );

        $exit = Artisan::call('prerender:plan-routes', ['--tenant' => self::TENANT_SLUG]);

        $this->assertSame(\Illuminate\Console\Command::FAILURE, $exit);
        $this->assertStringContainsString('wrong scheme or host', Artisan::output());
        $this->assertNull(json_decode(trim(Artisan::output()), true));
    }

    // =========================================================================
    // Tenant with a custom domain uses domain as host and empty prefix.
    // =========================================================================

    public function test_custom_domain_tenant_uses_domain_as_host(): void
    {
        $domainTenantId = 99717; // ephemeral, rolled back by DatabaseTransactions
        $domainSlug     = 'domain-tenant-99717';
        $customDomain   = 'custom-99717.example.com';

        DB::table('tenants')->updateOrInsert(
            ['id' => $domainTenantId],
            [
                'name'       => 'Domain Tenant 99717',
                'slug'       => $domainSlug,
                'domain'     => $customDomain,
                'is_active'  => 1,
                'depth'      => 0,
                'allows_subtenants' => 0,
                'features'   => '{}',
                'configuration' => '{"modules":{}}',
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );

        $this->prerenderMock->shouldReceive('routesForTenant')->andReturn(['/']);
        $this->expectValidHomepageSitemap();

        $decoded = $this->callAndDecode(['--tenant' => $domainSlug]);
        $this->assertNotEmpty($decoded['tenants']);

        $row = $decoded['tenants'][0];
        $this->assertSame($customDomain, $row['host'],   'Custom domain must be used as host');
        $this->assertSame('',            $row['prefix'], 'Prefix must be empty when tenant has own domain');
    }

    // =========================================================================
    // Tenant without domain uses app host + /slug prefix.
    // =========================================================================

    public function test_no_domain_tenant_uses_app_host_and_slug_prefix(): void
    {
        $this->prerenderMock->shouldReceive('routesForTenant')->andReturn(['/']);
        $this->expectValidHomepageSitemap();

        $decoded = $this->callAndDecode(['--tenant' => self::TENANT_SLUG]);
        $row     = $decoded['tenants'][0] ?? null;
        $this->assertIsArray($row);

        // Prefix must be /slug.
        $this->assertSame('/' . self::TENANT_SLUG, $row['prefix']);
        // Host must be a non-empty, non-slug string.
        $this->assertNotEmpty($row['host']);
        $this->assertNotSame(self::TENANT_SLUG, $row['host']);
    }

    public function test_child_with_empty_domain_inherits_active_parent_domain(): void
    {
        $parentId = 99718;
        $childId = 99719;
        $childSlug = 'child-plan-99719';
        $parentDomain = 'parent-99718.example.com';

        DB::table('tenants')->updateOrInsert(
            ['id' => $parentId],
            [
                'name' => 'Parent Plan Tenant 99718',
                'slug' => 'parent-plan-99718',
                'domain' => $parentDomain,
                'is_active' => 1,
                'depth' => 0,
                'allows_subtenants' => 1,
                'features' => '{}',
                'configuration' => '{"modules":{}}',
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );
        DB::table('tenants')->updateOrInsert(
            ['id' => $childId],
            [
                'name' => 'Child Plan Tenant 99719',
                'slug' => $childSlug,
                'domain' => '',
                'parent_id' => $parentId,
                'is_active' => 1,
                'depth' => 1,
                'allows_subtenants' => 0,
                'features' => '{}',
                'configuration' => '{"modules":{}}',
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );

        $this->prerenderMock->shouldReceive('routesForTenant')->andReturn(['/']);
        $this->expectValidHomepageSitemap();

        $decoded = $this->callAndDecode(['--tenant' => $childSlug]);
        $row = $decoded['tenants'][0] ?? null;
        $this->assertIsArray($row);
        $this->assertSame($parentDomain, $row['host']);
        $this->assertSame('/' . $childSlug, $row['prefix']);
    }
}
