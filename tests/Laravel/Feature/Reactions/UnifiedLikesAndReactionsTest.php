<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Reactions;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * One store for likes and reactions.
 *
 * Until 2026-11-14 a "like" (POST /v2/feed/like, the heart on detail pages, the
 * accessible frontend and the phone app's exchange screen) was written to the
 * `likes` table, while an emoji reaction (POST /v2/reactions, the feed card) was
 * written to `reactions`. Nothing reconciled the two, so:
 *
 *   - a listing liked on its own page showed no reaction on its feed card, and a
 *     reaction given on the feed card did not count on the listing page;
 *   - the feed card hid the `likes` count whenever it had a `reactions` object,
 *     which it always had, so every older like disappeared from the feed;
 *   - "who liked this" read one table or the other depending on the page.
 *
 * `reactions` is now the only store. A like is the `like` reaction.
 */
class UnifiedLikesAndReactionsTest extends TestCase
{
    use DatabaseTransactions;

    private function member(bool $actAs = false): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        if ($actAs) {
            Sanctum::actingAs($user, ['*']);
        }

        return $user;
    }

    private function listing(int $ownerId): int
    {
        $id = (int) DB::table('listings')->insertGetId([
            'tenant_id' => $this->testTenantId, 'user_id' => $ownerId,
            'title' => 'Unified reactions listing', 'description' => 'x',
            'type' => 'offer', 'status' => 'active',
            'created_at' => now(), 'updated_at' => now(),
        ]);

        DB::table('feed_activity')->insert([
            'tenant_id' => $this->testTenantId, 'user_id' => $ownerId,
            'source_type' => 'listing', 'source_id' => $id,
            'title' => 'Unified reactions listing', 'content' => 'x',
            'is_hidden' => 0, 'is_visible' => 1, 'created_at' => now(),
        ]);

        return $id;
    }

    private function feedPost(int $ownerId): int
    {
        $id = (int) DB::table('feed_posts')->insertGetId([
            'tenant_id' => $this->testTenantId, 'user_id' => $ownerId,
            'content' => 'Unified reactions post', 'type' => 'post',
            'visibility' => 'public', 'created_at' => now(), 'updated_at' => now(),
        ]);

        DB::table('feed_activity')->insert([
            'tenant_id' => $this->testTenantId, 'user_id' => $ownerId,
            'source_type' => 'post', 'source_id' => $id,
            'content' => 'Unified reactions post',
            'is_hidden' => 0, 'is_visible' => 1, 'created_at' => now(),
        ]);

        return $id;
    }

    private function react(int $userId, string $type, int $id, string $emoji): void
    {
        DB::table('reactions')->insert([
            'tenant_id' => $this->testTenantId, 'user_id' => $userId,
            'target_type' => $type, 'target_id' => $id,
            'emoji' => $emoji, 'created_at' => now(),
        ]);
    }

    // ------------------------------------------------------------------
    //  A like and a reaction are the same thing
    // ------------------------------------------------------------------

    public function test_a_like_given_on_a_detail_page_shows_as_a_reaction_on_the_feed_card(): void
    {
        $me = $this->member(true);
        $listingId = $this->listing($me->id);

        $like = $this->apiPost('/v2/feed/like', ['target_type' => 'listing', 'target_id' => $listingId]);
        $like->assertStatus(200);
        $this->assertSame('liked', $like->json('data.action'));
        $this->assertSame(1, $like->json('data.likes_count'));
        $this->assertSame('like', $like->json('data.reactions.user_reaction'));

        $reactions = $this->apiGet("/v2/reactions/listing/{$listingId}");
        $reactions->assertStatus(200);
        $this->assertSame(1, $reactions->json('data.total'));
        $this->assertSame(1, $reactions->json('data.counts.like'));
        $this->assertSame('like', $reactions->json('data.user_reaction'));

        $card = $this->apiGet("/v2/feed/items/listing/{$listingId}");
        $card->assertStatus(200);
        $this->assertSame(1, $card->json('data.reactions.total'));
        $this->assertSame(1, $card->json('data.likes_count'));
        $this->assertTrue($card->json('data.is_liked'));
    }

    public function test_a_reaction_given_on_the_feed_card_counts_on_the_detail_page(): void
    {
        $me = $this->member(true);
        $listingId = $this->listing($me->id);

        $this->apiPost('/v2/reactions', [
            'target_type' => 'listing', 'target_id' => $listingId, 'reaction_type' => 'celebrate',
        ])->assertStatus(200);

        $detail = $this->apiGet("/v2/listings/{$listingId}");
        $detail->assertStatus(200);
        $this->assertSame(1, $detail->json('data.likes_count'));
        $this->assertTrue($detail->json('data.is_liked'));
    }

    public function test_the_like_button_removes_whatever_reaction_the_member_already_gave(): void
    {
        $me = $this->member(true);
        $listingId = $this->listing($me->id);
        $this->react($me->id, 'listing', $listingId, 'love');

        $response = $this->apiPost('/v2/feed/like', ['target_type' => 'listing', 'target_id' => $listingId]);

        $response->assertStatus(200);
        $this->assertSame('unliked', $response->json('data.action'));
        $this->assertSame(0, $response->json('data.likes_count'));
        $this->assertSame(0, DB::table('reactions')
            ->where('tenant_id', $this->testTenantId)
            ->where('target_type', 'listing')->where('target_id', $listingId)->count());
    }

    public function test_the_like_endpoints_no_longer_write_the_retired_likes_table(): void
    {
        $me = $this->member(true);
        $postId = $this->feedPost($me->id);

        $this->apiPost('/v2/feed/like', ['target_type' => 'post', 'target_id' => $postId])->assertStatus(200);

        $this->assertSame(0, DB::table('likes')->where('user_id', $me->id)->count());
        $this->assertSame(1, DB::table('reactions')->where('user_id', $me->id)
            ->where('target_type', 'post')->where('target_id', $postId)->where('emoji', 'like')->count());

        // The legacy v1 endpoint is the same switch.
        $legacy = $this->apiPost('/social/like', ['target_type' => 'post', 'target_id' => $postId]);
        $legacy->assertStatus(200);
        $this->assertSame('unliked', $legacy->json('data.status'));
        $this->assertSame(0, DB::table('reactions')->where('user_id', $me->id)->count());
    }

    public function test_the_post_counter_follows_reactions_as_well_as_likes(): void
    {
        $me = $this->member(true);
        $other = $this->member();
        $postId = $this->feedPost($me->id);
        $this->react($other->id, 'post', $postId, 'wow');

        $this->apiPost('/v2/reactions', [
            'target_type' => 'post', 'target_id' => $postId, 'reaction_type' => 'love',
        ])->assertStatus(200);

        $this->assertSame(2, (int) DB::table('feed_posts')->where('id', $postId)->value('likes_count'));

        $feed = $this->apiGet('/v2/feed?type=posts');
        $item = collect($feed->json('data') ?? [])->firstWhere('id', $postId);
        $this->assertNotNull($item);
        $this->assertSame(2, $item['likes_count']);
        $this->assertSame(2, $item['reactions']['total']);
        $this->assertTrue($item['is_liked']);
    }

    // ------------------------------------------------------------------
    //  "Who liked this" lists everyone, whichever button they used
    // ------------------------------------------------------------------

    public function test_the_likers_list_includes_members_who_reacted(): void
    {
        $me = $this->member(true);
        $other = $this->member();
        $listingId = $this->listing($me->id);
        $this->react($other->id, 'listing', $listingId, 'celebrate');
        $this->apiPost('/v2/feed/like', ['target_type' => 'listing', 'target_id' => $listingId])->assertStatus(200);

        $response = $this->apiPost('/social/likers', ['target_type' => 'listing', 'target_id' => $listingId]);

        $response->assertStatus(200);
        $this->assertSame(2, $response->json('data.total_count'));
        $ids = array_map('intval', array_column($response->json('data.likers'), 'id'));
        sort($ids);
        $expected = [(int) $me->id, (int) $other->id];
        sort($expected);
        $this->assertSame($expected, $ids);
    }

    // ------------------------------------------------------------------
    //  One request for a page of items
    // ------------------------------------------------------------------

    public function test_the_batch_endpoint_returns_a_summary_per_item(): void
    {
        $me = $this->member(true);
        $other = $this->member();
        $listingId = $this->listing($me->id);
        $postId = $this->feedPost($me->id);
        $this->react($other->id, 'listing', $listingId, 'clap');
        $this->react($me->id, 'post', $postId, 'love');

        $response = $this->apiGet("/v2/reactions/batch?items=listing:{$listingId},post:{$postId},listing:999999999");

        $response->assertStatus(200);
        $data = $response->json('data');
        $this->assertSame(1, $data["listing:{$listingId}"]['total']);
        $this->assertSame(1, $data["listing:{$listingId}"]['counts']['clap']);
        $this->assertNull($data["listing:{$listingId}"]['user_reaction']);
        $this->assertSame('love', $data["post:{$postId}"]['user_reaction']);
        $this->assertArrayNotHasKey('listing:999999999', $data, 'an item the viewer cannot see is left out');
    }

    public function test_the_batch_endpoint_is_for_signed_in_members_only(): void
    {
        // The answer names the members who reacted, so it must stay behind
        // sign-in like every other reactions route.
        $owner = $this->member();
        $listingId = $this->listing($owner->id);
        $this->react($owner->id, 'listing', $listingId, 'like');

        $this->apiGet("/v2/reactions/batch?items=listing:{$listingId}")->assertStatus(401);
    }

    public function test_the_batch_endpoint_leaves_out_another_communitys_items(): void
    {
        $me = $this->member(true);
        $foreignListing = (int) DB::table('listings')->insertGetId([
            'tenant_id' => 999, 'user_id' => $me->id,
            'title' => 'Other community', 'description' => 'x',
            'type' => 'offer', 'status' => 'active',
            'created_at' => now(), 'updated_at' => now(),
        ]);

        $response = $this->apiGet("/v2/reactions/batch?items=listing:{$foreignListing}");

        $response->assertStatus(200);
        $this->assertSame([], (array) $response->json('data'));
    }

    // ------------------------------------------------------------------
    //  The older likes are carried over
    // ------------------------------------------------------------------

    public function test_the_migration_carries_older_likes_into_reactions(): void
    {
        $me = $this->member();
        $other = $this->member();
        $listingId = $this->listing($me->id);
        $postId = $this->feedPost($me->id);
        $earlier = now()->subDays(40)->startOfSecond();

        // A like nobody has reacted over: carried across as "like", date kept.
        DB::table('likes')->insert([
            'tenant_id' => $this->testTenantId, 'user_id' => $other->id,
            'target_type' => 'listing', 'target_id' => $listingId, 'created_at' => $earlier,
        ]);
        // A like from a member who has since reacted: their reaction stands.
        DB::table('likes')->insert([
            'tenant_id' => $this->testTenantId, 'user_id' => $me->id,
            'target_type' => 'post', 'target_id' => $postId, 'created_at' => $earlier,
        ]);
        $this->react($me->id, 'post', $postId, 'love');
        // The old spelling of the volunteering target is normalised.
        DB::table('likes')->insert([
            'tenant_id' => $this->testTenantId, 'user_id' => $other->id,
            'target_type' => 'volunteering', 'target_id' => 4242, 'created_at' => $earlier,
        ]);

        $migration = require database_path('migrations/2026_11_14_120000_unify_likes_into_reactions.php');
        $migration->up();
        $migration->up(); // safe to run twice

        $carried = DB::table('reactions')->where('tenant_id', $this->testTenantId)
            ->where('user_id', $other->id)->where('target_type', 'listing')->where('target_id', $listingId)->get();
        $this->assertCount(1, $carried);
        $this->assertSame('like', $carried[0]->emoji);
        $this->assertSame($earlier->toDateTimeString(), (string) $carried[0]->created_at);

        $mine = DB::table('reactions')->where('tenant_id', $this->testTenantId)
            ->where('user_id', $me->id)->where('target_type', 'post')->where('target_id', $postId)->get();
        $this->assertCount(1, $mine);
        $this->assertSame('love', $mine[0]->emoji);

        $this->assertSame(1, DB::table('reactions')->where('tenant_id', $this->testTenantId)
            ->where('user_id', $other->id)->where('target_type', 'volunteer')->where('target_id', 4242)->count());

        // The post counter is recounted from the one store.
        $this->assertSame(1, (int) DB::table('feed_posts')->where('id', $postId)->value('likes_count'));
        // The retired table is left exactly as it was.
        $this->assertSame(3, DB::table('likes')->where('tenant_id', $this->testTenantId)
            ->whereIn('user_id', [$me->id, $other->id])->count());
    }
}
