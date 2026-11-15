<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\PlatformTeamLocks;

/**
 * Platform capabilities ("Platform switches") set the ceiling every
 * community's own settings sit under. The page moved to the Platform team
 * panel in phase 2; until then any global super admin could read and save it.
 */
final class PlatformCapabilityControllerPlatformTeamLockTest extends PlatformTeamLockTestCase
{
    public static function locked(): array
    {
        return [
            'read the switches' => ['GET', '/v2/admin/super/platform-capabilities'],
            'save the switches' => ['PUT', '/v2/admin/super/platform-capabilities', 'refusal-only'],
        ];
    }
}
