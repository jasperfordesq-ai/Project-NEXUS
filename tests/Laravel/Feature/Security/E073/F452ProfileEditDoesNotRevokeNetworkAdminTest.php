<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E073;

use App\Core\SuperPanelAccess;
use App\Core\TenantContext;
use App\Models\User;
use App\Support\Authorization\AdminTier;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-452 (E-073 G-1) — the F-399 / F-400 flag-clearing must fire on a DEMOTION,
 * not on every save.
 *
 * E-072 made the two user-edit routes clear is_tenant_super_admin / is_super_admin
 * / is_admin whenever the resulting role carries no admin authority. Both routes
 * computed "the resulting role" in a way that also fires when the operator never
 * asked for a role change:
 *
 *   AdminSuperController::userUpdate()   $role = $input['role'] ?? $user['role'];
 *       → for an account whose STORED role is 'member', the clear fired on EVERY
 *         edit, including one that only changed a phone number.
 *   AdminUsersController::update()       cleared whenever `role` was present in
 *       the body — and the super panel's form submits `role` on every save, so
 *       resubmitting the UNCHANGED role cleared the flags.
 *
 * `role = 'member'` plus is_tenant_super_admin = 1 is not an exotic state: it is
 * exactly what TenantHierarchyService::assignTenantSuperAdmin() writes (the flag
 * and no role), which is the super panel's own grant route. So a community could
 * lose its network administrator through an unrelated profile save, silently,
 * and the account could not restore itself.
 *
 * The fix requires the role to be explicitly submitted AND actually changed
 * before the flags are cleared. F-399 / F-400 must not regress: an explicit
 * demotion still clears every flag, on both routes — pinned by the controls.
 */
final class F452ProfileEditDoesNotRevokeNetworkAdminTest extends TestCase
{
    use DatabaseTransactions;

    private const HUB_TENANT_ID = 90731;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);
        $this->app['auth']->forgetGuards();
        Cache::flush();
        TenantContext::reset();
        SuperPanelAccess::reset();
        TenantContext::setById($this->testTenantId);
        $this->makeHubTenant();
    }

    /**
     * THE HARM (super panel) — an edit that never mentions `role` must not
     * touch the account's authority.
     */
    public function test_a_phone_number_edit_keeps_a_super_panel_network_admin(): void
    {
        $actor = $this->platformSuperAdmin();
        $target = $this->memberOfHub();

        Sanctum::actingAs($actor, ['*']);

        // The super panel's own grant route: the flag, and no role.
        $this->apiPost("/v2/admin/super/users/{$target->id}/grant-super-admin")->assertStatus(200);
        $granted = $this->row($target);
        self::assertSame(1, (int) $granted->is_tenant_super_admin, 'precondition: a network administrator');
        self::assertSame('member', (string) $granted->role, 'precondition: this grant route writes no role');

        // An entirely unrelated edit. No `role` key is sent at all.
        $edit = $this->apiPut("/v2/admin/super/users/{$target->id}", ['phone' => '+1 555 123 4567']);
        self::assertSame(200, $edit->getStatusCode(), 'the profile edit was accepted. ' . $edit->getContent());

        $after = $this->row($target);
        self::assertSame('+1 555 123 4567', (string) $after->phone, 'the edit the operator asked for did happen');
        self::assertSame(
            1,
            (int) $after->is_tenant_super_admin,
            'F-452: an edit that never mentioned the role must not revoke the network administrator'
        );
        self::assertTrue(AdminTier::allows((array) $after), 'F-452: admin-tier authority survives the edit');

        // The authority must be real after the edit, not only a column.
        $this->app['auth']->forgetGuards();
        SuperPanelAccess::reset();
        Sanctum::actingAs(User::withoutGlobalScopes()->find($target->id), ['*']);
        $panel = $this->hubGet('/v2/admin/super/dashboard');
        self::assertSame(
            200,
            $panel->getStatusCode(),
            'F-452: the account still reaches the super panel after an unrelated profile edit. ' . $panel->getContent()
        );
    }

    /**
     * THE HARM (community route) — the super panel's form submits `role` on
     * every save, so resubmitting the UNCHANGED role must not clear the flags.
     */
    public function test_resubmitting_an_unchanged_role_keeps_the_network_admin_flag(): void
    {
        $superAdmin = $this->platformSuperAdmin();
        $target = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => 1, 'role' => 'member',
        ]);
        DB::table('users')->where('id', $target->id)->update([
            'role' => 'member', 'is_tenant_super_admin' => 1, 'is_admin' => 0, 'is_super_admin' => 0, 'is_god' => 0,
        ]);
        self::assertTrue(AdminTier::allows((array) $this->row($target)), 'precondition: admin-tier authority');

        Sanctum::actingAs($superAdmin, ['*']);
        // Exactly what the panel sends when only the phone number was edited.
        $res = $this->apiPut("/v2/admin/users/{$target->id}", [
            'role' => 'member',
            'phone' => '+1 555 222 3333',
        ]);
        self::assertSame(200, $res->getStatusCode(), $res->getContent());

        $after = $this->row($target);
        self::assertSame('+1 555 222 3333', (string) $after->phone);
        self::assertSame(
            1,
            (int) $after->is_tenant_super_admin,
            'F-452: resubmitting the unchanged role must not clear the flag'
        );
        self::assertTrue(AdminTier::allows((array) $after), 'F-452: admin-tier authority survives');

        $this->app['auth']->forgetGuards();
        Sanctum::actingAs(User::withoutGlobalScopes()->find($target->id), ['*']);
        $listing = $this->apiGet('/v2/admin/users?page=1&per_page=1');
        self::assertSame(
            200,
            $listing->getStatusCode(),
            'F-452: the account still reads the administrator member list. ' . $listing->getContent()
        );
    }

    /**
     * F-399 / F-400 REGRESSION CONTROL (super panel) — an explicit demotion must
     * still strip every admin flag and every scrap of authority with it. The
     * harm case above differs only in whether the role was actually changed.
     */
    public function test_control_an_explicit_demotion_still_clears_the_flags_on_the_super_route(): void
    {
        $actor = $this->platformSuperAdmin();
        $target = $this->memberOfHub();
        DB::table('users')->where('id', $target->id)
            ->update(['role' => 'admin', 'is_tenant_super_admin' => 1, 'is_admin' => 1]);

        Sanctum::actingAs($actor, ['*']);
        $res = $this->apiPut("/v2/admin/super/users/{$target->id}", ['role' => 'member']);
        self::assertSame(200, $res->getStatusCode(), $res->getContent());

        $after = $this->row($target);
        self::assertSame('member', (string) $after->role);
        self::assertSame(0, (int) $after->is_tenant_super_admin, 'control: F-399 still holds — the flag is cleared');
        self::assertSame(0, (int) $after->is_admin, 'control: F-399 still holds — is_admin is cleared');
        self::assertFalse(AdminTier::allows((array) $after), 'control: the demotion removes all admin-tier authority');

        $this->app['auth']->forgetGuards();
        SuperPanelAccess::reset();
        Sanctum::actingAs(User::withoutGlobalScopes()->find($target->id), ['*']);
        $panel = $this->hubGet('/v2/admin/super/dashboard');
        self::assertContains(
            $panel->getStatusCode(),
            [401, 403],
            'control: the demoted account is refused the super panel. ' . $panel->getContent()
        );
    }

    /**
     * F-399 / F-400 REGRESSION CONTROL (community route) — the same explicit
     * demotion through the tenant-scoped route.
     */
    public function test_control_an_explicit_demotion_still_clears_the_flags_on_the_community_route(): void
    {
        $superAdmin = $this->platformSuperAdmin();
        $target = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
        DB::table('users')->where('id', $target->id)->update([
            'role' => 'admin', 'is_tenant_super_admin' => 1, 'is_admin' => 1, 'is_super_admin' => 0, 'is_god' => 0,
        ]);

        Sanctum::actingAs($superAdmin, ['*']);
        $res = $this->apiPut("/v2/admin/users/{$target->id}", ['role' => 'member']);
        self::assertSame(200, $res->getStatusCode(), $res->getContent());

        $after = $this->row($target);
        self::assertSame('member', (string) $after->role);
        self::assertSame(0, (int) $after->is_tenant_super_admin, 'control: F-399 still holds on this route too');
        self::assertSame(0, (int) $after->is_admin);
        self::assertFalse(AdminTier::allows((array) $after));

        $this->app['auth']->forgetGuards();
        Sanctum::actingAs(User::withoutGlobalScopes()->find($target->id), ['*']);
        $listing = $this->apiGet('/v2/admin/users?page=1&per_page=1');
        self::assertContains(
            $listing->getStatusCode(),
            [401, 403],
            'control: the demoted account is refused the administrator member list'
        );
    }

    /**
     * LEGITIMATE-ACCESS CONTROL — a `role = 'admin'` network administrator was
     * already unaffected by an unrelated edit, and must stay unaffected. This is
     * what makes the harm cases specific to the super panel's own grant state.
     */
    public function test_control_an_administrator_keeps_the_flag_through_the_same_edit(): void
    {
        $actor = $this->platformSuperAdmin();
        $target = $this->memberOfHub();
        DB::table('users')->where('id', $target->id)
            ->update(['role' => 'admin', 'is_tenant_super_admin' => 1]);

        Sanctum::actingAs($actor, ['*']);
        $res = $this->apiPut("/v2/admin/super/users/{$target->id}", ['phone' => '+1 555 999 0000']);
        self::assertSame(200, $res->getStatusCode(), $res->getContent());

        $after = $this->row($target);
        self::assertSame('+1 555 999 0000', (string) $after->phone);
        self::assertSame(1, (int) $after->is_tenant_super_admin, 'control: unchanged, as before the fix');
    }

    // ── helpers / fixtures ──────────────────────────────────────────────────

    /** A GET issued in the HUB community's own tenant context. */
    private function hubGet(string $uri): \Illuminate\Testing\TestResponse
    {
        return $this->getJson('/api' . $uri, [
            'X-Tenant-ID' => (string) self::HUB_TENANT_ID,
            'Accept' => 'application/json',
        ]);
    }

    private function row(User $u): object
    {
        return DB::table('users')->where('id', $u->id)
            ->first(['id', 'tenant_id', 'role', 'phone', 'is_admin', 'is_super_admin', 'is_tenant_super_admin', 'is_god']);
    }

    private function makeHubTenant(): void
    {
        DB::table('tenants')->updateOrInsert(
            ['id' => self::HUB_TENANT_ID],
            [
                'name' => 'E074D Hub Community',
                'slug' => 'e074d-hub',
                'domain' => null,
                'is_active' => 1,
                'depth' => 0,
                'path' => '/' . self::HUB_TENANT_ID . '/',
                'allows_subtenants' => 1,
                'max_depth' => 2,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );
    }

    private function memberOfHub(): User
    {
        $u = User::factory()->forTenant(self::HUB_TENANT_ID)->create([
            'status' => 'active', 'is_approved' => 1, 'role' => 'member',
        ]);
        DB::table('users')->where('id', $u->id)->update([
            'tenant_id' => self::HUB_TENANT_ID,
            'role' => 'member',
            'is_admin' => 0,
            'is_super_admin' => 0,
            'is_tenant_super_admin' => 0,
            'is_god' => 0,
        ]);

        return User::withoutGlobalScopes()->find($u->id);
    }

    private function platformSuperAdmin(): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
        DB::table('users')->where('id', $u->id)->update([
            'is_super_admin' => 1,
            'role' => 'admin',
        ]);

        return User::withoutGlobalScopes()->find($u->id);
    }
}
