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
 *   - settings.seo_primary_site      → which of the community's two sites search
 *                                      engines should index: 'standard' (the main
 *                                      site; default, also when absent) or
 *                                      'accessible' (this site, e.g. a council
 *                                      that uses only the accessible site)
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
 *
 * 🔴 PRIMARY-SITE EXCEPTION. When the community chose its accessible site for
 * search engines (settings.seo_primary_site = 'accessible'), the rule inverts:
 * EVERY accessible page is self-canonical, because the main site is the copy.
 * Robots are unaffected — private and signed-in pages stay noindex either way.
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
  // 'timebanking-guide' used to be listed here too. The accessible frontend has
  // no route at that path (its guide is /guide, mapped below), so it could never
  // match anything.
  [/^\/(about|accessibility|faq|features|changelog|child-safety|account-deletion|terms|privacy|contact|help|trust-and-safety|community-guidelines|acceptable-use)$/, null],
  // The same timebanking guide (give an hour, earn a credit, get help), which
  // React serves as TimebankingGuidePage at /timebanking-guide.
  [/^\/guide$/, () => '/timebanking-guide'],
  [/^\/legal$/, null],
  // The accessible frontend files the policies under /legal/*; the main site
  // serves them at the top level.
  [/^\/legal\/(terms|privacy|cookies|acceptable-use|community-guidelines)$/, (match) => `/${match[1]}`],
  // Each policy's version list. React's LegalVersionHistoryPage at
  // /{type}/versions reads the same GET /api/v2/legal/{type}/versions list.
  // Single versions and comparisons stay self-canonical: React shows those
  // inside that one page, not at addresses of their own.
  [/^\/legal\/(terms|privacy|cookies|acceptable-use|community-guidelines)\/versions$/, (match) => `/${match[1]}/versions`],
  [/^\/page\/[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/, null],
  [/^\/blog(\/[A-Za-z0-9_-]+)?$/, null],
  // Public events advertising. React serves both publicly at the same paths
  // (PublicEventsListPage / PublicEventDetailPage, behind the same events +
  // public_events features routes/whats-on.js checks).
  [/^\/whats-on(\/\d+)?$/, null],
  // The platform provider's own legal documents. React serves all three publicly
  // at the same paths (PublicAppRoutes.tsx: PlatformTermsPage, PlatformPrivacyPage,
  // PlatformDisclaimerPage).
  [/^\/platform\/(terms|privacy|disclaimer)$/, null],
  // Partner API developer documentation. React serves all four publicly at the
  // same paths (PublicAppRoutes.tsx: DevelopersHomePage, DevelopersAuthPage,
  // DevelopersEndpointsPage, DevelopersWebhooksPage).
  [/^\/developers(\/(auth|endpoints|webhooks))?$/, null],
  // Timebank Ireland's own content pages. React serves all four publicly at the
  // same paths for the same single community (PublicAppRoutes.tsx, TenantSlugGate
  // slug="hour-timebank"); no other community has the page on either site.
  // /partner is the same, from AppRoutes.tsx (PartnerPage, same gate).
  [/^\/(partner|social-prescribing|impact-summary|impact-report|strategic-plan)$/, null]
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

// Prefixes whose CHILD pages are private while the bare page stays public.
// /verify-certificate/{code} carries one member's certificate code in the
// address (React 5c76c2c2f); the empty verification form stays indexable.
const PRIVATE_CHILD_PREFIXES = [
  '/verify-certificate'
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
  if (PRIVATE_CHILD_PREFIXES.some((prefix) => pathname.startsWith(`${prefix}/`))) {
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
    .replace(/&/g, '\\u0026')
    // Line and paragraph separators are legal in JSON but end a line in older
    // JavaScript parsers; escaped as the blog's own encoder always did.
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/**
 * A page's own text, made fit for <meta name="description">: tags removed,
 * entities decoded (the layout escapes it again), whitespace collapsed, and cut
 * at a word boundary to about `maxLength` characters with an ellipsis. Text with
 * no space to cut at (Japanese) is cut at the limit. '' when nothing is left.
 */
function pageDescription(value, maxLength = 160) {
  if (typeof value !== 'string') return '';
  const plain = value
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body) => {
      if (body[0] === '#') {
        const code = /^#x/i.test(body) ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
      }
      return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
    })
    .replace(/\s+/g, ' ')
    .trim();
  const characters = Array.from(plain);
  if (characters.length <= maxLength) return plain;

  const room = characters.slice(0, maxLength - 1).join('');
  const lastSpace = room.lastIndexOf(' ');
  const cut = lastSpace >= Math.floor(room.length * 0.6) ? room.slice(0, lastSpace) : room;
  return `${cut.replace(/[\s,;:.\-–—]+$/, '')}…`;
}

// Same map as React PageMeta's OG_LOCALES.
const OG_LOCALES = {
  en: 'en_GB', ga: 'ga_IE', de: 'de_DE', fr: 'fr_FR', it: 'it_IT', pt: 'pt_PT',
  es: 'es_ES', nl: 'nl_NL', pl: 'pl_PL', ja: 'ja_JP', ar: 'ar_001'
};

/**
 * Which of the community's two sites search engines should index: 'accessible'
 * only when the community chose it, otherwise 'standard' (absent, empty or any
 * unrecognised value). Same reading as the server's
 * SitemapService::isAccessiblePrimary().
 */
function seoPrimarySite(tenant) {
  const settings = asObject(asObject(tenant).settings);
  return text(settings.seo_primary_site).toLowerCase() === 'accessible' ? 'accessible' : 'standard';
}

function hasCommunityTenant(data) {
  return Boolean(text(data.slug)) && Number(data.id) !== 1;
}

function mainSiteHomeUrl(data, mainBase) {
  return cleanHost(data.domain) ? `${mainBase}/` : mainBase;
}

/**
 * The canonical address of one accessible route: the main site's equal page
 * when MAIN_SITE_PATHS names one, otherwise the accessible address itself
 * (`visiblePath` on this host, query string removed). Always the accessible
 * address when the community made this its primary site (seoPrimarySite).
 */
function canonicalUrlFor({ tenant, routePath, visiblePath, protocol = 'https', host = '', mainFrontendUrl } = {}) {
  const data = asObject(tenant);
  if (seoPrimarySite(data) === 'accessible') {
    return absoluteFromRequestUrl({ protocol, host, visiblePath });
  }
  const mainBase = hasCommunityTenant(data) ? mainSiteBaseUrl(data, mainFrontendUrl) : '';
  const mainPath = mainBase ? mainSitePathFor(routePath) : null;
  if (mainBase && mainPath !== null) {
    return mainPath === '/' ? mainSiteHomeUrl(data, mainBase) : `${mainBase}${mainPath}`;
  }
  return absoluteFromRequestUrl({ protocol, host, visiblePath });
}

/**
 * schema.org BreadcrumbList for `crumbs` ([{ name, url }], home first, this page
 * last). '' unless there are at least two crumbs and every one has a name and an
 * absolute address: a trail with a hole in it is worse than none.
 */
function breadcrumbJsonLd(crumbs) {
  const list = Array.isArray(crumbs) ? crumbs : [];
  if (list.length < 2) return '';
  const items = list.map((crumb, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: plainText(crumb && crumb.name),
    item: httpUrl(crumb && crumb.url)
  }));
  if (items.some((item) => !item.name || !item.item)) return '';
  return toJsonLd({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items });
}

/**
 * Breadcrumbs for a public page, built inside a route: Home, then `trail`
 * ([{ name, path }] of accessible route paths; the last one is this page). Each
 * address is that route's canonical (res.locals.seoUrlFor, set by
 * buildShellLocals), so the trail names the same pages the canonical links do
 * and keeps the community's prefix. The last crumb may carry its own `url`, for a
 * page whose canonical the route overrides.
 */
function breadcrumbJsonLdFor(res, trail) {
  const locals = (res && res.locals) || {};
  if (typeof locals.seoUrlFor !== 'function') return '';
  const t = typeof locals.t === 'function' ? locals.t : (key) => key;
  const crumbs = [{ name: t('nav.home'), path: '/' }, ...(Array.isArray(trail) ? trail : [])];
  return breadcrumbJsonLd(crumbs.map((crumb) => ({
    name: crumb.name,
    url: crumb.url || locals.seoUrlFor(crumb.path)
  })));
}

/** Whole-minute UTC offset of `timeZone` at `instant`, as "+01:00"; null if unknown. */
function zoneOffset(instant, timeZone) {
  try {
    // Machine format, never displayed: read back by part type.
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).formatToParts(instant);
    const get = (type) => Number(parts.find((part) => part.type === type)?.value);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    const minutes = Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
    if (!Number.isFinite(minutes)) return null;
    const sign = minutes < 0 ? '-' : '+';
    const abs = Math.abs(minutes);
    return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  } catch {
    return null;
  }
}

/** Event times are stored in UTC; a value with no zone designator is UTC. */
function parseUtc(value) {
  const raw = text(value);
  if (!raw) return null;
  let iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(iso)) iso = `${iso}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * ISO 8601 in the event's own zone with its offset ("2026-12-14T18:00:00+00:00"),
 * or the calendar date there for an all-day event. UTC ("…Z") when the zone is
 * unknown. The same rules as react-frontend/src/lib/event-structured-data.ts.
 */
function eventDateTime(value, timeZone, allDay = false) {
  const instant = parseUtc(value);
  if (!instant) return undefined;
  const offset = zoneOffset(instant, text(timeZone) || 'UTC');
  if (offset === null) {
    return allDay ? instant.toISOString().slice(0, 10) : instant.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }
  const sign = offset.startsWith('-') ? -1 : 1;
  const [hours, minutes] = offset.slice(1).split(':').map(Number);
  const local = new Date(instant.getTime() + sign * (hours * 60 + minutes) * 60000).toISOString();
  return allDay ? local.slice(0, 10) : `${local.slice(0, 19)}${offset}`;
}

const EVENT_ATTENDANCE_MODE = {
  in_person: 'https://schema.org/OfflineEventAttendanceMode',
  online: 'https://schema.org/OnlineEventAttendanceMode',
  hybrid: 'https://schema.org/MixedEventAttendanceMode'
};

const EVENT_STATUS = {
  cancelled: 'https://schema.org/EventCancelled',
  postponed: 'https://schema.org/EventPostponed'
};

/** Plain text (titles, venues): only the spacing is tidied. */
function plainText(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function isCoordinate(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

/**
 * schema.org Event JSON-LD for a public what's-on page, ported from
 * react-frontend/src/lib/event-structured-data.ts so both frontends describe an
 * event the same way. Every field is valid or left out.
 *
 * '' (no block at all) when the event has no name or start, or is held in person
 * with no venue. Google requires a location and reports an Event without one as
 * an error; a missing block is only a missed enhancement. (React still emits a
 * location-less block in that case.)
 *
 * @param {object} event   the GET /api/v2/public/events/{id} payload
 * @param {object} context { pageUrl, imageUrl, organizer: { name, url } }
 */
function eventJsonLd(event, context = {}) {
  const data = asObject(event);
  const pageUrl = httpUrl(context.pageUrl);
  const name = plainText(data.title);
  const startDate = eventDateTime(data.start_time, data.timezone, Boolean(data.all_day));
  if (!name || !startDate || !pageUrl) return '';

  const mode = EVENT_ATTENDANCE_MODE[data.attendance_mode] ? data.attendance_mode : 'in_person';
  const venue = plainText(data.location);
  if (mode === 'in_person' && !venue) return '';

  const latitude = Number(data.latitude);
  const longitude = Number(data.longitude);
  const hasGeo = isCoordinate(data.latitude) && isCoordinate(data.longitude) && !(latitude === 0 && longitude === 0);
  const place = venue
    ? {
      '@type': 'Place',
      name: venue,
      address: venue,
      ...(hasGeo ? { geo: { '@type': 'GeoCoordinates', latitude, longitude } } : {})
    }
    : null;
  // The joining link is members-only, so the online location is this public
  // page, which is where a visitor learns how to take part.
  const virtual = { '@type': 'VirtualLocation', url: pageUrl };
  const locations = (mode === 'online' ? [virtual] : (mode === 'hybrid' ? [place, virtual] : [place])).filter(Boolean);

  const endDate = eventDateTime(data.end_time, data.timezone, Boolean(data.all_day));
  // Plain text, as the page shows it and as React emits it.
  const description = plainText(data.description);
  const imageUrl = httpUrl(context.imageUrl);
  const organizer = asObject(context.organizer);
  const organizerName = text(organizer.name);
  const organizerUrl = httpUrl(organizer.url);

  return toJsonLd({
    '@context': 'https://schema.org',
    '@type': 'Event',
    name,
    url: pageUrl,
    startDate,
    ...(endDate ? { endDate } : {}),
    eventStatus: EVENT_STATUS[data.operational_status] || 'https://schema.org/EventScheduled',
    eventAttendanceMode: EVENT_ATTENDANCE_MODE[mode],
    location: locations.length === 1 ? locations[0] : locations,
    ...(imageUrl ? { image: [imageUrl] } : {}),
    ...(description ? { description } : {}),
    ...(organizerName && organizerUrl
      ? { organizer: { '@type': 'Organization', name: organizerName, url: organizerUrl } }
      : {})
  });
}

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
  const hasCommunity = hasCommunityTenant(data);

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
  const canonicalUrl = canonicalUrlFor({ tenant: data, routePath, visiblePath, protocol, host, mainFrontendUrl });

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
      url: mainSiteHomeUrl(data, mainBase)
    };
    if (logoImage) org.logo = logoImage;
    if (text(branding.tagline)) org.description = text(branding.tagline);
    if (sameAs.length > 0) org.sameAs = sameAs;
    organizationJsonLd = toJsonLd(org);
  }

  // The community's WebSite, on its home page only, named and addressed as the
  // main site so search engines see one site. No SearchAction: the main site's
  // search needs sign-in, so a search box pointing there would only lead
  // visitors to a sign-in page.
  let websiteJsonLd = '';
  if (isHome && hasCommunity && tenantName && mainBase) {
    websiteJsonLd = toJsonLd({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      '@id': `${mainBase}/#website`,
      name: siteName || tenantName,
      url: mainSiteHomeUrl(data, mainBase),
      publisher: { '@id': `${mainBase}/#org` }
    });
  }

  return {
    seoSiteName: siteName,
    seoHomeTitle: homeTitle,
    seoGoogleVerification: verificationToken(settings.seo_google_verification),
    seoBingVerification: verificationToken(settings.seo_bing_verification),
    seoKeywords: text(settings.seo_meta_keywords),
    seoOrganizationJsonLd: organizationJsonLd,
    seoWebsiteJsonLd: websiteJsonLd,
    // The community's (light-background) logo, absolute: Article publisher logo.
    seoLogoUrl: logoImage || '',
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
 * mount (`/{slug}/accessible/dashboard`).
 *
 * `sitemapUrl` (absolute) adds a Sitemap line. The caller passes it only when
 * the request resolved one community whose accessible sitemap is published
 * (src/lib/accessible-sitemap.js); the shared host's own robots.txt serves many
 * communities and names none.
 */
function buildRobotsTxt({ sitemapUrl = '' } = {}) {
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
  const sitemap = httpUrl(sitemapUrl);
  if (sitemap) {
    lines.push('', `Sitemap: ${sitemap}`);
  }
  return `${lines.join('\n')}\n`;
}

module.exports = {
  verificationToken,
  toJsonLd,
  breadcrumbJsonLd,
  breadcrumbJsonLdFor,
  canonicalUrlFor,
  eventDateTime,
  eventJsonLd,
  pageDescription,
  MAIN_SITE_PATHS,
  NOINDEX,
  PRIVATE_PREFIXES,
  ROBOTS_DISALLOWED,
  buildRobotsTxt,
  buildSeoLocals,
  hasCommunityTenant,
  isPrivatePath,
  mainSiteBaseUrl,
  mainSitePathFor,
  sanitizeRobotsDirective,
  seoPrimarySite
};
