<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Feed;

use App\Models\User;
use App\Services\FeedActivityService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * A podcast episode in the feed carries its show's numeric id.
 *
 * The accessible frontend (web-uk) routes podcasts by numeric id
 * (`/podcasts/{showId}/episodes/{id}`), unlike React and the app, which use
 * slugs. `PodcastService` already records `show_id` in the activity metadata,
 * but `FeedService` did not pass it on, so the accessible feed could not link an
 * episode card to its page (owner report, 2026-10-24).
 */
class PodcastFeedItemCarriesShowIdTest extends TestCase
{
    use DatabaseTransactions;

    public function test_a_podcast_episode_feed_item_includes_its_show_id(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($user, ['*']);

        app(FeedActivityService::class)->recordActivity($this->testTenantId, (int) $user->id, 'podcast_episode', 987654, [
            'title' => 'Episode one',
            'content' => 'An episode summary',
            'metadata' => [
                'show_id' => 4321,
                'show_slug' => 'community-voices',
                'slug' => 'episode-one',
                'detail_path' => '/podcasts/community-voices/episode-one',
            ],
        ]);

        $response = $this->apiGet('/v2/feed?page=1&per_page=20');
        $response->assertStatus(200);

        $episode = collect($response->json('data'))
            ->first(fn ($item) => ($item['type'] ?? null) === 'podcast_episode' && (int) ($item['id'] ?? 0) === 987654);

        $this->assertNotNull($episode, 'the seeded podcast episode should appear in the feed');
        $this->assertSame(4321, $episode['show_id']);
        $this->assertSame('community-voices', $episode['show_slug']);
    }
}
