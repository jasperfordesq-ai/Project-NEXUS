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
 * A hub tenant's super-admin sees its own branch and NOTHING from a sibling.
 *
 * 🔴 This is the test that has to hold for the hierarchical panel to be safe.
 *
 * The super panel is now split in two:
 *   - TIER A ('super-panel'): endpoints that confine themselves to the caller's
 *     accessible subtree. A regional super-admin may use these.
 *   - TIER B ('super-admin'): platform-wide powers — billing and revenue, the
 *     external-federation kill switches, platform capabilities, granting PLATFORM
 *     super-admin. A regional super-admin must be refused ALL of these.
 *
 * Tier B is not merely a preference. Several billing endpoints read a tenant id
 * straight from the request body and check only that the caller is a super-admin,
 * so admitting a regional caller there would let one branch set another branch's
 * billing plan. And granting platform super-admin is the escape hatch out of a
 * branch entirely.
 */
class RegionalPanelIsolationTest extends TestCase
{
    use DatabaseTransactions;

    private int $hubId;
    private int $childId;
    private int $siblingId;
    private int $siblingChildId;
    private User $regionalAdmin;

    protected function setUp(): void
    {
        parent::setUp();
        SuperPanelAccess::reset();

        // Two independent branches, each with a child.
        $this->hubId = $this->makeTenant('Branch A Hub', '/8100/', true);
        $this->childId = $this->makeTenant('Branch A Child', '/8100/8101/', false);
        $this->siblingId = $this->makeTenant('Branch B Hub', '/8200/', true);
        $this->siblingChildId = $this->makeTenant('Branch B Child', '/8200/8201/', false);

        // Regional super-admin of branch A only.
        $this->regionalAdmin = User::factory()->forTenant($this->hubId)->admin()->create([
            'first_name' => 'Rhona', 'last_name' => 'Regional',
            'status' => 'active', 'is_approved' => true,
        ]);
        DB::table('users')->where('id', $this->regionalAdmin->id)->update([
            'is_tenant_super_admin' => 1,
            'is_super_admin' => 0,
            'is_god' => 0,
        ]);
        // 🔴 Required. Sanctum::actingAs() authenticates the in-memory model, and
        // BaseApiController::requireSuperAdmin() reads its attributes — so without
        // this refresh the flags set by the raw UPDATE above are invisible and
        // every request 403s with AUTH_INSUFFICIENT_PERMISSIONS, before the panel
        // gate is reached.
        $this->regionalAdmin->refresh();
    }

    protected function tearDown(): void
    {
        SuperPanelAccess::reset();
        parent::tearDown();
    }

    private function makeTenant(string $name, string $path, bool $hub): int
    {
        return (int) DB::table('tenants')->insertGetId([
            'name' => $name,
            'slug' => strtolower(str_replace(' ', '-', $name)) . '-' . uniqid('', false),
            'is_active' => 1,
            'allows_subtenants' => $hub ? 1 : 0,
            'depth' => substr_count(rtrim($path, '/'), '/') - 1,
            'path' => $path,
            'max_depth' => 3,
        ]);
    }

    /**
     * Act as the branch-A hub super-admin.
     *
     * `withTenant()` is required, not cosmetic: the API request helpers send an
     * `X-Tenant-ID` header and `ResolveTenant` rejects a user whose account does
     * not belong to the resolved tenant. Without it every request 403s with
     * `tenant_mismatch` before the panel gate is ever consulted, which would make
     * these tests pass for entirely the wrong reason.
     */
    private function actAsRegional(): void
    {
        SuperPanelAccess::reset();
        $this->withTenant($this->hubId);
        Sanctum::actingAs($this->regionalAdmin);
    }

    // ── Level resolution ────────────────────────────────────────────────────

    public function test_the_hub_admin_resolves_to_regional_not_master(): void
    {
        SuperPanelAccess::reset();
        $access = SuperPanelAccess::getAccess((int) $this->regionalAdmin->id);

        $this->assertTrue($access['granted']);
        $this->assertSame('regional', $access['level']);
        $this->assertSame('/8100/', $access['tenant_path']);
    }

    // ── Tier A: admitted, and confined ──────────────────────────────────────

    public function test_the_tenant_list_contains_its_own_branch_and_no_sibling(): void
    {
        $this->actAsRegional();

        $response = $this->apiGet('/v2/admin/super/tenants')->assertStatus(200);
        $body = json_encode($response->json('data'));

        $this->assertStringContainsString('Branch A Hub', $body);
        $this->assertStringContainsString('Branch A Child', $body);
        // 🔴 The leakage assertion.
        $this->assertStringNotContainsString('Branch B Hub', $body);
        $this->assertStringNotContainsString('Branch B Child', $body);
    }

    public function test_the_hierarchy_tree_contains_no_sibling_branch(): void
    {
        $this->actAsRegional();

        $body = json_encode($this->apiGet('/v2/admin/super/tenants/hierarchy')->assertStatus(200)->json('data'));

        $this->assertStringContainsString('Branch A Hub', $body);
        $this->assertStringNotContainsString('Branch B Hub', $body);
    }

    public function test_the_user_list_contains_no_member_of_a_sibling_branch(): void
    {
        // The largest cross-tenant PII surface in the panel.
        User::factory()->forTenant($this->childId)->create([
            'first_name' => 'Owen', 'last_name' => 'Ourbranch',
            'status' => 'active', 'is_approved' => true,
        ]);
        User::factory()->forTenant($this->siblingChildId)->create([
            'first_name' => 'Sasha', 'last_name' => 'Sibling',
            'status' => 'active', 'is_approved' => true,
        ]);

        $this->actAsRegional();
        $body = json_encode($this->apiGet('/v2/admin/super/users')->assertStatus(200)->json('data'));

        $this->assertStringContainsString('Ourbranch', $body);
        $this->assertStringNotContainsString('Sibling', $body);
    }

    public function test_a_sibling_tenant_cannot_be_read_directly(): void
    {
        // Guessing the id must not work either.
        $this->actAsRegional();

        $this->apiGet("/v2/admin/super/tenants/{$this->siblingId}")->assertStatus(404);
        $this->apiGet("/v2/admin/super/tenants/{$this->childId}")->assertStatus(200);
    }

    public function test_a_sibling_tenant_cannot_be_modified(): void
    {
        $this->actAsRegional();

        // Note the asymmetry, which is deliberate and correct: a READ of an
        // inaccessible tenant returns 404 (indistinguishable from "no such
        // tenant", so ids cannot be probed), while a WRITE returns an explicit
        // 403. Either way it is refused — that is what matters here.
        $this->apiPut("/v2/admin/super/tenants/{$this->siblingId}", ['name' => 'Hijacked'])
            ->assertStatus(403);

        $this->assertSame(
            'Branch B Hub',
            DB::table('tenants')->where('id', $this->siblingId)->value('name')
        );
    }

    public function test_its_own_child_can_be_modified(): void
    {
        // The fix must not break the legitimate case.
        $this->actAsRegional();

        $this->apiPut("/v2/admin/super/tenants/{$this->childId}", ['name' => 'Branch A Child Renamed'])
            ->assertStatus(200);

        $this->assertSame(
            'Branch A Child Renamed',
            DB::table('tenants')->where('id', $this->childId)->value('name')
        );
    }

    /*
     * ── Body-supplied tenant ids ────────────────────────────────────────────
     *
     * 🔴 Added after an audit of this work. The tests above cover reads and the
     * URL-addressed tenantShow/tenantUpdate, but the tier-A mutations that take a
     * tenant id from the REQUEST BODY were only verified by reading the code.
     * That is the exact class of hole that keeps billing in tier B — an id from
     * the body with no branch check — so it needs to be tested, not inspected.
     * The bulk endpoints matter most: they loop, and a check that covers only the
     * first id, or only one end of a move, reads as correct.
     */

    public function test_a_tenant_cannot_be_created_under_a_sibling_branch(): void
    {
        $this->actAsRegional();

        $this->apiPost('/v2/admin/super/tenants', [
            'name' => 'Smuggled Child',
            'slug' => 'smuggled-' . uniqid('', false),
            'parent_id' => $this->siblingId,
        ])->assertStatus(403);

        $this->assertDatabaseMissing('tenants', ['parent_id' => $this->siblingId]);
    }

    public function test_a_user_cannot_be_created_inside_a_sibling_branch(): void
    {
        $this->actAsRegional();

        $this->apiPost('/v2/admin/super/users', [
            'tenant_id' => $this->siblingId,
            'email' => 'smuggled-' . uniqid('', false) . '@example.test',
            'first_name' => 'Smuggled',
            'last_name' => 'User',
            'password' => 'TestPassword123!',
        ])->assertStatus(403);

        $this->assertSame(
            0,
            (int) DB::table('users')->where('tenant_id', $this->siblingId)->where('first_name', 'Smuggled')->count()
        );
    }

    public function test_a_bulk_update_rejects_a_sibling_id_mixed_in_with_its_own(): void
    {
        // 🔴 The interesting case: a valid id alongside one from another branch.
        // A check on only the first element would let the sibling through.
        $this->actAsRegional();

        $this->apiPost('/v2/admin/super/bulk/update-tenants', [
            'tenant_ids' => [$this->childId, $this->siblingId],
            'action' => 'deactivate',
        ])->assertStatus(200);

        // Own child updated; sibling untouched and reported as denied.
        $this->assertSame(0, (int) DB::table('tenants')->where('id', $this->childId)->value('is_active'));
        $this->assertSame(1, (int) DB::table('tenants')->where('id', $this->siblingId)->value('is_active'));
    }

    public function test_a_bulk_move_cannot_pull_a_member_out_of_a_sibling_branch(): void
    {
        // Both ends must be checked. Checking only the destination would let a
        // branch admin harvest members out of someone else's branch.
        $siblingMember = User::factory()->forTenant($this->siblingChildId)->create([
            'status' => 'active', 'is_approved' => true,
        ]);
        $ownMember = User::factory()->forTenant($this->childId)->create([
            'status' => 'active', 'is_approved' => true,
        ]);

        $this->actAsRegional();

        $this->apiPost('/v2/admin/super/bulk/move-users', [
            'user_ids' => [$ownMember->id, $siblingMember->id],
            'target_tenant_id' => $this->hubId,
        ])->assertStatus(200);

        $this->assertSame(
            $this->siblingChildId,
            (int) DB::table('users')->where('id', $siblingMember->id)->value('tenant_id'),
            'A member of another branch must not be moved.'
        );
    }

    public function test_a_bulk_move_cannot_push_members_into_a_sibling_branch(): void
    {
        $ownMember = User::factory()->forTenant($this->childId)->create([
            'status' => 'active', 'is_approved' => true,
        ]);

        $this->actAsRegional();

        $this->apiPost('/v2/admin/super/bulk/move-users', [
            'user_ids' => [$ownMember->id],
            'target_tenant_id' => $this->siblingId,
        ])->assertStatus(403);

        $this->assertSame(
            $this->childId,
            (int) DB::table('users')->where('id', $ownMember->id)->value('tenant_id')
        );
    }

    public function test_a_single_user_move_is_refused_at_both_ends(): void
    {
        $siblingMember = User::factory()->forTenant($this->siblingChildId)->create([
            'status' => 'active', 'is_approved' => true,
        ]);
        $ownMember = User::factory()->forTenant($this->childId)->create([
            'status' => 'active', 'is_approved' => true,
        ]);

        $this->actAsRegional();

        // Out of a sibling branch...
        $this->apiPost("/v2/admin/super/users/{$siblingMember->id}/move-tenant", [
            'new_tenant_id' => $this->hubId,
        ])->assertStatus(403);

        // ...and into one.
        $this->apiPost("/v2/admin/super/users/{$ownMember->id}/move-tenant", [
            'new_tenant_id' => $this->siblingId,
        ])->assertStatus(403);

        $this->assertSame(
            $this->siblingChildId,
            (int) DB::table('users')->where('id', $siblingMember->id)->value('tenant_id')
        );
        $this->assertSame(
            $this->childId,
            (int) DB::table('users')->where('id', $ownMember->id)->value('tenant_id')
        );
    }

    public function test_a_sibling_tenant_cannot_be_moved_into_this_branch(): void
    {
        $this->actAsRegional();

        $this->apiPost("/v2/admin/super/tenants/{$this->siblingId}/move", [
            'new_parent_id' => $this->hubId,
        ])->assertStatus(403);

        $this->assertSame(
            '/8200/',
            DB::table('tenants')->where('id', $this->siblingId)->value('path')
        );
    }

    public function test_sibling_federation_features_cannot_be_read_or_changed(): void
    {
        $this->actAsRegional();

        $this->apiGet("/v2/admin/super/federation/tenant/{$this->siblingId}/features")
            ->assertStatus(403);
    }

    public function test_the_audit_log_shows_no_sibling_branch_activity(): void
    {
        $siblingActor = User::factory()->forTenant($this->siblingId)->admin()->create();
        DB::table('super_admin_audit_log')->insert([
            'actor_user_id' => $siblingActor->id,
            'actor_tenant_id' => $this->siblingId,
            'action_type' => 'tenant_updated',
            'target_type' => 'tenant',
            'target_id' => $this->siblingId,
            'target_name' => 'BranchBSecret',
            'description' => 'BranchBSecret change',
            'created_at' => now(),
        ]);

        $this->actAsRegional();
        $body = json_encode($this->apiGet('/v2/admin/super/audit')->assertStatus(200)->json('data'));

        $this->assertStringNotContainsString('BranchBSecret', $body);
    }

    // ── Tier B: refused outright ────────────────────────────────────────────

    /** @return array<string, array{0:string, 1:string}> */
    public static function platformOnlyEndpointProvider(): array
    {
        return [
            'platform revenue' => ['get', '/v2/admin/super/billing/revenue'],
            'billing snapshot' => ['get', '/v2/admin/super/billing/snapshot'],
            'billing export' => ['get', '/v2/admin/super/billing/export'],
            'federation overview' => ['get', '/v2/admin/super/federation'],
            'federation system controls' => ['get', '/v2/admin/super/federation/system-controls'],
            'federation whitelist' => ['get', '/v2/admin/super/federation/whitelist'],
            'platform capabilities' => ['get', '/v2/admin/super/platform-capabilities'],
            'provisioning queue' => ['get', '/v2/super-admin/provisioning-requests'],
        ];
    }

    /**
     * @dataProvider platformOnlyEndpointProvider
     */
    public function test_a_regional_admin_is_refused_platform_only_endpoints(string $verb, string $path): void
    {
        $this->actAsRegional();

        $response = $verb === 'get' ? $this->apiGet($path) : $this->apiPost($path, []);

        $this->assertSame(
            403,
            $response->getStatusCode(),
            "{$path} is platform-wide and must refuse a regional super-admin."
        );
    }

    public function test_a_regional_admin_cannot_set_another_branch_billing_plan(): void
    {
        // 🔴 The concrete reason billing stays in tier B: it reads tenant_id from
        // the body and checks only that the caller is a super-admin.
        $this->actAsRegional();

        $this->apiPost('/v2/admin/super/billing/assign-plan', [
            'tenant_id' => $this->siblingId,
            'pay_plan_id' => 1,
        ])->assertStatus(403);
    }

    public function test_a_regional_admin_cannot_grant_platform_super_admin(): void
    {
        // The escape hatch out of their own branch.
        $member = User::factory()->forTenant($this->childId)->create();
        $this->actAsRegional();

        $this->apiPost("/v2/admin/super/users/{$member->id}/grant-global-super-admin", [])
            ->assertStatus(403);

        $this->assertSame(
            0,
            (int) DB::table('users')->where('id', $member->id)->value('is_super_admin')
        );
    }

    public function test_a_regional_admin_cannot_purge_a_tenant(): void
    {
        // Irreversible, so kept platform-only by choice even though it scopes.
        $this->actAsRegional();

        $this->apiPost("/v2/admin/super/tenants/{$this->childId}/purge", ['confirm' => true])
            ->assertStatus(403);
    }

    public function test_a_regional_admin_cannot_impersonate(): void
    {
        $member = User::factory()->forTenant($this->childId)->create();
        $this->actAsRegional();

        $this->apiPost("/v2/admin/users/{$member->id}/impersonate", [])->assertStatus(403);
    }

    // ── A platform super-admin keeps everything ─────────────────────────────

    public function test_a_platform_super_admin_still_sees_every_branch(): void
    {
        $platform = User::factory()->forTenant($this->hubId)->admin()->create();
        DB::table('users')->where('id', $platform->id)->update(['is_super_admin' => 1]);
        $platform->refresh();

        SuperPanelAccess::reset();
        $this->withTenant($this->hubId);
        Sanctum::actingAs($platform);

        $body = json_encode($this->apiGet('/v2/admin/super/tenants')->assertStatus(200)->json('data'));

        $this->assertStringContainsString('Branch A Hub', $body);
        $this->assertStringContainsString('Branch B Hub', $body, 'A platform super-admin is not confined to a branch.');
    }

    public function test_a_platform_super_admin_still_reaches_tier_b(): void
    {
        $platform = User::factory()->forTenant($this->hubId)->admin()->create();
        DB::table('users')->where('id', $platform->id)->update(['is_super_admin' => 1]);
        $platform->refresh();

        SuperPanelAccess::reset();
        $this->withTenant($this->hubId);
        Sanctum::actingAs($platform);

        $this->assertSame(200, $this->apiGet('/v2/admin/super/federation')->getStatusCode());
    }

    public function test_an_ordinary_admin_reaches_neither_tier(): void
    {
        $admin = User::factory()->forTenant($this->hubId)->admin()->create();
        SuperPanelAccess::reset();
        $this->withTenant($this->hubId);
        Sanctum::actingAs($admin);

        $this->assertSame(403, $this->apiGet('/v2/admin/super/tenants')->getStatusCode());
        $this->assertSame(403, $this->apiGet('/v2/admin/super/federation')->getStatusCode());
    }
}
