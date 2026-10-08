<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Wallet;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\AdminAnalyticsService;
use App\Services\ExploreService;
use App\Services\HoursReportService;
use App\Services\MemberReportService;
use App\Services\MunicipalImpactReportService;
use App\Services\ReportExportService;
use App\Services\ReviewService;
use App\Services\SocialValueService;
use App\Support\Wallet\OpeningBalance;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Hours a member brought from another timebank were exchanged elsewhere.
 * Every "hours exchanged" / impact / funnel / review figure must ignore them,
 * while existing starting_balance handling stays exactly as it was.
 *
 * Each test records a figure, imports a 40-hour member, and asserts the figure
 * has not moved. Several figures are cached, so the cache is flushed before
 * every read.
 */
final class OpeningBalanceIsNotAnExchangeTest extends TestCase
{
    use DatabaseTransactions;

    private const IMPORTED_HOURS = '40.00';

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
    }

    /** A fresh member with a 40-hour opening balance (sender_id 0, like starting_balance). */
    private function importFortyHours(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'last_login_at' => now(),
            'email_verified_at' => null,
            'bio' => null,
            'location' => null,
        ]);
        DB::table('transactions')->insert([
            'tenant_id' => $this->testTenantId, 'sender_id' => 0, 'receiver_id' => $user->id,
            'amount' => self::IMPORTED_HOURS, 'description' => OpeningBalance::describe('TEST0001', null),
            'status' => 'completed', 'transaction_type' => OpeningBalance::TYPE,
            'created_at' => now(), 'updated_at' => now(),
        ]);

        return $user;
    }

    /**
     * Read a figure with a cold cache, import the member, read it again with a
     * cold cache, and assert it did not move. The "before" read happens first
     * so the member does not exist yet.
     *
     * @param callable(): mixed $figure
     */
    private function assertFigureUnchangedByImport(callable $figure, string $label): User
    {
        Cache::flush();
        $before = $figure();
        $user = $this->importFortyHours();
        Cache::flush();
        $this->assertEquals($before, $figure(), $label . ' counted imported hours as exchanged');

        return $user;
    }

    private function makeAdmin(): User
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        return $admin;
    }

    // ------------------------------------------------------------------
    // Exclusion lists
    // ------------------------------------------------------------------

    public function test_social_value_constant_excludes_opening_balances_and_keeps_starting_balance(): void
    {
        $this->assertContains(OpeningBalance::TYPE, SocialValueService::EXCLUDED_TRANSACTION_TYPES);
        $this->assertContains('starting_balance', SocialValueService::EXCLUDED_TRANSACTION_TYPES);
        $this->assertStringContainsString(
            "'" . OpeningBalance::TYPE . "'",
            SocialValueService::transactionTypeExclusionSql('t.')
        );
    }

    public function test_social_value_sroi_hours_are_unchanged(): void
    {
        $service = app(SocialValueService::class);
        $this->assertFigureUnchangedByImport(function () use ($service) {
            $summary = $service->calculateSROI($this->testTenantId)['summary'];

            return [$summary['total_hours'], $summary['total_transactions'], $summary['direct_value']];
        }, 'SocialValueService::calculateSROI');
    }

    // ------------------------------------------------------------------
    // HoursReportService
    // ------------------------------------------------------------------

    public function test_hours_report_summary_is_unchanged(): void
    {
        $service = app(HoursReportService::class);
        $this->assertFigureUnchangedByImport(function () use ($service) {
            $s = $service->getHoursSummary($this->testTenantId);

            return [
                $s['total_hours'], $s['total_transactions'], $s['avg_hours_per_transaction'],
                $s['max_single_transaction'], $s['unique_receivers'], $s['participation_rate'],
                $s['this_month'], $s['last_month'],
            ];
        }, 'HoursReportService::getHoursSummary');
    }

    public function test_hours_report_by_period_is_unchanged(): void
    {
        $service = app(HoursReportService::class);
        $this->assertFigureUnchangedByImport(
            fn () => $service->getHoursByPeriod($this->testTenantId),
            'HoursReportService::getHoursByPeriod'
        );
    }

    public function test_hours_report_by_category_is_unchanged(): void
    {
        $service = app(HoursReportService::class);
        $this->assertFigureUnchangedByImport(
            fn () => $service->getHoursByCategory($this->testTenantId),
            'HoursReportService::getHoursByCategory'
        );
    }

    public function test_hours_report_by_member_does_not_list_the_imported_member(): void
    {
        $service = app(HoursReportService::class);
        $user = $this->importFortyHours();

        $members = $service->getHoursByMember($this->testTenantId, [], 'total', 200, 0);
        $ids = array_column($members['data'], 'user_id');

        $this->assertNotContains($user->id, $ids);
    }

    // ------------------------------------------------------------------
    // Public "hours exchanged" on the Explore page (getCommunityStats,
    // reached through the public getExploreData method)
    // ------------------------------------------------------------------

    public function test_public_explore_hours_exchanged_is_unchanged(): void
    {
        $viewer = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $service = app(ExploreService::class);

        $this->assertFigureUnchangedByImport(function () use ($service, $viewer) {
            $stats = $service->getExploreData($viewer->id)['community_stats'];

            return [$stats['hours_exchanged'], $stats['exchanges_this_month']];
        }, 'ExploreService community_stats');
    }

    // ------------------------------------------------------------------
    // Admin timebanking (GET /v2/admin/timebanking/stats and /user-report)
    // ------------------------------------------------------------------

    public function test_admin_timebanking_stats_are_unchanged(): void
    {
        $this->makeAdmin();
        $imported = null;

        Cache::flush();
        $before = $this->apiGet('/v2/admin/timebanking/stats')->assertOk()->json('data');
        $imported = $this->importFortyHours();
        Cache::flush();
        $after = $this->apiGet('/v2/admin/timebanking/stats')->assertOk()->json('data');

        $this->assertEquals($before['total_volume'], $after['total_volume']);
        $this->assertEquals($before['total_transactions'], $after['total_transactions']);
        $this->assertEquals($before['avg_transaction'], $after['avg_transaction']);
        $this->assertEquals($before['top_earners'], $after['top_earners']);
        $this->assertNotContains($imported->id, array_column($after['top_earners'], 'user_id'));
    }

    public function test_admin_timebanking_user_report_shows_no_earned_hours_for_the_imported_member(): void
    {
        $this->makeAdmin();
        $imported = $this->importFortyHours();

        $rows = $this->apiGet('/v2/admin/timebanking/user-report?search=' . urlencode((string) $imported->email))
            ->assertOk()->json('data');
        $row = collect($rows)->firstWhere('id', $imported->id);

        $this->assertNotNull($row, 'imported member should still be listed in the user report');
        $this->assertEquals(0, $row['total_earned']);
        $this->assertSame(0, $row['transaction_count']);
    }

    // ------------------------------------------------------------------
    // AdminAnalyticsService
    // ------------------------------------------------------------------

    public function test_admin_analytics_overall_stats_are_unchanged(): void
    {
        $service = app(AdminAnalyticsService::class);
        $this->assertFigureUnchangedByImport(function () use ($service) {
            $s = $service->getOverallStats();

            return [
                $s['transaction_volume_30d'], $s['transaction_count_30d'],
                $s['active_traders_30d'], $s['avg_transaction_size'],
            ];
        }, 'AdminAnalyticsService::getOverallStats');
    }

    public function test_admin_analytics_dashboard_is_unchanged(): void
    {
        $service = app(AdminAnalyticsService::class);
        $this->assertFigureUnchangedByImport(function () use ($service) {
            $d = $service->getDashboard($this->testTenantId);

            return [$d['transaction_volume_30d'], $d['transaction_count_30d'], $d['avg_transaction_size']];
        }, 'AdminAnalyticsService::getDashboard');
    }

    public function test_admin_analytics_trends_and_top_lists_are_unchanged(): void
    {
        $service = app(AdminAnalyticsService::class);
        $this->assertFigureUnchangedByImport(fn () => $service->getMonthlyTrends(), 'getMonthlyTrends');
        $this->assertFigureUnchangedByImport(fn () => $service->getWeeklyTrends(), 'getWeeklyTrends');
        $imported = $this->assertFigureUnchangedByImport(fn () => $service->getTopEarners(30, 10), 'getTopEarners');
        $this->assertNotContains($imported->id, array_column($service->getTopEarners(30, 100), 'id'));
    }

    // ------------------------------------------------------------------
    // MunicipalImpactReportService
    // ------------------------------------------------------------------

    public function test_municipal_impact_report_is_unchanged(): void
    {
        $service = app(MunicipalImpactReportService::class);
        $filters = ['date_from' => date('Y-m-d', strtotime('-1 day')), 'date_to' => date('Y-m-d', strtotime('+1 day'))];

        $this->assertFigureUnchangedByImport(function () use ($service, $filters) {
            $summary = $service->summary($this->testTenantId, $filters);
            $stats = $summary['stats'];

            return [
                $stats['timebank_hours'], $stats['verified_hours'], $stats['participating_members'],
                $summary['categories'] ?? null, $summary['trends'] ?? null,
            ];
        }, 'MunicipalImpactReportService::summary');
    }

    // ------------------------------------------------------------------
    // MemberReportService
    // ------------------------------------------------------------------

    public function test_member_report_figures_are_unchanged(): void
    {
        $service = app(MemberReportService::class);

        $this->assertFigureUnchangedByImport(function () use ($service) {
            $engagement = $service->getEngagementMetrics($this->testTenantId, 30);

            return [
                // total/active users legitimately grow: the imported member is a member.
                $engagement['trading_users'],
                $engagement['trading_rate'] > 0,
                $service->getTopContributors($this->testTenantId, 30, 100),
            ];
        }, 'MemberReportService engagement + top contributors');
    }

    public function test_member_report_active_members_shows_no_hours_for_the_imported_member(): void
    {
        $service = app(MemberReportService::class);
        $imported = $this->importFortyHours();

        $members = $service->getActiveMembers($this->testTenantId, 30, 200)['members'];
        $row = collect($members)->firstWhere('id', $imported->id);

        $this->assertNotNull($row, 'a freshly signed-in member is an active member');
        $this->assertEquals(0.0, $row['hours_received']);
        $this->assertSame(0, $row['transaction_count']);
    }

    // ------------------------------------------------------------------
    // ReportExportService
    // ------------------------------------------------------------------

    public function test_report_export_hours_reports_are_unchanged(): void
    {
        $service = app(ReportExportService::class);

        foreach (['hours_summary', 'hours_category', 'hours_period', 'hours_member', 'social_value'] as $type) {
            $this->assertFigureUnchangedByImport(
                fn () => $service->export($type, $this->testTenantId, [])['csv'] ?? '',
                "ReportExportService {$type}"
            );
        }
    }

    // ------------------------------------------------------------------
    // CRM funnel (GET /v2/admin/crm/funnel)
    // ------------------------------------------------------------------

    public function test_crm_funnel_does_not_count_an_import_as_an_exchange(): void
    {
        $this->makeAdmin();
        $before = $this->funnelCounts();

        $this->importFortyHours();

        $after = $this->funnelCounts();
        $delta = array_map(fn ($code) => $after[$code] - $before[$code], array_keys($after));

        // One new registration. No exchange step (first exchange / repeat user) moves.
        $this->assertSame(1, $delta[0]);
        $this->assertSame(0, $delta[array_search('first_exchange', array_keys($after), true)]);
        $this->assertSame(0, $delta[array_search('repeat_user', array_keys($after), true)]);
    }

    /** @return array<string,int> */
    private function funnelCounts(): array
    {
        $stages = $this->apiGet('/v2/admin/crm/funnel')->assertOk()->json('data.stages');

        return array_column($stages, 'count', 'code');
    }

    // ------------------------------------------------------------------
    // ReviewService pending reviews
    // ------------------------------------------------------------------

    public function test_pending_reviews_never_include_an_opening_balance(): void
    {
        $service = app(ReviewService::class);
        $imported = $this->importFortyHours();

        $this->assertSame(0, $service->getPendingReviews($imported->id)['meta']['total']);

        // Positive control: a real completed exchange does ask for a review.
        $partner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        DB::table('transactions')->insert([
            'tenant_id' => $this->testTenantId, 'sender_id' => $partner->id, 'receiver_id' => $imported->id,
            'amount' => '1.00', 'description' => 'Garden help', 'status' => 'completed',
            'transaction_type' => 'transfer', 'created_at' => now(), 'updated_at' => now(),
        ]);

        $pending = $service->getPendingReviews($imported->id);
        $this->assertSame(1, $pending['meta']['total']);
        $this->assertSame('Garden help', $pending['items'][0]['exchange_title']);
    }
}
