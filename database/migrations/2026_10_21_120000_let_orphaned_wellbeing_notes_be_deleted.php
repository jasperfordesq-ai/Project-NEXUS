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
 * Staff notes on a wellbeing alert stay append-only while the alert exists, but a
 * note whose alert is gone (member erased, or a concluded alert disposed of by
 * retention) was stuck for ever: the DELETE trigger refused everything (wellbeing
 * audit, 21 Oct 2026). The trigger now refuses a delete only while the parent
 * alert still exists. UPDATE stays refused outright.
 *
 * Triggers only, so nothing here rebuilds a table.
 */
return new class extends Migration
{
    private const DELETE_TRIGGER = 'vol_wellbeing_alert_notes_no_delete';

    public function up(): void
    {
        if (DB::getDriverName() !== 'mysql' || !Schema::hasTable('vol_wellbeing_alert_notes')) {
            return;
        }
        DB::unprepared('DROP TRIGGER IF EXISTS `' . self::DELETE_TRIGGER . '`');
        DB::unprepared(
            'CREATE TRIGGER `' . self::DELETE_TRIGGER . '` BEFORE DELETE ON `vol_wellbeing_alert_notes` FOR EACH ROW '
            . 'BEGIN '
            . 'IF EXISTS (SELECT 1 FROM `vol_wellbeing_alerts` WHERE `id` = OLD.`alert_id`) THEN '
            . "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'vol_wellbeing_alert_notes_immutable'; "
            . 'END IF; '
            . 'END'
        );
    }

    public function down(): void
    {
        if (DB::getDriverName() !== 'mysql' || !Schema::hasTable('vol_wellbeing_alert_notes')) {
            return;
        }
        DB::unprepared('DROP TRIGGER IF EXISTS `' . self::DELETE_TRIGGER . '`');
        DB::unprepared(
            'CREATE TRIGGER `' . self::DELETE_TRIGGER . '` BEFORE DELETE ON `vol_wellbeing_alert_notes` FOR EACH ROW '
            . "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'vol_wellbeing_alert_notes_immutable'"
        );
    }
};
