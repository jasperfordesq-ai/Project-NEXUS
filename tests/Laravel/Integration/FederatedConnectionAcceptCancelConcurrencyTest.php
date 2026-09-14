<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Integration;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\FederatedConnectionService;
use App\Services\SafeguardingInteractionPolicy;
use App\Support\SafeguardingInteractionDecision;
use Illuminate\Support\Facades\DB;
use Mockery;
use Tests\Laravel\TestCase;

final class FederatedConnectionAcceptCancelConcurrencyTest extends TestCase
{
    public function test_requester_cancel_and_receiver_accept_have_one_committed_federation_outcome(): void
    {
        foreach (['pcntl_fork', 'pcntl_waitpid', 'stream_socket_pair', 'posix_kill'] as $function) {
            if (! function_exists($function)) {
                self::markTestSkipped("{$function} is required for federation concurrency verification.");
            }
        }
        self::assertSame('nexus_test', DB::connection()->getDatabaseName());

        $partnerTenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'Federation concurrency partner',
            'slug' => 'federation-concurrency-' . substr(uniqid(), -8),
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $requester = User::factory()->forTenant($this->testTenantId)->create();
        $receiver = User::factory()->forTenant($partnerTenantId)->create();
        $connectionId = (int) DB::table('federation_connections')->insertGetId([
            'requester_user_id' => $requester->id,
            'requester_tenant_id' => $this->testTenantId,
            'receiver_user_id' => $receiver->id,
            'receiver_tenant_id' => $partnerTenantId,
            'status' => 'pending',
            'created_at' => now(),
        ]);

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('evaluateCrossTenantContact')->zeroOrMoreTimes()->andReturn(
            new SafeguardingInteractionDecision(
                status: SafeguardingInteractionDecision::ALLOW,
                code: 'SAFEGUARDING_ALLOWED',
                recipientTenantId: $partnerTenantId,
                purposeCode: 'safeguarded_member_contact',
                scopeType: 'tenant',
                scopeIdentifier: '',
            )
        );
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);
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
                        TenantContext::setById($action === 'accept' ? $partnerTenantId : $this->testTenantId);
                        $waiting = true;
                        DB::connection()->beforeExecuting(function (string $query) use (&$waiting, $sockets): void {
                            $sql = strtolower($query);
                            if ($waiting && str_contains($sql, 'from federation_connections') && str_contains($sql, 'for update')) {
                                $waiting = false;
                                fwrite($sockets[1], "ready\n");
                                if (trim((string) fgets($sockets[1])) !== 'go') {
                                    throw new \RuntimeException('Federation transition barrier timed out');
                                }
                            }
                        });

                        $service = app(FederatedConnectionService::class);
                        $result = $action === 'accept'
                            ? $service->acceptRequest($connectionId, (int) $receiver->id)
                            : $service->removeConnection($connectionId, (int) $requester->id, 'pending');
                        $outcome = $result['success']
                            ? ($action === 'accept' ? 'accepted' : 'cancelled')
                            : (string) ($result['error_code'] ?? 'failed');
                        fwrite($sockets[1], json_encode(['outcome' => $outcome], JSON_THROW_ON_ERROR) . "\n");
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
            $storedStatus = DB::table('federation_connections')->where('id', $connectionId)->value('status');
            if (in_array('accepted', $outcomes, true)) {
                self::assertContains('CONNECTION_STATE_CHANGED', $outcomes);
                self::assertSame('accepted', $storedStatus);
            } else {
                self::assertContains('cancelled', $outcomes);
                self::assertContains('CONNECTION_STATE_CHANGED', $outcomes);
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
            DB::table('notifications')->whereIn('user_id', [$requester->id, $receiver->id])->delete();
            DB::table('federation_connections')->where('id', $connectionId)->delete();
            DB::table('users')->whereIn('id', [$requester->id, $receiver->id])->delete();
            DB::table('tenants')->where('id', $partnerTenantId)->delete();
        }
    }
}
