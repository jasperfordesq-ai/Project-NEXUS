<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\ApiErrorCodes;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * TenantSettingsService — reads/writes tenant_settings (key-value) table,
 * enforces login gates, and checks registration policy.
 *
 * This service was converted from static to instance methods as part of the TD9
 * service layer DI refactor. Resolve via DI (constructor inject) or
 * `app(TenantSettingsService::class)`. See docs/SERVICE_LAYER.md for the migration pattern.
 */
class TenantSettingsService
{
    private const CACHE_PREFIX = 'tenant_settings:';
    private const CACHE_TTL = 300; // 5 minutes

    public function __construct()
    {
    }

    /**
     * Get a single tenant setting value.
     */
    public function get(int $tenantId, string $key, $default = null)
    {
        $settings = $this->loadAll($tenantId);
        return $settings[$key] ?? $default;
    }

    /**
     * Get a tenant setting as a boolean.
     */
    public function getBool(int $tenantId, string $key, bool $default = false): bool
    {
        $value = $this->get($tenantId, $key);

        if ($value === null) {
            return $default;
        }

        return filter_var($value, FILTER_VALIDATE_BOOLEAN);
    }

    /**
     * Check if admin approval is required for this tenant.
     *
     * Defaults to TRUE (fail-closed). Admin approval is a platform-wide
     * baseline: every tenant — current or future — requires an admin to
     * approve a new account before it can log in. A tenant can opt out
     * explicitly by writing `admin_approval=false` via the admin UI.
     *
     * Reads the bare `admin_approval` key first; falls back to the
     * historical `general.admin_approval` prefix so legacy tenants whose
     * settings were seeded via TenantHierarchyService still resolve.
     */
    public function requiresAdminApproval(int $tenantId): bool
    {
        $value = $this->get($tenantId, 'admin_approval');
        if ($value === null) {
            $value = $this->get($tenantId, 'general.admin_approval');
        }
        if ($value === null) {
            return true;
        }
        return filter_var($value, FILTER_VALIDATE_BOOLEAN);
    }

    /**
     * Check if email verification is required for this tenant.
     *
     * Defaults to TRUE (fail-closed). Email verification is a platform-wide
     * security baseline. Only God (platform super-admin) may disable it.
     *
     * Reads the bare `email_verification` key first; falls back to the
     * historical `general.email_verification` prefix so legacy tenants whose
     * settings were seeded with the old key form still resolve.
     */
    public function requiresEmailVerification(int $tenantId): bool
    {
        $value = $this->get($tenantId, 'email_verification');
        if ($value === null) {
            $value = $this->get($tenantId, 'general.email_verification');
        }
        if ($value === null) {
            return true;
        }
        return filter_var($value, FILTER_VALIDATE_BOOLEAN);
    }

    /**
     * Set a tenant setting value.
     */
    public function set(int $tenantId, string $key, string $value, string $type = 'string'): void
    {
        $existing = DB::selectOne(
            "SELECT id FROM tenant_settings WHERE tenant_id = ? AND setting_key = ?",
            [$tenantId, $key]
        );

        if ($existing) {
            DB::update(
                "UPDATE tenant_settings SET setting_value = ? WHERE tenant_id = ? AND setting_key = ?",
                [$value, $tenantId, $key]
            );
        } else {
            DB::insert(
                "INSERT INTO tenant_settings (tenant_id, setting_key, setting_value, setting_type) VALUES (?, ?, ?, ?)",
                [$tenantId, $key, $value, $type]
            );
        }

        $this->clearCacheForTenant($tenantId);
    }

    /**
     * Get all settings for a tenant.
     */
    public function getAllGeneral(int $tenantId): array
    {
        return $this->loadAll($tenantId);
    }

    /**
     * Clear all cached settings.
     *
     * Cache::forget() does NOT support wildcards — 'tenant_settings:*' is treated
     * as a literal key that never exists, so the old code was a silent no-op.
     * Instead, scan Redis for all matching keys and delete them individually.
     */
    public function clearCache(): void
    {
        try {
            $redis = \Illuminate\Support\Facades\Redis::connection();
            $prefix = config('cache.prefix', '') . ':' . self::CACHE_PREFIX;
            $cursor = '0';

            do {
                [$cursor, $keys] = $redis->scan($cursor, ['match' => $prefix . '*', 'count' => 200]);
                if (!empty($keys)) {
                    $redis->del(...$keys);
                }
            } while ($cursor !== '0' && $cursor !== 0);
        } catch (\Throwable $e) {
            // Ignore cache errors — Redis may be unavailable
        }
    }

    /**
     * Clear cached settings for a specific tenant.
     */
    public function clearCacheForTenant(int $tenantId): void
    {
        Cache::forget(self::CACHE_PREFIX . $tenantId);

        // FormattingLocale memoises the resolved region per tenant in-process
        // (general.region, else tenants.country_code). Clearing the settings
        // cache without clearing that would leave a queue worker formatting
        // dates with the region the admin just changed away from.
        \App\I18n\FormattingLocale::forgetTenant($tenantId);
    }

    /**
     * Check if registration is open for a tenant.
     *
     * Reads the admin `general.registration_mode` kill switch first, then the
     * legacy bare key. Defaults to 'open' if neither is set.
     */
    public function isRegistrationOpen(int $tenantId): bool
    {
        $mode = $this->get($tenantId, 'general.registration_mode');
        if ($mode === null) {
            $mode = $this->get($tenantId, 'registration_mode', 'open');
        }

        return $mode === 'open';
    }

    /**
     * Check login gates for a user array.
     *
     * Every non-active account state is blocked for every role.
     * Admins and super admins otherwise pass policy gates. Regular members may be blocked by:
     * - Pending/failed identity verification
     * - Unapproved account
     * - Unverified email when email_verification is required
     *
     * @param array $user User row (must include: role, is_super_admin, is_tenant_super_admin, tenant_id)
     * @return array|null Null = passes, or ['code' => ..., 'message' => ..., 'extra' => [...]]
     */
    public function checkLoginGates(array $user): ?array
    {
        return $this->checkLoginGatesForUser($user);
    }

    /**
     * Check login gates for a specific user array.
     *
     * @param array $user User row from DB
     * @return array|null Null = passes, or error array
     */
    public function checkLoginGatesForUser(array $user): ?array
    {
        $role = $user['role'] ?? 'member';
        $isSuperAdmin = !empty($user['is_super_admin']);
        $isTenantSuperAdmin = !empty($user['is_tenant_super_admin']);
        $status = strtolower(trim((string)($user['status'] ?? 'active')));

        if (in_array($status, ['suspended', 'banned'], true)) {
            return [
                'code' => ApiErrorCodes::AUTH_ACCOUNT_SUSPENDED,
                'message' => __('api.account_suspended'),
                'extra' => ['account_suspended' => true],
            ];
        }

        if ($status === 'pending') {
            // A sign-up held for identity verification is also 'pending'; tell
            // the member which of the two things they are waiting for.
            if (($user['verification_status'] ?? null) === 'pending') {
                return [
                    'code' => 'AUTH_PENDING_VERIFICATION',
                    'message' => __('svc_notifications_2.tenant_settings.pending_verification'),
                    'extra' => ['pending_verification' => true],
                ];
            }

            return [
                'code' => ApiErrorCodes::AUTH_ACCOUNT_PENDING_APPROVAL,
                'message' => __('svc_notifications_2.tenant_settings.pending_admin_approval'),
                'extra' => ['pending_approval' => true],
            ];
        }

        if ($status !== 'active') {
            return [
                'code' => ApiErrorCodes::AUTH_ACCOUNT_SUSPENDED,
                'message' => __('api.account_suspended'),
                'extra' => ['account_suspended' => true],
            ];
        }

        // Admins and super admins always pass login gates
        if (in_array($role, ['admin', 'tenant_admin', 'super_admin', 'god'], true)
            || $isSuperAdmin
            || $isTenantSuperAdmin
        ) {
            return null;
        }

        $tenantId = (int)($user['tenant_id'] ?? 0);
        $verificationStatus = $user['verification_status'] ?? null;

        if (array_key_exists('is_approved', $user) && empty($user['is_approved'])) {
            return $this->unverifiedIdentityGate($tenantId, $verificationStatus) ?? [
                'code' => ApiErrorCodes::AUTH_ACCOUNT_PENDING_APPROVAL,
                'message' => __('svc_notifications_2.tenant_settings.pending_admin_approval'),
                'extra' => ['pending_approval' => true],
            ];
        }

        // Check identity verification status (if present)
        if ($verificationStatus === 'pending') {
            return [
                'code' => 'AUTH_PENDING_VERIFICATION',
                'message' => __('svc_notifications_2.tenant_settings.pending_verification'),
                'extra' => ['pending_verification' => true],
            ];
        }
        if ($verificationStatus === 'failed') {
            return [
                'code' => 'AUTH_VERIFICATION_FAILED',
                'message' => __('svc_notifications_2.tenant_settings.verification_failed'),
                'extra' => ['verification_failed' => true],
            ];
        }

        // Check email verification requirement
        if ($tenantId > 0 && $this->requiresEmailVerification($tenantId)) {
            if (empty($user['email_verified_at'])) {
                return [
                    'code' => 'AUTH_EMAIL_NOT_VERIFIED',
                    'message' => __('svc_notifications_2.tenant_settings.email_not_verified'),
                    'extra' => ['email_not_verified' => true],
                ];
            }
        }

        // Check admin approval requirement for callers that do not include is_approved.
        // Uses requiresAdminApproval() so the fail-closed default + legacy-key
        // fallback are honoured consistently with the email-verify gate.
        if ($tenantId > 0 && $this->requiresAdminApproval($tenantId)) {
            if (empty($user['is_approved'])) {
                return [
                    'code' => ApiErrorCodes::AUTH_ACCOUNT_PENDING_APPROVAL,
                    'message' => __('svc_notifications_2.tenant_settings.pending_admin_approval'),
                    'extra' => ['pending_approval' => true],
                ];
            }
        }

        return null;
    }

    /**
     * Whether the tenant's effective registration policy requires identity
     * verification before a new member may use the account.
     */
    public function communityRequiresIdentityVerification(int $tenantId): bool
    {
        if ($tenantId <= 0) {
            return false;
        }

        $mode = \App\Services\Identity\RegistrationPolicyService::getEffectivePolicy($tenantId)['registration_mode'] ?? 'open';

        return in_array($mode, \App\Services\Identity\RegistrationPolicyService::IDENTITY_VERIFICATION_MODES, true);
    }

    /**
     * The registration hold, if any, that email verification alone must not
     * release: 'identity' (verified_identity / government_id) or 'waitlist'.
     *
     * E-035 F-152: in these modes the email/password path used to approve and
     * activate the account the moment the email was verified, so the policy's
     * identity check or waitlist was never applied.
     */
    public function registrationActivationHold(int $tenantId): ?string
    {
        if ($tenantId <= 0) {
            return null;
        }

        $mode = \App\Services\Identity\RegistrationPolicyService::getEffectivePolicy($tenantId)['registration_mode'] ?? 'open';
        if (in_array($mode, \App\Services\Identity\RegistrationPolicyService::IDENTITY_VERIFICATION_MODES, true)) {
            return 'identity';
        }

        return $mode === 'waitlist' ? 'waitlist' : null;
    }

    /**
     * Refusal for an unapproved account in a verification-required community
     * that has not passed identity verification; null when that does not apply.
     *
     * An already-approved member with no verification record is deliberately
     * NOT refused: switching a community to an ID-verification policy must not
     * lock out the members it approved before the switch.
     *
     * @return array{code:string,message:string,extra:array<string,bool>}|null
     */
    private function unverifiedIdentityGate(int $tenantId, ?string $verificationStatus): ?array
    {
        if ($verificationStatus === 'passed' || !$this->communityRequiresIdentityVerification($tenantId)) {
            return null;
        }

        return [
            'code' => 'AUTH_PENDING_VERIFICATION',
            'message' => __('svc_notifications_2.tenant_settings.pending_verification'),
            'extra' => ['pending_verification' => true],
        ];
    }

    /**
     * Load all settings for a tenant (with caching).
     */
    private function loadAll(int $tenantId): array
    {
        $cacheKey = self::CACHE_PREFIX . $tenantId;

        try {
            return Cache::remember($cacheKey, self::CACHE_TTL, function () use ($tenantId) {
                return $this->loadAllFromDatabase($tenantId);
            });
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('[TenantSettingsService] cache load failed for tenant ' . $tenantId . ': ' . $e->getMessage());

            try {
                return $this->loadAllFromDatabase($tenantId);
            } catch (\Throwable $fallbackError) {
                // If both cache and DB fail, return empty to avoid blocking login.
                \Illuminate\Support\Facades\Log::warning('[TenantSettingsService] DB fallback failed for tenant ' . $tenantId . ': ' . $fallbackError->getMessage());
                return [];
            }
        }
    }

    private function loadAllFromDatabase(int $tenantId): array
    {
        $rows = DB::select(
            "SELECT setting_key, setting_value FROM tenant_settings WHERE tenant_id = ?",
            [$tenantId]
        );

        $settings = [];
        foreach ($rows as $row) {
            $settings[$row->setting_key] = $row->setting_value;
        }

        return $settings;
    }
}
