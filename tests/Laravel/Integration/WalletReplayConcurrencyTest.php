<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Integration;

use App\Core\TenantContext;
use App\Events\TransactionCompleted;
use App\Services\WalletService;
use App\Services\VolOrgWalletService;
use App\Services\EmailDispatchService;
use App\Services\CreditDonationService;
use App\Services\CommunityFundService;
use App\Models\Tenant;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Tests\Laravel\TestCase;

final class WalletReplayConcurrencyTest extends TestCase
{
    public static function operations(): array
    {
        return [['transfer'], ['organisation'], ['member-donation'], ['fund-donation'], ['federation']];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('operations')]
    public function test_independent_processes_commit_one_movement(string $kind): void
    {
        foreach (['pcntl_fork', 'pcntl_waitpid', 'stream_socket_pair', 'posix_kill'] as $function) {
            if (!function_exists($function)) {
                self::markTestSkipped("{$function} is required for concurrent wallet verification.");
            }
        }
        self::assertSame('nexus_test', DB::connection()->getDatabaseName());
        self::assertSame('mysql', DB::connection()->getDriverName());
        $users = [];
        $workers = [];
        $orgId = null;
        $fundId = null;
        $temporaryTenant = null;
        $federationTenant = null;
        $tenantId = $this->testTenantId;
        try {
            if ($kind === 'fund-donation') {
                $temporaryTenant = Tenant::factory()->create();
                $tenantId = (int) $temporaryTenant->id;
                TenantContext::setById($tenantId);
                $fundId = CommunityFundService::getOrCreateFund()['id'];
            }
            foreach ([20, 5] as $balance) {
                $users[] = (int) DB::table('users')->insertGetId([
                    'tenant_id' => $tenantId, 'name' => 'Wallet concurrency fixture',
                    'email' => 'wallet-concurrency-' . bin2hex(random_bytes(10)) . '@example.test',
                    'password_hash' => password_hash(bin2hex(random_bytes(16)), PASSWORD_BCRYPT),
                    'balance' => $balance, 'role' => 'member', 'status' => 'active',
                    'is_active' => true, 'is_approved' => true, 'preferred_language' => 'en',
                    'created_at' => now(), 'updated_at' => now(),
                ]);
            }
            if ($kind === 'federation') {
                $federationTenant = Tenant::factory()->create();
                DB::table('users')->where('id', $users[1])->update(['tenant_id' => $federationTenant->id]);
                foreach ($users as $userId) {
                    DB::table('federation_user_settings')->insert([
                        'user_id' => $userId, 'federation_optin' => 1,
                        'transactions_enabled_federated' => 1, 'updated_at' => now(),
                    ]);
                }
                DB::table('federation_partnerships')->insert([
                    'tenant_id' => $tenantId, 'partner_tenant_id' => $federationTenant->id,
                    'status' => 'active', 'federation_level' => 4, 'transactions_enabled' => 1,
                    'requested_at' => now(), 'approved_at' => now(), 'created_at' => now(), 'updated_at' => now(),
                ]);
            }
            if ($kind === 'organisation') {
                $orgId = DB::table('vol_organizations')->insertGetId([
                    'tenant_id' => $tenantId, 'user_id' => $users[1],
                    'name' => 'Wallet concurrency organisation', 'slug' => 'wallet-race-' . bin2hex(random_bytes(8)),
                    'status' => 'active', 'balance' => 5, 'created_at' => now(),
                ]);
            }
            // Never share an inherited PDO socket between children.
            DB::purge();
            for ($index = 0; $index < 2; $index++) {
                $sockets = stream_socket_pair(STREAM_PF_UNIX, STREAM_SOCK_STREAM, STREAM_IPPROTO_IP);
                self::assertNotFalse($sockets);
                $pid = pcntl_fork();
                self::assertNotSame(-1, $pid);
                if ($pid === 0) {
                    fclose($sockets[0]);
                    stream_set_timeout($sockets[1], 15);
                    try {
                        DB::reconnect();
                        DB::statement('SET SESSION innodb_lock_wait_timeout = 10');
                        TenantContext::reset();
                        TenantContext::setById($tenantId);
                        Event::fake([TransactionCompleted::class]);
                        app()->instance(EmailDispatchService::class, new class extends EmailDispatchService {
                            public function send(string $to, string $subject, string $body, array $options = []): bool
                            {
                                return false;
                            }
                        });
                        $cache = \Mockery::mock(Cache::getFacadeRoot());
                        $prefix = $kind === 'transfer' ? 'wallettx:idem:' : 'volorgdeposit:idem:';
                        $cache->shouldReceive('add')->withArgs(fn ($key) => str_starts_with($key, $prefix))
                            ->andReturnUsing(function () use ($sockets): never {
                                // This callback runs AFTER the non-locking receipt read.
                                // Neither child proceeds until both have missed it.
                                fwrite($sockets[1], "ready\n");
                                if (trim((string) fgets($sockets[1])) !== 'go') {
                                    throw new \RuntimeException('Wallet barrier timed out');
                                }
                                throw new \RuntimeException('Simulated replay cache outage');
                            });
                        Cache::swap($cache);
                        if (in_array($kind, ['member-donation', 'fund-donation', 'federation'], true)) {
                            $waiting = true;
                            $lockTable = $kind === 'fund-donation' ? '`community_fund_accounts`' : '`users`';
                            DB::connection()->beforeExecuting(function ($query) use ($sockets, &$waiting, $lockTable): void {
                                if ($waiting && str_contains($query, $lockTable) && str_contains($query, 'for update')) {
                                    $waiting = false;
                                    fwrite($sockets[1], "ready\n");
                                    if (trim((string) fgets($sockets[1])) !== 'go') {
                                        throw new \RuntimeException('Donation barrier timed out');
                                    }
                                }
                            });
                        }
                        if ($kind === 'federation') {
                            // Isolate the replay race from feature configuration;
                            // actual settings, partnership and money queries still run.
                            $features = \Mockery::mock(\App\Services\FederationFeatureService::class);
                            $features->shouldReceive('isOperationAllowed')->with('transactions', $tenantId)->andReturn(['allowed' => true]);
                            app()->instance(\App\Services\FederationFeatureService::class, $features);
                            auth()->setUser(\App\Models\User::findOrFail($users[0]));
                            app()->instance('request', \Illuminate\Http\Request::create('/api/v2/federation/transactions', 'POST', [
                                'receiver_id' => $users[1], 'receiver_tenant_id' => $federationTenant->id,
                                'amount' => 2, 'description' => 'Concurrent audit', 'idempotency_key' => 'simultaneous-explicit-retry',
                            ]));
                            TenantContext::setById($tenantId);
                        }
                        $result = match ($kind) {
                            'federation' => app(\App\Http\Controllers\Api\FederationV2Controller::class)->sendTransaction()->getData(true),
                            'transfer' => app(WalletService::class)->transfer($users[0], [
                            'recipient' => $users[1], 'amount' => 2, 'description' => 'Concurrent audit',
                            'idempotency_key' => 'simultaneous-explicit-retry',
                            ]),
                            'organisation' => VolOrgWalletService::depositFromUser($users[0], (int) $orgId, 2, 'Concurrent audit', 'simultaneous-explicit-retry'),
                            'member-donation' => app(CreditDonationService::class)->donateToMember($users[0], $users[1], 2, 'Concurrent audit', sha1('concurrent-donation')),
                            'fund-donation' => CommunityFundService::receiveDonation($users[0], 2, 'Concurrent audit', sha1('concurrent-fund-donation')),
                        };
                        if ($kind === 'federation') {
                            if (empty($result['data']['transaction_id'])) throw new \RuntimeException(json_encode($result));
                            $result = ['success' => true, 'id' => $result['data']['transaction_id']];
                        }
                        if ($kind !== 'transfer' && empty($result['success'])) {
                            throw new \RuntimeException($result['message'] ?? $result['error']);
                        }
                        $outcomeKey = match ($kind) { 'transfer', 'federation' => 'id', 'organisation' => 'new_balance', default => 'success' };
                        fwrite($sockets[1], json_encode(['outcome' => $result[$outcomeKey]], JSON_THROW_ON_ERROR) . "\n");
                        fclose($sockets[1]);
                        exit(0);
                    } catch (\Throwable $error) {
                        fwrite($sockets[1], json_encode(['error' => $error->getMessage()]) . "\n");
                        fclose($sockets[1]);
                        exit(1);
                    }
                }
                fclose($sockets[1]);
                stream_set_timeout($sockets[0], 15);
                $workers[] = ['pid' => $pid, 'socket' => $sockets[0]];
            }
            foreach ($workers as $worker) {
                self::assertSame('ready', trim((string) fgets($worker['socket'])));
            }
            foreach ($workers as $worker) {
                fwrite($worker['socket'], "go\n");
            }
            $results = [];
            foreach ($workers as $worker) {
                $result = json_decode((string) fgets($worker['socket']), true);
                self::assertIsArray($result);
                self::assertArrayNotHasKey('error', $result, json_encode($result));
                $results[] = $result;
            }
            self::assertSame($results[0]['outcome'], $results[1]['outcome']);
            DB::reconnect();
            self::assertEquals(18, DB::table('users')->where('id', $users[0])->value('balance'));
            self::assertEquals(in_array($kind, ['organisation', 'fund-donation'], true) ? 5 : 7, DB::table('users')->where('id', $users[1])->value('balance'));
            self::assertSame(1, DB::table('transactions')->where('sender_id', $users[0])->count());
            if ($kind === 'transfer') {
                self::assertSame(1, DB::table('wallet_transfer_receipts')->where('sender_id', $users[0])->count());
            } elseif ($kind === 'organisation') {
                self::assertEquals(7, DB::table('vol_organizations')->where('id', $orgId)->value('balance'));
                self::assertSame(1, DB::table('vol_org_transactions')->where('vol_organization_id', $orgId)->count());
                self::assertSame(1, DB::table('vol_org_deposit_receipts')->where('user_id', $users[0])->count());
            } elseif ($kind !== 'federation') {
                self::assertSame(1, DB::table('credit_donations')->where('donor_id', $users[0])->count());
                if ($kind === 'fund-donation') {
                    self::assertEquals(2, DB::table('community_fund_accounts')->where('id', $fundId)->value('balance'));
                    self::assertSame(1, DB::table('community_fund_transactions')->where('fund_id', $fundId)->count());
                }
            }
        } finally {
            foreach ($workers as $worker) {
                if (pcntl_waitpid($worker['pid'], $status, WNOHANG) === 0) {
                    posix_kill($worker['pid'], 9);
                    pcntl_waitpid($worker['pid'], $status);
                }
                fclose($worker['socket']);
            }
            DB::purge();
            DB::reconnect();
            DB::table('wallet_transfer_receipts')->whereIn('sender_id', $users)->delete();
            DB::table('credit_donations')->whereIn('donor_id', $users)->delete();
            DB::table('transactions')->whereIn('sender_id', $users)->delete();
            DB::table('notifications')->whereIn('user_id', $users)->delete();
            DB::table('vol_org_deposit_receipts')->whereIn('user_id', $users)->delete();
            if ($orgId !== null) {
                DB::table('vol_org_transactions')->where('vol_organization_id', $orgId)->delete();
                DB::table('vol_organizations')->where('id', $orgId)->delete();
            }
            DB::table('users')->whereIn('id', $users)->delete();
            if ($federationTenant !== null) {
                DB::table('federation_audit_log')->whereIn('actor_user_id', $users)->delete();
                DB::table('federation_user_settings')->whereIn('user_id', $users)->delete();
                DB::table('federation_partnerships')->where('partner_tenant_id', $federationTenant->id)->delete();
                DB::table('tenants')->where('id', $federationTenant->id)->delete();
            }
            if ($temporaryTenant !== null) {
                DB::table('community_fund_transactions')->where('tenant_id', $tenantId)->delete();
                DB::table('community_fund_accounts')->where('tenant_id', $tenantId)->delete();
                DB::table('tenants')->where('id', $tenantId)->delete();
                TenantContext::reset();
                TenantContext::setById($this->testTenantId);
            }
        }
    }
}
