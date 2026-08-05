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
 * Let a ward REFUSE and WITHDRAW a guardian arrangement, not only agree to it.
 *
 * 🔴 Why this is a defect and not a feature request. `safeguarding_assignments`
 * carried exactly one ward-facing column — `consent_given_at` — so the only
 * action a ward could take was to agree. There was no way to refuse, and no way
 * to change their mind afterwards; `revoked_at` is staff-only. A consent you
 * cannot decline is not consent, and a consent you cannot withdraw fails the
 * basic data-protection expectation that withdrawal is as easy as giving.
 *
 * Adds, additively (existing rows keep their meaning):
 *   - consent_declined_at   — the ward refused
 *   - consent_withdrawn_at  — the ward had agreed and has now withdrawn
 *   - ward_response_reason  — the ward's own words, optional, never mandatory
 *
 * The three timestamps are mutually exclusive in practice and the service
 * clears the others on each transition, so the row always states one current
 * position. History lives in the new events table rather than in the row.
 *
 * `safeguarding_assignment_events` follows the pattern
 * docs/SAFEGUARDING-AND-CONSENT.md tells you to copy — the one used by
 * `event_guardian_consent_history`: append-only, enforced by BEFORE UPDATE /
 * BEFORE DELETE triggers that raise SQLSTATE 45000, with the acting user and
 * their role recorded on every row. A safeguarding decision trail that can be
 * edited afterwards is not a trail.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('safeguarding_assignments', function (Blueprint $table): void {
            if (! Schema::hasColumn('safeguarding_assignments', 'consent_declined_at')) {
                $table->dateTime('consent_declined_at')->nullable()->after('consent_given_at');
            }
            if (! Schema::hasColumn('safeguarding_assignments', 'consent_withdrawn_at')) {
                $table->dateTime('consent_withdrawn_at')->nullable()->after('consent_declined_at');
            }
            if (! Schema::hasColumn('safeguarding_assignments', 'ward_response_reason')) {
                $table->string('ward_response_reason', 500)->nullable()->after('consent_withdrawn_at');
            }
        });

        if (! Schema::hasTable('safeguarding_assignment_events')) {
            Schema::create('safeguarding_assignment_events', function (Blueprint $table): void {
                $table->bigIncrements('id');
                $table->integer('tenant_id');
                $table->unsignedBigInteger('assignment_id');
                $table->integer('ward_user_id');
                $table->integer('guardian_user_id');

                // Closed vocabulary — see the CHECK constraint below. Free-text
                // action strings are how audit trails become unqueryable.
                $table->string('action', 24);

                // Who acted, and in what capacity. 'ward' actions are the ward's
                // own; 'staff' actions are a broker/admin creating or revoking.
                $table->string('actor_role', 16);
                $table->integer('actor_user_id')->nullable();

                $table->string('reason', 500)->nullable();
                $table->string('ip_address', 45)->nullable();
                $table->string('user_agent', 255)->nullable();
                $table->timestamp('created_at')->useCurrent();

                $table->index(['tenant_id', 'assignment_id', 'id'], 'idx_sg_assignment_events_assignment');
                $table->index(['tenant_id', 'ward_user_id', 'created_at'], 'idx_sg_assignment_events_ward');
            });

            DB::statement(
                "ALTER TABLE `safeguarding_assignment_events`
                 ADD CONSTRAINT `chk_sg_assignment_events_action`
                 CHECK (`action` IN ('created','consented','declined','withdrawn','revoked'))"
            );
            DB::statement(
                "ALTER TABLE `safeguarding_assignment_events`
                 ADD CONSTRAINT `chk_sg_assignment_events_actor`
                 CHECK (`actor_role` IN ('ward','staff','system'))"
            );

            // Append-only, enforced by the database rather than by convention.
            DB::unprepared(
                "CREATE TRIGGER `trg_sg_assignment_events_no_update`
                 BEFORE UPDATE ON `safeguarding_assignment_events`
                 FOR EACH ROW SIGNAL SQLSTATE '45000'
                 SET MESSAGE_TEXT = 'safeguarding_assignment_events_immutable'"
            );
            DB::unprepared(
                "CREATE TRIGGER `trg_sg_assignment_events_no_delete`
                 BEFORE DELETE ON `safeguarding_assignment_events`
                 FOR EACH ROW SIGNAL SQLSTATE '45000'
                 SET MESSAGE_TEXT = 'safeguarding_assignment_events_immutable'"
            );
        }
    }

    public function down(): void
    {
        // Triggers must go before the table, or the drop is refused.
        DB::unprepared('DROP TRIGGER IF EXISTS `trg_sg_assignment_events_no_update`');
        DB::unprepared('DROP TRIGGER IF EXISTS `trg_sg_assignment_events_no_delete`');
        Schema::dropIfExists('safeguarding_assignment_events');

        Schema::table('safeguarding_assignments', function (Blueprint $table): void {
            foreach (['ward_response_reason', 'consent_withdrawn_at', 'consent_declined_at'] as $column) {
                if (Schema::hasColumn('safeguarding_assignments', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
