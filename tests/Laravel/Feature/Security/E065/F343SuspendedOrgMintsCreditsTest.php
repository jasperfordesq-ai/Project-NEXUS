<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E065;

use App\Core\TenantContext;
use App\Services\VolunteerService;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-343 (E-065 slice I) — a volunteering organisation suspended while an
 * approval is in flight must not mint time credits, and an approver who lost
 * their authority over the organisation in the same window must not complete
 * the approval.
 *
 * VolunteerService::verifyHours() enforced the freeze — its own comment reads
 * "Hard-freeze: a suspended (non-approved) org cannot mint new time credits" —
 * on an UNLOCKED `SELECT * FROM vol_organizations`. Inside the minting
 * transaction the organisation row WAS re-read under a lock, but the re-read
 * selected only `id, balance, user_id`: `status` was not in the column list and
 * the approve branch never re-tested it. The org-admin authorisation read was
 * likewise never re-tested. A suspension, or a removal of the approver, that
 * committed inside that window therefore did not stop the mint.
 *
 * Sibling of F-188 in the same file, a different method.
 *
 * Adapted from the E-065 reproduction
 * `.local-docs-archive/security-log/E-065/repro/i/SuspendedOrgMintsCreditsTest.php`,
 * which FAILS while the bug exists ("BAD OUTCOME:"). That polarity is kept; the
 * removed-org-admin arm — source-argued but never driven by E-065 — is added
 * here as a second race.
 *
 * Rig reused, not invented: one real pcntl_fork() child on its own connection,
 * parked at a stream_socket_pair barrier installed with
 * Connection::beforeExecuting() immediately before the first `FOR UPDATE` in
 * verifyHours(), i.e. after every unlocked pre-check has answered. No
 * DatabaseTransactions; fixtures removed in tearDown().
 */
final class F343SuspendedOrgMintsCreditsTest extends TestCase
{
    /** @var list<int> */
    private array $createdUsers = [];

    /** @var list<int> */
    private array $createdOrgs = [];

    /** @var list<int> */
    private array $createdLogs = [];

    protected function tearDown(): void
    {
        DB::purge();
        DB::reconnect();

        if ($this->createdLogs !== []) {
            DB::table('vol_org_transactions')->whereIn('vol_log_id', $this->createdLogs)->delete();
            DB::table('vol_logs')->whereIn('id', $this->createdLogs)->delete();
            $this->createdLogs = [];
        }
        if ($this->createdOrgs !== []) {
            DB::table('vol_org_transactions')->whereIn('vol_organization_id', $this->createdOrgs)->delete();
            DB::table('org_members')->whereIn('organization_id', $this->createdOrgs)->delete();
            DB::table('vol_organizations')->whereIn('id', $this->createdOrgs)->delete();
            $this->createdOrgs = [];
        }
        if ($this->createdUsers !== []) {
            DB::table('transactions')->whereIn('sender_id', $this->createdUsers)->delete();
            DB::table('transactions')->whereIn('receiver_id', $this->createdUsers)->delete();
            DB::table('notifications')->whereIn('user_id', $this->createdUsers)->delete();
            DB::table('user_xp_log')->whereIn('user_id', $this->createdUsers)->delete();
            DB::table('users')->whereIn('id', $this->createdUsers)->delete();
            $this->createdUsers = [];
        }

        parent::tearDown();
    }

    private function makeUser(float $balance = 0.0): int
    {
        $id = (int) DB::table('users')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'F343 vol fixture',
            'email' => 'f343-vol-' . bin2hex(random_bytes(10)) . '@example.test',
            'password_hash' => password_hash(bin2hex(random_bytes(16)), PASSWORD_BCRYPT),
            'balance' => $balance,
            'role' => 'member',
            'status' => 'active',
            'is_active' => true,
            'is_approved' => true,
            'preferred_language' => 'en',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->createdUsers[] = $id;

        return $id;
    }

    private function makeOrg(int $ownerId, string $status = 'approved'): int
    {
        $id = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'name' => 'F343 org ' . bin2hex(random_bytes(4)),
            'status' => $status,
            'balance' => 0.00,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->createdOrgs[] = $id;

        return $id;
    }

    private function makeOrgAdmin(int $orgId, int $userId): void
    {
        DB::table('org_members')->insert([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $orgId,
            'org_type' => 'volunteer',
            'user_id' => $userId,
            'role' => 'admin',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function makeLog(int $volunteerId, int $orgId, float $hours = 3.0): int
    {
        $id = (int) DB::table('vol_logs')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $volunteerId,
            'organization_id' => $orgId,
            'date_logged' => now()->toDateString(),
            'hours' => $hours,
            'description' => 'F343 fixture hours',
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->createdLogs[] = $id;

        return $id;
    }

    private function requireForking(): void
    {
        foreach (['pcntl_fork', 'pcntl_waitpid', 'stream_socket_pair', 'posix_kill'] as $function) {
            if (! function_exists($function)) {
                self::markTestSkipped("{$function} is required for F-343 concurrency verification.");
            }
        }
        // Never against the development database: only a nexus_test* database.
        self::assertStringStartsWith('nexus_test', DB::connection()->getDatabaseName());
        self::assertSame('mysql', DB::connection()->getDriverName());
    }

    private function balance(int $userId): float
    {
        return (float) DB::table('users')->where('id', $userId)->value('balance');
    }

    private function orgStatus(int $orgId): string
    {
        return (string) DB::table('vol_organizations')->where('id', $orgId)->value('status');
    }

    private function paymentRows(int $logId): int
    {
        return (int) DB::table('vol_org_transactions')
            ->where('vol_log_id', $logId)
            ->where('type', 'volunteer_payment')
            ->count();
    }

    private function logStatus(int $logId): string
    {
        return (string) DB::table('vol_logs')->where('id', $logId)->value('status');
    }

    /**
     * Fork a child that runs one verifyHours() approval and parks at the
     * barrier immediately before the first `FOR UPDATE`. While it is parked the
     * parent runs $whileParked (on its own connection, really committed), then
     * releases the child.
     *
     * @param  callable():void  $whileParked
     * @return array<string,mixed> the child's decoded report
     */
    private function raceApproval(int $logId, int $approverId, callable $whileParked): array
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

                // Park immediately before the first row lock inside verifyHours().
                // Every unlocked pre-check has already passed by this point.
                $waiting = true;
                DB::connection()->beforeExecuting(function ($query) use ($child, &$waiting): void {
                    if (! $waiting) {
                        return;
                    }
                    if (! str_contains(strtolower($query), 'for update')) {
                        return;
                    }
                    $waiting = false;
                    fwrite($child, "ready\n");
                    if (trim((string) fgets($child)) !== 'go') {
                        throw new \RuntimeException('F343 barrier timed out');
                    }
                });

                $ok = VolunteerService::verifyHours($logId, $approverId, 'approve');

                fwrite($child, json_encode([
                    'approved' => $ok,
                    'errors' => VolunteerService::getErrors(),
                    'reached_barrier' => $waiting === false,
                ], JSON_THROW_ON_ERROR) . "\n");
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

        $childReport = [];
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
            $childReport = $decoded;
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

        return $childReport;
    }

    /* =====================================================================
     * CONTROL A — the legitimate path: an approved organisation's owner
     * approves logged hours and the volunteer is credited.
     * ================================================================== */
    public function test_control_approved_org_mints_credits(): void
    {
        $this->requireForking();

        $ownerId = $this->makeUser();
        $volunteerId = $this->makeUser(0.0);
        $orgId = $this->makeOrg($ownerId, 'approved');
        $logId = $this->makeLog($volunteerId, $orgId, 3.0);

        TenantContext::setById($this->testTenantId);
        $ok = VolunteerService::verifyHours($logId, $ownerId, 'approve');

        self::assertTrue($ok, 'control: approval should succeed: ' . json_encode(VolunteerService::getErrors()));
        self::assertSame(3.0, $this->balance($volunteerId), 'control: volunteer credited 3');
        self::assertSame(1, $this->paymentRows($logId), 'control: one payment row');
    }

    /* =====================================================================
     * CONTROL B — the same, approved by a non-owner organisation admin held
     * in org_members. This is the path the second race below attacks, so it
     * must keep working.
     * ================================================================== */
    public function test_control_org_admin_mints_credits(): void
    {
        $this->requireForking();

        $ownerId = $this->makeUser();
        $orgAdminId = $this->makeUser();
        $volunteerId = $this->makeUser(0.0);
        $orgId = $this->makeOrg($ownerId, 'approved');
        $this->makeOrgAdmin($orgId, $orgAdminId);
        $logId = $this->makeLog($volunteerId, $orgId, 3.0);

        TenantContext::setById($this->testTenantId);
        $ok = VolunteerService::verifyHours($logId, $orgAdminId, 'approve');

        self::assertTrue($ok, 'control: an org admin may approve: ' . json_encode(VolunteerService::getErrors()));
        self::assertSame(3.0, $this->balance($volunteerId), 'control: volunteer credited 3');
        self::assertSame(1, $this->paymentRows($logId), 'control: one payment row');
    }

    /* =====================================================================
     * CONTROL C — the freeze works when it is not raced: the organisation is
     * already suspended, and the same approval is refused with nothing minted.
     * ================================================================== */
    public function test_control_suspended_org_is_refused_when_not_raced(): void
    {
        $this->requireForking();

        $ownerId = $this->makeUser();
        $volunteerId = $this->makeUser(0.0);
        $orgId = $this->makeOrg($ownerId, 'suspended');
        $logId = $this->makeLog($volunteerId, $orgId, 3.0);

        TenantContext::setById($this->testTenantId);
        $ok = VolunteerService::verifyHours($logId, $ownerId, 'approve');

        self::assertFalse($ok, 'control: a suspended organisation must not mint');
        self::assertSame(0.0, $this->balance($volunteerId), 'control: nothing minted');
        self::assertSame(0, $this->paymentRows($logId), 'control: no payment row');
    }

    /* =====================================================================
     * RACE 1 — the community suspends the organisation in the window between
     * verifyHours()'s unlocked freeze check and the locked organisation
     * re-read, which did not carry `status`.
     * ================================================================== */
    public function test_suspended_organisation_cannot_mint_mid_approval(): void
    {
        $this->requireForking();

        $ownerId = $this->makeUser();
        $volunteerId = $this->makeUser(0.0);
        $orgId = $this->makeOrg($ownerId, 'approved');
        $logId = $this->makeLog($volunteerId, $orgId, 3.0);

        $childReport = $this->raceApproval($logId, $ownerId, function () use ($orgId): void {
            DB::table('vol_organizations')
                ->where('id', $orgId)
                ->update(['status' => 'suspended', 'updated_at' => now()]);
            self::assertSame('suspended', $this->orgStatus($orgId), 'the suspension must have committed first');
        });

        $volunteerBalance = $this->balance($volunteerId);
        $status = $this->orgStatus($orgId);
        $payments = $this->paymentRows($logId);

        self::assertFalse(
            $status === 'suspended' && $volunteerBalance === 3.0 && $payments === 1,
            "BAD OUTCOME: organisation #{$orgId} status='{$status}' (suspended BEFORE any credit moved) "
            . "yet it minted 3.00 time credits (volunteer balance {$volunteerBalance}, payment rows {$payments}); "
            . 'child reported ' . json_encode($childReport),
        );

        self::assertSame(0.0, $volunteerBalance, 'nothing may be minted by a suspended organisation');
        self::assertSame(0, $payments, 'no payment row may be written');
        self::assertFalse($childReport['approved'] ?? true, 'the approval must be reported as refused');
        self::assertSame('pending', $this->logStatus($logId), 'the hours must be left pending, not approved');
    }

    /* =====================================================================
     * RACE 2 — the organisation removes the approver's admin rights in the
     * same window. E-065 argued this arm from source and never drove it; this
     * drives it.
     * ================================================================== */
    public function test_removed_org_admin_cannot_complete_an_approval(): void
    {
        $this->requireForking();

        $ownerId = $this->makeUser();
        $orgAdminId = $this->makeUser();
        $volunteerId = $this->makeUser(0.0);
        $orgId = $this->makeOrg($ownerId, 'approved');
        $this->makeOrgAdmin($orgId, $orgAdminId);
        $logId = $this->makeLog($volunteerId, $orgId, 3.0);

        $childReport = $this->raceApproval($logId, $orgAdminId, function () use ($orgId, $orgAdminId): void {
            DB::table('org_members')
                ->where('organization_id', $orgId)
                ->where('org_type', 'volunteer')
                ->where('user_id', $orgAdminId)
                ->update(['status' => 'removed', 'updated_at' => now()]);

            self::assertSame(
                0,
                (int) DB::table('org_members')
                    ->where('organization_id', $orgId)
                    ->where('org_type', 'volunteer')
                    ->where('user_id', $orgAdminId)
                    ->where('status', 'active')
                    ->count(),
                'the removal must have committed first',
            );
        });

        $volunteerBalance = $this->balance($volunteerId);
        $payments = $this->paymentRows($logId);

        self::assertFalse(
            $volunteerBalance === 3.0 && $payments === 1,
            "BAD OUTCOME: the approver's organisation admin rights were removed BEFORE any credit moved, "
            . "yet the approval still minted 3.00 time credits (volunteer balance {$volunteerBalance}, "
            . "payment rows {$payments}); child reported " . json_encode($childReport),
        );

        self::assertSame(0.0, $volunteerBalance, 'a removed organisation admin may not mint');
        self::assertSame(0, $payments, 'no payment row may be written');
        self::assertFalse($childReport['approved'] ?? true, 'the approval must be reported as refused');
        self::assertSame('pending', $this->logStatus($logId), 'the hours must be left pending, not approved');
    }
}
