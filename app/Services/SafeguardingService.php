<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\SafeguardingAssignment;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * SafeguardingService — Laravel DI-based service for safeguarding operations.
 *
 * Manages guardian assignments, safeguarding training, and incident reporting.
 * All queries are tenant-scoped via HasTenantScope trait or explicit tenant_id.
 */
class SafeguardingService
{
    private const INCIDENT_STATUS_TRANSITIONS = [
        'open'          => ['open', 'investigating', 'escalated', 'resolved', 'closed'],
        'investigating' => ['investigating', 'escalated', 'resolved', 'closed'],
        'escalated'     => ['escalated', 'investigating', 'resolved', 'closed'],
        'resolved'      => ['resolved'],
        'closed'        => ['closed'],
    ];

    /** @var array Collected errors from the last operation */
    private array $errors = [];

    public function __construct(
        private readonly SafeguardingAssignment $assignment,
    ) {}

    /**
     * Get collected errors from the last operation.
     */
    public function getErrors(): array
    {
        return $this->errors;
    }

    // =========================================================================
    // ASSIGNMENT MANAGEMENT
    // =========================================================================

    /**
     * Create a safeguarding assignment.
     */
    public function createAssignment(int $guardianUserId, int $wardUserId, int $assignedBy, ?string $notes = null): array
    {
        $this->errors = [];

        if ($guardianUserId === $wardUserId) {
            // Existing translated keys — added when the broker dashboard began
            // surfacing these refusals verbatim. "Ward" is retired wording; the
            // key's English already says "supported member".
            $this->errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.ward_guardian_same_person')];
            return ['success' => false, 'errors' => $this->errors];
        }

        // Check both users exist in tenant
        $guardianExists = User::where('id', $guardianUserId)->where('tenant_id', TenantContext::getId())->where('status', 'active')->exists();
        $wardExists = User::where('id', $wardUserId)->where('tenant_id', TenantContext::getId())->where('status', 'active')->exists();

        if (!$guardianExists) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.guardian_not_found_in_tenant')];
            return ['success' => false, 'errors' => $this->errors];
        }
        if (!$wardExists) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api.ward_not_found_in_tenant')];
            return ['success' => false, 'errors' => $this->errors];
        }

        try {
            // Use upsert: if assignment exists but was revoked, re-activate it
            DB::table('safeguarding_assignments')->updateOrInsert(
                [
                    'guardian_user_id' => $guardianUserId,
                    'ward_user_id' => $wardUserId,
                    'tenant_id' => TenantContext::getId(),
                ],
                [
                    'revoked_at' => null,
                    'assigned_by' => $assignedBy,
                    'assigned_at' => now(),
                    'notes' => $notes,
                ]
            );

            $this->logActivity($assignedBy, 'safeguarding_assignment_created', 'safeguarding_assignment', null, [
                'guardian_user_id' => $guardianUserId,
                'ward_user_id' => $wardUserId,
            ]);

            return ['success' => true, 'message' => __('svc_notifications_2.safeguarding.assignment_created')];
        } catch (\Throwable $e) {
            Log::error('SafeguardingService::createAssignment error: ' . $e->getMessage());
            return ['success' => false, 'error' => 'Failed to create assignment'];
        }
    }

    /**
     * Record consent from the ward.
     */
    public function recordConsent(int $wardUserId, ?int $assignmentId = null): bool
    {
        try {
            $query = $this->assignment->newQuery()
                ->where('ward_user_id', $wardUserId)
                ->whereNull('revoked_at')
                ->whereNull('consent_given_at');

            if ($assignmentId !== null) {
                $query->where('id', $assignmentId);
            }

            $query->update(['consent_given_at' => now()]);
            return true;
        } catch (\Throwable $e) {
            Log::error('SafeguardingService::recordConsent error: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Revoke an assignment.
     */
    public function revokeAssignment(int $assignmentId, int $revokedBy): bool
    {
        try {
            $assignment = $this->assignment->newQuery()
                ->where('id', $assignmentId)
                ->first();

            if (!$assignment) {
                throw new \Exception('Assignment not found');
            }

            if ((int) $assignment->guardian_user_id !== $revokedBy && (int) $assignment->ward_user_id !== $revokedBy) {
                $user = User::where('tenant_id', (int) $assignment->tenant_id)
                    ->where('id', $revokedBy)
                    ->first();
                if (!$user || !in_array($user->role, ['admin', 'super_admin'])) {
                    throw new \Exception('Unauthorized to revoke this assignment');
                }
            }

            $this->assignment->newQuery()
                ->where('id', $assignmentId)
                ->update(['revoked_at' => now()]);

            $this->logActivity($revokedBy, 'safeguarding_assignment_revoked', 'safeguarding_assignment', $assignmentId);

            return true;
        } catch (\Throwable $e) {
            Log::error('SafeguardingService::revokeAssignment error: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * List all active assignments for the current tenant.
     */
    public function listAssignments(): array
    {
        try {
            return $this->assignment->newQuery()
                ->with([
                    'guardian:id,name,avatar_url',
                    'ward:id,name,avatar_url',
                    'assigner:id,name',
                ])
                ->whereNull('revoked_at')
                ->orderByDesc('assigned_at')
                ->get()
                ->map(function (SafeguardingAssignment $sa) {
                    $data = $sa->toArray();
                    $data['guardian_name'] = $sa->guardian->name ?? null;
                    $data['guardian_avatar'] = $sa->guardian->avatar_url ?? null;
                    $data['ward_name'] = $sa->ward->name ?? null;
                    $data['ward_avatar'] = $sa->ward->avatar_url ?? null;
                    $data['assigned_by_name'] = $sa->assigner->name ?? null;
                    return $data;
                })
                ->all();
        } catch (\Throwable $e) {
            Log::warning('[Safeguarding] Failed to fetch safeguarding assignments: ' . $e->getMessage());
            return [];
        }
    }

    // =========================================================================
    // TRAINING (tenant-scoped via explicit tenant_id)
    // =========================================================================

    /**
     * Get all training records for a user with cursor pagination.
     *
     * @return array{items: array, cursor: string|null, has_more: bool}
     */
    public function getTrainingForUser(int $userId, int $tenantId, array $filters = []): array
    {
        $limit = min((int) ($filters['limit'] ?? 20), 50);
        $cursor = $filters['cursor'] ?? null;

        try {
            $query = DB::table('vol_safeguarding_training as st')
                ->leftJoin('users as v', 'st.verified_by', '=', 'v.id')
                ->where('st.user_id', $userId)
                ->where('st.tenant_id', $tenantId)
                ->select('st.*', 'v.name as verified_by_name');

            if ($cursor !== null && ($cid = base64_decode($cursor, true)) !== false) {
                $query->where('st.id', '<', (int) $cid);
            }

            $query->orderByDesc('st.id');
            $items = $query->limit($limit + 1)->get();
            $hasMore = $items->count() > $limit;
            if ($hasMore) {
                $items->pop();
            }

            return [
                'items'    => $items->map(fn ($r) => (array) $r)->all(),
                'cursor'   => $hasMore && $items->isNotEmpty() ? base64_encode((string) $items->last()->id) : null,
                'has_more' => $hasMore,
            ];
        } catch (\Throwable $e) {
            Log::error('SafeguardingService::getTrainingForUser error: ' . $e->getMessage());
            return ['items' => [], 'cursor' => null, 'has_more' => false];
        }
    }

    /**
     * Record a training completion for a user.
     *
     * @return array|false The created record or false on failure
     */
    public function recordTraining(int $userId, array $data, int $tenantId): array|false
    {
        $validTrainingTypes = ['children_first', 'vulnerable_adults', 'first_aid', 'manual_handling', 'other'];
        $trainingType = $data['training_type'] ?? '';
        if (!in_array($trainingType, $validTrainingTypes, true)) {
            return false;
        }

        try {
            if (!$this->activeUserBelongsToTenant($userId, $tenantId)) {
                return false;
            }

            $id = DB::table('vol_safeguarding_training')->insertGetId([
                'user_id' => $userId,
                'tenant_id' => $tenantId,
                'training_type' => $trainingType,
                'training_name' => $data['training_name'] ?? '',
                'provider' => $data['provider'] ?? null,
                'completed_at' => $data['completed_at'] ?? now()->toDateString(),
                'expires_at' => $data['expires_at'] ?? null,
                'certificate_url' => $data['certificate_url'] ?? null,
                'notes' => $data['notes'] ?? null,
                'status' => 'pending',
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            $record = DB::table('vol_safeguarding_training')
                ->where('id', $id)
                ->where('tenant_id', $tenantId)
                ->first();

            $this->logActivity($userId, 'safeguarding_training_recorded', 'safeguarding_training', $id, [
                'training_type' => $trainingType,
                'training_name' => $data['training_name'] ?? '',
            ]);

            return $record ? (array) $record : [];
        } catch (\Throwable $e) {
            Log::error('SafeguardingService::recordTraining error: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Get training records for admin view with pagination.
     *
     * @return array{items: array, total: int, page: int, per_page: int}
     */
    public function getTrainingForAdmin(int $tenantId, ?int $page = null, ?int $perPage = null): array
    {
        $page = max(1, $page ?? 1);
        $perPage = min(100, max(1, $perPage ?? 20));
        $offset = ($page - 1) * $perPage;

        try {
            $total = (int) DB::table('vol_safeguarding_training')
                ->where('tenant_id', $tenantId)
                ->count();

            $items = DB::table('vol_safeguarding_training as st')
                ->join('users as u', 'st.user_id', '=', 'u.id')
                ->leftJoin('users as v', 'st.verified_by', '=', 'v.id')
                ->where('st.tenant_id', $tenantId)
                ->select('st.*', 'u.name as user_name', 'u.avatar_url as user_avatar', 'v.name as verified_by_name')
                ->orderByDesc('st.created_at')
                ->offset($offset)
                ->limit($perPage)
                ->get()
                ->map(fn ($row) => (array) $row)
                ->all();

            // Status counts across ALL tenant records (not just the current page)
            // so the admin stat cards reflect real totals under pagination.
            $statusCounts = DB::table('vol_safeguarding_training')
                ->where('tenant_id', $tenantId)
                ->selectRaw('status, COUNT(*) as c')
                ->groupBy('status')
                ->pluck('c', 'status');

            $stats = [
                'total_submissions'    => $total,
                'pending_verification' => (int) ($statusCounts['pending'] ?? 0),
                'verified'             => (int) ($statusCounts['verified'] ?? 0),
                'expired'              => (int) ($statusCounts['expired'] ?? 0),
            ];

            return ['items' => $items, 'stats' => $stats, 'total' => $total, 'page' => $page, 'per_page' => $perPage];
        } catch (\Throwable $e) {
            Log::error('SafeguardingService::getTrainingForAdmin error: ' . $e->getMessage());
            return ['items' => [], 'stats' => ['total_submissions' => 0, 'pending_verification' => 0, 'verified' => 0, 'expired' => 0], 'total' => 0, 'page' => $page, 'per_page' => $perPage];
        }
    }

    /**
     * Verify a training record (admin/DLP approval).
     */
    public function verifyTraining(int $recordId, int $adminId, int $tenantId): bool
    {
        try {
            // Fetch the record to get the user_id for notification
            $record = DB::table('vol_safeguarding_training')
                ->where('id', $recordId)
                ->where('tenant_id', $tenantId)
                ->first();

            if (!$record) {
                return false;
            }

            DB::table('vol_safeguarding_training')
                ->where('id', $recordId)
                ->where('tenant_id', $tenantId)
                ->update([
                    'status' => 'verified',
                    'verified_by' => $adminId,
                    'verified_at' => now(),
                    'updated_at' => now(),
                ]);

            $this->logActivity($adminId, 'safeguarding_training_verified', 'safeguarding_training', $recordId);

            // Notify the user whose training was verified (bell + email)
            try {
                $trainingName = $record->training_name ?? __('emails_misc.safeguarding.training_fallback_name');
                $trainee = User::where('tenant_id', $tenantId)
                    ->where('id', (int) $record->user_id)
                    ->first();

                TenantContext::runForTenant($tenantId, function () use ($trainee, $record, $trainingName, $tenantId, $recordId): void {
                    LocaleContext::withLocale($trainee, function () use ($trainee, $record, $trainingName, $tenantId): void {
                        \App\Models\Notification::createNotification(
                            (int) $record->user_id,
                            __('emails_misc.safeguarding.training_verified', ['training_name' => $trainingName]),
                            '/dashboard',
                            'moderation',
                            true,
                            $tenantId
                        );
                        \App\Services\NotificationDispatcher::fanOutPush((int) ((int) $record->user_id), 'moderation', __('emails_misc.safeguarding.training_verified', ['training_name' => $trainingName]), '/dashboard');

                        if ($trainee && !empty($trainee->email)) {
                            $traineeName  = trim(($trainee->first_name ?? '') . ' ' . ($trainee->last_name ?? '')) ?: ($trainee->name ?? '');
                            $safeTraining = htmlspecialchars($trainingName, ENT_QUOTES, 'UTF-8');
                            $emailBody = EmailTemplateBuilder::make()
                                ->theme('success')
                                ->title(__('emails_misc.safeguarding.training_verified_title'))
                                ->previewText(__('emails_misc.safeguarding.training_verified_preview', ['training' => $safeTraining]))
                                ->greeting($traineeName)
                                ->paragraph(__('emails_misc.safeguarding.training_verified_body', ['training' => $safeTraining]))
                                ->button(__('emails_misc.safeguarding.training_verified_cta'), EmailTemplateBuilder::tenantUrl('/dashboard'))
                                ->render();
                            $subject = __('emails_misc.safeguarding.training_verified_subject', ['training' => $trainingName]);
                            if (!EmailDispatchService::sendRaw($trainee->email, $subject, $emailBody, null, null, null, 'safeguarding', ['tenant_id' => $tenantId])) {
                                Log::warning("SafeguardingService::verifyTraining email send failed for user #{$record->user_id}");
                            }
                        }
                    });
                });
            } catch (\Throwable $notifError) {
                Log::warning("SafeguardingService::verifyTraining notification failed for record #{$recordId}: " . $notifError->getMessage());
            }

            return true;
        } catch (\Throwable $e) {
            Log::error('SafeguardingService::verifyTraining error: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Reject a training record.
     */
    public function rejectTraining(int $recordId, int $adminId, string $reason, int $tenantId): bool
    {
        try {
            // Fetch the record to get the user_id for notification
            $record = DB::table('vol_safeguarding_training')
                ->where('id', $recordId)
                ->where('tenant_id', $tenantId)
                ->first();

            if (!$record) {
                return false;
            }

            DB::table('vol_safeguarding_training')
                ->where('id', $recordId)
                ->where('tenant_id', $tenantId)
                ->update([
                    'status' => 'rejected',
                    'verified_by' => $adminId,
                    'verified_at' => now(),
                    'notes' => $reason,
                    'updated_at' => now(),
                ]);

            $this->logActivity($adminId, 'safeguarding_training_rejected', 'safeguarding_training', $recordId, [
                'reason' => $reason,
            ]);

            // Notify the user whose training was rejected (bell + email — rejection is critical)
            try {
                $trainingName = $record->training_name ?? __('emails_misc.safeguarding.training_fallback_name');
                $trainee = User::where('tenant_id', $tenantId)
                    ->where('id', (int) $record->user_id)
                    ->first();

                TenantContext::runForTenant($tenantId, function () use ($trainee, $record, $trainingName, $reason, $tenantId, $recordId): void {
                    LocaleContext::withLocale($trainee, function () use ($trainee, $record, $trainingName, $reason, $tenantId): void {
                        \App\Models\Notification::createNotification(
                            (int) $record->user_id,
                            __('emails_misc.safeguarding.training_not_approved', ['training_name' => $trainingName]),
                            '/help',
                            'moderation',
                            true,
                            $tenantId
                        );
                        \App\Services\NotificationDispatcher::fanOutPush((int) ((int) $record->user_id), 'moderation', __('emails_misc.safeguarding.training_not_approved', ['training_name' => $trainingName]), '/help');

                        if ($trainee && !empty($trainee->email)) {
                            $traineeName  = trim(($trainee->first_name ?? '') . ' ' . ($trainee->last_name ?? '')) ?: ($trainee->name ?? '');
                            $safeTraining = htmlspecialchars($trainingName, ENT_QUOTES, 'UTF-8');
                            $safeReason   = htmlspecialchars($reason, ENT_QUOTES, 'UTF-8');
                            $emailBody = EmailTemplateBuilder::make()
                                ->theme('warning')
                                ->title(__('emails_misc.safeguarding.training_rejected_title'))
                                ->previewText(__('emails_misc.safeguarding.training_rejected_preview', ['training' => $safeTraining]))
                                ->greeting($traineeName)
                                ->paragraph(__('emails_misc.safeguarding.training_rejected_body', ['training' => $safeTraining]))
                                ->paragraph(__('emails_misc.safeguarding.training_rejected_next_steps'))
                                ->infoCard([
                                    __('emails_misc.safeguarding.training_rejected_reason_label') => $safeReason,
                                ])
                                ->button(__('emails_misc.safeguarding.training_rejected_cta'), EmailTemplateBuilder::tenantUrl('/help'))
                                ->render();
                            $subject = __('emails_misc.safeguarding.training_rejected_subject', ['training' => $trainingName]);
                            if (!EmailDispatchService::sendRaw($trainee->email, $subject, $emailBody, null, null, null, 'safeguarding', ['tenant_id' => $tenantId])) {
                                Log::warning("SafeguardingService::rejectTraining email send failed for user #{$record->user_id}");
                            }
                        }
                    });
                });
            } catch (\Throwable $notifError) {
                Log::warning("SafeguardingService::rejectTraining notification failed for record #{$recordId}: " . $notifError->getMessage());
            }

            return true;
        } catch (\Throwable $e) {
            Log::error('SafeguardingService::rejectTraining error: ' . $e->getMessage());
            return false;
        }
    }

    // =========================================================================
    // INCIDENTS (tenant-scoped via explicit tenant_id)
    // =========================================================================

    /**
     * Report a safeguarding incident.
     *
     * @return array|false The created incident or false on failure
     */
    public function reportIncident(int $reporterId, array $data, int $tenantId): array|false
    {
        $validSeverities = ['low', 'medium', 'high', 'critical'];
        $severity = $data['severity'] ?? 'medium';
        if (!in_array($severity, $validSeverities, true)) {
            return false;
        }

        $validIncidentTypes = ['concern', 'allegation', 'disclosure', 'near_miss', 'other'];
        $incidentType = $data['incident_type'] ?? 'other';
        if (!in_array($incidentType, $validIncidentTypes, true)) {
            return false;
        }

        try {
            $organizationId = !empty($data['organization_id']) ? (int) $data['organization_id'] : null;
            $opportunityId = !empty($data['opportunity_id']) ? (int) $data['opportunity_id'] : null;
            $shiftId = !empty($data['shift_id']) ? (int) $data['shift_id'] : null;
            $involvedUserId = !empty($data['involved_user_id']) ? (int) $data['involved_user_id'] : null;
            $subjectUserId = !empty($data['subject_user_id']) ? (int) $data['subject_user_id'] : $involvedUserId;

            if (!$this->activeUserBelongsToTenant($reporterId, $tenantId)) {
                return false;
            }

            if ($organizationId !== null && !DB::table('vol_organizations')->where('id', $organizationId)->where('tenant_id', $tenantId)->exists()) {
                return false;
            }

            if ($opportunityId !== null) {
                $opportunity = DB::table('vol_opportunities')
                    ->where('id', $opportunityId)
                    ->where('tenant_id', $tenantId)
                    ->first(['id', 'organization_id']);

                if (!$opportunity || ($organizationId !== null && (int) $opportunity->organization_id !== $organizationId)) {
                    return false;
                }

                $organizationId = $organizationId ?? (int) $opportunity->organization_id;
            }

            if ($shiftId !== null) {
                $shift = DB::table('vol_shifts as s')
                    ->join('vol_opportunities as o', function ($join) use ($tenantId) {
                        $join->on('s.opportunity_id', '=', 'o.id')
                            ->where('o.tenant_id', '=', $tenantId);
                    })
                    ->where('s.id', $shiftId)
                    ->where('s.tenant_id', $tenantId)
                    ->first(['s.id', 's.opportunity_id', 'o.organization_id']);

                if (!$shift) {
                    return false;
                }

                if ($opportunityId !== null && (int) $shift->opportunity_id !== $opportunityId) {
                    return false;
                }

                if ($organizationId !== null && (int) $shift->organization_id !== $organizationId) {
                    return false;
                }

                $opportunityId = (int) $shift->opportunity_id;
                $organizationId = (int) $shift->organization_id;
            }

            foreach (array_filter([$involvedUserId, $subjectUserId]) as $relatedUserId) {
                if (!User::where('id', $relatedUserId)->where('tenant_id', $tenantId)->exists()) {
                    return false;
                }
            }

            $id = DB::table('vol_safeguarding_incidents')->insertGetId([
                'tenant_id' => $tenantId,
                'reported_by' => $reporterId,
                'title' => $data['title'] ?? '',
                'description' => $data['description'] ?? '',
                'severity' => $severity,
                'incident_type' => $incidentType,
                'incident_date' => $data['incident_date'] ?? now()->toDateString(),
                'subject_user_id' => $subjectUserId,
                'involved_user_id' => $involvedUserId,
                'organization_id' => $organizationId,
                'opportunity_id' => $opportunityId,
                'shift_id' => $shiftId,
                'category' => $data['category'] ?? 'general',
                'status' => 'open',
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            $record = DB::table('vol_safeguarding_incidents')
                ->where('id', $id)
                ->where('tenant_id', $tenantId)
                ->first();

            $this->logActivity($reporterId, 'safeguarding_incident_reported', 'safeguarding_incident', $id, [
                'severity' => $severity,
                'incident_type' => $incidentType,
                'title' => $data['title'] ?? '',
            ]);

            // Notify all admins/brokers of new incident (legally required for ALL severities)
            $this->notifyAdminsOfIncident($tenantId, $reporterId, $id, $data['title'] ?? '', $severity, $incidentType);

            return $record ? (array) $record : [];
        } catch (\Throwable $e) {
            Log::error('SafeguardingService::reportIncident error: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Get safeguarding incidents with optional status filter and pagination.
     *
     * @return array{items: array, total: int, page: int, per_page: int}
     */
    public function getIncidents(int $tenantId, ?string $status = null, ?int $page = null, ?int $perPage = null): array
    {
        $page = max(1, $page ?? 1);
        $perPage = min(100, max(1, $perPage ?? 20));
        $offset = ($page - 1) * $perPage;

        try {
            $query = DB::table('vol_safeguarding_incidents as si')
                ->where('si.tenant_id', $tenantId);

            if ($status !== null) {
                $query->where('si.status', $status);
            }

            $total = (int) (clone $query)->count();

            $items = (clone $query)
                ->join('users as u', function ($join) use ($tenantId) {
                    $join->on('si.reported_by', '=', 'u.id')
                        ->where('u.tenant_id', '=', $tenantId);
                })
                ->leftJoin('users as iu', function ($join) use ($tenantId) {
                    $join->on('si.involved_user_id', '=', 'iu.id')
                        ->where('iu.tenant_id', '=', $tenantId);
                })
                ->leftJoin('users as su', function ($join) use ($tenantId) {
                    $join->on('si.subject_user_id', '=', 'su.id')
                        ->where('su.tenant_id', '=', $tenantId);
                })
                ->leftJoin('vol_organizations as org', function ($join) use ($tenantId) {
                    $join->on('si.organization_id', '=', 'org.id')
                        ->where('org.tenant_id', '=', $tenantId);
                })
                ->leftJoin('users as au', function ($join) use ($tenantId) {
                    $join->on('si.assigned_to', '=', 'au.id')
                        ->where('au.tenant_id', '=', $tenantId);
                })
                ->select(
                    'si.*',
                    'u.name as reported_by_name',
                    'u.avatar_url as reported_by_avatar',
                    'iu.name as involved_user_name',
                    'su.name as subject_user_name',
                    'org.name as organization_name',
                    'au.name as assigned_to_name'
                )
                ->orderByDesc('si.created_at')
                ->offset($offset)
                ->limit($perPage)
                ->get()
                ->map(fn ($row) => $this->formatIncidentRow((array) $row))
                ->all();

            return ['items' => $items, 'total' => $total, 'page' => $page, 'per_page' => $perPage];
        } catch (\Throwable $e) {
            Log::error('SafeguardingService::getIncidents error: ' . $e->getMessage());
            return ['items' => [], 'total' => 0, 'page' => $page, 'per_page' => $perPage];
        }
    }

    /**
     * Get incidents reported by a specific user (non-admin view).
     *
     * @param int $userId   The reporter's user ID
     * @param int $tenantId Tenant ID
     * @return array{items: array, total: int}
     */
    public function getIncidentsByReporter(int $userId, int $tenantId): array
    {
        try {
            $items = DB::table('vol_safeguarding_incidents as si')
                ->where('si.tenant_id', $tenantId)
                ->where('si.reported_by', $userId)
                ->leftJoin('vol_organizations as org', function ($join) use ($tenantId) {
                    $join->on('si.organization_id', '=', 'org.id')
                        ->where('org.tenant_id', '=', $tenantId);
                })
                ->select(
                    'si.id', 'si.title', 'si.incident_type', 'si.description', 'si.status',
                    'si.severity', 'si.category', 'si.incident_date', 'si.created_at', 'si.updated_at',
                    'org.name as organization_name'
                )
                ->orderByDesc('si.created_at')
                ->limit(100)
                ->get()
                ->map(fn ($row) => $this->formatIncidentRow((array) $row))
                ->all();

            return ['items' => $items, 'total' => count($items)];
        } catch (\Throwable $e) {
            Log::error('SafeguardingService::getIncidentsByReporter error: ' . $e->getMessage());
            return ['items' => [], 'total' => 0];
        }
    }

    /**
     * Get a single safeguarding incident by ID.
     */
    public function getIncident(int $incidentId, int $tenantId): ?array
    {
        try {
            $record = DB::table('vol_safeguarding_incidents as si')
                ->join('users as u', function ($join) use ($tenantId) {
                    $join->on('si.reported_by', '=', 'u.id')
                        ->where('u.tenant_id', '=', $tenantId);
                })
                ->leftJoin('users as iu', function ($join) use ($tenantId) {
                    $join->on('si.involved_user_id', '=', 'iu.id')
                        ->where('iu.tenant_id', '=', $tenantId);
                })
                ->leftJoin('users as su', function ($join) use ($tenantId) {
                    $join->on('si.subject_user_id', '=', 'su.id')
                        ->where('su.tenant_id', '=', $tenantId);
                })
                ->leftJoin('vol_organizations as org', function ($join) use ($tenantId) {
                    $join->on('si.organization_id', '=', 'org.id')
                        ->where('org.tenant_id', '=', $tenantId);
                })
                ->leftJoin('users as au', function ($join) use ($tenantId) {
                    $join->on('si.assigned_to', '=', 'au.id')
                        ->where('au.tenant_id', '=', $tenantId);
                })
                ->where('si.id', $incidentId)
                ->where('si.tenant_id', $tenantId)
                ->select(
                    'si.*',
                    'u.name as reported_by_name',
                    'u.avatar_url as reported_by_avatar',
                    'iu.name as involved_user_name',
                    'iu.avatar_url as involved_user_avatar',
                    'su.name as subject_user_name',
                    'org.name as organization_name',
                    'au.name as assigned_to_name'
                )
                ->first();

            return $record ? $this->formatIncidentRow((array) $record) : null;
        } catch (\Throwable $e) {
            Log::error('SafeguardingService::getIncident error: ' . $e->getMessage());
            return null;
        }
    }

    /**
     * Update a safeguarding incident.
     */
    public function updateIncident(int $incidentId, array $data, int $adminId, int $tenantId): bool
    {
        try {
            // Validate status enum if provided
            if (isset($data['status'])) {
                $validStatuses = ['open', 'investigating', 'resolved', 'escalated', 'closed'];
                if (!in_array($data['status'], $validStatuses, true)) {
                    return false;
                }
            }

            $allowedFields = ['status', 'action_taken', 'resolution_notes', 'assigned_to', 'severity'];
            $updates = [];

            foreach ($allowedFields as $field) {
                if (array_key_exists($field, $data)) {
                    $updates[$field] = $data[$field];
                }
            }

            if (empty($updates)) {
                return false;
            }

            if (isset($data['status']) && in_array($data['status'], ['resolved', 'closed'])) {
                $updates['resolved_at'] = now();
            }

            $updates['updated_at'] = now();

            // Get current incident state for comparison
            $currentIncident = DB::table('vol_safeguarding_incidents')
                ->where('id', $incidentId)
                ->where('tenant_id', $tenantId)
                ->first();

            if (!$currentIncident) {
                return false;
            }

            if (isset($updates['status'])) {
                $currentStatus = (string) ($currentIncident->status ?? '');
                $nextStatus = (string) $updates['status'];
                if (!in_array($nextStatus, self::INCIDENT_STATUS_TRANSITIONS[$currentStatus] ?? [], true)) {
                    return false;
                }
            }

            if (isset($updates['assigned_to']) && $updates['assigned_to'] !== null) {
                $assigneeExists = User::where('id', (int) $updates['assigned_to'])
                    ->where('tenant_id', $tenantId)
                    ->where('status', 'active')
                    ->whereIn('role', ['admin', 'tenant_admin', 'super_admin', 'broker', 'coordinator'])
                    ->exists();

                if (!$assigneeExists) {
                    return false;
                }
            }

            DB::table('vol_safeguarding_incidents')
                ->where('id', $incidentId)
                ->where('tenant_id', $tenantId)
                ->update($updates);

            $this->logActivity($adminId, 'safeguarding_incident_updated', 'safeguarding_incident', $incidentId, $updates);

            // Notify reporter and assigned DLP of status changes
            if (isset($data['status']) && $currentIncident) {
                $this->notifyIncidentStatusChange(
                    $tenantId,
                    $incidentId,
                    (int) $currentIncident->reported_by,
                    $currentIncident->assigned_to ? (int) $currentIncident->assigned_to : null,
                    $data['status']
                );
            }

            return true;
        } catch (\Throwable $e) {
            Log::error('SafeguardingService::updateIncident error: ' . $e->getMessage());
            return false;
        }
    }

    public function getIncidentStats(int $tenantId): array
    {
        try {
            $rows = DB::table('vol_safeguarding_incidents')
                ->selectRaw('status, COUNT(*) as count')
                ->where('tenant_id', $tenantId)
                ->groupBy('status')
                ->get();

            $counts = [];
            foreach ($rows as $row) {
                $counts[$row->status] = (int) $row->count;
            }

            return [
                'total_incidents' => array_sum($counts),
                'open' => $counts['open'] ?? 0,
                'under_investigation' => $counts['investigating'] ?? 0,
                'resolved' => ($counts['resolved'] ?? 0) + ($counts['closed'] ?? 0),
                'escalated' => $counts['escalated'] ?? 0,
            ];
        } catch (\Throwable $e) {
            Log::error('SafeguardingService::getIncidentStats error: ' . $e->getMessage());
            return [
                'total_incidents' => 0,
                'open' => 0,
                'under_investigation' => 0,
                'resolved' => 0,
                'escalated' => 0,
            ];
        }
    }

    public function getDlpAssignments(int $tenantId): array
    {
        try {
            return DB::table('vol_organizations as org')
                ->leftJoin('users as dlp', function ($join) use ($tenantId) {
                    $join->on('org.dlp_user_id', '=', 'dlp.id')
                        ->where('dlp.tenant_id', '=', $tenantId);
                })
                ->where('org.tenant_id', $tenantId)
                ->orderBy('org.name')
                ->select(
                    'org.id as organization_id',
                    'org.name as organization_name',
                    'org.dlp_user_id',
                    'dlp.name as dlp_user_name'
                )
                ->get()
                ->map(fn ($row) => [
                    'organization_id' => (int) $row->organization_id,
                    'organization_name' => $row->organization_name,
                    'dlp_user_id' => $row->dlp_user_id !== null ? (int) $row->dlp_user_id : null,
                    'dlp_user_name' => $row->dlp_user_name,
                ])
                ->all();
        } catch (\Throwable $e) {
            Log::error('SafeguardingService::getDlpAssignments error: ' . $e->getMessage());
            return [];
        }
    }

    public function assignOrganizationDlp(int $organizationId, int $dlpUserId, int $adminId, int $tenantId): bool
    {
        try {
            $organization = DB::table('vol_organizations')
                ->where('id', $organizationId)
                ->where('tenant_id', $tenantId)
                ->first();

            if (!$organization) {
                return false;
            }

            $dlpUser = User::where('id', $dlpUserId)
                ->where('tenant_id', $tenantId)
                ->where('status', 'active')
                ->whereIn('role', ['admin', 'tenant_admin', 'super_admin', 'broker', 'coordinator'])
                ->first();

            if (!$dlpUser) {
                return false;
            }

            DB::table('vol_organizations')
                ->where('id', $organizationId)
                ->where('tenant_id', $tenantId)
                ->update([
                    'dlp_user_id' => $dlpUserId,
                    'updated_at' => now(),
                ]);

            $this->logActivity($adminId, 'safeguarding_organization_dlp_assigned', 'vol_organization', $organizationId, [
                'dlp_user_id' => $dlpUserId,
            ]);

            return true;
        } catch (\Throwable $e) {
            Log::error('SafeguardingService::assignOrganizationDlp error: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Assign a DLP (Designated Liaison Person) to an incident.
     */
    public function assignDlp(int $incidentId, int $dlpUserId, int $adminId, int $tenantId): bool
    {
        try {
            // Validate the DLP user exists in this tenant AND has a role that
            // can actually act on the assignment. The bell points at
            // /broker/safeguarding which is gated by BrokerRoute (admin /
            // tenant_admin / super_admin / broker / coordinator). Assigning a
            // regular member as DLP would send them a bell that bounces back
            // to /dashboard.
            $dlpUser = User::where('id', $dlpUserId)
                ->where('tenant_id', $tenantId)
                ->where('status', 'active')
                ->whereIn('role', ['admin', 'tenant_admin', 'super_admin', 'broker', 'coordinator'])
                ->first();

            if (!$dlpUser) {
                Log::warning('SafeguardingService::assignDlp: DLP user not found, inactive, or lacks broker-tier role', [
                    'dlp_user_id' => $dlpUserId, 'tenant_id' => $tenantId,
                ]);
                return false;
            }

            // Verify the incident exists
            $incident = DB::table('vol_safeguarding_incidents')
                ->where('id', $incidentId)
                ->where('tenant_id', $tenantId)
                ->first();

            if (!$incident) {
                return false;
            }

            DB::table('vol_safeguarding_incidents')
                ->where('id', $incidentId)
                ->where('tenant_id', $tenantId)
                ->update([
                    'assigned_to' => $dlpUserId,
                    'updated_at' => now(),
                ]);

            $this->logActivity($adminId, 'safeguarding_dlp_assigned', 'safeguarding_incident', $incidentId, [
                'dlp_user_id' => $dlpUserId,
            ]);

            // Notify the assigned DLP (bell notification + email) — render in DLP's preferred locale
            LocaleContext::withLocale($dlpUser, function () use ($dlpUser, $dlpUserId, $tenantId, $incidentId, $incident) {
                try {
                    \App\Models\Notification::create([
                        'tenant_id' => $tenantId,
                        'user_id' => $dlpUserId,
                        'type' => 'safeguarding_assignment',
                        'message' => __('emails_misc.safeguarding.dlp_assigned_bell', ['incident_id' => $incidentId]),
                        'link' => '/broker/safeguarding',
                        'is_read' => false,
                    ]);
                } catch (\Throwable $notifError) {
                    Log::critical('SafeguardingService::assignDlp: failed to create DLP bell notification', [
                        'dlp_user_id' => $dlpUserId,
                        'incident_id' => $incidentId,
                        'error' => $notifError->getMessage(),
                    ]);
                }

                // Email the assigned DLP — DLP assignment is critical and time-sensitive
                // Safeguarding emails bypass user preferences — always send
                if (!empty($dlpUser->email)) {
                    try {
                        $severityLabel = strtoupper($incident->severity ?? 'UNKNOWN');
                        $dlpName = trim(($dlpUser->first_name ?? '') . ' ' . ($dlpUser->last_name ?? '')) ?: ($dlpUser->name ?? 'Team member');

                        $safeDlpName = htmlspecialchars($dlpName, ENT_QUOTES, 'UTF-8');
                        $safeTitle = htmlspecialchars($incident->title ?? 'N/A', ENT_QUOTES, 'UTF-8');
                        $safeSeverity = htmlspecialchars($severityLabel, ENT_QUOTES, 'UTF-8');

                        $emailBody = EmailTemplateBuilder::make()
                            ->theme('danger')
                            ->title(__('emails_misc.safeguarding.dlp_assigned_title', ['incident_id' => $incidentId]))
                            ->previewText(__('emails_misc.safeguarding.dlp_assigned_preview', ['severity' => $safeSeverity, 'incident_id' => $incidentId]))
                            ->greeting($safeDlpName)
                            ->highlight(__('emails_misc.safeguarding.dlp_assigned_highlight'), '🚨')
                            ->infoCard([
                                __('emails_misc.safeguarding.info_card_incident') => "#{$incidentId}",
                                __('emails_misc.safeguarding.info_card_severity') => $safeSeverity,
                                __('emails_misc.safeguarding.info_card_title')    => $safeTitle,
                            ], __('emails_misc.safeguarding.info_card_incident_details'))
                            ->paragraph(__('emails_misc.safeguarding.dlp_assigned_body'))
                            ->paragraph(__('emails_misc.safeguarding.dlp_assigned_audit_note'))
                            ->button(__('emails_misc.safeguarding.dlp_assigned_cta'), EmailTemplateBuilder::tenantUrl('/broker/safeguarding'))
                            ->render();

                        $subject = __('emails_misc.safeguarding.dlp_assigned_subject', ['severity' => $severityLabel, 'incident_id' => $incidentId]);
                        $sent = EmailDispatchService::sendRaw($dlpUser->email, $subject, $emailBody, null, null, null, 'safeguarding', ['tenant_id' => $tenantId]);
                        if (!$sent) {
                            Log::critical('SafeguardingService::assignDlp: DLP assignment email failed to send', [
                                'dlp_user_id' => $dlpUserId,
                                'dlp_email' => $dlpUser->email,
                                'incident_id' => $incidentId,
                            ]);
                        }
                    } catch (\Throwable $emailError) {
                        Log::critical('SafeguardingService::assignDlp: DLP assignment email exception', [
                            'dlp_user_id' => $dlpUserId,
                            'incident_id' => $incidentId,
                            'error' => $emailError->getMessage(),
                        ]);
                    }
                }
            });

            return true;
        } catch (\Throwable $e) {
            Log::error('SafeguardingService::assignDlp error: ' . $e->getMessage());
            return false;
        }
    }

    // =========================================================================
    // INCIDENT NOTIFICATIONS
    // =========================================================================

    /**
     * Notify all admins/brokers of a new safeguarding incident.
     */
    private function notifyAdminsOfIncident(int $tenantId, int $reporterId, int $incidentId, string $title, string $severity, string $type): void
    {
        try {
            $reporter = User::where('tenant_id', $tenantId)
                ->where('id', $reporterId)
                ->first(['first_name', 'last_name']);
            $reporterName = $reporter ? trim(($reporter->first_name ?? '') . ' ' . ($reporter->last_name ?? '')) : __('emails_misc.safeguarding.reporter_fallback_name');

            $staffUsers = DB::select(
                "SELECT id, email, preferred_language FROM users WHERE tenant_id = ? AND role IN ('admin', 'tenant_admin', 'broker', 'super_admin') AND status = 'active'",
                [$tenantId]
            );

            $severityLabel = strtoupper($severity);

            foreach ($staffUsers as $staff) {
                LocaleContext::withLocale($staff, function () use ($staff, $tenantId, $incidentId, $reporterName, $title, $severity, $severityLabel, $type) {
                    $message = __('emails_misc.safeguarding.incident_reported_bell', ['severity' => $severityLabel, 'reporter' => $reporterName, 'title' => $title]);

                    \App\Models\Notification::create([
                        'tenant_id' => $tenantId,
                        'user_id' => $staff->id,
                        'type' => 'safeguarding_flag',
                        'message' => $message,
                        'link' => '/broker/safeguarding',
                        'is_read' => false,
                    ]);

                    // Send email for ALL safeguarding incidents (legal requirement)
                    // Severity label is included in subject for prioritization
                    if (!empty($staff->email)) {
                        try {
                            $safeReporterName = htmlspecialchars($reporterName, ENT_QUOTES, 'UTF-8');
                            $safeTitle = htmlspecialchars($title, ENT_QUOTES, 'UTF-8');
                            $safeSeverity = htmlspecialchars($severityLabel, ENT_QUOTES, 'UTF-8');
                            $safeType = htmlspecialchars($type, ENT_QUOTES, 'UTF-8');

                            $emailBody = EmailTemplateBuilder::make()
                                ->theme('danger')
                                ->title(__('emails_misc.safeguarding.incident_reported_title'))
                                ->previewText(__('emails_misc.safeguarding.incident_reported_preview', ['severity' => $safeSeverity, 'type' => $safeType, 'reporter' => $safeReporterName]))
                                ->highlight(__('emails_misc.safeguarding.incident_reported_highlight', ['severity' => $safeSeverity]), '🚨')
                                ->infoCard([
                                    __('emails_misc.safeguarding.info_card_reported_by') => $safeReporterName,
                                    __('emails_misc.safeguarding.info_card_title')       => $safeTitle,
                                    __('emails_misc.safeguarding.info_card_severity')    => $safeSeverity,
                                    __('emails_misc.safeguarding.info_card_type')        => $safeType,
                                ], __('emails_misc.safeguarding.info_card_incident_details'))
                                ->paragraph(__('emails_misc.safeguarding.incident_reported_review'))
                                ->paragraph(__('emails_misc.safeguarding.incident_reported_auto_note'))
                                ->button(__('emails_misc.safeguarding.incident_reported_cta'), EmailTemplateBuilder::tenantUrl('/broker/safeguarding'))
                                ->render();

                            $sent = EmailDispatchService::sendRaw(
                                $staff->email,
                                __('emails_misc.safeguarding.incident_reported_subject', ['severity' => $severityLabel, 'title' => $title]),
                                $emailBody,
                                null,
                                null,
                                null,
                                'safeguarding',
                                ['tenant_id' => $tenantId]
                            );
                            if (!$sent) {
                                Log::critical('SafeguardingService: safeguarding incident email failed to send', [
                                    'staff_id' => $staff->id,
                                    'incident_id' => $incidentId,
                                    'severity' => $severity,
                                ]);
                            }
                        } catch (\Throwable $emailError) {
                            Log::critical('SafeguardingService: safeguarding incident email exception', [
                                'staff_id' => $staff->id,
                                'incident_id' => $incidentId,
                                'severity' => $severity,
                                'error' => $emailError->getMessage(),
                            ]);
                        }
                    }
                });
            }
        } catch (\Throwable $e) {
            Log::error('SafeguardingService::notifyAdminsOfIncident error: ' . $e->getMessage());
        }
    }

    /**
     * Notify reporter and DLP when an incident status changes.
     */
    private function notifyIncidentStatusChange(int $tenantId, int $incidentId, int $reporterId, ?int $dlpUserId, string $newStatus): void
    {
        try {
            $statusLabels = [
                'open' => __('emails_misc.safeguarding.status_open'),
                'investigating' => __('emails_misc.safeguarding.status_investigating'),
                'escalated' => __('emails_misc.safeguarding.status_escalated'),
                'resolved' => __('emails_misc.safeguarding.status_resolved'),
                'closed' => __('emails_misc.safeguarding.status_closed'),
            ];
            $label = $statusLabels[$newStatus] ?? $newStatus;

            // Notify reporter (bell) — render in reporter's locale
            $reporterForBell = User::where('tenant_id', $tenantId)
                ->where('id', $reporterId)
                ->first(['id', 'preferred_language']);
            LocaleContext::withLocale($reporterForBell, function () use ($reporterForBell, $tenantId, $reporterId, $incidentId, $label) {
                \App\Models\Notification::create([
                    'tenant_id' => $tenantId,
                    'user_id' => $reporterId,
                    'type' => 'safeguarding_flag',
                    'message' => __('emails_misc.safeguarding.incident_status_changed', ['incident_id' => $incidentId, 'status' => $label]),
                    'link' => '/safeguarding/incidents',
                    'is_read' => false,
                ]);
            });

            // Notify assigned DLP if different from reporter (bell) — render in DLP's locale
            if ($dlpUserId && $dlpUserId !== $reporterId) {
                $dlpForBell = User::where('tenant_id', $tenantId)
                    ->where('id', $dlpUserId)
                    ->first(['id', 'preferred_language']);
                LocaleContext::withLocale($dlpForBell, function () use ($dlpForBell, $tenantId, $dlpUserId, $incidentId, $label) {
                    \App\Models\Notification::create([
                        'tenant_id' => $tenantId,
                        'user_id' => $dlpUserId,
                        'type' => 'safeguarding_assignment',
                        'message' => __('emails_misc.safeguarding.incident_status_dlp_bell', ['incident_id' => $incidentId, 'status' => $label]),
                        'link' => '/broker/safeguarding',
                        'is_read' => false,
                    ]);
                });
            }

            // Also email the reporter about status changes (always, regardless of severity)
            try {
                $reporter = DB::table('users')
                    ->where('id', $reporterId)
                    ->where('tenant_id', $tenantId)
                    ->select(['email', 'first_name', 'name', 'preferred_language'])
                    ->first();

                if ($reporter && !empty($reporter->email)) {
                    TenantContext::runForTenant($tenantId, function () use ($reporter, $incidentId, $label, $newStatus, $tenantId, $reporterId) {
                        LocaleContext::withLocale($reporter, function () use ($reporter, $incidentId, $label, $newStatus, $tenantId, $reporterId) {
                        $firstName = $reporter->first_name ?? $reporter->name ?? __('emails.common.fallback_name');
                        $safeLabel = htmlspecialchars($label, ENT_QUOTES, 'UTF-8');

                        $html = \App\Core\EmailTemplateBuilder::make()
                            ->theme($newStatus === 'resolved' ? 'success' : 'brand')
                            ->title(__('emails_misc.safeguarding.reporter_status_title'))
                            ->previewText(__('emails_misc.safeguarding.reporter_status_preview', ['status' => $safeLabel]))
                            ->greeting($firstName)
                            ->paragraph(__('emails_misc.safeguarding.reporter_status_body', ['incident_id' => $incidentId, 'status' => $safeLabel]))
                            ->paragraph(__('emails_misc.safeguarding.reporter_status_confidentiality'))
                            ->render();

                        $subject = __('emails_misc.safeguarding.reporter_status_subject', ['incident_id' => $incidentId, 'status' => $safeLabel]);

                        if (!EmailDispatchService::sendRaw($reporter->email, $subject, $html, null, null, null, 'safeguarding', ['tenant_id' => $tenantId])) {
                            Log::warning('[SafeguardingService] reporter status email send returned false', [
                                'reporter_id' => $reporterId,
                                'incident_id' => $incidentId,
                            ]);
                        }
                        });
                    });
                }
            } catch (\Throwable $emailEx) {
                Log::warning('[SafeguardingService] reporter status email failed: ' . $emailEx->getMessage());
            }

            // Send email for status changes on high/critical incidents
            // Safeguarding emails bypass user preferences — always send
            $incident = DB::table('vol_safeguarding_incidents')
                ->where('id', $incidentId)
                ->where('tenant_id', $tenantId)
                ->first();

            if ($incident && in_array($incident->severity, ['high', 'critical'])) {
                $severityLabel = strtoupper($incident->severity);
                $safeSeverity = htmlspecialchars($severityLabel, ENT_QUOTES, 'UTF-8');
                $safeLabel = htmlspecialchars($label, ENT_QUOTES, 'UTF-8');

                $renderForRecipient = function () use ($severityLabel, $safeSeverity, $safeLabel, $incidentId, $label) {
                    $emailBody = EmailTemplateBuilder::make()
                        ->theme('danger')
                        ->title(__('emails_misc.safeguarding.incident_updated_title'))
                        ->previewText(__('emails_misc.safeguarding.incident_updated_preview', ['severity' => $safeSeverity, 'incident_id' => $incidentId, 'status' => $safeLabel]))
                        ->infoCard([
                            __('emails_misc.safeguarding.info_card_incident')   => "#{$incidentId}",
                            __('emails_misc.safeguarding.info_card_new_status') => $safeLabel,
                            __('emails_misc.safeguarding.info_card_severity')   => $safeSeverity,
                        ], __('emails_misc.safeguarding.info_card_status_update'))
                        ->paragraph(__('emails_misc.safeguarding.incident_updated_review'))
                        ->paragraph(__('emails_misc.safeguarding.incident_reported_auto_note'))
                        ->button(__('emails_misc.safeguarding.dlp_assigned_cta'), EmailTemplateBuilder::tenantUrl('/broker/safeguarding'))
                        ->render();

                    $emailSubject = __('emails_misc.safeguarding.incident_updated_subject', ['severity' => $severityLabel, 'incident_id' => $incidentId, 'status' => $label]);

                    return [$emailSubject, $emailBody];
                };

                // Email the reporter — render in reporter's locale
                $reporter = User::where('tenant_id', $tenantId)
                    ->where('id', $reporterId)
                    ->first();
                if ($reporter && !empty($reporter->email)) {
                    LocaleContext::withLocale($reporter, function () use ($reporter, $reporterId, $incidentId, $tenantId, $renderForRecipient) {
                        try {
                            [$subject, $body] = $renderForRecipient();
                            $sent = EmailDispatchService::sendRaw($reporter->email, $subject, $body, null, null, null, 'safeguarding', ['tenant_id' => $tenantId]);
                            if (!$sent) {
                                Log::critical('SafeguardingService: status change email failed for reporter', [
                                    'reporter_id' => $reporterId,
                                    'incident_id' => $incidentId,
                                ]);
                            }
                        } catch (\Throwable $emailError) {
                            Log::critical('SafeguardingService: status change email exception for reporter', [
                                'reporter_id' => $reporterId,
                                'incident_id' => $incidentId,
                                'error' => $emailError->getMessage(),
                            ]);
                        }
                    });
                }

                // Email the assigned DLP if different from reporter — render in DLP's locale
                if ($dlpUserId && $dlpUserId !== $reporterId) {
                    $dlpUser = User::where('tenant_id', $tenantId)
                        ->where('id', $dlpUserId)
                        ->first();
                    if ($dlpUser && !empty($dlpUser->email)) {
                        LocaleContext::withLocale($dlpUser, function () use ($dlpUser, $dlpUserId, $incidentId, $tenantId, $renderForRecipient) {
                            try {
                                [$subject, $body] = $renderForRecipient();
                                $sent = EmailDispatchService::sendRaw($dlpUser->email, $subject, $body, null, null, null, 'safeguarding', ['tenant_id' => $tenantId]);
                                if (!$sent) {
                                    Log::critical('SafeguardingService: status change email failed for DLP', [
                                        'dlp_user_id' => $dlpUserId,
                                        'incident_id' => $incidentId,
                                    ]);
                                }
                            } catch (\Throwable $emailError) {
                                Log::critical('SafeguardingService: status change email exception for DLP', [
                                    'dlp_user_id' => $dlpUserId,
                                    'incident_id' => $incidentId,
                                    'error' => $emailError->getMessage(),
                                ]);
                            }
                        });
                    }
                }
            }
        } catch (\Throwable $e) {
            Log::error('SafeguardingService::notifyIncidentStatusChange error: ' . $e->getMessage());
        }
    }

    // =========================================================================
    // AUDIT LOGGING
    // =========================================================================

    private function formatIncidentRow(array $row): array
    {
        $subjectName = $row['subject_user_name']
            ?? $row['involved_user_name']
            ?? $row['subject_name']
            ?? null;

        $row['type'] = $row['incident_type'] ?? $row['type'] ?? 'other';
        $row['reporter_name'] = $row['reported_by_name'] ?? $row['reporter_name'] ?? null;
        $row['subject_name'] = $subjectName;
        $row['date'] = $row['incident_date'] ?? $row['created_at'] ?? null;
        $row['dlp_user_id'] = $row['assigned_to'] ?? $row['dlp_user_id'] ?? null;
        $row['dlp_user_name'] = $row['assigned_to_name'] ?? $row['dlp_user_name'] ?? null;

        return $row;
    }

    private function logActivity(int $userId, string $action, string $entityType, ?int $entityId, array $details = []): void
    {
        try {
            DB::table('activity_log')->insert([
                'tenant_id' => TenantContext::getId(),
                'user_id' => $userId,
                'action' => $action,
                'action_type' => 'safeguarding',
                'entity_type' => $entityType,
                'entity_id' => $entityId,
                'details' => json_encode($details),
                'ip_address' => request()?->ip(),
                'created_at' => now(),
            ]);
        } catch (\Throwable $e) {
            Log::error('SafeguardingService: failed to log activity', ['action' => $action, 'error' => $e->getMessage()]);
        }
    }

    private function activeUserBelongsToTenant(int $userId, int $tenantId): bool
    {
        return User::where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->exists();
    }
}
