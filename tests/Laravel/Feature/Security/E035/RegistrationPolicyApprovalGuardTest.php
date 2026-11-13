<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E035;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\TenantSettingsService;
use App\Services\TwoFactorPolicy;
use App\Services\TokenService;
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

    private function god(): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->admin()->create([
            'status' => 'active', 'is_approved' => true,
        ]);
        DB::table('users')->where('id', $u->id)->update([
            'role' => 'admin', 'is_super_admin' => 1, 'is_tenant_super_admin' => 0, 'is_god' => 1,
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

    // Owner, 13 Nov 2026: the registration policy is god accounts only. Until
    // then a plain admin could change the joining method in the direction that
    // keeps approval on, and a platform super admin could clear it; both are
    // now refused, whichever way the change would go.

    public function test_plain_admin_cannot_change_the_policy_at_all_now(): void
    {
        TenantContext::setById($this->testTenantId);
        $this->tss()->set($this->testTenantId, 'admin_approval', 'false', 'boolean');
        $this->tss()->clearCache();

        Sanctum::actingAs($this->plainAdmin(), ['*']);
        $res = $this->apiPut('/v2/admin/config/registration-policy', ['registration_mode' => 'open_with_approval']);

        $this->tss()->clearCache();
        $this->assertSame(403, $res->status(), 'a plain admin changed the god-only registration policy');
        $this->assertFalse($this->tss()->requiresAdminApproval($this->testTenantId), 'the refused change was applied');
    }

    public function test_platform_super_admin_who_is_not_god_is_refused(): void
    {
        $this->requireApprovalOn();

        Sanctum::actingAs($this->superAdmin(), ['*']);
        $res = $this->apiPut('/v2/admin/config/registration-policy', ['registration_mode' => 'open']);

        $this->tss()->clearCache();
        $this->assertSame(403, $res->status(), 'a non-god super admin changed the god-only registration policy');
        $this->assertTrue($this->tss()->requiresAdminApproval($this->testTenantId));
    }

    public function test_god_may_clear_approval_via_registration_policy(): void
    {
        $this->requireApprovalOn();

        Sanctum::actingAs($this->god(), ['*']);
        $res = $this->apiPut('/v2/admin/config/registration-policy', ['registration_mode' => 'open']);

        $this->tss()->clearCache();
        $this->assertSame(200, $res->status(), 'a god account was refused a legitimate approval change');
        $this->assertFalse(
            $this->tss()->requiresAdminApproval($this->testTenantId),
            'god could not clear approval'
        );
    }

    public function test_identity_provider_keys_are_god_only_too(): void
    {
        // These two routes also need a recent second factor ('step-up'), which
        // answers 403 on its own; sign in with one so the refusal tested here
        // is the god rule, not that earlier check.
        $this->withHeaders(['Authorization' => 'Bearer ' . $this->tokenWithSecondFactor($this->superAdmin())]);
        $put = $this->apiPut('/v2/admin/identity/provider-credentials/mock', ['api_key' => 'x']);
        $delete = $this->apiDelete('/v2/admin/identity/provider-credentials/mock');
        foreach ([$put, $delete] as $res) {
            $this->assertSame(403, $res->status());
            $this->assertSame('AUTH_INSUFFICIENT_PERMISSIONS', $res->json('errors.0.code') ?? $res->json('code'), 'refused by something other than the god rule');
        }

        // Control: a god account with the same second factor gets through.
        $this->withHeaders(['Authorization' => 'Bearer ' . $this->tokenWithSecondFactor($this->god())]);
        $this->assertSame(200, $this->apiDelete('/v2/admin/identity/provider-credentials/mock')->status());
    }

    private function tokenWithSecondFactor(User $user): string
    {
        return app(TokenService::class)->generateToken($user->id, $user->tenant_id, TwoFactorPolicy::claims('totp'));
    }
}
