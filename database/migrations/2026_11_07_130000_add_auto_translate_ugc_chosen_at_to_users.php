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
 * When a member last chose for themselves whether posts, listings and other
 * content are translated automatically. NULL = never chose, so the member
 * follows their community's "Auto-translate posts, listings and other content"
 * setting (translation.auto_translate_content, off by default — owner decision,
 * 7 Nov 2026). users.auto_translate_ugc alone cannot tell "never chose" from
 * "chose off". The rule lives in App\Services\Translation\MemberContentAutoTranslate.
 *
 * Backfill: a member with auto_translate_ugc = 1 switched it on themselves (it
 * was off by default and only a member could change it), so they are marked as
 * having chosen and keep it on whatever their community decides. Members with 0
 * stay NULL: before today "never chose" and "chose off" were the same thing.
 *
 * 🔴 This is NOT an instant change. `users` has a FULLTEXT index
 * (ft_users_search), and on MariaDB 10.11 that rules out a metadata-only column
 * add. Measured 2026-11-07 on an empty copy of `users` (MariaDB 10.11.18):
 *   ALGORITHM=INSTANT            -> ERROR 1845 "not supported for this operation"
 *   ALGORITHM=INPLACE, LOCK=NONE -> ERROR 1846 "Fulltext index creation requires
 *                                   a lock. Try LOCK=SHARED"
 * So MariaDB rebuilds `users` under a shared lock: members can still be read,
 * but writes to `users` (sign-in stamps, profile edits, sign-ups) wait until the
 * rebuild ends — on the colour still serving traffic too. Same finding as
 * 2026_10_09_100100_add_geocode_attempted_at_to_users. Check the production row
 * count before deploying; the migration safety gate passes this (it only blocks
 * destructive changes), so nothing else will warn.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('users') || ! Schema::hasColumn('users', 'auto_translate_ugc')) {
            return;
        }

        if (! Schema::hasColumn('users', 'auto_translate_ugc_chosen_at')) {
            Schema::table('users', function (Blueprint $table): void {
                $table->timestamp('auto_translate_ugc_chosen_at')->nullable();
            });
        }

        // Every community, deliberately: this records what each member already chose.
        DB::table('users')
            ->where('auto_translate_ugc', 1)
            ->whereNull('auto_translate_ugc_chosen_at')
            ->update(['auto_translate_ugc_chosen_at' => now()]);
    }

    public function down(): void
    {
        if (! Schema::hasTable('users') || ! Schema::hasColumn('users', 'auto_translate_ugc_chosen_at')) {
            return;
        }

        Schema::table('users', function (Blueprint $table): void {
            $table->dropColumn('auto_translate_ugc_chosen_at');
        });
    }
};
