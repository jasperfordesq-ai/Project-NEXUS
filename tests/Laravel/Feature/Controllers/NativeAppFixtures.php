<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Controllers;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * The two records that say a member has the phone app, for the admin
 * "Phone app" page tests:
 *
 *  - a registered phone (`fcm_device_tokens`): the member allowed
 *    notifications, and we know whether it is Android or iPhone;
 *  - a phone-app sign-in (`refresh_session_activity.from_phone_app`), which
 *    exists whether or not notifications were allowed, and is "live" only
 *    while its session family is neither revoked nor expired.
 */
trait NativeAppFixtures
{
    /** The secondary tenant seeded by TestCase. */
    protected const OTHER_TENANT_ID = 999;

    protected function clearPhoneAppRecords(): void
    {
        foreach ([$this->testTenantId, self::OTHER_TENANT_ID] as $tenantId) {
            DB::table('fcm_device_tokens')->where('tenant_id', $tenantId)->delete();
            DB::table('refresh_session_activity')->where('tenant_id', $tenantId)->delete();
        }
    }

    protected function registerDevice(
        int $userId,
        int $tenantId,
        string $platform = 'android',
        ?Carbon $registeredAt = null,
        ?Carbon $lastSeenAt = null,
    ): void {
        $registeredAt ??= now();

        DB::table('fcm_device_tokens')->insert([
            'user_id' => $userId,
            'tenant_id' => $tenantId,
            'token' => 'tok-' . $tenantId . '-' . $userId . '-' . uniqid('', true),
            'platform' => $platform,
            'created_at' => $registeredAt,
            'updated_at' => $lastSeenAt ?? $registeredAt,
        ]);
    }

    /**
     * A sign-in session and its activity row.
     *
     * @param  'live'|'revoked'|'expired'  $state
     */
    protected function signIn(
        int $userId,
        int $tenantId,
        bool $fromPhoneApp = true,
        string $state = 'live',
        ?Carbon $signedInAt = null,
        ?Carbon $lastActivityAt = null,
    ): void {
        $signedInAt ??= now();
        $familyHash = hash('sha256', 'family-' . uniqid('', true));

        DB::table('refresh_token_sessions')->insert([
            'tenant_id' => $tenantId,
            'user_id' => $userId,
            'family_hash' => $familyHash,
            'jti_hash' => hash('sha256', 'jti-' . uniqid('', true)),
            'issued_at' => $signedInAt,
            'expires_at' => $state === 'expired' ? now()->subDay() : now()->addDays(7),
            'family_expires_at' => $state === 'expired' ? now()->subDay() : now()->addDays(30),
            'revoked_at' => $state === 'revoked' ? now() : null,
            'revocation_reason' => $state === 'revoked' ? 'logout' : null,
            'created_at' => $signedInAt,
            'updated_at' => $signedInAt,
        ]);

        DB::table('refresh_session_activity')->insert([
            'family_hash' => $familyHash,
            'tenant_id' => $tenantId,
            'user_id' => $userId,
            'last_activity_at' => $lastActivityAt ?? $signedInAt,
            'from_phone_app' => $fromPhoneApp,
            'created_at' => $signedInAt,
            'updated_at' => $lastActivityAt ?? $signedInAt,
        ]);
    }
}
