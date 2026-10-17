<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Marketplace;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Marketplace & Freecycle — "Borrow & lend" listings (price_type = lend).
 *
 * A lend listing is an offer to lend something and have it returned. It is
 * never for sale: it cannot carry a price, cannot be posted, cannot be bought
 * with buy-now and cannot receive a price offer. Borrowers ask by message.
 */
class MarketplaceLendListingTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        Mail::fake();

        DB::table('tenants')
            ->where('id', $this->testTenantId)
            ->update(['features' => json_encode(['marketplace' => true])]);
        TenantContext::setById($this->testTenantId);
    }

    private function member(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    private function lendListingRow(User $owner, array $overrides = []): int
    {
        return DB::table('marketplace_listings')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'title' => 'Pressure washer',
            'description' => 'Karcher pressure washer, happy to lend for a weekend.',
            'price' => null,
            'price_currency' => 'EUR',
            'price_type' => 'lend',
            'loan_terms' => 'Up to one week. Collect from Rathmines. Please return clean.',
            'quantity' => 1,
            'local_pickup' => true,
            'shipping_available' => false,
            'delivery_method' => 'pickup',
            'seller_type' => 'private',
            'status' => 'active',
            'moderation_status' => 'approved',
            'expires_at' => '2030-07-10 00:00:00',
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }

    public function test_member_can_list_something_to_lend_with_loan_terms(): void
    {
        $this->member();

        $response = $this->apiPost('/v2/marketplace/listings', [
            'title' => 'Extension ladder',
            'description' => 'Three-section aluminium ladder, reaches a two-storey gutter.',
            'price_type' => 'lend',
            'loan_terms' => 'Up to two weeks. Collect from Ranelagh.',
            'condition' => 'good',
            'delivery_method' => 'pickup',
        ]);

        $response->assertStatus(201);
        $this->assertSame('lend', $response->json('data.price_type'));
        $this->assertNull($response->json('data.price'));
        $this->assertSame('Up to two weeks. Collect from Ranelagh.', $response->json('data.loan_terms'));
    }

    public function test_a_lend_listing_cannot_carry_a_price(): void
    {
        $this->member();

        $this->apiPost('/v2/marketplace/listings', [
            'title' => 'Sewing machine',
            'description' => 'Lending, not selling.',
            'price_type' => 'lend',
            'price' => 25,
        ])->assertStatus(422);

        $this->apiPost('/v2/marketplace/listings', [
            'title' => 'Sewing machine',
            'description' => 'Lending, not selling.',
            'price_type' => 'lend',
            'time_credit_price' => 2,
        ])->assertStatus(422);
    }

    public function test_a_lend_listing_cannot_be_posted(): void
    {
        $this->member();

        $this->apiPost('/v2/marketplace/listings', [
            'title' => 'Tile cutter',
            'description' => 'Lending, collect only.',
            'price_type' => 'lend',
            'delivery_method' => 'shipping',
        ])->assertStatus(422);
    }

    public function test_loan_terms_are_only_returned_for_lend_listings(): void
    {
        $owner = $this->member();
        $id = $this->lendListingRow($owner, [
            'price_type' => 'fixed',
            'price' => 40,
            'loan_terms' => 'stale text from before the type changed',
        ]);

        $response = $this->apiGet("/v2/marketplace/listings/{$id}");
        $response->assertStatus(200);
        $this->assertNull($response->json('data.loan_terms'));
    }

    public function test_browse_filters_to_lend_listings(): void
    {
        $owner = $this->member();
        $lend = $this->lendListingRow($owner);
        $sale = $this->lendListingRow($owner, ['title' => 'For sale', 'price_type' => 'fixed', 'price' => 12, 'loan_terms' => null]);

        $response = $this->apiGet('/v2/marketplace/listings?price_type=lend&limit=50');
        $response->assertStatus(200);

        $ids = array_map('intval', array_column($response->json('data'), 'id'));
        $this->assertContains($lend, $ids);
        $this->assertNotContains($sale, $ids);
    }

    public function test_a_lend_listing_cannot_be_bought(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $id = $this->lendListingRow($owner);
        $this->member();

        $response = $this->apiPost('/v2/marketplace/orders', [
            'listing_id' => $id,
            'quantity' => 1,
        ]);

        $this->assertContains($response->getStatusCode(), [400, 422]);
        $this->assertSame(0, DB::table('marketplace_orders')->where('marketplace_listing_id', $id)->count());
    }

    public function test_a_lend_listing_cannot_receive_a_price_offer(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $id = $this->lendListingRow($owner);
        $this->member();

        $response = $this->apiPost("/v2/marketplace/listings/{$id}/offers", [
            'amount' => 5,
        ]);

        $this->assertContains($response->getStatusCode(), [400, 422]);
        $this->assertSame(0, DB::table('marketplace_offers')->where('marketplace_listing_id', $id)->count());
    }
}
