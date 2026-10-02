<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Services\SocialValueService;
use App\Services\HoursReportService;
use App\Services\InactiveMemberService;
use App\Services\ReportExportService;
use App\Services\MunicipalImpactReportService;
use App\Services\MunicipalReportTemplateService;
use App\Services\MunicipalVerificationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use App\Core\TenantContext;
use App\Services\MemberReportService;
use App\Services\ContentModerationService;
use Illuminate\Database\QueryException;

/**
 * AdminAnalyticsReportsController -- Admin analytics and reporting endpoints.
 *
 * Converted from legacy delegation to direct service calls.
 */
class AdminAnalyticsReportsController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly SocialValueService $socialValueService,
        private readonly HoursReportService $hoursReportService,
        private readonly InactiveMemberService $inactiveMemberService,
        private readonly ReportExportService $reportExportService,
        private readonly MunicipalImpactReportService $municipalImpactReportService,
        private readonly MunicipalReportTemplateService $municipalReportTemplateService,
        private readonly MunicipalVerificationService $municipalVerificationService,
        private readonly MemberReportService $memberReportService,
        private readonly ContentModerationService $contentModerationService,
    ) {}

    // ============================================
    // A1: SOCIAL VALUE / SROI
    // ============================================

    /** GET /v2/admin/reports/social-value */
    public function socialValue(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $dateRange = $this->getDateRange();

        $report = $this->socialValueService->calculateSROI($tenantId, $dateRange);

        return $this->respondWithData($report);
    }

    /** PUT /v2/admin/reports/social-value/config */
    public function updateSocialValueConfig(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $existing = $this->socialValueService->getConfig($tenantId);
        $investmentInput = $this->input('investment_amount', $existing['investment_amount']);

        $config = [
            'hour_value_currency' => $this->input('hour_value_currency', 'GBP'),
            'hour_value_amount' => (float) $this->input('hour_value_amount', 15.00),
            'social_multiplier' => (float) $this->input('social_multiplier', 3.5),
            'reporting_period' => $this->input('reporting_period', 'annually'),
            'investment_amount' => ($investmentInput === null || $investmentInput === '') ? null : (float) $investmentInput,
            'deadweight_pct' => (float) $this->input('deadweight_pct', $existing['deadweight_pct']),
            'displacement_pct' => (float) $this->input('displacement_pct', $existing['displacement_pct']),
            'attribution_pct' => (float) $this->input('attribution_pct', $existing['attribution_pct']),
            'dropoff_pct' => (float) $this->input('dropoff_pct', $existing['dropoff_pct']),
            'discount_rate_pct' => (float) $this->input('discount_rate_pct', $existing['discount_rate_pct']),
            'projection_years' => (int) $this->input('projection_years', $existing['projection_years']),
        ];

        if ($config['hour_value_amount'] <= 0 || $config['hour_value_amount'] > 10000) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.hour_value_range'), 'hour_value_amount', 400);
        }

        if ($config['social_multiplier'] <= 0 || $config['social_multiplier'] > 100) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.social_multiplier_range'), 'social_multiplier', 400);
        }

        if (!in_array($config['reporting_period'], ['monthly', 'quarterly', 'annually'], true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_reporting_period'), 'reporting_period', 400);
        }

        if ($config['investment_amount'] !== null && ($config['investment_amount'] < 0 || $config['investment_amount'] > 100000000)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.sroi_investment_range'), 'investment_amount', 400);
        }

        foreach (['deadweight_pct', 'displacement_pct', 'attribution_pct', 'dropoff_pct'] as $pctField) {
            if ($config[$pctField] < 0 || $config[$pctField] > 100) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.sroi_percentage_range'), $pctField, 400);
            }
        }

        if ($config['discount_rate_pct'] < 0 || $config['discount_rate_pct'] > 20) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.sroi_discount_range'), 'discount_rate_pct', 400);
        }

        if ($config['projection_years'] < 1 || $config['projection_years'] > 10) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.sroi_projection_years_range'), 'projection_years', 400);
        }

        $outcomes = $this->input('outcomes');
        if ($outcomes !== null) {
            if (!is_array($outcomes) || count($outcomes) > 25) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.sroi_outcomes_invalid'), 'outcomes', 400);
            }
            foreach ($outcomes as $outcome) {
                if (!is_array($outcome)
                    || !is_string($outcome['name'] ?? null)
                    || !is_numeric($outcome['quantity'] ?? null)
                    || !is_numeric($outcome['proxy_value'] ?? null)
                    || (float) $outcome['quantity'] < 0
                    || (float) $outcome['proxy_value'] < 0
                ) {
                    return $this->respondWithError('VALIDATION_ERROR', __('api.sroi_outcomes_invalid'), 'outcomes', 400);
                }
            }
        }

        $success = $this->socialValueService->saveConfig($tenantId, $config);

        if ($success && $outcomes !== null) {
            $this->socialValueService->saveOutcomes($tenantId, $outcomes);
        }

        if ($success) {
            return $this->respondWithData(['message' => __('api.social_value_config_updated'), 'config' => $config]);
        }

        return $this->respondWithError('SERVER_ERROR', __('api.failed_to_save_config'), null, 500);
    }

    // ============================================
    // A2: MEMBER REPORTS
    // ============================================

    /** GET /v2/admin/reports/members */
    public function memberReports(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $type = $this->query('type', 'active');
        $period = $this->queryInt('period', 30, 1, 365);
        $months = $this->queryInt('months', 12, 1, 60);
        $page = max(1, $this->queryInt('page', 1));
        $limit = min(200, max(1, $this->queryInt('limit', 50)));
        $offset = ($page - 1) * $limit;

        $data = match ($type) {
            'active' => $this->memberReportService->getActiveMembers($tenantId, $period, $limit, $offset),
            'registrations' => $this->memberReportService->getNewRegistrations($tenantId, $this->query('group_by', 'monthly'), $months),
            'retention' => $this->memberReportService->getMemberRetention($tenantId, $months),
            'engagement' => $this->memberReportService->getEngagementMetrics($tenantId, $period),
            'top_contributors' => ['contributors' => $this->memberReportService->getTopContributors($tenantId, $period, $limit)],
            'least_active' => $this->memberReportService->getLeastActiveMembers($tenantId, $period, $limit, $offset),
            default => null,
        };

        if ($data === null) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.unknown_report_type', ['type' => $type]), 'type', 400);
        }

        return $this->respondWithData($data);
    }

    // ============================================
    // A3: HOURS REPORTS
    // ============================================

    /** GET /v2/admin/reports/hours */
    public function hoursReports(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $groupBy = $this->query('group_by', 'category');
        $dateRange = $this->getDateRange();
        $sortBy = $this->query('sort_by', 'total');
        $limit = min(200, max(1, $this->queryInt('limit', 50)));
        $offset = max(0, ($this->queryInt('page', 1) - 1) * $limit);

        $data = match ($groupBy) {
            'category' => ['categories' => $this->hoursReportService->getHoursByCategory($tenantId, $dateRange)],
            'member' => ['members' => $this->hoursReportService->getHoursByMember($tenantId, $dateRange, $sortBy, $limit, $offset)],
            'period' => ['periods' => $this->hoursReportService->getHoursByPeriod($tenantId, $dateRange)],
            'summary' => $this->hoursReportService->getHoursSummary($tenantId, $dateRange),
            default => null,
        };

        if ($data === null) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.unknown_group_by', ['value' => $groupBy]), 'group_by', 400);
        }

        return $this->respondWithData($data);
    }

    /** GET /v2/admin/reports/municipal-impact */
    public function municipalImpact(): JsonResponse
    {
        $this->requireAdmin();
        if (!TenantContext::hasFeature('caring_community')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }

        $tenantId = TenantContext::getId();
        $filters = [
            'date_from' => $this->query('date_from'),
            'date_to' => $this->query('date_to'),
        ];

        $audienceOverride = $this->query('audience');
        $audienceOverride = is_string($audienceOverride) && $audienceOverride !== '' ? $audienceOverride : null;

        $templateId = $this->queryInt('template_id', 0, 0);
        if ($templateId > 0) {
            $template = $this->municipalReportTemplateService->get($tenantId, $templateId);
            if (!$template) {
                return $this->respondWithError('NOT_FOUND', __('api.municipal_report_template_not_found'), null, 404);
            }

            $filters = array_merge($filters, [
                'date_preset' => $template['date_preset'],
                'include_social_value' => $template['include_social_value'],
                'hour_value_chf' => $template['hour_value_chf'],
                'audience' => $template['audience'],
                'sections' => $template['sections'],
                'template_name' => $template['name'],
            ]);
        }

        // Explicit audience query param wins over template audience.
        if ($audienceOverride !== null) {
            $filters['audience'] = $audienceOverride;
        }

        return $this->respondWithData(
            $this->municipalImpactReportService->summary($tenantId, $filters)
        );
    }

    /** GET /v2/admin/reports/municipal-impact/verification */
    public function municipalVerification(): JsonResponse
    {
        $this->requireAdmin();
        if (!TenantContext::hasFeature('caring_community')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }

        try {
            return $this->respondWithData(
                $this->municipalVerificationService->current(TenantContext::getId())
            );
        } catch (\RuntimeException $e) {
            return $this->respondWithError('FEATURE_UNAVAILABLE', $e->getMessage(), null, 503);
        }
    }

    /** POST /v2/admin/reports/municipal-impact/verification/dns */
    public function startMunicipalDnsVerification(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        if (!TenantContext::hasFeature('caring_community')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }

        $domain = (string) $this->input('domain', '');
        if (trim($domain) === '') {
            return $this->respondWithError('VALIDATION_ERROR', __('api.field_required'), 'domain', 422);
        }

        try {
            $verification = $this->municipalVerificationService->startDnsVerification(
                TenantContext::getId(),
                $adminId,
                $domain
            );
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), 'domain', 422);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('FEATURE_UNAVAILABLE', $e->getMessage(), null, 503);
        }

        return $this->respondWithData([
            'message' => __('api.municipal_verification_dns_started'),
            'verification' => $verification,
        ], null, 201);
    }

    /** POST /v2/admin/reports/municipal-impact/verification/attest */
    public function attestMunicipalVerification(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        if (!TenantContext::hasFeature('caring_community')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }

        $domain = (string) $this->input('domain', '');
        if (trim($domain) === '') {
            return $this->respondWithError('VALIDATION_ERROR', __('api.field_required'), 'domain', 422);
        }

        try {
            $verification = $this->municipalVerificationService->attest(
                TenantContext::getId(),
                $adminId,
                $domain,
                (string) $this->input('attestation_note', '')
            );
        } catch (\InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), 'domain', 422);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('FEATURE_UNAVAILABLE', $e->getMessage(), null, 503);
        }

        return $this->respondWithData([
            'message' => __('api.municipal_verification_attested'),
            'verification' => $verification,
        ]);
    }

    /** POST /v2/admin/reports/municipal-impact/verification/{id}/revoke */
    public function revokeMunicipalVerification(int $id): JsonResponse
    {
        $this->requireAdmin();
        if (!TenantContext::hasFeature('caring_community')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }

        try {
            $revoked = $this->municipalVerificationService->revoke(TenantContext::getId(), $id);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('FEATURE_UNAVAILABLE', $e->getMessage(), null, 503);
        }

        if (!$revoked) {
            return $this->respondWithError('NOT_FOUND', __('api.municipal_verification_not_found'), null, 404);
        }

        return $this->respondWithData(['message' => __('api.municipal_verification_revoked')]);
    }

    /** GET /v2/admin/reports/municipal-impact/templates */
    public function municipalImpactTemplates(): JsonResponse
    {
        $this->requireAdmin();
        if (!TenantContext::hasFeature('caring_community')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }

        return $this->respondWithData([
            'templates' => $this->municipalReportTemplateService->list(TenantContext::getId()),
        ]);
    }

    /** POST /v2/admin/reports/municipal-impact/templates */
    public function createMunicipalImpactTemplate(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        if (!TenantContext::hasFeature('caring_community')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }

        if (trim((string) $this->input('name', '')) === '') {
            return $this->respondWithError('VALIDATION_ERROR', __('api.municipal_report_template_name_required'), 'name', 400);
        }

        try {
            $template = $this->municipalReportTemplateService->create(TenantContext::getId(), $adminId, [
                'name' => $this->input('name'),
                'description' => $this->input('description'),
                'audience' => $this->input('audience'),
                'date_preset' => $this->input('date_preset'),
                'include_social_value' => $this->input('include_social_value', true),
                'hour_value_chf' => $this->input('hour_value_chf'),
                'sections' => $this->input('sections', []),
            ]);
        } catch (QueryException) {
            return $this->respondWithError('ALREADY_EXISTS', __('api.municipal_report_template_exists'), 'name', 409);
        }

        return $this->respondWithData([
            'template' => $template,
            'message' => __('api.municipal_report_template_created'),
        ], null, 201);
    }

    /** PUT /v2/admin/reports/municipal-impact/templates/{id} */
    public function updateMunicipalImpactTemplate(int $id): JsonResponse
    {
        $adminId = $this->requireAdmin();
        if (!TenantContext::hasFeature('caring_community')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }

        if (trim((string) $this->input('name', '')) === '') {
            return $this->respondWithError('VALIDATION_ERROR', __('api.municipal_report_template_name_required'), 'name', 400);
        }

        try {
            $template = $this->municipalReportTemplateService->update(TenantContext::getId(), $adminId, $id, [
                'name' => $this->input('name'),
                'description' => $this->input('description'),
                'audience' => $this->input('audience'),
                'date_preset' => $this->input('date_preset'),
                'include_social_value' => $this->input('include_social_value', true),
                'hour_value_chf' => $this->input('hour_value_chf'),
                'sections' => $this->input('sections', []),
            ]);
        } catch (QueryException) {
            return $this->respondWithError('ALREADY_EXISTS', __('api.municipal_report_template_exists'), 'name', 409);
        }

        if (!$template) {
            return $this->respondWithError('NOT_FOUND', __('api.municipal_report_template_not_found'), null, 404);
        }

        return $this->respondWithData([
            'template' => $template,
            'message' => __('api.municipal_report_template_updated'),
        ]);
    }

    /** DELETE /v2/admin/reports/municipal-impact/templates/{id} */
    public function deleteMunicipalImpactTemplate(int $id): JsonResponse
    {
        $this->requireAdmin();
        if (!TenantContext::hasFeature('caring_community')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }

        if (!$this->municipalReportTemplateService->delete(TenantContext::getId(), $id)) {
            return $this->respondWithError('NOT_FOUND', __('api.municipal_report_template_not_found'), null, 404);
        }

        return $this->respondWithData(['message' => __('api.municipal_report_template_deleted')]);
    }

    // ============================================
    // A4: INACTIVE MEMBERS
    // ============================================

    /** GET /v2/admin/members/inactive */
    public function inactiveMembers(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $days = $this->queryInt('days', 90, 1, 730);
        $flagType = $this->query('flag_type');
        $limit = min(200, max(1, $this->queryInt('limit', 50)));
        $page = max(1, $this->queryInt('page', 1));
        $offset = ($page - 1) * $limit;

        $result = $this->inactiveMemberService->getInactiveMembers($tenantId, $days, $flagType, $limit, $offset);
        $stats = $this->inactiveMemberService->getInactivityStats($tenantId);

        return $this->respondWithData([
            'members' => $result['members'],
            'stats' => $stats,
        ], [
            'page' => $page,
            'per_page' => $limit,
            'total' => $result['total'],
            'total_pages' => $result['total'] > 0 ? (int) ceil($result['total'] / $limit) : 0,
            'has_more' => ($page * $limit) < $result['total'],
            'threshold_days' => $days,
        ]);
    }

    /** POST /v2/admin/members/inactive/detect */
    public function detectInactive(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $thresholdDays = $this->inputInt('threshold_days', 90, 1, 730);

        $result = $this->inactiveMemberService->detectInactive($tenantId, $thresholdDays);

        return $this->respondWithData($result);
    }

    /** POST /v2/admin/members/inactive/notify */
    public function markInactiveNotified(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $userIds = $this->input('user_ids', []);

        if (empty($userIds) || !is_array($userIds)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.user_ids_required'), 'user_ids', 400);
        }

        $userIds = array_map('intval', $userIds);

        $updated = $this->inactiveMemberService->markNotified($tenantId, $userIds);

        return $this->respondWithData([
            'updated' => $updated,
            'message' => __('api_controllers_1.admin_analytics_reports.members_marked_notified', ['count' => $updated]),
        ]);
    }

    // ============================================
    // A5: CSV EXPORT
    // ============================================

    /** GET /v2/admin/reports/{type}/export */
    public function exportReport(string $type)
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $format = $this->query('format', 'csv');

        if (!in_array($format, ['csv', 'pdf', 'xlsx'], true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.supported_formats_csv_pdf_xlsx'), 'format', 400);
        }

        $supportedTypes = $this->reportExportService->getSupportedTypes();
        if (!isset($supportedTypes[$type])) {
            $validTypes = implode(', ', array_keys($supportedTypes));
            return $this->respondWithError('VALIDATION_ERROR', __('api.unknown_export_type', ['type' => $type, 'valid' => $validTypes]), 'type', 400);
        }

        if ($type === 'municipal_impact' && !TenantContext::hasFeature('caring_community')) {
            return $this->respondWithError('FEATURE_DISABLED', __('api.service_unavailable'), null, 403);
        }

        $filters = [
            'date_from' => $this->query('date_from'),
            'date_to' => $this->query('date_to'),
            'status' => $this->query('status'),
            'days' => $this->queryInt('days', 90),
        ];

        if ($type === 'municipal_impact') {
            $audienceOverride = $this->query('audience');
            $audienceOverride = is_string($audienceOverride) && $audienceOverride !== '' ? $audienceOverride : null;

            $templateId = $this->queryInt('template_id', 0, 0);
            if ($templateId > 0) {
                $template = $this->municipalReportTemplateService->get($tenantId, $templateId);
                if (!$template) {
                    return $this->respondWithError('NOT_FOUND', __('api.municipal_report_template_not_found'), null, 404);
                }

                $filters = array_merge($filters, [
                    'date_preset' => $template['date_preset'],
                    'include_social_value' => $template['include_social_value'],
                    'hour_value_chf' => $template['hour_value_chf'],
                    'audience' => $template['audience'],
                    'sections' => $template['sections'],
                    'template_name' => $template['name'],
                ]);
            }

            if ($audienceOverride !== null) {
                $filters['audience'] = $audienceOverride;
            }
        }

        if ($format === 'pdf') {
            $result = $this->reportExportService->exportPdf($type, $tenantId, $filters);
            if (!$result['success']) {
                return $this->respondWithError('NO_DATA', $result['message'] ?? __('api.no_data_for_export'), null, 404);
            }
            return response($result['pdf'], 200, [
                'Content-Type' => 'application/pdf',
                'Content-Disposition' => 'attachment; filename="' . $result['filename'] . '"',
                'Cache-Control' => 'no-cache, no-store, must-revalidate',
                'Pragma' => 'no-cache',
                'Expires' => '0',
                'Content-Length' => strlen($result['pdf']),
            ]);
        }

        if ($format === 'xlsx') {
            $result = $this->reportExportService->exportXlsx($type, $tenantId, $filters);
            if (!$result['success']) {
                return $this->respondWithError('NO_DATA', $result['message'] ?? __('api.no_data_for_export'), null, 404);
            }
            return response($result['xlsx'], 200, [
                'Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition' => 'attachment; filename="' . $result['filename'] . '"',
                'Cache-Control' => 'no-cache, no-store, must-revalidate',
                'Pragma' => 'no-cache',
                'Expires' => '0',
                'Content-Length' => strlen($result['xlsx']),
            ]);
        }

        $result = $this->reportExportService->export($type, $tenantId, $filters);

        if (!$result['success']) {
            return $this->respondWithError('NO_DATA', $result['message'] ?? __('api.no_data_for_export'), null, 404);
        }

        return response($result['csv'], 200, [
            'Content-Type' => 'text/csv; charset=utf-8',
            'Content-Disposition' => 'attachment; filename="' . $result['filename'] . '"',
            'Cache-Control' => 'no-cache, no-store, must-revalidate',
            'Pragma' => 'no-cache',
            'Expires' => '0',
            'Content-Length' => strlen($result['csv']),
        ]);
    }

    /** GET /v2/admin/reports/export-types */
    public function exportTypes(): JsonResponse
    {
        $this->requireAdmin();

        $types = $this->reportExportService->getSupportedTypes();
        if (!TenantContext::hasFeature('caring_community')) {
            unset($types['municipal_impact']);
        }

        $formatted = [];
        foreach ($types as $key => $label) {
            $formatted[] = ['type' => $key, 'label' => $label];
        }

        return $this->respondWithData($formatted);
    }

    // ============================================
    // A7: CONTENT MODERATION
    // ============================================

    /** GET /v2/admin/moderation/queue */
    public function moderationQueue(): JsonResponse
    {
        $this->requireBrokerOrAdmin();
        $tenantId = TenantContext::getId();

        $filters = [
            'status' => $this->query('status'),
            'content_type' => $this->query('content_type'),
            'search' => $this->query('search'),
        ];

        $limit = min(200, max(1, $this->queryInt('limit', 50)));
        $page = max(1, $this->queryInt('page', 1));
        $offset = ($page - 1) * $limit;

        $result = $this->contentModerationService->getQueue($tenantId, $filters, $limit, $offset);

        return $this->respondWithPaginatedCollection($result['items'], $result['total'], $page, $limit);
    }

    /** POST /v2/admin/moderation/{id}/review */
    public function moderationReview(int $id): JsonResponse
    {
        $adminId = $this->requireBrokerOrAdmin();
        $tenantId = TenantContext::getId();

        // Self-dealing guard: a broker/coordinator must not approve/reject
        // their OWN queued content — moderation must never double as
        // self-approval. Admin tiers retain full latitude. Mirrors the
        // match-approval guard. See BrokerModerationAuthorizationTest.
        if (!$this->callerIsAdminTier()) {
            $authorId = DB::table('content_moderation_queue')
                ->where('id', $id)
                ->where('tenant_id', $tenantId)
                ->value('author_id');
            if ($authorId !== null && (int) $authorId === $adminId) {
                return $this->respondWithError('AUTH_INSUFFICIENT_PERMISSIONS', __('api.broker_cannot_moderate_own_content'), null, 403);
            }
        }

        $decision = $this->input('decision');
        $rejectionReason = $this->input('rejection_reason');

        if (!$decision) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.decision_required'), 'decision', 400);
        }

        // Only the two statuses that ContentModerationService::review() accepts.
        $allowedDecisions = [
            \App\Services\ContentModerationService::STATUS_APPROVED,
            \App\Services\ContentModerationService::STATUS_REJECTED,
        ];
        if (!in_array($decision, $allowedDecisions, true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_decision'), 'decision', 422);
        }

        $result = $this->contentModerationService->review($id, $tenantId, $adminId, $decision, $rejectionReason);

        if ($result['success']) {
            return $this->respondWithData($result);
        }

        return $this->respondWithError('REVIEW_FAILED', $result['message'], null, 400);
    }

    /** GET /v2/admin/moderation/stats */
    public function moderationStats(): JsonResponse
    {
        $this->requireBrokerOrAdmin();
        $tenantId = TenantContext::getId();

        $stats = $this->contentModerationService->getStats($tenantId);

        return $this->respondWithData($stats);
    }

    /** GET /v2/admin/moderation/settings */
    public function moderationSettings(): JsonResponse
    {
        $this->requireBrokerOrAdmin(); // F-543
        $tenantId = TenantContext::getId();

        $settings = $this->contentModerationService->getModerationSettings($tenantId);

        return $this->respondWithData($settings);
    }

    /** PUT /v2/admin/moderation/settings */
    public function updateModerationSettings(): JsonResponse
    {
        $this->requireBrokerOrAdmin(); // F-543
        $tenantId = TenantContext::getId();

        // Allowlist matches ContentModerationService::updateSettings() accepted keys.
        $allowedKeys = ['enabled', 'require_post', 'require_listing', 'require_event', 'require_comment', 'auto_filter'];
        $settings = array_intersect_key($this->getAllInput(), array_flip($allowedKeys));

        $success = $this->contentModerationService->updateSettings($tenantId, $settings);

        if ($success) {
            $updatedSettings = $this->contentModerationService->getModerationSettings($tenantId);
            return $this->respondWithData([
                'message' => __('api.moderation_settings_updated'),
                'settings' => $updatedSettings,
            ]);
        }

        return $this->respondWithError('SERVER_ERROR', __('api.failed_update_moderation'), null, 500);
    }

    // ============================================
    // HELPERS
    // ============================================

    private function getDateRange(): array
    {
        $range = [];
        $from = $this->query('date_from');
        $to = $this->query('date_to');
        if ($from) {
            $range['from'] = $from;
        }
        if ($to) {
            $range['to'] = $to;
        }
        return $range;
    }

}
