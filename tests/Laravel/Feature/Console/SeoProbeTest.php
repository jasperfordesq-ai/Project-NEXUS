<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Console;

use App\Services\PrerenderService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * seo:probe fetches each community as Googlebot and fails (alerting) when what
 * search engines receive is wrong (2026-10-23). The web is faked here.
 */
class SeoProbeTest extends TestCase
{
    use DatabaseTransactions;

    private string $host = 'probe-community.test';

    protected function setUp(): void
    {
        parent::setUp();
        $prerender = Mockery::mock(PrerenderService::class);
        $prerender->shouldReceive('loadTenantTargets')->andReturn([
            ['tenant_id' => $this->testTenantId, 'slug' => 'probe', 'host' => $this->host, 'prefix' => '', 'features' => null, 'configuration' => null],
        ]);
        $this->app->instance(PrerenderService::class, $prerender);
        DB::table('tenants')->where('id', $this->testTenantId)->update(['robots_directive' => 'index, follow']);
        DB::table('tenant_settings')->where('tenant_id', $this->testTenantId)->where('setting_key', 'seo_auto_sitemap')->delete();
    }

    private function page(string $path, string $extraHead = ''): string
    {
        return '<!doctype html><html><head><!-- a <title> in a comment does not count -->'
            . '<title>Probe community</title>'
            . '<link rel="canonical" href="https://' . $this->host . $path . '">' . $extraHead
            . '</head><body><h1>Hi</h1></body></html>';
    }

    private function fakeSite(array $override = []): void
    {
        $h = $this->host;
        Http::fake(array_merge([
            "https://{$h}/about" => Http::response($this->page('/about')),
            "https://{$h}/sitemap.xml" => Http::response('<urlset><url><loc>https://' . $h . '/</loc></url></urlset>'),
            "https://{$h}/llms.txt" => Http::response('# Probe'),
            "https://{$h}/robots.txt" => Http::response("User-agent: *\nSitemap: https://{$h}/sitemap.xml\n"),
            "https://{$h}/" => Http::response($this->page('/')),
        ], $override));
    }

    public function test_a_healthy_community_passes(): void
    {
        $this->fakeSite();
        $this->artisan('seo:probe')->assertExitCode(0);
    }

    public function test_a_wrong_canonical_a_stray_noindex_and_a_missing_sitemap_fail(): void
    {
        $h = $this->host;
        $this->fakeSite([
            "https://{$h}/about" => Http::response(str_replace("https://{$h}/about", 'https://elsewhere.test/about', $this->page('/about'))),
            "https://{$h}/" => Http::response($this->page('/', '<meta name="robots" content="noindex, nofollow">')),
            "https://{$h}/sitemap.xml" => Http::response('', 404),
        ]);

        $this->artisan('seo:probe')
            ->expectsOutputToContain('canonical is https://elsewhere.test/about')
            ->expectsOutputToContain('says noindex but the community is not hidden')
            ->expectsOutputToContain('sitemap.xml: HTTP 404')
            ->assertExitCode(1);
    }

    public function test_a_hidden_community_must_say_noindex_and_publish_nothing(): void
    {
        DB::table('tenants')->where('id', $this->testTenantId)->update(['robots_directive' => 'noindex, nofollow']);
        $h = $this->host;
        $this->fakeSite([
            "https://{$h}/sitemap.xml" => Http::response('', 404),
            "https://{$h}/llms.txt" => Http::response('', 404),
            "https://{$h}/about" => Http::response($this->page('/about', '<meta name="robots" content="noindex, nofollow">')),
            "https://{$h}/" => Http::response($this->page('/', '<meta name="robots" content="noindex, nofollow">')),
        ]);
        $this->artisan('seo:probe')->assertExitCode(0);
    }

    public function test_an_accessible_first_community_must_point_at_and_publish_its_accessible_site(): void
    {
        $acc = 'access-probe.test';
        DB::table('tenants')->where('id', $this->testTenantId)->update(['accessible_domain' => $acc]);
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'seo_primary_site'],
            ['setting_value' => 'accessible', 'setting_type' => 'string', 'updated_at' => now()]
        );
        $h = $this->host;
        $page = fn (string $path) => '<html><head><title>Probe</title><link rel="canonical" href="https://' . $acc . $path . '"></head></html>';
        Http::fake([
            "https://{$h}/about" => Http::response($page('/about')),
            "https://{$h}/sitemap.xml" => Http::response('', 404),
            "https://{$acc}/sitemap.xml" => Http::response('<urlset><url><loc>https://' . $acc . '/</loc></url></urlset>'),
            "https://{$h}/llms.txt" => Http::response('# Probe'),
            "https://{$h}/robots.txt" => Http::response("Sitemap: https://{$h}/sitemap.xml\n"),
            "https://{$h}/" => Http::response($page('/')),
        ]);
        $this->artisan('seo:probe')->assertExitCode(0);
    }

    public function test_an_accessible_first_community_without_an_accessible_sitemap_fails(): void
    {
        $acc = 'access-probe.test';
        DB::table('tenants')->where('id', $this->testTenantId)->update(['accessible_domain' => $acc]);
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'seo_primary_site'],
            ['setting_value' => 'accessible', 'setting_type' => 'string', 'updated_at' => now()]
        );
        $h = $this->host;
        $page = fn (string $path) => '<html><head><title>Probe</title><link rel="canonical" href="https://' . $acc . $path . '"></head></html>';
        Http::fake([
            "https://{$h}/about" => Http::response($page('/about')),
            "https://{$h}/sitemap.xml" => Http::response('', 404),
            "https://{$acc}/sitemap.xml" => Http::response('', 404),
            "https://{$h}/llms.txt" => Http::response('# Probe'),
            "https://{$h}/robots.txt" => Http::response("Sitemap: https://{$h}/sitemap.xml\n"),
            "https://{$h}/" => Http::response($page('/')),
        ]);
        $this->artisan('seo:probe')->expectsOutputToContain('its sitemap is missing or empty')->assertExitCode(1);
    }
}
