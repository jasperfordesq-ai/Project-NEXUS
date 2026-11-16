<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\PlatformTeam;

use App\Http\Middleware\EnsureIsPlatformTeam;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Routing\Route as LaravelRoute;
use Illuminate\Support\Facades\Route;
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * Every `/v2/platform-team/*` endpoint has two locks: the `platform-team`
 * route middleware, and `requireGodPlatformAdmin()` as the first statement of
 * the controller method. Both answer 403, so the per-page tests cannot tell
 * which one refused: a controller that lost its own lock still passes them.
 *
 * This file checks each lock on its own, for every route in the real route
 * table: (a) the middleware is attached; (b) with the middleware switched
 * off, the GET endpoints still refuse; (c) every controller method starts
 * with its own lock.
 */
final class PlatformTeamRoutesAreLockedTwiceTest extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;

    private const PREFIX = 'api/v2/platform-team/';

    /** Fewer than this means the route table was not read, not that it is safe. */
    private const MINIMUM_ROUTES = 30;

    /** @return list<LaravelRoute> */
    private function platformTeamRoutes(): array
    {
        $routes = [];
        foreach (Route::getRoutes()->getRoutes() as $route) {
            if (str_starts_with($route->uri(), self::PREFIX)) {
                $routes[] = $route;
            }
        }

        $this->assertGreaterThanOrEqual(
            self::MINIMUM_ROUTES,
            count($routes),
            'Too few platform-team routes found: the route table was not read as expected'
        );

        return $routes;
    }

    private static function describe(LaravelRoute $route): string
    {
        return implode('|', $route->methods()) . ' ' . $route->uri();
    }

    public function test_every_platform_team_route_carries_both_route_middlewares(): void
    {
        foreach ($this->platformTeamRoutes() as $route) {
            $middleware = $route->gatherMiddleware();
            $this->assertContains('auth:sanctum', $middleware, self::describe($route) . ' is missing auth:sanctum');
            $this->assertContains('platform-team', $middleware, self::describe($route) . ' is missing the platform-team middleware');
        }
    }

    public function test_every_get_route_still_refuses_with_the_route_middleware_switched_off(): void
    {
        $this->withoutMiddleware(EnsureIsPlatformTeam::class);

        $checked = 0;
        foreach ($this->platformTeamRoutes() as $route) {
            if (!in_array('GET', $route->methods(), true) || str_contains($route->uri(), '{')) {
                continue;
            }
            $uri = substr($route->uri(), strlen('api'));

            foreach ([
                'a community admin' => fn () => $this->actAsCommunityAdmin(),
                'a global super admin who is not on the platform team' => fn () => $this->actAsGlobalSuperAdminNotOnTeam(),
            ] as $who => $become) {
                $become();
                $status = $this->apiGet($uri)->getStatusCode();
                $this->assertSame(403, $status, "GET {$uri} answered {$who} with {$status} once the route middleware was off: the controller has no lock of its own");
            }
            $checked++;
        }

        $this->assertGreaterThan(10, $checked, 'Too few GET routes were called');
    }

    public function test_every_controller_method_starts_with_its_own_platform_team_lock(): void
    {
        foreach ($this->platformTeamRoutes() as $route) {
            $action = $route->getActionName();
            $this->assertStringContainsString('@', $action, self::describe($route) . ' is not a controller method');
            [$class, $method] = explode('@', $action, 2);

            $reflection = new \ReflectionMethod($class, $method);
            $file = (string) $reflection->getFileName();
            $lines = file($file);
            $this->assertIsArray($lines);
            $source = implode('', array_slice(
                $lines,
                (int) $reflection->getStartLine() - 1,
                (int) $reflection->getEndLine() - (int) $reflection->getStartLine() + 1
            ));

            $open = strpos($source, '{');
            $this->assertNotFalse($open, "{$action}: no method body");
            $body = substr($source, $open + 1);
            // Drop leading comments and blank lines; the lock must be the first statement.
            $body = (string) preg_replace('~\A(?:\s+|//[^\n]*\n|/\*.*?\*/)*~s', '', $body);

            // `$actorId = $this->requireGodPlatformAdmin();` counts: it returns the caller's id.
            $this->assertMatchesRegularExpression(
                '~\A(?:\$\w+\s*=\s*)?\$this->requireGodPlatformAdmin\(\);~',
                $body,
                self::describe($route) . " ({$action}) does not start with \$this->requireGodPlatformAdmin();"
            );
        }
    }
}
