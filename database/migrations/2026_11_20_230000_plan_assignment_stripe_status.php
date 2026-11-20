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
 * Remember what Stripe last said about a card subscription, word for word.
 *
 * `tenant_plan_assignments.status` folds Stripe's `past_due`, `unpaid`,
 * `incomplete`, `incomplete_expired` and `paused` into one value, `expired`.
 * The daily billing check has to tell them apart: while Stripe is still
 * retrying a card (`past_due`, `incomplete`) a community is not paused for
 * non-payment; once Stripe has given up it is. This column keeps Stripe's own
 * status so that question has an answer.
 *
 * NULL means Stripe has not told us anything since this column was added, or
 * the assignment has no Stripe subscription.
 *
 * ADD COLUMN only, NULL, at the end of the table: instant, safe while the
 * other colour serves. Guarded, so running it twice changes nothing.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasColumn('tenant_plan_assignments', 'stripe_status')) {
            return;
        }

        Schema::table('tenant_plan_assignments', function (Blueprint $table): void {
            $table->string('stripe_status', 30)->nullable();
        });
    }

    public function down(): void
    {
        if (!Schema::hasColumn('tenant_plan_assignments', 'stripe_status')) {
            return;
        }

        Schema::table('tenant_plan_assignments', function (Blueprint $table): void {
            $table->dropColumn('stripe_status');
        });
    }
};
