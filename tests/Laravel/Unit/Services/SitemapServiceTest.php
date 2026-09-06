<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Models\User;
use App\Services\SitemapService;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

/**
 * Unit tests for SitemapService — XML sitemap generation.
 *
 * Covers: index generation, per-tenant sitemaps, content type filtering,
 * feature/module gating, XML validity, caching, and edge cases.
 */
class SitemapServiceTest extends TestCase
{
    private SitemapService $service;
    private int $userId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new SitemapService();
        Cache::flush();

        // Get a valid user ID for FK-constrained inserts
        $user = DB::selectOne("SELECT id FROM users WHERE tenant_id = ? LIMIT 1", [$this->testTenantId]);
        $this->userId = $user ? (int) $user->id : 1;
    }

    // =========================================================================
    // generateIndex()
    // =========================================================================

    public function test_generateIndex_returns_valid_xml(): void
    {
        $xml = $this->service->generateIndex();

        $this->assertStringStartsWith('<?xml version="1.0" encoding="UTF-8"?>', $xml);
        $this->assertStringContainsString('<sitemapindex', $xml);
        $this->assertStringContainsString('</sitemapindex>', $xml);
        $this->assertStringContainsString('http://www.sitemaps.org/schemas/sitemap/0.9', $xml);
    }

    public function test_generateIndex_contains_active_tenants(): void
    {
        $xml = $this->service->generateIndex();

        // Should include the test tenant (hour-timebank)
        $this->assertStringContainsString('sitemap-hour-timebank.xml', $xml);
    }

    public function test_generateIndex_uses_main_for_empty_slug(): void
    {
        // Ensure tenant 1 exists with empty slug
        DB::table('tenants')->updateOrInsert(
            ['id' => 1],
            ['name' => 'Master', 'slug' => '', 'is_active' => 1, 'depth' => 0, 'allows_subtenants' => false, 'created_at' => now(), 'updated_at' => now()]
        );

        Cache::flush();
        $xml = $this->service->generateIndex();
        $this->assertStringContainsString('sitemap-main.xml', $xml);
    }

    public function test_generateIndex_excludes_inactive_tenants(): void
    {
        DB::table('tenants')->insertOrIgnore([
            'id' => 998,
            'name' => 'Inactive Tenant',
            'slug' => 'inactive-test',
            'is_active' => 0,
            'depth' => 0,
            'allows_subtenants' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Cache::flush();
        $xml = $this->service->generateIndex();
        $this->assertStringNotContainsString('inactive-test', $xml);
    }

    public function test_generateIndex_is_cached(): void
    {
        $xml1 = $this->service->generateIndex();
        $xml2 = $this->service->generateIndex();
        $this->assertSame($xml1, $xml2);
    }

    public function test_aggregate_sitemaps_ignore_master_domain_but_honor_real_parent_domain(): void
    {
        $topology = $this->seedParentDomainParityTopology();

        try {
            Cache::flush();
            $indexXml = $this->service->generateIndex();
            $appDomainXml = $this->service->generateForAppDomain();
            $frontendBase = rtrim((string) env('FRONTEND_URL', 'https://app.project-nexus.ie'), '/');

            $this->assertStringContainsString(
                "{$frontendBase}/sitemap-{$topology['master_child_slug']}.xml",
                $indexXml
            );
            $this->assertStringNotContainsString(
                "https://{$topology['master_domain']}/sitemap-{$topology['master_child_slug']}.xml",
                $indexXml
            );
            $this->assertStringContainsString(
                "https://{$topology['real_parent_domain']}/sitemap-{$topology['real_child_slug']}.xml",
                $indexXml
            );

            $this->assertStringContainsString(
                "<loc>{$frontendBase}/{$topology['master_child_slug']}/</loc>",
                $appDomainXml
            );
            $this->assertStringNotContainsString(
                "/{$topology['real_child_slug']}/</loc>",
                $appDomainXml
            );
        } finally {
            $this->cleanupParentDomainParityTopology($topology);
        }
    }

    // =========================================================================
    // generateForTenant()
    // =========================================================================

    public function test_generateForTenant_returns_valid_xml(): void
    {
        $xml = $this->service->generateForTenant($this->testTenantId);

        $this->assertStringStartsWith('<?xml version="1.0" encoding="UTF-8"?>', $xml);
        $this->assertStringContainsString('<urlset', $xml);
        $this->assertStringContainsString('</urlset>', $xml);
    }

    public function test_generateForTenant_includes_homepage(): void
    {
        $xml = $this->service->generateForTenant($this->testTenantId);

        // Should have the base URL with tenant slug suffix ending in /
        $this->assertStringContainsString('<loc>', $xml);
        $this->assertStringContainsString('<priority>1.0</priority>', $xml);
    }

    public function test_tenant_base_url_ignores_master_domain_but_inherits_real_parent_domain(): void
    {
        $topology = $this->seedParentDomainParityTopology();

        try {
            Cache::flush();
            $masterChildXml = $this->service->generateForTenant($topology['master_child_id']);
            $realChildXml = $this->service->generateForTenant($topology['real_child_id']);
            $frontendBase = rtrim((string) env('FRONTEND_URL', 'https://app.project-nexus.ie'), '/');

            $this->assertStringContainsString(
                "<loc>{$frontendBase}/{$topology['master_child_slug']}/</loc>",
                $masterChildXml
            );
            $this->assertStringNotContainsString($topology['master_domain'], $masterChildXml);
            $this->assertStringContainsString(
                "<loc>https://{$topology['real_parent_domain']}/{$topology['real_child_slug']}/</loc>",
                $realChildXml
            );
        } finally {
            $this->cleanupParentDomainParityTopology($topology);
        }
    }

    public function test_generateForTenant_includes_static_pages(): void
    {
        $xml = $this->service->generateForTenant($this->testTenantId);

        $this->assertStringContainsString('/about', $xml);
        $this->assertStringContainsString('/help', $xml);
        $this->assertStringContainsString('/terms', $xml);
        $this->assertStringContainsString('/privacy', $xml);
    }

    public function test_static_sitemap_excludes_authenticated_feature_routes(): void
    {
        $original = DB::table('tenants')->where('id', $this->testTenantId)->first(['slug', 'features']);
        $this->assertNotNull($original);

        try {
            DB::table('tenants')->where('id', $this->testTenantId)->update([
                'slug' => 'sitemap-other-tenant',
                'features' => json_encode([
                    'marketplace' => true,
                    'courses' => true,
                    'podcasts' => true,
                ]),
            ]);
            Cache::flush();
            $xml = $this->service->generateForTenant($this->testTenantId, 'https://tenant.example');

            $this->assertStringNotContainsString('/marketplace/free', $xml);
            $this->assertStringNotContainsString('/marketplace/map', $xml);
            $this->assertStringNotContainsString('/courses', $xml);
            $this->assertStringNotContainsString('/podcasts', $xml);
            $this->assertStringNotContainsString('/impact-report', $xml);
            $this->assertStringNotContainsString('/development-status', $xml);
        } finally {
            DB::table('tenants')->where('id', $this->testTenantId)->update([
                'slug' => $original->slug,
                'features' => $original->features,
            ]);
            Cache::flush();
        }
    }

    public function test_hour_timebank_sitemap_includes_its_tenant_specific_marketing_pages(): void
    {
        $originalSlug = DB::table('tenants')->where('id', $this->testTenantId)->value('slug');
        try {
            DB::table('tenants')->where('id', $this->testTenantId)->update(['slug' => 'hour-timebank']);
            Cache::flush();
            $xml = $this->service->generateForTenant($this->testTenantId, 'https://hour.example');
            foreach (['/partner', '/social-prescribing', '/impact-summary', '/impact-report', '/strategic-plan'] as $route) {
                $this->assertStringContainsString($route, $xml);
            }
        } finally {
            DB::table('tenants')->where('id', $this->testTenantId)->update(['slug' => $originalSlug]);
            Cache::flush();
        }
    }

    public function test_sitemap_excludes_authenticated_course_and_podcast_detail_routes(): void
    {
        foreach (['courses', 'course_sections', 'course_lessons', 'course_reviews', 'podcast_shows', 'podcast_episodes', 'podcast_episode_chapters'] as $table) {
            if (!Schema::hasTable($table)) $this->markTestSkipped("{$table} table is unavailable");
        }

        $suffix = strtolower(str_replace('.', '', uniqid('', true)));
        $originalFeatures = DB::table('tenants')->where('id', $this->testTenantId)->value('features');
        $courseId = null;
        $showId = null;
        $episodeId = null;
        try {
            $features = json_decode((string) $originalFeatures, true) ?: [];
            $features['courses'] = true;
            $features['podcasts'] = true;
            DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);

            $courseId = DB::table('courses')->insertGetId([
                'tenant_id' => $this->testTenantId,
                'author_user_id' => $this->userId,
                'title' => 'Public sitemap course',
                'slug' => "sitemap-course-{$suffix}",
                'visibility' => 'public',
                'status' => 'published',
                'moderation_status' => 'approved',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            $showId = DB::table('podcast_shows')->insertGetId([
                'tenant_id' => $this->testTenantId,
                'owner_user_id' => $this->userId,
                'title' => 'Public sitemap show',
                'slug' => "sitemap-show-{$suffix}",
                'visibility' => 'public',
                'status' => 'published',
                'moderation_status' => 'approved',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            $episodeId = DB::table('podcast_episodes')->insertGetId([
                'tenant_id' => $this->testTenantId,
                'show_id' => $showId,
                'author_user_id' => $this->userId,
                'title' => 'Public sitemap episode',
                'slug' => "sitemap-episode-{$suffix}",
                'audio_url' => 'https://cdn.example.test/episode.mp3',
                'visibility' => 'inherit',
                'status' => 'published',
                'moderation_status' => 'approved',
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            Cache::flush();
            $xml = $this->service->generateForTenant($this->testTenantId, 'https://learning.example');
            $this->assertStringNotContainsString("/courses/sitemap-course-{$suffix}", $xml);
            $this->assertStringNotContainsString("/podcasts/sitemap-show-{$suffix}", $xml);
            $this->assertStringNotContainsString(
                "/podcasts/sitemap-show-{$suffix}/sitemap-episode-{$suffix}",
                $xml
            );
        } finally {
            if ($episodeId) DB::table('podcast_episodes')->where('id', $episodeId)->delete();
            if ($showId) DB::table('podcast_shows')->where('id', $showId)->delete();
            if ($courseId) DB::table('courses')->where('id', $courseId)->delete();
            DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => $originalFeatures]);
            Cache::flush();
        }
    }

    public function test_generateForTenant_returns_empty_for_nonexistent_tenant(): void
    {
        $xml = $this->service->generateForTenant(99999);

        $this->assertStringContainsString('<urlset', $xml);
        $this->assertStringNotContainsString('<url>', $xml);
    }

    public function test_generateForTenant_includes_published_blog_posts(): void
    {
        // Blog data lives in the `posts` table (not `blog_posts`)
        DB::table('posts')->insertOrIgnore([
            'id' => 90001,
            'tenant_id' => $this->testTenantId,
            'author_id' => $this->userId,
            'title' => 'Test Blog Post',
            'slug' => 'test-sitemap-blog-post',
            'content' => 'Test content for sitemap',
            'status' => 'published',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Cache::flush();
        $xml = $this->service->generateForTenant($this->testTenantId);
        $this->assertStringContainsString('/blog/test-sitemap-blog-post', $xml);
    }

    public function test_generateForTenant_excludes_draft_blog_posts(): void
    {
        DB::table('posts')->insertOrIgnore([
            'id' => 90002,
            'tenant_id' => $this->testTenantId,
            'author_id' => $this->userId,
            'title' => 'Draft Post',
            'slug' => 'draft-post-sitemap',
            'content' => 'Draft content',
            'status' => 'draft',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Cache::flush();
        $xml = $this->service->generateForTenant($this->testTenantId);
        $this->assertStringNotContainsString('draft-post-sitemap', $xml);
    }

    public function test_generateForTenant_excludes_placeholder_blog_posts(): void
    {
        DB::table('posts')->insertOrIgnore([
            [
                'id' => 90003,
                'tenant_id' => $this->testTenantId,
                'author_id' => $this->userId,
                'title' => 'Aenean sed pulvinar et diam',
                'slug' => 'aenean-sed-pulvinar-et-diam',
                'content' => 'Real-looking title with placeholder body.',
                'status' => 'published',
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'id' => 90004,
                'tenant_id' => $this->testTenantId,
                'author_id' => $this->userId,
                'title' => 'Placeholder Ipsum',
                'slug' => 'placeholder-ipsum-sitemap',
                'content' => 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
                'status' => 'published',
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        Cache::flush();
        $xml = $this->service->generateForTenant($this->testTenantId);

        $this->assertStringNotContainsString('aenean-sed-pulvinar-et-diam', $xml);
        $this->assertStringNotContainsString('placeholder-ipsum-sitemap', $xml);
    }

    public function test_generateForTenant_excludes_authenticated_active_listings(): void
    {
        $id = DB::table('listings')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $this->userId,
            'title' => 'Sitemap Test Listing',
            'description' => 'A listing for sitemap testing',
            'status' => 'active',
            'type' => 'offer',
            'created_at' => now(),
        ]);

        Cache::flush();
        $xml = $this->service->generateForTenant($this->testTenantId);
        $this->assertStringNotContainsString("/listings/{$id}", $xml);
    }

    public function test_generateForTenant_excludes_expired_listings(): void
    {
        $id = DB::table('listings')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $this->userId,
            'title' => 'Expired Listing',
            'description' => 'This listing has expired',
            'status' => 'active',
            'type' => 'offer',
            'expires_at' => now()->subDays(5),
            'created_at' => now(),
        ]);

        Cache::flush();
        $xml = $this->service->generateForTenant($this->testTenantId);
        $this->assertStringNotContainsString("/listings/{$id}", $xml);
    }

    // Member-authored content types require authentication and stay out of the
    // public sitemap even when their records use a historical "public" flag.

    public function test_generateForTenant_excludes_authenticated_groups(): void
    {
        // getGroupUrls() selects public + active groups for the tenant. The clean
        // CI DB has none, so seed one to exercise the per-group URL path.
        $id = DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $this->userId,
            'name' => 'Public Sitemap Group',
            'visibility' => 'public',
            'is_active' => 1,
            'status' => 'active',
            'created_at' => now(),
        ]);

        Cache::flush();
        $xml = $this->service->generateForTenant($this->testTenantId);
        $this->assertStringNotContainsString("/groups/{$id}", $xml);
    }

    public function test_generateForTenant_excludes_events_listing(): void
    {
        Cache::flush();
        $xml = $this->service->generateForTenant($this->testTenantId);
        $this->assertStringNotContainsString('/events', $xml);
    }

    public function test_generateForTenant_excludes_knowledge_base_routes(): void
    {
        Cache::flush();
        $xml = $this->service->generateForTenant($this->testTenantId);
        $this->assertStringNotContainsString('/kb', $xml);
    }

    public function test_generateForTenant_excludes_volunteer_organisations_when_volunteering_enabled(): void
    {
        [$tenantId, $userId] = $this->seedSitemapTenant([
            'volunteering' => true,
            'organisations' => false,
        ]);
        $orgId = $this->seedVolunteerOrganization($tenantId, $userId, 'active');

        Cache::flush();
        $xml = $this->service->generateForTenant($tenantId);

        $this->assertStringNotContainsString('/organisations', $xml);
        $this->assertStringNotContainsString("/organisations/{$orgId}", $xml);
    }

    public function test_generateForTenant_excludes_volunteer_organisations_when_volunteering_disabled(): void
    {
        [$tenantId, $userId] = $this->seedSitemapTenant([
            'volunteering' => false,
            'organisations' => true,
        ]);
        $orgId = $this->seedVolunteerOrganization($tenantId, $userId, 'active');

        Cache::flush();
        $xml = $this->service->generateForTenant($tenantId);

        $this->assertStringNotContainsString('/organisations', $xml);
        $this->assertStringNotContainsString("/organisations/{$orgId}", $xml);
    }

    public function test_generateForTenant_excludes_all_volunteer_opportunities(): void
    {
        [$tenantId, $userId] = $this->seedSitemapTenant(['volunteering' => true]);
        $activeOrgId = $this->seedVolunteerOrganization($tenantId, $userId, 'approved');
        $pendingOrgId = $this->seedVolunteerOrganization($tenantId, $userId, 'pending');
        $activeOpportunityId = $this->seedVolunteerOpportunity($tenantId, $userId, $activeOrgId, 'active');
        $pendingOrgOpportunityId = $this->seedVolunteerOpportunity($tenantId, $userId, $pendingOrgId, 'active');
        $closedOpportunityId = $this->seedVolunteerOpportunity($tenantId, $userId, $activeOrgId, 'closed');

        Cache::flush();
        $xml = $this->service->generateForTenant($tenantId);

        $this->assertStringNotContainsString("/volunteering/opportunities/{$activeOpportunityId}", $xml);
        $this->assertStringNotContainsString("/volunteering/opportunities/{$pendingOrgOpportunityId}", $xml);
        $this->assertStringNotContainsString("/volunteering/opportunities/{$closedOpportunityId}", $xml);
    }

    public function test_clearCache_invalidates_override_base_url_tenant_sitemap_variants(): void
    {
        [$tenantId] = $this->seedSitemapTenant([]);
        $overrideBaseUrl = 'https://sitemap-variant.example.test';
        $slug = 'sitemap-cache-page-' . strtolower(str_replace('.', '', uniqid('', true)));

        Cache::flush();
        $before = $this->service->generateForTenant($tenantId, $overrideBaseUrl);
        $pageId = DB::table('pages')->insertGetId([
            'tenant_id' => $tenantId,
            'title' => 'Sitemap cache page',
            'slug' => $slug,
            'content' => 'Public CMS cache test',
            'is_published' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        try {
            $stale = $this->service->generateForTenant($tenantId, $overrideBaseUrl);
            $this->assertSame($before, $stale);

            $this->service->clearCache($tenantId);
            $fresh = $this->service->generateForTenant($tenantId, $overrideBaseUrl);

            $this->assertStringContainsString("/page/{$slug}", $fresh);
        } finally {
            DB::table('pages')->where('id', $pageId)->delete();
        }
    }

    public function test_runtime_force_fresh_sitemap_bypasses_cached_tenant_variant(): void
    {
        [$tenantId] = $this->seedSitemapTenant([]);
        $overrideBaseUrl = 'https://fresh-sitemap.example.test';
        $slug = 'fresh-sitemap-page-' . strtolower(str_replace('.', '', uniqid('', true)));

        Cache::flush();
        $before = $this->service->generateForTenant($tenantId, $overrideBaseUrl);
        $pageId = DB::table('pages')->insertGetId([
            'tenant_id' => $tenantId,
            'title' => 'Fresh sitemap page',
            'slug' => $slug,
            'content' => 'Public CMS fresh-cache test',
            'is_published' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->assertSame($before, $this->service->generateForTenant($tenantId, $overrideBaseUrl));

        try {
            config(['prerender.runtime_force_fresh_sitemap' => true]);
            try {
                $fresh = $this->service->generateForTenant($tenantId, $overrideBaseUrl);
            } finally {
                config(['prerender.runtime_force_fresh_sitemap' => false]);
            }

            $this->assertStringContainsString("/page/{$slug}", $fresh);
        } finally {
            DB::table('pages')->where('id', $pageId)->delete();
        }
    }

    public function test_generateForTenant_excludes_profiles(): void
    {
        Cache::flush();
        $xml = $this->service->generateForTenant($this->testTenantId);
        // Profiles require per-user consent — excluded
        $this->assertStringNotContainsString('/profile/', $xml);
    }

    public function test_generateForTenant_is_cached(): void
    {
        $xml1 = $this->service->generateForTenant($this->testTenantId);
        $xml2 = $this->service->generateForTenant($this->testTenantId);
        $this->assertSame($xml1, $xml2);
    }

    // =========================================================================
    // XML structure & protocol compliance
    // =========================================================================

    public function test_xml_is_well_formed(): void
    {
        $xml = $this->service->generateForTenant($this->testTenantId);

        $doc = new \DOMDocument();
        $loaded = @$doc->loadXML($xml);
        $this->assertTrue($loaded, 'Generated sitemap XML is not well-formed');
    }

    public function test_index_xml_is_well_formed(): void
    {
        $xml = $this->service->generateIndex();

        $doc = new \DOMDocument();
        $loaded = @$doc->loadXML($xml);
        $this->assertTrue($loaded, 'Generated sitemap index XML is not well-formed');
    }

    public function test_urls_have_required_loc_element(): void
    {
        $xml = $this->service->generateForTenant($this->testTenantId);

        // Every <url> should contain a <loc>
        preg_match_all('/<url>(.*?)<\/url>/s', $xml, $matches);
        foreach ($matches[1] as $urlBlock) {
            $this->assertStringContainsString('<loc>', $urlBlock);
        }
    }

    public function test_urls_have_valid_changefreq(): void
    {
        $xml = $this->service->generateForTenant($this->testTenantId);

        $validFreqs = ['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never'];

        preg_match_all('/<changefreq>([^<]+)<\/changefreq>/', $xml, $matches);
        foreach ($matches[1] as $freq) {
            $this->assertContains($freq, $validFreqs, "Invalid changefreq: {$freq}");
        }
    }

    public function test_urls_have_valid_priority(): void
    {
        $xml = $this->service->generateForTenant($this->testTenantId);

        preg_match_all('/<priority>([^<]+)<\/priority>/', $xml, $matches);
        foreach ($matches[1] as $priority) {
            $val = (float) $priority;
            $this->assertGreaterThanOrEqual(0.0, $val);
            $this->assertLessThanOrEqual(1.0, $val);
        }
    }

    public function test_urls_have_valid_lastmod_dates(): void
    {
        $xml = $this->service->generateForTenant($this->testTenantId);

        preg_match_all('/<lastmod>([^<]+)<\/lastmod>/', $xml, $matches);
        foreach ($matches[1] as $date) {
            // Full W3C/ISO-8601 timestamps preserve same-day edit precision for
            // the prerender drift detector.
            $this->assertNotFalse(\DateTimeImmutable::createFromFormat(DATE_ATOM, $date), "Invalid lastmod timestamp: {$date}");
        }
    }

    public function test_xml_escapes_special_characters(): void
    {
        // The escapeXml method should handle &, <, >, ", '
        $service = new SitemapService();
        $xml = $service->generateForTenant($this->testTenantId);

        // URLs in sitemaps should never contain unescaped & or <
        $this->assertStringNotContainsString('& ', $xml);
    }

    // =========================================================================
    // resolveTenantBySlug() — REMOVED
    //
    // SitemapService::resolveTenantBySlug() was deleted as dead code in commit
    // 983f43d5a once SitemapController::tenant() was refactored to resolve the
    // slug→tenant mapping with direct DB queries (including a 'main' special-case).
    // No service method remains to unit-test, and the controller's inline
    // resolution is covered by the controller/feature suite. The three former
    // unit tests here are intentionally dropped rather than retargeted at a
    // private controller code path.
    // =========================================================================

    // =========================================================================
    // clearCache()
    // =========================================================================

    public function test_clearCache_clears_all(): void
    {
        // Warm cache
        $this->service->generateIndex();
        $this->service->generateForTenant($this->testTenantId);

        $cleared = $this->service->clearCache();
        $this->assertGreaterThan(0, $cleared);
    }

    public function test_clearCache_clears_specific_tenant(): void
    {
        $this->service->generateForTenant($this->testTenantId);

        $cleared = $this->service->clearCache($this->testTenantId);
        $this->assertSame(2, $cleared); // tenant cache + index
    }

    // =========================================================================
    // getStats()
    // =========================================================================

    public function test_getStats_returns_totals(): void
    {
        $stats = $this->service->getStats($this->testTenantId);

        $this->assertArrayHasKey('total_urls', $stats);
        $this->assertArrayHasKey('content_types', $stats);
        $this->assertIsInt($stats['total_urls']);
        $this->assertIsArray($stats['content_types']);
        $this->assertGreaterThan(0, $stats['total_urls']); // At minimum, static pages
    }

    public function test_getStats_returns_zero_for_nonexistent_tenant(): void
    {
        $stats = $this->service->getStats(99999);
        $this->assertSame(0, $stats['total_urls']);
    }

    // =========================================================================
    // Tenant isolation
    // =========================================================================

    public function test_sitemap_does_not_leak_cross_tenant_content(): void
    {
        // Seed content for tenant 999
        DB::table('posts')->insertOrIgnore([
            'id' => 90099,
            'tenant_id' => 999,
            'author_id' => $this->userId,
            'title' => 'Cross Tenant Post',
            'slug' => 'cross-tenant-post-sitemap',
            'content' => 'This belongs to another tenant',
            'status' => 'published',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Cache::flush();
        $xml = $this->service->generateForTenant($this->testTenantId);
        $this->assertStringNotContainsString('cross-tenant-post-sitemap', $xml);
    }

    /**
     * @return array{0:int,1:int}
     */
    private function seedSitemapTenant(array $features = []): array
    {
        $now = now();
        $suffix = uniqid();
        $tenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'Sitemap Tenant ' . $suffix,
            'slug' => 'sitemap-tenant-' . $suffix,
            'domain' => null,
            'is_active' => 1,
            'depth' => 0,
            'allows_subtenants' => false,
            'features' => json_encode($features),
            'configuration' => json_encode(['modules' => []]),
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        $user = User::factory()->forTenant($tenantId)->create([
            'is_approved' => 1,
            'status' => 'active',
        ]);

        return [$tenantId, (int) $user->id];
    }

    /**
     * @return array{
     *     master_existed:bool,
     *     master_original:?object,
     *     master_domain:string,
     *     real_parent_id:int,
     *     real_parent_domain:string,
     *     master_child_id:int,
     *     master_child_slug:string,
     *     real_child_id:int,
     *     real_child_slug:string
     * }
     */
    private function seedParentDomainParityTopology(): array
    {
        $now = now();
        $suffix = strtolower(str_replace('.', '', uniqid('', true)));
        $masterOriginal = DB::table('tenants')->where('id', 1)->first([
            'domain',
            'is_active',
        ]);
        $masterDomain = "master-parent-{$suffix}.example.test";
        $realParentDomain = "real-parent-{$suffix}.example.test";

        if ($masterOriginal !== null) {
            DB::table('tenants')->where('id', 1)->update([
                'domain' => $masterDomain,
                'is_active' => true,
            ]);
        } else {
            DB::table('tenants')->insert([
                'id' => 1,
                'name' => 'Master',
                'slug' => '',
                'domain' => $masterDomain,
                'is_active' => true,
                'depth' => 0,
                'allows_subtenants' => true,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }

        $realParentId = (int) DB::table('tenants')->insertGetId([
            'name' => 'Real Sitemap Parent',
            'slug' => "real-parent-{$suffix}",
            'domain' => $realParentDomain,
            'is_active' => true,
            'depth' => 0,
            'allows_subtenants' => true,
            'features' => '{}',
            'configuration' => '{}',
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $masterChildSlug = "master-child-{$suffix}";
        $masterChildId = (int) DB::table('tenants')->insertGetId([
            'name' => 'Master Parent Sitemap Child',
            'slug' => $masterChildSlug,
            'domain' => null,
            'parent_id' => 1,
            'is_active' => true,
            'depth' => 1,
            'allows_subtenants' => false,
            'features' => '{}',
            'configuration' => '{}',
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $realChildSlug = "real-child-{$suffix}";
        $realChildId = (int) DB::table('tenants')->insertGetId([
            'name' => 'Real Parent Sitemap Child',
            'slug' => $realChildSlug,
            'domain' => null,
            'parent_id' => $realParentId,
            'is_active' => true,
            'depth' => 1,
            'allows_subtenants' => false,
            'features' => '{}',
            'configuration' => '{}',
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        return [
            'master_existed' => $masterOriginal !== null,
            'master_original' => $masterOriginal,
            'master_domain' => $masterDomain,
            'real_parent_id' => $realParentId,
            'real_parent_domain' => $realParentDomain,
            'master_child_id' => $masterChildId,
            'master_child_slug' => $masterChildSlug,
            'real_child_id' => $realChildId,
            'real_child_slug' => $realChildSlug,
        ];
    }

    /** @param array<string, mixed> $topology */
    private function cleanupParentDomainParityTopology(array $topology): void
    {
        DB::table('tenants')->whereIn('id', [
            $topology['master_child_id'],
            $topology['real_child_id'],
        ])->delete();
        DB::table('tenants')->where('id', $topology['real_parent_id'])->delete();

        if ($topology['master_existed']) {
            DB::table('tenants')->where('id', 1)->update([
                'domain' => $topology['master_original']->domain,
                'is_active' => $topology['master_original']->is_active,
            ]);
        } else {
            DB::table('tenants')->where('id', 1)->delete();
        }

        Cache::flush();
    }

    private function seedVolunteerOrganization(int $tenantId, int $userId, string $status): int
    {
        $now = now();
        $suffix = uniqid();

        return (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $tenantId,
            'user_id' => $userId,
            'name' => 'Sitemap Volunteer Org ' . $suffix,
            'slug' => 'sitemap-vol-org-' . $suffix,
            'description' => 'Volunteer organisation used by sitemap regression tests.',
            'contact_email' => 'sitemap-vol-org-' . $suffix . '@example.test',
            'status' => $status,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    }

    private function seedVolunteerOpportunity(int $tenantId, int $userId, int $orgId, string $status): int
    {
        $now = now();
        $suffix = uniqid();

        return (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $tenantId,
            'organization_id' => $orgId,
            'created_by' => $userId,
            'title' => 'Sitemap Volunteer Opportunity ' . $suffix,
            'description' => 'Volunteer opportunity used by sitemap regression tests.',
            'location' => 'Remote',
            'status' => $status,
            'is_active' => 1,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    }

    // =========================================================================
    // Sitemap <-> prerender route plan parity.
    //
    // These are two separately maintained lists. On 2026-08-12 /install-app was
    // added to the sitemap but not to PrerenderService::ALWAYS_PUBLIC_ROUTES;
    // the prerender drift sweep then threw
    // "Route is not available for tenant in enqueueJob: /install-app" on every
    // 2-minute pass. Nothing compared the two lists, so nothing caught it.
    // =========================================================================

    public function test_every_static_sitemap_route_is_in_the_prerender_route_plan(): void
    {
        $xml = $this->service->generateForTenant($this->testTenantId, 'https://parity.example');
        $this->assertNotEmpty($xml, 'sitemap fixture produced no XML');

        $this->assertTrue(preg_match_all('#<loc>(.*?)</loc>#i', $xml, $m) > 0);

        $prerender = app(\App\Services\PrerenderService::class);
        $plan = $prerender->routesForTenant($this->testTenantId);
        $this->assertNotEmpty($plan, 'prerender route plan for the test tenant is empty');

        $missing = [];
        foreach ($m[1] as $loc) {
            $route = (string) parse_url(html_entity_decode($loc), PHP_URL_PATH);
            $route = '/' . ltrim($route, '/');
            if ($route === '/') {
                $route = '/';
            }
            // Only the static floor is compared here. Dynamic content routes
            // (/blog/{slug}, /listings/{id}, ...) are admitted to the plan from
            // the sitemap itself, so they cannot drift the way a hand-written
            // static route can.
            if (preg_match('#^/(?:blog|listings|events|groups|jobs|volunteering|organisations|ideation|kb|coupons|page)/#', $route)) {
                continue;
            }
            if (!in_array($route, $plan, true)) {
                $missing[] = $route;
            }
        }

        $this->assertSame(
            [],
            array_values(array_unique($missing)),
            'These routes are published in the sitemap but are absent from '
            . 'PrerenderService::ALWAYS_PUBLIC_ROUTES / FEATURE_GATED_ROUTES / '
            . 'MODULE_GATED_ROUTES, so prerender:detect-drift will reject them. '
            . 'Add them to the prerender route plan (or remove them from the sitemap).'
        );
    }
}
