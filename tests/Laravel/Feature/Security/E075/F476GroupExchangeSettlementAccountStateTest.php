<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E075;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\SafeguardingInteractionPolicy;
use App\Services\WalletService;
use App\Support\SafeguardingInteractionDecision;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * F-476 — group-exchange settlement must re-read the participants' account
 * state, and must not destroy time credits.
 *
 * `GroupExchangeService` checked `users.status = 'active'` only when a
 * participant was ADDED and never again. Settlement happens much later, in
 * `complete()`, which claims the exchange row atomically, re-checks the
 * conservation of the split and re-evaluates the safeguarding contact policy —
 * but read nothing about the members. Two harms followed.
 *
 * (1) A SUSPENDED OR BANNED PROVIDER WAS PAID. The same shape as F-442, which
 *     E-074 fixed for one-to-one exchange completion (`9049e0e16`) by calling
 *     the shared `WalletService::canReceiveCredits()` on the locked payee row.
 *     Group exchanges are the second settlement engine and were not reached.
 *
 * (2) CREDITS WERE DESTROYED. The receiver debit is conditional
 *     (`where('balance','>=',$hours)`) and throws when it affects zero rows.
 *     The provider credit was unconditional and its return value was DISCARDED.
 *     Both legs carry `where('tenant_id', $tenantId)`, so a participant moved to
 *     another community between joining and settlement matched nothing on the
 *     credit leg: the receivers were debited, the exchange was marked
 *     `completed`, a `transactions` row recorded a credit that never landed, and
 *     the hours left the community's stock (measured: −4.00).
 *
 * These tests assert the CORRECT behaviour: the settlement is refused, nothing
 * moves, the exchange stays settleable, and the community's credit stock is
 * conserved exactly. They drive the member-facing route
 * `POST /v2/group-exchanges/{id}/complete`, so the refusal is measured as the
 * organiser actually experiences it. The controls prove ordinary settlement
 * still works.
 */
final class F476GroupExchangeSettlementAccountStateTest extends TestCase
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

    // ------------------------------------------------------------------
    //  HARM 1 — a suspended provider must not be paid
    // ------------------------------------------------------------------

    public function test_a_provider_suspended_after_joining_is_not_paid_on_settlement(): void
    {
        $provider = $this->makeUser(0.0);
        $receiver = $this->makeUser(10.0);
        $exchangeId = $this->makeConfirmedExchange($provider, $receiver, 4.0);

        // The administrator suspends the provider while the exchange is open.
        DB::table('users')->where('id', $provider->id)->update(['status' => 'suspended', 'is_active' => 0]);
        $this->assertFalse(
            WalletService::canReceiveCredits('suspended'),
            'precondition: the shared platform rule refuses a suspended recipient',
        );

        $response = $this->settleAs($receiver, $exchangeId);

        $this->assertSame(409, $response->getStatusCode(), 'F-476: the settlement must be refused');
        $this->assertSame(
            0.0,
            $this->balanceOf($provider),
            'F-476: a suspended account was credited by the group-exchange settlement',
        );
        $this->assertSame(
            10.0,
            $this->balanceOf($receiver),
            'F-476: nothing may move when the settlement is refused',
        );
        $this->assertNotSame(
            'completed',
            (string) DB::table('group_exchanges')->where('id', $exchangeId)->value('status'),
            'F-476: the exchange must stay settleable once the suspension is lifted',
        );
    }

    public function test_a_banned_provider_is_not_paid_on_settlement(): void
    {
        $provider = $this->makeUser(0.0);
        $receiver = $this->makeUser(10.0);
        $exchangeId = $this->makeConfirmedExchange($provider, $receiver, 3.0);

        DB::table('users')->where('id', $provider->id)->update(['status' => 'banned', 'is_active' => 0]);

        $response = $this->settleAs($receiver, $exchangeId);

        $this->assertSame(409, $response->getStatusCode());
        $this->assertSame(0.0, $this->balanceOf($provider), 'F-476: a banned account was credited');
        $this->assertSame(10.0, $this->balanceOf($receiver));
    }

    // ------------------------------------------------------------------
    //  HARM 2 — credits must be conserved, never destroyed
    // ------------------------------------------------------------------

    public function test_a_settlement_that_cannot_credit_the_provider_destroys_nothing(): void
    {
        $provider = $this->makeUser(0.0);
        $receiver = $this->makeUser(10.0);
        $exchangeId = $this->makeConfirmedExchange($provider, $receiver, 4.0);

        // The administrator moves the provider to another community while the
        // exchange is open — the platform supports this (userMoveTenant). Both
        // balance legs are scoped to this community, so the credit leg can match
        // no row at all while the debit leg still matches.
        DB::table('users')->where('id', $provider->id)->update(['tenant_id' => $this->otherTenantId()]);

        $stockBefore = $this->tenantCreditStock();
        $response = $this->settleAs($receiver, $exchangeId);
        $stockAfter = $this->tenantCreditStock();

        $this->assertNotSame(
            200,
            $response->getStatusCode(),
            'F-476: a settlement that cannot credit the provider must not report success',
        );
        $this->assertEqualsWithDelta(
            0.0,
            $stockAfter - $stockBefore,
            0.005,
            'F-476: time credits were destroyed by a settlement that could not pay the provider',
        );
        $this->assertSame(
            10.0,
            $this->balanceOf($receiver),
            'F-476: the receiver was debited for a credit that never landed',
        );
        $this->assertNotSame(
            'completed',
            (string) DB::table('group_exchanges')->where('id', $exchangeId)->value('status'),
        );
        $this->assertSame(
            0,
            DB::table('transactions')
                ->where('tenant_id', $this->testTenantId)
                ->where('sender_id', $receiver->id)
                ->where('receiver_id', $provider->id)
                ->count(),
            'F-476: the ledger recorded a transfer that did not happen',
        );
    }

    // ------------------------------------------------------------------
    //  LEGITIMATE-ACCESS CONTROLS
    // ------------------------------------------------------------------

    /**
     * CONTROL. Identical fixture, no account-state change at all: settlement
     * completes, pays the provider, debits the receiver, and the community's
     * total stock is unchanged. This is the behaviour the fix must preserve, and
     * it proves the fixture reaches the paying branch.
     */
    public function test_control_an_unchanged_group_exchange_settles_and_conserves_credits(): void
    {
        $provider = $this->makeUser(0.0);
        $receiver = $this->makeUser(10.0);
        $exchangeId = $this->makeConfirmedExchange($provider, $receiver, 4.0);

        $stockBefore = $this->tenantCreditStock();
        $response = $this->settleAs($receiver, $exchangeId);
        $stockAfter = $this->tenantCreditStock();

        $this->assertSame(200, $response->getStatusCode(), (string) $response->getContent());
        $this->assertSame(4.0, $this->balanceOf($provider));
        $this->assertSame(6.0, $this->balanceOf($receiver));
        $this->assertEqualsWithDelta(
            0.0,
            $stockAfter - $stockBefore,
            0.005,
            'credits are conserved when nothing changed',
        );
        $this->assertSame(
            'completed',
            (string) DB::table('group_exchanges')->where('id', $exchangeId)->value('status'),
        );
        $this->assertDatabaseHas('transactions', [
            'tenant_id' => $this->testTenantId,
            'sender_id' => $receiver->id,
            'receiver_id' => $provider->id,
        ]);
    }

    /**
     * CONTROL. A member who was suspended and then reinstated settles normally —
     * the refusal tracks the account's CURRENT state and must not bar the
     * exchange for good.
     */
    public function test_control_a_reinstated_provider_settles_normally(): void
    {
        $provider = $this->makeUser(0.0);
        $receiver = $this->makeUser(10.0);
        $exchangeId = $this->makeConfirmedExchange($provider, $receiver, 4.0);

        DB::table('users')->where('id', $provider->id)->update(['status' => 'suspended', 'is_active' => 0]);
        $this->assertSame(409, $this->settleAs($receiver, $exchangeId)->getStatusCode());

        DB::table('users')->where('id', $provider->id)->update(['status' => 'active', 'is_active' => 1]);
        $response = $this->settleAs($receiver, $exchangeId);

        $this->assertSame(200, $response->getStatusCode(), (string) $response->getContent());
        $this->assertSame(4.0, $this->balanceOf($provider));
        $this->assertSame(6.0, $this->balanceOf($receiver));
    }

    /**
     * CONTROL. The settlement's own claim guard still holds: a second
     * `complete()` on the same exchange pays nobody twice.
     */
    public function test_control_a_second_settlement_pays_nobody_twice(): void
    {
        $provider = $this->makeUser(0.0);
        $receiver = $this->makeUser(10.0);
        $exchangeId = $this->makeConfirmedExchange($provider, $receiver, 4.0);

        $this->settleAs($receiver, $exchangeId);
        $second = $this->settleAs($receiver, $exchangeId);

        $this->assertNotSame(200, $second->getStatusCode());
        $this->assertSame(4.0, $this->balanceOf($provider), 'paid exactly once');
        $this->assertSame(6.0, $this->balanceOf($receiver));
    }

    // ------------------------------------------------------------------
    //  Fixtures
    // ------------------------------------------------------------------

    private function settleAs(User $organiser, int $exchangeId): TestResponse
    {
        Sanctum::actingAs($organiser, ['*']);

        return $this->apiPost('/v2/group-exchanges/' . $exchangeId . '/complete', []);
    }

    private function balanceOf(User $user): float
    {
        return round((float) DB::table('users')->where('id', $user->id)->value('balance'), 2);
    }

    private function tenantCreditStock(): float
    {
        return (float) DB::table('users')->where('tenant_id', $this->testTenantId)->sum('balance');
    }

    private function otherTenantId(): int
    {
        $id = DB::table('tenants')->where('id', '!=', $this->testTenantId)->value('id');
        if ($id === null) {
            $this->markTestSkipped('this database has only one community');
        }

        return (int) $id;
    }

    /**
     * A group exchange sitting at `pending_confirmation` with every participant
     * confirmed — the exact state `complete()` requires. Both members were
     * `active` when they joined, which was the only moment the service checked.
     * The receiver is the organiser, because only the organiser may complete.
     */
    private function makeConfirmedExchange(User $provider, User $receiver, float $hours): int
    {
        $exchangeId = (int) DB::table('group_exchanges')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'title' => 'F476 group exchange',
            'description' => 'fixture',
            'organizer_id' => $receiver->id,
            'listing_id' => null,
            'status' => 'pending_confirmation',
            'split_type' => 'equal',
            'total_hours' => $hours,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        foreach ([[$provider->id, 'provider'], [$receiver->id, 'receiver']] as [$userId, $role]) {
            DB::table('group_exchange_participants')->insert([
                'group_exchange_id' => $exchangeId,
                'user_id' => $userId,
                'role' => $role,
                'hours' => $hours,
                'weight' => 1.00,
                'confirmed' => 1,
                'confirmed_at' => now(),
                'created_at' => now(),
            ]);
        }

        return $exchangeId;
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
            policyVersion: 'e075-f476',
        );
    }
}
