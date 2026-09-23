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
use App\Models\Tenant;
use App\Models\User;

/**
 * Feature tests for IdeationChallengesController — ideation challenges, ideas, voting.
 */
class IdeationChallengesControllerTest extends TestCase
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
    //  GET /v2/ideation-challenges
    // ------------------------------------------------------------------

    public function test_index_requires_authentication(): void
    {
        $this->apiGet('/v2/ideation-challenges')->assertStatus(401);
    }

    public function test_index_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/ideation-challenges');

        $response->assertStatus(200);
    }

    public function test_member_cannot_enumerate_draft_challenges_by_filter_or_id(): void
    {
        $viewer = $this->authenticatedUser();
        $creator = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $draftId = DB::table('ideation_challenges')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $creator->id,
            'title' => 'Private draft challenge',
            'description' => 'This draft must remain hidden.',
            'status' => 'draft',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('ideation_challenges')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $creator->id,
            'title' => 'Published open challenge',
            'description' => 'This challenge is member-visible.',
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $list = $this->apiGet('/v2/ideation-challenges?status=draft');
        $list->assertOk();
        $this->assertNotContains($draftId, array_map('intval', array_column($list->json('data'), 'id')));
        $this->apiGet("/v2/ideation-challenges/{$draftId}")->assertNotFound();
        $this->assertNotSame($viewer->id, $creator->id);
    }

    // ------------------------------------------------------------------
    //  POST /v2/ideation-challenges
    // ------------------------------------------------------------------

    public function test_store_requires_auth(): void
    {
        $response = $this->apiPost('/v2/ideation-challenges', [
            'title' => 'New Challenge',
            'description' => 'A test challenge',
        ]);

        $response->assertStatus(401);
    }

    public function test_store_creates_challenge_against_current_schema(): void
    {
        $user = $this->authenticatedUser();

        $response = $this->apiPost('/v2/ideation-challenges', [
            'title' => 'Community welcome challenge',
            'description' => 'Gather practical ideas for helping new members feel welcome.',
            'status' => 'open',
            'submission_deadline' => '2026-06-15 09:00:00',
            'voting_deadline' => '2026-06-20 09:00:00',
        ]);

        $response->assertStatus(201);
        $id = $response->json('data.id');

        $this->assertDatabaseHas('ideation_challenges', [
            'id' => $id,
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'title' => 'Community welcome challenge',
            'description' => 'Gather practical ideas for helping new members feel welcome.',
            'status' => 'open',
            'submission_deadline' => '2026-06-15 09:00:00',
            'voting_deadline' => '2026-06-20 09:00:00',
        ]);
    }

    // ------------------------------------------------------------------
    //  GET /v2/ideation-challenges/{id}
    // ------------------------------------------------------------------

    public function test_show_requires_authentication(): void
    {
        $this->apiGet('/v2/ideation-challenges/1')->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  GET /v2/ideation-challenges/{id}/ideas
    // ------------------------------------------------------------------

public function test_ideas_requires_auth(): void
    {
        $response = $this->apiGet('/v2/ideation-challenges/1/ideas');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  POST /v2/ideation-challenges/{id}/ideas
    // ------------------------------------------------------------------

    public function test_submit_idea_requires_auth(): void
    {
        $response = $this->apiPost('/v2/ideation-challenges/1/ideas', [
            'title' => 'My Idea',
            'description' => 'A great idea',
        ]);

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  GET /v2/ideation-ideas/{id}
    // ------------------------------------------------------------------

    public function test_show_idea_requires_auth(): void
    {
        $response = $this->apiGet('/v2/ideation-ideas/1');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  POST /v2/ideation-ideas/{id}/vote
    // ------------------------------------------------------------------

    public function test_vote_idea_requires_auth(): void
    {
        $response = $this->apiPost('/v2/ideation-ideas/1/vote');

        $response->assertStatus(401);
    }

    public function test_idea_list_cannot_read_a_foreign_tenant_through_its_parent_id(): void
    {
        $this->authenticatedUser();
        $victimTenant = Tenant::factory()->create();
        $victim = User::factory()->forTenant((int) $victimTenant->id)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $foreignChallenge = $this->createChallengeForTenant((int) $victimTenant->id, (int) $victim->id, 'open');
        $this->createIdea($foreignChallenge, (int) $victim->id, 'submitted', 'Foreign tenant secret');

        $this->apiGet("/v2/ideation-challenges/{$foreignChallenge}/ideas")
            ->assertNotFound()
            ->assertJsonMissing(['title' => 'Foreign tenant secret']);
    }

    public function test_member_idea_reads_hide_drafts_withdrawals_and_unpublished_challenges(): void
    {
        $viewer = $this->authenticatedUser();
        $owner = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $openChallenge = $this->createOpenChallenge((int) $owner->id);
        $submitted = $this->createIdea($openChallenge, (int) $owner->id, 'submitted', 'Published idea');
        $draft = $this->createIdea($openChallenge, (int) $owner->id, 'draft', 'Private draft idea');
        $withdrawn = $this->createIdea($openChallenge, (int) $owner->id, 'withdrawn', 'Withdrawn idea');
        $draftChallenge = $this->createChallengeForTenant($this->testTenantId, (int) $owner->id, 'draft');
        $ideaUnderDraftChallenge = $this->createIdea(
            $draftChallenge,
            (int) $owner->id,
            'submitted',
            'Idea under unpublished challenge'
        );

        $response = $this->apiGet("/v2/ideation-challenges/{$openChallenge}/ideas")->assertOk();
        $ids = array_map('intval', array_column($response->json('data'), 'id'));
        $this->assertContains($submitted, $ids);
        $this->assertNotContains($draft, $ids);
        $this->assertNotContains($withdrawn, $ids);

        $this->apiGet("/v2/ideation-ideas/{$draft}")->assertNotFound();
        $this->apiGet("/v2/ideation-ideas/{$withdrawn}")->assertNotFound();
        $this->apiGet("/v2/ideation-challenges/{$draftChallenge}/ideas")->assertNotFound();
        $this->apiGet("/v2/ideation-ideas/{$ideaUnderDraftChallenge}")->assertNotFound();
        $this->assertNotSame($viewer->id, $owner->id);
    }

    public function test_comments_and_media_do_not_republish_a_hidden_idea(): void
    {
        $this->authenticatedUser();
        $owner = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $challengeId = $this->createOpenChallenge((int) $owner->id);
        $draftId = $this->createIdea($challengeId, (int) $owner->id, 'draft', 'Hidden idea with side data');
        DB::table('challenge_idea_comments')->insert([
            'idea_id' => $draftId,
            'user_id' => $owner->id,
            'body' => 'Hidden comment body',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('idea_media')->insert([
            'idea_id' => $draftId,
            'tenant_id' => $this->testTenantId,
            'media_type' => 'document',
            'url' => 'https://example.invalid/private-draft.pdf',
            'caption' => 'Hidden media caption',
            'sort_order' => 0,
            'created_at' => now(),
        ]);

        $this->apiGet("/v2/ideation-ideas/{$draftId}/comments")
            ->assertNotFound()
            ->assertJsonMissing(['body' => 'Hidden comment body']);
        $this->apiGet("/v2/ideation-ideas/{$draftId}/media")
            ->assertNotFound()
            ->assertJsonMissing(['caption' => 'Hidden media caption']);
    }

    public function test_idea_author_and_admin_retain_hidden_idea_access(): void
    {
        $author = $this->authenticatedUser();
        $challengeId = $this->createOpenChallenge((int) $author->id);
        $draftId = $this->createIdea($challengeId, (int) $author->id, 'draft', 'Author draft');
        $withdrawnId = $this->createIdea($challengeId, (int) $author->id, 'withdrawn', 'Author withdrawal');

        $this->apiGet("/v2/ideation-ideas/{$draftId}")->assertOk();
        $this->apiGet("/v2/ideation-ideas/{$withdrawnId}")->assertOk();

        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($admin, ['*']);
        $adminList = $this->apiGet("/v2/ideation-challenges/{$challengeId}/ideas")->assertOk();
        $adminIds = array_map('intval', array_column($adminList->json('data'), 'id'));
        $this->assertContains($draftId, $adminIds);
        $this->assertContains($withdrawnId, $adminIds);
    }

    public function test_native_idea_submission_replays_one_accepted_write_and_rejects_changed_content(): void
    {
        $user = $this->authenticatedUser();
        $challengeId = $this->createOpenChallenge((int) $user->id);
        $headers = ['Idempotency-Key' => 'mobile-idea-submit-replay-1'];

        $first = $this->apiPost("/v2/ideation-challenges/{$challengeId}/ideas", [
            'title' => 'A shared tool library',
            'description' => 'Create one place where neighbours can borrow tools.',
        ], $headers)->assertCreated();
        $replay = $this->apiPost("/v2/ideation-challenges/{$challengeId}/ideas", [
            'title' => 'A shared tool library',
            'description' => 'Create one place where neighbours can borrow tools.',
        ], $headers)->assertCreated();

        self::assertSame($first->json('data.id'), $replay->json('data.id'));
        self::assertSame(1, DB::table('challenge_ideas')->where('challenge_id', $challengeId)->count());

        $this->apiPost("/v2/ideation-challenges/{$challengeId}/ideas", [
            'title' => 'Changed intent',
            'description' => 'This must not inherit the earlier operation key.',
        ], $headers)
            ->assertStatus(409)
            ->assertJsonPath('errors.0.code', 'IDEMPOTENCY_CONFLICT');
        self::assertSame(1, DB::table('challenge_ideas')->where('challenge_id', $challengeId)->count());
    }

    public function test_native_comment_replay_preserves_one_comment_and_counter(): void
    {
        $user = $this->authenticatedUser();
        $challengeId = $this->createOpenChallenge((int) $user->id);
        $ideaId = $this->createIdea($challengeId, (int) $user->id);
        $headers = ['Idempotency-Key' => 'mobile-idea-comment-replay-1'];

        $first = $this->apiPost("/v2/ideation-ideas/{$ideaId}/comments", ['body' => 'I can help with this.'], $headers)
            ->assertCreated();
        DB::table('challenge_idea_comments')->insert([
            'idea_id' => $ideaId,
            'user_id' => $user->id,
            'body' => 'A newer unrelated comment',
            'created_at' => now()->addSecond(),
            'updated_at' => now()->addSecond(),
        ]);
        $replay = $this->apiPost("/v2/ideation-ideas/{$ideaId}/comments", ['body' => 'I can help with this.'], $headers)
            ->assertCreated();

        self::assertSame($first->json('data.id'), $replay->json('data.id'));
        self::assertSame('I can help with this.', $replay->json('data.body'));
        self::assertSame(1, DB::table('challenge_idea_comments')->where('idea_id', $ideaId)->where('body', 'I can help with this.')->count());
        self::assertSame(1, (int) DB::table('challenge_ideas')->where('id', $ideaId)->value('comments_count'));
    }

    public function test_native_vote_replay_cannot_reverse_an_accepted_vote(): void
    {
        $voter = $this->authenticatedUser();
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $challengeId = $this->createOpenChallenge((int) $owner->id);
        $ideaId = $this->createIdea($challengeId, (int) $owner->id);
        $headers = ['Idempotency-Key' => 'mobile-idea-vote-replay-1'];

        $first = $this->apiPost("/v2/ideation-ideas/{$ideaId}/vote", ['voted' => true], $headers)
            ->assertOk()
            ->assertJsonPath('data.voted', true)
            ->assertJsonPath('data.votes_count', 1);
        $replay = $this->apiPost("/v2/ideation-ideas/{$ideaId}/vote", ['voted' => true], $headers)
            ->assertOk()
            ->assertJsonPath('data.voted', true)
            ->assertJsonPath('data.votes_count', 1);

        self::assertSame($first->json('data'), $replay->json('data'));
        self::assertSame(1, DB::table('challenge_idea_votes')->where('idea_id', $ideaId)->where('user_id', $voter->id)->count());
        self::assertSame(1, (int) DB::table('challenge_ideas')->where('id', $ideaId)->value('votes_count'));

        $this->apiPost("/v2/ideation-ideas/{$ideaId}/vote", ['voted' => false], $headers)
            ->assertStatus(409)
            ->assertJsonPath('errors.0.code', 'IDEMPOTENCY_CONFLICT');
        self::assertSame(1, DB::table('challenge_idea_votes')->where('idea_id', $ideaId)->where('user_id', $voter->id)->count());
    }

    public function test_idea_submission_eligibility_is_enforced_and_explained_by_the_server(): void
    {
        $user = $this->authenticatedUser();

        $closedId = $this->createOpenChallenge((int) $user->id);
        DB::table('ideation_challenges')->where('id', $closedId)->update(['status' => 'voting']);
        $this->apiGet("/v2/ideation-challenges/{$closedId}")
            ->assertOk()
            ->assertJsonPath('data.accepting_submissions', false)
            ->assertJsonPath('data.submission_unavailable_reason', 'phase');
        $this->apiPost("/v2/ideation-challenges/{$closedId}/ideas", [
            'title' => 'Too late',
            'description' => 'The voting phase must not accept this.',
        ])->assertStatus(409)->assertJsonPath('errors.0.code', 'IDEATION_SUBMISSION_CLOSED');

        $deadlineId = $this->createOpenChallenge((int) $user->id);
        DB::table('ideation_challenges')->where('id', $deadlineId)->update([
            'submission_deadline' => now()->subMinute(),
        ]);
        $this->apiPost("/v2/ideation-challenges/{$deadlineId}/ideas", [
            'title' => 'After deadline',
            'description' => 'The elapsed deadline must be authoritative.',
        ])->assertStatus(409)->assertJsonPath('errors.0.code', 'IDEATION_SUBMISSION_DEADLINE');

        $limitedId = $this->createOpenChallenge((int) $user->id);
        DB::table('ideation_challenges')->where('id', $limitedId)->update(['max_ideas_per_user' => 1]);
        $this->createIdea($limitedId, (int) $user->id);
        $this->apiGet("/v2/ideation-challenges/{$limitedId}")
            ->assertOk()
            ->assertJsonPath('data.user_idea_count', 1)
            ->assertJsonPath('data.accepting_submissions', false)
            ->assertJsonPath('data.submission_unavailable_reason', 'limit');
        $this->apiPost("/v2/ideation-challenges/{$limitedId}/ideas", [
            'title' => 'Over limit',
            'description' => 'The member has already used their allowance.',
        ])->assertStatus(409)->assertJsonPath('errors.0.code', 'IDEATION_SUBMISSION_LIMIT');

        self::assertSame(1, DB::table('challenge_ideas')->where('challenge_id', $limitedId)->count());
    }

    private function createOpenChallenge(int $ownerId): int
    {
        return DB::table('ideation_challenges')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'title' => 'Neighbourhood improvements',
            'description' => 'Share practical improvements for the area.',
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function createChallengeForTenant(int $tenantId, int $ownerId, string $status): int
    {
        return DB::table('ideation_challenges')->insertGetId([
            'tenant_id' => $tenantId,
            'user_id' => $ownerId,
            'title' => 'Scoped challenge ' . uniqid('', false),
            'description' => 'A challenge used to verify tenant and lifecycle visibility.',
            'status' => $status,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function createIdea(
        int $challengeId,
        int $ownerId,
        string $status = 'submitted',
        string $title = 'Tool library'
    ): int
    {
        return DB::table('challenge_ideas')->insertGetId([
            'challenge_id' => $challengeId,
            'user_id' => $ownerId,
            'title' => $title,
            'description' => 'Share useful tools.',
            'votes_count' => 0,
            'comments_count' => 0,
            'status' => $status,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    // ------------------------------------------------------------------
    //  GET /v2/ideation-categories
    // ------------------------------------------------------------------

    public function test_categories_requires_auth(): void
    {
        $response = $this->apiGet('/v2/ideation-categories');

        $response->assertStatus(401);
    }

    public function test_categories_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/ideation-categories');

        $response->assertStatus(200);
    }

    // ------------------------------------------------------------------
    //  GET /v2/ideation-tags/popular
    // ------------------------------------------------------------------

    public function test_popular_tags_requires_auth(): void
    {
        $response = $this->apiGet('/v2/ideation-tags/popular');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  GET /v2/ideation-templates
    // ------------------------------------------------------------------

    public function test_templates_requires_auth(): void
    {
        $response = $this->apiGet('/v2/ideation-templates');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  GET /v2/ideation-campaigns
    // ------------------------------------------------------------------

    public function test_campaigns_requires_auth(): void
    {
        $response = $this->apiGet('/v2/ideation-campaigns');

        $response->assertStatus(401);
    }
}
