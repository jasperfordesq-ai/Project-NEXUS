<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-066 (E-027): bookmarks and saved collections must not reveal an item the
 * viewer is not allowed to see.
 *
 * Both services checked only that the (type, id) row existed in the
 * community. Saving the id of a private-group post then returned its full
 * text as the bookmark "title" (feed_posts.content), and a public saved
 * collection republished it to every member who opened it.
 */
class SavedItemVisibilityTest extends TestCase
{
    use DatabaseTransactions;

    private const SECRET_TEXT = 'Private group only: the treasurer is stepping down on Friday';

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ]);
    }

    /** A private group owned by $owner, with one post only its members may read. */
    private function privateGroupPost(User $owner): int
    {
        $groupId = DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $owner->id,
            'name' => 'Private circle ' . uniqid(),
            'visibility' => 'private',
            'status' => 'active',
            'is_active' => 1,
            'created_at' => now(),
        ]);
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'user_id' => $owner->id,
            'role' => 'owner',
            'status' => 'active',
        ]);

        return (int) DB::table('feed_posts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'group_id' => $groupId,
            'content' => self::SECRET_TEXT,
            'visibility' => 'public',
            'publish_status' => 'published',
            'created_at' => now(),
        ]);
    }

    private function publicPost(User $author): int
    {
        return (int) DB::table('feed_posts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $author->id,
            'content' => 'Public post anyone may read',
            'visibility' => 'public',
            'publish_status' => 'published',
            'created_at' => now(),
        ]);
    }

    public function test_member_cannot_bookmark_a_private_group_post(): void
    {
        $owner = $this->member();
        $postId = $this->privateGroupPost($owner);
        $outsider = $this->member();

        Sanctum::actingAs($outsider, ['*']);
        $response = $this->apiPost('/v2/bookmarks', ['type' => 'post', 'id' => $postId]);

        $this->assertNotSame(200, $response->status(), 'Bookmarking an unviewable post must be refused');
        $this->assertStringNotContainsString(self::SECRET_TEXT, (string) $response->getContent());
        $this->assertFalse(
            DB::table('bookmarks')->where('user_id', $outsider->id)->where('bookmarkable_id', $postId)->exists()
        );
    }

    public function test_existing_bookmark_of_an_unviewable_post_shows_no_content(): void
    {
        $owner = $this->member();
        $secretPostId = $this->privateGroupPost($owner);
        $outsider = $this->member();
        $publicPostId = $this->publicPost($owner);

        // Rows saved before the fix: the list must not replay the content.
        foreach ([$secretPostId, $publicPostId] as $postId) {
            DB::table('bookmarks')->insert([
                'tenant_id' => $this->testTenantId,
                'user_id' => $outsider->id,
                'bookmarkable_type' => 'post',
                'bookmarkable_id' => $postId,
                'created_at' => now(),
            ]);
        }

        Sanctum::actingAs($outsider, ['*']);
        $response = $this->apiGet('/v2/bookmarks?per_page=100')->assertStatus(200);

        $this->assertStringNotContainsString(self::SECRET_TEXT, (string) $response->getContent());
        // Control: a post the viewer may read still shows its title.
        $this->assertStringContainsString('Public post anyone may read', (string) $response->getContent());
    }

    public function test_owner_can_still_bookmark_their_own_unmoderated_listing_but_others_cannot(): void
    {
        $owner = $this->member();
        $listingId = (int) DB::table('listings')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'title' => 'Listing awaiting moderation',
            'type' => 'offer',
            'status' => 'active',
            'moderation_status' => 'pending_review',
        ]);
        $outsider = $this->member();

        Sanctum::actingAs($outsider, ['*']);
        $this->assertNotSame(200, $this->apiPost('/v2/bookmarks', ['type' => 'listing', 'id' => $listingId])->status());

        Sanctum::actingAs($owner, ['*']);
        $this->apiPost('/v2/bookmarks', ['type' => 'listing', 'id' => $listingId])
            ->assertStatus(200)
            ->assertJsonPath('data.bookmarked', true);
    }

    public function test_member_cannot_save_a_private_group_post_to_a_collection(): void
    {
        $owner = $this->member();
        $postId = $this->privateGroupPost($owner);
        $outsider = $this->member();

        Sanctum::actingAs($outsider, ['*']);
        $response = $this->apiPost('/v2/me/saved-items', ['item_type' => 'post', 'item_id' => $postId]);

        $this->assertNotSame(201, $response->status());
        $this->assertFalse(DB::table('saved_items')->where('user_id', $outsider->id)->where('item_id', $postId)->exists());
    }

    public function test_public_collection_preview_is_judged_for_the_viewer_not_the_owner(): void
    {
        $groupOwner = $this->member();
        $secretPostId = $this->privateGroupPost($groupOwner);
        $viewer = $this->member();

        // The group owner (who may read the post) saves it into a PUBLIC collection.
        $collectionId = (int) DB::table('saved_collections')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $groupOwner->id,
            'name' => 'Shared picks',
            'is_public' => 1,
            'items_count' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('saved_items')->insert([
            'collection_id' => $collectionId,
            'user_id' => $groupOwner->id,
            'tenant_id' => $this->testTenantId,
            'item_type' => 'post',
            'item_id' => $secretPostId,
            'saved_at' => now(),
        ]);

        Sanctum::actingAs($viewer, ['*']);
        $response = $this->apiGet("/v2/me/collections/{$collectionId}/items")->assertStatus(200);
        $this->assertStringNotContainsString(self::SECRET_TEXT, (string) $response->getContent());

        // Control: the owner, who may read it, still sees the preview.
        Sanctum::actingAs($groupOwner, ['*']);
        $this->assertStringContainsString(
            self::SECRET_TEXT,
            (string) $this->apiGet("/v2/me/collections/{$collectionId}/items")->assertStatus(200)->getContent()
        );
    }
}
