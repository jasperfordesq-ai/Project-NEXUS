<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Services\BillingAutomationService;
use App\Services\BillingStandingService;
use App\Services\StripeSubscriptionService;
use App\Support\Billing\BillingLock;
use App\Support\Billing\PlanTerms;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * AdminBillingController — Tenant billing: subscription status,
 * Stripe Checkout, Billing Portal, and invoice history.
 */
class AdminBillingController extends BaseApiController
{
    protected bool $isV2Api = true;

    /**
     * GET /v2/admin/billing/subscription
     *
     * Returns the current tenant's subscription details.
     */
    public function getSubscription(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $subscription = StripeSubscriptionService::getSubscriptionDetails($tenantId);

        return $this->respondWithData($subscription);
    }

    /**
     * GET /v2/admin/billing/standing
     *
     * Tells a community's own admins whether it is paused for non-payment,
     * since when, and who it pays. The public bootstrap carries only the
     * fact; this is the "why".
     *
     * Deliberately narrow: never the note written against the suspension, and
     * nothing about another community beyond the name of the direct parent a
     * community pays. When the lock comes from a community above, nobody is
     * named.
     *
     * Also, paused or not: `overdue_days` (payment late, null if not) and
     * `member_limit` (`{used, max, percent, stage}`, null without a standard
     * package with a limit), so an open community is warned before anything
     * happens to it.
     *
     * And `plan` (`{name, max_users, price_monthly, price_yearly, currency,
     * terms}`, null with no plan): the plan as it applies to this community.
     */
    public function getStanding(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = (int) TenantContext::getId();

        // Who this community itself pays. The admin panel offers the
        // community's own billing page only to a card payer: nobody else has
        // anything to do there (DESIGN §6.6).
        $payer = BillingStandingService::get($tenantId)['payer'];

        // The warnings before any pause (Stage 3c), measured the way the daily
        // check measures them, so the banner and the check's emails agree.
        $warnings = [
            'overdue_days' => BillingAutomationService::overdueDays($tenantId),
            'member_limit' => BillingAutomationService::memberLimitState($tenantId),
        ];

        // The plan as it applies to this community (its hub's version when it
        // pays its hub), in the currency it is billed in. Never the platform
        // team's custom price, discount or notes.
        $terms = PlanTerms::forCommunity($tenantId);
        $plan = $terms === null ? null : [
            'name' => $terms['name'],
            'max_users' => $terms['max_users'],
            'price_monthly' => $terms['price_monthly'],
            'price_yearly' => $terms['price_yearly'],
            'currency' => $terms['currency'],
            'terms' => $terms['terms'],
        ];

        $reason = BillingLock::reasonFor($tenantId);
        if ($reason === null) {
            return $this->respondWithData([
                'paused' => false,
                'own' => null,
                'since' => null,
                'payee' => null,
                'payee_name' => null,
                'payer' => $payer,
            ] + $warnings + ['plan' => $plan]);
        }

        $payee = null;
        $payeeName = null;

        if ($reason['own']) {
            $payee = $payer === 'parent' ? 'parent' : 'platform';

            if ($payee === 'parent') {
                $parentId = DB::table('tenants')->where('id', $tenantId)->value('parent_id');
                $payeeName = $parentId !== null
                    ? DB::table('tenants')->where('id', (int) $parentId)->value('name')
                    : null;
            }
        }

        return $this->respondWithData([
            'paused' => true,
            'own' => $reason['own'],
            'since' => $reason['suspended_at'],
            'payee' => $payee,
            'payee_name' => $payeeName,
            'payer' => $payer,
        ] + $warnings + ['plan' => $plan]);
    }

    /**
     * POST /v2/admin/billing/checkout
     *
     * Creates a Stripe Checkout Session for the tenant.
     * Accepts: { plan_id: int, billing_interval: 'monthly'|'yearly' }
     */
    public function createCheckoutSession(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        // A community that pays its parent pays its hub, not the platform by
        // card. Refused before anything else: otherwise its admin could put it
        // on any default plan, including one its hub has hidden.
        if (BillingStandingService::get((int) $tenantId)['payer'] === 'parent') {
            return $this->respondWithError('PAYS_PARENT', __('api.billing_checkout_pays_parent'), null, 422);
        }

        $planId = (int) $this->requireInput('plan_id');
        $billingInterval = $this->requireInput('billing_interval');

        if (!in_array($billingInterval, ['monthly', 'yearly'], true)) {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                __('api.billing_interval_invalid', [
                    'monthly' => 'monthly',
                    'yearly' => 'yearly',
                ]),
                'billing_interval',
                422
            );
        }

        if ($planId < 1) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_plan_id'), 'plan_id', 422);
        }

        // Block downgrade to free plan or lower tier while on an active paid subscription
        $targetPlan = DB::selectOne("SELECT id, price_monthly, price_yearly, price_monthly_gbp, price_yearly_gbp, tier_level, is_active FROM pay_plans WHERE id = ?", [$planId]);
        // F-178: a withdrawn plan is not purchasable — a zero-price one would
        // otherwise activate directly, without Stripe.
        if (!$targetPlan || !(int) ($targetPlan->is_active ?? 0)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_plan_id'), 'plan_id', 422);
        }
        $isFreeTarget = ((float) $targetPlan->price_monthly === 0.0 && (float) $targetPlan->price_yearly === 0.0);

        // A plan priced for one period only is not sold for the other. Said
        // plainly here, instead of the generic "checkout failed" that the
        // price sync's exception used to end in. The amount checked is the
        // one Stripe would be asked to charge: the pound price for a pound
        // community when it has one for this period, else the euro price
        // (StripeSubscriptionService::chargeCurrency()).
        if (!$isFreeTarget && $this->chargedAmountFor($targetPlan, (int) $tenantId, $billingInterval) <= 0.0) {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                __($billingInterval === 'monthly' ? 'api.billing_plan_not_sold_monthly' : 'api.billing_plan_not_sold_yearly'),
                'billing_interval',
                422
            );
        }

        if ($isFreeTarget) {
            $currentSub = DB::selectOne(
                "SELECT tpa.id, pp.tier_level
                 FROM tenant_plan_assignments tpa
                 JOIN pay_plans pp ON pp.id = tpa.pay_plan_id
                 WHERE tpa.tenant_id = ? AND tpa.status IN ('active','trialing','trial')
                 LIMIT 1",
                [$tenantId]
            );
            if ($currentSub && (int) $currentSub->tier_level > 0) {
                return $this->respondWithError(
                    'DOWNGRADE_NOT_ALLOWED',
                    __('api.billing_free_downgrade_support_required'),
                    'plan_id',
                    422
                );
            }
        }

        try {
            $result = StripeSubscriptionService::createCheckoutSession($tenantId, $planId, $billingInterval);
            return $this->respondWithData($result);
        } catch (\Exception $e) {
            Log::error('AdminBillingController::createCheckoutSession failed', [
                'tenant_id' => $tenantId,
                'plan_id' => $planId,
                'error' => $e->getMessage(),
            ]);
            return $this->respondWithError(
                'STRIPE_ERROR',
                __('api.billing_checkout_session_failed'),
                null,
                500
            );
        }
    }

    /**
     * What card checkout would charge for this plan and period: the pound
     * amount for a community billed in pounds when the plan has one for the
     * period, otherwise the euro amount. The same choice as
     * StripeSubscriptionService::chargeCurrency().
     */
    private function chargedAmountFor(object $plan, int $tenantId, string $interval): float
    {
        $columns = StripeSubscriptionService::PRICE_COLUMNS;
        $period = $interval === 'yearly' ? 'yearly' : 'monthly';

        if (StripeSubscriptionService::billingCurrencyFor($tenantId) === 'gbp') {
            $pounds = (float) ($plan->{$columns['gbp'][$period]['amount']} ?? 0);
            if ($pounds > 0) {
                return $pounds;
            }
        }

        return (float) ($plan->{$columns['eur'][$period]['amount']} ?? 0);
    }

    /**
     * POST /v2/admin/billing/portal
     *
     * Creates a Stripe Billing Portal Session for the tenant.
     */
    public function createPortalSession(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        // Check if tenant has a Stripe customer before attempting portal
        $tenant = DB::selectOne("SELECT stripe_customer_id FROM tenants WHERE id = ?", [$tenantId]);
        if (!$tenant || empty($tenant->stripe_customer_id)) {
            return $this->respondWithError(
                'NO_SUBSCRIPTION',
                __('api.billing_subscription_required_for_portal'),
                null,
                400
            );
        }

        try {
            $result = StripeSubscriptionService::createPortalSession($tenantId);
            return $this->respondWithData($result);
        } catch (\Exception $e) {
            Log::error('AdminBillingController::createPortalSession failed', [
                'tenant_id' => $tenantId,
                'error' => $e->getMessage(),
            ]);
            return $this->respondWithError(
                'STRIPE_ERROR',
                __('api.billing_portal_session_failed'),
                null,
                500
            );
        }
    }

    /**
     * GET /v2/admin/billing/invoices
     *
     * Returns the tenant's Stripe invoice history.
     */
    public function getInvoices(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $invoices = StripeSubscriptionService::getInvoiceHistory($tenantId);

        return $this->respondWithData($invoices);
    }

    /**
     * GET /v2/billing/plans (public, no auth)
     *
     * Returns all active plans with prices for the pricing page.
     */
    public function getPlansPublic(): JsonResponse
    {
        $plans = array_map(fn($r) => (array) $r, DB::select(
            "SELECT id, name, slug, description, tier_level, features,
                    price_monthly, price_yearly, is_active
             FROM pay_plans
             WHERE is_active = 1
             ORDER BY tier_level ASC, name ASC"
        ));

        // Deduplicate by tier_level — keep lowest id per tier to avoid showing multiple free/same-tier plans
        $seenTiers = [];
        $plans = array_values(array_filter($plans, function (array $plan) use (&$seenTiers): bool {
            $tier = $plan['tier_level'];
            if (in_array($tier, $seenTiers, true)) {
                return false;
            }
            $seenTiers[] = $tier;
            return true;
        }));

        foreach ($plans as &$plan) {
            if (isset($plan['features'])) {
                $decoded = json_decode($plan['features'], true) ?: [];
                // Features may be stored as {"listings": true, "groups": true} (object)
                // or as ["listings", "groups"] (array). Normalize to string[] for frontend.
                if (is_array($decoded) && !array_is_list($decoded)) {
                    // Object format — extract keys where value is truthy
                    $plan['features'] = array_keys(array_filter($decoded));
                } else {
                    $plan['features'] = array_values($decoded);
                }
            }
        }
        unset($plan);

        return $this->respondWithData($plans);
    }

    /**
     * POST /v2/admin/billing/upgrade-request
     *
     * Tenant admin submits an upgrade request to God.
     * Logs to billing_audit_log and sends email to Jasper.
     * Body: { message?: string }
     */
    public function requestUpgrade(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $user     = $this->resolveUser();

        $message  = (string) $this->input('message', '');

        // Fetch tenant name
        $tenant = DB::table('tenants')->where('id', $tenantId)->value('name') ?? 'Unknown';

        // Log to billing_audit_log
        DB::table('billing_audit_log')->insert([
            'tenant_id'       => $tenantId,
            'acted_by_user_id' => $user->id ?? null,
            'action'          => 'upgrade_requested',
            'old_value'       => null,
            'new_value'       => json_encode(['message' => $message]),
            'notes'           => 'Self-service upgrade request from tenant admin',
            'created_at'      => now(),
            'updated_at'      => now(),
        ]);

        // Email the platform owner. Recipient is the platform owner address —
        // wrap in LocaleContext('en') so the strings always render in English
        // regardless of the API caller's locale.
        $emailSent = false;
        try {
            $emailSent = (bool) LocaleContext::withLocale('en', function () use ($tenant, $tenantId, $user, $message): bool {
                $body = __('emails.billing_upgrade_request.body', [
                    'tenant'    => $tenant,
                    'tenant_id' => $tenantId,
                    'email'     => $user->email ?? __('emails.billing_upgrade_request.unknown_email'),
                    'message'   => $message ?: __('emails.billing_upgrade_request.no_message'),
                ]);
                $subject = __('emails.billing_upgrade_request.subject', ['tenant' => $tenant]);

                // Route through the platform Mailer (Postmark via .env) instead
                // of Laravel's Mail facade — the default Mail mailer is SMTP
                // and MAIL_USERNAME/PASSWORD are intentionally not set in prod,
                // so Mail::raw silently failed for this notification.
                $sent = \App\Services\EmailDispatchService::sendRaw(
                    'jasper@hour-timebank.ie',
                    $subject,
                    nl2br(htmlspecialchars($body, ENT_QUOTES, 'UTF-8')),
                    null,
                    null,
                    null,
                    'billing',
                    ['tenant_id' => $tenantId]
                );

                if (!$sent) {
                    Log::warning('BillingController: upgrade request email send returned false', ['tenant_id' => $tenantId]);
                }

                return $sent;
            });
        } catch (\Throwable $e) {
            Log::warning('BillingController: upgrade request email failed', ['error' => $e->getMessage()]);
        }

        if (!$emailSent) {
            return $this->respondWithError(
                'EMAIL_SEND_FAILED',
                __('api.billing_upgrade_email_send_failed'),
                null,
                500
            );
        }

        return $this->respondWithData(['sent' => true]);
    }
}
