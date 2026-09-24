<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E035;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\PaidPushCampaignService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-179 (E-035): an advertiser could edit a paid push campaign's title, body,
 * link or audience while it sat in `pending_review`, so an admin approved one
 * message and a different one was sent to members. Submission now freezes the
 * content: only a draft can be edited.
 */
class PaidPushReviewFreezeTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        $this->assertTrue(PaidPushCampaignService::isAvailable(), 'paid push tables must exist for this regression test');
        TenantContext::setById($this->testTenantId);
    }

    private function campaign(string $status): int
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create();

        return (int) DB::table('paid_push_campaigns')->insertGetId([
            'tenant_id' => $this->testTenantId, 'created_by' => $owner->id, 'name' => 'F-179',
            'status' => $status, 'advertiser_type' => 'sme',
            'title' => 'Reviewed title', 'body' => 'Reviewed body', 'cta_url' => 'https://example.com/reviewed',
            'actual_send_count' => 0, 'total_cost_cents' => 0, 'cost_per_send' => 5,
            'open_count' => 0, 'click_count' => 0,
            'scheduled_at' => now()->addDay(),
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    public function test_campaign_under_review_cannot_be_edited(): void
    {
        $id = $this->campaign('pending_review');

        $refused = false;
        try {
            PaidPushCampaignService::updateCampaign($id, $this->testTenantId, [
                'title' => 'Swapped title', 'body' => 'Swapped body', 'cta_url' => 'https://example.com/swapped',
            ]);
        } catch (\RuntimeException $e) {
            $refused = true;
        }
        $this->assertTrue($refused, 'a campaign under review was edited');

        $row = DB::table('paid_push_campaigns')->where('id', $id)->first();
        $this->assertSame('Reviewed title', $row->title);
        $this->assertSame('Reviewed body', $row->body);
        $this->assertSame('https://example.com/reviewed', $row->cta_url);

        $approved = PaidPushCampaignService::approveCampaign($id, $this->testTenantId, 1);
        $this->assertSame('Reviewed title', $approved['title'], 'approval did not apply to the reviewed content');
    }

    public function test_control_draft_is_still_editable(): void
    {
        $id = $this->campaign('draft');

        $updated = PaidPushCampaignService::updateCampaign($id, $this->testTenantId, ['title' => 'Draft edit']);

        $this->assertSame('Draft edit', $updated['title']);
    }
}
