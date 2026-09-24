<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Services\MemberPremiumService;
use App\Services\StripeDonationService;
use App\Services\DonationOperationsService;
use App\Services\MarketplacePaymentService;
use App\Services\StripeService;
use App\Services\StripeSubscriptionService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Stripe\Exception\SignatureVerificationException;

/**
 * StripeWebhookController — Handles incoming Stripe webhook events.
 *
 * This endpoint is public (no auth/CSRF) — signature verification is
 * performed via StripeService::constructWebhookEvent().
 */
class StripeWebhookController extends BaseApiController
{
    protected bool $isV2Api = true;

    /**
     * Handle an incoming Stripe webhook event.
     */
    public function handleWebhook(Request $request): JsonResponse
    {
        $payload = $request->getContent();
        $sigHeader = $request->header('Stripe-Signature', '');

        // Missing signature header or empty body is a client error, not a server fault.
        if ($sigHeader === '' || $payload === '') {
            return $this->respondWithError(
                'INVALID_SIGNATURE',
                __('api.webhook_signature_failed'),
                null,
                400
            );
        }

        // Verify webhook signature
        try {
            $event = StripeService::constructWebhookEvent(
                $payload,
                $sigHeader,
                $this->webhookSecretForRequest($request),
                $this->webhookSecretEnvNameForRequest($request),
            );
        } catch (SignatureVerificationException $e) {
            Log::warning('Stripe webhook signature verification failed', [
                'error' => $e->getMessage(),
            ]);
            return $this->respondWithError(
                'INVALID_SIGNATURE',
                __('api.webhook_signature_failed'),
                null,
                400
            );
        } catch (\Exception $e) {
            Log::error('Stripe webhook error during signature verification', [
                'error' => $e->getMessage(),
            ]);
            return $this->respondWithError(
                'WEBHOOK_ERROR',
                __('api.webhook_internal_error'),
                null,
                500
            );
        }

        // Atomic idempotency claim — INSERT IGNORE relies on the UNIQUE index
        // on stripe_webhook_events.event_id. Exactly one concurrent caller
        // wins the insert; losers get 0 affected rows and bail out.
        //
        // NOTE (tenant scope): The UNIQUE index is on event_id ALONE (no tenant_id).
        // This is correct: Stripe event IDs (evt_...) are globally unique across
        // Stripe's entire platform. A single Stripe event has exactly one intended
        // recipient (account) — it is never legitimately delivered to multiple tenants.
        // Our platform uses ONE shared Stripe account (connected accounts for
        // marketplace sellers, but the top-level `account` on the event still maps
        // deterministically to one tenant). Global dedup is therefore the safest
        // posture: if the same event_id arrives twice (Stripe retry, misconfigured
        // duplicate endpoint, or replay attack), we always suppress the second.
        // Composite key (event_id, tenant_id) would weaken this guarantee by letting
        // a replay-forged event be processed against a different tenant.
        $eventId = $event->id;
        $nowTs = now();

        $inserted = DB::affectingStatement(
            "INSERT IGNORE INTO stripe_webhook_events (event_id, event_type, status, processed_at)
             VALUES (?, ?, 'processing', ?)",
            [$eventId, $event->type, $nowTs]
        );

        if ($inserted === 0) {
            // Another delivery already claimed this event. Ack 200 so Stripe
            // stops retrying — we either already processed it or another
            // worker is currently processing it.
            $existing = DB::table('stripe_webhook_events')
                ->where('event_id', $eventId)
                ->first();

            $reclaimed = DB::table('stripe_webhook_events')
                ->where('event_id', $eventId)
                ->where(function ($query) {
                    $query->where('status', 'failed')
                        ->orWhere(function ($nested) {
                            $nested->where('status', 'processing')
                                ->where('processed_at', '<', now()->subMinutes(10));
                        });
                })
                ->update([
                    'event_type' => $event->type,
                    'status' => 'processing',
                    'processed_at' => $nowTs,
                ]);

            if ($reclaimed > 0) {
                Log::info('Stripe webhook: retry delivery reclaimed failed or stale event', [
                    'event_id' => $eventId,
                    'previous_status' => $existing->status ?? null,
                ]);
            } else {
                Log::info('Stripe webhook: duplicate delivery suppressed', [
                    'event_id' => $eventId,
                    'existing_status' => $existing->status ?? null,
                ]);
                return $this->respondWithData(['received' => true]);
            }
        }

        // Dispatch to the appropriate handler
        try {
            // AG58 — Member Premium: route subscription/invoice/checkout events
            // tagged with nexus_kind=member_premium to the member service first.
            // (Tenant billing events lack that metadata and continue to the
            // existing StripeSubscriptionService handlers below.)
            $isMemberPremium = in_array($event->type, [
                'checkout.session.completed',
                'customer.subscription.created',
                'customer.subscription.updated',
                'customer.subscription.deleted',
                'invoice.paid',
                'invoice.payment_failed',
            ], true) && MemberPremiumService::eventBelongsHere($event);

            if ($isMemberPremium) {
                MemberPremiumService::applyWebhookEvent($event);
            } else {
                match ($event->type) {
                    'checkout.session.completed' => $this->handleCheckoutCompleted($event->data->object),
                    'checkout.session.async_payment_succeeded' => $this->handleCheckoutAsyncPaymentSucceeded($event->data->object),
                    'customer.subscription.updated' => $this->handleSubscriptionUpdated($event->data->object),
                    'customer.subscription.deleted' => $this->handleSubscriptionDeleted($event->data->object),
                    'invoice.paid' => $this->handleInvoicePaid($event->data->object),
                    'invoice.payment_failed' => $this->handleInvoicePaymentFailed($event->data->object),
                    'payment_intent.succeeded' => $this->handlePaymentSucceeded($event->data->object),
                    'payment_intent.payment_failed' => $this->handlePaymentFailed($event->data->object),
                    'charge.refunded' => $this->handleChargeRefunded($event->data->object),
                    'charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed' => $this->handleDisputeUpdated($event->data->object),
                    'account.updated' => $this->handleAccountUpdated($event->data->object),
                    default => Log::info("Stripe webhook: unhandled event type {$event->type}"),
                };
            }
        } catch (\Exception $e) {
            // Mark as failed so Stripe retries can be re-processed
            DB::table('stripe_webhook_events')
                ->where('event_id', $eventId)
                ->update([
                    'status' => 'failed',
                    'processed_at' => now(),
                ]);

            Log::error("Stripe webhook handler error for {$event->type}", [
                'event_id' => $eventId,
                'error' => $e->getMessage(),
            ]);

            // A failed Stripe webhook is a money-state-drift risk: Stripe abandons
            // retries after ~3 days, so a silent handler crash can leave a payment
            // un-applied forever. report() ensures it reaches Sentry regardless of
            // LOG_STACK; the row stays status='failed' for stripe:check-stuck-webhooks.
            report($e);

            return $this->respondWithError(
                'HANDLER_ERROR',
                __('api.webhook_handler_error'),
                null,
                500
            );
        }

        // Mark as successfully processed
        DB::table('stripe_webhook_events')
            ->where('event_id', $eventId)
            ->update([
                'status' => 'processed',
                'processed_at' => now(),
            ]);

        return $this->respondWithData(['received' => true]);
    }

    private function webhookSecretForRequest(Request $request): ?string
    {
        if (!$this->isMarketplaceWebhookRequest($request)) {
            return null;
        }

        return config('services.stripe.marketplace_webhook_secret')
            ?: env('STRIPE_MARKETPLACE_WEBHOOK_SECRET')
            ?: '';
    }

    private function webhookSecretEnvNameForRequest(Request $request): string
    {
        return $this->isMarketplaceWebhookRequest($request)
            ? 'STRIPE_MARKETPLACE_WEBHOOK_SECRET'
            : 'STRIPE_WEBHOOK_SECRET';
    }

    private function isMarketplaceWebhookRequest(Request $request): bool
    {
        return $request->is('api/v2/marketplace/webhooks/stripe')
            || $request->is('v2/marketplace/webhooks/stripe');
    }

    // ============================================
    // EVENT HANDLERS — Stubs for Phase 1+2 agents
    // ============================================

    private function handleCheckoutCompleted(object $session): void
    {
        // Marketplace card checkout (accessible no-JS flow) and subscription
        // checkout share the checkout.session.completed event. Route by the
        // nexus_type we stamp at creation; also treat a present nexus_order_id as
        // a marketplace marker so a session that somehow lost nexus_type is still
        // reconciled (the buyer has already paid) rather than misrouted to the
        // subscription handler and dropped.
        $meta = $session->metadata ?? null;
        $isMarketplace = (($meta->nexus_type ?? null) === 'marketplace')
            || !empty($meta->nexus_order_id ?? null);
        if ($isMarketplace) {
            MarketplacePaymentService::handleWebhookEvent('checkout.session.completed', $session);
            return;
        }

        StripeSubscriptionService::handleCheckoutCompleted($session);
    }

    /**
     * E-035 F-178 follow-up: tenant billing now activates only on a checkout
     * whose payment_status is paid (or no_payment_required). A delayed payment
     * method (e.g. a bank debit) completes the checkout as unpaid and Stripe
     * later sends checkout.session.async_payment_succeeded with the session
     * now paid — route that to the same tenant-billing handler so such a
     * community still activates. Marketplace sessions are left exactly as
     * before (logged, not handled here) rather than widening that flow.
     */
    private function handleCheckoutAsyncPaymentSucceeded(object $session): void
    {
        $meta = $session->metadata ?? null;
        $isMarketplace = (($meta->nexus_type ?? null) === 'marketplace')
            || !empty($meta->nexus_order_id ?? null);
        if ($isMarketplace) {
            Log::info('Stripe webhook: marketplace checkout.session.async_payment_succeeded not handled here');
            return;
        }

        StripeSubscriptionService::handleCheckoutCompleted($session);
    }

    private function handleSubscriptionUpdated(object $subscription): void
    {
        StripeSubscriptionService::handleSubscriptionUpdated($subscription);
    }

    private function handleSubscriptionDeleted(object $subscription): void
    {
        StripeSubscriptionService::handleSubscriptionDeleted($subscription);
    }

    private function handleInvoicePaid(object $invoice): void
    {
        StripeSubscriptionService::handleInvoicePaid($invoice);
    }

    private function handleInvoicePaymentFailed(object $invoice): void
    {
        StripeSubscriptionService::handleInvoicePaymentFailed($invoice);
    }

    private function handlePaymentSucceeded(object $paymentIntent): void
    {
        StripeDonationService::handlePaymentSucceeded($paymentIntent);

        // Also dispatch to marketplace handler (it checks nexus_type metadata internally)
        MarketplacePaymentService::handleWebhookEvent('payment_intent.succeeded', $paymentIntent);

        // Also dispatch to identity verification payment handler
        \App\Services\Identity\IdentityVerificationPaymentService::handlePaymentSucceeded($paymentIntent);

        // AG54 — Verein membership dues (handler self-checks nexus_type metadata)
        \App\Services\Verein\VereinDuesService::handleWebhookEvent('payment_intent.succeeded', $paymentIntent);
    }

    private function handlePaymentFailed(object $paymentIntent): void
    {
        StripeDonationService::handlePaymentFailed($paymentIntent);

        // Also dispatch to identity verification payment handler
        \App\Services\Identity\IdentityVerificationPaymentService::handlePaymentFailed($paymentIntent);
    }

    private function handleChargeRefunded(object $charge): void
    {
        StripeDonationService::handleChargeRefunded($charge);

        // Also dispatch to marketplace handler (it checks for marketplace payments internally)
        MarketplacePaymentService::handleWebhookEvent('charge.refunded', $charge);
    }

    private function handleDisputeUpdated(object $dispute): void
    {
        DonationOperationsService::recordStripeDispute($dispute);
        MarketplacePaymentService::handleWebhookEvent(
            'charge.dispute.' . (($dispute->status ?? null) === 'won' || ($dispute->status ?? null) === 'lost' ? 'closed' : 'updated'),
            $dispute,
        );
    }

    private function handleAccountUpdated(object $account): void
    {
        // Connect account updates — marketplace seller onboarding
        MarketplacePaymentService::handleWebhookEvent('account.updated', $account);
    }
}
