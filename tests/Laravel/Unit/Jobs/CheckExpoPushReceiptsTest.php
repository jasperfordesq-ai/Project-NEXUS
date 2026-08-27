<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Jobs;

use App\Jobs\CheckExpoPushReceipts;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\Laravel\TestCase;

final class CheckExpoPushReceiptsTest extends TestCase
{
    use DatabaseTransactions;

    public function test_removes_a_token_reported_as_unregistered(): void
    {
        $token = 'ExponentPushToken[dead-device]';
        DB::table('fcm_device_tokens')->insert([
            'user_id' => 1,
            'tenant_id' => $this->testTenantId,
            'token' => $token,
            'platform' => 'ios',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Http::fake([
            'https://exp.host/--/api/v2/push/getReceipts' => Http::response([
                'data' => [
                    'ticket-dead' => [
                        'status' => 'error',
                        'message' => 'The device is not registered',
                        'details' => ['error' => 'DeviceNotRegistered'],
                    ],
                ],
            ], 200),
        ]);

        (new CheckExpoPushReceipts(['ticket-dead' => $token]))->handle();

        $this->assertDatabaseMissing('fcm_device_tokens', ['token' => $token]);
        Http::assertSent(fn ($request): bool => $request->data() === ['ids' => ['ticket-dead']]);
    }
}
