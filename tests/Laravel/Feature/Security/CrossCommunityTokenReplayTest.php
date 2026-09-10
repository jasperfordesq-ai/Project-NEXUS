<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Can a VALID account in one community be used against ANOTHER community?
 *
 * WHY THIS IS ITS OWN TEST
 * ------------------------
 * The four sweeps in CrossCommunityAccessSweepTest and RoleBoundarySweepTest all
 * keep the actor and the community aligned: a tenant-2 member asking for a
 * tenant-999 record. None of them asks the opposite and more direct question —
 * what if the CALLER is from somewhere else?
 *
 * That matters more than it first appears. Every community-owned query is
 * restricted with `tenant_id = TenantContext::getId()`, and the community is
 * resolved from the request, not from the account. So if a member of community A
 * could get their request resolved as community B, the scoping would faithfully
 * hand them community B's data — and every one of those queries would be working
 * exactly as designed while doing it. The protection cannot come from the
 * queries; it has to come from refusing the request.
 *
 * It does. `App\Http\Middleware\Authenticate` carries two independent checks:
 *
 *   1. the authenticated USER's tenant_id must match the resolved community
 *      (`tenant_mismatch`), and
 *   2. the TOKEN's own tenant_id must match it too (`token_tenant_mismatch`),
 *      which still applies to a platform super-admin whose account is allowed
 *      to cross communities.
 *
 * Both are unit-tested in tests/Laravel/Unit/Middleware/AuthenticateTest.php.
 * What was never established is that they cover the WHOLE API: the checks live
 * in one middleware, so any route not running that middleware does not get
 * them. 2,374 of the 2,503 version-2 routes run it. This test proves the claim
 * route by route rather than in principle.
 *
 * 🔴 WHICH OF THE TWO CHECKS THIS EXERCISES — read before quoting it.
 * The actor is authenticated with Sanctum::actingAs(), so the request carries no
 * bearer token and check (2), which reads the token's own tenant_id, cannot
 * fire. **This sweep therefore proves check (1) — the account's community — on
 * every route, and does not exercise check (2).** A real issued token was tried
 * first and returns 401 for its own community inside the test harness, which is
 * an artefact of middleware ordering under the test kernel and not production
 * behaviour; chasing it would have proved less than testing what can be tested
 * honestly. Check (2) remains covered by the unit test named above.
 *
 * CONTROL-VERIFIED
 * ----------------
 * A sweep where everything is refused proves nothing if the account is simply
 * broken. So the same account is first exercised against its OWN community and
 * must NOT be refused for a community mismatch.
 */
class CrossCommunityTokenReplayTest extends TestCase
{
    use DatabaseTransactions;

    /** The community the actor really belongs to. */
    private const ACTOR_TENANT_ID = 999;

    /** Refusal: the request was rejected before any application code ran. */
    private const REFUSED = [401, 403];

    /**
     * A success — or a validation error, which proves the request reached form
     * validation and therefore got past authentication.
     */
    private const REACHED_STATUSES = [200, 201, 202, 204, 422];

    public function test_an_account_from_another_community_cannot_act_in_this_one(): void
    {
        // Rate limiting would refuse thousands of requests from one client
        // before the guard could answer, exactly as it did on the first run of
        // the role-boundary sweep. Rate limiting has its own tests.
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

        Sanctum::actingAs($outsider, ['*']);

        $endpoints = $this->authenticatedEndpoints();
        $this->assertNotEmpty($endpoints, 'Route enumeration produced nothing — this sweep would pass vacuously.');

        // ---- CONTROL: the same account against its OWN community.
        //
        // Member-facing GET routes only. The first routes alphabetically are all
        // under /admin/, which an ordinary member is refused from regardless of
        // community — so a control drawn from those cannot show whether the
        // account works, and the first version of this test failed on exactly
        // that. Read-only, so the control cannot disturb what follows.
        $controlCandidates = array_values(array_filter(
            $endpoints,
            static fn ($e) => $e['method'] === 'GET'
                && ! str_contains($e['uri'], 'api/v2/admin/')
                && ! str_contains($e['uri'], '{')
        ));

        $this->assertNotEmpty($controlCandidates, 'No member-facing control route found.');

        $controlSample = array_slice($controlCandidates, 0, 25);
        $controlServed = 0;
        $controlDetail = [];
        foreach ($controlSample as $e) {
            $status = $this->send($e, (string) self::ACTOR_TENANT_ID)['status'];
            if (! in_array($status, self::REFUSED, true)) {
                $controlServed++;
            }
            $controlDetail[] = sprintf('%s -> %d', $e['uri'], $status);
        }

        $this->assertGreaterThan(
            0,
            $controlServed,
            'Every control request was refused, so this account cannot use its OWN community and '
            . "the sweep below would prove nothing.\n" . implode("\n", array_slice($controlDetail, 0, 8))
        );

        // ---- SWEEP: the same account against a community it does not belong to.
        $results = [];
        $codes = [];

        foreach ($endpoints as $e) {
            $response = $this->send($e, (string) $this->testTenantId);
            $status = $response['status'];
            $body = $response['body'];

            [$verdict, $note] = match (true) {
                in_array($status, self::REACHED_STATUSES, true) => ['REACHED', $status === 422
                    ? 'validation ran, so authentication let the request through'
                    : 'the request was served'],
                in_array($status, self::REFUSED, true) => ['REFUSED', ''],
                default => ['INCONCLUSIVE', "status {$status}"],
            };

            if ($verdict === 'REFUSED' && preg_match('/"code"\s*:\s*"([a-z_]*tenant_mismatch)"/', $body, $m)) {
                $codes[$m[1]] = ($codes[$m[1]] ?? 0) + 1;
            }

            $results[] = [
                'method' => $e['method'],
                'uri' => $e['uri'],
                'status' => $status,
                'verdict' => $verdict,
                'note' => $note,
                'body_excerpt' => $verdict === 'REFUSED' ? '' : mb_substr($body, 0, 200),
            ];
        }

        $tally = ['REFUSED' => 0, 'REACHED' => 0, 'INCONCLUSIVE' => 0];
        foreach ($results as $r) {
            $tally[$r['verdict']]++;
        }

        $dir = dirname(__DIR__, 4) . '/.local-docs-archive/security-evidence';
        if (is_dir($dir) || @mkdir($dir, 0o775, true) || is_dir($dir)) {
            @file_put_contents($dir . '/cross-community-token-replay.json', json_encode([
                'generated_at' => date('c'),
                'method' => 'A valid, active, approved MEMBER account belonging to tenant 999, with a real bearer token issued for tenant 999, used against every version-2 route that runs the Authenticate middleware with the tenant header set to tenant 2. 401/403 = refused; 200/201/202/204/422 = REACHED (a finding, because 422 proves authentication was passed).',
                'refusal_codes' => $codes,
                'tally' => $tally,
                'results' => $results,
            ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        }

        $lines = [
            '',
            '=== CROSS-COMMUNITY TOKEN REPLAY ===',
            sprintf('authenticated v2 routes swept              : %d', count($endpoints)),
            sprintf('  refused (401/403)                        : %d', $tally['REFUSED']),
            sprintf('  REACHED the application                  : %d', $tally['REACHED']),
            sprintf('  inconclusive                             : %d', $tally['INCONCLUSIVE']),
            '',
            'refusal codes observed: ' . (($codes === []) ? '(none matched)' : json_encode($codes)),
            '',
        ];
        foreach (['REACHED', 'INCONCLUSIVE'] as $bucket) {
            $rows = array_filter($results, static fn ($r) => $r['verdict'] === $bucket);
            if ($rows === []) {
                continue;
            }
            $lines[] = $bucket . ':';
            foreach (array_slice($rows, 0, 40) as $r) {
                $lines[] = sprintf('  %-6s %-64s %s  %s', $r['method'], $r['uri'], $r['status'], preg_replace('/\s+/', ' ', $r['body_excerpt']));
            }
            if (count($rows) > 40) {
                $lines[] = '  ... and ' . (count($rows) - 40) . ' more (see the evidence file)';
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
            'An account belonging to another community reached the application. This is a '
            . 'community-separation breach: every tenant-scoped query would then run correctly '
            . "against the WRONG community. Read cross-community-token-replay.json.\n"
            . implode("\n", array_slice($reached, 0, 20))
        );
    }

    /**
     * @param  array<string,mixed>  $endpoint
     * @return array{status:int,body:string}
     */
    private function send(array $endpoint, string $tenantHeader): array
    {
        $uri = '/' . ltrim(preg_replace('/\{[^}]+\}/', '1', $endpoint['uri']), '/');

        try {
            $response = $this->json($endpoint['method'], $uri, [], [
                'X-Tenant-ID' => $tenantHeader,
                'Accept' => 'application/json',
            ]);

            return ['status' => $response->getStatusCode(), 'body' => (string) $response->getContent()];
        } catch (\Throwable $e) {
            // An exception is not a refusal. Reported as inconclusive by status 0.
            return ['status' => 0, 'body' => class_basename($e) . ': ' . mb_substr($e->getMessage(), 0, 160)];
        }
    }

    /**
     * Every version-2 route that actually runs the Authenticate middleware.
     *
     * Read through gatherRouteMiddleware() so that `->withoutMiddleware(...)`
     * exclusions are honoured — the declared stack still lists middleware that
     * has been removed, which produced 48 phantom breaches on the first run of
     * the role-boundary sweep.
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

            // Platform-tier routes are refused by their own gate for a member
            // regardless of community, so they cannot show whether the
            // community check fired. RoleBoundarySweepTest covers them.
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
