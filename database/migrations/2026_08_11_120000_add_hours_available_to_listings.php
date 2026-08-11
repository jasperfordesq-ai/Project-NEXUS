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
 * Adds a total-hours cap to listings, alongside the existing per-exchange
 * duration.
 *
 * Requested by Minehead and Coast Time Bank (2026-08-09): timebanks migrating
 * from TOL2 keep two separate numbers on a task, and NEXUS only had one.
 *
 *   - `hours_estimate`  — how long ONE exchange is expected to take, so both
 *                         sides know what they are agreeing to. Already existed.
 *   - `hours_available` — the TOTAL a member is willing to give for this
 *                         listing, which they do not want to go over.
 *
 * NULL means "no cap set", which is exactly today's behaviour, so every existing
 * listing keeps working untouched and nothing needs backfilling. Deliberately
 * NOT an "unlimited" boolean: a nullable cap has one representation for the
 * common case instead of two that can disagree.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('listings')) {
            return;
        }

        if (Schema::hasColumn('listings', 'hours_available')) {
            return;
        }

        Schema::table('listings', function (Blueprint $table): void {
            // decimal(6,2) not (5,2): the cap is a total, so it must comfortably
            // exceed the 2000-hour per-exchange ceiling that validation allows.
            $table->decimal('hours_available', 6, 2)
                ->nullable()
                ->default(null)
                ->after('hours_estimate')
                ->comment('Total hours the member will give for this listing; NULL = no cap');
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('listings') || ! Schema::hasColumn('listings', 'hours_available')) {
            return;
        }

        Schema::table('listings', function (Blueprint $table): void {
            $table->dropColumn('hours_available');
        });
    }
};
