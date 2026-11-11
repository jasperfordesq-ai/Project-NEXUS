<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Services\ExploreService;
use App\Services\MatchLearningService;
use App\Services\SmartMatchingEngine;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Tests\Laravel\TestCase;

/**
 * Unit tests for ExploreService — aggregation + caching logic.
 *
 * These tests mock DB and Cache facades to isolate service logic
 * without hitting a real database.
 */
class ExploreServiceTest extends TestCase
{
    private ExploreService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $mockEngine = \Mockery::mock(SmartMatchingEngine::class);
        $mockEngine->shouldReceive('findMatchesForUser')->andReturn([]);
        $mockLearning = \Mockery::mock(MatchLearningService::class);
        $mockLearning->shouldReceive('getHistoricalBoost')->andReturn(0.0);
        $mockLearning->shouldReceive('recordInteraction')->andReturn(true);
        $this->service = new ExploreService($mockEngine, $mockLearning);
    }

    // ------------------------------------------------------------------
    //  getExploreData()
    // ------------------------------------------------------------------

    public function test_getExploreData_returns_all_sections(): void
    {
        // Per-section caching: each section checks its own cache key
        Cache::shouldReceive('get')->andReturn(null);
        Cache::shouldReceive('put')->zeroOrMoreTimes();

        // DB calls for all sections — return empty
        DB::shouldReceive('select')->andReturn([]);
        DB::shouldReceive('selectOne')->andReturn((object) ['cnt' => 0, 'total' => 0]);
        DB::shouldReceive('table')->andReturn(\Mockery::mock(\Illuminate\Database\Query\Builder::class, function ($mock) {
            $mock->shouldReceive('where')->andReturnSelf();
            $mock->shouldReceive('pluck')->andReturn(collect([]));
            $mock->shouldReceive('get')->andReturn(collect([]));
        }));

        $result = $this->service->getExploreData(1);

        $this->assertIsArray($result);
        // Original sections
        $this->assertArrayHasKey('trending_posts', $result);
        $this->assertArrayHasKey('popular_listings', $result);
        $this->assertArrayHasKey('active_groups', $result);
        $this->assertArrayHasKey('upcoming_events', $result);
        $this->assertArrayHasKey('top_contributors', $result);
        $this->assertArrayHasKey('trending_hashtags', $result);
        $this->assertArrayHasKey('new_members', $result);
        $this->assertArrayHasKey('featured_challenges', $result);
        $this->assertArrayHasKey('community_stats', $result);
        $this->assertArrayHasKey('recommended_listings', $result);
        // Phase 1+2 new sections
        $this->assertArrayHasKey('near_you_listings', $result);
        $this->assertArrayHasKey('suggested_connections', $result);
        $this->assertArrayHasKey('trending_blog_posts', $result);
        $this->assertArrayHasKey('volunteering_opportunities', $result);
        $this->assertArrayHasKey('active_organisations', $result);
        $this->assertArrayHasKey('active_polls', $result);
        $this->assertArrayHasKey('in_demand_skills', $result);
        $this->assertArrayHasKey('featured_resources', $result);
        $this->assertArrayHasKey('latest_jobs', $result);
        // Phase 5 — categories included
        $this->assertArrayHasKey('categories', $result);
    }

    public function test_getExploreData_uses_per_section_cache(): void
    {
        // When a section is cached, it returns cached data without DB query
        $cachedListings = [['id' => 1, 'title' => 'Cached listing']];

        Cache::shouldReceive('get')
            ->with("nexus:explore:{$this->testTenantId}:popular_listings")
            ->andReturn($cachedListings);

        // Other sections: cache miss
        Cache::shouldReceive('get')->andReturn(null);
        Cache::shouldReceive('put')->zeroOrMoreTimes();

        DB::shouldReceive('select')->andReturn([]);
        DB::shouldReceive('selectOne')->andReturn((object) ['cnt' => 0, 'total' => 0]);
        DB::shouldReceive('table')->andReturn(\Mockery::mock(\Illuminate\Database\Query\Builder::class, function ($mock) {
            $mock->shouldReceive('where')->andReturnSelf();
            $mock->shouldReceive('pluck')->andReturn(collect([]));
            $mock->shouldReceive('get')->andReturn(collect([]));
        }));

        $result = $this->service->getExploreData(1);

        $this->assertEquals($cachedListings, $result['popular_listings']);
    }

    public function test_getExploreData_rejects_unauthenticated_user_id(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->service->getExploreData(0);
    }

    // ------------------------------------------------------------------
    //  getTrendingPostsPaginated()
    // ------------------------------------------------------------------

    public function test_getTrendingPostsPaginated_returns_paginated_structure(): void
    {
        DB::shouldReceive('selectOne')
            ->once()
            ->andReturn((object) ['cnt' => 3]);

        DB::shouldReceive('select')
            ->once()
            ->andReturn([
                (object) [
                    'id' => 1,
                    'user_id' => 10,
                    'excerpt' => 'Post content',
                    'image_url' => null,
                    'created_at' => '2026-03-20 12:00:00',
                    'author_first_name' => 'John',
                    'author_last_name' => 'Doe',
                    'author_avatar' => null,
                    'likes_count' => 5,
                    'comments_count' => 2,
                ],
            ]);

        $result = $this->service->getTrendingPostsPaginated($this->testTenantId, 99, 1, 20);

        $this->assertArrayHasKey('items', $result);
        $this->assertArrayHasKey('total', $result);
        $this->assertArrayHasKey('page', $result);
        $this->assertArrayHasKey('per_page', $result);
        $this->assertEquals(3, $result['total']);
        $this->assertEquals(1, $result['page']);
        $this->assertEquals(20, $result['per_page']);
        $this->assertCount(1, $result['items']);
    }

    public function test_getTrendingPostsPaginated_maps_fields_correctly(): void
    {
        DB::shouldReceive('selectOne')
            ->andReturn((object) ['cnt' => 1]);

        DB::shouldReceive('select')
            ->andReturn([
                (object) [
                    'id' => 42,
                    'user_id' => 7,
                    'excerpt' => 'Great community event!',
                    'image_url' => '/uploads/img.jpg',
                    'created_at' => '2026-03-22 10:00:00',
                    'author_first_name' => 'Jane',
                    'author_last_name' => 'Smith',
                    'author_avatar' => '/avatars/jane.jpg',
                    'likes_count' => '12',
                    'comments_count' => '3',
                ],
            ]);

        $result = $this->service->getTrendingPostsPaginated($this->testTenantId, 99);
        $item = $result['items'][0];

        $this->assertEquals(42, $item['id']);
        $this->assertEquals(7, $item['user_id']);
        $this->assertEquals('Great community event!', $item['excerpt']);
        $this->assertEquals('Jane', $item['author_name']); // E-122: Explore names members by first name only
        $this->assertSame(12, $item['likes_count']);
        $this->assertSame(3, $item['comments_count']);
    }

    public function test_getTrendingPostsPaginated_calculates_offset(): void
    {
        DB::shouldReceive('selectOne')
            ->andReturn((object) ['cnt' => 50]);

        // Verify the offset is calculated as (page-1) * perPage = (3-1)*10 = 20
        DB::shouldReceive('select')
            ->withArgs(function ($query, $params) {
                // Last two params should be perPage=10, offset=20
                return $params[count($params) - 2] === 10 && $params[count($params) - 1] === 20;
            })
            ->andReturn([]);

        $result = $this->service->getTrendingPostsPaginated($this->testTenantId, 99, 3, 10);

        $this->assertEquals(3, $result['page']);
        $this->assertEquals(10, $result['per_page']);
    }

    public function test_getTrendingPostsPaginated_handles_db_error_gracefully(): void
    {
        DB::shouldReceive('selectOne')
            ->andThrow(new \RuntimeException('DB connection lost'));

        Log::shouldReceive('warning')
            ->once()
            ->withArgs(function ($msg) {
                return str_contains($msg, 'getTrendingPostsPaginated');
            });

        $result = $this->service->getTrendingPostsPaginated($this->testTenantId, 99);

        $this->assertEquals([], $result['items']);
        $this->assertEquals(0, $result['total']);
        $this->assertEquals(1, $result['page']);
        $this->assertEquals(20, $result['per_page']);
    }

    // ------------------------------------------------------------------
    //  getPopularListingsPaginated()
    // ------------------------------------------------------------------

    public function test_getPopularListingsPaginated_returns_paginated_structure(): void
    {
        DB::shouldReceive('selectOne')
            ->once()
            ->andReturn((object) ['cnt' => 5]);

        DB::shouldReceive('select')
            ->once()
            ->andReturn([
                (object) [
                    'id' => 1,
                    'title' => 'Garden Help',
                    'type' => 'offer',
                    'description' => 'Help with gardening tasks',
                    'image_url' => null,
                    'location' => 'Dublin',
                    'estimated_hours' => 2.0,
                    'created_at' => '2026-03-20',
                    'view_count' => 30,
                    'save_count' => 5,
                    'category_name' => 'Gardening',
                    'category_slug' => 'gardening',
                    'category_color' => '#22c55e',
                    'author_first_name' => 'Alice',
                    'author_last_name' => 'Brown',
                    'author_avatar' => null,
                ],
            ]);

        $result = $this->service->getPopularListingsPaginated($this->testTenantId, 1, 20);

        $this->assertArrayHasKey('items', $result);
        $this->assertArrayHasKey('total', $result);
        $this->assertEquals(5, $result['total']);
        $this->assertCount(1, $result['items']);
    }

    public function test_getPopularListingsPaginated_maps_listing_fields(): void
    {
        DB::shouldReceive('selectOne')
            ->andReturn((object) ['cnt' => 1]);

        DB::shouldReceive('select')
            ->andReturn([
                (object) [
                    'id' => 99,
                    'title' => 'Dog Walking',
                    'type' => 'request',
                    'description' => 'Need someone to walk my dog in the park',
                    'image_url' => '/uploads/dog.jpg',
                    'location' => 'Cork',
                    'estimated_hours' => 1.5,
                    'created_at' => '2026-03-21',
                    'view_count' => '45',
                    'save_count' => '8',
                    'category_name' => 'Pets',
                    'category_slug' => 'pets',
                    'category_color' => '#f59e0b',
                    'author_first_name' => 'Bob',
                    'author_last_name' => 'Wilson',
                    'author_avatar' => '/avatars/bob.png',
                ],
            ]);

        $result = $this->service->getPopularListingsPaginated($this->testTenantId);
        $item = $result['items'][0];

        $this->assertEquals(99, $item['id']);
        $this->assertEquals('Dog Walking', $item['title']);
        $this->assertEquals('request', $item['type']);
        $this->assertEquals('Bob', $item['author_name']); // E-122: first name only
        $this->assertSame(45, $item['view_count']);
        $this->assertSame(8, $item['save_count']);
        $this->assertEquals('Pets', $item['category_name']);
        $this->assertEquals('#f59e0b', $item['category_color']);
    }

    public function test_getPopularListingsPaginated_truncates_description(): void
    {
        DB::shouldReceive('selectOne')
            ->andReturn((object) ['cnt' => 1]);

        $longDescription = str_repeat('A', 300);

        DB::shouldReceive('select')
            ->andReturn([
                (object) [
                    'id' => 1,
                    'title' => 'Test',
                    'type' => 'offer',
                    'description' => $longDescription,
                    'image_url' => null,
                    'location' => null,
                    'estimated_hours' => null,
                    'created_at' => '2026-03-20',
                    'view_count' => 0,
                    'save_count' => 0,
                    'category_name' => '',
                    'category_slug' => '',
                    'category_color' => null,
                    'author_first_name' => 'Test',
                    'author_last_name' => 'User',
                    'author_avatar' => null,
                ],
            ]);

        $result = $this->service->getPopularListingsPaginated($this->testTenantId);
        $item = $result['items'][0];

        $this->assertLessThanOrEqual(200, mb_strlen($item['description']));
    }

    public function test_getPopularListingsPaginated_handles_null_description(): void
    {
        DB::shouldReceive('selectOne')
            ->andReturn((object) ['cnt' => 1]);

        DB::shouldReceive('select')
            ->andReturn([
                (object) [
                    'id' => 1,
                    'title' => 'Test',
                    'type' => 'offer',
                    'description' => null,
                    'image_url' => null,
                    'location' => null,
                    'estimated_hours' => null,
                    'created_at' => '2026-03-20',
                    'view_count' => 0,
                    'save_count' => 0,
                    'category_name' => '',
                    'category_slug' => '',
                    'category_color' => null,
                    'author_first_name' => 'Test',
                    'author_last_name' => 'User',
                    'author_avatar' => null,
                ],
            ]);

        $result = $this->service->getPopularListingsPaginated($this->testTenantId);
        $this->assertNull($result['items'][0]['description']);
    }

    public function test_getPopularListingsPaginated_handles_db_error_gracefully(): void
    {
        DB::shouldReceive('selectOne')
            ->andThrow(new \RuntimeException('Connection timeout'));

        Log::shouldReceive('warning')
            ->once()
            ->withArgs(function ($msg) {
                return str_contains($msg, 'getPopularListingsPaginated');
            });

        $result = $this->service->getPopularListingsPaginated($this->testTenantId, 2, 15);

        $this->assertEquals([], $result['items']);
        $this->assertEquals(0, $result['total']);
        $this->assertEquals(2, $result['page']);
        $this->assertEquals(15, $result['per_page']);
    }

    // ------------------------------------------------------------------
    //  getListingsByCategory()
    // ------------------------------------------------------------------

    public function test_getListingsByCategory_returns_category_not_found(): void
    {
        DB::shouldReceive('selectOne')
            ->once()
            ->andReturn(null); // Category not found

        $result = $this->service->getListingsByCategory($this->testTenantId, 'nonexistent');

        $this->assertNull($result['category']);
        $this->assertEquals([], $result['items']);
        $this->assertEquals(0, $result['total']);
    }

    public function test_getListingsByCategory_returns_category_with_listings(): void
    {
        // First selectOne: find the category
        DB::shouldReceive('selectOne')
            ->once()
            ->andReturn((object) ['id' => 5, 'name' => 'Gardening', 'slug' => 'gardening', 'color' => '#22c55e']);

        // Second selectOne: total count of listings in category
        DB::shouldReceive('selectOne')
            ->once()
            ->andReturn((object) ['cnt' => 2]);

        // select: actual listings
        DB::shouldReceive('select')
            ->once()
            ->andReturn([
                (object) [
                    'id' => 10,
                    'title' => 'Lawn Mowing',
                    'type' => 'offer',
                    'description' => 'I can mow your lawn',
                    'image_url' => null,
                    'location' => 'Galway',
                    'estimated_hours' => 1.0,
                    'created_at' => '2026-03-20',
                    'view_count' => 15,
                    'author_first_name' => 'Tom',
                    'author_last_name' => 'Green',
                    'author_avatar' => null,
                ],
            ]);

        $result = $this->service->getListingsByCategory($this->testTenantId, 'gardening');

        $this->assertNotNull($result['category']);
        $this->assertEquals('Gardening', $result['category']['name']);
        $this->assertEquals('gardening', $result['category']['slug']);
        $this->assertEquals('#22c55e', $result['category']['color']);
        $this->assertEquals(2, $result['total']);
        $this->assertCount(1, $result['items']);
        $this->assertEquals('Lawn Mowing', $result['items'][0]['title']);
        $this->assertEquals('Tom', $result['items'][0]['author_name']); // E-122: first name only
    }

    public function test_getListingsByCategory_calculates_pagination(): void
    {
        DB::shouldReceive('selectOne')
            ->once()
            ->andReturn((object) ['id' => 5, 'name' => 'Tech', 'slug' => 'tech', 'color' => '#3b82f6']);

        DB::shouldReceive('selectOne')
            ->once()
            ->andReturn((object) ['cnt' => 25]);

        DB::shouldReceive('select')
            ->withArgs(function ($query, $params) {
                // Last two params: perPage=10, offset=10 (page 2)
                return $params[count($params) - 2] === 10 && $params[count($params) - 1] === 10;
            })
            ->andReturn([]);

        $result = $this->service->getListingsByCategory($this->testTenantId, 'tech', 2, 10);

        $this->assertEquals(2, $result['page']);
        $this->assertEquals(10, $result['per_page']);
        $this->assertEquals(25, $result['total']);
    }

    public function test_getListingsByCategory_handles_db_error_gracefully(): void
    {
        DB::shouldReceive('selectOne')
            ->andThrow(new \RuntimeException('Table does not exist'));

        Log::shouldReceive('warning')
            ->once()
            ->withArgs(function ($msg) {
                return str_contains($msg, 'getListingsByCategory');
            });

        $result = $this->service->getListingsByCategory($this->testTenantId, 'anything');

        $this->assertNull($result['category']);
        $this->assertEquals([], $result['items']);
        $this->assertEquals(0, $result['total']);
    }

    public function test_getListingsByCategory_truncates_description_to_200(): void
    {
        DB::shouldReceive('selectOne')
            ->once()
            ->andReturn((object) ['id' => 1, 'name' => 'Test', 'slug' => 'test', 'color' => null]);

        DB::shouldReceive('selectOne')
            ->once()
            ->andReturn((object) ['cnt' => 1]);

        $longDescription = str_repeat('B', 300);

        DB::shouldReceive('select')
            ->andReturn([
                (object) [
                    'id' => 1,
                    'title' => 'Long Desc',
                    'type' => 'offer',
                    'description' => $longDescription,
                    'image_url' => null,
                    'location' => null,
                    'estimated_hours' => null,
                    'created_at' => '2026-03-20',
                    'view_count' => 0,
                    'author_first_name' => 'A',
                    'author_last_name' => 'B',
                    'author_avatar' => null,
                ],
            ]);

        $result = $this->service->getListingsByCategory($this->testTenantId, 'test');

        $this->assertLessThanOrEqual(200, mb_strlen($result['items'][0]['description']));
    }

    // ------------------------------------------------------------------
    //  Error resilience — private methods that catch exceptions
    // ------------------------------------------------------------------

    public function test_getExploreData_returns_empty_sections_on_db_failure(): void
    {
        Cache::shouldReceive('get')->andReturn(null);

        // All DB calls throw
        DB::shouldReceive('select')->andThrow(new \RuntimeException('DB down'));
        DB::shouldReceive('selectOne')->andThrow(new \RuntimeException('DB down'));
        DB::shouldReceive('table')->andThrow(new \RuntimeException('DB down'));

        // Failed sections log via debug/warning/error depending on the path
        // (cache-miss debug lines, section warnings, community-stats errors).
        Log::shouldReceive('debug')->zeroOrMoreTimes();
        Log::shouldReceive('warning')->zeroOrMoreTimes();
        Log::shouldReceive('error')->zeroOrMoreTimes();

        Cache::shouldReceive('put')->zeroOrMoreTimes();

        $result = $this->service->getExploreData(1);

        // All sections should exist even if empty
        $this->assertArrayHasKey('trending_posts', $result);
        $this->assertArrayHasKey('community_stats', $result);
        $this->assertEquals([], $result['trending_posts']);
        // community_stats returns zeroed structure on failure
        $this->assertEquals(0, $result['community_stats']['total_members']);
    }

    // ------------------------------------------------------------------
    //  getForYouFeed()
    // ------------------------------------------------------------------

    public function test_getForYouFeed_returns_paginated_structure(): void
    {
        Cache::shouldReceive('get')->andReturn(null);
        Cache::shouldReceive('put')->zeroOrMoreTimes();
        DB::shouldReceive('select')->andReturn([]);
        DB::shouldReceive('selectOne')->andReturn((object) ['cnt' => 0, 'total' => 0]);
        DB::shouldReceive('table')->andReturn(\Mockery::mock(\Illuminate\Database\Query\Builder::class, function ($mock) {
            $mock->shouldReceive('where')->andReturnSelf();
            $mock->shouldReceive('pluck')->andReturn(collect([]));
            $mock->shouldReceive('get')->andReturn(collect([]));
        }));

        $result = $this->service->getForYouFeed($this->testTenantId, 1, 1, 20);

        $this->assertArrayHasKey('items', $result);
        $this->assertArrayHasKey('total', $result);
        $this->assertArrayHasKey('page', $result);
        $this->assertArrayHasKey('per_page', $result);
        $this->assertEquals(1, $result['page']);
        $this->assertEquals(20, $result['per_page']);
    }

    public function test_getForYouFeed_rejects_unauthenticated_user_id(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->service->getForYouFeed($this->testTenantId, 0, 1, 20);
    }

    public function test_getForYouFeed_handles_db_error_gracefully(): void
    {
        Cache::shouldReceive('get')->andReturn(null);
        DB::shouldReceive('select')->andThrow(new \RuntimeException('DB down'));
        DB::shouldReceive('selectOne')->andThrow(new \RuntimeException('DB down'));
        DB::shouldReceive('table')->andThrow(new \RuntimeException('DB down'));
        Log::shouldReceive('warning')->zeroOrMoreTimes();
        Cache::shouldReceive('put')->zeroOrMoreTimes();

        $result = $this->service->getForYouFeed($this->testTenantId, 1, 1, 20);

        $this->assertEquals([], $result['items']);
        $this->assertEquals(0, $result['total']);
    }

    // ------------------------------------------------------------------
    //  Tenant scoping
    // ------------------------------------------------------------------

    public function test_getTrendingPostsPaginated_passes_tenant_id_to_query(): void
    {
        $tenantId = 42;

        DB::shouldReceive('selectOne')
            ->withArgs(function ($query, $params) use ($tenantId) {
                return in_array($tenantId, $params);
            })
            ->andReturn((object) ['cnt' => 0]);

        DB::shouldReceive('select')
            ->withArgs(function ($query, $params) use ($tenantId) {
                return in_array($tenantId, $params);
            })
            ->andReturn([]);

        $result = $this->service->getTrendingPostsPaginated($tenantId, 123);

        $this->assertEquals(0, $result['total']);
    }

    public function test_getPopularListingsPaginated_passes_tenant_id_to_query(): void
    {
        $tenantId = 77;

        DB::shouldReceive('selectOne')
            ->withArgs(function ($query, $params) use ($tenantId) {
                return in_array($tenantId, $params);
            })
            ->andReturn((object) ['cnt' => 0]);

        DB::shouldReceive('select')
            ->withArgs(function ($query, $params) use ($tenantId) {
                return in_array($tenantId, $params);
            })
            ->andReturn([]);

        $result = $this->service->getPopularListingsPaginated($tenantId);

        $this->assertEquals(0, $result['total']);
    }

    public function test_getListingsByCategory_passes_tenant_id_to_category_lookup(): void
    {
        $tenantId = 55;

        DB::shouldReceive('selectOne')
            ->withArgs(function ($query, $params) use ($tenantId) {
                return $params[0] === $tenantId;
            })
            ->once()
            ->andReturn(null);

        $result = $this->service->getListingsByCategory($tenantId, 'gardening');

        $this->assertNull($result['category']);
    }

    // ------------------------------------------------------------------
    //  Author name trimming
    // ------------------------------------------------------------------

    public function test_getTrendingPostsPaginated_trims_author_name(): void
    {
        DB::shouldReceive('selectOne')
            ->andReturn((object) ['cnt' => 1]);

        DB::shouldReceive('select')
            ->andReturn([
                (object) [
                    'id' => 1,
                    'user_id' => 1,
                    'excerpt' => 'Test',
                    'image_url' => null,
                    'created_at' => '2026-03-20',
                    'author_first_name' => '  Jane  ',
                    'author_last_name' => '  Doe  ',
                    'author_avatar' => null,
                    'likes_count' => 0,
                    'comments_count' => 0,
                ],
            ]);

        $result = $this->service->getTrendingPostsPaginated($this->testTenantId, 99);
        // trim() on "  Jane     Doe  " = "Jane     Doe" (inner spaces preserved, outer trimmed)
        $this->assertStringStartsNotWith(' ', $result['items'][0]['author_name']);
        $this->assertStringEndsNotWith(' ', $result['items'][0]['author_name']);
    }

    // ------------------------------------------------------------------
    //  Integer casting
    // ------------------------------------------------------------------

    public function test_getTrendingPostsPaginated_casts_counts_to_int(): void
    {
        DB::shouldReceive('selectOne')
            ->andReturn((object) ['cnt' => '10']);

        DB::shouldReceive('select')
            ->andReturn([
                (object) [
                    'id' => 1,
                    'user_id' => 1,
                    'excerpt' => 'Test',
                    'image_url' => null,
                    'created_at' => '2026-03-20',
                    'author_first_name' => 'A',
                    'author_last_name' => 'B',
                    'author_avatar' => null,
                    'likes_count' => '7',
                    'comments_count' => '3',
                ],
            ]);

        $result = $this->service->getTrendingPostsPaginated($this->testTenantId, 99);

        $this->assertIsInt($result['total']);
        $this->assertIsInt($result['items'][0]['likes_count']);
        $this->assertIsInt($result['items'][0]['comments_count']);
    }

    public function test_getPopularListingsPaginated_casts_counts_to_int(): void
    {
        DB::shouldReceive('selectOne')
            ->andReturn((object) ['cnt' => '5']);

        DB::shouldReceive('select')
            ->andReturn([
                (object) [
                    'id' => 1,
                    'title' => 'Test',
                    'type' => 'offer',
                    'description' => null,
                    'image_url' => null,
                    'location' => null,
                    'estimated_hours' => null,
                    'created_at' => '2026-03-20',
                    'view_count' => '99',
                    'save_count' => '12',
                    'category_name' => '',
                    'category_slug' => '',
                    'category_color' => null,
                    'author_first_name' => 'A',
                    'author_last_name' => 'B',
                    'author_avatar' => null,
                ],
            ]);

        $result = $this->service->getPopularListingsPaginated($this->testTenantId);

        $this->assertIsInt($result['total']);
        $this->assertIsInt($result['items'][0]['view_count']);
        $this->assertIsInt($result['items'][0]['save_count']);
    }
}
