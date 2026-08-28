<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Services\OnboardingConfigService;
use App\Services\SafeguardingJurisdictionService;
use App\Services\SafeguardingPreferenceService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Admin endpoints for onboarding module configuration.
 *
 * GET  /v2/admin/config/onboarding          — Read all onboarding settings
 * PUT  /v2/admin/config/onboarding          — Update onboarding settings
 * GET  /v2/admin/config/onboarding/presets   — List available country presets
 * POST /v2/admin/config/onboarding/apply-preset — Apply a country preset
 */
class AdminOnboardingConfigController extends BaseApiController
{
    protected bool $isV2Api = true;

    /**
     * Allowed setting keys that can be updated via PUT.
     */
    private const ALLOWED_KEYS = [
        'enabled', 'mandatory',
        'step_welcome_enabled', 'step_profile_enabled', 'step_profile_required',
        'step_interests_enabled', 'step_interests_required',
        'step_skills_enabled', 'step_skills_required',
        'step_safeguarding_enabled', 'step_safeguarding_required',
        'step_confirm_enabled',
        'avatar_required', 'bio_required', 'bio_min_length',
        'listing_creation_mode', 'listing_max_auto',
        'require_completion_for_visibility', 'require_avatar_for_visibility', 'require_bio_for_visibility',
        'welcome_text', 'help_text', 'safeguarding_intro_text',
        'country_preset',
    ];

    /**
     * Boolean setting keys (for type validation).
     */
    private const BOOLEAN_KEYS = [
        'enabled', 'mandatory',
        'step_welcome_enabled', 'step_profile_enabled', 'step_profile_required',
        'step_interests_enabled', 'step_interests_required',
        'step_skills_enabled', 'step_skills_required',
        'step_safeguarding_enabled', 'step_safeguarding_required',
        'step_confirm_enabled',
        'avatar_required', 'bio_required',
        'require_completion_for_visibility', 'require_avatar_for_visibility', 'require_bio_for_visibility',
    ];

    /** GET /v2/admin/config/onboarding */
    public function getConfig(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $config = OnboardingConfigService::getConfig($tenantId);
        $steps = OnboardingConfigService::getActiveSteps($tenantId);
        $safeguardingOptions = SafeguardingPreferenceService::getAllOptionsForTenant($tenantId);

        return $this->respondWithData([
            'config' => $config,
            'active_steps' => $steps,
            'safeguarding_options' => $safeguardingOptions,
        ]);
    }

    /** PUT /v2/admin/config/onboarding */
    public function updateConfig(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $input = $this->getAllInput();

        if (empty($input)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.request_body_empty'), null, 422);
        }

        $updated = [];
        $errors = [];

        foreach ($input as $key => $value) {
            if (!in_array($key, self::ALLOWED_KEYS, true)) {
                continue; // Skip unknown keys silently
            }

            // Validate listing_creation_mode
            if ($key === 'listing_creation_mode') {
                $allowed = ['disabled', 'suggestions_only', 'draft', 'pending_review', 'active'];
                if (!in_array($value, $allowed, true)) {
                    $errors[] = "Invalid listing_creation_mode: {$value}";
                    continue;
                }
            }

            // Validate bio_min_length
            if ($key === 'bio_min_length') {
                $value = (int) $value;
                if ($value < 0 || $value > 500) {
                    $errors[] = 'bio_min_length must be between 0 and 500';
                    continue;
                }
            }

            // Validate listing_max_auto
            if ($key === 'listing_max_auto') {
                $value = (int) $value;
                if ($value < 0 || $value > 10) {
                    $errors[] = 'listing_max_auto must be between 0 and 10';
                    continue;
                }
            }

            // Validate country_preset
            if ($key === 'country_preset') {
                $allowed = ['ireland', 'united_kingdom', 'england_wales', 'scotland', 'northern_ireland', 'custom'];
                if (!in_array($value, $allowed, true)) {
                    $errors[] = "Invalid country_preset: {$value}";
                    continue;
                }
            }

            // Determine type for storage
            $type = 'string';
            if (in_array($key, self::BOOLEAN_KEYS, true)) {
                $value = filter_var($value, FILTER_VALIDATE_BOOLEAN) ? '1' : '0';
                $type = 'boolean';
            } elseif (in_array($key, ['bio_min_length', 'listing_max_auto'], true)) {
                $value = (string) (int) $value;
                $type = 'integer';
            } elseif (in_array($key, ['welcome_text', 'help_text', 'safeguarding_intro_text'], true)) {
                $value = strip_tags(trim((string) $value));
            } else {
                $value = (string) $value;
            }

            $settingKey = 'onboarding.' . $key;

            DB::statement(
                "INSERT INTO tenant_settings (tenant_id, setting_key, setting_value, setting_type, updated_by)
                 VALUES (?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), setting_type = VALUES(setting_type), updated_by = VALUES(updated_by), updated_at = CURRENT_TIMESTAMP",
                [$tenantId, $settingKey, $value, $type, $adminId]
            );

            $updated[] = $key;
        }

        if (!empty($errors)) {
            return $this->respondWithError('VALIDATION_ERROR', implode('; ', $errors), null, 422);
        }

        // Clear tenant bootstrap cache so frontend picks up changes.
        // (Class is RedisCache — the old RedisCacheService name silently
        // failed to resolve, so this cache was never actually cleared.)
        try {
            $redisCache = app(\App\Services\RedisCache::class);
            $redisCache->delete('tenant_bootstrap', $tenantId);
        } catch (\Throwable $e) {
            Log::warning('[AdminOnboardingConfig] tenant_bootstrap cache clear failed: ' . $e->getMessage());
        }

        // Invalidate the per-tenant onboarding config cache so the next read
        // sees the freshly-saved settings instead of the stale 30-min entry.
        OnboardingConfigService::clearConfigCache($tenantId);

        return $this->respondWithData([
            'message' => __('api_controllers_1.admin_onboarding.settings_updated'),
            'updated_keys' => $updated,
        ]);
    }

    /** GET /v2/admin/config/onboarding/presets */
    public function getPresets(): JsonResponse
    {
        $this->requireAdmin();
        return $this->respondWithData(SafeguardingPreferenceService::getAvailablePresets());
    }

    /** POST /v2/admin/config/onboarding/apply-preset */
    public function applyPreset(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $presetKey = $this->input('preset');

        if (empty($presetKey)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.preset_required'), 'preset', 422);
        }

        $allowed = ['ireland', 'united_kingdom', 'england_wales', 'scotland', 'northern_ireland', 'custom'];
        if (!in_array($presetKey, $allowed, true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_preset', ['preset' => $presetKey]), 'preset', 422);
        }

        $created = SafeguardingPreferenceService::applyCountryPreset($tenantId, $presetKey);

        // Also update the country_preset setting
        $adminId = $this->requireAdmin();
        DB::statement(
            "INSERT INTO tenant_settings (tenant_id, setting_key, setting_value, setting_type, updated_by)
             VALUES (?, 'onboarding.country_preset', ?, 'string', ?)
             ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by), updated_at = CURRENT_TIMESTAMP",
            [$tenantId, $presetKey, $adminId]
        );

        // Keep the safeguarding jurisdiction in step with the preset. These
        // were two independent "country" settings: the vetting-policy screen
        // guards option/jurisdiction agreement, but this endpoint installed
        // vetted-interaction options with no jurisdiction check — so a tenant
        // could look configured (country_preset set) while the contact gate
        // stayed permanently UNAVAILABLE and silently emptied matches
        // (Sentry 134069538). Preset keys are jurisdiction codes, so when the
        // matching jurisdiction can carry a contact policy and none is
        // configured yet, configure it here; when a DIFFERENT one is already
        // configured, leave it alone and tell the admin about the mismatch.
        $jurisdictionConfigured = false;
        $jurisdictionWarning = null;
        $jurisdictions = app(SafeguardingJurisdictionService::class);
        $policy = $jurisdictions->getPolicyUncached($tenantId);
        $presetJurisdictions = $jurisdictions->availableJurisdictions();
        $presetJurisdiction = null;
        foreach ($presetJurisdictions as $candidate) {
            if (($candidate['code'] ?? null) === $presetKey) {
                $presetJurisdiction = $candidate;
                break;
            }
        }

        if ($presetJurisdiction !== null && ! empty($presetJurisdiction['contact_policy_available'])) {
            if (! $policy['configured']) {
                $jurisdictions->configure($tenantId, $presetKey, $adminId);
                $jurisdictionConfigured = true;
            } elseif ($policy['jurisdiction'] !== $presetKey) {
                $jurisdictionWarning = __('api_controllers_1.admin_onboarding.preset_jurisdiction_mismatch', [
                    'preset' => $presetKey,
                    'jurisdiction' => $policy['jurisdiction'],
                ]);
            }
        }

        return $this->respondWithData([
            'message' => __('api_controllers_1.admin_onboarding.preset_applied', ['preset' => $presetKey]),
            'options_created' => $created,
            'options_skipped_existing' => count($created) === 0 ? 'All options already exist — no changes made' : null,
            'jurisdiction_configured' => $jurisdictionConfigured,
            'jurisdiction_warning' => $jurisdictionWarning,
        ]);
    }
}
