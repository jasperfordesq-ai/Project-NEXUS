<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Services;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\WalletService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Tests\Laravel\TestCase;

class WalletReplayDurabilityTest extends TestCase
{
    use DatabaseTransactions;

    public function test_distinct_intents_and_senders_do_not_share_a_receipt(): void
    {
        Event::fake([\App\Events\TransactionCompleted::class]);
        $sender = User::factory()->forTenant($this->testTenantId)->create(['balance' => 20]);
        $otherSender = User::factory()->forTenant($this->testTenantId)->create(['balance' => 20]);
        $receiver = User::factory()->forTenant($this->testTenantId)->create(['balance' => 5]);
        TenantContext::setById($this->testTenantId);
        $payload = ['recipient' => $receiver->id, 'amount' => 2, 'description' => 'Distinct intent audit', 'idempotency_key' => 'intent-one'];
        $first = app(WalletService::class)->transfer($sender->id, $payload);
        $second = app(WalletService::class)->transfer($sender->id, [...$payload, 'idempotency_key' => 'intent-two']);
        $third = app(WalletService::class)->transfer($otherSender->id, $payload);
        $this->assertCount(3, array_unique([$first['id'], $second['id'], $third['id']]));
        $this->assertEquals(16, $sender->fresh()->balance);
        $this->assertEquals(18, $otherSender->fresh()->balance);
        $this->assertEquals(11, $receiver->fresh()->balance);
        $this->assertSame($first['id'], app(WalletService::class)->transfer($sender->id, $payload)['id']);
    }

    public function test_available_legacy_cache_receipt_is_preserved_durably_on_replay(): void
    {
        Event::fake([\App\Events\TransactionCompleted::class]);
        $sender = User::factory()->forTenant($this->testTenantId)->create(['balance' => 20]);
        $receiver = User::factory()->forTenant($this->testTenantId)->create(['balance' => 5]);
        TenantContext::setById($this->testTenantId);
        $payload = ['recipient' => $receiver->id, 'amount' => 2, 'description' => 'Legacy cache audit', 'idempotency_key' => 'legacy-replay-audit'];
        $first = app(WalletService::class)->transfer($sender->id, $payload);
        // Model a pre-migration success: cache has the result, DB has no receipt.
        DB::table('wallet_transfer_receipts')->where('sender_id', $sender->id)->delete();
        $second = app(WalletService::class)->transfer($sender->id, $payload);
        $this->assertSame($first['id'], $second['id']);
        $this->assertSame(1, DB::table('wallet_transfer_receipts')->where('sender_id', $sender->id)->count());
        $this->assertEquals(18, $sender->fresh()->balance);
    }

    public function test_receipt_survives_cache_eviction_and_replay_window_expiry(): void
    {
        Event::fake([\App\Events\TransactionCompleted::class]);
        $sender = User::factory()->forTenant($this->testTenantId)->create(['balance' => 20]);
        $receiver = User::factory()->forTenant($this->testTenantId)->create(['balance' => 5]);
        TenantContext::setById($this->testTenantId);
        $payload = ['recipient' => $receiver->id, 'amount' => 2, 'description' => 'Expired cache audit', 'idempotency_key' => 'expired-replay-audit'];
        $first = app(WalletService::class)->transfer($sender->id, $payload);
        $fingerprint = sha1('key:expired-replay-audit|' . $receiver->id . '|2|Expired cache audit|0');
        Cache::forget("wallettx:idem:{$this->testTenantId}:{$sender->id}:{$fingerprint}");
        $this->travel(2)->days();
        try {
            $second = app(WalletService::class)->transfer($sender->id, $payload);
            $this->assertSame($first['id'], $second['id']);
            $this->assertEquals(18, $sender->fresh()->balance);
            Event::assertDispatchedTimes(\App\Events\TransactionCompleted::class, 1);
        } finally {
            $this->travelBack();
        }
    }

    public function test_receipt_failure_rolls_back_the_debit_and_credit(): void
    {
        Event::fake([\App\Events\TransactionCompleted::class]);
        $sender = User::factory()->forTenant($this->testTenantId)->create(['balance' => 20]);
        $receiver = User::factory()->forTenant($this->testTenantId)->create(['balance' => 5]);
        TenantContext::setById($this->testTenantId);
        DB::listen(function ($query): void {
            if (str_starts_with($query->sql, 'insert into `wallet_transfer_receipts`')) {
                throw new \RuntimeException('Receipt commit interrupted');
            }
        });
        try {
            app(WalletService::class)->transfer($sender->id, [
                'recipient' => $receiver->id, 'amount' => 2, 'description' => 'Receipt rollback audit',
                'idempotency_key' => 'rollback-receipt-audit',
            ]);
            $this->fail('Receipt failure must abort the transfer');
        } catch (\RuntimeException $error) {
            $this->assertSame('Receipt commit interrupted', $error->getMessage());
        }
        $this->assertEquals(20, $sender->fresh()->balance);
        $this->assertEquals(5, $receiver->fresh()->balance);
        $this->assertSame(0, DB::table('transactions')->where('sender_id', $sender->id)->count());
        $this->assertSame(0, DB::table('wallet_transfer_receipts')->where('sender_id', $sender->id)->count());
        Event::assertNotDispatched(\App\Events\TransactionCompleted::class);
    }

    public static function replayCacheFailures(): array
    {
        return [['add'], ['put']];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('replayCacheFailures')]
    public function test_explicit_retry_moves_credits_once_when_cache_is_unavailable(string $failedOperation): void
    {
        Event::fake([\App\Events\TransactionCompleted::class]);
        $sender = User::factory()->forTenant($this->testTenantId)->create(['balance' => 20]);
        $receiver = User::factory()->forTenant($this->testTenantId)->create(['balance' => 5]);
        TenantContext::setById($this->testTenantId);
        $cache = \Mockery::mock(Cache::getFacadeRoot());
        $cache->shouldReceive($failedOperation)->withArgs(fn ($key) => str_starts_with($key, 'wallettx:idem:'))
            ->andThrow(new \RuntimeException('Cache unavailable'));
        Cache::swap($cache);
        $payload = ['recipient' => $receiver->id, 'amount' => 2, 'description' => 'Replay audit', 'idempotency_key' => 'durable-replay-audit'];
        $first = app(WalletService::class)->transfer($sender->id, $payload);
        $second = app(WalletService::class)->transfer($sender->id, $payload);
        $this->assertSame($first['id'], $second['id']);
        $this->assertEquals(18, $sender->fresh()->balance);
        $this->assertEquals(7, $receiver->fresh()->balance);
        $this->assertSame(1, DB::table('transactions')->where('sender_id', $sender->id)->where('receiver_id', $receiver->id)->count());
    }
}
