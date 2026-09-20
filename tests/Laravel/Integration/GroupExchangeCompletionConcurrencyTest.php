<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Integration;

use App\Core\TenantContext;
use App\Services\GroupExchangeService;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

final class GroupExchangeCompletionConcurrencyTest extends TestCase
{
    public static function mutations(): array
    {
        return [['remove'], ['hours']];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('mutations')]
    public function test_completion_revalidates_after_a_concurrent_mutation(string $mutation): void
    {
        foreach (['pcntl_fork', 'pcntl_waitpid', 'stream_socket_pair', 'posix_kill'] as $function) {
            if (!function_exists($function)) self::markTestSkipped($function . ' required');
        }
        self::assertSame('nexus_test', DB::connection()->getDatabaseName());
        self::assertSame('mysql', DB::connection()->getDriverName());
        $this->mock(\App\Services\EmailDispatchService::class, fn ($mock) => $mock->shouldReceive('send')->andReturn(true));
        $this->mock(\App\Services\WebPushService::class, fn ($mock) => $mock->shouldReceive('sendToUser')->andReturn(true));
        \Illuminate\Support\Facades\Http::fake();
        $tenantId = $this->testTenantId;
        $users = []; $workers = []; $exchangeId = null;
        try {
            foreach ([0, 0, 10] as $balance) {
                $users[] = (int) DB::table('users')->insertGetId([
                    'tenant_id' => $tenantId, 'name' => 'Group race fixture',
                    'email' => bin2hex(random_bytes(12)) . '@example.test',
                    'balance' => $balance, 'role' => 'member', 'status' => 'active', 'is_approved' => true,
                    'created_at' => now(), 'updated_at' => now(),
                ]);
            }
            $exchangeId = DB::table('group_exchanges')->insertGetId([
                'tenant_id' => $tenantId, 'organizer_id' => $users[0], 'title' => 'Concurrent group fixture',
                'status' => 'pending_confirmation', 'split_type' => 'custom', 'total_hours' => 6,
                'created_at' => now(), 'updated_at' => now(),
            ]);
            foreach ([$users[1] => 'provider', $users[2] => 'receiver'] as $userId => $role) {
                DB::table('group_exchange_participants')->insert([
                    'group_exchange_id' => $exchangeId, 'user_id' => $userId, 'role' => $role,
                    'hours' => 6, 'confirmed' => 1, 'confirmed_at' => now(), 'created_at' => now(),
                ]);
            }
            DB::purge();
            foreach (['writer', 'completer'] as $role) {
                $sockets = stream_socket_pair(STREAM_PF_UNIX, STREAM_SOCK_STREAM, STREAM_IPPROTO_IP);
                self::assertNotFalse($sockets);
                $pid = pcntl_fork();
                self::assertNotSame(-1, $pid);
                if ($pid === 0) {
                    fclose($sockets[0]); stream_set_timeout($sockets[1], 15);
                    try {
                        DB::reconnect(); DB::statement('SET SESSION innodb_lock_wait_timeout = 10');
                        TenantContext::reset(); TenantContext::setById($tenantId);
                        $announced = false;
                        DB::connection()->beforeExecuting(function (string $query) use ($role, $mutation, &$announced, $sockets): void {
                            $sql = strtolower($query);
                            $mutationWrite = $mutation === 'remove'
                                ? str_starts_with($sql, 'delete from `group_exchange_participants`')
                                : str_starts_with($sql, 'update `group_exchanges`');
                            if (!$announced && $role === 'writer' && $mutationWrite) {
                                $announced = true; fwrite($sockets[1], "ready\n");
                                if (trim((string) fgets($sockets[1])) !== 'go') throw new \RuntimeException('Mutation barrier timed out');
                            }
                            if (!$announced && $role === 'completer' && str_contains($sql, 'from `group_exchanges`')) {
                                $announced = true; fwrite($sockets[1], "ready\n");
                            }
                        });
                        $service = app(GroupExchangeService::class);
                        $result = $role === 'writer' ? ['changed' => $mutation === 'remove'
                            ? $service->removeParticipant($exchangeId, $users[1])
                            : $service->update($exchangeId, ['total_hours' => 8])] : $service->complete($exchangeId);
                        fwrite($sockets[1], json_encode($result) . "\n");
                        fclose($sockets[1]); exit(0);
                    } catch (\Throwable $error) {
                        fwrite($sockets[1], json_encode(['exception' => $error->getMessage()]) . "\n"); exit(1);
                    }
                }
                fclose($sockets[1]); stream_set_timeout($sockets[0], 15);
                $workers[$role] = ['pid' => $pid, 'socket' => $sockets[0]];
                self::assertSame('ready', trim((string) fgets($sockets[0])));
            }
            $read = [$workers['completer']['socket']]; $write = null; $except = null;
            stream_select($read, $write, $except, 0, 500000);
            fwrite($workers['writer']['socket'], "go\n");
            $results = [];
            foreach ($workers as $role => $worker) {
                $results[$role] = json_decode((string) fgets($worker['socket']), true);
                self::assertIsArray($results[$role]);
                self::assertArrayNotHasKey('exception', $results[$role], json_encode($results[$role]));
            }
            self::assertTrue($results['writer']['changed']);
            self::assertFalse($results['completer']['success'], 'Settlement must revalidate a changed participant split');
            DB::reconnect();
            self::assertSame('pending_confirmation', DB::table('group_exchanges')->where('id', $exchangeId)->value('status'));
            self::assertSame(0.0, (float) DB::table('users')->where('id', $users[1])->value('balance'));
            self::assertSame(10.0, (float) DB::table('users')->where('id', $users[2])->value('balance'));
            self::assertSame(0, DB::table('transactions')->where('sender_id', $users[0])->count());
            if ($mutation === 'hours') {
                self::assertSame(8.0, (float) DB::table('group_exchanges')->where('id', $exchangeId)->value('total_hours'));
                self::assertSame(2, DB::table('group_exchange_participants')->where('group_exchange_id', $exchangeId)->where('confirmed', 0)->whereNull('confirmed_at')->count());
            }
        } finally {
            foreach ($workers as $worker) {
                if (pcntl_waitpid($worker['pid'], $status, WNOHANG) === 0) {
                    posix_kill($worker['pid'], 9); pcntl_waitpid($worker['pid'], $status);
                }
                fclose($worker['socket']);
            }
            DB::purge(); DB::reconnect();
            DB::table('notifications')->whereIn('user_id', $users)->delete();
            DB::table('transactions')->whereIn('sender_id', $users)->delete();
            if ($exchangeId !== null) {
                DB::table('group_exchange_participants')->where('group_exchange_id', $exchangeId)->delete();
                DB::table('group_exchanges')->where('id', $exchangeId)->delete();
            }
            DB::table('users')->whereIn('id', $users)->delete();
        }
    }
}
