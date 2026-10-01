<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Listeners;

use App\Core\TenantContext;
use App\Events\TransactionCompleted;
use App\Listeners\PushTransactionToFederatedPartner;
use App\Models\Transaction;
use App\Models\User;
use App\Services\FederationAuditService;
use App\Services\FederationFeatureService;
use Illuminate\Encryption\Encrypter;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Tests\Laravel\TestCase;

/**
 * PushTransactionToFederatedPartnerTest
 *
 * Verifies that PushTransactionToFederatedPartner::handle() pushes the
 * transaction payload (amount, sender_id, receiver_id, sender_tenant_id) to
 * the correct external federation partner when a federated transaction completes,
 * and does nothing when the prerequisite guards are not satisfied.
 *
 * Unique tenant id: 99678 — isolated from all other listener test files.
 *
 * NOTE on Crypt in Docker dev environment:
 * The Docker compose.yml sets APP_KEY to a placeholder value that is not a
 * valid AES-256 key. We swap in a fresh Encrypter with a known-good random key
 * in setUp() so that Crypt::encryptString / Crypt::decryptString work correctly,
 * and we store partner api_key values encrypted with that same key.
 */
class PushTransactionToFederatedPartnerTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 99678;
    private const PARTNER_IP_BASE = '93.184.216.34';
    private const PARTNER_API_PATH = '/api/v1/federation';

    private PushTransactionToFederatedPartner $listener;
    private int $partnerId;
    private int $senderId;
    private int $receiverId;
    private int $partnerCounter = 0;
    /** Encrypted api_key value generated with the test-safe Encrypter. */
    private string $encryptedApiKey;

    protected function setUp(): void
    {
        parent::setUp();

        // Swap the encrypter singleton — Docker compose sets an invalid APP_KEY so we
        // replace the singleton with a fresh instance using a valid random key.
        // This ensures Crypt::encryptString/decryptString work correctly in tests.
        $safeKey = random_bytes(32);
        $this->app->forgetInstance('encrypter');
        $this->app->instance('encrypter', new Encrypter($safeKey, 'AES-256-CBC'));
        \App\Services\FederationExternalApiClient::clearAdapterCache();

        $this->encryptedApiKey = Crypt::encryptString('test-api-key');

        Queue::fake();

        DB::table('tenants')->updateOrInsert(
            ['id' => self::TENANT_ID],
            [
                'name'              => 'TX Federated Test Tenant',
                'slug'              => 'tx-fed-test-' . self::TENANT_ID,
                'domain'            => null,
                'is_active'         => true,
                'depth'             => 0,
                'allows_subtenants' => false,
                'created_at'        => now(),
                'updated_at'        => now(),
            ]
        );

        TenantContext::setById(self::TENANT_ID);

        $this->enableFederationForTenant(self::TENANT_ID);

        $this->partnerId  = $this->insertPartner(self::TENANT_ID);
        $this->senderId   = $this->insertUser(self::TENANT_ID, 'tx-sender-');
        $this->receiverId = $this->insertUser(self::TENANT_ID, 'tx-receiver-');

        $auditSvc   = $this->createMock(FederationAuditService::class);
        $featureSvc = new FederationFeatureService($auditSvc);
        $this->listener = new PushTransactionToFederatedPartner($featureSvc);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    private function enableFederationForTenant(int $tenantId): void
    {
        DB::table('federation_system_control')->updateOrInsert(
            ['id' => 1],
            [
                'federation_enabled'                => 1,
                'whitelist_mode_enabled'            => 0,
                'emergency_lockdown_active'         => 0,
                'max_federation_level'              => 4,
                'cross_tenant_profiles_enabled'     => 1,
                'cross_tenant_messaging_enabled'    => 1,
                'cross_tenant_transactions_enabled' => 1,
                'cross_tenant_listings_enabled'     => 1,
                'cross_tenant_events_enabled'       => 1,
                'cross_tenant_groups_enabled'       => 1,
                'created_at'                        => now(),
            ]
        );

        DB::table('federation_tenant_features')->updateOrInsert(
            ['tenant_id' => $tenantId, 'feature_key' => 'tenant_federation_enabled'],
            ['is_enabled' => 1, 'updated_at' => now()]
        );
    }

    private function nextPartnerBase(): string
    {
        $port = 9001 + ($this->partnerCounter++);
        return 'https://' . self::PARTNER_IP_BASE . ':' . $port;
    }

    private function insertPartner(int $tenantId, string $status = 'active'): int
    {
        $base = $this->nextPartnerBase();
        return (int) DB::table('federation_external_partners')->insertGetId([
            'tenant_id'          => $tenantId,
            'name'               => 'TX Partner ' . uniqid(),
            'base_url'           => $base,
            'api_path'           => self::PARTNER_API_PATH,
            'auth_method'        => 'api_key',
            'api_key'            => $this->encryptedApiKey,
            'protocol_type'      => 'nexus',
            'status'             => $status,
            'allow_transactions' => 1,
            'created_at'         => now(),
        ]);
    }

    private function insertUser(int $tenantId, string $prefix = 'user-'): int
    {
        return (int) DB::table('users')->insertGetId([
            'tenant_id'  => $tenantId,
            'name'       => 'Test User ' . uniqid(),
            'email'      => $prefix . uniqid() . '@example.com',
            'status'     => 'active',
            'created_at' => now(),
        ]);
    }

    /**
     * Build a TransactionCompleted event with the given partner id attached.
     *
     * F-486: this used to set a dynamic `external_partner_id` attribute, a
     * column `transactions` does not have — which is exactly why no outbound
     * transfer was ever pushed in production. The row is now recorded the way
     * FederationV2Controller::sendExternalTransaction() records one: the
     * partner id in `receiver_tenant_id`, plus the
     * `federation_partner_idempotency_key` that only the external path writes
     * and which tells an outbound EXTERNAL transfer apart from an INTERNAL
     * cross-community one sharing the same column (F-487).
     */
    private function makeEvent(
        float $amount           = 2.75,
        int   $partnerId        = 0,
        bool  $isFederated      = true,
        ?int  $senderOverride   = null,
        ?int  $receiverOverride = null
    ): TransactionCompleted {
        $txId = (int) DB::table('transactions')->insertGetId([
            'tenant_id'          => self::TENANT_ID,
            'sender_id'          => $senderOverride  ?? $this->senderId,
            'receiver_id'        => $receiverOverride ?? $this->receiverId,
            'amount'             => $amount,
            'status'             => 'completed',
            'is_federated'       => $isFederated ? 1 : 0,
            'transaction_type'   => 'transfer',
            'sender_tenant_id'   => self::TENANT_ID,
            'receiver_tenant_id' => ($partnerId > 0) ? $partnerId : $this->partnerId,
            'federation_partner_idempotency_key' => 'test-outbound-' . uniqid('', true),
            'created_at'         => now(),
        ]);

        /** @var Transaction $tx */
        $tx = Transaction::withoutGlobalScopes()->find($txId);

        $sender   = User::withoutGlobalScopes()->find($senderOverride  ?? $this->senderId);
        $receiver = User::withoutGlobalScopes()->find($receiverOverride ?? $this->receiverId);

        return new TransactionCompleted($tx, $sender, $receiver, self::TENANT_ID);
    }

    private function partnerTransactionUrlWildcard(): string
    {
        // NexusAdapter::mapEndpoint('transactions') = '/transactions'
        return 'https://' . self::PARTNER_IP_BASE . '*/transactions';
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Happy-path: POST to /transactions
    // ─────────────────────────────────────────────────────────────────────────

    public function test_handle_posts_transaction_to_partner(): void
    {
        Http::fake([
            $this->partnerTransactionUrlWildcard() => Http::response(['success' => true], 200),
        ]);

        $this->listener->handle($this->makeEvent());

        Http::assertSent(function (\Illuminate\Http\Client\Request $req): bool {
            return $req->method() === 'POST'
                && str_contains($req->url(), '/transactions');
        });
    }

    public function test_handle_payload_contains_exact_amount(): void
    {
        Http::fake([
            $this->partnerTransactionUrlWildcard() => Http::response(['success' => true], 200),
        ]);

        $this->listener->handle($this->makeEvent(amount: 2.75));

        Http::assertSent(function (\Illuminate\Http\Client\Request $req): bool {
            $body = json_decode($req->body(), true);
            // amount is stored as decimal(10,2) — allow string "2.75" or float 2.75
            return (string) ($body['amount'] ?? '') === '2.75'
                || ($body['amount'] ?? null) == 2.75;
        });
    }

    public function test_handle_payload_contains_sender_and_receiver_ids(): void
    {
        Http::fake([
            $this->partnerTransactionUrlWildcard() => Http::response(['success' => true], 200),
        ]);

        $this->listener->handle($this->makeEvent());

        Http::assertSent(function (\Illuminate\Http\Client\Request $req): bool {
            $body = json_decode($req->body(), true);
            return ($body['sender_id'] ?? null) == $this->senderId
                && ($body['receiver_id'] ?? null) == $this->receiverId;
        });
    }

    public function test_handle_payload_contains_sender_tenant_id(): void
    {
        Http::fake([
            $this->partnerTransactionUrlWildcard() => Http::response(['success' => true], 200),
        ]);

        $this->listener->handle($this->makeEvent());

        Http::assertSent(function (\Illuminate\Http\Client\Request $req): bool {
            $body = json_decode($req->body(), true);
            return ($body['sender_tenant_id'] ?? null) == self::TENANT_ID
                || ($body['sender_tenant'] ?? null) == self::TENANT_ID;
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Guard paths: nothing sent when prerequisites fail
    // ─────────────────────────────────────────────────────────────────────────

    public function test_handle_sends_nothing_when_transaction_not_federated(): void
    {
        Http::fake();

        $this->listener->handle($this->makeEvent(isFederated: false));

        Http::assertNothingSent();
    }

    public function test_handle_sends_nothing_when_partner_id_is_zero(): void
    {
        Http::fake();

        $event = $this->makeEvent();
        // Override to 0 AFTER makeEvent() populates it (makeEvent defaults to $this->partnerId)
        $event->transaction->receiver_tenant_id = 0;

        $this->listener->handle($event);

        Http::assertNothingSent();
    }

    public function test_handle_sends_nothing_when_federation_globally_disabled(): void
    {
        Http::fake();

        DB::table('federation_system_control')
            ->where('id', 1)
            ->update(['federation_enabled' => 0]);

        $this->listener->handle($this->makeEvent());

        Http::assertNothingSent();
    }

    public function test_handle_sends_nothing_for_unknown_tenant(): void
    {
        Http::fake();

        $txId = (int) DB::table('transactions')->insertGetId([
            'tenant_id'        => self::TENANT_ID,
            'sender_id'        => $this->senderId,
            'receiver_id'      => $this->receiverId,
            'amount'           => 1.00,
            'status'           => 'completed',
            'is_federated'     => 1,
            'transaction_type' => 'transfer',
            'created_at'       => now(),
        ]);

        $tx = Transaction::withoutGlobalScopes()->find($txId);
        $tx->external_partner_id = $this->partnerId;

        $sender   = User::withoutGlobalScopes()->find($this->senderId);
        $receiver = User::withoutGlobalScopes()->find($this->receiverId);

        // Fire with a non-existent tenant id
        $event = new TransactionCompleted($tx, $sender, $receiver, 99999999);
        $this->listener->handle($event);

        Http::assertNothingSent();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Retry / error paths
    // ─────────────────────────────────────────────────────────────────────────

    public function test_handle_throws_on_retryable_500_response(): void
    {
        Http::fake([
            $this->partnerTransactionUrlWildcard() => Http::response('Gateway Error', 500),
        ]);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessageMatches('/Retryable federation transaction push failure/');

        $this->listener->handle($this->makeEvent());
    }

    public function test_handle_does_not_throw_on_non_retryable_4xx(): void
    {
        // 422 is non-retryable (< 500); listener logs a warning but does not re-throw.
        Http::fake([
            $this->partnerTransactionUrlWildcard() => Http::response(['error' => 'invalid'], 422),
        ]);

        $this->listener->handle($this->makeEvent());

        Http::assertSent(fn ($req) => str_contains($req->url(), '/transactions'));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Listener configuration
    // ─────────────────────────────────────────────────────────────────────────

    public function test_listener_implements_should_queue(): void
    {
        $this->assertInstanceOf(\Illuminate\Contracts\Queue\ShouldQueue::class, $this->listener);
    }

    public function test_listener_is_on_federation_high_queue(): void
    {
        $this->assertSame('federation-high', $this->listener->queue);
    }

    public function test_listener_has_retry_count(): void
    {
        $this->assertGreaterThanOrEqual(1, $this->listener->tries);
    }
}
