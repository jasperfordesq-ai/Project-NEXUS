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
 * A plan's Stripe price is remembered per currency.
 *
 * Until now one price id per interval was stored and reused for every buyer,
 * created in the currency of whoever checked out first and always with the
 * euro amount. From now on `stripe_price_id_monthly` / `_yearly` are the EURO
 * price ids (an id already stored there is kept and treated as euro), and the
 * pound price ids, created with `price_monthly_gbp` / `price_yearly_gbp`, sit
 * in the two columns added here.
 *
 * ADD COLUMN only, NULL, at the end of the table: instant, safe while the
 * other colour serves. Guarded, so running it twice changes nothing.
 */
return new class extends Migration
{
    private const COLUMNS = ['stripe_price_id_monthly_gbp', 'stripe_price_id_yearly_gbp'];

    public function up(): void
    {
        foreach (self::COLUMNS as $column) {
            if (Schema::hasColumn('pay_plans', $column)) {
                continue;
            }
            Schema::table('pay_plans', function (Blueprint $table) use ($column): void {
                $table->string($column, 255)->nullable();
            });
        }
    }

    public function down(): void
    {
        foreach (self::COLUMNS as $column) {
            if (!Schema::hasColumn('pay_plans', $column)) {
                continue;
            }
            Schema::table('pay_plans', function (Blueprint $table) use ($column): void {
                $table->dropColumn($column);
            });
        }
    }
};
