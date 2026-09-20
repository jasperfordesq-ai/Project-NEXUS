<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Services;

use App\Core\TenantContext;
use App\Services\GroupExchangeService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * H3 — money-path regression tests for GroupExchangeService::complete().
 *
 * The runtime guards were already correct (atomic status-claim, a single
 * DB::transaction, a balance>=amount debit guard), but there was ZERO test that
 * the credits conserve, that a double-complete is idempotent, or that an
 * insufficient receiver balance rolls the whole completion back. These add that.
 *
 * Whole-hour amounts only (custom split with explicit hours) so the assertions
 * are exact on both int and decimal money columns.
 */
class GroupExchangeServiceTest extends TestCase
{
    use DatabaseTransactions;

    private GroupExchangeService $service;

    protected function setUp(): void
    {
        parent::setUp();
        // Exercise balances and in-app notifications without reaching delivery providers.
        $this->mock(\App\Services\EmailDispatchService::class, fn ($mock) => $mock->shouldReceive('send')->andReturn(true));
        $this->mock(\App\Services\WebPushService::class, fn ($mock) => $mock->shouldReceive('sendToUser')->andReturn(true));
        \Illuminate\Support\Facades\Http::fake();
        $this->service = app(GroupExchangeService::class);
        TenantContext::setById($this->testTenantId);
    }

    private function makeUser(float $balance): int
    {
        $id = (int) DB::table('users')->insertGetId([
            'tenant_id'  => $this->testTenantId,
            'first_name' => 'GX',
            'last_name'  => 'Member',
            'email'      => 'gx.' . uniqid('', true) . '@example.test',
            'username'   => 'gx_' . substr(md5(uniqid('', true)), 0, 12),
            'password'   => password_hash('password', PASSWORD_BCRYPT),
            'balance'    => $balance,
            'status'     => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        TenantContext::setById($this->testTenantId);

        return $id;
    }

    /**
     * @param array<int, array{user_id:int, role:string, hours:int|float}> $participants
     */
    private function seedExchange(array $participants, string $status = 'pending_confirmation'): int
    {
        $organizer = $this->makeUser(0);

        $exchangeId = (int) DB::table('group_exchanges')->insertGetId([
            'tenant_id'    => $this->testTenantId,
            'title'        => 'Barn raising',
            'organizer_id' => $organizer,
            'status'       => $status,
            'split_type'   => 'custom',
            'total_hours'  => 0,
            'created_at'   => now(),
            'updated_at'   => now(),
        ]);

        foreach ($participants as $p) {
            DB::table('group_exchange_participants')->insert([
                'group_exchange_id' => $exchangeId,
                'user_id'           => $p['user_id'],
                'role'              => $p['role'],
                'hours'             => $p['hours'],
                'confirmed'         => 1,
                'confirmed_at'      => now(),
                'created_at'        => now(),
            ]);
        }

        return $exchangeId;
    }

    private function balanceOf(int $userId): float
    {
        return (float) DB::table('users')->where('id', $userId)->value('balance');
    }

    private function exchangeCreditCount(int $providerId): int
    {
        return (int) DB::table('transactions')
            ->where('tenant_id', $this->testTenantId)
            ->where('receiver_id', $providerId)
            ->where('transaction_type', 'exchange')
            ->count();
    }

    public function test_complete_conserves_credits_and_is_idempotent(): void
    {
        $provider = $this->makeUser(0);
        $receiver = $this->makeUser(10);
        $exchangeId = $this->seedExchange([
            ['user_id' => $provider, 'role' => 'provider', 'hours' => 6],
            ['user_id' => $receiver, 'role' => 'receiver', 'hours' => 6],
        ]);

        $totalBefore = $this->balanceOf($provider) + $this->balanceOf($receiver); // 10

        TenantContext::setById($this->testTenantId);
        $r1 = $this->service->complete($exchangeId);
        $this->assertTrue($r1['success'] ?? false, 'first complete must succeed: ' . json_encode($r1));

        // Provider +6, receiver −6.
        $this->assertEqualsWithDelta(6, $this->balanceOf($provider), 0.001, 'provider credited 6');
        $this->assertEqualsWithDelta(4, $this->balanceOf($receiver), 0.001, 'receiver debited 6 (10 -> 4)');

        // Conservation across the two wallets — nothing minted or burned.
        $this->assertEqualsWithDelta(
            $totalBefore,
            $this->balanceOf($provider) + $this->balanceOf($receiver),
            0.001,
            'group exchange must conserve total credits'
        );
        $this->assertSame(1, $this->exchangeCreditCount($provider), 'exactly one credit ledger row');

        // Idempotency: a second complete() must NOT move money again.
        TenantContext::setById($this->testTenantId);
        $r2 = $this->service->complete($exchangeId);
        $this->assertFalse($r2['success'] ?? true, 'second complete must be a no-op');

        $this->assertEqualsWithDelta(6, $this->balanceOf($provider), 0.001, 'provider not credited twice');
        $this->assertEqualsWithDelta(4, $this->balanceOf($receiver), 0.001, 'receiver not debited twice');
        $this->assertSame(1, $this->exchangeCreditCount($provider), 'no second credit ledger row');
    }

    public function test_complete_rolls_back_on_insufficient_receiver_balance(): void
    {
        $provider = $this->makeUser(0);
        $receiver = $this->makeUser(3); // less than the 6 required
        $exchangeId = $this->seedExchange([
            ['user_id' => $provider, 'role' => 'provider', 'hours' => 6],
            ['user_id' => $receiver, 'role' => 'receiver', 'hours' => 6],
        ]);

        TenantContext::setById($this->testTenantId);
        try {
            $this->service->complete($exchangeId);
            $this->fail('Expected a RuntimeException for insufficient receiver balance');
        } catch (\RuntimeException $e) {
            $this->assertNotEmpty($e->getMessage());
        }

        // Whole completion rolled back: no credit, no debit, no ledger row,
        // and the atomic status-claim was rolled back too (not 'completed').
        $this->assertEqualsWithDelta(0, $this->balanceOf($provider), 0.001, 'provider must not be credited');
        $this->assertEqualsWithDelta(3, $this->balanceOf($receiver), 0.001, 'receiver must not be debited');
        $this->assertSame(0, $this->exchangeCreditCount($provider), 'no credit ledger row on rollback');

        $status = DB::table('group_exchanges')->where('id', $exchangeId)->value('status');
        $this->assertNotSame('completed', $status, 'the status-claim must roll back with the failed money movement');
    }

    // ------------------------------------------------------------------
    //  Custom-split conservation (P1 — audit 2026-07-09): an unbalanced
    //  custom split minted SUM(provider) − SUM(receiver) credits from
    //  nothing on completion. Both gates (start + complete) must reject it.
    // ------------------------------------------------------------------

    public function test_complete_rejects_unbalanced_custom_split(): void
    {
        // The audit exploit verbatim: provider 100h vs receiver 1h would have
        // minted +99 credits on completion.
        $provider = $this->makeUser(0);
        $receiver = $this->makeUser(1);
        $exchangeId = $this->seedExchange([
            ['user_id' => $provider, 'role' => 'provider', 'hours' => 100],
            ['user_id' => $receiver, 'role' => 'receiver', 'hours' => 1],
        ]);

        TenantContext::setById($this->testTenantId);
        $result = $this->service->complete($exchangeId);

        $this->assertFalse($result['success'] ?? true, 'unbalanced custom split must be rejected');
        $this->assertNotEmpty($result['error'] ?? '');

        $this->assertEqualsWithDelta(0, $this->balanceOf($provider), 0.001, 'no credit may be minted');
        $this->assertEqualsWithDelta(1, $this->balanceOf($receiver), 0.001, 'no debit may be taken');
        $this->assertSame(0, $this->exchangeCreditCount($provider), 'no ledger row on rejection');

        $status = DB::table('group_exchanges')->where('id', $exchangeId)->value('status');
        $this->assertNotSame('completed', $status, 'a rejected exchange must not be marked completed');
    }

    public function test_start_rejects_unbalanced_custom_split(): void
    {
        $provider = $this->makeUser(0);
        $receiver = $this->makeUser(1);
        $exchangeId = $this->seedExchange([
            ['user_id' => $provider, 'role' => 'provider', 'hours' => 100],
            ['user_id' => $receiver, 'role' => 'receiver', 'hours' => 1],
        ], 'draft');

        TenantContext::setById($this->testTenantId);
        $result = $this->service->start($exchangeId);

        $this->assertFalse($result['success'] ?? true, 'start must reject an unbalanced custom split');
        $this->assertNotEmpty($result['error'] ?? '');

        $status = DB::table('group_exchanges')->where('id', $exchangeId)->value('status');
        $this->assertSame('draft', $status, 'a rejected start must leave the exchange in draft');
    }

    public function test_start_allows_balanced_custom_split(): void
    {
        $provider = $this->makeUser(0);
        $receiver = $this->makeUser(10);
        $exchangeId = $this->seedExchange([
            ['user_id' => $provider, 'role' => 'provider', 'hours' => 6],
            ['user_id' => $receiver, 'role' => 'receiver', 'hours' => 6],
        ], 'draft');

        TenantContext::setById($this->testTenantId);
        $result = $this->service->start($exchangeId);

        $this->assertTrue($result['success'] ?? false, 'a balanced custom split must still start: ' . json_encode($result));
        $status = DB::table('group_exchanges')->where('id', $exchangeId)->value('status');
        $this->assertSame('pending_confirmation', $status);
    }

    public function test_update_rechecks_terminal_state_inside_the_service(): void
    {
        foreach (['completed', 'cancelled'] as $status) {
            $id = $this->seedExchange([], $status);
            $this->assertFalse($this->service->update($id, ['total_hours' => 99, 'title' => 'Stale edit']));
            $this->assertSame('Barn raising', DB::table('group_exchanges')->where('id', $id)->value('title'));
            $this->assertSame(0.0, (float) DB::table('group_exchanges')->where('id', $id)->value('total_hours'));
        }
    }

    public function test_complete_rejects_states_that_are_not_awaiting_confirmation(): void
    {
        foreach (['draft', 'pending_participants', 'pending_broker', 'active', 'disputed'] as $status) {
            $provider = $this->makeUser(0);
            $receiver = $this->makeUser(10);
            $id = $this->seedExchange([
                ['user_id' => $provider, 'role' => 'provider', 'hours' => 6],
                ['user_id' => $receiver, 'role' => 'receiver', 'hours' => 6],
            ], $status);
            $result = $this->service->complete($id);
            $this->assertFalse($result['success'], $status . ' must not settle');
            $this->assertSame($status, DB::table('group_exchanges')->where('id', $id)->value('status'));
            $this->assertSame(0.0, $this->balanceOf($provider));
            $this->assertSame(10.0, $this->balanceOf($receiver));
            $this->assertSame(0, $this->exchangeCreditCount($provider));
        }
    }

    public function test_stale_start_cannot_overwrite_cancellation_or_repeat_another_start(): void
    {
        foreach (['cancel', 'start'] as $competingAction) {
            $provider = $this->makeUser(0);
            $receiver = $this->makeUser(10);
            $exchangeId = $this->seedExchange([
                ['user_id' => $provider, 'role' => 'provider', 'hours' => 6],
                ['user_id' => $receiver, 'role' => 'receiver', 'hours' => 6],
            ], 'draft');
            $service = \Mockery::mock(GroupExchangeService::class)->makePartial();
            $notificationsAfterCompetition = null;
            $service->shouldReceive('calculateSplit')->once()->with($exchangeId)
                ->andReturnUsing(function () use ($exchangeId, $competingAction, &$notificationsAfterCompetition): array {
                    $split = $this->service->calculateSplit($exchangeId);
                    // Interleave after the first request read draft, before its final write.
                    $result = $this->service->{$competingAction}($exchangeId);
                    $this->assertTrue(is_array($result) ? $result['success'] : $result);
                    $notificationsAfterCompetition = DB::table('notifications')->count();
                    return $split;
                });

            $result = $service->start($exchangeId);

            $this->assertFalse($result['success'], 'stale start must lose to ' . $competingAction);
            $this->assertSame($competingAction === 'cancel' ? 'cancelled' : 'pending_confirmation',
                DB::table('group_exchanges')->where('id', $exchangeId)->value('status'));
            $this->assertSame(0.0, $this->balanceOf($provider));
            $this->assertSame(10.0, $this->balanceOf($receiver));
            $this->assertSame($notificationsAfterCompetition, DB::table('notifications')->count(), 'losing start must not notify');
        }
    }

    public function test_complete_rejects_negative_hours_disguising_imbalance(): void
    {
        // A plain SUM() would call this balanced (10 + (-5) = 5 == 5), but
        // complete() skips <= 0 entries, so the real movement is +10 / −5.
        // The guard must mirror complete()'s semantics, not raw sums.
        $providerA = $this->makeUser(0);
        $providerB = $this->makeUser(0);
        $receiver  = $this->makeUser(10);
        $exchangeId = $this->seedExchange([
            ['user_id' => $providerA, 'role' => 'provider', 'hours' => 10],
            ['user_id' => $providerB, 'role' => 'provider', 'hours' => -5],
            ['user_id' => $receiver,  'role' => 'receiver', 'hours' => 5],
        ]);

        TenantContext::setById($this->testTenantId);
        $result = $this->service->complete($exchangeId);

        $this->assertFalse($result['success'] ?? true, 'negative-hours rows must not disguise an imbalance');
        $this->assertEqualsWithDelta(0, $this->balanceOf($providerA), 0.001);
        $this->assertEqualsWithDelta(10, $this->balanceOf($receiver), 0.001);
    }

    // ------------------------------------------------------------------
    //  Fractional-hours notifications (P3 — audit 2026-07-09): hours were
    //  (int)-cast, so a 0.5h share moved money with NO notification and
    //  1.5h read as "1 hour".
    // ------------------------------------------------------------------

    public function test_complete_notifies_fractional_hour_shares(): void
    {
        $provider = $this->makeUser(0);
        $receiver = $this->makeUser(2);
        $exchangeId = $this->seedExchange([
            ['user_id' => $provider, 'role' => 'provider', 'hours' => 0.5],
            ['user_id' => $receiver, 'role' => 'receiver', 'hours' => 0.5],
        ]);

        TenantContext::setById($this->testTenantId);
        $result = $this->service->complete($exchangeId);
        $this->assertTrue($result['success'] ?? false, 'fractional balanced split must complete: ' . json_encode($result));

        $this->assertEqualsWithDelta(0.5, $this->balanceOf($provider), 0.001);
        $this->assertEqualsWithDelta(1.5, $this->balanceOf($receiver), 0.001);

        foreach ([$provider, $receiver] as $userId) {
            $message = DB::table('notifications')
                ->where('user_id', $userId)
                ->where('type', 'transaction')
                ->value('message');

            $this->assertNotNull($message, "user {$userId} must be notified of a 0.5h balance change");
            $this->assertStringContainsString('0.5', (string) $message, 'the fractional amount must survive into the message');
        }
    }
}
