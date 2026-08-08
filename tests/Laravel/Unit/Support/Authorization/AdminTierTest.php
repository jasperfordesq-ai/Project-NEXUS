<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Support\Authorization;

use App\Support\Authorization\AdminTier;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * AdminTier is the canonical backend predicate for admin-tier authority: it is
 * consulted by EnsureIsAdmin and by ~20 controllers and services. Until this
 * file existed it had no test of any kind, so nothing pinned the one rule that
 * is easy to "simplify" away by accident — broker and coordinator fail closed
 * even when a stale legacy admin flag is still set on the account row.
 *
 * Deliberately a plain PHPUnit test with no database and no application boot:
 * the predicate is pure, so the test must be incapable of skipping itself.
 */
final class AdminTierTest extends TestCase
{
    /** Baseline account row with every tier signal switched off. */
    private const DENIED = [
        'role' => 'member',
        'is_admin' => false,
        'is_super_admin' => false,
        'is_tenant_super_admin' => false,
        'is_god' => false,
    ];

    // ---------------------------------------------------------------- denials

    public function test_null_user_is_refused(): void
    {
        $this->assertFalse(AdminTier::allows(null));
    }

    public function test_plain_member_is_refused(): void
    {
        $this->assertFalse(AdminTier::allows(self::DENIED));
    }

    public function test_empty_account_row_is_refused(): void
    {
        // No role key and no flags at all must not read as authority.
        $this->assertFalse(AdminTier::allows([]));
    }

    public function test_unknown_role_is_refused(): void
    {
        $this->assertFalse(AdminTier::allows(['role' => 'volunteer'] + self::DENIED));
    }

    public function test_null_role_is_refused_and_does_not_error(): void
    {
        $this->assertFalse(AdminTier::allows(['role' => null] + self::DENIED));
    }

    // ------------------------------------------------- the fail-closed rule

    /**
     * The rule this class exists to enforce. A broker/coordinator is an
     * operational role with its own application, NOT a junior admin, and is
     * deliberately refused generic /v2/admin/* access.
     */
    #[DataProvider('operationalRoleProvider')]
    public function test_operational_role_is_refused(string $role): void
    {
        $this->assertFalse(AdminTier::allows(['role' => $role] + self::DENIED));
    }

    /**
     * The part a refactor is most likely to break: the operational-role check
     * runs BEFORE the legacy boolean flags, so a stale is_admin/is_super_admin
     * flag left on a broker's row cannot promote them. If this test fails,
     * brokers have just been granted the whole admin surface.
     */
    #[DataProvider('operationalRoleFlagProvider')]
    public function test_operational_role_is_refused_despite_stale_admin_flag(string $role, string $flag): void
    {
        $user = ['role' => $role] + [$flag => true] + self::DENIED;

        $this->assertFalse(
            AdminTier::allows($user),
            "{$role} must fail closed even with a stale {$flag} flag set",
        );
    }

    public function test_operational_role_is_refused_with_every_flag_set_at_once(): void
    {
        $this->assertFalse(AdminTier::allows([
            'role' => 'broker',
            'is_admin' => true,
            'is_super_admin' => true,
            'is_tenant_super_admin' => true,
            'is_god' => true,
        ]));
    }

    // ----------------------------------------------------------- allowances

    #[DataProvider('adminRoleProvider')]
    public function test_admin_role_is_allowed(string $role): void
    {
        $this->assertTrue(AdminTier::allows(['role' => $role] + self::DENIED));
    }

    #[DataProvider('adminFlagProvider')]
    public function test_admin_flag_alone_is_allowed(string $flag): void
    {
        // role stays 'member': the flag by itself must carry the decision,
        // because super_admin/god/tenant_admin are never written to users.role.
        $this->assertTrue(AdminTier::allows([$flag => true] + self::DENIED));
    }

    #[DataProvider('adminFlagProvider')]
    public function test_admin_flag_accepts_truthy_database_representations(string $flag): void
    {
        // MySQL tinyint(1) arrives as int 1 or string "1" depending on the
        // driver and on whether the row came back through a cast.
        foreach ([1, '1'] as $truthy) {
            $this->assertTrue(
                AdminTier::allows([$flag => $truthy] + self::DENIED),
                "{$flag} must be honoured when it arrives as " . var_export($truthy, true),
            );
        }
    }

    #[DataProvider('adminFlagProvider')]
    public function test_admin_flag_falsy_database_representations_are_refused(string $flag): void
    {
        foreach ([0, '0', '', null] as $falsy) {
            $this->assertFalse(
                AdminTier::allows([$flag => $falsy] + self::DENIED),
                "{$flag} must not grant access when it arrives as " . var_export($falsy, true),
            );
        }
    }

    // ------------------------------------------------------- input shapes

    public function test_object_and_array_users_agree(): void
    {
        // Callers pass both an Eloquent model (object) and a plain DB row
        // (array); data_get handles each, and the two must not diverge.
        foreach ([['role' => 'admin'] + self::DENIED, ['role' => 'broker', 'is_admin' => true] + self::DENIED] as $row) {
            $this->assertSame(
                AdminTier::allows($row),
                AdminTier::allows((object) $row),
                'array and object forms of the same row must agree',
            );
        }
    }

    public function test_object_user_is_allowed(): void
    {
        $this->assertTrue(AdminTier::allows((object) (['role' => 'admin'] + self::DENIED)));
    }

    public function test_object_broker_is_refused_despite_stale_flag(): void
    {
        $this->assertFalse(AdminTier::allows((object) ([
            'role' => 'broker',
            'is_admin' => true,
        ] + self::DENIED)));
    }

    // --------------------------------------------------- frozen membership

    /**
     * Pins the two role lists. Adding 'broker' to ROLES, or dropping it from
     * OPERATIONAL_ROLES, silently hands brokers the admin surface — this is the
     * cheapest place to catch that.
     */
    public function test_role_lists_are_frozen_and_disjoint(): void
    {
        $this->assertSame(['admin', 'tenant_admin', 'super_admin', 'god'], AdminTier::ROLES);
        $this->assertSame(['broker', 'coordinator'], AdminTier::OPERATIONAL_ROLES);
        $this->assertSame(
            [],
            array_intersect(AdminTier::ROLES, AdminTier::OPERATIONAL_ROLES),
            'a role can never be both admin-tier and operational',
        );
    }

    /** Every declared admin role really is allowed — the list cannot drift from the behaviour. */
    public function test_every_declared_admin_role_is_allowed(): void
    {
        foreach (AdminTier::ROLES as $role) {
            $this->assertTrue(AdminTier::allows(['role' => $role] + self::DENIED), "{$role} should be allowed");
        }
    }

    /** Every declared operational role really is refused. */
    public function test_every_declared_operational_role_is_refused(): void
    {
        foreach (AdminTier::OPERATIONAL_ROLES as $role) {
            $this->assertFalse(AdminTier::allows(['role' => $role] + self::DENIED), "{$role} should be refused");
        }
    }

    // ------------------------------------------------------------ providers

    /** @return iterable<string, array{string}> */
    public static function adminRoleProvider(): iterable
    {
        yield 'admin' => ['admin'];
        yield 'tenant_admin' => ['tenant_admin'];
        yield 'super_admin' => ['super_admin'];
        yield 'god' => ['god'];
    }

    /** @return iterable<string, array{string}> */
    public static function operationalRoleProvider(): iterable
    {
        yield 'broker' => ['broker'];
        yield 'coordinator' => ['coordinator'];
    }

    /** @return iterable<string, array{string}> */
    public static function adminFlagProvider(): iterable
    {
        yield 'is_admin' => ['is_admin'];
        yield 'is_super_admin' => ['is_super_admin'];
        yield 'is_tenant_super_admin' => ['is_tenant_super_admin'];
        yield 'is_god' => ['is_god'];
    }

    /** @return iterable<string, array{string, string}> */
    public static function operationalRoleFlagProvider(): iterable
    {
        foreach (['broker', 'coordinator'] as $role) {
            foreach (['is_admin', 'is_super_admin', 'is_tenant_super_admin', 'is_god'] as $flag) {
                yield "{$role} with {$flag}" => [$role, $flag];
            }
        }
    }
}
