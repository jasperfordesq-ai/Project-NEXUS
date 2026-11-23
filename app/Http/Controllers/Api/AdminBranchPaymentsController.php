<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use App\Core\ApiErrorCodes;
use App\Services\BillingStandingNotifier;
use App\Services\BillingStandingService;
use App\Support\Billing\BranchPayments;
use App\Support\Billing\PlanTerms;
use App\Services\TenantBillingService;
use App\Http\Controllers\Api\Concerns\RequiresSuperPanelAccess;
use App\Http\Controllers\Api\Concerns\HandlesBillingStanding;

/**
 * Branch payments: a parent community's manager and the payment standing,
 * payments, plan and over-limit rule of the communities below it, under
 * /api/v2/admin/super/branch-payments. Moved out of AdminSuperController on
 * 23 November 2026 unchanged.
 */
class AdminBranchPaymentsController extends BaseApiController
{
    use RequiresSuperPanelAccess;
    use HandlesBillingStanding;

    protected bool $isV2Api = true;

    // =====================================================================
    // BRANCH PAYMENTS — a parent's manager and the communities below it
    // =====================================================================
    //
    // Not platform-team-only: any super admin may call these, and
    // BranchPayments decides, per community, whether THIS caller may act —
    // below its own community only, never one that pays the platform, never
    // an exempt one. Pinned at both ends by BranchPaymentsEndpointsTest.

    /** GET /api/v2/admin/super/branch-payments */
    public function branchPayments(): JsonResponse
    {
        $this->requireSuperAdmin();

        return $this->respondWithData(BranchPayments::rows());
    }

    /** POST /api/v2/admin/super/branch-payments/{id}/paid-until */
    public function branchPaymentsSetPaidUntil(int $id): JsonResponse
    {
        $userId = $this->requireSuperAdmin();
        if ($refused = $this->branchPaymentsRefusal($id)) {
            return $refused;
        }

        $input = $this->getAllInput();
        // Only an explicit null clears the date. A request that does not say
        // paid_until at all is a mistake, not an instruction to stop tracking.
        $date = $input['paid_until'] ?? null;
        if (!array_key_exists('paid_until', $input) || ($date !== null && !is_string($date))) {
            return $this->respondWithError('PAID_UNTIL_INVALID', __('api.billing_standing_paid_until_invalid'), 'paid_until', 422);
        }

        $wasClosed = $this->communityIsClosed($id);
        try {
            BillingStandingService::setPaidUntil($id, $date, $userId, $this->standingNote($input['note'] ?? null));
        } catch (\DomainException $e) {
            return $this->standingRefusal($e);
        }

        $this->tellAdminsIfStandingChanged($id, $wasClosed);

        return $this->respondWithData(['standing' => BillingStandingService::get($id)]);
    }

    /**
     * POST /api/v2/admin/super/branch-payments/{id}/record-payment
     *
     * A parent community's manager records a payment a community below made
     * to its parent: the date received, how it was paid, a reference, the
     * amount and currency, and the date it is now paid up to. Refused for a
     * community that pays the platform and for an exempt one, like every
     * other write here. The payment is stored as paid to the community's
     * direct parent (BranchPayments::payeeFor()).
     */
    public function branchPaymentsRecordPayment(int $id): JsonResponse
    {
        $userId = $this->requireSuperAdmin();
        if ($refused = $this->branchPaymentsRefusal($id)) {
            return $refused;
        }
        $payee = BranchPayments::payeeFor($id);
        if ($payee === null) {
            return $this->respondWithError(ApiErrorCodes::SUPER_PANEL_ACCESS_DENIED, __('api.super_no_access_tenant'), null, 403);
        }

        $input = $this->getAllInput();
        $wasClosed = $this->communityIsClosed($id);
        try {
            $paymentId = BillingStandingService::recordPayment($id, [
                'paid_until' => $input['paid_until'] ?? null,
                'received_on' => $input['received_on'] ?? null,
                'method' => $input['method'] ?? null,
                'reference' => $input['reference'] ?? null,
                'amount' => $input['amount'] ?? null,
                'currency' => $input['currency'] ?? null,
            ], $userId, $payee);
        } catch (\DomainException $e) {
            return $this->standingRefusal($e);
        }

        $this->tellAdminsIfStandingChanged($id, $wasClosed);

        return $this->respondWithData([
            'standing' => BillingStandingService::get($id),
            'payment_id' => $paymentId,
        ]);
    }

    /**
     * GET /api/v2/admin/super/branch-payments/{id}/payments
     *
     * The payments this community made to its direct parent, newest first.
     * Never a payment it made to the platform, or to a parent it had before.
     */
    public function branchPaymentsHistory(int $id): JsonResponse
    {
        $this->requireSuperAdmin();
        if ($refused = $this->branchPaymentsRefusal($id)) {
            return $refused;
        }
        $payee = BranchPayments::payeeFor($id);
        if ($payee === null) {
            return $this->respondWithError(ApiErrorCodes::SUPER_PANEL_ACCESS_DENIED, __('api.super_no_access_tenant'), null, 403);
        }

        return $this->respondWithData(BillingStandingService::paymentsPaidTo($id, $payee));
    }

    /**
     * POST /api/v2/admin/super/branch-payments/{id}/void-payment
     *   {payment_id, reason, paid_until?}
     *
     * A parent community's manager voids a payment a community below made to
     * its parent. Only a payment made to that parent: one made to the
     * platform, or to a parent the community had before, answers "not found"
     * like one that does not exist.
     */
    public function branchPaymentsVoidPayment(int $id): JsonResponse
    {
        $userId = $this->requireSuperAdmin();
        if ($refused = $this->branchPaymentsRefusal($id)) {
            return $refused;
        }
        $payee = BranchPayments::payeeFor($id);
        if ($payee === null) {
            return $this->respondWithError(ApiErrorCodes::SUPER_PANEL_ACCESS_DENIED, __('api.super_no_access_tenant'), null, 403);
        }

        return $this->voidPaymentFor($id, $this->getAllInput(), $userId, $payee);
    }

    /** POST /api/v2/admin/super/branch-payments/{id}/suspend */
    public function branchPaymentsSuspend(int $id): JsonResponse
    {
        $userId = $this->requireSuperAdmin();
        if ($refused = $this->branchPaymentsRefusal($id)) {
            return $refused;
        }

        $wasClosed = $this->communityIsClosed($id);
        try {
            BillingStandingService::suspend($id, $userId, 'manual', $this->standingNote($this->getAllInput()['note'] ?? null));
        } catch (\DomainException $e) {
            return $this->standingRefusal($e);
        }

        $this->tellAdminsIfStandingChanged($id, $wasClosed);

        return $this->respondWithData(['standing' => BillingStandingService::get($id)]);
    }

    /** POST /api/v2/admin/super/branch-payments/{id}/restore */
    public function branchPaymentsRestore(int $id): JsonResponse
    {
        $userId = $this->requireSuperAdmin();
        if ($refused = $this->branchPaymentsRefusal($id)) {
            return $refused;
        }

        // Paused only because a community above it is paused: there is nothing
        // on this community to lift, and the one above may be out of the
        // caller's reach. Say so, do not answer "restored".
        $standing = BillingStandingService::get($id);
        if ($standing['suspended_at'] === null && $standing['locked']) {
            return $this->respondWithError('PAUSED_FROM_ABOVE', __('api.branch_payments_paused_from_above'), null, 422);
        }

        $wasClosed = $this->communityIsClosed($id);
        try {
            BillingStandingService::restore($id, $userId, $this->standingNote($this->getAllInput()['note'] ?? null));
        } catch (\DomainException $e) {
            return $this->standingRefusal($e);
        }

        $this->tellAdminsIfStandingChanged($id, $wasClosed);

        return $this->respondWithData(['standing' => BillingStandingService::get($id)]);
    }

    /**
     * GET /api/v2/admin/super/branch-payments/{id}/plans
     *
     * The plans this community can be put on: its parent's offered plans, on
     * the parent's terms, in the community's own billing currency.
     */
    public function branchPaymentsPlans(int $id): JsonResponse
    {
        $this->requireSuperAdmin();
        if ($refused = $this->branchPaymentsRefusal($id)) {
            return $refused;
        }

        return $this->respondWithData(PlanTerms::availableTo($id));
    }

    /**
     * POST /api/v2/admin/super/branch-payments/{id}/plan  {plan_id}
     *
     * A hub's manager puts a community that pays it on one of the plans its
     * parent offers. Changes the plan and nothing else
     * (TenantBillingService::changePlanOnly): the custom price, discount,
     * non-profit flag, notes and expiry are the platform team's. The
     * community's admins are told.
     */
    public function branchPaymentsSetPlan(int $id): JsonResponse
    {
        $userId = $this->requireSuperAdmin();
        if ($refused = $this->branchPaymentsRefusal($id)) {
            return $refused;
        }
        // A live card subscription: Stripe would keep charging the old plan.
        if (BranchPayments::planChangeRefusalFor($id) === BranchPayments::CARD_SUBSCRIPTION) {
            return $this->cardSubscriptionRefusal();
        }

        $planId = filter_var($this->getAllInput()['plan_id'] ?? null, FILTER_VALIDATE_INT);
        if ($planId === false || $planId < 1) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_plan_id'), 'plan_id', 422);
        }

        // Only a plan the parent offers: a hidden one, a retired one and a
        // custom one are all absent from this list.
        $offered = in_array($planId, array_column(PlanTerms::availableTo($id), 'plan_id'), true);
        if (!$offered) {
            return $this->respondWithError('PLAN_NOT_OFFERED', __('api.branch_payments_plan_not_offered'), 'plan_id', 422);
        }

        $before = PlanTerms::forCommunity($id);
        if ($before === null || $before['plan_id'] !== $planId) {
            try {
                TenantBillingService::changePlanOnly($id, $planId, $userId, 'hub');
            } catch (\DomainException $e) {
                // A card subscription started since the check above.
                if ($e->getMessage() === 'billing_card_subscription') {
                    return $this->cardSubscriptionRefusal();
                }
                throw $e;
            }

            try {
                BillingStandingNotifier::planChanged($id, TenantBillingService::planChangedFacts($id, $before['name'] ?? null));
            } catch (\Throwable $e) {
                // The plan has changed; a failure to mail must not undo it or
                // answer as if it had not happened. Logged as an error: the
                // likeliest cause is a contract fault in the facts, not mail.
                \Illuminate\Support\Facades\Log::error('[billing] could not tell a community' . chr(39) . 's admins about its new plan', [
                    'tenant_id' => $id,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        $plan = PlanTerms::forCommunity($id);

        return $this->respondWithData([
            'plan' => $plan,
            'members' => BranchPayments::members($id, $plan['max_users'] ?? null),
        ]);
    }

    /**
     * POST /api/v2/admin/super/branch-payments/{id}/over-limit  {action, grace_days}
     *
     * A hub's manager sets the rule for going over the member number on a
     * community that pays it. Both keys are required; null = follow the
     * default (the hub's default for its children, else the platform's).
     * Restarts the community's days-over count.
     */
    public function branchPaymentsSetOverLimit(int $id): JsonResponse
    {
        $userId = $this->requireSuperAdmin();
        if ($refused = $this->branchPaymentsRefusal($id)) {
            return $refused;
        }

        $rule = $this->overLimitRuleInput($this->getAllInput());
        if ($rule instanceof JsonResponse) {
            return $rule;
        }

        try {
            BillingStandingService::setOverLimitRule($id, $rule['action'], $rule['grace_days'], $userId);
        } catch (\DomainException $e) {
            return $this->overLimitRefusal($e);
        }

        return $this->respondWithData($this->overLimitOf($id));
    }

    private function cardSubscriptionRefusal(): JsonResponse
    {
        return $this->respondWithError('HAS_CARD_SUBSCRIPTION', __('api.branch_payments_card_subscription'), null, 422);
    }

    /** The refusal for this caller and community as a response, or null. */
    private function branchPaymentsRefusal(int $id): ?JsonResponse
    {
        return match (BranchPayments::refusalFor($id)) {
            null => null,
            BranchPayments::PAYS_PLATFORM => $this->respondWithError('PAYS_PLATFORM', __('api.branch_payments_pays_platform'), null, 422),
            BranchPayments::EXEMPT => $this->respondWithError('EXEMPT', __('api.branch_payments_exempt'), null, 422),
            // Out of reach, and "does not exist", answer the same way.
            default => $this->respondWithError(ApiErrorCodes::SUPER_PANEL_ACCESS_DENIED, __('api.super_no_access_tenant'), null, 403),
        };
    }
}
