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
 * Volunteering and event matches a member has hidden (19 Nov 2026).
 *
 * A member could hide an offer or request (match_dismissals, keyed by
 * listing) and a group (group_match_cache.status), but had no way to hide a
 * volunteering opportunity or an event suggested on the Matches page: there
 * was nowhere to record it. A new, empty table; nothing existing is touched.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('match_source_dismissals')) {
            return;
        }

        Schema::create('match_source_dismissals', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->unsignedInteger('tenant_id');
            $table->unsignedInteger('user_id');
            // 'volunteering' (vol_opportunities.id) or 'event' (events.id)
            $table->string('source_type', 20);
            $table->unsignedInteger('source_id');
            $table->string('reason', 50)->nullable();
            $table->timestamp('created_at')->useCurrent();
            $table->unique(['tenant_id', 'user_id', 'source_type', 'source_id'], 'uk_msd_member_source');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('match_source_dismissals');
    }
};
