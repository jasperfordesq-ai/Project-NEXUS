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
 * JobConfigurationService — typed config for jobs/vacancies module.
 *
 * Stores tenant-scoped job configuration in the tenant_settings table
 * with a 'jobs.' prefix. Covers tabs, posting rules, application pipeline,
 * moderation, and feature toggles.
 */
class JobConfigurationService
{
    // =========================================================================
    // Tab / Page visibility
    // =========================================================================

    public const CONFIG_TAB_BROWSE = 'jobs.tab_browse';
    public const CONFIG_TAB_SAVED = 'jobs.tab_saved';
    public const CONFIG_TAB_MY_POSTINGS = 'jobs.tab_my_postings';
    public const CONFIG_PAGE_KANBAN = 'jobs.page_kanban';
    public const CONFIG_PAGE_ANALYTICS = 'jobs.page_analytics';
    public const CONFIG_PAGE_BIAS_AUDIT = 'jobs.page_bias_audit';
    public const CONFIG_PAGE_TALENT_SEARCH = 'jobs.page_talent_search';
    public const CONFIG_PAGE_ALERTS = 'jobs.page_alerts';

    // =========================================================================
    // Job Types & Posting Rules
    // =========================================================================

    public const CONFIG_ALLOW_PAID = 'jobs.allow_paid';
    public const CONFIG_ALLOW_VOLUNTEER = 'jobs.allow_volunteer';
    public const CONFIG_ALLOW_TIMEBANK = 'jobs.allow_timebank';
    public const CONFIG_REQUIRE_SALARY = 'jobs.require_salary';
    public const CONFIG_DEFAULT_CURRENCY = 'jobs.default_currency';
    public const CONFIG_MAX_POSTINGS_PER_USER = 'jobs.max_postings_per_user';
    public const CONFIG_DEFAULT_DEADLINE_DAYS = 'jobs.default_deadline_days';

    // =========================================================================
    // Moderation & Approval
    // =========================================================================

    public const CONFIG_MODERATION_ENABLED = 'jobs.moderation_enabled';
    public const CONFIG_SPAM_DETECTION = 'jobs.spam_detection';
    public const CONFIG_AUTO_APPROVE_TRUSTED = 'jobs.auto_approve_trusted';

    // =========================================================================
    // Applications & Pipeline
    // =========================================================================

    public const CONFIG_ENABLE_CV_UPLOAD = 'jobs.enable_cv_upload';
    public const CONFIG_REQUIRE_COVER_MESSAGE = 'jobs.require_cover_message';
    public const CONFIG_ENABLE_INTERVIEW_SCHEDULING = 'jobs.enable_interview_scheduling';
    public const CONFIG_ENABLE_OFFERS = 'jobs.enable_offers';
    public const CONFIG_ENABLE_SCORECARDS = 'jobs.enable_scorecards';
    public const CONFIG_ENABLE_PIPELINE_RULES = 'jobs.enable_pipeline_rules';
    public const CONFIG_ENABLE_BLIND_HIRING = 'jobs.enable_blind_hiring';

    // =========================================================================
    // Features
    // =========================================================================

    public const CONFIG_ENABLE_FEATURED = 'jobs.enable_featured';
    public const CONFIG_FEATURED_DURATION_DAYS = 'jobs.featured_duration_days';
    public const CONFIG_ENABLE_AI_DESCRIPTIONS = 'jobs.enable_ai_descriptions';
    public const CONFIG_ENABLE_SKILLS_MATCHING = 'jobs.enable_skills_matching';
    public const CONFIG_ENABLE_REFERRALS = 'jobs.enable_referrals';
    public const CONFIG_ENABLE_TEMPLATES = 'jobs.enable_templates';
    public const CONFIG_ENABLE_RSS_FEED = 'jobs.enable_rss_feed';
    public const CONFIG_ENABLE_SAVED_PROFILES = 'jobs.enable_saved_profiles';
    public const CONFIG_ENABLE_EMPLOYER_BRANDING = 'jobs.enable_employer_branding';

    // =========================================================================
    // Default values
    // =========================================================================

    public const DEFAULTS = [
        // Tab / Page visibility
        self::CONFIG_TAB_BROWSE             => true,
        self::CONFIG_TAB_SAVED              => true,
        self::CONFIG_TAB_MY_POSTINGS        => true,
        self::CONFIG_PAGE_KANBAN            => true,
        self::CONFIG_PAGE_ANALYTICS         => true,
        self::CONFIG_PAGE_BIAS_AUDIT        => true,
        self::CONFIG_PAGE_TALENT_SEARCH     => true,
        self::CONFIG_PAGE_ALERTS            => true,
        // Job Types & Posting Rules
        self::CONFIG_ALLOW_PAID             => true,
        self::CONFIG_ALLOW_VOLUNTEER        => true,
        self::CONFIG_ALLOW_TIMEBANK         => true,
        self::CONFIG_REQUIRE_SALARY         => false,
        self::CONFIG_DEFAULT_CURRENCY       => 'EUR',
        self::CONFIG_MAX_POSTINGS_PER_USER  => 20,
        self::CONFIG_DEFAULT_DEADLINE_DAYS  => 30,
        // Moderation
        self::CONFIG_MODERATION_ENABLED     => false,
        self::CONFIG_SPAM_DETECTION         => true,
        self::CONFIG_AUTO_APPROVE_TRUSTED   => false,
        // Applications & Pipeline
        self::CONFIG_ENABLE_CV_UPLOAD               => true,
        self::CONFIG_REQUIRE_COVER_MESSAGE           => false,
        self::CONFIG_ENABLE_INTERVIEW_SCHEDULING     => true,
        self::CONFIG_ENABLE_OFFERS                   => true,
        self::CONFIG_ENABLE_SCORECARDS               => true,
        self::CONFIG_ENABLE_PIPELINE_RULES           => true,
        self::CONFIG_ENABLE_BLIND_HIRING             => false,
        // Features
        self::CONFIG_ENABLE_FEATURED            => true,
        self::CONFIG_FEATURED_DURATION_DAYS     => 7,
        self::CONFIG_ENABLE_AI_DESCRIPTIONS     => true,
        self::CONFIG_ENABLE_SKILLS_MATCHING     => true,
        self::CONFIG_ENABLE_REFERRALS           => true,
        self::CONFIG_ENABLE_TEMPLATES           => true,
        self::CONFIG_ENABLE_RSS_FEED            => true,
        self::CONFIG_ENABLE_SAVED_PROFILES      => true,
        self::CONFIG_ENABLE_EMPLOYER_BRANDING   => true,
    ];

    /** Cache TTL in seconds (5 minutes). */
    private const CACHE_TTL = 300;

    // =========================================================================
    // Public API
    // =========================================================================

    public static function get(string $key, mixed $default = null): mixed
    {
        $tenantId = TenantContext::getId();
        $allStored = self::getStoredValues($tenantId);

        if (array_key_exists($key, $allStored)) {
            return $allStored[$key];
        }

        return $default ?? self::DEFAULTS[$key] ?? null;
    }

    /** Return a saved override without substituting the module default. */
    public static function getStoredOverride(string $key): mixed
    {
        $stored = self::getStoredValues(TenantContext::getId());
        return $stored[$key] ?? null;
    }

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
                    ->update(['setting_value' => $storedValue, 'setting_type' => $settingType, 'updated_at' => now()]);
            } else {
                DB::table('tenant_settings')->insert([
                    'tenant_id' => $tenantId, 'setting_key' => $key,
                    'setting_value' => $storedValue, 'setting_type' => $settingType,
                    'created_at' => now(), 'updated_at' => now(),
                ]);
            }

            Cache::forget("job_config:{$tenantId}");
        } catch (\Throwable $e) {
            Log::error('JobConfigurationService::set failed', ['key' => $key, 'tenant_id' => $tenantId, 'error' => $e->getMessage()]);
            throw $e;
        }
    }

    public static function getAll(): array
    {
        $tenantId = TenantContext::getId();
        return array_merge(self::DEFAULTS, self::getStoredValues($tenantId));
    }

    // =========================================================================
    // Internal helpers
    // =========================================================================

    private static function getStoredValues(int $tenantId): array
    {
        return Cache::remember("job_config:{$tenantId}", self::CACHE_TTL, function () use ($tenantId) {
            try {
                $rows = DB::table('tenant_settings')
                    ->where('tenant_id', $tenantId)
                    ->where('setting_key', 'LIKE', 'jobs.%')
                    ->select('setting_key', 'setting_value', 'setting_type')
                    ->get();

                $result = [];
                foreach ($rows as $row) {
                    $result[$row->setting_key] = self::decodeValue($row->setting_value, $row->setting_type ?? 'string');
                }
                return $result;
            } catch (\Throwable $e) {
                Log::error('JobConfigurationService::getStoredValues failed', ['tenant_id' => $tenantId, 'error' => $e->getMessage()]);
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
