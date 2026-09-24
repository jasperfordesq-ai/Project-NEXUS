<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E035;

use App\Services\RetentionPolicyService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Laravel\TestCase;

/**
 * E-035 F-174 — accountability data must keep a minimum retention window.
 *
 * A plain admin could set 30-day retention on audit / activity / safeguarding
 * data types. Those types now carry a per-type floor above the global minimum;
 * the operational types (notifications, email_log) keep the 30-day floor.
 */
class RetentionProtectedMinimumTest extends TestCase
{
    use DatabaseTransactions;

    /** @return array<string, array{0:string, 1:int}> */
    public static function protectedTypeProvider(): array
    {
        return [
            'activity log' => ['activity_log', 365],
            'admin audit log' => ['admin_audit_log', 2555],
            'safeguarding incidents' => ['vol_safeguarding_incidents', 2555],
            'wellbeing alerts' => ['vol_wellbeing_alerts', 730],
            'guardian consents' => ['vol_guardian_consents', 365],
        ];
    }

    /**
     * @dataProvider protectedTypeProvider
     */
    public function test_a_protected_type_rejects_a_window_below_its_floor(string $type, int $floor): void
    {
        $this->assertSame($floor, RetentionPolicyService::minRetentionDaysFor($type));

        // 30 days is the global floor but below every protected floor here.
        $error = RetentionPolicyService::upsertPolicy($this->testTenantId, $type, 30, true);
        $this->assertNotNull($error, "{$type} must reject 30 days");

        // One day under the floor is still refused.
        $this->assertNotNull(RetentionPolicyService::upsertPolicy($this->testTenantId, $type, $floor - 1, true));

        // Exactly the floor is accepted.
        $this->assertNull(RetentionPolicyService::upsertPolicy($this->testTenantId, $type, $floor, true));
    }

    public function test_an_operational_type_still_allows_the_global_minimum(): void
    {
        $this->assertSame(
            RetentionPolicyService::MIN_RETENTION_DAYS,
            RetentionPolicyService::minRetentionDaysFor('notifications')
        );
        $this->assertNull(
            RetentionPolicyService::upsertPolicy($this->testTenantId, 'notifications', 30, true)
        );
    }

    public function test_getPolicies_exposes_the_per_type_floor(): void
    {
        $policies = RetentionPolicyService::getPolicies($this->testTenantId);

        $this->assertSame(2555, $policies['admin_audit_log']['min_days']);
        $this->assertSame(30, $policies['notifications']['min_days']);
    }
}
