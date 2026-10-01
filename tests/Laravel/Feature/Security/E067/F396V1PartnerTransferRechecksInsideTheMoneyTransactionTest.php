<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E067;

use App\Core\FederationApiMiddleware;
use App\Models\User;
use App\Services\SafeguardingInteractionPolicy;
use App\Support\SafeguardingInteractionDecision;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Mockery;
use Tests\Laravel\Concerns\EnablesExternalFederation;
use Tests\Laravel\TestCase;

/**
 * F-396 — the v1 partner-API transfer (`FederationController::createTransaction`)
 * must re-check its preconditions INSIDE the money transaction, as F-344/F-376
 * made the v2 transfer do.
 *
 * The recipient, sender, partnership and credit agreement were read unlocked
 * before `DB::beginTransaction()` and never consulted again, and the external
 * arm's credit `UPDATE` carried no `status` condition. So a change committed in
 * the window between the pre-check and the money movement — the recipient
 * suspended, the partnership suspended — did not stop the transfer.
 *
 * The window is driven deterministically: a `beforeExecuting` hook fires on the
 * FIRST statement issued inside the controller's own transaction (after every
 * pre-check has answered, before any balance moves) and applies the change
 * there. That is the state a locking re-read inside the transaction would see
 * after a concurrent commit; the old code issued no such read.
 *
 * These tests assert the CORRECT behaviour and fail before the fix. Controls:
 * with nothing changed in the window, the external credit still lands and the
 * internal transfer still debits the sender and writes its pending row.
 */
final class F396V1PartnerTransferRechecksInsideTheMoneyTransactionTest extends TestCase
{
    use DatabaseTransactions;
    use EnablesExternalFederation;

    private int $partnerTenantId = 0;

    protected function setUp(): void
    {
        parent::setUp();
        $this->enableExternalFederation();
        FederationApiMiddleware::reset();
        $this->allowSafeguarding();
    }

    protected function tearDown(): void
    {
        FederationApiMiddleware::reset();
        unset($_SERVER['HTTP_X_API_KEY']);
        parent::tearDown();
    }

    // ── EXTERNAL arm: a recipient suspended in the window is not credited ──

    public function test_external_credit_does_not_land_on_a_recipient_suspended_in_the_window(): void
    {
        $this->creditAgreement($this->testTenantId, $this->testTenantId);
        $recipient = $this->federatedMember($this->testTenantId);
        $key = $this->apiKey($this->testTenantId, 'f396-external');

        $this->whenTheMoneyTransactionOpens(function () use ($recipient): void {
            DB::table('users')->where('id', $recipient->id)->update(['status' => 'suspended']);
        });

        $response = $this->transfer($key, 900396, (int) $recipient->id, 5);

        $this->assertSame(0.0, $this->balance($recipient), 'F-396: a suspended account must not be credited. ' . $response->getContent());
        $this->assertNotSame(201, $response->getStatusCode());
    }

    // ── INTERNAL arm: a partnership suspended in the window moves nothing ──

    public function test_internal_transfer_does_not_debit_when_the_partnership_is_suspended_in_the_window(): void
    {
        [$sender, $recipient, $key, $partnershipId] = $this->internalFixture();

        $this->whenTheMoneyTransactionOpens(function () use ($partnershipId): void {
            DB::table('federation_partnerships')->where('id', $partnershipId)->update(['status' => 'suspended']);
        });

        $response = $this->transfer($key, (int) $sender->id, (int) $recipient->id, 4);

        $this->assertSame(10.0, $this->balance($sender), 'F-396: a suspended partnership must stop the debit. ' . $response->getContent());
        $this->assertSame(0, DB::table('transactions')->where('sender_id', $sender->id)->count());
        $this->assertSame(403, $response->getStatusCode());
    }

    // ── INTERNAL arm: a sender who opts out in the window is not debited ──

    public function test_internal_transfer_does_not_debit_a_sender_who_opted_out_in_the_window(): void
    {
        [$sender, $recipient, $key] = $this->internalFixture();

        $this->whenTheMoneyTransactionOpens(function () use ($sender): void {
            DB::table('federation_user_settings')->where('user_id', $sender->id)
                ->update(['transactions_enabled_federated' => 0]);
        });

        $response = $this->transfer($key, (int) $sender->id, (int) $recipient->id, 4);

        $this->assertSame(10.0, $this->balance($sender), 'F-396: the sender\'s withdrawn consent must stop the debit. ' . $response->getContent());
        $this->assertSame(403, $response->getStatusCode());
    }

    // ── CONTROLS ──────────────────────────────────────────────────────────

    public function test_control_an_external_credit_with_nothing_changed_still_lands(): void
    {
        $this->creditAgreement($this->testTenantId, $this->testTenantId);
        $recipient = $this->federatedMember($this->testTenantId);
        $key = $this->apiKey($this->testTenantId, 'f396-control');

        $response = $this->transfer($key, 900397, (int) $recipient->id, 5);

        $this->assertSame(201, $response->getStatusCode(), 'CONTROL: ' . $response->getContent());
        $this->assertSame(5.0, $this->balance($recipient));
    }

    public function test_control_an_internal_transfer_with_nothing_changed_still_goes_through(): void
    {
        [$sender, $recipient, $key] = $this->internalFixture();

        $response = $this->transfer($key, (int) $sender->id, (int) $recipient->id, 4);

        $this->assertSame(201, $response->getStatusCode(), 'CONTROL: ' . $response->getContent());
        $this->assertSame(6.0, $this->balance($sender));
        $this->assertSame(1, DB::table('transactions')->where('sender_id', $sender->id)
            ->where('receiver_id', $recipient->id)->where('status', 'pending')->count());
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    /**
     * Apply $change once, on the first statement the controller issues inside
     * its own transaction. DatabaseTransactions holds level 1, so the
     * controller's DB::beginTransaction() is level 2.
     */
    private function whenTheMoneyTransactionOpens(callable $change): void
    {
        $fired = false;
        DB::connection()->beforeExecuting(function () use (&$fired, $change): void {
            if ($fired || DB::transactionLevel() < 2) {
                return;
            }
            $fired = true;
            $change();
        });
    }

    /** @return array{0:User,1:User,2:string,3:int} */
    private function internalFixture(): array
    {
        $slug = 'e077-f396-' . bin2hex(random_bytes(4));
        $this->partnerTenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'E077 F396 ' . $slug, 'slug' => $slug, 'is_active' => 1,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $partnershipId = (int) DB::table('federation_partnerships')->insertGetId([
            'tenant_id' => $this->testTenantId, 'partner_tenant_id' => $this->partnerTenantId,
            'status' => 'active', 'federation_level' => 4, 'profiles_enabled' => 1,
            'messaging_enabled' => 1, 'transactions_enabled' => 1,
            'requested_at' => now(), 'approved_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->creditAgreement($this->testTenantId, $this->partnerTenantId);

        $sender = $this->federatedMember($this->testTenantId, 10);
        $recipient = $this->federatedMember($this->partnerTenantId);
        // An INTERNAL key: no platform_id.
        $key = $this->apiKey($this->testTenantId, null);

        return [$sender, $recipient, $key, $partnershipId];
    }

    private function transfer(string $key, int $senderId, int $recipientId, int $amount): \Illuminate\Testing\TestResponse
    {
        FederationApiMiddleware::reset();
        $_SERVER['HTTP_X_API_KEY'] = $key;
        $_SERVER['REQUEST_METHOD'] = 'POST';
        $_SERVER['REQUEST_URI'] = '/api/v1/federation/transactions';
        $_SERVER['REMOTE_ADDR'] = '127.0.0.1';

        return $this->apiPost('/v1/federation/transactions', [
            'sender_id' => $senderId,
            'recipient_id' => $recipientId,
            'amount' => $amount,
            'description' => 'F-396 window probe',
            'idempotency_key' => 'f396-' . bin2hex(random_bytes(6)),
        ], ['X-API-Key' => $key]);
    }

    private function balance(User $user): float
    {
        return (float) DB::table('users')->where('id', $user->id)->value('balance');
    }

    private function creditAgreement(int $from, int $to): void
    {
        DB::table('federation_credit_agreements')->insert([
            'from_tenant_id' => $from, 'to_tenant_id' => $to, 'status' => 'active',
            'max_monthly_credits' => 100000.0, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function federatedMember(int $tenantId, int $balance = 0): User
    {
        $user = User::factory()->forTenant($tenantId)->create([
            'status' => 'active', 'is_approved' => true, 'balance' => $balance,
        ]);
        DB::table('federation_user_settings')->updateOrInsert(
            ['user_id' => (int) $user->id],
            [
                'federation_optin' => 1, 'profile_visible_federated' => 1,
                'appear_in_federated_search' => 1, 'messaging_enabled_federated' => 1,
                'transactions_enabled_federated' => 1, 'show_reviews_federated' => 1,
                'updated_at' => now(),
            ],
        );

        return $user;
    }

    private function apiKey(int $tenantId, ?string $platformId): string
    {
        $apiKey = 'f396-' . bin2hex(random_bytes(10));
        DB::table('federation_api_keys')->insert([
            'tenant_id' => $tenantId, 'name' => 'F-396 key',
            'key_hash' => hash('sha256', $apiKey), 'key_prefix' => substr($apiKey, 0, 8),
            'signing_enabled' => 0, 'platform_id' => $platformId,
            'permissions' => json_encode(['transactions:write']), 'rate_limit' => 100000,
            'status' => 'active', 'created_by' => 1,
            'created_at' => now(), 'updated_at' => now(), 'hourly_request_count' => 0,
        ]);

        return $apiKey;
    }

    private function allowSafeguarding(): void
    {
        $decision = new SafeguardingInteractionDecision(
            status: SafeguardingInteractionDecision::ALLOW,
            code: 'ALLOWED',
            recipientTenantId: $this->testTenantId,
            purposeCode: 'safeguarded_member_contact',
            scopeType: 'tenant',
            scopeIdentifier: '',
            policyVersion: 'e077-f396',
        );
        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('evaluateExternalContact')->andReturn($decision);
        $policy->shouldReceive('evaluateCrossTenantContact')->andReturn($decision);
        $policy->shouldReceive('evaluateLocalContact')->andReturn($decision);
        $policy->shouldReceive('assertLocalContactAllowed')->andReturnNull();
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);
    }
}
