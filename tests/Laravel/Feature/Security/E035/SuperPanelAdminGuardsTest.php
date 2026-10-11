<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E035;

use App\Core\SuperPanelAccess;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * E-035 super-panel authority guards.
 *
 * F-168 — the cross-tenant impersonation endpoint checked only subtree access,
 * not rank, so a regional super-admin could impersonate a same-rank peer. It now
 * applies the same locked outrank check the community endpoint uses.
 *
 * F-172 — a plain tenantUpdate could flip is_active / max_depth / allows_subtenants
 * with only canAccessTenant(), bypassing the guards on the dedicated deactivate
 * endpoint. Structural changes now require canManageTenant() plus the
 * active-children / master checks.
 */
class SuperPanelAdminGuardsTest extends TestCase
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

        $this->hubId = $this->makeTenant('E035 Hub', '/9100/', true, null);
        $this->childId = $this->makeTenant('E035 Child', '/9100/9101/', true, $this->hubId);
        $this->grandchildId = $this->makeTenant('E035 Grandchild', '/9100/9101/9102/', false, $this->childId);

        $this->regionalAdmin = User::factory()->forTenant($this->hubId)->admin()->create([
            'status' => 'active', 'is_approved' => true,
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

    private function makeTenant(string $name, string $path, bool $hub, ?int $parentId): int
    {
        return (int) DB::table('tenants')->insertGetId([
            'name' => $name,
            'slug' => strtolower(str_replace(' ', '-', $name)) . '-' . uniqid('', false),
            'is_active' => 1,
            'allows_subtenants' => $hub ? 1 : 0,
            'parent_id' => $parentId,
            'depth' => substr_count(rtrim($path, '/'), '/') - 1,
            'path' => $path,
            'max_depth' => 3,
        ]);
    }

    private function actAsRegional(): void
    {
        SuperPanelAccess::reset();
        $this->withTenant($this->hubId);
        Sanctum::actingAs($this->regionalAdmin);
    }

    // ── F-168: impersonation outrank ──────────────────────────────────────────

    public function test_a_regional_admin_cannot_impersonate_a_peer_super_admin_via_super_panel(): void
    {
        $peer = User::factory()->forTenant($this->hubId)->admin()->create([
            'status' => 'active', 'is_approved' => true,
        ]);
        DB::table('users')->where('id', $peer->id)->update(['is_tenant_super_admin' => 1]);

        $this->actAsRegional();

        $this->apiPost("/v2/admin/super/users/{$peer->id}/impersonate", [])
            ->assertStatus(403);
    }

    public function test_a_regional_admin_can_still_impersonate_a_lower_tier_member(): void
    {
        // A member of its OWN community. Until the owner's decision of 11 Oct
        // 2026 this used a member of the child beneath the hub; that community is
        // now out of reach, which is pinned at the end.
        $member = User::factory()->forTenant($this->hubId)->create([
            'status' => 'active', 'is_approved' => true,
        ]);
        $childMember = User::factory()->forTenant($this->childId)->create([
            'status' => 'active', 'is_approved' => true,
        ]);

        $this->actAsRegional();

        $response = $this->apiPost("/v2/admin/super/users/{$member->id}/impersonate", []);
        $response->assertStatus(200);
        $this->assertNotEmpty($response->json('data.token'));
        $this->assertSame($this->hubId, (int) $response->json('data.tenant_id'));

        SuperPanelAccess::reset();
        $this->apiPost("/v2/admin/super/users/{$childMember->id}/impersonate", [])->assertStatus(403);
    }

    // ── F-172: structural tenant changes ──────────────────────────────────────

    public function test_a_regional_admin_cannot_deactivate_its_own_root_via_update(): void
    {
        $this->actAsRegional();

        $this->apiPut("/v2/admin/super/tenants/{$this->hubId}", ['is_active' => 0])
            ->assertStatus(403);

        $this->assertSame(
            1,
            (int) DB::table('tenants')->where('id', $this->hubId)->value('is_active'),
            'deactivating the community you operate from must be refused'
        );
    }

    public function test_a_regional_admin_cannot_widen_its_own_subtree_limits_via_update(): void
    {
        $this->actAsRegional();

        $this->apiPut("/v2/admin/super/tenants/{$this->hubId}", ['max_depth' => 9])
            ->assertStatus(403);
        $this->assertSame(3, (int) DB::table('tenants')->where('id', $this->hubId)->value('max_depth'));

        $this->apiPut("/v2/admin/super/tenants/{$this->hubId}", ['allows_subtenants' => 0])
            ->assertStatus(403);
        $this->assertSame(1, (int) DB::table('tenants')->where('id', $this->hubId)->value('allows_subtenants'));
    }

    public function test_a_parent_with_active_children_cannot_be_deactivated_via_update(): void
    {
        // childId still has the active grandchild beneath it. Since the owner's
        // decision of 11 Oct 2026 the regional admin is refused the child outright
        // (403), so the active-children guard (422) is exercised by the platform
        // owner. This test was ..._a_regional_admin_cannot_... and expected 422.
        $this->actAsRegional();
        $this->apiPut("/v2/admin/super/tenants/{$this->childId}", ['is_active' => 0])
            ->assertStatus(403);

        $this->actAsPlatformOwner();
        $this->apiPut("/v2/admin/super/tenants/{$this->childId}", ['is_active' => 0])
            ->assertStatus(422);

        $this->assertSame(
            1,
            (int) DB::table('tenants')->where('id', $this->childId)->value('is_active')
        );
    }

    public function test_only_the_platform_owner_deactivates_a_childless_descendant_via_update(): void
    {
        // Was ..._a_regional_admin_can_still_deactivate_... (200). The regional
        // admin is now refused: the descendant is another community.
        $this->actAsRegional();
        $this->apiPut("/v2/admin/super/tenants/{$this->grandchildId}", ['is_active' => 0])
            ->assertStatus(403);
        $this->assertSame(
            1,
            (int) DB::table('tenants')->where('id', $this->grandchildId)->value('is_active')
        );

        $this->actAsPlatformOwner();
        $this->apiPut("/v2/admin/super/tenants/{$this->grandchildId}", ['is_active' => 0])
            ->assertStatus(200);

        $this->assertSame(
            0,
            (int) DB::table('tenants')->where('id', $this->grandchildId)->value('is_active')
        );
    }

    private function actAsPlatformOwner(): void
    {
        $owner = User::factory()->forTenant($this->hubId)->admin()->create([
            'status' => 'active', 'is_approved' => true,
        ]);
        DB::table('users')->where('id', $owner->id)->update(['is_super_admin' => 1]);
        $owner->refresh();

        SuperPanelAccess::reset();
        $this->withTenant($this->hubId);
        Sanctum::actingAs($owner);
    }

    public function test_an_ordinary_field_edit_on_the_own_root_still_works(): void
    {
        // The guard must not block non-structural edits to the caller's own tenant.
        $this->actAsRegional();

        $this->apiPut("/v2/admin/super/tenants/{$this->hubId}", ['tagline' => 'Still editable'])
            ->assertStatus(200);

        $this->assertSame(
            'Still editable',
            DB::table('tenants')->where('id', $this->hubId)->value('tagline')
        );
    }
}
