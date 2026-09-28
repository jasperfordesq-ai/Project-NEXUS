<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E055;

use App\Core\SuperPanelAccess;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-251 (E-055 C-3) — residual of F-172 / F-142. Hub mode and activation of a
 * tenant are hierarchy-structural, so they need canManageTenant(), which (unlike
 * canAccessTenant) refuses a regional super-admin's OWN root. Before the fix
 * toggle-hub, bulk enable_hub / disable_hub / activate and reactivate checked
 * only canAccessTenant(): a regional admin could switch hub mode off on its own
 * root, which also clears is_tenant_super_admin from every account there —
 * stripping a same-rank peer the revoke endpoint refuses to touch.
 */
final class F251RegionalAdminOwnRootHubTest extends TestCase
{
    use DatabaseTransactions;

    private int $hubId;

    private int $childId;

    private User $regional;

    private User $peer;

    protected function setUp(): void
    {
        parent::setUp();
        SuperPanelAccess::reset();

        $this->hubId = $this->makeTenant('F251 Hub', null, true);
        $this->childId = $this->makeTenant('F251 Child', $this->hubId, false);

        $this->regional = $this->networkAdmin($this->hubId);
        $this->peer = $this->networkAdmin($this->hubId);
    }

    protected function tearDown(): void
    {
        SuperPanelAccess::reset();
        parent::tearDown();
    }

    public function test_regional_admin_cannot_toggle_hub_on_its_own_root(): void
    {
        // Precondition from the finding: a hub with no child tenants, so the
        // has-children guard does not refuse the switch-off for another reason.
        DB::table('tenants')->where('id', $this->childId)->delete();
        $this->actAs($this->regional, $this->hubId);

        $this->apiPost("/v2/admin/super/tenants/{$this->hubId}/toggle-hub", ['enable' => false])->assertStatus(403);
        $this->apiPost("/v2/admin/super/tenants/{$this->hubId}/toggle-hub", ['enable' => true])->assertStatus(403);

        $this->assertSame(1, $this->tenantValue($this->hubId, 'allows_subtenants'));
        $this->assertSame(1, $this->userFlag($this->peer), 'peer keeps network-admin authority');
        $this->assertSame(1, $this->userFlag($this->regional));
    }

    public function test_regional_admin_cannot_bulk_change_hub_or_activation_of_its_own_root(): void
    {
        // Precondition from the finding: a hub with no child tenants, so the
        // has-children guard does not refuse the switch-off for another reason.
        DB::table('tenants')->where('id', $this->childId)->delete();
        $this->actAs($this->regional, $this->hubId);

        foreach (['disable_hub', 'enable_hub', 'activate'] as $action) {
            $response = $this->apiPost('/v2/admin/super/bulk/update-tenants', ['tenant_ids' => [$this->hubId], 'action' => $action]);
            $response->assertStatus(200);
            $this->assertSame(0, (int) $response->json('data.updated_count'), "$action must not update the own root");
            $this->assertSame('TENANT_ACCESS_DENIED', $response->json('data.errors.0.code'), "$action refusal code");
        }

        $this->assertSame(1, $this->tenantValue($this->hubId, 'allows_subtenants'));
        $this->assertSame(1, $this->userFlag($this->peer), 'peer keeps network-admin authority');
    }

    public function test_regional_admin_cannot_reactivate_its_own_root(): void
    {
        $this->actAs($this->regional, $this->hubId);

        $this->apiPost("/v2/admin/super/tenants/{$this->hubId}/reactivate", [])
            ->assertStatus(403)
            ->assertJsonPath('errors.0.code', 'SUPER_PANEL_ACCESS_DENIED');
    }

    public function test_control_regional_admin_still_manages_its_child_tenant(): void
    {
        $this->actAs($this->regional, $this->hubId);

        $this->apiPost("/v2/admin/super/tenants/{$this->childId}/toggle-hub", ['enable' => true])->assertStatus(200);
        $this->assertSame(1, $this->tenantValue($this->childId, 'allows_subtenants'));

        $response = $this->apiPost('/v2/admin/super/bulk/update-tenants', ['tenant_ids' => [$this->childId], 'action' => 'disable_hub']);
        $response->assertStatus(200);
        $this->assertSame(1, (int) $response->json('data.updated_count'));
        $this->assertSame(0, $this->tenantValue($this->childId, 'allows_subtenants'));

        DB::table('tenants')->where('id', $this->childId)->update(['is_active' => 0]);
        $this->apiPost("/v2/admin/super/tenants/{$this->childId}/reactivate", [])->assertStatus(200);
        $this->assertSame(1, $this->tenantValue($this->childId, 'is_active'));

        DB::table('tenants')->where('id', $this->childId)->update(['is_active' => 0]);
        $response = $this->apiPost('/v2/admin/super/bulk/update-tenants', ['tenant_ids' => [$this->childId], 'action' => 'activate']);
        $this->assertSame(1, (int) $response->json('data.updated_count'));
        $this->assertSame(1, $this->tenantValue($this->childId, 'is_active'));
    }

    public function test_control_master_super_admin_can_toggle_the_regional_root(): void
    {
        $master = User::factory()->forTenant(1)->admin()->create(['status' => 'active', 'is_approved' => true]);
        DB::table('users')->where('id', $master->id)->update([
            'is_super_admin' => 1, 'is_tenant_super_admin' => 0, 'is_god' => 0,
        ]);
        $master->refresh();
        $this->actAs($master, 1);
        self::assertSame('master', SuperPanelAccess::getAccess((int) $master->id)['level']);
        SuperPanelAccess::reset();

        // Remove the child so the hub may be switched off.
        DB::table('tenants')->where('id', $this->childId)->delete();

        $this->apiPost("/v2/admin/super/tenants/{$this->hubId}/toggle-hub", ['enable' => false])->assertStatus(200);
        $this->assertSame(0, $this->tenantValue($this->hubId, 'allows_subtenants'));

        $this->apiPost("/v2/admin/super/tenants/{$this->hubId}/toggle-hub", ['enable' => true])->assertStatus(200);
        $this->assertSame(1, $this->tenantValue($this->hubId, 'allows_subtenants'));
    }

    private function makeTenant(string $name, ?int $parentId, bool $hub): int
    {
        $parentPath = $parentId !== null ? (string) DB::table('tenants')->where('id', $parentId)->value('path') : '/';
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => $name,
            'slug' => strtolower(str_replace(' ', '-', $name)) . '-' . uniqid('', false),
            'is_active' => 1,
            'allows_subtenants' => $hub ? 1 : 0,
            'parent_id' => $parentId,
            'depth' => $parentId !== null ? 1 : 0,
            'path' => '/9551/',
            'max_depth' => 3,
        ]);
        DB::table('tenants')->where('id', $id)->update(['path' => $parentPath . $id . '/']);

        return $id;
    }

    private function networkAdmin(int $tenantId): User
    {
        $user = User::factory()->forTenant($tenantId)->admin()->create(['status' => 'active', 'is_approved' => true]);
        DB::table('users')->where('id', $user->id)->update([
            'is_tenant_super_admin' => 1, 'is_super_admin' => 0, 'is_god' => 0,
        ]);

        return $user->refresh();
    }

    private function actAs(User $user, int $tenantId): void
    {
        SuperPanelAccess::reset();
        $this->withTenant($tenantId);
        Sanctum::actingAs($user);
    }

    private function tenantValue(int $tenantId, string $column): int
    {
        return (int) DB::table('tenants')->where('id', $tenantId)->value($column);
    }

    private function userFlag(User $user): int
    {
        return (int) DB::table('users')->where('id', $user->id)->value('is_tenant_super_admin');
    }
}
