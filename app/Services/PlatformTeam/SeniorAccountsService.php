<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\PlatformTeam;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Platform team panel → Senior accounts.
 *
 * Every account that can administer more than one community: the platform
 * team, global super admins and tenant super admins, with when each last
 * signed in and whether it has a second sign-in step.
 *
 * 🔴 Read-only. Nothing here, and no web request anywhere, grants or removes
 * platform team membership (`users.is_god` is set in the database). The way
 * to the top tier is deliberately not a button.
 *
 * 🔴 Cross-community on purpose: no `tenant_id` filter, because the question
 * is "who holds senior access anywhere on this installation". Correct only
 * because nothing below the platform team can call it.
 *
 * Levels, highest first. They follow the access definitions exactly
 * (App\Support\Authorization\PlatformTeam; docs/ROLES-AND-PERMISSIONS.md):
 *
 *   platform_team       is_god AND (is_super_admin OR role 'super_admin')
 *   global_super_admin  is_super_admin OR role 'super_admin', without is_god
 *   tenant_super_admin  is_tenant_super_admin
 *   platform_flag_only  is_god with none of the above: NOT on the platform
 *                       team, listed because a half-set flag is worth seeing
 *
 * A row is `incomplete_platform_team` when it has `is_god` without super
 * admin, whatever its level.
 */
final class SeniorAccountsService
{
    /** A ceiling, not a page size: senior accounts number in the tens. */
    public const LIMIT = 500;

    private const LEVEL_ORDER = [
        'platform_team' => 0,
        'global_super_admin' => 1,
        'tenant_super_admin' => 2,
        'platform_flag_only' => 3,
    ];

    /**
     * @return array{
     *   total: int,
     *   truncated: bool,
     *   counts: array<string, int>,
     *   accounts: array<int, array<string, mixed>>
     * }
     */
    public function list(): array
    {
        $rows = DB::table('users as u')
            ->leftJoin('tenants as t', 't.id', '=', 'u.tenant_id')
            ->where(function ($q): void {
                $q->where('u.is_god', 1)
                    ->orWhere('u.is_super_admin', 1)
                    ->orWhere('u.role', 'super_admin')
                    ->orWhere('u.is_tenant_super_admin', 1);
            })
            // A manager's stand-in in a community below never signs in and is
            // not an account anyone holds.
            ->where('u.status', '!=', 'delegate')
            ->whereNull('u.deleted_at')
            ->orderBy('u.id')
            ->limit(self::LIMIT + 1)
            ->get([
                'u.id', 'u.name', 'u.first_name', 'u.last_name', 'u.email', 'u.role', 'u.status',
                'u.is_god', 'u.is_super_admin', 'u.is_tenant_super_admin',
                'u.totp_enabled', 'u.last_login_at', 'u.tenant_id', 't.name as tenant_name',
            ]);

        $truncated = $rows->count() > self::LIMIT;
        $rows = $rows->take(self::LIMIT);

        $withPasskey = DB::table('webauthn_credentials')
            ->whereIn('user_id', $rows->pluck('id')->all() ?: [0])
            ->distinct()
            ->pluck('user_id')
            ->flip();

        $counts = array_fill_keys(array_keys(self::LEVEL_ORDER), 0);
        $accounts = [];

        foreach ($rows as $row) {
            $isGod = !empty($row->is_god);
            $isGlobal = !empty($row->is_super_admin) || ($row->role ?? 'member') === 'super_admin';
            $level = match (true) {
                $isGod && $isGlobal => 'platform_team',
                $isGlobal => 'global_super_admin',
                !empty($row->is_tenant_super_admin) => 'tenant_super_admin',
                default => 'platform_flag_only',
            };
            $counts[$level]++;

            $name = trim((string) ($row->name ?? ''));
            if ($name === '') {
                $name = trim(($row->first_name ?? '') . ' ' . ($row->last_name ?? ''));
            }

            $accounts[] = [
                'id' => (int) $row->id,
                'name' => $name !== '' ? $name : null,
                'email' => (string) $row->email,
                'level' => $level,
                'incomplete_platform_team' => $isGod && !$isGlobal,
                'community' => $row->tenant_id === null ? null : [
                    'id' => (int) $row->tenant_id,
                    'name' => $row->tenant_name !== null ? (string) $row->tenant_name : null,
                ],
                'status' => (string) ($row->status ?? 'active'),
                'last_sign_in_at' => $row->last_login_at !== null
                    ? Carbon::parse((string) $row->last_login_at)->toIso8601String()
                    : null,
                'two_step_on' => !empty($row->totp_enabled),
                'has_passkey' => $withPasskey->has($row->id),
            ];
        }

        usort($accounts, static function (array $a, array $b): int {
            return [self::LEVEL_ORDER[$a['level']], mb_strtolower((string) ($a['community']['name'] ?? '')), mb_strtolower((string) $a['name']), $a['id']]
                <=> [self::LEVEL_ORDER[$b['level']], mb_strtolower((string) ($b['community']['name'] ?? '')), mb_strtolower((string) $b['name']), $b['id']];
        });

        return [
            'total' => count($accounts),
            'truncated' => $truncated,
            'counts' => $counts,
            'accounts' => $accounts,
        ];
    }
}
