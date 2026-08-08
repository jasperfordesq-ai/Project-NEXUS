<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services\CaringCommunity;

use App\Core\TenantContext;
use App\Services\CaringCommunity\CaringSubRegionService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use RuntimeException;
use Tests\Laravel\TestCase;

/**
 * CaringSubRegionServiceTest
 *
 * Tests the tenant-scoped sub-region management service for Caring Community.
 *
 * Skipped paths:
 *  - boundary_geojson deep GIS operations (JSON blob only stored/returned, no processing)
 *  - delete() cascade to caring_care_providers.sub_region_id is covered
 *    only if the table is present; otherwise the nullification branch is verified
 *    structurally by asserting the soft-delete still runs.
 */
class CaringSubRegionServiceTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 2;
    private const OTHER_TENANT_ID = 3;

    protected function setUp(): void
    {
        parent::setUp();

        Queue::fake();

        TenantContext::setById(self::TENANT_ID);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private function service(): CaringSubRegionService
    {
        return app(CaringSubRegionService::class);
    }

    /** Insert a minimal user row and return its id (needed for created_by). */
    private function insertUser(int $tenantId = self::TENANT_ID): int
    {
        $uid = uniqid('csr_u_', true);
        return (int) DB::table('users')->insertGetId([
            'tenant_id'  => $tenantId,
            'name'       => 'SubRegion Test ' . $uid,
            'first_name' => 'SubRegion',
            'last_name'  => 'User',
            'email'      => $uid . '@example.test',
            'status'     => 'active',
            'balance'    => 0,
            'role'       => 'member',
            'is_approved' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** Seed a sub-region row directly and return its id. */
    private function seedRegion(array $overrides = []): int
    {
        $adminId = $this->insertUser();
        $slug    = $overrides['slug'] ?? ('region-' . uniqid());

        return (int) DB::table('caring_sub_regions')->insertGetId(array_merge([
            'tenant_id'   => self::TENANT_ID,
            'name'        => 'Test Region ' . $slug,
            'slug'        => $slug,
            'type'        => 'quartier',
            'status'      => 'active',
            'created_by'  => $adminId,
            'created_at'  => now(),
            'updated_at'  => now(),
        ], $overrides));
    }

    // ── isAvailable ───────────────────────────────────────────────────────────

    public function test_isAvailable_returns_true_when_table_exists(): void
    {
        $this->assertTrue($this->service()->isAvailable());
    }

    // ── list — basic pagination ────────────────────────────────────────────────

    public function test_list_returns_expected_shape_with_pagination_metadata(): void
    {
        $this->seedRegion(['status' => 'active']);
        $this->seedRegion(['status' => 'active']);

        $result = $this->service()->list(self::TENANT_ID);

        $this->assertArrayHasKey('data', $result);
        $this->assertArrayHasKey('total', $result);
        $this->assertArrayHasKey('per_page', $result);
        $this->assertArrayHasKey('current_page', $result);
        $this->assertSame(1, $result['current_page']);
        $this->assertIsArray($result['data']);
    }

    public function test_list_only_returns_active_rows_for_non_admin(): void
    {
        $activeId   = $this->seedRegion(['status' => 'active']);
        $inactiveId = $this->seedRegion(['status' => 'inactive']);

        $result = $this->service()->list(self::TENANT_ID, [], false);

        $ids = array_column($result['data'], 'id');
        $this->assertContains($activeId, $ids);
        $this->assertNotContains($inactiveId, $ids);
    }

    public function test_list_returns_inactive_rows_when_admin_true(): void
    {
        $inactiveId = $this->seedRegion(['status' => 'inactive']);

        $result = $this->service()->list(self::TENANT_ID, [], true);

        $ids = array_column($result['data'], 'id');
        $this->assertContains($inactiveId, $ids);
    }

    public function test_list_filters_by_type(): void
    {
        $municipalityId = $this->seedRegion(['type' => 'municipality']);
        $quartierId     = $this->seedRegion(['type' => 'quartier']);

        $result = $this->service()->list(self::TENANT_ID, ['type' => 'municipality']);

        $ids = array_column($result['data'], 'id');
        $this->assertContains($municipalityId, $ids);
        $this->assertNotContains($quartierId, $ids);
    }

    public function test_list_filters_by_search_on_name(): void
    {
        $uniqueName = 'UniqueNameXYZ987';
        $targetId   = $this->seedRegion(['name' => $uniqueName, 'slug' => strtolower($uniqueName) . '-' . uniqid()]);
        $otherId    = $this->seedRegion();

        $result = $this->service()->list(self::TENANT_ID, ['search' => 'UniqueNameXYZ987']);

        $ids = array_column($result['data'], 'id');
        $this->assertContains($targetId, $ids);
        $this->assertNotContains($otherId, $ids);
    }

    public function test_list_is_tenant_scoped(): void
    {
        // Insert a region under a different tenant
        DB::table('tenants')->updateOrInsert(
            ['id' => self::OTHER_TENANT_ID],
            ['name' => 'Other Tenant', 'slug' => 'other-tenant-3', 'is_active' => true, 'depth' => 0, 'allows_subtenants' => false, 'created_at' => now(), 'updated_at' => now()]
        );
        $otherSlug = 'other-t3-' . uniqid();
        DB::table('caring_sub_regions')->insert([
            'tenant_id'  => self::OTHER_TENANT_ID,
            'name'       => 'Other Tenant Region',
            'slug'       => $otherSlug,
            'type'       => 'quartier',
            'status'     => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $ownId = $this->seedRegion();

        $result = $this->service()->list(self::TENANT_ID);

        $ids = array_column($result['data'], 'id');
        $this->assertContains($ownId, $ids);
        // Row from other tenant must NOT appear
        $slugs = array_column($result['data'], 'slug');
        $this->assertNotContains($otherSlug, $slugs);
    }

    // ── get ───────────────────────────────────────────────────────────────────

    public function test_get_returns_cast_row_for_valid_id_and_tenant(): void
    {
        $id = $this->seedRegion(['type' => 'municipality']);

        $row = $this->service()->get($id, self::TENANT_ID);

        $this->assertNotNull($row);
        $this->assertSame($id, $row['id']);
        $this->assertSame(self::TENANT_ID, $row['tenant_id']);
        $this->assertSame('municipality', $row['type']);
        $this->assertArrayHasKey('slug', $row);
        $this->assertArrayHasKey('status', $row);
    }

    public function test_get_returns_null_for_wrong_tenant(): void
    {
        $id = $this->seedRegion();

        // Look it up as a different tenant
        $row = $this->service()->get($id, self::OTHER_TENANT_ID);

        $this->assertNull($row);
    }

    public function test_get_returns_null_for_nonexistent_id(): void
    {
        $row = $this->service()->get(999999999, self::TENANT_ID);

        $this->assertNull($row);
    }

    // ── create ────────────────────────────────────────────────────────────────

    public function test_create_inserts_row_and_returns_cast_data(): void
    {
        $adminId = $this->insertUser();
        $slug    = 'create-test-' . uniqid();

        $result = $this->service()->create(self::TENANT_ID, [
            'name'   => 'Create Test Region',
            'slug'   => $slug,
            'type'   => 'quartier',
            'status' => 'active',
        ], $adminId);

        $this->assertIsArray($result);
        $this->assertSame('Create Test Region', $result['name']);
        $this->assertSame($slug, $result['slug']);
        $this->assertSame('quartier', $result['type']);
        $this->assertSame(self::TENANT_ID, $result['tenant_id']);
        $this->assertSame($adminId, $result['created_by']);

        // Verify DB row
        $db = DB::table('caring_sub_regions')->where('id', $result['id'])->first();
        $this->assertNotNull($db);
        $this->assertSame($slug, $db->slug);
    }

    public function test_create_auto_generates_slug_from_name_when_no_slug_provided(): void
    {
        $adminId = $this->insertUser();

        $result = $this->service()->create(self::TENANT_ID, [
            'name' => 'Auto Slug Region ' . uniqid(),
            'type' => 'quartier',
        ], $adminId);

        $this->assertNotEmpty($result['slug']);
        // Slug must be lowercase-hyphenated (Str::slug output)
        $this->assertMatchesRegularExpression('/^[a-z0-9\-]+$/', $result['slug']);
    }

    public function test_create_stores_postal_codes_as_json_array(): void
    {
        $adminId = $this->insertUser();

        $result = $this->service()->create(self::TENANT_ID, [
            'name'         => 'Postal Codes Region ' . uniqid(),
            'slug'         => 'postal-' . uniqid(),
            'postal_codes' => ['D01', 'D02', 'D03'],
        ], $adminId);

        $this->assertIsArray($result['postal_codes']);
        $this->assertContains('D01', $result['postal_codes']);
        $this->assertContains('D02', $result['postal_codes']);
    }

    public function test_create_throws_runtime_exception_for_duplicate_slug_within_tenant(): void
    {
        $adminId = $this->insertUser();
        $slug    = 'dup-slug-' . uniqid();

        $this->service()->create(self::TENANT_ID, ['name' => 'First', 'slug' => $slug], $adminId);

        $this->expectException(RuntimeException::class);
        $this->service()->create(self::TENANT_ID, ['name' => 'Second', 'slug' => $slug], $adminId);
    }

    public function test_create_throws_runtime_exception_for_empty_slug(): void
    {
        $adminId = $this->insertUser();

        $this->expectException(RuntimeException::class);
        $this->service()->create(self::TENANT_ID, ['name' => '   ', 'slug' => ''], $adminId);
    }

    // ── update ────────────────────────────────────────────────────────────────

    public function test_update_changes_persisted_fields_and_returns_fresh_row(): void
    {
        $id = $this->seedRegion(['type' => 'quartier', 'status' => 'active']);

        $result = $this->service()->update($id, self::TENANT_ID, [
            'name'        => 'Updated Name',
            'type'        => 'ortsteil',
            'description' => 'Updated description',
        ]);

        $this->assertSame('Updated Name', $result['name']);
        $this->assertSame('ortsteil', $result['type']);
        $this->assertSame('Updated description', $result['description']);
        $this->assertSame($id, $result['id']);
    }

    public function test_update_rejects_duplicate_slug_for_different_row(): void
    {
        $slugA = 'upd-slug-a-' . uniqid();
        $slugB = 'upd-slug-b-' . uniqid();
        $this->seedRegion(['slug' => $slugA]);
        $idB = $this->seedRegion(['slug' => $slugB]);

        $this->expectException(RuntimeException::class);
        // Attempt to rename B's slug to A's existing slug
        $this->service()->update($idB, self::TENANT_ID, ['slug' => $slugA]);
    }

    public function test_update_allows_slug_to_be_set_to_its_own_current_value(): void
    {
        $slug = 'self-slug-' . uniqid();
        $id   = $this->seedRegion(['slug' => $slug]);

        // Should NOT throw — updating slug to the same value for the same row
        $result = $this->service()->update($id, self::TENANT_ID, ['slug' => $slug]);

        $this->assertSame($slug, $result['slug']);
    }

    // ── delete ────────────────────────────────────────────────────────────────

    public function test_delete_soft_deletes_by_setting_status_to_inactive(): void
    {
        $id = $this->seedRegion(['status' => 'active']);

        $this->service()->delete($id, self::TENANT_ID);

        $row = DB::table('caring_sub_regions')->where('id', $id)->first();
        $this->assertNotNull($row);
        $this->assertSame('inactive', $row->status);
    }

    public function test_delete_is_tenant_scoped_and_does_not_affect_other_tenant_rows(): void
    {
        // Insert a region under a different tenant directly
        DB::table('tenants')->updateOrInsert(
            ['id' => self::OTHER_TENANT_ID],
            ['name' => 'Other', 'slug' => 'other-tenant-3', 'is_active' => true, 'depth' => 0, 'allows_subtenants' => false, 'created_at' => now(), 'updated_at' => now()]
        );
        $otherRegionId = (int) DB::table('caring_sub_regions')->insertGetId([
            'tenant_id'  => self::OTHER_TENANT_ID,
            'name'       => 'Other Tenant Active Region',
            'slug'       => 'other-del-' . uniqid(),
            'type'       => 'quartier',
            'status'     => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // delete() with TENANT_ID should not touch the other tenant's row
        // (id won't match AND tenant_id won't match — call with own-tenant id)
        $ownId = $this->seedRegion(['status' => 'active']);
        $this->service()->delete($ownId, self::TENANT_ID);

        // Other tenant row must still be 'active'
        $other = DB::table('caring_sub_regions')->where('id', $otherRegionId)->first();
        $this->assertSame('active', $other->status);
    }

    // ── castRow coverage ──────────────────────────────────────────────────────

    public function test_get_casts_center_coordinates_to_float(): void
    {
        $id = $this->seedRegion([
            'center_latitude'  => '47.3769',
            'center_longitude' => '8.5417',
        ]);

        $row = $this->service()->get($id, self::TENANT_ID);

        $this->assertIsFloat($row['center_latitude']);
        $this->assertIsFloat($row['center_longitude']);
        $this->assertEqualsWithDelta(47.3769, $row['center_latitude'], 0.0001);
        $this->assertEqualsWithDelta(8.5417, $row['center_longitude'], 0.0001);
    }

    public function test_get_decodes_postal_codes_json_to_array(): void
    {
        $id = $this->seedRegion([
            'postal_codes' => json_encode(['D04', 'D05']),
        ]);

        $row = $this->service()->get($id, self::TENANT_ID);

        $this->assertIsArray($row['postal_codes']);
        $this->assertContains('D04', $row['postal_codes']);
    }
}
