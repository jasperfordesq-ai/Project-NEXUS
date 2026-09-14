<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Integration;

use App\Core\TenantContext;
use App\Events\MessageSent;
use App\Services\MessageService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Tests\Laravel\TestCase;

/** Two real MariaDB connections prove one client send commits one message. */
final class MessageSendReplayConcurrencyTest extends TestCase
{
    public function test_two_independent_retries_with_one_key_create_one_message(): void
    {
        foreach (['pcntl_fork', 'pcntl_waitpid', 'stream_socket_pair', 'posix_kill'] as $function) {
            if (!function_exists($function)) {
                self::markTestSkipped("{$function} is required for concurrent message verification.");
            }
        }
        self::assertSame('nexus_test', DB::connection()->getDatabaseName());

        $tenantId = $this->testTenantId;
        $suffix = bin2hex(random_bytes(8));
        $base = [
            'tenant_id' => $tenantId,
            'password_hash' => password_hash(bin2hex(random_bytes(16)), PASSWORD_BCRYPT),
            'balance' => 0,
            'role' => 'member',
            'status' => 'active',
            'is_active' => true,
            'is_approved' => true,
            'preferred_language' => 'en',
            'created_at' => now(),
            'updated_at' => now(),
        ];
        $senderId = (int) DB::table('users')->insertGetId([
            ...$base, 'name' => 'Message race sender', 'email' => "message-race-sender-{$suffix}@example.test",
        ]);
        $recipientId = (int) DB::table('users')->insertGetId([
            ...$base, 'name' => 'Message race recipient', 'email' => "message-race-recipient-{$suffix}@example.test",
        ]);
        $body = 'One accepted concurrent message ' . bin2hex(random_bytes(5));
        $key = 'simultaneous-mobile-message-send';
        $requestHash = hash('sha256', json_encode([
            'kind' => 'message', 'recipient_id' => $recipientId, 'body' => $body,
            'listing_id' => null, 'context_type' => null, 'context_id' => null,
            'duration' => 0, 'files' => [],
        ], JSON_THROW_ON_ERROR));
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
                        app()->instance('tenant.id', $tenantId);
                        Event::fake([MessageSent::class]);
                        $waiting = true;
                        DB::connection()->beforeExecuting(function (string $query) use (&$waiting, $sockets): void {
                            $sql = strtolower($query);
                            if ($waiting && str_contains($sql, 'from `users`') && str_contains($sql, 'for update')) {
                                $waiting = false;
                                fwrite($sockets[1], "ready\n");
                                if (trim((string) fgets($sockets[1])) !== 'go') {
                                    throw new \RuntimeException('Message send barrier timed out');
                                }
                            }
                        });
                        $message = MessageService::send($senderId, [
                            'recipient_id' => $recipientId,
                            'body' => $body,
                            'idempotency_key' => $key,
                            'idempotency_request_hash' => $requestHash,
                        ]);
                        if ($message === []) {
                            throw new \RuntimeException(json_encode(MessageService::getErrors(), JSON_THROW_ON_ERROR));
                        }
                        fwrite($sockets[1], json_encode([
                            'id' => (int) $message['id'],
                            'replay' => !empty($message['_idempotent_replay']),
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

            foreach ($workers as $worker) self::assertSame('ready', trim((string) fgets($worker['socket'])));
            foreach ($workers as $worker) fwrite($worker['socket'], "go\n");
            $results = [];
            foreach ($workers as $worker) {
                $result = json_decode((string) fgets($worker['socket']), true);
                self::assertIsArray($result);
                self::assertArrayNotHasKey('error', $result, json_encode($result));
                $results[] = $result;
            }

            self::assertSame($results[0]['id'], $results[1]['id']);
            $replayStates = array_values(array_unique(array_column($results, 'replay')));
            sort($replayStates);
            self::assertSame([false, true], $replayStates);
            DB::reconnect();
            self::assertSame(1, DB::table('messages')
                ->where('tenant_id', $tenantId)->where('sender_id', $senderId)->where('body', $body)->count());
            self::assertSame(1, DB::table('message_send_receipts')
                ->where('tenant_id', $tenantId)->where('sender_id', $senderId)->count());
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
            DB::table('message_send_receipts')->where('sender_id', $senderId)->delete();
            DB::table('messages')->where('sender_id', $senderId)->delete();
            DB::table('users')->whereIn('id', [$senderId, $recipientId])->delete();
        }
    }
}
