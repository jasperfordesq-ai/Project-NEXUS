<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E078;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-529 (E-078): merchant coupon administration must follow the same two
 * switches as the member and seller coupon routes — `marketplace` AND
 * `merchant_coupons`. Before the fix the admin controller checked neither.
 */
class MerchantCouponAdminFeatureGateTest extends TestCase
{
    use DatabaseTransactions;

    public function test_admin_coupon_list_is_refused_when_the_marketplace_is_off(): void
    {
        $this->setFeatures(['marketplace' => false, 'merchant_coupons' => true]);
        Sanctum::actingAs($this->admin());

        $this->apiGet('/v2/admin/marketplace/coupons')->assertStatus(403);
    }

    public function test_admin_coupon_list_is_refused_when_merchant_coupons_are_off(): void
    {
        $this->setFeatures(['marketplace' => true, 'merchant_coupons' => false]);
        Sanctum::actingAs($this->admin());

        $this->apiGet('/v2/admin/marketplace/coupons')->assertStatus(403);
    }

    public function test_admin_coupon_suspend_and_delete_are_refused_when_the_module_is_off(): void
    {
        $this->setFeatures(['marketplace' => false, 'merchant_coupons' => true]);
        Sanctum::actingAs($this->admin());

        // A missing id answers 404 when the module is on (control below), so a 403
        // here proves the switch is checked before the coupon is looked up.
        $this->apiPost('/v2/admin/marketplace/coupons/999999999/suspend')->assertStatus(403);
        $this->apiDelete('/v2/admin/marketplace/coupons/999999999')->assertStatus(403);
    }

    public function test_control_admin_coupon_routes_work_when_both_switches_are_on(): void
    {
        $this->setFeatures(['marketplace' => true, 'merchant_coupons' => true]);
        Sanctum::actingAs($this->admin());

        $this->apiGet('/v2/admin/marketplace/coupons')->assertStatus(200);
        $this->apiPost('/v2/admin/marketplace/coupons/999999999/suspend')->assertStatus(404);
        $this->apiDelete('/v2/admin/marketplace/coupons/999999999')->assertStatus(404);
    }

    private function admin(): User
    {
        return User::factory()->forTenant($this->testTenantId)->admin()->create();
    }

    /** @param array<string, bool> $values */
    private function setFeatures(array $values): void
    {
        $row = DB::table('tenants')->where('id', $this->testTenantId)->first(['features']);
        $current = json_decode((string) ($row->features ?? '{}'), true) ?: [];
        DB::table('tenants')->where('id', $this->testTenantId)
            ->update(['features' => json_encode(array_merge($current, $values))]);
        TenantContext::setById($this->testTenantId);
    }
}
