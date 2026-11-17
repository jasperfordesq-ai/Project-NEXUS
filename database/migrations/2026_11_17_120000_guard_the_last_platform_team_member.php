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
 * There is always at least one platform team member (owner, 17 Nov 2026).
 *
 * Two triggers on `users` refuse any write that would leave the installation
 * with no platform team member: clearing `is_god`, clearing super admin
 * (`is_super_admin`, or the role string `super_admin` when that is the leg the
 * account stands on), marking the account deleted, erasing it
 * (`anonymized_at`), or deleting the row. They answer
 * `platform_team_last_member` (App\Support\Authorization\PlatformTeam).
 *
 * 🔴 Why the database and not only the code. The flags can be changed from at
 * least eight places (two "revoke global super admin" requests, two role
 * changes, three ways to delete an account, a community purge) and by hand.
 * A check in each of those is only as good as the next place somebody adds.
 * The same reasoning as the stand-in guards in
 * 2026_10_12_180000_create_tenant_manager_delegates.php.
 *
 * "On the team" is exactly PlatformTeam::includes(): `is_god` AND (
 * `is_super_admin` OR role `super_admin`), on a row that is neither deleted
 * nor erased. `status` is deliberately not part of it: suspending an account
 * is not deleting or demoting it, and a bulk status update must never fail
 * because of one row.
 *
 * 🔴 The count of the OTHER members is an ordinary read, not a locking one, on
 * purpose. A locking read (`LOCK IN SHARE MODE`) was built first and taken out
 * the same day: it holds its locks on the `is_god` index, and the gap before
 * it, until the transaction ends. Erasing an account is one long transaction,
 * so erasing a member would have held up every new account on the platform
 * until it finished. (`FOR UPDATE` is not possible at all: MariaDB refuses it
 * on `users` from a trigger on `users`, error 1442.)
 * What that leaves open: two DIFFERENT members taken off by two different
 * transactions in the same instant can each see the other still in place.
 * The Senior accounts page cannot do that (PlatformTeamMembershipService
 * locks both rows and re-checks the caller); the other routes could, in
 * theory. One statement that removes several members at once IS refused:
 * the read sees the statement's own earlier rows.
 *
 * 🔴 Cost: every UPDATE of `users` evaluates the first IF on values it already
 * holds; the SELECT runs only for a row that is leaving the team, and reads
 * through `idx_users_is_god`. Nothing is rewritten: CREATE TRIGGER is a
 * metadata change.
 *
 * Not covered, and cannot be by a trigger: a row removed by a cascading
 * foreign key (`users_ibfk_1`, when a `tenants` row is deleted) does not fire
 * triggers. TenantPurgeService deletes a community's accounts with its own
 * DELETE before the community row, so that path IS covered.
 */
return new class extends Migration {
    private const UPDATE_TRIGGER = 'trg_users_last_platform_team_update_guard';

    private const DELETE_TRIGGER = 'trg_users_last_platform_team_delete_guard';

    /** %s is OLD, NEW or the alias of the row being judged. */
    private const ON_TEAM = '%1$s.`is_god` <> 0 '
        . "AND (COALESCE(%1\$s.`is_super_admin`, 0) <> 0 OR COALESCE(%1\$s.`role`, '') = 'super_admin') "
        . 'AND %1$s.`deleted_at` IS NULL AND %1$s.`anonymized_at` IS NULL';

    public function up(): void
    {
        if (! Schema::hasTable('users') || DB::getDriverName() !== 'mysql') {
            return;
        }

        $othersLeft = 'SELECT COUNT(*) INTO others_left FROM `users` AS other WHERE '
            . sprintf(self::ON_TEAM, 'other') . ' AND other.`id` <> OLD.`id`; '
            . "IF others_left = 0 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'platform_team_last_member'; END IF; ";

        if (! $this->triggerExists(self::UPDATE_TRIGGER)) {
            DB::unprepared(
                'CREATE TRIGGER `' . self::UPDATE_TRIGGER . '` BEFORE UPDATE ON `users` FOR EACH ROW '
                . 'BEGIN DECLARE others_left INT DEFAULT 0; '
                . 'IF (' . sprintf(self::ON_TEAM, 'OLD') . ') AND NOT (' . sprintf(self::ON_TEAM, 'NEW') . ') THEN '
                . $othersLeft
                . 'END IF; END'
            );
        }

        if (! $this->triggerExists(self::DELETE_TRIGGER)) {
            DB::unprepared(
                'CREATE TRIGGER `' . self::DELETE_TRIGGER . '` BEFORE DELETE ON `users` FOR EACH ROW '
                . 'BEGIN DECLARE others_left INT DEFAULT 0; '
                . 'IF (' . sprintf(self::ON_TEAM, 'OLD') . ') THEN '
                . $othersLeft
                . 'END IF; END'
            );
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'mysql') {
            DB::unprepared('DROP TRIGGER IF EXISTS `' . self::UPDATE_TRIGGER . '`');
            DB::unprepared('DROP TRIGGER IF EXISTS `' . self::DELETE_TRIGGER . '`');
        }
    }

    private function triggerExists(string $trigger): bool
    {
        return DB::table('information_schema.TRIGGERS')
            ->where('TRIGGER_SCHEMA', DB::getDatabaseName())
            ->where('TRIGGER_NAME', $trigger)
            ->exists();
    }
};
