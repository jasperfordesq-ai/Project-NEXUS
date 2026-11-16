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
 * Which version of the phone app a sign-in was made with (Platform team panel,
 * Phone app page, "App versions in use", Nov 2026).
 *
 * `TokenService` writes it beside `from_phone_app` when the app signs in, from
 * the `X-Nexus-Mobile-Version` header, and only when that header is a plain
 * `1.2.3` version; anything else is NULL. Rows written before this column
 * existed stay NULL ("not recorded").
 *
 * A nullable column with no default added at the end of the table: a
 * metadata-only change on MariaDB 10.11, safe while the other blue/green
 * colour is serving. The new code writes the column, so this must run before
 * the traffic switch (bluegreen-deploy.sh migrates before it switches).
 *
 * Erasure needs nothing more: GdprService already deletes a member's
 * `refresh_session_activity` rows (F-622), and this is a column on those rows.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('refresh_session_activity')
            && ! Schema::hasColumn('refresh_session_activity', 'app_version')) {
            // Raw statements, not the schema builder, for two reasons. This
            // table is written on every sign-in and every renewal. An ALTER
            // that has to wait for its metadata lock makes every later query
            // on the table queue behind it, so sign-ins stall for as long as
            // it waits: five seconds and then a failed deploy is better than
            // that. And ALGORITHM=INSTANT, LOCK=NONE makes the server refuse
            // the statement rather than quietly rebuild the table.
            // The short wait is put back afterwards, so later migrations in the
            // same run keep the server's usual one.
            $previous = (int) DB::selectOne('SELECT @@SESSION.lock_wait_timeout AS t')->t;
            DB::statement('SET SESSION lock_wait_timeout = 5');
            try {
                DB::statement('ALTER TABLE refresh_session_activity ADD COLUMN app_version VARCHAR(20) NULL, ALGORITHM=INSTANT, LOCK=NONE');
            } finally {
                DB::statement('SET SESSION lock_wait_timeout = ' . max(1, $previous));
            }
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('refresh_session_activity')
            && Schema::hasColumn('refresh_session_activity', 'app_version')) {
            Schema::table('refresh_session_activity', function (Blueprint $table): void {
                $table->dropColumn('app_version');
            });
        }
    }
};
