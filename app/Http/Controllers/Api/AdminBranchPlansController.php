<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use App\Core\SuperPanelAccess;
use App\Services\BillingStandingService;
use App\Support\Billing\BillingSettings;
use App\Support\Billing\BranchPlans;
use App\Support\Billing\HowToPay;
use App\Support\Billing\OverLimitRule;
use App\Support\Billing\PlanTerms;
use App\Services\StripeSubscriptionService;
use App\Http\Controllers\Api\Concerns\RequiresSuperPanelAccess;
use App\Http\Controllers\Api\Concerns\HandlesBillingStanding;

/**
 * Branch plans: a hub's own version of the default plans, its over-limit
 * default for the communities that pay it and its how-to-pay note, under
 * /api/v2/admin/super/branch-plans. Moved out of AdminSuperController on
 * 23 November 2026 unchanged.
 */
class AdminBranchPlansController extends BaseApiController
{
    use RequiresSuperPanelAccess;
    use HandlesBillingStanding;

    protected bool $isV2Api = true;

    // =====================================================================
    // BRANCH PLANS — a hub's own version of the default plans
    // =====================================================================
    //
    // Not platform-team-only, like Branch payments: BranchPlans decides, per
    // hub, whether THIS caller may change it — its own community or one below
    // it, never tenant 1. Pinned at both ends by BranchPlansEndpointsTest.

    /** GET /api/v2/admin/super/branch-plans?hub_id= */
    public function branchPlans(): JsonResponse
    {
        $this->requireSuperAdmin();

        $hubs = BranchPlans::hubs();
        $asked = request()->query('hub_id');

        if ($asked !== null && $asked !== '') {
            $hubId = filter_var($asked, FILTER_VALIDATE_INT);
            if ($hubId === false || BranchPlans::refusalForHub((int) $hubId) !== null) {
                return $this->branchPlansNotInReach();
            }
            $hubId = (int) $hubId;
        } else {
            // The caller's own community only when it is one of the hubs the
            // picker lists: a platform account based in a leaf community
            // would otherwise land on a page for a community the picker
            // does not offer.
            $own = (int) (SuperPanelAccess::getAccess()['tenant_id'] ?? 0);
            $hubIds = array_column($hubs, 'id');
            $hubId = in_array($own, $hubIds, true) ? $own : ($hubIds[0] ?? null);
        }

        return $this->respondWithData([
            'hubs' => $hubs,
            'hub_id' => $hubId,
            // The page leads with the hub's own currency; both are editable.
            'hub_currency' => $hubId !== null ? StripeSubscriptionService::billingCurrencyFor($hubId) : null,
            'plans' => $hubId !== null ? PlanTerms::offeredBy($hubId) : [],
            'over_limit' => $hubId !== null ? $this->hubOverLimit($hubId) : null,
            // What this hub tells the communities that pay it about paying.
            'how_to_pay' => $hubId !== null ? HowToPay::forPayee($hubId) : null,
            'how_to_pay_max' => HowToPay::MAX,
        ]);
    }

    /**
     * PUT /api/v2/admin/super/branch-plans/{hubId}/how-to-pay  {note}
     *
     * The note a parent community writes for the communities that pay it:
     * its bank details, who to contact. Shown on their Billing page, on their
     * admin warning line and in their payment emails. Null or empty removes
     * it. Plain text, HowToPay::MAX characters at most.
     *
     * Reach is the Branch plans rule: its own community or one below.
     */
    public function branchPlansSetHowToPay(int $hubId): JsonResponse
    {
        $userId = $this->requireSuperAdmin();
        if (BranchPlans::refusalForHub($hubId) !== null) {
            return $this->branchPlansNotInReach();
        }

        return $this->saveHowToPay($hubId, $userId);
    }

    /**
     * PUT /api/v2/admin/super/branch-plans/{hubId}/over-limit  {action, grace_days}
     *
     * The rule a hub sets for the communities that pay it. Both keys are
     * required; null = they follow the platform's. May be "move up": for a
     * child that pays by card it is treated as warn only. Restarts the
     * days-over count of every child that follows the part that changed.
     */
    public function branchPlansSetOverLimit(int $hubId): JsonResponse
    {
        $userId = $this->requireSuperAdmin();
        if (BranchPlans::refusalForHub($hubId) !== null) {
            return $this->branchPlansNotInReach();
        }

        $rule = $this->overLimitRuleInput($this->getAllInput());
        if ($rule instanceof JsonResponse) {
            return $rule;
        }

        try {
            BillingStandingService::setChildrenOverLimitRule($hubId, $rule['action'], $rule['grace_days'], $userId);
        } catch (\DomainException $e) {
            return $this->overLimitRefusal($e);
        }

        return $this->respondWithData(['over_limit' => $this->hubOverLimit($hubId)]);
    }

    /**
     * A hub's stored default for its children (null = follow the platform)
     * beside the platform's own values, so the page can say what "follow the
     * default" means today.
     *
     * `automation_enabled`: whether the platform team's automatic checks are
     * on, so the page can say plainly that nothing acts until they are.
     *
     * @return array{action: ?string, grace_days: ?int, platform_action: string, platform_grace_days: int, automation_enabled: bool}
     */
    private function hubOverLimit(int $hubId): array
    {
        $stored = OverLimitRule::childrenDefault($hubId);

        return [
            'action' => $stored['action'],
            'grace_days' => $stored['grace_days'],
            'platform_action' => (string) BillingSettings::get('over_limit_action'),
            'platform_grace_days' => (int) BillingSettings::get('over_limit_grace_days'),
            'automation_enabled' => (bool) BillingSettings::get('automation_enabled'),
        ];
    }

    /**
     * Restart the days-over count of the communities that pay $hubId and are
     * on $planId when the member number they are held to has changed
     * (DESIGN 6.4), so a hub lowering a number never causes a pause or a move
     * the next morning. Nothing restarts when the number is the same.
     */
    private function restartWhenHubMemberNumberChanged(int $hubId, int $planId, ?int $before): void
    {
        $after = $this->hubPlan($hubId, $planId)['max_users'] ?? null;
        if ($before === $after) {
            return;
        }

        BillingStandingService::restartLimitClock(OverLimitRule::communitiesPaying($hubId, $planId));
    }

    /** PUT /api/v2/admin/super/branch-plans/{hubId}/plans/{planId} */
    public function branchPlansUpdate(int $hubId, int $planId): JsonResponse
    {
        $userId = $this->requireSuperAdmin();
        if (BranchPlans::refusalForHub($hubId) !== null) {
            return $this->branchPlansNotInReach();
        }
        if (!$this->isOfferablePlan($planId)) {
            return $this->respondWithError('NOT_FOUND', __('api.plan_not_found'), 'plan_id', 404);
        }

        $input = $this->getAllInput();
        $values = $this->branchPlanValues($input);
        if ($values instanceof JsonResponse) {
            return $values;
        }

        $isOffered = null;
        if (array_key_exists('is_offered', $input)) {
            $isOffered = filter_var($input['is_offered'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
            if ($isOffered === null) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.hub_plan_offered_invalid'), 'is_offered', 422);
            }
        }

        if ($values === [] && $isOffered === null) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.no_fields_to_update'), null, 422);
        }

        PlanTerms::flush();
        $membersBefore = $this->hubPlan($hubId, $planId)['max_users'] ?? null;

        try {
            BranchPlans::saveTerms($hubId, $planId, $values, $isOffered, $userId);
            $this->restartWhenHubMemberNumberChanged($hubId, $planId, $membersBefore);
        } catch (\DomainException $e) {
            if ($e->getMessage() !== BranchPlans::PLAN_IN_USE) {
                throw $e;
            }

            return $this->respondWithError('PLAN_IN_USE', __('api.hub_plan_in_use'), 'is_offered', 422);
        }

        return $this->respondWithData(['plan' => $this->hubPlan($hubId, $planId)]);
    }

    /** DELETE /api/v2/admin/super/branch-plans/{hubId}/plans/{planId} */
    public function branchPlansReset(int $hubId, int $planId): JsonResponse
    {
        $userId = $this->requireSuperAdmin();
        if (BranchPlans::refusalForHub($hubId) !== null) {
            return $this->branchPlansNotInReach();
        }
        if (!$this->isOfferablePlan($planId)) {
            return $this->respondWithError('NOT_FOUND', __('api.plan_not_found'), 'plan_id', 404);
        }

        PlanTerms::flush();
        $membersBefore = $this->hubPlan($hubId, $planId)['max_users'] ?? null;

        BranchPlans::resetTerms($hubId, $planId, $userId);
        $this->restartWhenHubMemberNumberChanged($hubId, $planId, $membersBefore);

        return $this->respondWithData(['plan' => $this->hubPlan($hubId, $planId)]);
    }

    /** Out of reach, tenant 1, and "does not exist" all answer the same way. */
    private function branchPlansNotInReach(): JsonResponse
    {
        return $this->respondWithError('NOT_IN_REACH', __('api.super_no_access_tenant'), null, 404);
    }

    /** Hubs change only the active standard plans. */
    private function isOfferablePlan(int $planId): bool
    {
        return in_array($planId, array_column(PlanTerms::defaults(), 'plan_id'), true);
    }

    /** @return array<string, mixed>|null */
    private function hubPlan(int $hubId, int $planId): ?array
    {
        foreach (PlanTerms::offeredBy($hubId) as $plan) {
            if ($plan['plan_id'] === $planId) {
                return $plan;
            }
        }

        return null;
    }

    /**
     * The hub's values present in $input, validated as the default plans'
     * are (AdminContentController::planFields): a member number from 1 to
     * PlanTerms::MAX_MEMBER_NUMBER, money from 0 to PlanTerms::MAX_MONEY
     * rounded to cents. Empty or null = follow the default.
     *
     * @param array<string, mixed> $input
     * @return array<string, mixed>|JsonResponse
     */
    private function branchPlanValues(array $input): array|JsonResponse
    {
        $values = [];

        foreach (['name' => PlanTerms::MAX_NAME_LENGTH, 'description' => PlanTerms::MAX_DESCRIPTION_LENGTH] as $field => $max) {
            if (!array_key_exists($field, $input)) {
                continue;
            }
            $value = $input[$field];
            if ($value === null || (is_string($value) && trim($value) === '')) {
                $values[$field] = null;
                continue;
            }
            if (!is_string($value) || mb_strlen(trim($value)) > $max) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.hub_plan_text_invalid', [
                    'field' => __("api.plan_field_{$field}"),
                    'max' => $max,
                ]), $field, 422);
            }
            $values[$field] = trim($value);
        }

        if (array_key_exists('max_users', $input)) {
            $value = $input['max_users'];
            if ($value === null || $value === '') {
                $values['max_users'] = null;
            } else {
                $number = filter_var($value, FILTER_VALIDATE_INT);
                if ($number === false || $number < 1) {
                    return $this->respondWithError('VALIDATION_ERROR', __('api.plan_member_number_invalid', ['field' => __('api.plan_field_max_users')]), 'max_users', 422);
                }
                if ($number > PlanTerms::MAX_MEMBER_NUMBER) {
                    return $this->respondWithError('VALIDATION_ERROR', __('api.plan_value_too_large', ['field' => __('api.plan_field_max_users'), 'max' => PlanTerms::MAX_MEMBER_NUMBER]), 'max_users', 422);
                }
                $values['max_users'] = $number;
            }
        }

        foreach (['price_monthly', 'price_yearly', 'setup_fee', 'price_monthly_gbp', 'price_yearly_gbp', 'setup_fee_gbp'] as $field) {
            if (!array_key_exists($field, $input)) {
                continue;
            }
            $value = $input[$field];
            if ($value === null || $value === '') {
                $values[$field] = null;
                continue;
            }
            if (!is_numeric($value) || (float) $value < 0 || !is_finite((float) $value)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.plan_price_invalid', ['field' => __("api.plan_field_{$field}")]), $field, 422);
            }
            if (round((float) $value, 2) > PlanTerms::MAX_MONEY) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.plan_value_too_large', ['field' => __("api.plan_field_{$field}"), 'max' => PlanTerms::MAX_MONEY]), $field, 422);
            }
            $values[$field] = round((float) $value, 2);
        }

        return $values;
    }
}
