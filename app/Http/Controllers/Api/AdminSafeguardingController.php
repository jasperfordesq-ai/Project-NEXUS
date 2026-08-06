<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\TenantSafeguardingOption;
use App\Models\UserSafeguardingPreference;
use App\Services\EmailDispatchService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * AdminSafeguardingController -- Admin safeguarding module endpoints.
 *
 * Provides dashboard stats, flagged message management, guardian assignment
 * CRUD, and member safeguarding preference review for the admin panel.
 *
 * Frontend contract: react-frontend/src/admin/modules/safeguarding/SafeguardingDashboard.tsx
 */
class AdminSafeguardingController extends BaseApiController
{
    protected bool $isV2Api = true;

    /**
     * GET /v2/admin/safeguarding/dashboard
     *
     * Returns aggregate stats matching the SafeguardingDashboard frontend:
     * { active_assignments, unreviewed_flags, consented_wards, total_flags_this_month, critical_flags }
     */
    public function dashboard(): JsonResponse
    {
        $this->requireSafeguardingStaff('view');
        $tenantId = $this->getTenantId();

        $activeAssignments = 0;
        $unreviewedFlags = 0;
        $consentedWards = 0;
        $totalFlagsThisMonth = 0;
        $criticalFlags = 0;

        // Active safeguarding assignments (not revoked, consent given)
        try {
            $activeAssignments = (int) DB::table('safeguarding_assignments')
                ->where('tenant_id', $tenantId)
                ->whereNull('revoked_at')
                ->count();
        } catch (\Illuminate\Database\QueryException $e) {
            if (!$this->isTableNotFound($e)) {
                throw $e;
            }
        }

        // Unreviewed broker message copies (pending review)
        try {
            $unreviewedFlags = (int) DB::table('broker_message_copies')
                ->where('tenant_id', $tenantId)
                ->whereNull('reviewed_at')
                ->count();
        } catch (\Illuminate\Database\QueryException $e) {
            if (!$this->isTableNotFound($e)) {
                throw $e;
            }
        }

        // Consented wards (assignments where the ward has given consent)
        try {
            $consentedWards = (int) DB::table('safeguarding_assignments')
                ->where('tenant_id', $tenantId)
                ->whereNull('revoked_at')
                ->whereNotNull('consent_given_at')
                ->count();
        } catch (\Illuminate\Database\QueryException $e) {
            if (!$this->isTableNotFound($e)) {
                throw $e;
            }
        }

        // Total flags this month (broker message copies created this month)
        try {
            $totalFlagsThisMonth = (int) DB::table('broker_message_copies')
                ->where('tenant_id', $tenantId)
                ->where('created_at', '>=', now()->startOfMonth())
                ->count();
        } catch (\Illuminate\Database\QueryException $e) {
            if (!$this->isTableNotFound($e)) {
                throw $e;
            }
        }

        // Critical: flagged copies + unreviewed safeguarding incidents
        try {
            $criticalFlags = (int) DB::table('broker_message_copies')
                ->where('tenant_id', $tenantId)
                ->where('flagged', true)
                ->whereNull('reviewed_at')
                ->count();
        } catch (\Illuminate\Database\QueryException $e) {
            if (!$this->isTableNotFound($e)) {
                throw $e;
            }
        }

        // Also count unreviewed safeguarding incidents as critical.
        // vol_safeguarding_incidents.status enum is
        // ('open','investigating','resolved','escalated','closed') — terminal
        // states are 'resolved' and 'closed', so an incident under
        // active investigation OR escalated to authorities is STILL open
        // from the dashboard's "needs attention" perspective. The previous
        // `status = 'open'` filter silently dropped both, under-counting
        // the most consequential category of safeguarding work.
        try {
            $criticalFlags += (int) DB::table('vol_safeguarding_incidents')
                ->where('tenant_id', $tenantId)
                ->whereIn('severity', ['high', 'critical'])
                ->whereIn('status', ['open', 'investigating', 'escalated'])
                ->count();
        } catch (\Illuminate\Database\QueryException $e) {
            // Table may not exist yet
        }

        return $this->respondWithData([
            'active_assignments' => $activeAssignments,
            'unreviewed_flags' => $unreviewedFlags,
            'consented_wards' => $consentedWards,
            'total_flags_this_month' => $totalFlagsThisMonth,
            'critical_flags' => $criticalFlags,
        ]);
    }

    /**
     * GET /v2/admin/safeguarding/flagged-messages
     *
     * Returns broker message copies as flagged messages in the shape the frontend expects:
     * { id, message_content, sender: { id, name, avatar_url }, recipient: { id, name, avatar_url },
     *   severity, flag_reason, is_reviewed, reviewed_by, review_notes, reviewed_at, created_at }
     */
    public function flaggedMessages(): JsonResponse
    {
        $this->requireSafeguardingStaff('view');
        $tenantId = $this->getTenantId();

        $page = $this->queryInt('page', 1, 1);
        $limit = $this->queryInt('limit', 50, 1, 200);
        $offset = ($page - 1) * $limit;

        try {
            $baseQuery = DB::table('broker_message_copies as bmc')
                ->where('bmc.tenant_id', $tenantId);

            $total = (int) (clone $baseQuery)->count();

            $copies = $baseQuery
                ->leftJoin('users as sender', 'bmc.sender_id', '=', 'sender.id')
                ->leftJoin('users as receiver', 'bmc.receiver_id', '=', 'receiver.id')
                ->leftJoin('users as reviewer', 'bmc.reviewed_by', '=', 'reviewer.id')
                ->select([
                    'bmc.id',
                    'bmc.original_message_id as message_id',
                    'bmc.message_body as message_content',
                    'bmc.sender_id',
                    DB::raw("COALESCE(sender.name, CONCAT(COALESCE(sender.first_name, ''), ' ', COALESCE(sender.last_name, ''))) as sender_name"),
                    'sender.avatar_url as sender_avatar',
                    'bmc.receiver_id',
                    DB::raw("COALESCE(receiver.name, CONCAT(COALESCE(receiver.first_name, ''), ' ', COALESCE(receiver.last_name, ''))) as receiver_name"),
                    'receiver.avatar_url as receiver_avatar',
                    'bmc.copy_reason',
                    'bmc.flagged',
                    'bmc.reviewed_by as reviewed_by_id',
                    DB::raw("COALESCE(reviewer.name, CONCAT(COALESCE(reviewer.first_name, ''), ' ', COALESCE(reviewer.last_name, ''))) as reviewed_by_name"),
                    'bmc.reviewed_at',
                    'bmc.review_notes',
                    'bmc.created_at',
                ])
                ->orderByDesc('bmc.flagged')
                ->orderByDesc('bmc.created_at')
                ->limit($limit)
                ->offset($offset)
                ->get()
                ->map(function ($row) {
                    $severity = 'low';
                    if ($row->flagged) {
                        $severity = 'high';
                    } elseif ($row->copy_reason === 'flagged_user') {
                        $severity = 'medium';
                    }

                    return [
                        'id' => (int) $row->id,
                        'message_id' => (int) $row->message_id,
                        'message_content' => $row->message_content ?? '',
                        'sender' => [
                            'id' => (int) $row->sender_id,
                            'name' => trim($row->sender_name ?? ''),
                            'avatar_url' => $row->sender_avatar,
                        ],
                        'recipient' => [
                            'id' => (int) $row->receiver_id,
                            'name' => trim($row->receiver_name ?? ''),
                            'avatar_url' => $row->receiver_avatar,
                        ],
                        'severity' => $severity,
                        'flag_reason' => $row->copy_reason ?? 'unknown',
                        'is_reviewed' => $row->reviewed_at !== null,
                        'reviewed_by' => $row->reviewed_by_name ? trim($row->reviewed_by_name) : null,
                        'review_notes' => $row->review_notes ?? null,
                        'reviewed_at' => $row->reviewed_at,
                        'created_at' => $row->created_at,
                    ];
                })
                ->toArray();

            return $this->respondWithPaginatedCollection($copies, $total, $page, $limit);
        } catch (\Illuminate\Database\QueryException $e) {
            if ($this->isTableNotFound($e)) {
                return $this->respondWithPaginatedCollection([], 0, 1, $limit);
            }
            throw $e;
        }
    }

    /**
     * GET /v2/admin/safeguarding/assignments
     *
     * Returns guardian assignments in the shape the frontend expects:
     * { id, ward: { id, name, avatar_url }, guardian: { id, name, avatar_url },
     *   status, consent_given, created_at, expires_at }
     */
    public function assignments(): JsonResponse
    {
        $this->requireSafeguardingStaff('view');
        $tenantId = $this->getTenantId();

        try {
            $assignments = DB::table('safeguarding_assignments as sa')
                ->join('users as ward', 'sa.ward_user_id', '=', 'ward.id')
                ->join('users as guardian', 'sa.guardian_user_id', '=', 'guardian.id')
                ->where('sa.tenant_id', $tenantId)
                ->select([
                    'sa.id',
                    'sa.ward_user_id',
                    DB::raw("COALESCE(ward.name, CONCAT(COALESCE(ward.first_name, ''), ' ', COALESCE(ward.last_name, ''))) as ward_name"),
                    'ward.avatar_url as ward_avatar',
                    'sa.guardian_user_id',
                    DB::raw("COALESCE(guardian.name, CONCAT(COALESCE(guardian.first_name, ''), ' ', COALESCE(guardian.last_name, ''))) as guardian_name"),
                    'guardian.avatar_url as guardian_avatar',
                    'sa.consent_given_at',
                    'sa.revoked_at',
                    'sa.assigned_at',
                    'sa.notes',
                ])
                ->orderByDesc('sa.assigned_at')
                ->get()
                ->map(function ($row) {
                    $status = 'pending';
                    if ($row->revoked_at !== null) {
                        $status = 'revoked';
                    } elseif ($row->consent_given_at !== null) {
                        $status = 'active';
                    }

                    return [
                        'id' => (int) $row->id,
                        'ward' => [
                            'id' => (int) $row->ward_user_id,
                            'name' => trim($row->ward_name ?? ''),
                            'avatar_url' => $row->ward_avatar,
                        ],
                        'guardian' => [
                            'id' => (int) $row->guardian_user_id,
                            'name' => trim($row->guardian_name ?? ''),
                            'avatar_url' => $row->guardian_avatar,
                        ],
                        'status' => $status,
                        'consent_given' => $row->consent_given_at !== null,
                        'created_at' => $row->assigned_at,
                        'expires_at' => null,
                    ];
                })
                ->toArray();

            return $this->respondWithData($assignments);
        } catch (\Illuminate\Database\QueryException $e) {
            if ($this->isTableNotFound($e) || str_contains($e->getMessage(), 'Column not found')) {
                return $this->respondWithData([]);
            }
            throw $e;
        }
    }

    /**
     * POST /v2/admin/safeguarding/flagged-messages/{id}/review
     *
     * Reviews a flagged message (broker_message_copies). Frontend sends { notes }.
     * Marks the copy as reviewed by the current admin.
     */
    public function reviewMessage(Request $request, int $id): JsonResponse
    {
        $adminId = $this->requireSafeguardingStaff('manage');
        $tenantId = $this->getTenantId();

        $notes = $request->input('notes', '');

        try {
            $updateData = [
                'reviewed_by' => $adminId,
                'reviewed_at' => now(),
            ];
            if (!empty($notes)) {
                $updateData['action_notes'] = $notes;
                $updateData['action_taken'] = 'reviewed';
            }

            $affected = DB::table('broker_message_copies')
                ->where('id', $id)
                ->where('tenant_id', $tenantId)
                ->whereNull('reviewed_at')
                ->update(array_merge($updateData, [
                    'review_notes' => !empty($notes) ? $notes : null,
                ]));

            if ($affected === 0) {
                return $this->respondWithError(
                    'NOT_FOUND',
                    __('api.safeguarding_message_not_found_or_reviewed'),
                    null,
                    404
                );
            }

            // Audit log the review
            DB::table('activity_log')->insert([
                'tenant_id' => $tenantId,
                'user_id' => $adminId,
                'action' => 'safeguarding_message_reviewed',
                'action_type' => 'safeguarding',
                'entity_type' => 'broker_message_copy',
                'entity_id' => $id,
                'details' => json_encode(['notes' => $notes]),
                'ip_address' => request()?->ip(),
                'created_at' => now(),
            ]);

            return $this->respondWithData(['reviewed' => true]);
        } catch (\Illuminate\Database\QueryException $e) {
            if ($this->isTableNotFound($e)) {
                return $this->respondWithError(
                    'TABLE_NOT_FOUND',
                    __('api.safeguarding_tables_not_created'),
                    null,
                    404
                );
            }
            throw $e;
        }
    }

    /**
     * POST /v2/admin/safeguarding/assignments
     *
     * Creates a new safeguarding (guardian/ward) assignment.
     * Accepts either user IDs or email addresses:
     *   { user_id, assignee_id } OR { ward_email, guardian_email }
     */
    public function createAssignment(Request $request): JsonResponse
    {
        $adminId = $this->requireSafeguardingStaff('manage');
        $tenantId = $this->getTenantId();

        $wardId = null;
        $guardianId = null;

        // Support both ID-based and email-based input from the frontend
        if ($request->has('ward_email') || $request->has('guardian_email')) {
            $wardEmail = trim($request->input('ward_email', ''));
            $guardianEmail = trim($request->input('guardian_email', ''));

            if (empty($wardEmail) || empty($guardianEmail)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.ward_guardian_emails_required'), null, 422);
            }

            $ward = \App\Models\User::where('email', $wardEmail)
                ->where('tenant_id', $tenantId)
                ->where('status', 'active')
                ->first();
            $guardian = \App\Models\User::where('email', $guardianEmail)
                ->where('tenant_id', $tenantId)
                ->where('status', 'active')
                ->first();

            if (!$ward) {
                return $this->respondWithError('INVALID_USER', __('api.no_active_member_found', ['email' => $wardEmail]), 'ward_email', 404);
            }
            if (!$guardian) {
                return $this->respondWithError('INVALID_USER', __('api.no_active_member_found', ['email' => $guardianEmail]), 'guardian_email', 404);
            }

            $wardId = $ward->id;
            $guardianId = $guardian->id;
        } else {
            $validated = $request->validate([
                'user_id' => 'required|integer',
                'assignee_id' => 'required|integer',
            ]);

            $wardId = $validated['user_id'];
            $guardianId = $validated['assignee_id'];

            // Validate both users belong to current tenant
            if (!\App\Models\User::where('id', $wardId)->where('tenant_id', $tenantId)->exists()) {
                return $this->respondWithError('INVALID_USER', __('api.ward_not_found_in_tenant'), 'user_id', 404);
            }
            if (!\App\Models\User::where('id', $guardianId)->where('tenant_id', $tenantId)->exists()) {
                return $this->respondWithError('INVALID_USER', __('api.guardian_not_found_in_tenant'), 'assignee_id', 404);
            }
        }

        if ($wardId === $guardianId) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.ward_guardian_same_person'), null, 422);
        }

        $notes = $request->input('notes', '');

        try {
            $id = DB::table('safeguarding_assignments')->insertGetId([
                'tenant_id' => $tenantId,
                'ward_user_id' => $wardId,
                'guardian_user_id' => $guardianId,
                'assigned_by' => $adminId,
                'assigned_at' => now(),
                'notes' => $notes ?: null,
            ]);

            // Audit log
            DB::table('activity_log')->insert([
                'tenant_id' => $tenantId,
                'user_id' => $adminId,
                'action' => 'safeguarding_assignment_created',
                'action_type' => 'safeguarding',
                'entity_type' => 'safeguarding_assignment',
                'entity_id' => $id,
                'details' => json_encode([
                    'ward_user_id' => $wardId,
                    'guardian_user_id' => $guardianId,
                ]),
                'ip_address' => request()?->ip(),
                'created_at' => now(),
            ]);

            // Notify both the ward and guardian. Each recipient gets their
            // bell + email in their OWN preferred_language — wrap each block
            // in LocaleContext::withLocale($recipient, ...). Both User rows
            // are tenant-scoped (validated above at lines 411/414).
            try {
                $wardUser = \App\Models\User::where('id', $wardId)->where('tenant_id', $tenantId)->first();
                $guardianUser = \App\Models\User::where('id', $guardianId)->where('tenant_id', $tenantId)->first();

                $communityName = TenantContext::getName() ?: __('emails.common.fallback_tenant_name');
                $wardDisplayName = $wardUser->name ?? null;
                $guardianDisplayName = $guardianUser->name ?? null;

                // Bell + email — guardian (rendered in guardian's locale)
                if ($guardianUser) {
                    LocaleContext::withLocale($guardianUser, function () use ($tenantId, $guardianId, $guardianUser, $wardUser, $wardDisplayName, $communityName) {
                        \App\Models\Notification::create([
                            'tenant_id' => $tenantId,
                            'user_id' => $guardianId,
                            'type' => 'safeguarding_assignment',
                            'message' => __('api_controllers_1.admin_safeguarding.guardian_assigned_notification', ['name' => $wardDisplayName ?? __('api_controllers_1.admin_safeguarding.a_member')]),
                            'link' => '/settings?tab=safeguarding',
                            'is_read' => false,
                        ]);

                        if (!empty($guardianUser->email)) {
                            $guardianName = trim(($guardianUser->first_name ?? '') . ' ' . ($guardianUser->last_name ?? '')) ?: ($guardianUser->name ?? '');
                            $wardName = trim(($wardUser->first_name ?? '') . ' ' . ($wardUser->last_name ?? '')) ?: ($wardUser->name ?? __('api_controllers_1.admin_safeguarding.a_member'));
                            $safeGuardian = htmlspecialchars($guardianName, ENT_QUOTES, 'UTF-8');
                            $safeWard = htmlspecialchars($wardName, ENT_QUOTES, 'UTF-8');
                            $safeCommunity = htmlspecialchars($communityName, ENT_QUOTES, 'UTF-8');
                            $html = EmailTemplateBuilder::make()
                                ->theme('info')
                                ->title(__('emails_misc.safeguarding.guardian_assigned_title'))
                                ->previewText(__('emails_misc.safeguarding.guardian_assigned_preview', ['name' => $safeWard]))
                                ->greeting($safeGuardian)
                                ->paragraph(__('emails_misc.safeguarding.guardian_assigned_body', ['name' => $safeWard, 'community' => $safeCommunity]))
                                ->paragraph('<em>' . __('emails_misc.safeguarding.guardian_assigned_audit_note') . '</em>')
                                ->button(__('emails_misc.safeguarding.guardian_assigned_cta'), EmailTemplateBuilder::tenantUrl('/settings?tab=safeguarding'))
                                ->render();
                            $subject = __('emails_misc.safeguarding.guardian_assigned_subject');
                            if (!EmailDispatchService::sendRaw($guardianUser->email, $subject, $html, null, null, null, 'safeguarding', ['tenant_id' => $tenantId])) {
                                \Illuminate\Support\Facades\Log::warning('AdminSafeguardingController: guardian assignment email failed', ['guardian_id' => $guardianId]);
                            }
                        }
                    });
                }

                // Bell + email — ward (rendered in ward's locale)
                if ($wardUser) {
                    LocaleContext::withLocale($wardUser, function () use ($tenantId, $wardId, $wardUser, $guardianUser, $guardianDisplayName, $communityName) {
                        \App\Models\Notification::create([
                            'tenant_id' => $tenantId,
                            'user_id' => $wardId,
                            'type' => 'safeguarding_assignment',
                            'message' => __('api_controllers_1.admin_safeguarding.ward_assigned_notification', ['guardian' => $guardianDisplayName ?? __('api_controllers_1.admin_safeguarding.a_coordinator')]),
                            'link' => '/settings?tab=safeguarding',
                            'is_read' => false,
                        ]);

                        if (!empty($wardUser->email)) {
                            $wardName2 = trim(($wardUser->first_name ?? '') . ' ' . ($wardUser->last_name ?? '')) ?: ($wardUser->name ?? '');
                            $guardianDisplay = trim(($guardianUser->first_name ?? '') . ' ' . ($guardianUser->last_name ?? '')) ?: ($guardianUser->name ?? __('api_controllers_1.admin_safeguarding.a_coordinator'));
                            $safeWard2 = htmlspecialchars($wardName2, ENT_QUOTES, 'UTF-8');
                            $safeGuardian2 = htmlspecialchars($guardianDisplay, ENT_QUOTES, 'UTF-8');
                            $safeCommunity2 = htmlspecialchars($communityName, ENT_QUOTES, 'UTF-8');
                            $html2 = EmailTemplateBuilder::make()
                                ->theme('info')
                                ->title(__('emails_misc.safeguarding.ward_assigned_title'))
                                ->previewText(__('emails_misc.safeguarding.ward_assigned_preview', ['guardian' => $safeGuardian2, 'community' => $safeCommunity2]))
                                ->greeting($safeWard2)
                                ->paragraph(__('emails_misc.safeguarding.ward_assigned_body', ['guardian' => $safeGuardian2, 'community' => $safeCommunity2]))
                                ->button(__('emails_misc.safeguarding.ward_assigned_cta'), EmailTemplateBuilder::tenantUrl('/settings?tab=safeguarding'))
                                ->render();
                            $subject2 = __('emails_misc.safeguarding.ward_assigned_subject');
                            if (!EmailDispatchService::sendRaw($wardUser->email, $subject2, $html2, null, null, null, 'safeguarding', ['tenant_id' => $tenantId])) {
                                \Illuminate\Support\Facades\Log::warning('AdminSafeguardingController: ward assignment email failed', ['ward_id' => $wardId]);
                            }
                        }
                    });
                }
            } catch (\Throwable $e) {
                \Illuminate\Support\Facades\Log::warning('Failed to notify ward/guardian of assignment', ['error' => $e->getMessage()]);
            }

            return $this->respondWithData(['id' => $id, 'created' => true]);
        } catch (\Illuminate\Database\QueryException $e) {
            if ($this->isTableNotFound($e)) {
                return $this->respondWithError(
                    'TABLE_NOT_FOUND',
                    __('api.safeguarding_tables_not_created'),
                    null,
                    404
                );
            }
            throw $e;
        }
    }

    /**
     * DELETE /v2/admin/safeguarding/assignments/{id}
     *
     * Soft-deletes (revokes) a safeguarding assignment to preserve the audit trail.
     */
    public function deleteAssignment(int $id): JsonResponse
    {
        $adminId = $this->requireSafeguardingStaff('manage');
        $tenantId = $this->getTenantId();

        try {
            // Fetch the assignment before revoking so we can notify both parties
            $assignment = DB::table('safeguarding_assignments')
                ->where('id', $id)
                ->where('tenant_id', $tenantId)
                ->whereNull('revoked_at')
                ->first();

            if (!$assignment) {
                return $this->respondWithError(
                    'NOT_FOUND',
                    __('api.safeguarding_assignment_not_found_or_revoked'),
                    null,
                    404
                );
            }

            DB::table('safeguarding_assignments')
                ->where('id', $id)
                ->where('tenant_id', $tenantId)
                ->update(['revoked_at' => now()]);

            // Audit log the revocation
            DB::table('activity_log')->insert([
                'tenant_id' => $tenantId,
                'user_id' => $adminId,
                'action' => 'safeguarding_assignment_revoked',
                'action_type' => 'safeguarding',
                'entity_type' => 'safeguarding_assignment',
                'entity_id' => $id,
                'details' => json_encode(['revoked_by_admin' => $adminId]),
                'ip_address' => request()?->ip(),
                'created_at' => now(),
            ]);

            // Notify both guardian and ward of the revocation. Each recipient
            // gets their bell + email in their OWN preferred_language —
            // wrap each block in LocaleContext::withLocale($recipient, ...).
            // Both User rows are fetched tenant-scoped (the assignment was
            // already loaded with WHERE tenant_id = caller's tenant, so its
            // ward_user_id / guardian_user_id are guaranteed in-tenant).
            try {
                $communityName  = TenantContext::getName() ?: __('emails.common.fallback_tenant_name');
                $guardianUser   = \App\Models\User::where('id', $assignment->guardian_user_id)->where('tenant_id', $tenantId)->first();
                $wardUser       = \App\Models\User::where('id', $assignment->ward_user_id)->where('tenant_id', $tenantId)->first();
                $wardName       = $wardUser ? (trim(($wardUser->first_name ?? '') . ' ' . ($wardUser->last_name ?? '')) ?: ($wardUser->name ?? '')) : '';
                $guardianName   = $guardianUser ? (trim(($guardianUser->first_name ?? '') . ' ' . ($guardianUser->last_name ?? '')) ?: ($guardianUser->name ?? '')) : '';
                $safeCommunity  = htmlspecialchars($communityName, ENT_QUOTES, 'UTF-8');

                // Bell + email — guardian (rendered in guardian's locale)
                if ($guardianUser) {
                    LocaleContext::withLocale($guardianUser, function () use ($tenantId, $assignment, $guardianUser, $wardName, $guardianName, $safeCommunity) {
                        \App\Models\Notification::create([
                            'tenant_id' => $tenantId,
                            'user_id'   => $assignment->guardian_user_id,
                            'type'      => 'safeguarding_assignment',
                            'message'   => __('emails_misc.safeguarding.assignment_revoked_guardian_bell', ['name' => $wardName]),
                            'link'      => '/settings?tab=safeguarding',
                            'is_read'   => false,
                        ]);

                        if (!empty($guardianUser->email)) {
                            $safeGuardianName = htmlspecialchars($guardianName, ENT_QUOTES, 'UTF-8');
                            $safeWardName     = htmlspecialchars($wardName, ENT_QUOTES, 'UTF-8');
                            $html = EmailTemplateBuilder::make()
                                ->theme('warning')
                                ->title(__('emails_misc.safeguarding.assignment_revoked_guardian_subject'))
                                ->greeting($safeGuardianName)
                                ->paragraph(__('emails_misc.safeguarding.assignment_revoked_guardian_body', ['name' => $safeWardName, 'community' => $safeCommunity]))
                                ->render();
                            if (!EmailDispatchService::sendRaw($guardianUser->email, __('emails_misc.safeguarding.assignment_revoked_guardian_subject'), $html, null, null, null, 'safeguarding', ['tenant_id' => $tenantId])) {
                                \Illuminate\Support\Facades\Log::warning('AdminSafeguardingController: guardian revocation email failed', ['guardian_id' => $assignment->guardian_user_id]);
                            }
                        }
                    });
                }

                // Bell + email — ward (rendered in ward's locale)
                if ($wardUser) {
                    LocaleContext::withLocale($wardUser, function () use ($tenantId, $assignment, $wardUser, $wardName, $safeCommunity) {
                        \App\Models\Notification::create([
                            'tenant_id' => $tenantId,
                            'user_id'   => $assignment->ward_user_id,
                            'type'      => 'safeguarding_assignment',
                            'message'   => __('emails_misc.safeguarding.assignment_revoked_ward_bell'),
                            'link'      => '/settings?tab=safeguarding',
                            'is_read'   => false,
                        ]);

                        if (!empty($wardUser->email)) {
                            $safeWardName2 = htmlspecialchars($wardName, ENT_QUOTES, 'UTF-8');
                            $html2 = EmailTemplateBuilder::make()
                                ->theme('warning')
                                ->title(__('emails_misc.safeguarding.assignment_revoked_guardian_subject'))
                                ->greeting($safeWardName2)
                                ->paragraph(__('emails_misc.safeguarding.assignment_revoked_ward_body', ['community' => $safeCommunity]))
                                ->button(__('emails_misc.safeguarding.assignment_revoked_cta'), EmailTemplateBuilder::tenantUrl('/help'))
                                ->render();
                            if (!EmailDispatchService::sendRaw($wardUser->email, __('emails_misc.safeguarding.assignment_revoked_guardian_subject'), $html2, null, null, null, 'safeguarding', ['tenant_id' => $tenantId])) {
                                \Illuminate\Support\Facades\Log::warning('AdminSafeguardingController: ward revocation email failed', ['ward_id' => $assignment->ward_user_id]);
                            }
                        }
                    });
                }
            } catch (\Throwable $notifErr) {
                \Illuminate\Support\Facades\Log::warning('AdminSafeguardingController: revocation notification failed', ['error' => $notifErr->getMessage()]);
            }

            return $this->respondWithData(['revoked' => true]);
        } catch (\Illuminate\Database\QueryException $e) {
            if ($this->isTableNotFound($e)) {
                return $this->respondWithError(
                    'TABLE_NOT_FOUND',
                    __('api.safeguarding_tables_not_created'),
                    null,
                    404
                );
            }
            throw $e;
        }
    }

    // ============================================
    // MEMBER SAFEGUARDING PREFERENCES
    // ============================================

    /**
     * GET /v2/admin/safeguarding/member-preferences
     *
     * Returns all members who have selected safeguarding options during onboarding.
     * Grouped by user, with their selected options and trigger status.
     * Access is audit-logged.
     */
    public function memberPreferences(): JsonResponse
    {
        $adminId = $this->requireSafeguardingStaff('view');
        $tenantId = TenantContext::getId();

        try {
            $rows = DB::select(
                "SELECT
                    u.id as user_id,
                    CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) as user_name,
                    u.avatar_url as user_avatar,
                    usp.consent_given_at,
                    usp.selected_value,
                    tso.option_key,
                    tso.option_type,
                    tso.preset_source,
                    tso.label as option_label,
                    tso.triggers
                 FROM user_safeguarding_preferences usp
                 JOIN users u ON u.id = usp.user_id AND u.tenant_id = usp.tenant_id
                 JOIN tenant_safeguarding_options tso ON tso.id = usp.option_id AND tso.tenant_id = usp.tenant_id
                 WHERE usp.tenant_id = ? AND usp.revoked_at IS NULL AND tso.is_active = 1
                 ORDER BY usp.consent_given_at DESC, u.id, tso.sort_order",
                [$tenantId]
            );

            // Group by user
            $grouped = [];
            foreach ($rows as $row) {
                if (! UserSafeguardingPreference::isEffectivelySelected(
                    $row->option_type ?? null,
                    $row->selected_value ?? null,
                )) {
                    continue;
                }

                $uid = (int) $row->user_id;
                if (!isset($grouped[$uid])) {
                    $grouped[$uid] = [
                        'user_id' => $uid,
                        'user_name' => trim($row->user_name),
                        'user_avatar' => $row->user_avatar,
                        'consent_given_at' => $row->consent_given_at,
                        'options' => [],
                        'has_triggers' => false,
                        'is_declination_only' => true, // flipped to false the moment any real option is present
                    ];
                }
                $triggers = json_decode($row->triggers ?? '{}', true) ?: [];
                $hasTriggers = !empty(array_filter($triggers, fn ($v) => $v === true));
                $isDeclination = $row->option_key === 'none_apply';
                $grouped[$uid]['options'][] = [
                    'option_key' => $row->option_key,
                    'label' => TenantSafeguardingOption::localizeOptionText(
                        $row->preset_source,
                        $row->option_key,
                        'label',
                        $row->option_label,
                    ),
                    'is_declination' => $isDeclination,
                ];
                if ($hasTriggers) {
                    $grouped[$uid]['has_triggers'] = true;
                }
                if (!$isDeclination) {
                    $grouped[$uid]['is_declination_only'] = false;
                }
            }

            // Audit log this access
            DB::table('activity_log')->insert([
                'tenant_id' => $tenantId,
                'user_id' => $adminId,
                'action' => 'safeguarding_preferences_list_viewed',
                'action_type' => 'safeguarding',
                'entity_type' => 'tenant',
                'entity_id' => $tenantId,
                'details' => json_encode(['members_count' => count($grouped)]),
                'ip_address' => request()?->ip(),
                'created_at' => now(),
            ]);

            return $this->respondWithData(array_values($grouped));
        } catch (\Illuminate\Database\QueryException $e) {
            if ($this->isTableNotFound($e)) {
                return $this->respondWithData([]);
            }
            throw $e;
        }
    }

    // ============================================
    // MEMBER AUDIT TRAIL (TIER 3c)
    // ============================================

    /**
     * GET /v2/admin/safeguarding/members/{userId}/activity
     *
     * Returns the combined audit trail for a single member:
     *   - Safeguarding-type activity_log entries (trigger activations, option
     *     selections, consent revocations, admin views)
     *   - Broker message copies where the member is sender or receiver
     *   - Safeguarding assignments where the member is ward or guardian
     *
     * Each row is ordered newest-first and carries an `event` discriminator
     * for the frontend to render appropriately.
     */
    public function memberActivity(Request $request, int $userId): JsonResponse
    {
        $adminId = $this->requireSafeguardingStaff('view');
        $tenantId = $this->getTenantId();

        $member = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->select(['id', 'first_name', 'last_name', 'name', 'avatar_url', 'email'])
            ->first();
        if (!$member) {
            return $this->respondWithError('NOT_FOUND', __('api.member_not_found'), null, 404);
        }

        $events = $this->collectMemberAuditEvents($tenantId, $userId);

        // Audit-log this access (spec requirement: every admin view of a
        // member's safeguarding data is itself recorded).
        DB::table('activity_log')->insert([
            'tenant_id' => $tenantId,
            'user_id' => $adminId,
            'action' => 'safeguarding_member_activity_viewed',
            'action_type' => 'safeguarding',
            'entity_type' => 'user',
            'entity_id' => $userId,
            'details' => json_encode(['events_count' => count($events)]),
            'ip_address' => request()?->ip(),
            'created_at' => now(),
        ]);

        return $this->respondWithData([
            'member' => [
                'id' => (int) $member->id,
                'name' => trim(($member->first_name ?? '') . ' ' . ($member->last_name ?? ''))
                    ?: ($member->name ?? ''),
                'avatar_url' => $member->avatar_url,
                'email' => $member->email,
            ],
            'events' => $events,
            'event_count' => count($events),
        ]);
    }

    /**
     * GET /v2/admin/safeguarding/members/{userId}/activity.csv
     *
     * CSV export of the same data as memberActivity. Tenant-scoped; audit-logged.
     */
    public function memberActivityCsv(Request $request, int $userId)
    {
        $adminId = $this->requireSafeguardingStaff('view');
        $tenantId = $this->getTenantId();

        $member = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->select(['id', 'first_name', 'last_name', 'name'])
            ->first();
        if (!$member) {
            return $this->respondWithError('NOT_FOUND', __('api.member_not_found'), null, 404);
        }

        $events = $this->collectMemberAuditEvents($tenantId, $userId);

        DB::table('activity_log')->insert([
            'tenant_id' => $tenantId,
            'user_id' => $adminId,
            'action' => 'safeguarding_member_activity_exported',
            'action_type' => 'safeguarding',
            'entity_type' => 'user',
            'entity_id' => $userId,
            'details' => json_encode(['events_count' => count($events), 'format' => 'csv']),
            'ip_address' => request()?->ip(),
            'created_at' => now(),
        ]);

        $memberLabel = trim(($member->first_name ?? '') . ' ' . ($member->last_name ?? ''))
            ?: ($member->name ?? "member-{$userId}");
        $slug = preg_replace('/[^a-z0-9_-]+/i', '-', strtolower($memberLabel));
        $filename = "safeguarding-activity-{$slug}-" . now()->format('Y-m-d') . '.csv';

        $response = new StreamedResponse(function () use ($events) {
            $out = fopen('php://output', 'w');
            // UTF-8 BOM for Excel
            fwrite($out, "\xEF\xBB\xBF");
            fputcsv($out, ['occurred_at', 'event', 'actor', 'details']);
            foreach ($events as $event) {
                fputcsv($out, [
                    $event['occurred_at'] ?? '',
                    $event['event'] ?? '',
                    $event['actor_name'] ?? '',
                    is_array($event['details'] ?? null)
                        ? json_encode($event['details'])
                        : (string) ($event['details'] ?? ''),
                ]);
            }
            fclose($out);
        });

        $response->headers->set('Content-Type', 'text/csv; charset=utf-8');
        $response->headers->set('Content-Disposition', 'attachment; filename="' . $filename . '"');
        $response->headers->set('Cache-Control', 'no-cache, no-store, must-revalidate');

        return $response;
    }

    /**
     * Collect audit events for a member across the three sources: activity_log,
     * broker_message_copies, and safeguarding_assignments. Returns a flat array
     * ordered newest-first.
     *
     * @return array<int, array{occurred_at: ?string, event: string, actor_name: ?string, details: mixed}>
     */
    private function collectMemberAuditEvents(int $tenantId, int $userId): array
    {
        $events = [];

        // 1) activity_log entries where action_type='safeguarding' AND (user_id=member OR entity targets this user)
        try {
            $logRows = DB::table('activity_log as al')
                ->leftJoin('users as actor', 'actor.id', '=', 'al.user_id')
                ->where('al.tenant_id', $tenantId)
                ->where('al.action_type', 'safeguarding')
                ->where(function ($q) use ($userId) {
                    $q->where('al.user_id', $userId)
                      ->orWhere(function ($q2) use ($userId) {
                          $q2->where('al.entity_type', 'user')->where('al.entity_id', $userId);
                      });
                })
                ->select([
                    'al.action',
                    'al.entity_type',
                    'al.entity_id',
                    'al.details',
                    'al.created_at',
                    'al.user_id as actor_id',
                    'actor.first_name as actor_first',
                    'actor.last_name as actor_last',
                    'actor.name as actor_name',
                ])
                ->orderByDesc('al.created_at')
                ->limit(500)
                ->get();

            foreach ($logRows as $row) {
                $events[] = [
                    'occurred_at' => $row->created_at,
                    'event' => 'activity_log:' . $row->action,
                    'actor_name' => $this->composeName($row->actor_first, $row->actor_last, $row->actor_name),
                    'details' => is_string($row->details) ? (json_decode($row->details, true) ?: $row->details) : $row->details,
                ];
            }
        } catch (\Illuminate\Database\QueryException $e) {
            if (!$this->isTableNotFound($e)) {
                Log::warning('AdminSafeguardingController::memberActivity activity_log query failed', [
                    'error' => $e->getMessage(),
                ]);
            }
        }

        // 2) broker_message_copies where member is sender or receiver
        try {
            $copies = DB::table('broker_message_copies as bmc')
                ->leftJoin('users as sender', 'sender.id', '=', 'bmc.sender_id')
                ->leftJoin('users as receiver', 'receiver.id', '=', 'bmc.receiver_id')
                ->where('bmc.tenant_id', $tenantId)
                ->where(function ($q) use ($userId) {
                    $q->where('bmc.sender_id', $userId)->orWhere('bmc.receiver_id', $userId);
                })
                ->select([
                    'bmc.id',
                    'bmc.sender_id',
                    'bmc.receiver_id',
                    'bmc.copy_reason',
                    'bmc.flagged',
                    'bmc.reviewed_at',
                    'bmc.created_at',
                    DB::raw("COALESCE(sender.name, CONCAT(COALESCE(sender.first_name, ''), ' ', COALESCE(sender.last_name, ''))) as sender_name"),
                    DB::raw("COALESCE(receiver.name, CONCAT(COALESCE(receiver.first_name, ''), ' ', COALESCE(receiver.last_name, ''))) as receiver_name"),
                ])
                ->orderByDesc('bmc.created_at')
                ->limit(500)
                ->get();

            foreach ($copies as $row) {
                $role = ((int) $row->sender_id === $userId) ? 'sender' : 'recipient';
                $events[] = [
                    'occurred_at' => $row->created_at,
                    'event' => 'message_copied',
                    'actor_name' => null,
                    'details' => [
                        'copy_id' => (int) $row->id,
                        'member_role' => $role,
                        'sender_name' => trim($row->sender_name ?? ''),
                        'receiver_name' => trim($row->receiver_name ?? ''),
                        'copy_reason' => $row->copy_reason,
                        'flagged' => (bool) $row->flagged,
                        'reviewed_at' => $row->reviewed_at,
                    ],
                ];
            }
        } catch (\Illuminate\Database\QueryException $e) {
            if (!$this->isTableNotFound($e)) {
                Log::warning('AdminSafeguardingController::memberActivity broker_message_copies query failed', [
                    'error' => $e->getMessage(),
                ]);
            }
        }

        // 3) safeguarding_assignments where member is ward or guardian
        try {
            $assignments = DB::table('safeguarding_assignments as sa')
                ->leftJoin('users as ward', 'ward.id', '=', 'sa.ward_user_id')
                ->leftJoin('users as guardian', 'guardian.id', '=', 'sa.guardian_user_id')
                ->where('sa.tenant_id', $tenantId)
                ->where(function ($q) use ($userId) {
                    $q->where('sa.ward_user_id', $userId)->orWhere('sa.guardian_user_id', $userId);
                })
                ->select([
                    'sa.id',
                    'sa.ward_user_id',
                    'sa.guardian_user_id',
                    'sa.consent_given_at',
                    'sa.revoked_at',
                    'sa.assigned_at',
                    'sa.notes',
                    DB::raw("COALESCE(ward.name, CONCAT(COALESCE(ward.first_name, ''), ' ', COALESCE(ward.last_name, ''))) as ward_name"),
                    DB::raw("COALESCE(guardian.name, CONCAT(COALESCE(guardian.first_name, ''), ' ', COALESCE(guardian.last_name, ''))) as guardian_name"),
                ])
                ->orderByDesc('sa.assigned_at')
                ->get();

            foreach ($assignments as $row) {
                $role = ((int) $row->ward_user_id === $userId) ? 'ward' : 'guardian';
                $events[] = [
                    'occurred_at' => $row->assigned_at,
                    'event' => 'assignment_created',
                    'actor_name' => null,
                    'details' => [
                        'assignment_id' => (int) $row->id,
                        'member_role' => $role,
                        'ward_name' => trim($row->ward_name ?? ''),
                        'guardian_name' => trim($row->guardian_name ?? ''),
                        'consent_given_at' => $row->consent_given_at,
                        'notes' => $row->notes,
                    ],
                ];
                if ($row->revoked_at) {
                    $events[] = [
                        'occurred_at' => $row->revoked_at,
                        'event' => 'assignment_revoked',
                        'actor_name' => null,
                        'details' => [
                            'assignment_id' => (int) $row->id,
                            'member_role' => $role,
                        ],
                    ];
                }
            }
        } catch (\Illuminate\Database\QueryException $e) {
            if (!$this->isTableNotFound($e)) {
                Log::warning('AdminSafeguardingController::memberActivity safeguarding_assignments query failed', [
                    'error' => $e->getMessage(),
                ]);
            }
        }

        // Sort newest-first across all three sources
        usort($events, function ($a, $b) {
            return strcmp((string) ($b['occurred_at'] ?? ''), (string) ($a['occurred_at'] ?? ''));
        });

        return $events;
    }

    private function composeName(?string $first, ?string $last, ?string $fallback): ?string
    {
        $composed = trim(($first ?? '') . ' ' . ($last ?? ''));
        return $composed !== '' ? $composed : ($fallback ?: null);
    }

    // ============================================
    // TENANT SAFEGUARDING STATEMENT (TIER 2a — GOVERNANCE)
    // ============================================
    //
    // Tusla / Children First Act 2015 (Ireland) and equivalent UK/NI
    // safeguarding legislation require any organisation working with children
    // or vulnerable adults to publish a Child Safeguarding Statement / equivalent
    // policy. When a tenant declares it works with these groups, the statement
    // PDF MUST be uploaded before the tenant can be activated.

    /**
     * GET /v2/admin/safeguarding/statement
     *
     * Returns the current tenant's safeguarding declaration flags and statement
     * metadata (not the file itself — use /statement/download for that).
     */
    public function getStatement(): JsonResponse
    {
        $this->requireSafeguardingStaff('view');
        $tenantId = $this->getTenantId();

        $tenant = DB::table('tenants')
            ->where('id', $tenantId)
            ->select([
                'id',
                'is_active',
                'works_with_children',
                'works_with_vulnerable_adults',
                'safeguarding_statement_path',
                'safeguarding_statement_original_name',
                'safeguarding_statement_uploaded_at',
                'safeguarding_statement_uploaded_by',
            ])
            ->first();

        if (!$tenant) {
            return $this->respondWithError('NOT_FOUND', __('api.tenant_not_found'), null, 404);
        }

        $hasStatement = !empty($tenant->safeguarding_statement_path);
        $requiresStatement = (bool) $tenant->works_with_children || (bool) $tenant->works_with_vulnerable_adults;

        return $this->respondWithData([
            'works_with_children' => (bool) $tenant->works_with_children,
            'works_with_vulnerable_adults' => (bool) $tenant->works_with_vulnerable_adults,
            'has_statement' => $hasStatement,
            'requires_statement' => $requiresStatement,
            'is_compliant' => !$requiresStatement || $hasStatement,
            'is_active' => (bool) $tenant->is_active,
            'statement_original_name' => $tenant->safeguarding_statement_original_name,
            'statement_uploaded_at' => $tenant->safeguarding_statement_uploaded_at,
            'statement_uploaded_by' => $tenant->safeguarding_statement_uploaded_by
                ? (int) $tenant->safeguarding_statement_uploaded_by
                : null,
        ]);
    }

    /**
     * POST /v2/admin/safeguarding/statement
     *
     * Upload or replace the tenant's Child Safeguarding Statement PDF and/or
     * toggle the works_with_* flags. If either flag is true after the update
     * and no statement is on file (and none being uploaded), returns 422.
     *
     * Accepts multipart/form-data with:
     *   - file (PDF, optional — required if toggling a flag on without prior file)
     *   - works_with_children (0|1, optional)
     *   - works_with_vulnerable_adults (0|1, optional)
     */
    public function uploadStatement(Request $request): JsonResponse
    {
        $adminId = $this->requireSafeguardingStaff('manage');
        $tenantId = $this->getTenantId();

        $tenant = DB::table('tenants')->where('id', $tenantId)->first();
        if (!$tenant) {
            return $this->respondWithError('NOT_FOUND', __('api.tenant_not_found'), null, 404);
        }

        $worksWithChildren = $request->has('works_with_children')
            ? (bool) $request->input('works_with_children')
            : (bool) $tenant->works_with_children;
        $worksWithVulnerableAdults = $request->has('works_with_vulnerable_adults')
            ? (bool) $request->input('works_with_vulnerable_adults')
            : (bool) $tenant->works_with_vulnerable_adults;

        $requiresStatement = $worksWithChildren || $worksWithVulnerableAdults;
        $alreadyHasStatement = !empty($tenant->safeguarding_statement_path);
        $hasUploadedFile = $request->hasFile('file');

        // Governance gate: flags set to true without a statement on file (and no
        // new upload in this request) → block.
        if ($requiresStatement && !$alreadyHasStatement && !$hasUploadedFile) {
            return $this->respondWithError(
                'SAFEGUARDING_STATEMENT_REQUIRED',
                __('safeguarding.errors.statement_required'),
                'file',
                422
            );
        }

        $storedPath = $tenant->safeguarding_statement_path;
        $storedOriginalName = $tenant->safeguarding_statement_original_name;
        $uploadedAt = $tenant->safeguarding_statement_uploaded_at;
        $uploadedBy = $tenant->safeguarding_statement_uploaded_by;

        if ($hasUploadedFile) {
            $file = $request->file('file');
            if (!$file->isValid()) {
                return $this->respondWithError('INVALID_FILE', __('safeguarding.errors.invalid_file'), 'file', 422);
            }
            if (strtolower($file->getClientOriginalExtension()) !== 'pdf'
                || $file->getMimeType() !== 'application/pdf') {
                return $this->respondWithError('INVALID_FILE_TYPE', __('safeguarding.errors.pdf_required'), 'file', 422);
            }
            if ($file->getSize() > 10 * 1024 * 1024) { // 10MB cap
                return $this->respondWithError('FILE_TOO_LARGE', __('safeguarding.errors.file_too_large'), 'file', 422);
            }

            // Store in uploads/tenants/{tenantId}/safeguarding/
            $filename = 'statement-' . Str::uuid()->toString() . '.pdf';
            $relativePath = "tenants/{$tenantId}/safeguarding/{$filename}";

            try {
                Storage::disk('local')->putFileAs(
                    "tenants/{$tenantId}/safeguarding",
                    $file,
                    $filename
                );
            } catch (\Throwable $e) {
                Log::error('AdminSafeguardingController::uploadStatement storage failed', [
                    'tenant_id' => $tenantId,
                    'error' => $e->getMessage(),
                ]);
                return $this->respondWithError('STORAGE_FAILED', __('safeguarding.errors.storage_failed'), null, 500);
            }

            // Delete the old file if one existed
            if (!empty($tenant->safeguarding_statement_path)) {
                try {
                    Storage::disk('local')->delete($tenant->safeguarding_statement_path);
                } catch (\Throwable $e) {
                    Log::warning('AdminSafeguardingController::uploadStatement old file cleanup failed', [
                        'tenant_id' => $tenantId,
                        'error' => $e->getMessage(),
                    ]);
                }
            }

            $storedPath = $relativePath;
            $storedOriginalName = mb_substr((string) $file->getClientOriginalName(), 0, 255);
            $uploadedAt = now();
            $uploadedBy = $adminId;
        }

        DB::table('tenants')->where('id', $tenantId)->update([
            'works_with_children' => $worksWithChildren ? 1 : 0,
            'works_with_vulnerable_adults' => $worksWithVulnerableAdults ? 1 : 0,
            'safeguarding_statement_path' => $storedPath,
            'safeguarding_statement_original_name' => $storedOriginalName,
            'safeguarding_statement_uploaded_at' => $uploadedAt,
            'safeguarding_statement_uploaded_by' => $uploadedBy,
            'updated_at' => now(),
        ]);

        DB::table('activity_log')->insert([
            'tenant_id' => $tenantId,
            'user_id' => $adminId,
            'action' => $hasUploadedFile
                ? 'safeguarding_statement_uploaded'
                : 'safeguarding_declaration_updated',
            'action_type' => 'safeguarding',
            'entity_type' => 'tenant',
            'entity_id' => $tenantId,
            'details' => json_encode([
                'works_with_children' => $worksWithChildren,
                'works_with_vulnerable_adults' => $worksWithVulnerableAdults,
                'statement_uploaded' => $hasUploadedFile,
            ]),
            'ip_address' => request()?->ip(),
            'created_at' => now(),
        ]);

        return $this->respondWithData([
            'works_with_children' => $worksWithChildren,
            'works_with_vulnerable_adults' => $worksWithVulnerableAdults,
            'has_statement' => !empty($storedPath),
            'statement_uploaded_at' => $uploadedAt,
            'statement_original_name' => $storedOriginalName,
            'is_compliant' => !$requiresStatement || !empty($storedPath),
        ]);
    }

    /**
     * GET /v2/admin/safeguarding/statement/download
     *
     * Stream the tenant's Child Safeguarding Statement PDF to an admin.
     * Tenant-scoped — the download is authorised by the admin's tenant context
     * and the stored path never leaves the server.
     */
    public function downloadStatement()
    {
        $this->requireSafeguardingStaff('view');
        $tenantId = $this->getTenantId();

        $tenant = DB::table('tenants')
            ->where('id', $tenantId)
            ->select(['safeguarding_statement_path', 'safeguarding_statement_original_name'])
            ->first();

        if (!$tenant || empty($tenant->safeguarding_statement_path)) {
            return $this->respondWithError('NOT_FOUND', __('safeguarding.errors.statement_missing'), null, 404);
        }

        if (!Storage::disk('local')->exists($tenant->safeguarding_statement_path)) {
            Log::warning('AdminSafeguardingController::downloadStatement path in DB but file missing', [
                'tenant_id' => $tenantId,
                'path' => $tenant->safeguarding_statement_path,
            ]);
            return $this->respondWithError('FILE_MISSING', __('safeguarding.errors.file_missing'), null, 410);
        }

        $absolutePath = Storage::disk('local')->path($tenant->safeguarding_statement_path);
        $downloadName = $tenant->safeguarding_statement_original_name ?: 'safeguarding-statement.pdf';

        return response()->download($absolutePath, $downloadName, [
            'Content-Type' => 'application/pdf',
        ]);
    }

    // ============================================
    // HELPERS
    // ============================================

    /**
     * GET /v2/admin/safeguarding/support-actions — live pending co-decide
     * actions in this tenant, so staff can see what awaits an answer and,
     * where the member confirmed offline, record it.
     */
    public function supportActions(): JsonResponse
    {
        $this->requireSafeguardingStaff('view');

        return $this->respondWithData([
            'actions' => app(\App\Services\SupportPendingActionService::class)->listPendingForTenant(),
        ]);
    }

    /**
     * POST /v2/admin/safeguarding/support-actions/{id}/attest — record that
     * the supported member confirmed a prepared action OFFLINE (phone, in
     * person, or on paper), naming the channel and any witness. This is the
     * co-decide path for members who never use the platform directly. The
     * member is notified that the confirmation was recorded in their name.
     */
    public function attestSupportAction(int $id): JsonResponse
    {
        $staffUserId = $this->requireSafeguardingStaff('manage');

        $data = $this->getAllInput();
        $channel = is_string($data['channel'] ?? null) ? $data['channel'] : '';
        $witness = is_string($data['witness'] ?? null) ? $data['witness'] : null;

        $service = app(\App\Services\SupportPendingActionService::class);
        $result = $service->confirmAttested($staffUserId, $id, $channel, $witness);

        if ($result === null) {
            return $this->respondWithErrors($service->getErrors(), 422);
        }

        return $this->respondWithData([
            'status' => 'confirmed',
            'confirmed_via' => 'attested_offline',
            'result_id' => $result['result_id'],
        ]);
    }

    private function requireSafeguardingStaff(string $level = 'view'): int
    {
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();

        $user = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->first(['role', 'is_admin', 'is_super_admin', 'is_tenant_super_admin', 'is_god']);

        if ($user) {
            $role = (string) ($user->role ?? 'member');
            if (in_array($role, ['admin', 'tenant_admin', 'super_admin', 'god', 'broker'], true)) {
                return $userId;
            }

            if (($user->is_admin ?? false)
                || ($user->is_super_admin ?? false)
                || ($user->is_tenant_super_admin ?? false)
                || ($user->is_god ?? false)) {
                return $userId;
            }
        }

        if ($this->hasSafeguardingPermission($userId, $tenantId, $level)) {
            return $userId;
        }

        throw new HttpResponseException(
            $this->respondWithError(
                'AUTH_INSUFFICIENT_PERMISSIONS',
                __('api.safeguarding_staff_access_required'),
                null,
                403
            )
        );
    }

    private function hasSafeguardingPermission(int $userId, int $tenantId, string $level): bool
    {
        if (!Schema::hasTable('user_permissions') || !Schema::hasTable('permissions')) {
            return false;
        }

        try {
            $allowedPermissions = $level === 'manage'
                ? ['safeguarding.manage']
                : ['safeguarding.view', 'safeguarding.manage'];

            $query = DB::table('user_permissions as up')
                ->join('permissions as p', 'p.id', '=', 'up.permission_id')
                ->where('up.user_id', $userId)
                ->whereIn('p.name', $allowedPermissions);

            if (Schema::hasColumn('user_permissions', 'tenant_id')) {
                $query->where('up.tenant_id', $tenantId);
            }
            if (Schema::hasColumn('user_permissions', 'granted')) {
                $query->where('up.granted', true);
            }
            if (Schema::hasColumn('user_permissions', 'expires_at')) {
                $query->where(function ($q) {
                    $q->whereNull('up.expires_at')
                        ->orWhere('up.expires_at', '>', now());
                });
            }
            if (Schema::hasColumn('permissions', 'tenant_id')) {
                $query->where(function ($q) use ($tenantId) {
                    $q->whereNull('p.tenant_id')
                        ->orWhere('p.tenant_id', $tenantId);
                });
            }

            return $query->exists();
        } catch (\Throwable $e) {
            return false;
        }
    }

    /**
     * Check if a QueryException indicates a missing table (SQLSTATE 42S02).
     */
    private function isTableNotFound(\Illuminate\Database\QueryException $e): bool
    {
        return str_contains($e->getCode(), '42S02')
            || str_contains($e->getMessage(), "doesn't exist")
            || str_contains($e->getMessage(), 'Base table or view not found');
    }
}
