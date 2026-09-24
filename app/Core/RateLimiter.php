<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Core;

use Illuminate\Support\Facades\DB;

/**
 * Rate limiting for login attempts and API endpoints.
 *
 * Provides two mechanisms:
 * 1. Login-specific rate limiting (database-based, brute force protection)
 * 2. General API rate limiting (cache-based, request throttling)
 */
class RateLimiter
{
    private static bool $tableChecked = false;

    // Login rate limiting constants
    private const MAX_ATTEMPTS = 10;
    private const LOCKOUT_DURATION = 300;
    private const ATTEMPT_WINDOW = 300;

    /** Default rate limits by request type (requests per minute) */
    public const DEFAULT_LIMITS = [
        'read'   => 120,
        'write'  => 60,
        'upload' => 20,
        'auth'   => 10,
        'search' => 30,
    ];

    /** Cache of rate limit state for current request */
    private static ?array $currentRateLimitState = null;

    /**
     * Check if an IP/email combination is currently rate limited.
     *
     * @param string $identifier Email or IP address
     * @param string $type       'email' or 'ip'
     * @return array{limited: bool, remaining_attempts: int, retry_after: int|null}
     */
    public static function check(string $identifier, string $type = 'email'): array
    {
        self::ensureTableExists();
        self::cleanupOldAttempts();

        $identifier = self::scopeLoginIdentifier($identifier, $type);

        $cutoff = date('Y-m-d H:i:s', time() - self::ATTEMPT_WINDOW);

        $result = DB::selectOne(
            "SELECT COUNT(*) as attempt_count, MAX(attempted_at) as last_attempt
             FROM login_attempts
             WHERE identifier = ? AND type = ? AND attempted_at > ? AND success = 0",
            [$identifier, $type, $cutoff]
        );

        $attemptCount = (int)($result->attempt_count ?? 0);
        $lastAttempt = $result->last_attempt ?? null;

        if ($attemptCount >= self::MAX_ATTEMPTS) {
            $lastAttemptTime = $lastAttempt ? strtotime($lastAttempt) : time();
            $lockoutEnd = $lastAttemptTime + self::LOCKOUT_DURATION;
            $retryAfter = $lockoutEnd - time();

            if ($retryAfter > 0) {
                return [
                    'limited' => true,
                    'remaining_attempts' => 0,
                    'retry_after' => $retryAfter
                ];
            }
        }

        return [
            'limited' => false,
            'remaining_attempts' => max(0, self::MAX_ATTEMPTS - $attemptCount),
            'retry_after' => null
        ];
    }

    /**
     * Record a login attempt.
     *
     * @param string $identifier Email or IP address
     * @param string $type       'email' or 'ip'
     * @param bool   $success    Whether the attempt was successful
     */
    public static function recordAttempt(string $identifier, string $type = 'email', bool $success = false): void
    {
        self::ensureTableExists();

        $identifier = self::scopeLoginIdentifier($identifier, $type);

        $ip = ClientIp::get();

        DB::insert(
            "INSERT INTO login_attempts (identifier, type, ip_address, success, attempted_at)
             VALUES (?, ?, ?, ?, NOW())",
            [$identifier, $type, $ip, $success ? 1 : 0]
        );

        // On successful login, clear failed attempts for this identifier
        if ($success) {
            self::clearScopedAttempts($identifier, $type);
        }
    }

    /**
     * Clear failed attempts for an identifier (called on successful login).
     */
    public static function clearAttempts(string $identifier, string $type = 'email'): void
    {
        self::clearScopedAttempts(self::scopeLoginIdentifier($identifier, $type), $type);
    }

    private static function clearScopedAttempts(string $identifier, string $type): void
    {
        DB::delete("DELETE FROM login_attempts WHERE identifier = ? AND type = ? AND success = 0", [$identifier, $type]);
    }

    private static function scopeLoginIdentifier(string $identifier, string $type): string
    {
        if ($type !== 'email') {
            return $identifier;
        }

        return self::emailIdentifierFor($identifier, TenantContext::currentId());
    }

    /**
     * The stored login_attempts identifier for an email in a given tenant.
     * Public so the member data export (E-035 F-191) can find a member's own
     * sign-in history without re-deriving the scheme.
     */
    public static function emailIdentifierFor(string $email, ?int $tenantId): string
    {
        // Keep the persisted identifier comfortably inside the legacy
        // VARCHAR(255) column even when the submitted email is at its maximum
        // valid length. The raw address is not needed to enforce or clear the
        // bucket, so a stable digest also avoids retaining it in this table.
        $emailDigest = hash('sha256', mb_strtolower(trim($email)));

        return 'tenant:' . ($tenantId ?? 0) . ':email:' . $emailDigest;
    }

    /**
     * Get formatted retry message for users.
     */
    public static function getRetryMessage(int $retryAfter): string
    {
        $minutes = max(1, (int) ceil($retryAfter / 60));

        return trans_choice('api.too_many_login_attempts_minutes', $minutes, ['count' => $minutes]);
    }

    /**
     * Cleanup old attempts to prevent table bloat.
     */
    private static function cleanupOldAttempts(): void
    {
        // Only cleanup occasionally (1% of requests)
        if (random_int(1, 100) !== 1) {
            return;
        }

        $cutoff = date('Y-m-d H:i:s', time() - (self::ATTEMPT_WINDOW * 4));
        DB::delete("DELETE FROM login_attempts WHERE attempted_at < ?", [$cutoff]);
    }

    /**
     * Ensure the login_attempts table exists.
     */
    private static function ensureTableExists(): void
    {

        if (self::$tableChecked) {
            return;
        }

        DB::statement("
            CREATE TABLE IF NOT EXISTS login_attempts (
                id INT AUTO_INCREMENT PRIMARY KEY,
                identifier VARCHAR(255) NOT NULL,
                type ENUM('email', 'ip') NOT NULL DEFAULT 'email',
                ip_address VARCHAR(45) NOT NULL,
                success TINYINT(1) NOT NULL DEFAULT 0,
                attempted_at DATETIME NOT NULL,
                INDEX idx_identifier_type (identifier, type),
                INDEX idx_attempted_at (attempted_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        ");

        self::$tableChecked = true;
    }

    // ============================================
    // API RATE LIMITING (Cache-based)
    // ============================================

    /**
     * Check and record an API request attempt (cache-based throttling).
     *
     * @param string $key           Unique key (e.g. "api:listings:user:123")
     * @param int    $maxAttempts   Maximum requests allowed in the window
     * @param int    $windowSeconds Time window in seconds
     * @return bool True if request is allowed, false if rate limited
     */
    public static function attempt(string $key, int $maxAttempts = 60, int $windowSeconds = 60): bool
    {
        $state = self::getApiRateLimitState($key, $maxAttempts, $windowSeconds);

        // Store state for header generation
        self::$currentRateLimitState = $state;

        if ($state['remaining'] <= 0) {
            return false;
        }

        // Increment the counter
        self::incrementApiCounter($key, $windowSeconds);

        // Update state after increment
        self::$currentRateLimitState['remaining']--;

        return true;
    }

    /**
     * Get rate limit state without consuming an attempt.
     *
     * @return array{limit: int, remaining: int, reset: int, window: int}
     */
    public static function getApiRateLimitState(string $key, int $maxAttempts = 60, int $windowSeconds = 60): array
    {
        $count = self::getApiCounter($key);
        $windowStart = self::getWindowStart($key, $windowSeconds);
        $resetTime = $windowStart + $windowSeconds;

        return [
            'limit' => $maxAttempts,
            'remaining' => max(0, $maxAttempts - $count),
            'reset' => $resetTime,
            'window' => $windowSeconds,
        ];
    }

    /**
     * Get the current rate limit state from the last attempt() call.
     *
     * @return array|null
     */
    public static function getCurrentState(): ?array
    {
        return self::$currentRateLimitState;
    }

    /**
     * Get the current request count for a key.
     */
    private static function getApiCounter(string $key): int
    {
        // Try APCu first (fastest)
        if (function_exists('apcu_enabled') && apcu_enabled()) {
            $count = apcu_fetch($key);
            return $count === false ? 0 : (int) $count;
        }

        // Fall back to file-based storage
        return self::getFileCounter($key);
    }

    /**
     * Increment the request counter for a key.
     */
    private static function incrementApiCounter(string $key, int $windowSeconds): void
    {
        // Try APCu first
        if (function_exists('apcu_enabled') && apcu_enabled()) {
            if (apcu_exists($key)) {
                apcu_inc($key);
            } else {
                apcu_store($key, 1, $windowSeconds);
            }
            return;
        }

        // Fall back to file-based storage
        self::incrementFileCounter($key, $windowSeconds);
    }

    /**
     * Get the window start time for a key.
     */
    private static function getWindowStart(string $key, int $windowSeconds): int
    {
        $windowKey = $key . ':window';

        if (function_exists('apcu_enabled') && apcu_enabled()) {
            $start = apcu_fetch($windowKey);
            if ($start === false) {
                $start = time();
                apcu_store($windowKey, $start, $windowSeconds);
            }
            return (int) $start;
        }

        return self::getFileWindowStart($key, $windowSeconds);
    }

    // ============================================
    // FILE-BASED RATE LIMITING (Fallback)
    // ============================================

    private static function getCacheDir(): string
    {
        $dir = sys_get_temp_dir() . '/nexus_ratelimit';
        if (!is_dir($dir)) {
            @mkdir($dir, 0755, true);
        }
        return $dir;
    }

    private static function getCacheFile(string $key): string
    {
        return self::getCacheDir() . '/' . md5($key) . '.json';
    }

    private static function getFileCounter(string $key): int
    {
        $file = self::getCacheFile($key);
        if (!file_exists($file)) {
            return 0;
        }

        $data = @json_decode(file_get_contents($file), true);
        if (!$data || !isset($data['count']) || !isset($data['expires'])) {
            return 0;
        }

        if (time() > $data['expires']) {
            @unlink($file);
            return 0;
        }

        return (int) $data['count'];
    }

    private static function incrementFileCounter(string $key, int $windowSeconds): void
    {
        $file = self::getCacheFile($key);
        $data = ['count' => 0, 'expires' => time() + $windowSeconds, 'window_start' => time()];

        if (file_exists($file)) {
            $existing = @json_decode(file_get_contents($file), true);
            if ($existing && isset($existing['expires']) && time() <= $existing['expires']) {
                $data = $existing;
            }
        }

        $data['count']++;
        @file_put_contents($file, json_encode($data), LOCK_EX);
    }

    private static function getFileWindowStart(string $key, int $windowSeconds): int
    {
        $file = self::getCacheFile($key);
        if (!file_exists($file)) {
            return time();
        }

        $data = @json_decode(file_get_contents($file), true);
        if (!$data || !isset($data['window_start']) || !isset($data['expires'])) {
            return time();
        }

        if (time() > $data['expires']) {
            return time();
        }

        return (int) $data['window_start'];
    }

    /**
     * Clean up old rate limit cache files.
     */
    public static function cleanupApiCache(): void
    {
        // Only run 1% of the time
        if (random_int(1, 100) !== 1) {
            return;
        }

        $dir = self::getCacheDir();
        if (!is_dir($dir)) {
            return;
        }

        $files = glob($dir . '/*.json');
        $now = time();

        foreach ($files as $file) {
            $data = @json_decode(file_get_contents($file), true);
            if (!$data || !isset($data['expires']) || $now > $data['expires']) {
                @unlink($file);
            }
        }
    }
}
