<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Support;

use App\Support\SpaRouteSegments;
use PHPUnit\Framework\TestCase;

/**
 * SpaRouteSegments is a copy of the React routes' first path segments (the
 * API image ships no react-frontend/). A segment missing from the copy would
 * make crawlers get 404 for a real page, so the copy must match exactly.
 */
class SpaRouteSegmentsTest extends TestCase
{
    public function test_the_list_matches_the_react_routes(): void
    {
        $src = dirname(__DIR__, 4) . '/react-frontend/src';
        $files = array_merge(
            glob($src . '/routes/*.tsx') ?: [],
            [$src . '/admin/routes.tsx'],
            glob($src . '/broker/*routes*.tsx') ?: [],
        );
        $files = array_values(array_filter($files, static fn (string $f) => !str_ends_with($f, '.test.tsx') && is_file($f)));
        $this->assertGreaterThanOrEqual(4, count($files), 'the React route files were not found');

        $segments = [];
        foreach ($files as $file) {
            preg_match_all('#path=["\']([^"\']*)["\']#', (string) file_get_contents($file), $m);
            foreach ($m[1] as $path) {
                $path = trim($path, '/');
                if ($path === '' || $path === '*') {
                    continue;
                }
                $segments[explode('/', $path)[0]] = true;
            }
        }
        $fromReact = array_keys($segments);
        sort($fromReact);

        $listed = SpaRouteSegments::KNOWN;
        sort($listed);

        $this->assertSame([], array_values(array_diff($fromReact, $listed)), 'React routes these first segments but SpaRouteSegments::KNOWN does not list them — crawlers would get 404 for real pages');
        $this->assertSame([], array_values(array_diff($listed, $fromReact)), 'SpaRouteSegments::KNOWN lists segments React no longer routes');
    }

    public function test_no_segment_is_a_parameter(): void
    {
        foreach (SpaRouteSegments::KNOWN as $segment) {
            $this->assertMatchesRegularExpression('#^[a-z0-9][a-z0-9-]*$#', $segment);
        }
    }
}
