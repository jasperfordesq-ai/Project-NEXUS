<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Immutable audit of every supporter read of a supported member's messages.
 *
 * Follows the event_registration_answer_access_audits shape exactly (the
 * in-house precedent for read-auditing sensitive data): mandatory purpose,
 * actor-indexed, and append-only via BEFORE UPDATE / BEFORE DELETE signal
 * triggers — a row can be written once and never altered, by anyone,
 * including an administrator with SQL access.
 *
 * One row per REQUEST (a list view or a thread page), not per message:
 * per-message rows would say nothing more (a page shows every message on it)
 * and would make the table useless to read. `partner_user_id` is NULL for
 * list views. `correlation_hash` groups repeated same-session reads.
 *
 * The supported member can see "last viewed" derived from this table — the
 * audit is member-visible accountability, not just an admin artefact.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('supporter_message_view_audits')) {
            Schema::create('supporter_message_view_audits', static function (Blueprint $table): void {
                $table->bigIncrements('id');
                $table->integer('tenant_id');
                $table->integer('relationship_id');
                $table->integer('supporter_user_id');
                $table->integer('supported_user_id');
                $table->integer('partner_user_id')->nullable();
                $table->string('action', 16); // 'list' | 'read'
                $table->string('purpose', 500);
                $table->char('correlation_hash', 64);
                $table->timestamp('created_at')->useCurrent();

                $table->index(
                    ['tenant_id', 'supported_user_id', 'created_at', 'id'],
                    'idx_smva_supported',
                );
                $table->index(
                    ['tenant_id', 'supporter_user_id', 'created_at', 'id'],
                    'idx_smva_supporter',
                );

                $table->foreign('tenant_id', 'fk_smva_tenant')
                    ->references('id')->on('tenants')->restrictOnDelete();
            });
        }

        $this->createSignalTrigger(
            'trg_smva_no_update',
            'BEFORE UPDATE ON `supporter_message_view_audits` FOR EACH ROW',
            'supporter_message_view_audit_immutable',
        );
        $this->createSignalTrigger(
            'trg_smva_no_delete',
            'BEFORE DELETE ON `supporter_message_view_audits` FOR EACH ROW',
            'supporter_message_view_audit_immutable',
        );
    }

    public function down(): void
    {
        DB::unprepared('DROP TRIGGER IF EXISTS `trg_smva_no_update`');
        DB::unprepared('DROP TRIGGER IF EXISTS `trg_smva_no_delete`');
        Schema::dropIfExists('supporter_message_view_audits');
    }

    private function createSignalTrigger(string $name, string $timing, string $message): void
    {
        $exists = DB::selectOne(
            'SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = ?',
            [$name],
        );
        if ($exists !== null) {
            return;
        }
        DB::unprepared(
            "CREATE TRIGGER `{$name}` {$timing} SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '{$message}'",
        );
    }
};
