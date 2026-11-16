<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Search;

use App\Contracts\SearchDocumentIndexer;
use App\Models\User;
use App\Services\SearchReindexService;
use App\Support\UserDisplayName;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * The "select and index" loops that used to live in
 * `scripts/sync_search_index.php`, now in SearchReindexService.
 *
 * 🔴 Characterisation: `scriptRows()` below is the script's SQL and row
 * handling copied VERBATIM from the script as it was on 16 Nov 2026, before
 * anything moved. The service must hand the search indexer exactly what that
 * code produced, row for row, for every kind of entry. Change one and the
 * other on purpose, never by accident.
 *
 * No test here talks to a search server: SearchService's methods are static,
 * so the service sends rows through the SearchDocumentIndexer seam and these
 * tests bind a recording fake in its place.
 */
class SearchReindexServiceTest extends TestCase
{
    use DatabaseTransactions;

    /** @var list<array{0: string, 1: array<string, mixed>}> */
    private array $sent = [];

    /** @var array<string, int> type => id that must throw */
    private array $failOn = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->sent = [];
        $this->failOn = [];
        $test = $this;
        $this->app->instance(SearchDocumentIndexer::class, new class ($test) implements SearchDocumentIndexer {
            public function __construct(private readonly SearchReindexServiceTest $test)
            {
            }

            public function index(string $type, array $row): void
            {
                $this->test->record($type, $row);
            }

            public function reachable(): bool
            {
                return true;
            }
        });
    }

    /** @internal called by the fake indexer */
    public function record(string $type, array $row): void
    {
        if (isset($this->failOn[$type]) && (int) $row['id'] === $this->failOn[$type]) {
            throw new \RuntimeException("planted failure for {$type} {$row['id']}");
        }
        $this->sent[] = [$type, $row];
    }

    /** @return array<string, int> */
    private function plant(int $tenantId): array
    {
        $owner = User::factory()->forTenant($tenantId)->create(['status' => 'active', 'first_name' => 'Reindex', 'last_name' => 'Owner']);
        $categoryId = DB::table('categories')->insertGetId([
            'tenant_id' => $tenantId, 'name' => 'Reindex cat', 'slug' => 'reindex-cat-' . uniqid(),
        ]);
        $listing = DB::table('listings')->insertGetId([
            'tenant_id' => $tenantId, 'user_id' => $owner->id, 'title' => 'Reindex listing', 'type' => 'offer',
            'description' => 'Body', 'status' => 'active', 'category_id' => $categoryId, 'created_at' => now(),
        ]);
        foreach (['woodwork', 'baking'] as $tag) {
            DB::table('listing_skill_tags')->insert(['tenant_id' => $tenantId, 'listing_id' => $listing, 'tag' => $tag]);
        }
        $hiddenListing = DB::table('listings')->insertGetId([
            'tenant_id' => $tenantId, 'user_id' => $owner->id, 'title' => 'Closed listing', 'type' => 'offer', 'status' => 'closed',
        ]);
        $event = DB::table('events')->insertGetId([
            'tenant_id' => $tenantId, 'user_id' => $owner->id, 'title' => 'Reindex event', 'description' => 'Soon',
            'start_time' => now()->addDays(5), 'status' => 'active', 'created_at' => now(),
        ]);
        $pastEvent = DB::table('events')->insertGetId([
            'tenant_id' => $tenantId, 'user_id' => $owner->id, 'title' => 'Past event', 'description' => 'Gone',
            'start_time' => now()->subDays(5), 'status' => 'active',
        ]);
        $group = DB::table('groups')->insertGetId([
            'tenant_id' => $tenantId, 'owner_id' => $owner->id, 'name' => 'Reindex group', 'is_active' => 1, 'created_at' => now(),
        ]);
        $hiddenGroup = DB::table('groups')->insertGetId([
            'tenant_id' => $tenantId, 'owner_id' => $owner->id, 'name' => 'Closed group', 'is_active' => 0,
        ]);
        $market = DB::table('marketplace_listings')->insertGetId([
            'tenant_id' => $tenantId, 'user_id' => $owner->id, 'title' => 'Reindex chair', 'description' => 'Oak',
            'price' => '12.50', 'status' => 'active', 'moderation_status' => 'approved', 'created_at' => now(),
        ]);
        $pendingMarket = DB::table('marketplace_listings')->insertGetId([
            'tenant_id' => $tenantId, 'user_id' => $owner->id, 'title' => 'Pending chair', 'description' => 'Oak',
            'status' => 'active', 'moderation_status' => 'pending',
        ]);

        return compact('listing', 'hiddenListing', 'event', 'pastEvent', 'group', 'hiddenGroup', 'market', 'pendingMarket') + ['user' => (int) $owner->id];
    }

    /**
     * 🔴 VERBATIM from scripts/sync_search_index.php (16 Nov 2026, before the
     * move): the five SELECTs and the row handling after each.
     *
     * @return list<array<string, mixed>>
     */
    private function scriptRows(string $type, int $tenantId): array
    {
        switch ($type) {
            case 'listing':
                $rows = array_map(fn($r) => (array) $r, DB::select(
                    "SELECT l.id, l.tenant_id, l.user_id, l.category_id, l.type,
                l.title, l.description, l.location, l.status,
                UNIX_TIMESTAMP(l.created_at) as created_at,
                " . UserDisplayName::sql('u', 'author_name') . ",
                COALESCE(c.name, '') as category_name,
                GROUP_CONCAT(lst.tag ORDER BY lst.tag SEPARATOR ',') as skill_tags_csv
         FROM listings l
         LEFT JOIN users u ON l.user_id = u.id
         LEFT JOIN categories c ON c.id = l.category_id
         LEFT JOIN listing_skill_tags lst ON lst.listing_id = l.id
         WHERE l.tenant_id = ? AND l.status = 'active'
         GROUP BY l.id, l.tenant_id, l.user_id, l.category_id, l.type,
                  l.title, l.description, l.location, l.status, l.created_at,
                  u.first_name, u.last_name, c.name
         ORDER BY l.id",
                    [$tenantId]
                ));

                return array_map(function (array $row): array {
                    $row['skill_tags'] = array_values(array_filter(explode(',', $row['skill_tags_csv'] ?? '')));
                    unset($row['skill_tags_csv']);
                    return $row;
                }, $rows);

            case 'user':
                return array_map(fn($r) => (array) $r, DB::select(
                    "SELECT id, tenant_id, first_name, last_name, organization_name,
                profile_type, bio, skills, location, avatar_url, status,
                UNIX_TIMESTAMP(created_at) as created_at
         FROM users
         WHERE tenant_id = ? AND status = 'active'
         ORDER BY id",
                    [$tenantId]
                ));

            case 'event':
                return array_map(fn($r) => (array) $r, DB::select(
                    "SELECT e.id, e.tenant_id, e.title, e.description, e.location,
                COALESCE(e.status, 'active') as status,
                e.publication_status,
                e.operational_status,
                e.is_recurring_template,
                e.allow_remote_attendance as is_online,
                UNIX_TIMESTAMP(COALESCE(e.start_time, e.start_date)) as start_time,
                UNIX_TIMESTAMP(e.created_at) as created_at,
                " . UserDisplayName::sql('u', 'organizer_name') . "
         FROM events e
         LEFT JOIN users u ON e.user_id = u.id AND e.tenant_id = u.tenant_id
         WHERE e.tenant_id = ?
           AND COALESCE(e.start_time, e.start_date) >= NOW()
           AND COALESCE(e.is_recurring_template, 0) = 0
           AND (
               (
                   COALESCE(e.status, 'active') = 'active'
                   AND (e.publication_status IS NULL OR e.publication_status = 'published')
                   AND (e.operational_status IS NULL OR e.operational_status = 'scheduled')
               )
               OR (
                   e.status = 'cancelled'
                   AND (e.publication_status IS NULL OR e.publication_status = 'published')
                   AND e.operational_status = 'postponed'
               )
           )
         ORDER BY e.id",
                    [$tenantId]
                ));

            case 'group':
                return array_map(fn($r) => (array) $r, DB::select(
                    "SELECT g.id, g.tenant_id, g.name, g.description,
                IF(g.is_active, 'active', 'inactive') as status,
                g.visibility as privacy,
                COALESCE(g.cached_member_count, 0) as members_count,
                UNIX_TIMESTAMP(g.created_at) as created_at
         FROM `groups` g
         WHERE g.tenant_id = ? AND g.is_active = 1
         ORDER BY g.id",
                    [$tenantId]
                ));

            case 'marketplace':
                $rows = array_map(fn($r) => (array) $r, DB::select(
                    "SELECT ml.id, ml.tenant_id, ml.category_id,
                ml.title, ml.description, ml.tagline, ml.location,
                ml.price, ml.price_type, ml.`condition`, ml.seller_type,
                ml.delivery_method, ml.status, ml.moderation_status,
                UNIX_TIMESTAMP(ml.created_at) as created_at
         FROM marketplace_listings ml
         WHERE ml.tenant_id = ?
           AND ml.status = 'active'
           AND ml.moderation_status = 'approved'
         ORDER BY ml.id",
                    [$tenantId]
                ));

                return array_map(function (array $row): array {
                    $row['price'] = (float) ($row['price'] ?? 0);
                    $row['category_id'] = $row['category_id'] ? (int) $row['category_id'] : null;
                    return $row;
                }, $rows);
        }

        throw new \LogicException($type);
    }

    /** @return list<array<string, mixed>> */
    private function sentOf(string $type): array
    {
        return array_values(array_map(
            static fn (array $call): array => $call[1],
            array_filter($this->sent, static fn (array $call): bool => $call[0] === $type),
        ));
    }

    private function service(): SearchReindexService
    {
        return $this->app->make(SearchReindexService::class);
    }

    public function test_each_row_reaches_the_right_index_with_exactly_the_data_the_script_produced(): void
    {
        $tenant = $this->testTenantId;
        $ids = $this->plant($tenant);

        $result = $this->service()->reindexTenant($tenant);

        $this->assertSame(['listing', 'user', 'event', 'group', 'marketplace'], array_keys($result));
        foreach (['listing', 'user', 'event', 'group', 'marketplace'] as $type) {
            $expected = $this->scriptRows($type, $tenant);
            $this->assertSame($expected, $this->sentOf($type), "the {$type} rows sent differ from the script's");
            $this->assertSame(['rows' => count($expected), 'indexed' => count($expected), 'errors' => 0], $result[$type]);
        }

        // The planted rows are among them, and the ones the script left out are not.
        $sentIds = fn (string $type): array => array_map(static fn (array $r): int => (int) $r['id'], $this->sentOf($type));
        $this->assertContains($ids['listing'], $sentIds('listing'));
        $this->assertNotContains($ids['hiddenListing'], $sentIds('listing'));
        $this->assertContains($ids['user'], $sentIds('user'));
        $this->assertContains($ids['event'], $sentIds('event'));
        $this->assertNotContains($ids['pastEvent'], $sentIds('event'));
        $this->assertContains($ids['group'], $sentIds('group'));
        $this->assertNotContains($ids['hiddenGroup'], $sentIds('group'));
        $this->assertContains($ids['market'], $sentIds('marketplace'));
        $this->assertNotContains($ids['pendingMarket'], $sentIds('marketplace'));

        $listing = collect($this->sentOf('listing'))->firstWhere('id', $ids['listing']);
        $this->assertSame(['baking', 'woodwork'], $listing['skill_tags']);
        $this->assertArrayNotHasKey('skill_tags_csv', $listing);
        $market = collect($this->sentOf('marketplace'))->firstWhere('id', $ids['market']);
        $this->assertSame(12.5, $market['price']);
    }

    public function test_only_the_chosen_community_is_read(): void
    {
        $other = (int) DB::table('tenants')->where('id', '!=', $this->testTenantId)->orderBy('id')->value('id');
        $this->assertGreaterThan(0, $other, 'the test database needs a second community');
        $foreign = $this->plant($other);

        $this->service()->reindexTenant($this->testTenantId);

        foreach ($this->sent as [$type, $row]) {
            $this->assertSame($this->testTenantId, (int) $row['tenant_id'], "a {$type} row from another community was sent");
        }
        $this->assertNotContains($foreign['listing'], array_map(static fn (array $r): int => (int) $r['id'], $this->sentOf('listing')));
    }

    public function test_a_row_that_cannot_be_indexed_is_counted_and_the_rest_carry_on(): void
    {
        $ids = $this->plant($this->testTenantId);
        $this->failOn['listing'] = $ids['listing'];
        $events = [];

        $result = $this->service()->reindexTenant($this->testTenantId, null, false, function (string $kind, ...$args) use (&$events): void {
            $events[] = [$kind, ...$args];
        });

        $rows = count($this->scriptRows('listing', $this->testTenantId));
        $this->assertSame(['rows' => $rows, 'indexed' => $rows - 1, 'errors' => 1], $result['listing']);
        $this->assertSame(0, $result['group']['errors']);
        $this->assertContains($ids['group'], array_map(static fn (array $r): int => (int) $r['id'], $this->sentOf('group')), 'later kinds still ran');
        $this->assertContains(['error', 'listing', $ids['listing'], "planted failure for listing {$ids['listing']}"], $events);
        $this->assertContains(['done', 'listings', $rows - 1, 1], $events);
    }

    public function test_type_limits_the_run_to_one_kind_of_entry(): void
    {
        $this->plant($this->testTenantId);

        $result = $this->service()->reindexTenant($this->testTenantId, 'group');

        $this->assertSame(['group'], array_keys($result));
        $this->assertSame(['group'], array_values(array_unique(array_map(static fn (array $c): string => $c[0], $this->sent))));
    }

    public function test_a_dry_run_counts_rows_and_sends_nothing(): void
    {
        $this->plant($this->testTenantId);

        $result = $this->service()->reindexTenant($this->testTenantId, null, true);

        $this->assertSame([], $this->sent);
        $this->assertSame(count($this->scriptRows('group', $this->testTenantId)), $result['group']['rows']);
        $this->assertSame(0, $result['group']['indexed']);
    }

    public function test_the_progress_lines_follow_the_scripts_order(): void
    {
        $events = [];
        $this->service()->reindexTenant(987654321, null, false, function (string $kind, ...$args) use (&$events): void {
            $events[] = [$kind, ...$args];
        });

        $this->assertSame([
            ['empty', 'listings'],
            ['empty', 'users'],
            ['empty', 'events'],
            ['empty', 'groups'],
            ['empty', 'marketplace_listings'],
        ], $events);
    }

    public function test_an_unknown_type_is_refused(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->service()->reindexTenant($this->testTenantId, 'bogus');
    }
}
