<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Integration;

use App\Core\TenantContext;
use App\Models\Connection;
use App\Models\User;
use App\Services\ConnectionService;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

final class ConnectionDeclineConcurrencyTest extends TestCase
{
    public function test_two_simultaneous_declines_have_one_transition_winner(): void
    {
        foreach (['pcntl_fork', 'pcntl_waitpid', 'stream_socket_pair', 'posix_kill'] as $function) {
            if (! function_exists($function)) {
                self::markTestSkipped("{$function} is required for connection-decline concurrency verification.");
            }
        }
        self::assertSame('nexus_test', DB::connection()->getDatabaseName());

        $requester = User::factory()->forTenant($this->testTenantId)->create();
        $receiver = User::factory()->forTenant($this->testTenantId)->create();
        $connection = Connection::factory()->forTenant($this->testTenantId)->create([
            'requester_id' => $requester->id,
            'receiver_id' => $receiver->id,
            'status' => 'pending',
        ]);
        $workers = [];

        try {
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
                        TenantContext::setById($this->testTenantId);
                        $waiting = true;
                        DB::connection()->beforeExecuting(function (string $query) use (&$waiting, $sockets): void {
                            $sql = strtolower($query);
                            if ($waiting && str_contains($sql, 'from `connections`') && str_contains($sql, 'for update')) {
                                $waiting = false;
                                fwrite($sockets[1], "ready\n");
                                if (trim((string) fgets($sockets[1])) !== 'go') {
                                    throw new \RuntimeException('Connection decline barrier timed out');
                                }
                            }
                        });
                        $result = ConnectionService::decline((int) $connection->id, (int) $receiver->id);
                        fwrite($sockets[1], json_encode(['won' => is_array($result)], JSON_THROW_ON_ERROR) . "\n");
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

            foreach ($workers as $worker) self::assertSame('ready', trim((string) fgets($worker['socket'])));
            foreach ($workers as $worker) fwrite($worker['socket'], "go\n");
            $wins = [];
            foreach ($workers as $worker) {
                $payload = json_decode((string) fgets($worker['socket']), true);
                self::assertIsArray($payload);
                self::assertArrayNotHasKey('error', $payload, json_encode($payload));
                $wins[] = (bool) $payload['won'];
            }

            DB::reconnect();
            self::assertSame(1, count(array_filter($wins)));
            self::assertFalse(DB::table('connections')->where('id', $connection->id)->exists());
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
            DB::table('connections')->where('id', $connection->id)->delete();
            DB::table('users')->whereIn('id', [$requester->id, $receiver->id])->delete();
        }
    }
}
