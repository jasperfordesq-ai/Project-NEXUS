<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\FeedPost;
use App\Models\Goal;
use App\Models\Post;
use App\Models\User;
use App\Models\VolOpportunity;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Authorization contract for the moderation surfaces shared between the admin
 * panel and the broker panel (/broker/moderation/* + /broker/safeguarding-options).
 *
 * Content moderation is a broker duty, so the content queue, feed/comments/
 * reviews moderation, member reports, and safeguarding options endpoints are
 * broker-or-admin. This test pins the security boundary:
 *   - brokers CAN list and moderate OTHER members' content
 *   - brokers CANNOT moderate content they are a party to (self-dealing
 *     guards, mirroring the match-approval and balance guards)
 *   - privilege/policy surfaces stay admin-only (announcer grant/revoke,
 *     moderation settings, safeguarding statement)
 *   - regular members are rejected outright
 * See routes/api.php (broker-or-admin moderation groups) and the
 * guardBrokerNot* helpers in the Admin{Feed,Comments,Reviews,Reports,
 * AnalyticsReports}Controllers.
 */
class BrokerModerationAuthorizationTest extends TestCase
{
    use DatabaseTransactions;

    private function broker(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker']);
    }

    private function admin(): User
    {
        return User::factory()->forTenant($this->testTenantId)->admin()->create();
    }

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create();
    }

    // ── Seed helpers ─────────────────────────────────────────────────

    private function seedQueueItem(User $author): int
    {
        return DB::table('content_moderation_queue')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'content_type' => 'post',
            'content_id' => 999000 + $author->id,
            'author_id' => $author->id,
            'title' => 'Queued content for moderation',
            'status' => 'pending',
        ]);
    }

    private function seedFeedPost(User $author): int
    {
        $sourceId = 990000 + $author->id;
        DB::table('feed_activity')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $author->id,
            'source_type' => 'post',
            'source_id' => $sourceId,
            'title' => 'A feed post',
            'content' => 'Feed content',
        ]);
        return $sourceId;
    }

    private function seedComment(User $author): int
    {
        return DB::table('comments')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $author->id,
            'target_type' => 'post',
            'target_id' => 1,
            'content' => 'A comment under moderation',
        ]);
    }

    private function seedReview(User $reviewer, User $receiver): int
    {
        return DB::table('reviews')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'reviewer_id' => $reviewer->id,
            'receiver_id' => $receiver->id,
            'rating' => 2,
            'comment' => 'A review under moderation',
            'status' => 'approved',
        ]);
    }

    private function seedReport(User $reporter, string $targetType = 'post', ?int $targetId = null): int
    {
        return DB::table('reports')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'reporter_id' => $reporter->id,
            'target_type' => $targetType,
            'target_id' => $targetId ?? 1,
            'reason' => 'Reported for moderation testing',
            'status' => 'open',
        ]);
    }

    // ================================================================
    // Brokers CAN — moderating other members' content is a broker duty
    // ================================================================

    public function test_broker_can_list_the_moderation_queue(): void
    {
        Sanctum::actingAs($this->broker());

        $this->apiGet('/v2/admin/moderation/queue')->assertStatus(200);
    }

    public function test_broker_can_review_another_members_queued_content(): void
    {
        [$broker, $author] = [$this->broker(), $this->member()];
        $id = $this->seedQueueItem($author);
        Sanctum::actingAs($broker);

        $response = $this->apiPost("/v2/admin/moderation/{$id}/review", ['decision' => 'approved']);

        $response->assertStatus(200);
    }

    public function test_broker_can_list_feed_posts_comments_reviews_reports_and_stats(): void
    {
        Sanctum::actingAs($this->broker());

        $this->apiGet('/v2/admin/feed/posts')->assertStatus(200);
        $this->apiGet('/v2/admin/feed/stats')->assertStatus(200);
        $this->apiGet('/v2/admin/comments')->assertStatus(200);
        $this->apiGet('/v2/admin/reviews')->assertStatus(200);
        $this->apiGet('/v2/admin/reports')->assertStatus(200);
        $this->apiGet('/v2/admin/reports/stats')->assertStatus(200);
        $this->apiGet('/v2/admin/moderation/stats')->assertStatus(200);
    }

    public function test_broker_can_hide_another_members_feed_post(): void
    {
        $sourceId = $this->seedFeedPost($this->member());
        Sanctum::actingAs($this->broker());

        $this->apiPost("/v2/admin/feed/posts/{$sourceId}/hide")->assertStatus(200);
    }

    public function test_broker_can_hide_and_delete_another_members_comment(): void
    {
        $author = $this->member();
        Sanctum::actingAs($this->broker());

        $hideId = $this->seedComment($author);
        $this->apiPost("/v2/admin/comments/{$hideId}/hide")->assertStatus(200);

        $deleteId = $this->seedComment($author);
        $this->apiDelete("/v2/admin/comments/{$deleteId}")->assertStatus(200);
    }

    public function test_broker_can_moderate_a_review_between_other_members(): void
    {
        $id = $this->seedReview($this->member(), $this->member());
        Sanctum::actingAs($this->broker());

        $this->apiPost("/v2/admin/reviews/{$id}/hide")->assertStatus(200);
    }

    public function test_broker_can_resolve_a_report_filed_by_another_member(): void
    {
        $post = FeedPost::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $this->member()->id,
        ]);
        $id = $this->seedReport($this->member(), 'post', (int) $post->id);
        Sanctum::actingAs($this->broker());

        $this->apiPost("/v2/admin/reports/{$id}/resolve")->assertStatus(200);
        $this->assertSame('resolved', DB::table('reports')->where('id', $id)->value('status'));
    }

    public function test_broker_can_manage_safeguarding_options(): void
    {
        Sanctum::actingAs($this->broker());

        $this->apiGet('/v2/admin/safeguarding/options')->assertStatus(200);
        $this->apiPost('/v2/admin/safeguarding/options', [
            'option_key' => 'broker_test_option',
            'label' => 'Broker test option',
        ])->assertStatus(201);
    }

    // ================================================================
    // Brokers CANNOT — self-dealing guards
    // ================================================================

    public function test_broker_cannot_review_their_own_queued_content(): void
    {
        $broker = $this->broker();
        $id = $this->seedQueueItem($broker);
        Sanctum::actingAs($broker);

        $this->apiPost("/v2/admin/moderation/{$id}/review", ['decision' => 'approved'])->assertStatus(403);
        $this->assertSame('pending', DB::table('content_moderation_queue')->where('id', $id)->value('status'));
    }

    public function test_broker_cannot_hide_or_delete_their_own_feed_post(): void
    {
        $broker = $this->broker();
        $sourceId = $this->seedFeedPost($broker);
        Sanctum::actingAs($broker);

        $this->apiPost("/v2/admin/feed/posts/{$sourceId}/hide")->assertStatus(403);
        $this->apiDelete("/v2/admin/feed/posts/{$sourceId}")->assertStatus(403);
        $this->assertSame(0, (int) DB::table('feed_activity')
            ->where('tenant_id', $this->testTenantId)
            ->where('source_type', 'post')->where('source_id', $sourceId)
            ->value('is_hidden'));
    }

    public function test_broker_cannot_hide_or_delete_their_own_comment(): void
    {
        $broker = $this->broker();
        $id = $this->seedComment($broker);
        Sanctum::actingAs($broker);

        $this->apiPost("/v2/admin/comments/{$id}/hide")->assertStatus(403);
        $this->apiDelete("/v2/admin/comments/{$id}")->assertStatus(403);
        $this->assertNotNull(DB::table('comments')->where('id', $id)->first(), 'Guarded comment must survive.');
    }

    public function test_broker_cannot_moderate_a_review_they_wrote(): void
    {
        $broker = $this->broker();
        $id = $this->seedReview($broker, $this->member());
        Sanctum::actingAs($broker);

        $this->apiPost("/v2/admin/reviews/{$id}/flag")->assertStatus(403);
        $this->apiPost("/v2/admin/reviews/{$id}/hide")->assertStatus(403);
        $this->apiDelete("/v2/admin/reviews/{$id}")->assertStatus(403);
        $this->assertSame('approved', DB::table('reviews')->where('id', $id)->value('status'));
    }

    public function test_broker_cannot_moderate_a_review_they_received(): void
    {
        $broker = $this->broker();
        $id = $this->seedReview($this->member(), $broker);
        Sanctum::actingAs($broker);

        $this->apiPost("/v2/admin/reviews/{$id}/hide")->assertStatus(403);
        $this->apiDelete("/v2/admin/reviews/{$id}")->assertStatus(403);
        $this->assertNotNull(DB::table('reviews')->where('id', $id)->first());
    }

    public function test_broker_cannot_close_a_report_they_filed(): void
    {
        $broker = $this->broker();
        $id = $this->seedReport($broker);
        Sanctum::actingAs($broker);

        $this->apiPost("/v2/admin/reports/{$id}/resolve")->assertStatus(403);
        $this->apiPost("/v2/admin/reports/{$id}/dismiss")->assertStatus(403);
        $this->assertSame('open', DB::table('reports')->where('id', $id)->value('status'));
    }

    public function test_broker_cannot_dismiss_a_report_targeting_them(): void
    {
        $broker = $this->broker();
        $id = $this->seedReport($this->member(), 'user', $broker->id);
        Sanctum::actingAs($broker);

        $this->apiPost("/v2/admin/reports/{$id}/dismiss")->assertStatus(403);
        $this->assertSame('open', DB::table('reports')->where('id', $id)->value('status'));
    }

    // F-218: a report about the broker's own CONTENT is theirs too.

    public function test_broker_cannot_close_a_report_about_their_own_listing(): void
    {
        $broker = $this->broker();
        $listing = \App\Models\Listing::factory()->create(['tenant_id' => $this->testTenantId, 'user_id' => $broker->id]);
        $id = $this->seedReport($this->member(), 'listing', (int) $listing->id);
        Sanctum::actingAs($broker);

        $this->apiPost("/v2/admin/reports/{$id}/resolve")->assertStatus(403);
        $this->apiPost("/v2/admin/reports/{$id}/dismiss")->assertStatus(403);
        $this->assertSame('open', DB::table('reports')->where('id', $id)->value('status'));
    }

    public function test_broker_cannot_close_a_report_about_their_own_post(): void
    {
        $broker = $this->broker();
        $post = \App\Models\FeedPost::factory()->forTenant($this->testTenantId)->create(['user_id' => $broker->id]);
        $id = $this->seedReport($this->member(), 'post', (int) $post->id);
        Sanctum::actingAs($broker);

        $this->apiPost("/v2/admin/reports/{$id}/dismiss")->assertStatus(403);
        $this->assertSame('open', DB::table('reports')->where('id', $id)->value('status'));
    }

    public function test_broker_cannot_close_a_report_about_their_own_comment(): void
    {
        $broker = $this->broker();
        $commentId = $this->seedComment($broker);
        $id = $this->seedReport($this->member(), 'comment', $commentId);
        Sanctum::actingAs($broker);

        $this->apiPost("/v2/admin/reports/{$id}/resolve")->assertStatus(403);
        $this->assertSame('open', DB::table('reports')->where('id', $id)->value('status'));
    }

    public function test_broker_cannot_dismiss_a_members_report_about_their_public_goal(): void
    {
        $broker = $this->broker();
        $reporter = $this->member();
        $goal = Goal::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $broker->id,
            'is_public' => true,
        ]);
        $reportId = $this->seedReport($reporter, 'goal', (int) $goal->id);

        Sanctum::actingAs($broker);
        $this->apiPost("/v2/admin/reports/{$reportId}/dismiss")->assertStatus(403);
        $this->assertSame('open', DB::table('reports')->where('id', $reportId)->value('status'));
    }

    public function test_broker_cannot_close_reports_about_their_blog_or_volunteering_opportunity(): void
    {
        $broker = $this->broker();
        $reporter = $this->member();
        $blog = Post::factory()->forTenant($this->testTenantId)->published()->create(['author_id' => $broker->id]);
        $opportunity = VolOpportunity::factory()->forTenant($this->testTenantId)->create(['created_by' => $broker->id]);
        $blogReport = $this->seedReport($reporter, 'blog', (int) $blog->id);
        $volunteerReport = $this->seedReport($reporter, 'volunteer', (int) $opportunity->id);
        Sanctum::actingAs($broker);

        $this->apiPost("/v2/admin/reports/{$blogReport}/resolve")->assertStatus(403);
        $this->apiPost("/v2/admin/reports/{$volunteerReport}/dismiss")->assertStatus(403);
        $this->assertSame('open', DB::table('reports')->where('id', $blogReport)->value('status'));
        $this->assertSame('open', DB::table('reports')->where('id', $volunteerReport)->value('status'));
    }

    public function test_broker_can_resolve_a_report_about_another_members_goal(): void
    {
        $goal = Goal::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $this->member()->id,
            'is_public' => true,
        ]);
        $reportId = $this->seedReport($this->member(), 'goal', (int) $goal->id);
        Sanctum::actingAs($this->broker());

        $this->apiPost("/v2/admin/reports/{$reportId}/resolve")->assertStatus(200);
        $this->assertSame('resolved', DB::table('reports')->where('id', $reportId)->value('status'));
    }

    public function test_broker_cannot_dismiss_a_report_after_deleting_their_goal(): void
    {
        $broker = $this->broker();
        $goal = Goal::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $broker->id,
            'is_public' => true,
        ]);
        $reportId = $this->seedReport($this->member(), 'goal', (int) $goal->id);
        $goal->delete();
        Sanctum::actingAs($broker);

        $this->apiPost("/v2/admin/reports/{$reportId}/dismiss")->assertStatus(403);
        $this->assertSame('open', DB::table('reports')->where('id', $reportId)->value('status'));

        Sanctum::actingAs($this->admin());
        $this->apiPost("/v2/admin/reports/{$reportId}/resolve")->assertStatus(200);
    }

    public function test_broker_cannot_close_a_report_about_a_review_they_wrote_or_received(): void
    {
        $broker = $this->broker();
        $wrote = $this->seedReport($this->member(), 'review', $this->seedReview($broker, $this->member()));
        $received = $this->seedReport($this->member(), 'review', $this->seedReview($this->member(), $broker));
        Sanctum::actingAs($broker);

        $this->apiPost("/v2/admin/reports/{$wrote}/dismiss")->assertStatus(403);
        $this->apiPost("/v2/admin/reports/{$received}/dismiss")->assertStatus(403);
        $this->assertSame('open', DB::table('reports')->where('id', $wrote)->value('status'));
        $this->assertSame('open', DB::table('reports')->where('id', $received)->value('status'));
    }

    public function test_broker_can_close_a_report_about_another_members_listing(): void
    {
        $listing = \App\Models\Listing::factory()->create(['tenant_id' => $this->testTenantId, 'user_id' => $this->member()->id]);
        $id = $this->seedReport($this->member(), 'listing', (int) $listing->id);
        Sanctum::actingAs($this->broker());

        $this->apiPost("/v2/admin/reports/{$id}/resolve")->assertStatus(200);
        $this->assertSame('resolved', DB::table('reports')->where('id', $id)->value('status'));
    }

    public function test_admin_can_close_a_report_about_their_own_listing(): void
    {
        $admin = $this->admin();
        $listing = \App\Models\Listing::factory()->create(['tenant_id' => $this->testTenantId, 'user_id' => $admin->id]);
        $id = $this->seedReport($this->member(), 'listing', (int) $listing->id);
        Sanctum::actingAs($admin);

        $this->apiPost("/v2/admin/reports/{$id}/resolve")->assertStatus(200);
    }

    // ================================================================
    // Admin-only leftovers stay admin-only for brokers
    // ================================================================

    public function test_broker_cannot_grant_or_revoke_announcer(): void
    {
        $target = $this->member();
        Sanctum::actingAs($this->broker());

        $this->apiPost('/v2/admin/feed/grant-announcer', ['user_id' => $target->id])->assertStatus(403);
        $this->apiDelete("/v2/admin/feed/revoke-announcer/{$target->id}")->assertStatus(403);
    }

    public function test_broker_can_read_and_update_moderation_settings(): void
    {
        // F-543 (owner decision, 2 Oct 2026): the settings panel is part of the
        // broker panel's Content Queue page, and brokers have the whole panel.
        Sanctum::actingAs($this->broker());

        $this->apiGet('/v2/admin/moderation/settings')->assertStatus(200);
        $this->apiPut('/v2/admin/moderation/settings', ['require_post' => true])->assertStatus(200);
        $this->assertTrue((bool) $this->apiGet('/v2/admin/moderation/settings')->json('data.require_post'));
    }

    public function test_a_plain_member_still_cannot_read_or_update_moderation_settings(): void
    {
        Sanctum::actingAs($this->member());

        $this->apiGet('/v2/admin/moderation/settings')->assertStatus(403);
        $this->apiPut('/v2/admin/moderation/settings', ['require_post' => true])->assertStatus(403);
    }

    // ================================================================
    // Admins retain full latitude (guards only restrict brokers)
    // ================================================================

    public function test_admin_can_moderate_their_own_comment(): void
    {
        $admin = $this->admin();
        $id = $this->seedComment($admin);
        Sanctum::actingAs($admin);

        $this->apiPost("/v2/admin/comments/{$id}/hide")->assertStatus(200);
    }

    // ================================================================
    // Regular members are rejected outright
    // ================================================================

    public function test_regular_member_cannot_access_moderation_surfaces(): void
    {
        $victimComment = $this->seedComment($this->member());
        Sanctum::actingAs($this->member());

        $this->apiGet('/v2/admin/moderation/queue')->assertStatus(403);
        $this->apiGet('/v2/admin/feed/posts')->assertStatus(403);
        $this->apiPost("/v2/admin/comments/{$victimComment}/hide")->assertStatus(403);
        $this->apiGet('/v2/admin/safeguarding/options')->assertStatus(403);
    }
}
