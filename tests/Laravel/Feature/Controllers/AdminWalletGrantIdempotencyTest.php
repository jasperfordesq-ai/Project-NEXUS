<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-294 — an admin credit grant that is submitted twice (double-click, network
 * retry) must credit the member once. A genuinely different grant must still go
 * through. Mirrors the WalletService::transfer anti-double-submit contract.
 */
final class AdminWalletGrantIdempotencyTest extends TestCase
{
    use DatabaseTransactions;

    private function grantCount(int $userId): int
    {
        return DB::table('transactions')
            ->where('tenant_id', $this->testTenantId)
            ->where('receiver_id', $userId)
            ->where('transaction_type', 'admin_grant')
            ->count();
    }

    private function balance(int $userId): float
    {
        return (float) DB::table('users')->where('id', $userId)->value('balance');
    }

    public function test_a_double_submitted_grant_credits_once(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $member = User::factory()->forTenant($this->testTenantId)->create(['balance' => 0]);
        Sanctum::actingAs($admin);
        $payload = ['user_id' => $member->id, 'amount' => 5.0, 'reason' => 'Welcome bonus'];

        $first = $this->apiPost('/v2/admin/wallet/grant', $payload);
        $second = $this->apiPost('/v2/admin/wallet/grant', $payload);

        $first->assertStatus(200);
        $second->assertStatus(200);
        $this->assertSame(1, $this->grantCount((int) $member->id), 'the second submit must not credit again');
        $this->assertSame(5.0, $this->balance((int) $member->id));
        $this->assertSame($first->json('data.grant.id'), $second->json('data.grant.id'), 'the retry replays the original grant');
    }

    public function test_an_explicit_idempotency_key_holds_after_the_short_window_has_gone(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $member = User::factory()->forTenant($this->testTenantId)->create(['balance' => 0]);
        Sanctum::actingAs($admin);
        $payload = ['user_id' => $member->id, 'amount' => 3.0, 'reason' => 'Starting balance'];
        $headers = ['Idempotency-Key' => 'grant-f294-' . uniqid()];

        $first = $this->apiPost('/v2/admin/wallet/grant', $payload, $headers);
        Cache::flush(); // cache eviction / restart: the durable receipt must still hold
        $second = $this->apiPost('/v2/admin/wallet/grant', $payload, $headers);

        $first->assertStatus(200);
        $second->assertStatus(200);
        $this->assertSame(1, $this->grantCount((int) $member->id));
        $this->assertSame(3.0, $this->balance((int) $member->id));
        $this->assertSame($first->json('data.grant.id'), $second->json('data.grant.id'));
    }

    public function test_different_grants_to_the_same_member_both_go_through(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $member = User::factory()->forTenant($this->testTenantId)->create(['balance' => 0]);
        Sanctum::actingAs($admin);

        $this->apiPost('/v2/admin/wallet/grant', ['user_id' => $member->id, 'amount' => 5.0, 'reason' => 'Welcome bonus'])
            ->assertStatus(200);
        $this->apiPost('/v2/admin/wallet/grant', ['user_id' => $member->id, 'amount' => 2.0, 'reason' => 'Event helper'])
            ->assertStatus(200);
        // Same amount and reason again, but deliberately under a new key.
        $this->apiPost(
            '/v2/admin/wallet/grant',
            ['user_id' => $member->id, 'amount' => 5.0, 'reason' => 'Welcome bonus'],
            ['Idempotency-Key' => 'grant-f294-new-' . uniqid()],
        )->assertStatus(200);

        $this->assertSame(3, $this->grantCount((int) $member->id));
        $this->assertSame(12.0, $this->balance((int) $member->id));
    }

    public function test_the_same_grant_to_two_members_credits_each(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $one = User::factory()->forTenant($this->testTenantId)->create(['balance' => 0]);
        $two = User::factory()->forTenant($this->testTenantId)->create(['balance' => 0]);
        Sanctum::actingAs($admin);

        foreach ([$one, $two] as $member) {
            $this->apiPost('/v2/admin/wallet/grant', ['user_id' => $member->id, 'amount' => 4.0, 'reason' => 'Starting balance'])
                ->assertStatus(200);
        }

        $this->assertSame(4.0, $this->balance((int) $one->id));
        $this->assertSame(4.0, $this->balance((int) $two->id));
    }
}
