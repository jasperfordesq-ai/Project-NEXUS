<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Legal;

use App\Http\Middleware\EnsureLegalAcceptance;
use Illuminate\Support\Facades\Route;
use Tests\Laravel\TestCase;

/**
 * Proves that every route the legal gate is ATTACHED to is actually GATED.
 *
 * 🔴 WHY THIS TEST EXISTS, and why it is a route walk rather than a request test.
 *
 * `EnsureLegalAcceptance` carries an exemption list so the gate cannot lock the
 * door with the key inside — you must always be able to read the documents, sign
 * in, and render the acceptance page. Those exemptions are matched as PREFIXES.
 *
 * On 2026-08-11 `api/v2/users/me` was on that prefix list, because the page shell
 * calls `/api/v2/users/me` on every render. As a prefix it also exempted four
 * routes the gate was deliberately attached to:
 *
 *   POST /v2/users/me/sub-accounts/{childId}/listings
 *   POST /v2/users/me/sub-accounts/{childId}/transfer
 *   POST /v2/users/me/sub-accounts/{childId}/listings/{listingId}/image
 *   POST /v2/users/me/support-actions
 *
 * Four of fourteen attachment points were inert. A member with a pending
 * acceptance could still create listings for, and transfer credits on behalf of,
 * a supported child — while the gate reported itself as enforcing.
 *
 * The existing suite could not see it: `EnsureLegalAcceptanceTest` proves the gate
 * blocks by POSTing ONE route (`/v2/comments`). A passing test on one route says
 * nothing about the other thirteen. So this test asserts the PROPERTY — "attached
 * implies gated" — across every route in the table, and will fail the moment a new
 * route is attached beneath any exempt prefix, present or future.
 *
 * It reads the route table and the middleware's own exemption logic. It makes no
 * HTTP requests and touches no database, so it cannot be defeated by fixture drift.
 */
final class EnsureLegalAcceptanceRouteCoverageTest extends TestCase
{
    /**
     * The alias attached in `routes/api.php`, and the class it resolves to in
     * `bootstrap/app.php`. Both spellings appear in the resolved middleware list
     * depending on how a route was registered, so both are recognised.
     */
    private const GATE_ALIAS = 'legal-acceptance';

    /** @return list<string> */
    private function gatedRoutePaths(): array
    {
        $paths = [];

        foreach (Route::getRoutes() as $route) {
            $middleware = $route->gatherMiddleware();

            $isGated = false;
            foreach ($middleware as $entry) {
                if (!is_string($entry)) {
                    continue;
                }
                if ($entry === self::GATE_ALIAS || $entry === EnsureLegalAcceptance::class) {
                    $isGated = true;
                    break;
                }
            }

            if ($isGated) {
                $paths[] = ltrim($route->uri(), '/');
            }
        }

        return array_values(array_unique($paths));
    }

    /**
     * Calls the middleware's real exemption logic, rather than reimplementing the
     * prefix rules here — a copy would drift and could agree with a bug.
     */
    private function isExemptAccordingToMiddleware(string $path): bool
    {
        $reflection = new \ReflectionMethod(EnsureLegalAcceptance::class, 'isExemptPath');
        $reflection->setAccessible(true);

        // A concrete path, with route parameters replaced by plausible values, so
        // prefix matching sees what production sees.
        $concrete = preg_replace('/\{[^}]+\}/', '7', $path) ?? $path;

        $request = \Illuminate\Http\Request::create('/' . $concrete, 'POST');

        return (bool) $reflection->invoke(null, $request);
    }

    public function test_the_gate_is_attached_to_routes_at_all(): void
    {
        $gated = $this->gatedRoutePaths();

        // Guards against this whole test passing vacuously. If the alias is
        // renamed, or the attachments are removed, every assertion below would
        // trivially hold over an empty list — which is exactly the "green because
        // it measured nothing" failure this file exists to prevent elsewhere.
        $this->assertNotEmpty(
            $gated,
            'No routes carry the legal-acceptance middleware. Either the alias in '
            . 'routes/api.php changed, or the gate was detached. This test cannot '
            . 'prove anything about an empty list.'
        );

        $this->assertGreaterThanOrEqual(
            10,
            count($gated),
            'The legal gate is attached to far fewer routes than expected ('
            . count($gated) . '). Attachments were removed without updating this test.'
        );
    }

    public function test_no_gated_route_is_silently_exempt(): void
    {
        $gated = $this->gatedRoutePaths();
        $this->assertNotEmpty($gated, 'No gated routes found — see the vacuity guard test.');

        $silentlyExempt = [];
        foreach ($gated as $path) {
            if ($this->isExemptAccordingToMiddleware($path)) {
                $silentlyExempt[] = $path;
            }
        }

        $this->assertSame(
            [],
            $silentlyExempt,
            "These routes have the legal gate ATTACHED but are EXEMPT, so the gate "
            . "never runs on them:\n  - " . implode("\n  - ", $silentlyExempt)
            . "\n\nAn exempt prefix is swallowing them. Either narrow the prefix to an "
            . "exact match in EXEMPT_EXACT_PATHS (as api/v2/users/me had to be), or "
            . "detach the gate deliberately and say why."
        );
    }

    /**
     * The four routes the prefix bug actually exempted, pinned by name.
     *
     * The test above would catch a regression generically, but this one names the
     * specific member-visible capabilities that were unprotected, so a future
     * reader sees what was at stake rather than an abstract property.
     */
    public function test_the_four_sub_account_write_routes_are_gated(): void
    {
        $regressed = [];

        foreach ([
            'api/v2/users/me/sub-accounts/{childId}/listings',
            'api/v2/users/me/sub-accounts/{childId}/transfer',
            'api/v2/users/me/sub-accounts/{childId}/listings/{listingId}/image',
            'api/v2/users/me/support-actions',
        ] as $path) {
            if ($this->isExemptAccordingToMiddleware($path)) {
                $regressed[] = $path;
            }
        }

        $this->assertSame(
            [],
            $regressed,
            'Acting on behalf of a supported child is exempt from the legal gate '
            . 'again: ' . implode(', ', $regressed)
        );
    }

    /**
     * The exemption that had to keep working. If this fails, the acceptance page
     * cannot render its own header and the member can never reach the accept
     * button — the "locked the door with the key inside" outcome.
     */
    public function test_the_shell_chrome_endpoints_remain_exempt(): void
    {
        foreach ([
            'api/v2/users/me',
            'api/v2/messages/unread-count',
            'api/v2/notifications/counts',
            'api/v2/tenant/bootstrap',
            'api/v2/legal/acceptance/status',
            'api/v2/legal/acceptance/accept-all',
        ] as $path) {
            $this->assertTrue(
                $this->isExemptAccordingToMiddleware($path),
                "$path must stay exempt, or the acceptance page cannot render and the "
                . 'member is permanently stuck.'
            );
        }
    }
}
