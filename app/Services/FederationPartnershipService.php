<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\Jobs\FederationInitialSyncJob;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * FederationPartnershipService — Manages partnerships between tenants for federation.
 *
 * Handles partnership requests, approvals, counter-proposals, and permission management.
 */
class FederationPartnershipService
{
    /** Partnership level constants */
    public const LEVEL_DISCOVERY = 1;
    public const LEVEL_SOCIAL = 2;
    public const LEVEL_ECONOMIC = 3;
    public const LEVEL_INTEGRATED = 4;

    public function __construct(
        private readonly FederationFeatureService $featureService,
        private readonly FederationAuditService $auditService,
    ) {}

    /**
     * Request a partnership with another tenant.
     */
    public static function requestPartnership(
        int $requestingTenantId,
        int $targetTenantId,
        int $requestedBy,
        int $federationLevel = self::LEVEL_DISCOVERY,
        ?string $notes = null
    ): array {
        $check = app(FederationFeatureService::class)->isOperationAllowed('profiles', $requestingTenantId);
        if (!$check['allowed']) {
            return ['success' => false, 'error' => self::blockedReasonMessage($check['level'] ?? null)];
        }

        $targetCheck = app(FederationFeatureService::class)->isTenantFeatureEnabled(
            FederationFeatureService::TENANT_APPEAR_IN_DIRECTORY,
            $targetTenantId
        );
        if (!$targetCheck) {
            return ['success' => false, 'error' => __('api.federation.partnership_target_not_accepting')];
        }

        // Application-level guard: check canonical_pair to prevent concurrent A→B / B→A duplicates
        // before the DB-level unique index on canonical_pair can fire.
        $guardPair = min($requestingTenantId, $targetTenantId) . '-' . max($requestingTenantId, $targetTenantId);
        $canonicalConflict = DB::table('federation_partnerships')
            ->where('canonical_pair', $guardPair)
            ->whereIn('status', ['active', 'pending'])
            ->exists();
        if ($canonicalConflict) {
            return ['success' => false, 'error' => __('api.federation.partnership_request_already_exists')];
        }

        $existing = self::getPartnership($requestingTenantId, $targetTenantId);
        if ($existing) {
            if ($existing['status'] === 'active') {
                return ['success' => false, 'error' => __('api.federation.partnership_already_exists')];
            }
            if ($existing['status'] === 'pending') {
                return ['success' => false, 'error' => __('api.federation.partnership_request_already_pending')];
            }
            if ($existing['status'] === 'terminated') {
                return ['success' => false, 'error' => __('api.federation.partnership_terminated_cannot_rerequest')];
            }
            // Allow re-requesting after a previous rejection, but enforce a 7-day cooldown
            if ($existing['status'] === 'rejected') {
                $rejectedAt = !empty($existing['updated_at'])
                    ? \Carbon\Carbon::parse($existing['updated_at'])
                    : null;
                if ($rejectedAt && $rejectedAt->diffInDays(now()) < 7) {
                    return ['success' => false, 'error' => __('api.federation.partnership_recently_rejected')];
                }
                DB::table('federation_partnerships')->where('id', $existing['id'])->delete();
            }
        }

        $canonicalPair = min($requestingTenantId, $targetTenantId) . '-' . max($requestingTenantId, $targetTenantId);

        try {
            DB::statement(
                "INSERT INTO federation_partnerships (
                    tenant_id, partner_tenant_id, canonical_pair, status, federation_level,
                    requested_at, requested_by, notes
                ) VALUES (?, ?, ?, 'pending', ?, NOW(), ?, ?)
                ON DUPLICATE KEY UPDATE
                    status = 'pending',
                    canonical_pair = VALUES(canonical_pair),
                    federation_level = VALUES(federation_level),
                    requested_at = NOW(),
                    requested_by = VALUES(requested_by),
                    notes = VALUES(notes),
                    terminated_at = NULL,
                    terminated_by = NULL,
                    termination_reason = NULL",
                [$requestingTenantId, $targetTenantId, $canonicalPair, $federationLevel, $requestedBy, $notes]
            );

            FederationAuditService::log(
                'partnership_requested',
                $requestingTenantId, $targetTenantId, $requestedBy,
                ['federation_level' => $federationLevel, 'notes' => $notes]
            );

            // Email the target tenant's admins about the incoming partnership request
            try {
                $requestingTenant = DB::selectOne(
                    "SELECT name FROM tenants WHERE id = ?",
                    [$requestingTenantId]
                );
                $requestingTenantName = $requestingTenant->name ?? 'A partner community';

                if (!FederationEmailService::sendPartnershipRequestNotification(
                    $targetTenantId,
                    $requestingTenantId,
                    $requestingTenantName,
                    $federationLevel,
                    $notes
                )) {
                    Log::warning('FederationPartnershipService::requestPartnership email notification returned false', [
                        'target_tenant_id' => $targetTenantId,
                        'requesting_tenant_id' => $requestingTenantId,
                    ]);
                }
            } catch (\Exception $emailEx) {
                Log::warning('FederationPartnershipService::requestPartnership email notification failed', [
                    'error' => $emailEx->getMessage(),
                ]);
            }

            return ['success' => true, 'message' => __('svc_notifications_2.federation.partnership_request_sent')];
        } catch (\Exception $e) {
            Log::error('FederationPartnershipService::requestPartnership error: ' . $e->getMessage());
            return ['success' => false, 'error' => __('api.federation.partnership_create_failed')];
        }
    }

    /**
     * Approve a partnership request.
     */
    public static function approvePartnership(int $partnershipId, int $approvedBy, array $permissions = []): array
    {
        $partnership = self::getPartnershipById($partnershipId);
        if (!$partnership) {
            return ['success' => false, 'error' => __('api.federation.partnership_not_found')];
        }
        if ($partnership['status'] !== 'pending') {
            return ['success' => false, 'error' => __('api.federation.partnership_not_pending_approval')];
        }

        // Only the receiving tenant can approve
        $tenantId = TenantContext::getId();
        if ((int) $partnership['partner_tenant_id'] !== $tenantId) {
            return ['success' => false, 'error' => __('api.federation.partnership_only_receiver_can_approve')];
        }

        $defaultPermissions = self::getDefaultPermissions($partnership['federation_level']);
        $permissions = array_merge($defaultPermissions, $permissions);

        try {
            $updated = DB::table('federation_partnerships')
                ->where('id', $partnershipId)
                ->where('partner_tenant_id', $tenantId)
                ->where('status', 'pending')
                ->update([
                'status' => 'active',
                'approved_at' => now(),
                'approved_by' => $approvedBy,
                'profiles_enabled' => $permissions['profiles'] ? 1 : 0,
                'messaging_enabled' => $permissions['messaging'] ? 1 : 0,
                'transactions_enabled' => $permissions['transactions'] ? 1 : 0,
                'listings_enabled' => $permissions['listings'] ? 1 : 0,
                'events_enabled' => $permissions['events'] ? 1 : 0,
                'groups_enabled' => $permissions['groups'] ? 1 : 0,
                'updated_at' => now(),
            ]);
            if ($updated === 0) {
                return ['success' => false, 'error' => __('api.federation.partnership_no_longer_pending_approval')];
            }

            FederationAuditService::log(
                'partnership_approved',
                $partnership['partner_tenant_id'], $partnership['tenant_id'], $approvedBy,
                ['permissions' => $permissions]
            );

            // Dispatch initial snapshot job so both tenants get a sync audit entry
            // and pre-existing data counts are recorded. Small delay lets the HTTP
            // approval response finish before the job dequeues.
            FederationInitialSyncJob::dispatch(
                (int) $partnership['tenant_id'],
                (int) $partnership['partner_tenant_id'],
                $partnershipId
            )->delay(now()->addSeconds(10));

            return ['success' => true, 'message' => __('svc_notifications_2.federation.partnership_approved')];
        } catch (\Exception $e) {
            Log::error('FederationPartnershipService::approvePartnership error: ' . $e->getMessage());
            return ['success' => false, 'error' => __('api.federation.partnership_approve_failed')];
        }
    }

    /**
     * Counter-propose a partnership request with different terms.
     */
    public static function counterPropose(
        int $partnershipId,
        int $proposedBy,
        int $newLevel,
        array $proposedPermissions = [],
        ?string $message = null
    ): array {
        $partnership = self::getPartnershipById($partnershipId);
        if (!$partnership) {
            return ['success' => false, 'error' => __('api.federation.partnership_not_found')];
        }

        $tenantId = TenantContext::getId();
        if ((int) $partnership['tenant_id'] !== $tenantId && (int) $partnership['partner_tenant_id'] !== $tenantId) {
            return ['success' => false, 'error' => __('api.federation.partnership_counter_not_authorized')];
        }

        // Only the receiving party (partner_tenant_id) can counter-propose.
        // The original requester (tenant_id) should reject/approve instead.
        if ((int) $partnership['tenant_id'] === $tenantId) {
            return ['success' => false, 'error' => __('api.federation.partnership_requester_cannot_counter')];
        }

        if ($partnership['status'] !== 'pending') {
            return ['success' => false, 'error' => __('api.federation.partnership_not_pending')];
        }

        try {
            // Store the proposed level in counter_proposed_level only — do NOT
            // update federation_level yet. The level is only applied when the
            // original requester calls acceptCounterProposal().
            $updated = DB::table('federation_partnerships')
                ->where('id', $partnershipId)
                ->where('partner_tenant_id', $tenantId)
                ->where('status', 'pending')
                ->update([
                'counter_proposed_at' => now(),
                'counter_proposed_by' => $proposedBy,
                'counter_proposal_message' => $message,
                'counter_proposed_level' => $newLevel,
                'counter_proposed_permissions' => json_encode($proposedPermissions),
                'updated_at' => now(),
            ]);
            if ($updated === 0) {
                return ['success' => false, 'error' => __('api.federation.partnership_no_longer_pending')];
            }

            FederationAuditService::log(
                'partnership_counter_proposed',
                $partnership['partner_tenant_id'], $partnership['tenant_id'], $proposedBy,
                [
                    'original_level' => $partnership['federation_level'],
                    'proposed_level' => $newLevel,
                    'proposed_permissions' => $proposedPermissions,
                    'message' => $message,
                ]
            );

            return ['success' => true, 'message' => __('svc_notifications_2.federation.counter_proposal_sent')];
        } catch (\Exception $e) {
            Log::error('FederationPartnershipService::counterPropose error: ' . $e->getMessage());
            return ['success' => false, 'error' => __('api.federation.partnership_counter_send_failed')];
        }
    }

    /**
     * Accept a counter-proposal.
     */
    public static function acceptCounterProposal(int $partnershipId, int $acceptedBy): array
    {
        $partnership = self::getPartnershipById($partnershipId);
        if (!$partnership) {
            return ['success' => false, 'error' => __('api.federation.partnership_not_found')];
        }

        $tenantId = TenantContext::getId();
        if ((int) $partnership['tenant_id'] !== $tenantId) {
            return ['success' => false, 'error' => __('api.federation.partnership_only_requester_can_accept_counter')];
        }

        if ($partnership['status'] !== 'pending') {
            return ['success' => false, 'error' => __('api.federation.partnership_not_pending')];
        }
        if (empty($partnership['counter_proposed_at'])) {
            return ['success' => false, 'error' => __('api.federation.partnership_no_counter_to_accept')];
        }

        $proposedPermissions = [];
        if (!empty($partnership['counter_proposed_permissions'])) {
            $proposedPermissions = json_decode($partnership['counter_proposed_permissions'], true) ?: [];
        }
        // Use the counter-proposed level (not the original federation_level)
        $acceptedLevel = $partnership['counter_proposed_level'] ?? $partnership['federation_level'];
        $defaultPermissions = self::getDefaultPermissions($acceptedLevel);
        $permissions = array_merge($defaultPermissions, $proposedPermissions);

        try {
            $updated = DB::table('federation_partnerships')
                ->where('id', $partnershipId)
                ->where('tenant_id', $tenantId)
                ->where('status', 'pending')
                ->whereNotNull('counter_proposed_at')
                ->update([
                'status' => 'active',
                'federation_level' => $acceptedLevel,
                'approved_at' => now(),
                'approved_by' => $acceptedBy,
                'profiles_enabled' => $permissions['profiles'] ? 1 : 0,
                'messaging_enabled' => $permissions['messaging'] ? 1 : 0,
                'transactions_enabled' => $permissions['transactions'] ? 1 : 0,
                'listings_enabled' => $permissions['listings'] ? 1 : 0,
                'events_enabled' => $permissions['events'] ? 1 : 0,
                'groups_enabled' => $permissions['groups'] ? 1 : 0,
                'updated_at' => now(),
            ]);
            if ($updated === 0) {
                return ['success' => false, 'error' => __('api.federation.counter_proposal_no_longer_available')];
            }

            FederationAuditService::log(
                'partnership_counter_accepted',
                $partnership['tenant_id'], $partnership['partner_tenant_id'], $acceptedBy,
                ['accepted_level' => $acceptedLevel]
            );

            // Dispatch initial snapshot job — same as approvePartnership().
            FederationInitialSyncJob::dispatch(
                (int) $partnership['tenant_id'],
                (int) $partnership['partner_tenant_id'],
                $partnershipId
            )->delay(now()->addSeconds(10));

            return ['success' => true, 'message' => __('svc_notifications_2.federation.counter_proposal_accepted')];
        } catch (\Exception $e) {
            Log::error('FederationPartnershipService::acceptCounterProposal error: ' . $e->getMessage());
            return ['success' => false, 'error' => __('api.federation.partnership_counter_accept_failed')];
        }
    }

    /**
     * Reject a partnership request.
     */
    public static function rejectPartnership(int $partnershipId, int $rejectedBy, ?string $reason = null): array
    {
        $partnership = self::getPartnershipById($partnershipId);
        if (!$partnership) {
            return ['success' => false, 'error' => __('api.federation.partnership_not_found')];
        }
        if ($partnership['status'] !== 'pending') {
            return ['success' => false, 'error' => __('api.federation.partnership_not_pending_approval')];
        }

        // Only the receiving tenant can reject
        $tenantId = TenantContext::getId();
        if ((int) $partnership['partner_tenant_id'] !== $tenantId) {
            return ['success' => false, 'error' => __('api.federation.partnership_only_receiver_can_reject')];
        }

        try {
            $updated = DB::table('federation_partnerships')
                ->where('id', $partnershipId)
                ->where('partner_tenant_id', $tenantId)
                ->where('status', 'pending')
                ->update([
                'status' => 'rejected',
                'terminated_at' => now(),
                'terminated_by' => $rejectedBy,
                'termination_reason' => $reason ?? 'Request rejected',
                'updated_at' => now(),
            ]);
            if ($updated === 0) {
                return ['success' => false, 'error' => __('api.federation.partnership_no_longer_pending_approval')];
            }

            FederationAuditService::log(
                'partnership_rejected',
                $partnership['partner_tenant_id'], $partnership['tenant_id'], $rejectedBy,
                ['reason' => $reason]
            );

            return ['success' => true, 'message' => __('svc_notifications_2.federation.partnership_request_rejected')];
        } catch (\Exception $e) {
            Log::error('FederationPartnershipService::rejectPartnership error: ' . $e->getMessage());
            return ['success' => false, 'error' => __('api.federation.partnership_reject_failed')];
        }
    }

    /**
     * Suspend an active partnership.
     */
    public static function suspendPartnership(int $partnershipId, int $suspendedBy, ?string $reason = null): array
    {
        $partnership = self::getPartnershipById($partnershipId);
        if (!$partnership) {
            return ['success' => false, 'error' => __('api.federation.partnership_not_found')];
        }
        if ($partnership['status'] !== 'active') {
            return ['success' => false, 'error' => __('api.federation.partnership_only_active_can_suspend')];
        }

        // Either party can suspend
        $tenantId = TenantContext::getId();
        if ((int) $partnership['tenant_id'] !== $tenantId && (int) $partnership['partner_tenant_id'] !== $tenantId) {
            return ['success' => false, 'error' => __('api.federation.partnership_only_partner_can_suspend')];
        }

        try {
            $updated = DB::table('federation_partnerships')
                ->where('id', $partnershipId)
                ->where('status', 'active')
                ->where(function ($query) use ($tenantId): void {
                    $query->where('tenant_id', $tenantId)
                        ->orWhere('partner_tenant_id', $tenantId);
                })
                ->update([
                'status' => 'suspended',
                'termination_reason' => $reason,
                'suspended_by' => $suspendedBy,
                'suspended_by_tenant_id' => $tenantId,
                'updated_at' => now(),
            ]);
            if ($updated === 0) {
                return ['success' => false, 'error' => __('api.federation.partnership_cannot_be_suspended')];
            }

            FederationAuditService::log(
                'partnership_suspended',
                $partnership['tenant_id'], $partnership['partner_tenant_id'], $suspendedBy,
                ['reason' => $reason, 'suspended_by_tenant_id' => $tenantId],
                FederationAuditService::LEVEL_WARNING
            );

            return ['success' => true, 'message' => __('svc_notifications_2.federation.partnership_suspended')];
        } catch (\Exception $e) {
            Log::error('FederationPartnershipService::suspendPartnership error: ' . $e->getMessage());
            return ['success' => false, 'error' => __('api.federation.partnership_suspend_failed')];
        }
    }

    /**
     * Reactivate a suspended partnership.
     */
    public static function reactivatePartnership(int $partnershipId, int $reactivatedBy): array
    {
        $partnership = self::getPartnershipById($partnershipId);
        if (!$partnership) {
            return ['success' => false, 'error' => __('api.federation.partnership_not_found')];
        }
        if ($partnership['status'] !== 'suspended') {
            return ['success' => false, 'error' => __('api.federation.partnership_only_suspended_can_reactivate')];
        }

        $tenantId = TenantContext::getId();
        if ((int) $partnership['tenant_id'] !== $tenantId && (int) $partnership['partner_tenant_id'] !== $tenantId) {
            return ['success' => false, 'error' => __('api.federation.partnership_only_partner_can_reactivate')];
        }

        // Reactivation consent guard: only the tenant that suspended the partnership may
        // reactivate it unilaterally. suspended_by_tenant_id is written by suspendPartnership().
        // Legacy rows where the column is NULL (suspended before this migration) fall
        // through and allow either party — that is the safest degraded behaviour.
        $suspendedByTenantId = isset($partnership['suspended_by_tenant_id'])
            ? (int) $partnership['suspended_by_tenant_id']
            : null;

        if ($suspendedByTenantId !== null && $suspendedByTenantId !== $tenantId) {
            return ['success' => false, 'error' => __('api.federation.partnership_only_suspender_can_reactivate')];
        }

        try {
            $updated = DB::table('federation_partnerships')
                ->where('id', $partnershipId)
                ->where('status', 'suspended')
                ->where(function ($query) use ($tenantId): void {
                    $query->where('tenant_id', $tenantId)
                        ->orWhere('partner_tenant_id', $tenantId);
                })
                ->where(function ($query) use ($tenantId): void {
                    $query->whereNull('suspended_by_tenant_id')
                        ->orWhere('suspended_by_tenant_id', $tenantId);
                })
                ->update([
                'status' => 'active',
                'termination_reason' => null,
                'suspended_by' => null,
                'suspended_by_tenant_id' => null,
                'updated_at' => now(),
            ]);
            if ($updated === 0) {
                return ['success' => false, 'error' => __('api.federation.partnership_cannot_be_reactivated')];
            }

            FederationAuditService::log(
                'partnership_reactivated',
                $partnership['tenant_id'], $partnership['partner_tenant_id'], $reactivatedBy,
                []
            );

            return ['success' => true, 'message' => __('svc_notifications_2.federation.partnership_reactivated')];
        } catch (\Exception $e) {
            Log::error('FederationPartnershipService::reactivatePartnership error: ' . $e->getMessage());
            return ['success' => false, 'error' => __('api.federation.partnership_reactivate_failed')];
        }
    }

    /**
     * Terminate a partnership permanently.
     */
    public static function terminatePartnership(int $partnershipId, int $terminatedBy, ?string $reason = null): array
    {
        $partnership = self::getPartnershipById($partnershipId);
        if (!$partnership) {
            return ['success' => false, 'error' => __('api.federation.partnership_not_found')];
        }

        $tenantId = TenantContext::getId();
        if ((int) $partnership['tenant_id'] !== $tenantId && (int) $partnership['partner_tenant_id'] !== $tenantId) {
            return ['success' => false, 'error' => __('api.federation.partnership_only_partner_can_terminate')];
        }

        $partnershipTenantId = (int) $partnership['tenant_id'];
        $partnerTenantId = (int) $partnership['partner_tenant_id'];

        try {
            DB::transaction(function () use ($partnershipId, $partnershipTenantId, $partnerTenantId, $terminatedBy, $reason, $partnership, $tenantId) {
                $updated = DB::table('federation_partnerships')
                    ->where('id', $partnershipId)
                    ->whereIn('status', ['active', 'suspended', 'pending', 'rejected'])
                    ->where(function ($query) use ($tenantId): void {
                        $query->where('tenant_id', $tenantId)
                            ->orWhere('partner_tenant_id', $tenantId);
                    })
                    ->update([
                    'status' => 'terminated',
                    'terminated_at' => now(),
                    'terminated_by' => $terminatedBy,
                    'termination_reason' => $reason,
                    'updated_at' => now(),
                ]);
                if ($updated === 0) {
                    throw new \RuntimeException(__('api.federation.partnership_cannot_be_terminated'));
                }

                // Sever cross-tenant connections between these two tenants.
                // federation_connections status ENUM only supports 'pending','accepted','rejected'
                // — use 'rejected' to mark severed connections.
                DB::table('federation_connections')
                    ->where(function ($q) use ($partnershipTenantId, $partnerTenantId) {
                        $q->where('requester_tenant_id', $partnershipTenantId)
                          ->where('receiver_tenant_id', $partnerTenantId);
                    })
                    ->orWhere(function ($q) use ($partnershipTenantId, $partnerTenantId) {
                        $q->where('requester_tenant_id', $partnerTenantId)
                          ->where('receiver_tenant_id', $partnershipTenantId);
                    })
                    ->update(['status' => 'rejected', 'updated_at' => now()]);

                // Cancel pending federation transactions between these two tenants.
                DB::table('federation_transactions')
                    ->where('status', 'pending')
                    ->where(function ($q) use ($partnershipTenantId, $partnerTenantId) {
                        $q->where(function ($inner) use ($partnershipTenantId, $partnerTenantId) {
                            $inner->where('sender_tenant_id', $partnershipTenantId)
                                  ->where('receiver_tenant_id', $partnerTenantId);
                        })->orWhere(function ($inner) use ($partnershipTenantId, $partnerTenantId) {
                            $inner->where('sender_tenant_id', $partnerTenantId)
                                  ->where('receiver_tenant_id', $partnershipTenantId);
                        });
                    })
                    ->update([
                        'status' => 'cancelled',
                        'cancelled_at' => now(),
                        'cancellation_reason' => 'Partnership terminated',
                    ]);

                // Suspend active credit agreements between these two tenants.
                DB::table('federation_credit_agreements')
                    ->where('status', 'active')
                    ->where(function ($q) use ($partnershipTenantId, $partnerTenantId) {
                        $q->where(function ($inner) use ($partnershipTenantId, $partnerTenantId) {
                            $inner->where('from_tenant_id', $partnershipTenantId)
                                  ->where('to_tenant_id', $partnerTenantId);
                        })->orWhere(function ($inner) use ($partnershipTenantId, $partnerTenantId) {
                            $inner->where('from_tenant_id', $partnerTenantId)
                                  ->where('to_tenant_id', $partnershipTenantId);
                        });
                    })
                    ->update(['status' => 'suspended', 'updated_at' => now()]);
            });

            FederationAuditService::log(
                'partnership_terminated',
                $partnership['tenant_id'], $partnership['partner_tenant_id'], $terminatedBy,
                ['reason' => $reason],
                FederationAuditService::LEVEL_WARNING
            );

            return ['success' => true, 'message' => __('svc_notifications_2.federation.partnership_terminated')];
        } catch (\Exception $e) {
            Log::error('FederationPartnershipService::terminatePartnership error: ' . $e->getMessage());
            return ['success' => false, 'error' => __('api.federation.partnership_terminate_failed')];
        }
    }

    /**
     * Update partnership permissions.
     */
    public static function updatePermissions(int $partnershipId, int $updatedBy, array $permissions): array
    {
        $partnership = self::getPartnershipById($partnershipId);
        if (!$partnership) {
            return ['success' => false, 'error' => __('api.federation.partnership_not_found')];
        }

        $tenantId = TenantContext::getId();
        if ((int) $partnership['tenant_id'] !== $tenantId && (int) $partnership['partner_tenant_id'] !== $tenantId) {
            return ['success' => false, 'error' => __('api.federation.partnership_only_partner_can_update_permissions')];
        }

        // Only a live, mutually-consented partnership can have its permissions
        // edited — pending/rejected/suspended/terminated rows must stay frozen.
        if (($partnership['status'] ?? null) !== 'active') {
            return ['success' => false, 'error' => __('api.federation.partnership_permissions_require_active')];
        }

        // Whitelist the permission keys: unknown keys are a caller bug and must
        // fail loudly instead of being silently ignored.
        $validKeys = ['profiles', 'messaging', 'transactions', 'listings', 'events', 'groups'];
        $unknownKeys = array_diff(array_keys($permissions), $validKeys);
        if (!empty($unknownKeys)) {
            return ['success' => false, 'error' => __('api.federation.partnership_unknown_permission_keys', ['keys' => implode(', ', $unknownKeys)])];
        }

        // Level cap: a flag may never be switched on beyond what the
        // partnership's federation_level grants by default — e.g. a level-1
        // (discovery) partnership must not gain transactions_enabled.
        $levelCap = self::getDefaultPermissions((int) ($partnership['federation_level'] ?? self::LEVEL_DISCOVERY));
        foreach ($permissions as $key => $value) {
            if ($value && empty($levelCap[$key])) {
                return ['success' => false, 'error' => __('api.federation.partnership_permission_not_at_level', ['permission' => $key])];
            }
        }

        try {
            DB::table('federation_partnerships')->where('id', $partnershipId)->update([
                'profiles_enabled' => isset($permissions['profiles']) ? ($permissions['profiles'] ? 1 : 0) : $partnership['profiles_enabled'],
                'messaging_enabled' => isset($permissions['messaging']) ? ($permissions['messaging'] ? 1 : 0) : $partnership['messaging_enabled'],
                'transactions_enabled' => isset($permissions['transactions']) ? ($permissions['transactions'] ? 1 : 0) : $partnership['transactions_enabled'],
                'listings_enabled' => isset($permissions['listings']) ? ($permissions['listings'] ? 1 : 0) : $partnership['listings_enabled'],
                'events_enabled' => isset($permissions['events']) ? ($permissions['events'] ? 1 : 0) : $partnership['events_enabled'],
                'groups_enabled' => isset($permissions['groups']) ? ($permissions['groups'] ? 1 : 0) : $partnership['groups_enabled'],
                'updated_at' => now(),
            ]);

            FederationAuditService::log(
                'partnership_permissions_updated',
                $partnership['tenant_id'], $partnership['partner_tenant_id'], $updatedBy,
                ['permissions' => $permissions]
            );

            return ['success' => true, 'message' => __('svc_notifications_2.federation.permissions_updated')];
        } catch (\Exception $e) {
            Log::error('FederationPartnershipService::updatePermissions error: ' . $e->getMessage());
            return ['success' => false, 'error' => __('api.federation.partnership_permissions_update_failed')];
        }
    }

    // =========================================================================
    // QUERY METHODS
    // =========================================================================

    /**
     * Get partnership by ID.
     */
    public static function getPartnershipById(int $id, ?int $tenantId = null): ?array
    {
        try {
            $query = DB::table('federation_partnerships as p')
                ->leftJoin('tenants as t1', 'p.tenant_id', '=', 't1.id')
                ->leftJoin('tenants as t2', 'p.partner_tenant_id', '=', 't2.id')
                ->select(
                    'p.*',
                    't1.name as tenant_name', 't1.domain as tenant_domain',
                    't2.name as partner_name', 't2.domain as partner_domain'
                )
                ->where('p.id', $id);

            if ($tenantId !== null) {
                $query->where(function ($q) use ($tenantId) {
                    $q->where('p.tenant_id', $tenantId)
                      ->orWhere('p.partner_tenant_id', $tenantId);
                });
            }

            $result = $query->first();

            return $result ? (array) $result : null;
        } catch (\Exception $e) {
            Log::error('FederationPartnershipService::getPartnershipById error: ' . $e->getMessage());
            return null;
        }
    }

    /**
     * Get partnership between two tenants.
     */
    public static function getPartnership(int $tenantId1, int $tenantId2): ?array
    {
        try {
            $result = DB::table('federation_partnerships')
                ->where(function ($q) use ($tenantId1, $tenantId2) {
                    $q->where('tenant_id', $tenantId1)->where('partner_tenant_id', $tenantId2);
                })
                ->orWhere(function ($q) use ($tenantId1, $tenantId2) {
                    $q->where('tenant_id', $tenantId2)->where('partner_tenant_id', $tenantId1);
                })
                ->first();

            return $result ? (array) $result : null;
        } catch (\Exception $e) {
            Log::error('FederationPartnershipService::getPartnership error: ' . $e->getMessage());
            return null;
        }
    }

    /**
     * Get all partnerships for a tenant.
     */
    public static function getTenantPartnerships(int $tenantId, ?string $status = null): array
    {
        try {
            $query = DB::table('federation_partnerships as p')
                ->leftJoin('tenants as t1', 'p.tenant_id', '=', 't1.id')
                ->leftJoin('tenants as t2', 'p.partner_tenant_id', '=', 't2.id')
                ->select('p.*')
                ->selectRaw('CASE WHEN p.tenant_id = ? THEN t2.name ELSE t1.name END as partner_name', [$tenantId])
                ->selectRaw('CASE WHEN p.tenant_id = ? THEN t2.domain ELSE t1.domain END as partner_domain', [$tenantId])
                ->selectRaw('CASE WHEN p.tenant_id = ? THEN p.partner_tenant_id ELSE p.tenant_id END as partner_id', [$tenantId])
                ->where(function ($q) use ($tenantId) {
                    $q->where('p.tenant_id', $tenantId)
                      ->orWhere('p.partner_tenant_id', $tenantId);
                });

            if ($status) {
                $query->where('p.status', $status);
            }

            return $query->orderByDesc('p.created_at')
                ->get()
                ->map(fn ($row) => (array) $row)
                ->all();
        } catch (\Exception $e) {
            Log::error('FederationPartnershipService::getTenantPartnerships error: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Get pending requests for a tenant (incoming).
     */
    public static function getPendingRequests(int $tenantId): array
    {
        try {
            return DB::table('federation_partnerships as p')
                ->join('tenants as t', 'p.tenant_id', '=', 't.id')
                ->select('p.*', 't.name as requester_name', 't.domain as requester_domain')
                ->where('p.partner_tenant_id', $tenantId)
                ->where('p.status', 'pending')
                ->whereNull('p.counter_proposed_at')
                ->orderByDesc('p.requested_at')
                ->get()
                ->map(fn ($row) => (array) $row)
                ->all();
        } catch (\Exception $e) {
            Log::error('FederationPartnershipService::getPendingRequests error: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Get outgoing requests that have counter-proposals awaiting response.
     */
    public static function getCounterProposals(int $tenantId): array
    {
        try {
            return DB::table('federation_partnerships as p')
                ->join('tenants as t', 'p.partner_tenant_id', '=', 't.id')
                ->leftJoin('users as u', 'p.counter_proposed_by', '=', 'u.id')
                ->select(
                    'p.*',
                    't.name as partner_name', 't.domain as partner_domain',
                    'u.first_name as proposer_first_name', 'u.last_name as proposer_last_name'
                )
                ->where('p.tenant_id', $tenantId)
                ->where('p.status', 'pending')
                ->whereNotNull('p.counter_proposed_at')
                ->orderByDesc('p.counter_proposed_at')
                ->get()
                ->map(fn ($row) => (array) $row)
                ->all();
        } catch (\Exception $e) {
            Log::error('FederationPartnershipService::getCounterProposals error: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Get outgoing pending requests.
     */
    public static function getOutgoingRequests(int $tenantId): array
    {
        try {
            return DB::table('federation_partnerships as p')
                ->join('tenants as t', 'p.partner_tenant_id', '=', 't.id')
                ->select('p.*', 't.name as partner_name', 't.domain as partner_domain')
                ->where('p.tenant_id', $tenantId)
                ->where('p.status', 'pending')
                ->whereNull('p.counter_proposed_at')
                ->orderByDesc('p.requested_at')
                ->get()
                ->map(fn ($row) => (array) $row)
                ->all();
        } catch (\Exception $e) {
            Log::error('FederationPartnershipService::getOutgoingRequests error: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Get all partnerships (for super admin).
     */
    public static function getAllPartnerships(?string $status = null, int $limit = 100): array
    {
        try {
            $query = DB::table('federation_partnerships as p')
                ->leftJoin('tenants as t1', 'p.tenant_id', '=', 't1.id')
                ->leftJoin('tenants as t2', 'p.partner_tenant_id', '=', 't2.id')
                ->select(
                    'p.*',
                    't1.name as tenant_name', 't1.domain as tenant_domain',
                    't2.name as partner_name', 't2.domain as partner_domain'
                );

            if ($status) {
                $query->where('p.status', $status);
            }

            return $query->orderByDesc('p.created_at')
                ->limit($limit)
                ->get()
                ->map(fn ($row) => (array) $row)
                ->all();
        } catch (\Exception $e) {
            Log::error('FederationPartnershipService::getAllPartnerships error: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Get partnership statistics.
     */
    public static function getStats(): array
    {
        try {
            $stats = DB::table('federation_partnerships')
                ->selectRaw("
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
                    SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                    SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) as suspended,
                    SUM(CASE WHEN status = 'terminated' THEN 1 ELSE 0 END) as `terminated`
                ")
                ->first();

            $stats = $stats ? (array) $stats : [
                'total' => 0, 'active' => 0, 'pending' => 0,
                'suspended' => 0, 'terminated' => 0,
            ];

            $stats['recent'] = DB::table('federation_partnerships as p')
                ->leftJoin('tenants as t1', 'p.tenant_id', '=', 't1.id')
                ->leftJoin('tenants as t2', 'p.partner_tenant_id', '=', 't2.id')
                ->select('p.*', 't1.name as tenant_name', 't2.name as partner_name')
                ->orderByDesc('p.updated_at')
                ->limit(5)
                ->get()
                ->map(fn ($row) => (array) $row)
                ->all();

            return $stats;
        } catch (\Exception $e) {
            Log::error('FederationPartnershipService::getStats error: ' . $e->getMessage());
            return ['total' => 0, 'active' => 0, 'pending' => 0, 'suspended' => 0, 'terminated' => 0, 'recent' => []];
        }
    }

    // =========================================================================
    // HELPERS
    // =========================================================================

    /**
     * Get default permissions for a federation level.
     */
    public static function getDefaultPermissions(int $level): array
    {
        return match ($level) {
            self::LEVEL_INTEGRATED => [
                'profiles' => true, 'messaging' => true, 'transactions' => true,
                'listings' => true, 'events' => true, 'groups' => true,
            ],
            self::LEVEL_ECONOMIC => [
                'profiles' => true, 'messaging' => true, 'transactions' => true,
                'listings' => true, 'events' => true, 'groups' => false,
            ],
            self::LEVEL_SOCIAL => [
                'profiles' => true, 'messaging' => true, 'transactions' => false,
                'listings' => true, 'events' => true, 'groups' => false,
            ],
            default => [
                'profiles' => true, 'messaging' => false, 'transactions' => false,
                'listings' => false, 'events' => false, 'groups' => false,
            ],
        };
    }

    /**
     * Get human-readable level name.
     */
    public static function getLevelName(int $level): string
    {
        return match ($level) {
            self::LEVEL_DISCOVERY => 'Discovery',
            self::LEVEL_SOCIAL => 'Social',
            self::LEVEL_ECONOMIC => 'Economic',
            self::LEVEL_INTEGRATED => 'Integrated',
            default => 'Unknown',
        };
    }

    /**
     * Get level description.
     */
    public static function getLevelDescription(int $level): string
    {
        return match ($level) {
            self::LEVEL_DISCOVERY => 'Basic visibility - can see tenant exists and view basic profiles',
            self::LEVEL_SOCIAL => 'Social features - can message and view listings/events',
            self::LEVEL_ECONOMIC => 'Full trading - can exchange time credits',
            self::LEVEL_INTEGRATED => 'Full integration - all features including groups',
            default => '',
        };
    }

    /**
     * Translate a FederationFeatureService gate refusal for display.
     *
     * isOperationAllowed() returns both a 'reason' (an English diagnostic, kept
     * English so operators reading logs and Sentry see stable text) and a
     * machine-readable 'level'. Only the level is safe to branch on, so the
     * user-facing message is derived from it rather than from the reason text.
     */
    private static function blockedReasonMessage(?string $level): string
    {
        return match ($level) {
            'emergency'      => __('api.federation.blocked_lockdown'),
            'system'         => __('api.federation.blocked_system'),
            'whitelist'      => __('api.federation.blocked_not_approved'),
            'tenant', 'tenant_feature' => __('api.federation.blocked_tenant'),
            'system_feature' => __('api.federation.blocked_operation_disabled'),
            default          => __('api.federation.blocked_unavailable'),
        };
    }
}
