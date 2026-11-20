<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

use App\Support\Billing\StandardPlans;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The seven standard packages, sized by active members (owner, 20 Nov 2026;
 * DESIGN §11). The numbers come from App\Support\Billing\StandardPlans::TIERS.
 *
 * The older plans are retired, never changed: each is switched off and its
 * slug prefixed `legacy-`, and nothing else about it moves. A community already
 * on one keeps exactly the price and member limit it had, and its assignment
 * keeps pointing at the same row. No row is deleted. Where an older plan holds
 * a slug a standard package needs (`community`, `network`), it becomes
 * `legacy-<slug>-<id>` so the standard row can take the plain slug.
 *
 * Columns are only added, each with a default or NULL, at the end of the
 * table, so the change is instant and safe while the other colour serves.
 *
 * Idempotent: every column is guarded, and a standard row that already exists
 * is left alone, so running it twice inserts nothing twice.
 */
return new class extends Migration
{
    private const SLUG_MAX = 50;

    public function up(): void
    {
        $this->addColumns();

        DB::transaction(function (): void {
            $this->retireOlderPlans();
            $this->insertStandardPlans();
        });
    }

    public function down(): void
    {
        if (!Schema::hasColumn('pay_plans', 'is_standard')) {
            return;
        }

        // The legacy renames stay: undoing them could collide with the plain
        // slugs, and a retired plan that stays retired harms nobody.
        foreach (StandardPlans::slugs() as $slug) {
            $id = DB::table('pay_plans')->where('slug', $slug)->where('is_standard', 1)->value('id');
            if ($id === null) {
                continue;
            }
            if (DB::table('tenant_plan_assignments')->where('pay_plan_id', $id)->exists()) {
                continue;
            }
            DB::table('pay_plans')->where('id', $id)->delete();
        }
    }

    private function addColumns(): void
    {
        $columns = [
            'is_standard' => fn (Blueprint $t) => $t->boolean('is_standard')->default(false),
            'price_monthly_gbp' => fn (Blueprint $t) => $t->decimal('price_monthly_gbp', 10, 2)->nullable(),
            'price_yearly_gbp' => fn (Blueprint $t) => $t->decimal('price_yearly_gbp', 10, 2)->nullable(),
            // Euro, like price_monthly / price_yearly.
            'setup_fee' => fn (Blueprint $t) => $t->decimal('setup_fee', 10, 2)->default(0),
            'setup_fee_gbp' => fn (Blueprint $t) => $t->decimal('setup_fee_gbp', 10, 2)->nullable(),
            // Recorded and shown, not enforced: only the member limit is acted on.
            'max_communities' => fn (Blueprint $t) => $t->unsignedInteger('max_communities')->nullable(),
            'storage_gb' => fn (Blueprint $t) => $t->unsignedInteger('storage_gb')->nullable(),
            'emails_per_month' => fn (Blueprint $t) => $t->unsignedInteger('emails_per_month')->nullable(),
        ];

        foreach ($columns as $name => $define) {
            if (Schema::hasColumn('pay_plans', $name)) {
                continue;
            }
            Schema::table('pay_plans', function (Blueprint $table) use ($define): void {
                $define($table);
            });
        }
    }

    private function retireOlderPlans(): void
    {
        $standardSlugs = StandardPlans::slugs();

        $older = DB::table('pay_plans')
            ->where('is_standard', 0)
            ->orderBy('id')
            ->get(['id', 'slug', 'is_active']);

        foreach ($older as $plan) {
            $id = (int) $plan->id;
            $slug = (string) $plan->slug;

            if (str_starts_with($slug, 'legacy-')) {
                $newSlug = $slug;
            } elseif (in_array($slug, $standardSlugs, true)) {
                $newSlug = $this->withIdSuffix($slug, $id);
            } else {
                $newSlug = 'legacy-' . $slug;
                $taken = DB::table('pay_plans')->where('slug', $newSlug)->where('id', '!=', $id)->exists();
                if ($taken || strlen($newSlug) > self::SLUG_MAX) {
                    $newSlug = $this->withIdSuffix($slug, $id);
                }
            }

            if ($newSlug === $slug && (int) $plan->is_active === 0) {
                continue;
            }

            // Slug and the on/off switch only: price, limit and every
            // assignment pointing at this row are deliberately untouched.
            DB::table('pay_plans')->where('id', $id)->update([
                'slug' => $newSlug,
                'is_active' => 0,
                'updated_at' => now(),
            ]);
        }
    }

    /** `legacy-<slug>-<id>`, shortening the slug so it fits the column. */
    private function withIdSuffix(string $slug, int $id): string
    {
        $suffix = '-' . $id;
        $room = self::SLUG_MAX - strlen('legacy-') - strlen($suffix);

        return 'legacy-' . substr($slug, 0, max(1, $room)) . $suffix;
    }

    private function insertStandardPlans(): void
    {
        foreach (StandardPlans::TIERS as $slug => $tier) {
            if (DB::table('pay_plans')->where('slug', $slug)->exists()) {
                continue;
            }

            DB::table('pay_plans')->insert([
                'name' => $tier['name'],
                'slug' => $slug,
                'description' => $tier['description'],
                'tier_level' => $tier['tier_level'],
                'features' => '[]',
                'max_users' => $tier['max_users'],
                'price_monthly' => $tier['price_monthly'],
                'price_yearly' => $tier['price_yearly'],
                'setup_fee' => $tier['setup_fee'],
                'price_monthly_gbp' => $tier['price_monthly_gbp'],
                'price_yearly_gbp' => $tier['price_yearly_gbp'],
                'setup_fee_gbp' => $tier['setup_fee_gbp'],
                'max_communities' => $tier['max_communities'],
                'storage_gb' => $tier['storage_gb'],
                'emails_per_month' => $tier['emails_per_month'],
                'is_standard' => 1,
                'is_active' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }
};
