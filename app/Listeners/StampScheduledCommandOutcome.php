<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Listeners;

use App\Support\Scheduling\ScheduledCommandStamps;
use Illuminate\Console\Events\ScheduledBackgroundTaskFinished;
use Illuminate\Console\Events\ScheduledTaskFailed;
use Illuminate\Console\Events\ScheduledTaskFinished;
use Illuminate\Support\Facades\Log;

/**
 * Stamps the cache when a scheduled artisan command finishes, so the Platform
 * team's Clean-up jobs page can say when each job last worked and last failed.
 * See ScheduledCommandStamps for the keys.
 *
 * Laravel reports the end of a scheduled task in two ways (read from
 * Illuminate\Console\Scheduling\ScheduleRunCommand / ScheduleFinishCommand /
 * Event, Laravel 12):
 *
 *   - Foreground task: `Event::run()` runs it and sets `exitCode`, then
 *     `schedule:run` dispatches ScheduledTaskFinished. A non-zero exit is then
 *     thrown and ScheduledTaskFailed is dispatched as well.
 *   - `runInBackground()` task: `Event::run()` only LAUNCHES it and leaves
 *     `exitCode` null, yet ScheduledTaskFinished is still dispatched. The real
 *     end comes later, in a separate `php artisan schedule:finish <id> <code>`
 *     process, which calls `Event::finish()` (setting `exitCode`) and then
 *     dispatches ScheduledBackgroundTaskFinished. That process boots the
 *     service providers, which is why this is registered in
 *     EventServiceProvider and not inside the schedule definition.
 *
 * So: a null exit code stamps nothing (a background launch, or a run skipped
 * because the previous one is still going); 0 stamps ok; anything else stamps
 * failed. ScheduledTaskFailed always stamps failed (it also covers a task
 * whose before-callbacks threw, which never got an exit code).
 *
 * 🔴 This must never break the scheduler: every failure is caught, logged once
 * per process, and the run carries on. A closure, a job or a shell command
 * has no artisan command name and is skipped.
 */
final class StampScheduledCommandOutcome
{
    private static bool $failureLogged = false;

    public function handle(object $event): void
    {
        try {
            if ($event instanceof ScheduledTaskFailed) {
                $name = ScheduledCommandStamps::commandName($event->task);
                if ($name !== null) {
                    ScheduledCommandStamps::recordFailed($name);
                }

                return;
            }

            if (!$event instanceof ScheduledTaskFinished && !$event instanceof ScheduledBackgroundTaskFinished) {
                return;
            }

            $name = ScheduledCommandStamps::commandName($event->task);
            $exitCode = $event->task->exitCode;
            if ($name === null || $exitCode === null) {
                return;
            }

            if ((int) $exitCode === 0) {
                ScheduledCommandStamps::recordOk($name);
            } else {
                ScheduledCommandStamps::recordFailed($name);
            }
        } catch (\Throwable $e) {
            // The narrow allowed case: a record of the run must never stop the run.
            if (!self::$failureLogged) {
                self::$failureLogged = true;
                Log::error('[ScheduleStamps] could not record a scheduled command finishing', [
                    'exception' => $e::class,
                    'message' => $e->getMessage(),
                ]);
            }
        }
    }
}
