<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use Tests\Laravel\TestCase;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use App\Models\User;

/**
 * Smoke tests for MarketplaceListingController.
 */
class MarketplaceListingControllerTest extends TestCase
{
    use DatabaseTransactions;

    public function test_csv_import_row_errors_are_translated_in_every_locale(): void
    {
        $source = file_get_contents(app_path('Http/Controllers/Api/MarketplaceListingController.php'));
        foreach ([
            'marketplace_listing_csv_import_limit',
            'marketplace_listing_csv_column_mismatch',
            'marketplace_listing_csv_required_fields',
            'marketplace_listing_csv_length_limit',
        ] as $key) {
            $this->assertStringContainsString("__('api.{$key}'", $source);
            foreach (glob(base_path('lang/*/api.php')) ?: [] as $translationFile) {
                $translations = require $translationFile;
                $this->assertArrayHasKey($key, $translations, $translationFile);
            }
        }
    }

    private function authenticatedUser(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($user, ['*']);
        return $user;
    }

    private function enableMarketplaceFeature(): void
    {
        DB::table('tenants')
            ->where('id', $this->testTenantId)
            ->update(['features' => json_encode(['marketplace' => true])]);

        TenantContext::setById($this->testTenantId);
    }

    private function createMarketplaceCategory(string $name = 'Repair Tools'): int
    {
        return DB::table('marketplace_categories')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => $name,
            'slug' => strtolower(str_replace(' ', '-', $name)) . '-' . uniqid(),
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function createMarketplaceListing(User $seller, int $categoryId, array $overrides = []): int
    {
        return DB::table('marketplace_listings')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'user_id' => $seller->id,
            'category_id' => $categoryId,
            'title' => 'Community repair kit',
            'tagline' => 'A practical kit for local repair sessions.',
            'description' => 'A public marketplace item for a community repair kit.',
            'price' => 25,
            'price_currency' => 'EUR',
            'price_type' => 'fixed',
            'time_credit_price' => 2,
            'condition' => 'good',
            'quantity' => 1,
            'location' => 'Remote or local',
            'latitude' => null,
            'longitude' => null,
            'shipping_available' => true,
            'local_pickup' => true,
            'delivery_method' => 'both',
            'seller_type' => 'private',
            'status' => 'active',
            'moderation_status' => 'approved',
            'expires_at' => '2030-07-10 00:00:00',
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }

    private function addMarketplaceImage(int $listingId, string $url, bool $primary = true, int $sortOrder = 0): void
    {
        DB::table('marketplace_images')->insert([
            'tenant_id' => $this->testTenantId,
            'marketplace_listing_id' => $listingId,
            'image_url' => $url,
            'thumbnail_url' => $url,
            'alt_text' => 'Community repair kit',
            'sort_order' => $sortOrder,
            'is_primary' => $primary,
            'created_at' => now(),
        ]);
    }

    public function test_store_requires_auth(): void
    {
        $response = $this->apiPost('/v2/marketplace/listings', []);
        $this->assertContains($response->status(), [401, 403]);
    }

    public function test_store_rejects_category_owned_by_another_tenant(): void
    {
        $this->enableMarketplaceFeature();
        $this->authenticatedUser();
        $foreignCategoryId = (int) DB::table('marketplace_categories')->insertGetId([
            'tenant_id' => 999,
            'name' => 'Foreign category',
            'slug' => 'foreign-category-' . uniqid(),
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->apiPost('/v2/marketplace/listings', [
            'title' => 'Invalid category listing',
            'description' => 'Must not retain a category from another tenant.',
            'price_type' => 'free',
            'category_id' => $foreignCategoryId,
        ]);

        $response->assertStatus(422);
        $this->assertNotEmpty($response->json('errors.0.details.category_id'));
    }

    public function test_store_accepts_active_global_category(): void
    {
        $this->enableMarketplaceFeature();
        $this->authenticatedUser();
        $globalCategoryId = (int) DB::table('marketplace_categories')->insertGetId([
            'tenant_id' => null,
            'name' => 'Global category',
            'slug' => 'global-category-' . uniqid(),
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->apiPost('/v2/marketplace/listings', [
            'title' => 'Global category listing',
            'description' => 'System categories remain available to every tenant.',
            'price_type' => 'free',
            'category_id' => $globalCategoryId,
        ]);

        $response->assertCreated();
        $this->assertDatabaseHas('marketplace_listings', [
            'tenant_id' => $this->testTenantId,
            'category_id' => $globalCategoryId,
        ]);
    }

    public function test_store_returns_validation_error_for_unsupported_payment_currency(): void
    {
        $this->enableMarketplaceFeature();
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/marketplace/listings', [
            'title' => 'Unsupported currency listing',
            'description' => 'Cash listings must use a currency the payment provider supports.',
            'price' => 25,
            'price_currency' => 'ZZZ',
            'price_type' => 'fixed',
        ]);

        $response->assertStatus(422);
        $this->assertSame('VALIDATION_ERROR', $response->json('errors.0.code'));
    }

    public function test_suspended_seller_cannot_reactivate_a_draft_with_bulk_tools(): void
    {
        $this->enableMarketplaceFeature();
        $seller = $this->authenticatedUser();
        DB::table('marketplace_seller_profiles')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $seller->id,
            'display_name' => 'Suspended seller',
            'seller_type' => 'private',
            'is_suspended' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $listingId = $this->createMarketplaceListing(
            $seller,
            $this->createMarketplaceCategory('Suspended drafts'),
            ['status' => 'draft']
        );

        $response = $this->apiPost('/v2/marketplace/listings/bulk-action', [
            'listing_ids' => [$listingId],
            'action' => 'activate',
        ]);

        $response->assertStatus(403);
        $this->assertSame('SELLER_SUSPENDED', $response->json('errors.0.code'));
        $this->assertDatabaseHas('marketplace_listings', [
            'id' => $listingId,
            'status' => 'draft',
        ]);
    }

    public function test_removed_listing_cannot_be_resurrected_by_renewal(): void
    {
        $this->enableMarketplaceFeature();
        $seller = $this->authenticatedUser();
        $listingId = $this->createMarketplaceListing(
            $seller,
            $this->createMarketplaceCategory('Removed listings'),
            ['status' => 'removed']
        );

        $this->apiPost("/v2/marketplace/listings/{$listingId}/renew", ['duration_days' => 30])
            ->assertStatus(422);
        $this->assertDatabaseHas('marketplace_listings', [
            'id' => $listingId,
            'status' => 'removed',
        ]);
    }

    public function test_savedListings_requires_auth(): void
    {
        $response = $this->apiGet('/v2/marketplace/listings/saved');
        $this->assertContains($response->status(), [401, 403]);
    }

    public function test_destroy_requires_auth(): void
    {
        $response = $this->apiDelete('/v2/marketplace/listings/1');
        $this->assertContains($response->status(), [401, 403]);
    }

    public function test_index_requires_authentication(): void
    {
        $response = $this->apiGet('/v2/marketplace/listings');
        $response->assertStatus(401);
    }

    public function test_index_keeps_marketplace_public_contract_opt_in(): void
    {
        $this->enableMarketplaceFeature();
        $this->authenticatedUser();
        $seller = User::factory()->forTenant($this->testTenantId)->create([
            'first_name' => 'Market',
            'last_name' => 'Seller',
            'status' => 'active',
            'is_approved' => true,
        ]);
        $categoryId = $this->createMarketplaceCategory();
        $listingId = $this->createMarketplaceListing($seller, $categoryId);
        $this->addMarketplaceImage($listingId, '/uploads/tenants/hour-timebank/marketplace/repair-kit.jpg');

        $defaultResponse = $this->apiGet('/v2/marketplace/listings?limit=1');
        $defaultResponse->assertOk();
        $this->assertArrayNotHasKey('public_contract', $defaultResponse->json('data.0'));

        $contractResponse = $this->apiGet('/v2/marketplace/listings?limit=1', [
            'X-Public-Contract' => '1',
        ]);
        $contractResponse->assertOk();
        $contractResponse->assertJsonStructure([
            'data' => [
                '*' => [
                    'id',
                    'title',
                    'public_contract' => [
                        'id',
                        'slug',
                        'title',
                        'description',
                        'excerpt',
                        'primary_image' => ['url', 'alt_text'],
                        'gallery' => [['url', 'alt_text', 'sort_order']],
                        'category' => ['id', 'name', 'slug'],
                        'location' => ['label', 'latitude', 'longitude'],
                        'price' => ['amount', 'currency', 'price_type', 'time_credits'],
                        'seller' => ['id', 'display_name', 'avatar_url', 'is_verified', 'seller_type'],
                        'delivery' => ['method', 'shipping_available', 'local_pickup'],
                        'condition',
                        'quantity',
                        'expires_at',
                        'created_at',
                        'updated_at',
                        'status',
                    ],
                ],
            ],
        ]);

        $contract = $contractResponse->json('data.0.public_contract');
        $this->assertSame($listingId, $contract['id']);
        $this->assertSame((string) $listingId, $contract['slug']);
        $this->assertSame('Community repair kit', $contract['title']);
        $this->assertSame('A practical kit for local repair sessions.', $contract['excerpt']);
        $this->assertSame('/uploads/tenants/hour-timebank/marketplace/repair-kit.jpg', $contract['primary_image']['url']);
        $this->assertSame('Repair Tools', $contract['category']['name']);
        $this->assertSame('Remote or local', $contract['location']['label']);
        $this->assertEquals(25.0, $contract['price']['amount']);
        $this->assertSame('EUR', $contract['price']['currency']);
        $this->assertEquals(2.0, $contract['price']['time_credits']);
        $this->assertSame('Market Seller', $contract['seller']['display_name']);
        $this->assertSame('both', $contract['delivery']['method']);
        $this->assertTrue($contract['delivery']['shipping_available']);
        $this->assertTrue($contract['delivery']['local_pickup']);
        $this->assertSame('good', $contract['condition']);
        $this->assertSame(1, $contract['quantity']);
    }

    public function test_show_keeps_marketplace_public_contract_opt_in(): void
    {
        $this->enableMarketplaceFeature();
        $this->authenticatedUser();
        $seller = User::factory()->forTenant($this->testTenantId)->create([
            'first_name' => 'Detail',
            'last_name' => 'Seller',
            'status' => 'active',
            'is_approved' => true,
        ]);
        $categoryId = $this->createMarketplaceCategory('Shared Tools');
        $listingId = $this->createMarketplaceListing($seller, $categoryId, [
            'title' => 'Shared cordless drill',
            'tagline' => 'Borrow a drill for local projects.',
            'description' => 'A detailed public marketplace description for a cordless drill.',
            'price_type' => 'free',
            'price' => null,
            'time_credit_price' => null,
            'location' => 'Online',
        ]);
        $this->addMarketplaceImage($listingId, '/uploads/tenants/hour-timebank/marketplace/drill.jpg');

        $defaultResponse = $this->apiGet("/v2/marketplace/listings/{$listingId}");
        $defaultResponse->assertOk();
        $this->assertArrayNotHasKey('public_contract', $defaultResponse->json('data'));

        $contractResponse = $this->apiGet("/v2/marketplace/listings/{$listingId}", [
            'X-Public-Contract' => '1',
        ]);
        $contractResponse->assertOk();

        $contract = $contractResponse->json('data.public_contract');
        $this->assertSame($listingId, $contract['id']);
        $this->assertSame('Shared cordless drill', $contract['title']);
        $this->assertSame('Borrow a drill for local projects.', $contract['excerpt']);
        $this->assertSame('/uploads/tenants/hour-timebank/marketplace/drill.jpg', $contract['primary_image']['url']);
        $this->assertSame('Shared Tools', $contract['category']['name']);
        $this->assertSame('Online', $contract['location']['label']);
        $this->assertSame('free', $contract['price']['price_type']);
        $this->assertSame('Detail Seller', $contract['seller']['display_name']);
    }

    /**
     * 🔴 Marketplace moderation is ON by default, so every newly published listing starts
     * as `pending` and is correctly hidden from the public read. Both frontends navigate
     * the seller straight to this endpoint after publishing, and so told them "Listing not
     * found. This item may have been sold, removed, or moved." about the item they had
     * just created (measured on a device, 2026-08-22). A seller may read their own listing
     * whatever its moderation status; nobody else may.
     */
    public function test_show_lets_a_seller_open_their_own_listing_while_it_awaits_moderation(): void
    {
        $this->enableMarketplaceFeature();
        $seller = $this->authenticatedUser();
        $categoryId = $this->createMarketplaceCategory('Awaiting Review');
        $listingId = $this->createMarketplaceListing($seller, $categoryId, [
            'title' => 'Folding wooden drying rack',
            'moderation_status' => 'pending',
        ]);

        $response = $this->apiGet("/v2/marketplace/listings/{$listingId}");

        $response->assertOk();
        $this->assertSame($listingId, $response->json('data.id'));
        $this->assertSame('Folding wooden drying rack', $response->json('data.title'));
    }

    public function test_show_still_hides_a_pending_listing_from_everyone_but_its_seller(): void
    {
        $this->enableMarketplaceFeature();
        $this->authenticatedUser(); // a different member is signed in
        $seller = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $categoryId = $this->createMarketplaceCategory('Awaiting Review');
        $listingId = $this->createMarketplaceListing($seller, $categoryId, [
            'moderation_status' => 'pending',
        ]);

        $this->apiGet("/v2/marketplace/listings/{$listingId}")->assertStatus(404);
    }

    public function test_categories_public_smoke(): void
    {
        $response = $this->apiGet('/v2/marketplace/categories');
        $this->assertLessThan(500, $response->status());
    }

    public function test_category_listings_public_endpoint_filters_by_slug(): void
    {
        $this->enableMarketplaceFeature();
        $this->authenticatedUser();

        $seller = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        $toolsCategoryId = DB::table('marketplace_categories')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'Repair Tools',
            'slug' => 'repair-tools',
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $booksCategoryId = DB::table('marketplace_categories')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'Books',
            'slug' => 'books',
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('marketplace_listings')->insert([
            [
                'tenant_id' => $this->testTenantId,
                'user_id' => $seller->id,
                'category_id' => $toolsCategoryId,
                'title' => 'Community repair kit',
                'description' => 'A public listing for testing category-backed Next pages.',
                'price_type' => 'free',
                'condition' => 'good',
                'quantity' => 1,
                'delivery_method' => 'pickup',
                'seller_type' => 'private',
                'status' => 'active',
                'moderation_status' => 'approved',
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'tenant_id' => $this->testTenantId,
                'user_id' => $seller->id,
                'category_id' => $booksCategoryId,
                'title' => 'Neighbourhood cookbook',
                'description' => 'A different category listing that should not appear.',
                'price_type' => 'free',
                'condition' => 'good',
                'quantity' => 1,
                'delivery_method' => 'pickup',
                'seller_type' => 'private',
                'status' => 'active',
                'moderation_status' => 'approved',
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        $response = $this->apiGet('/v2/marketplace/categories/repair-tools/listings');

        $response->assertStatus(200);
        $titles = collect($response->json('data'))->pluck('title')->all();

        $this->assertContains('Community repair kit', $titles);
        $this->assertNotContains('Neighbourhood cookbook', $titles);
    }

    public function test_category_listings_unknown_slug_does_not_fall_back_to_all_listings(): void
    {
        $this->enableMarketplaceFeature();
        $this->authenticatedUser();

        $seller = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        $categoryId = DB::table('marketplace_categories')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'Visible Category',
            'slug' => 'visible-category',
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('marketplace_listings')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $seller->id,
            'category_id' => $categoryId,
            'title' => 'Visible marketplace listing',
            'description' => 'This listing must not leak into unknown category pages.',
            'price_type' => 'free',
            'condition' => 'good',
            'quantity' => 1,
            'delivery_method' => 'pickup',
            'seller_type' => 'private',
            'status' => 'active',
            'moderation_status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->apiGet('/v2/marketplace/categories/missing-category/listings');

        $response->assertStatus(200);
        $this->assertSame([], $response->json('data'));
        $response->assertJsonPath('meta.has_more', false);
    }

    public function test_nearby_uses_documented_query_names_and_returns_only_rounded_public_coordinates(): void
    {
        $this->enableMarketplaceFeature();
        $this->authenticatedUser();
        $seller = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $categoryId = $this->createMarketplaceCategory('Nearby repairs');
        $listingId = $this->createMarketplaceListing($seller, $categoryId, [
            'title' => 'Nearby repair drill',
            'latitude' => 53.349805,
            'longitude' => -6.26031,
        ]);

        $response = $this->apiGet(
            '/v2/marketplace/listings/nearby'
            . '?latitude=53.35&longitude=-6.26&radius=5&q=drill'
            . "&category_id={$categoryId}"
        );

        $response->assertOk();
        $response->assertJsonPath('data.0.id', $listingId);
        $response->assertJsonPath('data.0.latitude', 53.35);
        $response->assertJsonPath('data.0.longitude', -6.26);
        $this->assertNotSame(53.349805, $response->json('data.0.latitude'));
        $this->assertNotSame(-6.26031, $response->json('data.0.longitude'));

        $legacyNames = $this->apiGet(
            '/v2/marketplace/listings/nearby?lat=53.35&lng=-6.26&radius_km=5'
        );
        $legacyNames->assertStatus(422);
    }

    public function test_savedListings_authenticated_smoke(): void
    {
        $this->authenticatedUser();
        $response = $this->apiGet('/v2/marketplace/listings/saved');
        $this->assertLessThan(500, $response->status());
    }
}
