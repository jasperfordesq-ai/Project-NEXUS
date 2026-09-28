<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E055;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-250 (E-055 C-2, residual of F-169): F-169 stopped a broker reactivating a
 * BANNED account, but suspend and bulk-suspend overwrote `banned` with
 * `suspended` unconditionally, and a suspension is broker-reversible — so
 * suspend then reactivate lifted an admin's ban. A caller who may not lift a
 * ban (below admin tier, the F-169 rule) may no longer change a banned
 * account's status through either suspend path.
 */
class F250BrokerCannotUndoBanTest extends TestCase
{
    use DatabaseTransactions;

    private function member(string $status = 'active'): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(['status' => $status, 'is_approved' => 1]);
    }

    private function bannedMember(): User
    {
        $member = $this->member();
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']));
        $this->apiPost("/v2/admin/users/{$member->id}/ban", ['reason' => 'F250 ban'])->assertStatus(200);
        $this->assertSame('banned', $this->accountStatus((int) $member->id));

        return $member;
    }

    private function broker(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker', 'status' => 'active']);
    }

    private function accountStatus(int $id): string
    {
        return (string) DB::table('users')->where('id', $id)->value('status');
    }

    public function test_broker_cannot_suspend_a_banned_member(): void
    {
        $member = $this->bannedMember();
        Sanctum::actingAs($this->broker());

        $res = $this->apiPost("/v2/admin/users/{$member->id}/suspend", ['reason' => 'F250 attack']);

        // Same refusal F-169 gives a broker reactivating a banned member.
        $res->assertStatus(403);
        $res->assertJsonPath('errors.0.code', 'AUTH_INSUFFICIENT_PERMISSIONS');
        $res->assertJsonPath('errors.0.message', __('api.insufficient_permissions'));
        $this->assertSame('banned', $this->accountStatus((int) $member->id));

        // And so the two-step undo no longer works.
        $this->apiPost("/v2/admin/users/{$member->id}/reactivate")->assertStatus(403);
        $this->assertSame('banned', $this->accountStatus((int) $member->id));
    }

    public function test_broker_bulk_suspend_skips_banned_members_and_reports_them(): void
    {
        $banned = $this->bannedMember();
        $active = $this->member();
        Sanctum::actingAs($this->broker());

        $res = $this->apiPost('/v2/admin/users/bulk-suspend', ['user_ids' => [(int) $banned->id, (int) $active->id]]);
        $res->assertStatus(200);

        $this->assertSame(1, (int) $res->json('data.success'));
        $this->assertSame(1, (int) $res->json('data.failed'));
        $this->assertContains((int) $banned->id, array_map('intval', (array) $res->json('data.skipped_ids')));
        $this->assertSame('banned', $this->accountStatus((int) $banned->id));
        $this->assertSame('suspended', $this->accountStatus((int) $active->id));
    }

    public function test_control_broker_can_suspend_active_and_reactivate_suspended_member(): void
    {
        $member = $this->member();
        Sanctum::actingAs($this->broker());

        $this->apiPost("/v2/admin/users/{$member->id}/suspend", ['reason' => 'F250 legit'])->assertStatus(200);
        $this->assertSame('suspended', $this->accountStatus((int) $member->id));

        $this->apiPost("/v2/admin/users/{$member->id}/reactivate")->assertStatus(200);
        $this->assertSame('active', $this->accountStatus((int) $member->id));
    }

    public function test_control_admin_can_still_act_on_a_banned_member(): void
    {
        $member = $this->bannedMember();
        $second = $this->bannedMember();
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']));

        $this->apiPost("/v2/admin/users/{$member->id}/suspend", ['reason' => 'F250 admin'])->assertStatus(200);
        $this->assertSame('suspended', $this->accountStatus((int) $member->id));

        $res = $this->apiPost('/v2/admin/users/bulk-suspend', ['user_ids' => [(int) $second->id]]);
        $res->assertStatus(200);
        $this->assertSame(1, (int) $res->json('data.success'));
        $this->assertSame('suspended', $this->accountStatus((int) $second->id));

        $this->apiPost("/v2/admin/users/{$member->id}/reactivate")->assertStatus(200);
        $this->assertSame('active', $this->accountStatus((int) $member->id));
    }
}
