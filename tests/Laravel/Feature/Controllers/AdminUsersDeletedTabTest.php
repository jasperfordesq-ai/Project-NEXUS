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
 * Deleted members are listed on the admin Users page under their own tab only.
 *
 * An admin "delete" is a GDPR erasure: the row stays, anonymised, with
 * deleted_at / anonymized_at stamped and status 'inactive'. The list never
 * looked at either column, so every erased account sat in "All users" as
 * "Deleted User" with an Active badge, and in "Never logged in" and
 * "Onboarding incomplete" too.
 */
class AdminUsersDeletedTabTest extends TestCase
{
    use DatabaseTransactions;

    private const OTHER_TABS = [
        null, 'all', 'pending', 'active', 'suspended', 'banned',
        'never_logged_in', 'onboarding_incomplete', 'no_location',
    ];

    public function test_deleted_members_appear_only_under_the_deleted_tab(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->withHeaders(['Authorization' => 'Bearer ' . app(TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, TwoFactorPolicy::claims('totp')
        )]);

        $live = User::factory()->forTenant($this->testTenantId)->create([
            'is_approved' => true, 'status' => 'active',
        ]);
        $deleted = [
            // What GdprService::executeAccountDeletion leaves behind.
            User::factory()->forTenant($this->testTenantId)->create([
                'is_approved' => true, 'status' => 'inactive', 'location' => null,
                'last_login_at' => null, 'onboarding_completed' => false,
                'deleted_at' => now(), 'anonymized_at' => now(),
            ]),
            // Erased, then suspended by hand.
            User::factory()->forTenant($this->testTenantId)->create([
                'is_approved' => true, 'status' => 'suspended',
                'deleted_at' => now(), 'anonymized_at' => now(),
            ]),
            // Stamped deleted while the status still reads active.
            User::factory()->forTenant($this->testTenantId)->create([
                'is_approved' => false, 'status' => 'active', 'deleted_at' => now(),
            ]),
        ];

        foreach (self::OTHER_TABS as $tab) {
            $query = '/v2/admin/users?limit=100' . ($tab === null ? '' : "&status={$tab}");
            $listed = collect($this->apiGet($query)->assertStatus(200)->json('data'))->pluck('id')->all();
            foreach ($deleted as $u) {
                $this->assertNotContains($u->id, $listed, "deleted user {$u->id} listed under " . ($tab ?? 'no filter'));
            }
        }

        $rows = collect($this->apiGet('/v2/admin/users?status=deleted&limit=100')->assertStatus(200)->json('data'))
            ->keyBy('id');
        foreach ($deleted as $u) {
            $this->assertTrue($rows->has($u->id), "deleted user {$u->id} missing from the deleted tab");
            $this->assertSame('deleted', $rows[$u->id]['status']);
        }
        $this->assertFalse($rows->has($live->id), 'a live member is not deleted');
        $this->assertFalse($rows->has($admin->id), 'a live admin is not deleted');
    }
}
