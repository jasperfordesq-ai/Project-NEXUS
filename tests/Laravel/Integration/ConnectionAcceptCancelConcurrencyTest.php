<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Integration;

use App\Core\TenantContext;
use App\Events\ConnectionAccepted;
use App\Models\Connection;
use App\Models\User;
use App\Services\ConnectionService;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Tests\Laravel\TestCase;

final class ConnectionAcceptCancelConcurrencyTest extends TestCase
{
    public function test_requester_cancel_and_receiver_accept_have_one_committed_outcome(): void
    {
        foreach (['pcntl_fork', 'pcntl_waitpid', 'stream_socket_pair', 'posix_kill'] as $function) {
            if (! function_exists($function)) {
                self::markTestSkipped("{$function} is required for connection concurrency verification.");
            }
        }
        self::assertSame('nexus_test', DB::connection()->getDatabaseName());

        Event::fake([ConnectionAccepted::class]);
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
            foreach (['accept', 'cancel'] as $action) {
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
                                    throw new \RuntimeException('Connection transition barrier timed out');
                                }
                            }
                        });

                        if ($action === 'accept') {
                            ConnectionService::accept((int) $connection->id, (int) $receiver->id);
                            $outcome = 'accepted';
                        } else {
                            ConnectionService::destroy(
                                (int) $connection->id,
                                (int) $requester->id,
                                'pending',
                            );
                            $outcome = 'cancelled';
                        }
                        fwrite($sockets[1], json_encode(['outcome' => $outcome], JSON_THROW_ON_ERROR) . "\n");
                        fclose($sockets[1]);
                        exit(0);
                    } catch (ModelNotFoundException) {
                        fwrite($sockets[1], "{\"outcome\":\"not_found\"}\n");
                        fclose($sockets[1]);
                        exit(0);
                    } catch (\UnexpectedValueException) {
                        fwrite($sockets[1], "{\"outcome\":\"state_changed\"}\n");
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
                $outcomes[] = $payload['outcome'];
            }

            DB::reconnect();
            $storedStatus = DB::table('connections')->where('id', $connection->id)->value('status');
            if (in_array('accepted', $outcomes, true)) {
                self::assertContains('state_changed', $outcomes);
                self::assertSame('accepted', $storedStatus);
            } else {
                self::assertContains('cancelled', $outcomes);
                self::assertContains('not_found', $outcomes);
                self::assertNull($storedStatus);
            }
            self::assertSame(1, count(array_intersect($outcomes, ['accepted', 'cancelled'])));
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
