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
 * POST /v2/wallet/donate honours a client idempotency key.
 *
 * 🔴 Why: the mobile wallet retries a donation whose request timed out. Transfers already
 * replay on a duplicate key; donations did not, so the retry donated a second time
 * (mobile audit 2026-09-07, B/F-03). The concurrency lock cannot catch a retry a minute
 * later — only a key can.
 */
class WalletDonateIdempotencyTest extends TestCase
{
    use DatabaseTransactions;

    private function authenticatedUser(float $balance = 10.00): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'balance' => $balance,
        ]);
        Sanctum::actingAs($user);

        return $user;
    }

    public function test_a_repeated_donation_with_the_same_key_debits_once(): void
    {
        Cache::flush();
        $user = $this->authenticatedUser();

        $payload = [
            'recipient_type'  => 'community_fund',
            'amount'          => 2.0,
            'message'         => 'Timed out on the phone',
            'idempotency_key' => 'mobile-donation-abc123',
        ];

        $first = $this->apiPost('/v2/wallet/donate', $payload);
        $first->assertStatus(201);

        $second = $this->apiPost('/v2/wallet/donate', $payload);
        $second->assertStatus(201);
        $second->assertJsonPath('data.replayed', true);

        $this->assertEquals(
            8.0,
            (float) DB::table('users')->where('id', $user->id)->value('balance'),
            'A replayed donation must not debit the member again.'
        );
        $this->assertSame(
            1,
            DB::table('credit_donations')
                ->where('tenant_id', $this->testTenantId)
                ->where('donor_id', $user->id)
                ->count(),
            'A replayed donation must not create a second donation row.'
        );
    }

    public function test_the_same_key_with_a_different_amount_is_a_new_donation(): void
    {
        Cache::flush();
        $user = $this->authenticatedUser();

        $this->apiPost('/v2/wallet/donate', [
            'recipient_type'  => 'community_fund',
            'amount'          => 1.0,
            'message'         => '',
            'idempotency_key' => 'mobile-donation-reused',
        ])->assertStatus(201);

        // The lock below the key check is per member for ten seconds; forget it so this
        // test exercises the key, not the lock.
        Cache::lock(sprintf('wallet_donate:%d:%d', $this->testTenantId, $user->id))->forceRelease();

        $second = $this->apiPost('/v2/wallet/donate', [
            'recipient_type'  => 'community_fund',
            'amount'          => 3.0,
            'message'         => '',
            'idempotency_key' => 'mobile-donation-reused',
        ]);
        $second->assertStatus(201);
        $this->assertNull($second->json('data.replayed'));

        $this->assertEquals(
            6.0,
            (float) DB::table('users')->where('id', $user->id)->value('balance'),
            'A key bound to different content must not replay the earlier donation.'
        );
    }

    public function test_a_donation_without_a_key_still_works(): void
    {
        Cache::flush();
        $user = $this->authenticatedUser();

        $this->apiPost('/v2/wallet/donate', [
            'recipient_type' => 'community_fund',
            'amount'         => 1.5,
            'message'        => 'No key',
        ])->assertStatus(201);

        $this->assertEquals(8.5, (float) DB::table('users')->where('id', $user->id)->value('balance'));
    }
}
