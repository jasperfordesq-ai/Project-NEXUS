<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Authorization;

/**
 * Canonical backend predicate for tenant/platform admin-tier authority.
 *
 * Broker and coordinator are operational roles. They fail closed even when a
 * stale legacy admin flag remains set on the account row.
 */
final class AdminTier
{
    /** @var list<string> */
    public const ROLES = ['admin', 'tenant_admin', 'super_admin', 'god'];

    /** @var list<string> */
    public const OPERATIONAL_ROLES = ['broker', 'coordinator'];

    /** @param object|array<string,mixed>|null $user */
    public static function allows(object|array|null $user): bool
    {
        if ($user === null) {
            return false;
        }

        $role = (string) data_get($user, 'role', '');
        if (in_array($role, self::OPERATIONAL_ROLES, true)) {
            return false;
        }

        return in_array($role, self::ROLES, true)
            || (bool) data_get($user, 'is_admin', false)
            || (bool) data_get($user, 'is_super_admin', false)
            || (bool) data_get($user, 'is_tenant_super_admin', false)
            || (bool) data_get($user, 'is_god', false);
    }

    /**
     * Rank used when one operator acts on another person's account
     * (security resets, messaging restrictions): god 4, platform super-admin 3,
     * tenant admin / tenant super-admin 2, broker / coordinator 1, member 0.
     *
     * @param object|array<string,mixed> $user
     */
    public static function securityRank(object|array $user): int
    {
        $role = (string) (data_get($user, 'role') ?? 'member');
        if ($role === 'god' || !empty(data_get($user, 'is_god'))) {
            return 4;
        }
        if ($role === 'super_admin' || !empty(data_get($user, 'is_super_admin'))) {
            return 3;
        }
        if (
            in_array($role, ['admin', 'tenant_admin'], true)
            || !empty(data_get($user, 'is_admin'))
            || !empty(data_get($user, 'is_tenant_super_admin'))
        ) {
            return 2;
        }
        // Brokers/coordinators outrank ordinary members but never each other
        // or any admin — callers require a strictly higher rank.
        if (in_array($role, self::OPERATIONAL_ROLES, true)) {
            return 1;
        }

        return 0;
    }

    /**
     * True when $actor strictly outranks $target (god may act on anyone).
     *
     * @param object|array<string,mixed> $actor
     * @param object|array<string,mixed> $target
     */
    public static function outranks(object|array $actor, object|array $target): bool
    {
        $actorRank = self::securityRank($actor);
        if ($actorRank >= 4) {
            return true;
        }

        return $actorRank > self::securityRank($target);
    }
}
