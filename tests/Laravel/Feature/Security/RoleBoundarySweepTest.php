<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Routing\Route as RoutingRoute;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Privilege-boundary sweep across the five authorisation tiers.
 *
 *   anonymous → member → broker/coordinator → admin → tenant super admin → super admin
 *
 * For each actor, every v2 route that a HIGHER tier is required for is requested
 * with every one of its declared methods and a placeholder id. The actor must be
 * refused before the controller runs. Routes are taken from the live route table
 * so a newly added admin endpoint is covered the day it lands.
 *
 * WHY 422 IS A FAILURE
 * --------------------
 * Form validation runs when the controller method is resolved, i.e. AFTER route
 * middleware. A member sending an empty body to an admin write endpoint should be
 * refused by the gate and never reach validation. A 422 therefore proves the gate
 * did not fire. It is classified REACHED, exactly like a 200.
 *
 * WHY 404 IS NOT A PASS
 * ---------------------
 * A 404 can come from the controller looking up the placeholder id — which means
 * the gate let the request through — or from route-model binding running ahead
 * of the gate. The test cannot tell which, so it is INCONCLUSIVE and listed for a
 * human to read. It is never counted as refused.
 *
 * SELECTION
 * ---------
 * Member and anonymous runs select by URL prefix (/admin/, /super-admin/,
 * /broker/) AS WELL AS by declared gate, so an admin route that is missing its
 * gate entirely is still probed — that is the fault this test exists to catch.
 * Higher actors select by declared gate only, because the URL cannot say which
 * tier a route needs.
 */
class RoleBoundarySweepTest extends TestCase
{
    use DatabaseTransactions;

    private const REACHED_STATUSES = [200, 201, 202, 204, 422];

    /** Effective middleware class => gate alias. Only these count as gates. */
    private const GATE_CLASSES = [
        'Authenticate' => 'auth',
        'EnsureIsAdmin' => 'admin',
        'EnsureIsBrokerOrAdmin' => 'broker-or-admin',
        'EnsureIsSuperAdmin' => 'super-admin',
        'EnsureIsTenantSuperAdmin' => 'tenant-super-admin',
        // Super-panel access: platform ('master') or hub-tenant ('regional').
        // A tenant super admin may pass it; everyone below may not.
        'EnsureSuperPanelAccess' => 'super-panel',
    ];

    private const PRIVILEGED_PREFIXES = ['api/v2/admin/', 'api/v2/super-admin/', 'api/v2/broker/'];

    /** @var array<int,array<string,mixed>> */
    private array $results = [];

    protected function setUp(): void
    {
        parent::setUp();

        // The sweep makes ~2,400 requests per actor from one client. The
        // platform's own per-route rate limiting engaged on the first run and
        // answered 429 to 2,097 of them before any gate could — which is the
        // correct production behaviour, and useless here. Rate limiting has its
        // own tests; this one is about the authorisation gates behind it.
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);
    }

    // ================================================================
    // One test per actor — each is its own line in the evidence.
    // ================================================================

    public function test_anonymous_caller_is_refused_by_every_authenticated_route(): void
    {
        // No Sanctum::actingAs — the base setUp already clears any leaked session.
        $this->sweep(
            actor: 'anonymous',
            forbiddenGates: ['auth', 'admin', 'broker-or-admin', 'super-admin', 'tenant-super-admin', 'super-panel'],
            usePrefixes: true,
            acceptedRefusals: [401, 403],
        );
    }

    public function test_member_is_refused_by_every_privileged_route(): void
    {
        $this->actAs(['role' => 'member']);

        $this->sweep(
            actor: 'member',
            forbiddenGates: ['admin', 'broker-or-admin', 'super-admin', 'tenant-super-admin', 'super-panel'],
            usePrefixes: true,
            acceptedRefusals: [401, 403],
        );
    }

    public function test_broker_is_refused_by_admin_and_above(): void
    {
        // AdminTier deliberately returns false for broker/coordinator — an
        // operational role is not a junior admin. This pins that decision.
        // Routes gated broker-or-admin are the broker's own panel and are
        // deliberately NOT in this list.
        $this->actAs(['role' => 'broker']);

        $this->sweep(
            actor: 'broker',
            forbiddenGates: ['admin', 'super-admin', 'tenant-super-admin', 'super-panel'],
            usePrefixes: false,
            acceptedRefusals: [401, 403],
        );
    }

    public function test_community_admin_is_refused_by_network_and_platform_routes(): void
    {
        $this->actAs(['role' => 'admin']);

        $this->sweep(
            actor: 'admin',
            forbiddenGates: ['super-admin', 'tenant-super-admin', 'super-panel'],
            usePrefixes: false,
            acceptedRefusals: [401, 403],
        );
    }

    public function test_network_admin_is_refused_by_platform_routes(): void
    {
        // EnsureIsSuperAdmin deliberately rejects is_tenant_super_admin.
        $this->actAs(['role' => 'admin', 'is_tenant_super_admin' => true]);

        $this->sweep(
            actor: 'tenant-super-admin',
            forbiddenGates: ['super-admin'],
            usePrefixes: false,
            acceptedRefusals: [401, 403],
        );
    }

    // ================================================================
    // Runner
    // ================================================================

    private function actAs(array $attributes): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'is_super_admin' => false,
            'is_tenant_super_admin' => false,
        ], $attributes));

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    /**
     * @param string[] $forbiddenGates
     * @param int[]    $acceptedRefusals
     */
    private function sweep(string $actor, array $forbiddenGates, bool $usePrefixes, array $acceptedRefusals): void
    {
        $this->results = [];
        $targets = $this->targets($forbiddenGates, $usePrefixes);

        $this->assertNotEmpty($targets, "No routes selected for actor '{$actor}' — the sweep would pass vacuously.");

        foreach ($targets as $target) {
            $this->probe($target, $acceptedRefusals);
        }

        $this->writeEvidence($actor, $forbiddenGates);
        $this->printSummary($actor, count($targets));

        $reached = array_values(array_map(
            static fn ($r) => $r['method'] . ' ' . $r['uri'] . ' -> ' . $r['status'],
            array_filter($this->results, static fn ($r) => $r['verdict'] === 'REACHED')
        ));

        $this->assertSame(
            [],
            $reached,
            "Actor '{$actor}' reached the controller on a route reserved for a higher tier."
        );
    }

    /**
     * @param string[] $forbiddenGates
     * @return array<int,array{method:string,uri:string,gates:string[],action:string}>
     */
    private function targets(array $forbiddenGates, bool $usePrefixes): array
    {
        $targets = [];

        foreach (Route::getRoutes() as $route) {
            /** @var RoutingRoute $route */
            $uri = $route->uri();

            if (! str_starts_with($uri, 'api/v2/')) {
                continue;
            }

            $gates = $this->gatesOf($route);
            $byGate = (bool) array_intersect($gates, $forbiddenGates);
            $byPrefix = $usePrefixes && $this->hasPrivilegedPrefix($uri);

            if (! $byGate && ! $byPrefix) {
                continue;
            }

            foreach ($route->methods() as $method) {
                if (in_array($method, ['HEAD', 'OPTIONS'], true)) {
                    continue;
                }

                $targets[] = [
                    'method' => $method,
                    'uri' => $uri,
                    'gates' => $gates,
                    'action' => $route->getActionName(),
                ];
            }
        }

        usort($targets, static fn ($a, $b) => [$a['uri'], $a['method']] <=> [$b['uri'], $b['method']]);

        return $targets;
    }

    /**
     * Gate aliases that will ACTUALLY RUN for this route.
     *
     * Not $route->gatherMiddleware(): that is the declared stack, and this
     * codebase opens individual routes inside an admin group to brokers or to
     * the public with ->withoutMiddleware(...). The declared stack still lists
     * the removed gate, so the first version of this test selected
     * /admin/listings for the broker (declared admin, effectively
     * broker-or-admin) and /blog for the anonymous caller (declared auth,
     * effectively public) and reported both as breaches. The router's
     * gatherRouteMiddleware() applies the exclusions and resolves aliases to
     * classes — the same list `route:list -v` prints.
     *
     * @return string[]
     */
    private function gatesOf(RoutingRoute $route): array
    {
        $gates = [];

        foreach (app('router')->gatherRouteMiddleware($route) as $middleware) {
            if (! is_string($middleware)) {
                continue;
            }

            // Resolved form is "App\Http\Middleware\Authenticate:sanctum".
            $class = explode(':', $middleware, 2)[0];
            $alias = self::GATE_CLASSES[class_basename($class)] ?? null;

            if ($alias !== null) {
                $gates[] = $alias;
            }
        }

        return array_values(array_unique($gates));
    }

    private function hasPrivilegedPrefix(string $uri): bool
    {
        foreach (self::PRIVILEGED_PREFIXES as $prefix) {
            if (str_starts_with($uri, $prefix)) {
                return true;
            }
        }

        return false;
    }

    /** @param int[] $acceptedRefusals */
    private function probe(array $target, array $acceptedRefusals): void
    {
        $uri = '/' . preg_replace('/\{[^}]+\}/', '1', $target['uri']);

        try {
            $response = $this->json($target['method'], $uri, [], $this->withTenantHeader());
            $status = $response->getStatusCode();
            $body = mb_substr((string) $response->getContent(), 0, 300);
        } catch (\Throwable $e) {
            $this->results[] = $target + [
                'status' => null,
                'verdict' => 'INCONCLUSIVE',
                'note' => 'threw ' . class_basename($e) . ': ' . mb_substr($e->getMessage(), 0, 160),
                'body_excerpt' => '',
            ];

            return;
        }

        [$verdict, $note] = match (true) {
            in_array($status, $acceptedRefusals, true) => ['REFUSED', ''],
            in_array($status, self::REACHED_STATUSES, true) => ['REACHED', $status === 422
                ? 'validation ran — the gate did not fire before the controller'
                : 'controller executed'],
            $status === 404 => ['INCONCLUSIVE', '404 — placeholder id looked up, or binding ran before the gate; read by hand'],
            $status === 429 => ['INCONCLUSIVE', 'throttled before the gate could answer'],
            $status >= 500 => ['INCONCLUSIVE', 'server error proves nothing about the gate'],
            default => ['INCONCLUSIVE', 'status ' . $status . ' — not a refusal and not proof the controller ran'],
        };

        $this->results[] = $target + [
            'status' => $status,
            'verdict' => $verdict,
            'note' => $note,
            'body_excerpt' => $verdict === 'REFUSED' ? '' : $body,
        ];
    }

    // ================================================================
    // Reporting
    // ================================================================

    private function printSummary(string $actor, int $targetCount): void
    {
        $tally = ['REFUSED' => 0, 'REACHED' => 0, 'INCONCLUSIVE' => 0];
        foreach ($this->results as $r) {
            $tally[$r['verdict']]++;
        }

        $lines = [
            '',
            sprintf('=== ROLE BOUNDARY SWEEP — actor: %s ===', $actor),
            sprintf('routes+methods requiring a higher tier : %d', $targetCount),
            sprintf('  refused before the controller        : %d', $tally['REFUSED']),
            sprintf('  REACHED the controller               : %d', $tally['REACHED']),
            sprintf('  inconclusive                         : %d', $tally['INCONCLUSIVE']),
            '',
        ];

        foreach (['REACHED', 'INCONCLUSIVE'] as $bucket) {
            if ($tally[$bucket] === 0) {
                continue;
            }

            $lines[] = $bucket . ':';
            foreach ($this->results as $r) {
                if ($r['verdict'] === $bucket) {
                    $lines[] = sprintf('  %-6s %s -> %s  %s', $r['method'], $r['uri'], $r['status'] ?? 'exception', $r['note']);
                }
            }
            $lines[] = '';
        }

        fwrite(STDERR, implode(PHP_EOL, $lines) . PHP_EOL);
    }

    private function writeEvidence(string $actor, array $forbiddenGates): void
    {
        $dir = dirname(__DIR__, 4) . '/.local-docs-archive/security-evidence';

        if (! is_dir($dir) && ! @mkdir($dir, 0o775, true) && ! is_dir($dir)) {
            return;
        }

        @file_put_contents(
            $dir . '/role-boundary-' . $actor . '.json',
            json_encode([
                'generated_at' => date('c'),
                'actor' => $actor,
                'actor_tenant' => $this->testTenantId,
                'forbidden_gates' => $forbiddenGates,
                'results' => $this->results,
            ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)
        );
    }
}
