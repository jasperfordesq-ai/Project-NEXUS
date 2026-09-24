<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\PushNotificationService;
use App\Services\WebPushService;
use Illuminate\Support\Facades\DB;
use Mockery;

class PushNotificationServiceTest extends TestCase
{
    private PushNotificationService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new PushNotificationService();
    }

    // ── subscribe ──

    public function test_subscribe_returns_false_for_empty_endpoint(): void
    {
        $result = $this->service->subscribe(1, ['endpoint' => '', 'keys' => []]);
        $this->assertFalse($result);
    }

    public function test_subscribe_updates_existing_subscription(): void
    {
        DB::shouldReceive('table->where->where->exists')->andReturn(true);
        DB::shouldReceive('table->where->where->update')->once();

        $result = $this->service->subscribe(1, [
            'endpoint' => 'https://fcm.googleapis.com/fcm/send/abc',
            'keys' => ['p256dh' => 'key1', 'auth' => 'auth1'],
        ]);
        $this->assertTrue($result);
    }

    public function test_subscribe_creates_new_subscription(): void
    {
        DB::shouldReceive('table->where->where->exists')->andReturn(false);
        DB::shouldReceive('table->insert')->once();

        $result = $this->service->subscribe(1, [
            'endpoint' => 'https://updates.push.services.mozilla.com/wpush/v2/new',
            'keys' => ['p256dh' => 'key2', 'auth' => 'auth2'],
        ]);
        $this->assertTrue($result);
    }

    // ── unsubscribe ──

    public function test_unsubscribe_returns_true_on_deletion(): void
    {
        DB::shouldReceive('table->where->where->delete')->andReturn(1);

        $result = $this->service->unsubscribe(1, 'https://push.example.com/abc');
        $this->assertTrue($result);
    }

    public function test_unsubscribe_returns_false_when_nothing_deleted(): void
    {
        DB::shouldReceive('table->where->where->delete')->andReturn(0);

        $result = $this->service->unsubscribe(1, 'https://push.example.com/nonexist');
        $this->assertFalse($result);
    }

    // ── getVapidKey ──

    public function test_getVapidKey_returns_config_value(): void
    {
        // The service reads config('services.vapid.public_key').
        config(['services.vapid.public_key' => 'vapid-test-key']);
        $result = $this->service->getVapidKey();
        $this->assertEquals('vapid-test-key', $result);
    }

    // ── getSubscriptionCount ──

    public function test_getSubscriptionCount_returns_integer(): void
    {
        DB::shouldReceive('table->where->count')->andReturn(3);
        $result = $this->service->getSubscriptionCount(1);
        $this->assertEquals(3, $result);
    }

    // ── send ──

    public function test_send_returns_false_on_exception(): void
    {
        $this->app->bind(WebPushService::class, function () {
            throw new \Exception('Not configured');
        });

        $result = $this->service->send(1, 'Title', 'Body');
        $this->assertFalse($result);
    }
}
