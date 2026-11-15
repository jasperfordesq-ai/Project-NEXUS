<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\PlatformTeamLocks;

/**
 * URL redirects, 404 tracking and the Tests page are Platform team pages.
 * The SEO audit endpoints share the controller and stay open: the SEO
 * overview, which every community admin has, runs and reads the audit.
 */
final class AdminToolsControllerPlatformTeamLockTest extends PlatformTeamLockTestCase
{
    public static function locked(): array
    {
        return [
            'redirects' => ['GET', '/v2/admin/tools/redirects'],
            'create a redirect' => ['POST', '/v2/admin/tools/redirects'],
            'delete a redirect' => ['DELETE', '/v2/admin/tools/redirects/999999'],
            '404 errors' => ['GET', '/v2/admin/tools/404-errors'],
            'delete a 404 error' => ['DELETE', '/v2/admin/tools/404-errors/999999'],
            'health check' => ['POST', '/v2/admin/tools/health-check'],
        ];
    }

    public function test_the_seo_audit_stays_open_to_a_community_admin(): void
    {
        $this->assertCommunityAdminReaches('GET', '/v2/admin/tools/seo-audit');
    }
}
