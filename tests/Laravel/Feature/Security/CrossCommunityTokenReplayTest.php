<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\TokenService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Route;
use Tests\Laravel\TestCase;

/**
 * Can a VALID login credential from one community be used against ANOTHER?
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS
 * -----------------------------------
 * Every community-owned query is restricted with `tenant_id = <current
 * community>`, and **the community is resolved from the request, not from the
 * account**. So if a member of community A could get their request resolved as
 * community B, those queries would faithfully hand over community B's data —
 * every one of them working exactly as designed while doing it. No amount of
 * correct query scoping prevents this. The request itself has to be refused.
 *
 * 🔴 WHICH CREDENTIAL PATH THIS TESTS, AND WHY THE FIRST VERSION WAS WRONG
 * ------------------------------------------------------------------------
 * An earlier version of this test authenticated with `Sanctum::actingAs()` and
 * described the protection as two checks inside
 * `App\Http\Middleware\Authenticate`. That description was **wrong**, and an
 * external review was right to call it out. The middleware reads:
 *
 *     foreach ($request->bearerToken() === null ? $guards : [] as $guard) {
 *
 * Those checks therefore run ONLY when there is no bearer token — i.e. for
 * stateful and test-guard requests. Production logins carry a bearer JWT, so on
 * the real path that branch never executes at all, and the token-tenant check
 * inside it is unreachable there.
 *
 * The protection on the real path lives in `App\Core\TenantContext::resolve()`,
 * which extracts `tenant_id` from the **signature-validated** JWT and compares
 * it with the requested community, exempting platform administrators. This test
 * now exercises that path, with a token minted the way login mints one.
 *
 * A second earlier error, also corrected: a genuinely issued token was observed
 * returning 401 and that was attributed to "middleware ordering under the test
 * kernel". The real reasons are that user-login personal access tokens were
 * deliberately RETIRED (the middleware docblock says so, and rejects them so an
 * old seven-day token cannot bypass JWT lifetime and revocation), and that
 * `TenantContext::resolve()` reads `$_SERVER` directly while the test harness
 * clears it. Both are recorded here so the mistake is not repeated.
 *
 * CONTROL-VERIFIED, AND THE REFUSAL IS ATTRIBUTED
 * -----------------------------------------------
 * The same credential is first used against its OWN community and must be
 * served — otherwise "everything refused" would prove only that the credential
 * was broken. And each refusal records the community that actually resolved:
 * `respondWithTenantMismatchError()` is the only thing that sets community id
 * **0**, so that value is the fingerprint proving the mismatch check is what
 * refused, rather than some unrelated failure.
 */
class CrossCommunityTokenReplayTest extends TestCase
{
    use DatabaseTransactions;

    /** The community the credential really belongs to. */
    private const ACTOR_TENANT_ID = 999;

    /** A refusal: rejected before any application code ran. */
    private const REFUSED = [400, 401, 403];

    /**
     * A success — or a validation error, which proves the request reached form
     * validation and therefore got past authentication and tenant resolution.
     */
    private const REACHED_STATUSES = [200, 201, 202, 204, 422];

    protected function tearDown(): void
    {
        unset($_SERVER['HTTP_AUTHORIZATION'], $_SERVER['HTTP_X_TENANT_ID']);
        parent::tearDown();
    }

    public function test_a_real_login_credential_from_another_community_reaches_nothing(): void
    {
        // Rate limiting would refuse thousands of requests from one client before
        // the tenant check could answer, as it did on the role sweep's first run.
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);

        $outsider = User::factory()->forTenant(self::ACTOR_TENANT_ID)->create([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'member',
            'is_super_admin' => false,
            'is_tenant_super_admin' => false,
        ]);

        // Minted exactly as the login flow mints it, carrying the community id.
        $jwt = app(TokenService::class)->generateToken((int) $outsider->id, self::ACTOR_TENANT_ID);

        $endpoints = $this->authenticatedEndpoints();
        $this->assertNotEmpty($endpoints, 'Route enumeration produced nothing — this sweep would pass vacuously.');

        // ---- CONTROL: the same credential against its OWN community.
        $controlCandidates = array_values(array_filter(
            $endpoints,
            static fn ($e) => $e['method'] === 'GET'
                && ! str_contains($e['uri'], 'api/v2/admin/')
                && ! str_contains($e['uri'], '{')
        ));
        $this->assertNotEmpty($controlCandidates, 'No member-facing control route found.');

        $controlServed = 0;
        $controlDetail = [];
        foreach (array_slice($controlCandidates, 0, 25) as $e) {
            $r = $this->send($e, (string) self::ACTOR_TENANT_ID, $jwt);
            if (! in_array($r['status'], self::REFUSED, true)) {
                $controlServed++;
            }
            $controlDetail[] = sprintf('%s -> %d (community %s)', $e['uri'], $r['status'], var_export($r['tenant'], true));
        }

        $this->assertGreaterThan(
            0,
            $controlServed,
            "This credential cannot use its OWN community, so the sweep below would prove nothing.\n"
            . implode("\n", array_slice($controlDetail, 0, 8))
        );

        // ---- SWEEP: the same credential against a community it does not belong to.
        $results = [];
        foreach ($endpoints as $e) {
            $r = $this->send($e, (string) $this->testTenantId, $jwt);

            [$verdict, $note] = match (true) {
                in_array($r['status'], self::REACHED_STATUSES, true) => ['REACHED', 'served, or reached validation'],
                // Routes whose URL carries a pattern constraint raise the
                // mismatch as an exception rather than returning a response.
                // The thrown body carries the TENANT_MISMATCH code itself, so
                // this is the same refusal by the same check — attributed on
                // that evidence, not assumed from the fact that it threw.
                $r['status'] === 0 && str_contains($r['body'], 'TENANT_MISMATCH') => ['REFUSED', 'community mismatch refused it (raised as an exception)'],
                $r['status'] === 0 => ['INCONCLUSIVE', 'request threw without a mismatch code: ' . mb_substr($r['body'], 0, 120)],
                in_array($r['status'], self::REFUSED, true) && $r['tenant'] === 0 => ['REFUSED', 'community mismatch refused it (resolved community 0)'],
                in_array($r['status'], self::REFUSED, true) => ['REFUSED_OTHER', "refused with {$r['status']}, but the resolved community was " . var_export($r['tenant'], true)],
                default => ['INCONCLUSIVE', "status {$r['status']}"],
            };

            $results[] = [
                'method' => $e['method'],
                'uri' => $e['uri'],
                'status' => $r['status'],
                'resolved_tenant' => $r['tenant'],
                'verdict' => $verdict,
                'note' => $note,
                'body_excerpt' => str_starts_with($verdict, 'REFUSED') ? '' : mb_substr($r['body'], 0, 200),
            ];
        }

        $tally = ['REFUSED' => 0, 'REFUSED_OTHER' => 0, 'REACHED' => 0, 'INCONCLUSIVE' => 0];
        foreach ($results as $r) {
            $tally[$r['verdict']]++;
        }

        $dir = dirname(__DIR__, 4) . '/.local-docs-archive/security-evidence';
        if (is_dir($dir) || @mkdir($dir, 0o775, true) || is_dir($dir)) {
            @file_put_contents($dir . '/cross-community-jwt-replay.json', json_encode([
                'generated_at' => date('c'),
                'method' => 'A real short-lived JWT, minted for an active approved MEMBER of tenant 999 exactly as the login flow mints it, replayed against every version-2 route that runs the Authenticate middleware with the community header set to tenant 2. The community that actually resolved is recorded for every request: only respondWithTenantMismatchError() sets community 0, so that value attributes the refusal to the mismatch check rather than to an unrelated failure. Control: the same credential against tenant 999 must be served.',
                'tally' => $tally,
                'results' => $results,
            ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        }

        $lines = [
            '',
            '=== CROSS-COMMUNITY REPLAY OF A REAL LOGIN CREDENTIAL ===',
            sprintf('authenticated v2 routes swept                       : %d', count($endpoints)),
            sprintf('  refused, community mismatch attributed (id 0)     : %d', $tally['REFUSED']),
            sprintf('  refused for some other reason (reported, not counted): %d', $tally['REFUSED_OTHER']),
            sprintf('  REACHED the application                           : %d', $tally['REACHED']),
            sprintf('  inconclusive                                      : %d', $tally['INCONCLUSIVE']),
            sprintf('control requests served against its own community   : %d of 25', $controlServed),
            '',
        ];
        foreach (['REACHED', 'REFUSED_OTHER', 'INCONCLUSIVE'] as $bucket) {
            $rows = array_filter($results, static fn ($r) => $r['verdict'] === $bucket);
            if ($rows === []) {
                continue;
            }
            $lines[] = $bucket . ':';
            foreach (array_slice($rows, 0, 25) as $r) {
                $lines[] = sprintf('  %-6s %-60s %s  %s', $r['method'], $r['uri'], $r['status'], preg_replace('/\s+/', ' ', $r['note'] . ' ' . $r['body_excerpt']));
            }
            if (count($rows) > 25) {
                $lines[] = '  ... and ' . (count($rows) - 25) . ' more (see the evidence file)';
            }
            $lines[] = '';
        }
        fwrite(STDERR, implode(PHP_EOL, $lines) . PHP_EOL);

        $reached = array_values(array_map(
            static fn ($r) => $r['method'] . ' ' . $r['uri'] . ' -> ' . $r['status'],
            array_filter($results, static fn ($r) => $r['verdict'] === 'REACHED')
        ));

        $this->assertSame(
            [],
            $reached,
            "A credential from another community reached the application. Every tenant-scoped query "
            . "would then run correctly against the WRONG community.\n" . implode("\n", array_slice($reached, 0, 20))
        );
    }

    /**
     * @param  array<string,mixed>  $endpoint
     * @return array{status:int,body:string,tenant:mixed}
     */
    private function send(array $endpoint, string $tenantHeader, string $jwt): array
    {
        $uri = '/' . ltrim(preg_replace('/\{[^}]+\}/', '1', $endpoint['uri']), '/');

        // TenantContext::resolve() reads these superglobals directly, and the
        // harness clears them in setUp — without this the credential is
        // invisible to the very check being tested.
        $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $jwt;
        $_SERVER['HTTP_X_TENANT_ID'] = $tenantHeader;
        TenantContext::reset();

        try {
            $response = $this->json($endpoint['method'], $uri, [], [
                'X-Tenant-ID' => $tenantHeader,
                'Accept' => 'application/json',
                'Authorization' => 'Bearer ' . $jwt,
            ]);

            return [
                'status' => $response->getStatusCode(),
                'body' => (string) $response->getContent(),
                'tenant' => TenantContext::getId(),
            ];
        } catch (\Throwable $e) {
            return [
                'status' => 0,
                'body' => class_basename($e) . ': ' . mb_substr($e->getMessage(), 0, 160),
                'tenant' => TenantContext::getId(),
            ];
        }
    }

    /**
     * Every version-2 route that actually runs the Authenticate middleware.
     *
     * Read through gatherRouteMiddleware() so `->withoutMiddleware(...)`
     * exclusions are honoured; the declared stack still lists middleware that
     * has been removed, which produced 48 phantom breaches on the role sweep's
     * first run.
     *
     * 🔴 Platform-tier prefixes are EXCLUDED: they are refused by their own gate
     * for a member whatever community they belong to, so they cannot show
     * whether the community check fired. RoleBoundarySweepTest covers them. The
     * reported total is therefore of *selected* routes, not of every route.
     *
     * @return list<array<string,mixed>>
     */
    private function authenticatedEndpoints(): array
    {
        $endpoints = [];

        foreach (Route::getRoutes() as $route) {
            $uri = $route->uri();

            if (! str_starts_with($uri, 'api/v2/')) {
                continue;
            }

            $runs = false;
            foreach (app('router')->gatherRouteMiddleware($route) as $middleware) {
                if (is_string($middleware) && str_contains($middleware, 'Authenticate')) {
                    $runs = true;

                    break;
                }
            }

            if (! $runs) {
                continue;
            }

            $path = substr($uri, strlen('api/v2/'));
            if (str_starts_with($path, 'admin/super/') || str_starts_with($path, 'super-admin/')) {
                continue;
            }

            foreach (array_diff($route->methods(), ['HEAD']) as $method) {
                $endpoints[] = ['method' => $method, 'uri' => $uri];
            }
        }

        usort($endpoints, static fn ($a, $b) => [$a['uri'], $a['method']] <=> [$b['uri'], $b['method']]);

        return $endpoints;
    }
}
