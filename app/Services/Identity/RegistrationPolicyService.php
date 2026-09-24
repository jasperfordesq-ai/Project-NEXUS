<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\Identity;

use Illuminate\Support\Facades\DB;

/**
 * RegistrationPolicyService — CRUD for tenant registration policies.
 *
 * Each tenant has at most one active registration policy. If no policy row
 * exists, the system falls back to TenantSettingsService behaviour (backwards
 * compatible with the original open/closed + email_verification + admin_approval model).
 */
class RegistrationPolicyService
{
    /** Valid registration modes */
    public const MODES = [
        'open',
        'open_with_approval',
        'verified_identity',
        'government_id',
        'invite_only',
        'waitlist',
    ];

    /** Modes in which a new member must pass identity verification before using the account. */
    public const IDENTITY_VERIFICATION_MODES = [
        'verified_identity',
        'government_id',
    ];

    /** Valid verification levels */
    public const VERIFICATION_LEVELS = [
        'none',
        'document_only',
        'document_selfie',
        'reusable_digital_id',
        'manual_review',
    ];

    /** Valid post-verification actions */
    public const POST_VERIFICATION_ACTIONS = [
        'activate',
        'admin_approval',
        'limited_access',
        'reject_on_fail',
    ];

    /** Valid fallback modes */
    public const FALLBACK_MODES = [
        'none',
        'admin_review',
        'native_registration',
    ];

    /**
     * Get the registration policy for a tenant. Returns null if none configured.
     *
     * @param int $tenantId
     * @return array|null Policy row or null
     */
    public static function getPolicy(int $tenantId): ?array
    {
        try {
            $row = DB::selectOne(
                "SELECT * FROM tenant_registration_policies WHERE tenant_id = ? AND is_active = 1 LIMIT 1",
                [$tenantId]
            );

            return $row ? (array) $row : null;
        } catch (\Throwable $e) {
            // Table may not exist yet during migration
            \Illuminate\Support\Facades\Log::warning("[RegistrationPolicyService] Failed to read policy for tenant {$tenantId}: " . $e->getMessage());
            return null;
        }
    }

    /**
     * Get the effective registration mode for a tenant.
     * Falls back to TenantSettingsService if no policy row exists.
     *
     * @param int $tenantId
     * @return array Normalized policy array with mode, verification_level, etc.
     */
    public static function getEffectivePolicy(int $tenantId): array
    {
        $policy = self::getPolicy($tenantId);
        $generalRegistrationMode = self::getGeneralRegistrationMode($tenantId);

        if ($policy) {
            $storedMode = (string) ($policy['registration_mode'] ?? '');
            // E-035 F-152: `tenant_registration_policies.registration_mode` is an
            // enum that has never included 'waitlist', and the connection runs
            // non-strict, so saving the waitlist mode stores an empty string.
            // upsertPolicy() only accepts self::MODES, and waitlist is the one
            // MODE the column cannot hold, so an empty stored mode can only be a
            // waitlist save. Read it back as waitlist (which holds new members
            // for an administrator) rather than as an unknown, open-ish mode.
            if ($storedMode === '') {
                $storedMode = 'waitlist';
            } elseif (!in_array($storedMode, self::MODES, true)) {
                $storedMode = 'open_with_approval';
            }

            $effectivePolicy = [
                'registration_mode' => $storedMode,
                'verification_provider' => $policy['verification_provider'],
                'verification_level' => $policy['verification_level'],
                'post_verification' => $policy['post_verification'],
                'fallback_mode' => $policy['fallback_mode'],
                'require_email_verify' => (bool) ($policy['require_email_verify'] ?? false),
                'has_policy' => true,
                'is_closed' => false,
            ];

            if ($generalRegistrationMode === 'closed') {
                return self::closedPolicy($effectivePolicy);
            }

            if (in_array($generalRegistrationMode, ['invite', 'invite_only'], true)) {
                return array_merge($effectivePolicy, [
                    'registration_mode' => 'invite_only',
                    'verification_provider' => null,
                    'verification_level' => 'none',
                    'post_verification' => 'activate',
                    'fallback_mode' => 'none',
                ]);
            }

            return $effectivePolicy;
        }

        // Backwards compatibility: derive policy from legacy TenantSettingsService
        $tss = app(\App\Services\TenantSettingsService::class);
        $adminApproval = $tss->requiresAdminApproval($tenantId);
        $registrationMode = $generalRegistrationMode ?? self::getBareRegistrationMode($tenantId) ?? 'open';
        $emailVerification = $tss->requiresEmailVerification($tenantId);

        $mode = 'open';
        if ($registrationMode === 'closed') {
            $mode = 'closed';
        } elseif (in_array($registrationMode, ['invite', 'invite_only'], true)) {
            $mode = 'invite_only';
        } elseif ($adminApproval) {
            $mode = 'open_with_approval';
        }

        $effectivePolicy = [
            'registration_mode' => $mode,
            'verification_provider' => null,
            'verification_level' => 'none',
            'post_verification' => $adminApproval ? 'admin_approval' : 'activate',
            'fallback_mode' => 'none',
            'require_email_verify' => $emailVerification,
            'has_policy' => false,
            'is_closed' => $mode === 'closed',
        ];

        return $mode === 'closed' ? self::closedPolicy($effectivePolicy) : $effectivePolicy;
    }

    private static function getGeneralRegistrationMode(int $tenantId): ?string
    {
        $mode = app(\App\Services\TenantSettingsService::class)->get($tenantId, 'general.registration_mode');
        return is_string($mode) && $mode !== '' ? $mode : null;
    }

    private static function getBareRegistrationMode(int $tenantId): ?string
    {
        $mode = app(\App\Services\TenantSettingsService::class)->get($tenantId, 'registration_mode');
        return is_string($mode) && $mode !== '' ? $mode : null;
    }

    private static function closedPolicy(array $basePolicy): array
    {
        return array_merge($basePolicy, [
            'registration_mode' => 'closed',
            'verification_provider' => null,
            'verification_level' => 'none',
            'post_verification' => 'activate',
            'fallback_mode' => 'none',
            'is_closed' => true,
        ]);
    }

    /**
     * Create or update the registration policy for a tenant.
     *
     * @param int   $tenantId
     * @param array $data Policy fields
     * @return array The saved policy row
     * @throws \InvalidArgumentException On invalid input
     */
    public static function upsertPolicy(int $tenantId, array $data): array
    {
        $mode = $data['registration_mode'] ?? 'open_with_approval';
        if (!in_array($mode, self::MODES, true)) {
            throw new \InvalidArgumentException("Invalid registration_mode: {$mode}");
        }

        $verificationProvider = $data['verification_provider'] ?? null;
        $verificationLevel = $data['verification_level'] ?? 'none';
        $postVerification = $data['post_verification'] ?? 'activate';
        $fallbackMode = $data['fallback_mode'] ?? 'none';
        $requireEmailVerify = isset($data['require_email_verify']) ? (int)(bool) $data['require_email_verify'] : 1;

        if (!in_array($verificationLevel, self::VERIFICATION_LEVELS, true)) {
            throw new \InvalidArgumentException("Invalid verification_level: {$verificationLevel}");
        }
        if (!in_array($postVerification, self::POST_VERIFICATION_ACTIONS, true)) {
            throw new \InvalidArgumentException("Invalid post_verification: {$postVerification}");
        }
        if (!in_array($fallbackMode, self::FALLBACK_MODES, true)) {
            throw new \InvalidArgumentException("Invalid fallback_mode: {$fallbackMode}");
        }

        // Validate provider exists if verification mode requires it
        if (in_array($mode, ['verified_identity', 'government_id'], true) && $verificationProvider) {
            if (!IdentityProviderRegistry::has($verificationProvider)) {
                throw new \InvalidArgumentException("Unknown verification provider: {$verificationProvider}");
            }
        }

        // Encrypt provider config if provided
        $providerConfig = null;
        if (isset($data['provider_config']) && is_array($data['provider_config'])) {
            $providerConfig = self::encryptConfig($data['provider_config']);
        }

        DB::statement(
            "INSERT INTO tenant_registration_policies
                (tenant_id, registration_mode, verification_provider, verification_level,
                 post_verification, fallback_mode, require_email_verify, provider_config, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
             ON DUPLICATE KEY UPDATE
                registration_mode = VALUES(registration_mode),
                verification_provider = VALUES(verification_provider),
                verification_level = VALUES(verification_level),
                post_verification = VALUES(post_verification),
                fallback_mode = VALUES(fallback_mode),
                require_email_verify = VALUES(require_email_verify),
                provider_config = COALESCE(VALUES(provider_config), provider_config),
                is_active = 1,
                updated_at = CURRENT_TIMESTAMP",
            [
                $tenantId,
                $mode,
                $verificationProvider,
                $verificationLevel,
                $postVerification,
                $fallbackMode,
                $requireEmailVerify,
                $providerConfig,
            ]
        );

        // Sync back to legacy TenantSettingsService for backwards compatibility
        self::syncToLegacySettings($tenantId, $mode, (bool) $requireEmailVerify);

        return self::getPolicy($tenantId);
    }

    /**
     * Whether a registration mode leaves the legacy member-approval gate ON.
     *
     * Only `open_with_approval` keeps admin approval on; every other mode maps
     * to `admin_approval=false` in syncToLegacySettings(). Exposed so callers
     * (e.g. RegistrationPolicyController) can tell — without re-deriving the
     * mapping and drifting from it — whether a policy change would turn member
     * approval OFF, which is a platform-super-admin-only change (F-153).
     */
    public static function modeRequiresApproval(string $mode): bool
    {
        return $mode === 'open_with_approval';
    }

    /**
     * Sync registration policy to legacy tenant_settings for backwards compatibility.
     */
    private static function syncToLegacySettings(int $tenantId, string $mode, bool $requireEmailVerify): void
    {
        $tss = app(\App\Services\TenantSettingsService::class);

        // Map new modes to legacy settings
        $registrationMode = 'open';

        switch ($mode) {
            case 'open':
            case 'open_with_approval':
            case 'verified_identity':
            case 'government_id':
                $registrationMode = 'open';
                break;
            case 'invite_only':
                $registrationMode = 'invite_only';
                break;
        }

        // admin_approval is derived from the mode via the single shared mapping
        // so this and RegistrationPolicyController's F-153 guard never diverge.
        $adminApproval = self::modeRequiresApproval($mode);

        $tss->set($tenantId, 'registration_mode', $registrationMode, 'string');
        $tss->set($tenantId, 'admin_approval', $adminApproval ? 'true' : 'false', 'boolean');
        $tss->set($tenantId, 'email_verification', $requireEmailVerify ? 'true' : 'false', 'boolean');
        $tss->clearCache();
    }

    /**
     * Encrypt provider config JSON for storage at rest.
     *
     * @param array $config
     * @return string Encrypted string
     */
    public static function encryptConfig(array $config): string
    {
        $key = self::deriveEncryptionKey();
        if (!$key) {
            // Fallback: store as JSON (not ideal but prevents data loss)
            \Illuminate\Support\Facades\Log::warning('[RegistrationPolicyService] APP_KEY not set — storing provider_config as plaintext JSON');
            return json_encode($config);
        }

        $plaintext = json_encode($config);
        $iv = random_bytes(12);
        $tag = '';
        $ciphertext = openssl_encrypt($plaintext, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);

        return base64_encode($iv . $tag . $ciphertext);
    }

    /**
     * Decrypt provider config from storage.
     *
     * @param string $encrypted
     * @return array Decoded config
     */
    public static function decryptConfig(string $encrypted): array
    {
        $derivedKey = self::deriveEncryptionKey();
        if (!$derivedKey) {
            // Try JSON decode as fallback
            $decoded = json_decode($encrypted, true);
            return is_array($decoded) ? $decoded : [];
        }

        $raw = base64_decode($encrypted);
        if ($raw === false || strlen($raw) < 28) {
            return [];
        }

        $iv = substr($raw, 0, 12);
        $tag = substr($raw, 12, 16);
        $ciphertext = substr($raw, 28);

        // Try derived key first (new format)
        $plaintext = openssl_decrypt($ciphertext, 'aes-256-gcm', $derivedKey, OPENSSL_RAW_DATA, $iv, $tag);

        // Backward compatibility: try raw APP_KEY for data encrypted before the fix
        if ($plaintext === false) {
            $rawKey = \App\Core\Env::get('APP_KEY');
            if ($rawKey) {
                $plaintext = openssl_decrypt($ciphertext, 'aes-256-gcm', $rawKey, OPENSSL_RAW_DATA, $iv, $tag);
            }
        }

        if ($plaintext === false) {
            \Illuminate\Support\Facades\Log::warning('[RegistrationPolicyService] Failed to decrypt provider_config');
            return [];
        }

        $decoded = json_decode($plaintext, true);
        return is_array($decoded) ? $decoded : [];
    }

    /**
     * Derive a consistent 32-byte encryption key from APP_KEY.
     *
     * AES-256-GCM requires exactly 32 bytes. APP_KEY may be a "base64:..." string
     * of variable length, so we hash it to get a consistent 32-byte key.
     *
     * @return string|null 32-byte binary key, or null if APP_KEY is not set
     */
    private static function deriveEncryptionKey(): ?string
    {
        $appKey = \App\Core\Env::get('APP_KEY');
        if (!$appKey) {
            return null;
        }

        return hash('sha256', $appKey, true);
    }
}
