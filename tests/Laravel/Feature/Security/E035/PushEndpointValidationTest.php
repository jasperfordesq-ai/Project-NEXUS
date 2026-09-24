<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E035;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\PushNotificationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-165 — A web-push subscription endpoint is a server-side callback target. It
 * must be validated (HTTPS + recognised push provider) before it is stored, so a
 * stored endpoint cannot point at an internal/loopback address (SSRF).
 */
class PushEndpointValidationTest extends TestCase
{
    use DatabaseTransactions;

    public function testKnownPushProvidersAreAccepted(): void
    {
        foreach ([
            'https://fcm.googleapis.com/fcm/send/abc123',
            'https://updates.push.services.mozilla.com/wpush/v2/abc',
            'https://autopush.stage.push.services.mozilla.com/wpush/v2/abc',
            'https://web.push.apple.com/QABC',
            'https://db5p.notify.windows.com/w/?token=abc',
        ] as $endpoint) {
            $this->assertTrue(
                PushNotificationService::isAcceptablePushEndpoint($endpoint),
                "Legitimate push endpoint was rejected: {$endpoint}",
            );
        }
    }

    public function testInternalAndUnknownEndpointsAreRejected(): void
    {
        foreach ([
            'http://127.0.0.1:9/e035',                 // plain loopback, non-https
            'https://127.0.0.1/e035',                  // https loopback literal
            'https://[::ffff:127.0.0.1]/e035',         // IPv4-mapped IPv6 loopback
            'https://[::1]/e035',                       // IPv6 loopback
            'https://localhost/e035',                   // local name
            'https://internal.service.internal/e035',   // local suffix
            'https://evil.example/e035',                // not a push provider
            'http://fcm.googleapis.com/fcm/send/abc',   // right host, wrong scheme
            'ftp://fcm.googleapis.com/abc',             // non-http scheme
            'not-a-url',
            '',
        ] as $endpoint) {
            $this->assertFalse(
                PushNotificationService::isAcceptablePushEndpoint($endpoint),
                "Unsafe push endpoint was accepted: {$endpoint}",
            );
        }
    }

    public function testSubscribeStoresAGoodEndpointAndRefusesAnInternalOne(): void
    {
        TenantContext::setById($this->testTenantId);
        $service = new PushNotificationService();
        $userId = (int) User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ])->id;

        $good = 'https://fcm.googleapis.com/fcm/send/e035-' . uniqid();
        $this->assertTrue($service->subscribe($userId, [
            'endpoint' => $good,
            'keys' => ['p256dh' => 'k', 'auth' => 'a'],
        ]));
        $this->assertTrue(
            DB::table('push_subscriptions')->where('user_id', $userId)->where('endpoint', $good)->exists(),
        );

        $bad = 'http://127.0.0.1:9/e035-' . uniqid();
        $this->assertFalse($service->subscribe($userId, [
            'endpoint' => $bad,
            'keys' => ['p256dh' => 'k', 'auth' => 'a'],
        ]));
        $this->assertFalse(
            DB::table('push_subscriptions')->where('user_id', $userId)->where('endpoint', $bad)->exists(),
        );
    }
}
