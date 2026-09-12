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
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Tests\Laravel\TestCase;

final class VolunteerHoursDecisionConcurrencyTest extends TestCase
{
    public function test_conflicting_hours_decisions_have_one_consistent_winner(): void
    {
        foreach (['pcntl_fork', 'pcntl_waitpid', 'stream_socket_pair', 'posix_kill'] as $function) {
            if (!function_exists($function)) {
                self::markTestSkipped("{$function} is required for concurrent volunteer-hours verification.");
            }
        }
        self::assertSame('nexus_test', DB::connection()->getDatabaseName());
        Mail::fake();
        Http::fake();
        Queue::fake();

        $tenantId = $this->testTenantId;
        $adminId = $this->user('Hours decision admin', $tenantId);
        $volunteerId = $this->user('Hours decision volunteer', $tenantId);
        $orgId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $tenantId,
            'user_id' => $adminId,
            'name' => 'Concurrent hours organisation ' . bin2hex(random_bytes(5)),
            'slug' => 'concurrent-hours-' . bin2hex(random_bytes(8)),
            'description' => 'Organisation fixture for a conflicting hours decision.',
            'contact_email' => 'concurrent-hours@example.test',
            'status' => 'active',
            'auto_pay_enabled' => 1,
            'balance' => 10,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $logId = (int) DB::table('vol_logs')->insertGetId([
            'tenant_id' => $tenantId,
            'user_id' => $volunteerId,
            'organization_id' => $orgId,
            'opportunity_id' => null,
            'date_logged' => now()->subDay()->toDateString(),
            'hours' => 2,
            'description' => 'Concurrent decision fixture',
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $workers = [];

        try {
            DB::purge();
            foreach (['approve', 'decline'] as $action) {
                $sockets = stream_socket_pair(STREAM_PF_UNIX, STREAM_SOCK_STREAM, STREAM_IPPROTO_IP);
                self::assertNotFalse($sockets);
                $pid = pcntl_fork();
                self::assertNotSame(-1, $pid);
                if ($pid === 0) {
                    fclose($sockets[0]);
                    stream_set_timeout($sockets[1], 30);
                    try {
                        DB::reconnect();
                        DB::statement('SET SESSION innodb_lock_wait_timeout = 10');
                        TenantContext::reset();
                        TenantContext::setById($tenantId);
                        $waiting = true;
                        DB::connection()->beforeExecuting(function (string $query) use (&$waiting, $sockets): void {
                            if ($waiting && str_contains(strtolower($query), 'update vol_logs set status')) {
                                $waiting = false;
                                fwrite($sockets[1], "ready\n");
                                if (trim((string) fgets($sockets[1])) !== 'go') {
                                    throw new \RuntimeException('Volunteer-hours decision barrier timed out');
                                }
                            }
                        });
                        $result = VolunteerService::verifyHours($logId, $adminId, $action);
                        fwrite($sockets[1], json_encode([
                            'result' => $result,
                            'errors' => VolunteerService::getErrors(),
                            'payment_outcome' => VolunteerService::getLastPaymentOutcome(),
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

            foreach ($workers as $worker) {
                self::assertSame('ready', trim((string) fgets($worker['socket'])));
            }
            foreach ($workers as $worker) {
                fwrite($worker['socket'], "go\n");
            }
            $results = [];
            foreach ($workers as $worker) {
                $raw = fgets($worker['socket']);
                $payload = json_decode((string) $raw, true);
                self::assertIsArray($payload, sprintf(
                    '%s worker returned no JSON: raw=%s stream=%s',
                    $worker['action'],
                    var_export($raw, true),
                    json_encode(stream_get_meta_data($worker['socket'])),
                ));
                self::assertArrayNotHasKey('error', $payload, json_encode($payload));
                $results[] = $payload;
            }

            DB::reconnect();
            self::assertSame(1, count(array_filter($results, static fn (array $result): bool => $result['result'] === true)));
            $loser = array_values(array_filter($results, static fn (array $result): bool => $result['result'] === false))[0];
            self::assertSame('DECISION_CONFLICT', $loser['errors'][0]['code'] ?? null);

            $finalStatus = (string) DB::table('vol_logs')->where('id', $logId)->value('status');
            self::assertContains($finalStatus, ['approved', 'declined', 'rejected']);
            $approved = $finalStatus === 'approved';
            self::assertSame($approved ? 2 : 0, (int) DB::table('users')->where('id', $volunteerId)->value('balance'));
            self::assertEquals($approved ? 8.0 : 10.0, (float) DB::table('vol_organizations')->where('id', $orgId)->value('balance'));
            self::assertSame($approved ? 1 : 0, DB::table('vol_org_transactions')->where('vol_log_id', $logId)->where('type', 'volunteer_payment')->count());
            self::assertSame($approved ? 1 : 0, DB::table('transactions')->where('tenant_id', $tenantId)->where('receiver_id', $volunteerId)->where('transaction_type', 'volunteer')->count());

            TenantContext::reset();
            TenantContext::setById($tenantId);
            $winningAction = $approved ? 'approve' : 'decline';
            self::assertTrue(VolunteerService::verifyHours($logId, $adminId, $winningAction));
            self::assertSame('already_processed', VolunteerService::getLastPaymentOutcome());
            self::assertFalse(VolunteerService::verifyHours($logId, $adminId, $approved ? 'decline' : 'approve'));
            self::assertSame('DECISION_CONFLICT', VolunteerService::getErrors()[0]['code'] ?? null);
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
            DB::table('notifications')->whereIn('user_id', [$adminId, $volunteerId])->delete();
            DB::table('vol_org_transactions')->where('vol_log_id', $logId)->delete();
            DB::table('transactions')->where('tenant_id', $tenantId)->where('receiver_id', $volunteerId)->where('transaction_type', 'volunteer')->delete();
            DB::table('vol_logs')->where('id', $logId)->delete();
            DB::table('vol_organizations')->where('id', $orgId)->delete();
            DB::table('users')->whereIn('id', [$adminId, $volunteerId])->delete();
        }
    }

    private function user(string $name, int $tenantId): int
    {
        return (int) DB::table('users')->insertGetId([
            'tenant_id' => $tenantId,
            'name' => $name,
            'email' => strtolower(str_replace(' ', '-', $name)) . '-' . bin2hex(random_bytes(8)) . '@example.test',
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
    }
}
