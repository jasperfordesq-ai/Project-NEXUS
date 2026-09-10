<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for StoryController — stories CRUD, views, reactions, polls, highlights.
 */
class StoryControllerTest extends TestCase
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
     * Insert a story directly into the database and return its ID.
     */
    private function createStoryRecord(int $userId, array $overrides = []): int
    {
        $data = array_merge([
            'tenant_id' => $this->testTenantId,
            'user_id' => $userId,
            'media_type' => 'text',
            'text_content' => 'Test story content',
            'duration' => 5,
            'is_active' => 1,
            'view_count' => 0,
            'expires_at' => now()->addHours(24)->format('Y-m-d H:i:s'),
            'created_at' => now(),
        ], $overrides);

        return DB::table('stories')->insertGetId($data);
    }

    // ------------------------------------------------------------------
    //  INDEX — GET /api/v2/stories
    // ------------------------------------------------------------------

    public function test_index_requires_authentication(): void
    {
        $response = $this->apiGet('/v2/stories');

        $response->assertStatus(401);
    }

    public function test_index_returns_data(): void
    {
        $user = $this->authenticatedUser();

        $this->createStoryRecord($user->id);

        $response = $this->apiGet('/v2/stories');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_index_returns_empty_when_no_stories(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/stories');

        $response->assertStatus(200);
        $response->assertJsonPath('data', []);
    }

    // ------------------------------------------------------------------
    //  USER STORIES — GET /api/v2/stories/user/{userId}
    // ------------------------------------------------------------------

    public function test_user_stories_requires_authentication(): void
    {
        $response = $this->apiGet('/v2/stories/user/1');

        $response->assertStatus(401);
    }

    public function test_user_stories_returns_stories(): void
    {
        $user = $this->authenticatedUser();
        $storyUser = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);

        $this->createStoryRecord($storyUser->id);

        $response = $this->apiGet("/v2/stories/user/{$storyUser->id}");

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_user_stories_returns_empty_for_user_without_stories(): void
    {
        $this->authenticatedUser();
        $otherUser = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);

        $response = $this->apiGet("/v2/stories/user/{$otherUser->id}");

        $response->assertStatus(200);
        $response->assertJsonPath('data', []);
    }

    // ------------------------------------------------------------------
    //  STORE — POST /api/v2/stories
    // ------------------------------------------------------------------

    public function test_store_requires_authentication(): void
    {
        $response = $this->apiPost('/v2/stories', [
            'media_type' => 'text',
            'text_content' => 'Hello world',
        ]);

        $response->assertStatus(401);
    }

    public function test_store_creates_text_story(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/stories', [
            'media_type' => 'text',
            'text_content' => 'This is my text story',
            'background_color' => '#FF5733',
            'duration' => 5,
        ]);

        $this->assertContains($response->getStatusCode(), [200, 201]);
        $response->assertJsonStructure(['data']);
    }

    public function test_store_fails_for_text_story_without_content(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/stories', [
            'media_type' => 'text',
        ]);

        $response->assertStatus(400);
    }

    public function test_store_fails_for_image_story_without_media(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/stories', [
            'media_type' => 'image',
        ]);

        $response->assertStatus(400);
    }

    // ------------------------------------------------------------------
    //  VIEW — POST /api/v2/stories/{id}/view
    // ------------------------------------------------------------------

    public function test_view_requires_authentication(): void
    {
        $response = $this->apiPost('/v2/stories/1/view');

        $response->assertStatus(401);
    }

    public function test_view_marks_story_as_viewed(): void
    {
        $viewer = $this->authenticatedUser();
        $storyOwner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);

        $storyId = $this->createStoryRecord($storyOwner->id);

        $response = $this->apiPost("/v2/stories/{$storyId}/view");

        $response->assertStatus(200);
        $response->assertJsonPath('data.viewed', true);
    }

    public function test_view_of_nonexistent_story_is_not_found(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/stories/999999/view');

        // Until 2026-09-10 this answered 200 {"viewed": true} for a story that
        // does not exist — and, identically, for a story in ANOTHER community,
        // which the cross-community write sweep flagged. The service now
        // reports whether the story was found in this community and the
        // controller refuses with 404 when it was not.
        $response->assertStatus(404);
        $response->assertJsonPath('errors.0.code', 'NOT_FOUND');
    }

    // ------------------------------------------------------------------
    //  VIEWERS — GET /api/v2/stories/{id}/viewers
    // ------------------------------------------------------------------

    public function test_viewers_requires_authentication(): void
    {
        $response = $this->apiGet('/v2/stories/1/viewers');

        $response->assertStatus(401);
    }

    public function test_viewers_returns_list_for_owner(): void
    {
        $owner = $this->authenticatedUser();
        $storyId = $this->createStoryRecord($owner->id);

        $response = $this->apiGet("/v2/stories/{$storyId}/viewers");

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_viewers_rejects_non_owner(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $storyId = $this->createStoryRecord($owner->id);

        $this->authenticatedUser(); // Different user

        $response = $this->apiGet("/v2/stories/{$storyId}/viewers");

        $response->assertStatus(403);
    }

    // ------------------------------------------------------------------
    //  REACT — POST /api/v2/stories/{id}/react
    // ------------------------------------------------------------------

    public function test_react_requires_authentication(): void
    {
        $response = $this->apiPost('/v2/stories/1/react', ['reaction_type' => 'heart']);

        $response->assertStatus(401);
    }

    public function test_react_adds_reaction(): void
    {
        $user = $this->authenticatedUser();
        $storyOwner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $storyId = $this->createStoryRecord($storyOwner->id);

        $response = $this->apiPost("/v2/stories/{$storyId}/react", [
            'reaction_type' => 'heart',
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.reacted', true);
    }

    public function test_react_fails_without_reaction_type(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/stories/1/react', []);

        $response->assertStatus(400);
    }

    public function test_react_fails_for_nonexistent_story(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/stories/999999/react', [
            'reaction_type' => 'heart',
        ]);

        // The controller resolves the story up-front and returns NOT_FOUND (404)
        // when it does not exist for the current tenant.
        $response->assertStatus(404);
    }

    public function test_react_fails_for_invalid_reaction_type(): void
    {
        $user = $this->authenticatedUser();
        $storyOwner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $storyId = $this->createStoryRecord($storyOwner->id);

        $response = $this->apiPost("/v2/stories/{$storyId}/react", [
            'reaction_type' => 'invalid_emoji',
        ]);

        $response->assertStatus(400);
    }

    // ------------------------------------------------------------------
    //  DELETE — DELETE /api/v2/stories/{id}
    // ------------------------------------------------------------------

    public function test_destroy_requires_authentication(): void
    {
        $response = $this->apiDelete('/v2/stories/1');

        $response->assertStatus(401);
    }

    public function test_owner_can_delete_story(): void
    {
        $owner = $this->authenticatedUser();
        $storyId = $this->createStoryRecord($owner->id);

        $response = $this->apiDelete("/v2/stories/{$storyId}");

        $response->assertStatus(200);
        $response->assertJsonPath('data.deleted', true);
    }

    public function test_non_owner_cannot_delete_story(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $storyId = $this->createStoryRecord($owner->id);

        $this->authenticatedUser(); // Different user

        $response = $this->apiDelete("/v2/stories/{$storyId}");

        $response->assertStatus(403);
    }

    public function test_delete_nonexistent_story(): void
    {
        $this->authenticatedUser();

        $response = $this->apiDelete('/v2/stories/999999');

        $response->assertStatus(403);
    }

    // ------------------------------------------------------------------
    //  POLL VOTE — POST /api/v2/stories/{id}/poll/vote
    // ------------------------------------------------------------------

    public function test_poll_vote_requires_authentication(): void
    {
        $response = $this->apiPost('/v2/stories/1/poll/vote', ['option_index' => 0]);

        $response->assertStatus(401);
    }

    public function test_poll_vote_fails_without_option_index(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/stories/1/poll/vote', []);

        $response->assertStatus(400);
    }

    public function test_poll_vote_succeeds_on_poll_story(): void
    {
        $user = $this->authenticatedUser();
        $storyOwner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);

        $storyId = $this->createStoryRecord($storyOwner->id, [
            'media_type' => 'poll',
            'poll_question' => 'Favorite color?',
            'poll_options' => json_encode(['Red', 'Blue', 'Green']),
        ]);

        $response = $this->apiPost("/v2/stories/{$storyId}/poll/vote", [
            'option_index' => 1,
        ]);

        $response->assertStatus(200);
        $response->assertJsonStructure(['data' => ['votes', 'total_votes']]);
    }

    public function test_poll_vote_fails_on_non_poll_story(): void
    {
        $user = $this->authenticatedUser();
        $storyOwner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);

        $storyId = $this->createStoryRecord($storyOwner->id, [
            'media_type' => 'text',
        ]);

        $response = $this->apiPost("/v2/stories/{$storyId}/poll/vote", [
            'option_index' => 0,
        ]);

        $response->assertStatus(400);
    }

    public function test_poll_vote_fails_for_invalid_option_index(): void
    {
        $user = $this->authenticatedUser();
        $storyOwner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);

        $storyId = $this->createStoryRecord($storyOwner->id, [
            'media_type' => 'poll',
            'poll_question' => 'Favorite color?',
            'poll_options' => json_encode(['Red', 'Blue']),
        ]);

        $response = $this->apiPost("/v2/stories/{$storyId}/poll/vote", [
            'option_index' => 99,
        ]);

        $response->assertStatus(400);
    }

    public function test_poll_double_vote_fails(): void
    {
        $user = $this->authenticatedUser();
        $storyOwner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);

        $storyId = $this->createStoryRecord($storyOwner->id, [
            'media_type' => 'poll',
            'poll_question' => 'Best day?',
            'poll_options' => json_encode(['Monday', 'Friday']),
        ]);

        // First vote
        $this->apiPost("/v2/stories/{$storyId}/poll/vote", ['option_index' => 0]);

        // Second vote
        $response = $this->apiPost("/v2/stories/{$storyId}/poll/vote", ['option_index' => 1]);

        $response->assertStatus(400);
    }

    // ------------------------------------------------------------------
    //  HIGHLIGHTS — GET /api/v2/stories/highlights/{userId}
    // ------------------------------------------------------------------

    public function test_highlights_requires_authentication(): void
    {
        $response = $this->apiGet('/v2/stories/highlights/1');

        $response->assertStatus(401);
    }

    public function test_highlights_returns_data(): void
    {
        $user = $this->authenticatedUser();

        $response = $this->apiGet("/v2/stories/highlights/{$user->id}");

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    // ------------------------------------------------------------------
    //  CREATE HIGHLIGHT — POST /api/v2/stories/highlights
    // ------------------------------------------------------------------

    public function test_create_highlight_requires_authentication(): void
    {
        $response = $this->apiPost('/v2/stories/highlights', ['title' => 'My Highlight']);

        $response->assertStatus(401);
    }

    public function test_create_highlight_requires_title(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/stories/highlights', []);

        $response->assertStatus(400);
    }

    public function test_create_highlight_succeeds(): void
    {
        $user = $this->authenticatedUser();

        $response = $this->apiPost('/v2/stories/highlights', [
            'title' => 'My Best Stories',
        ]);

        $this->assertContains($response->getStatusCode(), [200, 201]);
        $response->assertJsonStructure(['data']);
    }

    public function test_create_highlight_with_story_ids(): void
    {
        $user = $this->authenticatedUser();
        $storyId = $this->createStoryRecord($user->id);

        $response = $this->apiPost('/v2/stories/highlights', [
            'title' => 'Highlight With Stories',
            'story_ids' => [$storyId],
        ]);

        $this->assertContains($response->getStatusCode(), [200, 201]);
    }

    // ------------------------------------------------------------------
    //  HIGHLIGHT STORIES — GET /api/v2/stories/highlights/{id}/stories
    // ------------------------------------------------------------------

    public function test_highlight_stories_requires_authentication(): void
    {
        $response = $this->apiGet('/v2/stories/highlights/1/stories');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  ADD HIGHLIGHT ITEM — POST /api/v2/stories/highlights/{id}/items
    // ------------------------------------------------------------------

    public function test_add_highlight_item_requires_authentication(): void
    {
        $response = $this->apiPost('/v2/stories/highlights/1/items', ['story_id' => 1]);

        $response->assertStatus(401);
    }

    public function test_add_highlight_item_requires_story_id(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/stories/highlights/1/items', []);

        $response->assertStatus(400);
    }

    // ------------------------------------------------------------------
    //  DELETE HIGHLIGHT — DELETE /api/v2/stories/highlights/{id}
    // ------------------------------------------------------------------

    public function test_delete_highlight_requires_authentication(): void
    {
        $response = $this->apiDelete('/v2/stories/highlights/1');

        $response->assertStatus(401);
    }

    public function test_owner_can_delete_highlight(): void
    {
        $user = $this->authenticatedUser();

        // Create highlight directly
        DB::table('story_highlights')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'title' => 'To Delete',
            'display_order' => 1,
            'created_at' => now(),
        ]);
        $highlightId = DB::getPdo()->lastInsertId();

        $response = $this->apiDelete("/v2/stories/highlights/{$highlightId}");

        $response->assertStatus(200);
        $response->assertJsonPath('data.deleted', true);
    }

    public function test_non_owner_cannot_delete_highlight(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);

        DB::table('story_highlights')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'title' => 'Protected',
            'display_order' => 1,
            'created_at' => now(),
        ]);
        $highlightId = DB::getPdo()->lastInsertId();

        $this->authenticatedUser(); // Different user

        $response = $this->apiDelete("/v2/stories/highlights/{$highlightId}");

        $response->assertStatus(403);
    }

    // ------------------------------------------------------------------
    //  TENANT ISOLATION
    // ------------------------------------------------------------------

    public function test_cannot_view_other_tenant_story_viewers(): void
    {
        $otherUser = User::factory()->forTenant(999)->create(['status' => 'active']);

        $storyId = DB::table('stories')->insertGetId([
            'tenant_id' => 999,
            'user_id' => $otherUser->id,
            'media_type' => 'text',
            'text_content' => 'Other tenant story',
            'duration' => 5,
            'is_active' => 1,
            'view_count' => 0,
            'expires_at' => now()->addHours(24)->format('Y-m-d H:i:s'),
            'created_at' => now(),
        ]);

        $this->authenticatedUser(); // Our tenant user

        $response = $this->apiGet("/v2/stories/{$storyId}/viewers");

        // Should fail because story is in different tenant
        $this->assertContains($response->getStatusCode(), [403, 404, 500]);
    }

    public function test_cannot_delete_other_tenant_story(): void
    {
        $otherUser = User::factory()->forTenant(999)->create(['status' => 'active']);

        $storyId = DB::table('stories')->insertGetId([
            'tenant_id' => 999,
            'user_id' => $otherUser->id,
            'media_type' => 'text',
            'text_content' => 'Other tenant story',
            'duration' => 5,
            'is_active' => 1,
            'view_count' => 0,
            'expires_at' => now()->addHours(24)->format('Y-m-d H:i:s'),
            'created_at' => now(),
        ]);

        $this->authenticatedUser(); // Our tenant user

        $response = $this->apiDelete("/v2/stories/{$storyId}");

        $response->assertStatus(403);
    }

    public function test_expired_stories_not_in_feed(): void
    {
        $user = $this->authenticatedUser();

        // Create an expired story
        $this->createStoryRecord($user->id, [
            'expires_at' => now()->subHour()->format('Y-m-d H:i:s'),
        ]);

        $response = $this->apiGet('/v2/stories');

        $response->assertStatus(200);
        // Expired stories should not appear in the feed
        $data = $response->json('data');
        $this->assertEmpty($data);
    }

    public function test_inactive_stories_not_in_user_stories(): void
    {
        $user = $this->authenticatedUser();

        // Create an inactive story
        $this->createStoryRecord($user->id, [
            'is_active' => 0,
        ]);

        $response = $this->apiGet("/v2/stories/user/{$user->id}");

        $response->assertStatus(200);
        $data = $response->json('data');
        $this->assertEmpty($data);
    }
}
