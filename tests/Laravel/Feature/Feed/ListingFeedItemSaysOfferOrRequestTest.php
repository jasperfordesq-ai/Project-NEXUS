<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Feed;

use App\Models\Listing;
use App\Models\User;
use App\Services\FeedActivityService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * A listing in the feed says whether it is an offer or a request.
 *
 * The feed read `listing_type` only from the activity's metadata, but two of
 * the three places that put a listing in the feed (ListingsController::store
 * and ListingObserver, plus the backfill command) never wrote it — only
 * ListingModerationService did. So most listing cards could not say "Offer" or
 * "Request", and the feed's Offers / Requests sub-filter, which matched on the
 * same metadata, left those listings out (found 9 Nov 2026 while adding the
 * Offer/Request label to feed cards). The listing's own type is the truth.
 */
class ListingFeedItemSaysOfferOrRequestTest extends TestCase
{
    use DatabaseTransactions;

    private function seedRequestWithoutMetadata(): array
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($user, ['*']);

        $listing = Listing::factory()->create([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'type' => 'request',
            'status' => 'active',
            'title' => 'Help moving a sofa',
        ]);

        // The same call ListingsController::store and ListingObserver make: no metadata.
        app(FeedActivityService::class)->recordActivity($this->testTenantId, (int) $user->id, 'listing', (int) $listing->id, [
            'title' => $listing->title,
            'content' => 'Two people for twenty minutes.',
        ]);

        return [$user, $listing];
    }

    private function feedItem(string $query, int $listingId): ?array
    {
        $response = $this->apiGet('/v2/feed?' . $query);
        $response->assertStatus(200);

        return collect($response->json('data'))
            ->first(fn ($item) => ($item['type'] ?? null) === 'listing' && (int) ($item['id'] ?? 0) === $listingId);
    }

    public function test_a_listing_says_it_is_a_request_even_when_its_activity_has_no_metadata(): void
    {
        [, $listing] = $this->seedRequestWithoutMetadata();

        $item = $this->feedItem('per_page=50', (int) $listing->id);

        $this->assertNotNull($item, 'the seeded listing should appear in the feed');
        $this->assertSame('request', $item['listing_type']);
    }

    public function test_the_requests_sub_filter_finds_it_and_the_offers_sub_filter_does_not(): void
    {
        [, $listing] = $this->seedRequestWithoutMetadata();

        $this->assertNotNull(
            $this->feedItem('type=listings&subtype=request&per_page=50', (int) $listing->id),
            'Requests should include a request listing',
        );
        $this->assertNull(
            $this->feedItem('type=listings&subtype=offer&per_page=50', (int) $listing->id),
            'Offers should leave a request listing out',
        );
    }
}
