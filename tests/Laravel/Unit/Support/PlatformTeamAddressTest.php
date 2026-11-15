<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Support;

use App\Core\TenantContext;
use App\Services\FCMPushService;
use App\Services\TenantProvisioning\TenantProvisioningService;
use App\Support\SpaRouteSegments;
use Tests\Laravel\TestCase;

/**
 * The Platform team panel lives at `/platform-team` (E-128).
 *
 * A first path segment that is not registered is read as a community's name,
 * so each list below must know the address: otherwise the panel is "community
 * not found", a community could be registered under that name, a crawler is
 * told the page never existed, or a push notification could open it on a phone.
 */
final class PlatformTeamAddressTest extends TestCase
{
    private const SEGMENT = 'platform-team';

    public function test_it_is_never_read_as_a_communitys_name(): void
    {
        $this->assertTrue(TenantContext::isReservedPathSegment(self::SEGMENT));
    }

    public function test_no_community_can_be_registered_under_it(): void
    {
        $this->assertContains(self::SEGMENT, TenantProvisioningService::RESERVED_SLUGS);
    }

    public function test_the_server_knows_it_is_a_real_address(): void
    {
        $this->assertTrue(SpaRouteSegments::isKnown(self::SEGMENT));
    }

    public function test_a_push_notification_never_links_into_the_panel(): void
    {
        $safe = new \ReflectionMethod(FCMPushService::class, 'safeInternalLink');

        $this->assertSame('/notifications', $safe->invoke(null, '/platform-team'));
        $this->assertSame('/notifications', $safe->invoke(null, '/platform-team/cron-jobs'));
        // Control: an ordinary member page is left alone.
        $this->assertSame('/listings', $safe->invoke(null, '/listings'));
    }

    public function test_a_notification_about_the_panel_is_kept_off_the_phone(): void
    {
        $suppress = new \ReflectionMethod(FCMPushService::class, 'shouldSuppressNativePush');

        $this->assertTrue($suppress->invoke(null, ['link' => '/platform-team/cron-jobs']));
        $this->assertTrue($suppress->invoke(null, ['link' => '/hour-timebank/platform-team/cron-jobs']));
        // Control.
        $this->assertFalse($suppress->invoke(null, ['link' => '/hour-timebank/listings']));
    }

    public function test_search_engines_are_told_to_stay_out(): void
    {
        $app = (string) file_get_contents(base_path('react-frontend/public/robots.txt'));
        $this->assertStringContainsString("Disallow: /platform-team/\n", str_replace("\r\n", "\n", $app));
        $this->assertStringContainsString("Disallow: /*/platform-team/\n", str_replace("\r\n", "\n", $app));

        $api = (string) file_get_contents(base_path('httpdocs/robots.txt'));
        $this->assertStringContainsString("Disallow: /platform-team/\n", str_replace("\r\n", "\n", $api));
    }
}
