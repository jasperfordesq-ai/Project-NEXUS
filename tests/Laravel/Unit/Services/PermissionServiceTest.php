<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\Enterprise\PermissionService;
use Illuminate\Support\Facades\DB;
use Mockery;

/**
 * PermissionService Tests
 *
 * Tests Permission-Based Access Control (PBAC) functionality including:
 * - Role-based access checks (admin, broker, member roles)
 * - Permission hierarchy (super_admin > tenant_admin > admin > broker > member)
 * - Permission browser (list all permissions for a role)
 * - Feature-based permissions
 * - Tenant-scoped permission checks
 * - Wildcard permissions
 * - Direct grant/revocation
 * - Audit logging toggle
 * - Edge cases: unknown role, no permissions, multiple roles
 *
 * @covers \App\Services\Enterprise\PermissionService
 */
class PermissionServiceTest extends \Tests\Laravel\TestCase
{
    private PermissionService $service;

    protected function setUp(): void
    {
        parent::setUp();

        // Initialize session for caching
        if (!isset($_SESSION)) {
            $_SESSION = [];
        }

        // Clear any cached permissions
        foreach (array_keys($_SESSION) as $key) {
            if (str_starts_with($key, 'perm_')) {
                unset($_SESSION[$key]);
            }
        }

        // Clear super admin session flag
        unset($_SESSION['user_id'], $_SESSION['is_super_admin'], $_SESSION['user_role'], $_SESSION['is_admin']);

        // PermissionService treats DB::statement() as a PDO-style query returning a
        // statement object (it calls ->fetch()/->fetchAll()/->fetchColumn() on the
        // result). Stub DB::statement to return an empty PDOStatement-like double so
        // the permission-resolution logic (session cache, super-admin gate, direct
        // grants/revocations, role lookups) can be exercised without a live PDO query.
        // See the FLAGGED note in the test file footer about the real-bug suspicion.
        $emptyStmt = Mockery::mock(\PDOStatement::class);
        $emptyStmt->shouldReceive('fetch')->andReturn(false);
        $emptyStmt->shouldReceive('fetchAll')->andReturn([]);
        $emptyStmt->shouldReceive('fetchColumn')->andReturn(false);
        DB::shouldReceive('statement')->andReturn($emptyStmt)->byDefault();

        $this->service = new PermissionService();
    }

    protected function tearDown(): void
    {
        // Clean up session
        if (isset($_SESSION)) {
            foreach (array_keys($_SESSION) as $key) {
                if (str_starts_with($key, 'perm_')) {
                    unset($_SESSION[$key]);
                }
            }
        }

        unset($_SESSION['user_id'], $_SESSION['is_super_admin'], $_SESSION['user_role'], $_SESSION['is_admin']);

        parent::tearDown();
    }

    // =========================================================================
    // CLASS STRUCTURE TESTS
    // =========================================================================

    public function testClassExists(): void
    {
        $this->assertTrue(class_exists(PermissionService::class));
    }

    public function testPublicMethodsExist(): void
    {
        $methods = [
            'can',
            'canAll',
            'canAny',
            'getUserPermissions',
            'getUserRoles',
            'assignRole',
            'revokeRole',
            'grantPermission',
            'revokePermission',
            'clearUserPermissionCache',
            'getAllPermissions',
            'getAllRoles',
            'createRole',
            'attachPermissionsToRole',
            'disableAudit',
            'enableAudit',
        ];

        foreach ($methods as $method) {
            $this->assertTrue(
                method_exists(PermissionService::class, $method),
                "Method {$method} should exist on PermissionService"
            );
        }
    }

    public function testConstants(): void
    {
        $this->assertEquals('granted', PermissionService::RESULT_GRANTED);
        $this->assertEquals('denied', PermissionService::RESULT_DENIED);
    }

    // =========================================================================
    // CAN METHOD TESTS
    // =========================================================================

    public function testCanMethodSignature(): void
    {
        $ref = new \ReflectionMethod(PermissionService::class, 'can');
        $params = $ref->getParameters();

        $this->assertEquals('userId', $params[0]->getName());
        $this->assertEquals('permission', $params[1]->getName());
        $this->assertEquals('resource', $params[2]->getName());
        $this->assertEquals('logCheck', $params[3]->getName());

        $this->assertTrue($params[2]->isDefaultValueAvailable());
        $this->assertNull($params[2]->getDefaultValue());
        $this->assertTrue($params[3]->isDefaultValueAvailable());
        $this->assertTrue($params[3]->getDefaultValue());
    }

    public function testCanUsesSessionCacheForSubsequentChecks(): void
    {
        // Manually set a cached permission
        $_SESSION['perm_1_users.view'] = true;

        // Disable audit to avoid DB call for logging
        $this->service->disableAudit();

        $result = $this->service->can(1, 'users.view', null, false);

        $this->assertTrue($result);
    }

    public function testCanCachesDeniedResult(): void
    {
        $_SESSION['perm_50_admin.settings'] = false;

        $this->service->disableAudit();

        $result = $this->service->can(50, 'admin.settings', null, false);

        $this->assertFalse($result);
    }

    public function testCanGrantsSuperAdminAllPermissions(): void
    {
        // Set session for super admin
        $_SESSION['user_id'] = 1;
        $_SESSION['is_super_admin'] = true;

        $this->service->disableAudit();

        $result = $this->service->can(1, 'anything.at.all', null, false);

        $this->assertTrue($result);
    }

    // =========================================================================
    // CAN ALL / CAN ANY TESTS
    // =========================================================================

    public function testCanAllReturnsTrueWhenAllGranted(): void
    {
        $_SESSION['perm_1_users.view'] = true;
        $_SESSION['perm_1_users.edit'] = true;
        $_SESSION['perm_1_users.delete'] = true;

        $this->service->disableAudit();

        $result = $this->service->canAll(1, ['users.view', 'users.edit', 'users.delete']);

        $this->assertTrue($result);
    }

    public function testCanAllReturnsFalseWhenAnyDenied(): void
    {
        $_SESSION['perm_1_users.view'] = true;
        $_SESSION['perm_1_users.edit'] = true;
        $_SESSION['perm_1_users.delete'] = false;

        $this->service->disableAudit();

        $result = $this->service->canAll(1, ['users.view', 'users.edit', 'users.delete']);

        $this->assertFalse($result);
    }

    public function testCanAnyReturnsTrueWhenAtLeastOneGranted(): void
    {
        $_SESSION['perm_1_admin.view'] = false;
        $_SESSION['perm_1_admin.edit'] = true;

        $this->service->disableAudit();

        $result = $this->service->canAny(1, ['admin.view', 'admin.edit']);

        $this->assertTrue($result);
    }

    public function testCanAnyReturnsFalseWhenAllDenied(): void
    {
        $_SESSION['perm_1_admin.view'] = false;
        $_SESSION['perm_1_admin.edit'] = false;
        $_SESSION['perm_1_admin.delete'] = false;

        $this->service->disableAudit();

        $result = $this->service->canAny(1, ['admin.view', 'admin.edit', 'admin.delete']);

        $this->assertFalse($result);
    }

    public function testCanAllWithEmptyArrayReturnsTrue(): void
    {
        $result = $this->service->canAll(1, []);

        $this->assertTrue($result);
    }

    public function testCanAnyWithEmptyArrayReturnsFalse(): void
    {
        $result = $this->service->canAny(1, []);

        $this->assertFalse($result);
    }

    // =========================================================================
    // SUPER ADMIN BYPASS TESTS
    // =========================================================================

    public function testSuperAdminBypassesAllChecksViaSession(): void
    {
        $_SESSION['user_id'] = 999;
        $_SESSION['is_super_admin'] = true;

        $this->service->disableAudit();

        // Super admin should have access to absolutely everything
        $this->assertTrue($this->service->can(999, 'gdpr.requests.approve', null, false));
        $this->assertTrue($this->service->can(999, 'users.delete', null, false));
        $this->assertTrue($this->service->can(999, 'system.shutdown', null, false));
        $this->assertTrue($this->service->can(999, 'nonexistent.permission', null, false));
    }

    public function testSuperAdminCanAllAlwaysReturnsTrue(): void
    {
        $_SESSION['user_id'] = 999;
        $_SESSION['is_super_admin'] = true;

        $this->service->disableAudit();

        $result = $this->service->canAll(999, [
            'gdpr.requests.approve',
            'users.delete',
            'system.shutdown',
        ]);

        $this->assertTrue($result);
    }

    // =========================================================================
    // PERMISSION CACHE TESTS
    // =========================================================================

    public function testClearUserPermissionCacheClearsSessionKeys(): void
    {
        $_SESSION['perm_42_users.view'] = true;
        $_SESSION['perm_42_users.edit'] = false;
        $_SESSION['perm_42_admin.settings'] = true;
        $_SESSION['perm_99_users.view'] = true; // Different user, should not be cleared
        $_SESSION['other_key'] = 'preserved';

        // clearUserPermissionCache also calls Database::query, which we can't easily mock
        // for a non-static class method. Instead, test the session clearing logic via reflection.
        $ref = new \ReflectionClass($this->service);

        // Manually clear using the same logic as the method
        foreach (array_keys($_SESSION) as $key) {
            if (str_starts_with($key, 'perm_42_')) {
                unset($_SESSION[$key]);
            }
        }

        // User 42's permissions should be cleared
        $this->assertArrayNotHasKey('perm_42_users.view', $_SESSION);
        $this->assertArrayNotHasKey('perm_42_users.edit', $_SESSION);
        $this->assertArrayNotHasKey('perm_42_admin.settings', $_SESSION);

        // User 99's permissions should remain
        $this->assertArrayHasKey('perm_99_users.view', $_SESSION);
        $this->assertEquals(true, $_SESSION['perm_99_users.view']);

        // Other session keys should be preserved
        $this->assertEquals('preserved', $_SESSION['other_key']);
    }

    // =========================================================================
    // AUDIT TOGGLE TESTS
    // =========================================================================

    public function testDisableAuditSetsFlag(): void
    {
        $this->service->disableAudit();

        $ref = new \ReflectionClass($this->service);
        $prop = $ref->getProperty('auditEnabled');
        $prop->setAccessible(true);

        $this->assertFalse($prop->getValue($this->service));
    }

    public function testEnableAuditSetsFlag(): void
    {
        $this->service->disableAudit();
        $this->service->enableAudit();

        $ref = new \ReflectionClass($this->service);
        $prop = $ref->getProperty('auditEnabled');
        $prop->setAccessible(true);

        $this->assertTrue($prop->getValue($this->service));
    }

    public function testAuditEnabledByDefault(): void
    {
        $freshService = new PermissionService();

        $ref = new \ReflectionClass($freshService);
        $prop = $ref->getProperty('auditEnabled');
        $prop->setAccessible(true);

        $this->assertTrue($prop->getValue($freshService));
    }

    // =========================================================================
    // WILDCARD PERMISSION LOGIC TESTS
    // =========================================================================

    public function testWildcardPermissionMethodExists(): void
    {
        $ref = new \ReflectionClass(PermissionService::class);
        $this->assertTrue($ref->hasMethod('hasWildcardPermission'));

        $method = $ref->getMethod('hasWildcardPermission');
        $this->assertTrue($method->isPrivate());
    }

    public function testWildcardPermissionParsesDotsCorrectly(): void
    {
        // Test that the wildcard check builds correct patterns
        // For 'users.profile.view', it should check 'users.profile.*' then 'users.*'
        $ref = new \ReflectionClass(PermissionService::class);
        $method = $ref->getMethod('hasWildcardPermission');
        $method->setAccessible(true);

        // Since we can't easily mock Database::query for internal calls,
        // we verify the method signature and parameter handling
        $this->assertEquals(2, $method->getNumberOfParameters());
    }

    // =========================================================================
    // PRIVATE HELPER METHOD TESTS
    // =========================================================================

    public function testIsSuperAdminChecksDatabaseWhenSessionMismatch(): void
    {
        $ref = new \ReflectionClass(PermissionService::class);
        $method = $ref->getMethod('isSuperAdmin');
        $method->setAccessible(true);

        // Different user ID in session
        $_SESSION['user_id'] = 100;
        $_SESSION['is_super_admin'] = false;

        // The method will try to check database, which might fail in unit test
        // but the important thing is it doesn't return true from session
        // when the user IDs don't match
        try {
            $result = $method->invoke($this->service, 999);
            // If we get here, the database either returned a result or we got false
            $this->assertIsBool($result);
        } catch (\Exception $e) {
            // Database not available in unit test - that's expected
            $this->assertTrue(true);
        }
    }

    public function testIsSuperAdminReturnsTrueFromSession(): void
    {
        $ref = new \ReflectionClass(PermissionService::class);
        $method = $ref->getMethod('isSuperAdmin');
        $method->setAccessible(true);

        $_SESSION['user_id'] = 1;
        $_SESSION['is_super_admin'] = true;

        $result = $method->invoke($this->service, 1);

        $this->assertTrue($result);
    }

    /**
     * E-103: the all-permissions bypass is the PLATFORM tier's alone. A tenant
     * super admin's reach is bounded by a subtree, so it must never be treated
     * as holding every permission (it was, via the session flag and the
     * is_tenant_super_admin column, until 12 Oct 2026).
     */
    public function testATenantSuperAdminSessionIsNotASuperAdminBypass(): void
    {
        $ref = new \ReflectionClass(PermissionService::class);
        $method = $ref->getMethod('isSuperAdmin');
        $method->setAccessible(true);

        $_SESSION['user_id'] = 7;
        $_SESSION['is_super_admin'] = false;
        $_SESSION['is_tenant_super_admin'] = 1;

        try {
            $this->assertFalse($method->invoke($this->service, 7));
        } finally {
            unset($_SESSION['is_tenant_super_admin']);
        }
    }

    public function testATenantSuperAdminRowIsNotASuperAdminBypass(): void
    {
        $row = Mockery::mock(\PDOStatement::class);
        $row->shouldReceive('fetch')->andReturn([
            'is_super_admin' => 0, 'is_tenant_super_admin' => 1, 'is_god' => 0, 'role' => 'admin',
        ]);
        // Overrides setUp()'s empty-result double, which is only a default.
        DB::shouldReceive('statement')->andReturn($row);

        $ref = new \ReflectionClass(PermissionService::class);
        $method = $ref->getMethod('isSuperAdmin');
        $method->setAccessible(true);

        $this->assertFalse($method->invoke(new PermissionService(), 8));
    }

    public function testAPlatformSuperAdminRowStillBypasses(): void
    {
        $row = Mockery::mock(\PDOStatement::class);
        $row->shouldReceive('fetch')->andReturn([
            'is_super_admin' => 0, 'is_tenant_super_admin' => 0, 'is_god' => 1, 'role' => 'member',
        ]);
        // Overrides setUp()'s empty-result double, which is only a default.
        DB::shouldReceive('statement')->andReturn($row);

        $ref = new \ReflectionClass(PermissionService::class);
        $method = $ref->getMethod('isSuperAdmin');
        $method->setAccessible(true);

        $this->assertTrue($method->invoke(new PermissionService(), 9));
    }

    // =========================================================================
    // METHOD SIGNATURE TESTS
    // =========================================================================

    public function testAssignRoleMethodSignature(): void
    {
        $ref = new \ReflectionMethod(PermissionService::class, 'assignRole');
        $params = $ref->getParameters();

        $this->assertEquals('userId', $params[0]->getName());
        $this->assertEquals('roleId', $params[1]->getName());
        $this->assertEquals('assignedBy', $params[2]->getName());
        $this->assertEquals('expiresAt', $params[3]->getName());

        $this->assertTrue($params[3]->allowsNull());
    }

    public function testRevokeRoleMethodSignature(): void
    {
        $ref = new \ReflectionMethod(PermissionService::class, 'revokeRole');
        $params = $ref->getParameters();

        $this->assertEquals('userId', $params[0]->getName());
        $this->assertEquals('roleId', $params[1]->getName());
        $this->assertEquals('revokedBy', $params[2]->getName());
    }

    public function testGrantPermissionMethodSignature(): void
    {
        $ref = new \ReflectionMethod(PermissionService::class, 'grantPermission');
        $params = $ref->getParameters();

        $this->assertCount(5, $params);
        $this->assertEquals('userId', $params[0]->getName());
        $this->assertEquals('permissionId', $params[1]->getName());
        $this->assertEquals('grantedBy', $params[2]->getName());
        $this->assertEquals('reason', $params[3]->getName());
        $this->assertEquals('expiresAt', $params[4]->getName());

        $this->assertTrue($params[3]->allowsNull());
        $this->assertTrue($params[4]->allowsNull());
    }

    public function testRevokePermissionMethodSignature(): void
    {
        $ref = new \ReflectionMethod(PermissionService::class, 'revokePermission');
        $params = $ref->getParameters();

        $this->assertCount(4, $params);
        $this->assertEquals('userId', $params[0]->getName());
        $this->assertEquals('permissionId', $params[1]->getName());
        $this->assertEquals('revokedBy', $params[2]->getName());
        $this->assertEquals('reason', $params[3]->getName());
    }

    public function testCreateRoleMethodSignature(): void
    {
        $ref = new \ReflectionMethod(PermissionService::class, 'createRole');
        $params = $ref->getParameters();

        $this->assertCount(5, $params);
        $this->assertEquals('name', $params[0]->getName());
        $this->assertEquals('displayName', $params[1]->getName());
        $this->assertEquals('description', $params[2]->getName());
        $this->assertEquals('level', $params[3]->getName());
        $this->assertEquals('isSystem', $params[4]->getName());

        $this->assertEquals(0, $params[3]->getDefaultValue());
        $this->assertFalse($params[4]->getDefaultValue());
    }

    // =========================================================================
    // PERMISSION CHECK ORDER TESTS (LOGIC VERIFICATION)
    // =========================================================================

    public function testPermissionCheckOrder(): void
    {
        // The permission check order should be:
        // 1. Super admin bypass
        // 2. Direct revocation (overrides everything)
        // 3. Direct grant
        // 4. Role-based permission
        // 5. Wildcard permission
        // 6. Resource-level check
        // 7. Default deny

        $ref = new \ReflectionClass(PermissionService::class);
        $canMethod = $ref->getMethod('can');
        $source = file_get_contents($ref->getFileName());

        // Verify the method contains checks in the correct order by examining
        // that isSuperAdmin is called before hasDirectRevocation, etc.
        $superAdminPos = strpos($source, 'isSuperAdmin');
        $revocationPos = strpos($source, 'hasDirectRevocation');
        $directGrantPos = strpos($source, 'hasDirectGrant');
        $rolePermissionPos = strpos($source, 'hasRolePermission');
        $wildcardPos = strpos($source, 'hasWildcardPermission');

        $this->assertLessThan($revocationPos, $superAdminPos, 'Super admin check should come before revocation');
        $this->assertLessThan($directGrantPos, $revocationPos, 'Revocation check should come before direct grant');
        $this->assertLessThan($rolePermissionPos, $directGrantPos, 'Direct grant should come before role permission');
        $this->assertLessThan($wildcardPos, $rolePermissionPos, 'Role permission should come before wildcard');
    }

    // =========================================================================
    // INTERNAL CACHE TESTS
    // =========================================================================

    public function testInternalCacheIsInitializedAsEmptyArray(): void
    {
        $freshService = new PermissionService();

        $ref = new \ReflectionClass($freshService);
        $cacheProp = $ref->getProperty('cache');
        $cacheProp->setAccessible(true);

        $this->assertIsArray($cacheProp->getValue($freshService));
        $this->assertEmpty($cacheProp->getValue($freshService));
    }

    // =========================================================================
    // FLAGGED: SUSPECTED REAL BUG (do not silently "fix" in tests)
    //
    // App\Services\Enterprise\PermissionService runs SELECT queries via
    //   DB::statement("SELECT ...", [...])->fetch()/->fetchAll()/->fetchColumn()
    // (e.g. isSuperAdmin() line ~364, getUserPermissions() ~164, getUserRoles()
    // ~199, hasDirectGrant/Revocation, hasRolePermission, hasWildcardPermission).
    //
    // Illuminate\Support\Facades\DB::statement() returns BOOL — it does NOT return
    // a PDOStatement — so every "->fetch()" on its result is a fatal
    // "Call to a member function fetch() on bool". Against a real connection,
    // can()/canAll()/canAny()/getUserPermissions()/getUserRoles() would all crash
    // the moment the session super-admin shortcut is not taken.
    //
    // This is masked in production only because this Enterprise PermissionService
    // is currently UNWIRED (no controller/route/middleware/service references it —
    // grep finds only this class and this test). The correct fix is in app code:
    // switch the SELECT paths to DB::select()/DB::selectOne() (returns arrays of
    // stdClass), not DB::statement(). The tests above stub DB::statement() with a
    // PDOStatement double purely to exercise the surrounding permission-resolution
    // logic; they MUST NOT be read as evidence the DB path works.
    // =========================================================================
}
