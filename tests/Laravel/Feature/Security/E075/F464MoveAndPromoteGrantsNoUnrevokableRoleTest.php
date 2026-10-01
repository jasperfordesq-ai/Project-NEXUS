<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E075;

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
 * F-464 (E-075 A-1) — the remaining two grant routes must not write a role the
 * revoke cannot undo.
 *
 * F-431 (E-074 `fdd8cf84b`) removed the `role = 'admin'` write from the network-
 * and platform-super-admin grants, because the matching revokes clear only the
 * boolean flag. Grant and revoke have to be exact inverses, or a "revoked"
 * account keeps full community-administrator authority through the role string,
 * which AdminTier::allows() accepts.
 *
 * That fix reached TWO of the FOUR routes that grant is_tenant_super_admin:
 *
 *   FIXED by F-431   AdminUsersController::setSuperAdmin()
 *   FIXED by F-431   AdminSuperController::userGrantGlobalSuperAdmin()
 *   F-464            AdminSuperController::userMoveAndPromote()
 *   F-464            AdminSuperController::bulkMoveUsers()
 *
 * These tests assert the CORRECT behaviour: after a grant through either of the
 * two remaining routes, a later revoke must leave the account with no
 * administrator authority at all. They fail while the defect exists.
 */
final class F464MoveAndPromoteGrantsNoUnrevokableRoleTest extends TestCase
{
    use DatabaseTransactions;

    private const HUB_A_ID = 90861;
    private const HUB_B_ID = 90862;

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
        $this->makeTenant(self::HUB_A_ID, 'e075-f464-hub-a', true);
        $this->makeTenant(self::HUB_B_ID, 'e075-f464-hub-b', true);
        SuperPanelAccess::reset();
    }

    /**
     * THE HARM — grant network-admin through "move and promote", then revoke it
     * through the route the panel offers for revoking it. The revoke must leave
     * nothing behind: no flag, no administrator role, no admin-tier authority,
     * and no access to community B's member list.
     */
    public function test_revoking_after_move_and_promote_leaves_no_administrator_authority(): void
    {
        $actor = $this->platformSuperAdmin($this->testTenantId);
        $target = $this->accountIn(self::HUB_A_ID, ['role' => 'member']);

        self::assertSame('member', (string) $this->row($target)->role, 'precondition: an ordinary member');

        Sanctum::actingAs($actor, ['*']);
        $promote = $this->apiPost("/v2/admin/super/users/{$target->id}/move-and-promote", [
            'target_tenant_id' => self::HUB_B_ID,
        ]);
        self::assertSame(200, $promote->getStatusCode(), 'the move-and-promote was accepted. ' . $promote->getContent());

        $granted = $this->row($target);
        self::assertSame(self::HUB_B_ID, (int) $granted->tenant_id, 'the account is now in community B');
        self::assertSame(1, (int) $granted->is_tenant_super_admin, 'the network flag was granted');
        self::assertSame(
            'member',
            (string) $granted->role,
            'the grant writes the FLAG ONLY — the role it used to write survived every revoke'
        );

        // Revoke through the route the panel uses, from community B.
        $revoker = $this->platformSuperAdmin(self::HUB_B_ID);
        $this->app['auth']->forgetGuards();
        SuperPanelAccess::reset();
        Sanctum::actingAs($revoker, ['*']);
        $revoke = $this->tenantPut(self::HUB_B_ID, "/v2/admin/users/{$target->id}/super-admin", ['grant' => false]);
        self::assertSame(200, $revoke->getStatusCode(), 'the revoke was accepted. ' . $revoke->getContent());

        $after = $this->row($target);
        self::assertSame(0, (int) $after->is_tenant_super_admin, 'the flag really was cleared');
        self::assertSame('member', (string) $after->role, 'and no administrator role is left behind');
        self::assertFalse(
            AdminTier::allows((array) $after),
            'the canonical admin predicate refuses the revoked account'
        );

        // The concrete outcome, not just the row: the revoked account must not
        // read community B's administrator member list.
        $this->app['auth']->forgetGuards();
        SuperPanelAccess::reset();
        Sanctum::actingAs(User::withoutGlobalScopes()->find($target->id), ['*']);
        $listing = $this->tenantGet(self::HUB_B_ID, '/v2/admin/users?page=1&limit=5');
        self::assertContains(
            $listing->getStatusCode(),
            [401, 403],
            'the revoked account is refused the administrator member list. ' . $listing->getContent()
        );
    }

    /**
     * THE HARM, SECOND ROUTE — the bulk mover's grant_super_admin option writes
     * the same pair, so the same residual role survived the same revoke.
     */
    public function test_revoking_after_bulk_move_with_grant_leaves_no_administrator_authority(): void
    {
        $actor = $this->platformSuperAdmin($this->testTenantId);
        $target = $this->accountIn(self::HUB_A_ID, ['role' => 'member']);

        Sanctum::actingAs($actor, ['*']);
        $bulk = $this->apiPost('/v2/admin/super/bulk/move-users', [
            'user_ids' => [(int) $target->id],
            'target_tenant_id' => self::HUB_B_ID,
            'grant_super_admin' => true,
        ]);
        self::assertSame(200, $bulk->getStatusCode(), 'the bulk move was accepted. ' . $bulk->getContent());

        $granted = $this->row($target);
        self::assertSame(self::HUB_B_ID, (int) $granted->tenant_id, 'the account moved');
        self::assertSame(1, (int) $granted->is_tenant_super_admin, 'the network flag was granted');
        self::assertSame('member', (string) $granted->role, 'the bulk grant writes the FLAG ONLY');

        $revoker = $this->platformSuperAdmin(self::HUB_B_ID);
        $this->app['auth']->forgetGuards();
        SuperPanelAccess::reset();
        Sanctum::actingAs($revoker, ['*']);
        $this->tenantPut(self::HUB_B_ID, "/v2/admin/users/{$target->id}/super-admin", ['grant' => false])
            ->assertStatus(200);

        $after = $this->row($target);
        self::assertSame(0, (int) $after->is_tenant_super_admin, 'the flag was cleared');
        self::assertSame('member', (string) $after->role, 'and no administrator role is left behind');
        self::assertFalse(AdminTier::allows((array) $after), 'no admin-tier authority survives');
    }

    /**
     * LEGITIMATE-ACCESS CONTROL — move-and-promote must keep working. A network
     * administrator who has NOT been revoked reads community B's administrator
     * member list, so nothing here proposes breaking the grant.
     */
    public function test_control_move_and_promote_still_confers_real_authority(): void
    {
        $actor = $this->platformSuperAdmin($this->testTenantId);
        $target = $this->accountIn(self::HUB_A_ID, ['role' => 'member']);

        Sanctum::actingAs($actor, ['*']);
        $this->apiPost("/v2/admin/super/users/{$target->id}/move-and-promote", [
            'target_tenant_id' => self::HUB_B_ID,
        ])->assertStatus(200);

        $granted = $this->row($target);
        self::assertSame(1, (int) $granted->is_tenant_super_admin, 'control: the grant really landed');
        self::assertTrue(AdminTier::allows((array) $granted), 'control: the flag alone is admin-tier authority');

        $this->app['auth']->forgetGuards();
        SuperPanelAccess::reset();
        Sanctum::actingAs(User::withoutGlobalScopes()->find($target->id), ['*']);
        $listing = $this->tenantGet(self::HUB_B_ID, '/v2/admin/users?page=1&limit=5');
        self::assertSame(
            200,
            $listing->getStatusCode(),
            'control: the promoted network administrator legitimately reads the list. ' . $listing->getContent()
        );
    }

    /**
     * LEGITIMATE-ACCESS CONTROL, SECOND ROUTE — the bulk grant must also keep
     * conferring real authority.
     */
    public function test_control_bulk_move_with_grant_still_confers_real_authority(): void
    {
        $actor = $this->platformSuperAdmin($this->testTenantId);
        $target = $this->accountIn(self::HUB_A_ID, ['role' => 'member']);

        Sanctum::actingAs($actor, ['*']);
        $this->apiPost('/v2/admin/super/bulk/move-users', [
            'user_ids' => [(int) $target->id],
            'target_tenant_id' => self::HUB_B_ID,
            'grant_super_admin' => true,
        ])->assertStatus(200);

        $granted = $this->row($target);
        self::assertSame(1, (int) $granted->is_tenant_super_admin, 'control: the bulk grant really landed');
        self::assertTrue(AdminTier::allows((array) $granted), 'control: the flag alone is admin-tier authority');

        $this->app['auth']->forgetGuards();
        SuperPanelAccess::reset();
        Sanctum::actingAs(User::withoutGlobalScopes()->find($target->id), ['*']);
        $listing = $this->tenantGet(self::HUB_B_ID, '/v2/admin/users?page=1&limit=5');
        self::assertSame(
            200,
            $listing->getStatusCode(),
            'control: the bulk-promoted network administrator legitimately reads the list. ' . $listing->getContent()
        );
    }

    /**
     * CONTROL — an ordinary member moved WITHOUT the grant gains nothing. The
     * fix must not hand authority to anyone who was not promoted.
     */
    public function test_control_a_plain_bulk_move_grants_no_authority(): void
    {
        $actor = $this->platformSuperAdmin($this->testTenantId);
        $target = $this->accountIn(self::HUB_A_ID, ['role' => 'member']);

        Sanctum::actingAs($actor, ['*']);
        $this->apiPost('/v2/admin/super/bulk/move-users', [
            'user_ids' => [(int) $target->id],
            'target_tenant_id' => self::HUB_B_ID,
            'grant_super_admin' => false,
        ])->assertStatus(200);

        $after = $this->row($target);
        self::assertSame(0, (int) $after->is_tenant_super_admin, 'control: no flag was granted');
        self::assertSame('member', (string) $after->role, 'control: and no role was granted');
        self::assertFalse(AdminTier::allows((array) $after), 'control: the moved member holds no authority');
    }

    // ── helpers / fixtures ──────────────────────────────────────────────────

    private function tenantGet(int $tenantId, string $uri): \Illuminate\Testing\TestResponse
    {
        return $this->getJson('/api' . $uri, [
            'X-Tenant-ID' => (string) $tenantId,
            'Accept' => 'application/json',
        ]);
    }

    /** @param array<string,mixed> $data */
    private function tenantPut(int $tenantId, string $uri, array $data = []): \Illuminate\Testing\TestResponse
    {
        return $this->putJson('/api' . $uri, $data, [
            'X-Tenant-ID' => (string) $tenantId,
            'Accept' => 'application/json',
        ]);
    }

    private function row(User $u): object
    {
        return DB::table('users')->where('id', $u->id)
            ->first(['id', 'tenant_id', 'role', 'is_admin', 'is_super_admin', 'is_tenant_super_admin', 'is_god']);
    }

    private function makeTenant(int $id, string $slug, bool $hub): void
    {
        DB::table('tenants')->updateOrInsert(
            ['id' => $id],
            [
                'name' => 'E075 F464 ' . $slug,
                'slug' => $slug,
                'domain' => null,
                'is_active' => 1,
                'depth' => 0,
                'path' => '/' . $id . '/',
                'allows_subtenants' => $hub ? 1 : 0,
                'max_depth' => $hub ? 2 : 0,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );
    }

    /** @param array<string,mixed> $flags */
    private function accountIn(int $tenantId, array $flags): User
    {
        $u = User::factory()->forTenant($tenantId)->create([
            'status' => 'active', 'is_approved' => 1, 'role' => 'member',
        ]);
        DB::table('users')->where('id', $u->id)->update(array_merge([
            'tenant_id' => $tenantId,
            'role' => 'member',
            'is_admin' => 0,
            'is_super_admin' => 0,
            'is_tenant_super_admin' => 0,
            'is_god' => 0,
        ], $flags));

        return User::withoutGlobalScopes()->find($u->id);
    }

    private function platformSuperAdmin(int $tenantId): User
    {
        $u = User::factory()->forTenant($tenantId)->admin()->create(['status' => 'active']);
        DB::table('users')->where('id', $u->id)->update([
            'tenant_id' => $tenantId,
            'is_super_admin' => 1,
            'is_god' => 1,
            'role' => 'admin',
        ]);

        return User::withoutGlobalScopes()->find($u->id);
    }
}
