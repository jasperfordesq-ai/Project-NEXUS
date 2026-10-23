<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Feature tests for SitemapController — public XML sitemap endpoints.
 *
 * Routes are served WITHOUT the /api prefix:
 *   GET /sitemap.xml         → Sitemap index
 *   GET /sitemap-{slug}.xml  → Per-tenant sitemap
 */
class SitemapControllerTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
    }

    // =========================================================================
    // GET /sitemap.xml
    // =========================================================================

    public function test_sitemap_index_returns_200(): void
    {
        $response = $this->get('/sitemap.xml');
        $response->assertStatus(200);
    }

    public function test_sitemap_index_returns_xml_content_type(): void
    {
        $response = $this->get('/sitemap.xml');
        $response->assertHeader('Content-Type', 'application/xml; charset=UTF-8');
    }

    public function test_sitemap_index_contains_sitemapindex_root(): void
    {
        $host = $this->seedParentDomainWithSubTenant();

        $response = $this->withHeaders(['X-Sitemap-Host' => $host])->get('/sitemap.xml');
        $content = $response->getContent();

        $this->assertStringContainsString('<sitemapindex', $content);
        $this->assertStringContainsString('</sitemapindex>', $content);
        $this->assertStringContainsString('http://www.sitemaps.org/schemas/sitemap/0.9', $content);
    }

    public function test_sitemap_index_contains_tenant_sitemaps(): void
    {
        $host = $this->seedParentDomainWithSubTenant();

        $response = $this->withHeaders(['X-Sitemap-Host' => $host])->get('/sitemap.xml');
        $content = $response->getContent();

        $this->assertStringContainsString('<sitemap>', $content);
        $this->assertStringContainsString('<loc>', $content);
    }

    /**
     * Seed a parent tenant that owns a domain plus an active sub-tenant inheriting
     * that domain. The controller returns a <sitemapindex> (listing parent + sub
     * sitemaps) only for this topology; on the bare app/other domains it serves a
     * flat <urlset>. Returns the parent domain to pass as X-Sitemap-Host.
     */
    private function seedParentDomainWithSubTenant(): string
    {
        $domain = 'sitemap-parent-' . uniqid() . '.test';

        DB::table('tenants')->updateOrInsert(
            ['id' => $this->testTenantId],
            ['domain' => $domain, 'is_active' => true, 'updated_at' => now()]
        );

        DB::table('tenants')->updateOrInsert(
            ['id' => 999],
            [
                'name'              => 'Sitemap Sub Tenant',
                'slug'              => 'sitemap-sub-' . uniqid(),
                'domain'            => null,
                'parent_id'         => $this->testTenantId,
                'is_active'         => true,
                'depth'             => 1,
                'allows_subtenants' => false,
                'updated_at'        => now(),
            ]
        );

        return $domain;
    }

    public function test_sitemap_index_has_cache_headers(): void
    {
        $response = $this->get('/sitemap.xml');
        $response->assertHeader('Cache-Control');
    }

    public function test_sitemap_index_is_valid_xml(): void
    {
        $response = $this->get('/sitemap.xml');
        $content = $response->getContent();

        $doc = new \DOMDocument();
        $this->assertTrue(@$doc->loadXML($content), 'Sitemap index is not valid XML');
    }

    // =========================================================================
    // GET /sitemap-{slug}.xml
    // =========================================================================

    public function test_tenant_sitemap_returns_200_for_valid_slug(): void
    {
        $response = $this->get('/sitemap-hour-timebank.xml');
        $response->assertStatus(200);
    }

    public function test_tenant_sitemap_returns_xml_content_type(): void
    {
        $response = $this->get('/sitemap-hour-timebank.xml');
        $response->assertHeader('Content-Type', 'application/xml; charset=UTF-8');
    }

    public function test_tenant_sitemap_contains_urlset_root(): void
    {
        $response = $this->get('/sitemap-hour-timebank.xml');
        $content = $response->getContent();

        $this->assertStringContainsString('<urlset', $content);
        $this->assertStringContainsString('</urlset>', $content);
    }

    public function test_tenant_sitemap_contains_urls(): void
    {
        $response = $this->get('/sitemap-hour-timebank.xml');
        $content = $response->getContent();

        $this->assertStringContainsString('<url>', $content);
        $this->assertStringContainsString('<loc>', $content);
    }

    public function test_tenant_sitemap_returns_404_for_unknown_slug(): void
    {
        $response = $this->get('/sitemap-nonexistent-tenant.xml');
        $response->assertStatus(404);
    }

    public function test_tenant_sitemap_404_still_returns_xml(): void
    {
        $response = $this->get('/sitemap-nonexistent-tenant.xml');

        $response->assertHeader('Content-Type', 'application/xml; charset=UTF-8');
        $content = $response->getContent();
        $this->assertStringContainsString('<urlset', $content);
    }

    public function test_tenant_sitemap_is_valid_xml(): void
    {
        $response = $this->get('/sitemap-hour-timebank.xml');
        $content = $response->getContent();

        $doc = new \DOMDocument();
        $this->assertTrue(@$doc->loadXML($content), 'Tenant sitemap is not valid XML');
    }

    public function test_tenant_sitemap_includes_homepage(): void
    {
        $response = $this->get('/sitemap-hour-timebank.xml');
        $content = $response->getContent();

        $this->assertStringContainsString('<priority>1.0</priority>', $content);
    }

    public function test_tenant_sitemap_urls_are_frontend_urls(): void
    {
        $response = $this->get('/sitemap-hour-timebank.xml');
        $content = $response->getContent();

        // URLs should point to the frontend, not the API backend
        preg_match_all('/<loc>([^<]+)<\/loc>/', $content, $matches);
        foreach ($matches[1] as $url) {
            $this->assertStringNotContainsString('/api/', $url, "Sitemap URL should not contain /api/: {$url}");
        }
    }

    // =========================================================================
    // Edge cases
    // =========================================================================

    public function test_sitemap_slug_allows_hyphens(): void
    {
        $response = $this->get('/sitemap-hour-timebank.xml');
        $response->assertStatus(200);
    }

    public function test_sitemap_slug_rejects_path_traversal(): void
    {
        // The route constraint only allows [a-zA-Z0-9_-]
        $response = $this->get('/sitemap-../etc/passwd.xml');
        $response->assertStatus(404);
    }

    // =========================================================================
    // "Auto Sitemap" switch on /admin/seo (seo_auto_sitemap, 2026-10-22)
    // =========================================================================

    private function seedSingleTenantDomain(): string
    {
        $domain = 'sitemap-single-' . uniqid() . '.test';
        DB::table('tenants')->updateOrInsert(
            ['id' => $this->testTenantId],
            ['domain' => $domain, 'is_active' => true, 'updated_at' => now()]
        );
        return $domain;
    }

    public function test_sitemap_is_served_while_the_auto_sitemap_switch_is_on(): void
    {
        $host = $this->seedSingleTenantDomain();
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'seo_auto_sitemap'],
            ['setting_value' => '1', 'setting_type' => 'boolean', 'updated_at' => now()]
        );

        $response = $this->withHeaders(['X-Sitemap-Host' => $host])->get('/sitemap.xml');
        $response->assertStatus(200);
        $this->assertStringContainsString('<urlset', $response->getContent());
    }

    /** Until 2026-10-22 the switch saved and nothing read it. */
    public function test_sitemap_answers_404_when_the_auto_sitemap_switch_is_off(): void
    {
        $host = $this->seedSingleTenantDomain();
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'seo_auto_sitemap'],
            ['setting_value' => '0', 'setting_type' => 'boolean', 'updated_at' => now()]
        );

        $response = $this->withHeaders(['X-Sitemap-Host' => $host])->get('/sitemap.xml');
        $response->assertStatus(404);
        $this->assertStringNotContainsString('<loc>', $response->getContent());

        $slug = (string) DB::table('tenants')->where('id', $this->testTenantId)->value('slug');
        $perTenant = $this->withHeaders(['X-Sitemap-Host' => $host])->get('/sitemap-' . $slug . '.xml');
        $perTenant->assertStatus(404);
    }

    // =========================================================================
    // A community's sitemap only on its own address (2026-10-23)
    // =========================================================================

    public function test_tenant_sitemap_on_the_app_host_keeps_the_community_folder(): void
    {
        DB::table('tenants')->where('id', $this->testTenantId)->update(['domain' => null, 'parent_id' => null]);
        $slug = (string) DB::table('tenants')->where('id', $this->testTenantId)->value('slug');
        $appHost = (string) parse_url((string) env('FRONTEND_URL', 'https://app.project-nexus.ie'), PHP_URL_HOST);

        $content = (string) $this->withHeaders(['X-Sitemap-Host' => $appHost])
            ->get('/sitemap-' . $slug . '.xml')->assertOk()->getContent();

        preg_match_all('#<loc>([^<]+)</loc>#', $content, $m);
        $this->assertNotEmpty($m[1]);
        foreach ($m[1] as $loc) {
            $this->assertStringContainsString('/' . $slug . '/', $loc . '/', "address keeps the folder: {$loc}");
        }
    }

    public function test_tenant_sitemap_is_refused_on_another_communitys_domain(): void
    {
        $slug = (string) DB::table('tenants')->where('id', $this->testTenantId)->value('slug');
        DB::table('tenants')->where('id', $this->testTenantId)->update(['domain' => 'own-' . uniqid() . '.test']);

        $this->withHeaders(['X-Sitemap-Host' => 'someone-else.test'])
            ->get('/sitemap-' . $slug . '.xml')
            ->assertStatus(404);
    }

    public function test_a_community_set_to_noindex_publishes_no_sitemap(): void
    {
        $host = 'noindex-' . uniqid() . '.test';
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'domain' => $host, 'robots_directive' => 'noindex, nofollow',
        ]);
        $slug = (string) DB::table('tenants')->where('id', $this->testTenantId)->value('slug');

        $this->withHeaders(['X-Sitemap-Host' => $host])->get('/sitemap.xml')->assertStatus(404);
        $this->withHeaders(['X-Sitemap-Host' => $host])->get('/sitemap-' . $slug . '.xml')->assertStatus(404);

        DB::table('tenants')->where('id', $this->testTenantId)->update(['robots_directive' => 'index, follow']);
        Cache::flush();
        $this->withHeaders(['X-Sitemap-Host' => $host])->get('/sitemap-' . $slug . '.xml')->assertOk();
    }

    public function test_the_app_host_sitemap_honours_the_switch_and_lists_the_platform_master(): void
    {
        $appHost = (string) parse_url((string) env('FRONTEND_URL', 'https://app.project-nexus.ie'), PHP_URL_HOST);
        DB::table('tenants')->where('id', $this->testTenantId)->update(['domain' => null, 'parent_id' => null, 'robots_directive' => 'index, follow']);
        $slug = (string) DB::table('tenants')->where('id', $this->testTenantId)->value('slug');
        DB::table('tenants')->where('id', 1)->update(['domain' => 'sales-site.example', 'is_active' => 1, 'robots_directive' => 'index, follow']);
        DB::table('tenant_settings')->whereIn('tenant_id', [1, $this->testTenantId])->where('setting_key', 'seo_auto_sitemap')->delete();
        Cache::flush();

        $xml = (string) $this->withHeaders(['X-Sitemap-Host' => $appHost])->get('/sitemap.xml')->getContent();
        $this->assertStringContainsString('/' . $slug . '/about</loc>', $xml);
        $this->assertMatchesRegularExpression('#<loc>https?://' . preg_quote($appHost, '#') . '(:\d+)?/about</loc>#', $xml, 'the master is listed at the app root');
        $this->assertStringNotContainsString('sales-site.example', $xml);

        DB::table('tenant_settings')->insert([
            'tenant_id' => $this->testTenantId, 'setting_key' => 'seo_auto_sitemap',
            'setting_value' => '0', 'setting_type' => 'boolean', 'updated_at' => now(),
        ]);
        Cache::flush();
        $xml = (string) $this->withHeaders(['X-Sitemap-Host' => $appHost])->get('/sitemap.xml')->getContent();
        $this->assertStringNotContainsString('/' . $slug . '/about</loc>', $xml);
    }

    public function test_the_admin_sitemap_link_is_the_real_address_and_says_when_none_is_published(): void
    {
        $host = 'stats-' . uniqid() . '.test';
        DB::table('tenants')->where('id', $this->testTenantId)->update(['domain' => $host, 'robots_directive' => 'index, follow']);
        DB::table('tenant_settings')->where('tenant_id', $this->testTenantId)->where('setting_key', 'seo_auto_sitemap')->delete();
        \Laravel\Sanctum\Sanctum::actingAs(\App\Models\User::factory()->forTenant($this->testTenantId)->admin()->create());

        $stats = $this->apiGet('/v2/admin/config/sitemap-stats')->assertOk();
        $stats->assertJsonPath('data.sitemap_url', 'https://' . $host . '/sitemap.xml');
        $stats->assertJsonPath('data.listed', true);

        DB::table('tenants')->where('id', $this->testTenantId)->update(['robots_directive' => 'noindex, nofollow']);
        $stats = $this->apiGet('/v2/admin/config/sitemap-stats')->assertOk();
        $stats->assertJsonPath('data.listed', false);
        $stats->assertJsonPath('data.not_listed_reason', 'noindex');
    }
}
