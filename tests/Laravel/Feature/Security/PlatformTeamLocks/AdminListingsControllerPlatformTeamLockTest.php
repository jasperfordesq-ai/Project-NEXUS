<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\PlatformTeamLocks;

/**
 * Search analytics is a Platform team page.
 */
final class AdminListingsControllerPlatformTeamLockTest extends PlatformTeamLockTestCase
{
    public static function locked(): array
    {
        return [
            'search analytics' => ['GET', '/v2/admin/search/analytics'],
            'trending searches' => ['GET', '/v2/admin/search/trending'],
            'searches with no results' => ['GET', '/v2/admin/search/zero-results'],
        ];
    }
}
