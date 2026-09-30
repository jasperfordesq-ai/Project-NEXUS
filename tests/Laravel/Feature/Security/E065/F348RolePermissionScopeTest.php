<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E065;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-348 (E-065) — one save in the RBAC role editor handed a plain member
 * account-creation over every club in the community.
 *
 * Two defects composed:
 *   1. `AdminEnterpriseController::updateRole()` / `createRole()` resolved a
 *      requested permission by NAME out of the platform-global `permissions`
 *      table with no allowlist, so a community admin could attach
 *      `verein.members.import` — a slug the panel never publishes.
 *   2. `VereinMemberImportService::userHasPermissionInOrg()` treated a NULL
 *      `scope_organization_id` as "every club", and NULL is how every grant
 *      written through a role looks.
 *
 * The owner chose BOTH fixes. A NULL organisation scope is now no access, and
 * the roles editor refuses any permission outside the grantable allowlist.
 *
 * Adapted from the E-065 slice-D reproduction
 * `.local-docs-archive/security-log/E-065/repro/d/VereinImportScopeEscapeTest.php`,
 * which asserted the BAD outcome (it passed while the bug existed). Every attack
 * assertion below is inverted; the two controls are kept as they were.
 */
final class F348RolePermissionScopeTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT = 2;

    private int $attackerId = 0;
    private int $clubGrantedId = 0;
    private int $clubOtherId = 0;
    private int $roleId = 0;
    private int $permissionId = 0;

    protected function setUp(): void
    {
        parent::setUp();

        // No schema guard here on purpose. Every table and column this test
        // touches is in the committed schema dump, so a guard could never fire
        // in CI and would only hide a broken fixture locally — which is what the
        // pre-commit schema-skip budget exists to prevent.

        $this->enableCaringCommunity();
        TenantContext::setById(self::TENANT);

        $this->attackerId = $this->makeMember('f348.attacker');
        $this->clubGrantedId = $this->makeClub('F348 Granted Club');
        $this->clubOtherId = $this->makeClub('F348 Other Club');

        $this->permissionId = (int) DB::table('permissions')->insertGetId([
            'name' => 'verein.members.import',
            'display_name' => 'Import Verein Members',
            'category' => 'vereine',
            'tenant_id' => null,
        ]);
        $this->roleId = (int) DB::table('roles')->insertGetId([
            'name' => 'f348_role_' . bin2hex(random_bytes(4)),
            'display_name' => 'F348 community role',
            'level' => 10,
            'is_system' => 0,
            'tenant_id' => self::TENANT,
        ]);
    }

    /**
     * The whole chain through the API: an administrator saving a community role
     * must not be able to attach an organisation-scoped verein permission.
     */
    public function test_rbac_role_save_cannot_attach_a_verein_permission(): void
    {
        $this->grantRole(tenantId: self::TENANT, scopeOrgId: null);

        $adminId = $this->makeAdmin();
        Sanctum::actingAs(User::find($adminId));
        $save = $this->putJson(
            '/api/v2/admin/enterprise/roles/' . $this->roleId,
            ['permissions' => ['verein.members.import']],
            $this->withTenantHeader()
        );

        $this->assertSame(
            422,
            $save->getStatusCode(),
            'BAD OUTCOME: the RBAC editor accepted a permission outside its own published '
            . 'catalogue. Body: ' . $save->getContent()
        );
        $this->assertSame(
            0,
            DB::table('role_permissions')->where('role_id', $this->roleId)->count(),
            'BAD OUTCOME: the refused save still attached the permission.'
        );

        Sanctum::actingAs(User::find($this->attackerId));
        $email = 'f348.chain.' . bin2hex(random_bytes(5)) . '@example.test';
        $import = $this->postJson(
            '/api/v2/caring-community/vereine/' . $this->clubOtherId . '/members/import',
            ['csv' => "email,first_name,last_name\n{$email},Imported,Member\n"],
            $this->withTenantHeader()
        );

        $this->assertSame(403, $import->getStatusCode());
        $this->assertNull(
            DB::table('users')->where('tenant_id', self::TENANT)->where('email', $email)->first(),
            'BAD OUTCOME: after one admin role save, a plain member created an account in a '
            . 'club that role never named.'
        );
    }

    /**
     * The same refusal on role CREATION, which wrote its permissions through a
     * different statement.
     */
    public function test_rbac_role_creation_cannot_attach_a_verein_permission(): void
    {
        $adminId = $this->makeAdmin();
        Sanctum::actingAs(User::find($adminId));

        $name = 'f348_created_' . bin2hex(random_bytes(4));
        $created = $this->postJson(
            '/api/v2/admin/enterprise/roles',
            [
                'name' => $name,
                'display_name' => 'F348 created role',
                'permissions' => ['verein.members.import'],
            ],
            $this->withTenantHeader()
        );

        $this->assertSame(
            422,
            $created->getStatusCode(),
            'BAD OUTCOME: role creation accepted an ungrantable permission. Body: '
            . $created->getContent()
        );
        $this->assertNull(
            DB::table('roles')->where('tenant_id', self::TENANT)->where('name', $name)->first(),
            'BAD OUTCOME: the refused creation left a role behind.'
        );
    }

    /**
     * Even with the permission attached directly in the database, a grant that
     * names no organisation must reach no club at all.
     */
    public function test_unscoped_grant_reaches_no_club(): void
    {
        DB::table('role_permissions')->insert([
            'role_id' => $this->roleId,
            'permission_id' => $this->permissionId,
            'tenant_id' => self::TENANT,
        ]);
        $this->grantRole(tenantId: self::TENANT, scopeOrgId: null);

        Sanctum::actingAs(User::find($this->attackerId));

        foreach ([$this->clubGrantedId, $this->clubOtherId] as $clubId) {
            $email = 'f348.unscoped.' . bin2hex(random_bytes(5)) . '@example.test';
            $response = $this->postJson(
                '/api/v2/caring-community/vereine/' . $clubId . '/members/import',
                ['csv' => "email,first_name,last_name\n{$email},Imported,Member\n"],
                $this->withTenantHeader()
            );

            $this->assertSame(
                403,
                $response->getStatusCode(),
                'BAD OUTCOME: an unscoped grant reached club ' . $clubId . '.'
            );
            $this->assertNull(
                DB::table('users')->where('tenant_id', self::TENANT)->where('email', $email)->first(),
                'BAD OUTCOME: the unscoped grant created an account in club ' . $clubId . '.'
            );
        }
    }

    /**
     * CONTROL — the legitimate grant shape, written by the admin-gated
     * `assignVereinAdmin` endpoint, still works for the club it names.
     */
    public function test_control_concrete_scope_still_imports_into_its_own_club(): void
    {
        DB::table('role_permissions')->insert([
            'role_id' => $this->roleId,
            'permission_id' => $this->permissionId,
            'tenant_id' => self::TENANT,
        ]);
        $this->grantRole(tenantId: self::TENANT, scopeOrgId: $this->clubGrantedId);

        Sanctum::actingAs(User::find($this->attackerId));

        $email = 'f348.scoped.' . bin2hex(random_bytes(5)) . '@example.test';
        $response = $this->postJson(
            '/api/v2/caring-community/vereine/' . $this->clubGrantedId . '/members/import',
            ['csv' => "email,first_name,last_name\n{$email},Imported,Member\n"],
            $this->withTenantHeader()
        );

        $this->assertSame(
            201,
            $response->getStatusCode(),
            'CONTROL: a grant naming this club must still work, or the attack cases prove '
            . 'nothing. Body: ' . $response->getContent()
        );
        $this->assertNotNull(
            DB::table('users')->where('tenant_id', self::TENANT)->where('email', $email)->first()
        );
    }

    /**
     * CONTROL — the same concrete grant still does NOT reach another club.
     */
    public function test_control_concrete_scope_does_not_reach_another_club(): void
    {
        DB::table('role_permissions')->insert([
            'role_id' => $this->roleId,
            'permission_id' => $this->permissionId,
            'tenant_id' => self::TENANT,
        ]);
        $this->grantRole(tenantId: self::TENANT, scopeOrgId: $this->clubGrantedId);

        Sanctum::actingAs(User::find($this->attackerId));

        $email = 'f348.other.' . bin2hex(random_bytes(5)) . '@example.test';
        $response = $this->postJson(
            '/api/v2/caring-community/vereine/' . $this->clubOtherId . '/members/import',
            ['csv' => "email,first_name,last_name\n{$email},Imported,Member\n"],
            $this->withTenantHeader()
        );

        $this->assertSame(403, $response->getStatusCode());
        $this->assertNull(
            DB::table('users')->where('tenant_id', self::TENANT)->where('email', $email)->first()
        );
    }

    /**
     * CONTROL — a plain member with no grant at all is still refused.
     */
    public function test_control_member_without_any_grant_is_refused(): void
    {
        Sanctum::actingAs(User::find($this->attackerId));

        $email = 'f348.nogrant.' . bin2hex(random_bytes(5)) . '@example.test';
        $response = $this->postJson(
            '/api/v2/caring-community/vereine/' . $this->clubGrantedId . '/members/import',
            ['csv' => "email,first_name,last_name\n{$email},Imported,Member\n"],
            $this->withTenantHeader()
        );

        $this->assertSame(403, $response->getStatusCode());
        $this->assertNull(
            DB::table('users')->where('tenant_id', self::TENANT)->where('email', $email)->first()
        );
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    private function makeAdmin(): int
    {
        $id = $this->makeMember('f348.rbacadmin');
        DB::table('users')->where('id', $id)->update(['role' => 'admin', 'is_admin' => 1]);

        return $id;
    }

    private function grantRole(?int $tenantId, ?int $scopeOrgId): void
    {
        DB::table('user_roles')->insert([
            'user_id' => $this->attackerId,
            'role_id' => $this->roleId,
            'tenant_id' => $tenantId,
            'scope_organization_id' => $scopeOrgId,
            'assigned_by' => null,
            'expires_at' => null,
        ]);
    }

    private function enableCaringCommunity(): void
    {
        $tenant = DB::table('tenants')->where('id', self::TENANT)->first();
        $features = [];
        if ($tenant && ! empty($tenant->features)) {
            $decoded = is_string($tenant->features) ? json_decode($tenant->features, true) : $tenant->features;
            $features = is_array($decoded) ? $decoded : [];
        }
        $features['caring_community'] = true;
        DB::table('tenants')->where('id', self::TENANT)->update(['features' => json_encode($features)]);
        TenantContext::reset();
        TenantContext::setById(self::TENANT);
    }

    private function makeMember(string $prefix): int
    {
        $email = $prefix . '.' . bin2hex(random_bytes(5)) . '@example.test';

        return (int) DB::table('users')->insertGetId([
            'tenant_id' => self::TENANT,
            'name' => 'F348 Member',
            'first_name' => 'F348',
            'last_name' => 'Member',
            'email' => $email,
            'username' => 'f348_' . substr(md5($email), 0, 10),
            'password' => password_hash('password', PASSWORD_BCRYPT),
            'role' => 'member',
            'status' => 'active',
            'is_approved' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function makeClub(string $name): int
    {
        return (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => self::TENANT,
            'user_id' => $this->attackerId,
            'name' => $name . ' ' . bin2hex(random_bytes(3)),
            'org_type' => 'club',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
