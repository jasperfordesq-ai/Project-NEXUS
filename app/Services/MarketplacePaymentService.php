<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\EmailTemplateBuilder;
use App\Core\Mailer;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\MarketplaceEscrow;
use App\Models\MarketplaceOrder;
use App\Models\MarketplacePayment;
use App\Models\MarketplaceSellerProfile;
use App\Models\Notification;
use App\Support\StripeCurrency;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Illuminate\Database\QueryException;
use Stripe\PaymentIntent;
use Stripe\StripeClient;

/**
 * MarketplacePaymentService — Stripe Connect integration for the marketplace.
 *
 * Handles: Connect account creation, onboarding, PaymentIntent creation with
 * application fees and transfer_data, payment confirmation, refunds, and
 * webhook event processing.
 *
 * All financial state changes use DB::transaction(). Amounts stored as decimals
 * in the DB and sent as cents (smallest currency unit) to Stripe.
 */
class MarketplacePaymentService
{
    // -----------------------------------------------------------------
    //  Stripe Connect — Account management
    // -----------------------------------------------------------------

    /**
     * Create a Stripe Connect Express account for a seller.
     *
     * @param int $userId Authenticated user ID
     * @return array{account_id: string, onboarding_url: string}
     *
     * @throws \RuntimeException On Stripe API failure or missing seller profile
     */
    public static function createConnectAccount(int $userId): array
    {
        self::assertStripeEnabled();
        $tenantId = TenantContext::getId();

        try {
            return Cache::lock("marketplace-connect-onboarding:{$tenantId}:{$userId}", 180)
                ->block(10, static fn (): array => self::createConnectAccountLocked($tenantId, $userId));
        } catch (\Illuminate\Contracts\Cache\LockTimeoutException $exception) {
            throw new \RuntimeException(
                __('api.marketplace_connect_account_create_failed'),
                previous: $exception,
            );
        }
    }

    /** Create/reuse the provider account while holding the seller onboarding claim. */
    private static function createConnectAccountLocked(int $tenantId, int $userId): array
    {
        // Re-read under a row lock after acquiring the cross-process claim. A
        // retry waiting behind another worker must observe and reuse the account
        // that worker persisted rather than issuing another provider request.
        $sellerProfile = DB::transaction(static fn (): ?MarketplaceSellerProfile =>
            MarketplaceSellerProfile::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('user_id', $userId)
                ->lockForUpdate()
                ->first()
        );

        if (!$sellerProfile) {
            throw new \RuntimeException(__('api.marketplace_payment_seller_profile_required'));
        }

        // If they already have a Connect account, return onboarding link instead
        if (!empty($sellerProfile->stripe_account_id)) {
            $onboardingUrl = self::getOnboardingLink($userId);
            return [
                'account_id' => $sellerProfile->stripe_account_id,
                'onboarding_url' => $onboardingUrl,
            ];
        }

        $user = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->first(['id', 'first_name', 'last_name', 'profile_type', 'organization_name', 'email']);

        if (!$user) {
            throw new \RuntimeException(__('api.marketplace_payment_user_not_found'));
        }

        $client = StripeService::client();

        try {
            $account = $client->accounts->create(
                [
                    'type' => 'express',
                    'email' => $user->email,
                    'metadata' => [
                        'nexus_user_id' => (string) $userId,
                        'nexus_tenant_id' => (string) $tenantId,
                    ],
                    'capabilities' => [
                        'card_payments' => ['requested' => true],
                        'transfers' => ['requested' => true],
                    ],
                ],
                // Stable across process crashes and retries. If Stripe created
                // the account but our DB write did not commit, the next attempt
                // receives that same account instead of orphaning another one.
                ['idempotency_key' => "marketplace-connect-account-{$tenantId}-{$userId}"],
            );
        } catch (\Exception $e) {
            Log::error('MarketplacePayment: failed to create Connect account', [
                'user_id' => $userId,
                'tenant_id' => $tenantId,
                'error' => $e->getMessage(),
            ]);
            throw new \RuntimeException(__('api.marketplace_connect_account_create_failed'));
        }

        // Serialize the local binding too. A worker that somehow outlives the
        // cache lease may not overwrite a provider account already persisted by
        // another worker; the stable Stripe key means both normally have the
        // same ID, but this is the final last-save-wins backstop.
        $accountId = DB::transaction(static function () use ($tenantId, $userId, $account): string {
            $lockedProfile = MarketplaceSellerProfile::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('user_id', $userId)
                ->lockForUpdate()
                ->firstOrFail();
            if (! empty($lockedProfile->stripe_account_id)) {
                return (string) $lockedProfile->stripe_account_id;
            }

            $lockedProfile->stripe_account_id = (string) $account->id;
            $lockedProfile->stripe_onboarding_complete = false;
            $lockedProfile->save();

            return (string) $account->id;
        });

        // Re-read the winning local binding. This also preserves the existing
        // null-link behavior if an already-complete profile won the fallback
        // row-lock race while Stripe was responding.
        $onboardingUrl = self::getOnboardingLink($userId);

        Log::info('MarketplacePayment: Connect account created', [
            'user_id' => $userId,
            'tenant_id' => $tenantId,
            'account_id' => $accountId,
        ]);

        return [
            'account_id' => $accountId,
            'onboarding_url' => $onboardingUrl,
        ];
    }

    /**
     * Get a Stripe onboarding URL for an incomplete Connect account.
     *
     * @param int $userId Authenticated user ID
     * @return string|null Onboarding URL, or null if already onboarded
     *
     * @throws \RuntimeException On Stripe API failure
     */
    public static function getOnboardingLink(int $userId): ?string
    {
        $sellerProfile = MarketplaceSellerProfile::where('user_id', $userId)->first();

        if (!$sellerProfile || empty($sellerProfile->stripe_account_id)) {
            return null;
        }

        if ($sellerProfile->stripe_onboarding_complete) {
            return null;
        }

        return self::generateOnboardingLink($sellerProfile->stripe_account_id);
    }

    /**
     * Check if a seller's Stripe Connect account is fully onboarded.
     *
     * @param int $userId Authenticated user ID
     * @return array{onboarded: bool, details_submitted: bool, charges_enabled: bool, payouts_enabled: bool}
     */
    public static function checkOnboardingStatus(int $userId): array
    {
        $sellerProfile = MarketplaceSellerProfile::where('user_id', $userId)->first();

        if (!$sellerProfile || empty($sellerProfile->stripe_account_id)) {
            return [
                'onboarded' => false,
                'details_submitted' => false,
                'charges_enabled' => false,
                'payouts_enabled' => false,
            ];
        }

        $client = StripeService::client();

        try {
            $account = $client->accounts->retrieve($sellerProfile->stripe_account_id);
        } catch (\Exception $e) {
            Log::error('MarketplacePayment: failed to retrieve Connect account', [
                'user_id' => $userId,
                'account_id' => $sellerProfile->stripe_account_id,
                'error' => $e->getMessage(),
            ]);
            return [
                'onboarded' => (bool) $sellerProfile->stripe_onboarding_complete,
                'details_submitted' => false,
                'charges_enabled' => false,
                'payouts_enabled' => false,
            ];
        }

        $isOnboarded = $account->details_submitted
            && $account->charges_enabled
            && $account->payouts_enabled;

        // Update seller profile if status changed
        if ($isOnboarded && !$sellerProfile->stripe_onboarding_complete) {
            $sellerProfile->stripe_onboarding_complete = true;
            $sellerProfile->save();

            Log::info('MarketplacePayment: seller onboarding complete', [
                'user_id' => $userId,
                'account_id' => $sellerProfile->stripe_account_id,
            ]);

            // Bell the seller now that payouts are enabled (success path: after
            // stripe_onboarding_complete has persisted true). Covers the case
            // where the frontend polls status on return from Stripe before the
            // account.updated webhook lands. notifySellerOnboardingComplete is
            // best-effort and self-guards on failure.
            self::notifySellerOnboardingComplete(
                (int) $userId,
                (int) $sellerProfile->tenant_id
            );
        }

        return [
            'onboarded' => $isOnboarded,
            'details_submitted' => (bool) $account->details_submitted,
            'charges_enabled' => (bool) $account->charges_enabled,
            'payouts_enabled' => (bool) $account->payouts_enabled,
        ];
    }

    // -----------------------------------------------------------------
    //  Payment creation & confirmation
    // -----------------------------------------------------------------

    /**
     * Create a Stripe PaymentIntent for a marketplace order.
     *
     * Uses Stripe Connect with application_fee_amount and transfer_data
     * to route the platform fee to the platform account and the remainder
     * to the seller's connected account.
     *
     * @param MarketplaceOrder $order Order to create payment for
     * @return array{client_secret: string, payment_intent_id: string}
     *
     * @throws \RuntimeException On missing seller account or Stripe API failure
     * @throws \InvalidArgumentException On invalid order state
     */
    public static function createPaymentIntent(MarketplaceOrder $order): array
    {
        if ($order->status !== 'pending_payment') {
            throw new \InvalidArgumentException(__('api.marketplace_payment_intent_order_state_required'));
        }
        if ((float) $order->total_price <= 0 || (float) ($order->time_credits_used ?? 0) > 0) {
            throw new \InvalidArgumentException(__('api.marketplace_card_payment_not_required'));
        }
        if ($order->payment_expires_at !== null && $order->payment_expires_at->isPast()) {
            throw new \InvalidArgumentException(__('api.marketplace_checkout_expired'));
        }

        $tenantId = TenantContext::getId();

        // Get seller's Stripe Connect account
        $sellerProfile = MarketplaceSellerProfile::where('user_id', $order->seller_id)->first();

        if (!$sellerProfile || empty($sellerProfile->stripe_account_id)) {
            throw new \RuntimeException(__('api.marketplace_seller_onboarding_required'));
        }

        if (!$sellerProfile->stripe_onboarding_complete) {
            throw new \RuntimeException(__('api.marketplace_seller_onboarding_incomplete'));
        }
        self::assertStripeEnabled();

        // Calculate fees from config
        $feePercent = (float) MarketplaceConfigurationService::get(
            MarketplaceConfigurationService::CONFIG_PLATFORM_FEE_PERCENT,
            5
        );

        $currency = StripeCurrency::normalize((string) ($order->currency ?? TenantContext::getCurrency()));
        $amountCents = StripeCurrency::toMinor((float) $order->total_price, $currency);
        $totalAmount = StripeCurrency::fromMinor($amountCents, $currency);
        $feeCents = StripeCurrency::toMinor(
            StripeCurrency::roundMajor($totalAmount * ($feePercent / 100), $currency),
            $currency,
        );
        $payoutCents = $amountCents - $feeCents;
        $platformFee = StripeCurrency::fromMinor($feeCents, $currency);
        $sellerPayout = StripeCurrency::fromMinor($payoutCents, $currency);

        $currency = strtolower($currency);
        $delayedPayout = (bool) MarketplaceConfigurationService::get(
            MarketplaceConfigurationService::CONFIG_ESCROW_ENABLED,
            false,
        );
        $fundsFlow = $delayedPayout ? 'separate_charge_transfer' : 'destination_charge';

        // Claim the mechanism only after every deterministic local precondition
        // passes, but before the first Stripe network call.
        $order = self::claimStripeCheckoutMode($order, 'payment_intent');

        $client = StripeService::client();

        if (! empty($order->payment_intent_id)) {
            try {
                $existingIntent = $client->paymentIntents->retrieve(
                    (string) $order->payment_intent_id,
                );
                self::providerBoundEconomics($existingIntent, $order, $tenantId);
                if (empty($existingIntent->client_secret)) {
                    throw new \RuntimeException(__('api.marketplace_payment_intent_order_mismatch'));
                }

                try {
                    self::bindPaymentIntentToPayableOrder(
                        $order,
                        (string) $existingIntent->id,
                        $tenantId,
                    );
                } catch (\Throwable $stateException) {
                    self::cancelUnboundPaymentIntent($client, $existingIntent, $order, $tenantId);
                    throw $stateException;
                }

                return [
                    'client_secret' => (string) $existingIntent->client_secret,
                    'payment_intent_id' => (string) $existingIntent->id,
                ];
            } catch (\InvalidArgumentException $exception) {
                throw $exception;
            } catch (\Throwable $exception) {
                Log::error('MarketplacePayment: failed to resume PaymentIntent', [
                    'order_id' => $order->id,
                    'tenant_id' => $tenantId,
                    'payment_intent_id' => $order->payment_intent_id,
                    'error' => $exception->getMessage(),
                ]);
                throw new \RuntimeException(__('api.marketplace_payment_create_failed'));
            }
        }

        try {
            // Idempotency key binds a network retry of this create() to the same
            // PaymentIntent, so a dropped connection / client retry can't end up
            // charging the buyer twice. Scoped to order id + tenant to avoid
            // collisions across tenants that share a Stripe account.
            $idempotencyKey = "market-order-{$tenantId}-{$order->id}";
            $params = [
                'amount' => $amountCents,
                'currency' => $currency,
                'metadata' => [
                    'nexus_tenant_id' => (string) $tenantId,
                    'nexus_order_id' => (string) $order->id,
                    'nexus_buyer_id' => (string) $order->buyer_id,
                    'nexus_seller_id' => (string) $order->seller_id,
                    'nexus_type' => 'marketplace',
                    'nexus_funds_flow' => $fundsFlow,
                    'nexus_currency' => strtoupper($currency),
                    'nexus_amount_minor' => (string) $amountCents,
                    'nexus_platform_fee_minor' => (string) $feeCents,
                    'nexus_seller_payout_minor' => (string) $payoutCents,
                ],
                'description' => __('api.marketplace_stripe_order_description', [
                    'order' => $order->order_number,
                ]),
            ];
            if ($delayedPayout) {
                // Separate charge now; MarketplaceEscrowService creates the
                // seller transfer only after the release condition is met.
                $params['transfer_group'] = 'marketplace_order_' . $order->id;
            } else {
                $params['application_fee_amount'] = $feeCents;
                $params['transfer_data'] = [
                    'destination' => $sellerProfile->stripe_account_id,
                ];
            }
            $paymentIntent = $client->paymentIntents->create(
                $params,
                ['idempotency_key' => $idempotencyKey],
            );
        } catch (\Exception $e) {
            Log::error('MarketplacePayment: failed to create PaymentIntent', [
                'order_id' => $order->id,
                'tenant_id' => $tenantId,
                'amount' => $totalAmount,
                'error' => $e->getMessage(),
            ]);
            throw new \RuntimeException(__('api.marketplace_payment_create_failed'));
        }

        // Re-check the payable state after the network call. Cancellation or
        // expiry may have won while Stripe was creating the remote object.
        try {
            self::bindPaymentIntentToPayableOrder(
                $order,
                (string) $paymentIntent->id,
                $tenantId,
            );
        } catch (\Throwable $stateException) {
            self::cancelUnboundPaymentIntent($client, $paymentIntent, $order, $tenantId);
            throw $stateException;
        }

        Log::info('MarketplacePayment: PaymentIntent created', [
            'order_id' => $order->id,
            'payment_intent_id' => $paymentIntent->id,
            'amount' => $totalAmount,
            'platform_fee' => $platformFee,
            'seller_payout' => $sellerPayout,
        ]);

        return [
            'client_secret' => $paymentIntent->client_secret,
            'payment_intent_id' => $paymentIntent->id,
        ];
    }

    /**
     * Create a Stripe Checkout Session (hosted payment page) for a marketplace
     * order. This is the NO-JS / accessible equivalent of createPaymentIntent:
     * the buyer is redirected to Stripe's hosted page and pays there, so no
     * Stripe.js / Elements is required. Same Connect destination charge —
     * application fee to the platform, the rest transferred to the seller's
     * connected account — and the SAME nexus_* metadata, so the
     * checkout.session.completed webhook can reconcile the order and reuse
     * confirmPayment(). Returns the Stripe-hosted Checkout URL to redirect to.
     *
     * @throws \RuntimeException when the seller has not completed onboarding or
     *                          the Stripe API call fails.
     */
    public static function createCheckoutSession(MarketplaceOrder $order, string $successUrl, string $cancelUrl): string
    {
        if ($order->status !== 'pending_payment') {
            throw new \InvalidArgumentException(__('api.marketplace_checkout_order_state_required'));
        }
        if ((float) $order->total_price <= 0 || (float) ($order->time_credits_used ?? 0) > 0) {
            throw new \InvalidArgumentException(__('api.marketplace_card_payment_not_required'));
        }
        if ($order->payment_expires_at !== null && $order->payment_expires_at->isPast()) {
            throw new \InvalidArgumentException(__('api.marketplace_checkout_expired'));
        }

        $tenantId = TenantContext::getId();

        $sellerProfile = MarketplaceSellerProfile::where('user_id', $order->seller_id)->first();
        if (!$sellerProfile || empty($sellerProfile->stripe_account_id)) {
            throw new \RuntimeException(__('api.marketplace_seller_onboarding_required'));
        }
        if (!$sellerProfile->stripe_onboarding_complete) {
            throw new \RuntimeException(__('api.marketplace_seller_onboarding_incomplete'));
        }
        self::assertStripeEnabled();

        $feePercent = (float) MarketplaceConfigurationService::get(
            MarketplaceConfigurationService::CONFIG_PLATFORM_FEE_PERCENT,
            5
        );
        $currency = StripeCurrency::normalize((string) ($order->currency ?? TenantContext::getCurrency()));
        $amountCents = StripeCurrency::toMinor((float) $order->total_price, $currency);
        $totalAmount = StripeCurrency::fromMinor($amountCents, $currency);
        $feeCents = StripeCurrency::toMinor(
            StripeCurrency::roundMajor($totalAmount * ($feePercent / 100), $currency),
            $currency,
        );
        $payoutCents = $amountCents - $feeCents;
        $platformFee = StripeCurrency::fromMinor($feeCents, $currency);
        $sellerPayout = StripeCurrency::fromMinor($payoutCents, $currency);
        $currency = strtolower($currency);
        $delayedPayout = (bool) MarketplaceConfigurationService::get(
            MarketplaceConfigurationService::CONFIG_ESCROW_ENABLED,
            false,
        );
        $fundsFlow = $delayedPayout ? 'separate_charge_transfer' : 'destination_charge';

        // Bind the remote session lifetime only after deterministic seller,
        // amount, currency and configuration validation succeeds. Stripe
        // requires a session expiry at least 30 minutes in the future.
        $order = DB::transaction(function () use ($order, $tenantId): MarketplaceOrder {
            $lockedOrder = MarketplaceOrder::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereKey($order->id)
                ->lockForUpdate()
                ->firstOrFail();
            if ($lockedOrder->status !== 'pending_payment') {
                throw new \InvalidArgumentException(__('api.marketplace_checkout_order_state_required'));
            }
            if ($lockedOrder->payment_expires_at !== null && $lockedOrder->payment_expires_at->isPast()) {
                throw new \InvalidArgumentException(__('api.marketplace_checkout_expired'));
            }
            $boundMode = (string) ($lockedOrder->stripe_checkout_mode ?? '');
            if ($boundMode === '' && ! empty($lockedOrder->payment_intent_id)) {
                $boundMode = 'payment_intent';
            }
            if ($boundMode !== '' && $boundMode !== 'checkout_session') {
                throw new \InvalidArgumentException(__('api.marketplace_checkout_mode_conflict'));
            }
            if ($boundMode === '') {
                $lockedOrder->stripe_checkout_mode = 'checkout_session';
            }
            if (empty($lockedOrder->checkout_session_id)) {
                $minimumRemoteExpiry = now()->addMinutes(31)->startOfSecond();
                if ($lockedOrder->payment_expires_at === null
                    || $lockedOrder->payment_expires_at->lt($minimumRemoteExpiry)) {
                    $lockedOrder->payment_expires_at = $minimumRemoteExpiry;
                }
            }
            if ($lockedOrder->isDirty()) {
                $lockedOrder->save();
            }

            return $lockedOrder;
        });

        $metadata = [
            'nexus_tenant_id' => (string) $tenantId,
            'nexus_order_id' => (string) $order->id,
            'nexus_buyer_id' => (string) $order->buyer_id,
            'nexus_seller_id' => (string) $order->seller_id,
            'nexus_type' => 'marketplace',
            'nexus_funds_flow' => $fundsFlow,
            'nexus_currency' => strtoupper($currency),
            'nexus_amount_minor' => (string) $amountCents,
            'nexus_platform_fee_minor' => (string) $feeCents,
            'nexus_seller_payout_minor' => (string) $payoutCents,
        ];

        $client = StripeService::client();

        if (! empty($order->checkout_session_id)) {
            try {
                $existingSession = $client->checkout->sessions->retrieve(
                    (string) $order->checkout_session_id,
                    [],
                );
                $sessionOrderId = (int) ($existingSession->metadata->nexus_order_id
                    ?? $existingSession->client_reference_id
                    ?? 0);
                $boundAmount = self::strictMetadataMinorAmount(
                    $existingSession->metadata->nexus_amount_minor ?? null,
                );
                $boundFee = self::strictMetadataMinorAmount(
                    $existingSession->metadata->nexus_platform_fee_minor ?? null,
                );
                $boundPayout = self::strictMetadataMinorAmount(
                    $existingSession->metadata->nexus_seller_payout_minor ?? null,
                );
                if ($sessionOrderId !== (int) $order->id
                    || (int) ($existingSession->metadata->nexus_tenant_id ?? 0) !== $tenantId
                    || (int) ($existingSession->metadata->nexus_buyer_id ?? 0) !== (int) $order->buyer_id
                    || (int) ($existingSession->metadata->nexus_seller_id ?? 0) !== (int) $order->seller_id
                    || (string) ($existingSession->metadata->nexus_currency ?? '') !== strtoupper($currency)
                    || $boundAmount !== $amountCents
                    || $boundFee === null
                    || $boundPayout === null
                    || $boundFee > $boundAmount
                    || $boundPayout !== $boundAmount - $boundFee
                    || ! in_array(
                        (string) ($existingSession->metadata->nexus_funds_flow ?? ''),
                        ['destination_charge', 'separate_charge_transfer'],
                        true,
                    )
                    || (string) ($existingSession->status ?? '') !== 'open'
                    || empty($existingSession->url)) {
                    throw new \RuntimeException(__('api.marketplace_checkout_start_failed'));
                }

                return (string) $existingSession->url;
            } catch (\Throwable $exception) {
                Log::error('MarketplacePayment: failed to resume Checkout Session', [
                    'order_id' => $order->id,
                    'tenant_id' => $tenantId,
                    'checkout_session_id' => $order->checkout_session_id,
                    'error' => $exception->getMessage(),
                ]);
                throw new \RuntimeException(__('api.marketplace_checkout_start_failed'));
            }
        }

        try {
            // Idempotency: a network retry of this create() returns the same
            // session rather than charging twice. Scoped to order + tenant + the
            // order identity. If a supposedly immutable amount, fee, or funds
            // flow changes, Stripe rejects reuse with different parameters
            // instead of creating a second payable session.
            $idempotencyKey = "market-checkout-{$tenantId}-{$order->id}";
            $paymentIntentData = [
                'metadata' => $metadata,
                'description' => __('api.marketplace_stripe_order_description', [
                    'order' => $order->order_number,
                ]),
            ];
            if ($delayedPayout) {
                $paymentIntentData['transfer_group'] = 'marketplace_order_' . $order->id;
            } else {
                $paymentIntentData['application_fee_amount'] = $feeCents;
                $paymentIntentData['transfer_data'] = [
                    'destination' => $sellerProfile->stripe_account_id,
                ];
            }

            $session = $client->checkout->sessions->create([
                'mode' => 'payment',
                'line_items' => [[
                    'price_data' => [
                        'currency' => $currency,
                        'product_data' => [
                            'name' => __('api.marketplace_stripe_order_description', [
                                'order' => $order->order_number,
                            ]),
                        ],
                        'unit_amount' => $amountCents,
                    ],
                    'quantity' => 1,
                ]],
                'payment_intent_data' => $paymentIntentData,
                // Session-level metadata too, so the webhook can read nexus_type
                // / nexus_order_id straight off the checkout.session object.
                'metadata' => $metadata,
                'client_reference_id' => (string) $order->id,
                'expires_at' => $order->payment_expires_at?->getTimestamp(),
                'success_url' => $successUrl,
                'cancel_url' => $cancelUrl,
            ], ['idempotency_key' => $idempotencyKey]);
        } catch (\Exception $e) {
            Log::error('MarketplacePayment: failed to create Checkout Session', [
                'order_id' => $order->id,
                'tenant_id' => $tenantId,
                'amount' => $totalAmount,
                'error' => $e->getMessage(),
            ]);
            throw new \RuntimeException(__('api.marketplace_checkout_start_failed'));
        }

        $sessionBound = DB::transaction(function () use ($order, $session, $tenantId): bool {
            $lockedOrder = MarketplaceOrder::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereKey($order->id)
                ->lockForUpdate()
                ->first();
            if (! $lockedOrder || $lockedOrder->status !== 'pending_payment') {
                return false;
            }
            if (! empty($lockedOrder->checkout_session_id)
                && (string) $lockedOrder->checkout_session_id !== (string) $session->id) {
                return false;
            }

            $lockedOrder->checkout_session_id = (string) $session->id;
            if (! empty($session->expires_at)) {
                $lockedOrder->payment_expires_at = Carbon::createFromTimestamp((int) $session->expires_at);
            }
            $lockedOrder->save();
            return true;
        });
        if (! $sessionBound) {
            try {
                if ((string) ($session->status ?? 'open') === 'open') {
                    $client->checkout->sessions->expire((string) $session->id, []);
                }
            } catch (\Throwable $exception) {
                Log::critical('MarketplacePayment: unbound Checkout Session could not be expired', [
                    'order_id' => $order->id,
                    'tenant_id' => $tenantId,
                    'checkout_session_id' => $session->id ?? null,
                    'error' => $exception->getMessage(),
                ]);
            }
            throw new \RuntimeException(__('api.marketplace_checkout_expired'));
        }

        Log::info('MarketplacePayment: Checkout Session created', [
            'order_id' => $order->id,
            'session_id' => $session->id,
            'amount' => $totalAmount,
            'platform_fee' => $platformFee,
            'seller_payout' => $sellerPayout,
        ]);

        return (string) $session->url;
    }

    /**
     * Confirm a payment after frontend Stripe.js completes the PaymentIntent.
     *
     * Creates a MarketplacePayment record and transitions the order to 'paid'.
     * If escrow is enabled, also creates an escrow hold via MarketplaceEscrowService.
     *
     * @param string $paymentIntentId Stripe PaymentIntent ID
     * @return MarketplacePayment
     *
     * @throws \RuntimeException On Stripe API failure or missing order
     */
    public static function confirmPayment(string $paymentIntentId): MarketplacePayment
    {
        $tenantId = TenantContext::getId();

        // Retrieve the PaymentIntent from Stripe to verify status
        $client = StripeService::client();

        try {
            $paymentIntent = $client->paymentIntents->retrieve($paymentIntentId);
        } catch (\Exception $e) {
            Log::error('MarketplacePayment: failed to retrieve PaymentIntent', [
                'payment_intent_id' => $paymentIntentId,
                'error' => $e->getMessage(),
            ]);
            throw new \RuntimeException(__('api.marketplace_payment_verify_failed'));
        }

        if ($paymentIntent->status !== 'succeeded') {
            throw new \RuntimeException(__('api.marketplace_payment_not_succeeded', ['status' => $paymentIntent->status]));
        }

        $order = MarketplaceOrder::where('payment_intent_id', $paymentIntentId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$order) {
            throw new \RuntimeException(__('api.marketplace_payment_intent_order_not_found'));
        }

        $economics = self::providerBoundEconomics($paymentIntent, $order, $tenantId);
        $currency = $economics['currency'];
        $expectedAmountCents = $economics['amount_minor'];
        $receivedAmountCents = (int) ($paymentIntent->amount_received ?? $paymentIntent->amount ?? 0);
        if ($receivedAmountCents !== $expectedAmountCents) {
            throw new \RuntimeException(__('api.marketplace_payment_amount_mismatch'));
        }
        $fundsFlow = $economics['funds_flow'];

        // Idempotency: check if payment already recorded (scoped by tenant)
        $existingPayment = MarketplacePayment::where('stripe_payment_intent_id', $paymentIntentId)
            ->where('tenant_id', $tenantId)
            ->first();
        if ($existingPayment) {
            if ($existingPayment->funds_flow === 'separate_charge_transfer') {
                MarketplaceEscrowService::holdFunds($order, $existingPayment);
            }
            return $existingPayment;
        }

        // These economics were bound into the provider object at checkout
        // creation. Never recalculate from mutable tenant configuration here:
        // the fee may legitimately change while the buyer is completing Stripe.
        $totalAmount = StripeCurrency::fromMinor($economics['amount_minor'], $currency);
        $platformFee = StripeCurrency::fromMinor($economics['platform_fee_minor'], $currency);
        $sellerPayout = StripeCurrency::fromMinor($economics['seller_payout_minor'], $currency);

        // Get charge ID if available
        $chargeId = null;
        if (!empty($paymentIntent->latest_charge)) {
            $chargeId = is_string($paymentIntent->latest_charge)
                ? $paymentIntent->latest_charge
                : ($paymentIntent->latest_charge->id ?? null);
        }

        $createdPayment = false;
        try {
            $payment = DB::transaction(function () use (
                $order, $paymentIntentId, $chargeId, $totalAmount,
                $platformFee, $sellerPayout, $paymentIntent, $tenantId, $fundsFlow, &$createdPayment
            ) {
            $lockedOrder = MarketplaceOrder::where('id', $order->id)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();

            if (!$lockedOrder) {
                throw new \RuntimeException(__('api.marketplace_payment_intent_order_not_found'));
            }

            $existingPayment = MarketplacePayment::where('stripe_payment_intent_id', $paymentIntentId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();
            if ($existingPayment) {
                if ($existingPayment->funds_flow === 'separate_charge_transfer') {
                    MarketplaceEscrowService::holdFunds($lockedOrder, $existingPayment);
                }
                return $existingPayment;
            }
            if ($lockedOrder->status !== 'pending_payment') {
                throw new \RuntimeException(__('api.marketplace_order_not_awaiting_payment'));
            }

            $payment = new MarketplacePayment();
            $payment->tenant_id = $tenantId;
            $payment->order_id = $lockedOrder->id;
            $payment->stripe_payment_intent_id = $paymentIntentId;
            $payment->stripe_charge_id = $chargeId;
            $payment->funds_flow = $fundsFlow;
            $payment->amount = $totalAmount;
            $payment->currency = strtoupper($paymentIntent->currency ?? TenantContext::getCurrency());
            $payment->platform_fee = $platformFee;
            $payment->seller_payout = $sellerPayout;
            $payment->payment_method = $paymentIntent->payment_method_types[0] ?? 'card';
            $payment->status = 'succeeded';
            $payment->payout_status = $fundsFlow === 'destination_charge' ? 'paid' : 'pending';
            $payment->paid_out_at = $fundsFlow === 'destination_charge' ? now() : null;
            $payment->save();

            // Transition order to 'paid'
            $lockedOrder->status = 'paid';
            $lockedOrder->payment_expires_at = null;
            $lockedOrder->save();

            // The paid transition and escrow hold are one durable commit. If
            // the hold write fails, the local payment/order changes roll back
            // and Stripe's webhook can safely retry and heal the capture.
            if ($payment->funds_flow === 'separate_charge_transfer') {
                MarketplaceEscrowService::holdFunds($lockedOrder, $payment);
            }

            $createdPayment = true;
            return $payment;
            });
        } catch (QueryException $e) {
            $duplicatePayment = MarketplacePayment::where('stripe_payment_intent_id', $paymentIntentId)
                ->where('tenant_id', $tenantId)
                ->first();
            if ($duplicatePayment) {
                if ($duplicatePayment->funds_flow === 'separate_charge_transfer') {
                    MarketplaceEscrowService::holdFunds(
                        $order->fresh() ?? $order,
                        $duplicatePayment,
                    );
                }
                return $duplicatePayment;
            }

            throw $e;
        }

        if (!$createdPayment) {
            return $payment;
        }

        $order = $order->fresh() ?? $order;

        try {
            MarketplaceOrderService::sendPaidNotifications($order, $payment);
        } catch (\Throwable $e) {
            Log::warning('[MarketplacePaymentService] paid notification failed', [
                'order_id' => $order->id,
                'payment_id' => $payment->id,
                'error' => $e->getMessage(),
            ]);
        }

        Log::info('MarketplacePayment: payment confirmed', [
            'order_id' => $order->id,
            'payment_id' => $payment->id,
            'payment_intent_id' => $paymentIntentId,
            'amount' => $totalAmount,
        ]);

        return $payment;
    }

    /**
     * Read and verify the immutable checkout economics stamped on a Stripe
     * PaymentIntent when it was created.
     *
     * @return array{currency:string,amount_minor:int,platform_fee_minor:int,seller_payout_minor:int,funds_flow:string}
     */
    private static function providerBoundEconomics(
        object $paymentIntent,
        MarketplaceOrder $order,
        int $tenantId,
    ): array {
        $metadata = $paymentIntent->metadata ?? null;
        $metadataOrderId = (int) ($metadata->nexus_order_id ?? 0);
        if (($metadata->nexus_type ?? null) !== 'marketplace'
            || $metadataOrderId !== (int) $order->id) {
            Log::warning('MarketplacePayment: Stripe metadata order mismatch', [
                'payment_intent_id' => $paymentIntent->id ?? null,
                'local_order_id' => $order->id,
                'metadata_order_id' => $metadataOrderId,
                'tenant_id' => $tenantId,
            ]);
            throw new \RuntimeException(__('api.marketplace_payment_intent_order_mismatch'));
        }
        if ((int) ($metadata->nexus_tenant_id ?? 0) !== $tenantId) {
            throw new \RuntimeException(__('api.marketplace_payment_intent_tenant_mismatch'));
        }
        if ((int) ($metadata->nexus_buyer_id ?? 0) !== (int) $order->buyer_id
            || (int) ($metadata->nexus_seller_id ?? 0) !== (int) $order->seller_id) {
            throw new \RuntimeException(__('api.marketplace_payment_intent_order_mismatch'));
        }

        try {
            $currency = StripeCurrency::normalize((string) $order->currency);
            $providerCurrency = StripeCurrency::normalize((string) ($paymentIntent->currency ?? ''));
            $metadataCurrency = StripeCurrency::normalize((string) ($metadata->nexus_currency ?? ''));
        } catch (\InvalidArgumentException) {
            throw new \RuntimeException(__('api.marketplace_payment_currency_mismatch'));
        }
        if ($providerCurrency !== $currency || $metadataCurrency !== $currency) {
            throw new \RuntimeException(__('api.marketplace_payment_currency_mismatch'));
        }

        $amountMinor = self::strictMetadataMinorAmount($metadata->nexus_amount_minor ?? null);
        $feeMinor = self::strictMetadataMinorAmount($metadata->nexus_platform_fee_minor ?? null);
        $payoutMinor = self::strictMetadataMinorAmount($metadata->nexus_seller_payout_minor ?? null);
        $expectedAmountMinor = StripeCurrency::toMinor((float) $order->total_price, $currency);
        $providerAmountMinor = (int) ($paymentIntent->amount ?? 0);
        if ($amountMinor === null
            || $feeMinor === null
            || $payoutMinor === null
            || $amountMinor <= 0
            || $providerAmountMinor !== $amountMinor
            || $expectedAmountMinor !== $amountMinor
            || $feeMinor > $amountMinor
            || $payoutMinor !== $amountMinor - $feeMinor) {
            throw new \RuntimeException(__('api.marketplace_payment_amount_mismatch'));
        }

        $fundsFlow = (string) ($metadata->nexus_funds_flow ?? '');
        if (! in_array($fundsFlow, ['destination_charge', 'separate_charge_transfer'], true)) {
            throw new \RuntimeException(__('api.marketplace_payment_funds_flow_unsupported'));
        }
        $providerFeeMinor = $paymentIntent->application_fee_amount ?? null;
        if ($providerFeeMinor !== null
            && (($fundsFlow === 'destination_charge' && (int) $providerFeeMinor !== $feeMinor)
                || ($fundsFlow === 'separate_charge_transfer' && (int) $providerFeeMinor !== 0))) {
            throw new \RuntimeException(__('api.marketplace_payment_amount_mismatch'));
        }

        return [
            'currency' => $currency,
            'amount_minor' => $amountMinor,
            'platform_fee_minor' => $feeMinor,
            'seller_payout_minor' => $payoutMinor,
            'funds_flow' => $fundsFlow,
        ];
    }

    private static function strictMetadataMinorAmount(mixed $value): ?int
    {
        if (! is_string($value) || $value === '' || ! ctype_digit($value)) {
            return null;
        }
        if (strlen($value) > 12) {
            return null;
        }

        return (int) $value;
    }

    /**
     * Reconcile and cancel an unpaid Stripe intent before inventory is released.
     * Returns true only when it is safe for the caller to cancel the order.
     */
    public static function prepareOrderForExpiry(MarketplaceOrder $order): bool
    {
        if (! empty($order->checkout_session_id)) {
            $client = StripeService::client();
            try {
                $session = $client->checkout->sessions->retrieve(
                    (string) $order->checkout_session_id,
                    [],
                );
                $sessionOrderId = (int) ($session->metadata->nexus_order_id
                    ?? $session->client_reference_id
                    ?? 0);
                if ($sessionOrderId !== (int) $order->id) {
                    Log::critical('MarketplacePayment: Checkout Session order binding mismatch', [
                        'order_id' => $order->id,
                        'tenant_id' => $order->tenant_id,
                        'checkout_session_id' => $order->checkout_session_id,
                        'session_order_id' => $sessionOrderId,
                    ]);
                    return false;
                }

                $paymentIntentId = $session->payment_intent ?? null;
                $paymentIntentId = is_string($paymentIntentId)
                    ? $paymentIntentId
                    : ($paymentIntentId->id ?? null);
                if ((string) ($session->payment_status ?? '') === 'paid') {
                    if (! $paymentIntentId) {
                        return false;
                    }
                    DB::transaction(function () use ($order, $paymentIntentId): void {
                        $lockedOrder = MarketplaceOrder::withoutGlobalScopes()
                            ->where('tenant_id', $order->tenant_id)
                            ->whereKey($order->id)
                            ->lockForUpdate()
                            ->first();
                        if ($lockedOrder) {
                            $boundMode = (string) ($lockedOrder->stripe_checkout_mode ?? '');
                            if ($boundMode !== '' && $boundMode !== 'checkout_session') {
                                throw new \RuntimeException(__('api.marketplace_checkout_mode_conflict'));
                            }
                            $lockedOrder->stripe_checkout_mode = 'checkout_session';
                            if (empty($lockedOrder->payment_intent_id)) {
                                $lockedOrder->payment_intent_id = $paymentIntentId;
                            }
                            if ($lockedOrder->isDirty()) {
                                $lockedOrder->save();
                            }
                        }
                    });
                    self::confirmPayment($paymentIntentId);
                    return false;
                }

                $sessionStatus = (string) ($session->status ?? '');
                if ($sessionStatus === 'expired') {
                    return true;
                }
                if ($sessionStatus !== 'open') {
                    $order->payment_expires_at = now()->addMinutes(15);
                    $order->save();
                    return false;
                }

                // Stripe guarantees a successfully-expired open session can no
                // longer be completed. If completion wins this race, expire()
                // fails and we defer rather than release inventory under a
                // potentially successful payment.
                $expired = $client->checkout->sessions->expire(
                    (string) $order->checkout_session_id,
                    [],
                );
                return (string) ($expired->status ?? '') === 'expired';
            } catch (\Throwable $exception) {
                Log::error('MarketplacePayment: Checkout Session expiry reconciliation failed', [
                    'order_id' => $order->id,
                    'tenant_id' => $order->tenant_id,
                    'checkout_session_id' => $order->checkout_session_id,
                    'error' => $exception->getMessage(),
                ]);
                return false;
            }
        }

        if (empty($order->payment_intent_id)) {
            return true;
        }

        $client = StripeService::client();
        try {
            $intent = $client->paymentIntents->retrieve($order->payment_intent_id);
            if ($intent->status === 'succeeded') {
                self::confirmPayment((string) $intent->id);
                return false;
            }
            if (in_array($intent->status, ['processing', 'requires_capture'], true)) {
                $order->payment_expires_at = now()->addMinutes(15);
                $order->save();
                return false;
            }
            if ($intent->status !== 'canceled') {
                $client->paymentIntents->cancel((string) $intent->id, [], [
                    'idempotency_key' => sprintf(
                        'marketplace-expire-intent-%d-%d',
                        (int) $order->tenant_id,
                        (int) $order->id,
                    ),
                ]);
            }
            return true;
        } catch (\Throwable $exception) {
            Log::error('MarketplacePayment: expiry reconciliation failed', [
                'order_id' => $order->id,
                'tenant_id' => $order->tenant_id,
                'payment_intent_id' => $order->payment_intent_id,
                'error' => $exception->getMessage(),
            ]);
            return false;
        }
    }

    // -----------------------------------------------------------------
    //  Refunds
    // -----------------------------------------------------------------

    /**
     * Process a full or partial refund for a marketplace order.
     *
     * @param MarketplaceOrder $order   Order to refund
     * @param float|null       $amount  Partial refund amount (null = full refund)
     * @param string           $reason  Reason for the refund
     * @return MarketplacePayment Updated payment record
     *
     * @throws \RuntimeException On Stripe API failure or invalid state
     */
    public static function processRefund(MarketplaceOrder $order, ?float $amount, string $reason): MarketplacePayment
    {
        $tenantId = (int) ($order->tenant_id ?: TenantContext::getId());
        $paymentId = MarketplacePayment::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('order_id', $order->id)
            ->whereIn('status', ['succeeded', 'partially_refunded', 'refunded'])
            ->value('id');
        if ($paymentId === null) {
            throw new \RuntimeException(__('api.marketplace_successful_payment_not_found'));
        }

        try {
            return Cache::lock("marketplace-money-movement:{$tenantId}:{$paymentId}", 180)
                ->block(10, static fn (): MarketplacePayment => self::processRefundLocked(
                    $order,
                    $amount,
                    $reason,
                ));
        } catch (\Illuminate\Contracts\Cache\LockTimeoutException $exception) {
            throw new \RuntimeException(__('api.marketplace_payout_processing'), previous: $exception);
        }
    }

    /** Process a refund while holding the cross-process payout/refund claim. */
    private static function processRefundLocked(
        MarketplaceOrder $order,
        ?float $amount,
        string $reason,
    ): MarketplacePayment
    {
        $tenantId = (int) ($order->tenant_id ?: TenantContext::getId());

        $payment = DB::transaction(function () use ($tenantId, $order): ?MarketplacePayment {
            $lockedPayment = MarketplacePayment::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('order_id', $order->id)
                ->whereIn('status', ['succeeded', 'partially_refunded', 'refunded'])
                ->lockForUpdate()
                ->first();
            if (! $lockedPayment) {
                return null;
            }

            $escrow = MarketplaceEscrow::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('payment_id', $lockedPayment->id)
                ->lockForUpdate()
                ->first();
            if ($lockedPayment->funds_flow === 'separate_charge_transfer'
                && ($lockedPayment->payout_status === 'scheduled'
                    || ($escrow !== null
                        && $escrow->status === 'released'
                        && ($lockedPayment->payout_status !== 'paid'
                            || empty($lockedPayment->payout_id))))) {
                throw new \RuntimeException(__('api.marketplace_payout_processing'));
            }

            return $lockedPayment;
        });

        if (!$payment) {
            throw new \RuntimeException(__('api.marketplace_successful_payment_not_found'));
        }

        $currency = StripeCurrency::normalize((string) $payment->currency);
        $originalChargeAmount = (float) $payment->amount;
        $alreadyRefunded = (float) ($payment->refund_amount ?? 0);
        if ($payment->status === 'refunded') {
            if ($amount === null || abs($amount - $originalChargeAmount) <= 0.005) {
                return $payment;
            }
            throw new \InvalidArgumentException(__('api.marketplace_refund_amount_invalid'));
        }
        if (empty($payment->stripe_payment_intent_id)) {
            throw new \RuntimeException(__('api.marketplace_payment_intent_missing'));
        }

        $remainingRefundable = max(0.0, StripeCurrency::roundMajor(
            $originalChargeAmount - $alreadyRefunded,
            $currency,
        ));
        $refundAmount = $amount ?? $remainingRefundable;

        if ($refundAmount <= 0 || $refundAmount > $remainingRefundable) {
            throw new \InvalidArgumentException(__('api.marketplace_refund_amount_invalid'));
        }
        if ($payment->funds_flow === 'separate_charge_transfer'
            && $payment->payout_status === 'scheduled') {
            throw new \RuntimeException(__('api.marketplace_payout_processing'));
        }

        $client = StripeService::client();

        $currentPlatformFee = (float) $payment->platform_fee;
        $currentSellerPayout = (float) $payment->seller_payout;
        $feeReversal = $remainingRefundable > 0
            ? StripeCurrency::roundMajor(
                $currentPlatformFee * ($refundAmount / $remainingRefundable),
                $currency,
            )
            : 0.0;
        $payoutReversal = min(
            $currentSellerPayout,
            max(0.0, StripeCurrency::roundMajor($refundAmount - $feeReversal, $currency)),
        );

        $refundParams = [
            'payment_intent' => $payment->stripe_payment_intent_id,
            'amount' => StripeCurrency::toMinor($refundAmount, $currency),
            'reason' => 'requested_by_customer',
            'metadata' => [
                'nexus_order_id' => (string) $order->id,
                'nexus_tenant_id' => (string) $tenantId,
                'nexus_reason' => $reason,
            ],
        ];

        // Destination charges moved funds at capture, so Stripe must reverse
        // the transfer and application fee. Separate-charge payouts are
        // reversed explicitly above.
        if ($payment->funds_flow !== 'separate_charge_transfer') {
            $refundParams['refund_application_fee'] = true;
            $refundParams['reverse_transfer'] = true;
        }

        try {
            $refund = $client->refunds->create($refundParams, [
                'idempotency_key' => sprintf(
                    'marketplace-refund-%d-%d-%d',
                    $tenantId,
                    $payment->id,
                    StripeCurrency::toMinor($alreadyRefunded + $refundAmount, $currency),
                ),
            ]);
        } catch (\Exception $e) {
            Log::error('MarketplacePayment: failed to create refund', [
                'order_id' => $order->id,
                'payment_intent_id' => $payment->stripe_payment_intent_id,
                'amount' => $refundAmount,
                'error' => $e->getMessage(),
            ]);
            throw new \RuntimeException(__('api.marketplace_refund_failed'));
        }

        // Refund the buyer first. If transfer reversal then fails, Stripe's
        // charge.refunded webhook uses the refund ID as a durable recovery key
        // and completes the seller-side reconciliation idempotently.
        if ($payment->funds_flow === 'separate_charge_transfer'
            && $payment->payout_status === 'paid'
            && ! empty($payment->payout_id)
            && $payoutReversal > 0) {
            try {
                $client->transfers->createReversal(
                    $payment->payout_id,
                    ['amount' => StripeCurrency::toMinor($payoutReversal, $currency)],
                    ['idempotency_key' => 'marketplace-external-transfer-reversal-' . hash('sha256', (string) $refund->id)],
                );
            } catch (\Throwable $exception) {
                Log::critical('MarketplacePayment: buyer refunded but seller transfer reversal is pending webhook recovery', [
                    'order_id' => $order->id,
                    'payment_id' => $payment->id,
                    'payout_id' => $payment->payout_id,
                    'stripe_refund_id' => $refund->id,
                    'amount' => $payoutReversal,
                    'error' => $exception->getMessage(),
                ]);
                throw new \RuntimeException(__('api.marketplace_refund_failed'));
            }
        }

        $isFullRefund = false;
        DB::transaction(function () use (
            $payment,
            $order,
            $refund,
            $refundAmount,
            $reason,
            $feeReversal,
            $payoutReversal,
            $tenantId,
            $currency,
            &$isFullRefund,
        ): void {
            $lockedPayment = MarketplacePayment::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereKey($payment->id)
                ->lockForUpdate()
                ->firstOrFail();
            $lockedOrder = MarketplaceOrder::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereKey($order->id)
                ->lockForUpdate()
                ->firstOrFail();

            $recorded = DB::table('marketplace_payment_refunds')
                ->where('tenant_id', $tenantId)
                ->where('stripe_refund_id', (string) $refund->id)
                ->exists();
            if ($recorded) {
                $isFullRefund = $lockedPayment->status === 'refunded';
                return;
            }

            DB::table('marketplace_payment_refunds')->insert([
                'tenant_id' => $tenantId,
                'payment_id' => $lockedPayment->id,
                'stripe_refund_id' => (string) $refund->id,
                'amount' => $refundAmount,
                'platform_fee_reversal' => $feeReversal,
                'seller_payout_reversal' => $payoutReversal,
                'reason' => mb_substr($reason, 0, 500),
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            $newRefundTotal = min(
                (float) $lockedPayment->amount,
                StripeCurrency::roundMajor(
                    (float) ($lockedPayment->refund_amount ?? 0) + $refundAmount,
                    $currency,
                ),
            );
            $isFullRefund = $newRefundTotal >= (float) $lockedPayment->amount - 0.005;
            $lockedPayment->refund_amount = $newRefundTotal;
            $lockedPayment->refund_reason = $reason;
            $lockedPayment->refunded_at = now();
            $lockedPayment->status = $isFullRefund ? 'refunded' : 'partially_refunded';
            $lockedPayment->platform_fee = $isFullRefund
                ? 0
                : max(0, StripeCurrency::roundMajor(
                    (float) $lockedPayment->platform_fee - $feeReversal,
                    $currency,
                ));
            $lockedPayment->seller_payout = $isFullRefund
                ? 0
                : max(0, StripeCurrency::roundMajor(
                    (float) $lockedPayment->seller_payout - $payoutReversal,
                    $currency,
                ));
            if ($isFullRefund && $lockedPayment->funds_flow === 'separate_charge_transfer') {
                $lockedPayment->payout_status = 'failed';
            }
            $lockedPayment->save();

            $escrow = MarketplaceEscrow::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('order_id', $lockedOrder->id)
                ->lockForUpdate()
                ->first();
            if ($escrow) {
                $escrow->amount = (float) $lockedPayment->seller_payout;
                if ($isFullRefund) {
                    $escrow->status = 'refunded';
                    $escrow->released_at = now();
                    $escrow->release_trigger = null;
                }
                $escrow->save();
            }

            if ($isFullRefund && $lockedOrder->status !== 'refunded') {
                $lockedOrder->status = 'refunded';
                $lockedOrder->save();

                MarketplaceOrderService::restoreInventoryForRefund($lockedOrder);
            }
        });

        // Audit trail for the compensating fee reversal — structured log acts as
        // the ledger entry until a dedicated marketplace_ledger table exists.
        Log::info('MarketplacePayment: platform fee reversed on refund', [
            'payment_id' => $payment->id,
            'order_id' => $order->id,
            'tenant_id' => $payment->tenant_id,
            'refund_amount' => $refundAmount,
            'platform_fee_reversal' => $feeReversal,
            'seller_payout_reversal' => $payoutReversal,
            'full_refund' => $isFullRefund,
        ]);

        Log::info('MarketplacePayment: refund processed', [
            'order_id' => $order->id,
            'payment_id' => $payment->id,
            'refund_amount' => $refundAmount,
            'full_refund' => $isFullRefund,
        ]);

        if (!self::sendMarketplaceRefundNotifications($payment->fresh() ?? $payment, $order->fresh() ?? $order, $refundAmount, $isFullRefund)) {
            Log::warning('[MarketplacePaymentService] refund notification failed after manual refund', [
                'payment_id' => $payment->id,
                'order_id' => $order->id,
                'tenant_id' => $tenantId,
            ]);
        }

        return $payment->fresh();
    }

    // -----------------------------------------------------------------
    //  Webhook handlers
    // -----------------------------------------------------------------

    /**
     * Handle Stripe webhook events relevant to marketplace payments.
     *
     * Called from StripeWebhookController for marketplace-related events.
     *
     * @param string $eventType  Stripe event type
     * @param object $eventData  Stripe event data object
     */
    public static function handleWebhookEvent(string $eventType, object $eventData): void
    {
        match ($eventType) {
            'checkout.session.completed' => self::handleCheckoutSessionCompleted($eventData),
            'payment_intent.succeeded' => self::handlePaymentIntentSucceeded($eventData),
            'charge.refunded' => self::handleChargeRefunded($eventData),
            'charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed'
                => self::handleChargeDispute($eventType, $eventData),
            'account.updated' => self::handleAccountUpdated($eventData),
            default => null,
        };
    }

    /**
     * Serialize every Stripe-originated refund/chargeback with manual refunds
     * and escrow release for the same payment. The lock deliberately spans the
     * remote reversal and its local ledger commit.
     */
    private static function withMoneyMovementLock(
        int $tenantId,
        int $paymentId,
        callable $callback,
    ): mixed {
        try {
            return Cache::lock("marketplace-money-movement:{$tenantId}:{$paymentId}", 180)
                ->block(10, $callback);
        } catch (\Illuminate\Contracts\Cache\LockTimeoutException $exception) {
            throw new \RuntimeException(__('api.marketplace_payout_processing'), previous: $exception);
        }
    }

    /**
     * A scheduled payout is between its local claim and durable transfer
     * persistence. It is never safe for a webhook to commit a refund/dispute
     * against that ambiguous state; fail the event so Stripe retries it.
     */
    private static function paymentReadyForWebhookMovement(
        int $tenantId,
        int $paymentId,
    ): MarketplacePayment {
        $payment = MarketplacePayment::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($paymentId)
            ->firstOrFail();
        if ($payment->payout_status === 'scheduled') {
            throw new \RuntimeException(__('api.marketplace_payout_processing'));
        }
        if ($payment->funds_flow === 'separate_charge_transfer'
            && $payment->payout_status === 'paid'
            && empty($payment->payout_id)) {
            throw new \RuntimeException(__('api.marketplace_payout_processing'));
        }

        return $payment;
    }

    /**
     * Handle checkout.session.completed for a marketplace order — the no-JS
     * Checkout flow's confirmation. Resolve the order from OUR DB (never trust
     * the tenant from Stripe metadata; we read the order's own tenant_id),
     * associate the resulting PaymentIntent, then reuse confirmPayment() which
     * re-verifies the PI succeeded, records the payment, transitions the order to
     * 'paid', holds escrow and sends notifications — all idempotently.
     */
    private static function handleCheckoutSessionCompleted(object $session): void
    {
        // A marketplace session always carries nexus_order_id (and normally
        // nexus_type='marketplace'). Treat EITHER marker as marketplace so a
        // session that somehow lost nexus_type is still reconciled rather than
        // silently dropped after the buyer has paid.
        $orderId = (int) ($session->metadata->nexus_order_id ?? $session->client_reference_id ?? 0);
        $isMarketplace = (($session->metadata->nexus_type ?? null) === 'marketplace') || $orderId > 0;
        if (!$isMarketplace) {
            return; // not a marketplace checkout
        }
        // Stripe only fires this once the buyer has actually paid.
        if (($session->payment_status ?? '') !== 'paid') {
            return;
        }

        $piId = $session->payment_intent ?? null;
        $piId = is_string($piId) ? $piId : ($piId->id ?? null);

        // A genuine marketplace order whose PaymentIntent is not yet linked to the
        // session (Stripe async lag) must NOT be silently dropped — throw so the
        // controller marks the event failed and Stripe retries it. A missing
        // order id is a malformed/foreign event: log and drop (no retry storm).
        if ($orderId <= 0) {
            Log::warning('MarketplacePayment webhook: checkout.session.completed has no order id', [
                'session_id' => $session->id ?? null,
            ]);
            return;
        }
        if (!$piId) {
            Log::warning('MarketplacePayment webhook: PaymentIntent not yet linked to session; will retry', [
                'order_id' => $orderId,
                'session_id' => $session->id ?? null,
            ]);
            throw new \RuntimeException(__('api.marketplace_payment_intent_checkout_unlinked'));
        }

        // Trust ONLY our own DB for the order + its tenant. Stripe signature
        // verification already guarantees the event is genuine for a session we
        // created, but resolving tenant from the order row (not metadata) keeps
        // the same defence-in-depth posture as handlePaymentIntentSucceeded.
        $orderRecord = MarketplaceOrder::withoutGlobalScopes()->find($orderId);
        if (!$orderRecord) {
            Log::warning('MarketplacePayment webhook: no local order for checkout session', [
                'order_id' => $orderId,
                'session_id' => $session->id ?? null,
            ]);
            return;
        }

        $tenantId = (int) $orderRecord->tenant_id;
        if ($tenantId <= 0) {
            return;
        }

        $previousTenantId = TenantContext::currentId();
        try {
            TenantContext::setById($tenantId);

            // Associate the PaymentIntent so confirmPayment() can find the order.
            // Row-locked so a concurrent payment_intent.succeeded webhook for the
            // same purchase can't race the association (confirmPayment is itself
            // idempotent, but this keeps the write single-writer).
            DB::transaction(function () use ($orderId, $tenantId, $piId, $session) {
                $order = MarketplaceOrder::where('id', $orderId)
                    ->where('tenant_id', $tenantId)
                    ->lockForUpdate()
                    ->first();
                if ($order) {
                    $boundMode = (string) ($order->stripe_checkout_mode ?? '');
                    if ($boundMode !== '' && $boundMode !== 'checkout_session') {
                        throw new \RuntimeException(__('api.marketplace_checkout_mode_conflict'));
                    }
                    if (! empty($order->checkout_session_id)
                        && (string) $order->checkout_session_id !== (string) ($session->id ?? '')) {
                        throw new \RuntimeException(__('api.marketplace_payment_intent_order_mismatch'));
                    }
                    $order->stripe_checkout_mode = 'checkout_session';
                    $order->checkout_session_id = (string) ($session->id ?? '');
                    if (empty($order->payment_intent_id)) {
                        $order->payment_intent_id = $piId;
                    }
                    $order->save();
                }
            });

            self::confirmPayment($piId);
        } catch (\Exception $e) {
            Log::error('MarketplacePayment webhook: checkout confirmPayment failed', [
                'order_id' => $orderId,
                'session_id' => $session->id ?? null,
                'error' => $e->getMessage(),
            ]);
            throw $e; // let the controller mark the event failed so Stripe retries
        } finally {
            if ($previousTenantId !== null) {
                TenantContext::setById($previousTenantId);
            } else {
                TenantContext::reset();
            }
        }
    }

    /**
     * Handle payment_intent.succeeded — confirm marketplace payment.
     */
    private static function handlePaymentIntentSucceeded(object $paymentIntent): void
    {
        $nexusType = $paymentIntent->metadata->nexus_type ?? null;

        if ($nexusType !== 'marketplace') {
            return; // Not a marketplace payment, skip
        }

        $piId = $paymentIntent->id ?? null;
        if (!$piId) {
            return;
        }

        // SECURITY: Do NOT trust tenant_id from webhook metadata — an attacker
        // controlling a PaymentIntent could manipulate metadata to pivot into other
        // tenants. Resolve tenant_id from our own DB record keyed on the Stripe
        // payment_intent_id (which Stripe controls and we cannot forge).
        $paymentRecord = MarketplacePayment::withoutGlobalScopes()
            ->where('stripe_payment_intent_id', $piId)
            ->first();

        $orderRecord = $paymentRecord
            ? MarketplaceOrder::withoutGlobalScopes()->find($paymentRecord->order_id)
            : MarketplaceOrder::withoutGlobalScopes()
                ->where('payment_intent_id', $piId)
                ->first();

        if (!$orderRecord) {
            Log::warning('MarketplacePayment webhook: no local order/payment record for PI - rejecting event', [
                'payment_intent_id' => $piId,
            ]);
            return;
        }

        $orderId = (int) $orderRecord->id;
        $tenantId = (int) $orderRecord->tenant_id;

        if (!$orderId || !$tenantId) {
            Log::warning('MarketplacePayment webhook: local record missing order/tenant - rejecting event', [
                'payment_intent_id' => $piId,
                'payment_id' => $paymentRecord->id ?? null,
                'order_id' => $orderRecord->id ?? null,
            ]);
            return;
        }

        // Set tenant context from our trusted DB record (never from Stripe metadata)
        $previousTenantId = TenantContext::currentId();
        try {
            TenantContext::setById($tenantId);
            self::confirmPayment($piId);
        } catch (\Exception $e) {
            Log::error('MarketplacePayment webhook: confirmPayment failed', [
                'payment_intent_id' => $piId,
                'order_id' => $orderId,
                'error' => $e->getMessage(),
            ]);
            throw $e;
        } finally {
            if ($previousTenantId !== null) {
                TenantContext::setById($previousTenantId);
            } else {
                TenantContext::reset();
            }
        }
    }

    /**
     * Handle charge.refunded — update marketplace payment record.
     */
    private static function handleChargeRefunded(object $charge): void
    {
        $piId = $charge->payment_intent ?? null;
        if (!$piId) {
            return;
        }

        $payment = MarketplacePayment::withoutGlobalScopes()
            ->where('stripe_payment_intent_id', $piId)
            ->first();

        if (!$payment) {
            return; // Not a marketplace payment
        }

        $order = MarketplaceOrder::withoutGlobalScopes()->find($payment->order_id);
        if (! $order) {
            Log::error('MarketplacePayment webhook: refund has no local order', [
                'payment_id' => $payment->id,
                'payment_intent_id' => $piId,
            ]);
            return;
        }
        $tenantId = (int) $payment->tenant_id;
        if ($tenantId <= 0 || (int) $order->tenant_id !== $tenantId) {
            Log::error('MarketplacePayment webhook: refund tenant mismatch', [
                'payment_id' => $payment->id,
                'order_id' => $order->id,
            ]);
            return;
        }

        TenantContext::runForTenant($tenantId, static function () use ($charge, $payment, $order, $piId, $tenantId): void {
        self::withMoneyMovementLock($tenantId, (int) $payment->id, static function () use (
            $charge,
            $payment,
            $order,
            $piId,
            $tenantId,
        ): void {
        $payment = self::paymentReadyForWebhookMovement($tenantId, (int) $payment->id);
        $order = MarketplaceOrder::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($order->id)
            ->firstOrFail();
        $currency = StripeCurrency::normalize((string) $payment->currency);

        $refunds = is_iterable($charge->refunds->data ?? null)
            ? $charge->refunds->data
            : [];
        foreach ($refunds as $refund) {
            $refundId = (string) ($refund->id ?? '');
            $refundAmount = StripeCurrency::fromMinor((int) ($refund->amount ?? 0), $currency);
            if ($refundId === '' || $refundAmount <= 0) {
                continue;
            }
            self::reconcileExternalRefund($payment, $order, $charge, $refund, $refundId, $refundAmount);
        }

        // Some Stripe API versions omit the expanded refunds collection. Use a
        // deterministic cumulative key for only the unrecorded difference.
        $payment->refresh();
        $refundedAmount = StripeCurrency::fromMinor((int) ($charge->amount_refunded ?? 0), $currency);
        $unrecorded = StripeCurrency::roundMajor(
            $refundedAmount - (float) ($payment->refund_amount ?? 0),
            $currency,
        );
        if ($unrecorded > 0) {
            $fallbackId = sprintf(
                'charge:%s:%d',
                (string) ($charge->id ?? $piId),
                StripeCurrency::toMinor($refundedAmount, $currency),
            );
            $fallbackRefund = (object) [
                'id' => $fallbackId,
                'amount' => StripeCurrency::toMinor($unrecorded, $currency),
            ];
            self::reconcileExternalRefund($payment, $order, $charge, $fallbackRefund, $fallbackId, $unrecorded);
        }

        $payment->refresh();
        $order->refresh();
        $isFullRefund = (string) $payment->status === 'refunded';
        if (! self::marketplaceRefundNotificationsHaveEvidence($payment, $order)) {
            $sent = self::sendMarketplaceRefundNotifications(
                $payment,
                $order,
                (float) ($payment->refund_amount ?? 0),
                $isFullRefund,
            );
            if (!$sent) {
                Log::warning('MarketplacePayment webhook: refund notification email not sent (will not fail webhook)', [
                    'payment_id' => $payment->id,
                ]);
            }
        }

        Log::info('MarketplacePayment webhook: charge refunded', [
            'payment_id' => $payment->id,
            'payment_intent_id' => $piId,
            'refunded_amount' => (float) ($payment->refund_amount ?? 0),
        ]);
        });
        });
    }

    /**
     * Apply one externally-created Stripe refund to transfer, fee, escrow and
     * inventory ledgers. The Stripe refund ID is the idempotency boundary.
     */
    private static function reconcileExternalRefund(
        MarketplacePayment $payment,
        MarketplaceOrder $order,
        object $charge,
        object $refund,
        string $refundId,
        float $refundAmount,
    ): void {
        if (DB::table('marketplace_payment_refunds')->where('stripe_refund_id', $refundId)->exists()) {
            return;
        }

        $currency = StripeCurrency::normalize((string) $payment->currency);
        $remainingRefundable = max(0.0, StripeCurrency::roundMajor(
            (float) $payment->amount - (float) ($payment->refund_amount ?? 0),
            $currency,
        ));
        $refundAmount = min($remainingRefundable, StripeCurrency::roundMajor($refundAmount, $currency));
        if ($refundAmount <= 0) {
            return;
        }

        $feeReversal = $remainingRefundable > 0
            ? StripeCurrency::roundMajor(
                (float) $payment->platform_fee * ($refundAmount / $remainingRefundable),
                $currency,
            )
            : 0.0;
        $payoutReversal = min(
            (float) $payment->seller_payout,
            max(0.0, StripeCurrency::roundMajor($refundAmount - $feeReversal, $currency)),
        );
        $client = StripeService::client();

        $transferId = $payment->funds_flow === 'separate_charge_transfer'
            ? (string) ($payment->payout_id ?? '')
            : (is_string($charge->transfer ?? null)
                ? $charge->transfer
                : (string) ($charge->transfer->id ?? ''));
        $alreadyReversed = ! empty($refund->transfer_reversal ?? null)
            || ! empty($refund->source_transfer_reversal ?? null);
        if ($payoutReversal > 0 && $transferId !== '' && ! $alreadyReversed) {
            $client->transfers->createReversal(
                $transferId,
                ['amount' => StripeCurrency::toMinor($payoutReversal, $currency)],
                ['idempotency_key' => 'marketplace-external-transfer-reversal-' . hash('sha256', $refundId)],
            );
        }

        $applicationFeeId = is_string($charge->application_fee ?? null)
            ? $charge->application_fee
            : (string) ($charge->application_fee->id ?? '');
        if ($payment->funds_flow !== 'separate_charge_transfer'
            && $feeReversal > 0
            && $applicationFeeId !== ''
            && empty($refund->application_fee_refund ?? null)) {
            $client->applicationFees->createRefund(
                $applicationFeeId,
                ['amount' => StripeCurrency::toMinor($feeReversal, $currency)],
                ['idempotency_key' => 'marketplace-external-fee-refund-' . hash('sha256', $refundId)],
            );
        }

        DB::transaction(function () use (
            $payment,
            $order,
            $refundId,
            $refundAmount,
            $feeReversal,
            $payoutReversal,
            $currency,
        ): void {
            $lockedPayment = MarketplacePayment::withoutGlobalScopes()
                ->where('tenant_id', $payment->tenant_id)
                ->whereKey($payment->id)
                ->lockForUpdate()
                ->firstOrFail();
            $lockedOrder = MarketplaceOrder::withoutGlobalScopes()
                ->where('tenant_id', $payment->tenant_id)
                ->whereKey($order->id)
                ->lockForUpdate()
                ->firstOrFail();
            if (DB::table('marketplace_payment_refunds')->where('stripe_refund_id', $refundId)->exists()) {
                return;
            }

            DB::table('marketplace_payment_refunds')->insert([
                'tenant_id' => $payment->tenant_id,
                'payment_id' => $lockedPayment->id,
                'stripe_refund_id' => $refundId,
                'amount' => $refundAmount,
                'platform_fee_reversal' => $feeReversal,
                'seller_payout_reversal' => $payoutReversal,
                'reason' => 'external_stripe_refund',
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            $newRefundTotal = min(
                (float) $lockedPayment->amount,
                StripeCurrency::roundMajor(
                    (float) ($lockedPayment->refund_amount ?? 0) + $refundAmount,
                    $currency,
                ),
            );
            $isFullRefund = $newRefundTotal >= (float) $lockedPayment->amount - 0.005;
            $lockedPayment->refund_amount = $newRefundTotal;
            $lockedPayment->refund_reason = 'external_stripe_refund';
            $lockedPayment->refunded_at = now();
            $lockedPayment->status = $isFullRefund ? 'refunded' : 'partially_refunded';
            $lockedPayment->platform_fee = $isFullRefund
                ? 0
                : max(0, StripeCurrency::roundMajor(
                    (float) $lockedPayment->platform_fee - $feeReversal,
                    $currency,
                ));
            $lockedPayment->seller_payout = $isFullRefund
                ? 0
                : max(0, StripeCurrency::roundMajor(
                    (float) $lockedPayment->seller_payout - $payoutReversal,
                    $currency,
                ));
            if ($isFullRefund) {
                $lockedPayment->payout_status = 'failed';
            }
            $lockedPayment->save();

            $escrow = MarketplaceEscrow::withoutGlobalScopes()
                ->where('tenant_id', $payment->tenant_id)
                ->where('order_id', $lockedOrder->id)
                ->lockForUpdate()
                ->first();
            if ($escrow) {
                $escrow->amount = (float) $lockedPayment->seller_payout;
                if ($isFullRefund) {
                    $escrow->status = 'refunded';
                    $escrow->released_at = now();
                    $escrow->release_trigger = null;
                }
                $escrow->save();
            }

            if ($isFullRefund && $lockedOrder->status !== 'refunded') {
                $lockedOrder->status = 'refunded';
                $lockedOrder->save();
                MarketplaceOrderService::restoreInventoryForRefund($lockedOrder);
            }
        });
    }

    /** Reconcile Stripe chargeback lifecycle with marketplace payout state. */
    private static function handleChargeDispute(string $eventType, object $dispute): void
    {
        $chargeId = is_string($dispute->charge ?? null)
            ? $dispute->charge
            : (string) ($dispute->charge->id ?? '');
        $disputeId = (string) ($dispute->id ?? '');
        if ($chargeId === '' || $disputeId === '') {
            return;
        }

        $payment = MarketplacePayment::withoutGlobalScopes()
            ->where('stripe_charge_id', $chargeId)
            ->first();
        if (! $payment) {
            return;
        }
        $order = MarketplaceOrder::withoutGlobalScopes()->find($payment->order_id);
        if (! $order) {
            return;
        }

        $tenantId = (int) $payment->tenant_id;
        if ($tenantId <= 0 || (int) $order->tenant_id !== $tenantId) {
            Log::error('MarketplacePayment webhook: dispute tenant mismatch', [
                'payment_id' => $payment->id,
                'order_id' => $order->id,
                'dispute_id' => $disputeId,
            ]);
            return;
        }

        TenantContext::runForTenant($tenantId, static function () use (
            $eventType,
            $dispute,
            $disputeId,
            $chargeId,
            $payment,
            $order,
            $tenantId,
        ): void {
        self::withMoneyMovementLock($tenantId, (int) $payment->id, static function () use (
            $eventType,
            $dispute,
            $disputeId,
            $chargeId,
            $payment,
            $order,
            $tenantId,
        ): void {
        $payment = self::paymentReadyForWebhookMovement($tenantId, (int) $payment->id);
        $order = MarketplaceOrder::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($order->id)
            ->firstOrFail();
        $status = (string) ($dispute->status ?? 'needs_response');
        $currency = StripeCurrency::normalize((string) $payment->currency);
        $isWon = $status === 'won';
        $isLost = $status === 'lost';
        $remainingExposure = max(
            0.0,
            StripeCurrency::roundMajor(
                (float) $payment->amount - (float) ($payment->refund_amount ?? 0),
                $currency,
            ),
        );
        $disputeAmount = min(
            $remainingExposure,
            max(0.0, StripeCurrency::fromMinor((int) ($dispute->amount ?? 0), $currency)),
        );
        $sellerShare = $remainingExposure > 0
            ? min(
                (float) $payment->seller_payout,
                StripeCurrency::roundMajor(
                    (float) $payment->seller_payout * ($disputeAmount / $remainingExposure),
                    $currency,
                ),
            )
            : 0.0;
        $feeShare = $remainingExposure > 0
            ? min(
                (float) $payment->platform_fee,
                StripeCurrency::roundMajor(
                    (float) $payment->platform_fee * ($disputeAmount / $remainingExposure),
                    $currency,
                ),
            )
            : 0.0;
        $ledgerId = 'dispute:' . $disputeId;
        $existingLedger = DB::table('marketplace_payment_refunds')
            ->where('stripe_refund_id', $ledgerId)
            ->first();
        $transferWasReversed = false;

        // A won dispute returns the funds to the platform, but Stripe does not
        // recreate a separate Connect transfer that we explicitly reversed.
        // Reimburse only that recorded seller share, using a durable
        // idempotency key so webhook retries cannot duplicate the transfer.
        if ($isWon
            && ($existingLedger->reason ?? null) === 'stripe_dispute_hold'
            && (float) ($existingLedger->seller_payout_reversal ?? 0) > 0) {
            $sellerProfile = MarketplaceSellerProfile::withoutGlobalScopes()
                ->where('tenant_id', $payment->tenant_id)
                ->where('user_id', $order->seller_id)
                ->first();
            if (! $sellerProfile || empty($sellerProfile->stripe_account_id)) {
                throw new \RuntimeException(__('api.marketplace_dispute_reimbursement_unavailable'));
            }
            StripeService::client()->transfers->create([
                'amount' => StripeCurrency::toMinor(
                    (float) $existingLedger->seller_payout_reversal,
                    $currency,
                ),
                'currency' => strtolower((string) $payment->currency),
                'destination' => $sellerProfile->stripe_account_id,
                'source_transaction' => $payment->stripe_charge_id,
                'transfer_group' => 'marketplace_order_' . $order->id,
                'metadata' => [
                    'nexus_tenant_id' => (string) $payment->tenant_id,
                    'nexus_order_id' => (string) $order->id,
                    'nexus_payment_id' => (string) $payment->id,
                    'nexus_type' => 'marketplace_dispute_reimbursement',
                ],
            ], [
                'idempotency_key' => 'marketplace-dispute-transfer-reimbursement-' . hash('sha256', $disputeId),
            ]);
        }

        // An early dispute event can arrive while escrow is still held and
        // therefore record a zero-reversal hold. If a payout is subsequently
        // persisted before the lost event, that zero entry must not suppress
        // the now-required transfer reversal.
        $ledgerHasSellerReversal = (float) ($existingLedger->seller_payout_reversal ?? 0) > 0;
        $shouldReverseTransfer = ! $isWon
            && ! $ledgerHasSellerReversal
            && (
                ($payment->funds_flow === 'separate_charge_transfer' && $payment->payout_status === 'paid')
                || ($isLost && $payment->funds_flow === 'destination_charge')
            );
        if ($shouldReverseTransfer && $sellerShare > 0) {
            $client = StripeService::client();
            $transferId = (string) ($payment->payout_id ?? '');
            if ($transferId === '') {
                $charge = $client->charges->retrieve($chargeId);
                $transferId = is_string($charge->transfer ?? null)
                    ? $charge->transfer
                    : (string) ($charge->transfer->id ?? '');
            }
            if ($transferId !== '') {
                $client->transfers->createReversal(
                    $transferId,
                    ['amount' => StripeCurrency::toMinor($sellerShare, $currency)],
                    ['idempotency_key' => 'marketplace-dispute-transfer-reversal-' . hash('sha256', $disputeId)],
                );
                $transferWasReversed = true;
            } else {
                throw new \RuntimeException(__('api.marketplace_dispute_transfer_not_found'));
            }
        }

        DB::transaction(function () use (
            $payment,
            $order,
            $disputeId,
            $status,
            $isWon,
            $isLost,
            $disputeAmount,
            $sellerShare,
            $feeShare,
            $ledgerId,
            $transferWasReversed,
            $currency,
        ): void {
            $lockedPayment = MarketplacePayment::withoutGlobalScopes()
                ->where('tenant_id', $payment->tenant_id)
                ->whereKey($payment->id)
                ->lockForUpdate()
                ->firstOrFail();
            $lockedOrder = MarketplaceOrder::withoutGlobalScopes()
                ->where('tenant_id', $payment->tenant_id)
                ->whereKey($order->id)
                ->lockForUpdate()
                ->firstOrFail();
            $escrow = MarketplaceEscrow::withoutGlobalScopes()
                ->where('tenant_id', $payment->tenant_id)
                ->where('order_id', $lockedOrder->id)
                ->lockForUpdate()
                ->first();

            $lockedPayment->stripe_dispute_id = $disputeId;
            $lockedPayment->stripe_dispute_status = $status;
            if ($lockedPayment->dispute_previous_order_status === null
                && $lockedOrder->status !== 'disputed') {
                $lockedPayment->dispute_previous_order_status = $lockedOrder->status;
            }

            $ledger = DB::table('marketplace_payment_refunds')
                ->where('stripe_refund_id', $ledgerId)
                ->lockForUpdate()
                ->first();

            if ($isWon) {
                if (($ledger->reason ?? null) === 'stripe_dispute_hold') {
                    $reinstatedPayout = (float) ($ledger->seller_payout_reversal ?? 0);
                    $lockedPayment->seller_payout = round(
                        (float) $lockedPayment->seller_payout + $reinstatedPayout,
                        2,
                    );
                    DB::table('marketplace_payment_refunds')
                        ->where('id', $ledger->id)
                        ->update([
                            'reason' => 'stripe_dispute_won',
                            'updated_at' => now(),
                        ]);
                }
                if ($lockedOrder->status === 'disputed') {
                    $lockedOrder->status = $lockedPayment->dispute_previous_order_status ?: 'paid';
                    $lockedOrder->save();
                }
                if ($escrow && $escrow->status === 'disputed') {
                    $escrow->status = 'held';
                    $escrow->release_after = now();
                    $escrow->amount = (float) $lockedPayment->seller_payout;
                    $escrow->save();
                }
                if ($lockedPayment->paid_out_at !== null) {
                    $lockedPayment->payout_status = 'paid';
                }
            } elseif ($isLost) {
                if (($ledger->reason ?? null) !== 'stripe_dispute_lost') {
                    $reversalAlreadyApplied = ($ledger->reason ?? null) === 'stripe_dispute_hold'
                        && (float) ($ledger->seller_payout_reversal ?? 0) > 0;
                    $recordedSellerReversal = $reversalAlreadyApplied
                        ? (float) ($ledger->seller_payout_reversal ?? 0)
                        : $sellerShare;
                    if ($ledger === null) {
                        DB::table('marketplace_payment_refunds')->insert([
                            'tenant_id' => $payment->tenant_id,
                            'payment_id' => $lockedPayment->id,
                            'stripe_refund_id' => $ledgerId,
                            'amount' => $disputeAmount,
                            'platform_fee_reversal' => $feeShare,
                            'seller_payout_reversal' => $recordedSellerReversal,
                            'reason' => 'stripe_dispute_lost',
                            'created_at' => now(),
                            'updated_at' => now(),
                        ]);
                    } else {
                        DB::table('marketplace_payment_refunds')
                            ->where('id', $ledger->id)
                            ->update([
                                'amount' => $disputeAmount,
                                'platform_fee_reversal' => $feeShare,
                                'seller_payout_reversal' => $recordedSellerReversal,
                                'reason' => 'stripe_dispute_lost',
                                'updated_at' => now(),
                            ]);
                    }

                    $newRefundTotal = min(
                        (float) $lockedPayment->amount,
                        StripeCurrency::roundMajor(
                            (float) ($lockedPayment->refund_amount ?? 0) + $disputeAmount,
                            $currency,
                        ),
                    );
                    $fullDispute = $newRefundTotal >= (float) $lockedPayment->amount - 0.005;
                    $lockedPayment->refund_amount = $newRefundTotal;
                    $lockedPayment->platform_fee = max(
                        0,
                        StripeCurrency::roundMajor(
                            (float) $lockedPayment->platform_fee - $feeShare,
                            $currency,
                        ),
                    );
                    if (! $reversalAlreadyApplied) {
                        $lockedPayment->seller_payout = max(
                            0,
                            StripeCurrency::roundMajor(
                                (float) $lockedPayment->seller_payout - $sellerShare,
                                $currency,
                            ),
                        );
                    }
                    $lockedPayment->refund_reason = 'stripe_dispute_lost';
                    $lockedPayment->refunded_at = now();
                    $lockedPayment->status = $fullDispute ? 'refunded' : 'partially_refunded';
                    $lockedPayment->payout_status = $fullDispute
                        ? 'failed'
                        : ($lockedPayment->paid_out_at !== null ? 'paid' : 'pending');
                    if ($escrow) {
                        $escrow->amount = (float) $lockedPayment->seller_payout;
                        if ($fullDispute) {
                            $escrow->status = 'refunded';
                            $escrow->released_at = now();
                            $escrow->release_trigger = null;
                        } elseif ($escrow->status === 'disputed') {
                            $escrow->status = $lockedPayment->paid_out_at !== null ? 'released' : 'held';
                            $escrow->release_after = $lockedPayment->paid_out_at === null ? now() : $escrow->release_after;
                        }
                        $escrow->save();
                    }
                    if ($fullDispute && $lockedOrder->status !== 'refunded') {
                        $lockedOrder->status = 'refunded';
                        $lockedOrder->save();
                        MarketplaceOrderService::restoreInventoryForRefund($lockedOrder);
                    } elseif (! $fullDispute && $lockedOrder->status === 'disputed') {
                        $lockedOrder->status = $lockedPayment->dispute_previous_order_status ?: 'paid';
                        $lockedOrder->save();
                    }
                }
            } else {
                if ($ledger === null) {
                    DB::table('marketplace_payment_refunds')->insert([
                        'tenant_id' => $payment->tenant_id,
                        'payment_id' => $lockedPayment->id,
                        'stripe_refund_id' => $ledgerId,
                        'amount' => 0,
                        'platform_fee_reversal' => 0,
                        'seller_payout_reversal' => $transferWasReversed ? $sellerShare : 0,
                        'reason' => 'stripe_dispute_hold',
                        'created_at' => now(),
                        'updated_at' => now(),
                    ]);
                    if ($transferWasReversed) {
                        $lockedPayment->seller_payout = max(
                            0,
                            StripeCurrency::roundMajor(
                                (float) $lockedPayment->seller_payout - $sellerShare,
                                $currency,
                            ),
                        );
                    }
                } elseif ($transferWasReversed
                    && (float) ($ledger->seller_payout_reversal ?? 0) <= 0) {
                    DB::table('marketplace_payment_refunds')
                        ->where('id', $ledger->id)
                        ->update([
                            'seller_payout_reversal' => $sellerShare,
                            'updated_at' => now(),
                        ]);
                    $lockedPayment->seller_payout = max(
                        0,
                        StripeCurrency::roundMajor(
                            (float) $lockedPayment->seller_payout - $sellerShare,
                            $currency,
                        ),
                    );
                }
                if (! in_array($lockedOrder->status, ['cancelled', 'refunded'], true)) {
                    $lockedOrder->status = 'disputed';
                    $lockedOrder->save();
                }
                if ($escrow && $escrow->status === 'held') {
                    $escrow->status = 'disputed';
                    $escrow->save();
                }
                if ($transferWasReversed) {
                    $lockedPayment->payout_status = (float) $lockedPayment->seller_payout > 0 ? 'paid' : 'failed';
                }
            }

            $lockedPayment->save();
        });

        Log::warning('Marketplace Stripe dispute reconciled', [
            'event_type' => $eventType,
            'dispute_id' => $disputeId,
            'status' => $status,
            'payment_id' => $payment->id,
            'order_id' => $order->id,
        ]);
        });
        });
    }

    private static function marketplaceRefundNotificationsHaveEvidence(MarketplacePayment $payment, MarketplaceOrder $order): bool
    {
        $users = DB::table('users')
            ->where('tenant_id', $payment->tenant_id)
            ->whereIn('id', [(int) $order->buyer_id, (int) $order->seller_id])
            ->select(['id', 'email', 'preferred_language'])
            ->get();

        $currency = StripeCurrency::normalize((string) $payment->currency);
        $amount = StripeCurrency::formatMajor((float) ($payment->refund_amount ?? 0), $currency);
        $isFullRefund = (string) $payment->status === 'refunded'
            || (float) ($payment->refund_amount ?? 0) >= (float) ($payment->amount ?? 0);
        $messageKey = $isFullRefund
            ? 'api_controllers_3.marketplace_order.refunded'
            : 'api_controllers_3.marketplace_order.partially_refunded';
        $link = '/marketplace/orders/' . $order->id;

        foreach ($users as $user) {
            $message = (string) LocaleContext::withLocale($user, fn (): string => __($messageKey, [
                'amount' => $amount,
                'currency' => $currency,
                'order_number' => $order->order_number,
            ]));
            $hasBellEvidence = DB::table('notifications')
                ->where('tenant_id', (int) $payment->tenant_id)
                ->where('user_id', (int) $user->id)
                ->where('type', 'marketplace_order')
                ->where('link', $link)
                ->where('message', $message)
                ->exists();
            if (!$hasBellEvidence) {
                return false;
            }

            if (empty($user->email)) {
                continue;
            }

            $hasEvidence = DB::table('email_log')
                ->where('tenant_id', (int) $payment->tenant_id)
                ->where('recipient_email', $user->email)
                ->where('category', 'marketplace_refund')
                ->whereIn('status', ['sent', 'delivered'])
                ->where('subject', 'like', '%' . $order->order_number . '%')
                ->exists();
            if (!$hasEvidence) {
                return false;
            }
        }

        return true;
    }

    private static function sendMarketplaceRefundNotifications(MarketplacePayment $payment, MarketplaceOrder $order, float $refundedAmount, bool $isFullRefund): bool
    {
        $previousTenantId = TenantContext::currentId();

        try {
            TenantContext::setById((int) $payment->tenant_id);

            $currency = StripeCurrency::normalize((string) $payment->currency);
            $amountFormatted = StripeCurrency::formatMajor($refundedAmount, $currency);
            $amountWithCurrency = $amountFormatted . ' ' . $currency;
            $buyerAmount = $isFullRefund ? $amountWithCurrency : $amountFormatted;
            $orderNumber = (string) $order->order_number;
            $link = '/marketplace/orders/' . $order->id;
            $fullUrl = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . $link;
            $listingTitle = DB::table('marketplace_listings')
                ->where('id', $order->marketplace_listing_id)
                ->where('tenant_id', $payment->tenant_id)
                ->value('title');

            $bellKey = $isFullRefund ? 'api_controllers_3.marketplace_order.refunded' : 'api_controllers_3.marketplace_order.partially_refunded';
            $bellParams = ['amount' => $amountFormatted, 'currency' => $currency, 'order_number' => $orderNumber];

            $allSent = true;
            $allSent = self::sendMarketplaceRefundNotificationToUser(
                (int) $payment->tenant_id,
                (int) $order->buyer_id,
                $bellKey,
                $bellParams,
                $link,
                $fullUrl,
                $orderNumber,
                $isFullRefund ? 'emails_misc.marketplace_order.refunded_buyer_subject' : 'emails_misc.marketplace_order.partially_refunded_subject',
                $isFullRefund ? 'emails_misc.marketplace_order.refunded_buyer_title' : 'emails_misc.marketplace_order.partially_refunded_title',
                $isFullRefund ? 'emails_misc.marketplace_order.refunded_buyer_body' : 'emails_misc.marketplace_order.partially_refunded_body',
                ['amount' => $buyerAmount, 'currency' => $currency, 'order_number' => $orderNumber, 'title' => (string) ($listingTitle ?? '')]
            ) && $allSent;

            $allSent = self::sendMarketplaceRefundNotificationToUser(
                (int) $payment->tenant_id,
                (int) $order->seller_id,
                $bellKey,
                $bellParams,
                $link,
                $fullUrl,
                $orderNumber,
                $isFullRefund ? 'emails_misc.marketplace_order.refunded_seller_subject' : 'emails_misc.marketplace_order.partially_refunded_seller_subject',
                $isFullRefund ? 'emails_misc.marketplace_order.refunded_seller_title' : 'emails_misc.marketplace_order.partially_refunded_seller_title',
                $isFullRefund ? 'emails_misc.marketplace_order.refunded_seller_body' : 'emails_misc.marketplace_order.partially_refunded_seller_body',
                ['amount' => $amountWithCurrency, 'currency' => $currency, 'order_number' => $orderNumber, 'title' => (string) ($listingTitle ?? '')],
                'emails_misc.marketplace_order.refund_reason_stripe_webhook'
            ) && $allSent;

            return $allSent;
        } catch (\Throwable $e) {
            Log::warning('MarketplacePayment webhook: refund notification failed', [
                'order_id' => $order->id,
                'error' => $e->getMessage(),
            ]);

            return false;
        } finally {
            if ($previousTenantId) {
                TenantContext::setById($previousTenantId);
            } else {
                TenantContext::reset();
            }
        }
    }

    /**
     * @param array<string,string> $bellParams
     * @param array<string,string> $bodyParams
     */
    private static function sendMarketplaceRefundNotificationToUser(
        int $tenantId,
        int $userId,
        string $bellKey,
        array $bellParams,
        string $link,
        string $fullUrl,
        string $orderNumber,
        string $subjectKey,
        string $titleKey,
        string $bodyKey,
        array $bodyParams,
        ?string $reasonKey = null
    ): bool {
        $user = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->select(['id', 'email', 'first_name', 'name', 'preferred_language'])
            ->first();

        if (!$user) {
            return true;
        }

        return (bool) LocaleContext::withLocale($user, function () use ($user, $userId, $tenantId, $bellKey, $bellParams, $link, $orderNumber, $subjectKey, $titleKey, $bodyKey, $bodyParams, $reasonKey, $fullUrl): bool {
            $bellMessage = __($bellKey, $bellParams);
            $bellExists = DB::table('notifications')
                ->where('tenant_id', $tenantId)
                ->where('user_id', $userId)
                ->where('type', 'marketplace_order')
                ->where('link', $link)
                ->where('message', $bellMessage)
                ->exists();

            if (!$bellExists) {
                Notification::create([
                    'tenant_id' => $tenantId,
                    'user_id' => $userId,
                    'message' => $bellMessage,
                    'link' => $link,
                    'type' => 'marketplace_order',
                    'created_at' => now(),
                ]);
            }

            if (empty($user->email)) {
                return true;
            }

            $subject = __($subjectKey, ['order_number' => $orderNumber]);
            $hasEmailEvidence = DB::table('email_log')
                ->where('tenant_id', $tenantId)
                ->where('recipient_email', $user->email)
                ->where('category', 'marketplace_refund')
                ->whereIn('status', ['sent', 'delivered'])
                ->where(function ($query) use ($subject, $orderNumber): void {
                    $query->where('subject', $subject)
                        ->orWhere('subject', 'like', '%' . $orderNumber . '%');
                })
                ->exists();

            if ($hasEmailEvidence) {
                return true;
            }

            $localizedBodyParams = $bodyParams;
            $title = trim((string) ($localizedBodyParams['title'] ?? ''));
            if ($title === '') {
                $title = __('emails_misc.marketplace_order.item_fallback');
            }
            $localizedBodyParams['title'] = htmlspecialchars($title, ENT_QUOTES, 'UTF-8');
            if ($reasonKey !== null) {
                $localizedBodyParams['reason'] = __($reasonKey);
            }

            $firstName = $user->first_name ?? $user->name ?? __('emails.common.fallback_name');
            $html = EmailTemplateBuilder::make()
                ->title(__($titleKey))
                ->greeting($firstName)
                ->paragraph(__($bodyKey, $localizedBodyParams))
                ->button(__('emails_misc.marketplace_order.order_cta'), $fullUrl)
                ->render();

            $sent = \App\Services\EmailDispatchService::sendRaw($user->email, $subject, $html, null, null, null, 'marketplace_refund', ['tenant_id' => $tenantId]);
            if (!$sent) {
                Log::warning('MarketplacePayment webhook: refund email returned false', [
                    'user_id' => $userId,
                ]);
            }

            return $sent;
        });
    }

    /**
     * Handle account.updated — check if Connect onboarding is complete.
     */
    private static function handleAccountUpdated(object $account): void
    {
        $accountId = $account->id ?? null;
        if (!$accountId) {
            return;
        }

        $sellerProfile = MarketplaceSellerProfile::withoutGlobalScopes()
            ->where('stripe_account_id', $accountId)
            ->first();

        if (!$sellerProfile) {
            return; // Not one of our marketplace sellers
        }

        $isOnboarded = ($account->details_submitted ?? false)
            && ($account->charges_enabled ?? false)
            && ($account->payouts_enabled ?? false);

        $wasOnboarded = (bool) $sellerProfile->stripe_onboarding_complete;
        if ($isOnboarded !== $wasOnboarded) {
            $sellerProfile->stripe_onboarding_complete = $isOnboarded;
            $sellerProfile->save();

            if (! $isOnboarded) {
                Log::warning('MarketplacePayment webhook: seller payout capability disabled', [
                    'user_id' => $sellerProfile->user_id,
                    'account_id' => $accountId,
                ]);
                return;
            }

            Log::info('MarketplacePayment webhook: seller onboarding complete via webhook', [
                'user_id' => $sellerProfile->user_id,
                'account_id' => $accountId,
            ]);

            // Bell the seller now that their payout account is live (success path:
            // after stripe_onboarding_complete has persisted true). Best-effort —
            // a bell failure must never break webhook processing.
            self::notifySellerOnboardingComplete(
                (int) $sellerProfile->user_id,
                (int) $sellerProfile->tenant_id
            );
        }
    }

    /**
     * Send an in-app bell to a seller when their Stripe Connect onboarding
     * completes (payouts now enabled). No email — bell only.
     *
     * Renders in the recipient's preferred_language and is tenant-safe via
     * Notification::createNotification (which forces tenant_id to the
     * recipient's users.tenant_id). Wrapped in try/catch so a notification
     * failure can never break the financial / onboarding flow.
     */
    private static function notifySellerOnboardingComplete(int $sellerId, int $tenantId): void
    {
        if ($sellerId <= 0) {
            return;
        }

        try {
            $recipient = DB::table('users')
                ->where('id', $sellerId)
                ->where('tenant_id', $tenantId)
                ->select(['id', 'preferred_language'])
                ->first();

            if (!$recipient) {
                return;
            }

            LocaleContext::withLocale($recipient, function () use ($sellerId): void {
                Notification::createNotification(
                    $sellerId,
                    __('svc_notifications.marketplace_payout.onboarding_complete_bell'),
                    '/marketplace/seller/dashboard',
                    'marketplace_payout'
                );
                \App\Services\NotificationDispatcher::fanOutPush((int) $sellerId, 'marketplace_payout', __('svc_notifications.marketplace_payout.onboarding_complete_bell'), '/marketplace/seller/dashboard');
            });
        } catch (\Throwable $e) {
            Log::warning('[MarketplacePaymentService] onboarding-complete bell failed', [
                'seller_id' => $sellerId,
                'tenant_id' => $tenantId,
                'error' => $e->getMessage(),
            ]);
        }
    }

    // -----------------------------------------------------------------
    //  Read — Seller payout & balance queries
    // -----------------------------------------------------------------

    /**
     * Get payout history for a seller.
     *
     * @param int $userId Seller's user ID
     * @param int $limit  Max results
     * @param int $offset Offset for pagination
     * @return array{items: array, total: int}
     */
    public static function getSellerPayouts(int $userId, int $limit = 20, int $offset = 0): array
    {
        $query = MarketplacePayment::whereHas('order', function ($q) use ($userId) {
            $q->where('seller_id', $userId);
        })->whereIn('status', ['succeeded', 'partially_refunded']);

        $total = $query->count();

        $items = $query->orderBy('id', 'desc')
            ->offset($offset)
            ->limit($limit)
            ->get()
            ->map(function (MarketplacePayment $p) {
                return [
                    'id' => $p->id,
                    'order_id' => $p->order_id,
                    'amount' => (float) $p->amount,
                    'platform_fee' => (float) $p->platform_fee,
                    'seller_payout' => (float) $p->seller_payout,
                    'currency' => $p->currency,
                    'status' => $p->status,
                    'payout_status' => $p->payout_status,
                    'payout_id' => $p->payout_id,
                    'paid_out_at' => $p->paid_out_at?->toISOString(),
                    'created_at' => $p->created_at?->toISOString(),
                ];
            })
            ->all();

        return ['items' => $items, 'total' => $total];
    }

    /**
     * Get the seller's pending balance (total of payments not yet paid out).
     *
     * @param int $userId Seller's user ID
     * @return array{pending: float|null, available: float|null, currency: string|null, total_earned: float|null, balances_by_currency: array<int,array{currency:string,pending:float,available:float,total_earned:float}>}
     */
    public static function getSellerBalance(int $userId): array
    {
        $baseQuery = MarketplacePayment::whereHas('order', function ($q) use ($userId) {
            $q->where('seller_id', $userId);
        })->whereIn('status', ['succeeded', 'partially_refunded']);

        $balances = (clone $baseQuery)
            ->selectRaw("UPPER(currency) as currency,
                SUM(CASE WHEN payout_status = 'pending' THEN seller_payout ELSE 0 END) as pending,
                SUM(CASE WHEN payout_status IN ('scheduled', 'paid') THEN seller_payout ELSE 0 END) as available,
                SUM(seller_payout) as total_earned")
            ->groupByRaw('UPPER(currency)')
            ->orderBy('currency')
            ->get()
            ->map(static function ($row): array {
                $currency = StripeCurrency::normalize((string) $row->currency);
                return [
                    'currency' => $currency,
                    'pending' => StripeCurrency::roundMajor((float) $row->pending, $currency),
                    'available' => StripeCurrency::roundMajor((float) $row->available, $currency),
                    'total_earned' => StripeCurrency::roundMajor((float) $row->total_earned, $currency),
                ];
            })
            ->all();
        $single = count($balances) <= 1 ? ($balances[0] ?? null) : null;

        return [
            'pending' => $single['pending'] ?? null,
            'available' => $single['available'] ?? null,
            'currency' => $single['currency'] ?? null,
            'total_earned' => $single['total_earned'] ?? null,
            'balances_by_currency' => $balances,
        ];
    }

    // -----------------------------------------------------------------
    //  Internal helpers
    // -----------------------------------------------------------------

    /** Bind a PaymentIntent only while the locked local order remains payable. */
    private static function bindPaymentIntentToPayableOrder(
        MarketplaceOrder $order,
        string $paymentIntentId,
        int $tenantId,
    ): void {
        DB::transaction(function () use ($order, $paymentIntentId, $tenantId): void {
            $lockedOrder = MarketplaceOrder::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereKey($order->id)
                ->lockForUpdate()
                ->firstOrFail();
            if ($lockedOrder->status !== 'pending_payment') {
                throw new \InvalidArgumentException(
                    __('api.marketplace_payment_intent_order_state_required'),
                );
            }
            if ($lockedOrder->payment_expires_at !== null
                && $lockedOrder->payment_expires_at->isPast()) {
                throw new \InvalidArgumentException(__('api.marketplace_checkout_expired'));
            }
            if (! empty($lockedOrder->payment_intent_id)
                && (string) $lockedOrder->payment_intent_id !== $paymentIntentId) {
                throw new \RuntimeException(__('api.marketplace_checkout_mode_conflict'));
            }

            $lockedOrder->payment_intent_id = $paymentIntentId;
            $lockedOrder->save();
        });
    }

    /** Best-effort fail-closed cleanup for a remote intent that lost the local race. */
    private static function cancelUnboundPaymentIntent(
        StripeClient $client,
        PaymentIntent $paymentIntent,
        MarketplaceOrder $order,
        int $tenantId,
    ): void {
        try {
            if (! in_array((string) ($paymentIntent->status ?? ''), ['canceled', 'succeeded'], true)) {
                $client->paymentIntents->cancel(
                    (string) $paymentIntent->id,
                    [],
                    ['idempotency_key' => "marketplace-unbound-intent-{$tenantId}-{$order->id}"],
                );
            }
        } catch (\Throwable $cleanupException) {
            Log::critical('MarketplacePayment: unbound PaymentIntent could not be cancelled', [
                'order_id' => $order->id,
                'tenant_id' => $tenantId,
                'payment_intent_id' => $paymentIntent->id ?? null,
                'error' => $cleanupException->getMessage(),
            ]);
        }
    }

    /** Atomically bind one order to exactly one Stripe checkout mechanism. */
    private static function claimStripeCheckoutMode(
        MarketplaceOrder $order,
        string $requestedMode,
    ): MarketplaceOrder {
        $tenantId = (int) ($order->tenant_id ?: TenantContext::getId());

        return DB::transaction(function () use ($order, $tenantId, $requestedMode): MarketplaceOrder {
            $lockedOrder = MarketplaceOrder::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereKey($order->id)
                ->lockForUpdate()
                ->firstOrFail();
            if ($lockedOrder->status !== 'pending_payment') {
                throw new \InvalidArgumentException(
                    __('api.marketplace_payment_intent_order_state_required'),
                );
            }
            if ($lockedOrder->payment_expires_at !== null
                && $lockedOrder->payment_expires_at->isPast()) {
                throw new \InvalidArgumentException(__('api.marketplace_checkout_expired'));
            }
            $boundMode = (string) ($lockedOrder->stripe_checkout_mode ?? '');
            if ($boundMode === '') {
                $boundMode = ! empty($lockedOrder->checkout_session_id)
                    ? 'checkout_session'
                    : (! empty($lockedOrder->payment_intent_id) ? 'payment_intent' : '');
            }
            if ($boundMode !== '' && $boundMode !== $requestedMode) {
                throw new \InvalidArgumentException(__('api.marketplace_checkout_mode_conflict'));
            }
            if ($boundMode === '') {
                $lockedOrder->stripe_checkout_mode = $requestedMode;
                $lockedOrder->save();
            }

            return $lockedOrder;
        });
    }

    private static function assertStripeEnabled(): void
    {
        if (! MarketplaceConfigurationService::stripeEnabled()) {
            throw new \RuntimeException(__('api.marketplace_stripe_disabled'));
        }
    }

    /**
     * Generate a Stripe Account Link for onboarding.
     */
    private static function generateOnboardingLink(string $accountId): string
    {
        $client = StripeService::client();

        $frontendBase = rtrim(TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix(), '/');

        try {
            $accountLink = $client->accountLinks->create([
                'account' => $accountId,
                'refresh_url' => $frontendBase . '/marketplace/seller/onboard?refresh=1',
                'return_url' => $frontendBase . '/marketplace/seller/onboard?complete=1',
                'type' => 'account_onboarding',
            ]);

            return $accountLink->url;
        } catch (\Exception $e) {
            Log::error('MarketplacePayment: failed to generate onboarding link', [
                'account_id' => $accountId,
                'error' => $e->getMessage(),
            ]);
            throw new \RuntimeException(__('api.marketplace_onboarding_link_failed'));
        }
    }
}
