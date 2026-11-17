<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Authorization;

use App\Models\User;
use App\Support\Authorization\PlatformTeam;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * The platform team is `is_god` AND super admin — both, the owner's recorded
 * definition (AGENTS.md "Authorisation"). Each leg alone must be refused, and
 * the role string `god` is never the first leg: the API never writes it, and
 * `requireGod()` has always read the column only.
 */
final class PlatformTeamTest extends TestCase
{
    use DatabaseTransactions;

    private function userId(array $attributes): int
    {
        return (int) User::factory()->forTenant($this->testTenantId)->create($attributes)->id;
    }

    public function test_is_god_alone_is_not_the_platform_team(): void
    {
        $this->assertFalse(PlatformTeam::includes($this->userId(['is_god' => true])));
    }

    public function test_a_global_super_admin_alone_is_not_the_platform_team(): void
    {
        $this->assertFalse(PlatformTeam::includes(
            $this->userId(['is_super_admin' => true, 'role' => 'super_admin'])
        ));
    }

    public function test_the_role_string_god_without_the_flag_is_not_the_platform_team(): void
    {
        $this->assertFalse(PlatformTeam::includes(
            $this->userId(['role' => 'god', 'is_super_admin' => true])
        ));
    }

    public function test_a_tenant_super_admin_with_is_god_is_not_the_platform_team(): void
    {
        $this->assertFalse(PlatformTeam::includes(
            $this->userId(['is_god' => true, 'is_tenant_super_admin' => true])
        ));
    }

    public function test_is_god_with_the_super_admin_flag_is_the_platform_team(): void
    {
        $this->assertTrue(PlatformTeam::includes(
            $this->userId(['is_god' => true, 'is_super_admin' => true])
        ));
    }

    public function test_is_god_with_the_super_admin_role_is_the_platform_team(): void
    {
        $this->assertTrue(PlatformTeam::includes(
            $this->userId(['is_god' => true, 'role' => 'super_admin'])
        ));
    }

    public function test_an_unknown_account_is_not_the_platform_team(): void
    {
        $this->assertFalse(PlatformTeam::includes(0));
        $this->assertFalse(PlatformTeam::includes(PHP_INT_MAX));
    }

    public function test_a_flag_removed_in_the_database_is_seen_at_once(): void
    {
        // The database refuses to demote the last platform team member
        // (trg_users_last_platform_team_*), and a fresh test database may hold
        // no other one. A second member keeps this test about cache-free reads.
        $this->userId(['is_god' => true, 'is_super_admin' => true]);
        $id = $this->userId(['is_god' => true, 'is_super_admin' => true]);
        $this->assertTrue(PlatformTeam::includes($id));

        DB::table('users')->where('id', $id)->update(['is_god' => 0]);

        $this->assertFalse(PlatformTeam::includes($id));
    }
}
