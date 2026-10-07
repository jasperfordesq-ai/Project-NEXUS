<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Wellbeing check-ins (7 Oct 2026). A volunteer who says they are struggling or
 * low can now choose to let the community's team and their organisations know.
 * `share_with_team` records that choice per check-in (a check-in made before
 * this change was never shared, hence the default of 0), and `team_notified_at`
 * records when people were told, which also limits the alert to one a day.
 * Both columns are appended, so the change is metadata-only.
 */
return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasTable('vol_mood_checkins')) {
            return;
        }

        Schema::table('vol_mood_checkins', function (Blueprint $table) {
            if (!Schema::hasColumn('vol_mood_checkins', 'share_with_team')) {
                $table->boolean('share_with_team')->default(false);
            }
            if (!Schema::hasColumn('vol_mood_checkins', 'team_notified_at')) {
                $table->dateTime('team_notified_at')->nullable();
            }
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable('vol_mood_checkins')) {
            return;
        }

        Schema::table('vol_mood_checkins', function (Blueprint $table) {
            foreach (['team_notified_at', 'share_with_team'] as $column) {
                if (Schema::hasColumn('vol_mood_checkins', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
