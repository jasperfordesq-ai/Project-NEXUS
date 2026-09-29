<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Integration;

use App\Core\TenantContext;
use App\Services\BrokerControlConfigService;
use App\Services\ExchangeWorkflowService;
use App\Services\GamificationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;
use Tests\Laravel\Traits\CreatesExchangeData;

/**
 * Regression: completing a workflow exchange must award XP to both parties.
 *
 * completeExchange()/createTransaction() write the `transactions` row directly
 * and never fire TransactionCompleted, so the UpdateWalletBalance listener (the
 * only place transfer XP was awarded) never ran for an exchange, and
 * XP_VALUES['complete_transaction'] had no call site at all. Completing an
 * exchange — the platform's core action — earned 0 XP while a feed post earned 5.
 */
class ExchangeCompletionXpTest extends TestCase
{
    use DatabaseTransactions;
    use CreatesExchangeData;

    protected function setUp(): void
    {
        parent::setUp();
        BrokerControlConfigService::updateConfig(['exchange_workflow_enabled' => true]);
    }

    /**
     * @return array{0: \App\Models\User, 1: \App\Models\User, 2: \App\Models\ExchangeRequest}
     */
    private function scenario(): array
    {
        $s = $this->createExchangeScenario([
            'provider'  => ['balance' => 10, 'status' => 'active', 'is_approved' => true, 'xp' => 0, 'level' => 1],
            'requester' => ['balance' => 10, 'status' => 'active', 'is_approved' => true, 'xp' => 0, 'level' => 1],
            'listing'   => ['type' => 'offer'],
            'exchange'  => [
                'status'         => ExchangeWorkflowService::STATUS_IN_PROGRESS,
                'proposed_hours' => 2.00,
            ],
        ]);

        // Same normalisation as ExchangeCreditDirectionTest: console observers can
        // drift TenantContext and leave rows under the wrong tenant.
        $tid = $this->testTenantId;
        DB::table('users')->whereIn('id', [$s['provider']->id, $s['requester']->id])->update(['tenant_id' => $tid]);
        DB::table('listings')->where('id', $s['listing']->id)->update(['tenant_id' => $tid]);
        DB::table('exchange_requests')->where('id', $s['exchange']->id)->update(['tenant_id' => $tid]);

        return [$s['provider'], $s['requester'], $s['exchange']];
    }

    private function confirm(int $exchangeId, int $userId, float $hours): bool
    {
        return TenantContext::runForTenant($this->testTenantId, fn () =>
            ExchangeWorkflowService::confirmCompletion($exchangeId, $userId, $hours));
    }

    /** @return list<object> */
    private function xpRows(int $userId): array
    {
        return DB::table('user_xp_log')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $userId)
            ->where('action', 'complete_transaction')
            ->get()
            ->all();
    }

    public function test_completing_an_exchange_awards_complete_transaction_xp_to_both_parties(): void
    {
        [$provider, $requester, $exchange] = $this->scenario();

        $this->assertTrue($this->confirm($exchange->id, (int) $provider->id, 2.00));
        $this->assertTrue($this->confirm($exchange->id, (int) $requester->id, 2.00));

        $expected = GamificationService::XP_VALUES['complete_transaction'];
        $reference = 'exchange:' . $exchange->id;

        foreach (['provider' => $provider, 'requester' => $requester] as $role => $user) {
            $rows = $this->xpRows((int) $user->id);
            $this->assertCount(1, $rows, "$role must get exactly one complete_transaction XP entry");
            $this->assertSame($expected, (int) $rows[0]->xp_amount, "$role XP amount");
            $this->assertSame($reference, $rows[0]->source_reference, "$role XP must carry the exchange reference for dedup");
            $this->assertSame(
                $expected,
                (int) DB::table('users')->where('id', $user->id)->value('xp'),
                "$role users.xp must reflect the award"
            );
        }

        // Awarding XP must not disturb the credit movement (no second transfer).
        $this->assertEqualsWithDelta(12, (float) DB::table('users')->where('id', $provider->id)->value('balance'), 0.001);
        $this->assertEqualsWithDelta(8, (float) DB::table('users')->where('id', $requester->id)->value('balance'), 0.001);
    }

    public function test_exchange_xp_is_not_awarded_twice_for_the_same_exchange(): void
    {
        [$provider, $requester, $exchange] = $this->scenario();

        $this->assertTrue($this->confirm($exchange->id, (int) $provider->id, 2.00));
        $this->assertTrue($this->confirm($exchange->id, (int) $requester->id, 2.00));

        // A replay of the same award (e.g. a retried completion path) is a no-op
        // because the award is keyed on the exchange reference.
        TenantContext::runForTenant($this->testTenantId, fn () => GamificationService::awardXP(
            (int) $provider->id,
            GamificationService::XP_VALUES['complete_transaction'],
            'complete_transaction',
            'replay',
            'exchange:' . $exchange->id
        ));

        $this->assertCount(1, $this->xpRows((int) $provider->id));
        $this->assertCount(1, $this->xpRows((int) $requester->id));
    }

    public function test_failed_completion_awards_no_xp(): void
    {
        [$provider, $requester, $exchange] = $this->scenario();
        // Requester (payer on an offer listing) cannot afford the hours.
        DB::table('users')->where('id', $requester->id)->update(['balance' => 0]);

        $this->assertTrue($this->confirm($exchange->id, (int) $provider->id, 2.00));
        try {
            $this->confirm($exchange->id, (int) $requester->id, 2.00);
        } catch (\RuntimeException $e) {
            $this->assertSame('INSUFFICIENT_BALANCE', $e->getMessage());
        }

        $this->assertCount(0, $this->xpRows((int) $provider->id));
        $this->assertCount(0, $this->xpRows((int) $requester->id));
    }
}
