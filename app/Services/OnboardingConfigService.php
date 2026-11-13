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
     *
     * Retired 2026-10-02, with any stored rows now ignored:
     *   onboarding.step_interests_enabled / _required — the "What are you
     *     interested in?" step; nothing on the platform read its answers.
     *   onboarding.listing_creation_mode / listing_max_auto — turning the
     *     skills step's answers into listings. Off in every community.
     *
     * Retired 2026-11-13, with any stored rows now ignored:
     *   onboarding.step_profile_required / step_skills_required — no client
     *     and no server check ever read them. Whether the profile step can be
     *     skipped is now worked out from avatar_required / bio_required; the
     *     skills step never demands an answer.
     *   onboarding.step_confirm_enabled — the last step holds the only
     *     "Finish" button, so switching it off left members unable to finish.
     *     It is always shown.
     *   onboarding.help_text — shown by no client.
     */
    private const DEFAULTS = [
        'onboarding.enabled' => '1',
        'onboarding.mandatory' => '1',
        'onboarding.step_welcome_enabled' => '1',
        'onboarding.step_profile_enabled' => '1',
        'onboarding.step_skills_enabled' => '1',
        'onboarding.step_safeguarding_enabled' => '1',
        'onboarding.step_safeguarding_required' => '0',
        // "Protect your account": an optional offer to turn on two-factor,
        // shown only to a member who could complete it (6 Nov 2026).
        'onboarding.step_security_enabled' => '1',
        'onboarding.avatar_required' => '1',
        'onboarding.bio_required' => '1',
        'onboarding.bio_min_length' => '10',
        'onboarding.require_completion_for_visibility' => '0',
        'onboarding.require_avatar_for_visibility' => '0',
        'onboarding.require_bio_for_visibility' => '0',
        'onboarding.welcome_text' => '',
        'onboarding.safeguarding_intro_text' => '',
        'onboarding.country_preset' => 'custom',
    ];

    /**
     * Step definitions in display order.
     */
    private const STEPS = [
        'welcome' => ['key' => 'step_welcome'],
        'profile' => ['key' => 'step_profile'],
        'skills' => ['key' => 'step_skills'],
        'safeguarding' => ['key' => 'step_safeguarding'],
        'security' => ['key' => 'step_security'],
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
     * The steps one member will actually see.
     *
     * The "Protect your account" step is removed for a member who could not
     * complete it or does not need it: two-factor is already on, or they have
     * no password of their own (social sign-up). Turning two-factor on from a
     * signed-in session needs a fresh password confirmation (F-170), so for
     * them the step would be a dead end.
     */
    public static function getActiveStepsForMember(?int $tenantId, int $userId): array
    {
        $tenantId = $tenantId ?? TenantContext::getId();
        $steps = self::getActiveSteps($tenantId);
        if (!in_array('security', array_column($steps, 'slug'), true)) {
            return $steps;
        }

        $passwordHash = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->value('password_hash');
        $offer = is_string($passwordHash) && $passwordHash !== ''
            && !TotpService::isEnabled($userId, $tenantId);

        return $offer
            ? $steps
            : array_values(array_filter($steps, static fn (array $step): bool => $step['slug'] !== 'security'));
    }

    private static function communityAllowsTwoFactor(int $tenantId): bool
    {
        return (int) TenantContext::getId() === $tenantId
            ? (bool) TenantContext::hasFeature('two_factor_authentication')
            : (bool) TenantContext::runForTenant(
                $tenantId,
                static fn (): bool => (bool) TenantContext::hasFeature('two_factor_authentication')
            );
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

            // Two-factor is offered only where the community allows members
            // to turn it on. The step is never required: compulsion is the
            // separate two_factor.require_members setting, enforced at sign-in.
            if ($slug === 'security') {
                if (!self::communityAllowsTwoFactor($tenantId) || empty($config[$enabledKey])) {
                    continue;
                }
                $steps[] = ['slug' => $slug, 'label_code' => $slug, 'required' => false];
                continue;
            }

            // The last step is always there: it holds the only "Finish"
            // button, so a community that switched it off left its members
            // with no way to finish.
            if ($slug === 'confirm') {
                $steps[] = ['slug' => $slug, 'label_code' => $slug, 'required' => true];
                continue;
            }

            if (empty($config[$enabledKey])) {
                continue;
            }

            $steps[] = [
                'slug' => $slug,
                'label_code' => $slug,
                'required' => match ($slug) {
                    // Cannot be skipped while it asks for something compulsory.
                    'profile' => $config['avatar_required'] || $config['bio_required'],
                    'safeguarding' => !empty($config[$requiredKey] ?? false),
                    default => false,
                },
            ];
        }

        return $steps;
    }

    /**
     * Whether members must finish the welcome steps before they can take part.
     *
     * "Must finish" only means anything while the steps are switched on. The
     * two are stored separately, and a community could be left with the steps
     * off and "must finish" still on: its new members were never shown the
     * steps and were then refused when they tried to send a message, post an
     * offer or send credits (found 13 Nov 2026).
     */
    public static function isMandatory(?int $tenantId = null): bool
    {
        $config = self::getConfig($tenantId);

        return $config['enabled'] && $config['mandatory'];
    }

    /**
     * What the profile step demands before a member may finish.
     *
     * Nothing, while that step is switched off: a requirement no step asks
     * for is one no member can meet.
     *
     * @return array{photo: bool, bio: bool, bio_min_length: int}
     */
    public static function profileRequirements(?int $tenantId = null): array
    {
        $config = self::getConfig($tenantId);
        $asked = (bool) $config['step_profile_enabled'];

        return [
            'photo' => $asked && $config['avatar_required'],
            'bio' => $asked && $config['bio_required'],
            'bio_min_length' => max(1, (int) $config['bio_min_length']),
        ];
    }

    /**
     * Which profile requirements a member has not met yet.
     *
     * @return list<string> 'avatar_required' and/or 'bio_required'
     */
    public static function unmetProfileRequirements(?int $tenantId, ?string $avatarUrl, ?string $bio): array
    {
        $needs = self::profileRequirements($tenantId);
        $unmet = [];

        if ($needs['photo'] && trim((string) $avatarUrl) === '') {
            $unmet[] = 'avatar_required';
        }

        if ($needs['bio'] && mb_strlen(trim((string) $bio)) < $needs['bio_min_length']) {
            $unmet[] = 'bio_required';
        }

        return $unmet;
    }

    /**
     * Whether members who have not finished the welcome steps are hidden from
     * other members. Never while the steps are switched off: nobody can finish
     * steps they are never shown, so every new member would be hidden for good.
     */
    private static function hidesUnfinishedMembers(array $config): bool
    {
        return $config['require_completion_for_visibility'] && $config['enabled'];
    }

    /**
     * Validate that a user meets all onboarding completion requirements per config.
     * Returns array of unmet requirements (empty = all met).
     */
    public static function validateCompletion(?int $tenantId, int $userId): array
    {
        $user = User::find($userId);
        if (!$user) {
            return ['user_not_found'];
        }

        $unmet = self::unmetProfileRequirements($tenantId, $user->avatar_url, $user->bio);

        array_push($unmet, ...self::unmetSafeguardingRequirements($tenantId ?? (int) TenantContext::getId(), $userId));

        return $unmet;
    }

    /**
     * Safeguarding answers a member still owes before finishing onboarding.
     *
     * - `safeguarding_required`: the community made the step required, it is
     *   shown (there are active options), and the member has recorded no
     *   answer at all. "None of these apply to me" is an answer.
     * - `safeguarding_option_required`: an active option marked required, and
     *   still offered to newcomers, that the member has not chosen.
     *
     * Saving already refuses a missing required option; this is checked again
     * at completion so a client that skips the save cannot finish without
     * answering (gap found 26 Oct 2026).
     *
     * @return list<string>
     */
    public static function unmetSafeguardingRequirements(int $tenantId, int $userId): array
    {
        $config = self::getConfig($tenantId);
        if (! $config['step_safeguarding_enabled'] || ! self::hasActiveSafeguardingOptions($tenantId)) {
            return [];
        }

        $heldOptionIds = DB::table('user_safeguarding_preferences')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->whereNull('revoked_at')
            ->pluck('option_id')
            ->map(static fn (mixed $id): int => (int) $id)
            ->all();

        $unmet = [];
        if ($config['step_safeguarding_required'] && $heldOptionIds === []) {
            $unmet[] = 'safeguarding_required';
        }

        $missingRequired = DB::table('tenant_safeguarding_options')
            ->where('tenant_id', $tenantId)
            ->where('is_active', 1)
            ->where('is_required', 1)
            ->where('accepts_new_selections', 1)
            ->when($heldOptionIds !== [], fn ($q) => $q->whereNotIn('id', $heldOptionIds))
            ->exists();
        if ($missingRequired) {
            $unmet[] = 'safeguarding_option_required';
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

        if (self::hidesUnfinishedMembers($config) && !$user->onboarding_completed) {
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

        if (self::hidesUnfinishedMembers($config)) {
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

        if (self::hidesUnfinishedMembers($config)) {
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
     * Cast a setting value to the appropriate PHP type.
     */
    private static function castValue(string $key, string $raw): mixed
    {
        // Boolean settings
        $booleans = [
            'enabled', 'mandatory',
            'step_welcome_enabled', 'step_profile_enabled',
            'step_skills_enabled',
            'step_safeguarding_enabled', 'step_safeguarding_required',
            'step_security_enabled',
            'avatar_required', 'bio_required',
            'require_completion_for_visibility', 'require_avatar_for_visibility', 'require_bio_for_visibility',
        ];

        if (in_array($key, $booleans, true)) {
            return filter_var($raw, FILTER_VALIDATE_BOOLEAN);
        }

        // Integer settings
        $integers = ['bio_min_length'];
        if (in_array($key, $integers, true)) {
            return (int) $raw;
        }

        // String settings (trim empty to null for optional text)
        $optionalText = ['welcome_text', 'safeguarding_intro_text'];
        if (in_array($key, $optionalText, true)) {
            $trimmed = trim($raw);
            return $trimmed !== '' ? $trimmed : null;
        }

        return $raw;
    }
}
