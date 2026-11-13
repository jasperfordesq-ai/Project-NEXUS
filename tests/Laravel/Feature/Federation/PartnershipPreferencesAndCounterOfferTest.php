<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Federation;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\FederationFeatureService;
use App\Services\FederationPartnershipService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Regressions found by the Partner Timebanks panel review, November 2026.
 *
 * 1. The "Accept partnership requests" switch and the "Partnership limit" on
 *    the Network settings page were saved but read by nothing: a community
 *    that switched requests off still received them, and the limit limited
 *    nothing. "Approve new partners automatically" was likewise dead and has
 *    been retired, not made real.
 * 2. Every partnership request was hard-coded to the lowest level, and the
 *    only way to change the level — a counter-proposal — could be sent but
 *    never accepted, because no route reached acceptCounterProposal(). No
 *    partnership made through the panel could carry messages or exchanges.
 * 3. The partnerships list did not say which side of a pending request the
 *    caller was on.
 */
class PartnershipPreferencesAndCounterOfferTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
    }

    // ── helpers ──────────────────────────────────────────────────────────

    private function seedTenant(string $name = 'Preferences Partner'): int
    {
        return (int) DB::table('tenants')->insertGetId([
            'name' => $name,
            'slug' => 'pref-partner-' . substr(uniqid('', true), -10),
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** Save partnership preferences the way the Network settings page does. */
    private function savePreferences(int $tenantId, array $federation): void
    {
        $row = DB::selectOne('SELECT configuration FROM tenants WHERE id = ?', [$tenantId]);
        $config = json_decode((string) ($row->configuration ?? ''), true) ?: [];
        $config['federation'] = array_merge($config['federation'] ?? [], $federation);
        DB::update('UPDATE tenants SET configuration = ? WHERE id = ?', [json_encode($config), $tenantId]);
    }

    private function seedPartnership(int $fromTenantId, int $toTenantId, string $status, array $extra = []): int
    {
        $data = array_merge([
            'tenant_id' => $fromTenantId,
            'partner_tenant_id' => $toTenantId,
            'status' => $status,
            'federation_level' => 1,
            'profiles_enabled' => 1,
            'requested_at' => now(),
            'approved_at' => $status === 'active' ? now() : null,
            'created_at' => now(),
            'updated_at' => now(),
        ], $extra);
        if (DB::getSchemaBuilder()->hasColumn('federation_partnerships', 'canonical_pair')) {
            $data['canonical_pair'] = min($fromTenantId, $toTenantId) . '-' . max($fromTenantId, $toTenantId);
        }

        return (int) DB::table('federation_partnerships')->insertGetId($data);
    }

    /**
     * Open every platform-level door so a request reaches the preference
     * checks under test. The doors themselves (kill switch, whitelist, tenant
     * feature flags) have their own tests.
     */
    private function openPlatformDoors(int $maxLevel = 4): void
    {
        $this->mock(FederationFeatureService::class, function ($mock) use ($maxLevel): void {
            $mock->shouldReceive('isOperationAllowed')->andReturn(['allowed' => true, 'reason' => null]);
            $mock->shouldReceive('isTenantFeatureEnabled')->andReturn(true);
            $mock->shouldReceive('getMaxFederationLevel')->andReturn($maxLevel);
            $mock->shouldIgnoreMissing();
        });
    }

    private function pendingBetween(int $fromTenantId, int $toTenantId): ?object
    {
        return DB::table('federation_partnerships')
            ->where('tenant_id', $fromTenantId)->where('partner_tenant_id', $toTenantId)->first();
    }

    // ── 1. "Accept partnership requests" ─────────────────────────────────

    public function test_a_community_that_switched_requests_off_does_not_receive_them(): void
    {
        $this->openPlatformDoors();
        $target = $this->seedTenant();
        $this->savePreferences($target, ['allow_inbound_partnerships' => false]);

        $result = FederationPartnershipService::requestPartnership($this->testTenantId, $target, 1);

        $this->assertFalse($result['success']);
        $this->assertNull($this->pendingBetween($this->testTenantId, $target), 'no request row may be created');
    }

    public function test_a_community_that_never_saved_preferences_still_accepts_requests(): void
    {
        $this->openPlatformDoors();
        $target = $this->seedTenant();

        $result = FederationPartnershipService::requestPartnership($this->testTenantId, $target, 1);

        $this->assertTrue($result['success'], (string) ($result['error'] ?? ''));
        $this->assertSame('pending', $this->pendingBetween($this->testTenantId, $target)->status);
    }

    // ── 1b. "Partnership limit" ──────────────────────────────────────────

    public function test_a_community_at_its_own_limit_cannot_send_another_request(): void
    {
        $this->openPlatformDoors();
        $this->savePreferences($this->testTenantId, ['max_partnerships' => 2]);
        $this->seedPartnership($this->testTenantId, $this->seedTenant(), 'active');
        $this->seedPartnership($this->testTenantId, $this->seedTenant(), 'pending'); // a request already out
        $target = $this->seedTenant();

        $result = FederationPartnershipService::requestPartnership($this->testTenantId, $target, 1);

        $this->assertFalse($result['success']);
        $this->assertStringContainsString('2', (string) $result['error'], 'the refusal names the limit');
        $this->assertNull($this->pendingBetween($this->testTenantId, $target));
    }

    public function test_a_community_at_its_limit_does_not_receive_further_requests(): void
    {
        $this->openPlatformDoors();
        $target = $this->seedTenant();
        $this->savePreferences($target, ['max_partnerships' => 1]);
        $this->seedPartnership($target, $this->seedTenant(), 'active');

        $result = FederationPartnershipService::requestPartnership($this->testTenantId, $target, 1);

        $this->assertFalse($result['success']);
        $this->assertNull($this->pendingBetween($this->testTenantId, $target));
    }

    public function test_the_displayed_default_limit_is_not_enforced_on_a_community_that_never_saved_one(): void
    {
        // The settings page SHOWS 10 for a community with nothing saved. That
        // is a placeholder, not a decision: making the limit real must not
        // take anything away from an existing community with many partners.
        $this->openPlatformDoors();
        for ($i = 0; $i < 11; $i++) {
            $this->seedPartnership($this->testTenantId, $this->seedTenant(), 'active');
        }
        $target = $this->seedTenant();

        $result = FederationPartnershipService::requestPartnership($this->testTenantId, $target, 1);

        $this->assertTrue($result['success'], (string) ($result['error'] ?? ''));
    }

    public function test_an_approval_is_refused_when_the_approver_is_at_its_limit(): void
    {
        $this->savePreferences($this->testTenantId, ['max_partnerships' => 1]);
        $this->seedPartnership($this->testTenantId, $this->seedTenant(), 'active');
        $requester = $this->seedTenant();
        $id = $this->seedPartnership($requester, $this->testTenantId, 'pending');

        $result = FederationPartnershipService::approvePartnership($id, 1);

        $this->assertFalse($result['success']);
        $this->assertSame('pending', DB::table('federation_partnerships')->where('id', $id)->value('status'));
    }

    public function test_policy_reads_what_the_settings_page_saved(): void
    {
        $tenant = $this->seedTenant();
        $this->assertSame(['allow_inbound' => true, 'max' => null], FederationPartnershipService::partnershipPolicy($tenant));

        $this->savePreferences($tenant, ['allow_inbound_partnerships' => false, 'max_partnerships' => 7]);
        $this->assertSame(['allow_inbound' => false, 'max' => 7], FederationPartnershipService::partnershipPolicy($tenant));
    }

    // ── 1c. Settings endpoint ────────────────────────────────────────────

    public function test_settings_no_longer_stores_or_echoes_the_retired_auto_approve_switch(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['is_tenant_super_admin' => true]);
        Sanctum::actingAs($admin);
        // A value saved before the switch was retired.
        $this->savePreferences($this->testTenantId, ['auto_approve_partners' => true]);

        $get = $this->apiGet('/v2/admin/federation/settings');
        $get->assertStatus(200);
        $this->assertArrayNotHasKey('auto_approve_partners', $get->json('data.settings'));

        $put = $this->apiPut('/v2/admin/federation/settings', [
            'settings' => ['allow_inbound_partnerships' => false, 'auto_approve_partners' => true, 'max_partnerships' => 500],
        ]);
        $put->assertStatus(200);

        $stored = json_decode((string) DB::table('tenants')->where('id', $this->testTenantId)->value('configuration'), true)['federation'];
        $this->assertArrayNotHasKey('auto_approve_partners', $stored);
        $this->assertFalse($stored['allow_inbound_partnerships']);
        $this->assertSame(100, $stored['max_partnerships'], 'the limit is clamped to what the page allows');

        // …and what was saved is what the enforcement reads.
        $this->assertSame(['allow_inbound' => false, 'max' => 100], FederationPartnershipService::partnershipPolicy($this->testTenantId));
    }

    // ── 2. Asking for a level, and accepting a counter-proposal ──────────

    public function test_a_request_can_ask_for_a_level_above_the_lowest(): void
    {
        $this->openPlatformDoors();
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);
        $target = $this->seedTenant();

        $response = $this->apiPost('/v2/admin/federation/partnerships/request', [
            'target_tenant_id' => $target,
            'federation_level' => 3,
        ]);

        $response->assertStatus(201);
        $this->assertSame(3, (int) $this->pendingBetween($this->testTenantId, $target)->federation_level);
    }

    public function test_a_request_without_a_level_stays_at_the_lowest(): void
    {
        $this->openPlatformDoors();
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create());
        $target = $this->seedTenant();

        $this->apiPost('/v2/admin/federation/partnerships/request', ['target_tenant_id' => $target])->assertStatus(201);

        $this->assertSame(1, (int) $this->pendingBetween($this->testTenantId, $target)->federation_level);
    }

    public function test_a_requested_level_is_held_to_the_platform_ceiling(): void
    {
        $this->openPlatformDoors(2);
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create());
        $target = $this->seedTenant();

        $this->apiPost('/v2/admin/federation/partnerships/request', [
            'target_tenant_id' => $target,
            'federation_level' => 4,
        ])->assertStatus(201);

        $this->assertSame(2, (int) $this->pendingBetween($this->testTenantId, $target)->federation_level);
    }

    public function test_a_nonsense_level_is_rejected(): void
    {
        $this->openPlatformDoors();
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create());
        $target = $this->seedTenant();

        $response = $this->apiPost('/v2/admin/federation/partnerships/request', [
            'target_tenant_id' => $target,
            'federation_level' => 9,
        ]);

        $this->assertContains($response->getStatusCode(), [400, 422]);
        $this->assertNull($this->pendingBetween($this->testTenantId, $target));
    }

    public function test_the_requester_can_accept_the_terms_the_other_community_sent_back(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);
        $partner = $this->seedTenant();
        $id = $this->seedPartnership($this->testTenantId, $partner, 'pending', [
            'counter_proposed_at' => now(),
            'counter_proposed_by' => 1,
            'counter_proposed_level' => 3,
            'counter_proposed_permissions' => json_encode(['events' => false]),
        ]);

        $response = $this->apiPost("/v2/admin/federation/partnerships/{$id}/accept-counter");

        $response->assertStatus(200);
        $row = DB::table('federation_partnerships')->where('id', $id)->first();
        $this->assertSame('active', $row->status);
        $this->assertSame(3, (int) $row->federation_level, 'the level they proposed is the level that goes live');
        $this->assertSame(1, (int) $row->transactions_enabled, 'level 3 carries exchanges');
        $this->assertSame(0, (int) $row->events_enabled, 'their explicit choice overrides the level default');
        $this->assertSame(0, (int) $row->groups_enabled, 'level 3 does not carry groups');
    }

    public function test_the_community_that_made_the_counter_proposal_cannot_accept_it_itself(): void
    {
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create());
        $requester = $this->seedTenant();
        // WE received the request and sent terms back; accepting is theirs to do.
        $id = $this->seedPartnership($requester, $this->testTenantId, 'pending', [
            'counter_proposed_at' => now(),
            'counter_proposed_level' => 4,
        ]);

        $response = $this->apiPost("/v2/admin/federation/partnerships/{$id}/accept-counter");

        $response->assertStatus(409);
        $this->assertSame('pending', DB::table('federation_partnerships')->where('id', $id)->value('status'));
    }

    public function test_a_request_with_no_counter_proposal_cannot_be_self_accepted(): void
    {
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create());
        $id = $this->seedPartnership($this->testTenantId, $this->seedTenant(), 'pending');

        $this->apiPost("/v2/admin/federation/partnerships/{$id}/accept-counter")->assertStatus(409);

        $this->assertSame('pending', DB::table('federation_partnerships')->where('id', $id)->value('status'));
    }

    public function test_accepting_another_pair_of_communities_counter_proposal_is_not_found(): void
    {
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create());
        $id = $this->seedPartnership($this->seedTenant('Stranger A'), $this->seedTenant('Stranger B'), 'pending', [
            'counter_proposed_at' => now(),
            'counter_proposed_level' => 4,
        ]);

        $this->apiPost("/v2/admin/federation/partnerships/{$id}/accept-counter")->assertStatus(404);

        $this->assertSame('pending', DB::table('federation_partnerships')->where('id', $id)->value('status'));
    }

    public function test_accept_counter_is_admin_only(): void
    {
        $id = $this->seedPartnership($this->testTenantId, $this->seedTenant(), 'pending', [
            'counter_proposed_at' => now(),
            'counter_proposed_level' => 2,
        ]);

        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->create());
        $this->apiPost("/v2/admin/federation/partnerships/{$id}/accept-counter")->assertStatus(403);

        $this->assertSame('pending', DB::table('federation_partnerships')->where('id', $id)->value('status'));
    }

    // ── 3. The list says which side of a request we are on ───────────────

    public function test_the_list_marks_which_side_of_each_request_the_caller_is_on(): void
    {
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create());
        $sent = $this->seedPartnership($this->testTenantId, $this->seedTenant(), 'pending', [
            'counter_proposed_at' => now(),
            'counter_proposed_level' => 2,
        ]);
        $received = $this->seedPartnership($this->seedTenant(), $this->testTenantId, 'pending');

        $response = $this->apiGet('/v2/admin/federation/partnerships');
        $response->assertStatus(200);
        $rows = collect($response->json('data'))->keyBy('id');

        $this->assertTrue($rows[$sent]['is_initiator']);
        $this->assertTrue($rows[$sent]['has_counter_proposal']);
        $this->assertFalse($rows[$received]['is_initiator']);
        $this->assertFalse($rows[$received]['has_counter_proposal']);
    }

    // ── 4. Pausing, and telling the other community (November 2026, second pass) ──
    //
    // "Reactivate" was offered on the Partnerships page, but only the platform
    // owner's panel could pause, so a community could not create the state it
    // was being offered a way out of. And nobody was told when different terms
    // came back, or (correctly) when anything else happened: every partnership
    // notification linked to /admin/federation, a page retired in July 2026.

    private function seedAdminOf(int $tenantId): User
    {
        return User::factory()->forTenant($tenantId)->admin()->create();
    }

    private function notificationsFor(int $userId): \Illuminate\Support\Collection
    {
        return DB::table('notifications')->where('user_id', $userId)->get();
    }

    public function test_a_community_can_pause_an_active_partnership(): void
    {
        Sanctum::actingAs($this->seedAdminOf($this->testTenantId));
        $partner = $this->seedTenant('Paused Partner');
        $partnerAdmin = $this->seedAdminOf($partner);
        $id = $this->seedPartnership($partner, $this->testTenantId, 'active');

        $this->apiPost("/v2/admin/federation/partnerships/{$id}/suspend")->assertStatus(200);

        $row = DB::table('federation_partnerships')->where('id', $id)->first();
        $this->assertSame('suspended', $row->status);
        $this->assertSame($this->testTenantId, (int) $row->suspended_by_tenant_id, 'records who paused, so only they can resume');

        // The other community is told, and the notification opens a page that exists.
        $notes = $this->notificationsFor($partnerAdmin->id);
        $this->assertCount(1, $notes);
        $this->assertSame('/partner-timebanks/partnerships', $notes[0]->link);
        $this->assertStringNotContainsString('{{', $notes[0]->message);
    }

    public function test_the_community_that_paused_can_resume_and_the_message_names_it(): void
    {
        Sanctum::actingAs($this->seedAdminOf($this->testTenantId));
        $partner = $this->seedTenant('Resumed Partner');
        $partnerAdmin = $this->seedAdminOf($partner);
        $id = $this->seedPartnership($this->testTenantId, $partner, 'active');

        $this->apiPost("/v2/admin/federation/partnerships/{$id}/suspend")->assertStatus(200);
        $this->apiPost("/v2/admin/federation/partnerships/{$id}/reactivate")->assertStatus(200);

        $this->assertSame('active', DB::table('federation_partnerships')->where('id', $id)->value('status'));
        // The reactivated message used a {{partner}} placeholder nothing filled.
        foreach ($this->notificationsFor($partnerAdmin->id) as $note) {
            $this->assertStringNotContainsString('{{', $note->message);
            $this->assertSame('/partner-timebanks/partnerships', $note->link);
        }
    }

    public function test_only_an_active_partnership_can_be_paused(): void
    {
        Sanctum::actingAs($this->seedAdminOf($this->testTenantId));
        $id = $this->seedPartnership($this->seedTenant(), $this->testTenantId, 'pending');

        $this->apiPost("/v2/admin/federation/partnerships/{$id}/suspend")->assertStatus(409);

        $this->assertSame('pending', DB::table('federation_partnerships')->where('id', $id)->value('status'));
    }

    public function test_pausing_another_pair_of_communities_partnership_is_not_found(): void
    {
        Sanctum::actingAs($this->seedAdminOf($this->testTenantId));
        $id = $this->seedPartnership($this->seedTenant('Stranger C'), $this->seedTenant('Stranger D'), 'active');

        $this->apiPost("/v2/admin/federation/partnerships/{$id}/suspend")->assertStatus(404);

        $this->assertSame('active', DB::table('federation_partnerships')->where('id', $id)->value('status'));
    }

    public function test_pausing_is_admin_only(): void
    {
        $id = $this->seedPartnership($this->seedTenant(), $this->testTenantId, 'active');

        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->create());
        $this->apiPost("/v2/admin/federation/partnerships/{$id}/suspend")->assertStatus(403);

        $this->assertSame('active', DB::table('federation_partnerships')->where('id', $id)->value('status'));
    }

    public function test_the_community_that_asked_is_told_when_different_terms_come_back(): void
    {
        $this->openPlatformDoors();
        Sanctum::actingAs($this->seedAdminOf($this->testTenantId));
        $requester = $this->seedTenant('Asking Community');
        $requesterAdmin = $this->seedAdminOf($requester);
        $id = $this->seedPartnership($requester, $this->testTenantId, 'pending');

        $this->apiPost("/v2/admin/federation/partnerships/{$id}/counter-propose", [
            'level' => 2,
            'permissions' => ['profiles' => true, 'messaging' => true],
            'message' => 'Could we start smaller?',
        ])->assertStatus(200);

        $notes = $this->notificationsFor($requesterAdmin->id);
        $this->assertCount(1, $notes, 'until November 2026 nobody was told');
        $this->assertSame('/partner-timebanks/partnerships', $notes[0]->link);
        $this->assertStringNotContainsString('{{', $notes[0]->message);
        $this->assertSame('federation_partnership_counter_proposed', $notes[0]->type);
    }
}
