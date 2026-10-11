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
 * A withdrawn guest must stop holding the member's guest allowance.
 *
 * When a member cancelled, their guests were withdrawn (kept, never deleted,
 * because the row is the consent record). When they registered again — the
 * same registration row is reused — they could never add a guest back:
 *
 *  - trg_ev_reg_guest_insert_guard counted every non-anonymised guest,
 *    withdrawn ones included, against max_guests_per_registration; and it
 *    required NEW.guest_number <= max_guests_per_registration, so with a
 *    limit of one, guest number 2 was refused for ever;
 *  - chk_ev_reg_guest_number capped guest_number at 10, and guest numbers are
 *    never reused (uq_ev_reg_guest_number, and the number is immutable).
 *
 * The guard now counts only `captured` guests and no longer ties the number
 * to the limit. The CHECK is dropped; its two rules (guest_number >= 1,
 * revision > 0) move into triggers, and the column type (TINYINT UNSIGNED)
 * still caps the number at 255.
 *
 * 🔴 Why the CHECK is dropped rather than widened: measured on MariaDB
 * 10.11.18 on 2026-10-11, `DROP CONSTRAINT` is accepted with
 * ALGORITHM=INSTANT, but `ADD CONSTRAINT … CHECK` is refused with
 * ALGORITHM=INSTANT and NOCOPY ("Try ALGORITHM=COPY") — adding a CHECK
 * rebuilds the table, which would lock it while the live colour serves.
 */
return new class extends Migration
{
    private const TABLE = 'event_registration_guests';
    private const CHECK = 'chk_ev_reg_guest_number';
    private const INSERT_GUARD = 'trg_ev_reg_guest_insert_guard';
    private const REVISION_GUARD = 'trg_ev_reg_guest_revision_update';

    public function up(): void
    {
        if (DB::getDriverName() !== 'mysql' || ! Schema::hasTable(self::TABLE)) {
            return;
        }

        DB::unprepared('DROP TRIGGER IF EXISTS `' . self::INSERT_GUARD . '`');
        DB::unprepared(
            'CREATE TRIGGER `' . self::INSERT_GUARD . '` BEFORE INSERT ON `event_registration_guests` FOR EACH ROW BEGIN '
            . "IF (SELECT COUNT(*) FROM `event_registration_settings` WHERE `tenant_id` = NEW.`tenant_id` AND `event_id` = NEW.`event_id` AND `status` = 'published' AND `guests_enabled` = 1 AND `max_guests_per_registration` >= 1) <> 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'event_registration_guests_disabled_or_unbounded'; END IF; "
            . "IF NEW.`guest_number` < 1 OR NEW.`revision` < 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'event_registration_guest_number_invalid'; END IF; "
            . "IF NEW.`status` = 'captured' AND (SELECT COUNT(*) FROM `event_registration_guests` WHERE `tenant_id` = NEW.`tenant_id` AND `event_id` = NEW.`event_id` AND `registration_id` = NEW.`registration_id` AND `status` = 'captured') >= (SELECT `max_guests_per_registration` FROM `event_registration_settings` WHERE `tenant_id` = NEW.`tenant_id` AND `event_id` = NEW.`event_id`) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'event_registration_guest_limit_reached'; END IF; "
            . 'END'
        );

        // guest_number is already immutable (trg_ev_reg_guest_privacy_update);
        // this keeps the CHECK's other half, revision > 0, on updates.
        DB::unprepared('DROP TRIGGER IF EXISTS `' . self::REVISION_GUARD . '`');
        DB::unprepared(
            'CREATE TRIGGER `' . self::REVISION_GUARD . '` BEFORE UPDATE ON `event_registration_guests` FOR EACH ROW BEGIN '
            . "IF NEW.`revision` < 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'event_registration_guest_number_invalid'; END IF; "
            . 'END'
        );

        if ($this->constraintExists()) {
            DB::statement(
                'ALTER TABLE `event_registration_guests` DROP CONSTRAINT `' . self::CHECK . '`, ALGORITHM=INSTANT, LOCK=NONE'
            );
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() !== 'mysql' || ! Schema::hasTable(self::TABLE)) {
            return;
        }

        // Rollback only: re-adding the CHECK rebuilds the table, and it fails
        // if a registration has since been given a guest numbered above 10.
        if (! $this->constraintExists()) {
            DB::statement(
                'ALTER TABLE `event_registration_guests` ADD CONSTRAINT `' . self::CHECK . '` CHECK (`guest_number` BETWEEN 1 AND 10 AND `revision` > 0)'
            );
        }
        DB::unprepared('DROP TRIGGER IF EXISTS `' . self::REVISION_GUARD . '`');
        DB::unprepared('DROP TRIGGER IF EXISTS `' . self::INSERT_GUARD . '`');
        DB::unprepared(
            'CREATE TRIGGER `' . self::INSERT_GUARD . '` BEFORE INSERT ON `event_registration_guests` FOR EACH ROW BEGIN '
            . "IF (SELECT COUNT(*) FROM `event_registration_settings` WHERE `tenant_id` = NEW.`tenant_id` AND `event_id` = NEW.`event_id` AND `status` = 'published' AND `guests_enabled` = 1 AND NEW.`guest_number` <= `max_guests_per_registration`) <> 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'event_registration_guests_disabled_or_unbounded'; END IF; "
            . "IF (SELECT COUNT(*) FROM `event_registration_guests` WHERE `tenant_id` = NEW.`tenant_id` AND `event_id` = NEW.`event_id` AND `registration_id` = NEW.`registration_id` AND `status` <> 'anonymised') >= (SELECT `max_guests_per_registration` FROM `event_registration_settings` WHERE `tenant_id` = NEW.`tenant_id` AND `event_id` = NEW.`event_id`) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'event_registration_guest_limit_reached'; END IF; "
            . 'END'
        );
    }

    private function constraintExists(): bool
    {
        return DB::table('information_schema.TABLE_CONSTRAINTS')
            ->where('CONSTRAINT_SCHEMA', DB::getDatabaseName())
            ->where('TABLE_NAME', self::TABLE)
            ->where('CONSTRAINT_NAME', self::CHECK)
            ->exists();
    }
};
