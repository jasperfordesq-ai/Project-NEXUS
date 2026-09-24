<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E035;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\BlockUserService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Laravel\TestCase;

/**
 * F-158 — the F-070 block rules did not reach likes (v2 and legacy), story
 * reactions, the legacy share endpoint, or poll votes and ranked ballots. Each
 * one notified the member who had blocked the actor. A like/unlike loop also
 * sent a fresh notification on every like.
 */
class BlockedEngagementGapsTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        $this->app['auth']->forgetGuards();
        Cache::flush();
        $this->enableFeatures(['feed', 'polls', 'stories']);
    }

    /** @return array<string, array{string}> */
    public static function blockDirections(): array
    {
        return [
            'the owner blocked the actor' => ['owner_blocked_actor'],
            'the actor blocked the owner' => ['actor_blocked_owner'],
        ];
    }

    #[DataProvider('blockDirections')]
    public function test_blocked_member_cannot_like_v2(string $direction): void
    {
        [$actor, $owner] = [$this->member(), $this->member()];
        $postId = $this->createPost($owner->id);
        $this->applyBlock($direction, $actor, $owner);
        $before = $this->notificationCount($owner->id);
        $this->actAs($actor);

        $response = $this->apiPost('/v2/feed/like', ['target_type' => 'post', 'target_id' => $postId]);

        $this->assertBlockedResponse($response);
        $this->assertFalse($this->likeExists($actor->id, $postId));
        $this->assertSame($before, $this->notificationCount($owner->id));
    }

    #[DataProvider('blockDirections')]
    public function test_blocked_member_cannot_like_through_legacy_endpoint(string $direction): void
    {
        [$actor, $owner] = [$this->member(), $this->member()];
        $postId = $this->createPost($owner->id);
        $this->applyBlock($direction, $actor, $owner);
        $before = $this->notificationCount($owner->id);
        $this->actAs($actor);

        $response = $this->apiPost('/social/like', ['target_type' => 'post', 'target_id' => $postId]);

        $this->assertBlockedResponse($response);
        $this->assertFalse($this->likeExists($actor->id, $postId));
        $this->assertSame($before, $this->notificationCount($owner->id));
    }

    public function test_unblocked_like_still_works_and_a_like_unlike_loop_notifies_once(): void
    {
        [$actor, $owner] = [$this->member(), $this->member()];
        $postId = $this->createPost($owner->id);
        $before = $this->notificationCount($owner->id);
        $this->actAs($actor);

        $actions = [];
        for ($i = 0; $i < 5; $i++) {
            $r = $this->apiPost('/v2/feed/like', ['target_type' => 'post', 'target_id' => $postId]);
            $r->assertStatus(200);
            $actions[] = $r->json('data.action');
        }

        $this->assertSame(['liked', 'unliked', 'liked', 'unliked', 'liked'], $actions);
        $this->assertTrue($this->likeExists($actor->id, $postId));
        $this->assertSame($before + 1, $this->notificationCount($owner->id), 'A like/unlike loop must notify the owner once');
    }

    #[DataProvider('blockDirections')]
    public function test_blocked_member_cannot_react_to_a_story(string $direction): void
    {
        [$actor, $owner] = [$this->member(), $this->member()];
        $storyId = $this->createStory($owner->id);
        $this->applyBlock($direction, $actor, $owner);
        $before = $this->notificationCount($owner->id);
        $this->actAs($actor);

        $response = $this->apiPost("/v2/stories/{$storyId}/react", ['reaction_type' => 'heart']);

        $this->assertBlockedResponse($response);
        $this->assertSame(0, DB::table('story_reactions')->where('story_id', $storyId)->where('user_id', $actor->id)->count());
        $this->assertSame($before, $this->notificationCount($owner->id));
    }

    public function test_removing_a_story_reaction_does_not_notify_again(): void
    {
        [$actor, $owner] = [$this->member(), $this->member()];
        $storyId = $this->createStory($owner->id);
        $before = $this->notificationCount($owner->id);
        $this->actAs($actor);

        $this->apiPost("/v2/stories/{$storyId}/react", ['reaction_type' => 'heart'])->assertStatus(200);
        $this->apiPost("/v2/stories/{$storyId}/react", ['reaction_type' => 'heart'])->assertStatus(200);

        $this->assertSame(0, DB::table('story_reactions')->where('story_id', $storyId)->where('user_id', $actor->id)->count());
        $this->assertSame($before + 1, $this->notificationCount($owner->id));
    }

    #[DataProvider('blockDirections')]
    public function test_blocked_member_cannot_vote_on_a_story_poll(string $direction): void
    {
        [$actor, $owner] = [$this->member(), $this->member()];
        $storyId = $this->createStory($owner->id, 'everyone', true);
        $this->applyBlock($direction, $actor, $owner);
        $this->actAs($actor);

        $response = $this->apiPost("/v2/stories/{$storyId}/poll/vote", ['option_index' => 0]);

        $this->assertBlockedResponse($response);
        $this->assertSame(0, DB::table('story_poll_votes')->where('story_id', $storyId)->where('user_id', $actor->id)->count());
    }

    #[DataProvider('blockDirections')]
    public function test_blocked_member_cannot_share_through_legacy_endpoint(string $direction): void
    {
        [$actor, $owner] = [$this->member(), $this->member()];
        $postId = $this->createPost($owner->id);
        $this->applyBlock($direction, $actor, $owner);
        $before = $this->notificationCount($owner->id);
        $postsBefore = DB::table('feed_posts')->where('tenant_id', $this->testTenantId)->where('user_id', $actor->id)->count();
        $this->actAs($actor);

        $response = $this->apiPost('/social/share', ['parent_type' => 'post', 'parent_id' => $postId]);

        $this->assertBlockedResponse($response);
        $this->assertSame($postsBefore, DB::table('feed_posts')->where('tenant_id', $this->testTenantId)->where('user_id', $actor->id)->count());
        $this->assertSame(0, DB::table('post_shares')->where('tenant_id', $this->testTenantId)->where('user_id', $actor->id)->count());
        $this->assertSame($before, $this->notificationCount($owner->id));
    }

    #[DataProvider('blockDirections')]
    public function test_blocked_member_cannot_share_through_the_current_endpoint(string $direction): void
    {
        [$actor, $owner] = [$this->member(), $this->member()];
        $postId = $this->createPost($owner->id);
        $this->applyBlock($direction, $actor, $owner);
        $before = $this->notificationCount($owner->id);
        $this->actAs($actor);

        $response = $this->apiPost('/v2/shares', ['type' => 'post', 'id' => $postId]);

        $this->assertBlockedResponse($response);
        $this->assertSame(0, DB::table('post_shares')->where('tenant_id', $this->testTenantId)->where('user_id', $actor->id)->count());
        $this->assertSame($before, $this->notificationCount($owner->id));
    }

    public function test_unblocked_member_can_share_through_the_current_endpoint(): void
    {
        [$actor, $owner] = [$this->member(), $this->member()];
        $postId = $this->createPost($owner->id);
        $this->actAs($actor);

        $response = $this->apiPost('/v2/shares', ['type' => 'post', 'id' => $postId]);

        $this->assertContains($response->getStatusCode(), [200, 201], (string) $response->getContent());
        $this->assertSame(1, DB::table('post_shares')->where('tenant_id', $this->testTenantId)->where('user_id', $actor->id)->count());
    }

    public function test_legacy_share_repeated_does_not_duplicate_or_renotify(): void
    {
        [$actor, $owner] = [$this->member(), $this->member()];
        $postId = $this->createPost($owner->id);
        $before = $this->notificationCount($owner->id);
        $this->actAs($actor);

        $this->apiPost('/social/share', ['parent_type' => 'post', 'parent_id' => $postId])->assertStatus(200);
        $this->apiPost('/social/share', ['parent_type' => 'post', 'parent_id' => $postId])->assertStatus(200);

        $this->assertSame(1, DB::table('post_shares')->where('tenant_id', $this->testTenantId)
            ->where('user_id', $actor->id)->where('original_post_id', $postId)->count());
        $this->assertLessThanOrEqual($before + 1, $this->notificationCount($owner->id));
    }

    #[DataProvider('blockDirections')]
    public function test_blocked_member_cannot_vote_in_a_poll(string $direction): void
    {
        [$actor, $owner] = [$this->member(), $this->member()];
        [$pollId, $optionIds] = $this->createPoll($owner->id, 'standard');
        $this->applyBlock($direction, $actor, $owner);
        $before = $this->notificationCount($owner->id);
        $this->actAs($actor);

        $v2 = $this->apiPost("/v2/polls/{$pollId}/vote", ['option_id' => $optionIds[0]]);
        $this->assertBlockedResponse($v2);
        $feed = $this->apiPost("/v2/feed/polls/{$pollId}/vote", ['option_id' => $optionIds[0]]);
        $this->assertBlockedResponse($feed);

        $this->assertSame(0, DB::table('poll_votes')->where('poll_id', $pollId)->where('user_id', $actor->id)->count());
        $this->assertSame($before, $this->notificationCount($owner->id));
    }

    #[DataProvider('blockDirections')]
    public function test_blocked_member_cannot_rank_a_poll(string $direction): void
    {
        [$actor, $owner] = [$this->member(), $this->member()];
        [$pollId, $optionIds] = $this->createPoll($owner->id, 'ranked');
        $this->applyBlock($direction, $actor, $owner);
        $before = $this->notificationCount($owner->id);
        $this->actAs($actor);

        $response = $this->apiPost("/v2/polls/{$pollId}/rank", ['rankings' => [
            ['option_id' => $optionIds[0], 'rank' => 1],
            ['option_id' => $optionIds[1], 'rank' => 2],
        ]]);

        $this->assertBlockedResponse($response);
        $this->assertSame(0, DB::table('poll_rankings')->where('poll_id', $pollId)->where('user_id', $actor->id)->count());
        $this->assertSame($before, $this->notificationCount($owner->id));
    }

    public function test_unblocked_member_can_vote_in_a_poll(): void
    {
        [$actor, $owner] = [$this->member(), $this->member()];
        [$pollId, $optionIds] = $this->createPoll($owner->id, 'standard');
        $this->actAs($actor);

        $this->apiPost("/v2/polls/{$pollId}/vote", ['option_id' => $optionIds[0]])->assertStatus(200);
        $this->assertSame(1, DB::table('poll_votes')->where('poll_id', $pollId)->where('user_id', $actor->id)->count());
    }

    // ------------------------------------------------------------------

    private function assertBlockedResponse(\Illuminate\Testing\TestResponse $response): void
    {
        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', 'BLOCKED');
        $response->assertJsonPath('errors.0.message', __('safeguarding.errors.blocked_interaction'));
    }

    private function applyBlock(string $direction, User $actor, User $owner): void
    {
        TenantContext::setById($this->testTenantId);
        if ($direction === 'owner_blocked_actor') {
            BlockUserService::block($owner->id, $actor->id);
        } else {
            BlockUserService::block($actor->id, $owner->id);
        }
    }

    private function actAs(User $user): void
    {
        $this->app['auth']->forgetGuards();
        Sanctum::actingAs($user, ['*']);
    }

    private function member(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        TenantContext::setById($this->testTenantId);

        return $user;
    }

    private function createPost(int $ownerId): int
    {
        $postId = DB::table('feed_posts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'content' => 'F-158 block target post ' . uniqid(),
            'type' => 'post',
            'visibility' => 'public',
            'publish_status' => 'published',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('feed_activity')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'source_type' => 'post',
            'source_id' => $postId,
            'content' => 'F-158 block target post',
            'is_visible' => 1,
            'created_at' => now(),
        ]);

        return $postId;
    }

    private function createStory(int $ownerId, string $audience = 'everyone', bool $poll = false): int
    {
        return (int) DB::table('stories')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'media_type' => $poll ? 'poll' : 'text',
            'text_content' => 'F-158 story',
            'poll_question' => $poll ? 'Pick one' : null,
            'poll_options' => $poll ? json_encode(['A', 'B']) : null,
            'audience' => $audience,
            'is_active' => 1,
            'expires_at' => now()->addDay(),
            'created_at' => now(),
        ]);
    }

    /** @return array{int, list<int>} */
    private function createPoll(int $ownerId, string $type): array
    {
        $pollId = (int) DB::table('polls')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'question' => 'F-158 poll?',
            'is_active' => 1,
            'poll_type' => $type,
            'is_anonymous' => 0,
            'created_at' => now(),
        ]);
        $options = [];
        foreach (['Yes', 'No'] as $label) {
            $options[] = (int) DB::table('poll_options')->insertGetId([
                'poll_id' => $pollId,
                'tenant_id' => $this->testTenantId,
                'label' => $label,
            ]);
        }

        return [$pollId, $options];
    }

    private function likeExists(int $userId, int $postId): bool
    {
        return DB::table('likes')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $userId)
            ->where('target_type', 'post')
            ->where('target_id', $postId)
            ->exists();
    }

    private function notificationCount(int $userId): int
    {
        return DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $userId)
            ->count();
    }

    /** @param list<string> $features */
    private function enableFeatures(array $features): void
    {
        $row = DB::table('tenants')->where('id', $this->testTenantId)->first(['features']);
        $current = json_decode((string) ($row->features ?? '{}'), true) ?: [];
        foreach ($features as $feature) {
            $current[$feature] = true;
        }
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($current)]);
        TenantContext::setById($this->testTenantId);
    }
}
