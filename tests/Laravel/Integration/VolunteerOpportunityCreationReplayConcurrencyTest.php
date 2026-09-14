<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Integration;

use App\Core\TenantContext;
use App\Services\VolunteerOpportunityCreationReceiptService;
use App\Services\VolunteerService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Tests\Laravel\TestCase;

final class VolunteerOpportunityCreationReplayConcurrencyTest extends TestCase
{
    public function test_two_independent_retries_with_one_key_create_one_opportunity_in_the_active_tenant(): void
    {
        foreach (['pcntl_fork', 'pcntl_waitpid', 'stream_socket_pair', 'posix_kill'] as $function) {
            if (! function_exists($function)) {
                self::markTestSkipped("{$function} is required for concurrent opportunity verification.");
            }
        }
        self::assertSame('nexus_test', DB::connection()->getDatabaseName());
        Event::fake();

        $tenantId = $this->testTenantId;
        $userId = (int) DB::table('users')->insertGetId([
            'tenant_id' => $tenantId,
            'name' => 'Opportunity concurrency fixture',
            'email' => 'opportunity-concurrency-' . bin2hex(random_bytes(10)) . '@example.test',
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
        $organizationId = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $tenantId,
            'user_id' => $userId,
            'name' => 'Opportunity concurrency organisation',
            'slug' => 'opportunity-concurrency-' . bin2hex(random_bytes(6)),
            'description' => 'Organisation used to verify simultaneous opportunity retries.',
            'contact_email' => 'opportunity-concurrency@example.test',
            'status' => 'active',
            'org_type' => 'organisation',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $title = 'Concurrent volunteer role ' . bin2hex(random_bytes(6));
        $intent = [
            'organization_id' => $organizationId,
            'title' => $title,
            'description' => 'Both workers represent one create request whose response was lost.',
            'location' => 'Community centre',
        ];
        $identity = VolunteerOpportunityCreationReceiptService::identity(
            'simultaneous-mobile-opportunity-create',
            $intent,
        );
        self::assertIsArray($identity);
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
                            throw new \RuntimeException('Opportunity creation barrier timed out');
                        }
                        $result = VolunteerOpportunityCreationReceiptService::create(
                            $userId,
                            $identity,
                            fn () => app(VolunteerService::class)->createOpportunity($userId, $intent),
                        );
                        if (! $result['opportunity']) {
                            throw new \RuntimeException('Opportunity creation returned no result');
                        }
                        fwrite($sockets[1], json_encode([
                            'id' => (int) $result['opportunity']->id,
                            'tenant_id' => (int) $result['opportunity']->tenant_id,
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
            foreach ($workers as $worker) {
                fwrite($worker['socket'], "go\n");
            }
            $ids = [];
            foreach ($workers as $worker) {
                $result = json_decode((string) fgets($worker['socket']), true);
                self::assertIsArray($result);
                self::assertArrayNotHasKey('error', $result, json_encode($result));
                self::assertSame($tenantId, (int) $result['tenant_id']);
                $ids[] = (int) $result['id'];
            }

            self::assertSame($ids[0], $ids[1]);
            DB::reconnect();
            self::assertSame(1, DB::table('vol_opportunities')
                ->where('tenant_id', $tenantId)
                ->where('created_by', $userId)
                ->where('title', $title)
                ->count());
            self::assertSame(1, DB::table('volunteer_opportunity_creation_receipts')
                ->where('tenant_id', $tenantId)
                ->where('actor_user_id', $userId)
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
            $opportunityIds = DB::table('vol_opportunities')
                ->where('created_by', $userId)
                ->where('title', $title)
                ->pluck('id');
            DB::table('volunteer_opportunity_creation_receipts')->whereIn('opportunity_id', $opportunityIds)->delete();
            DB::table('vol_opportunities')->whereIn('id', $opportunityIds)->delete();
            DB::table('vol_organizations')->where('id', $organizationId)->delete();
            DB::table('users')->where('id', $userId)->delete();
        }
    }
}
