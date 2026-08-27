<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\I18n\LocaleContext;
use App\Models\ActivityLog;
use App\Models\User;
use App\Services\CaringCommunity\CaringCommunityAlertService;
use App\Services\CaringCommunity\CaringCommunityForecastService;
use App\Services\CaringCommunity\CaringHourTransferService;
use App\Services\CaringCommunity\CaringNudgeService;
use App\Services\CaringCommunity\CaringRegionalPointService;
use App\Services\CaringCommunity\KpiBaselineService;
use App\Services\CaringCommunity\OperatingPolicyService;
use App\Services\CaringCommunity\PaperOnboardingIntakeService;
use App\Services\CaringCommunity\PilotDisclosurePackService;
use App\Services\CaringCommunity\PilotLaunchReadinessService;
use App\Services\CaringCommunity\PilotScoreboardService;
use App\Services\CaringCommunity\SafeguardingService;
use App\Services\CaringCommunity\VereinMemberImportService;
use App\Services\CaringCommunityMemberStatementService;
use App\Services\EmailDispatchService;
use App\Services\CaringCommunityRolePresetService;
use App\Services\CaringCommunityWorkflowPolicyService;
use App\Services\CaringCommunityWorkflowService;
use App\Services\CaringInviteCodeService;
use App\Services\CaringLoyaltyService;
use App\Services\CaringSupportRelationshipService;
use App\Services\CaringTandemMatchingService;
use App\Support\CsvExportSanitizer;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Symfony\Component\HttpFoundation\StreamedResponse;
use App\Support\UserDisplayName;

class AdminCaringCommunityController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly CaringCommunityWorkflowService $workflowService,
        private readonly CaringCommunityRolePresetService $rolePresetService,
        private readonly CaringCommunityWorkflowPolicyService $policyService,
        private readonly CaringCommunityMemberStatementService $memberStatementService,
        private readonly CaringSupportRelationshipService $supportRelationshipService,
        private readonly CaringInviteCodeService $inviteCodeService,
        private readonly CaringTandemMatchingService $tandemMatchingService,
        private readonly CaringLoyaltyService $loyaltyService,
        private readonly CaringCommunityForecastService $forecastService,
        private readonly CaringCommunityAlertService $alertService,
        private readonly CaringHourTransferService $hourTransferService,
        private readonly SafeguardingService $safeguardingService,
        private readonly CaringRegionalPointService $regionalPointService,
        private readonly VereinMemberImportService $vereinMemberImportService,
        private readonly CaringNudgeService $nudgeService,
        private readonly KpiBaselineService $kpiBaselineService,
        private readonly PaperOnboardingIntakeService $paperOnboardingIntakeService,
        private readonly PilotScoreboardService $pilotScoreboardService,
        private readonly OperatingPolicyService $operatingPolicyService,
        private readonly PilotDisclosurePackService $disclosurePackService,
        private readonly PilotLaunchReadinessService $pilotLaunchReadinessService,
    ) {
    }

    // -------------------------------------------------------------------------
    // Safeguarding Reports
    // -------------------------------------------------------------------------

    /**
     * GET /api/v2/admin/caring-community/safeguarding/reports?status=&severity=
     */
    public function safeguardingList(): JsonResponse
    {
        $disabled = $this->guardSafeguarding('view');
        if ($disabled) return $disabled;

        $status = (string) ($this->query('status') ?? '');
        $severity = (string) ($this->query('severity') ?? '');

        return $this->respondWithData([
            'items' => $this->safeguardingService->listReports(
                $status !== '' ? $status : null,
                $severity !== '' ? $severity : null,
            ),
        ]);
    }

    /**
     * GET /api/v2/admin/caring-community/safeguarding/reports/{id}
     */
    public function safeguardingShow(int $id): JsonResponse
    {
        $disabled = $this->guardSafeguarding('view');
        if ($disabled) return $disabled;

        $detail = $this->safeguardingService->reportDetail($id);
        if ($detail === null) {
            return $this->respondWithError('NOT_FOUND', __('api.not_found'), null, 404);
        }

        return $this->respondWithData($detail);
    }

    /**
     * POST /api/v2/admin/caring-community/safeguarding/reports/{id}/assign
     * Body: { assignee_user_id }
     */
    public function safeguardingAssign(int $id): JsonResponse
    {
        $disabled = $this->guardSafeguarding('manage');
        if ($disabled) return $disabled;

        $actorId = (int) auth()->id();
        $assigneeId = $this->inputInt('assignee_user_id', null, 1);
        if ($assigneeId === null) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.field_required'), 'assignee_user_id', 422);
        }

        try {
            $this->safeguardingService->assignReport($id, $assigneeId, $actorId);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('NOT_FOUND', $e->getMessage(), null, 404);
        }

        return $this->respondWithData(['success' => true]);
    }

    /**
     * POST /api/v2/admin/caring-community/safeguarding/reports/{id}/escalate
     * Body: { note? }
     */
    public function safeguardingEscalate(int $id): JsonResponse
    {
        $disabled = $this->guardSafeguarding('manage');
        if ($disabled) return $disabled;

        $actorId = (int) auth()->id();
        $note = trim((string) ($this->getAllInput()['note'] ?? ''));

        try {
            $this->safeguardingService->escalateReport($id, $actorId, $note !== '' ? $note : null);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('NOT_FOUND', $e->getMessage(), null, 404);
        }

        return $this->respondWithData(['success' => true]);
    }

    /**
     * POST /api/v2/admin/caring-community/safeguarding/reports/{id}/status
     * Body: { status, notes? }
     */
    public function safeguardingStatus(int $id): JsonResponse
    {
        $disabled = $this->guardSafeguarding('manage');
        if ($disabled) return $disabled;

        $actorId = (int) auth()->id();
        $input = $this->getAllInput();
        $status = (string) ($input['status'] ?? '');
        $notes = trim((string) ($input['notes'] ?? ''));

        try {
            $this->safeguardingService->changeStatus($id, $status, $actorId, $notes !== '' ? $notes : null);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('NOT_FOUND', $e->getMessage(), null, 404);
        }

        return $this->respondWithData(['success' => true]);
    }

    /**
     * POST /api/v2/admin/caring-community/safeguarding/reports/{id}/note
     * Body: { note }
     */
    public function safeguardingNote(int $id): JsonResponse
    {
        $disabled = $this->guardSafeguarding('manage');
        if ($disabled) return $disabled;

        $actorId = (int) auth()->id();
        $note = trim((string) ($this->getAllInput()['note'] ?? ''));

        try {
            $this->safeguardingService->addNote($id, $actorId, $note);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('NOT_FOUND', $e->getMessage(), null, 404);
        }

        return $this->respondWithData(['success' => true]);
    }

    /**
     * GET /api/v2/admin/caring-community/safeguarding/dashboard
     */
    public function safeguardingDashboard(): JsonResponse
    {
        $disabled = $this->guardSafeguarding('view');
        if ($disabled) return $disabled;

        return $this->respondWithData($this->safeguardingService->dashboardSummary());
    }

    /**
     * Combined feature + permission guard for safeguarding endpoints.
     *
     * @param string $level 'view' or 'manage'
     */
    private function guardSafeguarding(string $level): ?JsonResponse
    {
        $disabled = $this->guardCaringCommunityFeature();
        if ($disabled) return $disabled;

        // Coordinators / admins / super-admins always pass. Otherwise check
        // whether the user holds the required safeguarding permission.
        $userId = $this->requireAuth();
        $tenantId = TenantContext::getId();
        $user = \DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->first(['role', 'is_super_admin', 'is_tenant_super_admin']);
        $role = $user ? (string) ($user->role ?? 'member') : 'member';

        if (in_array($role, ['admin', 'tenant_admin', 'super_admin', 'god'], true)) {
            return null;
        }
        if ($user && (($user->is_super_admin ?? false) || ($user->is_tenant_super_admin ?? false))) {
            return null;
        }
        if ($level === 'view' && in_array($role, ['coordinator', 'broker'], true)) {
            return null;
        }

        // Check permission tables — schema may vary, do this defensively
        try {
            $allowedPermissions = $level === 'manage'
                ? ['safeguarding.manage']
                : ['safeguarding.view', 'safeguarding.manage'];

            $query = \DB::table('user_permissions as up')
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
                    $q->whereNull('up.expires_at')->orWhere('up.expires_at', '>', now());
                });
            }
            if (Schema::hasColumn('permissions', 'tenant_id')) {
                $query->where(function ($q) use ($tenantId) {
                    $q->whereNull('p.tenant_id')->orWhere('p.tenant_id', $tenantId);
                });
            }

            $hasPerm = $query->exists();
            if ($hasPerm) {
                return null;
            }
        } catch (\Throwable $e) {
            // If permission tables aren't shaped as expected, fall through to deny.
        }

        return $this->respondWithError('AUTH_INSUFFICIENT_PERMISSIONS', __('api.safeguarding_staff_access_required'), null, 403);
    }

    /**
     * GET /api/v2/admin/caring-community/hour-transfer/pending
     *
     * Pending outbound transfers — initiated by members of THIS tenant
     * awaiting admin approval before funds are debited.
     */
    public function hourTransferPending(): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        return $this->respondWithData([
            'items' => $this->hourTransferService->pendingAtSource(),
        ]);
    }

    /**
     * POST /api/v2/admin/caring-community/hour-transfer/{id}/approve
     */
    public function hourTransferApprove(int $id): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        $approverId = $this->requireAdmin();

        try {
            $result = $this->hourTransferService->approveAtSource($id, $approverId);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('TRANSFER_FAILED', $e->getMessage(), null, 422);
        }

        return $this->respondWithData($result + ['success' => true]);
    }

    /**
     * POST /api/v2/admin/caring-community/hour-transfer/{id}/reject
     * Body: { reason? }
     */
    public function hourTransferReject(int $id): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        $approverId = $this->requireAdmin();
        $reason = trim((string) ($this->getAllInput()['reason'] ?? ''));

        try {
            $this->hourTransferService->rejectAtSource($id, $approverId, $reason);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('TRANSFER_FAILED', $e->getMessage(), null, 422);
        }

        return $this->respondWithData(['success' => true, 'status' => 'rejected']);
    }

    /**
     * GET /api/v2/admin/caring-community/hour-transfer/inbound
     *
     * Recent inbound transfers — received from other cooperatives in the last 90 days.
     */
    public function hourTransferInbound(): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        return $this->respondWithData([
            'items' => $this->hourTransferService->recentAtDestination(),
        ]);
    }

    /**
     * GET /api/v2/admin/caring-community/forecast
     *
     * Forward-looking coordinator dashboard — Tom Debus's AI/Daten pillar.
     * Linear regression on the past 6 months projects the next 3 months
     * of approved hours, distinct active members, and recipients reached.
     * Proactive alerts surface signals the coordinator should act on now.
     */
    public function forecast(): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        return $this->respondWithData([
            'hours'                => $this->forecastService->forecastHours(3),
            'members'              => $this->forecastService->forecastMembers(3),
            'recipients'           => $this->forecastService->forecastRecipients(3),
            'sub_region_demand'    => $this->forecastService->subRegionDemand(),
            'helper_churn'         => $this->forecastService->helperChurn(),
            'coefficient_drift'    => $this->forecastService->categoryCoefficientDrift(),
            'alerts'               => $this->alertService->activeAlerts(),
            'generated_at'         => now()->toIso8601String(),
        ]);
    }

    public function workflow(): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        return $this->respondWithData($this->workflowService->summary(TenantContext::getId()));
    }

    public function rolePresets(): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        return $this->respondWithData($this->rolePresetService->status(TenantContext::getId()));
    }

    public function installRolePresets(): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        $preset = request()->input('preset');
        $presetKey = is_string($preset) && $preset !== '' ? $preset : null;

        return $this->respondWithData($this->rolePresetService->install(TenantContext::getId(), $presetKey));
    }

    public function updatePolicy(): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        return $this->respondWithData($this->policyService->update(TenantContext::getId(), $this->getAllInput()));
    }

    public function assignReview(int $id): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        $assigneeId = $this->inputInt('assigned_to', null, 1);
        $review = $this->workflowService->assignReview(TenantContext::getId(), $id, $assigneeId);
        if (!$review) {
            return $this->respondWithError('NOT_FOUND', __('api.caring_review_assignment_failed'), null, 404);
        }

        return $this->respondWithData([
            'review' => $review,
            'message' => __('api.caring_review_assigned'),
        ]);
    }

    public function escalateReview(int $id): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        $review = $this->workflowService->escalateReview(TenantContext::getId(), $id, (string) request()->input('note', ''));
        if (!$review) {
            return $this->respondWithError('NOT_FOUND', __('api.caring_review_escalation_failed'), null, 404);
        }

        return $this->respondWithData([
            'review' => $review,
            'message' => __('api.caring_review_escalated'),
        ]);
    }

    public function decideReview(int $id): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        $action = (string) request()->input('action', '');
        if (!in_array($action, ['approve', 'decline'], true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.decision_required'), 'action', 400);
        }

        $result = $this->workflowService->decideReview(TenantContext::getId(), $id, (int) auth()->id(), $action);
        if (!$result) {
            return $this->respondWithError('NOT_FOUND', __('api.caring_review_decision_failed'), null, 404);
        }

        return $this->respondWithData([
            'review' => $result,
            'message' => $action === 'approve' ? __('api.caring_review_approved') : __('api.caring_review_declined'),
        ]);
    }

    public function memberStatement(int $userId): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        $filters = [
            'start_date' => $this->query('start_date'),
            'end_date' => $this->query('end_date'),
        ];
        $format = (string) $this->query('format', 'json');

        if ($format === 'csv') {
            $csv = $this->memberStatementService->csv(TenantContext::getId(), $userId, $filters);
            if (!$csv) {
                return $this->respondWithError('NOT_FOUND', __('api.user_not_found'), null, 404);
            }

            return $this->respondWithData($csv);
        }

        $statement = $this->memberStatementService->statement(TenantContext::getId(), $userId, $filters);
        if (!$statement) {
            return $this->respondWithError('NOT_FOUND', __('api.user_not_found'), null, 404);
        }

        return $this->respondWithData($statement);
    }

    public function supportRelationships(): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        return $this->respondWithData($this->supportRelationshipService->list(TenantContext::getId(), [
            'status' => $this->query('status', 'active'),
        ]));
    }

    public function createSupportRelationship(): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        $tenantId = TenantContext::getId();
        $coordinatorId = (int) auth()->id();
        $input = $this->getAllInput();
        try {
            $result = $this->supportRelationshipService->create($tenantId, $input, $coordinatorId);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }
        if (($result['success'] ?? false) !== true) {
            $code = (string) ($result['code'] ?? 'VALIDATION_ERROR');
            $message = $code === 'USER_NOT_FOUND'
                ? __('api.user_not_found')
                : __('api.caring_support_relationship_create_failed');
            return $this->respondWithError($code, $message, null, 422);
        }

        // Log so we don't keep re-suggesting this pair to coordinators.
        $supporterId = (int) ($input['supporter_id'] ?? 0);
        $recipientId = (int) ($input['recipient_id'] ?? 0);
        if ($supporterId > 0 && $recipientId > 0) {
            $this->tandemMatchingService->markSuggestionAsConsidered(
                $tenantId,
                $supporterId,
                $recipientId,
                'created_relationship',
                $coordinatorId,
            );
        }

        return $this->respondWithData($result['relationship'], null, 201);
    }

    /**
     * GET /api/v2/admin/caring-community/tandem-suggestions
     *
     * Returns coordinator-ready supporter/recipient pair suggestions.
     */
    public function tandemSuggestions(): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        $limit = $this->queryInt('limit', 20, 1, 100);
        $suggestions = $this->tandemMatchingService->suggestTandems(TenantContext::getId(), $limit);

        return $this->respondWithData([
            'suggestions' => $suggestions,
            'generated_at' => now()->toIso8601String(),
        ]);
    }

    /**
     * POST /api/v2/admin/caring-community/tandem-suggestions/dismiss
     *
     * Suppress a suggested pair for 90 days so it stops appearing in the list.
     */
    public function dismissTandemSuggestion(): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        $supporterId = $this->inputInt('supporter_id', null, 1);
        $recipientId = $this->inputInt('recipient_id', null, 1);
        if ($supporterId === null || $recipientId === null || $supporterId === $recipientId) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.validation_failed'), null, 422);
        }

        $this->tandemMatchingService->markSuggestionAsConsidered(
            TenantContext::getId(),
            $supporterId,
            $recipientId,
            'dismissed',
            (int) auth()->id(),
        );

        return $this->respondWithData(['success' => true]);
    }

    public function nudgeAnalytics(): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        return $this->respondWithData($this->nudgeService->analytics(TenantContext::getId()));
    }

    public function updateNudgeConfig(): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        return $this->respondWithData([
            'config' => $this->nudgeService->updateConfig(TenantContext::getId(), $this->getAllInput()),
        ]);
    }

    public function dispatchNudges(): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        $dryRun = filter_var($this->getAllInput()['dry_run'] ?? false, FILTER_VALIDATE_BOOLEAN);
        $limit = $this->inputInt('limit', null, 1, 250);

        return $this->respondWithData(
            $this->nudgeService->dispatchDue(TenantContext::getId(), $limit, $dryRun),
            null,
            $dryRun ? 200 : 201,
        );
    }

    public function updateSupportRelationship(int $id): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        $relationship = $this->supportRelationshipService->update(TenantContext::getId(), $id, $this->getAllInput());
        if (!$relationship) {
            return $this->respondWithError('NOT_FOUND', __('api.caring_support_relationship_not_found'), null, 404);
        }

        return $this->respondWithData($relationship);
    }

    public function logSupportRelationshipHours(int $id): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        $result = $this->supportRelationshipService->logHours(TenantContext::getId(), $id, $this->getAllInput(), (int) auth()->id());
        if (($result['success'] ?? false) !== true) {
            $code = (string) ($result['code'] ?? 'VALIDATION_ERROR');
            $message = match ($code) {
                'NOT_FOUND' => __('api.caring_support_relationship_not_found'),
                'RELATIONSHIP_INACTIVE' => __('api.caring_support_relationship_inactive'),
                'ALREADY_EXISTS' => __('api.caring_support_relationship_log_duplicate'),
                default => __('api.caring_support_relationship_log_failed'),
            };

            return $this->respondWithError($code, $message, null, $code === 'NOT_FOUND' ? 404 : 422);
        }

        return $this->respondWithData($result, null, 201);
    }

    /**
     * POST /api/v2/admin/caring-community/assisted-onboarding
     *
     * Coordinator creates a member account on behalf of a participant who
     * cannot self-register (e.g. elderly, non-technical). Returns a temporary
     * password the coordinator can share with the new member in person.
     */
    public function assistedOnboarding(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $guard = $this->guardCaringCommunity();
        if ($guard !== null) return $guard;

        $tenantId = TenantContext::getId();
        $input = $this->getAllInput();

        $fullName = trim((string) ($input['name'] ?? ''));
        $email = strtolower(trim((string) ($input['email'] ?? '')));
        $phone = trim((string) ($input['phone'] ?? ''));
        $note = trim((string) ($input['note'] ?? ''));

        // Validate
        $errors = [];
        if ($fullName === '') {
            $errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.first_name_required'), 'field' => 'name'];
        }
        if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $errors[] = ['code' => 'VALIDATION_ERROR', 'message' => __('api.valid_email_required'), 'field' => 'email'];
        }
        if (!empty($errors)) {
            return $this->respondWithErrors($errors, 422);
        }

        // Duplicate email check scoped to this tenant. The platform is
        // multi-tenant, so the same email can legitimately belong elsewhere.
        if (User::query()->where('tenant_id', $tenantId)->where('email', $email)->exists()) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.email_already_exists'), 'email', 422);
        }

        // Split name into first / last
        $parts = explode(' ', $fullName, 2);
        $firstName = $parts[0];
        $lastName = $parts[1] ?? '';

        // Generate a secure temporary password
        $tempPassword = substr(bin2hex(random_bytes(12)), 0, 16);

        $newUserId = User::createWithTenant([
            'first_name'  => $firstName,
            'last_name'   => $lastName,
            'email'       => $email,
            'password'    => $tempPassword,
            'phone'       => $phone ?: null,
            'role'        => 'member',
            'is_approved' => 1,
        ], $tenantId);

        if (!$newUserId) {
            return $this->respondWithError('SERVER_ERROR', __('api.user_created_failed'), null, 500);
        }

        ActivityLog::log($adminId, 'coordinator_assisted_onboarding', "Coordinator-assisted onboarding: {$email}" . ($note ? " — {$note}" : ''));

        // Send welcome email if the email looks real (skip dummy placeholder addresses)
        $isDummy = str_ends_with($email, '.invalid') || str_ends_with($email, '.placeholder');
        $emailSent = false;
        $emailSkipped = $isDummy;
        if (!$isDummy) {
            try {
                $newUser = User::findById($newUserId, true);
                $emailSent = TenantContext::runForTenant($tenantId, function () use ($newUser, $email, $tempPassword, $tenantId): bool {
                    return (bool) LocaleContext::withLocale($newUser['preferred_language'] ?? null, function () use ($email, $tempPassword, $tenantId) {
                        $tenant = TenantContext::get();
                        $tenantName = $tenant['name'] ?? 'Project NEXUS';
                        $loginLink = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . '/login';

                        $html = EmailTemplateBuilder::make()
                            ->title(__('emails_misc.admin_actions.welcome_created_title'))
                            ->previewText(__('emails_misc.admin_actions.welcome_created_preview'))
                            ->greeting(__('emails_misc.admin_actions.welcome_created_greeting', ['community' => $tenantName]))
                            ->paragraph(__('emails_misc.admin_actions.welcome_created_body_intro', ['community' => $tenantName]))
                            ->paragraph(__('emails_misc.admin_actions.welcome_created_body_credentials'))
                            // infoCard escapes at render — no pre-escaping.
                            ->infoCard([
                                __('emails_misc.admin_actions.welcome_created_info_email')    => $email,
                                __('emails_misc.admin_actions.welcome_created_info_password') => $tempPassword,
                            ])
                            ->paragraph(__('emails_misc.admin_actions.welcome_created_body_change_pass'))
                            ->button(__('emails_misc.admin_actions.welcome_created_cta'), $loginLink)
                            ->render();

                        $sent = EmailDispatchService::sendRaw($email, __('emails_misc.admin_actions.welcome_created_subject', ['community' => $tenantName]), $html, null, null, null, 'admin_welcome', ['tenant_id' => $tenantId]);
                        if (!$sent) {
                            return false;
                        }

                        return true;
                    });
                });
                if (!$emailSent) {
                    Log::warning('[AdminCC] Assisted onboarding welcome email returned false', [
                        'email' => $email,
                    ]);
                }
            } catch (\Throwable $e) {
                Log::warning('[AdminCC] Assisted onboarding welcome email failed: ' . $e->getMessage());
            }
        }

        return $this->respondWithData([
            'success'       => true,
            'user'          => [
                'id'    => $newUserId,
                'name'  => trim("{$firstName} {$lastName}"),
                'email' => $email,
            ],
            'temp_password' => $tempPassword,
            'email_sent' => $emailSent,
            'email_skipped' => $emailSkipped,
        ], null, 201);
    }

    /**
     * GET /api/v2/admin/caring-community/paper-onboarding
     */
    public function paperOnboardingList(): JsonResponse
    {
        $this->requireAdmin();
        $guard = $this->guardCaringCommunity();
        if ($guard !== null) return $guard;

        $status = trim((string) request()->query('status', 'pending_review'));
        $limit = max(1, min(100, (int) request()->query('limit', 20)));

        return $this->respondWithData(
            $this->paperOnboardingIntakeService->list(TenantContext::getId(), $status, $limit)
        );
    }

    /**
     * POST /api/v2/admin/caring-community/paper-onboarding
     *
     * Coordinator uploads a scanned KISS consent/onboarding form. OCR is
     * intentionally behind PaperOnboardingIntakeService so this endpoint stays
     * stable when a real OCR provider replaces the manual-review stub.
     */
    public function paperOnboardingUpload(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $guard = $this->guardCaringCommunity();
        if ($guard !== null) return $guard;

        $file = request()->file('file');
        if (!$file || !$file->isValid()) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.caring_paper_onboarding_file_required'), 'file', 422);
        }

        $allowedMimeTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
        if (!in_array((string) $file->getMimeType(), $allowedMimeTypes, true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.caring_paper_onboarding_invalid_file_type'), 'file', 422);
        }

        if ((int) $file->getSize() > 10 * 1024 * 1024) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.caring_paper_onboarding_file_too_large'), 'file', 422);
        }

        $input = $this->getAllInput();
        $intake = $this->paperOnboardingIntakeService->createFromUpload(TenantContext::getId(), $adminId, $file, [
            'name' => $input['name'] ?? null,
            'date_of_birth' => $input['date_of_birth'] ?? null,
            'address' => $input['address'] ?? null,
            'phone' => $input['phone'] ?? null,
            'email' => $input['email'] ?? null,
        ]);

        ActivityLog::log($adminId, 'caring_paper_onboarding_uploaded', 'Paper onboarding form uploaded for coordinator review');

        return $this->respondWithData($intake, null, 201);
    }

    /**
     * POST /api/v2/admin/caring-community/paper-onboarding/{id}/confirm
     */
    public function paperOnboardingConfirm(int $id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $guard = $this->guardCaringCommunity();
        if ($guard !== null) return $guard;

        $result = $this->paperOnboardingIntakeService->confirm(
            TenantContext::getId(),
            $id,
            $adminId,
            $this->getAllInput()
        );

        if (($result['success'] ?? false) !== true) {
            $code = (string) ($result['code'] ?? 'CREATE_FAILED');
            $message = match ($code) {
                'NOT_FOUND' => __('api.caring_paper_onboarding_not_found'),
                'ALREADY_REVIEWED' => __('api.caring_paper_onboarding_already_reviewed'),
                'EMAIL_EXISTS' => __('api.email_already_exists'),
                'VALIDATION_ERROR' => __('api.caring_paper_onboarding_review_required'),
                default => __('api.user_created_failed'),
            };
            $status = $code === 'NOT_FOUND' ? 404 : 422;

            return $this->respondWithError($code, $message, null, $status);
        }

        $user = $result['user'] ?? [];
        $email = is_array($user) ? (string) ($user['email'] ?? '') : '';
        ActivityLog::log($adminId, 'caring_paper_onboarding_confirmed', "Paper onboarding confirmed: {$email}");

        return $this->respondWithData($result, null, 201);
    }

    /**
     * POST /api/v2/admin/caring-community/invite-codes
     *
     * Generate a new invite code for a coordinator to share with a prospective
     * member. The code allows the recipient to reach a warm-welcome page and
     * continue to registration without needing an email invitation.
     */
    public function generateInviteCode(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $guard = $this->guardCaringCommunity();
        if ($guard !== null) return $guard;

        $tenantId = TenantContext::getId();
        $input    = $this->getAllInput();

        $label       = trim((string) ($input['label'] ?? ''));
        $expiresDays = max(1, min(365, (int) ($input['expires_days'] ?? 30)));

        $result = $this->inviteCodeService->generate($tenantId, $adminId, $label ?: null, $expiresDays);

        if (($result['success'] ?? false) !== true) {
            return $this->respondWithError('SERVER_ERROR', __('api.server_error'), null, 500);
        }

        return $this->respondWithData($result['code'], null, 201);
    }

    /**
     * GET /api/v2/admin/caring-community/invite-codes
     *
     * List the last 20 invite codes created for this tenant, with usage status.
     */
    public function listInviteCodes(): JsonResponse
    {
        $guard = $this->guardCaringCommunity();
        if ($guard !== null) return $guard;

        return $this->respondWithData(
            $this->inviteCodeService->list(TenantContext::getId())
        );
    }

    /**
     * GET /api/v2/admin/caring-community/favours
     *
     * Returns the last 50 informal favours recorded for this tenant.
     * Hides the offerer's name when is_anonymous is true.
     */
    public function listFavours(): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        $tenantId = TenantContext::getId();

        if (!\Illuminate\Support\Facades\Schema::hasTable('caring_favours')) {
            return $this->respondWithData(['count' => 0, 'items' => []]);
        }

        $rows = \Illuminate\Support\Facades\DB::select(
            "SELECT
                cf.id,
                cf.category,
                cf.description,
                cf.favour_date,
                cf.is_anonymous,
                cf.created_at,
                u.name        AS offerer_name,
                u.first_name  AS offerer_first_name,
                u.last_name   AS offerer_last_name,
                u.profile_type AS offerer_profile_type,
                u.organization_name AS offerer_organization_name
             FROM caring_favours cf
             LEFT JOIN users u
                    ON u.id = cf.offered_by_user_id
                   AND u.tenant_id = cf.tenant_id
             WHERE cf.tenant_id = ?
             ORDER BY cf.created_at DESC
             LIMIT 50",
            [$tenantId]
        );

        $total = (int) \Illuminate\Support\Facades\DB::table('caring_favours')
            ->where('tenant_id', $tenantId)
            ->count();

        $items = array_map(static function (object $row): array {
            $isAnon = (bool) $row->is_anonymous;
            $name = '';
            if (!$isAnon) {
                $full = UserDisplayName::resolvePrefixed($row, 'offerer_');
                $name = $full !== '' ? $full : (string) ($row->offerer_name ?? '');
            }

            return [
                'id'          => (int) $row->id,
                'category'    => $row->category,
                'description' => (string) $row->description,
                'favour_date' => (string) $row->favour_date,
                'is_anonymous' => $isAnon,
                'offerer_name' => $isAnon ? null : $name,
                'created_at'  => (string) $row->created_at,
            ];
        }, $rows);

        return $this->respondWithData([
            'count' => $total,
            'items' => $items,
        ]);
    }

    /**
     * GET /api/v2/admin/caring-community/loyalty/redemptions
     *
     * Returns the most recent tenant-wide loyalty redemptions plus
     * aggregate stats for the KISS Workflow Console card.
     */
    public function listLoyaltyRedemptions(): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        $limit = (int) (request()->query('limit') ?? 50);

        return $this->respondWithData([
            'stats'       => $this->loyaltyService->tenantStats(),
            'redemptions' => $this->loyaltyService->listTenantRedemptions($limit),
        ]);
    }

    /**
     * GET /api/v2/admin/caring-community/loyalty/seller-settings/{userId}
     *
     * Read a single seller's loyalty configuration. Returns sane defaults
     * when no row exists yet so the admin form can render.
     */
    public function getLoyaltySellerSettings(int $userId): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        return $this->respondWithData($this->loyaltyService->getSellerSettings($userId));
    }

    /**
     * PUT /api/v2/admin/caring-community/loyalty/seller-settings
     *
     * Body: { seller_user_id, accepts_time_credits, loyalty_chf_per_hour, loyalty_max_discount_pct }
     */
    public function updateLoyaltySellerSettings(): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        $input = $this->getAllInput();

        $sellerId = (int) ($input['seller_user_id'] ?? 0);
        if ($sellerId <= 0) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.field_required'), 'seller_user_id', 422);
        }

        try {
            $result = $this->loyaltyService->updateSellerSettings(
                sellerId:           $sellerId,
                acceptsTimeCredits: (bool) ($input['accepts_time_credits'] ?? false),
                chfPerHour:         (float) ($input['loyalty_chf_per_hour'] ?? 25.0),
                maxDiscountPct:     (int) ($input['loyalty_max_discount_pct'] ?? 50),
            );
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('FEATURE_DISABLED', $e->getMessage(), null, 503);
        }

        return $this->respondWithData($result);
    }

    /**
     * POST /api/v2/admin/caring-community/loyalty/redemptions/{id}/reverse
     *
     * Body: { reason?: string }
     *
     * Reverse an applied loyalty redemption: restore the credits to the
     * member's wallet and mark the row reversed. The redemption must belong
     * to the current tenant and be in the `applied` state.
     */
    public function reverseLoyaltyRedemption(int $id): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        $adminId = $this->requireAuth();
        $input = $this->getAllInput();
        $reason = isset($input['reason']) ? (string) $input['reason'] : null;

        try {
            $result = $this->loyaltyService->reverse($id, $reason, $adminId);
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        } catch (\RuntimeException $e) {
            $msg = $e->getMessage();
            if (stripos($msg, 'not found') !== false) {
                return $this->respondWithError('NOT_FOUND', $msg, null, 404);
            }
            return $this->respondWithError('REVERSAL_FAILED', $msg, null, 422);
        }

        Log::info('Admin reversed loyalty redemption', [
            'tenant_id'         => TenantContext::getId(),
            'redemption_id'     => $id,
            'admin_user_id'     => $adminId,
            'credits_restored'  => $result['credits_restored'],
        ]);

        return $this->respondWithData($result);
    }

    public function getRegionalPointSellerSettings(int $userId): JsonResponse
    {
        $disabled = $this->guardRegionalPoints();
        if ($disabled) return $disabled;

        return $this->respondWithData($this->regionalPointService->getMarketplaceSellerSettings($userId));
    }

    public function updateRegionalPointSellerSettings(): JsonResponse
    {
        $disabled = $this->guardRegionalPoints();
        if ($disabled) return $disabled;

        $input = $this->getAllInput();
        $sellerId = (int) ($input['seller_user_id'] ?? 0);
        if ($sellerId <= 0) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.field_required'), 'seller_user_id', 422);
        }

        try {
            $result = $this->regionalPointService->updateMarketplaceSellerSettings(
                sellerId: $sellerId,
                acceptsRegionalPoints: (bool) ($input['accepts_regional_points'] ?? false),
                pointsPerChf: (float) ($input['regional_points_per_chf'] ?? 10.0),
                maxDiscountPct: (int) ($input['regional_points_max_discount_pct'] ?? 25),
            );
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('REGIONAL_POINTS_SELLER_SETTINGS_FAILED', $e->getMessage(), null, 422);
        }

        return $this->respondWithData($result);
    }

    public function regionalPointsConfig(): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        return $this->respondWithData($this->regionalPointService->getConfig(TenantContext::getId()));
    }

    public function updateRegionalPointsConfig(): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        return $this->respondWithData(
            $this->regionalPointService->updateConfig(TenantContext::getId(), $this->getAllInput())
        );
    }

    public function regionalPointsLedger(): JsonResponse
    {
        $disabled = $this->guardRegionalPoints();
        if ($disabled) return $disabled;

        try {
            return $this->respondWithData([
                'stats' => $this->regionalPointService->tenantStats(),
                'items' => $this->regionalPointService->tenantLedger((int) ($this->query('limit') ?? 100)),
            ]);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('FEATURE_DISABLED', $e->getMessage(), null, 403);
        }
    }

    public function issueRegionalPoints(): JsonResponse
    {
        $disabled = $this->guardRegionalPoints();
        if ($disabled) return $disabled;

        $actorId = $this->requireAdmin();
        $input = $this->getAllInput();
        $userId = (int) ($input['user_id'] ?? 0);
        $points = (float) ($input['points'] ?? 0);
        $description = (string) ($input['description'] ?? '');

        if ($userId <= 0) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.field_required'), 'user_id', 422);
        }

        try {
            return $this->respondWithData(
                $this->regionalPointService->issue($userId, $points, $description, $actorId),
                null,
                201
            );
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('FEATURE_DISABLED', $e->getMessage(), null, 403);
        }
    }

    public function adjustRegionalPoints(): JsonResponse
    {
        $disabled = $this->guardRegionalPoints();
        if ($disabled) return $disabled;

        $actorId = $this->requireAdmin();
        $input = $this->getAllInput();
        $userId = (int) ($input['user_id'] ?? 0);
        $pointsDelta = (float) ($input['points_delta'] ?? 0);
        $description = (string) ($input['description'] ?? '');

        if ($userId <= 0) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.field_required'), 'user_id', 422);
        }

        try {
            return $this->respondWithData(
                $this->regionalPointService->adjust($userId, $pointsDelta, $description, $actorId)
            );
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('REGIONAL_POINTS_FAILED', $e->getMessage(), null, 422);
        }
    }

    public function previewVereinMemberImport(int $organizationId): JsonResponse
    {
        $disabled = $this->guardCaringCommunityFeature();
        if ($disabled) return $disabled;

        $actorId = $this->requireAuth();
        $tenantId = TenantContext::getId();
        if (!$this->canManageVereinMembers($tenantId, $actorId, $organizationId)) {
            return $this->respondWithError('FORBIDDEN', __('api.admin_access_required'), null, 403);
        }

        $csv = (string) ($this->getAllInput()['csv'] ?? '');
        try {
            return $this->respondWithData(
                $this->vereinMemberImportService->preview($tenantId, $organizationId, $csv)
            );
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('VEREIN_IMPORT_UNAVAILABLE', $e->getMessage(), null, 503);
        }
    }

    public function importVereinMembers(int $organizationId): JsonResponse
    {
        $disabled = $this->guardCaringCommunityFeature();
        if ($disabled) return $disabled;

        $actorId = $this->requireAuth();
        $tenantId = TenantContext::getId();
        if (!$this->canManageVereinMembers($tenantId, $actorId, $organizationId)) {
            return $this->respondWithError('FORBIDDEN', __('api.admin_access_required'), null, 403);
        }

        $csv = (string) ($this->getAllInput()['csv'] ?? '');
        try {
            return $this->respondWithData(
                $this->vereinMemberImportService->import($tenantId, $organizationId, $actorId, $csv),
                null,
                201
            );
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('VEREIN_IMPORT_UNAVAILABLE', $e->getMessage(), null, 503);
        }
    }

    public function assignVereinAdmin(int $organizationId): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        $actorId = $this->requireAdmin();
        $userId = (int) (($this->getAllInput()['user_id'] ?? 0));
        if ($userId <= 0) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.field_required'), 'user_id', 422);
        }

        try {
            return $this->respondWithData(
                $this->vereinMemberImportService->assignVereinAdmin(TenantContext::getId(), $organizationId, $userId, $actorId),
                null,
                201
            );
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('VEREIN_ADMIN_UNAVAILABLE', $e->getMessage(), null, 503);
        }
    }

    // -------------------------------------------------------------------------
    // AG66 — KPI Baseline methods
    // -------------------------------------------------------------------------

    /**
     * GET /api/v2/admin/caring-community/kpi-baselines
     */
    public function listKpiBaselines(): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        return $this->respondWithData($this->kpiBaselineService->listBaselines(TenantContext::getId()));
    }

    /**
     * POST /api/v2/admin/caring-community/kpi-baselines
     * Body: { label?, period?: { start, end }, notes? }
     */
    public function captureKpiBaseline(): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        $userId   = (int) auth()->id();
        $tenantId = TenantContext::getId();
        $data     = $this->getAllInput();

        $label  = trim((string) ($data['label'] ?? '')) ?: 'Baseline ' . now()->format('Y-m-d');
        $period = is_array($data['period'] ?? null)
            ? $data['period']
            : ['start' => now()->subYear()->toDateString(), 'end' => now()->toDateString()];
        $notes  = isset($data['notes']) && $data['notes'] !== '' ? (string) $data['notes'] : null;
        $metricOverrides = is_array($data['metrics'] ?? null) ? $data['metrics'] : [];

        return $this->respondWithData(
            $this->kpiBaselineService->captureBaseline($tenantId, $label, $period, $notes, $userId, $metricOverrides),
            null,
            201,
        );
    }

    /**
     * GET /api/v2/admin/caring-community/kpi-baselines/{id}/compare
     */
    public function compareKpiBaseline(int $id): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        $result = $this->kpiBaselineService->compareWithBaseline($id, TenantContext::getId());
        if (isset($result['error']) && $result['error'] === 'baseline_not_found') {
            return $this->respondWithError('NOT_FOUND', __('api.not_found'), null, 404);
        }

        return $this->respondWithData($result);
    }

    // -------------------------------------------------------------------------
    // Warmth Pass — Care Recipient Circle
    // -------------------------------------------------------------------------

    /**
     * GET /api/v2/admin/caring-community/recipient/{userId}/circle
     *
     * Returns the support network (circle) for a care recipient, together with
     * open help requests and any safeguarding flags.
     */
    public function recipientCircle(int $userId): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        $tenantId = TenantContext::getId();

        // Recipient user details
        $recipient = \Illuminate\Support\Facades\DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->first();

        if ($recipient === null) {
            return $this->respondWithError('NOT_FOUND', __('api.user_not_found'), null, 404);
        }

        $recipientName = '';
        $resolvedRecipientName = UserDisplayName::resolve($recipient);
        if ($resolvedRecipientName !== '') {
            $recipientName = $resolvedRecipientName;
        }

        $memberSince = null;
        if (!empty($recipient->created_at)) {
            try {
                $memberSince = (string) \Carbon\Carbon::parse((string) $recipient->created_at)->toDateString();
            } catch (\Throwable) {
                $memberSince = null;
            }
        }

        // Support relationships + supporters
        $relationships = [];
        $totalHoursReceived = 0.0;

        if (\Illuminate\Support\Facades\Schema::hasTable('caring_support_relationships')) {
            $supporterColumn = \Illuminate\Support\Facades\Schema::hasColumn('caring_support_relationships', 'supporter_id')
                ? 'supporter_id'
                : (\Illuminate\Support\Facades\Schema::hasColumn('caring_support_relationships', 'supporter_user_id') ? 'supporter_user_id' : null);
            $recipientColumn = \Illuminate\Support\Facades\Schema::hasColumn('caring_support_relationships', 'recipient_id')
                ? 'recipient_id'
                : (\Illuminate\Support\Facades\Schema::hasColumn('caring_support_relationships', 'recipient_user_id') ? 'recipient_user_id' : null);
            $typeColumn = \Illuminate\Support\Facades\Schema::hasColumn('caring_support_relationships', 'relationship_type')
                ? 'relationship_type'
                : (\Illuminate\Support\Facades\Schema::hasColumn('caring_support_relationships', 'frequency') ? 'frequency' : null);
            $activityColumn = \Illuminate\Support\Facades\Schema::hasColumn('caring_support_relationships', 'last_logged_at')
                ? 'last_logged_at'
                : (\Illuminate\Support\Facades\Schema::hasColumn('caring_support_relationships', 'last_activity_at') ? 'last_activity_at' : 'updated_at');
            $hasRelationshipId = \Illuminate\Support\Facades\Schema::hasTable('vol_logs')
                && \Illuminate\Support\Facades\Schema::hasColumn('vol_logs', 'caring_support_relationship_id');

            $rows = collect();
            if ($supporterColumn !== null && $recipientColumn !== null) {
                $select = [
                    'csr.id',
                    'csr.' . $supporterColumn . ' as supporter_user_id',
                    'csr.' . $activityColumn . ' as last_activity_at',
                    'csr.status',
                    'u.name as supporter_name',
                    'u.first_name as supporter_first_name',
                    'u.last_name as supporter_last_name', 'u.profile_type as supporter_profile_type', 'u.organization_name as supporter_organization_name',
                    'u.trust_tier as supporter_trust_tier',
                ];
                $select[] = $typeColumn !== null
                    ? 'csr.' . $typeColumn . ' as relationship_type'
                    : \Illuminate\Support\Facades\DB::raw("'' as relationship_type");

                $rows = \Illuminate\Support\Facades\DB::table('caring_support_relationships as csr')
                    ->join('users as u', 'u.id', '=', 'csr.' . $supporterColumn)
                    ->where('u.tenant_id', $tenantId)
                    ->where('csr.' . $recipientColumn, $userId)
                    ->where('csr.tenant_id', $tenantId)
                    ->where('csr.status', 'active')
                    ->select($select)
                    ->get();
            }

            foreach ($rows as $row) {
                $relId = (int) $row->id;

                // Hours for this relationship
                $hoursForRel = 0.0;
                if ($hasRelationshipId && \Illuminate\Support\Facades\Schema::hasTable('vol_logs')) {
                    $hoursForRel = (float) \Illuminate\Support\Facades\DB::table('vol_logs')
                        ->where('caring_support_relationship_id', $relId)
                        ->where('tenant_id', $tenantId)
                        ->where('status', 'approved')
                        ->sum('hours');
                }

                $totalHoursReceived += $hoursForRel;

                // Supporter name
                $supporterName = UserDisplayName::resolvePrefixed($row, 'supporter_', '');

                $lastActivityAt = null;
                if (!empty($row->last_activity_at)) {
                    try {
                        $lastActivityAt = (string) \Carbon\Carbon::parse((string) $row->last_activity_at)->toIso8601String();
                    } catch (\Throwable) {
                        $lastActivityAt = null;
                    }
                }

                $relationships[] = [
                    'id'               => $relId,
                    'supporter'        => [
                        'id'         => (int) $row->supporter_user_id,
                        'name'       => $supporterName,
                        'trust_tier' => (int) ($row->supporter_trust_tier ?? 0),
                    ],
                    'type'             => (string) ($row->relationship_type ?? ''),
                    'hours_logged'     => $hoursForRel,
                    'last_activity_at' => $lastActivityAt,
                    'status'           => (string) ($row->status ?? ''),
                ];
            }
        }

        // Open help requests
        $openHelpRequests = 0;
        if (\Illuminate\Support\Facades\Schema::hasTable('caring_help_requests')) {
            $closedStatuses = ['matched', 'cancelled', 'closed'];
            $placeholders   = implode(',', array_fill(0, count($closedStatuses), '?'));

            $openHelpRequests = (int) \Illuminate\Support\Facades\DB::table('caring_help_requests')
                ->where('user_id', $userId)
                ->where('tenant_id', $tenantId)
                ->whereNotIn('status', $closedStatuses)
                ->count();
        }

        // Safeguarding flags
        $safeguardingFlags = 0;
        if (\Illuminate\Support\Facades\Schema::hasTable('safeguarding_reports')) {
            $subjectCol = 'subject_user_id';
            if (!\Illuminate\Support\Facades\Schema::hasColumn('safeguarding_reports', $subjectCol)) {
                $subjectCol = \Illuminate\Support\Facades\Schema::hasColumn('safeguarding_reports', 'reported_user_id')
                    ? 'reported_user_id'
                    : null;
            }

            if ($subjectCol !== null) {
                $safeguardingFlags = (int) \Illuminate\Support\Facades\DB::table('safeguarding_reports')
                    ->where($subjectCol, $userId)
                    ->where('tenant_id', $tenantId)
                    ->count();
            }
        }

        return $this->respondWithData([
            'recipient'              => [
                'id'           => $userId,
                'name'         => $recipientName,
                'trust_tier'   => (int) ($recipient->trust_tier ?? 0),
                'member_since' => $memberSince,
            ],
            'support_relationships'  => $relationships,
            'total_hours_received'   => $totalHoursReceived,
            'open_help_requests'     => $openHelpRequests,
            'safeguarding_flags'     => $safeguardingFlags,
        ]);
    }

    // -------------------------------------------------------------------------
    // Municipal ROI
    // -------------------------------------------------------------------------

    /**
     * GET /api/v2/admin/caring-community/municipal-roi
     *
     * Aggregated ROI metrics for municipal/cooperative impact reporting.
     * Uses Swiss formal care assistant hourly rate (default CHF 35, tenant-overridable
     * via tenant_settings key `caring_community.formal_care_hourly_rate_chf`) and the
     * ×2 prevention multiplier from the KISS/Age-Stiftung methodology.
     *
     * Query parameters (all optional):
     *   from           YYYY-MM-DD (default: start of current calendar year)
     *   to             YYYY-MM-DD (default: today)
     *   sub_region_id  Scope all metrics to a single sub-region
     *
     * Substitution-weighted hours multiply each approved log's hours by its
     * category's `substitution_coefficient` (DECIMAL(3,2), default 1.00). When the
     * column is absent (pre-migration), all coefficients fall back to 1.00 so the
     * endpoint stays compatible.
     */
    public function municipalRoi(): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        $tenantId = TenantContext::getId();

        [$fromDate, $toDate] = $this->resolveRoiDateRange();
        $subRegionId = $this->queryInt('sub_region_id', null, 1);

        $scopedLogs = function () use ($tenantId, $fromDate, $toDate, $subRegionId) {
            return $this->scopeVolLogsQuery($tenantId, $fromDate, $toDate, $subRegionId);
        };

        // Total unweighted approved hours (in range)
        $totalHours = 0.0;
        if (Schema::hasTable('vol_logs')) {
            $totalHours = (float) $scopedLogs()
                ->where('vol_logs.status', 'approved')
                ->sum('vol_logs.hours');
        }

        // Substitution-weighted hours (used for the formal-care offset CHF figure)
        [$weightedHours, $substitutionApplied] = $this->computeWeightedHours(
            $tenantId, $fromDate, $toDate, $subRegionId
        );

        // Active members (distinct users with ≥1 approved log in range)
        $activeMembers = 0;
        if (Schema::hasTable('vol_logs')) {
            $activeMembers = (int) $scopedLogs()
                ->where('vol_logs.status', 'approved')
                ->distinct()
                ->count('vol_logs.user_id');
        }

        // Active relationships + recipient count
        $activeRelationships = 0;
        $recipientCount      = 0;
        if (Schema::hasTable('caring_support_relationships')) {
            $relColumn = Schema::hasColumn('caring_support_relationships', 'recipient_id')
                ? 'recipient_id'
                : 'recipient_user_id'; // legacy fallback

            $relQuery = DB::table('caring_support_relationships')
                ->where('caring_support_relationships.tenant_id', $tenantId)
                ->where('caring_support_relationships.status', 'active');
            if ($subRegionId !== null) {
                $relQuery = $this->applySubRegionToRelationships($relQuery, $tenantId, $subRegionId);
            }
            $activeRelationships = (int) (clone $relQuery)->count();

            $recipientQuery = DB::table('caring_support_relationships')
                ->where('caring_support_relationships.tenant_id', $tenantId);
            if ($subRegionId !== null) {
                $recipientQuery = $this->applySubRegionToRelationships($recipientQuery, $tenantId, $subRegionId);
            }
            $recipientCount = (int) $recipientQuery->distinct()->count('caring_support_relationships.' . $relColumn);
        }

        // Total approved exchanges (in range)
        $totalExchanges = 0;
        if (Schema::hasTable('vol_logs')) {
            $totalExchanges = (int) $scopedLogs()
                ->where('vol_logs.status', 'approved')
                ->count();
        }

        // YoY trend (12 months vs prior 12 months) — independent of date filter
        $hoursYoyPct = $this->computeYoyTrend($tenantId);

        // Hourly rate — tenant override or default
        [$hourlyRateChf, $hourlyRateSource] = $this->resolveHourlyRate($tenantId);

        // ROI: weighted-hours × CHF rate (× 2 for prevention value)
        $formalCareOffsetChf = round($weightedHours * $hourlyRateChf, 2);
        $preventionValueChf  = round($formalCareOffsetChf * 2, 2);

        $payload = [
            'total_hours'          => $totalHours,
            'weighted_hours'       => $weightedHours,
            'active_members'       => $activeMembers,
            'active_relationships' => $activeRelationships,
            'recipient_count'      => $recipientCount,
            'total_exchanges'      => $totalExchanges,
            'roi'                  => [
                'hourly_rate_chf'            => $hourlyRateChf,
                'formal_care_offset_chf'     => $formalCareOffsetChf,
                'prevention_value_chf'       => $preventionValueChf,
                'social_isolation_prevented' => $recipientCount,
            ],
            'trend'                => [
                'hours_yoy_pct' => $hoursYoyPct,
            ],
            'period'               => [
                'from' => $fromDate->toDateString(),
                'to'   => $toDate->toDateString(),
            ],
            'filters'              => [
                'sub_region_id' => $subRegionId,
            ],
            'methodology'          => [
                'hourly_rate_chf'       => $hourlyRateChf,
                'hourly_rate_source'    => $hourlyRateSource,
                'prevention_multiplier' => 2.0,
                'substitution_applied'  => $substitutionApplied,
            ],
        ];

        // Sub-region breakdown — only when no sub_region_id filter applied
        if ($subRegionId === null && Schema::hasTable('caring_sub_regions')) {
            $payload['breakdown_by_sub_region'] = $this->subRegionBreakdown(
                $tenantId, $fromDate, $toDate, $hourlyRateChf
            );
        }

        return $this->respondWithData($payload);
    }

    /**
     * GET /api/v2/admin/caring-community/municipal-roi/export
     *
     * Streams a CSV containing the same metrics as municipalRoi() plus a
     * sub-region breakdown table. Procurement-grade format for cantonal
     * social department / Age-Stiftung evaluators.
     */
    public function municipalRoiExport(): StreamedResponse|JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        $tenantId = TenantContext::getId();

        [$fromDate, $toDate] = $this->resolveRoiDateRange();
        $subRegionId = $this->queryInt('sub_region_id', null, 1);

        $scopedLogs = function () use ($tenantId, $fromDate, $toDate, $subRegionId) {
            return $this->scopeVolLogsQuery($tenantId, $fromDate, $toDate, $subRegionId);
        };

        $totalHours = 0.0;
        if (Schema::hasTable('vol_logs')) {
            $totalHours = (float) $scopedLogs()
                ->where('vol_logs.status', 'approved')
                ->sum('vol_logs.hours');
        }

        [$weightedHours, ] = $this->computeWeightedHours($tenantId, $fromDate, $toDate, $subRegionId);
        [$hourlyRateChf, ] = $this->resolveHourlyRate($tenantId);

        $formalCareOffsetChf = round($weightedHours * $hourlyRateChf, 2);
        $preventionValueChf  = round($formalCareOffsetChf * 2, 2);

        $activeMembers = 0;
        if (Schema::hasTable('vol_logs')) {
            $activeMembers = (int) $scopedLogs()
                ->where('vol_logs.status', 'approved')
                ->distinct()
                ->count('vol_logs.user_id');
        }

        $activeRelationships = 0;
        $recipientCount = 0;
        if (Schema::hasTable('caring_support_relationships')) {
            $relColumn = Schema::hasColumn('caring_support_relationships', 'recipient_id')
                ? 'recipient_id'
                : 'recipient_user_id';

            $relQuery = DB::table('caring_support_relationships')
                ->where('caring_support_relationships.tenant_id', $tenantId)
                ->where('caring_support_relationships.status', 'active');
            if ($subRegionId !== null) {
                $relQuery = $this->applySubRegionToRelationships($relQuery, $tenantId, $subRegionId);
            }
            $activeRelationships = (int) (clone $relQuery)->count();

            $recipientQuery = DB::table('caring_support_relationships')
                ->where('caring_support_relationships.tenant_id', $tenantId);
            if ($subRegionId !== null) {
                $recipientQuery = $this->applySubRegionToRelationships($recipientQuery, $tenantId, $subRegionId);
            }
            $recipientCount = (int) $recipientQuery->distinct()->count('caring_support_relationships.' . $relColumn);
        }

        $breakdown = ($subRegionId === null && Schema::hasTable('caring_sub_regions'))
            ? $this->subRegionBreakdown($tenantId, $fromDate, $toDate, $hourlyRateChf)
            : [];

        $tenantSlug = $this->tenantSlugForFilename($tenantId);
        $filename = sprintf(
            'municipal-roi-%s-%s-to-%s.csv',
            $tenantSlug,
            $fromDate->toDateString(),
            $toDate->toDateString()
        );

        $rows = [
            ['Metric', 'Value', 'Unit'],
            ['Period start', $fromDate->toDateString(), ''],
            ['Period end', $toDate->toDateString(), ''],
            ['Total approved hours', number_format($totalHours, 2, '.', ''), 'hours'],
            ['Substitution-weighted hours', number_format($weightedHours, 2, '.', ''), 'hours'],
            ['Formal care hourly rate', number_format((float) $hourlyRateChf, 2, '.', ''), 'CHF'],
            ['Formal care offset', number_format($formalCareOffsetChf, 2, '.', ''), 'CHF'],
            ['Prevention value (2x multiplier)', number_format($preventionValueChf, 2, '.', ''), 'CHF'],
            ['Active members', (string) $activeMembers, ''],
            ['Active relationships', (string) $activeRelationships, ''],
            ['Care recipients (out of isolation)', (string) $recipientCount, ''],
        ];

        if (!empty($breakdown)) {
            $rows[] = ['', '', ''];
            $rows[] = ['Sub-region breakdown', '', ''];
            $rows[] = ['Sub-region', 'Hours', 'Weighted hours', 'Formal care offset CHF'];
            foreach ($breakdown as $row) {
                $rows[] = [
                    (string) ($row['sub_region_name'] ?? ''),
                    number_format((float) ($row['hours'] ?? 0), 2, '.', ''),
                    number_format((float) ($row['weighted_hours'] ?? 0), 2, '.', ''),
                    number_format((float) ($row['formal_care_offset_chf'] ?? 0), 2, '.', ''),
                ];
            }
        }

        return new StreamedResponse(function () use ($rows) {
            $out = fopen('php://output', 'w');
            // UTF-8 BOM so Excel renders Swiss German umlauts correctly.
            fwrite($out, "\xEF\xBB\xBF");
            foreach ($rows as $row) {
                fputcsv($out, CsvExportSanitizer::row($row));
            }
            fclose($out);
        }, 200, [
            'Content-Type'        => 'text/csv; charset=UTF-8',
            'Content-Disposition' => 'attachment; filename="' . $filename . '"',
            'Cache-Control'       => 'no-store, max-age=0',
        ]);
    }

    // -------------------------------------------------------------------------
    // Municipal ROI helpers
    // -------------------------------------------------------------------------

    /**
     * Resolve from/to dates from query params, defaulting to YTD.
     * @return array{0: Carbon, 1: Carbon}
     */
    private function resolveRoiDateRange(): array
    {
        $now = Carbon::now();

        $fromRaw = $this->query('from');
        $toRaw   = $this->query('to');

        $from = $now->copy()->startOfYear();
        $to   = $now->copy()->endOfDay();

        if (is_string($fromRaw) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $fromRaw)) {
            try {
                $from = Carbon::parse($fromRaw)->startOfDay();
            } catch (\Throwable $e) {
                // keep default
            }
        }

        if (is_string($toRaw) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $toRaw)) {
            try {
                $to = Carbon::parse($toRaw)->endOfDay();
            } catch (\Throwable $e) {
                // keep default
            }
        }

        if ($from->greaterThan($to)) {
            $from = $to->copy()->startOfDay();
        }

        return [$from, $to];
    }

    /**
     * Build a vol_logs query scoped by tenant + date range + (optional) sub-region.
     * Sub-region scoping is best-effort: vol_log → caring_support_relationship →
     * caring_care_provider (organization match) → sub_region_id. Without those joins
     * resolving, the sub-region scope falls through (the filter is effectively
     * ignored rather than crashing).
     */
    private function scopeVolLogsQuery(int $tenantId, Carbon $from, Carbon $to, ?int $subRegionId)
    {
        $q = DB::table('vol_logs')
            ->where('vol_logs.tenant_id', $tenantId)
            ->whereBetween('vol_logs.created_at', [$from->toDateTimeString(), $to->toDateTimeString()]);

        if ($subRegionId !== null
            && Schema::hasTable('caring_support_relationships')
            && Schema::hasTable('caring_care_providers')
            && Schema::hasColumn('caring_care_providers', 'sub_region_id')
        ) {
            $q->join('caring_support_relationships as csr', function ($j) use ($tenantId) {
                $j->on('csr.id', '=', 'vol_logs.caring_support_relationship_id')
                  ->where('csr.tenant_id', '=', $tenantId);
            })
              ->join('caring_care_providers as ccp', function ($j) use ($tenantId, $subRegionId) {
                  $j->on('ccp.id', '=', 'csr.organization_id')
                    ->where('ccp.tenant_id', '=', $tenantId)
                    ->where('ccp.sub_region_id', '=', $subRegionId);
              });
        }

        return $q;
    }

    /**
     * Apply sub-region scoping to a caring_support_relationships query.
     */
    private function applySubRegionToRelationships($query, int $tenantId, int $subRegionId)
    {
        if (Schema::hasTable('caring_care_providers')
            && Schema::hasColumn('caring_care_providers', 'sub_region_id')
        ) {
            $query->join('caring_care_providers as ccp', function ($j) use ($tenantId, $subRegionId) {
                $j->on('ccp.id', '=', 'caring_support_relationships.organization_id')
                  ->where('ccp.tenant_id', '=', $tenantId)
                  ->where('ccp.sub_region_id', '=', $subRegionId);
            });
        }
        return $query;
    }

    /**
     * Compute substitution-weighted approved hours for the period.
     * Returns [weighted_hours, substitution_applied_bool].
     *
     * @return array{0: float, 1: bool}
     */
    private function computeWeightedHours(int $tenantId, Carbon $from, Carbon $to, ?int $subRegionId): array
    {
        if (!Schema::hasTable('vol_logs')) {
            return [0.0, false];
        }

        $hasCoefficient = Schema::hasTable('categories')
            && Schema::hasColumn('categories', 'substitution_coefficient');

        if (!$hasCoefficient) {
            // Pre-migration: fall back to unweighted total. UI sees substitution_applied=false.
            $totalHours = (float) $this->scopeVolLogsQuery($tenantId, $from, $to, $subRegionId)
                ->where('vol_logs.status', 'approved')
                ->sum('vol_logs.hours');
            return [round($totalHours, 2), false];
        }

        // Sum hours × COALESCE(category.substitution_coefficient, 1.00).
        // category_id is pulled from either the vol_opportunity OR the
        // caring_support_relationship (whichever the log is linked to). Logs with
        // neither still count at coefficient 1.00 via COALESCE.
        $sql = "
            SELECT COALESCE(SUM(vl.hours * COALESCE(c.substitution_coefficient, 1.00)), 0) AS weighted
            FROM vol_logs vl
            LEFT JOIN vol_opportunities vo ON vo.id = vl.opportunity_id
            LEFT JOIN caring_support_relationships csr ON csr.id = vl.caring_support_relationship_id
            LEFT JOIN categories c ON c.id = COALESCE(vo.category_id, csr.category_id)
        ";
        $where = " WHERE vl.tenant_id = ? AND vl.status = 'approved' AND vl.created_at BETWEEN ? AND ?";
        $params = [$tenantId, $from->toDateTimeString(), $to->toDateTimeString()];

        if ($subRegionId !== null
            && Schema::hasTable('caring_care_providers')
            && Schema::hasColumn('caring_care_providers', 'sub_region_id')
        ) {
            $sql .= " INNER JOIN caring_care_providers ccp ON ccp.id = csr.organization_id AND ccp.tenant_id = vl.tenant_id";
            $where .= " AND ccp.sub_region_id = ?";
            $params[] = $subRegionId;
        }

        try {
            $row = DB::selectOne($sql . $where, $params);
            $weighted = (float) ($row->weighted ?? 0);
            return [round($weighted, 2), true];
        } catch (\Throwable $e) {
            Log::warning('municipalRoi computeWeightedHours failed', [
                'tenant_id' => $tenantId,
                'error'     => $e->getMessage(),
            ]);
            return [0.0, false];
        }
    }

    /**
     * YoY trend in % — last 12 months vs prior 12 months.
     */
    private function computeYoyTrend(int $tenantId): ?float
    {
        if (!Schema::hasTable('vol_logs')) {
            return null;
        }

        $now = Carbon::now();
        $oneYearAgo = $now->copy()->subYear();
        $twoYearsAgo = $now->copy()->subYears(2);

        $hoursThisYear = (float) DB::table('vol_logs')
            ->where('tenant_id', $tenantId)
            ->where('status', 'approved')
            ->where('created_at', '>=', $oneYearAgo->toDateTimeString())
            ->sum('hours');

        $hoursPriorYear = (float) DB::table('vol_logs')
            ->where('tenant_id', $tenantId)
            ->where('status', 'approved')
            ->where('created_at', '>=', $twoYearsAgo->toDateTimeString())
            ->where('created_at', '<', $oneYearAgo->toDateTimeString())
            ->sum('hours');

        if ($hoursPriorYear <= 0) {
            return null;
        }

        return round((($hoursThisYear - $hoursPriorYear) / $hoursPriorYear) * 100, 2);
    }

    /**
     * Read tenant-configurable hourly rate from tenant_settings.
     * Returns [rate_chf, source ('tenant_setting'|'default')].
     *
     * @return array{0: float, 1: string}
     */
    private function resolveHourlyRate(int $tenantId): array
    {
        $default = 35.0;

        if (!Schema::hasTable('tenant_settings')) {
            return [$default, 'default'];
        }

        $row = DB::table('tenant_settings')
            ->where('tenant_id', $tenantId)
            ->where('setting_key', 'caring_community.formal_care_hourly_rate_chf')
            ->first(['setting_value']);

        if (!$row || $row->setting_value === null || $row->setting_value === '') {
            return [$default, 'default'];
        }

        $value = is_string($row->setting_value) ? trim($row->setting_value) : (string) $row->setting_value;
        if (!is_numeric($value)) {
            return [$default, 'default'];
        }

        $rate = (float) $value;
        if ($rate <= 0) {
            return [$default, 'default'];
        }

        return [$rate, 'tenant_setting'];
    }

    /**
     * Build a sub-region breakdown for the tenant in the date range.
     * Returns [{sub_region_id, sub_region_name, hours, weighted_hours, formal_care_offset_chf}, ...].
     *
     * @return array<int, array<string,mixed>>
     */
    private function subRegionBreakdown(int $tenantId, Carbon $from, Carbon $to, float $hourlyRateChf): array
    {
        if (!Schema::hasTable('caring_sub_regions')
            || !Schema::hasTable('caring_support_relationships')
            || !Schema::hasTable('caring_care_providers')
            || !Schema::hasColumn('caring_care_providers', 'sub_region_id')
            || !Schema::hasTable('vol_logs')
        ) {
            return [];
        }

        $hasCoefficient = Schema::hasColumn('categories', 'substitution_coefficient');

        $weightedExpr = $hasCoefficient
            ? 'SUM(vl.hours * COALESCE(c.substitution_coefficient, 1.00))'
            : 'SUM(vl.hours)';

        $categoryJoin = $hasCoefficient
            ? '
                LEFT JOIN vol_opportunities vo ON vo.id = vl.opportunity_id
                LEFT JOIN categories c ON c.id = COALESCE(vo.category_id, csr.category_id)
              '
            : '';

        $sql = "
            SELECT
                sr.id   AS sub_region_id,
                sr.name AS sub_region_name,
                COALESCE(SUM(vl.hours), 0) AS hours,
                COALESCE({$weightedExpr}, 0) AS weighted_hours
            FROM caring_sub_regions sr
            INNER JOIN caring_care_providers ccp
                ON ccp.sub_region_id = sr.id
                AND ccp.tenant_id = sr.tenant_id
            INNER JOIN caring_support_relationships csr
                ON csr.organization_id = ccp.id
                AND csr.tenant_id = sr.tenant_id
            INNER JOIN vol_logs vl
                ON vl.caring_support_relationship_id = csr.id
                AND vl.tenant_id = sr.tenant_id
                AND vl.status = 'approved'
                AND vl.created_at BETWEEN ? AND ?
            {$categoryJoin}
            WHERE sr.tenant_id = ?
            GROUP BY sr.id, sr.name
            ORDER BY hours DESC, sr.name ASC
        ";

        try {
            $rows = DB::select($sql, [$from->toDateTimeString(), $to->toDateTimeString(), $tenantId]);
        } catch (\Throwable $e) {
            Log::warning('municipalRoi sub-region breakdown failed', [
                'tenant_id' => $tenantId,
                'error'     => $e->getMessage(),
            ]);
            return [];
        }

        $out = [];
        foreach ($rows as $row) {
            $hours = (float) ($row->hours ?? 0);
            $weighted = (float) ($row->weighted_hours ?? 0);
            $out[] = [
                'sub_region_id'          => (int) $row->sub_region_id,
                'sub_region_name'        => (string) $row->sub_region_name,
                'hours'                  => round($hours, 2),
                'weighted_hours'         => round($weighted, 2),
                'formal_care_offset_chf' => round($weighted * $hourlyRateChf, 2),
            ];
        }

        return $out;
    }

    /**
     * Best-effort tenant slug for CSV filename.
     */
    private function tenantSlugForFilename(int $tenantId): string
    {
        try {
            $row = DB::table('tenants')->where('id', $tenantId)->first(['slug', 'name']);
            if ($row && !empty($row->slug)) {
                $slug = preg_replace('/[^a-z0-9_-]+/i', '-', (string) $row->slug);
                return trim((string) $slug, '-') ?: ('tenant-' . $tenantId);
            }
            if ($row && !empty($row->name)) {
                $slug = preg_replace('/[^a-z0-9_-]+/i', '-', strtolower((string) $row->name));
                return trim((string) $slug, '-') ?: ('tenant-' . $tenantId);
            }
        } catch (\Throwable $e) {
            // ignore
        }
        return 'tenant-' . $tenantId;
    }

    // -------------------------------------------------------------------------
    // AG83 — Pilot Success Scoreboard
    // -------------------------------------------------------------------------

    /**
     * GET /api/v2/admin/caring-community/pilot-scoreboard
     */
    public function pilotScoreboard(): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        return $this->respondWithData(
            $this->pilotScoreboardService->scoreboard(TenantContext::getId())
        );
    }

    /**
     * GET /api/v2/admin/caring-community/pilot-scoreboard/baselines
     */
    public function pilotScoreboardBaselines(): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        return $this->respondWithData([
            'items' => $this->pilotScoreboardService->listBaselines(TenantContext::getId()),
        ]);
    }

    /**
     * POST /api/v2/admin/caring-community/pilot-scoreboard/pre-pilot
     * Body: { notes? }
     */
    public function capturePrePilotBaseline(): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        $actorId = (int) auth()->id();
        $notes = $this->input('notes');
        $notes = is_string($notes) ? trim($notes) : null;
        $notes = $notes === '' ? null : $notes;

        $baseline = $this->pilotScoreboardService->capturePrePilotBaseline(
            TenantContext::getId(),
            $actorId,
            $notes,
        );

        if (isset($baseline['error'])) {
            return $this->respondWithError('UNAVAILABLE', __('api.service_unavailable'), null, 503);
        }

        return $this->respondWithData($baseline);
    }

    /**
     * POST /api/v2/admin/caring-community/pilot-scoreboard/quarterly
     * Body: { label?, notes? }
     */
    public function captureQuarterlyReview(): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        $actorId = (int) auth()->id();
        $rawLabel = $this->input('label');
        $label = is_string($rawLabel) && trim($rawLabel) !== ''
            ? mb_substr(trim($rawLabel), 0, 120)
            : 'quarterly_' . now()->format('Y_m');

        if ($label === PilotScoreboardService::PRE_PILOT_LABEL) {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                __('api.field_required'),
                'label',
                422,
            );
        }

        $notes = $this->input('notes');
        $notes = is_string($notes) ? trim($notes) : null;
        $notes = $notes === '' ? null : $notes;

        $baseline = $this->pilotScoreboardService->captureBaseline(
            TenantContext::getId(),
            $label,
            $actorId,
            $notes,
        );

        if (isset($baseline['error'])) {
            return $this->respondWithError('UNAVAILABLE', __('api.service_unavailable'), null, 503);
        }

        return $this->respondWithData($baseline);
    }

    // -------------------------------------------------------------------------
    // AG81 — Operating Policy
    // -------------------------------------------------------------------------

    /**
     * GET /api/v2/admin/caring-community/operating-policy
     */
    public function operatingPolicyShow(): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        return $this->respondWithData(
            $this->operatingPolicyService->get(TenantContext::getId())
        );
    }

    /**
     * PUT /api/v2/admin/caring-community/operating-policy
     */
    public function operatingPolicyUpdate(): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        $payload = (array) request()->all();
        $result = $this->operatingPolicyService->update(TenantContext::getId(), $payload);

        if (isset($result['errors']) && $result['errors'] !== []) {
            return $this->respondWithErrors(array_map(
                fn ($e) => ['code' => 'VALIDATION_ERROR', 'message' => $e['message'], 'field' => $e['field']],
                $result['errors'],
            ), 422);
        }

        return $this->respondWithData($result['policy'] ?? []);
    }

    // -------------------------------------------------------------------------
    // AG80 — FADP / nDSG Disclosure Pack
    // -------------------------------------------------------------------------

    /**
     * GET /api/v2/admin/caring-community/disclosure-pack
     */
    public function disclosurePackShow(): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        return $this->respondWithData(
            $this->disclosurePackService->get(TenantContext::getId())
        );
    }

    /**
     * PUT /api/v2/admin/caring-community/disclosure-pack
     */
    public function disclosurePackUpdate(): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        $payload = (array) request()->all();
        $result = $this->disclosurePackService->update(TenantContext::getId(), $payload);

        if (isset($result['errors']) && $result['errors'] !== []) {
            return $this->respondWithErrors(array_map(
                fn ($e) => ['code' => 'VALIDATION_ERROR', 'message' => $e['message'], 'field' => $e['field']],
                $result['errors'],
            ), 422);
        }

        return $this->respondWithData($result['pack'] ?? []);
    }

    /**
     * GET /api/v2/admin/caring-community/disclosure-pack/export
     * Returns Markdown for printing/sharing as the formal pilot disclosure document.
     */
    public function disclosurePackExport(): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        return $this->respondWithData([
            'format'   => 'markdown',
            'content'  => $this->disclosurePackService->renderMarkdown(TenantContext::getId()),
            'filename' => 'fadp-ndsg-disclosure-pack.md',
        ]);
    }

    // -------------------------------------------------------------------------
    // Per-Category Substitution Coefficients (Pflege-CHF computation)
    // -------------------------------------------------------------------------

    /**
     * Tables that may carry a `substitution_coefficient` column for the
     * caring community Pflege-CHF computation. Currently the caring/volunteer
     * help categories live in the shared, tenant-scoped `categories` table —
     * both `caring_support_relationships.category_id` and
     * `vol_opportunities.category_id` FK to it.
     *
     * @var list<string>
     */
    private const CATEGORY_COEFFICIENT_TABLES = ['categories'];

    /**
     * GET /api/v2/admin/caring-community/category-coefficients
     *
     * Returns the per-category substitution coefficients used to convert
     * community caring hours into formal-care-hour equivalents.
     */
    public function listCategoryCoefficients(): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        $tenantId = TenantContext::getId();
        $rows     = [];
        $migrationPending = false;

        foreach (self::CATEGORY_COEFFICIENT_TABLES as $table) {
            if (!Schema::hasTable($table)) {
                continue;
            }
            if (!Schema::hasColumn($table, 'substitution_coefficient')) {
                $migrationPending = true;
                continue;
            }

            $query = DB::table($table)
                ->select(['id', 'name', 'substitution_coefficient']);

            // Categories table is tenant-scoped — scope by current tenant.
            if (Schema::hasColumn($table, 'tenant_id')) {
                $query->where('tenant_id', $tenantId);
            }

            // Active flag — only show enabled categories where present.
            if (Schema::hasColumn($table, 'is_active')) {
                $query->where('is_active', 1);
            }

            // Stable ordering for the editor.
            if (Schema::hasColumn($table, 'sort_order')) {
                $query->orderBy('sort_order')->orderBy('name');
            } else {
                $query->orderBy('name');
            }

            foreach ($query->get() as $row) {
                $rows[] = [
                    'id'                       => (int) $row->id,
                    'name'                     => (string) $row->name,
                    'substitution_coefficient' => (float) $row->substitution_coefficient,
                    'source_table'             => $table,
                ];
            }
        }

        if ($migrationPending && $rows === []) {
            return $this->respondWithData([
                'categories'        => [],
                'migration_pending' => true,
            ]);
        }

        return $this->respondWithData([
            'categories'        => $rows,
            'migration_pending' => false,
        ]);
    }

    /**
     * PUT /api/v2/admin/caring-community/category-coefficients/{id}
     *
     * Body: { substitution_coefficient: float, source_table: string }
     */
    public function updateCategoryCoefficient(int $id): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        $tenantId = TenantContext::getId();
        $input    = $this->getAllInput();

        $sourceTable = isset($input['source_table']) ? (string) $input['source_table'] : '';
        if (!in_array($sourceTable, self::CATEGORY_COEFFICIENT_TABLES, true)) {
            return $this->respondWithError(
                'VALIDATION_INVALID_FIELD',
                __('api.caring_category_coefficient_invalid_source_table'),
                'source_table',
                422,
            );
        }

        if (!Schema::hasTable($sourceTable) || !Schema::hasColumn($sourceTable, 'substitution_coefficient')) {
            return $this->respondWithError(
                'MIGRATION_PENDING',
                __('api.caring_category_coefficient_migration_pending'),
                null,
                503,
            );
        }

        if (!array_key_exists('substitution_coefficient', $input)) {
            return $this->respondWithError(
                'VALIDATION_REQUIRED_FIELD',
                __('api.caring_category_coefficient_required'),
                'substitution_coefficient',
                422,
            );
        }

        $rawCoefficient = $input['substitution_coefficient'];
        if (!is_numeric($rawCoefficient)) {
            return $this->respondWithError(
                'VALIDATION_INVALID_FIELD',
                __('api.caring_category_coefficient_numeric'),
                'substitution_coefficient',
                422,
            );
        }

        $coefficient = round((float) $rawCoefficient, 2);
        if ($coefficient < 0.0 || $coefficient > 9.99) {
            return $this->respondWithError(
                'VALIDATION_OUT_OF_RANGE',
                __('api.caring_category_coefficient_range'),
                'substitution_coefficient',
                422,
            );
        }

        $query = DB::table($sourceTable)->where('id', $id);
        if (Schema::hasColumn($sourceTable, 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }

        $existing = (clone $query)->first(['id']);
        if ($existing === null) {
            return $this->respondWithError(
                'NOT_FOUND',
                __('api.category_not_found'),
                null,
                404,
            );
        }

        $query->update(['substitution_coefficient' => $coefficient]);

        Log::info('caring_community.category_coefficient_updated', [
            'tenant_id'                => $tenantId,
            'category_id'              => $id,
            'source_table'             => $sourceTable,
            'substitution_coefficient' => $coefficient,
        ]);

        return $this->respondWithData([
            'id'                       => $id,
            'substitution_coefficient' => $coefficient,
            'source_table'             => $sourceTable,
        ]);
    }

    /**
     * POST /v2/admin/caring-community/launch-readiness/launch
     *
     * AG95 — enforce the pilot launch readiness gate. Only succeeds when every
     * section in the readiness report is `ready`. Persists pilot_launched_at /
     * pilot_launched_by to tenant_settings so the platform can refer to the
     * "live" milestone in dashboards and reports. One-way action: a tenant
     * that has launched returns 422 ALREADY_LAUNCHED on subsequent calls.
     */
    public function launchPilot(): JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) {
            return $disabled;
        }

        $adminUserId = (int) auth()->id();
        $tenantId = TenantContext::getId();

        $result = $this->pilotLaunchReadinessService->launchPilot($tenantId, $adminUserId);

        if (isset($result['error'])) {
            $code = (string) $result['error'];

            if ($code === 'STORAGE_UNAVAILABLE') {
                return $this->respondWithError(
                    'STORAGE_UNAVAILABLE',
                    __('api.tenant_settings_storage_unavailable'),
                    null,
                    503,
                );
            }

            if ($code === 'ALREADY_LAUNCHED') {
                return $this->respondWithError(
                    'ALREADY_LAUNCHED',
                    __('api.caring_pilot_already_launched'),
                    null,
                    422,
                );
            }

            if ($code === 'CANNOT_LAUNCH') {
                // Custom shape so the structured `blockers` list can be
                // surfaced to the admin UI alongside the standard error code.
                return response()->json([
                    'success' => false,
                    'errors'  => [[
                        'code'    => 'CANNOT_LAUNCH',
                        'message' => __('api.launch_readiness_gate_not_closed'),
                    ]],
                    'error'   => [
                        'code'     => 'CANNOT_LAUNCH',
                        'message'  => __('api.launch_readiness_gate_not_closed'),
                        'blockers' => $result['blockers'] ?? [],
                    ],
                ], 422);
            }

            return $this->respondWithError($code, __('api.caring_pilot_launch_failed'), null, 422);
        }

        try {
            ActivityLog::log(
                $adminUserId,
                'caring_pilot_launched',
                'Pilot launched (AG95 readiness gate closed)'
            );
        } catch (\Throwable $e) {
            Log::warning('caring_pilot_launched activity log failed: ' . $e->getMessage());
        }

        return $this->respondWithData([
            'launched_at'    => $result['launched_at'],
            'launched_by_id' => $result['launched_by_id'],
            'report'         => $this->pilotLaunchReadinessService->report($tenantId),
        ]);
    }

    private function guardCaringCommunity(): ?JsonResponse
    {
        $this->requireAdmin();

        return $this->guardCaringCommunityFeature();
    }

    private function guardCaringCommunityFeature(): ?JsonResponse
    {
        if (!TenantContext::hasFeature('caring_community')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }

        return null;
    }

    private function guardRegionalPoints(): ?JsonResponse
    {
        $disabled = $this->guardCaringCommunity();
        if ($disabled) return $disabled;

        if (!$this->regionalPointService->isEnabled(TenantContext::getId())) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.caring_regional_points_disabled'), null, 403);
        }

        return null;
    }

    private function canManageVereinMembers(int $tenantId, int $actorId, int $organizationId): bool
    {
        $actor = User::query()
            ->where('tenant_id', $tenantId)
            ->where('id', $actorId)
            ->first(['role', 'is_admin', 'is_super_admin', 'is_tenant_super_admin', 'is_god']);

        if ($actor && (
            in_array((string) $actor->role, ['admin', 'tenant_admin', 'super_admin', 'god'], true)
            || (int) ($actor->is_admin ?? 0) === 1
            || (int) ($actor->is_super_admin ?? 0) === 1
            || (int) ($actor->is_tenant_super_admin ?? 0) === 1
            || (int) ($actor->is_god ?? 0) === 1
        )) {
            return true;
        }

        return $this->vereinMemberImportService->userHasPermissionInOrg(
            $tenantId,
            $actorId,
            $organizationId,
            'verein.members.import'
        );
    }
}
