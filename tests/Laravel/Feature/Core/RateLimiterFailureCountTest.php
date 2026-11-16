<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Core;

use App\Core\RateLimiter;
use App\Core\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Tests\Laravel\TestCase;

/**
 * Every failed email sign-in adds one to `sign_in_failure_hours` for its
 * community and hour (Platform team panel → Security). `login_attempts`
 * cannot answer "how many in the last 24 hours": RateLimiter deletes its rows
 * after 20 minutes and on a successful sign-in.
 *
 * 🔴 This is the sign-in path. A broken counter must never stop or fail a
 * sign-in attempt from being recorded.
 */
class RateLimiterFailureCountTest extends TestCase
{
    use DatabaseTransactions;

    /** The master community; it exists in every database. */
    private const OTHER_TENANT = 1;

    protected function setUp(): void
    {
        parent::setUp();
        // The shared test database may hold rows; this test owns the table
        // inside its transaction.
        DB::table('sign_in_failure_hours')->delete();
        TenantContext::setById($this->testTenantId);
    }

    protected function tearDown(): void
    {
        try {
            if (property_exists(RateLimiter::class, 'failureCounterTable')) {
                $this->setCounter('sign_in_failure_hours', false);
            }
        } finally {
            // Always roll the transaction back, or its row locks outlive the test.
            parent::tearDown();
        }
    }

    private function setCounter(string $table, bool $logged): void
    {
        $tableProperty = new \ReflectionProperty(RateLimiter::class, 'failureCounterTable');
        $tableProperty->setValue(null, $table);
        $loggedProperty = new \ReflectionProperty(RateLimiter::class, 'failureCounterLogged');
        $loggedProperty->setValue(null, $logged);
    }

    /** @return array<int, int> tenant_id => failures, this hour */
    private function thisHour(): array
    {
        return DB::table('sign_in_failure_hours')
            ->whereRaw("hour_start = DATE_FORMAT(NOW(), '%Y-%m-%d %H:00:00')")
            ->pluck('failures', 'tenant_id')
            ->map(static fn ($n): int => (int) $n)
            ->all();
    }

    public function test_a_failed_email_sign_in_adds_one_to_this_hours_row_for_its_community(): void
    {
        RateLimiter::recordAttempt('count-a@example.test', 'email', false);

        $this->assertSame([$this->testTenantId => 1], $this->thisHour());
        $this->assertSame(
            1,
            DB::table('sign_in_failure_hours')->count(),
            'one row for the hour and community, nothing else',
        );
    }

    public function test_two_failures_in_the_same_hour_make_one_row_with_two(): void
    {
        RateLimiter::recordAttempt('count-a@example.test', 'email', false);
        RateLimiter::recordAttempt('count-b@example.test', 'email', false);

        $this->assertSame([$this->testTenantId => 2], $this->thisHour());
        $this->assertSame(1, DB::table('sign_in_failure_hours')->count());
    }

    public function test_a_failure_in_another_community_makes_another_row(): void
    {
        RateLimiter::recordAttempt('count-a@example.test', 'email', false);
        TenantContext::setById(self::OTHER_TENANT);
        RateLimiter::recordAttempt('count-a@example.test', 'email', false);

        $counts = $this->thisHour();
        ksort($counts);
        $expected = [$this->testTenantId => 1, self::OTHER_TENANT => 1];
        ksort($expected);
        $this->assertSame($expected, $counts);
    }

    public function test_the_row_is_for_the_current_hour(): void
    {
        RateLimiter::recordAttempt('count-a@example.test', 'email', false);

        $row = DB::selectOne(
            "SELECT hour_start, DATE_FORMAT(NOW(), '%Y-%m-%d %H:00:00') AS expected FROM sign_in_failure_hours"
        );
        $this->assertSame((string) $row->expected, (string) $row->hour_start);
    }

    public function test_a_successful_sign_in_adds_nothing_and_removes_nothing(): void
    {
        RateLimiter::recordAttempt('count-a@example.test', 'email', false);
        RateLimiter::recordAttempt('count-a@example.test', 'email', true);

        $this->assertSame([$this->testTenantId => 1], $this->thisHour());
    }

    public function test_an_address_attempt_adds_nothing_because_it_is_the_same_failure_counted_twice(): void
    {
        RateLimiter::recordAttempt('192.0.2.44', 'ip', false);
        RateLimiter::recordAttempt('192.0.2.44', 'ip', true);
        RateLimiter::recordAttempt('192.0.2.44:csrf', 'csrf_token', false);

        $this->assertSame(0, DB::table('sign_in_failure_hours')->count());
    }

    public function test_nothing_about_the_person_is_kept_in_the_count(): void
    {
        RateLimiter::recordAttempt('count-private@example.test', 'email', false);

        $columns = array_keys((array) DB::table('sign_in_failure_hours')->first());
        sort($columns);
        $this->assertSame(['failures', 'hour_start', 'tenant_id'], $columns);
    }

    public function test_a_broken_counter_still_records_the_attempt_and_logs_once_per_process(): void
    {
        $this->setCounter('sign_in_failure_hours_planted_missing', false);
        Log::spy();
        $identifier = RateLimiter::emailIdentifierFor('count-broken@example.test', $this->testTenantId);

        RateLimiter::recordAttempt('count-broken@example.test', 'email', false);
        RateLimiter::recordAttempt('count-broken@example.test', 'email', false);

        $this->assertSame(
            2,
            DB::table('login_attempts')->where('identifier', $identifier)->where('success', 0)->count(),
            'the sign-in attempt must still be recorded for the lock-out rules',
        );
        $this->assertTrue(
            DB::connection()->getPdo()->inTransaction(),
            'a failed count must not end the caller\'s transaction',
        );
        Log::shouldHaveReceived('error')->once();

        // The lock-out check still reads the attempts.
        $this->assertSame(8, RateLimiter::check('count-broken@example.test', 'email')['remaining_attempts']);
    }
}
