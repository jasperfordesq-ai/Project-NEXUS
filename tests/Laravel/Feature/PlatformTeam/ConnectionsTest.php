<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\PlatformTeam;

use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * Platform team panel → Keys and connections: for each outside service, only
 * whether this server has a key for it. 🔴 Never a value, a masked value, a
 * length, or any character of one.
 */
class ConnectionsTest extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;

    private const URI = '/v2/platform-team/connections';

    private const ROW_KEYS = ['configured', 'group', 'key'];

    private const EXPECTED_KEYS = [
        'gmail_api', 'postmark', 'smtp', 'pusher', 'fcm', 'expo', 'web_push', 'stripe', 'stripe_webhook',
        'openai', 'anthropic', 'gemini', 'google_maps', 'google_translate', 'meilisearch', 'sentry', 'sentry_api',
        'cloudflare_origin', 'turnstile', 'clamav', 'slack_slo_alerts', 'slack_email_alerts',
        'google_sign_in', 'facebook_sign_in', 'apple_sign_in', 'mailchimp', 'file_storage',
    ];

    /** Made-up values only. Each must not appear, in any 4-character piece, in the response. */
    private const PLANTED = [
        'services.stripe.secret' => 'sk_test_ZQXJ4489PLMN',
        'services.openai.api_key' => 'oa_KWVB7720HGFD',
        'services.pusher.secret' => 'pu_YTRE5531MNBV',
        'mail.postmark.server_token' => 'pm_LKJH9902QWSX',
        'services.cloudflare.origin_secret' => 'cf_ASDF6614ZXCV',
        // Not a real DSN shape: "http" is in every response (meta.base_url).
        'sentry.dsn' => 'dsn_WERT8812BNMJ',
    ];

    /** @return array<string, array{group: string, configured: bool}> */
    private function rows(): array
    {
        $this->actAsPlatformTeam();
        $data = $this->apiGet(self::URI)->assertStatus(200)->json('data');

        $out = [];
        foreach ($data['connections'] as $row) {
            $out[$row['key']] = ['group' => $row['group'], 'configured' => $row['configured']];
        }

        return $out;
    }

    public function test_only_the_platform_team_may_read_it(): void
    {
        $this->assertPlatformTeamOnly('GET', self::URI);
    }

    public function test_it_sends_exactly_the_key_the_group_and_whether_it_is_set_up(): void
    {
        $this->actAsPlatformTeam();
        $data = $this->apiGet(self::URI)->assertStatus(200)->json('data');

        $this->assertSame(['connections'], array_keys($data));
        $keys = [];
        foreach ($data['connections'] as $row) {
            $rowKeys = array_keys($row);
            sort($rowKeys);
            $this->assertSame(self::ROW_KEYS, $rowKeys);
            $this->assertIsBool($row['configured']);
            $this->assertIsString($row['group']);
            $keys[] = $row['key'];
        }
        $this->assertSame(self::EXPECTED_KEYS, $keys);
    }

    public function test_no_piece_of_any_value_leaves_the_server(): void
    {
        config(self::PLANTED);
        $before = getenv('GOOGLE_MAPS_API_KEY');
        $mapsKey = 'gm_POIU3378RTYU';
        putenv("GOOGLE_MAPS_API_KEY={$mapsKey}");

        try {
            $this->actAsPlatformTeam();
            $response = $this->apiGet(self::URI)->assertStatus(200);
        } finally {
            putenv($before === false ? 'GOOGLE_MAPS_API_KEY' : "GOOGLE_MAPS_API_KEY={$before}");
        }

        $body = (string) $response->getContent();
        foreach ([...array_values(self::PLANTED), $mapsKey] as $value) {
            for ($i = 0; $i + 4 <= strlen($value); $i++) {
                $piece = substr($value, $i, 4);
                $this->assertStringNotContainsString($piece, $body, "A piece of a planted value left the server: {$piece}");
            }
        }

        $rows = [];
        foreach ($response->json('data.connections') as $row) {
            $rows[$row['key']] = $row['configured'];
        }
        $this->assertTrue($rows['stripe']);
        $this->assertTrue($rows['openai']);
        $this->assertTrue($rows['postmark']);
        $this->assertTrue($rows['cloudflare_origin']);
        $this->assertTrue($rows['sentry']);
        $this->assertTrue($rows['google_maps']);
    }

    public function test_an_empty_or_missing_value_is_not_set_up(): void
    {
        config([
            'services.stripe.secret' => '',
            'services.openai.api_key' => null,
            'services.anthropic.api_key' => '   ',
            'services.expo.access_token' => '',
            'turnstile.secret' => 'ts_secret_only',
            'turnstile.site_key' => '',
            'services.pusher.key' => 'pk',
            'services.pusher.secret' => 'ps',
            'services.pusher.app_id' => '',
            'services.vapid.public_key' => 'pub',
            'services.vapid.private_key' => null,
            'services.fcm.service_account_path' => '/nonexistent/firebase.json',
            'services.fcm.server_key' => '',
            'services.clamav.address' => '',
        ]);

        $rows = $this->rows();

        foreach (['stripe', 'openai', 'anthropic', 'expo', 'turnstile', 'pusher', 'web_push', 'fcm', 'clamav'] as $key) {
            $this->assertFalse($rows[$key]['configured'], "{$key} must be not set up");
        }
    }

    public function test_services_that_need_several_values_are_set_up_only_with_all_of_them(): void
    {
        config([
            'services.pusher.key' => 'pk',
            'services.pusher.secret' => 'ps',
            'services.pusher.app_id' => '123',
            'services.vapid.public_key' => 'pub',
            'services.vapid.private_key' => 'priv',
            'turnstile.secret' => 'ts',
            'turnstile.site_key' => 'tk',
            'services.fcm.service_account_path' => '/nonexistent/firebase.json',
            'services.fcm.server_key' => 'legacy',
            'filesystems.default' => 's3',
        ]);

        $rows = $this->rows();

        foreach (['pusher', 'web_push', 'turnstile', 'fcm', 'file_storage'] as $key) {
            $this->assertTrue($rows[$key]['configured'], "{$key} must be set up");
        }
        $this->assertSame('notifications', $rows['fcm']['group']);
        $this->assertSame('email', $rows['gmail_api']['group']);
    }

    /**
     * SearchService::client() falls back to a built-in address and works
     * with no key, so either value set means the search engine is set up.
     */
    public function test_search_is_set_up_with_either_the_address_or_the_key(): void
    {
        $host = getenv('MEILISEARCH_HOST');
        $key = getenv('MEILISEARCH_KEY');
        try {
            $cases = [
                [null, null, false],
                ['http://search.example.test:7700', null, true],
                [null, 'search-key-planted', true],
                ['http://search.example.test:7700', 'search-key-planted', true],
            ];
            foreach ($cases as [$h, $k, $expected]) {
                putenv($h === null ? 'MEILISEARCH_HOST' : "MEILISEARCH_HOST={$h}");
                putenv($k === null ? 'MEILISEARCH_KEY' : "MEILISEARCH_KEY={$k}");

                $this->assertSame(
                    $expected,
                    $this->rows()['meilisearch']['configured'],
                    'host ' . ($h ?? 'unset') . ', key ' . ($k === null ? 'unset' : 'set'),
                );
            }
        } finally {
            putenv($host === false ? 'MEILISEARCH_HOST' : "MEILISEARCH_HOST={$host}");
            putenv($key === false ? 'MEILISEARCH_KEY' : "MEILISEARCH_KEY={$key}");
        }
    }

    public function test_gmail_with_the_switch_off_is_not_set_up_even_with_all_three_values(): void
    {
        config([
            'mail.gmail_api.enabled' => false,
            'mail.gmail_api.client_id' => 'id',
            'mail.gmail_api.client_secret' => 'secret',
            'mail.gmail_api.refresh_token' => 'token',
        ]);
        $this->assertFalse($this->rows()['gmail_api']['configured']);

        config(['mail.gmail_api.enabled' => true]);
        $this->assertTrue($this->rows()['gmail_api']['configured']);

        config(['mail.gmail_api.refresh_token' => '']);
        $this->assertFalse($this->rows()['gmail_api']['configured']);
    }

    /**
     * Reading figures from the error service (the Recent errors page) needs its
     * own read-only key, the organisation and the server's project id: all
     * three, and none of them leaves the server. Made-up values only.
     */
    public function test_reading_error_figures_is_set_up_only_with_the_key_the_organisation_and_the_project(): void
    {
        $all = [
            'services.sentry.api_token' => 'tok_PLANTED_CONN_7k2Q',
            'services.sentry.org' => 'example-org',
            'services.sentry.api_base' => 'https://errors.example.test/api/0',
            'services.sentry.projects' => ['php' => '1001', 'react' => null, 'webuk' => null],
        ];

        config(array_merge($all, ['services.sentry.api_token' => null, 'services.sentry.org' => null,
            'services.sentry.projects' => ['php' => null, 'react' => null, 'webuk' => null]]));
        $this->assertFalse($this->rows()['sentry_api']['configured'], 'nothing set');

        config(array_merge($all, ['services.sentry.api_token' => '']));
        $this->assertFalse($this->rows()['sentry_api']['configured'], 'no key');

        config(array_merge($all, ['services.sentry.projects' => ['php' => null, 'react' => '1002', 'webuk' => null]]));
        $this->assertFalse($this->rows()['sentry_api']['configured'], 'no server project');

        config($all);
        $this->actAsPlatformTeam();
        $response = $this->apiGet(self::URI)->assertStatus(200);
        $rows = [];
        foreach ($response->json('data.connections') as $row) {
            $rows[$row['key']] = $row;
        }
        $this->assertTrue($rows['sentry_api']['configured']);
        $this->assertSame('error_reports', $rows['sentry_api']['group']);
        $body = (string) $response->getContent();
        foreach (['PLAN', 'CONN', '7k2Q', 'example-org', '1001'] as $piece) {
            $this->assertStringNotContainsString($piece, $body);
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
