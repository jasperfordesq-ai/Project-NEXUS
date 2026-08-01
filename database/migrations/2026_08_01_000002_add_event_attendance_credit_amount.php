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
 * Per-event attendance reward amount.
 *
 * A flat, organiser-set number of time credits granted once per member for a
 * VERIFIED check-in — not per hour attended. Flat and per-event because the
 * community funding it needs a predictable ceiling, and because an amount
 * derived from attendance duration invites gaming the check-out time.
 *
 * NULL means this event grants nothing, which is the default for every existing
 * and future event. Combined with the tenant feature flag and the env mode, a
 * reward can only ever happen when all three are deliberately set.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('events') || Schema::hasColumn('events', 'attendance_credit_amount')) {
            return;
        }

        Schema::table('events', function (Blueprint $table): void {
            $table->decimal('attendance_credit_amount', 10, 2)->nullable()->after('auto_log_hours')
                ->comment('Time credits granted once per member on verified check-in; NULL grants nothing');
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('events') || ! Schema::hasColumn('events', 'attendance_credit_amount')) {
            return;
        }

        Schema::table('events', function (Blueprint $table): void {
            $table->dropColumn('attendance_credit_amount');
        });
    }
};
