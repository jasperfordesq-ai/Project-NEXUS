<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E067;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\BlockUserService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-393 (E-067) — story highlights still crossed a block. The F-158 fix
 * (ae434ffeb) stopped stories crossing a block in the feed and on
 * /v2/stories/user/{id}, but GET /v2/stories/highlights/{userId} and
 * /v2/stories/highlights/{id}/stories never consulted BlockUserService, so a
 * member on either side of a block kept reading the other's highlighted stories.
 *
 * Both highlight paths now return nothing across a block, in either direction.
 *
 * Adapted from `.local-docs-archive/security-log/E-067/repro/g/G1StoryHighlightsAndViewsIgnoreBlocksTest.php`,
 * which asserted the leak; the attack assertions are inverted.
 */
final class F393StoryHighlightsRespectBlockTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        $this->app['auth']->forgetGuards();
        Cache::flush();
        $this->enableFeatures(['feed', 'stories']);
    }

    public function test_a_member_the_owner_blocked_cannot_read_the_owners_highlights(): void
    {
        [$owner, $blocked] = [$this->member(), $this->member()];
        [$storyId, $highlightId] = $this->highlightedStory((int) $owner->id);

        TenantContext::setById($this->testTenantId);
        BlockUserService::block((int) $owner->id, (int) $blocked->id);

        $this->assertHighlightHidden($blocked, (int) $owner->id, $highlightId, $storyId);
    }

    public function test_a_member_who_blocked_the_owner_does_not_see_the_owners_highlights_either(): void
    {
        [$owner, $blocker] = [$this->member(), $this->member()];
        [$storyId, $highlightId] = $this->highlightedStory((int) $owner->id);

        TenantContext::setById($this->testTenantId);
        BlockUserService::block((int) $blocker->id, (int) $owner->id);

        $this->assertHighlightHidden($blocker, (int) $owner->id, $highlightId, $storyId);
    }

    public function test_control_an_unblocked_member_and_the_owner_still_read_the_highlight(): void
    {
        [$owner, $bystander] = [$this->member(), $this->member()];
        [$storyId, $highlightId] = $this->highlightedStory((int) $owner->id);

        foreach ([$bystander, $owner] as $viewer) {
            $this->actAs($viewer);
            $list = $this->apiGet("/v2/stories/highlights/{$owner->id}")->assertOk();
            $this->assertContains($highlightId, array_map(fn ($h) => (int) $h['id'], $list->json('data')));
            $rows = $this->apiGet("/v2/stories/highlights/{$highlightId}/stories")->assertOk()->json('data');
            $this->assertContains($storyId, array_map(fn ($s) => (int) $s['id'], $rows));
        }
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    private function assertHighlightHidden(User $viewer, int $ownerId, int $highlightId, int $storyId): void
    {
        $this->actAs($viewer);
        $list = $this->apiGet("/v2/stories/highlights/{$ownerId}")->assertOk();
        $this->assertNotContains($highlightId, array_map(fn ($h) => (int) $h['id'], (array) $list->json('data')));

        $rows = (array) $this->apiGet("/v2/stories/highlights/{$highlightId}/stories")->assertOk()->json('data');
        $this->assertNotContains($storyId, array_map(fn ($s) => (int) $s['id'], $rows));
        $this->assertStringNotContainsString('F393 highlighted text', json_encode($rows));
    }

    /** @return array{0:int,1:int} [storyId, highlightId] */
    private function highlightedStory(int $ownerId): array
    {
        $storyId = (int) DB::table('stories')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'media_type' => 'text',
            'text_content' => 'F393 highlighted text',
            'audience' => 'everyone',
            'is_active' => 1,
            'expires_at' => now()->addDay(),
            'created_at' => now(),
        ]);
        $highlightId = (int) DB::table('story_highlights')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'title' => 'F393 highlight',
            'display_order' => 0,
        ]);
        DB::table('story_highlight_items')->insert(['highlight_id' => $highlightId, 'story_id' => $storyId, 'display_order' => 0]);

        return [$storyId, $highlightId];
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

    private function actAs(User $user): void
    {
        $this->app['auth']->forgetGuards();
        Sanctum::actingAs($user, ['*']);
    }

    private function member(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        TenantContext::setById($this->testTenantId);

        return $user;
    }
}
