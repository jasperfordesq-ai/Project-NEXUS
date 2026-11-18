<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\PlatformTeamLocks;

/**
 * The Matching diagnostic page is a Platform team page, and only it calls the
 * two diagnosis endpoints. The rest of this controller serves the community
 * admin's Smart Matching pages and stays open to a community admin.
 */
final class AdminMatchingControllerPlatformTeamLockTest extends PlatformTeamLockTestCase
{
    public static function locked(): array
    {
        return [
            // An id that does not exist: the platform team gets 404, never 403.
            'why a member gets no matches' => ['GET', '/v2/admin/matching/diagnose/user/99999999'],
            'why a listing is not offered' => ['GET', '/v2/admin/matching/diagnose/listing/99999999'],
        ];
    }

    public function test_the_community_admins_matching_pages_stay_open(): void
    {
        $this->assertCommunityAdminReaches('GET', '/v2/admin/matching/config');
        $this->assertCommunityAdminReaches('GET', '/v2/admin/matching/stats');
        $this->assertCommunityAdminReaches('GET', '/v2/admin/matching/approvals');
    }
}
