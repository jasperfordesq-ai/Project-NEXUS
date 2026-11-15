<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\PlatformTeamLocks;

/**
 * Enterprise dashboard, Roles and permissions, Permissions list and Monitoring
 * are Platform team pages. Monitoring, health and requirements describe the
 * server the whole platform runs on (F-624, O-155).
 */
final class AdminEnterpriseControllerPlatformTeamLockTest extends PlatformTeamLockTestCase
{
    public static function locked(): array
    {
        return [
            'dashboard' => ['GET', '/v2/admin/enterprise/dashboard'],
            'roles' => ['GET', '/v2/admin/enterprise/roles'],
            'create a role' => ['POST', '/v2/admin/enterprise/roles', 'refusal-only'],
            'read a role' => ['GET', '/v2/admin/enterprise/roles/999999'],
            'update a role' => ['PUT', '/v2/admin/enterprise/roles/999999', 'refusal-only'],
            'delete a role' => ['DELETE', '/v2/admin/enterprise/roles/999999', 'refusal-only'],
            'permissions' => ['GET', '/v2/admin/enterprise/permissions'],
            'monitoring' => ['GET', '/v2/admin/enterprise/monitoring'],
            'health check' => ['GET', '/v2/admin/enterprise/monitoring/health'],
            'health history' => ['GET', '/v2/admin/enterprise/monitoring/health-history'],
            'activity errors' => ['GET', '/v2/admin/enterprise/monitoring/logs'],
            'log files' => ['GET', '/v2/admin/enterprise/monitoring/log-files'],
            'read a log file' => ['GET', '/v2/admin/enterprise/monitoring/log-files/no-such-file.log'],
            'download a log file' => ['GET', '/v2/admin/enterprise/monitoring/log-files/no-such-file.log/download'],
            'clear a log file' => ['DELETE', '/v2/admin/enterprise/monitoring/log-files/no-such-file.log', 'refusal-only'],
            'requirements' => ['GET', '/v2/admin/enterprise/monitoring/requirements'],
        ];
    }
}
