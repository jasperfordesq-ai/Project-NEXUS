<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Integration;

use App\Core\TenantContext;
use App\Services\CourseCreationReceiptService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\Laravel\TestCase;

final class CourseCreationReplayConcurrencyTest extends TestCase
{
    public function test_two_independent_retries_with_one_key_create_one_course(): void
    {
        foreach (['pcntl_fork', 'pcntl_waitpid', 'stream_socket_pair', 'posix_kill'] as $function) {
            if (! function_exists($function)) self::markTestSkipped("{$function} is required for concurrent course verification.");
        }
        self::assertSame('nexus_test', DB::connection()->getDatabaseName());
        Queue::fake();
        $tenantId = $this->testTenantId;
        $suffix = bin2hex(random_bytes(8));
        $userId = (int) DB::table('users')->insertGetId([
            'tenant_id' => $tenantId, 'name' => 'Course concurrency fixture',
            'email' => "course-concurrency-{$suffix}@example.test",
            'password_hash' => password_hash(bin2hex(random_bytes(16)), PASSWORD_BCRYPT),
            'balance' => 0, 'role' => 'member', 'status' => 'active', 'is_active' => true,
            'is_approved' => true, 'preferred_language' => 'en', 'created_at' => now(), 'updated_at' => now(),
        ]);
        $payload = ['title' => "Concurrent keyed course {$suffix}", 'summary' => 'One intended course after response loss.'];
        $identity = CourseCreationReceiptService::identity('simultaneous-mobile-course-create', $payload);
        self::assertIsArray($identity);
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
                        TenantContext::setById($tenantId);
                        Queue::fake();
                        $waiting = true;
                        DB::connection()->beforeExecuting(function (string $query) use (&$waiting, $sockets): void {
                            $sql = strtolower($query);
                            if ($waiting && str_contains($sql, 'from `users`') && str_contains($sql, 'for update')) {
                                $waiting = false;
                                fwrite($sockets[1], "ready\n");
                                if (trim((string) fgets($sockets[1])) !== 'go') throw new \RuntimeException('Course creation barrier timed out');
                            }
                        });
                        $result = CourseCreationReceiptService::create($userId, $payload, $identity);
                        fwrite($sockets[1], json_encode(['id' => $result['course']->id], JSON_THROW_ON_ERROR) . "\n");
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
            $ids = [];
            foreach ($workers as $worker) {
                $result = json_decode((string) fgets($worker['socket']), true);
                self::assertIsArray($result);
                self::assertArrayNotHasKey('error', $result, json_encode($result));
                $ids[] = (int) $result['id'];
            }
            self::assertSame($ids[0], $ids[1]);
            DB::reconnect();
            self::assertSame(1, DB::table('courses')->where('author_user_id', $userId)->where('title', $payload['title'])->count());
            self::assertSame(1, DB::table('course_creation_receipts')->where('actor_user_id', $userId)->count());
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
            DB::table('course_creation_receipts')->where('actor_user_id', $userId)->delete();
            DB::table('courses')->where('author_user_id', $userId)->where('title', $payload['title'])->delete();
            DB::table('users')->where('id', $userId)->delete();
        }
    }
}
