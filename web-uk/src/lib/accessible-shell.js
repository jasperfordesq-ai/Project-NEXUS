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

// Powered-by badge defaults, matching the React footer's built-in pair so that a
// community which has configured nothing sees the same mark on both frontends.
//
// A community overrides either of these in the admin panel
// (general.powered_by_image_light / general.powered_by_url); these defaults ship with
// every fork and clone, so the badge is never missing.
//
// 🔴 The URL is the MARKETING site, which is moving from project-nexus.ie to
// project-nexus.net. Keep it equal to DEFAULT_PB_URL in
// react-frontend/src/components/layout/Footer.tsx — one badge should not point at two
// different places depending on which frontend a member is using.
const DEFAULT_POWERED_BY_IMAGE = '/images/powered-by-nexus-light.png';
const DEFAULT_POWERED_BY_URL = 'https://project-nexus.net';

// The platform's own name, as a code constant rather than a translation key —
// the same treatment `serviceName` and `sourceCodeUrl` above already get. It is a
// brand name, so it is identical in all eleven languages; as a translation key it
// would be eleven byte-identical English values, which is exactly what
// scripts/check-php-lang-untranslated.mjs counts against the ceiling.
const platformName = 'Project NEXUS';

// The documentation site. Kept equal to PROJECT_NEXUS_DOCS_URL in
// react-frontend/src/config/externalLinks.ts, which explains why it lives on its
// own domain rather than one derived from the repository name.
const docsUrl = 'https://docs.project-nexus.ie/';
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
      // 🔴 Added 2026-09-18 so this column matches the React footer's exactly. Both
      // are static compliance pages rather than per-community legal documents, which
      // is why they sit at the top level and not under /legal/ — see routes/legal.js.
      { key: 'account_deletion', label: 'Account deletion', href: '/account-deletion' },
      { key: 'child_safety', label: 'Child safety standards', href: '/child-safety' },
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
  // 🔴 The accessible frontend's only reachable entry into Caring.
  //
  // Without a link here the caregiver journey exists but cannot be FOUND, which
  // for this audience is the same as not existing: the members these care
  // relationships are about are the ones most likely to be using this frontend.
  // Gated on `caring_community`, which defaults to FALSE, so a community that
  // has not opted in never sees it — matching the feature-route gate on
  // /caring and Laravel's own default.
  {
    titleKey: 'govuk_alpha_caring.hub.title',
    descriptionKey: 'govuk_alpha_caring.hub.caregiver_card_description',
    href: '/caring',
    featureKey: 'caring_community'
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

// The no-JS language switcher re-submits the current query as hidden inputs so
// switching language keeps you on the same filtered/half-built page.
//
// 🔴 This used to keep ONLY scalar values, silently dropping arrays and nested
// objects. That quietly destroyed real state: e.g. the group-message composer keeps
// its selected recipients in `members[]`, so switching language returned you to the
// page with every selection gone (name/q survived, so it looked like a partial
// glitch). Arrays and one level of nesting are now flattened into bracketed names
// (`members[]`, `filter[status]`) that Express's extended qs parser re-reads back
// into the same array/object.
function flattenQueryParam(name, value, out) {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const element of value) {
      flattenQueryParam(`${name}[]`, element, out);
    }
    return;
  }
  if (typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) {
      flattenQueryParam(`${name}[${childKey}]`, childValue, out);
    }
    return;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    out.push({ name, value: String(value) });
  }
}

function buildLanguageQueryParams(query = {}) {
  const out = [];
  for (const [key, value] of Object.entries(query)) {
    if (key === 'locale') continue;
    flattenQueryParam(key, value, out);
  }
  return out;
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

/**
 * Resolve a MEMBER-CONTENT asset (avatar, post photo, listing image, logo of a
 * club or organisation) for the browser.
 *
 * 🔴 Use this — NOT `resolveBackendAssetUrl` — for anything a member uploaded or
 * a federation partner supplied. The two differ only on absolute URLs pointing
 * off-origin, and that difference matters in both directions:
 *
 *   - `resolveBackendAssetUrl` REJECTS them, which is right for tenant branding
 *     (a tenant must not be able to point the site header at a third-party host)
 *     and wrong for member content, where it silently deletes the image.
 *   - This one PASSES THEM THROUGH, matching `resolveAssetUrl` in the React
 *     frontend, which keeps them deliberately so "avatars from federation
 *     partners load from the correct server".
 *
 * Both resolve a RELATIVE path against the browser-reachable API origin, which
 * is the bug this exists to fix: `/uploads/...` and the Laravel default avatar
 * `/assets/img/defaults/default_avatar.png` are served by the API host, NOT by
 * this frontend's host, so rendering them unchanged gave a broken image on every
 * accessible domain — reported on the feed, where every avatar and every post
 * photo failed to load.
 *
 * 🔴 Known limitation, deliberately NOT worked around here: the CSP in
 * `server.js` sets `img-src` to `'self' data: <api origin>`, so an off-origin
 * image still will not render even though the URL survives. Widening the
 * allowlist is a trust/privacy decision (it leaks every viewer's IP to that
 * host) and belongs to the owner, not to this helper.
 */
function resolveBackendMediaUrl(value) {
  const asset = String(value || '').trim();
  if (!asset) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(asset) || asset.startsWith('//')) {
    // Already absolute (or protocol-relative): leave the host alone.
    return asset;
  }
  return resolveBackendAssetUrl(asset);
}

/**
 * Resolve a FOOTER BRANDING image (partner logo, powered-by badge) for the browser.
 *
 * Mirrors `resolveBrandingImageUrl` in the React frontend
 * (react-frontend/src/lib/helpers.ts) rule for rule, because the two footers read the
 * same tenant settings and a value that works on one must work on the other.
 *
 * 🔴 Why this is NOT `resolveBackendAssetUrl`, which is otherwise the correct helper
 * for tenant branding: the powered-by badge has a BUILT-IN DEFAULT
 * (`/images/powered-by-nexus-light.png`) that this frontend serves from its own
 * `public/` directory. `resolveBackendAssetUrl` resolves every relative path against
 * the API origin, which would send the browser to the API host for a file that only
 * exists here, and render a broken image on every page for every community that has
 * not uploaded its own badge — i.e. all of them today.
 *
 * So only the paths the API actually serves are pointed at the API:
 *
 *   - `/uploads/` and `/storage/` — where an admin-uploaded logo lands.
 *   - An absolute or protocol-relative URL — passed to `resolveBackendAssetUrl`, which
 *     REJECTS off-origin hosts. That rejection is the point: a tenant admin must not be
 *     able to aim the footer at a third-party host and leak every viewer's IP to it.
 *     It is also why the CSP in server.js (`img-src 'self' data: <api origin>`) needs no
 *     widening for this — everything that survives is one of those two origins.
 *
 * Anything else stays a local path served by this frontend.
 *
 * @param {string} value  A tenant setting value, or a built-in default path.
 * @returns {string} A browser-usable URL, or '' when there is no usable image.
 */
function resolveBrandingImageUrl(value) {
  const candidate = String(value || '').trim();
  if (!candidate) return '';

  if (/^[a-z][a-z0-9+.-]*:/i.test(candidate) || candidate.startsWith('//')) {
    return resolveBackendAssetUrl(candidate);
  }

  const localPath = candidate.startsWith('/') ? candidate : `/${candidate}`;
  if (localPath.startsWith('/uploads/') || localPath.startsWith('/storage/')) {
    return resolveBackendAssetUrl(localPath);
  }

  return localPath;
}

/**
 * Ask the API for a member-content image at the size it will actually be shown.
 *
 * Mirrors `resolveThumbnailUrl` in the React frontend (react-frontend/src/lib/helpers.ts),
 * which routes local uploads through `GET /api/v2/media/thumbnail`. Measured against
 * production on 2026-08-18: a real avatar is 160,561 bytes at source and 2,260 bytes
 * through the endpoint, returned as WebP — a 71× saving on a picture displayed at 64px.
 *
 * Sizing is a rendering decision, so it belongs with the markup that decides the size
 * rather than with the route that fetched the record. This is exposed to templates as
 * the `thumb` filter (see lib/template-filters.js).
 *
 * The rules are deliberately the same as React's, and each one matters:
 *
 *   - Only `/uploads/` and `/storage/` on OUR API origin are rewritten. Those are the
 *     only paths `MediaThumbnailService::resolveSourcePath()` will serve; anything else
 *     404s, so rewriting it would replace a working image with a broken one.
 *   - A federation partner's absolute URL is returned untouched. Proxying a partner's
 *     asset through our server would both break it and route their traffic through us.
 *   - Anything unparseable falls back to the resolved original rather than to nothing.
 *     A correctly-sized image is an improvement; no image is a regression.
 *
 * Ask for the DISPLAYED pixel size. Retina sizing is the caller's decision — pass 2× when
 * the image is small enough that the extra bytes are cheap, as the React avatar does (96px
 * for a 48px avatar).
 *
 * @param {string} value  A relative upload path, or a URL already resolved to the API origin.
 * @param {{ width?: number, height?: number, fit?: 'cover'|'contain' }} options
 * @returns {string} A thumbnail URL, the resolved original, or '' when there is no image.
 */
function resolveBackendThumbnailUrl(value, options = {}) {
  const resolved = resolveBackendMediaUrl(value);
  if (!resolved) return '';

  const width = Number.parseInt(options.width, 10);
  const height = Number.parseInt(options.height, 10);
  if (!Number.isFinite(width) || width <= 0) return resolved;

  const targetHeight = Number.isFinite(height) && height > 0 ? height : width;
  const fit = options.fit === 'contain' ? 'contain' : 'cover';

  try {
    const assetBaseUrl = getPublicAssetBaseUrl();
    const base = new URL(assetBaseUrl);
    const asset = new URL(resolved, `${assetBaseUrl}/`);

    if (asset.origin !== base.origin) return resolved;
    if (!asset.pathname.startsWith('/uploads/') && !asset.pathname.startsWith('/storage/')) {
      return resolved;
    }

    const params = new URLSearchParams({
      src: asset.pathname,
      w: String(width),
      h: String(targetHeight),
      fit
    });

    return `${base.origin}/api/v2/media/thumbnail?${params.toString()}`;
  } catch {
    return resolved;
  }
}

function normalizeLogoShape(value) {
  return ['wide', 'landscape', 'square'].includes(value) ? value : 'landscape';
}

/**
 * 🔴 Mirrors AlphaController::feedbackUrl() — do not simplify back to a constant.
 *
 * Blade sends "Give feedback" to the COMMUNITY'S OWN contact form on any real
 * tenant, and only falls back to the platform mailto for the tenant-agnostic
 * pages (the host tenant, id <= 1, or no slug — the tenant chooser). web-uk used
 * the mailto unconditionally, which on every community site:
 *   - produced a dead link for anyone without a configured mail client, which is
 *     disproportionately this frontend's audience (webmail-only users, shared and
 *     library machines);
 *   - routed community feedback to the platform inbox instead of the community;
 *   - bypassed the Turnstile bot protection deliberately added to /contact.
 *
 * Found by walking both accessible frontends side by side on 2026-08-13.
 */
function resolveFeedbackUrl({ tenantSlug, tenant, urlFor }) {
  const tenantId = Number.parseInt(tenant && tenant.id, 10);
  if (!tenantSlug || !Number.isFinite(tenantId) || tenantId <= 1) {
    return feedbackUrl;
  }
  return urlFor('/contact');
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

  // ---------------------------------------------------------------------------
  // Footer branding: the community's partner logo and the powered-by badge.
  //
  // 🔴 The LIGHT badge, deliberately, and not a choice between the two the admin
  // panel offers. `govuk-footer` is light grey (govuk-colour("light-grey")) and this
  // frontend has NO dark mode — there is not one `prefers-color-scheme` rule in its
  // stylesheet, because the GOV.UK Design System is light-only. The dark asset is
  // artwork FOR a dark background, so serving it here would put a pale logo on pale
  // grey and fail contrast for everyone.
  //
  // That is not the dark variant going unused platform-wide: the React footer picks
  // between the pair by theme, and this frontend's own header is black and already
  // uses each community's dark logo (`tenantLogoUrl` above). Each variant is used
  // where its background matches. If this frontend ever gains dark mode, switch the
  // line below to choose the pair the way the header does.
  // ---------------------------------------------------------------------------
  const tenantConfig = routedTenant.config && typeof routedTenant.config === 'object'
    ? routedTenant.config
    : {};

  const poweredByImageUrl = resolveBrandingImageUrl(
    tenantConfig.powered_by_image_light || DEFAULT_POWERED_BY_IMAGE
  );
  const poweredByUrl = String(tenantConfig.powered_by_url || DEFAULT_POWERED_BY_URL).trim();
  const poweredByLabel = String(tenantConfig.powered_by_label || '').trim();

  // No dashed "logo goes here" placeholder, unlike the React footer. An empty
  // bordered box is a useful authoring hint on an admin-facing surface and pure
  // noise here: a screen reader would announce a decorative box with placeholder
  // text, and a sighted member would read the gap as a broken image.
  const partnerLogoUrl = resolveBrandingImageUrl(tenantConfig.partner_logo_url);
  const partnerLogoLabel = String(tenantConfig.partner_logo_label || '').trim();
  const partnerLogoLinkUrl = String(tenantConfig.partner_logo_link_url || '').trim();

  // The community's own copyright line, matching the React footer: the community's
  // `general.footer_text` setting when it has one, otherwise the platform default
  // built from the community name and the AGPL notice.
  const tenantFooterText = String(tenantConfig.footer_text || '').trim();

  return {
    serviceName: t('service_name'),
    phaseText: t('phase'),
    tenantName,
    // 41 templates interpolate { community: communityName } into their caption.
    // Routes provide it inconsistently — achievements never did, so its caption
    // rendered the literal word "undefined" (caught by the route sweep). A
    // shell-wide default makes that impossible; a route-passed value still wins
    // because res.render() locals override res.locals.
    communityName: tenantName,
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
    // 🔴 WCAG 2.2 §3.2.6 Consistent Help: a help mechanism must appear in the same
    // relative place on EVERY page of the service. This returned [] for any render
    // without a routed tenant — the shared root / tenant chooser — which deleted the
    // whole footer, Help centre and Contact included. So the one page a lost visitor
    // is most likely to be looking at offered no way to get help.
    //
    // The tenant-specific columns still require a tenant (their links are
    // module/feature gated and only make sense inside a community). The SUPPORT column
    // does not: /help, /contact, /about and /trust-and-safety all resolve un-prefixed
    // on the shared host (verified 200; /kb redirects, which is fine), so it renders
    // tenant-free and keeps its position at the same place in the footer.
    alphaFooterColumns: tenantSlug ? prefixFooterColumns(
      localizeFooterColumns(buildFooterColumns({ tenant: routedTenant }), t),
      routePrefix
    ) : localizeFooterColumns(
      buildFooterColumns({ tenant: routedTenant }).filter((column) => column.key === 'support'),
      t
    ),
    alphaExploreLinks: prefixNavItems(buildExploreLinks({ tenant: routedTenant, t }), routePrefix),
    currentPath,
    currentUrl,
    feedbackUrl: resolveFeedbackUrl({ tenantSlug, tenant: routedTenant, urlFor }),
    reportProblemUrl: `${urlFor('/report-a-problem')}?return=${encodeURIComponent(currentUrl)}`,
    cookieSettingsUrl: urlFor('/cookies'),
    mainSiteUrl: process.env.MAIN_FRONTEND_URL || 'https://app.project-nexus.ie',
    sourceCodeUrl,
    poweredByImageUrl,
    poweredByUrl,
    poweredByLabel,
    partnerLogoUrl,
    partnerLogoLabel,
    partnerLogoLinkUrl,
    tenantFooterText,
    platformName,
    docsUrl,
    // 🔴 The copyright year is deliberately NOT here. It was, and the AGPL notice
    // rendered "Copyright © 2024–undefined Jasper Ford" on every page rendered
    // without this builder. It is now the `copyrightYear()` template global in
    // lib/template-filters.js, which every render path has.
    // Platform software version for the footer line. Supplied by the API
    // (TenantBootstrapController::buildPublicConfig), which reads config('app.version') —
    // a value CI pins to the repo's VERSION file. This frontend has no other source:
    // its Docker build context is web-uk/, so the VERSION file is not in its image.
    //
    // Empty when the API is unreachable or predates the field. The footer then omits the
    // line entirely rather than printing "version" followed by nothing, because a blank
    // or wrong version number is worse than no version number.
    platformVersion: String(tenantConfig.platform_version || '').trim(),
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
  resolveBackendMediaUrl,
  resolveBackendThumbnailUrl,
  resolveBrandingImageUrl,
  serviceName
};
