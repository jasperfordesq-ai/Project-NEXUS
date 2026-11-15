<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\PlatformTeamLocks;

/**
 * Regional analytics subscriptions: a product sold to outside partners, with
 * its access log. Platform-wide data; the page moved to the Platform team
 * panel in phase 2. (The partner's own dashboard, `/regional-analytics/me/*`,
 * is a different controller and is not touched.)
 */
final class RegionalAnalyticsAdminControllerPlatformTeamLockTest extends PlatformTeamLockTestCase
{
    public static function locked(): array
    {
        return [
            'subscriptions' => ['GET', '/super-admin/regional-analytics/subscriptions'],
            'one subscription' => ['GET', '/super-admin/regional-analytics/subscriptions/999999999'],
            'create a subscription' => ['POST', '/super-admin/regional-analytics/subscriptions', 'refusal-only'],
            'change a subscription' => ['PUT', '/super-admin/regional-analytics/subscriptions/999999999', 'refusal-only'],
            'delete a subscription' => ['DELETE', '/super-admin/regional-analytics/subscriptions/999999999', 'refusal-only'],
            'generate a report' => ['POST', '/super-admin/regional-analytics/subscriptions/999999999/generate-report', 'refusal-only'],
            'access log' => ['GET', '/super-admin/regional-analytics/access-log'],
        ];
    }
}
