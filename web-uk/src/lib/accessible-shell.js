// Copyright © 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Shared accessible shell contract for apps/web-uk.
 *
 * Laravel's Blade accessible frontend is the current visual/workflow source of
 * truth. This module keeps the Nunjucks shell data in one place while the app is
 * prepared to become the future shared accessible frontend candidate.
 */

const serviceName = 'Project NEXUS Accessible';
const phaseText = 'Beta';
const feedbackUrl = 'mailto:feedback@project-nexus.ie?subject=NEXUS%20Beta%20feedback';
const sourceCodeUrl = 'https://github.com/jasperfordesq-ai/Project-NEXUS';
const { URL } = require('node:url');
const { getPublicAssetBaseUrl } = require('./backend-contract');
const { createTranslator, isSupportedLocale } = require('./localization');

const localeOptions = [
  ['en', 'English'],
  ['ga', 'Gaeilge'],
  ['de', 'Deutsch'],
  ['fr', 'Français'],
  ['it', 'Italiano'],
  ['pt', 'Português'],
  ['es', 'Español'],
  ['nl', 'Nederlands'],
  ['pl', 'Polski'],
  ['ja', '日本語'],
  ['ar', 'العربية']
];

// 🔴 The header's "Not affiliated with GOV.UK" disclosure was REMOVED on the
// owner's decision (2026-08-11), ending a divergence this file previously
// described as deliberate.
//
// Why it was safe to remove:
//   - Laravel Blade — the declared source of truth for the browser experience —
//     never had it. Keeping it made the two accessible frontends disagree.
//   - `govuk-frontend` is MIT (package.json `license: MIT`; its README states the
//     codebase and sample code are MIT, documentation prose is Crown copyright
//     under OGL v3.0). MIT requires the licence notice be retained; neither
//     licence requires a visible statement disclaiming affiliation.
//
// What still protects the position, and must NOT be weakened: no crown, no GOV.UK
// logotype, no `govukHeader`/footer identity, no GDS Transport, no "Crown
// copyright" wording, and a custom `nexus-alpha-header`. `scripts/brand-check.js`
// enforces those, and a test asserts the disclosure stays absent so it cannot
// creep back in as an unexplained string.

const navItems = [
  { key: 'home', label: 'Home', href: '/', anonymousOnly: true },
  { key: 'dashboard', label: 'Dashboard', href: '/dashboard', authenticatedOnly: true, moduleKey: 'dashboard' },
  { key: 'feed', label: 'Feed', href: '/feed', moduleKey: 'feed' },
  { key: 'listings', label: 'Listings', href: '/listings', moduleKey: 'listings' },
  { key: 'members', label: 'Members', href: '/members', featureKey: 'connections' },
  { key: 'events', label: 'Events', href: '/events', featureKey: 'events' },
  // Anonymous visitors get the public What's On listing INSTEAD of the member
  // events page (buildNavItems drops 'events' when this is present), matching
  // AlphaController::alphaNavItems. Needs BOTH features, like the page itself.
  { key: 'whats_on', label: "What's on", href: '/whats-on', anonymousOnly: true, featureKeys: ['events', 'public_events'] },
  { key: 'volunteering', label: 'Volunteering', href: '/volunteering', featureKey: 'volunteering' },
  // Members only — an anonymous visitor has no pass to show. Matches
  // AlphaController::alphaNavItems, which requires a signed-in user here.
  { key: 'venues', label: 'Partner venues', href: '/venues', authenticatedOnly: true, featureKey: 'partner_venues' },
  { key: 'explore', label: 'Explore', href: '/explore', authenticatedOnly: true }
];

const footerColumns = [
  {
    key: 'platform',
    heading: 'Platform',
    links: [
      { key: 'listings', label: 'Listings', href: '/listings', moduleKey: 'listings' },
      { key: 'members', label: 'Members', href: '/members', featureKey: 'connections' },
      { key: 'events', label: 'Events', href: '/events', featureKey: 'events' },
      { key: 'volunteering', label: 'Volunteering', href: '/volunteering', featureKey: 'volunteering' },
      { key: 'blog', label: 'Blog', href: '/blog', featureKey: 'blog' }
    ]
  },
  {
    key: 'support',
    heading: 'Support',
    links: [
      { key: 'help', label: 'Help centre', href: '/help' },
      { key: 'kb', label: 'Knowledge base', href: '/kb' },
      { key: 'trust_safety', label: 'Trust and safety', href: '/trust-and-safety' },
      { key: 'contact', label: 'Contact', href: '/contact' },
      { key: 'about', label: 'About', href: '/about' }
    ]
  },
  {
    key: 'legal',
    heading: 'Legal',
    links: [
      { key: 'legal_hub', label: 'Legal', href: '/legal' },
      { key: 'terms', label: 'Terms of service', href: '/legal/terms' },
      { key: 'privacy', label: 'Privacy policy', href: '/legal/privacy' },
      { key: 'community_guidelines', label: 'Community guidelines', href: '/legal/community-guidelines' },
      { key: 'acceptable_use', label: 'Acceptable use', href: '/legal/acceptable-use' },
      { key: 'cookies', label: 'Cookie policy', href: '/legal/cookies' },
      { key: 'accessibility', label: 'Accessibility statement', href: '/accessibility' }
    ]
  }
];

const featureDefaults = {
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
  merchant_coupons: false,
  // 🔴 Both default OFF, matching TenantFeatureConfig::FEATURE_DEFAULTS, and the
  // omission is not harmless: a key absent from this map falls through to
  // flagEnabled's `fallback` (true), so leaving these out silently opts EVERY
  // tenant in. `public_events` decides whether a community's events appear on
  // the open web to people without an account, and `partner_venues` exposes a
  // member pass surface. Laravel's comments are explicit that a community opts
  // in to both. Any new Laravel feature default must be mirrored here.
  partner_venues: false,
  public_events: false,
  message_translation: true,
  member_premium: false,
  ai_agents: false,
  partner_api: false,
  fadp_compliance: false,
  local_advertising: false,
  regional_analytics: false,
  newsletter: true,
  identity_verification: true,
  maps: false,
  courses: false,
  podcasts: false
};

const moduleDefaults = {
  listings: true,
  wallet: true,
  messages: true,
  dashboard: true,
  feed: true,
  notifications: true,
  profile: true,
  settings: true
};

const exploreLinks = [
  {
    titleKey: 'exchanges.title',
    descriptionKey: 'exchanges.description',
    href: '/exchanges',
    moduleKey: 'listings',
    workflowKey: 'exchange_workflow',
    status: 'placeholder'
  },
  {
    titleKey: 'govuk_alpha_aichat.title',
    descriptionKey: 'govuk_alpha_aichat.description',
    href: '/chat',
    featureKey: 'ai_chat',
    status: 'placeholder'
  },
  {
    titleKey: 'polls.title',
    descriptionKey: 'polls.description',
    href: '/polls',
    featureKey: 'polls'
  },
  {
    titleKey: 'search.title',
    descriptionKey: 'search.description',
    href: '/search'
  },
  {
    titleKey: 'groups.title',
    descriptionKey: 'groups.description',
    href: '/groups',
    featureKey: 'groups'
  },
  {
    titleKey: 'goals.title',
    descriptionKey: 'goals.description',
    href: '/goals',
    featureKey: 'goals'
  },
  {
    titleKey: 'skills.title',
    descriptionKey: 'skills.description',
    href: '/skills',
    status: 'placeholder'
  },
  {
    titleKey: 'organisations.title',
    descriptionKey: 'organisations.description',
    href: '/organisations',
    featureKey: 'volunteering',
    status: 'placeholder'
  },
  {
    titleKey: 'blog.title',
    descriptionKey: 'blog.description',
    href: '/blog',
    featureKey: 'blog'
  },
  {
    titleKey: 'resources.title',
    descriptionKey: 'resources.description',
    href: '/resources',
    featureKey: 'resources',
    status: 'placeholder'
  },
  {
    titleKey: 'marketplace.title',
    descriptionKey: 'marketplace.description',
    href: '/marketplace',
    featureKey: 'marketplace',
    status: 'placeholder'
  },
  {
    titleKey: 'jobs.title',
    descriptionKey: 'jobs.description',
    href: '/jobs',
    featureKey: 'job_vacancies'
  },
  {
    titleKey: 'courses.title',
    descriptionKey: 'courses.description',
    href: '/courses',
    featureKey: 'courses',
    status: 'placeholder'
  },
  {
    titleKey: 'podcasts.title',
    descriptionKey: 'podcasts.description',
    href: '/podcasts',
    featureKey: 'podcasts',
    status: 'placeholder'
  },
  {
    titleKey: 'coupons.title',
    descriptionKey: 'coupons.description',
    href: '/coupons',
    featureKey: 'merchant_coupons',
    status: 'placeholder'
  },
  {
    titleKey: 'premium.title',
    descriptionKey: 'premium.description',
    href: '/premium',
    featureKey: 'member_premium',
    status: 'placeholder'
  },
  {
    titleKey: 'ideation.title',
    descriptionKey: 'ideation.description',
    href: '/ideation',
    featureKey: 'ideation_challenges',
    status: 'placeholder'
  },
  {
    titleKey: 'federation.title',
    descriptionKey: 'federation.description',
    href: '/federation',
    featureKey: 'federation',
    status: 'placeholder'
  },
  {
    titleKey: 'clubs.title',
    descriptionKey: 'clubs.description',
    href: '/clubs',
    tenantKey: 'has_clubs',
    status: 'placeholder'
  },
];

function activeNavForPath(pathname = '/') {
  if (pathname === '/') return 'home';
  if (pathname.startsWith('/dashboard')) return 'dashboard';
  if ([
    '/account',
    '/profile',
    '/messages',
    '/connections',
    '/wallet',
    '/matches',
    '/group-exchanges',
    '/achievements',
    '/leaderboard',
    '/nexus-score'
  ].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return 'account';
  if (pathname.startsWith('/feed')) return 'feed';
  if (pathname.startsWith('/listings')) return 'listings';
  if (pathname.startsWith('/members')) return 'members';
  if (pathname.startsWith('/venues')) return 'venues';
  // Checked before '/events' for clarity only — the two prefixes cannot collide.
  if (pathname.startsWith('/whats-on')) return 'whats_on';
  if (pathname.startsWith('/events')) return 'events';
  if (pathname.startsWith('/volunteering')) return 'volunteering';
  if (pathname.startsWith('/explore')) return 'explore';
  if (pathname.startsWith('/login')) return 'login';
  if (pathname.startsWith('/register')) return 'register';
  return '';
}

function flagEnabled(tenant = {}, key, source, fallback = true) {
  if (!key) return true;
  const primary = tenant[source] && typeof tenant[source] === 'object' ? tenant[source] : {};
  const secondarySource = source === 'modules' ? 'features' : 'modules';
  const secondary = tenant[secondarySource] && typeof tenant[secondarySource] === 'object'
    ? tenant[secondarySource]
    : {};

  if (Object.prototype.hasOwnProperty.call(primary, key)) return Boolean(primary[key]);
  if (Object.prototype.hasOwnProperty.call(secondary, key)) return Boolean(secondary[key]);
  if (source === 'features' && Object.prototype.hasOwnProperty.call(featureDefaults, key)) {
    return featureDefaults[key];
  }
  if (source === 'modules' && Object.prototype.hasOwnProperty.call(moduleDefaults, key)) {
    return moduleDefaults[key];
  }
  return fallback;
}

function itemEnabledForTenant(item, tenant = {}) {
  if (item.tenantKey && !tenant[item.tenantKey]) return false;
  if (item.workflowKey && !workflowEnabled(tenant, item.workflowKey)) return false;
  if (item.moduleKey) return flagEnabled(tenant, item.moduleKey, 'modules', true);
  // featureKeys is an AND: every named feature must be on. Used where a surface
  // needs more than one gate (What's On needs events AND public_events).
  if (Array.isArray(item.featureKeys)) {
    return item.featureKeys.every((key) => flagEnabled(tenant, key, 'features', true));
  }
  if (item.featureKey) return flagEnabled(tenant, item.featureKey, 'features', true);
  return true;
}

function buildNavItems({ isAuthenticated = false, tenant = {} } = {}) {
  const visible = navItems.filter((item) => {
    if (item.authenticatedOnly && !isAuthenticated) return false;
    if (item.anonymousOnly && isAuthenticated) return false;
    if (!itemEnabledForTenant(item, tenant)) return false;
    return true;
  });

  // Parity with AlphaController::alphaNavItems — an anonymous visitor offered
  // What's On does NOT also get the member Events link, which would send them
  // to a sign-in redirect. Blade unsets 'events'; do the same rather than
  // showing both.
  if (visible.some((item) => item.key === 'whats_on')) {
    return visible.filter((item) => item.key !== 'events');
  }

  return visible;
}

function buildFooterColumns({ tenant = {} } = {}) {
  return footerColumns
    .map((column) => {
      if (column.key !== 'platform') return column;
      return {
        ...column,
        links: column.links.filter((link) => itemEnabledForTenant(link, tenant))
      };
    })
    .filter((column) => column.key !== 'platform' || column.links.length > 0);
}

function workflowEnabled(tenant = {}, key) {
  if (Object.prototype.hasOwnProperty.call(tenant, key)) return Boolean(tenant[key]);
  const brokerControls = tenant.config?.broker_controls || tenant.broker_controls || {};
  const workflow = brokerControls[key] || brokerControls.exchange_workflow || {};
  if (Object.prototype.hasOwnProperty.call(workflow, 'enabled')) return Boolean(workflow.enabled);
  return false;
}

function buildExploreLinks({ tenant = {}, t = createTranslator('en') } = {}) {
  const translate = typeof t === 'function' ? t : createTranslator('en');
  return exploreLinks
    .filter((item) => itemEnabledForTenant(item, tenant))
    .map((item) => ({
      ...item,
      title: translate(item.titleKey),
      description: translate(item.descriptionKey)
    }));
}

function prefixLocalPath(pathname, prefix = '') {
  const path = typeof pathname === 'string' && pathname ? pathname : '/';
  if (!prefix || !path.startsWith('/') || path.startsWith('//')) return path;
  if (
    path === prefix
    || path.startsWith(`${prefix}/`)
    || path.startsWith(`${prefix}?`)
    || path.startsWith(`${prefix}#`)
  ) {
    return path;
  }
  if (path === '/') return prefix;
  return `${prefix}${path}`;
}

function prefixNavItems(items, prefix) {
  return items.map((item) => ({
    ...item,
    href: prefixLocalPath(item.href, prefix)
  }));
}

function prefixFooterColumns(columns, prefix) {
  return columns.map((column) => ({
    ...column,
    links: column.links.map((link) => ({
      ...link,
      href: prefixLocalPath(link.href, prefix)
    }))
  }));
}

function localizeNavItems(items, t) {
  return items.map((item) => ({
    ...item,
    label: t(`nav.${item.key}`)
  }));
}

function localizeFooterColumns(columns, t) {
  return columns.map((column) => ({
    ...column,
    heading: t(`footer.columns.${column.key}.heading`),
    links: column.links.map((link) => ({
      ...link,
      label: t(`footer.columns.${column.key}.${link.key}`)
    }))
  }));
}

function buildLanguageQueryParams(query = {}) {
  return Object.entries(query)
    .filter(([key, value]) => (
      key !== 'locale'
      && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    ))
    .map(([name, value]) => ({
      name,
      value: String(value)
    }));
}

function resolveBackendAssetUrl(value) {
  const asset = String(value || '').trim();
  if (!asset) return '';

  // The BROWSER loads this, so use the browser-reachable origin — which in
  // Docker is not the origin this server calls the API on. The same-origin
  // check is kept: an absolute URL pointing anywhere else is rejected rather
  // than rendered, so a tenant cannot point the header at a third-party host.
  const assetBaseUrl = getPublicAssetBaseUrl();
  try {
    const resolved = new URL(asset, `${assetBaseUrl}/`);
    return resolved.origin === new URL(assetBaseUrl).origin ? resolved.href : '';
  } catch {
    return '';
  }
}

function normalizeLogoShape(value) {
  return ['wide', 'landscape', 'square'].includes(value) ? value : 'landscape';
}

function buildShellLocals(req, isAuthenticated) {
  const routedTenant = req.accessibleRouting?.tenant && typeof req.accessibleRouting.tenant === 'object'
    ? req.accessibleRouting.tenant
    : {};
  const tenantName = routedTenant.name || process.env.ACCESSIBLE_TENANT_NAME || serviceName;
  const queryLocale = typeof req.query?.locale === 'string' ? req.query.locale : '';
  const currentLocale = isSupportedLocale(req.locale)
    ? req.locale
    : (isSupportedLocale(queryLocale) ? queryLocale : 'en');
  const t = typeof req.t === 'function' ? req.t : createTranslator(currentLocale);
  const routePrefix = req.accessibleRouting?.prefix || '';
  const visiblePath = req.originalUrl ? req.originalUrl.split('?')[0] : (req.path || '/');
  const currentPath = visiblePath || '/';
  const currentUrl = req.originalUrl || currentPath;
  const urlFor = (pathname) => prefixLocalPath(pathname, routePrefix);
  const tenantSlug = req.accessibleRouting?.tenantSlug || '';
  const branding = routedTenant.branding && typeof routedTenant.branding === 'object'
    ? routedTenant.branding
    : {};
  const tenantLogoUrl = resolveBackendAssetUrl(branding.logo_dark_url || branding.logo_url);

  return {
    serviceName: t('service_name'),
    phaseText: t('phase'),
    tenantName,
    tenantSlug,
    tenantLogoUrl,
    tenantLogoShape: normalizeLogoShape(branding.logo_shape),
    accessibleRoutePrefix: routePrefix,
    urlFor,
    htmlLang: currentLocale,
    htmlDirection: currentLocale === 'ar' ? 'rtl' : 'ltr',
    t,
    alphaCurrentLocale: currentLocale,
    alphaLocaleOptions: localeOptions,
    alphaLanguageQueryParams: buildLanguageQueryParams(req.query),
    alphaTextDirection: currentLocale === 'ar' ? 'rtl' : 'ltr',
    alphaNavItems: tenantSlug ? prefixNavItems(
      localizeNavItems(buildNavItems({ isAuthenticated, tenant: routedTenant }), t),
      routePrefix
    ) : [],
    alphaActiveNav: activeNavForPath(req.path),
    alphaFooterColumns: tenantSlug ? prefixFooterColumns(
      localizeFooterColumns(buildFooterColumns({ tenant: routedTenant }), t),
      routePrefix
    ) : [],
    alphaExploreLinks: prefixNavItems(buildExploreLinks({ tenant: routedTenant, t }), routePrefix),
    currentPath,
    currentUrl,
    feedbackUrl,
    reportProblemUrl: `${urlFor('/report-a-problem')}?return=${encodeURIComponent(currentUrl)}`,
    cookieSettingsUrl: urlFor('/cookies'),
    mainSiteUrl: process.env.MAIN_FRONTEND_URL || 'https://app.project-nexus.ie',
    sourceCodeUrl,
    sharedAccessibleStatus: 'candidate_not_certified'
  };
}

module.exports = {
  activeNavForPath,
  buildFooterColumns,
  buildExploreLinks,
  buildLanguageQueryParams,
  buildNavItems,
  buildShellLocals,
  exploreLinks,
  featureDefaults,
  flagEnabled,
  footerColumns,
  localeOptions,
  moduleDefaults,
  phaseText,
  prefixLocalPath,
  resolveBackendAssetUrl,
  serviceName
};
