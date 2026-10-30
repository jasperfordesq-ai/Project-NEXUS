<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A listing's photo can now carry a description for screen-reader users
 * (AWID pilot feedback, 30 Oct 2026). The photo itself lives in
 * `listings.image_url`; `image_alt` is its alt text. NULL means the member
 * wrote none, and the websites fall back to the listing title as before.
 *
 * Adding a nullable column at the end is an instant, metadata-only change on
 * MariaDB 10.11. No existing row changes.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('listings') || Schema::hasColumn('listings', 'image_alt')) {
            return;
        }

        Schema::table('listings', function (Blueprint $table) {
            $table->string('image_alt', 255)->nullable();
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('listings') || ! Schema::hasColumn('listings', 'image_alt')) {
            return;
        }

        Schema::table('listings', function (Blueprint $table) {
            $table->dropColumn('image_alt');
        });
    }
};
