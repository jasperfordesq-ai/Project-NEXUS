<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * E-119 F-608: when each signed-in session (one refresh-token family, i.e. one
 * browser or phone) was last used, so the server itself can enforce the
 * community's "Inactivity timeout (minutes)" setting. Until now only a timer in
 * the open browser tab did, and the server renewed an idle session for its full
 * 30-day life.
 *
 * One row per family, keyed by the same hash `refresh_token_sessions` uses.
 * A family with no row (signed in before this table existed) is treated as
 * active from the first time it is seen, so a deploy signs nobody out.
 *
 * A new table: no existing table is altered, so this is safe while the other
 * blue/green colour is serving.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('refresh_session_activity')) {
            return;
        }

        Schema::create('refresh_session_activity', function (Blueprint $table) {
            $table->char('family_hash', 64)->primary();
            $table->integer('tenant_id');
            $table->integer('user_id');
            $table->timestamp('last_activity_at');
            $table->timestamps();

            $table->index(['tenant_id', 'user_id'], 'idx_refresh_activity_tenant_user');
            $table->foreign('tenant_id', 'fk_refresh_activity_tenant')
                ->references('id')->on('tenants')->cascadeOnDelete();
            $table->foreign(['user_id', 'tenant_id'], 'fk_refresh_activity_user_tenant')
                ->references(['id', 'tenant_id'])->on('users')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('refresh_session_activity');
    }
};
