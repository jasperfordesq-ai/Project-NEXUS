<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\PlatformTeam;

use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * Platform team panel → Phone app: who has the app, across every community.
 *
 * The figures used to ride along inside the community admin's own Phone app
 * request (`GET /v2/admin/config/native-app/install-stats`, a `platform`
 * block sent to `is_god` accounts). They now have their own request, for the
 * platform team only, and the admin request no longer carries them for
 * anyone. What the figures contain is covered where it always was:
 * AdminNativeAppInstallStatsTest.
 */
class PhoneAppAllCommunitiesTest extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;

    private const PANEL = '/v2/platform-team/phone-app';
    private const ADMIN = '/v2/admin/config/native-app/install-stats';

    public function test_only_the_platform_team_may_read_it(): void
    {
        $this->assertPlatformTeamOnly('GET', self::PANEL);
    }

    public function test_it_gives_the_all_communities_figures_and_says_what_they_are_not(): void
    {
        $this->actAsPlatformTeam();
        $response = $this->apiGet(self::PANEL)->assertStatus(200);

        foreach (['members_with_app', 'native_devices', 'tenants_with_app', 'devices_by_platform', 'by_tenant', 'recent_members'] as $key) {
            $this->assertArrayHasKey($key, $response->json('data'), $key);
        }
        // These are members signed in on the app, not app-store downloads.
        $response->assertJsonPath('data.disclaimer_key', 'app_members_not_store_installs');
    }

    public function test_the_community_admins_request_no_longer_carries_the_all_communities_block(): void
    {
        // Not even for the platform team: one place for it, the panel.
        $this->actAsPlatformTeam();
        $response = $this->apiGet(self::ADMIN)->assertStatus(200);

        $this->assertNull($response->json('data.platform'));
        $response->assertJsonPath('data.scope', 'tenant');
        $this->assertIsArray($response->json('data.tenant'));
    }
}
