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

    /**
     * A run that stops with an error does none of what was due after that
     * point. It was logged and shown on the Automatic checks card, and no
     * person was told.
     */
    public function test_a_run_that_fails_is_recorded_and_the_platform_team_is_emailed(): void
    {
        BillingSettings::set('automation_enabled', true, null);
        $teamEmail = 'check.failed.' . bin2hex(random_bytes(5)) . '@example.com';
        \App\Models\User::factory()->forTenant(1)->create([
            'email' => $teamEmail, 'status' => 'active', 'is_approved' => true,
            'is_god' => true, 'is_super_admin' => true, 'preferred_language' => 'en',
        ]);
        $mailer = new class extends \App\Services\EmailDispatchService {
            /** @var array<int, array{to: string, subject: string, body: string}> */
            public array $calls = [];

            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                $this->calls[] = compact('to', 'subject', 'body');

                return true;
            }
        };
        app()->instance(\App\Services\EmailDispatchService::class, $mailer);

        // The run's own first look at the communities fails, once.
        $failing = true;
        DB::connection()->beforeExecuting(static function (string $sql) use (&$failing): void {
            if ($failing && stripos($sql, 'tenants') !== false && stripos(ltrim($sql), 'select') === 0) {
                $failing = false;
                throw new \RuntimeException('The database went away in this test');
            }
        });

        try {
            $this->artisan('billing:apply-standing')->assertExitCode(1);
        } finally {
            $failing = false;
        }

        $this->assertSame('failed', BillingAutomationService::lastRun()['result'] ?? null);
        $mine = array_values(array_filter($mailer->calls, static fn (array $c): bool => $c['to'] === $teamEmail));
        $this->assertCount(1, $mine, 'the platform team is told');
        $this->assertSame('The daily billing check did not finish', $mine[0]['subject']);
        $this->assertStringContainsString('stopped with an error', $mine[0]['body']);
    }

    /**
     * The check carries on past a community it cannot check, so the others
     * are not left unreminded. It then said "ok": the run was recorded as a
     * success, exited 0 and told nobody, while that community had none of what
     * was due done. A run in which any community failed is a failed run.
     */
    public function test_a_run_in_which_one_community_could_not_be_checked_is_a_failed_run(): void
    {
        BillingSettings::set('automation_enabled', true, null);
        $teamEmail = 'one.failed.' . bin2hex(random_bytes(5)) . '@example.com';
        \App\Models\User::factory()->forTenant(1)->create([
            'email' => $teamEmail, 'status' => 'active', 'is_approved' => true,
            'is_god' => true, 'is_super_admin' => true, 'preferred_language' => 'en',
        ]);
        $mailer = new class extends \App\Services\EmailDispatchService {
            /** @var array<int, array{to: string, subject: string, body: string}> */
            public array $calls = [];

            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                $this->calls[] = compact('to', 'subject', 'body');

                return true;
            }
        };
        app()->instance(\App\Services\EmailDispatchService::class, $mailer);

        $broken = $this->communityWithADate('Cannot be checked');
        $fine = $this->communityWithADate('Checked as usual');

        // Every read of the broken community's own billing row fails.
        $failing = true;
        DB::connection()->beforeExecuting(static function (string $sql, array $bindings) use (&$failing, $broken): void {
            if ($failing
                && stripos(ltrim($sql), 'select') === 0
                && stripos($sql, 'tenant_billing_standing') !== false
                && in_array($broken, $bindings, true)
            ) {
                throw new \RuntimeException('This community cannot be read in this test');
            }
        });

        try {
            $this->artisan('billing:apply-standing')->assertExitCode(1);
        } finally {
            $failing = false;
        }

        $failures = BillingAutomationService::failures();
        $this->assertSame([$broken], array_column($failures, 'tenant_id'), 'only the broken community is reported, and the run went on to the others');
        $this->assertNotContains($fine, array_column($failures, 'tenant_id'));

        $this->assertSame('failed', BillingAutomationService::lastRun()['result'] ?? null, 'not "ok": something due was not done');
        $mine = array_values(array_filter($mailer->calls, static fn (array $c): bool => $c['to'] === $teamEmail));
        $this->assertCount(1, $mine, 'the platform team is told');
        $this->assertSame('The daily billing check did not finish', $mine[0]['subject']);
    }

    public function test_a_run_with_no_failures_reports_none(): void
    {
        BillingSettings::set('automation_enabled', true, null);
        $this->communityWithADate('Checked as usual');

        $this->artisan('billing:apply-standing')->assertExitCode(0);

        $this->assertSame([], BillingAutomationService::failures());
        $this->assertSame('ok', BillingAutomationService::lastRun()['result'] ?? null);
    }

    /** A community the daily check visits: it has a paid-until date, well in the future. */
    private function communityWithADate(string $name): int
    {
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => $name . ' ' . bin2hex(random_bytes(3)),
            'slug' => 'apply-' . bin2hex(random_bytes(5)),
            'is_active' => 1, 'parent_id' => 1, 'depth' => 1,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $id)->update(['path' => "/1/{$id}/"]);
        DB::table('tenant_billing_standing')->insert([
            'tenant_id' => $id, 'paid_until' => now()->addDays(200)->toDateString(),
            'created_at' => now(), 'updated_at' => now(),
        ]);

        return $id;
    }

    public function test_a_run_that_succeeds_emails_nobody_about_a_failure(): void
    {
        BillingSettings::set('automation_enabled', true, null);
        $mailer = new class extends \App\Services\EmailDispatchService {
            /** @var list<string> */
            public array $subjects = [];

            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                $this->subjects[] = $subject;

                return true;
            }
        };
        app()->instance(\App\Services\EmailDispatchService::class, $mailer);

        $this->artisan('billing:apply-standing')->assertExitCode(0);

        $this->assertNotContains('The daily billing check did not finish', $mailer->subjects);
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
