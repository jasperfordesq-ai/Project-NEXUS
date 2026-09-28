<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E055;

use App\Core\TenantContext;
use App\Services\CaringCommunityRolePresetService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * E-055 F-267 — role names are unique across the platform, and the preset
 * names are predictable (kiss_<key>_t<tenantId>). Installing a community's
 * role presets must never adopt a role another community already created
 * under that name (with whatever permissions it attached): the planted role
 * stays where it is and no permission reaches the installing community.
 */
final class F267RolePresetDoesNotAdoptForeignRoleTest extends TestCase
{
    use DatabaseTransactions;

    private function service(): CaringCommunityRolePresetService
    {
        return app(CaringCommunityRolePresetService::class);
    }

    public function test_install_does_not_adopt_a_role_planted_by_another_community(): void
    {
        $plantingTenant = (int) DB::table('tenants')->insertGetId([
            'name' => 'F267 Planter', 'slug' => 'f267-planter-' . uniqid('', false), 'is_active' => 1,
        ]);
        $plantedName = 'kiss_national_admin_t' . $this->testTenantId;
        $plantedId = (int) DB::table('roles')->insertGetId([
            'name' => $plantedName, 'display_name' => 'planted', 'level' => 99, 'is_system' => 0,
            'tenant_id' => $plantingTenant,
        ]);

        TenantContext::setById($this->testTenantId);
        $threw = false;
        try {
            $this->service()->install($this->testTenantId, 'national_admin');
        } catch (\RuntimeException $e) {
            $threw = true;
        }

        $this->assertTrue($threw, 'Installing over a foreign-owned role name must fail closed.');
        $this->assertSame($plantingTenant, (int) DB::table('roles')->where('id', $plantedId)->value('tenant_id'));
        $this->assertSame(0, DB::table('roles')->where('tenant_id', $this->testTenantId)->where('name', $plantedName)->count());
        $this->assertSame(0, DB::table('role_permissions')->where('role_id', $plantedId)->where('tenant_id', $this->testTenantId)->count());
    }

    public function test_control_clean_install_creates_the_communitys_own_role(): void
    {
        $name = 'kiss_national_admin_t' . $this->testTenantId;
        DB::table('roles')->where('name', $name)->delete();
        TenantContext::setById($this->testTenantId);

        $this->service()->install($this->testTenantId, 'national_admin');
        $this->service()->install($this->testTenantId, 'national_admin'); // idempotent

        $this->assertSame(1, DB::table('roles')->where('tenant_id', $this->testTenantId)->where('name', $name)->count());
    }
}
