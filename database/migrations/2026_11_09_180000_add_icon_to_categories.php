<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A picture for each theme (AWID feedback, Nov 2026: "clear categories,
 * attractive visuals"). `icon` holds one key from App\Support\Categories
 * \ThemeIcons::ALLOWED, chosen by an administrator; NULL means "choose
 * automatically" (the website guesses from the theme's name).
 *
 * Adding a nullable column at the end is an instant, metadata-only change on
 * MariaDB 10.11. No existing row changes.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('categories') || Schema::hasColumn('categories', 'icon')) {
            return;
        }

        Schema::table('categories', function (Blueprint $table) {
            $table->string('icon', 40)->nullable();
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('categories') || ! Schema::hasColumn('categories', 'icon')) {
            return;
        }

        Schema::table('categories', function (Blueprint $table) {
            $table->dropColumn('icon');
        });
    }
};
