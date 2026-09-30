<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E065\Concerns;

use App\Core\TenantContext;
use App\Http\Controllers\Api\FederationV2Controller;
use App\Models\User;
use App\Services\FederationFeatureService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Concerns\FederationIntegrationHarness;

/**
 * Shared fixture and concurrency rig for the E-065 federated-transfer
 * regressions (F-344 and F-376), both of which live in the same method,
 * FederationV2Controller::sendTransaction().
 *
 * Lifted from the E-065 slice-M reproduction
 * `.local-docs-archive/security-log/E-065/repro/m/FederatedTransferConcurrencyTest.php`
 * so both regressions drive the real path exactly as the reviewer did.
 *
 * The rig is a real pcntl_fork() child on its own database connection and its
 * own committed transaction, parked at a stream_socket_pair barrier installed
 * with Connection::beforeExecuting() immediately before sendTransaction()'s
 * FIRST locking read on `users` — i.e. after every unlocked pre-check has
 * answered and before any balance moves. The parent asserts the child reached
 * the barrier, so each interleave is proved rather than hoped for.
 *
 * No DatabaseTransactions: cross-process work must really commit. Every
 * fixture, including the federation_system_control singleton, is restored in
 * tearDown().
 */
trait RacesFederatedTransfer
{
    use FederationIntegrationHarness;

    /** @var list<int> */
    private array $racedUsers = [];

    /** @var list<int> */
    private array $racedTenants = [];

    /** @var array<string,mixed>|null */
    private ?array $systemControlSnapshot = null;

    protected int $sourceTenantId = 0;

    protected int $destTenantId = 0;

    protected function setUpFederatedTransferFixture(): void
    {
        $existing = DB::table('federation_system_control')->where('id', 1)->first();
        $this->systemControlSnapshot = $existing ? (array) $existing : null;

        $this->sourceTenantId = $this->makeFederatedTenant('E065 Source');
        $this->destTenantId = $this->makeFederatedTenant('E065 Partner');

        $this->enableFederationForTenant($this->sourceTenantId);
        $this->enableFederationForTenant($this->destTenantId);

        DB::table('federation_partnerships')->updateOrInsert(
            ['tenant_id' => $this->sourceTenantId, 'partner_tenant_id' => $this->destTenantId],
            [
                'status' => 'active',
                'federation_level' => 4,
                'profiles_enabled' => 1,
                'messaging_enabled' => 1,
                'transactions_enabled' => 1,
                'requested_at' => now(),
                'approved_at' => now(),
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );

        app(FederationFeatureService::class)->clearCache();
        TenantContext::setById($this->sourceTenantId);
    }

    protected function tearDownFederatedTransferFixture(): void
    {
        DB::purge();
        DB::reconnect();

        if ($this->racedUsers !== []) {
            DB::table('transactions')->whereIn('sender_id', $this->racedUsers)->delete();
            DB::table('transactions')->whereIn('receiver_id', $this->racedUsers)->delete();
            DB::table('notifications')->whereIn('user_id', $this->racedUsers)->delete();
            DB::table('federation_user_settings')->whereIn('user_id', $this->racedUsers)->delete();
            DB::table('users')->whereIn('id', $this->racedUsers)->delete();
            $this->racedUsers = [];
        }

        if ($this->racedTenants !== []) {
            DB::table('federation_partnerships')->whereIn('tenant_id', $this->racedTenants)->delete();
            DB::table('federation_partnerships')->whereIn('partner_tenant_id', $this->racedTenants)->delete();
            DB::table('federation_tenant_whitelist')->whereIn('tenant_id', $this->racedTenants)->delete();
            DB::table('federation_tenant_features')->whereIn('tenant_id', $this->racedTenants)->delete();
            DB::table('federation_audit_log')->whereIn('source_tenant_id', $this->racedTenants)->delete();
            DB::table('tenants')->whereIn('id', $this->racedTenants)->delete();
            $this->racedTenants = [];
        }

        if ($this->systemControlSnapshot !== null) {
            DB::table('federation_system_control')->where('id', 1)->update($this->systemControlSnapshot);
        }
    }

    protected function requireForking(): void
    {
        foreach (['pcntl_fork', 'pcntl_waitpid', 'stream_socket_pair', 'posix_kill'] as $function) {
            if (! function_exists($function)) {
                self::markTestSkipped("{$function} is required for federated-transfer concurrency verification.");
            }
        }
        // Never against the development database: only a nexus_test* database.
        self::assertStringStartsWith('nexus_test', DB::connection()->getDatabaseName());
        self::assertSame('mysql', DB::connection()->getDriverName());
    }

    protected function makeFederatedTenant(string $name): int
    {
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => $name,
            'slug' => 'e065fed-' . bin2hex(random_bytes(6)),
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->racedTenants[] = $id;

        return $id;
    }

    protected function makeFederatedUser(int $tenantId, int $balance): int
    {
        $userId = (int) DB::table('users')->insertGetId([
            'tenant_id' => $tenantId,
            'first_name' => 'E065Fed',
            'last_name' => 'Fixture',
            'email' => 'e065fed.' . bin2hex(random_bytes(10)) . '@example.test',
            'username' => 'e065fed_' . substr(bin2hex(random_bytes(8)), 0, 12),
            'password' => password_hash(bin2hex(random_bytes(16)), PASSWORD_BCRYPT),
            'balance' => $balance,
            'status' => 'active',
            'is_approved' => true,
            'preferred_language' => 'en',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->racedUsers[] = $userId;
        $this->optInUserToFederation($userId);

        return $userId;
    }

    protected function balance(int $userId): int
    {
        return (int) DB::table('users')->where('id', $userId)->value('balance');
    }

    protected function federatedRowCount(int $senderId): int
    {
        return (int) DB::table('transactions')
            ->where('sender_id', $senderId)
            ->where('is_federated', 1)
            ->count();
    }

    /**
     * Invoke sendTransaction() with a bound JSON request and the sender
     * authenticated. Mirrors tests/Laravel/Feature/Federation/
     * FederationV2InternalTransferTest::callSendTransaction().
     */
    protected function callSendTransaction(
        int $senderId,
        int $receiverId,
        int $receiverTenantId,
        int $amount,
        string $description,
        ?string $idempotencyKey = null
    ): JsonResponse {
        TenantContext::setById($this->sourceTenantId);
        $sender = User::query()->find($senderId);
        self::assertNotNull($sender, 'sender fixture must exist');
        $this->actingAs($sender);

        $this->app->instance('request', Request::create(
            '/api/v2/federation/transactions',
            'POST',
            [],
            [],
            [],
            ['CONTENT_TYPE' => 'application/json'],
            json_encode([
                'receiver_id' => $receiverId,
                'receiver_tenant_id' => $receiverTenantId,
                'amount' => $amount,
                'description' => $description,
                'idempotency_key' => $idempotencyKey,
            ], JSON_THROW_ON_ERROR)
        ));

        TenantContext::setById($this->sourceTenantId);

        return $this->app->make(FederationV2Controller::class)->sendTransaction();
    }

    /**
     * Fork a child that runs one sendTransaction() and parks at the barrier
     * immediately before the first `SELECT ... FOR UPDATE` on `users`. While it
     * is parked the parent runs $whileParked (on its own connection, really
     * committed), then releases the child.
     *
     * @param  callable():void  $whileParked
     * @return array<string,mixed> the child's decoded report
     */
    protected function raceAgainst(
        int $senderId,
        int $receiverId,
        int $receiverTenantId,
        int $amount,
        string $description,
        ?string $idempotencyKey,
        callable $whileParked
    ): array {
        $sockets = stream_socket_pair(STREAM_PF_UNIX, STREAM_SOCK_STREAM, STREAM_IPPROTO_IP);
        self::assertNotFalse($sockets);

        DB::purge();

        $pid = pcntl_fork();
        self::assertNotSame(-1, $pid);

        if ($pid === 0) {
            fclose($sockets[0]);
            stream_set_timeout($sockets[1], 60);
            $child = $sockets[1];
            try {
                DB::reconnect();
                DB::statement('SET SESSION innodb_lock_wait_timeout = 20');
                TenantContext::reset();
                TenantContext::setById($this->sourceTenantId);

                $waiting = true;
                DB::connection()->beforeExecuting(function ($query) use ($child, &$waiting): void {
                    if (! $waiting) {
                        return;
                    }
                    $q = strtolower($query);
                    // sendTransaction()'s first locking read, taken AFTER every
                    // unlocked pre-check and BEFORE any balance moves.
                    if (! str_contains($q, '`users`') || ! str_contains($q, 'for update')) {
                        return;
                    }
                    $waiting = false;
                    fwrite($child, "ready\n");
                    if (trim((string) fgets($child)) !== 'go') {
                        throw new \RuntimeException('federated transfer barrier timed out');
                    }
                });

                $response = $this->callSendTransaction(
                    $senderId,
                    $receiverId,
                    $receiverTenantId,
                    $amount,
                    $description,
                    $idempotencyKey
                );

                fwrite($child, json_encode([
                    'status' => $response->getStatusCode(),
                    'body' => (string) $response->getContent(),
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
        stream_set_timeout($parent, 60);

        $report = [];
        try {
            $line = trim((string) fgets($parent));
            self::assertSame('ready', $line, "child did not reach the barrier: {$line}");

            DB::reconnect();
            TenantContext::reset();
            TenantContext::setById($this->sourceTenantId);

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
            TenantContext::setById($this->sourceTenantId);
            app(FederationFeatureService::class)->clearCache();
        }

        return $report;
    }
}
