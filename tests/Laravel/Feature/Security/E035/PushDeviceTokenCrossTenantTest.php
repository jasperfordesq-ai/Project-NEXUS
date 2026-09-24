<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E035;

use App\Core\TenantContext;
use App\Services\FCMPushService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-197 — A device token (unique platform-wide) must not be silently re-pointed
 * to a member in a different tenant. Otherwise a leaked token lets one community
 * capture another member's device registration and redirect/deny their pushes.
 */
class PushDeviceTokenCrossTenantTest extends TestCase
{
    use DatabaseTransactions;

    public function testAnotherTenantCannotCaptureAnExistingTokenRegistration(): void
    {
        $service = new FCMPushService();
        $token = 'e035-f197-' . uniqid();
        $tenantA = 2; // hour-timebank (default test tenant)
        $tenantB = 1; // master tenant
        $userA = 900_197;
        $userB = 900_198;

        // User A (tenant A) registers the token.
        $this->assertTrue(TenantContext::setById($tenantA), 'tenant A must exist in the test DB');
        $this->assertTrue($service->registerDevice($userA, $token, 'android'));

        $row = DB::table('fcm_device_tokens')->where('token', $token)->first();
        $this->assertNotNull($row);
        $this->assertSame($userA, (int) $row->user_id);
        $this->assertSame($tenantA, (int) $row->tenant_id);

        // User B (different tenant) tries to register the same token.
        $this->assertTrue(TenantContext::setById($tenantB), 'tenant B must exist in the test DB');
        $this->assertFalse(
            $service->registerDevice($userB, $token, 'android'),
            'cross-tenant re-registration must be refused',
        );

        // The row is unchanged — A still owns it, and there is exactly one row.
        $rows = DB::table('fcm_device_tokens')->where('token', $token)->get();
        $this->assertCount(1, $rows);
        $this->assertSame($userA, (int) $rows[0]->user_id);
        $this->assertSame($tenantA, (int) $rows[0]->tenant_id);

        // Legitimate same-tenant re-registration (device handover) still works.
        $this->assertTrue(TenantContext::setById($tenantA));
        $userC = 900_199;
        $this->assertTrue($service->registerDevice($userC, $token, 'android'));
        $after = DB::table('fcm_device_tokens')->where('token', $token)->first();
        $this->assertSame($userC, (int) $after->user_id);
        $this->assertSame($tenantA, (int) $after->tenant_id);
    }
}
