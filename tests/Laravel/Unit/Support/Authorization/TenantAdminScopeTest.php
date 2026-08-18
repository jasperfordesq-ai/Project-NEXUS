<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Support\Authorization;

use App\Models\Tenant;
use App\Support\Authorization\TenantAdminScope;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Laravel\TestCase;

/**
 * The four admin tiers, and which tenants each one may act on.
 *
 * AdminTier answers "is this account an admin at all" and is deliberately
 * tenant-unaware. Authorising a tenant-scoped resource with AdminTier alone gave
 * one community's admin full authority over every other community's records —
 * measured as all nineteen event abilities, including exportPeople, manageFinance
 * and transferOwnership. These tests pin the tenant half of that decision.
 *
 * 🔴 The subtree cases are the ones most likely to be broken by a well-meaning
 * simplification. A network admin reaches DOWN its own branch only: not up to its
 * parent, and not sideways to a sibling. Collapsing that to "same tenant" locks
 * hub admins out of their own branches; collapsing it to "any admin" is the
 * escalation this class exists to stop.
 */
final class TenantAdminScopeTest extends TestCase
{
    use DatabaseTransactions;

    /**
     * Hub with two branches, built here rather than read from a fixture.
     *
     * The dev database happens to ship tenant 2 with branches 101/102, but
     * nexus_test does not and CI certainly does not — depending on that turned
     * every one of these tests into a skip, which reads as a pass. The hierarchy
     * is a precondition of what is being tested, so the test establishes it.
     */
    private int $hubId;

    private int $branchAId;

    private int $branchBId;

    protected function setUp(): void
    {
        parent::setUp();

        $hub = Tenant::factory()->create([
            'domain' => null,
            'parent_id' => null,
            'depth' => 0,
            'allows_subtenants' => true,
            'is_active' => true,
        ]);
        $this->hubId = (int) $hub->id;
        // The materialised path must contain the real id, so it is written after
        // insert rather than guessed before it.
        Tenant::whereKey($this->hubId)->update(['path' => "/{$this->hubId}/"]);

        $this->branchAId = $this->createBranch();
        $this->branchBId = $this->createBranch();
    }

    private function createBranch(): int
    {
        $branch = Tenant::factory()->create([
            'domain' => null,
            'parent_id' => $this->hubId,
            'depth' => 1,
            'allows_subtenants' => false,
            'is_active' => true,
        ]);
        $id = (int) $branch->id;
        Tenant::whereKey($id)->update(['path' => "/{$this->hubId}/{$id}/"]);

        return $id;
    }

    /** @param array<string,mixed> $overrides */
    private function actor(array $overrides): object
    {
        return (object) array_merge([
            'tenant_id' => 0,
            'role' => 'member',
            'is_admin' => 0,
            'is_super_admin' => 0,
            'is_tenant_super_admin' => 0,
            'is_god' => 0,
        ], $overrides);
    }

    // ---------------------------------------------------------------- tier 1
    // Platform: authority everywhere, wherever the account row lives.

    public function test_platform_super_admin_reaches_any_tenant(): void
    {
        $actor = $this->actor(['tenant_id' => 999, 'is_super_admin' => 1]);

        $this->assertTrue(TenantAdminScope::allows($actor, $this->hubId));
        $this->assertTrue(TenantAdminScope::allows($actor, $this->branchAId));
    }

    public function test_god_reaches_any_tenant(): void
    {
        $this->assertTrue(
            TenantAdminScope::allows($this->actor(['tenant_id' => 999, 'is_god' => 1]), $this->hubId)
        );
    }

    public function test_platform_role_strings_are_honoured_as_well_as_the_flags(): void
    {
        $this->assertTrue(
            TenantAdminScope::allows($this->actor(['tenant_id' => 999, 'role' => 'super_admin']), $this->hubId)
        );
        $this->assertTrue(
            TenantAdminScope::allows($this->actor(['tenant_id' => 999, 'role' => 'god']), $this->hubId)
        );
    }

    // ---------------------------------------------------------------- tier 2
    // Network: own tenant plus its subtree, and nothing else.

    public function test_network_admin_reaches_its_own_branches(): void
    {
        $hubNetworkAdmin = $this->actor(['tenant_id' => $this->hubId, 'is_tenant_super_admin' => 1]);

        $this->assertTrue(TenantAdminScope::allows($hubNetworkAdmin, $this->hubId));
        $this->assertTrue(TenantAdminScope::allows($hubNetworkAdmin, $this->branchAId));
        $this->assertTrue(TenantAdminScope::allows($hubNetworkAdmin, $this->branchBId));
    }

    public function test_network_admin_does_not_reach_upwards_to_its_parent(): void
    {
        $this->assertFalse(TenantAdminScope::allows(
            $this->actor(['tenant_id' => $this->branchAId, 'is_tenant_super_admin' => 1]),
            $this->hubId
        ));
    }

    public function test_network_admin_does_not_reach_sideways_to_a_sibling(): void
    {
        $this->assertFalse(TenantAdminScope::allows(
            $this->actor(['tenant_id' => $this->branchAId, 'is_tenant_super_admin' => 1]),
            $this->branchBId
        ));
    }

    // ---------------------------------------------------------------- tier 3
    // Plain community admin: own tenant ONLY. This is the escalation that was live.

    public function test_plain_tenant_admin_reaches_only_its_own_tenant(): void
    {
        foreach (['admin', 'tenant_admin'] as $role) {
            $actor = $this->actor(['tenant_id' => $this->hubId, 'role' => $role]);

            $this->assertTrue(
                TenantAdminScope::allows($actor, $this->hubId),
                "role={$role} must keep authority over its own community."
            );
            $this->assertFalse(
                TenantAdminScope::allows($actor, $this->branchAId),
                "role={$role} must NOT reach another community, even a sub-tenant."
            );
        }
    }

    public function test_legacy_is_admin_flag_reaches_only_its_own_tenant(): void
    {
        $actor = $this->actor(['tenant_id' => $this->hubId, 'is_admin' => 1]);

        $this->assertTrue(TenantAdminScope::allows($actor, $this->hubId));
        $this->assertFalse(TenantAdminScope::allows($actor, $this->branchAId));
    }

    // ---------------------------------------------------------------- tier 4
    // Everyone else, including operational roles carrying a stale admin flag.

    public function test_plain_member_holds_no_admin_authority_anywhere(): void
    {
        $actor = $this->actor(['tenant_id' => $this->hubId]);

        $this->assertFalse(TenantAdminScope::allows($actor, $this->hubId));
        $this->assertFalse(TenantAdminScope::allows($actor, $this->branchAId));
    }

    public function test_broker_and_coordinator_fail_closed_even_with_a_stale_admin_flag(): void
    {
        foreach (['broker', 'coordinator'] as $role) {
            $this->assertFalse(
                TenantAdminScope::allows(
                    $this->actor(['tenant_id' => $this->hubId, 'role' => $role, 'is_admin' => 1]),
                    $this->hubId
                ),
                "{$role} is an operational role and must not gain admin authority."
            );
        }
    }

    // ------------------------------------------------------------ fail closed

    public function test_a_select_that_omits_tenant_id_fails_closed(): void
    {
        // Callers pass partial DB rows. A missing tenant_id must never be read as
        // "matches", or a narrowed SELECT silently reopens the escalation.
        $this->assertFalse(
            TenantAdminScope::allows((object) ['role' => 'admin'], $this->hubId)
        );
    }

    public function test_missing_or_nonpositive_tenant_fails_closed(): void
    {
        $actor = $this->actor(['tenant_id' => $this->hubId, 'role' => 'admin']);

        $this->assertFalse(TenantAdminScope::allows($actor, 0));
        $this->assertFalse(TenantAdminScope::allows($actor, -1));
    }

    public function test_null_actor_fails_closed(): void
    {
        $this->assertFalse(TenantAdminScope::allows(null, $this->hubId));
    }

    public function test_unknown_target_tenant_fails_closed_for_a_network_admin(): void
    {
        // No path row to compare against; must not fall through to allow.
        $this->assertFalse(TenantAdminScope::allows(
            $this->actor(['tenant_id' => $this->hubId, 'is_tenant_super_admin' => 1]),
            2147483600
        ));
    }

    public function test_an_array_actor_is_accepted_like_an_object(): void
    {
        $this->assertTrue(TenantAdminScope::allows(
            ['tenant_id' => $this->hubId, 'role' => 'admin'],
            $this->hubId
        ));
        $this->assertFalse(TenantAdminScope::allows(
            ['tenant_id' => $this->hubId, 'role' => 'admin'],
            $this->branchAId
        ));
    }
}
