<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\PlatformTeam;

use App\Support\Names\NameReason;
use App\Support\UserDisplayName;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Platform team panel → Senior accounts.
 *
 * Every account that can administer more than one community: the platform
 * team, global super admins and tenant super admins, with when each last
 * signed in and whether it has a second sign-in step.
 *
 * 🔴 This class only reads. The page's two actions (add an account to the
 * platform team, remove one from it; owner, 17 Nov 2026) are in
 * PlatformTeamMembershipService, which is the only code that writes
 * `users.is_god`. Until that date the flag was set in the database by hand.
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
 *   platform_flag_only  `is_god`, or the old role string `god`, with none of
 *                       the above. NOT on the platform team, and it cannot
 *                       open this panel. 🔴 But it is NOT harmless:
 *                       App\Core\SuperPanelAccess and
 *                       App\Support\Authorization\CrossTenantEntry both treat
 *                       either mark as platform-wide, so such an account can
 *                       reach every community. The page says exactly that
 *                       (review, 16 Nov 2026: the first wording called it
 *                       "not on the platform team" and stopped there).
 *
 * A row is `incomplete_platform_team` when it carries either god mark
 * without being a super admin, whatever its level.
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
                    ->orWhereIn('u.role', ['super_admin', 'god'])
                    ->orWhere('u.is_tenant_super_admin', 1);
            })
            // A manager's stand-in in a community below never signs in and is
            // not an account anyone holds. `status` may be NULL, and NULL is
            // not a stand-in: a bare "!= 'delegate'" would drop it.
            ->where(static function ($q): void {
                $q->whereNull('u.status')->orWhere('u.status', '!=', 'delegate');
            })
            ->whereNull('u.deleted_at')
            ->orderBy('u.id')
            ->limit(self::LIMIT + 1)
            ->get([
                'u.id', 'u.name',
                // The platform's one display-name rule. Full, because only the
                // platform team can reach this (the strictest admin gate).
                DB::raw(UserDisplayName::sqlFull('u', 'display_name', NameReason::ADMIN_ROUTE)),
                'u.email', 'u.role', 'u.status',
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
            $role = (string) ($row->role ?? 'member');
            $isGlobal = !empty($row->is_super_admin) || $role === 'super_admin';
            // Platform team membership needs the is_god COLUMN (PlatformTeam::includes()).
            $onTeam = !empty($row->is_god) && $isGlobal;
            // Either god mark is read as platform-wide elsewhere in the code.
            $hasGodMark = !empty($row->is_god) || $role === 'god';
            $level = match (true) {
                $onTeam => 'platform_team',
                $isGlobal => 'global_super_admin',
                !empty($row->is_tenant_super_admin) => 'tenant_super_admin',
                default => 'platform_flag_only',
            };
            $counts[$level]++;

            $name = trim((string) ($row->display_name ?? ''));
            if ($name === '') {
                $name = trim((string) ($row->name ?? ''));
            }

            $accounts[] = [
                'id' => (int) $row->id,
                'name' => $name !== '' ? $name : null,
                'email' => (string) $row->email,
                'level' => $level,
                'incomplete_platform_team' => $hasGodMark && !$isGlobal,
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
