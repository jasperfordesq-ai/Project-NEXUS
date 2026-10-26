<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\Identity;

use App\Core\EmailTemplateBuilder;
use App\Core\Mailer;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Services\Payments\HostedCheckoutService;
use App\Services\StripeService;
use App\Services\TenantSettingsService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * IdentityVerificationPaymentService — Handles the one-time verification fee.
 *
 * Creates a Stripe PaymentIntent for the verification fee and tracks payment
 * status on identity_verification_sessions. Uses the "pay once" rule: if a
 * user has any session with payment_status='completed' for this tenant, they
 * don't pay again on retry.
 */
class IdentityVerificationPaymentService
{
    /**
     * Get the verification fee in cents for a tenant.
     * Default: 500 (€5.00). Super admin can set to 0 for free verification.
     */
    public static function getFeeCents(int $tenantId): int
    {
        return (int) app(TenantSettingsService::class)->get($tenantId, 'identity_verification_fee_cents', '500');
    }

    /**
     * Check if user has already paid for verification in this tenant.
     * The "pay once" rule — skip payment on retry after failure.
     */
    public static function hasCompletedPayment(int $tenantId, int $userId): bool
    {
        return IdentityVerificationSessionService::hasCompletedPaymentForTenant($tenantId, $userId);
    }

    /**
     * The member's Stripe customer on the platform account, created on first use.
     *
     * @throws \RuntimeException
     */
    private static function stripeCustomerId(int $userId, int $tenantId): string
    {
        $user = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->first(['id', 'first_name', 'last_name', 'profile_type', 'organization_name', 'email', 'stripe_customer_id']);

        if (!$user) {
            throw new \RuntimeException('User not found.');
        }

        $client = StripeService::client();
        // Get or create Stripe Customer
        $stripeCustomerId = $user->stripe_customer_id;
        if (empty($stripeCustomerId)) {
            try {
                $customer = $client->customers->create([
                    'email' => $user->email,
                    'name' => UserDisplayName::resolve($user),
                    'metadata' => [
                        'nexus_user_id' => (string) $userId,
                        'nexus_tenant_id' => (string) $tenantId,
                    ],
                ]);
                $stripeCustomerId = $customer->id;

                DB::table('users')
                    ->where('id', $userId)
                    ->where('tenant_id', $tenantId)
                    ->update(['stripe_customer_id' => $stripeCustomerId]);
            } catch (\Exception $e) {
                Log::error('Stripe: failed to create customer for verification fee', [
                    'user_id' => $userId,
                    'error' => $e->getMessage(),
                ]);
                throw new \RuntimeException('Failed to create Stripe customer.');
            }
        }

        return (string) $stripeCustomerId;
    }

    /**
     * Create a Stripe PaymentIntent for the verification fee.
     *
     * @return array{client_secret: string, payment_intent_id: string}
     * @throws \RuntimeException
     */
    public static function createPaymentIntent(int $userId, int $tenantId, int $feeCents): array
    {
        if ($feeCents <= 0) {
            throw new \InvalidArgumentException('Fee must be greater than 0.');
        }

        $stripeCustomerId = self::stripeCustomerId($userId, $tenantId);
        $client = StripeService::client();

        $tenant = TenantContext::get();
        $tenantName = $tenant['name'] ?? 'Community';
        $currency = TenantContext::getCurrency();

        try {
            // One identity-verification fee per (tenant,user) — safe to use a
            // stable idempotency key so a client retry does not create a second
            // PaymentIntent and charge the user twice.
            $idempotencyKey = "identity-{$tenantId}-{$userId}";
            $paymentIntent = $client->paymentIntents->create([
                'amount' => $feeCents,
                'currency' => $currency,
                'customer' => $stripeCustomerId,
                'description' => "Identity Verification Fee — {$tenantName}",
                'metadata' => [
                    'nexus_type' => 'identity_verification',
                    'nexus_tenant_id' => (string) $tenantId,
                    'nexus_user_id' => (string) $userId,
                ],
            ], ['idempotency_key' => $idempotencyKey]);

            // The hosted payment page cancels an unpaid card-form intent before it
            // opens (createCheckoutSession), and the stable key above would then
            // hand that cancelled intent back for 24 hours. Start a fresh one.
            if ((string) ($paymentIntent->status ?? '') === 'canceled') {
                $paymentIntent = $client->paymentIntents->create([
                    'amount' => $feeCents,
                    'currency' => $currency,
                    'customer' => $stripeCustomerId,
                    'description' => "Identity Verification Fee — {$tenantName}",
                    'metadata' => [
                        'nexus_type' => 'identity_verification',
                        'nexus_tenant_id' => (string) $tenantId,
                        'nexus_user_id' => (string) $userId,
                    ],
                ], ['idempotency_key' => $idempotencyKey . '-after-' . $paymentIntent->id]);
            }
        } catch (\Exception $e) {
            Log::error('Stripe: failed to create verification fee PaymentIntent', [
                'user_id' => $userId,
                'fee_cents' => $feeCents,
                'error' => $e->getMessage(),
            ]);
            throw new \RuntimeException('Failed to create payment.');
        }

        return [
            'client_secret' => $paymentIntent->client_secret,
            'payment_intent_id' => $paymentIntent->id,
        ];
    }


    /**
     * Hosted payment page for the fee (accessible site — no JavaScript).
     *
     * One record per attempt in identity_verification_sessions, as the card form
     * does, carrying the Checkout Session id. Before a page opens:
     *  - an unpaid card-form intent is cancelled, so the member cannot pay both;
     *    a succeeded one marks the fee paid instead; one still processing refuses;
     *  - an open page for the same fee is reused rather than a second created.
     *
     * @return array{already_paid:bool, checkout_url:?string}
     * @throws \RuntimeException|\DomainException DomainException = payment in progress
     */
    public static function createCheckoutSession(
        int $userId,
        int $tenantId,
        int $feeCents,
        string $successUrl,
        string $cancelUrl,
    ): array {
        if ($feeCents <= 0) {
            throw new \InvalidArgumentException('Fee must be greater than 0.');
        }
        if (self::hasCompletedPayment($tenantId, $userId)) {
            return ['already_paid' => true, 'checkout_url' => null];
        }

        $client = StripeService::client();
        $currency = strtolower(TenantContext::getCurrency());

        // Card-form attempts that are still pending.
        $cardRows = DB::select(
            "SELECT id, stripe_payment_intent_id FROM identity_verification_sessions
             WHERE tenant_id = ? AND user_id = ? AND payment_status = 'pending'
               AND stripe_payment_intent_id IS NOT NULL AND stripe_checkout_session_id IS NULL",
            [$tenantId, $userId]
        );
        foreach ($cardRows as $row) {
            $pi = $client->paymentIntents->retrieve((string) $row->stripe_payment_intent_id);
            $status = (string) ($pi->status ?? '');
            if ($status === 'succeeded') {
                IdentityVerificationSessionService::updatePaymentStatus((int) $row->id, 'completed');
                return ['already_paid' => true, 'checkout_url' => null];
            }
            if ($status === 'processing' || $status === 'requires_capture') {
                throw new \DomainException('A card payment for this fee is still being processed.');
            }
            if ($status !== 'canceled') {
                $client->paymentIntents->cancel((string) $row->stripe_payment_intent_id, []);
            }
            IdentityVerificationSessionService::markPaymentFailedUnlessCompleted((int) $row->id);
        }

        // Reuse an open page for the same fee.
        $open = DB::selectOne(
            "SELECT id, stripe_checkout_session_id FROM identity_verification_sessions
             WHERE tenant_id = ? AND user_id = ? AND payment_status = 'pending'
               AND stripe_checkout_session_id IS NOT NULL
             ORDER BY id DESC LIMIT 1",
            [$tenantId, $userId]
        );
        if ($open) {
            $url = HostedCheckoutService::reusableUrl((string) $open->stripe_checkout_session_id, $feeCents, $currency);
            if ($url !== null) {
                return ['already_paid' => false, 'checkout_url' => $url];
            }
            IdentityVerificationSessionService::markPaymentFailedUnlessCompleted((int) $open->id);
        }

        $stripeCustomerId = self::stripeCustomerId($userId, $tenantId);
        $tenantName = (string) ((TenantContext::get()['name'] ?? null) ?: 'Community');

        DB::insert(
            "INSERT INTO identity_verification_sessions
                (tenant_id, user_id, provider_slug, verification_level, status,
                 verification_fee_amount, payment_status)
             VALUES (?, ?, 'stripe_identity', 'document_selfie', 'cancelled', ?, 'pending')",
            [$tenantId, $userId, $feeCents]
        );
        $rowId = (int) DB::getPdo()->lastInsertId();

        try {
            $session = HostedCheckoutService::create([
                'kind' => HostedCheckoutService::KIND_IDENTITY_FEE,
                'amount_minor' => $feeCents,
                'currency' => $currency,
                'name' => "Identity Verification Fee — {$tenantName}",
                'description' => "Identity Verification Fee — {$tenantName}",
                'metadata' => [
                    'nexus_type' => 'identity_verification',
                    'nexus_tenant_id' => (string) $tenantId,
                    'nexus_user_id' => (string) $userId,
                    'nexus_identity_session_id' => (string) $rowId,
                ],
                'customer' => $stripeCustomerId,
                'success_url' => $successUrl,
                'cancel_url' => $cancelUrl,
                'idempotency_key' => "identity-checkout-{$tenantId}-{$userId}-{$rowId}",
                'client_reference_id' => "identity_fee:{$rowId}",
            ]);
        } catch (\Throwable $e) {
            IdentityVerificationSessionService::markPaymentFailedUnlessCompleted($rowId);
            Log::error('Stripe: failed to create verification fee checkout', [
                'user_id' => $userId,
                'error' => $e->getMessage(),
            ]);
            throw new \RuntimeException('Failed to create payment.');
        }

        DB::update(
            "UPDATE identity_verification_sessions SET stripe_checkout_session_id = ?, updated_at = NOW()
             WHERE id = ? AND tenant_id = ?",
            [(string) $session->id, $rowId, $tenantId]
        );

        return ['already_paid' => false, 'checkout_url' => (string) $session->url];
    }

    /**
     * The card form is about to be used: close any open hosted page for this fee
     * so it cannot also be paid. Returns false when an open page could not be
     * closed — the caller must then not offer the card form.
     */
    public static function closeOpenCheckouts(int $tenantId, int $userId): bool
    {
        $rows = DB::select(
            "SELECT id, stripe_checkout_session_id FROM identity_verification_sessions
             WHERE tenant_id = ? AND user_id = ? AND payment_status = 'pending'
               AND stripe_checkout_session_id IS NOT NULL AND stripe_payment_intent_id IS NULL",
            [$tenantId, $userId]
        );
        foreach ($rows as $row) {
            if (!HostedCheckoutService::expireIfOpen((string) $row->stripe_checkout_session_id)) {
                return false;
            }
            IdentityVerificationSessionService::markPaymentFailedUnlessCompleted((int) $row->id);
        }
        return true;
    }

    /**
     * Status reconciliation for a member back from the hosted page before the
     * webhook arrives: ask Stripe about their open pages. Marks paid ONLY when
     * Stripe says the session is paid; the intent id is stored for refunds.
     */
    public static function reconcileCheckouts(int $tenantId, int $userId): bool
    {
        $rows = DB::select(
            "SELECT id, stripe_checkout_session_id FROM identity_verification_sessions
             WHERE tenant_id = ? AND user_id = ? AND payment_status = 'pending'
               AND stripe_checkout_session_id IS NOT NULL",
            [$tenantId, $userId]
        );
        foreach ($rows as $row) {
            $session = HostedCheckoutService::retrieve((string) $row->stripe_checkout_session_id);
            if ($session === null) {
                continue;
            }
            if ((string) ($session->payment_status ?? '') === 'paid') {
                $piId = HostedCheckoutService::paymentIntentId($session);
                IdentityVerificationSessionService::updatePaymentStatus((int) $row->id, 'completed', $piId);
                return true;
            }
        }
        return false;
    }

    /** checkout.session.completed: store the intent id against its record. */
    public static function linkCheckoutPaymentIntent(string $checkoutSessionId, string $paymentIntentId): void
    {
        DB::update(
            "UPDATE identity_verification_sessions SET stripe_payment_intent_id = ?, updated_at = NOW()
             WHERE stripe_checkout_session_id = ? AND stripe_payment_intent_id IS NULL",
            [$paymentIntentId, $checkoutSessionId]
        );
    }

    /** checkout.session.expired: an unpaid attempt is closed. */
    public static function handleCheckoutExpired(string $checkoutSessionId): void
    {
        DB::update(
            // A session only expires unpaid (a paid one completes instead). A declined
            // card may have linked its intent id, so the id is not part of the test.
            "UPDATE identity_verification_sessions SET payment_status = 'failed', updated_at = NOW()
             WHERE stripe_checkout_session_id = ? AND payment_status = 'pending'",
            [$checkoutSessionId]
        );
    }

    /**
     * The fee record for a payment intent: by its stored id, else — for a hosted
     * page, whose intent is only created when the member pays and may reach us
     * before checkout.session.completed — by the record number in the intent's
     * metadata, ONLY when that record is a hosted-page attempt with no intent yet
     * and its own tenant and member match the metadata. The id is then adopted.
     */
    private static function findSessionForIntent(object $paymentIntent): ?array
    {
        $piId = (string) ($paymentIntent->id ?? '');
        if ($piId === '') {
            return null;
        }
        $session = IdentityVerificationSessionService::findByPaymentIntentId($piId);
        if ($session) {
            return $session;
        }

        $meta = $paymentIntent->metadata ?? null;
        $rowId = (int) ($meta->nexus_identity_session_id ?? 0);
        $metaTenant = (int) ($meta->nexus_tenant_id ?? 0);
        $metaUser = (int) ($meta->nexus_user_id ?? 0);
        if ($rowId <= 0 || $metaTenant <= 0 || $metaUser <= 0) {
            return null;
        }

        $adopted = DB::update(
            "UPDATE identity_verification_sessions SET stripe_payment_intent_id = ?, updated_at = NOW()
             WHERE id = ? AND tenant_id = ? AND user_id = ?
               AND stripe_checkout_session_id IS NOT NULL AND stripe_payment_intent_id IS NULL",
            [$piId, $rowId, $metaTenant, $metaUser]
        );

        return $adopted > 0 ? IdentityVerificationSessionService::findByPaymentIntentId($piId) : null;
    }

    /**
     * Handle payment_intent.succeeded webhook for verification fees.
     * Updates the session's payment_status to 'completed'.
     */
    public static function handlePaymentSucceeded(object $paymentIntent): void
    {
        $type = $paymentIntent->metadata->nexus_type ?? '';
        if ($type !== 'identity_verification') {
            return; // Not a verification fee payment
        }

        $piId = $paymentIntent->id;
        $session = self::findSessionForIntent($paymentIntent);
        if (!$session) {
            Log::warning("Verification payment succeeded but no session found for PI: {$piId}");
            return;
        }

        IdentityVerificationSessionService::updatePaymentStatus((int) $session['id'], 'completed');
        Log::info("Verification payment completed for session {$session['id']}");

        // Notify user that their verification fee was received
        $previousTenantId = TenantContext::currentId();
        try {
            $userId   = (int) ($session['user_id'] ?? 0);
            $tenantId = (int) ($session['tenant_id'] ?? 0);
            if ($userId && $tenantId) {
                TenantContext::setById($tenantId);
                $user = DB::table('users')->where('id', $userId)->where('tenant_id', $tenantId)->select(['id', 'email', 'first_name', 'name', 'preferred_language'])->first();
                if ($user && !empty($user->email)) {
                    LocaleContext::withLocale($user, function () use ($user, $tenantId) {
                        $firstName = $user->first_name ?? $user->name ?? __('emails.common.fallback_name');
                        $frontendUrl = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix();
                        $html = EmailTemplateBuilder::make()
                            ->title(__('emails_misc.identity_payment.success_title'))
                            ->greeting($firstName)
                            ->paragraph(__('emails_misc.identity_payment.success_body'))
                            ->button(__('emails_misc.identity_payment.success_cta'), $frontendUrl . '/verify-identity')
                            ->render();
                        if (!\App\Services\EmailDispatchService::sendRaw($user->email, __('emails_misc.identity_payment.success_subject'), $html, null, null, null, 'identity_payment', ['tenant_id' => $tenantId])) {
                            Log::warning('[IdentityVerificationPaymentService] payment success email send returned false', [
                                'user_id' => $user->id ?? null,
                            ]);
                        }
                    });
                }
            }
        } catch (\Throwable $e) {
            Log::warning('[IdentityVerificationPaymentService] payment success email failed: ' . $e->getMessage());
        } finally {
            if ($previousTenantId !== null) {
                TenantContext::setById((int) $previousTenantId);
            } else {
                TenantContext::reset();
            }
        }
    }

    /**
     * Handle payment_intent.payment_failed webhook for verification fees.
     */
    public static function handlePaymentFailed(object $paymentIntent): void
    {
        $type = $paymentIntent->metadata->nexus_type ?? '';
        if ($type !== 'identity_verification') {
            return;
        }

        $session = self::findSessionForIntent($paymentIntent);
        if (!$session) {
            return;
        }

        // On a hosted payment page a declined card is not the end: the member
        // can try another card on the same page. Only the page expiring closes
        // that attempt (handleCheckoutExpired), so no "payment failed" here.
        if (!empty($session['stripe_checkout_session_id'])) {
            Log::info("Ignoring payment_failed on hosted-page verification attempt {$session['id']}; the page stays open");
            return;
        }

        // F-107: `completed` is terminal. A late failure event for an intent that
        // already succeeded is ignored — no status change, no "payment failed" email.
        if (!IdentityVerificationSessionService::markPaymentFailedUnlessCompleted((int) $session['id'])) {
            Log::info("Ignoring payment_failed for already-completed verification session {$session['id']}");
            return;
        }
        Log::warning("Verification payment failed for session {$session['id']}");

        // Notify user so they can retry
        $previousTenantId = TenantContext::currentId();
        try {
            $userId   = (int) ($session['user_id'] ?? 0);
            $tenantId = (int) ($session['tenant_id'] ?? 0);
            if ($userId && $tenantId) {
                TenantContext::setById($tenantId);
                $user = DB::table('users')->where('id', $userId)->where('tenant_id', $tenantId)->select(['id', 'email', 'first_name', 'name', 'preferred_language'])->first();
                if ($user && !empty($user->email)) {
                    LocaleContext::withLocale($user, function () use ($user, $tenantId) {
                        $firstName = $user->first_name ?? $user->name ?? __('emails.common.fallback_name');
                        $frontendUrl = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix();
                        $html = EmailTemplateBuilder::make()
                            ->theme('warning')
                            ->title(__('emails_misc.identity_payment.failed_title'))
                            ->greeting($firstName)
                            ->paragraph(__('emails_misc.identity_payment.failed_body'))
                            ->button(__('emails_misc.identity_payment.failed_cta'), $frontendUrl . '/verify-identity')
                            ->render();
                        if (!\App\Services\EmailDispatchService::sendRaw($user->email, __('emails_misc.identity_payment.failed_subject'), $html, null, null, null, 'identity_payment', ['tenant_id' => $tenantId])) {
                            Log::warning('[IdentityVerificationPaymentService] payment failed email send returned false', [
                                'user_id' => $user->id ?? null,
                            ]);
                        }
                    });
                }
            }
        } catch (\Throwable $e) {
            Log::warning('[IdentityVerificationPaymentService] payment failed email failed: ' . $e->getMessage());
        } finally {
            if ($previousTenantId !== null) {
                TenantContext::setById((int) $previousTenantId);
            } else {
                TenantContext::reset();
            }
        }
    }
}
