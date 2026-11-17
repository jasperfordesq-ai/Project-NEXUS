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
 * An index for the nightly clean-up of `push_log` (Nov 2026).
 *
 * `nexus:prune-logs` now deletes push_log rows older than 180 days across
 * EVERY community (WHERE created_at < ...). All existing indexes on the table
 * lead with `tenant_id` or another column, so that delete would read the whole
 * table every night. An index on `created_at` alone lets it go straight to the
 * old rows.
 *
 * Read-path only: no row is rewritten. Adding a secondary index to an InnoDB
 * table is an online operation (the table stays readable and writable), so
 * this is safe while the other blue/green colour is serving.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('push_log')
            && ! Schema::hasIndex('push_log', 'idx_push_log_created_at')) {
            Schema::table('push_log', function (Blueprint $table): void {
                $table->index('created_at', 'idx_push_log_created_at');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('push_log')
            && Schema::hasIndex('push_log', 'idx_push_log_created_at')) {
            Schema::table('push_log', function (Blueprint $table): void {
                $table->dropIndex('idx_push_log_created_at');
            });
        }
    }
};
