<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\ExchangeRequest;
use App\Models\Listing;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * A thank-you when an exchange completes (AWID feedback, Nov 2026: "energy,
 * warmth, and community"). When the confirming member's confirmation completes
 * the exchange, POST /v2/exchanges/{id}/confirm also returns `thanks`: how many
 * different people that member has exchanged time with this year, and how many
 * hours. Counted from the member's own completed exchange transactions in this
 * community only.
 */
class ExchangeCompletedThanksTest extends TestCase
{
    use DatabaseTransactions;

    private function member(array $overrides = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'balance' => 20,
        ], $overrides));
    }

    private function exchangeWaitingFor(User $requester, User $provider, float $hours): ExchangeRequest
    {
        $listing = Listing::factory()->create(['tenant_id' => $this->testTenantId, 'user_id' => $provider->id]);

        return ExchangeRequest::factory()->forTenant($this->testTenantId)->create([
            'listing_id' => $listing->id,
            'requester_id' => $requester->id,
            'provider_id' => $provider->id,
            'status' => 'pending_confirmation',
            'proposed_hours' => $hours,
            'provider_confirmed_at' => now(),
            'provider_confirmed_hours' => $hours,
        ]);
    }

    private function pastExchange(User $a, User $b, float $hours, string $when, ?int $tenantId = null): void
    {
        DB::table('transactions')->insert([
            'tenant_id' => $tenantId ?? $this->testTenantId,
            'sender_id' => $a->id,
            'receiver_id' => $b->id,
            'amount' => $hours,
            'description' => 'Exchange for test',
            'transaction_type' => 'exchange',
            'status' => 'completed',
            'created_at' => $when,
            'updated_at' => $when,
        ]);
    }

    public function test_completing_an_exchange_says_thank_you_with_this_years_neighbours_and_hours(): void
    {
        $me = $this->member();
        $provider = $this->member();
        $earlier = $this->member();
        // Earlier this year: once with a different neighbour, once with the same
        // provider again — two people, not three.
        $this->pastExchange($earlier, $me, 1.5, now()->startOfYear()->addDay()->toDateTimeString());
        $this->pastExchange($me, $provider, 1, now()->startOfYear()->addDays(2)->toDateTimeString());
        // Last year does not count.
        $this->pastExchange($me, $this->member(), 4, now()->subYear()->toDateTimeString());
        // A direct transfer is not an exchange.
        DB::table('transactions')->insert([
            'tenant_id' => $this->testTenantId, 'sender_id' => $me->id, 'receiver_id' => $this->member()->id,
            'amount' => 3, 'transaction_type' => 'transfer', 'status' => 'completed',
            'created_at' => now(), 'updated_at' => now(),
        ]);

        $exchange = $this->exchangeWaitingFor($me, $provider, 2);
        Sanctum::actingAs($me, ['*']);

        $this->apiPost("/v2/exchanges/{$exchange->id}/confirm", ['hours' => 2])
            ->assertOk()
            ->assertJsonPath('data.status', 'completed')
            ->assertJsonPath('data.thanks.neighbours_this_year', 2)
            ->assertJsonPath('data.thanks.hours_this_year', 4.5);
    }

    public function test_no_thank_you_while_the_exchange_still_waits_for_the_other_person(): void
    {
        $me = $this->member();
        $provider = $this->member();
        $listing = Listing::factory()->create(['tenant_id' => $this->testTenantId, 'user_id' => $provider->id]);
        $exchange = ExchangeRequest::factory()->forTenant($this->testTenantId)->create([
            'listing_id' => $listing->id,
            'requester_id' => $me->id,
            'provider_id' => $provider->id,
            'status' => 'pending_confirmation',
            'proposed_hours' => 1,
        ]);
        Sanctum::actingAs($me, ['*']);

        $response = $this->apiPost("/v2/exchanges/{$exchange->id}/confirm", ['hours' => 1])->assertOk();

        $this->assertNotSame('completed', $response->json('data.status'));
        $this->assertNull($response->json('data.thanks'));
    }

    public function test_exchanges_in_another_community_are_not_counted(): void
    {
        $me = $this->member();
        $provider = $this->member();
        $otherTenant = (int) DB::table('tenants')->where('id', '!=', $this->testTenantId)->value('id');
        $this->pastExchange($me, $this->member(), 5, now()->toDateTimeString(), $otherTenant);

        $exchange = $this->exchangeWaitingFor($me, $provider, 1);
        Sanctum::actingAs($me, ['*']);

        $this->apiPost("/v2/exchanges/{$exchange->id}/confirm", ['hours' => 1])
            ->assertOk()
            ->assertJsonPath('data.thanks.neighbours_this_year', 1)
            ->assertJsonPath('data.thanks.hours_this_year', 1);
    }
}
