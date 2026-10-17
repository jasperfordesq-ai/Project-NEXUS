<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\TenantFeatureConfig;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for AdminMarketplaceCategoryController — the admin's place to
 * add, rename, hide, order and delete Marketplace & Freecycle categories.
 *
 * Covers the admin gate, the feature flag, tenant isolation (another
 * community's categories are invisible and unreachable), platform categories
 * being read-only, slug uniqueness against both sets, parent depth, cascading
 * hide, and the refusal to delete a category that listings still use.
 */
class AdminMarketplaceCategoryControllerTest extends TestCase
{
    use DatabaseTransactions;

    private function enableMarketplaceFeature(int $tenantId): void
    {
        $features = TenantFeatureConfig::FEATURE_DEFAULTS;
        $features['marketplace'] = true;

        DB::table('tenants')->where('id', $tenantId)->update([
            'features' => json_encode($features),
        ]);
        TenantContext::setById($tenantId);
    }

    private function adminUser(): User
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin, ['*']);

        return $admin;
    }

    private function category(?int $tenantId, string $name, array $overrides = []): int
    {
        return DB::table('marketplace_categories')->insertGetId(array_merge([
            'tenant_id' => $tenantId,
            'name' => $name,
            'slug' => strtolower(str_replace([' ', '&'], ['-', 'and'], $name)) . '-' . uniqid(),
            'icon' => 'Package',
            'parent_id' => null,
            'sort_order' => 50,
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }

    private function otherTenantId(): int
    {
        return (int) DB::table('tenants')->insertGetId([
            'name' => 'Other Community ' . uniqid(),
            'slug' => 'other-' . uniqid(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    // ------------------------------------------------------------------
    //  Gates
    // ------------------------------------------------------------------

    public function test_index_requires_authentication(): void
    {
        $response = $this->apiGet('/v2/admin/marketplace/categories');

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    public function test_index_forbidden_for_regular_member(): void
    {
        $this->enableMarketplaceFeature($this->testTenantId);
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->create());

        $this->apiGet('/v2/admin/marketplace/categories')->assertStatus(403);
    }

    public function test_index_returns_403_when_marketplace_feature_disabled(): void
    {
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode(['marketplace' => false]),
        ]);
        TenantContext::setById($this->testTenantId);
        $this->adminUser();

        $this->apiGet('/v2/admin/marketplace/categories')->assertStatus(403);
    }

    // ------------------------------------------------------------------
    //  Listing
    // ------------------------------------------------------------------

    public function test_index_lists_platform_and_own_categories_but_never_another_communitys(): void
    {
        $this->enableMarketplaceFeature($this->testTenantId);
        $this->adminUser();

        $platform = $this->category(null, 'Platform Tools');
        $own = $this->category($this->testTenantId, 'Allotment Kit', ['is_active' => false]);
        $foreign = $this->category($this->otherTenantId(), 'Foreign Category');

        $response = $this->apiGet('/v2/admin/marketplace/categories');
        $response->assertStatus(200);

        $byId = collect($response->json('data'))->keyBy('id');
        $this->assertTrue($byId->has($platform));
        $this->assertTrue($byId->has($own));
        $this->assertFalse($byId->has($foreign));

        $this->assertTrue($byId[$platform]['is_platform']);
        $this->assertFalse($byId[$own]['is_platform']);
        $this->assertFalse($byId[$own]['is_active'], 'hidden categories must still be listed for the admin');
        $this->assertSame(0, $byId[$own]['listing_count']);
    }

    // ------------------------------------------------------------------
    //  Create
    // ------------------------------------------------------------------

    public function test_store_creates_a_community_category_with_a_slug(): void
    {
        $this->enableMarketplaceFeature($this->testTenantId);
        $this->adminUser();

        $response = $this->apiPost('/v2/admin/marketplace/categories', [
            'name' => 'Garden & Power Tools',
            'icon' => 'Hammer',
            'description' => 'Things to borrow for the garden.',
        ]);

        $response->assertStatus(201);
        $this->assertSame('garden-power-tools', $response->json('data.slug'));
        $this->assertFalse($response->json('data.is_platform'));
        $this->assertTrue($response->json('data.is_active'));

        $this->assertDatabaseHas('marketplace_categories', [
            'id' => $response->json('data.id'),
            'tenant_id' => $this->testTenantId,
            'slug' => 'garden-power-tools',
        ]);
    }

    public function test_store_refuses_a_name_that_clashes_with_a_platform_category(): void
    {
        $this->enableMarketplaceFeature($this->testTenantId);
        $this->adminUser();
        $this->category(null, 'Furniture', ['slug' => 'furniture-' . uniqid()]);
        DB::table('marketplace_categories')->whereNull('tenant_id')->where('name', 'Furniture')
            ->update(['slug' => 'furniture']);

        $this->apiPost('/v2/admin/marketplace/categories', ['name' => 'Furniture'])
            ->assertStatus(422);
    }

    public function test_store_refuses_a_parent_from_another_community(): void
    {
        $this->enableMarketplaceFeature($this->testTenantId);
        $this->adminUser();
        $foreignParent = $this->category($this->otherTenantId(), 'Foreign Parent');

        $this->apiPost('/v2/admin/marketplace/categories', [
            'name' => 'Sneaky Child',
            'parent_id' => $foreignParent,
        ])->assertStatus(422);
    }

    public function test_store_refuses_a_grandchild(): void
    {
        $this->enableMarketplaceFeature($this->testTenantId);
        $this->adminUser();
        $parent = $this->category($this->testTenantId, 'Top');
        $child = $this->category($this->testTenantId, 'Child', ['parent_id' => $parent]);

        $this->apiPost('/v2/admin/marketplace/categories', [
            'name' => 'Grandchild',
            'parent_id' => $child,
        ])->assertStatus(422);
    }

    // ------------------------------------------------------------------
    //  Update
    // ------------------------------------------------------------------

    public function test_update_renames_and_hides_a_community_category(): void
    {
        $this->enableMarketplaceFeature($this->testTenantId);
        $this->adminUser();
        $id = $this->category($this->testTenantId, 'Old Name');

        $response = $this->apiPut("/v2/admin/marketplace/categories/{$id}", [
            'name' => 'Bikes & Repairs',
            'is_active' => false,
        ]);

        $response->assertStatus(200);
        $this->assertSame('Bikes & Repairs', $response->json('data.name'));
        $this->assertSame('bikes-repairs', $response->json('data.slug'));
        $this->assertFalse($response->json('data.is_active'));
    }

    public function test_hiding_a_parent_hides_its_children(): void
    {
        $this->enableMarketplaceFeature($this->testTenantId);
        $this->adminUser();
        $parent = $this->category($this->testTenantId, 'Parent');
        $child = $this->category($this->testTenantId, 'Child', ['parent_id' => $parent]);

        $this->apiPut("/v2/admin/marketplace/categories/{$parent}", ['is_active' => false])->assertStatus(200);

        $this->assertDatabaseHas('marketplace_categories', ['id' => $child, 'is_active' => 0]);
    }

    public function test_platform_categories_are_read_only(): void
    {
        $this->enableMarketplaceFeature($this->testTenantId);
        $this->adminUser();
        $platform = $this->category(null, 'Platform Only');

        $this->apiPut("/v2/admin/marketplace/categories/{$platform}", ['name' => 'Renamed'])->assertStatus(403);
        $this->apiDelete("/v2/admin/marketplace/categories/{$platform}")->assertStatus(403);
        $this->assertDatabaseHas('marketplace_categories', ['id' => $platform, 'name' => 'Platform Only']);
    }

    public function test_another_communitys_category_is_not_found(): void
    {
        $this->enableMarketplaceFeature($this->testTenantId);
        $this->adminUser();
        $foreign = $this->category($this->otherTenantId(), 'Foreign');

        $this->apiPut("/v2/admin/marketplace/categories/{$foreign}", ['name' => 'Taken over'])->assertStatus(404);
        $this->apiDelete("/v2/admin/marketplace/categories/{$foreign}")->assertStatus(404);
        $this->assertDatabaseHas('marketplace_categories', ['id' => $foreign, 'name' => 'Foreign']);
    }

    // ------------------------------------------------------------------
    //  Reorder
    // ------------------------------------------------------------------

    public function test_reorder_sets_sort_order_for_own_categories_only(): void
    {
        $this->enableMarketplaceFeature($this->testTenantId);
        $this->adminUser();
        $a = $this->category($this->testTenantId, 'A', ['sort_order' => 10]);
        $b = $this->category($this->testTenantId, 'B', ['sort_order' => 20]);
        $platform = $this->category(null, 'P', ['sort_order' => 5]);
        $foreign = $this->category($this->otherTenantId(), 'F', ['sort_order' => 7]);

        $this->apiPut('/v2/admin/marketplace/categories/reorder', ['ids' => [$b, $foreign, $platform, $a]])
            ->assertStatus(200)
            ->assertJsonPath('data.reordered', 2);

        $this->assertDatabaseHas('marketplace_categories', ['id' => $b, 'sort_order' => 1]);
        $this->assertDatabaseHas('marketplace_categories', ['id' => $a, 'sort_order' => 2]);
        $this->assertDatabaseHas('marketplace_categories', ['id' => $platform, 'sort_order' => 5]);
        $this->assertDatabaseHas('marketplace_categories', ['id' => $foreign, 'sort_order' => 7]);
    }

    // ------------------------------------------------------------------
    //  Delete
    // ------------------------------------------------------------------

    public function test_destroy_refuses_a_category_that_listings_still_use(): void
    {
        $this->enableMarketplaceFeature($this->testTenantId);
        $admin = $this->adminUser();
        $id = $this->category($this->testTenantId, 'In Use');

        DB::table('marketplace_listings')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $admin->id,
            'category_id' => $id,
            'title' => 'Lawnmower',
            'description' => 'Petrol lawnmower, works.',
            'price' => 10,
            'price_currency' => 'EUR',
            'price_type' => 'fixed',
            'status' => 'active',
            'moderation_status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->apiDelete("/v2/admin/marketplace/categories/{$id}")->assertStatus(409);
        $this->assertDatabaseHas('marketplace_categories', ['id' => $id]);
    }

    public function test_destroy_removes_an_unused_category_and_its_children(): void
    {
        $this->enableMarketplaceFeature($this->testTenantId);
        $this->adminUser();
        $parent = $this->category($this->testTenantId, 'Unused');
        $child = $this->category($this->testTenantId, 'Unused Child', ['parent_id' => $parent]);

        $this->apiDelete("/v2/admin/marketplace/categories/{$parent}")
            ->assertStatus(200)
            ->assertJsonPath('data.deleted', 2);

        $this->assertDatabaseMissing('marketplace_categories', ['id' => $parent]);
        $this->assertDatabaseMissing('marketplace_categories', ['id' => $child]);
    }
}
