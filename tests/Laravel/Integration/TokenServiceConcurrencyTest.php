<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Integration;

use App\Core\TenantContext;
use App\Services\TokenService;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Tests\Laravel\TestCase;
use Throwable;

/** Real independent MySQL connections prove token revocation serialization. */
final class TokenServiceConcurrencyTest extends TestCase
{
    private ?int $fixtureTenantId = null;
    private ?int $fixtureUserId = null;

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'mysql') {
            self::markTestSkipped('MySQL/MariaDB is required for refresh-token lock tests.');
        }

        foreach (['pcntl_fork', 'pcntl_waitpid', 'stream_socket_pair', 'posix_kill'] as $function) {
            if (!function_exists($function)) {
                self::markTestSkipped("{$function} is required for refresh-token lock tests.");
            }
        }
    }

    protected function tearDown(): void
    {
        try {
            DB::purge();
            DB::reconnect();

            if ($this->fixtureUserId !== null) {
                foreach (['user_totp_settings', 'user_backup_codes', 'totp_verification_attempts'] as $table) {
                    DB::table($table)->where('user_id', $this->fixtureUserId)->where('tenant_id', $this->fixtureTenantId)->delete();
                }
                DB::table('refresh_token_sessions')
                    ->where('user_id', $this->fixtureUserId)
                    ->delete();
                DB::table('revoked_tokens')
                    ->where('user_id', $this->fixtureUserId)
                    ->delete();
                DB::table('users')
                    ->where('id', $this->fixtureUserId)
                    ->delete();
            }
            if ($this->fixtureTenantId !== null) {
                DB::table('tenants')
                    ->where('id', $this->fixtureTenantId)
                    ->delete();
            }

            TenantContext::reset();
            TenantContext::setById($this->testTenantId);
        } finally {
            parent::tearDown();
        }
    }

    public function test_security_confirmation_recheck_sees_revocation_committed_after_transaction_snapshot(): void
    {
        [$tenantId, $userId] = $this->createCommittedFixture();
        $service = new TokenService();
        $access = $service->generateToken($userId, $tenantId);
        $confirmation = $service->generateSecurityConfirmationToken(
            $userId,
            $tenantId,
            'password'
        );
        $payload = $this->decodeJwt($confirmation);

        $defaultConnection = DB::getDefaultConnection();
        $revocationConnection = 'token_revocation_probe';
        config([
            "database.connections.{$revocationConnection}" => config(
                "database.connections.{$defaultConnection}"
            ),
        ]);

        $registration = DB::connection($defaultConnection);
        $revoker = DB::connection($revocationConnection);
        $registration->beginTransaction();

        try {
            // Establish a REPEATABLE READ snapshot before the independent
            // revocation commits, matching registerVerify's routing reads.
            self::assertSame(
                $tenantId,
                (int) $registration->table('tenants')
                    ->where('id', $tenantId)
                    ->value('id')
            );

            $revoker->beginTransaction();
            try {
                $lockedUser = $revoker->table('users')
                    ->where('id', $userId)
                    ->where('tenant_id', $tenantId)
                    ->lockForUpdate()
                    ->first(['id']);
                self::assertNotNull($lockedUser);

                $revoker->insert(
                    'INSERT INTO revoked_tokens (user_id, jti, revoked_at, expires_at)
                     VALUES (?, ?, FROM_UNIXTIME(?), DATE_ADD(NOW(), INTERVAL 1 YEAR))',
                    [$userId, 'global_revoke_' . $userId, (int) $payload['iat']]
                );
                $revoker->commit();
            } catch (Throwable $exception) {
                if ($revoker->transactionLevel() > 0) {
                    $revoker->rollBack();
                }
                throw $exception;
            }

            $lockedUser = $registration->table('users')
                ->where('id', $userId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first(['id']);
            self::assertNotNull($lockedUser);

            // A normal consistent read would still see the old snapshot. The
            // under-lock validator must use a current read and reject the proof.
            self::assertNull($service->validateSecurityConfirmationTokenUnderUserLock(
                $confirmation,
                $userId,
                $tenantId
            ));
            self::assertNotNull($service->validateToken($access), 'Control: consistent reads still observe the old snapshot.');
            self::assertNull($service->validateToken($access, true));
            self::assertFalse($service->isAuthenticationStartValid($userId, (int) $payload['iat']));
        } finally {
            if ($registration->transactionLevel() > 0) {
                $registration->rollBack();
            }
            DB::purge($revocationConnection);
            config(["database.connections.{$revocationConnection}" => null]);
        }
    }

    public function test_simultaneous_factor_consumption_has_exactly_one_winner(): void
    {
        [$tenantId, $userId] = $this->createCommittedFixture();
        $secret = \App\Services\TotpService::generateSecret();
        DB::table('user_totp_settings')->insert([
            'user_id' => $userId, 'tenant_id' => $tenantId, 'is_enabled' => 1,
            'totp_secret_encrypted' => \App\Core\TotpEncryption::encrypt($secret),
        ]);
        $recovery = \App\Services\TotpService::generateBackupCodes($userId, $tenantId)[0];
        foreach (['totp', 'recovery'] as $method) {
            $code = $method === 'totp' ? \OTPHP\TOTP::createFromSecret($secret)->now() : $recovery;
            DB::disconnect();
            $workers = [];
            for ($index = 0; $index < 2; $index++) {
                $sockets = stream_socket_pair(STREAM_PF_UNIX, STREAM_SOCK_STREAM, STREAM_IPPROTO_IP);
                if ($sockets === false) throw new RuntimeException('mfa_concurrency_socket_failed');
                $pid = pcntl_fork();
                if ($pid === -1) throw new RuntimeException('mfa_concurrency_fork_failed');
                if ($pid === 0) {
                    fclose($sockets[0]);
                    fread($sockets[1], 1);
                    try {
                        DB::purge(); DB::reconnect();
                        DB::statement('SET SESSION innodb_lock_wait_timeout = 5');
                        $result = $method === 'totp'
                            ? \App\Services\TotpService::verifyLogin($userId, $code, $tenantId)
                            : \App\Services\TotpService::verifyBackupCode($userId, $code, $tenantId);
                        fwrite($sockets[1], json_encode(['status' => $result['success'] ? 'accepted' : 'rejected'], JSON_THROW_ON_ERROR));
                        fclose($sockets[1]); exit(0);
                    } catch (Throwable $exception) {
                        fwrite($sockets[1], json_encode(['status' => 'error', 'exception' => get_class($exception)], JSON_THROW_ON_ERROR));
                        fclose($sockets[1]); exit(1);
                    }
                }
                fclose($sockets[1]);
                $workers[] = ['pid' => $pid, 'socket' => $sockets[0], 'buffer' => ''];
            }
            foreach ($workers as $worker) fwrite($worker['socket'], '1');
            $results = $this->awaitWorkers($workers, 12.0);
            DB::purge(); DB::reconnect();
            $statuses = array_column($results, 'status');
            sort($statuses);
            self::assertSame(['accepted', 'rejected'], $statuses, $method);
        }
    }

    public function test_simultaneous_rotation_preserves_the_winner_and_supersedes_the_loser(): void
    {
        [$tenantId, $userId] = $this->createCommittedFixture();
        $service = new TokenService();
        $refreshToken = $service->generateRefreshToken($userId, $tenantId);
        $originalPayload = $this->decodeJwt($refreshToken);

        DB::disconnect();
        $workers = [];

        for ($index = 0; $index < 2; $index++) {
            $sockets = stream_socket_pair(STREAM_PF_UNIX, STREAM_SOCK_STREAM, STREAM_IPPROTO_IP);
            if ($sockets === false) {
                throw new RuntimeException('refresh_rotation_concurrency_socket_failed');
            }

            $pid = pcntl_fork();
            if ($pid === -1) {
                throw new RuntimeException('refresh_rotation_concurrency_fork_failed');
            }

            if ($pid === 0) {
                fclose($sockets[0]);
                fread($sockets[1], 1);

                try {
                    DB::purge();
                    DB::reconnect();
                    DB::statement('SET SESSION innodb_lock_wait_timeout = 5');

                    $rotation = (new TokenService())->rotateRefreshToken($refreshToken);
                    $message = match ($rotation['outcome'] ?? null) {
                        TokenService::REFRESH_ROTATION_OUTCOME_ROTATED => [
                            'status' => 'rotated',
                            'refresh_token' => $rotation['refresh_token'],
                        ],
                        TokenService::REFRESH_ROTATION_OUTCOME_RECENTLY_CONSUMED => [
                            'status' => 'recently_consumed',
                        ],
                        default => ['status' => 'rejected'],
                    };
                    fwrite($sockets[1], json_encode($message, JSON_THROW_ON_ERROR));
                    fclose($sockets[1]);
                    exit(0);
                } catch (Throwable $exception) {
                    fwrite($sockets[1], json_encode([
                        'status' => 'error',
                        'message' => $exception->getMessage(),
                    ], JSON_THROW_ON_ERROR));
                    fclose($sockets[1]);
                    exit(1);
                }
            }

            fclose($sockets[1]);
            $workers[] = [
                'pid' => $pid,
                'socket' => $sockets[0],
                'buffer' => '',
            ];
        }

        foreach ($workers as $worker) {
            fwrite($worker['socket'], '1');
        }

        $results = $this->awaitWorkers($workers, 12.0);

        DB::purge();
        DB::reconnect();
        $statuses = array_column($results, 'status');
        sort($statuses);
        self::assertSame(['recently_consumed', 'rotated'], $statuses);

        $rotated = current(array_filter(
            $results,
            static fn (array $result): bool => $result['status'] === 'rotated'
        ));
        self::assertIsArray($rotated);
        self::assertIsString($rotated['refresh_token'] ?? null);
        self::assertNotNull($service->validateRefreshToken($rotated['refresh_token']));

        $superseded = current(array_filter(
            $results,
            static fn (array $result): bool => $result['status'] === 'recently_consumed'
        ));
        self::assertIsArray($superseded);
        self::assertArrayNotHasKey('refresh_token', $superseded);
        self::assertArrayNotHasKey('access_token', $superseded);

        $familyHash = hash('sha256', (string) $originalPayload['family_id']);
        self::assertSame(2, DB::table('refresh_token_sessions')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->where('family_hash', $familyHash)
            ->count());
        self::assertSame(0, DB::table('refresh_token_sessions')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->where('family_hash', $familyHash)
            ->whereNotNull('revoked_at')
            ->count());
    }

    /**
     * @param list<array{pid: int, socket: resource, buffer: string}> $workers
     * @return list<array<string, mixed>>
     */
    private function awaitWorkers(array $workers, float $timeoutSeconds): array
    {
        foreach ($workers as &$worker) {
            stream_set_blocking($worker['socket'], false);
        }
        unset($worker);

        $deadline = microtime(true) + $timeoutSeconds;
        $pending = array_keys($workers);
        $completed = [];

        while ($pending !== [] && microtime(true) < $deadline) {
            foreach ($pending as $offset => $index) {
                $chunk = stream_get_contents($workers[$index]['socket']);
                if (is_string($chunk) && $chunk !== '') {
                    $workers[$index]['buffer'] .= $chunk;
                }

                $waited = pcntl_waitpid($workers[$index]['pid'], $status, WNOHANG);
                if ($waited !== $workers[$index]['pid']) {
                    continue;
                }

                $tail = stream_get_contents($workers[$index]['socket']);
                if (is_string($tail) && $tail !== '') {
                    $workers[$index]['buffer'] .= $tail;
                }
                fclose($workers[$index]['socket']);

                $exitStatus = pcntl_wifexited($status) ? pcntl_wexitstatus($status) : -1;
                self::assertSame(0, $exitStatus, $workers[$index]['buffer']);
                $decoded = json_decode(
                    $workers[$index]['buffer'],
                    true,
                    512,
                    JSON_THROW_ON_ERROR
                );
                self::assertIsArray($decoded);
                $completed[] = $decoded;
                unset($pending[$offset]);
            }

            $pending = array_values($pending);
            if ($pending !== []) {
                usleep(20_000);
            }
        }

        if ($pending !== []) {
            foreach ($pending as $index) {
                posix_kill($workers[$index]['pid'], 9);
                pcntl_waitpid($workers[$index]['pid'], $status);
                fclose($workers[$index]['socket']);
            }
            self::fail('Refresh rotation workers exceeded the 12-second deadline.');
        }

        return $completed;
    }

    /** @return array{int, int} */
    private function createCommittedFixture(): array
    {
        $suffix = bin2hex(random_bytes(8));
        $tenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'Refresh concurrency ' . $suffix,
            'slug' => 'refresh-concurrency-' . $suffix,
            'is_active' => true,
            'depth' => 0,
            'allows_subtenants' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->fixtureTenantId = $tenantId;

        $userId = (int) DB::table('users')->insertGetId([
            'tenant_id' => $tenantId,
            'name' => 'Refresh Concurrency Member',
            'email' => "refresh-concurrency-{$suffix}@example.test",
            'password_hash' => password_hash(bin2hex(random_bytes(16)), PASSWORD_ARGON2ID),
            'role' => 'member',
            'status' => 'active',
            'is_approved' => true,
            'is_active' => true,
            'preferred_language' => 'en',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->fixtureUserId = $userId;

        return [$tenantId, $userId];
    }

    /** @return array<string, mixed> */
    private function decodeJwt(string $token): array
    {
        $parts = explode('.', $token);

        return json_decode(
            base64_decode(strtr($parts[1], '-_', '+/')),
            true,
            512,
            JSON_THROW_ON_ERROR
        );
    }
}
