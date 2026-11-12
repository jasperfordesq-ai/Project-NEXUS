<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A thank-you note is private until the person who RECEIVED it chooses to
 * show it on their profile (owner decision, 12 Nov 2026). The application
 * already stores every new note with `is_public = 0`; this makes the column
 * agree, so a row written by any other path is private too.
 *
 * Only the column DEFAULT changes. No existing row is touched: notes that
 * are on a profile today stay there until their receiver hides them.
 *
 * `ALGORITHM=INSTANT, LOCK=NONE` is the proof this cannot lock the colour
 * that is still serving: MariaDB refuses the statement outright if it cannot
 * be done as a metadata-only change (verified on 10.11).
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('appreciations') || ! Schema::hasColumn('appreciations', 'is_public')) {
            return;
        }

        DB::statement('ALTER TABLE `appreciations` ALTER COLUMN `is_public` SET DEFAULT 0, ALGORITHM=INSTANT, LOCK=NONE');
    }

    public function down(): void
    {
        if (! Schema::hasTable('appreciations') || ! Schema::hasColumn('appreciations', 'is_public')) {
            return;
        }

        DB::statement('ALTER TABLE `appreciations` ALTER COLUMN `is_public` SET DEFAULT 1, ALGORITHM=INSTANT, LOCK=NONE');
    }
};
