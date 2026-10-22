<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Integration;

use App\Core\TenantContext;
use App\Models\Transaction;
use App\Services\ExchangeWorkflowService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;
use Tests\Laravel\Traits\CreatesExchangeData;

/**
 * Regression: time-credit direction on exchange completion must follow the
 * SERVICE direction, which depends on the listing type — not always
 * requester → provider.
 *
 *   - offer   listing: the listing owner (provider) does the work, the
 *       responder (requester) receives it → requester pays provider.
 *   - request listing: the listing owner asked for help, the responder
 *       (requester) does the work → provider (help-seeker) pays requester.
 *
 * The bug: createTransaction always transferred requester → provider, so on a
 * request-type listing the helper was charged and the help-seeker credited —
 * the credit moved backwards. (Found by walking the live exchange loop: a
 * request-listing exchange moved 1 credit from the helper to the help-seeker.)
 */
class ExchangeCreditDirectionTest extends TestCase
{
    use DatabaseTransactions;
    use CreatesExchangeData;

    /**
     * @return array{0: \App\Models\User, 1: \App\Models\User, 2: \App\Models\ExchangeRequest}
     */
    private function scenario(string $listingType): array
    {
        $s = $this->createExchangeScenario([
            'provider'  => ['balance' => 10, 'status' => 'active', 'is_approved' => true],
            'requester' => ['balance' => 10, 'status' => 'active', 'is_approved' => true],
            'listing'   => ['type' => $listingType],
            'exchange'  => [
                'status'         => ExchangeWorkflowService::STATUS_IN_PROGRESS,
                'proposed_hours' => 2.00,
            ],
        ]);

        // Console factory/observer interplay can drift TenantContext and leave
        // rows under the wrong tenant. Normalise every row to the test tenant so
        // the tenant-scoped lookups inside the workflow resolve consistently.
        $tid = $this->testTenantId;
        DB::table('users')->whereIn('id', [$s['provider']->id, $s['requester']->id])->update(['tenant_id' => $tid]);
        DB::table('listings')->where('id', $s['listing']->id)->update(['tenant_id' => $tid, 'type' => $listingType]);
        DB::table('exchange_requests')->where('id', $s['exchange']->id)->update(['tenant_id' => $tid]);

        return [$s['provider'], $s['requester'], $s['exchange']];
    }

    /**
     * Pin the test tenant for the duration of the service call. Tests run in the
     * console, where model observers can drift TenantContext to the default
     * tenant — which would make the tenant-scoped exchange/payer lookups miss.
     */
    private function confirm(int $exchangeId, int $userId, float $hours): bool
    {
        return TenantContext::runForTenant($this->testTenantId, fn () =>
            ExchangeWorkflowService::confirmCompletion($exchangeId, $userId, $hours));
    }

    public function test_request_listing_owner_pays_the_responder(): void
    {
        // Listing owner (provider) ASKED for help; responder (requester) provides it.
        [$provider, $requester, $exchange] = $this->scenario('request');

        // Both confirm 2h; the second confirmation triggers the credit transfer.
        $this->assertTrue($this->confirm($exchange->id, (int) $provider->id, 2.00));
        $this->assertTrue($this->confirm($exchange->id, (int) $requester->id, 2.00));

        TenantContext::setById($this->testTenantId);
        $provider->refresh();
        $requester->refresh();

        $this->assertEqualsWithDelta(8, (float) $provider->balance, 0.001, 'request-listing owner (help-seeker) must PAY 2');
        $this->assertEqualsWithDelta(12, (float) $requester->balance, 0.001, 'request-listing responder (helper) must EARN 2');

        $tx = Transaction::where('tenant_id', $this->testTenantId)->latest('id')->first();
        $this->assertNotNull($tx);
        $this->assertSame((int) $provider->id, (int) $tx->sender_id, 'help-seeker is the payer (sender)');
        $this->assertSame((int) $requester->id, (int) $tx->receiver_id, 'helper is the payee (receiver)');
    }

    public function test_offer_listing_requester_pays_the_provider(): void
    {
        // Regression guard for the unchanged (correct) offer direction.
        [$provider, $requester, $exchange] = $this->scenario('offer');

        $this->assertTrue($this->confirm($exchange->id, (int) $provider->id, 2.00));
        $this->assertTrue($this->confirm($exchange->id, (int) $requester->id, 2.00));

        TenantContext::setById($this->testTenantId);
        $provider->refresh();
        $requester->refresh();

        $this->assertEqualsWithDelta(12, (float) $provider->balance, 0.001, 'offer-listing provider (worker) must EARN 2');
        $this->assertEqualsWithDelta(8, (float) $requester->balance, 0.001, 'offer-listing requester (recipient) must PAY 2');

        $tx = Transaction::where('tenant_id', $this->testTenantId)->latest('id')->first();
        $this->assertNotNull($tx);
        $this->assertSame((int) $requester->id, (int) $tx->sender_id, 'recipient is the payer (sender)');
        $this->assertSame((int) $provider->id, (int) $tx->receiver_id, 'worker is the payee (receiver)');
    }
}
