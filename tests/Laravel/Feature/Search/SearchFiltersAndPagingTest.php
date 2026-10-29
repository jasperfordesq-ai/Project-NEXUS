<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Search;

use App\Core\TenantContext;
use App\Models\Listing;
use App\Models\User;
use App\Services\SearchService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use ReflectionProperty;
use Tests\Laravel\TestCase;

/**
 * Both websites send `date_from`, `date_to` and `location` with a search, and
 * page with the cursor; Laravel ignored all of them and never returned a next
 * page (29 Oct 2026). Searching one type now pages, and dates and location filter
 * listings (location also filters events; members are never filtered by place,
 * which would reveal a hidden location).
 */
final class SearchFiltersAndPagingTest extends TestCase
{
    use DatabaseTransactions;

    private ReflectionProperty $availability;

    private mixed $original;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
        $this->availability = new ReflectionProperty(SearchService::class, 'available');
        $this->availability->setAccessible(true);
        $this->original = $this->availability->getValue();
        $this->availability->setValue(null, false);
    }

    protected function tearDown(): void
    {
        $this->availability->setValue(null, $this->original);
        parent::tearDown();
    }

    public function test_one_type_search_pages_and_filters_by_date_and_place(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        Sanctum::actingAs($owner, ['*']);
        $make = fn (string $title, string $place, string $created) => Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $owner->id, 'title' => $title, 'location' => $place, 'status' => 'active',
            'moderation_status' => null, 'created_at' => $created,
        ])->id;
        $old = $make('Zqsearch bikes old', 'Cork', '2026-01-10 10:00:00');
        $corkNew = $make('Zqsearch bikes new', 'Cork', '2026-06-10 10:00:00');
        $galway = $make('Zqsearch bikes west', 'Galway', '2026-06-12 10:00:00');

        $ids = fn ($response): array => array_map('intval', array_column($response->json('data') ?? [], 'id'));

        $page1 = $this->apiGet('/v2/search?q=Zqsearch&type=listings&per_page=2&sort=newest');
        $page1->assertOk();
        $this->assertSame([$galway, $corkNew], $ids($page1));
        $this->assertTrue((bool) $page1->json('meta.pagination.has_more'));
        $cursor = $page1->json('meta.pagination.cursor');
        $this->assertNotEmpty($cursor);
        $page2 = $this->apiGet('/v2/search?q=Zqsearch&type=listings&per_page=2&sort=newest&cursor=' . urlencode($cursor));
        $this->assertSame([$old], $ids($page2));
        $this->assertFalse((bool) $page2->json('meta.pagination.has_more'));

        $this->assertSame([$galway, $corkNew], $ids($this->apiGet('/v2/search?q=Zqsearch&type=listings&sort=newest&date_from=2026-06-01')));
        $this->assertSame([$old], $ids($this->apiGet('/v2/search?q=Zqsearch&type=listings&date_to=2026-02-01')));
        $this->assertSame([$galway], $ids($this->apiGet('/v2/search?q=Zqsearch&type=listings&location=galway')));
    }
}
