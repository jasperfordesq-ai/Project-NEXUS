<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\PlatformTeam;

use App\Services\EmailMonitorService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * The Platform team panel's home page: one request, `GET /v2/platform-team/health`,
 * that says whether the things the whole platform runs on are working.
 *
 * Two rules matter more than any single card:
 *
 *   - it is the platform team's only (it describes the installation, not a
 *     community);
 *   - a check that could not be read is reported as `unknown`. It is never
 *     reported as `ok`, and it stops the overall verdict from being `ok`.
 */
class PlatformHealthSummaryTest extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;

    private const URI = '/v2/platform-team/health';

    private const CARDS = [
        'release', 'database', 'cache', 'disk', 'queue', 'failed_jobs',
        'cron', 'email', 'search', 'snapshots', 'maintenance', 'access_review',
    ];

    private const STATUSES = ['ok', 'warning', 'failing', 'unknown'];

    /** @return array<string, array{status: string, facts: array<string, mixed>}> */
    private function cards(): array
    {
        $response = $this->apiGet(self::URI)->assertStatus(200);
        $cards = [];
        foreach ($response->json('data.cards') as $card) {
            $facts = [];
            foreach ($card['facts'] as $fact) {
                $facts[$fact['key']] = $fact['value'];
            }
            $cards[$card['key']] = ['status' => $card['status'], 'facts' => $facts];
        }

        return $cards;
    }

    public function test_only_the_platform_team_may_read_it(): void
    {
        $this->assertPlatformTeamOnly('GET', self::URI);
    }

    public function test_it_reports_every_card_with_a_status_from_the_closed_list(): void
    {
        $this->actAsPlatformTeam();
        $response = $this->apiGet(self::URI)->assertStatus(200);

        $this->assertSame(self::CARDS, array_column($response->json('data.cards'), 'key'));
        foreach ($response->json('data.cards') as $card) {
            $this->assertContains($card['status'], self::STATUSES, "card {$card['key']}");
            $this->assertIsArray($card['facts']);
            foreach ($card['facts'] as $fact) {
                $this->assertSame(['key', 'value', 'type'], array_keys($fact), "card {$card['key']}");
                $this->assertContains($fact['type'], ['text', 'count', 'datetime', 'bool', 'percent']);
            }
        }
        $this->assertContains($response->json('data.overall'), self::STATUSES);
        $this->assertNotFalse(strtotime((string) $response->json('data.generated_at')));
    }

    public function test_a_check_that_cannot_be_read_is_unknown_never_ok(): void
    {
        $this->mock(EmailMonitorService::class, function ($mock): void {
            $mock->shouldReceive('getWarnings')->andThrow(new \RuntimeException('email log unreadable'));
        });
        $this->actAsPlatformTeam();

        $response = $this->apiGet(self::URI)->assertStatus(200);
        $email = collect($response->json('data.cards'))->firstWhere('key', 'email');

        $this->assertSame('unknown', $email['status']);
        $this->assertSame([], $email['facts']);
        $this->assertNotSame('ok', $response->json('data.overall'), 'an unread check must not leave the overall verdict at ok');
        // The reason stays in the server log; it is not sent to the browser.
        $this->assertStringNotContainsString('email log unreadable', (string) $response->getContent());
    }

    public function test_the_background_jobs_card_follows_the_recorded_verdict(): void
    {
        $this->actAsPlatformTeam();

        Cache::forget('queue_heartbeat:status');
        $this->assertSame('unknown', $this->cards()['queue']['status'], 'no verdict recorded');

        Cache::put('queue_heartbeat:status', ['state' => 'ok', 'checked_at' => time()], 600);
        $this->assertSame('ok', $this->cards()['queue']['status']);

        Cache::put('queue_heartbeat:status', ['state' => 'pending', 'checked_at' => time()], 600);
        $this->assertSame('warning', $this->cards()['queue']['status']);

        Cache::put('queue_heartbeat:status', ['state' => 'failed', 'checked_at' => time(), 'lag_seconds' => 1500], 600);
        $queue = $this->cards()['queue'];
        $this->assertSame('failing', $queue['status']);
        $this->assertSame(1500, $queue['facts']['lag_seconds']);
        $this->assertSame('failing', $this->apiGet(self::URI)->json('data.overall'));

        // A verdict nobody has refreshed for hours says nothing about now.
        Cache::put('queue_heartbeat:status', ['state' => 'ok', 'checked_at' => time() - 7200], 600);
        $this->assertSame('unknown', $this->cards()['queue']['status'], 'a stale verdict');
    }

    public function test_failed_background_jobs_are_counted_and_nothing_inside_them_is_sent(): void
    {
        $this->actAsPlatformTeam();
        $before = (int) ($this->cards()['failed_jobs']['facts']['failed_count'] ?? 0);

        DB::table('failed_jobs')->insert([
            'uuid' => (string) Str::uuid(),
            'connection' => 'redis',
            'queue' => 'default',
            'payload' => json_encode(['displayName' => 'SendWelcomeEmail', 'data' => ['email' => 'secret.member@example.test']]),
            'exception' => 'RuntimeException: could not reach secret.member@example.test',
            'failed_at' => now(),
        ]);

        $response = $this->apiGet(self::URI)->assertStatus(200);
        $card = collect($response->json('data.cards'))->firstWhere('key', 'failed_jobs');
        $facts = collect($card['facts'])->pluck('value', 'key');

        $this->assertSame('warning', $card['status']);
        $this->assertSame($before + 1, $facts['failed_count']);
        $this->assertNotNull($facts['newest_failed_at']);
        $this->assertStringNotContainsString('secret.member', (string) $response->getContent());
    }

    public function test_maintenance_mode_is_reported_as_a_state_to_notice(): void
    {
        $this->actAsPlatformTeam();
        $before = (int) $this->cards()['maintenance']['facts']['communities'];

        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'general.maintenance_mode'],
            ['setting_value' => 'true'],
        );

        $card = $this->cards()['maintenance'];
        $this->assertSame('warning', $card['status']);
        $this->assertGreaterThanOrEqual($before, $card['facts']['communities']);
        $this->assertGreaterThanOrEqual(1, $card['facts']['communities']);
        $this->assertIsBool($card['facts']['platform_wide']);
    }

    public function test_what_is_live_names_the_version(): void
    {
        $this->actAsPlatformTeam();
        $release = $this->cards()['release'];

        $this->assertSame((string) config('app.version'), $release['facts']['version']);
        $this->assertArrayHasKey('commit', $release['facts']);
        $this->assertArrayHasKey('deployed_at', $release['facts']);
    }

    /** Access review: due with none recorded, fine right after one, due again after 90 days. */
    public function test_the_access_review_card_follows_the_newest_review(): void
    {
        $me = $this->actAsPlatformTeam();
        $this->assertSame(0, DB::table('senior_access_reviews')->count(), 'this test needs a database with no review in it');

        $card = $this->cards()['access_review'];
        $this->assertSame('warning', $card['status']);
        $this->assertTrue($card['facts']['review_due']);
        $this->assertArrayNotHasKey('last_review_at', $card['facts']);

        DB::table('senior_access_reviews')->insert([
            'reviewed_by' => $me->id, 'account_count' => 1, 'remove_count' => 0, 'created_at' => now()->subDays(91),
        ]);
        $card = $this->cards()['access_review'];
        $this->assertSame('warning', $card['status']);
        $this->assertNotNull($card['facts']['last_review_at']);

        DB::table('senior_access_reviews')->insert([
            'reviewed_by' => $me->id, 'account_count' => 1, 'remove_count' => 0, 'created_at' => now()->subDays(2),
        ]);
        $card = $this->cards()['access_review'];
        $this->assertSame('ok', $card['status']);
        $this->assertFalse($card['facts']['review_due']);
    }

    public function test_the_access_review_card_is_unknown_when_it_cannot_be_read(): void
    {
        $this->actAsPlatformTeam();
        $broken = true;
        DB::connection()->beforeExecuting(static function (string $sql) use (&$broken): void {
            if ($broken && str_contains($sql, 'from `senior_access_reviews`')) {
                throw new \RuntimeException('review table unreadable');
            }
        });

        try {
            $response = $this->apiGet(self::URI)->assertStatus(200);
        } finally {
            $broken = false;
        }
        $card = collect($response->json('data.cards'))->firstWhere('key', 'access_review');

        $this->assertSame('unknown', $card['status']);
        $this->assertSame([], $card['facts']);
        $this->assertStringNotContainsString('review table unreadable', (string) $response->getContent());
    }
}
