<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;

/**
 * TranslationConfigurationService — typed config for translation module settings.
 *
 * Stores tenant-scoped translation configuration in the tenant_settings table
 * with a 'translation.' prefix. Provides strongly-typed defaults and caching.
 */
class TranslationConfigurationService
{
    // =========================================================================
    // Configuration Keys
    // =========================================================================

    public const CONFIG_ENABLED = 'translation.enabled';
    public const CONFIG_ENGINE = 'translation.engine';
    public const CONFIG_CONTEXT_AWARE = 'translation.context_aware';
    public const CONFIG_CONTEXT_MESSAGES = 'translation.context_messages';
    public const CONFIG_AUTO_TRANSLATE_DEFAULT = 'translation.auto_translate_default';
    public const CONFIG_MAX_PER_USER_PER_HOUR = 'translation.max_per_user_per_hour';
    public const CONFIG_GLOSSARY_ENABLED = 'translation.glossary_enabled';

    // =========================================================================
    // Default values
    // =========================================================================

    public const DEFAULTS = [
        self::CONFIG_ENABLED              => true,
        self::CONFIG_ENGINE               => 'google',    // 'google' (default) or 'ai' — Translation\TranslationEngine
        self::CONFIG_CONTEXT_AWARE        => false,       // INT7: send conversation history
        self::CONFIG_CONTEXT_MESSAGES     => 5,           // number of preceding messages
        self::CONFIG_AUTO_TRANSLATE_DEFAULT => false,      // INT8: default for new conversations
        self::CONFIG_MAX_PER_USER_PER_HOUR => 100,        // rate limit
        self::CONFIG_GLOSSARY_ENABLED     => false,       // INT10: use custom glossary
    ];

    /** Cache TTL in seconds (5 minutes). */
    private const CACHE_TTL = 300;

    // =========================================================================
    // Public API
    // =========================================================================

    /**
     * Get a configuration value for the current tenant.
     */
    public static function get(string $key, mixed $default = null): mixed
    {
        $tenantId = TenantContext::getId();
        $allStored = self::getStoredValues($tenantId);

        if (array_key_exists($key, $allStored)) {
            return $allStored[$key];
        }

        if ($default !== null) {
            return $default;
        }

        return self::DEFAULTS[$key] ?? null;
    }

    /**
     * Set (upsert) a configuration value for the current tenant.
     */
    public static function set(string $key, mixed $value): void
    {
        $tenantId = TenantContext::getId();
        $storedValue = is_bool($value) ? ($value ? 'true' : 'false') : (string) $value;
        $settingType = self::detectType($value);

        try {
            DB::table('tenant_settings')->updateOrInsert(
                ['tenant_id' => $tenantId, 'setting_key' => $key],
                [
                    'setting_value' => $storedValue,
                    'setting_type' => $settingType,
                    'updated_at' => now(),
                ]
            );

            Cache::forget("translation_config:{$tenantId}");
        } catch (\Throwable $e) {
            Log::error('TranslationConfigurationService::set failed', [
                'key' => $key,
                'tenant_id' => $tenantId,
                'error' => $e->getMessage(),
            ]);
            throw $e;
        }
    }

    /** Rate-limiter key prefix for the per-member hourly translation limit. */
    public const HOURLY_LIMITER_PREFIX = 'translation-hourly:';

    /** Is translation switched on for the current community ("Enable translation")? */
    public static function isEnabled(): bool
    {
        return filter_var(self::get(self::CONFIG_ENABLED, true), FILTER_VALIDATE_BOOLEAN);
    }

    /**
     * Count one translation against the member's hourly limit
     * ("Max translations per user per hour"). False when the limit is reached.
     * Call only for a translation that will reach the provider.
     */
    public static function admitHourly(int $userId): bool
    {
        $limit = (int) self::get(self::CONFIG_MAX_PER_USER_PER_HOUR, self::DEFAULTS[self::CONFIG_MAX_PER_USER_PER_HOUR]);
        if ($limit < 1) {
            return true;
        }
        $key = self::HOURLY_LIMITER_PREFIX . (int) TenantContext::getId() . ':' . $userId;
        if (RateLimiter::tooManyAttempts($key, $limit)) {
            return false;
        }
        RateLimiter::hit($key, 3600);

        return true;
    }

    /**
     * What the websites need to know, for the tenant bootstrap: whether
     * translation is on, whether new conversations auto-translate, and which
     * provider is used.
     *
     * @return array{enabled: bool, auto_translate_default: bool, provider: string}
     */
    public static function publicSettingsForTenant(int $tenantId): array
    {
        $stored = self::getStoredValues($tenantId);
        $value = fn (string $key) => array_key_exists($key, $stored) ? $stored[$key] : self::DEFAULTS[$key];

        return [
            'enabled' => filter_var($value(self::CONFIG_ENABLED), FILTER_VALIDATE_BOOLEAN),
            'auto_translate_default' => filter_var($value(self::CONFIG_AUTO_TRANSLATE_DEFAULT), FILTER_VALIDATE_BOOLEAN),
            // The community's choice: 'google' (default) or 'ai' (its own AI key).
            'provider' => in_array(strtolower((string) $value(self::CONFIG_ENGINE)), ['ai', 'openai'], true) ? 'ai' : 'google',
        ];
    }

    /**
     * Get all configuration keys with effective values.
     */
    public static function getAll(): array
    {
        $tenantId = TenantContext::getId();
        $stored = self::getStoredValues($tenantId);

        return array_merge(self::DEFAULTS, $stored);
    }

    // =========================================================================
    // Internal helpers
    // =========================================================================

    private static function getStoredValues(int $tenantId): array
    {
        $cacheKey = "translation_config:{$tenantId}";

        return Cache::remember($cacheKey, self::CACHE_TTL, function () use ($tenantId) {
            try {
                $rows = DB::table('tenant_settings')
                    ->where('tenant_id', $tenantId)
                    ->where('setting_key', 'LIKE', 'translation.%')
                    ->select('setting_key', 'setting_value', 'setting_type')
                    ->get();

                $result = [];
                foreach ($rows as $row) {
                    $result[$row->setting_key] = self::decodeValue($row->setting_value, $row->setting_type ?? 'string');
                }

                return $result;
            } catch (\Throwable $e) {
                Log::error('TranslationConfigurationService::getStoredValues failed', [
                    'tenant_id' => $tenantId,
                    'error' => $e->getMessage(),
                ]);
                return [];
            }
        });
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
        if (is_bool($value)) return 'boolean';
        if (is_int($value)) return 'integer';
        if (is_float($value)) return 'float';
        return 'string';
    }
}
