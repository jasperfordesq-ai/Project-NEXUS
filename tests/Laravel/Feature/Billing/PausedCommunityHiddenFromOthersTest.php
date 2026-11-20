<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\BillingStandingService;
use App\Services\FederationFeatureService;
use App\Support\Billing\BillingLock;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\Concerns\FederationIntegrationHarness;
use Tests\Laravel\TestCase;

/**
 * A community paused for non-payment disappears from the other communities on
 * this installation: their cross-community (internal federation) views stop
 * showing its listings, members, events and groups, and its public podcast
 * feed is refused whichever community's address asks for it.
 *
 * Community A is the test community (the viewer's); B is paused; C is a second
 * partner that stays open, to prove the filter removes B and only B.
 */
final class PausedCommunityHiddenFromOthersTest extends TestCase
{
    use DatabaseTransactions;
    use FederationIntegrationHarness;

    private int $a;
    private int $b;
    private int $c;

    protected function setUp(): void
    {
        parent::setUp();

        BillingLock::flush();

        $this->a = $this->testTenantId;
        $this->b = $this->makeCommunity('Paused partner B');
        $this->c = $this->makeCommunity('Open partner C');

        foreach ([$this->a, $this->b, $this->c] as $tenantId) {
            $this->enableFederationForTenant($tenantId);
        }
        app(FederationFeatureService::class)->clearCache();

        $this->seedPartnership($this->b);
        $this->seedPartnership($this->c);

        TenantContext::setById($this->a);
    }

    protected function tearDown(): void
    {
        // parent::tearDown() rolls the transaction back; it must always run.
        try {
            BillingLock::flush();
            app(FederationFeatureService::class)->clearCache();
        } finally {
            parent::tearDown();
        }
    }

    // ------------------------------------------------------------ federation

    public function test_listings_of_a_paused_community_are_hidden_and_come_back(): void
    {
        $inB = $this->seedListing($this->seedFederatedUser($this->b));
        $inC = $this->seedListing($this->seedFederatedUser($this->c));
        $this->viewFromA();

        $this->assertVisible('/v2/federation/listings', [$inB, $inC]);

        $this->pauseB();
        $this->assertVisible('/v2/federation/listings', [$inC], [$inB]);

        $this->restoreB();
        $this->assertVisible('/v2/federation/listings', [$inB, $inC]);
    }

    public function test_members_of_a_paused_community_are_hidden_and_come_back(): void
    {
        $inB = (int) $this->seedFederatedUser($this->b)->id;
        $inC = (int) $this->seedFederatedUser($this->c)->id;
        $this->viewFromA();

        $this->assertVisible('/v2/federation/members', [$inB, $inC]);
        $this->apiGet("/v2/federation/members/{$inB}?tenant_id={$this->b}")->assertOk();

        $this->pauseB();
        $this->assertVisible('/v2/federation/members', [$inC], [$inB]);
        $this->apiGet("/v2/federation/members/{$inB}?tenant_id={$this->b}")->assertStatus(404);
        $this->apiGet("/v2/federation/members/{$inC}?tenant_id={$this->c}")->assertOk();

        $this->restoreB();
        $this->assertVisible('/v2/federation/members', [$inB, $inC]);
        $this->apiGet("/v2/federation/members/{$inB}?tenant_id={$this->b}")->assertOk();
    }

    public function test_reviews_of_a_paused_community_member_are_not_returned(): void
    {
        $owner = $this->seedFederatedUser($this->b);
        $reviewer = $this->seedFederatedUser($this->b);
        DB::table('reviews')->insert([
            'tenant_id' => $this->b,
            'reviewer_id' => $reviewer->id,
            'receiver_id' => $owner->id,
            'rating' => 5,
            'comment' => 'Helpful and kind.',
            'status' => 'approved',
            'review_type' => 'local',
            'show_cross_tenant' => 1,
            'created_at' => now(),
        ]);
        $this->viewFromA();

        $before = $this->apiGet("/v2/federation/members/{$owner->id}/reviews?tenant_id={$this->b}");
        $before->assertOk();
        $this->assertNotEmpty($before->json('data'), 'the review should be visible while B is open');

        $this->pauseB();
        $after = $this->apiGet("/v2/federation/members/{$owner->id}/reviews?tenant_id={$this->b}");
        $after->assertOk();
        $this->assertSame([], $after->json('data'));
    }

    public function test_events_of_a_paused_community_are_hidden_and_come_back(): void
    {
        $inB = $this->seedEvent($this->seedFederatedUser($this->b));
        $inC = $this->seedEvent($this->seedFederatedUser($this->c));
        $this->viewFromA();

        $this->assertVisible('/v2/federation/events', [$inB, $inC]);

        $this->pauseB();
        $this->assertVisible('/v2/federation/events', [$inC], [$inB]);

        $this->restoreB();
        $this->assertVisible('/v2/federation/events', [$inB, $inC]);
    }

    public function test_groups_of_a_paused_community_are_hidden_and_come_back(): void
    {
        $inB = $this->seedGroup($this->seedFederatedUser($this->b));
        $inC = $this->seedGroup($this->seedFederatedUser($this->c));
        $this->viewFromA();

        $this->assertVisible('/v2/federation/groups', [$inB, $inC]);

        $this->pauseB();
        $this->assertVisible('/v2/federation/groups', [$inC], [$inB]);

        $this->restoreB();
        $this->assertVisible('/v2/federation/groups', [$inB, $inC]);
    }

    public function test_a_child_of_a_paused_community_is_hidden_too(): void
    {
        $child = $this->makeCommunity('Child of B', $this->b);
        $this->enableFederationForTenant($child);
        app(FederationFeatureService::class)->clearCache();
        $this->seedPartnership($child);
        $inChild = $this->seedListing($this->seedFederatedUser($child));
        $this->viewFromA();

        $this->assertVisible('/v2/federation/listings', [$inChild]);

        $this->pauseB();
        $this->assertVisible('/v2/federation/listings', [], [$inChild]);
    }

    public function test_a_message_to_a_paused_community_member_is_refused(): void
    {
        $receiver = $this->seedFederatedUser($this->b);
        $this->viewFromA();
        $this->pauseB();

        $response = $this->apiPost('/v2/federation/messages', [
            'receiver_id' => $receiver->id,
            'receiver_tenant_id' => $this->b,
            'subject' => 'Hi',
            'body' => 'Hello there',
        ]);

        $response->assertStatus(403);
        $this->assertSame('MESSAGING_NOT_ALLOWED', $response->json('errors.0.code'));
    }

    // --------------------------------------------------------------- podcast

    public function test_podcast_feed_of_a_paused_community_is_refused_from_any_address(): void
    {
        [$slug, $episodeId] = $this->publishPodcastIn($this->b);

        $this->feedFrom($this->b, $slug, $this->a)->assertStatus(200);

        $this->pauseB();

        foreach ([$this->a, $this->c] as $address) {
            $refused = $this->feedFrom($this->b, $slug, $address);
            $refused->assertStatus(503);
            $this->assertSame('86400', $refused->headers->get('Retry-After'));
            $this->assertStringNotContainsString('Paused show', (string) $refused->getContent());

            // The feed's own audio, transcript and chapters switch community
            // from the URL the same way, so they are refused the same way.
            foreach ([
                "/api/v2/podcasts/media/{$this->b}/{$episodeId}/audio",
                "/api/v2/podcasts/transcripts/{$this->b}/{$episodeId}.txt",
                "/api/v2/podcasts/chapters/{$this->b}/{$episodeId}.json",
            ] as $uri) {
                TenantContext::reset();
                $media = $this->get($uri, ['X-Tenant-ID' => (string) $address]);
                $media->assertStatus(503);
                $this->assertSame('86400', $media->headers->get('Retry-After'), $uri);
            }
        }

        $this->restoreB();
        $this->feedFrom($this->b, $slug, $this->a)->assertStatus(200);
    }

    public function test_podcast_feed_of_an_open_community_is_unaffected_by_another_being_paused(): void
    {
        [$slug] = $this->publishPodcastIn($this->c);
        $this->pauseB();

        $this->feedFrom($this->c, $slug, $this->a)->assertStatus(200);
    }

    // --------------------------------------------------------------- helpers

    private function makeCommunity(string $name, int $parentId = 1): int
    {
        $parentPath = $parentId === 1
            ? '/1/'
            : (string) DB::table('tenants')->where('id', $parentId)->value('path');

        $id = (int) DB::table('tenants')->insertGetId([
            'name' => $name,
            'slug' => 'hidden-' . bin2hex(random_bytes(5)),
            'is_active' => 1,
            'parent_id' => $parentId,
            'features' => json_encode(['podcasts' => true]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $id)->update(['path' => "{$parentPath}{$id}/"]);

        return $id;
    }

    private function pauseB(): void
    {
        BillingStandingService::suspend($this->b, null, 'manual');
        BillingLock::flush();
    }

    private function restoreB(): void
    {
        BillingStandingService::restore($this->b, null);
        BillingLock::flush();
    }

    private function seedPartnership(int $partnerTenantId): void
    {
        $data = [
            'tenant_id' => $this->a,
            'partner_tenant_id' => $partnerTenantId,
            'status' => 'active',
            'federation_level' => 4,
            'profiles_enabled' => 1,
            'messaging_enabled' => 1,
            'transactions_enabled' => 1,
            'listings_enabled' => 1,
            'events_enabled' => 1,
            'groups_enabled' => 1,
            'requested_at' => now(),
            'approved_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ];
        if (Schema::hasColumn('federation_partnerships', 'canonical_pair')) {
            $data['canonical_pair'] = min($this->a, $partnerTenantId) . '-' . max($this->a, $partnerTenantId);
        }

        DB::table('federation_partnerships')->insert($data);
    }

    private function seedFederatedUser(int $tenantId): User
    {
        $user = User::factory()->forTenant($tenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'onboarding_completed' => 1,
        ]);

        DB::table('federation_user_settings')->updateOrInsert(
            ['user_id' => $user->id],
            [
                'federation_optin' => 1,
                'profile_visible_federated' => 1,
                'messaging_enabled_federated' => 1,
                'transactions_enabled_federated' => 1,
                'appear_in_federated_search' => 1,
                'show_skills_federated' => 1,
                'show_location_federated' => 1,
                'show_reviews_federated' => 1,
                'service_reach' => 'remote_ok',
                'updated_at' => now(),
            ]
        );

        return $user;
    }

    private function viewFromA(): void
    {
        $this->testTenantId = $this->a;
        TenantContext::setById($this->a);
        Sanctum::actingAs($this->seedFederatedUser($this->a), ['*']);
    }

    private function seedListing(User $owner): int
    {
        return (int) DB::table('listings')->insertGetId([
            'tenant_id' => $owner->tenant_id,
            'user_id' => $owner->id,
            'title' => 'Federated listing',
            'description' => 'Shown to partner communities.',
            'type' => 'offer',
            'status' => 'active',
            'federated_visibility' => 'listed',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function seedEvent(User $owner): int
    {
        return (int) DB::table('events')->insertGetId([
            'tenant_id' => $owner->tenant_id,
            'user_id' => $owner->id,
            'title' => 'Federated event',
            'description' => 'Shown to partner communities.',
            'start_time' => now()->addDays(3),
            'status' => 'active',
            'federated_visibility' => 'listed',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function seedGroup(User $owner): int
    {
        return (int) DB::table('groups')->insertGetId([
            'tenant_id' => $owner->tenant_id,
            'owner_id' => $owner->id,
            'name' => 'Federated group ' . bin2hex(random_bytes(3)),
            'description' => 'Shown to partner communities.',
            'visibility' => 'public',
            'status' => 'active',
            'federated_visibility' => 'listed',
            'allow_federated_members' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /**
     * @param list<int> $expected
     * @param list<int> $absent
     */
    private function assertVisible(string $uri, array $expected, array $absent = []): void
    {
        $response = $this->apiGet($uri . '?per_page=100');
        $response->assertOk();
        $ids = $this->ids($response);

        foreach ($expected as $id) {
            $this->assertContains($id, $ids, "{$uri} should include {$id}");
        }
        foreach ($absent as $id) {
            $this->assertNotContains($id, $ids, "{$uri} must not include {$id} while its community is paused");
        }
    }

    /** @return list<int> */
    private function ids(TestResponse $response): array
    {
        return array_map(static fn ($row): int => (int) ($row['id'] ?? 0), $response->json('data') ?? []);
    }

    /**
     * Publish a public show with one public episode in $tenantId, through the API.
     *
     * @return array{0:string, 1:int} the show's slug and the episode's id
     */
    private function publishPodcastIn(int $tenantId): array
    {
        $this->testTenantId = $tenantId;
        TenantContext::setById($tenantId);
        Sanctum::actingAs(User::factory()->forTenant($tenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]), ['*']);

        $show = $this->apiPost('/v2/podcasts', ['title' => 'Paused show', 'visibility' => 'public']);
        $show->assertStatus(201);
        $showId = $show->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/publish")->assertStatus(200);

        $episode = $this->apiPost("/v2/podcasts/{$showId}/episodes", [
            'title' => 'Paused show episode',
            'audio_url' => 'https://cdn.example.test/paused.mp3',
            'audio_bytes' => 1234,
            'visibility' => 'public',
        ]);
        $episode->assertStatus(201);
        $this->apiPost("/v2/podcasts/{$showId}/episodes/{$episode->json('data.id')}/publish")->assertStatus(200);

        $this->app['auth']->forgetGuards();
        TenantContext::reset();

        return [(string) $show->json('data.slug'), (int) $episode->json('data.id')];
    }

    /** Fetch $owner's feed with the request addressed to community $address. */
    private function feedFrom(int $owner, string $slug, int $address): TestResponse
    {
        TenantContext::reset();

        return $this->get("/api/v2/podcasts/feed/{$owner}/{$slug}.xml", [
            'X-Tenant-ID' => (string) $address,
        ]);
    }
}
