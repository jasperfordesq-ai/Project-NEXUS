<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E067;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-390 (E-067) — a broker who is the subject of a review could hide or delete
 * the review's feed card through /v2/admin/feed/posts/{id}?type=review, and the
 * delete also hard-deleted every other member's comment on it. The feed route's
 * only broker check looked at the card's AUTHOR (the reviewer), while the
 * reviews route guards both parties and refuses the same broker.
 *
 * Now the feed route refuses a broker who is the subject of the review, as the
 * reviews route does.
 *
 * Adapted from `.local-docs-archive/security-log/E-067/repro/d/BrokerScrubsReviewAboutThemselvesViaFeedTest.php`,
 * which asserted the harm; the attack assertions are inverted.
 */
final class F390ReviewedBrokerCannotScrubFeedCardTest extends TestCase
{
    use DatabaseTransactions;

    public function test_reviewed_broker_cannot_delete_the_review_card_or_its_comments(): void
    {
        $broker = $this->broker();
        [$reviewId, $commentId] = $this->reviewAbout((int) $broker->id, (int) $this->member()->id, (int) $this->member()->id);

        Sanctum::actingAs($broker);
        $this->deleteJson("/api/v2/admin/feed/posts/{$reviewId}?type=review", [], ['X-Tenant-ID' => (string) $this->testTenantId])
            ->assertStatus(403);

        $this->assertNotNull($this->card($reviewId), 'the review card stays in the community feed');
        $this->assertSame(1, DB::table('comments')->where('id', $commentId)->count(), 'the other member\'s comment survives');
    }

    public function test_reviewed_broker_cannot_hide_the_review_card(): void
    {
        $broker = $this->broker();
        [$reviewId] = $this->reviewAbout((int) $broker->id, (int) $this->member()->id, (int) $this->member()->id);

        Sanctum::actingAs($broker);
        $this->apiPost("/v2/admin/feed/posts/{$reviewId}/hide", ['type' => 'review'])->assertStatus(403);

        $card = $this->card($reviewId);
        $this->assertSame(0, (int) ($card->is_hidden ?? 0));
        $this->assertSame(1, (int) $card->is_visible);
    }

    public function test_control_an_uninvolved_broker_can_still_remove_the_card(): void
    {
        [$reviewId] = $this->reviewAbout((int) $this->member()->id, (int) $this->member()->id, (int) $this->member()->id);

        Sanctum::actingAs($this->broker());
        $this->deleteJson("/api/v2/admin/feed/posts/{$reviewId}?type=review", [], ['X-Tenant-ID' => (string) $this->testTenantId])
            ->assertStatus(200);
        $this->assertNull($this->card($reviewId));
    }

    public function test_control_an_administrator_who_is_the_subject_is_not_restricted(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
        [$reviewId] = $this->reviewAbout((int) $admin->id, (int) $this->member()->id, (int) $this->member()->id);

        Sanctum::actingAs($admin);
        $this->apiPost("/v2/admin/feed/posts/{$reviewId}/hide", ['type' => 'review'])->assertStatus(200);
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    private function broker(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'broker', 'status' => 'active', 'is_approved' => 1,
        ]);
    }

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => 1]);
    }

    /** @return array{0:int,1:int} [reviewId, commentId] */
    private function reviewAbout(int $receiverId, int $reviewerId, int $commenterId): array
    {
        $reviewId = (int) DB::table('reviews')->insertGetId([
            'tenant_id' => $this->testTenantId, 'reviewer_id' => $reviewerId, 'receiver_id' => $receiverId,
            'rating' => 1, 'comment' => 'F390: broker was rude and did not turn up', 'status' => 'approved',
            'created_at' => now(),
        ]);
        DB::table('feed_activity')->insert([
            'tenant_id' => $this->testTenantId, 'user_id' => $reviewerId, 'source_type' => 'review',
            'source_id' => $reviewId, 'content' => 'F390 review card', 'is_visible' => 1,
            'created_at' => now(),
        ]);
        $commentId = (int) DB::table('comments')->insertGetId([
            'tenant_id' => $this->testTenantId, 'user_id' => $commenterId, 'target_type' => 'review',
            'target_id' => $reviewId, 'content' => 'F390: same happened to me', 'created_at' => now(),
        ]);

        return [$reviewId, $commentId];
    }

    private function card(int $reviewId): ?object
    {
        return DB::table('feed_activity')->where('source_type', 'review')->where('source_id', $reviewId)->first();
    }
}
