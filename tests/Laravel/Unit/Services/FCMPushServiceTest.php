<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\FCMPushService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Queue;
use App\Jobs\CheckExpoPushReceipts;

class FCMPushServiceTest extends TestCase
{
    private FCMPushService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new FCMPushService();
    }

    // =========================================================================
    // sendToUser() — static, requires FCM config
    // =========================================================================

    public function test_sendToUser_returns_not_configured_when_no_credentials(): void
    {
        // Without firebase credentials, should return not configured
        $result = FCMPushService::sendToUser(1, 'Title', 'Body');

        $this->assertArrayHasKey('sent', $result);
        $this->assertArrayHasKey('failed', $result);
        $this->assertArrayHasKey('errors', $result);
        // Since we have no FCM config in test env
        $this->assertEquals(0, $result['sent']);
    }

    public function test_sendToUsers_returns_early_for_empty_user_ids(): void
    {
        $result = FCMPushService::sendToUsers([], 'Title', 'Body');

        $this->assertEquals(0, $result['sent']);
        $this->assertEquals(0, $result['failed']);
        $this->assertEmpty($result['errors']);
    }

    public function test_sendToUser_sends_expo_tokens_through_expo_push_api_without_fcm_credentials(): void
    {
        Queue::fake();
        config([
            'services.fcm.server_key' => null,
            'services.fcm.project_id' => null,
            'services.fcm.service_account_path' => base_path('missing-firebase-service-account.json'),
        ]);

        Http::fake([
            'https://exp.host/--/api/v2/push/send' => Http::response([
                'data' => [
                    ['status' => 'ok', 'id' => 'ticket-1'],
                ],
            ], 200),
        ]);

        $query = \Mockery::mock();
        $query->shouldReceive('where')->with('user_id', 1)->once()->andReturnSelf();
        $query->shouldReceive('where')->with('tenant_id', $this->testTenantId)->once()->andReturnSelf();
        $query->shouldReceive('pluck')->with('token')->once()->andReturn(collect(['ExponentPushToken[abc123]']));
        DB::shouldReceive('table')->with('fcm_device_tokens')->once()->andReturn($query);

        $result = FCMPushService::sendToUser(1, 'New message', 'You have a new message.', [
            'link' => '/messages/123',
        ]);

        $this->assertSame(1, $result['sent']);
        $this->assertSame(0, $result['failed']);
        Queue::assertPushed(CheckExpoPushReceipts::class, function (CheckExpoPushReceipts $job): bool {
            return $job->ticketTokens === ['ticket-1' => 'ExponentPushToken[abc123]'];
        });

        Http::assertSent(function ($request) {
            $payload = $request->data();

            return $request->url() === 'https://exp.host/--/api/v2/push/send'
                && $payload['to'] === 'ExponentPushToken[abc123]'
                && $payload['title'] === 'New Notification'
                && $payload['body'] === 'Open Timebank Global to view this private update.'
                && $payload['channelId'] === 'default'
                && $payload['data'] === [
                    'schema_version' => '1',
                    'link' => '/messages/123',
                ];
        });
    }

    public function test_batch_preference_filter_accepts_legacy_defaults_and_excludes_explicit_opt_outs(): void
    {
        $method = new \ReflectionMethod(FCMPushService::class, 'recipientPushEnabled');

        $this->assertTrue($method->invoke(null, null));
        $this->assertTrue($method->invoke(null, '{}'));
        $this->assertTrue($method->invoke(null, '{"push_enabled":1}'));
        $this->assertFalse($method->invoke(null, '{"push_enabled":0}'));
        $this->assertFalse($method->invoke(null, ['push_enabled' => false]));
    }

    public function test_sendToUser_renders_lock_screen_copy_in_the_recipient_locale(): void
    {
        Queue::fake();
        config([
            'services.fcm.server_key' => null,
            'services.fcm.project_id' => null,
            'services.fcm.service_account_path' => base_path('missing-firebase-service-account.json'),
        ]);

        Http::fake([
            'https://exp.host/--/api/v2/push/send' => Http::response([
                'data' => [['status' => 'ok', 'id' => 'ticket-ga']],
            ], 200),
        ]);

        $tokenQuery = \Mockery::mock();
        $tokenQuery->shouldReceive('where')->with('user_id', 1)->once()->andReturnSelf();
        $tokenQuery->shouldReceive('where')->with('tenant_id', $this->testTenantId)->once()->andReturnSelf();
        $tokenQuery->shouldReceive('pluck')->with('token')->once()->andReturn(collect(['ExponentPushToken[ga123]']));

        $userQuery = \Mockery::mock();
        // getNotificationPreferences() and the locale lookup both address this user.
        $userQuery->shouldReceive('where')->with('id', 1)->twice()->andReturnSelf();
        $userQuery->shouldReceive('where')->with('tenant_id', $this->testTenantId)->twice()->andReturnSelf();
        $userQuery->shouldReceive('value')->with('preferred_language')->once()->andReturn('ga');

        DB::shouldReceive('table')->with('fcm_device_tokens')->once()->andReturn($tokenQuery);
        DB::shouldReceive('table')->with('users')->twice()->andReturn($userQuery);

        $result = FCMPushService::sendToUser(1, 'New Message', 'Private English body', [
            'type' => 'new_message',
            'link' => '/notifications',
            'display_title_safe' => '1',
        ]);

        $this->assertSame(1, $result['sent']);
        Http::assertSent(function ($request): bool {
            $payload = $request->data();

            return $payload['title'] === 'Teachtaireacht Nua'
                && $payload['body'] === 'Oscail Timebank Global chun an nuashonrú príobháideach seo a fheiceáil.';
        });
    }

    public function test_native_payload_removes_confidential_content_and_unsafe_navigation_data(): void
    {
        $method = new \ReflectionMethod(FCMPushService::class, 'lockScreenSafePresentation');
        $method->setAccessible(true);

        [$title, $body, $data] = $method->invoke(null, 'GDPR request from Jane Doe', 'Delete Jane Doe account', [
            'type' => 'gdpr_account_deletion',
            'member_name' => 'Jane Doe',
            'link' => '/admin/gdpr',
            'priority' => 'high',
            'alert_type' => 'emergency',
            'alert_id' => '91',
        ]);

        $this->assertSame('Security', $title);
        $this->assertSame('Open Timebank Global to view this private update.', $body);
        $this->assertSame([
            'schema_version' => '1',
            'link' => '/notifications',
            'type' => 'gdpr_account_deletion',
        ], $data);
    }

    public function test_native_payload_keeps_a_curated_title_and_safe_internal_destination(): void
    {
        $method = new \ReflectionMethod(FCMPushService::class, 'lockScreenSafePresentation');
        $method->setAccessible(true);

        [$title, $body, $data] = $method->invoke(null, 'New Message', 'Private message contents', [
            'schema_version' => '1',
            'type' => 'new_message',
            'link' => '/messages/123?context_type=listing&context_id=44',
            'display_title_safe' => '1',
            'sender_name' => 'Jane Doe',
        ]);

        $this->assertSame('New Message', $title);
        $this->assertSame('Open Timebank Global to view this private update.', $body);
        $this->assertSame([
            'schema_version' => '1',
            'link' => '/messages/123?context_type=listing&context_id=44',
            'type' => 'new_message',
        ], $data);
    }

    public function test_direct_typed_payload_uses_a_translated_privacy_safe_category_title(): void
    {
        $method = new \ReflectionMethod(FCMPushService::class, 'lockScreenSafePresentation');
        $method->setAccessible(true);

        [$title, $body, $data] = $method->invoke(null, 'Reminder: Private event name', 'Private event details', [
            'type' => 'event_reminder',
            'link' => '/events/44',
        ]);

        $this->assertSame('Event', $title);
        $this->assertSame('Open Timebank Global to view this private update.', $body);
        $this->assertSame([
            'schema_version' => '1',
            'link' => '/events/44',
            'type' => 'event_reminder',
        ], $data);
    }

    public function test_native_payload_rejects_external_and_credential_bearing_destinations(): void
    {
        $method = new \ReflectionMethod(FCMPushService::class, 'lockScreenSafePresentation');
        $method->setAccessible(true);

        foreach ([
            'https://evil.example/messages/123',
            '/password/reset?token=secret-value',
            '/support-actions/confirm/secret-value',
            '/hour-timebank/admin/gdpr',
            '//evil.example/messages/123',
            'https://member:secret@app.project-nexus.ie/messages/123',
            'https://app.project-nexus.ie:444/messages/123',
            '/messages/123#token=secret-value',
            '/marketplace/reports/42',
        ] as $unsafeLink) {
            [, , $data] = $method->invoke(null, 'Security update', 'Private contents', [
                'type' => 'security',
                'link' => $unsafeLink,
                'display_title_safe' => '1',
            ]);

            $this->assertSame([
                'schema_version' => '1',
                'link' => '/notifications',
                'type' => 'security',
            ], $data, "Unsafe push destination was retained: {$unsafeLink}");
        }
    }

    public function test_native_payload_keeps_a_supported_benign_anchor_for_exact_native_routing(): void
    {
        $method = new \ReflectionMethod(FCMPushService::class, 'lockScreenSafePresentation');
        $method->setAccessible(true);

        [, , $data] = $method->invoke(null, 'Comment', 'Private contents', [
            'type' => 'comment',
            'link' => '/groups/44#discussion-91',
        ]);

        $this->assertSame('/groups/44#discussion-91', $data['link']);

        [, , $jobData] = $method->invoke(null, 'Application', 'Private contents', [
            'type' => 'job_application',
            'link' => '/jobs/42#applications',
        ]);
        $this->assertSame('/jobs/42#applications', $jobData['link']);

        [, , $commentsData] = $method->invoke(null, 'Comments', 'Private contents', [
            'type' => 'comment',
            'link' => '/events/42#comments',
        ]);
        $this->assertSame('/events/42#comments', $commentsData['link']);

        [, , $commentData] = $method->invoke(null, 'Comment', 'Private contents', [
            'type' => 'comment',
            'link' => '/feed/posts/42#comment-91',
        ]);
        $this->assertSame('/feed/posts/42#comment-91', $commentData['link']);

        [, , $unknownData] = $method->invoke(null, 'Update', 'Private contents', [
            'type' => 'update',
            'link' => '/events/42#arbitrary-command',
        ]);
        $this->assertSame('/events/42', $unknownData['link']);
    }

    public function test_expo_fanout_is_split_at_the_provider_limit(): void
    {
        Queue::fake();
        $tokens = array_map(static fn (int $index): string => "ExponentPushToken[device-{$index}]", range(1, 101));
        $requestNumber = 0;
        Http::fake([
            'https://exp.host/--/api/v2/push/send' => function ($request) use (&$requestNumber) {
                $payload = $request->data();
                $messages = isset($payload['to']) ? [$payload] : $payload;
                $tickets = [];
                foreach ($messages as $message) {
                    $requestNumber++;
                    $tickets[] = ['status' => 'ok', 'id' => 'ticket-' . $requestNumber];
                }
                return Http::response(['data' => $tickets], 200);
            },
        ]);

        $send = new \ReflectionMethod(FCMPushService::class, 'sendToExpoTokens');
        $result = $send->invoke(null, $tokens, 'Update', 'Open the app.', ['link' => '/notifications']);

        $this->assertSame(101, $result['sent']);
        $this->assertSame(0, $result['failed']);
        Http::assertSentCount(2);
        Queue::assertPushed(CheckExpoPushReceipts::class, 2);
    }

    public function test_expo_retries_a_transient_provider_failure_and_uses_optional_access_token(): void
    {
        Queue::fake();
        config(['services.expo.access_token' => 'expo-access-secret']);
        Http::fake([
            'https://exp.host/--/api/v2/push/send' => Http::sequence()
                ->push(['errors' => [['message' => 'busy']]], 503)
                ->push(['data' => [['status' => 'ok', 'id' => 'ticket-retried']]], 200),
        ]);

        $send = new \ReflectionMethod(FCMPushService::class, 'sendToExpoTokens');
        $result = $send->invoke(
            null,
            ['ExponentPushToken[retry-device]'],
            'Update',
            'Open the app.',
            ['link' => '/notifications'],
        );

        $this->assertSame(1, $result['sent']);
        Http::assertSentCount(2);
        Http::assertSent(fn ($request): bool => $request->hasHeader('Authorization', 'Bearer expo-access-secret'));
    }

    public function test_expo_does_not_retry_a_permanent_client_error(): void
    {
        Queue::fake();
        Http::fake([
            'https://exp.host/--/api/v2/push/send' => Http::sequence()
                ->push(['errors' => [['message' => 'bad request']]], 400)
                ->push(['data' => [['status' => 'ok', 'id' => 'must-not-be-used']]], 200),
        ]);

        $send = new \ReflectionMethod(FCMPushService::class, 'sendToExpoTokens');
        $result = $send->invoke(
            null,
            ['ExponentPushToken[bad-request-device]'],
            'Update',
            'Open the app.',
            ['link' => '/notifications'],
        );

        $this->assertSame(0, $result['sent']);
        $this->assertSame(1, $result['failed']);
        Http::assertSentCount(1);
    }

    public function test_legacy_credential_and_project_mismatch_errors_do_not_erase_device_tokens(): void
    {
        config([
            'services.fcm.server_key' => 'legacy-key',
            'services.fcm.project_id' => null,
            'services.fcm.service_account_path' => base_path('missing-firebase-service-account.json'),
        ]);
        Http::fake([
            'https://fcm.googleapis.com/fcm/send' => Http::sequence()
                ->push(['success' => 0, 'failure' => 1, 'results' => [['error' => 'MismatchSenderId']]], 200)
                ->push([], 401),
        ]);
        DB::shouldReceive('table')->never();

        $send = new \ReflectionMethod(FCMPushService::class, 'sendToTokens');
        $mismatch = $send->invoke(null, ['native-token-one'], 'Update', 'Private body', ['link' => '/notifications']);
        $unauthenticated = $send->invoke(null, ['native-token-two'], 'Update', 'Private body', ['link' => '/notifications']);

        $this->assertSame(1, $mismatch['failed']);
        $this->assertSame(1, $unauthenticated['failed']);
    }

    public function test_native_delivery_suppresses_staff_browser_and_excluded_caring_targets(): void
    {
        $method = new \ReflectionMethod(FCMPushService::class, 'shouldSuppressNativePush');
        $method->setAccessible(true);

        foreach ([
            ['type' => 'support_report', 'link' => '/admin/support-reports?report=1'],
            ['type' => 'new_user_registered', 'link' => '/hour-timebank/broker/members'],
            ['type' => 'caring_smart_nudge', 'link' => '/notifications'],
            ['type' => 'caring_emergency', 'link' => '/caring-community/emergency-alerts?alert_id=91'],
            ['type' => 'story_reaction', 'link' => '/feed'],
            ['type' => 'new_story', 'link' => '/feed'],
            ['type' => 'group_chatroom_message', 'link' => '/groups/42/chat'],
            ['type' => 'support_action_pending', 'link' => '/support-actions/confirm/secret'],
        ] as $payload) {
            $this->assertTrue($method->invoke(null, $payload));
        }

        foreach ([
            ['type' => 'new_message', 'link' => '/messages/1'],
            ['campaign_type' => 'paid_push', 'cta_url' => 'https://community.example.org/offer'],
        ] as $payload) {
            $this->assertFalse($method->invoke(null, $payload));
        }
    }

    public function test_emergency_delivery_uses_expo_high_priority_without_leaking_private_data(): void
    {
        Queue::fake();
        Http::fake([
            'https://exp.host/--/api/v2/push/send' => Http::response([
                'data' => [['status' => 'ok', 'id' => 'ticket-emergency']],
            ], 200),
        ]);

        $presentation = new \ReflectionMethod(FCMPushService::class, 'lockScreenSafePresentation');
        $presentation->setAccessible(true);
        [$title, $body, $data] = $presentation->invoke(null, 'Private emergency title', 'Private emergency body', [
            'type' => 'volunteer_emergency',
            'link' => '/volunteering',
            'alert_id' => '91',
        ]);

        $send = new \ReflectionMethod(FCMPushService::class, 'sendToExpoTokens');
        $send->setAccessible(true);
        $result = $send->invoke(null, ['ExponentPushToken[emergency]'], $title, $body, $data, true);

        $this->assertSame(1, $result['sent']);
        Http::assertSentCount(1);
        $payload = Http::recorded()[0][0]->data();
        $this->assertSame('high', $payload['priority']);
        $this->assertSame(900, $payload['ttl']);
        $this->assertSame('time-sensitive', $payload['interruptionLevel']);
        $this->assertSame('emergency', $payload['channelId']);
        $this->assertSame('Safeguarding', $payload['title']);
        $this->assertSame('Open Timebank Global to view this private update.', $payload['body']);
        $this->assertSame([
            'schema_version' => '1',
            'link' => '/volunteering',
            'type' => 'volunteer_emergency',
        ], $payload['data']);
    }

    public function test_direct_apns_expiry_is_bounded_for_ordinary_and_emergency_delivery(): void
    {
        $method = new \ReflectionMethod(FCMPushService::class, 'apnsHeadersForDelivery');
        $method->setAccessible(true);
        $before = time();

        $ordinary = $method->invoke(null, false, 86400);
        $emergency = $method->invoke(null, true, 900);

        $this->assertArrayNotHasKey('apns-priority', $ordinary);
        $this->assertSame('10', $emergency['apns-priority']);
        $this->assertGreaterThanOrEqual($before + 86400, (int) $ordinary['apns-expiration']);
        $this->assertLessThanOrEqual(time() + 86400, (int) $ordinary['apns-expiration']);
        $this->assertGreaterThanOrEqual($before + 900, (int) $emergency['apns-expiration']);
        $this->assertLessThanOrEqual(time() + 900, (int) $emergency['apns-expiration']);
    }

    public function test_separately_opted_in_paid_campaign_keeps_its_promotional_copy(): void
    {
        $method = new \ReflectionMethod(FCMPushService::class, 'lockScreenSafePresentation');
        $method->setAccessible(true);
        $payload = [
            'campaign_type' => 'paid_push',
            'campaign_id' => '42',
            'cta_url' => 'https://community.example.org/offers/42',
            'private_member_name' => 'Must not leave the server',
        ];

        $this->assertSame(
            ['Local repair café', 'Book a place this Saturday.', [
                'schema_version' => '1',
                'campaign_type' => 'paid_push',
                'campaign_id' => '42',
                'cta_url' => 'https://community.example.org/offers/42',
            ]],
            $method->invoke(null, 'Local repair café', 'Book a place this Saturday.', $payload),
        );
    }

    public function test_paid_campaign_payload_rejects_credential_bearing_cta_data(): void
    {
        $method = new \ReflectionMethod(FCMPushService::class, 'lockScreenSafePresentation');
        $method->setAccessible(true);

        [, , $data] = $method->invoke(null, 'Promotion', 'Approved copy', [
            'campaign_type' => 'paid_push',
            'campaign_id' => '42',
            'cta_url' => 'https://community.example.org/offer?token=secret',
        ]);

        $this->assertSame('/notifications', $data['cta_url']);
        $this->assertSame(['schema_version', 'campaign_type', 'campaign_id', 'cta_url'], array_keys($data));
        foreach ($data as $value) {
            $this->assertIsString($value);
        }
    }

    // =========================================================================
    // registerDevice()
    // =========================================================================

    public function test_registerDevice_returns_true_on_success(): void
    {
        DB::shouldReceive('statement')->once()->andReturn(true);

        $result = $this->service->registerDevice(1, 'token123', 'ios');
        $this->assertTrue($result);
    }

    public function test_registerDevice_returns_false_on_exception(): void
    {
        DB::shouldReceive('statement')->andThrow(new \Exception('DB error'));
        Log::shouldReceive('error')->once();

        $result = $this->service->registerDevice(1, 'token123');
        $this->assertFalse($result);
    }

    // =========================================================================
    // unregisterDevice()
    // =========================================================================

    public function test_unregisterDevice_returns_true_when_token_deleted(): void
    {
        // unregisterDevice chains ->where('token')->where('tenant_id')
        // (tenant-scoped delete) before ->delete().
        $query = \Mockery::mock();
        $query->shouldReceive('where')->andReturnSelf();
        $query->shouldReceive('delete')->andReturn(1);
        DB::shouldReceive('table')->with('fcm_device_tokens')->andReturn($query);

        $this->assertTrue($this->service->unregisterDevice('token123'));
    }

    public function test_unregisterDevice_returns_false_when_token_not_found(): void
    {
        $query = \Mockery::mock();
        $query->shouldReceive('where')->andReturnSelf();
        $query->shouldReceive('delete')->andReturn(0);
        DB::shouldReceive('table')->with('fcm_device_tokens')->andReturn($query);

        $this->assertFalse($this->service->unregisterDevice('nonexistent'));
    }

    public function test_unregisterDevice_returns_false_on_exception(): void
    {
        $query = \Mockery::mock();
        $query->shouldReceive('where')->andReturnSelf();
        $query->shouldReceive('delete')->andThrow(new \Exception('DB error'));
        DB::shouldReceive('table')->with('fcm_device_tokens')->andReturn($query);
        Log::shouldReceive('error')->once();

        $this->assertFalse($this->service->unregisterDevice('token123'));
    }

    // =========================================================================
    // ensureTableExists()
    // =========================================================================

    public function test_ensureTableExists_is_noop(): void
    {
        // Should not throw and should not query DB
        $this->service->ensureTableExists();
        $this->assertTrue(true);
    }

    // =========================================================================
    // isConfigured()
    // =========================================================================

    public function test_isConfigured_returns_boolean(): void
    {
        $result = $this->service->isConfigured();
        $this->assertIsBool($result);
    }
}
