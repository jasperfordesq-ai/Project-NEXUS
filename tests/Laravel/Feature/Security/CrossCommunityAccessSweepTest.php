<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\Feature\Security\Support\AccessSweepTestCase;

/**
 * Broad cross-community (cross-tenant) access sweep.
 *
 * WHY THIS EXISTS
 * ---------------
 * TenantIsolationTest covers three resources by hand. The v2 API registers
 * ~1,300 endpoints that take a record id in the path, so hand-written coverage
 * will never keep pace with the surface. This test enumerates the *live route
 * table* and, for every single-id GET endpoint whose id type it can resolve,
 * requests a record that belongs to a DIFFERENT community.
 *
 * Two actors, because the two failure modes matter differently:
 *
 *   PASS 1 — an ordinary member of our community requests member-facing routes.
 *   PASS 2 — a community ADMIN of our community requests /admin/ routes. A
 *            community administrator reading another community's records is
 *            the scenario a hosting customer fears most, so it is tested in its
 *            own right rather than inferred.
 *
 * EVERY REFUSAL IS CONTROL-VERIFIED
 * ---------------------------------
 * A 404 for a foreign record proves nothing on its own: the endpoint may simply
 * not be keyed on that id type, or may need state the fixture lacks. So every
 * probe is paired with a CONTROL — the same endpoint requested with a record of
 * the same type that belongs to OUR community and is owned by the acting user.
 * A refusal counts only when the control succeeded (200/201). If the control
 * also fails, the endpoint was not exercised and the result is INCONCLUSIVE.
 * This lowers the headline numbers and makes every one of them defensible.
 *
 * HOW AN ID TYPE IS RESOLVED
 * --------------------------
 *  1. Parameter names that are not record ids (slug, token, type, code, …) are
 *     SKIPPED as "not an id".
 *  2. Parameter names that identify a type on their own ({userId}, {groupId},
 *     {eventId}, {courseId}, {childId}, …) resolve directly.
 *  3. Otherwise the URL path before the parameter is matched, longest prefix
 *     first, against PREFIX_FIXTURES.
 *  4. Anything else is SKIPPED as "no fixture" — never counted as passing.
 *
 * HONEST LIMITS — read before quoting a number anywhere
 * -----------------------------------------------------
 *  - GET only, one path parameter only. Writes and multi-parameter routes are
 *    not covered here.
 *  - A 200 is classified by READING THE BODY. A correctly scoped query that
 *    finds nothing answers 200 with an empty list; that is EMPTY_200, not a leak.
 *  - A 4xx/5xx other than a refusal is INCONCLUSIVE, never a pass.
 *  - One crafted request per endpoint. This does not prove every code path.
 */
class CrossCommunityAccessSweepTest extends AccessSweepTestCase
{
    use DatabaseTransactions;

    /** @var array<string,int> fixture key => victim record id (tenant 999) */
    private array $victimIds = [];

    /** @var array<string,int> fixture key => control record id (tenant 2, current actor) */
    private array $controlIds = [];

    private ?User $victimOwner = null;

    /** @var array<int,array<string,mixed>> */
    private array $results = [];

    protected function setUp(): void
    {
        parent::setUp();

        // Every endpoint is requested twice (foreign + control), ~450 requests
        // from one client in a few seconds. The platform's per-route rate limits
        // engaged and answered 429 to the /users/{id}/* family, which proves the
        // limiter works and nothing about scoping. Rate limiting has its own
        // tests; this one is about tenant scoping behind it.
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);
    }

    public function test_no_endpoint_serves_another_communitys_record(): void
    {
        $endpoints = $this->probeableEndpoints();

        $this->assertNotEmpty(
            $endpoints,
            'Route enumeration produced nothing — the sweep would pass vacuously.'
        );

        $this->victimOwner = User::factory()->forTenant(self::VICTIM_TENANT_ID)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $this->victimIds = $this->seedRecords(self::VICTIM_TENANT_ID, $this->victimOwner);

        // PASS 1 — ordinary member, member-facing routes.
        $member = $this->actAs(['role' => 'member']);
        $this->controlIds = $this->seedRecords($this->testTenantId, $member);
        foreach ($endpoints as $endpoint) {
            if (! str_starts_with($endpoint['prefix'], 'admin/')) {
                $this->probe($endpoint, 'member');
            }
        }

        // PASS 2 — community admin, administration routes.
        $admin = $this->actAs(['role' => 'admin']);
        $this->controlIds = $this->seedRecords($this->testTenantId, $admin);
        foreach ($endpoints as $endpoint) {
            if (str_starts_with($endpoint['prefix'], 'admin/')) {
                $this->probe($endpoint, 'admin');
            }
        }

        $this->writeEvidenceFile();
        $this->printSummary($endpoints);

        // GATE 1 — a new endpoint returning another community's data is a breach.
        $leaks = array_values(array_map(
            static fn ($r) => $r['actor'] . ' ' . $r['method'] . ' ' . $r['uri'] . ' -> ' . $r['status'],
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
    // Write operations
    // ================================================================

    /**
     * Every non-GET v2 endpoint with exactly one path parameter, requested
     * with a record from the OTHER community and an empty JSON body.
     *
     * The bar here is deliberately the one a tester would apply: any 2xx is a
     * mutation accepted against a foreign record and is a finding. A 401/403/
     * 404/410 is a refusal. A 400/422 means validation rejected the empty body
     * before scoping could be observed — recorded as VALIDATION_FIRST and never
     * counted as a pass, because it proves nothing about the scope check.
     * There is no control request for writes: sending a real body to hundreds
     * of endpoints is out of scope for an automated sweep.
     */
    public function test_no_write_endpoint_mutates_another_communitys_record(): void
    {
        $endpoints = $this->probeableWriteEndpoints();
        $this->assertNotEmpty($endpoints, 'Write-route enumeration produced nothing — the sweep would pass vacuously.');

        $this->victimOwner = User::factory()->forTenant(self::VICTIM_TENANT_ID)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $this->victimIds = $this->seedRecords(self::VICTIM_TENANT_ID, $this->victimOwner);

        $results = [];
        $run = function (string $actor, callable $selector) use ($endpoints, &$results): void {
            foreach ($endpoints as $e) {
                if (! $selector($e)) {
                    continue;
                }
                $row = $e + ['actor' => $actor, 'status' => null, 'verdict' => 'SKIPPED', 'note' => $e['skip'] ?? '', 'body_excerpt' => ''];
                if ($e['skip'] !== null) {
                    $results[] = $row;
                    continue;
                }
                $victimId = $this->victimIds[$e['fixture']] ?? null;
                if ($victimId === null) {
                    $results[] = array_merge($row, ['note' => "fixture '{$e['fixture']}' could not be created"]);
                    continue;
                }
                $uri = '/' . ltrim(preg_replace('#^api/#', '', preg_replace('/\{[^}]+\}/', (string) $victimId, $e['uri'])), '/');

                // Snapshot the foreign record so "accepted" and "actually changed"
                // are not confused. A 2xx that leaves the row identical is an
                // endpoint that should have refused but did no harm to the other
                // community's data (a no-op unsave, an idempotent delete of a row
                // the actor never had). A 2xx that alters or removes the row is a
                // confirmed cross-community mutation. Rows CREATED elsewhere (a
                // referral, a view record) are not visible to this comparison and
                // are why every ACCEPTED_NO_CHANGE body is kept for a human to read.
                $table = $this->fixtureTable($e['fixture']);
                $before = $table ? json_encode(DB::table($table)->where('id', $victimId)->first()) : null;

                try {
                    $response = $this->json($e['method'], '/api' . $uri, [], $this->withTenantHeader());
                    $status = $response->getStatusCode();
                    $body = mb_substr((string) $response->getContent(), 0, 300);
                } catch (\Throwable $ex) {
                    // 🔴 A throw is not a reason to stop looking. The previous
                    // version returned here without reading the record again, so
                    // a request that CHANGED a foreign record and then threw was
                    // recorded as merely inconclusive. Raised by an external
                    // review, 2026-09-10.
                    $afterThrow = $table ? json_encode(DB::table($table)->where('id', $victimId)->first()) : null;

                    if ($table !== null && $before !== $afterThrow) {
                        $results[] = array_merge($row, [
                            'verdict' => 'MUTATED',
                            'note' => 'the foreign record changed and the request then threw '
                                . class_basename($ex) . ': ' . mb_substr($ex->getMessage(), 0, 120),
                        ]);

                        continue;
                    }

                    $results[] = array_merge($row, ['verdict' => 'INCONCLUSIVE', 'note' => 'threw ' . class_basename($ex) . ': ' . mb_substr($ex->getMessage(), 0, 160)]);

                    continue;
                }

                $after = $table ? json_encode(DB::table($table)->where('id', $victimId)->first()) : null;
                $rowChanged = $table !== null && $before !== $after;

                [$verdict, $note] = match (true) {
                    // 🔴 Checked BEFORE the status, and independently of it. Classifying a
                    // mutation only on a 2xx meant a write that CHANGED a foreign record and
                    // then returned an error escaped the detector entirely. Raised by an
                    // external review of the assessment, 2026-09-10.
                    $rowChanged => ['MUTATED', ($after === 'null' ? 'the foreign record was DELETED' : 'the foreign record was CHANGED') . " (response was {$status})"],
                    $status >= 200 && $status < 300 => ['ACCEPTED_NO_CHANGE', '2xx for a foreign id but its row is unchanged — should refuse; read the body for side rows'],
                    in_array($status, [401, 403, 404, 410], true) => ['REFUSED', ''],
                    in_array($status, [400, 422], true) => ['VALIDATION_FIRST', 'validation rejected the empty body before scoping could be observed — not a pass'],
                    $status === 405 => ['SKIPPED', 'method not allowed at runtime'],
                    default => ['INCONCLUSIVE', "status {$status}"],
                };

                // Third case: does the same request behave any differently for an id
                // that exists NOWHERE? If not, the success reply reveals nothing about
                // whether the foreign record exists, and "existence disclosure" is the
                // wrong label for it.
                $ghost = $verdict === 'ACCEPTED_NO_CHANGE'
                    ? $this->ghostComparison($e['method'], '/' . preg_replace('/\{[^}]+\}/', (string) self::GHOST_ID, $e['uri']), [], $status, $body)
                    : null;

                $results[] = array_merge($row, ['status' => $status, 'verdict' => $verdict, 'note' => $note, 'body_excerpt' => $verdict === 'REFUSED' ? '' : $body, 'ghost' => $ghost]);
            }
        };

        $this->actAs(['role' => 'member']);
        $run('member', static fn ($e) => ! str_starts_with($e['prefix'], 'admin/'));

        $this->actAs(['role' => 'admin']);
        $run('admin', static fn ($e) => str_starts_with($e['prefix'], 'admin/'));

        // Evidence + summary.
        $dir = dirname(__DIR__, 4) . '/.local-docs-archive/security-evidence';
        if (is_dir($dir) || @mkdir($dir, 0o775, true) || is_dir($dir)) {
            @file_put_contents($dir . '/cross-community-write-sweep.json', json_encode([
                'generated_at' => date('c'),
                'method' => 'Every non-GET single-parameter v2 route requested with a tenant-999 record id and an empty JSON body, as a tenant-2 member (member routes) and a tenant-2 community admin (/admin/ routes). 2xx = MUTATED (finding); 401/403/404/410 = REFUSED; 400/422 = VALIDATION_FIRST (not a pass).',
                'results' => $results,
            ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        }

        $lines = ['', '=== CROSS-COMMUNITY WRITE SWEEP ===', sprintf('non-GET v2 endpoints with one path parameter : %d', count($endpoints))];
        foreach (['member' => 'PASS 1 — member, member-facing routes', 'admin' => 'PASS 2 — community admin, /admin/ routes'] as $actor => $label) {
            $t = ['MUTATED' => 0, 'ACCEPTED_NO_CHANGE' => 0, 'REFUSED' => 0, 'VALIDATION_FIRST' => 0, 'INCONCLUSIVE' => 0, 'SKIPPED' => 0];
            foreach ($results as $r) {
                if ($r['actor'] === $actor) {
                    $t[$r['verdict']]++;
                }
            }
            $lines[] = '';
            $lines[] = $label;
            $lines[] = sprintf('  probed                                    : %d', $t['MUTATED'] + $t['ACCEPTED_NO_CHANGE'] + $t['REFUSED'] + $t['VALIDATION_FIRST'] + $t['INCONCLUSIVE']);
            $lines[] = sprintf('    refused (401/403/404/410)               : %d', $t['REFUSED']);
            $lines[] = sprintf('    validation rejected first (not a pass)  : %d', $t['VALIDATION_FIRST']);
            $lines[] = sprintf('    accepted, foreign row unchanged (review): %d', $t['ACCEPTED_NO_CHANGE']);
            $lines[] = sprintf('      ...indistinguishable from a NONEXISTENT id: %d  (no existence disclosure)', count(array_filter($results, static fn ($r) => $r['actor'] === $actor && $r['verdict'] === 'ACCEPTED_NO_CHANGE' && (($r['ghost']['distinguishable'] ?? true) === false))));
            $lines[] = sprintf('    MUTATED the foreign record              : %d', $t['MUTATED']);
            $lines[] = sprintf('    inconclusive                            : %d', $t['INCONCLUSIVE']);
            $lines[] = sprintf('  skipped                                   : %d', $t['SKIPPED']);
        }
        $lines[] = '';
        foreach (['MUTATED', 'ACCEPTED_NO_CHANGE', 'INCONCLUSIVE'] as $bucket) {
            $rows = array_filter($results, static fn ($r) => $r['verdict'] === $bucket);
            if ($rows === []) {
                continue;
            }
            $lines[] = $bucket . ':';
            foreach ($rows as $r) {
                $lines[] = sprintf('  [%s] %-6s %s -> %s  %s', $r['actor'], $r['method'], $r['uri'], $r['status'] ?? 'exception', preg_replace('/\s+/', ' ', $r['body_excerpt']));
            }
            $lines[] = '';
        }
        fwrite(STDERR, implode(PHP_EOL, $lines) . PHP_EOL);

        $mutated = array_values(array_map(
            static fn ($r) => $r['actor'] . ' ' . $r['method'] . ' ' . $r['uri'] . ' -> ' . $r['status'],
            array_filter($results, static fn ($r) => $r['verdict'] === 'MUTATED')
        ));

        $this->assertSame([], $mutated, 'A write against another community\'s record was accepted. Read the body_excerpt in cross-community-write-sweep.json.');

        // Baseline of accepted-but-harmless no-ops: may only shrink.
        $acceptedNoChange = array_values(array_map(
            static fn ($r) => $r['method'] . ' ' . $r['uri'],
            array_filter($results, static fn ($r) => $r['verdict'] === 'ACCEPTED_NO_CHANGE')
        ));
        sort($acceptedNoChange);
        $known = self::KNOWN_ACCEPTED_NO_CHANGE;
        sort($known);

        $this->assertSame(
            [],
            array_values(array_diff($acceptedNoChange, $known)),
            'A write endpoint newly acknowledges a foreign id with 2xx. Read its body in cross-community-write-sweep.json; '
            . 'fix it to refuse, or — only if it provably touches nothing — add it to KNOWN_ACCEPTED_NO_CHANGE with a note.'
        );

        $this->assertSame(
            [],
            array_values(array_diff($known, $acceptedNoChange)),
            'A KNOWN_ACCEPTED_NO_CHANGE entry no longer answers 2xx for a foreign id. It is fixed — delete its line.'
        );
    }

    /**
     * A PERSON from another community, supplied as the SECOND identifier.
     *
     * WHY THIS IS A SEPARATE SWEEP
     * ----------------------------
     * Both sweeps above take routes with exactly ONE path parameter. 141
     * route-and-method combinations take two or more, and none of them were
     * exercised. They are also where a scoping bug is most likely to survive
     * review, because the handler checks that the FIRST id belongs to the
     * caller's community and then forgets the second.
     *
     * `PUT groups/{id}/members/{userId}` with OUR group and a FOREIGN member is
     * the shape that matters: nothing about the group looks wrong, the caller is
     * a legitimate administrator of it, and a person is quietly pulled across a
     * community boundary. So the outer record here is deliberately ours and
     * legitimate. Only the person is foreign. A refusal is the required answer.
     *
     * DETECTOR — stronger than the single-parameter write sweep's
     * -----------------------------------------------------------
     * That sweep compares the target row before and after, and says plainly
     * that rows CREATED ELSEWHERE are invisible to it. That blind spot is
     * exactly this sweep's subject, because "add this person to my group"
     * creates a row in a join table rather than altering the group. So this
     * sweep counts, before and after every request, each row in the schema that
     * REFERENCES the foreign person — across every table carrying a
     * person-shaped foreign key. A count that moves in either direction is a
     * confirmed cross-community write, whether the row was created, changed or
     * removed.
     *
     * CONTROL-VERIFIED, like the read sweep: every probe is repeated with a
     * person from our OWN community, so an endpoint that refuses everything
     * cannot be counted as a pass.
     */
    public function test_no_endpoint_accepts_a_person_from_another_community(): void
    {
        $endpoints = $this->multiParamPersonEndpoints();
        $this->assertNotEmpty(
            $endpoints,
            'Multi-parameter route enumeration produced nothing — this sweep would pass vacuously.'
        );

        $this->victimOwner = User::factory()->forTenant(self::VICTIM_TENANT_ID)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $foreignPersonId = (int) $this->victimOwner->id;

        $refs = $this->personReferenceColumns();
        $unreadableColumns = 0;
        $this->assertNotEmpty($refs, 'No person-shaped foreign keys found — the mutation detector would be blind.');

        $results = [];

        $run = function (string $actorLabel, User $actor, callable $selector) use (
            $endpoints,
            &$results,
            $foreignPersonId,
            $refs,
            &$unreadableColumns
        ): void {
            $ownIds = $this->seedRecords($this->testTenantId, $actor);
            $controlPerson = User::factory()->forTenant($this->testTenantId)->create([
                'status' => 'active',
                'is_approved' => true,
            ]);
            $this->seedControlRelationships($controlPerson, $actor, $ownIds);

            foreach ($endpoints as $e) {
                if (! $selector($e)) {
                    continue;
                }

                $row = $e + [
                    'actor' => $actorLabel,
                    'status' => null,
                    'control_status' => null,
                    'verdict' => 'SKIPPED',
                    'note' => $e['skip'] ?? '',
                    'body_excerpt' => '',
                    'moved' => [],
                ];

                if ($e['skip'] !== null) {
                    $results[] = $row;

                    continue;
                }

                // Re-established before EVERY endpoint, not once per pass.
                // The control request for `DELETE .../members/{userId}` really
                // does remove the control person from the group, after which
                // every later control failed and seven endpoints were reported
                // INCONCLUSIVE for a reason that was this test's fault rather
                // than the platform's.
                $this->seedControlRelationships($controlPerson, $actor, $ownIds);

                [$uri, $missing] = $this->fillMultiParamUri($e['plan'], $e['uri'], $ownIds, $foreignPersonId);
                if ($missing !== null) {
                    $results[] = array_merge($row, ['note' => $missing]);

                    continue;
                }

                $beforeSnap = $this->personReferenceFingerprints($refs, $foreignPersonId);
                $before = $beforeSnap['fingerprints'];
                $unreadableColumns = max($unreadableColumns, $beforeSnap['unreadable']);
                $threw = null;
                $status = 0;
                $body = '';
                $fullBody = '';

                try {
                    $response = $this->json(
                        $e['method'],
                        '/' . ltrim($uri, '/'),
                        [],
                        $this->withTenantHeader()
                    );
                    $status = $response->getStatusCode();
                    $fullBody = (string) $response->getContent();
                    $body = mb_substr($fullBody, 0, 300);
                } catch (\Throwable $ex) {
                    // The after-snapshot is still taken: a request that changed
                    // something and THEN threw must not be filed as merely
                    // inconclusive.
                    $threw = class_basename($ex) . ': ' . mb_substr($ex->getMessage(), 0, 160);
                }

                $after = $this->personReferenceFingerprints($refs, $foreignPersonId)['fingerprints'];
                $moved = [];
                foreach ($after as $where => $fingerprint) {
                    $was = $before[$where] ?? null;
                    if ($fingerprint !== $was) {
                        $moved[] = "{$where}: " . var_export($was, true) . " -> {$fingerprint}";
                    }
                }

                if ($threw !== null) {
                    $results[] = array_merge($row, [
                        'verdict' => $moved === [] ? 'INCONCLUSIVE' : 'MUTATED',
                        'note' => $moved === []
                            ? 'threw ' . $threw
                            : 'rows referencing the foreign person moved and the request then threw ' . $threw,
                        'moved' => $moved,
                    ]);

                    continue;
                }

                // Control: the same request for a person of OUR community, so a
                // blanket-refusing endpoint cannot be scored as a pass.
                [$controlUri] = $this->fillMultiParamUri($e['plan'], $e['uri'], $ownIds, (int) $controlPerson->id);
                $controlStatus = null;

                try {
                    $controlStatus = $this->json(
                        $e['method'],
                        '/' . ltrim($controlUri, '/'),
                        [],
                        $this->withTenantHeader()
                    )->getStatusCode();
                } catch (\Throwable) {
                    $controlStatus = null;
                }

                $controlWorked = $controlStatus !== null && $controlStatus >= 200 && $controlStatus < 300;
                $succeeded = $status >= 200 && $status < 300;
                $isRead = $e['method'] === 'GET';

                [$verdict, $note] = match (true) {
                    // Independent of the response status, and read from row CONTENTS
                    // rather than row counts — see personReferenceFingerprints().
                    $moved !== [] => ['MUTATED', "rows referencing the foreign person moved (response was {$status}): " . implode('; ', $moved)],
                    // The FULL body is scanned, not the 300-character excerpt kept for
                    // the report: a leak further down the response would otherwise be
                    // invisible to the detector while visible to the caller.
                    $succeeded && $isRead && $this->bodyMentionsVictim($fullBody, $foreignPersonId) => ['LEAKED', 'the response carried the foreign person\'s data'],
                    $succeeded => ['ACCEPTED_NO_CHANGE', '2xx for a foreign person but nothing referencing them moved — should refuse'],
                    in_array($status, self::REFUSED, true) && $controlWorked => ['REFUSED', ''],
                    in_array($status, self::REFUSED, true) => ['INCONCLUSIVE', "refused, but the control also failed ({$controlStatus}) — endpoint not exercised"],
                    in_array($status, [400, 422], true) => ['VALIDATION_FIRST', 'validation rejected the empty body before scoping could be observed — not a pass'],
                    $status === 405 => ['SKIPPED', 'method not allowed at runtime'],
                    default => ['INCONCLUSIVE', "status {$status}"],
                };

                $results[] = array_merge($row, [
                    'status' => $status,
                    'control_status' => $controlStatus,
                    'verdict' => $verdict,
                    'note' => $note,
                    'moved' => $moved,
                    'body_excerpt' => $verdict === 'REFUSED' ? '' : $body,
                ]);
            }
        };

        $member = $this->actAs(['role' => 'member']);
        $run('member', $member, static fn ($e) => ! str_starts_with($e['prefix'], 'admin/'));

        $admin = $this->actAs(['role' => 'admin']);
        $run('admin', $admin, static fn ($e) => str_starts_with($e['prefix'], 'admin/'));

        $dir = dirname(__DIR__, 4) . '/.local-docs-archive/security-evidence';
        if (is_dir($dir) || @mkdir($dir, 0o775, true) || is_dir($dir)) {
            @file_put_contents($dir . '/cross-community-person-sweep.json', json_encode([
                'generated_at' => date('c'),
                'method' => 'Every v2 route taking two or more path parameters where one names a PERSON. The record parameters are filled with OUR OWN records, owned by the acting user; only the person is from tenant 999. Rows referencing that person are counted across every person-shaped foreign key in the schema, before and after each request, so a created join row is detected. Every probe is control-verified with a person from our own community.',
                'person_reference_columns_watched' => count($refs),
                'person_reference_columns_unreadable' => $unreadableColumns,
                'results' => $results,
            ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        }

        $lines = ['', '=== FOREIGN-PERSON SWEEP (multi-parameter routes) ===',
            sprintf('multi-parameter v2 route/method combinations naming a person : %d', count($endpoints)),
            sprintf('person-shaped foreign keys watched for side rows            : %d', count($refs)),
            sprintf('  of which could NOT be read (blind spots, not passes)      : %d', $unreadableColumns),
        ];
        foreach (['member' => 'PASS 1 — member, member-facing routes', 'admin' => 'PASS 2 — community admin, /admin/ routes'] as $actorLabel => $label) {
            $t = ['MUTATED' => 0, 'LEAKED' => 0, 'ACCEPTED_NO_CHANGE' => 0, 'REFUSED' => 0, 'VALIDATION_FIRST' => 0, 'INCONCLUSIVE' => 0, 'SKIPPED' => 0];
            foreach ($results as $r) {
                if ($r['actor'] === $actorLabel) {
                    $t[$r['verdict']]++;
                }
            }
            $lines[] = '';
            $lines[] = $label;
            $lines[] = sprintf('  probed                                    : %d', $t['MUTATED'] + $t['LEAKED'] + $t['ACCEPTED_NO_CHANGE'] + $t['REFUSED'] + $t['VALIDATION_FIRST'] + $t['INCONCLUSIVE']);
            $lines[] = sprintf('    refused, control succeeded              : %d', $t['REFUSED']);
            $lines[] = sprintf('    validation rejected first (not a pass)  : %d', $t['VALIDATION_FIRST']);
            $lines[] = sprintf('    accepted, nothing moved (review)        : %d', $t['ACCEPTED_NO_CHANGE']);
            $lines[] = sprintf('    LEAKED the foreign person\'s data        : %d', $t['LEAKED']);
            $lines[] = sprintf('    MUTATED rows referencing them           : %d', $t['MUTATED']);
            $lines[] = sprintf('    inconclusive                            : %d', $t['INCONCLUSIVE']);
            $lines[] = sprintf('  skipped                                   : %d', $t['SKIPPED']);
        }
        $lines[] = '';
        foreach (['MUTATED', 'LEAKED', 'ACCEPTED_NO_CHANGE', 'INCONCLUSIVE'] as $bucket) {
            $rows = array_filter($results, static fn ($r) => $r['verdict'] === $bucket);
            if ($rows === []) {
                continue;
            }
            $lines[] = $bucket . ':';
            foreach ($rows as $r) {
                $lines[] = sprintf(
                    '  [%s] %-6s %s  probe=%s control=%s  %s',
                    $r['actor'],
                    $r['method'],
                    $r['uri'],
                    $r['status'] ?? 'exception',
                    $r['control_status'] ?? '-',
                    preg_replace('/\s+/', ' ', $r['note'] . ' ' . $r['body_excerpt'])
                );
            }
            $lines[] = '';
        }
        fwrite(STDERR, implode(PHP_EOL, $lines) . PHP_EOL);

        $breaches = array_values(array_map(
            static fn ($r) => $r['verdict'] . ' ' . $r['actor'] . ' ' . $r['method'] . ' ' . $r['uri'] . ' -> ' . $r['status'] . ' :: ' . $r['note'],
            array_filter($results, static fn ($r) => in_array($r['verdict'], ['MUTATED', 'LEAKED'], true))
        ));

        $this->assertSame(
            [],
            $breaches,
            'An endpoint accepted or served a person belonging to another community. '
            . 'Read cross-community-person-sweep.json.'
        );

        // Accepted-but-inert answers: shrink-only, both directions.
        $acceptedNoChange = array_values(array_map(
            static fn ($r) => $r['method'] . ' ' . $r['uri'],
            array_filter($results, static fn ($r) => $r['verdict'] === 'ACCEPTED_NO_CHANGE')
        ));
        sort($acceptedNoChange);
        $known = self::KNOWN_PERSON_ACCEPTED_NO_CHANGE;
        sort($known);

        $this->assertSame(
            [],
            array_values(array_diff($acceptedNoChange, $known)),
            'An endpoint newly answers 2xx for a person from another community. Fix it to refuse, '
            . 'or — only if it provably touches nothing — add it to KNOWN_PERSON_ACCEPTED_NO_CHANGE with a note.'
        );

        $this->assertSame(
            [],
            array_values(array_diff($known, $acceptedNoChange)),
            'A KNOWN_PERSON_ACCEPTED_NO_CHANGE entry no longer answers 2xx for a foreign person. It is fixed — delete its line.'
        );
    }

    /**
     * Does the mutation detector actually detect anything?
     *
     * WHY THIS TEST EXISTS
     * --------------------
     * Every sweep in this file reports "0 mutated". That number is worth exactly
     * as much as the detector behind it, and an external review of the
     * assessment pointed out — correctly — that the detector had blind spots
     * which the reported figure did not disclose. Three were real:
     *
     *   1. a mutation was classified only when the response was 2xx, so a write
     *      that changed a record and then errored escaped entirely;
     *   2. an exception skipped the after-snapshot altogether;
     *   3. the person sweep compared row COUNTS, so changing somebody's role in
     *      a group — same row, same count — was invisible.
     *
     * All three are fixed. This test is the proof, and it is deliberately the
     * inverse of every other test here: it **causes** each kind of change and
     * fails if the detector does not see it. A detector nobody has tried to fool
     * is an assumption, not a control.
     */
    public function test_the_mutation_detector_sees_changes_it_is_supposed_to_see(): void
    {
        $owner = User::factory()->forTenant(self::VICTIM_TENANT_ID)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $ids = $this->seedRecords(self::VICTIM_TENANT_ID, $owner);

        $listingId = $ids['listing'] ?? null;
        $this->assertNotNull($listingId, 'Listing fixture missing — cannot exercise the detector.');

        // ---- (1) A field change on the watched row must be seen.
        $before = json_encode(DB::table('listings')->where('id', $listingId)->first());
        DB::table('listings')->where('id', $listingId)->update(['title' => 'Mutated by the detector self-test']);
        $after = json_encode(DB::table('listings')->where('id', $listingId)->first());

        $this->assertNotSame($before, $after, 'A field change on the watched row was NOT visible to the row comparison.');

        // ---- (2) A deletion must be seen, and must be distinguishable.
        DB::table('listings')->where('id', $listingId)->delete();
        $afterDelete = json_encode(DB::table('listings')->where('id', $listingId)->first());

        $this->assertSame('null', $afterDelete, 'A deletion did not read back as null, so the DELETED/CHANGED wording would be wrong.');
        $this->assertNotSame($after, $afterDelete, 'A deletion was NOT visible to the row comparison.');

        // ---- (3) A side row created elsewhere, referencing the person, must be
        // seen — this is the shape of the one real cross-community side effect
        // found in this assessment (a referral minted against a foreign vacancy).
        $refs = $this->personReferenceColumns();
        $this->assertNotEmpty($refs, 'No person-shaped foreign keys resolved — the side-row detector would be blind.');

        $personId = (int) $owner->id;
        $sideBefore = $this->personReferenceFingerprints($refs, $personId)['fingerprints'];

        DB::table('notifications')->insert([
            'tenant_id' => self::VICTIM_TENANT_ID,
            'user_id' => $personId,
            'type' => 'detector_self_test',
            'message' => 'Side row created by the detector self-test',
            'created_at' => now(),
        ]);

        $sideAfter = $this->personReferenceFingerprints($refs, $personId)['fingerprints'];
        $this->assertNotSame($sideBefore, $sideAfter, 'A row CREATED elsewhere referencing the person was NOT detected.');

        // ---- (4) The one the count-based detector used to miss entirely:
        // a change to an existing row that leaves the number of rows identical.
        $countBefore = count($sideAfter);
        DB::table('notifications')
            ->where('user_id', $personId)
            ->where('type', 'detector_self_test')
            ->update(['message' => 'Same row, same count, different contents']);

        $sameCount = $this->personReferenceFingerprints($refs, $personId)['fingerprints'];

        $this->assertSame(
            $countBefore,
            count($sameCount),
            'Precondition failed: this step must not change how many entries are watched.'
        );
        $this->assertNotSame(
            $sideAfter,
            $sameCount,
            'A CONTENT change with an unchanged row count was NOT detected. This is exactly the '
            . 'blind spot the external review identified, and it must stay closed.'
        );
    }

    /**
     * The write endpoints that validation refused before the community check
     * could be seen — re-tried with a body validation will accept.
     *
     * WHY THIS EXISTS
     * ---------------
     * The write sweep above sends an EMPTY body, and 108 of the 366 endpoints it
     * probed rejected that at validation before any community check could run.
     * Those are recorded as unproven, never as passes — but "unproven" was the
     * largest single gap in the whole assessment, and an endpoint that has not
     * been exercised is exactly where a scoping mistake survives.
     *
     * HOW A VALID BODY IS FOUND WITHOUT HAND-WRITING 108 OF THEM
     * ----------------------------------------------------------
     * The API's own validation errors name the field that failed, and often the
     * values it will accept:
     *
     *     {"errors":[{"code":"VALIDATION_ERROR",
     *                 "message":"Invalid reaction_type. Valid types: love, like, …",
     *                 "field":"reaction_type"}]}
     *
     * So the endpoint is asked repeatedly: send a body, read which field it
     * objected to, add a plausible value for that field, send again. Up to eight
     * rounds, stopping as soon as validation stops complaining — or as soon as it
     * complains twice about the same field, which means the value was rejected
     * rather than missing and guessing further would be dishonest.
     *
     * The identifier in the URL is still another community's throughout. A body
     * that satisfies validation must NOT turn into a write against a record that
     * belongs to somebody else.
     *
     * WHAT COUNTS
     * -----------
     * Reaching validation's far side is not itself a pass — it is what makes the
     * real question askable. The verdicts are the write sweep's: the foreign row
     * is read before and after, so MUTATED means a confirmed cross-community
     * write, REFUSED means the endpoint declined a foreign identifier while
     * holding a body it was happy with, and VALIDATION_UNRESOLVED means we could
     * not construct an acceptable body and the endpoint remains unproven.
     */
    public function test_write_endpoints_refuse_a_foreign_id_even_with_a_valid_body(): void
    {
        $this->enableTenantFeatures(['courses', 'podcasts'], $this->testTenantId, self::VICTIM_TENANT_ID);

        $endpoints = $this->probeableWriteEndpoints();
        $this->assertNotEmpty($endpoints, 'Write-route enumeration produced nothing — this sweep would pass vacuously.');

        $this->victimOwner = User::factory()->forTenant(self::VICTIM_TENANT_ID)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $this->victimIds = $this->seedRecords(self::VICTIM_TENANT_ID, $this->victimOwner);

        $results = [];

        $run = function (string $actor, callable $selector) use ($endpoints, &$results): void {
            foreach ($endpoints as $e) {
                if (! $selector($e) || $e['skip'] !== null) {
                    continue;
                }

                $victimId = $this->victimIds[$e['fixture']] ?? null;
                if ($victimId === null) {
                    continue;
                }

                // $e['uri'] ALREADY begins with `api/`. Prefixing another `/api`
                // produced `/api/api/v2/...`, which matches no route, so all 366
                // endpoints answered a router 404 — scored as REFUSED, and the
                // sweep reported a flawless 366/366 in under six seconds. The
                // assertion below now makes that failure mode impossible.
                $uri = '/' . ltrim(preg_replace('/\{[^}]+\}/', (string) $victimId, $e['uri']), '/');
                $table = $this->fixtureTable($e['fixture']);
                $before = $table ? json_encode(DB::table($table)->where('id', $victimId)->first()) : null;

                $body = [];
                $tried = [];
                $status = null;
                $raw = '';
                $rounds = 0;

                for ($attempt = 0; $attempt < 8; $attempt++) {
                    $rounds = $attempt + 1;

                    try {
                        $response = $this->json($e['method'], $uri, $body, $this->withTenantHeader());
                        $status = $response->getStatusCode();
                        $raw = (string) $response->getContent();
                    } catch (\Throwable $ex) {
                        $status = 0;
                        $raw = class_basename($ex) . ': ' . mb_substr($ex->getMessage(), 0, 160);

                        break;
                    }

                    if (! in_array($status, [400, 422], true)) {
                        break;
                    }

                    [$field, $message] = $this->firstFailingField($raw);
                    if ($field === null || isset($tried[$field])) {
                        break;
                    }

                    $tried[$field] = true;
                    $body[$field] = $this->synthesiseValue($field, $message);
                }

                $after = $table ? json_encode(DB::table($table)->where('id', $victimId)->first()) : null;
                $rowChanged = $table !== null && $before !== $after;

                [$verdict, $note] = match (true) {
                    // 🔴 Checked BEFORE the status, and independently of it. Classifying a
                    // mutation only on a 2xx meant a write that CHANGED a foreign record and
                    // then returned an error escaped the detector entirely. Raised by an
                    // external review of the assessment, 2026-09-10.
                    $rowChanged => ['MUTATED', ($after === 'null' ? 'the foreign record was DELETED' : 'the foreign record was CHANGED') . " (response was {$status})"],
                    $status >= 200 && $status < 300 => ['ACCEPTED_NO_CHANGE', '2xx for a foreign id with a valid body, row unchanged — should refuse'],
                    in_array($status, [401, 403, 404, 410], true) => ['REFUSED', ''],
                    in_array($status, [400, 422], true) => ['VALIDATION_UNRESOLVED', 'no acceptable body could be constructed — still unproven'],
                    $status === 405 => ['SKIPPED', 'method not allowed at runtime'],
                    default => ['INCONCLUSIVE', "status {$status}"],
                };

                // Third case, as in the empty-body pass: the SAME accepted body against an
                // id that exists nowhere. Identical answers mean no existence disclosure.
                $ghost = $verdict === 'ACCEPTED_NO_CHANGE'
                    ? $this->ghostComparison($e['method'], '/' . preg_replace('/\{[^}]+\}/', (string) self::GHOST_ID, $e['uri']), $body, (int) $status, mb_substr($raw, 0, 300))
                    : null;

                $results[] = [
                    'actor' => $actor,
                    'method' => $e['method'],
                    'uri' => $e['uri'],
                    'status' => $status,
                    'verdict' => $verdict,
                    'note' => $note,
                    'rounds' => $rounds,
                    'body_sent' => $body,
                    'body_excerpt' => $verdict === 'REFUSED' ? '' : mb_substr($raw, 0, 260),
                    'ghost' => $ghost,
                ];
            }
        };

        $this->actAs(['role' => 'member']);
        $run('member', static fn ($e) => ! str_starts_with($e['prefix'], 'admin/'));

        $this->actAs(['role' => 'admin']);
        $run('admin', static fn ($e) => str_starts_with($e['prefix'], 'admin/'));

        $tally = ['MUTATED' => 0, 'ACCEPTED_NO_CHANGE' => 0, 'REFUSED' => 0, 'VALIDATION_UNRESOLVED' => 0, 'INCONCLUSIVE' => 0, 'SKIPPED' => 0];
        foreach ($results as $r) {
            $tally[$r['verdict']]++;
        }

        $dir = dirname(__DIR__, 4) . '/.local-docs-archive/security-evidence';
        if (is_dir($dir) || @mkdir($dir, 0o775, true) || is_dir($dir)) {
            @file_put_contents($dir . '/cross-community-valid-body-sweep.json', json_encode([
                'generated_at' => date('c'),
                'method' => "Every probeable non-GET single-parameter v2 endpoint, requested with another community's record id and a body built by reading the API's own validation errors: send, read which field it objected to, supply a plausible value, send again, up to eight rounds. Stops when validation objects twice to the same field. The foreign row is read before and after.",
                'tally' => $tally,
                'results' => $results,
            ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        }

        $lines = [
            '',
            '=== WRITE SWEEP WITH A VALID BODY ===',
            sprintf('endpoints attempted                        : %d', count($results)),
            sprintf('  refused a foreign id holding a good body : %d', $tally['REFUSED']),
            sprintf('  MUTATED the foreign record               : %d', $tally['MUTATED']),
            sprintf('  accepted, row unchanged (review)         : %d', $tally['ACCEPTED_NO_CHANGE']),
            sprintf('    ...indistinguishable from a NONEXISTENT id: %d  (no existence disclosure)', count(array_filter($results, static fn ($r) => $r['verdict'] === 'ACCEPTED_NO_CHANGE' && (($r['ghost']['distinguishable'] ?? true) === false)))),
            sprintf('  no acceptable body found (still unproven): %d', $tally['VALIDATION_UNRESOLVED']),
            sprintf('  inconclusive                             : %d', $tally['INCONCLUSIVE']),
            sprintf('  method not allowed                       : %d', $tally['SKIPPED']),
            '',
        ];
        foreach (['MUTATED', 'ACCEPTED_NO_CHANGE', 'INCONCLUSIVE'] as $bucket) {
            $rows = array_filter($results, static fn ($r) => $r['verdict'] === $bucket);
            if ($rows === []) {
                continue;
            }
            $lines[] = $bucket . ':';
            foreach ($rows as $r) {
                $lines[] = sprintf(
                    '  [%s] %-6s %-58s %s  body=%s  %s',
                    $r['actor'],
                    $r['method'],
                    $r['uri'],
                    $r['status'],
                    json_encode(array_keys($r['body_sent'])),
                    preg_replace('/\s+/', ' ', $r['body_excerpt'])
                );
            }
            $lines[] = '';
        }
        fwrite(STDERR, implode(PHP_EOL, $lines) . PHP_EOL);

        // A router 404 means the URL matched no route at all, so the endpoint was
        // never exercised and the "refusal" is worthless. The first version of
        // this test built `/api/api/v2/...` and scored a flawless 366 of 366 in
        // under six seconds on exactly that mistake. Refuse to report at all if
        // it recurs.
        $unrouted = array_values(array_map(
            static fn ($r) => $r['method'] . ' ' . $r['uri'],
            array_filter(
                $results,
                static fn ($r) => str_contains($r['body_excerpt'], 'could not be found')
                    && str_contains($r['body_excerpt'], 'NotFoundHttpException')
            )
        ));

        $this->assertSame(
            [],
            $unrouted,
            'Requests did not match any route, so nothing was exercised. The URL is being built '
            . "wrongly — check the `api/` prefix.\n" . implode("\n", array_slice($unrouted, 0, 5))
        );

        $this->assertGreaterThan(
            0,
            $tally['REFUSED'] + $tally['MUTATED'] + $tally['ACCEPTED_NO_CHANGE'] + $tally['VALIDATION_UNRESOLVED'],
            'No endpoint produced a usable verdict.'
        );

        $mutated = array_values(array_map(
            static fn ($r) => $r['actor'] . ' ' . $r['method'] . ' ' . $r['uri'] . ' -> ' . $r['status'],
            array_filter($results, static fn ($r) => $r['verdict'] === 'MUTATED')
        ));

        $this->assertSame(
            [],
            $mutated,
            "A write against another community's record was accepted once the body satisfied "
            . 'validation. Read cross-community-valid-body-sweep.json.'
        );

        $accepted = array_values(array_map(
            static fn ($r) => $r['method'] . ' ' . $r['uri'],
            array_filter($results, static fn ($r) => $r['verdict'] === 'ACCEPTED_NO_CHANGE')
        ));
        sort($accepted);
        $known = self::KNOWN_VALID_BODY_ACCEPTED;
        sort($known);

        $this->assertSame(
            [],
            array_values(array_diff($accepted, $known)),
            'A write endpoint newly answers 2xx for a foreign id when given a valid body. Fix it '
            . 'to refuse, or — only if it provably touches nothing — add it to '
            . 'KNOWN_VALID_BODY_ACCEPTED with a note.'
        );
    }

    /**
     * A CHILD RECORD from another community, supplied as the deepest identifier.
     *
     * The companion to the foreign-person sweep, and the rest of Finding 14.
     * These are the multi-parameter routes whose second identifier is another
     * RECORD rather than a person: a lesson within a course, a version within a
     * legal document, an episode within a show, an answer within a question.
     *
     * The shape is the same and so is the reasoning: **every identifier except
     * the last is one of OUR OWN records, owned by the acting user.** Only the
     * deepest one belongs to another community. So the request looks entirely
     * legitimate up to its final segment, and it fails only if the handler
     * confirms that the child really belongs to the parent it was reached
     * through — which is the check most easily forgotten.
     *
     * WHY THIS NEEDED EIGHTEEN NEW FIXTURES
     * -------------------------------------
     * Measuring this first showed why it could not be bolted onto the existing
     * resolution: 84 of the 86 candidate routes resolved BOTH identifiers to
     * the same fixture type, because the child parameter fell back to matching
     * its parent's path prefix. The sweep would have requested
     * `courses/5/lessons/5` — the same row as both course and lesson — and the
     * control would have rejected it, producing a page of results that proved
     * nothing while appearing to be coverage. Real child fixtures, each linked
     * by `needs` to the parent seeded for the same community, are what make the
     * question answerable at all.
     *
     * Every probe is control-verified: the same request with OUR OWN child.
     */
    public function test_no_endpoint_accepts_a_child_record_from_another_community(): void
    {
        $endpoints = $this->multiParamChildEndpoints();
        $this->assertNotEmpty(
            $endpoints,
            'Multi-parameter child-route enumeration produced nothing — this sweep would pass vacuously.'
        );

        // The courses module is switched OFF for the test community, so twelve
        // course endpoints answered 403 FEATURE_DISABLED to the probe AND to
        // the control — an unexercised endpoint, not a pass. A feature gate
        // firing first tells us nothing about community scoping, which is what
        // this test is for, so the module is enabled for both communities here.
        $this->enableTenantFeatures(['courses', 'podcasts'], $this->testTenantId, self::VICTIM_TENANT_ID);

        $this->victimOwner = User::factory()->forTenant(self::VICTIM_TENANT_ID)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $this->victimIds = $this->seedRecords(self::VICTIM_TENANT_ID, $this->victimOwner);

        $results = [];

        $run = function (string $actorLabel, User $actor, callable $selector) use ($endpoints, &$results): void {
            $ownIds = $this->seedRecords($this->testTenantId, $actor);

            foreach ($endpoints as $e) {
                if (! $selector($e)) {
                    continue;
                }

                // The endpoints run in sorted order, and a CONTROL request is a
                // real request: the control for `DELETE .../versions/{versionId}`
                // genuinely deletes our own version, after which the controls
                // for PUT, notify and pending-count on the same record all
                // answered "Version not found" and three endpoints were
                // reported INCONCLUSIVE through no fault of the platform. The
                // person sweep hit the identical trap with group membership.
                // So: if a record this endpoint needs has been consumed, seed a
                // fresh set. Cheap, because it only happens after a destructive
                // control, and it makes the sweep order-independent.
                if (! $this->recordsStillExist($e['keys'] ?? [], $ownIds)) {
                    $ownIds = $this->seedRecords($this->testTenantId, $actor);
                }

                $row = $e + [
                    'actor' => $actorLabel,
                    'status' => null,
                    'control_status' => null,
                    'verdict' => 'SKIPPED',
                    'note' => $e['skip'] ?? '',
                    'body_excerpt' => '',
                ];

                if ($e['skip'] !== null) {
                    $results[] = $row;

                    continue;
                }

                $last = count($e['keys']) - 1;
                $childKey = $e['keys'][$last];

                // Probe: our own records, and another community's child last.
                $probeIds = [];
                $controlIds = [];
                $missing = null;
                foreach ($e['keys'] as $i => $key) {
                    $own = $ownIds[$key] ?? null;
                    if ($own === null) {
                        $missing = "our own fixture '{$key}' could not be created";
                        break;
                    }
                    $controlIds[] = $own;

                    if ($i === $last) {
                        $victim = $this->victimIds[$key] ?? null;
                        if ($victim === null) {
                            $missing = "the other community's fixture '{$key}' could not be created";
                            break;
                        }
                        $probeIds[] = $victim;
                    } else {
                        $probeIds[] = $own;
                    }
                }

                if ($missing !== null) {
                    $results[] = array_merge($row, ['note' => $missing]);

                    continue;
                }

                $table = $this->fixtureTable($childKey);
                $victimChildId = $this->victimIds[$childKey];
                $before = $table ? json_encode(DB::table($table)->where('id', $victimChildId)->first()) : null;

                [$uri] = $this->fillFromIds($e['uri'], $probeIds);

                try {
                    $response = $this->json($e['method'], '/' . ltrim($uri, '/'), [], $this->withTenantHeader());
                    $status = $response->getStatusCode();
                    $body = mb_substr((string) $response->getContent(), 0, 300);
                } catch (\Throwable $ex) {
                    $results[] = array_merge($row, [
                        'verdict' => 'INCONCLUSIVE',
                        'note' => 'threw ' . class_basename($ex) . ': ' . mb_substr($ex->getMessage(), 0, 160),
                    ]);

                    continue;
                }

                $after = $table ? json_encode(DB::table($table)->where('id', $victimChildId)->first()) : null;
                $rowChanged = $table !== null && $before !== $after;

                [$controlUri] = $this->fillFromIds($e['uri'], $controlIds);
                $controlStatus = null;

                try {
                    $controlStatus = $this->json($e['method'], '/' . ltrim($controlUri, '/'), [], $this->withTenantHeader())
                        ->getStatusCode();
                } catch (\Throwable) {
                    $controlStatus = null;
                }

                $controlWorked = $controlStatus !== null && $controlStatus >= 200 && $controlStatus < 300;
                $succeeded = $status >= 200 && $status < 300;

                [$verdict, $note] = match (true) {
                    // Checked independently of the response status — see the write sweep.
                    $rowChanged => ['MUTATED', ($after === 'null' ? "another community's {$childKey} was DELETED" : "another community's {$childKey} was CHANGED") . " (response was {$status})"],
                    $succeeded && $e['method'] === 'GET' && $this->bodyMentionsVictim($body, $victimChildId) => ['LEAKED', "the response carried another community's {$childKey}"],
                    $succeeded => ['ACCEPTED_NO_CHANGE', "2xx for another community's {$childKey} but its row is unchanged — should refuse"],
                    in_array($status, self::REFUSED, true) && $controlWorked => ['REFUSED', ''],
                    in_array($status, self::REFUSED, true) => ['INCONCLUSIVE', "refused, but the control also failed ({$controlStatus}) — endpoint not exercised"],
                    in_array($status, [400, 422], true) => ['VALIDATION_FIRST', 'validation rejected the empty body before scoping could be observed — not a pass'],
                    $status === 405 => ['SKIPPED', 'method not allowed at runtime'],
                    default => ['INCONCLUSIVE', "status {$status}"],
                };

                $results[] = array_merge($row, [
                    'status' => $status,
                    'control_status' => $controlStatus,
                    'verdict' => $verdict,
                    'note' => $note,
                    'body_excerpt' => $verdict === 'REFUSED' ? '' : $body,
                ]);
            }
        };

        $member = $this->actAs(['role' => 'member']);
        $run('member', $member, static fn ($e) => ! str_starts_with($e['prefix'], 'admin/'));

        $admin = $this->actAs(['role' => 'admin']);
        $run('admin', $admin, static fn ($e) => str_starts_with($e['prefix'], 'admin/'));

        $dir = dirname(__DIR__, 4) . '/.local-docs-archive/security-evidence';
        if (is_dir($dir) || @mkdir($dir, 0o775, true) || is_dir($dir)) {
            @file_put_contents($dir . '/cross-community-child-sweep.json', json_encode([
                'generated_at' => date('c'),
                'method' => "Every v2 route taking two or more path parameters where none names a person. All identifiers except the deepest are filled with OUR OWN records owned by the acting user; the deepest is a child record from tenant 999. The foreign child's row is read before and after each request. Every probe is control-verified with our own child.",
                'results' => $results,
            ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        }

        $lines = ['', '=== FOREIGN-CHILD SWEEP (multi-parameter routes) ===',
            sprintf('multi-parameter v2 route/method combinations without a person : %d', count($endpoints)),
        ];
        foreach (['member' => 'PASS 1 — member, member-facing routes', 'admin' => 'PASS 2 — community admin, /admin/ routes'] as $actorLabel => $label) {
            $t = ['MUTATED' => 0, 'LEAKED' => 0, 'ACCEPTED_NO_CHANGE' => 0, 'REFUSED' => 0, 'VALIDATION_FIRST' => 0, 'INCONCLUSIVE' => 0, 'SKIPPED' => 0];
            foreach ($results as $r) {
                if ($r['actor'] === $actorLabel) {
                    $t[$r['verdict']]++;
                }
            }
            $lines[] = '';
            $lines[] = $label;
            $lines[] = sprintf('  probed                                    : %d', $t['MUTATED'] + $t['LEAKED'] + $t['ACCEPTED_NO_CHANGE'] + $t['REFUSED'] + $t['VALIDATION_FIRST'] + $t['INCONCLUSIVE']);
            $lines[] = sprintf('    refused, control succeeded              : %d', $t['REFUSED']);
            $lines[] = sprintf('    validation rejected first (not a pass)  : %d', $t['VALIDATION_FIRST']);
            $lines[] = sprintf('    accepted, row unchanged (review)        : %d', $t['ACCEPTED_NO_CHANGE']);
            $lines[] = sprintf("    LEAKED another community's child        : %d", $t['LEAKED']);
            $lines[] = sprintf('    MUTATED it                              : %d', $t['MUTATED']);
            $lines[] = sprintf('    inconclusive                            : %d', $t['INCONCLUSIVE']);
            $lines[] = sprintf('  skipped                                   : %d', $t['SKIPPED']);
        }
        $lines[] = '';
        foreach (['MUTATED', 'LEAKED', 'ACCEPTED_NO_CHANGE', 'INCONCLUSIVE'] as $bucket) {
            $rows = array_filter($results, static fn ($r) => $r['verdict'] === $bucket);
            if ($rows === []) {
                continue;
            }
            $lines[] = $bucket . ':';
            foreach ($rows as $r) {
                $lines[] = sprintf(
                    '  [%s] %-6s %s  probe=%s control=%s  %s',
                    $r['actor'],
                    $r['method'],
                    $r['uri'],
                    $r['status'] ?? 'exception',
                    $r['control_status'] ?? '-',
                    preg_replace('/\s+/', ' ', $r['note'] . ' ' . $r['body_excerpt'])
                );
            }
            $lines[] = '';
        }
        fwrite(STDERR, implode(PHP_EOL, $lines) . PHP_EOL);

        $breaches = array_values(array_map(
            static fn ($r) => $r['verdict'] . ' ' . $r['actor'] . ' ' . $r['method'] . ' ' . $r['uri'] . ' -> ' . $r['status'] . ' :: ' . $r['note'],
            array_filter($results, static fn ($r) => in_array($r['verdict'], ['MUTATED', 'LEAKED'], true))
        ));

        $this->assertSame(
            [],
            $breaches,
            "An endpoint served or altered another community's child record. Read cross-community-child-sweep.json."
        );

        $acceptedNoChange = array_values(array_map(
            static fn ($r) => $r['method'] . ' ' . $r['uri'],
            array_filter($results, static fn ($r) => $r['verdict'] === 'ACCEPTED_NO_CHANGE')
        ));
        sort($acceptedNoChange);
        $known = self::KNOWN_CHILD_ACCEPTED_NO_CHANGE;
        sort($known);

        $this->assertSame(
            [],
            array_values(array_diff($acceptedNoChange, $known)),
            "An endpoint newly answers 2xx for another community's child record. Fix it to refuse, or — only "
            . 'if it provably touches nothing — add it to KNOWN_CHILD_ACCEPTED_NO_CHANGE with a note.'
        );

        $this->assertSame(
            [],
            array_values(array_diff($known, $acceptedNoChange)),
            'A KNOWN_CHILD_ACCEPTED_NO_CHANGE entry no longer answers 2xx for a foreign child. It is fixed — delete its line.'
        );
    }

    // ================================================================
    // Probing
    // ================================================================

    private function probe(array $endpoint, string $actor): void
    {
        $base = $endpoint + ['actor' => $actor, 'status' => null, 'control_status' => null, 'body_excerpt' => '', 'victim_marker' => false];

        if ($endpoint['skip'] !== null) {
            $this->results[] = array_merge($base, ['verdict' => 'SKIPPED', 'note' => $endpoint['skip']]);

            return;
        }

        $key = $endpoint['fixture'];
        $victimId = $this->victimIds[$key] ?? null;
        $controlId = $this->controlIds[$key] ?? null;

        if ($victimId === null || $controlId === null) {
            $this->results[] = array_merge($base, ['verdict' => 'SKIPPED', 'note' => "fixture '{$key}' could not be created"]);

            return;
        }

        $foreign = $this->request($endpoint['uri'], $victimId);
        $control = $this->request($endpoint['uri'], $controlId);

        $status = $foreign['status'];
        $controlStatus = $control['status'];
        $body = $foreign['body'];
        $controlOk = in_array($controlStatus, [200, 201], true);

        [$verdict, $note] = match (true) {
            $status === null => ['INCONCLUSIVE', $foreign['error']],
            in_array($status, [200, 201], true) && $this->responseCarriesData($body) => ['LEAK', $controlOk ? '' : "control answered {$controlStatus}"],
            in_array($status, [200, 201], true) && $controlOk => ['EMPTY_200', 'answered 200 but returned no records — scoped, or nothing to find'],
            in_array($status, [200, 201], true) => ['INCONCLUSIVE', "foreign 200 empty but control answered {$controlStatus} — endpoint not exercised"],
            in_array($status, self::REFUSED, true) && $controlOk => ['REFUSED', ''],
            in_array($status, self::REFUSED, true) && $controlStatus === 404 => ['INCONCLUSIVE', 'own record also 404 — endpoint not exercised by this id type'],
            in_array($status, self::REFUSED, true) && $controlStatus === 403 => ['INCONCLUSIVE', 'own record also refused — ownership/role gate, tenant scoping not isolated'],
            in_array($status, self::REFUSED, true) => ['INCONCLUSIVE', "control answered {$controlStatus}"],
            default => ['INCONCLUSIVE', "status {$status} proves nothing about scoping"],
        };

        // array_merge, not `+`: the union operator keeps the LEFT side's keys,
        // so `$base + [...]` silently discarded every status recorded here.
        $this->results[] = array_merge($base, [
            'status' => $status,
            'control_status' => $controlStatus,
            'verdict' => $verdict,
            'note' => $note,
            'body_excerpt' => mb_substr($body, 0, 400),
            'victim_marker' => $this->bodyMentionsVictim($body, $victimId),
        ]);
    }

    /** Does the body visibly reference the victim record or its owner? For human review only. */
    private function bodyMentionsVictim(string $body, int $victimId): bool
    {
        if ($this->victimOwner === null) {
            return false;
        }

        foreach ([$this->victimOwner->email ?? '', $this->victimOwner->name ?? '', $this->victimOwner->first_name ?? ''] as $marker) {
            if (is_string($marker) && $marker !== '' && str_contains($body, $marker)) {
                return true;
            }
        }

        return (bool) preg_match('/"id"\s*:\s*' . $victimId . '\b/', $body);
    }

    // ================================================================
    // Fixtures
    // ================================================================

    // ================================================================
    // Route enumeration and id-type resolution
    // ================================================================

    // ================================================================
    // Reporting
    // ================================================================

    private function printSummary(array $endpoints): void
    {
        $lines = ['', '=== CROSS-COMMUNITY ACCESS SWEEP (control-verified) ==='];
        $lines[] = sprintf('v2 GET endpoints with one path parameter : %d', count($endpoints));

        foreach (['member' => 'PASS 1 — ordinary member, member-facing routes', 'admin' => 'PASS 2 — community admin, /admin/ routes'] as $actor => $label) {
            $tally = ['LEAK' => 0, 'REFUSED' => 0, 'EMPTY_200' => 0, 'INCONCLUSIVE' => 0, 'SKIPPED' => 0];
            $skipReasons = ['not an id' => 0, 'no fixture' => 0, 'tier route' => 0, 'fixture failed' => 0];

            foreach ($this->results as $r) {
                if ($r['actor'] !== $actor) {
                    continue;
                }
                $tally[$r['verdict']]++;
                if ($r['verdict'] === 'SKIPPED') {
                    $reason = match (true) {
                        str_contains($r['note'], 'not a record id') => 'not an id',
                        str_contains($r['note'], 'platform-tier') => 'tier route',
                        str_contains($r['note'], 'could not be created') => 'fixture failed',
                        default => 'no fixture',
                    };
                    $skipReasons[$reason]++;
                }
            }
            $probed = $tally['LEAK'] + $tally['REFUSED'] + $tally['EMPTY_200'] + $tally['INCONCLUSIVE'];

            $lines[] = '';
            $lines[] = $label;
            $lines[] = sprintf('  probed (foreign + control request each)   : %d', $probed);
            $lines[] = sprintf('    refused, control succeeded              : %d', $tally['REFUSED']);
            $lines[] = sprintf('    answered 200 with no records            : %d', $tally['EMPTY_200']);
            $lines[] = sprintf('    RETURNED another community\'s data       : %d', $tally['LEAK']);
            $lines[] = sprintf('    inconclusive                            : %d', $tally['INCONCLUSIVE']);
            $lines[] = sprintf('  skipped                                   : %d  (not an id %d, no fixture %d, tier route %d, fixture failed %d)',
                $tally['SKIPPED'], $skipReasons['not an id'], $skipReasons['no fixture'], $skipReasons['tier route'], $skipReasons['fixture failed']);
        }
        $lines[] = '';

        foreach (['LEAK' => 'RETURNED ANOTHER COMMUNITY\'S DATA (foreign -> control):', 'INCONCLUSIVE' => 'INCONCLUSIVE — these are NOT passes (foreign -> control):'] as $bucket => $heading) {
            $rows = array_filter($this->results, static fn ($r) => $r['verdict'] === $bucket);
            if ($rows === []) {
                continue;
            }
            $lines[] = $heading;
            foreach ($rows as $r) {
                $lines[] = sprintf('  [%s] %s %s  -> %s / %s  %s', $r['actor'], $r['method'], $r['uri'], $r['status'] ?? 'exception', $r['control_status'] ?? '-', $r['note']);
                if ($bucket === 'LEAK') {
                    $lines[] = sprintf('      victim marker in body: %s | %s', $r['victim_marker'] ? 'YES' : 'no', preg_replace('/\s+/', ' ', mb_substr($r['body_excerpt'], 0, 200)));
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
                'method' => 'Each endpoint requested twice: once with a record from tenant 999 (foreign), once with a same-type record from tenant 2 owned by the actor (control). A refusal counts only when the control succeeded.',
                'actor_tenant' => $this->testTenantId,
                'victim_tenant' => self::VICTIM_TENANT_ID,
                'results' => $this->results,
            ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)
        );
    }
}

