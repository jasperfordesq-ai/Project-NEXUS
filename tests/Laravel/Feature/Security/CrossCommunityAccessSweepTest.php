<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security;

use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Broad cross-community (cross-tenant) access sweep.
 *
 * WHY THIS EXISTS
 * ---------------
 * TenantIsolationTest covers three resources by hand (listings, transactions,
 * profiles). The v2 API registers ~1,300 endpoints that take a record id in the
 * path, so hand-written coverage will never keep pace with the surface. This
 * test enumerates the *live route table* and probes every single-id GET endpoint
 * whose module has a fixture below, using a record that belongs to a DIFFERENT
 * community, requested by an ordinary member of our own community.
 *
 * A correctly scoped endpoint refuses (404 preferred, 403 acceptable).
 * A 200 means one community can read another community's record.
 *
 * HONEST LIMITS — read before quoting a pass rate anywhere
 * --------------------------------------------------------
 *  1. Only GET endpoints with exactly one path parameter are probed. Writes
 *     (POST/PUT/DELETE) and multi-parameter routes are NOT covered here.
 *  2. Only modules present in VICTIM_FIXTURES are probed. Everything else is
 *     counted as SKIPPED, never as passed.
 *  3. A 5xx or a validation rejection is recorded as INCONCLUSIVE, never as a
 *     pass. An endpoint that errors has not demonstrated that it scopes.
 *  4. This proves the endpoint refuses one crafted request. It does not prove
 *     the underlying service is scoped on every code path.
 *
 * The counts this test prints are the numbers that may be quoted in a security
 * assessment. Do not round them up and do not describe SKIPPED as covered.
 */
class CrossCommunityAccessSweepTest extends TestCase
{
    use DatabaseTransactions;

    /** The community our attacker belongs to is $this->testTenantId (2). */
    private const VICTIM_TENANT_ID = 999;

    /**
     * Module (first URI segment after /v2/) => [factory class, extra attributes].
     *
     * Only modules listed here are probed. Add a module by naming the model
     * whose id appears in that module's {id} parameter.
     */
    private const VICTIM_FIXTURES = [
        'listings'      => \App\Models\Listing::class,
        'events'        => \App\Models\Event::class,
        'groups'        => \App\Models\Group::class,
        'goals'         => \App\Models\Goal::class,
        'polls'         => \App\Models\Poll::class,
        'posts'         => \App\Models\Post::class,
        'messages'      => \App\Models\Message::class,
        'users'         => \App\Models\User::class,
        'members'       => \App\Models\User::class,
        'reviews'       => \App\Models\Review::class,
        'notifications' => \App\Models\Notification::class,
        'pages'         => \App\Models\Page::class,
        'connections'   => \App\Models\Connection::class,
        'reports'       => \App\Models\Report::class,
        'transactions'  => \App\Models\Transaction::class,
        'jobs'          => \App\Models\JobVacancy::class,
        'volunteering'  => \App\Models\VolOpportunity::class,
        'challenges'    => \App\Models\Challenge::class,
        'newsletters'   => \App\Models\Newsletter::class,
        'resources'     => \App\Models\ResourceItem::class,
        'feed'          => \App\Models\FeedPost::class,
    ];

    /** Status codes that prove the endpoint refused a foreign record. */
    private const REFUSED = [401, 403, 404, 410];

    /**
     * Endpoints that answer 200 for a record in another community but return
     * no member data — reviewed by hand, body recorded in the evidence file.
     *
     * These are a weaker finding than a data leak: nothing about the other
     * community is disclosed, but the endpoint processes a foreign id instead
     * of refusing it, which lets a caller distinguish "exists elsewhere" from
     * "does not exist". They should all end up returning 404.
     *
     * SHRINK-ONLY. Fixing one means deleting its line in the same commit — the
     * test fails on an entry that no longer reproduces, so this list cannot rot.
     */
    private const KNOWN_SOFT_200 = [
        // reviewed 2026-09-10: returns {"status":"none",...} — identical to the
        // answer for a user id that does not exist anywhere.
        'api/v2/connections/status/{userId}',
        // reviewed 2026-09-10: returns percentage 100 against empty skill lists,
        // i.e. it scored a job it should not have loaded. No job content exposed.
        'api/v2/jobs/{id}/match',
        // reviewed 2026-09-10: every counter zero, timeline empty.
        'api/v2/users/{id}/activity/dashboard',
    ];

    /** @var array<string,int> module => victim record id */
    private array $victimIds = [];

    /** @var array<int,array<string,mixed>> */
    private array $results = [];

    public function test_no_endpoint_serves_another_communitys_record(): void
    {
        $member = $this->memberInOurCommunity();
        $endpoints = $this->probeableEndpoints();

        $this->assertNotEmpty(
            $endpoints,
            'Route enumeration produced nothing — the sweep would pass vacuously.'
        );

        foreach ($endpoints as $endpoint) {
            $this->probe($endpoint);
        }

        $this->writeEvidenceFile();
        $this->printSummary($endpoints);

        // GATE 1 — a new endpoint returning another community's data is a breach.
        $leaks = array_values(array_map(
            static fn ($r) => $r['method'] . ' ' . $r['uri'] . ' -> ' . $r['status'],
            array_filter(
                $this->results,
                static fn ($r) => $r['verdict'] === 'LEAK'
                    && ! in_array($r['uri'], self::KNOWN_SOFT_200, true)
            )
        ));

        $this->assertSame(
            [],
            $leaks,
            'An endpoint served a record belonging to another community. '
            . 'Read its body_excerpt in .local-docs-archive/security-evidence/cross-community-sweep.json '
            . 'before deciding whether it is a data leak or belongs in KNOWN_SOFT_200.'
        );

        // GATE 2 — the baseline shrinks only. An entry that no longer answers
        // 200 has been fixed, and its line must go in the same commit.
        $stillReproducing = array_values(array_filter(
            self::KNOWN_SOFT_200,
            fn (string $uri) => (bool) array_filter(
                $this->results,
                static fn ($r) => $r['uri'] === $uri && in_array($r['verdict'], ['LEAK', 'EMPTY_200'], true)
            )
        ));

        $this->assertSame(
            self::KNOWN_SOFT_200,
            $stillReproducing,
            'A KNOWN_SOFT_200 entry no longer answers 200 for a foreign record. '
            . 'It is fixed — delete its line from KNOWN_SOFT_200 so the list keeps shrinking.'
        );
    }

    // ================================================================
    // Probing
    // ================================================================

    private function probe(array $endpoint): void
    {
        $module = $endpoint['module'];
        $victimId = $this->victimIds[$module] ?? null;

        if ($victimId === null) {
            $this->results[] = $endpoint + [
                'status' => null,
                'verdict' => 'SKIPPED',
                'note' => 'no victim fixture for this module',
            ];

            return;
        }

        $uri = preg_replace('/\{[^}]+\}/', (string) $victimId, $endpoint['uri']);
        $uri = '/' . ltrim(preg_replace('#^api/#', '', $uri), '/');

        try {
            $response = $this->apiGet($uri);
            $status = $response->getStatusCode();
        } catch (\Throwable $e) {
            // An exception is NOT a pass. Record it and move on.
            $this->results[] = $endpoint + [
                'status' => null,
                'verdict' => 'INCONCLUSIVE',
                'note' => 'threw ' . class_basename($e) . ': ' . mb_substr($e->getMessage(), 0, 160),
            ];

            return;
        }

        $body = (string) $response->getContent();

        // A 200 is only a leak if it actually carried the other community's
        // data. An endpoint that correctly scopes its query and finds nothing
        // legitimately answers 200 with an empty payload — counting that as a
        // breach would pad the finding count with noise.
        $carriesData = $this->responseCarriesData($body);

        $verdict = match (true) {
            ($status === 200 || $status === 201) && $carriesData => 'LEAK',
            $status === 200 || $status === 201 => 'EMPTY_200',
            in_array($status, self::REFUSED, true) => 'REFUSED',
            default => 'INCONCLUSIVE',
        };

        $this->results[] = $endpoint + [
            'status' => $status,
            'verdict' => $verdict,
            'body_excerpt' => mb_substr($body, 0, 400),
            'note' => match ($verdict) {
                'INCONCLUSIVE' => 'status ' . $status . ' proves nothing about scoping',
                'EMPTY_200' => 'answered 200 but returned no records — scoped, or nothing to find',
                default => '',
            },
        ];
    }

    /**
     * Did a 200 response actually carry records, or was it an empty envelope?
     *
     * Treated as "no data" when the payload decodes to null/empty, or its
     * meaningful container (`data`, `items`, `results`, …) is empty, or every
     * scalar it reports is a zero/false/null default. Anything else counts as
     * data and is escalated for manual reading — the body excerpt is stored so
     * a human can confirm the call.
     */
    private function responseCarriesData(string $body): bool
    {
        $decoded = json_decode($body, true);

        if (! is_array($decoded)) {
            return trim($body) !== '' && trim($body) !== 'null';
        }

        foreach (['data', 'items', 'results', 'records'] as $container) {
            if (array_key_exists($container, $decoded)) {
                $inner = $decoded[$container];

                if ($inner === null || $inner === [] || $inner === '') {
                    return false;
                }

                return ! (is_array($inner) && $this->allValuesAreDefaults($inner));
            }
        }

        $payload = $decoded;
        unset($payload['success'], $payload['status'], $payload['message'], $payload['meta']);

        if ($payload === []) {
            return false;
        }

        return ! $this->allValuesAreDefaults($payload);
    }

    /** True when every leaf value is a zero/false/null/empty default. */
    private function allValuesAreDefaults(array $payload): bool
    {
        foreach ($payload as $value) {
            if (is_array($value)) {
                if (! $this->allValuesAreDefaults($value)) {
                    return false;
                }

                continue;
            }

            if (! in_array($value, [null, false, 0, 0.0, '0', '', '0.00'], true)) {
                return false;
            }
        }

        return true;
    }

    // ================================================================
    // Fixtures
    // ================================================================

    private function memberInOurCommunity(): \App\Models\User
    {
        $user = \App\Models\User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'member',
        ]);

        Sanctum::actingAs($user, ['*']);

        $this->seedVictimRecords();

        return $user;
    }

    /**
     * Create one record per module in the victim community.
     *
     * A factory that cannot produce a record (missing required relation, etc.)
     * leaves its module unseeded, which shows up as SKIPPED rather than as a
     * silent pass.
     */
    private function seedVictimRecords(): void
    {
        $victimOwner = \App\Models\User::factory()->forTenant(self::VICTIM_TENANT_ID)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        foreach (self::VICTIM_FIXTURES as $module => $modelClass) {
            if ($modelClass === \App\Models\User::class) {
                $this->victimIds[$module] = (int) $victimOwner->id;
                continue;
            }

            try {
                $factory = $modelClass::factory()->forTenant(self::VICTIM_TENANT_ID);
                $record = $factory->create($this->ownerAttributesFor($modelClass, $victimOwner));
                $this->victimIds[$module] = (int) $record->getKey();
            } catch (\Throwable $e) {
                fwrite(STDERR, sprintf(
                    "[sweep] could not seed victim record for module '%s' (%s): %s\n",
                    $module,
                    class_basename($modelClass),
                    mb_substr($e->getMessage(), 0, 200)
                ));
            }
        }
    }

    /**
     * Best-effort owner attribution so factories with a required user relation
     * produce a record owned inside the victim community rather than ours.
     */
    private function ownerAttributesFor(string $modelClass, \App\Models\User $owner): array
    {
        $model = new $modelClass();
        $attributes = [];

        foreach (['user_id', 'created_by', 'owner_id', 'author_id'] as $column) {
            if ($model->getConnection()->getSchemaBuilder()->hasColumn($model->getTable(), $column)) {
                $attributes[$column] = $owner->id;
            }
        }

        return $attributes;
    }

    // ================================================================
    // Route enumeration
    // ================================================================

    /**
     * Every v2 GET endpoint with exactly one path parameter.
     *
     * @return array<int,array{method:string,uri:string,module:string,action:string}>
     */
    private function probeableEndpoints(): array
    {
        $endpoints = [];

        foreach (Route::getRoutes() as $route) {
            $uri = $route->uri();

            if (! str_starts_with($uri, 'api/v2/')) {
                continue;
            }

            if (! in_array('GET', $route->methods(), true)) {
                continue;
            }

            if (substr_count($uri, '{') !== 1) {
                continue;
            }

            $module = explode('/', substr($uri, strlen('api/v2/')))[0];

            if ($module === '' || str_contains($module, '{')) {
                continue;
            }

            $endpoints[] = [
                'method' => 'GET',
                'uri' => $uri,
                'module' => $module,
                'action' => $route->getActionName(),
            ];
        }

        usort($endpoints, static fn ($a, $b) => $a['uri'] <=> $b['uri']);

        return $endpoints;
    }

    // ================================================================
    // Reporting
    // ================================================================

    private function printSummary(array $endpoints): void
    {
        $tally = ['LEAK' => 0, 'REFUSED' => 0, 'EMPTY_200' => 0, 'INCONCLUSIVE' => 0, 'SKIPPED' => 0];
        foreach ($this->results as $r) {
            $tally[$r['verdict']]++;
        }

        $lines = [];
        $lines[] = '';
        $lines[] = '=== CROSS-COMMUNITY ACCESS SWEEP ===';
        $lines[] = sprintf('v2 GET endpoints with one id parameter : %d', count($endpoints));
        $lines[] = sprintf('  probed (a victim record existed)     : %d', $tally['LEAK'] + $tally['REFUSED'] + $tally['EMPTY_200'] + $tally['INCONCLUSIVE']);
        $lines[] = sprintf('    correctly refused                  : %d', $tally['REFUSED']);
        $lines[] = sprintf('    answered 200 but returned nothing  : %d', $tally['EMPTY_200']);
        $lines[] = sprintf('    RETURNED another community\'s data  : %d', $tally['LEAK']);
        $lines[] = sprintf('    inconclusive (error/validation)    : %d', $tally['INCONCLUSIVE']);
        $lines[] = sprintf('  skipped (no fixture for module)      : %d', $tally['SKIPPED']);
        $lines[] = '';

        if ($tally['LEAK'] > 0) {
            $lines[] = 'RETURNED ANOTHER COMMUNITY\'S DATA:';
            foreach ($this->results as $r) {
                if ($r['verdict'] === 'LEAK') {
                    $lines[] = sprintf('  %s %s  -> %d', $r['method'], $r['uri'], $r['status']);
                    $lines[] = sprintf('      %s', preg_replace('/\s+/', ' ', mb_substr($r['body_excerpt'], 0, 220)));
                }
            }
            $lines[] = '';
        }

        if ($tally['INCONCLUSIVE'] > 0) {
            $lines[] = 'INCONCLUSIVE (these are NOT passes):';
            foreach ($this->results as $r) {
                if ($r['verdict'] === 'INCONCLUSIVE') {
                    $lines[] = sprintf('  %s %s  -> %s  %s', $r['method'], $r['uri'], $r['status'] ?? 'exception', $r['note']);
                }
            }
            $lines[] = '';
        }

        fwrite(STDERR, implode(PHP_EOL, $lines) . PHP_EOL);
    }

    private function writeEvidenceFile(): void
    {
        $dir = dirname(__DIR__, 4) . '/.local-docs-archive/security-evidence';

        if (! is_dir($dir) && ! @mkdir($dir, 0o775, true) && ! is_dir($dir)) {
            return;
        }

        @file_put_contents(
            $dir . '/cross-community-sweep.json',
            json_encode([
                'generated_at' => date('c'),
                'attacker_tenant' => $this->testTenantId,
                'victim_tenant' => self::VICTIM_TENANT_ID,
                'results' => $this->results,
            ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)
        );
    }
}
