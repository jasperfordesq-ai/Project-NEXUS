<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Middleware;

use App\Http\Middleware\EnforceMobileMinimumVersion;
use Tests\Laravel\TestCase;

/**
 * The force-update lever, through the real HTTP stack.
 *
 * 🔴 Why this exists alongside the unit test. The unit test calls `handle()` directly,
 * so it proves the LOGIC. It would pass just as happily if the middleware were never
 * registered in `bootstrap/app.php` — in which case the lever does nothing at all and
 * the only evidence would be a green suite. This test sends a real request through the
 * real API middleware stack, so a missing registration fails it.
 */
class MobileVersionGateRegistrationTest extends TestCase
{
    public function test_a_too_old_mobile_build_is_refused_by_the_real_stack(): void
    {
        config()->set('mobile.expo.minimum_version', '99.0.0');

        $response = $this->withHeaders([
            EnforceMobileMinimumVersion::VERSION_HEADER => '1.0.0',
            'Accept' => 'application/json',
        ])->getJson('/api/v2/feed');

        $response->assertStatus(426);
        $response->assertJsonPath('error.code', EnforceMobileMinimumVersion::ERROR_CODE);
    }

    public function test_the_web_frontend_is_untouched_by_the_gate(): void
    {
        // The web app and the Capacitor wrapper send no version header. If this ever
        // starts failing, the gate has begun refusing unknown callers and the website
        // is down.
        config()->set('mobile.expo.minimum_version', '99.0.0');

        $response = $this->getJson('/api/v2/feed');

        $this->assertNotSame(426, $response->getStatusCode());
    }

    public function test_a_locked_out_build_can_still_ask_what_version_it_needs(): void
    {
        // The exemption that keeps "please update" from becoming a dead end.
        config()->set('mobile.expo.minimum_version', '99.0.0');

        $response = $this->withHeaders([
            EnforceMobileMinimumVersion::VERSION_HEADER => '1.0.0',
            'Accept' => 'application/json',
        ])->getJson('/api/app/version');

        $this->assertNotSame(426, $response->getStatusCode());
    }

    public function test_the_configured_minimum_does_not_lock_out_the_shipped_version(): void
    {
        // 🔴 A contract between config/mobile.php and mobile/app.json. Setting a floor
        // above the version that actually exists would refuse every request from the
        // only build there is — the lever pointed at our own foot. Read from the
        // manifest rather than restated, so a version bump cannot silently break it.
        $manifestPath = base_path('mobile/app.json');
        $this->assertFileExists($manifestPath);

        /** @var array{expo?: array{version?: string}} $manifest */
        $manifest = json_decode((string) file_get_contents($manifestPath), true);
        $shipped = $manifest['expo']['version'] ?? '';
        $this->assertNotSame('', $shipped, 'mobile/app.json must declare expo.version');

        $minimum = (string) config('mobile.expo.minimum_version');

        $this->assertTrue(
            version_compare($shipped, $minimum, '>='),
            "the shipped mobile version ({$shipped}) is below the configured minimum ({$minimum}), "
            . 'so every request from it would be refused'
        );
    }

    public function test_the_advertised_current_version_matches_the_manifest(): void
    {
        // The app shows "current_version" to a locked-out member. If it drifts from
        // the real build, the app tells them to install something that does not exist.
        $manifest = json_decode((string) file_get_contents(base_path('mobile/app.json')), true);

        $this->assertSame(
            $manifest['expo']['version'] ?? null,
            (string) config('mobile.expo.current_version'),
            'config/mobile.php expo.current_version must track mobile/app.json expo.version'
        );
    }
}
