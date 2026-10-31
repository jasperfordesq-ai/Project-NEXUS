<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Models\Badge;
use App\Models\TenantBadgeOverride;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * BadgeDefinitionService — tenant-aware badge definition loading.
 *
 * Replaces the hardcoded badge definitions in GamificationService with
 * database-backed definitions that support per-tenant customization.
 *
 * Badge tiers:
 *   - core:     Always enabled for every tenant (cannot be disabled)
 *   - template: Enabled by default, tenants can disable or customize thresholds
 *   - custom:   Created by tenant admins
 *
 * Badge classes:
 *   - quantity:      Traditional threshold counters (e.g., "volunteer 50 hours")
 *   - quality:       Behavioral badges (reliability, reciprocity, mentoring)
 *   - special:       One-off awards (early adopter, verified)
 *   - verification:  Trust badges (identity verification)
 */
class BadgeDefinitionService
{
    private const CACHE_TTL_SECONDS = 300; // 5 minutes
    private const CACHE_PREFIX = 'badge_definitions:';

    /**
     * Get all enabled badges for a tenant, with tenant overrides applied.
     *
     * @return array<int, array{key: string, name: string, icon: string, type: string, threshold: int, msg: string, badge_tier: string, badge_class: string, ...}>
     */
    public static function getEnabledBadges(?int $tenantId = null): array
    {
        $tenantId = $tenantId ?? TenantContext::getId();
        $cacheKey = self::CACHE_PREFIX . $tenantId;

        return array_map([BadgeCopy::class, 'localize'], Cache::remember($cacheKey, self::CACHE_TTL_SECONDS, function () use ($tenantId) {
            return self::loadEnabledBadges($tenantId);
        }));
    }

    /**
     * Get a single badge definition by key, with tenant overrides applied.
     */
    public static function getBadgeByKey(string $key, ?int $tenantId = null): ?array
    {
        $badges = self::getEnabledBadges($tenantId);

        foreach ($badges as $badge) {
            if ($badge['key'] === $key) {
                return $badge;
            }
        }

        return null;
    }

    /**
     * Get all badges (enabled and disabled) for admin configuration UI.
     */
    public static function getAllBadgesForAdmin(?int $tenantId = null): array
    {
        $tenantId = $tenantId ?? TenantContext::getId();

        $badges = Badge::where('tenant_id', $tenantId)
            ->where('is_active', true)
            ->orderBy('sort_order')
            ->get();

        $overrides = TenantBadgeOverride::where('tenant_id', $tenantId)
            ->get()
            ->keyBy('badge_key');

        return $badges->map(function ($badge) use ($overrides) {
            $override = $overrides->get($badge->badge_key);
            return self::mergeBadgeWithOverride($badge, $override);
        })->values()->toArray();
    }

    /**
     * Get only core (always-enabled) badge definitions.
     */
    public static function getCoreDefinitions(?int $tenantId = null): array
    {
        return array_filter(self::getEnabledBadges($tenantId), function ($badge) {
            return $badge['badge_tier'] === 'core';
        });
    }

    /**
     * Get only template (tenant-configurable) badge definitions.
     */
    public static function getTemplateDefinitions(?int $tenantId = null): array
    {
        $tenantId = $tenantId ?? TenantContext::getId();

        $badges = Badge::where('tenant_id', $tenantId)
            ->where('is_active', true)
            ->where('badge_tier', 'template')
            ->orderBy('sort_order')
            ->get();

        $overrides = TenantBadgeOverride::where('tenant_id', $tenantId)
            ->get()
            ->keyBy('badge_key');

        return $badges->map(function ($badge) use ($overrides) {
            $override = $overrides->get($badge->badge_key);
            return self::mergeBadgeWithOverride($badge, $override);
        })->values()->toArray();
    }

    /**
     * Get badges grouped by type/category for the frontend.
     */
    public static function getBadgesByCategory(?int $tenantId = null): array
    {
        $badges = self::getEnabledBadges($tenantId);
        $grouped = [];

        foreach ($badges as $badge) {
            $grouped[$badge['type']][] = $badge;
        }

        return $grouped;
    }

    /**
     * Get badges filtered by class (quantity, quality, special, verification).
     */
    public static function getBadgesByClass(string $class, ?int $tenantId = null): array
    {
        return array_values(array_filter(self::getEnabledBadges($tenantId), function ($badge) use ($class) {
            return $badge['badge_class'] === $class;
        }));
    }

    /**
     * Update a tenant's override for a badge.
     */
    public static function updateTenantOverride(int $tenantId, string $badgeKey, array $overrides): bool
    {
        // Core badges cannot be disabled
        $badge = Badge::where('tenant_id', $tenantId)
            ->where('badge_key', $badgeKey)
            ->first();

        if (! $badge) {
            return false;
        }

        if ($badge->badge_tier === 'core' && isset($overrides['is_enabled']) && ! $overrides['is_enabled']) {
            Log::warning("Attempted to disable core badge {$badgeKey} for tenant {$tenantId}");
            return false;
        }

        $data = array_filter([
            'is_enabled' => $overrides['is_enabled'] ?? null,
            'custom_threshold' => $overrides['custom_threshold'] ?? null,
            'custom_name' => $overrides['custom_name'] ?? null,
            'custom_description' => $overrides['custom_description'] ?? null,
            'custom_icon' => $overrides['custom_icon'] ?? null,
        ], fn ($v) => $v !== null);

        TenantBadgeOverride::updateOrCreate(
            ['tenant_id' => $tenantId, 'badge_key' => $badgeKey],
            $data
        );

        self::clearCache($tenantId);
        return true;
    }

    /**
     * Remove a tenant's override for a badge (revert to defaults).
     */
    public static function resetTenantOverride(int $tenantId, string $badgeKey): bool
    {
        $deleted = TenantBadgeOverride::where('tenant_id', $tenantId)
            ->where('badge_key', $badgeKey)
            ->delete();

        if ($deleted) {
            self::clearCache($tenantId);
        }

        return $deleted > 0;
    }

    /**
     * Clear the badge definition cache for a tenant.
     */
    public static function clearCache(?int $tenantId = null): void
    {
        $tenantId = $tenantId ?? TenantContext::getId();
        Cache::forget(self::CACHE_PREFIX . $tenantId);
    }

    /**
     * Check if the badges table has been seeded (for fallback logic).
     */
    public static function isSeeded(?int $tenantId = null): bool
    {
        $tenantId = $tenantId ?? TenantContext::getId();

        return Cache::remember(
            self::CACHE_PREFIX . 'seeded:' . $tenantId,
            self::CACHE_TTL_SECONDS,
            fn () => Badge::where('tenant_id', $tenantId)->exists()
        );
    }

    // =========================================================================
    // PRIVATE HELPERS
    // =========================================================================

    /**
     * Load enabled badges from DB with tenant overrides applied.
     */
    private static function loadEnabledBadges(int $tenantId): array
    {
        $badges = Badge::where('tenant_id', $tenantId)
            ->where('is_active', true)
            ->orderBy('sort_order')
            ->get();

        if ($badges->isEmpty()) {
            // Fallback: return empty array — the GamificationService
            // will use its static definitions if this returns empty.
            return [];
        }

        $overrides = TenantBadgeOverride::where('tenant_id', $tenantId)
            ->get()
            ->keyBy('badge_key');

        return $badges
            ->filter(function ($badge) use ($overrides) {
                // Core badges are always enabled
                if ($badge->badge_tier === 'core') {
                    return true;
                }

                // Check tenant override
                $override = $overrides->get($badge->badge_key);
                if ($override) {
                    return $override->is_enabled;
                }

                // Default: use the badge's own is_enabled flag
                return $badge->is_enabled;
            })
            ->map(function ($badge) use ($overrides) {
                $override = $overrides->get($badge->badge_key);
                return self::mergeBadgeWithOverride($badge, $override);
            })
            ->values()
            ->toArray();
    }

    /**
     * Merge a Badge model with its tenant override into the standard array format
     * expected by GamificationService badge checking methods.
     */
    private static function mergeBadgeWithOverride(Badge $badge, ?TenantBadgeOverride $override): array
    {
        $config = $badge->config_json ? json_decode($badge->config_json, true) : null;
        $usesBuiltInCopy = in_array($badge->badge_tier, ['core', 'template'], true);

        return [
            'key'               => $badge->badge_key,
            'name'              => $override?->custom_name ?? $badge->name,
            'description'       => $override?->custom_description ?? $badge->description,
            'name_code'         => $usesBuiltInCopy && $override?->custom_name === null
                ? 'badges.' . $badge->badge_key . '.name'
                : null,
            'description_code'  => $usesBuiltInCopy && $override?->custom_description === null
                ? 'badges.' . $badge->badge_key . '.description'
                : null,
            'icon'              => $override?->custom_icon ?? $badge->icon,
            'type'              => $badge->category,
            'threshold'         => $override?->custom_threshold ?? $badge->threshold,
            'msg'               => $override?->custom_description ?? $badge->description,
            'badge_tier'        => $badge->badge_tier,
            'badge_class'       => $badge->badge_class,
            'threshold_type'    => $badge->threshold_type,
            'evaluation_method' => $badge->evaluation_method,
            'config_json'       => $config,
            'rarity'            => $badge->rarity,
            'xp_value'          => $badge->xp_value,
            'is_enabled'        => $override?->is_enabled ?? $badge->is_enabled,
            'has_override'      => $override !== null,
        ];
    }
}
