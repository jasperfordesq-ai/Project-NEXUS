<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\RegionalAnalytics;

use App\Core\TenantContext;
use App\Models\Tenant;
use App\Services\RegionalAnalytics\RegionalAnalyticsService;
use App\Services\RegionalAnalytics\RegionalReportDownloadLink;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\Laravel\Support\CapturedEmailLinks;
use Tests\Laravel\TestCase;

/**
 * Email-links audit 2026-10-14, finding F3: the monthly regional analytics
 * report email carried a site-relative "/storage/..." path to a file on the
 * PRIVATE local disk, so the link could never be opened. The email must now
 * carry a signed, expiring API address that streams the stored PDF, scoped to
 * the subscription's own community.
 */
class ReportDownloadLinkTest extends TestCase
{
    use DatabaseTransactions;

    private int $tenantId;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        config()->set('app.url', 'https://api.example.test');

        $this->tenantId = (int) Tenant::factory()->create([
            'slug' => 'regional-' . bin2hex(random_bytes(4)),
            'is_active' => true,
        ])->id;

        $analytics = $this->createMock(RegionalAnalyticsService::class);
        $analytics->method('buildDashboardPayload')->willReturn([
            'generated_at' => now()->toIso8601String(),
            'engagement' => ['active_members_bucket' => '50-200'],
        ]);
        $this->app->instance(RegionalAnalyticsService::class, $analytics);
    }

    protected function tearDown(): void
    {
        TenantContext::reset();
        parent::tearDown();
    }

    private function seedSubscription(string $status = 'active', ?int $tenantId = null): int
    {
        return (int) DB::table('regional_analytics_subscriptions')->insertGetId([
            'tenant_id' => $tenantId ?? $this->tenantId,
            'partner_name' => 'Download Link Partner',
            'partner_type' => 'municipality',
            'contact_email' => 'partner-' . bin2hex(random_bytes(4)) . '@example.test',
            'contact_language' => 'en',
            'plan_tier' => 'basic',
            'status' => $status,
            'subscription_token' => 'tok-' . bin2hex(random_bytes(16)),
            'monthly_price_cents' => 0,
            'currency' => 'EUR',
            'enabled_modules' => json_encode(['listings']),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** Run the monthly command for one subscription and return the single link in the email it sent. */
    private function emailedLink(int $subscriptionId): string
    {
        $captured = CapturedEmailLinks::install();
        $this->artisan('regional-analytics:generate-monthly', ['--subscription' => $subscriptionId])->assertExitCode(0);

        $this->assertCount(1, $captured->sent, 'exactly one report email should have been sent');
        $links = $captured->links();
        $this->assertCount(1, $links, 'the report email should carry exactly one link');

        return $links[0];
    }

    public function test_emailed_link_is_a_signed_api_address_that_returns_the_pdf(): void
    {
        $subscriptionId = $this->seedSubscription();

        $link = $this->emailedLink($subscriptionId);

        $this->assertStringStartsWith('https://api.example.test/api/v2/regional-analytics/reports/', $link);

        $response = $this->get($link);

        $response->assertOk();
        $response->assertHeader('Content-Type', 'application/pdf');
        $this->assertStringStartsWith('%PDF-', $response->streamedContent());
    }

    public function test_report_row_stores_the_file_path_not_an_address(): void
    {
        $subscriptionId = $this->seedSubscription();

        $this->emailedLink($subscriptionId);

        $report = DB::table('regional_analytics_reports')->where('subscription_id', $subscriptionId)->first();
        $this->assertNotNull($report);
        $this->assertStringStartsWith('regional-analytics/', (string) $report->file_url);
        Storage::disk('local')->assertExists((string) $report->file_url);
    }

    public function test_tampered_signature_is_refused(): void
    {
        $link = $this->emailedLink($this->seedSubscription());

        $tampered = substr($link, 0, -4) . (substr($link, -4) === 'aaaa' ? 'bbbb' : 'aaaa');

        $this->get($tampered)->assertNotFound();
    }

    public function test_expired_link_is_refused(): void
    {
        $link = $this->emailedLink($this->seedSubscription());

        Carbon::setTestNow(now()->addDays(RegionalReportDownloadLink::VALID_DAYS)->addMinute());
        try {
            $this->get($link)->assertStatus(410);
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_link_for_a_cancelled_subscription_is_refused(): void
    {
        $subscriptionId = $this->seedSubscription();
        $link = $this->emailedLink($subscriptionId);

        DB::table('regional_analytics_subscriptions')->where('id', $subscriptionId)->update(['status' => 'cancelled']);

        $this->get($link)->assertNotFound();
    }

    public function test_report_whose_community_differs_from_its_subscription_is_refused(): void
    {
        $subscriptionId = $this->seedSubscription();
        $link = $this->emailedLink($subscriptionId);

        $otherTenant = (int) Tenant::factory()->create(['slug' => 'other-' . bin2hex(random_bytes(4)), 'is_active' => true])->id;
        DB::table('regional_analytics_reports')->where('subscription_id', $subscriptionId)->update(['tenant_id' => $otherTenant]);

        $this->get($link)->assertNotFound();
    }

    public function test_signed_address_for_an_unknown_report_is_refused(): void
    {
        $this->get(RegionalReportDownloadLink::forReport(987654321))->assertNotFound();
    }
}
