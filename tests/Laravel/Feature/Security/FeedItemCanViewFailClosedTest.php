<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security;

use App\Models\User;
use App\Support\FeedItemTables;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-071 (E-027): FeedItemTables::canView() returned true for any item that had
 * no feed_activity row. Private goals never get one, so anyone could read and
 * write comments and reactions on another member's private goal. Draft and
 * unmoderated items of other types without a feed row were open the same way.
 *
 * canView() now fails closed when there is no feed row, after applying each
 * module's own read rule, and always applies the goal and ideation-challenge
 * rules (both keep a feed row after the item stops being public).
 */
class FeedItemCanViewFailClosedTest extends TestCase
{
    use DatabaseTransactions;

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ]);
    }

    private function activity(string $type, int $sourceId, int $userId): void
    {
        DB::table('feed_activity')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $userId,
            'source_type' => $type,
            'source_id' => $sourceId,
            'title' => 'feed row',
            'content' => 'feed row',
            'is_visible' => 1,
            'is_hidden' => 0,
            'created_at' => now(),
        ]);
    }

    private function goal(User $owner, bool $public, ?User $mentor = null): int
    {
        $goalId = (int) DB::table('goals')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'mentor_id' => $mentor?->id,
            'title' => 'Private goal: pay off the credit union loan',
            'description' => 'Personal',
            'is_public' => $public ? 1 : 0,
            'status' => 'active',
            'created_at' => now(),
        ]);
        // As in GoalsController::store(): only public goals get a feed row.
        if ($public) {
            $this->activity('goal', $goalId, (int) $owner->id);
        }

        return $goalId;
    }

    public function test_private_goal_comments_and_reactions_are_refused_to_other_members(): void
    {
        $owner = $this->member();
        $mentor = $this->member();
        $goalId = $this->goal($owner, false, $mentor);
        DB::table('comments')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'target_type' => 'goal',
            'target_id' => $goalId,
            'content' => 'Note to self: second payment made',
            'created_at' => now(),
        ]);

        Sanctum::actingAs($this->member(), ['*']);
        $this->apiGet("/v2/comments?target_type=goal&target_id={$goalId}")->assertStatus(404);
        $this->apiPost('/v2/comments', ['target_type' => 'goal', 'target_id' => $goalId, 'content' => 'Nosy reply'])
            ->assertStatus(404);
        $this->apiPost('/v2/reactions', ['target_type' => 'goal', 'target_id' => $goalId, 'reaction_type' => 'like'])
            ->assertStatus(404);
        $this->assertSame(0, DB::table('comments')->where('target_type', 'goal')->where('target_id', $goalId)
            ->where('content', 'Nosy reply')->count());
        $this->assertSame(0, DB::table('reactions')->where('target_type', 'goal')->where('target_id', $goalId)->count());

        // Controls: the owner and the goal's mentor keep access.
        Sanctum::actingAs($owner, ['*']);
        $this->apiGet("/v2/comments?target_type=goal&target_id={$goalId}")->assertStatus(200)
            ->assertJsonPath('data.count', 1);
        $this->apiPost('/v2/comments', ['target_type' => 'goal', 'target_id' => $goalId, 'content' => 'Third payment'])
            ->assertStatus(201);

        Sanctum::actingAs($mentor, ['*']);
        $this->apiGet("/v2/comments?target_type=goal&target_id={$goalId}")->assertStatus(200);
    }

    public function test_goal_made_private_after_being_posted_is_refused(): void
    {
        $owner = $this->member();
        $goalId = $this->goal($owner, true);
        $outsider = $this->member();

        $this->assertTrue(FeedItemTables::canView('goal', $goalId, (int) $outsider->id), 'control: public goal');

        // The feed row stays behind when a goal is switched to private.
        DB::table('goals')->where('id', $goalId)->update(['is_public' => 0]);
        $this->assertFalse(FeedItemTables::canView('goal', $goalId, (int) $outsider->id));
        $this->assertTrue(FeedItemTables::canView('goal', $goalId, (int) $owner->id));
    }

    public function test_items_without_a_feed_row_follow_their_module_rule(): void
    {
        $author = $this->member();
        $outsider = (int) $this->member()->id;
        $authorId = (int) $author->id;

        // Blog articles (posts table): drafts are author-only.
        $blog = fn (string $status) => (int) DB::table('posts')->insertGetId([
            'tenant_id' => $this->testTenantId, 'author_id' => $authorId, 'title' => 'Article',
            'slug' => 'article-' . uniqid(), 'content' => 'Body', 'status' => $status,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $draftBlog = $blog('draft');
        $this->assertFalse(FeedItemTables::canView('blog', $draftBlog, $outsider));
        $this->assertTrue(FeedItemTables::canView('blog', $draftBlog, $authorId));
        $this->assertTrue(FeedItemTables::canView('blog', $blog('published'), $outsider));

        // Listings: pending moderation is owner-only.
        $listing = fn (array $o) => (int) DB::table('listings')->insertGetId($o + [
            'tenant_id' => $this->testTenantId, 'user_id' => $authorId, 'title' => 'Offer', 'type' => 'offer',
            'created_at' => now(),
        ]);
        $pendingListing = $listing(['status' => 'pending', 'moderation_status' => 'pending_review']);
        $this->assertFalse(FeedItemTables::canView('listing', $pendingListing, $outsider));
        $this->assertTrue(FeedItemTables::canView('listing', $pendingListing, $authorId));
        $this->assertTrue(FeedItemTables::canView('listing', $listing(['status' => 'active', 'moderation_status' => 'approved']), $outsider));

        // Job vacancies: drafts are owner-only.
        $job = fn (string $status) => (int) DB::table('job_vacancies')->insertGetId([
            'tenant_id' => $this->testTenantId, 'user_id' => $authorId, 'title' => 'Role',
            'description' => 'Role', 'status' => $status, 'created_at' => now(),
        ]);
        $draftJob = $job('draft');
        $this->assertFalse(FeedItemTables::canView('job', $draftJob, $outsider));
        $this->assertTrue(FeedItemTables::canView('job', $draftJob, $authorId));
        $this->assertTrue(FeedItemTables::canView('job', $job('open'), $outsider));

        // Reviews: rejected reviews are visible only to the two parties.
        $receiver = (int) $this->member()->id;
        $review = fn (string $status) => (int) DB::table('reviews')->insertGetId([
            'tenant_id' => $this->testTenantId, 'reviewer_id' => $authorId, 'receiver_id' => $receiver,
            'rating' => 2, 'comment' => 'Review', 'status' => $status, 'created_at' => now(),
        ]);
        $rejected = $review('rejected');
        $this->assertFalse(FeedItemTables::canView('review', $rejected, $outsider));
        $this->assertTrue(FeedItemTables::canView('review', $rejected, $receiver));
        $this->assertTrue(FeedItemTables::canView('review', $review('approved'), $outsider));

        // Volunteer opportunities: closed ones are for the organisation only.
        $orgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId, 'user_id' => $authorId, 'name' => 'Org ' . uniqid(),
            'status' => 'approved', 'created_at' => now(),
        ]);
        $opportunity = fn (int $active) => (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId, 'organization_id' => $orgId, 'title' => 'Help',
            'description' => 'Help', 'is_active' => $active, 'status' => 'open', 'created_by' => $authorId,
            'created_at' => now(),
        ]);
        $inactive = $opportunity(0);
        $this->assertFalse(FeedItemTables::canView('volunteer', $inactive, $outsider));
        $this->assertTrue(FeedItemTables::canView('volunteer', $inactive, $authorId));
        $this->assertTrue(FeedItemTables::canView('volunteer', $opportunity(1), $outsider));

        // Events: drafts are refused by EventPolicy::view.
        $event = fn (string $publication) => (int) DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId, 'user_id' => $authorId, 'title' => 'Meetup',
            'description' => 'Meetup', 'start_time' => now()->addWeek(), 'status' => 'active',
            'publication_status' => $publication, 'created_at' => now(),
        ]);
        $this->assertFalse(FeedItemTables::canView('event', $event('draft'), $outsider));
        $this->assertTrue(FeedItemTables::canView('event', $event('published'), $outsider));

        // Resources have no hidden state; polls without a feed row belong to no group.
        $resourceId = (int) DB::table('resources')->insertGetId([
            'tenant_id' => $this->testTenantId, 'user_id' => $authorId, 'title' => 'Guide',
            'file_path' => 'guide.pdf', 'created_at' => now(),
        ]);
        $this->assertTrue(FeedItemTables::canView('resource', $resourceId, $outsider));
        $pollId = (int) DB::table('polls')->insertGetId([
            'tenant_id' => $this->testTenantId, 'user_id' => $authorId, 'question' => 'Q?', 'created_at' => now(),
        ]);
        $this->assertTrue(FeedItemTables::canView('poll', $pollId, $outsider));
    }

    public function test_draft_challenge_is_refused_even_with_a_feed_row(): void
    {
        $author = $this->member();
        $outsider = (int) $this->member()->id;
        $challenge = fn (string $status) => (int) DB::table('ideation_challenges')->insertGetId([
            'tenant_id' => $this->testTenantId, 'user_id' => $author->id, 'title' => 'Challenge',
            'description' => 'Challenge', 'status' => $status, 'created_at' => now(),
        ]);

        // IdeationChallengesController::store() writes a feed row even for a draft.
        $draft = $challenge('draft');
        $this->activity('challenge', $draft, (int) $author->id);
        $this->assertFalse(FeedItemTables::canView('challenge', $draft, $outsider));
        $this->assertTrue(FeedItemTables::canView('challenge', $draft, (int) $author->id));

        $open = $challenge('open');
        $this->activity('challenge', $open, (int) $author->id);
        $this->assertTrue(FeedItemTables::canView('challenge', $open, $outsider));
    }
}
