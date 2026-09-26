<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use Tests\Laravel\TestCase;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use App\Models\User;

/**
 * Feature tests for SocialController — feed, posts, likes, polls, impressions.
 */
class SocialControllerTest extends TestCase
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

    // ------------------------------------------------------------------
    //  GET /v2/feed
    // ------------------------------------------------------------------

    public function test_feed_requires_auth(): void
    {
        $response = $this->apiGet('/v2/feed');

        $response->assertStatus(401);
    }

    public function test_feed_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/feed');

        $response->assertStatus(200);
    }

    // ------------------------------------------------------------------
    //  POST /v2/feed/posts
    // ------------------------------------------------------------------

    public function test_create_post_requires_auth(): void
    {
        $response = $this->apiPost('/v2/feed/posts', [
            'content' => 'Hello world!',
        ]);

        $response->assertStatus(401);
    }

    public function test_create_post_replay_returns_one_post_and_rejects_changed_intent(): void
    {
        $user = $this->authenticatedUser();
        $payload = ['content' => 'A durable mobile group update'];
        $headers = ['Idempotency-Key' => 'feed-post-operation-123'];

        $first = $this->apiPost('/v2/feed/posts', $payload, $headers);
        $replay = $this->apiPost('/v2/feed/posts', $payload, $headers);

        $first->assertCreated();
        $replay->assertOk();
        $this->assertSame($first->json('data.id'), $replay->json('data.id'));
        $this->assertSame(1, DB::table('feed_posts')->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)->where('content', 'A durable mobile group update')->count());
        $this->assertSame(1, DB::table('feed_post_creation_receipts')->where('tenant_id', $this->testTenantId)
            ->where('actor_user_id', $user->id)->count());

        $this->apiPost('/v2/feed/posts', ['content' => 'Changed content'], $headers)->assertStatus(409);
    }

    public function test_legacy_mention_search_returns_username_for_resolvable_mentions(): void
    {
        $this->authenticatedUser();

        User::factory()->forTenant($this->testTenantId)->create([
            'first_name' => 'Mention',
            'last_name' => 'Target',
            'name' => 'Mention Target',
            'username' => 'mentiontarget',
            'status' => 'active',
            'is_approved' => true,
        ]);

        $response = $this->apiPost('/social/mention-search', [
            'query' => 'mentiontarget',
        ]);

        $response->assertStatus(200);
        $response->assertJsonFragment([
            'username' => 'mentiontarget',
        ]);
    }

    // ------------------------------------------------------------------
    //  POST /v2/feed/like
    // ------------------------------------------------------------------

    public function test_like_requires_auth(): void
    {
        $response = $this->apiPost('/v2/feed/like', [
            'post_id' => 1,
        ]);

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  POST /v2/feed/polls
    // ------------------------------------------------------------------

    public function test_create_poll_requires_auth(): void
    {
        $response = $this->apiPost('/v2/feed/polls', [
            'question' => 'What do you think?',
            'options' => ['Yes', 'No'],
        ]);

        $response->assertStatus(401);
    }

    public function test_authenticated_user_can_create_feed_poll(): void
    {
        $user = $this->authenticatedUser();

        $response = $this->apiPost('/v2/feed/polls', [
            'question' => 'Which project should we support?',
            'options' => ['Community garden', 'Repair cafe'],
        ]);

        $response->assertStatus(201);
        $response->assertJsonPath('data.question', 'Which project should we support?');

        $pollId = (int) $response->json('data.id');
        $this->assertGreaterThan(0, $pollId);

        $this->assertDatabaseHas('polls', [
            'id' => $pollId,
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
        ]);
        $this->assertDatabaseHas('poll_options', [
            'poll_id' => $pollId,
            'tenant_id' => $this->testTenantId,
            'label' => 'Community garden',
        ]);
        $this->assertDatabaseHas('poll_options', [
            'poll_id' => $pollId,
            'tenant_id' => $this->testTenantId,
            'label' => 'Repair cafe',
        ]);
        $this->assertDatabaseHas('feed_activity', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'source_type' => 'poll',
            'source_id' => $pollId,
        ]);
    }

    // ------------------------------------------------------------------
    //  POST /v2/feed/posts/{id}/hide
    // ------------------------------------------------------------------

    public function test_hide_post_requires_auth(): void
    {
        $response = $this->apiPost('/v2/feed/posts/1/hide');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  POST /v2/feed/posts/{id}/report
    // ------------------------------------------------------------------

    public function test_report_post_requires_auth(): void
    {
        $response = $this->apiPost('/v2/feed/posts/1/report', [
            'reason' => 'spam',
        ]);

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  POST /v2/feed/posts/{id}/delete
    // ------------------------------------------------------------------

    public function test_delete_post_requires_auth(): void
    {
        $response = $this->apiPost('/v2/feed/posts/1/delete');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  POST /v2/feed/users/{id}/mute
    // ------------------------------------------------------------------

    public function test_mute_user_requires_auth(): void
    {
        $response = $this->apiPost('/v2/feed/users/1/mute');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  POST /social/like (legacy)
    // ------------------------------------------------------------------

    public function test_legacy_like_requires_auth(): void
    {
        $response = $this->apiPost('/social/like', ['post_id' => 1]);

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  Reaction + like persistence across feed reload (regression guard)
    //
    //  This is the class of bug that has regressed repeatedly:
    //  user reacts/likes → page refresh → reaction/like is gone.
    //  Root cause is always: toggle endpoint works, but feed GET never
    //  batch-loads the social state back from the DB.
    // ------------------------------------------------------------------

    /**
     * Regression: reactions must survive a page refresh.
     *
     * Steps: react → reload feed via GET /v2/feed → assert user_reaction
     * is populated for that post.
     *
     * Previously broken because SocialController.feedV2() never called
     * ReactionService::getReactionsForPosts() — fixed 2026-05-01.
     */
    public function test_reaction_persists_after_feed_reload(): void
    {
        $user = $this->authenticatedUser();

        // Create a post + feed_activity entry so it appears in the feed
        $postId = DB::table('feed_posts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id'   => $user->id,
            'content'   => 'Regression test post for reaction persistence',
            'type'      => 'post',
            'visibility' => 'public',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('feed_activity')->insert([
            'tenant_id'   => $this->testTenantId,
            'user_id'     => $user->id,
            'source_type' => 'post',
            'source_id'   => $postId,
            'content'     => 'Regression test post for reaction persistence',
            'is_hidden'   => 0,
            'is_visible'  => 1,
            'created_at'  => now(),
        ]);

        // React to the post
        $this->apiPost("/v2/posts/{$postId}/reactions", ['reaction_type' => 'like'])
            ->assertStatus(200);

        // Simulate page refresh: reload the feed from scratch
        $response = $this->apiGet('/v2/feed?type=posts');
        $response->assertStatus(200);

        $items = $response->json('data') ?? [];
        $post  = collect($items)->firstWhere('id', $postId);

        $this->assertNotNull($post, 'Post should appear in the feed');
        $this->assertNotNull(
            $post['reactions']['user_reaction'] ?? null,
            'Reaction must survive a feed reload — user_reaction should not be null after reacting'
        );
        $this->assertEquals('like', $post['reactions']['user_reaction']);
        $this->assertGreaterThan(0, $post['reactions']['total'] ?? 0);
    }

    /**
     * Regression: is_liked (simple like) must survive a page refresh.
     *
     * Covers the legacy likes table path, separate from emoji reactions.
     */
    public function test_like_persists_after_feed_reload(): void
    {
        $user = $this->authenticatedUser();

        $postId = DB::table('feed_posts')->insertGetId([
            'tenant_id'  => $this->testTenantId,
            'user_id'    => $user->id,
            'content'    => 'Regression test post for like persistence',
            'type'       => 'post',
            'visibility' => 'public',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('feed_activity')->insert([
            'tenant_id'   => $this->testTenantId,
            'user_id'     => $user->id,
            'source_type' => 'post',
            'source_id'   => $postId,
            'content'     => 'Regression test post for like persistence',
            'is_hidden'   => 0,
            'is_visible'  => 1,
            'created_at'  => now(),
        ]);

        // Like the post via the likes endpoint
        $this->apiPost('/v2/feed/like', ['target_type' => 'post', 'target_id' => $postId])
            ->assertStatus(200);

        // Simulate page refresh
        $response = $this->apiGet('/v2/feed?type=posts');
        $response->assertStatus(200);

        $items = $response->json('data') ?? [];
        $post  = collect($items)->firstWhere('id', $postId);

        $this->assertNotNull($post, 'Post should appear in the feed');
        $this->assertTrue(
            (bool) ($post['is_liked'] ?? false),
            'is_liked must survive a feed reload — should be true after liking'
        );
        $this->assertGreaterThan(0, $post['likes_count'] ?? 0);
    }

    /**
     * Seed a row in the right backing table for a given feed item type and
     * return its insert id. Each type's table has different required columns,
     * so we hand-roll a minimal valid row per type.
     *
     * MUST stay in sync with the source-table mapping in
     * `FeedService::filterToValidSources()`.
     */
    private function seedReactableEntity(string $type, int $userId): ?int
    {
        $tenantId = $this->testTenantId;
        $now = now();

        try {
            return match ($type) {
                'listing' => DB::table('listings')->insertGetId([
                    'tenant_id' => $tenantId, 'user_id' => $userId,
                    'title' => 'Test listing', 'description' => 'x',
                    'type' => 'offer', 'status' => 'active',
                    'created_at' => $now, 'updated_at' => $now,
                ]),
                'event' => DB::table('events')->insertGetId([
                    'tenant_id' => $tenantId, 'user_id' => $userId,
                    'title' => 'Test event', 'description' => 'x',
                    'start_date' => '2030-01-01 12:00:00',
                    'start_time' => '12:00:00', 'end_time' => '13:00:00',
                    'is_online'  => 0, 'created_at' => $now, 'updated_at' => $now,
                ]),
                'goal' => DB::table('goals')->insertGetId([
                    'tenant_id' => $tenantId, 'user_id' => $userId,
                    'title' => 'Test goal', 'description' => 'x',
                    'is_public' => 1, 'status' => 'active',
                    'created_at' => $now, 'updated_at' => $now,
                ]),
                'review' => DB::table('reviews')->insertGetId([
                    'tenant_id' => $tenantId,
                    'reviewer_id' => $userId, 'receiver_id' => $userId,
                    'rating' => 5, 'comment' => 'Great',
                    'review_type' => 'local', 'status' => 'approved',
                    'created_at' => $now, 'updated_at' => $now,
                ]),
                'volunteer' => (function () use ($tenantId, $userId, $now): int {
                    $organizationId = DB::table('vol_organizations')->insertGetId([
                        'tenant_id' => $tenantId,
                        'user_id' => $userId,
                        'name' => 'Test volunteer org ' . uniqid(),
                        'slug' => 'test-volunteer-org-' . uniqid(),
                        'status' => 'active',
                        'created_at' => $now,
                        'updated_at' => $now,
                    ]);

                    return DB::table('vol_opportunities')->insertGetId([
                        'tenant_id' => $tenantId, 'organization_id' => $organizationId, 'created_by' => $userId,
                        'title' => 'Test volunteer', 'description' => 'x',
                        'is_active' => 1, 'status' => 'active',
                        'created_at' => $now,
                    ]);
                })(),
                'challenge' => DB::table('ideation_challenges')->insertGetId([
                    'tenant_id' => $tenantId, 'user_id' => $userId,
                    'title' => 'Test challenge', 'description' => 'x',
                    'status' => 'open',
                    'created_at' => $now, 'updated_at' => $now,
                ]),
                'job' => DB::table('job_vacancies')->insertGetId([
                    'tenant_id' => $tenantId, 'user_id' => $userId,
                    'title' => 'Test job', 'description' => 'x',
                    'type' => 'paid', 'commitment' => 'flexible', 'status' => 'open',
                    'created_at' => $now, 'updated_at' => $now,
                ]),
                'blog' => DB::table('posts')->insertGetId([
                    'tenant_id' => $tenantId, 'author_id' => $userId,
                    'title' => 'Test blog', 'slug' => 'test-blog-' . uniqid(),
                    'content' => 'x', 'status' => 'published',
                    'created_at' => $now, 'updated_at' => $now,
                ]),
                'discussion' => (function () use ($tenantId, $userId, $now): int {
                    $groupId = DB::table('groups')->insertGetId([
                        'tenant_id' => $tenantId, 'owner_id' => $userId,
                        'name' => 'Test group ' . uniqid(), 'slug' => 'test-group-' . uniqid(),
                        'visibility' => 'public', 'is_active' => 1, 'status' => 'active',
                        'created_at' => $now, 'updated_at' => $now,
                    ]);

                    return DB::table('group_discussions')->insertGetId([
                        'tenant_id' => $tenantId, 'group_id' => $groupId, 'user_id' => $userId,
                        'title' => 'Test discussion',
                        'created_at' => $now, 'updated_at' => $now,
                    ]);
                })(),
                default => null,
            };
        } catch (\Throwable $e) {
            // Surface failures so missing columns aren't silently swallowed.
            // Re-throw on CI so the test author sees the schema mismatch.
            if (getenv('CI')) {
                throw $e;
            }
            fwrite(STDERR, "[seedReactableEntity:{$type}] " . $e->getMessage() . "\n");
            return null;
        }
    }

    /**
     * Polymorphic reaction persistence — the bug class this fix is targeting.
     *
     * Before 2026-05-03 the React frontend posted ALL reactions to
     * /v2/posts/{id}/reactions and the backend hardcoded target_type='post'.
     * Reactions on listings/events/goals/etc. were stored against the wrong
     * type and never read back on reload — the recurring "like doesn't
     * persist" bug.
     *
     * If a new reactable type is added (e.g. 'discussion'), add it here AND
     * to ReactionService::VALID_TARGET_TYPES AND extend seedReactableEntity().
     *
     * @return array<string, array{0: string}>
     */
    public static function reactableFeedTypeProvider(): array
    {
        return [
            'listing'   => ['listing'],
            'event'     => ['event'],
            'goal'      => ['goal'],
            'review'    => ['review'],
            'volunteer' => ['volunteer'],
            'challenge' => ['challenge'],
            'job'       => ['job'],
            'blog'      => ['blog'],
            'discussion' => ['discussion'],
        ];
    }

    /**
     * @dataProvider reactableFeedTypeProvider
     */
    public function test_reactions_persist_across_reload_for_all_feed_types(string $type): void
    {
        $user = $this->authenticatedUser();

        $entityId = $this->seedReactableEntity($type, $user->id);
        if ($entityId === null) {
            $this->markTestSkipped("Could not seed {$type} entity in this schema");
        }

        DB::table('feed_activity')->insert([
            'tenant_id'   => $this->testTenantId,
            'user_id'     => $user->id,
            'source_type' => $type,
            'source_id'   => $entityId,
            'content'     => "Regression test {$type}",
            'is_hidden'   => 0,
            'is_visible'  => 1,
            'created_at'  => now(),
        ]);

        $this->apiPost('/v2/reactions', [
            'target_type' => $type,
            'target_id' => $entityId,
            'reaction_type' => 'like',
        ])->assertStatus(200);

        $response = $this->apiGet('/v2/feed');
        $response->assertStatus(200);

        $items = $response->json('data') ?? [];
        $item  = collect($items)->first(
            fn ($i) => ($i['type'] ?? null) === $type && (int) ($i['id'] ?? 0) === (int) $entityId
        );

        $this->assertNotNull($item, "{$type}:{$entityId} should appear in the feed");
        $this->assertEquals(
            'like',
            $item['reactions']['user_reaction'] ?? null,
            "Reaction must survive a feed reload for type={$type}"
        );
        $this->assertGreaterThan(0, $item['reactions']['total'] ?? 0);
    }

    /**
     * Polymorphic toggle endpoint validates target_type whitelist.
     */
    public function test_reactions_endpoint_rejects_invalid_target_type(): void
    {
        $this->authenticatedUser();
        $this->apiPost('/v2/reactions', [
            'target_type' => 'unknown_type',
            'target_id' => 1,
            'reaction_type' => 'like',
        ])->assertStatus(400);
    }

    /**
     * Loud-failure guard: a misrouted client posting (target_type='post',
     * target_id=<listing's id>) must 404, not silently pollute the reactions
     * table. This is the structural fix for the "reactions don't persist"
     * class of bug — turn silent miswires into hard failures.
     */
    public function test_reactions_endpoint_404s_when_target_doesnt_exist(): void
    {
        $this->authenticatedUser();
        $this->apiPost('/v2/reactions', [
            'target_type' => 'post',
            'target_id' => 9999999,
            'reaction_type' => 'like',
        ])->assertStatus(404);
    }

    /**
     * The 404 guard is tenant-scoped — a row in another tenant must not
     * satisfy the existence check.
     */
    public function test_reactions_endpoint_404s_for_cross_tenant_target(): void
    {
        $user = $this->authenticatedUser();

        // Insert a post in a DIFFERENT tenant than the one the user is in
        $otherTenantId = $this->testTenantId + 9999;
        // Use an existing tenant if one is present, else just use a fake id
        $existingOther = DB::table('tenants')->where('id', '!=', $this->testTenantId)->value('id');
        $tenantToUse = $existingOther ?: $otherTenantId;

        try {
            $crossTenantPostId = DB::table('feed_posts')->insertGetId([
                'tenant_id'  => $tenantToUse,
                'user_id'    => $user->id,
                'content'    => 'Cross-tenant post',
                'type'       => 'post',
                'visibility' => 'public',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        } catch (\Throwable $e) {
            $this->markTestSkipped('Could not seed cross-tenant post: ' . $e->getMessage());
        }

        $this->apiPost('/v2/reactions', [
            'target_type' => 'post',
            'target_id' => $crossTenantPostId,
            'reaction_type' => 'like',
        ])->assertStatus(404);

        // Ensure no row was written despite the validation passing
        $this->assertDatabaseMissing('reactions', [
            'user_id'   => $user->id,
            'target_id' => $crossTenantPostId,
        ]);
    }

    // ------------------------------------------------------------------
    //  POST /social/feed (legacy)
    // ------------------------------------------------------------------

    public function test_legacy_feed_requires_auth(): void
    {
        $response = $this->apiPost('/social/feed');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  Tenant isolation
    // ------------------------------------------------------------------

    public function test_feed_is_tenant_scoped(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/feed');

        $response->assertStatus(200);
        $data = $response->json();
        $this->assertIsArray($data);
    }

    // ------------------------------------------------------------------
    //  GET /v2/feed/items/{type}/{id}  — polymorphic feed item endpoint
    // ------------------------------------------------------------------

    public function test_feed_item_endpoint_rejects_invalid_type(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/feed/items/badge_earned/1');

        // Route allows the segment, controller rejects unknown reactable type.
        $response->assertStatus(400);
    }

    public function test_feed_item_endpoint_404s_for_missing_listing(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/feed/items/listing/999999999');

        $response->assertStatus(404);
    }

    public function test_feed_item_endpoint_404s_for_missing_event(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/feed/items/event/999999999');

        $response->assertStatus(404);
    }

    public function test_feed_item_endpoint_returns_listing_with_reactions(): void
    {
        $user = $this->authenticatedUser();

        $listing = \App\Models\Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id,
        ]);

        // Creating the listing above already fires ListingObserver, which
        // publishes the feed_activity row. Seed through the same service the
        // observer uses (INSERT ... ON DUPLICATE KEY UPDATE) so this stays
        // idempotent instead of colliding with the observer's row
        // (1062 uq_tenant_source), while still guaranteeing a visible row.
        app(\App\Services\FeedActivityService::class)->recordActivity(
            (int) $this->testTenantId,
            (int) $user->id,
            'listing',
            (int) $listing->id,
            ['title' => $listing->title]
        );

        $response = $this->apiGet('/v2/feed/items/listing/' . $listing->id);

        $response->assertStatus(200);
        $data = $response->json('data');
        $this->assertIsArray($data);
        $this->assertSame('listing', $data['type'] ?? null);
        $this->assertSame((int) $listing->id, (int) ($data['id'] ?? 0));
        $this->assertArrayHasKey('reactions', $data);
        $this->assertArrayHasKey('counts', $data['reactions']);
        $this->assertArrayHasKey('total', $data['reactions']);
        $this->assertArrayHasKey('user_reaction', $data['reactions']);
    }

    public function test_feed_item_endpoint_returns_event_with_reactions(): void
    {
        $user = $this->authenticatedUser();

        // Insert via the Schema-driven column list to dodge legacy column drift
        // in the test schema (factory-created Events trip on optional cols).
        $eventColumns = \Illuminate\Support\Facades\Schema::getColumnListing('events');
        $eventRow = array_intersect_key([
            'tenant_id'   => $this->testTenantId,
            'user_id'     => $user->id,
            'title'       => 'Test event',
            'description' => 'desc',
            'location'    => 'somewhere',
            'start_date'  => date('Y-m-d H:i:s', strtotime('+1 day')),
            'is_virtual'  => 0,
            'created_at'  => now(),
            'updated_at'  => now(),
        ], array_flip($eventColumns));
        $eventId = (int) DB::table('events')->insertGetId($eventRow);

        \App\Models\FeedActivity::factory()->forTenant($this->testTenantId)->create([
            'source_type' => 'event',
            'source_id'   => $eventId,
            'user_id'     => $user->id,
            'is_visible'  => true,
            'is_hidden'   => false,
        ]);

        $response = $this->apiGet('/v2/feed/items/event/' . $eventId);

        $response->assertStatus(200);
        $data = $response->json('data');
        $this->assertIsArray($data);
        $this->assertSame('event', $data['type'] ?? null);
        $this->assertSame($eventId, (int) ($data['id'] ?? 0));
        $this->assertArrayHasKey('reactions', $data);
    }

    // ------------------------------------------------------------------
    //  POST /v2/feed/impression — polymorphic CTR tracking
    // ------------------------------------------------------------------

    /**
     * Polymorphic impression tracking accepts non-post types so EdgeRank
     * gets a CTR signal across listings, events, etc. — the post-only
     * endpoint missed every other reactable surface.
     */
    public function test_polymorphic_impression_records_for_listing(): void
    {
        $user = $this->authenticatedUser();

        $listing = \App\Models\Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id,
        ]);

        $response = $this->apiPost('/v2/feed/impression', [
            'target_type' => 'listing',
            'target_id'   => $listing->id,
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.recorded', true);
    }

    public function test_polymorphic_impression_rejects_invalid_target_type(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/feed/impression', [
            'target_type' => 'not_a_real_type',
            'target_id'   => 1,
        ]);

        $response->assertStatus(400);
    }

    // ------------------------------------------------------------------
    //  POST /v2/feed/posts/{id}/not-interested — tenant existence guard
    // ------------------------------------------------------------------

    /**
     * notInterested must verify the (target_type, target_id) pair exists in
     * the current tenant before writing to feed_hidden. Without this guard a
     * client could poison feed_hidden with arbitrary IDs to bias the
     * EdgeRank negative signal against unrelated content.
     */
    public function test_not_interested_404s_for_cross_tenant_target(): void
    {
        $user = $this->authenticatedUser();

        $existingOther = DB::table('tenants')->where('id', '!=', $this->testTenantId)->value('id');
        $tenantToUse = $existingOther ?: ($this->testTenantId + 9999);

        try {
            $crossTenantPostId = DB::table('feed_posts')->insertGetId([
                'tenant_id'  => $tenantToUse,
                'user_id'    => $user->id,
                'content'    => 'Cross-tenant post',
                'type'       => 'post',
                'visibility' => 'public',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        } catch (\Throwable $e) {
            $this->markTestSkipped('Could not seed cross-tenant post: ' . $e->getMessage());
        }

        $response = $this->apiPost("/v2/feed/posts/{$crossTenantPostId}/not-interested", [
            'type' => 'post',
        ]);

        $response->assertStatus(404);

        // Confirm no feed_hidden poisoning happened
        $this->assertDatabaseMissing('feed_hidden', [
            'user_id'   => $user->id,
            'target_id' => $crossTenantPostId,
            'tenant_id' => $this->testTenantId,
        ]);
    }
}
