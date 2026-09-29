<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Matching;

use App\Models\Category;
use App\Models\Listing;
use App\Models\User;
use App\Services\Matching\MatchApprovalGate;
use App\Services\MatchApprovalWorkflowService;
use App\Services\MatchingService;
use App\Services\SafeguardingTriggerService;
use App\Services\SmartMatchingEngine;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * "Restrict matching" and "Require coordinator approval" must hold matches for
 * a coordinator (E-044, owner decision 27 Sep 2026: make them work).
 *
 * Before this change nothing ever called SafeguardingTriggerService::
 * isMatchingRestricted(), the smart matching engine introduced restricted
 * members like anyone else, and MatchApprovalWorkflowService::submitForApproval()
 * refused exactly the pairs that needed approval, so /broker/match-approvals
 * could never receive anything.
 */
class MatchApprovalGateTest extends TestCase
{
    use DatabaseTransactions;

    private function member(array $attrs = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => 1,
            'latitude' => 51.5000,
            'longitude' => -0.1200,
            'last_active_at' => now(),
        ], $attrs));
    }

    private function chooseOption(User $user, array $triggers): void
    {
        $optionId = DB::table('tenant_safeguarding_options')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'option_key' => 'gate_test_' . uniqid(),
            'option_type' => 'checkbox',
            'label' => 'Gate test option',
            'description' => 'Gate test option',
            'is_active' => 1,
            'is_required' => 0,
            'sort_order' => 0,
            'triggers' => json_encode($triggers),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('user_safeguarding_preferences')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'option_id' => $optionId,
            'selected_value' => '1',
            'consent_given_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        SafeguardingTriggerService::invalidateCache($user->id, $this->testTenantId);
    }

    private function listingFor(User $owner, string $type, ?int $categoryId = null): Listing
    {
        return Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $owner->id,
            'type' => $type,
            'status' => 'active',
            'category_id' => $categoryId,
            'title' => 'Gardening help ' . uniqid(),
            'description' => 'Weeding, mowing and hedge trimming in the garden every week.',
            'latitude' => 51.5000,
            'longitude' => -0.1200,
            'service_type' => 'in-person',
            'created_at' => now(),
        ]);
    }

    /** @return array<string, mixed> */
    private function matchFor(Listing $listing): array
    {
        return ['id' => $listing->id, 'user_id' => $listing->user_id, 'match_score' => 77.0, 'match_type' => 'one_way'];
    }

    private function approvalRow(User $searcher, Listing $listing): ?object
    {
        return DB::table('match_approvals')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $searcher->id)
            ->where('listing_id', $listing->id)
            ->first();
    }

    // ---------------------------------------------------------------------
    // Who needs review
    // ---------------------------------------------------------------------

    public function test_restrict_matching_approval_choice_and_monitoring_each_need_review(): void
    {
        $restricted = $this->member();
        $this->chooseOption($restricted, ['restricts_matching' => true]);
        $approval = $this->member();
        $this->chooseOption($approval, ['requires_broker_approval' => true]);
        $monitored = $this->member();
        DB::table('user_messaging_restrictions')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $monitored->id,
            'under_monitoring' => 1,
            'monitoring_reason' => 'gate test',
            'monitoring_expires_at' => now()->addDay(),
        ]);
        $other = $this->member();
        $this->chooseOption($other, ['restricts_messaging' => true]);
        $plain = $this->member();

        $flagged = app(MatchApprovalGate::class)->membersNeedingApproval(
            [$restricted->id, $approval->id, $monitored->id, $other->id, $plain->id],
            $this->testTenantId,
        );

        $this->assertArrayHasKey($restricted->id, $flagged);
        $this->assertArrayHasKey($approval->id, $flagged);
        $this->assertArrayHasKey($monitored->id, $flagged);
        $this->assertArrayNotHasKey($other->id, $flagged, 'An unrelated trigger must not hold matches');
        $this->assertArrayNotHasKey($plain->id, $flagged);
    }

    public function test_revoked_choice_and_expired_monitoring_do_not_need_review(): void
    {
        $revoked = $this->member();
        $this->chooseOption($revoked, ['restricts_matching' => true]);
        DB::table('user_safeguarding_preferences')->where('user_id', $revoked->id)->update(['revoked_at' => now()]);
        $expired = $this->member();
        DB::table('user_messaging_restrictions')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $expired->id,
            'under_monitoring' => 1,
            'monitoring_reason' => 'gate test',
            'monitoring_expires_at' => now()->subDay(),
        ]);

        $this->assertSame([], app(MatchApprovalGate::class)->membersNeedingApproval([$revoked->id, $expired->id], $this->testTenantId));
    }

    // ---------------------------------------------------------------------
    // Filtering and queueing
    // ---------------------------------------------------------------------

    public function test_unrestricted_pair_is_shown_and_nothing_is_queued(): void
    {
        $searcher = $this->member();
        $listing = $this->listingFor($this->member(), 'request');

        $kept = app(MatchApprovalGate::class)->filterListingMatches([$this->matchFor($listing)], $searcher->id, $this->testTenantId);

        $this->assertCount(1, $kept);
        $this->assertNull($this->approvalRow($searcher, $listing));
    }

    public function test_restricted_owner_is_withheld_and_queued_for_a_coordinator(): void
    {
        $searcher = $this->member();
        $owner = $this->member();
        $this->chooseOption($owner, ['restricts_matching' => true]);
        $listing = $this->listingFor($owner, 'request');

        $kept = app(MatchApprovalGate::class)->filterListingMatches([$this->matchFor($listing)], $searcher->id, $this->testTenantId);

        $this->assertSame([], $kept, 'A restricted member must never be introduced automatically');
        $row = $this->approvalRow($searcher, $listing);
        $this->assertNotNull($row, 'The held match must reach the Match Approvals queue');
        $this->assertSame('pending', $row->status);
        $this->assertSame($owner->id, (int) $row->listing_owner_id);
    }

    public function test_restricted_searcher_sees_nothing_unreviewed(): void
    {
        $searcher = $this->member();
        $this->chooseOption($searcher, ['requires_broker_approval' => true]);
        $listing = $this->listingFor($this->member(), 'request');

        $this->assertSame([], app(MatchApprovalGate::class)->filterListingMatches([$this->matchFor($listing)], $searcher->id, $this->testTenantId));
        $this->assertSame('pending', $this->approvalRow($searcher, $listing)?->status);
    }

    public function test_approved_match_is_shown_and_rejected_match_stays_hidden_without_requeue(): void
    {
        $searcher = $this->member();
        $owner = $this->member();
        $this->chooseOption($owner, ['restricts_matching' => true]);
        $approved = $this->listingFor($owner, 'request');
        $rejected = $this->listingFor($owner, 'request');
        foreach ([[$approved, 'approved'], [$rejected, 'rejected']] as [$listing, $status]) {
            DB::table('match_approvals')->insert([
                'tenant_id' => $this->testTenantId, 'user_id' => $searcher->id,
                'listing_id' => $listing->id, 'listing_owner_id' => $owner->id,
                'match_score' => 70, 'status' => $status, 'submitted_at' => now(),
            ]);
        }

        $kept = app(MatchApprovalGate::class)->filterListingMatches(
            [$this->matchFor($approved), $this->matchFor($rejected)],
            $searcher->id,
            $this->testTenantId,
        );

        $this->assertSame([$approved->id], array_column($kept, 'id'));
        $this->assertSame(1, DB::table('match_approvals')->where('listing_id', $rejected->id)->count(), 'A rejected match must not be queued again');
    }

    public function test_queueing_is_capped_per_run(): void
    {
        $searcher = $this->member();
        $owner = $this->member();
        $this->chooseOption($owner, ['restricts_matching' => true]);
        $matches = [];
        for ($i = 0; $i < MatchApprovalGate::MAX_SUBMISSIONS_PER_RUN + 2; $i++) {
            $matches[] = $this->matchFor($this->listingFor($owner, 'request'));
        }

        app(MatchApprovalGate::class)->filterListingMatches($matches, $searcher->id, $this->testTenantId);

        $this->assertSame(
            MatchApprovalGate::MAX_SUBMISSIONS_PER_RUN,
            DB::table('match_approvals')->where('user_id', $searcher->id)->count(),
        );
    }

    // ---------------------------------------------------------------------
    // The workflow: submit, approve, reject
    // ---------------------------------------------------------------------

    public function test_submission_for_a_restricted_pair_alerts_staff_including_coordinators_but_not_members(): void
    {
        $searcher = $this->member();
        $owner = $this->member();
        $this->chooseOption($owner, ['restricts_matching' => true]);
        $coordinator = $this->member(['role' => 'coordinator']);
        $listing = $this->listingFor($owner, 'request');

        $id = MatchApprovalWorkflowService::submitForApproval($searcher->id, $listing->id, ['match_score' => 81, 'match_type' => 'mutual']);

        $this->assertNotNull($id, 'The queue must accept exactly the pairs that need approval');
        $this->assertTrue(DB::table('notifications')->where('user_id', $coordinator->id)->where('type', 'match_approval_request')
            ->where('link', "/broker/match-approvals/{$id}")->exists());
        $this->assertFalse(DB::table('notifications')->whereIn('user_id', [$searcher->id, $owner->id])->exists(),
            'Neither member may hear about the match before a coordinator approves it');
    }

    public function test_approval_tells_both_members_and_rejection_tells_neither(): void
    {
        $searcher = $this->member();
        $owner = $this->member();
        $this->chooseOption($owner, ['restricts_matching' => true]);
        $reviewer = $this->member(['role' => 'broker']);
        $approveListing = $this->listingFor($owner, 'request');
        $rejectListing = $this->listingFor($owner, 'request');
        $approveId = MatchApprovalWorkflowService::submitForApproval($searcher->id, $approveListing->id, ['match_score' => 70]);
        $rejectId = MatchApprovalWorkflowService::submitForApproval($searcher->id, $rejectListing->id, ['match_score' => 70]);

        $this->assertTrue(MatchApprovalWorkflowService::rejectMatch((int) $rejectId, $reviewer->id, 'Not suitable'));
        $this->assertFalse(DB::table('notifications')->whereIn('user_id', [$searcher->id, $owner->id])->exists(),
            'A rejection must stay silent: neither member was shown the proposal');

        $this->assertTrue(MatchApprovalWorkflowService::approveMatch((int) $approveId, $reviewer->id));
        $this->assertTrue(DB::table('notifications')->where('user_id', $searcher->id)->where('type', 'match_approved')->exists());
        $this->assertTrue(DB::table('notifications')->where('user_id', $owner->id)->where('type', 'match_approved')
            ->where('link', "/profile/{$searcher->id}")->exists(), 'The listing owner must be told too');
        $ownerMessage = (string) DB::table('notifications')->where('user_id', $owner->id)->value('message');
        $this->assertStringNotContainsString('notifications.', $ownerMessage, 'The owner notice must be translated text');
        $this->assertStringContainsString($approveListing->title, $ownerMessage);

        $kept = app(MatchApprovalGate::class)->filterListingMatches(
            [$this->matchFor($approveListing), $this->matchFor($rejectListing)],
            $searcher->id,
            $this->testTenantId,
        );
        $this->assertSame([$approveListing->id], array_column($kept, 'id'));
    }

    public function test_broker_sees_the_queued_match_and_approval_is_audited(): void
    {
        $searcher = $this->member();
        $owner = $this->member();
        $this->chooseOption($owner, ['restricts_matching' => true]);
        $listing = $this->listingFor($owner, 'request');
        app(MatchApprovalGate::class)->filterListingMatches([$this->matchFor($listing)], $searcher->id, $this->testTenantId);
        $broker = $this->member(['role' => 'broker']);
        Sanctum::actingAs($broker);

        $list = $this->apiGet('/v2/admin/matching/approvals?status=pending');
        $list->assertStatus(200);
        $ids = array_column($list->json('data'), 'listing_id');
        $this->assertContains($listing->id, $ids);

        $approvalId = (int) $this->approvalRow($searcher, $listing)->id;
        $this->apiPost("/v2/admin/matching/approvals/{$approvalId}/approve", ['notes' => 'ok'])->assertStatus(200);
        $this->assertTrue(DB::table('org_audit_log')->where('tenant_id', $this->testTenantId)
            ->where('user_id', $broker->id)->where('action', 'match_approved')->exists());
    }

    // ---------------------------------------------------------------------
    // Every introduction path goes through the gate
    // ---------------------------------------------------------------------

    public function test_matching_engine_withholds_a_restricted_members_listing(): void
    {
        $category = Category::factory()->create(['tenant_id' => $this->testTenantId, 'type' => 'listing']);
        $searcher = $this->member();
        $this->listingFor($searcher, 'offer', $category->id);
        $plainOwner = $this->member();
        $plainListing = $this->listingFor($plainOwner, 'request', $category->id);
        $restrictedOwner = $this->member();
        $restrictedListing = $this->listingFor($restrictedOwner, 'request', $category->id);
        $this->chooseOption($restrictedOwner, ['restricts_matching' => true]);

        $ids = array_column(
            app(SmartMatchingEngine::class)->findMatchesForUser($searcher->id, ['min_score' => 0, 'max_distance' => 500, 'limit' => 50]),
            'id',
        );

        $this->assertContains($plainListing->id, $ids, 'Control: the unrestricted listing must match');
        $this->assertNotContains($restrictedListing->id, $ids);
        $this->assertSame('pending', $this->approvalRow($searcher, $restrictedListing)?->status);
    }

    public function test_digest_suggestions_never_include_a_restricted_member(): void
    {
        $searcher = $this->member();
        $restricted = $this->member();
        $this->chooseOption($restricted, ['restricts_matching' => true]);

        for ($i = 0; $i < 5; $i++) {
            $ids = array_map(fn ($s) => (int) $s->id, MatchingService::getSuggestionsForUser($searcher->id, 100));
            $this->assertNotContains($restricted->id, $ids);
        }

        $this->assertSame([], MatchingService::getSuggestionsForUser($restricted->id, 100),
            'A restricted member gets no automatic member suggestions');
    }
}
