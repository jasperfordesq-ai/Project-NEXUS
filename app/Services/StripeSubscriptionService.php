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
     * Where each currency's amount and Stripe price id live on a `pay_plans`
     * row. The euro columns are the original ones, so a price id stored before
     * pound prices existed is read as the euro price. Public so the plan
     * update can tell which amounts it changed without a second copy.
     */
    public const PRICE_COLUMNS = [
        'eur' => [
            'monthly' => ['amount' => 'price_monthly', 'price_id' => 'stripe_price_id_monthly', 'interval' => 'month'],
            'yearly' => ['amount' => 'price_yearly', 'price_id' => 'stripe_price_id_yearly', 'interval' => 'year'],
        ],
        'gbp' => [
            'monthly' => ['amount' => 'price_monthly_gbp', 'price_id' => 'stripe_price_id_monthly_gbp', 'interval' => 'month'],
            'yearly' => ['amount' => 'price_yearly_gbp', 'price_id' => 'stripe_price_id_yearly_gbp', 'interval' => 'year'],
        ],
    ];

    /**
     * The currency a community is billed in: pounds when its own currency is
     * GBP, euro for everything else. Plans are priced in euro and pounds only,
     * so a community set to any other currency pays the euro price.
     *
     * The community's own currency is TenantContext::getCurrency() read in
     * that community's context (its `general.default_currency` /
     * `default_currency` setting, then `general.currency` in its
     * configuration, then the installation default).
     */
    public static function billingCurrencyFor(int $tenantId): string
    {
        $previousTenantId = TenantContext::currentId();

        if ($previousTenantId === $tenantId) {
            $currency = TenantContext::getCurrency();
        } else {
            TenantContext::setById($tenantId);
            try {
                $currency = TenantContext::getCurrency();
            } finally {
                if ($previousTenantId !== null) {
                    TenantContext::setById($previousTenantId);
                } else {
                    TenantContext::reset();
                }
            }
        }

        return strtolower($currency) === 'gbp' ? 'gbp' : 'eur';
    }

    /**
     * A plan is free only when nothing is charged for it in either currency:
     * the euro and pound prices, monthly and yearly, all 0 or missing. A plan
     * priced only in pounds is not free, so checkout must send it to Stripe
     * rather than activate it directly. One definition for every checkout.
     */
    public static function isFreePlan(object $plan): bool
    {
        foreach (['price_monthly', 'price_yearly', 'price_monthly_gbp', 'price_yearly_gbp'] as $field) {
            if ((float) ($plan->{$field} ?? 0) !== 0.0) {
                return false;
            }
        }

        return true;
    }

    /**
     * The currency this plan is actually charged in for a community billed in
     * $communityCurrency. A plan with no pound price for that interval (every
     * retired `legacy-…` plan, any custom plan) is charged in euro with its
     * euro amount: sending the euro number as pounds would undercharge.
     */
    private static function chargeCurrency(object $plan, string $interval, string $communityCurrency): string
    {
        if ($communityCurrency === 'gbp' && self::planAmount($plan, 'gbp', $interval) > 0) {
            return 'gbp';
        }

        return 'eur';
    }

    /**
     * What card checkout would ask Stripe to charge for $plan and $interval
     * ('monthly' | 'yearly') in a community billed in $communityCurrency, and
     * the plan's one-off setup fee in that same currency. One definition for
     * the checkout itself and for every screen that quotes a price before it,
     * so the plan picker can never show euro to a community charged in pounds.
     *
     * The setup fee here is the plan's own. Whether it is still due for a
     * particular community is setupFeeDue().
     *
     * @return array{currency: 'eur'|'gbp', amount: float, setup_fee: float}
     */
    public static function quoteFor(object $plan, string $interval, string $communityCurrency): array
    {
        $interval = $interval === 'yearly' ? 'yearly' : 'monthly';
        $currency = self::chargeCurrency($plan, $interval, $communityCurrency);
        $setupColumn = $currency === 'gbp' ? 'setup_fee_gbp' : 'setup_fee';

        return [
            'currency' => $currency === 'gbp' ? 'gbp' : 'eur',
            'amount' => self::planAmount($plan, $currency, $interval),
            'setup_fee' => (float) ($plan->{$setupColumn} ?? 0),
        ];
    }

    private static function planAmount(object $plan, string $currency, string $interval): float
    {
        $column = self::PRICE_COLUMNS[$currency][$interval]['amount'];

        return (float) ($plan->{$column} ?? 0);
    }

    private static function planPriceId(object $plan, string $currency, string $interval): ?string
    {
        $column = self::PRICE_COLUMNS[$currency][$interval]['price_id'];
        $value = $plan->{$column} ?? null;

        return is_string($value) && $value !== '' ? $value : null;
    }

    /**
     * Sync a pay_plan to Stripe (create/update Product + Prices).
     *
     * One Stripe price per currency and interval, each created with exactly
     * that currency's amount. With no $currency (the platform team's sync
     * button, plan create/edit) every currency the plan has a price in is
     * synced; checkout passes the one currency it needs.
     *
     * Idempotent: a price id already stored is never replaced. An edited
     * amount reaches Stripe through replacePlanPrice(), which the plan update
     * calls only for the amounts that update changed.
     */
    public static function syncPlanToStripe(int $planId, ?string $currency = null): void
    {
        $plan = DB::selectOne("SELECT * FROM pay_plans WHERE id = ?", [$planId]);

        if (!$plan) {
            Log::warning('StripeSubscriptionService::syncPlanToStripe — plan not found', ['plan_id' => $planId]);
            return;
        }

        if ($currency !== null && !isset(self::PRICE_COLUMNS[$currency])) {
            throw new \InvalidArgumentException("Plans are not priced in currency '{$currency}'");
        }
        $currencies = $currency !== null ? [$currency] : array_keys(self::PRICE_COLUMNS);

        try {
            $client = StripeService::client();

            // --- Product ---
            if (empty($plan->stripe_product_id)) {
                $product = $client->products->create([
                    'name' => $plan->name,
                    'description' => $plan->description ?: "Plan: {$plan->name}",
                    'metadata' => ['nexus_plan_id' => (string) $planId],
                ]);
                $stripeProductId = $product->id;
                // Saved at once, not after every price exists: if a later
                // price creation failed, this id was never stored, and the
                // next sync (or the next checkout) made a second product and
                // a second set of prices in Stripe.
                DB::update("UPDATE pay_plans SET stripe_product_id = ?, updated_at = NOW() WHERE id = ?", [$stripeProductId, $planId]);

                Log::info('Stripe product created', ['plan_id' => $planId, 'product_id' => $product->id]);
            } else {
                $stripeProductId = $plan->stripe_product_id;

                // Update existing product name/description
                $client->products->update($stripeProductId, [
                    'name' => $plan->name,
                    'description' => $plan->description ?: "Plan: {$plan->name}",
                ]);
            }

            // --- Prices: one per currency and interval ---
            foreach ($currencies as $priceCurrency) {
                foreach (self::PRICE_COLUMNS[$priceCurrency] as $interval => $columns) {
                    $amount = self::planAmount($plan, $priceCurrency, $interval);
                    if (self::planPriceId($plan, $priceCurrency, $interval) !== null || $amount <= 0) {
                        continue;
                    }

                    $price = $client->prices->create([
                        'product' => $stripeProductId,
                        'unit_amount' => (int) round($amount * 100),
                        'currency' => $priceCurrency,
                        'recurring' => ['interval' => $columns['interval']],
                        'metadata' => [
                            'nexus_plan_id' => (string) $planId,
                            'interval' => $interval,
                            'currency' => $priceCurrency,
                        ],
                    ]);
                    // Saved at once, for the same reason as the product id.
                    // The column name is one of PRICE_COLUMNS' own constants.
                    DB::update(
                        "UPDATE pay_plans SET {$columns['price_id']} = ?, updated_at = NOW() WHERE id = ?",
                        [$price->id, $planId]
                    );

                    Log::info('Stripe price created', [
                        'plan_id' => $planId,
                        'price_id' => $price->id,
                        'currency' => $priceCurrency,
                        'interval' => $interval,
                    ]);
                }
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
     * Bring a plan's stored Stripe price for one currency and interval in
     * line with the plan's current amount.
     *
     * Stripe prices cannot be edited, so an edited amount gets a new price
     * and the stored id is replaced. An amount taken to 0 or cleared is not
     * sold by card at all, so the stored id is retired and the column
     * emptied: checkout can no longer charge it. syncPlanToStripe never does
     * either; it stays idempotent.
     *
     * A community already paying by card keeps the price it signed up at;
     * nothing here touches a subscription. The retired id is kept in
     * `pay_plan_stripe_prices`, with what Stripe says it charged, so a
     * subscription update still naming it is recognised as this plan.
     *
     * Replacing creates the new price first: if Stripe refuses, nothing is
     * written, the old id stays, and the exception is thrown for the caller
     * to report.
     */
    public static function replacePlanPrice(int $planId, string $currency, string $interval): void
    {
        if (!isset(self::PRICE_COLUMNS[$currency][$interval])) {
            throw new \InvalidArgumentException("Plans are not priced in '{$currency}' / '{$interval}'");
        }
        $columns = self::PRICE_COLUMNS[$currency][$interval];

        $plan = DB::selectOne("SELECT * FROM pay_plans WHERE id = ?", [$planId]);
        if (!$plan) {
            Log::warning('StripeSubscriptionService::replacePlanPrice — plan not found', ['plan_id' => $planId]);
            return;
        }

        $oldPriceId = self::planPriceId($plan, $currency, $interval);
        if ($oldPriceId === null) {
            // Nothing stored: the ordinary sync creates a price when one is needed.
            return;
        }
        $amount = self::planAmount($plan, $currency, $interval);

        if ($amount <= 0) {
            // Retiring needs no Stripe call and must happen even when Stripe
            // cannot be reached or has no key here: leaving the id would keep
            // charging an amount the plan no longer has. Stripe is asked only
            // what the price charged; failing that, the record says 0.00 and
            // the log says why.
            try {
                $retiredAmount = self::stripePriceAmount(StripeService::client(), $oldPriceId);
            } catch (\Exception $e) {
                $retiredAmount = 0.0;
                Log::warning('StripeSubscriptionService::replacePlanPrice — could not read the retired price from Stripe; recorded as 0.00', [
                    'plan_id' => $planId, 'price_id' => $oldPriceId, 'error' => $e->getMessage(),
                ]);
            }

            self::swapStoredPrice($planId, $columns['price_id'], $oldPriceId, null, $currency, $interval, $retiredAmount);
            Log::info('Stripe price retired: the plan no longer charges this amount', [
                'plan_id' => $planId, 'currency' => $currency, 'interval' => $interval, 'old_price_id' => $oldPriceId,
            ]);
            return;
        }

        try {
            $client = StripeService::client();
            if (empty($plan->stripe_product_id)) {
                throw new \RuntimeException('The plan has a Stripe price but no Stripe product');
            }
            $retiredAmount = self::stripePriceAmount($client, $oldPriceId);

            $price = $client->prices->create([
                'product' => $plan->stripe_product_id,
                'unit_amount' => (int) round($amount * 100),
                'currency' => $currency,
                'recurring' => ['interval' => $columns['interval']],
                'metadata' => [
                    'nexus_plan_id' => (string) $planId,
                    'interval' => $interval,
                    'currency' => $currency,
                    'replaces' => $oldPriceId,
                ],
            ]);
        } catch (\Exception $e) {
            Log::error('StripeSubscriptionService::replacePlanPrice failed; the old price is still sold', [
                'plan_id' => $planId,
                'currency' => $currency,
                'interval' => $interval,
                'error' => $e->getMessage(),
            ]);
            throw $e;
        }

        self::swapStoredPrice($planId, $columns['price_id'], $oldPriceId, (string) $price->id, $currency, $interval, $retiredAmount);
        Log::info('Stripe price replaced', [
            'plan_id' => $planId,
            'currency' => $currency,
            'interval' => $interval,
            'old_price_id' => $oldPriceId,
            'new_price_id' => $price->id,
        ]);
    }

    /**
     * Compare every stored Stripe price of a plan with the plan's amounts and
     * replace or retire what differs. This is how a replacement that failed
     * at save time is retried: the platform team's Sync button calls it.
     *
     * Never throws: a currency/interval Stripe refuses is reported 'failed'
     * and logged at error, and the others still run.
     *
     * @return list<array{currency: string, interval: string, outcome: 'replaced'|'retired'|'unchanged'|'failed'}>
     */
    public static function reconcilePlanPrices(int $planId): array
    {
        $plan = DB::selectOne("SELECT * FROM pay_plans WHERE id = ?", [$planId]);
        if (!$plan) {
            return [];
        }

        $results = [];
        $client = null;
        foreach (self::PRICE_COLUMNS as $currency => $intervals) {
            foreach (array_keys($intervals) as $interval) {
                $storedId = self::planPriceId($plan, $currency, $interval);
                if ($storedId === null) {
                    continue;
                }
                $amount = self::planAmount($plan, $currency, $interval);

                try {
                    if ($amount <= 0) {
                        self::replacePlanPrice($planId, $currency, $interval);
                        $outcome = 'retired';
                    } else {
                        $client ??= StripeService::client();
                        $charged = (int) round(self::stripePriceAmount($client, $storedId) * 100);
                        if ($charged === (int) round($amount * 100)) {
                            $outcome = 'unchanged';
                        } else {
                            self::replacePlanPrice($planId, $currency, $interval);
                            $outcome = 'replaced';
                        }
                    }
                } catch (\Exception $e) {
                    Log::error('StripeSubscriptionService::reconcilePlanPrices — price not brought in line', [
                        'plan_id' => $planId,
                        'currency' => $currency,
                        'interval' => $interval,
                        'error' => $e->getMessage(),
                    ]);
                    $outcome = 'failed';
                }

                $results[] = ['currency' => $currency, 'interval' => $interval, 'outcome' => $outcome];
            }
        }

        return $results;
    }

    /** What a Stripe price charges, in the currency's main unit. */
    private static function stripePriceAmount(\Stripe\StripeClient $client, string $priceId): float
    {
        $price = $client->prices->retrieve($priceId);

        return ((int) ($price->unit_amount ?? 0)) / 100;
    }

    /**
     * Store $newPriceId (null = none) in place of $oldPriceId and record the
     * old one as retired, in one transaction. Only where the old id is still
     * the stored one: a second editor racing this one keeps its own result.
     */
    private static function swapStoredPrice(int $planId, string $priceColumn, string $oldPriceId, ?string $newPriceId, string $currency, string $interval, float $retiredAmount): void
    {
        DB::transaction(function () use ($planId, $priceColumn, $oldPriceId, $newPriceId, $currency, $interval, $retiredAmount): void {
            $moved = DB::update(
                "UPDATE pay_plans SET {$priceColumn} = ?, updated_at = NOW()
                 WHERE id = ? AND {$priceColumn} = ?",
                [$newPriceId, $planId, $oldPriceId]
            );
            if ($moved === 0) {
                return;
            }

            DB::insert(
                "INSERT IGNORE INTO pay_plan_stripe_prices
                     (pay_plan_id, stripe_price_id, currency, billing_interval, amount, retired_at)
                 VALUES (?, ?, ?, ?, ?, NOW())",
                [$planId, $oldPriceId, $currency, $interval, round($retiredAmount, 2)]
            );
        });
    }

    /**
     * The plan a Stripe price belongs to: one it sells at now, or one it
     * used to sell at (a community still paying an older price). Null when
     * no plan has ever used it.
     */
    public static function planIdForStripePrice(string $priceId): ?int
    {
        if ($priceId === '') {
            return null;
        }

        $current = DB::selectOne(
            "SELECT id FROM pay_plans
             WHERE stripe_price_id_monthly = ? OR stripe_price_id_yearly = ?
                OR stripe_price_id_monthly_gbp = ? OR stripe_price_id_yearly_gbp = ?
             LIMIT 1",
            [$priceId, $priceId, $priceId, $priceId]
        );
        if ($current) {
            return (int) $current->id;
        }

        $retired = DB::selectOne(
            "SELECT pay_plan_id FROM pay_plan_stripe_prices WHERE stripe_price_id = ? LIMIT 1",
            [$priceId]
        );

        return $retired ? (int) $retired->pay_plan_id : null;
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
        // Load tenant
        $tenant = DB::selectOne("SELECT id, name, stripe_customer_id FROM tenants WHERE id = ?", [$tenantId]);
        if (!$tenant) {
            throw new \RuntimeException("Tenant {$tenantId} not found");
        }

        // F-178: validate the plan before any Stripe call. A withdrawn
        // (is_active = 0) plan must not be purchasable — and a zero-price one
        // would otherwise activate below without Stripe ever being involved.
        $plan = DB::selectOne("SELECT * FROM pay_plans WHERE id = ?", [$planId]);
        if (!$plan) {
            throw new \RuntimeException("Plan {$planId} not found");
        }
        if (!(int) ($plan->is_active ?? 0)) {
            throw new \RuntimeException("Plan {$planId} is not available");
        }

        // 🔴 Never a second subscription. A checkout always creates a NEW
        // Stripe subscription; nothing here changes or cancels an existing
        // one. So while Stripe still has one open for this community
        // (paying, on trial, or with a failed card), a checkout would leave
        // two charging, with only the newer one on the record. Refused before
        // Stripe is touched, for a no-charge plan as well (which would drop
        // the stored subscription id and leave that subscription charging).
        if (TenantBillingService::hasLiveCardSubscription($tenantId)) {
            throw new \DomainException('billing_already_subscribed');
        }

        $client = StripeService::client();

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

        // The price in the currency this community pays in, and only that
        // currency's: a pound community never gets the euro price id, nor
        // the reverse.
        $interval = $billingInterval === 'yearly' ? 'yearly' : 'monthly';
        $currency = self::chargeCurrency($plan, $interval, static::billingCurrencyFor($tenantId));
        $priceId = self::planPriceId($plan, $currency, $interval);

        // Free plan (nothing charged in either currency) — activate directly without Stripe
        if (self::isFreePlan($plan)) {
            DB::transaction(static function () use ($tenantId, $planId): void {
                // The record in force only. `WHERE tenant_id = ?` used to
                // rewrite every historic record to this plan and to `active`.
                $existing = self::recordInForce($tenantId);
                if ($existing) {
                    DB::update(
                        "UPDATE tenant_plan_assignments
                         SET pay_plan_id = ?, status = 'active', stripe_subscription_id = NULL,
                             stripe_status = NULL,
                             starts_at = NOW(), expires_at = NULL, updated_at = NOW()
                         WHERE id = ? AND tenant_id = ?",
                        [$planId, $existing->id, $tenantId]
                    );
                } else {
                    DB::insert(
                        "INSERT INTO tenant_plan_assignments
                         (tenant_id, pay_plan_id, status, stripe_subscription_id, starts_at, created_at, updated_at)
                         VALUES (?, ?, 'active', NULL, NOW(), NOW(), NOW())",
                        [$tenantId, $planId]
                    );
                }
            });
            Log::info('Free plan activated for tenant', ['tenant_id' => $tenantId, 'plan_id' => $planId]);
            return ['activated' => true, 'checkout_url' => null];
        }

        // Auto-sync to Stripe if price IDs are missing (e.g., pre-existing plans)
        if ($priceId === null) {
            Log::info("Auto-syncing plan {$planId} to Stripe (no {$currency} price ID for {$billingInterval})");
            static::syncPlanToStripe($planId, $currency);
            // Reload plan from DB after sync (stdClass from selectOne has no refresh())
            $plan = DB::selectOne("SELECT * FROM pay_plans WHERE id = ?", [$planId]);
            $priceId = $plan ? self::planPriceId($plan, $currency, $interval) : null;

            if ($priceId === null) {
                throw new \RuntimeException("Failed to sync plan {$planId} to Stripe — no {$currency} price created for {$billingInterval}");
            }
        }

        // Build success/cancel URLs — must include tenant slug for React Router to resolve the tenant
        $frontendBase = rtrim(TenantContext::getFrontendUrl(), '/');
        $slugPrefix   = TenantContext::getSlugPrefix(); // e.g. "/hour-timebank"
        $successUrl   = $frontendBase . $slugPrefix . '/admin/billing/checkout-return?session_id={CHECKOUT_SESSION_ID}';
        $cancelUrl    = $frontendBase . $slugPrefix . '/admin/billing?cancelled=1';

        // The plan's one-off setup fee, on a community's first payment only
        // (setupFeeApplies()). A one-off line in a subscription checkout is
        // charged on the first invoice and never again.
        $lineItems = [['price' => $priceId, 'quantity' => 1]];
        $setupFee = self::setupFeeDue($tenantId, $plan, $currency);
        if ($setupFee > 0) {
            $lineItems[] = [
                'price_data' => [
                    'currency' => $currency,
                    'unit_amount' => (int) round($setupFee * 100),
                    'product_data' => ['name' => __('api.billing_setup_fee_line', ['plan' => (string) $plan->name])],
                ],
                'quantity' => 1,
            ];
        }

        try {
            $session = $client->checkout->sessions->create([
                'mode' => 'subscription',
                'customer' => $customerId,
                'line_items' => $lineItems,
                'metadata' => [
                    'nexus_tenant_id' => (string) $tenantId,
                    'nexus_plan_id' => (string) $planId,
                    // What this checkout adds as the one-off setup fee (0 when
                    // none is due), so its completion can record it as taken.
                    'nexus_setup_fee' => (string) $setupFee,
                    // Kept on the plan record when the checkout completes, so
                    // the community's billing page can say monthly or yearly.
                    'nexus_billing_interval' => $interval,
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
     * Whether a setup fee is still to be taken from this community: only when
     * it has never paid before, in any way. That is no setup fee recorded as
     * taken by card, no payment on record (a community already paying by
     * invoice was set up long ago; a payment voided as a mistake is not one),
     * and no plan record that ever carried a card subscription (one that
     * subscribed before the fee was charged here).
     */
    public static function setupFeeApplies(int $tenantId): bool
    {
        if (DB::table('tenant_billing_standing')->where('tenant_id', $tenantId)->whereNotNull('setup_fee_paid_at')->exists()) {
            return false;
        }
        if (DB::table('billing_payments')->where('tenant_id', $tenantId)->whereNull('voided_at')->exists()) {
            return false;
        }

        return !DB::table('tenant_plan_assignments')
            ->where('tenant_id', $tenantId)
            ->whereNotNull('stripe_subscription_id')
            ->where('stripe_subscription_id', '<>', '')
            ->exists();
    }

    /**
     * The setup fee card checkout adds for this community and plan, in the
     * currency the checkout charges in: the plan's fee when one is still due
     * (setupFeeApplies()), otherwise 0.
     */
    public static function setupFeeDue(int $tenantId, object $plan, string $currency): float
    {
        $column = $currency === 'gbp' ? 'setup_fee_gbp' : 'setup_fee';
        $fee = (float) ($plan->{$column} ?? 0);

        return $fee > 0 && self::setupFeeApplies($tenantId) ? $fee : 0.0;
    }

    /**
     * The community's plan record in force, locked for the caller's
     * transaction: the newest active one, else the newest on trial (the same
     * record PlanTerms::forCommunity() reads), else the newest of any status,
     * else null.
     *
     * Everything that writes "the community's plan" writes this one record.
     * The older ones are history and are never touched.
     */
    private static function recordInForce(int $tenantId): ?object
    {
        return DB::selectOne(
            "SELECT id, tenant_id, status, stripe_subscription_id, stripe_status
             FROM tenant_plan_assignments
             WHERE tenant_id = ?
             ORDER BY (status = 'active') DESC, (status = 'trial') DESC, id DESC
             LIMIT 1
             FOR UPDATE",
            [$tenantId]
        );
    }

    /**
     * Change the plan of a community's EXISTING card subscription.
     *
     * A checkout always starts a new subscription, so it cannot be how a card
     * payer changes plan (that was the double charge). This swaps the price on
     * the subscription Stripe already holds. Stripe works out the difference
     * for the rest of the current period and puts it on the next invoice
     * (`create_prorations`, its default): more to pay when moving up, a credit
     * when moving down. No setup fee is added: that is for a first payment.
     *
     * Refusals are \DomainException with a fixed word, which the controller
     * turns into a sentence: `billing_no_card_subscription` (nothing to
     * change: use checkout), `billing_card_needs_attention` (the last payment
     * failed), `billing_same_plan`, `billing_plan_not_sold` (no price for that
     * period), `billing_currency_mismatch` (Stripe keeps a subscription in one
     * currency).
     *
     * @return array{plan_id:int, plan_name:string, billing_interval:string}
     */
    public static function changeSubscriptionPlan(int $tenantId, int $planId, ?string $billingInterval, ?int $actedBy = null): array
    {
        $ended = implode("','", TenantBillingService::STRIPE_SUBSCRIPTION_ENDED);
        $record = DB::selectOne(
            "SELECT id, pay_plan_id, stripe_subscription_id, stripe_status, billing_interval, status
             FROM tenant_plan_assignments
             WHERE tenant_id = ?
               AND stripe_subscription_id IS NOT NULL AND stripe_subscription_id <> ''
               AND status <> 'cancelled'
               AND (stripe_status IS NULL OR stripe_status NOT IN ('{$ended}'))
             ORDER BY id DESC
             LIMIT 1",
            [$tenantId]
        );
        if (!$record) {
            throw new \DomainException('billing_no_card_subscription');
        }
        if ($record->stripe_status !== null && !in_array($record->stripe_status, ['active', 'trialing'], true)) {
            throw new \DomainException('billing_card_needs_attention');
        }

        $plan = DB::selectOne("SELECT * FROM pay_plans WHERE id = ?", [$planId]);
        if (!$plan || !(int) ($plan->is_active ?? 0)) {
            throw new \RuntimeException("Plan {$planId} is not available");
        }

        $currentInterval = self::knownInterval($record->billing_interval);
        $interval = self::knownInterval($billingInterval) ?? $currentInterval ?? 'monthly';
        if ((int) $record->pay_plan_id === $planId && $currentInterval === $interval) {
            throw new \DomainException('billing_same_plan');
        }

        $currency = self::chargeCurrency($plan, $interval, static::billingCurrencyFor($tenantId));
        if (self::planAmount($plan, $currency, $interval) <= 0) {
            throw new \DomainException('billing_plan_not_sold');
        }

        $client = StripeService::client();
        $subscription = $client->subscriptions->retrieve((string) $record->stripe_subscription_id);
        $item = $subscription->items->data[0] ?? null;
        if (!is_object($item) || !is_string($item->id ?? null) || $item->id === '') {
            throw new \RuntimeException('The Stripe subscription has no item to change');
        }

        // Stripe keeps a subscription in the currency it started in.
        $subscriptionCurrency = strtolower((string) ($subscription->currency ?? $item->price->currency ?? ''));
        if ($subscriptionCurrency !== '' && $subscriptionCurrency !== $currency) {
            throw new \DomainException('billing_currency_mismatch');
        }

        $priceId = self::planPriceId($plan, $currency, $interval);
        if ($priceId === null) {
            static::syncPlanToStripe($planId, $currency);
            $plan = DB::selectOne("SELECT * FROM pay_plans WHERE id = ?", [$planId]);
            $priceId = $plan ? self::planPriceId($plan, $currency, $interval) : null;
            if ($priceId === null) {
                throw new \RuntimeException("Failed to sync plan {$planId} to Stripe — no {$currency} price created for {$interval}");
            }
        }

        $client->subscriptions->update((string) $record->stripe_subscription_id, [
            'items' => [['id' => $item->id, 'price' => $priceId]],
            'proration_behavior' => 'create_prorations',
            'metadata' => [
                'nexus_tenant_id' => (string) $tenantId,
                'nexus_plan_id' => (string) $planId,
                'nexus_billing_interval' => $interval,
            ],
        ]);

        // Stripe has changed it. The record is written at once, so the screen
        // shows the new plan without waiting for Stripe's own update event
        // (which will then find nothing left to change).
        $oldPlanId = (int) $record->pay_plan_id;
        DB::update(
            "UPDATE tenant_plan_assignments SET pay_plan_id = ?, billing_interval = ?, updated_at = NOW() WHERE id = ? AND tenant_id = ?",
            [$planId, $interval, $record->id, $tenantId]
        );
        TenantBillingService::logAudit(
            $tenantId,
            $actedBy,
            'plan_changed',
            ['pay_plan_id' => $oldPlanId, 'billing_interval' => $currentInterval],
            ['pay_plan_id' => $planId, 'billing_interval' => $interval, 'source' => 'card'],
            'card'
        );
        // A new plan is new terms: the days over a member number start again.
        BillingStandingService::restartLimitClock([$tenantId]);
        \App\Support\Billing\PlanTerms::flush();
        \App\Support\Billing\JoiningGate::flush();

        Log::info('Stripe subscription plan changed', [
            'tenant_id' => $tenantId,
            'subscription_id' => $record->stripe_subscription_id,
            'old_plan_id' => $oldPlanId,
            'new_plan_id' => $planId,
            'billing_interval' => $interval,
        ]);

        // Tell the admins. The change is made whatever becomes of the email.
        if ($oldPlanId !== $planId) {
            try {
                $oldPlan = DB::selectOne("SELECT name FROM pay_plans WHERE id = ?", [$oldPlanId]);
                static::sendTenantAdminEmail(
                    $tenantId,
                    ['key' => 'emails_misc.stripe_subscription.plan_changed_subject', 'params' => ['new_plan' => (string) $plan->name]],
                    ['key' => 'emails_misc.stripe_subscription.plan_changed_title'],
                    ['key' => 'emails_misc.stripe_subscription.plan_changed_body', 'params' => ['old_plan' => (string) ($oldPlan->name ?? ''), 'new_plan' => (string) $plan->name]],
                    '/admin/billing',
                    ['key' => 'emails_misc.stripe_subscription.plan_changed_cta']
                );
            } catch (\Throwable $e) {
                Log::warning('[StripeSubscriptionService] plan change email failed: ' . $e->getMessage());
            }
        }

        return ['plan_id' => $planId, 'plan_name' => (string) $plan->name, 'billing_interval' => $interval];
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
        // Monthly or yearly, as the checkout was created. Absent on a session
        // made before this was recorded: then it is left unknown.
        $billingInterval = self::knownInterval($session->metadata->nexus_billing_interval ?? null);

        if (!$tenantId || !$planId) {
            Log::warning('Stripe checkout.session.completed missing nexus metadata', [
                'session_id' => $session->id ?? null,
            ]);
            return;
        }

        // F-178: a completed checkout is not a paid one. With a delayed payment
        // method Stripe reports `unpaid` here and settles later; activating now
        // granted the plan before (or without) payment. `no_payment_required`
        // is a genuine zero-due checkout (trial, 100% coupon).
        $paymentStatus = (string) ($session->payment_status ?? '');
        if (!in_array($paymentStatus, ['paid', 'no_payment_required'], true)) {
            Log::warning('Stripe checkout.session.completed not paid — plan not activated', [
                'session_id' => $session->id ?? null,
                'tenant_id' => $tenantId,
                'payment_status' => $paymentStatus,
            ]);
            return;
        }

        // F-289: metadata says which community to credit, but metadata is
        // whatever the creator of the Stripe object wrote. Resolve the
        // community from OUR row keyed on the Stripe customer that paid (a
        // Stripe-issued id we stored when createCheckoutSession made it), as
        // MarketplacePaymentService does for payment intents, and refuse the
        // event when the two disagree.
        $customerId = is_string($session->customer ?? null)
            ? $session->customer
            : (string) ($session->customer->id ?? '');
        $owners = $customerId !== ''
            ? DB::select('SELECT id FROM tenants WHERE stripe_customer_id = ? LIMIT 2', [$customerId])
            : [];
        if (count($owners) !== 1 || (int) $owners[0]->id !== $tenantId) {
            Log::warning('Stripe checkout.session.completed not owned by the community its metadata names — plan not activated', [
                'session_id' => $session->id ?? null,
                'metadata_tenant_id' => $tenantId,
                'customer_id' => $customerId !== '' ? $customerId : null,
                'owner_tenant_ids' => array_map(static fn ($row): int => (int) $row->id, $owners),
            ]);
            return;
        }
        if (DB::selectOne('SELECT id FROM pay_plans WHERE id = ?', [$planId]) === null) {
            Log::warning('Stripe checkout.session.completed names a plan that does not exist — plan not activated', [
                'session_id' => $session->id ?? null,
                'tenant_id' => $tenantId,
                'plan_id' => $planId,
            ]);
            return;
        }

        // A subscription this checkout replaced while Stripe still had it open
        // (set inside the transaction, reported after it).
        $replacedSubscriptionId = null;

        try {
            $activated = DB::transaction(function () use ($tenantId, $planId, $subscriptionId, $billingInterval, &$replacedSubscriptionId): bool {
                // 🔴 ONE record is written, never `WHERE tenant_id = ?`. A
                // community keeps more than one plan record by design (a new
                // one is added whenever none is active), and
                // `stripe_subscription_id` is unique: writing the new id to
                // every record failed on the second one, rolled the whole
                // handler back, and failed again on each of Stripe's retries.
                // The money was taken and the plan was never switched on.
                $holder = is_string($subscriptionId) && $subscriptionId !== ''
                    ? DB::selectOne(
                        "SELECT id, tenant_id, status, stripe_subscription_id, stripe_status
                         FROM tenant_plan_assignments WHERE stripe_subscription_id = ? FOR UPDATE",
                        [$subscriptionId]
                    )
                    : null;

                // F-178: a late (redelivered or out-of-order) checkout event for a
                // subscription that has since been cancelled must not revive it,
                // whichever of the community's records holds it.
                if ($holder && ($holder->status ?? null) === 'cancelled') {
                    return false;
                }

                // A redelivery goes to the record that already carries this
                // subscription; anything else to the record in force.
                $existing = $holder && (int) $holder->tenant_id === $tenantId
                    ? $holder
                    : self::recordInForce($tenantId);

                if ($existing) {
                    $previous = (string) ($existing->stripe_subscription_id ?? '');
                    if ($previous !== '' && $previous !== $subscriptionId
                        && ($existing->status ?? null) !== 'cancelled'
                        && !in_array($existing->stripe_status ?? null, TenantBillingService::STRIPE_SUBSCRIPTION_ENDED, true)
                        && (($existing->stripe_status ?? null) !== null || in_array($existing->status ?? null, ['active', 'trial'], true))) {
                        $replacedSubscriptionId = $previous;
                    }

                    // A different subscription is a new lifecycle: what Stripe
                    // said about the old one no longer dates this record. Set
                    // BEFORE the id changes (MySQL assigns left to right), and
                    // left alone on a redelivery of the same checkout.
                    DB::update(
                        "UPDATE tenant_plan_assignments
                         SET stripe_event_at = IF(stripe_subscription_id <=> ?, stripe_event_at, NULL),
                             pay_plan_id = ?, status = 'active', stripe_subscription_id = ?,
                             stripe_status = 'active', billing_interval = ?,
                             starts_at = NOW(), expires_at = NULL, updated_at = NOW()
                         WHERE id = ? AND tenant_id = ?",
                        [$subscriptionId, $planId, $subscriptionId, $billingInterval, $existing->id, $tenantId]
                    );
                } else {
                    DB::insert(
                        "INSERT INTO tenant_plan_assignments
                         (tenant_id, pay_plan_id, status, stripe_subscription_id, stripe_status, billing_interval, starts_at, created_at, updated_at)
                         VALUES (?, ?, 'active', ?, 'active', ?, NOW(), NOW(), NOW())",
                        [$tenantId, $planId, $subscriptionId, $billingInterval]
                    );
                }

                return true;
            });

            if (!$activated) {
                Log::warning('Stripe checkout.session.completed for a cancelled subscription — ignored', [
                    'tenant_id' => $tenantId,
                    'subscription_id' => $subscriptionId,
                ]);
                return;
            }

            Log::info('Stripe checkout completed — subscription activated', [
                'tenant_id' => $tenantId,
                'plan_id' => $planId,
                'subscription_id' => $subscriptionId,
            ]);

            // The setup fee this checkout carried has been taken: it is never
            // added again, whatever becomes of this subscription.
            if ((float) ($session->metadata->nexus_setup_fee ?? 0) > 0) {
                BillingStandingService::recordSetupFeePaid($tenantId);
            }

            if ($replacedSubscriptionId !== null) {
                // createCheckoutSession() refuses a checkout while a card
                // subscription is open, so this is two checkouts started
                // before either was paid. Both are now charging in Stripe and
                // only the newer one is on the record: a person has to cancel
                // the older one there. Logged at `error` so it is seen.
                Log::error('A community now holds TWO card subscriptions in Stripe — cancel the older one by hand', [
                    'tenant_id' => $tenantId,
                    'older_subscription_id' => $replacedSubscriptionId,
                    'newer_subscription_id' => $subscriptionId,
                ]);
            }
        } catch (\Exception $e) {
            Log::error('Failed to handle checkout.session.completed', [
                'tenant_id' => $tenantId,
                'plan_id' => $planId,
                'error' => $e->getMessage(),
            ]);
            throw $e;
        }

        // Stripe does not promise to deliver the first invoice.paid after this
        // event, and invoice.paid for a subscription with no assignment yet is
        // dropped. So the paid-until date is set here too, from the period the
        // checkout just paid for.
        if (is_string($subscriptionId) && $subscriptionId !== '') {
            static::recordPaidUntil(
                $tenantId,
                static::fetchPeriodEnd($subscriptionId, $tenantId),
                'Stripe checkout completed'
            );
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
     *
     * `$eventCreatedAt` is when Stripe created the event (its `created`
     * timestamp). Stripe redelivers an event whose handler failed, sometimes
     * hours later, and promises no order. An event older than the newest one
     * already applied to the record is ignored: a redelivered "payment
     * failed" used to be written over the "paid" that arrived in between.
     * Null (a caller that does not know) applies the event as before.
     */
    public static function handleSubscriptionUpdated(object $subscription, ?int $eventCreatedAt = null): void
    {
        $stripeSubId = $subscription->id ?? null;
        if (!$stripeSubId) {
            return;
        }

        $assignment = DB::selectOne(
            "SELECT id, tenant_id, pay_plan_id, status, stripe_event_at FROM tenant_plan_assignments WHERE stripe_subscription_id = ?",
            [$stripeSubId]
        );

        if (!$assignment) {
            Log::info('Stripe subscription.updated — no matching assignment', ['subscription_id' => $stripeSubId]);
            return;
        }

        $appliedAt = isset($assignment->stripe_event_at) ? strtotime((string) $assignment->stripe_event_at) : false;
        if ($eventCreatedAt !== null && $appliedAt !== false && $eventCreatedAt < $appliedAt) {
            Log::info('Stripe subscription.updated older than the one already applied — ignored', [
                'subscription_id' => $stripeSubId,
                'event_created_at' => date('Y-m-d H:i:s', $eventCreatedAt),
                'applied_event_at' => (string) $assignment->stripe_event_at,
            ]);
            return;
        }

        // F-178: a Stripe subscription id has one lifecycle — once it has been
        // cancelled here, a late or redelivered update must not revive it.
        if (($assignment->status ?? null) === 'cancelled') {
            Log::info('Stripe subscription.updated for a cancelled assignment — ignored', ['subscription_id' => $stripeSubId]);
            return;
        }

        // Map Stripe status to our status. F-178: `incomplete` (first payment
        // never succeeded) and `past_due` (renewal failed) are NOT active; the
        // assignment enum has no dedicated value, so they record as `expired`
        // and return to `active` on the next update once Stripe collects. An
        // unknown future status fails safe to `expired` as well.
        $stripeStatus = $subscription->status ?? 'active';
        $statusMap = [
            'active' => 'active',
            'past_due' => 'expired',
            'canceled' => 'cancelled',
            'trialing' => 'trial',
            'unpaid' => 'expired',
            'incomplete' => 'expired',
            'incomplete_expired' => 'expired',
            'paused' => 'expired',
        ];
        $nexusStatus = $statusMap[$stripeStatus] ?? 'expired';

        // Stripe API versions from 2025-03-31 moved the period end from the
        // subscription onto each of its items. Both are read. When neither is
        // there the stored date is KEPT (it used to be overwritten with NULL,
        // which switched the renewal reminders off).
        $stripeItems = $subscription->items->data ?? [];
        $firstItem = is_array($stripeItems) ? ($stripeItems[0] ?? null) : null;
        $periodEndTs = $subscription->current_period_end ?? ($firstItem->current_period_end ?? null);
        $periodEnd = is_numeric($periodEndTs) ? date('Y-m-d H:i:s', (int) $periodEndTs) : null;

        // Monthly or yearly, from the price Stripe says the subscription is on.
        $billingInterval = match ($firstItem->price->recurring->interval ?? null) {
            'month' => 'monthly',
            'year' => 'yearly',
            default => null,
        };

        // F-178: derive the plan from the subscription's price. A plan change
        // made in the Stripe billing portal arrives only as a new price id; it
        // never reached pay_plan_id, so the platform kept the old plan.
        $oldPlanId = (int) ($assignment->pay_plan_id ?? 0);
        $newPlanId = $oldPlanId;
        $newPriceId = !empty($stripeItems) ? ($stripeItems[0]->price->id ?? null) : null;
        if ($newPriceId) {
            $pricedPlanId = self::planIdForStripePrice((string) $newPriceId);
            if ($pricedPlanId !== null) {
                $newPlanId = $pricedPlanId;
            } else {
                Log::warning('Stripe subscription.updated — price matches no plan; plan left unchanged', [
                    'subscription_id' => $stripeSubId,
                    'price_id' => $newPriceId,
                ]);
            }
        }

        try {
            DB::update(
                "UPDATE tenant_plan_assignments
                 SET status = ?, stripe_status = ?,
                     stripe_current_period_end = COALESCE(?, stripe_current_period_end),
                     billing_interval = COALESCE(?, billing_interval),
                     stripe_event_at = COALESCE(?, stripe_event_at),
                     pay_plan_id = ?, updated_at = NOW()
                 WHERE id = ?",
                // stripe_status is Stripe's own word: the daily billing check
                // reads it to tell "still retrying the card" (past_due) from
                // "given up" (unpaid), which `status` folds into one value.
                [
                    $nexusStatus,
                    substr((string) $stripeStatus, 0, 30),
                    $periodEnd,
                    $billingInterval,
                    $eventCreatedAt !== null ? date('Y-m-d H:i:s', $eventCreatedAt) : null,
                    $newPlanId,
                    $assignment->id,
                ]
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

        // Notify the tenant admin of a plan change (derived from the price id above)
        $tenantId = (int) $assignment->tenant_id;
        if ($newPlanId !== $oldPlanId) {
            $newPlan = DB::selectOne("SELECT name FROM pay_plans WHERE id = ?", [$newPlanId]);
            $oldPlan = DB::selectOne("SELECT name FROM pay_plans WHERE id = ?", [$oldPlanId]);
            $newPlanName = $newPlan->name ?? 'Updated Plan';
            $oldPlanName = $oldPlan->name ?? 'Previous Plan';

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
                 SET status = 'cancelled', stripe_status = 'canceled', expires_at = NOW(), updated_at = NOW()
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
     * The subscription an invoice belongs to, or null for a one-off invoice.
     *
     * Stripe API versions before 2025-03-31 put it at `invoice.subscription`;
     * from that version it is at
     * `invoice.parent.subscription_details.subscription`. Both are read: with
     * only the old position, a webhook endpoint on a newer version would have
     * every renewal and every failed payment ignored, so paid-until dates would
     * stop moving after the first checkout. Either may be the id or the
     * expanded subscription object.
     */
    private static function subscriptionIdOfInvoice(object $invoice): ?string
    {
        foreach ([
            $invoice->subscription ?? null,
            $invoice->parent->subscription_details->subscription ?? null,
        ] as $candidate) {
            if (is_string($candidate) && $candidate !== '') {
                return $candidate;
            }
            if (is_object($candidate) && is_string($candidate->id ?? null) && $candidate->id !== '') {
                return $candidate->id;
            }
        }

        return null;
    }

    /** `monthly` or `yearly`, or null for anything else. */
    private static function knownInterval(mixed $value): ?string
    {
        return in_array($value, ['monthly', 'yearly'], true) ? $value : null;
    }

    /**
     * Handle invoice.paid — update current_period_end.
     */
    public static function handleInvoicePaid(object $invoice): void
    {
        $stripeSubId = self::subscriptionIdOfInvoice($invoice);
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
        $periodEndTs = null;
        try {
            $client = StripeService::client();
            $sub = $client->subscriptions->retrieve($stripeSubId);
            $periodEndTs = static::periodEndOf($sub, (string) $stripeSubId, (int) $assignment->tenant_id);
            $periodEnd = $periodEndTs !== null
                ? date('Y-m-d H:i:s', $periodEndTs)
                : null;

            // What Stripe says about the subscription now that this invoice
            // is paid (normally `active`), so the daily billing check stops
            // treating the card as still being retried.
            $stripeStatusNow = is_string($sub->status ?? null) && $sub->status !== ''
                ? substr($sub->status, 0, 30)
                : 'active';

            DB::update(
                "UPDATE tenant_plan_assignments
                 SET stripe_current_period_end = ?, stripe_status = ?, updated_at = NOW()
                 WHERE id = ?",
                [$periodEnd, $stripeStatusNow, $assignment->id]
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

        // A card payer is kept on the same payment record as everyone else:
        // paying moves its paid-until date to the end of the period just paid.
        $paidUntilBefore = static::paidUntilOnRecord((int) $assignment->tenant_id);
        static::recordPaidUntil((int) $assignment->tenant_id, $periodEndTs, 'Stripe invoice paid');

        // And the payment itself goes in the payments list, once per invoice.
        static::recordCardPayment((int) $assignment->tenant_id, $invoice, $paidUntilBefore);

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
     * Move a community's paid-until date forward to the end of a period
     * Stripe says is paid.
     *
     * Forward only. A later date already on the record (one the platform team
     * set by hand, say, for an agreed extension) is kept: pulling it back to
     * Stripe's shorter period could get a paying community paused by mistake.
     *
     * A null period end returns without writing; whoever read the period has
     * already logged why there is none.
     *
     * A refusal is logged at `error` and NOT rethrown. The webhook's own work
     * (the assignment, the email) has already happened, and a Stripe retry
     * cannot fix a record the platform refuses (the platform's own community,
     * say): rethrowing would only make Stripe redeliver the event for days.
     * The next paid invoice writes the date again.
     */
    private static function recordPaidUntil(int $tenantId, ?int $periodEndTs, string $note): void
    {
        if ($periodEndTs === null) {
            return;
        }

        $date = date('Y-m-d', $periodEndTs);

        try {
            $current = BillingStandingService::get($tenantId)['paid_until'];
            if ($current !== null && $current > $date) {
                Log::info('Stripe period end is earlier than the community\'s paid-until date; the later date is kept', [
                    'tenant_id' => $tenantId,
                    'paid_until' => $current,
                    'stripe_period_end' => $date,
                ]);

                return;
            }

            BillingStandingService::setPaidUntil($tenantId, $date, null, $note);
        } catch (\Throwable $e) {
            Log::error('Stripe payment could not update the community payment record', [
                'tenant_id' => $tenantId,
                'paid_until' => $date,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /** The paid-until date on a community's record, or null (none, or unreadable). */
    private static function paidUntilOnRecord(int $tenantId): ?string
    {
        try {
            return BillingStandingService::get($tenantId)['paid_until'];
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * Write a paid Stripe invoice to the payments list
     * (BillingStandingService::recordCardPayment(): once per invoice, and
     * nothing for an invoice on which nothing was paid).
     *
     * The payment intent and charge are kept with it so a later refund or
     * dispute, which Stripe reports against the charge, can be matched to
     * this payment. Older Stripe API versions put both on the invoice; newer
     * ones (from 2025-03-31) list them under `payments`. An event that names
     * neither is asked of Stripe once.
     *
     * A failure is logged at `error` and NOT rethrown, for the reason
     * recordPaidUntil() gives: the handler's own work is done, and a retry
     * re-runs all of it.
     */
    private static function recordCardPayment(int $tenantId, object $invoice, ?string $paidUntilBefore): void
    {
        $invoiceId = is_string($invoice->id ?? null) ? trim($invoice->id) : '';
        $amountPaid = $invoice->amount_paid ?? null;
        if ($invoiceId === '' || !is_numeric($amountPaid) || (int) $amountPaid <= 0) {
            return;
        }

        try {
            if (DB::table('billing_payments')->where('stripe_invoice_id', $invoiceId)->exists()) {
                return;
            }

            [$paymentIntentId, $chargeId] = self::paymentOfInvoice($invoice);
            if ($paymentIntentId === null && $chargeId === null) {
                try {
                    [$paymentIntentId, $chargeId] = self::paymentOfInvoice(StripeService::client()->invoices->retrieve($invoiceId));
                } catch (\Throwable $e) {
                    Log::warning('Stripe could not say which payment an invoice was taken on; a later refund will not be matched to it', [
                        'tenant_id' => $tenantId,
                        'invoice_id' => $invoiceId,
                        'error' => $e->getMessage(),
                    ]);
                }
            }

            BillingStandingService::recordCardPayment($tenantId, [
                'stripe_invoice_id' => $invoiceId,
                'amount_paid' => (int) $amountPaid,
                'currency' => is_string($invoice->currency ?? null) ? $invoice->currency : '',
                'paid_at' => $invoice->status_transitions->paid_at ?? null,
                'stripe_payment_intent_id' => $paymentIntentId,
                'stripe_charge_id' => $chargeId,
                'paid_until_before' => $paidUntilBefore,
                'paid_until_after' => self::paidUntilOnRecord($tenantId),
            ]);
        } catch (\Throwable $e) {
            Log::error('Stripe card payment could not be added to the payments list', [
                'tenant_id' => $tenantId,
                'invoice_id' => $invoiceId,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * The payment intent and the charge an invoice was paid on, each an id or
     * null.
     *
     * @return array{0: ?string, 1: ?string}
     */
    private static function paymentOfInvoice(object $invoice): array
    {
        $idOf = static function (mixed $value): ?string {
            if (is_object($value)) {
                $value = $value->id ?? null;
            }

            return is_string($value) && $value !== '' ? $value : null;
        };

        $paymentIntentId = $idOf($invoice->payment_intent ?? null);
        $chargeId = $idOf($invoice->charge ?? null);

        $payments = $invoice->payments->data ?? null;
        if (is_iterable($payments)) {
            foreach ($payments as $entry) {
                $payment = is_object($entry) ? ($entry->payment ?? null) : null;
                if (!is_object($payment)) {
                    continue;
                }
                $paymentIntentId ??= $idOf($payment->payment_intent ?? null);
                $chargeId ??= $idOf($payment->charge ?? null);
            }
        }

        return [$paymentIntentId, $chargeId];
    }

    /**
     * The end of a subscription's current period, asked of Stripe. Null, with
     * an error logged, when Stripe cannot say: the caller carries on without it.
     */
    private static function fetchPeriodEnd(string $stripeSubId, int $tenantId): ?int
    {
        try {
            $sub = StripeService::client()->subscriptions->retrieve($stripeSubId);
        } catch (\Throwable $e) {
            Log::error('Stripe subscription period could not be read for the community payment record', [
                'tenant_id' => $tenantId,
                'subscription_id' => $stripeSubId,
                'error' => $e->getMessage(),
            ]);

            return null;
        }

        return static::periodEndOf($sub, $stripeSubId, $tenantId);
    }

    /**
     * The end of the period a Stripe subscription has paid for.
     *
     * Older Stripe API versions put `current_period_end` on the subscription;
     * newer ones (from 2025-03-31 "basil") move it onto each subscription
     * item. Both are read, the subscription first. When neither is there the
     * paid-until date cannot be moved, which left alone would surface weeks
     * later as a paying community paused for non-payment, so it is logged at
     * `error` rather than skipped quietly.
     */
    private static function periodEndOf(object $sub, string $stripeSubId, int $tenantId): ?int
    {
        if (isset($sub->current_period_end) && is_numeric($sub->current_period_end)) {
            return (int) $sub->current_period_end;
        }

        $items = $sub->items->data ?? null;
        $firstItem = is_array($items) ? ($items[0] ?? null) : null;
        if (is_object($firstItem) && isset($firstItem->current_period_end) && is_numeric($firstItem->current_period_end)) {
            return (int) $firstItem->current_period_end;
        }

        Log::error('Stripe reported no period end for the subscription; the community payment record was not updated', [
            'tenant_id' => $tenantId,
            'subscription_id' => $stripeSubId,
        ]);

        return null;
    }

    /**
     * Handle charge.refunded for a community's card payment.
     *
     * The matching payment in the payments list is marked with the amount
     * Stripe says has been refunded (in total), and the platform team is
     * emailed. Nothing is paused and no paid-until date moves: what a refund
     * means for the community is a person's decision.
     *
     * A charge that is not a community's plan payment (a donation, a
     * marketplace order) matches nothing and is left to its own handler.
     *
     * The email goes BEFORE the record is marked. If the mailer refuses it,
     * this throws, the webhook answers 500 and Stripe sends the event again;
     * marked first, the retry would find nothing new and tell nobody.
     */
    public static function handleChargeRefunded(object $charge): void
    {
        $chargeId = is_string($charge->id ?? null) ? $charge->id : null;
        $payment = BillingStandingService::cardPaymentFor([
            'charge' => $chargeId,
            'payment_intent' => self::idOf($charge->payment_intent ?? null),
            'invoice' => self::idOf($charge->invoice ?? null),
        ]);
        if ($payment === null) {
            return;
        }

        $refundedCents = is_numeric($charge->amount_refunded ?? null) ? (int) $charge->amount_refunded : 0;
        if ($refundedCents <= 0) {
            return;
        }

        $refunded = number_format($refundedCents / 100, 2, '.', '');
        $already = $payment->refunded_amount !== null ? number_format((float) $payment->refunded_amount, 2, '.', '') : null;
        if ($already === $refunded) {
            return;
        }

        static::requireTold(
            BillingStandingNotifier::cardPaymentRefunded((int) $payment->tenant_id, [
                'amount' => (float) $payment->amount,
                'refunded' => (float) $refunded,
                'currency' => (string) $payment->currency,
                'invoice' => (string) $payment->stripe_invoice_id,
            ]),
            'a refund on a card payment',
            (int) $payment->tenant_id,
            (int) $payment->id
        );

        BillingStandingService::recordCardRefund((int) $payment->id, $refundedCents, $chargeId);
    }

    /**
     * Handle charge.dispute.created / .updated / .closed for a community's
     * card payment: the matching payment is marked with Stripe's word for the
     * dispute, and the platform team is emailed when that word changes.
     * Nothing is paused. Told before marked, as for a refund.
     */
    public static function handleChargeDispute(object $dispute): void
    {
        $chargeId = self::idOf($dispute->charge ?? null);
        $payment = BillingStandingService::cardPaymentFor([
            'charge' => $chargeId,
            'payment_intent' => self::idOf($dispute->payment_intent ?? null),
        ]);
        if ($payment === null) {
            return;
        }

        $status = BillingStandingService::cleanDisputeStatus($dispute->status ?? null);
        if ($payment->dispute_status === $status) {
            return;
        }

        // Stripe moves an open dispute between several words (needs a
        // response, under review). One email when it opens and one when it
        // ends is what a person needs; the record follows every word.
        $stateBefore = BillingStandingService::disputeState($payment->dispute_status !== null ? (string) $payment->dispute_status : null);
        $stateNow = BillingStandingService::disputeState($status);
        if ($stateBefore !== $stateNow) {
            static::requireTold(
                BillingStandingNotifier::cardPaymentDisputed((int) $payment->tenant_id, [
                    'amount' => (float) $payment->amount,
                    'currency' => (string) $payment->currency,
                    'invoice' => (string) $payment->stripe_invoice_id,
                    'state' => $stateNow,
                ]),
                'a dispute on a card payment',
                (int) $payment->tenant_id,
                (int) $payment->id
            );
        }

        BillingStandingService::recordCardDispute(
            (int) $payment->id,
            $status,
            is_numeric($dispute->created ?? null) ? (int) $dispute->created : null,
            $chargeId
        );
    }

    /** A Stripe reference as its id: the id itself, or the id of an expanded object. */
    private static function idOf(mixed $value): ?string
    {
        if (is_object($value)) {
            $value = $value->id ?? null;
        }

        return is_string($value) && $value !== '' ? $value : null;
    }

    /**
     * The platform team must have been told. Throws when a send was tried
     * and the mailer accepted none, so the webhook fails and Stripe sends the
     * event again. With nobody on the platform team who can be mailed there
     * is nobody to wait for: that is logged at `error` and the record is
     * marked all the same.
     *
     * @param array{tried:int, accepted:int} $counts
     */
    private static function requireTold(array $counts, string $what, int $tenantId, int $paymentId): void
    {
        if ($counts['tried'] === 0) {
            Log::error("Stripe reported {$what} and there is nobody on the platform team to tell", [
                'tenant_id' => $tenantId,
                'payment_id' => $paymentId,
            ]);

            return;
        }

        if ($counts['accepted'] === 0) {
            throw new \RuntimeException("The platform team could not be told about {$what} (payment {$paymentId}); Stripe will send the event again.");
        }
    }

    /**
     * Handle invoice.payment_failed — log warning.
     *
     * Leaves the community's paid-until date alone on purpose: the daily
     * payment check counts its days late from there, and Stripe's own retries
     * happen inside that window.
     */
    public static function handleInvoicePaymentFailed(object $invoice): void
    {
        $stripeSubId = self::subscriptionIdOfInvoice($invoice);

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
            // Every active admin of the community, the same people the pause
            // and plan notices go to (BillingStandingNotifier::admins()). It
            // used to be the first `role = 'admin'` row of ANY status, so a
            // community run by admins who hold the flag and not the role had
            // nobody, every billing webhook for it failed, and Stripe kept
            // redelivering.
            $admins = DB::table('users')
                ->where('tenant_id', $tenantId)
                ->where('status', 'active')
                ->whereNotNull('email')
                ->where('email', '<>', '')
                ->where(static function ($query): void {
                    $query->whereIn('role', ['admin', 'tenant_admin'])
                        ->orWhere('is_admin', 1)
                        ->orWhere('is_tenant_super_admin', 1)
                        ->orWhere('is_super_admin', 1);
                })
                ->orderBy('id')
                ->get(['email', 'first_name', 'name', 'preferred_language']);

            if ($admins->isEmpty()) {
                // Nobody to tell is not a failed send: there is nothing a
                // redelivery could do differently. Said loudly, once per event.
                Log::warning('[StripeSubscriptionService] community has no active admin to email about billing', ['tenant_id' => $tenantId]);

                return true;
            }

            $accepted = 0;
            foreach ($admins as $admin) {
                // Inside the loop: each admin reads it in their own language.
                $sent = (bool) LocaleContext::withLocale($admin, function () use ($admin, $subject, $title, $body, $link, $ctaText, $theme, $tenantId): bool {
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

                    return (bool) \App\Services\EmailDispatchService::sendRaw($admin->email, __($subject['key'], $subject['params'] ?? []), $html, null, null, null, 'billing', ['tenant_id' => $tenantId]);
                });

                if ($sent) {
                    $accepted++;
                } else {
                    Log::warning('[StripeSubscriptionService] tenant admin email failed', ['tenant_id' => $tenantId]);
                }
            }

            // Reaching one admin is enough: failing the whole event because a
            // second address bounced would redeliver it to the first as well.
            return $accepted > 0;
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
     * The community's plan record in force, as its own billing page reads it
     * (GET /v2/admin/billing/subscription; pinned key for key by
     * tests/Laravel/Feature/Billing/CommunityBillingPageContractTest.php).
     *
     * The record in force is the newest active one, else the newest on trial,
     * else the newest of any status: the same choice recordInForce() and
     * PlanTerms::forCommunity() make. It used to be "the most recently
     * created", which is a cancelled record whenever one is newer.
     *
     * Dates are ISO 8601 or null. `billing_interval` is `monthly`, `yearly`
     * or null (not known). `stripe_status` is Stripe's own word for the card
     * subscription, or null when there is none or Stripe has said nothing.
     *
     * @return array<string, mixed>|null null when the community has no plan record
     */
    public static function getSubscriptionDetails(int $tenantId): ?array
    {
        $row = DB::selectOne(
            "SELECT tpa.id, tpa.pay_plan_id, tpa.status, tpa.stripe_status, tpa.billing_interval,
                    tpa.starts_at, tpa.trial_ends_at,
                    tpa.stripe_subscription_id, tpa.stripe_current_period_end,
                    pp.name AS plan_name, pp.slug AS plan_slug,
                    pp.tier_level AS plan_tier_level, pp.description AS plan_description
             FROM tenant_plan_assignments tpa
             JOIN pay_plans pp ON pp.id = tpa.pay_plan_id
             WHERE tpa.tenant_id = ?
             ORDER BY (tpa.status = 'active') DESC, (tpa.status = 'trial') DESC, tpa.id DESC
             LIMIT 1",
            [$tenantId]
        );

        if (!$row) {
            return null;
        }

        $iso = static fn (mixed $value): ?string => $value !== null && $value !== ''
            ? date('c', (int) strtotime((string) $value))
            : null;

        return [
            'id' => (int) $row->id,
            'pay_plan_id' => (int) $row->pay_plan_id,
            'plan_name' => (string) $row->plan_name,
            'plan_slug' => (string) $row->plan_slug,
            'plan_tier_level' => (int) $row->plan_tier_level,
            'plan_description' => $row->plan_description !== null ? (string) $row->plan_description : null,
            'status' => (string) $row->status,
            'stripe_status' => $row->stripe_status !== null ? (string) $row->stripe_status : null,
            'billing_interval' => self::knownInterval($row->billing_interval),
            'starts_at' => $iso($row->starts_at),
            'current_period_end' => $iso($row->stripe_current_period_end),
            'trial_ends_at' => $iso($row->trial_ends_at),
            'stripe_subscription_id' => $row->stripe_subscription_id !== null && $row->stripe_subscription_id !== ''
                ? (string) $row->stripe_subscription_id
                : null,
        ];
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

            // The shape the Invoices page reads (type `Invoice` in
            // react-frontend/src/admin/api/billingApi.ts), pinned by
            // CommunityBillingPageContractTest. It used to send `amount_paid`
            // in cents and `created`, while the page read `amount`, `date`
            // and `number`: every row showed no date and "NaN".
            $result = [];
            foreach ($invoices->data as $invoice) {
                $currency = strtoupper((string) ($invoice->currency ?? 'EUR'));
                // What the invoice is for in all: `total`, and what was paid
                // when Stripe sends no total. Stripe counts in the smallest
                // unit; euro and pounds both have two decimals.
                $minor = $invoice->total ?? $invoice->amount_paid ?? 0;

                $result[] = [
                    'id' => (string) $invoice->id,
                    'number' => isset($invoice->number) && $invoice->number !== '' ? (string) $invoice->number : null,
                    'date' => isset($invoice->created) ? date('c', (int) $invoice->created) : null,
                    'amount' => round(((int) $minor) / 100, 2),
                    'currency' => $currency !== '' ? $currency : 'EUR',
                    'status' => (string) ($invoice->status ?? ''),
                    'hosted_invoice_url' => $invoice->hosted_invoice_url ?? null,
                    'invoice_pdf' => $invoice->invoice_pdf ?? null,
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
