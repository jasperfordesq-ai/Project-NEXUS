<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use App\Services\TokenService;
use App\Services\TwoFactorPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Laravel\TestCase;

/**
 * Deleted members are counted nowhere on the admin dashboard or the CRM.
 *
 * An account counts as deleted when deleted_at or anonymized_at is set — the
 * same rule as the Users page's "Deleted" tab. The CRM excluded erased
 * accounts only because GDPR erasure also sets status 'inactive'; a deleted
 * row whose status still read 'active' was counted as a member.
 */
class AdminDeletedMembersCountsTest extends TestCase
{
    use DatabaseTransactions;

    private const CRM_KEYS = ['total_members', 'active_members', 'new_this_month', 'pending_approvals', 'never_logged_in'];
    private const DASHBOARD_KEYS = [
        'total_users', 'active_users', 'approved_users', 'pending_users', 'new_users_this_month',
    ];

    public function test_deleted_members_do_not_change_any_crm_or_dashboard_count(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->withHeaders(['Authorization' => 'Bearer ' . app(TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, TwoFactorPolicy::claims('totp')
        )]);

        $crmBefore = $this->apiGet('/v2/admin/crm/dashboard')->assertStatus(200)->json('data');
        $dashBefore = $this->apiGet('/v2/admin/dashboard/stats')->assertStatus(200)->json('data');

        $deletedBase = [
            'is_approved' => true, 'status' => 'active',
            'created_at' => now(), 'last_login_at' => null,
            'last_active_at' => now(),
        ];
        // Stamped deleted while the status still reads active, each way round.
        User::factory()->forTenant($this->testTenantId)->create($deletedBase + ['deleted_at' => now()]);
        User::factory()->forTenant($this->testTenantId)->create($deletedBase + ['anonymized_at' => now()]);
        // What GDPR erasure leaves behind.
        User::factory()->forTenant($this->testTenantId)->create(
            ['status' => 'inactive', 'deleted_at' => now(), 'anonymized_at' => now()] + $deletedBase
        );
        // An unapproved applicant who was deleted.
        User::factory()->forTenant($this->testTenantId)->create(
            ['is_approved' => false, 'status' => 'pending', 'deleted_at' => now()] + $deletedBase
        );

        $crmAfter = $this->apiGet('/v2/admin/crm/dashboard')->assertStatus(200)->json('data');
        $dashAfter = $this->apiGet('/v2/admin/dashboard/stats')->assertStatus(200)->json('data');

        foreach (self::CRM_KEYS as $key) {
            $this->assertSame($crmBefore[$key], $crmAfter[$key], "CRM {$key} counted a deleted member");
        }
        foreach (self::DASHBOARD_KEYS as $key) {
            $this->assertSame($dashBefore[$key], $dashAfter[$key], "dashboard {$key} counted a deleted member");
        }

        // Control: a live member created the same way is counted.
        User::factory()->forTenant($this->testTenantId)->create($deletedBase);
        $crmLive = $this->apiGet('/v2/admin/crm/dashboard')->assertStatus(200)->json('data');
        $this->assertSame($crmBefore['total_members'] + 1, $crmLive['total_members']);
        $this->assertSame($crmBefore['never_logged_in'] + 1, $crmLive['never_logged_in']);
    }
}
