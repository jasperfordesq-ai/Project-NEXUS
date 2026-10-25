<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Safeguarding;

use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\Models\User;
use App\Services\GroupService;
use App\Services\SafeguardingInteractionPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\Laravel\TestCase;

class DirectedEngagementContactPolicyTest extends TestCase
{
    use DatabaseTransactions;

    public function test_denied_feed_mention_writes_no_post_or_mention(): void
    {
        $sender = $this->member();
        $mentioned = $this->member(['username' => 'protected_feed_mention']);
        Sanctum::actingAs($sender, ['*']);

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertManyLocalContactsAllowed')
            ->once()
            ->with($sender->id, [$mentioned->id], $this->testTenantId, 'feed_post_create')
            ->andThrow($this->denied());
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $content = 'A blocked post for @protected_feed_mention';
        $response = $this->apiPost('/v2/feed/posts', ['content' => $content]);

        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', 'VETTING_REQUIRED');
        $this->assertDatabaseMissing('feed_posts', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $sender->id,
            'content' => $content,
        ]);
        $this->assertDatabaseMissing('mentions', [
            'tenant_id' => $this->testTenantId,
            'mentioning_user_id' => $sender->id,
            'mentioned_user_id' => $mentioned->id,
        ]);
    }

    public function test_denied_idea_submission_writes_no_idea_or_notification(): void
    {
        $submitter = $this->member();
        $creator = $this->member();
        Sanctum::actingAs($submitter, ['*']);
        $challengeId = $this->challenge($creator->id);
        $notificationCount = $this->notificationCount($creator->id);

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertLocalContactAllowed')
            ->once()
            ->with($submitter->id, $creator->id, $this->testTenantId, 'ideation_idea_submission')
            ->andThrow($this->denied());
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $response = $this->apiPost("/v2/ideation-challenges/{$challengeId}/ideas", [
            'title' => 'Blocked safeguarding idea',
            'description' => 'This must never be persisted.',
        ]);

        $response->assertStatus(403);
        $this->assertDatabaseMissing('challenge_ideas', [
            'challenge_id' => $challengeId,
            'user_id' => $submitter->id,
            'title' => 'Blocked safeguarding idea',
        ]);
        $this->assertSame($notificationCount, $this->notificationCount($creator->id));
    }

    public function test_denied_idea_vote_writes_no_vote_or_notification(): void
    {
        $voter = $this->member();
        $author = $this->member();
        Sanctum::actingAs($voter, ['*']);
        $challengeId = $this->challenge($author->id);
        $ideaId = $this->idea($challengeId, $author->id);
        $notificationCount = $this->notificationCount($author->id);

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertLocalContactAllowed')
            ->once()
            ->with($voter->id, $author->id, $this->testTenantId, 'ideation_idea_vote')
            ->andThrow($this->denied());
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $response = $this->apiPost("/v2/ideation-ideas/{$ideaId}/vote");

        $response->assertStatus(403);
        $this->assertDatabaseMissing('challenge_idea_votes', [
            'idea_id' => $ideaId,
            'user_id' => $voter->id,
        ]);
        $this->assertSame(0, (int) DB::table('challenge_ideas')->where('id', $ideaId)->value('votes_count'));
        $this->assertSame($notificationCount, $this->notificationCount($author->id));
    }

    public function test_idea_unvote_remains_available_without_policy_check(): void
    {
        $voter = $this->member();
        $author = $this->member();
        Sanctum::actingAs($voter, ['*']);
        $challengeId = $this->challenge($author->id);
        $ideaId = $this->idea($challengeId, $author->id, ['votes_count' => 1]);
        DB::table('challenge_idea_votes')->insert([
            'idea_id' => $ideaId,
            'user_id' => $voter->id,
            'created_at' => now(),
        ]);

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldNotReceive('assertLocalContactAllowed');
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $response = $this->apiPost("/v2/ideation-ideas/{$ideaId}/vote");

        $response->assertOk();
        $response->assertJsonPath('data.voted', false);
        $this->assertDatabaseMissing('challenge_idea_votes', [
            'idea_id' => $ideaId,
            'user_id' => $voter->id,
        ]);
        $this->assertSame(0, (int) DB::table('challenge_ideas')->where('id', $ideaId)->value('votes_count'));
    }

    public function test_denied_challenge_favorite_writes_no_favorite(): void
    {
        $member = $this->member();
        $creator = $this->member();
        Sanctum::actingAs($member, ['*']);
        $challengeId = $this->challenge($creator->id);

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertLocalContactAllowed')
            ->once()
            ->with($member->id, $creator->id, $this->testTenantId, 'ideation_challenge_favorite')
            ->andThrow($this->denied());
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $response = $this->apiPost("/v2/ideation-challenges/{$challengeId}/favorite");

        $response->assertStatus(403);
        $this->assertDatabaseMissing('challenge_favorites', [
            'challenge_id' => $challengeId,
            'user_id' => $member->id,
        ]);
        $this->assertSame(0, (int) DB::table('ideation_challenges')->where('id', $challengeId)->value('favorites_count'));
    }

    public function test_challenge_unfavorite_remains_available_without_policy_check(): void
    {
        $member = $this->member();
        $creator = $this->member();
        Sanctum::actingAs($member, ['*']);
        $challengeId = $this->challenge($creator->id, ['favorites_count' => 1]);
        DB::table('challenge_favorites')->insert([
            'challenge_id' => $challengeId,
            'user_id' => $member->id,
            'created_at' => now(),
        ]);

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldNotReceive('assertLocalContactAllowed');
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $response = $this->apiPost("/v2/ideation-challenges/{$challengeId}/favorite");

        $response->assertOk();
        $response->assertJsonPath('data.favorited', false);
        $this->assertDatabaseMissing('challenge_favorites', [
            'challenge_id' => $challengeId,
            'user_id' => $member->id,
        ]);
        $this->assertSame(0, (int) DB::table('ideation_challenges')->where('id', $challengeId)->value('favorites_count'));
    }

    public function test_denied_community_project_support_writes_no_support(): void
    {
        $supporter = $this->member();
        $proposer = $this->member();
        Sanctum::actingAs($supporter, ['*']);
        $projectId = $this->communityProject($proposer->id);

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertLocalContactAllowed')
            ->once()
            ->with($supporter->id, $proposer->id, $this->testTenantId, 'community_project_support')
            ->andThrow($this->denied());
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $response = $this->apiPost("/v2/volunteering/community-projects/{$projectId}/support");

        $response->assertStatus(403);
        $this->assertDatabaseMissing('vol_community_project_supporters', [
            'tenant_id' => $this->testTenantId,
            'project_id' => $projectId,
            'user_id' => $supporter->id,
        ]);
        $this->assertSame(0, (int) DB::table('vol_community_projects')->where('id', $projectId)->value('supporter_count'));
    }

    public function test_community_project_unsupport_remains_available_without_policy_check(): void
    {
        $supporter = $this->member();
        $proposer = $this->member();
        Sanctum::actingAs($supporter, ['*']);
        $projectId = $this->communityProject($proposer->id, ['supporter_count' => 1]);
        DB::table('vol_community_project_supporters')->insert([
            'tenant_id' => $this->testTenantId,
            'project_id' => $projectId,
            'user_id' => $supporter->id,
            'supported_at' => now(),
        ]);

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldNotReceive('assertLocalContactAllowed');
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $response = $this->apiDelete("/v2/volunteering/community-projects/{$projectId}/support");

        $response->assertOk();
        $response->assertJsonPath('data.success', true);
        $this->assertDatabaseMissing('vol_community_project_supporters', [
            'tenant_id' => $this->testTenantId,
            'project_id' => $projectId,
            'user_id' => $supporter->id,
        ]);
        $this->assertSame(0, (int) DB::table('vol_community_projects')->where('id', $projectId)->value('supporter_count'));
    }

    public function test_denied_group_discussion_writes_no_discussion_or_post(): void
    {
        $author = $this->member();
        $owner = $this->member();
        $groupId = $this->group($owner->id);
        $this->addGroupMember($groupId, $author->id, 'active');
        Sanctum::actingAs($author, ['*']);

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertCommunitySpaceBroadcastAllowed')
            ->once()
            ->with($author->id, [$owner->id], [], $this->testTenantId, 'group_discussion_create')
            ->andThrow($this->denied());
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $response = $this->apiPost("/v2/groups/{$groupId}/discussions", [
            'title' => 'Blocked group discussion',
            'content' => 'This group broadcast must not be written.',
        ]);

        $response->assertStatus(403);
        $this->assertDatabaseMissing('group_discussions', [
            'group_id' => $groupId,
            'user_id' => $author->id,
            'title' => 'Blocked group discussion',
        ]);
        $this->assertSame(0, DB::table('group_posts')->where('user_id', $author->id)->count());
    }

    public function test_denied_group_qa_vote_writes_no_vote_or_counter_change(): void
    {
        $voter = $this->member();
        $owner = $this->member();
        $groupId = $this->group($owner->id);
        $this->addGroupMember($groupId, $voter->id, 'active');
        Sanctum::actingAs($voter, ['*']);
        $questionId = $this->question($groupId, $owner->id);

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertCommunitySpaceBroadcastAllowed')
            ->once()
            ->with($voter->id, [], [$owner->id], $this->testTenantId, 'group_qa_vote')
            ->andThrow($this->denied());
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $response = $this->apiPost("/v2/groups/{$groupId}/qa/vote", [
            'type' => 'question',
            'target_id' => $questionId,
            'vote' => 'up',
        ]);

        $response->assertStatus(403);
        $this->assertDatabaseMissing('group_qa_votes', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $voter->id,
            'votable_type' => 'question',
            'votable_id' => $questionId,
        ]);
        $this->assertSame(0, (int) DB::table('group_questions')->where('id', $questionId)->value('vote_count'));
    }

    public function test_group_qa_unvote_remains_available_without_policy_check(): void
    {
        $voter = $this->member();
        $owner = $this->member();
        $groupId = $this->group($owner->id);
        $this->addGroupMember($groupId, $voter->id, 'active');
        Sanctum::actingAs($voter, ['*']);
        $questionId = $this->question($groupId, $owner->id, 1);
        DB::table('group_qa_votes')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $voter->id,
            'votable_type' => 'question',
            'votable_id' => $questionId,
            'vote' => 1,
            'created_at' => now(),
        ]);

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldNotReceive('assertCommunitySpaceBroadcastAllowed');
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $response = $this->apiPost("/v2/groups/{$groupId}/qa/vote", [
            'type' => 'question',
            'target_id' => $questionId,
            'vote' => 'up',
        ]);

        $response->assertOk();
        $this->assertDatabaseMissing('group_qa_votes', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $voter->id,
            'votable_type' => 'question',
            'votable_id' => $questionId,
        ]);
        $this->assertSame(0, (int) DB::table('group_questions')->where('id', $questionId)->value('vote_count'));
    }

    public function test_denied_join_request_acceptance_leaves_membership_pending(): void
    {
        $owner = $this->member();
        $requester = $this->member();
        $groupId = $this->group($owner->id);
        $this->addGroupMember($groupId, $requester->id, 'pending');
        $cachedCount = (int) DB::table('groups')->where('id', $groupId)->value('cached_member_count');

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertCommunitySpaceContactAllowed')
            ->once()
            ->with($requester->id, $owner->id, $this->testTenantId, 'group_join_request_accept')
            ->andThrow($this->denied());
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        try {
            GroupService::handleJoinRequest($groupId, $requester->id, $owner->id, 'accept');
            $this->fail('Expected safeguarding policy denial.');
        } catch (SafeguardingPolicyException $e) {
            $this->assertSame('VETTING_REQUIRED', $e->reasonCode);
        }

        $this->assertDatabaseHas('group_members', [
            'group_id' => $groupId,
            'user_id' => $requester->id,
            'status' => 'pending',
        ]);
        $this->assertSame($cachedCount, (int) DB::table('groups')->where('id', $groupId)->value('cached_member_count'));
    }

    private function member(array $overrides = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));
        TenantContext::setById($this->testTenantId);

        return $user;
    }

    private function challenge(int $creatorId, array $overrides = []): int
    {
        return DB::table('ideation_challenges')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'user_id' => $creatorId,
            'title' => 'Safeguarding challenge',
            'description' => 'Challenge used by safeguarding contact tests.',
            'status' => 'open',
            'ideas_count' => 0,
            'favorites_count' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }

    private function idea(int $challengeId, int $authorId, array $overrides = []): int
    {
        return DB::table('challenge_ideas')->insertGetId(array_merge([
            'challenge_id' => $challengeId,
            'user_id' => $authorId,
            'title' => 'Safeguarding idea',
            'description' => 'Idea used by safeguarding contact tests.',
            'votes_count' => 0,
            'comments_count' => 0,
            'status' => 'submitted',
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }

    private function communityProject(int $proposerId, array $overrides = []): int
    {
        return DB::table('vol_community_projects')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'proposed_by' => $proposerId,
            'title' => 'Safeguarding community project',
            'description' => 'Project used by safeguarding contact tests.',
            'status' => 'approved',
            'supporter_count' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }

    private function group(int $ownerId): int
    {
        $group = GroupService::create($ownerId, [
            'name' => 'Safeguarding contact group ' . bin2hex(random_bytes(4)),
            'description' => 'Group used by safeguarding contact tests.',
            'visibility' => 'public',
        ]);
        $this->assertNotNull($group);
        // GroupCreated listeners restore their own scoped tenant context. Reset
        // the test tenant before any direct (non-HTTP) service invocation.
        TenantContext::setById($this->testTenantId);

        return (int) $group->id;
    }

    private function addGroupMember(int $groupId, int $userId, string $status): void
    {
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'user_id' => $userId,
            'role' => 'member',
            'status' => $status,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function question(int $groupId, int $authorId, int $voteCount = 0): int
    {
        return DB::table('group_questions')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'user_id' => $authorId,
            'title' => 'Safeguarding question title',
            'body' => 'Safeguarding question body.',
            'vote_count' => $voteCount,
            'answer_count' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function notificationCount(int $userId): int
    {
        return DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $userId)
            ->count();
    }

    private function denied(): SafeguardingPolicyException
    {
        return new SafeguardingPolicyException(
            'VETTING_REQUIRED',
            __('safeguarding.errors.vetting_required', ['types' => 'Enhanced DBS']),
        );
    }
}
