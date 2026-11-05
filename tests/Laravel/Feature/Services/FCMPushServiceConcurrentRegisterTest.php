<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Services;

use App\Core\TenantContext;
use App\Services\FCMPushService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Sentry NEXUS-PHP-77 / NEXUS-MOBILE-8 (1 Nov 2026): the phone app sends two
 * register-device requests at the same moment. Both read "no row yet", one
 * inserts, the other hits the unique key and answered 500 — the app then
 * reported "Failed to register device" although the device WAS registered.
 *
 * The losing request must treat the duplicate as "someone just registered it"
 * and apply the normal rules (same tenant: re-point; other tenant: refuse, F-197).
 */
class FCMPushServiceConcurrentRegisterTest extends TestCase
{
    use DatabaseTransactions;

    /** Make a competing request insert the token right after our "does it exist?" read. */
    private function raceInsertAfterFirstLookup(string $token, int $userId, int $tenantId): void
    {
        $fired = false;
        DB::connection()->beforeExecuting(function (string $sql) use (&$fired, $token, $userId, $tenantId) {
            if ($fired || !str_contains($sql, 'insert into `fcm_device_tokens`')) {
                return;
            }
            $fired = true;
            DB::table('fcm_device_tokens')->insert([
                'user_id' => $userId,
                'tenant_id' => $tenantId,
                'token' => $token,
                'platform' => 'ios',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        });
    }

    public function testSameTenantConcurrentRegistrationSucceedsWithOneRow(): void
    {
        $this->assertTrue(TenantContext::setById(2));
        $token = 'ExponentPushToken[race-' . uniqid() . ']';
        $this->raceInsertAfterFirstLookup($token, 900_301, 2);

        $this->assertTrue((new FCMPushService())->registerDevice(900_302, $token, 'ios'));

        $rows = DB::table('fcm_device_tokens')->where('token', $token)->get();
        $this->assertCount(1, $rows);
        $this->assertSame(900_302, (int) $rows[0]->user_id, 'the latest same-tenant registration wins, as in the non-racing path');
    }

    public function testConcurrentRegistrationFromAnotherTenantIsStillRefused(): void
    {
        $this->assertTrue(TenantContext::setById(2));
        $token = 'ExponentPushToken[race-x-' . uniqid() . ']';
        $this->raceInsertAfterFirstLookup($token, 900_303, 1);

        $this->assertFalse((new FCMPushService())->registerDevice(900_304, $token, 'ios'));

        $rows = DB::table('fcm_device_tokens')->where('token', $token)->get();
        $this->assertCount(1, $rows);
        $this->assertSame(900_303, (int) $rows[0]->user_id);
        $this->assertSame(1, (int) $rows[0]->tenant_id);
    }
}
