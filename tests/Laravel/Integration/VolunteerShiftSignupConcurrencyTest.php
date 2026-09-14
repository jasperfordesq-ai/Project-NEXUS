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

final class VolunteerShiftSignupConcurrencyTest extends TestCase
{
    public static function signupRaces(): array
    {
        return [
            'same target becomes replay' => [false],
            'different targets reject stale choice' => [true],
        ];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('signupRaces')]
    public function test_simultaneous_signup_has_one_authoritative_assignment(bool $differentTargets): void
    {
        foreach (['pcntl_fork', 'pcntl_waitpid', 'stream_socket_pair', 'posix_kill'] as $function) {
            if (! function_exists($function)) {
                self::markTestSkipped("{$function} is required for concurrent shift verification.");
            }
        }
        self::assertSame('nexus_test', DB::connection()->getDatabaseName());
        $tenantId = $this->testTenantId;
        $suffix = bin2hex(random_bytes(8));
        $ownerId = $this->createUser($tenantId, "shift-owner-{$suffix}@example.test", $suffix);
        $applicantId = $this->createUser($tenantId, "shift-member-{$suffix}@example.test", $suffix);
        $organizationId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $tenantId, 'user_id' => $ownerId,
            'name' => 'Shift concurrency organisation', 'slug' => "shift-concurrency-{$suffix}",
            'description' => 'Concurrent signup fixture.', 'status' => 'active',
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $opportunityId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $tenantId, 'organization_id' => $organizationId, 'created_by' => $ownerId,
            'title' => 'Concurrent shift signup', 'description' => 'Concurrent signup fixture.',
            'status' => 'active', 'is_active' => true, 'created_at' => now(), 'updated_at' => now(),
        ]);
        $shiftId = (int) DB::table('vol_shifts')->insertGetId([
            'tenant_id' => $tenantId, 'opportunity_id' => $opportunityId,
            'start_time' => now()->addDays(7), 'end_time' => now()->addDays(7)->addHours(2),
            'capacity' => 1, 'created_at' => now(),
        ]);
        $secondShiftId = (int) DB::table('vol_shifts')->insertGetId([
            'tenant_id' => $tenantId, 'opportunity_id' => $opportunityId,
            'start_time' => now()->addDays(8), 'end_time' => now()->addDays(8)->addHours(2),
            'capacity' => 1, 'created_at' => now(),
        ]);
        $applicationId = (int) DB::table('vol_applications')->insertGetId([
            'tenant_id' => $tenantId, 'opportunity_id' => $opportunityId, 'user_id' => $applicantId,
            'status' => 'approved', 'created_at' => now(), 'updated_at' => now(),
        ]);
        $workers = [];

        try {
            DB::purge();
            for ($index = 0; $index < 2; $index++) {
                $targetShiftId = $differentTargets && $index === 1 ? $secondShiftId : $shiftId;
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
                            throw new \RuntimeException('Shift barrier timed out');
                        }
                        fwrite($sockets[1], "calling\n");
                        $success = VolunteerService::signUpForShift($targetShiftId, $applicantId, null, true);
                        fwrite($sockets[1], json_encode([
                            'success' => $success,
                            'changed' => VolunteerService::didLastShiftSignupChange(),
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

            foreach ($workers as $worker) self::assertSame('ready', trim((string) fgets($worker['socket'])));
            DB::reconnect();
            DB::beginTransaction();
            DB::table('vol_applications')->where('id', $applicationId)->lockForUpdate()->first();
            foreach ($workers as $worker) fwrite($worker['socket'], "go\n");
            foreach ($workers as $worker) self::assertSame('calling', trim((string) fgets($worker['socket'])));
            usleep(250_000);
            DB::commit();

            $results = [];
            foreach ($workers as $worker) {
                $result = json_decode((string) fgets($worker['socket']), true);
                self::assertIsArray($result);
                self::assertArrayNotHasKey('error', $result, json_encode($result));
                $results[] = $result;
            }
            if ($differentTargets) {
                self::assertSame(1, count(array_filter(array_column($results, 'success'))));
                self::assertSame(1, count(array_filter(array_column($results, 'changed'))));
                $loser = collect($results)->firstWhere('success', false);
                self::assertSame('DECISION_CONFLICT', $loser['errors'][0]['code'] ?? null);
            } else {
                self::assertSame([true, true], array_column($results, 'success'));
                self::assertEqualsCanonicalizing([false, true], array_column($results, 'changed'));
            }
            DB::reconnect();
            self::assertContains(
                (int) DB::table('vol_applications')->where('id', $applicationId)->value('shift_id'),
                [$shiftId, $secondShiftId],
            );
            self::assertSame(1, DB::table('notifications')->where('user_id', $applicantId)->count());
        } finally {
            if (DB::transactionLevel() > 0) DB::rollBack();
            foreach ($workers as $worker) {
                if (pcntl_waitpid($worker['pid'], $status, WNOHANG) === 0) {
                    posix_kill($worker['pid'], 9);
                    pcntl_waitpid($worker['pid'], $status);
                }
                fclose($worker['socket']);
            }
            DB::purge();
            DB::reconnect();
            DB::table('notifications')->where('user_id', $applicantId)->delete();
            DB::table('vol_applications')->where('id', $applicationId)->delete();
            DB::table('vol_shifts')->whereIn('id', [$shiftId, $secondShiftId])->delete();
            DB::table('vol_opportunities')->where('id', $opportunityId)->delete();
            DB::table('vol_organizations')->where('id', $organizationId)->delete();
            DB::table('users')->whereIn('id', [$ownerId, $applicantId])->delete();
        }
    }

    private function createUser(int $tenantId, string $email, string $password): int
    {
        return (int) DB::table('users')->insertGetId([
            'tenant_id' => $tenantId, 'name' => 'Shift concurrency fixture', 'email' => $email,
            'password_hash' => password_hash($password, PASSWORD_BCRYPT), 'balance' => 0,
            'role' => 'member', 'status' => 'active', 'is_active' => true, 'is_approved' => true,
            'preferred_language' => 'en', 'created_at' => now(), 'updated_at' => now(),
        ]);
    }
}
