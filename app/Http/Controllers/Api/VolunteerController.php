<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Exceptions\SafeguardingPolicyException;
use Illuminate\Http\JsonResponse;
use App\Http\Requests\Volunteering\ApplyOpportunityRequest;
use App\Http\Requests\Volunteering\CreateOpportunityRequest;
use App\Http\Requests\Volunteering\CreateOrganisationRequest;
use App\Http\Requests\Volunteering\CreateReviewRequest;
use App\Http\Requests\Volunteering\HandleApplicationRequest;
use App\Http\Requests\Volunteering\LogHoursRequest;
use App\Http\Requests\Volunteering\UpdateOpportunityRequest;
use App\Http\Requests\Volunteering\UpdateOrganisationRequest;
use App\Http\Requests\Volunteering\VerifyHoursRequest;
use App\Http\Resources\PublicOrganisationResource;
use App\Services\VolunteerService;
use App\Services\VolunteerMatchingService;
use App\Services\VolunteeringConfigurationService;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\Notification;
use App\Models\User;
use App\Services\NotificationDispatcher;
use App\Services\VolOrgWalletService;
use App\Models\VolApplication;
use App\Models\VolOpportunity;
use App\Models\VolShift;
use Illuminate\Support\Facades\DB;

/**
 * VolunteerController -- Core volunteering: opportunities, applications, shifts, hours,
 * organisations, and reviews.
 *
 * Extracted sub-controllers:
 *  - VolunteerCheckInController (QR check-in/out/verify)
 *  - VolunteerExpenseController (expenses, policies)
 *  - VolunteerCertificateController (certificates, credentials)
 *  - VolunteerWellbeingController (wellbeing, emergency alerts, safeguarding, training, incidents)
 *  - VolunteerCommunityController (swaps, waitlist, group reservations, recurring, custom fields,
 *    accessibility, community projects, donations, giving days, webhooks, reminders, guardian consents)
 */
class VolunteerController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly VolunteerService $volunteerService,
        private readonly VolunteerMatchingService $volunteerMatchingService,
    ) {}

    private function ensureFeature(): void
    {
        if (!TenantContext::hasFeature('volunteering')) {
            throw new \Illuminate\Http\Exceptions\HttpResponseException(
                $this->respondWithError('FEATURE_DISABLED', __('api.volunteering_feature_disabled'), null, 403)
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
    // OPPORTUNITIES
    // ========================================

    public function opportunities(): JsonResponse
    {
        $this->ensureFeature();
        $this->rateLimit('volunteering_list', 60, 60);

        $filters = ['limit' => $this->queryInt('per_page', 20, 1, 50)];
        $viewerId = $this->resolveSanctumUserOptionally();
        if ($viewerId) $filters['viewer_id'] = $viewerId;
        if ($this->query('organization_id')) $filters['organization_id'] = (int) $this->query('organization_id');
        if ($this->query('category_id')) $filters['category_id'] = (int) $this->query('category_id');
        if ($this->query('search')) $filters['search'] = $this->query('search');
        if ($this->queryBool('is_remote')) $filters['is_remote'] = true;
        if ($this->query('cursor')) $filters['cursor'] = $this->query('cursor');

        // Proximity / radius filter (near_lat, near_lng, radius_km)
        $nearLat = $this->query('near_lat');
        $nearLng = $this->query('near_lng');
        $radiusKm = $this->query('radius_km');
        if ($nearLat !== null && $nearLng !== null && $radiusKm !== null) {
            $lat = (float) $nearLat;
            $lng = (float) $nearLng;
            $km  = max(0.1, min(500, (float) $radiusKm));
            if ($lat >= -90 && $lat <= 90 && $lng >= -180 && $lng <= 180) {
                $filters['near_lat']  = $lat;
                $filters['near_lng']  = $lng;
                $filters['radius_km'] = $km;
            }
        }

        $result = $this->volunteerService->getOpportunities($filters);
        return $this->respondWithCollection($result['items'], $result['cursor'], $filters['limit'], $result['has_more']);
    }

    public function showOpportunity($id): JsonResponse
    {
        $this->ensureFeature();
        $this->rateLimit('volunteering_show', 120, 60);
        $viewerId = $this->getOptionalUserId() ?? $this->resolveSanctumUserOptionally();
        $opportunity = $this->volunteerService->getOpportunityById((int) $id, $viewerId);
        if (!$opportunity) return $this->respondWithError('NOT_FOUND', __('api.opportunity_not_found'), null, 404);
        return $this->respondWithData($opportunity);
    }

    public function show(int $id): JsonResponse
    {
        return $this->showOpportunity($id);
    }

    public function createOpportunity(CreateOpportunityRequest $request): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_create', 10, 60);
        $data = $this->getAllInput();
        $data['created_by'] = $userId;
        $opportunity = $this->volunteerService->createOpportunity($userId, $data);
        if (!$opportunity) {
            $errors = $this->volunteerService->getErrors();
            return $this->respondWithErrors($errors, $this->getErrorStatus($errors));
        }
        return $this->respondWithData($opportunity, null, 201);
    }

    public function updateOpportunity(UpdateOpportunityRequest $request, $id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_update', 20, 60);

        $data = [];
        foreach (['title', 'description', 'location', 'skills_needed', 'start_date', 'end_date'] as $field) {
            if ($this->input($field) !== null) $data[$field] = trim($this->input($field));
        }
        if ($this->input('is_remote') !== null) $data['is_remote'] = $this->inputBool('is_remote');
        if ($this->input('category_id') !== null) $data['category_id'] = $this->inputInt('category_id') ?: null;
        // Geo-coordinates are validated by UpdateOpportunityRequest and supported by
        // the service, but were previously never forwarded — editing an opportunity
        // silently wiped its lat/lng. Pass them through as numeric (never trimmed).
        foreach (['latitude', 'longitude'] as $geoField) {
            if ($this->input($geoField) !== null) {
                $data[$geoField] = $this->input($geoField) === '' ? null : $this->input($geoField);
            }
        }
        if ($this->input('federated_visibility') !== null) $data['federated_visibility'] = $this->input('federated_visibility');

        $success = $this->volunteerService->updateOpportunity((int) $id, $userId, $data);
        if (!$success) {
            $errors = $this->volunteerService->getErrors();
            return $this->respondWithErrors($errors, $this->getErrorStatus($errors));
        }

        $opportunity = $this->volunteerService->getOpportunityById((int) $id, $userId);
        return $this->respondWithData($opportunity);
    }

    public function deleteOpportunity($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_delete', 10, 60);

        $success = $this->volunteerService->deleteOpportunity((int) $id, $userId);
        if (!$success) {
            $errors = $this->volunteerService->getErrors();
            return $this->respondWithErrors($errors, $this->getErrorStatus($errors));
        }
        return $this->noContent();
    }

    // ========================================
    // APPLICATIONS
    // ========================================

    public function apply(ApplyOpportunityRequest $request, int $id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_apply', 20, 60);

        // Minors (by date_of_birth) need an active guardian consent before
        // taking part in volunteering. Adults (or users without a recorded
        // date of birth) are unaffected.
        if (VolunteeringConfigurationService::get(VolunteeringConfigurationService::CONFIG_GUARDIAN_CONSENT_REQUIRED, false)
            && \App\Services\GuardianConsentService::isMinor($userId)
            && !\App\Services\GuardianConsentService::checkConsent($userId, (int) $id)) {
            return $this->respondWithError('GUARDIAN_CONSENT_REQUIRED', __('api.guardian_consent_required'), null, 403);
        }

        $data = ['message' => trim($this->input('message', '')), 'shift_id' => $this->inputInt('shift_id') ?: null];

        // Check for duplicate application (tenant-scoped to prevent cross-tenant leaks)
        $existing = VolApplication::where('opportunity_id', $id)
            ->where('user_id', $userId)
            ->where('tenant_id', TenantContext::getId())
            ->whereIn('status', ['pending', 'approved'])
            ->exists();
        if ($existing) {
            return $this->respondWithError('ALREADY_EXISTS', __('api.already_applied'), null, 409);
        }

        try {
            $application = $this->volunteerService->apply($id, $userId, $data);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        } catch (\RuntimeException $e) {
            $status = (int) $e->getCode();
            if (!in_array($status, [400, 403, 404, 409, 422], true)) {
                $status = 404;
            }
            $code = $status === 409 ? 'ALREADY_EXISTS' : ($status === 403 ? 'FORBIDDEN' : ($status === 422 ? 'VALIDATION_ERROR' : 'NOT_FOUND'));
            return $this->respondWithError($code, $e->getMessage(), null, $status);
        }

        // Notify the opportunity organizer about the new application
        try {
            $opportunity = VolOpportunity::where('tenant_id', TenantContext::getId())->find($id);
            if (!$opportunity || (int) $opportunity->tenant_id !== TenantContext::getId()) {
                throw new \RuntimeException(__('api.tenant_mismatch_error'));
            }
            if ($opportunity && $opportunity->created_by && $opportunity->created_by !== $userId) {
                $volunteer = User::find($userId);
                $organizer = User::find((int) $opportunity->created_by);
                LocaleContext::withLocale($organizer, function () use ($volunteer, $opportunity) {
                    $volunteerName = $volunteer->name ?? __('emails.common.fallback_someone');
                    $notifContent = __('notifications.vol_application_received_body', [
                        'name' => $volunteerName,
                        'title' => $opportunity->title,
                    ]);
                    $orgId = $opportunity->organization_id;
                    $notifLink = "/volunteering/org/{$orgId}/dashboard?tab=applications";

                    $htmlContent = NotificationDispatcher::buildVolApplicationReceivedEmail(
                        $volunteerName,
                        $opportunity->title,
                        (int) $orgId
                    );

                    NotificationDispatcher::dispatch(
                        (int) $opportunity->created_by,
                        'global',
                        0,
                        'vol_application_received',
                        $notifContent,
                        $notifLink,
                        $htmlContent
                    );
                });
            }
        } catch (\Throwable $e) {
            // Notification failure must not break the main flow
        }

        return $this->respondWithData($application, null, 201);
    }

    public function myApplications(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_my_apps', 60, 60);
        $filters = ['limit' => $this->queryInt('per_page', 20, 1, 50)];
        if ($this->query('status')) $filters['status'] = $this->query('status');
        if ($this->query('cursor')) $filters['cursor'] = $this->query('cursor');

        $result = $this->volunteerService->getMyApplications($userId, $filters);
        return $this->respondWithCollection($result['items'], $result['cursor'], $filters['limit'], $result['has_more']);
    }

    public function opportunityApplications($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_opp_apps', 60, 60);

        $filters = ['limit' => $this->queryInt('per_page', 20, 1, 50)];
        if ($this->query('status')) $filters['status'] = $this->query('status');
        if ($this->query('cursor')) $filters['cursor'] = $this->query('cursor');

        $result = $this->volunteerService->getApplicationsForOpportunity((int) $id, $userId, $filters);
        if ($result === null) {
            $errors = $this->volunteerService->getErrors();
            return $this->respondWithErrors($errors, $this->getErrorStatus($errors));
        }
        return $this->respondWithData(['items' => $result['items'], 'cursor' => $result['cursor'], 'has_more' => $result['has_more']]);
    }

    public function handleApplication(HandleApplicationRequest $request, $id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_handle_app', 30, 60);

        $action = $this->input('action');
        $orgNote = trim((string) ($this->input('org_note') ?? ''));
        if (!$action || !in_array($action, ['approve', 'decline'], true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.action_must_be_approve_or_decline'), 'action', 400);
        }

        try {
            $success = $this->volunteerService->handleApplication((int) $id, $userId, $action, $orgNote);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }
        if (!$success) {
            $errors = $this->volunteerService->getErrors();
            return $this->respondWithErrors($errors, $this->getErrorStatus($errors));
        }

        // Notify the volunteer about the application decision (bell + email + push)
        try {
            $tenantId = TenantContext::getId();
            $application = VolApplication::where('tenant_id', $tenantId)->find($id);
            if (!$application || (int) $application->tenant_id !== $tenantId) {
                throw new \RuntimeException(__('api.tenant_mismatch_error'));
            }
            if ($application && $application->user_id) {
                $opportunityId = $application->opportunity_id;
                $opportunity = VolOpportunity::where('tenant_id', $tenantId)->find($opportunityId);
                $applicant = User::find((int) $application->user_id);
                LocaleContext::withLocale($applicant, function () use ($application, $opportunity, $opportunityId, $action) {
                    $oppTitle = $opportunity->title ?? __('notifications.vol_application_fallback_opportunity');

                    if ($action === 'approve') {
                        $message = __('notifications.vol_application_approved_body', ['title' => $oppTitle]);
                        $notifType = 'vol_application_approved';
                        $htmlContent = NotificationDispatcher::buildVolApplicationApprovedEmail($oppTitle, $opportunityId);
                    } else {
                        $message = __('notifications.vol_application_declined_body', ['title' => $oppTitle]);
                        $notifType = 'vol_application_declined';
                        $htmlContent = NotificationDispatcher::buildVolApplicationDeclinedEmail($oppTitle);
                    }

                    NotificationDispatcher::dispatch(
                        (int) $application->user_id,
                        'global',
                        0,
                        $notifType,
                        $message,
                        "/volunteering/opportunities/{$opportunityId}",
                        $htmlContent
                    );
                });
            }
        } catch (\Throwable $e) {
            // Notification failure must not break the main flow
        }

        return $this->respondWithData(['id' => (int) $id, 'status' => $action === 'approve' ? 'approved' : 'declined']);
    }

    public function withdrawApplication($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_withdraw', 20, 60);

        $success = $this->volunteerService->withdrawApplication((int) $id, $userId);
        if (!$success) {
            $errors = $this->volunteerService->getErrors();
            return $this->respondWithErrors($errors, $this->getErrorStatus($errors));
        }
        return $this->noContent();
    }

    // ========================================
    // SHIFTS
    // ========================================

    public function myShifts(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_my_shifts', 60, 60);
        $filters = ['limit' => $this->queryInt('per_page', 20, 1, 50)];
        if ($this->query('cursor')) $filters['cursor'] = $this->query('cursor');
        $shifts = $this->volunteerService->getMyShifts($userId, $filters);
        return $this->respondWithData($shifts);
    }

    public function shifts($id): JsonResponse
    {
        $this->ensureFeature();
        $this->rateLimit('volunteering_shifts', 120, 60);
        // Same public-visibility gate as showOpportunity(): shift details of
        // cancelled/hidden opportunities must 404 unless the caller can manage
        // the opportunity.
        $viewerId = $this->getOptionalUserId() ?? $this->resolveSanctumUserOptionally();
        $shifts = $this->volunteerService->getShiftsForOpportunity((int) $id, $viewerId);
        if ($shifts === null) {
            return $this->respondWithError('NOT_FOUND', __('api.opportunity_not_found'), null, 404);
        }
        return $this->respondWithData($shifts);
    }

    public function signUp($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_shift_signup', 20, 60);

        // Guardian-consent gate for minors (see apply()).
        if (VolunteeringConfigurationService::get(VolunteeringConfigurationService::CONFIG_GUARDIAN_CONSENT_REQUIRED, false)
            && \App\Services\GuardianConsentService::isMinor($userId)) {
            $gateOppId = VolShift::where('tenant_id', TenantContext::getId())
                ->where('id', (int) $id)
                ->value('opportunity_id');
            if (!\App\Services\GuardianConsentService::checkConsent($userId, $gateOppId ? (int) $gateOppId : null)) {
                return $this->respondWithError('GUARDIAN_CONSENT_REQUIRED', __('api.guardian_consent_required'), null, 403);
            }
        }

        try {
            $success = $this->volunteerService->signUpForShift((int) $id, $userId);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }
        if (!$success) {
            $errors = $this->volunteerService->getErrors();
            return $this->respondWithErrors($errors, $this->getErrorStatus($errors));
        }

        // Notify the opportunity organizer about the shift sign-up
        try {
            $shift = VolShift::with('opportunity')->find($id);
            if (!$shift || (int) $shift->tenant_id !== TenantContext::getId()) {
                throw new \RuntimeException(__('api.tenant_mismatch_error'));
            }
            if ($shift && $shift->opportunity && $shift->opportunity->created_by && $shift->opportunity->created_by !== $userId) {
                $volunteer = User::find($userId);
                $organizer = User::find((int) $shift->opportunity->created_by);
                LocaleContext::withLocale($organizer, function () use ($volunteer, $shift) {
                    $volunteerName = $volunteer->name ?? __('emails.common.fallback_someone');
                    Notification::createNotification(
                        (int) $shift->opportunity->created_by,
                        __('notifications.vol_shift_signup_body', ['name' => $volunteerName]),
                        "/volunteering/opportunities/{$shift->opportunity_id}",
                        'volunteering'
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) ((int) $shift->opportunity->created_by), 'volunteering', __('notifications.vol_shift_signup_body', ['name' => $volunteerName]), "/volunteering/opportunities/{$shift->opportunity_id}");
                });
            }
        } catch (\Throwable $e) {
            // Notification failure must not break the main flow
        }

        return $this->respondWithData(['shift_id' => (int) $id, 'message' => __('api_controllers_2.volunteer.signed_up_for_shift')]);
    }

    public function cancelSignup($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_shift_cancel', 20, 60);

        $success = $this->volunteerService->cancelShiftSignup((int) $id, $userId);
        if (!$success) {
            $errors = $this->volunteerService->getErrors();
            return $this->respondWithErrors($errors, $this->getErrorStatus($errors));
        }
        return $this->noContent();
    }

    // ========================================
    // HOURS
    // ========================================

    public function logHours(LogHoursRequest $request): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_log_hours', 20, 60);

        $data = [
            'organization_id' => $this->inputInt('organization_id'),
            'opportunity_id'  => $this->inputInt('opportunity_id') ?: null,
            'date'            => $this->input('date'),
            'hours'           => (float) $this->input('hours'),
            'description'     => trim($this->input('description', '')),
        ];

        $logId = $this->volunteerService->logHours($userId, $data);
        if ($logId === null) {
            $errors = $this->volunteerService->getErrors();
            return $this->respondWithErrors($errors, $this->getErrorStatus($errors));
        }

        $status = VolunteerService::getLastLogStatus();
        $message = $status === 'approved'
            ? __('api_controllers_2.volunteer.hours_logged_approved')
            : __('api_controllers_2.volunteer.hours_logged_pending');

        return $this->respondWithData(['id' => $logId, 'status' => $status, 'message' => $message], null, 201);
    }

    public function myHours(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_my_hours', 60, 60);
        $filters = ['limit' => $this->queryInt('per_page', 20, 1, 50)];
        if ($this->query('cursor')) $filters['cursor'] = $this->query('cursor');
        $hours = $this->volunteerService->getMyHours($userId, $filters);
        return $this->respondWithData($hours);
    }

    public function hoursSummary(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_hours_summary', 60, 60);
        $summary = $this->volunteerService->getHoursSummary($userId);
        return $this->respondWithData($summary);
    }

    public function pendingHoursReview(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_pending_hours', 60, 60);

        $filters = ['limit' => $this->queryInt('per_page', 20, 1, 50)];
        if ($this->query('cursor')) $filters['cursor'] = $this->query('cursor');

        $result = $this->volunteerService->getPendingHoursForOrgOwner($userId, $filters);
        return $this->respondWithData(['items' => $result['items'], 'cursor' => $result['cursor'], 'has_more' => $result['has_more']]);
    }

    public function verifyHours(VerifyHoursRequest $request, $id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_verify_hours', 30, 60);

        $action = $this->input('action');
        if (!$action || !in_array($action, ['approve', 'decline'], true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.action_must_be_approve_or_decline'), 'action', 400);
        }

        $success = $this->volunteerService->verifyHours((int) $id, $userId, $action);
        if (!$success) {
            $errors = $this->volunteerService->getErrors();
            return $this->respondWithErrors($errors, $this->getErrorStatus($errors));
        }
        return $this->respondWithData([
            'id' => (int) $id,
            'status' => $action === 'approve' ? 'approved' : 'declined',
            // 'paid' | 'no_whole_hours' | 'already_paid' | 'already_processed' | null
            // Approval always mints credits; lets the org dashboard show an accurate toast.
            'payment_result' => $this->volunteerService->getLastPaymentOutcome(),
        ]);
    }

    // ========================================
    // ORGANISATIONS
    // ========================================

    public function organisations(): JsonResponse
    {
        $this->ensureFeature();
        $this->rateLimit('volunteering_orgs', 60, 60);
        $filters = ['limit' => $this->queryInt('per_page', 20, 1, 50)];
        if ($this->query('search')) $filters['search'] = $this->query('search');
        if ($this->query('cursor')) $filters['cursor'] = $this->query('cursor');
        $result = $this->volunteerService->getOrganisations($filters);
        // Public endpoint (withoutMiddleware('auth:sanctum')) — never expose
        // wallet/financial state or internal identifiers, mirroring
        // showOrganisation() below.
        $items = array_map(function (array $org): array {
            return PublicOrganisationResource::augment($this->stripInternalOrgFields($org));
        }, $result['items']);
        return $this->respondWithCollection($items, $result['cursor'], $filters['limit'], $result['has_more']);
    }

    /**
     * Remove internal / financial / safeguarding fields before an organisation
     * row is returned to an UNAUTHENTICATED caller. The public directory needs
     * the org's public profile only — never its wallet state, the owner's or
     * safeguarding officers' internal user ids, or the tenant id.
     *
     * @param array<string, mixed> $org
     * @return array<string, mixed>
     */
    private function stripInternalOrgFields(array $org): array
    {
        unset(
            $org['balance'],
            $org['auto_pay_enabled'],
            $org['tenant_id'],
            $org['user_id'],
            $org['dlp_user_id'],
            $org['deputy_dlp_user_id'],
        );

        // The eager-loaded owner relation ({id, first_name, last_name,
        // avatar_url}) survives toArray() — keep the display fields but never
        // re-leak the owner's internal user id we just stripped above.
        if (isset($org['owner']) && is_array($org['owner'])) {
            unset($org['owner']['id']);
        }

        return $org;
    }

    public function showOrganisation($id): JsonResponse
    {
        $this->ensureFeature();
        $this->rateLimit('volunteering_org_show', 120, 60);
        $org = $this->volunteerService->getOrganisationById((int) $id);
        if (!$org) return $this->respondWithError('NOT_FOUND', __('api.organization_not_found'), null, 404);
        // This endpoint is public (withoutMiddleware('auth:sanctum')). Never expose
        // internal wallet/financial state or the owner/safeguarding-officer user
        // ids to unauthenticated callers — org owners read balance/auto-pay from
        // the ownership-scoped /organisations/{id}/stats endpoint instead.
        return $this->respondWithData(PublicOrganisationResource::augment($this->stripInternalOrgFields($org)));
    }

    public function myOrganisations(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_my_orgs', 60, 60);
        $filters = ['limit' => $this->queryInt('per_page', 20, 1, 50)];
        if ($this->query('cursor')) $filters['cursor'] = $this->query('cursor');

        $result = $this->volunteerService->getMyOrganizations($userId, $filters);
        return $this->respondWithCollection($result['items'], $result['cursor'], $filters['limit'], $result['has_more']);
    }

    public function createOrganisation(CreateOrganisationRequest $request): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_org_create', 5, 60);

        $data = [
            'name'          => trim($this->input('name', '')),
            'description'   => trim($this->input('description', '')),
            'contact_email' => trim($this->input('contact_email', '')),
            'website'       => trim($this->input('website', '')),
        ];

        $orgId = $this->volunteerService->createOrganization($userId, $data);
        if ($orgId === null) {
            $errors = $this->volunteerService->getErrors();
            return $this->respondWithErrors($errors, $this->getErrorStatus($errors));
        }
        $org = $this->volunteerService->getOrganizationById($orgId, true);
        return $this->respondWithData($org, null, 201);
    }

    // ========================================
    // REVIEWS
    // ========================================

    public function createReview(CreateReviewRequest $request): JsonResponse
    {
        $this->ensureFeature();
        if (! VolunteeringConfigurationService::get(VolunteeringConfigurationService::CONFIG_ENABLE_REVIEWS, true)) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.module_disabled_for_community'), null, 403);
        }
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_review', 10, 60);

        $targetType = $this->input('target_type');
        $targetId = $this->inputInt('target_id');
        $rating = $this->inputInt('rating');
        $comment = trim($this->input('comment', ''));

        try {
            $reviewId = $this->volunteerService->createReview($userId, $targetType, $targetId, $rating, $comment);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }
        if ($reviewId === null) {
            $errors = $this->volunteerService->getErrors();
            return $this->respondWithErrors($errors, $this->getErrorStatus($errors));
        }
        return $this->respondWithData(['id' => $reviewId, 'rating' => $rating, 'message' => __('api_controllers_2.volunteer.review_submitted')], null, 201);
    }

    public function getReviews($type, $id): JsonResponse
    {
        $this->ensureFeature();
        if (! VolunteeringConfigurationService::get(VolunteeringConfigurationService::CONFIG_ENABLE_REVIEWS, true)) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.module_disabled_for_community'), null, 403);
        }
        $this->rateLimit('volunteering_reviews', 60, 60);
        if (!in_array($type, ['organization', 'user'])) return $this->respondWithError('VALIDATION_ERROR', __('api.type_must_be_org_or_user'), 'type', 400);
        $reviews = $this->volunteerService->getReviews($type, (int) $id);
        return $this->respondWithData(['reviews' => $reviews]);
    }

    public function getOrganizationReviews($id): JsonResponse
    {
        return $this->getReviews('organization', (int) $id);
    }

    // ========================================
    // RECOMMENDED SHIFTS
    // ========================================

    public function recommendedShifts(): JsonResponse
    {
        $this->ensureFeature();
        if (! VolunteeringConfigurationService::get(VolunteeringConfigurationService::CONFIG_ENABLE_MATCHING, true)) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.module_disabled_for_community'), null, 403);
        }
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_recommended', 30, 60);

        $shifts = $this->volunteerMatchingService->getRecommendedShifts($userId, [
            'limit' => $this->queryInt('limit', 10, 1, 20),
            'min_match_score' => $this->queryInt('min_score', 20, 0, 100),
        ]);

        return $this->respondWithData($shifts);
    }

    // ========================================
    // ORGANISATION DASHBOARD & WALLET
    // ========================================

    /**
     * Verify the current user is owner/admin of the given vol org.
     * Returns the org row or null (and sets 403 response).
     */
    private function ensureOrgAccess(int $orgId): ?object
    {
        $tenantId = TenantContext::getId();
        $userId = $this->getUserId();

        $org = DB::selectOne(
            "SELECT * FROM vol_organizations WHERE id = ? AND tenant_id = ?",
            [$orgId, $tenantId]
        );
        if (!$org) {
            return null;
        }

        // Org creator always has access
        if ((int) $org->user_id === $userId) {
            return $org;
        }

        // Org members with owner/admin role have access
        $membership = DB::selectOne(
            "SELECT role FROM org_members WHERE tenant_id = ? AND organization_id = ? AND org_type = 'volunteer' AND user_id = ? AND status = 'active'",
            [$tenantId, $orgId, $userId]
        );

        if ($membership && in_array($membership->role, ['owner', 'admin'], true)) {
            return $org;
        }

        // Platform/tenant admins can access any org dashboard. Uses the
        // volunteering module's full tenant-admin taxonomy (mirrors
        // VolunteerCheckInController / VolunteerEmergencyAlertService and the
        // canManageOpportunity() grant) — previously only super_admin/god were
        // recognised here, so admin/tenant_admin could decide applications but
        // not open the org dashboard.
        $user = $this->resolveUser();
        $role = $user->role ?? 'member';
        if (in_array($role, ['admin', 'tenant_admin', 'tenant_super_admin', 'super_admin', 'god'], true)
            || ($user->is_super_admin ?? false)
            || ($user->is_tenant_super_admin ?? false)) {
            return $org;
        }

        return null;
    }

    public function orgStats($id): JsonResponse
    {
        $this->ensureFeature();
        $this->rateLimit('vol_org_stats', 60, 60);
        $org = $this->ensureOrgAccess((int) $id);
        if (!$org) return $this->respondWithError('FORBIDDEN', __('api_controllers_2.volunteer.access_denied'), null, 403);

        $tenantId = TenantContext::getId();
        $orgId = (int) $org->id;

        $stats = DB::selectOne("
            SELECT
                (SELECT COUNT(DISTINCT va.user_id) FROM vol_applications va
                 JOIN vol_opportunities vo ON va.opportunity_id = vo.id
                 WHERE vo.organization_id = ? AND va.tenant_id = ? AND va.status = 'approved') as total_volunteers,
                (SELECT COUNT(*) FROM vol_applications va2
                 JOIN vol_opportunities vo2 ON va2.opportunity_id = vo2.id
                 WHERE vo2.organization_id = ? AND va2.tenant_id = ? AND va2.status = 'pending') as pending_applications,
                (SELECT COUNT(*) FROM vol_logs vl
                 WHERE vl.organization_id = ? AND vl.tenant_id = ? AND vl.status = 'pending') as pending_hours,
                (SELECT COALESCE(SUM(vl2.hours), 0) FROM vol_logs vl2
                 WHERE vl2.organization_id = ? AND vl2.tenant_id = ? AND vl2.status = 'approved') as total_approved_hours,
                (SELECT COUNT(*) FROM vol_opportunities vo3
                 WHERE vo3.organization_id = ? AND vo3.tenant_id = ? AND vo3.is_active = 1 AND vo3.status IN ('open', 'active')) as active_opportunities
        ", [$orgId, $tenantId, $orgId, $tenantId, $orgId, $tenantId, $orgId, $tenantId, $orgId, $tenantId]);

        return $this->respondWithData([
            'total_volunteers' => (int) $stats->total_volunteers,
            'pending_applications' => (int) $stats->pending_applications,
            'pending_hours' => (int) $stats->pending_hours,
            'total_approved_hours' => (float) $stats->total_approved_hours,
            'active_opportunities' => (int) $stats->active_opportunities,
            'wallet_balance' => (float) $org->balance,
            'auto_pay_enabled' => (bool) $org->auto_pay_enabled,
            'org_name' => $org->name,
        ]);
    }

    public function orgWalletBalance($id): JsonResponse
    {
        $this->ensureFeature();
        $this->rateLimit('vol_org_wallet', 60, 60);
        $org = $this->ensureOrgAccess((int) $id);
        if (!$org) return $this->respondWithError('FORBIDDEN', __('api_controllers_2.volunteer.access_denied'), null, 403);

        $summary = VolOrgWalletService::getWalletSummary((int) $id);
        return $this->respondWithData($summary);
    }

    public function orgWalletTransactions($id): JsonResponse
    {
        $this->ensureFeature();
        $this->rateLimit('vol_org_wallet_txns', 60, 60);
        $org = $this->ensureOrgAccess((int) $id);
        if (!$org) return $this->respondWithError('FORBIDDEN', __('api_controllers_2.volunteer.access_denied'), null, 403);

        $filters = [
            'limit' => $this->queryInt('per_page', 20, 1, 50),
            'cursor' => $this->query('cursor'),
            'type' => $this->query('type'),
        ];

        $result = VolOrgWalletService::getTransactions((int) $id, $filters);
        return $this->respondWithCollection($result['items'], $result['cursor'], $filters['limit'], $result['has_more']);
    }

    public function orgWalletDeposit($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('vol_org_wallet_deposit', 10, 60);
        $org = $this->ensureOrgAccess((int) $id);
        if (!$org) return $this->respondWithError('FORBIDDEN', __('api_controllers_2.volunteer.access_denied'), null, 403);

        // Hard-freeze: a suspended (non-approved) org cannot take on new value
        // movements — block deposits until it is active again.
        if (!VolunteerService::isApprovedOrganizationStatus($org->status ?? null)) {
            return $this->respondWithError('ORG_NOT_ACTIVE', __('api.volunteer_org_not_active'), null, 403);
        }

        $amount = (float) $this->input('amount', 0);
        $note = trim((string) $this->input('note', ''));

        if ($amount <= 0) {
            return $this->respondWithError('VALIDATION_ERROR', __('api_controllers_2.volunteer.amount_gt_zero'), 'amount', 400);
        }

        // Anti-double-submit: forward a client Idempotency-Key (header or body)
        // so a double-click or network retry collapses to ONE movement of
        // credits. Same contract as the personal wallet transfer.
        $idemKey = request()->header('Idempotency-Key');
        if (!is_string($idemKey) || $idemKey === '') {
            $idemKey = (string) $this->input('idempotency_key', '');
        }

        $result = VolOrgWalletService::depositFromUser($userId, (int) $id, $amount, $note ?: null, $idemKey !== '' ? $idemKey : null);
        if (!$result['success']) {
            return $this->respondWithError('VALIDATION_ERROR', $result['message'], null, 400);
        }

        return $this->respondWithData([
            'message' => $result['message'],
            'new_balance' => $result['new_balance'],
        ]);
    }

    public function orgVolunteers($id): JsonResponse
    {
        $this->ensureFeature();
        $this->rateLimit('vol_org_volunteers', 60, 60);
        $org = $this->ensureOrgAccess((int) $id);
        if (!$org) return $this->respondWithError('FORBIDDEN', __('api_controllers_2.volunteer.access_denied'), null, 403);

        $tenantId = TenantContext::getId();
        $orgId = (int) $id;
        $limit = $this->queryInt('per_page', 20, 1, 50);
        $cursor = $this->query('cursor');

        $params = [$orgId, $tenantId, $tenantId, $orgId, $tenantId];
        $cursorClause = '';
        if ($cursor) {
            $cursorClause = ' AND u.id < ?';
            $params[] = (int) $cursor;
        }
        $params[] = $limit + 1;

        // Hours come from a correlated subquery: joining vol_logs onto the
        // applications join fans out (N applications x M logs) and inflated
        // SUM(hours) by the application count.
        $rows = DB::select("
            SELECT u.id, u.name, u.avatar_url, u.email,
                   MAX(va.created_at) as applied_at,
                   COALESCE((SELECT SUM(vl.hours) FROM vol_logs vl
                             WHERE vl.user_id = u.id AND vl.organization_id = ?
                               AND vl.tenant_id = ? AND vl.status = 'approved'), 0) as total_hours,
                   COUNT(DISTINCT va.id) as applications_count
            FROM users u
            INNER JOIN vol_applications va ON va.user_id = u.id AND va.tenant_id = u.tenant_id AND va.status = 'approved' AND va.tenant_id = ?
            INNER JOIN vol_opportunities vo ON va.opportunity_id = vo.id AND vo.tenant_id = va.tenant_id AND vo.organization_id = ?
            WHERE u.tenant_id = ?
            {$cursorClause}
            GROUP BY u.id, u.name, u.avatar_url, u.email
            ORDER BY u.id DESC
            LIMIT ?
        ", $params);

        $hasMore = count($rows) > $limit;
        if ($hasMore) array_pop($rows);

        $items = array_map(fn ($r) => [
            'id' => (int) $r->id,
            'name' => $r->name,
            'avatar_url' => $r->avatar_url,
            'email' => $r->email,
            'total_hours' => (float) $r->total_hours,
            'applications_count' => (int) $r->applications_count,
            'applied_at' => $r->applied_at,
        ], $rows);

        $lastItem = end($items);
        $nextCursor = $lastItem ? (string) $lastItem['id'] : null;
        return $this->respondWithCollection($items, $hasMore ? $nextCursor : null, $limit, $hasMore);
    }

    public function orgApplications($id): JsonResponse
    {
        $this->ensureFeature();
        $this->rateLimit('vol_org_applications', 60, 60);
        $org = $this->ensureOrgAccess((int) $id);
        if (!$org) return $this->respondWithError('FORBIDDEN', __('api_controllers_2.volunteer.access_denied'), null, 403);

        $tenantId = TenantContext::getId();
        $orgId = (int) $id;
        $limit = $this->queryInt('per_page', 20, 1, 50);
        $cursor = $this->query('cursor');
        $statusFilter = $this->query('status');

        $params = [$orgId, $tenantId];
        $whereClauses = '';
        if ($statusFilter && in_array($statusFilter, ['pending', 'approved', 'declined'])) {
            $whereClauses .= ' AND va.status = ?';
            $params[] = $statusFilter;
        }
        if ($cursor) {
            $whereClauses .= ' AND va.id < ?';
            $params[] = (int) $cursor;
        }
        $params[] = $limit + 1;

        $rows = DB::select("
            SELECT va.id, va.status, va.message, va.org_note, va.created_at, va.shift_id,
                   u.id as user_id, u.name as user_name, u.avatar_url as user_avatar,
                   u.email as user_email,
                   vo.id as opportunity_id, vo.title as opportunity_title,
                   vs.start_time as shift_start, vs.end_time as shift_end
            FROM vol_applications va
            INNER JOIN vol_opportunities vo ON va.opportunity_id = vo.id AND vo.organization_id = ? AND vo.tenant_id = va.tenant_id
            INNER JOIN users u ON va.user_id = u.id AND u.tenant_id = va.tenant_id
            LEFT JOIN vol_shifts vs ON va.shift_id = vs.id AND vs.tenant_id = va.tenant_id
            WHERE va.tenant_id = ?
            {$whereClauses}
            ORDER BY va.id DESC
            LIMIT ?
        ", $params);

        $hasMore = count($rows) > $limit;
        if ($hasMore) array_pop($rows);

        $items = array_map(fn ($r) => [
            'id' => (int) $r->id,
            'status' => $r->status,
            'message' => $r->message,
            'org_note' => $r->org_note,
            'created_at' => $r->created_at,
            'user' => [
                'id' => (int) $r->user_id,
                'name' => $r->user_name,
                'avatar_url' => $r->user_avatar,
                'email' => $r->user_email,
            ],
            'opportunity' => [
                'id' => (int) $r->opportunity_id,
                'title' => $r->opportunity_title,
            ],
            'shift' => $r->shift_start ? [
                'start_time' => $r->shift_start,
                'end_time' => $r->shift_end,
            ] : null,
        ], $rows);

        $lastItem = end($items);
        $nextCursor = $lastItem ? (string) $lastItem['id'] : null;
        return $this->respondWithCollection($items, $hasMore ? $nextCursor : null, $limit, $hasMore);
    }

    public function orgHoursPending($id): JsonResponse
    {
        $this->ensureFeature();
        $this->rateLimit('vol_org_hours_pending', 60, 60);
        $org = $this->ensureOrgAccess((int) $id);
        if (!$org) return $this->respondWithError('FORBIDDEN', __('api_controllers_2.volunteer.access_denied'), null, 403);

        $tenantId = TenantContext::getId();
        $orgId = (int) $id;
        $limit = $this->queryInt('per_page', 20, 1, 50);
        $cursor = $this->query('cursor');

        $params = [$orgId, $tenantId];
        $cursorClause = '';
        if ($cursor) {
            $cursorClause = ' AND vl.id < ?';
            $params[] = (int) $cursor;
        }
        $params[] = $limit + 1;

        $rows = DB::select("
            SELECT vl.id, vl.hours, vl.date_logged as date, vl.description, vl.status, vl.created_at,
                   u.id as user_id, u.name as user_name, u.avatar_url as user_avatar,
                   vo.id as opportunity_id, vo.title as opportunity_title
            FROM vol_logs vl
            INNER JOIN users u ON vl.user_id = u.id AND u.tenant_id = vl.tenant_id
            LEFT JOIN vol_opportunities vo ON vl.opportunity_id = vo.id AND vo.tenant_id = vl.tenant_id
            WHERE vl.organization_id = ? AND vl.tenant_id = ? AND vl.status = 'pending'
            {$cursorClause}
            ORDER BY vl.id DESC
            LIMIT ?
        ", $params);

        $hasMore = count($rows) > $limit;
        if ($hasMore) array_pop($rows);

        $items = array_map(fn ($r) => [
            'id' => (int) $r->id,
            'hours' => (float) $r->hours,
            'date' => $r->date,
            'description' => $r->description,
            'status' => $r->status,
            'created_at' => $r->created_at,
            'user' => [
                'id' => (int) $r->user_id,
                'name' => $r->user_name,
                'avatar_url' => $r->user_avatar,
            ],
            'opportunity' => $r->opportunity_id ? [
                'id' => (int) $r->opportunity_id,
                'title' => $r->opportunity_title,
            ] : null,
        ], $rows);

        $lastItem = end($items);
        $nextCursor = $lastItem ? (string) $lastItem['id'] : null;
        return $this->respondWithCollection($items, $hasMore ? $nextCursor : null, $limit, $hasMore);
    }

    public function updateOrganisation(UpdateOrganisationRequest $request, $id): JsonResponse
    {
        $this->ensureFeature();
        $this->rateLimit('vol_org_update', 10, 60);
        $org = $this->ensureOrgAccess((int) $id);
        if (!$org) return $this->respondWithError('FORBIDDEN', __('api_controllers_2.volunteer.access_denied'), null, 403);

        $tenantId = TenantContext::getId();
        $updates = [];
        $params = [];

        $fields = ['name', 'description', 'contact_email', 'website'];
        foreach ($fields as $field) {
            $value = $this->input($field);
            if ($value !== null) {
                $updates[] = "{$field} = ?";
                $params[] = trim($value);
            }
        }

        if (empty($updates)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api_controllers_2.volunteer.no_fields_to_update'), null, 400);
        }

        $params[] = (int) $id;
        $params[] = $tenantId;
        DB::update("UPDATE vol_organizations SET " . implode(', ', $updates) . " WHERE id = ? AND tenant_id = ?", $params);
        app(\App\Services\PrerenderContentInvalidator::class)
            ->refreshVolunteerOrganisation((int) $tenantId, (int) $id);

        $updatedOrg = $this->volunteerService->getOrganizationById((int) $id, true);
        return $this->respondWithData($updatedOrg);
    }

    // ========================================
    // LEGACY V1 INDEX
    // ========================================

    public function index(): JsonResponse
    {
        $this->ensureFeature();
        $this->getUserId();
        $this->rateLimit('volunteering_legacy_list', 60, 60);

        $opportunities = VolOpportunity::where('tenant_id', TenantContext::getId())
            ->where('status', 'active')
            ->orderBy('created_at', 'desc')
            ->limit(50)
            ->get();
        return $this->respondWithCollection($opportunities->map(fn ($row) => $row->toArray())->all());
    }
}
