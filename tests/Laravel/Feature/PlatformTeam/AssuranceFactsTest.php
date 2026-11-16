<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\PlatformTeam;

use App\Console\Commands\BackupVerify;
use App\Services\PlatformTeam\AssuranceFactsService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * Platform team panel → Assurance facts: facts the platform can measure about
 * itself, each read through the service that already owns it. A fact that
 * cannot be read is "not available" for that fact only, never a zero or a
 * tick. No member, email, community or account id leaves the server.
 *
 * 🔴 No real date of any security test appears here: the dates are made up.
 */
class AssuranceFactsTest extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;

    private const URI = '/v2/platform-team/assurance';

    private const ORDER = ['release', 'two_step', 'access_review', 'backup', 'data_requests', 'failed_sign_ins', 'independent_test'];

    /** Exactly what the page shows, per fact. Anything else must not leave the server. */
    private const FACT_KEYS = [
        'release' => ['available', 'commit_short', 'deployed_at', 'key', 'version'],
        'two_step' => ['available', 'key', 'senior_accounts', 'truncated', 'with_two_step'],
        'access_review' => ['available', 'due', 'key', 'last_review_at'],
        'backup' => ['available', 'checked_at', 'key', 'newest_at', 'state'],
        'data_requests' => ['available', 'key', 'open', 'overdue'],
        'failed_sign_ins' => ['available', 'counted_since', 'key'],
        'independent_test' => ['available', 'date', 'key'],
    ];

    protected function setUp(): void
    {
        parent::setUp();
        Cache::forget(BackupVerify::VERDICT_KEY);
        config(['platform_team.last_independent_test_on' => null]);
    }

    /** @return array<string, array<string, mixed>> */
    private function facts(): array
    {
        $this->actAsPlatformTeam();
        $data = $this->apiGet(self::URI)->assertStatus(200)->json('data');

        $byKey = [];
        foreach ($data['facts'] as $fact) {
            $byKey[$fact['key']] = $fact;
        }

        return $byKey;
    }

    /**
     * @param array<string, mixed> $array
     * @return list<string>
     */
    private function sortedKeys(array $array): array
    {
        $keys = array_keys($array);
        sort($keys);

        return $keys;
    }

    private function useSources(array $sources): void
    {
        $this->app->instance(AssuranceFactsService::class, new AssuranceFactsService($sources));
    }

    public function test_only_the_platform_team_may_read_it(): void
    {
        $this->assertPlatformTeamOnly('GET', self::URI);
    }

    public function test_it_sends_exactly_the_seven_facts_in_order_with_their_own_keys(): void
    {
        $this->actAsPlatformTeam();
        $data = $this->apiGet(self::URI)->assertStatus(200)->json('data');

        $this->assertSame(['facts', 'generated_at'], $this->sortedKeys($data));
        $this->assertNotFalse(strtotime((string) $data['generated_at']));
        $this->assertSame(self::ORDER, array_column($data['facts'], 'key'));
        foreach ($data['facts'] as $fact) {
            $this->assertSame(self::FACT_KEYS[$fact['key']], $this->sortedKeys($fact), "keys of {$fact['key']}");
            $this->assertIsBool($fact['available']);
        }
    }

    public function test_two_step_counts_the_senior_accounts_through_their_own_list(): void
    {
        $this->useSources(['senior_accounts' => fn (): array => [
            'total' => 3,
            'truncated' => true,
            'counts' => [],
            'accounts' => [['two_step_on' => true], ['two_step_on' => false], ['two_step_on' => true]],
        ]]);

        $fact = $this->facts()['two_step'];

        $this->assertTrue($fact['available']);
        $this->assertSame(3, $fact['senior_accounts']);
        $this->assertSame(2, $fact['with_two_step']);
        $this->assertTrue($fact['truncated']);
    }

    public function test_access_review_reports_the_newest_review_and_whether_one_is_due(): void
    {
        $this->useSources(['access_review' => fn (): array => ['due' => false, 'last_review_at' => '2020-01-15T10:00:00+00:00']]);
        $fact = $this->facts()['access_review'];
        $this->assertTrue($fact['available']);
        $this->assertFalse($fact['due']);
        $this->assertSame('2020-01-15T10:00:00+00:00', $fact['last_review_at']);
    }

    public function test_a_fact_whose_source_fails_is_not_available_alone_and_is_logged(): void
    {
        Log::spy();
        $this->useSources([
            'senior_accounts' => fn () => throw new \RuntimeException('planted failure one'),
            'backup_verdict' => fn () => throw new \LogicException('planted failure two'),
            'counted_since' => fn () => throw new \DomainException('planted failure three'),
            'data_request_totals' => fn (): array => ['open' => 4, 'overdue' => 1],
        ]);

        $facts = $this->facts();

        foreach (['two_step', 'backup', 'failed_sign_ins'] as $key) {
            $this->assertFalse($facts[$key]['available'], "{$key} must say it could not be read");
            $this->assertSame(self::FACT_KEYS[$key], $this->sortedKeys($facts[$key]));
            foreach (array_diff(self::FACT_KEYS[$key], ['key', 'available']) as $value) {
                $this->assertNull($facts[$key][$value], "{$key}.{$value} must not carry a value");
            }
        }
        // The others still answer.
        $this->assertTrue($facts['data_requests']['available']);
        $this->assertSame(4, $facts['data_requests']['open']);
        $this->assertSame(1, $facts['data_requests']['overdue']);
        $this->assertTrue($facts['release']['available']);

        foreach (['two_step' => \RuntimeException::class, 'backup' => \LogicException::class, 'failed_sign_ins' => \DomainException::class] as $key => $class) {
            Log::shouldHaveReceived('error')->withArgs(
                fn (string $message, array $context = []): bool => ($context['fact'] ?? null) === $key && ($context['exception'] ?? null) === $class
            )->once();
        }
    }

    public function test_release_and_access_review_and_data_requests_and_independent_test_can_fail_alone_too(): void
    {
        $this->useSources([
            'release' => fn () => throw new \RuntimeException('no release'),
            'access_review' => fn () => throw new \RuntimeException('no review'),
            'data_request_totals' => fn () => throw new \RuntimeException('no requests'),
            'independent_test_on' => fn () => throw new \RuntimeException('no config'),
        ]);

        $facts = $this->facts();

        foreach (['release', 'access_review', 'data_requests', 'independent_test'] as $key) {
            $this->assertFalse($facts[$key]['available'], $key);
        }
        $this->assertTrue($facts['two_step']['available']);
    }

    public function test_data_requests_whose_figure_could_not_be_read_is_not_available_never_zero(): void
    {
        $this->useSources(['data_request_totals' => fn (): array => ['open' => null, 'overdue' => 0]]);

        $fact = $this->facts()['data_requests'];

        $this->assertFalse($fact['available']);
        $this->assertNull($fact['open']);
        $this->assertNull($fact['overdue']);
    }

    public function test_data_requests_are_the_totals_across_every_community(): void
    {
        $before = $this->facts()['data_requests'];
        $this->assertTrue($before['available']);

        $community = (int) DB::table('tenants')->insertGetId([
            'name' => 'Assurance Test ' . Str::random(8), 'slug' => 'af-' . Str::lower(Str::random(10)), 'is_active' => 1,
        ]);
        $user = (int) DB::table('users')->insertGetId([
            'tenant_id' => $community, 'first_name' => 'A', 'last_name' => 'B', 'name' => 'A B',
            'email' => 'af-' . Str::lower(Str::random(12)) . '@example.test', 'status' => 'active', 'is_approved' => 1,
        ]);
        DB::table('gdpr_requests')->insert([
            ['tenant_id' => $community, 'user_id' => $user, 'request_type' => 'access', 'status' => 'pending', 'requested_at' => now()->subDays(40), 'created_at' => now()->subDays(40)],
            ['tenant_id' => $community, 'user_id' => $user, 'request_type' => 'erasure', 'status' => 'processing', 'requested_at' => now()->subDays(2), 'created_at' => now()->subDays(2)],
        ]);

        $after = $this->facts()['data_requests'];
        $this->assertSame($before['open'] + 2, $after['open']);
        $this->assertSame($before['overdue'] + 1, $after['overdue']);
    }

    public function test_backup_reads_a_fresh_verdict(): void
    {
        Cache::put(BackupVerify::VERDICT_KEY, [
            'state' => 'healthy',
            'newest_at' => now()->subHours(5)->toIso8601String(),
            'age_hours' => 5.0,
            'size_bytes' => 1234,
            'checked_at' => now()->subHours(2)->toIso8601String(),
        ], 3600);

        $fact = $this->facts()['backup'];

        $this->assertTrue($fact['available']);
        $this->assertSame('healthy', $fact['state']);
        $this->assertNotNull($fact['newest_at']);
        $this->assertNotNull($fact['checked_at']);
    }

    public function test_backup_with_a_failing_verdict_says_so(): void
    {
        Cache::put(BackupVerify::VERDICT_KEY, ['state' => 'stale', 'newest_at' => null, 'checked_at' => now()->toIso8601String()], 3600);

        $fact = $this->facts()['backup'];

        $this->assertTrue($fact['available']);
        $this->assertSame('stale', $fact['state']);
        $this->assertNull($fact['newest_at']);
    }

    public function test_backup_with_no_verdict_or_one_older_than_26_hours_is_not_available(): void
    {
        $this->assertFalse($this->facts()['backup']['available']);

        Cache::put(BackupVerify::VERDICT_KEY, ['state' => 'healthy', 'newest_at' => now()->subHours(30)->toIso8601String(), 'checked_at' => now()->subHours(27)->toIso8601String()], 3600);
        $fact = $this->facts()['backup'];
        $this->assertFalse($fact['available']);
        $this->assertNull($fact['state']);

        Cache::put(BackupVerify::VERDICT_KEY, 'not a verdict', 3600);
        $this->assertFalse($this->facts()['backup']['available']);
    }

    public function test_failed_sign_ins_says_since_when_counting_began_or_null_when_nothing_was_counted(): void
    {
        DB::table('sign_in_failure_hours')->delete();
        $fact = $this->facts()['failed_sign_ins'];
        $this->assertTrue($fact['available']);
        $this->assertNull($fact['counted_since']);

        DB::table('sign_in_failure_hours')->insert([
            ['hour_start' => '2020-01-15 10:00:00', 'tenant_id' => 0, 'failures' => 3],
            ['hour_start' => '2020-01-16 11:00:00', 'tenant_id' => $this->testTenantId, 'failures' => 1],
        ]);
        $fact = $this->facts()['failed_sign_ins'];
        $this->assertTrue($fact['available']);
        $this->assertStringStartsWith('2020-01-15T10:00:00', (string) $fact['counted_since']);
    }

    public function test_the_independent_test_date_comes_only_from_the_owners_setting(): void
    {
        $fact = $this->facts()['independent_test'];
        $this->assertTrue($fact['available']);
        $this->assertNull($fact['date']);

        config(['platform_team.last_independent_test_on' => '2020-01-15']);
        $this->assertSame('2020-01-15', $this->facts()['independent_test']['date']);
    }

    /** @return array<string, array{0: mixed}> */
    public static function badDates(): array
    {
        return [
            'not a date' => ['soon'],
            'wrong shape' => ['15/01/2020'],
            'impossible day' => ['2020-02-31'],
            'trailing text' => ['2020-01-15 and more'],
            'in the future' => [date('Y-m-d', strtotime('+3 days'))],
            'a number' => [20200115],
            'an array' => [['2020-01-15']],
        ];
    }

    #[DataProvider('badDates')]
    public function test_a_bad_independent_test_date_is_not_recorded_and_logged_without_the_value(mixed $value): void
    {
        Log::spy();
        config(['platform_team.last_independent_test_on' => $value]);

        $fact = $this->facts()['independent_test'];

        $this->assertTrue($fact['available']);
        $this->assertNull($fact['date']);
        Log::shouldHaveReceived('warning')->withArgs(function (string $message, array $context = []) use ($value): bool {
            $logged = $message . json_encode($context);

            return !is_string($value) || !str_contains($logged, $value);
        })->once();
    }

    public function test_no_member_email_community_or_account_id_leaves_the_server(): void
    {
        $community = (int) DB::table('tenants')->insertGetId([
            'name' => 'Plantedcommunity Qwertz', 'slug' => 'af-' . Str::lower(Str::random(10)), 'is_active' => 1,
        ]);
        $senior = (int) DB::table('users')->insertGetId([
            'tenant_id' => $community, 'first_name' => 'Plantedfirst', 'last_name' => 'Plantedsurname',
            'name' => 'Plantedfirst Plantedsurname', 'email' => 'planted-senior@example.test',
            'status' => 'active', 'is_approved' => 1, 'role' => 'admin', 'is_tenant_super_admin' => 1,
        ]);
        DB::table('gdpr_requests')->insert([
            'tenant_id' => $community, 'user_id' => $senior, 'request_type' => 'access', 'status' => 'pending',
            'requested_at' => now()->subDays(3), 'created_at' => now()->subDays(3),
        ]);

        $this->actAsPlatformTeam();
        $response = $this->apiGet(self::URI)->assertStatus(200);
        $body = (string) $response->getContent();

        foreach (['Plantedfirst', 'Plantedsurname', 'planted-senior', '@example.test', 'Plantedcommunity'] as $planted) {
            $this->assertStringNotContainsString($planted, $body);
        }
        foreach (['"id"', '"user_id"', '"email"', '"name"', '"community"', '"accounts"', '"communities"'] as $field) {
            $this->assertStringNotContainsString($field, $body);
        }
    }

    public function test_nothing_can_be_changed_through_it(): void
    {
        $this->actAsPlatformTeam();

        foreach (['POST', 'PUT', 'DELETE'] as $method) {
            $status = $this->requestAs($method, self::URI, [])->getStatusCode();
            $this->assertContains($status, [404, 405], "{$method} answered {$status}");
        }
    }
}
