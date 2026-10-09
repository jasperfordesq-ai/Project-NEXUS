<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\MemberImport;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\CronJobRunner;
use App\Services\GeocodingService;
use App\Services\TokenService;
use App\Services\TwoFactorPolicy;
use App\Services\UserService;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\Laravel\TestCase;

/**
 * Background map lookups for members' towns: every town is tried, a town that
 * cannot be found is marked and never blocks the members behind it, a changed
 * town is asked again, and nothing here touches the real network.
 */
final class GeocodePendingMembersTest extends TestCase
{
    use DatabaseTransactions;

    /** Towns the fake map knows. Anything else is "not found". */
    private const KNOWN = [
        'Findable Town One' => ['51.5', '-0.1'],
        'Findable Town Two' => ['53.4', '-2.2'],
        'Findable Town Three' => ['48.8', '2.3'],
    ];

    private int $otherTenantId;

    /** Status the fake map service answers with for towns named "Outage ..." (0 = connection error). */
    private int $outageStatus = 429;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        TenantContext::setById($this->testTenantId);

        // The one-second pause between lookups is Nominatim's policy and is
        // covered by the service itself; the tests only need it out of the way.
        $this->setPrivateStatic('minRequestIntervalUs', 0);
        $this->setPrivateStatic('lastRequestAt', null);

        $other = DB::table('tenants')->where('id', '<>', $this->testTenantId)->orderBy('id')->value('id');
        $this->assertNotNull($other, 'the test database has a second tenant');
        $this->otherTenantId = (int) $other;

        // Members already in the test database must not take places in a
        // limited run; rolled back with the transaction.
        DB::update(
            "UPDATE users SET geocode_attempted_at = NOW()
             WHERE location IS NOT NULL AND location <> '' AND (latitude IS NULL OR longitude IS NULL)"
        );

        Http::fake(function ($request) {
            parse_str((string) parse_url((string) $request->url(), PHP_URL_QUERY), $query);
            $place = (string) ($query['q'] ?? '');
            if (str_starts_with($place, 'Outage')) {
                if ($this->outageStatus === 0) {
                    throw new \Illuminate\Http\Client\ConnectionException('cURL error 28: timed out');
                }
                return Http::response('', $this->outageStatus);
            }
            if (isset(self::KNOWN[$place])) {
                [$lat, $lon] = self::KNOWN[$place];
                return Http::response([['lat' => $lat, 'lon' => $lon]], 200);
            }

            return Http::response([], 200);
        });
    }

    protected function tearDown(): void
    {
        $this->setPrivateStatic('minRequestIntervalUs', 1_000_000);
        $this->setPrivateStatic('lastRequestAt', null);
        parent::tearDown();
    }

    // ------------------------------------------------------------ fixtures

    private function setPrivateStatic(string $name, mixed $value): void
    {
        $property = new \ReflectionProperty(GeocodingService::class, $name);
        $property->setValue(null, $value);
    }

    private function member(string $location, ?int $tenantId = null, array $extra = []): User
    {
        return User::factory()->forTenant($tenantId ?? $this->testTenantId)->create(array_merge([
            'location' => $location,
            'latitude' => null,
            'longitude' => null,
        ], $extra));
    }

    private function row(int $userId): object
    {
        return DB::table('users')->where('id', $userId)->first();
    }

    private function lookups(): int
    {
        return Http::recorded()->count();
    }

    // --------------------------------------------------------------- tests

    public function test_a_found_town_sets_the_members_coordinates(): void
    {
        $member = $this->member('Findable Town One');

        $result = GeocodingService::geocodePendingUsers(10, 30.0);

        $row = $this->row($member->id);
        $this->assertEqualsWithDelta(51.5, (float) $row->latitude, 0.0001);
        $this->assertEqualsWithDelta(-0.1, (float) $row->longitude, 0.0001);
        $this->assertNotNull($row->geocode_attempted_at);
        $this->assertSame(1, $result['processed']);
        $this->assertSame(1, $result['success']);
        $this->assertSame(0, $result['failed']);
    }

    public function test_an_unfindable_town_is_marked_attempted_and_leaves_no_coordinates(): void
    {
        $member = $this->member('Nowhereville Unknown');

        $result = GeocodingService::geocodePendingUsers(10, 30.0);

        $row = $this->row($member->id);
        $this->assertNull($row->latitude);
        $this->assertNull($row->longitude);
        $this->assertNotNull($row->geocode_attempted_at, 'the attempt is recorded even though nothing was found');
        $this->assertSame(1, $result['failed']);
    }

    public function test_the_attempt_is_recorded_before_the_network_is_called(): void
    {
        $member = $this->member('Findable Town One');
        $markerSeenDuringTheCall = null;

        Http::fake(function () use ($member, &$markerSeenDuringTheCall) {
            $markerSeenDuringTheCall = DB::table('users')->where('id', $member->id)->value('geocode_attempted_at');
            return Http::response([], 200);
        });

        GeocodingService::geocodePendingUsers(10, 30.0);

        $this->assertNotNull($markerSeenDuringTheCall, 'a failing or crashing lookup must already be marked');
    }

    public function test_unfindable_towns_never_starve_a_findable_one(): void
    {
        $unfindable = [];
        for ($i = 1; $i <= 60; $i++) {
            $unfindable[] = $this->member("Nowhere Number {$i}")->id;
        }
        $findable = $this->member('Findable Town Two');

        $first = GeocodingService::geocodePendingUsers(50, 600.0);

        $this->assertSame(50, $first['processed']);
        $this->assertSame(50, DB::table('users')->whereIn('id', $unfindable)->whereNotNull('geocode_attempted_at')->count());
        $this->assertNull($this->row($findable->id)->latitude, 'the first run used all fifty places');

        $second = GeocodingService::geocodePendingUsers(50, 600.0);

        // 10 never-tried unfindable members come first, then the findable one;
        // the 50 already tried are not asked again until a week has passed.
        $this->assertSame(11, $second['processed']);
        $this->assertEqualsWithDelta(53.4, (float) $this->row($findable->id)->latitude, 0.0001);
        $this->assertSame(60, DB::table('users')->whereIn('id', $unfindable)->whereNotNull('geocode_attempted_at')->count());

        $third = GeocodingService::geocodePendingUsers(50, 600.0);
        $this->assertSame(0, $third['processed'], 'nothing is retried within the week');
    }

    public function test_never_tried_members_go_before_the_longest_ago_retries(): void
    {
        $stale = $this->member('Old Unfindable', null, ['geocode_attempted_at' => now()->subDays(30)]);
        $fresh = $this->member('Findable Town One');

        GeocodingService::geocodePendingUsers(1, 30.0);

        $this->assertNotNull($this->row($fresh->id)->latitude, 'the never-tried member was taken first');
        $this->assertEqualsWithDelta(
            now()->subDays(30)->timestamp,
            strtotime((string) $this->row($stale->id)->geocode_attempted_at),
            5,
            'the stale member was left for a later run'
        );
    }

    public function test_an_attempt_older_than_a_week_is_retried_and_a_recent_one_is_not(): void
    {
        $old = $this->member('Findable Town One', null, ['geocode_attempted_at' => now()->subDays(8)]);
        $recent = $this->member('Findable Town Two', null, ['geocode_attempted_at' => now()->subDays(2)]);

        GeocodingService::geocodePendingUsers(10, 30.0);

        $this->assertNotNull($this->row($old->id)->latitude);
        $this->assertNull($this->row($recent->id)->latitude);
    }

    public function test_a_member_who_changes_their_town_is_looked_up_again_at_once(): void
    {
        $member = $this->member('Nowhereville Unknown');
        GeocodingService::geocodePendingUsers(10, 30.0);
        $this->assertNotNull($this->row($member->id)->geocode_attempted_at);
        $this->assertSame(0, GeocodingService::geocodePendingUsers(10, 30.0)['processed']);

        UserService::update($member->id, ['location' => 'Findable Town Three']);

        $this->assertNull($this->row($member->id)->geocode_attempted_at, 'a new town is a new question');
        $result = GeocodingService::geocodePendingUsers(10, 30.0);
        $this->assertSame(1, $result['success']);
        $this->assertEqualsWithDelta(48.8, (float) $this->row($member->id)->latitude, 0.0001);
    }

    public function test_saving_the_same_town_again_does_not_reset_the_marker(): void
    {
        $member = $this->member('Nowhereville Unknown');
        GeocodingService::geocodePendingUsers(10, 30.0);
        $marker = $this->row($member->id)->geocode_attempted_at;

        UserService::update($member->id, ['location' => 'Nowhereville Unknown', 'bio' => 'Hello']);

        $this->assertSame($marker, $this->row($member->id)->geocode_attempted_at);
    }

    public function test_an_admin_editing_a_members_town_resets_the_marker_only_when_it_changes(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $member = $this->member('Nowhereville Unknown');
        GeocodingService::geocodePendingUsers(10, 30.0);
        $marker = $this->row($member->id)->geocode_attempted_at;
        $this->assertNotNull($marker);

        $this->withHeaders(['Authorization' => 'Bearer ' . app(TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, TwoFactorPolicy::claims('totp')
        )]);

        $this->apiPut('/v2/admin/users/' . $member->id, ['location' => 'Nowhereville Unknown'])->assertStatus(200);
        $this->assertSame($marker, $this->row($member->id)->geocode_attempted_at, 'same town, same marker');

        $this->apiPut('/v2/admin/users/' . $member->id, ['location' => 'Findable Town One'])->assertStatus(200);
        $this->assertNull($this->row($member->id)->geocode_attempted_at, 'a different town clears it');
        $this->assertSame('Findable Town One', $this->row($member->id)->location);
    }

    public function test_the_time_budget_is_respected_and_the_rest_wait_for_the_next_run(): void
    {
        $members = [];
        for ($i = 1; $i <= 5; $i++) {
            $members[] = $this->member("Budget Nowhere {$i}")->id;
        }

        // A clock that advances one second every time it is read.
        $now = 0.0;
        $clock = static function () use (&$now): float {
            return $now += 1.0;
        };

        $result = GeocodingService::geocodePendingUsers(5, 3.0, $clock);

        $this->assertSame(2, $result['processed'], 'started at 1, so lookups stop once 3 seconds have passed');
        $this->assertSame(3, $result['deferred']);
        $this->assertSame(2, DB::table('users')->whereIn('id', $members)->whereNotNull('geocode_attempted_at')->count());
        $this->assertSame(2, $this->lookups());

        $next = GeocodingService::geocodePendingUsers(5, 600.0);
        $this->assertSame(3, $next['processed'], 'the deferred members are picked up by the next run');
    }

    public function test_members_are_looked_up_in_their_own_tenant(): void
    {
        $mine = $this->member('Findable Town One', $this->testTenantId);
        $theirs = $this->member('Findable Town Two', $this->otherTenantId);

        $result = GeocodingService::geocodePendingUsers(10, 30.0);

        $this->assertSame(2, $result['success']);
        $mineRow = $this->row($mine->id);
        $theirRow = $this->row($theirs->id);
        $this->assertSame($this->testTenantId, (int) $mineRow->tenant_id);
        $this->assertSame($this->otherTenantId, (int) $theirRow->tenant_id);
        $this->assertEqualsWithDelta(51.5, (float) $mineRow->latitude, 0.0001);
        $this->assertEqualsWithDelta(53.4, (float) $theirRow->latitude, 0.0001);
        $this->assertSame($this->testTenantId, TenantContext::getId(), 'the caller\'s tenant is restored');
    }

    public function test_a_member_in_an_unloadable_tenant_is_marked_and_does_not_stop_the_run(): void
    {
        // A member whose tenant cannot be loaded must not abort the batch. The
        // tenant id points at nothing (foreign keys are off only for this insert;
        // the transaction is rolled back).
        DB::statement('SET FOREIGN_KEY_CHECKS=0');
        try {
            $broken = $this->member('Findable Town One', 987654);
        } finally {
            DB::statement('SET FOREIGN_KEY_CHECKS=1');
        }
        $good = $this->member('Findable Town Two', $this->testTenantId);

        $result = GeocodingService::geocodePendingUsers(10, 30.0);

        $this->assertNotNull($this->row($broken->id)->geocode_attempted_at);
        $this->assertNull($this->row($broken->id)->latitude, 'a member whose community cannot be loaded gets no position');
        $this->assertNotNull($this->row($good->id)->latitude, 'the other member was still looked up');
        $this->assertSame(2, $result['processed']);
    }

    // -------------------------------------------- provider outage handling

    /** Seconds from now until the member is next eligible (negative = already eligible). */
    private function secondsUntilEligible(int $userId): int
    {
        return (int) DB::selectOne(
            "SELECT TIMESTAMPDIFF(SECOND, NOW(), geocode_attempted_at + INTERVAL 7 DAY) AS s FROM users WHERE id = ?",
            [$userId]
        )->s;
    }

    public function test_a_provider_error_retries_the_member_in_about_an_hour_not_a_week(): void
    {
        $member = $this->member('Outage Town');

        $result = GeocodingService::geocodePendingUsers(10, 30.0);

        $this->assertSame(1, $result['processed']);
        $this->assertSame(1, $result['failed']);
        $this->assertNull($this->row($member->id)->latitude);
        $this->assertEqualsWithDelta(3600, $this->secondsUntilEligible($member->id), 30, 'eligible again in about an hour');

        // Not before the hour is up ...
        Cache::flush();
        $this->assertSame(0, GeocodingService::geocodePendingUsers(10, 30.0)['processed']);

        // ... and picked up once it has, when the service is back.
        DB::update('UPDATE users SET geocode_attempted_at = geocode_attempted_at - INTERVAL 61 MINUTE WHERE id = ?', [$member->id]);
        DB::update("UPDATE users SET location = 'Findable Town One' WHERE id = ?", [$member->id]);
        $retry = GeocodingService::geocodePendingUsers(10, 30.0);
        $this->assertSame(1, $retry['success']);
        $this->assertNotNull($this->row($member->id)->latitude);
    }

    public function test_a_timeout_or_server_error_is_also_a_provider_error(): void
    {
        $this->outageStatus = 503;
        $member = $this->member('Outage Server Error');

        GeocodingService::geocodePendingUsers(10, 30.0);

        $this->assertEqualsWithDelta(3600, $this->secondsUntilEligible($member->id), 30);

        $this->outageStatus = 0;
        $other = $this->member('Outage Connection');
        GeocodingService::geocodePendingUsers(10, 30.0);
        $this->assertEqualsWithDelta(3600, $this->secondsUntilEligible($other->id), 30, 'a connection error is a provider error too');
    }

    public function test_a_not_found_town_still_waits_a_week(): void
    {
        $member = $this->member('Nowhereville Unknown');

        GeocodingService::geocodePendingUsers(10, 30.0);

        $this->assertEqualsWithDelta(7 * 86400, $this->secondsUntilEligible($member->id), 30);
        DB::update('UPDATE users SET geocode_attempted_at = NOW() - INTERVAL 6 DAY WHERE id = ?', [$member->id]);
        Cache::flush();
        $this->assertSame(0, GeocodingService::geocodePendingUsers(10, 30.0)['processed']);
    }

    public function test_three_provider_errors_in_a_row_stop_the_run(): void
    {
        $ids = [];
        for ($i = 1; $i <= 4; $i++) {
            $ids[] = $this->member("Outage Number {$i}")->id;
        }

        $result = GeocodingService::geocodePendingUsers(10, 30.0);

        $this->assertSame(3, $result['processed']);
        $this->assertSame(1, $result['stopped_on_provider_errors']);
        $this->assertSame(1, $result['deferred']);
        $this->assertNull($this->row($ids[3])->geocode_attempted_at, 'the fourth member was not touched');
        $this->assertSame(3, $this->lookups());
    }

    public function test_a_success_between_errors_resets_the_count(): void
    {
        $this->member('Outage Number 1');
        $this->member('Outage Number 2');
        $this->member('Findable Town One');
        $this->member('Outage Number 3');
        $this->member('Outage Number 4');

        $result = GeocodingService::geocodePendingUsers(10, 30.0);

        $this->assertSame(5, $result['processed']);
        $this->assertSame(0, $result['stopped_on_provider_errors']);
    }

    public function test_a_remembered_provider_error_counts_as_a_provider_error(): void
    {
        $first = $this->member('Outage Shared Town');
        $second = $this->member('Outage Shared Town');

        $result = GeocodingService::geocodePendingUsers(10, 30.0);

        $this->assertSame(1, $this->lookups(), 'the second member was answered from the 15-minute memory');
        $this->assertSame(2, $result['processed']);
        $this->assertEqualsWithDelta(3600, $this->secondsUntilEligible($first->id), 30);
        $this->assertEqualsWithDelta(3600, $this->secondsUntilEligible($second->id), 30, 'not parked for a week');
    }

    public function test_the_thirty_minute_job_no_longer_looks_up_members(): void
    {
        $member = $this->member('Findable Town One');
        Http::fake(fn () => Http::response([], 200));

        $runner = (new \ReflectionClass(CronJobRunner::class))->newInstanceWithoutConstructor();
        $method = new \ReflectionMethod(CronJobRunner::class, 'geocodeBatchInternal');
        ob_start();
        try {
            $method->invoke($runner);
        } finally {
            ob_end_clean();
        }

        $row = $this->row($member->id);
        $this->assertNull($row->latitude);
        $this->assertNull($row->geocode_attempted_at, 'the member was not touched');
        $askedAboutTheMember = Http::recorded()->filter(
            fn ($pair) => str_contains(urldecode((string) $pair[0]->url()), 'Findable Town One')
        )->count();
        $this->assertSame(0, $askedAboutTheMember);
    }

    public function test_the_manual_cron_page_looks_at_twenty_members_at_most_within_twenty_seconds(): void
    {
        // /cron/geocode-batch runs inside a web request, so it must be short.
        $this->assertLessThanOrEqual(20, CronJobRunner::MANUAL_GEOCODE_MEMBER_LIMIT);
        $this->assertLessThanOrEqual(20.0, CronJobRunner::MANUAL_GEOCODE_BUDGET_SECONDS);

        $members = [];
        for ($i = 1; $i <= 25; $i++) {
            $members[] = $this->member("Manual Nowhere {$i}")->id;
        }

        $runner = (new \ReflectionClass(CronJobRunner::class))->newInstanceWithoutConstructor();
        ob_start();
        try {
            $runner->geocodeBatch();
        } finally {
            ob_end_clean();
        }

        $this->assertSame(
            CronJobRunner::MANUAL_GEOCODE_MEMBER_LIMIT,
            DB::table('users')->whereIn('id', $members)->whereNotNull('geocode_attempted_at')->count(),
            'the manual page stops at its own limit; the rest wait for the scheduled command'
        );
    }

    public function test_the_command_runs_and_reports_a_summary(): void
    {
        $this->member('Findable Town One');

        $exit = Artisan::call('members:geocode-pending', ['--limit' => 5, '--budget' => 30]);

        $this->assertSame(0, $exit);
        $output = Artisan::output();
        $this->assertStringContainsString('processed=1', $output);
        $this->assertStringContainsString('success=1', $output);
    }

    public function test_the_command_rejects_a_bad_limit(): void
    {
        $this->assertSame(2, Artisan::call('members:geocode-pending', ['--limit' => 0]));
    }

    public function test_the_command_is_scheduled_every_minute_on_one_server_without_overlap(): void
    {
        Artisan::call('list');
        $event = collect(app(Schedule::class)->events())
            ->first(fn ($e) => is_string($e->command) && str_contains($e->command, 'members:geocode-pending'));

        $this->assertNotNull($event, 'members:geocode-pending is scheduled');
        $this->assertStringContainsString('--limit=10', $event->command);
        $this->assertStringContainsString('--budget=12', $event->command);
        // Foreground on purpose: a background run could overlap the 30-minute
        // listings lookup and break the map service's one-request-a-second rule.
        // So it must stay short, or the minute-by-minute scheduler loop falls
        // behind and jobs that only fire at an exact minute are skipped.
        $this->assertFalse($event->runInBackground, 'map lookups run in the foreground');
        $this->assertMatchesRegularExpression('/--budget=(\d+)/', $event->command);
        preg_match('/--budget=(\d+)/', $event->command, $budget);
        $this->assertLessThanOrEqual(12, (int) $budget[1], 'a foreground run must not hold the scheduler loop');
        $this->assertSame('* * * * *', $event->expression);
        $this->assertTrue($event->withoutOverlapping);
        $this->assertSame(10, $event->expiresAt);
        $this->assertTrue($event->onOneServer);
        $this->assertSame('members-geocode-pending', $event->description);
    }
}
