<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\StripeDonationService;
use App\Services\VolunteerDonationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Stripe\ApiRequestor;
use Stripe\HttpClient\ClientInterface;
use Tests\Laravel\TestCase;

/**
 * Every gift's journey is in the fundraising history exactly once per real
 * state change — even when Stripe repeats an event, or when the admin Refund
 * button and Stripe's own charge.refunded both report the same refund — and
 * every PaymentIntent and platform refund carries the platform donation
 * number, so a Stripe record can be traced back to its donation.
 *
 * @covers \App\Services\StripeDonationService
 * @covers \App\Services\VolunteerDonationService
 */
class FundraisingDonationHistoryTest extends TestCase
{
    use DatabaseTransactions;

    /** @var array<int, array{method:string,url:string,params:array<string,mixed>}> */
    private array $stripeCalls = [];

    private bool $failPaymentIntents = false;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
    }

    protected function tearDown(): void
    {
        ApiRequestor::setHttpClient(null);
        parent::tearDown();
    }

    private function makeOrganisation(string $name): int
    {
        return (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => 1,
            'name' => $name,
            'slug' => 'history-org-' . uniqid(),
            'status' => 'approved',
            'created_at' => now(),
        ]);
    }

    private function makeCampaign(?int $organisationId): int
    {
        return (int) DB::table('vol_giving_days')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'title' => 'History appeal',
            'start_date' => now()->subDay()->toDateString(),
            'end_date' => now()->addWeek()->toDateString(),
            'goal_amount' => 1000,
            'raised_amount' => 0,
            'is_active' => 1,
            'organization_id' => $organisationId,
            'created_by' => 1,
            'created_at' => now(),
        ]);
    }

    /** Route every Stripe API call to an in-memory fake and record it. */
    private function fakeStripe(): void
    {
        config(['services.stripe.secret' => 'sk_test_history_fake']);
        $calls = &$this->stripeCalls;
        $fail = &$this->failPaymentIntents;

        ApiRequestor::setHttpClient(new class ($calls, $fail) implements ClientInterface {
            /** @param array<int, mixed> $calls */
            public function __construct(private array &$calls, private bool &$fail)
            {
            }

            public function request($method, $absUrl, $headers, $params, $hasFile, $apiMode = 'v1')
            {
                $this->calls[] = ['method' => strtolower($method), 'url' => $absUrl, 'params' => $params];

                if (str_contains($absUrl, '/v1/customers')) {
                    $body = ['id' => 'cus_history_fake', 'object' => 'customer'];
                } elseif (str_contains($absUrl, '/v1/payment_intents')) {
                    if ($this->fail) {
                        return [json_encode(['error' => ['message' => 'card_declined', 'type' => 'card_error']]), 402, []];
                    }
                    $id = 'pi_history_' . count($this->calls) . '_' . bin2hex(random_bytes(4));
                    $body = ['id' => $id, 'object' => 'payment_intent', 'client_secret' => $id . '_secret_fake'];
                } elseif (str_contains($absUrl, '/v1/refunds')) {
                    $body = ['id' => 'rf_fake_1', 'object' => 'refund'];
                } else {
                    return [json_encode(['error' => ['message' => 'unexpected call ' . $absUrl]]), 400, []];
                }

                return [json_encode($body), 200, []];
            }
        });
    }

    /** @return array<string, mixed> */
    private function capturedPaymentIntent(): array
    {
        $intents = array_values(array_filter(
            $this->stripeCalls,
            fn ($call) => $call['method'] === 'post' && str_ends_with($call['url'], '/v1/payment_intents'),
        ));
        $this->assertCount(1, $intents, 'exactly one PaymentIntent should have been created');

        return $intents[0]['params'];
    }

    /** @return array<int, string> */
    private function events(int $donationId): array
    {
        return DB::table('vol_fundraising_events')
            ->where('tenant_id', $this->testTenantId)
            ->where('donation_id', $donationId)
            ->orderBy('id')
            ->pluck('event')
            ->all();
    }

    /** @return array{client_secret:string,donation_id:int} */
    private function checkout(int $campaignId): array
    {
        $this->fakeStripe();
        $user = User::factory()->forTenant($this->testTenantId)->create();

        return StripeDonationService::createPaymentIntent($user->id, $this->testTenantId, [
            'amount' => 25,
            'giving_day_id' => $campaignId,
        ]);
    }

    private function intentId(int $donationId): string
    {
        return (string) DB::table('vol_donations')->where('id', $donationId)->value('stripe_payment_intent_id');
    }

    private function pi(string $id, int $donationId = 0): object
    {
        return (object) [
            'id' => $id,
            'metadata' => (object) array_filter([
                'nexus_tenant_id' => (string) $this->testTenantId,
                'nexus_donation_id' => $donationId ? (string) $donationId : null,
            ]),
        ];
    }

    private function charge(string $piId, int $refunded, array $metadata = []): object
    {
        return (object) [
            'id' => 'ch_history_1',
            'payment_intent' => $piId,
            'amount' => 2500,
            'amount_refunded' => $refunded,
            'currency' => 'eur',
            'metadata' => (object) ($metadata ?: ['nexus_tenant_id' => (string) $this->testTenantId]),
        ];
    }

    public function test_stripe_carries_the_platform_donation_number(): void
    {
        $result = $this->checkout($this->makeCampaign($this->makeOrganisation('Food Bank')));

        $params = $this->capturedPaymentIntent();
        $this->assertSame((string) $result['donation_id'], $params['metadata']['nexus_donation_id']);
        $this->assertNotSame('', $this->intentId($result['donation_id']));
        $this->assertSame(['donation_started'], $this->events($result['donation_id']));
    }

    public function test_a_refused_payment_start_leaves_a_failed_row_and_a_history_entry(): void
    {
        $campaign = $this->makeCampaign(null);
        $this->failPaymentIntents = true;

        try {
            $this->checkout($campaign);
            $this->fail('expected RuntimeException');
        } catch (\RuntimeException) {
        }

        $row = DB::table('vol_donations')->where('giving_day_id', $campaign)->orderByDesc('id')->first();
        $this->assertNotNull($row, 'the attempt is kept, so the history has a gift to refer to');
        $this->assertSame('failed', $row->status);
        $this->assertSame(['donation_started', 'donation_payment_not_started'], $this->events((int) $row->id));
    }

    public function test_payment_success_is_recorded_once_even_if_stripe_repeats_it(): void
    {
        $result = $this->checkout($this->makeCampaign(null));
        $piId = $this->intentId($result['donation_id']);

        StripeDonationService::handlePaymentSucceeded($this->pi($piId));
        StripeDonationService::handlePaymentSucceeded($this->pi($piId));

        $this->assertSame(['donation_started', 'donation_paid'], $this->events($result['donation_id']));
        $paid = DB::table('vol_fundraising_events')->where('donation_id', $result['donation_id'])
            ->where('event', 'donation_paid')->first();
        $this->assertSame('stripe', $paid->actor_kind);
        $this->assertSame($piId, $paid->stripe_object_id);
        $this->assertSame(25.0, (float) $paid->amount);
    }

    public function test_success_arriving_before_the_intent_id_was_saved_still_completes(): void
    {
        $result = $this->checkout($this->makeCampaign(null));
        DB::table('vol_donations')->where('id', $result['donation_id'])->update(['stripe_payment_intent_id' => null]);

        StripeDonationService::handlePaymentSucceeded($this->pi('pi_early_1', $result['donation_id']));

        $row = DB::table('vol_donations')->find($result['donation_id']);
        $this->assertSame('completed', $row->status);
        $this->assertSame('pi_early_1', $row->stripe_payment_intent_id);
    }

    public function test_the_donation_number_cannot_claim_a_row_that_already_has_an_intent(): void
    {
        $result = $this->checkout($this->makeCampaign(null));
        $original = $this->intentId($result['donation_id']);

        StripeDonationService::handlePaymentSucceeded($this->pi('pi_impostor_1', $result['donation_id']));

        $row = DB::table('vol_donations')->find($result['donation_id']);
        $this->assertSame('pending', $row->status);
        $this->assertSame($original, $row->stripe_payment_intent_id);
    }

    public function test_failed_payment_is_recorded(): void
    {
        $result = $this->checkout($this->makeCampaign(null));

        StripeDonationService::handlePaymentFailed($this->pi($this->intentId($result['donation_id'])));
        StripeDonationService::handlePaymentFailed($this->pi($this->intentId($result['donation_id'])));

        $this->assertSame(['donation_started', 'donation_failed'], $this->events($result['donation_id']));
    }

    public function test_partial_then_full_refund_are_each_recorded_once(): void
    {
        $result = $this->checkout($this->makeCampaign(null));
        $piId = $this->intentId($result['donation_id']);
        StripeDonationService::handlePaymentSucceeded($this->pi($piId));

        StripeDonationService::handleChargeRefunded($this->charge($piId, 1000));
        StripeDonationService::handleChargeRefunded($this->charge($piId, 1000)); // replay
        StripeDonationService::handleChargeRefunded($this->charge($piId, 2500));

        $this->assertSame(
            ['donation_started', 'donation_paid', 'donation_partially_refunded', 'donation_refunded'],
            $this->events($result['donation_id']),
        );
        $partial = DB::table('vol_fundraising_events')->where('donation_id', $result['donation_id'])
            ->where('event', 'donation_partially_refunded')->first();
        $this->assertSame(10.0, (float) $partial->amount);
        $full = DB::table('vol_fundraising_events')->where('donation_id', $result['donation_id'])
            ->where('event', 'donation_refunded')->first();
        $this->assertSame(15.0, (float) $full->amount, 'only the remainder is reversed by the final refund');
    }

    public function test_admin_refund_names_the_admin_and_tells_stripe_which_donation(): void
    {
        $result = $this->checkout($this->makeCampaign($this->makeOrganisation('Food Bank')));
        $piId = $this->intentId($result['donation_id']);
        StripeDonationService::handlePaymentSucceeded($this->pi($piId));

        StripeDonationService::createRefund($result['donation_id'], $this->testTenantId, 77);
        // Stripe's own webhook for the same refund then arrives.
        StripeDonationService::handleChargeRefunded($this->charge($piId, 2500, ['other' => 'x']));

        $this->assertSame(
            ['donation_started', 'donation_paid', 'donation_refund_requested', 'donation_refunded'],
            $this->events($result['donation_id']),
        );
        $requested = DB::table('vol_fundraising_events')->where('donation_id', $result['donation_id'])
            ->where('event', 'donation_refund_requested')->first();
        $this->assertSame(77, (int) $requested->actor_user_id);
        $this->assertSame('community_admin', $requested->actor_kind);
        $this->assertSame('rf_fake_1', $requested->stripe_object_id);

        $refundCall = collect($this->stripeCalls)->first(fn ($c) => str_ends_with($c['url'], '/v1/refunds'));
        $this->assertSame((string) $result['donation_id'], $refundCall['params']['metadata']['nexus_donation_id']);
        $this->assertSame('77', $refundCall['params']['metadata']['nexus_refunded_by_user_id']);
    }

    public function test_pledge_and_its_receipt_by_an_admin_are_recorded(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();
        $campaign = $this->makeCampaign($this->makeOrganisation('Food Bank'));

        $pledge = VolunteerDonationService::createDonation($user->id, [
            'amount' => 15,
            'giving_day_id' => $campaign,
            'payment_method' => 'bank_transfer',
            'payment_reference' => 'P-1',
        ]);
        VolunteerDonationService::markCompleted((int) $pledge['id'], $this->testTenantId, 55);
        VolunteerDonationService::markCompleted((int) $pledge['id'], $this->testTenantId, 55); // repeat click

        $this->assertSame(['donation_started', 'donation_paid'], $this->events((int) $pledge['id']));
        $started = DB::table('vol_fundraising_events')->where('donation_id', $pledge['id'])
            ->where('event', 'donation_started')->first();
        $this->assertSame('member', $started->actor_kind);
        $this->assertSame((int) $user->id, (int) $started->actor_user_id);
        $this->assertNotNull($started->organization_id);
        $paid = DB::table('vol_fundraising_events')->where('donation_id', $pledge['id'])
            ->where('event', 'donation_paid')->first();
        $this->assertSame('community_admin', $paid->actor_kind);
        $this->assertSame(55, (int) $paid->actor_user_id);
    }
}
