<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Explore;

use App\Models\Listing;
use App\Models\User;
use App\Services\ExploreService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use ReflectionMethod;
use Tests\Laravel\TestCase;

/**
 * The Explore page shows each theme's picture (categories.icon; AWID feedback,
 * Nov 2026: "clear categories, attractive visuals") on its theme tiles and on
 * the covers of offers and requests without a photo. ExploreService therefore
 * carries `icon` on its theme list and `category_icon` on listing rows.
 */
class ExploreThemePicturesTest extends TestCase
{
    use DatabaseTransactions;

    private function invoke(string $method, mixed ...$args): mixed
    {
        $service = app(ExploreService::class);
        $reflection = new ReflectionMethod($service, $method);
        $reflection->setAccessible(true);

        return $reflection->invoke($service, ...$args);
    }

    private function theme(?string $icon): int
    {
        return (int) DB::table('categories')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'Explore picture theme ' . uniqid(),
            'slug' => 'explore-picture-' . uniqid(),
            'type' => 'listing',
            'color' => 'green',
            'icon' => $icon,
            'is_active' => 1,
            'sort_order' => -100, // first in the list
            'created_at' => now(),
        ]);
    }

    public function test_the_theme_list_carries_each_themes_picture(): void
    {
        $id = $this->theme('garden');

        $themes = collect($this->invoke('getListingCategories', $this->testTenantId));

        $this->assertSame('garden', $themes->firstWhere('id', $id)['icon'] ?? 'missing');
    }

    public function test_popular_offers_carry_their_themes_picture(): void
    {
        $id = $this->theme('transport');
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $listing = Listing::factory()->create([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'category_id' => $id,
            'title' => 'Lifts to the hospital on Tuesdays',
            'description' => 'I can drive you to appointments at the hospital most Tuesday mornings.',
            'status' => 'active',
            'view_count' => 100000,
            'created_at' => now(),
        ]);

        $rows = collect($this->invoke('getPopularListings', $this->testTenantId));
        $row = $rows->firstWhere('id', $listing->id);

        $this->assertNotNull($row, 'the most viewed offer is among the popular ones');
        $this->assertSame('transport', $row['category_icon']);

        $paginated = collect(app(ExploreService::class)->getPopularListingsPaginated($this->testTenantId, 1, 50)['items'] ?? []);
        $this->assertSame('transport', $paginated->firstWhere('id', $listing->id)['category_icon'] ?? 'missing');
    }
}
