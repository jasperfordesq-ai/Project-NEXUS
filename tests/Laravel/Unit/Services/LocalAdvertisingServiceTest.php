<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Services\LocalAdvertisingService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * LocalAdvertisingServiceTest
 *
 * Tests the AG56 Local Advertising Platform service: campaign CRUD, creative
 * management, ad-serving eligibility, impression/click accounting, budget
 * spend tracking, and tenant isolation.
 *
 * Strategy: all tests use real MariaDB rows (via DatabaseTransactions rollback).
 * Tenant 2 (hour-timebank) is the primary test tenant; we insert minimal
 * fixtures against real columns from the schema dump. No mocking of the DB
 * layer — this is intentional to verify the SQL queries are correct.
 */
class LocalAdvertisingServiceTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID  = 2;
    private const TENANT_ALT = 3; // isolation checks

    // ── Setup ─────────────────────────────────────────────────────────────────

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById(self::TENANT_ID);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /**
     * Insert a minimal user row and return its ID.
     */
    private function insertUser(int $tenantId = self::TENANT_ID): int
    {
        $uid = uniqid('adtest_', true);
        return DB::table('users')->insertGetId([
            'tenant_id'  => $tenantId,
            'name'       => 'Ad Test User ' . $uid,
            'first_name' => 'Ad',
            'last_name'  => 'Tester',
            'email'      => $uid . '@example.test',
            'status'     => 'active',
            'role'       => 'member',
            'is_approved'=> 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /**
     * Insert a campaign row directly and return its ID.
     *
     * @param array<string,mixed> $overrides
     */
    private function insertCampaign(array $overrides = []): int
    {
        $userId = $overrides['created_by'] ?? $this->insertUser();
        return DB::table('ad_campaigns')->insertGetId(array_merge([
            'tenant_id'       => self::TENANT_ID,
            'created_by'      => $userId,
            'name'            => 'Test Campaign ' . uniqid(),
            'status'          => 'pending_review',
            'advertiser_type' => 'sme',
            'budget_cents'    => 0,
            'spent_cents'     => 0,
            'placement'       => 'feed',
            'impression_count'=> 0,
            'click_count'     => 0,
            'created_at'      => now(),
            'updated_at'      => now(),
        ], $overrides));
    }

    /**
     * Insert a creative row and return its ID.
     *
     * @param array<string,mixed> $overrides
     */
    private function insertCreative(int $campaignId, array $overrides = []): int
    {
        return DB::table('ad_creatives')->insertGetId(array_merge([
            'campaign_id'    => $campaignId,
            'tenant_id'      => self::TENANT_ID,
            'headline'       => 'Great Deal',
            'body'           => 'Body text for the ad.',
            'is_active'      => 1,
            'created_at'     => now(),
            'updated_at'     => now(),
        ], $overrides));
    }

    /**
     * Insert an impression row and return its ID.
     */
    private function insertImpression(int $campaignId, int $creativeId, string $placement = 'feed', int $tenantId = self::TENANT_ID, ?int $userId = null): int
    {
        return DB::table('ad_impressions')->insertGetId([
            'campaign_id' => $campaignId,
            'creative_id' => $creativeId,
            'tenant_id'   => $tenantId,
            'user_id'     => $userId,
            'placement'   => $placement,
            'created_at'  => now(),
        ]);
    }

    // ── isAvailable ───────────────────────────────────────────────────────────

    public function test_isAvailable_returns_true_when_all_four_tables_exist(): void
    {
        // The advertising tables are in the schema dump and always present in test DB.
        $this->assertTrue(LocalAdvertisingService::isAvailable());
    }

    // ── createCampaign ────────────────────────────────────────────────────────

    public function test_createCampaign_inserts_row_with_pending_review_status(): void
    {
        $userId = $this->insertUser();

        $result = LocalAdvertisingService::createCampaign(self::TENANT_ID, $userId, [
            'name'            => 'My First Campaign',
            'advertiser_type' => 'sme',
            'budget_cents'    => 5000,
            'placement'       => 'feed',
        ]);

        $this->assertSame('pending_review', $result['status']);
        $this->assertSame('My First Campaign', $result['name']);
        $this->assertSame(5000, (int) $result['budget_cents']);
        $this->assertSame(self::TENANT_ID, (int) $result['tenant_id']);
        $this->assertSame($userId, (int) $result['created_by']);
    }

    public function test_createCampaign_sets_impression_count_and_spent_cents_to_zero(): void
    {
        $userId = $this->insertUser();

        $result = LocalAdvertisingService::createCampaign(self::TENANT_ID, $userId, [
            'name' => 'Zero Check',
        ]);

        $this->assertSame(0, (int) $result['impression_count']);
        $this->assertSame(0, (int) $result['spent_cents']);
        $this->assertSame(0, (int) $result['click_count']);
    }

    public function test_createCampaign_encodes_audience_filters_as_json(): void
    {
        $userId = $this->insertUser();
        $filters = ['age_min' => 18, 'age_max' => 65, 'location' => 'Dublin'];

        $result = LocalAdvertisingService::createCampaign(self::TENANT_ID, $userId, [
            'name'             => 'Filtered Campaign',
            'audience_filters' => $filters,
        ]);

        $this->assertIsInt((int) $result['id']);

        // Verify the raw JSON was stored correctly.
        $stored = DB::table('ad_campaigns')->find($result['id']);
        $this->assertNotNull($stored);
        $decoded = json_decode($stored->audience_filters, true);
        $this->assertSame(18, $decoded['age_min']);
        $this->assertSame('Dublin', $decoded['location']);
    }

    // ── getCampaignById ───────────────────────────────────────────────────────

    public function test_getCampaignById_returns_null_for_wrong_tenant(): void
    {
        $userId     = $this->insertUser();
        $campaignId = $this->insertCampaign(['created_by' => $userId]);

        // Request with a different tenant — should return null (tenant isolation).
        $result = LocalAdvertisingService::getCampaignById($campaignId, self::TENANT_ALT);

        $this->assertNull($result);
    }

    public function test_getCampaignById_includes_creatives_array(): void
    {
        $userId     = $this->insertUser();
        $campaignId = $this->insertCampaign(['created_by' => $userId]);
        $this->insertCreative($campaignId, ['headline' => 'Special Offer']);

        $result = LocalAdvertisingService::getCampaignById($campaignId, self::TENANT_ID);

        $this->assertIsArray($result);
        $this->assertArrayHasKey('creatives', $result);
        $this->assertCount(1, $result['creatives']);
        $this->assertSame('Special Offer', $result['creatives'][0]['headline']);
    }

    // ── listCampaigns ─────────────────────────────────────────────────────────

    public function test_listCampaigns_filters_by_status(): void
    {
        $userId = $this->insertUser();
        $this->insertCampaign(['created_by' => $userId, 'status' => 'active']);
        $this->insertCampaign(['created_by' => $userId, 'status' => 'pending_review']);

        $active = LocalAdvertisingService::listCampaigns(self::TENANT_ID, ['status' => 'active']);

        // All returned rows must be active.
        foreach ($active as $row) {
            $this->assertSame('active', $row['status']);
        }
        $this->assertGreaterThanOrEqual(1, count($active));
    }

    // ── updateCampaign ────────────────────────────────────────────────────────

    public function test_updateCampaign_changes_mutable_fields(): void
    {
        $userId     = $this->insertUser();
        $campaignId = $this->insertCampaign(['created_by' => $userId, 'budget_cents' => 1000]);

        $result = LocalAdvertisingService::updateCampaign($campaignId, self::TENANT_ID, [
            'name'         => 'Updated Name',
            'budget_cents' => 9999,
            'placement'    => 'discovery',
        ]);

        $this->assertSame('Updated Name', $result['name']);
        $this->assertSame(9999, (int) $result['budget_cents']);
        $this->assertSame('discovery', $result['placement']);
    }

    // ── approveCampaign ───────────────────────────────────────────────────────

    public function test_approveCampaign_sets_status_to_active_and_records_approver(): void
    {
        $userId     = $this->insertUser();
        $approverId = $this->insertUser();
        $campaignId = $this->insertCampaign(['created_by' => $userId, 'status' => 'pending_review']);

        $result = LocalAdvertisingService::approveCampaign($campaignId, self::TENANT_ID, $approverId);

        $this->assertSame('active', $result['status']);
        $this->assertSame($approverId, (int) $result['approved_by']);
        $this->assertNotNull($result['approved_at']);
    }

    // ── rejectCampaign ────────────────────────────────────────────────────────

    public function test_rejectCampaign_sets_status_to_rejected_with_reason(): void
    {
        $userId     = $this->insertUser();
        $campaignId = $this->insertCampaign(['created_by' => $userId]);

        LocalAdvertisingService::rejectCampaign($campaignId, self::TENANT_ID, 'Violates guidelines');

        $row = DB::table('ad_campaigns')->find($campaignId);
        $this->assertSame('rejected', $row->status);
        $this->assertSame('Violates guidelines', $row->rejection_reason);
    }

    // ── pauseCampaign ─────────────────────────────────────────────────────────

    public function test_pauseCampaign_sets_status_to_paused(): void
    {
        $userId     = $this->insertUser();
        $campaignId = $this->insertCampaign(['created_by' => $userId, 'status' => 'active']);

        LocalAdvertisingService::pauseCampaign($campaignId, self::TENANT_ID);

        $row = DB::table('ad_campaigns')->find($campaignId);
        $this->assertSame('paused', $row->status);
    }

    // ── addCreative ───────────────────────────────────────────────────────────

    public function test_addCreative_inserts_row_with_is_active_true(): void
    {
        $userId     = $this->insertUser();
        $campaignId = $this->insertCampaign(['created_by' => $userId]);

        $creative = LocalAdvertisingService::addCreative($campaignId, self::TENANT_ID, [
            'headline'        => 'Buy Now',
            'body'            => 'Great products at low prices.',
            'cta_text'        => 'Shop',
            'destination_url' => 'https://example.com/shop',
        ]);

        $this->assertSame('Buy Now', $creative['headline']);
        $this->assertSame('https://example.com/shop', $creative['destination_url']);
        $this->assertSame(1, (int) $creative['is_active']);
    }

    public function test_addCreative_throws_for_unsafe_destination_url(): void
    {
        $userId     = $this->insertUser();
        $campaignId = $this->insertCampaign(['created_by' => $userId]);

        $this->expectException(\InvalidArgumentException::class);

        LocalAdvertisingService::addCreative($campaignId, self::TENANT_ID, [
            'headline'        => 'Bad Ad',
            'body'            => 'Body',
            'destination_url' => 'javascript:alert(1)',
        ]);
    }

    // ── getActiveAds (ad serving) ─────────────────────────────────────────────

    public function test_getActiveAds_returns_only_active_campaigns_with_active_creatives(): void
    {
        $userId = $this->insertUser();

        // Active campaign with one active creative.
        $activeCampaignId = $this->insertCampaign([
            'created_by' => $userId,
            'status'     => 'active',
            'placement'  => 'feed',
        ]);
        $this->insertCreative($activeCampaignId);

        // Pending campaign should NOT appear.
        $pendingId = $this->insertCampaign([
            'created_by' => $userId,
            'status'     => 'pending_review',
            'placement'  => 'feed',
        ]);
        $this->insertCreative($pendingId);

        $ads = LocalAdvertisingService::getActiveAds(self::TENANT_ID, 'feed');

        $campaignIds = array_column($ads, 'id');
        $this->assertContains($activeCampaignId, $campaignIds);
        $this->assertNotContains($pendingId, $campaignIds);
    }

    public function test_getActiveAds_excludes_budget_exhausted_campaigns(): void
    {
        $userId = $this->insertUser();

        // Campaign where spent_cents >= budget_cents (budget exhausted).
        $exhaustedId = $this->insertCampaign([
            'created_by'   => $userId,
            'status'       => 'active',
            'budget_cents' => 100,
            'spent_cents'  => 100, // exhausted
            'placement'    => 'feed',
        ]);
        $this->insertCreative($exhaustedId);

        $ads = LocalAdvertisingService::getActiveAds(self::TENANT_ID, 'feed');

        $campaignIds = array_column($ads, 'id');
        $this->assertNotContains($exhaustedId, $campaignIds);
    }

    public function test_getActiveAds_includes_campaigns_with_zero_budget_cents_unlimited(): void
    {
        $userId = $this->insertUser();

        // budget_cents=0 means unlimited — should be included.
        $unlimitedId = $this->insertCampaign([
            'created_by'   => $userId,
            'status'       => 'active',
            'budget_cents' => 0,
            'spent_cents'  => 9999,
            'placement'    => 'feed',
        ]);
        $this->insertCreative($unlimitedId);

        $ads = LocalAdvertisingService::getActiveAds(self::TENANT_ID, 'feed');

        $campaignIds = array_column($ads, 'id');
        $this->assertContains($unlimitedId, $campaignIds);
    }

    public function test_getActiveAds_includes_placement_all_campaigns_for_any_placement(): void
    {
        $userId = $this->insertUser();

        // 'all' placement should appear in feed requests.
        $allId = $this->insertCampaign([
            'created_by' => $userId,
            'status'     => 'active',
            'placement'  => 'all',
        ]);
        $this->insertCreative($allId);

        $ads = LocalAdvertisingService::getActiveAds(self::TENANT_ID, 'feed');

        $campaignIds = array_column($ads, 'id');
        $this->assertContains($allId, $campaignIds);
    }

    public function test_getActiveAds_excludes_expired_campaigns(): void
    {
        $userId = $this->insertUser();

        $expiredId = $this->insertCampaign([
            'created_by' => $userId,
            'status'     => 'active',
            'placement'  => 'feed',
            'end_date'   => '2020-01-01', // past date
        ]);
        $this->insertCreative($expiredId);

        $ads = LocalAdvertisingService::getActiveAds(self::TENANT_ID, 'feed');

        $campaignIds = array_column($ads, 'id');
        $this->assertNotContains($expiredId, $campaignIds);
    }

    public function test_getActiveAds_excludes_campaigns_not_yet_started(): void
    {
        $userId = $this->insertUser();

        $futureId = $this->insertCampaign([
            'created_by' => $userId,
            'status'     => 'active',
            'placement'  => 'feed',
            'start_date' => '2099-01-01', // future date
        ]);
        $this->insertCreative($futureId);

        $ads = LocalAdvertisingService::getActiveAds(self::TENANT_ID, 'feed');

        $campaignIds = array_column($ads, 'id');
        $this->assertNotContains($futureId, $campaignIds);
    }

    public function test_getActiveAds_skips_campaigns_without_active_creatives(): void
    {
        $userId = $this->insertUser();

        $noCreativeId = $this->insertCampaign([
            'created_by' => $userId,
            'status'     => 'active',
            'placement'  => 'feed',
        ]);
        // No creative inserted for this campaign.

        $ads = LocalAdvertisingService::getActiveAds(self::TENANT_ID, 'feed');

        $campaignIds = array_column($ads, 'id');
        $this->assertNotContains($noCreativeId, $campaignIds);
    }

    public function test_getActiveAds_each_creative_has_tracking_token(): void
    {
        $userId     = $this->insertUser();
        $campaignId = $this->insertCampaign([
            'created_by' => $userId,
            'status'     => 'active',
            'placement'  => 'feed',
        ]);
        $this->insertCreative($campaignId);

        $ads = LocalAdvertisingService::getActiveAds(self::TENANT_ID, 'feed');

        // Find our campaign.
        $found = null;
        foreach ($ads as $ad) {
            if ($ad['id'] === $campaignId) {
                $found = $ad;
                break;
            }
        }

        $this->assertNotNull($found, 'Active campaign should appear in getActiveAds');
        $this->assertNotEmpty($found['creatives']);
        $token = $found['creatives'][0]['tracking_token'];
        $this->assertIsString($token);
        $this->assertStringContainsString('.', $token, 'Tracking token must contain a dot separator');
    }

    // ── recordImpression ──────────────────────────────────────────────────────

    public function test_recordImpression_inserts_row_and_increments_impression_count(): void
    {
        $userId     = $this->insertUser();
        $campaignId = $this->insertCampaign([
            'created_by' => $userId,
            'status'     => 'active',
            'placement'  => 'feed',
        ]);
        $creativeId = $this->insertCreative($campaignId);

        // Obtain a valid tracking token via getActiveAds.
        $ads = LocalAdvertisingService::getActiveAds(self::TENANT_ID, 'feed');
        $token = null;
        foreach ($ads as $ad) {
            if ($ad['id'] === $campaignId) {
                foreach ($ad['creatives'] as $cr) {
                    if ($cr['id'] === $creativeId) {
                        $token = $cr['tracking_token'];
                    }
                }
            }
        }
        $this->assertNotNull($token, 'Should find a tracking token for test creative');

        $impressionId = LocalAdvertisingService::recordImpression(
            $campaignId,
            $creativeId,
            self::TENANT_ID,
            'feed',
            null,
            $token
        );

        $this->assertIsInt($impressionId);
        $this->assertGreaterThan(0, $impressionId);

        $row = DB::table('ad_campaigns')->find($campaignId);
        $this->assertSame(1, (int) $row->impression_count);
    }

    public function test_recordImpression_rejects_invalid_token(): void
    {
        $userId     = $this->insertUser();
        $campaignId = $this->insertCampaign([
            'created_by' => $userId,
            'status'     => 'active',
        ]);
        $creativeId = $this->insertCreative($campaignId);

        $this->expectException(\InvalidArgumentException::class);

        LocalAdvertisingService::recordImpression(
            $campaignId,
            $creativeId,
            self::TENANT_ID,
            'feed',
            null,
            'invalid.token'
        );
    }

    // ── recordClick ───────────────────────────────────────────────────────────

    public function test_recordClick_increments_click_count_and_deducts_cpc_from_budget(): void
    {
        $userId     = $this->insertUser();
        $campaignId = $this->insertCampaign([
            'created_by'   => $userId,
            'status'       => 'active',
            'placement'    => 'feed',
            'budget_cents' => 1000,
            'spent_cents'  => 0,
            'click_count'  => 0,
        ]);
        $creativeId   = $this->insertCreative($campaignId);
        $viewerId     = $this->insertUser();
        $impressionId = $this->insertImpression($campaignId, $creativeId, 'feed', self::TENANT_ID, $viewerId);

        LocalAdvertisingService::recordClick($impressionId, $campaignId, self::TENANT_ID, $viewerId);

        $row = DB::table('ad_campaigns')->find($campaignId);
        $this->assertSame(1, (int) $row->click_count);
        // Default CPC is 10 cents.
        $this->assertSame(10, (int) $row->spent_cents);
    }

    public function test_recordClick_anonymous_is_counted_but_not_charged(): void
    {
        // E-035 F-176: the click endpoint is open to anonymous callers, so an
        // anonymous click must never spend the advertiser's budget.
        $userId     = $this->insertUser();
        $campaignId = $this->insertCampaign([
            'created_by'   => $userId,
            'status'       => 'active',
            'placement'    => 'feed',
            'budget_cents' => 1000,
            'spent_cents'  => 0,
            'click_count'  => 0,
        ]);
        $creativeId   = $this->insertCreative($campaignId);
        $impressionId = $this->insertImpression($campaignId, $creativeId);

        LocalAdvertisingService::recordClick($impressionId, $campaignId, self::TENANT_ID);

        $row = DB::table('ad_campaigns')->find($campaignId);
        $this->assertSame(1, (int) $row->click_count);
        $this->assertSame(0, (int) $row->spent_cents);
    }

    public function test_recordClick_is_idempotent_for_same_impression(): void
    {
        $userId     = $this->insertUser();
        $campaignId = $this->insertCampaign([
            'created_by'   => $userId,
            'status'       => 'active',
            'placement'    => 'feed',
            'budget_cents' => 1000,
            'spent_cents'  => 0,
            'click_count'  => 0,
        ]);
        $creativeId   = $this->insertCreative($campaignId);
        $viewerId     = $this->insertUser();
        $impressionId = $this->insertImpression($campaignId, $creativeId, 'feed', self::TENANT_ID, $viewerId);

        // Click twice on the same impression.
        LocalAdvertisingService::recordClick($impressionId, $campaignId, self::TENANT_ID, $viewerId);
        LocalAdvertisingService::recordClick($impressionId, $campaignId, self::TENANT_ID, $viewerId);

        $row = DB::table('ad_campaigns')->find($campaignId);
        // Only one click should be counted (idempotency guard).
        $this->assertSame(1, (int) $row->click_count);
        $this->assertSame(10, (int) $row->spent_cents);

        $clickCount = DB::table('ad_clicks')
            ->where('impression_id', $impressionId)
            ->count();
        $this->assertSame(1, $clickCount);
    }

    public function test_recordClick_throws_for_nonexistent_impression(): void
    {
        $userId     = $this->insertUser();
        $campaignId = $this->insertCampaign(['created_by' => $userId]);

        $this->expectException(\InvalidArgumentException::class);

        LocalAdvertisingService::recordClick(999999999, $campaignId, self::TENANT_ID);
    }

    // ── getCampaignStats ──────────────────────────────────────────────────────

    public function test_getCampaignStats_returns_correct_ctr_and_budget_remaining(): void
    {
        $userId     = $this->insertUser();
        $campaignId = $this->insertCampaign([
            'created_by'      => $userId,
            'impression_count'=> 100,
            'click_count'     => 5,
            'budget_cents'    => 500,
            'spent_cents'     => 50,
        ]);

        $stats = LocalAdvertisingService::getCampaignStats($campaignId, self::TENANT_ID);

        $this->assertSame($campaignId, $stats['campaign_id']);
        $this->assertSame(100, $stats['impressions']);
        $this->assertSame(5, $stats['clicks']);
        $this->assertSame(5.0, $stats['ctr_percent']);        // 5/100*100
        $this->assertSame(500, $stats['budget_cents']);
        $this->assertSame(50, $stats['spent_cents']);
        $this->assertSame(450, $stats['budget_remaining']); // 500-50
        $this->assertArrayHasKey('daily', $stats);
        $this->assertCount(30, $stats['daily']);
    }

    public function test_getCampaignStats_returns_null_budget_remaining_when_budget_is_zero(): void
    {
        $userId     = $this->insertUser();
        $campaignId = $this->insertCampaign([
            'created_by'   => $userId,
            'budget_cents' => 0,
            'spent_cents'  => 0,
        ]);

        $stats = LocalAdvertisingService::getCampaignStats($campaignId, self::TENANT_ID);

        $this->assertNull($stats['budget_remaining'], 'Unlimited budget (0) should return null for remaining');
    }

    public function test_getCampaignStats_returns_empty_for_wrong_tenant(): void
    {
        $userId     = $this->insertUser();
        $campaignId = $this->insertCampaign(['created_by' => $userId]);

        $stats = LocalAdvertisingService::getCampaignStats($campaignId, self::TENANT_ALT);

        $this->assertSame([], $stats);
    }

    // ── getOverviewStats ──────────────────────────────────────────────────────

    public function test_getOverviewStats_returns_required_keys(): void
    {
        $stats = LocalAdvertisingService::getOverviewStats(self::TENANT_ID);

        $this->assertArrayHasKey('active_campaigns', $stats);
        $this->assertArrayHasKey('impressions_today', $stats);
        $this->assertArrayHasKey('clicks_today', $stats);
        $this->assertArrayHasKey('total_revenue_cents', $stats);
    }

    public function test_getOverviewStats_counts_active_campaigns_only(): void
    {
        $userId = $this->insertUser();
        $before = LocalAdvertisingService::getOverviewStats(self::TENANT_ID)['active_campaigns'];

        $this->insertCampaign(['created_by' => $userId, 'status' => 'active']);
        $this->insertCampaign(['created_by' => $userId, 'status' => 'pending_review']);

        $after = LocalAdvertisingService::getOverviewStats(self::TENANT_ID)['active_campaigns'];

        $this->assertSame($before + 1, $after, 'Only active campaigns should be counted');
    }
}
