<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E065;

use App\Core\TenantContext;
use App\Services\ExchangeWorkflowService;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-340 (E-065 slice E) — credits must not move on an exchange a party
 * cancelled while a broker was resolving its dispute.
 *
 * ExchangeWorkflowService::completeExchange() read the exchange status
 * UNLOCKED, and the locking re-read inside the money transaction rejected only
 * STATUS_COMPLETED. A row that became `cancelled` in that window passed the
 * re-read, createTransaction() moved the credits, and updateStatus() then
 * correctly refused the illegal `cancelled -> completed` transition — a refusal
 * the caller discarded, so resolveDispute() reported success. Because
 * reverseCompletedExchange() refuses anything that is not `completed`, the
 * platform's own correction tool could not undo the movement.
 *
 * Adapted from the E-065 reproduction
 * `.local-docs-archive/security-log/E-065/repro/slice-e/DisputeResolutionRacesCancelTest.php`,
 * which FAILS while the bug exists (its failure message begins "BAD OUTCOME:").
 * That polarity is kept unchanged; positive assertions about the fixed
 * behaviour are added after it.
 *
 * Rig reused, not invented: one real pcntl_fork() child on its own database
 * connection and its own committed transaction, parked at a
 * stream_socket_pair barrier installed with Connection::beforeExecuting()
 * immediately before completeExchange()'s `SELECT ... FOR UPDATE` on
 * exchange_requests. The parent asserts the child reached the barrier, so the
 * interleave is proved rather than hoped for.
 *
 * No DatabaseTransactions: cross-process work must really commit. Fixtures are
 * removed in tearDown().
 */
final class F340ExchangeCompletionStatusRecheckTest extends TestCase
{
    /** @var list<int> */
    private array $createdUsers = [];

    /** @var list<int> */
    private array $createdExchanges = [];

    /** @var list<int> */
    private array $createdListings = [];

    protected function tearDown(): void
    {
        DB::purge();
        DB::reconnect();

        if ($this->createdExchanges !== []) {
            DB::table('exchange_history')->whereIn('exchange_id', $this->createdExchanges)->delete();
            DB::table('exchange_requests')->whereIn('id', $this->createdExchanges)->delete();
            $this->createdExchanges = [];
        }
        if ($this->createdListings !== []) {
            DB::table('listings')->whereIn('id', $this->createdListings)->delete();
            $this->createdListings = [];
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

    private function makeUser(float $balance, string $role = 'member', bool $admin = false): int
    {
        $id = (int) DB::table('users')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'F340 fixture',
            'email' => 'f340-' . bin2hex(random_bytes(10)) . '@example.test',
            'password_hash' => password_hash(bin2hex(random_bytes(16)), PASSWORD_BCRYPT),
            'balance' => $balance,
            'role' => $role,
            'is_admin' => $admin ? 1 : 0,
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

    private function makeListing(int $ownerId): int
    {
        $id = (int) DB::table('listings')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'title' => 'F340 listing',
            'type' => 'offer',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->createdListings[] = $id;

        return $id;
    }

    private function makeDisputedExchange(int $requesterId, int $providerId, int $listingId): int
    {
        $id = (int) DB::table('exchange_requests')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'listing_id' => $listingId,
            'requester_id' => $requesterId,
            'provider_id' => $providerId,
            'proposed_hours' => 4.00,
            'status' => 'disputed',
            'requester_confirmed_at' => now(),
            'requester_confirmed_hours' => 3.00,
            'provider_confirmed_at' => now(),
            'provider_confirmed_hours' => 5.00,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->createdExchanges[] = $id;

        return $id;
    }

    private function requireForking(): void
    {
        foreach (['pcntl_fork', 'pcntl_waitpid', 'stream_socket_pair', 'posix_kill'] as $function) {
            if (! function_exists($function)) {
                self::markTestSkipped("{$function} is required for F-340 concurrency verification.");
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

    private function exchangeStatus(int $exchangeId): string
    {
        return (string) DB::table('exchange_requests')->where('id', $exchangeId)->value('status');
    }

    /* =====================================================================
     * CONTROL — the legitimate path. A broker resolves a disputed exchange
     * with nobody racing it. Credits move AND the exchange reaches
     * 'completed'. The regression below differs only in that a party cancels
     * inside the window.
     * ================================================================== */
    public function test_control_broker_resolves_a_dispute_uncontested(): void
    {
        $this->requireForking();

        $requesterId = $this->makeUser(10.0);
        $providerId = $this->makeUser(0.0);
        $adminId = $this->makeUser(0.0, 'admin', true);
        $listingId = $this->makeListing($providerId);
        $exchangeId = $this->makeDisputedExchange($requesterId, $providerId, $listingId);

        TenantContext::setById($this->testTenantId);
        $result = ExchangeWorkflowService::resolveDispute($exchangeId, $adminId, 4.0, 'F340 control');

        self::assertTrue($result['ok'] ?? false, 'control: resolveDispute should succeed: ' . json_encode($result));
        self::assertSame('completed', $this->exchangeStatus($exchangeId), 'control: exchange must end completed');
        self::assertSame(6.0, $this->balance($requesterId), 'control: payer debited 4');
        self::assertSame(4.0, $this->balance($providerId), 'control: payee credited 4');
    }

    /* =====================================================================
     * REGRESSION — the same resolution, but the requester cancels the
     * exchange in the window between completeExchange()'s unlocked status
     * guard and its locking re-read.
     * ================================================================== */
    public function test_credits_do_not_move_on_an_exchange_cancelled_mid_resolution(): void
    {
        $this->requireForking();

        $requesterId = $this->makeUser(10.0);
        $providerId = $this->makeUser(0.0);
        $adminId = $this->makeUser(0.0, 'admin', true);
        $listingId = $this->makeListing($providerId);
        $exchangeId = $this->makeDisputedExchange($requesterId, $providerId, $listingId);

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

                // Park immediately before completeExchange()'s locking re-read.
                $waiting = true;
                DB::connection()->beforeExecuting(function ($query) use ($child, &$waiting): void {
                    if (! $waiting) {
                        return;
                    }
                    $q = strtolower($query);
                    if (! str_contains($q, 'exchange_requests') || ! str_contains($q, 'for update')) {
                        return;
                    }
                    $waiting = false;
                    fwrite($child, "ready\n");
                    if (trim((string) fgets($child)) !== 'go') {
                        throw new \RuntimeException('F340 barrier timed out');
                    }
                });

                $result = ExchangeWorkflowService::resolveDispute($exchangeId, $adminId, 4.0, 'F340 race');

                fwrite($child, json_encode(['outcome' => $result], JSON_THROW_ON_ERROR) . "\n");
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

        $childOutcome = [];

        try {
            $line = trim((string) fgets($parent));
            self::assertSame('ready', $line, "child did not reach the barrier: {$line}");

            // The child now holds an OPEN transaction that has already passed
            // completeExchange()'s unlocked status guard but has NOT yet taken
            // the row lock. The requester cancels, on this connection, and
            // commits.
            DB::reconnect();
            TenantContext::reset();
            TenantContext::setById($tenantId);
            $cancelled = ExchangeWorkflowService::cancelExchange($exchangeId, $requesterId, 'F340 cancel');
            self::assertTrue($cancelled, 'the requester must be able to cancel a disputed exchange');
            self::assertSame('cancelled', $this->exchangeStatus($exchangeId), 'the cancel must have committed first');

            fwrite($parent, "go\n");

            $raw = (string) fgets($parent);
            $decoded = json_decode($raw, true);
            self::assertIsArray($decoded, "child returned no parsable result: {$raw}");
            self::assertArrayNotHasKey('error', $decoded, 'child errored: ' . $raw);
            $childOutcome = $decoded;
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

        $finalStatus = $this->exchangeStatus($exchangeId);
        $payerBalance = $this->balance($requesterId);
        $payeeBalance = $this->balance($providerId);
        $transactionId = DB::table('exchange_requests')->where('id', $exchangeId)->value('transaction_id');

        // The bad outcome: credits moved while the exchange is cancelled.
        self::assertFalse(
            $finalStatus === 'cancelled' && $payerBalance === 6.0 && $payeeBalance === 4.0,
            "BAD OUTCOME: exchange #{$exchangeId} status='{$finalStatus}' but 4.00 credits moved "
            . "(payer {$payerBalance}, payee {$payeeBalance}); transaction_id="
            . var_export($transactionId, true),
        );

        // What must be true instead: the cancel stands, no credits moved, no
        // ledger row was bound to the exchange, and the caller was told the
        // resolution failed rather than being told it succeeded.
        self::assertSame('cancelled', $finalStatus, 'the cancel must stand');
        self::assertSame(10.0, $payerBalance, 'the payer must not be debited');
        self::assertSame(0.0, $payeeBalance, 'the payee must not be credited');
        self::assertNull($transactionId, 'no financial transaction may be bound to a cancelled exchange');
        self::assertFalse(
            $childOutcome['outcome']['ok'] ?? true,
            'resolveDispute must report failure, not success: ' . json_encode($childOutcome),
        );
    }
}
