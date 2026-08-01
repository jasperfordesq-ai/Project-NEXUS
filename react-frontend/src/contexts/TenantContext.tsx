// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * NEXUS Tenant Context
 *
 * Provides:
 * - Tenant bootstrap data
 * - Feature flags
 * - Tenant branding
 * - Module configuration
 * - Automatic tenant detection from URL (subdomain or path slug)
 * - Tenant slug for URL-scoped navigation
 *
 * Implements TRS-001 resolution rules R1-R4.
 * @see docs/TRS-001-TENANT-RESOLUTION-SPEC.md
 */

import {
  createContext,
  use,
  useState,
  useEffect,
  useMemo,
  useCallback,
  type ReactNode,
} from 'react';
import i18n from '@/i18n';
import { api, tokenManager, fetchCsrfToken } from '@/lib/api';
import { detectTenantFromUrl, tenantPath as buildTenantPath } from '@/lib/tenant-routing';
import { validateResponseIfPresent } from '@/lib/api-validation';
import { tenantBootstrapSchema } from '@/lib/api-schemas';
import { queueSentryTenant } from '@/lib/telemetryQueue';
import { DEFAULT_LANDING_PAGE_CONFIG } from '@/types';
import type { TenantConfig, TenantFeatures, TenantModules, TenantBranding, GroupTabConfig, ListingConfig, VolunteeringConfig, JobConfig, LandingPageConfig, AuthenticationConfig } from '@/types';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface TenantState {
  tenant: TenantConfig | null;
  isLoading: boolean;
  error: string | null;
  /** Slug that was NOT found (bootstrap returned error). Used for soft 404. */
  notFoundSlug: string | null;
}

interface TenantContextValue extends TenantState {
  features: TenantFeatures;
  modules: TenantModules;
  branding: TenantBranding;
  groupTabs: GroupTabConfig;
  listingConfig: ListingConfig;
  volunteeringConfig: VolunteeringConfig;
  jobConfig: JobConfig;
  landingPageConfig: LandingPageConfig;
  authenticationConfig: AuthenticationConfig;
  hasFeature: (feature: keyof TenantFeatures) => boolean;
  hasModule: (module: keyof TenantModules) => boolean;
  hasGroupTab: (tab: keyof GroupTabConfig) => boolean;
  refreshTenant: () => Promise<void>;
  /** The current tenant slug from URL (path or subdomain). Null if no slug in URL. */
  tenantSlug: string | null;
  /** Build a path with the tenant slug prefix (if present). */
  tenantPath: (path: string) => string;
  /** Language codes supported by this tenant (e.g. ['en', 'ga'] or ['de', 'fr', 'it', 'en']) */
  supportedLanguages: string[];
  /** Default language for this tenant (e.g. 'de' for Swiss tenants) */
  defaultLanguage: string;
  /** Tenant-selected map display provider. Default: 'google'. */
  mapProvider: MapProvider;
  /** Tenant-selected location autocomplete / geocoding provider. Default: 'google'. */
  geocodingProvider: GeocodingProvider;
}

export type MapProvider = 'google' | 'openstreetmap' | 'ordnance_survey';
export type GeocodingProvider = 'google' | 'nominatim' | 'os_places';

const ALLOWED_MAP_PROVIDERS: readonly MapProvider[] = ['google', 'openstreetmap', 'ordnance_survey'];
const ALLOWED_GEOCODING_PROVIDERS: readonly GeocodingProvider[] = ['google', 'nominatim', 'os_places'];

function setTelemetryTenant(tenant: { id: number; name: string; slug: string } | null): void {
  queueSentryTenant(tenant);
}

// Default features — synced with PHP TenantFeatureConfig::FEATURE_DEFAULTS
const defaultFeatures: TenantFeatures = {
  events: true,
  groups: true,
  gamification: true,
  goals: true,
  blog: true,
  resources: true,
  caring_community: false,
  volunteering: true,
  exchange_workflow: true,
  organisations: true,
  federation: true,
  connections: true,
  reviews: true,
  polls: true,
  job_vacancies: true,
  ideation_challenges: true,
  direct_messaging: true,
  group_exchanges: true,
  search: true,
  ai_chat: true,
  marketplace: false,
  message_translation: true,
  member_premium: false,
  // Identity verification (Stripe Identity "ID Verified" badge). Default ON so the
  // "Verify Identity" affordance keeps showing; admins can disable it per tenant.
  identity_verification: true,
  partner_api: false,
  ai_agents: false,
  fadp_compliance: false,
  local_advertising: false,
  newsletter: true,
  merchant_coupons: false,
  regional_analytics: false,
  // Maps default OFF platform-wide (opt-in per tenant) — synced with PHP
  // TenantFeatureConfig::FEATURE_DEFAULTS. A tenant only shows maps when its
  // bootstrap features explicitly enable it, so no tenant differs by accident.
  maps: false,
  // Courses (alpha) — opt-in per tenant. Synced with PHP TenantFeatureConfig.
  courses: false,
  podcasts: false,
  // Explore / Discover curated discovery page. Default ON — synced with PHP
  // TenantFeatureConfig::FEATURE_DEFAULTS. Admins can disable it per tenant.
  explore: true,
  // Partner venues — opt-in per tenant. Synced with PHP TenantFeatureConfig.
  partner_venues: false,
  // Security feature switches govern new enrollment only. Existing TOTP
  // challenges and passkey sign-in remain available to prevent lockouts.
  two_factor_authentication: true,
  biometric_login: true,
};

// Default modules (all enabled)
const defaultModules: TenantModules = {
  feed: true,
  listings: true,
  messages: true,
  wallet: true,
  notifications: true,
  profile: true,
  settings: true,
  dashboard: true,
};

const defaultAuthenticationConfig: AuthenticationConfig = {
  'two_factor.allow_trusted_devices': true,
  'two_factor.trusted_device_days': 30,
  'two_factor.backup_code_count': 10,
  'passkeys.conditional_autofill': true,
};

// Default group tab visibility — all enabled
const defaultGroupTabs: GroupTabConfig = {
  tab_feed: true,
  tab_discussion: true,
  tab_members: true,
  tab_events: true,
  tab_files: true,
  tab_announcements: true,
  tab_qa: true,
  tab_wiki: true,
  tab_media: true,
  tab_chatrooms: true,
  tab_tasks: true,
  tab_challenges: true,
  tab_analytics: true,
  tab_subgroups: true,
};

// Default listing config — all features enabled, sensible limits
const defaultListingConfig: ListingConfig = {
  'listing.moderation_enabled': false,
  'listing.auto_approve_trusted': false,
  'listing.max_per_user': 50,
  'listing.max_images': 5,
  'listing.max_image_size_mb': 8,
  'listing.require_image': false,
  'listing.min_title_length': 5,
  'listing.min_description_length': 20,
  'listing.allow_offers': true,
  'listing.allow_requests': true,
  'listing.require_category': true,
  'listing.require_location': false,
  'listing.require_hours_estimate': false,
  'listing.enable_skill_tags': true,
  'listing.enable_service_type': true,
  'listing.auto_expire_days': 0,
  'listing.max_renewals': 12,
  'listing.renewal_days': 30,
  'listing.expiry_reminders': true,
  'listing.enable_featured': true,
  'listing.featured_duration_days': 7,
  'listing.enable_ai_descriptions': true,
  'listing.enable_reporting': true,
  'listing.enable_favourites': true,
  'listing.enable_map_view': true,
  'listing.enable_reciprocity': true,
};

// Default volunteering config — all tabs enabled, sensible defaults
const defaultVolunteeringConfig: VolunteeringConfig = {
  'volunteering.tab_opportunities': true,
  'volunteering.tab_applications': true,
  'volunteering.tab_hours': true,
  'volunteering.tab_recommended': true,
  'volunteering.tab_certificates': true,
  'volunteering.tab_alerts': true,
  'volunteering.tab_wellbeing': true,
  'volunteering.tab_credentials': true,
  'volunteering.tab_waitlist': true,
  'volunteering.tab_swaps': true,
  'volunteering.tab_group_signups': true,
  'volunteering.tab_hours_review': true,
  'volunteering.tab_expenses': true,
  'volunteering.tab_safeguarding': true,
  'volunteering.tab_community_projects': true,
  'volunteering.tab_donations': true,
  'volunteering.tab_accessibility': true,
  'volunteering.swap_requires_admin': false,
  'volunteering.auto_approve_applications': false,
  'volunteering.require_org_note_on_decline': false,
  'volunteering.cancellation_deadline_hours': 24,
  'volunteering.max_hours_per_shift': 8,
  'volunteering.hours_require_verification': true,
  'volunteering.min_hours_for_certificate': 1,
  'volunteering.alert_default_expiry_hours': 24,
  'volunteering.alert_skill_matching': true,
  'volunteering.expenses_enabled': true,
  'volunteering.expense_require_receipt': false,
  'volunteering.expense_max_amount': 500,
  'volunteering.burnout_detection': true,
  'volunteering.guardian_consent_required': false,
  'volunteering.enable_qr_checkin': true,
  'volunteering.enable_recurring_shifts': true,
  'volunteering.enable_reviews': true,
  'volunteering.enable_matching': true,
};

// Default job config
const defaultJobConfig: JobConfig = {
  'jobs.tab_browse': true,
  'jobs.tab_saved': true,
  'jobs.tab_my_postings': true,
  'jobs.page_kanban': true,
  'jobs.page_analytics': true,
  'jobs.page_bias_audit': true,
  'jobs.page_talent_search': true,
  'jobs.page_alerts': true,
  'jobs.allow_paid': true,
  'jobs.allow_volunteer': true,
  'jobs.allow_timebank': true,
  'jobs.require_salary': false,
  'jobs.default_currency': 'EUR',
  'jobs.max_postings_per_user': 20,
  'jobs.default_deadline_days': 30,
  'jobs.moderation_enabled': false,
  'jobs.spam_detection': true,
  'jobs.auto_approve_trusted': false,
  'jobs.enable_cv_upload': true,
  'jobs.require_cover_message': false,
  'jobs.enable_interview_scheduling': true,
  'jobs.enable_offers': true,
  'jobs.enable_scorecards': true,
  'jobs.enable_pipeline_rules': true,
  'jobs.enable_blind_hiring': false,
  'jobs.enable_featured': true,
  'jobs.featured_duration_days': 7,
  'jobs.enable_ai_descriptions': true,
  'jobs.enable_skills_matching': true,
  'jobs.enable_referrals': true,
  'jobs.enable_templates': true,
  'jobs.enable_rss_feed': true,
  'jobs.enable_saved_profiles': true,
  'jobs.enable_employer_branding': true,
};

// Default branding
const defaultBranding: TenantBranding = {
  name: 'NEXUS',
  tagline: 'Time Banking Platform',
  logo: undefined,
  favicon: undefined,
  primaryColor: '#6366f1',
  secondaryColor: '#a855f7',
};

// ─────────────────────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────────────────────

const TenantContext = createContext<TenantContextValue | null>(null);

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

interface TenantProviderProps {
  children: ReactNode;
  /** Tenant slug from route param (/:tenantSlug prefix). Takes priority over URL detection. */
  tenantSlug?: string;
}

export function TenantProvider({ children, tenantSlug }: TenantProviderProps) {
  const [state, setState] = useState<TenantState>({
    tenant: null,
    isLoading: true,
    error: null,
    notFoundSlug: null,
  });

  // Determine effective slug: route param (from TenantShell) > URL detection.
  //
  // We deliberately do NOT fall back to a stored slug from localStorage. Doing so
  // caused a persistent cross-tenant bug: a user who had previously logged into
  // tenant X would visit the platform root (app.project-nexus.ie/), and the SPA
  // would silently boot into tenant X instead of master. The login page then
  // treated the tenant as "resolved from URL" and hid the community chooser, so
  // the user authenticated against whichever community happened to be cached in
  // localStorage — not the one they intended. This matches the 2026-05-08 policy
  // already documented in TenantShell.tsx: URL is respected as typed; master
  // tenant renders at /, and tenant-scoped pages require the slug in the URL.
  //
  // NOTE: detectTenantFromUrl() is called on every render (no useMemo) so that
  // navigation to a different tenant path is immediately reflected. The function
  // reads window.location which changes on each route transition. This is
  // intentionally not memoized — detectTenantFromUrl() is a fast synchronous read.
  const detected = detectTenantFromUrl();
  const effectiveTenantSlug = tenantSlug || detected.slug;

  // Path-based routing: needed on shared hosts (localhost, app.project-nexus.ie) where
  // multiple tenants share the same domain and the URL path prefix is the only way to
  // identify the tenant. On custom domains (hour-timebank.ie) or tenant subdomains
  // (hour-timebank.project-nexus.ie), the domain IS the identifier — no path prefix.
  //
  // CRITICAL: This must NOT depend on detected.source, because after a redirect strips
  // the slug from the URL and the user refreshes, detected.source becomes null — causing
  // tenantPath() to stop prepending the slug permanently. Instead, derive from hostname.
  const isSharedHost = useMemo(() => {
    const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === 'app.project-nexus.ie';
  }, []);

  // A slug-only sub-tenant accessed via its parent's custom domain also needs path-based
  // slug routing even though the hostname is not a shared platform domain.
  // e.g. timebanking.uk/cardiff → the bootstrap returns parent_domain: 'timebanking.uk'
  // and the slug prefix '/cardiff' must still be prepended to all internal links.
  const isParentDomainSubTenant = !!state.tenant?.parent_domain;

  const usePathBasedSlug = (isSharedHost && !!effectiveTenantSlug) || isParentDomainSubTenant;

  /**
   * Fetch tenant bootstrap data
   */
  const loadTenant = useCallback(async (forceFresh: boolean) => {
    setState((prev) => ({ ...prev, isLoading: true, error: null, notFoundSlug: null }));

    try {
      // Build endpoint with optional tenant slug
      // Per TRS-001: NO ?domain= parameter. Slug only.
      let endpoint = '/v2/tenant/bootstrap';
      if (effectiveTenantSlug) {
        endpoint += `?slug=${encodeURIComponent(effectiveTenantSlug)}`;
      }

      const response = await api.get<TenantConfig>(endpoint, {
        skipAuth: true,
        skipTenant: true,
        ...(forceFresh ? { cacheTtlMs: 0 } : {}),
      });

      if (response.success && response.data) {
        const tenant = response.data;

        // Dev-only: validate tenant bootstrap response shape
        validateResponseIfPresent(tenantBootstrapSchema, tenant, `GET ${endpoint}`);

        // TRS-001: Stale localStorage override
        // If URL resolved a tenant and it differs from stored value, override.
        //
        // GUARD: Only write to localStorage when the bootstrap response matches
        // the slug we requested (or no slug was requested). This prevents a
        // cross-tenant localStorage poisoning scenario where an unexpected
        // bootstrap response overwrites the stored slug, causing TenantShell's
        // slug recovery to redirect to the wrong tenant on the next visit.
        const responseMatchesRequest = !effectiveTenantSlug
          || (tenant.slug && tenant.slug === effectiveTenantSlug);

        const storedTenantId = tokenManager.getTenantId();
        if (tenant.id && responseMatchesRequest) {
          if (storedTenantId && String(storedTenantId) !== String(tenant.id)) {
            console.warn(
              `[TenantContext] Overriding stale localStorage tenant_id. ` +
              `Stored: ${storedTenantId}, URL-resolved: ${tenant.id}`
            );
            // Tokens are tenant-bound server-side; a tenant switch needs a fresh login.
            tokenManager.clearTokens();
            api.clearInflightRequests();
          }
          tokenManager.setTenantId(tenant.id);
        }
        if (tenant.slug && responseMatchesRequest) {
          tokenManager.setTenantSlug(tenant.slug);
        } else if (tenant.slug && !responseMatchesRequest) {
          console.warn(
            `[TenantContext] Bootstrap response slug "${tenant.slug}" does not match ` +
            `requested slug "${effectiveTenantSlug}" — NOT updating localStorage`
          );
        }

        // Fetch CSRF token for form submissions
        await fetchCsrfToken();

        // Set Sentry tenant context
        if (tenant.id && tenant.name && tenant.slug) {
          setTelemetryTenant({
            id: tenant.id,
            name: tenant.name,
            slug: tenant.slug,
          });
        }

        setState({
          tenant,
          isLoading: false,
          error: null,
          notFoundSlug: null,
        });
      } else if (response.code === 'MAINTENANCE_MODE') {
        // API is in maintenance mode — synthesise a tenant that triggers MaintenancePage
        setTelemetryTenant(null);
        setState({
          tenant: { settings: { maintenance_mode: true } } as unknown as TenantConfig,
          isLoading: false,
          error: null,
          notFoundSlug: null,
        });
      } else if (response.code === 'TENANT_NOT_FOUND' && effectiveTenantSlug) {
        // Only the backend's explicit tenant lookup 404 may produce the soft-404 UI.
        setTelemetryTenant(null);
        setState({
          tenant: null,
          isLoading: false,
          error: response.code ?? 'TENANT_NOT_FOUND',
          notFoundSlug: effectiveTenantSlug,
        });
      } else {
        // Network, timeout, 5xx, and unknown failures are retryable. Preserve a
        // previously loaded tenant only when it is demonstrably the same tenant.
        setTelemetryTenant(null);
        setState((prev) => ({
          tenant: prev.tenant && (
            !effectiveTenantSlug || prev.tenant.slug === effectiveTenantSlug
          ) ? prev.tenant : null,
          isLoading: false,
          error: response.code ?? 'TENANT_BOOTSTRAP_FAILED',
          notFoundSlug: null,
        }));
      }
    } catch {
      setTelemetryTenant(null);
      setState((prev) => ({
        tenant: prev.tenant && (
          !effectiveTenantSlug || prev.tenant.slug === effectiveTenantSlug
        ) ? prev.tenant : null,
        isLoading: false,
        error: 'TENANT_BOOTSTRAP_FAILED', // admin-i18n-ignore: stable control-flow error code, localized by the consuming screen
        notFoundSlug: null,
        }));
    }
  }, [effectiveTenantSlug]);

  const refreshTenant = useCallback(
    () => loadTenant(true),
    [loadTenant],
  );

  // Fetch tenant on mount or when slug changes
  useEffect(() => {
    void loadTenant(false);
  }, [loadTenant]);

  /**
   * Get features with fallback to defaults
   */
  const features = useMemo<TenantFeatures>(() => {
    if (!state.tenant?.features) {
      return defaultFeatures;
    }
    return { ...defaultFeatures, ...state.tenant.features };
  }, [state.tenant?.features]);

  /**
   * Get modules with fallback to defaults
   */
  const modules = useMemo<TenantModules>(() => {
    if (!state.tenant?.modules) {
      return defaultModules;
    }
    return { ...defaultModules, ...state.tenant.modules };
  }, [state.tenant?.modules]);

  /**
   * Get branding with fallback to defaults.
   * Normalises backend snake_case fields (logo_url, favicon_url, primary_color)
   * to the camelCase aliases expected by components (logo, favicon, primaryColor).
   * Also pulls name/tagline from the top-level tenant response since the backend
   * returns them there rather than inside the branding sub-object.
   */
  const branding = useMemo<TenantBranding>(() => {
    const raw = state.tenant?.branding ?? {};
    const logo = raw.logo ?? raw.logo_url ?? undefined;
    const logoDark = raw.logoDark ?? raw.logo_dark_url ?? undefined;
    const logoShape = (raw.logoShape ?? raw.logo_shape ?? undefined) as TenantBranding['logoShape'];
    const logoTone = (raw.logoTone ?? raw.logo_tone ?? undefined) as TenantBranding['logoTone'];
    const logoDarkTone = (raw.logoDarkTone ?? raw.logo_dark_tone ?? undefined) as TenantBranding['logoDarkTone'];
    const favicon = raw.favicon ?? raw.favicon_url ?? undefined;
    const primaryColor = raw.primaryColor ?? raw.primary_color ?? defaultBranding.primaryColor;
    return {
      ...defaultBranding,
      ...raw,
      // Top-level tenant fields take precedence for name/tagline
      name: state.tenant?.name ?? raw.name ?? defaultBranding.name,
      tagline: state.tenant?.tagline ?? raw.tagline ?? defaultBranding.tagline,
      logo,
      logoDark,
      logoShape,
      logoTone,
      logoDarkTone,
      favicon,
      primaryColor,
    };
  }, [state.tenant]);

  /**
   * Get listing config with fallback to defaults
   */
  const listingConfig = useMemo<ListingConfig>(() => {
    if (!state.tenant?.listing_config) {
      return defaultListingConfig;
    }
    return { ...defaultListingConfig, ...state.tenant.listing_config };
  }, [state.tenant?.listing_config]);

  /**
   * Get job config with fallback to defaults
   */
  const jobConfig = useMemo<JobConfig>(() => {
    if (!state.tenant?.job_config) {
      return defaultJobConfig;
    }
    return { ...defaultJobConfig, ...state.tenant.job_config };
  }, [state.tenant?.job_config]);

  /**
   * Get volunteering config with fallback to defaults
   */
  const volunteeringConfig = useMemo<VolunteeringConfig>(() => {
    if (!state.tenant?.volunteering_config) {
      return defaultVolunteeringConfig;
    }
    return { ...defaultVolunteeringConfig, ...state.tenant.volunteering_config };
  }, [state.tenant?.volunteering_config]);

  /**
   * Get landing page config with fallback to defaults (all sections enabled, default order)
   */
  const landingPageConfig = useMemo<LandingPageConfig>(() => {
    if (!state.tenant?.landing_page_config) {
      return DEFAULT_LANDING_PAGE_CONFIG;
    }
    return state.tenant.landing_page_config;
  }, [state.tenant?.landing_page_config]);

  const authenticationConfig = useMemo<AuthenticationConfig>(() => ({
    ...defaultAuthenticationConfig,
    ...state.tenant?.authentication_config,
  }), [state.tenant?.authentication_config]);

  /**
   * Get group tab config with fallback to defaults (all enabled)
   */
  const groupTabs = useMemo<GroupTabConfig>(() => {
    if (!state.tenant?.group_tabs) {
      return defaultGroupTabs;
    }
    return { ...defaultGroupTabs, ...state.tenant.group_tabs };
  }, [state.tenant?.group_tabs]);

  /**
   * Check if feature is enabled
   */
  const hasFeature = useCallback((feature: keyof TenantFeatures): boolean => {
    return features[feature] ?? false;
  }, [features]);

  /**
   * Check if module is enabled
   */
  const hasModule = useCallback((module: keyof TenantModules): boolean => {
    return modules[module] ?? false;
  }, [modules]);

  /**
   * Check if a group tab is enabled
   */
  const hasGroupTab = useCallback((tab: keyof GroupTabConfig): boolean => {
    return groupTabs[tab] ?? true;
  }, [groupTabs]);

  /**
   * Build a path with the current tenant slug prefix.
   * Preserves the slug in all internal navigation.
   *
   * On shared platform domains (app.project-nexus.ie / localhost), the slug comes from
   * the URL. On parent-domain sub-tenants (timebanking.uk/cardiff), effectiveTenantSlug
   * is null (the URL slug isn't detected from a custom domain) so we fall back to the
   * slug returned by the bootstrap API.
   */
  const tenantPath = useCallback((path: string): string => {
    if (!usePathBasedSlug) {
      return path.startsWith('/') ? path : '/' + path;
    }
    const slug = effectiveTenantSlug || state.tenant?.slug || null;
    return buildTenantPath(path, slug);
  }, [effectiveTenantSlug, usePathBasedSlug, state.tenant?.slug]);

  const supportedLanguages = useMemo<string[]>(
    () => state.tenant?.supported_languages ?? ['en', 'ga', 'de', 'fr', 'it', 'pt', 'es', 'nl', 'pl', 'ja', 'ar'],
    [state.tenant]
  );

  const defaultLanguage = useMemo<string>(
    () => state.tenant?.default_language ?? 'en',
    [state.tenant]
  );

  const mapProvider = useMemo<MapProvider>(() => {
    const raw = state.tenant?.settings?.map_provider;
    return typeof raw === 'string' && ALLOWED_MAP_PROVIDERS.includes(raw as MapProvider)
      ? (raw as MapProvider)
      : 'google';
  }, [state.tenant]);

  const geocodingProvider = useMemo<GeocodingProvider>(() => {
    const raw = state.tenant?.settings?.geocoding_provider;
    return typeof raw === 'string' && ALLOWED_GEOCODING_PROVIDERS.includes(raw as GeocodingProvider)
      ? (raw as GeocodingProvider)
      : 'google';
  }, [state.tenant]);

  // After tenant data loads, apply tenant default language if user hasn't
  // explicitly chosen one via the language switcher.
  // Note: We check 'nexus_language_user_chosen' (set by LanguageSwitcher), NOT
  // 'nexus_language' (auto-written by i18next's caches:['localStorage'] on init).
  // Without this distinction, the browser-detected language gets auto-cached and
  // the tenant default would never apply.
  useEffect(() => {
    if (!state.tenant) return;

    const tenantDefault = state.tenant.default_language ?? 'en';
    const userExplicitlyChose = localStorage.getItem('nexus_language_user_chosen');

    if (!userExplicitlyChose && i18n.language !== tenantDefault) {
      i18n.changeLanguage(tenantDefault);
    }
  }, [state.tenant]);

  // NOTE: This useMemo has many dependencies. If adding new context values,
  // ensure they are added to the dependency array below. Consider splitting
  // this into smaller memoized objects if the dependency list grows further.
  const value = useMemo<TenantContextValue>(
    () => ({
      ...state,
      features,
      modules,
      branding,
      groupTabs,
      listingConfig,
      volunteeringConfig,
      jobConfig,
      landingPageConfig,
      authenticationConfig,
      hasFeature,
      hasModule,
      hasGroupTab,
      refreshTenant,
      // Only expose slug when path-based routing is active (slug appears in URL path).
      // On plain custom domains (no parent-domain sub-tenant), domain identifies tenant → null.
      // On parent-domain sub-tenants (timebanking.uk/cardiff), fall back to bootstrap slug.
      tenantSlug: usePathBasedSlug
        ? (effectiveTenantSlug || state.tenant?.slug || null)
        : null,
      tenantPath,
      supportedLanguages,
      defaultLanguage,
      mapProvider,
      geocodingProvider,
    }),
    [state, features, modules, branding, groupTabs, listingConfig, volunteeringConfig, jobConfig, landingPageConfig, authenticationConfig, hasFeature, hasModule, hasGroupTab, refreshTenant, effectiveTenantSlug, usePathBasedSlug, tenantPath, supportedLanguages, defaultLanguage, mapProvider, geocodingProvider]
  );

  return (
    <TenantContext.Provider value={value}>{children}</TenantContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Hooks
// ─────────────────────────────────────────────────────────────────────────────

export function useTenant(): TenantContextValue {
  const context = use(TenantContext);

  if (!context) {
    throw new Error('useTenant must be used within a TenantProvider');
  }

  return context;
}

/**
 * Convenience hook for feature checking
 */
export function useFeature(feature: keyof TenantFeatures): boolean {
  const { hasFeature } = useTenant();
  return hasFeature(feature);
}

/**
 * Convenience hook for module checking
 */
export function useModule(module: keyof TenantModules): boolean {
  const { hasModule } = useTenant();
  return hasModule(module);
}

/**
 * Convenience hook for tenant-supported languages
 */
export function useTenantLanguages(): string[] {
  return useTenant().supportedLanguages;
}

/**
 * Convenience hook for tenant default language
 */
export function useTenantDefaultLanguage(): string {
  return useTenant().defaultLanguage;
}

export default TenantContext;
