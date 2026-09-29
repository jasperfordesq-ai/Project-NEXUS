<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Volunteering;

use App\Services\StripeDonationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-292 — the admin donation refund was the only money-moving Stripe call with
 * no idempotency key, and its "is it still completed?" check sat outside any
 * claim, so two overlapping admin requests both called Stripe.
 */
final class StripeDonationRefundOnceTest extends TestCase
{
    use DatabaseTransactions;

    /** @var object{requests: array, onPost: ?\Closure} */
    private object $stripe;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.stripe.secret' => 'sk_test_f292_donation_refund']);
        $this->stripe = new class implements \Stripe\HttpClient\ClientInterface {
            /** @var list<array{method:string,path:string,headers:array,params:array}> */
            public array $requests = [];
            public ?\Closure $onPost = null;

            public function request($method, $absUrl, $headers, $params, $hasFile, $apiMode = 'v1'): array
            {
                $this->requests[] = [
                    'method' => strtolower((string) $method),
                    'path' => (string) parse_url((string) $absUrl, PHP_URL_PATH),
                    'headers' => $headers,
                    'params' => is_array($params) ? $params : [],
                ];
                if ($this->onPost !== null) {
                    $hook = $this->onPost;
                    $this->onPost = null; // re-enter at most once
                    $hook();
                }

                return [json_encode([
                    'id' => 're_f292_' . count($this->requests),
                    'object' => 'refund',
                    'status' => 'succeeded',
                ], JSON_THROW_ON_ERROR), 200, []];
            }
        };
        \Stripe\ApiRequestor::setHttpClient($this->stripe);
    }

    protected function tearDown(): void
    {
        \Stripe\ApiRequestor::setHttpClient(null);
        parent::tearDown();
    }

    private function completedDonation(): int
    {
        return (int) DB::table('vol_donations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => 1,
            'amount' => 10.0,
            'currency' => 'EUR',
            'status' => 'completed',
            'payment_method' => 'stripe',
            'payment_reference' => '',
            'stripe_payment_intent_id' => 'pi_f292_' . uniqid(),
            'created_at' => now(),
        ]);
    }

    private function refundPosts(): int
    {
        return count(array_filter(
            $this->stripe->requests,
            static fn (array $r): bool => $r['method'] === 'post' && $r['path'] === '/v1/refunds',
        ));
    }

    public function test_the_refund_carries_a_stable_idempotency_key(): void
    {
        $donationId = $this->completedDonation();

        $result = StripeDonationService::createRefund($donationId, $this->testTenantId);

        $this->assertTrue($result['success']);
        $this->assertSame(1, $this->refundPosts());
        $this->assertContains(
            "Idempotency-Key: vol-donation-refund-{$this->testTenantId}-{$donationId}",
            $this->stripe->requests[0]['headers'],
            'a repeated refund request must be recognisable to Stripe as the same refund',
        );
        $this->assertSame('refunded', DB::table('vol_donations')->where('id', $donationId)->value('status'));
    }

    public function test_an_overlapping_second_refund_request_does_not_call_stripe(): void
    {
        $donationId = $this->completedDonation();
        $second = null;
        // While the first request is waiting on Stripe, a second admin request
        // (double-click, second tab) arrives for the same donation.
        $this->stripe->onPost = function () use ($donationId, &$second): void {
            try {
                StripeDonationService::createRefund($donationId, $this->testTenantId);
                $second = 'succeeded';
            } catch (\RuntimeException $e) {
                $second = 'refused';
            }
        };

        StripeDonationService::createRefund($donationId, $this->testTenantId);

        $this->assertSame(1, $this->refundPosts(), 'only one refund request may reach Stripe');
        $this->assertSame('refused', $second);
        $this->assertSame('refunded', DB::table('vol_donations')->where('id', $donationId)->value('status'));
    }

    public function test_a_refunded_donation_is_not_refunded_again(): void
    {
        $donationId = $this->completedDonation();
        StripeDonationService::createRefund($donationId, $this->testTenantId);

        try {
            StripeDonationService::createRefund($donationId, $this->testTenantId);
            $this->fail('a refunded donation must not be refunded again');
        } catch (\RuntimeException) {
        }

        $this->assertSame(1, $this->refundPosts());
    }
}
