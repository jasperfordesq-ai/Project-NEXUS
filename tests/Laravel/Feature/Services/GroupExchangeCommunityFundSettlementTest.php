<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Services;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\CommunityFundService;
use App\Services\GroupExchangeService;
use App\Services\SafeguardingInteractionPolicy;
use App\Support\SafeguardingInteractionDecision;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * Settling the "workshop or class" and "a team helping someone" kinds.
 *
 * One hour of time is one time credit. In a workshop the person running it earns
 * the hours they put in and everyone attending pays the hours they attended; the
 * hours left over go to the community time fund. Credits are conserved to the
 * cent: what attendees pay equals what givers earn plus what the fund receives.
 */
final class GroupExchangeCommunityFundSettlementTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
        $this->allowSafeguarding();
    }

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }

    public function test_workshop_leftover_goes_to_the_community_fund(): void
    {
        $mary = $this->makeUser(0.0);
        $attendees = [$this->makeUser(10.0), $this->makeUser(10.0), $this->makeUser(10.0), $this->makeUser(10.0)];
        $fundBefore = $this->fundBalance();
        $stockBefore = $this->creditStock();

        $id = $this->makeExchange('workshop', 2.0, [[$mary, 'provider', 2.0]], array_map(fn ($u) => [$u, 'receiver', 2.0], $attendees));

        $result = $this->service()->complete($id);

        $this->assertTrue($result['success'], (string) ($result['error'] ?? ''));
        $this->assertSame(2.0, $this->balanceOf($mary));
        foreach ($attendees as $attendee) {
            $this->assertSame(8.0, $this->balanceOf($attendee));
        }
        $this->assertSame(round($fundBefore + 6.0, 2), $this->fundBalance());

        $fundRows = DB::table('community_fund_transactions')
            ->where('tenant_id', $this->testTenantId)
            ->where('type', 'group_exchange')
            ->where('created_at', '>=', now()->subMinute())
            ->get();
        $this->assertCount(1, $fundRows);
        $this->assertSame(6.0, (float) $fundRows[0]->amount);

        $toFund = (float) DB::table('transactions')
            ->where('tenant_id', $this->testTenantId)
            ->whereNull('receiver_id')
            ->whereIn('sender_id', array_map(fn ($u) => $u->id, $attendees))
            ->sum('amount');
        $this->assertSame(6.0, round($toFund, 2));

        $this->assertSame(
            round($stockBefore + $fundBefore, 2),
            round($this->creditStock() + $this->fundBalance(), 2),
            'credits must be conserved: members plus the fund hold the same total as before',
        );
    }

    public function test_an_attendees_wallet_history_shows_the_payment_to_the_fund(): void
    {
        $mary = $this->makeUser(0.0);
        $attendee = $this->makeUser(10.0);
        $other = $this->makeUser(10.0);
        $id = $this->makeExchange('workshop', 2.0, [[$mary, 'provider', 2.0]], [[$attendee, 'receiver', 2.0], [$other, 'receiver', 2.0]]);
        $this->assertTrue($this->service()->complete($id)['success']);

        \Laravel\Sanctum\Sanctum::actingAs($other, ['*']);
        $response = $this->apiGet('/v2/wallet/transactions');

        $response->assertStatus(200);
        $this->assertStringContainsString('leftover hours to the community time fund', $response->getContent());
    }

    public function test_workshop_with_no_leftover_writes_no_fund_rows(): void
    {
        $giver = $this->makeUser(0.0);
        $attendee = $this->makeUser(5.0);
        $fundBefore = $this->fundBalance();
        $id = $this->makeExchange('workshop', 1.0, [[$giver, 'provider', 1.0]], [[$attendee, 'receiver', 1.0]]);

        $this->assertTrue($this->service()->complete($id)['success']);

        $this->assertSame(1.0, $this->balanceOf($giver));
        $this->assertSame(4.0, $this->balanceOf($attendee));
        $this->assertSame($fundBefore, $this->fundBalance());
        $this->assertSame(0, DB::table('transactions')->where('sender_id', $attendee->id)->whereNull('receiver_id')->count());
    }

    public function test_team_completion_charges_the_person_helped_for_every_helper(): void
    {
        $helperA = $this->makeUser(0.0);
        $helperB = $this->makeUser(0.0);
        $tom = $this->makeUser(5.0);
        $fundBefore = $this->fundBalance();
        $id = $this->makeExchange('team', 1.0, [[$helperA, 'provider', 1.0], [$helperB, 'provider', 1.0]], [[$tom, 'receiver', 0.0]]);

        $this->assertTrue($this->service()->complete($id)['success']);

        $this->assertSame(1.0, $this->balanceOf($helperA));
        $this->assertSame(1.0, $this->balanceOf($helperB));
        $this->assertSame(3.0, $this->balanceOf($tom));
        $this->assertSame($fundBefore, $this->fundBalance());
    }

    public function test_team_cost_shared_by_three_people_settles_to_the_cent(): void
    {
        $helperA = $this->makeUser(0.0);
        $helperB = $this->makeUser(0.0);
        $helped = [$this->makeUser(5.0), $this->makeUser(5.0), $this->makeUser(5.0)];
        $stockBefore = $this->creditStock();
        $id = $this->makeExchange('team', 1.25, [[$helperA, 'provider', 1.25], [$helperB, 'provider', 1.25]], array_map(fn ($u) => [$u, 'receiver', 0.0], $helped));

        $this->assertTrue($this->service()->complete($id)['success']);

        $this->assertSame([4.17, 4.17, 4.16], array_map(fn ($u) => $this->balanceOf($u), $helped));
        $this->assertSame(round($stockBefore, 2), round($this->creditStock(), 2));
    }

    public function test_workshop_refused_at_start_when_givers_would_earn_more(): void
    {
        $a = $this->makeUser(0.0);
        $b = $this->makeUser(0.0);
        $c = $this->makeUser(5.0);
        $id = $this->makeExchange('workshop', 1.0, [[$a, 'provider', 1.0], [$b, 'provider', 1.0]], [[$c, 'receiver', 1.0]], 'draft');

        $result = $this->service()->start($id);

        $this->assertFalse($result['success']);
        $this->assertStringContainsString('A team helping someone', (string) $result['error']);
        $this->assertSame('draft', DB::table('group_exchanges')->where('id', $id)->value('status'));
    }

    public function test_existing_equal_exchange_settles_as_before(): void
    {
        $givers = [$this->makeUser(0.0), $this->makeUser(0.0)];
        $receivers = [$this->makeUser(10.0), $this->makeUser(10.0), $this->makeUser(10.0)];
        $fundBefore = $this->fundBalance();
        $id = $this->makeExchange('equal', 10.0, array_map(fn ($u) => [$u, 'provider', 0.0], $givers), array_map(fn ($u) => [$u, 'receiver', 0.0], $receivers));

        $this->assertTrue($this->service()->complete($id)['success']);

        $this->assertSame([5.0, 5.0], array_map(fn ($u) => $this->balanceOf($u), $givers));
        $this->assertSame([6.67, 6.67, 6.66], array_map(fn ($u) => $this->balanceOf($u), $receivers));
        $this->assertSame($fundBefore, $this->fundBalance());
    }

    public function test_snapshot_reports_the_fund_share(): void
    {
        $mary = $this->makeUser(0.0);
        $attendees = [$this->makeUser(10.0), $this->makeUser(10.0), $this->makeUser(10.0), $this->makeUser(10.0)];
        $id = $this->makeExchange('workshop', 2.0, [[$mary, 'provider', 2.0]], array_map(fn ($u) => [$u, 'receiver', 2.0], $attendees));

        $snapshot = $this->service()->get($id);

        $this->assertSame(6.0, $snapshot['community_fund_hours']);
    }

    public function test_attendee_without_enough_credit_rolls_everything_back(): void
    {
        $giver = $this->makeUser(0.0);
        $rich = $this->makeUser(10.0);
        $poor = $this->makeUser(1.0);
        $fundBefore = $this->fundBalance();
        $fundRowsBefore = DB::table('community_fund_transactions')->where('tenant_id', $this->testTenantId)->count();
        $id = $this->makeExchange('workshop', 2.0, [[$giver, 'provider', 2.0]], [[$rich, 'receiver', 2.0], [$poor, 'receiver', 2.0]]);

        try {
            $result = $this->service()->complete($id);
            $this->assertFalse($result['success']);
        } catch (\RuntimeException) {
            // a refused debit may surface as an exception; either way nothing may move
        }

        $this->assertSame(0.0, $this->balanceOf($giver));
        $this->assertSame(10.0, $this->balanceOf($rich));
        $this->assertSame(1.0, $this->balanceOf($poor));
        $this->assertSame($fundBefore, $this->fundBalance());
        $this->assertSame($fundRowsBefore, DB::table('community_fund_transactions')->where('tenant_id', $this->testTenantId)->count());
        $this->assertNotSame('completed', DB::table('group_exchanges')->where('id', $id)->value('status'));
    }

    // ------------------------------------------------------------------

    private function service(): GroupExchangeService
    {
        return app(GroupExchangeService::class);
    }

    /**
     * @param list<array{0: User, 1: string, 2: float}> $givers
     * @param list<array{0: User, 1: string, 2: float}> $receivers
     */
    private function makeExchange(string $kind, float $totalHours, array $givers, array $receivers, string $status = 'pending_confirmation'): int
    {
        $organizer = $givers[0][0];
        $id = (int) DB::table('group_exchanges')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'title' => 'Knitting class',
            'organizer_id' => $organizer->id,
            'status' => $status,
            'split_type' => $kind,
            'total_hours' => $totalHours,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        foreach (array_merge($givers, $receivers) as [$user, $role, $hours]) {
            DB::table('group_exchange_participants')->insert([
                'group_exchange_id' => $id,
                'user_id' => $user->id,
                'role' => $role,
                'hours' => $hours,
                'weight' => 1,
                'confirmed' => $status === 'pending_confirmation' ? 1 : 0,
                'created_at' => now(),
            ]);
        }

        return $id;
    }

    private function makeUser(float $balance): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'balance' => $balance,
            'preferred_language' => 'en',
        ]);
    }

    private function balanceOf(User $user): float
    {
        return round((float) DB::table('users')->where('id', $user->id)->value('balance'), 2);
    }

    private function creditStock(): float
    {
        return (float) DB::table('users')->where('tenant_id', $this->testTenantId)->sum('balance');
    }

    private function fundBalance(): float
    {
        CommunityFundService::getOrCreateFund();

        return round((float) DB::table('community_fund_accounts')->where('tenant_id', $this->testTenantId)->value('balance'), 2);
    }

    private function allowSafeguarding(): void
    {
        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('evaluateLocalContact')->andReturn($this->allowDecision());
        $policy->shouldReceive('evaluateCrossTenantContact')->andReturn($this->allowDecision());
        $policy->shouldReceive('evaluateExternalContact')->andReturn($this->allowDecision());
        $policy->shouldReceive('assertLocalContactAllowed')->andReturnNull();
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);
    }

    private function allowDecision(): SafeguardingInteractionDecision
    {
        return new SafeguardingInteractionDecision(
            status: SafeguardingInteractionDecision::ALLOW,
            code: 'ALLOWED',
            recipientTenantId: $this->testTenantId,
            purposeCode: 'safeguarded_member_contact',
            scopeType: 'tenant',
            scopeIdentifier: '',
            policyVersion: 'help-12-part-1',
        );
    }
}
