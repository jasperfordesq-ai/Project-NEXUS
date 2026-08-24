<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Exceptions\SafeguardingPolicyException;
use App\Support\CsvExportSanitizer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use App\Services\ShiftSwapService;
use App\Services\ShiftWaitlistService;
use App\Services\ShiftGroupReservationService;
use App\Services\RecurringShiftService;
use App\Services\VolunteerFormService;
use App\Services\CommunityProjectService;
use App\Services\VolunteerDonationService;
use App\Services\GuardianConsentService;
use App\Services\WebhookDispatchService;
use App\Services\VolunteerReminderService;
use App\Services\VolunteeringConfigurationService;
use App\Core\TenantContext;

/**
 * VolunteerCommunityController -- Swaps, waitlist, group reservations, recurring shifts,
 * custom fields, accessibility, community projects, donations, giving days, webhooks,
 * reminders, and guardian consents.
 */
class VolunteerCommunityController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly ShiftSwapService $shiftSwapService,
        private readonly ShiftWaitlistService $shiftWaitlistService,
        private readonly ShiftGroupReservationService $shiftGroupReservationService,
        private readonly RecurringShiftService $recurringShiftService,
        private readonly VolunteerFormService $volunteerFormService,
        private readonly CommunityProjectService $communityProjectService,
        private readonly VolunteerDonationService $volunteerDonationService,
        private readonly GuardianConsentService $guardianConsentService,
        private readonly WebhookDispatchService $webhookDispatchService,
        private readonly VolunteerReminderService $volunteerReminderService,
    ) {}

    private function ensureFeature(): void
    {
        if (!TenantContext::hasFeature('volunteering')) {
            throw new \Illuminate\Http\Exceptions\HttpResponseException(
                $this->respondWithError('FEATURE_DISABLED', __('api.vol_feature_disabled'), null, 403)
            );
        }
    }

    private function getErrorStatus(array $errors): int
    {
        foreach ($errors as $error) {
            $code = $error['code'] ?? '';
            if ($code === 'NOT_FOUND') return 404;
            if ($code === 'FORBIDDEN') return 403;
            if ($code === 'ALREADY_EXISTS') return 409;
            if ($code === 'FEATURE_DISABLED') return 403;
        }
        return 400;
    }

    // ========================================
    // WAITLIST
    // ========================================

    public function joinWaitlist($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_waitlist_join', 20, 60);

        // Guardian-consent gate for minors — the waitlist leads straight to a
        // shift place on promotion, so it must be gated like signUp().
        if (VolunteeringConfigurationService::get(VolunteeringConfigurationService::CONFIG_GUARDIAN_CONSENT_REQUIRED, false)
            && \App\Services\GuardianConsentService::isMinor($userId)) {
            $gateOppId = \Illuminate\Support\Facades\DB::table('vol_shifts')
                ->where('tenant_id', \App\Core\TenantContext::getId())
                ->where('id', (int) $id)
                ->value('opportunity_id');
            if (!\App\Services\GuardianConsentService::checkConsent($userId, $gateOppId ? (int) $gateOppId : null)) {
                return $this->respondWithError('GUARDIAN_CONSENT_REQUIRED', __('api.guardian_consent_required'), null, 403);
            }
        }

        try {
            $entryId = $this->shiftWaitlistService->join((int) $id, $userId);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }
        if ($entryId === null) {
            $errors = $this->shiftWaitlistService->getErrors();
            return $this->respondWithErrors($errors, $this->getErrorStatus($errors));
        }
        $position = $this->shiftWaitlistService->getUserPosition((int) $id, $userId);
        return $this->respondWithData(['id' => $entryId, 'position' => $position['position'] ?? 1, 'message' => __('api_controllers_2.volunteer_community.joined_waitlist')], null, 201);
    }

    public function leaveWaitlist($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_waitlist_leave', 20, 60);

        $success = $this->shiftWaitlistService->leave((int) $id, $userId);
        if (!$success) {
            $errors = $this->shiftWaitlistService->getErrors();
            return $this->respondWithErrors($errors, $this->getErrorStatus($errors));
        }
        return $this->noContent();
    }

    public function promoteFromWaitlist($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_waitlist_promote', 10, 60);

        $tenantId = TenantContext::getId();

        // {id} is the SHIFT id (route: shifts/{id}/waitlist/promote). Resolve
        // the caller's own offer for that shift — users can only claim their
        // own notified spot.
        $entry = DB::table('vol_shift_waitlist')
            ->where('shift_id', (int) $id)
            ->where('user_id', $userId)
            ->whereIn('status', ['waiting', 'notified'])
            ->where('tenant_id', $tenantId)
            ->orderByRaw("status = 'notified' DESC")
            ->first();

        if (!$entry) {
            return $this->respondWithError('NOT_FOUND', __('api.vol_waitlist_not_found'), null, 404);
        }

        try {
            $success = $this->shiftWaitlistService->promoteUser((int) $entry->id, $tenantId);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }
        if (!$success) {
            $errors = $this->shiftWaitlistService->getErrors();
            return $this->respondWithErrors($errors, $this->getErrorStatus($errors));
        }
        return $this->respondWithData(['message' => __('api_controllers_2.volunteer_community.claimed_spot')]);
    }

    public function myWaitlists(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_waitlists_list', 60, 60);
        $tenantId = TenantContext::getId();
        $entries = $this->shiftWaitlistService->getUserWaitlists($userId, $tenantId);
        return $this->respondWithData($entries);
    }

    // ========================================
    // SHIFT SWAPPING
    // ========================================

    public function requestSwap(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_swap_request', 10, 60);

        // `to_user_id` is optional: a member asks for a SHIFT, and the service resolves who
        // holds it without ever telling them. See ShiftSwapService::requestSwap().
        $data = [
            'from_shift_id' => $this->inputInt('from_shift_id'),
            'to_shift_id'   => $this->inputInt('to_shift_id'),
            'to_user_id'    => $this->inputInt('to_user_id'),
            'message'       => trim($this->input('message', '')),
        ];

        try {
            $swapId = $this->shiftSwapService->requestSwap($userId, $data);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }
        if ($swapId === null) {
            $errors = $this->shiftSwapService->getErrors();
            return $this->respondWithErrors($errors, $this->getErrorStatus($errors));
        }
        return $this->respondWithData(['id' => $swapId, 'message' => __('api_controllers_2.volunteer_community.swap_request_sent')], null, 201);
    }

    public function getSwapRequests(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_swaps_list', 60, 60);
        $direction = $this->query('direction') ?? 'all';
        $requests = $this->shiftSwapService->getSwapRequests($userId, $direction);
        return $this->respondWithData($requests);
    }

    public function respondToSwap($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_swap_respond', 20, 60);

        $action = $this->input('action');
        if (!$action || !in_array($action, ['accept', 'reject'])) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.vol_action_accept_reject'), 'action', 400);
        }

        try {
            $success = $this->shiftSwapService->respond((int) $id, $userId, $action);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }
        if (!$success) {
            $errors = $this->shiftSwapService->getErrors();
            return $this->respondWithErrors($errors, $this->getErrorStatus($errors));
        }

        if ($action === 'accept') {
            // Check if the swap went to admin_pending instead of being directly accepted
            // Scope by tenant_id to prevent cross-tenant status disclosure (IDOR)
            $actualStatus = DB::table('vol_shift_swap_requests')
                ->where('id', (int) $id)
                ->where('tenant_id', TenantContext::getId())
                ->value('status');
            if ($actualStatus === 'admin_pending') {
                return $this->respondWithData(['id' => (int) $id, 'status' => 'admin_pending', 'message' => __('api_controllers_2.volunteer_community.swap_admin_pending')]);
            }
        }

        return $this->respondWithData(['id' => (int) $id, 'status' => $action === 'accept' ? 'accepted' : 'rejected']);
    }

    public function cancelSwap($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_swap_cancel', 20, 60);

        $tenantId = TenantContext::getId();
        $success = $this->shiftSwapService->cancel((int) $id, $userId, $tenantId);
        if (!$success) {
            $errors = $this->shiftSwapService->getErrors();
            return $this->respondWithErrors($errors, $this->getErrorStatus($errors));
        }
        return $this->noContent();
    }

    public function adminPendingSwaps(): JsonResponse
    {
        $this->ensureFeature();
        $this->requireAdmin();
        $this->rateLimit('volunteering_admin_swaps', 60, 60);

        $requests = $this->shiftSwapService->getAdminPendingSwaps();
        return $this->respondWithData($requests);
    }

    public function adminDecideSwap($id): JsonResponse
    {
        $this->ensureFeature();
        $adminId = $this->requireAdmin();
        $this->rateLimit('volunteering_admin_swap_decide', 20, 60);

        $action = $this->input('action');
        if (!$action || !in_array($action, ['approve', 'reject'])) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.vol_action_approve_reject'), 'action', 400);
        }

        try {
            $success = $this->shiftSwapService->adminDecision((int) $id, $adminId, $action);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }
        if (!$success) {
            $errors = $this->shiftSwapService->getErrors();
            return $this->respondWithErrors($errors, $this->getErrorStatus($errors));
        }

        return $this->respondWithData(['id' => (int) $id, 'status' => $action === 'approve' ? 'admin_approved' : 'admin_rejected']);
    }

    // ========================================
    // GROUP RESERVATIONS
    // ========================================

    public function groupReserve($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_group_reserve', 10, 60);

        $groupId = $this->inputInt('group_id');
        $slots = $this->inputInt('reserved_slots', 1);
        $notes = trim($this->input('notes', ''));
        if (!$groupId) return $this->respondWithError('VALIDATION_ERROR', __('api.vol_group_id_required'), 'group_id', 400);

        $reservationId = $this->shiftGroupReservationService->reserve((int) $id, $groupId, $userId, $slots, $notes ?: null);
        if ($reservationId === null) {
            $errors = $this->shiftGroupReservationService->getErrors();
            return $this->respondWithErrors($errors, $this->getErrorStatus($errors));
        }
        return $this->respondWithData(['id' => $reservationId, 'message' => __('api_controllers_2.volunteer_community.reserved_slots', ['slots' => $slots])], null, 201);
    }

    public function addGroupMember($id): JsonResponse
    {
        $this->ensureFeature();
        $leaderId = $this->getUserId();
        $this->rateLimit('volunteering_group_member', 20, 60);

        $memberUserId = $this->inputInt('user_id');
        if (!$memberUserId) return $this->respondWithError('VALIDATION_ERROR', __('api.vol_user_id_required'), 'user_id', 400);

        try {
            $success = $this->shiftGroupReservationService->addMember((int) $id, $memberUserId, $leaderId);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }
        if (!$success) {
            $errors = $this->shiftGroupReservationService->getErrors();
            return $this->respondWithErrors($errors, $this->getErrorStatus($errors));
        }
        return $this->respondWithData(['message' => __('api_controllers_2.volunteer_community.member_added_reservation')]);
    }

    public function removeGroupMember($id, $userId): JsonResponse
    {
        $this->ensureFeature();
        $leaderId = $this->getUserId();
        $this->rateLimit('volunteering_group_member_remove', 20, 60);

        $success = $this->shiftGroupReservationService->removeMember((int) $id, (int) $userId, $leaderId);
        if (!$success) {
            $errors = $this->shiftGroupReservationService->getErrors();
            return $this->respondWithErrors($errors, $this->getErrorStatus($errors));
        }
        return $this->noContent();
    }

    public function cancelGroupReservation($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_group_cancel', 10, 60);

        $success = $this->shiftGroupReservationService->cancelReservation((int) $id, $userId);
        if (!$success) {
            $errors = $this->shiftGroupReservationService->getErrors();
            return $this->respondWithErrors($errors, $this->getErrorStatus($errors));
        }
        return $this->noContent();
    }

    public function myGroupReservations(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_group_reservations_list', 60, 60);
        $tenantId = TenantContext::getId();
        $reservations = $this->shiftGroupReservationService->getUserReservations($userId, $tenantId);
        return $this->respondWithData($reservations);
    }

    // ========================================
    // RECURRING SHIFTS
    // ========================================

    public function recurringPatterns($id): JsonResponse
    {
        $this->ensureFeature();
        if (! VolunteeringConfigurationService::get(VolunteeringConfigurationService::CONFIG_ENABLE_RECURRING_SHIFTS, true)) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.module_disabled_for_community'), null, 403);
        }
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_recurring_list', 60, 60);
        $oppId = (int) $id;

        $patterns = $this->recurringShiftService->getPatternsForOpportunity($oppId, $userId);

        $errors = $this->recurringShiftService->getErrors();
        if (!empty($errors)) {
            return $this->respondWithErrors($errors, $this->getErrorStatus($errors));
        }

        return $this->respondWithData(['patterns' => $patterns]);
    }

    public function createRecurringPattern($id): JsonResponse
    {
        $this->ensureFeature();
        if (! VolunteeringConfigurationService::get(VolunteeringConfigurationService::CONFIG_ENABLE_RECURRING_SHIFTS, true)) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.module_disabled_for_community'), null, 403);
        }
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_recurring_create', 10, 60);
        $oppId = (int) $id;

        $data = [
            'title' => $this->input('title'),
            'frequency' => $this->input('frequency'),
            'days_of_week' => $this->input('days_of_week'),
            'start_time' => $this->input('start_time'),
            'end_time' => $this->input('end_time'),
            'capacity' => $this->inputInt('capacity', 1),
            'start_date' => $this->input('start_date'),
            'end_date' => $this->input('end_date'),
            'max_occurrences' => $this->input('max_occurrences'),
        ];

        $patternId = $this->recurringShiftService->createPattern($oppId, $userId, $data);

        if ($patternId === null) {
            $errors = $this->recurringShiftService->getErrors();
            return $this->respondWithErrors($errors, $this->getErrorStatus($errors));
        }

        $pattern = $this->recurringShiftService->getPattern($patternId);
        return $this->respondWithData($pattern, null, 201);
    }

    public function updateRecurringPattern($id): JsonResponse
    {
        $this->ensureFeature();
        if (! VolunteeringConfigurationService::get(VolunteeringConfigurationService::CONFIG_ENABLE_RECURRING_SHIFTS, true)) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.module_disabled_for_community'), null, 403);
        }
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_recurring_update', 10, 60);
        $patternId = (int) $id;

        $success = $this->recurringShiftService->updatePattern($patternId, $this->getAllInput(), $userId);

        if (!$success) {
            $errors = $this->recurringShiftService->getErrors();
            return $this->respondWithErrors($errors, $this->getErrorStatus($errors));
        }

        $pattern = $this->recurringShiftService->getPattern($patternId);
        return $this->respondWithData($pattern);
    }

    public function deleteRecurringPattern($id): JsonResponse
    {
        $this->ensureFeature();
        if (! VolunteeringConfigurationService::get(VolunteeringConfigurationService::CONFIG_ENABLE_RECURRING_SHIFTS, true)) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.module_disabled_for_community'), null, 403);
        }
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_recurring_delete', 10, 60);
        $patternId = (int) $id;

        $deactivated = $this->recurringShiftService->deactivatePattern($patternId, $userId);

        if (!$deactivated) {
            $errors = $this->recurringShiftService->getErrors();
            return $this->respondWithErrors($errors, $this->getErrorStatus($errors));
        }

        $deleted = $this->recurringShiftService->deleteFutureShifts($patternId, $userId);

        return $this->respondWithData([
            'message' => __('api_controllers_2.volunteer_community.recurring_deactivated'),
            'future_shifts_removed' => $deleted,
        ]);
    }

    // ========================================
    // CUSTOM FIELDS
    // ========================================

    /** Public endpoint -- custom fields needed for application forms */
    public function getCustomFields(): JsonResponse
    {
        $this->ensureFeature();
        $this->rateLimit('vol_public_read', 60, 30);

        $orgId = $this->query('organization_id') ? (int) $this->query('organization_id') : null;
        $appliesTo = $this->query('applies_to') ?: 'application';

        $fields = $this->volunteerFormService->getCustomFields($orgId, $appliesTo);
        return $this->respondWithData($fields);
    }

    public function adminCustomFields(): JsonResponse
    {
        $this->ensureFeature();
        $this->requireAdmin();

        $orgId = $this->query('organization_id') ? (int) $this->query('organization_id') : null;
        $fields = $this->volunteerFormService->getCustomFields($orgId);
        return $this->respondWithData($fields);
    }

    public function createCustomField(): JsonResponse
    {
        $this->ensureFeature();
        $this->requireAdmin();
        $this->rateLimit('vol_custom_field_create', 10, 60);

        $data = $this->getAllInput();

        if (empty($data['field_label']) && empty($data['label'])) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.vol_field_label_required'), 'field_label', 422);
        }

        try {
            $result = $this->volunteerFormService->createField($data);
            return $this->respondWithData($result, null, 201);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning("VolunteerCommunityController::createCustomField error: " . $e->getMessage());
            return $this->respondWithError('INTERNAL_ERROR', __('api.vol_custom_field_create_failed'), null, 500);
        }
    }

    public function updateCustomField($id): JsonResponse
    {
        $this->ensureFeature();
        $this->requireAdmin();

        $data = $this->getAllInput();
        $result = $this->volunteerFormService->updateField((int) $id, $data);

        if (!$result) {
            return $this->respondWithError('NOT_FOUND', __('api.vol_custom_field_not_found'), null, 404);
        }

        return $this->respondWithData(['success' => true]);
    }

    public function deleteCustomField($id): JsonResponse
    {
        $this->ensureFeature();
        $this->requireAdmin();

        $result = $this->volunteerFormService->deleteField((int) $id);

        if (!$result) {
            return $this->respondWithError('NOT_FOUND', __('api.vol_custom_field_not_found'), null, 404);
        }

        return $this->respondWithData(['success' => true]);
    }

    // ========================================
    // ACCESSIBILITY
    // ========================================

    public function myAccessibilityNeeds(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();

        $tenantId = TenantContext::getId();
        $needs = $this->volunteerFormService->getAccessibilityNeeds($userId, $tenantId);
        return $this->respondWithData($needs);
    }

    public function updateAccessibilityNeeds(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();

        $data = $this->getAllInput();
        $tenantId = TenantContext::getId();
        $this->volunteerFormService->updateAccessibilityNeeds($userId, $data['needs'] ?? [], $tenantId);
        return $this->respondWithData(['success' => true]);
    }

    // ========================================
    // COMMUNITY PROJECTS
    // ========================================

    /** Public endpoint -- community project listings */
    public function getCommunityProjects(): JsonResponse
    {
        $this->ensureFeature();
        $this->rateLimit('vol_public_read', 60, 30);

        $filters = [
            'status' => $this->query('status') ?: 'approved',
            'public' => true,
            'category' => $this->query('category'),
            'search' => $this->query('search'),
            'sort' => $this->query('sort') ?: 'newest',
            'cursor' => $this->query('cursor'),
            'limit' => $this->queryInt('per_page', 20, 1, 50),
            'user_id' => $this->getOptionalUserId(),
        ];

        $result = $this->communityProjectService->getProposals($filters);
        return $this->respondWithData($result);
    }

    public function adminCommunityProjects(): JsonResponse
    {
        $this->ensureFeature();
        $this->requireAdmin();
        $this->rateLimit('vol_admin_projects', 60, 60);

        $filters = [
            'status' => $this->query('status'),
            'category' => $this->query('category'),
            'search' => $this->query('search'),
            'sort' => $this->query('sort') ?: 'newest',
            'cursor' => $this->query('cursor'),
            'limit' => $this->queryInt('per_page', 20, 1, 50),
        ];

        $result = $this->communityProjectService->getProposals($filters);
        $stats = $this->communityProjectService->getProposalStats($filters);

        return $this->respondWithCollection(
            $result['items'],
            $result['cursor'],
            $filters['limit'],
            $result['has_more'],
            ['stats' => $stats]
        );
    }

    public function proposeCommunityProject(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('vol_project_propose', 5, 60);

        $data = $this->getAllInput();

        try {
            $result = $this->communityProjectService->propose($userId, $data);
            return $this->respondWithData($result, null, 201);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        }
    }

    /** Public endpoint -- individual project pages */
    public function getCommunityProject($id): JsonResponse
    {
        $this->ensureFeature();
        $this->rateLimit('vol_public_read', 60, 30);

        $project = $this->communityProjectService->getProposal((int) $id, true, $this->getOptionalUserId());
        if (!$project) {
            return $this->respondWithError('NOT_FOUND', __('api.vol_project_not_found'), null, 404);
        }
        return $this->respondWithData($project);
    }

    public function updateCommunityProject($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('vol_project_update', 10, 60);

        $data = $this->getAllInput();
        $result = $this->communityProjectService->updateProposal((int) $id, $userId, $data);

        if (!$result) {
            return $this->respondWithError('FORBIDDEN', __('api.vol_project_update_forbidden'), null, 403);
        }
        return $this->respondWithData(['success' => true]);
    }

    public function supportCommunityProject($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('vol_project_support', 30, 60);

        $data = $this->getAllInput();
        $tenantId = TenantContext::getId();
        try {
            $result = $this->communityProjectService->support((int) $id, $userId, $tenantId);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }
        return $this->respondWithData(['success' => $result]);
    }

    public function unsupportCommunityProject($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('vol_project_unsupport', 30, 60);

        $tenantId = TenantContext::getId();
        $result = $this->communityProjectService->unsupport((int) $id, $userId, $tenantId);
        return $this->respondWithData(['success' => $result]);
    }

    public function reviewCommunityProject($id): JsonResponse
    {
        $this->ensureFeature();
        $adminId = $this->requireAdmin();

        $data = $this->getAllInput();

        try {
            $tenantId = TenantContext::getId();
            $result = $this->communityProjectService->review(
                (int) $id,
                $data['status'] ?? '',
                $data['review_notes'] ?? $data['notes'] ?? null,
                $adminId,
                $tenantId
            );
            return $this->respondWithData(['success' => $result]);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        }
    }

    // ========================================
    // DONATIONS
    // ========================================

    /** Public endpoint -- donation listings */
    public function getDonations(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('vol_public_read', 60, 30);

        $filters = [
            'user_id' => $userId,
            'opportunity_id' => $this->query('opportunity_id') ? (int) $this->query('opportunity_id') : null,
            'community_project_id' => $this->query('community_project_id') ? (int) $this->query('community_project_id') : null,
            'cursor' => $this->query('cursor'),
            'limit' => $this->queryInt('per_page', 20, 1, 50),
        ];

        $result = $this->volunteerDonationService->getDonations($filters);
        return $this->respondWithData($result);
    }

    public function createDonation(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getOptionalUserId();
        $this->rateLimit('vol_donation_create', 10, 60);

        $data = $this->getAllInput();
        if ($userId) {
            $data['user_id'] = $userId;
        }

        try {
            $result = $this->volunteerDonationService->createDonation($userId ?: 0, $data);
            return $this->respondWithData($result, null, 201);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        }
    }

    /**
     * Admin JSON list of donations (powers the Donation Refunds admin page).
     *
     * Same row shape as the export below, but as a proper JSON envelope —
     * the export endpoint serves a text/csv download and must not be used
     * as a list API.
     */
    public function listDonations(): JsonResponse
    {
        $this->ensureFeature();
        $this->requireAdmin();

        $filters = [
            'opportunity_id' => $this->query('opportunity_id'),
            'giving_day_id'  => $this->query('giving_day_id'),
            'status'         => $this->query('status'),
            'date_from'      => $this->query('date_from'),
            'date_to'        => $this->query('date_to'),
        ];

        $rows = $this->volunteerDonationService->exportDonations(TenantContext::getId(), $filters);

        return $this->respondWithData(['items' => $rows]);
    }

    /**
     * Admin: mark a pending offline donation as completed.
     *
     * Offline donations (cash / bank transfer / PayPal) recorded via the
     * volunteering Donations tab have no payment webhook, so this is the
     * only path that moves them out of 'pending' and credits the linked
     * giving day's raised total.
     */
    public function completeDonation(string $id): JsonResponse
    {
        $this->ensureFeature();
        $this->requireAdmin();

        try {
            $result = VolunteerDonationService::markCompleted((int) $id, TenantContext::getId());
            return $this->respondWithData($result);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('NOT_FOUND', $e->getMessage(), null, 404);
        }
    }

    /** Returns raw CSV for donation export */
    public function exportDonations(): Response
    {
        $this->ensureFeature();
        $this->requireAdmin();

        $filters = [
            'date_from' => $this->query('date_from'),
            'date_to' => $this->query('date_to'),
        ];

        // The service returns rows — build real CSV (the array used to be
        // JSON-encoded straight into the .csv attachment).
        $rows = $this->volunteerDonationService->exportDonations(TenantContext::getId(), $filters);
        $handle = fopen('php://temp', 'r+');
        if (!empty($rows)) {
            fputcsv($handle, array_keys((array) $rows[0]));
            foreach ($rows as $row) {
                fputcsv($handle, CsvExportSanitizer::row(array_values((array) $row)));
            }
        }
        rewind($handle);
        $csv = stream_get_contents($handle);
        fclose($handle);

        return response($csv, 200)
            ->header('Content-Type', 'text/csv')
            ->header('Content-Disposition', 'attachment; filename="volunteer_donations_' . date('Y-m-d') . '.csv"');
    }

    // ========================================
    // GIVING DAYS
    // ========================================

    public function getGivingDays(): JsonResponse
    {
        $this->ensureFeature();
        $this->rateLimit('vol_giving_days', 30, 60);

        $result = $this->volunteerDonationService->getGivingDays();
        return $this->respondWithData($result);
    }

    /** Public endpoint -- giving day stats for fundraising pages */
    public function getGivingDayStats($id): JsonResponse
    {
        $this->ensureFeature();
        $this->rateLimit('vol_public_read', 60, 30);

        $stats = $this->volunteerDonationService->getGivingDayStats((int) $id);
        if (!$stats) {
            return $this->respondWithError('NOT_FOUND', __('api.vol_giving_day_not_found'), null, 404);
        }
        return $this->respondWithData($stats);
    }

    public function adminGivingDays(): JsonResponse
    {
        $this->ensureFeature();
        $this->requireAdmin();

        $result = $this->volunteerDonationService->adminGetGivingDays();
        $stats = DB::selectOne(
            "SELECT COUNT(*) as total_donations, COALESCE(SUM(amount), 0) as total_amount
             FROM vol_donations
             WHERE tenant_id = ? AND status = 'completed'",
            [TenantContext::getId()]
        );

        return $this->respondWithData([
            'giving_days' => $result,
            'donation_stats' => [
                'total_donations' => (int) ($stats->total_donations ?? 0),
                'total_amount' => (float) ($stats->total_amount ?? 0),
            ],
        ]);
    }

    public function createGivingDay(): JsonResponse
    {
        $this->ensureFeature();
        $adminId = $this->requireAdmin();

        $data = $this->getAllInput();

        try {
            $tenantId = TenantContext::getId();
            $data['created_by'] = $adminId;
            $result = $this->volunteerDonationService->createGivingDay($data, $tenantId);
            return $this->respondWithData($result, null, 201);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        }
    }

    public function updateGivingDay($id): JsonResponse
    {
        $this->ensureFeature();
        $this->requireAdmin();

        $data = $this->getAllInput();
        $tenantId = TenantContext::getId();
        $result = $this->volunteerDonationService->updateGivingDay((int) $id, $data, $tenantId);
        return $this->respondWithData(['success' => $result]);
    }

    // ========================================
    // WEBHOOKS
    // ========================================

    public function getWebhooks(): JsonResponse
    {
        $this->ensureFeature();
        $this->requireAdmin();

        $webhooks = $this->webhookDispatchService->getWebhooks();
        return $this->respondWithData($webhooks);
    }

    public function createWebhook(): JsonResponse
    {
        $this->ensureFeature();
        $adminId = $this->requireAdmin();

        $data = $this->getAllInput();

        try {
            $result = $this->webhookDispatchService->createWebhook($adminId, $data);
            return $this->respondWithData($result, null, 201);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        }
    }

    public function updateWebhook($id): JsonResponse
    {
        $this->ensureFeature();
        $this->requireAdmin();

        $data = $this->getAllInput();
        $result = $this->webhookDispatchService->updateWebhook((int) $id, $data);
        return $this->respondWithData(['success' => $result]);
    }

    public function deleteWebhook($id): JsonResponse
    {
        $this->ensureFeature();
        $this->requireAdmin();

        $result = $this->webhookDispatchService->deleteWebhook((int) $id);
        return $this->respondWithData(['success' => $result]);
    }

    public function testWebhook($id): JsonResponse
    {
        $this->ensureFeature();
        $this->requireAdmin();

        $result = $this->webhookDispatchService->testWebhook((int) $id);
        return $this->respondWithData($result);
    }

    public function getWebhookLogs($id): JsonResponse
    {
        $this->ensureFeature();
        $this->requireAdmin();

        $filters = [
            'cursor' => $this->query('cursor'),
            'limit' => $this->queryInt('per_page', 20, 1, 50),
        ];

        $logs = $this->webhookDispatchService->getLogs((int) $id, $filters);
        return $this->respondWithData($logs);
    }

    // ========================================
    // REMINDERS
    // ========================================

    public function getReminderSettings(): JsonResponse
    {
        $this->ensureFeature();
        $this->requireAdmin();

        $settings = $this->volunteerReminderService->getSettings();
        return $this->respondWithData($settings);
    }

    public function updateReminderSettings(): JsonResponse
    {
        $this->ensureFeature();
        $this->requireAdmin();
        $this->rateLimit('vol_reminder_settings_update', 10, 60);

        $data = $this->getAllInput();
        $type = $data['reminder_type'] ?? '';

        $allowedTypes = ['pre_shift', 'post_shift_feedback', 'lapsed_volunteer', 'credential_expiry', 'training_expiry'];
        if (!in_array($type, $allowedTypes, true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.vol_invalid_reminder_type', ['types' => implode(', ', $allowedTypes)]), 'reminder_type', 422);
        }

        $result = $this->volunteerReminderService->updateSetting($type, $data);
        return $this->respondWithData(['success' => $result]);
    }

    // ========================================
    // GUARDIAN CONSENTS
    // ========================================

    public function myGuardianConsents(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('vol_guardian_consents', 30, 60);

        $consents = $this->guardianConsentService->getConsentsForMinor($userId);
        return $this->respondWithData($consents);
    }

    public function requestGuardianConsent(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('vol_guardian_consent_request', 5, 60);

        $data = $this->getAllInput();
        $opportunityId = isset($data['opportunity_id']) ? (int) $data['opportunity_id'] : null;

        try {
            $result = $this->guardianConsentService->requestConsent($userId, $data, $opportunityId);
            return $this->respondWithData($result, null, 201);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        }
    }

    /**
     * Public endpoint -- no auth required.
     *
     * Read-only token lookup for the GET verify route. Deliberately does NOT
     * grant: the pending → active state change happens only via the POST route
     * (verifyGuardianConsent), so mail scanners prefetching the emailed link
     * can never record legal consent.
     */
    public function showGuardianConsentVerification($token): JsonResponse
    {
        $this->ensureFeature();
        $this->rateLimit('guardian_consent_verify_lookup', 20, 300);

        $status = $this->guardianConsentService->getConsentStatusByToken($token);

        if ($status === null) {
            return $this->respondWithError('INVALID_TOKEN', __('api.vol_consent_invalid_token'), null, 400);
        }

        return $this->respondWithData($status);
    }

    /** Public endpoint -- no auth required. POST only: grants the consent. */
    public function verifyGuardianConsent($token): JsonResponse
    {
        $this->ensureFeature();
        $this->rateLimit('guardian_consent_verify', 10, 300);

        $ip = request()->ip() ?? '0.0.0.0';
        $result = $this->guardianConsentService->grantConsent($token, $ip);

        if (!$result) {
            return $this->respondWithError('INVALID_TOKEN', __('api.vol_consent_invalid_token'), null, 400);
        }

        return $this->respondWithData(['success' => true, 'message' => __('api_controllers_2.volunteer_community.guardian_consent_granted')]);
    }

    public function withdrawGuardianConsent($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('vol_guardian_consent_withdraw', 10, 60);

        $result = $this->guardianConsentService->withdrawConsent((int) $id, $userId);
        if (!$result) {
            return $this->respondWithError('NOT_FOUND', __('api.vol_consent_not_found'), null, 404);
        }

        return $this->respondWithData(['success' => true]);
    }

    public function adminGuardianConsents(): JsonResponse
    {
        $this->ensureFeature();
        $this->requireAdmin();

        $filters = [
            'status' => $this->query('status'),
            'search' => $this->query('search'),
            'cursor' => $this->query('cursor'),
            'limit'  => $this->query('limit'),
        ];

        $consents = $this->guardianConsentService->getConsentsForAdmin($filters);
        return $this->respondWithData($consents);
    }
}
