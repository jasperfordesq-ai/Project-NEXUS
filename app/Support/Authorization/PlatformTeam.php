<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Authorization;

use Illuminate\Support\Facades\DB;

/**
 * The platform team: the people who run the whole installation.
 *
 * On screen it is always "Platform team" (owner, 15 Nov 2026). In the
 * database it is `users.is_god` AND super admin — both, the owner's recorded
 * definition of a god account (AGENTS.md "Authorisation"; 18 Oct 2026).
 *
 * 🔴 Both legs, and read from the database on every call:
 *
 *   - `is_god` is the COLUMN. The role string `god` is not accepted: the API
 *     never writes it, and `BaseApiController::requireGod()` has always read
 *     the column only.
 *   - Super admin is `is_super_admin` or the role string `super_admin`,
 *     exactly as `requireGodPlatformAdmin()` has read it since 18 Oct 2026.
 *     `is_tenant_super_admin` is NOT a platform super admin.
 *
 * This is the one definition. `BaseApiController::requireGodPlatformAdmin()`
 * and the `platform-team` route middleware both ask here, and the browser's
 * `isPlatformTeamUser()` (react-frontend/src/lib/access.ts) mirrors it.
 * Pinned by tests/Laravel/Unit/Authorization/PlatformTeamTest.php.
 */
final class PlatformTeam
{
    public static function includes(int $userId): bool
    {
        if ($userId <= 0) {
            return false;
        }

        $row = DB::table('users')
            ->where('id', $userId)
            ->first(['is_god', 'is_super_admin', 'role']);

        if ($row === null || empty($row->is_god)) {
            return false;
        }

        return !empty($row->is_super_admin) || ($row->role ?? 'member') === 'super_admin';
    }

    /**
     * The error code a request answers with when it would delete, erase or
     * demote the last platform team member.
     */
    public const LAST_MEMBER_CODE = 'PLATFORM_TEAM_LAST_MEMBER';

    /** What the database's own guard says when it refuses (the triggers' SIGNAL text). */
    public const LAST_MEMBER_DB_MESSAGE = 'platform_team_last_member';

    /**
     * Whether this account is the ONLY platform team member left.
     *
     * 🔴 There is always at least one platform team member (owner, 17 Nov
     * 2026): the last one cannot be deleted, erased or demoted, by any route.
     * The guarantee is in the database: the triggers
     * `trg_users_last_platform_team_update_guard` and `…_delete_guard`
     * (migration 2026_11_17_120000) refuse the write itself, whoever makes it.
     * This method is the same question asked EARLY, so a request can say why
     * before it emails anyone or starts erasing. It must stay the same
     * definition as those triggers: on the team (both legs above), and the
     * account neither deleted nor erased. Whether the account is suspended is
     * not part of it.
     *
     * Pinned by tests/Laravel/Feature/PlatformTeam/LastPlatformTeamMemberTest.php.
     */
    public static function isLastMember(int $userId): bool
    {
        if ($userId <= 0) {
            return false;
        }

        // Two rows are enough to answer: "is there exactly one, and is it this one?"
        // Cross-community on purpose: the platform team is not a community's.
        $members = DB::table('users')
            ->where('is_god', '<>', 0)
            ->where(static function ($q): void {
                $q->where('is_super_admin', '<>', 0)->orWhere('role', 'super_admin');
            })
            ->whereNull('deleted_at')
            ->whereNull('anonymized_at')
            ->orderBy('id')
            ->limit(2)
            ->pluck('id');

        return $members->count() === 1 && (int) $members->first() === $userId;
    }
}
