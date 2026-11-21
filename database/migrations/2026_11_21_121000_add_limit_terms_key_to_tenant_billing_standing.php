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
 * The terms a community's days-over count is running under (21 Nov 2026,
 * hub plans Stage 4, fix round 1).
 *
 * `limit_terms_key` is OverLimitRule::termsKey(): the effective rule, its
 * days, the member number and the plan. When the daily check finds it
 * different from the present terms, the count starts again with a fresh
 * notice, whatever route changed the terms. Null = no terms recorded yet.
 *
 * One nullable `ADD COLUMN` appended to a small table: safe while the other
 * colour is serving.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('tenant_billing_standing', 'limit_terms_key')) {
            Schema::table('tenant_billing_standing', function (Blueprint $table): void {
                $table->string('limit_terms_key', 64)->nullable();
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('tenant_billing_standing', 'limit_terms_key')) {
            Schema::table('tenant_billing_standing', function (Blueprint $table): void {
                $table->dropColumn('limit_terms_key');
            });
        }
    }
};
