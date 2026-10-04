<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\Listing;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * GET /v2/listings/mine — the member's own "My listings" page.
 *
 * Every public listing read hides anything that is not live and approved, so
 * before this endpoint a member had no way to find their own listing once it
 * expired, was waiting for review, or was not approved. These tests pin the
 * five owner-facing groups, their counts, and that nobody else's listings —
 * in this community or another — can ever appear.
 */
class MyListingsTest extends TestCase
{
    use DatabaseTransactions;

    private function member(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    private function listing(User $owner, array $attrs = []): Listing
    {
        return Listing::factory()->forTenant($this->testTenantId)->create(array_merge([
            'user_id' => $owner->id,
            'type' => 'offer',
            'status' => 'active',
            'moderation_status' => null,
        ], $attrs));
    }

    /** @return int[] */
    private function idsFor(string $query): array
    {
        $response = $this->apiGet('/v2/listings/mine' . $query);
        $response->assertStatus(200);

        return array_map('intval', array_column($response->json('data'), 'id'));
    }

    public function test_requires_authentication(): void
    {
        $this->apiGet('/v2/listings/mine')->assertStatus(401);
    }

    public function test_each_listing_lands_in_exactly_one_group(): void
    {
        $me = $this->member();

        $live      = $this->listing($me);
        $approved  = $this->listing($me, ['moderation_status' => 'approved']);
        $review    = $this->listing($me, ['moderation_status' => 'pending_review']);
        $legacy    = $this->listing($me, ['status' => 'pending']);
        $rejected  = $this->listing($me, ['status' => 'rejected', 'moderation_status' => 'rejected', 'rejection_reason' => 'Too vague']);
        $expired   = $this->listing($me, ['status' => 'expired', 'expires_at' => now()->subDay()]);
        $closed    = $this->listing($me, ['status' => 'closed']);
        $deleted   = $this->listing($me, ['status' => 'deleted']);

        $this->assertEqualsCanonicalizing([$live->id, $approved->id], $this->idsFor('?status=live'));
        $this->assertEqualsCanonicalizing([$review->id, $legacy->id], $this->idsFor('?status=review'));
        $this->assertSame([$rejected->id], $this->idsFor('?status=rejected'));
        $this->assertSame([$expired->id], $this->idsFor('?status=expired'));
        $this->assertSame([$closed->id], $this->idsFor('?status=closed'));

        foreach (['live', 'review', 'rejected', 'expired', 'closed'] as $group) {
            $this->assertNotContains($deleted->id, $this->idsFor('?status=' . $group), "deleted listing leaked into {$group}");
        }
    }

    public function test_defaults_to_live_and_reports_counts_for_every_group(): void
    {
        $me = $this->member();
        $this->listing($me);
        $this->listing($me);
        $this->listing($me, ['moderation_status' => 'pending_review']);
        $this->listing($me, ['status' => 'expired']);

        $response = $this->apiGet('/v2/listings/mine');
        $response->assertStatus(200);

        $this->assertCount(2, $response->json('data'));
        $this->assertSame(
            ['live' => 2, 'review' => 1, 'rejected' => 0, 'expired' => 1, 'closed' => 0],
            $response->json('meta.counts')
        );
        $this->assertSame('live', $response->json('data.0.owner_state'));
    }

    public function test_type_filter_narrows_both_the_list_and_the_counts(): void
    {
        $me = $this->member();
        $offer = $this->listing($me, ['type' => 'offer']);
        $this->listing($me, ['type' => 'request']);
        $this->listing($me, ['type' => 'request', 'status' => 'expired']);

        $response = $this->apiGet('/v2/listings/mine?type=offer');
        $response->assertStatus(200);

        $this->assertSame([$offer->id], array_map('intval', array_column($response->json('data'), 'id')));
        $this->assertSame(1, $response->json('meta.counts.live'));
        $this->assertSame(0, $response->json('meta.counts.expired'));
    }

    public function test_never_returns_another_members_listings(): void
    {
        $someoneElse = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $theirs = $this->listing($someoneElse);
        $theirsExpired = $this->listing($someoneElse, ['status' => 'expired']);

        $me = $this->member();
        $mine = $this->listing($me);

        $this->assertSame([$mine->id], $this->idsFor('?status=live'));
        $this->assertNotContains($theirsExpired->id, $this->idsFor('?status=expired'));
        $this->assertNotContains($theirs->id, $this->idsFor('?status=live'));
    }

    public function test_rejected_listing_carries_its_reason_for_the_owner(): void
    {
        $me = $this->member();
        $this->listing($me, ['status' => 'rejected', 'moderation_status' => 'rejected', 'rejection_reason' => 'Please add a clearer description']);

        $response = $this->apiGet('/v2/listings/mine?status=rejected');

        $response->assertStatus(200);
        $this->assertSame('Please add a clearer description', $response->json('data.0.rejection_reason'));
        $this->assertSame('rejected', $response->json('data.0.owner_state'));
    }

    public function test_unknown_status_and_type_are_refused(): void
    {
        $this->member();

        $this->apiGet('/v2/listings/mine?status=everything')->assertStatus(422);
        $this->apiGet('/v2/listings/mine?type=banana')->assertStatus(422);
    }

    public function test_cursor_pagination_walks_every_listing_once(): void
    {
        $me = $this->member();
        $ids = [];
        for ($i = 0; $i < 5; $i++) {
            $ids[] = $this->listing($me)->id;
        }

        $first = $this->apiGet('/v2/listings/mine?limit=2');
        $first->assertStatus(200);
        $this->assertTrue($first->json('meta.has_more'));

        $seen = array_column($first->json('data'), 'id');
        $cursor = $first->json('meta.cursor');
        while ($cursor) {
            $page = $this->apiGet('/v2/listings/mine?limit=2&cursor=' . urlencode($cursor));
            $page->assertStatus(200);
            $seen = array_merge($seen, array_column($page->json('data'), 'id'));
            $cursor = $page->json('meta.cursor');
        }

        $this->assertEqualsCanonicalizing($ids, array_map('intval', $seen));
    }
}
