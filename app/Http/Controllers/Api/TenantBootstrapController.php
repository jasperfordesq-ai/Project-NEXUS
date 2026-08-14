<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Services\GroupConfigurationService;
use App\Services\JobConfigurationService;
use App\Services\ListingConfigurationService;
use App\Services\RedisCache;
use App\Services\VolunteeringConfigurationService;
use App\Services\TenantFeatureConfig;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use App\Core\TenantContext;
use App\Helpers\UrlHelper;
use App\Services\BrokerControlConfigService;
use App\Services\AuthenticationConfigurationService;

/**
 * TenantBootstrapController -- Tenant configuration bootstrap for SPA init.
 *
 * Native DB facade implementation (no delegation).
 *
 * Endpoints:
 *   GET /api/v2/tenant/bootstrap    bootstrap()
 *   GET /api/v2/tenants             list()
 *   GET /api/v2/platform/stats      platformStats()
 */
class TenantBootstrapController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly RedisCache $redisCache,
        private readonly TenantFeatureConfig $tenantFeatureConfig,
        private readonly BrokerControlConfigService $brokerControlConfigService,
        private readonly AuthenticationConfigurationService $authenticationConfigurationService,
    ) {}

    /** Cache TTL for tenant bootstrap data (10 minutes) */
    private const CACHE_TTL = 600;

    /** Cache key prefix for bootstrap data */
    private const CACHE_KEY = 'tenant_bootstrap';

    /**
     * GET /api/v2/tenant/bootstrap
     *
     * Returns tenant configuration for frontend initialization.
     * Public endpoint — no authentication required.
     *
     * Query Parameters:
     *   slug: (optional) - Tenant slug for explicit lookup (takes priority)
     */
    public function bootstrap(): JsonResponse
    {
        // Check for explicit slug query parameter (used by React frontend for tenant switching)
        $slug = $this->query('slug');
        if ($slug !== null && $slug !== '') {
            $slug = trim($slug);

            $slugTenant = DB::table('tenants')
                ->where('slug', $slug)
                ->where('is_active', 1)
                ->first();

            if (!$slugTenant) {
                // TRS-001 fail-closed: unknown slug MUST 404, never fall back to master tenant
                return $this->respondWithError(
                    'TENANT_NOT_FOUND',
                    __('api.community_not_found_or_inactive'),
                    null,
                    404
                );
            }

            $slugTenant = (array) $slugTenant;
            $tenantId = (int) $slugTenant['id'];

            // Set TenantContext so downstream calls read config for the correct tenant
            TenantContext::setById($tenantId);

            // Try cache first
            $cached = $this->redisCache->get(self::CACHE_KEY, $tenantId);
            if ($cached !== null) {
                return $this->withPublicCache($this->respondWithData($cached), self::CACHE_TTL, 300);
            }

            $data = $this->buildBootstrapData($slugTenant);
            $this->redisCache->set(self::CACHE_KEY, $data, self::CACHE_TTL, $tenantId);
            return $this->withPublicCache($this->respondWithData($data), self::CACHE_TTL, 300);
        }

        // Host-based resolution takes priority — TenantContext was resolved from
        // the actual HTTP Host header by index.php (the domain the user is on).
        // Only fall back to Origin header when TenantContext resolved to master (ID 1),
        // which means the Host was a generic/shared domain (e.g. app.project-nexus.ie).
        $tenantId = TenantContext::getId();

        // Origin-based resolution — ONLY when Host resolved to master tenant.
        // The Origin header reflects where the request came from, NOT where the user
        // is navigating. Using it when a custom domain already resolved the tenant
        // caused cross-tenant redirects (e.g. tonks.us user seeing pairc-goodman.com).
        if ($tenantId <= 1) {
            $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
            if ($origin) {
                $originHost = parse_url($origin, PHP_URL_HOST);
                if ($originHost) {
                    $originHost = preg_replace('/^www\./', '', $originHost);

                    // 🔴 `accessible_domain` must match here as well as `domain`, or a
                    // community's own ACCESSIBLE host can never be resolved through the
                    // accessible frontend.
                    //
                    // Why: that frontend is Node, and `fetch` FORBIDS setting a `Host`
                    // header — so it forwards the browser's host as `Origin` and depends on
                    // this fallback. Matching `domain` alone meant a tenant whose
                    // `accessible_domain` is set (and whose `domain` differs or is unset)
                    // resolved to nothing, and the request fell through to the community
                    // chooser instead of that community. Found 2026-08-13 by seeding such a
                    // tenant and walking it; the path had never been exercised, which is
                    // consistent with no production tenant having the column set.
                    //
                    // `domain` keeps precedence via the ordering, so an existing custom
                    // domain behaves exactly as before.
                    $originTenant = DB::table('tenants')
                        ->where(function ($query) use ($originHost) {
                            $query->where('domain', $originHost)
                                ->orWhere('accessible_domain', $originHost);
                        })
                        ->where('is_active', 1)
                        ->orderByRaw('CASE WHEN domain = ? THEN 0 ELSE 1 END', [$originHost])
                        ->first();

                    if ($originTenant && (int) $originTenant->id !== 1) {
                        $originTenant = (array) $originTenant;
                        $tenantId = (int) $originTenant['id'];

                        TenantContext::setById($tenantId);

                        $cached = $this->redisCache->get(self::CACHE_KEY, $tenantId);
                        if ($cached !== null) {
                            return $this->withPublicCache($this->respondWithData($cached), self::CACHE_TTL, 300);
                        }

                        $data = $this->buildBootstrapData($originTenant);
                        $this->redisCache->set(self::CACHE_KEY, $data, self::CACHE_TTL, $tenantId);
                        return $this->withPublicCache($this->respondWithData($data), self::CACHE_TTL, 300);
                    }
                }
            }
        }

        $cached = $this->redisCache->get(self::CACHE_KEY, $tenantId);
        if ($cached !== null) {
            return $this->withPublicCache($this->respondWithData($cached), self::CACHE_TTL, 300);
        }

        $tenant = TenantContext::get();

        // Guard: if resolved tenant is inactive, reject
        if (!empty($tenant['id']) && $tenant['id'] > 1 && empty($tenant['is_active'])) {
            return $this->respondWithError(
                \App\Core\ApiErrorCodes::INVALID_TENANT,
                __('api.tenant_inactive'),
                null,
                503
            );
        }

        $data = $this->buildBootstrapData($tenant);
        $this->redisCache->set(self::CACHE_KEY, $data, self::CACHE_TTL, $tenantId);

        return $this->withPublicCache($this->respondWithData($data), self::CACHE_TTL, 300);
    }

    /**
     * GET /api/v2/tenants
     *
     * Returns list of all active tenants for login selector.
     * Public endpoint — only returns minimal public info.
     */
    public function list(): JsonResponse
    {
        $includeMaster = $this->queryBool('include_master');

        $cacheKey = $includeMaster ? 'tenants_list_public_all' : 'tenants_list_public';
        $cached = $this->redisCache->get($cacheKey);

        if ($cached !== null) {
            return $this->withPublicCache($this->respondWithData($cached), 300, 60);
        }

        $query = DB::table('tenants')
            ->select('id', 'name', 'slug', 'domain', 'tagline', 'features')
            ->where('is_active', 1);

        if (!$includeMaster) {
            $query->where('id', '>', 1);
        }

        $tenants = $query->orderBy('id', 'asc')->get();

        $conditionalAutofill = DB::table('tenant_settings')
            ->whereIn('tenant_id', $tenants->pluck('id')->all())
            ->where('setting_key', 'passkeys.conditional_autofill')
            ->pluck('setting_value', 'tenant_id');

        $data = [];
        foreach ($tenants as $tenant) {
            $tenantFeatures = !empty($tenant->features)
                ? (json_decode((string) $tenant->features, true) ?: [])
                : [];
            $item = [
                'id' => (int) $tenant->id,
                'name' => $tenant->name,
                'slug' => $tenant->slug,
                'authentication_config' => [
                    'passkeys.conditional_autofill' => isset($conditionalAutofill[$tenant->id])
                        ? filter_var($conditionalAutofill[$tenant->id], FILTER_VALIDATE_BOOLEAN)
                        : true,
                ],
                'features' => [
                    'biometric_login' => array_key_exists('biometric_login', $tenantFeatures)
                        ? ((bool) $tenantFeatures['biometric_login'] && (bool) config('webauthn.authentication_enabled', true))
                        : ((bool) (TenantFeatureConfig::FEATURE_DEFAULTS['biometric_login'] ?? true)
                            && (bool) config('webauthn.authentication_enabled', true)),
                ],
            ];

            if (!empty($tenant->domain)) {
                $item['domain'] = $tenant->domain;
            }
            if (!empty($tenant->tagline)) {
                $item['tagline'] = $tenant->tagline;
            }

            $data[] = $item;
        }

        $this->redisCache->set($cacheKey, $data, 300);

        return $this->withPublicCache($this->respondWithData($data), 300, 60);
    }

    /**
     * GET /api/v2/platform/stats
     *
     * Returns landing-page statistics. Scoped to the requesting host:
     *   - Tenant custom domain (e.g. hour-timebank.ie) → stats for that
     *     tenant only. Visitors to a custom-domain site expect to see that
     *     community's numbers, not a network-wide aggregate.
     *   - Anything else (app.project-nexus.ie, project-nexus.ie, direct
     *     API hits) → platform-wide aggregate across all tenants.
     *
     * Resolves the previous inconsistency where hour-timebank.ie's homepage
     * showed network-wide members (331) while Discover on the same domain
     * showed tenant-only members (237).
     */
    public function platformStats(): JsonResponse
    {
        // Resolve tenant from Host first (TenantContext, already set by index.php),
        // falling back to Origin when Host is master (the React app on a custom
        // domain hits api.project-nexus.ie, so Origin carries the user's domain).
        // Mirrors the resolution chain used by bootstrap() above.
        $resolvedTenantId = TenantContext::getId();
        if ($resolvedTenantId <= 1) {
            $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
            if ($origin) {
                $originHost = parse_url($origin, PHP_URL_HOST) ?: '';
                $originHost = preg_replace('/^www\./', '', $originHost);
                if ($originHost) {
                    // 🔴 `accessible_domain` must match here as well as `domain`, or a
                    // community's own ACCESSIBLE host can never be resolved through the
                    // accessible frontend.
                    //
                    // Why: that frontend is Node, and `fetch` FORBIDS setting a `Host`
                    // header — so it forwards the browser's host as `Origin` and depends on
                    // this fallback. Matching `domain` alone meant a tenant whose
                    // `accessible_domain` is set (and whose `domain` differs or is unset)
                    // resolved to nothing, and the request fell through to the community
                    // chooser instead of that community. Found 2026-08-13 by seeding such a
                    // tenant and walking it; the path had never been exercised, which is
                    // consistent with no production tenant having the column set.
                    //
                    // `domain` keeps precedence via the ordering, so an existing custom
                    // domain behaves exactly as before.
                    $originTenant = DB::table('tenants')
                        ->where(function ($query) use ($originHost) {
                            $query->where('domain', $originHost)
                                ->orWhere('accessible_domain', $originHost);
                        })
                        ->where('is_active', 1)
                        ->orderByRaw('CASE WHEN domain = ? THEN 0 ELSE 1 END', [$originHost])
                        ->first();
                    if ($originTenant && (int) $originTenant->id !== 1) {
                        $resolvedTenantId = (int) $originTenant->id;
                    }
                }
            }
        }
        $scopedTenantId = $resolvedTenantId > 1 ? $resolvedTenantId : null;

        $cacheKey = $scopedTenantId !== null
            ? "platform_stats_public:tenant:{$scopedTenantId}"
            : 'platform_stats_public';
        $cached = $this->redisCache->get($cacheKey);

        if ($cached !== null) {
            return $this->withPublicCache($this->respondWithData($cached), 300, 60);
        }

        $membersQuery = DB::table('users')->where('status', 'active');
        $hoursQuery = DB::table('transactions')->where('status', 'completed');
        $listingsQuery = DB::table('listings')->where('status', 'active');

        if ($scopedTenantId !== null) {
            $membersQuery->where('tenant_id', $scopedTenantId);
            $hoursQuery->where('tenant_id', $scopedTenantId);
            $listingsQuery->where('tenant_id', $scopedTenantId);
        }

        $activeMembers = (int) $membersQuery->count();
        $hoursExchanged = (int) $hoursQuery->sum('amount');
        $activeListings = (int) $listingsQuery->count();

        $skillsQuery = DB::table('listings')
            ->where('status', 'active')
            ->whereNotNull('category_id');
        if ($scopedTenantId !== null) {
            $skillsQuery->where('tenant_id', $scopedTenantId);
        }
        $skillsListed = (int) $skillsQuery->distinct('category_id')->count('category_id');

        // "Communities" — for a tenant-scoped view this is always 1 (you're
        // looking at that community). For the platform view it's all
        // non-master tenants.
        $communities = $scopedTenantId !== null
            ? 1
            : (int) DB::table('tenants')->where('is_active', 1)->where('id', '>', 1)->count();

        $data = [
            'members' => $activeMembers,
            'hours_exchanged' => $hoursExchanged,
            'listings' => $activeListings,
            'skills' => $skillsListed,
            'communities' => $communities,
            'scope' => $scopedTenantId !== null ? 'tenant' : 'platform',
        ];

        $this->redisCache->set($cacheKey, $data, 300);

        return $this->withPublicCache($this->respondWithData($data), 300, 60);
    }

    // ========================================================================
    // Private helpers — ported from legacy TenantBootstrapController
    // ========================================================================

    /**
     * Build bootstrap data from tenant record.
     * Only exposes PUBLIC configuration.
     */
    private function buildBootstrapData(array $tenant): array
    {
        $config = $this->parseJson($tenant['configuration'] ?? null);
        $features = $this->parseJson($tenant['features'] ?? null);

        $data = [
            'id' => (int) $tenant['id'],
            'name' => $tenant['name'] ?? '',
            'slug' => $tenant['slug'] ?? '',
            'currency' => strtoupper(TenantContext::getCurrency()),
        ];

        if (!empty($tenant['domain'])) {
            $data['domain'] = $tenant['domain'];
        }
        // Dedicated accessible (GOV.UK) frontend domain, if configured. Lets the
        // SPA's "Accessible version" link point at the tenant's own accessible
        // host instead of the shared accessible.project-nexus.ie.
        if (!empty($tenant['accessible_domain'])) {
            $data['accessible_domain'] = $tenant['accessible_domain'];
        }
        if (!empty($tenant['tagline'])) {
            $data['tagline'] = $tenant['tagline'];
        }

        // If this tenant has no custom domain but its parent does, expose that parent
        // domain so the SPA knows to use path-prefixed routing (e.g. timebanking.uk/cardiff).
        // Computed from DB so the value is correct whether resolved via slug or parent-domain path.
        if (empty($tenant['domain']) && !empty($tenant['parent_id'])) {
            $parentDomain = DB::table('tenants')
                ->where('id', (int) $tenant['parent_id'])
                ->where('is_active', 1)
                ->value('domain');
            if (!empty($parentDomain)) {
                $data['parent_domain'] = $parentDomain;
            }
        }

        $data['default_layout'] = $tenant['default_layout'] ?? 'modern';
        $data['branding'] = $this->buildBrandingData($tenant, $config);
        $data['features'] = $this->buildFeaturesData($features);
        $data['features']['biometric_login'] = ($data['features']['biometric_login'] ?? true)
            && (bool) config('webauthn.authentication_enabled', true);
        $data['modules'] = $this->buildModulesData($config);
        $data['authentication_config'] = $this->authenticationConfigurationService->getAll((int) $tenant['id']);
        $data['seo'] = $this->buildSeoData($tenant);

        $publicConfig = $this->buildPublicConfig($config, (int) $tenant['id']);
        if (!empty($publicConfig)) {
            $data['config'] = $publicConfig;
        }

        $contact = $this->buildContactData($tenant);
        if (!empty($contact)) {
            $data['contact'] = $contact;
        }

        $social = $this->buildSocialData($tenant);
        if (!empty($social)) {
            $data['social'] = $social;
        }

        $data['settings'] = $this->buildGeneralSettings((int) $tenant['id']);

        // Tenant-level SEO overrides (set by super admin, safe for public payload)
        if (!empty($tenant['seo_organization_type'])) {
            $data['settings']['seo_organization_type'] = $tenant['seo_organization_type'];
        }

        // Add onboarding module flags to bootstrap (non-sensitive, safe for public payload)
        // filter_var handles both '1'/'0' (from OnboardingConfig) and 'true'/'false' (from EnterpriseConfig)
        $data['settings']['onboarding_enabled'] = filter_var($this->getOnboardingSetting((int) $tenant['id'], 'onboarding.enabled', '1'), FILTER_VALIDATE_BOOLEAN);
        $data['settings']['onboarding_mandatory'] = filter_var($this->getOnboardingSetting((int) $tenant['id'], 'onboarding.mandatory', '1'), FILTER_VALIDATE_BOOLEAN);

        $data['compliance'] = [
            'insurance_enabled' => $this->brokerControlConfigService->isInsuranceEnabled(),
        ];

        // Listing module configuration — expose to frontend for UI gating
        $data['listing_config'] = ListingConfigurationService::getAll();

        // Volunteering module configuration — tabs + feature options
        $data['volunteering_config'] = VolunteeringConfigurationService::getAll();

        // Jobs module configuration
        $data['job_config'] = JobConfigurationService::getAll();

        // Group tab visibility — only include tab_* keys for frontend filtering
        $groupConfig = GroupConfigurationService::getAll();
        $groupTabs = [];
        foreach ($groupConfig as $key => $value) {
            if (str_starts_with($key, 'tab_')) {
                $groupTabs[$key] = (bool) $value;
            }
        }
        $data['group_tabs'] = $groupTabs;

        $data['supported_languages'] = $config['supported_languages'] ?? ['en', 'ga', 'de', 'fr', 'it', 'pt', 'es', 'nl', 'pl', 'ja', 'ar'];
        $data['default_language'] = $config['default_language'] ?? 'en';

        $menuPages = $this->buildMenuPages((int) $tenant['id']);
        if (!empty($menuPages)) {
            $data['menu_pages'] = $menuPages;
        }

        // Landing page configuration (per-tenant customizable sections)
        $data['landing_page_config'] = $this->buildLandingPageConfig((int) $tenant['id']);

        $data['tenant_switcher'] = $this->buildTenantSwitcherData($tenant);

        return $data;
    }

    /**
     * Build the utility-bar tenant switcher payload.
     * Default source is active direct child tenants in the hierarchy.
     */
    private function buildTenantSwitcherData(array $tenant): array
    {
        $tenantId = (int) ($tenant['id'] ?? 0);
        if ($tenantId <= 0) {
            return [
                'source' => 'children',
                'items' => [],
            ];
        }

        $children = DB::table('tenants')
            ->select('id', 'name', 'slug', 'domain', 'tagline')
            ->where('parent_id', $tenantId)
            ->where('is_active', 1)
            ->orderBy('name', 'asc')
            ->get();

        $items = [];
        foreach ($children as $child) {
            $childData = (array) $child;
            $item = [
                'id' => (int) $childData['id'],
                'name' => (string) ($childData['name'] ?? ''),
                'slug' => (string) ($childData['slug'] ?? ''),
                'url' => $this->buildTenantSwitcherUrl($childData, $tenant),
            ];

            if (!empty($childData['domain'])) {
                $item['domain'] = $this->normalizeTenantDomain((string) $childData['domain']);
            }
            if (!empty($childData['tagline'])) {
                $item['tagline'] = (string) $childData['tagline'];
            }

            $items[] = $item;
        }

        return [
            'source' => 'children',
            'items' => $items,
        ];
    }

    private function buildTenantSwitcherUrl(array $child, array $parent): string
    {
        $childDomain = $this->normalizeTenantDomain((string) ($child['domain'] ?? ''));
        if ($childDomain !== '') {
            return "https://{$childDomain}";
        }

        $parentDomain = $this->normalizeTenantDomain((string) ($parent['domain'] ?? ''));
        $slug = rawurlencode((string) ($child['slug'] ?? ''));

        if ($parentDomain !== '' && $slug !== '') {
            return "https://{$parentDomain}/{$slug}";
        }

        $frontendUrl = rtrim((string) config('app.frontend_url', 'https://app.project-nexus.ie'), '/');

        return $slug !== '' ? "{$frontendUrl}/{$slug}" : $frontendUrl;
    }

    private function normalizeTenantDomain(string $domain): string
    {
        $domain = trim($domain);
        $domain = (string) preg_replace('#^https?://#i', '', $domain);

        return rtrim($domain, '/');
    }

    /**
     * Public-safe setting keys that may be exposed in the bootstrap payload.
     * Admin-only settings (maintenance_mode, admin_approval, registration_mode,
     * email_verification, max_upload_size_mb, etc.) are deliberately excluded.
     */
    private const PUBLIC_GENERAL_SETTINGS = [
        'timezone', 'default_currency', 'date_format', 'time_format',
        'items_per_page', 'welcome_credits', 'footer_text', 'welcome_message',
        'seo_google_verification', 'seo_bing_verification',
        'map_provider', 'geocoding_provider',
        'inactivity_timeout_minutes',
    ];

    private function buildGeneralSettings(int $tenantId): array
    {
        $settings = [];

        try {
            $rows = DB::table('tenant_settings')
                ->where('tenant_id', $tenantId)
                ->where('setting_key', 'LIKE', 'general.%')
                ->select('setting_key', 'setting_value')
                ->get();

            foreach ($rows as $row) {
                $key = str_replace('general.', '', $row->setting_key);

                // Only expose whitelisted public settings — never admin-only keys
                if (!in_array($key, self::PUBLIC_GENERAL_SETTINGS, true)) {
                    continue;
                }

                $value = $row->setting_value;

                if ($value === 'true' || $value === '1') {
                    $settings[$key] = true;
                } elseif ($value === 'false' || $value === '0') {
                    $settings[$key] = false;
                } else {
                    $settings[$key] = $value;
                }
            }
        } catch (\Exception $e) {
            // tenant_settings table may not exist yet
        }

        return $settings;
    }

    /**
     * Read a single onboarding setting with a default fallback.
     */
    private function getOnboardingSetting(int $tenantId, string $key, string $default): string
    {
        try {
            $row = DB::table('tenant_settings')
                ->where('tenant_id', $tenantId)
                ->where('setting_key', $key)
                ->value('setting_value');
            return $row !== null ? (string) $row : $default;
        } catch (\Throwable $e) {
            return $default;
        }
    }

    private function buildMenuPages(int $tenantId): array
    {
        $result = [];

        try {
            $rows = DB::table('pages')
                ->where('tenant_id', $tenantId)
                ->where('is_published', 1)
                ->where('show_in_menu', 1)
                ->select('title', 'slug', 'menu_location')
                ->orderBy('menu_order')
                ->orderBy('sort_order')
                ->orderBy('title')
                ->get();

            foreach ($rows as $row) {
                $location = $row->menu_location ?: 'about';
                $result[$location][] = [
                    'title' => $row->title,
                    'slug' => $row->slug,
                ];
            }
        } catch (\Exception $e) {
            // pages table may not exist yet
        }

        return $result;
    }

    /**
     * Build landing page configuration from tenant settings.
     * Returns null if no custom config — frontend uses defaults.
     */
    private function buildLandingPageConfig(int $tenantId): ?array
    {
        try {
            $row = DB::table('tenant_settings')
                ->where('tenant_id', $tenantId)
                ->where('setting_key', 'landing_page.config')
                ->value('setting_value');

            if (empty($row)) {
                return null;
            }

            $config = json_decode($row, true);
            if (!is_array($config)) {
                return null;
            }

            return $this->mergeMissingDefaultSections($config);
        } catch (\Throwable $e) {
            return null;
        }
    }

    /**
     * Append any default sections that the saved config lacks. The admin UI
     * does not allow deleting sections — only enable/disable — so a section ID
     * missing from a saved config means the tenant saved their config before
     * that section type existed. Rolling out new sections then reaches every
     * tenant without overwriting their existing customisations.
     */
    private function mergeMissingDefaultSections(array $config): array
    {
        if (!isset($config['sections']) || !is_array($config['sections'])) {
            return $config;
        }

        $existingIds = [];
        $maxOrder = -1;
        foreach ($config['sections'] as $s) {
            if (isset($s['id'])) {
                $existingIds[] = $s['id'];
            }
            if (isset($s['order']) && is_numeric($s['order']) && (int) $s['order'] > $maxOrder) {
                $maxOrder = (int) $s['order'];
            }
        }

        $defaultIds = ['hero', 'audience_cards', 'feature_pills', 'stats', 'how_it_works', 'core_values', 'cta'];
        foreach ($defaultIds as $defId) {
            if (!in_array($defId, $existingIds, true)) {
                $maxOrder++;
                $config['sections'][] = [
                    'id' => $defId,
                    'type' => $defId,
                    'enabled' => true,
                    'order' => $maxOrder,
                ];
            }
        }

        return $config;
    }

    private function buildBrandingData(array $tenant, ?array $config): array
    {
        $branding = [
            'name' => $tenant['name'] ?? '',
        ];

        if (!empty($tenant['tagline'])) {
            $branding['tagline'] = $tenant['tagline'];
        }

        // Header logo variants are rendered as <img> in the SPA, which resolves
        // relative /uploads paths to the API origin via resolveAssetUrl(). Keep
        // them relative (NOT tenant-domain absolute, unlike og_image) so they
        // load in local dev too — an absolute tenant domain points at production,
        // which doesn't have a freshly-uploaded local file.
        if (!empty($tenant['logo_url'])) {
            $branding['logo_url'] = $tenant['logo_url'];
        } elseif (!empty($config['logo_url'])) {
            $branding['logo_url'] = $config['logo_url'];
        }

        // Optional dark-theme header logo variant (tenant-uploaded).
        if (!empty($config['logo_dark_url'])) {
            $branding['logo_dark_url'] = $config['logo_dark_url'];
        }

        // Aspect-ratio bucket so the SPA can size the header logo (and grow the
        // navbar for square/stacked logos) without an async measure + layout shift.
        $shapeSource = $branding['logo_url'] ?? ($config['logo_dark_url'] ?? null);
        if (!empty($shapeSource)) {
            $branding['logo_shape'] = \App\Support\LogoShape::classify($shapeSource);
        }

        // Per-variant brightness so the SPA can add a contrast backdrop where a
        // logo would otherwise wash out (e.g. a white logo on the light navbar).
        if (!empty($branding['logo_url'])) {
            $tone = \App\Support\LogoShape::tone($branding['logo_url']);
            if ($tone !== null) {
                $branding['logo_tone'] = $tone;
            }
        }
        if (!empty($branding['logo_dark_url'])) {
            $tone = \App\Support\LogoShape::tone($branding['logo_dark_url']);
            if ($tone !== null) {
                $branding['logo_dark_tone'] = $tone;
            }
        }

        if (!empty($tenant['favicon_url'])) {
            $branding['favicon_url'] = UrlHelper::absolute($tenant['favicon_url']);
        } elseif (!empty($config['favicon_url'])) {
            $branding['favicon_url'] = UrlHelper::absolute($config['favicon_url']);
        }

        if (!empty($tenant['primary_color'])) {
            $branding['primary_color'] = $tenant['primary_color'];
        } elseif (!empty($config['primary_color'])) {
            $branding['primary_color'] = $config['primary_color'];
        }

        if (!empty($tenant['og_image_url'])) {
            $branding['og_image_url'] = UrlHelper::absolute($tenant['og_image_url']);
        }

        // Fall back to the seo_og_image_url tenant setting if no column value
        if (empty($branding['og_image_url'])) {
            try {
                $seoOg = DB::table('tenant_settings')
                    ->where('tenant_id', $tenant['id'])
                    ->where('setting_key', 'seo_og_image_url')
                    ->value('setting_value');
                if (!empty($seoOg)) {
                    $branding['og_image_url'] = UrlHelper::absolute($seoOg);
                }
            } catch (\Throwable) {
                // tenant_settings table may not exist
            }
        }

        return $branding;
    }

    private function buildFeaturesData(?array $features): array
    {
        return $this->tenantFeatureConfig->mergeFeatures($features);
    }

    private function buildModulesData(?array $config): array
    {
        $modules = null;
        if ($config !== null && isset($config['modules']) && is_array($config['modules'])) {
            $modules = $config['modules'];
        }

        return $this->tenantFeatureConfig->mergeModules($modules);
    }

    private function buildSeoData(array $tenant): array
    {
        $seo = [];

        if (!empty($tenant['meta_title'])) {
            $seo['meta_title'] = $tenant['meta_title'];
        } elseif (!empty($tenant['name'])) {
            $seo['meta_title'] = $tenant['name'];
        }

        if (!empty($tenant['meta_description'])) {
            $seo['meta_description'] = $tenant['meta_description'];
        }

        if (!empty($tenant['h1_headline'])) {
            $seo['h1_headline'] = $tenant['h1_headline'];
        }

        if (!empty($tenant['hero_intro'])) {
            $seo['hero_intro'] = $tenant['hero_intro'];
        }

        // robots_directive controls the <meta name="robots"> tag in SeoHead.
        // Only forward when explicitly set to a non-default value.
        $robotsDirective = $tenant['robots_directive'] ?? '';
        if (!empty($robotsDirective) && $robotsDirective !== 'index, follow') {
            $seo['robots_directive'] = $robotsDirective;
        }

        return $seo;
    }

    private function buildPublicConfig(?array $config, int $tenantId = 0): array
    {
        $publicConfig = [];

        $footerText = '';
        if ($tenantId > 0) {
            try {
                $row = DB::table('tenant_settings')
                    ->where('tenant_id', $tenantId)
                    ->where('setting_key', 'general.footer_text')
                    ->select('setting_value')
                    ->first();

                if ($row && !empty($row->setting_value)) {
                    $footerText = $row->setting_value;
                }
            } catch (\Exception $e) {
                // tenant_settings table may not exist yet
            }
        }

        if (empty($footerText) && $config !== null && !empty($config['footer_text'])) {
            $footerText = $config['footer_text'];
        }
        if (!empty($footerText)) {
            $publicConfig['footer_text'] = $footerText;
        }

        // Partner logo + powered-by settings (shown in footer)
        if ($tenantId > 0) {
            try {
                $footerSettingKeys = [
                    'general.partner_logo_url',
                    'general.partner_logo_label',
                    'general.partner_logo_link_url',
                    'general.powered_by_label',
                    'general.powered_by_image_light',
                    'general.powered_by_image_dark',
                    'general.powered_by_url',
                ];
                $rows = DB::table('tenant_settings')
                    ->where('tenant_id', $tenantId)
                    ->whereIn('setting_key', $footerSettingKeys)
                    ->select('setting_key', 'setting_value')
                    ->get();
                foreach ($rows as $row) {
                    if (!empty($row->setting_value)) {
                        $shortKey = str_replace('general.', '', $row->setting_key);
                        $publicConfig[$shortKey] = $row->setting_value;
                    }
                }
            } catch (\Exception $e) {
                // table may not exist yet
            }
        }

        if ($config === null) {
            return $publicConfig;
        }

        if (!empty($config['modules']) && is_array($config['modules'])) {
            $publicConfig['modules'] = $config['modules'];
        }

        if (!empty($config['time_unit'])) {
            $publicConfig['time_unit'] = $config['time_unit'];
        }

        if (!empty($config['time_unit_plural'])) {
            $publicConfig['time_unit_plural'] = $config['time_unit_plural'];
        }

        return $publicConfig;
    }

    private function buildContactData(array $tenant): array
    {
        $contact = [];

        if (!empty($tenant['contact_email'])) {
            $contact['email'] = $tenant['contact_email'];
        }
        if (!empty($tenant['contact_phone'])) {
            $contact['phone'] = $tenant['contact_phone'];
        }
        if (!empty($tenant['address'])) {
            $contact['address'] = $tenant['address'];
        }
        if (!empty($tenant['location_name'])) {
            $contact['location'] = $tenant['location_name'];
        }
        // ISO-3166 country code — needed by SeoHead JSON-LD addressCountry and geo meta tags.
        if (!empty($tenant['country_code'])) {
            $contact['country_code'] = $tenant['country_code'];
        }
        if (!empty($tenant['latitude'])) {
            $contact['latitude'] = (float) $tenant['latitude'];
        }
        if (!empty($tenant['longitude'])) {
            $contact['longitude'] = (float) $tenant['longitude'];
        }
        if (!empty($tenant['service_area'])) {
            $contact['service_area'] = $tenant['service_area'];
        }

        return $contact;
    }

    private function buildSocialData(array $tenant): array
    {
        $social = [];

        $socialFields = [
            'social_facebook' => 'facebook',
            'social_twitter' => 'twitter',
            'social_instagram' => 'instagram',
            'social_linkedin' => 'linkedin',
            'social_youtube' => 'youtube',
        ];

        foreach ($socialFields as $field => $key) {
            if (!empty($tenant[$field])) {
                $social[$key] = $tenant[$field];
            }
        }

        return $social;
    }

    /**
     * Safely parse JSON, returning null on failure.
     */
    private function parseJson($value): ?array
    {
        if ($value === null || $value === '') {
            return null;
        }

        if (is_array($value)) {
            return $value;
        }

        if (is_string($value)) {
            $decoded = json_decode($value, true);
            return is_array($decoded) ? $decoded : null;
        }

        return null;
    }
}
