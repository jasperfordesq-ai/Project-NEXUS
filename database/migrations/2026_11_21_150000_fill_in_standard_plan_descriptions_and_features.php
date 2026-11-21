<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

use App\Support\Billing\StandardPlans;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The seven standard packages said too little about themselves (owner, 21 Nov
 * 2026): the description was the pricing page's "Best for" line alone, with no
 * member number, and the list of what a package includes was empty.
 *
 * This fills both in from App\Support\Billing\StandardPlans, for the rows the
 * earlier migration (2026_11_20_200000) already wrote:
 *
 *  - `description` becomes "101 to 300 active members. Best for …", but ONLY
 *    where it still reads exactly as first written. A description the platform
 *    team has since edited by hand is left alone.
 *  - `features` becomes the tier's allowances, its support line and what every
 *    managed plan includes, but ONLY where the list is still empty.
 *
 * Prices, setup fees, member numbers and allowances are not touched: they were
 * already right. Two UPDATEs per row on a seven-row table, no schema change,
 * so it is safe while the other colour serves.
 *
 * Idempotent: a second run matches nothing. A fresh database, whose first
 * migration already writes the fuller description, only has its empty feature
 * lists filled.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('pay_plans') || !Schema::hasColumn('pay_plans', 'is_standard')) {
            return;
        }

        foreach (StandardPlans::TIERS as $slug => $tier) {
            DB::table('pay_plans')
                ->where('slug', $slug)
                ->where('is_standard', 1)
                ->where('description', StandardPlans::FIRST_DESCRIPTIONS[$slug])
                ->update(['description' => $tier['description'], 'updated_at' => now()]);

            DB::table('pay_plans')
                ->where('slug', $slug)
                ->where('is_standard', 1)
                ->where(function ($q): void {
                    $q->whereNull('features')
                        ->orWhere('features', '')
                        ->orWhere('features', '[]');
                })
                ->update([
                    'features' => json_encode(StandardPlans::features($slug), JSON_UNESCAPED_UNICODE),
                    'updated_at' => now(),
                ]);
        }
    }

    public function down(): void
    {
        if (!Schema::hasTable('pay_plans') || !Schema::hasColumn('pay_plans', 'is_standard')) {
            return;
        }

        // Only what this migration wrote is put back: a row edited since keeps
        // its text.
        foreach (StandardPlans::TIERS as $slug => $tier) {
            DB::table('pay_plans')
                ->where('slug', $slug)
                ->where('is_standard', 1)
                ->where('description', $tier['description'])
                ->update(['description' => StandardPlans::FIRST_DESCRIPTIONS[$slug], 'updated_at' => now()]);

            DB::table('pay_plans')
                ->where('slug', $slug)
                ->where('is_standard', 1)
                ->where('features', json_encode(StandardPlans::features($slug), JSON_UNESCAPED_UNICODE))
                ->update(['features' => '[]', 'updated_at' => now()]);
        }
    }
};
