<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E055;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-255 (E-055 C-7): PUT /v2/admin/users/{id}/super-admin with grant=true
 * wrote role='admin' over the target's role string with no rank comparison,
 * so a platform super-admin could demote a god or super-admin whose authority
 * lives in `role` (rank 4/3 -> 2). The endpoint now applies this controller's
 * security-target hierarchy (caller must strictly outrank the target, god may
 * act on anyone), checked up front and again under the row lock.
 */
class F255SetSuperAdminRankTest extends TestCase
{
    use DatabaseTransactions;

    private function platformSuperAdmin(): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
        DB::table('users')->where('id', $u->id)->update(['is_super_admin' => 1, 'is_god' => 0]);

        return $u->refresh();
    }

    private function god(): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
        DB::table('users')->where('id', $u->id)->update(['is_super_admin' => 1, 'is_god' => 1]);

        return $u->refresh();
    }

    private function roleStringOnly(string $role): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => 1]);
        DB::table('users')->where('id', $u->id)->update([
            'role' => $role, 'is_admin' => 0, 'is_super_admin' => 0, 'is_tenant_super_admin' => 0, 'is_god' => 0,
        ]);

        return $u->refresh();
    }

    private function row(int $id): object
    {
        return DB::table('users')->where('id', $id)
            ->first(['role', 'is_admin', 'is_super_admin', 'is_tenant_super_admin', 'is_god']);
    }

    private function assertRankRefusal($response): void
    {
        // The refusal every other rank-checked action in this controller gives.
        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', 'AUTH_INSUFFICIENT_PERMISSIONS');
        $response->assertJsonPath('errors.0.message', __('api.insufficient_permissions'));
    }

    public function test_super_admin_cannot_overwrite_a_role_string_god(): void
    {
        $target = $this->roleStringOnly('god');
        $before = $this->row((int) $target->id);
        Sanctum::actingAs($this->platformSuperAdmin());

        $this->assertRankRefusal($this->apiPut("/v2/admin/users/{$target->id}/super-admin", ['grant' => true]));
        $this->assertEquals($before, $this->row((int) $target->id));
    }

    public function test_super_admin_cannot_overwrite_a_role_string_super_admin_peer(): void
    {
        $target = $this->roleStringOnly('super_admin');
        $before = $this->row((int) $target->id);
        Sanctum::actingAs($this->platformSuperAdmin());

        $this->assertRankRefusal($this->apiPut("/v2/admin/users/{$target->id}/super-admin", ['grant' => true]));
        $this->assertEquals($before, $this->row((int) $target->id));

        // The peer keeps its platform routes.
        Sanctum::actingAs(User::find($target->id));
        $this->apiGet('/v2/admin/super/platform-capabilities')->assertStatus(200);
    }

    public function test_super_admin_cannot_revoke_on_a_flagged_super_admin_peer(): void
    {
        $peer = $this->platformSuperAdmin();
        DB::table('users')->where('id', $peer->id)->update(['is_tenant_super_admin' => 1]);
        $before = $this->row((int) $peer->id);
        Sanctum::actingAs($this->platformSuperAdmin());

        $this->assertRankRefusal($this->apiPut("/v2/admin/users/{$peer->id}/super-admin", ['grant' => false]));
        $this->assertEquals($before, $this->row((int) $peer->id));
    }

    public function test_control_super_admin_can_grant_and_revoke_on_an_ordinary_admin(): void
    {
        $target = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
        Sanctum::actingAs($this->platformSuperAdmin());

        $this->apiPut("/v2/admin/users/{$target->id}/super-admin", ['grant' => true])
            ->assertStatus(200)
            ->assertJsonPath('data.is_tenant_super_admin', true);
        $row = $this->row((int) $target->id);
        $this->assertSame(1, (int) $row->is_tenant_super_admin);
        $this->assertSame('admin', $row->role);

        $this->apiPut("/v2/admin/users/{$target->id}/super-admin", ['grant' => false])
            ->assertStatus(200)
            ->assertJsonPath('data.is_tenant_super_admin', false);
        $this->assertSame(0, (int) $this->row((int) $target->id)->is_tenant_super_admin);
    }

    public function test_control_super_admin_can_grant_on_an_ordinary_member(): void
    {
        $target = $this->roleStringOnly('member');
        Sanctum::actingAs($this->platformSuperAdmin());

        $this->apiPut("/v2/admin/users/{$target->id}/super-admin", ['grant' => true])->assertStatus(200);
        $row = $this->row((int) $target->id);
        $this->assertSame('admin', $row->role);
        $this->assertSame(1, (int) $row->is_tenant_super_admin);
    }

    public function test_control_god_can_still_act_on_a_role_string_super_admin(): void
    {
        $target = $this->roleStringOnly('super_admin');
        Sanctum::actingAs($this->god());

        $this->apiPut("/v2/admin/users/{$target->id}/super-admin", ['grant' => false])->assertStatus(200);
    }

    public function test_control_god_only_endpoint_unchanged(): void
    {
        $target = $this->roleStringOnly('super_admin');
        Sanctum::actingAs($this->platformSuperAdmin());

        $this->apiPut("/v2/admin/users/{$target->id}/global-super-admin", ['grant' => false])->assertStatus(403);
        $this->assertSame('super_admin', $this->row((int) $target->id)->role);
    }
}
