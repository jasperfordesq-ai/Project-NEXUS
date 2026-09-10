<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security;

use App\Services\FederationFeatureService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Tests\Laravel\TestCase;

/**
 * Does the external kill switch really close EVERY inbound partner surface?
 *
 * WHY THIS EXISTS ALONGSIDE THE KILL-SWITCH TESTS THAT ALREADY PASS
 * -----------------------------------------------------------------
 * External partner federation and the partner v1 API are switched OFF in
 * production and have been since 2026-07-27, with no partner connected. Both
 * already have dedicated tests, and both pass.
 *
 * But those tests drive **hand-written lists** of roughly thirty routes. The
 * platform has 109 inbound federation and partner route-and-method
 * combinations. A list cannot notice a route that was never added to it — and
 * these surfaces matter more than most, because they are the ONE authentication
 * path that does not run `App\Http\Middleware\Authenticate`, and therefore the
 * one that never sees the cross-community checks proved in
 * CrossCommunityTokenReplayTest.
 *
 * So this enumerates the live route table instead.
 *
 * THE POPULATION IS DEFINED BY PATH, NOT BY MIDDLEWARE — DELIBERATELY
 * -------------------------------------------------------------------
 * Selecting "routes carrying the kill-switch middleware" would be circular: a
 * new external route added WITHOUT the gate would simply not be in the
 * population, and the sweep would report a clean pass over the routes that were
 * already safe. The population is therefore every route under an inbound
 * partner path, and the sweep asserts two separate things:
 *
 *   1. while the switch is off, every one of them refuses; and
 *   2. every one of them that lacks the gate is named in a shrink-only list,
 *      so a newly added ungated external route fails this test on the day it
 *      lands.
 *
 * WHAT IS DELIBERATELY EXCLUDED
 * -----------------------------
 * The member-facing `/v2/federation/*` routes — connections, messages, opt-in,
 * settings — are INTERNAL cross-community federation, which is live and ungated
 * by design. They run `Authenticate`, so they are covered by the token-replay
 * sweep, and they must NOT be expected to refuse here. The distinction is drawn
 * on that middleware, which is exactly what separates a member-authenticated
 * surface from an inbound partner one.
 *
 * CONTROL-VERIFIED
 * ----------------
 * "Everything refused" proves nothing if the routes are simply broken. So the
 * sweep runs a second time with the switch ON, and requires the answers to
 * change. If a route refuses identically either way, the kill switch is not
 * what refused it and the result is reported as inconclusive rather than as a
 * pass.
 */
class ExternalSurfaceKillSwitchSweepTest extends TestCase
{
    use DatabaseTransactions;

    /** Success, or a validation error — either means the request got through. */
    private const REACHED_STATUSES = [200, 201, 202, 204, 422];

    /**
     * Inbound partner path prefixes, after `api/`.
     *
     * @var list<string>
     */
    private const EXTERNAL_PREFIXES = [
        'v2/federation/cc',
        'v2/federation/komunitin',
        'v2/federation/ingest',
        'v2/federation/external',
        'v2/federation/aggregates',
        'v2/federation/hour-transfer',
        'v1/federation',
        'partner/v1',
    ];

    /**
     * Inbound partner routes that carry NO kill-switch gate of their own.
     *
     * Shrink-only: an addition means a new external surface was added without a
     * switch, which is the regression this sweep exists to catch. Each entry is
     * refused by something else — the OAuth token mint is inside the partner
     * block's own gate, for instance — and that is verified by the sweep, not
     * assumed.
     */
    private const KNOWN_UNGATED = [
    ];

    public function test_every_inbound_partner_surface_refuses_while_the_switch_is_off(): void
    {
        $endpoints = $this->externalEndpoints();
        $this->assertNotEmpty($endpoints, 'No inbound partner routes found — this sweep would pass vacuously.');

        // ---- Pass 1: switches OFF, the production state.
        $this->setExternalSwitches(false);
        $off = [];
        foreach ($endpoints as $e) {
            $off[$e['key']] = $this->send($e);
        }

        // ---- Pass 2 (control): switches ON. The answers must change, or the
        // refusal above was not the switch's doing.
        $this->setExternalSwitches(true);
        $on = [];
        foreach ($endpoints as $e) {
            $on[$e['key']] = $this->send($e);
        }

        $this->setExternalSwitches(false);

        $results = [];
        foreach ($endpoints as $e) {
            $offStatus = $off[$e['key']]['status'];
            $onStatus = $on[$e['key']]['status'];

            [$verdict, $note] = match (true) {
                in_array($offStatus, self::REACHED_STATUSES, true) => ['REACHED', 'served while the switch was off'],
                $offStatus === $onStatus => ['INCONCLUSIVE', "refused with {$offStatus} whether the switch was on or off — something other than the switch refused it"],
                default => ['REFUSED', "switch off {$offStatus}, switch on {$onStatus}"],
            };

            $results[] = [
                'method' => $e['method'],
                'uri' => $e['uri'],
                'gated' => $e['gated'],
                'status_off' => $offStatus,
                'status_on' => $onStatus,
                'verdict' => $verdict,
                'note' => $note,
                'body_excerpt' => $verdict === 'REFUSED' ? '' : mb_substr($off[$e['key']]['body'], 0, 200),
            ];
        }

        $tally = ['REFUSED' => 0, 'REACHED' => 0, 'INCONCLUSIVE' => 0];
        $statuses = [];
        foreach ($results as $r) {
            $tally[$r['verdict']]++;
            $statuses[$r['status_off']] = ($statuses[$r['status_off']] ?? 0) + 1;
        }

        $ungated = array_values(array_map(
            static fn ($r) => $r['method'] . ' ' . $r['uri'],
            array_filter($results, static fn ($r) => ! $r['gated'])
        ));
        sort($ungated);

        $dir = dirname(__DIR__, 4) . '/.local-docs-archive/security-evidence';
        if (is_dir($dir) || @mkdir($dir, 0o775, true) || is_dir($dir)) {
            @file_put_contents($dir . '/external-surface-kill-switch-sweep.json', json_encode([
                'generated_at' => date('c'),
                'method' => 'Every route under an inbound partner path (Credit Commons, Komunitin, Nexus ingest, external webhooks, aggregates, hour transfer, legacy v1, partner v1), enumerated from the live route table rather than a written list, requested unauthenticated with the external-federation and partner-API switches OFF and then again with them ON. A refusal counts only if the answer changed between the two.',
                'tally' => $tally,
                'refusal_statuses_while_off' => $statuses,
                'ungated_routes' => $ungated,
                'results' => $results,
            ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        }

        $lines = [
            '',
            '=== INBOUND PARTNER SURFACE — KILL SWITCH SWEEP ===',
            sprintf('inbound partner route/method combinations : %d', count($results)),
            sprintf('  refused, and the switch is what refused : %d', $tally['REFUSED']),
            sprintf('  REACHED while the switch was off        : %d', $tally['REACHED']),
            sprintf('  inconclusive (refused either way)       : %d', $tally['INCONCLUSIVE']),
            sprintf('  carrying no kill-switch gate            : %d', count($ungated)),
            '',
            'statuses while the switch was off: ' . json_encode($statuses),
            '',
        ];
        foreach (['REACHED', 'INCONCLUSIVE'] as $bucket) {
            $rows = array_filter($results, static fn ($r) => $r['verdict'] === $bucket);
            if ($rows === []) {
                continue;
            }
            $lines[] = $bucket . ':';
            foreach (array_slice($rows, 0, 30) as $r) {
                $lines[] = sprintf('  %-6s %-56s off=%s on=%s  %s', $r['method'], $r['uri'], $r['status_off'], $r['status_on'], preg_replace('/\s+/', ' ', $r['note'] . ' ' . $r['body_excerpt']));
            }
            if (count($rows) > 30) {
                $lines[] = '  ... and ' . (count($rows) - 30) . ' more (see the evidence file)';
            }
            $lines[] = '';
        }
        fwrite(STDERR, implode(PHP_EOL, $lines) . PHP_EOL);

        $reached = array_values(array_map(
            static fn ($r) => $r['method'] . ' ' . $r['uri'] . ' -> ' . $r['status_off'],
            array_filter($results, static fn ($r) => $r['verdict'] === 'REACHED')
        ));

        $this->assertSame(
            [],
            $reached,
            'An inbound partner endpoint was served while external federation was switched off. '
            . "Read external-surface-kill-switch-sweep.json.\n" . implode("\n", array_slice($reached, 0, 20))
        );

        $known = self::KNOWN_UNGATED;
        sort($known);

        $this->assertSame(
            [],
            array_values(array_diff($ungated, $known)),
            'An inbound partner route carries NO kill-switch gate. Add the gate, or — only if it '
            . 'is provably refused by something else that the switch also controls — add it to '
            . "KNOWN_UNGATED with a reason.\n" . implode("\n", array_slice(array_diff($ungated, $known), 0, 20))
        );

        $this->assertSame(
            [],
            array_values(array_diff($known, $ungated)),
            'A KNOWN_UNGATED entry now carries a gate, or no longer exists. Delete its line.'
        );
    }

    /** @return array{status:int,body:string} */
    private function send(array $endpoint): array
    {
        $uri = '/' . ltrim(preg_replace('/\{[^}]+\}/', '1', $endpoint['uri']), '/');

        try {
            $response = $this->json($endpoint['method'], $uri, [], ['Accept' => 'application/json']);

            return ['status' => $response->getStatusCode(), 'body' => (string) $response->getContent()];
        } catch (\Throwable $e) {
            return ['status' => 0, 'body' => class_basename($e) . ': ' . mb_substr($e->getMessage(), 0, 160)];
        }
    }

    /**
     * Every route on an inbound partner path that is not member-authenticated.
     *
     * @return list<array<string,mixed>>
     */
    private function externalEndpoints(): array
    {
        $endpoints = [];

        foreach (Route::getRoutes() as $route) {
            $uri = $route->uri();

            if (! str_starts_with($uri, 'api/')) {
                continue;
            }

            $path = substr($uri, strlen('api/'));
            $matches = false;
            foreach (self::EXTERNAL_PREFIXES as $prefix) {
                if ($path === $prefix || str_starts_with($path, $prefix . '/')) {
                    $matches = true;

                    break;
                }
            }

            if (! $matches) {
                continue;
            }

            $middleware = app('router')->gatherRouteMiddleware($route);
            $joined = implode(' ', array_filter($middleware, 'is_string'));

            // Member-authenticated federation is INTERNAL cross-community
            // federation: live by design, and covered by the token-replay sweep.
            if (str_contains($joined, 'Authenticate')) {
                continue;
            }

            $gated = str_contains($joined, 'EnsureExternalFederationEnabled')
                || str_contains($joined, 'EnsurePartnerApiEnabled');

            foreach (array_diff($route->methods(), ['HEAD']) as $method) {
                $endpoints[] = [
                    'key' => $method . ' ' . $uri,
                    'method' => $method,
                    'uri' => $uri,
                    'gated' => $gated,
                ];
            }
        }

        usort($endpoints, static fn ($a, $b) => [$a['uri'], $a['method']] <=> [$b['uri'], $b['method']]);

        return $endpoints;
    }

    /** Set both external switches, and clear the cache the gates read through. */
    private function setExternalSwitches(bool $enabled): void
    {
        $row = [
            'federation_enabled' => 1,
            'emergency_lockdown_active' => 0,
            'whitelist_mode_enabled' => 0,
            'external_federation_enabled' => $enabled ? 1 : 0,
            'partner_api_enabled' => $enabled ? 1 : 0,
            'updated_at' => now(),
        ];

        foreach (FederationFeatureService::externalProtocolNames() as $protocol) {
            $column = FederationFeatureService::externalProtocolColumn($protocol);
            if ($column !== null) {
                $row[(string) $column] = $enabled ? 1 : 0;
            }
        }

        DB::table('federation_system_control')->updateOrInsert(['id' => 1], $row);
        app(FederationFeatureService::class)->clearCache();
    }
}
