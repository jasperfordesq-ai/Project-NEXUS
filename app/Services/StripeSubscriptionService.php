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
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * StripeSubscriptionService — Manages Stripe product/price sync,
 * checkout sessions, billing portal, and webhook event processing
 * for tenant plan subscriptions.
 *
 * Static methods following project convention.
 */
class StripeSubscriptionService
{
    /**
     * Cancel every active subscription for a Stripe customer and delete the
     * customer object. Used when a tenant is permanently purged so we don't keep
     * an orphaned customer billing against a community that no longer exists.
     *
     * Best-effort and idempotent: already-cancelled subs and an already-deleted
     * customer are treated as success. Returns a short human-readable summary.
     */
    public static function cancelAllForCustomer(string $customerId): string
    {
        $client = StripeService::client();
        $cancelled = 0;

        $subs = $client->subscriptions->all([
            'customer' => $customerId,
            'status'   => 'all',
            'limit'    => 100,
        ]);

        foreach ($subs->data as $sub) {
            if (in_array($sub->status, ['canceled', 'incomplete_expired'], true)) {
                continue;
            }
            try {
                $client->subscriptions->cancel($sub->id);
                $cancelled++;
            } catch (\Throwable $e) {
                Log::warning('StripeSubscriptionService::cancelAllForCustomer — sub cancel failed', [
                    'customer_id'     => $customerId,
                    'subscription_id' => $sub->id,
                    'error'           => $e->getMessage(),
                ]);
            }
        }

        $customerDeleted = false;
        try {
            $client->customers->delete($customerId);
            $customerDeleted = true;
        } catch (\Throwable $e) {
            Log::warning('StripeSubscriptionService::cancelAllForCustomer — customer delete failed', [
                'customer_id' => $customerId,
                'error'       => $e->getMessage(),
            ]);
        }

        return sprintf(
            'cancelled %d subscription(s); customer %s',
            $cancelled,
            $customerDeleted ? 'deleted' : 'NOT deleted (review in Stripe)'
        );
    }

    /**
     * Sync a pay_plan to Stripe (create/update Product + Prices).
     *
     * Idempotent: skips creation if Stripe IDs already exist.
     */
    public static function syncPlanToStripe(int $planId): void
    {
        $plan = DB::selectOne("SELECT * FROM pay_plans WHERE id = ?", [$planId]);

        if (!$plan) {
            Log::warning('StripeSubscriptionService::syncPlanToStripe — plan not found', ['plan_id' => $planId]);
            return;
        }

        try {
            $client = StripeService::client();
            $updates = [];
            $params = [];

            // Per-tenant currency (falls back to config, then 'eur').
            // Per-plan currency override would still require a currency column on pay_plans.
            $currency = TenantContext::getCurrency();

            // --- Product ---
            if (empty($plan->stripe_product_id)) {
                $product = $client->products->create([
                    'name' => $plan->name,
                    'description' => $plan->description ?: "Plan: {$plan->name}",
                    'metadata' => ['nexus_plan_id' => (string) $planId],
                ]);
                $updates[] = 'stripe_product_id = ?';
                $params[] = $product->id;
                $stripeProductId = $product->id;

                Log::info('Stripe product created', ['plan_id' => $planId, 'product_id' => $product->id]);
            } else {
                $stripeProductId = $plan->stripe_product_id;

                // Update existing product name/description
                $client->products->update($stripeProductId, [
                    'name' => $plan->name,
                    'description' => $plan->description ?: "Plan: {$plan->name}",
                ]);
            }

            // --- Monthly Price ---
            if (empty($plan->stripe_price_id_monthly) && $plan->price_monthly > 0) {
                $monthlyPrice = $client->prices->create([
                    'product' => $stripeProductId,
                    'unit_amount' => (int) round($plan->price_monthly * 100),
                    'currency' => $currency,
                    'recurring' => ['interval' => 'month'],
                    'metadata' => ['nexus_plan_id' => (string) $planId, 'interval' => 'monthly'],
                ]);
                $updates[] = 'stripe_price_id_monthly = ?';
                $params[] = $monthlyPrice->id;

                Log::info('Stripe monthly price created', ['plan_id' => $planId, 'price_id' => $monthlyPrice->id]);
            }

            // --- Yearly Price ---
            if (empty($plan->stripe_price_id_yearly) && $plan->price_yearly > 0) {
                $yearlyPrice = $client->prices->create([
                    'product' => $stripeProductId,
                    'unit_amount' => (int) round($plan->price_yearly * 100),
                    'currency' => $currency,
                    'recurring' => ['interval' => 'year'],
                    'metadata' => ['nexus_plan_id' => (string) $planId, 'interval' => 'yearly'],
                ]);
                $updates[] = 'stripe_price_id_yearly = ?';
                $params[] = $yearlyPrice->id;

                Log::info('Stripe yearly price created', ['plan_id' => $planId, 'price_id' => $yearlyPrice->id]);
            }

            // Persist Stripe IDs back to pay_plans
            if (!empty($updates)) {
                $updates[] = 'updated_at = NOW()';
                $params[] = $planId;
                DB::update(
                    "UPDATE pay_plans SET " . implode(', ', $updates) . " WHERE id = ?",
                    $params
                );
            }
        } catch (\Exception $e) {
            Log::error('StripeSubscriptionService::syncPlanToStripe failed', [
                'plan_id' => $planId,
                'error' => $e->getMessage(),
            ]);
            throw $e;
        }
    }

    /**
     * Create a Stripe Checkout Session for a tenant to subscribe to a plan.
     *
     * Free plans (price 0/0) are activated directly without Stripe and return
     * {activated: true, checkout_url: null} instead of a checkout session.
     *
     * @return array{checkout_url: string, session_id: string}|array{activated: true, checkout_url: null}
     */
    public static function createCheckoutSession(int $tenantId, int $planId, string $billingInterval): array
    {
        $client = StripeService::client();

        // Load tenant
        $tenant = DB::selectOne("SELECT id, name, stripe_customer_id FROM tenants WHERE id = ?", [$tenantId]);
        if (!$tenant) {
            throw new \RuntimeException("Tenant {$tenantId} not found");
        }

        // Get or create Stripe Customer
        $customerId = $tenant->stripe_customer_id;
        if (empty($customerId)) {
            try {
                $customer = $client->customers->create([
                    'name' => $tenant->name,
                    'metadata' => ['nexus_tenant_id' => (string) $tenantId],
                ]);
                $customerId = $customer->id;
                DB::update("UPDATE tenants SET stripe_customer_id = ? WHERE id = ?", [$customerId, $tenantId]);

                Log::info('Stripe customer created for tenant', ['tenant_id' => $tenantId, 'customer_id' => $customerId]);
            } catch (\Exception $e) {
                Log::error('Failed to create Stripe customer', ['tenant_id' => $tenantId, 'error' => $e->getMessage()]);
                throw $e;
            }
        }

        // Load plan and resolve the correct price ID
        $plan = DB::selectOne("SELECT * FROM pay_plans WHERE id = ?", [$planId]);
        if (!$plan) {
            throw new \RuntimeException("Plan {$planId} not found");
        }

        $priceId = $billingInterval === 'yearly'
            ? $plan->stripe_price_id_yearly
            : $plan->stripe_price_id_monthly;

        // Free plan — activate directly without Stripe
        if ((float) $plan->price_monthly === 0.0 && (float) $plan->price_yearly === 0.0) {
            $existing = DB::selectOne(
                "SELECT id FROM tenant_plan_assignments WHERE tenant_id = ?",
                [$tenantId]
            );
            if ($existing) {
                DB::update(
                    "UPDATE tenant_plan_assignments
                     SET pay_plan_id = ?, status = 'active', stripe_subscription_id = NULL,
                         starts_at = NOW(), expires_at = NULL, updated_at = NOW()
                     WHERE tenant_id = ?",
                    [$planId, $tenantId]
                );
            } else {
                DB::insert(
                    "INSERT INTO tenant_plan_assignments
                     (tenant_id, pay_plan_id, status, stripe_subscription_id, starts_at, created_at, updated_at)
                     VALUES (?, ?, 'active', NULL, NOW(), NOW(), NOW())",
                    [$tenantId, $planId]
                );
            }
            Log::info('Free plan activated for tenant', ['tenant_id' => $tenantId, 'plan_id' => $planId]);
            return ['activated' => true, 'checkout_url' => null];
        }

        // Auto-sync to Stripe if price IDs are missing (e.g., pre-existing plans)
        if (empty($priceId)) {
            Log::info("Auto-syncing plan {$planId} to Stripe (no price ID for {$billingInterval})");
            static::syncPlanToStripe($planId);
            // Reload plan from DB after sync (stdClass from selectOne has no refresh())
            $plan = DB::selectOne("SELECT * FROM pay_plans WHERE id = ?", [$planId]);
            $priceId = $billingInterval === 'yearly'
                ? $plan->stripe_price_id_yearly
                : $plan->stripe_price_id_monthly;

            if (empty($priceId)) {
                throw new \RuntimeException("Failed to sync plan {$planId} to Stripe — no price created for {$billingInterval}");
            }
        }

        // Build success/cancel URLs — must include tenant slug for React Router to resolve the tenant
        $frontendBase = rtrim(TenantContext::getFrontendUrl(), '/');
        $slugPrefix   = TenantContext::getSlugPrefix(); // e.g. "/hour-timebank"
        $successUrl   = $frontendBase . $slugPrefix . '/admin/billing/checkout-return?session_id={CHECKOUT_SESSION_ID}';
        $cancelUrl    = $frontendBase . $slugPrefix . '/admin/billing?cancelled=1';

        try {
            $session = $client->checkout->sessions->create([
                'mode' => 'subscription',
                'customer' => $customerId,
                'line_items' => [
                    ['price' => $priceId, 'quantity' => 1],
                ],
                'metadata' => [
                    'nexus_tenant_id' => (string) $tenantId,
                    'nexus_plan_id' => (string) $planId,
                ],
                'success_url' => $successUrl,
                'cancel_url' => $cancelUrl,
            ]);

            Log::info('Stripe checkout session created', [
                'tenant_id' => $tenantId,
                'plan_id' => $planId,
                'session_id' => $session->id,
            ]);

            return [
                'checkout_url' => $session->url,
                'session_id' => $session->id,
            ];
        } catch (\Exception $e) {
            Log::error('Failed to create Stripe checkout session', [
                'tenant_id' => $tenantId,
                'plan_id' => $planId,
                'error' => $e->getMessage(),
            ]);
            throw $e;
        }
    }

    /**
     * Create a Stripe Billing Portal Session for a tenant to manage their subscription.
     *
     * @return array{portal_url: string}
     */
    public static function createPortalSession(int $tenantId): array
    {
        $tenant = DB::selectOne("SELECT id, stripe_customer_id FROM tenants WHERE id = ?", [$tenantId]);
        if (!$tenant) {
            throw new \RuntimeException("Tenant {$tenantId} not found");
        }

        if (empty($tenant->stripe_customer_id)) {
            throw new \RuntimeException("Tenant {$tenantId} has no Stripe customer — subscribe to a plan first");
        }

        $frontendBase = rtrim(TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix(), '/');

        try {
            $client = StripeService::client();
            $session = $client->billingPortal->sessions->create([
                'customer' => $tenant->stripe_customer_id,
                'return_url' => $frontendBase . '/admin/billing',
            ]);

            return ['portal_url' => $session->url];
        } catch (\Exception $e) {
            Log::error('Failed to create Stripe portal session', [
                'tenant_id' => $tenantId,
                'error' => $e->getMessage(),
            ]);
            throw $e;
        }
    }

    /**
     * Handle checkout.session.completed — activate the subscription in our DB.
     */
    public static function handleCheckoutCompleted(object $session): void
    {
        $tenantId = (int) ($session->metadata->nexus_tenant_id ?? 0);
        $planId = (int) ($session->metadata->nexus_plan_id ?? 0);
        $subscriptionId = $session->subscription ?? null;

        if (!$tenantId || !$planId) {
            Log::warning('Stripe checkout.session.completed missing nexus metadata', [
                'session_id' => $session->id ?? null,
            ]);
            return;
        }

        try {
            DB::transaction(function () use ($tenantId, $planId, $subscriptionId, $session) {
                // Upsert tenant_plan_assignments
                $existing = DB::selectOne(
                    "SELECT id FROM tenant_plan_assignments WHERE tenant_id = ?",
                    [$tenantId]
                );

                if ($existing) {
                    DB::update(
                        "UPDATE tenant_plan_assignments
                         SET pay_plan_id = ?, status = 'active', stripe_subscription_id = ?,
                             starts_at = NOW(), expires_at = NULL, updated_at = NOW()
                         WHERE tenant_id = ?",
                        [$planId, $subscriptionId, $tenantId]
                    );
                } else {
                    DB::insert(
                        "INSERT INTO tenant_plan_assignments
                         (tenant_id, pay_plan_id, status, stripe_subscription_id, starts_at, created_at, updated_at)
                         VALUES (?, ?, 'active', ?, NOW(), NOW(), NOW())",
                        [$tenantId, $planId, $subscriptionId]
                    );
                }
            });

            Log::info('Stripe checkout completed — subscription activated', [
                'tenant_id' => $tenantId,
                'plan_id' => $planId,
                'subscription_id' => $subscriptionId,
            ]);
        } catch (\Exception $e) {
            Log::error('Failed to handle checkout.session.completed', [
                'tenant_id' => $tenantId,
                'plan_id' => $planId,
                'error' => $e->getMessage(),
            ]);
            throw $e;
        }

        // Email tenant admin — subscription is now active
        try {
            $plan = DB::selectOne("SELECT name FROM pay_plans WHERE id = ?", [$planId]);
            static::sendRequiredTenantAdminEmail(
                $tenantId,
                ['key' => 'emails_misc.stripe_subscription.activated_subject', 'params' => ['plan' => $plan->name ?? '']],
                ['key' => 'emails_misc.stripe_subscription.activated_title'],
                ['key' => 'emails_misc.stripe_subscription.activated_body', 'params' => ['plan' => htmlspecialchars($plan->name ?? '', ENT_QUOTES, 'UTF-8')]],
                '/admin/billing',
                ['key' => 'emails_misc.stripe_subscription.activated_cta'],
                'default',
                'checkout completed'
            );
        } catch (\Throwable $e) {
            Log::warning('[StripeSubscriptionService] handleCheckoutCompleted email failed: ' . $e->getMessage());
            throw $e;
        }
    }

    /**
     * Handle customer.subscription.updated — sync status and period end.
     */
    public static function handleSubscriptionUpdated(object $subscription): void
    {
        $stripeSubId = $subscription->id ?? null;
        if (!$stripeSubId) {
            return;
        }

        $assignment = DB::selectOne(
            "SELECT id, tenant_id FROM tenant_plan_assignments WHERE stripe_subscription_id = ?",
            [$stripeSubId]
        );

        if (!$assignment) {
            Log::info('Stripe subscription.updated — no matching assignment', ['subscription_id' => $stripeSubId]);
            return;
        }

        // Map Stripe status to our status
        $stripeStatus = $subscription->status ?? 'active';
        $statusMap = [
            'active' => 'active',
            'past_due' => 'active',
            'canceled' => 'cancelled',
            'trialing' => 'trial',
            'unpaid' => 'expired',
            'incomplete' => 'active',
            'incomplete_expired' => 'expired',
            'paused' => 'expired',
        ];
        $nexusStatus = $statusMap[$stripeStatus] ?? 'active';

        $periodEnd = isset($subscription->current_period_end)
            ? date('Y-m-d H:i:s', $subscription->current_period_end)
            : null;

        try {
            DB::update(
                "UPDATE tenant_plan_assignments
                 SET status = ?, stripe_current_period_end = ?, updated_at = NOW()
                 WHERE id = ?",
                [$nexusStatus, $periodEnd, $assignment->id]
            );

            Log::info('Stripe subscription updated', [
                'tenant_id' => $assignment->tenant_id,
                'subscription_id' => $stripeSubId,
                'status' => $nexusStatus,
            ]);
        } catch (\Exception $e) {
            Log::error('Failed to handle subscription.updated', [
                'subscription_id' => $stripeSubId,
                'error' => $e->getMessage(),
            ]);
            throw $e;
        }

        // Detect plan/price change
        $tenantId = (int) $assignment->tenant_id;
        $stripeItems = $subscription->items->data ?? [];
        if (!empty($stripeItems)) {
            $newPriceId = $stripeItems[0]->price->id ?? null;
            if ($newPriceId) {
                // Fetch current price ID from our DB
                $currentAssignment = DB::selectOne(
                    "SELECT tpa.*, pp.name as plan_name, pp.stripe_price_id_monthly, pp.stripe_price_id_yearly
                     FROM tenant_plan_assignments tpa
                     LEFT JOIN pay_plans pp ON pp.id = tpa.pay_plan_id
                     WHERE tpa.id = ?",
                    [$assignment->id]
                );
                $currentPriceId = $currentAssignment->stripe_price_id_monthly ?? $currentAssignment->stripe_price_id_yearly ?? null;

                if ($currentPriceId && $newPriceId !== $currentPriceId) {
                    // Find the new plan name
                    $newPlan = DB::selectOne(
                        "SELECT name FROM pay_plans WHERE stripe_price_id_monthly = ? OR stripe_price_id_yearly = ?",
                        [$newPriceId, $newPriceId]
                    );
                    $newPlanName = $newPlan->name ?? 'Updated Plan';
                    $oldPlanName = $currentAssignment->plan_name ?? 'Previous Plan';

                    try {
                        static::sendRequiredTenantAdminEmail(
                            $tenantId,
                            ['key' => 'emails_misc.stripe_subscription.plan_changed_subject', 'params' => ['new_plan' => $newPlanName]],
                            ['key' => 'emails_misc.stripe_subscription.plan_changed_title'],
                            ['key' => 'emails_misc.stripe_subscription.plan_changed_body', 'params' => ['old_plan' => $oldPlanName, 'new_plan' => $newPlanName]],
                            '/admin/billing',
                            ['key' => 'emails_misc.stripe_subscription.plan_changed_cta'],
                            'default',
                            'plan changed'
                        );
                    } catch (\Throwable $e) {
                        Log::warning('[StripeSubscriptionService] plan_changed email failed: ' . $e->getMessage());
                        throw $e;
                    }
                }
            }
        }

        // Notify tenant admin on actionable status transitions
        if ($stripeStatus === 'past_due') {
            try {
                static::sendRequiredTenantAdminEmail(
                    $tenantId,
                    ['key' => 'emails_misc.stripe_subscription.past_due_subject'],
                    ['key' => 'emails_misc.stripe_subscription.past_due_title'],
                    ['key' => 'emails_misc.stripe_subscription.past_due_body'],
                    '/admin/billing',
                    ['key' => 'emails_misc.stripe_subscription.past_due_cta'],
                    'default',
                    'past due'
                );
            } catch (\Throwable $e) {
                Log::warning('[StripeSubscriptionService] past_due email failed: ' . $e->getMessage());
                throw $e;
            }
        } elseif (in_array($stripeStatus, ['unpaid', 'incomplete_expired', 'paused'], true)) {
            try {
                static::sendRequiredTenantAdminEmail(
                    $tenantId,
                    ['key' => 'emails_misc.stripe_subscription.expired_subject'],
                    ['key' => 'emails_misc.stripe_subscription.expired_title'],
                    ['key' => 'emails_misc.stripe_subscription.expired_body'],
                    '/admin/billing',
                    ['key' => 'emails_misc.stripe_subscription.expired_cta'],
                    'default',
                    'expired'
                );
            } catch (\Throwable $e) {
                Log::warning('[StripeSubscriptionService] expired email failed: ' . $e->getMessage());
                throw $e;
            }
        }
    }

    /**
     * Handle customer.subscription.deleted — mark as cancelled.
     */
    public static function handleSubscriptionDeleted(object $subscription): void
    {
        $stripeSubId = $subscription->id ?? null;
        if (!$stripeSubId) {
            return;
        }

        $assignment = DB::selectOne(
            "SELECT id, tenant_id FROM tenant_plan_assignments WHERE stripe_subscription_id = ?",
            [$stripeSubId]
        );

        if (!$assignment) {
            Log::info('Stripe subscription.deleted — no matching assignment', ['subscription_id' => $stripeSubId]);
            return;
        }

        try {
            DB::update(
                "UPDATE tenant_plan_assignments
                 SET status = 'cancelled', expires_at = NOW(), updated_at = NOW()
                 WHERE id = ?",
                [$assignment->id]
            );

            Log::info('Stripe subscription deleted — marked cancelled', [
                'tenant_id' => $assignment->tenant_id,
                'subscription_id' => $stripeSubId,
            ]);
        } catch (\Exception $e) {
            Log::error('Failed to handle subscription.deleted', [
                'subscription_id' => $stripeSubId,
                'error' => $e->getMessage(),
            ]);
            throw $e;
        }

        // Email tenant admin — subscription cancelled
        try {
            static::sendRequiredTenantAdminEmail(
                (int) $assignment->tenant_id,
                ['key' => 'emails_misc.stripe_subscription.cancelled_subject'],
                ['key' => 'emails_misc.stripe_subscription.cancelled_title'],
                ['key' => 'emails_misc.stripe_subscription.cancelled_body'],
                '/admin/billing',
                ['key' => 'emails_misc.stripe_subscription.cancelled_cta'],
                'default',
                'subscription deleted'
            );
        } catch (\Throwable $e) {
            Log::warning('[StripeSubscriptionService] handleSubscriptionDeleted email failed: ' . $e->getMessage());
            throw $e;
        }
    }

    /**
     * Handle invoice.paid — update current_period_end.
     */
    public static function handleInvoicePaid(object $invoice): void
    {
        $stripeSubId = $invoice->subscription ?? null;
        if (!$stripeSubId) {
            return;
        }

        $assignment = DB::selectOne(
            "SELECT id, tenant_id FROM tenant_plan_assignments WHERE stripe_subscription_id = ?",
            [$stripeSubId]
        );

        if (!$assignment) {
            return;
        }

        // Fetch the subscription to get updated period_end
        try {
            $client = StripeService::client();
            $sub = $client->subscriptions->retrieve($stripeSubId);
            $periodEnd = isset($sub->current_period_end)
                ? date('Y-m-d H:i:s', $sub->current_period_end)
                : null;

            DB::update(
                "UPDATE tenant_plan_assignments
                 SET stripe_current_period_end = ?, updated_at = NOW()
                 WHERE id = ?",
                [$periodEnd, $assignment->id]
            );

            Log::info('Stripe invoice paid — period end updated', [
                'tenant_id' => $assignment->tenant_id,
                'subscription_id' => $stripeSubId,
            ]);
        } catch (\Exception $e) {
            Log::error('Failed to handle invoice.paid', [
                'subscription_id' => $stripeSubId,
                'error' => $e->getMessage(),
            ]);
            throw $e;
        }

        // Email tenant admin — subscription renewed successfully
        try {
            $plan = DB::selectOne(
                "SELECT pp.name FROM tenant_plan_assignments tpa
                 JOIN pay_plans pp ON pp.id = tpa.pay_plan_id
                 WHERE tpa.id = ?",
                [$assignment->id]
            );
            $planName = $plan->name ?? '';
            static::sendRequiredTenantAdminEmail(
                (int) $assignment->tenant_id,
                ['key' => 'emails_misc.stripe_subscription.renewed_subject'],
                ['key' => 'emails_misc.stripe_subscription.renewed_title'],
                ['key' => 'emails_misc.stripe_subscription.renewed_body', 'params' => ['plan' => htmlspecialchars($planName, ENT_QUOTES, 'UTF-8')]],
                '/admin/billing',
                ['key' => 'emails_misc.stripe_subscription.renewed_cta'],
                'default',
                'invoice paid'
            );
        } catch (\Throwable $e) {
            Log::warning('[StripeSubscriptionService] handleInvoicePaid email failed: ' . $e->getMessage());
            throw $e;
        }
    }

    /**
     * Handle invoice.payment_failed — log warning.
     */
    public static function handleInvoicePaymentFailed(object $invoice): void
    {
        $stripeSubId = $invoice->subscription ?? null;

        $assignment = null;
        if ($stripeSubId) {
            $assignment = DB::selectOne(
                "SELECT id, tenant_id FROM tenant_plan_assignments WHERE stripe_subscription_id = ?",
                [$stripeSubId]
            );
        }

        Log::warning('Stripe invoice payment failed', [
            'invoice_id' => $invoice->id ?? null,
            'subscription_id' => $stripeSubId,
            'tenant_id' => $assignment->tenant_id ?? null,
            'customer_id' => $invoice->customer ?? null,
            'amount_due' => $invoice->amount_due ?? null,
        ]);

        // Urgent email to tenant admin — payment failed, action required
        if ($assignment && !empty($assignment->tenant_id)) {
            try {
                static::sendRequiredTenantAdminEmail(
                    (int) $assignment->tenant_id,
                    ['key' => 'emails_misc.stripe_subscription.payment_failed_subject'],
                    ['key' => 'emails_misc.stripe_subscription.payment_failed_title'],
                    ['key' => 'emails_misc.stripe_subscription.payment_failed_body'],
                    '/admin/billing',
                    ['key' => 'emails_misc.stripe_subscription.payment_failed_cta'],
                    'danger',
                    'invoice payment failed'
                );
            } catch (\Throwable $e) {
                Log::warning('[StripeSubscriptionService] handleInvoicePaymentFailed email failed: ' . $e->getMessage());
                throw $e;
            }
        }
    }

    /**
     * Send an email to the primary admin user of a tenant.
     */
    /**
     * Send 7-day renewal reminder emails to tenant admins.
     * Deduped per tenant+period for the full eligibility window to prevent duplicate sends.
     *
     * @return array{sent: int, errors: int}
     */
    public static function sendRenewalReminders(): array
    {
        $sent   = 0;
        $errors = 0;

        $assignments = DB::select(
            "SELECT tpa.id, tpa.tenant_id, tpa.stripe_current_period_end, pp.name AS plan_name
             FROM tenant_plan_assignments tpa
             JOIN pay_plans pp ON pp.id = tpa.pay_plan_id
             WHERE tpa.status = 'active'
               AND tpa.stripe_current_period_end IS NOT NULL
               AND tpa.stripe_current_period_end BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 7 DAY)"
        );

        foreach ($assignments as $assignment) {
            try {
                $periodDate = date('Y-m-d', strtotime($assignment->stripe_current_period_end));
                $cacheKey   = 'subscription_renewal_reminder:' . $assignment->tenant_id . ':' . $periodDate;

                if (Cache::has($cacheKey)) {
                    continue;
                }

                $planName = $assignment->plan_name ?? '';
                $dateFormatted = \Carbon\Carbon::parse($assignment->stripe_current_period_end)
                    ->locale(\App\I18n\FormattingLocale::carbon())
                    ->isoFormat('LL');

                $sentEmail = static::sendTenantAdminEmail(
                    (int) $assignment->tenant_id,
                    ['key' => 'emails_misc.stripe_subscription.renewal_reminder_subject'],
                    ['key' => 'emails_misc.stripe_subscription.renewal_reminder_title'],
                    ['key' => 'emails_misc.stripe_subscription.renewal_reminder_body', 'params' => [
                        'plan' => htmlspecialchars($planName, ENT_QUOTES, 'UTF-8'),
                        'date' => $dateFormatted,
                    ]],
                    '/admin/billing',
                    ['key' => 'emails_misc.stripe_subscription.renewal_reminder_cta']
                );

                if ($sentEmail) {
                    Cache::put($cacheKey, true, now()->addDays(8));
                    $sent++;
                } else {
                    $errors++;
                }
            } catch (\Throwable $e) {
                Log::warning('[StripeSubscriptionService] sendRenewalReminders failed for tenant ' . $assignment->tenant_id . ': ' . $e->getMessage());
                $errors++;
            }
        }

        return ['sent' => $sent, 'errors' => $errors];
    }

    /**
     * Send trial-ending reminder emails (7-day and 1-day windows).
     * Deduped per tenant+window for the full eligibility window to prevent duplicate sends.
     *
     * @return array{sent: int, errors: int}
     */
    public static function sendTrialEndingReminders(): array
    {
        $sent   = 0;
        $errors = 0;

        $assignments = DB::select(
            "SELECT tpa.id, tpa.tenant_id, tpa.stripe_current_period_end,
                    t.name AS community_name
             FROM tenant_plan_assignments tpa
             JOIN tenants t ON t.id = tpa.tenant_id
             WHERE tpa.status = 'trial'
               AND tpa.stripe_current_period_end IS NOT NULL"
        );

        foreach ($assignments as $assignment) {
            try {
                $periodEnd    = strtotime($assignment->stripe_current_period_end);
                $now          = time();
                $daysUntilEnd = ($periodEnd - $now) / 86400;
                $dateFormatted = \Carbon\Carbon::createFromTimestamp($periodEnd)
                    ->locale(\App\I18n\FormattingLocale::carbon())
                    ->isoFormat('LL');
                $communityName = htmlspecialchars($assignment->community_name ?? '', ENT_QUOTES, 'UTF-8');

                // 7-day window: between 6 and 8 days away
                if ($daysUntilEnd >= 6 && $daysUntilEnd < 8) {
                    $cacheKey = 'trial_ending_reminder:' . $assignment->tenant_id . ':7d';
                    if (!Cache::has($cacheKey)) {
                        $sentEmail = static::sendTenantAdminEmail(
                            (int) $assignment->tenant_id,
                            ['key' => 'emails_misc.stripe_subscription.trial_ending_7d_subject'],
                            ['key' => 'emails_misc.stripe_subscription.trial_ending_7d_title'],
                            ['key' => 'emails_misc.stripe_subscription.trial_ending_7d_body', 'params' => [
                                'community' => $communityName,
                                'date'      => $dateFormatted,
                            ]],
                            '/admin/billing',
                            ['key' => 'emails_misc.stripe_subscription.trial_ending_7d_cta']
                        );
                        if ($sentEmail) {
                            Cache::put($cacheKey, true, now()->addDays(8));
                            $sent++;
                        } else {
                            $errors++;
                        }
                    }
                }

                // 1-day window: between 0 and 2 days away
                if ($daysUntilEnd >= 0 && $daysUntilEnd < 2) {
                    $cacheKey = 'trial_ending_reminder:' . $assignment->tenant_id . ':1d';
                    if (!Cache::has($cacheKey)) {
                        $sentEmail = static::sendTenantAdminEmail(
                            (int) $assignment->tenant_id,
                            ['key' => 'emails_misc.stripe_subscription.trial_ending_1d_subject'],
                            ['key' => 'emails_misc.stripe_subscription.trial_ending_1d_title'],
                            ['key' => 'emails_misc.stripe_subscription.trial_ending_1d_body', 'params' => [
                                'community' => $communityName,
                                'date'      => $dateFormatted,
                            ]],
                            '/admin/billing',
                            ['key' => 'emails_misc.stripe_subscription.trial_ending_1d_cta']
                        );
                        if ($sentEmail) {
                            Cache::put($cacheKey, true, now()->addDays(3));
                            $sent++;
                        } else {
                            $errors++;
                        }
                    }
                }
            } catch (\Throwable $e) {
                Log::warning('[StripeSubscriptionService] sendTrialEndingReminders failed for tenant ' . $assignment->tenant_id . ': ' . $e->getMessage());
                $errors++;
            }
        }

        return ['sent' => $sent, 'errors' => $errors];
    }

    /**
     * Send a templated email to the tenant admin, rendering subject/title/body/CTA
     * in the admin's preferred_language.
     *
     * @param array{key:string,params?:array} $subject
     * @param array{key:string,params?:array} $title
     * @param array{key:string,params?:array} $body
     * @param array{key:string,params?:array} $ctaText
     */
    private static function sendTenantAdminEmail(int $tenantId, array $subject, array $title, array $body, string $link, array $ctaText, string $theme = 'default'): bool
    {
        $previousTenantId = TenantContext::currentId();
        TenantContext::setById($tenantId);

        try {
            $admin = DB::table('users')
                ->where('tenant_id', $tenantId)
                ->where('role', 'admin')
                ->whereNotNull('email')
                ->select(['email', 'first_name', 'name', 'preferred_language'])
                ->first();

            if (!$admin || empty($admin->email)) {
                return false;
            }

            return (bool) LocaleContext::withLocale($admin, function () use ($admin, $subject, $title, $body, $link, $ctaText, $theme, $tenantId): bool {
                $firstName = $admin->first_name ?? $admin->name ?? __('emails.common.fallback_name');
                $fullUrl   = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . $link;

                $builder = EmailTemplateBuilder::make();
                if ($theme !== 'default') {
                    $builder->theme($theme);
                }

                $html = $builder
                    ->title(__($title['key'], $title['params'] ?? []))
                    ->greeting($firstName)
                    ->paragraph(__($body['key'], $body['params'] ?? []))
                    ->button(__($ctaText['key'], $ctaText['params'] ?? []), $fullUrl)
                    ->render();

                if (!\App\Services\EmailDispatchService::sendRaw($admin->email, __($subject['key'], $subject['params'] ?? []), $html, null, null, null, 'billing', ['tenant_id' => $tenantId])) {
                    Log::warning('[StripeSubscriptionService] tenant admin email failed', ['tenant_id' => $tenantId]);
                    return false;
                }

                return true;
            });
        } finally {
            if ($previousTenantId !== null) {
                TenantContext::setById($previousTenantId);
            } else {
                TenantContext::reset();
            }
        }
    }

    /**
     * @param array{key:string,params?:array} $subject
     * @param array{key:string,params?:array} $title
     * @param array{key:string,params?:array} $body
     * @param array{key:string,params?:array} $ctaText
     */
    private static function sendRequiredTenantAdminEmail(int $tenantId, array $subject, array $title, array $body, string $link, array $ctaText, string $theme, string $event): void
    {
        if (static::sendTenantAdminEmail($tenantId, $subject, $title, $body, $link, $ctaText, $theme)) {
            return;
        }

        throw new \RuntimeException('Stripe subscription admin email failed for ' . $event);
    }

    /**
     * Get subscription details for a tenant.
     *
     * @return array|null Subscription info or null if no assignment exists
     */
    public static function getSubscriptionDetails(int $tenantId): ?array
    {
        try {
            $result = DB::selectOne(
                "SELECT tpa.id, tpa.tenant_id, tpa.pay_plan_id, tpa.status,
                        tpa.starts_at, tpa.expires_at, tpa.trial_ends_at,
                        tpa.stripe_subscription_id, tpa.stripe_current_period_end,
                        tpa.created_at, tpa.updated_at,
                        pp.name AS plan_name, pp.slug AS plan_slug,
                        pp.tier_level AS plan_tier_level, pp.description AS plan_description,
                        pp.price_monthly, pp.price_yearly
                 FROM tenant_plan_assignments tpa
                 JOIN pay_plans pp ON pp.id = tpa.pay_plan_id
                 WHERE tpa.tenant_id = ?
                 ORDER BY tpa.created_at DESC
                 LIMIT 1",
                [$tenantId]
            );
        } catch (\Exception $e) {
            // Fallback if Stripe columns don't exist yet (migration not run)
            Log::warning('getSubscriptionDetails: Stripe columns may not exist, falling back', [
                'error' => $e->getMessage(),
            ]);
            $result = DB::selectOne(
                "SELECT tpa.id, tpa.tenant_id, tpa.pay_plan_id, tpa.status,
                        tpa.starts_at, tpa.expires_at, tpa.trial_ends_at,
                        tpa.created_at, tpa.updated_at,
                        pp.name AS plan_name, pp.slug AS plan_slug,
                        pp.tier_level AS plan_tier_level, pp.description AS plan_description,
                        pp.price_monthly, pp.price_yearly
                 FROM tenant_plan_assignments tpa
                 JOIN pay_plans pp ON pp.id = tpa.pay_plan_id
                 WHERE tpa.tenant_id = ?
                 ORDER BY tpa.created_at DESC
                 LIMIT 1",
                [$tenantId]
            );
        }

        if (!$result) {
            return null;
        }

        return (array) $result;
    }

    /**
     * Get invoice history for a tenant from Stripe.
     *
     * @return array List of invoice summaries
     */
    public static function getInvoiceHistory(int $tenantId): array
    {
        $tenant = DB::selectOne("SELECT stripe_customer_id FROM tenants WHERE id = ?", [$tenantId]);
        if (!$tenant || empty($tenant->stripe_customer_id)) {
            return [];
        }

        try {
            $client = StripeService::client();
            $invoices = $client->invoices->all([
                'customer' => $tenant->stripe_customer_id,
                'limit' => 50,
            ]);

            $result = [];
            foreach ($invoices->data as $invoice) {
                $result[] = [
                    'id' => $invoice->id,
                    'amount_paid' => $invoice->amount_paid,
                    'currency' => $invoice->currency,
                    'status' => $invoice->status,
                    'created' => date('Y-m-d H:i:s', $invoice->created),
                    'hosted_invoice_url' => $invoice->hosted_invoice_url,
                    'invoice_pdf' => $invoice->invoice_pdf,
                ];
            }

            return $result;
        } catch (\Exception $e) {
            Log::error('Failed to fetch Stripe invoice history', [
                'tenant_id' => $tenantId,
                'error' => $e->getMessage(),
            ]);
            return [];
        }
    }
}
