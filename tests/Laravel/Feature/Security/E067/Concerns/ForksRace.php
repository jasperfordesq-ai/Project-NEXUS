<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E067\Concerns;

use App\Core\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * A real two-process race for E-067's regression tests.
 *
 * A pcntl_fork() child on its OWN database connection runs $childOp and parks
 * at a stream_socket_pair barrier the first time a query matching $barrier is
 * about to execute (Connection::beforeExecuting). While it is parked the parent
 * reconnects (its own connection, really committed) and runs $whileParked; then
 * the child is released and reports back.
 *
 * The rig E-065 slice M / F-343 built and E-067 slice E generalised
 * (`.local-docs-archive/security-log/E-067/repro/e/ForkRaceHarness.php`).
 * Tests using it must NOT use DatabaseTransactions — cross-process work has to
 * commit — and must remove their fixtures in tearDown().
 */
trait ForksRace
{
    private function requireForking(): void
    {
        foreach (['pcntl_fork', 'pcntl_waitpid', 'stream_socket_pair', 'posix_kill'] as $function) {
            if (! function_exists($function)) {
                self::markTestSkipped("{$function} is required for this concurrency test.");
            }
        }
        // Never against the development database: only a nexus_test* database.
        self::assertStringStartsWith('nexus_test', DB::connection()->getDatabaseName());
        self::assertSame('mysql', DB::connection()->getDriverName());
    }

    /**
     * @param  callable():array<string,mixed>  $childOp      runs in the child; returns a JSON-able report
     * @param  callable(string):bool            $barrier      lower-cased SQL => park here?
     * @param  callable():void                  $whileParked  runs in the parent while the child is parked
     * @return array<string,mixed> the child's decoded report (plus reached_barrier)
     */
    private function forkRace(int $tenantId, callable $childOp, callable $barrier, callable $whileParked, int $parentLockWait = 20): array
    {
        $sockets = stream_socket_pair(STREAM_PF_UNIX, STREAM_SOCK_STREAM, STREAM_IPPROTO_IP);
        self::assertNotFalse($sockets);

        DB::purge();

        $pid = pcntl_fork();
        self::assertNotSame(-1, $pid);

        if ($pid === 0) {
            fclose($sockets[0]);
            stream_set_timeout($sockets[1], 60);
            $child = $sockets[1];
            $waiting = true;
            try {
                DB::reconnect();
                DB::statement('SET SESSION innodb_lock_wait_timeout = 30');
                TenantContext::reset();
                TenantContext::setById($tenantId);

                DB::connection()->beforeExecuting(function ($query) use ($child, &$waiting, $barrier): void {
                    if (! $waiting || ! $barrier(strtolower((string) $query))) {
                        return;
                    }
                    $waiting = false;
                    fwrite($child, "ready\n");
                    if (trim((string) fgets($child)) !== 'go') {
                        throw new \RuntimeException('race barrier timed out');
                    }
                });

                $report = $childOp();
                $report['reached_barrier'] = $waiting === false;
                fwrite($child, json_encode($report, JSON_THROW_ON_ERROR | JSON_PARTIAL_OUTPUT_ON_ERROR) . "\n");
                fclose($child);
                exit(0);
            } catch (\Throwable $error) {
                fwrite($child, json_encode([
                    'error' => get_class($error) . ': ' . $error->getMessage(),
                    'reached_barrier' => $waiting === false,
                ]) . "\n");
                fclose($child);
                exit(1);
            }
        }

        fclose($sockets[1]);
        $parent = $sockets[0];
        stream_set_timeout($parent, 90);

        $report = [];
        try {
            $line = trim((string) fgets($parent));
            if ($line !== 'ready') {
                self::fail('child did not reach the barrier: ' . $line);
            }

            DB::reconnect();
            DB::statement('SET SESSION innodb_lock_wait_timeout = ' . max(1, $parentLockWait));
            TenantContext::reset();
            TenantContext::setById($tenantId);

            try {
                $whileParked();
            } finally {
                fwrite($parent, "go\n");
            }

            $raw = (string) fgets($parent);
            $decoded = json_decode($raw, true);
            self::assertIsArray($decoded, "child returned no parsable result: {$raw}");
            $report = $decoded;
        } finally {
            if (pcntl_waitpid($pid, $waitStatus, WNOHANG) === 0) {
                usleep(300000);
                if (pcntl_waitpid($pid, $waitStatus, WNOHANG) === 0) {
                    posix_kill($pid, 9);
                    pcntl_waitpid($pid, $waitStatus);
                }
            }
            if (is_resource($parent)) {
                fclose($parent);
            }
            DB::purge();
            DB::reconnect();
            TenantContext::reset();
            TenantContext::setById($tenantId);
        }

        return $report;
    }
}
