<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Events\VolLogStatusChanged;
use App\Services\CaringCommunity\CaringRegionalPointService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use App\Support\UserDisplayName;

/**
 * Aggregates KISS-style coordinator workflow signals for caring communities.
 */
class CaringCommunityWorkflowService
{
    public function __construct(
        private readonly CaringCommunityRolePresetService $rolePresetService,
        private readonly CaringCommunityWorkflowPolicyService $policyService,
        private readonly CaringRegionalPointService $regionalPointService,
    ) {
    }

    public function summary(int $tenantId): array
    {
        $policy = $this->policyService->get($tenantId);

        return [
            'stats' => $this->stats($tenantId, $policy),
            'pending_reviews' => $this->pendingReviews($tenantId, $policy),
            'recent_decisions' => $this->recentDecisions($tenantId),
            'coordinator_signals' => $this->coordinatorSignals($tenantId),
            'coordinators' => $this->coordinators($tenantId),
            'role_pack' => $this->rolePresetService->status($tenantId),
            'policy' => $policy,
        ];
    }

    public function assignReview(int $tenantId, int $logId, ?int $assigneeId): ?array
    {
        if (!Schema::hasTable('vol_logs') || !Schema::hasColumn('vol_logs', 'assigned_to')) {
            return null;
        }

        if ($assigneeId !== null && !$this->isCoordinator($tenantId, $assigneeId)) {
            return null;
        }

        $updated = DB::table('vol_logs')
            ->where('tenant_id', $tenantId)
            ->where('id', $logId)
            ->where('status', 'pending')
            ->update([
                'assigned_to' => $assigneeId,
                'assigned_at' => $assigneeId === null ? null : now(),
                'updated_at' => now(),
            ]);

        return $updated > 0 ? $this->reviewById($tenantId, $logId, $this->policyService->get($tenantId)) : null;
    }

    public function escalateReview(int $tenantId, int $logId, string $note = ''): ?array
    {
        if (!Schema::hasTable('vol_logs') || !Schema::hasColumn('vol_logs', 'escalated_at')) {
            return null;
        }

        $updated = DB::table('vol_logs')
            ->where('tenant_id', $tenantId)
            ->where('id', $logId)
            ->where('status', 'pending')
            ->update([
                'escalated_at' => now(),
                'escalation_note' => trim($note) === '' ? null : mb_substr(trim($note), 0, 1000),
                'updated_at' => now(),
            ]);

        return $updated > 0 ? $this->reviewById($tenantId, $logId, $this->policyService->get($tenantId)) : null;
    }

    public function decideReview(int $tenantId, int $logId, int $reviewerId, string $action): ?array
    {
        if (!Schema::hasTable('vol_logs') || !in_array($action, ['approve', 'decline'], true)) {
            return null;
        }

        $status = $action === 'approve' ? 'approved' : 'declined';
        $paymentResult = null;
        $regionalPointsResult = null;
        $log = null;
        $aborted = false;

        DB::transaction(function () use ($tenantId, $logId, $reviewerId, $status, $action, &$paymentResult, &$log, &$aborted): void {
            // Lock the row for the duration of the transaction so two
            // concurrent approve/decline requests can't both pass the
            // status==='pending' guard before either has committed.
            $locked = DB::table('vol_logs')
                ->where('tenant_id', $tenantId)
                ->where('id', $logId)
                ->lockForUpdate()
                ->first();

            if (!$locked || (string) $locked->status !== 'pending' || (int) $locked->user_id === $reviewerId) {
                $aborted = true;
                return;
            }
            $log = $locked;

            DB::table('vol_logs')
                ->where('tenant_id', $tenantId)
                ->where('id', $logId)
                ->where('status', 'pending')
                ->update([
                    'status' => $status,
                    'updated_at' => now(),
                ]);

            if ($action !== 'approve' || empty($log->organization_id) || !Schema::hasTable('vol_organizations')) {
                return;
            }

            $org = DB::table('vol_organizations')
                ->where('tenant_id', $tenantId)
                ->where('id', (int) $log->organization_id)
                ->first();
            // Approval ALWAYS mints time credits — never gated by the org's
            // auto_pay_enabled flag or wallet balance, mirroring
            // VolunteerService::applyVolunteerAutoPayment. The org wallet is a
            // reconciliation figure that may go negative, not a spending switch;
            // a carer who sees 'approved' has been credited. (Regional points, if
            // the tenant enabled them, are an additive reward — not a replacement.)
            if (!$org) {
                return;
            }

            $paymentResult = $this->applyOrganizationPayment(
                $tenantId,
                (int) $org->id,
                (int) $org->user_id,
                (int) $log->user_id,
                $logId,
                (float) $log->hours,
            );
        });

        if ($aborted || $log === null) {
            return null;
        }

        if ($action === 'approve') {
            try {
                $regionalPointsResult = $this->regionalPointService->awardForApprovedHours(
                    $tenantId,
                    (int) $log->user_id,
                    $logId,
                    (float) $log->hours,
                    $reviewerId
                );
            } catch (\Throwable) {
                $regionalPointsResult = null;
            }
        }

        // Notify the regional-points cascade-revert listener that a vol_log
        // changed status. The listener is a no-op except when the previous
        // status was `approved` and points were auto-issued.
        try {
            VolLogStatusChanged::dispatch(
                $tenantId,
                $logId,
                (string) $log->status,
                $status,
            );
        } catch (\Throwable) {
            // Event dispatch failure must not break the parent flow.
        }

        return [
            'id' => $logId,
            'status' => $status,
            'payment_result' => $paymentResult,
            'regional_points_result' => $regionalPointsResult,
            'summary' => $this->summary($tenantId),
        ];
    }

    private function stats(int $tenantId, array $policy): array
    {
        if (!Schema::hasTable('vol_logs')) {
            return [
                'pending_count' => 0,
                'pending_hours' => 0.0,
                'overdue_count' => 0,
                'escalated_count' => 0,
                'approved_30d_hours' => 0.0,
                'declined_30d_count' => 0,
                'coordinator_count' => $this->coordinatorCount($tenantId),
                'intergenerational_tandem_count' => $this->intergenerationalTandemCount($tenantId),
            ];
        }

        $reviewSlaDays = (int) ($policy['review_sla_days'] ?? 7);
        $escalationSlaDays = (int) ($policy['escalation_sla_days'] ?? 14);
        $escalatedExpression = Schema::hasColumn('vol_logs', 'escalated_at')
            ? "status = 'pending' AND (escalated_at IS NOT NULL OR created_at < DATE_SUB(NOW(), INTERVAL ? DAY))"
            : "status = 'pending' AND created_at < DATE_SUB(NOW(), INTERVAL ? DAY)";

        $row = DB::selectOne(
            "SELECT
                COUNT(CASE WHEN status = 'pending' THEN 1 END) AS pending_count,
                COALESCE(SUM(CASE WHEN status = 'pending' THEN hours ELSE 0 END), 0) AS pending_hours,
                COUNT(CASE WHEN status = 'pending' AND created_at < DATE_SUB(NOW(), INTERVAL ? DAY) THEN 1 END) AS overdue_count,
                COUNT(CASE WHEN {$escalatedExpression} THEN 1 END) AS escalated_count,
                COALESCE(SUM(CASE WHEN status = 'approved' AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN hours ELSE 0 END), 0) AS approved_30d_hours,
                COUNT(CASE WHEN status = 'declined' AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 END) AS declined_30d_count
             FROM vol_logs
             WHERE tenant_id = ?",
            [$reviewSlaDays, $escalationSlaDays, $tenantId]
        );

        return [
            'pending_count' => (int) ($row->pending_count ?? 0),
            'pending_hours' => round((float) ($row->pending_hours ?? 0), 1),
            'overdue_count' => (int) ($row->overdue_count ?? 0),
            'escalated_count' => (int) ($row->escalated_count ?? 0),
            'approved_30d_hours' => round((float) ($row->approved_30d_hours ?? 0), 1),
            'declined_30d_count' => (int) ($row->declined_30d_count ?? 0),
            'coordinator_count' => $this->coordinatorCount($tenantId),
            'intergenerational_tandem_count' => $this->intergenerationalTandemCount($tenantId),
        ];
    }

    /**
     * Count active support relationships where supporter and recipient have
     * a date of birth and their age difference is >= 25 years.  KISS's
     * hallmark is connecting old and young — this metric makes that visible.
     */
    public function intergenerationalTandemCount(int $tenantId): int
    {
        if (!Schema::hasTable('caring_support_relationships') || !Schema::hasTable('users')) {
            return 0;
        }
        if (!Schema::hasColumn('users', 'date_of_birth')) {
            return 0;
        }

        $row = DB::selectOne(
            "SELECT COUNT(*) AS cnt
             FROM caring_support_relationships csr
             JOIN users sup ON sup.id = csr.supporter_id AND sup.tenant_id = csr.tenant_id
             JOIN users rec ON rec.id = csr.recipient_id AND rec.tenant_id = csr.tenant_id
             WHERE csr.tenant_id = ?
               AND csr.status = 'active'
               AND sup.date_of_birth IS NOT NULL
               AND rec.date_of_birth IS NOT NULL
               AND ABS(TIMESTAMPDIFF(YEAR, sup.date_of_birth, rec.date_of_birth)) >= ?",
            [$tenantId, \App\Services\CaringTandemMatchingService::INTERGENERATIONAL_MIN_AGE_DIFF]
        );

        return (int) ($row->cnt ?? 0);
    }

    private function pendingReviews(int $tenantId, array $policy): array
    {
        if (!Schema::hasTable('vol_logs')) {
            return [];
        }

        $reviewSlaDays = (int) ($policy['review_sla_days'] ?? 7);
        $escalationSlaDays = (int) ($policy['escalation_sla_days'] ?? 14);
        $hasAssignmentColumns = Schema::hasColumn('vol_logs', 'assigned_to');
        $hasEscalationColumns = Schema::hasColumn('vol_logs', 'escalated_at');

        $rows = DB::select(
            "SELECT
                vl.id,
                vl.hours,
                vl.date_logged,
                vl.created_at,
                vl.description,
                " . ($hasAssignmentColumns ? 'vl.assigned_to, vl.assigned_at,' : 'NULL AS assigned_to, NULL AS assigned_at,') . "
                " . ($hasEscalationColumns ? 'vl.escalated_at, vl.escalation_note,' : 'NULL AS escalated_at, NULL AS escalation_note,') . "
                u.name AS member_name,
                u.first_name,
                u.last_name,
                u.profile_type,
                u.organization_name,
                assigned.name AS assigned_name,
                vo.name AS organisation_name,
                opp.title AS opportunity_title
             FROM vol_logs vl
             LEFT JOIN users u ON u.id = vl.user_id AND u.tenant_id = vl.tenant_id
             " . ($hasAssignmentColumns ? 'LEFT JOIN users assigned ON assigned.id = vl.assigned_to AND assigned.tenant_id = vl.tenant_id' : 'LEFT JOIN users assigned ON 1 = 0') . "
             LEFT JOIN vol_organizations vo ON vo.id = vl.organization_id AND vo.tenant_id = vl.tenant_id
             LEFT JOIN vol_opportunities opp ON opp.id = vl.opportunity_id AND opp.tenant_id = vl.tenant_id
             WHERE vl.tenant_id = ? AND vl.status = 'pending'
             ORDER BY vl.created_at ASC, vl.id ASC
             LIMIT 12",
            [$tenantId]
        );

        return array_map(function ($row) use ($reviewSlaDays, $escalationSlaDays) {
            return $this->formatReviewRow($row, $reviewSlaDays, $escalationSlaDays);
        }, $rows);
    }

    private function reviewById(int $tenantId, int $logId, array $policy): ?array
    {
        $reviewSlaDays = (int) ($policy['review_sla_days'] ?? 7);
        $escalationSlaDays = (int) ($policy['escalation_sla_days'] ?? 14);
        $hasAssignmentColumns = Schema::hasColumn('vol_logs', 'assigned_to');
        $hasEscalationColumns = Schema::hasColumn('vol_logs', 'escalated_at');

        $row = DB::selectOne(
            "SELECT
                vl.id,
                vl.hours,
                vl.date_logged,
                vl.created_at,
                vl.description,
                " . ($hasAssignmentColumns ? 'vl.assigned_to, vl.assigned_at,' : 'NULL AS assigned_to, NULL AS assigned_at,') . "
                " . ($hasEscalationColumns ? 'vl.escalated_at, vl.escalation_note,' : 'NULL AS escalated_at, NULL AS escalation_note,') . "
                u.name AS member_name,
                u.first_name,
                u.last_name,
                u.profile_type,
                u.organization_name,
                assigned.name AS assigned_name,
                vo.name AS organisation_name,
                opp.title AS opportunity_title
             FROM vol_logs vl
             LEFT JOIN users u ON u.id = vl.user_id AND u.tenant_id = vl.tenant_id
             " . ($hasAssignmentColumns ? 'LEFT JOIN users assigned ON assigned.id = vl.assigned_to AND assigned.tenant_id = vl.tenant_id' : 'LEFT JOIN users assigned ON 1 = 0') . "
             LEFT JOIN vol_organizations vo ON vo.id = vl.organization_id AND vo.tenant_id = vl.tenant_id
             LEFT JOIN vol_opportunities opp ON opp.id = vl.opportunity_id AND opp.tenant_id = vl.tenant_id
             WHERE vl.tenant_id = ? AND vl.id = ? AND vl.status = 'pending'",
            [$tenantId, $logId]
        );

        return $row ? $this->formatReviewRow($row, $reviewSlaDays, $escalationSlaDays) : null;
    }

    private function formatReviewRow(object $row, int $reviewSlaDays, int $escalationSlaDays): array
    {
            $fullName = UserDisplayName::resolve($row);
            $createdAt = strtotime((string) $row->created_at) ?: time();
            $ageDays = max(0, (int) floor((time() - $createdAt) / 86400));
            return [
                'id' => (int) $row->id,
                'member_name' => $fullName !== '' ? $fullName : (string) ($row->member_name ?? ''),
                'organisation_name' => (string) ($row->organisation_name ?? ''),
                'opportunity_title' => (string) ($row->opportunity_title ?? ''),
                'assigned_to' => $row->assigned_to === null ? null : (int) $row->assigned_to,
                'assigned_name' => $row->assigned_name === null ? null : (string) $row->assigned_name,
                'assigned_at' => $row->assigned_at === null ? null : (string) $row->assigned_at,
                'escalated_at' => $row->escalated_at === null ? null : (string) $row->escalated_at,
                'escalation_note' => $row->escalation_note === null ? null : (string) $row->escalation_note,
                'hours' => round((float) $row->hours, 1),
                'date_logged' => (string) $row->date_logged,
                'created_at' => (string) $row->created_at,
                'age_days' => $ageDays,
                'is_overdue' => $ageDays >= $reviewSlaDays,
                'is_escalated' => $row->escalated_at !== null || $ageDays >= $escalationSlaDays,
            ];
    }

    private function recentDecisions(int $tenantId): array
    {
        if (!Schema::hasTable('vol_logs')) {
            return [];
        }

        $rows = DB::select(
            "SELECT
                vl.id,
                vl.hours,
                vl.status,
                vl.updated_at,
                u.name AS member_name,
                u.first_name,
                u.last_name,
                u.profile_type,
                u.organization_name,
                vo.name AS organisation_name
             FROM vol_logs vl
             LEFT JOIN users u ON u.id = vl.user_id AND u.tenant_id = vl.tenant_id
             LEFT JOIN vol_organizations vo ON vo.id = vl.organization_id AND vo.tenant_id = vl.tenant_id
             WHERE vl.tenant_id = ? AND vl.status IN ('approved', 'declined')
             ORDER BY COALESCE(vl.updated_at, vl.created_at) DESC, vl.id DESC
             LIMIT 8",
            [$tenantId]
        );

        return array_map(function ($row) {
            $fullName = UserDisplayName::resolve($row);
            return [
                'id' => (int) $row->id,
                'member_name' => $fullName !== '' ? $fullName : (string) ($row->member_name ?? ''),
                'organisation_name' => (string) ($row->organisation_name ?? ''),
                'hours' => round((float) $row->hours, 1),
                'status' => (string) $row->status,
                'decided_at' => (string) ($row->updated_at ?? ''),
            ];
        }, $rows);
    }

    private function coordinatorSignals(int $tenantId): array
    {
        $activeRequests = 0;
        $activeOffers = 0;
        $trustedOrganisations = 0;

        if (Schema::hasTable('listings')) {
            $listingRow = DB::selectOne(
                "SELECT
                    COUNT(CASE WHEN type IN ('request', 'need') THEN 1 END) AS active_requests,
                    COUNT(CASE WHEN type IN ('offer', 'service') THEN 1 END) AS active_offers
                 FROM listings
                 WHERE tenant_id = ? AND status = 'active'",
                [$tenantId]
            );
            $activeRequests = (int) ($listingRow->active_requests ?? 0);
            $activeOffers = (int) ($listingRow->active_offers ?? 0);
        }

        if (Schema::hasTable('vol_organizations')) {
            $trustedOrganisations = (int) DB::selectOne(
                "SELECT COUNT(*) AS count
                 FROM vol_organizations
                 WHERE tenant_id = ? AND status IN ('approved', 'active')",
                [$tenantId]
            )->count;
        }

        return [
            'active_requests' => $activeRequests,
            'active_offers' => $activeOffers,
            'trusted_organisations' => $trustedOrganisations,
        ];
    }

    private function coordinatorCount(int $tenantId): int
    {
        $row = DB::selectOne(
            "SELECT COUNT(*) AS count
             FROM users
             WHERE tenant_id = ?
                AND status = 'active'
                AND (
                    role IN ('admin', 'tenant_admin', 'broker', 'super_admin')
                    OR is_admin = 1
                    OR is_tenant_super_admin = 1
                )",
            [$tenantId]
        );

        return (int) ($row->count ?? 0);
    }

    private function coordinators(int $tenantId): array
    {
        $rows = DB::select(
            "SELECT id, name, first_name, last_name, role
             FROM users
             WHERE tenant_id = ?
                AND status = 'active'
                AND (
                    role IN ('admin', 'tenant_admin', 'broker', 'super_admin')
                    OR is_admin = 1
                    OR is_tenant_super_admin = 1
                )
             ORDER BY name ASC
             LIMIT 50",
            [$tenantId]
        );

        return array_map(function ($row) {
            $fullName = UserDisplayName::resolve($row);
            return [
                'id' => (int) $row->id,
                'name' => $fullName !== '' ? $fullName : (string) $row->name,
                'role' => (string) ($row->role ?? 'member'),
            ];
        }, $rows);
    }

    private function isCoordinator(int $tenantId, int $userId): bool
    {
        $row = DB::selectOne(
            "SELECT id
             FROM users
             WHERE tenant_id = ? AND id = ? AND status = 'active'
                AND (
                    role IN ('admin', 'tenant_admin', 'broker', 'super_admin')
                    OR is_admin = 1
                    OR is_tenant_super_admin = 1
                )",
            [$tenantId, $userId]
        );

        return $row !== null;
    }

    private function applyOrganizationPayment(
        int $tenantId,
        int $organizationId,
        int $organizationOwnerId,
        int $volunteerId,
        int $logId,
        float $hours,
    ): string {
        if (!Schema::hasTable('vol_org_transactions') || !Schema::hasTable('transactions')) {
            return 'audit_schema_missing';
        }

        // users.balance stores whole hours, so the volunteer is credited
        // floor($hours). Debit the org by that SAME whole-hour amount (not the
        // raw fractional $hours) so credits are conserved — a fractional
        // remainder stays in the org wallet rather than being destroyed (and a
        // sub-one-hour log debits nothing). Mirrors VolunteerService::verifyHours
        // ("keep fractional remainders in the org wallet").
        $wholeHours = (int) floor($hours);
        if ($wholeHours <= 0) {
            // Sub-one-hour log: users.balance stores whole hours, so nothing is
            // minted and nothing is debited (mirrors applyVolunteerAutoPayment).
            return 'no_payable_hours';
        }

        $orgLocked = DB::selectOne(
            "SELECT id, balance FROM vol_organizations WHERE id = ? AND tenant_id = ? FOR UPDATE",
            [$organizationId, $tenantId]
        );
        if (!$orgLocked) {
            return 'no_org';
        }

        // Debit the org wallet UNCONDITIONALLY — allow it to go NEGATIVE. The org
        // wallet is a reconciliation figure, not a spending limit; approved hours
        // are always minted (classic timebanking), mirroring
        // VolunteerService::applyVolunteerAutoPayment. Previously this returned
        // 'insufficient_balance' and paid nothing, silently leaving the carer's
        // approved hours permanently unminted — the log is committed 'approved'
        // and the verify paths only ever reprocess 'pending' logs.
        DB::update(
            "UPDATE vol_organizations SET balance = balance - ? WHERE id = ? AND tenant_id = ?",
            [$wholeHours, $organizationId, $tenantId]
        );

        DB::update(
            "UPDATE users SET balance = balance + ? WHERE id = ? AND tenant_id = ?",
            [$wholeHours, $volunteerId, $tenantId]
        );

        $description = __('api.caring_review_payment_description', ['hours' => $hours]);
        DB::table('vol_org_transactions')->insert([
            'tenant_id' => $tenantId,
            'vol_organization_id' => $organizationId,
            'user_id' => $volunteerId,
            'vol_log_id' => $logId,
            'type' => 'volunteer_payment',
            'amount' => -$wholeHours,
            'balance_after' => (float) $orgLocked->balance - $wholeHours,
            'description' => $description,
            'created_at' => now(),
        ]);

        DB::table('transactions')->insert([
            'tenant_id' => $tenantId,
            'sender_id' => $organizationOwnerId,
            'receiver_id' => $volunteerId,
            'amount' => $wholeHours,
            'description' => $description,
            'transaction_type' => 'volunteer',
            'status' => 'completed',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return 'paid';
    }
}
