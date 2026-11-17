<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Two new members for super_admin_audit_log.action_type:
 * `platform_team_added` and `platform_team_removed`.
 *
 * Until 17 Nov 2026 `users.is_god` (platform team membership) could only be
 * set in the database, and no record was kept. The Senior accounts page of the
 * Platform team panel now adds and removes members
 * (App\Services\PlatformTeam\PlatformTeamMembershipService), and each change
 * is written to this log under its own name.
 *
 * 🔴 The members must exist BEFORE the code writes them. The platform runs
 * MariaDB with `strict => false`, so a value the enum does not hold is not
 * refused: it is stored as '' and the insert reports success (see
 * 2026_08_04_000001_add_missing_super_admin_audit_action_types.php).
 *
 * 🔴 Appended at the end, with ALGORITHM=INSTANT, LOCK=NONE. Appending is a
 * metadata-only change; the clause makes the server refuse the statement
 * rather than quietly rebuild the table while the other colour is serving.
 */
return new class extends Migration {
    private const BEFORE = "'tenant_created','tenant_updated','tenant_deleted','tenant_moved','hub_toggled',"
        . "'super_admin_granted','super_admin_revoked','user_created','user_updated','user_moved',"
        . "'bulk_users_moved','bulk_tenants_updated',"
        . "'tenant_purged','global_super_admin_granted','global_super_admin_revoked','unknown'";

    private const ADDED = ['platform_team_added', 'platform_team_removed'];

    public function up(): void
    {
        $type = $this->columnType();
        if ($type === null || str_contains($type, "'platform_team_added'")) {
            return;
        }

        DB::statement(
            'ALTER TABLE `super_admin_audit_log` MODIFY `action_type` ENUM('
            . self::BEFORE . ",'platform_team_added','platform_team_removed'"
            . ') NOT NULL, ALGORITHM=INSTANT, LOCK=NONE'
        );
    }

    public function down(): void
    {
        $type = $this->columnType();
        if ($type === null || !str_contains($type, "'platform_team_added'")) {
            return;
        }

        // An audit record is never rewritten to fit a smaller list. While any
        // row uses the new members, the list stays as it is.
        if (DB::table('super_admin_audit_log')->whereIn('action_type', self::ADDED)->exists()) {
            return;
        }

        // Taking members off the END of the list is metadata-only as well.
        DB::statement(
            'ALTER TABLE `super_admin_audit_log` MODIFY `action_type` ENUM('
            . self::BEFORE
            . ') NOT NULL, ALGORITHM=INSTANT, LOCK=NONE'
        );
    }

    private function columnType(): ?string
    {
        if (!Schema::hasTable('super_admin_audit_log') || !Schema::hasColumn('super_admin_audit_log', 'action_type')) {
            return null;
        }

        $column = DB::selectOne("SHOW COLUMNS FROM super_admin_audit_log WHERE Field = 'action_type'");

        return $column !== null && is_string($column->Type ?? null) ? $column->Type : null;
    }
};
