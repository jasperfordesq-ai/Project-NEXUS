<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\PlatformTeam;

use App\Models\User;
use App\Services\NativeAppInstallStatsService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * Platform team panel → Phone app → "App versions in use": live phone-app
 * sign-ins counted by the app version they recorded. Counts only: no member,
 * no device.
 */
class PhoneAppVersionsInUseTest extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;

    private const PANEL = '/v2/platform-team/phone-app';

    protected function setUp(): void
    {
        parent::setUp();
        // Platform-wide figures: start from no sign-ins at all (rolled back after).
        DB::table('refresh_session_activity')->delete();
    }

    /** @param 'live'|'revoked'|'expired' $state */
    private function signIn(?string $version, bool $fromPhoneApp = true, string $state = 'live', ?int $tenantId = null): void
    {
        $tenantId ??= $this->testTenantId;
        $user = User::factory()->forTenant($tenantId)->create();
        $familyHash = hash('sha256', 'family-' . uniqid('', true));

        DB::table('refresh_token_sessions')->insert([
            'tenant_id' => $tenantId,
            'user_id' => $user->id,
            'family_hash' => $familyHash,
            'jti_hash' => hash('sha256', 'jti-' . uniqid('', true)),
            'issued_at' => now(),
            'expires_at' => $state === 'expired' ? now()->subDay() : now()->addDays(7),
            'family_expires_at' => $state === 'expired' ? now()->subDay() : now()->addDays(30),
            'revoked_at' => $state === 'revoked' ? now() : null,
            'revocation_reason' => $state === 'revoked' ? 'logout' : null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('refresh_session_activity')->insert([
            'family_hash' => $familyHash,
            'tenant_id' => $tenantId,
            'user_id' => $user->id,
            'last_activity_at' => now(),
            'from_phone_app' => $fromPhoneApp,
            'app_version' => $version,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_the_page_request_carries_exactly_the_old_figures_plus_the_versions(): void
    {
        $this->actAsPlatformTeam();
        $data = $this->apiGet(self::PANEL)->assertStatus(200)->json('data');

        // Exactly what the page shows; anything else must not leave the server.
        $expected = [
            'members_with_app', 'members_notifications_on', 'native_devices', 'devices_by_platform',
            'last_joined_at', 'tenants_with_app', 'by_tenant', 'recent_members', 'disclaimer_key',
            'versions', 'version_not_recorded',
        ];
        $keys = array_keys($data);
        sort($keys);
        sort($expected);
        $this->assertSame($expected, $keys);
    }

    public function test_each_version_row_is_a_version_and_a_count_and_nothing_else(): void
    {
        $this->signIn('1.13.0');
        $this->actAsPlatformTeam();

        $response = $this->apiGet(self::PANEL)->assertStatus(200);

        $this->assertSame([['version' => '1.13.0', 'sign_ins' => 1]], $response->json('data.versions'));
        $this->assertSame(0, $response->json('data.version_not_recorded'));
    }

    public function test_newest_version_first_comparing_each_part_as_a_number(): void
    {
        foreach (['1.9.0', '1.10.0', '1.10.0', '2.0.0', '1.10.1', '1.13.0', '0.99.999'] as $version) {
            $this->signIn($version);
        }

        $figures = (new NativeAppInstallStatsService())->platformAppVersions();

        $this->assertSame([
            ['version' => '2.0.0', 'sign_ins' => 1],
            ['version' => '1.13.0', 'sign_ins' => 1],
            ['version' => '1.10.1', 'sign_ins' => 1],
            ['version' => '1.10.0', 'sign_ins' => 2],
            ['version' => '1.9.0', 'sign_ins' => 1],
            ['version' => '0.99.999', 'sign_ins' => 1],
        ], $figures['versions']);
    }

    public function test_only_live_phone_app_sign_ins_are_counted(): void
    {
        $this->signIn('1.13.0');
        $this->signIn('1.13.0', true, 'live', 999);   // another community counts too
        $this->signIn('1.13.0', false);               // not the phone app
        $this->signIn('1.13.0', true, 'revoked');     // signed out
        $this->signIn('1.13.0', true, 'expired');     // ended
        $this->signIn(null);                          // live, version not recorded
        $this->signIn(null, true, 'revoked');         // ended, not counted anywhere
        $this->signIn(null, false);                   // not the phone app

        $figures = (new NativeAppInstallStatsService())->platformAppVersions();

        $this->assertSame([['version' => '1.13.0', 'sign_ins' => 2]], $figures['versions']);
        $this->assertSame(1, $figures['version_not_recorded']);
    }

    public function test_nothing_recorded_yet_is_an_empty_list_and_a_count(): void
    {
        $this->signIn(null);
        $this->signIn(null);

        $figures = (new NativeAppInstallStatsService())->platformAppVersions();

        $this->assertSame(['versions' => [], 'version_not_recorded' => 2], $figures);
    }
}
