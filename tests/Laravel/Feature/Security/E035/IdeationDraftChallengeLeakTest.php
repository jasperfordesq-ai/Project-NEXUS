<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E035;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\CampaignService;
use App\Services\ChallengeOutcomeService;
use App\Services\IdeationChallengeService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * E-035 F-187 (completes F-077) — a draft (unpublished) ideation challenge's
 * title and status must not reach ordinary members through the campaigns
 * list / detail or the outcomes dashboard / per-challenge outcome. The
 * challenge list already applies the member-visible status filter; these
 * endpoints now apply the same rule. Admins keep the full view.
 */
class IdeationDraftChallengeLeakTest extends TestCase
{
    use DatabaseTransactions;

    private const DRAFT_TITLE = 'E035-DRAFT-CHALLENGE-TITLE';
    private const DRAFT_CAMPAIGN_TITLE = 'E035-DRAFT-CAMPAIGN-TITLE';

    private User $member;
    private User $admin;
    private int $draftChallengeId;
    private int $openChallengeId;
    private int $campaignId;
    private int $draftCampaignId;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
        if (!TenantContext::hasFeature('ideation_challenges')) {
            $row = DB::table('tenants')->where('id', $this->testTenantId)->first(['features']);
            $features = json_decode((string) ($row->features ?? '{}'), true) ?: [];
            $features['ideation_challenges'] = true;
            DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
            TenantContext::setById($this->testTenantId);
        }

        $this->member = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true, 'role' => 'member',
        ]);
        $this->admin = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true, 'role' => 'admin',
        ]);
        TenantContext::setById($this->testTenantId);

        $this->draftChallengeId = $this->challenge(self::DRAFT_TITLE, 'draft');
        $this->openChallengeId = $this->challenge('E035 open challenge', 'open');

        $this->campaignId = $this->campaign('E035 active campaign', 'active');
        $this->draftCampaignId = $this->campaign(self::DRAFT_CAMPAIGN_TITLE, 'draft');
        foreach ([$this->draftChallengeId, $this->openChallengeId] as $order => $challengeId) {
            DB::table('campaign_challenges')->insert([
                'campaign_id' => $this->campaignId,
                'challenge_id' => $challengeId,
                'sort_order' => $order,
            ]);
        }

        foreach ([$this->draftChallengeId, $this->openChallengeId] as $challengeId) {
            DB::table('challenge_outcomes')->insert([
                'tenant_id' => $this->testTenantId,
                'challenge_id' => $challengeId,
                'status' => 'in_progress',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    private function challenge(string $title, string $status): int
    {
        return (int) DB::table('ideation_challenges')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $this->admin->id,
            'title' => $title,
            'description' => 'E035 fixture challenge.',
            'status' => $status,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function campaign(string $title, string $status): int
    {
        return (int) DB::table('campaigns')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'title' => $title,
            'status' => $status,
            'created_by' => $this->admin->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_member_campaign_detail_hides_draft_challenge(): void
    {
        Sanctum::actingAs($this->member, ['*']);
        $response = $this->apiGet("/v2/ideation-campaigns/{$this->campaignId}");
        $response->assertStatus(200);
        $ids = array_map('intval', array_column($response->json('data.challenges') ?? [], 'id'));
        $this->assertContains($this->openChallengeId, $ids);
        $this->assertNotContains($this->draftChallengeId, $ids);
        $this->assertStringNotContainsString(self::DRAFT_TITLE, (string) $response->getContent());
    }

    public function test_member_campaign_list_hides_draft_campaign_and_counts_only_visible_challenges(): void
    {
        Sanctum::actingAs($this->member, ['*']);
        $response = $this->apiGet('/v2/ideation-campaigns?per_page=100');
        $response->assertStatus(200);
        $body = (string) $response->getContent();
        $this->assertStringNotContainsString(self::DRAFT_CAMPAIGN_TITLE, $body);
        $mine = collect($response->json('data') ?? [])->firstWhere('id', $this->campaignId);
        $this->assertNotNull($mine);
        $this->assertSame(1, (int) $mine['challenge_count']);

        $this->apiGet("/v2/ideation-campaigns/{$this->draftCampaignId}")->assertStatus(404);
    }

    public function test_member_outcomes_dashboard_and_outcome_hide_draft_challenge(): void
    {
        Sanctum::actingAs($this->member, ['*']);
        $dashboard = $this->apiGet('/v2/ideation-outcomes/dashboard');
        $dashboard->assertStatus(200);
        $this->assertStringNotContainsString(self::DRAFT_TITLE, (string) $dashboard->getContent());
        $challengeIds = array_map('intval', array_column($dashboard->json('data.outcomes') ?? [], 'challenge_id'));
        $this->assertContains($this->openChallengeId, $challengeIds);
        $this->assertNotContains($this->draftChallengeId, $challengeIds);

        $outcome = $this->apiGet("/v2/ideation-challenges/{$this->draftChallengeId}/outcome");
        $outcome->assertStatus(200);
        $this->assertNull($outcome->json('data'));
        $this->assertNotNull($this->apiGet("/v2/ideation-challenges/{$this->openChallengeId}/outcome")->json('data'));
    }

    public function test_admin_still_sees_draft_challenge_everywhere(): void
    {
        Sanctum::actingAs($this->admin, ['*']);
        $detail = $this->apiGet("/v2/ideation-campaigns/{$this->campaignId}");
        $ids = array_map('intval', array_column($detail->json('data.challenges') ?? [], 'id'));
        $this->assertContains($this->draftChallengeId, $ids);

        $list = (string) $this->apiGet('/v2/ideation-campaigns?per_page=100')->getContent();
        $this->assertStringContainsString(self::DRAFT_CAMPAIGN_TITLE, $list);

        $dashboard = (string) $this->apiGet('/v2/ideation-outcomes/dashboard')->getContent();
        $this->assertStringContainsString(self::DRAFT_TITLE, $dashboard);
        $this->assertNotNull($this->apiGet("/v2/ideation-challenges/{$this->draftChallengeId}/outcome")->json('data'));
    }

    public function test_member_visible_status_list_matches_the_challenge_list_rule(): void
    {
        // Hand-copied visibility rules drift; pin them to the challenge list's.
        $source = (new \ReflectionClass(IdeationChallengeService::class))->getConstant('MEMBER_VISIBLE_STATUSES');
        $this->assertSame($source, CampaignService::MEMBER_VISIBLE_CHALLENGE_STATUSES);
        $this->assertSame($source, ChallengeOutcomeService::MEMBER_VISIBLE_CHALLENGE_STATUSES);
    }
}
