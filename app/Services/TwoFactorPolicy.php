<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Support\Authorization\AdminTier;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Platform administrators cannot opt out; member enforcement belongs to a tenant. */
final class TwoFactorPolicy
{
    public function required(object|array $user): bool
    {
        // Platform routes accept these flags even on operational-role accounts.
        // MFA must cover that authority independently of tenant-admin admission.
        if ((bool) data_get($user, 'is_super_admin', false)
            || (bool) data_get($user, 'is_god', false)
            || AdminTier::allows($user) || data_get($user, 'role') === 'org_admin') {
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
        // A security decision must not use the configuration service's fail-open
        // display cache. Read authoritative tenant state; database failure rejects
        // the request rather than silently disabling enforcement.
        $value = DB::table('tenant_settings')
            ->where('tenant_id', $tenantId)
            ->where('setting_key', AuthenticationConfigurationService::CONFIG_TWO_FACTOR_REQUIRE_MEMBERS)
            ->value('setting_value');
        return in_array(strtolower((string) $value), ['true', '1', 'yes'], true);
    }

    /** Claims are accepted only after TokenService signature and revocation checks. */
    public function satisfied(array $claims): bool
    {
        $verifiedAt = $claims['mfa_verified_at'] ?? null;
        return is_int($verifiedAt) && $verifiedAt > 0 && $verifiedAt <= time()
            && in_array($claims['mfa_method'] ?? null, ['totp', 'recovery_code', 'passkey', 'sso'], true);
    }

    public static function claims(string $method): array
    {
        return ['mfa_method' => $method, 'mfa_verified_at' => time()];
    }
}
