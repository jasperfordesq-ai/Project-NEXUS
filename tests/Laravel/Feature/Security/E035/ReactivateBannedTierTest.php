<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E035;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * E-035 F-169 — a broker/coordinator must not be able to reverse a ban.
 *
 * The reactivate endpoint is broker-or-admin and set any account (banned
 * included) back to active. Reversing a ban is now admin-rank only; a broker may
 * still lift an ordinary suspension.
 */
class ReactivateBannedTierTest extends TestCase
{
    use DatabaseTransactions;

    private function makeTarget(string $status): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'member',
            'status' => $status,
            'is_approved' => false,
        ]);
        // Factory may normalise status; force it explicitly.
        DB::table('users')->where('id', $user->id)->update(['status' => $status]);
        $user->refresh();
        return $user;
    }

    public function test_a_broker_cannot_reactivate_a_banned_account(): void
    {
        $banned = $this->makeTarget('banned');
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker']);
        Sanctum::actingAs($broker);

        $this->apiPost("/v2/admin/users/{$banned->id}/reactivate")->assertStatus(403);

        $this->assertSame(
            'banned',
            (string) DB::table('users')->where('id', $banned->id)->value('status')
        );
    }

    public function test_an_admin_can_reactivate_a_banned_account(): void
    {
        $banned = $this->makeTarget('banned');
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $this->apiPost("/v2/admin/users/{$banned->id}/reactivate")->assertStatus(200);

        $this->assertSame(
            'active',
            (string) DB::table('users')->where('id', $banned->id)->value('status')
        );
    }

    public function test_a_broker_can_still_reactivate_a_suspended_account(): void
    {
        $suspended = $this->makeTarget('suspended');
        $broker = User::factory()->forTenant($this->testTenantId)->create(['role' => 'broker']);
        Sanctum::actingAs($broker);

        $this->apiPost("/v2/admin/users/{$suspended->id}/reactivate")->assertStatus(200);

        $this->assertSame(
            'active',
            (string) DB::table('users')->where('id', $suspended->id)->value('status')
        );
    }
}
