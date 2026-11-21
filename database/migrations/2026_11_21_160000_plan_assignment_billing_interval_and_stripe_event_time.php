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
 * Two facts about a card subscription that were kept nowhere.
 *
 * `billing_interval` (`monthly` | `yearly`): whether the community pays by the
 * month or by the year. Its own billing page showed "Unknown interval" for
 * everyone, because the answer was only ever in Stripe. Written when a
 * checkout completes and whenever Stripe reports the subscription's price.
 * NULL = not known (a plan given by hand, or a subscription from before this
 * column).
 *
 * `stripe_event_at`: when Stripe created the newest subscription event applied
 * to this record. Stripe redelivers an event whose handler failed, sometimes
 * hours later; without this, a redelivered "payment failed" was written over
 * the "paid" that had arrived in between. An event older than this time is
 * not applied. NULL = nothing applied since this column was added.
 *
 * ADD COLUMN only, NULL, at the end of the table: instant, safe while the
 * other colour serves. Guarded, so running it twice changes nothing.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('tenant_plan_assignments', 'billing_interval')) {
            Schema::table('tenant_plan_assignments', function (Blueprint $table): void {
                $table->string('billing_interval', 10)->nullable();
            });
        }

        if (!Schema::hasColumn('tenant_plan_assignments', 'stripe_event_at')) {
            Schema::table('tenant_plan_assignments', function (Blueprint $table): void {
                $table->timestamp('stripe_event_at')->nullable();
            });
        }
    }

    public function down(): void
    {
        foreach (['stripe_event_at', 'billing_interval'] as $column) {
            if (Schema::hasColumn('tenant_plan_assignments', $column)) {
                Schema::table('tenant_plan_assignments', function (Blueprint $table) use ($column): void {
                    $table->dropColumn($column);
                });
            }
        }
    }
};
