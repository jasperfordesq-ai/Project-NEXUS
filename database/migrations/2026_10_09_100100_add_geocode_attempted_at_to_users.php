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
 * When a background map lookup last tried to place this member from their
 * location text. A member whose lookup found nothing is marked, so the job does
 * not retry the same address every run. NULL = never tried.
 *
 * 🔴 This is NOT an instant change. `users` has a FULLTEXT index
 * (ft_users_search), and on MariaDB 10.11 that rules out a metadata-only add:
 * measured 2026-10-09 on a throwaway copy of `users` (10.11.18),
 *   ALGORITHM=INSTANT            -> ERROR 1845 "not supported for this operation"
 *   ALGORITHM=INPLACE, LOCK=NONE -> ERROR 1846 "Fulltext index creation requires
 *                                   a lock. Try LOCK=SHARED"
 *   ALGORITHM=INPLACE, LOCK=SHARED and the plain add below -> accepted
 * So MariaDB REBUILDS `users` while holding a shared lock: members can still be
 * read, but every write to `users` (sign-in stamps, profile edits, sign-ups)
 * waits until the rebuild ends — on the colour still serving traffic too. The
 * copy took about 2.5 s at 63,000 rows locally. Check the production row count
 * before deploying; at today's size it is seconds. The migration safety gate
 * passes it (it only blocks destructive changes), so nothing else will warn.
 */
return new class extends Migration {
    public function up(): void
    {
        if (! Schema::hasTable('users') || Schema::hasColumn('users', 'geocode_attempted_at')) {
            return;
        }

        Schema::table('users', function (Blueprint $table): void {
            $table->timestamp('geocode_attempted_at')->nullable();
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('users') || ! Schema::hasColumn('users', 'geocode_attempted_at')) {
            return;
        }

        Schema::table('users', function (Blueprint $table): void {
            $table->dropColumn('geocode_attempted_at');
        });
    }
};
