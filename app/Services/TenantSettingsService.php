<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\ApiErrorCodes;
use App\Support\Authorization\MinimumAge;
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

    /**
     * The two settings that decide whether a stranger who signs up may use the
     * community, and which are stored under BOTH a bare key and a `general.`-
     * prefixed one.
     *
     * E-073 F-458: the admin Settings page persisted only `general.<key>` while
     * these gates read only the bare `<key>` unless it was NULL — and two live
     * paths (TenantHierarchyService's community seed, RegistrationPolicyService's
     * policy save) write the bare key, so on most communities the administrator's
     * toggle was inert. Writing either name through set() now writes the other
     * name with it (AdminConfigController::updateSettings() does the same for
     * its own raw upsert), and gateSettingIsRequired() resolves any historical
     * disagreement in the SAFE direction.
     */
    public const DUAL_KEY_GATE_SETTINGS = ['admin_approval', 'email_verification'];

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
     * Resolved from BOTH the bare `admin_approval` key and the historical
     * `general.admin_approval` prefix — see gateSettingIsRequired().
     */
    public function requiresAdminApproval(int $tenantId): bool
    {
        return $this->gateSettingIsRequired($tenantId, 'admin_approval');
    }

    /**
     * Check if email verification is required for this tenant.
     *
     * Defaults to TRUE (fail-closed). Email verification is a platform-wide
     * security baseline. Only God (platform super-admin) may disable it.
     *
     * Resolved from BOTH the bare `email_verification` key and the historical
     * `general.email_verification` prefix — see gateSettingIsRequired().
     */
    public function requiresEmailVerification(int $tenantId): bool
    {
        return $this->gateSettingIsRequired($tenantId, 'email_verification');
    }

    /**
     * Resolve one of the DUAL_KEY_GATE_SETTINGS from both of its stored keys.
     *
     * Every writer now keeps the bare and `general.`-prefixed rows identical,
     * so for anything written after E-073 F-458 this is simply "read the
     * value". The rule below exists for rows written BEFORE the fix, where the
     * two keys can already disagree, and it deliberately resolves such a
     * disagreement towards screening the new member:
     *
     *  - neither key present  → required (the platform's fail-closed baseline);
     *  - either key says required → required;
     *  - a value that is not a recognisable boolean at all → required, because
     *    "we cannot tell" must never mean "let strangers in";
     *  - required only when every key that IS present plainly says false.
     *
     * Checked against the old bare-key-wins behaviour, this changes the answer
     * in exactly one combination — bare `false` with prefixed `true`, the state
     * an administrator reached by turning the toggle back ON and being ignored.
     * No other combination moves, and none moves in the loosening direction.
     */
    private function gateSettingIsRequired(int $tenantId, string $key): bool
    {
        $sawExplicitOptOut = false;

        foreach ([$key, 'general.' . $key] as $storedKey) {
            $value = $this->get($tenantId, $storedKey);
            if ($value === null) {
                continue;
            }

            if (filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) !== false) {
                return true;
            }

            $sawExplicitOptOut = true;
        }

        return !$sawExplicitOptOut;
    }

    /**
     * The other stored key holding the same gate setting, or null for every
     * setting that is stored under one key only.
     */
    private function gateSettingMirrorKey(string $key): ?string
    {
        if (in_array($key, self::DUAL_KEY_GATE_SETTINGS, true)) {
            return 'general.' . $key;
        }

        $bareKey = substr($key, strlen('general.'));
        if (str_starts_with($key, 'general.')
            && in_array($bareKey, self::DUAL_KEY_GATE_SETTINGS, true)
        ) {
            return $bareKey;
        }

        return null;
    }

    /**
     * Set a tenant setting value.
     *
     * E-073 F-458: the two DUAL_KEY_GATE_SETTINGS are stored under both a bare
     * and a `general.`-prefixed key — the enforcement gates historically read
     * one and the admin Settings page wrote and displayed the other, so a save
     * through either name changed what an administrator was shown without
     * changing what the platform enforced. Writing one of those two names here
     * now writes the other name with it, so the pair cannot drift apart again
     * and no caller has to know that there are two of them.
     */
    public function set(int $tenantId, string $key, string $value, string $type = 'string'): void
    {
        $this->writeSetting($tenantId, $key, $value, $type);

        $mirrorKey = $this->gateSettingMirrorKey($key);
        if ($mirrorKey !== null) {
            $this->writeSetting($tenantId, $mirrorKey, $value, $type);
        }

        $this->clearCacheForTenant($tenantId);
    }

    private function writeSetting(int $tenantId, string $key, string $value, string $type): void
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

        // Adults-only platform (owner decision 2026-09-25, E-035 F-160): an
        // account whose recorded date of birth is under 18 cannot sign in by
        // any door — password, refresh, passkey, 2FA completion, social sign-in
        // and session restore all route through this gate. Deliberately BEFORE
        // the admin bypass below: the minimum age applies to every role. A null
        // date of birth is an adult account (MinimumAge::isUnder).
        if (MinimumAge::userIsUnder($user)) {
            $refusal = MinimumAge::accountRefusal();

            return [
                'code' => $refusal['code'],
                'message' => $refusal['message'],
                'extra' => ['account_under_minimum_age' => true],
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
