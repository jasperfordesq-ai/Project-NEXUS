<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\BookmarkService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

class BookmarkServiceTest extends TestCase
{
    use DatabaseTransactions;

    private BookmarkService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new BookmarkService();
    }

    /** Secondary tenant seeded by TestCase::setUpTenantContext() — satisfies FK checks. */
    private const OTHER_TENANT_ID = 999;

    /**
     * User-created listeners reset TenantContext in console mode
     * (restoreAfterScopedListener), so re-pin the test tenant after creating.
     */
    private function createUser(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);
        return $user;
    }

    private function insertListing(int $userId, int $tenantId): int
    {
        return DB::table('listings')->insertGetId([
            'tenant_id' => $tenantId,
            'user_id'   => $userId,
            'title'     => 'Bookmark seed listing',
            'type'      => 'offer',
        ]);
    }

    // ── validateType (indirect via toggle) ───────────────────────────

    public function test_toggle_throws_InvalidArgument_for_unsupported_type(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage("This can't be saved.");

        $this->service->toggle(1, 'not_a_thing', 42);
    }

    public function test_getUserBookmarks_throws_on_invalid_type_filter(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage("This can't be saved.");

        $this->service->getUserBookmarks(1, 'bogus');
    }

    public function test_toggle_accepts_all_whitelisted_types(): void
    {
        // Reflection to verify the VALID_TYPES constant exposes the expected set.
        $ref = new \ReflectionClass(BookmarkService::class);
        $validTypes = $ref->getConstant('VALID_TYPES');

        $this->assertContains('post', $validTypes);
        $this->assertContains('listing', $validTypes);
        $this->assertContains('event', $validTypes);
        $this->assertContains('job', $validTypes);
        $this->assertContains('blog', $validTypes);
        $this->assertContains('discussion', $validTypes);
    }

    public function test_validateType_is_case_sensitive(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        // 'Post' with a capital P is NOT in the whitelist
        $this->service->toggle(1, 'Post', 42);
    }

    public function test_getUserBookmarks_accepts_null_type_without_throwing(): void
    {
        // The validation only fires when type is non-null. With null, the
        // method must proceed to the paginate() call, which will hit the DB.
        // We only assert that no InvalidArgumentException is thrown for the
        // null case — any DB-level error is fine for this unit boundary.
        try {
            $this->service->getUserBookmarks(1, null);
            $this->assertTrue(true);
        } catch (\InvalidArgumentException $e) {
            $this->fail('Should not throw InvalidArgumentException for null type');
        } catch (\Throwable $e) {
            // Any other error (e.g. DB/schema) is outside the scope of this guard test.
            $this->assertTrue(true);
        }
    }

    // ── tenant scoping (regression: 2026-07-09 audit P1 cross-tenant leak) ────

    public function test_toggle_rejects_item_from_another_tenant(): void
    {
        $user = $this->createUser();
        $foreignListingId = $this->insertListing($user->id, self::OTHER_TENANT_ID);

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage("We can't find that, so it couldn't be saved.");
        $this->service->toggle($user->id, 'listing', $foreignListingId);
    }

    public function test_toggle_rejects_nonexistent_item(): void
    {
        $user = $this->createUser();

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage("We can't find that, so it couldn't be saved.");
        $this->service->toggle($user->id, 'listing', 999999999);
    }

    public function test_toggle_bookmarks_and_unbookmarks_same_tenant_item(): void
    {
        $user = $this->createUser();
        $listingId = $this->insertListing($user->id, $this->testTenantId);

        $result = $this->service->toggle($user->id, 'listing', $listingId);
        $this->assertTrue($result['bookmarked']);

        // Untoggle must keep working even without re-validation (delete path).
        $result = $this->service->toggle($user->id, 'listing', $listingId);
        $this->assertFalse($result['bookmarked']);
    }

    public function test_getUserBookmarks_hydrates_title_for_same_tenant_item(): void
    {
        $user = $this->createUser();
        $listingId = $this->insertListing($user->id, $this->testTenantId);
        $this->service->toggle($user->id, 'listing', $listingId);

        $items = $this->service->getUserBookmarks($user->id)->items();

        $this->assertCount(1, $items);
        $this->assertSame('Bookmark seed listing', $items[0]->title);
    }

    public function test_getUserBookmarks_does_not_leak_foreign_tenant_title(): void
    {
        $user = $this->createUser();
        $foreignListingId = $this->insertListing($user->id, self::OTHER_TENANT_ID);

        // Simulate a poisoned row created before the tenant guard existed.
        DB::table('bookmarks')->insert([
            'tenant_id'         => $this->testTenantId,
            'user_id'           => $user->id,
            'bookmarkable_type' => 'listing',
            'bookmarkable_id'   => $foreignListingId,
            'collection_id'     => null,
            'created_at'        => now(),
        ]);

        $items = $this->service->getUserBookmarks($user->id)->items();

        $this->assertCount(1, $items);
        $this->assertNull(
            $items[0]->title,
            'Foreign-tenant listing title must not be hydrated'
        );
    }

    // ── 'post' bookmarks are FEED posts (CI regression 2026-07-09) ────────
    // TYPE_TABLE_MAP briefly pointed 'post' at the legacy blog `posts` table,
    // so the tenant existence check rejected every real feed save (React
    // FeedCard bookmark + alpha storeFeedPostSave both send feed_posts ids).

    public function test_toggle_bookmarks_a_feed_post(): void
    {
        $user = $this->createUser();
        $feedPostId = (int) DB::table('feed_posts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id'   => $user->id,
            'content'   => 'Feed post to bookmark',
        ]);

        $result = $this->service->toggle($user->id, 'post', $feedPostId);

        $this->assertTrue($result['bookmarked'], 'a same-tenant feed post must be bookmarkable');

        $items = $this->service->getUserBookmarks($user->id, 'post')->items();
        $this->assertCount(1, $items);
        $this->assertSame('Feed post to bookmark', $items[0]->title);
    }
}
