<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Reads and provides onboarding configuration for a tenant.
 *
 * All settings are stored in tenant_settings with 'onboarding.' prefix.
 * When no settings exist, defaults match the pre-module hardcoded behavior
 * so existing tenants see zero change.
 */
class OnboardingConfigService
{
    /**
     * Default values — match pre-module hardcoded behavior exactly.
     */
    private const DEFAULTS = [
        'onboarding.enabled' => '1',
        'onboarding.mandatory' => '1',
        'onboarding.step_welcome_enabled' => '1',
        'onboarding.step_profile_enabled' => '1',
        'onboarding.step_profile_required' => '1',
        'onboarding.step_interests_enabled' => '1',
        'onboarding.step_interests_required' => '0',
        'onboarding.step_skills_enabled' => '1',
        'onboarding.step_skills_required' => '0',
        'onboarding.step_safeguarding_enabled' => '1',
        'onboarding.step_safeguarding_required' => '0',
        'onboarding.step_confirm_enabled' => '1',
        'onboarding.avatar_required' => '1',
        'onboarding.bio_required' => '1',
        'onboarding.bio_min_length' => '10',
        'onboarding.listing_creation_mode' => 'disabled',
        'onboarding.listing_max_auto' => '3',
        'onboarding.require_completion_for_visibility' => '0',
        'onboarding.require_avatar_for_visibility' => '0',
        'onboarding.require_bio_for_visibility' => '0',
        'onboarding.welcome_text' => '',
        'onboarding.help_text' => '',
        'onboarding.safeguarding_intro_text' => '',
        'onboarding.country_preset' => 'custom',
    ];

    /**
     * Step definitions in display order.
     */
    private const STEPS = [
        'welcome' => ['key' => 'step_welcome'],
        'profile' => ['key' => 'step_profile'],
        'interests' => ['key' => 'step_interests'],
        'skills' => ['key' => 'step_skills'],
        'safeguarding' => ['key' => 'step_safeguarding'],
        'confirm' => ['key' => 'step_confirm'],
    ];

    /** Cache key for the per-tenant config blob. */
    private const CONFIG_CACHE_PREFIX = 'onboarding_config:';
    private const CONFIG_CACHE_TTL = 1800; // 30 minutes — invalidated explicitly on admin save

    /**
     * Get the full onboarding config for a tenant, with defaults.
     * Cached per-tenant; invalidate via clearConfigCache() on admin updates.
     */
    public static function getConfig(?int $tenantId = null): array
    {
        $tenantId = $tenantId ?? TenantContext::getId();
        $cacheKey = self::CONFIG_CACHE_PREFIX . $tenantId;

        return Cache::remember($cacheKey, self::CONFIG_CACHE_TTL, function () use ($tenantId) {
            $rows = DB::select(
                "SELECT setting_key, setting_value FROM tenant_settings WHERE tenant_id = ? AND setting_key LIKE 'onboarding.%'",
                [$tenantId]
            );

            $stored = [];
            foreach ($rows as $row) {
                $stored[$row->setting_key] = $row->setting_value;
            }

            // Merge stored values over defaults
            $config = [];
            foreach (self::DEFAULTS as $key => $default) {
                $shortKey = str_replace('onboarding.', '', $key);
                $raw = $stored[$key] ?? $default;
                $config[$shortKey] = self::castValue($shortKey, $raw);
            }
            return $config;
        });
    }

    /**
     * Invalidate the cached config for a tenant. Called by AdminOnboardingConfigController
     * after persisting a settings change.
     */
    public static function clearConfigCache(?int $tenantId = null): void
    {
        $tenantId = $tenantId ?? TenantContext::getId();
        Cache::forget(self::CONFIG_CACHE_PREFIX . $tenantId);
    }

    /**
     * Get ordered list of active steps for the onboarding wizard.
     */
    public static function getActiveSteps(?int $tenantId = null): array
    {
        $tenantId = $tenantId ?? TenantContext::getId();
        $config = self::getConfig($tenantId);
        $steps = [];

        foreach (self::STEPS as $slug => $meta) {
            $enabledKey = $meta['key'] . '_enabled';
            $requiredKey = $meta['key'] . '_required';

            // The safeguarding step is on by default, but a community that has
            // never configured any safeguarding options has nothing to ask.
            // Showing the step anyway put an empty "no options configured"
            // screen in front of every new member.
            if ($slug === 'safeguarding' && !self::hasActiveSafeguardingOptions($tenantId)) {
                continue;
            }

            if (!empty($config[$enabledKey])) {
                $steps[] = [
                    'slug' => $slug,
                    'label_code' => $slug,
                    'required' => !empty($config[$requiredKey] ?? false),
                ];
            }
        }

        return $steps;
    }

    /**
     * Check if a specific step is required by config.
     */
    public static function isStepRequired(?int $tenantId, string $stepSlug): bool
    {
        $config = self::getConfig($tenantId);
        $meta = self::STEPS[$stepSlug] ?? null;
        if (!$meta) {
            return false;
        }
        return !empty($config[$meta['key'] . '_required'] ?? false);
    }

    /**
     * Validate that a user meets all onboarding completion requirements per config.
     * Returns array of unmet requirements (empty = all met).
     */
    public static function validateCompletion(?int $tenantId, int $userId): array
    {
        $config = self::getConfig($tenantId);
        $user = User::find($userId);
        if (!$user) {
            return ['user_not_found'];
        }

        $unmet = [];

        if ($config['avatar_required'] && empty($user->avatar_url)) {
            $unmet[] = 'avatar_required';
        }

        if ($config['bio_required'] && (empty(trim($user->bio ?? '')) || mb_strlen(trim($user->bio ?? '')) < $config['bio_min_length'])) {
            $unmet[] = 'bio_required';
        }

        // If safeguarding step is enabled AND required AND actually shown
        // (the community has options to answer), check preferences exist.
        if ($config['step_safeguarding_enabled'] && $config['step_safeguarding_required']
            && self::hasActiveSafeguardingOptions($tenantId ?? TenantContext::getId())) {
            $hasSafeguardingPrefs = DB::selectOne(
                "SELECT 1 FROM user_safeguarding_preferences WHERE user_id = ? AND tenant_id = ? AND revoked_at IS NULL LIMIT 1",
                [$userId, $tenantId ?? TenantContext::getId()]
            );
            if (!$hasSafeguardingPrefs) {
                $unmet[] = 'safeguarding_required';
            }
        }

        return $unmet;
    }

    /**
     * Whether the tenant has at least one active safeguarding option for
     * members to answer. Without one the safeguarding step is not shown.
     */
    private static function hasActiveSafeguardingOptions(int $tenantId): bool
    {
        return DB::table('tenant_safeguarding_options')
            ->where('tenant_id', $tenantId)
            ->where('is_active', 1)
            ->exists();
    }

    /**
     * Check if a user's profile should be publicly visible based on gating rules.
     */
    public static function isProfileVisible(?int $tenantId, int $userId): bool
    {
        $config = self::getConfig($tenantId);
        $user = User::find($userId);
        if (!$user) {
            return false;
        }

        if ($config['require_completion_for_visibility'] && !$user->onboarding_completed) {
            return false;
        }

        if ($config['require_avatar_for_visibility'] && empty($user->avatar_url)) {
            return false;
        }

        if ($config['require_bio_for_visibility'] && empty(trim($user->bio ?? ''))) {
            return false;
        }

        return true;
    }

    /**
     * Apply profile visibility filters to an Eloquent User query builder.
     *
     * Uses the same config as isProfileVisible() but as query-level conditions
     * so member lists, search, and nearby exclude hidden profiles efficiently.
     *
     * @param \Illuminate\Database\Eloquent\Builder $query  User query builder
     * @param int|null $tenantId  Tenant ID (defaults to current tenant)
     * @return \Illuminate\Database\Eloquent\Builder
     */
    public static function applyVisibilityScope($query, ?int $tenantId = null)
    {
        $config = self::getConfig($tenantId);

        if ($config['require_completion_for_visibility']) {
            $query->where('onboarding_completed', true);
        }

        if ($config['require_avatar_for_visibility']) {
            $query->where('avatar_url', '!=', '')->whereNotNull('avatar_url');
        }

        if ($config['require_bio_for_visibility']) {
            $query->where('bio', '!=', '')->whereNotNull('bio');
        }

        return $query;
    }

    /**
     * Get SQL WHERE clauses for profile visibility filtering (raw queries).
     *
     * Returns an array of SQL condition strings to AND into a WHERE clause.
     * The table alias defaults to 'u' to match UsersController::index().
     *
     * @param int|null $tenantId  Tenant ID (defaults to current tenant)
     * @param string   $alias     Table alias (default 'u')
     * @return string[]
     */
    public static function getVisibilitySqlConditions(?int $tenantId = null, string $alias = 'u'): array
    {
        $config = self::getConfig($tenantId);
        $conditions = [];

        if ($config['require_completion_for_visibility']) {
            $conditions[] = "{$alias}.onboarding_completed = 1";
        }

        if ($config['require_avatar_for_visibility']) {
            $conditions[] = "{$alias}.avatar_url IS NOT NULL AND {$alias}.avatar_url != ''";
        }

        if ($config['require_bio_for_visibility']) {
            $conditions[] = "{$alias}.bio IS NOT NULL AND TRIM({$alias}.bio) != ''";
        }

        return $conditions;
    }

    /**
     * Get the listing creation mode for a tenant.
     */
    public static function getListingCreationMode(?int $tenantId = null): string
    {
        $config = self::getConfig($tenantId);
        $mode = $config['listing_creation_mode'] ?? 'disabled';
        $allowed = ['disabled', 'suggestions_only', 'draft', 'pending_review', 'active'];
        return in_array($mode, $allowed, true) ? $mode : 'disabled';
    }

    /**
     * Get the max auto-generated listings allowed.
     */
    public static function getListingMaxAuto(?int $tenantId = null): int
    {
        $config = self::getConfig($tenantId);
        return max(0, min(10, (int) ($config['listing_max_auto'] ?? 3)));
    }

    /**
     * Cast a setting value to the appropriate PHP type.
     */
    private static function castValue(string $key, string $raw): mixed
    {
        // Boolean settings
        $booleans = [
            'enabled', 'mandatory',
            'step_welcome_enabled', 'step_profile_enabled', 'step_profile_required',
            'step_interests_enabled', 'step_interests_required',
            'step_skills_enabled', 'step_skills_required',
            'step_safeguarding_enabled', 'step_safeguarding_required',
            'step_confirm_enabled',
            'avatar_required', 'bio_required',
            'require_completion_for_visibility', 'require_avatar_for_visibility', 'require_bio_for_visibility',
        ];

        if (in_array($key, $booleans, true)) {
            return filter_var($raw, FILTER_VALIDATE_BOOLEAN);
        }

        // Integer settings
        $integers = ['bio_min_length', 'listing_max_auto'];
        if (in_array($key, $integers, true)) {
            return (int) $raw;
        }

        // String settings (trim empty to null for optional text)
        $optionalText = ['welcome_text', 'help_text', 'safeguarding_intro_text'];
        if (in_array($key, $optionalText, true)) {
            $trimmed = trim($raw);
            return $trimmed !== '' ? $trimmed : null;
        }

        return $raw;
    }
}
