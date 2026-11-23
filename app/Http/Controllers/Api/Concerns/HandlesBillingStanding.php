<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api\Concerns;

use Illuminate\Http\JsonResponse;
use App\Services\BillingStandingNotifier;
use App\Services\BillingStandingService;
use App\Support\Billing\HowToPay;
use App\Support\Billing\OverLimitRule;

/**
 * Helpers shared by the billing controllers (Billing control, Branch
 * payments, Branch plans): payment standing refusals and notices, voiding a
 * payment, the over-limit rule input and answer, and saving a how-to-pay
 * note. Moved out of AdminSuperController on 23 November 2026 unchanged.
 */
trait HandlesBillingStanding
{
    /**
     * Void one payment and answer with the community's standing. Shared by
     * the platform team's endpoint and a parent community's manager's.
     *
     * @param array<string, mixed> $input payment_id, reason, paid_until?
     */
    private function voidPaymentFor(int $tenantId, array $input, int $userId, ?int $onlyPaidTo): JsonResponse
    {
        $change = [];
        if (array_key_exists('paid_until', $input)) {
            $date = $input['paid_until'];
            if ($date !== null && !is_string($date)) {
                return $this->respondWithError('PAID_UNTIL_INVALID', __('api.billing_standing_paid_until_invalid'), 'paid_until', 422);
            }
            $change['paid_until'] = $date;
        }

        $wasClosed = $this->communityIsClosed($tenantId);
        try {
            BillingStandingService::voidPayment(
                $tenantId,
                (int) ($input['payment_id'] ?? 0),
                $userId,
                $this->standingNote($input['reason'] ?? null),
                $change,
                $onlyPaidTo
            );
        } catch (\DomainException $e) {
            return $this->standingRefusal($e);
        }

        $this->tellAdminsIfStandingChanged($tenantId, $wasClosed);

        return $this->respondWithData(['standing' => BillingStandingService::get($tenantId)]);
    }

    /**
     * The rule and whether "move up" may be chosen, as the Branch payments
     * row and the Billing control row carry them.
     *
     * @return array{over_limit: array<string, mixed>, upgrade_allowed: bool}
     */
    private function overLimitOf(int $tenantId): array
    {
        return [
            'over_limit' => OverLimitRule::describe($tenantId),
            'upgrade_allowed' => OverLimitRule::refusalFor($tenantId, 'upgrade') === null,
        ];
    }

    /**
     * `action` and `grace_days` from a request, both required (an explicit
     * null follows the default). An empty day count is null, as Laravel turns
     * an emptied field into null anyway.
     *
     * @param array<string, mixed> $input
     * @return array{action: ?string, grace_days: ?int}|JsonResponse
     */
    private function overLimitRuleInput(array $input): array|JsonResponse
    {
        $action = $input['action'] ?? null;
        if (!array_key_exists('action', $input) || !OverLimitRule::isValidAction($action)) {
            return $this->respondWithError('OVER_LIMIT_ACTION_INVALID', __('api.over_limit_action_invalid'), 'action', 422);
        }

        $days = $input['grace_days'] ?? null;
        if (!array_key_exists('grace_days', $input)) {
            return $this->respondWithError('OVER_LIMIT_DAYS_INVALID', __('api.over_limit_days_invalid'), 'grace_days', 422);
        }
        if ($days === '') {
            $days = null;
        }
        if ($days !== null) {
            $days = is_bool($days) ? false : filter_var($days, FILTER_VALIDATE_INT);
            if ($days === false || !OverLimitRule::isValidDays($days)) {
                return $this->respondWithError('OVER_LIMIT_DAYS_INVALID', __('api.over_limit_days_invalid'), 'grace_days', 422);
            }
        }

        return ['action' => $action, 'grace_days' => $days];
    }

    /** A refusal from setting an over-limit rule, as a translated 422. */
    private function overLimitRefusal(\DomainException $e): JsonResponse
    {
        return match ($e->getMessage()) {
            'over_limit_rule_not_allowed' => $this->respondWithError(OverLimitRule::RULE_NOT_ALLOWED, __('api.over_limit_rule_not_allowed'), 'action', 422),
            'over_limit_action_invalid' => $this->respondWithError('OVER_LIMIT_ACTION_INVALID', __('api.over_limit_action_invalid'), 'action', 422),
            'over_limit_days_invalid' => $this->respondWithError('OVER_LIMIT_DAYS_INVALID', __('api.over_limit_days_invalid'), 'grace_days', 422),
            default => $this->standingRefusal($e),
        };
    }

    /** The caller has decided the reader may write this payee's note. */
    private function saveHowToPay(int $payeeTenantId, int $userId): JsonResponse
    {
        $input = $this->getAllInput();
        // Only an explicit null (or an empty note) removes it. A request that
        // does not say `note` at all is a mistake, not an instruction.
        if (!array_key_exists('note', $input)) {
            return $this->respondWithError('HOW_TO_PAY_NOT_TEXT', __('api.billing_how_to_pay_not_text'), 'note', 422);
        }

        try {
            $note = HowToPay::set($payeeTenantId, $input['note'], $userId);
        } catch (\DomainException $e) {
            if ($e->getMessage() === HowToPay::TOO_LONG) {
                return $this->respondWithError('HOW_TO_PAY_TOO_LONG', __('api.billing_how_to_pay_too_long', ['max' => HowToPay::MAX]), 'note', 422);
            }
            if ($e->getMessage() === HowToPay::NOT_TEXT) {
                return $this->respondWithError('HOW_TO_PAY_NOT_TEXT', __('api.billing_how_to_pay_not_text'), 'note', 422);
            }
            throw $e;
        }

        return $this->respondWithData(['how_to_pay' => $note, 'how_to_pay_max' => HowToPay::MAX]);
    }

    private function communityIsClosed(int $tenantId): bool
    {
        try {
            // "Locked", not "has its own pause": what the community's admins
            // are told must match what its members see. A community whose own
            // pause is lifted while one above it is still paused is not open.
            return BillingStandingService::get($tenantId)['locked'];
        } catch (\DomainException) {
            // An unknown community: the action itself refuses it next.
            return false;
        }
    }

    /**
     * Mail the community's own admins when it has just been paused or just
     * been restored — and only then: pausing what is already paused tells
     * nobody again. Mail failing must never fail or undo the action, so a
     * failure here is logged and goes no further.
     */
    private function tellAdminsIfStandingChanged(int $tenantId, bool $wasClosed): void
    {
        try {
            $isClosed = $this->communityIsClosed($tenantId);
            if ($isClosed === $wasClosed) {
                return;
            }

            $isClosed
                ? BillingStandingNotifier::paused($tenantId)
                : BillingStandingNotifier::restored($tenantId);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('[billing] could not tell a community' . chr(39) . 's admins about its standing', [
                'tenant_id' => $tenantId,
                'error' => $e->getMessage(),
            ]);
        }
    }

    private function standingNote(mixed $value): ?string
    {
        return is_string($value) ? $value : null;
    }

    /**
     * A refusal from BillingStandingService, as a translated 422.
     *
     * The service names each refusal with a fixed code. An unknown one is a
     * programming error, not something to show a person: let it surface.
     */
    private function standingRefusal(\DomainException $e): JsonResponse
    {
        $messages = [
            'tenant_not_found' => ['api.tenant_not_found', 'tenant_id'],
            'platform_tenant_not_billable' => ['api.billing_standing_platform_tenant', 'tenant_id'],
            'community_is_exempt' => ['api.billing_standing_community_is_exempt', 'tenant_id'],
            'exempt_reason_required' => ['api.billing_standing_exempt_reason_required', 'reason'],
            'paid_until_invalid' => ['api.billing_standing_paid_until_invalid', 'paid_until'],
            'payment_paid_until_required' => ['api.billing_standing_payment_paid_until_required', 'paid_until'],
            'payment_paid_until_not_later' => ['api.billing_standing_payment_paid_until_not_later', 'paid_until'],
            'payment_received_on_invalid' => ['api.billing_standing_payment_received_on_invalid', 'received_on'],
            'payment_method_invalid' => ['api.billing_standing_payment_method_invalid', 'method'],
            'payment_amount_invalid' => ['api.billing_standing_payment_amount_invalid', 'amount'],
            'payment_currency_invalid' => ['api.billing_standing_payment_currency_invalid', 'currency'],
            'payment_not_found' => ['api.billing_standing_payment_not_found', 'payment_id'],
            'payment_card_not_voidable' => ['api.billing_standing_payment_card_not_voidable', 'payment_id'],
            'payment_already_voided' => ['api.billing_standing_payment_already_voided', 'payment_id'],
            'payment_void_reason_required' => ['api.billing_standing_payment_void_reason_required', 'reason'],
            'payer_invalid' => ['api.billing_standing_payer_invalid', 'payer'],
            'payer_needs_parent' => ['api.billing_standing_payer_needs_parent', 'payer'],
        ];

        $code = $e->getMessage();
        if (!isset($messages[$code])) {
            throw $e;
        }

        return $this->respondWithError(strtoupper($code), __($messages[$code][0]), $messages[$code][1], 422);
    }
}
