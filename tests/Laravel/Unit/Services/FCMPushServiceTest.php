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
        ], ['actor' => 'Bob']);

        $this->assertSame(1, $result['sent']);
        Http::assertSent(function ($request): bool {
            $payload = $request->data();

            // The catalogue copy, in the recipient's language, naming the sender.
            return $payload['title'] === 'Teachtaireacht nua ó Bob'
                && $payload['body'] === 'Tapáil chun í a léamh agus freagra a thabhairt';
        });
    }

    public function test_new_message_push_is_tailored_grouped_and_high_priority(): void
    {
        Queue::fake();
        config([
            'services.fcm.server_key' => null,
            'services.fcm.project_id' => null,
            'services.fcm.service_account_path' => base_path('missing-firebase-service-account.json'),
        ]);
        Http::fake([
            'https://exp.host/--/api/v2/push/send' => Http::response([
                'data' => [['status' => 'ok', 'id' => 'ticket-nm']],
            ], 200),
        ]);
        $this->mockSingleRecipientLookups('{"push_enabled":1}', 'en');

        $result = FCMPushService::sendToUser(1, 'New Message', 'Alice sent you a message', [
            'schema_version' => '1',
            'type' => 'new_message',
            'link' => '/messages/10',
            'display_title_safe' => '1',
            'display_body_safe' => '1',
        ], ['actor' => 'Alice', 'thread_id' => 'message:10', 'preview' => 'Secret text']);

        $this->assertSame(1, $result['sent']);
        $payload = Http::recorded()[0][0]->data();
        $this->assertSame('New message from Alice', $payload['title']);
        // Preview stays off the lock screen until the member opts in.
        $this->assertSame('Tap to read and reply', $payload['body']);
        $this->assertSame('messages', $payload['channelId']);
        $this->assertSame('high', $payload['priority']);
        $this->assertSame(86400, $payload['ttl']);
        $this->assertArrayNotHasKey('interruptionLevel', $payload);
        $this->assertSame([
            'schema_version' => '1',
            'link' => '/messages/10',
            'type' => 'new_message',
            'thread_id' => 'message:10',
        ], $payload['data']);
    }

    public function test_message_preview_is_shown_only_when_the_recipient_opted_in_and_is_clamped(): void
    {
        Queue::fake();
        config([
            'services.fcm.server_key' => null,
            'services.fcm.project_id' => null,
            'services.fcm.service_account_path' => base_path('missing-firebase-service-account.json'),
        ]);
        Http::fake([
            'https://exp.host/--/api/v2/push/send' => Http::response([
                'data' => [['status' => 'ok', 'id' => 'ticket-pv']],
            ], 200),
        ]);
        $this->mockSingleRecipientLookups('{"push_enabled":1,"push_show_message_preview":1}', 'en');

        $longPreview = str_repeat('word ', 30);
        FCMPushService::sendToUser(1, 'New Message', 'Alice sent you a message', [
            'type' => 'new_message',
            'link' => '/messages/10',
            'display_title_safe' => '1',
        ], ['actor' => 'Alice', 'preview' => $longPreview]);

        $payload = Http::recorded()[0][0]->data();
        $this->assertSame('New message from Alice', $payload['title']);
        $this->assertStringStartsWith('word word', $payload['body']);
        $this->assertLessThanOrEqual(80, mb_strlen($payload['body']));
        $this->assertNotSame('Tap to read and reply', $payload['body']);
    }

    public function test_batch_sends_never_carry_a_message_preview(): void
    {
        Queue::fake();
        config([
            'services.fcm.server_key' => null,
            'services.fcm.project_id' => null,
            'services.fcm.service_account_path' => base_path('missing-firebase-service-account.json'),
        ]);
        Http::fake([
            'https://exp.host/--/api/v2/push/send' => Http::response([
                'data' => [['status' => 'ok', 'id' => 'ticket-batch']],
            ], 200),
        ]);

        $query = \Mockery::mock();
        $query->shouldReceive('join')->andReturnSelf();
        $query->shouldReceive('where')->andReturnSelf();
        $query->shouldReceive('whereIn')->andReturnSelf();
        $query->shouldReceive('get')->once()->andReturn(collect([
            (object) [
                'token' => 'ExponentPushToken[batch1]',
                'preferred_language' => 'en',
                'notification_preferences' => '{"push_enabled":1,"push_show_message_preview":1}',
            ],
        ]));
        DB::shouldReceive('table')->with('fcm_device_tokens as device_tokens')->once()->andReturn($query);

        FCMPushService::sendToUsers([1], 'New Message', 'Alice sent you a message', [
            'type' => 'new_message',
            'link' => '/messages/10',
            'display_title_safe' => '1',
        ], ['actor' => 'Alice', 'preview' => 'Secret text']);

        $payload = Http::recorded()[0][0]->data();
        $this->assertSame('New message from Alice', $payload['title']);
        $this->assertSame('Tap to read and reply', $payload['body']);
    }

    public function test_sensitive_category_types_ignore_producer_context(): void
    {
        $method = new \ReflectionMethod(FCMPushService::class, 'lockScreenSafePresentation');
        $method->setAccessible(true);

        [$title, $body, $data] = $method->invoke(null, 'GDPR request from Jane Doe', 'Delete Jane Doe account', [
            'type' => 'gdpr_request',
            'link' => '/notifications',
            'display_title_safe' => '1',
            'display_body_safe' => '1',
        ], ['actor' => 'Jane Doe', 'subject' => 'Jane Doe', 'thread_id' => 'gdpr:1']);

        $this->assertSame('Security', $title);
        $this->assertSame('Open Timebank Global to view this private update.', $body);
        $this->assertArrayNotHasKey('thread_id', $data);
    }

    public function test_uncatalogued_dispatcher_push_falls_back_to_the_clamped_bell_sentence(): void
    {
        $method = new \ReflectionMethod(FCMPushService::class, 'lockScreenSafePresentation');
        $method->setAccessible(true);

        $longBell = str_repeat('Someone posted something new in your group. ', 10);
        [$title, $body] = $method->invoke(null, 'New Post', $longBell, [
            'schema_version' => '1',
            'type' => 'new_topic',
            'link' => '/groups/44',
            'display_title_safe' => '1',
            'display_body_safe' => '1',
        ]);

        $this->assertSame('New Post', $title);
        $this->assertStringStartsWith('Someone posted something new in your group.', $body);
        $this->assertLessThanOrEqual(180, mb_strlen($body));
        $this->assertNotSame('Open Timebank Global to view this private update.', $body);
    }

    public function test_a_curated_type_that_cannot_render_never_falls_back_to_the_bell_sentence(): void
    {
        $method = new \ReflectionMethod(FCMPushService::class, 'lockScreenSafePresentation');
        $method->setAccessible(true);

        // A commenter with an empty display name: no actor fact survives, so the
        // catalogue cannot render — the bell sentence (which carries the comment
        // text) must still stay off the lock screen.
        foreach (['comment', 'comment_reply', 'mention', 'new_message'] as $type) {
            [, $body] = $method->invoke(null, 'Activity', 'Someone commented on your post: "my private comment text"', [
                'schema_version' => '1',
                'type' => $type,
                'link' => '/feed/posts/42#comment-91',
                'display_title_safe' => '1',
                'display_body_safe' => '1',
            ], ['actor' => '']);

            $this->assertSame('Open Timebank Global to view this private update.', $body, $type);
        }
    }

    public function test_money_and_identity_types_keep_the_generic_body(): void
    {
        $method = new \ReflectionMethod(FCMPushService::class, 'lockScreenSafePresentation');
        $method->setAccessible(true);

        foreach ([
            'marketplace_payout' => 'Your payout of €40.00 for order #77 is on its way',
            'member_premium_billing' => 'Payment failed for your Gold membership',
            'verification_failed' => 'Your identity verification was unsuccessful. Reason: blurry document',
            'support_report' => 'New support report #12: member says a neighbour threatened them',
            'donation' => 'New donation: €25 from Jane Doe',
            'marketplace_refund' => 'Your refund of €12.50 was issued',
        ] as $type => $bell) {
            [, $body] = $method->invoke(null, 'Update', $bell, [
                'schema_version' => '1',
                'type' => $type,
                'link' => '/notifications',
                'display_title_safe' => '1',
                'display_body_safe' => '1',
            ]);

            $this->assertSame('Open Timebank Global to view this private update.', $body, $type);
        }
    }

    private function mockSingleRecipientLookups(string $preferencesJson, string $locale): void
    {
        $tokenQuery = \Mockery::mock();
        $tokenQuery->shouldReceive('where')->with('user_id', 1)->once()->andReturnSelf();
        $tokenQuery->shouldReceive('where')->with('tenant_id', $this->testTenantId)->once()->andReturnSelf();
        $tokenQuery->shouldReceive('pluck')->with('token')->once()->andReturn(collect(['ExponentPushToken[single]']));

        $userQuery = \Mockery::mock();
        $userQuery->shouldReceive('where')->with('id', 1)->twice()->andReturnSelf();
        $userQuery->shouldReceive('where')->with('tenant_id', $this->testTenantId)->twice()->andReturnSelf();
        $userQuery->shouldReceive('value')->with('notification_preferences')->once()->andReturn($preferencesJson);
        $userQuery->shouldReceive('value')->with('preferred_language')->once()->andReturn($locale);

        DB::shouldReceive('table')->with('fcm_device_tokens')->once()->andReturn($tokenQuery);
        DB::shouldReceive('table')->with('users')->twice()->andReturn($userQuery);
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

        // A direct producer that passes no context and no display_body_safe flag:
        // curated title, generic body, and producer fields never leave the server.
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

        // With context the catalogue wins and a valid thread id travels in data.
        [$title, $body, $data] = $method->invoke(null, 'New Message', 'Private message contents', [
            'schema_version' => '1',
            'type' => 'new_message',
            'link' => '/messages/123',
            'display_title_safe' => '1',
        ], ['actor' => 'Jane', 'thread_id' => 'message:123', 'secret' => 'x']);

        $this->assertSame('New message from Jane', $title);
        $this->assertSame('Tap to read and reply', $body);
        $this->assertSame([
            'schema_version' => '1',
            'link' => '/messages/123',
            'type' => 'new_message',
            'thread_id' => 'message:123',
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
            ['type' => 'support_action_pending', 'link' => '/support-actions/confirm/secret'],
        ] as $payload) {
            $this->assertTrue($method->invoke(null, $payload));
        }

        foreach ([
            ['type' => 'new_message', 'link' => '/messages/1'],
            ['type' => 'group_chatroom_message', 'link' => '/groups/42/chat?chatroom_id=7'],
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

    public function test_registerDevice_inserts_a_new_unclaimed_token(): void
    {
        $lookup = \Mockery::mock();
        $lookup->shouldReceive('where')->with('token', 'token123')->once()->andReturnSelf();
        $lookup->shouldReceive('first')->once()->andReturn(null);

        $insertQuery = \Mockery::mock();
        $insertQuery->shouldReceive('insert')->once()->andReturn(true);

        DB::shouldReceive('table')->with('fcm_device_tokens')->twice()
            ->andReturn($lookup, $insertQuery);

        $result = $this->service->registerDevice(1, 'token123', 'ios');
        $this->assertTrue($result);
    }

    public function test_registerDevice_returns_false_on_exception(): void
    {
        $lookup = \Mockery::mock();
        $lookup->shouldReceive('where')->with('token', 'token123')->once()->andReturnSelf();
        $lookup->shouldReceive('first')->once()->andThrow(new \Exception('DB error'));
        DB::shouldReceive('table')->with('fcm_device_tokens')->once()->andReturn($lookup);
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
