<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use App\Services\MemberActivityService;

/**
 * MemberActivityController -- Member activity dashboard.
 *
 * Converted from legacy delegation to direct static service calls.
 */
class MemberActivityController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly MemberActivityService $memberActivityService,
    ) {}

    /** GET /api/v2/users/me/activity/dashboard */
    public function getDashboard(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('activity_dashboard', 10, 60);

        $data = $this->memberActivityService->getDashboardData($userId);

        return $this->respondWithData($data);
    }

    /** GET /api/v2/users/me/activity/timeline */
    public function getTimeline(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('activity_timeline', 20, 60);

        $limit = $this->queryInt('limit', 30, 1, 100);
        $timeline = $this->memberActivityService->getRecentTimeline($userId, null, $limit);

        return $this->respondWithData($timeline);
    }

    /** GET /api/v2/users/me/activity/hours */
    public function getHours(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('activity_hours', 20, 60);

        $summary = $this->memberActivityService->getHoursSummary($userId);

        return $this->respondWithData($summary);
    }

    /** GET /api/v2/users/me/activity/monthly */
    public function getMonthlyHours(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('activity_monthly', 10, 60);

        $monthly = $this->memberActivityService->getMonthlyHours($userId);

        return $this->respondWithData($monthly);
    }

    /** GET /api/v2/users/{id}/activity/dashboard */
    public function getPublicDashboard(int $id): JsonResponse
    {
        $this->rateLimit('activity_public_dashboard', 20, 60);

        // A member id from another community answered 200 with every counter
        // at zero — indistinguishable from a real member with no activity.
        // Refuse it instead (CrossCommunityAccessSweepTest, 2026-09-10).
        if (! \App\Models\User::query()
            ->where('id', $id)
            ->where('tenant_id', $this->getTenantId())
            ->exists()) {
            return $this->respondWithError('NOT_FOUND', __('api.user_not_found'), null, 404);
        }

        $data = $this->memberActivityService->getDashboardData($id);

        return $this->respondWithData($data);
    }
}
