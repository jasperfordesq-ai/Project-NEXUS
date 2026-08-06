<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Request performance recording (feeds /admin/performance).
 *
 * 🔴 What this deliberately does NOT do: it does not write a row per request.
 * Recording every request would make the monitor the heaviest thing on the
 * platform. Instead:
 *
 *   - every request increments one hourly counter row (so the totals and the
 *     volume chart are exact, not sampled);
 *   - a detail row is written only when a request is actually interesting —
 *     slow, memory-hungry, query-heavy, or showing a repeated-query pattern.
 *
 * All of it happens in terminate(), after the response has been sent, so a
 * recorded request is no slower for the user than an unrecorded one.
 *
 * The switch below is PLATFORM-WIDE, not per community. Reading a per-tenant
 * setting on every single request would itself cost a query on the hot path,
 * which is the opposite of the point.
 */
return [
    // Master switch. Recording is skipped entirely when false — no listener is
    // registered and the middleware returns immediately.
    'enabled' => env('PERFORMANCE_MONITORING_ENABLED', true),

    // Tests get no recording unless they ask for it, so the suite is not
    // measuring itself. Feature tests that exercise recording set
    // config(['performance.enabled_in_testing' => true]) directly rather than
    // relying on an env var, because phpunit.xml <env> values are not reliably
    // authoritative inside the container (see AGENTS.md on APP_KEY).
    'enabled_in_testing' => false,

    'thresholds' => [
        // A request at or above this is recorded and flagged 'slow_request'.
        'slow_request_ms' => (int) env('PERFORMANCE_SLOW_REQUEST_MS', 1000),

        // A single query at or above this is recorded with its caller.
        'slow_query_ms' => (int) env('PERFORMANCE_SLOW_QUERY_MS', 200),

        // Peak memory at or above this flags 'high_memory' and puts the request
        // in the Memory tab.
        'memory_spike_mb' => (int) env('PERFORMANCE_MEMORY_SPIKE_MB', 96),

        // Total queries in one request at or above this flags 'many_queries'.
        'many_queries' => (int) env('PERFORMANCE_MANY_QUERIES', 50),

        // The same query template repeated this many times in one request is
        // treated as an N+1 pattern. Identical templates with different
        // bindings is exactly what loading a relationship in a loop looks like.
        'n_plus_one_repeats' => (int) env('PERFORMANCE_N_PLUS_ONE_REPEATS', 10),
    ],

    'limits' => [
        // Most slow queries stored per request. A pathological request can
        // produce hundreds; storing five of them tells you the same thing.
        'queries_per_request' => 5,

        // Rows returned per section of the admin summary.
        'summary_rows' => 20,

        // Longest window the summary will report on, in hours.
        'max_window_hours' => 720,
    ],

    // Samples older than this are deleted nightly by performance:prune. This is
    // diagnostic data about the platform's own speed, not a business record.
    'retention_days' => (int) env('PERFORMANCE_RETENTION_DAYS', 14),

    // Hourly counters are tiny (one row per tenant per hour), so they are kept
    // longer — they are what the volume chart draws from.
    'hourly_retention_days' => (int) env('PERFORMANCE_HOURLY_RETENTION_DAYS', 90),

    // Paths that must never be recorded: health checks and the performance
    // report itself (which would otherwise measure the monitor).
    'ignore_paths' => [
        'api/v2/health',
        'api/health',
        'health.php',
        'api/v2/admin/performance/summary',
    ],
];
