<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\PlatformTeamLocks;

/**
 * Email settings is a Platform team page: a community's mail provider keys.
 */
final class AdminEmailControllerPlatformTeamLockTest extends PlatformTeamLockTestCase
{
    public static function locked(): array
    {
        return [
            'read the mail settings' => ['GET', '/v2/admin/email/config'],
            'save the mail settings' => ['PUT', '/v2/admin/email/config', 'refusal-only'],
            'test a mail provider' => ['POST', '/v2/admin/email/test-provider', 'refusal-only'],
        ];
    }
}
