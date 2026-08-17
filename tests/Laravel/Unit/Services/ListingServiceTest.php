<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\ListingService;
use App\Core\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Queue;
use Illuminate\Validation\ValidationException;

/**
 * ListingServiceTest
 *
 * Strategy: test the main PUBLIC methods of ListingService against the real
 * MariaDB schema (tenant 2, DatabaseTransactions rollback after each test).
 *
 * Methods covered:
 *   - validate()          — pure validation logic, no DB needed
 *   - create()            — writes to listings, dispatches events + email (faked)
 *   - getById()           — read single listing, visibility / ownership guards
 *   - getAll()            — SQL path (Meilisearch unavailable in test env)
 *   - countAll()          — SQL path
 *   - getFeatured()       — is_featured flag
 *   - delete()            — soft-delete + orphan cleanup
 *   - update()            — field fill, status-transition guards
 *   - canModify()         — owner/admin checks
 *   - saveListing() / unsaveListing() / getSavedListingIds()
 *
 * Skipped with notes:
 *   - getNearby()           — requires real decimal lat/lon + MariaDB haversine HAVING clause.
 *                             The SQL path works; skipping because seeding reliable geodata for
 *                             haversine boundary tests needs careful precision and adds fragility
 *                             with no new logic coverage (same filter path as getAll).
 *   - search()              — thin wrapper around getAll(); covered implicitly by getAll tests.
 *   - Meilisearch code path — unavailable in test env; falls through to SQL path (covered).
 */
class ListingServiceTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 2;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById(self::TENANT_ID);
        // Fake only the application events we dispatch, so that Eloquent model
        // lifecycle events (creating / updating) still fire. If we call Event::fake()
        // without arguments it swallows ALL events, including the HasTenantScope
        // `creating` callback that auto-sets tenant_id — causing FK failures.
        Event::fake([
            \App\Events\ListingCreated::class,
            \App\Events\ListingUpdated::class,
        ]);

        // Prevent the sync queue from running ReindexEmbeddingJob (and other
        // observer-dispatched jobs) during tests. The AppServiceProvider registers
        // Queue::before/after hooks that call TenantContext::reset(), which resets
        // tenant context mid-test when any observer dispatches a queued job via the
        // sync driver — causing tenant-scoped DELETEs/SELECTs to use tenant_id=1
        // instead of 2 for the rest of the test method.
        Queue::fake();

        // Insert a fresh listing category so Rule::exists() validation in create() passes.
        // DatabaseTransactions rolls this back after every test.
        $uid = uniqid('cat', true);
        $this->categoryId = DB::table('categories')->insertGetId([
            'tenant_id'  => self::TENANT_ID,
            'name'       => 'Test Category ' . $uid,
            'slug'       => 'test-cat-' . $uid,
            'type'       => 'listing',
            'sort_order' => 0,
            'is_active'  => 1,
            'created_at' => now(),
        ]);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /**
     * Insert a minimal user row and return the inserted ID.
     */
    private function insertUser(array $overrides = []): int
    {
        $uid = uniqid('lsvc', true);
        return DB::table('users')->insertGetId(array_merge([
            'tenant_id'        => self::TENANT_ID,
            'name'             => 'LS Test User ' . $uid,
            'first_name'       => 'LS',
            'last_name'        => 'User',
            'email'            => 'lsvc.' . $uid . '@example.test',
            'status'           => 'active',
            'balance'          => 0.00,
            'role'             => 'member',
            'is_approved'      => 1,
            'is_verified'      => 0,
            'preferred_language' => 'en',
            'created_at'       => now(),
            'updated_at'       => now(),
        ], $overrides));
    }

    /**
     * Insert a minimal listing row (bypasses ListingService validation/events)
     * and return the inserted ID.
     */
    private function insertListing(int $userId, array $overrides = []): int
    {
        return DB::table('listings')->insertGetId(array_merge([
            'tenant_id'         => self::TENANT_ID,
            'user_id'           => $userId,
            'title'             => 'Test listing ' . uniqid(),
            'description'       => 'A description long enough to pass validation.',
            'type'              => 'offer',
            'status'            => 'active',
            'moderation_status' => 'approved',
            'service_type'      => 'physical_only',
            'federated_visibility' => 'none',
            'created_at'        => now(),
            'updated_at'        => now(),
        ], $overrides));
    }

    /** Category inserted fresh per-test so Rule::exists() is always satisfied. */
    private int $categoryId;

    /**
     * Build a minimal valid payload for ListingService::create().
     */
    private function validCreatePayload(array $overrides = []): array
    {
        return array_merge([
            'title'       => 'Valid listing title here',
            'description' => 'A description that is long enough to meet the minimum length.',
            'type'        => 'offer',
            'category_id' => $this->categoryId,
        ], $overrides);
    }

    // ── validate() ────────────────────────────────────────────────────────────

    public function test_validate_returns_true_for_valid_data(): void
    {
        $result = ListingService::validate(['title' => 'Test listing', 'type' => 'offer']);

        $this->assertTrue($result);
        $this->assertEmpty(ListingService::getErrors());
    }

    public function test_validate_returns_false_when_title_is_empty(): void
    {
        $result = ListingService::validate(['title' => '', 'type' => 'offer']);

        $this->assertFalse($result);
        $errors = ListingService::getErrors();
        $this->assertNotEmpty($errors);
        $this->assertSame('title', $errors[0]['field']);
    }

    public function test_validate_returns_false_when_title_exceeds_255_chars(): void
    {
        $result = ListingService::validate(['title' => str_repeat('x', 256), 'type' => 'offer']);

        $this->assertFalse($result);
        $errors = ListingService::getErrors();
        $this->assertNotEmpty($errors);
        $this->assertSame('title', $errors[0]['field']);
    }

    public function test_validate_returns_false_for_invalid_type(): void
    {
        $result = ListingService::validate(['title' => 'Good title', 'type' => 'invalid_type']);

        $this->assertFalse($result);
        $errors = ListingService::getErrors();
        $this->assertNotEmpty($errors);
        $this->assertSame('type', $errors[0]['field']);
    }

    public function test_validate_allows_request_type(): void
    {
        $result = ListingService::validate(['title' => 'Test', 'type' => 'request']);

        $this->assertTrue($result);
    }

    // ── create() ──────────────────────────────────────────────────────────────

    public function test_create_inserts_listing_and_returns_model(): void
    {
        $userId  = $this->insertUser();
        $payload = $this->validCreatePayload();

        $listing = ListingService::create($userId, $payload);

        $this->assertInstanceOf(\App\Models\Listing::class, $listing);
        $this->assertNotNull($listing->id);
        $this->assertSame($payload['title'], $listing->title);
        $this->assertSame(self::TENANT_ID, (int) $listing->tenant_id);
    }

    public function test_create_sets_tenant_id_automatically(): void
    {
        $userId  = $this->insertUser();
        $listing = ListingService::create($userId, $this->validCreatePayload());

        $row = DB::table('listings')->where('id', $listing->id)->first();
        $this->assertSame(self::TENANT_ID, (int) $row->tenant_id);
    }

    public function test_create_throws_validation_exception_for_missing_title(): void
    {
        $userId = $this->insertUser();

        $this->expectException(ValidationException::class);
        ListingService::create($userId, [
            'title'       => '',
            'description' => 'Long enough description to clear the min check.',
            'type'        => 'offer',
        ]);
    }

    public function test_create_throws_validation_exception_for_description_too_short(): void
    {
        $userId = $this->insertUser();

        $this->expectException(ValidationException::class);
        ListingService::create($userId, [
            'title'       => 'Valid title here',
            'description' => 'Too short',    // < 20 chars default min
            'type'        => 'offer',
        ]);
    }

    public function test_create_sets_initial_status_to_active_when_moderation_disabled(): void
    {
        // Default config has moderation_enabled => false
        $userId  = $this->insertUser();
        $listing = ListingService::create($userId, $this->validCreatePayload());

        $this->assertSame('active', $listing->status);
    }

    public function test_create_dispatches_listing_created_event(): void
    {
        $userId = $this->insertUser();
        ListingService::create($userId, $this->validCreatePayload());

        Event::assertDispatched(\App\Events\ListingCreated::class);
    }

    // ── getById() ─────────────────────────────────────────────────────────────

    public function test_getById_returns_array_for_active_listing(): void
    {
        $userId    = $this->insertUser();
        $listingId = $this->insertListing($userId);

        $result = ListingService::getById($listingId);

        $this->assertIsArray($result);
        $this->assertSame($listingId, (int) $result['id']);
    }

    public function test_getById_returns_null_for_nonexistent_listing(): void
    {
        $result = ListingService::getById(PHP_INT_MAX);

        $this->assertNull($result);
    }

    public function test_getById_returns_null_for_deleted_listing_by_default(): void
    {
        $userId    = $this->insertUser();
        $listingId = $this->insertListing($userId, ['status' => 'deleted']);

        $result = ListingService::getById($listingId);

        $this->assertNull($result);
    }

    public function test_getById_returns_listing_when_include_deleted_true(): void
    {
        $userId    = $this->insertUser();
        $listingId = $this->insertListing($userId, ['status' => 'deleted']);

        // includeDeleted=true, but the visibility check for non-active listings
        // also requires currentUserId to equal the owner
        $result = ListingService::getById($listingId, includeDeleted: true, currentUserId: $userId);

        $this->assertIsArray($result);
        $this->assertSame($listingId, (int) $result['id']);
    }

    public function test_getById_hides_pending_listing_from_non_owner(): void
    {
        $owner     = $this->insertUser();
        $viewer    = $this->insertUser();
        $listingId = $this->insertListing($owner, ['status' => 'pending']);

        $result = ListingService::getById($listingId, currentUserId: $viewer);

        $this->assertNull($result);
    }

    public function test_getById_shows_pending_listing_to_owner(): void
    {
        $owner     = $this->insertUser();
        $listingId = $this->insertListing($owner, ['status' => 'pending']);

        $result = ListingService::getById($listingId, currentUserId: $owner);

        $this->assertIsArray($result);
        $this->assertSame($listingId, (int) $result['id']);
    }

    public function test_getById_hides_rejected_moderation_listing_from_non_owner(): void
    {
        $owner     = $this->insertUser();
        $viewer    = $this->insertUser();
        $listingId = $this->insertListing($owner, [
            'status'            => 'active',
            'moderation_status' => 'rejected',
        ]);

        $result = ListingService::getById($listingId, currentUserId: $viewer);

        $this->assertNull($result);
    }

    public function test_getById_includes_is_favorited_false_for_authenticated_user(): void
    {
        $owner     = $this->insertUser();
        $viewer    = $this->insertUser();
        $listingId = $this->insertListing($owner);

        $result = ListingService::getById($listingId, currentUserId: $viewer);

        $this->assertArrayHasKey('is_favorited', $result);
        $this->assertFalse($result['is_favorited']);
    }

    // ── getAll() ──────────────────────────────────────────────────────────────

    public function test_getAll_returns_expected_shape(): void
    {
        $userId = $this->insertUser();
        $this->insertListing($userId);

        $result = ListingService::getAll(['limit' => 5]);

        $this->assertIsArray($result);
        $this->assertArrayHasKey('items', $result);
        $this->assertArrayHasKey('cursor', $result);
        $this->assertArrayHasKey('has_more', $result);
    }

    /**
     * Regression: the list path returned only `user.name`, never `author_name`.
     * The React listing cards read `author_name`, so every card in the grid showed
     * the generic "User" fallback label instead of the member's name.
     */
    public function test_getAll_includes_author_name_and_avatar(): void
    {
        $userId = $this->insertUser([
            'first_name' => 'Aoife',
            'last_name'  => 'Nolan',
            'avatar_url' => 'https://example.test/avatar.png',
        ]);
        $this->insertListing($userId);

        $result = ListingService::getAll(['user_id' => $userId]);

        $this->assertNotEmpty($result['items']);
        $item = $result['items'][0];
        $this->assertSame('Aoife Nolan', $item['author_name']);
        $this->assertSame('https://example.test/avatar.png', $item['author_avatar']);
        $this->assertSame('Aoife Nolan', $item['user']['name']);
    }

    public function test_getAll_uses_organisation_name_as_author_name(): void
    {
        $userId = $this->insertUser([
            'first_name'        => 'Contact',
            'last_name'         => 'Person',
            'profile_type'      => 'organisation',
            'organization_name' => 'Dunmanway Community Hub',
        ]);
        $this->insertListing($userId);

        $result = ListingService::getAll(['user_id' => $userId]);

        $this->assertSame('Dunmanway Community Hub', $result['items'][0]['author_name']);
    }

    public function test_getAll_only_returns_active_approved_listings(): void
    {
        $userId  = $this->insertUser();
        $activeId  = $this->insertListing($userId);
        $deletedId = $this->insertListing($userId, ['status' => 'deleted']);
        $pausedId  = $this->insertListing($userId, ['status' => 'paused']);

        $result = ListingService::getAll(['user_id' => $userId]);

        $returnedIds = array_column($result['items'], 'id');
        $returnedIds = array_map('intval', $returnedIds);

        $this->assertContains($activeId, $returnedIds);
        $this->assertNotContains($deletedId, $returnedIds);
        $this->assertNotContains($pausedId, $returnedIds);
    }

    public function test_getAll_filters_by_type(): void
    {
        $userId    = $this->insertUser();
        $offerId   = $this->insertListing($userId, ['type' => 'offer']);
        $requestId = $this->insertListing($userId, ['type' => 'request']);

        $result = ListingService::getAll(['user_id' => $userId, 'type' => 'offer']);

        $returnedIds = array_map('intval', array_column($result['items'], 'id'));

        $this->assertContains($offerId, $returnedIds);
        $this->assertNotContains($requestId, $returnedIds);
    }

    public function test_getAll_filters_by_user_id(): void
    {
        $user1 = $this->insertUser();
        $user2 = $this->insertUser();
        $l1    = $this->insertListing($user1);
        $l2    = $this->insertListing($user2);

        $result = ListingService::getAll(['user_id' => $user1]);

        $returnedIds = array_map('intval', array_column($result['items'], 'id'));

        $this->assertContains($l1, $returnedIds);
        $this->assertNotContains($l2, $returnedIds);
    }

    public function test_getAll_search_matches_title(): void
    {
        $userId      = $this->insertUser();
        $matchId     = $this->insertListing($userId, ['title' => 'UniqueXyzSearchableTitleABC']);
        $noMatchId   = $this->insertListing($userId, ['title' => 'Completely different title']);

        // Meilisearch is unavailable in test → falls through to SQL LIKE path
        $result = ListingService::getAll(['search' => 'UniqueXyz', 'user_id' => $userId]);

        $returnedIds = array_map('intval', array_column($result['items'], 'id'));

        $this->assertContains($matchId, $returnedIds);
        $this->assertNotContains($noMatchId, $returnedIds);
    }

    public function test_getAll_respects_limit(): void
    {
        $userId = $this->insertUser();
        for ($i = 0; $i < 5; $i++) {
            $this->insertListing($userId);
        }

        $result = ListingService::getAll(['user_id' => $userId, 'limit' => 3]);

        $this->assertCount(3, $result['items']);
        $this->assertTrue($result['has_more']);
        $this->assertNotNull($result['cursor']);
    }

    public function test_getAll_cursor_pagination_returns_next_page(): void
    {
        $userId = $this->insertUser();
        for ($i = 0; $i < 4; $i++) {
            $this->insertListing($userId);
        }

        $page1 = ListingService::getAll(['user_id' => $userId, 'limit' => 2]);
        $this->assertTrue($page1['has_more']);
        $this->assertNotNull($page1['cursor']);

        $page2 = ListingService::getAll(['user_id' => $userId, 'limit' => 2, 'cursor' => $page1['cursor']]);
        $this->assertNotEmpty($page2['items']);

        // No overlap between pages
        $ids1 = array_column($page1['items'], 'id');
        $ids2 = array_column($page2['items'], 'id');
        $this->assertEmpty(array_intersect($ids1, $ids2));
    }

    // ── countAll() ────────────────────────────────────────────────────────────

    public function test_countAll_counts_active_listings_for_user(): void
    {
        $userId = $this->insertUser();
        $this->insertListing($userId);
        $this->insertListing($userId);
        $this->insertListing($userId, ['status' => 'deleted']);

        $count = ListingService::countAll(['user_id' => $userId]);

        // Only the 2 active/approved ones
        $this->assertSame(2, $count);
    }

    public function test_countAll_returns_zero_for_user_with_no_active_listings(): void
    {
        $userId = $this->insertUser();
        $this->insertListing($userId, ['status' => 'deleted']);

        $count = ListingService::countAll(['user_id' => $userId]);

        $this->assertSame(0, $count);
    }

    // ── getFeatured() ─────────────────────────────────────────────────────────

    public function test_getFeatured_returns_only_featured_active_listings(): void
    {
        $userId      = $this->insertUser();
        $featuredId  = $this->insertListing($userId, ['is_featured' => 1, 'featured_until' => null]);
        $regularId   = $this->insertListing($userId, ['is_featured' => 0]);

        $items = ListingService::getFeatured(50);
        $returnedIds = array_map('intval', array_column($items, 'id'));

        $this->assertContains($featuredId, $returnedIds);
        $this->assertNotContains($regularId, $returnedIds);
    }

    public function test_getFeatured_excludes_expired_featured_listings(): void
    {
        $userId     = $this->insertUser();
        $expiredId  = $this->insertListing($userId, [
            'is_featured'   => 1,
            'featured_until' => now()->subDay()->format('Y-m-d H:i:s'),
        ]);

        $items = ListingService::getFeatured(50);
        $returnedIds = array_map('intval', array_column($items, 'id'));

        $this->assertNotContains($expiredId, $returnedIds);
    }

    // ── delete() ──────────────────────────────────────────────────────────────

    public function test_delete_soft_deletes_by_setting_status_to_deleted(): void
    {
        $userId    = $this->insertUser();
        $listingId = $this->insertListing($userId);

        $result = ListingService::delete($listingId);

        $this->assertTrue($result);

        $row = DB::table('listings')->where('id', $listingId)->first();
        $this->assertSame('deleted', $row->status);
    }

    public function test_delete_returns_false_for_nonexistent_listing(): void
    {
        $result = ListingService::delete(PHP_INT_MAX - 1);

        $this->assertFalse($result);
    }

    public function test_delete_removes_saved_listing_rows(): void
    {
        $userId    = $this->insertUser();
        $listingId = $this->insertListing($userId);

        DB::table('user_saved_listings')->insertOrIgnore([
            'user_id'    => $userId,
            'listing_id' => $listingId,
            'tenant_id'  => self::TENANT_ID,
        ]);

        ListingService::delete($listingId);

        $remaining = DB::table('user_saved_listings')
            ->where('listing_id', $listingId)
            ->where('tenant_id', self::TENANT_ID)
            ->count();

        $this->assertSame(0, $remaining);
    }

    // ── update() ──────────────────────────────────────────────────────────────

    public function test_update_changes_title(): void
    {
        $userId    = $this->insertUser();
        $listingId = $this->insertListing($userId);

        $updated = ListingService::update($listingId, ['title' => 'Brand new title update here']);

        $this->assertSame('Brand new title update here', $updated->title);
    }

    public function test_update_throws_for_invalid_status(): void
    {
        $userId    = $this->insertUser();
        $listingId = $this->insertListing($userId);

        $this->expectException(ValidationException::class);
        ListingService::update($listingId, ['status' => 'deleted']);   // 'deleted' not in allowed set
    }

    public function test_update_allows_valid_status_paused_by_non_admin(): void
    {
        $userId    = $this->insertUser();
        $listingId = $this->insertListing($userId);

        $updated = ListingService::update($listingId, ['status' => 'paused']);

        $this->assertSame('paused', $updated->status);
    }

    public function test_update_throws_when_non_admin_tries_to_set_suspended_status(): void
    {
        $userId    = $this->insertUser();
        $listingId = $this->insertListing($userId);

        $this->expectException(ValidationException::class);
        ListingService::update($listingId, ['status' => 'suspended'], isAdmin: false);
    }

    public function test_update_throws_model_not_found_for_nonexistent_id(): void
    {
        $this->expectException(\Illuminate\Database\Eloquent\ModelNotFoundException::class);
        ListingService::update(PHP_INT_MAX, ['title' => 'Anything here for test']);
    }

    // ── canModify() ───────────────────────────────────────────────────────────

    public function test_canModify_returns_true_for_owner(): void
    {
        $userId = $this->insertUser();
        $result = ListingService::canModify(['user_id' => $userId], $userId);

        $this->assertTrue($result);
    }

    public function test_canModify_returns_false_for_non_owner_non_admin(): void
    {
        $owner  = $this->insertUser();
        $viewer = $this->insertUser();
        $result = ListingService::canModify(['user_id' => $owner], $viewer);

        $this->assertFalse($result);
    }

    public function test_canModify_returns_true_for_admin_user(): void
    {
        $owner   = $this->insertUser();
        $adminId = $this->insertUser(['role' => 'admin']);
        $result  = ListingService::canModify(['user_id' => $owner], $adminId);

        $this->assertTrue($result);
    }

    // ── saveListing() / unsaveListing() / getSavedListingIds() ───────────────

    public function test_saveListing_inserts_row_and_returns_true(): void
    {
        $userId    = $this->insertUser();
        $listingId = $this->insertListing($userId);

        $result = ListingService::saveListing($userId, $listingId);

        $this->assertTrue($result);

        $exists = DB::table('user_saved_listings')
            ->where('user_id', $userId)
            ->where('listing_id', $listingId)
            ->where('tenant_id', self::TENANT_ID)
            ->exists();
        $this->assertTrue($exists);
    }

    public function test_saveListing_is_idempotent(): void
    {
        $userId    = $this->insertUser();
        $listingId = $this->insertListing($userId);

        ListingService::saveListing($userId, $listingId);
        ListingService::saveListing($userId, $listingId);   // should not throw

        $count = DB::table('user_saved_listings')
            ->where('user_id', $userId)
            ->where('listing_id', $listingId)
            ->where('tenant_id', self::TENANT_ID)
            ->count();
        $this->assertSame(1, $count);
    }

    public function test_saveListing_returns_false_for_deleted_listing(): void
    {
        $userId    = $this->insertUser();
        $listingId = $this->insertListing($userId, ['status' => 'deleted']);

        // saveListing checks that status == 'active'
        $result = ListingService::saveListing($userId, $listingId);

        $this->assertFalse($result);
    }

    public function test_unsaveListing_removes_row(): void
    {
        $userId    = $this->insertUser();
        $listingId = $this->insertListing($userId);

        DB::table('user_saved_listings')->insertOrIgnore([
            'user_id'    => $userId,
            'listing_id' => $listingId,
            'tenant_id'  => self::TENANT_ID,
        ]);

        ListingService::unsaveListing($userId, $listingId);

        $exists = DB::table('user_saved_listings')
            ->where('user_id', $userId)
            ->where('listing_id', $listingId)
            ->exists();
        $this->assertFalse($exists);
    }

    public function test_getSavedListingIds_returns_correct_ids(): void
    {
        $userId = $this->insertUser();
        $l1     = $this->insertListing($userId);
        $l2     = $this->insertListing($userId);

        DB::table('user_saved_listings')->insertOrIgnore([
            ['user_id' => $userId, 'listing_id' => $l1, 'tenant_id' => self::TENANT_ID],
            ['user_id' => $userId, 'listing_id' => $l2, 'tenant_id' => self::TENANT_ID],
        ]);

        $ids = ListingService::getSavedListingIds($userId);

        $this->assertContains($l1, $ids);
        $this->assertContains($l2, $ids);
        $this->assertCount(2, $ids);
    }

    public function test_getSavedListingIds_returns_empty_array_when_no_saves(): void
    {
        $userId = $this->insertUser();

        $ids = ListingService::getSavedListingIds($userId);

        $this->assertIsArray($ids);
        $this->assertEmpty($ids);
    }
}
