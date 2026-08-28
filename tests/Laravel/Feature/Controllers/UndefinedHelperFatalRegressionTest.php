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

    /**
     * The INVERTED sweep: instead of listing helpers known to be gone, resolve EVERY
     * `$this->name(` call in every controller against the methods that actually exist
     * on the class (parents and traits included), and fail on any that do not.
     *
     * 🔴 Why the allowlist above was not enough. On 2026-08-28 a full-system audit found
     * `AdminBillingController::requestUpgrade()` calling `$this->getAuthUser()` and
     * `$this->getInput()` — neither has ever existed on BaseApiController — so
     * POST /v2/admin/billing/upgrade-request 500'd on every request. The provider-based
     * test above could never catch that: it only knows names someone has already been
     * burned by. This sweep needs no foreknowledge.
     *
     * Scope is controllers only, deliberately: `Illuminate\Routing\Controller` defines
     * `__call`, which throws BadMethodCallException at runtime but silences PHPStan
     * (documented above). Plain services have no `__call`, so PHPStan level 1 already
     * reports undefined methods there.
     *
     * Tokenizer, not regex: `token_get_all` sees only real code, so `$this->foo()`
     * quoted in a docblock or string cannot false-positive.
     */
    public function test_every_controller_helper_call_resolves_to_a_real_method(): void
    {
        $controllersDir = base_path('app/Http/Controllers');
        self::assertDirectoryExists($controllersDir, 'app/Http/Controllers must be present for this check to mean anything');

        // Escape hatch for a genuinely dynamic call (e.g. a closure rebound to another
        // object). Every entry must carry a justification. Currently none are needed.
        $allowlist = [
            // 'App\Http\Controllers\Api\Example::dynamicName' => 'reason',
        ];

        $offenders = [];
        $scannedClasses = 0;

        $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($controllersDir));
        foreach ($iterator as $file) {
            if (! $file->isFile() || $file->getExtension() !== 'php') {
                continue;
            }

            $contents = file_get_contents($file->getPathname());
            if ($contents === false) {
                continue;
            }

            // PSR-4: app/Http/Controllers/Api/Foo.php => App\Http\Controllers\Api\Foo
            $relative = substr($file->getPathname(), strlen(base_path('app')) + 1);
            $fqcn = 'App\\' . str_replace(['/', '\\', '.php'], ['\\', '\\', ''], $relative);

            if (! class_exists($fqcn)) {
                continue; // traits, interfaces, or files without a matching class
            }

            $reflection = new \ReflectionClass($fqcn);
            if ($reflection->isInterface() || $reflection->isTrait()) {
                continue;
            }

            // Only classes with the __call blind spot; PHPStan covers the rest.
            if (! $reflection->isSubclassOf(\Illuminate\Routing\Controller::class)) {
                continue;
            }

            $scannedClasses++;

            $methodNames = [];
            foreach ($reflection->getMethods() as $method) {
                $methodNames[strtolower($method->getName())] = true;
            }

            $tokens = token_get_all($contents);
            $count = count($tokens);
            for ($i = 0; $i < $count; $i++) {
                $token = $tokens[$i];
                if (! is_array($token) || $token[0] !== T_VARIABLE || $token[1] !== '$this') {
                    continue;
                }

                // $this -> name (   — with arbitrary whitespace/comments between
                $j = $this->nextMeaningfulToken($tokens, $i + 1);
                if ($j === null || ! is_array($tokens[$j]) || ! in_array($tokens[$j][0], [T_OBJECT_OPERATOR, T_NULLSAFE_OBJECT_OPERATOR], true)) {
                    continue;
                }

                $k = $this->nextMeaningfulToken($tokens, $j + 1);
                if ($k === null || ! is_array($tokens[$k]) || $tokens[$k][0] !== T_STRING) {
                    continue;
                }

                $l = $this->nextMeaningfulToken($tokens, $k + 1);
                if ($l === null || $tokens[$l] !== '(') {
                    continue; // property access, not a call
                }

                $name = $tokens[$k][1];
                if (isset($methodNames[strtolower($name)])) {
                    continue;
                }
                if (isset($allowlist[$fqcn . '::' . $name])) {
                    continue;
                }

                $offenders[] = sprintf('%s:%d — $this->%s() does not exist on %s', $relative, $tokens[$k][2], $name, $fqcn);
            }
        }

        // If this ever reads zero, the scan is pointed at the wrong place and a green
        // result would be meaningless.
        self::assertGreaterThan(50, $scannedClasses, 'Expected to scan a realistic number of controller classes');

        self::assertSame(
            [],
            $offenders,
            sprintf(
                "%d controller call site(s) invoke a method that does not exist anywhere on the "
                . "class, its parents, or its traits. Illuminate\\Routing\\Controller::__call turns "
                . "each one into a fatal error on every request, and PHPStan cannot see it.\n%s",
                count($offenders),
                implode("\n", $offenders)
            )
        );
    }

    /**
     * @param array<int, array{0: int, 1: string, 2: int}|string> $tokens
     */
    private function nextMeaningfulToken(array $tokens, int $from): ?int
    {
        $count = count($tokens);
        for ($i = $from; $i < $count; $i++) {
            if (is_array($tokens[$i]) && in_array($tokens[$i][0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true)) {
                continue;
            }
            return $i;
        }
        return null;
    }
}
