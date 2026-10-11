<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\SuperAdmin;

use App\Core\SuperPanelAccess;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Owner decision, 11 October 2026: "I don't want tenant admins to act outside of
 * the home community or tenant super admins, or normal tenant admins."
 *
 * Only the platform owner (is_super_admin / is_god, or the super_admin / god
 * role strings) may act across communities in the super panel. A tenant super
 * admin — of a hub community, or even of the master community (tenant 1) —
 * reaches its OWN community and nothing else: not the sub-communities beneath
 * it, not a sibling, not the rest of the installation.
 *
 * Until this change SuperPanelAccess gave a hub's tenant super admin a
 * "regional" level over its whole sub-community subtree, and treated a tenant
 * super admin on the master community as "master" over every community.
 *
 * The fixture is a real parent/child pair: hub P ('/8300/') with child C
 * ('/8300/8301/') and a second child C2, plus an unrelated community O
 * ('/8400/'). C is itself a hub, so the grant-tenant-super-admin and
 * move-and-promote refusals are refusals of reach, not of hub capability.
 */
class TenantSuperAdminPanelHomeCommunityTest extends TestCase
{
    use DatabaseTransactions;

    private int $parentId;
    private int $childId;
    private int $secondChildId;
    private int $otherId;
    private User $parentSuperAdmin;
    private User $childMember;
    private User $parentMember;

    protected function setUp(): void
    {
        parent::setUp();
        SuperPanelAccess::reset();

        $this->parentId = $this->makeTenant('HomeRule Parent', '/8300/', true, null);
        $this->childId = $this->makeTenant('HomeRule Child', '/8300/8301/', true, $this->parentId);
        $this->secondChildId = $this->makeTenant('HomeRule Second Child', '/8300/8302/', false, $this->parentId);
        $this->otherId = $this->makeTenant('HomeRule Other', '/8400/', true, null);

        $this->parentSuperAdmin = $this->makeUser($this->parentId, 'admin', [
            'is_tenant_super_admin' => 1, 'is_super_admin' => 0, 'is_god' => 0,
        ], 'Parent', 'Superadmin');

        $this->childMember = $this->makeUser($this->childId, 'member', [], 'Childa', 'Childmember');
        $this->parentMember = $this->makeUser($this->parentId, 'member', [], 'Parenta', 'Parentmember');
    }

    protected function tearDown(): void
    {
        SuperPanelAccess::reset();
        parent::tearDown();
    }

    private function makeTenant(string $name, string $path, bool $hub, ?int $parentId): int
    {
        return (int) DB::table('tenants')->insertGetId([
            'name' => $name,
            'slug' => strtolower(str_replace(' ', '-', $name)) . '-' . uniqid('', false),
            'is_active' => 1,
            'allows_subtenants' => $hub ? 1 : 0,
            'parent_id' => $parentId,
            'depth' => substr_count(rtrim($path, '/'), '/') - 1,
            'path' => $path,
            'max_depth' => 3,
        ]);
    }

    /** @param array<string,mixed> $flags */
    private function makeUser(int $tenantId, string $role, array $flags, string $first, string $last): User
    {
        $factory = User::factory()->forTenant($tenantId);
        if ($role === 'admin') {
            $factory = $factory->admin();
        }
        $user = $factory->create([
            'first_name' => $first,
            'last_name' => $last,
            'status' => 'active',
            'is_approved' => true,
        ]);
        if ($flags !== []) {
            DB::table('users')->where('id', $user->id)->update($flags);
        }
        // Sanctum::actingAs() authenticates the in-memory model, so the flags set
        // by the raw UPDATE must be read back before acting as this user.
        $user->refresh();

        return $user;
    }

    private function actAs(User $user, int $tenantId): void
    {
        SuperPanelAccess::reset();
        // withTenant() is required: without it ResolveTenant refuses the request
        // with tenant_mismatch before the panel gate is consulted, and every
        // refusal below would pass for the wrong reason.
        $this->withTenant($tenantId);
        Sanctum::actingAs($user);
    }

    private function actAsParentSuperAdmin(): void
    {
        $this->actAs($this->parentSuperAdmin, $this->parentId);
    }

    private function platformOwner(string $flag): User
    {
        $flags = $flag === 'god'
            ? ['is_god' => 1, 'is_super_admin' => 0, 'is_tenant_super_admin' => 0]
            : ['is_super_admin' => 1, 'is_god' => 0, 'is_tenant_super_admin' => 0];

        return $this->makeUser(1, 'admin', $flags, 'Platform', 'Owner' . $flag);
    }

    private function isActive(int $tenantId): int
    {
        return (int) DB::table('tenants')->where('id', $tenantId)->value('is_active');
    }

    private function tenantOf(User $user): int
    {
        return (int) DB::table('users')->where('id', $user->id)->value('tenant_id');
    }

    // ── Access resolution ───────────────────────────────────────────────────

    public function test_a_parent_tenant_super_admin_reaches_its_own_community_only(): void
    {
        SuperPanelAccess::reset();
        $access = SuperPanelAccess::getAccess((int) $this->parentSuperAdmin->id);

        $this->assertTrue($access['granted'], 'The own-community panel stays available.');
        $this->assertNotSame('master', $access['level']);
        $this->assertFalse($access['can_create_tenants']);
        $this->assertTrue(SuperPanelAccess::canAccessTenant($this->parentId));
        $this->assertFalse(SuperPanelAccess::canAccessTenant($this->childId), 'A sub-community is another community.');
        $this->assertFalse(SuperPanelAccess::canAccessTenant($this->otherId));
        $this->assertFalse(SuperPanelAccess::canManageTenant($this->childId));
        $this->assertFalse(SuperPanelAccess::canCreateSubtenantUnder($this->parentId)['allowed']);
        $this->assertFalse(SuperPanelAccess::hasPlatformReach());
    }

    public function test_a_tenant_super_admin_on_the_master_community_is_not_master(): void
    {
        $masterTsa = $this->makeUser(1, 'admin', [
            'is_tenant_super_admin' => 1, 'is_super_admin' => 0, 'is_god' => 0,
        ], 'Master', 'Tenantsuper');

        SuperPanelAccess::reset();
        $access = SuperPanelAccess::getAccess((int) $masterTsa->id);

        $this->assertNotSame('master', $access['level']);
        $this->assertFalse(SuperPanelAccess::canAccessTenant($this->otherId));
        $this->assertFalse(SuperPanelAccess::canAccessTenant($this->parentId));
        $this->assertFalse(SuperPanelAccess::hasPlatformReach());
    }

    // ── Reading another community ───────────────────────────────────────────

    public function test_lists_show_its_own_community_and_none_beneath_it(): void
    {
        $this->actAsParentSuperAdmin();

        $tenants = json_encode($this->apiGet('/v2/admin/super/tenants')->assertStatus(200)->json('data'));
        $this->assertStringContainsString('HomeRule Parent', $tenants);
        $this->assertStringNotContainsString('HomeRule Child', $tenants);
        $this->assertStringNotContainsString('HomeRule Other', $tenants);

        $tree = json_encode($this->apiGet('/v2/admin/super/tenants/hierarchy')->assertStatus(200)->json('data'));
        $this->assertStringContainsString('HomeRule Parent', $tree);
        $this->assertStringNotContainsString('HomeRule Child', $tree);

        $users = json_encode($this->apiGet('/v2/admin/super/users')->assertStatus(200)->json('data'));
        $this->assertStringContainsString('Parentmember', $users);
        $this->assertStringNotContainsString('Childmember', $users);

        $dashboard = $this->apiGet('/v2/admin/super/dashboard')->assertStatus(200)->json('data');
        $this->assertSame(1, (int) ($dashboard['total_tenants'] ?? -1), 'Only its own community is counted.');
    }

    public function test_a_sub_community_and_its_members_cannot_be_read(): void
    {
        $this->actAsParentSuperAdmin();

        $this->apiGet("/v2/admin/super/tenants/{$this->childId}")->assertStatus(404);
        $this->apiGet("/v2/admin/super/users/{$this->childMember->id}")->assertStatus(403);
    }

    // ── Changing another community ──────────────────────────────────────────

    public function test_a_sub_community_cannot_be_edited_deactivated_reactivated_or_restructured(): void
    {
        $this->actAsParentSuperAdmin();

        $this->apiPut("/v2/admin/super/tenants/{$this->childId}", ['name' => 'Renamed From Above'])
            ->assertStatus(403);
        $this->assertSame('HomeRule Child', DB::table('tenants')->where('id', $this->childId)->value('name'));

        $this->apiDelete("/v2/admin/super/tenants/{$this->childId}")->assertStatus(403);
        $this->assertSame(1, $this->isActive($this->childId));

        $this->apiPost("/v2/admin/super/tenants/{$this->childId}/toggle-hub", ['enable' => false])
            ->assertStatus(403);
        $this->assertSame(1, (int) DB::table('tenants')->where('id', $this->childId)->value('allows_subtenants'));

        $this->apiPost('/v2/admin/super/bulk/update-tenants', [
            'tenant_ids' => [$this->childId],
            'action' => 'deactivate',
        ]);
        $this->assertSame(1, $this->isActive($this->childId));

        DB::table('tenants')->where('id', $this->secondChildId)->update(['is_active' => 0]);
        $this->apiPost("/v2/admin/super/tenants/{$this->secondChildId}/reactivate", [])->assertStatus(403);
        $this->assertSame(0, $this->isActive($this->secondChildId));
    }

    public function test_a_sub_community_cannot_be_created_or_moved(): void
    {
        $this->actAsParentSuperAdmin();

        $this->apiPost('/v2/admin/super/tenants', [
            'name' => 'Created From Below',
            'slug' => 'created-from-below-' . uniqid('', false),
            'parent_id' => $this->parentId,
        ])->assertStatus(403);
        $this->assertDatabaseMissing('tenants', ['name' => 'Created From Below']);

        $this->apiPost("/v2/admin/super/tenants/{$this->secondChildId}/move", [
            'new_parent_id' => $this->childId,
        ])->assertStatus(403);
        $this->assertSame(
            $this->parentId,
            (int) DB::table('tenants')->where('id', $this->secondChildId)->value('parent_id')
        );
    }

    public function test_users_in_a_sub_community_cannot_be_created_edited_or_promoted(): void
    {
        $this->actAsParentSuperAdmin();

        $email = 'home-rule-' . uniqid('', false) . '@example.test';
        $this->apiPost('/v2/admin/super/users', [
            'tenant_id' => $this->childId,
            'email' => $email,
            'first_name' => 'Smuggled',
            'last_name' => 'Below',
            'password' => 'TestPassword123!',
        ])->assertStatus(403);
        $this->assertDatabaseMissing('users', ['email' => $email]);

        $this->apiPut("/v2/admin/super/users/{$this->childMember->id}", ['first_name' => 'Altered'])
            ->assertStatus(403);
        $this->assertSame('Childa', DB::table('users')->where('id', $this->childMember->id)->value('first_name'));

        $this->apiPost("/v2/admin/super/users/{$this->childMember->id}/grant-super-admin", [])
            ->assertStatus(403);
        $this->assertSame(
            0,
            (int) DB::table('users')->where('id', $this->childMember->id)->value('is_tenant_super_admin')
        );
    }

    public function test_a_member_cannot_be_moved_into_or_out_of_a_sub_community(): void
    {
        $this->actAsParentSuperAdmin();

        // Out of the sub-community into its own...
        $this->apiPost("/v2/admin/super/users/{$this->childMember->id}/move-tenant", [
            'new_tenant_id' => $this->parentId,
        ])->assertStatus(403);
        // ...from its own into the sub-community...
        $this->apiPost("/v2/admin/super/users/{$this->parentMember->id}/move-tenant", [
            'new_tenant_id' => $this->childId,
        ])->assertStatus(403);
        // ...moving and promoting...
        $this->apiPost("/v2/admin/super/users/{$this->parentMember->id}/move-and-promote", [
            'target_tenant_id' => $this->childId,
        ])->assertStatus(403);
        // ...and in bulk.
        $this->apiPost('/v2/admin/super/bulk/move-users', [
            'user_ids' => [$this->childMember->id],
            'target_tenant_id' => $this->parentId,
        ])->assertStatus(403);

        $this->assertSame($this->childId, $this->tenantOf($this->childMember));
        $this->assertSame($this->parentId, $this->tenantOf($this->parentMember));
        $this->assertSame(
            0,
            (int) DB::table('users')->where('id', $this->parentMember->id)->value('is_tenant_super_admin')
        );
    }

    public function test_a_sub_community_member_or_admin_cannot_be_impersonated(): void
    {
        $childBroker = $this->makeUser($this->childId, 'member', ['role' => 'broker'], 'Childb', 'Broker');
        $this->actAsParentSuperAdmin();

        $this->apiPost("/v2/admin/super/users/{$this->childMember->id}/impersonate", [])->assertStatus(403);
        $this->apiPost("/v2/admin/super/users/{$childBroker->id}/impersonate", [])->assertStatus(403);
    }

    public function test_a_sub_community_federation_switches_cannot_be_read_or_changed(): void
    {
        $this->actAsParentSuperAdmin();

        $this->apiGet("/v2/admin/super/federation/tenant/{$this->childId}/features")->assertStatus(403);
        $this->apiPut("/v2/admin/super/federation/tenant/{$this->childId}/features", [
            'feature' => 'tenant_federation_enabled',
            'enabled' => true,
        ])->assertStatus(403);
    }

    public function test_a_master_community_tenant_super_admin_cannot_act_on_another_community(): void
    {
        $masterTsa = $this->makeUser(1, 'admin', [
            'is_tenant_super_admin' => 1, 'is_super_admin' => 0, 'is_god' => 0,
        ], 'Master', 'Tenantsuper');
        $this->actAs($masterTsa, 1);

        $this->assertContains($this->apiGet("/v2/admin/super/tenants/{$this->otherId}")->getStatusCode(), [403, 404]);
        $this->assertSame(403, $this->apiPut("/v2/admin/super/tenants/{$this->otherId}", ['name' => 'Taken Over'])->getStatusCode());
        $this->assertSame(403, $this->apiPost("/v2/admin/super/users/{$this->childMember->id}/impersonate", [])->getStatusCode());
        $this->assertSame(403, $this->apiPost("/v2/admin/super/users/{$this->childMember->id}/move-tenant", [
            'new_tenant_id' => $this->otherId,
        ])->getStatusCode());

        $this->assertSame('HomeRule Other', DB::table('tenants')->where('id', $this->otherId)->value('name'));
        $this->assertSame($this->childId, $this->tenantOf($this->childMember));
    }

    // ── Its own community still works ───────────────────────────────────────

    public function test_its_own_community_and_members_remain_available(): void
    {
        $this->actAsParentSuperAdmin();

        $this->apiGet("/v2/admin/super/tenants/{$this->parentId}")->assertStatus(200);
        $this->apiPut("/v2/admin/super/tenants/{$this->parentId}", ['tagline' => 'Our own words'])
            ->assertStatus(200);
        $this->apiGet("/v2/admin/super/users/{$this->parentMember->id}")->assertStatus(200);
        $this->apiPut("/v2/admin/super/users/{$this->parentMember->id}", ['first_name' => 'Renamed'])
            ->assertStatus(200);
        $this->apiPost("/v2/admin/super/users/{$this->parentMember->id}/impersonate", [])->assertStatus(200);
        $this->apiGet("/v2/admin/super/federation/tenant/{$this->parentId}/features")->assertStatus(200);
    }

    public function test_a_master_community_tenant_super_admin_keeps_its_own_community(): void
    {
        // The test database's tenant 1 is not a hub and has no path; give it the
        // shape the live master has, inside this test's transaction.
        DB::table('tenants')->where('id', 1)->update(['allows_subtenants' => 1, 'path' => '/1/']);
        $masterTsa = $this->makeUser(1, 'admin', [
            'is_tenant_super_admin' => 1, 'is_super_admin' => 0, 'is_god' => 0,
        ], 'Master', 'Tenantsuper');
        $this->actAs($masterTsa, 1);

        $this->apiGet('/v2/admin/super/tenants/1')->assertStatus(200);
        $this->apiGet("/v2/admin/super/tenants/{$this->otherId}")->assertStatus(404);
        $this->assertSame(1, (int) ($this->apiGet('/v2/admin/super/dashboard')->assertStatus(200)->json('data.total_tenants') ?? -1));
    }

    // ── The platform owner is unaffected ────────────────────────────────────

    public function test_a_platform_owner_keeps_full_reach(): void
    {
        foreach (['super_admin', 'god'] as $flag) {
            $owner = $this->platformOwner($flag);

            SuperPanelAccess::reset();
            $access = SuperPanelAccess::getAccess((int) $owner->id);
            $this->assertSame('master', $access['level'], "is_{$flag} must keep master level");
            $this->assertTrue($access['can_create_tenants']);
            $this->assertTrue(SuperPanelAccess::hasPlatformReach());
            $this->assertTrue(SuperPanelAccess::canAccessTenant($this->childId));
            $this->assertTrue(SuperPanelAccess::canManageTenant($this->childId));
        }
    }

    public function test_a_platform_owner_can_still_act_across_communities(): void
    {
        $owner = $this->platformOwner('super_admin');
        $this->actAs($owner, 1);

        $tenants = json_encode($this->apiGet('/v2/admin/super/tenants')->assertStatus(200)->json('data'));
        $this->assertStringContainsString('HomeRule Child', $tenants);
        $this->assertStringContainsString('HomeRule Other', $tenants);

        $this->apiGet("/v2/admin/super/tenants/{$this->childId}")->assertStatus(200);
        $this->apiPut("/v2/admin/super/tenants/{$this->childId}", ['name' => 'HomeRule Child Renamed'])
            ->assertStatus(200);
        $this->apiGet("/v2/admin/super/users/{$this->childMember->id}")->assertStatus(200);
        $this->apiGet("/v2/admin/super/federation/tenant/{$this->childId}/features")->assertStatus(200);
        $this->apiPost("/v2/admin/super/users/{$this->childMember->id}/impersonate", [])->assertStatus(200);

        $this->apiPost("/v2/admin/super/users/{$this->childMember->id}/move-tenant", [
            'new_tenant_id' => $this->otherId,
        ])->assertStatus(200);
        $this->assertSame($this->otherId, $this->tenantOf($this->childMember));

        $this->apiPost('/v2/admin/super/tenants', [
            'name' => 'Owner Created Child',
            'slug' => 'owner-created-' . uniqid('', false),
            'parent_id' => $this->parentId,
        ])->assertStatus(201);

        $this->apiDelete("/v2/admin/super/tenants/{$this->secondChildId}")->assertStatus(200);
        $this->assertSame(0, $this->isActive($this->secondChildId));
    }
}
