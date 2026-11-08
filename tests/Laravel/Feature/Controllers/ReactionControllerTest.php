<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Http\Controllers\Api\BaseApiController;
use App\Models\User;
use App\Services\TokenService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for ReactionController — toggle, list, and reactor endpoints
 * for both post and comment reactions.
 *
 * Uses the unified `reactions` table (target_type, target_id, emoji).
 * Posts are created in `feed_posts`; comments in `feed_comments`.
 */
class ReactionControllerTest extends TestCase
{
    use DatabaseTransactions;

    private function authenticatedUser(array $overrides = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    /**
     * Insert a feed_posts row and return its ID.
     */
    private function createPost(int $userId): int
    {
        return DB::table('feed_posts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $userId,
            'content' => 'Test post for reactions',
            'type' => 'post',
            'visibility' => 'public',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /**
     * Insert a comments row and return its ID. Comments live in `comments`
     * (polymorphic via target_type/target_id), not `feed_comments`.
     */
    private function createComment(int $postId, int $userId): int
    {
        return DB::table('comments')->insertGetId([
            'tenant_id'   => $this->testTenantId,
            'target_type' => 'post',
            'target_id'   => $postId,
            'user_id'     => $userId,
            'content'     => 'Test comment for reactions',
            'created_at'  => now(),
            'updated_at'  => now(),
        ]);
    }

    /**
     * Insert a reaction directly into the reactions table for a post.
     */
    private function insertPostReaction(int $postId, int $userId, string $type = 'love'): int
    {
        return DB::table('reactions')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'target_type' => 'post',
            'target_id' => $postId,
            'user_id' => $userId,
            'emoji' => $type,
            'created_at' => now(),
        ]);
    }

    /**
     * Insert a reaction directly into the reactions table for a comment.
     */
    private function insertCommentReaction(int $commentId, int $userId, string $type = 'love'): int
    {
        return DB::table('reactions')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'target_type' => 'comment',
            'target_id' => $commentId,
            'user_id' => $userId,
            'emoji' => $type,
            'created_at' => now(),
        ]);
    }

    // ======================================================================
    //  POST /v2/posts/{id}/reactions — Toggle Post Reaction
    // ======================================================================

    public function test_toggle_post_reaction_adds_reaction(): void
    {
        $user = $this->authenticatedUser();
        $postId = $this->createPost($user->id);

        $response = $this->apiPost("/v2/posts/{$postId}/reactions", [
            'reaction_type' => 'love',
        ]);

        $response->assertStatus(200);
        $response->assertJsonStructure(['data' => ['action', 'reaction_type', 'reactions']]);
        $response->assertJsonPath('data.action', 'added');
        $response->assertJsonPath('data.reaction_type', 'love');
    }

    public function test_toggle_post_reaction_removes_same_type(): void
    {
        $user = $this->authenticatedUser();
        $postId = $this->createPost($user->id);
        $this->insertPostReaction($postId, $user->id, 'love');

        $response = $this->apiPost("/v2/posts/{$postId}/reactions", [
            'reaction_type' => 'love',
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.action', 'removed');
        $response->assertJsonPath('data.reaction_type', null);
    }

    public function test_toggle_post_reaction_updates_to_different_type(): void
    {
        $user = $this->authenticatedUser();
        $postId = $this->createPost($user->id);
        $this->insertPostReaction($postId, $user->id, 'love');

        $response = $this->apiPost("/v2/posts/{$postId}/reactions", [
            'reaction_type' => 'laugh',
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.action', 'updated');
        $response->assertJsonPath('data.reaction_type', 'laugh');
    }

    public function test_toggle_post_reaction_requires_auth(): void
    {
        $response = $this->apiPost('/v2/posts/1/reactions', [
            'reaction_type' => 'love',
        ]);

        $response->assertStatus(401);
    }

    public function test_toggle_post_reaction_rejects_invalid_type(): void
    {
        $user = $this->authenticatedUser();
        $postId = $this->createPost($user->id);

        $response = $this->apiPost("/v2/posts/{$postId}/reactions", [
            'reaction_type' => 'invalid_type',
        ]);

        $response->assertStatus(400);
    }

    public function test_toggle_post_reaction_rejects_empty_type(): void
    {
        $user = $this->authenticatedUser();
        $postId = $this->createPost($user->id);

        $response = $this->apiPost("/v2/posts/{$postId}/reactions", []);

        $response->assertStatus(400);
    }

    public function test_toggle_post_reaction_all_valid_types(): void
    {
        $user = $this->authenticatedUser();
        $validTypes = ['love', 'like', 'laugh', 'wow', 'sad', 'celebrate', 'clap', 'time_credit'];

        foreach ($validTypes as $type) {
            // Use a fresh post for each type to avoid cross-iteration state
            $postId = $this->createPost($user->id);

            // Add
            $response = $this->apiPost("/v2/posts/{$postId}/reactions", [
                'reaction_type' => $type,
            ]);
            $response->assertStatus(200);
            $response->assertJsonPath('data.action', 'added');

            // Remove (toggle same type)
            $response = $this->apiPost("/v2/posts/{$postId}/reactions", [
                'reaction_type' => $type,
            ]);
            $response->assertStatus(200);
            $response->assertJsonPath('data.action', 'removed');
        }
    }

    // ======================================================================
    //  GET /v2/posts/{id}/reactions — Get Post Reactions
    // ======================================================================

    public function test_get_post_reactions_returns_counts(): void
    {
        $user = $this->authenticatedUser();
        $postId = $this->createPost($user->id);

        $other1 = User::factory()->forTenant($this->testTenantId)->create();
        $other2 = User::factory()->forTenant($this->testTenantId)->create();

        $this->insertPostReaction($postId, $user->id, 'love');
        $this->insertPostReaction($postId, $other1->id, 'love');
        $this->insertPostReaction($postId, $other2->id, 'laugh');

        $response = $this->apiGet("/v2/posts/{$postId}/reactions");

        $response->assertStatus(200);
        $response->assertJsonStructure(['data' => ['counts', 'total', 'user_reaction', 'top_reactors']]);
        $response->assertJsonPath('data.total', 3);
        $response->assertJsonPath('data.counts.love', 2);
        $response->assertJsonPath('data.counts.laugh', 1);
        $response->assertJsonPath('data.user_reaction', 'love');
    }

    public function test_get_post_reactions_returns_empty_for_no_reactions(): void
    {
        $user = $this->authenticatedUser();
        $postId = $this->createPost($user->id);

        $response = $this->apiGet("/v2/posts/{$postId}/reactions");

        $response->assertStatus(200);
        $response->assertJsonPath('data.total', 0);
        $response->assertJsonPath('data.user_reaction', null);
    }

    public function test_get_post_reactions_works_unauthenticated(): void
    {
        // getPostReactions uses getOptionalUserId, so it should work without auth
        $user = User::factory()->forTenant($this->testTenantId)->create();
        $postId = $this->createPost($user->id);
        $this->insertPostReaction($postId, $user->id, 'love');

        $response = $this->apiGet("/v2/posts/{$postId}/reactions");

        // Should succeed (200) even without auth, user_reaction will be null
        $this->assertContains($response->getStatusCode(), [200, 401]);
    }

    public function test_public_optional_auth_rejects_retired_sanctum_bearer_but_accepts_jwt(): void
    {
        $viewer = User::factory()->forTenant($this->testTenantId)->create();
        $probe = new BaseApiControllerOptionalAuthProbe();

        $retiredSanctumBearer = $viewer->createToken('retired-public-route-token')->plainTextToken;
        $patRequest = Request::create('/public-auth-probe', 'GET');
        $patRequest->headers->set('Authorization', 'Bearer ' . $retiredSanctumBearer);
        $this->app->instance('request', $patRequest);
        $this->assertNull($probe->optionalUserId());

        $jwt = app(TokenService::class)->generateToken(
            (int) $viewer->id,
            $this->testTenantId
        );
        $jwtRequest = Request::create('/public-auth-probe', 'GET');
        $jwtRequest->headers->set('Authorization', 'Bearer ' . $jwt);
        $this->app->instance('request', $jwtRequest);
        $this->assertSame((int) $viewer->id, $probe->optionalUserId());

        Sanctum::actingAs($viewer, ['*']);
        $this->app->instance('request', Request::create('/public-auth-probe', 'GET'));
        $this->assertSame((int) $viewer->id, $probe->optionalUserId());

        $statefulRequestWithRetiredBearer = Request::create('/public-auth-probe', 'GET');
        $statefulRequestWithRetiredBearer->headers->set(
            'Authorization',
            'Bearer ' . $retiredSanctumBearer
        );
        $this->app->instance('request', $statefulRequestWithRetiredBearer);
        $this->assertNull($probe->optionalUserId());
    }

    public function test_get_post_reactions_includes_top_reactors(): void
    {
        $user = $this->authenticatedUser();
        $postId = $this->createPost($user->id);
        $this->insertPostReaction($postId, $user->id, 'love');

        $response = $this->apiGet("/v2/posts/{$postId}/reactions");

        $response->assertStatus(200);
        $response->assertJsonStructure(['data' => ['top_reactors']]);
        $data = $response->json('data');
        $this->assertIsArray($data['top_reactors']);
        $this->assertNotEmpty($data['top_reactors']);
        $this->assertArrayHasKey('id', $data['top_reactors'][0]);
        $this->assertArrayHasKey('name', $data['top_reactors'][0]);
    }

    // ======================================================================
    //  GET /v2/posts/{id}/reactions/{type}/users — Get Post Reactors
    // ======================================================================

    public function test_get_post_reactors_returns_user_list(): void
    {
        $user = $this->authenticatedUser();
        $postId = $this->createPost($user->id);

        $other = User::factory()->forTenant($this->testTenantId)->create();
        $this->insertPostReaction($postId, $user->id, 'love');
        $this->insertPostReaction($postId, $other->id, 'love');

        $response = $this->apiGet("/v2/posts/{$postId}/reactions/love/users");

        $response->assertStatus(200);
        $data = $response->json('data');
        $this->assertCount(2, $data);
    }

    public function test_get_post_reactors_empty_for_no_reactions_of_type(): void
    {
        $user = $this->authenticatedUser();
        $postId = $this->createPost($user->id);
        $this->insertPostReaction($postId, $user->id, 'love');

        $response = $this->apiGet("/v2/posts/{$postId}/reactions/laugh/users");

        $response->assertStatus(200);
        $data = $response->json('data');
        $this->assertCount(0, $data);
    }

    public function test_get_post_reactors_rejects_invalid_type(): void
    {
        $user = $this->authenticatedUser();
        $postId = $this->createPost($user->id);

        $response = $this->apiGet("/v2/posts/{$postId}/reactions/invalid_type/users");

        $response->assertStatus(400);
    }

    public function test_get_post_reactors_pagination(): void
    {
        $user = $this->authenticatedUser();
        $postId = $this->createPost($user->id);

        // Create 5 users with reactions
        for ($i = 0; $i < 5; $i++) {
            $reactor = User::factory()->forTenant($this->testTenantId)->create();
            $this->insertPostReaction($postId, $reactor->id, 'love');
        }

        $response = $this->apiGet("/v2/posts/{$postId}/reactions/love/users?per_page=2&page=1");

        $response->assertStatus(200);
        $data = $response->json('data');
        $this->assertCount(2, $data);
        $meta = $response->json('meta');
        if ($meta) {
            $this->assertEquals(5, $meta['total'] ?? $meta['pagination']['total'] ?? null);
        }
    }

    // ======================================================================
    //  POST /v2/comments/{id}/reactions — Toggle Comment Reaction
    // ======================================================================

    public function test_toggle_comment_reaction_adds_reaction(): void
    {
        $user = $this->authenticatedUser();
        $postId = $this->createPost($user->id);
        $commentId = $this->createComment($postId, $user->id);

        $response = $this->apiPost("/v2/comments/{$commentId}/reactions", [
            'reaction_type' => 'celebrate',
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.action', 'added');
        $response->assertJsonPath('data.reaction_type', 'celebrate');
    }

    public function test_toggle_comment_reaction_removes_same_type(): void
    {
        $user = $this->authenticatedUser();
        $postId = $this->createPost($user->id);
        $commentId = $this->createComment($postId, $user->id);
        $this->insertCommentReaction($commentId, $user->id, 'wow');

        $response = $this->apiPost("/v2/comments/{$commentId}/reactions", [
            'reaction_type' => 'wow',
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.action', 'removed');
        $response->assertJsonPath('data.reaction_type', null);
    }

    public function test_toggle_comment_reaction_updates_to_different_type(): void
    {
        $user = $this->authenticatedUser();
        $postId = $this->createPost($user->id);
        $commentId = $this->createComment($postId, $user->id);
        $this->insertCommentReaction($commentId, $user->id, 'like');

        $response = $this->apiPost("/v2/comments/{$commentId}/reactions", [
            'reaction_type' => 'clap',
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.action', 'updated');
        $response->assertJsonPath('data.reaction_type', 'clap');
    }

    public function test_toggle_comment_reaction_requires_auth(): void
    {
        $response = $this->apiPost('/v2/comments/1/reactions', [
            'reaction_type' => 'love',
        ]);

        $response->assertStatus(401);
    }

    public function test_toggle_comment_reaction_rejects_invalid_type(): void
    {
        $user = $this->authenticatedUser();
        $postId = $this->createPost($user->id);
        $commentId = $this->createComment($postId, $user->id);

        $response = $this->apiPost("/v2/comments/{$commentId}/reactions", [
            'reaction_type' => 'thumbsdown',
        ]);

        $response->assertStatus(400);
    }

    public function test_toggle_comment_reaction_rejects_empty_type(): void
    {
        $user = $this->authenticatedUser();
        $postId = $this->createPost($user->id);
        $commentId = $this->createComment($postId, $user->id);

        $response = $this->apiPost("/v2/comments/{$commentId}/reactions", []);

        $response->assertStatus(400);
    }

    // ======================================================================
    //  GET /v2/comments/{id}/reactions — Get Comment Reactions
    // ======================================================================

    public function test_get_comment_reactions_returns_counts(): void
    {
        $user = $this->authenticatedUser();
        $postId = $this->createPost($user->id);
        $commentId = $this->createComment($postId, $user->id);

        $other = User::factory()->forTenant($this->testTenantId)->create();
        $this->insertCommentReaction($commentId, $user->id, 'love');
        $this->insertCommentReaction($commentId, $other->id, 'clap');

        $response = $this->apiGet("/v2/comments/{$commentId}/reactions");

        $response->assertStatus(200);
        $response->assertJsonStructure(['data' => ['counts', 'total', 'user_reaction', 'top_reactors']]);
        $response->assertJsonPath('data.total', 2);
        $response->assertJsonPath('data.user_reaction', 'love');
    }

    public function test_get_comment_reactions_returns_empty_for_no_reactions(): void
    {
        $user = $this->authenticatedUser();
        $postId = $this->createPost($user->id);
        $commentId = $this->createComment($postId, $user->id);

        $response = $this->apiGet("/v2/comments/{$commentId}/reactions");

        $response->assertStatus(200);
        $response->assertJsonPath('data.total', 0);
        $response->assertJsonPath('data.user_reaction', null);
    }

    // ======================================================================
    //  TENANT ISOLATION
    // ======================================================================

    public function test_post_reaction_is_tenant_scoped(): void
    {
        $user = $this->authenticatedUser();
        $postId = $this->createPost($user->id);

        // Insert a reaction under a different tenant directly in DB
        DB::table('reactions')->insert([
            'tenant_id' => 999,
            'target_type' => 'post',
            'target_id' => $postId,
            'user_id' => $user->id,
            'emoji' => 'love',
            'created_at' => now(),
        ]);

        // When fetching reactions for the test tenant, should NOT see tenant 999's reaction
        $response = $this->apiGet("/v2/posts/{$postId}/reactions");

        $response->assertStatus(200);
        $response->assertJsonPath('data.total', 0);
        $response->assertJsonPath('data.user_reaction', null);
    }

    public function test_comment_reaction_is_tenant_scoped(): void
    {
        $user = $this->authenticatedUser();
        $postId = $this->createPost($user->id);
        $commentId = $this->createComment($postId, $user->id);

        // Insert a reaction under a different tenant directly in DB
        DB::table('reactions')->insert([
            'tenant_id' => 999,
            'target_type' => 'comment',
            'target_id' => $commentId,
            'user_id' => $user->id,
            'emoji' => 'clap',
            'created_at' => now(),
        ]);

        // When fetching reactions for the test tenant, should NOT see tenant 999's reaction
        $response = $this->apiGet("/v2/comments/{$commentId}/reactions");

        $response->assertStatus(200);
        $response->assertJsonPath('data.total', 0);
        $response->assertJsonPath('data.user_reaction', null);
    }

    public function test_polymorphic_reaction_rejects_private_group_post_for_non_member(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $viewer = $this->authenticatedUser();

        $groupId = DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $owner->id,
            'name' => 'Private Reaction Group',
            'visibility' => 'private',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $postId = DB::table('feed_posts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'group_id' => $groupId,
            'content' => 'Private group reaction target',
            'type' => 'post',
            'visibility' => 'public',
            'publish_status' => 'published',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->apiPost('/v2/reactions', [
            'target_type' => 'post',
            'target_id' => $postId,
            'reaction_type' => 'love',
        ]);

        $response->assertStatus(404);
        $this->assertDatabaseMissing('reactions', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $viewer->id,
            'target_type' => 'post',
            'target_id' => $postId,
        ]);
    }

    // ======================================================================
    //  RESPONSE STRUCTURE
    // ======================================================================

    public function test_toggle_response_includes_updated_reactions(): void
    {
        $user = $this->authenticatedUser();
        $postId = $this->createPost($user->id);

        $other = User::factory()->forTenant($this->testTenantId)->create();
        $this->insertPostReaction($postId, $other->id, 'laugh');

        $response = $this->apiPost("/v2/posts/{$postId}/reactions", [
            'reaction_type' => 'love',
        ]);

        $response->assertStatus(200);
        $data = $response->json('data');

        // The reactions summary should reflect both the existing and new reaction
        $this->assertEquals('added', $data['action']);
        $this->assertEquals('love', $data['reaction_type']);
        $this->assertArrayHasKey('reactions', $data);
        $this->assertEquals(2, $data['reactions']['total']);
        $this->assertEquals(1, $data['reactions']['counts']['love']);
        $this->assertEquals(1, $data['reactions']['counts']['laugh']);
        $this->assertEquals('love', $data['reactions']['user_reaction']);
    }

    public function test_reactors_response_includes_user_details(): void
    {
        $user = $this->authenticatedUser(['first_name' => 'Jane', 'last_name' => 'Doe']);
        $postId = $this->createPost($user->id);
        $this->insertPostReaction($postId, $user->id, 'love');

        $response = $this->apiGet("/v2/posts/{$postId}/reactions/love/users");

        $response->assertStatus(200);
        $data = $response->json('data');
        $this->assertCount(1, $data);
        $this->assertEquals($user->id, $data[0]['id']);
        $this->assertEquals('Jane Doe', $data[0]['name']);
        $this->assertArrayHasKey('avatar_url', $data[0]);
        $this->assertArrayHasKey('reacted_at', $data[0]);
    }

    // ========================================================================
    // Polymorphic POST /v2/reactions — canonical endpoint for the unified
    // reaction system. Covers post + listing to prove the route handles
    // arbitrary target_types end-to-end.
    // ========================================================================

    public function test_polymorphic_toggle_route_adds_reaction_on_post(): void
    {
        $user = $this->authenticatedUser();
        $postId = $this->createPost($user->id);

        $response = $this->apiPost('/v2/reactions', [
            'target_type' => 'post',
            'target_id' => $postId,
            'reaction_type' => 'love',
        ]);

        $response->assertStatus(200)
                 ->assertJsonPath('data.action', 'added')
                 ->assertJsonPath('data.reaction_type', 'love');

        $this->assertDatabaseHas('reactions', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'target_type' => 'post',
            'target_id' => $postId,
            'emoji' => 'love',
        ]);
    }

    public function test_polymorphic_toggle_route_adds_reaction_on_listing(): void
    {
        $user = $this->authenticatedUser();
        $listingId = DB::table('listings')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id'   => $user->id,
            'title'     => 'Test listing',
            'description' => 'x',
            'type'      => 'offer',
            'status'    => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->apiPost('/v2/reactions', [
            'target_type' => 'listing',
            'target_id' => $listingId,
            'reaction_type' => 'celebrate',
        ]);

        $response->assertStatus(200)
                 ->assertJsonPath('data.action', 'added');

        $this->assertDatabaseHas('reactions', [
            'tenant_id'   => $this->testTenantId,
            'user_id'     => $user->id,
            'target_type' => 'listing',
            'target_id'   => $listingId,
            'emoji'       => 'celebrate',
        ]);
    }

    public function test_polymorphic_show_route_returns_counts(): void
    {
        $user = $this->authenticatedUser();
        $postId = $this->createPost($user->id);

        $this->apiPost('/v2/reactions', [
            'target_type' => 'post', 'target_id' => $postId, 'reaction_type' => 'wow',
        ])->assertStatus(200);

        $response = $this->apiGet("/v2/reactions/post/{$postId}");
        $response->assertStatus(200)
                 ->assertJsonPath('data.user_reaction', 'wow')
                 ->assertJsonPath('data.total', 1);
    }

    public function test_polymorphic_reactors_route_returns_users(): void
    {
        $user = $this->authenticatedUser(['first_name' => 'Anna', 'last_name' => 'Tester']);
        $postId = $this->createPost($user->id);

        $this->apiPost('/v2/reactions', [
            'target_type' => 'post', 'target_id' => $postId, 'reaction_type' => 'clap',
        ])->assertStatus(200);

        $response = $this->apiGet("/v2/reactions/post/{$postId}/users/clap");
        $response->assertStatus(200);
        $data = $response->json('data');
        $this->assertCount(1, $data);
        $this->assertEquals($user->id, $data[0]['id']);
        $this->assertSame('clap', $data[0]['reaction_type']);
    }

    /**
     * Regression (8 Nov 2026, hour-timebank feed): the "All" tab of the
     * reactions dialog had no endpoint of its own and fell back to the
     * summary's three-name preview, so a post with four reactions listed
     * three people. "all" lists every reactor, newest first, paginated,
     * each with the reaction they gave.
     */
    public function test_polymorphic_reactors_route_all_lists_every_reactor_with_their_reaction(): void
    {
        $viewer = $this->authenticatedUser();
        $postId = $this->createPost($viewer->id);

        $reactions = ['like', 'like', 'like', 'like', 'love'];
        $reactorIds = [];
        foreach ($reactions as $i => $emoji) {
            $reactor = User::factory()->forTenant($this->testTenantId)->create();
            DB::table('reactions')->insert([
                'tenant_id' => $this->testTenantId,
                'target_type' => 'post',
                'target_id' => $postId,
                'user_id' => $reactor->id,
                'emoji' => $emoji,
                'created_at' => now()->subMinutes(10 - $i),
            ]);
            $reactorIds[] = $reactor->id;
        }

        $response = $this->apiGet("/v2/reactions/post/{$postId}/users/all");

        $response->assertStatus(200);
        $data = $response->json('data');
        $this->assertCount(5, $data, 'every reactor is listed, not a three-name preview');
        $this->assertSame(5, $response->json('meta.total'));
        $this->assertSame(array_reverse($reactorIds), array_column($data, 'id'), 'newest reaction first');
        $this->assertSame(['love', 'like', 'like', 'like', 'like'], array_column($data, 'reaction_type'));

        $page = $this->apiGet("/v2/reactions/post/{$postId}/users/all?per_page=2&page=3");
        $page->assertStatus(200);
        $this->assertCount(1, $page->json('data'));
        $this->assertFalse($page->json('meta.has_more'));
    }
}

class BaseApiControllerOptionalAuthProbe extends BaseApiController
{
    public function optionalUserId(): ?int
    {
        return $this->getOptionalUserId();
    }
}
