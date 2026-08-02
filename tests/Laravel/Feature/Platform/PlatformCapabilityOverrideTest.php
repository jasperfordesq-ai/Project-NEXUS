<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Platform;

use App\Models\User;
use App\Services\PlatformCapabilityService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Platform rollout switches, settable from the UI instead of over SSH.
 *
 * The point of this feature is that the platform owner should not need a
 * developer to raise a rollout gate. The point of THIS test is the boundary:
 * only allowlisted capabilities may be written, the values are constrained, and
 * an empty table must behave exactly like the environment alone.
 */
final class PlatformCapabilityOverrideTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::forget('platform_capability_overrides');
    }

    protected function tearDown(): void
    {
        Cache::forget('platform_capability_overrides');
        parent::tearDown();
    }

    private function service(): PlatformCapabilityService
    {
        return app(PlatformCapabilityService::class);
    }

    public function test_no_overrides_leaves_the_environment_in_charge(): void
    {
        config(['events.attendance_credit_mode' => 'off']);

        $this->service()->applyToConfig();

        self::assertSame(
            'off',
            config('events.attendance_credit_mode'),
            'An empty table must reproduce environment-only behaviour exactly.',
        );
    }

    public function test_a_stored_override_reaches_the_running_config(): void
    {
        config(['events.attendance_credit_mode' => 'off']);

        self::assertTrue($this->service()->set('attendance_credits', 'treasury', 1, 'Enabling for Coventry'));

        // This is the whole mechanism: existing config() readers across the
        // codebase pick the override up without any of them changing.
        $this->service()->applyToConfig();

        self::assertSame('treasury', config('events.attendance_credit_mode'));
    }

    public function test_clearing_an_override_hands_control_back_to_the_environment(): void
    {
        config(['events.attendance_credit_mode' => 'off']);
        $this->service()->set('attendance_credits', 'treasury', 1);
        $this->service()->applyToConfig();
        self::assertSame('treasury', config('events.attendance_credit_mode'));

        // The way back out must always exist.
        self::assertTrue($this->service()->clear('attendance_credits'));
        config(['events.attendance_credit_mode' => 'off']);
        $this->service()->applyToConfig();

        self::assertSame('off', config('events.attendance_credit_mode'));
    }

    public function test_a_boolean_capability_becomes_a_real_boolean(): void
    {
        config(['events.recurrence.engine_v2_enabled' => false]);

        $this->service()->set('recurrence_v2', '1', 1);
        $this->service()->applyToConfig();

        self::assertTrue(config('events.recurrence.engine_v2_enabled'));
        self::assertIsBool(config('events.recurrence.engine_v2_enabled'));
    }

    public function test_only_allowlisted_capabilities_and_values_are_accepted(): void
    {
        // 🔴 The allowlist is the entire security boundary: without it this
        // endpoint would let a caller rewrite any config value at all.
        self::assertFalse(
            $this->service()->set('app.key', 'anything', 1),
            'An arbitrary config path must never be settable.',
        );
        self::assertFalse(
            $this->service()->set('database.default', 'sqlite', 1),
            'Especially not infrastructure config.',
        );
        self::assertFalse(
            $this->service()->set('attendance_credits', 'unlimited_free_money', 1),
            'A mode outside the declared values must be refused.',
        );
        self::assertFalse(
            $this->service()->set('recurrence_v2', 'yes-please', 1),
            'A boolean capability takes only 0 or 1.',
        );

        self::assertSame(
            0,
            (int) DB::table('platform_capability_overrides')->count(),
            'No refused write may leave a row behind.',
        );
    }

    public function test_inspect_reports_where_each_value_came_from(): void
    {
        config(['events.attendance_credit_mode' => 'off']);
        $this->service()->set('attendance_credits', 'treasury', 1);

        $rows = collect($this->service()->inspect())->keyBy('capability');

        self::assertSame('platform_override', $rows['attendance_credits']['source']);
        self::assertSame('treasury', $rows['attendance_credits']['value']);
        // Every switchable capability is listed, whether overridden or not, so
        // the screen can show the full set.
        self::assertSame('environment', $rows['timed_waitlist_offers']['source']);
        self::assertCount(count(PlatformCapabilityService::CAPABILITIES), $rows);
    }

    public function test_the_endpoints_require_platform_super_admin(): void
    {
        $tenantAdmin = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'admin',
        ]);
        $this->actingAs($tenantAdmin);

        // A tenant admin sets their own community's policy, never the platform
        // ceiling every community sits under.
        $this->apiGet('/v2/admin/super/platform-capabilities')->assertStatus(403);
        $this->apiPut('/v2/admin/super/platform-capabilities', [
            'capability' => 'attendance_credits',
            'value' => 'treasury',
        ])->assertStatus(403);
    }
}
