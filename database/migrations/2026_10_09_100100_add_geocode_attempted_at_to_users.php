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
 * Nullable and appended at the end of `users`, so on MariaDB 10.11 this is an
 * instant, metadata-only change that does not rebuild the table or block the
 * colour that is still serving traffic during a blue/green migration.
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
