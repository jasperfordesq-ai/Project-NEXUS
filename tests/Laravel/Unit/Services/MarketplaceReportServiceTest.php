<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Services\MarketplaceReportService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

class MarketplaceReportServiceTest extends TestCase
{
    use DatabaseTransactions;

    public function test_createReport_throws_when_listing_not_found(): void
    {
        TenantContext::setById($this->testTenantId);

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage("We can't find that item. It may have been removed.");

        MarketplaceReportService::createReport(1, 999, [
            'reason' => 'spam',
            'description' => 'test',
        ]);
    }

    public function test_createReport_throws_on_duplicate_active_report(): void
    {
        TenantContext::setById($this->testTenantId);

        $sellerId = DB::table('users')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'Marketplace Seller',
            'email' => 'marketplace-seller@example.test',
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $reporterId = DB::table('users')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'Marketplace Reporter',
            'email' => 'marketplace-reporter@example.test',
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $listingId = DB::table('marketplace_listings')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $sellerId,
            'title' => 'Audit Listing',
            'description' => 'Audit listing description',
            'status' => 'active',
            'moderation_status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('marketplace_reports')->insert([
            'tenant_id' => $this->testTenantId,
            'marketplace_listing_id' => $listingId,
            'reporter_id' => $reporterId,
            'reason' => 'other',
            'description' => 'Existing active report',
            'status' => 'received',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        try {
            MarketplaceReportService::createReport($reporterId, $listingId, [
                'reason' => 'other',
                'description' => 'test',
            ]);
            $this->fail('Duplicate active report must be rejected.');
        } catch (\InvalidArgumentException $exception) {
            $this->assertSame('You already have an active report for this listing.', $exception->getMessage());
        }

        $this->assertSame(1, DB::table('marketplace_reports')
            ->where('tenant_id', $this->testTenantId)
            ->where('marketplace_listing_id', $listingId)
            ->where('reporter_id', $reporterId)
            ->count());
    }

    public function test_report_bell_is_rendered_in_the_reporter_preferred_locale(): void
    {
        TenantContext::setById($this->testTenantId);

        $reporterId = DB::table('users')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'Marketplace Reporter',
            'email' => '',
            'role' => 'member',
            'status' => 'active',
            'preferred_language' => 'de',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        app('translator')->addLines([
            'emails_misc.marketplace_report.received_body' => 'Lokalisierte Berichtsmeldung',
        ], 'de');
        app()->setLocale('en');

        // Keep the focused locale regression isolated from delivery providers.
        // The real report bell renderer and Notification model still execute.
        $reportLink = '/marketplace/reports/42';
        Cache::put(
            'push_dedup:' . $reporterId . ':marketplace_report_received:' . md5($reportLink),
            1,
            now()->addMinute()
        );

        $renderer = new \ReflectionMethod(MarketplaceReportService::class, 'sendReportBell');
        $sent = $renderer->invoke(null, $reporterId, 'received', [
            'body_key' => 'emails_misc.marketplace_report.received_body',
            'body_params' => [],
            'link' => $reportLink,
        ]);

        $message = DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $reporterId)
            ->where('type', 'marketplace_report_received')
            ->value('message');

        $this->assertTrue($sent);
        $this->assertSame('Lokalisierte Berichtsmeldung', $message);
        $this->assertSame('en', app()->getLocale());
    }

    public function test_acknowledgeReport_throws_when_status_invalid(): void
    {
        TenantContext::setById($this->testTenantId);
        [$reportId] = $this->createReportFixture('appeal_resolved');

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('This report cannot be acknowledged in its current state.');

        MarketplaceReportService::acknowledgeReport($reportId, 5);
    }

    public function test_resolveReport_throws_when_status_not_pending(): void
    {
        TenantContext::setById($this->testTenantId);
        [$reportId] = $this->createReportFixture('appeal_resolved');

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('This report cannot be resolved in its current state.');

        MarketplaceReportService::resolveReport($reportId, 5, [
            'action_taken' => 'none',
            'resolution_reason' => 'ok',
        ]);
    }

    public function test_appealReport_throws_when_user_is_neither_reporter_nor_seller(): void
    {
        TenantContext::setById($this->testTenantId);
        [$reportId] = $this->createReportFixture('action_taken');
        $otherUserId = DB::table('users')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'Unrelated report viewer',
            'email' => 'marketplace-report-other-' . uniqid() . '@example.test',
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->expectException(\Illuminate\Auth\Access\AuthorizationException::class);
        $this->expectExceptionMessage('You do not have permission to access this report.');

        MarketplaceReportService::appealReport($reportId, $otherUserId, 'I disagree');
    }

    public function test_appealReport_throws_when_not_resolved_yet(): void
    {
        TenantContext::setById($this->testTenantId);
        [$reportId, $reporterId] = $this->createReportFixture('under_review');

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('This report cannot be appealed in its current state.');

        MarketplaceReportService::appealReport($reportId, $reporterId, 'appeal');
    }

    public function test_resolveAppeal_throws_when_not_appealed(): void
    {
        TenantContext::setById($this->testTenantId);
        [$reportId] = $this->createReportFixture('action_taken');

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('This report does not have an active appeal.');

        MarketplaceReportService::resolveAppeal($reportId, 5, [
            'action_taken' => 'none',
            'resolution_reason' => 'appeal rejected',
        ]);
    }

    /** @return array{int,int,int} */
    private function createReportFixture(string $status): array
    {
        $suffix = uniqid('', true);
        $sellerId = DB::table('users')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'Marketplace report seller',
            'email' => "marketplace-report-seller-{$suffix}@example.test",
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $reporterId = DB::table('users')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'Marketplace report reporter',
            'email' => "marketplace-report-reporter-{$suffix}@example.test",
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $listingId = DB::table('marketplace_listings')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $sellerId,
            'title' => 'Marketplace report fixture',
            'description' => 'Marketplace report fixture description',
            'status' => 'active',
            'moderation_status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $reportId = DB::table('marketplace_reports')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'marketplace_listing_id' => $listingId,
            'reporter_id' => $reporterId,
            'reason' => 'other',
            'description' => 'Marketplace report fixture',
            'status' => $status,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return [$reportId, $reporterId, $sellerId];
    }
}
