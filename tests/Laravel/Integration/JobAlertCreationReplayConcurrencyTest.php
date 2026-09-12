<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Integration;

use App\Core\TenantContext;
use App\Services\JobVacancyService;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

final class JobAlertCreationReplayConcurrencyTest extends TestCase
{
    public function test_two_independent_retries_with_one_key_create_one_alert(): void
    {
        foreach (['pcntl_fork', 'pcntl_waitpid', 'stream_socket_pair', 'posix_kill'] as $function) {
            if (!function_exists($function)) {
                self::markTestSkipped("{$function} is required for concurrent job-alert verification.");
            }
        }
        self::assertSame('nexus_test', DB::connection()->getDatabaseName());

        $tenantId = $this->testTenantId;
        $userId = (int) DB::table('users')->insertGetId([
            'tenant_id' => $tenantId,
            'name' => 'Job alert concurrency fixture',
            'email' => 'job-alert-concurrency-' . bin2hex(random_bytes(10)) . '@example.test',
            'password_hash' => password_hash(bin2hex(random_bytes(16)), PASSWORD_BCRYPT),
            'balance' => 0,
            'role' => 'member',
            'status' => 'active',
            'is_active' => true,
            'is_approved' => true,
            'preferred_language' => 'en',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $workers = [];
        $keywords = 'Concurrent keyed alert ' . bin2hex(random_bytes(6));

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
                        TenantContext::setById($tenantId);
                        $waiting = true;
                        DB::connection()->beforeExecuting(function (string $query) use (&$waiting, $sockets): void {
                            if ($waiting && str_contains(strtolower($query), 'insert into `job_alerts`')) {
                                $waiting = false;
                                fwrite($sockets[1], "ready\n");
                                if (trim((string) fgets($sockets[1])) !== 'go') {
                                    throw new \RuntimeException('Job-alert creation barrier timed out');
                                }
                            }
                        });
                        $alertId = app(JobVacancyService::class)->subscribeAlert($userId, [
                            'keywords' => $keywords,
                            'type' => 'volunteer',
                            'is_remote_only' => true,
                            'idempotency_key' => 'simultaneous-mobile-job-alert-create',
                        ]);
                        if (!$alertId) {
                            throw new \RuntimeException('Job-alert creation returned no id');
                        }
                        fwrite($sockets[1], json_encode(['id' => $alertId], JSON_THROW_ON_ERROR) . "\n");
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
            $ids = [];
            foreach ($workers as $worker) {
                $result = json_decode((string) fgets($worker['socket']), true);
                self::assertIsArray($result);
                self::assertArrayNotHasKey('error', $result, json_encode($result));
                $ids[] = (int) $result['id'];
            }

            self::assertSame($ids[0], $ids[1]);
            DB::reconnect();
            self::assertSame(1, DB::table('job_alerts')
                ->where('tenant_id', $tenantId)
                ->where('user_id', $userId)
                ->where('keywords', $keywords)
                ->count());
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
            DB::table('job_alerts')->where('user_id', $userId)->where('keywords', $keywords)->delete();
            DB::table('users')->where('id', $userId)->delete();
        }
    }
}
