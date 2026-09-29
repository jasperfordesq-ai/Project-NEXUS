<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services;

use App\Exceptions\StripeMoneyOperationUnresolvedException;
use App\Services\StripeMoneyOperationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-283 — the rules of the durable Stripe money-operation record, one at a
 * time. The end-to-end journeys (payout, refund, dispute) are in
 * tests/Laravel/Feature/Marketplace/StripeMoneyMovementRetryTest.php.
 */
final class StripeMoneyOperationServiceTest extends TestCase
{
    use DatabaseTransactions;

    private int $sends = 0;
    private int $finds = 0;

    private function perform(string $key, callable $send, callable $find, int $subjectId = 1): string
    {
        return StripeMoneyOperationService::perform(
            $this->testTenantId,
            $key,
            'test_movement',
            'test_subject',
            $subjectId,
            500,
            'eur',
            function (string $k) use ($send): string {
                $this->sends++;

                return $send($k);
            },
            function (string $k) use ($find): ?string {
                $this->finds++;

                return $find($k);
            },
        );
    }

    private function operationStatus(string $key): ?string
    {
        $value = DB::table('stripe_money_operations')->where('operation_key', $key)->value('status');

        return $value === null ? null : (string) $value;
    }

    private static function stripeError(int $status, string $type = 'api_error'): \Stripe\Exception\ApiErrorException
    {
        $body = ['error' => ['type' => $type, 'message' => "simulated {$status}"]];
        $class = match (true) {
            $type === 'idempotency_error' => \Stripe\Exception\IdempotencyException::class,
            $status === 400, $status === 404 => \Stripe\Exception\InvalidRequestException::class,
            $status === 402 => \Stripe\Exception\CardException::class,
            $status === 429 => \Stripe\Exception\RateLimitException::class,
            default => \Stripe\Exception\UnknownApiErrorException::class,
        };

        return $class::factory("simulated {$status}", $status, json_encode($body), $body);
    }

    public function test_a_success_is_recorded_and_a_repeat_returns_it_without_calling_stripe(): void
    {
        $key = 'test-op-' . uniqid();

        $this->assertSame('obj_1', $this->perform($key, fn () => 'obj_1', fn () => null));
        $this->assertSame('obj_1', $this->perform($key, fn () => 'obj_2', fn () => 'obj_3'));

        $this->assertSame(1, $this->sends);
        $this->assertSame(0, $this->finds);
        $this->assertSame('succeeded', $this->operationStatus($key));
    }

    /** @return iterable<string, array{0:\Throwable}> */
    public static function ambiguousErrors(): iterable
    {
        yield 'no reply' => [new \Stripe\Exception\ApiConnectionException('timeout')];
        yield 'stripe 500' => [self::stripeError(500)];
        yield 'concurrent use of the key (409)' => [self::stripeError(409)];
        yield 'idempotency conflict' => [self::stripeError(400, 'idempotency_error')];
        yield 'our own exception' => [new \RuntimeException('boom')];
    }

    /** @dataProvider ambiguousErrors */
    public function test_an_ambiguous_error_is_unknown_and_the_retry_looks_up_before_sending(\Throwable $error): void
    {
        $key = 'test-op-' . uniqid();
        try {
            $this->perform($key, fn () => throw $error, fn () => null);
            $this->fail('an ambiguous outcome must not look like success');
        } catch (StripeMoneyOperationUnresolvedException $e) {
            $this->assertSame($key, $e->operationKey);
        }
        $this->assertSame('unknown', $this->operationStatus($key));

        // Retry: Stripe has it → adopted, nothing re-sent.
        $this->assertSame('obj_found', $this->perform($key, fn () => 'obj_resent', fn () => 'obj_found'));
        $this->assertSame(1, $this->sends, 'the retry must not send');
        $this->assertSame(1, $this->finds);
        $this->assertSame('succeeded', $this->operationStatus($key));
    }

    /** @return iterable<string, array{0:\Throwable}> */
    public static function definiteRefusals(): iterable
    {
        yield 'invalid request (400)' => [self::stripeError(400, 'invalid_request_error')];
        yield 'not found (404)' => [self::stripeError(404, 'invalid_request_error')];
        yield 'card error (402)' => [self::stripeError(402, 'card_error')];
        yield 'rate limited (429)' => [self::stripeError(429, 'invalid_request_error')];
    }

    /** @dataProvider definiteRefusals */
    public function test_a_definite_refusal_is_failed_and_may_be_sent_again(\Throwable $error): void
    {
        $key = 'test-op-' . uniqid();
        try {
            $this->perform($key, fn () => throw $error, fn () => null);
            $this->fail('the refusal must propagate');
        } catch (StripeMoneyOperationUnresolvedException) {
            $this->fail('a definite refusal is not an unknown outcome');
        } catch (\Stripe\Exception\ApiErrorException $e) {
            $this->assertSame($error, $e);
        }
        $this->assertSame('failed', $this->operationStatus($key));

        $this->assertSame('obj_2', $this->perform($key, fn () => 'obj_2', fn () => 'never'));
        $this->assertSame(2, $this->sends);
        $this->assertSame(0, $this->finds, 'a definite failure needs no look-up');
    }

    public function test_a_failed_look_up_never_sends(): void
    {
        $key = 'test-op-' . uniqid();
        try {
            $this->perform($key, fn () => throw new \Stripe\Exception\ApiConnectionException('timeout'), fn () => null);
        } catch (StripeMoneyOperationUnresolvedException) {
        }

        try {
            $this->perform($key, fn () => 'obj_2', fn () => throw new \Stripe\Exception\ApiConnectionException('lookup down'));
            $this->fail('an unanswered look-up must not be read as "absent"');
        } catch (StripeMoneyOperationUnresolvedException) {
        }

        $this->assertSame(1, $this->sends);
        $this->assertSame('unknown', $this->operationStatus($key));
    }

    public function test_a_look_up_that_finds_nothing_sends_once(): void
    {
        $key = 'test-op-' . uniqid();
        try {
            $this->perform($key, fn () => throw new \Stripe\Exception\ApiConnectionException('refused'), fn () => null);
        } catch (StripeMoneyOperationUnresolvedException) {
        }

        $this->assertSame('obj_2', $this->perform($key, fn () => 'obj_2', fn () => null));
        $this->assertSame(2, $this->sends);
        $this->assertSame(1, $this->finds);
        $this->assertSame(2, (int) DB::table('stripe_money_operations')->where('operation_key', $key)->value('attempts'));
    }

    public function test_a_pending_row_left_by_a_crash_is_looked_up_first(): void
    {
        $key = 'test-op-' . uniqid();
        DB::table('stripe_money_operations')->insert([
            'tenant_id' => $this->testTenantId, 'operation_key' => $key, 'kind' => 'test_movement',
            'subject_type' => 'test_subject', 'subject_id' => 1, 'amount_minor' => 500, 'currency' => 'eur',
            'status' => 'pending', 'attempts' => 1, 'created_at' => now()->subDays(2), 'updated_at' => now()->subDays(2),
        ]);

        $this->assertSame('obj_found', $this->perform($key, fn () => 'obj_resent', fn () => 'obj_found'));
        $this->assertSame(0, $this->sends);
    }

    public function test_a_key_reused_for_a_different_movement_sends_nothing(): void
    {
        $key = 'test-op-' . uniqid();
        $this->perform($key, fn () => 'obj_1', fn () => null, 1);

        try {
            $this->perform($key, fn () => 'obj_2', fn () => 'obj_3', 2);
            $this->fail('a key collision must not move money');
        } catch (StripeMoneyOperationUnresolvedException) {
        }
        $this->assertSame(1, $this->sends);
        $this->assertSame(0, $this->finds);
    }

    public function test_a_prior_unrecorded_attempt_is_looked_up_on_the_first_recorded_attempt(): void
    {
        $key = 'test-op-' . uniqid();

        $id = StripeMoneyOperationService::perform(
            $this->testTenantId, $key, 'test_movement', 'test_subject', 1, 500, 'eur',
            function (): string {
                $this->sends++;

                return 'obj_resent';
            },
            fn (): ?string => 'obj_legacy',
            true,
        );

        $this->assertSame('obj_legacy', $id);
        $this->assertSame(0, $this->sends);
    }

    public function test_adopt_settles_an_unresolved_row_and_clears_has_unresolved(): void
    {
        $key = 'test-op-' . uniqid();
        try {
            $this->perform($key, fn () => throw new \Stripe\Exception\ApiConnectionException('timeout'), fn () => null, 7);
        } catch (StripeMoneyOperationUnresolvedException) {
        }
        $this->assertTrue(StripeMoneyOperationService::hasUnresolved($this->testTenantId, 'test_subject', 7, 'test_movement'));
        $this->assertFalse(StripeMoneyOperationService::hasUnresolved($this->testTenantId, 'test_subject', 7, 'test_movement', $key));

        StripeMoneyOperationService::adopt($key, 'obj_from_webhook');

        $this->assertFalse(StripeMoneyOperationService::hasUnresolved($this->testTenantId, 'test_subject', 7, 'test_movement'));
        $this->assertSame('obj_from_webhook', $this->perform($key, fn () => 'obj_2', fn () => 'obj_3', 7));
        $this->assertSame(1, $this->sends);
    }
}
