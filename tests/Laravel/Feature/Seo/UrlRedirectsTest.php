<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Seo;

use App\Models\User;
use App\Services\SeoRedirectPublisher;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * The admin "URL redirects" answer real 301s (2026-10-23 SEO audit).
 *
 * Until then a saved redirect was never applied: its middleware runs only on
 * the API, and every page request is served by nginx from the React build.
 * Now saving or deleting a redirect writes or removes a marker file that nginx
 * checks (pinned on the nginx side by scripts/test/test-prerender-nginx-runtime.sh),
 * and nginx hands a marked request to /v2/seo/resolve-redirect for the 301.
 */
class UrlRedirectsTest extends TestCase
{
    use DatabaseTransactions;

    private string $root;
    private string $host;

    protected function setUp(): void
    {
        parent::setUp();
        $this->root = sys_get_temp_dir() . '/nexus-seo-redirects-' . uniqid();
        mkdir($this->root, 0775, true);
        $this->app->instance(SeoRedirectPublisher::class, new SeoRedirectPublisher($this->root));

        $this->host = 'redirects-' . uniqid() . '.test';
        DB::table('tenants')->where('id', $this->testTenantId)->update(['domain' => $this->host, 'is_active' => 1]);
        DB::table('seo_redirects')->where('tenant_id', $this->testTenantId)->delete();

        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);
    }

    protected function tearDown(): void
    {
        exec('rm -rf ' . escapeshellarg($this->root));
        parent::tearDown();
    }

    private function marker(string $path): string
    {
        return $this->root . '/' . SeoRedirectPublisher::DIR . '/' . $this->host . $path . '/' . SeoRedirectPublisher::MARKER;
    }

    private function resolve(string $host, string $path)
    {
        return $this->withHeaders([
            'X-Nexus-Redirect-Host' => $host,
            'X-Nexus-Redirect-Path' => $path,
        ])->get('/api/v2/seo/resolve-redirect');
    }

    public function test_saving_a_redirect_publishes_a_marker_and_answers_a_301(): void
    {
        $this->apiPost('/v2/admin/tools/redirects', [
            'source_url' => '/old-page',
            'destination_url' => '/about',
        ])->assertStatus(201);

        $this->assertFileExists($this->marker('/old-page'));

        $response = $this->resolve($this->host, '/old-page');
        $response->assertStatus(301);
        $response->assertHeader('Location', 'https://' . $this->host . '/about');
        $this->assertSame(1, (int) DB::table('seo_redirects')
            ->where('tenant_id', $this->testTenantId)->where('source_url', '/old-page')->value('hits'));
    }

    public function test_deleting_a_redirect_removes_its_marker_and_a_stale_marker_does_not_loop(): void
    {
        $id = (int) $this->apiPost('/v2/admin/tools/redirects', [
            'source_url' => '/old-page',
            'destination_url' => '/about',
        ])->json('data.id');

        $this->apiDelete("/v2/admin/tools/redirects/{$id}")->assertOk();
        $this->assertFileDoesNotExist($this->marker('/old-page'));

        // A request that raced the delete: sent back to the page itself, with
        // the flag nginx uses to skip the marker check.
        $response = $this->resolve($this->host, '/old-page');
        $response->assertStatus(307);
        $response->assertHeader('Location', 'https://' . $this->host . '/old-page?nexus_rc=1');
    }

    public function test_a_community_in_a_folder_redirects_within_its_folder(): void
    {
        DB::table('tenants')->where('id', $this->testTenantId)->update(['domain' => null]);
        $slug = (string) DB::table('tenants')->where('id', $this->testTenantId)->value('slug');
        $appHost = (string) parse_url((string) env('FRONTEND_URL', 'https://app.project-nexus.ie'), PHP_URL_HOST);
        $this->apiPost('/v2/admin/tools/redirects', [
            'source_url' => '/old-page',
            'destination_url' => '/about',
        ])->assertStatus(201);

        $this->assertFileExists($this->root . '/' . SeoRedirectPublisher::DIR . '/' . $appHost . '/' . $slug . '/old-page/' . SeoRedirectPublisher::MARKER);
        $response = $this->resolve($appHost, '/' . $slug . '/old-page');
        $response->assertStatus(301);
        $response->assertHeader('Location', 'https://' . $appHost . '/' . $slug . '/about');
    }

    public function test_a_forged_host_gets_no_redirect(): void
    {
        $this->apiPost('/v2/admin/tools/redirects', [
            'source_url' => '/old-page',
            'destination_url' => '/about',
        ])->assertStatus(201);

        $this->resolve('evil.example', '/old-page')->assertStatus(404);
        $this->resolve($this->host, 'old-page')->assertStatus(404);
    }

    public function test_source_paths_are_normalised_and_unsafe_ones_ignored(): void
    {
        $this->assertSame('/old', SeoRedirectPublisher::normaliseSource('/old/'));
        $this->assertSame('/old', SeoRedirectPublisher::normaliseSource('https://example.org/old'));
        $this->assertNull(SeoRedirectPublisher::normaliseSource('/'));
        $this->assertNull(SeoRedirectPublisher::normaliseSource('/a/../b'));
        $this->assertNull(SeoRedirectPublisher::normaliseSource('/a?b=1'));
        $this->assertNull(SeoRedirectPublisher::normaliseSource('old'));
    }
}
