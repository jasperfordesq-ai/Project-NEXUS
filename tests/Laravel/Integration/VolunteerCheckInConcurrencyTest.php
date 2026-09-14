<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Integration;

use App\Core\TenantContext;
use App\Services\VolunteerCheckInService;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

final class VolunteerCheckInConcurrencyTest extends TestCase
{
    public function test_two_coordinators_cannot_both_own_the_checkin_transition(): void
    {
        foreach (['pcntl_fork', 'pcntl_waitpid', 'stream_socket_pair', 'posix_kill'] as $function) {
            if (! function_exists($function)) {
                self::markTestSkipped("{$function} is required for concurrent check-in verification.");
            }
        }
        self::assertSame('nexus_test', DB::connection()->getDatabaseName());

        $tenantId = $this->testTenantId;
        $suffix = bin2hex(random_bytes(8));
        $userId = (int) DB::table('users')->insertGetId([
            'tenant_id' => $tenantId,
            'name' => 'Check-in concurrency fixture',
            'email' => "checkin-concurrency-{$suffix}@example.test",
            'password_hash' => password_hash($suffix, PASSWORD_BCRYPT),
            'balance' => 0,
            'role' => 'member',
            'status' => 'active',
            'is_active' => true,
            'is_approved' => true,
            'preferred_language' => 'en',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $organizationId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $tenantId,
            'user_id' => $userId,
            'name' => 'Check-in concurrency organisation',
            'slug' => "checkin-concurrency-{$suffix}",
            'description' => 'Organisation used for simultaneous QR scans.',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $opportunityId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $tenantId,
            'organization_id' => $organizationId,
            'title' => 'Concurrent QR scan',
            'description' => 'Opportunity used for simultaneous QR scans.',
            'status' => 'active',
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $shiftId = (int) DB::table('vol_shifts')->insertGetId([
            'tenant_id' => $tenantId,
            'opportunity_id' => $opportunityId,
            'start_time' => now()->subMinute(),
            'end_time' => now()->addHour(),
            'capacity' => 5,
            'created_at' => now(),
        ]);
        $token = bin2hex(random_bytes(32));
        $checkinId = (int) DB::table('vol_shift_checkins')->insertGetId([
            'tenant_id' => $tenantId,
            'shift_id' => $shiftId,
            'user_id' => $userId,
            'qr_token' => $token,
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $workers = [];

        try {
            // Fork without an open PDO connection. A child closing an inherited MySQL
            // socket can otherwise disconnect the parent's row-lock transaction.
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
                        DB::purge();
                        DB::reconnect();
                        DB::statement('SET SESSION innodb_lock_wait_timeout = 10');
                        TenantContext::reset();
                        TenantContext::setById($tenantId);
                        fwrite($sockets[1], "ready\n");
                        if (trim((string) fgets($sockets[1])) !== 'go') {
                            throw new \RuntimeException('Check-in barrier timed out');
                        }
                        fwrite($sockets[1], "calling\n");
                        $result = (new VolunteerCheckInService())->verifyCheckIn($token);
                        fwrite($sockets[1], json_encode($result, JSON_THROW_ON_ERROR) . "\n");
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

            // Hold the row while both workers perform their ordinary snapshot read.
            // They then queue at the conditional UPDATE, making the race deterministic.
            DB::reconnect();
            DB::beginTransaction();
            DB::table('vol_shift_checkins')->where('id', $checkinId)->lockForUpdate()->first();
            foreach ($workers as $worker) {
                fwrite($worker['socket'], "go\n");
            }
            foreach ($workers as $worker) {
                self::assertSame('calling', trim((string) fgets($worker['socket'])));
            }
            usleep(250_000);
            DB::commit();

            $results = [];
            foreach ($workers as $worker) {
                $result = json_decode((string) fgets($worker['socket']), true);
                self::assertIsArray($result);
                self::assertArrayNotHasKey('error', $result, json_encode($result));
                $results[] = $result;
            }

            self::assertEqualsCanonicalizing(
                ['checked_in', 'already_checked_in'],
                array_column($results, 'status'),
            );
            self::assertCount(1, array_unique(array_column($results, 'checked_in_at')));
            DB::reconnect();
            self::assertSame('checked_in', DB::table('vol_shift_checkins')->where('id', $checkinId)->value('status'));
        } finally {
            if (DB::transactionLevel() > 0) {
                DB::rollBack();
            }
            foreach ($workers as $worker) {
                if (pcntl_waitpid($worker['pid'], $status, WNOHANG) === 0) {
                    posix_kill($worker['pid'], 9);
                    pcntl_waitpid($worker['pid'], $status);
                }
                fclose($worker['socket']);
            }
            DB::purge();
            DB::reconnect();
            DB::table('vol_shift_checkins')->where('id', $checkinId)->delete();
            DB::table('vol_shifts')->where('id', $shiftId)->delete();
            DB::table('vol_opportunities')->where('id', $opportunityId)->delete();
            DB::table('vol_organizations')->where('id', $organizationId)->delete();
            DB::table('users')->where('id', $userId)->delete();
        }
    }
}
