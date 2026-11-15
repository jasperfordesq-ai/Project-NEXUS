<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\PlatformTeamLocks;

/**
 * The Deliverability module is a Platform team page.
 */
final class AdminDeliverabilityControllerPlatformTeamLockTest extends PlatformTeamLockTestCase
{
    public static function locked(): array
    {
        return [
            'dashboard' => ['GET', '/v2/admin/deliverability/dashboard'],
            'analytics' => ['GET', '/v2/admin/deliverability/analytics'],
            'list' => ['GET', '/v2/admin/deliverability'],
            'create' => ['POST', '/v2/admin/deliverability'],
            'read' => ['GET', '/v2/admin/deliverability/999999'],
            'update' => ['PUT', '/v2/admin/deliverability/999999'],
            'delete' => ['DELETE', '/v2/admin/deliverability/999999'],
            'comment' => ['POST', '/v2/admin/deliverability/999999/comments'],
        ];
    }
}
