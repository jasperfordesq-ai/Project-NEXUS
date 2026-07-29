<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Core;

use App\Core\CorsHelper;
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
 * with the superglobal absent — pre-fix it raised ErrorException instead. The
 * 500 itself is covered end-to-end by LegacyV1PartnerApiAuditTest, whose mint
 * assertions returned 500 before this change and 400 after; a unit test cannot
 * reproduce that, because PHPUnit's own error handler records the underlying
 * warning instead of letting Laravel convert it to an exception.
 */
final class CorsHelperPreflightMethodTest extends TestCase
{
    /** @var array<string, mixed> */
    private array $savedServer = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->savedServer = $_SERVER;
        unset($_SERVER['REQUEST_METHOD']);
    }

    protected function tearDown(): void
    {
        $_SERVER = $this->savedServer;
        parent::tearDown();
    }

    public function test_an_options_request_is_still_recognised_from_the_request_object(): void
    {
        app()->instance('request', Request::create('/api/v1/federation/oauth/token', 'OPTIONS'));

        // In the testing environment handlePreflight throws a 204 HttpException
        // instead of calling exit(), so preflight detection is observable.
        $this->expectException(\Symfony\Component\HttpKernel\Exception\HttpException::class);

        CorsHelper::handlePreflight([], ['POST', 'OPTIONS'], ['Content-Type', 'Authorization']);
    }
}
