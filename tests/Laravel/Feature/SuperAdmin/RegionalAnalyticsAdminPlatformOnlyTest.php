<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\SuperAdmin;

use App\Http\Middleware\EnsureIsSuperAdmin;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-594: /api/super-admin/regional-analytics/* is platform-wide data —
 * partner subscriptions across every community and the partner access log —
 * but RegionalAnalyticsAdminController guarded each action with
 * requireSuperAdmin(), which ADMITS a tenant super admin. Only the route
 * group's `super-admin` middleware (EnsureIsSuperAdmin) stood between a tenant
 * super admin and that data, so moving the routes or dropping the middleware
 * would have opened it.
 *
 * The controller now uses requirePlatformSuperAdmin() itself. These tests run
 * with the route middleware removed so they prove the controller's own check.
 */
class RegionalAnalyticsAdminPlatformOnlyTest extends TestCase
{
    use DatabaseTransactions;

    private function actAs(array $flags): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->admin()->create([
            'status' => 'active', 'is_approved' => true,
        ]);
        DB::table('users')->where('id', $user->id)->update($flags);
        Sanctum::actingAs($user->fresh());
    }

    public function test_a_tenant_super_admin_is_refused_by_the_controller_itself(): void
    {
        $this->withoutMiddleware(EnsureIsSuperAdmin::class);
        $this->actAs(['is_tenant_super_admin' => 1, 'is_super_admin' => 0, 'is_god' => 0]);

        $this->getJson('/api/super-admin/regional-analytics/subscriptions', $this->withTenantHeader())
            ->assertStatus(403);
        $this->getJson('/api/super-admin/regional-analytics/access-log', $this->withTenantHeader())
            ->assertStatus(403);
        $this->getJson('/api/super-admin/regional-analytics/subscriptions/999999', $this->withTenantHeader())
            ->assertStatus(403);
        $this->postJson('/api/super-admin/regional-analytics/subscriptions/999999/generate-report', [], $this->withTenantHeader())
            ->assertStatus(403);
        $this->deleteJson('/api/super-admin/regional-analytics/subscriptions/999999', [], $this->withTenantHeader())
            ->assertStatus(403);
    }

    public function test_a_platform_super_admin_is_still_admitted(): void
    {
        $this->withoutMiddleware(EnsureIsSuperAdmin::class);
        $this->actAs(['is_super_admin' => 1, 'is_tenant_super_admin' => 0, 'is_god' => 0]);

        $this->getJson('/api/super-admin/regional-analytics/subscriptions', $this->withTenantHeader())
            ->assertStatus(200);
    }

    public function test_with_the_route_middleware_a_tenant_super_admin_is_refused_too(): void
    {
        $this->actAs(['is_tenant_super_admin' => 1, 'is_super_admin' => 0, 'is_god' => 0]);

        $this->getJson('/api/super-admin/regional-analytics/subscriptions', $this->withTenantHeader())
            ->assertStatus(403);
    }
}
