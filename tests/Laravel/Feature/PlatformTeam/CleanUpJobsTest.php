<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\PlatformTeam;

use App\Services\PlatformTeam\CleanUpJobsService;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * Platform team panel → Clean-up jobs: the scheduled jobs that delete data,
 * when each last ran successfully, when it last failed, and its state.
 *
 * 🔴 A job with nothing recorded is `unknown` ("No record yet"), never fine.
 * 🔴 A record that cannot be read says so; it is not turned into "no record".
 */
class CleanUpJobsTest extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;

    private const URI = '/v2/platform-team/clean-up-jobs';

    /** Exactly what the page shows. Anything else must not leave the server. */
    private const TOP_KEYS = ['jobs'];

    private const ROW_KEYS = ['checked_by', 'how_often', 'key', 'last_failed_at', 'last_ok_at', 'readable', 'status', 'steps_failed'];

    /** The fixed list, in page order, with how often each runs. */
    private const JOBS = [
        'performance_prune' => 'daily',
        'retention_enforce' => 'daily',
        'prune_logs' => 'daily',
        'prune_match_notifications' => 'daily',
        'purge_message_copies' => 'weekly',
        'federation_purge_external_logs' => 'daily',
        'federation_prune_aggregate_logs' => 'daily',
        'groups_prune_exports' => 'daily',
        'cleanup' => 'daily',
        'cleanup_sessions' => 'hourly',
        'story_cleanup' => 'daily',
        'gdpr_export_cleanup' => 'daily',
        'abuse_cleanup' => 'weekly',
        'gamification_cleanup' => 'weekly',
        'purge_verification_sessions' => 'weekly',
    ];

    private const CRON_IDS = [
        'cleanup', 'cleanup-sessions', 'story-cleanup', 'gdpr-export-cleanup',
        'abuse-cleanup', 'gamification-cleanup', 'purge-verification-sessions',
    ];

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        // Start from nothing recorded, whatever the test database holds.
        DB::table('cron_logs')->whereIn('job_id', self::CRON_IDS)->delete();
        DB::table('tenant_retention_runs')->delete();
    }

    /** @return array<string, array<string, mixed>> */
    private function rows(): array
    {
        $this->actAsPlatformTeam();
        $jobs = $this->apiGet(self::URI)->assertStatus(200)->json('data.jobs');

        return array_column($jobs, null, 'key');
    }

    private function stamp(string $command, string $kind, \DateTimeInterface $at): void
    {
        Cache::put("schedule:{$command}:last_{$kind}_at", $at->format(DATE_ATOM), 3600);
    }

    private function cronLog(string $jobId, string $status, \DateTimeInterface $at, string $output = ''): void
    {
        DB::table('cron_logs')->insert([
            'job_id' => $jobId,
            'status' => $status,
            'output' => $output,
            'duration_seconds' => 1,
            'executed_at' => $at->format('Y-m-d H:i:s'),
            'tenant_id' => null,
        ]);
    }

    /**
     * @param array<string, mixed> $array
     * @return list<string>
     */
    private function sortedKeys(array $array): array
    {
        $keys = array_keys($array);
        sort($keys);

        return $keys;
    }

    public function test_only_the_platform_team_may_read_it(): void
    {
        $this->assertPlatformTeamOnly('GET', self::URI);
    }

    public function test_it_sends_exactly_the_fixed_list_and_nothing_else(): void
    {
        $this->cronLog('cleanup', 'success', now()->subHour(), 'planted-cron-output-text');

        $this->actAsPlatformTeam();
        $response = $this->apiGet(self::URI)->assertStatus(200);
        $data = $response->json('data');

        $this->assertSame(self::TOP_KEYS, $this->sortedKeys($data));
        $this->assertSame(array_keys(self::JOBS), array_column($data['jobs'], 'key'));
        foreach ($data['jobs'] as $row) {
            $this->assertSame(self::ROW_KEYS, $this->sortedKeys($row), "row {$row['key']}");
            $this->assertSame(self::JOBS[$row['key']], $row['how_often'], "row {$row['key']}");
            $this->assertContains($row['status'], ['ok', 'late', 'failing', 'unknown']);
        }

        // The job's own output (which can name members) never leaves the server.
        $this->assertStringNotContainsString('planted-cron-output-text', (string) $response->getContent());
    }

    /**
     * The minute runner's jobs catch their own steps' errors and still record
     * success, so their record says only that they finished. The page says so.
     */
    public function test_each_job_says_whether_its_record_covers_every_step_or_only_that_it_finished(): void
    {
        $runner = ['cleanup', 'cleanup_sessions', 'story_cleanup', 'gdpr_export_cleanup', 'abuse_cleanup', 'gamification_cleanup', 'purge_verification_sessions'];
        foreach ($this->rows() as $key => $row) {
            $this->assertSame(
                in_array($key, $runner, true) ? 'finished_only' : 'record',
                $row['checked_by'],
                $key,
            );
        }
    }

    public function test_nothing_recorded_is_unknown_never_fine(): void
    {
        foreach ($this->rows() as $key => $row) {
            $this->assertSame('unknown', $row['status'], $key);
            $this->assertNull($row['last_ok_at'], $key);
            $this->assertNull($row['last_failed_at'], $key);
            $this->assertTrue($row['readable'], $key);
        }
    }

    public function test_scheduled_commands_follow_their_stamps(): void
    {
        $this->stamp('performance:prune', 'ok', now()->subHours(3));
        $this->stamp('nexus:prune-logs', 'ok', now()->subDays(3));
        $this->stamp('nexus:prune-match-notifications', 'ok', now()->subDays(1));
        $this->stamp('nexus:prune-match-notifications', 'failed', now()->subHours(2));
        $this->stamp('groups:prune-exports', 'failed', now()->subDays(5));
        $this->stamp('groups:prune-exports', 'ok', now()->subHours(5));
        $this->stamp('safeguarding:purge-message-copies', 'ok', now()->subDays(10));

        $rows = $this->rows();

        $this->assertSame('ok', $rows['performance_prune']['status']);
        $this->assertNotNull($rows['performance_prune']['last_ok_at']);
        $this->assertSame('late', $rows['prune_logs']['status'], 'a daily job last fine three days ago');
        $this->assertSame('failing', $rows['prune_match_notifications']['status'], 'failed after its last success');
        $this->assertSame('ok', $rows['groups_prune_exports']['status'], 'succeeded after its last failure');
        $this->assertNotNull($rows['groups_prune_exports']['last_failed_at']);
        $this->assertSame('ok', $rows['purge_message_copies']['status'], 'a weekly job ten days ago is not late');
    }

    public function test_jobs_run_inside_the_minute_runner_follow_its_log(): void
    {
        $this->cronLog('cleanup', 'success', now()->subHours(2));
        $this->cronLog('cleanup-sessions', 'success', now()->subHours(5));
        $this->cronLog('abuse-cleanup', 'success', now()->subDays(8));
        $this->cronLog('abuse-cleanup', 'error', now()->subDays(1));
        $this->cronLog('gamification-cleanup', 'running', now()->subMinutes(5));

        $rows = $this->rows();

        $this->assertSame('ok', $rows['cleanup']['status']);
        $this->assertSame('late', $rows['cleanup_sessions']['status'], 'an hourly job five hours ago');
        $this->assertSame('failing', $rows['abuse_cleanup']['status']);
        $this->assertNotNull($rows['abuse_cleanup']['last_failed_at']);
        $this->assertSame('unknown', $rows['gamification_cleanup']['status'], 'a run still going is not a success');
    }

    public function test_retention_also_reads_its_own_record_of_runs(): void
    {
        DB::table('tenant_retention_runs')->insert([
            'tenant_id' => $this->testTenantId, 'data_type' => 'activity_log', 'action' => 'delete',
            'retention_days' => 365, 'affected_rows' => 0, 'status' => 'completed', 'ran_at' => now()->subHours(4),
        ]);
        $this->assertSame('ok', $this->rows()['retention_enforce']['status']);

        DB::table('tenant_retention_runs')->insert([
            'tenant_id' => $this->testTenantId, 'data_type' => 'activity_log', 'action' => 'delete',
            'retention_days' => 365, 'affected_rows' => 0, 'status' => 'failed', 'error' => 'planted-retention-error',
            'ran_at' => now()->subHour(),
        ]);
        $this->actAsPlatformTeam();
        $response = $this->apiGet(self::URI)->assertStatus(200);
        $row = collect($response->json('data.jobs'))->firstWhere('key', 'retention_enforce');
        $this->assertSame('failing', $row['status']);
        $this->assertStringNotContainsString('planted-retention-error', (string) $response->getContent());

        // A newer clean finish recorded by the scheduler clears it.
        $this->stamp('retention:enforce', 'ok', now()->subMinutes(5));
        $this->assertSame('ok', $this->rows()['retention_enforce']['status']);
    }

    public function test_a_log_that_cannot_be_read_says_so_and_is_not_no_record(): void
    {
        $this->stamp('performance:prune', 'ok', now()->subHour());
        $this->actAsPlatformTeam();
        $broken = true;
        DB::connection()->beforeExecuting(static function (string $sql) use (&$broken): void {
            if ($broken && str_contains($sql, 'from `cron_logs`')) {
                throw new \RuntimeException('planted cron log failure');
            }
        });

        try {
            $response = $this->apiGet(self::URI)->assertStatus(200);
        } finally {
            $broken = false;
        }
        $rows = array_column($response->json('data.jobs'), null, 'key');

        $this->assertFalse($rows['cleanup']['readable']);
        $this->assertSame('unknown', $rows['cleanup']['status']);
        $this->assertTrue($rows['performance_prune']['readable']);
        $this->assertSame('ok', $rows['performance_prune']['status']);
        $this->assertStringNotContainsString('planted cron log failure', (string) $response->getContent());
    }

    public function test_the_fixed_list_matches_the_schedule_and_the_minute_runner(): void
    {
        Artisan::call('list');
        $events = collect($this->app->make(Schedule::class)->events());

        $patterns = ['hourly' => '/^\d+ \* \* \* \*$/', 'daily' => '/^\d+ \d+ \* \* \*$/', 'weekly' => '/^\d+ \d+ \* \* \d$/'];
        $runner = (string) file_get_contents(base_path('app/Services/CronJobRunner.php'));

        foreach (CleanUpJobsService::JOBS as $key => $job) {
            if ($job['source'] === 'schedule') {
                $event = $events->first(fn ($e) => is_string($e->command) && preg_match('/\s' . preg_quote($job['name'], '/') . '(\s|$)/', $e->command) === 1);
                $this->assertNotNull($event, "{$job['name']} is no longer scheduled");
                $this->assertMatchesRegularExpression($patterns[$job['how_often']], $event->expression, "{$job['name']} no longer runs {$job['how_often']}");
            } else {
                $this->assertStringContainsString("runSubTask('{$job['name']}'", $runner, "{$job['name']} is no longer run by the minute runner");
            }
            $this->assertArrayHasKey($key, self::JOBS);
        }
        $this->assertCount(count(self::JOBS), CleanUpJobsService::JOBS);
    }

    /**
     * 16 Nov 2026: four of the minute runner's clean-up jobs now note each
     * step that failed inside them (CleanUpStepFailures). A run with a failed
     * step is `failing` although its log says success, and says how many
     * steps failed; a clean run clears it.
     */
    public function test_a_runner_job_whose_last_run_had_a_failed_step_is_failing_with_the_count(): void
    {
        $this->cronLog('cleanup', 'success', now()->subMinutes(10));
        $this->cronLog('abuse-cleanup', 'success', now()->subMinutes(10));
        \App\Support\Scheduling\CleanUpStepFailures::startRun('cleanup');
        \App\Support\Scheduling\CleanUpStepFailures::note('cleanup', 'match_cache');
        \App\Support\Scheduling\CleanUpStepFailures::note('cleanup', 'cron_logs');
        \App\Support\Scheduling\CleanUpStepFailures::startRun('abuse-cleanup');

        $rows = $this->rows();

        $this->assertSame('failing', $rows['cleanup']['status']);
        $this->assertSame(2, $rows['cleanup']['steps_failed']);
        $this->assertSame('record', $rows['cleanup']['checked_by']);
        $this->assertNotNull($rows['cleanup']['last_failed_at']);

        $this->assertSame('ok', $rows['abuse_cleanup']['status'], 'a clean last run');
        $this->assertSame(0, $rows['abuse_cleanup']['steps_failed']);
        $this->assertSame('record', $rows['abuse_cleanup']['checked_by']);

        // No note yet: as before.
        $this->assertNull($rows['gamification_cleanup']['steps_failed']);
        $this->assertSame('finished_only', $rows['gamification_cleanup']['checked_by']);
        $this->assertNull($rows['story_cleanup']['steps_failed'], 'a job that does not note its steps');
        $this->assertNull($rows['performance_prune']['steps_failed']);

        // The next clean run clears the count.
        \App\Support\Scheduling\CleanUpStepFailures::startRun('cleanup');
        $rows = $this->rows();
        $this->assertSame(0, $rows['cleanup']['steps_failed']);
        $this->assertSame('ok', $rows['cleanup']['status']);
    }

    public function test_nothing_can_be_changed_through_it(): void
    {
        $this->actAsPlatformTeam();

        foreach (['POST', 'PUT', 'DELETE'] as $method) {
            $status = $this->requestAs($method, self::URI, [])->getStatusCode();
            $this->assertContains($status, [404, 405], "{$method} answered {$status}");
        }
    }
}
