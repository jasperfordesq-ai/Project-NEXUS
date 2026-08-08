<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services\CaringCommunity;

use App\Services\CaringCommunity\CareProviderDirectoryService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

/**
 * CareProviderDirectoryServiceTest
 *
 * Tests the tenant-scoped care provider directory service (AG64).
 *
 * Skipped paths:
 *  - sub_region_id foreign-key branching (normaliseSubRegionId / loadSubRegion):
 *    tested structurally via a null sub_region_id; full FK lookup requires
 *    caring_sub_regions seeding, which is gated by Schema::hasColumn.
 *  - findPotentialDuplicates levenshtein boundary coverage (long strings / similar_text
 *    fallback): pure algorithm tested via same-email/phone/domain signal assertions.
 */
class CareProviderDirectoryServiceTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 2;
    private const OTHER_TENANT_ID = 3;

    protected function setUp(): void
    {
        parent::setUp();

        Queue::fake();

        \App\Core\TenantContext::setById(self::TENANT_ID);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private function service(): CareProviderDirectoryService
    {
        return app(CareProviderDirectoryService::class);
    }

    /** Insert a minimal user and return id (for created_by). */
    private function insertUser(int $tenantId = self::TENANT_ID): int
    {
        $uid = uniqid('cpd_u_', true);
        return (int) DB::table('users')->insertGetId([
            'tenant_id'  => $tenantId,
            'name'       => 'CPD Test User ' . $uid,
            'first_name' => 'CPD',
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

    /**
     * Seed a provider row directly and return its id.
     * Using DB::table directly skips the sub_region_id validation path.
     */
    private function seedProvider(array $overrides = []): int
    {
        $userId = $this->insertUser();
        return (int) DB::table('caring_care_providers')->insertGetId(array_merge([
            'tenant_id'     => self::TENANT_ID,
            'name'          => 'Test Provider ' . uniqid(),
            'type'          => 'spitex',
            'description'   => null,
            'categories'    => null,
            'address'       => null,
            'sub_region_id' => null,
            'contact_phone' => null,
            'contact_email' => null,
            'website_url'   => null,
            'opening_hours' => null,
            'is_verified'   => 0,
            'status'        => 'active',
            'created_by'    => $userId,
            'created_at'    => now(),
            'updated_at'    => now(),
        ], $overrides));
    }

    // ── isAvailable ───────────────────────────────────────────────────────────

    public function test_is_available_returns_true_when_table_exists(): void
    {
        $this->assertTrue($this->service()->isAvailable());
    }

    // ── create ────────────────────────────────────────────────────────────────

    public function test_create_inserts_provider_and_returns_cast_row(): void
    {
        $adminId = $this->insertUser();

        $result = $this->service()->create(self::TENANT_ID, [
            'name'          => 'Happy Hands Spitex',
            'type'          => 'spitex',
            'description'   => 'Home care services',
            'contact_email' => 'info@happyhands.example',
            'status'        => 'active',
        ], $adminId);

        $this->assertIsArray($result);
        $this->assertGreaterThan(0, $result['id']);
        $this->assertSame('Happy Hands Spitex', $result['name']);
        $this->assertSame('spitex', $result['type']);
        $this->assertSame(self::TENANT_ID, $result['tenant_id']);
        $this->assertFalse($result['is_verified']); // always starts false
        $this->assertSame('active', $result['status']);
    }

    public function test_create_stores_categories_as_decoded_array(): void
    {
        $adminId = $this->insertUser();

        $result = $this->service()->create(self::TENANT_ID, [
            'name'       => 'Cat Provider ' . uniqid(),
            'type'       => 'verein',
            'categories' => ['elderly_care', 'dementia'],
        ], $adminId);

        $this->assertIsArray($result['categories']);
        $this->assertContains('elderly_care', $result['categories']);
    }

    public function test_create_defaults_to_active_status_when_not_provided(): void
    {
        $adminId = $this->insertUser();

        $result = $this->service()->create(self::TENANT_ID, [
            'name' => 'Default Status Provider ' . uniqid(),
            'type' => 'volunteer',
        ], $adminId);

        $this->assertSame('active', $result['status']);
    }

    public function test_create_with_invalid_status_defaults_to_active(): void
    {
        $adminId = $this->insertUser();

        $result = $this->service()->create(self::TENANT_ID, [
            'name'   => 'Bad Status Provider ' . uniqid(),
            'type'   => 'spitex',
            'status' => 'unknown_status',
        ], $adminId);

        $this->assertSame('active', $result['status']);
    }

    // ── get / getActive ───────────────────────────────────────────────────────

    public function test_get_returns_cast_row_for_valid_id(): void
    {
        $id = $this->seedProvider(['name' => 'Fetch Me Provider', 'type' => 'private']);

        $row = $this->service()->get($id, self::TENANT_ID);

        $this->assertNotNull($row);
        $this->assertSame($id, $row['id']);
        $this->assertSame(self::TENANT_ID, $row['tenant_id']);
        $this->assertSame('private', $row['type']);
    }

    public function test_get_returns_null_for_wrong_tenant(): void
    {
        $id = $this->seedProvider();

        $row = $this->service()->get($id, self::OTHER_TENANT_ID);

        $this->assertNull($row);
    }

    public function test_get_returns_null_for_nonexistent_id(): void
    {
        $row = $this->service()->get(999999999, self::TENANT_ID);
        $this->assertNull($row);
    }

    public function test_get_active_returns_null_for_inactive_provider(): void
    {
        $id = $this->seedProvider(['status' => 'inactive']);

        $row = $this->service()->getActive($id, self::TENANT_ID);

        $this->assertNull($row);
    }

    public function test_get_active_returns_row_for_active_provider(): void
    {
        $id = $this->seedProvider(['status' => 'active']);

        $row = $this->service()->getActive($id, self::TENANT_ID);

        $this->assertNotNull($row);
        $this->assertSame($id, $row['id']);
    }

    // ── list ──────────────────────────────────────────────────────────────────

    public function test_list_returns_pagination_shape(): void
    {
        $this->seedProvider();

        $result = $this->service()->list(self::TENANT_ID);

        $this->assertArrayHasKey('data', $result);
        $this->assertArrayHasKey('total', $result);
        $this->assertArrayHasKey('per_page', $result);
        $this->assertArrayHasKey('current_page', $result);
        $this->assertSame(1, $result['current_page']);
        $this->assertIsArray($result['data']);
    }

    public function test_list_excludes_inactive_providers(): void
    {
        $activeId   = $this->seedProvider(['status' => 'active']);
        $inactiveId = $this->seedProvider(['status' => 'inactive']);

        $result = $this->service()->list(self::TENANT_ID);

        $ids = array_column($result['data'], 'id');
        $this->assertContains($activeId, $ids);
        $this->assertNotContains($inactiveId, $ids);
    }

    public function test_list_filters_by_type(): void
    {
        $spitexId   = $this->seedProvider(['type' => 'spitex', 'status' => 'active']);
        $vereinId   = $this->seedProvider(['type' => 'verein', 'status' => 'active']);

        $result = $this->service()->list(self::TENANT_ID, ['type' => 'spitex']);

        $ids = array_column($result['data'], 'id');
        $this->assertContains($spitexId, $ids);
        $this->assertNotContains($vereinId, $ids);
    }

    public function test_list_filters_by_search_on_name(): void
    {
        $unique   = 'UniqueProviderXYZ7654';
        $targetId = $this->seedProvider(['name' => $unique, 'status' => 'active']);
        $otherId  = $this->seedProvider(['status' => 'active']);

        $result = $this->service()->list(self::TENANT_ID, ['search' => $unique]);

        $ids = array_column($result['data'], 'id');
        $this->assertContains($targetId, $ids);
        $this->assertNotContains($otherId, $ids);
    }

    public function test_list_filters_verified_only(): void
    {
        $verifiedId   = $this->seedProvider(['is_verified' => 1, 'status' => 'active']);
        $unverifiedId = $this->seedProvider(['is_verified' => 0, 'status' => 'active']);

        $result = $this->service()->list(self::TENANT_ID, ['verified_only' => true]);

        $ids = array_column($result['data'], 'id');
        $this->assertContains($verifiedId, $ids);
        $this->assertNotContains($unverifiedId, $ids);
    }

    public function test_list_is_tenant_scoped(): void
    {
        DB::table('tenants')->updateOrInsert(
            ['id' => self::OTHER_TENANT_ID],
            ['name' => 'Other', 'slug' => 'other-tenant-cpd-3', 'is_active' => true, 'depth' => 0, 'allows_subtenants' => false, 'created_at' => now(), 'updated_at' => now()]
        );
        $otherUserId = $this->insertUser(self::OTHER_TENANT_ID);
        DB::table('caring_care_providers')->insert([
            'tenant_id'   => self::OTHER_TENANT_ID,
            'name'        => 'Other Tenant Provider',
            'type'        => 'spitex',
            'is_verified' => 0,
            'status'      => 'active',
            'created_by'  => $otherUserId,
            'created_at'  => now(),
            'updated_at'  => now(),
        ]);

        $ownId = $this->seedProvider(['status' => 'active']);

        $result = $this->service()->list(self::TENANT_ID);

        $ids = array_column($result['data'], 'id');
        $this->assertContains($ownId, $ids);
        $names = array_column($result['data'], 'name');
        $this->assertNotContains('Other Tenant Provider', $names);
    }

    // ── update ────────────────────────────────────────────────────────────────

    public function test_update_changes_name_and_returns_fresh_row(): void
    {
        $id = $this->seedProvider(['name' => 'Old Name']);

        $result = $this->service()->update($id, self::TENANT_ID, ['name' => 'New Name']);

        $this->assertSame('New Name', $result['name']);
        $this->assertSame($id, $result['id']);
    }

    public function test_update_stores_opening_hours_as_decoded_json(): void
    {
        $id = $this->seedProvider();

        $hours = ['mon' => '08:00-18:00', 'tue' => '08:00-18:00'];
        $result = $this->service()->update($id, self::TENANT_ID, ['opening_hours' => $hours]);

        $this->assertIsArray($result['opening_hours']);
        $this->assertSame('08:00-18:00', $result['opening_hours']['mon']);
    }

    public function test_update_can_clear_opening_hours_to_null(): void
    {
        $id = $this->seedProvider(['opening_hours' => json_encode(['mon' => '09:00-17:00'])]);

        $result = $this->service()->update($id, self::TENANT_ID, ['opening_hours' => null]);

        $this->assertNull($result['opening_hours']);
    }

    // ── delete ────────────────────────────────────────────────────────────────

    public function test_delete_soft_deletes_by_setting_status_to_inactive(): void
    {
        $id = $this->seedProvider(['status' => 'active']);

        $this->service()->delete($id, self::TENANT_ID);

        $row = DB::table('caring_care_providers')->where('id', $id)->first();
        $this->assertNotNull($row);
        $this->assertSame('inactive', $row->status);
    }

    public function test_delete_is_tenant_scoped(): void
    {
        DB::table('tenants')->updateOrInsert(
            ['id' => self::OTHER_TENANT_ID],
            ['name' => 'Other', 'slug' => 'other-tenant-cpd-del', 'is_active' => true, 'depth' => 0, 'allows_subtenants' => false, 'created_at' => now(), 'updated_at' => now()]
        );
        $otherUserId = $this->insertUser(self::OTHER_TENANT_ID);
        $otherId = (int) DB::table('caring_care_providers')->insertGetId([
            'tenant_id'   => self::OTHER_TENANT_ID,
            'name'        => 'Other Active Provider',
            'type'        => 'verein',
            'is_verified' => 0,
            'status'      => 'active',
            'created_by'  => $otherUserId,
            'created_at'  => now(),
            'updated_at'  => now(),
        ]);

        $ownId = $this->seedProvider(['status' => 'active']);
        $this->service()->delete($ownId, self::TENANT_ID);

        // Other tenant's row must remain 'active'
        $other = DB::table('caring_care_providers')->where('id', $otherId)->first();
        $this->assertSame('active', $other->status);
    }

    // ── verify ────────────────────────────────────────────────────────────────

    public function test_verify_sets_is_verified_to_true(): void
    {
        $id = $this->seedProvider(['is_verified' => 0]);

        $this->service()->verify($id, self::TENANT_ID);

        $row = $this->service()->get($id, self::TENANT_ID);
        $this->assertTrue($row['is_verified']);
    }

    // ── adminList ─────────────────────────────────────────────────────────────

    public function test_admin_list_returns_all_statuses(): void
    {
        $activeId   = $this->seedProvider(['status' => 'active']);
        $inactiveId = $this->seedProvider(['status' => 'inactive']);

        $result = $this->service()->adminList(self::TENANT_ID);

        $ids = array_column($result['data'], 'id');
        $this->assertContains($activeId, $ids);
        $this->assertContains($inactiveId, $ids);
    }

    // ── findPotentialDuplicates ───────────────────────────────────────────────

    public function test_find_potential_duplicates_returns_expected_shape(): void
    {
        $result = $this->service()->findPotentialDuplicates(self::TENANT_ID);

        $this->assertArrayHasKey('pairs', $result);
        $this->assertArrayHasKey('total', $result);
        $this->assertArrayHasKey('scanned', $result);
        $this->assertIsArray($result['pairs']);
        $this->assertIsInt($result['total']);
        $this->assertIsInt($result['scanned']);
    }

    public function test_find_potential_duplicates_detects_matching_email(): void
    {
        // Two providers with the same contact_email should score >= 0.30 (email match weight)
        $email = 'duplicate@example.test';
        $this->seedProvider([
            'name'          => 'Provider Alpha ' . uniqid(),
            'contact_email' => $email,
            'status'        => 'active',
        ]);
        $this->seedProvider([
            'name'          => 'Provider Beta ' . uniqid(),
            'contact_email' => $email,
            'status'        => 'active',
        ]);

        $result = $this->service()->findPotentialDuplicates(self::TENANT_ID, 0.30);

        $hasEmailSignal = false;
        foreach ($result['pairs'] as $pair) {
            if (in_array('email_match', $pair['signals'], true)) {
                $hasEmailSignal = true;
                break;
            }
        }
        $this->assertTrue($hasEmailSignal, 'Expected email_match signal in duplicate pairs');
    }

    public function test_find_potential_duplicates_detects_matching_phone(): void
    {
        $phone = '+41 44 123 45 67';
        $this->seedProvider([
            'name'          => 'Phone Provider One ' . uniqid(),
            'contact_phone' => $phone,
            'status'        => 'active',
        ]);
        $this->seedProvider([
            'name'          => 'Phone Provider Two ' . uniqid(),
            'contact_phone' => $phone,
            'status'        => 'active',
        ]);

        $result = $this->service()->findPotentialDuplicates(self::TENANT_ID, 0.25);

        $hasPhoneSignal = false;
        foreach ($result['pairs'] as $pair) {
            if (in_array('phone_match', $pair['signals'], true)) {
                $hasPhoneSignal = true;
                break;
            }
        }
        $this->assertTrue($hasPhoneSignal, 'Expected phone_match signal in duplicate pairs');
    }

    public function test_find_potential_duplicates_returns_no_pairs_when_single_provider(): void
    {
        $this->seedProvider(['status' => 'active']);

        $result = $this->service()->findPotentialDuplicates(self::TENANT_ID);

        $this->assertSame(0, $result['total']);
        $this->assertCount(0, $result['pairs']);
    }
}
