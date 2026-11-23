<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use App\Services\BillingAutomationService;
use App\Services\BillingStandingService;
use App\Support\Billing\BillingSettings;
use App\Support\Billing\HowToPay;
use App\Support\Billing\PlanTerms;
use App\Services\TenantBillingService;
use App\Http\Controllers\Api\Concerns\HandlesBillingStanding;

/**
 * Billing control: the platform team's billing endpoints under
 * /api/v2/admin/super/billing — the snapshot, plan assignment, revenue,
 * export, payment standing, payments recorded by hand, who a community pays,
 * its over-limit rule, the daily check's settings, the platform's own
 * how-to-pay note, and the five retired switches that answer 410. Moved out
 * of AdminSuperController on 23 November 2026 unchanged.
 */
class AdminBillingControlController extends BaseApiController
{
    use HandlesBillingStanding;

    protected bool $isV2Api = true;

    // ─────────────────────────────────────────────────────────────────────────
    // Billing
    // ─────────────────────────────────────────────────────────────────────────

    /** GET /api/v2/admin/super/billing/snapshot */
    public function getBillingSnapshot(): JsonResponse
    {
        $userId = $this->requireGodPlatformAdmin();
        $snapshot = TenantBillingService::getBillingSnapshot();
        return $this->respondWithData($snapshot);
    }

    /** POST /api/v2/admin/super/billing/assign-plan */
    public function assignPlan(): JsonResponse
    {
        $userId = $this->requireGodPlatformAdmin();
        $input    = $this->getAllInput();
        $tenantId = (int) ($input['tenant_id'] ?? 0);
        $planId   = (int) ($input['pay_plan_id'] ?? 0);
        if ($tenantId < 1 || $planId < 1) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.tenant_and_plan_required'), null, 422);
        }
        if (!DB::selectOne('SELECT id FROM tenants WHERE id = ?', [$tenantId])) {
            return $this->respondWithError('NOT_FOUND', __('api.tenant_not_found'), null, 404);
        }
        // The plan it is on now, if any (the record in force).
        $current = PlanTerms::assignmentInForce($tenantId, ['pay_plan_id']);
        $currentPlanId = $current !== null ? (int) $current->pay_plan_id : null;

        // Nobody new is put on a retired plan, but a community already on one
        // can have its price, discount and notes edited: it answered "Plan
        // not found" for that.
        $plan = DB::selectOne('SELECT id, is_active FROM pay_plans WHERE id = ?', [$planId]);
        if (!$plan || ((int) $plan->is_active !== 1 && $planId !== $currentPlanId)) {
            return $this->respondWithError('NOT_FOUND', __('api.plan_not_found'), null, 404);
        }

        $expiresAt = !empty($input['expires_at']) ? substr(trim((string) $input['expires_at']), 0, 10) : null;
        if ($expiresAt !== null) {
            $parsed = \DateTimeImmutable::createFromFormat('!Y-m-d', $expiresAt);
            if ($parsed === false || $parsed->format('Y-m-d') !== $expiresAt) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_date'), 'expires_at', 422);
            }
        }
        $notes     = !empty($input['notes']) ? mb_substr(trim((string) $input['notes']), 0, 2000) : null;

        // Pricing overrides and discount.
        $customPriceMonthly = isset($input['custom_price_monthly']) && $input['custom_price_monthly'] !== ''
            ? (float) $input['custom_price_monthly']
            : null;
        $customPriceYearly = isset($input['custom_price_yearly']) && $input['custom_price_yearly'] !== ''
            ? (float) $input['custom_price_yearly']
            : null;
        $discountPct = max(0, min(100, (int) ($input['discount_percentage'] ?? 0)));
        $discountReason = !empty($input['discount_reason']) ? trim($input['discount_reason']) : null;
        $nonprofitVerified = !empty($input['nonprofit_verified']);

        // A card is charged by Stripe, at the plan's own price, for the plan
        // on its subscription. A change made only here would not reach the
        // card: Stripe would keep charging the old plan and put it back on
        // its next update, and a special price would be shown but never
        // charged. Notes and the review date can still be edited.
        if (TenantBillingService::hasLiveCardSubscription($tenantId)) {
            if ($currentPlanId !== null && $planId !== $currentPlanId) {
                return $this->respondWithError('CARD_PAYER', __('api.billing_assign_card_plan'), 'pay_plan_id', 422);
            }
            if ($customPriceMonthly !== null || $customPriceYearly !== null || $discountPct > 0 || $nonprofitVerified) {
                return $this->respondWithError('CARD_PAYER', __('api.billing_assign_card_special_price'), null, 422);
            }
        }

        TenantBillingService::assignPlan(
            $tenantId, $planId, $expiresAt, $notes, $userId,
            $customPriceMonthly, $customPriceYearly,
            $discountPct, $discountReason, $nonprofitVerified
        );
        return $this->respondWithData(['assigned' => true]);
    }

    /** GET /api/v2/admin/super/billing/revenue */
    public function getRevenueDashboard(): JsonResponse
    {
        $userId = $this->requireGodPlatformAdmin();
        return $this->respondWithData(TenantBillingService::getRevenueDashboard());
    }

    /** GET /api/v2/admin/super/billing/export */
    public function exportBillingCsv(): \Illuminate\Http\Response
    {
        $userId = $this->requireGodPlatformAdmin();
        $csv = TenantBillingService::exportCsv();
        return response($csv, 200, [
            'Content-Type'        => 'text/csv',
            'Content-Disposition' => 'attachment; filename="nexus-billing-' . date('Y-m-d') . '.csv"',
        ]);
    }

    // ── Retired on 22 November 2026 ─────────────────────────────────────
    //
    // "Billing delegates", "pause billing" / "resume billing" and the "grace
    // period" each wrote a value nothing ever read, and answered "success"
    // whether or not anything had changed. No screen offers them. The
    // endpoints stay so that anything still calling one is told plainly, in
    // the reader's language, that it is retired and what to use instead.
    // Platform team only, as before: nobody else learns anything from them.

    /** POST /api/v2/admin/super/billing/delegate/grant */
    public function grantBillingDelegate(): JsonResponse
    {
        $this->requireGodPlatformAdmin();

        return $this->retired('api.billing_delegates_retired');
    }

    /** POST /api/v2/admin/super/billing/delegate/revoke */
    public function revokeBillingDelegate(): JsonResponse
    {
        $this->requireGodPlatformAdmin();

        return $this->retired('api.billing_delegates_retired');
    }

    /** POST /api/v2/admin/super/billing/pause */
    public function pauseTenantBilling(): JsonResponse
    {
        $this->requireGodPlatformAdmin();

        return $this->retired('api.billing_pause_billing_retired');
    }

    /** POST /api/v2/admin/super/billing/resume */
    public function resumeTenantBilling(): JsonResponse
    {
        $this->requireGodPlatformAdmin();

        return $this->retired('api.billing_pause_billing_retired');
    }

    /** POST /api/v2/admin/super/billing/grace-period */
    public function setBillingGracePeriod(): JsonResponse
    {
        $this->requireGodPlatformAdmin();

        return $this->retired('api.billing_grace_period_retired');
    }

    /** 410 Gone, with a sentence saying what replaced the feature. */
    private function retired(string $messageKey): JsonResponse
    {
        return $this->respondWithError('FEATURE_RETIRED', __($messageKey), null, 410);
    }

    // =====================================================================
    // PAYMENT STANDING — pause, restore and exempt a community
    // =====================================================================
    //
    // "Paused for non-payment" is its own state (tenant_billing_standing),
    // not tenants.is_active: the community's members see a paused page and
    // its admins keep the admin panel. Platform team only here; a parent's
    // manager gets its own, narrower endpoints through SuperPanelAccess.

    /** POST /api/v2/admin/super/billing/standing/suspend */
    public function suspendCommunityForBilling(): JsonResponse
    {
        $userId = $this->requireGodPlatformAdmin();
        $input = $this->getAllInput();
        $tenantId = (int) ($input['tenant_id'] ?? 0);
        if ($tenantId < 1) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.tenant_id_is_required'), 'tenant_id', 422);
        }

        $wasClosed = $this->communityIsClosed($tenantId);
        try {
            BillingStandingService::suspend($tenantId, $userId, 'manual', $this->standingNote($input['note'] ?? null));
        } catch (\DomainException $e) {
            return $this->standingRefusal($e);
        }

        $this->tellAdminsIfStandingChanged($tenantId, $wasClosed);

        return $this->respondWithData(['standing' => BillingStandingService::get($tenantId)]);
    }

    /** POST /api/v2/admin/super/billing/standing/restore */
    public function restoreCommunityForBilling(): JsonResponse
    {
        $userId = $this->requireGodPlatformAdmin();
        $input = $this->getAllInput();
        $tenantId = (int) ($input['tenant_id'] ?? 0);
        if ($tenantId < 1) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.tenant_id_is_required'), 'tenant_id', 422);
        }

        $wasClosed = $this->communityIsClosed($tenantId);
        try {
            BillingStandingService::restore($tenantId, $userId, $this->standingNote($input['note'] ?? null));
        } catch (\DomainException $e) {
            return $this->standingRefusal($e);
        }

        $this->tellAdminsIfStandingChanged($tenantId, $wasClosed);

        return $this->respondWithData(['standing' => BillingStandingService::get($tenantId)]);
    }

    /** POST /api/v2/admin/super/billing/standing/exempt */
    public function setCommunityBillingExemption(): JsonResponse
    {
        $userId = $this->requireGodPlatformAdmin();
        $input = $this->getAllInput();
        $tenantId = (int) ($input['tenant_id'] ?? 0);
        if ($tenantId < 1) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.tenant_id_is_required'), 'tenant_id', 422);
        }

        $exempt = filter_var($input['exempt'] ?? false, FILTER_VALIDATE_BOOLEAN);

        $wasClosed = $this->communityIsClosed($tenantId);
        try {
            BillingStandingService::setExempt($tenantId, $exempt, $userId, $this->standingNote($input['reason'] ?? null));
        } catch (\DomainException $e) {
            return $this->standingRefusal($e);
        }

        $this->tellAdminsIfStandingChanged($tenantId, $wasClosed);

        return $this->respondWithData(['standing' => BillingStandingService::get($tenantId)]);
    }

    /**
     * POST /api/v2/admin/super/billing/standing/paid-until
     *
     * The platform team records the date a community is paid up to, for any
     * community (DESIGN §6.4), including one that pays its parent.
     */
    public function setCommunityPaidUntil(): JsonResponse
    {
        $userId = $this->requireGodPlatformAdmin();
        $input = $this->getAllInput();
        $tenantId = (int) ($input['tenant_id'] ?? 0);
        if ($tenantId < 1) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.tenant_id_is_required'), 'tenant_id', 422);
        }

        // Only an explicit null clears the date. A request that does not say
        // paid_until at all is a mistake, not an instruction to stop tracking.
        $date = $input['paid_until'] ?? null;
        if (!array_key_exists('paid_until', $input) || ($date !== null && !is_string($date))) {
            return $this->respondWithError('PAID_UNTIL_INVALID', __('api.billing_standing_paid_until_invalid'), 'paid_until', 422);
        }

        $wasClosed = $this->communityIsClosed($tenantId);
        try {
            BillingStandingService::setPaidUntil($tenantId, $date, $userId, $this->standingNote($input['note'] ?? null));
        } catch (\DomainException $e) {
            return $this->standingRefusal($e);
        }

        $this->tellAdminsIfStandingChanged($tenantId, $wasClosed);

        return $this->respondWithData(['standing' => BillingStandingService::get($tenantId)]);
    }

    /**
     * POST /api/v2/admin/super/billing/standing/record-payment
     *
     * A payment that did not come through Stripe (a bank transfer, a cheque),
     * recorded with the date it pays up to. Reopens a community the system
     * paused for non-payment, and tells its admins, as setting the date does.
     */
    public function recordCommunityPayment(): JsonResponse
    {
        $userId = $this->requireGodPlatformAdmin();
        $input = $this->getAllInput();
        $tenantId = (int) ($input['tenant_id'] ?? 0);
        if ($tenantId < 1) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.tenant_id_is_required'), 'tenant_id', 422);
        }

        $wasClosed = $this->communityIsClosed($tenantId);
        try {
            $paymentId = BillingStandingService::recordPayment($tenantId, [
                'paid_until' => $input['paid_until'] ?? null,
                'received_on' => $input['received_on'] ?? null,
                'method' => $input['method'] ?? null,
                'reference' => $input['reference'] ?? null,
                'amount' => $input['amount'] ?? null,
                'currency' => $input['currency'] ?? null,
            ], $userId, $this->payeeOnRecord($tenantId));
        } catch (\DomainException $e) {
            return $this->standingRefusal($e);
        }

        $this->tellAdminsIfStandingChanged($tenantId, $wasClosed);

        return $this->respondWithData([
            'standing' => BillingStandingService::get($tenantId),
            'payment_id' => $paymentId,
        ]);
    }

    /**
     * POST /api/v2/admin/super/billing/standing/void-payment
     *   {tenant_id, payment_id, reason, paid_until?}
     *
     * The platform team voids a payment recorded by hand, for any community.
     * The payment stays in the history, struck through, with the reason.
     * Voiding does not move the paid-until date by itself: `paid_until`, when
     * the request says it at all, sets the date in the same step (null stops
     * tracking one). A card payment is refused: it is undone in Stripe.
     */
    public function voidCommunityPayment(): JsonResponse
    {
        $userId = $this->requireGodPlatformAdmin();
        $input = $this->getAllInput();
        $tenantId = (int) ($input['tenant_id'] ?? 0);
        if ($tenantId < 1) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.tenant_id_is_required'), 'tenant_id', 422);
        }

        return $this->voidPaymentFor($tenantId, $input, $userId, null);
    }

    /** GET /api/v2/admin/super/billing/standing/payments?tenant_id=N */
    public function communityPayments(): JsonResponse
    {
        $this->requireGodPlatformAdmin();
        $tenantId = (int) ($this->getAllInput()['tenant_id'] ?? 0);
        if ($tenantId < 1) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.tenant_id_is_required'), 'tenant_id', 422);
        }

        try {
            return $this->respondWithData(BillingStandingService::payments($tenantId));
        } catch (\DomainException $e) {
            return $this->standingRefusal($e);
        }
    }

    /**
     * POST /api/v2/admin/super/billing/standing/payer
     *
     * Who a community pays. `payer: null` returns it to the default its place
     * in the tree gives it.
     */
    public function setCommunityPayer(): JsonResponse
    {
        $userId = $this->requireGodPlatformAdmin();
        $input = $this->getAllInput();
        $tenantId = (int) ($input['tenant_id'] ?? 0);
        if ($tenantId < 1) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.tenant_id_is_required'), 'tenant_id', 422);
        }

        // Only an explicit null returns to the default. A request that does
        // not say payer at all is a mistake, not an instruction to reset.
        $payer = $input['payer'] ?? null;
        if (!array_key_exists('payer', $input) || ($payer !== null && !is_string($payer))) {
            return $this->respondWithError('PAYER_INVALID', __('api.billing_standing_payer_invalid'), 'payer', 422);
        }

        try {
            BillingStandingService::setPayer($tenantId, $payer, $userId);
        } catch (\DomainException $e) {
            return $this->standingRefusal($e);
        }

        return $this->respondWithData(['standing' => BillingStandingService::get($tenantId)]);
    }

    /**
     * POST /api/v2/admin/super/billing/standing/over-limit  {tenant_id, action, grace_days}
     *
     * The platform team sets any community's own rule for going over its
     * member number. Both rule keys are required; null = follow the default.
     * "Move up" is refused for a card payer (RULE_NOT_ALLOWED). Restarts the
     * community's days-over count.
     */
    public function setCommunityOverLimitRule(): JsonResponse
    {
        $userId = $this->requireGodPlatformAdmin();
        $input = $this->getAllInput();
        $tenantId = (int) ($input['tenant_id'] ?? 0);
        if ($tenantId < 1) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.tenant_id_is_required'), 'tenant_id', 422);
        }

        $rule = $this->overLimitRuleInput($input);
        if ($rule instanceof JsonResponse) {
            return $rule;
        }

        try {
            BillingStandingService::setOverLimitRule($tenantId, $rule['action'], $rule['grace_days'], $userId);
        } catch (\DomainException $e) {
            return $this->overLimitRefusal($e);
        }

        return $this->respondWithData($this->overLimitOf($tenantId));
    }

    // =====================================================================
    // THE DAILY CHECK — its settings and what it would do today
    // =====================================================================

    /** GET /api/v2/admin/super/billing/settings */
    public function getBillingAutomationSettings(): JsonResponse
    {
        $this->requireGodPlatformAdmin();

        return $this->respondWithData(BillingSettings::all());
    }

    /**
     * PUT /api/v2/admin/super/billing/settings
     *
     * Any subset of the settings. All or nothing: one bad key or value and
     * none is saved.
     */
    public function updateBillingAutomationSettings(): JsonResponse
    {
        $userId = $this->requireGodPlatformAdmin();
        $input = $this->getAllInput();

        try {
            BillingSettings::setMany($input, $userId);
        } catch (\DomainException $e) {
            if ($e->getMessage() !== 'billing_setting_invalid') {
                throw $e;
            }

            return $this->respondWithError('BILLING_SETTING_INVALID', __('api.billing_setting_invalid'), null, 422);
        }

        return $this->respondWithData(BillingSettings::all());
    }

    /**
     * GET /api/v2/admin/super/billing/standing/preview
     *
     * What the daily check would do today. Never acts and never sends, and
     * answers whether the master switch is on or off: reading this list is
     * how the switch is meant to be turned on.
     */
    public function previewBillingAutomation(): JsonResponse
    {
        $this->requireGodPlatformAdmin();

        return $this->respondWithData(BillingAutomationService::preview());
    }

    /**
     * GET /api/v2/admin/super/billing/standing/last-run
     *
     * When the daily check last ran and how it went: `{at, result, actions}`,
     * or `{at: null}` when it never has. Read-only.
     */
    public function lastBillingAutomationRun(): JsonResponse
    {
        $this->requireGodPlatformAdmin();

        return $this->respondWithData(
            BillingAutomationService::lastRun() ?? ['at' => null, 'result' => null, 'actions' => 0]
        );
    }

    /**
     * GET /api/v2/admin/super/billing/how-to-pay
     *
     * The platform's own note, for the communities that pay the platform by
     * invoice. Platform team only.
     */
    public function getPlatformHowToPay(): JsonResponse
    {
        $this->requireGodPlatformAdmin();

        return $this->respondWithData([
            'how_to_pay' => HowToPay::forPayee(HowToPay::PLATFORM),
            'how_to_pay_max' => HowToPay::MAX,
        ]);
    }

    /** PUT /api/v2/admin/super/billing/how-to-pay  {note}. Platform team only. */
    public function setPlatformHowToPay(): JsonResponse
    {
        $userId = $this->requireGodPlatformAdmin();

        return $this->saveHowToPay(HowToPay::PLATFORM, $userId);
    }

    /**
     * Who a payment the platform team records for this community is paid to:
     * its direct parent when it pays its parent, otherwise the platform
     * (null). A community that does not exist has nobody; the service then
     * refuses the payment itself.
     */
    private function payeeOnRecord(int $tenantId): ?int
    {
        try {
            if (BillingStandingService::get($tenantId)['payer'] !== 'parent') {
                return null;
            }
        } catch (\DomainException) {
            return null;
        }

        $parentId = (int) DB::table('tenants')->where('id', $tenantId)->value('parent_id');

        return $parentId > 1 ? $parentId : null;
    }
}
