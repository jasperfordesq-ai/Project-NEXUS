<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Cors;

use Tests\Laravel\TestCase;

/**
 * Every custom request header the frontend sends must be allowed by CORS.
 *
 * The app and the API are on different origins in production, so a header
 * missing from the allow-list fails the browser's preflight and the feature
 * dies — and the browser reports it as "unable to connect", not as a CORS
 * problem, so it looks like an outage rather than a config gap.
 *
 * That is exactly how X-Event-Checkin-Contract and X-Event-Safety-Contract took
 * the event check-in and safety pages down in production: both were added to the
 * frontend, neither to either allow-list, and nothing failed until a real
 * cross-origin browser tried it.
 *
 * There are TWO lists (config/cors.php and EnsureCorsHeaders), and a header
 * missing from either one is enough to break it. This test pins both.
 */
final class FrontendRequestHeadersAllowedTest extends TestCase
{
    /**
     * Custom headers the frontend actually sends. Keep in step with the
     * `X-` headers set in react-frontend/src/lib and the admin API client.
     *
     * @return list<string>
     */
    private function frontendHeaders(): array
    {
        return [
            'X-CSRF-Token',
            'X-Tenant-ID',
            'X-Tenant-Slug',
            'X-Events-Contract',
            'X-Event-Checkin-Contract',
            'X-Event-Safety-Contract',
            'Idempotency-Key',
            'X-Timezone',
            'X-Locale',
            'X-Request-Id',
        ];
    }

    public function test_the_cors_config_allows_every_header_the_frontend_sends(): void
    {
        $allowed = array_map('strtolower', (array) config('cors.allowed_headers'));

        foreach ($this->frontendHeaders() as $header) {
            self::assertContains(
                strtolower($header),
                $allowed,
                "config/cors.php must allow {$header}; without it the browser preflight fails and the feature appears offline.",
            );
        }
    }

    public function test_the_cors_middleware_allows_every_header_the_frontend_sends(): void
    {
        // The middleware writes its own literal list, independent of the config
        // file — the two drifting apart is the actual failure mode here.
        $source = (string) file_get_contents(base_path('app/Http/Middleware/EnsureCorsHeaders.php'));

        // Only inspect the authenticated/allowed-origin branch, which is the one
        // real browser traffic from the app hits.
        self::assertStringContainsString('X-Events-Contract', $source);

        foreach ($this->frontendHeaders() as $header) {
            self::assertStringContainsStringIgnoringCase(
                $header,
                $source,
                "EnsureCorsHeaders must allow {$header}; config/cors.php alone is not enough.",
            );
        }
    }
}
