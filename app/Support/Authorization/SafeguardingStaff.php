<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Support\Authorization;

use Illuminate\Contracts\Database\Query\Builder;

/**
 * Who in a community receives safeguarding and broker-work alerts.
 *
 * Everyone who can open the Broker Panel: operational roles (broker,
 * coordinator) and every admin tier, whether that tier is expressed as a
 * users.role string or — as the API does for tenant_admin, super_admin and
 * god — as a boolean flag on a member-role row.
 *
 * F-221: fourteen fan-outs hard-coded role IN ('admin','tenant_admin',
 * 'broker','super_admin'), so coordinators and flag-only admins received
 * none of the safeguarding alerts the Broker Panel shows them. Use this in
 * every staff alert query instead of a role list.
 *
 * This is a RECIPIENT rule for alerts only. It is not an authorisation
 * predicate — use AdminTier / the route middleware for that.
 */
final class SafeguardingStaff
{
    public const ROLES = ['admin', 'tenant_admin', 'broker', 'coordinator', 'super_admin', 'god'];

    private const FLAGS = ['is_admin', 'is_tenant_super_admin', 'is_super_admin', 'is_god'];

    /**
     * Constrain a users query (optionally aliased) to safeguarding staff.
     * The caller still scopes by tenant_id and status.
     */
    public static function scope(Builder $query, string $alias = ''): Builder
    {
        $col = $alias !== '' ? $alias . '.' : '';

        return $query->where(function ($q) use ($col): void {
            $q->whereIn($col . 'role', self::ROLES);
            foreach (self::FLAGS as $flag) {
                $q->orWhere($col . $flag, 1);
            }
        });
    }

    /**
     * The same rule as a raw SQL condition for DB::select call sites.
     * Contains no bindings; every value is a constant defined above.
     */
    public static function sqlCondition(string $alias = ''): string
    {
        $col = $alias !== '' ? $alias . '.' : '';
        $roles = implode(', ', array_map(static fn (string $r): string => "'{$r}'", self::ROLES));
        $flags = implode(' OR ', array_map(static fn (string $f): string => "{$col}{$f} = 1", self::FLAGS));

        return "({$col}role IN ({$roles}) OR {$flags})";
    }
}
