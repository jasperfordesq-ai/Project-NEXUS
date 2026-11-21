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
 * Stripe prices a plan used to sell at (21 Nov 2026).
 *
 * A Stripe price cannot be edited, so when the platform team changes a plan's
 * price a new Stripe price replaces the stored id. A community already paying
 * by card stays on the old price, and Stripe keeps reporting it in
 * subscription updates; this table is how such a price is still recognised as
 * its plan. Rows are only ever inserted.
 *
 * A new, empty table. Nothing existing is altered, so the migration is safe to
 * run while the other colour is serving.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('pay_plan_stripe_prices')) {
            return;
        }

        Schema::create('pay_plan_stripe_prices', function (Blueprint $table): void {
            $table->bigIncrements('id');
            // Signed int to match pay_plans.id. No foreign key: deleting a
            // plan must not be blocked by, or erase, the record of its prices.
            $table->integer('pay_plan_id');
            $table->string('stripe_price_id', 255)->unique('uniq_ppsp_price');
            $table->char('currency', 3);
            // `interval` is a reserved word in MariaDB.
            $table->string('billing_interval', 10);
            $table->decimal('amount', 10, 2);
            $table->timestamp('retired_at')->nullable();
            $table->index('pay_plan_id', 'idx_ppsp_plan');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pay_plan_stripe_prices');
    }
};
