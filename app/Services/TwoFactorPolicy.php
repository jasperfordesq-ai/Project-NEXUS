<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Support\Authorization\AdminTier;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Administrators and operational roles cannot opt out; member enforcement belongs to a tenant. */
final class TwoFactorPolicy
{
    public function required(object|array $user): bool
    {
        if ($this->requiredByRole($user)) {
            return true;
        }
        // A security decision must not use the configuration service's fail-open
        // display cache. Read authoritative tenant state; database failure rejects
        // the request rather than silently disabling enforcement.
        $value = DB::table('tenant_settings')
            ->where('tenant_id', (int) data_get($user, 'tenant_id'))
            ->where('setting_key', AuthenticationConfigurationService::CONFIG_TWO_FACTOR_REQUIRE_MEMBERS)
            ->value('setting_value');
        return in_array(strtolower((string) $value), ['true', '1', 'yes'], true);
    }

    /**
     * Mandatory because of the account's own authority (staff), as opposed to a
     * community-wide member mandate. Staff have their own remember-device rule.
     */
    public function requiredByRole(object|array $user): bool
    {
        // Platform routes accept these flags even on operational-role accounts.
        // MFA must cover that authority independently of tenant-admin admission.
        if ((bool) data_get($user, 'is_super_admin', false)
            || (bool) data_get($user, 'is_god', false)
            || AdminTier::allows($user) || data_get($user, 'role') === 'org_admin') {
            return true;
        }
        // Brokers and coordinators adjust balances, reset members' second
        // factor and read broker message review. They are not admin-tier, but
        // that operational authority needs the same second factor (F-057).
        if (in_array((string) data_get($user, 'role', ''), AdminTier::OPERATIONAL_ROLES, true)) {
            return true;
        }
        $tenantId = (int) data_get($user, 'tenant_id');
        // The scoped Verein import grant is admitted by EnsureIsAdmin even
        // for a normal member. Include that administrative authority too.
        if (data_get($user, 'id') && Schema::hasTable('user_roles')
            && DB::table('user_roles as ur')
                ->join('role_permissions as rp', 'rp.role_id', '=', 'ur.role_id')
                ->join('permissions as p', 'p.id', '=', 'rp.permission_id')
                ->where('ur.user_id', (int) data_get($user, 'id'))
                ->where('ur.tenant_id', $tenantId)
                ->where('p.name', 'verein.members.import')
                ->where(fn ($q) => $q->where('rp.tenant_id', $tenantId)->orWhereNull('rp.tenant_id'))
                ->where(fn ($q) => $q->where('p.tenant_id', $tenantId)->orWhereNull('p.tenant_id'))
                ->where(fn ($q) => $q->whereNull('ur.expires_at')->orWhere('ur.expires_at', '>', now()))
                ->exists()) {
            return true;
        }
        return false;
    }

    /**
     * How many days this account may skip the second factor on a remembered
     * device, or null when it may not (security register E-085).
     *
     * Staff use the staff switch and ceiling. Members under a community-wide
     * mandate keep the earlier rule (never remembered) until the owner decides
     * otherwise; everyone else uses the member setting.
     */
    public function rememberDeviceDays(object|array $user, array $config): ?int
    {
        if ($this->requiredByRole($user)) {
            if (empty($config[AuthenticationConfigurationService::CONFIG_TWO_FACTOR_ALLOW_STAFF_TRUSTED_DEVICES])) {
                return null;
            }
            $days = (int) ($config[AuthenticationConfigurationService::CONFIG_TWO_FACTOR_STAFF_TRUSTED_DEVICE_DAYS] ?? 30);
            return max(
                AuthenticationConfigurationService::TRUSTED_DEVICE_DAYS_MIN,
                min($days, AuthenticationConfigurationService::STAFF_TRUSTED_DEVICE_DAYS_MAX)
            );
        }
        if ($this->required($user)
            || empty($config[AuthenticationConfigurationService::CONFIG_TWO_FACTOR_ALLOW_TRUSTED_DEVICES])) {
            return null;
        }
        $days = (int) ($config[AuthenticationConfigurationService::CONFIG_TWO_FACTOR_TRUSTED_DEVICE_DAYS] ?? 30);
        return max(
            AuthenticationConfigurationService::TRUSTED_DEVICE_DAYS_MIN,
            min($days, AuthenticationConfigurationService::TRUSTED_DEVICE_DAYS_MAX)
        );
    }

    /**
     * The authority a remembered device was granted under. Any change to the
     * role, an admin flag or staff status changes the value, so a device
     * remembered before a promotion never carries into the new authority.
     */
    public function roleFingerprint(object|array $user): string
    {
        return hash('sha256', implode('|', [
            (int) data_get($user, 'id'),
            (int) data_get($user, 'tenant_id'),
            strtolower((string) data_get($user, 'role', '')),
            (int) (bool) data_get($user, 'is_admin', false),
            (int) (bool) data_get($user, 'is_super_admin', false),
            (int) (bool) data_get($user, 'is_tenant_super_admin', false),
            (int) (bool) data_get($user, 'is_god', false),
            (int) $this->requiredByRole($user),
        ]));
    }

    /** Claims are accepted only after TokenService signature and revocation checks. */
    public function satisfied(array $claims): bool
    {
        $verifiedAt = $claims['mfa_verified_at'] ?? null;
        return is_int($verifiedAt) && $verifiedAt > 0 && $verifiedAt <= time()
            && in_array($claims['mfa_method'] ?? null, ['totp', 'recovery_code', 'passkey', 'sso', 'trusted_device'], true);
    }

    /**
     * A second factor actually entered within the step-up window. A remembered
     * device is deliberately not enough: it proves the device, not the person.
     */
    public function recentlyVerified(array $claims, int $windowSeconds): bool
    {
        return $this->satisfied($claims)
            && in_array($claims['mfa_method'] ?? null, ['totp', 'recovery_code', 'passkey', 'sso'], true)
            && (int) $claims['mfa_verified_at'] >= time() - $windowSeconds
            && empty($claims['impersonated_by']);
    }

    public static function claims(string $method): array
    {
        return ['mfa_method' => $method, 'mfa_verified_at' => time()];
    }
}
