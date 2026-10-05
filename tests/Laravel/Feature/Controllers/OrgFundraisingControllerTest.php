<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\FundraisingHandoverService;
use App\Services\FundraisingHistoryService as History;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * An organisation's owners and admins run fundraising campaigns for their own
 * organisation from its dashboard (owner decisions, 5 Oct 2026): no approval
 * step, no donor contact or Gift Aid details, and nothing belonging to another
 * organisation or community. Most of these tests are refusals.
 */
class OrgFundraisingControllerTest extends TestCase
{
    use DatabaseTransactions;

    private User $owner;
    private int $orgId;

    protected function setUp(): void
    {
        parent::setUp();
        DB::table('tenants')->where('id', $this->testTenantId)
            ->update(['features' => json_encode(['volunteering' => true, 'organisations' => true])]);
        TenantContext::setById($this->testTenantId);
        $this->owner = User::factory()->forTenant($this->testTenantId)->create();
        $this->orgId = $this->org($this->owner->id);
    }

    private function org(int $ownerId, string $status = 'approved', ?int $tenantId = null): int
    {
        return (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $tenantId ?? $this->testTenantId, 'user_id' => $ownerId, 'name' => 'Org ' . uniqid(),
            'slug' => 'org-fr-' . uniqid(), 'status' => $status, 'created_at' => now(),
        ]);
    }

    private function member(int $orgId, int $userId, string $role): void
    {
        DB::table('org_members')->insert([
            'tenant_id' => $this->testTenantId, 'organization_id' => $orgId, 'org_type' => 'volunteer',
            'user_id' => $userId, 'role' => $role, 'status' => 'active',
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function campaign(?int $orgId, ?int $tenantId = null): int
    {
        return (int) DB::table('vol_giving_days')->insertGetId([
            'tenant_id' => $tenantId ?? $this->testTenantId, 'title' => 'Appeal',
            'start_date' => now()->subDay()->toDateString(), 'end_date' => now()->addWeek()->toDateString(),
            'goal_amount' => 500, 'raised_amount' => 100, 'is_active' => 1,
            'organization_id' => $orgId, 'created_by' => 1, 'created_at' => now(),
        ]);
    }

    /** @return array<string, mixed> */
    private function body(array $overrides = []): array
    {
        return array_merge([
            'title' => 'Spring appeal',
            'description' => 'New roof',
            'start_date' => now()->toDateString(),
            'end_date' => now()->addMonth()->toDateString(),
            'goal_amount' => 2500,
        ], $overrides);
    }

    private function base(?int $orgId = null): string
    {
        return '/v2/volunteering/organisations/' . ($orgId ?? $this->orgId);
    }

    public function test_owner_creates_a_campaign_that_goes_live_for_their_organisation(): void
    {
        Sanctum::actingAs($this->owner);

        $created = $this->apiPost($this->base() . '/campaigns', $this->body())->assertStatus(201)->json('data');

        $row = DB::table('vol_giving_days')->find($created['id']);
        $this->assertSame($this->orgId, (int) $row->organization_id);
        $this->assertSame(1, (int) $row->is_active);
        $event = DB::table('vol_fundraising_events')->where('giving_day_id', $created['id'])->where('event', 'campaign_created')->first();
        $this->assertSame('org_admin', $event->actor_kind);
        $this->assertSame((int) $this->owner->id, (int) $event->actor_user_id);

        $listed = $this->apiGet($this->base() . '/campaigns')->assertOk()->json('data.items');
        $this->assertSame([$created['id']], array_column($listed, 'id'));
    }

    public function test_an_organisation_id_in_the_body_is_ignored(): void
    {
        Sanctum::actingAs($this->owner);
        $other = $this->org(User::factory()->forTenant($this->testTenantId)->create()->id);

        $created = $this->apiPost($this->base() . '/campaigns', $this->body(['organization_id' => $other]))->assertStatus(201)->json('data');
        $this->assertSame($this->orgId, (int) DB::table('vol_giving_days')->where('id', $created['id'])->value('organization_id'));

        $this->apiPut($this->base() . '/campaigns/' . $created['id'], ['organization_id' => $other, 'goal_amount' => 3000])->assertOk();
        $row = DB::table('vol_giving_days')->find($created['id']);
        $this->assertSame($this->orgId, (int) $row->organization_id);
        $this->assertSame(3000.0, (float) $row->goal_amount);
    }

    public function test_an_organisation_admin_can_edit_but_an_ordinary_member_cannot(): void
    {
        $campaign = $this->campaign($this->orgId);
        $admin = User::factory()->forTenant($this->testTenantId)->create();
        $plain = User::factory()->forTenant($this->testTenantId)->create();
        $this->member($this->orgId, $admin->id, 'admin');
        $this->member($this->orgId, $plain->id, 'member');

        Sanctum::actingAs($admin);
        $this->apiPut($this->base() . "/campaigns/{$campaign}", ['is_active' => false])->assertOk();
        $this->assertSame('campaign_paused', DB::table('vol_fundraising_events')->where('giving_day_id', $campaign)->value('event'));

        Sanctum::actingAs($plain);
        $this->apiPut($this->base() . "/campaigns/{$campaign}", ['is_active' => true])->assertStatus(403);
        $this->apiGet($this->base() . '/campaigns')->assertStatus(403);

        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->create());
        $this->apiPost($this->base() . '/campaigns', $this->body())->assertStatus(403);
    }

    public function test_a_pending_organisation_cannot_start_a_campaign(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $pending = $this->org($owner->id, 'pending');
        Sanctum::actingAs($owner);

        $this->apiPost($this->base($pending) . '/campaigns', $this->body())
            ->assertStatus(422)
            ->assertJsonPath('errors.0.message', __('fundraising.organisation_not_eligible'));
    }

    public function test_a_suspended_organisation_can_no_longer_change_its_campaigns(): void
    {
        $campaign = $this->campaign($this->orgId);
        DB::table('vol_organizations')->where('id', $this->orgId)->update(['status' => 'suspended']);
        Sanctum::actingAs($this->owner);

        $this->apiPut($this->base() . "/campaigns/{$campaign}", ['goal_amount' => 9999])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.message', __('fundraising.organisation_not_eligible'));
        $this->assertSame(500.0, (float) DB::table('vol_giving_days')->where('id', $campaign)->value('goal_amount'));
        // Reading what happened stays possible.
        $this->apiGet($this->base() . '/campaigns')->assertOk();
    }

    public function test_campaigns_that_are_not_the_organisations_are_not_found(): void
    {
        Sanctum::actingAs($this->owner);
        $otherOrgs = $this->campaign($this->org(User::factory()->forTenant($this->testTenantId)->create()->id));
        $communityWide = $this->campaign(null);
        $foreignTenant = $this->campaign($this->orgId, 999);

        foreach ([$otherOrgs, $communityWide, $foreignTenant] as $id) {
            $this->apiPut($this->base() . "/campaigns/{$id}", ['goal_amount' => 1])->assertStatus(404);
            $this->apiGet($this->base() . "/campaigns/{$id}/gifts")->assertStatus(404);
            $this->apiGet($this->base() . "/campaigns/{$id}/history")->assertStatus(404);
            $this->apiGet($this->base() . "/campaigns/{$id}/handovers")->assertStatus(404);
        }
        $this->assertSame(500.0, (float) DB::table('vol_giving_days')->where('id', $otherOrgs)->value('goal_amount'));
    }

    public function test_gifts_show_no_contact_or_gift_aid_details(): void
    {
        Sanctum::actingAs($this->owner);
        $campaign = $this->campaign($this->orgId);
        $donor = User::factory()->forTenant($this->testTenantId)->create(['first_name' => 'Pat', 'last_name' => 'Pledger']);
        $base = [
            'tenant_id' => $this->testTenantId, 'giving_day_id' => $campaign, 'currency' => 'EUR',
            'status' => 'completed', 'created_at' => now(),
        ];
        DB::table('vol_donations')->insert(array_merge($base, [
            'user_id' => 1, 'amount' => 10, 'payment_method' => 'stripe', 'donor_name' => 'Dana Donor',
            'donor_email' => 'dana@example.test', 'gift_aid_postcode' => 'AB1 2CD', 'is_anonymous' => 0,
        ]));
        DB::table('vol_donations')->insert(array_merge($base, [
            'user_id' => 1, 'amount' => 20, 'payment_method' => 'stripe', 'donor_name' => 'Hidden Person', 'is_anonymous' => 1,
        ]));
        DB::table('vol_donations')->insert(array_merge($base, [
            'user_id' => $donor->id, 'amount' => 30, 'payment_method' => 'bank_transfer', 'donor_name' => null, 'is_anonymous' => 0,
        ]));

        $response = $this->apiGet($this->base() . "/campaigns/{$campaign}/gifts")->assertOk();
        $raw = (string) $response->getContent();
        $this->assertStringNotContainsString('dana@example.test', $raw);
        $this->assertStringNotContainsString('AB1 2CD', $raw);
        $this->assertStringNotContainsString('Hidden Person', $raw);
        $this->assertStringNotContainsString('gift_aid', $raw);
        $this->assertStringNotContainsString('donor_email', $raw);

        $items = collect($response->json('data.items'))->keyBy('amount');
        $this->assertSame('Dana Donor', $items[10]['display_name']);
        $this->assertNull($items[20]['display_name']);
        $this->assertSame('card', $items[10]['payment_method']);
        $this->assertSame('pledge', $items[30]['payment_method']);
        $this->assertStringContainsString('Pat', (string) $items[30]['display_name'], 'a pledge without a stored donor name shows the member');
    }

    public function test_history_in_the_organisation_view_hides_donors_and_stripe_ids(): void
    {
        Sanctum::actingAs($this->owner);
        $campaign = $this->campaign($this->orgId);
        $donor = User::factory()->forTenant($this->testTenantId)->create(['first_name' => 'Dana']);
        History::record($this->testTenantId, 'donation_started', History::ACTOR_MEMBER, $donor->id,
            ['giving_day_id' => $campaign, 'donation_id' => 9], 10.0, 'EUR', null, 'pi_secret_1');

        $item = $this->apiGet($this->base() . "/campaigns/{$campaign}/history")->assertOk()->json('data.items.0');
        $this->assertNull($item['actor_name']);
        $this->assertNull($item['stripe_object_id']);
    }

    public function test_the_organisation_confirms_its_own_handover_only(): void
    {
        $campaign = $this->campaign($this->orgId);
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $handover = FundraisingHandoverService::record($this->testTenantId, $campaign, $admin->id, [
            'amount' => 40, 'handed_over_on' => now()->toDateString(), 'method' => 'cheque', 'reference' => 'CHQ-9',
        ]);

        $strangerOwner = User::factory()->forTenant($this->testTenantId)->create();
        $strangerOrg = $this->org($strangerOwner->id);
        Sanctum::actingAs($strangerOwner);
        $this->apiPost($this->base($strangerOrg) . "/handovers/{$handover['id']}/confirm")->assertStatus(404);

        Sanctum::actingAs($this->owner);
        $list = $this->apiGet($this->base() . "/campaigns/{$campaign}/handovers")->assertOk()->json('data');
        $this->assertEqualsWithDelta(60.0, $list['summary']['still_held'], 0.001);
        $this->apiPost($this->base() . "/handovers/{$handover['id']}/confirm")
            ->assertOk()->assertJsonPath('data.status', 'confirmed');
        $this->apiPost($this->base() . "/handovers/{$handover['id']}/confirm")->assertStatus(422);
    }
}
