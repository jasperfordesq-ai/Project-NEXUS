<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use App\Services\JobBiasAuditService;
use App\Services\JobInterviewService;
use App\Services\JobModerationService;
use App\Services\JobOfferService;
use App\Services\JobSpamDetectionService;
use App\Services\JobTemplateService;
use App\Services\JobVacancyService;
use App\Core\TenantContext;
use App\Models\JobApplication;
use App\Models\JobInterview;
use App\Models\JobOffer;
use App\Models\JobTemplate;
use App\Models\JobVacancy;
use Illuminate\Support\Facades\DB;
use App\Support\UserDisplayName;

/**
 * AdminJobsController -- Admin job vacancy management.
 *
 * All methods require admin authentication.
 */
class AdminJobsController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly JobVacancyService $jobVacancyService,
        private readonly JobBiasAuditService $biasAuditService,
    ) {}

    private function requireAdminForJobs(): int
    {
        $adminId = $this->requireAdmin();

        if (!TenantContext::hasFeature('job_vacancies')) {
            throw new \Illuminate\Http\Exceptions\HttpResponseException(
                $this->respondWithError('FEATURE_DISABLED', __('api.job_feature_disabled'), null, 403)
            );
        }

        return $adminId;
    }

    /** GET /api/v2/admin/jobs */
    public function index(): JsonResponse
    {
        $this->requireAdminForJobs();

        $page = $this->queryInt('page', 1, 1);
        $limit = $this->queryInt('limit', 50, 1, 200);

        $filters = [
            'limit'  => $limit,
            'offset' => ($page - 1) * $limit,
        ];
        if ($this->query('status')) $filters['status'] = $this->query('status');
        if ($this->query('search')) $filters['search'] = $this->query('search');

        $result = $this->jobVacancyService->getAll($filters);
        $total  = $result['total'] ?? 0;

        return $this->respondWithPaginatedCollection($result['items'], $total, $page, $limit);
    }

    /** GET /api/v2/admin/jobs/{id} */
    public function show(int $id): JsonResponse
    {
        $this->requireAdminForJobs();
        $job = $this->jobVacancyService->getById($id);
        if (!$job) return $this->respondWithError('NOT_FOUND', __('api.job_not_found'), null, 404);
        return $this->respondWithData($job);
    }

    /** DELETE /api/v2/admin/jobs/{id} */
    public function destroy(int $id): JsonResponse
    {
        $adminId = $this->requireAdminForJobs();
        $job = $this->jobVacancyService->getById($id);
        if (!$job) return $this->respondWithError('NOT_FOUND', __('api.job_not_found'), null, 404);

        $deleted = $this->jobVacancyService->delete($id, $adminId);
        if ($deleted) return $this->respondWithData(['deleted' => true, 'id' => $id]);
        return $this->respondWithError('DELETE_FAILED', __('api.delete_failed', ['resource' => 'job']), null, 400);
    }

    /** POST /api/v2/admin/jobs/{id}/feature */
    public function feature(int $id): JsonResponse
    {
        $adminId = $this->requireAdminForJobs();
        $days = $this->inputInt('duration_days', 7, 1, 90);

        $featured = $this->jobVacancyService->featureJob($id, $adminId, $days);
        if ($featured) return $this->respondWithData(['featured' => true, 'id' => $id, 'duration_days' => $days]);
        return $this->respondWithError('FEATURE_FAILED', __('api.update_failed', ['resource' => 'job feature']), null, 400);
    }

    /** POST /api/v2/admin/jobs/{id}/unfeature */
    public function unfeature(int $id): JsonResponse
    {
        $adminId = $this->requireAdminForJobs();
        $unfeatured = $this->jobVacancyService->unfeatureJob($id, $adminId);
        if ($unfeatured) return $this->respondWithData(['featured' => false, 'id' => $id]);
        return $this->respondWithError('UNFEATURE_FAILED', __('api.update_failed', ['resource' => 'job feature']), null, 400);
    }

    /** GET /api/v2/admin/jobs/{id}/applications */
    public function getApplications(int $id): JsonResponse
    {
        $adminId = $this->requireAdminForJobs();
        $job = $this->jobVacancyService->getById($id);
        if (!$job) return $this->respondWithError('NOT_FOUND', __('api.job_not_found'), null, 404);

        $applications = $this->jobVacancyService->getApplications($id, $adminId);
        if ($applications === null) return $this->respondWithError('FETCH_FAILED', __('api.fetch_failed', ['resource' => 'applications']), null, 400);
        return $this->respondWithData($applications);
    }

    /** PUT /api/v2/admin/jobs/applications/{id} */
    public function updateApplicationStatus(int $id): JsonResponse
    {
        $adminId = $this->requireAdminForJobs();
        $status = $this->input('status');
        $notes = $this->input('notes');

        if (!$status) return $this->respondWithError('VALIDATION_REQUIRED', __('api.status_required'), 'status', 422);

        $updated = $this->jobVacancyService->updateApplicationStatus($id, $adminId, $status, $notes);
        if ($updated) return $this->respondWithData(['updated' => true, 'id' => $id, 'status' => $status]);

        $errors = $this->jobVacancyService->getErrors();
        $first = $errors[0] ?? [];
        return $this->respondWithError($first['code'] ?? 'UPDATE_FAILED', $first['message'] ?? __('errors.generic.update_failed'), null, 400);
    }

    // =====================================================================
    // MODERATION QUEUE (Agent B)
    // =====================================================================

    /** GET /api/v2/admin/jobs/moderation-queue */
    public function moderationQueue(): JsonResponse
    {
        $this->requireAdminForJobs();

        $tenantId = TenantContext::getId();
        $limit = $this->queryInt('limit', 50, 1, 200);
        $offset = $this->queryInt('offset', 0, 0);

        $result = JobModerationService::getPendingJobs($tenantId, $limit, $offset);

        return $this->respondWithData($result);
    }

    /** POST /api/v2/admin/jobs/{id}/approve */
    public function approve(int $id): JsonResponse
    {
        $adminId = $this->requireAdminForJobs();
        $notes = $this->input('notes');

        $approved = JobModerationService::approveJob($id, $adminId, $notes);

        if ($approved) {
            return $this->respondWithData([
                'approved' => true,
                'id' => $id,
                'message' => __('api.job_approved'),
            ]);
        }

        return $this->respondWithError('APPROVE_FAILED', __('api.approve_failed', ['resource' => 'job']), null, 400);
    }

    /** POST /api/v2/admin/jobs/{id}/reject */
    public function reject(int $id): JsonResponse
    {
        $adminId = $this->requireAdminForJobs();
        $reason = $this->input('reason');

        if (empty($reason)) {
            return $this->respondWithError('VALIDATION_REQUIRED', __('api.reason_required_reject_job'), 'reason', 422);
        }

        $rejected = JobModerationService::rejectJob($id, $adminId, $reason);

        if ($rejected) {
            return $this->respondWithData([
                'rejected' => true,
                'id' => $id,
                'message' => __('api.job_rejected'),
            ]);
        }

        return $this->respondWithError('REJECT_FAILED', __('api.reject_failed', ['resource' => 'job']), null, 400);
    }

    /** POST /api/v2/admin/jobs/{id}/flag */
    public function flag(int $id): JsonResponse
    {
        $adminId = $this->requireAdminForJobs();
        $reason = $this->input('reason');

        if (empty($reason)) {
            return $this->respondWithError('VALIDATION_REQUIRED', __('api.reason_required_flag_job'), 'reason', 422);
        }

        $flagged = JobModerationService::flagJob($id, $adminId, $reason);

        if ($flagged) {
            return $this->respondWithData([
                'flagged' => true,
                'id' => $id,
                'message' => __('api.job_flagged'),
            ]);
        }

        return $this->respondWithError('FLAG_FAILED', __('api.update_failed', ['resource' => 'job flag']), null, 400);
    }

    /** GET /api/v2/admin/jobs/moderation-stats */
    public function moderationStats(): JsonResponse
    {
        $this->requireAdminForJobs();

        $tenantId = TenantContext::getId();
        $stats = JobModerationService::getModerationStats($tenantId);

        return $this->respondWithData($stats);
    }

    // =====================================================================
    // SPAM DETECTION STATS (Agent B)
    // =====================================================================

    /** GET /api/v2/admin/jobs/spam-stats */
    public function spamStats(): JsonResponse
    {
        $this->requireAdminForJobs();

        $tenantId = TenantContext::getId();
        $stats = JobSpamDetectionService::getSpamStats($tenantId);

        return $this->respondWithData($stats);
    }

    // =====================================================================
    // BIAS AUDIT (Agent D)
    // =====================================================================

    /**
     * GET /api/v2/admin/jobs/bias-audit — Generate hiring bias audit report.
     *
     * Query params:
     *   job_id    (int, optional) — filter to a specific job
     *   date_from (string, optional) — start date (Y-m-d), defaults to 12 months ago
     *   date_to   (string, optional) — end date (Y-m-d), defaults to today
     */
    public function biasAudit(): JsonResponse
    {
        $this->requireAdminForJobs();
        // Rate-limit: report aggregates candidate demographics, so prevent
        // rapid enumeration that could be used to harvest PII patterns.
        $this->rateLimit('jobs_bias_audit', 10, 60);
        $tenantId = $this->getTenantId();

        $jobId = $this->query('job_id') ? $this->queryInt('job_id') : null;
        $dateFrom = $this->query('date_from');
        $dateTo = $this->query('date_to');

        $report = $this->biasAuditService->generateReport($tenantId, $jobId, $dateFrom, $dateTo);

        return $this->respondWithData($report);
    }

    // =====================================================================
    // AGGREGATE STATS (Phase 1)
    // =====================================================================

    /** GET /api/v2/admin/jobs/stats — Platform-wide job statistics. */
    public function stats(): JsonResponse
    {
        $this->requireAdminForJobs();
        $tenantId = TenantContext::getId();

        $totalJobs = JobVacancy::where('tenant_id', $tenantId)->count();
        $openJobs = JobVacancy::where('tenant_id', $tenantId)->where('status', 'open')->count();
        $totalApplications = JobApplication::whereHas('vacancy', fn($q) => $q->where('tenant_id', $tenantId))->count();

        // Conversion rate: applications / total views
        $totalViews = (int) JobVacancy::where('tenant_id', $tenantId)->sum('views_count');
        $conversionRate = $totalViews > 0 ? round(($totalApplications / $totalViews) * 100, 1) : 0;

        // Average time to fill (days) for filled vacancies (using updated_at as proxy)
        $avgTimeToFill = JobVacancy::where('tenant_id', $tenantId)
            ->where('status', 'filled')
            ->selectRaw('AVG(DATEDIFF(updated_at, created_at)) as avg_days')
            ->value('avg_days');

        // Active interviews count
        $activeInterviews = JobInterview::where('tenant_id', $tenantId)
            ->whereIn('status', ['proposed', 'accepted'])
            ->count();

        // Pending offers count
        $pendingOffers = JobOffer::where('tenant_id', $tenantId)
            ->where('status', 'pending')
            ->count();

        // Applications by stage breakdown
        $stageBreakdown = JobApplication::whereHas('vacancy', fn($q) => $q->where('tenant_id', $tenantId))
            ->select('status', DB::raw('COUNT(*) as count'))
            ->groupBy('status')
            ->pluck('count', 'status')
            ->toArray();

        return $this->respondWithData([
            'total_jobs'         => $totalJobs,
            'open_jobs'          => $openJobs,
            'total_applications' => $totalApplications,
            'total_views'        => $totalViews,
            'conversion_rate'    => $conversionRate,
            'avg_time_to_fill'   => $avgTimeToFill ? round((float) $avgTimeToFill, 1) : null,
            'active_interviews'  => $activeInterviews,
            'pending_offers'     => $pendingOffers,
            'stage_breakdown'    => $stageBreakdown,
        ]);
    }

    // =====================================================================
    // INTERVIEW & OFFER OVERSIGHT (Phase 3)
    // =====================================================================

    /** GET /api/v2/admin/jobs/interviews — All interviews across jobs. */
    public function interviews(): JsonResponse
    {
        $this->requireAdminForJobs();
        $tenantId = TenantContext::getId();

        $page = $this->queryInt('page', 1, 1);
        $limit = $this->queryInt('limit', 50, 1, 200);
        $statusFilter = $this->query('status');

        $query = JobInterview::with([
                'application:id,user_id,vacancy_id,status',
                'application.applicant:id,first_name,last_name,profile_type,organization_name,avatar_url,email',
                'vacancy:id,title,user_id',
            ])
            ->where('tenant_id', $tenantId)
            ->orderByDesc('scheduled_at');

        if ($statusFilter) {
            $query->where('status', $statusFilter);
        }

        $total = $query->count();
        $items = $query->skip(($page - 1) * $limit)->take($limit)->get()->map(function ($interview) {
            $arr = $interview->toArray();
            $arr['candidate_name'] = null;
            $arr['candidate_email'] = null;
            $arr['job_title'] = $interview->vacancy->title ?? null;
            if ($interview->application && $interview->application->applicant) {
                $a = $interview->application->applicant;
                $arr['candidate_name'] = UserDisplayName::resolve($a);
                $arr['candidate_email'] = $a->email ?? null;
            }
            return $arr;
        })->toArray();

        return $this->respondWithPaginatedCollection($items, $total, $page, $limit);
    }

    /** GET /api/v2/admin/jobs/offers — All offers across jobs. */
    public function offers(): JsonResponse
    {
        $this->requireAdminForJobs();
        $tenantId = TenantContext::getId();

        $page = $this->queryInt('page', 1, 1);
        $limit = $this->queryInt('limit', 50, 1, 200);
        $statusFilter = $this->query('status');

        $query = JobOffer::with([
                'application:id,user_id,vacancy_id,status',
                'application.applicant:id,first_name,last_name,profile_type,organization_name,avatar_url,email',
                'vacancy:id,title,user_id',
            ])
            ->where('tenant_id', $tenantId)
            ->orderByDesc('created_at');

        if ($statusFilter) {
            $query->where('status', $statusFilter);
        }

        $total = $query->count();
        $items = $query->skip(($page - 1) * $limit)->take($limit)->get()->map(function ($offer) {
            $arr = $offer->toArray();
            $arr['candidate_name'] = null;
            $arr['candidate_email'] = null;
            $arr['job_title'] = $offer->vacancy->title ?? null;
            if ($offer->application && $offer->application->applicant) {
                $a = $offer->application->applicant;
                $arr['candidate_name'] = UserDisplayName::resolve($a);
                $arr['candidate_email'] = $a->email ?? null;
            }
            return $arr;
        })->toArray();

        return $this->respondWithPaginatedCollection($items, $total, $page, $limit);
    }

    // =====================================================================
    // TEMPLATE MANAGEMENT (Phase 4)
    // =====================================================================

    /** GET /api/v2/admin/jobs/templates — List all job templates. */
    public function templates(): JsonResponse
    {
        $this->requireAdminForJobs();
        $tenantId = TenantContext::getId();

        $page = $this->queryInt('page', 1, 1);
        $limit = $this->queryInt('limit', 50, 1, 200);

        $query = JobTemplate::with('creator:id,first_name,last_name,profile_type,organization_name')
            ->where('tenant_id', $tenantId)
            ->orderByDesc('use_count')
            ->orderByDesc('updated_at');

        $search = trim((string) $this->query('search', ''));
        if ($search !== '') {
            $query->where(function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                    ->orWhere('description', 'like', "%{$search}%")
                    ->orWhere('category', 'like', "%{$search}%")
                    ->orWhere('skills_required', 'like', "%{$search}%");
            });
        }

        $total = $query->count();
        $items = $query->skip(($page - 1) * $limit)->take($limit)->get()->map(function ($t) {
            $arr = $t->toArray();
            $arr['creator_name'] = $t->creator
                ? UserDisplayName::resolve($t->creator)
                : null;
            return $arr;
        })->toArray();

        return $this->respondWithPaginatedCollection($items, $total, $page, $limit);
    }

    /** DELETE /api/v2/admin/jobs/templates/{id} */
    public function deleteTemplate(int $id): JsonResponse
    {
        $this->requireAdminForJobs();
        $tenantId = TenantContext::getId();

        $deleted = JobTemplate::where('tenant_id', $tenantId)
            ->where('id', $id)
            ->delete();

        if ($deleted) {
            return $this->respondWithData(['deleted' => true, 'id' => $id]);
        }

        return $this->respondWithError('NOT_FOUND', __('api.job_not_found'), null, 404);
    }
}
