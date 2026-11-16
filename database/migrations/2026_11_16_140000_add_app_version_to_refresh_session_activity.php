<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
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
            Schema::table('refresh_session_activity', function (Blueprint $table): void {
                $table->string('app_version', 20)->nullable();
            });
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
