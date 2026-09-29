<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * F-224 (E-061): record WHO asked for a member-initiated linked account, so the
 * other party — and only the other party — can accept it.
 *
 * A link can now be asked for from either end: a supporter offering to help
 * (the original flow; the supported member accepts) or a member asking someone
 * to help them (the helper accepts). NULL means a row written before this
 * column existed, or a staff-proposed arrangement; both keep their original
 * rule, so no backfill is needed.
 *
 * Nullable and appended at the end of the table: a metadata-only, instant ADD
 * on MariaDB 10.11, safe while the other colour is serving.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('account_relationships')
            || Schema::hasColumn('account_relationships', 'requested_by_user_id')) {
            return;
        }

        Schema::table('account_relationships', function (Blueprint $table): void {
            $table->integer('requested_by_user_id')
                ->nullable()
                ->comment('Member who asked for this link; the OTHER party accepts. NULL = legacy supporter-initiated or staff-proposed');
        });
    }

    public function down(): void
    {
        if (Schema::hasColumn('account_relationships', 'requested_by_user_id')) {
            Schema::table('account_relationships', function (Blueprint $table): void {
                $table->dropColumn('requested_by_user_id');
            });
        }
    }
};
