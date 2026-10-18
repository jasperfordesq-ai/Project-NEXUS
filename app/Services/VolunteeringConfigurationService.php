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
    // Tab visibility keys (16 tabs)
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
    // Reminders (email only)
    // =========================================================================
    //
    // Moved here from the `vol_reminder_settings` table on 2026-10-18 so every
    // volunteering setting is edited in one place (the admin Module
    // Configuration window). Each reminder is an on/off switch plus one timing
    // value. There is no separate email switch: email is the only channel the
    // platform sends reminders on, so "on but email off" sent nothing and
    // confused admins. The retired table is read by nothing; it stays one
    // release so the other blue/green colour keeps working, then is dropped.
    //
    // 🔴 Sweeps run across every tenant in one process — read these with
    // getForTenant($tenantId, …), never get(), inside a tenant loop.

    public const CONFIG_REMINDER_PRE_SHIFT_ENABLED = 'volunteering.reminder_pre_shift_enabled';
    public const CONFIG_REMINDER_PRE_SHIFT_HOURS_BEFORE = 'volunteering.reminder_pre_shift_hours_before';
    public const CONFIG_REMINDER_POST_SHIFT_FEEDBACK_ENABLED = 'volunteering.reminder_post_shift_feedback_enabled';
    public const CONFIG_REMINDER_POST_SHIFT_FEEDBACK_HOURS_AFTER = 'volunteering.reminder_post_shift_feedback_hours_after';
    public const CONFIG_REMINDER_LAPSED_VOLUNTEER_ENABLED = 'volunteering.reminder_lapsed_volunteer_enabled';
    public const CONFIG_REMINDER_LAPSED_VOLUNTEER_DAYS_INACTIVE = 'volunteering.reminder_lapsed_volunteer_days_inactive';
    public const CONFIG_REMINDER_CREDENTIAL_EXPIRY_ENABLED = 'volunteering.reminder_credential_expiry_enabled';
    public const CONFIG_REMINDER_CREDENTIAL_EXPIRY_DAYS_BEFORE = 'volunteering.reminder_credential_expiry_days_before';
    public const CONFIG_REMINDER_TRAINING_EXPIRY_ENABLED = 'volunteering.reminder_training_expiry_enabled';
    public const CONFIG_REMINDER_TRAINING_EXPIRY_DAYS_BEFORE = 'volunteering.reminder_training_expiry_days_before';

    // =========================================================================
    // Expenses
    // =========================================================================

    public const CONFIG_EXPENSES_ENABLED = 'volunteering.expenses_enabled';
    public const CONFIG_EXPENSE_REQUIRE_RECEIPT = 'volunteering.expense_require_receipt';
    public const CONFIG_EXPENSE_MAX_AMOUNT = 'volunteering.expense_max_amount';

    // =========================================================================
    // Safety
    // =========================================================================
    //
    // `alert_default_expiry_hours`, `alert_skill_matching` and
    // `burnout_detection` were offered here from 2026-03 to 2026-10 and read
    // by nothing: toggling them changed nothing. Removed 2026-10-18 (owner
    // decision). A stored tenant_settings row for any of them is harmless —
    // the bulk PUT skips keys outside DEFAULTS and getAll() only merges stored
    // rows on top of DEFAULTS, so they never reach the browser.

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
        // Group sign-ups is alpha (owner decision 2026-10-06): a group leader can
        // block out places on a shift, but the people added are never told, are
        // not real shift sign-ups, cannot check in and earn no hours. Hidden on
        // every community until finished. The admin switch stays, badged Alpha,
        // so a community can opt in deliberately.
        self::CONFIG_TAB_GROUP_SIGNUPS      => false,
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
        // Reminders. The credential-expiry window is 30 days: the
        // qualifications register always used 30 while the retired settings
        // page advertised 14, so an admin saw one number and got another.
        self::CONFIG_REMINDER_PRE_SHIFT_ENABLED               => true,
        self::CONFIG_REMINDER_PRE_SHIFT_HOURS_BEFORE          => 24,
        self::CONFIG_REMINDER_POST_SHIFT_FEEDBACK_ENABLED     => true,
        self::CONFIG_REMINDER_POST_SHIFT_FEEDBACK_HOURS_AFTER => 2,
        self::CONFIG_REMINDER_LAPSED_VOLUNTEER_ENABLED        => true,
        self::CONFIG_REMINDER_LAPSED_VOLUNTEER_DAYS_INACTIVE  => 30,
        self::CONFIG_REMINDER_CREDENTIAL_EXPIRY_ENABLED       => true,
        self::CONFIG_REMINDER_CREDENTIAL_EXPIRY_DAYS_BEFORE   => 30,
        self::CONFIG_REMINDER_TRAINING_EXPIRY_ENABLED         => true,
        self::CONFIG_REMINDER_TRAINING_EXPIRY_DAYS_BEFORE     => 14,
        // Expenses
        self::CONFIG_EXPENSES_ENABLED             => true,
        self::CONFIG_EXPENSE_REQUIRE_RECEIPT       => false,
        self::CONFIG_EXPENSE_MAX_AMOUNT           => 500,
        // Safety
        self::CONFIG_GUARDIAN_CONSENT_REQUIRED     => false,
        // Features
        self::CONFIG_ENABLE_QR_CHECKIN            => true,
        self::CONFIG_ENABLE_RECURRING_SHIFTS      => true,
        self::CONFIG_ENABLE_REVIEWS               => true,
        self::CONFIG_ENABLE_MATCHING              => true,
    ];

    /**
     * Inclusive [min, max] for every numeric setting. The admin window shows
     * these on its number boxes, but a browser does not stop a typed value, so
     * AdminConfigController's bulk save refuses the whole request when any
     * value is outside its range. Every integer in DEFAULTS has an entry
     * (pinned by VolunteeringConfigurationServiceTest). The sweeps also use
     * the maximum as their tenant-discovery window.
     *
     * @var array<string, array{0: int, 1: int}>
     */
    public const RANGES = [
        self::CONFIG_CANCELLATION_DEADLINE_HOURS              => [0, 168],
        self::CONFIG_MAX_HOURS_PER_SHIFT                      => [1, 24],
        self::CONFIG_MIN_HOURS_FOR_CERTIFICATE                => [0, 100],
        self::CONFIG_REMINDER_PRE_SHIFT_HOURS_BEFORE          => [1, 168],
        self::CONFIG_REMINDER_POST_SHIFT_FEEDBACK_HOURS_AFTER => [1, 168],
        self::CONFIG_REMINDER_LAPSED_VOLUNTEER_DAYS_INACTIVE  => [1, 365],
        self::CONFIG_REMINDER_CREDENTIAL_EXPIRY_DAYS_BEFORE   => [1, 90],
        self::CONFIG_REMINDER_TRAINING_EXPIRY_DAYS_BEFORE     => [1, 90],
        self::CONFIG_EXPENSE_MAX_AMOUNT                       => [1, 10000],
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

    /**
     * A named community's value without switching TenantContext — for the
     * cron sweeps that loop over every tenant in one process. Stored value,
     * else DEFAULTS; there is deliberately no caller default (see get()).
     */
    public static function getForTenant(int $tenantId, string $key): mixed
    {
        if ($key === self::CONFIG_GUARDIAN_CONSENT_REQUIRED) {
            return false;
        }

        $allStored = self::getStoredValues($tenantId);

        if (array_key_exists($key, $allStored)) {
            return $allStored[$key];
        }

        return self::DEFAULTS[$key] ?? null;
    }

    /**
     * Whether an integer value sits inside the key's RANGES entry. Keys with
     * no range always pass.
     */
    public static function isWithinRange(string $key, int $value): bool
    {
        if (!isset(self::RANGES[$key])) {
            return true;
        }

        [$min, $max] = self::RANGES[$key];

        return $value >= $min && $value <= $max;
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
