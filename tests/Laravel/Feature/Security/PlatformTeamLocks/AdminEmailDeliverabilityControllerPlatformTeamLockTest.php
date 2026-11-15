<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\PlatformTeamLocks;

/**
 * Email deliverability is a Platform team page. The two endpoints no screen
 * calls (trigger audit, one member's delivery history) are locked with it.
 */
final class AdminEmailDeliverabilityControllerPlatformTeamLockTest extends PlatformTeamLockTestCase
{
    public static function locked(): array
    {
        return [
            'summary' => ['GET', '/v2/admin/email-deliverability/summary'],
            'push summary' => ['GET', '/v2/admin/email-deliverability/push-summary'],
            'trigger audit' => ['GET', '/v2/admin/email-deliverability/trigger-audit', 'refusal-only'],
            'logs' => ['GET', '/v2/admin/email-deliverability/logs'],
            'queues' => ['GET', '/v2/admin/email-deliverability/queues'],
            'suppressions' => ['GET', '/v2/admin/email-deliverability/suppressions'],
            'remove a suppression' => ['DELETE', '/v2/admin/email-deliverability/suppressions/999999'],
            'one member history' => ['GET', '/v2/admin/email-deliverability/user/999999'],
        ];
    }
}
