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

    /** The six calendar months the chart covers, oldest first, ending with this month. */
    private function chartMonths(): array
    {
        $start = now()->startOfMonth();
        $months = [];
        for ($i = 5; $i >= 0; $i--) {
            $months[] = $start->copy()->subMonthsNoOverflow($i)->format('Y-m');
        }

        return $months;
    }

    public function test_monthly_hours_cover_six_months_oldest_first_and_fill_empty_months_with_zero(): void
    {
        $viewer = $this->member(['created_at' => now()->subYear()]);
        Sanctum::actingAs($viewer, ['*']);

        $baseline = collect($this->apiGet('/v2/community/this-month')->assertOk()->json('data.monthly_hours'))
            ->pluck('hours', 'month');
        Cache::forget(FeedSidebarController::thisMonthCacheKey($this->testTenantId));

        // Zero-filled: every month is present even where nothing was shared.
        $this->assertSame($this->chartMonths(), $baseline->keys()->all());

        $start = now()->startOfMonth();
        $twoMonthsAgo = $start->copy()->subMonthsNoOverflow(2)->addDays(3)->toDateTimeString();
        $sevenMonthsAgo = $start->copy()->subMonthsNoOverflow(7)->addDays(3)->toDateTimeString();

        // Counted, two months ago: an exchange and a member-to-member transfer.
        $this->transaction('exchange', 4, $twoMonthsAgo);
        $this->transaction('transfer', 1.5, $twoMonthsAgo);
        // Not counted: a grant, a month before the window, and an exchange
        // that never completed.
        $this->transaction('admin_grant', 20, $twoMonthsAgo);
        $this->transaction('exchange', 30, $sevenMonthsAgo);
        DB::table('transactions')->insert([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $viewer->id,
            'receiver_id' => $this->member()->id,
            'amount' => 50,
            'transaction_type' => 'exchange',
            'status' => 'pending',
            'created_at' => $twoMonthsAgo,
            'updated_at' => $twoMonthsAgo,
        ]);

        $rows = $this->apiGet('/v2/community/this-month')->assertOk()->json('data.monthly_hours');

        $this->assertSame($this->chartMonths(), array_column($rows, 'month'));
        foreach ($rows as $index => $row) {
            $this->assertSame(['month', 'hours'], array_keys($row), 'Totals only: a month and a number.');
            $this->assertIsNumeric($row['hours']);
            $added = $index === 3 ? 5.5 : 0.0;
            $this->assertEqualsWithDelta((float) $baseline[$row['month']] + $added, (float) $row['hours'], 0.001, $row['month']);
        }
    }

    public function test_another_communitys_hours_are_never_in_the_monthly_figures(): void
    {
        $otherTenant = (int) DB::table('tenants')->where('id', '!=', $this->testTenantId)->value('id');
        $this->assertGreaterThan(0, $otherTenant, 'This test needs a second community.');
        $viewer = $this->member(['created_at' => now()->subYear()]);
        Sanctum::actingAs($viewer, ['*']);

        $before = $this->apiGet('/v2/community/this-month')->assertOk()->json('data.monthly_hours');
        $this->assertCount(6, $before);
        Cache::forget(FeedSidebarController::thisMonthCacheKey($this->testTenantId));

        $start = now()->startOfMonth();
        for ($i = 0; $i < 6; $i++) {
            $this->transaction('exchange', 7, $start->copy()->subMonthsNoOverflow($i)->addHour()->toDateTimeString(), $otherTenant);
        }

        $this->assertSame($before, $this->apiGet('/v2/community/this-month')->assertOk()->json('data.monthly_hours'));
    }

    public function test_the_last_monthly_bar_is_this_months_hours_figure(): void
    {
        $viewer = $this->member(['created_at' => now()->subYear()]);
        Sanctum::actingAs($viewer, ['*']);

        $this->transaction('exchange', 2.25, now()->startOfMonth()->addHour()->toDateTimeString());
        $this->transaction('transfer', 1, now()->startOfMonth()->addHours(2)->toDateTimeString());

        $data = $this->apiGet('/v2/community/this-month')->assertOk()->json('data');
        $last = end($data['monthly_hours']);

        $this->assertSame($data['month'], $last['month']);
        $this->assertGreaterThanOrEqual(3.25, (float) $last['hours']);
        $this->assertEqualsWithDelta((float) $data['hours_shared'], (float) $last['hours'], 0.0001);
    }
}
