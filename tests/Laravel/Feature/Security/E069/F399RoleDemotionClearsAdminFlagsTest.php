<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E069;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * E-069 F-399 / F-400 — a demotion through the ordinary admin edit route must
 * actually demote.
 *
 * The grant paths write BOTH a boolean flag and a role:
 * `PUT /v2/admin/users/{id}/super-admin` writes `is_tenant_super_admin = 1`
 * AND `role = 'admin'` (AdminUsersController::setSuperAdmin), and
 * `AdminSuperController::userGrantGlobalSuperAdmin` writes `is_super_admin = 1`
 * and promotes `role`. The ordinary edit route `PUT /v2/admin/users/{id}`
 * builds its UPDATE from a whitelist that carries `role` but no boolean flag,
 * so lowering `role` used to leave the flags behind.
 *
 * Every gate reads the raw flag — `AdminTier::allows()`,
 * `EnsureIsTenantSuperAdmin` (the impersonation gate), `App\Core\SuperPanelAccess`
 * and `AdminTier::securityRank()` — so the account kept community-wide
 * impersonation (F-399) and platform-panel reach (F-400) while the panel and
 * the audit log both showed an ordinary member.
 *
 * This test asserts the CORRECT behaviour: lowering `role` to a value that
 * carries no admin authority clears `is_tenant_super_admin`, `is_super_admin`
 * and the legacy `is_admin` flag, while leaving every other path untouched.
 *
 * `is_god` is deliberately NOT cleared by this route — see
 * test_is_god_is_deliberately_left_alone_by_the_role_route.
 */
final class F399RoleDemotionClearsAdminFlagsTest extends TestCase
{
    use DatabaseTransactions;

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
        TenantContext::setById($this->testTenantId);
    }

    // ── F-399: the community tier ───────────────────────────────────────────

    /**
     * F-399 — demoting a community network administrator to `member` clears the
     * network-admin flag, and the account loses impersonation with it.
     */
    public function test_demoting_a_network_admin_to_member_clears_the_network_admin_flag(): void
    {
        $platformSuperAdmin = $this->platformSuperAdmin();
        $networkAdmin = $this->networkAdmin();
        $victim = $this->member();

        Sanctum::actingAs($platformSuperAdmin, ['*']);
        $res = $this->apiPut("/v2/admin/users/{$networkAdmin->id}", ['role' => 'member']);
        self::assertSame(200, $res->getStatusCode(), 'the demotion was accepted. ' . $res->getContent());

        $row = DB::table('users')->where('id', $networkAdmin->id)
            ->first(['role', 'is_tenant_super_admin']);
        self::assertSame('member', (string) $row->role, 'the role really was changed');
        self::assertSame(
            0,
            (int) $row->is_tenant_super_admin,
            'F-399: the network-admin flag must be cleared by the demotion'
        );

        // And the power that flag carried is gone.
        $demoted = User::withoutGlobalScopes()->find($networkAdmin->id);
        $this->app['auth']->forgetGuards();
        Sanctum::actingAs($demoted, ['*']);
        $impersonate = $this->apiPost("/v2/admin/users/{$victim->id}/impersonate");
        self::assertContains(
            $impersonate->getStatusCode(),
            [401, 403],
            'F-399: the demoted account must no longer impersonate a member; got '
                . $impersonate->getStatusCode()
        );
    }

    /**
     * F-399 — the same demotion to `broker`. A broker is an operational role,
     * not a lesser admin, so the flag must go there too (it is the account
     * state behind E-069 A-3, where the member directory's own predicate ORs
     * the raw flags).
     */
    public function test_demoting_a_network_admin_to_broker_clears_the_network_admin_flag(): void
    {
        $platformSuperAdmin = $this->platformSuperAdmin();
        $networkAdmin = $this->networkAdmin();

        Sanctum::actingAs($platformSuperAdmin, ['*']);
        $res = $this->apiPut("/v2/admin/users/{$networkAdmin->id}", ['role' => 'broker']);
        self::assertSame(200, $res->getStatusCode(), 'the demotion was accepted. ' . $res->getContent());

        $row = DB::table('users')->where('id', $networkAdmin->id)
            ->first(['role', 'is_tenant_super_admin']);
        self::assertSame('broker', (string) $row->role);
        self::assertSame(
            0,
            (int) $row->is_tenant_super_admin,
            'F-399: a demotion to an operational role must clear the network-admin flag'
        );
    }

    // ── F-400: the platform tier ────────────────────────────────────────────

    /**
     * F-400 — demoting a PLATFORM super-admin to `member` clears
     * `is_super_admin`, and the account loses the cross-community panel.
     */
    public function test_demoting_a_platform_super_admin_to_member_clears_the_platform_flag(): void
    {
        $god = $this->god();
        $platformAdmin = $this->platformSuperAdmin();

        Sanctum::actingAs($god, ['*']);
        $res = $this->apiPut("/v2/admin/users/{$platformAdmin->id}", ['role' => 'member']);
        self::assertSame(200, $res->getStatusCode(), 'the demotion was accepted. ' . $res->getContent());

        $row = DB::table('users')->where('id', $platformAdmin->id)
            ->first(['role', 'is_super_admin']);
        self::assertSame('member', (string) $row->role, 'the role really was changed');
        self::assertSame(
            0,
            (int) $row->is_super_admin,
            'F-400: the platform super-admin flag must be cleared by the demotion'
        );

        $demoted = User::withoutGlobalScopes()->find($platformAdmin->id);
        $this->app['auth']->forgetGuards();
        Sanctum::actingAs($demoted, ['*']);
        $panel = $this->apiGet('/v2/admin/super/tenants');
        self::assertContains(
            $panel->getStatusCode(),
            [401, 403],
            'F-400: the demoted account must no longer reach the platform panel; got '
                . $panel->getStatusCode()
        );
    }

    /** F-399/F-400 — the deprecated `is_admin` column is an admission flag too. */
    public function test_demotion_clears_the_legacy_is_admin_flag(): void
    {
        $platformSuperAdmin = $this->platformSuperAdmin();

        $target = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
        DB::table('users')->where('id', $target->id)->update(['is_admin' => 1, 'role' => 'admin']);

        Sanctum::actingAs($platformSuperAdmin, ['*']);
        $this->apiPut("/v2/admin/users/{$target->id}", ['role' => 'member'])->assertStatus(200);

        self::assertSame(
            0,
            (int) DB::table('users')->where('id', $target->id)->value('is_admin'),
            'the legacy admin flag must be cleared by the demotion'
        );
    }

    // ── the fix must not over-reach ─────────────────────────────────────────

    /** An edit that does not change the role must leave the flags alone. */
    public function test_an_unrelated_profile_edit_does_not_clear_the_flags(): void
    {
        $platformSuperAdmin = $this->platformSuperAdmin();
        $networkAdmin = $this->networkAdmin();

        Sanctum::actingAs($platformSuperAdmin, ['*']);
        $this->apiPut("/v2/admin/users/{$networkAdmin->id}", ['phone' => '+1 555 123 4567'])
            ->assertStatus(200);

        $row = DB::table('users')->where('id', $networkAdmin->id)
            ->first(['role', 'is_tenant_super_admin']);
        self::assertSame('admin', (string) $row->role);
        self::assertSame(
            1,
            (int) $row->is_tenant_super_admin,
            'editing a phone number must not revoke network-admin authority'
        );
    }

    /** Setting the role to `admin` is not a demotion out of the admin tier. */
    public function test_setting_the_role_to_admin_does_not_clear_the_flags(): void
    {
        $god = $this->god();
        $platformAdmin = $this->platformSuperAdmin();

        Sanctum::actingAs($god, ['*']);
        $this->apiPut("/v2/admin/users/{$platformAdmin->id}", ['role' => 'admin'])
            ->assertStatus(200);

        $row = DB::table('users')->where('id', $platformAdmin->id)
            ->first(['role', 'is_super_admin']);
        self::assertSame('admin', (string) $row->role);
        self::assertSame(
            1,
            (int) $row->is_super_admin,
            'a role write that keeps the account in the admin tier must not clear the flag'
        );
    }

    /**
     * The rank guard must cover the new behaviour: a community admin (rank 2)
     * does not outrank a platform super-admin (rank 3), so it cannot use this
     * route to strip that account's flag.
     */
    public function test_a_lower_ranked_caller_cannot_strip_a_higher_ranked_accounts_flags(): void
    {
        $communityAdmin = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
        DB::table('users')->where('id', $communityAdmin->id)->update(['role' => 'admin']);
        $communityAdmin = User::withoutGlobalScopes()->find($communityAdmin->id);

        $platformAdmin = $this->platformSuperAdmin();

        Sanctum::actingAs($communityAdmin, ['*']);
        $res = $this->apiPut("/v2/admin/users/{$platformAdmin->id}", ['role' => 'member']);
        self::assertSame(
            403,
            $res->getStatusCode(),
            'the rank guard must refuse a community admin acting on a platform super-admin; got '
                . $res->getStatusCode()
        );

        self::assertSame(
            1,
            (int) DB::table('users')->where('id', $platformAdmin->id)->value('is_super_admin'),
            'the refused call must not have cleared the flag'
        );
    }

    /**
     * `is_god` is deliberately left alone by this route. No route anywhere
     * clears it (E-069 O-113), this route refuses `role = 'god'` so it could
     * not restore it, and `securityRank()` ranks a god at 4 regardless of role.
     * Revoking god needs its own route and an owner decision — this test pins
     * the decision so a future change to it is visible rather than silent.
     */
    public function test_is_god_is_deliberately_left_alone_by_the_role_route(): void
    {
        $actingGod = $this->god();
        $targetGod = $this->god();

        Sanctum::actingAs($actingGod, ['*']);
        $this->apiPut("/v2/admin/users/{$targetGod->id}", ['role' => 'member'])
            ->assertStatus(200);

        $row = DB::table('users')->where('id', $targetGod->id)
            ->first(['role', 'is_god', 'is_super_admin']);
        self::assertSame('member', (string) $row->role);
        self::assertSame(
            1,
            (int) $row->is_god,
            'is_god is deliberately NOT cleared by the role route (O-113)'
        );
        self::assertSame(
            0,
            (int) $row->is_super_admin,
            'the platform flag is still cleared even on a god account'
        );
    }

    // ── the same defect on the super panel's own edit route ─────────────────

    /**
     * F-399/F-400 on the sibling route. `PUT /v2/admin/super/users/{id}`
     * (AdminSuperController::userUpdate) writes six columns and no flag — and it
     * is the route the super-admin panel's own user form actually calls
     * (react-frontend/src/admin/modules/super/SuperUserForm.tsx →
     * adminSuper.updateUser). Fixing only the tenant-admin route would leave the
     * defect live on the surface an operator is most likely to use.
     */
    public function test_the_super_panel_edit_route_also_clears_the_platform_flag(): void
    {
        $god = $this->god();
        $platformAdmin = $this->platformSuperAdmin();

        Sanctum::actingAs($god, ['*']);
        $res = $this->apiPut("/v2/admin/super/users/{$platformAdmin->id}", [
            'first_name' => $platformAdmin->first_name,
            'email' => $platformAdmin->email,
            'role' => 'member',
        ]);
        self::assertSame(200, $res->getStatusCode(), $res->getContent());

        $row = DB::table('users')->where('id', $platformAdmin->id)
            ->first(['role', 'is_super_admin']);
        self::assertSame('member', (string) $row->role);
        self::assertSame(
            0,
            (int) $row->is_super_admin,
            'F-400: the super-panel edit route must clear the platform flag too'
        );
    }

    /** The same, at the community tier. */
    public function test_the_super_panel_edit_route_also_clears_the_network_admin_flag(): void
    {
        $god = $this->god();
        $networkAdmin = $this->networkAdmin();

        Sanctum::actingAs($god, ['*']);
        $res = $this->apiPut("/v2/admin/super/users/{$networkAdmin->id}", [
            'first_name' => $networkAdmin->first_name,
            'email' => $networkAdmin->email,
            'role' => 'member',
        ]);
        self::assertSame(200, $res->getStatusCode(), $res->getContent());

        self::assertSame(
            0,
            (int) DB::table('users')->where('id', $networkAdmin->id)->value('is_tenant_super_admin'),
            'F-399: the super-panel edit route must clear the network-admin flag too'
        );
    }

    /** The super-panel route must not over-reach either. */
    public function test_the_super_panel_edit_route_leaves_flags_alone_on_an_unrelated_edit(): void
    {
        $god = $this->god();
        $networkAdmin = $this->networkAdmin();

        Sanctum::actingAs($god, ['*']);
        $this->apiPut("/v2/admin/super/users/{$networkAdmin->id}", [
            'first_name' => $networkAdmin->first_name,
            'email' => $networkAdmin->email,
            'phone' => '+1 555 123 4567',
        ])->assertStatus(200);

        $row = DB::table('users')->where('id', $networkAdmin->id)
            ->first(['role', 'is_tenant_super_admin']);
        self::assertSame('admin', (string) $row->role, 'the role is unchanged');
        self::assertSame(
            1,
            (int) $row->is_tenant_super_admin,
            'editing a phone number through the super panel must not revoke authority'
        );
    }

    // ── controls: the dedicated toggles keep working exactly as before ──────

    /** CONTROL — `PUT /v2/admin/users/{id}/super-admin` still grants. */
    public function test_control_the_dedicated_toggle_still_grants_the_network_admin_flag(): void
    {
        $platformSuperAdmin = $this->platformSuperAdmin();
        $target = $this->member();

        Sanctum::actingAs($platformSuperAdmin, ['*']);
        $this->apiPut("/v2/admin/users/{$target->id}/super-admin", ['grant' => true])
            ->assertStatus(200);

        $row = DB::table('users')->where('id', $target->id)->first(['role', 'is_tenant_super_admin']);
        self::assertSame(1, (int) $row->is_tenant_super_admin);
        self::assertSame('admin', (string) $row->role, 'the grant still promotes the role');
    }

    /** CONTROL — `PUT /v2/admin/users/{id}/super-admin` still revokes. */
    public function test_control_the_dedicated_toggle_still_revokes_the_network_admin_flag(): void
    {
        $platformSuperAdmin = $this->platformSuperAdmin();
        $networkAdmin = $this->networkAdmin();

        Sanctum::actingAs($platformSuperAdmin, ['*']);
        $this->apiPut("/v2/admin/users/{$networkAdmin->id}/super-admin", ['grant' => false])
            ->assertStatus(200);

        $row = DB::table('users')->where('id', $networkAdmin->id)->first(['role', 'is_tenant_super_admin']);
        self::assertSame(0, (int) $row->is_tenant_super_admin);
        self::assertSame(
            'admin',
            (string) $row->role,
            'the dedicated toggle still leaves the role alone — unchanged behaviour'
        );
    }

    /** CONTROL — `revoke-global-super-admin` still clears the platform flag. */
    public function test_control_the_dedicated_global_revoke_route_still_works(): void
    {
        $god = $this->god();
        $platformAdmin = $this->platformSuperAdmin();

        Sanctum::actingAs($god, ['*']);
        $res = $this->apiPost("/v2/admin/super/users/{$platformAdmin->id}/revoke-global-super-admin");
        self::assertSame(200, $res->getStatusCode(), $res->getContent());

        self::assertSame(
            0,
            (int) DB::table('users')->where('id', $platformAdmin->id)->value('is_super_admin')
        );
    }

    /** CONTROL — an ordinary member never reaches either surface. */
    public function test_control_an_ordinary_member_is_refused_both_surfaces(): void
    {
        $victim = $this->member();

        Sanctum::actingAs($this->member(), ['*']);
        $this->apiPost("/v2/admin/users/{$victim->id}/impersonate")->assertStatus(403);

        $this->app['auth']->forgetGuards();
        Sanctum::actingAs($this->member(), ['*']);
        self::assertContains($this->apiGet('/v2/admin/super/tenants')->getStatusCode(), [401, 403]);
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => 1,
        ]);
    }

    /** A community network administrator, exactly as the grant route writes one. */
    private function networkAdmin(): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
        DB::table('users')->where('id', $u->id)->update([
            'is_tenant_super_admin' => 1,
            'role' => 'admin',
        ]);

        return User::withoutGlobalScopes()->find($u->id);
    }

    /** A platform super-admin, as the grant route writes one (flag + role='admin'). */
    private function platformSuperAdmin(): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
        DB::table('users')->where('id', $u->id)->update([
            'is_super_admin' => 1,
            'role' => 'admin',
        ]);

        return User::withoutGlobalScopes()->find($u->id);
    }

    private function god(): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
        DB::table('users')->where('id', $u->id)->update([
            'is_god' => 1,
            'is_super_admin' => 1,
            'role' => 'admin',
        ]);

        return User::withoutGlobalScopes()->find($u->id);
    }
}
