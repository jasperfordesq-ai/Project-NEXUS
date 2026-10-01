<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E069;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-420 — a reviewed broker must not delete or hide other members' comments on
 * the review that is about them.
 *
 * `AdminCommentsController`'s only broker guard was `guardBrokerNotAuthor()`,
 * which refuses the caller only when the caller WROTE the comment. A review is
 * authored by the reviewer and is ABOUT the receiver, so a broker who had been
 * reviewed could moderate every other member's comment on that review.
 *
 * F-390 added `AdminFeedController::guardBrokerNotSubject()` for exactly this
 * and wired it into that controller's `hide()` and `destroy()`; the comments
 * controller was never given the equivalent. 🔴 BOTH write methods are affected
 * — `destroy()` (hard delete) and `hide()` (sets `comments.deleted_at`, the
 * marker every read path treats as invisible) — so this file drives both.
 *
 * These tests assert the CORRECT behaviour — they fail before the fix.
 */
final class F420BrokerCannotModerateCommentsOnReviewAboutThemTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);
        $this->app['auth']->forgetGuards();
        Cache::flush();
        TenantContext::reset();
        DB::table('tenants')->where('id', $this->testTenantId)
            ->update(['features' => json_encode(['reviews' => true, 'feed' => true])]);
        TenantContext::setById($this->testTenantId);
    }

    /** HARM (destroy) — the reviewed broker must not delete a bystander's comment. */
    public function test_a_reviewed_broker_is_refused_when_deleting_a_comment_on_the_review_about_them(): void
    {
        $broker = $this->staff('broker');
        $reviewer = $this->staff('member');
        $bystander = $this->staff('member');

        $reviewId = $this->review((int) $reviewer->id, (int) $broker->id);
        $this->feedCard($reviewId, (int) $reviewer->id);
        $commentId = $this->comment('review', $reviewId, (int) $bystander->id, 'F420: this exchange did not go as described.');

        Sanctum::actingAs($broker, ['*']);
        $res = $this->apiDelete("/v2/admin/comments/{$commentId}");

        self::assertSame(403, $res->getStatusCode(), 'the reviewed broker must be refused. ' . $res->getContent());
        self::assertTrue(
            DB::table('comments')->where('id', $commentId)->exists(),
            'the bystander\'s comment still exists'
        );
        self::assertNull(
            DB::table('comments')->where('id', $commentId)->value('deleted_at'),
            'and is still visible'
        );
    }

    /** HARM (hide) — the same gap on the other write method of the same class. */
    public function test_a_reviewed_broker_is_refused_when_hiding_a_comment_on_the_review_about_them(): void
    {
        $broker = $this->staff('broker');
        $reviewer = $this->staff('member');
        $bystander = $this->staff('member');

        $reviewId = $this->review((int) $reviewer->id, (int) $broker->id);
        $this->feedCard($reviewId, (int) $reviewer->id);
        $commentId = $this->comment('review', $reviewId, (int) $bystander->id, 'F420: hide path.');

        self::assertNull(
            DB::table('comments')->where('id', $commentId)->value('deleted_at'),
            'precondition: the bystander\'s comment is visible'
        );

        Sanctum::actingAs($broker, ['*']);
        $res = $this->apiPost("/v2/admin/comments/{$commentId}/hide");

        self::assertSame(403, $res->getStatusCode(), 'the reviewed broker must be refused. ' . $res->getContent());
        self::assertNull(
            DB::table('comments')->where('id', $commentId)->value('deleted_at'),
            'the bystander\'s comment is still visible'
        );
    }

    /**
     * CONTROL A — the guarded feed siblings, same caller, same review, must
     * still refuse exactly as F-390 made them.
     */
    public function test_control_the_same_broker_is_still_refused_on_the_guarded_feed_routes(): void
    {
        $broker = $this->staff('broker');
        $reviewer = $this->staff('member');

        $reviewId = $this->review((int) $reviewer->id, (int) $broker->id);
        $this->feedCard($reviewId, (int) $reviewer->id);

        Sanctum::actingAs($broker, ['*']);

        $hide = $this->apiPost("/v2/admin/feed/posts/{$reviewId}/hide?type=review");
        self::assertSame(403, $hide->getStatusCode(), 'CONTROL: the feed hide still refuses. ' . $hide->getContent());

        $delete = $this->apiDelete("/v2/admin/feed/posts/{$reviewId}?type=review");
        self::assertSame(403, $delete->getStatusCode(), 'CONTROL: the feed delete still refuses. ' . $delete->getContent());
    }

    /**
     * CONTROL B — the guard this class DOES have must still fire: a broker may
     * not moderate a comment they wrote themselves.
     */
    public function test_control_the_author_guard_still_fires_on_the_brokers_own_comment(): void
    {
        $broker = $this->staff('broker');
        $reviewer = $this->staff('member');
        $subject = $this->staff('member');

        $reviewId = $this->review((int) $reviewer->id, (int) $subject->id);
        $commentId = $this->comment('review', $reviewId, (int) $broker->id, 'F420: own comment.');

        Sanctum::actingAs($broker, ['*']);
        $res = $this->apiPost("/v2/admin/comments/{$commentId}/hide");

        self::assertSame(403, $res->getStatusCode(), 'CONTROL: guardBrokerNotAuthor fires. ' . $res->getContent());
        self::assertNull(DB::table('comments')->where('id', $commentId)->value('deleted_at'));
    }

    /**
     * CONTROL C — legitimate moderation. The same broker moderating a comment
     * on a review about a DIFFERENT member still works, on BOTH methods. It
     * differs from the harm cases only in who the review is about.
     */
    public function test_control_a_broker_may_still_moderate_comments_on_someone_elses_review(): void
    {
        $broker = $this->staff('broker');
        $reviewer = $this->staff('member');
        $subject = $this->staff('member');
        $bystander = $this->staff('member');

        $reviewId = $this->review((int) $reviewer->id, (int) $subject->id);
        $this->feedCard($reviewId, (int) $reviewer->id);
        $hideTarget = $this->comment('review', $reviewId, (int) $bystander->id, 'F420: control hide.');
        $deleteTarget = $this->comment('review', $reviewId, (int) $bystander->id, 'F420: control delete.');

        Sanctum::actingAs($broker, ['*']);

        $hide = $this->apiPost("/v2/admin/comments/{$hideTarget}/hide");
        self::assertContains($hide->getStatusCode(), [200, 204], 'CONTROL: ordinary hide still works. ' . $hide->getContent());
        self::assertNotNull(DB::table('comments')->where('id', $hideTarget)->value('deleted_at'));

        $delete = $this->apiDelete("/v2/admin/comments/{$deleteTarget}");
        self::assertContains($delete->getStatusCode(), [200, 204], 'CONTROL: ordinary delete still works. ' . $delete->getContent());
        self::assertFalse(DB::table('comments')->where('id', $deleteTarget)->exists());
    }

    /**
     * CONTROL D — legitimate moderation of a non-review comment. A broker who
     * has been reviewed may still moderate an unrelated comment on a post.
     */
    public function test_control_a_broker_may_still_moderate_a_comment_on_a_post(): void
    {
        $broker = $this->staff('broker');
        $reviewer = $this->staff('member');
        $bystander = $this->staff('member');

        // The broker is the subject of a review, but this comment is not on it.
        $this->review((int) $reviewer->id, (int) $broker->id);
        $commentId = $this->comment('post', 987654321, (int) $bystander->id, 'F420: unrelated post comment.');

        Sanctum::actingAs($broker, ['*']);
        $res = $this->apiPost("/v2/admin/comments/{$commentId}/hide");

        self::assertContains($res->getStatusCode(), [200, 204], 'CONTROL: unrelated moderation still works. ' . $res->getContent());
        self::assertNotNull(DB::table('comments')->where('id', $commentId)->value('deleted_at'));
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    private function staff(string $role): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        DB::table('users')->where('id', $u->id)->update([
            'role' => $role,
            'is_admin' => $role === 'admin' ? 1 : 0,
        ]);

        return User::find($u->id);
    }

    private function review(int $reviewerId, int $receiverId): int
    {
        return (int) DB::table('reviews')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'reviewer_id' => $reviewerId,
            'receiver_id' => $receiverId,
            'rating' => 2,
            'comment' => 'F420 synthetic review text.',
            'review_type' => 'local',
            'status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function feedCard(int $reviewId, int $authorId): void
    {
        DB::table('feed_activity')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $authorId,
            'source_type' => 'review',
            'source_id' => $reviewId,
            'is_visible' => 1,
            'is_hidden' => 0,
            'created_at' => now(),
        ]);
    }

    private function comment(string $targetType, int $targetId, int $authorId, string $body): int
    {
        return (int) DB::table('comments')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $authorId,
            'target_type' => $targetType,
            'target_id' => $targetId,
            'content' => $body,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
