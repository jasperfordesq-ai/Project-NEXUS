<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Integration;

use App\Core\TenantContext;
use App\Services\ShiftSwapService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Tests\Laravel\TestCase;

final class ShiftSwapDecisionConcurrencyTest extends TestCase
{
    public function test_simultaneous_requests_return_one_pending_swap(): void
    {
        foreach (['pcntl_fork', 'pcntl_waitpid', 'stream_socket_pair', 'posix_kill'] as $function) {
            if (!function_exists($function)) self::markTestSkipped("{$function} is required for concurrent shift-swap verification.");
        }
        self::assertSame('nexus_test', DB::connection()->getDatabaseName());
        Mail::fake();
        Http::fake();
        Queue::fake();
        $fixture = $this->fixture();
        DB::table('vol_shift_swap_requests')->where('id', $fixture['swap_id'])->delete();
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
                    stream_set_timeout($sockets[1], 30);
                    try {
                        DB::reconnect();
                        TenantContext::reset();
                        TenantContext::setById($fixture['tenant_id']);
                        $waiting = true;
                        DB::connection()->beforeExecuting(function (string $query) use (&$waiting, $sockets): void {
                            $sql = strtolower($query);
                            if ($waiting && str_contains($sql, 'from `vol_applications`') && str_contains($sql, 'for update')) {
                                $waiting = false;
                                fwrite($sockets[1], "ready\n");
                                if (trim((string) fgets($sockets[1])) !== 'go') throw new \RuntimeException('Swap-request barrier timed out');
                            }
                        });
                        $id = ShiftSwapService::requestSwap($fixture['requester_id'], [
                            'from_shift_id' => $fixture['requester_shift_id'],
                            'to_shift_id' => $fixture['recipient_shift_id'],
                            'message' => 'Concurrent request fixture',
                        ]);
                        fwrite($sockets[1], json_encode(['id' => $id, 'errors' => ShiftSwapService::getErrors()], JSON_THROW_ON_ERROR) . "\n");
                        fclose($sockets[1]);
                        exit(0);
                    } catch (\Throwable $error) {
                        fwrite($sockets[1], json_encode(['error' => $error->getMessage()]) . "\n");
                        fclose($sockets[1]);
                        exit(1);
                    }
                }
                fclose($sockets[1]);
                stream_set_timeout($sockets[0], 30);
                $workers[] = ['pid' => $pid, 'socket' => $sockets[0]];
            }
            foreach ($workers as $worker) self::assertSame('ready', trim((string) fgets($worker['socket'])));
            foreach ($workers as $worker) fwrite($worker['socket'], "go\n");
            $ids = [];
            foreach ($workers as $worker) {
                $payload = json_decode((string) fgets($worker['socket']), true);
                self::assertIsArray($payload);
                self::assertArrayNotHasKey('error', $payload, json_encode($payload));
                self::assertNotNull($payload['id'] ?? null, json_encode($payload));
                $ids[] = (int) $payload['id'];
            }
            DB::reconnect();
            self::assertSame($ids[0], $ids[1]);
            self::assertSame(1, DB::table('vol_shift_swap_requests')
                ->where('tenant_id', $fixture['tenant_id'])
                ->where('from_user_id', $fixture['requester_id'])
                ->where('from_shift_id', $fixture['requester_shift_id'])
                ->where('to_shift_id', $fixture['recipient_shift_id'])
                ->whereIn('status', ['pending', 'admin_pending'])
                ->count());
        } finally {
            $this->stopWorkers($workers);
            $this->cleanup($fixture);
        }
    }

    public function test_accept_and_cancel_have_one_winner_and_replay_consistently(): void
    {
        foreach (['pcntl_fork', 'pcntl_waitpid', 'stream_socket_pair', 'posix_kill'] as $function) {
            if (!function_exists($function)) {
                self::markTestSkipped("{$function} is required for concurrent shift-swap verification.");
            }
        }
        self::assertSame('nexus_test', DB::connection()->getDatabaseName());
        Mail::fake();
        Http::fake();
        Queue::fake();

        $fixture = $this->fixture();
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
                    stream_set_timeout($sockets[1], 30);
                    try {
                        DB::reconnect();
                        DB::statement('SET SESSION innodb_lock_wait_timeout = 15');
                        TenantContext::reset();
                        TenantContext::setById($fixture['tenant_id']);
                        $waiting = true;
                        DB::connection()->beforeExecuting(function (string $query) use (&$waiting, $sockets): void {
                            $sql = strtolower($query);
                            if ($waiting && str_contains($sql, 'from `vol_shift_swap_requests`') && str_contains($sql, 'for update')) {
                                $waiting = false;
                                fwrite($sockets[1], "ready\n");
                                if (trim((string) fgets($sockets[1])) !== 'go') {
                                    throw new \RuntimeException('Shift-swap decision barrier timed out');
                                }
                            }
                        });
                        $result = $action === 'accept'
                            ? ShiftSwapService::respond($fixture['swap_id'], $fixture['recipient_id'], 'accept')
                            : ShiftSwapService::cancel($fixture['swap_id'], $fixture['requester_id'], $fixture['tenant_id']);
                        fwrite($sockets[1], json_encode([
                            'result' => $result,
                            'errors' => ShiftSwapService::getErrors(),
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
                stream_set_timeout($sockets[0], 30);
                $workers[] = ['pid' => $pid, 'socket' => $sockets[0], 'action' => $action];
            }

            foreach ($workers as $worker) self::assertSame('ready', trim((string) fgets($worker['socket'])));
            foreach ($workers as $worker) fwrite($worker['socket'], "go\n");
            $results = [];
            foreach ($workers as $worker) {
                $raw = fgets($worker['socket']);
                $payload = json_decode((string) $raw, true);
                self::assertIsArray($payload, $worker['action'] . ' returned no JSON: ' . var_export($raw, true));
                self::assertArrayNotHasKey('error', $payload, json_encode($payload));
                $results[$worker['action']] = $payload;
            }

            DB::reconnect();
            self::assertSame(1, count(array_filter($results, static fn (array $result): bool => $result['result'] === true)));
            $loser = array_values(array_filter($results, static fn (array $result): bool => $result['result'] === false))[0];
            self::assertSame('DECISION_CONFLICT', $loser['errors'][0]['code'] ?? null);
            $status = (string) DB::table('vol_shift_swap_requests')->where('id', $fixture['swap_id'])->value('status');
            self::assertContains($status, ['accepted', 'cancelled']);

            $requesterShift = (int) DB::table('vol_applications')->where('id', $fixture['requester_application_id'])->value('shift_id');
            $recipientShift = (int) DB::table('vol_applications')->where('id', $fixture['recipient_application_id'])->value('shift_id');
            if ($status === 'accepted') {
                self::assertSame($fixture['recipient_shift_id'], $requesterShift);
                self::assertSame($fixture['requester_shift_id'], $recipientShift);
                self::assertTrue(ShiftSwapService::respond($fixture['swap_id'], $fixture['recipient_id'], 'accept'));
                self::assertFalse(ShiftSwapService::cancel($fixture['swap_id'], $fixture['requester_id'], $fixture['tenant_id']));
            } else {
                self::assertSame($fixture['requester_shift_id'], $requesterShift);
                self::assertSame($fixture['recipient_shift_id'], $recipientShift);
                self::assertTrue(ShiftSwapService::cancel($fixture['swap_id'], $fixture['requester_id'], $fixture['tenant_id']));
                self::assertFalse(ShiftSwapService::respond($fixture['swap_id'], $fixture['recipient_id'], 'accept'));
            }
            self::assertSame('DECISION_CONFLICT', ShiftSwapService::getErrors()[0]['code'] ?? null);
        } finally {
            $this->stopWorkers($workers);
            $this->cleanup($fixture);
        }
    }

    public function test_admin_approve_and_reject_have_one_winner_and_replay_consistently(): void
    {
        foreach (['pcntl_fork', 'pcntl_waitpid', 'stream_socket_pair', 'posix_kill'] as $function) {
            if (!function_exists($function)) self::markTestSkipped("{$function} is required for concurrent shift-swap verification.");
        }
        self::assertSame('nexus_test', DB::connection()->getDatabaseName());
        Mail::fake();
        Http::fake();
        Queue::fake();
        $fixture = $this->fixture();
        DB::table('vol_shift_swap_requests')->where('id', $fixture['swap_id'])->update([
            'status' => 'admin_pending',
            'requires_admin_approval' => 1,
        ]);
        $workers = [];
        try {
            DB::purge();
            foreach (['approve', 'reject'] as $action) {
                $sockets = stream_socket_pair(STREAM_PF_UNIX, STREAM_SOCK_STREAM, STREAM_IPPROTO_IP);
                self::assertNotFalse($sockets);
                $pid = pcntl_fork();
                self::assertNotSame(-1, $pid);
                if ($pid === 0) {
                    fclose($sockets[0]);
                    stream_set_timeout($sockets[1], 30);
                    try {
                        DB::reconnect();
                        DB::statement('SET SESSION innodb_lock_wait_timeout = 15');
                        TenantContext::reset();
                        TenantContext::setById($fixture['tenant_id']);
                        $waiting = true;
                        DB::connection()->beforeExecuting(function (string $query) use (&$waiting, $sockets): void {
                            $sql = strtolower($query);
                            if ($waiting && str_contains($sql, 'from `vol_shift_swap_requests`') && str_contains($sql, 'for update')) {
                                $waiting = false;
                                fwrite($sockets[1], "ready\n");
                                if (trim((string) fgets($sockets[1])) !== 'go') throw new \RuntimeException('Admin decision barrier timed out');
                            }
                        });
                        $result = ShiftSwapService::adminDecision($fixture['swap_id'], $fixture['owner_id'], $action);
                        fwrite($sockets[1], json_encode(['result' => $result, 'errors' => ShiftSwapService::getErrors()], JSON_THROW_ON_ERROR) . "\n");
                        fclose($sockets[1]);
                        exit(0);
                    } catch (\Throwable $error) {
                        fwrite($sockets[1], json_encode(['error' => $error->getMessage()]) . "\n");
                        fclose($sockets[1]);
                        exit(1);
                    }
                }
                fclose($sockets[1]);
                stream_set_timeout($sockets[0], 30);
                $workers[] = ['pid' => $pid, 'socket' => $sockets[0], 'action' => $action];
            }
            foreach ($workers as $worker) self::assertSame('ready', trim((string) fgets($worker['socket'])));
            foreach ($workers as $worker) fwrite($worker['socket'], "go\n");
            $results = [];
            foreach ($workers as $worker) {
                $payload = json_decode((string) fgets($worker['socket']), true);
                self::assertIsArray($payload);
                self::assertArrayNotHasKey('error', $payload, json_encode($payload));
                $results[$worker['action']] = $payload;
            }

            DB::reconnect();
            self::assertSame(1, count(array_filter($results, static fn (array $result): bool => $result['result'] === true)));
            $loser = array_values(array_filter($results, static fn (array $result): bool => $result['result'] === false))[0];
            self::assertSame('DECISION_CONFLICT', $loser['errors'][0]['code'] ?? null);
            $status = (string) DB::table('vol_shift_swap_requests')->where('id', $fixture['swap_id'])->value('status');
            self::assertContains($status, ['admin_approved', 'admin_rejected']);
            $winningAction = $status === 'admin_approved' ? 'approve' : 'reject';
            $losingAction = $winningAction === 'approve' ? 'reject' : 'approve';
            TenantContext::setById($fixture['tenant_id']);
            self::assertTrue(ShiftSwapService::adminDecision($fixture['swap_id'], $fixture['owner_id'], $winningAction));
            self::assertFalse(ShiftSwapService::adminDecision($fixture['swap_id'], $fixture['owner_id'], $losingAction));
            self::assertSame('DECISION_CONFLICT', ShiftSwapService::getErrors()[0]['code'] ?? null);
        } finally {
            $this->stopWorkers($workers);
            $this->cleanup($fixture);
        }
    }

    /** @param array<int, array{pid:int,socket:resource}> $workers */
    private function stopWorkers(array $workers): void
    {
        foreach ($workers as $worker) {
            if (pcntl_waitpid($worker['pid'], $status, WNOHANG) === 0) {
                posix_kill($worker['pid'], 9);
                pcntl_waitpid($worker['pid'], $status);
            }
            fclose($worker['socket']);
        }
    }

    /** @param array<string, int> $fixture */
    private function cleanup(array $fixture): void
    {
        DB::purge();
        DB::reconnect();
        DB::table('notifications')->whereIn('user_id', [$fixture['requester_id'], $fixture['recipient_id']])->delete();
        DB::table('vol_shift_swap_requests')
            ->where('tenant_id', $fixture['tenant_id'])
            ->where('from_user_id', $fixture['requester_id'])
            ->where('from_shift_id', $fixture['requester_shift_id'])
            ->where('to_shift_id', $fixture['recipient_shift_id'])
            ->delete();
        DB::table('vol_applications')->whereIn('id', [$fixture['requester_application_id'], $fixture['recipient_application_id']])->delete();
        DB::table('vol_shifts')->whereIn('id', [$fixture['requester_shift_id'], $fixture['recipient_shift_id']])->delete();
        DB::table('vol_opportunities')->where('id', $fixture['opportunity_id'])->delete();
        DB::table('vol_organizations')->where('id', $fixture['organisation_id'])->delete();
        DB::table('users')->whereIn('id', [$fixture['owner_id'], $fixture['requester_id'], $fixture['recipient_id']])->delete();
    }

    /** @return array<string, int> */
    private function fixture(): array
    {
        $tenantId = $this->testTenantId;
        $ownerId = $this->user('Swap race owner', $tenantId);
        $requesterId = $this->user('Swap race requester', $tenantId);
        $recipientId = $this->user('Swap race recipient', $tenantId);
        $organisationId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $tenantId, 'user_id' => $ownerId, 'name' => 'Swap race organisation ' . bin2hex(random_bytes(4)),
            'slug' => 'swap-race-' . bin2hex(random_bytes(7)), 'status' => 'approved', 'created_at' => now(), 'updated_at' => now(),
        ]);
        $opportunityId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $tenantId, 'organization_id' => $organisationId, 'created_by' => $ownerId,
            'title' => 'Swap race opportunity', 'description' => 'Concurrency fixture', 'status' => 'active', 'is_active' => 1,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $requesterShiftId = (int) DB::table('vol_shifts')->insertGetId([
            'tenant_id' => $tenantId, 'opportunity_id' => $opportunityId, 'start_time' => now()->addDays(2),
            'end_time' => now()->addDays(2)->addHours(2), 'capacity' => 5,
        ]);
        $recipientShiftId = (int) DB::table('vol_shifts')->insertGetId([
            'tenant_id' => $tenantId, 'opportunity_id' => $opportunityId, 'start_time' => now()->addDays(3),
            'end_time' => now()->addDays(3)->addHours(2), 'capacity' => 5,
        ]);
        $requesterApplicationId = $this->application($tenantId, $opportunityId, $requesterShiftId, $requesterId);
        $recipientApplicationId = $this->application($tenantId, $opportunityId, $recipientShiftId, $recipientId);
        $swapId = (int) DB::table('vol_shift_swap_requests')->insertGetId([
            'tenant_id' => $tenantId, 'from_user_id' => $requesterId, 'to_user_id' => $recipientId,
            'from_shift_id' => $requesterShiftId, 'to_shift_id' => $recipientShiftId,
            'status' => 'pending', 'requires_admin_approval' => 0, 'created_at' => now(),
        ]);
        return compact('tenantId', 'ownerId', 'requesterId', 'recipientId', 'organisationId', 'opportunityId', 'requesterShiftId', 'recipientShiftId', 'requesterApplicationId', 'recipientApplicationId', 'swapId') + [
            'tenant_id' => $tenantId, 'owner_id' => $ownerId, 'requester_id' => $requesterId,
            'recipient_id' => $recipientId, 'organisation_id' => $organisationId, 'opportunity_id' => $opportunityId,
            'requester_shift_id' => $requesterShiftId, 'recipient_shift_id' => $recipientShiftId,
            'requester_application_id' => $requesterApplicationId, 'recipient_application_id' => $recipientApplicationId,
            'swap_id' => $swapId,
        ];
    }

    private function application(int $tenantId, int $opportunityId, int $shiftId, int $userId): int
    {
        return (int) DB::table('vol_applications')->insertGetId([
            'tenant_id' => $tenantId, 'opportunity_id' => $opportunityId, 'shift_id' => $shiftId,
            'user_id' => $userId, 'status' => 'approved', 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function user(string $name, int $tenantId): int
    {
        return (int) DB::table('users')->insertGetId([
            'tenant_id' => $tenantId, 'name' => $name,
            'email' => strtolower(str_replace(' ', '-', $name)) . '-' . bin2hex(random_bytes(8)) . '@example.test',
            'password_hash' => password_hash(bin2hex(random_bytes(16)), PASSWORD_BCRYPT),
            'balance' => 0, 'role' => 'member', 'status' => 'active', 'is_active' => true,
            'is_approved' => true, 'preferred_language' => 'en', 'created_at' => now(), 'updated_at' => now(),
        ]);
    }
}
