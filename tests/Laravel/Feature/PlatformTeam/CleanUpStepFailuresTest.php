<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\PlatformTeam;

use App\Services\CronJobRunner;
use App\Support\Scheduling\CleanUpStepFailures;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Four of the minute runner's clean-up jobs catch each step's error and carry
 * on, so their log says "success" when a step failed. They now note each
 * failed step (time and count only, never the error) so the Clean-up jobs
 * page can say so. Their control flow, what they delete and the circuit
 * breaker are unchanged.
 */
class CleanUpStepFailuresTest extends TestCase
{
    use DatabaseTransactions;

    private bool $breakMatchCache = false;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
    }

    protected function tearDown(): void
    {
        try {
            $this->breakMatchCache = false;
        } finally {
            parent::tearDown();
        }
    }

    public function test_a_run_counts_its_failed_steps_and_the_next_run_starts_again_from_nothing(): void
    {
        $this->assertNull(CleanUpStepFailures::lastRun('cleanup'), 'nothing noted yet');

        CleanUpStepFailures::startRun('cleanup');
        $this->assertSame(0, CleanUpStepFailures::lastRun('cleanup')['steps_failed']);

        CleanUpStepFailures::note('cleanup', 'match_cache');
        CleanUpStepFailures::note('cleanup', 'cron_logs');
        $run = CleanUpStepFailures::lastRun('cleanup');
        $this->assertSame(2, $run['steps_failed']);
        $this->assertNotNull($run['last_failed_at']);

        CleanUpStepFailures::startRun('cleanup');
        $this->assertSame(0, CleanUpStepFailures::lastRun('cleanup')['steps_failed']);
        $this->assertNull(CleanUpStepFailures::lastRun('abuse-cleanup'), 'each job has its own record');
    }

    public function test_only_times_and_counts_are_kept_never_the_error(): void
    {
        CleanUpStepFailures::startRun('cleanup');
        CleanUpStepFailures::note('cleanup', 'match_cache');

        $this->assertSame(['last_failed_at', 'steps_failed'], array_keys(CleanUpStepFailures::lastRun('cleanup')));
    }

    public function test_the_helper_never_throws(): void
    {
        Cache::shouldReceive('get')->andThrow(new \RuntimeException('cache down'));
        Cache::shouldReceive('put')->andThrow(new \RuntimeException('cache down'));
        Cache::shouldReceive('forever')->andThrow(new \RuntimeException('cache down'));

        CleanUpStepFailures::startRun('cleanup');
        CleanUpStepFailures::note('cleanup', 'match_cache');
        $this->assertNull(CleanUpStepFailures::lastRun('cleanup'));
    }

    /**
     * The real cleanup job, with one of its steps made to fail through the
     * database connection (no change to the job): the step is noted, the rest
     * of the job still runs, and the next clean run clears the count.
     */
    public function test_a_failing_step_of_the_real_cleanup_job_is_noted_and_a_clean_run_clears_it(): void
    {
        DB::connection()->beforeExecuting(function (string $sql): void {
            if ($this->breakMatchCache && str_contains($sql, 'DELETE FROM match_cache')) {
                throw new \RuntimeException('planted step failure');
            }
        });
        $ranCronLogStep = false;
        DB::listen(static function ($query) use (&$ranCronLogStep): void {
            if (str_contains($query->sql, 'DELETE FROM cron_logs')) {
                $ranCronLogStep = true;
            }
        });

        $this->breakMatchCache = true;
        $this->runCleanup();
        $this->breakMatchCache = false;

        $this->assertSame(1, CleanUpStepFailures::lastRun('cleanup')['steps_failed']);
        $this->assertTrue($ranCronLogStep, 'the steps after the failed one still ran');

        $this->runCleanup();

        $this->assertSame(0, CleanUpStepFailures::lastRun('cleanup')['steps_failed']);
    }

    private function runCleanup(): void
    {
        $runner = $this->app->make(CronJobRunner::class);
        $method = new \ReflectionMethod($runner, 'cleanupInternal');
        ob_start();
        try {
            $method->invoke($runner);
        } finally {
            ob_end_clean();
        }
    }
}
