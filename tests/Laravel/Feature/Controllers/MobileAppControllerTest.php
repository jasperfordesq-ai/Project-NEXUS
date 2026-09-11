<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Laravel\TestCase;

/**
 * Feature tests for mobile app logging and retired wrapper routes.
 *
 * Routes are handled by AppController:
 *   POST /app/log             — public (rate-limited)
 */
class MobileAppControllerTest extends TestCase
{
    use DatabaseTransactions;

    public function test_retired_wrapper_version_routes_are_not_registered(): void
    {
        $routes = collect(app('router')->getRoutes())->map(fn ($route) => $route->uri());
        $this->assertNotContains('api/app/version', $routes);
        $this->assertNotContains('api/app/check-version', $routes);
    }

    // ================================================================
    // LOG — Public endpoint
    // ================================================================

    public function test_log_returns_200(): void
    {
        $response = $this->apiPost('/app/log', [
            'event'    => 'app_opened',
            'version'  => '1.1',
            'platform' => 'android',
        ]);

        $response->assertStatus(200);
    }

    public function test_log_returns_success_response(): void
    {
        $response = $this->apiPost('/app/log', [
            'event'    => 'crash_report',
            'version'  => '1.0',
            'platform' => 'android',
            'data'     => ['screen' => 'feed'],
        ]);

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }
}
