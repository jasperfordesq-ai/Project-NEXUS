<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Providers;

use App\Core\TenantContext;
use App\Providers\RouteServiceProvider;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Routing\Route;
use Illuminate\Support\Facades\RateLimiter;
use Tests\Laravel\TestCase;

class RouteServiceProviderTest extends TestCase
{
    public function test_home_constant_is_root(): void
    {
        $this->assertEquals('/', RouteServiceProvider::HOME);
    }

    public function test_api_rate_limiter_is_registered(): void
    {
        // The RouteServiceProvider boot() registers rate limiters.
        // After app boot, the 'api' limiter should exist.
        $limiter = RateLimiter::limiter('api');
        $this->assertNotNull($limiter, 'The "api" rate limiter should be registered');
    }

    /**
     * The 'auth' and 'uploads' limiters were removed on 2026-08-10 because no
     * route referenced them. This asserts they stay gone, so the dead
     * configuration cannot be reintroduced without a route to attach it to.
     * Login protection is App\Core\RateLimiter + throttle:nexus-route-30-per-1m
     * — see the note in RouteServiceProvider::boot().
     */
    public function test_unreferenced_auth_and_uploads_limiters_are_not_registered(): void
    {
        $this->assertNull(
            RateLimiter::limiter('auth'),
            'The "auth" limiter is dead configuration — attach it to a route or leave it deleted.'
        );
        $this->assertNull(
            RateLimiter::limiter('uploads'),
            'The "uploads" limiter is dead configuration — attach it to a route or leave it deleted.'
        );
    }

    /**
     * Guards the other direction: any `throttle:<name>` a route actually
     * declares must resolve to a registered limiter.
     */
    public function test_every_declared_named_limiter_is_registered(): void
    {
        $roots = [base_path('routes'), app_path(), base_path('bootstrap')];
        $declared = [];

        foreach ($roots as $root) {
            $files = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($root));
            foreach ($files as $file) {
                if (! $file->isFile() || $file->getExtension() !== 'php') {
                    continue;
                }
                $source = (string) file_get_contents($file->getPathname());
                preg_match_all('/throttle:([a-z][a-z0-9-]*)(?![a-z0-9-])/i', $source, $matches);
                $declared = array_merge($declared, $matches[1]);
            }
        }

        $declared = array_values(array_unique($declared));
        $this->assertNotSame([], $declared);
        foreach ($declared as $name) {
            $this->assertNotNull(
                RateLimiter::limiter($name),
                "The {$name} limiter is referenced by a route but is not registered."
            );
        }
    }

    public function test_named_route_limiter_is_tenant_actor_and_route_specific(): void
    {
        $limiter = RateLimiter::limiter('nexus-route-20-per-1m');
        $this->assertNotNull($limiter);

        TenantContext::setById($this->testTenantId);
        $user = new class {
            public function getAuthIdentifier(): int
            {
                return 4242;
            }
        };

        $first = Request::create('/api/v2/widgets/1', 'POST', server: ['REMOTE_ADDR' => '198.51.100.10']);
        $first->setUserResolver(static fn () => $user);
        $firstRoute = new Route(['POST'], 'api/v2/widgets/{id}', static fn () => null);
        $firstRoute->name('widgets.update');
        $first->setRouteResolver(static fn () => $firstRoute);

        $second = Request::create('/api/v2/other/1', 'POST', server: ['REMOTE_ADDR' => '198.51.100.10']);
        $second->setUserResolver(static fn () => $user);
        $secondRoute = new Route(['POST'], 'api/v2/other/{id}', static fn () => null);
        $secondRoute->name('other.update');
        $second->setRouteResolver(static fn () => $secondRoute);

        $otherUser = new class {
            public function getAuthIdentifier(): int
            {
                return 4343;
            }
        };
        $otherActor = Request::create('/api/v2/widgets/1', 'POST', server: ['REMOTE_ADDR' => '198.51.100.10']);
        $otherActor->setUserResolver(static fn () => $otherUser);
        $otherActor->setRouteResolver(static fn () => $firstRoute);

        try {
            $firstLimits = $limiter($first);
            $secondLimits = $limiter($second);
            $otherActorLimits = $limiter($otherActor);
            $otherTenantId = $this->testTenantId === 1 ? 2 : 1;
            $this->assertTrue(TenantContext::setById($otherTenantId));
            $otherTenantLimits = $limiter($first);
        } finally {
            TenantContext::reset();
        }

        $this->assertIsArray($firstLimits);
        $this->assertContainsOnlyInstancesOf(Limit::class, $firstLimits);
        $this->assertSame(20, $firstLimits[0]->maxAttempts);
        $this->assertSame(60, $firstLimits[0]->decaySeconds);
        $this->assertStringContainsString("tenant:{$this->testTenantId}:user:4242", $firstLimits[0]->key);
        $this->assertNotSame($firstLimits[0]->key, $secondLimits[0]->key);
        $this->assertNotSame($firstLimits[0]->key, $otherActorLimits[0]->key);
        $this->assertNotSame($firstLimits[0]->key, $otherTenantLimits[0]->key);
        $this->assertSame('nexus-route:ip:198.51.100.10:all', $firstLimits[1]->key);
        $this->assertSame($firstLimits[1]->key, $secondLimits[1]->key);
    }

    public function test_runtime_sources_have_no_numeric_throttle_declarations(): void
    {
        $roots = [base_path('routes'), app_path(), base_path('bootstrap')];
        $violations = [];

        foreach ($roots as $root) {
            $files = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($root));
            foreach ($files as $file) {
                if (! $file->isFile() || $file->getExtension() !== 'php') {
                    continue;
                }
                $source = file_get_contents($file->getPathname());
                if (is_string($source) && preg_match('/throttle:\\d+(?:,\\d+)?/', $source) === 1) {
                    $violations[] = $file->getPathname();
                }
            }
        }

        $this->assertSame([], $violations, 'Numeric throttle declarations must use named tenant/actor/route policies.');
    }

    public function test_every_declared_generic_route_policy_is_registered(): void
    {
        $roots = [base_path('routes'), app_path(), base_path('bootstrap')];
        $declared = [];

        foreach ($roots as $root) {
            $files = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($root));
            foreach ($files as $file) {
                if (! $file->isFile() || $file->getExtension() !== 'php') {
                    continue;
                }
                $source = (string) file_get_contents($file->getPathname());
                preg_match_all('/throttle:(nexus-route-[a-z0-9-]+)/', $source, $matches);
                $declared = array_merge($declared, $matches[1]);
            }
        }

        $declared = array_values(array_unique($declared));
        $this->assertNotSame([], $declared);
        foreach ($declared as $name) {
            $this->assertNotNull(RateLimiter::limiter($name), "The {$name} limiter must be registered.");
        }
    }

    public function test_api_routes_file_is_loaded(): void
    {
        // Verify that the API routes file exists at the expected location
        $this->assertFileExists(base_path('routes/api.php'));
    }
}
