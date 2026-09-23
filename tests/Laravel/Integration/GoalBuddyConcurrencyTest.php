<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Integration;

use App\Core\TenantContext;
use App\Models\Goal;
use App\Models\User;
use App\Services\GoalService;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

final class GoalBuddyConcurrencyTest extends TestCase
{
    public function test_two_simultaneous_buddy_offers_have_one_winner_and_one_history_event(): void
    {
        foreach (['pcntl_fork', 'pcntl_waitpid', 'stream_socket_pair', 'posix_kill'] as $function) {
            if (! function_exists($function)) {
                self::markTestSkipped("{$function} is required for goal-buddy concurrency verification.");
            }
        }
        self::assertSame('nexus_test', DB::connection()->getDatabaseName());

        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $buddies = [
            User::factory()->forTenant($this->testTenantId)->create(),
            User::factory()->forTenant($this->testTenantId)->create(),
        ];
        TenantContext::setById($this->testTenantId);
        $goal = Goal::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $owner->id,
            'mentor_id' => null,
            'is_public' => true,
            'status' => 'active',
        ]);
        $workers = [];

        try {
            DB::purge();
            foreach ($buddies as $buddy) {
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
                        $waitingBeforeLock = true;
                        $waitingAfterPlainRead = true;
                        DB::connection()->beforeExecuting(function (string $query) use (
                            &$waitingBeforeLock,
                            &$waitingAfterPlainRead,
                            $sockets
                        ): void {
                            $sql = strtolower($query);
                            if (
                                $waitingBeforeLock
                                && str_contains($sql, 'from `goals`')
                                && str_contains($sql, 'for update')
                            ) {
                                $waitingBeforeLock = false;
                                $waitingAfterPlainRead = false;
                                fwrite($sockets[1], "ready\n");
                                if (trim((string) fgets($sockets[1])) !== 'go') {
                                    throw new \RuntimeException('Goal buddy lock barrier timed out');
                                }
                            }
                        });
                        DB::listen(function (QueryExecuted $event) use (&$waitingAfterPlainRead, $sockets): void {
                            $sql = strtolower($event->sql);
                            if (
                                $waitingAfterPlainRead
                                && str_contains($sql, 'from `goals`')
                                && !str_contains($sql, 'for update')
                            ) {
                                $waitingAfterPlainRead = false;
                                fwrite($sockets[1], "ready\n");
                                if (trim((string) fgets($sockets[1])) !== 'go') {
                                    throw new \RuntimeException('Goal buddy read barrier timed out');
                                }
                            }
                        });

                        $result = (new GoalService(new Goal()))->offerBuddy((int) $goal->id, (int) $buddy->id);
                        fwrite($sockets[1], json_encode(['won' => $result !== null], JSON_THROW_ON_ERROR) . "\n");
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

            $wins = [];
            foreach ($workers as $worker) {
                $payload = json_decode((string) fgets($worker['socket']), true);
                self::assertIsArray($payload);
                self::assertArrayNotHasKey('error', $payload, json_encode($payload));
                $wins[] = (bool) $payload['won'];
            }

            DB::reconnect();
            self::assertSame(1, count(array_filter($wins)));
            $persistedMentorId = (int) DB::table('goals')->where('id', $goal->id)->value('mentor_id');
            self::assertContains(
                $persistedMentorId,
                array_map(static fn (User $buddy): int => (int) $buddy->id, $buddies)
            );
            $history = DB::table('goal_progress_history')
                ->where('goal_id', $goal->id)
                ->where('event_type', 'buddy_joined')
                ->get();
            self::assertCount(1, $history);
            self::assertSame($persistedMentorId, (int) (json_decode((string) $history[0]->data, true)['buddy_id'] ?? 0));

            $progressLog = DB::table('goal_progress_log')
                ->where('goal_id', $goal->id)
                ->where('event_type', 'buddy_joined')
                ->get();
            self::assertCount(1, $progressLog);
            self::assertSame($persistedMentorId, (int) $progressLog[0]->created_by);
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
            DB::table('goal_progress_log')->where('goal_id', $goal->id)->delete();
            DB::table('goal_progress_history')->where('goal_id', $goal->id)->delete();
            DB::table('goals')->where('id', $goal->id)->delete();
            DB::table('users')->whereIn('id', [$owner->id, ...array_map(
                static fn (User $buddy): int => (int) $buddy->id,
                $buddies
            )])->delete();
        }
    }
}
