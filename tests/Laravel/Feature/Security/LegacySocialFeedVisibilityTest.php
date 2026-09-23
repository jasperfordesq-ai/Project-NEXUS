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
 * F-065 / F-072 (E-027): the legacy social endpoints must apply the same
 * visibility rules as the canonical v2 feed.
 *
 * POST /api/social/feed queried feed_posts / goals / events directly with only
 * a tenant filter, so it returned private-group posts to non-members, other
 * members' private goals and hidden or draft posts. POST /api/social/like and
 * POST /api/social/likers skipped FeedItemTables::canView, so a non-member
 * could like a private-group post and list who had liked it.
 */
class LegacySocialFeedVisibilityTest extends TestCase
{
    use DatabaseTransactions;

    private const GROUP_SECRET = 'Private circle only: the treasurer is stepping down on Friday';
    private const PRIVATE_GOAL = 'My private goal: repay the credit union loan';
    private const PUBLIC_GOAL = 'Public goal: learn to knit a scarf';
    private const HIDDEN_POST = 'Moderator-hidden post that nobody should see';
    private const DRAFT_POST = 'Draft post still being written';
    private const PUBLIC_POST = 'Public post anyone in the community may read';

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ]);
    }

    /** Mirror the feed_activity row the app writes for each feed item. */
    private function activity(string $type, int $sourceId, int $userId, ?int $groupId, string $content, ?string $title = null): void
    {
        DB::table('feed_activity')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $userId,
            'source_type' => $type,
            'source_id' => $sourceId,
            'group_id' => $groupId,
            'title' => $title,
            'content' => $content,
            'is_visible' => 1,
            'is_hidden' => 0,
            'created_at' => now()->addMinute(),
        ]);
    }

    private function privateGroup(User $owner): int
    {
        $groupId = (int) DB::table('groups')->insertGetId([
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

        return $groupId;
    }

    private function addGroupMember(int $groupId, User $user): void
    {
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'user_id' => $user->id,
            'role' => 'member',
            'status' => 'active',
        ]);
    }

    private function feedPost(User $author, string $content, array $overrides = []): int
    {
        $postId = (int) DB::table('feed_posts')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'user_id' => $author->id,
            'content' => $content,
            'visibility' => 'public',
            'publish_status' => 'published',
            'created_at' => now()->addMinute(),
        ], $overrides));
        $this->activity('post', $postId, (int) $author->id, $overrides['group_id'] ?? null, $content);

        return $postId;
    }

    private function goal(User $owner, string $title, bool $public): int
    {
        $goalId = (int) DB::table('goals')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'title' => $title,
            'description' => $title,
            'is_public' => $public ? 1 : 0,
            'status' => 'active',
            'created_at' => now()->addMinute(),
        ]);
        // The app only writes a feed_activity row for public goals.
        if ($public) {
            $this->activity('goal', $goalId, (int) $owner->id, null, $title, $title);
        }

        return $goalId;
    }

    public function test_private_group_posts_are_only_returned_to_group_members(): void
    {
        $owner = $this->member();
        $groupId = $this->privateGroup($owner);
        $this->feedPost($owner, self::GROUP_SECRET, ['group_id' => $groupId]);

        $outsider = $this->member();
        Sanctum::actingAs($outsider, ['*']);

        $groupFeed = $this->apiPost('/social/feed', ['group_id' => $groupId])->assertStatus(200);
        $this->assertStringNotContainsString(self::GROUP_SECRET, (string) $groupFeed->getContent());

        $mainFeed = $this->apiPost('/social/feed', ['filter' => 'posts', 'limit' => 50])->assertStatus(200);
        $this->assertStringNotContainsString(self::GROUP_SECRET, (string) $mainFeed->getContent());

        $profileFeed = $this->apiPost('/social/feed', ['user_id' => $owner->id])->assertStatus(200);
        $this->assertStringNotContainsString(self::GROUP_SECRET, (string) $profileFeed->getContent());

        // Control: a member of the group still sees the post in the group feed.
        $member = $this->member();
        $this->addGroupMember($groupId, $member);
        Sanctum::actingAs($member, ['*']);

        $memberFeed = $this->apiPost('/social/feed', ['group_id' => $groupId])->assertStatus(200);
        $this->assertStringContainsString(self::GROUP_SECRET, (string) $memberFeed->getContent());
        $this->assertSame('post', $memberFeed->json('data.items.0.type'));
        $this->assertSame((int) $owner->id, (int) $memberFeed->json('data.items.0.author_id'));
    }

    public function test_other_members_private_goals_are_not_returned(): void
    {
        $owner = $this->member();
        $this->goal($owner, self::PRIVATE_GOAL, false);
        $this->goal($owner, self::PUBLIC_GOAL, true);

        Sanctum::actingAs($this->member(), ['*']);
        $response = $this->apiPost('/social/feed', ['filter' => 'goals', 'limit' => 50])->assertStatus(200);

        $this->assertStringNotContainsString(self::PRIVATE_GOAL, (string) $response->getContent());
        // Control: a public goal is still listed.
        $this->assertStringContainsString(self::PUBLIC_GOAL, (string) $response->getContent());
    }

    public function test_hidden_and_draft_posts_are_not_returned(): void
    {
        $author = $this->member();
        $this->feedPost($author, self::HIDDEN_POST, ['is_hidden' => 1]);
        $this->feedPost($author, self::DRAFT_POST, ['publish_status' => 'draft']);
        $this->feedPost($author, self::PUBLIC_POST);

        Sanctum::actingAs($this->member(), ['*']);

        foreach ([['filter' => 'posts', 'limit' => 50], ['user_id' => $author->id, 'limit' => 50]] as $payload) {
            $body = (string) $this->apiPost('/social/feed', $payload)->assertStatus(200)->getContent();
            $this->assertStringNotContainsString(self::HIDDEN_POST, $body);
            $this->assertStringNotContainsString(self::DRAFT_POST, $body);
            // Control: the published public post is still listed.
            $this->assertStringContainsString(self::PUBLIC_POST, $body);
        }
    }

    public function test_legacy_like_on_a_private_group_post_is_refused_for_non_members(): void
    {
        $owner = $this->member();
        $groupId = $this->privateGroup($owner);
        $postId = $this->feedPost($owner, self::GROUP_SECRET, ['group_id' => $groupId]);

        $outsider = $this->member();
        Sanctum::actingAs($outsider, ['*']);
        $response = $this->apiPost('/social/like', ['target_type' => 'post', 'target_id' => $postId]);

        $response->assertStatus(404);
        $this->assertFalse(
            DB::table('likes')->where('user_id', $outsider->id)->where('target_type', 'post')->where('target_id', $postId)->exists()
        );

        // Control: a group member may still like it.
        $member = $this->member();
        $this->addGroupMember($groupId, $member);
        Sanctum::actingAs($member, ['*']);
        $this->apiPost('/social/like', ['target_type' => 'post', 'target_id' => $postId])
            ->assertStatus(200)
            ->assertJsonPath('data.status', 'liked');
    }

    public function test_legacy_likers_of_a_private_group_post_are_refused_for_non_members(): void
    {
        $owner = $this->member();
        $groupId = $this->privateGroup($owner);
        $postId = $this->feedPost($owner, self::GROUP_SECRET, ['group_id' => $groupId]);

        $member = $this->member();
        $this->addGroupMember($groupId, $member);
        DB::table('likes')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'target_type' => 'post',
            'target_id' => $postId,
            'created_at' => now(),
        ]);

        Sanctum::actingAs($this->member(), ['*']);
        $response = $this->apiPost('/social/likers', ['target_type' => 'post', 'target_id' => $postId]);
        $response->assertStatus(404);
        $this->assertNull($response->json('data.likers'));

        // Control: a group member still sees who liked it.
        Sanctum::actingAs($member, ['*']);
        $this->apiPost('/social/likers', ['target_type' => 'post', 'target_id' => $postId])
            ->assertStatus(200)
            ->assertJsonPath('data.total_count', 1)
            ->assertJsonPath('data.likers.0.id', (int) $member->id);
    }
}
