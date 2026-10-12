<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services;

use App\Models\User;
use App\Services\EventConfigurationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Concerns\MakesNetworkAdminHierarchy;
use Tests\Laravel\TestCase;

/**
 * Regression cover for EventConfigurationService::canCreate().
 *
 * The actor's own identity lookup was scoped to the EVENT's tenant
 * (`WHERE id = ? AND tenant_id = ?`) and returned false on a miss BEFORE the
 * 'members' short-circuit. So every actor whose home tenant differed from the
 * tenant they were acting in was refused — platform admins, tenant super
 * admins (`is_tenant_super_admin`), and anyone administering a sub-tenant —
 * while the admin UI correctly showed "All active members". Observed on
 * production against tenant `partner-demo` (id 5, a sub-tenant of 4) by an
 * actor whose only account row lives on tenant 2.
 *
 * The rule this pins: auth is GLOBAL, resources are tenant-scoped. Never add
 * `AND tenant_id = ?` to a lookup of the acting user's own row.
 *
 * 🔴 Owner rule, 12 October 2026: "A tenant super admin can administer all
 * communities below it in the hierarchy, but not above it." The actor LOOKUP
 * stays global (so a platform owner or a parent's tenant super admin is found),
 * and an actor who is not a member of this community is refused under every
 * creation setting, 'members' included, UNLESS TenantAdminScope admits them:
 * the platform owner anywhere, a tenant super admin of this community or of any
 * community above it. (From 11 to 12 October only the platform owner was
 * admitted; the parent's tenant super admin cases below were refusals then.)
 *
 * These assert the service directly rather than POSTing /v2/events, because
 * Sanctum::actingAs() takes the guard branch of the Authenticate middleware,
 * whose own cross-tenant check would 403 first and mask the behaviour under
 * test. Production requests carry a bearer JWT and skip that branch entirely.
 */
final class EventConfigurationCanCreateTest extends TestCase
{
    use DatabaseTransactions;
    use MakesNetworkAdminHierarchy;

    private EventConfigurationService $service;

    /** Tenant the Events are created on. The actor's home tenant is 999. */
    private const ACTING_TENANT = 2;
    private const HOME_TENANT = 999;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = app(EventConfigurationService::class);
    }

    /** @param array<string,mixed> $settings */
    private function setCreationRole(string $role): void
    {
        $raw = DB::table('tenants')->where('id', self::ACTING_TENANT)->value('configuration');
        $configuration = is_string($raw) ? (json_decode($raw, true) ?: []) : (is_array($raw) ? $raw : []);
        $configuration['events'] = array_merge($configuration['events'] ?? [], ['creation_role' => $role]);
        DB::table('tenants')->where('id', self::ACTING_TENANT)->update([
            'configuration' => json_encode($configuration),
        ]);
    }

    private function crossTenantUser(array $overrides = []): User
    {
        return User::factory()->forTenant(self::HOME_TENANT)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));
    }

    /**
     * An actor whose account row lives on the tenant being acted on.
     *
     * Every test in this file used crossTenantUser(), so the restricted policies
     * had no positive coverage from a LOCAL admin at all — nothing here would have
     * noticed 'admins' refusing the community's own administrators.
     */
    private function localUser(array $overrides = []): User
    {
        return User::factory()->forTenant(self::ACTING_TENANT)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));
    }

    /** "All active members" means this community's members. */
    public function test_open_policy_admits_a_local_member(): void
    {
        $this->setCreationRole('members');
        $actor = $this->localUser();

        self::assertTrue($this->service->canCreate(self::ACTING_TENANT, (int) $actor->id));
    }

    /**
     * 🔴 Reversed 11 October 2026. This was
     * test_open_policy_admits_an_actor_whose_home_tenant_differs and asserted TRUE.
     *
     * Owner decision, 11 October 2026: "I don't want tenant admins to act outside
     * of the home community or tenant super admins, or normal tenant admins." Only
     * the platform owner keeps cross-community reach. The 'members' setting used
     * to short-circuit to true for ANY active account on the platform, which was
     * the door through which every actor below — including a tenant super admin
     * of the parent community — could still create events in a community that is
     * not theirs after TenantAdminScope stopped granting subtree authority.
     *
     * Defence in depth: Authenticate already refuses a non-platform actor whose
     * account row is on another community (403 tenant_mismatch), so no real
     * request loses anything. The service must not depend on that.
     */
    public function test_open_policy_refuses_a_member_of_another_community(): void
    {
        $this->setCreationRole('members');
        $actor = $this->crossTenantUser();

        self::assertFalse(
            $this->service->canCreate(self::ACTING_TENANT, (int) $actor->id),
            'A member of another community must not create events here, even when the policy is "members".',
        );
    }

    /**
     * The exact production shape of 578817aff: role='admin',
     * is_tenant_super_admin=1, is_super_admin=0, home tenant is the PARENT of the
     * tenant being acted on. Admitted: a tenant super admin administers every
     * community below it (owner rule, 12 October 2026). It was reversed to a
     * refusal on 11 October and restored on 12 October.
     */
    public function test_open_policy_admits_a_tenant_super_admin_of_the_parent_community(): void
    {
        $this->setCreationRole('members');
        $this->makeHomeTenantOversee(self::HOME_TENANT, self::ACTING_TENANT);
        $actor = $this->crossTenantUser([
            'role' => 'admin',
            'is_super_admin' => 0,
            'is_tenant_super_admin' => 1,
        ]);

        self::assertTrue($this->service->canCreate(self::ACTING_TENANT, (int) $actor->id));
    }

    /** A plain member of the parent community is not a member of this one. */
    public function test_open_policy_refuses_a_plain_member_of_the_parent_community(): void
    {
        $this->setCreationRole('members');
        $this->makeHomeTenantOversee(self::HOME_TENANT, self::ACTING_TENANT);
        $actor = $this->crossTenantUser(['role' => 'member']);

        self::assertFalse($this->service->canCreate(self::ACTING_TENANT, (int) $actor->id));
    }

    /** Nor is a plain admin of the parent: only the tenant super admin reaches down. */
    public function test_admins_only_policy_refuses_a_plain_admin_of_the_parent_community(): void
    {
        $this->setCreationRole('admins');
        $this->makeHomeTenantOversee(self::HOME_TENANT, self::ACTING_TENANT);
        $actor = $this->crossTenantUser([
            'role' => 'admin',
            'is_super_admin' => 0,
            'is_tenant_super_admin' => 0,
        ]);

        self::assertFalse($this->service->canCreate(self::ACTING_TENANT, (int) $actor->id));
    }

    /**
     * Upwards is refused: a tenant super admin of a community BELOW this one has
     * no authority here, under any setting.
     */
    public function test_a_tenant_super_admin_of_a_child_community_is_refused_upwards(): void
    {
        $this->makeHomeTenantOversee(self::ACTING_TENANT, self::HOME_TENANT);
        $actor = $this->crossTenantUser([
            'role' => 'admin',
            'is_super_admin' => 0,
            'is_tenant_super_admin' => 1,
        ]);

        foreach (['members', 'staff', 'admins'] as $role) {
            $this->setCreationRole($role);
            self::assertFalse(
                $this->service->canCreate(self::ACTING_TENANT, (int) $actor->id),
                "creation_role={$role}: a child community's tenant super admin must not create events in its parent.",
            );
        }
    }

    /** A tenant super admin of an unrelated community (no hierarchy link) is refused. */
    public function test_open_policy_refuses_a_tenant_super_admin_of_an_unrelated_community(): void
    {
        $this->setCreationRole('members');
        $actor = $this->crossTenantUser([
            'role' => 'admin',
            'is_super_admin' => 0,
            'is_tenant_super_admin' => 1,
        ]);

        self::assertFalse($this->service->canCreate(self::ACTING_TENANT, (int) $actor->id));
    }

    /** The platform owner still creates anywhere, wherever their account row sits. */
    public function test_open_policy_admits_a_platform_owner_from_elsewhere(): void
    {
        $this->setCreationRole('members');
        $actor = $this->crossTenantUser(['role' => 'admin', 'is_super_admin' => 1]);

        self::assertTrue($this->service->canCreate(self::ACTING_TENANT, (int) $actor->id));
    }

    /** Same answer when creation is restricted to administrators, or to staff. */
    public function test_restricted_policies_admit_a_tenant_super_admin_of_the_parent_community(): void
    {
        $this->makeHomeTenantOversee(self::HOME_TENANT, self::ACTING_TENANT);
        $actor = $this->crossTenantUser([
            'role' => 'admin',
            'is_super_admin' => 0,
            'is_tenant_super_admin' => 1,
        ]);

        foreach (['admins', 'staff'] as $role) {
            $this->setCreationRole($role);
            self::assertTrue(
                $this->service->canCreate(self::ACTING_TENANT, (int) $actor->id),
                "creation_role={$role}: the parent's tenant super admin administers this community.",
            );
        }
    }

    public function test_open_policy_still_refuses_a_suspended_actor(): void
    {
        $this->setCreationRole('members');
        $actor = $this->crossTenantUser(['status' => 'suspended']);

        self::assertFalse($this->service->canCreate(self::ACTING_TENANT, (int) $actor->id));
    }

    public function test_open_policy_still_refuses_a_soft_deleted_actor(): void
    {
        $this->setCreationRole('members');
        $actor = $this->crossTenantUser();
        DB::table('users')->where('id', $actor->id)->update(['deleted_at' => now()]);

        self::assertFalse($this->service->canCreate(self::ACTING_TENANT, (int) $actor->id));
    }

    public function test_open_policy_refuses_an_unknown_actor(): void
    {
        $this->setCreationRole('members');

        self::assertFalse($this->service->canCreate(self::ACTING_TENANT, 2147483600));
    }

    /** The fix must not widen the restricted options. */
    public function test_admins_only_policy_refuses_a_plain_member(): void
    {
        $this->setCreationRole('admins');
        $actor = $this->crossTenantUser(['role' => 'member']);

        self::assertFalse($this->service->canCreate(self::ACTING_TENANT, (int) $actor->id));
    }

    public function test_admins_only_policy_refuses_a_broker(): void
    {
        $this->setCreationRole('admins');
        $actor = $this->crossTenantUser(['role' => 'broker']);

        self::assertFalse($this->service->canCreate(self::ACTING_TENANT, (int) $actor->id));
    }

    /** The community's own administrators must keep working — the positive case. */
    public function test_admins_only_policy_admits_a_local_admin(): void
    {
        $this->setCreationRole('admins');
        $actor = $this->localUser(['role' => 'admin']);

        self::assertTrue($this->service->canCreate(self::ACTING_TENANT, (int) $actor->id));
    }

    /** A platform admin is platform-wide, wherever their account row sits. */
    public function test_admins_only_policy_admits_a_platform_admin_from_elsewhere(): void
    {
        $this->setCreationRole('admins');
        $actor = $this->crossTenantUser(['role' => 'admin', 'is_super_admin' => 1]);

        self::assertTrue($this->service->canCreate(self::ACTING_TENANT, (int) $actor->id));
    }

    /**
     * A plain admin of an UNRELATED community may not create events here.
     *
     * 🔴 This assertion was reversed, and the reversal is deliberate. It read
     * assertTrue — a bare role='admin' on tenant 999 admitted to tenant 2 — which
     * made "is an admin somewhere" sufficient to create events in a community that
     * had explicitly restricted creation to its own administrators. That is the
     * same cross-tenant escalation TenantAdminScope closed in EventPolicy, where a
     * tenant 999 admin held all nineteen abilities on a tenant 2 event.
     *
     * What the surrounding tests legitimately pin is unchanged and still passes:
     * the actor LOOKUP is global, so a cross-tenant actor is found rather than
     * missed before the 'members' short-circuit (that was the real bug), and
     * platform admins still reach this tenant. Only "any admin, any community" is
     * refused. (A tenant super admin of a community ABOVE this one does reach it -
     * owner rule, 12 October 2026 - and is pinned separately above.)
     */
    public function test_admins_only_policy_refuses_a_plain_admin_of_another_community(): void
    {
        $this->setCreationRole('admins');
        $actor = $this->crossTenantUser([
            'role' => 'admin',
            'is_super_admin' => 0,
            'is_tenant_super_admin' => 0,
        ]);

        self::assertFalse($this->service->canCreate(self::ACTING_TENANT, (int) $actor->id));
    }

    /**
     * The broker half of 'staff'. The broker is LOCAL: what this pins is
     * broker-yes / member-no, for which the actor's home tenant is incidental,
     * and a cross-tenant broker is covered separately below.
     */
    public function test_staff_policy_admits_a_local_broker_but_not_a_plain_member(): void
    {
        $this->setCreationRole('staff');

        $broker = $this->localUser(['role' => 'broker']);
        self::assertTrue($this->service->canCreate(self::ACTING_TENANT, (int) $broker->id));

        $member = $this->localUser(['role' => 'member']);
        self::assertFalse($this->service->canCreate(self::ACTING_TENANT, (int) $member->id));
    }

    /**
     * A broker of another community is not this community's staff.
     *
     * The admin half of this decision became tenant-scoped via TenantAdminScope,
     * but the broker half stayed a bare role-string comparison, so "is a broker
     * somewhere" satisfied a community that had restricted creation to its own
     * brokers and administrators. A broker is an operational role with no
     * hierarchy — unlike a tenant super admin it reaches no subtree, so this is a
     * plain same-community test.
     *
     * Defence in depth rather than a reachable API hole: Authenticate rejects a
     * cross-tenant actor with 403 tenant_mismatch unless they are a PLATFORM
     * admin, so this path is not reachable over HTTP by a cross-tenant broker.
     * It is fixed because the service must not depend on a caller it cannot see.
     */
    public function test_staff_policy_refuses_a_broker_of_another_community(): void
    {
        $this->setCreationRole('staff');
        $broker = $this->crossTenantUser(['role' => 'broker']);

        self::assertFalse($this->service->canCreate(self::ACTING_TENANT, (int) $broker->id));
    }

    /** A platform admin still satisfies 'staff', wherever their account row sits. */
    public function test_staff_policy_admits_a_platform_admin_from_elsewhere(): void
    {
        $this->setCreationRole('staff');
        $actor = $this->crossTenantUser(['role' => 'admin', 'is_super_admin' => 1]);

        self::assertTrue($this->service->canCreate(self::ACTING_TENANT, (int) $actor->id));
    }

    /**
     * AdminTier deliberately fails closed for operational roles even when a
     * stale admin flag remains on the row. 'staff' means "brokers and
     * administrators", so a coordinator is not admitted.
     */
    public function test_staff_policy_refuses_a_coordinator_with_a_stale_admin_flag(): void
    {
        $this->setCreationRole('staff');
        $actor = $this->crossTenantUser(['role' => 'coordinator', 'is_admin' => 1]);

        self::assertFalse($this->service->canCreate(self::ACTING_TENANT, (int) $actor->id));
    }
}
