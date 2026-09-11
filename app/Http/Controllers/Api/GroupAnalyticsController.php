<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use App\Services\GroupAccessService;
use App\Services\GroupAnalyticsService;
use App\Support\CsvExportSanitizer;

/**
 * GroupAnalyticsController — Dashboard, growth, engagement, retention, and export analytics for groups.
 *
 * All endpoints require group admin/owner role.
 */
class GroupAnalyticsController extends BaseApiController
{
    protected bool $isV2Api = true;

    /**
     * Verify user is admin/owner of the group.
     */
    private function requireGroupAdmin(int $groupId, int $userId): ?JsonResponse
    {
        if (!GroupAccessService::canManage($groupId, $userId)) {
            return $this->errorResponse(__('api.group_analytics_admin_required'), 403);
        }
        return null;
    }

    /**
     * GET /api/v2/groups/{id}/analytics
     */
    public function dashboard(int $id): JsonResponse
    {
        $userId = $this->requireUserId();
        if ($userId instanceof JsonResponse) return $userId;
        $authCheck = $this->requireGroupAdmin($id, $userId);
        if ($authCheck) return $authCheck;

        $days = (int) $this->queryInt('days', 30, GroupAnalyticsService::MIN_DAYS, GroupAnalyticsService::MAX_DAYS);
        $result = GroupAnalyticsService::getDashboard($id, $days);

        return $this->successResponse($result);
    }

    /**
     * GET /api/v2/groups/{id}/analytics/growth
     */
    public function growth(int $id): JsonResponse
    {
        $userId = $this->requireUserId();
        if ($userId instanceof JsonResponse) return $userId;
        $authCheck = $this->requireGroupAdmin($id, $userId);
        if ($authCheck) return $authCheck;

        return $this->successResponse(GroupAnalyticsService::getMemberGrowth($id, (int) $this->queryInt('days', 30, GroupAnalyticsService::MIN_DAYS, GroupAnalyticsService::MAX_DAYS)));
    }

    public function engagement(int $id): JsonResponse
    {
        $userId = $this->requireUserId();
        if ($userId instanceof JsonResponse) return $userId;
        $authCheck = $this->requireGroupAdmin($id, $userId);
        if ($authCheck) return $authCheck;

        return $this->successResponse(GroupAnalyticsService::getEngagementMetrics($id, (int) $this->queryInt('days', 30, GroupAnalyticsService::MIN_DAYS, GroupAnalyticsService::MAX_DAYS)));
    }

    public function contributors(int $id): JsonResponse
    {
        $userId = $this->requireUserId();
        if ($userId instanceof JsonResponse) return $userId;
        $authCheck = $this->requireGroupAdmin($id, $userId);
        if ($authCheck) return $authCheck;

        return $this->successResponse(GroupAnalyticsService::getTopContributors(
            $id,
            (int) $this->queryInt('days', 30, GroupAnalyticsService::MIN_DAYS, GroupAnalyticsService::MAX_DAYS),
            (int) $this->queryInt('limit', 10, GroupAnalyticsService::MIN_LIMIT, GroupAnalyticsService::MAX_LIMIT),
        ));
    }

    public function retention(int $id): JsonResponse
    {
        $userId = $this->requireUserId();
        if ($userId instanceof JsonResponse) return $userId;
        $authCheck = $this->requireGroupAdmin($id, $userId);
        if ($authCheck) return $authCheck;

        return $this->successResponse(GroupAnalyticsService::getRetentionMetrics(
            $id,
            (int) $this->queryInt('months', 6, GroupAnalyticsService::MIN_MONTHS, GroupAnalyticsService::MAX_MONTHS),
        ));
    }

    public function comparative(int $id): JsonResponse
    {
        $userId = $this->requireUserId();
        if ($userId instanceof JsonResponse) return $userId;
        $authCheck = $this->requireGroupAdmin($id, $userId);
        if ($authCheck) return $authCheck;

        return $this->successResponse(GroupAnalyticsService::getComparativeAnalytics($id));
    }

    /**
     * GET /api/v2/groups/{id}/analytics/export-members
     */
    public function exportMembers(int $id): JsonResponse|\Symfony\Component\HttpFoundation\StreamedResponse
    {
        $userId = $this->requireUserId();
        if ($userId instanceof JsonResponse) return $userId;
        $authCheck = $this->requireGroupAdmin($id, $userId);
        if ($authCheck) return $authCheck;

        $members = GroupAnalyticsService::exportMembers($id);

        return response()->streamDownload(function () use ($members) {
            $output = fopen('php://output', 'w');

            if (!empty($members) && is_array($members[0] ?? null)) {
                \App\Support\CsvExportSanitizer::put($output, array_keys($members[0]));
            } elseif (!empty($members) && is_object($members[0] ?? null)) {
                \App\Support\CsvExportSanitizer::put($output, array_keys((array) $members[0]));
            }

            foreach ($members as $row) {
                \App\Support\CsvExportSanitizer::put($output, CsvExportSanitizer::row((array) $row));
            }

            fclose($output);
        }, 'group-' . $id . '-members.csv', [
            'Content-Type' => 'text/csv',
        ]);
    }

    /**
     * GET /api/v2/groups/{id}/analytics/export-activity
     */
    public function exportActivity(int $id): JsonResponse|\Symfony\Component\HttpFoundation\StreamedResponse
    {
        $userId = $this->requireUserId();
        if ($userId instanceof JsonResponse) return $userId;
        $authCheck = $this->requireGroupAdmin($id, $userId);
        if ($authCheck) return $authCheck;

        $days = (int) $this->queryInt('days', 30, GroupAnalyticsService::MIN_DAYS, GroupAnalyticsService::MAX_DAYS);
        $activity = GroupAnalyticsService::exportActivity($id, $days);

        return response()->streamDownload(function () use ($activity) {
            $output = fopen('php://output', 'w');

            if (!empty($activity) && is_array($activity[0] ?? null)) {
                \App\Support\CsvExportSanitizer::put($output, array_keys($activity[0]));
            } elseif (!empty($activity) && is_object($activity[0] ?? null)) {
                \App\Support\CsvExportSanitizer::put($output, array_keys((array) $activity[0]));
            }

            foreach ($activity as $row) {
                \App\Support\CsvExportSanitizer::put($output, CsvExportSanitizer::row((array) $row));
            }

            fclose($output);
        }, 'group-' . $id . '-activity.csv', [
            'Content-Type' => 'text/csv',
        ]);
    }
}
