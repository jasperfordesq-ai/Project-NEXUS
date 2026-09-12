<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\WalletService;
use App\Services\VolOrgWalletService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

class WalletOperationStatusTest extends TestCase
{
    use DatabaseTransactions;

    public static function kinds(): array
    {
        return [['transfer'], ['donation'], ['donation', 'user'], ['organisation-deposit']];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('kinds')]
    public function test_confirms_only_the_actors_matching_durable_operation(string $kind, string $recipientType = 'community_fund'): void
    {
        Event::fake([\App\Events\TransactionCompleted::class]);
        $sender = User::factory()->forTenant($this->testTenantId)->create(['balance' => 20]);
        $receiver = User::factory()->forTenant($this->testTenantId)->create(['balance' => 5]);
        TenantContext::setById($this->testTenantId);
        Sanctum::actingAs($sender);
        $key = 'status-recovery-' . $sender->id;
        if ($kind === 'transfer') {
            $intent = [$receiver->id, 2, 'Recovery audit'];
            app(WalletService::class)->transfer($sender->id, ['recipient' => $receiver->id, 'amount' => 2, 'description' => $intent[2], 'idempotency_key' => $key]);
        } elseif ($kind === 'donation') {
            $intent = [$recipientType, $recipientType === 'user' ? $receiver->id : '', 2, 'Recovery audit'];
            $this->apiPost('/v2/wallet/donate', ['recipient_type' => $recipientType, 'recipient_id' => $intent[1], 'amount' => 2, 'message' => $intent[3], 'idempotency_key' => $key])->assertStatus(201);
        } else {
            $orgId = DB::table('vol_organizations')->insertGetId([
                'tenant_id' => $this->testTenantId, 'user_id' => $receiver->id,
                'name' => 'Recovery audit', 'slug' => 'recovery-audit-' . $sender->id,
                'status' => 'active', 'balance' => 0, 'created_at' => now(),
            ]);
            $intent = [$orgId, 2, 'Recovery audit'];
            $this->assertTrue(VolOrgWalletService::depositFromUser($sender->id, $orgId, 2, $intent[2], $key)['success']);
        }
        $payload = ['kind' => $kind, 'idempotency_key' => $key, 'intent' => $intent];
        $this->apiPost('/v2/wallet/operation-status', $payload)->assertOk()->assertJsonPath('data.status', 'confirmed');
        $this->apiPost('/v2/wallet/operation-status', [...$payload, 'idempotency_key' => 'unknown-key'])->assertOk()->assertJsonPath('data.status', 'unknown');
        $differentIntent = $intent;
        $differentIntent[count($intent) - 1] = 'Different description';
        $this->apiPost('/v2/wallet/operation-status', [...$payload, 'intent' => $differentIntent])->assertOk()->assertJsonPath('data.status', 'unknown');
        Sanctum::actingAs($receiver);
        $this->apiPost('/v2/wallet/operation-status', $payload)->assertOk()->assertJsonPath('data.status', 'unknown');
        $this->assertEquals(18, $sender->fresh()->balance);
        $this->assertSame(1, DB::table('transactions')->where('sender_id', $sender->id)->count());
    }
}
