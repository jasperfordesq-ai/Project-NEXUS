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
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-157 — a review hidden or flagged by an admin, or deleted by its author,
 * stayed in the community feed: its feed_activity row stayed visible and
 * FeedItemTables::canView() trusted a visible feed row before the review's own
 * read rule, so other members could still open it, comment on it and react to it.
 */
class ModeratedReviewFeedVisibilityTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        $this->app['auth']->forgetGuards();
        $this->enableFeatures(['reviews', 'feed']);
    }

    public function test_admin_hidden_review_leaves_the_feed_and_refuses_comments(): void
    {
        [$author, $reader, $reviewId, $text] = $this->postReview();
        $this->assertReaderSees($reader, $reviewId, $text);

        $this->actAs($this->plainAdmin());
        $this->apiPost("/v2/admin/reviews/{$reviewId}/hide")->assertStatus(200);

        $this->assertReaderCannotReach($reader, $reviewId, $text);
    }

    public function test_admin_flagged_review_leaves_the_feed_and_refuses_comments(): void
    {
        [$author, $reader, $reviewId, $text] = $this->postReview();
        $this->assertReaderSees($reader, $reviewId, $text);

        $this->actAs($this->plainAdmin());
        $this->apiPost("/v2/admin/reviews/{$reviewId}/flag")->assertStatus(200);

        $this->assertReaderCannotReach($reader, $reviewId, $text);
    }

    public function test_author_deleted_review_leaves_the_feed_and_refuses_comments(): void
    {
        [$author, $reader, $reviewId, $text] = $this->postReview();
        $this->assertReaderSees($reader, $reviewId, $text);

        $this->actAs($author);
        $this->apiDelete("/v2/reviews/{$reviewId}")->assertStatus(204);

        $this->assertReaderCannotReach($reader, $reviewId, $text);
    }

    public function test_a_stale_visible_feed_row_no_longer_overrides_the_review_rule(): void
    {
        // Rows written before the fix keep is_visible = 1. The read rule must
        // still refuse them.
        [$author, $reader, $reviewId, $text] = $this->postReview();
        DB::table('reviews')->where('id', $reviewId)->update(['status' => 'rejected']);
        $this->assertSame(1, (int) DB::table('feed_activity')
            ->where('tenant_id', $this->testTenantId)
            ->where('source_type', 'review')
            ->where('source_id', $reviewId)
            ->value('is_visible'));

        $this->assertReaderCannotReach($reader, $reviewId, $text);
    }

    // ------------------------------------------------------------------

    /** @return array{User, User, int, string} */
    private function postReview(): array
    {
        $author = $this->member();
        $receiver = $this->member();
        $reader = $this->member();
        $text = 'E035-F157-REVIEW-' . uniqid();

        $this->actAs($author);
        $response = $this->apiPost('/v2/reviews', [
            'receiver_id' => $receiver->id,
            'rating' => 2,
            'comment' => $text,
        ]);
        $response->assertStatus(201);
        $reviewId = (int) $response->json('data.id');
        $this->assertGreaterThan(0, $reviewId);

        return [$author, $reader, $reviewId, $text];
    }

    private function assertReaderSees(User $reader, int $reviewId, string $text): void
    {
        $this->actAs($reader);
        $item = $this->apiGet("/v2/feed/items/review/{$reviewId}");
        $item->assertStatus(200);
        $this->assertStringContainsString($text, (string) $item->getContent());
    }

    private function assertReaderCannotReach(User $reader, int $reviewId, string $text): void
    {
        $this->actAs($reader);

        $item = $this->apiGet("/v2/feed/items/review/{$reviewId}");
        $this->assertSame(404, $item->status(), 'Moderated review must not open from the feed');
        $this->assertStringNotContainsString($text, (string) $item->getContent());

        $feed = $this->apiGet('/v2/feed?per_page=100&personalised=false');
        $this->assertStringNotContainsString($text, (string) $feed->getContent(), 'Moderated review must leave the feed');

        $comment = $this->apiPost('/v2/comments', [
            'target_type' => 'review',
            'target_id' => $reviewId,
            'content' => 'Comment on a moderated review',
        ]);
        $this->assertContains($comment->status(), [403, 404], 'Commenting on a moderated review must be refused');
        $this->assertDatabaseMissing('comments', [
            'tenant_id' => $this->testTenantId,
            'target_type' => 'review',
            'target_id' => $reviewId,
            'user_id' => $reader->id,
        ]);

        $like = $this->apiPost('/v2/feed/like', ['target_type' => 'review', 'target_id' => $reviewId]);
        $this->assertSame(404, $like->status(), 'Liking a moderated review must be refused');

        $react = $this->apiPost('/v2/reactions', [
            'target_type' => 'review',
            'target_id' => $reviewId,
            'reaction_type' => 'love',
        ]);
        $this->assertContains($react->status(), [403, 404, 422], 'Reacting to a moderated review must be refused');
        $this->assertDatabaseMissing('reactions', [
            'tenant_id' => $this->testTenantId,
            'target_type' => 'review',
            'target_id' => $reviewId,
            'user_id' => $reader->id,
        ]);
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

    private function plainAdmin(): User
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        DB::table('users')->where('id', $admin->id)->update([
            'role' => 'admin', 'is_super_admin' => 0, 'is_tenant_super_admin' => 0, 'is_god' => 0,
        ]);

        return $admin->refresh();
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
