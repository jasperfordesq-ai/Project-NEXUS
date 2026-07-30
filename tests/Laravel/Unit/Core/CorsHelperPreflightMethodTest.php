<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Core;

use Illuminate\Http\Request;
use Tests\Laravel\TestCase;

/**
 * Regression guard: handlePreflight() must not depend on $_SERVER.
 *
 * It read `$_SERVER['REQUEST_METHOD']` directly. PHP-FPM always populates that,
 * so production was fine — but Laravel's test HTTP kernel dispatches a Request
 * without writing the superglobal, so the read raised "Undefined array key
 * REQUEST_METHOD" and any controller calling handlePreflight() returned 500 under
 * test only. The concrete cost: the v1 OAuth token mint, the sharpest
 * authenticated surface on the platform, had no feature test at all, because
 * every attempt to write one died inside CORS handling before reaching the
 * endpoint. It was found while auditing legacy_v1 on 2026-07-29.
 *
 * This asserts that preflight is still detected from the Request object alone,
 * with the superglobal absent — pre-fix it raised ErrorException instead. That
 * was verified by reverting each fix and re-running: both assertions below fail
 * with `Undefined array key "REQUEST_METHOD"`, raised through Laravel's
 * HandleExceptions, and pass once restored.
 *
 * The 500 *response* is covered end-to-end by LegacyV1PartnerApiAuditTest, whose
 * mint assertions returned 500 before the App\Core fix and 400 after. A unit test
 * cannot produce that response — it calls the helper directly rather than through
 * the HTTP kernel — but it does observe the underlying error, which is what makes
 * it a usable guard for a copy with no HTTP call site of its own.
 *
 * 🔴 IT COVERS BOTH COPIES OF THE CLASS. App\Core\CorsHelper and
 * App\Helpers\CorsHelper have been duplicates since the 2026-03-20 src/ inlining
 * refactor, and the original fix reached only App\Core — leaving the same line in
 * a class that is on a *hotter* path than the one that was fixed (the outermost
 * middleware calls it on every API response). Fixing one copy of a shared defect
 * is what created this whole class of bug twice over, so the last test below
 * fails if a third copy appears without being added here.
 */
final class CorsHelperPreflightMethodTest extends TestCase
{
    /**
     * Every CorsHelper copy whose preflight detection is asserted below.
     *
     * @return array<string, array{class-string}>
     */
    public static function corsHelperProvider(): array
    {
        return [
            'App\Core (fixed 2026-07-29, called by FederationController)' => [\App\Core\CorsHelper::class],
            'App\Helpers (fixed 2026-07-30, latent — no handlePreflight caller)' => [\App\Helpers\CorsHelper::class],
        ];
    }

    /** @var array<string, mixed> */
    private array $savedServer = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->savedServer = $_SERVER;
        unset($_SERVER['REQUEST_METHOD']);
        // Keep the assertion about method detection only: with no Origin,
        // setHeaders() returns early instead of reaching the tenant-domain
        // database lookup.
        unset($_SERVER['HTTP_ORIGIN']);
    }

    protected function tearDown(): void
    {
        $_SERVER = $this->savedServer;
        parent::tearDown();
    }

    /**
     * @dataProvider corsHelperProvider
     *
     * @param class-string $helper
     */
    public function test_an_options_request_is_still_recognised_from_the_request_object(string $helper): void
    {
        app()->instance('request', Request::create('/api/v1/federation/oauth/token', 'OPTIONS'));

        // In the testing environment handlePreflight throws a 204 HttpException
        // instead of calling exit(), so preflight detection is observable.
        $this->expectException(\Symfony\Component\HttpKernel\Exception\HttpException::class);

        $helper::handlePreflight([], ['POST', 'OPTIONS'], ['Content-Type', 'Authorization']);
    }

    /**
     * A non-OPTIONS request must fall through rather than answering 204 — the
     * superglobal fallback used to default to nothing at all, so this pins that
     * reading the method from the Request cannot over-trigger preflight either.
     *
     * @dataProvider corsHelperProvider
     *
     * @param class-string $helper
     */
    public function test_a_non_options_request_is_not_treated_as_preflight(string $helper): void
    {
        app()->instance('request', Request::create('/api/v1/federation/oauth/token', 'POST'));

        $helper::handlePreflight([], ['POST', 'OPTIONS'], ['Content-Type', 'Authorization']);

        $this->assertTrue(true, 'handlePreflight() returned without throwing for a POST.');
    }

    /**
     * The duplication itself is the bug. Both known copies drifted — App\Core got
     * the subdomain hardening in 9f2b2a00f and App\Helpers did not; App\Core got
     * the REQUEST_METHOD fix and App\Helpers did not. A third copy would inherit
     * the same trap silently, so discovering the copies from disk (rather than
     * trusting the provider list) is what makes this guard hold over time.
     */
    public function test_no_uncovered_copy_of_cors_helper_exists_in_the_app(): void
    {
        $appPath = base_path('app');
        $found = [];

        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($appPath, \FilesystemIterator::SKIP_DOTS)
        );

        foreach ($iterator as $file) {
            if ($file->getFilename() !== 'CorsHelper.php') {
                continue;
            }

            // app/Core/CorsHelper.php -> App\Core\CorsHelper
            $relative = trim(str_replace($appPath, '', $file->getPathname()), DIRECTORY_SEPARATOR);
            $found[] = 'App\\' . str_replace(
                [DIRECTORY_SEPARATOR, '.php'],
                ['\\', ''],
                $relative
            );
        }

        $covered = array_map(
            static fn (array $case): string => $case[0],
            array_values(self::corsHelperProvider())
        );

        sort($found);
        sort($covered);

        $this->assertSame(
            $covered,
            $found,
            'A CorsHelper copy exists that this preflight regression test does not cover. '
            . 'Add it to corsHelperProvider() and apply requestMethod() to it — or, better, '
            . 'delete the copy. Note that the copies are NOT interchangeable: '
            . 'App\Helpers::getAllowedOrigins() merges tenant custom domains from the '
            . 'database and AppServiceProvider depends on that, while App\Core does not.'
        );
    }
}
