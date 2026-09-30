<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E065;

use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\Models\User;
use App\Services\BlockUserService;
use App\Services\TenantFeatureConfig;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-368 (E-065) — marketplace offers are another member-to-member write that
 * applied the safeguarding contact policy and no block check.
 *
 * A blocked member could make an offer on the blocker's listing; the offer's
 * free-text `message` was stored and an email went to the seller naming the
 * buyer. E-065 rated this `suspected` (read and classified, not driven); this
 * test drives it over the HTTP route.
 */
class F368MarketplaceOfferBlockCheckTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        $this->app['auth']->forgetGuards();
        Cache::flush();
        TenantContext::setById($this->testTenantId);
        $this->enableMarketplaceFeature();
    }

    private function enableMarketplaceFeature(): void
    {
        $features = TenantFeatureConfig::FEATURE_DEFAULTS;
        $features['marketplace'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode($features),
        ]);
        TenantContext::setById($this->testTenantId);
    }

    /** @param array<string,mixed> $overrides */
    private function member(array $overrides = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'onboarding_completed' => true,
            'role' => 'member',
        ], $overrides));
    }

    private function listing(int $sellerId, string $title): int
    {
        return (int) DB::table('marketplace_listings')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $sellerId,
            'title' => $title,
            'description' => 'F368 offerable listing.',
            'price' => 12.00,
            'price_currency' => 'EUR',
            'price_type' => 'fixed',
            'quantity' => 1,
            'contacts_count' => 0,
            'shipping_available' => 0,
            'local_pickup' => 1,
            'delivery_method' => 'pickup',
            'seller_type' => 'private',
            'status' => 'active',
            'moderation_status' => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_a_blocked_member_cannot_offer_on_the_blockers_listing(): void
    {
        $seller = $this->member();
        $attacker = $this->member();
        $listingId = $this->listing((int) $seller->id, 'F368 seller listing');

        BlockUserService::block((int) $seller->id, (int) $attacker->id, 'F368 harassment');
        $this->assertTrue(
            BlockUserService::isBlockedEither((int) $attacker->id, (int) $seller->id),
            'precondition: the block is live'
        );

        Sanctum::actingAs($attacker, ['*']);
        $response = $this->apiPost("/v2/marketplace/listings/{$listingId}/offers", [
            'amount' => 12.00,
            'message' => 'F368 unwanted offer message reaching the member who blocked me',
        ]);

        $this->assertSame(403, $response->status(), 'the offer must be refused: ' . $response->getContent());
        $this->assertSame('BLOCKED', $response->json('errors.0.code'), $response->getContent());

        $this->assertFalse(
            DB::table('marketplace_offers')
                ->where('tenant_id', $this->testTenantId)
                ->where('marketplace_listing_id', $listingId)
                ->where('buyer_id', $attacker->id)
                ->exists(),
            'no offer row carrying the blocked member\'s text may be written'
        );

        $this->assertSame(
            0,
            DB::table('notifications')
                ->where('tenant_id', $this->testTenantId)
                ->where('user_id', $seller->id)
                ->count(),
            'the blocker must not be bell-notified about the offer'
        );
    }

    public function test_the_block_is_real_and_an_unblocked_offer_still_works(): void
    {
        // Control 1 — the same fixture block DOES stop the canonical check.
        $seller = $this->member();
        $attacker = $this->member();
        BlockUserService::block((int) $seller->id, (int) $attacker->id, 'F368 harassment');

        $refused = false;
        try {
            BlockUserService::assertNoBlockBetween((int) $attacker->id, (int) $seller->id);
        } catch (SafeguardingPolicyException $e) {
            $refused = true;
            $this->assertSame('BLOCKED', $e->reasonCode);
        }
        $this->assertTrue($refused, 'CONTROL: the canonical block check refuses this pair');

        // Control 2 — no block, same route, same body shape.
        $otherSeller = $this->member();
        $buyer = $this->member();
        $listingId = $this->listing((int) $otherSeller->id, 'F368 control listing');

        Sanctum::actingAs($buyer, ['*']);
        $ok = $this->apiPost("/v2/marketplace/listings/{$listingId}/offers", [
            'amount' => 12.00,
            'message' => 'F368 ordinary offer',
        ]);

        $this->assertSame(201, $ok->status(), 'CONTROL: an ordinary offer still works: ' . $ok->getContent());
        $this->assertTrue(
            DB::table('marketplace_offers')
                ->where('tenant_id', $this->testTenantId)
                ->where('marketplace_listing_id', $listingId)
                ->where('buyer_id', $buyer->id)
                ->exists(),
            'CONTROL: the rightful offer row is written'
        );
    }
}
