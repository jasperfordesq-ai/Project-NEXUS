<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\PlatformTeamLocks;

use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Broadcast;
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * The Prerender engine page listens to the `admin-prerender` live channel for
 * job updates. Locking the page's endpoints (E-128) without locking the
 * channel would leave the job stream open to the tiers the endpoints refuse.
 */
final class PrerenderRealtimeChannelPlatformTeamLockTest extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;

    private function rule(): callable
    {
        $channels = Broadcast::driver()->getChannels();
        $this->assertTrue($channels->has('admin-prerender'), 'the admin-prerender channel is not registered');

        return $channels->get('admin-prerender');
    }

    public function test_a_community_admin_may_not_listen(): void
    {
        $this->assertFalse((bool) ($this->rule())($this->actAsCommunityAdmin()));
    }

    public function test_a_global_super_admin_who_is_not_on_the_platform_team_may_not_listen(): void
    {
        $this->assertFalse((bool) ($this->rule())($this->actAsGlobalSuperAdminNotOnTeam()));
    }

    public function test_an_account_with_is_god_but_not_super_admin_may_not_listen(): void
    {
        $this->assertFalse((bool) ($this->rule())($this->actAsGodWithoutSuperAdmin()));
    }

    public function test_the_platform_team_may_listen(): void
    {
        $this->assertTrue((bool) ($this->rule())($this->actAsPlatformTeam()));
    }
}
