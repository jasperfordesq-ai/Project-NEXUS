<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * MarketplaceCategorySeeder — Seeds default marketplace categories.
 *
 * These are system-level categories (tenant_id = NULL) available to all tenants.
 * Individual tenants can also create their own tenant-scoped categories.
 *
 * Usage:
 *   php artisan db:seed --class=MarketplaceCategorySeeder
 */
class MarketplaceCategorySeeder extends Seeder
{
    public function run(): void
    {
        $categories = [
            ['name' => 'Electronics', 'icon' => 'Smartphone', 'sort_order' => 1],
            ['name' => 'Furniture', 'icon' => 'Armchair', 'sort_order' => 2],
            ['name' => 'Clothing & Accessories', 'icon' => 'Shirt', 'sort_order' => 3],
            ['name' => 'Home & Garden', 'icon' => 'Home', 'sort_order' => 4],
            ['name' => 'Vehicles', 'icon' => 'Car', 'sort_order' => 5],
            ['name' => 'Sports & Outdoors', 'icon' => 'Bike', 'sort_order' => 6],
            ['name' => 'Books & Media', 'icon' => 'BookOpen', 'sort_order' => 7],
            ['name' => 'Toys & Games', 'icon' => 'Gamepad2', 'sort_order' => 8],
            ['name' => 'Baby & Kids', 'icon' => 'Baby', 'sort_order' => 9],
            ['name' => 'Health & Beauty', 'icon' => 'Heart', 'sort_order' => 10],
            ['name' => 'Pet Supplies', 'icon' => 'Dog', 'sort_order' => 11],
            ['name' => 'Musical Instruments', 'icon' => 'Music', 'sort_order' => 12],
            ['name' => 'Office Supplies', 'icon' => 'Briefcase', 'sort_order' => 13],
            ['name' => 'Arts & Crafts', 'icon' => 'Palette', 'sort_order' => 14],
            ['name' => 'Food & Drink', 'icon' => 'UtensilsCrossed', 'sort_order' => 15],
            ['name' => 'Services', 'icon' => 'Wrench', 'sort_order' => 16],
            ['name' => 'Free Items', 'icon' => 'Gift', 'sort_order' => 17],
            // Marketplace & Freecycle (17 Oct 2026): a home for the things
            // people most often lend rather than sell. Lending itself is a
            // listing type (price_type = lend), so this category simply groups
            // tools, DIY and garden kit whatever the listing type.
            ['name' => 'Tools & Equipment', 'icon' => 'Hammer', 'sort_order' => 18],
            ['name' => 'Other', 'icon' => 'Package', 'sort_order' => 99],
        ];

        foreach ($categories as $cat) {
            $slug = Str::slug($cat['name']);

            // Skip if already exists (idempotent)
            $exists = DB::table('marketplace_categories')
                ->whereNull('tenant_id')
                ->where('slug', $slug)
                ->exists();

            if (!$exists) {
                DB::table('marketplace_categories')->insert([
                    'tenant_id' => null,
                    'name' => $cat['name'],
                    'slug' => $slug,
                    'description' => null,
                    'icon' => $cat['icon'],
                    'parent_id' => null,
                    'sort_order' => $cat['sort_order'],
                    'is_active' => true,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }
        }

        $this->command->info('Marketplace categories seeded: ' . count($categories) . ' system categories.');
    }
}
