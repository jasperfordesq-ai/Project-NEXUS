<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Services\AuthenticationConfigurationService;
use App\Services\Auth\AuthenticationMethodGuard;
use App\Services\AuditLogService;
use App\Services\FederationFeatureService;
use App\Services\FeedRankingService;
use App\Services\EventConfigurationService;
use App\Services\GroupConfigurationService;
use App\Services\JobConfigurationService;
use App\Services\ListingConfigurationService;
use App\Services\ListingRankingService;
use App\Services\PodcastConfigurationService;
use App\Services\PrerenderContentInvalidator;
use App\Services\VolunteeringConfigurationService;
use App\Services\MemberRankingService;
use App\Services\NativeAppInstallStatsService;
use App\Services\RedisCache;
use App\Services\SearchService;
use App\Services\SmartMatchingEngine;
use App\Services\TenantFeatureConfig;
use App\Services\TenantSettingsService;
use App\Services\TenantHierarchyService;
use App\Support\OutboundUrlGuard;
use App\Jobs\RunAdminCronJob;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use App\Core\TenantContext;

/**
 * AdminConfigController -- Admin system configuration, features, modules, cache, jobs,
 * cron, AI, feed algorithm, SEO, image, language, native app, algorithm info.
 *
 * Fully converted from legacy delegation to direct service calls.
 */
class AdminConfigController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly ListingRankingService $listingRankingService,
        private readonly SmartMatchingEngine $smartMatchingEngine,
        private readonly RedisCache $redisCache,
        private readonly FederationFeatureService $federationFeatureService,
        private readonly FeedRankingService $feedRankingService,
        private readonly MemberRankingService $memberRankingService,
        private readonly SearchService $searchService,
        private readonly TenantSettingsService $tenantSettingsService,
        private readonly EventConfigurationService $eventConfigurationService,
    ) {}

    // ─────────────────────────────────────────────────────────────────────────
    // Constants (from legacy)
    // ─────────────────────────────────────────────────────────────────────────

    private const TENANT_DIRECT_COLUMNS = [
        'name', 'slug', 'domain', 'tagline', 'description',
        'contact_email', 'contact_phone', 'default_layout',
        'logo_url', 'favicon_url', 'primary_color', 'og_image_url',
        'meta_title', 'meta_description', 'h1_headline', 'hero_intro',
    ];

    /** Authentication feature switches are security policy, not delegated-admin controls. */
    private const SUPER_ADMIN_FEATURES = [
        'two_factor_authentication',
        'biometric_login',
    ];

    private const GENERAL_SETTING_KEYS = [
        'timezone', 'registration_mode', 'welcome_message',
        'maintenance_mode', 'default_currency', 'date_format',
        'time_format', 'items_per_page', 'max_upload_size_mb',
        'email_verification', 'admin_approval', 'welcome_credits',
        'footer_text',
        'partner_logo_url',
        'partner_logo_label',
        'partner_logo_link_url',
        'powered_by_label',
        'powered_by_url',
        'powered_by_image_light',
        'powered_by_image_dark',
        'map_provider', 'geocoding_provider',
        'google_maps_api_key', 'google_maps_map_id', 'maptiler_api_key',
        'os_maps_api_key',
        'inactivity_timeout_minutes',
    ];

    /**
     * Settings that only a platform super-admin (God) may modify.
     * Tenant admins and tenant super-admins are rejected with 403.
     */
    private const PLATFORM_SUPER_ADMIN_ONLY_KEYS = [
        'email_verification',
        'admin_approval',
    ];

    /**
     * Settings that require a super-admin — a regular (delegated) tenant admin may NOT
     * change them. maintenance_mode takes the whole tenant offline, so it is gated above
     * generic admin: a tenant-super-admin (the community's own top admin) or a platform
     * super-admin may set it; a regular admin is rejected with 403. (SEC-003, 2026-06-21.)
     */
    private const SUPER_ADMIN_ONLY_KEYS = [
        'maintenance_mode',
    ];

    /**
     * Settings whose stored value contains a credential and should be
     * returned masked from getSettings (e.g. "AIza••••••••YJ4") so the
     * admin UI can show whether a key is configured without leaking it.
     * The full value is sent to browsers via MapsConfigController only
     * when the corresponding map/geocoding provider is selected.
     */
    private const SECRET_KEYS = [
        'google_maps_api_key', 'maptiler_api_key', 'os_maps_api_key',
    ];

    private const FEED_ALGO_DEFAULTS = [
        'feed_algo_recency_weight' => '0.35',
        'feed_algo_engagement_weight' => '0.25',
        'feed_algo_relevance_weight' => '0.20',
        'feed_algo_connection_weight' => '0.15',
        'feed_algo_diversity_weight' => '0.05',
        'feed_algo_recency_decay_hours' => '48',
        'feed_algo_engagement_half_life_hours' => '24',
        'feed_algo_boost_images' => '1',
        'feed_algo_boost_polls' => '1',
        'feed_algo_penalize_links_only' => '0',
        'feed_algo_min_score' => '0.01',
    ];

    private const IMAGE_DEFAULTS = [
        'image_max_size_mb' => '10',
        'image_max_width' => '2048',
        'image_max_height' => '2048',
        'image_auto_webp' => '1',
        'image_auto_resize' => '1',
        'image_strip_exif' => '1',
        'image_webp_quality' => '85',
        'image_thumbnail_width' => '300',
        'image_thumbnail_height' => '300',
        'image_lazy_loading' => '1',
        'image_serving_enabled' => '1',
    ];

    private const SEO_DEFAULTS = [
        'seo_title_suffix' => '',
        'seo_meta_description' => '',
        'seo_meta_keywords' => '',
        'seo_og_image_url' => '',
        'seo_auto_sitemap' => '1',
        'seo_canonical_urls' => '1',
        'seo_open_graph' => '1',
        'seo_twitter_cards' => '1',
        'seo_robots_txt' => '',
        'seo_google_verification' => '',
        'seo_bing_verification' => '',
    ];

    private const NATIVE_APP_DEFAULTS = [
        'native_app_name' => '',
        'native_app_short_name' => '',
        'native_app_bundle_id' => '',
        'native_app_package_name' => '',
        'native_app_version' => '1.0.0',
        'native_app_push_enabled' => '0',
        'native_app_fcm_server_key' => '',
        'native_app_apns_key_id' => '',
        'native_app_apns_team_id' => '',
        'native_app_service_worker' => '1',
        'native_app_install_prompt' => '1',
        'native_app_theme_color' => '#1976D2',
        'native_app_background_color' => '#ffffff',
        'native_app_display' => 'standalone',
        'native_app_orientation' => 'portrait',
        'native_app_store_mode' => 'shared',
        'native_app_build_profile' => 'preview',
        'native_app_ios_app_store_id' => '',
        'native_app_android_play_store_id' => '',
        'native_app_marketing_url' => '',
        'native_app_privacy_url' => '',
        'native_app_support_url' => '',
        'native_app_push_sender_id' => '',
        'native_app_tenant_channel_prefix' => '',
    ];

    private const NATIVE_APP_SENSITIVE_KEYS = ['native_app_fcm_server_key', 'native_app_apns_key_id'];

    private const VALID_LANGUAGES = ['en', 'ga', 'de', 'fr', 'it', 'pt', 'es', 'nl', 'pl', 'ja', 'ar'];

    // =========================================================================
    // Config (already native)
    // =========================================================================

    /** GET /api/v2/admin/config */
    public function getConfig(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $tenant = DB::selectOne("SELECT features, configuration FROM tenants WHERE id = ?", [$tenantId]);

        $features = TenantFeatureConfig::FEATURE_DEFAULTS;
        if ($tenant && !empty($tenant->features)) {
            $dbFeatures = json_decode($tenant->features, true) ?: [];
            foreach ($dbFeatures as $key => $value) {
                if (array_key_exists($key, $features)) {
                    $features[$key] = (bool) $value;
                }
            }
        }

        $modules = TenantFeatureConfig::MODULE_DEFAULTS;
        if ($tenant && !empty($tenant->configuration)) {
            $config = json_decode($tenant->configuration, true) ?: [];
            $dbModules = $config['modules'] ?? [];
            foreach ($dbModules as $key => $value) {
                if (array_key_exists($key, $modules)) {
                    $modules[$key] = (bool) $value;
                }
            }
        }

        return $this->respondWithData([
            'tenant_id' => $tenantId,
            'features' => $features,
            'modules' => $modules,
            'security_impact' => [
                'biometric_login' => $this->passkeyDisableImpact($tenantId),
            ],
        ]);
    }

    /** PUT /api/v2/admin/config/features */
    public function updateFeature(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $featureName = $this->input('feature');
        $enabled = $this->input('enabled');

        if (!$featureName || !is_string($featureName)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.feature_name_required'), 'feature', 422);
        }
        if (!array_key_exists($featureName, TenantFeatureConfig::FEATURE_DEFAULTS)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.unknown_feature', ['feature' => $featureName]), 'feature', 422);
        }
        if (!is_bool($enabled)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.enabled_required'), 'enabled', 422);
        }

        if (in_array($featureName, self::SUPER_ADMIN_FEATURES, true)) {
            $this->requireSuperAdmin();
        }

        if (
            $featureName === 'biometric_login'
            && $enabled === false
            && $this->input('confirm_disable') !== true
        ) {
            return $this->respondWithError(
                'PASSKEY_DISABLE_CONFIRMATION_REQUIRED',
                __('api.validation_failed'),
                'confirm_disable',
                409
            );
        }

        try {
            DB::transaction(function () use ($tenantId, $featureName, $enabled): void {
                $tenant = DB::table('tenants')
                    ->where('id', $tenantId)
                    ->select('features')
                    ->lockForUpdate()
                    ->first();
                $features = ($tenant && !empty($tenant->features))
                    ? (json_decode((string) $tenant->features, true) ?: [])
                    : [];
                $features[$featureName] = (bool) $enabled;
                DB::update("UPDATE tenants SET features = ? WHERE id = ?", [json_encode($features), $tenantId]);

                if ($featureName === 'federation') {
                    if ((bool) $enabled) {
                        $this->federationFeatureService->enableTenantFeature(FederationFeatureService::TENANT_FEDERATION_ENABLED, $tenantId);
                    } else {
                        $this->federationFeatureService->disableTenantFeature(FederationFeatureService::TENANT_FEDERATION_ENABLED, $tenantId);
                    }
                }

                app(PrerenderContentInvalidator::class)->refreshTenantOrFail($tenantId, true, true);
            });
        } catch (\Throwable $e) {
            report($e);
            return $this->respondWithError('PRERENDER_REFRESH_FAILED', __('api.prerender_reset_failed'), null, 503);
        }

        $this->redisCache->delete('tenant_bootstrap', $tenantId);
        $this->redisCache->delete('tenants_list_public');
        $this->redisCache->delete('tenants_list_public_all');

        if ($featureName === 'biometric_login') {
            app(AuditLogService::class)->logAdminAction(
                $enabled ? 'passkey_authentication_enabled' : 'passkey_authentication_disabled',
                (int) auth()->id(),
                null,
                [
                    'tenant_id' => $tenantId,
                    'enabled' => $enabled,
                    'impact' => $this->passkeyDisableImpact($tenantId),
                ]
            );
        }

        return $this->respondWithData(['feature' => $featureName, 'enabled' => (bool) $enabled]);
    }

    /**
     * @return array{credential_count: int, registered_users: int, passkey_only_users: int}
     */
    private function passkeyDisableImpact(int $tenantId): array
    {
        if (!Schema::hasTable('webauthn_credentials') || !Schema::hasTable('users')) {
            return ['credential_count' => 0, 'registered_users' => 0, 'passkey_only_users' => 0];
        }

        $credentialCount = DB::table('webauthn_credentials as wc')
            ->join('users as u', function ($join): void {
                $join->on('u.id', '=', 'wc.user_id')
                    ->on('u.tenant_id', '=', 'wc.tenant_id');
            })
            ->where('wc.tenant_id', $tenantId)
            ->count();

        $registeredUsers = DB::table('webauthn_credentials as wc')
            ->join('users as u', function ($join): void {
                $join->on('u.id', '=', 'wc.user_id')
                    ->on('u.tenant_id', '=', 'wc.tenant_id');
            })
            ->where('wc.tenant_id', $tenantId)
            ->distinct()
            ->count('wc.user_id');

        $passkeyOnly = DB::table('webauthn_credentials as wc')
            ->join('users as u', function ($join): void {
                $join->on('u.id', '=', 'wc.user_id')
                    ->on('u.tenant_id', '=', 'wc.tenant_id');
            })
            ->where('wc.tenant_id', $tenantId)
            ->where(function ($query): void {
                $query->whereNull('u.password_hash')->orWhere('u.password_hash', '');
            });

        $enabledProviders = AuthenticationMethodGuard::enabledIdentityProviders($tenantId);
        if (Schema::hasTable('oauth_identities') && $enabledProviders !== []) {
            $passkeyOnly->whereNotExists(function ($query) use ($tenantId, $enabledProviders): void {
                $query->selectRaw('1')
                    ->from('oauth_identities as oi')
                    ->whereColumn('oi.user_id', 'u.id')
                    ->where('oi.tenant_id', $tenantId)
                    ->whereIn('oi.provider', $enabledProviders);
            });
        }

        return [
            'credential_count' => (int) $credentialCount,
            'registered_users' => (int) $registeredUsers,
            'passkey_only_users' => (int) $passkeyOnly->distinct()->count('wc.user_id'),
        ];
    }

    /** PUT /api/v2/admin/config/modules */
    public function updateModule(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $moduleName = $this->input('module');
        $enabled = $this->input('enabled');

        if (!$moduleName || !is_string($moduleName)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.module_name_required'), 'module', 422);
        }
        if (!array_key_exists($moduleName, TenantFeatureConfig::MODULE_DEFAULTS)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.unknown_module', ['module' => $moduleName]), 'module', 422);
        }
        if ($enabled === null) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.enabled_required'), 'enabled', 422);
        }

        $tenant = DB::selectOne("SELECT configuration FROM tenants WHERE id = ?", [$tenantId]);
        $config = ($tenant && !empty($tenant->configuration)) ? (json_decode($tenant->configuration, true) ?: []) : [];
        if (!isset($config['modules'])) {
            $config['modules'] = TenantFeatureConfig::MODULE_DEFAULTS;
        }
        $config['modules'][$moduleName] = (bool) $enabled;

        try {
            DB::transaction(function () use ($config, $tenantId): void {
                DB::update("UPDATE tenants SET configuration = ? WHERE id = ?", [json_encode($config), $tenantId]);
                app(PrerenderContentInvalidator::class)->refreshTenantOrFail($tenantId, true, true);
            });
        } catch (\Throwable $e) {
            report($e);
            return $this->respondWithError('PRERENDER_REFRESH_FAILED', __('api.prerender_reset_failed'), null, 503);
        }
        $this->redisCache->delete('tenant_bootstrap', $tenantId);

        return $this->respondWithData(['module' => $moduleName, 'enabled' => (bool) $enabled]);
    }

    // =========================================================================
    // Cache (already native)
    // =========================================================================

    /** GET /api/v2/admin/config/cache-stats */
    public function cacheStats(): JsonResponse
    {
        $this->requireAdmin();
        $stats = $this->redisCache->getStats();

        return $this->respondWithData([
            'redis_connected' => $stats['enabled'] ?? false,
            'redis_memory_used' => $stats['memory_used'] ?? '0B',
            'redis_keys_count' => $stats['total_keys'] ?? 0,
            'cache_hit_rate' => 0.0,
        ]);
    }

    /** POST /api/v2/admin/config/clear-cache */
    public function clearCache(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $type = $this->input('type', 'tenant');

        try {
            if ($type === 'all') {
                // Cross-tenant cache clear requires super admin privileges
                $this->requireSuperAdmin();
                foreach ([1, 2, 3, 4, 5] as $tid) {
                    $this->redisCache->clearTenant($tid);
                }
            } else {
                $this->redisCache->clearTenant($tenantId);
            }
        } catch (\Throwable $e) {
            return $this->respondWithError('SERVER_ERROR', __('api.failed_to_clear_cache'), null, 500);
        }

        return $this->respondWithData(['cleared' => true, 'type' => $type]);
    }

    // =========================================================================
    // Jobs (already native)
    // =========================================================================

    /** GET /api/v2/admin/config/jobs */
    public function getJobs(): JsonResponse
    {
        $this->requireAdmin();

        // job_id values written by CronJobRunner for each of these tasks
        $cronIdMap = [
            'digest_emails'  => 'daily-digest',
            'badge_checker'  => 'gamification-daily',
            'streak_updater' => 'gamification-streaks',
        ];

        $lastRuns = [];
        try {
            $rows = DB::select(
                "SELECT cl.job_id, cl.status, cl.executed_at
                 FROM cron_logs cl
                 INNER JOIN (
                     SELECT job_id, MAX(executed_at) AS max_date
                     FROM cron_logs
                     WHERE job_id IN (?, ?, ?) AND tenant_id IS NULL
                     GROUP BY job_id
                 ) latest ON cl.job_id = latest.job_id AND cl.executed_at = latest.max_date",
                array_values($cronIdMap)
            );
            foreach ($rows as $row) {
                $lastRuns[$row->job_id] = ['last_run_at' => $row->executed_at, 'status' => $row->status];
            }
        } catch (\Throwable) {}

        $definitions = ['digest_emails', 'badge_checker', 'streak_updater'];

        $jobs = array_map(function (string $jobId) use ($cronIdMap, $lastRuns) {
            $cronId = $cronIdMap[$jobId];
            $run    = $lastRuns[$cronId] ?? null;
            return [
                'id'          => $jobId,
                'translation_key' => $jobId,
                'status'      => $run ? $run['status'] : 'idle',
                'last_run_at' => $run ? $run['last_run_at'] : null,
                'next_run_at' => null,
            ];
        }, $definitions);

        return $this->respondWithData($jobs);
    }

    /** POST /api/v2/admin/background-jobs/{id}/run */
    public function runJob(string $id): JsonResponse
    {
        $this->requirePlatformSuperAdmin();

        $methodMap = [
            'digest_emails'  => 'dailyDigest',
            'badge_checker'  => 'gamificationDaily',
            'streak_updater' => 'gamificationStreaks',
        ];

        if (!isset($methodMap[$id])) {
            return $this->respondWithError('Unknown job: ' . $id, 400);
        }

        RunAdminCronJob::dispatch($methodMap[$id]);

        return $this->respondWithData(['triggered' => true, 'job' => $id]);
    }

    // =========================================================================
    // Cron Jobs
    // =========================================================================

    /** GET /api/v2/admin/config/cron-jobs */
    public function getCronJobs(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $jobs = $this->getCronJobDefinitions();

        $lastRuns = [];
        try {
            $results = DB::select("
                SELECT cl1.job_id, cl1.status, cl1.executed_at
                FROM cron_logs cl1
                INNER JOIN (
                    SELECT job_id, MAX(executed_at) as max_date
                    FROM cron_logs
                    WHERE tenant_id = ?
                    GROUP BY job_id
                ) cl2 ON cl1.job_id = cl2.job_id AND cl1.executed_at = cl2.max_date
                WHERE cl1.tenant_id = ?
            ", [$tenantId, $tenantId]);

            foreach ($results as $row) {
                $lastRuns[$row->job_id] = [
                    'last_run_at' => $row->executed_at,
                    'last_status' => $row->status === 'running' ? null : $row->status,
                ];
            }
        } catch (\Throwable $e) {
            // cron_logs table may not exist yet
        }

        $jobSettings = [];
        try {
            $results = DB::select("SELECT job_id, is_enabled FROM cron_job_settings");
            foreach ($results as $row) {
                $jobSettings[$row->job_id] = (int) $row->is_enabled;
            }
        } catch (\Throwable $e) {
            // Table may not exist yet
        }

        $response = [];
        $numericId = 1;
        foreach ($jobs as $job) {
            $jobId = $job['id'];
            $isEnabled = $jobSettings[$jobId] ?? 1;
            $lastRun = $lastRuns[$jobId] ?? null;

            $response[] = [
                'id' => $numericId,
                'slug' => $jobId,
                'translation_key' => str_replace('-', '_', $jobId),
                'command' => $job['command'],
                'schedule' => $job['schedule'],
                'status' => $isEnabled ? 'active' : 'disabled',
                'category' => $job['category'],
                'last_run_at' => $lastRun['last_run_at'] ?? null,
                'last_status' => $lastRun['last_status'] ?? null,
                'next_run_at' => $this->calculateNextRun($job['schedule']),
            ];
            $numericId++;
        }

        return $this->respondWithData($response);
    }

    /** POST /api/v2/admin/config/cron-jobs/run */
    public function runCronJob(): JsonResponse
    {
        $adminId = $this->requirePlatformSuperAdmin();
        $tenantId = TenantContext::getId();

        $uri = request()->getRequestUri();
        preg_match('#/api/v2/admin/system/cron-jobs/(\d+)/run#', $uri, $matches);
        $numericId = (int) ($matches[1] ?? 0);

        if ($numericId < 1) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_id', ['resource' => 'job']), 'id', 400);
        }

        $jobs = $this->getCronJobDefinitions();
        $jobIndex = $numericId - 1;

        if (!isset($jobs[$jobIndex])) {
            return $this->respondWithError('NOT_FOUND', __('api.cron_job_not_found'), 'id', 404);
        }

        $job = $jobs[$jobIndex];
        $jobSlug = $job['id'];

        try {
            $setting = DB::selectOne("SELECT is_enabled FROM cron_job_settings WHERE job_id = ?", [$jobSlug]);
            if ($setting && !$setting->is_enabled) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.cannot_run_disabled_job'), 'status', 422);
            }
        } catch (\Throwable $e) {
            // Table may not exist
        }

        // Ensure cron_logs table exists
        try {
            DB::statement("
                CREATE TABLE IF NOT EXISTS cron_logs (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    job_id VARCHAR(100) NOT NULL,
                    status ENUM('success', 'error', 'running') DEFAULT 'running',
                    output TEXT,
                    duration_seconds DECIMAL(10,2),
                    executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    executed_by INT,
                    tenant_id INT,
                    INDEX idx_job_id (job_id),
                    INDEX idx_executed_at (executed_at)
                )
            ");
        } catch (\Throwable $e) {
            // Already exists
        }

        $startTime = microtime(true);
        $logId = null;

        try {
            DB::insert(
                "INSERT INTO cron_logs (job_id, status, output, duration_seconds, executed_by, tenant_id) VALUES (?, 'running', 'Job started via API...', 0, ?, ?)",
                [$jobSlug, $adminId, $tenantId]
            );
            $logId = DB::getPdo()->lastInsertId();
        } catch (\Throwable $e) {
            // Ignore log creation failure
        }

        $output = '';
        $status = 'success';

        // Build allowlist of permitted script paths from hardcoded job definitions
        $allowedScripts = [];
        foreach ($this->getCronJobDefinitions() as $def) {
            if (isset($def['command']) && strpos($def['command'], 'scripts/') === 0) {
                $scriptParts = explode(' ', $def['command']);
                $allowedScripts[] = $scriptParts[0];
            }
        }

        try {
            if (isset($job['command']) && strpos($job['command'], 'scripts/') === 0) {
                $parts = explode(' ', $job['command']);
                $scriptRelative = $parts[0];
                $args = $parts[1] ?? '';

                // Validate script is in the allowlist and contains no path traversal
                if (!in_array($scriptRelative, $allowedScripts, true) || str_contains($scriptRelative, '..')) {
                    $output = "Script not permitted: {$scriptRelative}";
                    $status = 'error';
                } else {
                    $script = dirname(__DIR__, 4) . '/' . $scriptRelative;

                    if (file_exists($script)) {
                        if (!defined('CRON_INTERNAL_RUN')) {
                            define('CRON_INTERNAL_RUN', true);
                        }
                        $oldArgv = $GLOBALS['argv'] ?? [];
                        $oldArgc = $GLOBALS['argc'] ?? 0;
                        $GLOBALS['argv'] = [basename($script), $args];
                        $GLOBALS['argc'] = count($GLOBALS['argv']);

                        // Legacy script inclusion — retained for backward compatibility with admin-triggered scripts
                        ob_start();
                        try {
                            include $script;
                            $output = ob_get_clean() ?: 'Completed (no output)';
                        } catch (\Throwable $e) {
                            $output = ob_get_clean() . "\nError: " . $e->getMessage();
                            $status = 'error';
                        }

                        $GLOBALS['argv'] = $oldArgv;
                        $GLOBALS['argc'] = $oldArgc;
                    } else {
                        $output = "Script not found: {$script}";
                        $status = 'error';
                    }
                }
            } else {
                if (!defined('CRON_INTERNAL_RUN')) {
                    define('CRON_INTERNAL_RUN', true);
                }

                $cronKey = \App\Core\Env::get('CRON_KEY');

                // Maps admin panel job IDs → CronJobRunner public method names.
                // Every job in getCronJobDefinitions() must have an entry here
                // or in $adminMethodMap below.
                $methodMap = [
                    // Master
                    'run-all' => 'runAll',
                    // Notifications
                    'process-queue' => 'runInstantQueue',
                    'daily-digest' => 'dailyDigest',
                    'weekly-digest' => 'weeklyDigest',
                    // Newsletters
                    'process-newsletters' => 'processNewsletters',
                    'process-recurring' => 'processRecurring',
                    'process-newsletter-queue' => 'processNewsletterQueue',
                    // Matching
                    'notify-hot-matches' => 'notifyHotMatches',
                    'match-digest-daily' => 'matchDigestDaily',
                    'match-digest-weekly' => 'matchDigestWeekly',
                    // Gamification
                    'gamification-daily' => 'gamificationDaily',
                    'gamification-campaigns' => 'gamificationCampaigns',
                    'gamification-leaderboard' => 'gamificationLeaderboard',
                    'gamification-challenges' => 'gamificationChallenges',
                    'gamification-weekly-digest' => 'gamificationWeeklyDigest',
                    'gamification-streaks' => 'gamificationStreaks',
                    'gamification-cleanup' => 'gamificationCleanup',
                    // Groups
                    'group-weekly-digest' => 'groupWeeklyDigest',
                    // Security
                    'abuse-detection' => 'abuseDetection',
                    'abuse-daily-report' => 'abuseDailyReport',
                    'abuse-cleanup' => 'abuseCleanup',
                    // Verification
                    'verification-reminders' => 'verificationReminders',
                    'expire-verifications' => 'expireVerifications',
                    'purge-verification-sessions' => 'purgeVerificationSessions',
                    // Volunteering
                    'volunteer-pre-shift' => 'volunteerPreShiftReminders',
                    'volunteer-post-shift' => 'volunteerPostShiftFeedback',
                    'volunteer-lapsed-nudge' => 'volunteerLapsedNudge',
                    'volunteer-expiry-warnings' => 'volunteerExpiryWarnings',
                    'recurring-shifts' => 'recurringShifts',
                    'volunteer-expire-consents' => 'volunteerExpireConsents',
                    // Maintenance
                    'cleanup' => 'cleanup',
                    'geocode-batch' => 'geocodeBatch',
                    'event-reminders' => 'eventReminders',
                    'inactive-members' => 'inactiveMembers',
                    'listing-expiry' => 'listingExpiry',
                    'listing-expiry-reminders' => 'listingExpiryReminders',
                    'job-expiry' => 'jobExpiry',
                    'federation-weekly-digest' => 'federationWeeklyDigest',
                    'balance-alerts' => 'balanceAlerts',
                    'goal-reminders' => 'goalReminders',
                    'retry-failed-webhooks' => 'retryFailedWebhooks',
                ];

                $adminMethodMap = [
                    'update-featured-groups' => 'cronUpdateFeaturedGroups',
                ];

                if (isset($methodMap[$jobSlug])) {
                    // CronJobRunner handles all cron jobs via direct service calls.
                    // Scheduling is handled by bootstrap/app.php (Laravel scheduler).
                    if (!class_exists('\App\Services\CronJobRunner')) {
                        $output = "CronJobRunner not available — job '{$jobSlug}' requires App\\Services\\CronJobRunner";
                        $status = 'error';
                    } else {
                        $controller = new \App\Services\CronJobRunner();
                        $method = $methodMap[$jobSlug];
                        ob_start();
                        request()->query->set('key', $cronKey);
                        $controller->$method();
                        request()->query->remove('key');
                        $output = ob_get_clean() ?: 'Completed (no output)';
                    }
                } elseif (isset($adminMethodMap[$jobSlug])) {
                    // Direct service call — no legacy controller delegation
                    if ($jobSlug === 'update-featured-groups') {
                        $stats = \App\Services\SmartGroupRankingService::updateAllFeaturedGroups();
                        $output = 'Featured groups updated. Stats: ' . json_encode($stats);
                    } else {
                        $output = "No direct implementation for admin job: {$jobSlug}";
                        $status = 'error';
                    }
                } else {
                    $output = "No method mapping for job: {$jobSlug}";
                    $status = 'error';
                }
            }
        } catch (\Throwable $e) {
            $output = "Exception: " . $e->getMessage();
            $status = 'error';
        }

        $duration = microtime(true) - $startTime;

        if ($logId) {
            try {
                DB::update(
                    "UPDATE cron_logs SET status = ?, output = ?, duration_seconds = ? WHERE id = ?",
                    [$status, substr($output, 0, 65000), round($duration, 2), $logId]
                );
            } catch (\Throwable $e) {
                // Ignore log update failure
            }
        }

        return $this->respondWithData([
            'triggered' => true,
            'job_slug' => $jobSlug,
            'job_translation_key' => str_replace('-', '_', $jobSlug),
            'status' => $status,
            'duration' => round($duration, 2),
            'output' => substr($output, 0, 500),
        ]);
    }

    // =========================================================================
    // Settings
    // =========================================================================

    /** GET /api/v2/admin/config/settings */
    public function getSettings(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $tenantRow = DB::selectOne("SELECT * FROM tenants WHERE id = ?", [$tenantId]);
        if (!$tenantRow) {
            return $this->respondWithError('NOT_FOUND', __('api.tenant_not_found'), null, 404);
        }
        $tenant = (array)$tenantRow;

        $directSettings = [];
        foreach (self::TENANT_DIRECT_COLUMNS as $col) {
            $directSettings[$col] = $tenant[$col] ?? null;
        }

        $kvSettings = $this->readSettingsByPrefix($tenantId, 'general.');
        $generalSettings = [];
        foreach (self::GENERAL_SETTING_KEYS as $key) {
            $value = $kvSettings['general.' . $key] ?? null;
            // Mask secret values so they can be shown in the admin UI
            // ("set / not set" + a glance-able tail) without leaking the
            // full credential into JSON responses or logs.
            if ($value !== null && $value !== '' && in_array($key, self::SECRET_KEYS, true)) {
                $generalSettings[$key] = $this->maskSecret($value);
                $generalSettings[$key . '_set'] = true;
            } else {
                $generalSettings[$key] = $value;
                if (in_array($key, self::SECRET_KEYS, true)) {
                    $generalSettings[$key . '_set'] = false;
                }
            }
        }

        // Accessible (GOV.UK alpha) header colours live in tenants.configuration
        // (next to the header logo), not the tenant_settings KV table. Surface
        // them here so the admin colour pickers prefill with the current values.
        $config = !empty($tenant['configuration'])
            ? (json_decode((string) $tenant['configuration'], true) ?: [])
            : [];
        $generalSettings['header_bg_color'] = is_string($config['header_bg_color'] ?? null) ? $config['header_bg_color'] : null;
        $generalSettings['header_accent_color'] = is_string($config['header_accent_color'] ?? null) ? $config['header_accent_color'] : null;

        return $this->respondWithData([
            'tenant_id' => $tenantId,
            'tenant' => $directSettings,
            'settings' => $generalSettings,
        ]);
    }

    /**
     * Reduce a credential to "first4…last4" — enough for an admin to spot
     * which key is configured without exposing the secret.
     */
    private function maskSecret(string $value): string
    {
        $len = strlen($value);
        if ($len <= 8) {
            return str_repeat('•', $len);
        }
        return substr($value, 0, 4) . str_repeat('•', max(4, $len - 8)) . substr($value, -4);
    }

    /** POST /api/v2/admin/settings/partner-logo */
    public function uploadPartnerLogo(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $this->rateLimit('admin_logo_upload', 10, 60);

        $file = request()->file('logo');
        if (!$file || !$file->isValid()) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.file_required'), 'logo', 400);
        }

        // Only allow image types
        $mime = $file->getMimeType();
        if (!in_array($mime, ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'], true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.admin_image_invalid_type'), 'logo', 422);
        }

        // Max 2 MB
        if ($file->getSize() > 2 * 1024 * 1024) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.admin_image_size_limit_2mb'), 'logo', 422);
        }

        try {
            $fileArray = [
                'name'     => $file->getClientOriginalName(),
                'type'     => $file->getMimeType(),
                'tmp_name' => $file->getRealPath(),
                'error'    => UPLOAD_ERR_OK,
                'size'     => $file->getSize(),
            ];

            $imageUrl = \App\Core\ImageUploader::upload($fileArray, 'partner-logos');

            // Persist as a general setting
            DB::transaction(function () use ($tenantId, $imageUrl): void {
                DB::table('tenant_settings')->updateOrInsert(
                    ['tenant_id' => $tenantId, 'setting_key' => 'general.partner_logo_url'],
                    ['setting_value' => $imageUrl, 'updated_at' => now()]
                );
                app(PrerenderContentInvalidator::class)->refreshTenantOrFail($tenantId, true);
            });

            // Bust the cached bootstrap payload so the footer picks up the new
            // logo immediately instead of serving stale cached config (10-min TTL).
            $this->redisCache->delete('tenant_bootstrap', $tenantId);
            $this->tenantSettingsService->clearCacheForTenant($tenantId);

            return $this->respondWithData(['url' => $imageUrl]);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::error('Partner logo upload failed', ['error' => $e->getMessage(), 'tenant_id' => $tenantId]);
            return $this->respondWithError('UPLOAD_FAILED', __('api.failed_upload_image'), 'logo', 500);
        }
    }

    /** POST /api/v2/admin/settings/powered-by-image-light */
    public function uploadPoweredByImageLight(): JsonResponse
    {
        return $this->uploadPoweredByImage('light');
    }

    /** POST /api/v2/admin/settings/powered-by-image-dark */
    public function uploadPoweredByImageDark(): JsonResponse
    {
        return $this->uploadPoweredByImage('dark');
    }

    private function uploadPoweredByImage(string $variant): JsonResponse
    {
        $adminId  = $this->requireAdmin();
        $tenantId = TenantContext::getId();

        if (!\App\Models\User::isGod($adminId)) {
            return $this->respondWithError('AUTH_INSUFFICIENT_PERMISSIONS', __('api.god_level_access_required'), null, 403);
        }

        $this->rateLimit('admin_logo_upload', 10, 60);

        $file = request()->file('logo');
        if (!$file || !$file->isValid()) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.file_required'), 'logo', 400);
        }

        $mime = $file->getMimeType();
        if (!in_array($mime, ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'], true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.admin_image_invalid_type'), 'logo', 422);
        }

        if ($file->getSize() > 2 * 1024 * 1024) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.admin_image_size_limit_2mb'), 'logo', 422);
        }

        try {
            $fileArray = [
                'name'     => $file->getClientOriginalName(),
                'type'     => $file->getMimeType(),
                'tmp_name' => $file->getRealPath(),
                'error'    => UPLOAD_ERR_OK,
                'size'     => $file->getSize(),
            ];

            $imageUrl   = \App\Core\ImageUploader::upload($fileArray, 'powered-by-images');
            $settingKey = "general.powered_by_image_{$variant}";

            DB::transaction(function () use ($tenantId, $settingKey, $imageUrl): void {
                DB::table('tenant_settings')->updateOrInsert(
                    ['tenant_id' => $tenantId, 'setting_key' => $settingKey],
                    ['setting_value' => $imageUrl, 'updated_at' => now()]
                );
                app(PrerenderContentInvalidator::class)->refreshTenantOrFail($tenantId, true);
            });

            // Bust the cached bootstrap payload so the footer (and the SPA's
            // refreshTenant()) pick up the new image immediately instead of
            // serving the stale cached config for up to the 10-minute TTL.
            $this->redisCache->delete('tenant_bootstrap', $tenantId);
            $this->tenantSettingsService->clearCacheForTenant($tenantId);

            return $this->respondWithData(['url' => $imageUrl]);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::error('Powered-by image upload failed', [
                'variant'   => $variant,
                'error'     => $e->getMessage(),
                'tenant_id' => $tenantId,
            ]);
            return $this->respondWithError('UPLOAD_FAILED', __('api.failed_upload_image'), 'logo', 500);
        }
    }

    /** POST /api/v2/admin/settings/header-logo */
    public function uploadHeaderLogo(): JsonResponse
    {
        return $this->uploadHeaderLogoVariant('light');
    }

    /** POST /api/v2/admin/settings/header-logo-dark */
    public function uploadHeaderLogoDark(): JsonResponse
    {
        return $this->uploadHeaderLogoVariant('dark');
    }

    /** DELETE /api/v2/admin/settings/header-logo */
    public function removeHeaderLogo(): JsonResponse
    {
        return $this->removeHeaderLogoVariant('light');
    }

    /** DELETE /api/v2/admin/settings/header-logo-dark */
    public function removeHeaderLogoDark(): JsonResponse
    {
        return $this->removeHeaderLogoVariant('dark');
    }

    /**
     * PUT /api/v2/admin/settings/header-colors
     *
     * Persist the accessible (GOV.UK alpha) header colours into
     * tenants.configuration (header_bg_color / header_accent_color). Both are
     * optional #rrggbb hex strings; an empty value clears the override and
     * reverts that part of the header to the stock GOV.UK black + blue. They
     * sit next to the header logo so TenantContext::getSetting() reads them
     * with no extra wiring, exactly like the logo URLs.
     */
    public function saveHeaderColors(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $input = $this->getAllInput();
        $rawBg = $input['bg_color'] ?? null;
        $rawAccent = $input['accent_color'] ?? null;
        $bg = $this->normalizeHexColor($rawBg);
        $accent = $this->normalizeHexColor($rawAccent);

        // A present-but-invalid value is a client bug worth surfacing; an
        // absent / empty value is a deliberate "use the default", stored as
        // null below (setTenantConfigValue unsets the key).
        if (is_string($rawBg) && trim($rawBg) !== '' && $bg === null) {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                __('api.invalid_hex_color', ['field' => 'bg_color', 'example' => '#0053BE']),
                'bg_color',
                422,
            );
        }
        if (is_string($rawAccent) && trim($rawAccent) !== '' && $accent === null) {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                __('api.invalid_hex_color', ['field' => 'accent_color', 'example' => '#0053BE']),
                'accent_color',
                422,
            );
        }

        try {
            DB::transaction(function () use ($tenantId, $bg, $accent): void {
                $this->setTenantConfigValue($tenantId, 'header_bg_color', $bg);
                $this->setTenantConfigValue($tenantId, 'header_accent_color', $accent);
                app(PrerenderContentInvalidator::class)->refreshTenantOrFail($tenantId, true);
            });
        } catch (\Throwable $e) {
            report($e);
            return $this->respondWithError('PRERENDER_REFRESH_FAILED', __('api.prerender_reset_failed'), null, 503);
        }

        return $this->respondWithData([
            'header_bg_color' => $bg,
            'header_accent_color' => $accent,
        ]);
    }

    /**
     * Validate + normalise a #rrggbb hex colour. Accepts an optional leading
     * '#' and 3- or 6-digit hex (shorthand expanded), lower-cased. Returns
     * null for empty input or anything that isn't valid hex — callers decide
     * whether null means "clear" or "reject".
     */
    private function normalizeHexColor($value): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        $hex = ltrim(trim($value), '#');
        if ($hex === '') {
            return null;
        }
        if (preg_match('/^[0-9a-fA-F]{3}$/', $hex)) {
            $hex = $hex[0] . $hex[0] . $hex[1] . $hex[1] . $hex[2] . $hex[2];
        }
        if (!preg_match('/^[0-9a-fA-F]{6}$/', $hex)) {
            return null;
        }
        return '#' . strtolower($hex);
    }

    /**
     * Upload a tenant header-logo variant ('light'|'dark') and persist its URL
     * into the tenants.configuration JSON (logo_url / logo_dark_url). The
     * bootstrap controller already reads these keys, so the new logo flows to
     * the React header and the accessible GOV.UK header with no further wiring.
     */
    private function uploadHeaderLogoVariant(string $variant): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $this->rateLimit('admin_logo_upload', 10, 60);

        $file = request()->file('logo');
        if (!$file || !$file->isValid()) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.file_required'), 'logo', 400);
        }

        // SVG MIME sniffing (finfo) is unreliable across platforms — it often
        // reports text/plain or text/xml for a real SVG. Treat a .svg extension
        // OR an svg MIME as SVG; SvgUploader then hard-validates that the bytes
        // are a well-formed <svg> document, so a mislabelled file is still caught.
        $mime = $file->getMimeType();
        $ext = strtolower($file->getClientOriginalExtension());
        $isSvg = $mime === 'image/svg+xml' || $ext === 'svg';

        if (!$isSvg && !in_array($mime, ['image/jpeg', 'image/png', 'image/gif', 'image/webp'], true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.admin_image_invalid_type'), 'logo', 422);
        }

        // Max 2 MB
        if ($file->getSize() > 2 * 1024 * 1024) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.admin_image_size_limit_2mb'), 'logo', 422);
        }

        $configKey = $variant === 'dark' ? 'logo_dark_url' : 'logo_url';

        try {
            $fileArray = [
                'name'     => $file->getClientOriginalName(),
                'type'     => $file->getMimeType(),
                'tmp_name' => $file->getRealPath(),
                'error'    => UPLOAD_ERR_OK,
                'size'     => $file->getSize(),
            ];

            // SVG cannot go through the raster pipeline — it is sanitised and
            // stored separately to neutralise the same-origin XSS vector.
            $imageUrl = $isSvg
                ? \App\Core\SvgUploader::save($fileArray, 'tenant-logos')
                : \App\Core\ImageUploader::upload($fileArray, 'tenant-logos');

            DB::transaction(function () use ($tenantId, $configKey, $imageUrl): void {
                $this->setTenantConfigValue($tenantId, $configKey, $imageUrl);
                app(PrerenderContentInvalidator::class)->refreshTenantOrFail($tenantId, true);
            });

            return $this->respondWithData(['url' => $imageUrl]);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::error('Header logo upload failed', [
                'variant'   => $variant,
                'error'     => $e->getMessage(),
                'tenant_id' => $tenantId,
            ]);
            return $this->respondWithError('UPLOAD_FAILED', __('api.failed_upload_image'), 'logo', 500);
        }
    }

    /**
     * Clear a header-logo variant, reverting the header to the tenant default
     * (initials avatar in React, text name in the accessible frontend).
     */
    private function removeHeaderLogoVariant(string $variant): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $configKey = $variant === 'dark' ? 'logo_dark_url' : 'logo_url';

        try {
            DB::transaction(function () use ($tenantId, $configKey): void {
                $this->setTenantConfigValue($tenantId, $configKey, null);
                app(PrerenderContentInvalidator::class)->refreshTenantOrFail($tenantId, true);
            });
        } catch (\Throwable $e) {
            report($e);
            return $this->respondWithError('PRERENDER_REFRESH_FAILED', __('api.prerender_reset_failed'), null, 503);
        }

        return $this->respondWithData(['url' => null]);
    }

    /**
     * Read-modify-write a single key in the tenants.configuration JSON so the
     * other keys (modules, languages, …) are preserved, then bust the cached
     * bootstrap payload. Passing $value === null unsets the key.
     */
    private function setTenantConfigValue(int $tenantId, string $key, ?string $value): void
    {
        $tenantRow = DB::selectOne("SELECT configuration FROM tenants WHERE id = ?", [$tenantId]);
        $config = ($tenantRow && !empty($tenantRow->configuration))
            ? (json_decode($tenantRow->configuration, true) ?: [])
            : [];

        if ($value === null || $value === '') {
            unset($config[$key]);
        } else {
            $config[$key] = $value;
        }

        DB::update("UPDATE tenants SET configuration = ? WHERE id = ?", [json_encode($config), $tenantId]);
        $this->redisCache->delete('tenant_bootstrap', $tenantId);
    }

    /** PUT /api/v2/admin/config/settings */
    public function updateSettings(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $input = $this->getAllInput();

        if (empty($input)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.request_body_empty'), null, 422);
        }

        $this->ensureTenantSettingsTable();

        $directUpdates = [];
        $kvUpdates = [];
        $unknownKeys = [];

        foreach ($input as $key => $value) {
            if (in_array($key, self::TENANT_DIRECT_COLUMNS, true)) {
                $directUpdates[$key] = $value;
            } elseif (in_array($key, self::GENERAL_SETTING_KEYS, true)) {
                $kvUpdates[$key] = $value;
            } else {
                $unknownKeys[] = $key;
            }
        }

        if (empty($directUpdates) && empty($kvUpdates)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.no_recognized_settings', ['keys' => implode(', ', $unknownKeys)]), null, 422);
        }

        // Platform-super-admin-only keys — reject tenant admins with 403
        $godOnlyKeys = array_intersect(array_keys($kvUpdates), self::PLATFORM_SUPER_ADMIN_ONLY_KEYS);
        if (!empty($godOnlyKeys)) {
            try {
                $this->requirePlatformSuperAdmin();
            } catch (\Throwable) {
                return $this->respondWithError(
                    'AUTH_INSUFFICIENT_PERMISSIONS',
                    __('api.platform_super_admin_auth_settings_required'),
                    null,
                    403
                );
            }
        }

        // Super-admin-only keys (e.g. maintenance_mode takes the whole tenant offline) —
        // a regular delegated admin is rejected with 403; tenant-super-admins and above
        // may set them. requireSuperAdmin() throws a 403 (api.super_admin_required) here.
        $superOnlyKeys = array_intersect(array_keys($kvUpdates), self::SUPER_ADMIN_ONLY_KEYS);
        if (!empty($superOnlyKeys)) {
            $this->requireSuperAdmin();
        }

        $routingFields = array_intersect_key($directUpdates, array_flip(['slug', 'domain']));
        if ($routingFields !== []) {
            try {
                // A slug/domain changes global routing and can claim a shared
                // platform host. Tenant admins may edit branding, but only a
                // platform super-admin may change routing identity.
                $this->requirePlatformSuperAdmin();
            } catch (\Throwable) {
                return $this->respondWithError(
                    'AUTH_INSUFFICIENT_PERMISSIONS',
                    __('api.super_admin_required'),
                    null,
                    403
                );
            }
            $validation = TenantHierarchyService::validateRoutingUpdate($tenantId, $routingFields);
            if (!$validation['success']) {
                $code = (string) ($validation['code'] ?? 'VALIDATION_ERROR');
                $response = $this->respondWithError(
                    $code,
                    (string) ($validation['error'] ?? __('api.no_valid_fields_to_update')),
                    null,
                    $code === 'PASSKEY_RP_CHANGE_BLOCKED' ? 409 : 422
                );
                if (isset($validation['security_impact']) && is_array($validation['security_impact'])) {
                    $payload = $response->getData(true);
                    $payload['meta']['security_impact'] = $validation['security_impact'];
                    $response->setData($payload);
                }

                return $response;
            }
            $directUpdates = array_replace($directUpdates, $validation['data'] ?? []);
            $routingFields = array_replace($routingFields, $validation['data'] ?? []);
        }

        if (isset($kvUpdates['welcome_credits'])) {
            $wc = (int) $kvUpdates['welcome_credits'];
            if ($wc < 0 || $wc > 100) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.welcome_credits_range'), 'welcome_credits', 422);
            }
            $kvUpdates['welcome_credits'] = (string) $wc;
        }

        // Validate max_upload_size_mb — prevent dangerously large values
        if (isset($kvUpdates['max_upload_size_mb'])) {
            $maxMb = (int) $kvUpdates['max_upload_size_mb'];
            if ($maxMb < 1 || $maxMb > 50) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.max_upload_size_range'), 'max_upload_size_mb', 422);
            }
            $kvUpdates['max_upload_size_mb'] = (string) $maxMb;
        }

        // Validate items_per_page — prevent abuse
        if (isset($kvUpdates['items_per_page'])) {
            $ipp = (int) $kvUpdates['items_per_page'];
            if ($ipp < 5 || $ipp > 100) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.items_per_page_range'), 'items_per_page', 422);
            }
            $kvUpdates['items_per_page'] = (string) $ipp;
        }

        // Validate maintenance_mode — must be a boolean
        if (isset($kvUpdates['maintenance_mode'])) {
            if (!in_array((string) $kvUpdates['maintenance_mode'], ['true', 'false', '1', '0'], true)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.maintenance_mode_boolean'), 'maintenance_mode', 422);
            }
        }

        // Validate registration_mode — restricted values
        if (isset($kvUpdates['registration_mode'])) {
            if (!in_array($kvUpdates['registration_mode'], ['open', 'closed', 'invite_only'], true)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.registration_mode_invalid'), 'registration_mode', 422);
            }
        }

        // Validate map_provider — restricted to known frontend dispatch branches.
        if (isset($kvUpdates['map_provider'])) {
            if (!in_array($kvUpdates['map_provider'], ['google', 'openstreetmap', 'ordnance_survey'], true)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.map_provider_invalid'), 'map_provider', 422);
            }
        }

        // Validate geocoding_provider — restricted to known frontend dispatch branches.
        if (isset($kvUpdates['geocoding_provider'])) {
            if (!in_array($kvUpdates['geocoding_provider'], ['google', 'nominatim', 'os_places'], true)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.geocoding_provider_invalid'), 'geocoding_provider', 422);
            }
        }

        // Validate API key formats. Empty string means "clear" — allowed,
        // platform falls back to env-configured default.
        // Google browser API keys begin "AIza" + 35 alphanumerics.
        // MapTiler keys are alphanumeric, typically 32 chars.
        // Map IDs are alphanumeric (with hyphens), 8–32 chars.
        $keyShapes = [
            'google_maps_api_key' => ['/^AIza[0-9A-Za-z_-]{35}$/', 'api.google_maps_api_key_invalid'],
            'maptiler_api_key'    => ['/^[0-9A-Za-z]{16,64}$/',     'api.maptiler_api_key_invalid'],
            'google_maps_map_id'  => ['/^[0-9A-Za-z_-]{4,64}$/',    'api.google_maps_map_id_invalid'],
            // OS Data Hub project API keys are alphanumeric strings
            'os_maps_api_key'     => ['/^[0-9A-Za-z]{16,64}$/',     'api.os_maps_api_key_invalid'],
        ];
        foreach ($keyShapes as $field => [$pattern, $errorKey]) {
            if (!array_key_exists($field, $kvUpdates)) {
                continue;
            }
            $val = trim((string) $kvUpdates[$field]);
            if ($val === '') {
                // Empty means "remove this tenant override" — replace the
                // KV row with an empty string so getSettings sees null.
                $kvUpdates[$field] = '';
                continue;
            }
            if (!preg_match($pattern, $val)) {
                return $this->respondWithError('VALIDATION_ERROR', __($errorKey), $field, 422);
            }
            $kvUpdates[$field] = $val;
        }

        // Validate inactivity_timeout_minutes — 0 disables the auto-logout;
        // otherwise 5–480 minutes. Values 1–4 are rejected so a stored "1"
        // is never coerced to boolean true by bootstrap's true/false mapping.
        if (isset($kvUpdates['inactivity_timeout_minutes'])) {
            $mins = (int) $kvUpdates['inactivity_timeout_minutes'];
            if ($mins !== 0 && ($mins < 5 || $mins > 480)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.inactivity_timeout_range'), 'inactivity_timeout_minutes', 422);
            }
            $kvUpdates['inactivity_timeout_minutes'] = (string) $mins;
        }

        // Validate default_currency — must be a 3-letter ISO 4217 code (lowercase).
        // Stripe accepts ~135 currencies; allow any 3-letter code and normalize to lowercase.
        if (isset($kvUpdates['default_currency'])) {
            $cur = strtolower(trim((string) $kvUpdates['default_currency']));
            if (!preg_match('/^[a-z]{3}$/', $cur)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.default_currency_invalid', []), 'default_currency', 422);
            }
            $kvUpdates['default_currency'] = $cur;
        }

        // Validate the complete request before its first write. Previously a
        // direct slug/domain update happened above the KV validators, so a
        // later 422 could leave routing changed with caches and snapshots live
        // at the old identity.
        $childIdsToBust = [];
        $routingIdentityChanged = $routingFields !== [];
        $requiresAuthoritativeRefresh = $routingIdentityChanged
            || array_key_exists('maintenance_mode', $kvUpdates);
        $nonRoutingDirectUpdates = array_diff_key(
            $directUpdates,
            array_flip(['slug', 'domain'])
        );
        $prerenderJobId = 0;
        try {
            $transactionFailure = DB::transaction(function () use (
                $nonRoutingDirectUpdates,
                $routingFields,
                $kvUpdates,
                $tenantId,
                $adminId,
                $requiresAuthoritativeRefresh,
                $routingIdentityChanged,
                &$childIdsToBust,
                &$prerenderJobId
            ): ?array {
                if ($routingFields !== []) {
                    $routingResult = TenantHierarchyService::applyRoutingUpdateAtomically(
                        $tenantId,
                        $routingFields
                    );
                    if (!$routingResult['success']) {
                        return $routingResult;
                    }
                }

                if ($nonRoutingDirectUpdates !== []) {
                    $setClauses = [];
                    $params = [];
                    foreach ($nonRoutingDirectUpdates as $col => $val) {
                        $setClauses[] = "`{$col}` = ?";
                        $params[] = $val;
                    }
                    $params[] = $tenantId;
                    DB::update("UPDATE tenants SET " . implode(', ', $setClauses) . " WHERE id = ?", $params);

                }
                if (array_key_exists('domain', $routingFields)) {
                    $childIdsToBust = DB::table('tenants')
                        ->where('parent_id', $tenantId)
                        ->where('is_active', 1)
                        ->pluck('id')
                        ->map(fn ($id) => (int) $id)
                        ->toArray();
                }

                foreach ($kvUpdates as $key => $value) {
                    $this->upsertSetting($tenantId, 'general.' . $key, (string) $value, $adminId);
                }

                $invalidator = app(PrerenderContentInvalidator::class);
                $prerenderJobId = $requiresAuthoritativeRefresh
                    ? $invalidator->refreshAllOrFail($routingIdentityChanged)
                    : $invalidator->refreshTenantOrFail($tenantId, true);

                return null;
            });
        } catch (\Throwable $e) {
            report($e);
            return $this->respondWithError(
                'PRERENDER_REFRESH_FAILED',
                __('api.fed_settings_update_failed'),
                null,
                503
            );
        }
        if (is_array($transactionFailure)) {
            $code = (string) ($transactionFailure['code'] ?? 'VALIDATION_ERROR');
            $response = $this->respondWithError(
                $code,
                (string) ($transactionFailure['error'] ?? __('api.no_valid_fields_to_update')),
                null,
                $code === 'PASSKEY_RP_CHANGE_BLOCKED' ? 409 : 422
            );
            if (isset($transactionFailure['security_impact']) && is_array($transactionFailure['security_impact'])) {
                $payload = $response->getData(true);
                $payload['meta']['security_impact'] = $transactionFailure['security_impact'];
                $response->setData($payload);
            }

            return $response;
        }

        foreach ($childIdsToBust as $childId) {
            $this->redisCache->delete('tenant_bootstrap', $childId);
        }

        // Audit log for settings changes
        \Illuminate\Support\Facades\Log::info('Admin config settings updated', [
            'admin_id' => $adminId,
            'tenant_id' => $tenantId,
            'direct_columns' => array_keys($directUpdates),
            'settings' => array_keys($kvUpdates),
        ]);

        $this->redisCache->delete('tenant_bootstrap', $tenantId);
        $this->tenantSettingsService->clearCacheForTenant($tenantId);

        return $this->respondWithData([
            'updated' => true,
            'direct_columns_updated' => array_keys($directUpdates),
            'settings_updated' => array_keys($kvUpdates),
            'prerender_job_id' => $prerenderJobId,
        ]);
    }

    // =========================================================================
    // AI Config
    // =========================================================================

    /** GET /api/v2/admin/config/ai */
    public function getAiConfig(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $settings = \App\Models\AiSettings::getAllForTenant($tenantId);

        return $this->respondWithData([
            'ai_enabled' => (bool) ($settings['ai_enabled'] ?? false),
            'ai_provider' => $settings['ai_provider'] ?? 'gemini',
            'models' => [
                'gemini' => $settings['gemini_model'] ?? 'gemini-pro',
                'openai' => $settings['openai_model'] ?? 'gpt-4-turbo',
                'anthropic' => $settings['claude_model'] ?? 'claude-sonnet-4-20250514',
                'ollama' => $settings['ollama_model'] ?? 'llama2',
            ],
            'api_keys' => [
                'gemini' => \App\Models\AiSettings::getMasked($tenantId, 'gemini_api_key'),
                'openai' => \App\Models\AiSettings::getMasked($tenantId, 'openai_api_key'),
                'anthropic' => \App\Models\AiSettings::getMasked($tenantId, 'anthropic_api_key'),
            ],
            'api_key_set' => [
                'gemini' => \App\Models\AiSettings::has($tenantId, 'gemini_api_key'),
                'openai' => \App\Models\AiSettings::has($tenantId, 'openai_api_key'),
                'anthropic' => \App\Models\AiSettings::has($tenantId, 'anthropic_api_key'),
            ],
            'features' => [
                'chat' => (bool) ($settings['ai_chat_enabled'] ?? false),
                'content_generation' => (bool) ($settings['ai_content_gen_enabled'] ?? false),
                'recommendations' => (bool) ($settings['ai_recommendations_enabled'] ?? false),
                'analytics' => (bool) ($settings['ai_analytics_enabled'] ?? false),
                'moderation' => (bool) ($settings['ai_moderation_enabled'] ?? false),
            ],
            'limits' => [
                'default_daily' => (int) ($settings['default_daily_limit'] ?? 50),
                'default_monthly' => (int) ($settings['default_monthly_limit'] ?? 1000),
            ],
            'ollama' => [
                'host' => $settings['ollama_host'] ?? 'http://localhost:11434',
            ],
        ]);
    }

    /** PUT /api/v2/admin/config/ai */
    public function updateAiConfig(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $input = $this->getAllInput();

        if (empty($input)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.request_body_empty'), null, 422);
        }

        $allowedKeys = [
            'ai_enabled', 'ai_provider',
            'gemini_api_key', 'openai_api_key', 'anthropic_api_key',
            'gemini_model', 'openai_model', 'claude_model',
            'ollama_model', 'ollama_host',
            'ai_chat_enabled', 'ai_content_gen_enabled',
            'ai_recommendations_enabled', 'ai_analytics_enabled',
            'ai_moderation_enabled',
            'default_daily_limit', 'default_monthly_limit',
        ];

        $toSave = [];
        foreach ($input as $key => $value) {
            if (in_array($key, $allowedKeys, true)) {
                $toSave[$key] = is_bool($value) ? ($value ? '1' : '0') : (string) $value;
            }
        }

        if (empty($toSave)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.no_recognized_ai_settings'), null, 422);
        }

        if (isset($toSave['ai_provider'])) {
            $validProviders = ['gemini', 'openai', 'anthropic', 'ollama'];
            if (!in_array($toSave['ai_provider'], $validProviders, true)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_ai_provider', ['providers' => implode(', ', $validProviders)]), 'ai_provider', 422);
            }
        }

        if (isset($toSave['ollama_host']) && !OutboundUrlGuard::isSafeHttpUrl($toSave['ollama_host'])) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.url_no_private_ip'), 'ollama_host', 422);
        }

        \App\Models\AiSettings::setMultiple($tenantId, $toSave);
        $this->redisCache->delete('tenant_bootstrap', $tenantId);

        return $this->respondWithData(['updated' => true, 'keys_updated' => array_keys($toSave)]);
    }

    // =========================================================================
    // Feed Algorithm
    // =========================================================================

    /** GET /api/v2/admin/config/feed-algorithm */
    public function getFeedAlgorithmConfig(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $stored = $this->readSettingsByPrefix($tenantId, 'feed_algo_');

        $config = [];
        foreach (self::FEED_ALGO_DEFAULTS as $key => $defaultValue) {
            $rawValue = $stored[$key] ?? $defaultValue;
            if (in_array($key, ['feed_algo_boost_images', 'feed_algo_boost_polls', 'feed_algo_penalize_links_only'], true)) {
                $config[$key] = (bool) (int) $rawValue;
            } elseif (strpos($defaultValue, '.') !== false) {
                $config[$key] = (float) $rawValue;
            } else {
                $config[$key] = (int) $rawValue;
            }
        }

        return $this->respondWithData(['tenant_id' => $tenantId, 'algorithm' => $config]);
    }

    /** PUT /api/v2/admin/config/feed-algorithm */
    public function updateFeedAlgorithmConfig(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $input = $this->getAllInput();

        if (empty($input)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.request_body_empty'), null, 422);
        }

        $this->ensureTenantSettingsTable();

        $updated = [];
        foreach ($input as $key => $value) {
            if (!array_key_exists($key, self::FEED_ALGO_DEFAULTS)) continue;

            if (strpos($key, '_weight') !== false) {
                $floatVal = (float) $value;
                if ($floatVal < 0.0 || $floatVal > 1.0) {
                    return $this->respondWithError('VALIDATION_ERROR', __('api.weight_range', ['key' => $key]), $key, 422);
                }
            }

            $storeValue = is_bool($value) ? ($value ? '1' : '0') : (string) $value;
            $type = is_bool($value) ? 'boolean' : (is_float($value) ? 'float' : 'string');
            $this->upsertSetting($tenantId, $key, $storeValue, $adminId, $type);
            $updated[] = $key;
        }

        if (empty($updated)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.no_recognized_feed_settings'), null, 422);
        }

        $this->redisCache->delete('tenant_bootstrap', $tenantId);

        return $this->respondWithData(['updated' => true, 'keys_updated' => $updated]);
    }

    // =========================================================================
    // Image Config
    // =========================================================================

    /** GET /api/v2/admin/config/image */
    public function getImageConfig(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $stored = $this->readSettingsByPrefix($tenantId, 'image_');

        $tenantRow = DB::selectOne("SELECT configuration FROM tenants WHERE id = ?", [$tenantId]);
        $legacyConfig = [];
        if ($tenantRow && !empty($tenantRow->configuration)) {
            $config = json_decode($tenantRow->configuration, true) ?: [];
            $legacyConfig = $config['image_optimization'] ?? [];
        }

        $imageConfig = [];
        foreach (self::IMAGE_DEFAULTS as $key => $defaultValue) {
            $rawValue = $stored[$key] ?? $defaultValue;
            if (in_array($key, ['image_auto_webp', 'image_auto_resize', 'image_strip_exif', 'image_lazy_loading', 'image_serving_enabled'], true)) {
                $imageConfig[$key] = (bool) (int) $rawValue;
            } else {
                $imageConfig[$key] = (int) $rawValue;
            }
        }

        if (!empty($legacyConfig)) {
            $imageConfig['legacy'] = $legacyConfig;
        }

        return $this->respondWithData(['tenant_id' => $tenantId, 'images' => $imageConfig]);
    }

    /** PUT /api/v2/admin/config/image */
    public function updateImageConfig(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $input = $this->getAllInput();

        if (empty($input)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.request_body_empty'), null, 422);
        }

        $this->ensureTenantSettingsTable();

        $updated = [];
        foreach ($input as $key => $value) {
            if (!array_key_exists($key, self::IMAGE_DEFAULTS)) continue;

            if ($key === 'image_max_size_mb' && ((int) $value < 1 || (int) $value > 50)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.max_file_size_range'), $key, 422);
            }
            if ($key === 'image_webp_quality' && ((int) $value < 50 || (int) $value > 100)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.webp_quality_range'), $key, 422);
            }
            if (in_array($key, ['image_max_width', 'image_max_height', 'image_thumbnail_width', 'image_thumbnail_height'], true) && ((int) $value < 50 || (int) $value > 10000)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.dimension_range', ['key' => $key]), $key, 422);
            }

            $storeValue = is_bool($value) ? ($value ? '1' : '0') : (string) $value;
            $this->upsertSetting($tenantId, $key, $storeValue, $adminId, is_bool($value) ? 'boolean' : 'integer');
            $updated[] = $key;
        }

        if (empty($updated)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.no_recognized_image_settings'), null, 422);
        }

        $this->redisCache->delete('tenant_bootstrap', $tenantId);

        return $this->respondWithData(['updated' => true, 'keys_updated' => $updated]);
    }

    // =========================================================================
    // SEO Config
    // =========================================================================

    /** GET /api/v2/admin/config/seo */
    public function getSeoConfig(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $stored = $this->readSettingsByPrefix($tenantId, 'seo_');

        $tenantRow = DB::selectOne("SELECT meta_title, meta_description, h1_headline, hero_intro FROM tenants WHERE id = ?", [$tenantId]);

        $config = [];
        foreach (self::SEO_DEFAULTS as $key => $defaultValue) {
            $rawValue = $stored[$key] ?? $defaultValue;
            if (in_array($key, ['seo_auto_sitemap', 'seo_canonical_urls', 'seo_open_graph', 'seo_twitter_cards'], true)) {
                $config[$key] = (bool) (int) $rawValue;
            } else {
                $config[$key] = $rawValue;
            }
        }

        $config['tenant_meta_title'] = $tenantRow->meta_title ?? '';
        $config['tenant_meta_description'] = $tenantRow->meta_description ?? '';
        $config['tenant_h1_headline'] = $tenantRow->h1_headline ?? '';
        $config['tenant_hero_intro'] = $tenantRow->hero_intro ?? '';

        return $this->respondWithData(['tenant_id' => $tenantId, 'seo' => $config]);
    }

    /** PUT /api/v2/admin/config/seo */
    public function updateSeoConfig(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $input = $this->getAllInput();

        if (empty($input)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.request_body_empty'), null, 422);
        }

        $this->ensureTenantSettingsTable();

        $updated = [];
        $settingUpdates = [];

        foreach ($input as $key => $value) {
            if (array_key_exists($key, self::SEO_DEFAULTS)) {
                $storeValue = is_bool($value) ? ($value ? '1' : '0') : (string) $value;
                $settingUpdates[$key] = [$storeValue, is_bool($value) ? 'boolean' : 'string'];
                $updated[] = $key;
            }
        }

        $tenantColumnMap = [
            'tenant_meta_title' => 'meta_title',
            'tenant_meta_description' => 'meta_description',
            'tenant_h1_headline' => 'h1_headline',
            'tenant_hero_intro' => 'hero_intro',
        ];

        $directUpdates = [];
        foreach ($tenantColumnMap as $inputKey => $column) {
            if (array_key_exists($inputKey, $input)) {
                $directUpdates[$column] = $input[$inputKey];
                $updated[] = $inputKey;
            }
        }

        if (empty($updated)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.no_recognized_seo_settings'), null, 422);
        }

        try {
            DB::transaction(function () use ($settingUpdates, $directUpdates, $tenantId, $adminId): void {
                foreach ($settingUpdates as $key => [$value, $type]) {
                    $this->upsertSetting($tenantId, $key, $value, $adminId, $type);
                }
                if ($directUpdates !== []) {
                    $setClauses = [];
                    $params = [];
                    foreach ($directUpdates as $col => $value) {
                        $setClauses[] = "`{$col}` = ?";
                        $params[] = $value;
                    }
                    $params[] = $tenantId;
                    DB::update("UPDATE tenants SET " . implode(', ', $setClauses) . " WHERE id = ?", $params);
                }
                app(PrerenderContentInvalidator::class)->refreshTenantOrFail($tenantId, true);
            });
        } catch (\Throwable $e) {
            report($e);
            return $this->respondWithError('PRERENDER_REFRESH_FAILED', __('api.prerender_reset_failed'), null, 503);
        }

        $this->redisCache->delete('tenant_bootstrap', $tenantId);

        return $this->respondWithData(['updated' => true, 'keys_updated' => $updated]);
    }

    // =========================================================================
    // Sitemap Management
    // =========================================================================

    /** GET /api/v2/admin/config/sitemap-stats */
    public function getSitemapStats(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $sitemapService = app(\App\Services\SitemapService::class);
        $stats = $sitemapService->getStats($tenantId);

        $tenant = DB::selectOne("SELECT slug, domain, parent_id FROM tenants WHERE id = ?", [$tenantId]);
        $frontendBase = rtrim(env('FRONTEND_URL', 'https://app.project-nexus.ie'), '/');
        if (!empty($tenant->domain)) {
            $sitemapUrl = 'https://' . rtrim($tenant->domain, '/') . '/sitemap.xml';
        } elseif (!empty($tenant->parent_id)) {
            $parentDomain = DB::table('tenants')
                ->where('id', (int) $tenant->parent_id)
                ->where('is_active', 1)
                ->value('domain');
            $sitemapUrl = !empty($parentDomain)
                ? 'https://' . rtrim((string) $parentDomain, '/') . '/sitemap-' . $tenant->slug . '.xml'
                : $frontendBase . '/sitemap-' . $tenant->slug . '.xml';
        } else {
            $sitemapUrl = $frontendBase . '/sitemap.xml';
        }

        return $this->respondWithData([
            'sitemap_url' => $sitemapUrl,
            'total_urls' => $stats['total_urls'],
            'content_types' => $stats['content_types'],
        ]);
    }

    /** POST /api/v2/admin/config/sitemap-clear-cache */
    public function clearSitemapCache(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $sitemapService = app(\App\Services\SitemapService::class);
        $cleared = $sitemapService->clearCache($tenantId);

        return $this->respondWithData(['cleared' => $cleared]);
    }

    // =========================================================================
    // Native App Config
    // =========================================================================

    /** GET /api/v2/admin/config/native-app */
    public function getNativeAppConfig(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $config = $this->nativeAppConfig($tenantId);

        return $this->respondWithData([
            'tenant_id' => $tenantId,
            'native_app' => $config,
            'deployment_readiness' => $this->nativeAppReadiness($config),
        ]);
    }

    /**
     * GET /api/v2/admin/config/native-app/install-stats
     *
     * Who has the native mobile app installed and registered for push.
     *
     * Two tiers, and the difference is the whole point of this endpoint:
     *
     * - Any tenant admin sees THEIR OWN tenant only, scoped by `tenant_id`.
     * - A god-mode operator (`users.is_god`) additionally receives a
     *   cross-tenant `platform` block. Nothing else unlocks it —
     *   `is_super_admin` and `is_tenant_super_admin` alone do NOT, because a
     *   hub-tenant super admin is confined to its own subtree and this block
     *   is not subtree-filtered.
     *
     * 🔴 `platform` is the only cross-tenant payload here. If you add a field
     * to it, you are widening what one community's operator could see about
     * another; keep the god check as the single gate and do not move any
     * cross-tenant field into the tenant block.
     *
     * 🔴 The numbers are push registrations, NOT app-store installs. The
     * response says so in `disclaimer_key` so no client can present them as
     * install counts by accident.
     */
    public function getNativeAppInstallStats(): JsonResponse
    {
        $userId = $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $isGod = \App\Models\User::isGod($userId);
        $stats = new NativeAppInstallStatsService();

        return $this->respondWithData([
            'tenant_id' => $tenantId,
            'is_god' => $isGod,
            'scope' => $isGod ? 'platform' : 'tenant',
            'disclaimer_key' => 'push_registrations_not_store_installs',
            'tenant' => $stats->tenantStats($tenantId),
            'platform' => $isGod ? $stats->platformStats() : null,
        ]);
    }

    /** GET /api/v2/admin/config/native-app/build-manifest */
    public function getNativeAppBuildManifest(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $config = $this->nativeAppConfig($tenantId);
        $tenant = DB::table('tenants')
            ->where('id', $tenantId)
            ->select(['id', 'name', 'slug', 'domain'])
            ->first();

        return $this->respondWithData([
            'manifest_version' => 'native-app-build-manifest-v1',
            'generated_at' => now()->toIso8601String(),
            'tenant' => [
                'id' => $tenantId,
                'name' => (string) ($tenant->name ?? ''),
                'slug' => (string) ($tenant->slug ?? ''),
                'domain' => (string) ($tenant->domain ?? ''),
            ],
            'app' => [
                'name' => (string) ($config['native_app_name'] ?? ''),
                'short_name' => (string) ($config['native_app_short_name'] ?? ''),
                'version' => (string) ($config['native_app_version'] ?? ''),
                'bundle_id' => (string) ($config['native_app_bundle_id'] ?? ''),
                'package_name' => (string) ($config['native_app_package_name'] ?? ''),
                'theme_color' => (string) ($config['native_app_theme_color'] ?? ''),
                'background_color' => (string) ($config['native_app_background_color'] ?? ''),
                'display' => (string) ($config['native_app_display'] ?? ''),
                'orientation' => (string) ($config['native_app_orientation'] ?? ''),
            ],
            'store' => [
                'mode' => (string) ($config['native_app_store_mode'] ?? 'shared'),
                'build_profile' => (string) ($config['native_app_build_profile'] ?? 'preview'),
                'ios_app_store_id' => (string) ($config['native_app_ios_app_store_id'] ?? ''),
                'android_play_store_id' => (string) ($config['native_app_android_play_store_id'] ?? ''),
                'marketing_url' => (string) ($config['native_app_marketing_url'] ?? ''),
                'privacy_url' => (string) ($config['native_app_privacy_url'] ?? ''),
                'support_url' => (string) ($config['native_app_support_url'] ?? ''),
            ],
            'push' => [
                'enabled' => (bool) ($config['native_app_push_enabled'] ?? false),
                'sender_id' => (string) ($config['native_app_push_sender_id'] ?? ''),
                'tenant_channel_prefix' => (string) ($config['native_app_tenant_channel_prefix'] ?? ''),
                'fcm_secret_set' => (bool) ($config['native_app_fcm_server_key_set'] ?? false),
                'apns_key_set' => (bool) ($config['native_app_apns_key_id_set'] ?? false),
            ],
            'pwa' => [
                'service_worker' => (bool) ($config['native_app_service_worker'] ?? true),
                'install_prompt' => (bool) ($config['native_app_install_prompt'] ?? true),
            ],
            'deployment_readiness' => $this->nativeAppReadiness($config),
        ]);
    }

    /** PUT /api/v2/admin/config/native-app */
    public function updateNativeAppConfig(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $input = $this->getAllInput();

        if (empty($input)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.request_body_empty'), null, 422);
        }

        $this->ensureTenantSettingsTable();

        $updated = [];
        foreach ($input as $key => $value) {
            if (!array_key_exists($key, self::NATIVE_APP_DEFAULTS)) continue;

            if ($key === 'native_app_display') {
                $valid = ['standalone', 'fullscreen', 'minimal-ui', 'browser'];
                if (!in_array($value, $valid, true)) {
                    return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_display_mode', ['modes' => implode(', ', $valid)]), $key, 422);
                }
            }

            if ($key === 'native_app_orientation') {
                $valid = ['portrait', 'landscape', 'any'];
                if (!in_array($value, $valid, true)) {
                    return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_orientation', ['orientations' => implode(', ', $valid)]), $key, 422);
                }
            }

            if ($key === 'native_app_store_mode') {
                $valid = ['shared', 'tenant_branded'];
                if (!in_array($value, $valid, true)) {
                    return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_native_app_store_mode', ['modes' => implode(', ', $valid)]), $key, 422);
                }
            }

            if ($key === 'native_app_build_profile') {
                $valid = ['preview', 'production'];
                if (!in_array($value, $valid, true)) {
                    return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_native_app_build_profile', ['profiles' => implode(', ', $valid)]), $key, 422);
                }
            }

            $storeValue = is_bool($value) ? ($value ? '1' : '0') : (string) $value;
            $this->upsertSetting($tenantId, $key, $storeValue, $adminId, is_bool($value) ? 'boolean' : 'string');
            $updated[] = $key;
        }

        if (empty($updated)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.no_recognized_native_app_settings'), null, 422);
        }

        $this->redisCache->delete('tenant_bootstrap', $tenantId);

        return $this->respondWithData(['updated' => true, 'keys_updated' => $updated]);
    }

    private function nativeAppReadiness(array $config): array
    {
        $storeMode = (string) ($config['native_app_store_mode'] ?? 'shared');
        $hasIosIdentity = trim((string) ($config['native_app_bundle_id'] ?? '')) !== ''
            && trim((string) ($config['native_app_ios_app_store_id'] ?? '')) !== '';
        $hasAndroidIdentity = trim((string) ($config['native_app_package_name'] ?? '')) !== ''
            && trim((string) ($config['native_app_android_play_store_id'] ?? '')) !== '';
        $hasStoreMetadata = trim((string) ($config['native_app_marketing_url'] ?? '')) !== ''
            && trim((string) ($config['native_app_privacy_url'] ?? '')) !== ''
            && trim((string) ($config['native_app_support_url'] ?? '')) !== '';
        $pushRoutingConfigured = (bool) ($config['native_app_push_enabled'] ?? false)
            && trim((string) ($config['native_app_push_sender_id'] ?? '')) !== ''
            && trim((string) ($config['native_app_tenant_channel_prefix'] ?? '')) !== '';

        $missing = [];
        if ($storeMode === 'tenant_branded' && !$hasIosIdentity) {
            $missing[] = 'ios_identity';
        }
        if ($storeMode === 'tenant_branded' && !$hasAndroidIdentity) {
            $missing[] = 'android_identity';
        }
        if ($storeMode === 'tenant_branded' && !$hasStoreMetadata) {
            $missing[] = 'store_metadata';
        }
        if ($storeMode === 'tenant_branded' && !$pushRoutingConfigured) {
            $missing[] = 'push_routing';
        }

        return [
            'store_mode' => $storeMode,
            'has_ios_identity' => $hasIosIdentity,
            'has_android_identity' => $hasAndroidIdentity,
            'has_store_metadata' => $hasStoreMetadata,
            'push_routing_configured' => $pushRoutingConfigured,
            'tenant_branded_ready' => $storeMode === 'tenant_branded'
                && $hasIosIdentity
                && $hasAndroidIdentity
                && $hasStoreMetadata
                && $pushRoutingConfigured,
            'missing_requirements' => $missing,
        ];
    }

    private function nativeAppConfig(int $tenantId): array
    {
        $stored = $this->readSettingsByPrefix($tenantId, 'native_app_');

        $config = [];
        foreach (self::NATIVE_APP_DEFAULTS as $key => $defaultValue) {
            $rawValue = $stored[$key] ?? $defaultValue;

            if (in_array($key, self::NATIVE_APP_SENSITIVE_KEYS, true) && !empty($rawValue)) {
                $config[$key] = str_repeat('*', max(0, strlen($rawValue) - 4)) . substr($rawValue, -4);
                $config[$key . '_set'] = true;
            } elseif (in_array($key, ['native_app_push_enabled', 'native_app_service_worker', 'native_app_install_prompt'], true)) {
                $config[$key] = (bool) (int) $rawValue;
            } else {
                $config[$key] = $rawValue;
            }
        }

        foreach (self::NATIVE_APP_SENSITIVE_KEYS as $sensitiveKey) {
            if (!isset($config[$sensitiveKey . '_set'])) {
                $config[$sensitiveKey . '_set'] = false;
            }
        }

        return $config;
    }

    // =========================================================================
    // Algorithm Info (public endpoint)
    // =========================================================================

    /** GET /api/v2/config/algorithms — public, returns which algorithms are active */
    public function getAlgorithmInfo(): JsonResponse
    {
        $feedEnabled = $this->feedRankingService->isEnabled();
        $feed = [
            'name' => $feedEnabled ? 'EdgeRank' : 'Chronological',
            'key' => $feedEnabled ? 'edgerank' : 'chronological',
            'description' => $feedEnabled
                ? 'Ranked by engagement, freshness, social connections, and content quality'
                : 'Showing newest posts first',
        ];

        $listingsEnabled = $this->listingRankingService->isEnabled();
        $listings = [
            'name' => $listingsEnabled ? 'MatchRank' : 'Newest First',
            'key' => $listingsEnabled ? 'matchrank' : 'newest',
            'description' => $listingsEnabled
                ? 'Ranked by relevance, proximity, engagement, and reciprocity'
                : 'Showing newest listings first',
        ];

        $membersEnabled = $this->memberRankingService->isEnabled();
        $members = [
            'name' => $membersEnabled ? 'CommunityRank' : 'Alphabetical',
            'key' => $membersEnabled ? 'communityrank' : 'alphabetical',
            'description' => $membersEnabled
                ? 'Ranked by Bayesian reputation confidence, Wilson review certainty, activity, contributions, connectivity, and proximity'
                : 'Sorted alphabetically by name',
        ];

        $matchingConfig = $this->smartMatchingEngine->getConfig();
        $matchingEnabled = !empty($matchingConfig['enabled']);
        $matching = [
            'name' => $matchingEnabled ? 'SmartMatch' : 'Disabled',
            'key' => $matchingEnabled ? 'smartmatch' : 'disabled',
            'description' => $matchingEnabled
                ? 'AI-powered matching based on skills, proximity, and reciprocity'
                : 'Smart matching is not active',
        ];

        return $this->respondWithData([
            'feed' => $feed, 'listings' => $listings, 'members' => $members, 'matching' => $matching,
        ]);
    }

    // =========================================================================
    // Algorithm Config
    // =========================================================================

    /** GET /api/v2/admin/config/algorithm */
    public function getAlgorithmConfig(): JsonResponse
    {
        $this->requireAdmin();

        return $this->respondWithData([
            'feed' => $this->feedRankingService->getConfig(),
            'listings' => $this->listingRankingService->getConfig(),
            'members' => $this->memberRankingService->getConfig(),
        ]);
    }

    /** PUT /api/v2/admin/config/algorithm/{area} */
    public function updateAlgorithmConfig($area): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $validAreas = ['feed', 'listings', 'members'];
        if (!in_array($area, $validAreas, true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.algorithm_area_invalid'), 'area', 422);
        }

        $input = $this->getAllInput();
        if (empty($input)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.request_body_empty'), null, 422);
        }

        $currentConfig = match ($area) {
            'feed' => $this->feedRankingService->getConfig(),
            'listings' => $this->listingRankingService->getConfig(),
            'members' => $this->memberRankingService->getConfig(),
        };

        $updated = [];
        foreach ($input as $key => $value) {
            if (!array_key_exists($key, $currentConfig)) continue;

            if (str_ends_with($key, '_weight') || str_ends_with($key, '_boost') || str_ends_with($key, '_minimum')) {
                $val = (float) $value;
                if ($val < 0.0 || $val > 10.0) {
                    return $this->respondWithError('VALIDATION_ERROR', __('api.algorithm_value_range', ['key' => $key]), $key, 422);
                }
            }

            $updated[$key] = $value;
        }

        if (empty($updated)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.no_recognized_algorithm_settings'), null, 422);
        }

        if ($area === 'members') {
            DB::table('communityrank_settings')->updateOrInsert(
                ['tenant_id' => $tenantId],
                [
                    'is_enabled' => (int) (($updated['enabled'] ?? $currentConfig['enabled'] ?? true) ? 1 : 0),
                    'activity_weight' => (float) ($updated['activity_weight'] ?? $currentConfig['activity_weight'] ?? 0.25),
                    'contribution_weight' => (float) ($updated['contribution_weight'] ?? $currentConfig['contribution_weight'] ?? 0.25),
                    'reputation_weight' => (float) ($updated['reputation_weight'] ?? $currentConfig['reputation_weight'] ?? 0.20),
                    'connectivity_weight' => (float) ($updated['connectivity_weight'] ?? $currentConfig['connectivity_weight'] ?? 0.20),
                    'proximity_weight' => (float) ($updated['proximity_weight'] ?? $currentConfig['proximity_weight'] ?? 0.10),
                    'updated_at' => now(),
                    'created_at' => now(),
                ]
            );
        } else {
            $tenantRow = DB::selectOne("SELECT configuration FROM tenants WHERE id = ?", [$tenantId]);
            $config = [];
            if ($tenantRow && !empty($tenantRow->configuration)) {
                $config = json_decode($tenantRow->configuration, true) ?: [];
            }

            if (!isset($config['algorithms'])) { $config['algorithms'] = []; }
            if (!isset($config['algorithms'][$area])) { $config['algorithms'][$area] = []; }

            foreach ($updated as $key => $value) {
                $config['algorithms'][$area][$key] = $value;
            }

            DB::update("UPDATE tenants SET configuration = ? WHERE id = ?", [json_encode($config), $tenantId]);
        }

        match ($area) {
            'feed' => $this->feedRankingService->clearCache(),
            'listings' => $this->listingRankingService->clearCache(),
            'members' => $this->memberRankingService->clearCache(),
            default => null,
        };

        $this->redisCache->delete('tenant_bootstrap', $tenantId);

        return $this->respondWithData(['updated' => true, 'area' => $area, 'keys_updated' => array_keys($updated)]);
    }

    /** GET /api/v2/admin/config/algorithm-health */
    public function getAlgorithmHealth(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $fulltextIndexes = [];
        $indexChecks = [
            ['table' => 'listings', 'index' => 'ft_listings_search'],
            ['table' => 'users', 'index' => 'ft_users_search'],
            ['table' => 'feed_activity', 'index' => 'ft_feed_search'],
        ];

        foreach ($indexChecks as $check) {
            try {
                $row = DB::selectOne(
                    "SELECT COUNT(*) as cnt FROM information_schema.STATISTICS WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?",
                    [$check['table'], $check['index']]
                );
                $fulltextIndexes[$check['table']] = (int) ($row->cnt ?? 0) > 0;
            } catch (\Throwable $e) {
                $fulltextIndexes[$check['table']] = false;
            }
        }

        $cfData = [];
        try {
            $row = DB::selectOne(
                "SELECT COUNT(*) as cnt FROM listing_favorites lf JOIN listings l ON lf.listing_id = l.id WHERE l.tenant_id = ?",
                [$tenantId]
            );
            $cfData['listing_interactions'] = (int) ($row->cnt ?? 0);
        } catch (\Throwable $e) {
            $cfData['listing_interactions'] = 0;
        }

        try {
            $row = DB::selectOne(
                "SELECT COUNT(DISTINCT CONCAT(LEAST(sender_id, receiver_id), '-', GREATEST(sender_id, receiver_id))) as cnt
                 FROM transactions WHERE tenant_id = ? AND status = 'completed'",
                [$tenantId]
            );
            $cfData['member_interactions'] = (int) ($row->cnt ?? 0);
        } catch (\Throwable $e) {
            $cfData['member_interactions'] = 0;
        }

        $embeddings = [];
        try {
            $embResults = DB::select(
                "SELECT content_type, COUNT(*) as cnt FROM content_embeddings WHERE tenant_id = ? GROUP BY content_type",
                [$tenantId]
            );
            $embRows = [];
            foreach ($embResults as $r) { $embRows[$r->content_type] = $r->cnt; }

            $embeddings['listing_count'] = (int) ($embRows['listing'] ?? 0);
            $embeddings['user_count'] = (int) ($embRows['user'] ?? 0);
            $embeddings['total'] = $embeddings['listing_count'] + $embeddings['user_count'];
        } catch (\Throwable $e) {
            $embeddings = ['listing_count' => 0, 'user_count' => 0, 'total' => 0];
        }

        $enabled = [
            'edgerank' => $this->feedRankingService->isEnabled(),
            'matchrank' => $this->listingRankingService->isEnabled(),
            'communityrank' => $this->memberRankingService->isEnabled(),
        ];

        $searchHealth = [
            'meilisearch_available' => $this->searchService->isAvailable(),
            'listing_index_count' => 0,
        ];

        return $this->respondWithData([
            'fulltext' => $fulltextIndexes,
            'collaborative_filtering' => $cfData,
            'embeddings' => $embeddings,
            'enabled' => $enabled,
            'search' => $searchHealth,
        ]);
    }

    // =========================================================================
    // Language Config
    // =========================================================================

    /** GET /api/v2/admin/config/language */
    public function getLanguageConfig(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $tenantRow = DB::selectOne("SELECT configuration FROM tenants WHERE id = ?", [$tenantId]);

        $config = [];
        if ($tenantRow && !empty($tenantRow->configuration)) {
            $config = json_decode($tenantRow->configuration, true) ?: [];
        }

        return $this->respondWithData([
            'default_language' => $config['default_language'] ?? 'en',
            'supported_languages' => $config['supported_languages'] ?? ['en'],
        ]);
    }

    /** PUT /api/v2/admin/config/language */
    public function updateLanguageConfig(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();
        $input = $this->getAllInput();

        if (isset($input['default_language'])) {
            if (!in_array($input['default_language'], self::VALID_LANGUAGES, true)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_default_language'), 'default_language', 400);
            }
        }

        if (isset($input['supported_languages'])) {
            if (!is_array($input['supported_languages'])) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.supported_languages_must_be_array'), 'supported_languages', 400);
            }
            if (!in_array('en', $input['supported_languages'], true)) {
                $input['supported_languages'][] = 'en';
            }
            foreach ($input['supported_languages'] as $lang) {
                if (!in_array($lang, self::VALID_LANGUAGES, true)) {
                    return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_language', ['lang' => $lang]), 'supported_languages', 400);
                }
            }
        }

        $tenantRow = DB::selectOne("SELECT configuration FROM tenants WHERE id = ?", [$tenantId]);
        $config = [];
        if ($tenantRow && !empty($tenantRow->configuration)) {
            $config = json_decode($tenantRow->configuration, true) ?: [];
        }

        if (isset($input['supported_languages'])) {
            $config['supported_languages'] = array_values($input['supported_languages']);
        }

        if (isset($input['default_language'])) {
            $supported = $config['supported_languages'] ?? ['en'];
            if (!in_array($input['default_language'], $supported, true)) {
                $config['default_language'] = 'en';
            } else {
                $config['default_language'] = $input['default_language'];
            }
        }

        DB::update("UPDATE tenants SET configuration = ? WHERE id = ?", [json_encode($config), $tenantId]);
        $this->redisCache->delete('tenant_bootstrap', $tenantId);

        return $this->respondWithData([
            'default_language' => $config['default_language'] ?? 'en',
            'supported_languages' => $config['supported_languages'] ?? ['en'],
        ]);
    }

    // =========================================================================
    // Private Helpers
    // =========================================================================

    private function ensureTenantSettingsTable(): void
    {
        // Runtime DDL causes an implicit MySQL commit even for
        // CREATE TABLE IF NOT EXISTS. That used to break the atomic settings +
        // prerender-job transaction: if enqueueing failed, the tenant update
        // could survive its rollback. Schema belongs to migrations; fail
        // explicitly if an installation has not applied them.
        if (!Schema::hasTable('tenant_settings')) {
            throw new \RuntimeException('tenant_settings table is missing; run database migrations');
        }
    }

    private function readSettingsByPrefix(int $tenantId, string $prefix): array
    {
        $this->ensureTenantSettingsTable();

        $rows = DB::select(
            "SELECT setting_key, setting_value FROM tenant_settings WHERE tenant_id = ? AND setting_key LIKE ?",
            [$tenantId, $prefix . '%']
        );

        $result = [];
        foreach ($rows as $row) {
            $result[$row->setting_key] = $row->setting_value;
        }
        return $result;
    }

    private function upsertSetting(int $tenantId, string $key, ?string $value, int $userId, string $type = 'string'): void
    {
        DB::statement(
            "INSERT INTO tenant_settings (tenant_id, setting_key, setting_value, setting_type, created_by, updated_by)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), setting_type = VALUES(setting_type), updated_by = VALUES(updated_by), updated_at = CURRENT_TIMESTAMP",
            [$tenantId, $key, $value, $type, $userId, $userId]
        );
    }

    /**
     * Complete list of all cron jobs managed by CronJobRunner.
     *
     * All jobs run automatically via the Laravel scheduler (artisan schedule:run)
     * which calls CronJobRunner::runAll() every minute. The command field is
     * the CronJobRunner method name (no HTTP endpoints — those were removed
     * 2026-04-02 to prevent duplicate email sends).
     */
    private function getCronJobDefinitions(): array
    {
        return [
            // ── Master ──
            ['id' => 'run-all', 'command' => 'runAll', 'schedule' => '* * * * *', 'category' => 'master'],

            // ── Notifications ──
            ['id' => 'process-queue', 'command' => 'runInstantQueue', 'schedule' => '* * * * *', 'category' => 'notifications'],
            ['id' => 'daily-digest', 'command' => 'dailyDigest', 'schedule' => '0 8 * * *', 'category' => 'notifications'],
            ['id' => 'weekly-digest', 'command' => 'weeklyDigest', 'schedule' => '0 17 1 * *', 'category' => 'notifications'],

            // ── Newsletters ──
            ['id' => 'process-newsletters', 'command' => 'processNewsletters', 'schedule' => '*/5 * * * *', 'category' => 'newsletters'],
            ['id' => 'process-recurring', 'command' => 'processRecurring', 'schedule' => '*/15 * * * *', 'category' => 'newsletters'],
            ['id' => 'process-newsletter-queue', 'command' => 'processNewsletterQueue', 'schedule' => '* * * * *', 'category' => 'newsletters'],

            // ── Matching ──
            ['id' => 'notify-hot-matches', 'command' => 'notifyHotMatches', 'schedule' => '0 * * * *', 'category' => 'matching'],
            ['id' => 'match-digest-daily', 'command' => 'matchDigestDaily', 'schedule' => '0 9 * * *', 'category' => 'matching'],
            ['id' => 'match-digest-weekly', 'command' => 'matchDigestWeekly', 'schedule' => '0 9 * * 1', 'category' => 'matching'],

            // ── Gamification ──
            ['id' => 'gamification-daily', 'command' => 'gamificationDaily', 'schedule' => '0 3 * * *', 'category' => 'gamification'],
            ['id' => 'gamification-campaigns', 'command' => 'gamificationCampaigns', 'schedule' => '0 * * * *', 'category' => 'gamification'],
            ['id' => 'gamification-leaderboard', 'command' => 'gamificationLeaderboard', 'schedule' => '0 0 * * *', 'category' => 'gamification'],
            ['id' => 'gamification-challenges', 'command' => 'gamificationChallenges', 'schedule' => '30 * * * *', 'category' => 'gamification'],
            ['id' => 'gamification-weekly-digest', 'command' => 'gamificationWeeklyDigest', 'schedule' => '0 4 1 * *', 'category' => 'gamification'],
            ['id' => 'gamification-streaks', 'command' => 'gamificationStreaks', 'schedule' => '0 1 * * *', 'category' => 'gamification'],
            ['id' => 'gamification-cleanup', 'command' => 'gamificationCleanup', 'schedule' => '0 3 * * 0', 'category' => 'gamification'],

            // ── Groups ──
            ['id' => 'update-featured-groups', 'command' => 'updateFeaturedGroups', 'schedule' => '0 8 * * *', 'category' => 'groups'],
            ['id' => 'group-weekly-digest', 'command' => 'groupWeeklyDigest', 'schedule' => '0 9 1 * *', 'category' => 'groups'],

            // ── Security ──
            ['id' => 'abuse-detection', 'command' => 'abuseDetection', 'schedule' => '0 * * * *', 'category' => 'security'],
            ['id' => 'abuse-daily-report', 'command' => 'abuseDailyReport', 'schedule' => '0 7 * * *', 'category' => 'security'],
            ['id' => 'abuse-cleanup', 'command' => 'abuseCleanup', 'schedule' => '0 2 * * 0', 'category' => 'security'],

            // ── Identity Verification ──
            ['id' => 'verification-reminders', 'command' => 'verificationReminders', 'schedule' => '0 */6 * * *', 'category' => 'verification'],
            ['id' => 'expire-verifications', 'command' => 'expireVerifications', 'schedule' => '30 4 * * *', 'category' => 'verification'],
            ['id' => 'purge-verification-sessions', 'command' => 'purgeVerificationSessions', 'schedule' => '30 3 * * 0', 'category' => 'verification'],

            // ── Volunteering ──
            ['id' => 'volunteer-pre-shift', 'command' => 'volunteerPreShiftReminders', 'schedule' => '*/30 * * * *', 'category' => 'volunteering'],
            ['id' => 'volunteer-post-shift', 'command' => 'volunteerPostShiftFeedback', 'schedule' => '*/30 * * * *', 'category' => 'volunteering'],
            ['id' => 'volunteer-lapsed-nudge', 'command' => 'volunteerLapsedNudge', 'schedule' => '0 5 * * *', 'category' => 'volunteering'],
            ['id' => 'volunteer-expiry-warnings', 'command' => 'volunteerExpiryWarnings', 'schedule' => '0 5 * * *', 'category' => 'volunteering'],
            ['id' => 'recurring-shifts', 'command' => 'recurringShifts', 'schedule' => '0 6 * * *', 'category' => 'volunteering'],
            ['id' => 'volunteer-expire-consents', 'command' => 'volunteerExpireConsents', 'schedule' => '0 5 * * *', 'category' => 'volunteering'],

            // ── Maintenance ──
            ['id' => 'cleanup', 'command' => 'cleanup', 'schedule' => '0 0 * * *', 'category' => 'maintenance'],
            ['id' => 'geocode-batch', 'command' => 'geocodeBatch', 'schedule' => '*/30 * * * *', 'category' => 'maintenance'],
            ['id' => 'event-reminders', 'command' => 'eventReminders', 'schedule' => '*/15 * * * *', 'category' => 'notifications'],
            ['id' => 'inactive-members', 'command' => 'inactiveMembers', 'schedule' => '0 2 * * *', 'category' => 'maintenance'],
            ['id' => 'listing-expiry', 'command' => 'listingExpiry', 'schedule' => '0 8 * * *', 'category' => 'maintenance'],
            ['id' => 'listing-expiry-reminders', 'command' => 'listingExpiryReminders', 'schedule' => '0 8 * * *', 'category' => 'notifications'],
            ['id' => 'job-expiry', 'command' => 'jobExpiry', 'schedule' => '0 8 * * *', 'category' => 'maintenance'],
            ['id' => 'federation-weekly-digest', 'command' => 'federationWeeklyDigest', 'schedule' => '0 9 1 * *', 'category' => 'notifications'],
            ['id' => 'balance-alerts', 'command' => 'balanceAlerts', 'schedule' => '0 8 * * *', 'category' => 'notifications'],
            ['id' => 'goal-reminders', 'command' => 'goalReminders', 'schedule' => '0 8 * * *', 'category' => 'notifications'],
            ['id' => 'retry-failed-webhooks', 'command' => 'retryFailedWebhooks', 'schedule' => '*/5 * * * *', 'category' => 'maintenance'],
        ];
    }

    private function calculateNextRun(string $cronExpression): ?string
    {
        try {
            $parts = explode(' ', $cronExpression);
            if (count($parts) !== 5) return null;

            [$minute, $hour, $dayOfMonth, $month, $dayOfWeek] = $parts;
            $now = new \DateTime();
            $next = clone $now;

            if ($minute === '*' && $hour === '*') {
                $next->modify('+1 minute');
                return $next->format('Y-m-d H:i:s');
            }
            if (strpos($minute, '*/') === 0) {
                $interval = (int) substr($minute, 2);
                $currentMinute = (int) $now->format('i');
                $nextMinute = (int) (ceil($currentMinute / $interval) * $interval);
                if ($nextMinute >= 60) {
                    $next->modify('+1 hour');
                    $next->setTime((int) $next->format('H'), 0);
                } else {
                    $next->setTime((int) $now->format('H'), $nextMinute);
                }
                if ($next <= $now) $next->modify("+{$interval} minutes");
                return $next->format('Y-m-d H:i:s');
            }
            if ($minute !== '*' && $hour !== '*' && $dayOfWeek !== '*') {
                $targetDay = (int) $dayOfWeek;
                $currentDay = (int) $now->format('w');
                $daysUntil = ($targetDay - $currentDay + 7) % 7;
                if ($daysUntil === 0 && $now->format('H:i') >= sprintf('%02d:%02d', $hour, $minute)) {
                    $daysUntil = 7;
                }
                $next->modify("+{$daysUntil} days");
                $next->setTime((int) $hour, (int) $minute);
                return $next->format('Y-m-d H:i:s');
            }
            if ($minute !== '*' && $hour !== '*') {
                $next->setTime((int) $hour, (int) $minute);
                if ($next <= $now) $next->modify('+1 day');
                return $next->format('Y-m-d H:i:s');
            }
            if ($minute === '0' && $hour === '*') {
                $next->modify('+1 hour');
                $next->setTime((int) $next->format('H'), 0);
                return $next->format('Y-m-d H:i:s');
            }
            if ($minute === '30' && $hour === '*') {
                if ((int) $now->format('i') >= 30) $next->modify('+1 hour');
                $next->setTime((int) $next->format('H'), 30);
                return $next->format('Y-m-d H:i:s');
            }
            return null;
        } catch (\Throwable $e) {
            return null;
        }
    }

    // =========================================================================
    // Events Module Configuration
    // =========================================================================

    /** GET /api/v2/admin/config/events */
    public function getEventConfig(): JsonResponse
    {
        $this->requireAdmin();

        return $this->respondWithData(
            $this->eventConfigurationService->inspect($this->getTenantId()),
        );
    }

    /** GET /api/v2/admin/config/events/audit-log */
    public function getEventConfigAuditLog(): JsonResponse
    {
        $this->requireAdmin();
        $entries = DB::table('org_audit_log as audit')
            ->leftJoin('users as actor', function ($join): void {
                $join->on('actor.id', '=', 'audit.user_id')
                    ->on('actor.tenant_id', '=', 'audit.tenant_id');
            })
            ->where('audit.tenant_id', $this->getTenantId())
            ->whereIn('audit.action', [
                'events_configuration_updated',
                'events_configuration_defaults_restored',
            ])
            ->orderByDesc('audit.id')
            ->limit(50)
            ->get([
                'audit.id',
                'audit.action',
                'audit.details',
                'audit.created_at',
                'audit.user_id',
                'actor.name as actor_name',
            ])
            ->map(static function (object $entry): array {
                $details = is_string($entry->details) ? json_decode($entry->details, true) : null;
                return [
                    'id' => (int) $entry->id,
                    'action' => (string) $entry->action,
                    'actor_id' => $entry->user_id === null ? null : (int) $entry->user_id,
                    'actor_name' => is_string($entry->actor_name) ? $entry->actor_name : null,
                    'reason' => is_array($details) && is_string($details['reason'] ?? null)
                        ? $details['reason']
                        : null,
                    'version' => is_array($details) ? (int) ($details['version'] ?? 0) : 0,
                    'changes' => is_array($details) && is_array($details['changes'] ?? null)
                        ? $details['changes']
                        : [],
                    'created_at' => (string) $entry->created_at,
                ];
            })
            ->all();

        return $this->respondWithData($entries);
    }

    /** PUT /api/v2/admin/config/events */
    public function updateEventConfig(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $settings = $this->input('settings');
        $version = $this->input('version');
        $reason = $this->input('reason');

        if (! is_array($settings) || $settings === []) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.events_config_settings_required'), 'settings', 422);
        }
        if (! is_int($version) && ! (is_string($version) && ctype_digit($version))) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.events_config_version_required'), 'version', 422);
        }
        if (! is_string($reason) || trim($reason) === '') {
            return $this->respondWithError('VALIDATION_ERROR', __('api.events_config_reason_required'), 'reason', 422);
        }
        $result = $this->eventConfigurationService->update(
            $this->getTenantId(),
            $adminId,
            (int) $version,
            $settings,
            $reason,
            $this->input('confirm_disruptive') === true,
        );
        $this->redisCache->delete('tenant_bootstrap', $this->getTenantId());

        return $this->respondWithData($result);
    }

    /** POST /api/v2/admin/config/events/restore-defaults */
    public function restoreEventConfigDefaults(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $version = $this->input('version');
        $reason = $this->input('reason');
        $keys = $this->input('keys');
        if (! is_int($version) && ! (is_string($version) && ctype_digit($version))) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.events_config_version_required'), 'version', 422);
        }
        if (! is_string($reason) || trim($reason) === '') {
            return $this->respondWithError('VALIDATION_ERROR', __('api.events_config_reason_required'), 'reason', 422);
        }
        if ($keys !== null && (! is_array($keys)
            || $keys === []
            || array_filter($keys, static fn (mixed $key): bool => ! is_string($key)) !== [])) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.events_config_unknown_key'), 'keys', 422);
        }

        $result = $this->eventConfigurationService->restoreDefaults(
            $this->getTenantId(),
            $adminId,
            (int) $version,
            $reason,
            $keys === null ? null : array_values($keys),
        );
        $this->redisCache->delete('tenant_bootstrap', $this->getTenantId());

        return $this->respondWithData($result);
    }

    // =========================================================================
    // Groups Module Configuration
    // =========================================================================

    /** GET /api/v2/admin/config/groups */
    public function getGroupConfig(): JsonResponse
    {
        $this->requireAdmin();

        $all = GroupConfigurationService::getAll();

        return $this->respondWithData([
            'config' => $all,
            'defaults' => GroupConfigurationService::DEFAULTS,
        ]);
    }

    /** PUT /api/v2/admin/config/groups */
    public function updateGroupConfig(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $key = $this->input('key');
        $value = $this->input('value');

        if (!$key || !is_string($key)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.group_config_key_required'), 'key', 422);
        }

        if (!array_key_exists($key, GroupConfigurationService::DEFAULTS)) {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                __('api.group_config_key_invalid', ['key' => $key]),
                'key',
                422,
            );
        }

        if ($value === null) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.group_config_value_required'), 'value', 422);
        }

        try {
            $value = GroupConfigurationService::normalize($key, $value);
        } catch (\InvalidArgumentException) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_input'), 'value', 422);
        }

        GroupConfigurationService::set($key, $value);

        // Invalidate bootstrap cache so frontend picks up changes
        $this->redisCache->delete('tenant_bootstrap', $tenantId);

        return $this->respondWithData([
            'key' => $key,
            'value' => $value,
        ]);
    }

    /** PUT /api/v2/admin/config/groups/bulk */
    public function updateGroupConfigBulk(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $settings = $this->input('settings');
        if (!is_array($settings) || empty($settings)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.group_config_settings_required'), 'settings', 422);
        }

        $normalized = [];
        foreach ($settings as $key => $value) {
            if (!is_string($key) || !array_key_exists($key, GroupConfigurationService::DEFAULTS)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.group_config_key_invalid', ['key' => (string) $key]), 'settings', 422);
            }

            try {
                $value = GroupConfigurationService::normalize($key, $value);
            } catch (\InvalidArgumentException) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_input'), $key, 422);
            }

            $normalized[$key] = $value;
        }

        $effective = array_merge(GroupConfigurationService::getAll(), $normalized);
        if ($effective[GroupConfigurationService::CONFIG_MIN_DESCRIPTION_LENGTH] > $effective[GroupConfigurationService::CONFIG_MAX_DESCRIPTION_LENGTH]) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_input'), GroupConfigurationService::CONFIG_MIN_DESCRIPTION_LENGTH, 422);
        }

        foreach ($normalized as $key => $value) {
            GroupConfigurationService::set($key, $value);
        }

        $this->redisCache->delete('tenant_bootstrap', $tenantId);

        return $this->respondWithData(['updated' => $normalized]);
    }

    // =========================================================================
    // Listings Module Configuration
    // =========================================================================

    /** GET /api/v2/admin/config/listings */
    public function getListingConfig(): JsonResponse
    {
        $this->requireAdmin();

        $all = ListingConfigurationService::getAll();

        return $this->respondWithData([
            'config' => $all,
            'defaults' => ListingConfigurationService::DEFAULTS,
        ]);
    }

    /** PUT /api/v2/admin/config/listings */
    public function updateListingConfig(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $key = $this->input('key');
        $value = $this->input('value');

        // Type-check key before truth-testing so arrays/objects don't slip through
        if (!is_string($key) || $key === '') {
            return $this->respondWithError('VALIDATION_ERROR', __('api.missing_required_field', ['field' => 'key']), 'key', 422);
        }

        if (!array_key_exists($key, ListingConfigurationService::DEFAULTS)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.configuration_key_unknown', ['key' => $key]), 'key', 422);
        }

        if ($value === null) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.missing_required_field', ['field' => 'value']), 'value', 422);
        }

        $defaultValue = ListingConfigurationService::DEFAULTS[$key];
        if (is_bool($defaultValue)) {
            $value = filter_var($value, FILTER_VALIDATE_BOOLEAN);
        } elseif (is_int($defaultValue)) {
            $value = (int) $value;
        } else {
            $value = (string) $value;
        }

        ListingConfigurationService::set($key, $value);
        $this->redisCache->delete('tenant_bootstrap', $tenantId);

        return $this->respondWithData(['key' => $key, 'value' => $value]);
    }

    /** PUT /api/v2/admin/config/listings/bulk */
    public function updateListingConfigBulk(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $settings = $this->input('settings');
        if (!is_array($settings) || empty($settings)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.non_empty_array_required', ['field' => 'settings']), 'settings', 422);
        }

        $updated = [];
        foreach ($settings as $key => $value) {
            if (!is_string($key) || !array_key_exists($key, ListingConfigurationService::DEFAULTS)) {
                continue;
            }

            $defaultValue = ListingConfigurationService::DEFAULTS[$key];
            if (is_bool($defaultValue)) {
                $value = filter_var($value, FILTER_VALIDATE_BOOLEAN);
            } elseif (is_int($defaultValue)) {
                $value = (int) $value;
            }

            ListingConfigurationService::set($key, $value);
            $updated[$key] = $value;
        }

        $this->redisCache->delete('tenant_bootstrap', $tenantId);

        return $this->respondWithData(['updated' => $updated]);
    }

    // =========================================================================
    // Volunteering Module Configuration
    // =========================================================================

    /** GET /api/v2/admin/config/volunteering */
    public function getVolunteeringConfig(): JsonResponse
    {
        $this->requireAdmin();

        return $this->respondWithData([
            'config' => VolunteeringConfigurationService::getAll(),
            'defaults' => VolunteeringConfigurationService::DEFAULTS,
        ]);
    }

    /** PUT /api/v2/admin/config/volunteering/bulk */
    public function updateVolunteeringConfigBulk(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $settings = $this->input('settings');
        if (!is_array($settings) || empty($settings)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.missing_required_field', ['field' => 'settings']), 'settings', 422);
        }

        $updated = [];
        foreach ($settings as $key => $value) {
            if (!is_string($key) || !array_key_exists($key, VolunteeringConfigurationService::DEFAULTS)) {
                continue;
            }

            $defaultValue = VolunteeringConfigurationService::DEFAULTS[$key];
            if (is_bool($defaultValue)) {
                $value = filter_var($value, FILTER_VALIDATE_BOOLEAN);
            } elseif (is_int($defaultValue)) {
                $value = (int) $value;
            }

            VolunteeringConfigurationService::set($key, $value);
            $updated[$key] = $value;
        }

        $this->redisCache->delete('tenant_bootstrap', $tenantId);

        return $this->respondWithData(['updated' => $updated]);
    }

    // =========================================================================
    // Jobs Module Configuration
    // =========================================================================

    /** GET /api/v2/admin/config/jobs */
    public function getJobConfig(): JsonResponse
    {
        $this->requireAdmin();

        return $this->respondWithData([
            'config' => JobConfigurationService::getAll(),
            'defaults' => JobConfigurationService::DEFAULTS,
        ]);
    }

    /** PUT /api/v2/admin/config/jobs/bulk */
    public function updateJobConfigBulk(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $settings = $this->input('settings');
        if (!is_array($settings) || empty($settings)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.non_empty_array_required', ['field' => 'settings']), 'settings', 422);
        }

        $updated = [];
        foreach ($settings as $key => $value) {
            if (!is_string($key) || !array_key_exists($key, JobConfigurationService::DEFAULTS)) {
                continue;
            }

            $defaultValue = JobConfigurationService::DEFAULTS[$key];
            if (is_bool($defaultValue)) {
                $value = filter_var($value, FILTER_VALIDATE_BOOLEAN);
            } elseif (is_int($defaultValue)) {
                $value = (int) $value;
            }

            JobConfigurationService::set($key, $value);
            $updated[$key] = $value;
        }

        $this->redisCache->delete('tenant_bootstrap', $tenantId);

        return $this->respondWithData(['updated' => $updated]);
    }

    // =========================================================================
    // Podcasts Module Configuration
    // =========================================================================

    /** GET /api/v2/admin/config/podcasts */
    public function getPodcastConfig(): JsonResponse
    {
        $this->requireAdmin();

        return $this->respondWithData([
            'config' => PodcastConfigurationService::getAll(),
            'defaults' => PodcastConfigurationService::DEFAULTS,
        ]);
    }

    /** PUT /api/v2/admin/config/podcasts/bulk */
    public function updatePodcastConfigBulk(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $settings = $this->input('settings');
        if (!is_array($settings) || empty($settings)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api_controllers_2.podcasts.settings_required'), 'settings', 422);
        }

        // Storage settings are validated up-front against the merged intent
        // (submitted values overlaid on current config) so a bad payload is
        // rejected atomically — the write loop below persists per key.
        $storageError = $this->validatePodcastStorageSettings($settings);
        if ($storageError !== null) {
            return $storageError;
        }

        $updated = [];
        foreach ($settings as $key => $value) {
            if (!is_string($key) || !array_key_exists($key, PodcastConfigurationService::DEFAULTS)) {
                continue;
            }

            $defaultValue = PodcastConfigurationService::DEFAULTS[$key];
            if (is_bool($defaultValue)) {
                $value = filter_var($value, FILTER_VALIDATE_BOOLEAN);
            } elseif (is_int($defaultValue)) {
                $value = max(0, (int) $value);
            }

            PodcastConfigurationService::set($key, $value);
            $updated[$key] = $value;
        }

        $this->redisCache->delete('tenant_bootstrap', $tenantId);
        $this->tenantSettingsService->clearCacheForTenant($tenantId);

        return $this->respondWithData(['updated' => $updated]);
    }

    /**
     * Reject podcast storage settings that would break media uploads: an
     * unknown driver, a cloud disk that is not configured on this server, a
     * cloud switch without the Flysystem adapter installed, or a CDN base
     * URL that is not http(s). Returns a 422 response or null when valid.
     */
    private function validatePodcastStorageSettings(array $settings): ?JsonResponse
    {
        $current = PodcastConfigurationService::getAll();
        $effective = static function (string $key) use ($settings, $current): string {
            return trim((string) (array_key_exists($key, $settings) ? $settings[$key] : ($current[$key] ?? '')));
        };

        $driver = $effective(PodcastConfigurationService::CONFIG_MEDIA_STORAGE_DRIVER);
        if (array_key_exists(PodcastConfigurationService::CONFIG_MEDIA_STORAGE_DRIVER, $settings)
            && !in_array($driver, ['local', 'cloud'], true)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api_controllers_2.podcasts.invalid_storage_driver'), PodcastConfigurationService::CONFIG_MEDIA_STORAGE_DRIVER, 422);
        }

        $disk = $effective(PodcastConfigurationService::CONFIG_CLOUD_STORAGE_DISK);
        $diskSubmitted = array_key_exists(PodcastConfigurationService::CONFIG_CLOUD_STORAGE_DISK, $settings);
        $diskConfig = $disk !== '' ? config("filesystems.disks.{$disk}") : null;
        if (($diskSubmitted || $driver === 'cloud') && !is_array($diskConfig)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api_controllers_2.podcasts.invalid_storage_disk'), PodcastConfigurationService::CONFIG_CLOUD_STORAGE_DISK, 422);
        }

        if ($driver === 'cloud'
            && is_array($diskConfig)
            && ($diskConfig['driver'] ?? '') === 's3'
            && !class_exists(\League\Flysystem\AwsS3V3\AwsS3V3Adapter::class)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api_controllers_2.podcasts.storage_driver_unavailable'), PodcastConfigurationService::CONFIG_MEDIA_STORAGE_DRIVER, 422);
        }

        $cdn = $effective(PodcastConfigurationService::CONFIG_CLOUD_CDN_BASE_URL);
        if (array_key_exists(PodcastConfigurationService::CONFIG_CLOUD_CDN_BASE_URL, $settings)
            && $cdn !== ''
            && !preg_match('#^https?://#i', $cdn)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api_controllers_2.podcasts.invalid_cdn_url'), PodcastConfigurationService::CONFIG_CLOUD_CDN_BASE_URL, 422);
        }

        return null;
    }

    // =========================================================================
    // Landing Page Configuration
    // =========================================================================

    /**
     * GET /api/v2/admin/config/landing-page
     *
     * Returns the landing page configuration for the current tenant.
     */
    public function getLandingPageConfig(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $row = DB::table('tenant_settings')
            ->where('tenant_id', $tenantId)
            ->where('setting_key', 'landing_page.config')
            ->value('setting_value');

        $config = null;
        if (!empty($row)) {
            $decoded = json_decode($row, true);
            if (is_array($decoded)) {
                $config = $decoded;
            }
        }

        return $this->respondWithData([
            'config' => $config,
        ]);
    }

    /**
     * PUT /api/v2/admin/config/landing-page
     *
     * Saves the landing page configuration for the current tenant.
     * Validates the structure before saving.
     */
    public function updateLandingPageConfig(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $config = $this->input('config');

        if ($config !== null && !is_array($config)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.landing_config_invalid'), 'config', 422);
        }

        // Validate structure if config provided
        if ($config !== null) {
            if (!isset($config['sections']) || !is_array($config['sections'])) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.landing_config_sections_required'), 'sections', 422);
            }

            $validTypes = ['hero', 'audience_cards', 'feature_pills', 'stats', 'how_it_works', 'core_values', 'cta'];
            foreach ($config['sections'] as $i => $section) {
                if (!isset($section['id'], $section['type'], $section['enabled'], $section['order'])) {
                    return $this->respondWithError(
                        'VALIDATION_ERROR',
                        __('api.landing_section_fields_required', ['section' => $i]),
                        'sections',
                        422,
                    );
                }
                if (!in_array($section['type'], $validTypes, true)) {
                    return $this->respondWithError(
                        'VALIDATION_ERROR',
                        __('api.landing_section_type_invalid', ['section' => $i, 'type' => $section['type']]),
                        'sections',
                        422,
                    );
                }
                if ($section['type'] === 'audience_cards' && isset($section['content']) && is_array($section['content'])) {
                    $cards = $section['content']['cards'] ?? null;
                    if ($cards !== null) {
                        if (!is_array($cards)) {
                            return $this->respondWithError(
                                'VALIDATION_ERROR',
                                __('api.landing_cards_invalid', ['section' => $i]),
                                'sections',
                                422,
                            );
                        }
                        if (count($cards) > 4) {
                            return $this->respondWithError(
                                'VALIDATION_ERROR',
                                __('api.landing_cards_limit', ['section' => $i, 'max' => 4]),
                                'sections',
                                422,
                            );
                        }
                        foreach ($cards as $ci => $card) {
                            if (!is_array($card)) {
                                return $this->respondWithError(
                                    'VALIDATION_ERROR',
                                    __('api.landing_card_invalid', ['section' => $i, 'card' => $ci]),
                                    'sections',
                                    422,
                                );
                            }
                            $url = $card['target_url'] ?? '';
                            if (!is_string($url) || $url === '') {
                                return $this->respondWithError(
                                    'VALIDATION_ERROR',
                                    __('api.landing_card_target_required', ['section' => $i, 'card' => $ci]),
                                    'sections',
                                    422,
                                );
                            }
                            $isRelative = str_starts_with($url, '/') && !str_starts_with($url, '//');
                            $isHttp = preg_match('#^https?://#i', $url) === 1;
                            if (!$isRelative && !$isHttp) {
                                return $this->respondWithError(
                                    'VALIDATION_ERROR',
                                    __('api.landing_card_target_invalid', ['section' => $i, 'card' => $ci]),
                                    'sections',
                                    422,
                                );
                            }
                            foreach (['title', 'description', 'cta_label'] as $field) {
                                if (!isset($card[$field]) || !is_string($card[$field])) {
                                    return $this->respondWithError(
                                        'VALIDATION_ERROR',
                                        __('api.landing_card_field_required', [
                                            'section' => $i,
                                            'card' => $ci,
                                            'field' => $field,
                                        ]),
                                        'sections',
                                        422,
                                    );
                                }
                                if (mb_strlen($card[$field]) > 500) {
                                    return $this->respondWithError(
                                        'VALIDATION_ERROR',
                                        __('api.landing_card_field_too_long', [
                                            'section' => $i,
                                            'card' => $ci,
                                            'field' => $field,
                                            'max' => 500,
                                        ]),
                                        'sections',
                                        422,
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }

        try {
            DB::transaction(function () use ($config, $tenantId): void {
                if ($config === null) {
                    // Delete the setting to revert to defaults.
                    DB::table('tenant_settings')
                        ->where('tenant_id', $tenantId)
                        ->where('setting_key', 'landing_page.config')
                        ->delete();
                } else {
                    $jsonValue = json_encode($config, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
                    DB::table('tenant_settings')->updateOrInsert(
                        ['tenant_id' => $tenantId, 'setting_key' => 'landing_page.config'],
                        ['setting_value' => $jsonValue, 'setting_type' => 'json']
                    );
                }

                // The landing page is tenant-specific; commit its replacement
                // job intent with the customization itself.
                app(PrerenderContentInvalidator::class)->refreshTenantOrFail($tenantId, true);
            });
        } catch (\Throwable $e) {
            report($e);
            return $this->respondWithError('PRERENDER_REFRESH_FAILED', __('api.prerender_reset_failed'), null, 503);
        }

        // Clear tenant bootstrap cache so changes take effect immediately
        $this->redisCache->delete('tenant_bootstrap', $tenantId);
        $this->tenantSettingsService->clearCacheForTenant($tenantId);

        return $this->respondWithData(['success' => true]);
    }

    // =========================================================================
    // Translation Configuration (INT9)
    // =========================================================================

    /** GET /api/v2/admin/config/translation */
    public function getTranslationConfig(): JsonResponse
    {
        $this->requireAdmin();

        $all = \App\Services\TranslationConfigurationService::getAll();

        return $this->respondWithData([
            'config' => $all,
            'defaults' => \App\Services\TranslationConfigurationService::DEFAULTS,
        ]);
    }

    /** PUT /api/v2/admin/config/translation */
    public function updateTranslationConfig(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $key = $this->input('key');
        $value = $this->input('value');

        if (!$key || !is_string($key)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.missing_required_field', ['field' => 'key']), 'key', 422);
        }

        if (!array_key_exists($key, \App\Services\TranslationConfigurationService::DEFAULTS)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.configuration_key_unknown', ['key' => $key]), 'key', 422);
        }

        if ($value === null) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.missing_required_field', ['field' => 'value']), 'value', 422);
        }

        $defaultValue = \App\Services\TranslationConfigurationService::DEFAULTS[$key];
        if (is_bool($defaultValue)) {
            $value = filter_var($value, FILTER_VALIDATE_BOOLEAN);
        } elseif (is_int($defaultValue)) {
            $value = max(1, min(1000, (int) $value));
        }

        \App\Services\TranslationConfigurationService::set($key, $value);
        $this->redisCache->delete('tenant_bootstrap', $tenantId);

        return $this->respondWithData(['key' => $key, 'value' => $value]);
    }

    /** PUT /api/v2/admin/config/translation/bulk */
    public function updateTranslationConfigBulk(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $settings = $this->input('settings');
        if (!is_array($settings) || empty($settings)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.non_empty_array_required', ['field' => 'settings']), 'settings', 422);
        }

        $updated = [];
        foreach ($settings as $key => $value) {
            if (!is_string($key) || !array_key_exists($key, \App\Services\TranslationConfigurationService::DEFAULTS)) {
                continue;
            }

            $defaultValue = \App\Services\TranslationConfigurationService::DEFAULTS[$key];
            if (is_bool($defaultValue)) {
                $value = filter_var($value, FILTER_VALIDATE_BOOLEAN);
            } elseif (is_int($defaultValue)) {
                $value = max(1, min(1000, (int) $value));
            }

            \App\Services\TranslationConfigurationService::set($key, $value);
            $updated[$key] = $value;
        }

        $this->redisCache->delete('tenant_bootstrap', $tenantId);

        return $this->respondWithData(['updated' => $updated]);
    }

    // =========================================================================
    // Translation Glossary CRUD (INT10)
    // =========================================================================

    /** GET /api/v2/admin/translation/glossary */
    public function getGlossary(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        if (!DB::getSchemaBuilder()->hasTable('translation_glossaries')) {
            return $this->respondWithData(['items' => [], 'total' => 0]);
        }

        $language = $this->query('language');
        $query = DB::table('translation_glossaries')->where('tenant_id', $tenantId);

        if ($language) {
            $query->where('target_language', $language);
        }

        $items = $query->orderBy('source_term')->get();

        return $this->respondWithData(['items' => $items, 'total' => $items->count()]);
    }

    /** POST /api/v2/admin/translation/glossary */
    public function createGlossaryEntry(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $sourceTerm = trim($this->input('source_term', ''));
        $targetTerm = trim($this->input('target_term', ''));
        $targetLanguage = trim($this->input('target_language', ''));

        if (empty($sourceTerm)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.missing_required_field', ['field' => 'source_term']), 'source_term', 422);
        }
        if (empty($targetTerm)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.missing_required_field', ['field' => 'target_term']), 'target_term', 422);
        }
        if (empty($targetLanguage)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.missing_required_field', ['field' => 'target_language']), 'target_language', 422);
        }
        if (mb_strlen($sourceTerm) > 255 || mb_strlen($targetTerm) > 255) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.glossary_terms_too_long', ['max' => 255]), null, 422);
        }
        if (!preg_match('/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/', $targetLanguage)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.glossary_language_invalid'), 'target_language', 422);
        }

        try {
            $id = DB::table('translation_glossaries')->insertGetId([
                'tenant_id' => $tenantId,
                'source_term' => $sourceTerm,
                'target_term' => $targetTerm,
                'target_language' => $targetLanguage,
                'is_active' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        } catch (\Illuminate\Database\QueryException $e) {
            if (str_contains($e->getMessage(), 'Duplicate entry') || str_contains($e->getMessage(), '1062')) {
                return $this->respondWithError(
                    'DUPLICATE',
                    __('api.glossary_duplicate', ['term' => $sourceTerm, 'language' => $targetLanguage]),
                    'source_term',
                    409,
                );
            }
            throw $e;
        }

        return $this->respondWithData(['id' => $id], null, 201);
    }

    /** DELETE /api/v2/admin/translation/glossary/{id} */
    public function deleteGlossaryEntry(int $id): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $deleted = DB::table('translation_glossaries')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->delete();

        if (!$deleted) {
            return $this->respondWithError('NOT_FOUND', __('api.glossary_not_found'), null, 404);
        }

        return $this->respondWithData(['deleted' => true]);
    }

    // =========================================================================
    // Authentication Configuration
    // =========================================================================

    /** GET /api/v2/admin/config/authentication */
    public function getAuthenticationConfig(): JsonResponse
    {
        $this->requireSuperAdmin();
        $tenantId = $this->getTenantId();

        return $this->respondWithData([
            'config' => AuthenticationConfigurationService::getAll($tenantId),
            'defaults' => AuthenticationConfigurationService::DEFAULTS,
        ]);
    }

    /** PUT /api/v2/admin/config/authentication/bulk */
    public function updateAuthenticationConfigBulk(): JsonResponse
    {
        $this->requireSuperAdmin();
        $tenantId = $this->getTenantId();

        $settings = $this->input('settings');
        if (!is_array($settings) || empty($settings)) {
            return $this->respondWithError(
                'VALIDATION_ERROR',
                __('api.missing_required_field', ['field' => 'settings']),
                'settings',
                422
            );
        }

        foreach ($settings as $key => $value) {
            if (!is_string($key) || !array_key_exists($key, AuthenticationConfigurationService::DEFAULTS)) {
                return $this->respondWithError(
                    'VALIDATION_ERROR',
                    __('api.no_recognized_settings', ['keys' => (string) $key]),
                    is_string($key) ? $key : 'settings',
                    422
                );
            }

            if (!AuthenticationConfigurationService::isValidValue($key, $value)) {
                return $this->respondWithError(
                    'VALIDATION_ERROR',
                    __('api.validation_failed'),
                    $key,
                    422
                );
            }
        }

        $current = AuthenticationConfigurationService::getAll($tenantId);
        $revokeTrustedDevices = ($current[AuthenticationConfigurationService::CONFIG_TWO_FACTOR_ALLOW_TRUSTED_DEVICES] ?? true) === true
            && array_key_exists(AuthenticationConfigurationService::CONFIG_TWO_FACTOR_ALLOW_TRUSTED_DEVICES, $settings)
            && $settings[AuthenticationConfigurationService::CONFIG_TWO_FACTOR_ALLOW_TRUSTED_DEVICES] === false;
        $actorId = (int) auth()->id();

        DB::transaction(function () use ($settings, $tenantId, $revokeTrustedDevices, $actorId): void {
            foreach ($settings as $key => $value) {
                AuthenticationConfigurationService::set($key, $value, $tenantId, $actorId);
            }

            if ($revokeTrustedDevices && Schema::hasTable('user_trusted_devices')) {
                DB::table('user_trusted_devices')
                    ->where('tenant_id', $tenantId)
                    ->where('is_revoked', 0)
                    ->update([
                        'is_revoked' => 1,
                        'revoked_at' => now(),
                        'revoked_reason' => 'tenant_policy_disabled',
                        'updated_at' => now(),
                    ]);
            }
        });

        AuthenticationConfigurationService::clearCache($tenantId);
        $this->tenantSettingsService->clearCacheForTenant($tenantId);
        $this->redisCache->delete('tenant_bootstrap', $tenantId);
        $this->redisCache->delete('tenants_list_public');
        $this->redisCache->delete('tenants_list_public_all');

        return $this->respondWithData(['updated' => $settings]);
    }

    // =========================================================================
    // Identity Verification Configuration
    // =========================================================================

    private const IDENTITY_DEFAULTS = [
        'identity_verification_fee_cents' => 500,
    ];

    /** GET /api/v2/admin/config/identity */
    public function getIdentityConfig(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = TenantContext::getId();

        $config = [];
        foreach (self::IDENTITY_DEFAULTS as $key => $default) {
            $config[$key] = (int) $this->tenantSettingsService->get($tenantId, $key, (string) $default);
        }

        return $this->respondWithData([
            'config' => $config,
            'defaults' => self::IDENTITY_DEFAULTS,
        ]);
    }

    /** PUT /api/v2/admin/config/identity/bulk */
    public function updateIdentityConfigBulk(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $settings = $this->input('settings');
        if (!is_array($settings) || empty($settings)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.non_empty_array_required', ['field' => 'settings']), 'settings', 422);
        }

        $updated = [];
        foreach ($settings as $key => $value) {
            if (!array_key_exists($key, self::IDENTITY_DEFAULTS)) {
                continue;
            }
            $value = max(0, (int) $value);
            $this->tenantSettingsService->set($tenantId, $key, (string) $value, 'integer');
            $updated[$key] = $value;
        }

        $this->redisCache->delete('tenant_bootstrap', $tenantId);
        $this->tenantSettingsService->clearCacheForTenant($tenantId);

        return $this->respondWithData(['updated' => $updated]);
    }
}
