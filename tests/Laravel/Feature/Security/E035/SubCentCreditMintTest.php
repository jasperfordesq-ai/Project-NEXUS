<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E035;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\BrokerControlConfigService;
use App\Services\CommunityFundService;
use App\Services\ExchangeWorkflowService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;
use Tests\Laravel\Traits\CreatesExchangeData;

/**
 * F-166 (E-035): `users.balance` is DECIMAL(10,2) and the debit and the credit
 * round independently, so an amount with a third decimal place (0.015, 1.005)
 * debited the donor 0.01 and credited the recipient 0.02 — credits minted from
 * nothing. Every donation / community-fund path must refuse sub-cent amounts,
 * and an exchange whose confirmed hours average to a sub-cent figure must move
 * the SAME rounded amount on both sides.
 */
class SubCentCreditMintTest extends TestCase
{
    use DatabaseTransactions;
    use CreatesExchangeData;

    private function balance(int $userId): string
    {
        return (string) DB::table('users')->where('id', $userId)->value('balance');
    }

    private function fundBalance(): string
    {
        $fund = TenantContext::runForTenant($this->testTenantId, fn () => CommunityFundService::getBalance());

        return number_format((float) $fund['balance'], 2, '.', '');
    }

    public static function subCentAmounts(): array
    {
        return ['0.015' => [0.015], '1.005' => [1.005]];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('subCentAmounts')]
    public function test_member_donation_with_sub_cent_amount_is_refused(float $amount): void
    {
        Cache::flush();
        $donor = User::factory()->forTenant($this->testTenantId)->create(['balance' => 10]);
        $recipient = User::factory()->forTenant($this->testTenantId)->create(['balance' => 0]);
        Sanctum::actingAs($donor);

        $r = $this->apiPost('/v2/wallet/donate', [
            'recipient_type' => 'user',
            'recipient_id' => $recipient->id,
            'amount' => $amount,
            'idempotency_key' => 'f166-' . uniqid(),
        ]);

        $this->assertSame(400, $r->getStatusCode(), (string) $r->getContent());
        $this->assertSame('10.00', $this->balance((int) $donor->id));
        $this->assertSame('0.00', $this->balance((int) $recipient->id));
        $this->assertSame(0, DB::table('transactions')->where('receiver_id', $recipient->id)->count());
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('subCentAmounts')]
    public function test_community_fund_donation_with_sub_cent_amount_is_refused(float $amount): void
    {
        Cache::flush();
        $donor = User::factory()->forTenant($this->testTenantId)->create(['balance' => 10]);
        Sanctum::actingAs($donor);
        $fundBefore = $this->fundBalance();

        $viaFundRoute = $this->apiPost('/v2/wallet/community-fund/donate', ['amount' => $amount]);
        $this->assertSame(400, $viaFundRoute->getStatusCode(), (string) $viaFundRoute->getContent());

        Cache::flush();
        $viaDonateRoute = $this->apiPost('/v2/wallet/donate', [
            'recipient_type' => 'community_fund',
            'amount' => $amount,
            'idempotency_key' => 'f166-fund-' . uniqid(),
        ]);
        $this->assertSame(400, $viaDonateRoute->getStatusCode(), (string) $viaDonateRoute->getContent());

        $this->assertSame('10.00', $this->balance((int) $donor->id));
        $this->assertSame($fundBefore, $this->fundBalance());
    }

    public function test_service_layer_refuses_sub_cent_amounts_on_every_fund_path(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['balance' => 10]);
        $member = User::factory()->forTenant($this->testTenantId)->create(['balance' => 10]);

        TenantContext::runForTenant($this->testTenantId, function () use ($admin, $member) {
            CommunityFundService::adminDeposit((int) $admin->id, 5.00, 'seed');
            $fundBefore = $this->fundBalance();

            $this->assertFalse(CommunityFundService::adminDeposit((int) $admin->id, 0.015)['success']);
            $this->assertFalse(CommunityFundService::adminWithdraw((int) $admin->id, (int) $member->id, 1.005)['success']);
            $this->assertFalse(CommunityFundService::receiveDonation((int) $member->id, 0.015)['success']);

            $service = app(\App\Services\CreditDonationService::class);
            $this->assertFalse($service->donate($this->testTenantId, (int) $member->id, (int) $admin->id, 0.015));

            $this->assertSame($fundBefore, $this->fundBalance());
        });

        $this->assertSame('10.00', $this->balance((int) $member->id));
        $this->assertSame('10.00', $this->balance((int) $admin->id));
    }

    public function test_control_whole_cent_donation_still_works(): void
    {
        Cache::flush();
        $donor = User::factory()->forTenant($this->testTenantId)->create(['balance' => 10]);
        $recipient = User::factory()->forTenant($this->testTenantId)->create(['balance' => 0]);
        Sanctum::actingAs($donor);

        $r = $this->apiPost('/v2/wallet/donate', [
            'recipient_type' => 'user',
            'recipient_id' => $recipient->id,
            'amount' => 1.00,
            'idempotency_key' => 'f166-ctrl-' . uniqid(),
        ]);

        $this->assertSame(201, $r->getStatusCode(), (string) $r->getContent());
        $this->assertSame('9.00', $this->balance((int) $donor->id));
        $this->assertSame('1.00', $this->balance((int) $recipient->id));

        Cache::flush();
        $cents = $this->apiPost('/v2/wallet/donate', [
            'recipient_type' => 'user',
            'recipient_id' => $recipient->id,
            'amount' => 0.25,
            'idempotency_key' => 'f166-ctrl2-' . uniqid(),
        ]);
        $this->assertSame(201, $cents->getStatusCode(), (string) $cents->getContent());
        $this->assertSame('8.75', $this->balance((int) $donor->id));
        $this->assertSame('1.25', $this->balance((int) $recipient->id));
    }

    public function test_exchange_with_averaged_sub_cent_hours_moves_identical_amounts(): void
    {
        BrokerControlConfigService::updateConfig(['exchange_workflow_enabled' => true]);

        $s = $this->createExchangeScenario([
            'provider'  => ['balance' => 10, 'status' => 'active', 'is_approved' => true],
            'requester' => ['balance' => 10, 'status' => 'active', 'is_approved' => true],
            'listing'   => ['type' => 'offer'],
            'exchange'  => [
                'status'         => ExchangeWorkflowService::STATUS_IN_PROGRESS,
                'proposed_hours' => 1.00,
            ],
        ]);
        $tid = $this->testTenantId;
        DB::table('users')->whereIn('id', [$s['provider']->id, $s['requester']->id])->update(['tenant_id' => $tid]);
        DB::table('listings')->where('id', $s['listing']->id)->update(['tenant_id' => $tid, 'type' => 'offer']);
        DB::table('exchange_requests')->where('id', $s['exchange']->id)->update(['tenant_id' => $tid]);

        $exchangeId = (int) $s['exchange']->id;
        $providerId = (int) $s['provider']->id;
        $requesterId = (int) $s['requester']->id;

        $this->assertTrue(TenantContext::runForTenant($tid, fn () =>
            ExchangeWorkflowService::confirmCompletion($exchangeId, $providerId, 1.01)));
        $this->assertTrue(TenantContext::runForTenant($tid, fn () =>
            ExchangeWorkflowService::confirmCompletion($exchangeId, $requesterId, 1.00)));

        $this->assertSame(
            ExchangeWorkflowService::STATUS_COMPLETED,
            (string) DB::table('exchange_requests')->where('id', $exchangeId)->value('status')
        );

        $earned = round((float) $this->balance($providerId) - 10, 2);
        $paid = round(10 - (float) $this->balance($requesterId), 2);

        $this->assertSame($paid, $earned, "payer debited $paid but payee credited $earned — credits minted or destroyed");

        $txAmount = (float) DB::table('transactions')->where('tenant_id', $tid)
            ->where('sender_id', $requesterId)->where('receiver_id', $providerId)->value('amount');
        $this->assertSame($earned, round($txAmount, 2), 'ledger row disagrees with the balance movement');
    }
}
