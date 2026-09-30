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
 * F-362 (E-065) — a security fix applied to one copy of a duplicated predicate
 * and not the other.
 *
 * Commit `0cb8be769` hardened `EnsureIsAdmin::allowsScopedVereinAdmin()` to
 * `->where('ur.tenant_id', $tenantId)`, with a comment saying a NULL 'global'
 * `user_roles` row "could only be a malicious/misconfigured grant bypassing
 * tenant isolation". The twin `VereinMemberImportService::userHasPermissionInOrg()`
 * still read `->orWhereNull('ur.tenant_id')`, and two of the four import routes
 * strip `EnsureIsAdmin` — so on those routes the un-hardened copy was the only
 * check there was.
 *
 * The precondition is not reachable through any API today (every writer of
 * `user_roles` sets a concrete tenant), so the row is seeded directly, exactly
 * as the E-065 reproduction did.
 *
 * Adapted from `.local-docs-archive/security-log/E-065/repro/d/VereinImportScopeEscapeTest.php`
 * (ATTACK 1 and CONTROL 1), which asserted the BAD outcome. The attack
 * assertion is inverted.
 */
final class F362VereinImportNullTenantTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT = 2;

    private int $attackerId = 0;
    private int $clubId = 0;
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

        $this->attackerId = $this->makeMember('f362.attacker');
        $this->clubId = $this->makeClub('F362 Club');

        $this->permissionId = (int) DB::table('permissions')->insertGetId([
            'name' => 'verein.members.import',
            'display_name' => 'Import Verein Members',
            'category' => 'vereine',
            'tenant_id' => null,
        ]);
        $this->roleId = (int) DB::table('roles')->insertGetId([
            'name' => 'f362_role_' . bin2hex(random_bytes(4)),
            'display_name' => 'F362 verein admin',
            'level' => 10,
            'is_system' => 0,
            'tenant_id' => self::TENANT,
        ]);
        DB::table('role_permissions')->insert([
            'role_id' => $this->roleId,
            'permission_id' => $this->permissionId,
            'tenant_id' => self::TENANT,
        ]);
    }

    /**
     * A grant naming NO community must not authorise import in this one.
     */
    public function test_user_roles_row_with_null_tenant_id_does_not_authorise_import(): void
    {
        $this->grantRole(tenantId: null);

        Sanctum::actingAs(User::find($this->attackerId));

        $email = 'f362.null.tenant.' . bin2hex(random_bytes(5)) . '@example.test';
        $response = $this->postJson(
            '/api/v2/caring-community/vereine/' . $this->clubId . '/members/import',
            ['csv' => "email,first_name,last_name\n{$email},Imported,Member\n"],
            $this->withTenantHeader()
        );

        $this->assertSame(
            403,
            $response->getStatusCode(),
            'BAD OUTCOME: a user_roles grant naming NO community authorised import in '
            . 'community ' . self::TENANT . '.'
        );
        $this->assertNull(
            DB::table('users')->where('tenant_id', self::TENANT)->where('email', $email)->first(),
            'BAD OUTCOME: the NULL-tenant grant created an account.'
        );
    }

    /**
     * CONTROL — a grant naming another community is refused (this already held).
     */
    public function test_control_user_roles_row_naming_another_tenant_is_refused(): void
    {
        $this->grantRole(tenantId: 999);

        Sanctum::actingAs(User::find($this->attackerId));

        $email = 'f362.other.tenant.' . bin2hex(random_bytes(5)) . '@example.test';
        $response = $this->postJson(
            '/api/v2/caring-community/vereine/' . $this->clubId . '/members/import',
            ['csv' => "email,first_name,last_name\n{$email},Imported,Member\n"],
            $this->withTenantHeader()
        );

        $this->assertSame(403, $response->getStatusCode());
        $this->assertNull(
            DB::table('users')->where('tenant_id', self::TENANT)->where('email', $email)->first()
        );
    }

    /**
     * CONTROL — the same grant naming THIS community still works, so the attack
     * case does not pass for an unrelated reason.
     */
    public function test_control_user_roles_row_naming_this_tenant_still_imports(): void
    {
        $this->grantRole(tenantId: self::TENANT);

        Sanctum::actingAs(User::find($this->attackerId));

        $email = 'f362.this.tenant.' . bin2hex(random_bytes(5)) . '@example.test';
        $response = $this->postJson(
            '/api/v2/caring-community/vereine/' . $this->clubId . '/members/import',
            ['csv' => "email,first_name,last_name\n{$email},Imported,Member\n"],
            $this->withTenantHeader()
        );

        $this->assertSame(201, $response->getStatusCode(), $response->getContent());
        $this->assertNotNull(
            DB::table('users')->where('tenant_id', self::TENANT)->where('email', $email)->first()
        );
    }

    // ── fixtures ───────────────────────────────────────────────────────────

    private function grantRole(?int $tenantId): void
    {
        DB::table('user_roles')->insert([
            'user_id' => $this->attackerId,
            'role_id' => $this->roleId,
            'tenant_id' => $tenantId,
            'scope_organization_id' => $this->clubId,
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
            'name' => 'F362 Member',
            'first_name' => 'F362',
            'last_name' => 'Member',
            'email' => $email,
            'username' => 'f362_' . substr(md5($email), 0, 10),
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
