<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E067;

use App\Core\TenantContext;
use App\Services\VolunteerService;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-385 (E-067) — the F-343 race on the member-facing auto-approve path.
 *
 * VolunteerService::logHours() (POST /v2/volunteering/hours) tested the
 * organisation freeze once, on an UNLOCKED read at the top of the method. When
 * the community auto-approves member hour logs, the log is written 'approved'
 * inside the minting transaction and paid by applyVolunteerAutoPayment(), which
 * locks the organisation row without reading its status. A suspension that
 * committed in between therefore still minted credits. b9f99f483 (F-343) added
 * the under-lock re-test to verifyHours() only.
 *
 * Now an auto-approved log re-applies the freeze with the organisation row
 * locked, before anything is written.
 *
 * Adapted from `.local-docs-archive/security-log/E-067/repro/e/LogHoursAutoApproveOrgFreezeRaceTest.php`,
 * which asserted the mint; the race's assertions are inverted. Rig reused from
 * F343SuspendedOrgMintsCreditsTest: one real pcntl_fork() child on its own
 * connection, parked at a stream_socket_pair barrier immediately before the
 * first `FOR UPDATE` in logHours() — i.e. after every unlocked pre-check has
 * answered. No DatabaseTransactions; fixtures removed in tearDown().
 */
final class F385LogHoursAutoApproveOrgFreezeTest extends TestCase
{
    private const SETTING = 'volunteering.hours_require_verification';

    /** @var list<int> */
    private array $users = [];
    /** @var list<int> */
    private array $orgs = [];
    private ?object $settingSnapshot = null;

    protected function setUp(): void
    {
        parent::setUp();
        $this->settingSnapshot = DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', self::SETTING)
            ->first();

        // The community auto-approves member hour logs.
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => self::SETTING],
            ['setting_value' => 'false', 'setting_type' => 'boolean', 'created_at' => now(), 'updated_at' => now()],
        );
        Cache::forget('volunteering_config:' . $this->testTenantId);
    }

    protected function tearDown(): void
    {
        DB::purge();
        DB::reconnect();

        if ($this->users !== []) {
            $logIds = DB::table('vol_logs')->whereIn('user_id', $this->users)->pluck('id')->all();
            if ($logIds !== []) {
                DB::table('vol_org_transactions')->whereIn('vol_log_id', $logIds)->delete();
                DB::table('vol_logs')->whereIn('id', $logIds)->delete();
            }
        }
        if ($this->orgs !== []) {
            DB::table('vol_org_transactions')->whereIn('vol_organization_id', $this->orgs)->delete();
            DB::table('org_members')->whereIn('organization_id', $this->orgs)->delete();
            DB::table('vol_organizations')->whereIn('id', $this->orgs)->delete();
        }
        if ($this->users !== []) {
            DB::table('transactions')->whereIn('receiver_id', $this->users)->delete();
            DB::table('transactions')->whereIn('sender_id', $this->users)->delete();
            DB::table('notifications')->whereIn('user_id', $this->users)->delete();
            DB::table('user_xp_log')->whereIn('user_id', $this->users)->delete();
            DB::table('feed_activity')->whereIn('user_id', $this->users)->delete();
            DB::table('users')->whereIn('id', $this->users)->delete();
        }

        if ($this->settingSnapshot !== null) {
            DB::table('tenant_settings')
                ->where('tenant_id', $this->testTenantId)
                ->where('setting_key', self::SETTING)
                ->update(['setting_value' => $this->settingSnapshot->setting_value]);
        } else {
            DB::table('tenant_settings')
                ->where('tenant_id', $this->testTenantId)
                ->where('setting_key', self::SETTING)
                ->delete();
        }
        Cache::forget('volunteering_config:' . $this->testTenantId);

        parent::tearDown();
    }

    public function test_control_approved_org_auto_approves_and_mints_once(): void
    {
        [$volunteer, $org] = $this->scenario('approved');
        $r = $this->log($volunteer, $org, now()->subDay()->toDateString());

        self::assertNotNull($r['id'], json_encode($r));
        self::assertSame('approved', $r['status'], 'fixture: the community must auto-approve');
        self::assertSame(3.0, $this->balance($volunteer));
    }

    public function test_control_org_suspended_before_the_request_is_refused(): void
    {
        [$volunteer, $org] = $this->scenario('suspended');
        $r = $this->log($volunteer, $org, now()->subDay()->toDateString());

        self::assertNull($r['id'], json_encode($r));
        self::assertSame(0.0, $this->balance($volunteer));
    }

    public function test_org_suspended_mid_request_cannot_mint(): void
    {
        $this->requireForking();
        [$volunteer, $org] = $this->scenario('approved');
        $date = now()->subDays(2)->toDateString();

        $report = $this->raceLogHours($volunteer, $org, $date, function () use ($org): void {
            DB::table('vol_organizations')->where('id', $org)->update(['status' => 'suspended', 'updated_at' => now()]);
            self::assertSame('suspended', (string) DB::table('vol_organizations')->where('id', $org)->value('status'),
                'the suspension must have committed first');
        });

        self::assertTrue($report['reached_barrier'] ?? false, json_encode($report));
        self::assertNull($report['id'] ?? null, 'the log must be refused: ' . json_encode($report));
        self::assertSame('ORG_NOT_ACTIVE', $report['errors'][0]['code'] ?? null, json_encode($report));
        self::assertSame(0.0, $this->balance($volunteer), 'a suspended organisation must not mint');
        self::assertSame(0.0, (float) DB::table('vol_organizations')->where('id', $org)->value('balance'), 'its wallet is untouched');
        self::assertSame(0, DB::table('vol_logs')->where('user_id', $volunteer)->count(), 'no hours are recorded');
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    /** @return array{0:int,1:int} [volunteer, org] */
    private function scenario(string $orgStatus): array
    {
        $owner = $this->makeUser();
        $volunteer = $this->makeUser();
        $org = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner,
            'name' => 'F385 org ' . bin2hex(random_bytes(4)),
            'status' => $orgStatus,
            'balance' => 0.00,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->orgs[] = $org;
        DB::table('org_members')->insert([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $org,
            'org_type' => 'volunteer',
            'user_id' => $volunteer,
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return [$volunteer, $org];
    }

    private function makeUser(): int
    {
        $id = (int) DB::table('users')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'F385 vol fixture',
            'first_name' => 'F385',
            'last_name' => 'Vol',
            'email' => 'f385-vol-' . bin2hex(random_bytes(10)) . '@example.test',
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
        $this->users[] = $id;

        return $id;
    }

    /** @return array{id:int|null,status:string|null,errors:array<mixed>} */
    private function log(int $volunteer, int $org, string $date): array
    {
        TenantContext::setById($this->testTenantId);
        Cache::forget('volunteering_config:' . $this->testTenantId);
        $id = VolunteerService::logHours($volunteer, [
            'organization_id' => $org,
            'date' => $date,
            'hours' => 3,
            'description' => 'F385 hours',
        ]);

        return ['id' => $id, 'status' => VolunteerService::getLastLogStatus(), 'errors' => VolunteerService::getErrors()];
    }

    private function balance(int $userId): float
    {
        return (float) DB::table('users')->where('id', $userId)->value('balance');
    }

    private function requireForking(): void
    {
        foreach (['pcntl_fork', 'pcntl_waitpid', 'stream_socket_pair', 'posix_kill'] as $function) {
            if (! function_exists($function)) {
                self::markTestSkipped("{$function} is required for F-385 concurrency verification.");
            }
        }
        self::assertStringStartsWith('nexus_test', DB::connection()->getDatabaseName());
        self::assertSame('mysql', DB::connection()->getDriverName());
    }

    /**
     * Fork a child that runs one logHours() and parks immediately before its
     * first `FOR UPDATE`. While it is parked the parent runs $whileParked (on
     * its own connection, really committed), then releases the child.
     *
     * @param  callable():void  $whileParked
     * @return array<string,mixed>
     */
    private function raceLogHours(int $volunteer, int $org, string $date, callable $whileParked): array
    {
        $tenantId = $this->testTenantId;
        $sockets = stream_socket_pair(STREAM_PF_UNIX, STREAM_SOCK_STREAM, STREAM_IPPROTO_IP);
        self::assertNotFalse($sockets);

        DB::purge();
        $pid = pcntl_fork();
        self::assertNotSame(-1, $pid);

        if ($pid === 0) {
            fclose($sockets[0]);
            stream_set_timeout($sockets[1], 30);
            $child = $sockets[1];
            try {
                DB::reconnect();
                DB::statement('SET SESSION innodb_lock_wait_timeout = 10');
                TenantContext::reset();
                TenantContext::setById($tenantId);

                $waiting = true;
                DB::connection()->beforeExecuting(function ($query) use ($child, &$waiting): void {
                    if (! $waiting || ! str_contains(strtolower($query), 'for update')) {
                        return;
                    }
                    $waiting = false;
                    fwrite($child, "ready\n");
                    if (trim((string) fgets($child)) !== 'go') {
                        throw new \RuntimeException('F385 barrier timed out');
                    }
                });

                $result = $this->log($volunteer, $org, $date);
                $result['reached_barrier'] = $waiting === false;
                fwrite($child, json_encode($result, JSON_THROW_ON_ERROR) . "\n");
                fclose($child);
                exit(0);
            } catch (\Throwable $error) {
                fwrite($child, json_encode(['error' => get_class($error) . ': ' . $error->getMessage()]) . "\n");
                fclose($child);
                exit(1);
            }
        }

        fclose($sockets[1]);
        $parent = $sockets[0];
        stream_set_timeout($parent, 30);

        $report = [];
        try {
            $line = trim((string) fgets($parent));
            self::assertSame('ready', $line, "child did not reach the barrier: {$line}");

            DB::reconnect();
            TenantContext::reset();
            TenantContext::setById($tenantId);

            $whileParked();

            fwrite($parent, "go\n");
            $raw = (string) fgets($parent);
            $decoded = json_decode($raw, true);
            self::assertIsArray($decoded, "child returned no parsable result: {$raw}");
            self::assertArrayNotHasKey('error', $decoded, 'child errored: ' . $raw);
            $report = $decoded;
        } finally {
            if (pcntl_waitpid($pid, $waitStatus, WNOHANG) === 0) {
                posix_kill($pid, 9);
                pcntl_waitpid($pid, $waitStatus);
            }
            if (is_resource($parent)) {
                fclose($parent);
            }
            DB::purge();
            DB::reconnect();
            TenantContext::reset();
            TenantContext::setById($this->testTenantId);
        }

        return $report;
    }
}
