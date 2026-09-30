<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E073;

use App\Core\SuperPanelAccess;
use App\Core\TenantContext;
use App\Models\User;
use App\Support\Authorization\AdminTier;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-453 (E-073 G-2) — moving an account between communities must not carry its
 * administrator authority into the destination.
 *
 * User::moveTenant() updated `tenant_id` and nothing else.
 * AdminSuperController::userMoveTenant() cleared is_tenant_super_admin ONLY when
 * the destination cannot have sub-communities, and bulkMoveUsers() carried the
 * identical single conditional; `role`, `is_admin`, `is_super_admin` and
 * `is_god` were never considered. So a community administrator of A, moved into
 * B, arrived administering B — appointed by nobody there — and a network
 * administrator moved between hubs kept the flag, which App\Core\SuperPanelAccess
 * evaluates against the account's CURRENT tenant, silently transplanting their
 * regional scope onto B's subtree.
 *
 * The fix clears the COMMUNITY-scoped authority inside User::moveTenant()
 * itself, so every caller is covered: an admin-tier `role` drops to `member`,
 * and is_admin / is_tenant_super_admin are cleared. The two routes that
 * deliberately promote on arrival (userMoveAndPromote, bulkMoveUsers with
 * grant_super_admin) re-grant immediately afterwards and are pinned by a
 * control.
 *
 * is_super_admin and is_god are deliberately NOT cleared: they are PLATFORM
 * authority, not authority over the community the account happens to sit in, so
 * a move says nothing about whether they should be held. (is_god is additionally
 * out of scope by observation O-113 — no route anywhere clears it.) A control
 * pins that decision.
 *
 * F-142 — the actor must strictly outrank the target, so a regional (hub) super
 * admin cannot move a peer — is re-tested here and must keep holding.
 */
final class F453MoveTenantDropsCommunityAuthorityTest extends TestCase
{
    use DatabaseTransactions;

    private const HUB_A_ID = 90741;
    private const HUB_B_ID = 90742;
    private const PLAIN_ID = 90743;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);
        $this->app['auth']->forgetGuards();
        Cache::flush();
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
        $this->makeTenant(self::HUB_A_ID, 'e074d-hub-a', true);
        $this->makeTenant(self::HUB_B_ID, 'e074d-hub-b', true);
        $this->makeTenant(self::PLAIN_ID, 'e074d-plain', false);
        SuperPanelAccess::reset();
    }

    /**
     * THE HARM (community tier) — a community administrator of A moved into B
     * must arrive with no authority over B.
     */
    public function test_a_community_administrator_does_not_administer_the_destination_community(): void
    {
        $actor = $this->platformSuperAdmin();
        $target = $this->accountIn(self::HUB_A_ID, ['role' => 'admin', 'is_admin' => 1]);

        Sanctum::actingAs($actor, ['*']);
        $move = $this->apiPost("/v2/admin/super/users/{$target->id}/move-tenant", [
            'new_tenant_id' => self::HUB_B_ID,
        ]);
        self::assertSame(200, $move->getStatusCode(), 'the move was accepted. ' . $move->getContent());

        $after = $this->row($target);
        self::assertSame(self::HUB_B_ID, (int) $after->tenant_id, 'the account is now in community B');
        self::assertSame('member', (string) $after->role, 'F-453: the administrator role must not travel');
        self::assertSame(0, (int) $after->is_admin, 'F-453: is_admin must not travel');
        self::assertFalse(AdminTier::allows((array) $after), 'F-453: no admin-tier authority survives the move');

        $this->app['auth']->forgetGuards();
        SuperPanelAccess::reset();
        Sanctum::actingAs(User::withoutGlobalScopes()->find($target->id), ['*']);
        $listing = $this->tenantGet(self::HUB_B_ID, '/v2/admin/users?page=1&per_page=1');
        self::assertContains(
            $listing->getStatusCode(),
            [401, 403],
            'F-453: the moved account is refused community B\'s administrator member list. ' . $listing->getContent()
        );
    }

    /**
     * THE HARM (network tier) — a network administrator of hub A moved into hub
     * B must not arrive holding the network flag, which would transplant their
     * regional scope onto B's subtree.
     */
    public function test_a_network_administrator_does_not_keep_the_network_flag_across_a_move(): void
    {
        $actor = $this->platformSuperAdmin();
        $target = $this->accountIn(self::HUB_A_ID, [
            'role' => 'admin', 'is_admin' => 1, 'is_tenant_super_admin' => 1,
        ]);

        SuperPanelAccess::reset();
        $scopeBefore = SuperPanelAccess::getAccess((int) $target->id);
        self::assertTrue((bool) $scopeBefore['granted'], 'precondition: a network administrator of hub A');

        $this->app['auth']->forgetGuards();
        SuperPanelAccess::reset();
        Sanctum::actingAs($actor, ['*']);
        $move = $this->apiPost("/v2/admin/super/users/{$target->id}/move-tenant", [
            'new_tenant_id' => self::HUB_B_ID,
        ]);
        self::assertSame(200, $move->getStatusCode(), 'the move was accepted. ' . $move->getContent());

        $after = $this->row($target);
        self::assertSame(self::HUB_B_ID, (int) $after->tenant_id);
        self::assertSame(
            0,
            (int) $after->is_tenant_super_admin,
            'F-453: the network-administrator flag must not survive a move into a different hub'
        );

        SuperPanelAccess::reset();
        $scopeAfter = SuperPanelAccess::getAccess((int) $target->id);
        self::assertFalse(
            (bool) $scopeAfter['granted'],
            'F-453: the moved account has no super-panel scope over the destination subtree'
        );
    }

    /**
     * THE HARM (bulk route) — bulkMoveUsers() carried the identical conditional
     * and was never driven by the engagement that found this.
     */
    public function test_the_bulk_move_route_also_drops_community_authority(): void
    {
        $actor = $this->platformSuperAdmin();
        $target = $this->accountIn(self::HUB_A_ID, [
            'role' => 'admin', 'is_admin' => 1, 'is_tenant_super_admin' => 1,
        ]);

        Sanctum::actingAs($actor, ['*']);
        $move = $this->apiPost('/v2/admin/super/bulk/move-users', [
            'user_ids' => [(int) $target->id],
            'target_tenant_id' => self::HUB_B_ID,
        ]);
        self::assertSame(200, $move->getStatusCode(), $move->getContent());
        self::assertSame(1, (int) $move->json('data.moved_count'), 'the bulk move happened. ' . $move->getContent());

        $after = $this->row($target);
        self::assertSame(self::HUB_B_ID, (int) $after->tenant_id);
        self::assertSame('member', (string) $after->role, 'F-453: the bulk route must drop the role too');
        self::assertSame(0, (int) $after->is_admin, 'F-453: and is_admin');
        self::assertSame(0, (int) $after->is_tenant_super_admin, 'F-453: and the network flag');
        self::assertFalse(AdminTier::allows((array) $after));
    }

    /**
     * THE HARM (record) — the audit entry recorded `tenant_id` old→new and
     * nothing else, while the sibling move-and-promote route records the flag it
     * grants. The authority a move REMOVES must be recorded too.
     */
    public function test_the_move_audit_entry_records_the_authority_it_removed(): void
    {
        $actor = $this->platformSuperAdmin();
        $target = $this->accountIn(self::HUB_A_ID, [
            'role' => 'admin', 'is_admin' => 1, 'is_tenant_super_admin' => 1,
        ]);

        Sanctum::actingAs($actor, ['*']);
        $this->apiPost("/v2/admin/super/users/{$target->id}/move-tenant", [
            'new_tenant_id' => self::HUB_B_ID,
        ])->assertStatus(200);

        $entry = DB::table('super_admin_audit_log')
            ->where('action_type', 'user_moved')
            ->where('target_id', (int) $target->id)
            ->orderByDesc('id')
            ->first(['old_values', 'new_values']);
        self::assertNotNull($entry, 'the move is audited at all');

        $old = json_decode((string) $entry->old_values, true);
        $new = json_decode((string) $entry->new_values, true);
        self::assertIsArray($old);
        self::assertIsArray($new);

        self::assertSame(self::HUB_A_ID, (int) $old['tenant_id'], 'the move itself is still recorded');
        self::assertSame(self::HUB_B_ID, (int) $new['tenant_id']);
        self::assertSame('admin', (string) ($old['role'] ?? ''), 'F-453: the role held before the move is recorded');
        self::assertSame('member', (string) ($new['role'] ?? ''), 'F-453: and the role after it');
        self::assertSame(1, (int) ($old['is_admin'] ?? -1), 'F-453: is_admin before');
        self::assertSame(0, (int) ($new['is_admin'] ?? -1), 'F-453: is_admin after');
        self::assertSame(1, (int) ($old['is_tenant_super_admin'] ?? -1), 'F-453: the network flag before');
        self::assertSame(0, (int) ($new['is_tenant_super_admin'] ?? -1), 'F-453: and after');
    }

    /**
     * LEGITIMATE-ACCESS CONTROL — the move itself must keep working for the
     * ordinary case. An ordinary member moved by the same operator between the
     * same two communities arrives, unchanged, as a member. The harm cases
     * differ from this one only in what the account was carrying.
     */
    public function test_control_an_ordinary_member_still_moves_normally(): void
    {
        $actor = $this->platformSuperAdmin();
        $target = $this->accountIn(self::HUB_A_ID, ['role' => 'member']);

        Sanctum::actingAs($actor, ['*']);
        $move = $this->apiPost("/v2/admin/super/users/{$target->id}/move-tenant", [
            'new_tenant_id' => self::HUB_B_ID,
        ]);
        self::assertSame(200, $move->getStatusCode(), 'control: the move still succeeds. ' . $move->getContent());

        $after = $this->row($target);
        self::assertSame(self::HUB_B_ID, (int) $after->tenant_id, 'control: the member really did move');
        self::assertSame('member', (string) $after->role);
        self::assertFalse(AdminTier::allows((array) $after));
    }

    /**
     * CONTROL — PLATFORM authority is not community authority. is_super_admin is
     * held across the whole installation, so a move must leave it alone; only
     * the community-scoped authority is dropped.
     */
    public function test_control_a_move_does_not_strip_platform_wide_authority(): void
    {
        $actor = $this->god();
        $target = $this->accountIn(self::HUB_A_ID, ['role' => 'member', 'is_super_admin' => 1]);

        Sanctum::actingAs($actor, ['*']);
        $this->apiPost("/v2/admin/super/users/{$target->id}/move-tenant", [
            'new_tenant_id' => self::HUB_B_ID,
        ])->assertStatus(200);

        $after = $this->row($target);
        self::assertSame(self::HUB_B_ID, (int) $after->tenant_id);
        self::assertSame(
            1,
            (int) $after->is_super_admin,
            'control: platform super-admin is not scoped to a community and must survive a move'
        );
    }

    /**
     * CONTROL — the route whose whole purpose is to promote on arrival must keep
     * promoting, so the fix is a guard on the plain move and not a removal of a
     * feature.
     */
    public function test_control_move_and_promote_still_grants_authority_in_the_destination(): void
    {
        $actor = $this->platformSuperAdmin();
        $target = $this->accountIn(self::HUB_A_ID, ['role' => 'member']);

        Sanctum::actingAs($actor, ['*']);
        $res = $this->apiPost("/v2/admin/super/users/{$target->id}/move-and-promote", [
            'target_tenant_id' => self::HUB_B_ID,
        ]);
        self::assertSame(200, $res->getStatusCode(), $res->getContent());

        $after = $this->row($target);
        self::assertSame(self::HUB_B_ID, (int) $after->tenant_id);
        self::assertSame('admin', (string) $after->role, 'control: move-and-promote still promotes');
        self::assertSame(1, (int) $after->is_tenant_super_admin, 'control: and still grants the network flag');
        self::assertTrue(AdminTier::allows((array) $after));
    }

    /**
     * RE-TEST of F-142 on this exact route — a hub network administrator may not
     * move a peer network administrator. It must keep holding.
     */
    public function test_retest_f142_a_regional_actor_cannot_move_a_peer(): void
    {
        $regional = $this->accountIn(self::HUB_A_ID, [
            'role' => 'admin', 'is_admin' => 1, 'is_tenant_super_admin' => 1,
        ]);
        $peer = $this->accountIn(self::HUB_A_ID, [
            'role' => 'admin', 'is_admin' => 1, 'is_tenant_super_admin' => 1,
        ]);

        $this->app['auth']->forgetGuards();
        SuperPanelAccess::reset();
        Sanctum::actingAs(User::withoutGlobalScopes()->find($regional->id), ['*']);
        $move = $this->tenantPost(self::HUB_A_ID, "/v2/admin/super/users/{$peer->id}/move-tenant", [
            'new_tenant_id' => self::HUB_B_ID,
        ]);
        self::assertNotSame(200, $move->getStatusCode(), 'F-142 re-test: the peer move is refused. ' . $move->getContent());
        self::assertSame(self::HUB_A_ID, (int) $this->row($peer)->tenant_id, 'F-142 re-test: the peer did not move');
        self::assertSame('admin', (string) $this->row($peer)->role, 'F-142 re-test: and kept its own role');
    }

    // ── helpers / fixtures ──────────────────────────────────────────────────

    private function tenantGet(int $tenantId, string $uri): \Illuminate\Testing\TestResponse
    {
        return $this->getJson('/api' . $uri, [
            'X-Tenant-ID' => (string) $tenantId,
            'Accept' => 'application/json',
        ]);
    }

    /** @param array<string,mixed> $data */
    private function tenantPost(int $tenantId, string $uri, array $data = []): \Illuminate\Testing\TestResponse
    {
        return $this->postJson('/api' . $uri, $data, [
            'X-Tenant-ID' => (string) $tenantId,
            'Accept' => 'application/json',
        ]);
    }

    private function row(User $u): object
    {
        return DB::table('users')->where('id', $u->id)
            ->first(['id', 'tenant_id', 'role', 'is_admin', 'is_super_admin', 'is_tenant_super_admin', 'is_god']);
    }

    private function makeTenant(int $id, string $slug, bool $hub): void
    {
        DB::table('tenants')->updateOrInsert(
            ['id' => $id],
            [
                'name' => 'E074D ' . $slug,
                'slug' => $slug,
                'domain' => null,
                'is_active' => 1,
                'depth' => 0,
                'path' => '/' . $id . '/',
                'allows_subtenants' => $hub ? 1 : 0,
                'max_depth' => $hub ? 2 : 0,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );
    }

    /** @param array<string,mixed> $flags */
    private function accountIn(int $tenantId, array $flags): User
    {
        $u = User::factory()->forTenant($tenantId)->create([
            'status' => 'active', 'is_approved' => 1, 'role' => 'member',
        ]);
        DB::table('users')->where('id', $u->id)->update(array_merge([
            'tenant_id' => $tenantId,
            'role' => 'member',
            'is_admin' => 0,
            'is_super_admin' => 0,
            'is_tenant_super_admin' => 0,
            'is_god' => 0,
        ], $flags));

        return User::withoutGlobalScopes()->find($u->id);
    }

    private function platformSuperAdmin(): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
        DB::table('users')->where('id', $u->id)->update([
            'is_super_admin' => 1,
            'role' => 'admin',
        ]);

        return User::withoutGlobalScopes()->find($u->id);
    }

    private function god(): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
        DB::table('users')->where('id', $u->id)->update([
            'is_super_admin' => 1,
            'is_god' => 1,
            'role' => 'admin',
        ]);

        return User::withoutGlobalScopes()->find($u->id);
    }
}
