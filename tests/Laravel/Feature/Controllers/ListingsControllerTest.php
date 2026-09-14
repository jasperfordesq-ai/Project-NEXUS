<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Events\ListingCreated;
use App\Models\Listing;
use App\Models\User;
use App\Services\ListingConfigurationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for ListingsController.
 *
 * Covers CRUD, search, save/unsave, tags, nearby, featured, analytics, renew.
 */
class ListingsControllerTest extends TestCase
{
    use DatabaseTransactions;

    protected function tearDown(): void
    {
        Cache::forget("listing_config:{$this->testTenantId}");
        parent::tearDown();
    }

    private function authenticatedUser(array $overrides = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    private function ensureListingCategory(int $id = 1): void
    {
        // The CI seed already contains category id=1 pinned to tenant 1, so a
        // plain insertOrIgnore was a no-op and left the row owned by the wrong
        // tenant — the store() exists-rule (tenant_id = testTenant AND
        // type = 'listing') then 422s. Force the row onto the test tenant.
        // Runs inside DatabaseTransactions, so this is rolled back per test.
        DB::table('categories')->updateOrInsert(
            ['id' => $id],
            [
                'tenant_id' => $this->testTenantId,
                'name' => 'General',
                'slug' => 'general',
                'type' => 'listing',
                'updated_at' => now(),
            ]
        );
    }

    // ================================================================
    // INDEX — Happy path
    // ================================================================

    public function test_index_returns_paginated_listings(): void
    {
        $user = $this->authenticatedUser();
        Listing::factory()->forTenant($this->testTenantId)->count(3)->create([
            'user_id' => $user->id,
        ]);

        $response = $this->apiGet('/v2/listings');

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'data',
            'meta' => ['per_page', 'has_more'],
        ]);
        $this->assertArrayNotHasKey('public_contract', $response->json('data.0'));
    }

    public function test_member_index_returns_full_next_public_contract_when_opted_in(): void
    {
        $this->authenticatedUser();

        $user = User::factory()->forTenant($this->testTenantId)->create([
            'first_name' => 'Public',
            'last_name' => 'Provider',
            'status' => 'active',
            'is_approved' => true,
        ]);
        $this->ensureListingCategory();

        $listing = Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id,
            'category_id' => 1,
            'title' => 'Repair a community bike',
            'description' => 'A friendly public offer to repair a community bike.',
            'image_url' => '/uploads/tenants/hour-timebank/listings/bike.jpg',
            'location' => 'Remote or local',
            'latitude' => null,
            'longitude' => null,
            'hours_estimate' => 2.5,
            'status' => 'active',
            'moderation_status' => 'approved',
        ]);

        $response = $this->apiGet('/v2/listings?per_page=1&include=public_contract');

        $response->assertOk();
        $response->assertJsonStructure([
            'data' => [
                '*' => [
                    'id',
                    'title',
                    'description',
                    'public_contract' => [
                        'id',
                        'slug',
                        'title',
                        'description',
                        'excerpt',
                        'primary_image' => ['url', 'alt_text'],
                        'gallery',
                        'category' => ['id', 'name', 'slug'],
                        'location' => ['label', 'latitude', 'longitude'],
                        'time_credit_value' => ['hours', 'unit'],
                        'provider' => ['id', 'display_name'],
                        'created_at',
                        'updated_at',
                        'status',
                    ],
                ],
            ],
            'meta' => ['cursor', 'page', 'per_page', 'total', 'total_items', 'has_more'],
        ]);

        $contract = $response->json('data.0.public_contract');
        $this->assertSame($listing->id, $contract['id']);
        $this->assertSame((string) $listing->id, $contract['slug']);
        $this->assertSame('Repair a community bike', $contract['title']);
        $this->assertSame('A friendly public offer to repair a community bike.', $contract['description']);
        $this->assertSame('General', $contract['category']['name']);
        $this->assertSame('general', $contract['category']['slug']);
        $this->assertSame('Remote or local', $contract['location']['label']);
        $this->assertNull($contract['location']['latitude']);
        $this->assertNull($contract['location']['longitude']);
        $this->assertSame(2.5, (float) $contract['time_credit_value']['hours']);
        $this->assertSame('hour', $contract['time_credit_value']['unit']);
        $this->assertSame('Public Provider', $contract['provider']['display_name']);
    }

    public function test_public_index_omits_next_public_contract_without_explicit_flag(): void
    {
        $this->authenticatedUser();

        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id,
            'title' => 'Existing SPA payload stays unchanged',
            'status' => 'active',
            'moderation_status' => 'approved',
        ]);

        $response = $this->apiGet('/v2/listings?per_page=1');

        $response->assertOk();
        $this->assertArrayNotHasKey('public_contract', $response->json('data.0'));
    }

    public function test_index_returns_403_when_listings_module_disabled(): void
    {
        $this->authenticatedUser();

        DB::table('tenants')
            ->where('id', $this->testTenantId)
            ->update([
                'configuration' => json_encode(['modules' => ['listings' => false]]),
            ]);
        TenantContext::setById($this->testTenantId);

        $response = $this->apiGet('/v2/listings');

        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', 'MODULE_DISABLED');
    }

    public function test_index_rejects_per_page_above_max(): void
    {
        // ListListingsRequest caps per_page at 100.
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/listings?per_page=500');

        $response->assertStatus(422);
    }

    public function test_index_rejects_negative_page(): void
    {
        // ListListingsRequest requires page >= 1.
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/listings?page=0');

        $response->assertStatus(422);
    }

    public function test_index_accepts_valid_pagination(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/listings?page=1&per_page=10');

        $response->assertStatus(200);
    }

    public function test_index_supports_type_filter(): void
    {
        $user = $this->authenticatedUser();
        Listing::factory()->forTenant($this->testTenantId)->offer()->create(['user_id' => $user->id]);
        Listing::factory()->forTenant($this->testTenantId)->request()->create(['user_id' => $user->id]);

        $response = $this->apiGet('/v2/listings?type=offer');

        $response->assertStatus(200);
    }

    public function test_index_supports_search_query_parameter_alias(): void
    {
        $user = $this->authenticatedUser();
        Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id,
            'title' => 'Needle listing audit token',
            'description' => 'A unique service for search alias coverage.',
            'hours_estimate' => 1,
        ]);
        Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id,
            'title' => 'Unrelated haystack listing',
            'description' => 'This should not match the unique query.',
            'hours_estimate' => 1,
        ]);

        $response = $this->apiGet('/v2/listings?search=Needle%20listing%20audit%20token&min_hours=0.1');

        $response->assertStatus(200);
        $titles = collect($response->json('data'))->pluck('title')->all();
        $this->assertContains('Needle listing audit token', $titles);
        $this->assertNotContains('Unrelated haystack listing', $titles);
    }

    public function test_index_can_filter_to_coordinate_backed_results_for_map_view(): void
    {
        $user = $this->authenticatedUser();
        Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id,
            'title' => 'Dublin listing without map coordinates',
            'description' => 'A Dublin text-location listing that cannot be placed on a map.',
            'location' => 'Dublin',
            'latitude' => null,
            'longitude' => null,
        ]);
        Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id,
            'title' => 'Dublin listing with map coordinates',
            'description' => 'A Dublin listing that can be placed on the map.',
            'location' => 'Dublin',
            'latitude' => 53.3498,
            'longitude' => -6.2603,
        ]);

        $response = $this->apiGet('/v2/listings?q=Dublin&with_coordinates=1&per_page=100&personalised=false');

        $response->assertStatus(200);
        $titles = collect($response->json('data'))->pluck('title')->all();
        $this->assertContains('Dublin listing with map coordinates', $titles);
        $this->assertNotContains('Dublin listing without map coordinates', $titles);
        collect($response->json('data'))->each(function (array $listing): void {
            $this->assertNotNull($listing['latitude'] ?? null);
            $this->assertNotNull($listing['longitude'] ?? null);
        });
    }

    public function test_index_returns_empty_for_unknown_category_slug(): void
    {
        $user = $this->authenticatedUser();
        Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id,
            'title' => 'Visible listing with no matching category slug',
        ]);

        $response = $this->apiGet('/v2/listings?category=missing-category-audit-slug');

        $response->assertStatus(200);
        $this->assertSame([], $response->json('data'));
        $this->assertSame(0, $response->json('meta.total_items'));
    }

    // ================================================================
    // INDEX — Tenant isolation
    // ================================================================

    public function test_index_only_returns_current_tenant_listings(): void
    {
        $user = $this->authenticatedUser();
        Listing::factory()->forTenant($this->testTenantId)->count(2)->create(['user_id' => $user->id]);

        // Create listings for a different tenant
        DB::table('tenants')->insertOrIgnore([
            'id' => 999, 'name' => 'Other', 'slug' => 'other',
            'is_active' => true, 'depth' => 0, 'allows_subtenants' => false,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $otherUser = User::factory()->forTenant(999)->create();
        Listing::factory()->forTenant(999)->count(3)->create(['user_id' => $otherUser->id]);

        $response = $this->apiGet('/v2/listings');

        $response->assertStatus(200);
        $data = $response->json('data');
        $this->assertIsArray($data);
        // All returned listings should belong to test tenant
        foreach ($data as $listing) {
            if (isset($listing['tenant_id'])) {
                $this->assertEquals($this->testTenantId, $listing['tenant_id']);
            }
        }
    }

    public function test_index_hides_listings_pending_moderation(): void
    {
        $user = $this->authenticatedUser();
        Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id,
            'title' => 'Visible approved listing',
            'status' => 'active',
            'moderation_status' => 'approved',
        ]);
        Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id,
            'title' => 'Hidden pending review listing',
            'status' => 'active',
            'moderation_status' => 'pending_review',
        ]);

        $response = $this->apiGet('/v2/listings?search=listing&min_hours=0.1');

        $response->assertStatus(200);
        $titles = collect($response->json('data'))->pluck('title')->all();
        $this->assertContains('Visible approved listing', $titles);
        $this->assertNotContains('Hidden pending review listing', $titles);
    }

    // ================================================================
    // SHOW — Happy path
    // ================================================================

    public function test_show_returns_listing_with_data_envelope(): void
    {
        $user = $this->authenticatedUser();
        $listing = Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id,
        ]);

        $response = $this->apiGet("/v2/listings/{$listing->id}");

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_public_show_returns_gallery_and_full_next_public_contract_when_opted_in(): void
    {
        $this->authenticatedUser();

        $user = User::factory()->forTenant($this->testTenantId)->create([
            'first_name' => 'Gallery',
            'last_name' => 'Provider',
            'status' => 'active',
            'is_approved' => true,
        ]);
        $this->ensureListingCategory();
        $listing = Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id,
            'category_id' => 1,
            'title' => 'Garden mentoring',
            'description' => 'Detailed public description for a gardening skills exchange.',
            'image_url' => '/uploads/tenants/hour-timebank/listings/garden-cover.jpg',
            'location' => 'Online',
            'hours_estimate' => 1.25,
            'status' => 'active',
            'moderation_status' => 'approved',
        ]);
        DB::table('listing_images')->insert([
            [
                'tenant_id' => $this->testTenantId,
                'listing_id' => $listing->id,
                'image_url' => '/uploads/tenants/hour-timebank/listings/garden-1.jpg',
                'sort_order' => 0,
                'alt_text' => 'Raised beds',
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'tenant_id' => $this->testTenantId,
                'listing_id' => $listing->id,
                'image_url' => '/uploads/tenants/hour-timebank/listings/garden-2.jpg',
                'sort_order' => 1,
                'alt_text' => 'Seedlings',
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        $response = $this->apiGet("/v2/listings/{$listing->id}", [
            'X-Public-Contract' => '1',
        ]);

        $response->assertOk();
        $contract = $response->json('data.public_contract');
        $this->assertSame('Garden mentoring', $contract['title']);
        $this->assertSame('/uploads/tenants/hour-timebank/listings/garden-cover.jpg', $contract['primary_image']['url']);
        $this->assertSame('Garden mentoring', $contract['primary_image']['alt_text']);
        $this->assertCount(2, $contract['gallery']);
        $this->assertSame('/uploads/tenants/hour-timebank/listings/garden-1.jpg', $contract['gallery'][0]['url']);
        $this->assertSame('Gallery Provider', $contract['provider']['display_name']);
        $this->assertSame('active', $contract['status']);
    }

    public function test_public_show_omits_next_public_contract_without_explicit_flag(): void
    {
        $this->authenticatedUser();

        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $listing = Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id,
            'title' => 'Existing detail payload stays unchanged',
            'status' => 'active',
            'moderation_status' => 'approved',
        ]);

        $response = $this->apiGet("/v2/listings/{$listing->id}");

        $response->assertOk();
        $this->assertArrayNotHasKey('public_contract', $response->json('data'));
    }

    // ================================================================
    // SHOW — Not found
    // ================================================================

    public function test_show_returns_404_for_nonexistent_listing(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/listings/999999');

        $response->assertStatus(404);
    }

    // ================================================================
    // STORE — Happy path
    // ================================================================

    public function test_store_creates_listing_and_returns_201(): void
    {
        Event::fake([ListingCreated::class]);
        $user = $this->authenticatedUser(['email' => '']);

        // Ensure a category exists for the listing
        $this->ensureListingCategory();

        $response = $this->apiPost('/v2/listings', [
            'title' => 'Test Listing',
            'description' => 'A detailed description of the service offered.',
            'type' => 'offer',
            'category_id' => 1,
            'location' => 'Dublin',
            'price' => 2.0,
            'service_type' => 'physical_only',
        ]);

        $this->assertContains($response->getStatusCode(), [200, 201]);
        Event::assertDispatched(ListingCreated::class);
    }

    public function test_store_replays_the_original_listing_after_an_accepted_response_is_lost(): void
    {
        Event::fake([ListingCreated::class]);
        $user = $this->authenticatedUser(['email' => '']);
        $this->ensureListingCategory();
        $payload = [
            'title' => 'Durable garden help',
            'description' => 'A detailed listing whose first response was lost.',
            'type' => 'offer',
            'category_id' => 1,
            'service_type' => 'hybrid',
            'idempotency_key' => 'listing-create-response-loss-1',
        ];
        $headers = ['Idempotency-Key' => 'listing-create-response-loss-1'];

        $first = $this->apiPost('/v2/listings', $payload, $headers)->assertCreated();
        $second = $this->apiPost('/v2/listings', $payload, $headers)->assertOk();

        $this->assertSame($first->json('data.id'), $second->json('data.id'));
        $this->assertSame(1, Listing::query()
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)
            ->where('title', 'Durable garden help')
            ->count());
        $this->assertDatabaseCount('listing_creation_receipts', 1);
        Event::assertDispatchedTimes(ListingCreated::class, 1);
    }

    public function test_store_rejects_changed_content_under_the_same_creation_key(): void
    {
        Event::fake([ListingCreated::class]);
        $this->authenticatedUser(['email' => '']);
        $this->ensureListingCategory();
        $payload = [
            'title' => 'Original listing intent',
            'description' => 'The first exact listing content for this operation.',
            'type' => 'offer',
            'category_id' => 1,
            'service_type' => 'hybrid',
            'idempotency_key' => 'listing-create-conflict-1',
        ];
        $headers = ['Idempotency-Key' => 'listing-create-conflict-1'];

        $this->apiPost('/v2/listings', $payload, $headers)->assertCreated();
        $payload['title'] = 'Changed listing intent';
        $this->apiPost('/v2/listings', $payload, $headers)
            ->assertStatus(409)
            ->assertJsonPath('errors.0.code', 'IDEMPOTENCY_CONFLICT');

        $this->assertDatabaseMissing('listings', ['title' => 'Changed listing intent']);
    }

    public function test_store_marks_listing_pending_when_moderation_is_enabled(): void
    {
        $this->markTestSkipped(
            'Quarantine [isolation-debt]: order-dependent — passes in full-suite run order, fails when run in a sharded subset under CI. Re-enable after fixing test isolation. Tracked in PR #130.'
        );

        Event::fake([ListingCreated::class]);
        $this->authenticatedUser(['email' => '']);
        $this->ensureListingCategory();
        ListingConfigurationService::set(ListingConfigurationService::CONFIG_MODERATION_ENABLED, true);

        $response = $this->apiPost('/v2/listings', [
            'title' => 'Needs Review',
            'description' => 'A detailed listing that should enter moderation review.',
            'type' => 'offer',
            'category_id' => 1,
            'service_type' => 'physical_only',
        ]);

        $this->assertContains($response->getStatusCode(), [200, 201]);
        $listingId = $response->json('data.id');
        $this->assertDatabaseHas('listings', [
            'id' => $listingId,
            'status' => 'pending',
            'moderation_status' => 'pending_review',
        ]);
    }

    public function test_store_rejects_non_listing_category(): void
    {
        $this->authenticatedUser(['email' => '']);
        DB::table('categories')->insertOrIgnore([
            'id' => 91001,
            'tenant_id' => $this->testTenantId,
            'name' => 'Events',
            'slug' => 'events-only',
            'type' => 'event',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->apiPost('/v2/listings', [
            'title' => 'Wrong Category',
            'description' => 'This listing uses a category from another module.',
            'type' => 'offer',
            'category_id' => 91001,
            'service_type' => 'physical_only',
        ]);

        $response->assertStatus(422);
    }

    public function test_store_enforces_offer_type_toggle(): void
    {
        $this->markTestSkipped(
            'Quarantine [isolation-debt]: order-dependent — passes in full-suite run order, fails when run in a sharded subset under CI. Re-enable after fixing test isolation. Tracked in PR #130.'
        );

        $this->authenticatedUser(['email' => '']);
        $this->ensureListingCategory();
        ListingConfigurationService::set(ListingConfigurationService::CONFIG_ALLOW_OFFERS, false);
        ListingConfigurationService::set(ListingConfigurationService::CONFIG_ALLOW_REQUESTS, true);

        $response = $this->apiPost('/v2/listings', [
            'title' => 'Offer Disabled',
            'description' => 'Offers are disabled by tenant listing configuration.',
            'type' => 'offer',
            'category_id' => 1,
            'service_type' => 'physical_only',
        ]);

        $response->assertStatus(422);
    }

    public function test_store_enforces_max_listings_per_user(): void
    {
        $this->markTestSkipped(
            'Quarantine [isolation-debt]: order-dependent — passes in full-suite run order, fails when run in a sharded subset under CI. Re-enable after fixing test isolation. Tracked in PR #130.'
        );

        $user = $this->authenticatedUser(['email' => '']);
        $this->ensureListingCategory();
        ListingConfigurationService::set(ListingConfigurationService::CONFIG_MAX_PER_USER, 1);
        Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id,
            'status' => 'active',
        ]);

        $response = $this->apiPost('/v2/listings', [
            'title' => 'Too Many Listings',
            'description' => 'This listing exceeds the configured maximum per user.',
            'type' => 'offer',
            'category_id' => 1,
            'service_type' => 'physical_only',
        ]);

        $response->assertStatus(422);
    }

    // ================================================================
    // STORE — Authentication required (401)
    // ================================================================

    public function test_store_returns_401_without_auth(): void
    {
        $response = $this->apiPost('/v2/listings', [
            'title' => 'Unauthorized',
            'description' => 'Should fail',
            'type' => 'offer',
        ]);

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    // ================================================================
    // STORE — Validation errors (422)
    // ================================================================

    public function test_store_returns_validation_error_without_required_fields(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/listings', [
            'type' => 'offer',
        ]);

        $this->assertContains($response->getStatusCode(), [400, 422]);
    }

    // ================================================================
    // UPDATE — Happy path
    // ================================================================

    public function test_owner_can_update_listing(): void
    {
        $user = $this->authenticatedUser();
        $listing = Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id,
            'title' => 'Original',
        ]);

        $response = $this->apiPut("/v2/listings/{$listing->id}", [
            'title' => 'Updated Title',
            'description' => $listing->description,
            'type' => $listing->type,
        ]);

        $response->assertStatus(200);
    }

    public function test_owner_can_pause_listing(): void
    {
        $user = $this->authenticatedUser();
        $listing = Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id,
            'status' => 'active',
        ]);

        $response = $this->apiPut("/v2/listings/{$listing->id}", [
            'status' => 'paused',
        ]);

        $response->assertStatus(200);
        $this->assertDatabaseHas('listings', [
            'id' => $listing->id,
            'tenant_id' => $this->testTenantId,
            'status' => 'paused',
        ]);
    }

    public function test_owner_cannot_reactivate_rejected_listing(): void
    {
        $user = $this->authenticatedUser();
        $listing = Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id,
            'status' => 'rejected',
            'moderation_status' => 'rejected',
        ]);

        $response = $this->apiPut("/v2/listings/{$listing->id}", [
            'status' => 'active',
        ]);

        $response->assertStatus(422);
        $this->assertDatabaseHas('listings', [
            'id' => $listing->id,
            'status' => 'rejected',
            'moderation_status' => 'rejected',
        ]);
    }

    // ================================================================
    // UPDATE — Authorization (403)
    // ================================================================

    public function test_non_owner_cannot_update_listing(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $listing = Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $owner->id,
        ]);

        $this->authenticatedUser();

        $response = $this->apiPut("/v2/listings/{$listing->id}", [
            'title' => 'Hijacked',
        ]);

        $response->assertStatus(403);
    }

    // ================================================================
    // UPDATE — Not found (404)
    // ================================================================

    public function test_update_returns_404_for_nonexistent_listing(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPut('/v2/listings/999999', [
            'title' => 'Ghost',
        ]);

        $response->assertStatus(404);
    }

    // ================================================================
    // DELETE — Happy path
    // ================================================================

    public function test_owner_can_delete_listing(): void
    {
        $user = $this->authenticatedUser();
        $listing = Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id,
        ]);

        $response = $this->apiDelete("/v2/listings/{$listing->id}");

        $this->assertContains($response->getStatusCode(), [200, 204]);
    }

    // ================================================================
    // DELETE — Authorization (403)
    // ================================================================

    public function test_non_owner_cannot_delete_listing(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $listing = Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $owner->id,
        ]);

        $this->authenticatedUser();

        $response = $this->apiDelete("/v2/listings/{$listing->id}");

        $response->assertStatus(403);
    }

    // ================================================================
    // DELETE — Not found (404)
    // ================================================================

    public function test_delete_returns_404_for_nonexistent_listing(): void
    {
        $this->authenticatedUser();

        $response = $this->apiDelete('/v2/listings/999999');

        $response->assertStatus(404);
    }

    // ================================================================
    // DELETE — Authentication required (401)
    // ================================================================

    public function test_delete_returns_401_without_auth(): void
    {
        $response = $this->apiDelete('/v2/listings/1');

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    // ================================================================
    // SAVED LISTINGS — Auth required
    // ================================================================

    public function test_saved_listings_requires_auth(): void
    {
        $response = $this->apiGet('/v2/listings/saved');

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    public function test_saved_listings_returns_data_when_authenticated(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/listings/saved');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    // ================================================================
    // SAVE / UNSAVE
    // ================================================================

    public function test_save_listing_requires_auth(): void
    {
        $response = $this->apiPost('/v2/listings/1/save');

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    public function test_duplicate_save_does_not_increment_save_count_twice(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $listing = Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $owner->id,
            'save_count' => 0,
        ]);
        $this->authenticatedUser();

        $first = $this->apiPost("/v2/listings/{$listing->id}/save");
        $second = $this->apiPost("/v2/listings/{$listing->id}/save");

        $first->assertStatus(200);
        $second->assertStatus(200);
        $this->assertSame(1, (int) DB::table('listings')->where('id', $listing->id)->value('save_count'));
    }

    public function test_unsave_without_saved_record_does_not_decrement_save_count(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $listing = Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $owner->id,
            'save_count' => 3,
        ]);
        $this->authenticatedUser();

        $response = $this->apiDelete("/v2/listings/{$listing->id}/save");

        $response->assertStatus(200);
        $this->assertSame(3, (int) DB::table('listings')->where('id', $listing->id)->value('save_count'));
    }

    // ================================================================
    // FEATURED
    // ================================================================

    public function test_featured_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/listings/featured');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    // ================================================================
    // POPULAR TAGS
    // ================================================================

    public function test_popular_tags_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/listings/tags/popular');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    // ================================================================
    // AUTOCOMPLETE TAGS — short query returns empty
    // ================================================================

    public function test_autocomplete_tags_returns_empty_for_short_query(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/listings/tags/autocomplete?q=a');

        $response->assertStatus(200);
        $response->assertJson(['data' => []]);
    }

    // ================================================================
    // NEARBY — Validation
    // ================================================================

    public function test_nearby_returns_400_without_coordinates(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/listings/nearby');

        $response->assertStatus(400);
    }

    public function test_nearby_returns_400_for_invalid_latitude(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/listings/nearby?lat=999&lon=0');

        $response->assertStatus(400);
    }

    public function test_nearby_returns_data_with_valid_coordinates(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/listings/nearby?lat=53.35&lon=-6.26');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    // ================================================================
    // NEARBY — Radius filter actually filters (regression guard)
    // ================================================================

    public function test_index_with_near_lat_excludes_distant_listings(): void
    {
        // Dublin city centre ≈ 53.3498, -6.2603
        // Cork city centre ≈ 51.8985, -8.4756  (~258 km away)
        $user = $this->authenticatedUser();
        $this->ensureListingCategory();

        $near = Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id'   => $user->id,
            'title'     => 'Near Dublin listing',
            'status'    => 'active',
            'latitude'  => 53.3490,
            'longitude' => -6.2600,
        ]);

        $far = Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id'   => $user->id,
            'title'     => 'Far Cork listing',
            'status'    => 'active',
            'latitude'  => 51.8985,
            'longitude' => -8.4756,
        ]);

        // 10 km radius centred on Dublin — Cork must be excluded
        $response = $this->apiGet('/v2/listings?near_lat=53.3498&near_lng=-6.2603&radius_km=10');

        $response->assertStatus(200);
        $data = collect($response->json('data'));

        $ids = $data->pluck('id');
        $this->assertTrue($ids->contains($near->id), 'Nearby listing should be included in results');
        $this->assertFalse($ids->contains($far->id), 'Distant listing (Cork) must be excluded by radius filter');
    }

    public function test_nearby_endpoint_excludes_distant_listings(): void
    {
        $user = $this->authenticatedUser();
        $this->ensureListingCategory();

        $near = Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id'   => $user->id,
            'title'     => 'Near Dublin listing',
            'status'    => 'active',
            'latitude'  => 53.3490,
            'longitude' => -6.2600,
        ]);

        $far = Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id'   => $user->id,
            'title'     => 'Far Cork listing',
            'status'    => 'active',
            'latitude'  => 51.8985,
            'longitude' => -8.4756,
        ]);

        $response = $this->apiGet('/v2/listings/nearby?lat=53.3498&lon=-6.2603&radius_km=10');

        $response->assertStatus(200);
        $data = collect($response->json('data'));

        $ids = $data->pluck('id');
        $this->assertTrue($ids->contains($near->id), 'Nearby listing should appear in /nearby results');
        $this->assertFalse($ids->contains($far->id), 'Distant listing (Cork) must be excluded by /nearby radius filter');
    }

    // ================================================================
    // CROSS-TENANT ISOLATION — UPDATE
    // ================================================================

    public function test_user_cannot_update_listing_from_different_tenant(): void
    {
        // Create a listing in tenant 999 (the "other" tenant)
        $otherUser = User::factory()->forTenant(999)->create();
        $listing = Listing::factory()->forTenant(999)->create([
            'user_id' => $otherUser->id,
            'title' => 'Other Tenant Listing',
        ]);

        // Authenticate as a user in the default test tenant
        $this->authenticatedUser();

        $response = $this->apiPut("/v2/listings/{$listing->id}", [
            'title' => 'Cross-Tenant Hijack Attempt',
        ]);

        // Should be blocked — listing not visible to this tenant
        $this->assertContains($response->getStatusCode(), [403, 404]);
    }

    // ================================================================
    // CROSS-TENANT ISOLATION — DELETE
    // ================================================================

    public function test_user_cannot_delete_listing_from_different_tenant(): void
    {
        // Create a listing in tenant 999
        $otherUser = User::factory()->forTenant(999)->create();
        $listing = Listing::factory()->forTenant(999)->create([
            'user_id' => $otherUser->id,
        ]);

        // Authenticate as a user in the default test tenant
        $this->authenticatedUser();

        $response = $this->apiDelete("/v2/listings/{$listing->id}");

        // Should be blocked — listing not visible to this tenant
        $this->assertContains($response->getStatusCode(), [403, 404]);
    }

    // ================================================================
    // CROSS-TENANT ISOLATION — SAVED LISTINGS
    // ================================================================

    public function test_saved_listings_are_tenant_scoped(): void
    {
        // Create and save a listing in tenant 999
        $otherUser = User::factory()->forTenant(999)->create();
        $otherListing = Listing::factory()->forTenant(999)->create([
            'user_id' => $otherUser->id,
        ]);

        // Manually insert a saved-listing record for the other tenant
        DB::table('user_saved_listings')->insertOrIgnore([
            'user_id' => $otherUser->id,
            'listing_id' => $otherListing->id,
            'tenant_id' => 999,
            'created_at' => now(),
        ]);

        // Authenticate as a user in the default test tenant
        $user = $this->authenticatedUser();

        $response = $this->apiGet('/v2/listings/saved');

        $response->assertStatus(200);

        // The saved listings response should not include the other tenant's listing
        $data = $response->json('data');
        $this->assertIsArray($data);
        foreach ($data as $saved) {
            if (isset($saved['id'])) {
                $this->assertNotEquals($otherListing->id, $saved['id']);
            }
        }
    }
}
