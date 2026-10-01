<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E069;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-418 (E-069) — DELETE /v2/stories/highlights/{id}/items/{storyId} must
 * report what it actually removed.
 *
 * StoryService::removeFromHighlight() discarded the DELETE row count and
 * StoryController::removeHighlightItem() answered 200 {"removed":true}
 * unconditionally, so the endpoint reported a removal for every story id —
 * another member's story, a story in another community, and an id that exists
 * nowhere. Nothing ever crossed a community boundary: the DELETE is correctly
 * bounded to the caller's own highlight_id. The defect is the answer.
 *
 * Correct behaviour, asserted here: zero rows removed is a 404, and the body
 * must stay byte-identical whether the story exists elsewhere or nowhere at
 * all, so the fix does not turn the route into an existence oracle.
 *
 * Adapted from
 * `.local-docs-archive/security-log/E-069/repro/f/F1StoryHighlightRemoveAlwaysReportsSuccessTest.php`,
 * which asserted the bad outcome; the attack assertions are inverted.
 */
final class F418StoryHighlightRemovalReportsWhatItRemovedTest extends TestCase
{
    use DatabaseTransactions;

    private const OTHER = 999;

    private function member(int $tenant): User
    {
        return User::factory()->forTenant($tenant)->create([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'member',
        ]);
    }

    /** @return array{0:int,1:int} [highlightId, storyId] with the item row present */
    private function highlightWithStory(int $tenant, User $owner, string $marker): array
    {
        $highlightId = (int) DB::table('story_highlights')->insertGetId([
            'tenant_id' => $tenant, 'user_id' => (int) $owner->id,
            'title' => $marker, 'display_order' => 0, 'created_at' => now(),
        ]);
        $storyId = (int) DB::table('stories')->insertGetId([
            'tenant_id' => $tenant, 'user_id' => (int) $owner->id,
            'media_type' => 'text', 'text_content' => $marker, 'duration' => 5,
            'audience' => 'public', 'view_count' => 0, 'is_active' => 1,
            'expires_at' => now()->addDay(), 'created_at' => now(),
        ]);
        DB::table('story_highlight_items')->insert([
            'highlight_id' => $highlightId, 'story_id' => $storyId, 'display_order' => 0,
        ]);

        return [$highlightId, $storyId];
    }

    private function deleteAs(User $as, int $tenant, int $highlightId, int $storyId): \Illuminate\Testing\TestResponse
    {
        Sanctum::actingAs($as, ['*']);
        $this->withTenant($tenant);

        return $this->deleteJson(
            "/api/v2/stories/highlights/{$highlightId}/items/{$storyId}",
            [],
            ['X-Tenant-ID' => (string) $tenant, 'Accept' => 'application/json'],
        );
    }

    /**
     * CORRECT BEHAVIOUR — a story the caller's highlight does not hold is
     * refused, and the refusal is the same whatever the id really is.
     */
    public function test_removing_a_story_the_highlight_does_not_hold_is_refused_and_is_not_an_oracle(): void
    {
        $caller = $this->member(2);
        $victim = $this->member(2);
        $foreigner = $this->member(self::OTHER);

        [$callerHighlight] = $this->highlightWithStory(2, $caller, 'E069F418-CALL');
        [$victimHighlight, $victimStory] = $this->highlightWithStory(2, $victim, 'E069F418-VIC');
        [, $foreignStory] = $this->highlightWithStory(self::OTHER, $foreigner, 'E069F418-FOR');
        $this->withTenant(2);

        $inVictimHighlight = fn (): int => (int) DB::table('story_highlight_items')
            ->where('highlight_id', $victimHighlight)
            ->where('story_id', $victimStory)
            ->count();

        self::assertSame(1, $inVictimHighlight(), 'fixture: victim item present');

        // 1. Another member's story, addressed through the caller's own highlight.
        $r1 = $this->deleteAs($caller, 2, $callerHighlight, $victimStory);
        $this->withTenant(2);
        $r1->assertStatus(404);
        self::assertNull(
            $r1->json('data.removed'),
            'nothing was removed, so the response must not claim a removal',
        );
        self::assertSame(1, $inVictimHighlight(), 'the victim\'s highlight item is untouched');

        // 2. A story belonging to another community — refused the same way.
        $r2 = $this->deleteAs($caller, 2, $callerHighlight, $foreignStory);
        $this->withTenant(2);
        $r2->assertStatus(404);

        // 3. An id that exists nowhere. The body must be BYTE-IDENTICAL to (1),
        //    or the fix has made the route an existence oracle.
        $absent = (int) DB::table('stories')->max('id') + 100000;
        $r3 = $this->deleteAs($caller, 2, $callerHighlight, $absent);
        $this->withTenant(2);
        $r3->assertStatus(404);
        self::assertSame(
            $r1->getContent(),
            $r3->getContent(),
            'a real story id and an invented one must still produce identical responses',
        );
        self::assertSame(
            $r2->getContent(),
            $r3->getContent(),
            'a story in another community and an invented id must be indistinguishable',
        );
    }

    /**
     * CONTROL — the rightful owner's identical call still really removes the
     * row. It differs from the refused case only in whether the story is in
     * the caller's own highlight.
     */
    public function test_control_the_owner_still_really_removes_their_own_highlight_item(): void
    {
        $caller = $this->member(2);
        [$callerHighlight, $callerStory] = $this->highlightWithStory(2, $caller, 'E069F418-OWN');
        $this->withTenant(2);

        $present = fn (): int => (int) DB::table('story_highlight_items')
            ->where('highlight_id', $callerHighlight)
            ->where('story_id', $callerStory)
            ->count();

        self::assertSame(1, $present(), 'fixture: the caller\'s own item is present');

        $control = $this->deleteAs($caller, 2, $callerHighlight, $callerStory);
        $this->withTenant(2);

        $control->assertStatus(200);
        self::assertTrue((bool) ($control->json('data.removed') ?? false));
        self::assertSame(0, $present(), 'control: the legitimate removal really deleted the row');
    }

    /**
     * CONTROL — a highlight the caller does not own is still refused 403, the
     * guard that already worked. The fix must not change it to 404.
     */
    public function test_control_a_highlight_the_caller_does_not_own_is_still_refused_403(): void
    {
        $caller = $this->member(2);
        $victim = $this->member(2);
        [$victimHighlight, $victimStory] = $this->highlightWithStory(2, $victim, 'E069F418-OTHER');
        $this->withTenant(2);

        $refused = $this->deleteAs($caller, 2, $victimHighlight, $victimStory);
        $this->withTenant(2);

        $refused->assertStatus(403);
        self::assertSame(
            1,
            (int) DB::table('story_highlight_items')
                ->where('highlight_id', $victimHighlight)
                ->where('story_id', $victimStory)
                ->count(),
        );
    }
}
