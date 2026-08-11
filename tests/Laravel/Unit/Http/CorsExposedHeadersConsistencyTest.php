<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Http;

use PHPUnit\Framework\TestCase;

/**
 * The two CORS allowlists must agree.
 *
 * 🔴 WHY THIS EXISTS. This platform has TWO places that decide CORS response
 * headers: `config/cors.php` (Laravel's own middleware) and
 * `app/Http/Middleware/EnsureCorsHeaders.php` (a hand-rolled middleware that also
 * sets them). A header listed in only one of them works on some request paths and
 * not others — which presents as "the feature is broken in production only", and has
 * done here before.
 *
 * The specific case that prompted this: `X-Legal-Acceptance-Pending`, which
 * `EnsureLegalAcceptance` sets in `report` mode so the blast radius of enforcement
 * can be measured per client before anything blocks. A browser cannot read a
 * response header that is not exposed, so React — the client with the most members —
 * could not see it, and the measuring half of report mode was invisible to the very
 * client it most needed to measure. The same trap was handled correctly for
 * `X-Message-View-Purpose` days earlier and missed here.
 *
 * Deliberately a plain PHPUnit TestCase reading the FILES: no framework boot, no
 * database, so it cannot pass vacuously because of test-environment config.
 */
final class CorsExposedHeadersConsistencyTest extends TestCase
{
    private function repoRoot(): string
    {
        return dirname(__DIR__, 4);
    }

    /** @return list<string> */
    private function configExposedHeaders(): array
    {
        $config = require $this->repoRoot() . '/config/cors.php';
        $this->assertIsArray($config);
        $this->assertArrayHasKey('exposed_headers', $config);
        $this->assertIsArray($config['exposed_headers']);

        return array_map('strtolower', $config['exposed_headers']);
    }

    /**
     * Every `Access-Control-Expose-Headers` value the middleware sets, as one merged
     * lower-cased list. The middleware sets it more than once (different branches for
     * read-only vs credentialed requests), so all of them are collected.
     *
     * @return list<string>
     */
    private function middlewareExposedHeaders(): array
    {
        $source = file_get_contents($this->repoRoot() . '/app/Http/Middleware/EnsureCorsHeaders.php');
        $this->assertIsString($source);

        preg_match_all(
            "/Access-Control-Expose-Headers'\s*,\s*'([^']+)'/",
            $source,
            $matches
        );

        // A guard against this test passing because the regex stopped matching — the
        // exact "green because it measured nothing" failure this codebase keeps
        // finding.
        $this->assertNotEmpty(
            $matches[1] ?? [],
            'Found no Access-Control-Expose-Headers assignment in EnsureCorsHeaders.php. '
            . 'Either the middleware changed shape or this test is now blind.'
        );

        $headers = [];
        foreach ($matches[1] as $list) {
            foreach (explode(',', $list) as $header) {
                $clean = strtolower(trim($header));
                if ($clean !== '') {
                    $headers[] = $clean;
                }
            }
        }

        return array_values(array_unique($headers));
    }

    public function test_the_legal_acceptance_pending_header_is_exposed_in_both_places(): void
    {
        $this->assertContains(
            'x-legal-acceptance-pending',
            $this->configExposedHeaders(),
            'config/cors.php must expose X-Legal-Acceptance-Pending, or report mode is '
            . 'unreadable from a browser.'
        );

        $this->assertContains(
            'x-legal-acceptance-pending',
            $this->middlewareExposedHeaders(),
            'EnsureCorsHeaders must expose X-Legal-Acceptance-Pending too — a header '
            . 'exposed in only one allowlist works on some paths and not others.'
        );
    }

    public function test_every_config_exposed_header_is_also_exposed_by_the_middleware(): void
    {
        $config = $this->configExposedHeaders();
        $middleware = $this->middlewareExposedHeaders();

        $missing = array_values(array_diff($config, $middleware));

        $this->assertSame(
            [],
            $missing,
            "These headers are exposed in config/cors.php but NOT by EnsureCorsHeaders:\n  - "
            . implode("\n  - ", $missing)
            . "\n\nA header exposed in only one of the two allowlists is readable on some "
            . 'request paths and silently absent on others.'
        );
    }
}
