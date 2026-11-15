<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\PlatformTeamLocks;

/**
 * Regional analytics is a Platform team page.
 */
final class RegionalAnalyticsControllerPlatformTeamLockTest extends PlatformTeamLockTestCase
{
    public static function locked(): array
    {
        return [
            'overview' => ['GET', '/v2/admin/regional-analytics/overview'],
            'heatmap' => ['GET', '/v2/admin/regional-analytics/heatmap'],
            'demand and supply' => ['GET', '/v2/admin/regional-analytics/demand-supply'],
            'demographics' => ['GET', '/v2/admin/regional-analytics/demographics'],
            'engagement trends' => ['GET', '/v2/admin/regional-analytics/engagement-trends'],
            'volunteer breakdown' => ['GET', '/v2/admin/regional-analytics/volunteer-breakdown'],
            'help requests' => ['GET', '/v2/admin/regional-analytics/help-requests'],
            'export' => ['GET', '/v2/admin/regional-analytics/export', 'refusal-only'],
            'clear the cache' => ['POST', '/v2/admin/regional-analytics/invalidate-cache', 'refusal-only'],
        ];
    }
}
