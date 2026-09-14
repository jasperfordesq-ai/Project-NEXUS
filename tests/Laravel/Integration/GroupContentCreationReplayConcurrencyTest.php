<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Integration;

use App\Core\TenantContext;
use App\Services\GroupService;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

final class GroupContentCreationReplayConcurrencyTest extends TestCase
{
    public function test_two_processes_with_one_discussion_key_create_one_discussion_and_root_post(): void
    {
        foreach (['pcntl_fork', 'pcntl_waitpid', 'stream_socket_pair', 'posix_kill'] as $function) {
            if (! function_exists($function)) {
                self::markTestSkipped("{$function} is required for concurrent group-content verification.");
            }
        }
        self::assertSame('nexus_test', DB::connection()->getDatabaseName());

        $tenantId = $this->testTenantId;
        $userId = (int) DB::table('users')->insertGetId([
            'tenant_id' => $tenantId,
            'name' => 'Group replay fixture',
            'email' => 'group-replay-' . bin2hex(random_bytes(10)) . '@example.test',
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
        $groupId = (int) DB::table('groups')->insertGetId([
            'tenant_id' => $tenantId,
            'owner_id' => $userId,
            'name' => 'Concurrent group fixture',
            'description' => 'Committed before two workers start.',
            'visibility' => 'private',
            'status' => 'active',
            'is_active' => true,
            'cached_member_count' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('group_members')->insert([
            'tenant_id' => $tenantId,
            'group_id' => $groupId,
            'user_id' => $userId,
            'role' => 'owner',
            'status' => 'active',
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
                        TenantContext::setById($tenantId);
                        fwrite($sockets[1], "ready\n");
                        if (trim((string) fgets($sockets[1])) !== 'go') {
                            throw new \RuntimeException('Group replay barrier timed out');
                        }
                        $result = GroupService::createDiscussion($groupId, $userId, [
                            'title' => 'One accepted discussion',
                            'content' => 'Both workers represent the same mobile retry.',
                            'idempotency_key' => 'simultaneous-mobile-group-discussion',
                        ]);
                        if ($result === null) {
                            throw new \RuntimeException(json_encode(GroupService::getErrors(), JSON_THROW_ON_ERROR));
                        }
                        fwrite($sockets[1], json_encode(['id' => $result['id']], JSON_THROW_ON_ERROR) . "\n");
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
            self::assertSame(1, DB::table('group_discussions')->where('group_id', $groupId)->count());
            self::assertSame(1, DB::table('group_posts')->where('discussion_id', $ids[0])->count());
            self::assertSame(1, DB::table('group_content_creation_receipts')
                ->where('tenant_id', $tenantId)
                ->where('actor_user_id', $userId)
                ->where('operation_type', 'discussion')
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
            DB::table('group_content_creation_receipts')->where('tenant_id', $tenantId)->where('actor_user_id', $userId)->delete();
            DB::table('group_posts')->whereIn('discussion_id', DB::table('group_discussions')->where('group_id', $groupId)->pluck('id'))->delete();
            DB::table('group_discussions')->where('group_id', $groupId)->delete();
            DB::table('group_members')->where('group_id', $groupId)->delete();
            DB::table('groups')->where('id', $groupId)->delete();
            DB::table('users')->where('id', $userId)->delete();
        }
    }
}
