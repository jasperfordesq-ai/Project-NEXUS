<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Integration;

use App\Core\TenantContext;
use App\Http\Controllers\Api\FederationExternalWebhookController;
use App\Models\User;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

final class FederationCancellationConcurrencyTest extends TestCase
{
    public function test_two_simultaneous_partner_cancellations_reverse_a_transfer_once(): void
    {
        foreach (['pcntl_fork', 'pcntl_waitpid', 'stream_socket_pair', 'posix_kill'] as $function) {
            if (! function_exists($function)) {
                self::markTestSkipped("{$function} is required for federation cancellation concurrency verification.");
            }
        }
        self::assertSame('nexus_test', DB::connection()->getDatabaseName());

        $recipient = User::factory()->forTenant($this->testTenantId)->create([
            'balance' => 10,
            'status' => 'active',
        ]);
        $partnerId = (int) DB::table('federation_external_partners')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'Cancellation concurrency partner',
            'base_url' => 'https://cancellation-race.example.test',
            'api_path' => '/api/v1/federation',
            'signing_secret' => 'test-only-cancellation-secret',
            'status' => 'active',
            'allow_member_search' => 0,
            'allow_listing_search' => 0,
            'allow_messaging' => 0,
            'allow_transactions' => 1,
            'allow_events' => 0,
            'allow_groups' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $externalTransactionId = 'cancel-race-' . bin2hex(random_bytes(6));
        $transactionId = (int) DB::table('federation_transactions')->insertGetId([
            'sender_tenant_id' => 0,
            'sender_user_id' => 42,
            'receiver_tenant_id' => $this->testTenantId,
            'receiver_user_id' => $recipient->id,
            'amount' => 2,
            'description' => 'Concurrent cancellation fixture',
            'status' => 'completed',
            'external_partner_id' => $partnerId,
            'external_receiver_name' => 'Remote sender',
            'external_transaction_id' => $externalTransactionId,
            'created_at' => now(),
            'completed_at' => now(),
        ]);
        $workers = [];

        try {
            DB::purge();
            foreach ([1, 2] as $workerNumber) {
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
                                && str_contains($sql, 'from `federation_transactions`')
                                && str_contains($sql, 'for update')
                            ) {
                                $waitingBeforeLock = false;
                                $waitingAfterPlainRead = false;
                                fwrite($sockets[1], "ready\n");
                                if (trim((string) fgets($sockets[1])) !== 'go') {
                                    throw new \RuntimeException('Federation cancellation lock barrier timed out');
                                }
                            }
                        });
                        DB::listen(function (QueryExecuted $event) use (&$waitingAfterPlainRead, $sockets): void {
                            $sql = strtolower($event->sql);
                            if (
                                $waitingAfterPlainRead
                                && str_contains($sql, 'from `federation_transactions`')
                                && ! str_contains($sql, 'for update')
                            ) {
                                $waitingAfterPlainRead = false;
                                fwrite($sockets[1], "ready\n");
                                if (trim((string) fgets($sockets[1])) !== 'go') {
                                    throw new \RuntimeException('Federation cancellation read barrier timed out');
                                }
                            }
                        });

                        $partner = (object) [
                            'id' => $partnerId,
                            'tenant_id' => $this->testTenantId,
                            'name' => 'Cancellation concurrency partner',
                            'allow_transactions' => 1,
                        ];
                        $result = app(FederationExternalWebhookController::class)->processTrustedEvent(
                            'transaction.cancelled',
                            [
                                'external_transaction_id' => $externalTransactionId,
                                'reason' => "Concurrent cancellation {$workerNumber}",
                            ],
                            $partner,
                        );
                        fwrite($sockets[1], json_encode(['status' => $result['status']], JSON_THROW_ON_ERROR) . "\n");
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

            $statuses = [];
            foreach ($workers as $worker) {
                $payload = json_decode((string) fgets($worker['socket']), true);
                self::assertIsArray($payload);
                self::assertArrayNotHasKey('error', $payload, json_encode($payload));
                $statuses[] = $payload['status'];
            }

            DB::reconnect();
            self::assertSame(8.0, (float) DB::table('users')->where('id', $recipient->id)->value('balance'));
            self::assertSame('cancelled', DB::table('federation_transactions')->where('id', $transactionId)->value('status'));
            self::assertSame(1, count(array_filter($statuses, static fn (string $status): bool => $status === 'cancelled')));
            self::assertContains('acknowledged', $statuses);
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
            DB::table('federation_transactions')->where('id', $transactionId)->delete();
            DB::table('federation_external_partners')->where('id', $partnerId)->delete();
            DB::table('users')->where('id', $recipient->id)->delete();
        }
    }
}
