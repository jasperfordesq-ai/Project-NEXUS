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
 * F-546 (E-082) — the only screen that sets a community's safeguarding
 * jurisdiction is the broker panel's Vetting page
 * (docs/SAFEGUARDING-AND-CONSENT.md), and PUT /v2/admin/vetting/policy refused
 * every broker with requireAdmin(). Owner decision, 2 Oct 2026: brokers have
 * the whole broker panel.
 *
 * Coordinators stay refused, as they are for every other vetting decision
 * (requireVettingDecisionMaker()).
 */
final class F546BrokerCanSetVettingPolicyTest extends TestCase
{
    use DatabaseTransactions;

    public function test_a_broker_can_set_the_communitys_safeguarding_jurisdiction(): void
    {
        Sanctum::actingAs($this->staff('broker'));

        $this->apiPut('/v2/admin/vetting/policy', ['jurisdiction' => 'england_wales'])->assertStatus(200);
        $this->apiGet('/v2/admin/vetting/policy')
            ->assertStatus(200)
            ->assertJsonPath('data.policy.jurisdiction', 'england_wales');
    }

    public function test_a_coordinator_is_still_refused_as_for_other_vetting_decisions(): void
    {
        Sanctum::actingAs($this->staff('coordinator'));

        $this->apiPut('/v2/admin/vetting/policy', ['jurisdiction' => 'england_wales'])->assertStatus(403);
    }

    public function test_control_a_plain_member_is_refused(): void
    {
        Sanctum::actingAs($this->staff('member'));

        $this->apiPut('/v2/admin/vetting/policy', ['jurisdiction' => 'england_wales'])->assertStatus(403);
    }

    private function staff(string $role): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => 1]);
        DB::table('users')->where('id', $u->id)->update(['role' => $role, 'is_admin' => 0]);

        return User::find($u->id);
    }
}
