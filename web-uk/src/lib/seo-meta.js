// Copyright © 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Search-engine and sharing metadata for the accessible frontend.
 *
 * Mirrors react-frontend/src/components/seo/PageMeta.tsx (and SeoHead.tsx for
 * the community-wide robots directive), reading the same tenant bootstrap
 * fields, so a community's /admin/seo settings mean the same thing on both
 * frontends:
 *
 *   - settings.seo_title_suffix      → the name after the page title
 *   - settings.seo_meta_description  → community-wide description
 *   - seo.meta_description           → tenant "Meta description"
 *   - branding.tagline / tagline     → description fallback
 *   - branding.og_image_url          → sharing image (wide card)
 *   - branding.logo_url              → sharing image fallback (small card)
 *   - settings.seo_canonical_urls / seo_open_graph / seo_twitter_cards
 *                                    → per-community on/off switches (default on)
 *   - seo.robots_directive           → community-wide robots meta (e.g. the
 *                                      community switched indexing off)
 *
 * 🔴 CANONICAL RULE. Every accessible page is an alternative presentation of a
 * main-site (React) page, so where the SAME content exists on the main site at a
 * known address, the canonical points there. Only paths in MAIN_SITE_PATHS are
 * mapped — each one was checked against react-frontend/src/routes/*.tsx to have
 * the same shape. Everything else (accessible-only pages, forms, and any path
 * not on the list) is self-canonical: the accessible URL with its query string
 * removed. A wrong cross-site canonical tells search engines to drop a page in
 * favour of one that does not exist; a self-canonical can only fail to
 * de-duplicate, so the list errs on the side of leaving a path off.
 */

const { URL } = require('node:url');

const DEFAULT_MAIN_SITE_URL = 'https://app.project-nexus.ie';
const NOINDEX = 'noindex, nofollow';

/**
 * Accessible route path → main-site route path. `null` replacement keeps the
 * path unchanged. Paths are matched after the accessible prefix
 * (`/{slug}/accessible`) has been removed.
 */
const MAIN_SITE_PATHS = [
  [/^\/$/, null],
  [/^\/(about|accessibility|faq|features|changelog|child-safety|account-deletion|terms|privacy|contact|help|trust-and-safety|timebanking-guide|community-guidelines|acceptable-use)$/, null],
  [/^\/legal$/, null],
  // The accessible frontend files the policies under /legal/*; the main site
  // serves them at the top level.
  [/^\/legal\/(terms|privacy|cookies|acceptable-use|community-guidelines)$/, (match) => `/${match[1]}`],
  [/^\/page\/[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/, null],
  [/^\/blog(\/[A-Za-z0-9_-]+)?$/, null]
  // Only pages a signed-out visitor can open on the main site
  // (react-frontend/src/routes/PublicAppRoutes.tsx). Listings, events,
  // groups, members, courses and the rest need sign-in there; pointing a
  // canonical at a sign-in page tells search engines to drop this page as a
  // duplicate of nothing. They stay self-canonical.
];

// Words that, as a path's LAST segment, mean "a form or a management screen",
// never a public page (e.g. /events/12/edit, /groups/new).
const PRIVATE_LAST_SEGMENTS = new Set([
  'new', 'create', 'edit', 'manage', 'delete', 'report', 'apply', 'register',
  'invite', 'analytics', 'moderation', 'translate'
]);

// Route-path prefixes that are signed-in, personal or transactional. React
// marks the same pages `noIndex` (auth, dashboard, settings, …). Also used
// for robots.txt.
const PRIVATE_PREFIXES = [
  '/account',
  '/achievements',
  '/activity',
  '/connections',
  '/cookie-consent',
  '/cookies',
  '/dashboard',
  '/exchanges',
  '/forgot-password',
  '/legal-acceptance',
  '/login',
  '/logout',
  '/matches',
  '/me',
  '/messages',
  '/nexus-score',
  '/notifications',
  '/onboarding',
  '/password',
  '/profile',
  '/register',
  '/report-a-problem',
  '/reset-password',
  '/saved',
  '/search',
  '/settings',
  '/support-actions',
  '/two-factor',
  '/verify-email',
  '/wallet'
];

// The subset robots.txt asks crawlers not to fetch at all. Deliberately smaller
// than PRIVATE_PREFIXES: sign-in and registration pages stay crawlable so a
// crawler can READ their noindex (a disallowed URL can still be indexed from
// links, without its content). These are pages an anonymous visitor is only
// ever redirected away from, plus internal search results.
const ROBOTS_DISALLOWED = [
  '/account',
  '/connections',
  '/dashboard',
  '/exchanges',
  '/legal-acceptance',
  '/matches',
  '/me',
  '/messages',
  '/notifications',
  '/onboarding',
  '/saved',
  '/search',
  '/settings',
  '/support-actions',
  '/wallet'
];

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** Same reading as PageMeta's getBoolSetting: absent or unrecognised ⇒ on. */
function boolSetting(settings, key) {
  const value = settings[key];
  if (value === undefined || value === null) return true;
  if (typeof value === 'boolean') return value;
  if (value === '0' || value === 'false' || value === 0) return false;
  return true;
}

function cleanHost(value) {
  return text(value)
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
}

function trimTrailingSlash(pathname) {
  if (!pathname || pathname === '/') return '/';
  return pathname.replace(/\/+$/, '') || '/';
}

function httpUrl(value) {
  const candidate = text(value);
  if (!candidate) return '';
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : '';
  } catch {
    return '';
  }
}

/**
 * The main-site address of a community, matching how React serves it:
 * its own domain → `https://{domain}`; a slug-only community under a hub that
 * owns a domain → `https://{hub}/{slug}`; otherwise the shared host
 * `{MAIN_FRONTEND_URL}/{slug}`. Returns '' when there is no community.
 */
function mainSiteBaseUrl(tenant, mainFrontendUrl = process.env.MAIN_FRONTEND_URL) {
  const data = asObject(tenant);
  const slug = text(data.slug);
  const domain = cleanHost(data.domain);
  if (domain) return `https://${domain}`;
  if (!slug) return '';

  const hub = cleanHost(data.parent_domain);
  const base = hub ? `https://${hub}` : (text(mainFrontendUrl) || DEFAULT_MAIN_SITE_URL).replace(/\/+$/, '');
  return `${base}/${encodeURIComponent(slug)}`;
}

/**
 * The main-site path showing the same content as this accessible route path,
 * or null when there is no known equivalent.
 */
function mainSitePathFor(routePath) {
  const pathname = trimTrailingSlash(String(routePath || '/').split('?')[0]);
  for (const [pattern, replace] of MAIN_SITE_PATHS) {
    const match = pathname.match(pattern);
    if (match) {
      return typeof replace === 'function' ? replace(match) : pathname;
    }
  }
  return null;
}

function isPrivatePath(routePath) {
  const pathname = trimTrailingSlash(String(routePath || '/').split('?')[0]).toLowerCase();
  if (PRIVATE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return true;
  }
  const segments = pathname.split('/').filter(Boolean);
  return segments.length > 1 && PRIVATE_LAST_SEGMENTS.has(segments[segments.length - 1]);
}

/**
 * Keep only a plausible robots directive ("noindex, nofollow", "noarchive",
 * "max-snippet:-1"). It comes from the community's settings and lands in an
 * HTTP header, so anything else is dropped.
 */
function sanitizeRobotsDirective(value) {
  const directive = text(value).toLowerCase();
  return /^[a-z0-9:\-, ]{1,200}$/.test(directive) ? directive.replace(/\s+/g, ' ') : '';
}

function absoluteFromRequestUrl({ protocol, host, visiblePath }) {
  if (!host) return '';
  const pathname = trimTrailingSlash(String(visiblePath || '/').split('?')[0].split('#')[0]);
  return `${protocol}://${host}${pathname}`;
}

/**
 * @param {object} options
 * @param {object} options.tenant          routed tenant bootstrap ({} when none)
 * @param {Function} options.t             translator
 * @param {string} options.serviceName     translated platform service name
 * @param {string} options.routePath       path with the accessible prefix removed
 * @param {string} options.visiblePath     path as the browser sees it
 * @param {string} options.protocol        'https' | 'http'
 * @param {string} options.host            public host of this request
 * @param {boolean} options.isAuthenticated
 * @param {Function} [options.resolveAssetUrl] resolves a relative logo path
 */
// Same as React SeoHead's verificationToken(): only the token survives, so a
// pasted whole tag or "google-site-verification=TOKEN" still verifies.
function verificationToken(raw) {
  let v = text(raw);
  if (!v) return '';
  const fromTag = v.match(/content\s*=\s*["']([^"']+)["']/i);
  if (fromTag && fromTag[1]) v = fromTag[1];
  const eq = v.lastIndexOf('=');
  if (eq !== -1 && /^(google-site-verification|msvalidate\.01)\s*=/i.test(v)) v = v.slice(eq + 1);
  return v.replace(/[<>"'\s]/g, '');
}

// Same map as React SeoHead's SCHEMA_ORG_TYPE.
const SCHEMA_ORG_TYPE = {
  NonprofitOrganization: 'NGO', CommunityOrganization: 'NGO', VolunteerOrganization: 'NGO', NGO: 'NGO',
  LocalBusiness: 'LocalBusiness', GovernmentOrganization: 'GovernmentOrganization', Organization: 'Organization'
};

// JSON for a <script type="application/ld+json"> block, escaped as React's
// toJsonLd() does so no value can close the script element.
function toJsonLd(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

// Same map as React PageMeta's OG_LOCALES.
const OG_LOCALES = {
  en: 'en_GB', ga: 'ga_IE', de: 'de_DE', fr: 'fr_FR', it: 'it_IT', pt: 'pt_PT',
  es: 'es_ES', nl: 'nl_NL', pl: 'pl_PL', ja: 'ja_JP', ar: 'ar_001'
};

function buildSeoLocals({
  tenant,
  t,
  locale = 'en',
  serviceName,
  routePath,
  visiblePath,
  protocol = 'https',
  host = '',
  isAuthenticated = false,
  resolveAssetUrl = (value) => httpUrl(value),
  mainFrontendUrl
} = {}) {
  const data = asObject(tenant);
  const settings = asObject(data.settings);
  const seo = asObject(data.seo);
  const branding = asObject(data.branding);
  const translate = typeof t === 'function' ? t : (key) => key;
  const tenantName = text(data.name);
  const hasCommunity = Boolean(text(data.slug)) && Number(data.id) !== 1;

  // Site name: admin title suffix (any leading separator stripped, as React
  // does) > community name > the platform's accessible service name.
  const suffix = text(settings.seo_title_suffix).replace(/^[\s|·•:\-–—]+/, '').trim();
  const siteName = suffix || tenantName || text(serviceName);

  const communityDescription = hasCommunity && tenantName
    ? translate('home.description', { community: tenantName })
    : '';
  // As PageMeta's `tenantHome`: on the community home page its own
  // "Meta description" wins over the community-wide default.
  const isHome = trimTrailingSlash(String(routePath || '/')) === '/';
  const description = (isHome ? text(seo.meta_description) : '')
    || text(settings.seo_meta_description)
    || text(seo.meta_description)
    || text(branding.tagline)
    || text(data.tagline)
    || communityDescription
    || translate('seo.description');

  const mainBase = hasCommunity ? mainSiteBaseUrl(data, mainFrontendUrl) : '';
  const mainPath = mainBase ? mainSitePathFor(routePath) : null;
  let canonicalUrl = '';
  if (mainBase && mainPath !== null) {
    canonicalUrl = mainPath === '/'
      ? (cleanHost(data.domain) ? `${mainBase}/` : mainBase)
      : `${mainBase}${mainPath}`;
  } else {
    canonicalUrl = absoluteFromRequestUrl({ protocol, host, visiblePath });
  }

  const sharingImage = httpUrl(branding.og_image_url);
  const logoImage = resolveAssetUrl(text(branding.logo_url));

  const communityRobots = sanitizeRobotsDirective(seo.robots_directive);
  // Private and signed-in pages are always noindex; otherwise the community's
  // own directive (e.g. it switched indexing off) applies, as in SeoHead.
  const robots = (isAuthenticated || isPrivatePath(routePath)) ? NOINDEX : communityRobots;

  // As PageMeta's `tenantHome`: the community home page uses the community's
  // own /admin/seo "Meta title" as the whole title when one is set.
  const homeTitle = isHome && hasCommunity ? text(seo.meta_title) : '';

  // The community's Organization data, on its accessible home page only. Its
  // @id and url are the main site's, so search engines see one organisation,
  // not a second one for the accessible copy.
  let organizationJsonLd = '';
  if (isHome && hasCommunity && tenantName && mainBase) {
    const social = asObject(data.social);
    const sameAs = ['facebook', 'twitter', 'instagram', 'linkedin', 'youtube']
      .map((key) => httpUrl(social[key]))
      .filter(Boolean);
    const org = {
      '@context': 'https://schema.org',
      '@type': SCHEMA_ORG_TYPE[text(settings.seo_organization_type)] || 'NGO',
      '@id': `${mainBase}/#org`,
      name: siteName || tenantName,
      url: cleanHost(data.domain) ? `${mainBase}/` : mainBase
    };
    if (logoImage) org.logo = logoImage;
    if (text(branding.tagline)) org.description = text(branding.tagline);
    if (sameAs.length > 0) org.sameAs = sameAs;
    organizationJsonLd = toJsonLd(org);
  }

  return {
    seoSiteName: siteName,
    seoHomeTitle: homeTitle,
    seoGoogleVerification: verificationToken(settings.seo_google_verification),
    seoBingVerification: verificationToken(settings.seo_bing_verification),
    seoKeywords: text(settings.seo_meta_keywords),
    seoOrganizationJsonLd: organizationJsonLd,
    seoOgLocale: OG_LOCALES[String(locale || '').toLowerCase()] || OG_LOCALES.en,
    seoDescription: description,
    seoCanonicalUrl: canonicalUrl,
    seoEnableCanonical: boolSetting(settings, 'seo_canonical_urls'),
    seoEnableOpenGraph: boolSetting(settings, 'seo_open_graph'),
    seoEnableTwitterCards: boolSetting(settings, 'seo_twitter_cards'),
    seoImageUrl: sharingImage || logoImage || '',
    seoTwitterCard: sharingImage ? 'summary_large_image' : 'summary',
    seoHasWideImage: Boolean(sharingImage),
    seoRobots: robots
  };
}

/**
 * robots.txt for an accessible host. Paths are listed twice: bare, for a
 * community's own accessible domain (`/dashboard`), and under the shared-host
 * mount (`/{slug}/accessible/dashboard`). No Sitemap line: these pages
 * canonicalise to the main site, whose own robots.txt names its sitemaps.
 */
function buildRobotsTxt() {
  const lines = ['User-agent: *'];
  // Each path as itself ($), its sub-pages (/) and with a query string (?).
  // A bare prefix would also block every address that merely starts with the
  // same letters: "/me" would block /members and /meetings.
  const forms = (path) => [`${path}$`, `${path}/`, `${path}?`];
  for (const prefix of ROBOTS_DISALLOWED) {
    for (const rule of forms(prefix)) lines.push(`Disallow: ${rule}`);
  }
  for (const prefix of ROBOTS_DISALLOWED) {
    for (const rule of forms(`/*/accessible${prefix}`)) lines.push(`Disallow: ${rule}`);
  }
  lines.push('Allow: /');
  return `${lines.join('\n')}\n`;
}

module.exports = {
  verificationToken,
  toJsonLd,
  MAIN_SITE_PATHS,
  NOINDEX,
  PRIVATE_PREFIXES,
  ROBOTS_DISALLOWED,
  buildRobotsTxt,
  buildSeoLocals,
  isPrivatePath,
  mainSiteBaseUrl,
  mainSitePathFor,
  sanitizeRobotsDirective
};
