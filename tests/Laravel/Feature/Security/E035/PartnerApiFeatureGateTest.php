<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E035;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-175 — the per-community `partner_api` feature flag must actually gate the
 * Partner API admin path, and credit-writing scopes (wallet.write) must be
 * reserved to platform super-admins.
 */
class PartnerApiFeatureGateTest extends TestCase
{
    use DatabaseTransactions;

    private function setPartnerApiFeature(bool $on): void
    {
        $tenant = DB::table('tenants')->where('id', $this->testTenantId)->first();
        $features = json_decode($tenant->features ?? '{}', true) ?: [];
        $features['partner_api'] = $on;
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode($features),
            'updated_at' => now(),
        ]);
        TenantContext::setById($this->testTenantId);
    }

    private function actAsPlainAdmin(): User
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin, ['*']);

        return $admin;
    }

    private function actAsPlatformSuperAdmin(): User
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create([
            'role' => 'super_admin',
            'is_super_admin' => 1,
        ]);
        Sanctum::actingAs($admin, ['*']);

        return $admin;
    }

    public function test_tenant_without_partner_api_feature_cannot_create_partner(): void
    {
        $this->setPartnerApiFeature(false);
        $this->actAsPlainAdmin();

        $resp = $this->apiPost('/v2/admin/api-partners', ['name' => 'Bank Integration']);

        $resp->assertStatus(403);
        // requirePartnerApiFeature() throws via BaseApiController::error(), which
        // puts the code at the top level (same shape as requireAdmin()).
        $this->assertSame('PARTNER_API_DISABLED', $resp->json('code'));
    }

    public function test_plain_admin_cannot_grant_wallet_write_scope(): void
    {
        $this->setPartnerApiFeature(true);
        $this->actAsPlainAdmin();

        $resp = $this->apiPost('/v2/admin/api-partners', [
            'name' => 'Bank Integration',
            'allowed_scopes' => ['users.read', 'wallet.write'],
        ]);

        $resp->assertStatus(403);
        $this->assertSame('SCOPE_NOT_ALLOWED', $resp->json('errors.0.code'));
    }

    public function test_plain_admin_can_create_partner_without_reserved_scope(): void
    {
        $this->setPartnerApiFeature(true);
        $this->actAsPlainAdmin();

        $resp = $this->apiPost('/v2/admin/api-partners', [
            'name' => 'Read Only Integration',
            'allowed_scopes' => ['users.read', 'listings.read'],
        ]);

        $resp->assertStatus(201);
    }

    public function test_platform_super_admin_can_grant_wallet_write_scope(): void
    {
        $this->setPartnerApiFeature(true);
        $this->actAsPlatformSuperAdmin();

        $resp = $this->apiPost('/v2/admin/api-partners', [
            'name' => 'Trusted Bank',
            'allowed_scopes' => ['wallet.read', 'wallet.write'],
        ]);

        $resp->assertStatus(201);
    }
}
