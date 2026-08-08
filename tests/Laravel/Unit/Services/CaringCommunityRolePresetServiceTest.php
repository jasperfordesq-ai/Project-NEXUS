<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Services\CaringCommunityRolePresetService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

class CaringCommunityRolePresetServiceTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        TenantContext::setById($this->testTenantId);
    }

    private function service(): CaringCommunityRolePresetService
    {
        return app(CaringCommunityRolePresetService::class);
    }

    private function cleanPresets(): void
    {
        // Remove any preset roles created for this tenant so tests start deterministic.
        $roleNames = array_map(
            fn (string $key): string => 'kiss_' . $key . '_t' . $this->testTenantId,
            ['national_admin', 'canton_admin', 'municipality_admin', 'cooperative_coordinator', 'organisation_coordinator', 'trusted_reviewer']
        );
        DB::table('role_permissions')
            ->whereIn('role_id', DB::table('roles')->whereIn('name', $roleNames)->pluck('id'))
            ->delete();
        DB::table('roles')->whereIn('name', $roleNames)->delete();
    }

    public function test_status_shows_none_installed_before_install(): void
    {
        $this->cleanPresets();

        $status = $this->service()->status($this->testTenantId);

        $this->assertTrue($status['available']);
        $this->assertSame(0, $status['installed_count']);
        $this->assertSame(6, $status['total_count']);
        foreach ($status['presets'] as $preset) {
            $this->assertFalse($preset['installed'], "{$preset['key']} should not be installed yet.");
        }
    }

    public function test_install_all_creates_six_roles_with_correct_names(): void
    {
        $this->cleanPresets();

        $status = $this->service()->install($this->testTenantId);

        $this->assertSame(6, $status['installed_count']);
        foreach ($status['presets'] as $preset) {
            $this->assertTrue($preset['installed'], "Preset {$preset['key']} was not installed.");
            $this->assertStringStartsWith('kiss_', $preset['role_name']);
            $this->assertStringEndsWith('_t' . $this->testTenantId, $preset['role_name']);
        }
    }

    public function test_install_single_preset_leaves_others_uninstalled(): void
    {
        $this->cleanPresets();

        $status = $this->service()->install($this->testTenantId, 'trusted_reviewer');

        $installed = array_filter($status['presets'], fn (array $p): bool => $p['installed']);
        $this->assertCount(1, $installed);
        $this->assertSame('trusted_reviewer', reset($installed)['key']);
    }

    public function test_install_is_idempotent(): void
    {
        $this->cleanPresets();

        $this->service()->install($this->testTenantId);
        $statusAfterSecond = $this->service()->install($this->testTenantId);

        // Should still have exactly 6 roles, not 12.
        $this->assertSame(6, $statusAfterSecond['installed_count']);
        $roleNames = array_map(
            fn (string $key): string => 'kiss_' . $key . '_t' . $this->testTenantId,
            ['national_admin', 'canton_admin', 'municipality_admin', 'cooperative_coordinator', 'organisation_coordinator', 'trusted_reviewer']
        );
        $roleCount = DB::table('roles')->whereIn('name', $roleNames)->count();
        $this->assertSame(6, $roleCount);
    }

    public function test_national_admin_has_most_permissions(): void
    {
        $this->cleanPresets();
        $this->service()->install($this->testTenantId);

        $status = $this->service()->status($this->testTenantId);
        $byKey = [];
        foreach ($status['presets'] as $preset) {
            $byKey[$preset['key']] = $preset;
        }

        // national_admin is the highest level and should have more permissions than trusted_reviewer.
        $this->assertGreaterThan(
            $byKey['trusted_reviewer']['permission_count'],
            $byKey['national_admin']['permission_count']
        );
    }

    public function test_roles_are_scoped_to_tenant(): void
    {
        $this->cleanPresets();
        $this->service()->install($this->testTenantId);

        // The tenant 999 should not have any of the KISS preset roles installed.
        $status999 = $this->service()->status(999);
        $this->assertSame(0, $status999['installed_count']);
    }

    public function test_install_unknown_preset_key_installs_all(): void
    {
        $this->cleanPresets();

        // Passing a non-existent key falls back to installing all presets.
        $status = $this->service()->install($this->testTenantId, 'nonexistent_preset');

        $this->assertSame(6, $status['installed_count']);
    }
}
