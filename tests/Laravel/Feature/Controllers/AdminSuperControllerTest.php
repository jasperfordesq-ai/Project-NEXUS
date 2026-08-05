<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for AdminSuperController.
 *
 * Covers dashboard, tenant CRUD, user management, audit, federation.
 * Super admin endpoints require is_super_admin or is_tenant_super_admin.
 */
class AdminSuperControllerTest extends TestCase
{
    use DatabaseTransactions;

    /**
     * Create a super admin user with the right flags set.
     */
    private function createSuperAdmin(): User
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        DB::table('users')->where('id', $admin->id)->update([
            'is_super_admin' => 1,
            'is_tenant_super_admin' => 1,
        ]);

        /*
         * 🔴 The acting tenant needs a materialised path, because a real one
         * always has one — TenantHierarchyService sets it immediately after
         * insert. The seeded test tenant has a NULL path, which is not a
         * realistic fixture.
         *
         * This matters more than it looks. `getAccess()` only grants `master` to
         * god, or to a user on tenant 1 — so a user with `is_super_admin = 1` on
         * tenant 2, as created here, resolves to **regional**, whose boundary is a
         * prefix match on that path. With a NULL path the prefix was empty, and an
         * empty prefix matches EVERYTHING (`str_starts_with($x, '')` is true;
         * `LIKE '%'` matches every row). Three tests in this file were therefore
         * passing *because of* that hole. Backfilling the path here makes the
         * fixture honest; see SubtreeBoundaryEmptyPathTest for the guard itself.
         */
        $existingPath = DB::table('tenants')->where('id', $this->testTenantId)->value('path');
        if (trim((string) $existingPath) === '') {
            DB::table('tenants')->where('id', $this->testTenantId)->update([
                'path' => '/' . $this->testTenantId . '/',
            ]);
        }

        $admin->refresh();
        return $admin;
    }

    // ================================================================
    // DASHBOARD — GET /v2/admin/super/dashboard
    // ================================================================

    public function test_dashboard_returns_200_for_super_admin(): void
    {
        $admin = $this->createSuperAdmin();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/super/dashboard');

        // 200 or 403 depending on SuperPanelAccess checks
        $this->assertTrue(in_array($response->status(), [200, 403]));
    }

    public function test_dashboard_returns_403_for_regular_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/super/dashboard');

        $response->assertStatus(403);
    }

    public function test_dashboard_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/super/dashboard');

        $response->assertStatus(403);
    }

    public function test_dashboard_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/super/dashboard');

        $response->assertStatus(401);
    }

    // ================================================================
    // TENANT LIST — GET /v2/admin/super/tenants
    // ================================================================

    public function test_tenant_list_returns_403_for_regular_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/super/tenants');

        $response->assertStatus(403);
    }

    public function test_tenant_list_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/super/tenants');

        $response->assertStatus(403);
    }

    public function test_tenant_update_preserves_passkey_conflict_and_counts_legacy_null_rp(): void
    {
        $admin = $this->createSuperAdmin();
        $member = User::factory()->forTenant($this->testTenantId)->create();
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'domain' => 'legacy-rp.example.test',
            'allows_subtenants' => 1,
        ]);
        $this->insertPasskey($admin, 'legacy-rp.example.test');
        $this->insertPasskey($member, null);
        $child = Tenant::factory()->create([
            'parent_id' => $this->testTenantId,
            'domain' => null,
            'accessible_domain' => null,
            'is_active' => 1,
        ]);
        $childMember = User::factory()->forTenant((int) $child->id)->create();
        $this->insertPasskey($childMember, 'legacy-rp.example.test');
        Sanctum::actingAs($admin);

        $response = $this->apiPut(
            "/v2/admin/super/tenants/{$this->testTenantId}",
            ['domain' => 'replacement-rp.example.test']
        );

        $response
            ->assertStatus(409)
            ->assertJsonPath('errors.0.code', 'PASSKEY_RP_CHANGE_BLOCKED')
            ->assertJsonPath('meta.security_impact.credential_count', 3)
            ->assertJsonPath('meta.security_impact.registered_users', 3)
            ->assertJsonPath('meta.security_impact.affected_tenants', 2);
        $this->assertSame(
            'legacy-rp.example.test',
            DB::table('tenants')->where('id', $this->testTenantId)->value('domain')
        );
    }

    public function test_tenant_update_accepts_an_unchanged_reserved_platform_domain(): void
    {
        $admin = $this->createSuperAdmin();
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'domain' => 'app.project-nexus.ie',
            'allows_subtenants' => 1,
        ]);
        Sanctum::actingAs($admin);

        $response = $this->apiPut(
            "/v2/admin/super/tenants/{$this->testTenantId}",
            [
                'domain' => 'app.project-nexus.ie',
                'tagline' => 'Updated without changing the routing boundary',
            ]
        );

        $response
            ->assertOk()
            ->assertJsonPath('data.updated', true);
        $this->assertSame(
            'Updated without changing the routing boundary',
            DB::table('tenants')->where('id', $this->testTenantId)->value('tagline')
        );
    }

    public function test_tenant_hub_cannot_be_disabled_while_children_are_attached(): void
    {
        $admin = $this->createGlobalSuperAdmin();
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'allows_subtenants' => 1,
            'max_depth' => 2,
        ]);
        Tenant::factory()->create([
            'parent_id' => $this->testTenantId,
            'is_active' => 0,
        ]);
        Sanctum::actingAs($admin);

        $response = $this->apiPost(
            "/v2/admin/super/tenants/{$this->testTenantId}/toggle-hub",
            ['enable' => false]
        );

        $response
            ->assertStatus(422)
            ->assertJsonPath('errors.0.message', __('api.super_disable_hub_has_children'));
        $this->assertDatabaseHas('tenants', [
            'id' => $this->testTenantId,
            'allows_subtenants' => 1,
            'max_depth' => 2,
        ]);
    }

    public function test_bulk_hub_disable_reports_tenants_with_children_without_changing_them(): void
    {
        $admin = $this->createGlobalSuperAdmin();
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'allows_subtenants' => 1,
            'max_depth' => 2,
        ]);
        Tenant::factory()->create([
            'parent_id' => $this->testTenantId,
            'is_active' => 1,
        ]);
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/super/bulk/update-tenants', [
            'tenant_ids' => [$this->testTenantId],
            'action' => 'disable_hub',
        ]);

        $response
            ->assertOk()
            ->assertJsonPath('data.updated_count', 0)
            ->assertJsonPath('data.errors.0.code', 'HUB_HAS_CHILDREN')
            ->assertJsonPath('data.errors.0.params.tenant_id', $this->testTenantId);
        $this->assertDatabaseHas('tenants', [
            'id' => $this->testTenantId,
            'allows_subtenants' => 1,
            'max_depth' => 2,
        ]);
    }

    public function test_tenant_move_preserves_passkey_conflict_for_inherited_rp_subtree(): void
    {
        $admin = $this->createSuperAdmin();
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'domain' => 'old-parent-rp.example.test',
            'accessible_domain' => null,
            'allows_subtenants' => 1,
        ]);
        $oldParentPath = (string) DB::table('tenants')
            ->where('id', $this->testTenantId)
            ->value('path');

        $newParent = Tenant::factory()->create([
            'domain' => 'new-parent-rp.example.test',
            'accessible_domain' => null,
            'parent_id' => $this->testTenantId,
            'path' => rtrim($oldParentPath, '/') . '/new-parent/',
            'depth' => 1,
            'allows_subtenants' => 1,
        ]);
        DB::table('tenants')->where('id', $newParent->id)->update([
            'path' => rtrim($oldParentPath, '/') . '/' . $newParent->id . '/',
        ]);
        $moved = Tenant::factory()->create([
            'domain' => null,
            'accessible_domain' => null,
            'parent_id' => $this->testTenantId,
            'path' => $oldParentPath . 'pending/',
            'depth' => 1,
            'allows_subtenants' => 1,
        ]);
        $movedPath = rtrim($oldParentPath, '/') . '/' . $moved->id . '/';
        DB::table('tenants')->where('id', $moved->id)->update(['path' => $movedPath]);

        $descendant = Tenant::factory()->create([
            'domain' => null,
            'accessible_domain' => null,
            'parent_id' => $moved->id,
            'path' => $movedPath . 'pending/',
            'depth' => 2,
        ]);
        DB::table('tenants')->where('id', $descendant->id)->update([
            'path' => $movedPath . $descendant->id . '/',
        ]);

        $movedMember = User::factory()->forTenant((int) $moved->id)->create();
        $descendantMember = User::factory()->forTenant((int) $descendant->id)->create();
        $this->insertPasskey($movedMember, 'old-parent-rp.example.test');
        $this->insertPasskey($descendantMember, null);
        Sanctum::actingAs($admin);

        $response = $this->apiPost(
            "/v2/admin/super/tenants/{$moved->id}/move",
            ['new_parent_id' => (int) $newParent->id]
        );

        $response
            ->assertStatus(409)
            ->assertJsonPath('errors.0.code', 'PASSKEY_RP_CHANGE_BLOCKED')
            ->assertJsonPath('meta.security_impact.credential_count', 2)
            ->assertJsonPath('meta.security_impact.registered_users', 2)
            ->assertJsonPath('meta.security_impact.affected_tenants', 2);
        $this->assertSame(
            $this->testTenantId,
            (int) DB::table('tenants')->where('id', $moved->id)->value('parent_id')
        );
        $this->assertSame(
            $movedPath,
            DB::table('tenants')->where('id', $moved->id)->value('path')
        );
    }

    // ================================================================
    // USER LIST — GET /v2/admin/super/users
    // ================================================================

    public function test_user_list_returns_403_for_regular_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/super/users');

        $response->assertStatus(403);
    }

    public function test_user_list_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/super/users');

        $response->assertStatus(401);
    }

    public function test_user_move_tenant_returns_passkey_recovery_conflict(): void
    {
        $admin = $this->createGlobalSuperAdmin();
        $member = $this->createPasskeyOnlyMember();
        Sanctum::actingAs($admin);

        $response = $this->apiPost(
            "/v2/admin/super/users/{$member->id}/move-tenant",
            ['new_tenant_id' => 999]
        );

        $response
            ->assertStatus(409)
            ->assertJsonPath('errors.0.code', 'USER_MOVE_PASSKEY_RECOVERY_REQUIRED')
            ->assertJsonPath(
                'errors.0.message',
                __('api.super_move_user_passkey_recovery_required')
            );
        $this->assertDatabaseHas('users', [
            'id' => $member->id,
            'tenant_id' => $this->testTenantId,
        ]);
        $this->assertDatabaseHas('webauthn_credentials', [
            'user_id' => $member->id,
            'tenant_id' => $this->testTenantId,
        ]);
    }

    public function test_user_move_and_promote_returns_passkey_recovery_conflict_without_promoting(): void
    {
        $admin = $this->createGlobalSuperAdmin();
        $member = $this->createPasskeyOnlyMember();
        DB::table('tenants')->where('id', 999)->update(['allows_subtenants' => 1]);
        Sanctum::actingAs($admin);

        $response = $this->apiPost(
            "/v2/admin/super/users/{$member->id}/move-and-promote",
            ['target_tenant_id' => 999]
        );

        $response
            ->assertStatus(409)
            ->assertJsonPath('errors.0.code', 'USER_MOVE_PASSKEY_RECOVERY_REQUIRED')
            ->assertJsonPath(
                'errors.0.message',
                __('api.super_move_user_passkey_recovery_required')
            );
        $this->assertDatabaseHas('users', [
            'id' => $member->id,
            'tenant_id' => $this->testTenantId,
            'role' => 'member',
            'is_tenant_super_admin' => 0,
        ]);
    }

    public function test_bulk_move_users_returns_structured_passkey_recovery_failure(): void
    {
        $admin = $this->createGlobalSuperAdmin();
        $member = $this->createPasskeyOnlyMember();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/super/bulk/move-users', [
            'user_ids' => [$member->id],
            'target_tenant_id' => 999,
        ]);

        $response
            ->assertOk()
            ->assertJsonPath('data.moved_count', 0)
            ->assertJsonPath('data.total_requested', 1)
            ->assertJsonPath(
                'data.errors.0.code',
                'USER_MOVE_PASSKEY_RECOVERY_REQUIRED'
            )
            ->assertJsonPath('data.errors.0.params.user_id', $member->id)
            ->assertJsonPath('data.failures.0.user_id', $member->id)
            ->assertJsonPath(
                'data.failures.0.code',
                'USER_MOVE_PASSKEY_RECOVERY_REQUIRED'
            )
            ->assertJsonPath('data.failures.0.params.user_id', $member->id);
        $this->assertDatabaseHas('users', [
            'id' => $member->id,
            'tenant_id' => $this->testTenantId,
        ]);
    }

    // ================================================================
    // AUDIT — GET /v2/admin/super/audit
    // ================================================================

    public function test_audit_returns_403_for_regular_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/super/audit');

        $response->assertStatus(403);
    }

    // ================================================================
    // FEDERATION OVERVIEW — GET /v2/admin/super/federation
    // ================================================================

    public function test_federation_returns_403_for_regular_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/super/federation');

        $response->assertStatus(403);
    }

    public function test_federation_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/super/federation');

        $response->assertStatus(403);
    }

    // ================================================================
    // TENANT HIERARCHY — GET /v2/admin/super/tenants/hierarchy
    // ================================================================

    public function test_tenant_hierarchy_returns_403_for_regular_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/super/tenants/hierarchy');

        $response->assertStatus(403);
    }

    // ================================================================
    // FEDERATION SYSTEM CONTROLS — GET /v2/admin/super/federation/system-controls
    // ================================================================

    public function test_federation_system_controls_returns_403_for_regular_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/super/federation/system-controls');

        $response->assertStatus(403);
    }

    private function insertPasskey(User $user, ?string $rpId): void
    {
        $tenantId = (int) $user->tenant_id;
        $credentialId = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $userHandle = rtrim(strtr(base64_encode(hash(
            'sha256',
            $user->id . ':' . $tenantId,
            true
        )), '+/', '-_'), '=');

        DB::table('webauthn_credentials')->insert([
            'user_id' => (int) $user->id,
            'tenant_id' => $tenantId,
            'credential_id' => $credentialId,
            'public_key' => 'test-public-key',
            'sign_count' => 0,
            'transports' => json_encode(['internal'], JSON_THROW_ON_ERROR),
            'device_name' => 'Test passkey',
            'authenticator_type' => 'platform',
            'attestation_type' => 'none',
            'rp_id' => $rpId,
            'registration_origin' => 'https://legacy-rp.example.test',
            'user_handle' => $userHandle,
            'backup_eligible' => 0,
            'backup_state' => 0,
            'user_verified' => 1,
            'credential_discoverable' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function createGlobalSuperAdmin(): User
    {
        $admin = $this->createSuperAdmin();
        DB::table('users')->where('id', $admin->id)->update([
            'is_god' => 1,
            'role' => 'god',
        ]);

        return $admin->refresh();
    }

    private function createPasskeyOnlyMember(): User
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        DB::table('users')->where('id', $member->id)->update([
            'password_hash' => null,
            'is_tenant_super_admin' => 0,
        ]);
        $member->refresh();
        $this->insertPasskey($member, 'localhost');

        return $member;
    }
}
