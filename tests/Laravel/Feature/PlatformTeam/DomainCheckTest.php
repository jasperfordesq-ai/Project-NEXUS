<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\PlatformTeam;

use App\Contracts\DomainProber;
use App\Services\PlatformTeam\CommunitySetupChecklistService;
use App\Services\PlatformTeam\DomainCheckService;
use App\Services\PlatformTeam\DomainProbeFailure;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * Platform team panel → Addresses and certificates (idea 7).
 *
 * 🔴 No test makes a network connection or a DNS lookup: a fake DomainProber
 * is bound, and it records every host it is asked about. A host may reach the
 * prober only when it is in the tenants table (or is one of the platform's own
 * configured addresses), never because a request named it.
 */
class DomainCheckTest extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;

    private const URI = '/v2/platform-team/domains';
    private const CHECK_URI = '/v2/platform-team/domains/check';
    private const PLANTED_IP = '10.9.8.7';
    private const PLANTED_TEXT = 'connect to 10.9.8.7:443 failed: internal-db.private';

    /** @var list<array{0: string, 1: string}> method, host */
    public array $calls = [];

    /**
     * Per-host behaviour. Keys: resolves (bool), public (bool),
     * expiry (?string, relative "+N days" from now), throw (Throwable).
     *
     * @var array<string, array<string, mixed>>
     */
    public array $behaviour = [];

    /** @var list<string> the address each certificate read was sent to, in order */
    public array $triedAddresses = [];

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        Carbon::setTestNow(Carbon::parse('2026-11-16 12:00:00', 'UTC'));
        $test = $this;
        $this->app->instance(DomainProber::class, new class ($test) implements DomainProber {
            public function __construct(private readonly DomainCheckTest $test)
            {
            }

            public function resolves(string $host): bool
            {
                $this->test->calls[] = ['resolves', $host];

                return (bool) ($this->test->behaviour[$host]['resolves'] ?? true);
            }

            public function publicAddresses(string $host): array
            {
                $this->test->calls[] = ['publicAddresses', $host];

                if (isset($this->test->behaviour[$host]['addresses'])) {
                    return $this->test->behaviour[$host]['addresses'];
                }

                return ($this->test->behaviour[$host]['public'] ?? true) ? ['203.0.113.10'] : [];
            }

            public function certificateExpiry(string $host, string $ip): ?\DateTimeImmutable
            {
                $this->test->calls[] = ['certificateExpiry', $host];
                $this->test->triedAddresses[] = $ip;
                $b = $this->test->behaviour[$host] ?? [];
                if (isset($b['throw_for'][$ip])) {
                    throw $b['throw_for'][$ip];
                }
                if (isset($b['throw'])) {
                    throw $b['throw'];
                }
                if (array_key_exists('expiry', $b) && $b['expiry'] === null) {
                    return null;
                }

                // Relative to the test's fixed "now", not the real clock.
                return Carbon::now()->modify((string) ($b['expiry'] ?? '+90 days 1 hour'))->toDateTimeImmutable();
            }
        });
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    /**
     * Found by running the real checker once (16 Nov 2026): every platform
     * host has IPv4 and IPv6 addresses, and a server with no IPv6 route gets
     * "no answer" from the IPv6 ones at once. Only the first address was
     * tried, so the order the name service happened to return decided
     * whether a working site showed as "not working".
     */
    public function test_a_host_is_fine_when_one_of_its_addresses_answers_even_if_another_does_not(): void
    {
        $host = $this->host('twofamilies');
        $id = $this->community(['domain' => $host]);
        $this->behaviour[$host] = [
            'addresses' => ['2001:db8::10', '203.0.113.10'],
            'throw_for' => ['2001:db8::10' => new DomainProbeFailure('no_answer', self::PLANTED_TEXT)],
        ];

        $row = app(DomainCheckService::class)->checkCommunity($id);

        $address = collect($row['addresses'])->firstWhere('host', $host);
        $this->assertSame('ok', $address['status']);
        $this->assertNull($address['error_kind']);
        // The older kind of address is tried first: it is the one every server can reach.
        $this->assertSame('203.0.113.10', $this->triedAddresses[0]);
    }

    public function test_a_host_is_not_working_only_when_none_of_its_addresses_answers(): void
    {
        $host = $this->host('nonefamilies');
        $id = $this->community(['domain' => $host]);
        $this->behaviour[$host] = [
            'addresses' => ['2001:db8::10', '203.0.113.10'],
            'throw_for' => [
                '2001:db8::10' => new DomainProbeFailure('no_answer', self::PLANTED_TEXT),
                '203.0.113.10' => new DomainProbeFailure('certificate_not_trusted', self::PLANTED_TEXT),
            ],
        ];

        $row = app(DomainCheckService::class)->checkCommunity($id);

        $address = collect($row['addresses'])->firstWhere('host', $host);
        $this->assertSame('failing', $address['status']);
        // The reason kept is the first address's (the one every server can reach).
        $this->assertSame('certificate_not_trusted', $address['error_kind']);
        $this->assertCount(2, $this->triedAddresses);
    }

    /** @param array<string, mixed> $attributes */
    private function community(array $attributes = []): int
    {
        $suffix = Str::lower(Str::random(10));

        return (int) DB::table('tenants')->insertGetId(array_merge([
            'name' => 'Domain Test ' . $suffix,
            'slug' => 'domq-' . $suffix,
            'is_active' => 1,
        ], $attributes));
    }

    private function host(string $label): string
    {
        return $label . '-' . Str::lower(Str::random(8)) . '.example.org';
    }

    /** @return list<string> */
    private function probedHosts(): array
    {
        return array_values(array_unique(array_map(static fn (array $c): string => $c[1], $this->calls)));
    }

    /** @return array<string, mixed> */
    private function rowFor(int $id): array
    {
        $row = collect($this->apiGet(self::URI)->assertStatus(200)->json('data.communities'))->firstWhere('id', $id);
        $this->assertNotNull($row);

        return $row;
    }

    public function test_only_the_platform_team_may_see_or_start_a_check_and_a_refused_request_probes_nothing(): void
    {
        $id = $this->community(['domain' => $this->host('locked')]);

        $this->assertPlatformTeamOnly('GET', self::URI);
        $this->assertRefusedBelowPlatformTeam('POST', self::CHECK_URI, ['tenant_id' => $id]);
        $this->assertRefusedBelowPlatformTeam('POST', self::CHECK_URI, ['platform' => true]);

        $this->assertSame([], $this->calls, 'a refused request contacts nothing');
        $this->assertSame(0, DB::table('activity_log')->where('action', 'platform_team_domain_check')->count());
    }

    public function test_the_list_sends_exactly_what_the_page_shows(): void
    {
        $main = $this->host('main');
        $id = $this->community(['domain' => $main, 'accessible_domain' => $this->host('acc')]);
        $bare = $this->community();
        $this->actAsPlatformTeam();

        $data = $this->apiGet(self::URI)->assertStatus(200)->json('data');

        $this->assertSame(['platform', 'communities', 'warning_days'], array_keys($data));
        $this->assertSame(21, $data['warning_days']);
        $this->assertSame(DB::table('tenants')->count(), count($data['communities']), 'every community is listed');

        $row = collect($data['communities'])->firstWhere('id', $id);
        $this->assertSame(['id', 'name', 'slug', 'is_active', 'addresses'], array_keys($row));
        $this->assertCount(2, $row['addresses']);
        $this->assertSame(
            ['kind', 'host', 'uses_platform_address', 'status', 'resolves', 'certificate_expires_at', 'days_left', 'checked_at', 'error_kind'],
            array_keys($row['addresses'][0])
        );
        $this->assertSame('main', $row['addresses'][0]['kind']);
        $this->assertSame($main, $row['addresses'][0]['host']);
        $this->assertSame('accessible', $row['addresses'][1]['kind']);
        $this->assertSame('unknown', $row['addresses'][0]['status'], 'never checked');
        $this->assertNull($row['addresses'][0]['checked_at']);

        $this->assertSame([], collect($data['communities'])->firstWhere('id', $bare)['addresses'], 'a community with no address');

        $platformHosts = CommunitySetupChecklistService::platformAddresses();
        $this->assertSame($platformHosts, array_column($data['platform'], 'host'));
        if ($data['platform'] !== []) {
            $this->assertSame(
                ['host', 'status', 'resolves', 'certificate_expires_at', 'days_left', 'checked_at', 'error_kind'],
                array_keys($data['platform'][0])
            );
        }

        $this->assertSame([], $this->calls, 'reading the list contacts nothing');
    }

    public function test_a_community_on_the_platforms_address_is_not_checked_on_its_own(): void
    {
        $platform = CommunitySetupChecklistService::platformAddresses()[0];
        $id = $this->community(['domain' => 'sub-' . Str::lower(Str::random(6)) . '.' . $platform]);
        $this->actAsPlatformTeam();

        $this->apiPost(self::CHECK_URI, ['tenant_id' => $id])->assertStatus(200);

        $this->assertSame([], $this->calls);
        $address = $this->rowFor($id)['addresses'][0];
        $this->assertTrue($address['uses_platform_address']);
        $this->assertNull($address['status']);
    }

    /** @return array<string, array{0: string}> */
    public static function uncheckableValues(): array
    {
        return [
            'a scheme and a path' => ['https://uncheckable-q.example.org/path'],
            'a port' => ['uncheckable-q.example.org:8443'],
            'an IP literal' => ['198.51.100.23'],
            'no dot' => ['uncheckableq'],
            'a space' => ['uncheck able-q.example.org'],
            'longer than 253 characters' => [str_repeat('a', 60) . '.' . str_repeat('b', 60) . '.' . str_repeat('c', 60) . '.' . str_repeat('d', 60) . '.example.org'],
        ];
    }

    /** @dataProvider uncheckableValues */
    public function test_a_value_that_is_not_a_plain_host_name_is_never_contacted(string $value): void
    {
        $id = $this->community(['domain' => $value]);
        $this->actAsPlatformTeam();

        $this->apiPost(self::CHECK_URI, ['tenant_id' => $id])->assertStatus(200);
        Artisan::call('domains:check');

        $this->assertNotContains($value, $this->probedHosts());
        $this->assertNotContains(strtolower($value), $this->probedHosts());
        $this->assertSame('not_checkable', $this->rowFor($id)['addresses'][0]['status']);
    }

    public function test_the_request_cannot_supply_a_host(): void
    {
        $own = $this->host('own');
        $id = $this->community(['domain' => $own]);
        $this->actAsPlatformTeam();

        $this->apiPost(self::CHECK_URI, [
            'tenant_id' => $id,
            'host' => 'evil-q.example.org',
            'hosts' => ['evil2-q.example.org'],
            'domain' => 'evil3-q.example.org',
            'accessible_domain' => 'evil4-q.example.org',
        ])->assertStatus(200);
        $this->apiPost(self::CHECK_URI, ['host' => 'evil5-q.example.org'])->assertStatus(404);
        $this->apiPost(self::CHECK_URI, ['tenant_id' => 'evil6-q.example.org'])->assertStatus(404);

        $this->assertSame([$own], $this->probedHosts());
    }

    public function test_check_now_checks_only_that_communitys_own_addresses_and_answers_with_its_row(): void
    {
        $main = $this->host('main');
        $accessible = $this->host('acc');
        $id = $this->community(['domain' => $main, 'accessible_domain' => $accessible]);
        $this->community(['domain' => $this->host('other')]);
        $actor = $this->actAsPlatformTeam();

        $data = $this->apiPost(self::CHECK_URI, ['tenant_id' => $id])->assertStatus(200)->json('data');

        $this->assertSame(['id', 'name', 'slug', 'is_active', 'addresses'], array_keys($data));
        $this->assertSame($id, $data['id']);
        $this->assertSame('ok', $data['addresses'][0]['status']);
        $this->assertSame(90, $data['addresses'][0]['days_left']);
        $this->assertTrue($data['addresses'][0]['resolves']);
        $this->assertNotNull($data['addresses'][0]['checked_at']);
        $this->assertNull($data['addresses'][0]['error_kind']);
        $this->assertEqualsCanonicalizing([$main, $accessible], $this->probedHosts());

        $cached = Cache::get(DomainCheckService::cacheKey($main));
        $this->assertSame(['resolves', 'certificate_expires_at', 'days_left', 'checked_at', 'error_kind'], array_keys($cached));

        $log = DB::table('activity_log')->where('action', 'platform_team_domain_check')->orderByDesc('id')->first();
        $this->assertNotNull($log);
        $this->assertNull($log->tenant_id, 'a platform-wide act is not stamped with the caller\'s community');
        $this->assertSame((int) $actor->id, (int) $log->user_id);
        $this->assertSame($id, (int) $log->entity_id);
    }

    public function test_an_unknown_community_is_a_404_and_nothing_is_contacted(): void
    {
        $this->actAsPlatformTeam();

        $this->apiPost(self::CHECK_URI, ['tenant_id' => 987654321])->assertStatus(404);
        $this->apiPost(self::CHECK_URI, [])->assertStatus(404);
        $this->apiPost(self::CHECK_URI, ['tenant_id' => 'abc'])->assertStatus(404);

        $this->assertSame([], $this->calls);
    }

    public function test_check_now_is_limited_to_six_a_minute(): void
    {
        $id = $this->community(['domain' => $this->host('limit')]);
        $this->actAsPlatformTeam();

        for ($i = 0; $i < 6; $i++) {
            $this->apiPost(self::CHECK_URI, ['tenant_id' => $id])->assertStatus(200);
        }
        $this->apiPost(self::CHECK_URI, ['tenant_id' => $id])->assertStatus(429);
    }

    /** @return array<string, array{0: string, 1: int, 2: string}> */
    public static function daysLeft(): array
    {
        return [
            '22 days' => ['+22 days 1 hour', 22, 'ok'],
            '21 days' => ['+21 days 1 hour', 21, 'warning'],
            '1 day' => ['+1 day 1 hour', 1, 'warning'],
            '0 days' => ['+1 hour', 0, 'warning'],
            'minus 1 day (expired)' => ['-1 hour', -1, 'failing'],
        ];
    }

    /** @dataProvider daysLeft */
    public function test_the_status_follows_the_days_left(string $expiry, int $days, string $status): void
    {
        $host = $this->host('days');
        $id = $this->community(['domain' => $host]);
        $this->behaviour[$host] = ['expiry' => $expiry];
        $this->actAsPlatformTeam();

        $this->apiPost(self::CHECK_URI, ['tenant_id' => $id])->assertStatus(200);
        $address = $this->rowFor($id)['addresses'][0];

        $this->assertSame($days, $address['days_left']);
        $this->assertSame($status, $address['status']);
        $this->assertNull($address['error_kind']);
    }

    public function test_days_left_is_counted_from_now_not_from_the_check(): void
    {
        $host = $this->host('aging');
        $id = $this->community(['domain' => $host]);
        $this->behaviour[$host] = ['expiry' => '+22 days 1 hour'];
        $this->actAsPlatformTeam();
        $this->apiPost(self::CHECK_URI, ['tenant_id' => $id])->assertStatus(200);

        Carbon::setTestNow(Carbon::now()->addDays(2));

        $address = $this->rowFor($id)['addresses'][0];
        $this->assertSame(20, $address['days_left']);
        $this->assertSame('warning', $address['status']);
    }

    /** @return array<string, array{0: array<string, mixed>, 1: string, 2: bool, 3: bool}> */
    public static function failures(): array
    {
        return [
            'does not resolve' => [['resolves' => false], 'does_not_resolve', false, false],
            'not a public address' => [['public' => false], 'not_a_public_address', true, false],
            'no answer' => [['throw' => 'no_answer'], 'no_answer', true, true],
            'certificate not trusted' => [['throw' => 'certificate_not_trusted'], 'certificate_not_trusted', true, true],
            'could not read the certificate' => [['throw' => 'could_not_read_certificate'], 'could_not_read_certificate', true, true],
            'an unexpected error' => [['throw' => 'runtime'], 'could_not_read_certificate', true, true],
            'a failure kind that is not on the list' => [['throw' => 'something_else'], 'could_not_read_certificate', true, true],
            'no expiry in the certificate' => [['expiry' => null], 'could_not_read_certificate', true, true],
        ];
    }

    /**
     * @dataProvider failures
     * @param array<string, mixed> $behaviour
     */
    public function test_each_kind_of_failure_is_failing_with_its_reason_and_no_error_text(array $behaviour, string $kind, bool $resolves, bool $connected): void
    {
        $host = $this->host('fail');
        $id = $this->community(['domain' => $host]);
        if (isset($behaviour['throw'])) {
            $behaviour['throw'] = $behaviour['throw'] === 'runtime'
                ? new \RuntimeException(self::PLANTED_TEXT)
                : new DomainProbeFailure($behaviour['throw'], self::PLANTED_TEXT);
        }
        $this->behaviour[$host] = $behaviour;
        $this->actAsPlatformTeam();

        $post = $this->apiPost(self::CHECK_URI, ['tenant_id' => $id])->assertStatus(200);
        $get = $this->apiGet(self::URI)->assertStatus(200);
        $address = $this->rowFor($id)['addresses'][0];

        $this->assertSame('failing', $address['status']);
        $this->assertSame($kind, $address['error_kind']);
        $this->assertSame($resolves, $address['resolves']);
        $this->assertNull($address['certificate_expires_at']);
        $this->assertNull($address['days_left']);
        $this->assertSame($connected, in_array(['certificateExpiry', $host], $this->calls, true));

        foreach ([$post->getContent(), $get->getContent(), json_encode(Cache::get(DomainCheckService::cacheKey($host)))] as $body) {
            $this->assertStringNotContainsString(self::PLANTED_IP, (string) $body);
            $this->assertStringNotContainsString('internal-db', (string) $body);
            $this->assertStringNotContainsString('203.0.113.10', (string) $body, 'no resolved address is sent or kept');
        }
    }

    public function test_a_host_that_fails_the_public_address_rule_is_never_connected_to(): void
    {
        $host = $this->host('private');
        $id = $this->community(['domain' => $host]);
        $this->behaviour[$host] = ['public' => false];
        $this->actAsPlatformTeam();

        $this->apiPost(self::CHECK_URI, ['tenant_id' => $id])->assertStatus(200);
        Artisan::call('domains:check');

        $this->assertNotContains(['certificateExpiry', $host], $this->calls);
        $this->assertContains(['publicAddresses', $host], $this->calls);
    }

    public function test_check_now_for_the_platform_rechecks_only_the_platforms_own_addresses(): void
    {
        $this->community(['domain' => $this->host('notme')]);
        $this->actAsPlatformTeam();

        $data = $this->apiPost(self::CHECK_URI, ['platform' => true])->assertStatus(200)->json('data');

        $platformHosts = CommunitySetupChecklistService::platformAddresses();
        $this->assertSame($platformHosts, array_column($data['platform'], 'host'));
        $this->assertEqualsCanonicalizing($platformHosts, $this->probedHosts());
        foreach ($data['platform'] as $row) {
            $this->assertSame('ok', $row['status']);
        }
    }

    public function test_the_command_checks_each_distinct_host_once_and_only_hosts_from_the_tenants_table_or_the_platform(): void
    {
        $shared = $this->host('shared');
        $a = $this->community(['domain' => $shared]);
        $b = $this->community(['accessible_domain' => $shared]);
        $failing = $this->host('down');
        $this->community(['domain' => $failing]);
        $this->behaviour[$failing] = ['resolves' => false];

        $exit = Artisan::call('domains:check');
        $output = Artisan::output();

        $this->assertSame(0, $exit, 'a failing host is a finding, not a command failure');
        $this->assertCount(1, array_filter($this->calls, static fn (array $c): bool => $c === ['resolves', $shared]));
        $this->assertStringContainsString($shared . ' ok', $output);
        $this->assertStringContainsString($failing . ' failing', $output);
        $this->assertStringNotContainsString(self::PLANTED_IP, $output);

        $known = [];
        foreach (DB::table('tenants')->select(['domain', 'accessible_domain'])->get() as $t) {
            foreach ([$t->domain, $t->accessible_domain] as $v) {
                if ($v !== null) {
                    $known[] = strtolower(trim((string) $v));
                }
            }
        }
        $known = array_merge($known, CommunitySetupChecklistService::platformAddresses());
        foreach ($this->probedHosts() as $probed) {
            $this->assertContains($probed, $known, "{$probed} is not in the tenants table or the platform's own list");
        }

        $this->actAsPlatformTeam();
        $this->assertSame('ok', $this->rowFor($a)['addresses'][0]['status']);
        $this->assertSame('ok', $this->rowFor($b)['addresses'][0]['status']);
    }

    public function test_it_is_scheduled_daily_at_0520_on_one_server_in_the_background_without_overlapping(): void
    {
        Artisan::call('list'); // boots the console kernel, which registers the schedule
        $event = collect($this->app->make(Schedule::class)->events())
            ->first(fn ($e): bool => is_string($e->command) && str_contains($e->command, 'domains:check'));

        $this->assertNotNull($event, 'domains:check is scheduled');
        $this->assertSame('20 5 * * *', $event->expression);
        $this->assertTrue($event->onOneServer);
        $this->assertTrue($event->runInBackground);
        $this->assertTrue($event->withoutOverlapping);
    }
}
