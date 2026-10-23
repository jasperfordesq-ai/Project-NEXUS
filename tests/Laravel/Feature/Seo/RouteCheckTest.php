<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Seo;

use App\Services\PrerenderService;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * nginx asks /v2/seo/route-check before giving a crawler the noindex shell
 * (2026-10-23). 204 = an address the app routes; 403 = one that never existed,
 * which nginx turns into a 404. Anything doubtful answers 204 (fail-open).
 */
class RouteCheckTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $prerender = Mockery::mock(PrerenderService::class);
        $prerender->shouldReceive('loadTenantTargets')->andReturn([
            ['tenant_id' => $this->testTenantId, 'slug' => 'main', 'host' => 'routes.test', 'prefix' => '', 'features' => null, 'configuration' => null],
            ['tenant_id' => $this->testTenantId, 'slug' => 'sub', 'host' => 'routes.test', 'prefix' => '/sub', 'features' => null, 'configuration' => null],
        ]);
        $this->app->instance(PrerenderService::class, $prerender);
    }

    private function check(string $host, string $path)
    {
        return $this->get('/api/v2/seo/route-check', [
            'X-Nexus-Route-Host' => $host,
            'X-Nexus-Route-Path' => $path,
        ]);
    }

    public function test_addresses_the_app_routes_are_known(): void
    {
        foreach (['/about', '/blog/some-post', '/Events/12', '/help/members/getting-started', '/sub', '/sub/', '/sub/listings/4', '/about?utm_source=x'] as $path) {
            $this->check('routes.test', $path)->assertStatus(204);
        }
    }

    public function test_addresses_that_never_existed_are_refused(): void
    {
        foreach (['/wp-old-page', '/no-such-thing/deeper', '/sub/not-a-route', '/unknownslug/about'] as $path) {
            $this->check('routes.test', $path)->assertStatus(403);
        }
    }

    public function test_anything_doubtful_fails_open(): void
    {
        $this->check('elsewhere.test', '/wp-old-page')->assertStatus(204);
        $this->check('', '/wp-old-page')->assertStatus(204);
        $this->check('routes.test', '')->assertStatus(204);
        $this->check('routes.test', 'relative')->assertStatus(204);

        $broken = Mockery::mock(PrerenderService::class);
        $broken->shouldReceive('loadTenantTargets')->andThrow(new \RuntimeException('database down'));
        $this->app->instance(PrerenderService::class, $broken);
        $this->check('routes.test', '/wp-old-page')->assertStatus(204);
    }
}
