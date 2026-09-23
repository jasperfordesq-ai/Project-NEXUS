<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Services\MunicipalSurveyService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use InvalidArgumentException;
use RuntimeException;

/**
 * AG62 — Municipality Survey & Feedback Tool controller.
 *
 * Member-facing endpoints (authenticated):
 *   GET  /v2/caring-community/surveys              → activeSurveys()
 *   GET  /v2/caring-community/surveys/{id}         → getSurvey()
 *   POST /v2/caring-community/surveys/{id}/respond → submitSurvey()
 *
 * Admin-facing endpoints (admin or municipality_announcer):
 *   GET  /v2/admin/caring-community/surveys           → adminListSurveys()
 *   POST /v2/admin/caring-community/surveys           → adminCreateSurvey()
 *   GET  /v2/admin/caring-community/surveys/{id}      → adminGetSurvey()
 *   PUT  /v2/admin/caring-community/surveys/{id}      → adminUpdateSurvey()
 *   POST /v2/admin/caring-community/surveys/{id}/publish → adminPublishSurvey()
 *   POST /v2/admin/caring-community/surveys/{id}/close   → adminCloseSurvey()
 *   GET  /v2/admin/caring-community/surveys/{id}/export  → adminExportCsv()
 */
class MunicipalSurveyController extends BaseApiController
{
    protected bool $isV2Api = true;

    // ─── Feature gate helper ──────────────────────────────────────────────────

    private function assertFeatureEnabled(): ?JsonResponse
    {
        if (! TenantContext::hasFeature('caring_community')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }
        if (! MunicipalSurveyService::isAvailable()) {
            return $this->respondWithError('SERVICE_UNAVAILABLE', __('api.service_unavailable'), null, 503);
        }
        return null;
    }

    // ─── Auth helper — mirrors EmergencyAlertController::hasAnnouncerAccess ──

    private function hasAnnouncerAccess(int $userId, int $tenantId): bool
    {
        $user = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->first(['role', 'is_admin', 'is_super_admin', 'is_tenant_super_admin', 'is_god']);

        if ($user) {
            $role = (string) ($user->role ?? '');
            if (
                in_array($role, ['admin', 'tenant_admin', 'super_admin', 'god'], true)
                || (bool) ($user->is_admin ?? false)
                || (bool) ($user->is_super_admin ?? false)
                || (bool) ($user->is_tenant_super_admin ?? false)
                || (bool) ($user->is_god ?? false)
            ) {
                return true;
            }
        }

        return (bool) DB::table('user_roles')
            ->join('roles', 'roles.id', '=', 'user_roles.role_id')
            ->where('user_roles.user_id', $userId)
            ->where('user_roles.tenant_id', $tenantId)
            ->where('roles.name', 'municipality_announcer')
            ->exists();
    }

    // =========================================================================
    // Member-facing
    // =========================================================================

    /**
     * Return all currently active (and not-yet-expired) surveys.
     * Authentication is enforced at the route boundary.
     */
    public function activeSurveys(): JsonResponse
    {
        $tenantId = TenantContext::getId();

        if ($err = $this->assertFeatureEnabled()) {
            return $err;
        }

        try {
            $surveys = MunicipalSurveyService::getActiveSurveys($tenantId);
            return $this->respondWithData($surveys);
        } catch (RuntimeException $e) {
            return $this->respondWithError('SERVICE_ERROR', $e->getMessage(), null, 503);
        }
    }

    /**
     * Return a single survey with its questions.
     * Authentication is enforced at the route boundary.
     */
    public function getSurvey(int $id): JsonResponse
    {
        $tenantId = TenantContext::getId();

        if ($err = $this->assertFeatureEnabled()) {
            return $err;
        }

        $survey = MunicipalSurveyService::getSurveyById($id, $tenantId);

        if ($survey === null) {
            return $this->respondWithError('NOT_FOUND', __('api.not_found'), null, 404);
        }

        // Only expose active/closed surveys to members — admins use the admin endpoint
        if (! in_array($survey['status'], ['active', 'closed'], true)) {
            return $this->respondWithError('NOT_FOUND', __('api.not_found'), null, 404);
        }

        return $this->respondWithData($survey);
    }

    /**
     * Submit a response to a survey.
     * Requires authentication.
     *
     * Body: { "answers": { "<question_id>": <value_or_array> } }
     */
    public function submitSurvey(int $id): JsonResponse
    {
        $userId   = $this->requireAuth();
        $tenantId = TenantContext::getId();

        if ($err = $this->assertFeatureEnabled()) {
            return $err;
        }

        $input = $this->getAllInput();

        $validator = Validator::make($input, [
            'answers'   => 'required|array',
        ]);

        if ($validator->fails()) {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                __('api.validation_failed'),
                $validator->errors()->toArray(),
                422
            );
        }

        // Keyed IP hash (HMAC) — never stored in plain text or as a bare sha256
        $ipHash = MunicipalSurveyService::hashIp((string) request()->ip());

        try {
            MunicipalSurveyService::submitResponse(
                $id,
                $tenantId,
                $userId,
                (array) ($input['answers'] ?? []),
                $ipHash
            );
            return $this->respondWithData(['ok' => true]);
        } catch (InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        } catch (RuntimeException $e) {
            return $this->respondWithError('SUBMIT_ERROR', $e->getMessage(), null, 422);
        }
    }

    // =========================================================================
    // Admin-facing
    // =========================================================================

    /**
     * List all surveys for the tenant with optional status filter.
     * Admin only.
     */
    public function adminListSurveys(): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = TenantContext::getId();

        if (! $this->hasAnnouncerAccess($userId, $tenantId)) {
            return $this->respondWithError('FORBIDDEN', __('api.forbidden'), null, 403);
        }

        if ($err = $this->assertFeatureEnabled()) {
            return $err;
        }

        $status = request()->query('status');
        if ($status !== null && ! in_array($status, ['draft', 'active', 'closed'], true)) {
            $status = null;
        }

        $surveys = MunicipalSurveyService::listSurveys($tenantId, $status ?: null);
        return $this->respondWithData($surveys);
    }

    /**
     * Return a survey with questions + analytics for the admin.
     */
    public function adminGetSurvey(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = TenantContext::getId();

        if (! $this->hasAnnouncerAccess($userId, $tenantId)) {
            return $this->respondWithError('FORBIDDEN', __('api.forbidden'), null, 403);
        }

        if ($err = $this->assertFeatureEnabled()) {
            return $err;
        }

        $survey = MunicipalSurveyService::getSurveyById($id, $tenantId);

        if ($survey === null) {
            return $this->respondWithError('NOT_FOUND', __('api.not_found'), null, 404);
        }

        try {
            $survey['analytics'] = MunicipalSurveyService::getAnalytics($id, $tenantId);
        } catch (RuntimeException) {
            $survey['analytics'] = null;
        }

        return $this->respondWithData($survey);
    }

    /**
     * Create a new survey (draft).
     * Requires admin or municipality_announcer.
     *
     * Body: {
     *   title, description?, is_anonymous, starts_at?, ends_at?,
     *   questions?: [{question_text, question_type, options?, is_required, sort_order}]
     * }
     */
    public function adminCreateSurvey(): JsonResponse
    {
        $userId   = $this->requireAuth();
        $tenantId = TenantContext::getId();

        if ($err = $this->assertFeatureEnabled()) {
            return $err;
        }

        if (! $this->hasAnnouncerAccess($userId, $tenantId)) {
            return $this->respondWithError('FORBIDDEN', __('api.forbidden'), null, 403);
        }

        $input = $this->getAllInput();

        $validator = Validator::make($input, [
            'title'                         => 'required|string|max:255',
            'description'                   => 'nullable|string',
            'is_anonymous'                  => 'nullable|boolean',
            'starts_at'                     => 'nullable|date',
            'ends_at'                       => 'nullable|date',
            'questions'                     => 'nullable|array',
            'questions.*.question_text'     => 'required_with:questions|string|max:500',
            'questions.*.question_type'     => 'required_with:questions|in:single_choice,multi_choice,likert,open_text,yes_no',
            'questions.*.options'           => 'nullable|array',
            'questions.*.is_required'       => 'nullable|boolean',
            'questions.*.sort_order'        => 'nullable|integer',
        ]);

        if ($validator->fails()) {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                __('api.validation_failed'),
                $validator->errors()->toArray(),
                422
            );
        }

        try {
            $survey = MunicipalSurveyService::createSurvey($tenantId, $userId, $input);
            return $this->respondWithData($survey, null, 201);
        } catch (InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        } catch (RuntimeException $e) {
            return $this->respondWithError('SERVICE_ERROR', $e->getMessage(), null, 503);
        }
    }

    /**
     * Update a draft survey (replaces questions when provided).
     * Requires admin or municipality_announcer.
     */
    public function adminUpdateSurvey(int $id): JsonResponse
    {
        $userId   = $this->requireAuth();
        $tenantId = TenantContext::getId();

        if ($err = $this->assertFeatureEnabled()) {
            return $err;
        }

        if (! $this->hasAnnouncerAccess($userId, $tenantId)) {
            return $this->respondWithError('FORBIDDEN', __('api.forbidden'), null, 403);
        }

        // Only allow updating drafts
        $survey = MunicipalSurveyService::getSurveyById($id, $tenantId);
        if ($survey === null) {
            return $this->respondWithError('NOT_FOUND', __('api.not_found'), null, 404);
        }
        if ($survey['status'] !== 'draft') {
            return $this->respondWithError(
                'INVALID_STATE',
                'Only draft surveys can be updated',
                null,
                422
            );
        }

        $input = $this->getAllInput();

        $validator = Validator::make($input, [
            'title'                         => 'nullable|string|max:255',
            'description'                   => 'nullable|string',
            'is_anonymous'                  => 'nullable|boolean',
            'starts_at'                     => 'nullable|date',
            'ends_at'                       => 'nullable|date',
            'questions'                     => 'nullable|array',
            'questions.*.question_text'     => 'required_with:questions|string|max:500',
            'questions.*.question_type'     => 'required_with:questions|in:single_choice,multi_choice,likert,open_text,yes_no',
            'questions.*.options'           => 'nullable|array',
            'questions.*.is_required'       => 'nullable|boolean',
            'questions.*.sort_order'        => 'nullable|integer',
        ]);

        if ($validator->fails()) {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                __('api.validation_failed'),
                $validator->errors()->toArray(),
                422
            );
        }

        try {
            $updated = MunicipalSurveyService::updateSurvey($id, $tenantId, $input);
            return $this->respondWithData($updated);
        } catch (RuntimeException $e) {
            return $this->respondWithError('SERVICE_ERROR', $e->getMessage(), null, 503);
        }
    }

    /**
     * Publish a draft survey (draft → active).
     * Requires admin or municipality_announcer.
     */
    public function adminPublishSurvey(int $id): JsonResponse
    {
        $userId   = $this->requireAuth();
        $tenantId = TenantContext::getId();

        if ($err = $this->assertFeatureEnabled()) {
            return $err;
        }

        if (! $this->hasAnnouncerAccess($userId, $tenantId)) {
            return $this->respondWithError('FORBIDDEN', __('api.forbidden'), null, 403);
        }

        try {
            MunicipalSurveyService::publishSurvey($id, $tenantId);
            return $this->respondWithData(['ok' => true]);
        } catch (RuntimeException $e) {
            return $this->respondWithError('SERVICE_ERROR', $e->getMessage(), null, 422);
        }
    }

    /**
     * Close an active survey (active → closed).
     * Requires admin or municipality_announcer.
     */
    public function adminCloseSurvey(int $id): JsonResponse
    {
        $userId   = $this->requireAuth();
        $tenantId = TenantContext::getId();

        if ($err = $this->assertFeatureEnabled()) {
            return $err;
        }

        if (! $this->hasAnnouncerAccess($userId, $tenantId)) {
            return $this->respondWithError('FORBIDDEN', __('api.forbidden'), null, 403);
        }

        try {
            MunicipalSurveyService::closeSurvey($id, $tenantId);
            return $this->respondWithData(['ok' => true]);
        } catch (RuntimeException $e) {
            return $this->respondWithError('SERVICE_ERROR', $e->getMessage(), null, 422);
        }
    }

    /**
     * Export survey responses as a CSV download.
     * Requires admin or municipality_announcer.
     *
     * @return \Illuminate\Http\Response|JsonResponse
     */
    public function adminExportCsv(int $id): Response|JsonResponse
    {
        $userId   = $this->requireAuth();
        $tenantId = TenantContext::getId();

        if (! TenantContext::hasFeature('caring_community')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }
        if (! MunicipalSurveyService::isAvailable()) {
            return $this->respondWithError('SERVICE_UNAVAILABLE', __('api.service_unavailable'), null, 503);
        }

        if (! $this->hasAnnouncerAccess($userId, $tenantId)) {
            return $this->respondWithError('FORBIDDEN', __('api.forbidden'), null, 403);
        }

        try {
            $csv = MunicipalSurveyService::exportCsv($id, $tenantId);
        } catch (RuntimeException $e) {
            return $this->respondWithError('SERVICE_ERROR', $e->getMessage(), null, 404);
        }

        return response($csv, 200, [
            'Content-Type'        => 'text/csv',
            'Content-Disposition' => 'attachment; filename="survey-' . $id . '-responses.csv"',
        ]);
    }
}
