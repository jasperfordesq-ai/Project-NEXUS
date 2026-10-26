<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Members can now report another member, or a message they received, to their
 * community's coordinators (safeguarding gap found 26 Oct 2026).
 *
 * - `category`: the reason the member chose from a fixed list
 *   (e.g. safeguarding_concern), so staff can sort and prioritise. Older rows
 *   keep NULL and carry their reason in `reason` as before.
 * - `target_snapshot`: the words of a reported message as they were when it
 *   was reported, so the sender cannot edit or delete the evidence away.
 *
 * Adding nullable columns at the end is an instant, metadata-only change on
 * MariaDB 10.11. No existing row changes.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('reports')) {
            return;
        }

        Schema::table('reports', function (Blueprint $table) {
            if (! Schema::hasColumn('reports', 'category')) {
                $table->string('category', 40)->nullable();
            }
            if (! Schema::hasColumn('reports', 'target_snapshot')) {
                $table->text('target_snapshot')->nullable();
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('reports')) {
            return;
        }

        Schema::table('reports', function (Blueprint $table) {
            foreach (['target_snapshot', 'category'] as $column) {
                if (Schema::hasColumn('reports', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
