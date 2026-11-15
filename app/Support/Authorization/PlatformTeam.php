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
}
