<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Staff notes on a volunteer wellbeing alert: append-only, as the incident
 * timeline is (the database refuses UPDATE and DELETE). A note about a named
 * volunteer is a record public-sector customers may be asked for; it is never
 * edited in place. vol_wellbeing_alerts.coordinator_notes stays as legacy text,
 * shown read-only when non-empty and no longer written.
 *
 * New table only: no ALTER, so the blue/green migration safety gate passes.
 */
return new class extends Migration
{
    private const UPDATE_TRIGGER = 'vol_wellbeing_alert_notes_no_update';
    private const DELETE_TRIGGER = 'vol_wellbeing_alert_notes_no_delete';

    public function up(): void
    {
        if (!Schema::hasTable('vol_wellbeing_alert_notes')) {
            Schema::create('vol_wellbeing_alert_notes', function (Blueprint $t): void {
                $t->bigIncrements('id');
                $t->unsignedInteger('tenant_id');
                $t->unsignedInteger('alert_id');
                $t->unsignedInteger('author_user_id');
                $t->text('body');
                $t->dateTime('created_at');
                $t->index(['tenant_id', 'alert_id', 'id'], 'idx_vwanote_alert');
            });
        }
        $this->installTriggers();
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'mysql') {
            DB::unprepared('DROP TRIGGER IF EXISTS `' . self::UPDATE_TRIGGER . '`');
            DB::unprepared('DROP TRIGGER IF EXISTS `' . self::DELETE_TRIGGER . '`');
        }
        Schema::dropIfExists('vol_wellbeing_alert_notes');
    }

    private function installTriggers(): void
    {
        if (DB::getDriverName() !== 'mysql') {
            return;
        }
        foreach ([self::UPDATE_TRIGGER => 'UPDATE', self::DELETE_TRIGGER => 'DELETE'] as $name => $op) {
            $exists = DB::table('information_schema.TRIGGERS')
                ->where('TRIGGER_SCHEMA', DB::getDatabaseName())
                ->where('TRIGGER_NAME', $name)
                ->exists();
            if (!$exists) {
                DB::unprepared(
                    'CREATE TRIGGER `' . $name . '` BEFORE ' . $op . ' ON `vol_wellbeing_alert_notes` FOR EACH ROW '
                    . "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'vol_wellbeing_alert_notes_immutable'"
                );
            }
        }
    }
};
