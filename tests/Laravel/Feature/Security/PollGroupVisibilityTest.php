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
 * F-069 (E-027): polls and private groups.
 *
 * POST /v2/polls copied the caller's group_id onto the poll's feed_activity row
 * without checking membership, so a non-member could put a poll into a private
 * group's feed. POST /v2/feed/polls (the group composer) dropped group_id, so a
 * poll made inside a group showed in the community-wide feed. And the poll read
 * endpoints had no group check at all, so a group poll was readable by anyone.
 *
 * `polls` has no group_id column: the group lives on the poll's feed_activity row.
 */
class PollGroupVisibilityTest extends TestCase
{
    use DatabaseTransactions;

    private const GROUP_QUESTION = 'Private circle only: should we replace the treasurer?';
    private const PUBLIC_QUESTION = 'Community poll: which evening suits the repair cafe?';

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
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
        $this->addGroupMember($groupId, $owner, 'owner');

        return $groupId;
    }

    private function addGroupMember(int $groupId, User $user, string $role = 'member'): void
    {
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'user_id' => $user->id,
            'role' => $role,
            'status' => 'active',
        ]);
    }

    /** @return array<string, mixed> */
    private function pollPayload(string $question, ?int $groupId = null): array
    {
        $payload = ['question' => $question, 'options' => ['Yes', 'No']];
        if ($groupId !== null) {
            $payload['group_id'] = $groupId;
        }

        return $payload;
    }

    private function pollIdFor(string $question): ?int
    {
        $id = DB::table('polls')
            ->where('tenant_id', $this->testTenantId)
            ->where('question', $question)
            ->value('id');

        return $id !== null ? (int) $id : null;
    }

    private function feedGroupIdFor(int $pollId): ?int
    {
        $groupId = DB::table('feed_activity')
            ->where('tenant_id', $this->testTenantId)
            ->where('source_type', 'poll')
            ->where('source_id', $pollId)
            ->value('group_id');

        return $groupId !== null ? (int) $groupId : null;
    }

    public function test_non_member_cannot_create_a_poll_in_a_private_group(): void
    {
        $owner = $this->member();
        $groupId = $this->privateGroup($owner);

        Sanctum::actingAs($this->member(), ['*']);

        foreach (['/v2/polls', '/v2/feed/polls'] as $endpoint) {
            $question = self::GROUP_QUESTION . ' ' . $endpoint;
            $this->apiPost($endpoint, $this->pollPayload($question, $groupId))->assertStatus(403);
            $this->assertNull($this->pollIdFor($question), "{$endpoint} created a poll for a non-member");
            $this->assertSame(0, DB::table('feed_activity')
                ->where('tenant_id', $this->testTenantId)
                ->where('group_id', $groupId)
                ->count());
        }
    }

    public function test_member_poll_is_stored_against_the_group_on_both_create_paths(): void
    {
        $owner = $this->member();
        $groupId = $this->privateGroup($owner);
        $member = $this->member();
        $this->addGroupMember($groupId, $member);
        Sanctum::actingAs($member, ['*']);

        foreach (['/v2/polls', '/v2/feed/polls'] as $endpoint) {
            $question = self::GROUP_QUESTION . ' ' . $endpoint;
            $this->apiPost($endpoint, $this->pollPayload($question, $groupId))->assertStatus(201);
            $pollId = $this->pollIdFor($question);
            $this->assertNotNull($pollId);
            $this->assertSame($groupId, $this->feedGroupIdFor($pollId), "{$endpoint} did not keep the group");
        }

        // Control: a poll created without a group stays community-wide.
        $this->apiPost('/v2/feed/polls', $this->pollPayload(self::PUBLIC_QUESTION))->assertStatus(201);
        $publicId = $this->pollIdFor(self::PUBLIC_QUESTION);
        $this->assertNotNull($publicId);
        $this->assertNull($this->feedGroupIdFor($publicId));
    }

    public function test_group_poll_is_hidden_from_non_members_on_every_read(): void
    {
        $owner = $this->member();
        $groupId = $this->privateGroup($owner);
        Sanctum::actingAs($owner, ['*']);
        $this->apiPost('/v2/polls', $this->pollPayload(self::GROUP_QUESTION, $groupId) + ['poll_type' => 'ranked'])
            ->assertStatus(201);
        $this->apiPost('/v2/polls', $this->pollPayload(self::PUBLIC_QUESTION))->assertStatus(201);
        $groupPollId = (int) $this->pollIdFor(self::GROUP_QUESTION);
        $optionId = (int) DB::table('poll_options')->where('poll_id', $groupPollId)->value('id');

        $outsider = $this->member();
        Sanctum::actingAs($outsider, ['*']);

        $list = (string) $this->apiGet('/v2/polls?per_page=100')->assertStatus(200)->getContent();
        $this->assertStringNotContainsString(self::GROUP_QUESTION, $list);
        // Control: the community-wide poll is still listed for the outsider.
        $this->assertStringContainsString(self::PUBLIC_QUESTION, $list);

        $this->apiGet("/v2/polls/{$groupPollId}")->assertStatus(404);
        $this->apiGet("/v2/feed/polls/{$groupPollId}")->assertStatus(404);
        $this->apiGet("/v2/polls/{$groupPollId}/ranked-results")->assertStatus(404);
        $this->apiPost("/v2/polls/{$groupPollId}/rank", ['rankings' => [['option_id' => $optionId, 'rank' => 1]]])
            ->assertStatus(404);
        $this->assertSame(0, DB::table('poll_rankings')->where('poll_id', $groupPollId)->count());

        // Control: a group member sees and can open the group poll.
        $member = $this->member();
        $this->addGroupMember($groupId, $member);
        Sanctum::actingAs($member, ['*']);

        $memberList = (string) $this->apiGet('/v2/polls?per_page=100')->assertStatus(200)->getContent();
        $this->assertStringContainsString(self::GROUP_QUESTION, $memberList);
        $this->apiGet("/v2/polls/{$groupPollId}")->assertStatus(200)
            ->assertJsonPath('data.question', self::GROUP_QUESTION);
        $this->apiGet("/v2/feed/polls/{$groupPollId}")->assertStatus(200);
        $this->apiGet("/v2/polls/{$groupPollId}/ranked-results")->assertStatus(200);
    }
}
