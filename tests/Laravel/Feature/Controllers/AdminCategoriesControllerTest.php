<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for AdminCategoriesController.
 *
 * Covers CRUD for categories and attributes.
 */
class AdminCategoriesControllerTest extends TestCase
{
    use DatabaseTransactions;

    // ================================================================
    // INDEX — GET /v2/admin/categories
    // ================================================================

    public function test_index_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/categories');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_index_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/categories');

        $response->assertStatus(403);
    }

    public function test_index_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/categories');

        $response->assertStatus(401);
    }

    // ================================================================
    // STORE — POST /v2/admin/categories
    // ================================================================

    public function test_store_creates_category_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/categories', [
            'name' => 'Test Category',
            'color' => 'green',
            'type' => 'listing',
        ]);

        $response->assertStatus(201);
        $response->assertJsonStructure(['data' => ['id', 'name', 'slug', 'color', 'type']]);
        $response->assertJsonPath('data.name', 'Test Category');
    }

    public function test_store_keeps_accented_name_and_transliterates_slug(): void
    {
        // Regression (AWID, Oct 2026): "Cercanía" became slug "cercan-a".
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/categories', [
            'name' => 'Cercanía Lingüística',
            'type' => 'listing',
        ]);

        $response->assertStatus(201);
        $response->assertJsonPath('data.name', 'Cercanía Lingüística');
        $response->assertJsonPath('data.slug', 'cercania-linguistica');
    }

    public function test_store_returns_422_when_name_missing(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/categories', [
            'color' => 'red',
        ]);

        $response->assertStatus(422);
    }

    public function test_store_returns_422_for_invalid_type(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/categories', [
            'name' => 'Bad Type Category',
            'type' => 'invalid_type',
        ]);

        $response->assertStatus(422);
    }

    public function test_store_returns_409_for_duplicate_name(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        DB::table('categories')->insert([
            'tenant_id' => $this->testTenantId,
            'name' => 'Duplicate Cat',
            'slug' => 'duplicate-cat',
            'color' => 'blue',
            'type' => 'listing',
        ]);

        $response = $this->apiPost('/v2/admin/categories', [
            'name' => 'Duplicate Cat',
        ]);

        $response->assertStatus(409);
    }

    public function test_store_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiPost('/v2/admin/categories', [
            'name' => 'Should Fail',
        ]);

        $response->assertStatus(403);
    }

    // ================================================================
    // UPDATE — PUT /v2/admin/categories/{id}
    // ================================================================

    public function test_update_modifies_category_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $catId = DB::table('categories')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'Old Name',
            'slug' => 'old-name',
            'color' => 'blue',
            'type' => 'listing',
        ]);

        $response = $this->apiPut("/v2/admin/categories/{$catId}", [
            'name' => 'New Name',
            'color' => 'red',
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.name', 'New Name');
        $response->assertJsonPath('data.color', 'red');
    }

    public function test_update_returns_404_for_nonexistent_category(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPut('/v2/admin/categories/999999', [
            'name' => 'Ghost',
        ]);

        $response->assertStatus(404);
    }

    // ================================================================
    // DELETE — DELETE /v2/admin/categories/{id}
    // ================================================================

    public function test_destroy_deletes_category_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $catId = DB::table('categories')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'Delete Me',
            'slug' => 'delete-me',
            'color' => 'blue',
            'type' => 'listing',
        ]);

        $response = $this->apiDelete("/v2/admin/categories/{$catId}");

        $response->assertStatus(200);
        $response->assertJsonPath('data.deleted', true);
    }

    public function test_destroy_returns_404_for_nonexistent_category(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiDelete('/v2/admin/categories/999999');

        $response->assertStatus(404);
    }

    // ================================================================
    // ATTRIBUTES — GET /v2/admin/attributes
    // ================================================================

    public function test_list_attributes_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/attributes');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_list_attributes_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/attributes');

        $response->assertStatus(403);
    }

    // ================================================================
    // STORE ATTRIBUTE — POST /v2/admin/attributes
    // ================================================================

    public function test_store_attribute_returns_201_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/attributes', [
            'name' => 'Test Attribute',
            'type' => 'checkbox',
        ]);

        $response->assertStatus(201);
        $response->assertJsonStructure(['data' => ['id', 'name', 'type']]);
    }

    public function test_store_attribute_returns_422_when_name_missing(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/attributes', [
            'type' => 'checkbox',
        ]);

        $response->assertStatus(422);
    }
}
