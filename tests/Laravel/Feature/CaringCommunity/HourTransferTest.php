<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\CaringCommunity;

use App\Core\TenantContext;
use App\Events\TransactionCompleted;
use App\Models\User;
use App\Services\CaringCommunity\CaringHourTransferService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;
use Tests\Laravel\Concerns\EnablesExternalFederation;

class HourTransferTest extends TestCase
{
    use DatabaseTransactions;

    use EnablesExternalFederation;

    private const SOURCE_TENANT_ID = 2; // hour-timebank
    private int $destinationTenantId;
    private string $destinationSlug = 'destination-test-coop';

    protected function setUp(): void
    {
        parent::setUp();
        $this->enableExternalFederation();

        Event::fake([TransactionCompleted::class]);

        // Ensure caring_community is enabled on the source tenant
        $this->setCaringCommunityFeature(self::SOURCE_TENANT_ID, true);

        // Create a second tenant for cross-tenant transfers
        $this->destinationTenantId = (int) DB::table('tenants')->insertGetId([
            'name'      => 'Destination Test Coop',
            'slug'      => $this->destinationSlug,
            'features'  => json_encode(['caring_community' => true]),
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function setCaringCommunityFeature(int $tenantId, bool $enabled): void
    {
        $tenant = DB::table('tenants')->where('id', $tenantId)->first();
        $features = [];
        if ($tenant && !empty($tenant->features)) {
            $decoded = is_string($tenant->features) ? json_decode($tenant->features, true) : $tenant->features;
            $features = is_array($decoded) ? $decoded : [];
        }
        $features['caring_community'] = $enabled;
        DB::table('tenants')
            ->where('id', $tenantId)
            ->update(['features' => json_encode($features)]);
        TenantContext::setById($tenantId);
    }

    private function makeUser(int $tenantId, string $email, float $balance = 0): int
    {
        $userId = (int) DB::table('users')->insertGetId([
            'tenant_id'  => $tenantId,
            'first_name' => 'Test',
            'last_name'  => 'User',
            'email'      => $email,
            'username'   => 'u_' . substr(md5($email . $tenantId), 0, 8),
            'password'   => password_hash('password', PASSWORD_BCRYPT),
            'balance'    => $balance,
            'status'     => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        return $userId;
    }

    public function test_initiate_validates_hours_positive_and_within_wallet(): void
    {
        TenantContext::setById(self::SOURCE_TENANT_ID);
        $email = 'mover.' . uniqid() . '@example.com';
        $sourceUser = $this->makeUser(self::SOURCE_TENANT_ID, $email, 10.0);
        // Matching user must exist at destination tenant
        $this->makeUser($this->destinationTenantId, $email, 0);

        $service = app(CaringHourTransferService::class);

        // Hours must be > 0
        $this->expectExceptionMessage('Hours must be greater than zero.');
        $service->initiate($sourceUser, $this->destinationSlug, 0, 'test');
    }

    public function test_initiate_fails_when_balance_insufficient(): void
    {
        TenantContext::setById(self::SOURCE_TENANT_ID);
        $email = 'lowbal.' . uniqid() . '@example.com';
        $sourceUser = $this->makeUser(self::SOURCE_TENANT_ID, $email, 1.0);
        $this->makeUser($this->destinationTenantId, $email, 0);

        $service = app(CaringHourTransferService::class);

        $this->expectExceptionMessage('Insufficient banked hours.');
        $service->initiate($sourceUser, $this->destinationSlug, 5.0, 'test');
    }

    public function test_initiate_fails_if_no_matching_email_at_destination(): void
    {
        TenantContext::setById(self::SOURCE_TENANT_ID);
        $email = 'nomatch.' . uniqid() . '@example.com';
        $sourceUser = $this->makeUser(self::SOURCE_TENANT_ID, $email, 10.0);
        // intentionally no user at destination with this email

        $service = app(CaringHourTransferService::class);

        $this->expectExceptionMessage('No matching member');
        $service->initiate($sourceUser, $this->destinationSlug, 5.0, 'moving');
    }

    public function test_approve_debits_source_credits_destination_atomically(): void
    {
        TenantContext::setById(self::SOURCE_TENANT_ID);
        $email = 'happy.' . uniqid() . '@example.com';
        $sourceUser = $this->makeUser(self::SOURCE_TENANT_ID, $email, 25);
        $destUser = $this->makeUser($this->destinationTenantId, $email, 4);
        $admin = $this->makeUser(self::SOURCE_TENANT_ID, 'admin.' . uniqid() . '@example.com', 0);

        $service = app(CaringHourTransferService::class);

        $init = $service->initiate($sourceUser, $this->destinationSlug, 10.0, 'Moved house');
        $this->assertSame('pending', $init['status']);

        $result = $service->approveAtSource($init['transfer_id'], $admin);
        $this->assertSame('completed', $result['status']);

        // Source debited (users.balance is integer-typed in legacy schema)
        $newSourceBalance = (float) DB::table('users')->where('id', $sourceUser)->value('balance');
        $this->assertEqualsWithDelta(15, $newSourceBalance, 0.001);

        // Destination credited
        $newDestBalance = (float) DB::table('users')->where('id', $destUser)->value('balance');
        $this->assertEqualsWithDelta(14, $newDestBalance, 0.001);

        // Both rows exist and are completed
        $sourceRow = DB::table('caring_hour_transfers')->where('id', $init['transfer_id'])->first();
        $this->assertSame('completed', $sourceRow->status);
        $this->assertSame((int) $result['destination_transfer_id'], (int) $sourceRow->linked_transfer_id);

        $destRow = DB::table('caring_hour_transfers')->where('id', $result['destination_transfer_id'])->first();
        $this->assertSame('completed', $destRow->status);
        $this->assertSame((int) $this->destinationTenantId, (int) $destRow->tenant_id);
        $this->assertSame('destination', $destRow->role);
    }

    public function test_signature_verifies_with_shared_secret(): void
    {
        $service = app(CaringHourTransferService::class);
        $payload = [
            'source_tenant_slug'      => 'a',
            'destination_tenant_slug' => 'b',
            'source_member_email'     => 'x@y.z',
            'hours'                   => 3.5,
            'reason'                  => 'test',
            'transfer_id'             => 42,
            'generated_at'            => '2026-04-28T00:00:00+00:00',
        ];
        $secret = $service->sharedPlatformSecret();
        $sig = $service->signPayload($payload, $secret);

        $this->assertTrue($service->verifySignature($payload, $sig, $secret));

        // Tampered payload
        $tampered = $payload;
        $tampered['hours'] = 99;
        $this->assertFalse($service->verifySignature($tampered, $sig, $secret));

        // Wrong secret
        $this->assertFalse($service->verifySignature($payload, $sig, 'wrong-secret'));
    }

    public function test_reject_does_not_move_funds(): void
    {
        TenantContext::setById(self::SOURCE_TENANT_ID);
        $email = 'reject.' . uniqid() . '@example.com';
        $sourceUser = $this->makeUser(self::SOURCE_TENANT_ID, $email, 7.0);
        $this->makeUser($this->destinationTenantId, $email, 2.0);
        $admin = $this->makeUser(self::SOURCE_TENANT_ID, 'admin.' . uniqid() . '@example.com', 0);

        $service = app(CaringHourTransferService::class);

        $init = $service->initiate($sourceUser, $this->destinationSlug, 3.0, 'try');
        $service->rejectAtSource($init['transfer_id'], $admin, 'no good');

        $sourceBal = (float) DB::table('users')->where('id', $sourceUser)->value('balance');
        $this->assertEqualsWithDelta(7.0, $sourceBal, 0.001);

        $row = DB::table('caring_hour_transfers')->where('id', $init['transfer_id'])->first();
        $this->assertSame('rejected', $row->status);

        // No destination row should have been created
        $destRows = DB::table('caring_hour_transfers')
            ->where('tenant_id', $this->destinationTenantId)
            ->where('counterpart_member_email', $email)
            ->count();
        $this->assertSame(0, (int) $destRows);
    }

    public function test_endpoints_403_when_feature_disabled(): void
    {
        // Disable caring_community on source tenant
        $this->setCaringCommunityFeature(self::SOURCE_TENANT_ID, false);
        TenantContext::setById(self::SOURCE_TENANT_ID);

        $sourceUser = $this->makeUser(
            self::SOURCE_TENANT_ID,
            'gated.' . uniqid() . '@example.com',
            10.0
        );
        $userModel = User::query()->find($sourceUser);
        $this->assertNotNull($userModel);
        Sanctum::actingAs($userModel);

        $resp = $this->postJson('/api/v2/caring-community/hour-transfer/initiate', [
            'destination_tenant_slug' => $this->destinationSlug,
            'hours'                   => 1,
            'reason'                  => 'test',
        ]);
        $resp->assertStatus(403);
    }

    public function test_remote_transfer_failure_records_retryable_outbox_and_retry_completes_once(): void
    {
        TenantContext::setById(self::SOURCE_TENANT_ID);
        $email = 'remote.' . uniqid() . '@example.com';
        $sourceUser = $this->makeUser(self::SOURCE_TENANT_ID, $email, 25);
        $admin = $this->makeUser(self::SOURCE_TENANT_ID, 'admin.remote.' . uniqid() . '@example.com', 0);
        $peerSlug = 'remote-coop-' . substr(uniqid(), -6);

        DB::table('caring_federation_peers')->insert([
            'tenant_id' => self::SOURCE_TENANT_ID,
            'peer_slug' => $peerSlug,
            'display_name' => 'Remote Coop',
            'base_url' => 'https://93.184.216.34',
            'shared_secret' => str_repeat('a', 64),
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Http::fakeSequence()
            ->push(['accepted' => false, 'error' => 'temporary outage'], 503)
            ->push(['accepted' => false, 'error' => 'temporary outage'], 503)
            ->push(['accepted' => false, 'error' => 'temporary outage'], 503)
            ->push(['accepted' => true, 'destination_transfer_id' => 987], 200);

        $service = app(CaringHourTransferService::class);
        $init = $service->initiate($sourceUser, $peerSlug, 5.0, 'Remote move');
        $result = $service->approveAtSource($init['transfer_id'], $admin);

        Http::assertSent(fn ($request) => $request->url() === 'https://93.184.216.34/api/v2/federation/hour-transfer/inbound');

        $this->assertSame('sent', $result['status']);
        $this->assertEqualsWithDelta(20.0, (float) DB::table('users')->where('id', $sourceUser)->value('balance'), 0.001);

        $row = DB::table('caring_hour_transfers')->where('id', $init['transfer_id'])->first();
        $this->assertSame('sent', $row->status);
        $this->assertSame('retry', $row->remote_delivery_status);
        $this->assertSame(1, (int) $row->remote_delivery_attempts);
        $this->assertNotNull($row->remote_delivery_next_retry_at);

        DB::table('caring_hour_transfers')
            ->where('id', $init['transfer_id'])
            ->update(['remote_delivery_next_retry_at' => now()->subMinute()]);

        $retry = $service->retryRemoteDeliveries(self::SOURCE_TENANT_ID, 10);
        $this->assertSame(1, $retry['processed']);
        $this->assertSame(1, $retry['delivered'], json_encode($retry));
        $this->assertSame(0, $retry['failed']);

        $completed = DB::table('caring_hour_transfers')->where('id', $init['transfer_id'])->first();
        $this->assertSame('completed', $completed->status);
        $this->assertSame('delivered', $completed->remote_delivery_status);
        $this->assertSame(2, (int) $completed->remote_delivery_attempts);
        $this->assertNotNull($completed->remote_delivered_at);
        $this->assertEqualsWithDelta(20.0, (float) DB::table('users')->where('id', $sourceUser)->value('balance'), 0.001);

        $secondRetry = $service->retryRemoteDeliveries(self::SOURCE_TENANT_ID, 10);
        $this->assertSame(0, $secondRetry['processed']);
    }

    public function test_accept_remote_transfer_is_idempotent_and_credits_once(): void
    {
        if (!Schema::hasTable('caring_hour_transfers')) {
            $this->markTestSkipped('caring_hour_transfers table missing.');
        }

        $email = 'inbound.' . uniqid() . '@example.com';
        $destinationUser = $this->makeUser($this->destinationTenantId, $email, 2);
        $sourceSlug = 'remote-source-' . substr(uniqid(), -6);
        $peer = ['shared_secret' => str_repeat('b', 64)];
        $payload = [
            'source_tenant_slug' => $sourceSlug,
            'destination_tenant_slug' => $this->destinationSlug,
            'source_member_email' => $email,
            'hours' => 3.0,
            'reason' => 'Inbound retry',
            'transfer_id' => random_int(10000, 99999),
            'generated_at' => now()->toIso8601String(),
        ];

        $service = app(CaringHourTransferService::class);
        $signature = $service->signPayload($payload, (string) $peer['shared_secret']);

        $first = $service->acceptRemoteTransfer($this->destinationTenantId, $peer, $payload, $signature);
        $second = $service->acceptRemoteTransfer($this->destinationTenantId, $peer, $payload, $signature);

        $this->assertTrue($first['accepted']);
        $this->assertFalse($first['duplicated']);
        $this->assertTrue($second['accepted']);
        $this->assertTrue($second['duplicated']);
        $this->assertSame($first['destination_transfer_id'], $second['destination_transfer_id']);

        $this->assertSame(1, (int) DB::table('caring_hour_transfers')
            ->where('tenant_id', $this->destinationTenantId)
            ->where('remote_idempotency_key', $sourceSlug . ':' . $payload['transfer_id'])
            ->count());

        $this->assertSame(1, (int) DB::table('transactions')
            ->where('tenant_id', $this->destinationTenantId)
            ->where('description', 'like', '[hour_transfer_in_remote] from ' . $sourceSlug . '%')
            ->count());

        $this->assertEqualsWithDelta(5.0, (float) DB::table('users')->where('id', $destinationUser)->value('balance'), 0.001);
    }
}
