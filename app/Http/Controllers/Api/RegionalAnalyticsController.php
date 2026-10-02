<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Services\RegionalAnalyticsService;
use Illuminate\Http\JsonResponse;

/**
 * RegionalAnalyticsController — AG59 Regional Analytics Product
 *
 * Admin-only endpoints serving geographic, demographic, engagement, volunteer,
 * and help-request analytics for municipalities and SME partners.
 *
 * 🔴 GOD ACCOUNTS ONLY (owner decision 2026-10-02). The figures come almost
 * entirely from vol_logs and caring_help_requests, so a timebank without those
 * modules sees a page of zeros ("active members" means members who logged
 * volunteer hours). Until the product is reworked, every endpoint refuses
 * anyone who is not a god — including platform super admins. The React
 * sidebar and route guard hide it too, but this check is the control.
 * Pinned by tests/Laravel/Feature/Controllers/RegionalAnalyticsGodOnlyTest.php.
 */
class RegionalAnalyticsController extends BaseApiController
{
    protected bool $isV2Api = true;

    /** Allowed period values — rejects anything not in this list */
    private const VALID_PERIODS = ['last_30d', 'last_90d', 'last_12m', 'all_time'];

    // ──────────────────────────────────────────────────────────────────────────
    // Helpers
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Admit god accounts only. requireAdmin() runs first so a non-admin still
     * gets the ordinary admin refusal; an admin who is not a god is refused.
     */
    private function requireGod(): int
    {
        $userId = $this->requireAdmin();
        $user = $this->resolveUser();

        if (($user->role ?? null) === 'god' || !empty($user->is_god)) {
            return $userId;
        }

        throw new \Illuminate\Http\Exceptions\HttpResponseException(
            $this->error(__('api.god_level_access_required'), 403, 'AUTH_INSUFFICIENT_PERMISSIONS')
        );
    }

    private function resolvePeriod(string $default = 'last_30d'): string
    {
        $period = (string) $this->query('period', $default);
        return in_array($period, self::VALID_PERIODS, true) ? $period : $default;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Endpoints
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * GET /v2/admin/regional-analytics/overview
     * Hero headline metrics (active members, vol hours, help requests, top category).
     */
    public function overview(): JsonResponse
    {
        $this->requireGod();
        $tenantId = $this->getTenantId();

        $data = RegionalAnalyticsService::getOverviewSummary($tenantId);

        return $this->respondWithData($data);
    }

    /**
     * GET /v2/admin/regional-analytics/heatmap?period=
     * Geographic activity density bucketed to ~0.01° grid cells.
     */
    public function heatmap(): JsonResponse
    {
        $this->requireGod();
        $tenantId = $this->getTenantId();
        $period   = $this->resolvePeriod('last_90d');

        $data = RegionalAnalyticsService::getMemberHeatmap($tenantId, $period);

        return $this->respondWithData($data);
    }

    /**
     * GET /v2/admin/regional-analytics/demand-supply?period=
     * Per-category request vs offer counts, ratio, and trend.
     */
    public function demandSupply(): JsonResponse
    {
        $this->requireGod();
        $tenantId = $this->getTenantId();
        $period   = $this->resolvePeriod('last_30d');

        $data = RegionalAnalyticsService::getDemandSupplyRatio($tenantId, $period);

        return $this->respondWithData($data);
    }

    /**
     * GET /v2/admin/regional-analytics/demographics
     * Age groups, language distribution, monthly member growth curve.
     */
    public function demographics(): JsonResponse
    {
        $this->requireGod();
        $tenantId = $this->getTenantId();

        $data = RegionalAnalyticsService::getDemographics($tenantId);

        return $this->respondWithData($data);
    }

    /**
     * GET /v2/admin/regional-analytics/engagement-trends?period=
     * Monthly active members, vol hours, new listings, new events, help requests.
     */
    public function engagementTrends(): JsonResponse
    {
        $this->requireGod();
        $tenantId = $this->getTenantId();
        $period   = $this->resolvePeriod('last_12m');

        $data = RegionalAnalyticsService::getEngagementTrends($tenantId, $period);

        return $this->respondWithData($data);
    }

    /**
     * GET /v2/admin/regional-analytics/volunteer-breakdown?period=
     * Top orgs by hours, avg hours/volunteer, total hours, reciprocity ratio.
     */
    public function volunteerBreakdown(): JsonResponse
    {
        $this->requireGod();
        $tenantId = $this->getTenantId();
        $period   = $this->resolvePeriod('last_90d');

        $data = RegionalAnalyticsService::getVolunteerBreakdown($tenantId, $period);

        return $this->respondWithData($data);
    }

    /**
     * GET /v2/admin/regional-analytics/help-requests?period=
     * Help request breakdown by category with resolution rates and trend.
     */
    public function helpRequests(): JsonResponse
    {
        $this->requireGod();
        $tenantId = $this->getTenantId();
        $period   = $this->resolvePeriod('last_30d');

        $data = RegionalAnalyticsService::getHelpRequestAnalysis($tenantId, $period);

        return $this->respondWithData($data);
    }

    /**
     * GET /v2/admin/regional-analytics/export?period=
     * Full JSON report export (all sections assembled into one payload).
     */
    public function exportReport(): JsonResponse
    {
        $this->requireGod();
        $tenantId = $this->getTenantId();
        $period   = $this->resolvePeriod('last_30d');

        $data = RegionalAnalyticsService::exportReportJson($tenantId, $period);

        return $this->respondWithData($data);
    }

    /**
     * POST /v2/admin/regional-analytics/invalidate-cache
     * Forces cache invalidation so next request recomputes fresh data.
     */
    public function invalidateCache(): JsonResponse
    {
        $this->requireGod();
        $tenantId = $this->getTenantId();

        RegionalAnalyticsService::invalidateCache($tenantId);

        return $this->respondWithData(['invalidated' => true]);
    }
}
