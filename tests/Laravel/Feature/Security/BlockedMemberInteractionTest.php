<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\Models\User;
use App\Services\BlockUserService;
use App\Services\CommentService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Laravel\TestCase;

/**
 * F-070 — blocking a member must stop them interacting with you: commenting
 * on your content, replying to your comments, @mentioning you, finding you in
 * mention autocomplete, reviewing you, endorsing your skills, sending you
 * appreciations and reacting to your content. A block in EITHER direction
 * applies, and the refusal never says who blocked whom.
 */
class BlockedMemberInteractionTest extends TestCase
{
    use DatabaseTransactions;

    /** @return array<string, array{string}> */
    public static function blockDirections(): array
    {
        return [
            'the other member blocked the actor' => ['target_blocked_actor'],
            'the actor blocked the other member' => ['actor_blocked_target'],
        ];
    }

    // ------------------------------------------------------------------
    //  Comments
    // ------------------------------------------------------------------

    #[DataProvider('blockDirections')]
    public function test_comment_on_blocked_members_post_is_refused(string $direction): void
    {
        [$actor, $owner] = [$this->member(), $this->member()];
        $this->applyBlock($direction, $actor, $owner);
        $postId = $this->createPost($owner->id);
        $notifications = $this->notificationCount($owner->id);
        Sanctum::actingAs($actor, ['*']);

        $response = $this->apiPost('/v2/comments', [
            'target_type' => 'post',
            'target_id' => $postId,
            'content' => 'Comment from a blocked pair',
        ]);

        $this->assertBlockedResponse($response);
        $this->assertDatabaseMissing('comments', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $actor->id,
            'target_id' => $postId,
        ]);
        $this->assertSame($notifications, $this->notificationCount($owner->id));
    }

    public function test_comment_on_unblocked_members_post_succeeds(): void
    {
        [$actor, $owner] = [$this->member(), $this->member()];
        $postId = $this->createPost($owner->id);
        Sanctum::actingAs($actor, ['*']);

        $response = $this->apiPost('/v2/comments', [
            'target_type' => 'post',
            'target_id' => $postId,
            'content' => 'Comment from an unblocked member',
        ]);

        $response->assertStatus(201);
        $this->assertDatabaseHas('comments', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $actor->id,
            'target_id' => $postId,
        ]);
    }

    #[DataProvider('blockDirections')]
    public function test_reply_to_blocked_members_comment_is_refused(string $direction): void
    {
        [$actor, $parentAuthor, $owner] = [$this->member(), $this->member(), $this->member()];
        $this->applyBlock($direction, $actor, $parentAuthor);
        $postId = $this->createPost($owner->id);
        $parentId = $this->comment($postId, $parentAuthor->id, 'Parent comment');
        Sanctum::actingAs($actor, ['*']);

        $response = $this->apiPost('/v2/comments', [
            'target_type' => 'post',
            'target_id' => $postId,
            'parent_id' => $parentId,
            'content' => 'Reply across a block',
        ]);

        $this->assertBlockedResponse($response);
        $this->assertDatabaseMissing('comments', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $actor->id,
            'parent_id' => $parentId,
        ]);
    }

    #[DataProvider('blockDirections')]
    public function test_legacy_comment_on_blocked_members_post_is_refused(string $direction): void
    {
        [$actor, $owner] = [$this->member(), $this->member()];
        $this->applyBlock($direction, $actor, $owner);
        $postId = $this->createPost($owner->id);

        try {
            CommentService::addComment($actor->id, $this->testTenantId, 'post', $postId, 'Legacy comment across a block');
            $this->fail('A comment across a block must be refused.');
        } catch (SafeguardingPolicyException $e) {
            $this->assertSame('BLOCKED', $e->reasonCode);
        }

        $this->assertDatabaseMissing('comments', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $actor->id,
            'target_id' => $postId,
        ]);
    }

    // ------------------------------------------------------------------
    //  Mentions
    // ------------------------------------------------------------------

    #[DataProvider('blockDirections')]
    public function test_mention_of_blocked_member_is_dropped_but_comment_is_kept(string $direction): void
    {
        [$actor, $owner] = [$this->member(), $this->member()];
        $blocked = $this->member(['username' => 'f070_blocked_' . uniqid()]);
        $friend = $this->member(['username' => 'f070_friend_' . uniqid()]);
        $this->applyBlock($direction, $actor, $blocked);
        $postId = $this->createPost($owner->id);
        $blockedNotifications = $this->notificationCount($blocked->id);
        Sanctum::actingAs($actor, ['*']);

        $response = $this->apiPost('/v2/comments', [
            'target_type' => 'post',
            'target_id' => $postId,
            'content' => "Hello @{$blocked->username} and @{$friend->username}",
        ]);

        $response->assertStatus(201);
        $commentId = (int) $response->json('data.id');
        $this->assertDatabaseMissing('mentions', [
            'tenant_id' => $this->testTenantId,
            'mentioned_user_id' => $blocked->id,
            'mentioning_user_id' => $actor->id,
        ]);
        $this->assertSame($blockedNotifications, $this->notificationCount($blocked->id));
        // Control: the unblocked member in the same comment is still mentioned.
        $this->assertDatabaseHas('mentions', [
            'tenant_id' => $this->testTenantId,
            'comment_id' => $commentId,
            'mentioned_user_id' => $friend->id,
            'mentioning_user_id' => $actor->id,
        ]);
    }

    #[DataProvider('blockDirections')]
    public function test_legacy_comment_mention_of_blocked_member_is_dropped(string $direction): void
    {
        [$actor, $owner] = [$this->member(), $this->member()];
        $blocked = $this->member(['username' => 'f070_legacy_blocked_' . uniqid()]);
        $friend = $this->member(['username' => 'f070_legacy_friend_' . uniqid()]);
        $this->applyBlock($direction, $actor, $blocked);
        $postId = $this->createPost($owner->id);

        $result = CommentService::addComment(
            $actor->id,
            $this->testTenantId,
            'post',
            $postId,
            "Hi @{$blocked->username} and @{$friend->username}",
        );

        $this->assertTrue($result['success']);
        $commentId = (int) $result['comment']['id'];
        $this->assertDatabaseMissing('mentions', [
            'tenant_id' => $this->testTenantId,
            'mentioned_user_id' => $blocked->id,
            'mentioning_user_id' => $actor->id,
        ]);
        $this->assertDatabaseHas('mentions', [
            'tenant_id' => $this->testTenantId,
            'comment_id' => $commentId,
            'mentioned_user_id' => $friend->id,
        ]);
    }

    #[DataProvider('blockDirections')]
    public function test_mention_search_excludes_blocked_members(string $direction): void
    {
        $needle = 'Zqf' . substr(md5(uniqid('', true)), 0, 8);
        $actor = $this->member();
        $blocked = $this->member(['first_name' => $needle, 'name' => $needle . ' Blocked']);
        $friend = $this->member(['first_name' => $needle, 'name' => $needle . ' Friend']);
        $this->applyBlock($direction, $actor, $blocked);
        Sanctum::actingAs($actor, ['*']);

        $response = $this->apiGet('/v2/mentions/search?q=' . $needle);

        $response->assertStatus(200);
        $ids = array_map('intval', array_column($response->json('data') ?? [], 'id'));
        $this->assertNotContains($blocked->id, $ids);
        $this->assertContains($friend->id, $ids);

        $legacyIds = array_map(
            'intval',
            array_column(CommentService::searchUsersForMention($needle, $this->testTenantId, 10, $actor->id), 'id'),
        );
        $this->assertNotContains($blocked->id, $legacyIds);
        $this->assertContains($friend->id, $legacyIds);

        // The legacy HTTP route passes the viewer through to the service too.
        $legacyRoute = $this->apiPost('/social/mention-search', ['query' => $needle]);
        $legacyRoute->assertStatus(200);
        $routeIds = array_map('intval', array_column($legacyRoute->json('data.users') ?? [], 'id'));
        $this->assertNotContains($blocked->id, $routeIds);
        $this->assertContains($friend->id, $routeIds);
    }

    // ------------------------------------------------------------------
    //  Reviews
    // ------------------------------------------------------------------

    #[DataProvider('blockDirections')]
    public function test_review_of_blocked_member_is_refused(string $direction): void
    {
        [$actor, $target] = [$this->member(), $this->member()];
        $this->applyBlock($direction, $actor, $target);
        Sanctum::actingAs($actor, ['*']);

        $response = $this->apiPost('/v2/reviews', [
            'receiver_id' => $target->id,
            'rating' => 1,
            'comment' => 'Review across a block',
        ]);

        $this->assertBlockedResponse($response);
        $this->assertDatabaseMissing('reviews', [
            'reviewer_id' => $actor->id,
            'receiver_id' => $target->id,
        ]);
    }

    public function test_review_of_unblocked_member_succeeds(): void
    {
        [$actor, $target] = [$this->member(), $this->member()];
        Sanctum::actingAs($actor, ['*']);

        $response = $this->apiPost('/v2/reviews', [
            'receiver_id' => $target->id,
            'rating' => 5,
            'comment' => 'Great exchange',
        ]);

        $this->assertContains($response->getStatusCode(), [200, 201], (string) $response->getContent());
        $this->assertDatabaseHas('reviews', [
            'reviewer_id' => $actor->id,
            'receiver_id' => $target->id,
        ]);
    }

    // ------------------------------------------------------------------
    //  Endorsements
    // ------------------------------------------------------------------

    #[DataProvider('blockDirections')]
    public function test_endorsing_blocked_member_is_refused(string $direction): void
    {
        [$actor, $target] = [$this->member(), $this->member()];
        $this->applyBlock($direction, $actor, $target);
        Sanctum::actingAs($actor, ['*']);

        $response = $this->apiPost("/v2/members/{$target->id}/endorse", [
            'skill_name' => 'Gardening',
        ]);

        $this->assertBlockedResponse($response);
        $this->assertDatabaseMissing('skill_endorsements', [
            'endorser_id' => $actor->id,
            'endorsed_id' => $target->id,
        ]);
    }

    public function test_endorsing_unblocked_member_succeeds(): void
    {
        [$actor, $target] = [$this->member(), $this->member()];
        Sanctum::actingAs($actor, ['*']);

        $response = $this->apiPost("/v2/members/{$target->id}/endorse", [
            'skill_name' => 'Gardening',
        ]);

        $response->assertStatus(200);
        $this->assertDatabaseHas('skill_endorsements', [
            'endorser_id' => $actor->id,
            'endorsed_id' => $target->id,
            'skill_name' => 'Gardening',
        ]);
    }

    // ------------------------------------------------------------------
    //  Appreciations
    // ------------------------------------------------------------------

    #[DataProvider('blockDirections')]
    public function test_appreciation_to_blocked_member_is_refused(string $direction): void
    {
        Cache::flush();
        [$actor, $target] = [$this->member(), $this->member()];
        $this->applyBlock($direction, $actor, $target);
        Sanctum::actingAs($actor, ['*']);

        $response = $this->apiPost('/v2/appreciations', [
            'receiver_id' => $target->id,
            'message' => 'Thanks across a block',
        ]);

        $this->assertBlockedResponse($response);
        $this->assertDatabaseMissing('appreciations', [
            'sender_id' => $actor->id,
            'receiver_id' => $target->id,
        ]);
    }

    public function test_appreciation_to_unblocked_member_succeeds(): void
    {
        Cache::flush();
        [$actor, $target] = [$this->member(), $this->member()];
        Sanctum::actingAs($actor, ['*']);

        $response = $this->apiPost('/v2/appreciations', [
            'receiver_id' => $target->id,
            'message' => 'Thanks for your help',
        ]);

        $this->assertContains($response->getStatusCode(), [200, 201], (string) $response->getContent());
        $this->assertDatabaseHas('appreciations', [
            'sender_id' => $actor->id,
            'receiver_id' => $target->id,
        ]);
    }

    // ------------------------------------------------------------------
    //  Reactions
    // ------------------------------------------------------------------

    #[DataProvider('blockDirections')]
    public function test_reaction_to_blocked_members_post_is_refused(string $direction): void
    {
        [$actor, $owner] = [$this->member(), $this->member()];
        $this->applyBlock($direction, $actor, $owner);
        $postId = $this->createPost($owner->id);
        Sanctum::actingAs($actor, ['*']);

        $response = $this->apiPost("/v2/posts/{$postId}/reactions", ['reaction_type' => 'love']);

        $this->assertBlockedResponse($response);
        $this->assertDatabaseMissing('reactions', [
            'tenant_id' => $this->testTenantId,
            'target_type' => 'post',
            'target_id' => $postId,
            'user_id' => $actor->id,
        ]);
    }

    #[DataProvider('blockDirections')]
    public function test_reaction_to_blocked_members_comment_is_refused(string $direction): void
    {
        [$actor, $author, $owner] = [$this->member(), $this->member(), $this->member()];
        $this->applyBlock($direction, $actor, $author);
        $postId = $this->createPost($owner->id);
        $commentId = $this->comment($postId, $author->id, 'A comment by the other member');
        Sanctum::actingAs($actor, ['*']);

        $response = $this->apiPost("/v2/comments/{$commentId}/reactions", ['reaction_type' => 'love']);
        $this->assertBlockedResponse($response);

        // The legacy comment-reaction path applies the same rule.
        try {
            CommentService::toggleReaction($actor->id, $this->testTenantId, $commentId, 'love');
            $this->fail('A reaction across a block must be refused.');
        } catch (SafeguardingPolicyException $e) {
            $this->assertSame('BLOCKED', $e->reasonCode);
        }

        $this->assertDatabaseMissing('reactions', [
            'tenant_id' => $this->testTenantId,
            'target_type' => 'comment',
            'target_id' => $commentId,
            'user_id' => $actor->id,
        ]);
    }

    public function test_reaction_to_unblocked_members_post_succeeds(): void
    {
        [$actor, $owner] = [$this->member(), $this->member()];
        $postId = $this->createPost($owner->id);
        Sanctum::actingAs($actor, ['*']);

        $response = $this->apiPost("/v2/posts/{$postId}/reactions", ['reaction_type' => 'love']);

        $response->assertStatus(200);
        $response->assertJsonPath('data.action', 'added');
    }

    public function test_existing_reaction_can_still_be_withdrawn_after_a_block(): void
    {
        [$actor, $owner] = [$this->member(), $this->member()];
        $postId = $this->createPost($owner->id);
        DB::table('reactions')->insert([
            'tenant_id' => $this->testTenantId,
            'target_type' => 'post',
            'target_id' => $postId,
            'user_id' => $actor->id,
            'emoji' => 'love',
            'created_at' => now(),
        ]);
        $this->applyBlock('target_blocked_actor', $actor, $owner);
        Sanctum::actingAs($actor, ['*']);

        $response = $this->apiPost("/v2/posts/{$postId}/reactions", ['reaction_type' => 'love']);

        $response->assertStatus(200);
        $response->assertJsonPath('data.action', 'removed');
    }

    // ------------------------------------------------------------------
    //  Helpers
    // ------------------------------------------------------------------

    private function assertBlockedResponse(\Illuminate\Testing\TestResponse $response): void
    {
        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', 'BLOCKED');
        // Direction-neutral wording: the actor must not learn who blocked whom.
        $response->assertJsonPath('errors.0.message', __('safeguarding.errors.blocked_interaction'));
    }

    private function applyBlock(string $direction, User $actor, User $other): void
    {
        TenantContext::setById($this->testTenantId);
        if ($direction === 'target_blocked_actor') {
            BlockUserService::block($other->id, $actor->id);
        } else {
            BlockUserService::block($actor->id, $other->id);
        }
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

    private function createPost(int $ownerId): int
    {
        return DB::table('feed_posts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'content' => 'F-070 block target post',
            'type' => 'post',
            'visibility' => 'public',
            'publish_status' => 'published',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function comment(int $postId, int $authorId, string $content): int
    {
        return DB::table('comments')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'target_type' => 'post',
            'target_id' => $postId,
            'user_id' => $authorId,
            'content' => $content,
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
}
