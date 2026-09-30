<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E065;

use App\Core\TenantContext;
use App\Services\SubAccountService;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * E-065 F-342 — a carer must not keep spending the supported member's time
 * credits after the member has revoked them.
 *
 * Before the fix, SubAccountService::transferForChild() read the carer's
 * `credits` authority with hasPermission() — an UNLOCKED read of
 * `account_relationships` taken OUTSIDE the money transaction — and
 * WalletService::transfer() locked only the two `users` rows and re-checked
 * only the balance. revoke() locks neither `users` row, so the two operations
 * never serialised: a revoke that committed first still let the in-flight
 * proxy transfer debit the member.
 *
 * The fix re-reads the relationship row FOR UPDATE inside the money
 * transaction, after the two `users` locks, and refuses unless it is still
 * `active`. Lock order is users (ascending id) -> account_relationships, which
 * is the order F-343 (users -> vol_organizations) and F-344
 * (users -> federation_partnerships) took in the same engagement.
 *
 * Rig reused verbatim from E-065 slice I: a real pcntl_fork() child on its own
 * database connection, parked at a stream_socket_pair barrier installed with
 * Connection::beforeExecuting() immediately before the first
 * `SELECT ... FOR UPDATE` on `users` — i.e. after hasPermission() has already
 * answered but before any balance moves. No DatabaseTransactions: cross-process
 * work must really commit. Fixtures are removed in tearDown().
 */
final class F342ProxyTransferRevokeRecheckTest extends TestCase
{
    /** @var list<int> */
    private array $createdUsers = [];

    /** @var list<int> */
    private array $createdRelationships = [];

    protected function tearDown(): void
    {
        DB::purge();
        DB::reconnect();

        if ($this->createdRelationships !== []) {
            DB::table('account_relationships')->whereIn('id', $this->createdRelationships)->delete();
            $this->createdRelationships = [];
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

    private function makeUser(float $balance): int
    {
        $id = (int) DB::table('users')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'E065 F-342 fixture',
            'email' => 'e065-f342-' . bin2hex(random_bytes(10)) . '@example.test',
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

    /** An ACTIVE carer relationship with the `credits` capability granted. */
    private function makeRelationship(int $carerId, int $memberId): int
    {
        $id = (int) DB::table('account_relationships')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'parent_user_id' => $carerId,
            'child_user_id' => $memberId,
            'relationship_type' => 'carer',
            'permissions' => json_encode([
                'can_view_activity' => true,
                'can_manage_listings' => false,
                'can_transact' => true,
            ], JSON_THROW_ON_ERROR),
            'status' => 'active',
            'proposed_by_user_id' => null,
            'approved_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->createdRelationships[] = $id;

        return $id;
    }

    private function requireForking(): void
    {
        foreach (['pcntl_fork', 'pcntl_waitpid', 'stream_socket_pair', 'posix_kill'] as $function) {
            if (! function_exists($function)) {
                self::markTestSkipped("{$function} is required for F-342 concurrency verification.");
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

    private function relationshipStatus(int $relationshipId): string
    {
        return (string) DB::table('account_relationships')->where('id', $relationshipId)->value('status');
    }

    /* =====================================================================
     * CONTROL A — the legitimate path. A carer who holds the credits
     * capability spends the supported member's credits with nobody racing it.
     * This must keep working; the attack variant below differs ONLY in that
     * the member revokes inside the window.
     * ================================================================== */
    public function test_control_carer_with_permission_transfers_uncontested(): void
    {
        $this->requireForking();

        $memberId = $this->makeUser(10.0);
        $carerId = $this->makeUser(0.0);
        $payeeId = $this->makeUser(0.0);
        $this->makeRelationship($carerId, $memberId);

        TenantContext::setById($this->testTenantId);
        $service = app(SubAccountService::class);
        $result = $service->transferForChild($carerId, $memberId, [
            'recipient' => $payeeId,
            'amount' => 4.0,
            'description' => 'E065 F-342 control',
        ]);

        self::assertIsArray($result, 'control: the proxy transfer should succeed: ' . json_encode($service->getErrors()));
        self::assertSame(6.0, $this->balance($memberId), 'control: member debited 4');
        self::assertSame(4.0, $this->balance($payeeId), 'control: payee credited 4');
    }

    /* =====================================================================
     * CONTROL B — the guard works when it is not raced. The member revokes
     * BEFORE the carer starts, and the same call is refused with no money
     * moved. This proves the revoke is the property under test.
     * ================================================================== */
    public function test_control_revoked_carer_is_refused_when_not_raced(): void
    {
        $this->requireForking();

        $memberId = $this->makeUser(10.0);
        $carerId = $this->makeUser(0.0);
        $payeeId = $this->makeUser(0.0);
        $relationshipId = $this->makeRelationship($carerId, $memberId);

        TenantContext::setById($this->testTenantId);
        $service = app(SubAccountService::class);

        self::assertTrue($service->revoke($relationshipId, $memberId), 'the member must be able to revoke');
        self::assertSame('revoked', $this->relationshipStatus($relationshipId));

        $result = $service->transferForChild($carerId, $memberId, [
            'recipient' => $payeeId,
            'amount' => 4.0,
            'description' => 'E065 F-342 refused',
        ]);

        self::assertNull($result, 'control: a revoked carer must be refused');
        self::assertSame(10.0, $this->balance($memberId), 'control: no credits moved');
        self::assertSame(0.0, $this->balance($payeeId), 'control: no credits moved');
    }

    /* =====================================================================
     * THE RACE — the member revokes in the window between
     * SubAccountService::hasPermission()'s unlocked read and
     * WalletService::transfer()'s `SELECT ... FOR UPDATE` on the two users
     * rows. The revoke is asserted COMMITTED before the child is released.
     * ================================================================== */
    public function test_a_revoke_that_commits_first_stops_the_in_flight_proxy_transfer(): void
    {
        $this->requireForking();

        $memberId = $this->makeUser(10.0);
        $carerId = $this->makeUser(0.0);
        $payeeId = $this->makeUser(0.0);
        $relationshipId = $this->makeRelationship($carerId, $memberId);

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

                // Park immediately before the money transaction's first row lock.
                // hasPermission() has already answered by this point.
                $waiting = true;
                DB::connection()->beforeExecuting(function ($query) use ($child, &$waiting): void {
                    if (! $waiting) {
                        return;
                    }
                    $q = strtolower($query);
                    if (! str_contains($q, '`users`') || ! str_contains($q, 'for update')) {
                        return;
                    }
                    $waiting = false;
                    fwrite($child, "ready\n");
                    if (trim((string) fgets($child)) !== 'go') {
                        throw new \RuntimeException('F-342 barrier timed out');
                    }
                });

                $service = app(SubAccountService::class);
                $result = $service->transferForChild($carerId, $memberId, [
                    'recipient' => $payeeId,
                    'amount' => 4.0,
                    'description' => 'E065 F-342 race',
                ]);

                fwrite($child, json_encode([
                    'transferred' => is_array($result),
                    'errors' => $service->getErrors(),
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

            // The child now holds an OPEN transaction that has already passed
            // the carer-permission check but has NOT yet taken any row lock.
            // The supported member revokes the relationship, on this
            // connection, and commits.
            DB::reconnect();
            TenantContext::reset();
            TenantContext::setById($tenantId);
            $revoked = app(SubAccountService::class)->revoke($relationshipId, $memberId);
            self::assertTrue($revoked, 'the supported member must be able to revoke their carer');
            self::assertSame('revoked', $this->relationshipStatus($relationshipId), 'the revoke must have committed first');

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

        $memberBalance = $this->balance($memberId);
        $payeeBalance = $this->balance($payeeId);
        $status = $this->relationshipStatus($relationshipId);

        // The bad outcome: the revoke committed first and the carer still spent
        // the member's credits.
        self::assertFalse(
            $status === 'revoked' && $memberBalance === 6.0 && $payeeBalance === 4.0,
            "BAD OUTCOME: relationship #{$relationshipId} status='{$status}' (revoked BEFORE the money moved) "
            . "yet 4.00 credits left the supported member (member {$memberBalance}, payee {$payeeBalance}); "
            . 'child reported ' . json_encode($childReport),
        );

        // And the good outcome, stated positively: nothing moved at all.
        self::assertSame('revoked', $status, 'the revoke must have committed before the child was released');
        self::assertSame(10.0, $memberBalance, 'the supported member must still hold every credit');
        self::assertSame(0.0, $payeeBalance, 'the carer-chosen payee must have received nothing');
        self::assertFalse(
            (bool) ($childReport['transferred'] ?? false),
            'the in-flight proxy transfer must have been refused: ' . json_encode($childReport),
        );
    }
}
