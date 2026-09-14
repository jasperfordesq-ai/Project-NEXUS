<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Integration;

use App\Core\TenantContext;
use App\Services\VolunteerService;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

final class VolunteerApplicationWithdrawDecisionConcurrencyTest extends TestCase
{
    public function test_withdrawal_cannot_erase_a_competing_approval(): void
    {
        foreach (['pcntl_fork', 'pcntl_waitpid', 'stream_socket_pair', 'posix_kill'] as $function) {
            if (! function_exists($function)) {
                self::markTestSkipped("{$function} is required for concurrent application verification.");
            }
        }
        self::assertSame('nexus_test', DB::connection()->getDatabaseName());

        $tenantId = $this->testTenantId;
        $suffix = bin2hex(random_bytes(8));
        $ownerId = $this->createUser($tenantId, "application-owner-{$suffix}@example.test", $suffix);
        $applicantId = $this->createUser($tenantId, "application-member-{$suffix}@example.test", $suffix);
        $organizationId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $tenantId,
            'user_id' => $ownerId,
            'name' => 'Application concurrency organisation',
            'slug' => "application-concurrency-{$suffix}",
            'description' => 'Organisation used for a decision and withdrawal race.',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $opportunityId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $tenantId,
            'organization_id' => $organizationId,
            'created_by' => $ownerId,
            'title' => 'Concurrent application decision',
            'description' => 'Opportunity used for a decision and withdrawal race.',
            'status' => 'active',
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $applicationId = (int) DB::table('vol_applications')->insertGetId([
            'tenant_id' => $tenantId,
            'opportunity_id' => $opportunityId,
            'user_id' => $applicantId,
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $workers = [];

        try {
            DB::purge();
            foreach (['approve', 'withdraw'] as $action) {
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
                            throw new \RuntimeException('Application barrier timed out');
                        }
                        fwrite($sockets[1], "calling\n");
                        $success = $action === 'approve'
                            ? VolunteerService::handleApplication($applicationId, $ownerId, 'approve')
                            : VolunteerService::withdrawApplication($applicationId, $applicantId);
                        fwrite($sockets[1], json_encode([
                            'action' => $action,
                            'success' => $success,
                            'errors' => VolunteerService::getErrors(),
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

            DB::reconnect();
            DB::beginTransaction();
            DB::table('vol_applications')->where('id', $applicationId)->lockForUpdate()->first();
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
                $results[$result['action']] = $result;
            }

            self::assertCount(1, array_filter($results, static fn (array $result): bool => $result['success']));
            DB::reconnect();
            $final = DB::table('vol_applications')->where('id', $applicationId)->first();
            if ($results['approve']['success']) {
                self::assertNotNull($final);
                self::assertSame('approved', $final->status);
                self::assertFalse($results['withdraw']['success']);
            } else {
                self::assertNull($final);
                self::assertTrue($results['withdraw']['success']);
                self::assertFalse($results['approve']['success']);
            }
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
            DB::table('vol_applications')->where('id', $applicationId)->delete();
            DB::table('vol_opportunities')->where('id', $opportunityId)->delete();
            DB::table('vol_organizations')->where('id', $organizationId)->delete();
            DB::table('users')->whereIn('id', [$ownerId, $applicantId])->delete();
        }
    }

    private function createUser(int $tenantId, string $email, string $password): int
    {
        return (int) DB::table('users')->insertGetId([
            'tenant_id' => $tenantId,
            'name' => 'Application concurrency fixture',
            'email' => $email,
            'password_hash' => password_hash($password, PASSWORD_BCRYPT),
            'balance' => 0,
            'role' => 'member',
            'status' => 'active',
            'is_active' => true,
            'is_approved' => true,
            'preferred_language' => 'en',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
