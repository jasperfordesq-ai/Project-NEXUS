<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A member's profile photo can now carry a description for screen-reader users
 * (AWID accessibility report item 6, 30 Oct 2026: "no option to add alt text to
 * profile photos"). NULL means none; the websites then describe the photo by
 * the member's name, as before. Cleared when the photo changes, and on erasure.
 *
 * Adding a nullable column at the end is an instant, metadata-only change on
 * MariaDB 10.11. No existing row changes.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('users') || Schema::hasColumn('users', 'avatar_alt')) {
            return;
        }

        Schema::table('users', function (Blueprint $table) {
            $table->string('avatar_alt', 255)->nullable();
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('users') || ! Schema::hasColumn('users', 'avatar_alt')) {
            return;
        }

        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('avatar_alt');
        });
    }
};
