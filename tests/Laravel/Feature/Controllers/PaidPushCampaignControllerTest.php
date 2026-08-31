<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

class PaidPushCampaignControllerTest extends TestCase
{
    use DatabaseTransactions;

    public function test_record_open_requires_authentication(): void
    {
        $this->apiPost('/v2/me/push-campaigns/1/open')->assertStatus(401);
    }

    public function test_record_open_marks_only_the_authenticated_members_tenant_scoped_send(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $campaignId = $this->insertCampaign($this->testTenantId, (int) $member->id);
        DB::table('paid_push_campaign_sends')->insert([
            'campaign_id' => $campaignId,
            'tenant_id' => $this->testTenantId,
            'user_id' => (int) $member->id,
            'sent_at' => now(),
            'opened_at' => null,
        ]);

        $this->apiPost("/v2/me/push-campaigns/{$campaignId}/open")
            ->assertOk()
            ->assertJsonPath('data.recorded', true);

        $this->assertNotNull(
            DB::table('paid_push_campaign_sends')
                ->where('campaign_id', $campaignId)
                ->where('tenant_id', $this->testTenantId)
                ->where('user_id', $member->id)
                ->value('opened_at')
        );
        $this->assertSame(
            1,
            (int) DB::table('paid_push_campaigns')->where('id', $campaignId)->value('open_count')
        );
    }

    public function test_record_open_cannot_mark_a_send_from_another_tenant(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $otherTenantId = 999;
        $campaignId = $this->insertCampaign($otherTenantId, (int) $member->id);
        DB::table('paid_push_campaign_sends')->insert([
            'campaign_id' => $campaignId,
            'tenant_id' => $otherTenantId,
            'user_id' => (int) $member->id,
            'sent_at' => now(),
            'opened_at' => null,
        ]);

        $this->apiPost("/v2/me/push-campaigns/{$campaignId}/open")
            ->assertOk()
            ->assertJsonPath('data.recorded', true);

        $this->assertNull(
            DB::table('paid_push_campaign_sends')
                ->where('campaign_id', $campaignId)
                ->where('tenant_id', $otherTenantId)
                ->value('opened_at')
        );
        $this->assertSame(
            0,
            (int) DB::table('paid_push_campaigns')->where('id', $campaignId)->value('open_count')
        );
    }

    private function insertCampaign(int $tenantId, int $creatorId): int
    {
        return (int) DB::table('paid_push_campaigns')->insertGetId([
            'tenant_id' => $tenantId,
            'created_by' => $creatorId,
            'name' => 'Tap analytics test',
            'status' => 'sent',
            'advertiser_type' => 'sme',
            'title' => 'Test title',
            'body' => 'Test body',
            'actual_send_count' => 1,
            'total_cost_cents' => 5,
            'cost_per_send' => 5,
            'open_count' => 0,
            'click_count' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
