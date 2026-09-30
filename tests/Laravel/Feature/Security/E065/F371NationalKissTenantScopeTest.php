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
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-371 (E-065) — the national KISS dashboard predicate had no tenant filter.
 *
 * `NationalKissDashboardController::userHasNationalDashboardPermission()` joined
 * `user_roles → roles → role_permissions → permissions` and never mentioned
 * `ur.tenant_id`, so a grant made in one community satisfied the check from
 * ANY community. The four routes it guards are the cross-cooperative
 * comparison views — exactly the missing filter commit `0cb8be769` added to
 * `EnsureIsAdmin`.
 *
 * E-065 recorded this as suspected and did not reproduce it, because the role
 * preset service writes `is_system = 0` with a concrete `tenant_id`, which
 * cannot satisfy the rest of the predicate. The row is therefore seeded here in
 * the shape the predicate itself demands.
 */
final class F371NationalKissTenantScopeTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT = 2;

    private int $otherTenantId = 0;
    private int $memberId = 0;
    private int $roleId = 0;

    protected function setUp(): void
    {
        parent::setUp();

        // No schema guard here on purpose. Every table and column this test
        // touches is in the committed schema dump, so a guard could never fire
        // in CI and would only hide a broken fixture locally — which is what the
        // pre-commit schema-skip budget exists to prevent.

        Cache::flush();
        TenantContext::setById(self::TENANT);

        $this->otherTenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'F371 Other Community',
            'slug' => 'f371-other-' . bin2hex(random_bytes(4)),
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->memberId = $this->makeMember();

        // Exactly the shape the predicate demands: a platform-global system role.
        DB::table('roles')->insertOrIgnore([
            'name' => 'kiss_national_admin',
            'display_name' => 'KISS National Admin',
            'level' => 20,
            'is_system' => 1,
            'tenant_id' => null,
        ]);
        $this->roleId = (int) DB::table('roles')->where('name', 'kiss_national_admin')->value('id');

        DB::table('permissions')->insertOrIgnore([
            'name' => 'national.kiss_dashboard.view',
            'display_name' => 'View National KISS Dashboard',
            'category' => 'caring',
        ]);
        $permissionId = (int) DB::table('permissions')->where('name', 'national.kiss_dashboard.view')->value('id');

        DB::table('role_permissions')->insertOrIgnore([
            'role_id' => $this->roleId,
            'permission_id' => $permissionId,
            'tenant_id' => null,
        ]);
    }

    /**
     * A grant made in ANOTHER community must not open the dashboard here.
     */
    public function test_grant_in_another_community_does_not_open_the_dashboard(): void
    {
        $this->grant($this->otherTenantId);

        Sanctum::actingAs(User::find($this->memberId));
        $response = $this->getJson('/api/v2/admin/national/kiss/summary', $this->withTenantHeader());

        $this->assertSame(
            403,
            $response->getStatusCode(),
            'BAD OUTCOME: a grant made in community ' . $this->otherTenantId . ' opened the '
            . 'cross-cooperative dashboard from community ' . self::TENANT . '.'
        );
    }

    /**
     * CONTROL — the same grant made in THIS community still opens it, so the
     * attack case does not pass because the route broke.
     */
    public function test_control_grant_in_this_community_still_opens_the_dashboard(): void
    {
        $this->grant(self::TENANT);

        Sanctum::actingAs(User::find($this->memberId));
        $response = $this->getJson('/api/v2/admin/national/kiss/summary', $this->withTenantHeader());

        $this->assertSame(
            200,
            $response->getStatusCode(),
            'CONTROL body: ' . substr($response->getContent(), 0, 400)
        );
    }

    /**
     * CONTROL — a plain member with no grant is refused.
     */
    public function test_control_member_without_a_grant_is_refused(): void
    {
        Sanctum::actingAs(User::find($this->memberId));
        $response = $this->getJson('/api/v2/admin/national/kiss/summary', $this->withTenantHeader());

        $this->assertSame(403, $response->getStatusCode());
    }

    // ── fixtures ───────────────────────────────────────────────────────────

    private function grant(int $tenantId): void
    {
        DB::table('user_roles')->insert([
            'user_id' => $this->memberId,
            'role_id' => $this->roleId,
            'tenant_id' => $tenantId,
            'assigned_by' => null,
            'expires_at' => null,
        ]);
    }

    private function makeMember(): int
    {
        $email = 'f371.member.' . bin2hex(random_bytes(5)) . '@example.test';

        return (int) DB::table('users')->insertGetId([
            'tenant_id' => self::TENANT,
            'name' => 'F371 Member',
            'first_name' => 'F371',
            'last_name' => 'Member',
            'email' => $email,
            'username' => 'f371_' . substr(md5($email), 0, 10),
            'password' => password_hash('password', PASSWORD_BCRYPT),
            'role' => 'member',
            'status' => 'active',
            'is_approved' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
