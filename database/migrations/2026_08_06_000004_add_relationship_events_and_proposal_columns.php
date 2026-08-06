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
 * Phase 5a of the guardian redesign: the foundation for folding staff-recorded
 * guardian arrangements (safeguarding_assignments) into the ONE support
 * system members already answer in (account_relationships).
 *
 * Adds, additively — nothing changes behaviour by itself:
 *
 * 1. Proposal attribution on account_relationships. Today every relationship
 *    is member-initiated; when staff start proposing tier-0 relationships
 *    (5b), `proposed_by_user_id` records the staff member and `staff_notes`
 *    their note — the assigned_by/notes pair safeguarding_assignments has
 *    always carried.
 *
 * 2. Answer semantics richer than approve/revoke. The safeguarding flow lets
 *    the subject DECLINE (distinct from a staff revocation) and WITHDRAW a
 *    previously given agreement, with an optional — never required — reason.
 *    Folding it in must not lose that: declined_at / withdrawn_at /
 *    response_reason mirror the 2026-08-05 columns on
 *    safeguarding_assignments.
 *
 * 3. account_relationship_events — the append-only trail this table never
 *    had. Grants of real power over another member's listings and credits
 *    deserve at least the audit rigor of the record-only assignments table:
 *    same pattern (event_guardian_consent_history → safeguarding_assignment_events),
 *    BEFORE UPDATE / BEFORE DELETE triggers raising SQLSTATE 45000.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('account_relationships', function (Blueprint $table): void {
            if (! Schema::hasColumn('account_relationships', 'proposed_by_user_id')) {
                $table->integer('proposed_by_user_id')->nullable()->default(null)->after('status')
                    ->comment('Staff member who proposed this relationship; NULL = member-initiated');
            }
            if (! Schema::hasColumn('account_relationships', 'staff_notes')) {
                $table->string('staff_notes', 500)->nullable()->default(null)->after('proposed_by_user_id');
            }
            if (! Schema::hasColumn('account_relationships', 'declined_at')) {
                $table->dateTime('declined_at')->nullable()->default(null)->after('approved_at');
            }
            if (! Schema::hasColumn('account_relationships', 'withdrawn_at')) {
                $table->dateTime('withdrawn_at')->nullable()->default(null)->after('declined_at');
            }
            if (! Schema::hasColumn('account_relationships', 'response_reason')) {
                $table->string('response_reason', 500)->nullable()->default(null)->after('withdrawn_at')
                    ->comment('The answering member\'s own words - optional, never mandatory');
            }
        });

        if (! Schema::hasColumn('account_relationships', 'proposed_by_user_id')) {
            return; // hasColumn guard above failed us; bail rather than half-apply
        }

        // FK added outside the guard block above so re-runs stay idempotent.
        $fkExists = DB::selectOne(
            "SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'account_relationships'
               AND CONSTRAINT_NAME = 'fk_ar_proposed_by'"
        );
        if ($fkExists === null) {
            Schema::table('account_relationships', function (Blueprint $table): void {
                $table->foreign('proposed_by_user_id', 'fk_ar_proposed_by')
                    ->references('id')->on('users')->nullOnDelete();
            });
        }

        if (! Schema::hasTable('account_relationship_events')) {
            Schema::create('account_relationship_events', function (Blueprint $table): void {
                $table->bigIncrements('id');
                $table->integer('tenant_id');
                $table->integer('relationship_id');
                $table->integer('parent_user_id');
                $table->integer('child_user_id');
                $table->string('action', 24);
                $table->string('actor_role', 16);
                $table->integer('actor_user_id')->nullable();
                $table->string('reason', 500)->nullable();
                $table->longText('details')->nullable()
                    ->comment('JSON, e.g. tier before/after on permissions_changed');
                $table->string('ip_address', 45)->nullable();
                $table->string('user_agent', 255)->nullable();
                $table->timestamp('created_at')->useCurrent();

                $table->index(['tenant_id', 'relationship_id', 'id'], 'idx_ar_events_relationship');
                $table->index(['tenant_id', 'child_user_id', 'created_at'], 'idx_ar_events_child');
            });

            DB::statement(
                "ALTER TABLE `account_relationship_events`
                 ADD CONSTRAINT `chk_ar_events_action`
                 CHECK (`action` IN ('requested','proposed','approved','declined','withdrawn','revoked','permissions_changed'))"
            );
            DB::statement(
                "ALTER TABLE `account_relationship_events`
                 ADD CONSTRAINT `chk_ar_events_actor`
                 CHECK (`actor_role` IN ('member','staff','system'))"
            );

            // Append-only, enforced by the database rather than by convention.
            DB::unprepared(
                "CREATE TRIGGER `trg_ar_events_no_update`
                 BEFORE UPDATE ON `account_relationship_events`
                 FOR EACH ROW SIGNAL SQLSTATE '45000'
                 SET MESSAGE_TEXT = 'account_relationship_events_immutable'"
            );
            DB::unprepared(
                "CREATE TRIGGER `trg_ar_events_no_delete`
                 BEFORE DELETE ON `account_relationship_events`
                 FOR EACH ROW SIGNAL SQLSTATE '45000'
                 SET MESSAGE_TEXT = 'account_relationship_events_immutable'"
            );
        }
    }

    public function down(): void
    {
        DB::unprepared('DROP TRIGGER IF EXISTS `trg_ar_events_no_update`');
        DB::unprepared('DROP TRIGGER IF EXISTS `trg_ar_events_no_delete`');
        Schema::dropIfExists('account_relationship_events');

        Schema::table('account_relationships', function (Blueprint $table): void {
            if (Schema::hasColumn('account_relationships', 'proposed_by_user_id')) {
                $table->dropForeign('fk_ar_proposed_by');
            }
            foreach (['response_reason', 'withdrawn_at', 'declined_at', 'staff_notes', 'proposed_by_user_id'] as $column) {
                if (Schema::hasColumn('account_relationships', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
