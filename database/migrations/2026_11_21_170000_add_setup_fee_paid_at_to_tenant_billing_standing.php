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
 * When a community's one-off setup fee was taken by card.
 *
 * A plan's setup fee is added to a community's first card payment and never
 * again. "First" has to be remembered somewhere that survives a cancelled
 * subscription and a later one: this column. NULL = no setup fee has been
 * taken by card (which is also true of every community that paid one outside
 * the platform; those are recognised by having a payment on record).
 *
 * ADD COLUMN only, NULL, at the end of the table: instant, safe while the
 * other colour serves. Guarded, so running it twice changes nothing.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasColumn('tenant_billing_standing', 'setup_fee_paid_at')) {
            return;
        }

        Schema::table('tenant_billing_standing', function (Blueprint $table): void {
            $table->timestamp('setup_fee_paid_at')->nullable();
        });
    }

    public function down(): void
    {
        if (!Schema::hasColumn('tenant_billing_standing', 'setup_fee_paid_at')) {
            return;
        }

        Schema::table('tenant_billing_standing', function (Blueprint $table): void {
            $table->dropColumn('setup_fee_paid_at');
        });
    }
};
