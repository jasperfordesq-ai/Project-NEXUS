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
 * F-067 (E-027): a member must not be able to pull other members' stories —
 * including close-friends and connections-only ones — into their own
 * highlight and read them there.
 *
 * createHighlight and addToHighlight inserted any story id they were given,
 * and getHighlightStories returned every joined story with no audience check.
 */
class StoryHighlightOwnershipTest extends TestCase
{
    use DatabaseTransactions;

    private const SECRET = 'Close friends only: I am moving out of the area next month';

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
    }

    private function story(User $owner, string $audience, string $text): int
    {
        return (int) DB::table('stories')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'media_type' => 'text',
            'text_content' => $text,
            'audience' => $audience,
            'is_active' => 1,
            'expires_at' => now()->addHours(20),
            'created_at' => now(),
        ]);
    }

    public function test_highlight_cannot_include_another_members_story(): void
    {
        $victim = $this->member();
        $secretId = $this->story($victim, 'close_friends', self::SECRET);
        $attacker = $this->member();
        $ownId = $this->story($attacker, 'everyone', 'My own public story');

        Sanctum::actingAs($attacker, ['*']);
        $created = $this->apiPost('/v2/stories/highlights', ['title' => 'Mine', 'story_ids' => [$secretId, $ownId]]);
        $created->assertSuccessful();
        $highlightId = (int) ($created->json('data.id') ?? 0);
        $this->assertGreaterThan(0, $highlightId);

        $this->assertFalse(
            DB::table('story_highlight_items')->where('highlight_id', $highlightId)->where('story_id', $secretId)->exists(),
            'A foreign story id must not be stored in the highlight'
        );
        // Control: the member's own story is kept.
        $this->assertTrue(
            DB::table('story_highlight_items')->where('highlight_id', $highlightId)->where('story_id', $ownId)->exists()
        );

        $this->apiPost("/v2/stories/highlights/{$highlightId}/items", ['story_id' => $secretId]);
        $this->assertFalse(
            DB::table('story_highlight_items')->where('highlight_id', $highlightId)->where('story_id', $secretId)->exists(),
            'Adding a foreign story to an existing highlight must be refused'
        );
    }

    public function test_highlight_viewer_never_sees_a_story_outside_its_audience(): void
    {
        $owner = $this->member();
        $secretId = $this->story($owner, 'close_friends', self::SECRET);
        $publicId = $this->story($owner, 'everyone', 'Public highlight story');

        // A pre-existing highlight row (saved before the fix) owned by the story owner.
        $highlightId = (int) DB::table('story_highlights')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'title' => 'Owner highlight',
            'display_order' => 1,
            'created_at' => now(),
        ]);
        foreach ([$secretId, $publicId] as $i => $sid) {
            DB::table('story_highlight_items')->insert(['highlight_id' => $highlightId, 'story_id' => $sid, 'display_order' => $i]);
        }

        Sanctum::actingAs($this->member(), ['*']);
        $body = (string) $this->apiGet("/v2/stories/highlights/{$highlightId}/stories")->assertOk()->getContent();
        $this->assertStringNotContainsString(self::SECRET, $body);
        $this->assertStringContainsString('Public highlight story', $body);

        // Control: the owner still sees their own close-friends story.
        Sanctum::actingAs($owner, ['*']);
        $this->assertStringContainsString(
            self::SECRET,
            (string) $this->apiGet("/v2/stories/highlights/{$highlightId}/stories")->assertOk()->getContent()
        );
    }
}
