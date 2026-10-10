<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

final class EventDiscoveryContractTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow(Carbon::parse('2030-01-10 12:00:00', 'UTC'));
        config()->set('app.key', 'base64:HfQEDtbtr90JIXhsaAhSFWnzIo1f31VZ2e5qLqKKnls=');
        TenantContext::setById($this->testTenantId);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function authenticate(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    private function category(string $name, string $type = 'event', array $overrides = []): int
    {
        return (int) DB::table('categories')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'name' => $name,
            'slug' => strtolower(str_replace(' ', '-', $name)) . '-' . uniqid(),
            'type' => $type,
            'color' => '#2563eb',
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }

    private function series(int $creatorId, string $title, array $overrides = []): int
    {
        return (int) DB::table('event_series')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'title' => $title,
            'description' => $title . ' description',
            'created_by' => $creatorId,
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }

    private function event(int $organizerId, string $title, string $startTime, array $overrides = []): int
    {
        return (int) DB::table('events')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'user_id' => $organizerId,
            'title' => $title,
            'description' => $title . ' description',
            'location' => 'Test venue',
            'start_time' => $startTime,
            'end_time' => Carbon::parse($startTime)->addHour()->format('Y-m-d H:i:s'),
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }

    /** @return list<int> */
    private function ids(TestResponse $response): array
    {
        return array_map('intval', array_column($response->json('data') ?? [], 'id'));
    }

    private function tamper(string $cursor): string
    {
        [$body, $signature] = explode('.', $cursor, 2);
        $signature[0] = $signature[0] === 'A' ? 'B' : 'A';

        return $body . '.' . $signature;
    }

    public function test_upcoming_composite_cursor_orders_by_time_then_id_without_duplicates(): void
    {
        $organizer = $this->authenticate();
        $categoryId = $this->category('Composite ordering');
        $latestId = $this->event($organizer->id, 'Latest', '2030-02-03 10:00:00', ['category_id' => $categoryId]);
        $earliestId = $this->event($organizer->id, 'Earliest', '2030-02-01 10:00:00', ['category_id' => $categoryId]);
        $middleId = $this->event($organizer->id, 'Middle', '2030-02-02 10:00:00', ['category_id' => $categoryId]);

        $first = $this->apiGet("/v2/events?category_id={$categoryId}&per_page=1");
        $first->assertOk()->assertJsonPath('meta.has_more', true);
        $cursorOne = (string) $first->json('meta.cursor');
        $second = $this->apiGet('/v2/events?category_id=' . $categoryId . '&per_page=1&cursor=' . rawurlencode($cursorOne));
        $second->assertOk()->assertJsonPath('meta.has_more', true);
        $cursorTwo = (string) $second->json('meta.cursor');
        $third = $this->apiGet('/v2/events?category_id=' . $categoryId . '&per_page=1&cursor=' . rawurlencode($cursorTwo));
        $third->assertOk()->assertJsonPath('meta.has_more', false);

        $seen = array_merge($this->ids($first), $this->ids($second), $this->ids($third));
        $this->assertSame([$earliestId, $middleId, $latestId], $seen);
        $this->assertCount(3, array_unique($seen));
    }

    public function test_past_events_are_ordered_latest_first_with_id_tiebreaker(): void
    {
        $organizer = $this->authenticate();
        $categoryId = $this->category('Past ordering');
        $oldestId = $this->event($organizer->id, 'Oldest', '2029-12-01 10:00:00', ['category_id' => $categoryId]);
        $latestLowerId = $this->event($organizer->id, 'Latest lower id', '2030-01-09 10:00:00', ['category_id' => $categoryId]);
        $middleId = $this->event($organizer->id, 'Middle', '2030-01-01 10:00:00', ['category_id' => $categoryId]);
        $latestHigherId = $this->event($organizer->id, 'Latest higher id', '2030-01-09 10:00:00', ['category_id' => $categoryId]);

        $response = $this->apiGet("/v2/events?when=past&category_id={$categoryId}&per_page=10");

        $response->assertOk();
        $this->assertSame(
            [$latestHigherId, $latestLowerId, $middleId, $oldestId],
            $this->ids($response)
        );
    }

    public function test_tampered_legacy_and_filter_reused_cursors_fail_with_translated_422(): void
    {
        $organizer = $this->authenticate();
        $categoryA = $this->category('Cursor filter A');
        $categoryB = $this->category('Cursor filter B');
        $this->event($organizer->id, 'A one', '2030-02-01 09:00:00', ['category_id' => $categoryA]);
        $this->event($organizer->id, 'A two', '2030-02-02 09:00:00', ['category_id' => $categoryA]);

        $first = $this->apiGet("/v2/events?category_id={$categoryA}&per_page=1");
        $first->assertOk();
        $cursor = (string) $first->json('meta.cursor');

        foreach ([
            $this->tamper($cursor),
            base64_encode('123'),
        ] as $invalidCursor) {
            $this->apiGet('/v2/events?category_id=' . $categoryA . '&per_page=1&cursor=' . rawurlencode($invalidCursor))
                ->assertStatus(422)
                ->assertJsonPath('errors.0.field', 'cursor')
                ->assertJsonPath('errors.0.message', __('api.invalid_cursor'));
        }

        $this->apiGet('/v2/events?category_id=' . $categoryB . '&per_page=1&cursor=' . rawurlencode($cursor))
            ->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'cursor')
            ->assertJsonPath('errors.0.message', __('api.invalid_cursor'));
    }

    public function test_invalid_discovery_filters_fail_closed_instead_of_becoming_unfiltered_queries(): void
    {
        $this->authenticate();

        foreach ([
            ['/v2/events?when=soon', 'when'],
            ['/v2/events?category_id=not-an-id', 'category_id'],
            ['/v2/events?series_id=0', 'series_id'],
            ['/v2/events?near_lat=53.3&near_lng=-6.2&radius_km=far', 'radius_km'],
            ['/v2/events?near_lat=53.3', 'near_lat'],
        ] as [$uri, $field]) {
            $this->apiGet($uri)
                ->assertStatus(422)
                ->assertJsonPath('errors.0.field', $field);
        }
    }

    public function test_recurring_collapse_ignores_inactive_siblings_and_counts_only_active_occurrences(): void
    {
        $organizer = $this->authenticate();
        $categoryId = $this->category('Recurrence status');
        $otherCategoryId = $this->category('Recurrence sibling filter');
        $templateId = $this->event($organizer->id, 'Active template', '2030-02-07 10:00:00', [
            'category_id' => $categoryId,
            'is_recurring_template' => 1,
        ]);
        $this->event($organizer->id, 'Cancelled earlier child', '2030-02-03 10:00:00', [
            'category_id' => $categoryId,
            'parent_event_id' => $templateId,
            'status' => 'cancelled',
        ]);
        $this->event($organizer->id, 'Draft earlier child', '2030-02-04 10:00:00', [
            'category_id' => $categoryId,
            'parent_event_id' => $templateId,
            'status' => 'draft',
        ]);
        $this->event($organizer->id, 'Active earlier child in another category', '2030-02-02 10:00:00', [
            'category_id' => $otherCategoryId,
            'parent_event_id' => $templateId,
        ]);
        $this->event($organizer->id, 'Active later child', '2030-02-14 10:00:00', [
            'category_id' => $categoryId,
            'parent_event_id' => $templateId,
        ]);

        $response = $this->apiGet("/v2/events?category_id={$categoryId}&per_page=10");

        $response->assertOk();
        $this->assertSame([$templateId], $this->ids($response));
        $response->assertJsonPath('data.0.is_series', true)
            ->assertJsonPath('data.0.series_count', 3);
    }

    public function test_a_wholly_cancelled_series_still_shows_one_card_carrying_its_state(): void
    {
        $organizer = $this->authenticate();
        $categoryId = $this->category('Cancelled series');
        $cancelled = [
            'category_id' => $categoryId,
            'status' => 'cancelled',
            'publication_status' => 'published',
            'operational_status' => 'cancelled',
        ];
        $templateId = $this->event($organizer->id, 'Cancelled template', '2030-03-07 10:00:00', $cancelled + [
            'is_recurring_template' => 1,
        ]);
        $firstChildId = $this->event($organizer->id, 'Cancelled first child', '2030-03-03 10:00:00', $cancelled + [
            'parent_event_id' => $templateId,
        ]);
        $this->event($organizer->id, 'Cancelled later child', '2030-03-14 10:00:00', $cancelled + [
            'parent_event_id' => $templateId,
        ]);

        $response = $this->apiGet("/v2/events?category_id={$categoryId}&per_page=10");

        $response->assertOk();
        // One card per series — the next occurrence — instead of the series
        // vanishing because every occurrence's legacy mirror is 'cancelled'.
        $this->assertSame([$firstChildId], $this->ids($response));
    }

    public function test_category_endpoint_unifies_singular_and_plural_event_types_and_filter_uses_ids(): void
    {
        $organizer = $this->authenticate();
        $singularId = $this->category('Singular event category', 'event');
        $pluralId = $this->category('Legacy plural event category', 'events');
        $inactiveId = $this->category('Inactive event category', 'event', ['is_active' => 0]);
        DB::table('tenants')->insertOrIgnore([
            'id' => 998,
            'name' => 'Discovery isolation tenant',
            'slug' => 'discovery-isolation-tenant',
            'is_active' => true,
            'depth' => 0,
            'allows_subtenants' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $otherTenantCategoryId = (int) DB::table('categories')->insertGetId([
            'tenant_id' => 998,
            'name' => 'Other tenant event category',
            'slug' => 'other-tenant-event-category',
            'type' => 'events',
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $pluralEventId = $this->event($organizer->id, 'Plural category event', '2030-02-01 10:00:00', [
            'category_id' => $pluralId,
        ]);

        $categories = $this->apiGet('/v2/categories?type=event');
        $categories->assertOk();
        $rows = collect($categories->json('data'));
        $this->assertTrue($rows->contains('id', $singularId));
        $this->assertTrue($rows->contains('id', $pluralId));
        $this->assertFalse($rows->contains('id', $inactiveId));
        $this->assertFalse($rows->contains('id', $otherTenantCategoryId));
        $this->assertSame(['event'], $rows->pluck('type')->unique()->values()->all());

        $filtered = $this->apiGet("/v2/events?category_id={$pluralId}&per_page=10");
        $filtered->assertOk();
        $this->assertSame([$pluralEventId], $this->ids($filtered));
        $filtered->assertJsonPath('data.0.category.id', $pluralId);
    }

    public function test_series_id_filter_is_tenant_scoped_and_returns_only_matching_events(): void
    {
        $organizer = $this->authenticate();
        $categoryId = $this->category('Series filter');
        $seriesA = $this->series($organizer->id, 'Series A');
        $seriesB = $this->series($organizer->id, 'Series B');
        $eventA = $this->event($organizer->id, 'Series A event', '2030-02-01 10:00:00', [
            'category_id' => $categoryId,
            'series_id' => $seriesA,
        ]);
        $this->event($organizer->id, 'Series B event', '2030-02-02 10:00:00', [
            'category_id' => $categoryId,
            'series_id' => $seriesB,
        ]);
        $this->event($organizer->id, 'No series event', '2030-02-03 10:00:00', [
            'category_id' => $categoryId,
        ]);

        $response = $this->apiGet("/v2/events?series_id={$seriesA}&per_page=10");

        $response->assertOk();
        $this->assertSame([$eventA], $this->ids($response));
    }

    public function test_proximity_cursor_orders_by_distance_start_and_id_without_offsets(): void
    {
        $organizer = $this->authenticate();
        $categoryId = $this->category('Proximity cursor');
        $farId = $this->event($organizer->id, 'Farther event', '2030-02-01 09:00:00', [
            'category_id' => $categoryId,
            'latitude' => 53.38000000,
            'longitude' => -6.26030000,
        ]);
        $samePointLaterId = $this->event($organizer->id, 'Same point later', '2030-02-03 09:00:00', [
            'category_id' => $categoryId,
            'latitude' => 53.34980000,
            'longitude' => -6.26030000,
        ]);
        $samePointEarlierId = $this->event($organizer->id, 'Same point earlier', '2030-02-02 09:00:00', [
            'category_id' => $categoryId,
            'latitude' => 53.34980000,
            'longitude' => -6.26030000,
        ]);

        $base = "/v2/events/nearby?lat=53.3498&lon=-6.2603&radius_km=10&category_id={$categoryId}&per_page=1";
        $first = $this->apiGet($base);
        $first->assertOk()->assertJsonPath('meta.has_more', true);
        $cursorOne = (string) $first->json('meta.cursor');
        $second = $this->apiGet($base . '&cursor=' . rawurlencode($cursorOne));
        $second->assertOk()->assertJsonPath('meta.has_more', true);
        $cursorTwo = (string) $second->json('meta.cursor');
        $third = $this->apiGet($base . '&cursor=' . rawurlencode($cursorTwo));
        $third->assertOk()->assertJsonPath('meta.has_more', false);

        $seen = array_merge($this->ids($first), $this->ids($second), $this->ids($third));
        $this->assertSame([$samePointEarlierId, $samePointLaterId, $farId], $seen);
        $this->assertCount(3, array_unique($seen));

        $this->apiGet(str_replace('lat=53.3498', 'lat=53.3500', $base) . '&cursor=' . rawurlencode($cursorOne))
            ->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'cursor');
    }

    public function test_series_listing_uses_signed_created_at_and_id_cursor_and_active_counts(): void
    {
        $organizer = $this->authenticate();
        $newestId = $this->series($organizer->id, 'Newest series', ['created_at' => '2030-01-03 10:00:00']);
        $oldestId = $this->series($organizer->id, 'Oldest series', ['created_at' => '2030-01-01 10:00:00']);
        $middleId = $this->series($organizer->id, 'Middle series', ['created_at' => '2030-01-02 10:00:00']);
        $this->event($organizer->id, 'Active series event', '2030-02-01 10:00:00', ['series_id' => $newestId]);
        $this->event($organizer->id, 'Cancelled series event', '2030-02-02 10:00:00', [
            'series_id' => $newestId,
            'status' => 'cancelled',
        ]);

        $first = $this->apiGet('/v2/events/series?per_page=1');
        $first->assertOk()->assertJsonPath('meta.has_more', true)
            ->assertJsonPath('data.0.id', $newestId)
            ->assertJsonPath('data.0.event_count', 1);
        $cursorOne = (string) $first->json('meta.cursor');
        $second = $this->apiGet('/v2/events/series?per_page=1&cursor=' . rawurlencode($cursorOne));
        $second->assertOk()->assertJsonPath('data.0.id', $middleId);
        $cursorTwo = (string) $second->json('meta.cursor');
        $third = $this->apiGet('/v2/events/series?per_page=1&cursor=' . rawurlencode($cursorTwo));
        $third->assertOk()->assertJsonPath('data.0.id', $oldestId)
            ->assertJsonPath('meta.has_more', false);

        $this->apiGet('/v2/events/series?per_page=1&cursor=' . rawurlencode($this->tamper($cursorOne)))
            ->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'cursor');
    }
}
