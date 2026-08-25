<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * TokenService — Laravel DI-based JWT token service.
 *
 * Handles HMAC-signed token generation, validation, revocation,
 * and impersonation tokens. Self-contained — no legacy delegation.
 */
class TokenService
{
    // Uniform session policy. Caller-controlled platform headers must never
    // grant a longer-lived credential.
    private const ACCESS_TOKEN_EXPIRY = 900;                // 15 minutes
    private const ACCESS_TOKEN_VERSION = 2;
    private const REFRESH_TOKEN_EXPIRY = 2592000;           // 30 days, absolute family lifetime
    private const REFRESH_TOKEN_VERSION = 2;
    private const REFRESH_REUSE_GRACE_SECONDS = 5;
    private const IMPERSONATION_TOKEN_EXPIRY = 300;         // 5 minutes
    private const SECURITY_CONFIRMATION_EXPIRY = 300;       // 5 minutes

    private const ALGORITHM = 'HS256';

    public const REFRESH_ROTATION_OUTCOME_ROTATED = 'rotated';
    public const REFRESH_ROTATION_OUTCOME_RECENTLY_CONSUMED = 'recently_consumed';

    /**
     * Get the secret key for signing tokens.
     */
    private function getSecretKey(): string
    {
        $secret = config('app.jwt_secret');

        if (!$secret) {
            $appKey = config('app.key');
            if (!$appKey) {
                throw new \RuntimeException('Security configuration error: JWT_SECRET or APP_KEY must be set');
            }
            $secret = hash('sha256', $appKey . 'jwt-token-secret');
        }

        return $secret;
    }

    /**
     * Check if the current request is from a mobile app (Capacitor/native).
     */
    public function isMobileRequest(): bool
    {
        $userAgent = request()->userAgent() ?? '';

        return (
            str_contains($userAgent, 'Capacitor') ||
            str_contains($userAgent, 'nexus-mobile') ||
            request()->hasHeader('X-Capacitor-App') ||
            request()->hasHeader('X-Nexus-Mobile')
        );
    }

    /**
     * Return the uniform access-token lifetime.
     *
     * The parameter remains for source compatibility with existing callers,
     * but it cannot influence credential lifetime.
     */
    public function getAccessTokenExpiry(?bool $isMobile = null): int
    {
        $testSeconds = (int) config('auth.test_access_token_expiry_seconds', 0);
        if (app()->environment(['local', 'testing']) && $testSeconds >= 1 && $testSeconds <= 60) {
            return $testSeconds;
        }

        return self::ACCESS_TOKEN_EXPIRY;
    }

    /**
     * Return the uniform absolute refresh-family lifetime.
     *
     * The parameter remains for source compatibility with existing callers,
     * but it cannot influence credential lifetime.
     */
    public function getRefreshTokenExpiry(?bool $isMobile = null): int
    {
        return self::REFRESH_TOKEN_EXPIRY;
    }

    /**
     * Generate an access token for a user.
     */
    public function generateToken(int $userId, int $tenantId, array $additionalClaims = [], ?bool $isMobile = null): string
    {
        $expiry = $this->getAccessTokenExpiry($isMobile);
        $platform = ($isMobile ?? $this->isMobileRequest()) ? 'mobile' : 'web';

        return $this->createToken([
            'user_id' => $userId,
            'tenant_id' => $tenantId,
            'type' => 'access',
            'access_version' => self::ACCESS_TOKEN_VERSION,
            'platform' => $platform,
            ...$additionalClaims,
            'jti' => bin2hex(random_bytes(16)),
        ], $expiry);
    }

    /**
     * Generate a refresh token for a user.
     */
    public function generateRefreshToken(int $userId, int $tenantId, ?bool $isMobile = null): string
    {
        $familyId = bin2hex(random_bytes(32));
        $familyExpiresAt = time() + self::REFRESH_TOKEN_EXPIRY;

        return DB::transaction(function () use ($userId, $tenantId, $familyId, $familyExpiresAt): string {
            // Serialize every new family with password changes and logout-all.
            // Callers may already hold this row lock; re-acquiring it within a
            // nested transaction is safe and protects less obvious call sites.
            $lockedUser = DB::table('users')
                ->where('id', $userId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first(['id']);
            if ($lockedUser === null) {
                throw new \RuntimeException('Cannot issue a refresh token for an unknown tenant user.');
            }

            return $this->issueTrackedRefreshToken(
                $userId,
                $tenantId,
                $familyId,
                $familyExpiresAt
            );
        }, 3);
    }

    /**
     * Issue a short-lived proof that a sensitive authenticator mutation was
     * confirmed with an existing sign-in factor.
     */
    public function generateSecurityConfirmationToken(int $userId, int $tenantId, string $method): string
    {
        return $this->createToken([
            'user_id' => $userId,
            'tenant_id' => $tenantId,
            'type' => 'security_confirmation',
            'method' => $method,
            'jti' => bin2hex(random_bytes(16)),
        ], self::SECURITY_CONFIRMATION_EXPIRY);
    }

    public function validateSecurityConfirmationToken(string $token, int $userId, int $tenantId): ?array
    {
        $payload = $this->validateSignedToken($token);
        if (
            $payload === null
            || ($payload['type'] ?? null) !== 'security_confirmation'
            || (int) ($payload['user_id'] ?? 0) !== $userId
            || (int) ($payload['tenant_id'] ?? 0) !== $tenantId
        ) {
            return null;
        }

        return $payload;
    }

    /**
     * Revalidate a security-confirmation proof after the caller has locked the
     * tenant-scoped user row used by revokeAllTokensForUser().
     *
     * The locking revocation read is deliberate: under InnoDB REPEATABLE READ,
     * an earlier consistent read in the surrounding transaction could otherwise
     * hide a global cutoff that committed while the caller waited for the user
     * lock. Callers must invoke this inside that user-lock transaction.
     */
    public function validateSecurityConfirmationTokenUnderUserLock(
        string $token,
        int $userId,
        int $tenantId
    ): ?array {
        $payload = $this->validateSignedToken($token, true);
        if (
            $payload === null
            || ($payload['type'] ?? null) !== 'security_confirmation'
            || (int) ($payload['user_id'] ?? 0) !== $userId
            || (int) ($payload['tenant_id'] ?? 0) !== $tenantId
        ) {
            return null;
        }

        return $payload;
    }

    /**
     * Validate an access token and return its payload if valid.
     */
    public function validateToken(string $token): ?array
    {
        $payload = $this->validateSignedToken($token);

        if (
            !$payload
            || ($payload['type'] ?? '') !== 'access'
            || (int) ($payload['access_version'] ?? 0) !== self::ACCESS_TOKEN_VERSION
            || (int) ($payload['exp'] ?? 0) - (int) ($payload['nbf'] ?? 0) > $this->getAccessTokenExpiry()
        ) {
            return null;
        }

        // An impersonated session can be ended early ("stop impersonating")
        // without revoking the target member's own sessions, so its per-session
        // jti is checked here rather than through the global cutoff.
        $sessionJti = $payload['impersonation_jti'] ?? null;
        if (is_string($sessionJti) && $sessionJti !== '') {
            try {
                $revoked = DB::selectOne("SELECT id FROM revoked_tokens WHERE jti = ?", [$sessionJti]);
            } catch (\Exception $e) {
                // A revocation lookup that cannot run must not silently widen
                // access; fail closed for impersonated sessions only.
                Log::error('[TokenService] Impersonation revocation check failed: ' . $e->getMessage());
                return null;
            }
            if ($revoked) {
                return null;
            }
        }

        $accessJti = $payload['jti'] ?? null;
        if (is_string($accessJti) && $accessJti !== '') {
            try {
                $revoked = DB::selectOne('SELECT id FROM revoked_tokens WHERE jti = ?', [$accessJti]);
            } catch (\Throwable $e) {
                Log::error('[TokenService] Access-token revocation check failed: ' . $e->getMessage());
                return null;
            }
            if ($revoked) {
                return null;
            }
        }

        return $payload;
    }

    /**
     * Revoke one presented access token without affecting the user's other devices.
     */
    public function revokeAccessToken(string $accessToken, ?int $userId = null): bool
    {
        $payload = $this->validateSignedToken($accessToken);
        if (
            $payload === null
            || ($payload['type'] ?? null) !== 'access'
            || !is_string($payload['jti'] ?? null)
            || ($payload['jti'] ?? '') === ''
        ) {
            return false;
        }

        $tokenUserId = (int) ($payload['user_id'] ?? 0);
        if ($tokenUserId < 1 || ($userId !== null && $tokenUserId !== $userId)) {
            return false;
        }

        try {
            DB::insert(
                'INSERT IGNORE INTO revoked_tokens (user_id, jti, expires_at) VALUES (?, ?, FROM_UNIXTIME(?))',
                [$tokenUserId, $payload['jti'], (int) $payload['exp']]
            );
            return true;
        } catch (\Throwable $e) {
            Log::error('[TokenService] Failed to revoke access token: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Validate a signed JWT regardless of token purpose.
     */
    private function validateSignedToken(string $token, bool $lockGlobalRevocation = false): ?array
    {
        $parts = explode('.', $token);

        if (count($parts) !== 3) {
            return null;
        }

        [$headerEncoded, $payloadEncoded, $signatureEncoded] = $parts;

        // Verify signature
        $expectedSignature = $this->sign($headerEncoded . '.' . $payloadEncoded);
        $providedSignature = $this->base64UrlDecode($signatureEncoded);

        if (!hash_equals($expectedSignature, $providedSignature)) {
            return null;
        }

        // Decode payload
        $payload = json_decode($this->base64UrlDecode($payloadEncoded), true);

        if (!$payload) {
            return null;
        }

        // Check expiration
        if (isset($payload['exp']) && $payload['exp'] < time()) {
            return null;
        }

        // Check not-before
        if (isset($payload['nbf']) && $payload['nbf'] > time()) {
            return null;
        }

        // Check global revocation (e.g. "log out everywhere")
        $userId = $payload['user_id'] ?? null;
        $iat = $payload['iat'] ?? 0;
        if ($userId && $iat) {
            $globalJti = 'global_revoke_' . $userId;
            $lockingClause = $lockGlobalRevocation ? ' FOR UPDATE' : '';
            $globalRevoke = DB::selectOne(
                "SELECT revoked_at FROM revoked_tokens WHERE jti = ? AND revoked_at >= FROM_UNIXTIME(?){$lockingClause}",
                [$globalJti, $iat]
            );
            if ($globalRevoke) {
                return null;
            }
        }

        // Access tokens minted by refresh rotation are bound to that refresh
        // family. Logging out the family therefore invalidates a delayed access
        // response too (not just the refresh cookie/token that accompanied it).
        // This closes response-order races in both the SPA and accessible HTML
        // frontend without turning a one-device logout into logout-everywhere.
        $refreshFamilyId = $payload['refresh_family_id'] ?? null;
        if (is_string($refreshFamilyId) && $refreshFamilyId !== '') {
            $familyIsActive = DB::table('refresh_token_sessions')
                ->where('family_hash', $this->hashIdentifier($refreshFamilyId))
                ->where('user_id', (int) ($payload['user_id'] ?? 0))
                ->where('tenant_id', (int) ($payload['tenant_id'] ?? 0))
                ->whereNull('revoked_at')
                ->where('family_expires_at', '>', now())
                ->exists();
            if (!$familyIsActive) {
                return null;
            }
        }

        return $payload;
    }

    /**
     * Validate a refresh token with revocation check.
     */
    public function validateRefreshToken(string $token): ?array
    {
        $payload = $this->parseTrackedRefreshToken($token);
        if ($payload === null) {
            return null;
        }

        $session = $this->findRefreshSession($payload);
        if (
            $session === null
            || $session->consumed_at !== null
            || $session->revoked_at !== null
            || strtotime((string) $session->expires_at) <= time()
            || strtotime((string) $session->family_expires_at) <= time()
        ) {
            return null;
        }

        return $payload;
    }

    /**
     * Validate the fixed access-token window copied into a legacy API session.
     *
     * Raw PHP sessions are only a compatibility bridge. They must never outlive
     * the access token that established them or survive a global revocation.
     * Database failures fail closed because this method is used for authentication.
     */
    public function validateApiSessionWindow(
        int $userId,
        int $tenantId,
        int $issuedAt,
        int $expiresAt
    ): bool {
        $now = time();
        if (
            $userId < 1
            || $tenantId < 1
            || $issuedAt < 1
            || $expiresAt <= $now
            || $issuedAt >= $expiresAt
            || $expiresAt - $issuedAt > $this->getAccessTokenExpiry()
        ) {
            return false;
        }

        try {
            $globalRevoke = DB::selectOne(
                "SELECT revoked_at FROM revoked_tokens WHERE jti = ? AND revoked_at >= FROM_UNIXTIME(?)",
                ['global_revoke_' . $userId, $issuedAt]
            );

            return $globalRevoke === null;
        } catch (\Throwable $e) {
            Log::error('[TokenService] Failed to validate API session window', [
                'user_id' => $userId,
                'tenant_id' => $tenantId,
                'error' => $e->getMessage(),
            ]);
            return false;
        }
    }

    /**
     * Check whether an authentication flow still predates no global revocation.
     *
     * Call this after acquiring the user's issuance lock. A logout-all or
     * password change at or after the authentication start invalidates the
     * pending challenge. Storage failures fail closed.
     */
    public function isAuthenticationStartValid(int $userId, int $authenticationStartedAt): bool
    {
        if ($userId < 1 || $authenticationStartedAt < 1 || $authenticationStartedAt > time()) {
            return false;
        }

        try {
            $globalRevoke = DB::selectOne(
                "SELECT revoked_at FROM revoked_tokens WHERE jti = ? AND revoked_at >= FROM_UNIXTIME(?)",
                ['global_revoke_' . $userId, $authenticationStartedAt]
            );

            return $globalRevoke === null;
        } catch (\Throwable $e) {
            Log::error('[TokenService] Failed to validate authentication start', [
                'user_id' => $userId,
                'authentication_started_at' => $authenticationStartedAt,
                'error' => $e->getMessage(),
            ]);
            return false;
        }
    }

    /**
     * Verify a tracked refresh token before loading account policy state.
     *
     * Consumed tokens intentionally remain inspectable here so the atomic
     * rotation step can recognise reuse and revoke the whole token family.
     */
    public function inspectRefreshTokenForRotation(string $token): ?array
    {
        $payload = $this->parseTrackedRefreshToken($token);
        if ($payload === null || $this->findRefreshSession($payload) === null) {
            return null;
        }

        return $payload;
    }

    /**
     * Atomically consume one refresh token and issue its successor.
     *
     * A second request presenting the same token is normally a replay. For five
     * seconds only, the direct concurrent loser receives a credential-free
     * superseded outcome when the exact successor is still active. This keeps
     * the winner's credentials usable without disclosing them to the loser.
     *
     * @return array{outcome: string, payload?: array, refresh_token?: string, expires_in?: int}|null
     */
    public function rotateRefreshToken(string $token): ?array
    {
        $payload = $this->parseTrackedRefreshToken($token);
        if ($payload === null) {
            return null;
        }

        try {
            return DB::transaction(function () use ($payload): ?array {
                // This is the shared serialization point with logout-all and
                // password changes. Always acquire the user row before refresh
                // rows so every session mutation follows one lock order.
                $lockedUser = DB::table('users')
                    ->where('id', (int) $payload['user_id'])
                    ->where('tenant_id', (int) $payload['tenant_id'])
                    ->lockForUpdate()
                    ->first(['id']);
                if ($lockedUser === null) {
                    return null;
                }

                $jtiHash = $this->hashIdentifier((string) $payload['jti']);
                $familyHash = $this->hashIdentifier((string) $payload['family_id']);
                $session = DB::table('refresh_token_sessions')
                    ->where('jti_hash', $jtiHash)
                    ->where('family_hash', $familyHash)
                    ->where('tenant_id', (int) $payload['tenant_id'])
                    ->where('user_id', (int) $payload['user_id'])
                    ->lockForUpdate()
                    ->first();

                if ($session === null) {
                    return null;
                }

                if ($session->revoked_at !== null) {
                    return null;
                }

                $now = time();
                $tokenExpiresAt = strtotime((string) $session->expires_at);
                $familyExpiresAt = strtotime((string) $session->family_expires_at);
                if (
                    $tokenExpiresAt === false
                    || $familyExpiresAt === false
                    || $tokenExpiresAt <= $now
                    || $familyExpiresAt <= $now
                ) {
                    DB::table('refresh_token_sessions')
                        ->where('id', $session->id)
                        ->where('user_id', (int) $payload['user_id'])
                        ->where('tenant_id', (int) $payload['tenant_id'])
                        ->where('family_hash', $familyHash)
                        ->where('jti_hash', $jtiHash)
                        ->whereNull('revoked_at')
                        ->update([
                            'revoked_at' => now(),
                            'revocation_reason' => 'expired',
                            'updated_at' => now(),
                        ]);
                    return null;
                }

                if ($session->consumed_at !== null) {
                    if ($this->hasRecentActiveDirectSuccessor(
                        $session,
                        $jtiHash,
                        $familyHash,
                        (int) $payload['user_id'],
                        (int) $payload['tenant_id'],
                        $now
                    )) {
                        Log::info('[TokenService] Concurrent refresh request superseded by active successor', [
                            'user_id' => (int) $payload['user_id'],
                            'tenant_id' => (int) $payload['tenant_id'],
                        ]);

                        return [
                            'outcome' => self::REFRESH_ROTATION_OUTCOME_RECENTLY_CONSUMED,
                        ];
                    }

                    $this->revokeRefreshFamily(
                        $familyHash,
                        (int) $payload['user_id'],
                        (int) $payload['tenant_id'],
                        'reuse_detected'
                    );
                    Log::warning('[TokenService] Refresh-token reuse detected; family revoked', [
                        'user_id' => (int) $payload['user_id'],
                        'tenant_id' => (int) $payload['tenant_id'],
                    ]);
                    return null;
                }

                $consumed = DB::table('refresh_token_sessions')
                    ->where('id', $session->id)
                    ->where('user_id', (int) $payload['user_id'])
                    ->where('tenant_id', (int) $payload['tenant_id'])
                    ->where('family_hash', $familyHash)
                    ->where('jti_hash', $jtiHash)
                    ->whereNull('consumed_at')
                    ->whereNull('revoked_at')
                    ->update([
                        'consumed_at' => now(),
                        'updated_at' => now(),
                    ]);
                if ($consumed !== 1) {
                    $this->revokeRefreshFamily(
                        $familyHash,
                        (int) $payload['user_id'],
                        (int) $payload['tenant_id'],
                        'reuse_detected'
                    );
                    return null;
                }

                $successor = $this->issueTrackedRefreshToken(
                    (int) $payload['user_id'],
                    (int) $payload['tenant_id'],
                    (string) $payload['family_id'],
                    $familyExpiresAt,
                    $jtiHash
                );

                return [
                    'outcome' => self::REFRESH_ROTATION_OUTCOME_ROTATED,
                    'payload' => $payload,
                    'refresh_token' => $successor,
                    'expires_in' => max(0, ($this->getExpiration($successor) ?? $now) - $now),
                ];
            }, 3);
        } catch (\Throwable $e) {
            Log::error('[TokenService] Refresh-token rotation failed', [
                'user_id' => (int) $payload['user_id'],
                'tenant_id' => (int) $payload['tenant_id'],
                'error' => $e->getMessage(),
            ]);
            return null;
        }
    }

    /**
     * Check if a token is expired (without full validation).
     */
    public function isExpired(string $token): bool
    {
        $parts = explode('.', $token);

        if (count($parts) !== 3) {
            return true;
        }

        $payload = json_decode($this->base64UrlDecode($parts[1]), true);

        if (!$payload || !isset($payload['exp'])) {
            return true;
        }

        return $payload['exp'] < time();
    }

    /**
     * Check if token needs refresh (less than 5 minutes remaining).
     */
    public function needsRefresh(string $token): bool
    {
        return $this->getTimeRemaining($token) < 300;
    }

    /**
     * Extract user ID from token without full validation.
     */
    public function getUserIdFromToken(string $token): ?int
    {
        $parts = explode('.', $token);

        if (count($parts) !== 3) {
            return null;
        }

        $payload = json_decode($this->base64UrlDecode($parts[1]), true);

        return $payload['user_id'] ?? null;
    }

    /**
     * Revoke a refresh token by its jti claim.
     */
    public function revokeToken(string $refreshToken, ?int $userId = null): bool
    {
        $payload = $this->validateSignedToken($refreshToken);

        if (!$payload) {
            return false;
        }

        if (($payload['type'] ?? '') !== 'refresh') {
            return false;
        }

        $tokenUserId = (int) ($payload['user_id'] ?? 0);
        if ($tokenUserId < 1 || ($userId !== null && $tokenUserId !== $userId)) {
            return false;
        }

        $jti = $payload['jti'] ?? null;
        if (!$jti) {
            return false;
        }

        try {
            if ((int) ($payload['refresh_version'] ?? 0) === self::REFRESH_TOKEN_VERSION) {
                $familyId = $payload['family_id'] ?? null;
                if (!is_string($familyId) || $familyId === '') {
                    return false;
                }

                return DB::transaction(function () use ($payload, $jti, $familyId): bool {
                    // Keep the same user -> refresh-row lock order as rotation
                    // and logout-all so logout cannot deadlock or lose a race.
                    $lockedUser = DB::table('users')
                        ->where('id', (int) $payload['user_id'])
                        ->where('tenant_id', (int) $payload['tenant_id'])
                        ->lockForUpdate()
                        ->first(['id']);
                    if ($lockedUser === null) {
                        return false;
                    }

                    $session = DB::table('refresh_token_sessions')
                        ->where('jti_hash', $this->hashIdentifier((string) $jti))
                        ->where('family_hash', $this->hashIdentifier($familyId))
                        ->where('tenant_id', (int) $payload['tenant_id'])
                        ->where('user_id', (int) $payload['user_id'])
                        ->lockForUpdate()
                        ->first();
                    if ($session === null) {
                        return false;
                    }

                    $this->revokeRefreshFamily(
                        $this->hashIdentifier($familyId),
                        (int) $payload['user_id'],
                        (int) $payload['tenant_id'],
                        'user_logout'
                    );

                    return true;
                }, 3);
            }

            // Legacy refresh tokens are no longer accepted for rotation, but
            // record an explicit revocation when an older client logs out.
            // Check if already revoked
            $existing = DB::selectOne("SELECT id FROM revoked_tokens WHERE jti = ?", [$jti]);
            if ($existing) {
                return true;
            }

            DB::insert(
                "INSERT INTO revoked_tokens (user_id, jti, expires_at) VALUES (?, ?, FROM_UNIXTIME(?))",
                [$tokenUserId, $jti, $payload['exp']]
            );

            return true;
        } catch (\Exception $e) {
            Log::error('[TokenService] Failed to revoke token: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Revoke all refresh tokens for a user ("log out everywhere").
     */
    public function revokeAllTokensForUser(int $userId, string $reason = 'logout_all'): int
    {
        try {
            if (preg_match('/^[a-z0-9_]{1,40}$/D', $reason) !== 1) {
                throw new \InvalidArgumentException('Invalid session revocation reason.');
            }

            return DB::transaction(function () use ($userId, $reason): int {
                // Refresh issuance takes this same lock before rotating and
                // minting its replacement access token. Whichever transaction
                // wins is therefore totally ordered with this revocation.
                $user = DB::table('users')
                    ->where('id', $userId)
                    ->lockForUpdate()
                    ->first(['tenant_id']);
                if ($user === null || $user->tenant_id === null) {
                    return 0;
                }
                $tenantId = (int) $user->tenant_id;

                $farFutureExpiry = time() + (10 * 365 * 24 * 60 * 60);
                $globalJti = 'global_revoke_' . $userId;
                DB::insert(
                    "INSERT INTO revoked_tokens (user_id, jti, expires_at) VALUES (?, ?, FROM_UNIXTIME(?))
                     ON DUPLICATE KEY UPDATE
                        revoked_at = FROM_UNIXTIME(GREATEST(
                            COALESCE(UNIX_TIMESTAMP(revoked_at) + 1, 0),
                            UNIX_TIMESTAMP(NOW())
                        )),
                        expires_at = VALUES(expires_at)",
                    [$userId, $globalJti, $farFutureExpiry]
                );

                $now = now();
                $refreshCount = DB::table('refresh_token_sessions')
                    ->where('user_id', $userId)
                    ->where('tenant_id', $tenantId)
                    ->whereNull('revoked_at')
                    ->update([
                        'revoked_at' => $now,
                        'revocation_reason' => $reason,
                        'updated_at' => $now,
                    ]);

                $sanctumCount = Schema::hasTable('personal_access_tokens')
                    ? DB::table('personal_access_tokens')
                        ->where('tokenable_type', \App\Models\User::class)
                        ->where('tokenable_id', $userId)
                        ->where(static function ($query) use ($tenantId): void {
                            $query->where('tenant_id', $tenantId)
                                // Sanctum tokens created before tenant tagging
                                // remain revocable during the retirement window.
                                ->orWhereNull('tenant_id');
                        })
                        ->delete()
                    : 0;

                $legacyApiCount = Schema::hasTable('api_tokens')
                    ? DB::table('api_tokens')
                        ->where('user_id', $userId)
                        ->delete()
                    : 0;

                $trustedDeviceCount = Schema::hasTable('user_trusted_devices')
                    ? DB::table('user_trusted_devices')
                        ->where('user_id', $userId)
                        ->where('tenant_id', $tenantId)
                        ->where('is_revoked', 0)
                        ->update([
                            'is_revoked' => 1,
                            'revoked_at' => $now,
                            'revoked_reason' => $reason,
                            'updated_at' => $now,
                        ])
                    : 0;

                // The global cutoff itself always represents one successful
                // revocation action, even when no tracked session rows existed.
                return 1 + $refreshCount + $sanctumCount + $legacyApiCount + $trustedDeviceCount;
            });
        } catch (\Throwable $e) {
            Log::error('[TokenService] Failed to revoke all tokens: ' . $e->getMessage());
            return 0;
        }
    }

    /**
     * Generate a short-lived, single-use impersonation token (5 min TTL).
     */
    public function generateImpersonationToken(int $userId, int $tenantId, int $adminId): string
    {
        return $this->createToken([
            'user_id' => $userId,
            'tenant_id' => $tenantId,
            'type' => 'impersonation',
            'impersonated_by' => $adminId,
            'jti' => bin2hex(random_bytes(16)),
        ], self::IMPERSONATION_TOKEN_EXPIRY);
    }

    /**
     * Mint the actual signed-in session for an impersonated user.
     *
     * The short-lived handoff proof from generateImpersonationToken() is NOT a
     * credential: validateToken() only accepts `type: access`, so presenting the
     * proof as a bearer token authenticates nothing. This method is the missing
     * half — it exchanges a consumed proof for a real access token that carries
     * the impersonation provenance in its own claims.
     *
     * Deliberately returns no refresh token. An impersonated session must not
     * mint a multi-day refresh family against somebody else's account; it ends
     * when the access token expires and the admin can re-impersonate.
     *
     * @return array{token: string, session_jti: string, expires_in: int}
     */
    public function generateImpersonationSessionToken(int $userId, int $tenantId, int $adminId): array
    {
        $sessionJti = bin2hex(random_bytes(16));

        $token = $this->generateToken($userId, $tenantId, [
            'impersonated_by' => $adminId,
            'impersonation_jti' => $sessionJti,
        ]);

        return [
            'token' => $token,
            'session_jti' => $sessionJti,
            'expires_in' => $this->getAccessTokenExpiry(),
        ];
    }

    /**
     * Revoke a single impersonated session without touching the target user's
     * own sessions.
     *
     * "Stop impersonating" must never behave like a logout-everywhere for the
     * member being impersonated, so this records only the per-session jti minted
     * by generateImpersonationSessionToken().
     */
    public function revokeImpersonationSession(string $accessToken): bool
    {
        $payload = $this->validateSignedToken($accessToken);
        if ($payload === null) {
            return false;
        }

        $sessionJti = $payload['impersonation_jti'] ?? null;
        if (!is_string($sessionJti) || $sessionJti === '') {
            return false;
        }

        try {
            DB::insert(
                "INSERT IGNORE INTO revoked_tokens (user_id, jti, expires_at) VALUES (?, ?, FROM_UNIXTIME(?))",
                [(int) ($payload['user_id'] ?? 0), $sessionJti, (int) ($payload['exp'] ?? time())]
            );
        } catch (\Exception $e) {
            Log::error('[TokenService] Failed to revoke impersonation session: ' . $e->getMessage());
            return false;
        }

        return true;
    }

    /**
     * Validate and consume an impersonation token (single-use).
     */
    public function validateImpersonationToken(string $token): ?array
    {
        $payload = $this->validateSignedToken($token);

        if (!$payload) {
            return null;
        }

        if (($payload['type'] ?? '') !== 'impersonation') {
            return null;
        }

        if (empty($payload['impersonated_by'])) {
            return null;
        }

        $jti = $payload['jti'] ?? null;
        if (!$jti) {
            return null;
        }

        try {
            $existing = DB::selectOne("SELECT id FROM revoked_tokens WHERE jti = ?", [$jti]);
            if ($existing) {
                return null;
            }

            DB::insert(
                "INSERT INTO revoked_tokens (user_id, jti, expires_at) VALUES (?, ?, FROM_UNIXTIME(?))",
                [$payload['user_id'], $jti, $payload['exp']]
            );
        } catch (\Exception $e) {
            Log::error('[TokenService] Failed to consume impersonation token: ' . $e->getMessage());
            return null;
        }

        return $payload;
    }

    /**
     * Get remaining time until token expires.
     */
    public function getTimeRemaining(string $token): int
    {
        $exp = $this->getExpiration($token);

        if ($exp === null) {
            return -1;
        }

        return $exp - time();
    }

    /**
     * Get token expiration time.
     */
    public function getExpiration(string $token): ?int
    {
        $parts = explode('.', $token);

        if (count($parts) !== 3) {
            return null;
        }

        $payload = json_decode($this->base64UrlDecode($parts[1]), true);

        return $payload['exp'] ?? null;
    }

    /**
     * Check if a refresh token has been revoked.
     */
    public function isTokenRevoked(string $refreshToken): bool
    {
        $payload = $this->validateSignedToken($refreshToken);

        if (!$payload) {
            return true;
        }

        if ((int) ($payload['refresh_version'] ?? 0) === self::REFRESH_TOKEN_VERSION) {
            return $this->validateRefreshToken($refreshToken) === null;
        }

        $jti = $payload['jti'] ?? null;
        $userId = $payload['user_id'] ?? null;
        $iat = $payload['iat'] ?? 0;

        if (!$jti || !$userId) {
            return true;
        }

        try {
            $existing = DB::selectOne("SELECT id FROM revoked_tokens WHERE jti = ?", [$jti]);
            if ($existing) {
                return true;
            }

            $globalJti = 'global_revoke_' . $userId;
            $globalRevoke = DB::selectOne(
                "SELECT revoked_at FROM revoked_tokens WHERE jti = ? AND revoked_at >= FROM_UNIXTIME(?)",
                [$globalJti, $iat]
            );
            if ($globalRevoke) {
                return true;
            }

            return false;
        } catch (\Exception $e) {
            Log::error('[TokenService] Failed to check token revocation: ' . $e->getMessage());
            return true;
        }
    }

    /**
     * Clean up expired revocation records (for cron).
     */
    public function cleanupExpiredRevocations(): int
    {
        try {
            return DB::transaction(function (): int {
                $legacy = DB::delete("DELETE FROM revoked_tokens WHERE expires_at < NOW() AND jti NOT LIKE 'global_revoke_%'");
                $tracked = DB::table('refresh_token_sessions')
                    ->where('family_expires_at', '<', now())
                    ->delete();

                return $legacy + $tracked;
            });
        } catch (\Exception $e) {
            Log::error('[TokenService] Failed to cleanup revocations: ' . $e->getMessage());
            return 0;
        }
    }

    // ─── Private helpers ────────────────────────────────────────────

    /**
     * Parse only refresh tokens issued under the tracked rotation protocol.
     * Tokens issued before this version deliberately fail closed, invalidating
     * the former two-year and five-year bearer refresh credentials at rollout.
     */
    private function parseTrackedRefreshToken(string $token): ?array
    {
        $payload = $this->validateSignedToken($token);
        if (
            $payload === null
            || ($payload['type'] ?? null) !== 'refresh'
            || (int) ($payload['refresh_version'] ?? 0) !== self::REFRESH_TOKEN_VERSION
            || (int) ($payload['user_id'] ?? 0) < 1
            || (int) ($payload['tenant_id'] ?? 0) < 1
            || !isset($payload['exp'])
        ) {
            return null;
        }

        $jti = $payload['jti'] ?? null;
        $familyId = $payload['family_id'] ?? null;
        if (
            !is_string($jti)
            || !is_string($familyId)
            || preg_match('/^[a-f0-9]{64}$/D', $jti) !== 1
            || preg_match('/^[a-f0-9]{64}$/D', $familyId) !== 1
        ) {
            return null;
        }

        return $payload;
    }

    private function findRefreshSession(array $payload): ?object
    {
        return DB::table('refresh_token_sessions')
            ->where('jti_hash', $this->hashIdentifier((string) $payload['jti']))
            ->where('family_hash', $this->hashIdentifier((string) $payload['family_id']))
            ->where('tenant_id', (int) $payload['tenant_id'])
            ->where('user_id', (int) $payload['user_id'])
            ->first();
    }

    private function issueTrackedRefreshToken(
        int $userId,
        int $tenantId,
        string $familyId,
        int $familyExpiresAt,
        ?string $parentJtiHash = null
    ): string {
        if ($familyExpiresAt <= time()) {
            throw new \RuntimeException('Cannot issue a refresh token for an expired family.');
        }

        $userExists = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->exists();
        if (!$userExists) {
            throw new \RuntimeException('Cannot issue a refresh token for an unknown tenant user.');
        }

        $jti = bin2hex(random_bytes(32));
        $token = $this->createToken([
            'user_id' => $userId,
            'tenant_id' => $tenantId,
            'type' => 'refresh',
            'refresh_version' => self::REFRESH_TOKEN_VERSION,
            'family_id' => $familyId,
            'jti' => $jti,
        ], $familyExpiresAt - time());

        $expiresAt = $this->getExpiration($token);
        if ($expiresAt === null) {
            throw new \RuntimeException('Could not determine refresh token expiry.');
        }

        $now = now();
        DB::table('refresh_token_sessions')->insert([
            'tenant_id' => $tenantId,
            'user_id' => $userId,
            'family_hash' => $this->hashIdentifier($familyId),
            'jti_hash' => $this->hashIdentifier($jti),
            'parent_jti_hash' => $parentJtiHash,
            'issued_at' => $now,
            'expires_at' => date('Y-m-d H:i:s', $expiresAt),
            'family_expires_at' => date('Y-m-d H:i:s', $familyExpiresAt),
            'consumed_at' => null,
            'revoked_at' => null,
            'revocation_reason' => null,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        return $token;
    }

    private function revokeRefreshFamily(
        string $familyHash,
        int $userId,
        int $tenantId,
        string $reason
    ): int {
        $now = now();

        return DB::table('refresh_token_sessions')
            ->where('family_hash', $familyHash)
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->whereNull('revoked_at')
            ->update([
                'revoked_at' => $now,
                'revocation_reason' => $reason,
                'updated_at' => $now,
            ]);
    }

    private function hasRecentActiveDirectSuccessor(
        object $session,
        string $jtiHash,
        string $familyHash,
        int $userId,
        int $tenantId,
        int $now
    ): bool {
        $consumedAt = strtotime((string) $session->consumed_at);
        if (
            $consumedAt === false
            || $consumedAt > $now
            || ($now - $consumedAt) > self::REFRESH_REUSE_GRACE_SECONDS
        ) {
            return false;
        }

        return DB::table('refresh_token_sessions')
            ->where('family_hash', $familyHash)
            ->where('parent_jti_hash', $jtiHash)
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->whereNull('consumed_at')
            ->whereNull('revoked_at')
            ->where('expires_at', '>', date('Y-m-d H:i:s', $now))
            ->where('family_expires_at', '>', date('Y-m-d H:i:s', $now))
            ->exists();
    }

    private function hashIdentifier(string $identifier): string
    {
        return hash('sha256', $identifier);
    }

    /**
     * Create a signed token with the given payload.
     */
    private function createToken(array $payload, int $expirySeconds): string
    {
        $header = [
            'alg' => self::ALGORITHM,
            'typ' => 'JWT',
        ];

        $now = time();
        $issuedAt = $this->issuedAtAfterGlobalRevocation($payload, $now);
        $payload = array_merge($payload, [
            'iat' => $issuedAt,
            // Expiry remains anchored to wall-clock issuance. The logical iat
            // may be advanced solely to clear a same-second revocation cutoff;
            // it must not lengthen the token's real lifetime.
            'exp' => $now + $expirySeconds,
            'nbf' => $now,
        ]);

        $headerEncoded = $this->base64UrlEncode(json_encode($header));
        $payloadEncoded = $this->base64UrlEncode(json_encode($payload));

        $signature = $this->sign($headerEncoded . '.' . $payloadEncoded);
        $signatureEncoded = $this->base64UrlEncode($signature);

        return $headerEncoded . '.' . $payloadEncoded . '.' . $signatureEncoded;
    }

    /**
     * Return an issuance time strictly newer than this user's global revocation
     * cutoff. JWT NumericDate values and revoked_tokens.revoked_at both have
     * one-second precision, so wall-clock time alone cannot distinguish tokens
     * issued immediately before and after a revocation in the same second.
     *
     * `nbf` remains the real current time, allowing the newly issued token to be
     * used immediately even when its logical `iat` is one second ahead.
     */
    private function issuedAtAfterGlobalRevocation(array $payload, int $now): int
    {
        $userId = (int) ($payload['user_id'] ?? 0);
        if ($userId < 1) {
            return $now;
        }

        $globalRevoke = DB::selectOne(
            'SELECT UNIX_TIMESTAMP(revoked_at) AS cutoff
             FROM revoked_tokens
             WHERE jti = ?',
            ['global_revoke_' . $userId]
        );
        if ($globalRevoke === null) {
            return $now;
        }

        return max($now, (int) ($globalRevoke->cutoff ?? 0) + 1);
    }

    /**
     * Create HMAC signature.
     */
    private function sign(string $data): string
    {
        return hash_hmac('sha256', $data, $this->getSecretKey(), true);
    }

    /**
     * Base64 URL-safe encoding.
     */
    private function base64UrlEncode(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    /**
     * Base64 URL-safe decoding.
     */
    private function base64UrlDecode(string $data): string
    {
        $remainder = strlen($data) % 4;
        if ($remainder) {
            $data .= str_repeat('=', 4 - $remainder);
        }
        return base64_decode(strtr($data, '-_', '+/'));
    }
}
