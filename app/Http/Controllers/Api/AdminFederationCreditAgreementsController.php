<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\I18n\LocaleContext;
use App\Models\Notification;
use App\Services\FederationAuditService;
use App\Services\FederationInternalLedgerService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * AdminFederationCreditAgreementsController -- Federation credit agreement management.
 *
 * Handles CRUD for federation credit agreements between partner tenants
 * and lists active federation partners.
 */
class AdminFederationCreditAgreementsController extends BaseApiController
{
    protected bool $isV2Api = true;

    /**
     * GET /api/v2/admin/federation/credit-agreements
     *
     * List credit agreements for the current tenant.
     */
    public function index(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        if (class_exists(\App\Services\FederationCreditService::class)) {
            try {
                $agreements = \App\Services\FederationCreditService::listAgreementsStatic($tenantId);
                return $this->respondWithData($agreements);
            } catch (\Exception $e) {
                return $this->respondWithError('FETCH_FAILED', __('api.credit_agreements_fetch_failed'), null, 500);
            }
        }

        return $this->respondWithError('SERVICE_UNAVAILABLE', __('api.federation_credit_unavailable'), null, 503);
    }

    /**
     * POST /api/v2/admin/federation/credit-agreements
     *
     * Create a new credit agreement with a partner tenant.
     */
    public function store(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $input = $this->getAllInput();

        $partnerTenantId = (int) ($input['partner_tenant_id'] ?? 0);
        $exchangeRate = (float) ($input['exchange_rate'] ?? 0);
        $monthlyLimit = (float) ($input['monthly_limit'] ?? 0);

        if ($partnerTenantId <= 0) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.partner_tenant_required'), 'partner_tenant_id');
        }
        if ($partnerTenantId === $tenantId) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.cannot_agree_with_self'), 'partner_tenant_id');
        }
        if ($exchangeRate <= 0) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.exchange_rate_gt_zero'), 'exchange_rate');
        }
        if ($monthlyLimit <= 0) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.monthly_limit_gt_zero'), 'monthly_limit');
        }

        if (class_exists(\App\Services\FederationCreditService::class)) {
            try {
                $agreement = \App\Services\FederationCreditService::createAgreementStatic(
                    $tenantId,
                    $partnerTenantId,
                    $exchangeRate,
                    $monthlyLimit,
                    $adminId
                );

                try {
                    FederationAuditService::log(
                        'credit_agreement_created',
                        $tenantId,
                        $partnerTenantId,
                        $adminId,
                        ['exchange_rate' => $exchangeRate, 'monthly_limit' => $monthlyLimit]
                    );
                } catch (\Exception $e) {
                    // Audit logging failure should not block the operation
                }

                return $this->respondWithData($agreement, null, 201);
            } catch (\Exception $e) {
                Log::warning(__('api.credit_agreement_create_failed'), ['error' => $e->getMessage()]);
                return $this->respondWithError('CREATE_FAILED', __('api.credit_agreement_create_failed'), null, 500);
            }
        }

        return $this->respondWithError('SERVICE_UNAVAILABLE', __('api.federation_credit_unavailable'), null, 503);
    }

    /**
     * POST /api/v2/admin/federation/credit-agreements/{id}/{action}
     *
     * Approve, reject, suspend, or activate a credit agreement.
     */
    public function action(int $id, string $action): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $validActions = ['approve', 'reject', 'suspend', 'activate', 'reactivate', 'terminate'];
        if (!in_array($action, $validActions, true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_action', ['actions' => implode(', ', $validActions)]), 'action');
        }

        try {
            // Fetch agreement first so we can determine the partner tenant for notifications
            $agreement = DB::selectOne(
                "SELECT * FROM federation_credit_agreements WHERE id = ? AND (from_tenant_id = ? OR to_tenant_id = ?)",
                [$id, $tenantId, $tenantId]
            );

            if (!$agreement) {
                return $this->respondWithError('NOT_FOUND', __('api.credit_agreement_not_found'), null, 404);
            }

            $partnerTenantId = ((int) $agreement->from_tenant_id === $tenantId)
                ? (int) $agreement->to_tenant_id
                : (int) $agreement->from_tenant_id;

            // F-173: only the tenant that suspended a credit agreement may bring it
            // back to active. Mirrors the partnership reactivation rule. The table
            // has no suspended_by column, so the suspender is derived from the
            // federation audit log — the source_tenant_id of the most recent
            // 'credit_agreement_suspend' entry for this agreement. When no suspend
            // record exists (a legacy suspension, or one caused by partnership
            // termination), the check falls through to the existing behaviour,
            // matching how the partnership rule treats a NULL suspender.
            if (in_array($action, ['activate', 'reactivate'], true)
                && (string) ($agreement->status ?? '') === 'suspended') {
                $lastSuspend = DB::table('federation_audit_log')
                    ->where('action_type', 'credit_agreement_suspend')
                    ->whereRaw("JSON_EXTRACT(data, '$.agreement_id') = ?", [$id])
                    ->orderByDesc('id')
                    ->first();
                if ($lastSuspend !== null && (int) ($lastSuspend->source_tenant_id ?? 0) !== $tenantId) {
                    return $this->respondWithError('SUSPENDER_ONLY', __('api.credit_agreement_invalid_transition'), null, 409);
                }
            }

            if ($action === 'approve') {
                // Dual consent: 'approve' only records THIS party's consent —
                // FederationCreditService::approveAgreement() activates the
                // agreement only once BOTH from/to sides have approved (with
                // TOCTOU guards and a row lock on the activation step). The
                // creating tenant can therefore never self-activate.
                //
                // Activation also requires a live, consented partnership between
                // the two tenants — an agreement must not outrank the partnership.
                $partnership = app(\App\Services\FederationPartnershipService::class)
                    ->getPartnership($tenantId, $partnerTenantId);
                if (!$partnership || ($partnership['status'] ?? null) !== 'active') {
                    return $this->respondWithError('PARTNERSHIP_REQUIRED', __('api.credit_agreement_partnership_required'), null, 409);
                }

                $result = (new \App\Services\FederationCreditService())->approveAgreement($id, $adminId);
                if (!($result['success'] ?? false)) {
                    return $this->respondWithError('INVALID_TRANSITION', __('api.credit_agreement_invalid_transition'), null, 409);
                }
                $newStatus = (string) ($result['status'] ?? 'pending');
            } else {
                // State machine: legal transitions only. No resurrecting a
                // terminated agreement, and no direct 'activate' of a pending
                // one (that path requires the dual approval above).
                $transitions = [
                    'reject'     => ['from' => ['pending'], 'to' => 'terminated'],
                    'suspend'    => ['from' => ['active'], 'to' => 'suspended'],
                    'activate'   => ['from' => ['suspended'], 'to' => 'active'],
                    'reactivate' => ['from' => ['suspended'], 'to' => 'active'],
                    'terminate'  => ['from' => ['pending', 'active', 'suspended'], 'to' => 'terminated'],
                ];
                $transition = $transitions[$action];
                $placeholders = implode(',', array_fill(0, count($transition['from']), '?'));

                $updated = DB::update(
                    "UPDATE federation_credit_agreements SET status = ?, updated_at = NOW()
                     WHERE id = ? AND (from_tenant_id = ? OR to_tenant_id = ?) AND status IN ({$placeholders})",
                    array_merge([$transition['to'], $id, $tenantId, $tenantId], $transition['from'])
                );

                if ($updated === 0) {
                    return $this->respondWithError('INVALID_TRANSITION', __('api.credit_agreement_invalid_transition'), null, 409);
                }
                $newStatus = $transition['to'];
            }

            try {
                FederationAuditService::log(
                    'credit_agreement_' . $action,
                    $tenantId,
                    null,
                    $adminId,
                    ['agreement_id' => $id, 'new_status' => $newStatus]
                );
            } catch (\Exception $e) {
                // Audit logging failure should not block the operation
            }

            // Notify partner tenant admins about the status change
            try {
                $tenantName = 'A partner community';
                try {
                    $tenant = DB::selectOne("SELECT name FROM tenants WHERE id = ?", [$tenantId]);
                    if ($tenant) {
                        $tenantName = $tenant->name;
                    }
                } catch (\Exception $e) {
                    // Use fallback name
                }

                $actionLabels = [
                    'approve'    => 'federation.credit_agreement.action_approved',
                    'reject'     => 'federation.credit_agreement.action_rejected',
                    'suspend'    => 'federation.credit_agreement.action_suspended',
                    'activate'   => 'federation.credit_agreement.action_activated',
                    'reactivate' => 'federation.credit_agreement.action_reactivated',
                    'terminate'  => 'federation.credit_agreement.action_terminated',
                ];

                $admins = DB::select(
                    "SELECT id, preferred_language FROM users WHERE tenant_id = ? AND role IN ('admin', 'tenant_admin') AND status = 'active'",
                    [$partnerTenantId]
                );
                foreach ($admins as $admin) {
                    LocaleContext::withLocale($admin, function () use ($admin, $partnerTenantId, $tenantName, $actionLabels, $action): void {
                        $label = isset($actionLabels[$action]) ? __($actionLabels[$action]) : $action;
                        $message = __('api_controllers_3.federation_credit.action_taken', ['tenant' => $tenantName, 'action' => $label]);
                        Notification::createNotification(
                            (int) $admin->id,
                            $message,
                            '/admin/federation',
                            'federation_credit_agreement_' . $action,
                            true,
                            $partnerTenantId
                        );
                        \App\Services\NotificationDispatcher::fanOutPush((int) $admin->id, 'federation_credit_agreement_' . $action, $message, '/admin/federation');
                    });
                }
            } catch (\Exception $e) {
                Log::warning('[FederationCreditAgreement] Failed to notify partner admins', [
                    'agreement_id' => $id,
                    'action' => $action,
                    'error' => $e->getMessage(),
                ]);
            }

            return $this->respondWithData(['success' => true, 'status' => $newStatus]);
        } catch (\Exception $e) {
            return $this->respondWithError('UPDATE_FAILED', __('api.credit_agreement_update_failed'), null, 500);
        }
    }

    /**
     * GET /api/v2/admin/federation/credit-agreements/{id}/transactions
     *
     * List recent transactions for a specific credit agreement.
     */
    public function transactions(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        try {
            // Verify agreement belongs to this tenant
            $agreement = DB::selectOne(
                "SELECT * FROM federation_credit_agreements WHERE id = ? AND (from_tenant_id = ? OR to_tenant_id = ?)",
                [$id, $tenantId, $tenantId]
            );

            if (!$agreement) {
                return $this->respondWithError('NOT_FOUND', __('api.credit_agreement_not_found'), null, 404);
            }

            $fromId = (int) $agreement->from_tenant_id;
            $toId = (int) $agreement->to_tenant_id;

            try {
                $transactions = FederationInternalLedgerService::recentBetweenTenants($fromId, $toId, 50);

                // Calculate usage this month
                $monthStart = date('Y-m-01 00:00:00');
                $monthUsage = FederationInternalLedgerService::sumCompletedBetweenTenants($fromId, $toId, $monthStart)
                    + FederationInternalLedgerService::sumCompletedBetweenTenants($toId, $fromId, $monthStart);

                return $this->respondWithData([
                    'transactions' => $transactions,
                    'month_usage' => (float) $monthUsage,
                    'monthly_limit' => $agreement->max_monthly_credits !== null ? (float) $agreement->max_monthly_credits : null,
                ]);
            } catch (\Exception $e) {
                return $this->respondWithData([
                    'transactions' => [],
                    'month_usage' => 0,
                    'monthly_limit' => $agreement->max_monthly_credits !== null ? (float) $agreement->max_monthly_credits : null,
                ]);
            }
        } catch (\Exception $e) {
            return $this->respondWithError('FETCH_FAILED', __('api.transactions_fetch_failed'), null, 500);
        }
    }

    /**
     * GET /api/v2/admin/federation/credit-balances
     *
     * Net credit balance per partner and overall.
     */
    public function balances(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        try {
            $agreements = DB::select(
                "SELECT fca.id, fca.from_tenant_id, fca.to_tenant_id, fca.status,
                        fca.exchange_rate, fca.max_monthly_credits,
                        t1.name as from_tenant_name, t2.name as to_tenant_name
                 FROM federation_credit_agreements fca
                 LEFT JOIN tenants t1 ON fca.from_tenant_id = t1.id
                 LEFT JOIN tenants t2 ON fca.to_tenant_id = t2.id
                 WHERE (fca.from_tenant_id = ? OR fca.to_tenant_id = ?) AND fca.status = 'active'",
                [$tenantId, $tenantId]
            );

            $balances = [];
            $netTotal = 0.0;

            foreach ($agreements as $agreement) {
                $fromId = (int) $agreement->from_tenant_id;
                $toId = (int) $agreement->to_tenant_id;
                $isFrom = $fromId === $tenantId;
                $partnerName = $isFrom ? $agreement->to_tenant_name : $agreement->from_tenant_name;
                $partnerId = $isFrom ? $toId : $fromId;

                // Calculate net balance: positive = they owe us, negative = we owe them
                $sent = 0.0;
                $received = 0.0;

                $sent = FederationInternalLedgerService::sumCompletedBetweenTenants($tenantId, $partnerId);
                $received = FederationInternalLedgerService::sumCompletedBetweenTenants($partnerId, $tenantId);

                $balance = $received - $sent; // positive = they sent us more than we sent them
                $netTotal += $balance;

                $balances[] = [
                    'agreement_id' => (int) $agreement->id,
                    'partner_tenant_id' => $partnerId,
                    'partner_name' => $partnerName ?? '',
                    'credits_sent' => $sent,
                    'credits_received' => $received,
                    'net_balance' => $balance,
                ];
            }

            return $this->respondWithData([
                'balances' => $balances,
                'net_total' => $netTotal,
            ]);
        } catch (\Exception $e) {
            return $this->respondWithData(['balances' => [], 'net_total' => 0]);
        }
    }

    /**
     * GET /api/v2/admin/federation/partners
     *
     * List active federation partners for the current tenant.
     */
    public function partners(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        try {
            $partners = DB::select(
                "SELECT fp.*, t.name as partner_name, t.slug as partner_slug
                 FROM federation_partnerships fp
                 JOIN tenants t ON (CASE WHEN fp.tenant_id = ? THEN fp.partner_tenant_id ELSE fp.tenant_id END) = t.id
                 WHERE (fp.tenant_id = ? OR fp.partner_tenant_id = ?) AND fp.status = 'active'",
                [$tenantId, $tenantId, $tenantId]
            );

            return $this->respondWithData(array_map(fn($r) => (array) $r, $partners));
        } catch (\Exception $e) {
            // Table may not exist yet — return empty array gracefully
            return $this->respondWithData([]);
        }
    }
}
