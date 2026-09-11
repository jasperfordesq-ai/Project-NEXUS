<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use OTPHP\TOTP;
use App\Core\TotpEncryption;
use Endroid\QrCode\Builder\Builder;
use Endroid\QrCode\Encoding\Encoding;
use Endroid\QrCode\ErrorCorrectionLevel;
use Endroid\QrCode\Writer\SvgWriter;

/**
 * TotpService — Laravel DI-based TOTP two-factor authentication service.
 *
 * Handles TOTP secrets, backup codes, trusted devices, and rate limiting.
 * Self-contained — no legacy delegation.
 */
class TotpService
{
    private const BACKUP_CODE_LENGTH = 8;
    private const MAX_ATTEMPTS = 5;
    private const LOCKOUT_SECONDS = 900; // 15 minutes
    private const ISSUER = 'Project NEXUS';
    private const TRUSTED_DEVICE_COOKIE = 'nexus_trusted_device';

    /**
     * Generate a new TOTP secret.
     */
    public static function generateSecret(): string
    {
        $totp = TOTP::generate();
        return $totp->getSecret();
    }

    /**
     * Get the provisioning URI for authenticator apps.
     */
    public static function getProvisioningUri(string $secret, string $email, ?string $issuer = null): string
    {
        $totp = TOTP::createFromSecret($secret);
        $totp->setLabel($email);
        $totp->setIssuer($issuer ?? self::ISSUER);
        return $totp->getProvisioningUri();
    }

    /**
     * Generate a QR code SVG for the provisioning URI.
     */
    public static function generateQrCode(string $provisioningUri): string
    {
        $builder = new Builder(
            writer: new SvgWriter(),
            data: $provisioningUri,
            encoding: new Encoding('UTF-8'),
            errorCorrectionLevel: ErrorCorrectionLevel::Medium,
            size: 200,
            margin: 10
        );

        $result = $builder->build();
        return $result->getString();
    }

    /**
     * Verify a TOTP code against a secret.
     */
    public static function verifyCode(string $secret, string $code, int $window = 1): bool
    {
        return self::matchingStep($secret, $code, $window) !== null;
    }

    /** Resolve the accepted 30-second step; OTPHP's verify leeway is seconds. */
    private static function matchingStep(string $secret, string $code, int $window = 1): ?int
    {
        if (preg_match('/^[0-9]{6}$/D', $code) !== 1) {
            return null;
        }
        $totp = TOTP::createFromSecret($secret);
        $step = intdiv(now()->getTimestamp(), $totp->getPeriod());
        for ($offset = -$window; $offset <= $window; $offset++) {
            $candidate = $step + $offset;
            if ($candidate >= 0 && hash_equals($totp->at($candidate * $totp->getPeriod()), $code)) {
                return $candidate;
            }
        }
        return null;
    }

    /** Pending enrollment must not survive a password change or logout-all. */
    private static function revocationVersion(int $userId): int
    {
        $row = DB::selectOne('SELECT UNIX_TIMESTAMP(revoked_at) AS version FROM revoked_tokens WHERE jti = ?',
            ['global_revoke_' . $userId]);
        return (int) ($row->version ?? 0);
    }

    /**
     * Check if user is rate limited for 2FA attempts.
     *
     * @return array{limited: bool, retry_after: int|null, message: string|null}
     */
    public static function checkRateLimit(int $userId, ?int $tenantId = null): array
    {
        $tenantId = self::resolveTenantId($tenantId);
        $cutoff = date('Y-m-d H:i:s', time() - self::LOCKOUT_SECONDS);

        $result = DB::selectOne(
            "SELECT COUNT(*) as attempts FROM totp_verification_attempts
             WHERE user_id = ? AND tenant_id = ? AND is_successful = 0 AND attempted_at > ?",
            [$userId, $tenantId, $cutoff]
        );
        $attempts = (int) ($result->attempts ?? 0);

        if ($attempts >= self::MAX_ATTEMPTS) {
            $oldest = DB::selectOne(
                "SELECT MIN(attempted_at) as oldest FROM totp_verification_attempts
                 WHERE user_id = ? AND tenant_id = ? AND is_successful = 0 AND attempted_at > ?",
                [$userId, $tenantId, $cutoff]
            );
            $oldestTime = strtotime($oldest->oldest ?? 'now');
            $retryAfter = $oldestTime + self::LOCKOUT_SECONDS - time();

            return [
                'limited' => true,
                'retry_after' => max(0, $retryAfter),
                'message' => __('svc_notifications.totp.rate_limited', ['minutes' => ceil($retryAfter / 60)]),
            ];
        }

        return ['limited' => false, 'retry_after' => null, 'message' => null];
    }

    /**
     * Check if user has 2FA enabled.
     */
    public static function isEnabled(int $userId, ?int $tenantId = null): bool
    {
        $tenantId = self::resolveTenantId($tenantId);

        $result = DB::selectOne(
            "SELECT is_enabled FROM user_totp_settings
             WHERE user_id = ? AND tenant_id = ?",
            [$userId, $tenantId]
        );

        return (bool) ($result->is_enabled ?? false);
    }

    /**
     * Check if current device is trusted for this user.
     *
     * Browsers present an HttpOnly cookie. Stateless clients may present the
     * explicit header; every credential remains user- and tenant-bound.
     */
    public static function isTrustedDevice(int $userId, ?string $deviceHash = null, ?int $tenantId = null): bool
    {
        $tenantId = self::resolveTenantId($tenantId);
        $config = app(AuthenticationConfigurationService::class)->getAll($tenantId);
        if (empty($config['two_factor.allow_trusted_devices'])) {
            return false;
        }

        // Browsers use the HttpOnly cookie. Stateless native clients cannot
        // rely on a shared cookie jar, so only they may use the explicit header.
        $token = request()->cookie(self::TRUSTED_DEVICE_COOKIE);
        if (! $token && (request()->hasHeader('X-Nexus-Mobile') || request()->hasHeader('X-Stateless-Auth'))) {
            $token = request()->header('X-Trusted-Device');
        }
        if (!$token) {
            return false;
        }

        $tokenHash = hash('sha256', $token);

        $device = DB::selectOne(
            "SELECT id FROM user_trusted_devices
             WHERE user_id = ? AND tenant_id = ? AND device_token_hash = ?
             AND is_revoked = 0 AND expires_at > NOW()",
            [$userId, $tenantId, $tokenHash]
        );

        if ($device) {
            DB::update(
                "UPDATE user_trusted_devices SET last_used_at = NOW() WHERE id = ?",
                [$device->id]
            );
            return true;
        }

        return false;
    }

    /**
     * Trust the current device for this user.
     *
     * Returns the plain token to the controller, which puts it in an HttpOnly
     * browser cookie or the native client's secure-storage response.
     */
    public static function trustDevice(int $userId, ?string $deviceHash = null, ?int $tenantId = null): ?string
    {
        $tenantId = self::resolveTenantId($tenantId);
        $config = app(AuthenticationConfigurationService::class)->getAll($tenantId);
        if (empty($config['two_factor.allow_trusted_devices'])) {
            return null;
        }

        $token = bin2hex(random_bytes(32));
        $tokenHash = hash('sha256', $token);

        $ip = request()->ip();
        $userAgent = request()->userAgent();
        $deviceName = self::parseDeviceName($userAgent);
        $trustedDeviceDays = (int) ($config['two_factor.trusted_device_days'] ?? 30);
        $expiresAt = date('Y-m-d H:i:s', time() + ($trustedDeviceDays * 24 * 60 * 60));

        try {
            DB::insert(
                "INSERT INTO user_trusted_devices
                 (user_id, tenant_id, device_token_hash, device_name, ip_address, user_agent, expires_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)",
                [$userId, $tenantId, $tokenHash, $deviceName, $ip, $userAgent, $expiresAt]
            );

            return $token;
        } catch (\Exception $e) {
            Log::error("Failed to trust device for user $userId: " . $e->getMessage());
            return null;
        }
    }

    /**
     * Verify 2FA during login.
     *
     * @return array{success: bool, error?: string}
     */
    public static function verifyLogin(int $userId, string $code, ?int $tenantId = null): array
    {
        $tenantId = self::resolveTenantId($tenantId);

        $rateLimit = self::checkRateLimit($userId, $tenantId);
        if ($rateLimit['limited']) {
            return ['success' => false, 'error' => $rateLimit['message']];
        }

        $settings = DB::selectOne(
            "SELECT totp_secret_encrypted FROM user_totp_settings
             WHERE user_id = ? AND tenant_id = ? AND is_enabled = 1",
            [$userId, $tenantId]
        );

        if (!$settings) {
            return ['success' => false, 'error' => '2FA not enabled for this account.'];
        }

        try {
            $secret = TotpEncryption::decrypt($settings->totp_secret_encrypted);
        } catch (\Exception $e) {
            Log::error("TOTP decrypt error for user $userId: " . $e->getMessage());
            return ['success' => false, 'error' => 'Authentication error. Please contact support.'];
        }

        $step = self::matchingStep($secret, $code);
        if ($step === null) {
            self::recordAttempt($userId, false, 'totp', 'invalid_code', $tenantId);
            return ['success' => false, 'error' => 'Invalid code. Please try again.'];
        }

        $consumed = DB::update(
            "UPDATE user_totp_settings SET
                last_verified_at = NOW(),
                last_used_step = ?,
                verified_device_count = verified_device_count + 1
             WHERE user_id = ? AND tenant_id = ? AND is_enabled = 1
               AND totp_secret_encrypted = ?
               AND (last_used_step IS NULL OR last_used_step < ?)",
            [$step, $userId, $tenantId, $settings->totp_secret_encrypted, $step]
        );

        if ($consumed !== 1) {
            self::recordAttempt($userId, false, 'totp', 'replayed_code', $tenantId);
            return ['success' => false, 'error' => __('api.validation_failed')];
        }

        self::recordAttempt($userId, true, 'totp', null, $tenantId);

        return ['success' => true];
    }

    /**
     * Verify a backup code during login.
     *
     * @return array{success: bool, error?: string, codes_remaining?: int}
     */
    public static function verifyBackupCode(int $userId, string $code, ?int $tenantId = null): array
    {
        $tenantId = self::resolveTenantId($tenantId);

        $rateLimit = self::checkRateLimit($userId, $tenantId);
        if ($rateLimit['limited']) {
            return ['success' => false, 'error' => $rateLimit['message']];
        }

        $normalizedCode = strtoupper(str_replace(['-', ' '], '', $code));

        $codes = DB::select(
            "SELECT id, code_hash FROM user_backup_codes
             WHERE user_id = ? AND tenant_id = ? AND is_used = 0",
            [$userId, $tenantId]
        );

        $matchedCodeId = null;
        foreach ($codes as $backupCode) {
            if (password_verify($normalizedCode, $backupCode->code_hash)) {
                $matchedCodeId = $backupCode->id;
                break;
            }
        }

        if (!$matchedCodeId) {
            self::recordAttempt($userId, false, 'backup_code', 'invalid_backup_code', $tenantId);
            return ['success' => false, 'error' => 'Invalid backup code.'];
        }

        $ip = request()->ip();
        $userAgent = request()->userAgent();

        $consumed = DB::update(
            "UPDATE user_backup_codes SET
                is_used = 1,
                used_at = NOW(),
                used_ip = ?,
                used_user_agent = ?
             WHERE id = ?
               AND user_id = ?
               AND tenant_id = ?
               AND is_used = 0",
            [$ip, $userAgent, $matchedCodeId, $userId, $tenantId]
        );

        // Another verifier may have matched the same unused snapshot. The
        // conditional update is the single-use boundary: only its winner may
        // authenticate with this code.
        if ($consumed !== 1) {
            self::recordAttempt($userId, false, 'backup_code', 'backup_code_already_used', $tenantId);
            return ['success' => false, 'error' => 'Invalid backup code.'];
        }

        $remaining = DB::selectOne(
            "SELECT COUNT(*) as remaining FROM user_backup_codes
             WHERE user_id = ? AND tenant_id = ? AND is_used = 0",
            [$userId, $tenantId]
        );

        self::recordAttempt($userId, true, 'backup_code', null, $tenantId);

        return ['success' => true, 'codes_remaining' => (int) ($remaining->remaining ?? 0)];
    }

    /**
     * Check if user needs to set up 2FA (tenant requirement).
     */
    public static function isSetupRequired(int $userId): bool
    {
        $user = DB::selectOne(
            "SELECT totp_setup_required FROM users WHERE id = ? AND tenant_id = ?",
            [$userId, TenantContext::getId()]
        );

        return (bool) ($user->totp_setup_required ?? true);
    }

    /**
     * Get the count of remaining unused backup codes.
     */
    public static function getBackupCodeCount(int $userId): int
    {
        $tenantId = TenantContext::getId();

        $result = DB::selectOne(
            "SELECT COUNT(*) as count FROM user_backup_codes
             WHERE user_id = ? AND tenant_id = ? AND is_used = 0",
            [$userId, $tenantId]
        );

        return (int) ($result->count ?? 0);
    }

    /**
     * Get count of active trusted devices for a user.
     */
    public static function getTrustedDeviceCount(int $userId): int
    {
        $tenantId = TenantContext::getId();

        $result = DB::selectOne(
            "SELECT COUNT(*) as count FROM user_trusted_devices
             WHERE user_id = ? AND tenant_id = ? AND is_revoked = 0 AND expires_at > NOW()",
            [$userId, $tenantId]
        );

        return (int) ($result->count ?? 0);
    }

    /**
     * Initialize 2FA setup for a user (generates secret, stores as pending).
     *
     * @return array{secret: string, provisioning_uri: string, qr_code: string}
     */
    public static function initializeSetup(int $userId, ?int $tenantId = null): array
    {
        $tenantId = self::resolveTenantId($tenantId);
        return DB::transaction(function () use ($userId, $tenantId): array {
            $user = DB::table('users')->where('id', $userId)->where('tenant_id', $tenantId)
                ->lockForUpdate()->first(['email']);

            if (!$user) {
                throw new \RuntimeException('User not found');
            }

            $settings = DB::table('user_totp_settings')->where('user_id', $userId)
                ->where('tenant_id', $tenantId)->first();
            if ($settings && $settings->is_enabled) {
                throw new \RuntimeException('Two-factor authentication is already enabled.');
            }
            // Refreshing or retrying the accessible setup page must keep the secret
            // already scanned into the authenticator. The user lock also prevents
            // setup racing with confirmation or credential recovery.
            $revocationVersion = self::revocationVersion($userId);
            $secret = $settings && $settings->is_pending_setup
                && (int) $settings->setup_revocation_version === $revocationVersion
                ? TotpEncryption::decrypt($settings->totp_secret_encrypted)
                : self::generateSecret();
            $encryptedSecret = TotpEncryption::encrypt($secret);

            DB::insert(
                "INSERT INTO user_totp_settings
                 (user_id, tenant_id, totp_secret_encrypted, is_enabled, is_pending_setup, setup_revocation_version)
                 VALUES (?, ?, ?, 0, 1, ?)
                 ON DUPLICATE KEY UPDATE
                    totp_secret_encrypted = VALUES(totp_secret_encrypted),
                    is_enabled = 0,
                    is_pending_setup = 1,
                    setup_revocation_version = VALUES(setup_revocation_version),
                    updated_at = NOW()",
                [$userId, $tenantId, $encryptedSecret, $revocationVersion]
            );

            // Keep users.totp_enabled in sync — without this, abandoning a re-setup
            // leaves the user locked out (login requires 2FA, verify rejects it).
            DB::update(
                "UPDATE users SET totp_enabled = 0 WHERE id = ? AND tenant_id = ?",
                [$userId, $tenantId]
            );

            $provisioningUri = self::getProvisioningUri($secret, $user->email);
            $qrCode = self::generateQrCode($provisioningUri);

            return [
                'secret' => $secret,
                'provisioning_uri' => $provisioningUri,
                'qr_code' => $qrCode,
            ];
        });
    }

    /**
     * Complete 2FA setup after user verifies the code.
     *
     * @return array{success: bool, error?: string, backup_codes?: array}
     */
    public static function completeSetup(int $userId, string $code, ?int $tenantId = null): array
    {
        $tenantId = self::resolveTenantId($tenantId);

        return DB::transaction(function () use ($userId, $code, $tenantId): array {
            $user = DB::table('users')->where('id', $userId)->where('tenant_id', $tenantId)
                ->lockForUpdate()->first(['id']);
            if (!$user) {
                return ['success' => false, 'error' => __('api.user_not_found')];
            }

            $rateLimit = self::checkRateLimit($userId, $tenantId);
            if ($rateLimit['limited']) {
                return ['success' => false, 'error' => $rateLimit['message']];
            }

            $settings = DB::selectOne(
                "SELECT totp_secret_encrypted, setup_revocation_version FROM user_totp_settings
                 WHERE user_id = ? AND tenant_id = ? AND is_pending_setup = 1",
                [$userId, $tenantId]
            );

            if (!$settings) {
                return ['success' => false, 'error' => '2FA setup not initialized. Please start over.'];
            }
            if ((int) $settings->setup_revocation_version !== self::revocationVersion($userId)) {
                return ['success' => false, 'error' => __('api.session_expired')];
            }

            try {
                $secret = TotpEncryption::decrypt($settings->totp_secret_encrypted);
            } catch (\Exception $e) {
                Log::error("TOTP decrypt error for user $userId: " . $e->getMessage());
                return ['success' => false, 'error' => 'Encryption error. Please start setup again.'];
            }

            $step = self::matchingStep($secret, $code);
            if ($step === null) {
                self::recordAttempt($userId, false, 'totp', 'invalid_code_during_setup', $tenantId);
                return ['success' => false, 'error' => 'Invalid code. Please check the code and try again.'];
            }

            DB::beginTransaction();
            try {
                DB::update(
                    "UPDATE user_totp_settings SET
                        is_enabled = 1,
                        is_pending_setup = 0,
                        enabled_at = NOW(),
                        last_verified_at = NOW(),
                        last_used_step = ?,
                        verified_device_count = verified_device_count + 1
                     WHERE user_id = ? AND tenant_id = ?",
                    [$step, $userId, $tenantId]
                );

                DB::update(
                    "UPDATE users SET totp_enabled = 1, totp_setup_required = 0 WHERE id = ? AND tenant_id = ?",
                    [$userId, $tenantId]
                );

                $backupCodes = self::generateBackupCodes($userId, $tenantId);

                self::recordAttempt($userId, true, 'totp', null, $tenantId);

                DB::commit();

                return ['success' => true, 'backup_codes' => $backupCodes];
            } catch (\Exception $e) {
                DB::rollBack();
                Log::error("TOTP setup error for user $userId: " . $e->getMessage());
                return ['success' => false, 'error' => 'Failed to enable 2FA. Please try again.'];
            }
        });
    }

    /**
     * Disable 2FA for a user (requires password confirmation).
     *
     * @return array{success: bool, error?: string}
     */
    public static function disable(int $userId, string $password = ''): array
    {
        $tenantId = (int) TenantContext::getId();

        try {
            $disableOutcome = DB::transaction(function () use ($userId, $tenantId, $password): string {
                // Match every other credential mutation's lock order: acquire
                // the tenant user row first, then authoritatively re-check the
                // password before touching factor or session state.
                $user = DB::table('users')
                    ->where('id', $userId)
                    ->where('tenant_id', $tenantId)
                    ->lockForUpdate()
                    ->first();
                if ($user === null || !is_string($user->password_hash)) {
                    return 'invalid_password';
                }
                if (!password_verify($password, $user->password_hash)) {
                    return 'invalid_password';
                }

                if (app(TwoFactorPolicy::class)->required($user)) {
                    return 'mfa_required';
                }

                DB::delete("DELETE FROM user_totp_settings WHERE user_id = ? AND tenant_id = ?", [$userId, $tenantId]);
                DB::delete("DELETE FROM user_backup_codes WHERE user_id = ? AND tenant_id = ?", [$userId, $tenantId]);
                DB::update(
                    "UPDATE user_trusted_devices
                     SET is_revoked = 1, revoked_at = NOW(), revoked_reason = 'two_factor_disabled'
                     WHERE user_id = ? AND tenant_id = ? AND is_revoked = 0",
                    [$userId, $tenantId]
                );
                DB::update(
                    "UPDATE users SET totp_enabled = 0, totp_setup_required = 1
                     WHERE id = ? AND tenant_id = ?",
                    [$userId, $tenantId]
                );

                // Removing an authentication factor is a session boundary.
                // A failed durable revocation aborts and rolls the factor
                // removal back rather than reporting an unsafe success.
                if (app(TokenService::class)->revokeAllTokensForUser(
                    $userId,
                    'two_factor_disabled'
                ) < 1) {
                    throw new \RuntimeException('Unable to revoke sessions after disabling two-factor authentication.');
                }

                return 'disabled';
            }, 3);
        } catch (\Throwable $e) {
            Log::error("TOTP disable error for user $userId: " . $e->getMessage());
            return ['success' => false, 'error' => 'Failed to disable 2FA.'];
        }

        if ($disableOutcome === 'mfa_required') {
            return ['success' => false, 'error' => __('mfa.disable_forbidden')];
        }
        if ($disableOutcome !== 'disabled') {
            return ['success' => false, 'error' => 'Invalid password.'];
        }

        return ['success' => true];
    }

    public static function trustedDeviceCookieName(): string
    {
        return self::TRUSTED_DEVICE_COOKIE;
    }

    public static function trustedDeviceLifetimeMinutes(int $tenantId): int
    {
        $config = app(AuthenticationConfigurationService::class)->getAll($tenantId);
        return max(1, (int) ($config['two_factor.trusted_device_days'] ?? 30)) * 1440;
    }

    /**
     * Generate backup codes for a user.
     *
     * @return array  List of plain-text backup codes
     */
    public static function generateBackupCodes(int $userId, ?int $tenantId = null): array
    {
        $tenantId = self::resolveTenantId($tenantId);
        $config = app(AuthenticationConfigurationService::class)->getAll($tenantId);
        $backupCodeCount = (int) ($config['two_factor.backup_code_count'] ?? 10);

        DB::delete("DELETE FROM user_backup_codes WHERE user_id = ? AND tenant_id = ? AND is_used = 0", [$userId, $tenantId]);

        $codes = [];
        for ($i = 0; $i < $backupCodeCount; $i++) {
            $code = self::generateRandomCode();
            $normalizedCode = str_replace('-', '', $code);
            $hash = password_hash($normalizedCode, PASSWORD_DEFAULT);

            DB::insert(
                "INSERT INTO user_backup_codes (user_id, tenant_id, code_hash) VALUES (?, ?, ?)",
                [$userId, $tenantId, $hash]
            );

            $codes[] = $code;
        }

        return $codes;
    }

    /** Notify after committed security maintenance, in the recipient's locale. */
    public static function notifySecurityChange(int $userId, int $tenantId): void
    {
        try {
            $user = DB::table('users')->where('id', $userId)->where('tenant_id', $tenantId)
                ->first(['id', 'email', 'preferred_language']);
            if (!$user) return;
            TenantContext::runForTenant($tenantId, function () use ($user, $userId, $tenantId): void {
                \App\I18n\LocaleContext::withLocale($user, function () use ($user, $userId, $tenantId): void {
                    $subject = __('emails.mfa_changed.subject');
                    $body = __('emails.mfa_changed.body');
                    \App\Models\Notification::createNotification($userId, $body, '/settings?tab=security', 'security', true);
                    $html = \App\Core\EmailTemplateBuilder::make()->theme('warning')->title($subject)->paragraph($body)->render();
                    if (!EmailDispatchService::sendRaw($user->email, $subject, $html, null, null, null, 'security_alert', ['tenant_id' => $tenantId])) {
                        Log::warning('[2FA] Security-change email was not delivered', ['user_id' => $userId, 'tenant_id' => $tenantId]);
                    }
                });
            });
        } catch (\Throwable $e) {
            Log::warning('[2FA] Security-change notification failed', ['user_id' => $userId, 'tenant_id' => $tenantId, 'exception' => get_class($e)]);
        }
    }

    /**
     * Get all trusted devices for a user.
     */
    public static function getTrustedDevices(int $userId): array
    {
        $tenantId = TenantContext::getId();

        $devices = DB::select(
            "SELECT id, device_name, ip_address, trusted_at, last_used_at, expires_at
             FROM user_trusted_devices
             WHERE user_id = ? AND tenant_id = ? AND is_revoked = 0 AND expires_at > NOW()
             ORDER BY last_used_at DESC",
            [$userId, $tenantId]
        );

        return array_map(fn ($d) => (array) $d, $devices);
    }

    /**
     * Revoke a specific trusted device.
     */
    public static function revokeDevice(int $userId, int $deviceId, string $reason = 'user_action'): bool
    {
        $tenantId = TenantContext::getId();

        $affected = DB::update(
            "UPDATE user_trusted_devices
             SET is_revoked = 1, revoked_at = NOW(), revoked_reason = ?
             WHERE id = ? AND user_id = ? AND tenant_id = ?",
            [$reason, $deviceId, $userId, $tenantId]
        );

        return $affected > 0;
    }

    /**
     * Revoke all trusted devices for a user.
     *
     * @return int  Number of devices revoked
     */
    public static function revokeAllDevices(int $userId, string $reason = 'user_action'): int
    {
        $tenantId = TenantContext::getId();

        $affected = DB::update(
            "UPDATE user_trusted_devices
             SET is_revoked = 1, revoked_at = NOW(), revoked_reason = ?
             WHERE user_id = ? AND tenant_id = ? AND is_revoked = 0",
            [$reason, $userId, $tenantId]
        );

        setcookie(self::TRUSTED_DEVICE_COOKIE, '', time() - 3600, '/');

        return $affected;
    }

    /**
     * Admin: Reset 2FA for a user (with audit logging).
     *
     * @return array{success: bool, error?: string}
     */
    public static function adminReset(int $userId, int $adminId, string $reason): array
    {
        $tenantId = TenantContext::getId();

        if (empty(trim($reason))) {
            return ['success' => false, 'error' => 'A reason is required for 2FA reset.'];
        }

        DB::beginTransaction();
        try {
            $user = DB::table('users')->where('id', $userId)->where('tenant_id', $tenantId)->lockForUpdate()->first();
            if (!$user) {
                DB::rollBack();
                return ['success' => false, 'error' => 'User not found.'];
            }
            $ip = request()->ip();
            $userAgent = request()->userAgent();

            DB::insert(
                "INSERT INTO totp_admin_overrides
                 (user_id, admin_id, tenant_id, action_type, reason, ip_address, user_agent)
                 VALUES (?, ?, ?, 'reset', ?, ?, ?)",
                [$userId, $adminId, $tenantId, $reason, $ip, $userAgent]
            );

            DB::delete("DELETE FROM user_totp_settings WHERE user_id = ? AND tenant_id = ?", [$userId, $tenantId]);
            DB::delete("DELETE FROM user_backup_codes WHERE user_id = ? AND tenant_id = ?", [$userId, $tenantId]);
            DB::update("UPDATE users SET totp_enabled = 0, totp_setup_required = 1 WHERE id = ? AND tenant_id = ?", [$userId, $tenantId]);
            self::revokeAllDevices($userId, 'admin_2fa_reset');
            if (app(TokenService::class)->revokeAllTokensForUser($userId, 'admin_2fa_reset') < 1) {
                throw new \RuntimeException('Session revocation failed.');
            }
            DB::afterCommit(fn () => self::notifySecurityChange($userId, $tenantId));

            DB::commit();
            return ['success' => true];
        } catch (\Exception $e) {
            DB::rollBack();
            Log::error("Admin TOTP reset error for user $userId by admin $adminId: " . $e->getMessage());
            return ['success' => false, 'error' => 'Failed to reset 2FA.'];
        }
    }

    /**
     * Record a 2FA verification attempt.
     */
    public static function recordAttempt(
        int $userId,
        bool $successful,
        string $type = 'totp',
        ?string $failureReason = null,
        ?int $tenantId = null
    ): void
    {
        $tenantId = self::resolveTenantId($tenantId);
        $ip = request()->ip();
        $userAgent = request()->userAgent();

        DB::insert(
            "INSERT INTO totp_verification_attempts
             (user_id, tenant_id, ip_address, user_agent, attempt_type, is_successful, failure_reason)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
            [$userId, $tenantId, $ip, $userAgent, $type, $successful ? 1 : 0, $failureReason]
        );

        if ($successful) {
            DB::delete(
                "DELETE FROM totp_verification_attempts
                 WHERE user_id = ? AND tenant_id = ? AND is_successful = 0",
                [$userId, $tenantId]
            );
        }
    }

    // ─── Private helpers ────────────────────────────────────────────

    /**
     * Resolve an explicit tenant binding, falling back to the active request
     * tenant for authenticated settings flows.
     */
    private static function resolveTenantId(?int $tenantId): int
    {
        $resolved = $tenantId ?? (int) TenantContext::getId();
        if (!$resolved || $resolved < 1) {
            throw new \RuntimeException('A tenant context is required for two-factor authentication.');
        }

        return (int) $resolved;
    }

    /**
     * Generate a random backup code (format: XXXX-XXXX).
     */
    private static function generateRandomCode(): string
    {
        $chars = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
        $code = '';

        for ($i = 0; $i < self::BACKUP_CODE_LENGTH; $i++) {
            $code .= $chars[random_int(0, strlen($chars) - 1)];
        }

        return substr($code, 0, 4) . '-' . substr($code, 4);
    }

    /**
     * Parse user agent string to get a human-readable device name.
     */
    private static function parseDeviceName(?string $userAgent): string
    {
        if (!$userAgent) {
            return 'Unknown device';
        }

        $browser = 'Unknown browser';
        $os = 'Unknown OS';

        if (str_contains($userAgent, 'Firefox')) {
            $browser = 'Firefox';
        } elseif (str_contains($userAgent, 'Edg')) {
            $browser = 'Edge';
        } elseif (str_contains($userAgent, 'Chrome')) {
            $browser = 'Chrome';
        } elseif (str_contains($userAgent, 'Safari')) {
            $browser = 'Safari';
        } elseif (str_contains($userAgent, 'MSIE') || str_contains($userAgent, 'Trident')) {
            $browser = 'Internet Explorer';
        }

        if (str_contains($userAgent, 'iPhone') || str_contains($userAgent, 'iPad')) {
            $os = 'iOS';
        } elseif (str_contains($userAgent, 'Android')) {
            $os = 'Android';
        } elseif (str_contains($userAgent, 'Windows')) {
            $os = 'Windows';
        } elseif (str_contains($userAgent, 'Mac')) {
            $os = 'macOS';
        } elseif (str_contains($userAgent, 'Linux')) {
            $os = 'Linux';
        }

        return "$browser on $os";
    }
}
