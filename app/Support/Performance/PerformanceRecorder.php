<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Performance;

use App\Core\TenantContext;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

/**
 * Collects what one HTTP request cost, and writes it after the response is sent.
 *
 * Registered as a singleton in AppServiceProvider so the query listener and the
 * middleware share one instance. The listener starts counting before routing,
 * which is deliberate: tenant resolution and authentication are real work and
 * belong in the query count.
 *
 * 🔴 Two rules this class must keep:
 *
 *   1. It never stores query bindings. `QueryExecuted::$sql` is the placeholder
 *      form and that is what goes to the database, so no member data can leak
 *      into the diagnostics tables.
 *   2. It never lets its own failure reach the user. A monitor that can 500 a
 *      request is worse than no monitor. Failures are swallowed — but logged
 *      once per process at warning level, so a broken monitor is visible rather
 *      than silent. That is the narrow case AGENTS.md permits: nothing here
 *      returns a value a caller could mistake for success.
 */
final class PerformanceRecorder
{
    /**
     * Hard cap on slow queries held in memory for one request. A pathological
     * request can issue hundreds; the top few by duration say the same thing.
     */
    private const MAX_COLLECTED_SLOW_QUERIES = 50;

    private const BYTES_PER_MB = 1048576;

    private bool $listening = false;

    /** True while flushing, so the recorder's own INSERTs are not recorded. */
    private bool $flushing = false;

    private static bool $loggedFailure = false;

    private int $queryCount = 0;

    /** @var array<string,int> normalised query template => times executed */
    private array $templateCounts = [];

    /** @var list<array{duration_ms:float,sql:string,caller:array<string,mixed>|null}> */
    private array $slowQueries = [];

    /** Memory already held when this request started handling, in bytes. */
    private ?int $baselineBytes = null;

    /**
     * Mark the start of request handling.
     *
     * 🔴 This exists because of how PHP reports memory. `memory_get_peak_usage()`
     * is a PROCESS counter, and a PHP-FPM worker serves thousands of requests
     * without giving memory back to the operating system. Reporting it raw meant
     * an old worker's history was attributed to whatever request happened to run
     * on it next: one genuinely heavy request would make every later request on
     * that worker look heavy too, for the life of the worker.
     *
     * So the peak is reset here and a baseline recorded, and what gets stored is
     * the memory this request ADDED. That figure is independent of how long the
     * worker has been alive, which is the only version of it worth acting on.
     *
     * Memory used before this point — framework boot, tenant resolution — sits
     * in the baseline and is deliberately excluded: it is near-constant overhead
     * and tells you nothing about the request.
     */
    public function beginRequest(): void
    {
        if (! $this->enabled()) {
            return;
        }

        if (function_exists('memory_reset_peak_usage')) {
            memory_reset_peak_usage();
        }

        $this->baselineBytes = memory_get_usage();
    }

    public function enabled(): bool
    {
        if (! (bool) config('performance.enabled', false)) {
            return false;
        }

        // The test suite does not measure itself unless a test asks it to.
        if (app()->environment('testing') && ! (bool) config('performance.enabled_in_testing', false)) {
            return false;
        }

        return true;
    }

    /**
     * Attach the query listener. Safe to call more than once.
     *
     * Console and queue processes are excluded: they are long-lived, so the
     * per-request arrays below would grow without a terminate() to drain them.
     *
     * 🔴 The testing environment is exempt from that exclusion. PHPUnit runs in
     * console, so without this exemption the listener could never be attached in
     * a test and the one link between "a query ran" and "the recorder heard
     * about it" would be permanently unproven. Unproven links are exactly what
     * left this page broken for months. `enabled()` still has to say yes, so
     * ordinary tests are unaffected.
     */
    public function listen(): void
    {
        if ($this->listening || ! $this->enabled()) {
            return;
        }

        if (app()->runningInConsole() && ! app()->environment('testing')) {
            return;
        }

        $this->listening = true;

        DB::listen(function (QueryExecuted $event): void {
            if ($this->flushing) {
                return;
            }

            $this->recordQuery((float) $event->time, (string) $event->sql);
        });
    }

    public function recordQuery(float $durationMs, string $sql): void
    {
        $this->queryCount++;

        $template = $this->normaliseTemplate($sql);
        $this->templateCounts[$template] = ($this->templateCounts[$template] ?? 0) + 1;

        $slowQueryMs = (float) config('performance.thresholds.slow_query_ms', 200);

        if ($durationMs < $slowQueryMs || count($this->slowQueries) >= self::MAX_COLLECTED_SLOW_QUERIES) {
            return;
        }

        $this->slowQueries[] = [
            'duration_ms' => $durationMs,
            'sql' => $sql,
            // Only resolved for queries already known to be slow, so the
            // backtrace cost is paid on rare requests and never on hot ones.
            'caller' => $this->resolveCaller(),
        ];
    }

    /**
     * Write what this request cost. Called from terminate(), i.e. after the
     * response has gone to the client.
     */
    public function flush(Request $request, Response $response): void
    {
        if (! $this->enabled()) {
            $this->reset();

            return;
        }

        $path = ltrim($request->path(), '/');

        /** @var list<string> $ignored */
        $ignored = (array) config('performance.ignore_paths', []);
        if (in_array($path, $ignored, true)) {
            $this->reset();

            return;
        }

        $this->flushing = true;

        try {
            $tenantId = (int) (TenantContext::getId() ?? 0);
            $bucketHour = now()->format('Y-m-d H:00:00');

            // Every request, so totals and the volume chart are exact rather
            // than extrapolated from samples.
            DB::statement(
                'INSERT INTO performance_request_hourly
                    (tenant_id, bucket_hour, request_count, created_at, updated_at)
                 VALUES (?, ?, 1, NOW(), NOW())
                 ON DUPLICATE KEY UPDATE request_count = request_count + 1, updated_at = NOW()',
                [$tenantId, $bucketHour]
            );

            $durationMs = $this->elapsedMs($request);
            // Memory this request added — see beginRequest(). With no baseline
            // (beginRequest never ran) these fall back to absolute figures,
            // which are worker-age dependent and should not be relied on.
            // memory_get_usage() without $real_usage: the allocator reports OS
            // memory in 2 MB chunks, which rounds every ordinary request to
            // 0.00 MB and makes the column useless. The finer figure still
            // detects real spikes, which are tens of megabytes.
            $baseline = $this->baselineBytes ?? 0;
            $peakMemoryMb = max(0, memory_get_peak_usage() - $baseline) / self::BYTES_PER_MB;
            $memoryMb = max(0, memory_get_usage() - $baseline) / self::BYTES_PER_MB;
            $maxRepeats = $this->templateCounts === [] ? 0 : max($this->templateCounts);
            $nPlusOneGroups = $this->countNPlusOneGroups();

            if (! $this->isInteresting($durationMs, $peakMemoryMb, $nPlusOneGroups)) {
                return;
            }

            $sampleId = DB::table('performance_request_samples')->insertGetId([
                'tenant_id' => $tenantId,
                'user_id' => $this->resolveUserId(),
                'method' => substr($request->getMethod(), 0, 8),
                'endpoint' => $this->resolveEndpoint($request),
                'status_code' => $response->getStatusCode(),
                'duration_ms' => round($durationMs, 2),
                'query_count' => $this->queryCount,
                'memory_mb' => round($memoryMb, 2),
                'peak_memory_mb' => round($peakMemoryMb, 2),
                'n_plus_one_count' => $nPlusOneGroups,
                'max_repeated_query_count' => $maxRepeats,
                'created_at' => now(),
            ]);

            $this->storeSlowQueries($tenantId, (int) $sampleId);
        } catch (\Throwable $exception) {
            // Never propagate: the response has already been sent, and a broken
            // monitor must not become a broken request. Logged once per process
            // so a missing table or a permissions problem is discoverable.
            if (! self::$loggedFailure) {
                self::$loggedFailure = true;
                Log::warning('Performance recording failed; further failures in this process are not logged', [
                    'error' => $exception->getMessage(),
                ]);
            }
        } finally {
            $this->flushing = false;
            $this->reset();
        }
    }

    private function storeSlowQueries(int $tenantId, int $sampleId): void
    {
        if ($this->slowQueries === []) {
            return;
        }

        $queries = $this->slowQueries;
        usort($queries, static fn (array $a, array $b): int => $b['duration_ms'] <=> $a['duration_ms']);

        $limit = max(1, (int) config('performance.limits.queries_per_request', 5));
        $now = now();
        $rows = [];

        foreach (array_slice($queries, 0, $limit) as $query) {
            $caller = $query['caller'];

            $rows[] = [
                'tenant_id' => $tenantId,
                'request_sample_id' => $sampleId,
                'duration_ms' => round($query['duration_ms'], 2),
                'sql_text' => substr($query['sql'], 0, 1000),
                'caller_class' => isset($caller['class']) ? substr((string) $caller['class'], 0, 191) : null,
                'caller_function' => isset($caller['function']) ? substr((string) $caller['function'], 0, 191) : null,
                'caller_file' => isset($caller['file']) ? substr((string) $caller['file'], 0, 191) : null,
                'caller_line' => isset($caller['line']) ? (int) $caller['line'] : null,
                'created_at' => $now,
            ];
        }

        DB::table('performance_query_samples')->insert($rows);
    }

    private function isInteresting(float $durationMs, float $peakMemoryMb, int $nPlusOneGroups): bool
    {
        $thresholds = (array) config('performance.thresholds', []);

        if ($durationMs >= (float) ($thresholds['slow_request_ms'] ?? 1000)) {
            return true;
        }
        if ($peakMemoryMb >= (float) ($thresholds['memory_spike_mb'] ?? 96)) {
            return true;
        }
        if ($this->queryCount >= (int) ($thresholds['many_queries'] ?? 50)) {
            return true;
        }

        return $nPlusOneGroups > 0;
    }

    private function countNPlusOneGroups(): int
    {
        $repeats = (int) config('performance.thresholds.n_plus_one_repeats', 10);
        $groups = 0;

        foreach ($this->templateCounts as $count) {
            if ($count >= $repeats) {
                $groups++;
            }
        }

        return $groups;
    }

    /**
     * 🔴 REQUEST_TIME_FLOAT first, LARAVEL_START only as a fallback. The
     * constant is set once per PROCESS, which is the same thing as once per
     * request under PHP-FPM but not under any long-lived runtime — and not in
     * the test suite, where it made every recorded request look like it had
     * taken as long as the whole test run. REQUEST_TIME_FLOAT is per request
     * everywhere, and it starts marginally earlier, at the point the request
     * reached PHP rather than the point index.php began.
     */
    private function elapsedMs(Request $request): float
    {
        $requestTime = $request->server('REQUEST_TIME_FLOAT');

        if (is_numeric($requestTime)) {
            $start = (float) $requestTime;
        } elseif (defined('LARAVEL_START')) {
            $start = (float) LARAVEL_START;
        } else {
            $start = microtime(true);
        }

        return max(0.0, (microtime(true) - $start) * 1000);
    }

    /**
     * The route pattern where one matched, so samples group per endpoint rather
     * than per record id. Falls back to the path with id-shaped segments masked.
     */
    private function resolveEndpoint(Request $request): string
    {
        $route = $request->route();
        $uri = null;

        if ($route !== null && method_exists($route, 'uri')) {
            $uri = $route->uri();
        }

        if (! is_string($uri) || $uri === '') {
            $segments = explode('/', ltrim($request->path(), '/'));
            $uri = implode('/', array_map(static function (string $segment): string {
                if ($segment === '') {
                    return $segment;
                }
                if (ctype_digit($segment)) {
                    return '{id}';
                }
                if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $segment) === 1) {
                    return '{uuid}';
                }

                return $segment;
            }, $segments));
        }

        return substr('/' . ltrim($uri, '/'), 0, 191);
    }

    private function resolveUserId(): ?int
    {
        try {
            $id = auth()->id();

            return is_numeric($id) ? (int) $id : null;
        } catch (\Throwable) {
            // No guard resolved (platform/webhook routes) — not an error.
            return null;
        }
    }

    /**
     * Collapse variable-length placeholder lists so `IN (?, ?, ?)` and
     * `IN (?, ?)` count as the same template. Without this, a relationship
     * loaded in a loop with differing id counts never looks repeated.
     */
    private function normaliseTemplate(string $sql): string
    {
        $collapsed = preg_replace('/\?(\s*,\s*\?)+/', '?', $sql) ?? $sql;
        $collapsed = preg_replace('/\s+/', ' ', $collapsed) ?? $collapsed;

        return trim($collapsed);
    }

    /**
     * The first application frame behind a query — where a human should look.
     *
     * @return array<string,mixed>|null
     */
    private function resolveCaller(): ?array
    {
        $frames = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 40);

        foreach ($frames as $frame) {
            $file = $frame['file'] ?? null;

            if (! is_string($file) || $file === '') {
                continue;
            }
            $normalised = str_replace('\\', '/', $file);
            if (str_contains($normalised, '/vendor/')) {
                continue;
            }
            if (str_contains($normalised, '/app/Support/Performance/')) {
                continue;
            }

            return [
                'class' => $frame['class'] ?? null,
                'function' => $frame['function'] ?? null,
                'file' => $normalised,
                'line' => $frame['line'] ?? null,
            ];
        }

        return null;
    }

    private function reset(): void
    {
        $this->queryCount = 0;
        $this->templateCounts = [];
        $this->slowQueries = [];
        $this->baselineBytes = null;
    }
}
