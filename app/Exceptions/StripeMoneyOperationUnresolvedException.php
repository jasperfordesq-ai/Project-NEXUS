<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Exceptions;

/**
 * A Stripe call that moves money has an outcome nobody can vouch for yet.
 *
 * Thrown by StripeMoneyOperationService when the request may have reached
 * Stripe but no reply came back (connection error, timeout, 5xx), or when a
 * look-up in Stripe to settle an earlier such attempt could not be completed.
 * The operation stays recorded as `unknown`; the next attempt looks it up in
 * Stripe before anything is sent again.
 *
 * 🔴 A caller must NOT treat this as "the money did not move". It may have.
 * In particular a payout must not be marked `failed` on this exception —
 * `failed` is freely re-claimable and was the route to a duplicate transfer
 * (F-283).
 *
 * Extends RuntimeException so existing `catch (\RuntimeException)` callers keep
 * failing closed.
 */
class StripeMoneyOperationUnresolvedException extends \RuntimeException
{
    public function __construct(
        public readonly string $operationKey,
        string $message = '',
        ?\Throwable $previous = null,
    ) {
        parent::__construct($message !== '' ? $message : (string) __('api.stripe_money_operation_unconfirmed'), 0, $previous);
    }
}
