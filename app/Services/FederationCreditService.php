<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * FederationCreditService — Manages credit exchange agreements between federated tenants.
 *
 * Handles CRUD for federation_credit_agreements including exchange rates,
 * monthly credit limits, and approval workflows.
 */
class FederationCreditService
{
    /** @var array<string> */
    private array $errors = [];

    public function __construct()
    {
    }

    /**
     * Get accumulated errors from the last operation.
     */
    public function getErrors(): array
    {
        return $this->errors;
    }

    /**
     * Static proxy: list agreements for a tenant.
     */
    public static function listAgreementsStatic(int $tenantId): array
    {
        try {
            $rows = DB::select(
                "SELECT fca.*,
                        t1.name as from_tenant_name, t1.slug as from_tenant_slug,
                        t2.name as to_tenant_name, t2.slug as to_tenant_slug
                 FROM federation_credit_agreements fca
                 LEFT JOIN tenants t1 ON fca.from_tenant_id = t1.id
                 LEFT JOIN tenants t2 ON fca.to_tenant_id = t2.id
                 WHERE fca.from_tenant_id = ? OR fca.to_tenant_id = ?
                 ORDER BY fca.created_at DESC",
                [$tenantId, $tenantId]
            );

            return array_map(function ($row) use ($tenantId) {
                $fromId = (int) $row->from_tenant_id;
                $toId = (int) $row->to_tenant_id;

                // "The partner" is whichever side is NOT the caller. Until
                // November 2026 the list carried only from_/to_ names, and the
                // admin page picked to_tenant_name first — so an agreement
                // another community proposed showed the caller's OWN name as
                // the partner.
                $callerIsFrom = $fromId === $tenantId;
                $partnerId = $callerIsFrom ? $toId : $fromId;
                $partnerName = $callerIsFrom ? ($row->to_tenant_name ?? '') : ($row->from_tenant_name ?? '');
                $partnerSlug = $callerIsFrom ? ($row->to_tenant_slug ?? '') : ($row->from_tenant_slug ?? '');

                // Movement figures the list has always displayed but never
                // received (they rendered as a constant 0). A ledger failure
                // must not hide the agreement itself, so the figures degrade to
                // null — "unknown" — never to a made-up zero.
                $sent = null;
                $received = null;
                try {
                    $sent = FederationInternalLedgerService::sumCompletedBetweenTenants($tenantId, $partnerId);
                    $received = FederationInternalLedgerService::sumCompletedBetweenTenants($partnerId, $tenantId);
                } catch (\Throwable $e) {
                    Log::error('[FederationCredit] listAgreementsStatic ledger totals failed', [
                        'agreement_id' => (int) $row->id,
                        'error' => $e->getMessage(),
                    ]);
                    $sent = null;
                    $received = null;
                }

                // Dual consent: a pending agreement activates only when both
                // sides have approved. Say whose move it is, so the page does
                // not offer "Approve" to a side that already has.
                $callerApproved = ($callerIsFrom ? $row->approved_by_from : $row->approved_by_to) !== null;
                $awaiting = null;
                if ($row->status === 'pending') {
                    $awaiting = $callerApproved ? 'partner' : 'you';
                }

                return [
                    'id' => (int) $row->id,
                    'from_tenant_id' => $fromId,
                    'from_tenant_name' => $row->from_tenant_name ?? '',
                    'from_tenant_slug' => $row->from_tenant_slug ?? '',
                    'to_tenant_id' => $toId,
                    'to_tenant_name' => $row->to_tenant_name ?? '',
                    'to_tenant_slug' => $row->to_tenant_slug ?? '',
                    'partner_tenant' => ['id' => $partnerId, 'name' => $partnerName, 'slug' => $partnerSlug],
                    'exchange_rate' => (float) $row->exchange_rate,
                    'max_monthly_credits' => $row->max_monthly_credits !== null ? (float) $row->max_monthly_credits : null,
                    'credits_sent' => $sent,
                    'credits_received' => $received,
                    // Positive = the partner has sent us more than we sent them.
                    'current_balance' => ($sent !== null && $received !== null) ? $received - $sent : null,
                    'status' => $row->status,
                    'awaiting' => $awaiting,
                    'approved_by_from' => $row->approved_by_from ? (int) $row->approved_by_from : null,
                    'approved_by_to' => $row->approved_by_to ? (int) $row->approved_by_to : null,
                    'created_at' => $row->created_at,
                    'updated_at' => $row->updated_at,
                ];
            }, $rows);
        } catch (\Exception $e) {
            Log::error('[FederationCredit] listAgreementsStatic failed', ['error' => $e->getMessage()]);
            return [];
        }
    }

    /**
     * Create a new credit agreement (instance method).
     */
    public function createAgreement(int $fromTenantId, int $toTenantId, float $exchangeRate = 1.0, ?float $maxMonthlyCredits = null, int $approvedBy = 0): array
    {
        return self::createAgreementStatic($fromTenantId, $toTenantId, $exchangeRate, $maxMonthlyCredits, $approvedBy);
    }

    /**
     * Static proxy: create a credit agreement.
     */
    public static function createAgreementStatic(int $fromTenantId, int $toTenantId, float $exchangeRate = 1.0, ?float $maxMonthlyCredits = null, int $approvedBy = 0): array
    {
        if ($fromTenantId === $toTenantId) {
            return ['success' => false, 'error' => 'Cannot create agreement with the same tenant'];
        }

        // Check for existing agreement
        $existing = DB::selectOne(
            "SELECT id, status FROM federation_credit_agreements
             WHERE (from_tenant_id = ? AND to_tenant_id = ?) OR (from_tenant_id = ? AND to_tenant_id = ?)",
            [$fromTenantId, $toTenantId, $toTenantId, $fromTenantId]
        );

        if ($existing && in_array($existing->status, ['pending', 'active'], true)) {
            return ['success' => false, 'error' => 'Agreement already exists between these tenants'];
        }

        try {
            DB::insert(
                "INSERT INTO federation_credit_agreements (from_tenant_id, to_tenant_id, exchange_rate, max_monthly_credits, approved_by_from, status, created_at)
                 VALUES (?, ?, ?, ?, ?, 'pending', NOW())",
                [$fromTenantId, $toTenantId, $exchangeRate, $maxMonthlyCredits, $approvedBy ?: null]
            );

            $id = (int) DB::getPdo()->lastInsertId();

            Log::info('[FederationCredit] Agreement created', [
                'id' => $id,
                'from' => $fromTenantId,
                'to' => $toTenantId,
                'rate' => $exchangeRate,
            ]);

            return [
                'success' => true,
                'id' => $id,
                'from_tenant_id' => $fromTenantId,
                'to_tenant_id' => $toTenantId,
                'exchange_rate' => $exchangeRate,
                'max_monthly_credits' => $maxMonthlyCredits,
                'status' => 'pending',
            ];
        } catch (\Exception $e) {
            Log::error('[FederationCredit] createAgreement failed', ['error' => $e->getMessage()]);
            return ['success' => false, 'error' => 'Failed to create credit agreement'];
        }
    }

    /**
     * Approve a credit agreement.
     */
    public function approveAgreement(int $agreementId, int $approvedBy): array
    {
        $this->errors = [];

        try {
            $agreement = DB::selectOne(
                "SELECT * FROM federation_credit_agreements WHERE id = ? AND status = 'pending'",
                [$agreementId]
            );

            if (!$agreement) {
                $this->errors[] = 'Agreement not found or not in pending status';
                return ['success' => false, 'error' => 'Agreement not found or not pending'];
            }

            // Verify current tenant is a party to this agreement
            $tenantId = TenantContext::getId();
            if ((int) $agreement->from_tenant_id !== $tenantId && (int) $agreement->to_tenant_id !== $tenantId) {
                $this->errors[] = 'Unauthorized: tenant is not party to this agreement';
                return ['success' => false, 'error' => 'Unauthorized: tenant is not party to this agreement'];
            }

            // Record this party's approval in the correct column.
            $isFromTenant = ((int) $agreement->from_tenant_id === $tenantId);
            $approverColumn = $isFromTenant ? 'approved_by_from' : 'approved_by_to';

            // Record approval for the approving party without yet activating.
            // WHERE status = 'pending' AND {approverColumn} IS NULL guards against
            // TOCTOU: if the agreement was suspended or already approved between
            // the SELECT above and this UPDATE, 0 rows will be affected.
            $rowsAffected = DB::update(
                "UPDATE federation_credit_agreements SET {$approverColumn} = ?, updated_at = NOW() WHERE id = ? AND status = 'pending' AND {$approverColumn} IS NULL",
                [$approvedBy, $agreementId]
            );

            if ($rowsAffected === 0) {
                // Another request already recorded approval, or the agreement was
                // suspended/activated between the read and write. Reload and report.
                $current = DB::selectOne(
                    "SELECT status FROM federation_credit_agreements WHERE id = ?",
                    [$agreementId]
                );
                $currentStatus = $current->status ?? 'unknown';

                if ($currentStatus !== 'pending') {
                    $this->errors[] = "Agreement is no longer pending (current status: {$currentStatus})";
                    return ['success' => false, 'error' => "Agreement is no longer pending (current status: {$currentStatus})"];
                }

                // Same party trying to approve twice — idempotent, continue to reload
            }

            // Reload to check whether both parties have now approved.
            // Use FOR UPDATE to lock the row for the activation step, preventing
            // two simultaneous approvals from both activating the agreement.
            $updated = DB::selectOne(
                "SELECT approved_by_from, approved_by_to, status FROM federation_credit_agreements WHERE id = ? FOR UPDATE",
                [$agreementId]
            );

            $bothApproved = $updated
                && $updated->approved_by_from !== null
                && $updated->approved_by_to !== null
                && $updated->status === 'pending';

            if ($bothApproved) {
                DB::update(
                    "UPDATE federation_credit_agreements SET status = 'active', updated_at = NOW() WHERE id = ? AND status = 'pending'",
                    [$agreementId]
                );
                Log::info('[FederationCredit] Agreement fully approved — both parties consented', ['id' => $agreementId]);
                return ['success' => true, 'id' => $agreementId, 'status' => 'active'];
            }

            // Only one side has approved; keep status as 'pending' until the other party approves.
            Log::info('[FederationCredit] Agreement partially approved — awaiting other party', ['id' => $agreementId, 'by' => $approvedBy]);
            return ['success' => true, 'id' => $agreementId, 'status' => 'pending'];
        } catch (\Exception $e) {
            Log::error('[FederationCredit] approveAgreement failed', ['error' => $e->getMessage()]);
            $this->errors[] = 'Failed to approve agreement';
            return ['success' => false, 'error' => 'Failed to approve agreement'];
        }
    }

    /**
     * Update agreement status (suspend, terminate, activate).
     */
    public function updateAgreementStatus(int $agreementId, string $status): array
    {
        $this->errors = [];
        $validStatuses = ['active', 'suspended', 'terminated'];

        if (!in_array($status, $validStatuses, true)) {
            $this->errors[] = 'Invalid status';
            return ['success' => false, 'error' => 'Invalid status. Must be one of: ' . implode(', ', $validStatuses)];
        }

        try {
            // Verify current tenant is a party to this agreement
            $agreement = DB::selectOne(
                "SELECT * FROM federation_credit_agreements WHERE id = ?",
                [$agreementId]
            );

            if (!$agreement) {
                $this->errors[] = 'Agreement not found';
                return ['success' => false, 'error' => 'Agreement not found'];
            }

            $tenantId = TenantContext::getId();
            if ((int) $agreement->from_tenant_id !== $tenantId && (int) $agreement->to_tenant_id !== $tenantId) {
                $this->errors[] = 'Unauthorized: tenant is not party to this agreement';
                return ['success' => false, 'error' => 'Unauthorized: tenant is not party to this agreement'];
            }

            // Re-assert tenant membership in the UPDATE itself — the SELECT
            // above checked ownership, but between check and update the row
            // could be changed. Belt-and-suspenders: the UPDATE will only fire
            // if the current tenant is still a party to the agreement.
            $updated = DB::update(
                "UPDATE federation_credit_agreements
                    SET status = ?, updated_at = NOW()
                  WHERE id = ? AND (from_tenant_id = ? OR to_tenant_id = ?)",
                [$status, $agreementId, $tenantId, $tenantId]
            );

            if ($updated === 0) {
                $this->errors[] = 'Agreement not found';
                return ['success' => false, 'error' => 'Agreement not found'];
            }

            Log::info('[FederationCredit] Agreement status updated', ['id' => $agreementId, 'status' => $status]);

            return ['success' => true, 'id' => $agreementId, 'status' => $status];
        } catch (\Exception $e) {
            Log::error('[FederationCredit] updateAgreementStatus failed', ['error' => $e->getMessage()]);
            $this->errors[] = 'Failed to update agreement status';
            return ['success' => false, 'error' => 'Failed to update agreement status'];
        }
    }

    /**
     * Get the agreement between two tenants.
     */
    public function getAgreement(int $tenantA, int $tenantB): ?array
    {
        try {
            $row = DB::selectOne(
                "SELECT fca.*,
                        t1.name as from_tenant_name, t2.name as to_tenant_name
                 FROM federation_credit_agreements fca
                 LEFT JOIN tenants t1 ON fca.from_tenant_id = t1.id
                 LEFT JOIN tenants t2 ON fca.to_tenant_id = t2.id
                 WHERE (fca.from_tenant_id = ? AND fca.to_tenant_id = ?)
                    OR (fca.from_tenant_id = ? AND fca.to_tenant_id = ?)",
                [$tenantA, $tenantB, $tenantB, $tenantA]
            );

            if (!$row) {
                return null;
            }

            return [
                'id' => (int) $row->id,
                'from_tenant_id' => (int) $row->from_tenant_id,
                'from_tenant_name' => $row->from_tenant_name ?? '',
                'to_tenant_id' => (int) $row->to_tenant_id,
                'to_tenant_name' => $row->to_tenant_name ?? '',
                'exchange_rate' => (float) $row->exchange_rate,
                'max_monthly_credits' => $row->max_monthly_credits !== null ? (float) $row->max_monthly_credits : null,
                'status' => $row->status,
                'created_at' => $row->created_at,
                'updated_at' => $row->updated_at,
            ];
        } catch (\Exception $e) {
            Log::error('[FederationCredit] getAgreement failed', ['error' => $e->getMessage()]);
            return null;
        }
    }
}
