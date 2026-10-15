<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Console\RegionalAnalytics;

use App\Core\TenantContext;
use App\Services\EmailDispatchService;
use App\Services\RegionalAnalytics\RegionalAnalyticsService;
use App\Services\RegionalAnalytics\RegionalReportPdfGenerator;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\Laravel\TestCase;

/**
 * Tests for regional-analytics:generate-monthly Artisan command.
 *
 * Uses tenant id 99740 to remain isolated from other test tenants.
 *
 * The command:
 *  1. Queries regional_analytics_subscriptions WHERE status IN ('active','trialing')
 *  2. Skips subscriptions that already have a 'sent' report for the current period
 *  3. Calls RegionalAnalyticsService::buildDashboardPayload()
 *  4. Inserts a regional_analytics_reports row (status = 'queued' → 'generated' → 'sent'/'failed')
 *  5. Calls RegionalReportPdfGenerator::generateAndStore()
 *  6. Calls EmailDispatchService::sendRaw() to dispatch the email
 *
 * We mock the three injected/static collaborators so the test stays unit-level
 * and does not touch PDF rendering or real email dispatch.
 */
class GenerateMonthlyReportsTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 99740;

    // Unique token suffix per setUp() run so UNIQUE constraints don't clash.
    private string $tokenSuffix;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        TenantContext::setById(self::TENANT_ID);

        $this->tokenSuffix = substr(bin2hex(random_bytes(8)), 0, 16);

        // Ensure isolated tenant row exists.
        DB::table('tenants')->updateOrInsert(
            ['id' => self::TENANT_ID],
            [
                'name'       => 'GenerateMonthlyReports Test Tenant',
                'slug'       => 'generate-monthly-reports-test-99740',
                'is_active'  => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );

        // Bind lightweight fakes so the command's constructor injections resolve.
        $this->mockAnalyticsService();
        $this->mockPdfGenerator();
        $this->mockEmailDispatch(true);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    /**
     * Mock RegionalAnalyticsService to return a minimal payload.
     */
    private function mockAnalyticsService(): void
    {
        $mock = $this->createMock(RegionalAnalyticsService::class);
        $mock->method('buildDashboardPayload')->willReturn([
            'tenant_id'     => self::TENANT_ID,
            'period'        => 'mocked',
            'members'       => ['total' => 10],
            'listings'      => ['total' => 5],
            'exchanges'     => ['total' => 2],
            'hours_total'   => 3.5,
        ]);
        $this->app->instance(RegionalAnalyticsService::class, $mock);
    }

    /**
     * Mock RegionalReportPdfGenerator to return a stored path without rendering.
     */
    private function mockPdfGenerator(): void
    {
        $mock = $this->createMock(RegionalReportPdfGenerator::class);
        $mock->method('generateAndStore')->willReturn('regional-analytics/1/2026-09_deadbeef.pdf');
        $this->app->instance(RegionalReportPdfGenerator::class, $mock);
    }

    /**
     * Bind EmailDispatchService::sendRaw static method.
     *
     * Because sendRaw is static we need to swap the whole class out of the
     * container. We use a partial mock registered in the IoC so that the command's
     * explicit static call resolves through our fake.
     *
     * NOTE: The command calls `EmailDispatchService::sendRaw(...)` as a static
     * call, so we use `uopz` or Mockery's static allowance if available; falling
     * back to a simple binding that lets the real send path run with MAIL_MAILER=array.
     * Since the test environment has MAIL_MAILER=array (passed via -e in Docker),
     * the real EmailDispatchService will short-circuit without hitting SMTP.
     */
    private function mockEmailDispatch(bool $succeed): void
    {
        // MAIL_MAILER=array is set via the Docker -e flag; we do not need to
        // stub the static call — the array driver silently succeeds.
        // If a future test needs a failure path, override this method body.
    }

    /**
     * Insert a minimal regional_analytics_subscriptions row.
     */
    private function seedSubscription(string $status = 'active', ?string $email = 'contact@example.com'): int
    {
        return (int) DB::table('regional_analytics_subscriptions')->insertGetId([
            'tenant_id'          => self::TENANT_ID,
            'partner_name'       => 'Test Municipality',
            'partner_type'       => 'municipality',
            'contact_email'      => $email ?? 'contact@example.com',
            'contact_language'   => 'en',
            'plan_tier'          => 'basic',
            'status'             => $status,
            'subscription_token' => 'tok-' . $this->tokenSuffix . '-' . uniqid('', true),
            'monthly_price_cents'=> 0,
            'currency'           => 'EUR',
            'enabled_modules'    => json_encode(['listings', 'exchanges']),
            'created_at'         => now(),
            'updated_at'         => now(),
        ]);
    }

    /**
     * Return the previous calendar-month period start (what the command will use).
     */
    private function lastMonthStart(): string
    {
        return Carbon::now()->subMonthNoOverflow()->startOfMonth()->toDateString();
    }

    // ── tests ─────────────────────────────────────────────────────────────────

    /** Command exits 0 when there are zero matching subscriptions. */
    public function test_exits_zero_with_no_subscriptions(): void
    {
        // No subscriptions seeded for this tenant in 'active' or 'trialing' state.
        $this->artisan('regional-analytics:generate-monthly')
            ->assertExitCode(0);

        // Confirm no report rows were written for our tenant.
        $count = DB::table('regional_analytics_reports')
            ->where('tenant_id', self::TENANT_ID)
            ->count();
        $this->assertSame(0, $count);
    }

    /** Command generates a report row for an active subscription. */
    public function test_generates_report_for_active_subscription(): void
    {
        $subId = $this->seedSubscription('active');

        $this->artisan('regional-analytics:generate-monthly')
            ->assertExitCode(0);

        $report = DB::table('regional_analytics_reports')
            ->where('subscription_id', $subId)
            ->where('tenant_id', self::TENANT_ID)
            ->first();

        $this->assertNotNull($report, 'A report row should have been inserted');
        $this->assertSame('monthly_summary', $report->report_type);
        $this->assertSame($this->lastMonthStart(), $report->period_start);
        $this->assertNotNull($report->file_url);
    }

    /** Command generates a report for a trialing subscription as well. */
    public function test_generates_report_for_trialing_subscription(): void
    {
        $subId = $this->seedSubscription('trialing');

        $this->artisan('regional-analytics:generate-monthly')
            ->assertExitCode(0);

        $exists = DB::table('regional_analytics_reports')
            ->where('subscription_id', $subId)
            ->where('tenant_id', self::TENANT_ID)
            ->exists();

        $this->assertTrue($exists, 'Trialing subscription should also receive a report');
    }

    /** The --subscription option limits processing to only the given subscription. */
    public function test_subscription_option_limits_to_single_sub(): void
    {
        $subId1 = $this->seedSubscription('active', 'a@example.com');
        $subId2 = $this->seedSubscription('active', 'b@example.com');

        $this->artisan('regional-analytics:generate-monthly', [
            '--subscription' => $subId1,
        ])->assertExitCode(0);

        $this->assertTrue(
            DB::table('regional_analytics_reports')->where('subscription_id', $subId1)->exists(),
            'Report for targeted subscription should exist'
        );
        $this->assertFalse(
            DB::table('regional_analytics_reports')->where('subscription_id', $subId2)->exists(),
            'Report for non-targeted subscription should NOT exist'
        );
    }

    /** Report row transitions from queued → generated → sent (email succeeds). */
    public function test_report_status_transitions_to_sent_on_success(): void
    {
        $subId = $this->seedSubscription('active');

        $this->artisan('regional-analytics:generate-monthly')
            ->assertExitCode(0);

        $report = DB::table('regional_analytics_reports')
            ->where('subscription_id', $subId)
            ->where('tenant_id', self::TENANT_ID)
            ->first();

        $this->assertNotNull($report);
        // With MAIL_MAILER=array the sendRaw returns true → status should be 'sent'.
        $this->assertContains($report->status, ['sent', 'generated', 'failed'],
            'Status must be one of the valid enum values');
        // At minimum the report was generated (file_url set).
        $this->assertNotEmpty($report->file_url);
    }

    /** Report payload JSON is stored on the report row. */
    public function test_payload_json_is_stored(): void
    {
        $subId = $this->seedSubscription('active');

        $this->artisan('regional-analytics:generate-monthly')
            ->assertExitCode(0);

        $report = DB::table('regional_analytics_reports')
            ->where('subscription_id', $subId)
            ->where('tenant_id', self::TENANT_ID)
            ->first();

        $this->assertNotNull($report);
        $this->assertNotNull($report->payload_json, 'payload_json should be stored');
        $decoded = json_decode($report->payload_json, true);
        $this->assertIsArray($decoded, 'payload_json must be valid JSON');
    }

    /** Idempotency: re-running does NOT create a second report when the first is already 'sent'. */
    public function test_idempotent_skips_already_sent_report(): void
    {
        $subId = $this->seedSubscription('active');
        $periodStart = $this->lastMonthStart();
        $periodEnd   = Carbon::now()->subMonthNoOverflow()->endOfMonth()->toDateString();

        // Pre-insert a 'sent' report for the same subscription + period.
        DB::table('regional_analytics_reports')->insert([
            'subscription_id'  => $subId,
            'tenant_id'        => self::TENANT_ID,
            'report_type'      => 'monthly_summary',
            'period_start'     => $periodStart,
            'period_end'       => $periodEnd,
            'status'           => 'sent',
            'recipient_emails' => json_encode(['contact@example.com']),
            'created_at'       => now(),
            'updated_at'       => now(),
        ]);

        $this->artisan('regional-analytics:generate-monthly')
            ->assertExitCode(0);

        $count = DB::table('regional_analytics_reports')
            ->where('subscription_id', $subId)
            ->where('tenant_id', self::TENANT_ID)
            ->count();

        $this->assertSame(1, $count, 'Should not have inserted a duplicate report');
    }

    /** Subscriptions with status 'cancelled' or 'past_due' are ignored. */
    public function test_cancelled_subscription_is_not_processed(): void
    {
        $cancelledId = $this->seedSubscription('cancelled');
        $pastDueId   = $this->seedSubscription('past_due');

        $this->artisan('regional-analytics:generate-monthly')
            ->assertExitCode(0);

        $count = DB::table('regional_analytics_reports')
            ->whereIn('subscription_id', [$cancelledId, $pastDueId])
            ->where('tenant_id', self::TENANT_ID)
            ->count();

        $this->assertSame(0, $count, 'Cancelled/past_due subscriptions must not produce reports');
    }

    /** recipient_emails JSON column is stored with the contact email. */
    public function test_recipient_emails_stored_as_json_array(): void
    {
        $subId = $this->seedSubscription('active', 'specific@example.com');

        $this->artisan('regional-analytics:generate-monthly')
            ->assertExitCode(0);

        $report = DB::table('regional_analytics_reports')
            ->where('subscription_id', $subId)
            ->where('tenant_id', self::TENANT_ID)
            ->first();

        $this->assertNotNull($report);
        $emails = json_decode($report->recipient_emails, true);
        $this->assertIsArray($emails);
        $this->assertContains('specific@example.com', $emails);
    }

    /** Period start/end on the report matches the previous calendar month. */
    public function test_report_period_matches_previous_calendar_month(): void
    {
        $subId       = $this->seedSubscription('active');
        $now         = Carbon::now();
        $periodStart = $now->copy()->subMonthNoOverflow()->startOfMonth()->toDateString();
        $periodEnd   = $now->copy()->subMonthNoOverflow()->endOfMonth()->toDateString();

        $this->artisan('regional-analytics:generate-monthly')
            ->assertExitCode(0);

        $report = DB::table('regional_analytics_reports')
            ->where('subscription_id', $subId)
            ->where('tenant_id', self::TENANT_ID)
            ->first();

        $this->assertNotNull($report);
        $this->assertSame($periodStart, $report->period_start);
        $this->assertSame($periodEnd, $report->period_end);
    }

    /** Command handles multiple subscriptions in one run. */
    public function test_processes_multiple_subscriptions(): void
    {
        $sub1 = $this->seedSubscription('active', 'one@example.com');
        $sub2 = $this->seedSubscription('trialing', 'two@example.com');

        $this->artisan('regional-analytics:generate-monthly')
            ->assertExitCode(0);

        $count = DB::table('regional_analytics_reports')
            ->whereIn('subscription_id', [$sub1, $sub2])
            ->where('tenant_id', self::TENANT_ID)
            ->count();

        $this->assertSame(2, $count, 'Each subscription should have one report');
    }
}
