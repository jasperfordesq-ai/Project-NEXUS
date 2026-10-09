<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Http\Middleware\Authenticate;
use App\Http\Middleware\AuthenticateTwoFactorSetup;
use App\Models\User;
use App\Services\TokenService;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Routing\Route;
use Illuminate\Support\Facades\RateLimiter;
use Tests\Laravel\TestCase;

/**
 * F-577 — a route throttle on a signed-in route must count per member.
 *
 * On every authenticated API route the throttle middleware runs BEFORE this
 * app's Authenticate middleware: Authenticate is not in Laravel's middleware
 * priority list (it does not implement AuthenticatesRequests), so the sorter
 * leaves it where it is declared, after the `api` group and after any route
 * `throttle:` entry. When a named limiter runs, `$request->user()` is therefore
 * always null for a bearer-token caller, and a limiter that keys on it silently
 * counts by address instead of by member.
 *
 * F-036 fixed this for the group-wide `api` limiter only, by verifying the
 * access token inside the limiter. These tests require the same of every named
 * limiter that guards a signed-in route, and sweep the live router so a new
 * limiter is covered without anyone remembering to add it here.
 */
class RouteThrottleIdentityTest extends TestCase
{
    /**
     * Limiters that deliberately count by address on a signed-in route.
     * Each needs a reason; anything else must count per member.
     *
     * @var array<string, string>
     */
    private const ADDRESS_ONLY_BY_DESIGN = [
        // Per-address backstops. The per-administrator limit on checks is
        // enforced in AdminMemberImportController::check(), after the second
        // factor, so it counts only administrators who passed it.
        'member-import-check' => 'per-address backstop; per-admin limit in the controller',
        'member-import' => 'per-address backstop for batch pacing',
    ];

    public function test_the_throttle_on_a_signed_in_route_runs_before_authentication(): void
    {
        // Pins the fact the limiters must cope with. If this ever starts failing
        // because authentication was moved ahead of the throttle, the limiters
        // will see $request->user() again — re-read F-577 before simplifying them.
        $route = $this->routeFor('GET', 'api/v2/auth/2fa/status');
        $middleware = app('router')->gatherRouteMiddleware($route);

        $throttleAt = $this->indexOf($middleware, 'throttle:nexus-route-30-per-1m');
        $authAt = $this->indexOf($middleware, Authenticate::class);

        self::assertNotNull($throttleAt);
        self::assertNotNull($authAt);
        self::assertLessThan($authAt, $throttleAt);
    }

    public function test_a_signed_in_request_is_counted_against_the_member_not_the_address(): void
    {
        // End to end through the real kernel: the member's own bucket must be
        // the one that moves.
        $member = $this->member();
        $ip = '203.0.113.77';

        $this->withServerVariables(['REMOTE_ADDR' => $ip])
            ->withHeaders(['Authorization' => 'Bearer ' . $this->tokenFor($member)])
            ->getJson('/api/v2/auth/2fa/status');

        $route = $this->routeFor('GET', 'api/v2/auth/2fa/status');
        $limiter = RateLimiter::limiter('nexus-route-30-per-1m');

        $asMember = $this->request($route, 'GET', $ip, null);
        $asMember->setUserResolver(static fn () => $member);
        $asAddress = $this->request($route, 'GET', $ip, null);

        TenantContext::setById($this->testTenantId);
        $memberKey = (string) $this->limits($limiter($asMember))[0]->key;
        $addressKey = (string) $this->limits($limiter($asAddress))[0]->key;
        self::assertNotSame($memberKey, $addressKey);

        self::assertSame(
            1,
            RateLimiter::attempts(md5('nexus-route-30-per-1m' . $memberKey)),
            'The request was not counted in the member\'s bucket.'
        );
        self::assertSame(
            0,
            RateLimiter::attempts(md5('nexus-route-30-per-1m' . $addressKey)),
            'The signed-in request was counted in the anonymous per-address bucket.'
        );
    }

    public function test_every_limiter_on_a_signed_in_route_counts_per_member(): void
    {
        $first = $this->member();
        $second = $this->member();
        $firstToken = $this->tokenFor($first);
        $secondToken = $this->tokenFor($second);

        $failures = [];
        $checked = [];

        TenantContext::setById($this->testTenantId);
        try {
            foreach (app('router')->getRoutes()->getRoutes() as $route) {
                $middleware = app('router')->gatherRouteMiddleware($route);
                if (!$this->runsAuthentication($middleware)) {
                    continue;
                }

                foreach ($this->throttleNames($middleware) as $name) {
                    if (isset(self::ADDRESS_ONLY_BY_DESIGN[$name])) {
                        continue;
                    }
                    $limiter = RateLimiter::limiter($name);
                    if (!is_callable($limiter)) {
                        continue; // numeric throttle:60,1 — not a named limiter
                    }

                    $method = $route->methods()[0];
                    $keys = fn (string $ip, ?string $bearer): array => $this->keys(
                        $limiter($this->request($route, $method, $ip, $bearer))
                    );

                    $a = $keys('203.0.113.10', $firstToken);
                    $b = $keys('203.0.113.10', $secondToken);
                    $aElsewhere = $keys('198.51.100.20', $firstToken);
                    $anonymous = $keys('203.0.113.10', null);
                    $junk = $keys('203.0.113.10', 'not-a-real-token-' . bin2hex(random_bytes(4)));

                    $label = $name . ' on ' . $method . ' ' . $route->uri();
                    $checked[$name] = true;

                    if ($a === $b) {
                        $failures[] = "{$label}: two members on one address share every bucket";
                    }
                    if (array_intersect($a, $aElsewhere) === []) {
                        $failures[] = "{$label}: one member's bucket moves with the address";
                    }
                    if ($junk !== $anonymous) {
                        $failures[] = "{$label}: an unverified bearer value mints a fresh bucket";
                    }
                }
            }
        } finally {
            TenantContext::reset();
        }

        self::assertNotEmpty($checked, 'The sweep found no throttled signed-in routes; it is not looking.');
        self::assertSame(
            [],
            array_values(array_unique($failures)),
            "Limiters that count signed-in members by address (F-577):\n  "
            . implode("\n  ", array_values(array_unique($failures)))
        );
    }

    public function test_signed_in_listeners_get_their_own_podcast_media_bucket(): void
    {
        // A public route with no authentication at all, so $request->user() is
        // never resolved there. It still must not pool signed-in listeners.
        $limiter = RateLimiter::limiter('podcast-media');
        self::assertIsCallable($limiter);
        $route = $this->firstRouteUsing('podcast-media');

        $a = $this->keys($limiter($this->request($route, 'GET', '203.0.113.10', $this->tokenFor($this->member()))));
        $b = $this->keys($limiter($this->request($route, 'GET', '203.0.113.10', $this->tokenFor($this->member()))));

        self::assertNotSame($a, $b);
    }

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ]);
    }

    private function tokenFor(User $user): string
    {
        return app(TokenService::class)->generateToken((int) $user->id, $this->testTenantId);
    }

    /** A request as the throttle sees it: route bound, no user resolved yet. */
    private function request(Route $route, string $method, string $ip, ?string $bearer): Request
    {
        $server = ['REMOTE_ADDR' => $ip];
        if ($bearer !== null) {
            $server['HTTP_AUTHORIZATION'] = 'Bearer ' . $bearer;
        }
        $request = Request::create('/' . $this->fillParameters($route), $method, [], [], [], $server);
        $route->bind($request);
        $request->setRouteResolver(static fn () => $route);

        return $request;
    }

    private function fillParameters(Route $route): string
    {
        return (string) preg_replace_callback('/\{(\w+)\??\}/', function (array $m) use ($route): string {
            $pattern = $route->wheres[$m[1]] ?? null;
            foreach (['1', '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d', 'abc'] as $candidate) {
                if ($pattern === null || preg_match('#^(' . $pattern . ')$#', $candidate) === 1) {
                    return $candidate;
                }
            }

            return '1';
        }, $route->uri());
    }

    private function routeFor(string $method, string $uri): Route
    {
        foreach (app('router')->getRoutes()->getRoutes() as $route) {
            if ($route->uri() === $uri && in_array($method, $route->methods(), true)) {
                return $route;
            }
        }
        self::fail("No route {$method} {$uri}");
    }

    private function firstRouteUsing(string $limiterName): Route
    {
        foreach (app('router')->getRoutes()->getRoutes() as $route) {
            if (in_array($limiterName, $this->throttleNames(app('router')->gatherRouteMiddleware($route)), true)) {
                return $route;
            }
        }
        self::fail("No route uses throttle:{$limiterName}");
    }

    /** @param array<int, mixed> $middleware */
    private function runsAuthentication(array $middleware): bool
    {
        foreach ($middleware as $m) {
            if (is_string($m) && in_array(explode(':', $m)[0], [Authenticate::class, AuthenticateTwoFactorSetup::class], true)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param array<int, mixed> $middleware
     * @return array<int, string>
     */
    private function throttleNames(array $middleware): array
    {
        $names = [];
        foreach ($middleware as $m) {
            if (is_string($m) && str_contains($m, 'ThrottleRequests:')) {
                $names[] = explode(',', explode(':', $m, 2)[1])[0];
            }
        }

        return $names;
    }

    /** @param array<int, mixed> $middleware */
    private function indexOf(array $middleware, string $needle): ?int
    {
        foreach ($middleware as $i => $m) {
            if (!is_string($m)) {
                continue;
            }
            $normalised = str_replace('Illuminate\\Routing\\Middleware\\ThrottleRequests', 'throttle', $m);
            if ($normalised === $needle || explode(':', $m)[0] === $needle) {
                return $i;
            }
        }

        return null;
    }

    /** @return array<int, Limit> */
    private function limits(mixed $result): array
    {
        return is_array($result) ? $result : [$result];
    }

    /** @return array<int, string> */
    private function keys(mixed $result): array
    {
        $keys = array_map(static fn (Limit $l): string => (string) $l->key, $this->limits($result));
        sort($keys);

        return $keys;
    }
}
