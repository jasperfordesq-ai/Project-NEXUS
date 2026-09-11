<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * TwoFactorChallengeManager — manages 2FA challenge tokens during login.
 *
 * When a user with 2FA enabled logs in, a challenge token is created and returned.
 * The client must then verify the TOTP code or backup code using this token.
 * Tokens are stored in cache (Redis) with a 5-minute TTL and limited attempts.
 */
class TwoFactorChallengeManager
{
    /** @var int Challenge TTL in seconds (5 minutes) */
    private const CHALLENGE_TTL = 300;

    /** @var int Maximum verification attempts before lockout */
    private const MAX_ATTEMPTS = 5;

    /** @var string Cache key prefix */
    private const PREFIX = '2fa_challenge:';

    /** @var string Distributed lock prefix for challenge mutations */
    private const LOCK_PREFIX = '2fa_challenge_lock:';

    /**
     * Create a new 2FA challenge for the given user.
     *
     * @param int $userId The user requiring 2FA
     * @param array $methods Allowed verification methods (e.g. ['totp', 'backup_code'])
     * @param int|null $tenantId Tenant that owns the user's 2FA credentials
     * @param int|null $authenticationStartedAt Password-authentication start time
     * @return string The challenge token to return to the client
     */
    public function create(
        int $userId,
        array $methods = ['totp'],
        ?int $tenantId = null,
        ?int $authenticationStartedAt = null,
        ?array $pendingIdentityLink = null,
        ?array $ssoProviderContext = null
    ): string
    {
        $tenantId ??= (int) TenantContext::getId();
        if (!$tenantId || $tenantId < 1) {
            throw new \InvalidArgumentException('A tenant is required to create a two-factor challenge.');
        }

        $now = time();
        $authenticationStartedAt ??= $now;
        if ($authenticationStartedAt < 1 || $authenticationStartedAt > $now) {
            throw new \InvalidArgumentException('The authentication start time is invalid.');
        }

        $token = Str::random(64);

        Cache::put(self::PREFIX . $token, [
            'user_id' => $userId,
            'tenant_id' => (int) $tenantId,
            'methods' => $methods,
            'attempts' => 0,
            'authentication_started_at' => $authenticationStartedAt,
            'expires_at' => $now + self::CHALLENGE_TTL,
            'created_at' => now()->toIso8601String(),
            'pending_identity_link' => $pendingIdentityLink,
            'sso_provider_context' => $ssoProviderContext,
        ], self::CHALLENGE_TTL);

        return $token;
    }

    /**
     * Get the challenge data for a token.
     *
     * @return array|null The challenge data, or null if expired/invalid
     */
    public function get(string $token): ?array
    {
        $data = Cache::get(self::PREFIX . $token);
        if (!is_array($data)) {
            return null;
        }

        $expiresAt = (int) ($data['expires_at'] ?? 0);
        if ($expiresAt < 1) {
            $createdAt = strtotime((string) ($data['created_at'] ?? ''));
            $expiresAt = $createdAt === false ? 0 : $createdAt + self::CHALLENGE_TTL;
        }

        if ($expiresAt <= time()) {
            Cache::forget(self::PREFIX . $token);
            return null;
        }

        $data['expires_at'] = $expiresAt;

        return $data;
    }

    /**
     * Record a verification attempt against a challenge token.
     *
     * @return array ['allowed' => bool, 'attempts_remaining' => int]
     */
    public function recordAttempt(string $token): array
    {
        $result = $this->withChallengeLock($token, function () use ($token): array {
            $data = $this->get($token);

            if (!$data) {
                return ['allowed' => false, 'attempts_remaining' => 0];
            }

            $data['attempts'] = ($data['attempts'] ?? 0) + 1;
            $remaining = self::MAX_ATTEMPTS - $data['attempts'];

            if ($remaining <= 0) {
                // Max attempts exceeded — delete the challenge
                Cache::forget(self::PREFIX . $token);
                return ['allowed' => false, 'attempts_remaining' => 0];
            }

            // Preserve the absolute five-minute deadline. Repeated attempts must
            // never extend a password-authenticated challenge's lifetime.
            $remainingTtl = (int) $data['expires_at'] - time();
            if ($remainingTtl <= 0) {
                Cache::forget(self::PREFIX . $token);
                return ['allowed' => false, 'attempts_remaining' => 0];
            }
            Cache::put(self::PREFIX . $token, $data, $remainingTtl);

            return ['allowed' => true, 'attempts_remaining' => $remaining];
        });

        return is_array($result)
            ? $result
            : ['allowed' => false, 'attempts_remaining' => 0];
    }

    /**
     * Consume (use) a challenge token after successful verification.
     * The token is deleted and cannot be reused.
     */
    public function consume(string $token): bool
    {
        return $this->withChallengeLock(
            $token,
            fn (): bool => Cache::forget(self::PREFIX . $token)
        ) === true;
    }

    /**
     * Delete a challenge token (e.g. on cancellation or timeout).
     */
    public function delete(string $token): bool
    {
        return $this->withChallengeLock(
            $token,
            fn (): bool => Cache::forget(self::PREFIX . $token)
        ) === true;
    }

    /**
     * Serialize every challenge mutation across PHP workers. Cache::lock()
     * maps to a distributed Redis lock in production; lock contention or a
     * cache failure denies the mutation rather than allowing an MFA bypass.
     */
    private function withChallengeLock(string $token, callable $callback): mixed
    {
        try {
            return Cache::lock(
                self::LOCK_PREFIX . hash('sha256', $token),
                5
            )->get($callback);
        } catch (\Throwable $e) {
            Log::warning('[TwoFactorChallengeManager] Challenge mutation lock failed', [
                'error' => $e->getMessage(),
            ]);

            return false;
        }
    }
}
