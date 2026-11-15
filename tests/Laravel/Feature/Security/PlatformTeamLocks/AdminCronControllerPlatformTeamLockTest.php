<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\PlatformTeamLocks;

/**
 * Cron jobs, logs, setup and settings are Platform team pages. The Operations
 * page's background-jobs card uses a different endpoint and is not here.
 */
final class AdminCronControllerPlatformTeamLockTest extends PlatformTeamLockTestCase
{
    public static function locked(): array
    {
        return [
            'job list' => ['GET', '/v2/admin/system/cron-jobs'],
            'run a job' => ['POST', '/v2/admin/system/cron-jobs/999999/run', 'refusal-only'],
            'logs' => ['GET', '/v2/admin/system/cron-jobs/logs'],
            'one log' => ['GET', '/v2/admin/system/cron-jobs/logs/999999'],
            'clear logs' => ['DELETE', '/v2/admin/system/cron-jobs/logs'],
            'global settings' => ['GET', '/v2/admin/system/cron-jobs/settings'],
            'save global settings' => ['PUT', '/v2/admin/system/cron-jobs/settings', 'refusal-only'],
            'health' => ['GET', '/v2/admin/system/cron-jobs/health'],
            'job settings' => ['GET', '/v2/admin/system/cron-jobs/999999/settings'],
            'save job settings' => ['PUT', '/v2/admin/system/cron-jobs/999999/settings', 'refusal-only'],
        ];
    }
}
