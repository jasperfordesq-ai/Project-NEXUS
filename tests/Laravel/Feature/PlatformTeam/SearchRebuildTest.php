<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\PlatformTeam;

use App\Contracts\SearchDocumentIndexer;
use App\Jobs\ReindexTenantSearchJob;
use App\Services\PlatformTeam\SearchRebuildService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Queue\MaxAttemptsExceededException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * Platform team panel → Rebuild search (idea 31).
 *
 * The page lists every community with the last rebuild started from it, and
 * starts a rebuild of one community's search as a background job. The job
 * adds and updates entries; it never empties the community's search first.
 *
 * No test talks to a search server: a fake SearchDocumentIndexer is bound,
 * and jobs are faked or run by calling handle() directly.
 */
class SearchRebuildTest extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;

    private const URI = '/v2/platform-team/search-rebuild';

    /** @var list<array{0: string, 1: int}> */
    public array $sent = [];

    public bool $reachable = true;

    public ?string $throwOnType = null;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        $test = $this;
        $this->app->instance(SearchDocumentIndexer::class, new class ($test) implements SearchDocumentIndexer {
            public function __construct(private readonly SearchRebuildTest $test)
            {
            }

            public function index(string $type, array $row): void
            {
                if ($this->test->throwOnType === $type) {
                    throw new \RuntimeException('planted');
                }
                $this->test->sent[] = [$type, (int) $row['id']];
            }

            public function reachable(): bool
            {
                return $this->test->reachable;
            }
        });
    }

    private function owner(): int
    {
        return (int) \App\Models\User::factory()->forTenant($this->testTenantId)->create(['status' => 'active'])->id;
    }

    public function test_only_the_platform_team_may_see_or_start_a_rebuild(): void
    {
        Queue::fake();

        $this->assertPlatformTeamOnly('GET', self::URI);
        $this->assertRefusedBelowPlatformTeam('POST', self::URI, ['tenant_id' => $this->testTenantId]);

        Queue::assertNotPushed(ReindexTenantSearchJob::class);
        $this->assertNull(Cache::get(SearchRebuildService::cacheKey($this->testTenantId)), 'a refused request leaves no state');
        $this->assertSame(0, DB::table('activity_log')->where('action', 'platform_team_search_rebuild')->count());
    }

    public function test_the_list_sends_exactly_what_the_page_shows(): void
    {
        $this->actAsPlatformTeam();

        $data = $this->apiGet(self::URI)->assertStatus(200)->json('data');

        $this->assertSame(['search_available', 'communities'], array_keys($data));
        $this->assertTrue($data['search_available']);
        $row = collect($data['communities'])->firstWhere('id', $this->testTenantId);
        $this->assertNotNull($row);
        $this->assertSame(['id', 'name', 'slug', 'is_active', 'last'], array_keys($row));
        $this->assertNull($row['last'], 'never run from this page');
        $this->assertSame(DB::table('tenants')->count(), count($data['communities']), 'every community is listed');
    }

    public function test_the_list_says_when_the_search_service_cannot_be_reached(): void
    {
        $this->reachable = false;
        $this->actAsPlatformTeam();

        $this->apiGet(self::URI)->assertStatus(200)->assertJsonPath('data.search_available', false);
    }

    public function test_starting_a_rebuild_queues_one_job_for_that_community_and_records_who(): void
    {
        Queue::fake();
        $actor = $this->actAsPlatformTeam();

        $this->apiPost(self::URI, ['tenant_id' => $this->testTenantId])
            ->assertStatus(200)
            ->assertJsonPath('data.queued', true);

        Queue::assertPushedOn('search', ReindexTenantSearchJob::class, fn (ReindexTenantSearchJob $job): bool => $job->tenantId === $this->testTenantId);
        Queue::assertPushed(ReindexTenantSearchJob::class, 1);

        $this->assertSame('queued', Cache::get(SearchRebuildService::cacheKey($this->testTenantId))['state']);

        $log = DB::table('activity_log')->where('action', 'platform_team_search_rebuild')->orderByDesc('id')->first();
        $this->assertNotNull($log);
        $this->assertNull($log->tenant_id, 'a platform-wide act is not stamped with the caller\'s community');
        $this->assertSame((int) $actor->id, (int) $log->user_id);
        $this->assertSame($this->testTenantId, (int) $log->entity_id);

        $last = collect($this->apiGet(self::URI)->json('data.communities'))->firstWhere('id', $this->testTenantId)['last'];
        $this->assertSame(['state', 'started_at', 'finished_at', 'counts', 'errors'], array_keys($last));
        $this->assertSame('queued', $last['state']);
    }

    public function test_a_community_that_does_not_exist_is_a_404_and_nothing_is_queued(): void
    {
        Queue::fake();
        $this->actAsPlatformTeam();

        $this->apiPost(self::URI, ['tenant_id' => 987654321])->assertStatus(404);
        $this->apiPost(self::URI, [])->assertStatus(404);
        $this->apiPost(self::URI, ['tenant_id' => 'abc'])->assertStatus(404);

        Queue::assertNotPushed(ReindexTenantSearchJob::class);
    }

    public function test_a_second_start_while_one_is_waiting_or_running_is_refused_with_409(): void
    {
        Queue::fake();
        $this->actAsPlatformTeam();

        $this->apiPost(self::URI, ['tenant_id' => $this->testTenantId])->assertStatus(200);
        $this->apiPost(self::URI, ['tenant_id' => $this->testTenantId])->assertStatus(409);

        Cache::put(SearchRebuildService::cacheKey($this->testTenantId), [
            'state' => 'running', 'started_at' => now()->subMinutes(2)->toIso8601String(), 'finished_at' => null,
            'counts' => null, 'errors' => 0, 'updated_at' => now()->subMinute()->toIso8601String(),
        ], now()->addDays(7));
        $this->apiPost(self::URI, ['tenant_id' => $this->testTenantId])->assertStatus(409);

        Queue::assertPushed(ReindexTenantSearchJob::class, 1);
    }

    /**
     * Review 16 Nov: the busy check and the "queued" mark were two steps, so
     * two clicks close together could both pass the check and queue two jobs.
     * A start now holds a short lock for that community while it checks and
     * marks; a second start that finds the lock held is refused.
     */
    public function test_a_start_that_finds_another_start_in_progress_is_refused_and_queues_nothing(): void
    {
        Queue::fake();
        $this->actAsPlatformTeam();
        $this->assertTrue(Cache::add(SearchRebuildService::startLockKey($this->testTenantId), 1, 30));

        $this->apiPost(self::URI, ['tenant_id' => $this->testTenantId])->assertStatus(409);

        Queue::assertNotPushed(ReindexTenantSearchJob::class);
        $this->assertNull(Cache::get(SearchRebuildService::cacheKey($this->testTenantId)));
    }

    public function test_two_starts_in_a_row_queue_one_job_and_the_lock_is_let_go(): void
    {
        Queue::fake();
        $this->actAsPlatformTeam();

        $this->apiPost(self::URI, ['tenant_id' => $this->testTenantId])->assertStatus(200);
        $this->apiPost(self::URI, ['tenant_id' => $this->testTenantId])->assertStatus(409);

        Queue::assertPushed(ReindexTenantSearchJob::class, 1);
        $this->assertNull(Cache::get(SearchRebuildService::startLockKey($this->testTenantId)), 'the start lock is let go after each start');
    }

    /**
     * Review 16 Nov: when handing the job to the queue failed, the record
     * already said "queued", and every new start was refused for 30 minutes.
     */
    public function test_a_start_whose_job_cannot_be_queued_leaves_the_community_free(): void
    {
        $this->actAsPlatformTeam();
        $before = [
            'state' => 'done', 'started_at' => now()->subDay()->toIso8601String(), 'finished_at' => now()->subDay()->toIso8601String(),
            'counts' => ['listing' => 1], 'errors' => 0, 'updated_at' => now()->subDay()->toIso8601String(),
        ];
        Cache::put(SearchRebuildService::cacheKey($this->testTenantId), $before, now()->addDays(7));

        $real = $this->app->make(\Illuminate\Contracts\Bus\Dispatcher::class);
        $this->mock(\Illuminate\Contracts\Bus\Dispatcher::class, function ($mock): void {
            $mock->shouldReceive('dispatch')->andThrow(new \RuntimeException('queue down'));
        });

        $response = $this->apiPost(self::URI, ['tenant_id' => $this->testTenantId])->assertStatus(503);
        $this->assertSame('SEARCH_UNAVAILABLE', $response->json('errors.0.code'));

        $this->assertSame($before, Cache::get(SearchRebuildService::cacheKey($this->testTenantId)), 'the last real run is kept, not replaced by "queued"');
        $this->assertNull(Cache::get(SearchRebuildService::startLockKey($this->testTenantId)));
        $this->assertSame(0, DB::table('activity_log')->where('action', 'platform_team_search_rebuild')->count(), 'nothing was started, so nothing is recorded');

        // The next start is allowed.
        $this->app->instance(\Illuminate\Contracts\Bus\Dispatcher::class, $real);
        Queue::fake();
        $this->apiPost(self::URI, ['tenant_id' => $this->testTenantId])->assertStatus(200);
        Queue::assertPushed(ReindexTenantSearchJob::class, 1);
    }

    /**
     * A database error can quote the values of the failed statement. The
     * log line names the kind of error only.
     */
    public function test_a_failed_record_logs_the_kind_of_error_only(): void
    {
        $planted = 'PLANTED-SEARCH-RECORD-7731';
        $lines = [];
        \Illuminate\Support\Facades\Event::listen(\Illuminate\Log\Events\MessageLogged::class, function ($e) use (&$lines): void {
            $lines[] = $e->message . ' ' . json_encode($e->context);
        });
        $fail = true;
        DB::connection()->beforeExecuting(function (string $query, array $bindings) use (&$fail, $planted): void {
            if ($fail && str_contains($query, 'insert into `activity_log`')) {
                throw new \Illuminate\Database\QueryException('mysql', $query . ' /* ' . $planted . ' */', $bindings, new \RuntimeException($planted));
            }
        });

        try {
            (new SearchRebuildService())->record(1, $this->testTenantId);
        } finally {
            $fail = false;
        }

        $this->assertNotEmpty($lines, 'the failure was logged');
        foreach ($lines as $line) {
            $this->assertStringNotContainsString($planted, $line);
            $this->assertStringNotContainsString('Search rebuild for community', $line);
        }
    }

    public function test_a_waiting_state_older_than_30_minutes_does_not_block_a_new_start(): void
    {
        Queue::fake();
        $this->actAsPlatformTeam();
        Cache::put(SearchRebuildService::cacheKey($this->testTenantId), [
            'state' => 'running', 'started_at' => now()->subHours(2)->toIso8601String(), 'finished_at' => null,
            'counts' => null, 'errors' => 0, 'updated_at' => now()->subMinutes(31)->toIso8601String(),
        ], now()->addDays(7));

        $last = collect($this->apiGet(self::URI)->json('data.communities'))->firstWhere('id', $this->testTenantId)['last'];
        $this->assertSame('failed', $last['state'], 'a run that stopped reporting is not shown as running for ever');

        $this->apiPost(self::URI, ['tenant_id' => $this->testTenantId])->assertStatus(200);
        Queue::assertPushed(ReindexTenantSearchJob::class, 1);
    }

    public function test_nothing_is_queued_when_the_search_service_cannot_be_reached(): void
    {
        Queue::fake();
        $this->reachable = false;
        $this->actAsPlatformTeam();

        $response = $this->apiPost(self::URI, ['tenant_id' => $this->testTenantId])->assertStatus(503);

        $this->assertSame(__('api.platform_search_rebuild_unavailable'), $response->json('errors.0.message'));
        Queue::assertNotPushed(ReindexTenantSearchJob::class);
        $this->assertNull(Cache::get(SearchRebuildService::cacheKey($this->testTenantId)));
    }

    public function test_the_job_runs_on_the_search_queue_once_with_a_generous_time_limit(): void
    {
        $job = new ReindexTenantSearchJob($this->testTenantId);

        $this->assertSame('search', $job->queue);
        $this->assertSame(1, $job->tries);
        $this->assertGreaterThanOrEqual(1800, $job->timeout);
    }

    public function test_the_job_records_running_then_done_with_counts_per_kind(): void
    {
        $groupId = DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId, 'owner_id' => $this->owner(), 'name' => 'Rebuild group', 'is_active' => 1,
        ]);

        $this->app->call([new ReindexTenantSearchJob($this->testTenantId), 'handle']);

        $state = Cache::get(SearchRebuildService::cacheKey($this->testTenantId));
        $this->assertSame('done', $state['state']);
        $this->assertNotNull($state['started_at']);
        $this->assertNotNull($state['finished_at']);
        $this->assertSame(0, $state['errors']);
        $this->assertSame(['listing', 'user', 'event', 'group', 'marketplace'], array_keys($state['counts']));
        $this->assertContains(['group', $groupId], $this->sent);
        $this->assertSame(count(array_filter($this->sent, static fn (array $s): bool => $s[0] === 'group')), $state['counts']['group']);
    }

    public function test_entries_that_could_not_be_updated_are_counted_not_hidden(): void
    {
        DB::table('groups')->insert([
            'tenant_id' => $this->testTenantId, 'owner_id' => $this->owner(), 'name' => 'Rebuild group', 'is_active' => 1,
        ]);
        $this->throwOnType = 'group';

        $this->app->call([new ReindexTenantSearchJob($this->testTenantId), 'handle']);

        $state = Cache::get(SearchRebuildService::cacheKey($this->testTenantId));
        $this->assertSame('done', $state['state']);
        $this->assertGreaterThanOrEqual(1, $state['errors']);
        $this->assertSame(0, $state['counts']['group']);
    }

    public function test_the_job_writes_failed_before_it_lets_an_error_go(): void
    {
        $this->reachable = false;

        try {
            $this->app->call([new ReindexTenantSearchJob($this->testTenantId), 'handle']);
            $this->fail('the job should report that it could not run');
        } catch (\RuntimeException) {
        }

        $state = Cache::get(SearchRebuildService::cacheKey($this->testTenantId));
        $this->assertSame('failed', $state['state']);
        $this->assertNotNull($state['finished_at']);
        $this->assertSame([], $this->sent);
    }

    public function test_a_job_given_up_by_the_queue_is_recorded_as_failed(): void
    {
        $job = new ReindexTenantSearchJob($this->testTenantId);

        $job->failed(new \RuntimeException('Worker stopped'));

        $this->assertSame('failed', Cache::get(SearchRebuildService::cacheKey($this->testTenantId))['state']);
    }

    public function test_a_second_delivery_of_a_job_that_is_still_running_does_not_overwrite_it(): void
    {
        Cache::put(SearchRebuildService::cacheKey($this->testTenantId), [
            'state' => 'running', 'started_at' => now()->subMinutes(3)->toIso8601String(), 'finished_at' => null,
            'counts' => null, 'errors' => 0, 'updated_at' => now()->toIso8601String(),
        ], now()->addDays(7));

        (new ReindexTenantSearchJob($this->testTenantId))->failed(new MaxAttemptsExceededException('attempted too many times'));

        $this->assertSame('running', Cache::get(SearchRebuildService::cacheKey($this->testTenantId))['state']);
    }
}
