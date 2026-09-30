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
 * F-350 (E-065) — a permission attached when a role was created could never be
 * taken back, and the editor reported success.
 *
 * `AdminEnterpriseController::createRole()` inserted `role_permissions` without
 * a `tenant_id`, so the row landed NULL. `updateRole()` deleted
 * `WHERE role_id = ? AND tenant_id = ?`, which cannot match a NULL row; it then
 * re-inserted the requested set and returned 200. An administrator performing
 * the documented revocation was told it worked and it had not.
 *
 * Re-saving the SAME permission on such a role hit the
 * `unique_role_permission` key instead and returned 500 UPDATE_FAILED — the
 * same defect from the other side.
 *
 * Adapted from the E-065 slice-J reproduction
 * `.local-docs-archive/security-log/E-065/repro/j/VereinManageGrantScopeTest.php`
 * (the J-2 cases), which asserted the BAD outcome. The slug used here is
 * `volunteering.hours.review` because the F-348 allowlist now refuses the
 * organisation-scoped verein slugs the reproduction used.
 */
final class F350RolePermissionRevocationTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT = 2;
    private const SLUG = 'volunteering.hours.review';

    private int $adminId = 0;
    private int $permissionId = 0;

    protected function setUp(): void
    {
        parent::setUp();

        // No schema guard here on purpose. Every table and column this test
        // touches is in the committed schema dump, so a guard could never fire
        // in CI and would only hide a broken fixture locally — which is what the
        // pre-commit schema-skip budget exists to prevent.

        TenantContext::setById(self::TENANT);

        DB::table('permissions')->insertOrIgnore([
            'name' => self::SLUG,
            'display_name' => 'Review Volunteer Hours',
            'category' => 'volunteering',
            'tenant_id' => null,
        ]);
        $this->permissionId = (int) DB::table('permissions')->where('name', self::SLUG)->value('id');

        $this->adminId = $this->makeAdmin();
        Sanctum::actingAs(User::find($this->adminId));
    }

    /**
     * The row a role CREATION writes must carry the owning community, or the
     * revocation query can never find it.
     */
    public function test_permission_attached_at_role_creation_carries_the_tenant(): void
    {
        $roleId = $this->createRoleWithPermission();

        $this->assertSame(
            0,
            DB::table('role_permissions')->where('role_id', $roleId)->whereNull('tenant_id')->count(),
            'BAD OUTCOME: createRole() wrote a role_permissions row with a NULL tenant_id.'
        );
        $this->assertSame(
            1,
            DB::table('role_permissions')
                ->where('role_id', $roleId)
                ->where('tenant_id', self::TENANT)
                ->count()
        );
    }

    /**
     * A permission attached at creation must be removable through the editor.
     */
    public function test_permission_attached_at_role_creation_can_be_removed(): void
    {
        $roleId = $this->createRoleWithPermission();

        $removed = $this->putJson(
            '/api/v2/admin/enterprise/roles/' . $roleId,
            ['permissions' => []],
            $this->withTenantHeader()
        );
        $this->assertSame(200, $removed->getStatusCode(), $removed->getContent());

        $this->assertSame(
            0,
            DB::table('role_permissions')->where('role_id', $roleId)->count(),
            'BAD OUTCOME: the permission row survived a save that removed it, and the editor '
            . 'reported success.'
        );
    }

    /**
     * Databases in service already hold NULL-tenant rows written by the old
     * `createRole()`. A save must clear those too, whether or not the repair
     * migration has run.
     */
    public function test_legacy_null_tenant_permission_row_is_removed_by_a_save(): void
    {
        $roleId = (int) DB::table('roles')->insertGetId([
            'name' => 'f350_legacy_' . bin2hex(random_bytes(4)),
            'display_name' => 'F350 legacy role',
            'level' => 10,
            'is_system' => 0,
            'tenant_id' => self::TENANT,
        ]);
        DB::table('role_permissions')->insert([
            'role_id' => $roleId,
            'permission_id' => $this->permissionId,
            'tenant_id' => null,
        ]);

        $removed = $this->putJson(
            '/api/v2/admin/enterprise/roles/' . $roleId,
            ['permissions' => []],
            $this->withTenantHeader()
        );
        $this->assertSame(200, $removed->getStatusCode(), $removed->getContent());

        $this->assertSame(
            0,
            DB::table('role_permissions')->where('role_id', $roleId)->count(),
            'BAD OUTCOME: a legacy NULL-tenant row survived the revocation.'
        );
    }

    /**
     * Re-saving the same permission on a role created through the panel must
     * not hit the unique key and return 500.
     */
    public function test_resaving_the_same_permission_is_not_a_server_error(): void
    {
        $roleId = $this->createRoleWithPermission();

        $resave = $this->putJson(
            '/api/v2/admin/enterprise/roles/' . $roleId,
            ['permissions' => [self::SLUG]],
            $this->withTenantHeader()
        );

        $this->assertSame(
            200,
            $resave->getStatusCode(),
            'BAD OUTCOME: re-saving the same permission returned a server error. Body: '
            . $resave->getContent()
        );
        $this->assertSame(
            1,
            DB::table('role_permissions')->where('role_id', $roleId)->count()
        );
    }

    /**
     * CONTROL — a permission attached by `updateRole()` (which always wrote
     * `tenant_id`) is still removed by the next save. Unchanged behaviour.
     */
    public function test_control_permission_attached_by_update_is_still_removed(): void
    {
        $roleId = (int) DB::table('roles')->insertGetId([
            'name' => 'f350_control_' . bin2hex(random_bytes(4)),
            'display_name' => 'F350 control role',
            'level' => 10,
            'is_system' => 0,
            'tenant_id' => self::TENANT,
        ]);

        $this->putJson(
            '/api/v2/admin/enterprise/roles/' . $roleId,
            ['permissions' => [self::SLUG]],
            $this->withTenantHeader()
        )->assertStatus(200);
        $this->assertSame(1, DB::table('role_permissions')->where('role_id', $roleId)->count());

        $this->putJson(
            '/api/v2/admin/enterprise/roles/' . $roleId,
            ['permissions' => []],
            $this->withTenantHeader()
        )->assertStatus(200);
        $this->assertSame(0, DB::table('role_permissions')->where('role_id', $roleId)->count());
    }

    // ── fixtures ───────────────────────────────────────────────────────────

    private function createRoleWithPermission(): int
    {
        $name = 'f350_created_' . bin2hex(random_bytes(4));
        $created = $this->postJson(
            '/api/v2/admin/enterprise/roles',
            [
                'name' => $name,
                'display_name' => 'F350 created role',
                'permissions' => [self::SLUG],
            ],
            $this->withTenantHeader()
        );
        $this->assertSame(201, $created->getStatusCode(), $created->getContent());

        return (int) DB::table('roles')
            ->where('tenant_id', self::TENANT)
            ->where('name', $name)
            ->value('id');
    }

    private function makeAdmin(): int
    {
        $email = 'f350.admin.' . bin2hex(random_bytes(5)) . '@example.test';

        return (int) DB::table('users')->insertGetId([
            'tenant_id' => self::TENANT,
            'name' => 'F350 Admin',
            'first_name' => 'F350',
            'last_name' => 'Admin',
            'email' => $email,
            'username' => 'f350_' . substr(md5($email), 0, 10),
            'password' => password_hash('password', PASSWORD_BCRYPT),
            'role' => 'admin',
            'is_admin' => 1,
            'status' => 'active',
            'is_approved' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
