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
 * F-431 (E-073 A-4) — revoking network-admin or platform-super-admin must leave
 * the account with no more authority than it had before the grant.
 *
 * Administrator power is stored in TWO places at once: `users.role` and four
 * boolean flags. Both grant routes used to write BOTH, and both revoke routes
 * undid only the flag:
 *
 *   AdminUsersController::setSuperAdmin()
 *       grant  → is_tenant_super_admin = 1 AND role = 'admin'
 *       revoke → is_tenant_super_admin = 0                     (role kept)
 *
 *   AdminSuperController::userGrantGlobalSuperAdmin()
 *       grant  → is_super_admin = 1 AND role = CASE WHEN role='member' THEN 'admin' …
 *   AdminSuperController::userRevokeGlobalSuperAdmin()
 *       revoke → is_super_admin = 0                            (role kept)
 *
 * so an ordinary member promoted and then demoted was left `role = 'admin'`,
 * which AdminTier::allows() accepts — the "revoked" account kept full community
 * administrator authority while the panel, the button and the audit entry all
 * said the privilege had been removed.
 *
 * The fix removes the role write from the two grants, so grant and revoke are
 * exact inverses, matching TenantHierarchyService::assign/revokeTenantSuperAdmin()
 * which has always written the flag alone. A blanket `role = 'member'` on revoke
 * was deliberately NOT used: it would demote an account that was already an
 * administrator before the grant, which the controls below pin.
 *
 * Related: F-399 / F-400 (the same asymmetry in the other direction); O-113
 * (`is_god` is cleared by no route anywhere — deliberately out of scope).
 */
final class F431RevokeLeavesNoGrantedAdminRoleTest extends TestCase
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
        SuperPanelAccess::reset();
        TenantContext::setById($this->testTenantId);
    }

    /**
     * THE HARM (community tier) — grant network-admin to an ordinary member and
     * revoke it again. The account must end where it started: an ordinary
     * member with no administrator authority.
     */
    public function test_revoking_network_admin_leaves_an_ordinary_member_an_ordinary_member(): void
    {
        $superAdmin = $this->platformSuperAdmin();
        $member = $this->member();

        self::assertSame('member', (string) $this->row($member)->role, 'precondition: an ordinary member');
        self::assertFalse(AdminTier::allows((array) $this->row($member)), 'precondition: no admin authority');

        Sanctum::actingAs($superAdmin, ['*']);
        $this->apiPut("/v2/admin/users/{$member->id}/super-admin", ['grant' => true])->assertStatus(200);
        $this->apiPut("/v2/admin/users/{$member->id}/super-admin", ['grant' => false])->assertStatus(200);

        $revoked = $this->row($member);
        self::assertSame(0, (int) $revoked->is_tenant_super_admin, 'the flag was cleared');
        self::assertSame(
            'member',
            (string) $revoked->role,
            'F-431: the revoke must leave no administrator role behind'
        );
        self::assertFalse(
            AdminTier::allows((array) $revoked),
            'F-431: the canonical admin predicate must refuse the revoked account'
        );

        // The authority must be gone in practice, not only in the row.
        $this->app['auth']->forgetGuards();
        Sanctum::actingAs(User::withoutGlobalScopes()->find($member->id), ['*']);
        $listing = $this->apiGet('/v2/admin/users?page=1&per_page=1');
        self::assertContains(
            $listing->getStatusCode(),
            [401, 403],
            'F-431: the revoked account must be refused the administrator member list. ' . $listing->getContent()
        );
    }

    /**
     * THE HARM (platform tier) — the same asymmetry on the god-only global
     * grant/revoke pair.
     */
    public function test_revoking_global_super_admin_leaves_an_ordinary_member_an_ordinary_member(): void
    {
        $god = $this->god();
        $member = $this->member();

        Sanctum::actingAs($god, ['*']);
        $this->apiPost("/v2/admin/super/users/{$member->id}/grant-global-super-admin")->assertStatus(200);
        $this->apiPost("/v2/admin/super/users/{$member->id}/revoke-global-super-admin")->assertStatus(200);

        $revoked = $this->row($member);
        self::assertSame(0, (int) $revoked->is_super_admin, 'the flag was cleared');
        self::assertSame(
            'member',
            (string) $revoked->role,
            'F-431: the global revoke must leave no administrator role behind'
        );
        self::assertFalse(AdminTier::allows((array) $revoked), 'F-431: no admin-tier authority survives');

        $this->app['auth']->forgetGuards();
        SuperPanelAccess::reset();
        Sanctum::actingAs(User::withoutGlobalScopes()->find($member->id), ['*']);
        $listing = $this->apiGet('/v2/admin/users?page=1&per_page=1');
        self::assertContains(
            $listing->getStatusCode(),
            [401, 403],
            'F-431: the revoked account must be refused the administrator member list. ' . $listing->getContent()
        );
    }

    /**
     * LEGITIMATE-ACCESS CONTROL — the grant itself must still work. A member who
     * has been granted network-admin holds admin-tier authority and reaches the
     * administrator member list. Without this the fix would be indistinguishable
     * from breaking the grant.
     */
    public function test_control_the_grant_still_confers_real_administrator_authority(): void
    {
        $superAdmin = $this->platformSuperAdmin();
        $member = $this->member();

        Sanctum::actingAs($superAdmin, ['*']);
        $this->apiPut("/v2/admin/users/{$member->id}/super-admin", ['grant' => true])->assertStatus(200);

        $granted = $this->row($member);
        self::assertSame(1, (int) $granted->is_tenant_super_admin, 'control: the flag is set');
        self::assertTrue(AdminTier::allows((array) $granted), 'control: the grant confers admin-tier authority');

        $this->app['auth']->forgetGuards();
        Sanctum::actingAs(User::withoutGlobalScopes()->find($member->id), ['*']);
        $listing = $this->apiGet('/v2/admin/users?page=1&per_page=1');
        self::assertSame(
            200,
            $listing->getStatusCode(),
            'control: a granted network administrator reads the member list. ' . $listing->getContent()
        );
    }

    /**
     * LEGITIMATE-ACCESS CONTROL — an account that was ALREADY a community
     * administrator before the grant must still be one afterwards. This is the
     * case a blanket `role = 'member'` on revoke would have broken.
     */
    public function test_control_revoking_from_a_pre_existing_administrator_keeps_them_an_administrator(): void
    {
        $superAdmin = $this->platformSuperAdmin();
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
        DB::table('users')->where('id', $admin->id)->update([
            'role' => 'admin',
            'is_admin' => 0,
            'is_super_admin' => 0,
            'is_tenant_super_admin' => 0,
            'is_god' => 0,
        ]);

        Sanctum::actingAs($superAdmin, ['*']);
        $this->apiPut("/v2/admin/users/{$admin->id}/super-admin", ['grant' => true])->assertStatus(200);
        $this->apiPut("/v2/admin/users/{$admin->id}/super-admin", ['grant' => false])->assertStatus(200);

        $row = $this->row($admin);
        self::assertSame(0, (int) $row->is_tenant_super_admin, 'the network-admin flag is cleared');
        self::assertSame(
            'admin',
            (string) $row->role,
            'control: an account that was already an administrator stays one'
        );

        $this->app['auth']->forgetGuards();
        Sanctum::actingAs(User::withoutGlobalScopes()->find($admin->id), ['*']);
        $listing = $this->apiGet('/v2/admin/users?page=1&per_page=1');
        self::assertSame(
            200,
            $listing->getStatusCode(),
            'control: the pre-existing administrator still reads the member list. ' . $listing->getContent()
        );
    }

    // ── helpers / fixtures ──────────────────────────────────────────────────

    private function row(User $u): object
    {
        return DB::table('users')->where('id', $u->id)
            ->first(['id', 'role', 'is_admin', 'is_super_admin', 'is_tenant_super_admin', 'is_god']);
    }

    private function member(): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => 1, 'role' => 'member',
        ]);
        DB::table('users')->where('id', $u->id)->update([
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

    private function god(): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
        DB::table('users')->where('id', $u->id)->update([
            'is_super_admin' => 1,
            'is_god' => 1,
            'role' => 'admin',
        ]);

        return User::withoutGlobalScopes()->find($u->id);
    }
}
