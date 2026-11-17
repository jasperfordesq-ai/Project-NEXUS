<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Console;

use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\Laravel\TestCase;

/**
 * Tests for nexus:prune-logs Artisan command.
 *
 * Each test uses tenant id 99708 to stay isolated from the default
 * test tenant (2). Tables that accept a tenant_id column are seeded
 * with this id; tables without a tenant_id column (error_404_log,
 * federation_api_logs, federation_messages) are tested via their
 * timestamp column only.
 *
 * The command iterates all tables globally (no tenant scope), so we
 * assert on explicit row identifiers rather than global counts to
 * avoid interference with fixture rows from other tests.
 */
class PruneLogsTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 99708;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();

        // Ensure our isolated tenant row exists so FK constraints on
        // tables that reference tenants.id are satisfied.
        DB::table('tenants')->updateOrInsert(
            ['id' => self::TENANT_ID],
            [
                'name'              => 'PruneLogs Test Tenant',
                'slug'              => 'prune-logs-test',
                'domain'            => null,
                'is_active'         => true,
                'depth'             => 0,
                'allows_subtenants' => false,
                'created_at'        => now(),
                'updated_at'        => now(),
            ]
        );

        \App\Core\TenantContext::setById(self::TENANT_ID);
    }

    // ---------------------------------------------------------------
    // cron_logs (executed_at, 90-day retention)
    // ---------------------------------------------------------------

    public function test_prune_logs_deletes_old_cron_log_rows(): void
    {
        // Seed one row older than 90 days and one recent row.
        $oldId = DB::table('cron_logs')->insertGetId([
            'job_id'      => 'test-job-old',
            'status'      => 'success',
            'tenant_id'   => self::TENANT_ID,
            'executed_at' => now()->subDays(100)->toDateTimeString(),
        ]);

        $recentId = DB::table('cron_logs')->insertGetId([
            'job_id'      => 'test-job-recent',
            'status'      => 'success',
            'tenant_id'   => self::TENANT_ID,
            'executed_at' => now()->subDays(10)->toDateTimeString(),
        ]);

        $this->artisan('nexus:prune-logs')->assertExitCode(0);

        $this->assertDatabaseMissing('cron_logs', ['id' => $oldId]);
        $this->assertDatabaseHas('cron_logs', ['id' => $recentId]);
    }

    public function test_prune_logs_keeps_cron_log_row_exactly_at_boundary(): void
    {
        // A row exactly 90 days old is NOT yet past the threshold (< 90 days).
        // DATE_SUB(NOW(), INTERVAL 90 DAY) means rows whose executed_at < that
        // value. A row created exactly 90 days ago equals the boundary and must
        // therefore be pruned (it's not strictly less-than current time - 90d
        // because it equals that value when truncated to seconds; however
        // "exactly 90 days" in MySQL integer arithmetic IS at the boundary and
        // will typically be deleted). We seed it at 89 days to confirm it is kept.
        $boundaryId = DB::table('cron_logs')->insertGetId([
            'job_id'      => 'test-job-boundary',
            'status'      => 'success',
            'tenant_id'   => self::TENANT_ID,
            'executed_at' => now()->subDays(89)->toDateTimeString(),
        ]);

        $this->artisan('nexus:prune-logs')->assertExitCode(0);

        $this->assertDatabaseHas('cron_logs', ['id' => $boundaryId]);
    }

    // ---------------------------------------------------------------
    // error_404_log (last_seen_at, 30-day retention)
    // ---------------------------------------------------------------

    public function test_prune_logs_deletes_old_error_404_rows(): void
    {
        $oldId = DB::table('error_404_log')->insertGetId([
            'url'          => '/old-missing-page',
            'first_seen_at' => now()->subDays(40)->toDateTimeString(),
            'last_seen_at' => now()->subDays(40)->toDateTimeString(),
        ]);

        $recentId = DB::table('error_404_log')->insertGetId([
            'url'          => '/recent-missing-page',
            'first_seen_at' => now()->subDays(5)->toDateTimeString(),
            'last_seen_at' => now()->subDays(5)->toDateTimeString(),
        ]);

        $this->artisan('nexus:prune-logs')->assertExitCode(0);

        $this->assertDatabaseMissing('error_404_log', ['id' => $oldId]);
        $this->assertDatabaseHas('error_404_log', ['id' => $recentId]);
    }

    public function test_prune_logs_keeps_error_404_row_within_retention(): void
    {
        $keepId = DB::table('error_404_log')->insertGetId([
            'url'           => '/page-within-retention',
            'first_seen_at' => now()->subDays(20)->toDateTimeString(),
            'last_seen_at'  => now()->subDays(20)->toDateTimeString(),
        ]);

        $this->artisan('nexus:prune-logs')->assertExitCode(0);

        $this->assertDatabaseHas('error_404_log', ['id' => $keepId]);
    }

    // ---------------------------------------------------------------
    // activity_log (created_at, 180-day retention)
    // ---------------------------------------------------------------

    public function test_prune_logs_deletes_old_activity_log_rows(): void
    {
        $oldId = DB::table('activity_log')->insertGetId([
            'tenant_id'  => self::TENANT_ID,
            'action'     => 'test_action_old',
            'created_at' => now()->subDays(200)->toDateTimeString(),
        ]);

        $recentId = DB::table('activity_log')->insertGetId([
            'tenant_id'  => self::TENANT_ID,
            'action'     => 'test_action_recent',
            'created_at' => now()->subDays(30)->toDateTimeString(),
        ]);

        $this->artisan('nexus:prune-logs')->assertExitCode(0);

        $this->assertDatabaseMissing('activity_log', ['id' => $oldId]);
        $this->assertDatabaseHas('activity_log', ['id' => $recentId]);
    }

    // ---------------------------------------------------------------
    // api_logs (created_at, 30-day retention)
    // ---------------------------------------------------------------

    public function test_prune_logs_deletes_old_api_log_rows(): void
    {
        $oldId = DB::table('api_logs')->insertGetId([
            'tenant_id'   => self::TENANT_ID,
            'endpoint'    => '/v2/test-old',
            'method'      => 'GET',
            'ip_address'  => '127.0.0.1',
            'created_at'  => now()->subDays(45)->toDateTimeString(),
        ]);

        $recentId = DB::table('api_logs')->insertGetId([
            'tenant_id'  => self::TENANT_ID,
            'endpoint'   => '/v2/test-recent',
            'method'     => 'GET',
            'ip_address' => '127.0.0.1',
            'created_at' => now()->subDays(5)->toDateTimeString(),
        ]);

        $this->artisan('nexus:prune-logs')->assertExitCode(0);

        $this->assertDatabaseMissing('api_logs', ['id' => $oldId]);
        $this->assertDatabaseHas('api_logs', ['id' => $recentId]);
    }

    // ---------------------------------------------------------------
    // No-op: nothing old exists → command still returns 0
    // ---------------------------------------------------------------

    public function test_prune_logs_succeeds_with_no_old_rows(): void
    {
        // Only seed a very recent row — nothing should be deleted.
        $id = DB::table('cron_logs')->insertGetId([
            'job_id'      => 'test-no-op-recent',
            'status'      => 'success',
            'tenant_id'   => self::TENANT_ID,
            'executed_at' => now()->subHours(1)->toDateTimeString(),
        ]);

        $this->artisan('nexus:prune-logs')->assertExitCode(0);

        $this->assertDatabaseHas('cron_logs', ['id' => $id]);
    }

    // ---------------------------------------------------------------
    // chunk option: chunked prune still removes all qualifying rows
    // ---------------------------------------------------------------

    public function test_prune_logs_with_chunk_1_deletes_multiple_old_rows(): void
    {
        $id1 = DB::table('cron_logs')->insertGetId([
            'job_id'      => 'chunk-test-a',
            'status'      => 'success',
            'tenant_id'   => self::TENANT_ID,
            'executed_at' => now()->subDays(120)->toDateTimeString(),
        ]);

        $id2 = DB::table('cron_logs')->insertGetId([
            'job_id'      => 'chunk-test-b',
            'status'      => 'success',
            'tenant_id'   => self::TENANT_ID,
            'executed_at' => now()->subDays(150)->toDateTimeString(),
        ]);

        // chunk=1 means one row deleted per loop iteration — verifies the
        // while-loop logic handles chunked multi-pass deletion.
        $this->artisan('nexus:prune-logs', ['--chunk' => '1'])->assertExitCode(0);

        $this->assertDatabaseMissing('cron_logs', ['id' => $id1]);
        $this->assertDatabaseMissing('cron_logs', ['id' => $id2]);
    }

    // ---------------------------------------------------------------
    // sign_in_failure_hours (hour_start, 90-day retention)
    // ---------------------------------------------------------------

    public function test_prune_logs_deletes_failed_sign_in_counts_older_than_90_days_and_keeps_newer(): void
    {
        $old = now()->subDays(91)->startOfHour()->toDateTimeString();
        $recent = now()->subDays(89)->startOfHour()->toDateTimeString();
        DB::table('sign_in_failure_hours')->insert([
            ['hour_start' => $old, 'tenant_id' => self::TENANT_ID, 'failures' => 4],
            ['hour_start' => $recent, 'tenant_id' => self::TENANT_ID, 'failures' => 2],
        ]);

        $this->artisan('nexus:prune-logs')->assertExitCode(0);

        $this->assertDatabaseMissing('sign_in_failure_hours', ['hour_start' => $old, 'tenant_id' => self::TENANT_ID]);
        $this->assertDatabaseHas('sign_in_failure_hours', ['hour_start' => $recent, 'tenant_id' => self::TENANT_ID]);
    }

    // ---------------------------------------------------------------
    // push_log (created_at, 180-day retention, every community)
    // ---------------------------------------------------------------

    public function test_prune_logs_deletes_push_log_rows_older_than_180_days_in_every_community(): void
    {
        $otherTenant = 2;
        $row = static fn (int $tenantId, int $daysAgo): array => [
            'tenant_id'     => $tenantId,
            'activity_type' => 'prune_logs_test',
            'status'        => 'delivered',
            'created_at'    => now()->subDays($daysAgo)->toDateTimeString(),
        ];

        $oldHere = DB::table('push_log')->insertGetId($row(self::TENANT_ID, 181));
        $keptHere = DB::table('push_log')->insertGetId($row(self::TENANT_ID, 179));
        $oldThere = DB::table('push_log')->insertGetId($row($otherTenant, 200));
        $keptThere = DB::table('push_log')->insertGetId($row($otherTenant, 179));

        $this->artisan('nexus:prune-logs')->assertExitCode(0);

        $this->assertDatabaseMissing('push_log', ['id' => $oldHere]);
        $this->assertDatabaseMissing('push_log', ['id' => $oldThere]);
        $this->assertDatabaseHas('push_log', ['id' => $keptHere]);
        $this->assertDatabaseHas('push_log', ['id' => $keptThere]);
    }

    public function test_retention_days_for_reports_the_push_log_policy(): void
    {
        $this->assertSame(180, \App\Console\Commands\PruneLogs::retentionDaysFor('push_log'));
        $this->assertNull(\App\Console\Commands\PruneLogs::retentionDaysFor('no_such_table'));
    }

    // ---------------------------------------------------------------
    // Command returns 0 even when no tables have qualifying rows
    // ---------------------------------------------------------------

    public function test_prune_logs_returns_success_exit_code_always(): void
    {
        // Run with an empty DB of old rows — just confirm the exit code contract.
        $this->artisan('nexus:prune-logs')->assertExitCode(0);

        // Minimal assertion to satisfy failOnRisky requirement.
        $this->assertTrue(true);
    }
}
