<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * BrokerControlConfigService
 *
 * Centralized configuration service for all broker control features.
 * Manages tenant-level settings stored in tenants.configuration JSON.
 *
 * Features managed:
 * - Direct messaging toggle
 * - Risk tagging
 * - Exchange workflow
 * - Broker message visibility
 */
class BrokerControlConfigService
{
    /**
     * A random_sample_percentage at or above this value copies EVERY private
     * message into broker review — the same stored policy as the admin-only
     * `broker_copy_all_messages` flag. Callers that gate that flag must gate
     * the sampling rate against this constant too (F-242).
     */
    public const BLANKET_COPY_SAMPLE_PERCENTAGE = 100;

    /** Default configuration values */
    private const DEFAULTS = [
        'messaging' => [
            'direct_messaging_enabled' => true,
            'first_contact_monitoring' => true,
            'new_member_monitoring_days' => 30,
            'require_exchange_for_listings' => false,
        ],
        'risk_tagging' => [
            'enabled' => true,
            'high_risk_requires_approval' => true,
            'notify_on_high_risk_match' => true,
            'default_risk_level' => 'low',
        ],
        'exchange_workflow' => [
            'enabled' => false,
            'require_broker_approval' => false,
            'auto_approve_low_risk' => true,
            'max_hours_without_approval' => 4,
            'confirmation_deadline_hours' => 72,
            'allow_hour_adjustment' => true,
            'max_hour_variance_percent' => 25,
            'expiry_hours' => 168,
        ],
        'broker_visibility' => [
            'enabled' => true,
            'copy_first_contact' => true,
            'copy_new_member_messages' => true,
            'copy_high_risk_listing_messages' => true,
            'random_sample_percentage' => 0,
            'retention_days' => 365,
        ],
    ];

    /**
     * Get all broker control configuration.
     *
     * @param string|null $section Optional section to retrieve
     * @return array Configuration array
     */
    public static function getConfig(?string $section = null): array
    {
        return self::getConfigForTenant(TenantContext::getId(), $section);
    }

    /**
     * Get broker control configuration for a specific tenant.
     *
     * This is used by super-admin read paths that inspect another tenant
     * without switching the process-wide TenantContext.
     *
     * @param int $tenantId Tenant ID to read
     * @param string|null $section Optional section to retrieve
     * @return array Configuration array
     */
    public static function getConfigForTenant(int $tenantId, ?string $section = null): array
    {
        $tenant = DB::table('tenants')->where('id', $tenantId)->first();

        $config = [];
        if ($tenant && !empty($tenant->configuration)) {
            $fullConfig = json_decode($tenant->configuration, true) ?? [];
            $config = $fullConfig['broker_controls'] ?? [];
            if (!empty($config)) {
                $config = array_replace_recursive($config, self::mapFlatConfigToNested($config));
            }
        }

        // Also check tenant_settings.broker_config for controller-saved values
        try {
            $settingsRow = DB::table('tenant_settings')
                ->where('tenant_id', $tenantId)
                ->where('setting_key', 'broker_config')
                ->first();

            if ($settingsRow && !empty($settingsRow->setting_value)) {
                $controllerConfig = json_decode($settingsRow->setting_value, true) ?? [];
                $config = array_replace_recursive($config, self::mapFlatConfigToNested($controllerConfig));
            }
        } catch (\Exception $e) {
            // Ignore — use defaults
        }

        $merged = self::mergeWithDefaults($config);

        if ($section !== null) {
            return $merged[$section] ?? self::DEFAULTS[$section] ?? [];
        }

        return $merged;
    }

    /**
     * Update broker control configuration.
     *
     * @param array $data Configuration data to update
     * @return bool
     */
    public static function updateConfig(array $data): bool
    {
        $tenantId = TenantContext::getId();

        $tenant = DB::table('tenants')->where('id', $tenantId)->first();

        $fullConfig = [];
        if ($tenant && !empty($tenant->configuration)) {
            $fullConfig = json_decode($tenant->configuration, true) ?? [];
        }

        // Deep-merge into the existing broker_controls section so that sections
        // not present in $data are preserved rather than silently reset to defaults.
        $existing = $fullConfig['broker_controls'] ?? [];
        $sanitized = self::sanitizeConfig($data);
        $fullConfig['broker_controls'] = array_replace_recursive($existing, $sanitized);

        $result = DB::table('tenants')
            ->where('id', $tenantId)
            ->update(['configuration' => json_encode($fullConfig)]);

        self::clearCache();

        return $result !== false;
    }

    /**
     * Update a specific section of the configuration.
     *
     * @param string $section Section name
     * @param array $data Section data
     * @return bool
     */
    public static function updateSection(string $section, array $data): bool
    {
        $config = self::getConfig();
        $config[$section] = array_merge($config[$section] ?? [], $data);
        return self::updateConfig($config);
    }

    /**
     * Convert broker-panel flat configuration keys into the nested runtime
     * shape used by BrokerControlConfigService and ExchangeWorkflowService.
     */
    public static function flatToNested(array $data): array
    {
        return self::mapFlatConfigToNested($data);
    }

    /**
     * Convert nested runtime configuration back into the flat broker-panel
     * shape returned by AdminBrokerController::getConfiguration().
     */
    public static function nestedToFlat(array $config): array
    {
        $flat = [];

        $messaging = $config['messaging'] ?? [];
        if (array_key_exists('direct_messaging_enabled', $messaging)) {
            $flat['broker_messaging_enabled'] = (bool) $messaging['direct_messaging_enabled'];
        }
        if (array_key_exists('new_member_monitoring_days', $messaging)) {
            $flat['new_member_monitoring_days'] = (int) $messaging['new_member_monitoring_days'];
        }
        if (array_key_exists('require_exchange_for_listings', $messaging)) {
            $flat['require_exchange_for_listings'] = (bool) $messaging['require_exchange_for_listings'];
        }

        $riskTagging = $config['risk_tagging'] ?? [];
        if (array_key_exists('enabled', $riskTagging)) {
            $flat['risk_tagging_enabled'] = (bool) $riskTagging['enabled'];
        }
        if (array_key_exists('high_risk_requires_approval', $riskTagging)) {
            $flat['require_approval_high_risk'] = (bool) $riskTagging['high_risk_requires_approval'];
        }
        if (array_key_exists('notify_on_high_risk_match', $riskTagging)) {
            $flat['notify_on_high_risk_match'] = (bool) $riskTagging['notify_on_high_risk_match'];
        }

        $workflow = $config['exchange_workflow'] ?? [];
        if (array_key_exists('require_broker_approval', $workflow)) {
            $flat['broker_approval_required'] = (bool) $workflow['require_broker_approval'];
        }
        if (array_key_exists('auto_approve_low_risk', $workflow)) {
            $flat['auto_approve_low_risk'] = (bool) $workflow['auto_approve_low_risk'];
        }
        if (array_key_exists('max_hours_without_approval', $workflow)) {
            $flat['max_hours_without_approval'] = (float) $workflow['max_hours_without_approval'];
        }
        if (array_key_exists('confirmation_deadline_hours', $workflow)) {
            $flat['confirmation_deadline_hours'] = (int) $workflow['confirmation_deadline_hours'];
        }
        if (array_key_exists('allow_hour_adjustment', $workflow)) {
            $flat['allow_hour_adjustment'] = (bool) $workflow['allow_hour_adjustment'];
        }
        if (array_key_exists('max_hour_variance_percent', $workflow)) {
            $flat['max_hour_variance_percent'] = (int) $workflow['max_hour_variance_percent'];
        }
        if (array_key_exists('expiry_hours', $workflow)) {
            $flat['expiry_hours'] = (int) $workflow['expiry_hours'];
        }

        $visibility = $config['broker_visibility'] ?? [];
        if (array_key_exists('copy_first_contact', $visibility)) {
            $flat['copy_first_contact'] = (bool) $visibility['copy_first_contact'];
        }
        if (array_key_exists('copy_new_member_messages', $visibility)) {
            $flat['copy_new_member_messages'] = (bool) $visibility['copy_new_member_messages'];
        }
        if (array_key_exists('copy_high_risk_listing_messages', $visibility)) {
            $flat['copy_high_risk_listing_messages'] = (bool) $visibility['copy_high_risk_listing_messages'];
        }
        if (array_key_exists('random_sample_percentage', $visibility)) {
            $flat['random_sample_percentage'] = (int) $visibility['random_sample_percentage'];
            $flat['broker_copy_all_messages'] = (int) $visibility['random_sample_percentage'] >= self::BLANKET_COPY_SAMPLE_PERCENTAGE;
        }
        if (array_key_exists('retention_days', $visibility)) {
            $flat['retention_days'] = (int) $visibility['retention_days'];
        }

        return $flat;
    }

    // =========================================================================
    // MESSAGING FEATURE CHECKS
    // =========================================================================

    public static function isDirectMessagingEnabled(): bool
    {
        $config = self::getConfig('messaging');
        return (bool) ($config['direct_messaging_enabled'] ?? true);
    }

    public static function isFirstContactMonitoringEnabled(): bool
    {
        if (!self::isBrokerVisibilityEnabled()) {
            return false;
        }
        $config = self::getConfig('broker_visibility');
        return (bool) ($config['copy_first_contact'] ?? true);
    }

    // =========================================================================
    // EXCHANGE WORKFLOW FEATURE CHECKS
    // =========================================================================

    public static function isExchangeWorkflowEnabled(): bool
    {
        $config = self::getConfig('exchange_workflow');
        return (bool) ($config['enabled'] ?? false);
    }

    // =========================================================================
    // BROKER VISIBILITY FEATURE CHECKS
    // =========================================================================

    public static function isBrokerVisibilityEnabled(): bool
    {
        $config = self::getConfig('broker_visibility');
        return (bool) ($config['enabled'] ?? true);
    }

    // =========================================================================
    // COMPLIANCE FEATURE TOGGLES
    // =========================================================================

    private static function getComplianceSetting(string $key, mixed $default = false): mixed
    {
        $tenantId = TenantContext::getId();
        try {
            $row = DB::table('tenant_settings')
                ->where('tenant_id', $tenantId)
                ->where('setting_key', 'broker_config')
                ->first();

            if ($row && !empty($row->setting_value)) {
                $config = json_decode($row->setting_value, true) ?? [];
                return $config[$key] ?? $default;
            }
        } catch (\Throwable $e) {
            // fail gracefully
        }
        return $default;
    }

    public static function isInsuranceEnabled(): bool
    {
        return (bool) self::getComplianceSetting('insurance_enabled', false);
    }

    // =========================================================================
    // HELPER METHODS
    // =========================================================================

    private static function mergeWithDefaults(array $config): array
    {
        $merged = [];
        foreach (self::DEFAULTS as $section => $defaults) {
            $merged[$section] = array_merge($defaults, $config[$section] ?? []);
        }
        return $merged;
    }

    private static function sanitizeConfig(array $data): array
    {
        $sanitized = self::mapFlatConfigToNested($data);

        if (isset($data['messaging']) && is_array($data['messaging'])) {
            if (array_key_exists('direct_messaging_enabled', $data['messaging'])) {
                $sanitized['messaging']['direct_messaging_enabled'] = (bool) $data['messaging']['direct_messaging_enabled'];
            }
            if (array_key_exists('first_contact_monitoring', $data['messaging'])) {
                $sanitized['messaging']['first_contact_monitoring'] = (bool) $data['messaging']['first_contact_monitoring'];
            }
            if (array_key_exists('new_member_monitoring_days', $data['messaging'])) {
                $sanitized['messaging']['new_member_monitoring_days'] = max(0, (int) $data['messaging']['new_member_monitoring_days']);
            }
            if (array_key_exists('require_exchange_for_listings', $data['messaging'])) {
                $sanitized['messaging']['require_exchange_for_listings'] = (bool) $data['messaging']['require_exchange_for_listings'];
            }
        }

        if (isset($data['risk_tagging']) && is_array($data['risk_tagging'])) {
            if (array_key_exists('enabled', $data['risk_tagging'])) {
                $sanitized['risk_tagging']['enabled'] = (bool) $data['risk_tagging']['enabled'];
            }
            if (array_key_exists('high_risk_requires_approval', $data['risk_tagging'])) {
                $sanitized['risk_tagging']['high_risk_requires_approval'] = (bool) $data['risk_tagging']['high_risk_requires_approval'];
            }
            if (array_key_exists('notify_on_high_risk_match', $data['risk_tagging'])) {
                $sanitized['risk_tagging']['notify_on_high_risk_match'] = (bool) $data['risk_tagging']['notify_on_high_risk_match'];
            }
            if (array_key_exists('default_risk_level', $data['risk_tagging'])) {
                $sanitized['risk_tagging']['default_risk_level'] = in_array($data['risk_tagging']['default_risk_level'], ['low', 'medium', 'high', 'critical'], true)
                    ? $data['risk_tagging']['default_risk_level']
                    : 'low';
            }
        }

        if (isset($data['exchange_workflow']) && is_array($data['exchange_workflow'])) {
            if (array_key_exists('enabled', $data['exchange_workflow'])) {
                $sanitized['exchange_workflow']['enabled'] = (bool) $data['exchange_workflow']['enabled'];
            }
            if (array_key_exists('require_broker_approval', $data['exchange_workflow'])) {
                $sanitized['exchange_workflow']['require_broker_approval'] = (bool) $data['exchange_workflow']['require_broker_approval'];
            }
            if (array_key_exists('auto_approve_low_risk', $data['exchange_workflow'])) {
                $sanitized['exchange_workflow']['auto_approve_low_risk'] = (bool) $data['exchange_workflow']['auto_approve_low_risk'];
            }
            if (array_key_exists('max_hours_without_approval', $data['exchange_workflow'])) {
                $sanitized['exchange_workflow']['max_hours_without_approval'] = max(0, min(24, (float) $data['exchange_workflow']['max_hours_without_approval']));
            }
            if (array_key_exists('confirmation_deadline_hours', $data['exchange_workflow'])) {
                $sanitized['exchange_workflow']['confirmation_deadline_hours'] = max(1, min(720, (int) $data['exchange_workflow']['confirmation_deadline_hours']));
            }
            if (array_key_exists('allow_hour_adjustment', $data['exchange_workflow'])) {
                $sanitized['exchange_workflow']['allow_hour_adjustment'] = (bool) $data['exchange_workflow']['allow_hour_adjustment'];
            }
            if (array_key_exists('max_hour_variance_percent', $data['exchange_workflow'])) {
                $sanitized['exchange_workflow']['max_hour_variance_percent'] = max(0, min(100, (int) $data['exchange_workflow']['max_hour_variance_percent']));
            }
            if (array_key_exists('expiry_hours', $data['exchange_workflow'])) {
                $sanitized['exchange_workflow']['expiry_hours'] = max(1, min(720, (int) $data['exchange_workflow']['expiry_hours']));
            }
        }

        if (isset($data['broker_visibility']) && is_array($data['broker_visibility'])) {
            if (array_key_exists('enabled', $data['broker_visibility'])) {
                $sanitized['broker_visibility']['enabled'] = (bool) $data['broker_visibility']['enabled'];
            }
            if (array_key_exists('copy_first_contact', $data['broker_visibility'])) {
                $sanitized['broker_visibility']['copy_first_contact'] = (bool) $data['broker_visibility']['copy_first_contact'];
            }
            if (array_key_exists('copy_new_member_messages', $data['broker_visibility'])) {
                $sanitized['broker_visibility']['copy_new_member_messages'] = (bool) $data['broker_visibility']['copy_new_member_messages'];
            }
            if (array_key_exists('copy_high_risk_listing_messages', $data['broker_visibility'])) {
                $sanitized['broker_visibility']['copy_high_risk_listing_messages'] = (bool) $data['broker_visibility']['copy_high_risk_listing_messages'];
            }
            if (array_key_exists('random_sample_percentage', $data['broker_visibility'])) {
                $sanitized['broker_visibility']['random_sample_percentage'] = max(0, min(100, (int) $data['broker_visibility']['random_sample_percentage']));
            }
            if (array_key_exists('retention_days', $data['broker_visibility'])) {
                $sanitized['broker_visibility']['retention_days'] = max(1, min(3650, (int) $data['broker_visibility']['retention_days']));
            }
        }

        return $sanitized;
    }

    private static function mapFlatConfigToNested(array $data): array
    {
        $nested = [];

        if (array_key_exists('broker_messaging_enabled', $data)) {
            $nested['messaging']['direct_messaging_enabled'] = (bool) $data['broker_messaging_enabled'];
        }
        if (array_key_exists('new_member_monitoring_days', $data)) {
            $nested['messaging']['new_member_monitoring_days'] = max(0, (int) $data['new_member_monitoring_days']);
        }
        if (array_key_exists('require_exchange_for_listings', $data)) {
            $nested['messaging']['require_exchange_for_listings'] = (bool) $data['require_exchange_for_listings'];
        }

        if (array_key_exists('risk_tagging_enabled', $data)) {
            $nested['risk_tagging']['enabled'] = (bool) $data['risk_tagging_enabled'];
        }
        if (array_key_exists('require_approval_high_risk', $data)) {
            $nested['risk_tagging']['high_risk_requires_approval'] = (bool) $data['require_approval_high_risk'];
        }
        if (array_key_exists('notify_on_high_risk_match', $data)) {
            $nested['risk_tagging']['notify_on_high_risk_match'] = (bool) $data['notify_on_high_risk_match'];
        }

        $hasExchangeWorkflowInput = false;
        if (array_key_exists('exchange_workflow_enabled', $data)) {
            $nested['exchange_workflow']['enabled'] = (bool) $data['exchange_workflow_enabled'];
            $hasExchangeWorkflowInput = true;
        }
        if (array_key_exists('broker_approval_required', $data)) {
            $nested['exchange_workflow']['require_broker_approval'] = (bool) $data['broker_approval_required'];
            $hasExchangeWorkflowInput = true;
        }
        if (array_key_exists('require_broker_approval', $data)) {
            $nested['exchange_workflow']['require_broker_approval'] = (bool) $data['require_broker_approval'];
            $hasExchangeWorkflowInput = true;
        }
        if (array_key_exists('auto_approve_low_risk', $data)) {
            $nested['exchange_workflow']['auto_approve_low_risk'] = (bool) $data['auto_approve_low_risk'];
            $hasExchangeWorkflowInput = true;
        }
        if (array_key_exists('max_hours_without_approval', $data)) {
            $nested['exchange_workflow']['max_hours_without_approval'] = max(0, min(24, (float) $data['max_hours_without_approval']));
            $hasExchangeWorkflowInput = true;
        }
        if (array_key_exists('confirmation_deadline_hours', $data)) {
            $nested['exchange_workflow']['confirmation_deadline_hours'] = max(1, min(720, (int) $data['confirmation_deadline_hours']));
            $hasExchangeWorkflowInput = true;
        }
        if (array_key_exists('allow_hour_adjustment', $data)) {
            $nested['exchange_workflow']['allow_hour_adjustment'] = (bool) $data['allow_hour_adjustment'];
            $hasExchangeWorkflowInput = true;
        }
        if (array_key_exists('max_hour_variance_percent', $data)) {
            $nested['exchange_workflow']['max_hour_variance_percent'] = max(0, min(100, (int) $data['max_hour_variance_percent']));
            $hasExchangeWorkflowInput = true;
        }
        if (array_key_exists('expiry_hours', $data)) {
            $nested['exchange_workflow']['expiry_hours'] = max(1, min(720, (int) $data['expiry_hours']));
            $hasExchangeWorkflowInput = true;
        }
        if ($hasExchangeWorkflowInput && !array_key_exists('enabled', $nested['exchange_workflow'] ?? [])) {
            $nested['exchange_workflow']['enabled'] = true;
        }

        if (array_key_exists('copy_first_contact', $data)) {
            $nested['broker_visibility']['copy_first_contact'] = (bool) $data['copy_first_contact'];
        }
        if (array_key_exists('copy_new_member_messages', $data)) {
            $nested['broker_visibility']['copy_new_member_messages'] = (bool) $data['copy_new_member_messages'];
        }
        if (array_key_exists('copy_high_risk_listing_messages', $data)) {
            $nested['broker_visibility']['copy_high_risk_listing_messages'] = (bool) $data['copy_high_risk_listing_messages'];
        }
        if (array_key_exists('random_sample_percentage', $data)) {
            $nested['broker_visibility']['random_sample_percentage'] = max(0, min(100, (int) $data['random_sample_percentage']));
        }
        if (!empty($data['broker_copy_all_messages'])) {
            $nested['broker_visibility']['random_sample_percentage'] = self::BLANKET_COPY_SAMPLE_PERCENTAGE;
        }
        if (array_key_exists('retention_days', $data)) {
            $nested['broker_visibility']['retention_days'] = max(1, min(3650, (int) $data['retention_days']));
        }

        return $nested;
    }

    private static function clearCache(): void
    {
        $tenantId = TenantContext::getId();
        try {
            Cache::forget("broker_config_{$tenantId}");
            Cache::store('redis')->forget("t{$tenantId}:tenant_bootstrap");
        } catch (\Throwable $e) {
            // Cache unavailable
        }
    }
}
