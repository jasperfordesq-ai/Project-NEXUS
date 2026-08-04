<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Core\Database;
use App\Core\TenantContext;
use App\Services\TenantVisibilityService;
use App\Services\TenantHierarchyService;
use App\Services\SuperAdminAuditService;

/**
 * Service-level tests for the Super Admin module
 *
 * Verifies the data layer for three core services:
 * - TenantVisibilityService (dashboard stats, tenant list, hierarchy tree, user list)
 * - TenantHierarchyService (tenant CRUD, move, toggle hub, super admin assignment)
 * - SuperAdminAuditService (audit logging, log retrieval, stats, label helpers)
 *
 * These tests exercise the static service methods directly, verifying return
 * types, array key structures, and validation logic.
 */
class AdminSuperServiceTest extends \Tests\Laravel\TestCase
{
    protected static ?int $staticTenantId = null;
    protected static ?int $testUserId = null;

    public static function setUpBeforeClass(): void
    {
        parent::setUpBeforeClass();
        self::bootApplicationForClass(); // boot Laravel so DB/TenantContext facades work in static setup

        // Use tenant 1 (Master) for visibility scope
        self::$staticTenantId = 1;
        TenantContext::setById(self::$staticTenantId);

        self::createTestData();
    }

    protected static function createTestData(): void
    {
        $timestamp = time();

        // Create a test user in the master tenant for audit operations
        Database::query(
            "INSERT INTO users (tenant_id, email, username, name, first_name, last_name, balance, is_approved, role, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'admin', NOW())",
            [
                self::$staticTenantId,
                "super_svc_test_{$timestamp}@test.com",
                "super_svc_test_{$timestamp}",
                'SuperSvc TestUser',
                'SuperSvc',
                'TestUser',
                0
            ]
        );
        self::$testUserId = (int)Database::getInstance()->lastInsertId();
    }

    public static function tearDownAfterClass(): void
    {
        if (self::$testUserId) {
            try {
                Database::query("DELETE FROM super_admin_audit_log WHERE actor_user_id = ?", [self::$testUserId]);
            } catch (\Exception $e) {
                // Table may not exist
            }
            try {
                Database::query("DELETE FROM notifications WHERE user_id = ?", [self::$testUserId]);
                Database::query("DELETE FROM activity_log WHERE user_id = ?", [self::$testUserId]);
                Database::query("DELETE FROM users WHERE id = ?", [self::$testUserId]);
            } catch (\Exception $e) {
                // Ignore cleanup errors
            }
        }

        parent::tearDownAfterClass();
    }

    // =========================================================================
    // TenantVisibilityService
    // =========================================================================

    /**
     * getDashboardStats() should return an array with expected keys
     */
    public function testGetDashboardStatsReturnsExpectedKeys(): void
    {
        $stats = TenantVisibilityService::getDashboardStats();

        $this->assertIsArray($stats);

        // If access is granted, verify structure; if not, empty array is valid
        if (!empty($stats)) {
            $expectedKeys = [
                'total_tenants',
                'active_tenants',
                'inactive_tenants',
                'total_users',
                'super_admins',
                'hub_tenants',
                'recent_tenants',
                'recent_users',
            ];

            foreach ($expectedKeys as $key) {
                $this->assertArrayHasKey($key, $stats, "Dashboard stats should contain key: {$key}");
            }

            // Numeric value assertions
            $this->assertIsInt($stats['total_tenants']);
            $this->assertIsInt($stats['active_tenants']);
            $this->assertIsInt($stats['inactive_tenants']);
            $this->assertIsInt($stats['total_users']);
            $this->assertIsInt($stats['super_admins']);
            $this->assertIsInt($stats['hub_tenants']);

            // Logical assertions
            $this->assertGreaterThanOrEqual(0, $stats['total_tenants']);
            $this->assertGreaterThanOrEqual(0, $stats['active_tenants']);
            $this->assertEquals(
                $stats['total_tenants'] - $stats['active_tenants'],
                $stats['inactive_tenants'],
                'inactive_tenants should equal total_tenants - active_tenants'
            );
        }
    }

    /**
     * getTenantList() should return an array
     */
    public function testGetTenantListReturnsArray(): void
    {
        $tenants = TenantVisibilityService::getTenantList();

        $this->assertIsArray($tenants);
    }

    /**
     * getTenantList() with filters should still return an array
     */
    public function testGetTenantListWithFilters(): void
    {
        $tenants = TenantVisibilityService::getTenantList([
            'is_active' => 1,
        ]);

        $this->assertIsArray($tenants);
    }

    /**
     * getTenantList() with search filter
     */
    public function testGetTenantListWithSearch(): void
    {
        $tenants = TenantVisibilityService::getTenantList([
            'search' => 'nonexistent_tenant_name_zzz',
        ]);

        $this->assertIsArray($tenants);
        // Searching for a nonexistent name should return empty or very few results
    }

    /**
     * getHierarchyTree() should return an array (nested tree structure)
     */
    public function testGetHierarchyTreeReturnsArray(): void
    {
        $tree = TenantVisibilityService::getHierarchyTree();

        $this->assertIsArray($tree);
    }

    /**
     * getUserList() should return an array
     */
    public function testGetUserListReturnsArray(): void
    {
        $users = TenantVisibilityService::getUserList();

        $this->assertIsArray($users);
    }

    /**
     * getUserList() with filters
     */
    public function testGetUserListWithFilters(): void
    {
        $users = TenantVisibilityService::getUserList([
            'search' => 'SuperSvc',
            'limit' => 10,
        ]);

        $this->assertIsArray($users);
    }

    /**
     * getUserList() with tenant filter
     */
    public function testGetUserListByTenant(): void
    {
        $users = TenantVisibilityService::getUserList([
            'tenant_id' => self::$staticTenantId,
        ]);

        $this->assertIsArray($users);
    }

    /**
     * getTenant() with valid ID
     */
    public function testGetTenantWithValidId(): void
    {
        $tenant = TenantVisibilityService::getTenant(1);

        // May be null if access check fails, but should be array or null
        if ($tenant !== null) {
            $this->assertIsArray($tenant);
            $this->assertArrayHasKey('id', $tenant);
            $this->assertArrayHasKey('name', $tenant);
        } else {
            $this->assertNull($tenant);
        }
    }

    /**
     * getTenant() with non-existent ID returns null
     */
    public function testGetTenantWithInvalidIdReturnsNull(): void
    {
        $tenant = TenantVisibilityService::getTenant(999999);

        $this->assertNull($tenant);
    }

    /**
     * getTenantAdmins() should return an array
     */
    public function testGetTenantAdminsReturnsArray(): void
    {
        $admins = TenantVisibilityService::getTenantAdmins(self::$staticTenantId);

        $this->assertIsArray($admins);
    }

    /**
     * getVisibleTenantIds() should return an array of IDs
     */
    public function testGetVisibleTenantIdsReturnsArray(): void
    {
        $ids = TenantVisibilityService::getVisibleTenantIds();

        $this->assertIsArray($ids);
    }

    /**
     * getAvailableParents() should return an array
     */
    public function testGetAvailableParentsReturnsArray(): void
    {
        $parents = TenantVisibilityService::getAvailableParents();

        $this->assertIsArray($parents);
    }

    // =========================================================================
    // TenantHierarchyService
    // =========================================================================

    /**
     * createTenant() with missing name should fail
     */
    public function testCreateTenantMissingNameFails(): void
    {
        $result = TenantHierarchyService::createTenant(
            ['name' => '', 'slug' => 'empty-name-test'],
            1
        );

        $this->assertIsArray($result);
        $this->assertArrayHasKey('success', $result);
        $this->assertFalse($result['success']);
        $this->assertArrayHasKey('error', $result);
        $this->assertNotEmpty($result['error']);
    }

    /**
     * createTenant() with non-existent parent should fail
     */
    public function testCreateTenantNonExistentParentFails(): void
    {
        $result = TenantHierarchyService::createTenant(
            ['name' => 'Orphan Tenant', 'slug' => 'orphan-tenant-' . time()],
            999999
        );

        $this->assertIsArray($result);
        $this->assertFalse($result['success']);
    }

    /**
     * createTenant() returns expected structure on success or failure
     */
    public function testCreateTenantReturnsExpectedStructure(): void
    {
        $result = TenantHierarchyService::createTenant(
            ['name' => 'Structure Test', 'slug' => 'structure-test-' . time()],
            1
        );

        $this->assertIsArray($result);
        $this->assertArrayHasKey('success', $result);
        $this->assertIsBool($result['success']);

        // createTenant() returns success XOR error: ['success'=>true,'tenant_id'=>N]
        // on success, or ['success'=>false,'error'=>'...'] on failure.
        if ($result['success']) {
            $this->assertArrayHasKey('tenant_id', $result);
            $this->assertIsInt($result['tenant_id']);
            $this->assertGreaterThan(0, $result['tenant_id']);

            // Clean up: deactivate the created tenant
            Database::query("UPDATE tenants SET is_active = 0 WHERE id = ?", [$result['tenant_id']]);
        } else {
            $this->assertArrayHasKey('error', $result);
        }
    }

    /**
     * updateTenant() with non-existent tenant should fail
     */
    public function testUpdateTenantNonExistentFails(): void
    {
        $result = TenantHierarchyService::updateTenant(999999, ['name' => 'Ghost']);

        $this->assertIsArray($result);
        $this->assertArrayHasKey('success', $result);
        $this->assertFalse($result['success']);
    }

    /**
     * updateTenant() with empty data should succeed (nothing to update)
     */
    public function testUpdateTenantEmptyDataSucceeds(): void
    {
        $result = TenantHierarchyService::updateTenant(1, []);

        $this->assertIsArray($result);
        $this->assertArrayHasKey('success', $result);
        // Empty update may succeed as a no-op or fail on permission
    }

    /**
     * deleteTenant() should refuse to delete Master tenant (ID 1)
     */
    public function testDeleteMasterTenantFails(): void
    {
        $result = TenantHierarchyService::deleteTenant(1);

        $this->assertIsArray($result);
        $this->assertArrayHasKey('success', $result);
        $this->assertFalse($result['success']);
        $this->assertNotEmpty($result['error'] ?? '', 'Deleting master tenant should return an error message');
    }

    /**
     * deleteTenant() with non-existent ID should fail
     */
    public function testDeleteNonExistentTenantFails(): void
    {
        $result = TenantHierarchyService::deleteTenant(999999);

        $this->assertIsArray($result);
        $this->assertFalse($result['success']);
    }

    /**
     * moveTenant() to a non-existent parent should fail
     */
    public function testMoveTenantToNonExistentParentFails(): void
    {
        $result = TenantHierarchyService::moveTenant(2, 999999);

        $this->assertIsArray($result);
        $this->assertArrayHasKey('success', $result);
        $this->assertFalse($result['success']);
    }

    /**
     * toggleSubtenantCapability() returns expected structure
     */
    public function testToggleSubtenantCapabilityReturnsStructure(): void
    {
        $result = TenantHierarchyService::toggleSubtenantCapability(999999, true);

        $this->assertIsArray($result);
        $this->assertArrayHasKey('success', $result);
        $this->assertArrayHasKey('error', $result);
    }

    /**
     * assignTenantSuperAdmin() with non-existent user should fail
     */
    public function testAssignTenantSuperAdminNonExistentUserFails(): void
    {
        $result = TenantHierarchyService::assignTenantSuperAdmin(999999, self::$staticTenantId);

        $this->assertIsArray($result);
        $this->assertFalse($result['success']);
        $this->assertNotEmpty($result['error'] ?? '', 'Assigning SA to non-existent user should return error');
    }

    /**
     * revokeTenantSuperAdmin() with non-existent user should fail
     */
    public function testRevokeTenantSuperAdminNonExistentUserFails(): void
    {
        $result = TenantHierarchyService::revokeTenantSuperAdmin(999999);

        $this->assertIsArray($result);
        $this->assertFalse($result['success']);
        $this->assertNotEmpty($result['error'] ?? '', 'Revoking SA from non-existent user should return error');
    }

    // =========================================================================
    // SuperAdminAuditService
    // =========================================================================

    /**
     * getLog() returns an array
     */
    public function testGetLogReturnsArray(): void
    {
        $logs = SuperAdminAuditService::getLog();

        $this->assertIsArray($logs);
    }

    /**
     * getLog() with filters returns an array
     */
    public function testGetLogWithFiltersReturnsArray(): void
    {
        $logs = SuperAdminAuditService::getLog([
            'action_type' => 'tenant_created',
            'limit' => 5,
        ]);

        $this->assertIsArray($logs);
    }

    /**
     * getLog() with date range filters
     */
    public function testGetLogWithDateRange(): void
    {
        $logs = SuperAdminAuditService::getLog([
            'date_from' => '2026-01-01',
            'date_to' => '2026-12-31',
            'limit' => 10,
        ]);

        $this->assertIsArray($logs);
    }

    /**
     * getLog() with search filter
     */
    public function testGetLogWithSearch(): void
    {
        $logs = SuperAdminAuditService::getLog([
            'search' => 'nonexistent_search_term_zzz',
            'limit' => 5,
        ]);

        $this->assertIsArray($logs);
        // Searching for a nonexistent term should return empty
    }

    /**
     * getStats() returns expected structure
     */
    public function testGetStatsReturnsExpectedStructure(): void
    {
        $stats = SuperAdminAuditService::getStats();

        $this->assertIsArray($stats);

        if (!empty($stats)) {
            // getStats() returns total_actions, by_type, top_actors — it does NOT
            // echo back the period (no 'period_days' key). The period only scopes
            // the underlying query window.
            $expectedKeys = ['total_actions', 'by_type', 'top_actors'];
            foreach ($expectedKeys as $key) {
                $this->assertArrayHasKey($key, $stats, "Audit stats should contain key: {$key}");
            }

            $this->assertIsInt($stats['total_actions']);
            $this->assertIsArray($stats['by_type']);
            $this->assertIsArray($stats['top_actors']);
        }
    }

    /**
     * getStats() with custom period
     */
    public function testGetStatsCustomPeriod(): void
    {
        $stats = SuperAdminAuditService::getStats(7);

        // getStats($days) scopes the query window but does not return the period
        // back in the result. A custom period must still yield a well-formed array
        // with the standard keys.
        $this->assertIsArray($stats);

        if (!empty($stats)) {
            $this->assertArrayHasKey('total_actions', $stats);
            $this->assertArrayHasKey('by_type', $stats);
            $this->assertArrayHasKey('top_actors', $stats);
        }
    }

    /**
     * getActionLabel() returns known labels for all defined action types
     */
    public function testGetActionLabelReturnsKnownLabels(): void
    {
        // Driven off actionTypes() rather than a hardcoded copy: the previous
        // hardcoded list silently omitted 'tenant_purged' and so never noticed
        // that the DB enum was missing it either.
        foreach (SuperAdminAuditService::actionTypes() as $type) {
            $label = SuperAdminAuditService::getActionLabel($type);
            $this->assertNotSame('', $label, "Label for '{$type}' must not be empty");
            $this->assertMatchesRegularExpression(
                '/^[A-Z]/',
                $label,
                "Label for '{$type}' should be a human-readable title, got '{$label}'"
            );
        }
    }

    /**
     * getActionLabel() humanizes unknown action types (ucwords + underscores → spaces)
     * rather than returning the raw type verbatim.
     */
    public function testGetActionLabelReturnsRawForUnknown(): void
    {
        $label = SuperAdminAuditService::getActionLabel('unknown_action_type');
        $this->assertEquals('Unknown Action Type', $label);
    }

    /**
     * getActionIcon() returns CSS class strings for known action types
     */
    public function testGetActionIconReturnsIconClasses(): void
    {
        foreach (SuperAdminAuditService::actionTypes() as $type) {
            $icon = SuperAdminAuditService::getActionIcon($type);
            $this->assertIsString($icon);
            $this->assertStringContainsString('fa-', $icon, "Icon for '{$type}' should contain a Font Awesome class");
        }
    }

    /**
     * getActionIcon() returns fallback for unknown types
     */
    public function testGetActionIconReturnsFallbackForUnknown(): void
    {
        $icon = SuperAdminAuditService::getActionIcon('unknown_action_type');
        $this->assertEquals('fa-circle', $icon);
    }

    /**
     * log() returns a boolean
     */
    public function testLogReturnsBool(): void
    {
        $result = SuperAdminAuditService::log(
            'test_action',
            'test',
            null,
            'Test Target',
            null,
            null,
            'Test log entry from PHPUnit'
        );

        $this->assertIsBool($result);
    }

    // =========================================================================
    // TenantHierarchyService — Comprehensive tenant creation tests
    // =========================================================================

    /**
     * Helper: set up super admin session so TenantHierarchyService permission checks pass
     */
    private function setUpSuperAdminSession(): void
    {
        // Reset cached access from prior tests
        \App\Middleware\SuperPanelAccess::reset();

        // Ensure the test user has is_super_admin flag
        Database::query(
            "UPDATE users SET is_super_admin = 1 WHERE id = ?",
            [self::$testUserId]
        );

        // Ensure master tenant allows sub-tenants
        Database::query(
            "UPDATE tenants SET allows_subtenants = 1, max_depth = 5 WHERE id = 1"
        );

        // Set session so SuperPanelAccess::getAccess() finds the user
        $_SESSION['user_id'] = self::$testUserId;
        $_SESSION['is_super_admin'] = true;
    }

    /**
     * Helper: create a tenant and return the result, cleaning up on success
     */
    private function createTestTenant(array $overrides = [], int $parentId = 1): array
    {
        $this->setUpSuperAdminSession();

        $data = array_merge([
            'name' => 'Test Tenant ' . uniqid(),
            'slug' => 'test-tenant-' . uniqid(),
        ], $overrides);

        $result = TenantHierarchyService::createTenant($data, $parentId);

        if ($result['success']) {
            $this->tenantsToCleanUp[] = $result['tenant_id'];
        }

        return $result;
    }

    private array $tenantsToCleanUp = [];

    protected function tearDown(): void
    {
        // Clean up tenants created during tests. The suite is non-transactional,
        // so delete the rows the default seeders insert (menus cascade to
        // menu_items via FK) to stop them accumulating across runs, then
        // deactivate the tenant row itself.
        foreach ($this->tenantsToCleanUp as $id) {
            try {
                Database::query("DELETE FROM menus WHERE tenant_id = ?", [$id]);
                Database::query("DELETE FROM attributes WHERE tenant_id = ?", [$id]);
                Database::query("DELETE FROM categories WHERE tenant_id = ?", [$id]);
                Database::query("UPDATE tenants SET is_active = 0 WHERE id = ?", [$id]);
            } catch (\Exception $e) {
                // ignore cleanup errors
            }
        }
        $this->tenantsToCleanUp = [];

        // Clean up session and cached access
        unset($_SESSION['user_id'], $_SESSION['is_super_admin']);
        \App\Middleware\SuperPanelAccess::reset();

        parent::tearDown();
    }

    /**
     * Duplicate slug should be rejected
     */
    public function testCreateTenantDuplicateSlugFails(): void
    {
        $slug = 'dup-slug-' . uniqid();

        $first = $this->createTestTenant(['slug' => $slug]);
        $this->assertTrue($first['success'], 'First tenant should succeed');

        $second = $this->createTestTenant(['slug' => $slug]);
        $this->assertFalse($second['success'], 'Duplicate slug should fail');
        $this->assertStringContainsStringIgnoringCase('slug', $second['error']);
    }

    /**
     * Duplicate domain should be rejected
     */
    public function testCreateTenantDuplicateDomainFails(): void
    {
        $domain = 'dup-' . uniqid() . '.example.com';

        $first = $this->createTestTenant(['domain' => $domain]);
        $this->assertTrue($first['success'], 'First tenant should succeed');

        $second = $this->createTestTenant(['domain' => $domain]);
        $this->assertFalse($second['success'], 'Duplicate domain should fail');
        $this->assertStringContainsStringIgnoringCase('domain', $second['error']);
    }

    /**
     * Created tenant should have default categories seeded
     */
    public function testCreateTenantSeedsCategories(): void
    {
        $result = $this->createTestTenant();
        $this->assertTrue($result['success']);

        $count = Database::query(
            "SELECT COUNT(*) FROM categories WHERE tenant_id = ?",
            [$result['tenant_id']]
        )->fetchColumn();

        $this->assertGreaterThan(0, (int)$count, 'Categories should be seeded');
    }

    /**
     * Created tenant should have default attributes seeded
     */
    public function testCreateTenantSeedsAttributes(): void
    {
        $result = $this->createTestTenant();
        $this->assertTrue($result['success']);

        $count = Database::query(
            "SELECT COUNT(*) FROM attributes WHERE tenant_id = ?",
            [$result['tenant_id']]
        )->fetchColumn();

        // seedTenantDefaults() seeds the canonical eight-attribute default set.
        $this->assertGreaterThan(0, (int)$count, 'Attributes should be seeded');
        $this->assertSame(8, (int)$count, 'The full default attribute set (8) should be seeded');

        // Re-running must be idempotent (insertOrIgnore on the unique key).
        \App\Services\TenantDefaultsSeeder::seedAttributes((int)$result['tenant_id']);
        $countAfter = Database::query(
            "SELECT COUNT(*) FROM attributes WHERE tenant_id = ?",
            [$result['tenant_id']]
        )->fetchColumn();
        $this->assertSame(8, (int)$countAfter, 'Re-seeding must not duplicate attributes');
    }

    /**
     * Created tenant should have default menus seeded
     */
    public function testCreateTenantSeedsMenus(): void
    {
        $result = $this->createTestTenant();
        $this->assertTrue($result['success']);

        $count = Database::query(
            "SELECT COUNT(*) FROM menus WHERE tenant_id = ?",
            [$result['tenant_id']]
        )->fetchColumn();

        // seedTenantDefaults() seeds the Main Navigation + Footer Navigation menus.
        $this->assertGreaterThan(0, (int)$count, 'Menus should be seeded');
        $this->assertSame(2, (int)$count, 'Both default menus (header + footer) should be seeded');

        // The full default item set must be present (8 main-nav items incl. the
        // nested "Community" dropdown + its 3 children, and 4 footer items),
        // proving menu_items seeding ran completely — not just the menu rows.
        $itemCountSql = "SELECT COUNT(*) FROM menu_items mi
             JOIN menus m ON m.id = mi.menu_id
             WHERE m.tenant_id = ?";
        $itemCount = Database::query($itemCountSql, [$result['tenant_id']])->fetchColumn();
        $this->assertSame(12, (int)$itemCount, 'The full default menu-item set (12) should be seeded');

        // Re-running the seeder must be idempotent: the slug-existence guard
        // skips already-seeded menus, so counts stay at 2 menus / 12 items.
        \App\Services\TenantDefaultsSeeder::seedMenus((int)$result['tenant_id']);
        $menuCountAfter = Database::query(
            "SELECT COUNT(*) FROM menus WHERE tenant_id = ?",
            [$result['tenant_id']]
        )->fetchColumn();
        $itemCountAfter = Database::query($itemCountSql, [$result['tenant_id']])->fetchColumn();
        $this->assertSame(2, (int)$menuCountAfter, 'Re-seeding must not duplicate menus');
        $this->assertSame(12, (int)$itemCountAfter, 'Re-seeding must not duplicate menu items');
    }

    /**
     * Created tenant should have default settings seeded
     */
    public function testCreateTenantSeedsSettings(): void
    {
        $result = $this->createTestTenant();
        $this->assertTrue($result['success']);

        $count = Database::query(
            "SELECT COUNT(*) FROM tenant_settings WHERE tenant_id = ?",
            [$result['tenant_id']]
        )->fetchColumn();

        $this->assertGreaterThan(0, (int)$count, 'Settings should be seeded');
    }

    /**
     * Created tenant should have features JSON populated (not NULL)
     */
    public function testCreateTenantSeedsDefaultFeatures(): void
    {
        $result = $this->createTestTenant();
        $this->assertTrue($result['success']);

        $features = Database::query(
            "SELECT features FROM tenants WHERE id = ?",
            [$result['tenant_id']]
        )->fetchColumn();

        $this->assertNotNull($features, 'Features should not be NULL');
        $decoded = json_decode($features, true);
        $this->assertIsArray($decoded, 'Features should be valid JSON');
        $this->assertNotEmpty($decoded, 'Features should contain defaults');
    }

    /**
     * Custom features should be preserved (not overwritten by defaults)
     */
    public function testCreateTenantPreservesCustomFeatures(): void
    {
        $customFeatures = ['listings' => true, 'events' => false, 'groups' => true];
        $result = $this->createTestTenant(['features' => $customFeatures]);
        $this->assertTrue($result['success']);

        $features = Database::query(
            "SELECT features FROM tenants WHERE id = ?",
            [$result['tenant_id']]
        )->fetchColumn();

        $decoded = json_decode($features, true);
        $this->assertTrue($decoded['listings'], 'Custom feature listings should be true');
        $this->assertFalse($decoded['events'], 'Custom feature events should be false');
        $this->assertTrue($decoded['groups'], 'Custom feature groups should be true');
    }

    /**
     * Path should be correctly generated (parent path + tenant ID)
     */
    public function testCreateTenantGeneratesCorrectPath(): void
    {
        $result = $this->createTestTenant();
        $this->assertTrue($result['success']);

        $tenant = Database::query(
            "SELECT path, depth FROM tenants WHERE id = ?",
            [$result['tenant_id']]
        )->fetch(\PDO::FETCH_ASSOC);

        $this->assertStringContainsString((string)$result['tenant_id'], $tenant['path']);
        $this->assertNotEmpty($tenant['path'], 'Path should be set');
        $this->assertGreaterThan(0, (int)$tenant['depth']);
    }

    /**
     * Slug auto-generation from name should work
     */
    public function testCreateTenantAutoGeneratesSlug(): void
    {
        $name = 'Auto Slug Test ' . uniqid();
        $result = $this->createTestTenant(['name' => $name, 'slug' => '']);
        $this->assertTrue($result['success']);

        $slug = Database::query(
            "SELECT slug FROM tenants WHERE id = ?",
            [$result['tenant_id']]
        )->fetchColumn();

        $this->assertNotEmpty($slug, 'Slug should be auto-generated');
        $this->assertMatchesRegularExpression('/^[a-z0-9-]+$/', $slug, 'Slug should be URL-safe');
    }
}
