<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\Payments;

use App\Services\Identity\IdentityVerificationPaymentService;
use App\Services\StripeDonationService;
use App\Services\StripeService;
use App\Services\Verein\VereinDuesService;
use Illuminate\Support\Facades\Log;

/**
 * Stripe-hosted payment pages (Checkout Sessions) for one-off payments that the
 * website takes with an embedded card form (Stripe.js + PaymentIntent).
 *
 * WHY: the accessible frontend works without JavaScript, and confirming a
 * PaymentIntent needs Stripe.js. A Checkout Session is a page on Stripe: the
 * member is redirected there, pays, and is sent back. Owner decision, 26 Oct
 * 2026: the accessible site must take the same payments as the website, for
 * the identity-verification fee, volunteering donations and club dues.
 *
 * HOW IT STAYS SAFE:
 *  - Paid-ness is NEVER decided here. A Checkout Session in payment mode
 *    creates a PaymentIntent; the same nexus_* metadata the card form uses is
 *    copied onto it (`payment_intent_data.metadata`), so Stripe's
 *    `payment_intent.succeeded` reaches the existing, tested success handlers.
 *    Those find their record from the metadata number when the intent id is
 *    not yet stored (the intent only exists once the member pays).
 *  - `checkout.session.completed` only LINKS the intent id to the record, and
 *    `checkout.session.expired` closes a record that was never paid.
 *  - Card only (`payment_method_types`), so payment is synchronous: no
 *    "completed but unpaid" sessions to reason about.
 *  - Amount and currency always come from the caller's own database row.
 *  - An open session is reused rather than a second one created, and callers
 *    expire it before the card form is used, so one record cannot be paid twice.
 *
 * Modelled on MarketplacePaymentService::createCheckoutSession().
 */
final class HostedCheckoutService
{
    public const KIND_IDENTITY_FEE = 'identity_fee';
    public const KIND_DONATION = 'donation';
    public const KIND_VEREIN_DUES = 'verein_dues';

    public const KINDS = [self::KIND_IDENTITY_FEE, self::KIND_DONATION, self::KIND_VEREIN_DUES];

    /** Stripe requires expires_at to be at least 30 minutes away; keep a margin. */
    private const EXPIRES_IN_SECONDS = 35 * 60;

    /** An open session with less than this left is replaced, not reused. */
    private const REUSE_MIN_REMAINING_SECONDS = 5 * 60;

    /**
     * Create a hosted payment page.
     *
     * @param array{
     *   kind:string,
     *   amount_minor:int,
     *   currency:string,
     *   name:string,
     *   description?:string,
     *   metadata:array<string,string>,
     *   customer?:?string,
     *   customer_email?:?string,
     *   stripe_account?:?string,
     *   success_url:string,
     *   cancel_url:string,
     *   idempotency_key:string,
     *   client_reference_id?:string,
     * } $o
     * @return object Stripe Checkout Session (id, url, expires_at …)
     */
    public static function create(array $o): object
    {
        if (!in_array($o['kind'], self::KINDS, true)) {
            throw new \InvalidArgumentException('Unknown hosted checkout kind.');
        }
        if ((int) $o['amount_minor'] <= 0) {
            throw new \InvalidArgumentException('Amount must be greater than 0.');
        }
        $currency = strtolower(trim($o['currency']));
        if (strlen($currency) !== 3) {
            throw new \InvalidArgumentException('Currency must be a 3-letter ISO code.');
        }

        $metadata = array_map('strval', $o['metadata']);
        $metadata['nexus_checkout_kind'] = $o['kind'];

        $paymentIntentData = ['metadata' => $metadata];
        if (!empty($o['description'])) {
            $paymentIntentData['description'] = mb_substr((string) $o['description'], 0, 1000);
        }

        $params = [
            'mode' => 'payment',
            'payment_method_types' => ['card'],
            'line_items' => [[
                'quantity' => 1,
                'price_data' => [
                    'currency' => $currency,
                    'unit_amount' => (int) $o['amount_minor'],
                    'product_data' => ['name' => mb_substr($o['name'], 0, 250)],
                ],
            ]],
            'payment_intent_data' => $paymentIntentData,
            'metadata' => $metadata,
            'expires_at' => time() + self::EXPIRES_IN_SECONDS,
            'success_url' => $o['success_url'],
            'cancel_url' => $o['cancel_url'],
            'locale' => 'auto',
        ];
        if (!empty($o['client_reference_id'])) {
            $params['client_reference_id'] = mb_substr((string) $o['client_reference_id'], 0, 200);
        }
        if (!empty($o['customer'])) {
            $params['customer'] = $o['customer'];
        } elseif (!empty($o['customer_email'])) {
            $params['customer_email'] = $o['customer_email'];
        }

        $options = ['idempotency_key' => $o['idempotency_key']];
        if (!empty($o['stripe_account'])) {
            $options['stripe_account'] = $o['stripe_account'];
        }

        return StripeService::client()->checkout->sessions->create($params, $options);
    }

    /**
     * The URL of an existing session when it is still open, for the same amount
     * and currency, with time left — so a member who goes back and presses Pay
     * again returns to the same page instead of opening a second one. An open
     * session that no longer matches is expired so it can never be paid.
     */
    public static function reusableUrl(
        ?string $sessionId,
        int $amountMinor,
        string $currency,
        ?string $stripeAccount = null,
    ): ?string {
        if ($sessionId === null || $sessionId === '') {
            return null;
        }

        $session = self::retrieve($sessionId, $stripeAccount);
        if ($session === null || (string) ($session->status ?? '') !== 'open') {
            return null;
        }

        $matches = (int) ($session->amount_total ?? -1) === $amountMinor
            && strtolower((string) ($session->currency ?? '')) === strtolower($currency)
            && (int) ($session->expires_at ?? 0) > time() + self::REUSE_MIN_REMAINING_SECONDS;

        if ($matches && !empty($session->url)) {
            return (string) $session->url;
        }

        self::expireIfOpen($sessionId, $stripeAccount);

        return null;
    }

    /** Retrieve a session, or null when Stripe cannot find it or is unreachable. */
    public static function retrieve(string $sessionId, ?string $stripeAccount = null): ?object
    {
        try {
            return StripeService::client()->checkout->sessions->retrieve(
                $sessionId,
                [],
                $stripeAccount ? ['stripe_account' => $stripeAccount] : []
            );
        } catch (\Throwable $e) {
            Log::warning('HostedCheckout: could not retrieve session', [
                'session_id' => $sessionId,
                'error' => $e->getMessage(),
            ]);
            return null;
        }
    }

    /**
     * Expire a session if it is still open, so it can no longer be paid.
     * Returns false only when an open session could not be expired — callers
     * that are about to offer another way to pay must then refuse.
     */
    public static function expireIfOpen(?string $sessionId, ?string $stripeAccount = null): bool
    {
        if ($sessionId === null || $sessionId === '') {
            return true;
        }
        $session = self::retrieve($sessionId, $stripeAccount);
        if ($session === null) {
            return false;
        }
        if ((string) ($session->status ?? '') !== 'open') {
            return true;
        }
        try {
            StripeService::client()->checkout->sessions->expire(
                $sessionId,
                [],
                $stripeAccount ? ['stripe_account' => $stripeAccount] : []
            );
            return true;
        } catch (\Throwable $e) {
            Log::warning('HostedCheckout: could not expire session', [
                'session_id' => $sessionId,
                'error' => $e->getMessage(),
            ]);
            return false;
        }
    }

    /** The payment intent id a session carries (string or expanded object). */
    public static function paymentIntentId(object $session): ?string
    {
        $pi = $session->payment_intent ?? null;
        if (is_string($pi) && $pi !== '') {
            return $pi;
        }
        if (is_object($pi) && !empty($pi->id)) {
            return (string) $pi->id;
        }
        return null;
    }

    /** Whether a Checkout Session event belongs to one of these flows. */
    public static function owns(object $session): bool
    {
        $kind = (string) ($session->metadata->nexus_checkout_kind ?? '');
        return in_array($kind, self::KINDS, true);
    }

    /**
     * checkout.session.completed / checkout.session.expired for these flows.
     * Records are found by the session id, which Stripe issued and we stored —
     * never by metadata alone.
     */
    public static function handleWebhookEvent(string $eventType, object $session): void
    {
        $kind = (string) ($session->metadata->nexus_checkout_kind ?? '');
        $sessionId = (string) ($session->id ?? '');
        if ($sessionId === '' || !in_array($kind, self::KINDS, true)) {
            return;
        }

        if ($eventType === 'checkout.session.completed') {
            $piId = self::paymentIntentId($session);
            if ($piId === null) {
                Log::warning('HostedCheckout: completed session without a payment intent', [
                    'session_id' => $sessionId,
                    'kind' => $kind,
                ]);
                return;
            }
            match ($kind) {
                self::KIND_IDENTITY_FEE => IdentityVerificationPaymentService::linkCheckoutPaymentIntent($sessionId, $piId),
                self::KIND_DONATION => StripeDonationService::linkCheckoutPaymentIntent($sessionId, $piId),
                self::KIND_VEREIN_DUES => VereinDuesService::linkCheckoutPaymentIntent($sessionId, $piId),
            };
            return;
        }

        if ($eventType === 'checkout.session.expired') {
            match ($kind) {
                self::KIND_IDENTITY_FEE => IdentityVerificationPaymentService::handleCheckoutExpired($sessionId),
                self::KIND_DONATION => StripeDonationService::handleCheckoutExpired($sessionId),
                self::KIND_VEREIN_DUES => VereinDuesService::handleCheckoutExpired($sessionId),
            };
        }
    }
}
