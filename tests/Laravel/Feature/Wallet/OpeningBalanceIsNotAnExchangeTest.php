<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Wallet;

use App\Core\TenantContext;
use App\Models\User;
use App\Http\Controllers\Api\AiChatController;
use App\Services\AdminAnalyticsService;
use App\Services\CaringCommunity\NationalKissDashboardService;
use App\Services\ExploreService;
use App\Services\FeedSidebarService;
use App\Services\HoursReportService;
use App\Services\MemberActivityService;
use App\Services\MemberReportService;
use App\Services\MemberRankingService;
use App\Services\MunicipalImpactReportService;
use App\Services\NexusScoreService;
use App\Services\RedisCache;
use App\Services\ReportExportService;
use App\Services\ReviewService;
use App\Services\UserService;
use App\Services\SocialValueService;
use App\Support\Wallet\OpeningBalance;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use ReflectionMethod;
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
    private function importFortyHours(?User $existing = null): User
    {
        $user = $existing ?? $this->newMember();
        DB::table('transactions')->insert([
            'tenant_id' => $this->testTenantId, 'sender_id' => 0, 'receiver_id' => $user->id,
            'amount' => self::IMPORTED_HOURS, 'description' => OpeningBalance::describe('TEST0001', null),
            'status' => 'completed', 'transaction_type' => OpeningBalance::TYPE,
            'created_at' => now(), 'updated_at' => now(),
        ]);

        return $user;
    }

    private function newMember(array $overrides = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create($overrides + [
            'status' => 'active',
            'is_approved' => true,
            'last_login_at' => now(),
            'email_verified_at' => null,
            'bio' => null,
            'location' => null,
        ]);
    }

    /**
     * Per-member figures: the member exists first (so the "before" read is
     * theirs), then the 40-hour import lands on that same member.
     *
     * @param callable(User): mixed $figureFor
     */
    private function assertMemberFigureUnchangedByImport(callable $figureFor, string $label, array $overrides = []): User
    {
        $member = $this->newMember($overrides);
        Cache::flush();
        $before = $figureFor($member);
        $this->importFortyHours($member);
        Cache::flush();
        $this->assertEquals($before, $figureFor($member), $label . ' counted imported hours as exchanged');

        return $member;
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
    // Sidebar, assistant, directory and profile figures (fix round 1)
    // ------------------------------------------------------------------

    public function test_feed_sidebar_community_total_hours_is_unchanged(): void
    {
        $service = app(FeedSidebarService::class);
        $this->assertFigureUnchangedByImport(
            fn () => $service->communityStats()['total_hours'],
            'FeedSidebarService::communityStats total_hours'
        );
    }

    public function test_feed_sidebar_member_hours_are_unchanged(): void
    {
        $this->assertMemberFigureUnchangedByImport(function (User $member) {
            Sanctum::actingAs($member);

            return $this->apiGet('/v2/feed/sidebar')->assertOk()->json('data.profile_stats');
        }, 'GET /v2/feed/sidebar profile_stats');
    }

    /**
     * The newsletter assistant's monthly figures live in a private method that
     * the AI-provider endpoint calls; the method itself needs no provider, so it
     * is called directly.
     */
    public function test_ai_newsletter_monthly_exchange_figures_are_unchanged(): void
    {
        $controller = app(AiChatController::class);
        $method = new ReflectionMethod($controller, 'getNewsletterPlatformData');
        $method->setAccessible(true);

        $this->assertFigureUnchangedByImport(function () use ($controller, $method) {
            $data = $method->invoke($controller);

            return [$data['exchanges_this_month'], $data['hours_exchanged_this_month']];
        }, 'AiChatController newsletter platform data');
    }

    public function test_member_directory_hours_are_unchanged(): void
    {
        $viewer = $this->newMember();
        Sanctum::actingAs($viewer);
        $key = 'Opbal' . substr(md5((string) microtime(true)), 0, 8);

        $member = $this->newMember(['first_name' => $key, 'last_name' => 'Directory']);
        $listed = function (string $query) use ($member, $key) {
            $rows = $this->apiGet('/v2/users?limit=100&q=' . $key . $query)->assertOk()->json('data');
            $row = collect($rows)->firstWhere('id', $member->id);
            $this->assertNotNull($row, 'member should be listed in the directory');

            return [$row['total_hours_given'], $row['total_hours_received']];
        };

        // Default directory listing, then the CommunityRank-ordered listing
        // (a separate query in the same controller). The member is imported
        // after the first "before" read and stays imported for the second.
        $this->assertTrue(app(MemberRankingService::class)->isEnabled(), 'CommunityRank must be on for the ranked query to run');
        $beforeDefault = $listed('');
        $beforeRanked = $listed('&sort=communityrank');
        $this->importFortyHours($member);

        $this->assertEquals($beforeDefault, $listed(''), 'GET /v2/users counted imported hours');
        $this->assertEquals($beforeRanked, $listed('&sort=communityrank'), 'GET /v2/users?sort=communityrank counted imported hours');
    }

    public function test_profile_hours_are_unchanged(): void
    {
        $this->assertMemberFigureUnchangedByImport(function (User $member) {
            $stats = UserService::getProfileStats($member->id);

            return [$stats['given_count'], $stats['received_count']];
        }, 'UserService::getProfileStats');

        $viewer = $this->newMember();
        $this->assertMemberFigureUnchangedByImport(function (User $member) use ($viewer) {
            $profile = UserService::getPublicProfile($member->id, $viewer->id);

            return [
                $profile['total_hours_given'], $profile['total_hours_received'],
                $profile['stats']['total_hours_given'], $profile['stats']['total_hours_received'],
            ];
        }, 'UserService::getPublicProfile');

        $this->assertMemberFigureUnchangedByImport(function (User $member) {
            return UserService::getMe($member->id)['stats']['transactions_count'];
        }, 'UserService::getMe stats');
    }

    public function test_nearby_members_hours_are_unchanged(): void
    {
        $viewer = $this->newMember();
        $this->assertMemberFigureUnchangedByImport(function (User $member) use ($viewer) {
            $result = UserService::getNearby(51.5000, -0.1200, ['radius_km' => 50, 'limit' => 500], $viewer->id);
            $row = collect($result['items'] ?? $result['data'] ?? $result)->firstWhere('id', $member->id);
            $this->assertNotNull($row, 'member should be found nearby');

            return [$row['total_hours_given'] ?? null, $row['total_hours_received'] ?? null];
        }, 'UserService::getNearby', ['latitude' => 51.5000, 'longitude' => -0.1200]);
    }

    // ------------------------------------------------------------------
    // Public platform stats (GET /v2/platform/stats) — final review F1
    // ------------------------------------------------------------------

    public function test_public_platform_stats_hours_exchanged_is_unchanged(): void
    {
        // Cached in the redis store, which Cache::flush() (default store) does not reach.
        $redis = app(RedisCache::class);
        $this->assertFigureUnchangedByImport(function () use ($redis) {
            $redis->delete('platform_stats_public:tenant:' . $this->testTenantId);
            $redis->delete('platform_stats_public');
            $data = $this->apiGet('/v2/platform/stats')->assertOk()->json('data');
            $this->assertSame('tenant', $data['scope']);

            return $data['hours_exchanged'];
        }, 'GET /v2/platform/stats hours_exchanged');
    }

    // ------------------------------------------------------------------
    // Member activity (/v2/users/me/activity/* and the public
    // /v2/users/{id}/activity/dashboard) — final review F1
    // ------------------------------------------------------------------

    public function test_member_activity_hours_are_unchanged(): void
    {
        $service = app(MemberActivityService::class);

        $this->assertMemberFigureUnchangedByImport(
            fn (User $member) => $service->getHours($member->id),
            'MemberActivityService::getHours'
        );
        $this->assertMemberFigureUnchangedByImport(
            fn (User $member) => $service->getHoursSummary($member->id),
            'MemberActivityService::getHoursSummary'
        );
        $this->assertMemberFigureUnchangedByImport(
            fn (User $member) => $service->getMonthlyHours($member->id),
            'MemberActivityService::getMonthlyHours'
        );
    }

    // ------------------------------------------------------------------
    // NexusScore engagement and quality components — final review F1
    // ------------------------------------------------------------------

    public function test_nexus_score_engagement_and_success_rate_are_unchanged(): void
    {
        $service = app(NexusScoreService::class);

        $this->assertMemberFigureUnchangedByImport(function (User $member) use ($service) {
            $breakdown = $service->calculateNexusScore($member->id, $this->testTenantId)['breakdown'];

            return [$breakdown['engagement'], $breakdown['quality']['details']['success_rate']];
        }, 'NexusScoreService engagement / quality success rate');
    }

    /**
     * Found by the F1 sweep: the national KISS dashboard adds each
     * cooperative's completed transaction hours to its approved care hours.
     * Every public method is cached and cross-tenant, so the shared private
     * per-tenant method is called directly.
     */
    public function test_national_kiss_cooperative_hours_are_unchanged(): void
    {
        $service = app(NationalKissDashboardService::class);
        $method = new ReflectionMethod($service, 'approvedHoursForTenant');
        $method->setAccessible(true);
        $range = ['from' => date('Y-m-d', strtotime('-1 day')), 'to' => date('Y-m-d', strtotime('+1 day'))];

        $this->assertFigureUnchangedByImport(
            fn () => $method->invoke($service, $this->testTenantId, $range),
            'NationalKissDashboardService cooperative hours'
        );
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
