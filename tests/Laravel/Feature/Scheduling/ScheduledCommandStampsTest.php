<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Scheduling;

use App\Support\Scheduling\ScheduledCommandStamps;
use Illuminate\Console\Events\ScheduledBackgroundTaskFinished;
use Illuminate\Console\Events\ScheduledTaskFailed;
use Illuminate\Console\Events\ScheduledTaskFinished;
use Illuminate\Console\Scheduling\Event;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Tests\Laravel\TestCase;

/**
 * Every scheduled artisan command that finishes leaves a stamp in the cache:
 * `schedule:<command>:last_ok_at` or `schedule:<command>:last_failed_at`.
 * The Platform team's Clean-up jobs page reads them.
 *
 * Laravel reports the end of a task in two different ways, and both are
 * covered here with the framework's own event classes:
 *
 *   - a foreground task: `ScheduledTaskFinished` in the `schedule:run`
 *     process, with the exit code already set (and `ScheduledTaskFailed`
 *     as well when the exit code is not 0);
 *   - a `runInBackground()` task: `ScheduledTaskFinished` fires when it is
 *     LAUNCHED, with no exit code yet. The real end arrives later as
 *     `ScheduledBackgroundTaskFinished`, in a separate `schedule:finish`
 *     process, once `Event::finish()` has set the exit code.
 */
class ScheduledCommandStampsTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
    }

    private function command(string $command, bool $background = false): Event
    {
        $event = (new Schedule())->command($command);
        if ($background) {
            $event->runInBackground();
        }

        return $event;
    }

    private function ok(string $name): mixed
    {
        return Cache::get("schedule:{$name}:last_ok_at");
    }

    private function failed(string $name): mixed
    {
        return Cache::get("schedule:{$name}:last_failed_at");
    }

    public function test_a_foreground_command_that_succeeds_is_stamped_ok(): void
    {
        $event = $this->command('performance:prune');
        $event->exitCode = 0;

        event(new ScheduledTaskFinished($event, 0.5));

        $this->assertIsString($this->ok('performance:prune'));
        $this->assertNotFalse(strtotime((string) $this->ok('performance:prune')));
        $this->assertNull($this->failed('performance:prune'));
    }

    public function test_a_foreground_command_that_fails_is_stamped_failed_and_not_ok(): void
    {
        $event = $this->command('retention:enforce');
        $event->exitCode = 1;

        // What ScheduleRunCommand does for a non-zero foreground exit: Finished, then Failed.
        event(new ScheduledTaskFinished($event, 0.5));
        event(new ScheduledTaskFailed($event, new \Exception('Scheduled command failed with exit code [1].')));

        $this->assertNull($this->ok('retention:enforce'));
        $this->assertIsString($this->failed('retention:enforce'));
    }

    public function test_the_command_name_is_stamped_without_its_options(): void
    {
        $event = $this->command('events:queue-reminders --limit=200');
        $event->exitCode = 0;

        event(new ScheduledTaskFinished($event, 0.1));

        $this->assertIsString($this->ok('events:queue-reminders'));
    }

    public function test_launching_a_background_command_stamps_nothing_its_finish_does(): void
    {
        $event = $this->command('nexus:prune-logs', background: true);

        // In schedule:run: the launch. The exit code is not known yet.
        $this->assertNull($event->exitCode);
        event(new ScheduledTaskFinished($event, 0.01));
        $this->assertNull($this->ok('nexus:prune-logs'), 'a launch is not a success');
        $this->assertNull($this->failed('nexus:prune-logs'));

        // In schedule:finish: the real end, exactly as ScheduleFinishCommand reports it.
        $event->finish($this->app, 0);
        event(new ScheduledBackgroundTaskFinished($event));

        $this->assertIsString($this->ok('nexus:prune-logs'));
        $this->assertNull($this->failed('nexus:prune-logs'));
    }

    public function test_a_background_command_that_fails_is_stamped_failed(): void
    {
        $event = $this->command('nexus:prune-match-notifications', background: true);
        $event->finish($this->app, 3);

        event(new ScheduledBackgroundTaskFinished($event));

        $this->assertNull($this->ok('nexus:prune-match-notifications'));
        $this->assertIsString($this->failed('nexus:prune-match-notifications'));
    }

    public function test_a_task_skipped_because_the_last_one_is_still_running_stamps_nothing(): void
    {
        // Event::run() returns early on overlap and the exit code stays null,
        // but ScheduleRunCommand still dispatches ScheduledTaskFinished.
        $event = $this->command('groups:prune-exports');

        event(new ScheduledTaskFinished($event, 0.0));

        $this->assertNull($this->ok('groups:prune-exports'));
        $this->assertNull($this->failed('groups:prune-exports'));
    }

    public function test_a_closure_task_has_no_command_name_and_is_skipped(): void
    {
        $event = (new Schedule())->call(fn () => null)->name('nexus:run-all');
        $event->exitCode = 0;

        event(new ScheduledTaskFinished($event, 0.1));

        $this->assertNull($this->ok('nexus:run-all'));
    }

    public function test_the_real_schedule_finish_command_stamps_a_background_task(): void
    {
        // The second process a background task reports through. It boots the
        // application's providers, so the listener must be registered there.
        Artisan::call('list');
        $event = collect($this->app->make(Schedule::class)->events())
            ->first(fn ($e) => is_string($e->command) && str_contains($e->command, 'nexus:prune-logs'));
        $this->assertNotNull($event, 'nexus:prune-logs is no longer scheduled');
        $this->assertTrue($event->runInBackground);

        Artisan::call('schedule:finish', ['id' => $event->mutexName(), 'code' => 0]);

        $this->assertIsString($this->ok('nexus:prune-logs'));
    }

    public function test_a_broken_cache_never_breaks_the_scheduler(): void
    {
        Cache::extend('pt-broken', fn () => Cache::repository(new class extends \Illuminate\Cache\ArrayStore {
            public function put($key, $value, $seconds)
            {
                throw new \RuntimeException('cache is down');
            }

            public function get($key)
            {
                throw new \RuntimeException('cache is down');
            }
        }));
        config(['cache.stores.pt-broken' => ['driver' => 'pt-broken']]);
        $previous = Cache::getDefaultDriver();
        Cache::setDefaultDriver('pt-broken');

        try {
            $event = $this->command('performance:prune');
            $event->exitCode = 0;
            event(new ScheduledTaskFinished($event, 0.1));
            event(new ScheduledTaskFailed($event, new \Exception('x')));

            $background = $this->command('nexus:prune-logs', background: true);
            $background->finish($this->app, 0);
            event(new ScheduledBackgroundTaskFinished($background));
        } finally {
            Cache::setDefaultDriver($previous);
        }

        $this->addToAssertionCount(1); // reaching here is the test: nothing was thrown
    }

    public function test_the_stamp_helper_reads_names_and_keeps_stamps_for_400_days(): void
    {
        $this->assertSame('performance:prune', ScheduledCommandStamps::commandName($this->command('performance:prune')));
        $this->assertSame('events:queue-reminders', ScheduledCommandStamps::commandName($this->command('events:queue-reminders --limit=200')));
        $this->assertNull(ScheduledCommandStamps::commandName((new Schedule())->call(fn () => null)));
        $this->assertNull(ScheduledCommandStamps::commandName((new Schedule())->exec('ls -la')));
        $this->assertSame(400 * 86400, ScheduledCommandStamps::TTL_SECONDS);
    }
}
