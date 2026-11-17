<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Scheduling;

use App\Services\PlatformTeam\PlatformHealthService;
use Cron\CronExpression;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\Artisan;
use Tests\Laravel\TestCase;

/**
 * The Platform team's backup card reads the verdict `backup:verify` leaves and
 * treats one older than PlatformHealthService::BACKUP_VERDICT_STALE_SECONDS as
 * "not known".
 *
 * `backup:verify` was scheduled once a day (09:30). On 17 November 2026 that
 * one run was missed, and the card said "not known" for a whole day while the
 * backups themselves were fine: 24 hours between runs against a 26-hour limit
 * leaves no room for a single miss.
 *
 * The lock: one missed run must still leave a verdict the card accepts.
 */
class BackupVerifyScheduleTest extends TestCase
{
    public function test_one_missed_run_does_not_leave_the_backup_card_without_an_answer(): void
    {
        $longestGap = $this->longestGapBetweenRuns($this->backupVerifyExpression());

        $this->assertLessThanOrEqual(
            PlatformHealthService::BACKUP_VERDICT_STALE_SECONDS,
            2 * $longestGap,
            sprintf(
                'backup:verify runs %.1f hours apart at most, so one missed run leaves a verdict %.1f hours old; '
                . 'the Platform team backup card stops trusting it after %.1f hours.',
                $longestGap / 3600,
                2 * $longestGap / 3600,
                PlatformHealthService::BACKUP_VERDICT_STALE_SECONDS / 3600,
            ),
        );
    }

    /** The 09:30 run is the one the nightly-backup install and the incident notes name: keep it. */
    public function test_the_mid_morning_run_is_kept(): void
    {
        $this->assertTrue(
            (new CronExpression($this->backupVerifyExpression()))->isDue(new \DateTimeImmutable('2026-11-18 09:30:00')),
            'backup:verify must still run at 09:30, after the 02:00 nightly backup.',
        );
    }

    private function backupVerifyExpression(): string
    {
        // The schedule is registered when the console application boots.
        Artisan::call('list');

        $event = collect($this->app->make(Schedule::class)->events())->first(
            fn ($e) => is_string($e->command) && str_contains($e->command, 'backup:verify')
        );
        $this->assertNotNull($event, 'No scheduled entry found for [backup:verify].');

        return $event->expression;
    }

    /** Longest stretch, in seconds, between two consecutive runs over a week. */
    private function longestGapBetweenRuns(string $expression): int
    {
        $cron = new CronExpression($expression);
        $at = new \DateTimeImmutable('2026-11-16 00:00:00');
        $end = $at->modify('+7 days');
        $longest = 0;

        $previous = \DateTimeImmutable::createFromInterface($cron->getNextRunDate($at, 0, true));
        while ($previous < $end) {
            $next = \DateTimeImmutable::createFromInterface($cron->getNextRunDate($previous));
            $longest = max($longest, $next->getTimestamp() - $previous->getTimestamp());
            $previous = $next;
        }

        return $longest;
    }
}
