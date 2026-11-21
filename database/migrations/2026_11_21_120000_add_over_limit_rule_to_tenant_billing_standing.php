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
 * The rule for going over a plan's member number (21 Nov 2026, Stage 4).
 *
 * `over_limit_action` / `over_limit_grace_days`: the community's own rule and
 * day count. `children_over_limit_action` / `children_over_limit_grace_days`:
 * the default a hub sets for the communities that pay it. Null everywhere =
 * follow the next level up (App\Support\Billing\OverLimitRule).
 *
 * Four nullable `ADD COLUMN`s appended to a small table (one row per community
 * at most): safe while the other colour is serving.
 */
return new class extends Migration
{
    public function up(): void
    {
        $columns = [
            'over_limit_action' => static fn (Blueprint $table) => $table->string('over_limit_action', 20)->nullable(),
            'over_limit_grace_days' => static fn (Blueprint $table) => $table->unsignedSmallInteger('over_limit_grace_days')->nullable(),
            'children_over_limit_action' => static fn (Blueprint $table) => $table->string('children_over_limit_action', 20)->nullable(),
            'children_over_limit_grace_days' => static fn (Blueprint $table) => $table->unsignedSmallInteger('children_over_limit_grace_days')->nullable(),
        ];

        foreach ($columns as $column => $add) {
            if (!Schema::hasColumn('tenant_billing_standing', $column)) {
                Schema::table('tenant_billing_standing', function (Blueprint $table) use ($add): void {
                    $add($table);
                });
            }
        }
    }

    public function down(): void
    {
        foreach (['children_over_limit_grace_days', 'children_over_limit_action', 'over_limit_grace_days', 'over_limit_action'] as $column) {
            if (Schema::hasColumn('tenant_billing_standing', $column)) {
                Schema::table('tenant_billing_standing', function (Blueprint $table) use ($column): void {
                    $table->dropColumn($column);
                });
            }
        }
    }
};
