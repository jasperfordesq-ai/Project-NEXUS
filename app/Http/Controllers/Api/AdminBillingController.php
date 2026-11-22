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
use App\Services\TenantBillingService;
use App\Support\Billing\BillingLock;
use App\Support\Billing\PlanTerms;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;

/**
 * AdminBillingController — Tenant billing: subscription status,
 * Stripe Checkout, Billing Portal, and invoice history.
 */
class AdminBillingController extends BaseApiController
{
    protected bool $isV2Api = true;

    /** How many messages one community may send the platform team in an hour. */
    private const MESSAGES_PER_HOUR = 3;

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

        if (is_array($subscription)) {
            // Whether Stripe still has a card subscription open for this
            // community. The plan picker stops offering "Subscribe" on it:
            // a second checkout is refused (createCheckoutSession()).
            $subscription['has_card_subscription'] = TenantBillingService::hasLiveCardSubscription((int) $tenantId);
        }

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
     * And `plan` (`{name, description, max_users, price_monthly,
     * price_yearly, setup_fee, currency, terms}`, null with no plan): the plan
     * as it applies to this community, in the currency it is billed in.
     *
     * And `paid_until` (`YYYY-MM-DD` or null): the date the community is paid
     * up to, its own date, so its billing page can show it.
     */
    public function getStanding(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = (int) TenantContext::getId();

        // Who this community itself pays. The admin panel offers the
        // community's own billing page only to a card payer: nobody else has
        // anything to do there (DESIGN §6.6).
        $standing = BillingStandingService::get($tenantId);
        $payer = $standing['payer'];

        // The warnings before any pause (Stage 3c), measured the way the daily
        // check measures them, so the banner and the check's emails agree.
        $warnings = [
            'paid_until' => $standing['paid_until'],
            'overdue_days' => BillingAutomationService::overdueDays($tenantId),
            'member_limit' => BillingAutomationService::memberLimitState($tenantId),
        ];

        // The plan as it applies to this community (its hub's version when it
        // pays its hub), in the currency it is billed in. Never the platform
        // team's custom price, discount or notes.
        $terms = PlanTerms::forCommunity($tenantId);
        $plan = $terms === null ? null : [
            'name' => $terms['name'],
            'description' => $terms['description'],
            'max_users' => $terms['max_users'],
            'price_monthly' => $terms['price_monthly'],
            'price_yearly' => $terms['price_yearly'],
            'setup_fee' => $terms['setup_fee'],
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

        // A community that already has a card subscription open in Stripe
        // does not get a second one beside it: both would be charged. "Change
        // plan" used to do exactly that (found 21 November 2026).
        if (TenantBillingService::hasLiveCardSubscription((int) $tenantId)) {
            return $this->respondWithError('ALREADY_SUBSCRIBED', __('api.billing_checkout_already_subscribed'), null, 422);
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
        $targetPlan = DB::selectOne("SELECT id, price_monthly, price_yearly, price_monthly_gbp, price_yearly_gbp, tier_level, is_active, is_standard, max_users FROM pay_plans WHERE id = ?", [$planId]);
        // F-178: a withdrawn plan is not purchasable — a zero-price one would
        // otherwise activate directly, without Stripe.
        if (!$targetPlan || !(int) ($targetPlan->is_active ?? 0)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_plan_id'), 'plan_id', 422);
        }
        // Card checkout sells the standard plans only, the ones GET
        // /v2/billing/plans lists. Any other active plan is one the platform
        // team made for a particular community (a bespoke or no-charge plan):
        // until 21 November 2026 any community's admin could put their own
        // community on it by posting its id. Such a plan is given by the
        // platform team and paid by invoice.
        if (!(int) ($targetPlan->is_standard ?? 0)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_plan_id'), 'plan_id', 422);
        }
        // A plan is sold by how many active members it allows, so a community
        // cannot buy one it has already outgrown. Without this, a community
        // paused for not paying on a large plan could buy the smallest one by
        // card: the payment moved its paid-until date, which reopened it, on
        // a plan a fraction of its size.
        $planMembers = $targetPlan->max_users !== null ? (int) $targetPlan->max_users : null;
        if ($planMembers !== null && $planMembers > 0) {
            $activeMembers = TenantBillingService::getSubtreeActiveMemberCount((int) $tenantId);
            if ($activeMembers > $planMembers) {
                return $this->respondWithError(
                    'PLAN_TOO_SMALL',
                    __('api.billing_checkout_plan_too_small', ['members' => number_format($activeMembers), 'max' => number_format($planMembers)]),
                    'plan_id',
                    422
                );
            }
        }
        $isFreeTarget = StripeSubscriptionService::isFreePlan($targetPlan);

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

        // A community with a specially agreed price, a discount or the
        // non-profit reduction pays by invoice: card checkout charges the
        // plan's list price in Stripe, which is not what it agreed.
        if ($this->hasSpecialPrice((int) $tenantId)) {
            return $this->respondWithError('SPECIAL_PRICE', __('api.billing_checkout_special_price'), null, 422);
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
        } catch (\DomainException $e) {
            // The service's own refusal: a subscription was opened between
            // the check above and this call.
            if ($e->getMessage() === 'billing_already_subscribed') {
                return $this->respondWithError('ALREADY_SUBSCRIBED', __('api.billing_checkout_already_subscribed'), null, 422);
            }
            throw $e;
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
     * POST /v2/admin/billing/change-plan
     *
     * Change the plan (and, if asked, the period) of the community's EXISTING
     * card subscription. Body: { plan_id: int, billing_interval?: 'monthly'|'yearly' }.
     * The same refusals as checkout apply to the plan chosen; the change
     * itself is StripeSubscriptionService::changeSubscriptionPlan().
     */
    public function changePlan(): JsonResponse
    {
        $userId = $this->requireAdmin();
        $tenantId = (int) TenantContext::getId();

        if (BillingStandingService::get($tenantId)['payer'] === 'parent') {
            return $this->respondWithError('PAYS_PARENT', __('api.billing_checkout_pays_parent'), null, 422);
        }

        $planId = (int) $this->requireInput('plan_id');
        $billingInterval = $this->getAllInput()['billing_interval'] ?? null;
        if ($billingInterval !== null && !in_array($billingInterval, ['monthly', 'yearly'], true)) {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                __('api.billing_interval_invalid', ['monthly' => 'monthly', 'yearly' => 'yearly']),
                'billing_interval',
                422
            );
        }

        $plan = DB::selectOne("SELECT id, is_active, is_standard, max_users FROM pay_plans WHERE id = ?", [$planId]);
        if (!$plan || !(int) $plan->is_active || !(int) $plan->is_standard) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_plan_id'), 'plan_id', 422);
        }

        $planMembers = $plan->max_users !== null ? (int) $plan->max_users : null;
        if ($planMembers !== null && $planMembers > 0) {
            $activeMembers = TenantBillingService::getSubtreeActiveMemberCount($tenantId);
            if ($activeMembers > $planMembers) {
                return $this->respondWithError(
                    'PLAN_TOO_SMALL',
                    __('api.billing_checkout_plan_too_small', ['members' => number_format($activeMembers), 'max' => number_format($planMembers)]),
                    'plan_id',
                    422
                );
            }
        }

        if ($this->hasSpecialPrice($tenantId)) {
            return $this->respondWithError('SPECIAL_PRICE', __('api.billing_checkout_special_price'), null, 422);
        }

        try {
            return $this->respondWithData(
                StripeSubscriptionService::changeSubscriptionPlan($tenantId, $planId, $billingInterval, is_int($userId) ? $userId : null)
            );
        } catch (\DomainException $e) {
            [$code, $message] = match ($e->getMessage()) {
                'billing_no_card_subscription' => ['NO_CARD_SUBSCRIPTION', __('api.billing_change_no_card_subscription')],
                'billing_card_needs_attention' => ['CARD_NEEDS_ATTENTION', __('api.billing_change_card_needs_attention')],
                'billing_same_plan' => ['SAME_PLAN', __('api.billing_change_same_plan')],
                'billing_plan_not_sold' => ['VALIDATION_ERROR', __('api.billing_plan_not_sold_monthly')],
                default => ['CHANGE_REFUSED', __('api.billing_change_plan_failed')],
            };

            return $this->respondWithError($code, $message, null, 422);
        } catch (\Exception $e) {
            Log::error('AdminBillingController::changePlan failed', [
                'tenant_id' => $tenantId,
                'plan_id' => $planId,
                'error' => $e->getMessage(),
            ]);

            return $this->respondWithError('STRIPE_ERROR', __('api.billing_change_plan_failed'), null, 500);
        }
    }

    /**
     * Whether the community's plan record in force carries a price the
     * platform team agreed for it: a custom price, a discount, or the
     * non-profit reduction. None of these reaches Stripe.
     */
    private function hasSpecialPrice(int $tenantId): bool
    {
        $record = DB::selectOne(
            "SELECT tpa.custom_price_monthly, tpa.custom_price_yearly, tpa.discount_percentage, tpa.nonprofit_verified
             FROM tenant_plan_assignments tpa
             WHERE tpa.tenant_id = ? AND " . TenantBillingService::PLAN_IN_FORCE_SQL . "
             ORDER BY (tpa.status = 'active') DESC, (tpa.status = 'trial') DESC, tpa.id DESC
             LIMIT 1",
            [$tenantId]
        );

        return $record !== null && (
            $record->custom_price_monthly !== null
            || $record->custom_price_yearly !== null
            || (int) $record->discount_percentage > 0
            || (int) $record->nonprofit_verified === 1
        );
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
     * Every active STANDARD plan, smallest member number first, as the plan
     * picker shows it: the plans card checkout sells (createCheckoutSession()
     * refuses any other). A plan the platform team made for one community is
     * not public and is never listed here. It used to list every active plan,
     * one per `tier_level`, so a bespoke plan's name and price were public and
     * could take a standard plan's place in the picker.
     *
     * Besides the name and the
     * euro prices this carries what a plan allows and costs to start (owner,
     * 21 Nov 2026: the picker showed neither the member number nor the setup
     * fee): `max_users`, the three allowances, both currencies' prices and
     * setup fees, and `charge`.
     *
     * `charge.setup_fee` is what checkout would add for this community: the
     * plan's fee on its first payment, 0 once it has paid before.
     *
     * `charge.monthly` / `charge.yearly` are `{currency, amount, setup_fee}`:
     * what card checkout would charge the community this request is for, in
     * the currency it is billed in (StripeSubscriptionService::quoteFor(),
     * the checkout's own rule). The picker shows these, so a community billed
     * in pounds is quoted pounds. With no community in context it is euro.
     *
     * All of it is the published price list; nothing here is private.
     */
    public function getPlansPublic(): JsonResponse
    {
        $rows = DB::select(
            "SELECT id, name, slug, description, tier_level, features, max_users,
                    price_monthly, price_yearly, setup_fee,
                    price_monthly_gbp, price_yearly_gbp, setup_fee_gbp,
                    max_communities, storage_gb, emails_per_month, is_active
             FROM pay_plans
             WHERE is_active = 1 AND is_standard = 1
             ORDER BY (max_users IS NULL) ASC, max_users ASC, tier_level ASC, id ASC"
        );

        $tenantId = (int) (TenantContext::currentId() ?? 0);
        $communityCurrency = $tenantId > 0 ? StripeSubscriptionService::billingCurrencyFor($tenantId) : 'eur';

        // The setup fee is taken on a community's first payment only: one that
        // has paid before is quoted none, as checkout will add none.
        $setupFeeApplies = $tenantId > 0 ? StripeSubscriptionService::setupFeeApplies($tenantId) : true;

        $nullableInt = static fn (mixed $value): ?int => $value !== null ? (int) $value : null;
        $nullableMoney = static fn (mixed $value): ?float => $value !== null ? (float) $value : null;

        $plans = [];
        foreach ($rows as $row) {
            $decoded = json_decode((string) ($row->features ?? ''), true) ?: [];
            // Features may be stored as {"listings": true, "groups": true} (object)
            // or as ["listings", "groups"] (array). Normalize to string[] for frontend.
            $features = is_array($decoded) && !array_is_list($decoded)
                ? array_keys(array_filter($decoded))
                : array_values((array) $decoded);

            $plans[] = [
                'id' => (int) $row->id,
                'name' => (string) $row->name,
                'slug' => (string) $row->slug,
                'description' => $row->description,
                'tier_level' => (int) $row->tier_level,
                'features' => $features,
                'max_users' => $nullableInt($row->max_users),
                'price_monthly' => (float) $row->price_monthly,
                'price_yearly' => (float) $row->price_yearly,
                'setup_fee' => (float) $row->setup_fee,
                'price_monthly_gbp' => $nullableMoney($row->price_monthly_gbp),
                'price_yearly_gbp' => $nullableMoney($row->price_yearly_gbp),
                'setup_fee_gbp' => $nullableMoney($row->setup_fee_gbp),
                'max_communities' => $nullableInt($row->max_communities),
                'storage_gb' => $nullableInt($row->storage_gb),
                'emails_per_month' => $nullableInt($row->emails_per_month),
                'is_active' => (int) $row->is_active,
                'charge' => array_map(
                    static fn (array $quote): array => $setupFeeApplies ? $quote : ['setup_fee' => 0.0] + $quote,
                    [
                        'monthly' => StripeSubscriptionService::quoteFor($row, 'monthly', $communityCurrency),
                        'yearly' => StripeSubscriptionService::quoteFor($row, 'yearly', $communityCurrency),
                    ]
                ),
            ];
        }

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

        // A few an hour for a community, whoever in it is writing: each one
        // mails every member of the platform team. Keyed on the community the
        // request is for, never on anything the caller sends.
        $limitKey = 'billing-message:' . $tenantId;
        if (RateLimiter::tooManyAttempts($limitKey, self::MESSAGES_PER_HOUR)) {
            return $this->respondWithError('TOO_MANY_MESSAGES', __('api.billing_message_too_many'), null, 429);
        }
        RateLimiter::hit($limitKey, 3600);

        // A note to people, kept to a size a person would write.
        $message  = mb_substr(trim((string) $this->input('message', '')), 0, 2000);

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

                // To the platform team, whoever is on it: the same people the
                // pause and payment notices go to. It was one person's own
                // address written into the code.
                $recipients = DB::table('users')
                    ->where('status', 'active')
                    ->whereNotNull('email')
                    ->where('email', '<>', '')
                    ->where('is_god', 1)
                    ->where('is_super_admin', 1)
                    ->pluck('email')
                    ->unique()
                    ->all();

                // Route through the platform Mailer (Postmark via .env) instead
                // of Laravel's Mail facade — the default Mail mailer is SMTP
                // and MAIL_USERNAME/PASSWORD are intentionally not set in prod,
                // so Mail::raw silently failed for this notification.
                $accepted = 0;
                foreach ($recipients as $recipient) {
                    $accepted += \App\Services\EmailDispatchService::sendRaw(
                        (string) $recipient,
                        $subject,
                        nl2br(htmlspecialchars($body, ENT_QUOTES, 'UTF-8')),
                        null,
                        null,
                        null,
                        'billing',
                        ['tenant_id' => $tenantId]
                    ) ? 1 : 0;
                }

                if ($accepted === 0) {
                    Log::warning('BillingController: upgrade request reached nobody on the platform team', [
                        'tenant_id' => $tenantId,
                        'recipients' => count($recipients),
                    ]);
                }

                return $accepted > 0;
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
