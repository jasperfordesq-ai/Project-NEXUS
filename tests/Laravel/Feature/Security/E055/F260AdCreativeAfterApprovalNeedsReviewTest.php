<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E055;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * E-055 F-260 (F-179 sibling) — a creative added to an already-approved ad
 * campaign must not reach members before an administrator reviews it. Adding
 * one sends the campaign back to review; approving it again serves it.
 */
final class F260AdCreativeAfterApprovalNeedsReviewTest extends TestCase
{
    use DatabaseTransactions;

    private User $advertiser;
    private int $campaignId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);

        $features = json_decode((string) DB::table('tenants')->where('id', $this->testTenantId)->value('features'), true) ?: [];
        $features['local_advertising'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);

        $this->advertiser = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $this->campaignId = (int) DB::table('ad_campaigns')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'created_by' => $this->advertiser->id,
            'name' => 'F260 campaign',
            'status' => 'active',
            'placement' => 'feed',
            'budget_cents' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('ad_creatives')->insert([
            'campaign_id' => $this->campaignId,
            'tenant_id' => $this->testTenantId,
            'headline' => 'F260 reviewed headline',
            'body' => 'Reviewed body',
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function activeAdsBody(): string
    {
        $viewer = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        Sanctum::actingAs($viewer, ['*']);

        return (string) $this->apiGet('/v2/ads/active?placement=feed&limit=10')->assertOk()->getContent();
    }

    public function test_creative_added_after_approval_is_not_served_until_reviewed(): void
    {
        // Control: the reviewed creative is being served.
        $this->assertStringContainsString('F260 reviewed headline', $this->activeAdsBody());

        $marker = 'F260Unreviewed' . substr(md5(uniqid('', true)), 0, 8);
        Sanctum::actingAs($this->advertiser, ['*']);
        $this->apiPost("/v2/me/ad-campaigns/{$this->campaignId}/creatives", [
            'headline' => $marker,
            'body' => 'Never seen by the administrator',
        ])->assertStatus(201);

        $this->assertStringNotContainsString($marker, $this->activeAdsBody());
        $this->assertSame('pending_review', DB::table('ad_campaigns')->where('id', $this->campaignId)->value('status'));
    }

    public function test_control_after_re_approval_the_new_creative_is_served(): void
    {
        $marker = 'F260Reapproved' . substr(md5(uniqid('', true)), 0, 8);
        Sanctum::actingAs($this->advertiser, ['*']);
        $this->apiPost("/v2/me/ad-campaigns/{$this->campaignId}/creatives", [
            'headline' => $marker,
            'body' => 'Reviewed on the second pass',
        ])->assertStatus(201);

        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        \App\Services\LocalAdvertisingService::approveCampaign($this->campaignId, $this->testTenantId, (int) $admin->id);

        $this->assertStringContainsString($marker, $this->activeAdsBody());
    }

    public function test_control_creatives_can_still_be_added_while_pending_review(): void
    {
        DB::table('ad_campaigns')->where('id', $this->campaignId)->update(['status' => 'pending_review']);
        Sanctum::actingAs($this->advertiser, ['*']);

        $this->apiPost("/v2/me/ad-campaigns/{$this->campaignId}/creatives", [
            'headline' => 'F260 pending creative',
            'body' => 'Added before review',
        ])->assertStatus(201);
        $this->assertSame('pending_review', DB::table('ad_campaigns')->where('id', $this->campaignId)->value('status'));
    }
}
