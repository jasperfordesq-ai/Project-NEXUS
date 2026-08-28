<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Scheduling;

use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\Artisan;
use Tests\Laravel\TestCase;

/**
 * Scheduler-noise regression lock (Sentry issue 128022136).
 *
 * The four operational monitors below intentionally `return self::FAILURE`
 * (exit non-zero) when they DETECT a problem — a signal for a human running
 * them by hand. But a *foreground* scheduled command with a non-zero exit makes
 * Laravel's ScheduleRunCommand throw "Scheduled command [...] failed with exit
 * code [1]" and report THAT to Sentry — a second, context-free error on top of
 * the command's own captureMessage alert. In production the GDPR pager fired
 * this daily (issue 128022136) for as long as a real overdue-DSAR backlog
 * existed. The fix is `->runInBackground()` on each: the vendor guard for that
 * throw is `if ($event->exitCode != 0 && ! $event->runInBackground)`, so a
 * backgrounded event never converts an intentional breach exit into a reported
 * failure, while the real alert and the manual-run exit code are preserved.
 *
 * If this test regresses, the scheduler-failure Sentry noise returns.
 */
class PagerCommandsRunInBackgroundTest extends TestCase
{
    public function test_alert_exit_monitors_run_in_background(): void
    {
        // The schedule is registered via bootstrap/app.php's ->withSchedule(),
        // which the framework wires as Artisan::starting(...) — i.e. it only runs
        // once the console application boots. Running any artisan command fires
        // that and populates the Schedule singleton.
        Artisan::call('list');

        $events = collect($this->app->make(Schedule::class)->events());

        $monitors = [
            'slo:check',
            'stripe:check-stuck-webhooks',
            'gdpr:check-overdue-requests',
            'backup:verify',
            'safeguarding:check-policy-health',
        ];

        foreach ($monitors as $command) {
            $event = $events->first(
                fn ($e) => is_string($e->command) && str_contains($e->command, $command)
            );

            $this->assertNotNull($event, "No scheduled entry found for [{$command}].");
            $this->assertTrue(
                $event->runInBackground,
                "[{$command}] must be scheduled with ->runInBackground() so its intentional "
                . 'non-zero breach exit is not re-reported by the scheduler as a command '
                . 'failure (Sentry issue 128022136).'
            );
        }
    }
}
