<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Http\Controllers\Api\FeedSidebarController;
use App\Models\Listing;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * GET /v2/community/this-month — the dashboard's monthly highlight (AWID
 * feedback, Nov 2026: "energy, warmth, and community"). Three totals for the
 * member's own community, this calendar month: hours shared between members
 * (exchanges and member-to-member transfers), new members, and new offers and
 * requests. Totals only — no names. Signed-in members only.
 */
class CommunityThisMonthTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::forget(FeedSidebarController::thisMonthCacheKey($this->testTenantId));
    }

    protected function tearDown(): void
    {
        Cache::forget(FeedSidebarController::thisMonthCacheKey($this->testTenantId));
        parent::tearDown();
    }

    private function member(array $overrides = []): User
    {
        // The factory picks a random join date in the past year; these join now.
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'created_at' => now(),
        ], $overrides));
    }

    private function transaction(string $type, float $amount, string $when, ?int $tenantId = null): void
    {
        DB::table('transactions')->insert([
            'tenant_id' => $tenantId ?? $this->testTenantId,
            'sender_id' => $this->member()->id,
            'receiver_id' => $this->member()->id,
            'amount' => $amount,
            'transaction_type' => $type,
            'status' => 'completed',
            'created_at' => $when,
            'updated_at' => $when,
        ]);
    }

    public function test_signing_in_is_required(): void
    {
        $this->apiGet('/v2/community/this-month')->assertStatus(401);
    }

    public function test_it_totals_this_months_hours_members_and_offers(): void
    {
        $viewer = $this->member(['created_at' => now()->subYear()]);
        Sanctum::actingAs($viewer, ['*']);

        $baseline = $this->apiGet('/v2/community/this-month')->assertOk()->json('data');
        Cache::forget(FeedSidebarController::thisMonthCacheKey($this->testTenantId));

        $thisMonth = now()->startOfMonth()->addHour()->toDateTimeString();
        $lastMonth = now()->startOfMonth()->subDay()->toDateTimeString();

        // Counted: an exchange and a member-to-member transfer this month.
        $this->transaction('exchange', 2.5, $thisMonth);
        $this->transaction('transfer', 1, $thisMonth);
        // Not counted: credits that are not members sharing time, last month, another community.
        $this->transaction('starting_balance', 5, $thisMonth);
        $this->transaction('admin_grant', 5, $thisMonth);
        $this->transaction('exchange', 9, $lastMonth);
        $otherTenant = (int) DB::table('tenants')->where('id', '!=', $this->testTenantId)->value('id');
        $this->transaction('exchange', 9, $thisMonth, $otherTenant);

        $joinedBefore = (int) $baseline['new_members'];

        Listing::factory()->create(['tenant_id' => $this->testTenantId, 'user_id' => $viewer->id, 'status' => 'active', 'created_at' => $thisMonth]);
        Listing::factory()->create(['tenant_id' => $this->testTenantId, 'user_id' => $viewer->id, 'status' => 'active', 'created_at' => $lastMonth]);
        Listing::factory()->create(['tenant_id' => $this->testTenantId, 'user_id' => $viewer->id, 'status' => 'rejected', 'created_at' => $thisMonth]);

        $data = $this->apiGet('/v2/community/this-month')->assertOk()->json('data');

        $this->assertSame(now()->format('Y-m'), $data['month']);
        $this->assertEqualsWithDelta((float) $baseline['hours_shared'] + 3.5, (float) $data['hours_shared'], 0.001);
        $this->assertSame((int) $baseline['new_listings'] + 1, (int) $data['new_listings']);
        // Each of the six transaction() calls created two members of this
        // community, all joining this month; the viewer joined last year.
        $this->assertSame($joinedBefore + 12, (int) $data['new_members']);
    }

    public function test_members_waiting_for_approval_are_not_counted_as_new_members(): void
    {
        $viewer = $this->member(['created_at' => now()->subYear()]);
        Sanctum::actingAs($viewer, ['*']);
        $before = (int) $this->apiGet('/v2/community/this-month')->json('data.new_members');
        Cache::forget(FeedSidebarController::thisMonthCacheKey($this->testTenantId));

        $this->member(['is_approved' => false]);
        $this->member(['status' => 'suspended']);
        $this->member();

        $this->assertSame($before + 1, (int) $this->apiGet('/v2/community/this-month')->json('data.new_members'));
    }
}
