<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\PlatformTeam;

use App\Support\Scheduling\ScheduledCommandStamps;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Platform team panel → Clean-up jobs: the scheduled jobs that delete data,
 * when each last ran successfully, when it last failed, and its state.
 *
 * A FIXED list (JOBS), checked against the real schedule and the every-minute
 * runner by CleanUpJobsTest. Where each job's record comes from:
 *
 *   - `schedule`: a command in bootstrap/app.php's schedule. Read from the cache
 *     stamps StampScheduledCommandOutcome writes when it finishes. They only
 *     exist from the day that listener went live.
 *   - `runner`: a sub-task of CronJobRunner::runAllInternal() (the
 *     `nexus:run-all` closure that runs every minute). Read from `cron_logs`
 *     (`job_id`, newest `success` and newest `error`); `cleanup` deletes those
 *     rows after 30 days, so an older run is no longer known. 🔴 These jobs
 *     catch their own steps' errors and still record `success`, so their
 *     rows carry `checked_by: finished_only`: a success means the job
 *     finished, not that every step worked.
 *   - `retention:enforce` additionally reads `tenant_retention_runs`
 *     (`completed` / `failed`), its own record of each pass.
 *
 * Status: `failing` when the newest failure is newer than the newest success
 * (or there is no success); `late` when the newest success is older than twice
 * the job's period; `ok` otherwise; `unknown` when nothing is recorded.
 *
 * 🔴 Never `ok` for "nothing recorded". A source that cannot be read gives
 * `readable: false` for its jobs (status `unknown`), and the reason is logged
 * at `error`, never sent.
 *
 * 🔴 Cross-community on purpose: `cron_logs` and `tenant_retention_runs` are
 * read with no `tenant_id` filter, because the jobs are installation-wide.
 * Only times are selected: never `output`, `error`, or a community.
 */
final class CleanUpJobsService
{
    public const OK = 'ok';
    public const LATE = 'late';
    public const FAILING = 'failing';
    public const UNKNOWN = 'unknown';

    private const PERIOD_SECONDS = ['hourly' => 3600, 'daily' => 86400, 'weekly' => 604800];

    /**
     * Page order. `name` is the artisan command (source `schedule`) or the
     * `cron_logs.job_id` (source `runner`).
     *
     * Left out on purpose: `safeguarding:clear-expired-monitoring` and the
     * runner's `expire-verifications` (they end or mark things, they delete
     * nothing), and `podcasts:dispatch-media-cleanup` (an every-minute retry of
     * file deletions already decided elsewhere, not a keeping rule).
     *
     * @var array<string, array{source: 'schedule'|'runner', name: string, how_often: 'hourly'|'daily'|'weekly'}>
     */
    public const JOBS = [
        'performance_prune' => ['source' => 'schedule', 'name' => 'performance:prune', 'how_often' => 'daily'],
        'retention_enforce' => ['source' => 'schedule', 'name' => 'retention:enforce', 'how_often' => 'daily'],
        'prune_logs' => ['source' => 'schedule', 'name' => 'nexus:prune-logs', 'how_often' => 'daily'],
        'prune_match_notifications' => ['source' => 'schedule', 'name' => 'nexus:prune-match-notifications', 'how_often' => 'daily'],
        'purge_message_copies' => ['source' => 'schedule', 'name' => 'safeguarding:purge-message-copies', 'how_often' => 'weekly'],
        'federation_purge_external_logs' => ['source' => 'schedule', 'name' => 'federation:purge-external-logs', 'how_often' => 'daily'],
        'federation_prune_aggregate_logs' => ['source' => 'schedule', 'name' => 'federation:prune-aggregate-logs', 'how_often' => 'daily'],
        'groups_prune_exports' => ['source' => 'schedule', 'name' => 'groups:prune-exports', 'how_often' => 'daily'],
        'cleanup' => ['source' => 'runner', 'name' => 'cleanup', 'how_often' => 'daily'],
        'cleanup_sessions' => ['source' => 'runner', 'name' => 'cleanup-sessions', 'how_often' => 'hourly'],
        'story_cleanup' => ['source' => 'runner', 'name' => 'story-cleanup', 'how_often' => 'daily'],
        'gdpr_export_cleanup' => ['source' => 'runner', 'name' => 'gdpr-export-cleanup', 'how_often' => 'daily'],
        'abuse_cleanup' => ['source' => 'runner', 'name' => 'abuse-cleanup', 'how_often' => 'weekly'],
        'gamification_cleanup' => ['source' => 'runner', 'name' => 'gamification-cleanup', 'how_often' => 'weekly'],
        'purge_verification_sessions' => ['source' => 'runner', 'name' => 'purge-verification-sessions', 'how_often' => 'weekly'],
    ];

    /** @return array{jobs: list<array{key: string, how_often: string, last_ok_at: ?string, last_failed_at: ?string, status: string, readable: bool, checked_by: 'record'|'finished_only'}>} */
    public function report(): array
    {
        $runner = $this->runnerTimes();
        $retention = $this->retentionTimes();

        $jobs = [];
        foreach (self::JOBS as $key => $job) {
            $readable = true;
            $ok = null;
            $failed = null;

            if ($job['source'] === 'runner') {
                if ($runner === null) {
                    $readable = false;
                } else {
                    [$ok, $failed] = $runner[$job['name']] ?? [null, null];
                }
            } else {
                $stamps = $this->stamps($job['name']);
                if ($stamps === null) {
                    $readable = false;
                } else {
                    [$ok, $failed] = $stamps;
                }
                if ($job['name'] === 'retention:enforce' && $readable) {
                    if ($retention === null) {
                        $readable = false;
                    } else {
                        $ok = self::newer($ok, $retention[0]);
                        $failed = self::newer($failed, $retention[1]);
                    }
                }
            }

            if (!$readable) {
                $ok = null;
                $failed = null;
            }

            $jobs[] = [
                'key' => $key,
                'how_often' => $job['how_often'],
                'last_ok_at' => $ok,
                'last_failed_at' => $failed,
                'status' => $readable ? self::status($ok, $failed, $job['how_often']) : self::UNKNOWN,
                'readable' => $readable,
                // What a success in the record proves. The runner's jobs catch
                // their own steps' errors and still log success, so for them
                // it proves only that the job finished (CronJobRunner is not
                // changed for this; the page says so in words).
                'checked_by' => $job['source'] === 'runner' ? 'finished_only' : 'record',
            ];
        }

        return ['jobs' => $jobs];
    }

    public static function status(?string $ok, ?string $failed, string $howOften): string
    {
        $okAt = $ok !== null ? strtotime($ok) : false;
        $failedAt = $failed !== null ? strtotime($failed) : false;

        if ($okAt === false && $failedAt === false) {
            return self::UNKNOWN;
        }
        if ($failedAt !== false && ($okAt === false || $failedAt > $okAt)) {
            return self::FAILING;
        }
        if ($okAt !== false && time() - $okAt > 2 * self::PERIOD_SECONDS[$howOften]) {
            return self::LATE;
        }

        return self::OK;
    }

    /** @return array{0: ?string, 1: ?string}|null null when the cache cannot be read */
    private function stamps(string $command): ?array
    {
        try {
            return [
                ScheduledCommandStamps::read(ScheduledCommandStamps::okKey($command)),
                ScheduledCommandStamps::read(ScheduledCommandStamps::failedKey($command)),
            ];
        } catch (\Throwable $e) {
            Log::error('[CleanUpJobs] the schedule stamps could not be read', [
                'command' => $command,
                'exception' => $e::class,
                'message' => $e->getMessage(),
            ]);

            return null;
        }
    }

    /**
     * Newest success and newest failure per runner job, from `cron_logs`.
     * One grouped query. `running` rows are neither.
     *
     * @return array<string, array{0: ?string, 1: ?string}>|null null when it cannot be read
     */
    private function runnerTimes(): ?array
    {
        $ids = [];
        foreach (self::JOBS as $job) {
            if ($job['source'] === 'runner') {
                $ids[] = $job['name'];
            }
        }

        try {
            // 🔴 Cross-community on purpose (installation-wide jobs). Times only.
            $rows = DB::table('cron_logs')
                ->whereIn('job_id', $ids)
                ->groupBy('job_id')
                ->select('job_id')
                ->selectRaw("MAX(CASE WHEN status = 'success' THEN executed_at END) AS last_ok")
                ->selectRaw("MAX(CASE WHEN status = 'error' THEN executed_at END) AS last_failed")
                ->get();
        } catch (\Throwable $e) {
            Log::error('[CleanUpJobs] cron_logs could not be read', [
                'exception' => $e::class,
                'message' => $e->getMessage(),
            ]);

            return null;
        }

        $times = [];
        foreach ($rows as $row) {
            $times[(string) $row->job_id] = [self::iso($row->last_ok), self::iso($row->last_failed)];
        }

        return $times;
    }

    /** @return array{0: ?string, 1: ?string}|null null when it cannot be read */
    private function retentionTimes(): ?array
    {
        try {
            // 🔴 Cross-community on purpose: the newest pass of any community. Times only.
            $row = DB::table('tenant_retention_runs')
                ->selectRaw("MAX(CASE WHEN status = 'completed' THEN ran_at END) AS last_ok")
                ->selectRaw("MAX(CASE WHEN status = 'failed' THEN ran_at END) AS last_failed")
                ->first();
        } catch (\Throwable $e) {
            Log::error('[CleanUpJobs] tenant_retention_runs could not be read', [
                'exception' => $e::class,
                'message' => $e->getMessage(),
            ]);

            return null;
        }

        return [self::iso($row->last_ok ?? null), self::iso($row->last_failed ?? null)];
    }

    private static function iso(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }
        $time = strtotime((string) $value);

        return $time === false ? null : date('c', $time);
    }

    private static function newer(?string $a, ?string $b): ?string
    {
        if ($a === null) {
            return $b;
        }
        if ($b === null) {
            return $a;
        }

        return strtotime($b) > strtotime($a) ? $b : $a;
    }
}
