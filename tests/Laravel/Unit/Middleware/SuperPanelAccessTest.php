<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Middleware;

use App\Middleware\SuperPanelAccess;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;
use Illuminate\Foundation\Testing\DatabaseTransactions;

/**
 * Tests for SuperPanelAccess middleware.
 *
 * This middleware checks user access to the Super Admin Panel
 * based on tenant hierarchy and user flags.
 */
class SuperPanelAccessTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        SuperPanelAccess::reset();
    }

    protected function tearDown(): void
    {
        SuperPanelAccess::reset();
        parent::tearDown();
    }

    private function createMasterTenant(): void
    {
        DB::table('tenants')->updateOrInsert(
            ['id' => 1],
            [
                'name' => 'Master',
                'slug' => 'master',
                'path' => '/1/',
                'depth' => 0,
                'allows_subtenants' => true,
                'max_depth' => 3,
                'is_active' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );
    }

    private function createRegionalTenant(): void
    {
        DB::table('tenants')->updateOrInsert(
            ['id' => 10],
            [
                'name' => 'Regional Hub',
                'slug' => 'regional-hub',
                'path' => '/1/10/',
                'depth' => 1,
                'allows_subtenants' => true,
                'max_depth' => 3,
                'is_active' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );
    }

    public function test_check_returns_false_when_not_authenticated(): void
    {
        $this->assertFalse(SuperPanelAccess::check());
    }

    public function test_getAccess_returns_not_authenticated_by_default(): void
    {
        $access = SuperPanelAccess::getAccess();

        $this->assertFalse($access['granted']);
        $this->assertEquals('none', $access['level']);
        $this->assertEquals('Not authenticated', $access['reason']);
    }

    public function test_getAccess_returns_user_not_found_for_invalid_user(): void
    {
        SuperPanelAccess::reset();
        $access = SuperPanelAccess::getAccess(99999);

        $this->assertFalse($access['granted']);
        $this->assertEquals('User not found', $access['reason']);
    }

    public function test_getAccess_denies_regular_user(): void
    {
        $this->createMasterTenant();

        $userId = DB::table('users')->insertGetId([
            'tenant_id' => 1,
            'first_name' => 'Regular',
            'last_name' => 'User',
            'email' => 'regular@test.com',
            'password' => bcrypt('password'),
            'role' => 'member',
            'is_super_admin' => false,
            'is_tenant_super_admin' => false,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        SuperPanelAccess::reset();
        $access = SuperPanelAccess::getAccess($userId);

        $this->assertFalse($access['granted']);
        $this->assertEquals('Not a Super Admin for any tenant', $access['reason']);
    }

    /**
     * Owner decision, 11 Oct 2026: a tenant super admin on the master tenant is
     * NOT master any more — it reaches its own community only. This test was
     * test_getAccess_grants_master_tenant_super_admin and asserted master/global.
     */
    public function test_getAccess_confines_a_master_tenant_super_admin_to_its_own_community(): void
    {
        $this->createMasterTenant();

        $userId = DB::table('users')->insertGetId([
            'tenant_id' => 1,
            'first_name' => 'Master',
            'last_name' => 'Admin',
            'email' => 'master@test.com',
            'password' => bcrypt('password'),
            'role' => 'admin',
            'is_super_admin' => false,
            'is_tenant_super_admin' => true,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        SuperPanelAccess::reset();
        $access = SuperPanelAccess::getAccess($userId);

        $this->assertTrue($access['granted']);
        $this->assertEquals('regional', $access['level']);
        $this->assertEquals('own', $access['scope']);
        $this->assertFalse($access['can_create_tenants']);
        $this->assertTrue(SuperPanelAccess::canAccessTenant(1));
        $this->assertFalse(SuperPanelAccess::canAccessTenant(999));
    }

    public function test_getAccess_grants_regional_tenant_super_admin(): void
    {
        $this->createMasterTenant();
        $this->createRegionalTenant();

        $userId = DB::table('users')->insertGetId([
            'tenant_id' => 10,
            'first_name' => 'Regional',
            'last_name' => 'Admin',
            'email' => 'regional@test.com',
            'password' => bcrypt('password'),
            'role' => 'admin',
            'is_super_admin' => false,
            'is_tenant_super_admin' => true,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        SuperPanelAccess::reset();
        $access = SuperPanelAccess::getAccess($userId);

        $this->assertTrue($access['granted']);
        $this->assertEquals('regional', $access['level']);
        // 'own' since 11 Oct 2026 (was 'subtree'): its own community only.
        $this->assertEquals('own', $access['scope']);
    }

    public function test_getAccess_denies_super_admin_on_standard_tenant(): void
    {
        // Standard tenant (allows_subtenants = false, not tenant 1)
        DB::table('tenants')->updateOrInsert(
            ['id' => 50],
            [
                'name' => 'Standard Tenant',
                'slug' => 'standard',
                'path' => '/1/50/',
                'depth' => 1,
                'allows_subtenants' => false,
                'max_depth' => 0,
                'is_active' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );

        $userId = DB::table('users')->insertGetId([
            'tenant_id' => 50,
            'first_name' => 'Standard',
            'last_name' => 'SuperAdmin',
            'email' => 'standard-super@test.com',
            'password' => bcrypt('password'),
            'role' => 'admin',
            'is_super_admin' => false,
            'is_tenant_super_admin' => true,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        SuperPanelAccess::reset();
        $access = SuperPanelAccess::getAccess($userId);

        $this->assertFalse($access['granted']);
        $this->assertEquals('Tenant does not have sub-tenant capability', $access['reason']);
    }

    public function test_getAccess_grants_global_access_to_god_user_on_standard_tenant(): void
    {
        DB::table('tenants')->updateOrInsert(
            ['id' => 51],
            [
                'name' => 'Standard God Tenant',
                'slug' => 'standard-god',
                'path' => '/1/51/',
                'depth' => 1,
                'allows_subtenants' => false,
                'max_depth' => 0,
                'is_active' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );

        $userId = DB::table('users')->insertGetId([
            'tenant_id' => 51,
            'first_name' => 'Platform',
            'last_name' => 'God',
            'email' => 'platform-god-standard@test.com',
            'password' => bcrypt('password'),
            'role' => 'god',
            'is_super_admin' => false,
            'is_tenant_super_admin' => false,
            'is_god' => true,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        SuperPanelAccess::reset();
        $access = SuperPanelAccess::getAccess($userId);

        $this->assertTrue($access['granted']);
        $this->assertEquals('master', $access['level']);
        $this->assertEquals('global', $access['scope']);
        $this->assertTrue($access['can_create_tenants']);
    }

    public function test_getAccess_caches_result_per_request(): void
    {
        SuperPanelAccess::reset();
        $access1 = SuperPanelAccess::getAccess();
        $access2 = SuperPanelAccess::getAccess();

        $this->assertEquals($access1, $access2);
    }

    public function test_getScopeClause_returns_impossible_condition_when_no_access(): void
    {
        SuperPanelAccess::reset();
        // No user authenticated
        $clause = SuperPanelAccess::getScopeClause('t');

        $this->assertEquals('1 = 0', $clause['sql']);
        $this->assertEmpty($clause['params']);
    }

    public function test_getScopeClause_returns_unrestricted_for_master(): void
    {
        $this->createMasterTenant();

        // A platform super admin: since 11 Oct 2026 the only master-level caller
        // (a tenant super admin on tenant 1 was master until then).
        $userId = DB::table('users')->insertGetId([
            'tenant_id' => 1,
            'first_name' => 'Master',
            'last_name' => 'Admin',
            'email' => 'master-scope@test.com',
            'password' => bcrypt('password'),
            'role' => 'admin',
            'is_super_admin' => true,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        SuperPanelAccess::reset();
        SuperPanelAccess::getAccess($userId);

        $clause = SuperPanelAccess::getScopeClause('t');

        $this->assertEquals('1 = 1', $clause['sql']);
        $this->assertEmpty($clause['params']);
    }

    /**
     * Was test_getScopeClause_returns_path_filter_for_regional (`t.path LIKE
     * '/1/10/%'`, its whole subtree). Since 11 Oct 2026: its own community only.
     */
    public function test_getScopeClause_returns_own_tenant_filter_for_regional(): void
    {
        $this->createMasterTenant();
        $this->createRegionalTenant();

        $userId = DB::table('users')->insertGetId([
            'tenant_id' => 10,
            'first_name' => 'Regional',
            'last_name' => 'Admin',
            'email' => 'regional-scope@test.com',
            'password' => bcrypt('password'),
            'role' => 'admin',
            'is_tenant_super_admin' => true,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        SuperPanelAccess::reset();
        SuperPanelAccess::getAccess($userId);

        $clause = SuperPanelAccess::getScopeClause('t');

        $this->assertEquals('t.id = ?', $clause['sql']);
        $this->assertEquals([10], $clause['params']);
    }

    public function test_canAccessTenant_master_sees_all(): void
    {
        $this->createMasterTenant();

        $userId = DB::table('users')->insertGetId([
            'tenant_id' => 1,
            'first_name' => 'Master',
            'last_name' => 'Admin',
            'email' => 'master-access@test.com',
            'password' => bcrypt('password'),
            'role' => 'admin',
            // Platform super admin — the only master since 11 Oct 2026.
            'is_super_admin' => true,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        SuperPanelAccess::reset();
        SuperPanelAccess::getAccess($userId);

        $this->assertTrue(SuperPanelAccess::canAccessTenant(1));
        $this->assertTrue(SuperPanelAccess::canAccessTenant(999)); // any tenant
    }

    public function test_canAccessTenant_returns_false_when_no_access(): void
    {
        SuperPanelAccess::reset();
        $this->assertFalse(SuperPanelAccess::canAccessTenant(1));
    }

    public function test_reset_clears_cached_access(): void
    {
        SuperPanelAccess::reset();
        $access1 = SuperPanelAccess::getAccess();
        $this->assertFalse($access1['granted']);

        SuperPanelAccess::reset();
        // After reset, cache is cleared
        $access2 = SuperPanelAccess::getAccess();
        $this->assertFalse($access2['granted']);
    }
}
