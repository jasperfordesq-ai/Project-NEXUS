<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use InvalidArgumentException;

/**
 * Typed tenant configuration for TOTP two-factor authentication and passkeys.
 *
 * The biometric_login feature is the tenant-wide authentication kill switch.
 * New passkey enrolment is independently controlled here so administrators can
 * pause registrations without taking existing passkey sign-in offline.
 */
class AuthenticationConfigurationService
{
    public const CONFIG_TWO_FACTOR_REQUIRE_MEMBERS = 'two_factor.require_members';
    public const CONFIG_TWO_FACTOR_ALLOW_TRUSTED_DEVICES = 'two_factor.allow_trusted_devices';
    public const CONFIG_TWO_FACTOR_TRUSTED_DEVICE_DAYS = 'two_factor.trusted_device_days';
    public const CONFIG_TWO_FACTOR_BACKUP_CODE_COUNT = 'two_factor.backup_code_count';
    public const CONFIG_PASSKEYS_CONDITIONAL_AUTOFILL = 'passkeys.conditional_autofill';
    public const CONFIG_PASSKEYS_ENROLLMENT_ENABLED = 'passkeys.enrollment_enabled';
    public const CONFIG_PASSKEYS_MAX_CREDENTIALS = 'passkeys.max_credentials_per_user';

    public const TRUSTED_DEVICE_DAYS_MIN = 1;
    public const TRUSTED_DEVICE_DAYS_MAX = 365;
    public const BACKUP_CODE_COUNT_MIN = 1;
    public const BACKUP_CODE_COUNT_MAX = 100;
    public const PASSKEY_CREDENTIALS_MIN = 1;
    public const PASSKEY_CREDENTIALS_MAX = 20;

    public const DEFAULTS = [
        self::CONFIG_TWO_FACTOR_REQUIRE_MEMBERS => false,
        self::CONFIG_TWO_FACTOR_ALLOW_TRUSTED_DEVICES => true,
        self::CONFIG_TWO_FACTOR_TRUSTED_DEVICE_DAYS => 30,
        self::CONFIG_TWO_FACTOR_BACKUP_CODE_COUNT => 10,
        self::CONFIG_PASSKEYS_CONDITIONAL_AUTOFILL => true,
        self::CONFIG_PASSKEYS_ENROLLMENT_ENABLED => true,
        self::CONFIG_PASSKEYS_MAX_CREDENTIALS => 10,
    ];

    private const CACHE_TTL = 300;

    public static function get(string $key, mixed $default = null, ?int $tenantId = null): mixed
    {
        self::assertKnownKey($key);

        $stored = self::getStoredValues($tenantId ?? TenantContext::getId());
        if (array_key_exists($key, $stored)) {
            return $stored[$key];
        }

        return $default ?? self::DEFAULTS[$key];
    }

    public static function set(
        string $key,
        mixed $value,
        ?int $tenantId = null,
        ?int $actorId = null
    ): void
    {
        self::assertKnownKey($key);
        if (!self::isValidValue($key, $value)) {
            throw new InvalidArgumentException("Invalid value for authentication configuration key: {$key}");
        }

        $tenantId ??= TenantContext::getId();
        $storedValue = is_bool($value) ? ($value ? 'true' : 'false') : (string) $value;
        $settingType = self::detectType($value);

        try {
            $identity = ['tenant_id' => $tenantId, 'setting_key' => $key];
            $values = [
                'setting_value' => $storedValue,
                'setting_type' => $settingType,
                'category' => 'authentication',
                'updated_at' => now(),
            ];
            if ($actorId !== null) {
                $values['updated_by'] = $actorId;
            }

            // created_at is deliberately omitted: the database default fills
            // it on insert and subsequent policy edits must preserve it.
            DB::table('tenant_settings')->updateOrInsert($identity, $values);

            if ($actorId !== null) {
                DB::table('tenant_settings')
                    ->where($identity)
                    ->whereNull('created_by')
                    ->update(['created_by' => $actorId]);
            }

            self::clearCache($tenantId);
        } catch (\Throwable $e) {
            Log::error('AuthenticationConfigurationService::set failed', [
                'key' => $key,
                'tenant_id' => $tenantId,
                'error' => $e->getMessage(),
            ]);

            throw $e;
        }
    }

    public static function getAll(?int $tenantId = null): array
    {
        return array_merge(self::DEFAULTS, self::getStoredValues($tenantId ?? TenantContext::getId()));
    }

    public static function isValidValue(string $key, mixed $value): bool
    {
        return match ($key) {
            self::CONFIG_TWO_FACTOR_REQUIRE_MEMBERS,
            self::CONFIG_TWO_FACTOR_ALLOW_TRUSTED_DEVICES,
            self::CONFIG_PASSKEYS_CONDITIONAL_AUTOFILL,
            self::CONFIG_PASSKEYS_ENROLLMENT_ENABLED => is_bool($value),
            self::CONFIG_TWO_FACTOR_TRUSTED_DEVICE_DAYS => is_int($value)
                && $value >= self::TRUSTED_DEVICE_DAYS_MIN
                && $value <= self::TRUSTED_DEVICE_DAYS_MAX,
            self::CONFIG_TWO_FACTOR_BACKUP_CODE_COUNT => is_int($value)
                && $value >= self::BACKUP_CODE_COUNT_MIN
                && $value <= self::BACKUP_CODE_COUNT_MAX,
            self::CONFIG_PASSKEYS_MAX_CREDENTIALS => is_int($value)
                && $value >= self::PASSKEY_CREDENTIALS_MIN
                && $value <= self::PASSKEY_CREDENTIALS_MAX,
            default => false,
        };
    }

    public static function clearCache(?int $tenantId = null): void
    {
        Cache::forget(self::cacheKey($tenantId ?? TenantContext::getId()));
    }

    private static function getStoredValues(int $tenantId): array
    {
        return Cache::remember(self::cacheKey($tenantId), self::CACHE_TTL, function () use ($tenantId): array {
            try {
                $rows = DB::table('tenant_settings')
                    ->where('tenant_id', $tenantId)
                    ->whereIn('setting_key', array_keys(self::DEFAULTS))
                    ->select('setting_key', 'setting_value', 'setting_type')
                    ->get();

                $result = [];
                foreach ($rows as $row) {
                    $result[$row->setting_key] = self::decodeValue(
                        (string) $row->setting_value,
                        (string) ($row->setting_type ?? 'string')
                    );
                }

                return $result;
            } catch (\Throwable $e) {
                Log::error('AuthenticationConfigurationService::getStoredValues failed', [
                    'tenant_id' => $tenantId,
                    'error' => $e->getMessage(),
                ]);

                return [];
            }
        });
    }

    private static function assertKnownKey(string $key): void
    {
        if (!array_key_exists($key, self::DEFAULTS)) {
            throw new InvalidArgumentException("Unknown authentication configuration key: {$key}");
        }
    }

    private static function cacheKey(int $tenantId): string
    {
        return "authentication_config:{$tenantId}";
    }

    private static function decodeValue(string $storedValue, string $type): mixed
    {
        return match ($type) {
            'boolean' => in_array(strtolower($storedValue), ['true', '1', 'yes'], true),
            'integer' => (int) $storedValue,
            'float' => (float) $storedValue,
            default => $storedValue,
        };
    }

    private static function detectType(mixed $value): string
    {
        if (is_bool($value)) {
            return 'boolean';
        }
        if (is_int($value)) {
            return 'integer';
        }
        if (is_float($value)) {
            return 'float';
        }

        return 'string';
    }
}
