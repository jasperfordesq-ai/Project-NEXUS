<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Listeners;

use App\Listeners\PushConnectionAcceptedToFederatedPartner;
use App\Listeners\PushMessageToFederatedPartner;
use App\Listeners\PushReviewToFederatedPartner;
use App\Listeners\PushTransactionToFederatedPartner;
use ReflectionMethod;
use Tests\Laravel\TestCase;

/**
 * A push refused by the external federation kill switch must NOT be retried.
 *
 * These four listeners classify a failed push as retryable and throw, so the
 * queue retries it. FederationExternalApiClient reports a switch-blocked call
 * with status_code 0, which the classifier's `status_code === 0 || >= 500` rule
 * treats as a transient fault — so turning the switch off made every queued
 * push throw and retry until its attempts were exhausted, on every event.
 *
 * That is the opposite of the intent: the switch is a deliberate operator
 * state, and disabling federation should be quiet, not a retry storm with an
 * alert per attempt. Asserted by reflection because the classifier is private
 * and building four full event fixtures would test the fixtures, not the rule.
 */
final class BlockedPushIsNotRetriedTest extends TestCase
{
    /** @return array<string, array{0: class-string}> */
    public static function listenerProvider(): array
    {
        return [
            'review' => [PushReviewToFederatedPartner::class],
            'message' => [PushMessageToFederatedPartner::class],
            'transaction' => [PushTransactionToFederatedPartner::class],
            'connection accepted' => [PushConnectionAcceptedToFederatedPartner::class],
        ];
    }

    /**
     * @param class-string $listenerClass
     *
     * @dataProvider listenerProvider
     */
    public function test_blocked_result_is_not_retryable(string $listenerClass): void
    {
        $method = new ReflectionMethod($listenerClass, 'isRetryablePartnerFailure');
        $method->setAccessible(true);

        $listener = app($listenerClass);

        // Exactly what FederationExternalApiClient::request() returns when the
        // external federation kill switch refuses the call.
        $blocked = [
            'success' => false,
            'error' => 'External partner federation is temporarily disabled on this installation.',
            'status_code' => 0,
            'blocked' => true,
        ];

        $this->assertFalse(
            $method->invoke($listener, $blocked),
            $listenerClass . ' would retry a switch-blocked push, causing a retry storm while federation is off',
        );
    }

    /**
     * The blocked short-circuit must not swallow genuine transient failures —
     * a real connection error or 5xx still has to retry.
     *
     * @param class-string $listenerClass
     *
     * @dataProvider listenerProvider
     */
    public function test_genuine_transient_failures_are_still_retryable(string $listenerClass): void
    {
        $method = new ReflectionMethod($listenerClass, 'isRetryablePartnerFailure');
        $method->setAccessible(true);

        $listener = app($listenerClass);

        $this->assertTrue(
            $method->invoke($listener, ['success' => false, 'error' => 'connection refused', 'status_code' => 0]),
            $listenerClass . ' stopped retrying genuine connection failures',
        );
        $this->assertTrue(
            $method->invoke($listener, ['success' => false, 'error' => 'server error', 'status_code' => 503]),
            $listenerClass . ' stopped retrying genuine 5xx failures',
        );
    }
}
