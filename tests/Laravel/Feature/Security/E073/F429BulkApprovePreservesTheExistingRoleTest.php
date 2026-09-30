<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E073;

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
 * F-429 (E-073 A-2) — approving an account is not demoting it.
 *
 * `POST /v2/admin/users/bulk-approve` wrote `role = 'member'` unconditionally
 * (AdminUsersController::bulkApprove() via User::updateAdminFields()), while the
 * single-record `approve()` preserves the existing role. That had two effects:
 *
 *  - a pending broker or administrator was silently demoted to `member` by the
 *    act of approving them (observation O-111); and
 *  - because User::updateAdminFields() writes only `role` and `is_approved`, an
 *    account holding is_tenant_super_admin / is_super_admin / is_admin was left
 *    reading `member` in the panel while the flags kept its full authority —
 *    the F-399 / F-400 state, on a fourth route that fix never reached.
 *
 * Both disappear once the bulk route preserves the role the way `approve()`
 * does. The queue's legitimate purpose — admitting ordinary pending applicants
 * — is pinned by the control.
 */
final class F429BulkApprovePreservesTheExistingRoleTest extends TestCase
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

    /**
     * THE HARM — a pending community administrator is approved and loses the
     * administrator authority the community gave them, with no operator
     * intending it.
     */
    public function test_bulk_approve_does_not_demote_a_pending_community_administrator(): void
    {
        $actor = $this->platformSuperAdmin();
        $target = $this->unapproved(['role' => 'admin']);

        Sanctum::actingAs($actor, ['*']);
        $res = $this->apiPost('/v2/admin/users/bulk-approve', ['user_ids' => [(int) $target->id]]);
        self::assertSame(200, $res->getStatusCode(), 'the bulk approval was accepted. ' . $res->getContent());

        $row = $this->row($target);
        self::assertSame(1, (int) $row->is_approved, 'the account was approved, which is what the route is for');
        self::assertSame(
            'admin',
            (string) $row->role,
            'F-429: approving an account must not change its role'
        );

        $this->app['auth']->forgetGuards();
        Sanctum::actingAs(User::withoutGlobalScopes()->find($target->id), ['*']);
        $listing = $this->apiGet('/v2/admin/users?page=1&per_page=1');
        self::assertSame(
            200,
            $listing->getStatusCode(),
            'F-429: the approved administrator still administers the community. ' . $listing->getContent()
        );
    }

    /**
     * THE HARM — the record and the authority must agree. A pending network
     * administrator must not come out of the queue reading `member` while the
     * flag keeps full authority, which is the F-399 state.
     */
    public function test_bulk_approve_leaves_no_gap_between_the_recorded_role_and_the_real_authority(): void
    {
        $actor = $this->platformSuperAdmin();
        $target = $this->unapproved(['role' => 'admin', 'is_tenant_super_admin' => 1]);
        $victim = $this->member();

        Sanctum::actingAs($actor, ['*']);
        $this->apiPost('/v2/admin/users/bulk-approve', ['user_ids' => [(int) $target->id]])->assertStatus(200);

        $row = $this->row($target);
        self::assertSame(
            'admin',
            (string) $row->role,
            'F-429: the route must not write the account down to member'
        );
        self::assertSame(1, (int) $row->is_tenant_super_admin, 'the flag is untouched, as before');
        self::assertTrue(AdminTier::allows((array) $row), 'the account holds admin-tier authority');

        // The authority the flag carries is real, and the stored role now says so.
        $this->app['auth']->forgetGuards();
        Sanctum::actingAs(User::withoutGlobalScopes()->find($target->id), ['*']);
        $impersonate = $this->apiPost("/v2/admin/users/{$victim->id}/impersonate");
        self::assertSame(
            200,
            $impersonate->getStatusCode(),
            'the network administrator still impersonates, and the record no longer claims otherwise. '
                . $impersonate->getContent()
        );
    }

    /**
     * THE HARM (O-111) — the same defect for a broker, the role most likely to
     * sit in the pending queue.
     */
    public function test_bulk_approve_does_not_demote_a_pending_broker(): void
    {
        $actor = $this->platformSuperAdmin();
        $target = $this->unapproved(['role' => 'broker']);

        Sanctum::actingAs($actor, ['*']);
        $this->apiPost('/v2/admin/users/bulk-approve', ['user_ids' => [(int) $target->id]])->assertStatus(200);

        $row = $this->row($target);
        self::assertSame(1, (int) $row->is_approved, 'the broker was approved');
        self::assertSame(
            'broker',
            (string) $row->role,
            'F-429 / O-111: approving a pending broker must not turn them into a member'
        );
    }

    /**
     * LEGITIMATE-ACCESS CONTROL — the queue must keep doing its job: an ordinary
     * pending applicant is approved, activated, stays a member, and gains no
     * authority at all. The harm cases differ from this one only in the role the
     * account already held.
     */
    public function test_control_bulk_approve_still_admits_an_ordinary_pending_member(): void
    {
        $actor = $this->platformSuperAdmin();
        $pending = $this->unapproved(['role' => 'member']);

        Sanctum::actingAs($actor, ['*']);
        $this->apiPost('/v2/admin/users/bulk-approve', ['user_ids' => [(int) $pending->id]])
            ->assertStatus(200);

        $row = $this->row($pending);
        self::assertSame(1, (int) $row->is_approved, 'control: the ordinary applicant is approved');
        self::assertSame('active', (string) $row->status, 'control: and activated');
        self::assertSame('member', (string) $row->role, 'control: and is still a member');
        self::assertFalse(AdminTier::allows((array) $row), 'control: approval confers no authority');

        $this->app['auth']->forgetGuards();
        Sanctum::actingAs(User::withoutGlobalScopes()->find($pending->id), ['*']);
        $listing = $this->apiGet('/v2/admin/users?page=1&per_page=1');
        self::assertContains(
            $listing->getStatusCode(),
            [401, 403],
            'control: the approved member is refused the administrator member list'
        );
    }

    // ── helpers / fixtures ──────────────────────────────────────────────────

    private function row(User $u): object
    {
        return DB::table('users')->where('id', $u->id)->first(
            ['id', 'role', 'status', 'is_approved', 'is_admin', 'is_super_admin', 'is_tenant_super_admin', 'is_god']
        );
    }

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => 1, 'role' => 'member',
        ]);
    }

    /** @param array<string,mixed> $overrides */
    private function unapproved(array $overrides): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->create(['status' => 'pending']);
        DB::table('users')->where('id', $u->id)->update(array_merge([
            'role' => 'member',
            'is_approved' => 0,
            'is_admin' => 0,
            'is_super_admin' => 0,
            'is_tenant_super_admin' => 0,
            'is_god' => 0,
        ], $overrides));

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
