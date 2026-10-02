<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Services\PersonalisedFeedService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * PersonalisedFeedServiceTest
 *
 * Covers the main public API surface of PersonalisedFeedService:
 *   - rank()   — empty/invalid guards, cold-start fallback, personalised ranking
 *   - hasMinEngagement() — counts from likes / reactions / bookmarks tables
 *   - invalidateForUser() — version key is bumped so cached order is busted
 *
 * Strategy: Use real DB rows (DatabaseTransactions rolls them back).
 * Cache is NOT faked so we can test the real Cache::remember paths.
 * Every test calls Cache::flush() at the start to ensure isolation.
 *
 * Tables touched: users, likes, reactions, bookmarks, connections.
 *
 * Skipped / noted:
 *   - loadSimilarUsers / loadEngagedAuthors collaborative path: requires
 *     bookmarks → feed_posts → likes join + many rows; covered via
 *     integration through rank() warm-path indirectly — separate exhaustive
 *     fixture build is impractical in a unit suite.
 *   - Cache order-replay path (applyOrder): covered by verifying that a second
 *     call with the same candidate set returns the same order.
 */
class PersonalisedFeedServiceTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 2;

    private PersonalisedFeedService $svc;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById(self::TENANT_ID);
        $this->svc = new PersonalisedFeedService();
        Cache::flush();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /** Insert a minimal users row and return its id. */
    private function insertUser(float $lat = null, float $lng = null): int
    {
        $uid = uniqid('pfs', true);
        return DB::table('users')->insertGetId([
            'tenant_id'  => self::TENANT_ID,
            'name'       => 'PFS User ' . $uid,
            'first_name' => 'PFS',
            'last_name'  => 'User',
            'email'      => 'pfs.' . $uid . '@example.test',
            'status'     => 'active',
            'balance'    => 0,
            'role'       => 'member',
            'is_approved' => 1,
            'latitude'   => $lat,
            'longitude'  => $lng,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /**
     * Insert a skill_categories row and attach it to the user via user_skills.
     * Returns the generated category id.
     */
    /**
     * Give the user a skill named $name and return the id of a listing
     * category with that same name. Interest matching is by name: a user
     * skill's category_id is a skill_categories id, unrelated to
     * listings.category_id.
     */
    private function insertUserSkillAndMatchingCategory(int $userId, string $name): int
    {
        DB::table('user_skills')->insertOrIgnore([
            'tenant_id'  => self::TENANT_ID,
            'user_id'    => $userId,
            'skill_name' => $name,
            'created_at' => now(),
        ]);
        return $this->insertListingCategory($name);
    }

    private function insertListingCategory(string $name): int
    {
        return DB::table('categories')->insertGetId([
            'tenant_id'  => self::TENANT_ID,
            'name'       => $name,
            'slug'       => 'pfs-cat-' . uniqid('', true),
            'type'       => 'listing',
            'created_at' => now(),
        ]);
    }

    private function insertListing(int $userId, ?int $categoryId, string $createdAt): int
    {
        return DB::table('listings')->insertGetId([
            'tenant_id'   => self::TENANT_ID,
            'user_id'     => $userId,
            'title'       => 'PFS listing',
            'type'        => 'offer',
            'status'      => 'active',
            'category_id' => $categoryId,
            'created_at'  => $createdAt,
            'updated_at'  => $createdAt,
        ]);
    }

    /** Insert N likes rows for the given user so engagement count reaches threshold. */
    private function insertLikes(int $userId, int $count): void
    {
        for ($i = 0; $i < $count; $i++) {
            DB::table('likes')->insertOrIgnore([
                'tenant_id'   => self::TENANT_ID,
                'user_id'     => $userId,
                'target_type' => 'post',
                'target_id'   => 9000000 + $i,
                'created_at'  => now(),
            ]);
        }
    }

    /** Insert N reactions rows for the given user. */
    private function insertReactions(int $userId, int $count): void
    {
        for ($i = 0; $i < $count; $i++) {
            DB::table('reactions')->insertOrIgnore([
                'tenant_id'   => self::TENANT_ID,
                'user_id'     => $userId,
                'target_type' => 'post',
                'target_id'   => 8000000 + $i,
                'emoji'       => '👍',
                'created_at'  => now(),
            ]);
        }
    }

    /** Insert N bookmark rows for the given user. */
    private function insertBookmarks(int $userId, int $count): void
    {
        for ($i = 0; $i < $count; $i++) {
            DB::table('bookmarks')->insertOrIgnore([
                'tenant_id'        => self::TENANT_ID,
                'user_id'          => $userId,
                'bookmarkable_type' => 'listing',
                'bookmarkable_id'  => 7000000 + $i,
                'created_at'       => now(),
            ]);
        }
    }

    /** Build a minimal candidate array with controllable fields. */
    private function makeCandidates(array $overrides = []): array
    {
        $defaults = [
            ['id' => 1, 'created_at' => now()->subHour()->toDateTimeString(), 'user_id' => 0, 'category_id' => 0],
            ['id' => 2, 'created_at' => now()->subHours(2)->toDateTimeString(), 'user_id' => 0, 'category_id' => 0],
            ['id' => 3, 'created_at' => now()->subHours(5)->toDateTimeString(), 'user_id' => 0, 'category_id' => 0],
        ];
        return array_merge($defaults, $overrides);
    }

    // ── Constants ─────────────────────────────────────────────────────────────

    public function test_constants_have_expected_values(): void
    {
        $this->assertSame(600, PersonalisedFeedService::CACHE_TTL);
        $this->assertSame(5, PersonalisedFeedService::MIN_ENGAGEMENT_EVENTS);
        // Weights sum to 1.0
        $sum = PersonalisedFeedService::W_INTEREST
            + PersonalisedFeedService::W_RECENCY
            + PersonalisedFeedService::W_COLLAB
            + PersonalisedFeedService::W_SOCIAL
            + PersonalisedFeedService::W_PROXIMITY;
        $this->assertEqualsWithDelta(1.0, $sum, 0.0001);
    }

    // ── rank() — guard: empty candidates ─────────────────────────────────────

    public function test_rank_returns_empty_array_when_candidates_is_empty(): void
    {
        $userId = $this->insertUser();
        $result = $this->svc->rank($userId, 'feed', []);
        $this->assertSame([], $result);
    }

    // ── rank() — guard: invalid userId ───────────────────────────────────────

    public function test_rank_returns_candidates_unchanged_when_user_id_is_zero(): void
    {
        $candidates = $this->makeCandidates();
        $result = $this->svc->rank(0, 'feed', $candidates);
        $this->assertSame($candidates, $result);
    }

    public function test_rank_returns_candidates_unchanged_when_user_id_is_negative(): void
    {
        $candidates = $this->makeCandidates();
        $result = $this->svc->rank(-1, 'feed', $candidates);
        $this->assertSame($candidates, $result);
    }

    // ── rank() — cold-start: sorts by recency ─────────────────────────────────

    public function test_rank_cold_start_sorts_by_recency_newest_first(): void
    {
        // User with zero engagement → cold-start
        $userId = $this->insertUser();

        $candidates = [
            ['id' => 10, 'created_at' => now()->subHours(10)->toDateTimeString()],
            ['id' => 20, 'created_at' => now()->subHour()->toDateTimeString()],
            ['id' => 30, 'created_at' => now()->subHours(5)->toDateTimeString()],
        ];

        $result = $this->svc->rank($userId, 'feed', $candidates);

        $this->assertCount(3, $result);
        $this->assertSame(20, $result[0]['id'], 'Newest (1h) should be first');
        $this->assertSame(30, $result[1]['id'], 'Middle (5h) should be second');
        $this->assertSame(10, $result[2]['id'], 'Oldest (10h) should be last');
    }

    // ── rank() — cold-start: tiebreak by popularity ───────────────────────────

    public function test_rank_cold_start_tiebreaks_equal_recency_by_likes_count(): void
    {
        $userId = $this->insertUser();

        // Same creation time → tiebreak on likes_count
        $sameTime = now()->subHours(2)->toDateTimeString();
        $candidates = [
            ['id' => 1, 'created_at' => $sameTime, 'likes_count' => 5],
            ['id' => 2, 'created_at' => $sameTime, 'likes_count' => 50],
            ['id' => 3, 'created_at' => $sameTime, 'likes_count' => 20],
        ];

        $result = $this->svc->rank($userId, 'feed', $candidates);

        $this->assertCount(3, $result);
        $this->assertSame(2, $result[0]['id'], 'Most likes should come first');
    }

    // ── rank() — _score keys stripped from returned items ─────────────────────

    public function test_rank_personalised_result_does_not_expose_internal_score_keys(): void
    {
        // Seed engagement so user exits cold-start
        $userId = $this->insertUser();
        $this->insertLikes($userId, PersonalisedFeedService::MIN_ENGAGEMENT_EVENTS);
        Cache::flush(); // bust engagement cache

        $candidates = $this->makeCandidates();
        $result = $this->svc->rank($userId, 'feed', $candidates);

        foreach ($result as $item) {
            $this->assertArrayNotHasKey('_score', $item, '_score must be stripped before returning');
            $this->assertArrayNotHasKey('_score_breakdown', $item, '_score_breakdown must be stripped before returning');
        }
    }

    // ── rank() — personalised: interest signal promotes category match ─────────

    public function test_rank_personalised_promotes_category_matching_items(): void
    {
        $userId = $this->insertUser();
        $catId  = $this->insertUserSkillAndMatchingCategory($userId, 'Test Skill');
        $this->insertLikes($userId, PersonalisedFeedService::MIN_ENGAGEMENT_EVENTS);
        Cache::flush();

        // All same recency to isolate the interest signal
        $sameTime  = now()->subHours(1)->toDateTimeString();
        $authorId  = $this->insertUser();
        $unrelated = $this->insertListing($authorId, $this->insertListingCategory('Unrelated'), $sameTime); // interest 0.2
        $matching  = $this->insertListing($authorId, $catId, $sameTime);                                   // interest 1.0
        $none      = $this->insertListing($authorId, null, $sameTime);                                     // interest 0.4
        $candidates = [
            ['id' => $unrelated, 'created_at' => $sameTime],
            ['id' => $matching,  'created_at' => $sameTime],
            ['id' => $none,      'created_at' => $sameTime],
        ];

        $result = $this->svc->rank($userId, 'listings', $candidates);
        $this->assertCount(3, $result);

        $positions = array_column($result, 'id');
        $this->assertSame(
            [$matching, $none, $unrelated],
            $positions,
            'Category-matching listing should rank first, uncategorised next, unrelated last'
        );
    }

    // ── rank() — personalised: social signal promotes connected-user posts ─────

    public function test_rank_personalised_promotes_items_from_connected_users(): void
    {
        $userId     = $this->insertUser();
        $friendId   = $this->insertUser();
        $strangerId = $this->insertUser();

        // Establish an accepted connection between userId and friendId
        DB::table('connections')->insertOrIgnore([
            'tenant_id'    => self::TENANT_ID,
            'requester_id' => $userId,
            'receiver_id'  => $friendId,
            'status'       => 'accepted',
            'created_at'   => now(),
        ]);

        // Seed enough engagement to exit cold-start
        $this->insertLikes($userId, PersonalisedFeedService::MIN_ENGAGEMENT_EVENTS);
        Cache::flush();

        $sameTime = now()->subHour()->toDateTimeString();
        $candidates = [
            ['id' => 1, 'created_at' => $sameTime, 'user_id' => $strangerId, 'category_id' => 0],
            ['id' => 2, 'created_at' => $sameTime, 'user_id' => $friendId,   'category_id' => 0],
        ];

        $result = $this->svc->rank($userId, 'feed', $candidates);
        $this->assertCount(2, $result);

        $positions = array_column($result, 'id');
        $this->assertSame(2, $positions[0], "Friend's post (id=2) should outrank stranger's post (id=1)");
    }

    // ── rank() — personalised: connection as receiver also works ─────────────

    public function test_rank_personalised_connection_receiver_also_treated_as_connected(): void
    {
        $userId   = $this->insertUser();
        $friendId = $this->insertUser();

        // userId is the receiver this time
        DB::table('connections')->insertOrIgnore([
            'tenant_id'    => self::TENANT_ID,
            'requester_id' => $friendId,
            'receiver_id'  => $userId,
            'status'       => 'accepted',
            'created_at'   => now(),
        ]);

        $this->insertLikes($userId, PersonalisedFeedService::MIN_ENGAGEMENT_EVENTS);
        Cache::flush();

        $strangerId = $this->insertUser();
        $sameTime   = now()->subHour()->toDateTimeString();
        $candidates = [
            ['id' => 1, 'created_at' => $sameTime, 'user_id' => $strangerId, 'category_id' => 0],
            ['id' => 2, 'created_at' => $sameTime, 'user_id' => $friendId,   'category_id' => 0],
        ];

        $result = $this->svc->rank($userId, 'feed', $candidates);
        $positions = array_column($result, 'id');
        $this->assertSame(2, $positions[0], 'Friend (receiver-side) should rank above stranger');
    }

    // ── rank() — result count preserved ───────────────────────────────────────

    public function test_rank_returns_same_number_of_candidates_as_input(): void
    {
        $userId = $this->insertUser();
        $this->insertLikes($userId, PersonalisedFeedService::MIN_ENGAGEMENT_EVENTS);
        Cache::flush();

        $candidates = $this->makeCandidates();
        $result     = $this->svc->rank($userId, 'feed', $candidates);

        $this->assertCount(count($candidates), $result);
    }

    // ── rank() — cache replay returns same order ───────────────────────────────

    public function test_rank_second_call_same_candidates_returns_same_order(): void
    {
        $userId = $this->insertUser();
        $this->insertLikes($userId, PersonalisedFeedService::MIN_ENGAGEMENT_EVENTS);
        Cache::flush();

        $candidates = $this->makeCandidates();

        $first  = $this->svc->rank($userId, 'feed', $candidates);
        $second = $this->svc->rank($userId, 'feed', $candidates);

        $this->assertSame(
            array_column($first, 'id'),
            array_column($second, 'id'),
            'Cached result should return identical order'
        );
    }

    // ── hasMinEngagement() — via likes ────────────────────────────────────────

    public function test_hasMinEngagement_returns_false_when_user_has_no_engagement(): void
    {
        $userId = $this->insertUser();
        Cache::flush();

        $result = $this->svc->hasMinEngagement($userId, self::TENANT_ID);

        $this->assertFalse($result);
    }

    public function test_hasMinEngagement_returns_false_when_user_has_fewer_likes_than_threshold(): void
    {
        $userId = $this->insertUser();
        $this->insertLikes($userId, PersonalisedFeedService::MIN_ENGAGEMENT_EVENTS - 1);
        Cache::flush();

        $result = $this->svc->hasMinEngagement($userId, self::TENANT_ID);

        $this->assertFalse($result);
    }

    public function test_hasMinEngagement_returns_true_when_user_has_exactly_min_likes(): void
    {
        $userId = $this->insertUser();
        $this->insertLikes($userId, PersonalisedFeedService::MIN_ENGAGEMENT_EVENTS);
        Cache::flush();

        $result = $this->svc->hasMinEngagement($userId, self::TENANT_ID);

        $this->assertTrue($result);
    }

    public function test_hasMinEngagement_returns_true_when_user_has_more_than_min_likes(): void
    {
        $userId = $this->insertUser();
        $this->insertLikes($userId, PersonalisedFeedService::MIN_ENGAGEMENT_EVENTS + 3);
        Cache::flush();

        $result = $this->svc->hasMinEngagement($userId, self::TENANT_ID);

        $this->assertTrue($result);
    }

    // ── hasMinEngagement() — counts reactions when likes < threshold ──────────

    public function test_hasMinEngagement_counts_reactions_when_likes_are_below_threshold(): void
    {
        $userId = $this->insertUser();

        // Fewer likes than threshold, but reactions bring total to threshold
        $this->insertLikes($userId, PersonalisedFeedService::MIN_ENGAGEMENT_EVENTS - 2);
        $this->insertReactions($userId, 2);
        Cache::flush();

        $result = $this->svc->hasMinEngagement($userId, self::TENANT_ID);

        $this->assertTrue($result, 'reactions should top up likes to meet threshold');
    }

    // ── hasMinEngagement() — counts bookmarks when likes+reactions < threshold ─

    public function test_hasMinEngagement_counts_bookmarks_as_fallback(): void
    {
        $userId = $this->insertUser();

        // No likes, no reactions; bookmarks alone fill threshold
        $this->insertBookmarks($userId, PersonalisedFeedService::MIN_ENGAGEMENT_EVENTS);
        Cache::flush();

        $result = $this->svc->hasMinEngagement($userId, self::TENANT_ID);

        $this->assertTrue($result, 'bookmarks alone should satisfy min engagement threshold');
    }

    // ── hasMinEngagement() — tenant isolation ─────────────────────────────────

    public function test_hasMinEngagement_does_not_count_likes_from_other_tenants(): void
    {
        $userId    = $this->insertUser();
        $otherTenantId = 1; // tenant 1 also exists in the DB

        // Insert likes for the same user_id but under a different tenant
        for ($i = 0; $i < PersonalisedFeedService::MIN_ENGAGEMENT_EVENTS; $i++) {
            DB::table('likes')->insertOrIgnore([
                'tenant_id'   => $otherTenantId,
                'user_id'     => $userId,
                'target_type' => 'post',
                'target_id'   => 6000000 + $i,
                'created_at'  => now(),
            ]);
        }
        Cache::flush();

        $result = $this->svc->hasMinEngagement($userId, self::TENANT_ID);

        $this->assertFalse($result, 'Likes from another tenant must not count toward this tenant threshold');
    }

    // ── invalidateForUser() ────────────────────────────────────────────────────

    public function test_invalidateForUser_bumps_version_so_subsequent_rank_recomputes(): void
    {
        $userId = $this->insertUser();
        $this->insertLikes($userId, PersonalisedFeedService::MIN_ENGAGEMENT_EVENTS);
        Cache::flush();

        $candidates = $this->makeCandidates();

        // First rank: stores the order in cache
        $first = $this->svc->rank($userId, 'feed', $candidates);

        // Bust the cache
        $this->svc->invalidateForUser($userId);

        // Second rank: cache key now incorporates the new version,
        // so it recomputes (result should still be a valid re-ordered array)
        $second = $this->svc->rank($userId, 'feed', $candidates);

        $this->assertCount(count($candidates), $second);
        // Both calls should return the same set of IDs (all items present regardless of order)
        $firstIds  = array_column($first, 'id');
        $secondIds = array_column($second, 'id');
        sort($firstIds);
        sort($secondIds);
        $this->assertSame($firstIds, $secondIds, 'After invalidation the same items should be returned');
    }

    public function test_invalidateForUser_is_a_no_op_when_user_id_is_zero(): void
    {
        // Must not throw
        $this->svc->invalidateForUser(0);
        $this->assertTrue(true, 'invalidateForUser(0) should silently return');
    }

    // ── rank() — single candidate unchanged order ─────────────────────────────

    public function test_rank_single_candidate_returns_that_single_item(): void
    {
        $userId = $this->insertUser();
        $candidates = [['id' => 42, 'created_at' => now()->toDateTimeString()]];

        $result = $this->svc->rank($userId, 'feed', $candidates);

        $this->assertCount(1, $result);
        $this->assertSame(42, $result[0]['id']);
    }

    // ── rank() — listings content type also works ─────────────────────────────

    public function test_rank_works_with_listings_content_type(): void
    {
        // Confirm rank() accepts 'listings' as a content type without throwing
        $userId = $this->insertUser();
        $candidates = $this->makeCandidates();

        $result = $this->svc->rank($userId, 'listings', $candidates);

        $this->assertCount(count($candidates), $result);
    }
}
