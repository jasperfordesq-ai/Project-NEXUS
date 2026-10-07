<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Exceptions\FundraisingNotFoundException;
use App\Exceptions\SafeguardingPolicyException;
use App\Services\FundraisingHandoverService;
use App\Services\FundraisingHistoryService;
use App\Support\CsvExportSanitizer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Database\QueryException;
use App\Services\ShiftSwapService;
use App\Services\ShiftWaitlistService;
use App\Services\ShiftGroupReservationService;
use App\Services\RecurringShiftService;
use App\Services\VolunteerShiftManagementService;
use App\Services\VolunteerFormService;
use App\Services\CommunityProjectService;
use App\Services\VolunteerDonationService;
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
        private readonly VolunteerShiftManagementService $shiftManagementService,
        private readonly VolunteerFormService $volunteerFormService,
        private readonly CommunityProjectService $communityProjectService,
        private readonly VolunteerDonationService $volunteerDonationService,
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
            if ($code === 'GUARDIAN_CONSENT_REQUIRED') return 403;
            if ($code === 'ALREADY_EXISTS') return 409;
            if ($code === 'DECISION_CONFLICT') return 409;
            if ($code === 'IDEMPOTENCY_CONFLICT') return 409;
            if ($code === 'FEATURE_DISABLED') return 403;
            if (in_array($code, ['VALIDATION_REQUIRED_FIELD', 'VALIDATION_INVALID_FORMAT'], true)) return 422;
            if ($code === 'SERVER_ERROR') return 500;
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
        $headerKey = request()->header('Idempotency-Key');
        $bodyKey = request()->input('idempotency_key');
        if ($headerKey !== null && $bodyKey !== null && ! hash_equals(trim((string) $headerKey), trim((string) $bodyKey))) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_input'), 'idempotency_key', 422);
        }

        $data = [
            'from_shift_id' => $this->inputInt('from_shift_id'),
            'to_shift_id'   => $this->inputInt('to_shift_id'),
            'to_user_id'    => $this->inputInt('to_user_id'),
            'message'       => trim($this->input('message', '')),
            'idempotency_key' => $headerKey ?? $bodyKey,
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

        $filters = [];
        $limit = $this->inputInt('limit') ?: $this->inputInt('per_page');
        if ($limit) {
            $filters['limit'] = $limit;
        }
        $cursor = $this->query('cursor');
        if (is_string($cursor) && $cursor !== '') {
            $filters['cursor'] = $cursor;
        }

        $pagination = null;
        $requests = $this->shiftSwapService->getSwapRequests($userId, $direction, $filters, $pagination);

        // respondWithCollection keeps `data` a flat array — which is what the
        // native app's VolunteerShiftSwapsResponse already expects — and puts
        // the cursor in `meta`, so adding paging breaks no existing caller.
        return $this->respondWithCollection(
            $requests,
            $pagination['cursor'] ?? null,
            $filters['limit'] ?? 20,
            $pagination['has_more'] ?? false,
        );
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

        // The cron (CronJobRunner → processAllPatterns) tops patterns up 14 days
        // ahead, but it runs on its own clock: without this the organiser saved a
        // pattern and saw no shifts at all until the next run.
        $generated = $this->recurringShiftService->generateOccurrences($patternId, 14);

        $pattern = $this->recurringShiftService->getPattern($patternId) ?? [];
        $pattern['shifts_generated'] = $generated;
        return $this->respondWithData($pattern, null, 201);
    }

    // ========================================
    // ONE-OFF SHIFTS (organisers and admins)
    // ========================================

    /** POST /v2/volunteering/opportunities/{id}/shifts */
    public function createShift($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_shift_create', 30, 60);

        $shift = $this->shiftManagementService->createShift((int) $id, $userId, $this->getAllInput());
        if ($shift === null) {
            $errors = $this->shiftManagementService->getErrors();
            return $this->respondWithErrors($errors, $this->getErrorStatus($errors));
        }

        return $this->respondWithData($shift, null, 201);
    }

    /** PUT /v2/volunteering/shifts/{id} */
    public function updateShift($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_shift_update', 30, 60);

        $shift = $this->shiftManagementService->updateShift((int) $id, $userId, $this->getAllInput());
        if ($shift === null) {
            $errors = $this->shiftManagementService->getErrors();
            return $this->respondWithErrors($errors, $this->getErrorStatus($errors));
        }

        return $this->respondWithData($shift);
    }

    /** GET /v2/volunteering/shifts/{id}/roster — who is on the shift and who checked in (managers only). */
    public function shiftRoster($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_shift_roster', 60, 60);

        $roster = $this->shiftManagementService->getShiftRoster((int) $id, $userId);
        if ($roster === null) {
            $errors = $this->shiftManagementService->getErrors();
            return $this->respondWithErrors($errors, $this->getErrorStatus($errors));
        }

        return $this->respondWithData($roster);
    }

    /** DELETE /v2/volunteering/shifts/{id} */
    public function deleteShift($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_shift_delete', 30, 60);

        $result = $this->shiftManagementService->deleteShift((int) $id, $userId);
        if ($result === null) {
            $errors = $this->shiftManagementService->getErrors();
            return $this->respondWithErrors($errors, $this->getErrorStatus($errors));
        }

        return $this->respondWithData($result);
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

        $input = $this->getAllInput();
        $success = $this->recurringShiftService->updatePattern($patternId, $input, $userId);

        if (!$success) {
            $errors = $this->recurringShiftService->getErrors();
            return $this->respondWithErrors($errors, $this->getErrorStatus($errors));
        }

        // A change to WHEN the pattern repeats is applied to its future shifts now,
        // not left for the cron: shifts on dropped days go (unless someone is booked
        // on them) and the new days appear straight away.
        $reconciled = null;
        $repeatFields = ['days_of_week', 'frequency', 'start_time', 'end_time', 'start_date', 'end_date', 'max_occurrences'];
        if (array_intersect($repeatFields, array_keys($input)) !== []) {
            $reconciled = $this->recurringShiftService->reconcileFutureShifts($patternId);
        }

        $pattern = $this->recurringShiftService->getPattern($patternId) ?? [];
        if ($reconciled !== null) {
            $pattern['shifts_removed'] = $reconciled['removed'];
            $pattern['shifts_kept'] = $reconciled['kept'];
            $pattern['shifts_generated'] = $reconciled['generated'];
        }
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

        // F-227: the save replaces the member's whole set, so a missing or
        // malformed `needs` list is refused before anything is deleted, and a
        // write that fails is reported as a failure instead of `success: true`.
        if (!array_key_exists('needs', $data)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_input'), 'needs', 422);
        }
        $invalidField = VolunteerFormService::accessibilityNeedsInputError($data['needs']);
        if ($invalidField !== null) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_input'), $invalidField, 422);
        }

        if (!$this->volunteerFormService->updateAccessibilityNeeds($userId, $data['needs'], $tenantId)) {
            return $this->respondWithError('INTERNAL_ERROR', __('api.server_error'), null, 500);
        }

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
        $data['idempotency_key'] = request()->header('Idempotency-Key') ?? $this->input('idempotency_key');
        if ($userId) {
            $data['user_id'] = $userId;
        }

        try {
            $result = $this->volunteerDonationService->createDonation($userId ?: 0, $data);
            return $this->respondWithData($result, null, 201);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        } catch (QueryException $e) {
            // QueryException extends RuntimeException; left to the branch below it
            // answered 400 with the SQL statement and its bindings in the body (F-016).
            Log::error('[VolunteerCommunityController] createDonation database failure', ['error' => $e->getMessage()]);
            return $this->respondWithError('SERVER_ERROR', __('api.unexpected_error'), null, 500);
        } catch (\RuntimeException $e) {
            $status = (int) $e->getCode() === 409 ? 409 : 400;
            return $this->respondWithError($status === 409 ? 'IDEMPOTENCY_CONFLICT' : 'VALIDATION_ERROR', $e->getMessage(), null, $status);
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
        $adminId = $this->requireAdmin();

        try {
            $result = VolunteerDonationService::markCompleted((int) $id, TenantContext::getId(), $adminId);
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
            \App\Support\CsvExportSanitizer::put($handle, array_keys((array) $rows[0]));
            foreach ($rows as $row) {
                \App\Support\CsvExportSanitizer::put($handle, CsvExportSanitizer::row(array_values((array) $row)));
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
        $adminId = $this->requireAdmin();

        $data = $this->getAllInput();
        $tenantId = TenantContext::getId();

        // Resolve the giving day inside this community first. The service
        // returns false for a foreign id, which previously surfaced as a 200
        // with `success: false` (CrossCommunityAccessSweepTest).
        $exists = \App\Models\VolGivingDay::query()
            ->whereKey((int) $id)
            ->where('tenant_id', $tenantId)
            ->exists();
        if (! $exists) {
            return $this->respondWithError('NOT_FOUND', __('api.vol_giving_day_not_found'), null, 404);
        }

        try {
            $result = $this->volunteerDonationService->updateGivingDay((int) $id, $data, $tenantId, $adminId);
        } catch (\InvalidArgumentException $e) {
            // e.g. a non-positive goal, an unknown organisation, or an
            // organisation change on a campaign that already has gifts.
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        }
        return $this->respondWithData(['success' => $result]);
    }

    /** GET /v2/admin/volunteering/giving-days/{id}/history — the campaign's audit trail. */
    public function givingDayHistory($id): JsonResponse
    {
        $this->ensureFeature();
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        if (! \App\Models\VolGivingDay::query()->whereKey((int) $id)->where('tenant_id', $tenantId)->exists()) {
            return $this->respondWithError('NOT_FOUND', __('fundraising.campaign_not_found'), null, 404);
        }

        return $this->respondWithData([
            'items' => FundraisingHistoryService::forCampaign($tenantId, (int) $id, false),
        ]);
    }

    /** GET /v2/admin/volunteering/giving-days/{id}/handovers — hand-overs and what is still held. */
    public function givingDayHandovers($id): JsonResponse
    {
        $this->ensureFeature();
        $this->requireAdmin();

        return $this->fundraisingCall(
            fn () => FundraisingHandoverService::listForCampaign(TenantContext::getId(), (int) $id),
        );
    }

    /** POST /v2/admin/volunteering/giving-days/{id}/handovers — record money passed on to the organisation. */
    public function recordHandover($id): JsonResponse
    {
        $this->ensureFeature();
        $adminId = $this->requireAdmin();

        return $this->fundraisingCall(
            fn () => FundraisingHandoverService::record(TenantContext::getId(), (int) $id, $adminId, $this->getAllInput()),
            201,
        );
    }

    /** POST /v2/admin/volunteering/handovers/{handoverId}/cancel — cancel a mistaken hand-over, with a reason. */
    public function cancelHandover($handoverId): JsonResponse
    {
        $this->ensureFeature();
        $adminId = $this->requireAdmin();
        $reason = (string) ($this->getAllInput()['reason'] ?? '');

        return $this->fundraisingCall(
            fn () => FundraisingHandoverService::cancel(TenantContext::getId(), (int) $handoverId, $adminId, $reason),
        );
    }

    private function fundraisingCall(callable $call, int $status = 200): JsonResponse
    {
        try {
            return $this->respondWithData($call(), null, $status);
        } catch (FundraisingNotFoundException $e) {
            return $this->respondWithError('NOT_FOUND', $e->getMessage(), null, 404);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        }
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
        try {
            $result = $this->webhookDispatchService->updateWebhook((int) $id, $data);
        } catch (\InvalidArgumentException $e) {
            // Same refusal as createWebhook (a bad URL here used to be a 500).
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        }
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
    // GUARDIAN CONSENTS — RETIRED
    // ========================================
    //
    // Adults-only platform (owner decision 2026-09-25, E-035 F-160): under-18
    // participation is removed, not supervised, so guardian consent has no
    // purpose. Every endpoint refuses with 410 GUARDIAN_CONSENT_RETIRED, so an
    // old client gets a clear answer. The `vol_guardian_consents` table and its
    // rows stay for GDPR export and retention; GuardianConsentService and its
    // emails were removed on 7 Oct 2026 as unreachable code.

    public function myGuardianConsents(): JsonResponse
    {
        return $this->guardianConsentRetired();
    }

    public function requestGuardianConsent(): JsonResponse
    {
        return $this->guardianConsentRetired();
    }

    /** Public endpoint -- no auth required. */
    public function showGuardianConsentVerification($token): JsonResponse
    {
        return $this->guardianConsentRetired();
    }

    /** Public endpoint -- no auth required. */
    public function verifyGuardianConsent($token): JsonResponse
    {
        return $this->guardianConsentRetired();
    }

    public function withdrawGuardianConsent($id): JsonResponse
    {
        return $this->guardianConsentRetired();
    }

    public function adminGuardianConsents(): JsonResponse
    {
        $this->requireAdmin();

        return $this->guardianConsentRetired();
    }

    private function guardianConsentRetired(): JsonResponse
    {
        return $this->respondWithError(
            'GUARDIAN_CONSENT_RETIRED',
            __('api.guardian_consent_retired', ['age' => \App\Support\Authorization\MinimumAge::YEARS]),
            null,
            410
        );
    }
}
