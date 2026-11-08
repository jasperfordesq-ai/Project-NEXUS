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

/**
 * ListingConfigurationService — typed config for listing module settings.
 *
 * Stores tenant-scoped listing configuration in the tenant_settings table
 * with a 'listing.' prefix. Provides strongly-typed defaults and caching.
 */
class ListingConfigurationService
{
    // =========================================================================
    // Moderation & Approval
    // =========================================================================

    public const CONFIG_MODERATION_ENABLED = 'listing.moderation_enabled';
    public const CONFIG_AUTO_APPROVE_TRUSTED = 'listing.auto_approve_trusted';

    // =========================================================================
    // Listing Limits
    // =========================================================================

    public const CONFIG_MAX_PER_USER = 'listing.max_per_user';
    public const CONFIG_MAX_IMAGES = 'listing.max_images';
    public const CONFIG_MAX_IMAGE_SIZE_MB = 'listing.max_image_size_mb';
    public const CONFIG_REQUIRE_IMAGE = 'listing.require_image';
    public const CONFIG_MIN_TITLE_LENGTH = 'listing.min_title_length';
    public const CONFIG_MIN_DESCRIPTION_LENGTH = 'listing.min_description_length';

    // =========================================================================
    // Listing Types & Options
    // =========================================================================

    public const CONFIG_ALLOW_OFFERS = 'listing.allow_offers';
    public const CONFIG_ALLOW_REQUESTS = 'listing.allow_requests';
    public const CONFIG_REQUIRE_CATEGORY = 'listing.require_category';
    public const CONFIG_REQUIRE_LOCATION = 'listing.require_location';
    public const CONFIG_REQUIRE_HOURS_ESTIMATE = 'listing.require_hours_estimate';
    public const CONFIG_ENABLE_SKILL_TAGS = 'listing.enable_skill_tags';
    public const CONFIG_ENABLE_SERVICE_TYPE = 'listing.enable_service_type';

    // =========================================================================
    // Expiry & Renewal
    // =========================================================================

    public const CONFIG_AUTO_EXPIRE_DAYS = 'listing.auto_expire_days';
    public const CONFIG_MAX_RENEWALS = 'listing.max_renewals';
    public const CONFIG_RENEWAL_DAYS = 'listing.renewal_days';
    public const CONFIG_EXPIRY_REMINDERS = 'listing.expiry_reminders';

    // =========================================================================
    // Features
    // =========================================================================

    public const CONFIG_ENABLE_FEATURED = 'listing.enable_featured';
    public const CONFIG_FEATURED_DURATION_DAYS = 'listing.featured_duration_days';
    public const CONFIG_ENABLE_AI_DESCRIPTIONS = 'listing.enable_ai_descriptions';
    public const CONFIG_ENABLE_REPORTING = 'listing.enable_reporting';
    public const CONFIG_ENABLE_FAVOURITES = 'listing.enable_favourites';
    public const CONFIG_ENABLE_MAP_VIEW = 'listing.enable_map_view';
    public const CONFIG_ENABLE_RECIPROCITY = 'listing.enable_reciprocity';

    // =========================================================================
    // Default values
    // =========================================================================

    public const DEFAULTS = [
        // Moderation
        self::CONFIG_MODERATION_ENABLED       => false,
        self::CONFIG_AUTO_APPROVE_TRUSTED     => false,
        // Limits
        self::CONFIG_MAX_PER_USER             => 50,
        self::CONFIG_MAX_IMAGES               => 5,
        self::CONFIG_MAX_IMAGE_SIZE_MB        => 8,
        self::CONFIG_REQUIRE_IMAGE            => false,
        self::CONFIG_MIN_TITLE_LENGTH         => 5,
        self::CONFIG_MIN_DESCRIPTION_LENGTH   => 20,
        // Types & Options
        self::CONFIG_ALLOW_OFFERS             => true,
        self::CONFIG_ALLOW_REQUESTS           => true,
        self::CONFIG_REQUIRE_CATEGORY         => true,
        self::CONFIG_REQUIRE_LOCATION         => false,
        self::CONFIG_REQUIRE_HOURS_ESTIMATE   => false,
        self::CONFIG_ENABLE_SKILL_TAGS        => true,
        self::CONFIG_ENABLE_SERVICE_TYPE      => true,
        // Expiry
        self::CONFIG_AUTO_EXPIRE_DAYS         => 0,
        self::CONFIG_MAX_RENEWALS             => 12,
        self::CONFIG_RENEWAL_DAYS             => 30,
        self::CONFIG_EXPIRY_REMINDERS         => true,
        // Features
        self::CONFIG_ENABLE_FEATURED          => true,
        self::CONFIG_FEATURED_DURATION_DAYS   => 7,
        self::CONFIG_ENABLE_AI_DESCRIPTIONS   => false, // off until an admin turns it on (owner, 8 Nov 2026)
        self::CONFIG_ENABLE_REPORTING         => true,
        self::CONFIG_ENABLE_FAVOURITES        => true,
        self::CONFIG_ENABLE_MAP_VIEW          => true,
        self::CONFIG_ENABLE_RECIPROCITY       => true,
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
            $existing = DB::table('tenant_settings')
                ->where('tenant_id', $tenantId)
                ->where('setting_key', $key)
                ->first();

            if ($existing) {
                DB::table('tenant_settings')
                    ->where('tenant_id', $tenantId)
                    ->where('setting_key', $key)
                    ->update([
                        'setting_value' => $storedValue,
                        'setting_type' => $settingType,
                        'updated_at' => now(),
                    ]);
            } else {
                DB::table('tenant_settings')->insert([
                    'tenant_id' => $tenantId,
                    'setting_key' => $key,
                    'setting_value' => $storedValue,
                    'setting_type' => $settingType,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }

            Cache::forget("listing_config:{$tenantId}");
        } catch (\Throwable $e) {
            Log::error('ListingConfigurationService::set failed', [
                'key' => $key,
                'tenant_id' => $tenantId,
                'error' => $e->getMessage(),
            ]);
            throw $e;
        }
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
        $cacheKey = "listing_config:{$tenantId}";

        return Cache::remember($cacheKey, self::CACHE_TTL, function () use ($tenantId) {
            try {
                $rows = DB::table('tenant_settings')
                    ->where('tenant_id', $tenantId)
                    ->where('setting_key', 'LIKE', 'listing.%')
                    ->select('setting_key', 'setting_value', 'setting_type')
                    ->get();

                $result = [];
                foreach ($rows as $row) {
                    $result[$row->setting_key] = self::decodeValue($row->setting_value, $row->setting_type ?? 'string');
                }

                return $result;
            } catch (\Throwable $e) {
                Log::error('ListingConfigurationService::getStoredValues failed', [
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
