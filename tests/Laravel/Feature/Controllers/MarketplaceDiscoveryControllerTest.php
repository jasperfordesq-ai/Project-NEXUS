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
 * Smoke tests for MarketplaceDiscoveryController.
 */
class MarketplaceDiscoveryControllerTest extends TestCase
{
    use DatabaseTransactions;

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
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode(['marketplace' => true]),
        ]);
        TenantContext::setById($this->testTenantId);
    }

    private function createListing(User $seller, array $overrides = []): int
    {
        return (int) DB::table('marketplace_listings')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'user_id' => $seller->id,
            'title' => 'Collection item',
            'description' => 'Collection visibility fixture.',
            'price_currency' => 'EUR',
            'price_type' => 'free',
            'quantity' => 1,
            'shipping_available' => 0,
            'local_pickup' => 1,
            'delivery_method' => 'pickup',
            'seller_type' => 'private',
            'status' => 'active',
            'moderation_status' => 'approved',
            'expires_at' => now()->addDay(),
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }

    public function test_listSavedSearches_requires_auth(): void
    {
        $response = $this->apiGet('/v2/marketplace/saved-searches');
        $this->assertContains($response->status(), [401, 403]);
    }

    public function test_listCollections_requires_auth(): void
    {
        $response = $this->apiGet('/v2/marketplace/collections');
        $this->assertContains($response->status(), [401, 403]);
    }

    public function test_storeSavedSearch_requires_auth(): void
    {
        $response = $this->apiPost('/v2/marketplace/saved-searches', []);
        $this->assertContains($response->status(), [401, 403]);
    }

    public function test_listSavedSearches_authenticated_smoke(): void
    {
        $this->authenticatedUser();
        $response = $this->apiGet('/v2/marketplace/saved-searches');
        $this->assertLessThan(500, $response->status());
    }

    public function test_listCollections_authenticated_smoke(): void
    {
        $this->authenticatedUser();
        $response = $this->apiGet('/v2/marketplace/collections');
        $this->assertLessThan(500, $response->status());
    }

    public function test_discovery_create_mutations_return_created_instead_of_type_error(): void
    {
        $this->enableMarketplaceFeature();
        $user = $this->authenticatedUser();

        $searchResponse = $this->apiPost('/v2/marketplace/saved-searches', [
            'name' => 'Tools nearby',
        ]);
        $searchResponse->assertCreated();

        $collectionResponse = $this->apiPost('/v2/marketplace/collections', [
            'name' => 'Repair favourites',
            'is_public' => true,
        ]);
        $collectionResponse->assertCreated();

        $listingId = $this->createListing($user);
        $collectionId = (int) $collectionResponse->json('data.id');
        $itemResponse = $this->apiPost("/v2/marketplace/collections/{$collectionId}/items", [
            'listing_id' => $listingId,
        ]);
        $itemResponse->assertCreated();

        $listResponse = $this->apiGet("/v2/marketplace/collections/{$collectionId}/items");
        $listResponse->assertOk();
        $listResponse->assertJsonPath('data.0.listing.id', $listingId);
        $this->assertArrayHasKey('meta', $listResponse->json());
    }

    public function test_identical_discovery_mutation_retries_are_idempotent(): void
    {
        $this->enableMarketplaceFeature();
        $user = $this->authenticatedUser();

        $savedSearch = [
            'name' => 'Retry-safe tools',
            'search_query' => 'drill',
            'filters' => ['price_max' => 50, 'condition' => 'good'],
            'alert_frequency' => 'daily',
            'alert_channel' => 'email',
        ];
        $firstSearch = $this->apiPost('/v2/marketplace/saved-searches', $savedSearch);
        $secondSearch = $this->apiPost('/v2/marketplace/saved-searches', $savedSearch);
        $firstSearch->assertCreated();
        $secondSearch->assertCreated();
        $this->assertSame($firstSearch->json('data.id'), $secondSearch->json('data.id'));
        $this->assertSame(1, DB::table('marketplace_saved_searches')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)
            ->where('name', 'Retry-safe tools')
            ->count());

        $collection = [
            'name' => 'Retry-safe favourites',
            'description' => 'Created once even if the response is retried.',
            'is_public' => true,
        ];
        $firstCollection = $this->apiPost('/v2/marketplace/collections', $collection);
        $secondCollection = $this->apiPost('/v2/marketplace/collections', $collection);
        $firstCollection->assertCreated();
        $secondCollection->assertCreated();
        $this->assertSame($firstCollection->json('data.id'), $secondCollection->json('data.id'));

        $listingId = $this->createListing($user);
        $collectionId = (int) $firstCollection->json('data.id');
        $firstItem = $this->apiPost("/v2/marketplace/collections/{$collectionId}/items", [
            'listing_id' => $listingId,
        ]);
        $secondItem = $this->apiPost("/v2/marketplace/collections/{$collectionId}/items", [
            'listing_id' => $listingId,
        ]);
        $firstItem->assertCreated();
        $secondItem->assertCreated();

        $this->assertSame(1, DB::table('marketplace_collection_items')
            ->where('collection_id', $collectionId)
            ->where('marketplace_listing_id', $listingId)
            ->count());
        $this->assertSame(1, (int) DB::table('marketplace_collections')
            ->where('id', $collectionId)
            ->value('item_count'));
    }

    public function test_collection_rejects_listing_from_another_tenant(): void
    {
        $this->enableMarketplaceFeature();
        $user = $this->authenticatedUser();
        $collectionId = (int) DB::table('marketplace_collections')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'name' => 'Tenant-safe collection',
            'is_public' => false,
            'item_count' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $foreignListingId = $this->createListing($user, ['tenant_id' => 999]);

        $response = $this->apiPost("/v2/marketplace/collections/{$collectionId}/items", [
            'listing_id' => $foreignListingId,
        ]);

        $response->assertStatus(422);
        $this->assertDatabaseMissing('marketplace_collection_items', [
            'collection_id' => $collectionId,
            'marketplace_listing_id' => $foreignListingId,
        ]);
    }

    public function test_collection_add_rejects_other_sellers_unpublished_listings_but_accepts_owners_private_listing(): void
    {
        $this->enableMarketplaceFeature();
        $owner = $this->authenticatedUser();
        $otherSeller = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $collectionId = (int) DB::table('marketplace_collections')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'name' => 'Private add boundary',
            'is_public' => false,
            'item_count' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $foreignListingIds = [
            $this->createListing($otherSeller, ['status' => 'draft']),
            $this->createListing($otherSeller, ['moderation_status' => 'pending']),
            $this->createListing($otherSeller, ['status' => 'removed']),
        ];

        foreach ($foreignListingIds as $listingId) {
            $this->apiPost("/v2/marketplace/collections/{$collectionId}/items", [
                'listing_id' => $listingId,
            ])->assertStatus(422);
        }

        $this->assertSame(0, DB::table('marketplace_collection_items')
            ->where('collection_id', $collectionId)
            ->count());
        $this->assertSame(0, (int) DB::table('marketplace_collections')
            ->where('id', $collectionId)
            ->value('item_count'));

        $ownDraftId = $this->createListing($owner, [
            'status' => 'draft',
            'moderation_status' => 'pending',
        ]);
        $this->apiPost("/v2/marketplace/collections/{$collectionId}/items", [
            'listing_id' => $ownDraftId,
        ])->assertCreated();

        $this->assertDatabaseHas('marketplace_collection_items', [
            'collection_id' => $collectionId,
            'marketplace_listing_id' => $ownDraftId,
        ]);
        $this->assertSame(1, (int) DB::table('marketplace_collections')
            ->where('id', $collectionId)
            ->value('item_count'));
    }

    public function test_public_collection_hides_pending_removed_and_expired_listings(): void
    {
        $this->enableMarketplaceFeature();
        $owner = $this->authenticatedUser();
        $collectionId = (int) DB::table('marketplace_collections')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'name' => 'Public collection',
            'is_public' => true,
            'item_count' => 4,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $visibleId = $this->createListing($owner, ['title' => 'Visible']);
        $pendingId = $this->createListing($owner, ['title' => 'Pending', 'moderation_status' => 'pending']);
        $removedId = $this->createListing($owner, ['title' => 'Removed', 'status' => 'removed']);
        $expiredId = $this->createListing($owner, ['title' => 'Expired', 'expires_at' => now()->subMinute()]);
        foreach ([$visibleId, $pendingId, $removedId, $expiredId] as $listingId) {
            DB::table('marketplace_collection_items')->insert([
                'tenant_id' => $this->testTenantId,
                'collection_id' => $collectionId,
                'marketplace_listing_id' => $listingId,
                'created_at' => now(),
            ]);
        }

        $viewer = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        Sanctum::actingAs($viewer, ['*']);
        $response = $this->apiGet("/v2/marketplace/collections/{$collectionId}/items");

        $response->assertOk();
        $this->assertSame(
            [$visibleId],
            array_map(
                static fn (array $item): int => (int) $item['listing']['id'],
                $response->json('data')
            )
        );
    }

    public function test_private_collection_does_not_grant_access_to_another_sellers_unpublished_listing(): void
    {
        $this->enableMarketplaceFeature();
        $owner = $this->authenticatedUser();
        $otherSeller = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $collectionId = (int) DB::table('marketplace_collections')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'name' => 'Private visibility boundary',
            'is_public' => false,
            'item_count' => 3,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $ownDraftId = $this->createListing($owner, [
            'title' => 'Owners own draft',
            'status' => 'draft',
            'moderation_status' => 'pending',
        ]);
        $otherPendingId = $this->createListing($otherSeller, [
            'title' => 'Other seller pending',
            'moderation_status' => 'pending',
        ]);
        $otherPublicId = $this->createListing($otherSeller, [
            'title' => 'Other seller public',
        ]);
        foreach ([$ownDraftId, $otherPendingId, $otherPublicId] as $listingId) {
            DB::table('marketplace_collection_items')->insert([
                'tenant_id' => $this->testTenantId,
                'collection_id' => $collectionId,
                'marketplace_listing_id' => $listingId,
                'created_at' => now(),
            ]);
        }

        $response = $this->apiGet("/v2/marketplace/collections/{$collectionId}/items");

        $response->assertOk();
        $ids = array_map(
            static fn (array $item): int => (int) $item['listing']['id'],
            $response->json('data')
        );
        $this->assertContains($ownDraftId, $ids);
        $this->assertContains($otherPublicId, $ids);
        $this->assertNotContains($otherPendingId, $ids);
    }

    // -----------------------------------------------------------------
    //  REMOVE COLLECTION ITEM — DELETE /v2/marketplace/collections/{id}/items/{listingId}
    //
    //  E-022. The cross-community child sweep flagged this as
    //  ACCEPTED_NO_CHANGE once the marketplace feature was enabled for the
    //  sweep's communities: handed another community's listing id it answers
    //  200 `removed: true` rather than refusing. Before pinning that in
    //  KNOWN_CHILD_ACCEPTED_NO_CHANGE the claim had to be proved, because an
    //  allow-list entry is an edit to a security control that makes a hit
    //  disappear.
    //
    //  Both halves are tested: nothing of anyone else's is touched, and the
    //  answer does not reveal whether the listing exists.
    // -----------------------------------------------------------------

    public function test_remove_collection_item_answers_identically_for_a_foreign_listing_and_a_nonexistent_one(): void
    {
        $this->enableMarketplaceFeature();
        $owner = $this->authenticatedUser();

        $collectionId = (int) DB::table('marketplace_collections')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'name' => 'Sweep collection',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // 999 is the foreign-community id the security sweeps already use.
        $foreignTenantId = 999;
        $stranger = User::factory()->forTenant($foreignTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $foreignListingId = (int) DB::table('marketplace_listings')->insertGetId([
            'tenant_id' => $foreignTenantId,
            'user_id' => $stranger->id,
            'title' => 'Another community listing',
            'description' => 'Should be untouchable from here',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $foreign = $this->apiDelete("/v2/marketplace/collections/{$collectionId}/items/{$foreignListingId}");
        $absent  = $this->apiDelete("/v2/marketplace/collections/{$collectionId}/items/999999999");

        $this->assertSame($absent->getStatusCode(), $foreign->getStatusCode());
        $this->assertSame(
            $absent->getContent(),
            $foreign->getContent(),
            'The answer for another community\'s listing must not differ from the answer for an id '
            . 'that exists nowhere, or the endpoint becomes an existence oracle.'
        );

        $this->assertDatabaseHas('marketplace_listings', [
            'id' => $foreignListingId,
            'tenant_id' => $foreignTenantId,
        ]);
    }

    public function test_remove_collection_item_refuses_a_collection_the_caller_does_not_own(): void
    {
        $this->enableMarketplaceFeature();

        $stranger = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $theirCollectionId = (int) DB::table('marketplace_collections')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $stranger->id,
            'name' => 'Their collection',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->authenticatedUser();

        $response = $this->apiDelete("/v2/marketplace/collections/{$theirCollectionId}/items/1");

        $this->assertSame(404, $response->getStatusCode());
    }
}
