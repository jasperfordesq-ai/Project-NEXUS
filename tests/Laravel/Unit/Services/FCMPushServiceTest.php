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
                && $payload['data'] === [
                    'schema_version' => '1',
                    'link' => '/messages/123',
                ];
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

        $this->assertSame('Update', $title);
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

    public function test_separately_opted_in_paid_campaign_keeps_its_promotional_copy(): void
    {
        $method = new \ReflectionMethod(FCMPushService::class, 'lockScreenSafePresentation');
        $method->setAccessible(true);
        $payload = [
            'campaign_type' => 'paid_push',
            'campaign_id' => '42',
            'cta_url' => '/marketplace/42',
        ];

        $this->assertSame(
            ['Local repair café', 'Book a place this Saturday.', $payload],
            $method->invoke(null, 'Local repair café', 'Book a place this Saturday.', $payload),
        );
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
