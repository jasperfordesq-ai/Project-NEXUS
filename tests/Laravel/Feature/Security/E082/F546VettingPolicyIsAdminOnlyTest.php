<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E082;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Who may choose a community's safeguarding jurisdiction
 * (PUT /v2/admin/vetting/policy).
 *
 * F-546 (E-082, 2 Oct 2026) opened it to brokers. The owner reversed that on
 * 3 Oct 2026 (E-083, O-176): only an admin chooses the jurisdiction; brokers
 * and coordinators see it on the broker Vetting page marked "Admin only", and
 * every broker page shows a notice while it is not set. The server must agree
 * with the screen, so this is AdminTier, which also refuses a broker or
 * coordinator who carries a stray admin flag.
 *
 * Reading the policy stays open to brokers (the Vetting page shows it).
 */
final class F546VettingPolicyIsAdminOnlyTest extends TestCase
{
    use DatabaseTransactions;

    public function test_an_admin_can_set_the_communitys_safeguarding_jurisdiction(): void
    {
        Sanctum::actingAs($this->staff('admin'));

        $this->apiPut('/v2/admin/vetting/policy', ['jurisdiction' => 'england_wales'])->assertStatus(200);
        $this->apiGet('/v2/admin/vetting/policy')
            ->assertStatus(200)
            ->assertJsonPath('data.policy.jurisdiction', 'england_wales');
    }

    public function test_a_broker_is_refused_but_can_still_read_it(): void
    {
        Sanctum::actingAs($this->staff('broker'));

        $this->apiPut('/v2/admin/vetting/policy', ['jurisdiction' => 'england_wales'])->assertStatus(403);
        $this->apiGet('/v2/admin/vetting/policy')->assertStatus(200);
    }

    public function test_a_broker_with_a_stray_admin_flag_is_still_refused(): void
    {
        Sanctum::actingAs($this->staff('broker', isAdmin: true));

        $this->apiPut('/v2/admin/vetting/policy', ['jurisdiction' => 'england_wales'])->assertStatus(403);
    }

    public function test_a_coordinator_is_refused(): void
    {
        Sanctum::actingAs($this->staff('coordinator'));

        $this->apiPut('/v2/admin/vetting/policy', ['jurisdiction' => 'england_wales'])->assertStatus(403);
    }

    public function test_control_a_plain_member_is_refused(): void
    {
        Sanctum::actingAs($this->staff('member'));

        $this->apiPut('/v2/admin/vetting/policy', ['jurisdiction' => 'england_wales'])->assertStatus(403);
    }

    private function staff(string $role, bool $isAdmin = false): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => 1]);
        DB::table('users')->where('id', $u->id)->update(['role' => $role, 'is_admin' => $isAdmin ? 1 : 0]);

        return User::find($u->id);
    }
}
