<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\PlatformTeam;

use App\Services\PlatformTeam\PlatformFiguresCache;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * The six platform team pages that count across every community keep their
 * figures for five minutes (16 Nov 2026). `?refresh=1` asks for fresh ones
 * (six a minute per person); every reply says when its figures were worked
 * out (`generated_at`). A reply with a part that could not be read is kept
 * for 30 seconds only, and a computation that failed is never kept.
 */
class PlatformFiguresCacheTest extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
    }

    /**
     * Each page, and a table only its own counting reads (never read while
     * signing the caller in).
     *
     * @return array<string, array{0: string, 1: string}>
     */
    public static function pages(): array
    {
        return [
            'community health' => ['/v2/platform-team/community-health', 'transactions'],
            'usage' => ['/v2/platform-team/usage', 'ai_usage'],
            'community setup' => ['/v2/platform-team/community-setup', 'email_settings'],
            'data requests' => ['/v2/platform-team/data-requests', 'gdpr_requests'],
            'legal documents' => ['/v2/platform-team/legal-documents', 'legal_documents'],
            'push notifications' => ['/v2/platform-team/push-notifications', 'push_log'],
        ];
    }

    private function community(): int
    {
        $suffix = Str::lower(Str::random(10));

        return (int) DB::table('tenants')->insertGetId([
            'name' => 'Cache Test ' . $suffix,
            'slug' => 'cache-' . $suffix,
            'is_active' => 1,
        ]);
    }

    /** @return list<int> */
    private static function ids(array $data): array
    {
        $rows = $data['communities'] ?? $data['by_community'] ?? [];

        return array_map(static fn (array $row): int => (int) $row['id'], $rows);
    }

    private static function readsTable(array $log, string $table): bool
    {
        foreach ($log as $entry) {
            if (preg_match('/\b(from|join)\s+`?' . preg_quote($table, '/') . '`?(\s|$)/i', (string) $entry['query'])) {
                return true;
            }
        }

        return false;
    }

    /** @dataProvider pages */
    public function test_the_second_look_within_five_minutes_is_the_kept_answer(string $uri, string $table): void
    {
        $this->actAsPlatformTeam();

        $first = $this->apiGet($uri)->assertStatus(200)->json('data');
        $this->assertIsString($first['generated_at']);
        $this->assertNotFalse(strtotime($first['generated_at']));

        $new = $this->community();
        DB::flushQueryLog();
        DB::enableQueryLog();
        $this->travel(299)->seconds();
        $second = $this->apiGet($uri)->assertStatus(200)->json('data');
        $log = DB::getQueryLog();
        DB::disableQueryLog();

        $this->assertFalse(self::readsTable($log, $table), "the kept answer was served without counting {$table} again");
        $this->assertSame($first, $second, 'the same answer, with the time it was worked out');
        $this->assertNotContains($new, self::ids($second));

        $this->travel(2)->seconds();
        $third = $this->apiGet($uri)->assertStatus(200)->json('data');
        $this->assertContains($new, self::ids($third), 'after five minutes the figures are worked out again');
        $this->assertNotSame($first['generated_at'], $third['generated_at']);
    }

    /** @dataProvider pages */
    public function test_refresh_works_the_figures_out_again_and_keeps_the_new_answer(string $uri, string $table): void
    {
        $this->actAsPlatformTeam();
        $first = $this->apiGet($uri)->assertStatus(200)->json('data');
        $new = $this->community();
        $this->travel(5)->seconds();

        DB::flushQueryLog();
        DB::enableQueryLog();
        $fresh = $this->apiGet($uri . '?refresh=1')->assertStatus(200)->json('data');
        $log = DB::getQueryLog();
        DB::disableQueryLog();

        $this->assertTrue(self::readsTable($log, $table), "refresh counted {$table} again");
        $this->assertContains($new, self::ids($fresh));
        $this->assertNotSame($first['generated_at'], $fresh['generated_at']);

        // The fresh answer replaced the kept one.
        $this->assertSame($fresh, $this->apiGet($uri)->assertStatus(200)->json('data'));
    }

    /** @dataProvider pages */
    public function test_refresh_is_limited_to_six_a_minute_per_person(string $uri, string $table): void
    {
        $this->actAsPlatformTeam();

        for ($i = 0; $i < 6; $i++) {
            $this->apiGet($uri . '?refresh=1')->assertStatus(200);
        }
        $this->apiGet($uri . '?refresh=1')->assertStatus(429);

        // Looking without refresh is never refused.
        $this->apiGet($uri)->assertStatus(200);
    }

    public function test_each_month_of_usage_and_each_push_window_is_kept_apart(): void
    {
        $this->actAsPlatformTeam();
        $thisMonth = now()->format('Y-m');
        $lastMonth = now()->subMonthNoOverflow()->format('Y-m');

        $this->assertSame($thisMonth, $this->apiGet('/v2/platform-team/usage?month=' . $thisMonth)->json('data.month'));
        $this->assertSame($lastMonth, $this->apiGet('/v2/platform-team/usage?month=' . $lastMonth)->json('data.month'));
        $this->assertSame(7, $this->apiGet('/v2/platform-team/push-notifications?days=7')->json('data.days'));
        $this->assertSame(14, $this->apiGet('/v2/platform-team/push-notifications?days=14')->json('data.days'));
    }

    public function test_an_answer_with_a_part_not_available_is_kept_for_30_seconds_only(): void
    {
        $this->actAsPlatformTeam();
        // Emails for a month older than the 90-day record are not available.
        $uri = '/v2/platform-team/usage?month=' . now()->subMonthsNoOverflow(5)->format('Y-m');

        $first = $this->apiGet($uri)->assertStatus(200)->json('data');
        $this->assertFalse($first['sources']['emails']);
        $new = $this->community();

        $this->travel(29)->seconds();
        $this->assertNotContains($new, self::ids($this->apiGet($uri)->json('data')));
        $this->travel(2)->seconds();
        $this->assertContains($new, self::ids($this->apiGet($uri)->json('data')));
    }

    public function test_a_computation_that_fails_is_never_kept(): void
    {
        $cache = new PlatformFiguresCache();
        $calls = 0;

        try {
            $cache->remember('test_page', false, function () use (&$calls): array {
                $calls++;
                throw new \RuntimeException('planted');
            });
            $this->fail('the failure reaches the caller');
        } catch (\RuntimeException) {
        }

        $answer = $cache->remember('test_page', false, function () use (&$calls): array {
            $calls++;

            return ['unavailable' => []];
        });

        $this->assertSame(2, $calls);
        $this->assertSame([], $answer['unavailable']);
        $this->assertArrayHasKey('generated_at', $answer);
    }

    public function test_what_counts_as_a_part_not_available(): void
    {
        $this->assertFalse(PlatformFiguresCache::hasUnavailablePart(['unavailable' => [], 'communities' => []]));
        $this->assertTrue(PlatformFiguresCache::hasUnavailablePart(['unavailable' => ['open']]));
        $this->assertTrue(PlatformFiguresCache::hasUnavailablePart(['available' => false]));
        $this->assertFalse(PlatformFiguresCache::hasUnavailablePart(['available' => true]));
        $this->assertTrue(PlatformFiguresCache::hasUnavailablePart(['sources' => ['emails' => false, 'ai_chat' => true]]));
        $this->assertFalse(PlatformFiguresCache::hasUnavailablePart(['sources' => ['emails' => true]]));
    }
}
