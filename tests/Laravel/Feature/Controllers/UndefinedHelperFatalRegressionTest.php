<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use Tests\Laravel\TestCase;

/**
 * Regression guard for six live endpoints that threw a fatal error on EVERY request.
 *
 * 🔴 What happened. `getJsonInput()` was removed from `BaseApiController` during the
 * Laravel migration, and six call sites were missed. Every one of these threw
 * "Method ... does not exist" and returned a 500, for months:
 *
 *     POST /v2/search/saved                      save a search
 *     POST /v2/search/saved/{id}/run             run a saved search
 *     POST /v2/jobs/employer-reviews             post an employer review
 *     POST /v2/jobs/offer-templates              create an offer template
 *     POST /v2/jobs/offer-templates/{id}/render  render an offer template
 *     POST /v2/jobs/{id}/ai-chat                 AI chat about a job
 *
 * 🔴 Why nothing caught it, which is the part that matters. `Illuminate\Routing\Controller`
 * defines `__call`, so PHPStan assumes an unknown method MIGHT be handled at runtime
 * and stays silent — even at level 1 with larastan, even with a blocking CI gate.
 * Proven both ways on 2026-08-19 against a controller written specially to test it:
 * with `reportMagicMethods: true` PHPStan reports "Call to an undefined method"; with
 * the repo's setting it reports "No errors".
 *
 * 🔴 Someone had already hit this and fixed only their own call site. There is a
 * comment in `SuperAdmin/PlatformCapabilityController.php` reading "getAllInput(), not
 * getJsonInput() — the latter does not exist on BaseApiController, and calling it 500s
 * the whole request." The lesson is to sweep for the rest, not just unblock yourself.
 *
 * This test is deliberately STATIC — a grep over source, no HTTP, no database, no
 * feature flags, no auth. The six endpoints have their own varied preconditions
 * (module gates, employer records, rate limits), and a test that has to satisfy all of
 * those to reach the fatal line is a test that quietly stops reaching it. Asserting
 * "nothing calls the helper that does not exist" cannot rot that way, and it catches a
 * SEVENTH call site the day someone adds one.
 */
class UndefinedHelperFatalRegressionTest extends TestCase
{
    /**
     * Helpers that do not exist on BaseApiController and must never be called.
     *
     * Add to this list whenever a helper is removed, so the removal cannot leave
     * fatal call sites behind the way this one did.
     *
     * @return array<string, array{0: string, 1: string}>
     */
    public static function removedHelperProvider(): array
    {
        return [
            'getJsonInput' => ['getJsonInput', 'getAllInput() (request()->all(), JSON body included)'],
        ];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('removedHelperProvider')]
    public function test_no_php_source_calls_a_helper_that_does_not_exist(string $helper, string $replacement): void
    {
        // base_path(), not dirname(__DIR__, n) — a miscounted depth silently points the
        // scan at a directory with no PHP in it, and "found no offenders" then looks
        // identical to "passed". The assertion below is what makes that impossible.
        $appDir = base_path('app');
        self::assertDirectoryExists($appDir, 'app/ must be present for this check to mean anything');

        // Confirm the premise rather than trusting it: if the helper were REINTRODUCED,
        // this test should stop failing builds, not keep flagging valid calls.
        self::assertFalse(
            method_exists(\App\Http\Controllers\Api\BaseApiController::class, $helper),
            sprintf(
                '%s now exists on BaseApiController. If that is deliberate, remove it from '
                . 'removedHelperProvider(); until then this test is guarding a real fatal.',
                $helper
            )
        );

        $offenders = [];
        $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($appDir));
        foreach ($iterator as $file) {
            if (! $file->isFile() || $file->getExtension() !== 'php') {
                continue;
            }

            $contents = file_get_contents($file->getPathname());
            if ($contents === false) {
                continue;
            }

            foreach (explode("\n", $contents) as $number => $line) {
                // Only a CALL counts. The word also appears in the explanatory comment
                // that records this bug, and flagging the documentation would be absurd.
                if (preg_match('/\$this->' . preg_quote($helper, '/') . '\s*\(/', $line) === 1) {
                    $offenders[] = sprintf('%s:%d', $file->getPathname(), $number + 1);
                }
            }
        }

        self::assertSame(
            [],
            $offenders,
            sprintf(
                "%d call site(s) invoke \$this->%s(), which does not exist and throws a fatal "
                . "error on every request. Use %s.\n%s",
                count($offenders),
                $helper,
                $replacement,
                implode("\n", $offenders)
            )
        );
    }
}
