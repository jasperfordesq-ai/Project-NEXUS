<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Exceptions\SafeguardingPolicyException;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use App\Http\Requests\Volunteering\ReportIncidentRequest;
use App\Services\VolunteerWellbeingService;
use App\Services\VolunteerEmergencyAlertService;
use App\Services\SafeguardingService;
use App\Core\TenantContext;
use App\Support\Authorization\AdminTier;
use Carbon\Carbon;

/**
 * VolunteerWellbeingController -- Wellbeing dashboard, emergency alerts, safeguarding, training, and incidents.
 */
class VolunteerWellbeingController extends BaseApiController
{
    protected bool $isV2Api = true;

    /** Wellbeing alert lifecycle statuses (vol_wellbeing_alerts.status enum). */
    private const ALERT_STATUSES = ['active', 'acknowledged', 'resolved', 'dismissed'];

    public function __construct(
        private readonly VolunteerWellbeingService $volunteerWellbeingService,
        private readonly VolunteerEmergencyAlertService $volunteerEmergencyAlertService,
        private readonly SafeguardingService $safeguardingService,
    ) {}

    private function ensureFeature(): void
    {
        if (!TenantContext::hasFeature('volunteering')) {
            throw new \Illuminate\Http\Exceptions\HttpResponseException(
                $this->respondWithError('FEATURE_DISABLED', __('api.vol_feature_disabled'), null, 403)
            );
        }
    }

    /**
     * A community administrator, decided by AdminTier: the four boolean admin
     * flags as well as the role string, with brokers and coordinators refused.
     * Until 6 Oct 2026 this read only the role string, so an administrator
     * granted by flag (role 'member') passed the admin route middleware and
     * was then refused here.
     */
    private function isModuleAdmin(): bool
    {
        return AdminTier::allows(Auth::user());
    }

    /**
     * Require an authenticated user with a volunteering-module admin role.
     *
     * @return int The authenticated admin's user ID
     */
    private function requireModuleAdmin(): int
    {
        $userId = $this->getUserId();

        if (!$this->isModuleAdmin()) {
            throw new \Illuminate\Http\Exceptions\HttpResponseException(
                $this->respondWithError('FORBIDDEN', __('api.admin_access_required'), null, 403)
            );
        }

        return $userId;
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
    // WELLBEING / BURNOUT
    // ========================================

    public function wellbeingDashboard(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_wellbeing_dashboard', 30, 60);

        $tenantId = TenantContext::getId();

        // Burnout risk assessment
        $assessment = $this->volunteerWellbeingService->detectBurnoutRisk($userId);
        $score = max(0, min(100, 100 - (int) $assessment['risk_score']));

        // Hours this week
        try {
            $row = DB::selectOne(
                "SELECT COALESCE(SUM(hours), 0) as total FROM vol_logs WHERE user_id = ? AND tenant_id = ? AND status = 'approved' AND date_logged >= DATE_SUB(NOW(), INTERVAL 7 DAY)",
                [$userId, $tenantId]
            );
            $hoursThisWeek = round((float) $row->total, 1);
        } catch (\Throwable $e) {
            $hoursThisWeek = 0;
        }

        // Hours this month
        try {
            $row = DB::selectOne(
                "SELECT COALESCE(SUM(hours), 0) as total FROM vol_logs WHERE user_id = ? AND tenant_id = ? AND status = 'approved' AND date_logged >= DATE_SUB(NOW(), INTERVAL 30 DAY)",
                [$userId, $tenantId]
            );
            $hoursThisMonth = round((float) $row->total, 1);
        } catch (\Throwable $e) {
            $hoursThisMonth = 0;
        }

        // Streak: consecutive days with logged hours
        try {
            $dates = DB::select(
                "SELECT DISTINCT DATE(date_logged) as d FROM vol_logs WHERE user_id = ? AND tenant_id = ? AND status = 'approved' ORDER BY d DESC LIMIT 90",
                [$userId, $tenantId]
            );
            $streak = 0;
            $today = new \DateTime();
            foreach ($dates as $i => $dateRow) {
                $expected = (clone $today)->modify("-{$i} days")->format('Y-m-d');
                if ($dateRow->d === $expected) {
                    $streak++;
                } else {
                    break;
                }
            }
        } catch (\Throwable $e) {
            $streak = 0;
        }

        // Map risk level
        $burnoutRisk = match ($assessment['risk_level'] ?? 'low') {
            'critical', 'high' => 'high',
            'moderate' => 'moderate',
            default => 'low',
        };

        // Build warnings from indicators
        $warnings = [];
        $indicators = $assessment['indicators'] ?? [];
        if (($indicators['shift_frequency']['trend'] ?? '') === 'declining') {
            $warnings[] = __('api.vol_wellbeing_warning_frequency_declining');
        }
        if (($indicators['cancellation_rate']['rate_percent'] ?? 0) > 30) {
            $warnings[] = __('api.vol_wellbeing_warning_cancellation_rate');
        }
        if (($indicators['hours_trend']['trend'] ?? '') === 'declining_significantly') {
            $warnings[] = __('api.vol_wellbeing_warning_hours_declining');
        }
        if (($indicators['engagement_gap']['days_since_last_activity'] ?? 0) > 30) {
            $warnings[] = __('api.vol_wellbeing_warning_engagement_gap');
        }

        // Suggested rest days (next 7 days without scheduled shifts)
        $suggestedRest = [];
        try {
            $busyRows = DB::select(
                "SELECT DISTINCT DATE(s.start_time) as shift_date FROM vol_applications a JOIN vol_shifts s ON a.shift_id = s.id AND s.tenant_id = a.tenant_id WHERE a.user_id = ? AND a.tenant_id = ? AND a.status = 'approved' AND s.start_time >= NOW() AND s.start_time <= DATE_ADD(NOW(), INTERVAL 7 DAY)",
                [$userId, $tenantId]
            );
            $busyDays = array_map(fn($r) => $r->shift_date, $busyRows);
            for ($i = 0; $i < 7; $i++) {
                $day = Carbon::now()->addDays($i)->toDateString();
                if (!in_array($day, $busyDays)) {
                    $suggestedRest[] = $day;
                    if (count($suggestedRest) >= 3) break;
                }
            }
        } catch (\Throwable $e) { /* no suggestions */ }

        // Recent mood check-ins
        $recentCheckins = [];
        try {
            $rows = DB::select(
                "SELECT id, mood, note, created_at FROM vol_mood_checkins WHERE user_id = ? AND tenant_id = ? ORDER BY created_at DESC LIMIT 10",
                [$userId, $tenantId]
            );
            $recentCheckins = array_map(fn($row) => [
                'id' => (int) $row->id,
                'mood' => (int) $row->mood,
                'note' => $row->note,
                'created_at' => $row->created_at,
            ], $rows);
        } catch (\Throwable $e) { /* table may not exist yet */ }

        return $this->respondWithData([
            'score' => $score,
            'hours_this_week' => $hoursThisWeek,
            'hours_this_month' => $hoursThisMonth,
            'streak_days' => $streak,
            'burnout_risk' => $burnoutRisk,
            'warnings' => $warnings,
            'suggested_rest_days' => $suggestedRest,
            'recent_checkins' => $recentCheckins,
        ]);
    }

    public function wellbeingCheckin(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_wellbeing_checkin', 10, 60);

        $mood = (int) $this->input('mood');
        if ($mood < 1 || $mood > 5) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.vol_mood_range'), 'mood', 400);
        }

        $note = $this->input('note');
        if ($note) {
            $note = trim(mb_substr($note, 0, 500));
        }

        $tenantId = TenantContext::getId();

        try {
            DB::insert(
                "INSERT INTO vol_mood_checkins (tenant_id, user_id, mood, note, created_at) VALUES (?, ?, ?, ?, NOW())",
                [$tenantId, $userId, $mood, $note ?: null]
            );

            return $this->respondWithData([
                'id' => (int) DB::getPdo()->lastInsertId(),
                'mood' => $mood,
                'note' => $note ?: null,
            ]);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning("Wellbeing checkin failed: " . $e->getMessage());
            return $this->respondWithError('SERVER_ERROR', __('api.vol_checkin_save_failed'), null, 500);
        }
    }

    /**
     * GET /v2/admin/volunteering/wellbeing/alerts
     *
     * List wellbeing (burnout-risk) alerts for coordinators. Optional
     * ?status= filter (active|acknowledged|resolved|dismissed), default active.
     */
    public function adminWellbeingAlerts(): JsonResponse
    {
        $this->ensureFeature();
        $this->requireModuleAdmin();
        $this->rateLimit('vol_wellbeing_alerts_admin', 30, 60);

        $status = $this->query('status') ?: 'active';
        if (!in_array($status, self::ALERT_STATUSES, true)) {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                __('api.invalid_status_allowed', ['statuses' => implode(', ', self::ALERT_STATUSES)]),
                'status',
                422
            );
        }

        $alerts = $this->volunteerWellbeingService->getActiveAlerts($status);

        return $this->respondWithCollection($alerts, null, count($alerts), false);
    }

    /**
     * PUT /v2/admin/volunteering/wellbeing/alerts/{id}
     *
     * Update a wellbeing alert's lifecycle status
     * (acknowledged|resolved|dismissed) with an optional coordinator note.
     */
    public function updateWellbeingAlert($id): JsonResponse
    {
        $this->ensureFeature();
        $this->requireModuleAdmin();
        $this->rateLimit('vol_wellbeing_alert_update', 30, 60);

        $status = (string) $this->input('status', '');
        $allowed = ['acknowledged', 'resolved', 'dismissed'];
        if (!in_array($status, $allowed, true)) {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                __('api.invalid_status_allowed', ['statuses' => implode(', ', $allowed)]),
                'status',
                422
            );
        }

        $note = $this->input('note');
        if ($note !== null) {
            $note = trim((string) $note);
            if ($note === '') {
                $note = null;
            }
        }

        $success = $this->volunteerWellbeingService->updateAlert((int) $id, $status, $note);

        if (!$success) {
            $errors = $this->volunteerWellbeingService->getErrors();
            return $this->respondWithErrors($errors, $this->getErrorStatus($errors));
        }

        return $this->respondWithData(['id' => (int) $id, 'status' => $status]);
    }

    // ========================================
    // EMERGENCY ALERTS
    // ========================================

    public function myEmergencyAlerts(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_emergency_list', 60, 60);

        // getUserAlerts returns a {items, cursor, has_more} envelope — the
        // frontend expects data.alerts to be the plain array, not the envelope.
        $result = $this->volunteerEmergencyAlertService->getUserAlerts($userId);
        return $this->respondWithData([
            'alerts'   => $result['items'],
            'cursor'   => $result['cursor'],
            'has_more' => $result['has_more'],
        ]);
    }

    public function createEmergencyAlert(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_emergency_create', 5, 60);

        $data = [
            'shift_id' => $this->inputInt('shift_id'),
            'message' => trim($this->input('message', '')),
            'priority' => $this->input('priority', 'urgent'),
            'required_skills' => $this->input('required_skills'),
            'expires_hours' => $this->inputInt('expires_hours') ?: 24,
        ];

        try {
            $alertId = $this->volunteerEmergencyAlertService->createAlert($userId, $data);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        if ($alertId === null) {
            $errors = $this->volunteerEmergencyAlertService->getErrors();
            return $this->respondWithErrors($errors, $this->getErrorStatus($errors));
        }

        // How many volunteers were asked, so the organiser knows whether anyone was reached.
        $notified = (int) \App\Models\VolEmergencyAlertRecipient::query()
            ->where('tenant_id', TenantContext::getId())
            ->where('alert_id', $alertId)
            ->count();

        return $this->respondWithData([
            'id' => $alertId,
            'notified' => $notified,
            'message' => __('api_controllers_2.volunteer_wellbeing.emergency_alert_sent'),
        ], null, 201);
    }

    /**
     * GET /v2/volunteering/opportunities/{id}/emergency-alerts - the urgent
     * requests for this opportunity's shifts, for the people who may manage it.
     */
    public function opportunityEmergencyAlerts($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_emergency_opportunity_list', 60, 60);

        $opportunityId = (int) $id;
        $exists = \Illuminate\Support\Facades\DB::table('vol_opportunities')
            ->where('id', $opportunityId)
            ->where('tenant_id', TenantContext::getId())
            ->exists();
        if (!$exists) {
            return $this->respondWithError('NOT_FOUND', __('api.opportunity_not_found'), null, 404);
        }
        if (!\App\Services\VolunteerService::userCanManageOpportunityById($opportunityId, $userId)) {
            return $this->respondWithError('FORBIDDEN', __('api.forbidden'), null, 403);
        }

        return $this->respondWithData([
            'alerts' => $this->volunteerEmergencyAlertService->getOpportunityAlerts($opportunityId),
        ]);
    }

    public function respondToEmergencyAlert($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_emergency_respond', 10, 60);

        $response = $this->input('response');
        if (!$response || !in_array($response, ['accepted', 'declined'])) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.vol_response_accept_decline'), 'response', 400);
        }

        try {
            $success = $this->volunteerEmergencyAlertService->respond((int) $id, $userId, $response);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        if (!$success) {
            $errors = $this->volunteerEmergencyAlertService->getErrors();
            return $this->respondWithErrors($errors, $this->getErrorStatus($errors));
        }

        return $this->respondWithData(['id' => (int) $id, 'response' => $response]);
    }

    public function cancelEmergencyAlert($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('volunteering_emergency_cancel', 10, 60);

        $tenantId = TenantContext::getId();
        $success = $this->volunteerEmergencyAlertService->cancelAlert((int) $id, $userId, $tenantId);

        if (!$success) {
            $errors = $this->volunteerEmergencyAlertService->getCancelErrors();
            return $this->respondWithErrors($errors, $this->getErrorStatus($errors));
        }

        return $this->noContent();
    }

    // ========================================
    // INCIDENTS
    // ========================================

    public function reportIncident(ReportIncidentRequest $request): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('vol_incident_report', 5, 60);

        $data = $this->getAllInput();

        try {
            $tenantId = TenantContext::getId();
            $result = $this->safeguardingService->reportIncident($userId, $data, $tenantId);
            if ($result === false) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.validation_failed'), null, 422);
            }

            return $this->respondWithData($result, null, 201);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        }
    }

    /**
     * What a member may tie an incident report to: this community's active
     * organisations and their opportunities. Names only — the form needs
     * nothing else.
     */
    public function incidentReportOptions(): JsonResponse
    {
        $this->ensureFeature();
        $this->getUserId();
        $this->rateLimit('vol_incident_report_options', 30, 60);

        return $this->respondWithData(
            $this->safeguardingService->getIncidentReportOptions(TenantContext::getId())
        );
    }

    /**
     * GET /v2/volunteering/incidents � the reports the caller made. Staff see
     * every incident through the admin list; here everyone sees only their own.
     */
    public function getIncidents(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('vol_incidents_list', 30, 60);

        return $this->respondWithData(
            $this->safeguardingService->getIncidentsByReporter($userId, TenantContext::getId())
        );
    }

    public function adminIncidents(): JsonResponse
    {
        $this->ensureFeature();
        // F-536: brokers and coordinators handle volunteering incidents too.
        $this->requireBrokerOrAdmin();

        $tenantId = TenantContext::getId();
        $status = $this->query('status');
        // An unknown status would silently match nothing, which reads as "no
        // incidents". Ignore it instead, so the full list shows.
        if (!in_array($status, ['open', 'investigating', 'resolved', 'escalated', 'closed'], true)) {
            $status = null;
        }
        $page = $this->queryInt('page', 1, 1, 1000);
        $perPage = $this->queryInt('per_page', 20, 1, 50);
        $search = $this->query('search');
        $search = is_string($search) ? mb_substr(trim($search), 0, 100) : null;
        $unassignedOnly = $this->query('handler') === 'none';

        // F-507: an administrator never sees an incident about themselves.
        $result = $this->safeguardingService->getIncidents($tenantId, $status, $page, $perPage, $this->getUserId(), $search, $unassignedOnly);
        $incidents = $result['items'] ?? [];

        return $this->respondWithData([
            'incidents' => $incidents,
            'items' => $incidents,
            'stats' => $this->safeguardingService->getIncidentStats($tenantId),
            'dlp_assignments' => $this->safeguardingService->getDlpAssignments($tenantId),
            'handlers' => $this->safeguardingService->getIncidentHandlers($tenantId),
            'total' => $result['total'] ?? 0,
            'page' => $result['page'] ?? $page,
            'per_page' => $result['per_page'] ?? $perPage,
        ]);
    }

    public function updateIncident($id): JsonResponse
    {
        $this->ensureFeature();
        // F-536: brokers and coordinators handle volunteering incidents too.
        // F-507 (no one handles an incident about themselves) is enforced in
        // SafeguardingService::updateIncident for every caller.
        $adminId = $this->requireBrokerOrAdmin();

        $data = $this->getAllInput();
        $tenantId = TenantContext::getId();
        $result = $this->safeguardingService->updateIncident((int) $id, $data, $adminId, $tenantId);

        if ($result->notFound) {
            return $this->respondWithError('NOT_FOUND', __('api.vol_incident_not_found'), null, 404);
        }
        if (!$result->ok) {
            // Say which field was refused, so the screen can show it beside that field.
            $message = $result->errorField === 'reason'
                ? __('api.vol_incident_reason_required')
                : __('api.vol_incident_invalid_field');
            return $this->respondWithError('VALIDATION_ERROR', $message, $result->errorField, 422);
        }
        return $this->respondWithData(['success' => true]);
    }

    public function assignDlp($id): JsonResponse
    {
        $this->ensureFeature();
        $adminId = $this->requireAdmin();

        $data = $this->getAllInput();

        $dlpUserId = (int) ($data['dlp_user_id'] ?? 0);
        if ($dlpUserId <= 0) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.vol_dlp_user_required'), 'dlp_user_id', 422);
        }

        $tenantId = TenantContext::getId();
        $refusal = $this->safeguardingService->tryAssignOrganizationDlp(
            (int) $id,
            $dlpUserId,
            $adminId,
            $tenantId
        );

        if ($refusal === 'organization_not_found') {
            return $this->respondWithError('NOT_FOUND', __('api.vol_dlp_organization_not_found'), null, 404);
        }

        if ($refusal !== null) {
            // Say which rule the chosen person broke, so the admin knows what to
            // fix rather than just "failed". Any active member may be the
            // organisation's DLP; no staff role is required.
            $message = match ($refusal) {
                'user_not_found' => __('api.vol_dlp_user_not_found'),
                'user_inactive' => __('api.vol_dlp_user_inactive'),
                default => __('api.vol_dlp_assign_failed'),
            };
            $field = $refusal === 'error' ? null : 'dlp_user_id';

            return $this->respondWithError('VALIDATION_ERROR', $message, $field, 422);
        }

        return $this->respondWithData(['success' => true]);
    }

    // ========================================
    // TRAINING
    // ========================================

    public function myTraining(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('vol_training_list', 30, 60);

        $tenantId = TenantContext::getId();
        $training = $this->safeguardingService->getTrainingForUser($userId, $tenantId);
        return $this->respondWithData($training);
    }

    public function recordTraining(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('vol_training_record', 10, 60);

        $data = $this->getAllInput();

        try {
            $tenantId = TenantContext::getId();
            $result = $this->safeguardingService->recordTraining($userId, $data, $tenantId);
            return $this->respondWithData($result, null, 201);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        }
    }

    public function adminTraining(): JsonResponse
    {
        $this->ensureFeature();
        $this->requireAdmin();

        $tenantId = TenantContext::getId();
        $page = $this->queryInt('page', 1, 1, 1000);
        $perPage = $this->queryInt('per_page', 20, 1, 50);

        $result = $this->safeguardingService->getTrainingForAdmin($tenantId, $page, $perPage);
        return $this->respondWithData($result);
    }

    public function verifyTraining($id): JsonResponse
    {
        $this->ensureFeature();
        $adminId = $this->requireAdmin();

        $tenantId = TenantContext::getId();
        $result = $this->safeguardingService->verifyTraining((int) $id, $adminId, $tenantId);
        if (!$result) {
            return $this->respondWithError('NOT_FOUND', __('api.vol_training_not_found'), null, 404);
        }
        return $this->respondWithData(['success' => true]);
    }

    public function rejectTraining($id): JsonResponse
    {
        $this->ensureFeature();
        $adminId = $this->requireAdmin();

        $reason = trim($this->input('reason', ''));
        if (empty($reason)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.vol_training_reject_reason'), 'reason', 422);
        }

        $tenantId = TenantContext::getId();
        $result = $this->safeguardingService->rejectTraining((int) $id, $adminId, $reason, $tenantId);
        if (!$result) {
            return $this->respondWithError('NOT_FOUND', __('api.vol_training_not_found'), null, 404);
        }
        return $this->respondWithData(['success' => true]);
    }
}
