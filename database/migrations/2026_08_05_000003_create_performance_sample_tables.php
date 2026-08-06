<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Storage for request performance recording — the data /admin/performance shows.
 *
 * 🔴 Why this exists: the admin Performance page was built in 2026 against an
 * imagined API. It read /v2/metrics/summary, which is the event-counter
 * endpoint, and crashed on the first missing key. Nothing on the platform
 * recorded request timings, slow queries or memory use — there was no table for
 * it and no code writing one. These three tables are that missing half.
 *
 * The shape is chosen so the monitor cannot become the platform's own
 * bottleneck (see config/performance.php):
 *
 *   performance_request_hourly   one row per tenant per hour, incremented on
 *                                every request. Exact totals and the volume
 *                                chart, at one upsert per request.
 *   performance_request_samples  a detail row ONLY for requests that were slow,
 *                                memory-hungry, query-heavy or showed a
 *                                repeated-query pattern.
 *   performance_query_samples    individual slow queries, with the application
 *                                frame that issued them.
 *
 * 🔴 `sql_text` holds the query TEMPLATE only — the `?` placeholder form Laravel
 * reports in QueryExecuted::$sql. Bindings are never stored, so this table
 * cannot accumulate member data. Do not "improve" it by interpolating bindings.
 *
 * tenant_id is NOT NULL with a 0 sentinel rather than nullable, because MySQL
 * treats NULLs as distinct in a unique index, which would let the hourly
 * counter grow one row per request for platform-level (untenanted) traffic.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('performance_request_hourly')) {
            Schema::create('performance_request_hourly', function (Blueprint $table): void {
                $table->bigIncrements('id');
                $table->integer('tenant_id')->default(0);
                $table->dateTime('bucket_hour');
                $table->unsignedBigInteger('request_count')->default(0);
                $table->timestamp('created_at')->useCurrent();
                $table->timestamp('updated_at')->useCurrent();

                // The upsert target. Without this the increment cannot be atomic.
                $table->unique(['tenant_id', 'bucket_hour'], 'uniq_perf_hourly_bucket');
                $table->index('bucket_hour', 'idx_perf_hourly_prune');
            });
        }

        if (! Schema::hasTable('performance_request_samples')) {
            Schema::create('performance_request_samples', function (Blueprint $table): void {
                $table->bigIncrements('id');
                $table->integer('tenant_id')->default(0);
                $table->integer('user_id')->nullable();

                $table->string('method', 8);

                // The route pattern where one is known (api/v2/users/{id}), so
                // samples aggregate per endpoint instead of per record id.
                $table->string('endpoint', 191);
                $table->smallInteger('status_code')->nullable();

                $table->decimal('duration_ms', 12, 2);
                $table->integer('query_count')->default(0);

                // 🔴 Memory the request ADDED, not the process total. A PHP-FPM
                // worker never returns memory to the OS, so the absolute figure
                // reflects how long the worker has been alive rather than what
                // this request cost. See PerformanceRecorder::beginRequest().
                $table->decimal('memory_mb', 10, 2)->default(0);
                $table->decimal('peak_memory_mb', 10, 2)->default(0);

                // How many query templates in this request repeated past the
                // N+1 threshold, and the worst single template's repeat count.
                $table->integer('n_plus_one_count')->default(0);
                $table->integer('max_repeated_query_count')->default(0);

                $table->timestamp('created_at')->useCurrent();

                $table->index(['tenant_id', 'created_at'], 'idx_perf_req_tenant_time');
                $table->index(['tenant_id', 'duration_ms'], 'idx_perf_req_slowest');
                $table->index(['tenant_id', 'peak_memory_mb'], 'idx_perf_req_memory');
                $table->index('created_at', 'idx_perf_req_prune');
            });
        }

        if (! Schema::hasTable('performance_query_samples')) {
            Schema::create('performance_query_samples', function (Blueprint $table): void {
                $table->bigIncrements('id');
                $table->integer('tenant_id')->default(0);

                // Set when the same request also produced a detail row. No FK:
                // the two tables are pruned independently and a dangling
                // reference here is harmless diagnostic data, whereas a FK would
                // make pruning order-sensitive.
                $table->unsignedBigInteger('request_sample_id')->nullable();

                $table->decimal('duration_ms', 12, 2);

                // Placeholder form only — see the class docblock.
                $table->string('sql_text', 1000);

                $table->string('caller_class', 191)->nullable();
                $table->string('caller_function', 191)->nullable();
                $table->string('caller_file', 191)->nullable();
                $table->integer('caller_line')->nullable();

                $table->timestamp('created_at')->useCurrent();

                $table->index(['tenant_id', 'created_at'], 'idx_perf_query_tenant_time');
                $table->index(['tenant_id', 'duration_ms'], 'idx_perf_query_slowest');
                $table->index('created_at', 'idx_perf_query_prune');
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('performance_query_samples');
        Schema::dropIfExists('performance_request_samples');
        Schema::dropIfExists('performance_request_hourly');
    }
};
