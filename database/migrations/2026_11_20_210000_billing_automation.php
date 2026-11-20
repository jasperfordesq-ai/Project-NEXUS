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
 * The daily billing check (20 Nov 2026, Stage 3b).
 *
 * `platform_billing_settings` holds the platform team's numbers for the check
 * (the master switch, the day counts, the member-limit percent). A missing row
 * means the default in App\Support\Billing\BillingSettings, so the table starts
 * empty and the check starts switched off.
 *
 * `tenant_billing_standing` gains why a community is paused (`non_payment` or
 * `over_limit`, so settling one never lifts the other) and the member-limit
 * clock's memory: since when it has been over, and which notice was sent last.
 *
 * A new table and `ADD COLUMN` on a Stage 1 table that is small (one row per
 * community at most), all nullable or defaulted: safe while the other colour
 * is serving.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('platform_billing_settings')) {
            Schema::create('platform_billing_settings', function (Blueprint $table): void {
                $table->string('setting_key', 60)->primary();
                $table->string('setting_value', 255);
                $table->unsignedInteger('updated_by_user_id')->nullable();
                $table->timestamps();
            });
        }

        $columns = [
            'suspension_reason' => static fn (Blueprint $table) => $table->string('suspension_reason', 30)->nullable()->after('suspension_note'),
            'over_limit_since' => static fn (Blueprint $table) => $table->date('over_limit_since')->nullable()->after('last_notice_at'),
            'limit_notice_stage' => static fn (Blueprint $table) => $table->string('limit_notice_stage', 30)->nullable()->after('over_limit_since'),
            'limit_notice_at' => static fn (Blueprint $table) => $table->timestamp('limit_notice_at')->nullable()->after('limit_notice_stage'),
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
        Schema::dropIfExists('platform_billing_settings');

        foreach (['limit_notice_at', 'limit_notice_stage', 'over_limit_since', 'suspension_reason'] as $column) {
            if (Schema::hasColumn('tenant_billing_standing', $column)) {
                Schema::table('tenant_billing_standing', function (Blueprint $table) use ($column): void {
                    $table->dropColumn($column);
                });
            }
        }
    }
};
