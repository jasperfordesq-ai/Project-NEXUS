<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\SuperAdmin;

use App\Core\SuperPanelAccess;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-060 (E-027): bulk tenant deactivation must keep the protections that
 * single deactivation (DELETE /v2/admin/super/tenants/{id}) has.
 *
 * The bulk path checked only canAccessTenant() and ran a raw UPDATE, so a
 * regional super-admin could deactivate its OWN root (canManageTenant()
 * refuses that) and anyone could deactivate a parent that still has active
 * children (TenantHierarchyService::deleteTenant() refuses that), stranding
 * the children.
 */
final class BulkTenantDeactivationGuardsTest extends TestCase
{
    use DatabaseTransactions;

    private int $hubId;

    private int $childId;

    private int $grandchildId;

    private User $regionalAdmin;

    protected function setUp(): void
    {
        parent::setUp();
        SuperPanelAccess::reset();

        $this->hubId = $this->makeTenant('Bulk Guard Hub', '/8300/', true);
        $this->childId = $this->makeTenant('Bulk Guard Child', '/8300/8301/', true, $this->hubId);
        $this->grandchildId = $this->makeTenant('Bulk Guard Grandchild', '/8300/8301/8302/', false, $this->childId);

        $this->regionalAdmin = User::factory()->forTenant($this->hubId)->admin()->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        DB::table('users')->where('id', $this->regionalAdmin->id)->update([
            'is_tenant_super_admin' => 1,
            'is_super_admin' => 0,
            'is_god' => 0,
        ]);
        $this->regionalAdmin->refresh();
    }

    protected function tearDown(): void
    {
        SuperPanelAccess::reset();
        parent::tearDown();
    }

    public function test_regional_super_admin_cannot_bulk_deactivate_its_own_root(): void
    {
        $this->actAsRegional();

        $response = $this->bulkDeactivate([$this->hubId]);

        $response->assertStatus(200);
        $this->assertSame(0, (int) $response->json('data.updated_count'));
        $this->assertSame(1, $this->isActive($this->hubId));
    }

    public function test_bulk_deactivation_refuses_a_parent_with_active_children(): void
    {
        $this->actAsRegional();

        $response = $this->bulkDeactivate([$this->childId]);

        $response->assertStatus(200);
        $this->assertSame(0, (int) $response->json('data.updated_count'));
        $this->assertSame(1, $this->isActive($this->childId));
    }

    public function test_bulk_deactivation_still_deactivates_a_managed_leaf_tenant(): void
    {
        $this->actAsRegional();

        $response = $this->bulkDeactivate([$this->grandchildId]);

        $response->assertStatus(200);
        $this->assertSame(1, (int) $response->json('data.updated_count'));
        $this->assertSame(0, $this->isActive($this->grandchildId));
    }

    private function bulkDeactivate(array $tenantIds): \Illuminate\Testing\TestResponse
    {
        return $this->apiPost('/v2/admin/super/bulk/update-tenants', [
            'tenant_ids' => $tenantIds,
            'action' => 'deactivate',
        ]);
    }

    private function isActive(int $tenantId): int
    {
        return (int) DB::table('tenants')->where('id', $tenantId)->value('is_active');
    }

    private function actAsRegional(): void
    {
        SuperPanelAccess::reset();
        $this->withTenant($this->hubId);
        Sanctum::actingAs($this->regionalAdmin);
    }

    private function makeTenant(string $name, string $path, bool $hub, ?int $parentId = null): int
    {
        return (int) DB::table('tenants')->insertGetId([
            'name' => $name,
            'slug' => strtolower(str_replace(' ', '-', $name)) . '-' . uniqid('', false),
            'parent_id' => $parentId,
            'is_active' => 1,
            'allows_subtenants' => $hub ? 1 : 0,
            'depth' => substr_count(rtrim($path, '/'), '/') - 1,
            'path' => $path,
            'max_depth' => 3,
        ]);
    }
}
