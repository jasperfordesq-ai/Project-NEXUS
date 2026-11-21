<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Services\BillingAutomationService;
use App\Support\Billing\BillingLock;
use App\Support\Billing\BillingSettings;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * The daily billing check as a command (audit of 21 November 2026, G5).
 *
 * It was a closure in the scheduler: it could not be run by hand, kept no
 * record of having run, and told nobody when it failed.
 */
final class BillingApplyStandingCommandTest extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        BillingLock::flush();
        Cache::forget(BillingSettings::CACHE_KEY);
        DB::table('platform_billing_settings')->whereIn('setting_key', ['last_run_at', 'last_run_result', 'last_run_actions'])->delete();
    }

    protected function tearDown(): void
    {
        try {
            Cache::forget(BillingSettings::CACHE_KEY);
            BillingLock::flush();
        } finally {
            parent::tearDown();
        }
    }

    public function test_it_has_never_run_until_it_runs(): void
    {
        $this->assertNull(BillingAutomationService::lastRun());

        $this->actAsPlatformTeam();
        $this->apiGet('/v2/admin/super/billing/standing/last-run')
            ->assertOk()
            ->assertJsonPath('data.at', null);
    }

    public function test_a_dry_run_changes_nothing_and_leaves_no_record(): void
    {
        $this->artisan('billing:apply-standing', ['--dry-run' => true])
            ->expectsOutputToContain('Dry run')
            ->assertExitCode(0);

        $this->assertNull(BillingAutomationService::lastRun(), 'only a real run is recorded');
    }

    public function test_run_while_switched_off_it_does_nothing_and_says_so_in_the_record(): void
    {
        BillingSettings::set('automation_enabled', false, null);

        $this->artisan('billing:apply-standing')
            ->expectsOutputToContain('switched off')
            ->assertExitCode(0);

        $last = BillingAutomationService::lastRun();
        $this->assertNotNull($last);
        $this->assertSame('off', $last['result']);
        $this->assertSame(0, $last['actions']);
    }

    public function test_a_real_run_is_recorded_and_the_platform_team_can_read_when(): void
    {
        BillingSettings::set('automation_enabled', true, null);

        $this->artisan('billing:apply-standing')->assertExitCode(0);

        $last = BillingAutomationService::lastRun();
        $this->assertNotNull($last);
        $this->assertSame('ok', $last['result']);
        $this->assertMatchesRegularExpression('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/', $last['at']);

        $this->actAsPlatformTeam();
        $response = $this->apiGet('/v2/admin/super/billing/standing/last-run')->assertOk();
        $this->assertSame(['at', 'result', 'actions'], array_keys($response->json('data')));
        $response->assertJsonPath('data.result', 'ok');

        // The record is not a setting: the settings list is unchanged by it.
        Cache::forget(BillingSettings::CACHE_KEY);
        $this->assertSame(array_keys(BillingSettings::DEFAULTS), array_keys(BillingSettings::all()));
    }

    public function test_the_scheduler_runs_the_command(): void
    {
        // The schedule is only built for a real console run, so the wiring is
        // read from the file that declares it: the 08:00 check is the
        // command, and the old closure that called the service directly
        // (no record, no error on failure) is gone.
        $schedule = (string) file_get_contents(base_path('bootstrap/app.php'));

        $this->assertSame(1, substr_count($schedule, "\$schedule->command('billing:apply-standing')"));
        $this->assertStringNotContainsString('BillingAutomationService::run()', $schedule);
    }
}
