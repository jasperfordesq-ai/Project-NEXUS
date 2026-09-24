<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E035;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\LocalAdvertisingService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-176 (E-035): the ad impression and click endpoints are open to anonymous
 * callers, a tracking token could be replayed for unlimited impressions, and
 * every fresh impression could be clicked for another CPC charge — so anyone
 * could drain an advertiser's budget with a loop. A token now counts at most one
 * impression per viewer, anonymous clicks are never charged, and a signed-in
 * member is charged for at most one click per campaign per day.
 */
class AdBudgetReplayTest extends TestCase
{
    use DatabaseTransactions;

    private int $campaignId;
    private int $creativeId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->assertTrue(LocalAdvertisingService::isAvailable(), 'ad tables must exist for this regression test');
        Cache::flush();
        TenantContext::setById($this->testTenantId);

        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $this->campaignId = (int) DB::table('ad_campaigns')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'created_by' => $owner->id,
            'name' => 'F-176 campaign ' . uniqid(),
            'status' => 'active',
            'advertiser_type' => 'sme',
            'budget_cents' => 1000,
            'spent_cents' => 0,
            'placement' => 'feed',
            'impression_count' => 0,
            'click_count' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->creativeId = (int) DB::table('ad_creatives')->insertGetId([
            'campaign_id' => $this->campaignId,
            'tenant_id' => $this->testTenantId,
            'headline' => 'F-176',
            'body' => 'Body',
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function freshToken(): string
    {
        foreach (LocalAdvertisingService::getActiveAds($this->testTenantId, 'feed', 10) as $ad) {
            if ($ad['id'] === $this->campaignId) {
                return (string) $ad['creatives'][0]['tracking_token'];
            }
        }
        $this->fail('test campaign not served');
    }

    private function campaign(): object
    {
        return DB::table('ad_campaigns')->where('id', $this->campaignId)->first();
    }

    private function impression(string $token, ?int $userId): int
    {
        return LocalAdvertisingService::recordImpression(
            $this->campaignId, $this->creativeId, $this->testTenantId, 'feed', $userId, $token
        );
    }

    public function test_replayed_tracking_token_counts_one_impression_per_viewer(): void
    {
        $token = $this->freshToken();

        $first = $this->impression($token, null);
        $second = $this->impression($token, null);
        $third = $this->impression($token, null);

        $this->assertSame($first, $second);
        $this->assertSame($first, $third);
        $this->assertSame(1, (int) $this->campaign()->impression_count);
        $this->assertSame(1, DB::table('ad_impressions')->where('campaign_id', $this->campaignId)->count());
    }

    public function test_anonymous_clicks_never_spend_budget(): void
    {
        for ($i = 0; $i < 5; $i++) {
            $impressionId = $this->impression($this->freshToken(), null);
            LocalAdvertisingService::recordClick($impressionId, $this->campaignId, $this->testTenantId, null);
        }

        $this->assertSame(0, (int) $this->campaign()->spent_cents, 'anonymous replay spent the advertiser budget');
    }

    public function test_member_is_charged_at_most_once_per_campaign_per_day(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();

        for ($i = 0; $i < 4; $i++) {
            $impressionId = $this->impression($this->freshToken(), (int) $member->id);
            LocalAdvertisingService::recordClick($impressionId, $this->campaignId, $this->testTenantId, (int) $member->id);
        }

        $this->assertSame(10, (int) $this->campaign()->spent_cents);
    }

    public function test_member_cannot_get_charged_click_on_someone_elses_impression(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $anonImpression = $this->impression($this->freshToken(), null);

        LocalAdvertisingService::recordClick($anonImpression, $this->campaignId, $this->testTenantId, (int) $member->id);

        $this->assertSame(0, (int) $this->campaign()->spent_cents);
    }
}
