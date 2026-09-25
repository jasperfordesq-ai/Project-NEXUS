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
 * VolunteeringConfigurationService — typed config for volunteering module.
 *
 * Stores tenant-scoped volunteering configuration in the tenant_settings table
 * with a 'volunteering.' prefix. Provides tab visibility toggles and
 * feature-level configuration with caching.
 */
class VolunteeringConfigurationService
{
    // =========================================================================
    // Tab visibility keys (17 tabs)
    // =========================================================================

    public const CONFIG_TAB_OPPORTUNITIES = 'volunteering.tab_opportunities';
    public const CONFIG_TAB_APPLICATIONS = 'volunteering.tab_applications';
    public const CONFIG_TAB_HOURS = 'volunteering.tab_hours';
    public const CONFIG_TAB_RECOMMENDED = 'volunteering.tab_recommended';
    public const CONFIG_TAB_CERTIFICATES = 'volunteering.tab_certificates';
    public const CONFIG_TAB_ALERTS = 'volunteering.tab_alerts';
    public const CONFIG_TAB_WELLBEING = 'volunteering.tab_wellbeing';
    public const CONFIG_TAB_CREDENTIALS = 'volunteering.tab_credentials';
    public const CONFIG_TAB_WAITLIST = 'volunteering.tab_waitlist';
    public const CONFIG_TAB_SWAPS = 'volunteering.tab_swaps';
    public const CONFIG_TAB_GROUP_SIGNUPS = 'volunteering.tab_group_signups';
    public const CONFIG_TAB_HOURS_REVIEW = 'volunteering.tab_hours_review';
    public const CONFIG_TAB_EXPENSES = 'volunteering.tab_expenses';
    public const CONFIG_TAB_SAFEGUARDING = 'volunteering.tab_safeguarding';
    public const CONFIG_TAB_COMMUNITY_PROJECTS = 'volunteering.tab_community_projects';
    public const CONFIG_TAB_DONATIONS = 'volunteering.tab_donations';
    public const CONFIG_TAB_ACCESSIBILITY = 'volunteering.tab_accessibility';

    // =========================================================================
    // Shift & Application settings
    // =========================================================================

    public const CONFIG_SWAP_REQUIRES_ADMIN = 'volunteering.swap_requires_admin';
    public const CONFIG_AUTO_APPROVE_APPLICATIONS = 'volunteering.auto_approve_applications';
    public const CONFIG_REQUIRE_ORG_NOTE_ON_DECLINE = 'volunteering.require_org_note_on_decline';
    public const CONFIG_CANCELLATION_DEADLINE_HOURS = 'volunteering.cancellation_deadline_hours';
    public const CONFIG_MAX_HOURS_PER_SHIFT = 'volunteering.max_hours_per_shift';

    // =========================================================================
    // Hours & Verification
    // =========================================================================

    public const CONFIG_HOURS_REQUIRE_VERIFICATION = 'volunteering.hours_require_verification';
    public const CONFIG_MIN_HOURS_FOR_CERTIFICATE = 'volunteering.min_hours_for_certificate';

    // =========================================================================
    // Emergency Alerts
    // =========================================================================

    public const CONFIG_ALERT_DEFAULT_EXPIRY_HOURS = 'volunteering.alert_default_expiry_hours';
    public const CONFIG_ALERT_SKILL_MATCHING = 'volunteering.alert_skill_matching';

    // =========================================================================
    // Expenses
    // =========================================================================

    public const CONFIG_EXPENSES_ENABLED = 'volunteering.expenses_enabled';
    public const CONFIG_EXPENSE_REQUIRE_RECEIPT = 'volunteering.expense_require_receipt';
    public const CONFIG_EXPENSE_MAX_AMOUNT = 'volunteering.expense_max_amount';

    // =========================================================================
    // Wellbeing & Safety
    // =========================================================================

    public const CONFIG_BURNOUT_DETECTION = 'volunteering.burnout_detection';
    public const CONFIG_GUARDIAN_CONSENT_REQUIRED = 'volunteering.guardian_consent_required';

    // =========================================================================
    // Features
    // =========================================================================

    public const CONFIG_ENABLE_QR_CHECKIN = 'volunteering.enable_qr_checkin';
    public const CONFIG_ENABLE_RECURRING_SHIFTS = 'volunteering.enable_recurring_shifts';
    public const CONFIG_ENABLE_REVIEWS = 'volunteering.enable_reviews';
    public const CONFIG_ENABLE_MATCHING = 'volunteering.enable_matching';

    // =========================================================================
    // Default values
    // =========================================================================

    public const DEFAULTS = [
        // Tab visibility (all enabled by default)
        self::CONFIG_TAB_OPPORTUNITIES      => true,
        self::CONFIG_TAB_APPLICATIONS       => true,
        self::CONFIG_TAB_HOURS              => true,
        self::CONFIG_TAB_RECOMMENDED        => true,
        self::CONFIG_TAB_CERTIFICATES       => true,
        self::CONFIG_TAB_ALERTS             => true,
        self::CONFIG_TAB_WELLBEING          => true,
        self::CONFIG_TAB_CREDENTIALS        => true,
        self::CONFIG_TAB_WAITLIST           => true,
        self::CONFIG_TAB_SWAPS              => true,
        self::CONFIG_TAB_GROUP_SIGNUPS      => true,
        self::CONFIG_TAB_HOURS_REVIEW       => true,
        self::CONFIG_TAB_EXPENSES           => true,
        self::CONFIG_TAB_SAFEGUARDING       => true,
        self::CONFIG_TAB_COMMUNITY_PROJECTS => true,
        self::CONFIG_TAB_DONATIONS          => true,
        self::CONFIG_TAB_ACCESSIBILITY      => true,
        // Shifts & Applications
        self::CONFIG_SWAP_REQUIRES_ADMIN          => false,
        self::CONFIG_AUTO_APPROVE_APPLICATIONS    => false,
        self::CONFIG_REQUIRE_ORG_NOTE_ON_DECLINE  => false,
        // NOTE: these MUST match the inline defaults at the enforcing call sites
        // (VolunteerService::cancelShiftSignup / logHours,
        // VolunteerCertificateService) — get() returns a non-null caller default
        // BEFORE consulting DEFAULTS, so a mismatch makes the admin UI advertise
        // a policy that is not what is actually enforced for unconfigured tenants.
        self::CONFIG_CANCELLATION_DEADLINE_HOURS  => 0,  // 0 = no deadline (legacy behaviour preserved)
        self::CONFIG_MAX_HOURS_PER_SHIFT          => 24, // legacy 24h sanity cap
        // Hours & Verification
        self::CONFIG_HOURS_REQUIRE_VERIFICATION   => true,
        self::CONFIG_MIN_HOURS_FOR_CERTIFICATE    => 0,  // 0 = no minimum (legacy behaviour preserved)
        // Emergency Alerts
        self::CONFIG_ALERT_DEFAULT_EXPIRY_HOURS   => 24,
        self::CONFIG_ALERT_SKILL_MATCHING         => true,
        // Expenses
        self::CONFIG_EXPENSES_ENABLED             => true,
        self::CONFIG_EXPENSE_REQUIRE_RECEIPT       => false,
        self::CONFIG_EXPENSE_MAX_AMOUNT           => 500,
        // Wellbeing & Safety
        self::CONFIG_BURNOUT_DETECTION            => true,
        self::CONFIG_GUARDIAN_CONSENT_REQUIRED     => false,
        // Features
        self::CONFIG_ENABLE_QR_CHECKIN            => true,
        self::CONFIG_ENABLE_RECURRING_SHIFTS      => true,
        self::CONFIG_ENABLE_REVIEWS               => true,
        self::CONFIG_ENABLE_MATCHING              => true,
    ];

    /** Cache TTL in seconds (5 minutes). */
    private const CACHE_TTL = 300;

    // =========================================================================
    // Public API
    // =========================================================================

    /**
     * Resolution order: tenant-stored value → non-null caller $default → DEFAULTS.
     *
     * ⚠ A non-null caller $default takes precedence over DEFAULTS, so passing an
     * inline default that disagrees with DEFAULTS silently forks the enforced
     * policy from what the admin config UI (getAll) advertises. Either omit the
     * default or keep it identical to DEFAULTS[$key].
     */
    public static function get(string $key, mixed $default = null): mixed
    {
        if ($key === self::CONFIG_GUARDIAN_CONSENT_REQUIRED) {
            // Pinned off: see isRetiredValue(). A value stored before the
            // switch-off is ignored rather than deleted.
            return false;
        }

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

    public static function set(string $key, mixed $value): void
    {
        if (self::isRetiredValue($key, $value)) {
            throw new \InvalidArgumentException(
                __('api.guardian_consent_retired', ['age' => \App\Support\Authorization\MinimumAge::YEARS])
            );
        }

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

            Cache::forget("volunteering_config:{$tenantId}");
        } catch (\Throwable $e) {
            Log::error('VolunteeringConfigurationService::set failed', [
                'key' => $key,
                'tenant_id' => $tenantId,
                'error' => $e->getMessage(),
            ]);
            throw $e;
        }
    }

    public static function getAll(): array
    {
        $tenantId = TenantContext::getId();
        $stored = self::getStoredValues($tenantId);

        $all = array_merge(self::DEFAULTS, $stored);
        $all[self::CONFIG_GUARDIAN_CONSENT_REQUIRED] = false;

        return $all;
    }

    /**
     * Adults-only platform (owner decision 2026-09-25, E-035 F-160): guardian
     * consent is switched off, so `volunteering.guardian_consent_required` can
     * no longer be turned on. Reading it always returns false; storing a truthy
     * value is refused. Storing false stays allowed so an admin screen that
     * re-saves every setting keeps working.
     */
    public static function isRetiredValue(string $key, mixed $value): bool
    {
        return $key === self::CONFIG_GUARDIAN_CONSENT_REQUIRED
            && filter_var($value, FILTER_VALIDATE_BOOLEAN);
    }

    // =========================================================================
    // Internal helpers
    // =========================================================================

    private static function getStoredValues(int $tenantId): array
    {
        $cacheKey = "volunteering_config:{$tenantId}";

        return Cache::remember($cacheKey, self::CACHE_TTL, function () use ($tenantId) {
            try {
                $rows = DB::table('tenant_settings')
                    ->where('tenant_id', $tenantId)
                    ->where('setting_key', 'LIKE', 'volunteering.%')
                    ->select('setting_key', 'setting_value', 'setting_type')
                    ->get();

                $result = [];
                foreach ($rows as $row) {
                    $result[$row->setting_key] = self::decodeValue($row->setting_value, $row->setting_type ?? 'string');
                }

                return $result;
            } catch (\Throwable $e) {
                Log::error('VolunteeringConfigurationService::getStoredValues failed', [
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
