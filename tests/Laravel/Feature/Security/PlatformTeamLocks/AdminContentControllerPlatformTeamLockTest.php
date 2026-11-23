<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\PlatformTeamLocks;

/**
 * Menus, Plans and pricing, and Subscriptions are Platform team pages.
 * `GET /v2/admin/pages` shares the controller and stays open: the Pages
 * screen is every community admin's.
 */
final class AdminContentControllerPlatformTeamLockTest extends PlatformTeamLockTestCase
{
    public static function locked(): array
    {
        return [
            'menus list' => ['GET', '/v2/admin/menus'],
            'menu create' => ['POST', '/v2/admin/menus'],
            'menu read' => ['GET', '/v2/admin/menus/999999'],
            'menu update' => ['PUT', '/v2/admin/menus/999999'],
            'menu delete' => ['DELETE', '/v2/admin/menus/999999'],
            'menu items list' => ['GET', '/v2/admin/menus/999999/items'],
            'menu item create' => ['POST', '/v2/admin/menus/999999/items'],
            'menu items reorder' => ['POST', '/v2/admin/menus/999999/items/reorder'],
            'menu item update' => ['PUT', '/v2/admin/menu-items/999999'],
            'menu item delete' => ['DELETE', '/v2/admin/menu-items/999999'],
            'plans list' => ['GET', '/v2/admin/plans'],
            'plan create' => ['POST', '/v2/admin/plans'],
            'plan read' => ['GET', '/v2/admin/plans/999999'],
            'plan update' => ['PUT', '/v2/admin/plans/999999'],
            'plan delete' => ['DELETE', '/v2/admin/plans/999999'],
            'plan sync to Stripe' => ['POST', '/v2/admin/plans/999999/sync-stripe', 'refusal-only'],
        ];
    }

    public function test_the_pages_list_stays_open_to_a_community_admin(): void
    {
        $this->assertCommunityAdminReaches('GET', '/v2/admin/pages');
    }
}
