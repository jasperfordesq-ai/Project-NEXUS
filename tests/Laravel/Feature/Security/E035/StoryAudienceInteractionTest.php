<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E035;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-180 — the story audience check on react, reply and poll vote was a no-op:
 * the story query selected only id and user_id, so canViewStory() saw no
 * audience and treated every story as open to everyone. Poll voting had no
 * audience check at all and returned the results.
 */
class StoryAudienceInteractionTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        $this->app['auth']->forgetGuards();
        Cache::flush();
        $this->enableFeatures(['stories', 'messages']);
    }

    public function test_non_connected_member_cannot_react_to_a_connections_only_story(): void
    {
        [$owner, $stranger] = [$this->member(), $this->member()];
        $storyId = $this->createStory($owner->id, 'connections');
        $before = $this->notificationCount($owner->id);
        $this->actAs($stranger);

        $response = $this->apiPost("/v2/stories/{$storyId}/react", ['reaction_type' => 'heart']);

        $this->assertContains($response->status(), [400, 403, 404]);
        $this->assertSame(0, DB::table('story_reactions')->where('story_id', $storyId)->count());
        $this->assertSame($before, $this->notificationCount($owner->id));
    }

    public function test_non_connected_member_cannot_vote_on_a_connections_only_story_poll(): void
    {
        [$owner, $stranger] = [$this->member(), $this->member()];
        $storyId = $this->createStory($owner->id, 'connections', true);
        $this->actAs($stranger);

        $response = $this->apiPost("/v2/stories/{$storyId}/poll/vote", ['option_index' => 1]);

        $this->assertContains($response->status(), [400, 403, 404]);
        $this->assertNull($response->json('data.total_votes'));
        $this->assertSame(0, DB::table('story_poll_votes')->where('story_id', $storyId)->count());
    }

    public function test_non_connected_member_cannot_reply_to_a_connections_only_story(): void
    {
        [$owner, $stranger] = [$this->member(), $this->member()];
        $storyId = $this->createStory($owner->id, 'connections');
        $before = $this->notificationCount($owner->id);
        $this->actAs($stranger);

        $response = $this->apiPost("/v2/stories/{$storyId}/reply", ['body' => 'Hello from outside the audience']);

        $this->assertContains($response->status(), [400, 403, 404]);
        $this->assertSame($before, $this->notificationCount($owner->id));
    }

    public function test_connected_member_can_react_and_vote(): void
    {
        [$owner, $friend] = [$this->member(), $this->member()];
        DB::table('connections')->insert([
            'tenant_id' => $this->testTenantId,
            'requester_id' => $owner->id,
            'receiver_id' => $friend->id,
            'status' => 'accepted',
            'created_at' => now(),
        ]);
        $storyId = $this->createStory($owner->id, 'connections');
        $pollId = $this->createStory($owner->id, 'connections', true);
        $this->actAs($friend);

        $this->apiPost("/v2/stories/{$storyId}/react", ['reaction_type' => 'heart'])->assertStatus(200);
        $this->apiPost("/v2/stories/{$pollId}/poll/vote", ['option_index' => 0])->assertStatus(200);

        $this->assertSame(1, DB::table('story_reactions')->where('story_id', $storyId)->count());
        $this->assertSame(1, DB::table('story_poll_votes')->where('story_id', $pollId)->count());
    }

    // ------------------------------------------------------------------

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

    private function createStory(int $ownerId, string $audience, bool $poll = false): int
    {
        return (int) DB::table('stories')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'media_type' => $poll ? 'poll' : 'text',
            'text_content' => 'F-180 story',
            'poll_question' => $poll ? 'Pick one' : null,
            'poll_options' => $poll ? json_encode(['A', 'B']) : null,
            'audience' => $audience,
            'is_active' => 1,
            'expires_at' => now()->addDay(),
            'created_at' => now(),
        ]);
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
