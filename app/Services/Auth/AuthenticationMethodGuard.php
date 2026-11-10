<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\Auth;

use App\Services\TenantFeatureConfig;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * Prevents account-management actions from deleting a member's final primary
 * sign-in method. Callers that mutate methods should run inside a transaction
 * and request the user-row lock so competing removals serialize.
 */
final class AuthenticationMethodGuard
{
    public static function hasAlternativeToPasskeys(int $userId, int $tenantId, bool $lockUser = false): bool
    {
        $user = self::findUser($userId, $tenantId, $lockUser);
        if ($user === null) {
            return false;
        }

        if (self::hasPassword($user)) {
            return true;
        }

        return self::oauthIdentityCount($userId, $tenantId) > 0;
    }

    public static function hasAlternativeToOauthProvider(
        int $userId,
        int $tenantId,
        string $provider,
        bool $lockUser = false
    ): bool {
        $user = self::findUser($userId, $tenantId, $lockUser);
        if ($user === null) {
            return false;
        }

        if (self::hasPassword($user)) {
            return true;
        }

        if (self::hasUsablePasskey($userId, $tenantId)) {
            return true;
        }

        return self::oauthIdentityCount($userId, $tenantId, $provider) > 0;
    }

    private static function findUser(int $userId, int $tenantId, bool $lockUser): ?object
    {
        $query = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->select(['password_hash']);

        if ($lockUser) {
            $query->lockForUpdate();
        }

        return $query->first();
    }

    private static function hasPassword(object $user): bool
    {
        // The login pipeline verifies only password_hash. The legacy
        // `password` column is also populated with random, unknown values for
        // OAuth-created accounts, so counting it could let a member remove
        // their final usable passkey/OAuth identity and lock themselves out.
        return is_string($user->password_hash ?? null) && $user->password_hash !== '';
    }

    private static function oauthIdentityCount(int $userId, int $tenantId, ?string $excludedProvider = null): int
    {
        if (!Schema::hasTable('oauth_identities')) {
            return 0;
        }

        $enabledProviders = self::enabledIdentityProviders($tenantId);
        if ($excludedProvider !== null) {
            $enabledProviders = array_values(array_diff($enabledProviders, [$excludedProvider]));
        }
        if ($enabledProviders === []) {
            return 0;
        }

        return DB::table('oauth_identities')
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->whereIn('provider', $enabledProviders)
            ->count();
    }

    private static function hasUsablePasskey(int $userId, int $tenantId): bool
    {
        if (!(bool) config('webauthn.authentication_enabled', true) || !Schema::hasTable('webauthn_credentials')) {
            return false;
        }

        $tenant = DB::table('tenants')
            ->where('id', $tenantId)
            ->first(['id', 'parent_id', 'domain', 'accessible_domain', 'features']);
        if ($tenant === null) {
            return false;
        }

        $storedFeatures = null;
        if (is_string($tenant->features ?? null) && trim($tenant->features) !== '') {
            $storedFeatures = json_decode($tenant->features, true);
            if (!is_array($storedFeatures)) {
                return false;
            }
        }
        if (!(TenantFeatureConfig::mergeFeatures($storedFeatures)['biometric_login'] ?? false)) {
            return false;
        }

        $usableRpIds = self::usablePasskeyRpIds($tenant);
        if ($usableRpIds === []) {
            return false;
        }

        $query = DB::table('webauthn_credentials')
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId);
        if (Schema::hasColumn('webauthn_credentials', 'rp_id')) {
            $query->where(static function ($rpQuery) use ($usableRpIds): void {
                $rpQuery->whereNull('rp_id')->orWhereIn('rp_id', $usableRpIds);
            });
        }

        return $query->exists();
    }

    /** @return list<string> */
    private static function usablePasskeyRpIds(object $tenant): array
    {
        $rpIds = [];
        foreach ([$tenant->domain ?? null, $tenant->accessible_domain ?? null] as $host) {
            if (is_string($host) && self::isValidRpId($host)) {
                $rpIds[] = strtolower(rtrim(trim($host), '.'));
            }
        }

        if (empty($tenant->domain) && !empty($tenant->parent_id)) {
            $parent = DB::table('tenants')
                ->where('id', (int) $tenant->parent_id)
                ->where('is_active', 1)
                ->first(['domain', 'accessible_domain']);
            foreach ([$parent->domain ?? null, $parent->accessible_domain ?? null] as $host) {
                if (is_string($host) && self::isValidRpId($host)) {
                    $rpIds[] = strtolower(rtrim(trim($host), '.'));
                }
            }
        }

        foreach (\App\Support\PlatformPasskeyDomains::all() as $platformRpId) {
            if (self::isValidRpId($platformRpId) && self::platformRpHasAllowedOrigin($platformRpId)) {
                $rpIds[] = $platformRpId;
            }
        }

        return array_values(array_unique($rpIds));
    }

    private static function platformRpHasAllowedOrigin(string $rpId): bool
    {
        $rpId = strtolower(rtrim(trim($rpId), '.'));
        $origins = config('webauthn.allowed_origins', []);
        if (!is_array($origins)) {
            $origins = [];
        }
        $origins[] = config('app.frontend_url');
        $origins[] = config('app.accessible_frontend_url');
        if (app()->environment(['local', 'development', 'testing']) && $rpId === 'localhost') {
            return true;
        }

        foreach ($origins as $origin) {
            if (!is_string($origin)) {
                continue;
            }
            $host = strtolower(rtrim((string) parse_url(trim($origin), PHP_URL_HOST), '.'));
            if ($host === $rpId || str_ends_with($host, '.' . $rpId)) {
                return true;
            }
        }

        return false;
    }

    private static function isValidRpId(string $value): bool
    {
        $value = strtolower(rtrim(trim($value), '.'));

        return $value === 'localhost'
            || preg_match('/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/D', $value) === 1;
    }

    /** @return list<string> */
    public static function enabledIdentityProviders(int $tenantId): array
    {
        $providers = [];

        try {
            $providers = app(SocialAuthService::class)->enabledProviders($tenantId);
        } catch (\Throwable $exception) {
            // Account-management guards fail closed when provider state cannot
            // be resolved; a stale identity is not proof of a usable login.
            Log::warning('[Auth] Unable to resolve enabled social sign-in providers', [
                'tenant_id' => $tenantId,
                'exception' => $exception::class,
            ]);
        }

        try {
            $sso = app(SsoOidcService::class);
            foreach ($sso->enabledProviders($tenantId) as $provider) {
                $key = $provider['key'] ?? null;
                if (is_string($key) && $key !== '') {
                    $providers[] = $sso->identityProviderString($tenantId, $key);
                }
            }
        } catch (\Throwable $exception) {
            Log::warning('[Auth] Unable to resolve enabled SSO sign-in providers', [
                'tenant_id' => $tenantId,
                'exception' => $exception::class,
            ]);
        }

        return array_values(array_unique(array_filter(
            $providers,
            static fn (mixed $provider): bool => is_string($provider) && $provider !== ''
        )));
    }
}
