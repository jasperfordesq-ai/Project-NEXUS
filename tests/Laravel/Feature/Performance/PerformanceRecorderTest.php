<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Performance;

use App\Core\TenantContext;
use App\Support\Performance\PerformanceRecorder;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;
use Tests\Laravel\TestCase;

/**
 * What the recorder writes, and — just as important — what it declines to write.
 *
 * Recording is off in the test suite by default (config/performance.php) so the
 * suite does not measure itself. Each test that needs it switches it on
 * explicitly through config(), not through an env var: phpunit.xml <env> values
 * are not reliably authoritative inside the container.
 */
class PerformanceRecorderTest extends TestCase
{
    use DatabaseTransactions;

    private function enableRecording(): void
    {
        config([
            'performance.enabled' => true,
            'performance.enabled_in_testing' => true,
        ]);
    }

    /**
     * A recorder set up the way the middleware sets one up. beginRequest() is
     * not optional: without it the memory figure is the whole test process's,
     * and a trivial request looks like a heavy one.
     */
    private function startedRecorder(): PerformanceRecorder
    {
        $recorder = new PerformanceRecorder();
        $recorder->beginRequest();

        return $recorder;
    }

    private function flush(PerformanceRecorder $recorder, string $path = 'api/v2/listings', int $status = 200): void
    {
        $request = Request::create('/' . ltrim($path, '/'), 'GET');
        $recorder->flush($request, new Response('', $status));
    }

    private function countSamples(): int
    {
        return (int) DB::table('performance_request_samples')
            ->where('tenant_id', $this->testTenantId)
            ->count();
    }

    public function test_every_request_increments_the_hourly_counter(): void
    {
        $this->enableRecording();
        TenantContext::setById($this->testTenantId);

        $recorder = $this->startedRecorder();
        $bucket = now()->format('Y-m-d H:00:00');

        $before = (int) (DB::table('performance_request_hourly')
            ->where('tenant_id', $this->testTenantId)
            ->where('bucket_hour', $bucket)
            ->value('request_count') ?? 0);

        $this->flush($recorder);
        $this->flush($recorder);

        $after = (int) DB::table('performance_request_hourly')
            ->where('tenant_id', $this->testTenantId)
            ->where('bucket_hour', $bucket)
            ->value('request_count');

        // Two requests, one row: the counter is what makes the totals exact
        // without writing a row per request.
        $this->assertSame($before + 2, $after);
    }

    public function test_an_ordinary_request_gets_no_detail_row(): void
    {
        $this->enableRecording();
        TenantContext::setById($this->testTenantId);

        $before = $this->countSamples();

        $recorder = $this->startedRecorder();
        $recorder->recordQuery(3.0, 'select * from `users` where `id` = ?');
        $this->flush($recorder);

        $this->assertSame($before, $this->countSamples(), 'A fast, cheap request must not be stored.');
    }

    public function test_a_repeated_query_is_recorded_as_an_n_plus_one_pattern(): void
    {
        $this->enableRecording();
        TenantContext::setById($this->testTenantId);
        config(['performance.thresholds.n_plus_one_repeats' => 5]);

        $recorder = $this->startedRecorder();
        for ($i = 0; $i < 6; $i++) {
            $recorder->recordQuery(2.0, 'select * from `listings` where `user_id` = ?');
        }
        $this->flush($recorder);

        $sample = DB::table('performance_request_samples')
            ->where('tenant_id', $this->testTenantId)
            ->orderByDesc('id')
            ->first();

        $this->assertNotNull($sample, 'A repeated-query request is interesting and must be stored.');
        $this->assertSame(1, (int) $sample->n_plus_one_count);
        $this->assertSame(6, (int) $sample->max_repeated_query_count);
    }

    public function test_placeholder_lists_of_different_lengths_count_as_the_same_query(): void
    {
        $this->enableRecording();
        TenantContext::setById($this->testTenantId);
        config(['performance.thresholds.n_plus_one_repeats' => 3]);

        $recorder = $this->startedRecorder();
        // A relationship loaded in a loop rarely uses the same number of ids.
        $recorder->recordQuery(1.0, 'select * from `users` where `id` in (?, ?)');
        $recorder->recordQuery(1.0, 'select * from `users` where `id` in (?, ?, ?)');
        $recorder->recordQuery(1.0, 'select * from `users` where `id` in (?)');
        $this->flush($recorder);

        $sample = DB::table('performance_request_samples')
            ->where('tenant_id', $this->testTenantId)
            ->orderByDesc('id')
            ->first();

        $this->assertNotNull($sample);
        $this->assertSame(3, (int) $sample->max_repeated_query_count);
    }

    public function test_a_slow_query_is_stored_without_its_bindings(): void
    {
        $this->enableRecording();
        TenantContext::setById($this->testTenantId);
        config([
            'performance.thresholds.slow_query_ms' => 100,
            'performance.thresholds.many_queries' => 1,
        ]);

        $recorder = $this->startedRecorder();
        $recorder->recordQuery(450.0, "select * from `users` where `email` = ?");
        $this->flush($recorder);

        $query = DB::table('performance_query_samples')
            ->where('tenant_id', $this->testTenantId)
            ->orderByDesc('id')
            ->first();

        $this->assertNotNull($query);
        $this->assertStringContainsString('?', $query->sql_text);
        // 🔴 The whole reason only the template is stored: a real address must
        // never end up in a diagnostics table.
        $this->assertStringNotContainsString('@', $query->sql_text);
        $this->assertNotNull($query->caller_file, 'A slow query is only useful with the frame that issued it.');
    }

    /**
     * 🔴 Regression: the memory figure must describe THIS request, not the
     * process. PHP's peak-memory counter is process-wide and a PHP-FPM worker
     * never hands memory back, so the first version of this recorder attributed
     * an old worker's high-water mark to whatever request ran next — every
     * request on a long-lived worker looked like a memory spike. The test suite
     * showed it first: this very test file, run after 70-odd other tests, made a
     * request that allocated nothing look like it had used 131 MB.
     */
    public function test_the_memory_figure_is_what_the_request_added_not_the_process_total(): void
    {
        $this->enableRecording();
        TenantContext::setById($this->testTenantId);
        config([
            'performance.thresholds.memory_spike_mb' => 8,
            'performance.thresholds.slow_request_ms' => 100000,
            'performance.thresholds.many_queries' => 100000,
            'performance.thresholds.n_plus_one_repeats' => 100000,
        ]);

        // A request that allocates nothing is not a memory spike, however much
        // memory the process is already holding.
        $before = $this->countSamples();
        $this->flush($this->startedRecorder());
        $this->assertSame($before, $this->countSamples(), 'An allocation-free request must not look like a spike.');

        // A request that really does allocate is.
        $recorder = $this->startedRecorder();
        $ballast = str_repeat('x', 24 * 1024 * 1024);
        $this->assertNotSame('', $ballast); // keep it alive until flush
        $this->flush($recorder);
        unset($ballast);

        $sample = DB::table('performance_request_samples')
            ->where('tenant_id', $this->testTenantId)
            ->orderByDesc('id')
            ->first();

        $this->assertNotNull($sample, 'A request that allocated 24 MB should have been recorded.');
        $this->assertGreaterThanOrEqual(8, (float) $sample->peak_memory_mb);
    }

    public function test_ignored_paths_are_not_recorded_at_all(): void
    {
        $this->enableRecording();
        TenantContext::setById($this->testTenantId);
        config(['performance.ignore_paths' => ['api/v2/admin/performance/summary']]);

        $bucket = now()->format('Y-m-d H:00:00');
        $before = (int) (DB::table('performance_request_hourly')
            ->where('tenant_id', $this->testTenantId)
            ->where('bucket_hour', $bucket)
            ->value('request_count') ?? 0);

        $recorder = $this->startedRecorder();
        $this->flush($recorder, 'api/v2/admin/performance/summary');

        $after = (int) (DB::table('performance_request_hourly')
            ->where('tenant_id', $this->testTenantId)
            ->where('bucket_hour', $bucket)
            ->value('request_count') ?? 0);

        // The report must not appear in its own figures.
        $this->assertSame($before, $after);
    }

    public function test_nothing_is_written_when_recording_is_switched_off(): void
    {
        config(['performance.enabled' => false, 'performance.enabled_in_testing' => false]);
        TenantContext::setById($this->testTenantId);

        $bucket = now()->format('Y-m-d H:00:00');
        $before = (int) (DB::table('performance_request_hourly')
            ->where('tenant_id', $this->testTenantId)
            ->where('bucket_hour', $bucket)
            ->value('request_count') ?? 0);

        $recorder = $this->startedRecorder();
        $recorder->recordQuery(5000.0, 'select 1');
        $this->flush($recorder);

        $after = (int) (DB::table('performance_request_hourly')
            ->where('tenant_id', $this->testTenantId)
            ->where('bucket_hour', $bucket)
            ->value('request_count') ?? 0);

        $this->assertSame($before, $after);
    }

    public function test_a_failure_while_recording_never_reaches_the_request(): void
    {
        $this->enableRecording();
        TenantContext::setById($this->testTenantId);

        // Point the recorder at a table that does not exist. Before the response
        // this would be a 500; after it, it must be a logged warning and nothing
        // more. The assertion is simply that flush() returns.
        DB::statement('DROP TEMPORARY TABLE IF EXISTS performance_request_hourly');

        $recorder = $this->startedRecorder();
        DB::statement('CREATE TEMPORARY TABLE performance_request_hourly (nonsense INT)');

        $this->flush($recorder);

        $this->assertTrue(true, 'flush() must not throw even when its own writes fail.');

        DB::statement('DROP TEMPORARY TABLE IF EXISTS performance_request_hourly');
    }

    /**
     * ...and neither must a broken LOGGER.
     *
     * The test above proves a failed write is swallowed. It was not enough: the
     * `Log::warning` inside that same catch block was itself unprotected, so when
     * the logger was broken the catch block became the thing it exists to
     * prevent.
     *
     * That happened for real on 2026-08-06. CI exported an EMPTY log channel (an
     * unquoted `null` in the workflow YAML, where the two sibling steps quote
     * it), so every `Log::` call raised
     * `InvalidArgumentException: Log [] is not defined`. The throw escaped this
     * recorder into whatever request was in flight — an exchange-dispute
     * resolution — whose own error handler then failed the same way, returning
     * 500 and recording nothing about the original cause. One shard went red and
     * the stack trace pointed at a controller that had nothing to do with it.
     *
     * A monitor with no safe failure mode is worse than no monitor.
     */
    public function test_a_broken_log_channel_cannot_escape_the_recorder(): void
    {
        $this->enableRecording();
        TenantContext::setById($this->testTenantId);

        /*
         * 🔴 Reset the once-per-process flag, or this test proves nothing.
         *
         * `PerformanceRecorder::$loggedFailure` is static and the whole suite
         * shares one process, so the earlier failure test above has already set
         * it. Without this reset the logging branch is never entered, no throw
         * can happen, and the test passes whether or not the fix is present —
         * confirmed by removing the fix and watching it still pass.
         */
        $flag = new \ReflectionProperty(PerformanceRecorder::class, 'loggedFailure');
        $flag->setAccessible(true);
        $flag->setValue(null, false);

        // Force the recording to fail, exactly as the test above does...
        DB::statement('DROP TEMPORARY TABLE IF EXISTS performance_request_hourly');
        $recorder = $this->startedRecorder();
        DB::statement('CREATE TEMPORARY TABLE performance_request_hourly (nonsense INT)');

        // ...and force the attempt to LOG that failure to fail too.
        \Illuminate\Support\Facades\Log::shouldReceive('warning')
            ->andThrow(new \InvalidArgumentException('Log [] is not defined'));

        $this->flush($recorder);

        $this->assertTrue(
            true,
            'flush() must return even when the write fails AND the logger is broken.'
        );

        DB::statement('DROP TEMPORARY TABLE IF EXISTS performance_request_hourly');
    }

    /**
     * End-to-end through the real query event, not through recordQuery() by hand.
     *
     * Everything else here calls recordQuery() directly, which proves the maths
     * but not the wiring. This test runs an actual slow query and asserts the
     * listener heard it — the one link that would otherwise be assumed.
     */
    public function test_the_query_listener_hears_a_real_slow_query(): void
    {
        $this->enableRecording();
        TenantContext::setById($this->testTenantId);
        config([
            'performance.thresholds.slow_query_ms' => 100,
            'performance.thresholds.many_queries' => 1,
        ]);

        $before = (int) DB::table('performance_query_samples')
            ->where('tenant_id', $this->testTenantId)
            ->count();

        $recorder = $this->startedRecorder();
        $recorder->listen();

        // Genuinely slow, by the database's own clock.
        DB::select('SELECT SLEEP(0.25)');

        $this->flush($recorder);

        $after = (int) DB::table('performance_query_samples')
            ->where('tenant_id', $this->testTenantId)
            ->count();

        $this->assertSame($before + 1, $after, 'The listener did not record a query that really was slow.');

        $stored = DB::table('performance_query_samples')
            ->where('tenant_id', $this->testTenantId)
            ->orderByDesc('id')
            ->first();

        $this->assertNotNull($stored);
        $this->assertStringContainsString('SLEEP', $stored->sql_text);
        $this->assertGreaterThanOrEqual(100, (float) $stored->duration_ms);
    }

    public function test_prune_deletes_samples_past_the_retention_window(): void
    {
        config(['performance.retention_days' => 7, 'performance.hourly_retention_days' => 30]);

        $stale = DB::table('performance_request_samples')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'method' => 'GET',
            'endpoint' => '/api/v2/stale',
            'status_code' => 200,
            'duration_ms' => 1500.00,
            'query_count' => 3,
            'memory_mb' => 20.00,
            'peak_memory_mb' => 30.00,
            'n_plus_one_count' => 0,
            'max_repeated_query_count' => 1,
            'created_at' => now()->subDays(30),
        ]);

        $fresh = DB::table('performance_request_samples')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'method' => 'GET',
            'endpoint' => '/api/v2/fresh',
            'status_code' => 200,
            'duration_ms' => 1500.00,
            'query_count' => 3,
            'memory_mb' => 20.00,
            'peak_memory_mb' => 30.00,
            'n_plus_one_count' => 0,
            'max_repeated_query_count' => 1,
            'created_at' => now()->subHours(2),
        ]);

        $this->artisan('performance:prune')->assertExitCode(0);

        $this->assertDatabaseMissing('performance_request_samples', ['id' => $stale]);
        $this->assertDatabaseHas('performance_request_samples', ['id' => $fresh]);
    }
}
