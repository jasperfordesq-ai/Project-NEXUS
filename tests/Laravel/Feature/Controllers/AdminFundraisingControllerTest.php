<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\FundraisingHistoryService as History;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Community admins read a campaign's history and record or cancel the money
 * passed on to its organisation. Members are refused; another community's
 * campaign does not exist.
 */
class AdminFundraisingControllerTest extends TestCase
{
    use DatabaseTransactions;

    private User $admin;
    private int $campaignId;

    protected function setUp(): void
    {
        parent::setUp();
        $features = json_decode((string) DB::table('tenants')->where('id', $this->testTenantId)->value('features'), true) ?: [];
        $features['volunteering'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);

        $this->admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['first_name' => 'Ada', 'last_name' => 'Admin']);
        $orgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId, 'user_id' => $this->admin->id, 'name' => 'Food Bank',
            'slug' => 'admin-fr-' . uniqid(), 'status' => 'approved', 'created_at' => now(),
        ]);
        $this->campaignId = $this->campaign($orgId, $this->testTenantId);
    }

    private function campaign(?int $orgId, int $tenantId): int
    {
        return (int) DB::table('vol_giving_days')->insertGetId([
            'tenant_id' => $tenantId, 'title' => 'Winter appeal',
            'start_date' => now()->subWeek()->toDateString(), 'end_date' => now()->addWeek()->toDateString(),
            'goal_amount' => 1000, 'raised_amount' => 100, 'is_active' => 1,
            'organization_id' => $orgId, 'created_by' => 1, 'created_at' => now(),
        ]);
    }

    /** @return array<string, mixed> */
    private function handover(float $amount = 40): array
    {
        return [
            'amount' => $amount,
            'handed_over_on' => now()->toDateString(),
            'method' => 'bank_transfer',
            'reference' => 'TRF-1',
        ];
    }

    public function test_members_are_refused_everything(): void
    {
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->create());

        $this->apiGet("/v2/admin/volunteering/giving-days/{$this->campaignId}/history")->assertStatus(403);
        $this->apiGet("/v2/admin/volunteering/giving-days/{$this->campaignId}/handovers")->assertStatus(403);
        $this->apiPost("/v2/admin/volunteering/giving-days/{$this->campaignId}/handovers", $this->handover())->assertStatus(403);
        $this->apiPost('/v2/admin/volunteering/handovers/1/cancel', ['reason' => 'x'])->assertStatus(403);
        $this->assertSame(0, DB::table('vol_fundraising_handovers')->where('giving_day_id', $this->campaignId)->count());
    }

    public function test_admin_records_lists_and_cancels_a_handover(): void
    {
        Sanctum::actingAs($this->admin);

        $created = $this->apiPost("/v2/admin/volunteering/giving-days/{$this->campaignId}/handovers", $this->handover(40))
            ->assertStatus(201)->json('data');
        $this->assertSame('recorded', $created['status']);

        $list = $this->apiGet("/v2/admin/volunteering/giving-days/{$this->campaignId}/handovers")->assertOk()->json('data');
        $this->assertCount(1, $list['items']);
        $this->assertEqualsWithDelta(60.0, $list['summary']['still_held'], 0.001);

        $this->apiPost("/v2/admin/volunteering/handovers/{$created['id']}/cancel", ['reason' => ''])->assertStatus(422);
        $this->apiPost("/v2/admin/volunteering/handovers/{$created['id']}/cancel", ['reason' => 'Typed twice'])
            ->assertOk()->assertJsonPath('data.status', 'cancelled');
        $this->apiPost("/v2/admin/volunteering/handovers/{$created['id']}/cancel", ['reason' => 'Again'])
            ->assertStatus(422)->assertJsonPath('errors.0.message', __('fundraising.handover_already_closed'));
    }

    public function test_a_handover_above_what_is_held_is_refused_with_the_reason(): void
    {
        Sanctum::actingAs($this->admin);

        $response = $this->apiPost("/v2/admin/volunteering/giving-days/{$this->campaignId}/handovers", $this->handover(500))
            ->assertStatus(422);
        $this->assertStringContainsString('100.00', (string) $response->json('errors.0.message'));
    }

    public function test_history_shows_admin_names_and_stripe_ids(): void
    {
        Sanctum::actingAs($this->admin);
        History::record($this->testTenantId, 'donation_paid', History::ACTOR_STRIPE, null,
            ['giving_day_id' => $this->campaignId, 'donation_id' => 5], 10.0, 'EUR', null, 'pi_admin_view');
        History::record($this->testTenantId, 'campaign_paused', History::ACTOR_COMMUNITY_ADMIN, $this->admin->id,
            ['giving_day_id' => $this->campaignId]);

        $items = $this->apiGet("/v2/admin/volunteering/giving-days/{$this->campaignId}/history")->assertOk()->json('data.items');

        $this->assertSame('campaign_paused', $items[0]['event']);
        $this->assertStringContainsString('Ada', (string) $items[0]['actor_name']);
        $this->assertSame('pi_admin_view', $items[1]['stripe_object_id']);
    }

    public function test_another_communitys_campaign_is_not_found(): void
    {
        Sanctum::actingAs($this->admin);
        $foreign = $this->campaign(null, 999);

        $this->apiGet("/v2/admin/volunteering/giving-days/{$foreign}/history")->assertStatus(404);
        $this->apiGet("/v2/admin/volunteering/giving-days/{$foreign}/handovers")->assertStatus(404);
        $this->apiPost("/v2/admin/volunteering/giving-days/{$foreign}/handovers", $this->handover())->assertStatus(404);
    }
}
