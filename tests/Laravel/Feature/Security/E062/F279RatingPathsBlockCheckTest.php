<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E062;

use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\Models\User;
use App\Services\BlockUserService;
use App\Services\EmailDispatchService;
use App\Services\IdeationChallengeService;
use App\Services\MarketplaceRatingService;
use App\Services\VolunteerService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Laravel\TestCase;

/**
 * F-279 (E-062) — five member-to-member write paths applied the safeguarding
 * contact policy but not the F-070 block check that ReviewService::create
 * applies before it:
 *
 *   ExchangeRatingService::submitRating      (and it emailed the blocker)
 *   MarketplaceRatingService::rateOrder      (and it emailed the blocker)
 *   VolunteerService::createReview, target 'user'
 *   IdeationChallengeService::addComment     (a comment on the blocker's idea)
 *   PodcastService::toggleReaction           (a reaction on the blocker's episode)
 *
 * Each must now refuse the pair with the direction-neutral BLOCKED error and
 * write nothing. Each has an unblocked control that still succeeds.
 */
class F279RatingPathsBlockCheckTest extends TestCase
{
    use DatabaseTransactions;

    /** @var object{calls: list<string>} */
    private object $mail;

    protected function setUp(): void
    {
        parent::setUp();
        $this->app['auth']->forgetGuards();
        Cache::flush();
        TenantContext::setById($this->testTenantId);

        $mail = new class () extends EmailDispatchService {
            /** @var list<string> */
            public array $calls = [];

            public function __construct()
            {
            }

            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                $this->calls[] = $to;

                return true;
            }
        };
        $this->app->instance(EmailDispatchService::class, $mail);
        $this->mail = $mail;
    }

    /** @return array<string, array{string}> */
    public static function blockDirections(): array
    {
        return [
            'the other member blocked the actor' => ['other_blocked_actor'],
            'the actor blocked the other member' => ['actor_blocked_other'],
        ];
    }

    // ------------------------------------------------------------------
    // Exchange rating (the reproduced case)
    // ------------------------------------------------------------------

    #[DataProvider('blockDirections')]
    public function test_a_blocked_pair_cannot_rate_an_exchange_and_nobody_is_emailed(string $direction): void
    {
        [$actor, $other] = [$this->member(), $this->member()];
        $exchangeId = $this->completedExchange((int) $actor->id, (int) $other->id);
        $this->applyBlock($direction, $actor, $other);
        $this->mail->calls = [];

        $this->actAs($actor);
        $response = $this->apiPost("/v2/exchanges/{$exchangeId}/rate", ['rating' => 1, 'comment' => 'F279-EXCHANGE']);

        $this->assertBlockedResponse($response);
        $this->assertSame(0, (int) DB::table('exchange_ratings')->where('exchange_id', $exchangeId)->count());
        $this->assertNotContains((string) $other->email, $this->mail->calls, 'the other member was not emailed');
    }

    public function test_control_an_unblocked_party_may_rate_an_exchange(): void
    {
        [$actor, $other] = [$this->member(), $this->member()];
        $exchangeId = $this->completedExchange((int) $actor->id, (int) $other->id);

        $this->actAs($actor);
        $this->apiPost("/v2/exchanges/{$exchangeId}/rate", ['rating' => 5, 'comment' => 'F279-OK'])->assertStatus(201);

        $this->assertSame(1, (int) DB::table('exchange_ratings')->where('exchange_id', $exchangeId)->count());
    }

    // ------------------------------------------------------------------
    // Marketplace order rating
    // ------------------------------------------------------------------

    #[DataProvider('blockDirections')]
    public function test_a_blocked_pair_cannot_rate_a_marketplace_order(string $direction): void
    {
        [$buyer, $seller] = [$this->member(), $this->member()];
        $orderId = $this->completedOrder((int) $buyer->id, (int) $seller->id);
        $this->applyBlock($direction, $buyer, $seller);
        $this->mail->calls = [];

        $code = $this->reasonCodeOf(static fn () => MarketplaceRatingService::rateOrder(
            $orderId,
            (int) $buyer->id,
            'buyer',
            ['rating' => 1, 'comment' => 'F279-MARKET'],
            TenantContext::getId(),
        ));

        $this->assertSame('BLOCKED', $code);
        $this->assertSame(0, (int) DB::table('marketplace_seller_ratings')->where('order_id', $orderId)->count());
        $this->assertNotContains((string) $seller->email, $this->mail->calls);
    }

    public function test_control_an_unblocked_buyer_may_rate_a_marketplace_order(): void
    {
        [$buyer, $seller] = [$this->member(), $this->member()];
        $orderId = $this->completedOrder((int) $buyer->id, (int) $seller->id);

        MarketplaceRatingService::rateOrder($orderId, (int) $buyer->id, 'buyer', ['rating' => 5], TenantContext::getId());

        $this->assertSame(1, (int) DB::table('marketplace_seller_ratings')->where('order_id', $orderId)->count());
    }

    // ------------------------------------------------------------------
    // Volunteer member review
    // ------------------------------------------------------------------

    #[DataProvider('blockDirections')]
    public function test_a_blocked_pair_cannot_leave_a_volunteer_member_review(string $direction): void
    {
        [$reviewer, $target] = [$this->member(), $this->member()];
        $this->sharedVolunteerPlacement($reviewer, $target);
        $this->applyBlock($direction, $reviewer, $target);

        $code = $this->reasonCodeOf(static fn () => VolunteerService::createReview(
            (int) $reviewer->id,
            'user',
            (int) $target->id,
            1,
            'F279-VOLUNTEER',
        ));

        $this->assertSame('BLOCKED', $code);
        $this->assertSame(0, $this->volunteerReviewCount($reviewer, $target));
    }

    public function test_control_an_unblocked_co_volunteer_may_leave_a_member_review(): void
    {
        [$reviewer, $target] = [$this->member(), $this->member()];
        $this->sharedVolunteerPlacement($reviewer, $target);

        $id = VolunteerService::createReview((int) $reviewer->id, 'user', (int) $target->id, 5, 'F279-VOL-OK');

        $this->assertNotNull($id);
        $this->assertSame(1, $this->volunteerReviewCount($reviewer, $target));
    }

    // ------------------------------------------------------------------
    // Idea comment
    // ------------------------------------------------------------------

    #[DataProvider('blockDirections')]
    public function test_a_blocked_pair_cannot_comment_on_the_other_members_idea(string $direction): void
    {
        [$commenter, $author] = [$this->member(), $this->member()];
        $ideaId = $this->idea($author);
        $this->applyBlock($direction, $commenter, $author);

        $code = $this->reasonCodeOf(fn () => app(IdeationChallengeService::class)
            ->addComment($ideaId, (int) $commenter->id, 'F279-IDEA'));

        $this->assertSame('BLOCKED', $code);
        $this->assertSame(0, (int) DB::table('challenge_idea_comments')->where('idea_id', $ideaId)->count());
    }

    public function test_control_an_unblocked_member_may_comment_on_an_idea(): void
    {
        [$commenter, $author] = [$this->member(), $this->member()];
        $ideaId = $this->idea($author);

        $id = app(IdeationChallengeService::class)->addComment($ideaId, (int) $commenter->id, 'F279-IDEA-OK');

        $this->assertNotNull($id);
        $this->assertSame(1, (int) DB::table('challenge_idea_comments')->where('idea_id', $ideaId)->count());
    }

    // ------------------------------------------------------------------
    // Podcast episode reaction
    // ------------------------------------------------------------------

    #[DataProvider('blockDirections')]
    public function test_a_blocked_pair_cannot_react_to_the_other_members_episode(string $direction): void
    {
        $author = $this->member();
        $episodeId = $this->publishedEpisode($author);
        $reactor = $this->member();
        $this->applyBlock($direction, $reactor, $author);

        $this->actAs($reactor);
        $response = $this->apiPost("/v2/podcasts/episodes/{$episodeId}/reaction", ['reaction' => 'like']);

        $this->assertBlockedResponse($response);
        $this->assertSame(0, (int) DB::table('podcast_episode_reactions')->where('episode_id', $episodeId)->count());
    }

    public function test_control_an_unblocked_member_may_react_to_an_episode(): void
    {
        $author = $this->member();
        $episodeId = $this->publishedEpisode($author);
        $reactor = $this->member();

        $this->actAs($reactor);
        $this->apiPost("/v2/podcasts/episodes/{$episodeId}/reaction", ['reaction' => 'like'])
            ->assertOk()
            ->assertJsonPath('data.active', true);

        $this->assertSame(1, (int) DB::table('podcast_episode_reactions')->where('episode_id', $episodeId)->count());
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private function reasonCodeOf(callable $call): ?string
    {
        try {
            $call();
        } catch (SafeguardingPolicyException $e) {
            $this->assertSame(__('safeguarding.errors.blocked_interaction'), $e->getMessage());

            return $e->reasonCode;
        }

        return null;
    }

    private function assertBlockedResponse(\Illuminate\Testing\TestResponse $response): void
    {
        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', 'BLOCKED');
        $response->assertJsonPath('errors.0.message', __('safeguarding.errors.blocked_interaction'));
    }

    private function applyBlock(string $direction, User $actor, User $other): void
    {
        TenantContext::setById($this->testTenantId);
        if ($direction === 'other_blocked_actor') {
            BlockUserService::block((int) $other->id, (int) $actor->id);
        } else {
            BlockUserService::block((int) $actor->id, (int) $other->id);
        }
    }

    private function completedExchange(int $requesterId, int $providerId): int
    {
        $listingId = (int) DB::table('listings')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $providerId,
            'title' => 'F279 listing',
            'type' => 'offer',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return (int) DB::table('exchange_requests')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'listing_id' => $listingId,
            'requester_id' => $requesterId,
            'provider_id' => $providerId,
            'proposed_hours' => 1.00,
            'status' => 'completed',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function completedOrder(int $buyerId, int $sellerId): int
    {
        return (int) DB::table('marketplace_orders')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'order_number' => 'F279-' . uniqid(),
            'buyer_id' => $buyerId,
            'seller_id' => $sellerId,
            'marketplace_listing_id' => null,
            'quantity' => 1,
            'unit_price' => 10.00,
            'total_price' => 10.00,
            'currency' => 'EUR',
            'status' => 'completed',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function sharedVolunteerPlacement(User $a, User $b): void
    {
        $owner = $this->member();
        $orgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => (int) $owner->id,
            'name' => 'F279 Org ' . uniqid(),
            'slug' => 'f279-org-' . uniqid(),
            'description' => 'Organisation used for F-279 coverage.',
            'contact_email' => 'f279@example.test',
            'status' => 'active',
            'created_at' => now(),
        ]);
        $opportunityId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $orgId,
            'title' => 'F279 shift',
            'description' => 'Shared placement history.',
            'is_active' => 1,
            'status' => 'open',
            'created_by' => (int) $owner->id,
            'created_at' => now(),
        ]);
        foreach ([$a, $b] as $user) {
            DB::table('vol_applications')->insert([
                'tenant_id' => $this->testTenantId,
                'opportunity_id' => $opportunityId,
                'user_id' => (int) $user->id,
                'status' => 'approved',
                'created_at' => now(),
            ]);
        }
        TenantContext::setById($this->testTenantId);
    }

    private function volunteerReviewCount(User $reviewer, User $target): int
    {
        return (int) DB::table('vol_reviews')
            ->where('tenant_id', $this->testTenantId)
            ->where('reviewer_id', (int) $reviewer->id)
            ->where('target_type', 'user')
            ->where('target_id', (int) $target->id)
            ->count();
    }

    private function idea(User $author): int
    {
        $owner = $this->member();
        $challengeId = (int) DB::table('ideation_challenges')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => (int) $owner->id,
            'title' => 'F279 challenge',
            'description' => 'F279 challenge description',
            'status' => 'open',
            'created_at' => now(),
        ]);

        $ideaId = (int) DB::table('challenge_ideas')->insertGetId([
            'challenge_id' => $challengeId,
            'user_id' => (int) $author->id,
            'title' => 'F279 idea',
            'description' => 'F279 idea description',
            'status' => 'submitted',
            'created_at' => now(),
        ]);
        TenantContext::setById($this->testTenantId);

        return $ideaId;
    }

    private function publishedEpisode(User $author): int
    {
        $this->enableFeatures(['podcasts']);
        $this->actAs($author);

        $showId = (int) $this->apiPost('/v2/podcasts', [
            'title' => 'F279 Show ' . uniqid(),
            'visibility' => 'public',
        ])->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/publish")->assertOk();

        $episodeId = (int) $this->apiPost("/v2/podcasts/{$showId}/episodes", [
            'title' => 'F279 Episode',
            'audio_url' => 'https://cdn.example.test/f279.mp3',
            'visibility' => 'public',
        ])->json('data.id');
        $this->apiPost("/v2/podcasts/{$showId}/episodes/{$episodeId}/publish")->assertOk();
        TenantContext::setById($this->testTenantId);

        return $episodeId;
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
}
