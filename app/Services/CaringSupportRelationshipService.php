<?php
// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Services\CaringCommunity\CaringRegionalPointService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use App\Support\UserDisplayName;

/**
 * Manages ongoing KISS-style support relationships between members.
 */
class CaringSupportRelationshipService
{
    private const FREQUENCIES = ['weekly', 'fortnightly', 'monthly', 'ad_hoc'];
    private const STATUSES = ['active', 'paused', 'completed', 'cancelled'];

    public function __construct(
        private readonly CaringCommunityWorkflowPolicyService $policyService,
        private readonly CaringRegionalPointService $regionalPointService,
    ) {
    }

    public function list(int $tenantId, array $filters = []): array
    {
        if (!Schema::hasTable('caring_support_relationships')) {
            return [
                'stats' => $this->emptyStats(),
                'items' => [],
            ];
        }

        $status = (string) ($filters['status'] ?? 'active');
        if (!in_array($status, self::STATUSES, true) && $status !== 'all') {
            $status = 'active';
        }

        $params = [$tenantId];
        $where = 'csr.tenant_id = ?';
        if ($status !== 'all') {
            $where .= ' AND csr.status = ?';
            $params[] = $status;
        }

        $rows = DB::select(
            "SELECT
                csr.*,
                supporter.name AS supporter_name,
                supporter.first_name AS supporter_first_name,
                supporter.last_name AS supporter_last_name,
                supporter.profile_type AS supporter_profile_type,
                supporter.organization_name AS supporter_organization_name,
                recipient.name AS recipient_name,
                recipient.first_name AS recipient_first_name,
                recipient.last_name AS recipient_last_name,
                recipient.profile_type AS recipient_profile_type,
                recipient.organization_name AS recipient_organization_name,
                coordinator.name AS coordinator_name,
                org.name AS organization_name,
                cat.name AS category_name
             FROM caring_support_relationships csr
             LEFT JOIN users supporter ON supporter.id = csr.supporter_id AND supporter.tenant_id = csr.tenant_id
             LEFT JOIN users recipient ON recipient.id = csr.recipient_id AND recipient.tenant_id = csr.tenant_id
             LEFT JOIN users coordinator ON coordinator.id = csr.coordinator_id AND coordinator.tenant_id = csr.tenant_id
             LEFT JOIN vol_organizations org ON org.id = csr.organization_id AND org.tenant_id = csr.tenant_id
             LEFT JOIN categories cat ON cat.id = csr.category_id AND cat.tenant_id = csr.tenant_id
             WHERE {$where}
             ORDER BY
                CASE csr.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END,
                COALESCE(csr.next_check_in_at, csr.created_at) ASC,
                csr.id DESC
             LIMIT 100",
            $params
        );

        return [
            'stats' => $this->stats($tenantId),
            'items' => array_map(fn (object $row): array => $this->format($row), $rows),
        ];
    }

    public function create(int $tenantId, array $input, int $coordinatorId): array
    {
        if (!Schema::hasTable('caring_support_relationships')) {
            return ['success' => false, 'code' => 'SCHEMA_MISSING'];
        }

        $supporterId = (int) ($input['supporter_id'] ?? 0);
        $recipientId = (int) ($input['recipient_id'] ?? 0);
        if ($supporterId <= 0 || $recipientId <= 0 || $supporterId === $recipientId) {
            return ['success' => false, 'code' => 'VALIDATION_ERROR'];
        }

        if (!$this->tenantUserExists($tenantId, $supporterId) || !$this->tenantUserExists($tenantId, $recipientId)) {
            return ['success' => false, 'code' => 'USER_NOT_FOUND'];
        }

        $interactionPolicy = app(SafeguardingInteractionPolicy::class);
        $interactionPolicy->assertLocalContactAllowed(
            $supporterId,
            $recipientId,
            $tenantId,
            'caring_support_relationship_create',
        );
        $interactionPolicy->assertLocalContactAllowed(
            $recipientId,
            $supporterId,
            $tenantId,
            'caring_support_relationship_create',
        );

        $frequency = $this->normaliseFrequency($input['frequency'] ?? null);
        $startDate = $this->normaliseDate($input['start_date'] ?? null) ?? date('Y-m-d');
        $expectedHours = max(0.25, min(24.0, (float) ($input['expected_hours'] ?? 1)));
        $nextCheckIn = $this->nextCheckIn($startDate, $frequency);

        $id = (int) DB::table('caring_support_relationships')->insertGetId([
            'tenant_id' => $tenantId,
            'supporter_id' => $supporterId,
            'recipient_id' => $recipientId,
            'coordinator_id' => $coordinatorId,
            'organization_id' => $this->nullableTenantReference($tenantId, 'vol_organizations', $input['organization_id'] ?? null),
            'category_id' => $this->nullableTenantReference($tenantId, 'categories', $input['category_id'] ?? null),
            'title' => mb_substr(trim((string) ($input['title'] ?? __('api.caring_support_relationship_default_title'))), 0, 255),
            'description' => trim((string) ($input['description'] ?? '')) ?: null,
            'frequency' => $frequency,
            'expected_hours' => $expectedHours,
            'start_date' => $startDate,
            'end_date' => $this->normaliseDate($input['end_date'] ?? null),
            'status' => 'active',
            'next_check_in_at' => $nextCheckIn,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return [
            'success' => true,
            'relationship' => $this->find($tenantId, $id),
        ];
    }

    public function update(int $tenantId, int $id, array $input): ?array
    {
        if (!Schema::hasTable('caring_support_relationships')) {
            return null;
        }

        $existing = DB::table('caring_support_relationships')
            ->where('tenant_id', $tenantId)
            ->where('id', $id)
            ->first();
        if (!$existing) {
            return null;
        }

        $updates = ['updated_at' => now()];
        if (array_key_exists('status', $input)) {
            $status = (string) $input['status'];
            if (in_array($status, self::STATUSES, true)) {
                $updates['status'] = $status;
            }
        }
        if (array_key_exists('frequency', $input)) {
            $updates['frequency'] = $this->normaliseFrequency($input['frequency']);
        }
        if (array_key_exists('expected_hours', $input)) {
            $updates['expected_hours'] = max(0.25, min(24.0, (float) $input['expected_hours']));
        }
        if (array_key_exists('title', $input)) {
            $updates['title'] = mb_substr(trim((string) $input['title']), 0, 255);
        }
        if (array_key_exists('description', $input)) {
            $updates['description'] = trim((string) $input['description']) ?: null;
        }
        if (array_key_exists('next_check_in_at', $input)) {
            $updates['next_check_in_at'] = $this->normaliseDateTime($input['next_check_in_at']);
        }
        if (array_key_exists('last_logged_at', $input)) {
            $updates['last_logged_at'] = $this->normaliseDateTime($input['last_logged_at']);
        }

        DB::table('caring_support_relationships')
            ->where('tenant_id', $tenantId)
            ->where('id', $id)
            ->update($updates);

        return $this->find($tenantId, $id);
    }

    public function find(int $tenantId, int $id): ?array
    {
        $row = DB::selectOne(
            "SELECT
                csr.*,
                supporter.name AS supporter_name,
                supporter.first_name AS supporter_first_name,
                supporter.last_name AS supporter_last_name,
                supporter.profile_type AS supporter_profile_type,
                supporter.organization_name AS supporter_organization_name,
                recipient.name AS recipient_name,
                recipient.first_name AS recipient_first_name,
                recipient.last_name AS recipient_last_name,
                recipient.profile_type AS recipient_profile_type,
                recipient.organization_name AS recipient_organization_name,
                coordinator.name AS coordinator_name,
                org.name AS organization_name,
                cat.name AS category_name
             FROM caring_support_relationships csr
             LEFT JOIN users supporter ON supporter.id = csr.supporter_id AND supporter.tenant_id = csr.tenant_id
             LEFT JOIN users recipient ON recipient.id = csr.recipient_id AND recipient.tenant_id = csr.tenant_id
             LEFT JOIN users coordinator ON coordinator.id = csr.coordinator_id AND coordinator.tenant_id = csr.tenant_id
             LEFT JOIN vol_organizations org ON org.id = csr.organization_id AND org.tenant_id = csr.tenant_id
             LEFT JOIN categories cat ON cat.id = csr.category_id AND cat.tenant_id = csr.tenant_id
             WHERE csr.tenant_id = ? AND csr.id = ?",
            [$tenantId, $id]
        );

        return $row ? $this->format($row) : null;
    }

    private function stats(int $tenantId): array
    {
        $row = DB::selectOne(
            "SELECT
                COUNT(CASE WHEN status = 'active' THEN 1 END) AS active_count,
                COUNT(CASE WHEN status = 'paused' THEN 1 END) AS paused_count,
                COUNT(CASE WHEN status = 'active' AND next_check_in_at IS NOT NULL AND next_check_in_at < NOW() THEN 1 END) AS check_ins_due,
                COALESCE(SUM(CASE WHEN status = 'active' THEN expected_hours ELSE 0 END), 0) AS expected_active_hours
             FROM caring_support_relationships
             WHERE tenant_id = ?",
            [$tenantId]
        );

        return [
            'active_count' => (int) ($row->active_count ?? 0),
            'paused_count' => (int) ($row->paused_count ?? 0),
            'check_ins_due' => (int) ($row->check_ins_due ?? 0),
            'expected_active_hours' => round((float) ($row->expected_active_hours ?? 0), 2),
        ];
    }

    private function emptyStats(): array
    {
        return [
            'active_count' => 0,
            'paused_count' => 0,
            'check_ins_due' => 0,
            'expected_active_hours' => 0.0,
        ];
    }

    private function format(object $row): array
    {
        return [
            'id' => (int) $row->id,
            'supporter' => [
                'id' => (int) $row->supporter_id,
                'name' => $this->displayName($row, 'supporter'),
            ],
            'recipient' => [
                'id' => (int) $row->recipient_id,
                'name' => $this->displayName($row, 'recipient'),
            ],
            'coordinator' => $row->coordinator_id ? [
                'id' => (int) $row->coordinator_id,
                'name' => (string) ($row->coordinator_name ?? ''),
            ] : null,
            'organization_name' => (string) ($row->organization_name ?? ''),
            'category_name' => (string) ($row->category_name ?? ''),
            'title' => (string) $row->title,
            'description' => (string) ($row->description ?? ''),
            'frequency' => (string) $row->frequency,
            'expected_hours' => round((float) $row->expected_hours, 2),
            'start_date' => (string) $row->start_date,
            'end_date' => $row->end_date ? (string) $row->end_date : null,
            'status' => (string) $row->status,
            'last_logged_at' => $row->last_logged_at ? (string) $row->last_logged_at : null,
            'next_check_in_at' => $row->next_check_in_at ? (string) $row->next_check_in_at : null,
            'created_at' => (string) $row->created_at,
            'updated_at' => $row->updated_at ? (string) $row->updated_at : null,
        ];
    }

    public function logHours(int $tenantId, int $relationshipId, array $input, int $coordinatorId): array
    {
        if (
            !Schema::hasTable('caring_support_relationships')
            || !Schema::hasTable('vol_logs')
            || !Schema::hasColumn('vol_logs', 'caring_support_relationship_id')
            || !Schema::hasColumn('vol_logs', 'support_recipient_id')
        ) {
            return ['success' => false, 'code' => 'SCHEMA_MISSING'];
        }

        $relationship = DB::table('caring_support_relationships')
            ->where('tenant_id', $tenantId)
            ->where('id', $relationshipId)
            ->first();
        if (!$relationship) {
            return ['success' => false, 'code' => 'NOT_FOUND'];
        }
        if ((string) $relationship->status !== 'active') {
            return ['success' => false, 'code' => 'RELATIONSHIP_INACTIVE'];
        }

        $date = $this->normaliseDate($input['date'] ?? null);
        $hours = (float) ($input['hours'] ?? 0);
        if ($date === null || strtotime($date) > time() || $hours <= 0 || $hours > 24) {
            return ['success' => false, 'code' => 'VALIDATION_ERROR'];
        }

        $duplicate = DB::table('vol_logs')
            ->where('tenant_id', $tenantId)
            ->where('user_id', (int) $relationship->supporter_id)
            ->where('caring_support_relationship_id', $relationshipId)
            ->where('date_logged', $date)
            ->whereNotIn('status', ['declined', 'rejected'])
            ->exists();
        if ($duplicate) {
            return ['success' => false, 'code' => 'ALREADY_EXISTS'];
        }

        $status = $this->resolveLogStatus($tenantId, $coordinatorId);
        $description = trim((string) ($input['description'] ?? ''));
        if ($description === '') {
            $description = (string) $relationship->title;
        }

        $logId = 0;
        $paymentResult = null;
        $regionalPointsResult = null;
        DB::transaction(function () use ($tenantId, $relationshipId, $relationship, $date, $hours, $description, $status, &$logId, &$paymentResult): void {
            DB::table('vol_logs')->insert([
                'tenant_id' => $tenantId,
                'user_id' => (int) $relationship->supporter_id,
                'organization_id' => $relationship->organization_id ? (int) $relationship->organization_id : null,
                'opportunity_id' => null,
                'caring_support_relationship_id' => $relationshipId,
                'support_recipient_id' => (int) $relationship->recipient_id,
                'date_logged' => $date,
                'hours' => $hours,
                'description' => mb_substr($description, 0, 2000),
                'status' => $status,
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            $logId = (int) DB::getPdo()->lastInsertId();

            if ($status === 'approved' && $relationship->organization_id) {
                $org = DB::table('vol_organizations')
                    ->where('tenant_id', $tenantId)
                    ->where('id', (int) $relationship->organization_id)
                    ->first();
                // Approval ALWAYS mints — never gated by auto_pay_enabled or the
                // org wallet balance, mirroring VolunteerService. Regional points
                // (if enabled) are an additive reward, not a replacement.
                if ($org) {
                    $paymentResult = $this->applyOrganizationPayment(
                        $tenantId,
                        (int) $org->id,
                        (int) $org->user_id,
                        (int) $relationship->supporter_id,
                        $logId,
                        $hours,
                    );
                }
            }

            DB::table('caring_support_relationships')
                ->where('tenant_id', $tenantId)
                ->where('id', $relationshipId)
                ->update([
                    'last_logged_at' => now(),
                    'next_check_in_at' => $this->nextCheckIn($date, (string) $relationship->frequency),
                    'updated_at' => now(),
                ]);
        });

        if ($status === 'approved') {
            try {
                $regionalPointsResult = $this->regionalPointService->awardForApprovedHours(
                    $tenantId,
                    (int) $relationship->supporter_id,
                    $logId,
                    $hours,
                    $coordinatorId
                );
            } catch (\Throwable) {
                $regionalPointsResult = null;
            }
        }

        return [
            'success' => true,
            'log' => [
                'id' => $logId,
                'status' => $status,
                'hours' => round($hours, 2),
                'date_logged' => $date,
                'payment_result' => $paymentResult,
                'regional_points_result' => $regionalPointsResult,
            ],
            'relationship' => $this->find($tenantId, $relationshipId),
        ];
    }

    private function tenantUserExists(int $tenantId, int $userId): bool
    {
        return DB::table('users')->where('tenant_id', $tenantId)->where('id', $userId)->exists();
    }

    private function nullableTenantReference(int $tenantId, string $table, mixed $id): ?int
    {
        $referenceId = (int) ($id ?? 0);
        if ($referenceId <= 0 || !Schema::hasTable($table)) {
            return null;
        }

        return DB::table($table)->where('tenant_id', $tenantId)->where('id', $referenceId)->exists()
            ? $referenceId
            : null;
    }

    private function normaliseFrequency(mixed $frequency): string
    {
        return in_array($frequency, self::FREQUENCIES, true) ? (string) $frequency : 'weekly';
    }

    private function normaliseDate(mixed $date): ?string
    {
        if (!is_string($date) || trim($date) === '') {
            return null;
        }

        $timestamp = strtotime($date);
        return $timestamp === false ? null : date('Y-m-d', $timestamp);
    }

    private function normaliseDateTime(mixed $date): ?string
    {
        if (!is_string($date) || trim($date) === '') {
            return null;
        }

        $timestamp = strtotime($date);
        return $timestamp === false ? null : date('Y-m-d H:i:s', $timestamp);
    }

    private function nextCheckIn(string $startDate, string $frequency): string
    {
        $modifier = match ($frequency) {
            'fortnightly' => '+14 days',
            'monthly' => '+1 month',
            'ad_hoc' => '+30 days',
            default => '+7 days',
        };

        return date('Y-m-d 09:00:00', strtotime($startDate . ' ' . $modifier));
    }

    private function resolveLogStatus(int $tenantId, int $coordinatorId): string
    {
        $policy = $this->policyService->get($tenantId);
        if (!($policy['approval_required'] ?? true)) {
            return 'approved';
        }

        if (
            $this->isTenantCoordinator($tenantId, $coordinatorId)
            || (($policy['auto_approve_trusted_reviewers'] ?? false) && $this->hasCaringWorkflowPermission($tenantId, $coordinatorId, 'volunteering.hours.review'))
        ) {
            return 'approved';
        }

        return 'pending';
    }

    private function isTenantCoordinator(int $tenantId, int $userId): bool
    {
        $user = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('id', $userId)
            ->first(['role', 'is_admin', 'is_super_admin', 'is_tenant_super_admin', 'is_god']);

        return $user && (
            in_array((string) $user->role, ['admin', 'tenant_admin', 'super_admin', 'broker'], true)
            || (int) ($user->is_admin ?? 0) === 1
            || (int) ($user->is_super_admin ?? 0) === 1
            || (int) ($user->is_tenant_super_admin ?? 0) === 1
            || (int) ($user->is_god ?? 0) === 1
        );
    }

    private function hasCaringWorkflowPermission(int $tenantId, int $userId, string $permission): bool
    {
        if (!Schema::hasTable('user_roles') || !Schema::hasTable('role_permissions') || !Schema::hasTable('permissions')) {
            return false;
        }

        return DB::table('user_roles as ur')
            ->join('role_permissions as rp', 'rp.role_id', '=', 'ur.role_id')
            ->join('permissions as p', 'p.id', '=', 'rp.permission_id')
            ->where('ur.tenant_id', $tenantId)
            ->where('ur.user_id', $userId)
            ->where('p.name', $permission)
            ->exists();
    }

    private function applyOrganizationPayment(
        int $tenantId,
        int $organizationId,
        int $organizationOwnerId,
        int $supporterId,
        int $logId,
        float $hours,
    ): string {
        // users.balance stores whole hours, so the supporter is credited
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
        // 'insufficient_balance' and paid nothing, silently leaving the supporter's
        // approved hours permanently unminted.
        DB::table('vol_organizations')
            ->where('tenant_id', $tenantId)
            ->where('id', $organizationId)
            ->update(['balance' => DB::raw('balance - ' . $wholeHours)]);

        DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('id', $supporterId)
            ->increment('balance', $wholeHours);

        $description = __('api.caring_support_relationship_payment_description', ['hours' => $hours]);
        DB::table('vol_org_transactions')->insert([
            'tenant_id' => $tenantId,
            'vol_organization_id' => $organizationId,
            'user_id' => $supporterId,
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
            'receiver_id' => $supporterId,
            'amount' => $wholeHours,
            'description' => $description,
            'transaction_type' => 'volunteer',
            'status' => 'completed',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return 'paid';
    }

    private function displayName(object $row, string $prefix): string
    {
        return UserDisplayName::resolvePrefixed($row, $prefix . '_');
    }
}
