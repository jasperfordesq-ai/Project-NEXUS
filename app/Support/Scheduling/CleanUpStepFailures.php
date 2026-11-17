<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Scheduling;

use Illuminate\Support\Facades\Cache;

/**
 * Remembers, per clean-up job of the minute runner, how many of its steps
 * failed on its last run and when a step last failed.
 *
 * Four CronJobRunner jobs (`cleanup`, `cleanup-sessions`, `abuse-cleanup`,
 * `gamification-cleanup`) catch each step's error and carry on, so their
 * `cron_logs` row says success although a step failed. They call startRun()
 * at the top and note() inside each existing catch; the Platform team's
 * Clean-up jobs page reads lastRun().
 *
 * 🔴 Only a time and a count are kept, never the error text (a database
 * error quotes the values of the failed statement). Kept KEEP_DAYS in the
 * default cache store.
 *
 * 🔴 Never throws: recording is a side note to a clean-up job and must never
 * stop it or change what it does. A failure to record is dropped silently
 * (the step's own failure is already logged by the job).
 */
final class CleanUpStepFailures
{
    public const KEEP_DAYS = 40;

    public static function key(string $job): string
    {
        return "cleanup_steps:{$job}";
    }

    /** A new run of the job begins: its failed-step count starts again at 0. */
    public static function startRun(string $job): void
    {
        try {
            $previous = self::read($job);
            self::write($job, [
                'steps_failed' => 0,
                'last_failed_at' => $previous['last_failed_at'] ?? null,
            ]);
        } catch (\Throwable) {
            // Never stop or change the job (see the class comment).
        }
    }

    /** A step of the job's current run failed. $step names it for the caller's reading only; it is not kept. */
    public static function note(string $job, string $step): void
    {
        unset($step);
        try {
            $current = self::read($job);
            self::write($job, [
                'steps_failed' => (int) ($current['steps_failed'] ?? 0) + 1,
                'last_failed_at' => now()->toIso8601String(),
            ]);
        } catch (\Throwable) {
            // Never stop or change the job (see the class comment).
        }
    }

    /** @return array{last_failed_at: ?string, steps_failed: int}|null null when nothing is noted (or it cannot be read) */
    public static function lastRun(string $job): ?array
    {
        try {
            $value = self::read($job);
        } catch (\Throwable) {
            return null;
        }
        if ($value === null) {
            return null;
        }

        $at = $value['last_failed_at'] ?? null;

        return [
            'last_failed_at' => is_string($at) && strtotime($at) !== false ? $at : null,
            'steps_failed' => max(0, (int) ($value['steps_failed'] ?? 0)),
        ];
    }

    /** @return array<string, mixed>|null */
    private static function read(string $job): ?array
    {
        $value = Cache::get(self::key($job));

        return is_array($value) ? $value : null;
    }

    /** @param array{steps_failed: int, last_failed_at: ?string} $value */
    private static function write(string $job, array $value): void
    {
        Cache::put(self::key($job), $value, now()->addDays(self::KEEP_DAYS));
    }
}
