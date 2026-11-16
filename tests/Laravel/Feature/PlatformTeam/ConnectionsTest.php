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
        'openai', 'anthropic', 'gemini', 'google_maps', 'google_translate', 'meilisearch', 'sentry',
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

    public function test_nothing_can_be_changed_through_it(): void
    {
        $this->actAsPlatformTeam();

        foreach (['POST', 'PUT', 'DELETE'] as $method) {
            $status = $this->requestAs($method, self::URI, [])->getStatusCode();
            $this->assertContains($status, [404, 405], "{$method} answered {$status}");
        }
    }
}
