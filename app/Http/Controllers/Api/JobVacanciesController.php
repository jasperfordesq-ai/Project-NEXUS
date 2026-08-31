<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Exceptions\SafeguardingPolicyException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Storage;
use App\Models\JobApplication;
use App\Models\JobOffer;
use App\Services\AiChatService;
use App\Services\JobGdprService;
use App\Services\JobInterviewService;
use App\Services\JobOfferService;
use App\Services\JobReferralService;
use App\Services\JobSavedProfileService;
use App\Services\JobScorecardService;
use App\Services\JobTeamService;
use App\Services\JobPipelineRuleService;
use App\Services\JobVacancyService;
use App\Services\JobTemplateService;
use App\Services\SalaryBenchmarkService;
use App\Services\CandidateSearchService;
use App\Services\JobInterviewSchedulingService;
use App\Services\JobConfigurationService;
use App\Core\EmailTemplateBuilder;
use App\Core\Mailer;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Http\Requests\Jobs\ListJobVacanciesRequest;
use App\Http\Resources\PublicJobResource;
use App\Models\JobVacancyTeam;
use App\Models\JobVacancy;
use App\Models\Review;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * JobVacanciesController — Community job vacancy listings.
 *
 * Core CRUD uses Eloquent via JobVacancyService. All remaining endpoints
 * now call legacy JobVacancyService static methods directly instead of
 * ob_start() delegation.
 */
class JobVacanciesController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly JobVacancyService $jobService,
        private readonly AiChatService $aiService,
        private readonly CandidateSearchService $candidateService,
        private readonly JobInterviewSchedulingService $schedulingService,
    ) {}

    /**
     * Ensure the job_vacancies feature is enabled.
     */
    private function ensureFeature(): void
    {
        if (!TenantContext::hasFeature('job_vacancies')) {
            throw new \Illuminate\Http\Exceptions\HttpResponseException(
                $this->respondWithError('FEATURE_DISABLED', __('api.job_feature_disabled'), null, 403)
            );
        }
    }

    private function configBool(string $key, bool $default): bool
    {
        $value = JobConfigurationService::get($key, $default);
        if (is_bool($value)) {
            return $value;
        }

        return filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) ?? $default;
    }

    private function rejectIfJobConfigDisabled(string $key, string $messageKey): ?JsonResponse
    {
        if ($this->configBool($key, true)) {
            return null;
        }

        return $this->respondWithError('FEATURE_DISABLED', __("api.{$messageKey}"), null, 403);
    }

    private function findTenantVacancy(int $vacancyId): ?JobVacancy
    {
        return JobVacancy::where('tenant_id', TenantContext::getId())
            ->where('id', $vacancyId)
            ->first();
    }

    private function canManageVacancy(JobVacancy $vacancy, int $userId): bool
    {
        if ((int) $vacancy->user_id === $userId) {
            return true;
        }

        $tenantId = TenantContext::getId();
        $user = User::where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->first(['id', 'role', 'is_admin', 'is_super_admin', 'is_tenant_super_admin', 'is_god']);

        if ($user) {
            $role = (string) ($user->role ?? '');
            if (in_array($role, ['admin', 'tenant_admin', 'super_admin', 'god'], true)
                || (bool) ($user->is_admin ?? false)
                || (bool) ($user->is_super_admin ?? false)
                || (bool) ($user->is_tenant_super_admin ?? false)
                || (bool) ($user->is_god ?? false)
            ) {
                return true;
            }
        }

        return JobVacancyTeam::where('tenant_id', $tenantId)
            ->where('vacancy_id', $vacancy->id)
            ->where('user_id', $userId)
            ->exists();
    }

    private function canSearchTalent(int $userId): bool
    {
        $tenantId = TenantContext::getId();
        $user = User::where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->first(['id', 'role', 'is_admin', 'is_super_admin', 'is_tenant_super_admin', 'is_god']);

        if ($user) {
            $role = (string) ($user->role ?? '');
            if (in_array($role, ['admin', 'tenant_admin', 'super_admin', 'god'], true)
                || (bool) ($user->is_admin ?? false)
                || (bool) ($user->is_super_admin ?? false)
                || (bool) ($user->is_tenant_super_admin ?? false)
                || (bool) ($user->is_god ?? false)
            ) {
                return true;
            }
        }

        return JobVacancy::where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->exists();
    }

    private function rejectIfCannotManageVacancy(int $vacancyId, int $userId): ?JsonResponse
    {
        $vacancy = $this->findTenantVacancy($vacancyId);
        if (!$vacancy) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.job_vacancy_not_found'), null, 404);
        }

        if (!$this->canManageVacancy($vacancy, $userId)) {
            return $this->respondWithError('RESOURCE_FORBIDDEN', __('api.job_access_denied'), null, 403);
        }

        return null;
    }

    private function isVacancyPubliclyVisible(JobVacancy $vacancy): bool
    {
        $moderationStatus = $vacancy->moderation_status ?? null;

        return $vacancy->status === 'open'
            && ($vacancy->deadline === null || $vacancy->deadline->copy()->endOfDay()->isFuture())
            && ($moderationStatus === null || $moderationStatus === 'approved');
    }

    // =====================================================================
    // CORE CRUD (Eloquent via JobVacancyService)
    // =====================================================================

    /** GET /api/v2/jobs — list jobs with filters + cursor pagination */
    public function index(ListJobVacanciesRequest $request): JsonResponse
    {
        $this->ensureFeature();
        $this->rateLimit('jobs_list', 60, 60);

        $userId = $this->getOptionalUserId();

        $filters = [
            'limit' => $this->queryInt('per_page', 20, 1, 100),
            'public_only' => true,
        ];

        $validStatuses = ['open'];
        $validTypes = ['paid', 'volunteer', 'timebank'];
        $validCommitments = ['full_time', 'part_time', 'one_off', 'flexible'];

        if ($this->query('status') && in_array($this->query('status'), $validStatuses, true)) {
            $filters['status'] = $this->query('status');
        }
        if ($this->query('type') && in_array($this->query('type'), $validTypes, true)) {
            $filters['type'] = $this->query('type');
        }
        if ($this->query('commitment') && in_array($this->query('commitment'), $validCommitments, true)) {
            $filters['commitment'] = $this->query('commitment');
        }
        if ($this->query('category')) {
            $filters['category'] = $this->query('category');
        }
        if ($this->query('search')) {
            $filters['search'] = $this->query('search');
        }
        if ($this->query('user_id')) {
            $filters['user_id'] = $this->queryInt('user_id');
        }
        if ($this->query('cursor')) {
            $filters['cursor'] = $this->query('cursor');
        }
        if ($this->query('featured')) {
            $filters['featured'] = $this->queryBool('featured');
        }
        if ($this->query('latitude') !== null) {
            $lat = (float) $this->query('latitude');
            if ($lat >= -90 && $lat <= 90) {
                $filters['latitude'] = $lat;
            }
        }
        if ($this->query('longitude') !== null) {
            $lng = (float) $this->query('longitude');
            if ($lng >= -180 && $lng <= 180) {
                $filters['longitude'] = $lng;
            }
        }
        if ($this->query('radius_km') !== null) {
            $filters['radius_km'] = max(0.1, min(500, (float) $this->query('radius_km')));
        }
        if ($this->query('is_remote')) {
            $filters['is_remote'] = true;
        }
        if ($this->query('organization_id')) {
            $filters['organization_id'] = $this->queryInt('organization_id');
        }
        if ($this->query('exclude')) {
            $filters['exclude'] = $this->queryInt('exclude');
        }

        $validSorts = ['newest', 'deadline', 'salary_desc'];
        if ($this->query('sort') && in_array($this->query('sort'), $validSorts, true)) {
            $filters['sort'] = $this->query('sort');
        }

        $result = $this->jobService->getAll($filters, $userId);

        $extraMeta = [];
        if (isset($result['total'])) {
            $extraMeta['total'] = (int) $result['total'];
        }

        return $this->respondWithCollection(
            array_map(static fn (array $job): array => PublicJobResource::augment($job), $result['items']),
            $result['cursor'],
            $filters['limit'],
            $result['has_more'],
            $extraMeta
        );
    }

    /** GET /api/v2/jobs/{id} — single job vacancy */
    public function show($id): JsonResponse
    {
        $this->ensureFeature();
        $this->rateLimit('jobs_show', 60, 60);

        $userId = $this->getOptionalUserId();

        $vacancy = $this->findTenantVacancy((int) $id);
        if (!$vacancy) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.job_vacancy_not_found'), null, 404);
        }

        if (!$this->isVacancyPubliclyVisible($vacancy)
            && (!$userId || !$this->canManageVacancy($vacancy, $userId))
        ) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.job_vacancy_not_found'), null, 404);
        }

        $job = $this->jobService->legacyGetById($id, $userId);

        // Increment views
        $this->jobService->incrementViews($id, $userId);

        return $this->respondWithData($job ? PublicJobResource::augment($job) : $job);
    }

    /** POST /api/v2/jobs — create a new job vacancy */
    public function store(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('jobs_create', 5, 60);

        $data = $this->getAllInput();

        // Validate required fields before calling service
        $title = trim($data['title'] ?? '');
        if (empty($title)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.title_required'), 'title', 422);
        }
        $description = trim($data['description'] ?? '');
        if (empty($description)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.description_required'), 'description', 422);
        }

        try {
            $jobId = $this->jobService->create($userId, $data);
        } catch (\Throwable $e) {
            return $this->respondWithErrors([['code' => 'SERVER_INTERNAL_ERROR', 'message' => __('api.job_create_failed')]], 500);
        }

        if (!$jobId) {
            $errors = $this->jobService->getErrors();
            return $this->respondWithErrors($errors ?: [['code' => 'SERVER_INTERNAL_ERROR', 'message' => __('api.job_create_failed')]], 422);
        }

        $job = $this->jobService->getById($jobId);

        // Include moderation notice if job was flagged or requires review (Agent B)
        $meta = null;
        if ($job && isset($job['moderation_status'])) {
            if ($job['moderation_status'] === 'pending_review') {
                $meta = ['notice' => __('api.job_pending_review_notice')];
            } elseif ($job['moderation_status'] === 'rejected') {
                $meta = ['notice' => __('api.job_rejected_notice')];
            }
        }

        return $this->respondWithData($job, $meta, 201);
    }

    /** PUT /api/v2/jobs/{id} — update a job vacancy */
    public function update($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('jobs_update', 10, 60);

        $data = $this->getAllInput();

        $success = $this->jobService->update((int) $id, $userId, $data);

        if (!$success) {
            $errors = $this->jobService->getErrors();
            $status = 422;

            foreach ($errors as $error) {
                if ($error['code'] === 'RESOURCE_NOT_FOUND') {
                    $status = 404;
                    break;
                }
                if ($error['code'] === 'RESOURCE_FORBIDDEN') {
                    $status = 403;
                    break;
                }
            }

            return $this->respondWithErrors($errors, $status);
        }

        $vacancy = $this->jobService->legacyGetById((int) $id, $userId);

        return $this->respondWithData($vacancy);
    }

    /** DELETE /api/v2/jobs/{id} — delete a job vacancy */
    public function destroy($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('jobs_delete', 5, 60);

        $success = $this->jobService->delete((int) $id, $userId);

        if (!$success) {
            $errors = $this->jobService->getErrors();
            $status = 400;

            foreach ($errors as $error) {
                if ($error['code'] === 'RESOURCE_NOT_FOUND') {
                    $status = 404;
                    break;
                }
                if ($error['code'] === 'RESOURCE_FORBIDDEN') {
                    $status = 403;
                    break;
                }
            }

            return $this->respondWithErrors($errors, $status);
        }

        return $this->noContent();
    }

    /** POST /api/v2/jobs/{id}/apply — apply to a job (supports CV file upload via multipart) */
    public function apply(int $id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('jobs_apply', 5, 60);

        $tenantId = TenantContext::getId();
        $message = $this->input('message');

        if ($this->configBool(JobConfigurationService::CONFIG_REQUIRE_COVER_MESSAGE, false) && trim((string) $message) === '') {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.job_cover_message_required'), 'message', 422);
        }

        // This preflight must run before an uploaded CV is written to disk.
        // JobVacancyService repeats the assertion immediately before the
        // application insert for non-HTTP callers and race safety.
        $jobOwnerId = JobVacancy::where('tenant_id', $tenantId)
            ->where('id', $id)
            ->value('user_id');
        if ($jobOwnerId !== null && (int) $jobOwnerId !== $userId) {
            try {
                app(\App\Services\SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
                    $userId,
                    (int) $jobOwnerId,
                    $tenantId,
                    'job_application',
                );
            } catch (SafeguardingPolicyException $e) {
                return $this->safeguardingPolicyError($e);
            }
        }

        $cvPath = null;
        $cvFilename = null;
        $cvSize = null;

        if (request()->hasFile('cv')) {
            if (!$this->configBool(JobConfigurationService::CONFIG_ENABLE_CV_UPLOAD, true)) {
                return $this->respondWithError('FEATURE_DISABLED', __('api.job_cv_upload_disabled'), 'cv', 403);
            }

            $file = request()->file('cv');
            $allowed = ['pdf', 'doc', 'docx'];
            $ext = strtolower($file->getClientOriginalExtension());
            if (!in_array($ext, $allowed, true)) {
                return $this->respondWithError('VALIDATION_INVALID_VALUE', __('api.job_cv_invalid_type'), 'cv', 422);
            }
            if ($file->getSize() > 5 * 1024 * 1024) {
                return $this->respondWithError('VALIDATION_FILE_TOO_LARGE', __('api.job_cv_too_large'), 'cv', 422);
            }
            // MIME whitelist — must match extension, blocks HTML/SVG/PHP disguised as documents.
            // We deliberately drop application/octet-stream here because it is the browser
            // fallback for any unknown/unrecognised file (including .exe) and opens a hole
            // where a renamed executable would pass validation and later be opened by an
            // employer. Legitimate .doc/.docx uploads from modern browsers send the proper
            // Office MIME types; older clients can still upload PDF.
            $allowedMimes = [
                'pdf'  => ['application/pdf'],
                'doc'  => ['application/msword', 'application/vnd.ms-office'],
                'docx' => ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip'],
            ];
            $detectedMime = $file->getMimeType();
            if (!$detectedMime || !in_array($detectedMime, $allowedMimes[$ext], true)) {
                return $this->respondWithError('VALIDATION_INVALID_VALUE', __('api.job_cv_type_not_allowed'), 'cv', 422);
            }
            // Sanitize original filename: basename() to strip any path traversal, then allow only alnum/dot/dash/underscore
            $rawName = basename($file->getClientOriginalName());
            $safeName = preg_replace('/[^A-Za-z0-9._-]/', '_', $rawName) ?: 'cv';
            // Cap length and ensure extension preserved
            $safeName = substr($safeName, 0, 120);
            $cvPath = $file->store("job-applications/{$tenantId}", 'local');
            $cvFilename = $safeName;
            $cvSize = $file->getSize();
        }

        try {
            $applicationId = $this->jobService->apply($id, $userId, [
                'cover_letter' => $message,
                'cv_path' => $cvPath,
                'cv_filename' => $cvFilename,
                'cv_size' => $cvSize,
            ]);
        } catch (SafeguardingPolicyException $e) {
            if ($cvPath !== null) {
                Storage::disk('local')->delete($cvPath);
            }
            return $this->safeguardingPolicyError($e);
        }

        if ($applicationId === null) {
            // The application was rejected after the CV was already written to disk
            // (e.g. vacancy closed, already applied, ineligible). Remove the orphaned
            // upload so failed attempts don't accumulate files on the server.
            if ($cvPath !== null) {
                try {
                    \Illuminate\Support\Facades\Storage::disk('local')->delete($cvPath);
                } catch (\Throwable $e) {
                    // best-effort cleanup; never fail the request because cleanup failed
                }
            }

            $errors = $this->jobService->getErrors();
            $status = 400;

            if (empty($errors)) {
                // apply() returns null when already applied (idempotency)
                return $this->respondWithError('RESOURCE_CONFLICT', __('api.job_already_applied'), null, 409);
            }

            foreach ($errors as $error) {
                if ($error['code'] === 'RESOURCE_NOT_FOUND') {
                    $status = 404;
                    break;
                }
                if ($error['code'] === 'RESOURCE_CONFLICT') {
                    $status = 409;
                    break;
                }
                if ($error['code'] === 'RESOURCE_FORBIDDEN') {
                    $status = 403;
                    break;
                }
            }

            return $this->respondWithErrors($errors, $status);
        }

        $vacancy = $this->jobService->legacyGetById($id, $userId);

        // Initialise $job — it is populated inside the try blocks below, so the
        // later poster-email block must not read it undefined if a lookup throws.
        $job = null;

        // Notify vacancy owner of new application
        try {
            $job = DB::selectOne(
                'SELECT user_id, title FROM job_vacancies WHERE id = ? AND tenant_id = ?',
                [$id, $tenantId]
            );
            if ($job && (int) $job->user_id !== $userId) {
                $applicant = \App\Models\User::find($userId);
                $jobOwner = \App\Models\User::find((int) $job->user_id);
                LocaleContext::withLocale($jobOwner, function () use ($applicant, $job, $id) {
                    $applicantName = $applicant->first_name ?? $applicant->name ?? __('emails.common.fallback_someone');
                    \App\Models\Notification::createNotification(
                        (int) $job->user_id,
                        __('svc_notifications.job_application.owner_applied', [
                            'name' => $applicantName,
                            'title' => $job->title,
                        ]),
                        "/jobs/{$id}#applications",
                        'job_application'
                    );
                    \App\Services\NotificationDispatcher::fanOutPush(
                        (int) ($job->user_id),
                        'job_application',
                        __('svc_notifications.job_application.owner_applied', [
                            'name' => $applicantName,
                            'title' => $job->title,
                        ]),
                        "/jobs/{$id}#applications"
                    );
                });
            }
        } catch (\Throwable $e) {
            \Log::warning('Job application notification failed', ['vacancy_id' => $id, 'error' => $e->getMessage()]);
        }

        // Email confirmation to applicant
        try {
            $job = $job ?? DB::selectOne(
                'SELECT user_id, title FROM job_vacancies WHERE id = ? AND tenant_id = ?',
                [$id, $tenantId]
            );
            if ($job) {
                $applicantUser = DB::table('users')
                    ->where('id', $userId)
                    ->where('tenant_id', $tenantId)
                    ->select(['email', 'first_name', 'name', 'preferred_language'])
                    ->first();
                if ($applicantUser && !empty($applicantUser->email)) {
                    LocaleContext::withLocale($applicantUser, function () use ($applicantUser, $job, $id, $tenantId) {
                        $firstName = $applicantUser->first_name ?? $applicantUser->name ?? __('emails.common.fallback_name');
                        $community = TenantContext::getName();
                        $jobTitle  = htmlspecialchars($job->title, ENT_QUOTES, 'UTF-8');
                        $appUrl    = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . '/jobs/' . $id;
                        $html = EmailTemplateBuilder::make()
                            ->theme('brand')
                            ->title(__('emails_commerce.job_application_applicant.title'))
                            ->greeting($firstName)
                            ->paragraph(__('emails_commerce.job_application_applicant.body', ['job_title' => $jobTitle]))
                            ->paragraph(__('emails_commerce.job_application_applicant.next_steps'))
                            ->button(__('emails_commerce.job_application_applicant.cta'), $appUrl)
                            ->render();
                        if (!\App\Services\EmailDispatchService::sendRaw(
                            $applicantUser->email,
                            __('emails_commerce.job_application_applicant.subject', ['job_title' => $jobTitle, 'community' => $community]),
                            $html,
                            null,
                            null,
                            null,
                            'job_application',
                            ['tenant_id' => $tenantId]
                        )) {
                            Log::warning('[JobVacanciesController] applicant confirmation email returned false', [
                                'job_id' => $id,
                                'user_id' => $applicantUser->id ?? null,
                            ]);
                        }
                    });
                }
            }
        } catch (\Throwable $e) {
            Log::warning('[JobVacanciesController] applicant confirmation email failed: ' . $e->getMessage());
        }

        // Email alert to job poster / employer
        try {
            if ($job && (int) $job->user_id !== $userId) {
                $posterUser = DB::table('users')
                    ->where('id', $job->user_id)
                    ->where('tenant_id', $tenantId)
                    ->select(['email', 'first_name', 'name', 'preferred_language'])
                    ->first();
                if ($posterUser && !empty($posterUser->email)) {
                    $applicant = $applicant ?? \App\Models\User::find($userId);
                    LocaleContext::withLocale($posterUser, function () use ($posterUser, $applicant, $job, $id, $tenantId) {
                        $posterFirst   = $posterUser->first_name ?? $posterUser->name ?? __('emails.common.fallback_name');
                        $community     = TenantContext::getName();
                        $jobTitle      = htmlspecialchars($job->title, ENT_QUOTES, 'UTF-8');
                        $applicantName = $applicant
                            ? UserDisplayName::resolve($applicant) ?: ($applicant->name ?? __('emails.common.fallback_someone'))
                            : __('emails.common.fallback_someone');
                        $reviewUrl = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . '/jobs/' . $id . '#applications';
                        $html = EmailTemplateBuilder::make()
                            ->theme('federation')
                            ->title(__('emails_commerce.job_application_employer.title'))
                            ->greeting($posterFirst)
                            ->paragraph(__('emails_commerce.job_application_employer.body', ['applicant_name' => htmlspecialchars($applicantName, ENT_QUOTES, 'UTF-8'), 'job_title' => $jobTitle]))
                            ->button(__('emails_commerce.job_application_employer.cta'), $reviewUrl)
                            ->render();
                        if (!\App\Services\EmailDispatchService::sendRaw(
                            $posterUser->email,
                            __('emails_commerce.job_application_employer.subject', ['job_title' => $jobTitle, 'community' => $community]),
                            $html,
                            null,
                            null,
                            null,
                            'job_application',
                            ['tenant_id' => $tenantId]
                        )) {
                            Log::warning('[JobVacanciesController] employer alert email returned false', [
                                'job_id' => $id,
                                'user_id' => $posterUser->id ?? null,
                            ]);
                        }
                    });
                }
            }
        } catch (\Throwable $e) {
            Log::warning('[JobVacanciesController] employer alert email failed: ' . $e->getMessage());
        }

        return $this->respondWithData($vacancy, null, 201);
    }

    /** GET /api/v2/jobs/applications/{id}/cv — download CV for an application */
    public function downloadCv(int $applicationId): \Symfony\Component\HttpFoundation\BinaryFileResponse|JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('jobs_cv_download', 20, 60);

        $tenantId = TenantContext::getId();

        $application = JobApplication::with(['vacancy'])->find($applicationId);

        if (!$application || !$application->vacancy || (int) $application->vacancy->tenant_id !== $tenantId) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.job_application_not_found'), null, 404);
        }

        // Only allow: the applicant themselves, the job poster, or an admin
        $isApplicant = (int) $application->user_id === $userId;
        $isPoster = $application->vacancy && (int) $application->vacancy->user_id === $userId;

        if (!$isApplicant && !$isPoster) {
            $user = \App\Models\User::where('id', $userId)->first(['id', 'role']);
            $isAdmin = $user && in_array($user->role, ['admin', 'super_admin', 'tenant_admin']);
            if (!$isAdmin) {
                return $this->respondWithError('RESOURCE_FORBIDDEN', __('api.job_access_denied'), null, 403);
            }
        }

        if (!$isApplicant && (bool) ($application->vacancy->blind_hiring ?? false)) {
            return $this->respondWithError('RESOURCE_FORBIDDEN', __('api.job_access_denied'), null, 403);
        }

        if (empty($application->cv_path)) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.job_no_cv_attached'), null, 404);
        }

        if (!Storage::disk('local')->exists($application->cv_path)) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.job_cv_file_not_found'), null, 404);
        }

        $filename = preg_replace('/[^a-zA-Z0-9._\- ]/', '_', $application->cv_filename ?? basename($application->cv_path));

        return response()->download(
            Storage::disk('local')->path($application->cv_path),
            $filename
        );
    }

    /** GET /api/v2/jobs/recommended — recommended jobs for the authenticated user */
    public function recommended(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('jobs_recommended', 30, 60);

        $limit = min((int) ($this->query('limit', 10)), 20);
        $jobs = $this->jobService->getRecommended($userId, $limit);

        return $this->respondWithData($jobs);
    }

    // =====================================================================
    // SAVED JOBS (J1)
    // =====================================================================

    /** GET /api/v2/jobs/saved */
    public function savedJobs(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('jobs_saved_list', 30, 60);

        $filters = [
            'limit' => $this->queryInt('per_page', 20, 1, 100),
        ];
        if ($this->query('cursor')) {
            $filters['cursor'] = $this->query('cursor');
        }

        $result = $this->jobService->getSavedJobs($userId, $filters);

        return $this->respondWithCollection(
            $result['items'],
            $result['cursor'],
            $filters['limit'],
            $result['has_more']
        );
    }

    /** POST /api/v2/jobs/{id}/save */
    public function saveJob($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('jobs_save', 30, 60);

        $success = $this->jobService->saveJob((int) $id, $userId);

        if (!$success) {
            $errors = $this->jobService->getErrors();
            return $this->respondWithErrors($errors, 400);
        }

        return $this->respondWithData(['message' => __('api.job_saved'), 'is_saved' => true], null, 201);
    }

    /** DELETE /api/v2/jobs/{id}/save */
    public function unsaveJob($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('jobs_unsave', 30, 60);

        $this->jobService->unsaveJob((int) $id, $userId);

        return $this->respondWithData(['message' => __('api.job_removed_from_saved'), 'is_saved' => false]);
    }

    // =====================================================================
    // MY APPLICATIONS & MY POSTINGS
    // =====================================================================

    /** GET /api/v2/jobs/my-applications */
    public function myApplications(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('jobs_my_apps', 30, 60);

        $filters = [
            'limit' => $this->queryInt('per_page', 20, 1, 100),
        ];

        if ($this->query('status')) {
            $filters['status'] = $this->query('status');
        }
        if ($this->query('cursor')) {
            $filters['cursor'] = $this->query('cursor');
        }

        $result = $this->jobService->getMyApplications($userId, $filters);

        return $this->respondWithData([
            'items' => $result['items'],
            'cursor' => $result['cursor'],
            'has_more' => $result['has_more'],
        ]);
    }

    /** GET /api/v2/jobs/my-postings */
    public function myPostings(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('jobs_my_postings', 30, 60);

        $tenantId = TenantContext::getId();

        $params = [
            'limit' => $this->queryInt('per_page', 20, 1, 50),
        ];

        if ($this->query('cursor')) {
            $params['cursor'] = $this->query('cursor');
        }

        $result = $this->jobService->getMyPostings($userId, $tenantId, $params);

        return $this->respondWithCollection(
            $result['items'],
            $result['cursor'],
            $params['limit'],
            $result['has_more']
        );
    }

    // =====================================================================
    // JOB ALERTS (J6)
    // =====================================================================

    /** GET /api/v2/jobs/alerts */
    public function listAlerts(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('jobs_alerts_list', 30, 60);

        $alerts = $this->jobService->getAlerts($userId);

        return $this->respondWithData($alerts);
    }

    /** POST /api/v2/jobs/alerts */
    public function createAlert(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('jobs_alerts_create', 5, 60);

        $data = $this->getAllInput();

        $alertId = $this->jobService->subscribeAlert($userId, $data);

        if ($alertId === null) {
            $errors = $this->jobService->getErrors();
            return $this->respondWithErrors($errors, 422);
        }

        return $this->respondWithData([
            'id' => $alertId,
            'message' => __('api.job_alert_created'),
        ], null, 201);
    }

    /** DELETE /api/v2/jobs/alerts/{id} */
    public function deleteAlert($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('jobs_alerts_delete', 10, 60);

        $this->jobService->deleteAlert((int) $id, $userId);

        return $this->noContent();
    }

    /** PUT /api/v2/jobs/alerts/{id}/unsubscribe */
    public function unsubscribeAlert($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('jobs_alerts_unsub', 10, 60);

        $this->jobService->unsubscribeAlert((int) $id, $userId);

        return $this->respondWithData(['message' => __('api.alert_unsubscribed')]);
    }

    /** PUT /api/v2/jobs/alerts/{id}/resubscribe */
    public function resubscribeAlert($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('jobs_alerts_resub', 10, 60);

        $this->jobService->resubscribeAlert((int) $id, $userId);

        return $this->respondWithData(['message' => __('api.alert_resubscribed')]);
    }

    // =====================================================================
    // SKILLS MATCHING (J2) & QUALIFICATION (J5)
    // =====================================================================

    /** GET /api/v2/jobs/{id}/match */
    public function matchPercentage($id): JsonResponse
    {
        $this->ensureFeature();
        if ($response = $this->rejectIfJobConfigDisabled(JobConfigurationService::CONFIG_ENABLE_SKILLS_MATCHING, 'job_skills_matching_disabled')) {
            return $response;
        }
        $userId = $this->getUserId();
        $this->rateLimit('jobs_match', 30, 60);

        $result = $this->jobService->calculateMatchPercentage($userId, (int) $id);

        return $this->respondWithData($result);
    }

    /** GET /api/v2/jobs/{id}/qualified */
    public function qualificationAssessment($id): JsonResponse
    {
        $this->ensureFeature();
        if ($response = $this->rejectIfJobConfigDisabled(JobConfigurationService::CONFIG_ENABLE_SKILLS_MATCHING, 'job_skills_matching_disabled')) {
            return $response;
        }
        $userId = $this->getUserId();
        $this->rateLimit('jobs_qualified', 20, 60);

        $result = $this->jobService->getQualificationAssessment($userId, (int) $id);

        if ($result === null) {
            $errors = $this->jobService->getErrors();
            return $this->respondWithErrors($errors, 404);
        }

        return $this->respondWithData($result);
    }

    // =====================================================================
    // APPLICATIONS MANAGEMENT
    // =====================================================================

    /** GET /api/v2/jobs/{id}/applications */
    public function applications($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('jobs_applications', 30, 60);

        $applications = $this->jobService->getApplications((int) $id, $userId);

        if ($applications === null) {
            $errors = $this->jobService->getErrors();
            $status = 400;

            foreach ($errors as $error) {
                if ($error['code'] === 'RESOURCE_NOT_FOUND') {
                    $status = 404;
                    break;
                }
                if ($error['code'] === 'RESOURCE_FORBIDDEN') {
                    $status = 403;
                    break;
                }
            }

            return $this->respondWithErrors($errors, $status);
        }

        return $this->respondWithData($applications);
    }

    /** PUT /api/v2/jobs/applications/{id} */
    public function updateApplication($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('jobs_app_update', 10, 60);

        $status = $this->input('status');
        $notes = $this->input('notes');

        if (empty($status)) {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.job_status_required'), 'status', 400);
        }

        try {
            $success = $this->jobService->updateApplicationStatus((int) $id, $userId, $status, $notes);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        if (!$success) {
            $errors = $this->jobService->getErrors();
            $httpStatus = 400;

            foreach ($errors as $error) {
                if ($error['code'] === 'RESOURCE_NOT_FOUND') {
                    $httpStatus = 404;
                    break;
                }
                if ($error['code'] === 'RESOURCE_FORBIDDEN') {
                    $httpStatus = 403;
                    break;
                }
            }

            return $this->respondWithErrors($errors, $httpStatus);
        }

        return $this->respondWithData(['message' => __('api.application_updated')]);
    }

    /** GET /api/v2/jobs/applications/{id}/history */
    public function applicationHistory($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('jobs_app_history', 30, 60);

        $history = $this->jobService->getApplicationHistory((int) $id, $userId);

        if ($history === null) {
            $errors = $this->jobService->getErrors();
            $httpStatus = 400;
            foreach ($errors as $error) {
                if ($error['code'] === 'RESOURCE_NOT_FOUND') {
                    $httpStatus = 404;
                    break;
                }
                if ($error['code'] === 'RESOURCE_FORBIDDEN') {
                    $httpStatus = 403;
                    break;
                }
            }
            return $this->respondWithErrors($errors, $httpStatus);
        }

        return $this->respondWithData($history);
    }

    // =====================================================================
    // ANALYTICS & FEATURED (J8, J10)
    // =====================================================================

    /** GET /api/v2/jobs/{id}/analytics */
    public function analytics($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('jobs_analytics', 20, 60);

        $analytics = $this->jobService->getAnalytics((int) $id, $userId);

        if ($analytics === null) {
            $errors = $this->jobService->getErrors();
            $httpStatus = 400;
            foreach ($errors as $error) {
                if ($error['code'] === 'RESOURCE_NOT_FOUND') {
                    $httpStatus = 404;
                    break;
                }
                if ($error['code'] === 'RESOURCE_FORBIDDEN') {
                    $httpStatus = 403;
                    break;
                }
            }
            return $this->respondWithErrors($errors, $httpStatus);
        }

        return $this->respondWithData($analytics);
    }

    /** POST /api/v2/jobs/{id}/renew */
    public function renewJob($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $this->rateLimit('jobs_renew', 5, 60);

        $days = $this->input('days') ?? 30;
        $days = max(1, min(90, (int) $days));

        $success = $this->jobService->renewJob((int) $id, $userId, $days);

        if (!$success) {
            $errors = $this->jobService->getErrors();
            $httpStatus = 400;
            foreach ($errors as $error) {
                if ($error['code'] === 'RESOURCE_NOT_FOUND') {
                    $httpStatus = 404;
                    break;
                }
                if ($error['code'] === 'RESOURCE_FORBIDDEN') {
                    $httpStatus = 403;
                    break;
                }
            }
            return $this->respondWithErrors($errors, $httpStatus);
        }

        $vacancy = $this->jobService->legacyGetById((int) $id, $userId);

        return $this->respondWithData($vacancy);
    }

    /** POST /api/v2/jobs/{id}/feature */
    public function featureJob($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAdmin();
        $this->rateLimit('jobs_feature', 10, 60);

        $days = $this->input('days') ?? JobConfigurationService::get(JobConfigurationService::CONFIG_FEATURED_DURATION_DAYS, 7);
        $days = max(1, min(30, (int) $days));

        $success = $this->jobService->featureJob((int) $id, $userId, $days);

        if (!$success) {
            $errors = $this->jobService->getErrors();
            $httpStatus = 400;
            foreach ($errors as $error) {
                if ($error['code'] === 'RESOURCE_NOT_FOUND') {
                    $httpStatus = 404;
                    break;
                }
                if ($error['code'] === 'RESOURCE_FORBIDDEN') {
                    $httpStatus = 403;
                    break;
                }
            }
            return $this->respondWithErrors($errors, $httpStatus);
        }

        $vacancy = $this->jobService->legacyGetById((int) $id, $userId);

        return $this->respondWithData($vacancy);
    }

    /** DELETE /api/v2/jobs/{id}/feature */
    public function unfeatureJob($id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAdmin();
        $this->rateLimit('jobs_unfeature', 10, 60);

        $success = $this->jobService->unfeatureJob((int) $id, $userId);

        if (!$success) {
            $errors = $this->jobService->getErrors();
            return $this->respondWithErrors($errors, 400);
        }

        $vacancy = $this->jobService->legacyGetById((int) $id, $userId);

        return $this->respondWithData($vacancy);
    }

    // =====================================================================
    // INTERVIEWS
    // =====================================================================

    /** POST /api/v2/jobs/applications/{id}/interview — propose an interview */
    public function proposeInterview(Request $request, int $applicationId): JsonResponse
    {
        $this->ensureFeature();
        if ($response = $this->rejectIfJobConfigDisabled(JobConfigurationService::CONFIG_ENABLE_INTERVIEW_SCHEDULING, 'job_interview_scheduling_disabled')) {
            return $response;
        }
        $userId = $this->getUserId();
        $this->rateLimit('jobs_interview_propose', 10, 60);

        $data = $this->getAllInput();

        if (empty($data['scheduled_at'])) {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.job_scheduled_at_required'), 'scheduled_at', 422);
        }

        try {
            $interview = JobInterviewService::propose($applicationId, $userId, $data);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        if ($interview === false) {
            return $this->respondWithError('RESOURCE_FORBIDDEN', __('api.job_interview_propose_failed'), null, 422);
        }

        return $this->respondWithData($interview, null, 201);
    }

    /** PUT /api/v2/jobs/interviews/{id}/accept — candidate accepts an interview */
    public function acceptInterview(Request $request, int $interviewId): JsonResponse
    {
        $this->ensureFeature();
        if ($response = $this->rejectIfJobConfigDisabled(JobConfigurationService::CONFIG_ENABLE_INTERVIEW_SCHEDULING, 'job_interview_scheduling_disabled')) {
            return $response;
        }
        $userId = $this->getUserId();
        $this->rateLimit('jobs_interview_accept', 10, 60);

        $notes = $this->input('notes');

        try {
            $success = JobInterviewService::accept($interviewId, $userId, $notes);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        if (!$success) {
            return $this->respondWithError('RESOURCE_FORBIDDEN', __('api.job_interview_accept_failed'), null, 422);
        }

        return $this->respondWithData(['message' => __('api.interview_accepted')]);
    }

    /** PUT /api/v2/jobs/interviews/{id}/decline — candidate declines an interview */
    public function declineInterview(Request $request, int $interviewId): JsonResponse
    {
        $this->ensureFeature();
        if ($response = $this->rejectIfJobConfigDisabled(JobConfigurationService::CONFIG_ENABLE_INTERVIEW_SCHEDULING, 'job_interview_scheduling_disabled')) {
            return $response;
        }
        $userId = $this->getUserId();
        $this->rateLimit('jobs_interview_decline', 10, 60);

        $notes = $this->input('notes');

        $success = JobInterviewService::decline($interviewId, $userId, $notes);

        if (!$success) {
            return $this->respondWithError('RESOURCE_FORBIDDEN', __('api.job_interview_decline_failed'), null, 422);
        }

        return $this->respondWithData(['message' => __('api.interview_declined')]);
    }

    /** DELETE /api/v2/jobs/interviews/{id} — employer cancels an interview */
    public function cancelInterview(Request $request, int $interviewId): JsonResponse
    {
        $this->ensureFeature();
        if ($response = $this->rejectIfJobConfigDisabled(JobConfigurationService::CONFIG_ENABLE_INTERVIEW_SCHEDULING, 'job_interview_scheduling_disabled')) {
            return $response;
        }
        $userId = $this->getUserId();
        $this->rateLimit('jobs_interview_cancel', 10, 60);

        $success = JobInterviewService::cancel($interviewId, $userId);

        if (!$success) {
            return $this->respondWithError('RESOURCE_FORBIDDEN', __('api.job_interview_cancel_failed'), null, 422);
        }

        return $this->noContent();
    }

    /** GET /api/v2/jobs/{id}/interviews — employer lists interviews for a vacancy */
    public function getInterviews(Request $request, int $vacancyId): JsonResponse
    {
        $this->ensureFeature();
        if ($response = $this->rejectIfJobConfigDisabled(JobConfigurationService::CONFIG_ENABLE_INTERVIEW_SCHEDULING, 'job_interview_scheduling_disabled')) {
            return $response;
        }
        $userId = $this->getUserId();
        $this->rateLimit('jobs_interviews_list', 30, 60);

        // Verify caller owns the vacancy or is admin
        $vacancy = \App\Models\JobVacancy::find($vacancyId);
        if (!$vacancy || (int) $vacancy->tenant_id !== TenantContext::getId()) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.job_vacancy_not_found'), null, 404);
        }
        if (!$this->canManageVacancy($vacancy, $userId)) {
            return $this->respondWithError('RESOURCE_FORBIDDEN', __('api.job_access_denied'), null, 403);
        }

        $interviews = JobInterviewService::getForVacancy($vacancyId);

        return $this->respondWithData($interviews);
    }

    /** GET /api/v2/jobs/my-interviews — candidate lists their own interviews */
    public function myInterviews(Request $request): JsonResponse
    {
        $this->ensureFeature();
        if ($response = $this->rejectIfJobConfigDisabled(JobConfigurationService::CONFIG_ENABLE_INTERVIEW_SCHEDULING, 'job_interview_scheduling_disabled')) {
            return $response;
        }
        $userId = $this->getUserId();
        $this->rateLimit('jobs_my_interviews', 30, 60);

        $interviews = JobInterviewService::getForUser($userId);

        return $this->respondWithData($interviews);
    }

    // =====================================================================
    // OFFERS
    // =====================================================================

    /** POST /api/v2/jobs/applications/{id}/offer — employer sends a job offer */
    public function createOffer(Request $request, int $applicationId): JsonResponse
    {
        $this->ensureFeature();
        if ($response = $this->rejectIfJobConfigDisabled(JobConfigurationService::CONFIG_ENABLE_OFFERS, 'job_offers_disabled')) {
            return $response;
        }
        $userId = $this->getUserId();
        $this->rateLimit('jobs_offer_create', 10, 60);

        $data = $this->getAllInput();

        try {
            $offer = JobOfferService::create($applicationId, $userId, $data);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        if ($offer === false) {
            return $this->respondWithError('RESOURCE_FORBIDDEN', __('api.job_offer_create_failed'), null, 422);
        }

        return $this->respondWithData($offer, null, 201);
    }

    /** PUT /api/v2/jobs/offers/{id}/accept — candidate accepts a job offer */
    public function acceptOffer(Request $request, int $offerId): JsonResponse
    {
        $this->ensureFeature();
        if ($response = $this->rejectIfJobConfigDisabled(JobConfigurationService::CONFIG_ENABLE_OFFERS, 'job_offers_disabled')) {
            return $response;
        }
        $userId = $this->getUserId();
        $this->rateLimit('jobs_offer_accept', 10, 60);

        try {
            $success = JobOfferService::accept($offerId, $userId);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        if (!$success) {
            return $this->respondWithError('RESOURCE_FORBIDDEN', __('api.job_offer_accept_failed'), null, 422);
        }

        return $this->respondWithData(['message' => __('api.offer_accepted')]);
    }

    /** PUT /api/v2/jobs/offers/{id}/reject — candidate rejects a job offer */
    public function rejectOffer(Request $request, int $offerId): JsonResponse
    {
        $this->ensureFeature();
        if ($response = $this->rejectIfJobConfigDisabled(JobConfigurationService::CONFIG_ENABLE_OFFERS, 'job_offers_disabled')) {
            return $response;
        }
        $userId = $this->getUserId();
        $this->rateLimit('jobs_offer_reject', 10, 60);

        $success = JobOfferService::reject($offerId, $userId);

        if (!$success) {
            return $this->respondWithError('RESOURCE_FORBIDDEN', __('api.job_offer_reject_failed'), null, 422);
        }

        return $this->respondWithData(['message' => __('api.offer_rejected')]);
    }

    /** DELETE /api/v2/jobs/offers/{id} — employer withdraws a job offer */
    public function withdrawOffer(Request $request, int $offerId): JsonResponse
    {
        $this->ensureFeature();
        if ($response = $this->rejectIfJobConfigDisabled(JobConfigurationService::CONFIG_ENABLE_OFFERS, 'job_offers_disabled')) {
            return $response;
        }
        $userId = $this->getUserId();
        $this->rateLimit('jobs_offer_withdraw', 10, 60);

        $success = JobOfferService::withdraw($offerId, $userId);

        if (!$success) {
            return $this->respondWithError('RESOURCE_FORBIDDEN', __('api.job_offer_withdraw_failed'), null, 422);
        }

        return $this->noContent();
    }

    /** GET /api/v2/jobs/applications/{id}/offer — get the offer for an application */
    public function getApplicationOffer(Request $request, int $applicationId): JsonResponse
    {
        $this->ensureFeature();
        if ($response = $this->rejectIfJobConfigDisabled(JobConfigurationService::CONFIG_ENABLE_OFFERS, 'job_offers_disabled')) {
            return $response;
        }
        $userId = $this->getUserId();
        $this->rateLimit('jobs_offer_get', 30, 60);

        $offer = JobOfferService::getForApplication($applicationId, $userId);

        if ($offer === null) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.job_offer_not_found'), null, 404);
        }

        return $this->respondWithData($offer);
    }

    /** GET /api/v2/jobs/my-offers — candidate lists their own offers */
    public function myOffers(Request $request): JsonResponse
    {
        $this->ensureFeature();
        if ($response = $this->rejectIfJobConfigDisabled(JobConfigurationService::CONFIG_ENABLE_OFFERS, 'job_offers_disabled')) {
            return $response;
        }
        $userId = $this->getUserId();
        $this->rateLimit('jobs_my_offers', 30, 60);

        $offers = JobOfferService::getForUser($userId);

        return $this->respondWithData($offers);
    }

    // =====================================================================
    // AI CV PARSING
    // =====================================================================

    /** GET /api/v2/jobs/applications/{id}/parse-cv — AI-powered CV parsing */
    public function parseResumeCv(Request $request, int $id): JsonResponse
    {
        $this->ensureFeature();
        if ($response = $this->rejectIfJobConfigDisabled(JobConfigurationService::CONFIG_ENABLE_CV_UPLOAD, 'job_cv_upload_disabled')) {
            return $response;
        }
        $userId = $this->getUserId();
        $this->rateLimit('jobs_parse_cv', 5, 60);

        $tenantId = TenantContext::getId();

        $application = JobApplication::with(['vacancy'])->find($id);

        if (!$application || !$application->vacancy || (int) $application->vacancy->tenant_id !== $tenantId) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.job_application_not_found'), null, 404);
        }

        // Only allow: the applicant themselves or the job poster
        $isApplicant = (int) $application->user_id === $userId;
        $isPoster = $application->vacancy && (int) $application->vacancy->user_id === $userId;

        if (!$isApplicant && !$isPoster) {
            return $this->respondWithError('RESOURCE_FORBIDDEN', __('api.job_access_denied'), null, 403);
        }

        if (!$isApplicant && (bool) ($application->vacancy->blind_hiring ?? false)) {
            return $this->respondWithError('RESOURCE_FORBIDDEN', __('api.job_access_denied'), null, 403);
        }

        if (empty($application->cv_path)) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.job_no_cv_attached'), null, 404);
        }

        $parsed = AiChatService::parseResume($application->cv_path);

        return $this->respondWithData($parsed);
    }

    // ── Referral endpoints ─────────────────────────────────────────────────

    /**
     * POST /v2/jobs/{id}/referral
     * Get or create a shareable referral token for a vacancy.
     */
    public function getOrCreateReferral(int $id): JsonResponse
    {
        $this->ensureFeature();
        if ($response = $this->rejectIfJobConfigDisabled(JobConfigurationService::CONFIG_ENABLE_REFERRALS, 'job_referrals_disabled')) {
            return $response;
        }

        $userId   = $this->getOptionalUserId();
        $referral = JobReferralService::getOrCreate($id, $userId);

        if (empty($referral)) {
            return $this->respondWithError('SERVER_INTERNAL_ERROR', __('api.job_referral_failed'), null, 422);
        }
        return $this->respondWithData(['referral' => $referral], null, 201);
    }

    /**
     * GET /v2/jobs/{id}/referral-stats
     * Employer views referral stats for their vacancy.
     */
    public function referralStats(int $id): JsonResponse
    {
        $this->ensureFeature();
        if ($response = $this->rejectIfJobConfigDisabled(JobConfigurationService::CONFIG_ENABLE_REFERRALS, 'job_referrals_disabled')) {
            return $response;
        }

        $userId = $this->getUserId();

        // Verify caller owns the vacancy or is admin
        $vacancy = \App\Models\JobVacancy::find($id);
        if (!$vacancy || (int) $vacancy->tenant_id !== TenantContext::getId()) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.job_vacancy_not_found'), null, 404);
        }
        if (!$this->canManageVacancy($vacancy, $userId)) {
            return $this->respondWithError('RESOURCE_FORBIDDEN', __('api.job_access_denied'), null, 403);
        }

        $stats = JobReferralService::getStats($id);
        return $this->respondWithData(['stats' => $stats]);
    }

    // ── Scorecard endpoints ────────────────────────────────────────────────

    /**
     * PUT /v2/jobs/applications/{id}/scorecard
     * Reviewer upserts their scorecard for an application.
     */
    public function upsertScorecard(int $id): JsonResponse
    {
        $this->ensureFeature();
        if ($response = $this->rejectIfJobConfigDisabled(JobConfigurationService::CONFIG_ENABLE_SCORECARDS, 'job_scorecards_disabled')) {
            return $response;
        }

        $userId = $this->getUserId();

        // Verify caller owns the vacancy or is admin (only employer/team should score)
        $application = JobApplication::with(['vacancy'])->find($id);
        if (!$application || !$application->vacancy || (int) $application->vacancy->tenant_id !== TenantContext::getId()) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.job_application_not_found'), null, 404);
        }
        if (!$this->canManageVacancy($application->vacancy, $userId)) {
            return $this->respondWithError('RESOURCE_FORBIDDEN', __('api.job_access_denied'), null, 403);
        }

        $data   = $this->getAllInput();
        $result = JobScorecardService::upsert($id, $userId, $data);

        if ($result === false) {
            return $this->respondWithError('SERVER_INTERNAL_ERROR', __('api.job_scorecard_save_failed'), null, 422);
        }
        return $this->respondWithData(['scorecard' => $result]);
    }

    /**
     * GET /v2/jobs/applications/{id}/scorecards
     * Get all scorecards for an application (employer/team view).
     */
    public function getScorecards(int $id): JsonResponse
    {
        $this->ensureFeature();
        if ($response = $this->rejectIfJobConfigDisabled(JobConfigurationService::CONFIG_ENABLE_SCORECARDS, 'job_scorecards_disabled')) {
            return $response;
        }

        $userId = $this->getUserId();

        // Verify caller owns/manages the vacancy or is admin. Scorecards are internal hiring records.
        $application = JobApplication::with(['vacancy'])->find($id);
        if (!$application || !$application->vacancy || (int) $application->vacancy->tenant_id !== TenantContext::getId()) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.job_application_not_found'), null, 404);
        }
        if (!$this->canManageVacancy($application->vacancy, $userId)) {
            return $this->respondWithError('RESOURCE_FORBIDDEN', __('api.job_access_denied'), null, 403);
        }

        $cards = JobScorecardService::getForApplication($id);
        return $this->respondWithData($cards);
    }

    // ── Team endpoints ─────────────────────────────────────────────────────

    /**
     * POST /v2/jobs/{id}/team
     * Add a team member to a vacancy.
     */
    public function addTeamMember(int $id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $data   = $this->getAllInput();
        try {
            $result = JobTeamService::addMember(
                $id,
                $userId,
                (int) ($data['user_id'] ?? 0),
                $data['role'] ?? 'reviewer'
            );
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        }

        if ($result === false) {
            return $this->respondWithError('RESOURCE_FORBIDDEN', __('api.job_team_add_failed'), null, 422);
        }
        return $this->respondWithData(['member' => $result], null, 201);
    }

    /**
     * DELETE /v2/jobs/{id}/team/{userId}
     * Remove a team member from a vacancy.
     */
    public function removeTeamMember(int $id, int $userId): JsonResponse
    {
        $this->ensureFeature();
        $currentUserId = $this->getUserId();

        $ok = JobTeamService::removeMember($id, $currentUserId, $userId);
        if (!$ok) {
            return $this->respondWithError('RESOURCE_FORBIDDEN', __('api.job_team_remove_failed'), null, 422);
        }
        return $this->respondWithData(['success' => true]);
    }

    /**
     * GET /v2/jobs/{id}/team
     * List team members for a vacancy.
     */
    public function getTeam(int $id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();

        // Verify caller owns the vacancy or is admin
        $vacancy = \App\Models\JobVacancy::find($id);
        if (!$vacancy || (int) $vacancy->tenant_id !== TenantContext::getId()) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.job_vacancy_not_found'), null, 404);
        }
        if (!$this->canManageVacancy($vacancy, $userId)) {
            return $this->respondWithError('RESOURCE_FORBIDDEN', __('api.job_access_denied'), null, 403);
        }

        $members = JobTeamService::getMembers($id);
        return $this->respondWithData($members);
    }

    // ── Saved profile endpoints ────────────────────────────────────────────

    /**
     * GET /v2/jobs/saved-profile
     * Get the current user's saved application profile.
     */
    public function getSavedProfile(): JsonResponse
    {
        $this->ensureFeature();
        if ($response = $this->rejectIfJobConfigDisabled(JobConfigurationService::CONFIG_ENABLE_SAVED_PROFILES, 'job_saved_profiles_disabled')) {
            return $response;
        }

        $userId  = $this->getUserId();
        $profile = JobSavedProfileService::get($userId);
        return $this->respondWithData(['profile' => $profile]);
    }

    /**
     * PUT /v2/jobs/saved-profile
     * Save/update the current user's application profile (cover letter + CV metadata).
     * Note: actual CV file upload happens via the apply endpoint; this stores metadata + text.
     */
    public function saveSavedProfile(): JsonResponse
    {
        $this->ensureFeature();
        if ($response = $this->rejectIfJobConfigDisabled(JobConfigurationService::CONFIG_ENABLE_SAVED_PROFILES, 'job_saved_profiles_disabled')) {
            return $response;
        }

        $userId = $this->getUserId();
        $data   = $this->getAllInput();
        $result = JobSavedProfileService::save($userId, $data);

        if ($result === false) {
            return $this->respondWithError('SERVER_INTERNAL_ERROR', __('api.job_profile_save_failed'), null, 422);
        }
        return $this->respondWithData(['profile' => $result]);
    }

    // ── Job Templates ─────────────────────────────────────────────────────

    /**
     * GET /v2/jobs/templates
     */
    public function listTemplates(): JsonResponse
    {
        $this->ensureFeature();
        if (!$this->configBool(JobConfigurationService::CONFIG_ENABLE_TEMPLATES, true)) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.job_templates_disabled'), null, 403);
        }

        $userId = $this->getUserId();
        return $this->respondWithData(JobTemplateService::list($userId));
    }

    /**
     * POST /v2/jobs/templates
     */
    public function createTemplate(): JsonResponse
    {
        $this->ensureFeature();
        if (!$this->configBool(JobConfigurationService::CONFIG_ENABLE_TEMPLATES, true)) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.job_templates_disabled'), null, 403);
        }

        $userId = $this->getUserId();
        $data   = $this->getAllInput();
        $result = JobTemplateService::create($userId, $data);
        return $result !== false
            ? $this->respondWithData(['template' => $result], null, 201)
            : $this->respondWithError('SERVER_INTERNAL_ERROR', __('api.job_template_create_failed'), null, 422);
    }

    /**
     * GET /v2/jobs/templates/{id}
     */
    public function getTemplate(int $id): JsonResponse
    {
        $this->ensureFeature();
        if (!$this->configBool(JobConfigurationService::CONFIG_ENABLE_TEMPLATES, true)) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.job_templates_disabled'), null, 403);
        }

        $userId   = $this->getUserId();
        $template = JobTemplateService::get($id, $userId);
        return $template
            ? $this->respondWithData(['template' => $template])
            : $this->respondWithError('RESOURCE_NOT_FOUND', __('api.not_found', ['model' => '']), null, 404);
    }

    /**
     * DELETE /v2/jobs/templates/{id}
     */
    public function deleteTemplate(int $id): JsonResponse
    {
        $this->ensureFeature();
        if (!$this->configBool(JobConfigurationService::CONFIG_ENABLE_TEMPLATES, true)) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.job_templates_disabled'), null, 403);
        }

        $userId = $this->getUserId();
        $ok     = JobTemplateService::delete($id, $userId);
        return $ok
            ? $this->respondWithData(['success' => true])
            : $this->respondWithError('RESOURCE_NOT_FOUND', __('api.not_found', ['model' => '']), null, 404);
    }

    // ── Salary Benchmarks ─────────────────────────────────────────────────

    /**
     * GET /v2/jobs/salary-benchmark?title={title}
     */
    public function salaryBenchmark(): JsonResponse
    {
        $this->ensureFeature();
        $title = $this->query('title', '');
        if (!$title) return $this->respondWithData(['benchmark' => null]);
        $benchmark = SalaryBenchmarkService::findForTitle($title);
        return $this->respondWithData(['benchmark' => $benchmark]);
    }

    // ── GDPR ──────────────────────────────────────────────────────────────

    /** GET /v2/jobs/gdpr-export */
    public function gdprExport(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $data = JobGdprService::exportUserData($userId);
        return $this->respondWithData($data);
    }

    /** DELETE /v2/jobs/gdpr-erase-me */
    public function gdprErase(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $ok = JobGdprService::eraseUserData($userId);
        return $ok
            ? $this->respondWithData(['success' => true, 'message' => __('api.application_data_anonymised')])
            : $this->respondWithError('SERVER_INTERNAL_ERROR', __('api.job_erasure_failed'), null, 500);
    }

    /** GET /v2/jobs/{id}/applications/export-csv */
    public function exportApplicationsCsv(int $id): \Illuminate\Http\Response|JsonResponse
    {
        $this->ensureFeature();
        $this->rateLimit('jobs_export_csv', 10, 60);
        $userId = $this->getUserId();

        $csv = $this->jobService->exportApplicationsCsv($id, $userId);
        if ($csv === null) {
            $errors = $this->jobService->getErrors();
            $code   = ($errors[0]['code'] ?? '') === 'RESOURCE_FORBIDDEN' ? 403 : 404;
            return $this->respondWithErrors($errors, $code);
        }

        return response($csv, 200, [
            'Content-Type'        => 'text/csv',
            'Content-Disposition' => "attachment; filename=\"job-{$id}-applications.csv\"",
        ]);
    }

    // ── Pipeline Rules ─────────────────────────────────────────────────────

    /** GET /v2/jobs/{id}/pipeline-rules */
    public function listPipelineRules(int $id): JsonResponse
    {
        $this->ensureFeature();
        if ($response = $this->rejectIfJobConfigDisabled(JobConfigurationService::CONFIG_ENABLE_PIPELINE_RULES, 'job_pipeline_rules_disabled')) {
            return $response;
        }
        $userId = $this->getUserId();
        if ($response = $this->rejectIfCannotManageVacancy($id, $userId)) {
            return $response;
        }

        return $this->respondWithData(JobPipelineRuleService::listForVacancy($id));
    }

    /** POST /v2/jobs/{id}/pipeline-rules */
    public function createPipelineRule(int $id): JsonResponse
    {
        $this->ensureFeature();
        if ($response = $this->rejectIfJobConfigDisabled(JobConfigurationService::CONFIG_ENABLE_PIPELINE_RULES, 'job_pipeline_rules_disabled')) {
            return $response;
        }
        $userId = $this->getUserId();
        if ($response = $this->rejectIfCannotManageVacancy($id, $userId)) {
            return $response;
        }

        $data   = $this->getAllInput();
        $result = JobPipelineRuleService::create($id, $userId, $data);
        return $result !== false
            ? $this->respondWithData(['rule' => $result], null, 201)
            : $this->respondWithError('VALIDATION_ERROR', __('api.job_rule_create_failed'), null, 422);
    }

    /** DELETE /v2/jobs/pipeline-rules/{id} */
    public function deletePipelineRule(int $id): JsonResponse
    {
        $this->ensureFeature();
        if ($response = $this->rejectIfJobConfigDisabled(JobConfigurationService::CONFIG_ENABLE_PIPELINE_RULES, 'job_pipeline_rules_disabled')) {
            return $response;
        }
        $userId = $this->getUserId();
        $ok     = JobPipelineRuleService::delete($id, $userId);
        return $ok
            ? $this->respondWithData(['success' => true])
            : $this->respondWithError('RESOURCE_NOT_FOUND', __('api.not_found', ['model' => '']), null, 404);
    }

    /** POST /v2/jobs/{id}/pipeline-rules/run */
    public function runPipelineRules(int $id): JsonResponse
    {
        $this->ensureFeature();
        if ($response = $this->rejectIfJobConfigDisabled(JobConfigurationService::CONFIG_ENABLE_PIPELINE_RULES, 'job_pipeline_rules_disabled')) {
            return $response;
        }
        $userId = $this->getUserId();
        if ($response = $this->rejectIfCannotManageVacancy($id, $userId)) {
            return $response;
        }

        $count = JobPipelineRuleService::runForVacancy($id);
        return $this->respondWithData(['actioned' => $count]);
    }

    // ── Bulk Application Actions ───────────────────────────────────────────

    /** POST /v2/jobs/{id}/applications/bulk-status */
    public function bulkUpdateApplicationStatus(int $id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->getUserId();
        $data   = $this->getAllInput();
        $ids    = array_map('intval', (array) ($data['application_ids'] ?? []));
        $status = $data['status'] ?? '';

        if (empty($ids) || !$status) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.job_bulk_ids_status_required'), null, 422);
        }

        if (count($ids) > 1000) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.job_bulk_max_1000'), null, 422);
        }

        $count  = $this->jobService->bulkUpdateApplicationStatus($id, $userId, $ids, $status);
        $errors = $this->jobService->getErrors();
        if (!empty($errors)) {
            return $this->respondWithErrors($errors, 422);
        }
        return $this->respondWithData(['updated' => $count]);
    }

    // =====================================================================
    // AI JOB DESCRIPTION GENERATOR (Agent A)
    // =====================================================================

    /** POST /api/v2/jobs/generate-description — AI-generated job description */
    public function generateDescription(): JsonResponse
    {
        $this->ensureFeature();
        $this->getUserId();
        $this->rateLimit('jobs_ai_generate', 10, 60);

        if (!$this->configBool(JobConfigurationService::CONFIG_ENABLE_AI_DESCRIPTIONS, true)) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.job_ai_descriptions_disabled'), null, 403);
        }

        $title = $this->input('title');
        $skills = $this->input('skills', []);
        $type = $this->input('type', 'paid');
        $commitment = $this->input('commitment', 'flexible');

        if (empty($title)) {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.title_required'), 'title', 400);
        }

        $skillsList = is_array($skills) ? implode(', ', $skills) : (string) $skills;

        $typeLabel = match ($type) {
            'paid' => 'paid position',
            'volunteer' => 'volunteer role',
            'timebank' => 'timebanking opportunity',
            default => 'position',
        };

        $commitmentLabel = match ($commitment) {
            'full_time' => 'full-time',
            'part_time' => 'part-time',
            'flexible' => 'flexible hours',
            'one_off' => 'one-off project',
            default => 'flexible',
        };

        $prompt = "Write a professional, engaging job description for a community platform. "
            . "The role is: \"{$title}\". "
            . "It is a {$commitmentLabel} {$typeLabel}. "
            . (!empty($skillsList) ? "Required skills include: {$skillsList}. " : '')
            . "Write 3-5 paragraphs covering: role overview, key responsibilities, ideal candidate qualities, and what the community offers. "
            . "Use a warm, community-oriented tone. Do not include a job title heading — just the description body. "
            . "Do not use markdown formatting.";

        $result = $this->aiService->chat(0, $prompt, [
            'system_prompt' => 'You are a professional job description writer for a community timebanking platform. Write clear, inclusive, and welcoming job descriptions.',
            'max_tokens' => 1024,
            'model' => 'gpt-4o-mini',
        ]);

        if (!empty($result['error'])) {
            return $this->respondWithError('AI_SERVICE_ERROR', $result['reply'] ?? __('api.job_ai_generate_failed'), null, 503);
        }

        return $this->respondWithData(['description' => $result['reply']]);
    }

    // =====================================================================
    // DUPLICATE JOB DETECTION (Agent A)
    // =====================================================================

    /** POST /api/v2/jobs/check-duplicate — find similar open/draft jobs */
    public function checkDuplicate(): JsonResponse
    {
        $this->ensureFeature();
        $this->getUserId();
        $this->rateLimit('jobs_check_dup', 30, 60);

        $title = $this->input('title');
        $organizationId = $this->input('organization_id');

        if (empty($title)) {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.title_required'), 'title', 400);
        }

        $tenantId = TenantContext::getId();
        $duplicates = $this->jobService->findSimilarJobs(
            (string) $title,
            $organizationId ? (int) $organizationId : null,
            $tenantId
        );

        return $this->respondWithData(['duplicates' => $duplicates]);
    }

    // =====================================================================
    // TALENT SEARCH — Candidate Resume Database (Agent C)
    // =====================================================================

    /** GET /api/v2/jobs/talent-search — search candidates who opted in */
    public function talentSearch(): JsonResponse
    {
        $this->ensureFeature();
        if ($response = $this->rejectIfJobConfigDisabled(JobConfigurationService::CONFIG_PAGE_TALENT_SEARCH, 'job_talent_search_disabled')) {
            return $response;
        }
        $userId = $this->getUserId();
        if (!$this->canSearchTalent($userId)) {
            return $this->respondWithError('RESOURCE_FORBIDDEN', __('api.job_access_denied'), null, 403);
        }
        $this->rateLimit('talent_search', 30, 60);

        $tenantId = TenantContext::getId();

        $filters = [
            'limit' => $this->queryInt('per_page', 20, 1, 100),
            'offset' => $this->queryInt('offset', 0),
        ];

        if ($this->query('keywords')) {
            $filters['keywords'] = $this->query('keywords');
        }
        if ($this->query('skills')) {
            $skills = $this->query('skills');
            $filters['skills'] = is_string($skills) ? array_filter(array_map('trim', explode(',', $skills))) : [];
        }
        if ($this->query('location')) {
            $filters['location'] = $this->query('location');
        }

        $result = $this->candidateService->search($filters, $tenantId);

        return $this->respondWithData($result);
    }

    /** GET /api/v2/jobs/talent-search/{id} — view a candidate profile */
    public function talentProfile(int $id): JsonResponse
    {
        $this->ensureFeature();
        if ($response = $this->rejectIfJobConfigDisabled(JobConfigurationService::CONFIG_PAGE_TALENT_SEARCH, 'job_talent_search_disabled')) {
            return $response;
        }
        $userId = $this->getUserId();
        if (!$this->canSearchTalent($userId)) {
            return $this->respondWithError('RESOURCE_FORBIDDEN', __('api.job_access_denied'), null, 403);
        }
        $this->rateLimit('talent_profile', 60, 60);

        $tenantId = TenantContext::getId();

        $profile = $this->candidateService->getCandidateProfile($id, $tenantId);

        if (!$profile) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api.job_candidate_not_found'), null, 404);
        }

        return $this->respondWithData($profile);
    }

    /** PUT /api/v2/users/me/resume-visibility — toggle resume searchability */
    public function updateResumeVisibility(): JsonResponse
    {
        $this->ensureFeature();
        if ($response = $this->rejectIfJobConfigDisabled(JobConfigurationService::CONFIG_PAGE_TALENT_SEARCH, 'job_talent_search_disabled')) {
            return $response;
        }

        $userId = $this->getUserId();
        $this->rateLimit('resume_visibility', 10, 60);

        $tenantId = TenantContext::getId();
        $searchable = $this->inputBool('searchable');

        $success = $this->candidateService->updateResumeVisibility($userId, $tenantId, $searchable);

        if (!$success) {
            return $this->respondWithError('SERVER_INTERNAL_ERROR', __('api.job_resume_visibility_failed'), null, 500);
        }

        return $this->respondWithData([
            'searchable' => $searchable,
            'message' => $searchable
                ? __('api.job_resume_searchable_enabled')
                : __('api.job_resume_searchable_disabled'),
        ]);
    }

    // =====================================================================
    // INTERVIEW SELF-SCHEDULING (Agent E)
    // =====================================================================

    /** GET /api/v2/jobs/{id}/interview-slots — list slots for a job */
    public function listInterviewSlots(int $id): JsonResponse
    {
        $this->ensureFeature();
        if ($response = $this->rejectIfJobConfigDisabled(JobConfigurationService::CONFIG_ENABLE_INTERVIEW_SCHEDULING, 'job_interview_scheduling_disabled')) {
            return $response;
        }
        $userId = $this->getUserId();
        $this->rateLimit('jobs_slots_list', 30, 60);

        $tenantId = TenantContext::getId();
        $slots = $this->schedulingService->getAvailableSlots($id, $tenantId, $userId);

        if (empty($slots) && !empty($this->schedulingService->getErrors())) {
            $errors = $this->schedulingService->getErrors();
            $status = ($errors[0]['code'] ?? null) === 'RESOURCE_NOT_FOUND' ? 404 : 403;
            return $this->respondWithErrors($errors, $status);
        }

        return $this->respondWithData($slots);
    }

    /** POST /api/v2/jobs/{id}/interview-slots — employer creates slots */
    public function createInterviewSlots(int $id): JsonResponse
    {
        $this->ensureFeature();
        if ($response = $this->rejectIfJobConfigDisabled(JobConfigurationService::CONFIG_ENABLE_INTERVIEW_SCHEDULING, 'job_interview_scheduling_disabled')) {
            return $response;
        }
        $userId = $this->getUserId();
        $this->rateLimit('jobs_slots_create', 10, 60);

        $tenantId = TenantContext::getId();
        $data = $this->getAllInput();
        $slots = $data['slots'] ?? [];

        if (empty($slots) || !is_array($slots)) {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.job_slots_required'), 'slots', 400);
        }

        $created = $this->schedulingService->createSlots($id, $userId, $slots, $tenantId);

        if (empty($created) && !empty($this->schedulingService->getErrors())) {
            $errors = $this->schedulingService->getErrors();
            $status = 400;
            foreach ($errors as $error) {
                if ($error['code'] === 'RESOURCE_NOT_FOUND') {
                    $status = 404;
                    break;
                }
                if ($error['code'] === 'RESOURCE_FORBIDDEN') {
                    $status = 403;
                    break;
                }
            }
            return $this->respondWithErrors($errors, $status);
        }

        return $this->respondWithData($created, null, 201);
    }

    /** POST /api/v2/jobs/{id}/interview-slots/bulk — employer bulk-creates slots */
    public function bulkCreateInterviewSlots(int $id): JsonResponse
    {
        $this->ensureFeature();
        if ($response = $this->rejectIfJobConfigDisabled(JobConfigurationService::CONFIG_ENABLE_INTERVIEW_SCHEDULING, 'job_interview_scheduling_disabled')) {
            return $response;
        }
        $userId = $this->getUserId();
        $this->rateLimit('jobs_slots_bulk', 5, 60);

        $tenantId = TenantContext::getId();
        $data = $this->getAllInput();

        $dateFrom = $data['date_from'] ?? null;
        $dateTo = $data['date_to'] ?? null;
        $duration = (int) ($data['duration_minutes'] ?? 30);
        $dayConfig = $data['day_config'] ?? [];

        if (empty($dateFrom) || empty($dateTo)) {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.job_date_range_required'), 'date_from', 400);
        }

        if (empty($dayConfig)) {
            return $this->respondWithError('VALIDATION_REQUIRED_FIELD', __('api.job_day_config_required'), 'day_config', 400);
        }

        $created = $this->schedulingService->bulkCreateSlots(
            $id,
            $userId,
            $dateFrom,
            $dateTo,
            $duration,
            $dayConfig,
            $tenantId
        );

        if (empty($created) && !empty($this->schedulingService->getErrors())) {
            $errors = $this->schedulingService->getErrors();
            $status = 400;
            foreach ($errors as $error) {
                if ($error['code'] === 'RESOURCE_NOT_FOUND') {
                    $status = 404;
                    break;
                }
                if ($error['code'] === 'RESOURCE_FORBIDDEN') {
                    $status = 403;
                    break;
                }
            }
            return $this->respondWithErrors($errors, $status);
        }

        return $this->respondWithData($created, null, 201);
    }

    /** POST /api/v2/jobs/interview-slots/{slotId}/book — candidate books a slot */
    public function bookInterviewSlot(int $slotId): JsonResponse
    {
        $this->ensureFeature();
        if ($response = $this->rejectIfJobConfigDisabled(JobConfigurationService::CONFIG_ENABLE_INTERVIEW_SCHEDULING, 'job_interview_scheduling_disabled')) {
            return $response;
        }
        $userId = $this->getUserId();
        $this->rateLimit('jobs_slots_book', 10, 60);

        $tenantId = TenantContext::getId();
        $result = $this->schedulingService->bookSlot($slotId, $userId, $tenantId);

        if ($result === null) {
            $errors = $this->schedulingService->getErrors();
            $status = 400;
            foreach ($errors as $error) {
                if ($error['code'] === 'RESOURCE_NOT_FOUND') {
                    $status = 404;
                    break;
                }
                if ($error['code'] === 'RESOURCE_CONFLICT') {
                    $status = 409;
                    break;
                }
                if ($error['code'] === 'RESOURCE_FORBIDDEN') {
                    $status = 403;
                    break;
                }
            }
            return $this->respondWithErrors($errors, $status);
        }

        return $this->respondWithData($result, null, 201);
    }

    /** DELETE /api/v2/jobs/interview-slots/{slotId}/book — cancel a booking */
    public function cancelInterviewSlotBooking(int $slotId): JsonResponse
    {
        $this->ensureFeature();
        if ($response = $this->rejectIfJobConfigDisabled(JobConfigurationService::CONFIG_ENABLE_INTERVIEW_SCHEDULING, 'job_interview_scheduling_disabled')) {
            return $response;
        }
        $userId = $this->getUserId();
        $this->rateLimit('jobs_slots_cancel', 10, 60);

        $tenantId = TenantContext::getId();
        $success = $this->schedulingService->cancelSlotBooking($slotId, $tenantId, $userId);

        if (!$success) {
            $errors = $this->schedulingService->getErrors();
            return $this->respondWithErrors($errors, 400);
        }

        return $this->respondWithData(['message' => __('api.booking_cancelled')]);
    }

    /** DELETE /api/v2/jobs/interview-slots/{slotId} — employer deletes a slot */
    public function deleteInterviewSlot(int $slotId): JsonResponse
    {
        $this->ensureFeature();
        if ($response = $this->rejectIfJobConfigDisabled(JobConfigurationService::CONFIG_ENABLE_INTERVIEW_SCHEDULING, 'job_interview_scheduling_disabled')) {
            return $response;
        }
        $userId = $this->getUserId();
        $this->rateLimit('jobs_slots_delete', 10, 60);

        $tenantId = TenantContext::getId();
        $success = $this->schedulingService->deleteSlot($slotId, $tenantId, $userId);

        if (!$success) {
            $errors = $this->schedulingService->getErrors();
            return $this->respondWithErrors($errors, 404);
        }

        return $this->noContent();
    }

    /** POST /api/v2/jobs/{id}/ai-rank — AI-powered candidate ranking with community trust signals. */
    public function aiRankCandidates(int $id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAuth();
        $this->rateLimit('jobs_ai_rank', 5, 60);
        $tenantId = TenantContext::getId();

        $vacancy = JobVacancy::where('tenant_id', $tenantId)->find($id);
        if (!$vacancy) return $this->respondWithError('NOT_FOUND', __('api_controllers_2.job_vacancies.job_not_found'), null, 404);

        // Owner, admin, or hiring-team manager
        if (!$this->canManageVacancy($vacancy, $userId)) {
            return $this->respondWithError('FORBIDDEN', __('api_controllers_2.job_vacancies.only_poster_can_rank'), null, 403);
        }

        if (!\App\Services\AI\AIServiceFactory::isEnabled()) {
            return $this->respondWithError('AI_DISABLED', __('api_controllers_2.job_vacancies.ai_not_configured'), null, 503);
        }

        // Get applications with applicant data + community trust signals
        $applications = JobApplication::with(['applicant:id,first_name,last_name,profile_type,organization_name,bio,skills,xp,level'])
            ->where('vacancy_id', $id)
            ->whereNotIn('status', ['withdrawn', 'rejected'])
            ->get();

        if ($applications->isEmpty()) {
            return $this->respondWithData(['rankings' => [], 'message' => __('api_controllers_2.job_vacancies.no_active_applications')]);
        }

        // Enrich each applicant with community trust signals
        $candidateProfiles = [];
        foreach ($applications as $app) {
            $applicant = $app->applicant;
            if (!$applicant) continue;

            $appUserId = (int) $applicant->id;

            // Transaction count
            $txCount = Transaction::where('tenant_id', $tenantId)
                ->where(function ($q) use ($appUserId) {
                    $q->where('sender_id', $appUserId)->orWhere('receiver_id', $appUserId);
                })
                ->where('status', 'completed')
                ->count();

            // Average review rating
            $avgRating = Review::where('tenant_id', $tenantId)
                ->where('receiver_id', $appUserId)
                ->where('status', 'approved')
                ->avg('rating');

            // Badge count
            $badgeCount = DB::table('user_badges')
                ->where('user_id', $appUserId)
                ->where('tenant_id', $tenantId)
                ->count();

            $candidateProfiles[] = [
                'application_id' => $app->id,
                'name' => UserDisplayName::resolve($applicant),
                'bio' => $applicant->bio ?? '',
                'skills' => $applicant->skills ?? '',
                'xp' => (int) ($applicant->xp ?? 0),
                'level' => (int) ($applicant->level ?? 1),
                'completed_exchanges' => $txCount,
                'avg_review_rating' => $avgRating ? round((float) $avgRating, 1) : null,
                'badges_earned' => $badgeCount,
                'cover_message' => $app->message ?? '',
                'match_percentage' => $app->match_percentage ?? null,
            ];
        }

        // Build AI prompt
        $jobDescription = __('api.job_ai_ranking_job_description', [
            'title' => $vacancy->title,
            'type' => $vacancy->type,
            'commitment' => $vacancy->commitment,
            'skills' => $vacancy->skills_required ?? __('api.job_ai_not_specified'),
            'description' => substr($vacancy->description ?? '', 0, 500),
        ]);

        $candidateList = '';
        foreach ($candidateProfiles as $i => $c) {
            $candidateList .= "\n---\n" . __('api.job_ai_ranking_candidate', [
                'number' => $i + 1,
                'application_id' => $c['application_id'],
                'name' => $c['name'],
                'skills' => $c['skills'],
                'xp' => $c['xp'],
                'level' => $c['level'],
                'completed_exchanges' => $c['completed_exchanges'],
                'avg_review_rating' => $c['avg_review_rating'] ?? __('api.job_ai_no_reviews'),
                'badges' => $c['badges_earned'],
                'match' => $c['match_percentage'] !== null ? "{$c['match_percentage']}%" : __('api.job_ai_not_applicable'),
                'cover_message' => substr($c['cover_message'], 0, 200),
                'bio' => substr($c['bio'], 0, 200),
            ]);
        }

        $systemPrompt = __('api.job_ai_ranking_system_prompt');

        $userPrompt = __('api.job_ai_ranking_user_prompt', [
            'job' => $jobDescription,
            'candidates' => $candidateList,
        ]);

        try {
            $response = \App\Services\AI\AIServiceFactory::chatWithFallback(
                [
                    ['role' => 'system', 'content' => $systemPrompt],
                    ['role' => 'user', 'content' => $userPrompt],
                ],
                ['temperature' => 0.3, 'max_tokens' => 2000]
            );

            $content = $response['content'] ?? $response['message'] ?? '';

            // Extract JSON from response (handle markdown code blocks)
            if (preg_match('/\[[\s\S]*\]/', $content, $matches)) {
                $rankings = json_decode($matches[0], true);
            } else {
                $rankings = json_decode($content, true);
            }

            if (!is_array($rankings)) {
                return $this->respondWithError('AI_PARSE_ERROR', __('api_controllers_2.job_vacancies.ai_parse_error'), null, 500);
            }

            // Merge community data back into rankings for frontend display
            $profileMap = [];
            foreach ($candidateProfiles as $p) {
                $profileMap[$p['application_id']] = $p;
            }
            foreach ($rankings as &$r) {
                $appId = $r['application_id'] ?? 0;
                if (isset($profileMap[$appId])) {
                    $r['community_xp'] = $profileMap[$appId]['xp'];
                    $r['community_level'] = $profileMap[$appId]['level'];
                    $r['community_exchanges'] = $profileMap[$appId]['completed_exchanges'];
                    $r['community_rating'] = $profileMap[$appId]['avg_review_rating'];
                    $r['community_badges'] = $profileMap[$appId]['badges_earned'];
                }
            }
            unset($r);

            return $this->respondWithData([
                'rankings' => $rankings,
                'provider' => $response['provider'] ?? 'unknown',
                'candidates_evaluated' => count($candidateProfiles),
            ]);
        } catch (\Throwable $e) {
            Log::error('aiRankCandidates failed', ['error' => $e->getMessage()]);
            return $this->respondWithError('AI_ERROR', __('api_controllers_2.job_vacancies.ai_ranking_failed'), null, 500);
        }
    }

    /** GET /api/v2/jobs/offer-templates — List user's offer letter templates. */
    public function offerTemplates(): JsonResponse
    {
        $this->ensureFeature();
        if ($response = $this->rejectIfJobConfigDisabled(JobConfigurationService::CONFIG_ENABLE_OFFERS, 'job_offers_disabled')) {
            return $response;
        }

        $userId = $this->requireAuth();
        $tenantId = TenantContext::getId();

        $templates = \App\Models\JobTemplate::where('tenant_id', $tenantId)
            ->where('template_type', 'offer_letter')
            ->where(function ($q) use ($userId) {
                $q->where('user_id', $userId)->orWhere('is_public', true);
            })
            ->orderByDesc('use_count')
            ->orderByDesc('updated_at')
            ->get()
            ->toArray();

        return $this->respondWithData($templates);
    }

    /** POST /api/v2/jobs/offer-templates — Create an offer letter template. */
    public function createOfferTemplate(): JsonResponse
    {
        $this->ensureFeature();
        if ($response = $this->rejectIfJobConfigDisabled(JobConfigurationService::CONFIG_ENABLE_OFFERS, 'job_offers_disabled')) {
            return $response;
        }

        $userId = $this->requireAuth();
        $tenantId = TenantContext::getId();
        $data = $this->getAllInput();

        if (empty($data['name'])) {
            return $this->respondWithError('VALIDATION_REQUIRED', __('api_controllers_2.job_vacancies.template_name_required'), 'name', 422);
        }

        $template = \App\Models\JobTemplate::create([
            'tenant_id'     => $tenantId,
            'user_id'       => $userId,
            'template_type' => 'offer_letter',
            'name'          => trim($data['name']),
            'description'   => $data['body'] ?? $data['description'] ?? null,
            'is_public'     => (bool) ($data['is_public'] ?? false),
        ]);

        return $this->respondWithData($template->toArray());
    }

    /** DELETE /api/v2/jobs/offer-templates/{id} — Delete an offer letter template. */
    public function deleteOfferTemplate(int $id): JsonResponse
    {
        $this->ensureFeature();
        if ($response = $this->rejectIfJobConfigDisabled(JobConfigurationService::CONFIG_ENABLE_OFFERS, 'job_offers_disabled')) {
            return $response;
        }

        $userId = $this->requireAuth();
        $tenantId = TenantContext::getId();

        $deleted = \App\Models\JobTemplate::where('tenant_id', $tenantId)
            ->where('id', $id)
            ->where('template_type', 'offer_letter')
            ->where('user_id', $userId)
            ->delete();

        if ($deleted) {
            return $this->respondWithData(['deleted' => true, 'id' => $id]);
        }
        return $this->respondWithError('NOT_FOUND', __('api_controllers_2.job_vacancies.template_not_found'), null, 404);
    }

    /** POST /api/v2/jobs/offer-templates/{id}/render — Render a template with placeholders. */
    public function renderOfferTemplate(int $id): JsonResponse
    {
        $this->ensureFeature();
        if ($response = $this->rejectIfJobConfigDisabled(JobConfigurationService::CONFIG_ENABLE_OFFERS, 'job_offers_disabled')) {
            return $response;
        }

        $userId = $this->requireAuth();
        $tenantId = TenantContext::getId();
        $data = $this->getAllInput();

        $template = \App\Models\JobTemplate::where('tenant_id', $tenantId)
            ->where('id', $id)
            ->where('template_type', 'offer_letter')
            ->where(function ($q) use ($userId) {
                $q->where('user_id', $userId)->orWhere('is_public', true);
            })
            ->first();

        if (!$template) {
            return $this->respondWithError('NOT_FOUND', __('api_controllers_2.job_vacancies.template_not_found'), null, 404);
        }

        // Increment use count
        $template->increment('use_count');

        // Replace placeholders
        $body = $template->description ?? '';
        $placeholders = [
            '{{candidate_name}}' => $data['candidate_name'] ?? '',
            '{{position}}'       => $data['position'] ?? '',
            '{{salary}}'         => $data['salary'] ?? '',
            '{{start_date}}'     => $data['start_date'] ?? '',
            '{{time_credits}}'   => $data['time_credits'] ?? '',
            '{{organization}}'   => $data['organization'] ?? '',
            '{{date}}'           => \Carbon\Carbon::now()
                ->locale(\App\I18n\FormattingLocale::carbon())
                ->isoFormat('LL'),
        ];
        $rendered = str_replace(array_keys($placeholders), array_values($placeholders), $body);

        return $this->respondWithData(['rendered' => $rendered, 'template_name' => $template->name]);
    }

    /** GET /api/v2/jobs/employer-reviews/{userId} — Get reviews for an employer. */
    public function employerReviews(int $userId): JsonResponse
    {
        $this->ensureFeature();
        $this->rateLimit('jobs_employer_reviews', 60, 60);
        $tenantId = TenantContext::getId();

        $reviews = Review::where('tenant_id', $tenantId)
            ->where('receiver_id', $userId)
            ->where('review_type', 'employer')
            ->where('status', 'approved')
            ->with('reviewer:id,first_name,last_name,profile_type,organization_name,avatar_url')
            ->orderByDesc('created_at')
            ->limit(50)
            ->get()
            ->map(fn($r) => [
                'id' => $r->id,
                'rating' => $r->rating,
                'comment' => $r->comment,
                'dimensions' => $r->dimensions,
                'reviewer' => $r->reviewer ? [
                    'id' => $r->reviewer->id,
                    'name' => UserDisplayName::resolve($r->reviewer),
                    'avatar_url' => $r->reviewer->avatar_url,
                ] : null,
                'created_at' => $r->created_at?->toIso8601String(),
            ]);

        // Stats
        $stats = [
            'average_rating' => $reviews->avg('rating') ? round($reviews->avg('rating'), 1) : null,
            'total_reviews' => $reviews->count(),
            'distribution' => [
                5 => $reviews->where('rating', 5)->count(),
                4 => $reviews->where('rating', 4)->count(),
                3 => $reviews->where('rating', 3)->count(),
                2 => $reviews->where('rating', 2)->count(),
                1 => $reviews->where('rating', 1)->count(),
            ],
        ];

        return $this->respondWithData(['reviews' => $reviews->values(), 'stats' => $stats]);
    }

    /** POST /api/v2/jobs/employer-reviews — Leave a review for an employer (must have completed a job). */
    public function createEmployerReview(): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAuth();
        $this->rateLimit('jobs_employer_review_create', 5, 60);
        $tenantId = TenantContext::getId();
        $data = $this->getAllInput();

        $employerId = (int) ($data['employer_id'] ?? 0);
        if (!$employerId) {
            return $this->respondWithError('VALIDATION_REQUIRED', __('api_controllers_2.job_vacancies.employer_id_required'), 'employer_id', 422);
        }

        $rating = (int) ($data['rating'] ?? 0);
        if ($rating < 1 || $rating > 5) {
            return $this->respondWithError('VALIDATION_INVALID_VALUE', __('api_controllers_2.job_vacancies.rating_must_be_1_5'), 'rating', 422);
        }

        // Verify the reviewer actually completed a job with this employer
        $hasCompletedJob = JobApplication::whereHas('vacancy', function ($q) use ($employerId, $tenantId) {
                $q->where('user_id', $employerId)->where('tenant_id', $tenantId);
            })
            ->where('user_id', $userId)
            ->where('status', 'accepted')
            ->exists();

        if (!$hasCompletedJob) {
            return $this->respondWithError('NOT_ELIGIBLE', __('api_controllers_2.job_vacancies.only_review_after_completing'), null, 403);
        }

        // Prevent duplicate reviews
        $existing = Review::where('tenant_id', $tenantId)
            ->where('reviewer_id', $userId)
            ->where('receiver_id', $employerId)
            ->where('review_type', 'employer')
            ->exists();

        if ($existing) {
            return $this->respondWithError('DUPLICATE', __('api_controllers_2.job_vacancies.already_reviewed_employer'), null, 409);
        }

        $review = Review::create([
            'tenant_id'   => $tenantId,
            'reviewer_id' => $userId,
            'receiver_id' => $employerId,
            'rating'      => $rating,
            'comment'     => trim($data['comment'] ?? ''),
            'review_type' => 'employer',
            'dimensions'  => [
                'respect'       => max(1, min(5, (int) ($data['respect'] ?? $rating))),
                'communication' => max(1, min(5, (int) ($data['communication'] ?? $rating))),
                'flexibility'   => max(1, min(5, (int) ($data['flexibility'] ?? $rating))),
                'impact'        => max(1, min(5, (int) ($data['impact'] ?? $rating))),
            ],
            'status' => 'approved',
        ]);

        return $this->respondWithData($review->toArray());
    }

    // =====================================================================
    // CALENDAR ICS EXPORT
    // =====================================================================

    /** GET /api/v2/jobs/interviews/{interviewId}/calendar — Download ICS file for interview. */
    public function interviewCalendar(int $interviewId): \Illuminate\Http\Response
    {
        $this->ensureFeature();
        if (!$this->configBool(JobConfigurationService::CONFIG_ENABLE_INTERVIEW_SCHEDULING, true)) {
            return response(__('api.job_interview_scheduling_disabled'), 403);
        }

        $userId = $this->requireAuth();
        $tenantId = TenantContext::getId();

        $interview = \App\Models\JobInterview::with(['vacancy:id,title,location', 'application:id,user_id'])
            ->where('tenant_id', $tenantId)
            ->find($interviewId);

        if (!$interview) {
            return response(__('api.job_interview_not_found'), 404);
        }

        // Must be the candidate or the job poster
        $isCandidate = $interview->application && (int) $interview->application->user_id === $userId;
        $isPoster = $interview->vacancy && (int) $interview->vacancy->user_id === $userId;
        if (!$isCandidate && !$isPoster) {
            return response(__('api.job_access_denied'), 403);
        }

        $title = $this->icsText(__('api.job_interview_calendar_title', [
            'title' => $interview->vacancy->title ?? __('api.job_interview_fallback_title'),
        ]));
        $start = $interview->scheduled_at;
        $end = $start->copy()->addMinutes($interview->duration_mins ?? 60);
        $location = $this->icsText($interview->location_notes ?? $interview->vacancy->location ?? '');
        $type = $this->icsText(ucfirst($interview->interview_type ?? 'video'));
        $description = __('api.job_interview_calendar_description', [
            'type' => $type,
            'duration' => $interview->duration_mins ?? 60,
        ]);
        if ($interview->location_notes) {
            $description .= "\n" . __('api.job_interview_calendar_notes', ['notes' => $interview->location_notes]);
        }
        $description = $this->icsText($description);

        $uid = "interview-{$interview->id}@" . config('app.url', 'project-nexus.ie');
        $now = now()->format('Ymd\THis\Z');
        $dtStart = $start->format('Ymd\THis\Z');
        $dtEnd = $end->format('Ymd\THis\Z');

        $ics = "BEGIN:VCALENDAR\r\n"
            . "VERSION:2.0\r\n"
            . "PRODID:-//Project NEXUS//Jobs//EN\r\n"
            . "CALSCALE:GREGORIAN\r\n"
            . "METHOD:PUBLISH\r\n"
            . "BEGIN:VEVENT\r\n"
            . "UID:{$uid}\r\n"
            . "DTSTAMP:{$now}\r\n"
            . "DTSTART:{$dtStart}\r\n"
            . "DTEND:{$dtEnd}\r\n"
            . "SUMMARY:{$title}\r\n"
            . "DESCRIPTION:{$description}\r\n"
            . "LOCATION:{$location}\r\n"
            . "STATUS:CONFIRMED\r\n"
            . "BEGIN:VALARM\r\n"
            . "TRIGGER:-PT1H\r\n"
            . "ACTION:DISPLAY\r\n"
            . "DESCRIPTION:" . $this->icsText(__('api.job_interview_calendar_reminder_1h')) . "\r\n"
            . "END:VALARM\r\n"
            . "BEGIN:VALARM\r\n"
            . "TRIGGER:-PT15M\r\n"
            . "ACTION:DISPLAY\r\n"
            . "DESCRIPTION:" . $this->icsText(__('api.job_interview_calendar_reminder_15m')) . "\r\n"
            . "END:VALARM\r\n"
            . "END:VEVENT\r\n"
            . "END:VCALENDAR\r\n";

        return response($ics, 200, [
            'Content-Type' => 'text/calendar; charset=utf-8',
            'Content-Disposition' => 'attachment; filename="interview.ics"',
        ]);
    }

    private function icsText(mixed $value): string
    {
        $text = str_replace(["\r\n", "\r"], "\n", (string) $value);
        $text = str_replace('\\', '\\\\', $text);
        $text = str_replace(["\n", ';', ','], ['\\n', '\\;', '\\,'], $text);

        return $text;
    }

    /** GET /api/v2/jobs/interviews/{interviewId}/calendar-links — Get Add-to-Calendar deep links. */
    public function interviewCalendarLinks(int $interviewId): JsonResponse
    {
        $this->ensureFeature();
        if ($response = $this->rejectIfJobConfigDisabled(JobConfigurationService::CONFIG_ENABLE_INTERVIEW_SCHEDULING, 'job_interview_scheduling_disabled')) {
            return $response;
        }

        $userId = $this->requireAuth();
        $tenantId = TenantContext::getId();

        $interview = \App\Models\JobInterview::with(['vacancy:id,title,location,user_id', 'application:id,user_id'])
            ->where('tenant_id', $tenantId)
            ->find($interviewId);

        if (!$interview) {
            return $this->respondWithError('NOT_FOUND', __('api_controllers_2.job_vacancies.interview_not_found'), null, 404);
        }

        // Must be the candidate or the job poster
        $isCandidate = $interview->application && (int) $interview->application->user_id === $userId;
        $isPoster = $interview->vacancy && (int) $interview->vacancy->user_id === $userId;
        if (!$isCandidate && !$isPoster) {
            return $this->respondWithError('FORBIDDEN', __('api_controllers_2.job_vacancies.access_denied'), null, 403);
        }

        $title = __('api.job_interview_calendar_title', [
            'title' => $interview->vacancy->title ?? __('api.job_interview_fallback_title'),
        ]);
        $start = $interview->scheduled_at;
        $end = $start->copy()->addMinutes($interview->duration_mins ?? 60);
        $location = $interview->location_notes ?? '';
        $details = __('api.job_interview_calendar_link_details', [
            'type' => ucfirst($interview->interview_type ?? 'video'),
        ]);

        // Google Calendar link
        $googleParams = http_build_query([
            'action' => 'TEMPLATE',
            'text' => $title,
            'dates' => $start->format('Ymd\THis\Z') . '/' . $end->format('Ymd\THis\Z'),
            'details' => $details,
            'location' => $location,
        ]);
        $googleLink = "https://calendar.google.com/calendar/render?{$googleParams}";

        // Outlook web link
        $outlookParams = http_build_query([
            'subject' => $title,
            'startdt' => $start->toIso8601String(),
            'enddt' => $end->toIso8601String(),
            'body' => $details,
            'location' => $location,
            'path' => '/calendar/action/compose',
            'rru' => 'addevent',
        ]);
        $outlookLink = "https://outlook.live.com/calendar/0/deeplink/compose?{$outlookParams}";

        // ICS download link
        $icsLink = "/api/v2/jobs/interviews/{$interviewId}/calendar";

        return $this->respondWithData([
            'google' => $googleLink,
            'outlook' => $outlookLink,
            'ics' => $icsLink,
        ]);
    }

    // =====================================================================
    // AUDIT TRAIL
    // =====================================================================

    /** GET /api/v2/jobs/{id}/audit-trail — Get activity timeline for a job vacancy. */
    public function auditTrail(int $id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAuth();
        $this->rateLimit('jobs_audit_trail', 30, 60);
        $tenantId = TenantContext::getId();

        $vacancy = \App\Models\JobVacancy::where('tenant_id', $tenantId)->find($id);
        if (!$vacancy) {
            return $this->respondWithError('NOT_FOUND', __('api_controllers_2.job_vacancies.job_not_found'), null, 404);
        }

        // Owner, admin, or hiring-team manager
        if (!$this->canManageVacancy($vacancy, $userId)) {
            return $this->respondWithError('FORBIDDEN', __('api_controllers_2.job_vacancies.access_denied'), null, 403);
        }

        $page = $this->queryInt('page', 1, 1);
        $limit = $this->queryInt('limit', 50, 1, 200);

        // Combine multiple data sources into a unified timeline
        $events = collect();

        // 1. Application history events
        $appHistory = \App\Models\JobApplicationHistory::whereHas('application', fn($q) => $q->where('vacancy_id', $id))
            ->with(['changer:id,first_name,last_name,profile_type,organization_name', 'application:id,user_id', 'application.applicant:id,first_name,last_name,profile_type,organization_name'])
            ->orderByDesc('changed_at')
            ->limit(200)
            ->get();

        foreach ($appHistory as $h) {
            $actorName = $h->changer ? UserDisplayName::resolve($h->changer) : __('api.job_audit_actor_system');
            $candidateName = ($h->application && $h->application->applicant) ? UserDisplayName::resolve($h->application->applicant) : __('api.job_audit_unknown_candidate');
            $events->push([
                'type' => 'status_change',
                'timestamp' => $h->changed_at,
                'actor' => $actorName,
                'description' => __('api.job_audit_status_change', [
                    'candidate' => $candidateName,
                    'from' => $h->from_status,
                    'to' => $h->to_status,
                ]),
                'details' => $h->notes,
            ]);
        }

        // 2. Interview events
        $interviews = \App\Models\JobInterview::where('vacancy_id', $id)
            ->where('tenant_id', $tenantId)
            ->with(['application.applicant:id,first_name,last_name,profile_type,organization_name'])
            ->orderByDesc('created_at')
            ->get();

        foreach ($interviews as $iv) {
            $candidateName = ($iv->application && $iv->application->applicant) ? UserDisplayName::resolve($iv->application->applicant) : __('api.job_audit_unknown_candidate');
            $events->push([
                'type' => 'interview',
                'timestamp' => $iv->created_at,
                'actor' => __('api.job_audit_actor_system'),
                'description' => __('api.job_audit_interview_scheduled', [
                    'type' => $iv->interview_type,
                    'candidate' => $candidateName,
                    'status' => $iv->status,
                ]),
                'details' => $iv->scheduled_at ? __('api.job_audit_scheduled_at', [
                    'date' => $iv->scheduled_at
                        ->locale(\App\I18n\FormattingLocale::carbon())
                        ->isoFormat('lll'),
                ]) : null,
            ]);
        }

        // 3. Offer events
        $offers = \App\Models\JobOffer::where('vacancy_id', $id)
            ->where('tenant_id', $tenantId)
            ->with(['application.applicant:id,first_name,last_name,profile_type,organization_name'])
            ->orderByDesc('created_at')
            ->get();

        foreach ($offers as $offer) {
            $candidateName = ($offer->application && $offer->application->applicant) ? UserDisplayName::resolve($offer->application->applicant) : __('api.job_audit_unknown_candidate');
            $salary = $offer->salary_offered ? '$' . number_format($offer->salary_offered, 0) : '';
            $events->push([
                'type' => 'offer',
                'timestamp' => $offer->created_at,
                'actor' => __('api.job_audit_actor_employer'),
                'description' => __('api.job_audit_offer_sent', [
                    'candidate' => $candidateName,
                    'salary' => $salary,
                    'status' => $offer->status,
                ]),
                'details' => $offer->details,
            ]);
        }

        // Sort all events by timestamp descending and paginate
        $sorted = $events->sortByDesc('timestamp')->values();
        $total = $sorted->count();
        $paginated = $sorted->slice(($page - 1) * $limit, $limit)->values();

        return $this->respondWithPaginatedCollection($paginated->toArray(), $total, $page, $limit);
    }

    /** POST /api/v2/jobs/{id}/ai-chat — AI chat about a specific job vacancy. */
    public function aiJobChat(int $id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAuth();
        $tenantId = TenantContext::getId();

        $vacancy = \App\Models\JobVacancy::where('tenant_id', $tenantId)->find($id);
        if (!$vacancy) return $this->respondWithError('NOT_FOUND', __('api_controllers_2.job_vacancies.job_not_found'), null, 404);

        // Throttle paid LLM calls — any authenticated member can use the advisor.
        $this->rateLimit('jobs_ai_chat', 15, 60);

        if (!\App\Services\AI\AIServiceFactory::isEnabled()) {
            return $this->respondWithError('AI_DISABLED', __('api_controllers_2.job_vacancies.ai_not_configured'), null, 503);
        }

        $data = $this->getAllInput();
        $userMessage = trim($data['message'] ?? '');
        if (empty($userMessage)) {
            return $this->respondWithError('VALIDATION_REQUIRED', __('api_controllers_2.job_vacancies.message_required'), 'message', 422);
        }

        // Build job context for the system prompt
        $jobContext = __('api.job_ai_chat_context', [
            'title' => $vacancy->title,
            'type' => $vacancy->type,
            'commitment' => $vacancy->commitment,
            'location' => $vacancy->location ?? __('api.job_ai_not_specified'),
            'remote' => $vacancy->is_remote ? __('api.job_ai_yes') : __('api.job_ai_no'),
            'skills' => $vacancy->skills_required ?? __('api.job_ai_not_specified'),
            'salary' => $vacancy->salary_min
                ? '$' . number_format($vacancy->salary_min) . ' - $' . number_format($vacancy->salary_max ?? 0)
                : __('api.job_ai_salary_not_disclosed'),
            'description' => substr($vacancy->description ?? '', 0, 1500),
        ]);

        // Get user's profile for personalized advice
        $user = \App\Models\User::find($userId);
        $userContext = '';
        if ($user) {
            $userContext = "\n\n" . __('api.job_ai_chat_user_context', [
                'skills' => $user->skills ?? __('api.job_ai_not_listed'),
                'bio' => substr($user->bio ?? '', 0, 300),
            ]);
        }

        $systemPrompt = __('api.job_ai_chat_system_prompt', [
            'job_context' => $jobContext,
            'user_context' => $userContext,
        ]);

        // Include conversation history if provided
        $messages = [['role' => 'system', 'content' => $systemPrompt]];
        $history = $data['history'] ?? [];
        if (is_array($history)) {
            foreach (array_slice($history, -6) as $msg) {
                if (isset($msg['role'], $msg['content']) && in_array($msg['role'], ['user', 'assistant'])) {
                    $messages[] = ['role' => $msg['role'], 'content' => $msg['content']];
                }
            }
        }
        $messages[] = ['role' => 'user', 'content' => $userMessage];

        try {
            $response = \App\Services\AI\AIServiceFactory::chatWithFallback(
                $messages,
                ['temperature' => 0.7, 'max_tokens' => 800]
            );

            return $this->respondWithData([
                'reply' => $response['content'] ?? $response['message'] ?? '',
                'provider' => $response['provider'] ?? 'unknown',
            ]);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::error('aiJobChat failed', ['error' => $e->getMessage()]);
            return $this->respondWithError('AI_ERROR', __('api_controllers_2.job_vacancies.ai_chat_failed'), null, 500);
        }
    }

    /** GET /api/v2/jobs/{id}/predictions — AI-powered predictions for a job vacancy. */
    public function predictions(int $id): JsonResponse
    {
        $this->ensureFeature();
        $userId = $this->requireAuth();
        $this->rateLimit('jobs_predictions', 10, 60);
        $tenantId = TenantContext::getId();

        $vacancy = \App\Models\JobVacancy::where('tenant_id', $tenantId)->find($id);
        if (!$vacancy) return $this->respondWithError('NOT_FOUND', __('api_controllers_2.job_vacancies.job_not_found'), null, 404);

        // Owner, admin, or hiring-team manager
        if (!$this->canManageVacancy($vacancy, $userId)) {
            return $this->respondWithError('FORBIDDEN', __('api_controllers_2.job_vacancies.access_denied'), null, 403);
        }

        // Gather historical data for similar jobs
        $similarJobs = \App\Models\JobVacancy::where('tenant_id', $tenantId)
            ->where('id', '!=', $id)
            ->where('type', $vacancy->type)
            ->where('status', 'filled')
            ->select('id', 'applications_count', 'views_count', 'created_at', 'updated_at')
            ->limit(50)
            ->get();

        $avgApplications = $similarJobs->avg('applications_count') ?: 0;
        $avgViews = $similarJobs->avg('views_count') ?: 0;
        $avgDaysToFill = $similarJobs->count() > 0
            ? $similarJobs->avg(fn($j) => $j->created_at->diffInDays($j->updated_at))
            : null;

        // Current job metrics
        $currentApps = $vacancy->applications_count ?? 0;
        $currentViews = $vacancy->views_count ?? 0;
        // Carbon v3 `diffInDays` is signed; measure created_at -> now (older ->
        // newer) so days-posted is positive. The reversed form returned negative.
        $daysPosted = $vacancy->created_at ? (int) $vacancy->created_at->diffInDays(now()) : 0;

        // Conversion rate (applications/views) for this job vs average
        $currentConversion = $currentViews > 0 ? round(($currentApps / $currentViews) * 100, 1) : 0;
        $avgConversion = $avgViews > 0 ? round(($avgApplications / $avgViews) * 100, 1) : 0;

        // Salary comparison
        $avgSalary = \App\Models\JobVacancy::where('tenant_id', $tenantId)
            ->where('type', $vacancy->type)
            ->whereNotNull('salary_min')
            ->where('salary_min', '>', 0)
            ->avg('salary_min');

        $salaryComparison = null;
        if ($avgSalary && $vacancy->salary_min) {
            $diff = round((($vacancy->salary_min - $avgSalary) / $avgSalary) * 100, 0);
            $salaryComparison = [
                'your_salary' => $vacancy->salary_min,
                'market_avg' => round($avgSalary, 0),
                'diff_percent' => $diff,
                'label' => $diff > 0 ? __('api.job_prediction_above_average_lower') : ($diff < 0 ? __('api.job_prediction_below_average_lower') : __('api.job_prediction_at_average_lower')),
            ];
        }

        // Build predictions
        $predictions = [
            'expected_applications' => [
                'value' => max(1, round($avgApplications)),
                'current' => $currentApps,
                'label' => $currentApps >= $avgApplications ? __('api.job_prediction_above_average') : __('api.job_prediction_below_average'),
            ],
            'estimated_time_to_fill' => [
                'value' => $avgDaysToFill ? round($avgDaysToFill) : null,
                'days_posted' => $daysPosted,
                'label' => $avgDaysToFill ? __('api.job_prediction_days_based_on_similar', [
                    'days' => round($avgDaysToFill),
                    'count' => $similarJobs->count(),
                ]) : __('api.job_prediction_insufficient_data'),
            ],
            'conversion_rate' => [
                'yours' => $currentConversion,
                'average' => $avgConversion,
                'label' => $currentConversion > $avgConversion ? __('api.job_prediction_above_average') : __('api.job_prediction_below_average'),
            ],
            'salary_comparison' => $salaryComparison,
            'similar_jobs_analyzed' => $similarJobs->count(),
        ];

        // If AI is enabled, generate narrative insights
        if (\App\Services\AI\AIServiceFactory::isEnabled()) {
            try {
                $prompt = __('api.job_prediction_ai_prompt', [
                    'title' => $vacancy->title,
                    'type' => $vacancy->type,
                    'days' => $daysPosted,
                    'applications' => $currentApps,
                    'avg_applications' => round($avgApplications),
                    'views' => $currentViews,
                    'avg_views' => round($avgViews),
                    'conversion' => $currentConversion,
                    'avg_conversion' => $avgConversion,
                    'salary_line' => $salaryComparison ? __('api.job_prediction_ai_salary_line', [
                        'diff' => $salaryComparison['diff_percent'],
                        'label' => $salaryComparison['label'],
                    ]) : '',
                    'similar_count' => $similarJobs->count(),
                ]);

                $aiRes = \App\Services\AI\AIServiceFactory::chatWithFallback(
                    [['role' => 'user', 'content' => $prompt]],
                    ['temperature' => 0.5, 'max_tokens' => 300]
                );

                $content = $aiRes['content'] ?? '';
                if (preg_match('/\[[\s\S]*\]/', $content, $m)) {
                    $insights = json_decode($m[0], true);
                    if (is_array($insights)) {
                        $predictions['ai_insights'] = $insights;
                    }
                }
            } catch (\Throwable $e) {
                // Non-fatal — predictions still work without AI insights
            }
        }

        return $this->respondWithData($predictions);
    }
}
