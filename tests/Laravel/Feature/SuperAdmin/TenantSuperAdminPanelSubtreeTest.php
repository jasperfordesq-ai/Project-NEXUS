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
 * Owner rule, 12 October 2026: "A tenant super admin can administer all
 * communities below it in the hierarchy, but not above it."
 *
 * In the super panel a tenant super admin reaches its own community plus every
 * DESCENDANT (by the materialised `tenants.path`), and never an ancestor, a
 * sibling or an unrelated root. That holds on the master community (tenant 1)
 * too: its tenant super admin reaches communities under `/1/`, not separate
 * roots, and is never `master`. Only the platform owner (is_super_admin /
 * is_god, or the super_admin / god role strings) is `master`.
 *
 * This file was TenantSuperAdminPanelHomeCommunityTest (11 Oct 2026), which
 * pinned the narrower own-community-only reading the owner has now reversed.
 *
 * Fixture (paths built from the real ids):
 *   P  hub, root                — the tenant super admin's home
 *   ├─ C1 hub, child of P       — has its own tenant super admin
 *   │  └─ G  leaf, grandchild
 *   └─ C2 leaf, child of P      — C1's sibling
 *   O  hub, unrelated root
 */
class TenantSuperAdminPanelSubtreeTest extends TestCase
{
    use DatabaseTransactions;

    private int $parentId;
    private int $childId;
    private int $grandchildId;
    private int $secondChildId;
    private int $otherId;
    private User $parentSuperAdmin;
    private User $childSuperAdmin;
    private User $childMember;
    private User $parentMember;
    private User $otherMember;

    protected function setUp(): void
    {
        parent::setUp();
        SuperPanelAccess::reset();

        $this->parentId = $this->makeTenant('Subtree Parent', null, true);
        $this->childId = $this->makeTenant('Subtree Child', $this->parentId, true);
        $this->grandchildId = $this->makeTenant('Subtree Grandchild', $this->childId, false);
        $this->secondChildId = $this->makeTenant('Subtree Second Child', $this->parentId, false);
        $this->otherId = $this->makeTenant('Subtree Other', null, true);

        $tsa = ['is_tenant_super_admin' => 1, 'is_super_admin' => 0, 'is_god' => 0];
        $this->parentSuperAdmin = $this->makeUser($this->parentId, 'admin', $tsa, 'Parent', 'Superadmin');
        $this->childSuperAdmin = $this->makeUser($this->childId, 'admin', $tsa, 'Child', 'Superadmin');

        $this->childMember = $this->makeUser($this->childId, 'member', [], 'Childa', 'Childmember');
        $this->parentMember = $this->makeUser($this->parentId, 'member', [], 'Parenta', 'Parentmember');
        $this->otherMember = $this->makeUser($this->otherId, 'member', [], 'Othera', 'Othermember');
    }

    protected function tearDown(): void
    {
        SuperPanelAccess::reset();
        parent::tearDown();
    }

    private function makeTenant(string $name, ?int $parentId, bool $hub): int
    {
        $parent = $parentId !== null
            ? DB::table('tenants')->where('id', $parentId)->first(['path', 'depth'])
            : null;

        $id = (int) DB::table('tenants')->insertGetId([
            'name' => $name,
            'slug' => strtolower(str_replace(' ', '-', $name)) . '-' . uniqid('', false),
            'is_active' => 1,
            'allows_subtenants' => $hub ? 1 : 0,
            'parent_id' => $parentId,
            'depth' => $parent !== null ? ((int) $parent->depth + 1) : 0,
            'path' => null,
            'max_depth' => 3,
        ]);
        $path = ($parent !== null ? rtrim((string) $parent->path, '/') : '') . '/' . $id . '/';
        DB::table('tenants')->where('id', $id)->update(['path' => $path]);

        return $id;
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

    private function actAsChildSuperAdmin(): void
    {
        $this->actAs($this->childSuperAdmin, $this->childId);
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

    public function test_a_hub_tenant_super_admin_reaches_its_own_subtree(): void
    {
        SuperPanelAccess::reset();
        $access = SuperPanelAccess::getAccess((int) $this->parentSuperAdmin->id);

        $this->assertTrue($access['granted']);
        $this->assertSame('regional', $access['level']);
        $this->assertSame('subtree', $access['scope']);
        $this->assertTrue($access['can_create_tenants']);
        $this->assertFalse(SuperPanelAccess::hasPlatformReach());

        foreach ([$this->parentId, $this->childId, $this->grandchildId, $this->secondChildId] as $id) {
            $this->assertTrue(SuperPanelAccess::canAccessTenant($id), "tenant {$id} is in the subtree");
        }
        $this->assertFalse(SuperPanelAccess::canAccessTenant($this->otherId), 'an unrelated root');
        $this->assertFalse(SuperPanelAccess::canAccessTenant(1), 'the master community is not beneath it');

        $this->assertTrue(SuperPanelAccess::canManageTenant($this->childId));
        $this->assertTrue(SuperPanelAccess::canManageTenant($this->grandchildId));
        $this->assertFalse(SuperPanelAccess::canManageTenant($this->parentId), 'own community is view-only, as before');
        $this->assertFalse(SuperPanelAccess::canManageTenant($this->otherId));

        $this->assertTrue(SuperPanelAccess::canCreateSubtenantUnder($this->parentId)['allowed']);
        $this->assertFalse(SuperPanelAccess::canCreateSubtenantUnder($this->otherId)['allowed']);
    }

    public function test_a_child_tenant_super_admin_never_reaches_up_or_sideways(): void
    {
        SuperPanelAccess::reset();
        $access = SuperPanelAccess::getAccess((int) $this->childSuperAdmin->id);

        $this->assertSame('regional', $access['level']);
        $this->assertTrue(SuperPanelAccess::canAccessTenant($this->childId));
        $this->assertTrue(SuperPanelAccess::canAccessTenant($this->grandchildId));
        $this->assertFalse(SuperPanelAccess::canAccessTenant($this->parentId), 'its parent is above it');
        $this->assertFalse(SuperPanelAccess::canAccessTenant($this->secondChildId), 'its sibling is beside it');
        $this->assertFalse(SuperPanelAccess::canAccessTenant($this->otherId));
        $this->assertFalse(SuperPanelAccess::canManageTenant($this->parentId));
        $this->assertFalse(SuperPanelAccess::canManageTenant($this->secondChildId));
    }

    public function test_a_master_community_tenant_super_admin_reaches_under_1_but_not_another_root(): void
    {
        // The test database's tenant 1 is not a hub and has no path; give it the
        // shape the live master has, inside this test's transaction.
        DB::table('tenants')->where('id', 1)->update(['allows_subtenants' => 1, 'path' => '/1/', 'depth' => 0]);
        $underMaster = $this->makeTenant('Subtree Under Master', 1, false);
        $masterTsa = $this->makeUser(1, 'admin', [
            'is_tenant_super_admin' => 1, 'is_super_admin' => 0, 'is_god' => 0,
        ], 'Master', 'Tenantsuper');

        SuperPanelAccess::reset();
        $access = SuperPanelAccess::getAccess((int) $masterTsa->id);

        $this->assertSame('regional', $access['level'], 'a tenant super admin is never master');
        $this->assertFalse(SuperPanelAccess::hasPlatformReach());
        $this->assertTrue(SuperPanelAccess::canAccessTenant(1));
        $this->assertTrue(SuperPanelAccess::canAccessTenant($underMaster), 'a community under /1/');
        $this->assertFalse(SuperPanelAccess::canAccessTenant($this->otherId), 'a separate root');
        $this->assertFalse(SuperPanelAccess::canAccessTenant($this->parentId), 'a separate root');

        $this->actAs($masterTsa, 1);
        $this->apiGet("/v2/admin/super/tenants/{$underMaster}")->assertStatus(200);
        $this->apiPut("/v2/admin/super/tenants/{$underMaster}", ['tagline' => 'From above'])->assertStatus(200);
        $this->assertContains($this->apiGet("/v2/admin/super/tenants/{$this->otherId}")->getStatusCode(), [403, 404]);
        $this->apiPut("/v2/admin/super/tenants/{$this->otherId}", ['name' => 'Taken Over'])->assertStatus(403);
        $this->apiPost("/v2/admin/super/users/{$this->otherMember->id}/impersonate", [])->assertStatus(403);
        $this->assertSame('Subtree Other', DB::table('tenants')->where('id', $this->otherId)->value('name'));
    }

    public function test_the_subtree_prefix_is_anchored_on_a_trailing_slash(): void
    {
        // A path stored without its trailing slash must not turn `/P` into a
        // prefix of `/P9/` — a different root whose id merely starts with P's.
        DB::table('tenants')->where('id', $this->parentId)->update(['path' => '/' . $this->parentId]);
        $lookalike = (int) DB::table('tenants')->insertGetId([
            'name' => 'Subtree Lookalike Root',
            'slug' => 'subtree-lookalike-' . uniqid('', false),
            'is_active' => 1,
            'allows_subtenants' => 0,
            'parent_id' => null,
            'depth' => 0,
            'path' => '/' . $this->parentId . '9/',
            'max_depth' => 3,
        ]);

        SuperPanelAccess::reset();
        SuperPanelAccess::getAccess((int) $this->parentSuperAdmin->id);

        $this->assertTrue(SuperPanelAccess::canAccessTenant($this->childId));
        $this->assertFalse(SuperPanelAccess::canAccessTenant($lookalike));
        $this->assertSame('/' . $this->parentId . '/', SuperPanelAccess::subtreeFilter()['prefix']);
    }

    // ── Reading the subtree ─────────────────────────────────────────────────

    public function test_lists_show_the_subtree_and_nothing_else(): void
    {
        $this->actAsParentSuperAdmin();

        $tenants = json_encode($this->apiGet('/v2/admin/super/tenants')->assertStatus(200)->json('data'));
        $this->assertStringContainsString('Subtree Parent', $tenants);
        $this->assertStringContainsString('Subtree Child', $tenants);
        $this->assertStringContainsString('Subtree Grandchild', $tenants);
        $this->assertStringContainsString('Subtree Second Child', $tenants);
        $this->assertStringNotContainsString('Subtree Other', $tenants);

        $tree = json_encode($this->apiGet('/v2/admin/super/tenants/hierarchy')->assertStatus(200)->json('data'));
        $this->assertStringContainsString('Subtree Grandchild', $tree);
        $this->assertStringNotContainsString('Subtree Other', $tree);

        $users = json_encode($this->apiGet('/v2/admin/super/users')->assertStatus(200)->json('data'));
        $this->assertStringContainsString('Parentmember', $users);
        $this->assertStringContainsString('Childmember', $users);
        $this->assertStringNotContainsString('Othermember', $users);

        $dashboard = $this->apiGet('/v2/admin/super/dashboard')->assertStatus(200)->json('data');
        $this->assertSame(4, (int) ($dashboard['total_tenants'] ?? -1), 'Its own community and three beneath it.');
    }

    public function test_a_sub_community_and_its_members_can_be_read(): void
    {
        $this->actAsParentSuperAdmin();

        $this->apiGet("/v2/admin/super/tenants/{$this->childId}")->assertStatus(200);
        $this->apiGet("/v2/admin/super/users/{$this->childMember->id}")->assertStatus(200);
        $this->assertContains($this->apiGet("/v2/admin/super/tenants/{$this->otherId}")->getStatusCode(), [403, 404]);
        $this->apiGet("/v2/admin/super/users/{$this->otherMember->id}")->assertStatus(403);
    }

    // ── Changing the subtree ────────────────────────────────────────────────

    public function test_a_sub_community_can_be_edited_deactivated_reactivated_and_switched(): void
    {
        $this->actAsParentSuperAdmin();

        $this->apiPut("/v2/admin/super/tenants/{$this->childId}", ['name' => 'Subtree Child Renamed'])
            ->assertStatus(200);
        $this->assertSame('Subtree Child Renamed', DB::table('tenants')->where('id', $this->childId)->value('name'));

        $this->apiPost("/v2/admin/super/tenants/{$this->secondChildId}/toggle-hub", ['enable' => true])
            ->assertStatus(200);
        $this->assertSame(1, (int) DB::table('tenants')->where('id', $this->secondChildId)->value('allows_subtenants'));

        $this->apiDelete("/v2/admin/super/tenants/{$this->secondChildId}")->assertStatus(200);
        $this->assertSame(0, $this->isActive($this->secondChildId));

        $this->apiPost("/v2/admin/super/tenants/{$this->secondChildId}/reactivate", [])->assertStatus(200);
        $this->assertSame(1, $this->isActive($this->secondChildId));

        $bulk = $this->apiPost('/v2/admin/super/bulk/update-tenants', [
            'tenant_ids' => [$this->grandchildId, $this->otherId],
            'action' => 'deactivate',
        ]);
        $bulk->assertStatus(200);
        $this->assertSame(1, (int) $bulk->json('data.updated_count'), 'Only the grandchild is in reach.');
        $this->assertSame(0, $this->isActive($this->grandchildId));
        $this->assertSame(1, $this->isActive($this->otherId));
    }

    public function test_another_root_cannot_be_edited_or_deactivated(): void
    {
        $this->actAsParentSuperAdmin();

        $this->apiPut("/v2/admin/super/tenants/{$this->otherId}", ['name' => 'Taken Over'])->assertStatus(403);
        $this->apiDelete("/v2/admin/super/tenants/{$this->otherId}")->assertStatus(403);
        $this->apiPost("/v2/admin/super/tenants/{$this->otherId}/toggle-hub", ['enable' => false])->assertStatus(403);
        $this->assertSame('Subtree Other', DB::table('tenants')->where('id', $this->otherId)->value('name'));
        $this->assertSame(1, $this->isActive($this->otherId));
    }

    public function test_sub_communities_can_be_created_and_moved_within_the_subtree_only(): void
    {
        $this->actAsParentSuperAdmin();

        $this->apiPost('/v2/admin/super/tenants', [
            'name' => 'Created Beneath',
            'slug' => 'created-beneath-' . uniqid('', false),
            'parent_id' => $this->childId,
        ])->assertStatus(201);
        $created = DB::table('tenants')->where('name', 'Created Beneath')->first(['parent_id']);
        $this->assertNotNull($created);
        $this->assertSame($this->childId, (int) $created->parent_id);

        $this->apiPost('/v2/admin/super/tenants', [
            'name' => 'Created Elsewhere',
            'slug' => 'created-elsewhere-' . uniqid('', false),
            'parent_id' => $this->otherId,
        ])->assertStatus(403);
        $this->assertDatabaseMissing('tenants', ['name' => 'Created Elsewhere']);

        // Re-parent a community inside the subtree.
        $this->apiPost("/v2/admin/super/tenants/{$this->secondChildId}/move", [
            'new_parent_id' => $this->childId,
        ])->assertStatus(200);
        $this->assertSame(
            $this->childId,
            (int) DB::table('tenants')->where('id', $this->secondChildId)->value('parent_id')
        );

        // Both ends are checked: not out to another root, not in from one.
        $this->apiPost("/v2/admin/super/tenants/{$this->grandchildId}/move", [
            'new_parent_id' => $this->otherId,
        ])->assertStatus(403);
        $this->apiPost("/v2/admin/super/tenants/{$this->otherId}/move", [
            'new_parent_id' => $this->parentId,
        ])->assertStatus(403);
        $this->assertSame($this->childId, (int) DB::table('tenants')->where('id', $this->grandchildId)->value('parent_id'));
        $this->assertNull(DB::table('tenants')->where('id', $this->otherId)->value('parent_id'));
    }

    public function test_users_in_a_sub_community_can_be_created_edited_and_promoted(): void
    {
        $this->actAsParentSuperAdmin();

        $email = 'subtree-' . uniqid('', false) . '@example.test';
        $this->assertTrue($this->apiPost('/v2/admin/super/users', [
            'tenant_id' => $this->childId,
            'email' => $email,
            'first_name' => 'Created',
            'last_name' => 'Beneath',
            'password' => 'TestPassword123!',
        ])->isSuccessful());
        $this->assertSame($this->childId, (int) DB::table('users')->where('email', $email)->value('tenant_id'));

        $this->apiPut("/v2/admin/super/users/{$this->childMember->id}", ['first_name' => 'Altered'])
            ->assertStatus(200);
        $this->assertSame('Altered', DB::table('users')->where('id', $this->childMember->id)->value('first_name'));

        $this->apiPost("/v2/admin/super/users/{$this->childMember->id}/grant-super-admin", [])
            ->assertStatus(200);
        $this->assertSame(
            1,
            (int) DB::table('users')->where('id', $this->childMember->id)->value('is_tenant_super_admin')
        );

        // Not in another root.
        $this->apiPut("/v2/admin/super/users/{$this->otherMember->id}", ['first_name' => 'Altered'])
            ->assertStatus(403);
        $this->apiPost("/v2/admin/super/users/{$this->otherMember->id}/grant-super-admin", [])
            ->assertStatus(403);
        $this->assertSame('Othera', DB::table('users')->where('id', $this->otherMember->id)->value('first_name'));
    }

    public function test_members_can_be_moved_within_the_subtree_and_not_across_its_edge(): void
    {
        $this->actAsParentSuperAdmin();

        $this->apiPost("/v2/admin/super/users/{$this->childMember->id}/move-tenant", [
            'new_tenant_id' => $this->parentId,
        ])->assertStatus(200);
        $this->assertSame($this->parentId, $this->tenantOf($this->childMember));

        $this->apiPost('/v2/admin/super/bulk/move-users', [
            'user_ids' => [$this->childMember->id],
            'target_tenant_id' => $this->secondChildId,
        ])->assertStatus(200);
        $this->assertSame($this->secondChildId, $this->tenantOf($this->childMember));

        $this->apiPost("/v2/admin/super/users/{$this->parentMember->id}/move-and-promote", [
            'target_tenant_id' => $this->childId,
        ])->assertStatus(200);
        $this->assertSame($this->childId, $this->tenantOf($this->parentMember));

        // Across the edge, either way.
        $this->apiPost("/v2/admin/super/users/{$this->childMember->id}/move-tenant", [
            'new_tenant_id' => $this->otherId,
        ])->assertStatus(403);
        $this->apiPost("/v2/admin/super/users/{$this->otherMember->id}/move-tenant", [
            'new_tenant_id' => $this->parentId,
        ])->assertStatus(403);
        $this->assertSame($this->secondChildId, $this->tenantOf($this->childMember));
        $this->assertSame($this->otherId, $this->tenantOf($this->otherMember));
    }

    public function test_only_strictly_lower_rank_accounts_in_the_subtree_can_be_impersonated(): void
    {
        $childBroker = $this->makeUser($this->childId, 'member', ['role' => 'broker'], 'Childb', 'Broker');
        $childAdmin = $this->makeUser($this->childId, 'admin', [], 'Childc', 'Admin');
        $this->actAsParentSuperAdmin();

        $this->apiPost("/v2/admin/super/users/{$this->childMember->id}/impersonate", [])->assertStatus(200);
        SuperPanelAccess::reset();
        $this->apiPost("/v2/admin/super/users/{$childBroker->id}/impersonate", [])->assertStatus(200);
        SuperPanelAccess::reset();
        $this->apiPost("/v2/admin/super/users/{$childAdmin->id}/impersonate", [])->assertStatus(403);
        SuperPanelAccess::reset();
        $this->apiPost("/v2/admin/super/users/{$this->childSuperAdmin->id}/impersonate", [])->assertStatus(403);
        SuperPanelAccess::reset();
        $this->apiPost("/v2/admin/super/users/{$this->otherMember->id}/impersonate", [])->assertStatus(403);
    }

    public function test_federation_switches_are_reachable_within_the_subtree_only(): void
    {
        $this->actAsParentSuperAdmin();

        $this->apiGet("/v2/admin/super/federation/tenant/{$this->childId}/features")->assertStatus(200);
        $this->apiGet("/v2/admin/super/federation/tenant/{$this->otherId}/features")->assertStatus(403);
        $this->apiPut("/v2/admin/super/federation/tenant/{$this->otherId}/features", [
            'feature' => 'tenant_federation_enabled',
            'enabled' => true,
        ])->assertStatus(403);
    }

    // ── A child's tenant super admin cannot reach up or sideways ────────────

    public function test_a_child_tenant_super_admin_cannot_act_on_its_parent_or_sibling(): void
    {
        $this->actAsChildSuperAdmin();

        $this->apiGet("/v2/admin/super/tenants/{$this->grandchildId}")->assertStatus(200);

        $this->assertContains($this->apiGet("/v2/admin/super/tenants/{$this->parentId}")->getStatusCode(), [403, 404]);
        $this->apiPut("/v2/admin/super/tenants/{$this->parentId}", ['name' => 'Taken From Below'])->assertStatus(403);
        $this->assertContains($this->apiGet("/v2/admin/super/tenants/{$this->secondChildId}")->getStatusCode(), [403, 404]);
        $this->apiPut("/v2/admin/super/tenants/{$this->secondChildId}", ['name' => 'Taken Sideways'])->assertStatus(403);
        $this->apiDelete("/v2/admin/super/tenants/{$this->secondChildId}")->assertStatus(403);

        $this->apiGet("/v2/admin/super/users/{$this->parentMember->id}")->assertStatus(403);
        $this->apiPost("/v2/admin/super/users/{$this->parentMember->id}/impersonate", [])->assertStatus(403);
        $this->apiPost("/v2/admin/super/users/{$this->childMember->id}/move-tenant", [
            'new_tenant_id' => $this->parentId,
        ])->assertStatus(403);

        $this->assertSame('Subtree Parent', DB::table('tenants')->where('id', $this->parentId)->value('name'));
        $this->assertSame('Subtree Second Child', DB::table('tenants')->where('id', $this->secondChildId)->value('name'));
        $this->assertSame(1, $this->isActive($this->secondChildId));
        $this->assertSame($this->childId, $this->tenantOf($this->childMember));
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
            $this->assertTrue(SuperPanelAccess::canAccessTenant($this->otherId));
            $this->assertTrue(SuperPanelAccess::canManageTenant($this->childId));
        }
    }

    public function test_a_platform_owner_can_still_act_across_communities(): void
    {
        $owner = $this->platformOwner('super_admin');
        $this->actAs($owner, 1);

        $tenants = json_encode($this->apiGet('/v2/admin/super/tenants')->assertStatus(200)->json('data'));
        $this->assertStringContainsString('Subtree Child', $tenants);
        $this->assertStringContainsString('Subtree Other', $tenants);

        $this->apiPost("/v2/admin/super/users/{$this->childMember->id}/move-tenant", [
            'new_tenant_id' => $this->otherId,
        ])->assertStatus(200);
        $this->assertSame($this->otherId, $this->tenantOf($this->childMember));

        $this->apiDelete("/v2/admin/super/tenants/{$this->secondChildId}")->assertStatus(200);
        $this->assertSame(0, $this->isActive($this->secondChildId));
    }
}
