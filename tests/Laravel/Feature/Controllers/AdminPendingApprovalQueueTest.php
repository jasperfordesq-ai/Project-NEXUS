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
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * The pending-approval queue holds people still waiting for a decision.
 *
 * It selected on `is_approved = 0` alone, so an applicant an admin had already
 * deleted (GDPR erasure), banned, suspended or rejected stayed in the queue and
 * in its badge for ever: none of those actions sets is_approved, and approving
 * a deleted account is not a way out. Every figure that counts the queue must
 * agree with the list it links to.
 */
class AdminPendingApprovalQueueTest extends TestCase
{
    use DatabaseTransactions;

    public function test_decided_and_deleted_applicants_leave_the_pending_queue_and_every_count(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->withHeaders(['Authorization' => 'Bearer ' . app(TokenService::class)->generateToken(
            $admin->id, $admin->tenant_id, TwoFactorPolicy::claims('totp')
        )]);

        // Clear any pending rows a seed left behind so the counts are exact.
        DB::table('users')->where('tenant_id', $this->testTenantId)->where('is_approved', 0)
            ->update(['is_approved' => 1]);

        $waiting = [
            User::factory()->forTenant($this->testTenantId)->create(['is_approved' => false, 'status' => 'pending']),
            User::factory()->forTenant($this->testTenantId)->create(['is_approved' => false, 'status' => 'active']),
        ];
        $decided = [
            User::factory()->forTenant($this->testTenantId)->create(['is_approved' => false, 'status' => 'banned']),
            User::factory()->forTenant($this->testTenantId)->create(['is_approved' => false, 'status' => 'suspended']),
            User::factory()->forTenant($this->testTenantId)->create(['is_approved' => false, 'status' => 'rejected']),
            User::factory()->forTenant($this->testTenantId)->create(['is_approved' => false, 'status' => 'inactive']),
            // GDPR erasure: anonymised, stamped deleted, then suspended by hand.
            User::factory()->forTenant($this->testTenantId)->create([
                'is_approved' => false, 'status' => 'suspended',
                'deleted_at' => now(), 'anonymized_at' => now(),
            ]),
            User::factory()->forTenant($this->testTenantId)->create([
                'is_approved' => false, 'status' => 'pending',
                'deleted_at' => now(), 'anonymized_at' => now(),
            ]),
        ];

        $listed = collect($this->apiGet('/v2/admin/users?status=pending&limit=100')
            ->assertStatus(200)->json('data'))->pluck('id')->all();

        foreach ($waiting as $u) {
            $this->assertContains($u->id, $listed, "applicant {$u->id} awaiting a decision must be listed");
        }
        foreach ($decided as $u) {
            $this->assertNotContains($u->id, $listed, "user {$u->id} ({$u->status}) was already decided on");
        }

        $badge = $this->apiGet('/v2/admin/badge-counts')->assertStatus(200);
        $this->assertSame(2, (int) $badge->json('data.pending_users'), 'sidebar badge');

        $dashboard = $this->apiGet('/v2/admin/dashboard/stats')->assertStatus(200);
        $this->assertSame(2, (int) $dashboard->json('data.pending_users'), 'dashboard');
    }
}
