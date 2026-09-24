<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E035;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\TenantSettingsService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * E-035 F-153 — a plain admin must not be able to turn member approval OFF
 * through PUT /v2/admin/config/registration-policy. Writing
 * general.admin_approval=false on the settings endpoint is platform-super-admin
 * only; the registration-policy sync writes the same setting for every mode
 * except open_with_approval, so it was a back door around that guard.
 */
class RegistrationPolicyApprovalGuardTest extends TestCase
{
    use DatabaseTransactions;

    private function tss(): TenantSettingsService
    {
        return app(TenantSettingsService::class);
    }

    private function plainAdmin(): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->admin()->create([
            'status' => 'active', 'is_approved' => true,
        ]);
        DB::table('users')->where('id', $u->id)->update([
            'role' => 'admin', 'is_super_admin' => 0, 'is_tenant_super_admin' => 0, 'is_god' => 0,
        ]);
        return $u->refresh();
    }

    private function superAdmin(): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->admin()->create([
            'status' => 'active', 'is_approved' => true,
        ]);
        DB::table('users')->where('id', $u->id)->update([
            'role' => 'admin', 'is_super_admin' => 1, 'is_tenant_super_admin' => 0, 'is_god' => 0,
        ]);
        return $u->refresh();
    }

    private function requireApprovalOn(): void
    {
        TenantContext::setById($this->testTenantId);
        $this->tss()->set($this->testTenantId, 'admin_approval', 'true', 'boolean');
        $this->tss()->clearCache();
    }

    public function test_plain_admin_cannot_clear_approval_via_registration_policy(): void
    {
        $this->requireApprovalOn();
        $this->assertTrue($this->tss()->requiresAdminApproval($this->testTenantId));

        Sanctum::actingAs($this->plainAdmin(), ['*']);
        $res = $this->apiPut('/v2/admin/config/registration-policy', ['registration_mode' => 'open']);

        $this->tss()->clearCache();
        $this->assertSame(403, $res->status(), 'plain admin was allowed to disable approval');
        $this->assertTrue(
            $this->tss()->requiresAdminApproval($this->testTenantId),
            'member approval was cleared by a plain admin'
        );
    }

    public function test_plain_admin_may_still_turn_approval_on(): void
    {
        // Start from approval OFF; switching to open_with_approval strengthens the
        // gate and must remain a plain-admin action.
        TenantContext::setById($this->testTenantId);
        $this->tss()->set($this->testTenantId, 'admin_approval', 'false', 'boolean');
        $this->tss()->clearCache();

        Sanctum::actingAs($this->plainAdmin(), ['*']);
        $res = $this->apiPut('/v2/admin/config/registration-policy', ['registration_mode' => 'open_with_approval']);

        $this->tss()->clearCache();
        $this->assertSame(200, $res->status(), 'plain admin was refused turning approval ON');
        $this->assertTrue($this->tss()->requiresAdminApproval($this->testTenantId));
    }

    public function test_super_admin_may_clear_approval_via_registration_policy(): void
    {
        $this->requireApprovalOn();

        Sanctum::actingAs($this->superAdmin(), ['*']);
        $res = $this->apiPut('/v2/admin/config/registration-policy', ['registration_mode' => 'open']);

        $this->tss()->clearCache();
        $this->assertSame(200, $res->status(), 'super admin was refused a legitimate approval change');
        $this->assertFalse(
            $this->tss()->requiresAdminApproval($this->testTenantId),
            'super admin could not clear approval'
        );
    }
}
