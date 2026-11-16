<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\PlatformTeam;

use App\Services\PlatformTeam\RecentErrorsService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * Platform team panel → Recent errors: three counts per part of the platform,
 * read by the server from the error service.
 *
 * 🔴 Switched off (no outside request at all) until a read-only key, the
 * organisation and the server's project id are on the server. Counts only:
 * never an issue's title, a message, a user, an address or a tag. The key is
 * never returned and never logged. No test touches the network: every request
 * is faked, and a request nobody faked fails the test.
 *
 * Every value below is made up.
 */
class RecentErrorsTest extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;

    private const URI = '/v2/platform-team/errors';

    /** Exactly what the page shows. Anything else must not leave the server. */
    private const TOP_KEYS = ['checked_at', 'connected', 'projects'];

    private const PROJECT_KEYS = ['available', 'errors_24h', 'errors_7d', 'key', 'unresolved'];

    private const TOKEN = 'tok_PLANTED_9f3kQ2mZx7Lw';

    private const BASE = 'https://errors.example.test/api/0';

    /** Planted in every faked answer: none of it may reach the response or the log. */
    private const PLANTED = [
        'Planted issue title about a member',
        'Gráinne Plantedsurname',
        'planted.member@example.test',
        'https://planted.example.test/page',
        'planted-tag-value',
    ];

    /** @var list<MessageLogged> */
    private array $logged = [];

    protected function setUp(): void
    {
        parent::setUp();
        Http::preventStrayRequests();
        Cache::forget(RecentErrorsService::CACHE_KEY);
        config([
            'services.sentry.api_token' => self::TOKEN,
            'services.sentry.org' => 'example-org',
            'services.sentry.api_base' => self::BASE,
            'services.sentry.projects' => ['php' => '1001', 'react' => '1002', 'webuk' => null],
        ]);
        $this->logged = [];
        Event::listen(MessageLogged::class, function (MessageLogged $event): void {
            $this->logged[] = $event;
        });
    }

    protected function tearDown(): void
    {
        // 🔴 parent::tearDown() rolls the test's transaction back: it must run
        // even if this line throws, or the open transaction keeps a lock that
        // every later test in the run waits on.
        try {
            Cache::forget(RecentErrorsService::CACHE_KEY);
        } finally {
            parent::tearDown();
        }
    }

    /** A healthy error service: counts per project and period, with planted detail around them. */
    private function fakeHealthy(): void
    {
        Http::fake(function (Request $request) {
            parse_str((string) parse_url($request->url(), PHP_URL_QUERY), $q);
            $project = (string) ($q['project'] ?? '');
            $base = $project === '1001' ? 10 : 20;

            if (str_contains($request->url(), '/events/')) {
                $count = ($q['statsPeriod'] ?? '') === '24h' ? $base + 1 : $base + 7;

                return Http::response([
                    'data' => [[
                        'count()' => $count,
                        'title' => self::PLANTED[0],
                        'user.display' => self::PLANTED[1],
                        'user.email' => self::PLANTED[2],
                        'url' => self::PLANTED[3],
                    ]],
                    'meta' => ['tags' => [self::PLANTED[4]]],
                ], 200);
            }

            return Http::response([[
                'title' => self::PLANTED[0],
                'culprit' => self::PLANTED[1],
                'metadata' => ['value' => self::PLANTED[2]],
                'permalink' => self::PLANTED[3],
                'tags' => [self::PLANTED[4]],
            ]], 200, ['X-Hits' => (string) ($base + 2)]);
        });
    }

    /** @return array<string, mixed> */
    private function data(string $uri = self::URI): array
    {
        $this->actAsPlatformTeam();

        return $this->apiGet($uri)->assertStatus(200)->json('data');
    }

    /** @param array<string, mixed> $array @return list<string> */
    private function sortedKeys(array $array): array
    {
        $keys = array_keys($array);
        sort($keys);

        return $keys;
    }

    /** @return array<string, array<string, mixed>> */
    private function byKey(array $projects): array
    {
        $out = [];
        foreach ($projects as $p) {
            $out[$p['key']] = $p;
        }

        return $out;
    }

    private function loggedText(): string
    {
        return implode("\n", array_map(
            fn (MessageLogged $e) => $e->level . ' ' . $e->message . ' ' . json_encode($e->context, JSON_PARTIAL_OUTPUT_ON_ERROR),
            $this->logged
        ));
    }

    public function test_only_the_platform_team_may_read_it(): void
    {
        $this->fakeHealthy();
        $this->assertPlatformTeamOnly('GET', self::URI);
    }

    public function test_without_a_key_it_asks_nobody_and_says_not_connected(): void
    {
        Http::fake([]);
        foreach ([
            ['services.sentry.api_token' => null],
            ['services.sentry.api_token' => '   '],
            ['services.sentry.org' => ''],
            ['services.sentry.projects' => ['php' => null, 'react' => '1002', 'webuk' => null]],
        ] as $missing) {
            config($missing);
            $data = $this->data();

            $this->assertSame(self::TOP_KEYS, $this->sortedKeys($data));
            $this->assertSame(['connected' => false, 'checked_at' => null, 'projects' => null], [
                'connected' => $data['connected'], 'checked_at' => $data['checked_at'], 'projects' => $data['projects'],
            ]);
            config([
                'services.sentry.api_token' => self::TOKEN,
                'services.sentry.org' => 'example-org',
                'services.sentry.projects' => ['php' => '1001', 'react' => '1002', 'webuk' => null],
            ]);
        }

        Http::assertNothingSent();
    }

    public function test_an_address_that_is_not_https_or_a_malformed_organisation_or_project_asks_nobody(): void
    {
        Http::fake([]);
        foreach ([
            ['services.sentry.api_base' => 'http://errors.example.test/api/0'],
            ['services.sentry.api_base' => 'ftp://errors.example.test/api/0'],
            ['services.sentry.api_base' => 'https://'],
            ['services.sentry.org' => 'example-org/../other'],
            ['services.sentry.org' => 'example org'],
            ['services.sentry.org' => str_repeat('a', 65)],
            ['services.sentry.projects' => ['php' => '10x1', 'react' => null, 'webuk' => null]],
            ['services.sentry.projects' => ['php' => '1001', 'react' => '1002&limit=100', 'webuk' => null]],
        ] as $bad) {
            config($bad);
            $data = $this->data();
            $this->assertFalse($data['connected'], 'Treated as connected: ' . json_encode($bad));
            $this->assertNull($data['projects']);
            config([
                'services.sentry.api_base' => self::BASE,
                'services.sentry.org' => 'example-org',
                'services.sentry.projects' => ['php' => '1001', 'react' => '1002', 'webuk' => null],
            ]);
        }

        Http::assertNothingSent();
    }

    public function test_it_sends_exactly_three_counts_per_configured_project_and_nothing_from_the_answers(): void
    {
        $this->fakeHealthy();
        $this->actAsPlatformTeam();
        $response = $this->apiGet(self::URI)->assertStatus(200);
        $data = $response->json('data');

        $this->assertSame(self::TOP_KEYS, $this->sortedKeys($data));
        $this->assertTrue($data['connected']);
        $this->assertNotNull($data['checked_at']);
        $this->assertNotFalse(strtotime($data['checked_at']));

        // The accessible site has no project id here, so it is not listed.
        $this->assertSame(['php', 'react'], array_column($data['projects'], 'key'));
        foreach ($data['projects'] as $project) {
            $this->assertSame(self::PROJECT_KEYS, $this->sortedKeys($project));
        }
        $projects = $this->byKey($data['projects']);
        $this->assertSame(['available' => true, 'errors_24h' => 11, 'errors_7d' => 17, 'key' => 'php', 'unresolved' => 12],
            array_combine(self::PROJECT_KEYS, array_map(fn ($k) => $projects['php'][$k], self::PROJECT_KEYS)));
        $this->assertSame(21, $projects['react']['errors_24h']);
        $this->assertSame(27, $projects['react']['errors_7d']);
        $this->assertSame(22, $projects['react']['unresolved']);

        $body = (string) $response->getContent();
        foreach ([...self::PLANTED, 'example.test', self::TOKEN, 'example-org', '1001'] as $planted) {
            $this->assertStringNotContainsString($planted, $body);
        }

        // Three requests per project; the issue list asks for one row only.
        Http::assertSentCount(6);
        Http::assertSent(function (Request $request) {
            parse_str((string) parse_url($request->url(), PHP_URL_QUERY), $q);
            $this->assertStringStartsWith(self::BASE . '/organizations/example-org/', $request->url());
            $this->assertSame(['Bearer ' . self::TOKEN], $request->header('Authorization'));
            $this->assertStringNotContainsString(self::TOKEN, $request->url());
            if (str_contains($request->url(), '/issues/')) {
                $this->assertSame('1', $q['limit'] ?? null);
                $this->assertSame('is:unresolved', $q['query'] ?? null);
            } else {
                $this->assertSame('errors', $q['dataset'] ?? null);
                $this->assertSame('count()', $q['field'] ?? null);
                $this->assertContains($q['statsPeriod'] ?? null, ['24h', '7d']);
            }

            return true;
        });
    }

    public function test_the_accessible_site_is_listed_when_its_project_is_set(): void
    {
        config(['services.sentry.projects' => ['php' => '1001', 'react' => null, 'webuk' => '1003']]);
        $this->fakeHealthy();

        $data = $this->data();

        $this->assertSame(['php', 'webuk'], array_column($data['projects'], 'key'));
        Http::assertSentCount(6);
    }

    public function test_a_missing_hits_header_leaves_that_figure_not_available_never_guessed(): void
    {
        Http::fake(function (Request $request) {
            if (str_contains($request->url(), '/events/')) {
                return Http::response(['data' => [['count()' => 4]]], 200);
            }
            parse_str((string) parse_url($request->url(), PHP_URL_QUERY), $q);

            // One row in the body would suggest "1"; without the header it is unknown.
            return ($q['project'] ?? '') === '1001'
                ? Http::response([['title' => self::PLANTED[0]]], 200)
                : Http::response([], 200, ['X-Hits' => 'lots']);
        });

        $projects = $this->byKey($this->data()['projects']);

        $this->assertTrue($projects['php']['available']);
        $this->assertSame(4, $projects['php']['errors_24h']);
        $this->assertNull($projects['php']['unresolved']);
        $this->assertTrue($projects['react']['available']);
        $this->assertNull($projects['react']['unresolved']);
    }

    /** @return array<string, array{0: callable}> */
    public static function failures(): array
    {
        return [
            'a timeout whose message carries the key and the address' => [fn () => throw new ConnectionException(
                'cURL error 28: timed out for ' . self::BASE . '/organizations/example-org/events/?token=' . self::TOKEN
            )],
            'a refusal' => [fn () => Http::response(['detail' => 'Invalid token ' . self::TOKEN], 401)],
            'a server error' => [fn () => Http::response('Planted issue title about a member', 500)],
            'a redirect elsewhere' => [fn () => Http::response('', 302, ['Location' => 'https://elsewhere.example.test/'])],
            'a body that is not JSON' => [fn () => Http::response('<html>Planted issue title about a member</html>', 200)],
            'a count that is not a number' => [fn () => Http::response(['data' => [['count()' => 'many']]], 200)],
            'a count that is missing' => [fn () => Http::response(['data' => []], 200)],
            'a negative count' => [fn () => Http::response(['data' => [['count()' => -3]]], 200)],
        ];
    }

    #[DataProvider('failures')]
    public function test_a_project_whose_requests_fail_is_not_available_never_zero_and_the_key_is_not_logged(callable $answer): void
    {
        Http::fake(function (Request $request) use ($answer) {
            parse_str((string) parse_url($request->url(), PHP_URL_QUERY), $q);
            if (($q['project'] ?? '') === '1002') {
                return $answer();
            }
            if (str_contains($request->url(), '/events/')) {
                return Http::response(['data' => [['count()' => 5]]], 200);
            }

            return Http::response([], 200, ['X-Hits' => '3']);
        });

        $this->actAsPlatformTeam();
        $response = $this->apiGet(self::URI)->assertStatus(200);
        $projects = $this->byKey($response->json('data.projects'));

        $this->assertSame(['available' => true, 'errors_24h' => 5, 'errors_7d' => 5, 'key' => 'php', 'unresolved' => 3],
            array_combine(self::PROJECT_KEYS, array_map(fn ($k) => $projects['php'][$k], self::PROJECT_KEYS)));
        $this->assertSame(['available' => false, 'errors_24h' => null, 'errors_7d' => null, 'key' => 'react', 'unresolved' => null],
            array_combine(self::PROJECT_KEYS, array_map(fn ($k) => $projects['react'][$k], self::PROJECT_KEYS)));

        // Exactly one error line, naming the project, and nothing secret in any line.
        $errors = array_values(array_filter($this->logged, fn (MessageLogged $e) => $e->level === 'error'));
        $this->assertCount(1, $errors, $this->loggedText());
        $this->assertSame('react', $errors[0]->context['project'] ?? null);
        $this->assertArrayHasKey('status', $errors[0]->context);
        $this->assertArrayHasKey('exception', $errors[0]->context);

        $log = $this->loggedText();
        $body = (string) $response->getContent();
        foreach ([self::TOKEN, substr(self::TOKEN, 4, 12), 'example.test', 'Planted issue title', '/organizations/'] as $secret) {
            $this->assertStringNotContainsString($secret, $log);
            $this->assertStringNotContainsString($secret, $body);
        }
    }

    public function test_redirects_are_not_followed(): void
    {
        // A flag, not $this->fail(): the service catches what a request throws.
        $followed = false;
        Http::fake(function (Request $request) use (&$followed) {
            if (str_contains($request->url(), 'elsewhere.example.test')) {
                $followed = true;

                return Http::response(['data' => [['count()' => 1]]], 200, ['X-Hits' => '1']);
            }

            return Http::response('', 302, ['Location' => 'https://elsewhere.example.test/steal']);
        });

        $projects = $this->data()['projects'];

        $this->assertFalse($followed, 'A redirect was followed, taking the key with it');
        $this->assertFalse($projects[0]['available']);
        $this->assertFalse($projects[1]['available']);
        // A project stops at its first failed request: one request each.
        Http::assertSentCount(2);
    }

    public function test_the_answer_is_kept_five_minutes_and_refresh_asks_again(): void
    {
        $this->fakeHealthy();

        $first = $this->data();
        $second = $this->data();
        Http::assertSentCount(6);
        $this->assertSame($first, $second);

        $this->data(self::URI . '?refresh=1');
        Http::assertSentCount(12);

        $this->travel(RecentErrorsService::CACHE_SECONDS + 1)->seconds();
        $this->data();
        Http::assertSentCount(18);
    }

    public function test_taking_the_key_away_stops_the_kept_answer_being_shown(): void
    {
        $this->fakeHealthy();
        $this->assertTrue($this->data()['connected']);

        config(['services.sentry.api_token' => null]);

        $data = $this->data();
        $this->assertFalse($data['connected']);
        $this->assertNull($data['projects']);
    }

    public function test_asking_again_is_limited_to_six_a_minute(): void
    {
        $this->fakeHealthy();
        $this->actAsPlatformTeam();

        for ($i = 1; $i <= 6; $i++) {
            $this->apiGet(self::URI . '?refresh=1')->assertStatus(200);
        }
        $this->apiGet(self::URI . '?refresh=1')->assertStatus(429);

        // Reading the kept answer is not limited.
        $this->apiGet(self::URI)->assertStatus(200);
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
