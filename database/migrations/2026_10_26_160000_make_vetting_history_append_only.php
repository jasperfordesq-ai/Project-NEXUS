<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The history behind every vetting decision is append-only, enforced by the
 * database rather than by convention (gap found 26 Oct 2026). The application
 * only ever inserts into `member_vetting_attestation_events`; these triggers
 * refuse any UPDATE or DELETE statement with SQLSTATE 45000, matching
 * `account_relationship_events` and the other safeguarding audit tables.
 *
 * Foreign-key actions (a member, staff account or community being removed) do
 * not fire triggers in InnoDB, so those still cascade as before. TRUNCATE also
 * bypasses DELETE triggers: this protects against the application and ordinary
 * SQL, not against someone with full database access.
 *
 * Creating a trigger changes no rows and does not rebuild the table.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('member_vetting_attestation_events')) {
            return;
        }

        DB::unprepared('DROP TRIGGER IF EXISTS `trg_mva_events_no_update`');
        DB::unprepared('DROP TRIGGER IF EXISTS `trg_mva_events_no_delete`');
        DB::unprepared(
            "CREATE TRIGGER `trg_mva_events_no_update`
             BEFORE UPDATE ON `member_vetting_attestation_events`
             FOR EACH ROW SIGNAL SQLSTATE '45000'
             SET MESSAGE_TEXT = 'member_vetting_attestation_events_immutable'"
        );
        DB::unprepared(
            "CREATE TRIGGER `trg_mva_events_no_delete`
             BEFORE DELETE ON `member_vetting_attestation_events`
             FOR EACH ROW SIGNAL SQLSTATE '45000'
             SET MESSAGE_TEXT = 'member_vetting_attestation_events_immutable'"
        );
    }

    public function down(): void
    {
        DB::unprepared('DROP TRIGGER IF EXISTS `trg_mva_events_no_update`');
        DB::unprepared('DROP TRIGGER IF EXISTS `trg_mva_events_no_delete`');
    }
};
