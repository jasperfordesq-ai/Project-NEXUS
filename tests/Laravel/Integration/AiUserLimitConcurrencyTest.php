<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Integration;

use App\Core\TenantContext;
use App\Models\AiUserLimit;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

final class AiUserLimitConcurrencyTest extends TestCase
{
    public function test_two_concurrent_requests_cannot_both_consume_the_final_slot(): void
    {
        foreach (['pcntl_fork', 'pcntl_waitpid', 'stream_socket_pair', 'posix_kill'] as $function) {
            if (!function_exists($function)) {
                self::markTestSkipped("{$function} is required for AI budget concurrency verification.");
            }
        }
        self::assertSame('nexus_test', DB::connection()->getDatabaseName());

        $user = User::factory()->forTenant($this->testTenantId)->create();
        DB::table('ai_user_limits')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'daily_limit' => 1,
            'monthly_limit' => 1,
            'daily_used' => 0,
            'monthly_used' => 0,
            'last_reset_daily' => now()->toDateString(),
            'last_reset_monthly' => now()->toDateString(),
            'created_at' => now(),
            'updated_at' => now(),
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
                            if ($waiting && str_contains($sql, 'from `ai_user_limits`') && str_contains($sql, 'for update')) {
                                $waiting = false;
                                fwrite($sockets[1], "ready\n");
                                if (trim((string) fgets($sockets[1])) !== 'go') {
                                    throw new \RuntimeException('AI budget barrier timed out');
                                }
                            }
                        });

                        $result = AiUserLimit::admitRequest((int) $user->id, $this->testTenantId);
                        fwrite($sockets[1], json_encode([
                            'allowed' => $result['allowed'],
                            'reason' => $result['reason'],
                        ], JSON_THROW_ON_ERROR) . "\n");
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

            $outcomes = [];
            foreach ($workers as $worker) {
                $payload = json_decode((string) fgets($worker['socket']), true);
                self::assertIsArray($payload);
                self::assertArrayNotHasKey('error', $payload, json_encode($payload));
                $outcomes[] = $payload;
            }

            DB::reconnect();
            self::assertSame(1, count(array_filter($outcomes, static fn (array $result): bool => $result['allowed'] === true)));
            self::assertSame(1, count(array_filter($outcomes, static fn (array $result): bool => $result['reason'] === 'daily_limit_reached')));
            self::assertSame(1, (int) DB::table('ai_user_limits')->where('tenant_id', $this->testTenantId)->where('user_id', $user->id)->value('daily_used'));
            self::assertSame(1, (int) DB::table('ai_user_limits')->where('tenant_id', $this->testTenantId)->where('user_id', $user->id)->value('monthly_used'));
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
            DB::table('ai_user_limits')->where('tenant_id', $this->testTenantId)->where('user_id', $user->id)->delete();
            DB::table('users')->where('id', $user->id)->delete();
        }
    }
}
