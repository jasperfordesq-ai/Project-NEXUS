// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * The accessible site's own sitemap (GET /sitemap.xml on every accessible host
 * and mount), and the Sitemap line in robots.txt that names it.
 *
 * WHAT IT LISTS depends on the community's settings.seo_primary_site
 * (src/lib/seo-meta.js seoPrimarySite):
 *
 *   - 'standard' (default): the main (React) site is the one search engines
 *     index, and most public accessible pages canonicalise to it. Only the
 *     public pages that are self-canonical here are listed — changelog release
 *     pages and single legal versions, which the main site has no address for.
 *   - 'accessible': this is the indexed site, every public page is
 *     self-canonical, and every public signed-out page is listed.
 *
 * 🔴 The rule that keeps it honest: an address is listed only if its canonical
 * (canonicalUrlFor, the same function that writes <link rel="canonical">) is the
 * address itself, it is not a private path (isPrivatePath, the noindex rule), and
 * every module/feature gate on its route is open (FEATURE_ROUTE_GATES, the same
 * table the router enforces). A sitemap that names a page the page itself
 * disowns, or one that answers 403/404, is worse than no sitemap.
 *
 * NOT PUBLISHED (404 with an empty urlset, as the main sitemap does) when the
 * community's robots directive contains noindex, its "Automatic sitemap" switch
 * (settings.seo_auto_sitemap) is off, or no community was resolved.
 *
 * Cached in memory per community, mode and address for ten minutes (the shared
 * lib/cache.js store, like the bootstrap cache). A failed upstream read is never
 * cached: the response is a 503 so a crawler retries rather than dropping pages.
 */

const api = require('./api');
const { cache } = require('./cache');
const { listReleases } = require('./changelog');
const { flagEnabled } = require('./accessible-shell');
const { AUDIENCES, audiencePath, gateContext, helpPath, visibleSections } = require('./help-guides');
const { TBI_PAGE_PATHS, isTbiTenant } = require('./tbi-pages');
const { runWithRequestTenant } = require('./request-tenant-context');
const {
  buildRobotsTxt,
  canonicalUrlFor,
  hasCommunityTenant,
  isPrivatePath,
  sanitizeRobotsDirective,
  seoPrimarySite
} = require('./seo-meta');
const { routeGatesForPath } = require('../middleware/tenant-feature-gates');
const {
  prefixLocalPath,
  requestHost,
  resolveAccessibleDomainTenant
} = require('../middleware/tenant-routing');

const CACHE_TTL_MS = 10 * 60 * 1000;
const PAGE_SIZE = 50;
// Upper bound on API pages read per collection (blog posts, events): 1,000
// entries, far beyond any community today, and it keeps a single generation
// bounded if an upstream cursor never ends.
const MAX_PAGES = 20;

// Public signed-out pages, as accessible route paths. Each was checked against
// its route (public-info.js, support.js, contact-support.js, legal.js) to answer
// a signed-out visitor with 200. /terms and /privacy are left out: they are 301
// redirects to /legal/terms and /legal/privacy.
const STATIC_PUBLIC_PATHS = [
  '/',
  '/about',
  '/guide',
  '/faq',
  '/features',
  '/changelog',
  '/contact',
  '/help',
  '/trust-and-safety',
  '/accessibility',
  '/legal',
  '/account-deletion',
  '/child-safety',
  // The platform provider's own legal documents (routes/legal.js), public.
  '/platform/terms',
  '/platform/privacy',
  '/platform/disclaimer',
  // Partner API developer documentation (routes/developers.js), public.
  '/developers',
  '/developers/auth',
  '/developers/endpoints',
  '/developers/webhooks'
];

// Legal document type → its URL segment under /legal (legal.js DOCUMENT_PATHS).
const LEGAL_DOCUMENTS = [
  ['terms', 'terms'],
  ['privacy', 'privacy'],
  ['cookies', 'cookies'],
  ['community_guidelines', 'community-guidelines'],
  ['acceptable_use', 'acceptable-use']
];

const EMPTY_URLSET = '<?xml version="1.0" encoding="UTF-8"?>\n'
  + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n';

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return typeof value === 'string' ? value.trim() : (typeof value === 'number' ? String(value) : '');
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** W3C date (YYYY-MM-DD) for <lastmod>, or '' when the value is not a date. */
function lastmodFrom(...values) {
  for (const value of values) {
    const raw = text(value);
    if (!raw) continue;
    const date = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  return '';
}

/** Same reading as seo-meta's boolSetting: absent or unrecognised ⇒ on. */
function sitemapSwitchOn(settings) {
  const value = settings.seo_auto_sitemap;
  if (value === undefined || value === null || value === '') return true;
  if (typeof value === 'boolean') return value;
  return !(value === '0' || value === 'false' || value === 0);
}

/**
 * Whether this community's accessible sitemap is published at all. A community
 * that is not resolved, the master tenant, a noindex community, or one that
 * switched its automatic sitemap off has none.
 */
function sitemapPublished(tenant) {
  const data = asObject(tenant);
  if (!hasCommunityTenant(data) || !(Number(data.id) > 0)) return false;
  if (sanitizeRobotsDirective(asObject(data.seo).robots_directive).includes('noindex')) return false;
  return sitemapSwitchOn(asObject(data.settings));
}

/** Every module/feature gate on this route path is open for the community. */
function routeOpen(tenant, routePath) {
  return routeGatesForPath(routePath).every((gate) => (
    (!gate.moduleKey || flagEnabled(tenant, gate.moduleKey, 'modules', true))
    && (!gate.featureKey || flagEnabled(tenant, gate.featureKey, 'features', true))
  ));
}

/** As routes/whats-on.js whatsOnEnabled(): events AND public_events. */
function whatsOnOpen(tenant) {
  return flagEnabled(tenant, 'events', 'features', true)
    && flagEnabled(tenant, 'public_events', 'features', true);
}

/** A 404 (or 403) from a collection means "nothing to list", not a fault. */
function isAbsent(error) {
  return error instanceof api.ApiError && (error.status === 404 || error.status === 403);
}

async function cursorPages(fetchPage, readPage) {
  const items = [];
  let cursor = '';
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { rows, nextCursor } = readPage(await fetchPage(cursor));
    items.push(...rows);
    if (!nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
  }
  return items;
}

async function blogEntries() {
  try {
    const posts = await cursorPages(
      (cursor) => api.getBlogPosts('', { per_page: PAGE_SIZE, ...(cursor ? { cursor } : {}) }),
      (result) => {
        const data = result && Object.prototype.hasOwnProperty.call(result, 'data') ? result.data : result;
        const payload = asObject(data);
        const more = Boolean(payload.has_more || payload.hasMore);
        return {
          rows: asList(payload.items || data),
          nextCursor: more ? text(payload.cursor || payload.next_cursor || payload.nextCursor) : ''
        };
      }
    );
    return posts
      .map((post) => ({ slug: text(asObject(post).slug), post: asObject(post) }))
      .filter(({ slug }) => /^[A-Za-z0-9_-]+$/.test(slug))
      .map(({ slug, post }) => ({
        path: `/blog/${slug}`,
        lastmod: lastmodFrom(post.updated_at, post.published_at, post.created_at)
      }));
  } catch (error) {
    if (isAbsent(error)) return [];
    throw error;
  }
}

async function eventEntries() {
  try {
    const events = await cursorPages(
      (cursor) => api.getPublicEvents({ per_page: PAGE_SIZE, when: 'upcoming', ...(cursor ? { cursor } : {}) }),
      (result) => {
        const meta = asObject(result && result.meta);
        return {
          rows: asList(result && result.data),
          nextCursor: meta.has_more ? text(meta.cursor) : ''
        };
      }
    );
    return events
      .map((event) => asObject(event))
      .filter((event) => /^\d+$/.test(text(event.id)))
      .map((event) => ({ path: `/whats-on/${text(event.id)}`, lastmod: lastmodFrom(event.updated_at) }));
  } catch (error) {
    if (isAbsent(error)) return [];
    throw error;
  }
}

async function legalEntries(mode) {
  const entries = [];
  for (const [type, segment] of LEGAL_DOCUMENTS) {
    if (mode === 'accessible') entries.push({ path: `/legal/${segment}` });

    let versions = [];
    try {
      const result = await api.getLegalVersions(type);
      const payload = asObject(result && Object.prototype.hasOwnProperty.call(result, 'data') ? result.data : result);
      versions = asList(payload.versions);
    } catch (error) {
      if (!isAbsent(error)) throw error;
    }
    const rows = versions
      .map((row) => asObject(row))
      .filter((row) => /^\d+$/.test(text(row.id)));
    // The version list only where there is something on it; the comparison
    // page is left out (it needs ?v1=&v2= and its canonical drops the query).
    if (mode === 'accessible' && rows.length > 0) entries.push({ path: `/legal/${segment}/versions` });
    for (const row of rows) {
      entries.push({
        path: `/legal/${segment}/versions/${text(row.id)}`,
        lastmod: lastmodFrom(row.effective_date, row.published_at)
      });
    }
  }
  return entries;
}

/**
 * The Help Centre guide pages routes/support.js serves to a signed-out visitor:
 * each audience page, and every section and article whose module/feature gate
 * is open for this community. Signed out, the route has no community settings
 * (helpSettings returns {}), so neither does this; the gates are the same
 * visibleSections() the route uses, so a listed guide never answers 404.
 */
function helpGuideEntries(tenant) {
  const ctx = gateContext(tenant, {});
  const entries = [];
  for (const audience of AUDIENCES) {
    const sections = visibleSections(audience, ctx);
    if (sections.length === 0) continue;
    if (audience !== 'members') entries.push({ path: audiencePath(audience) });
    for (const section of sections) {
      entries.push({ path: helpPath(audience, section.id) });
      for (const article of section.articles) {
        entries.push({ path: helpPath(audience, section.id, article.id) });
      }
    }
  }
  return entries;
}

function changelogEntries() {
  return asList(listReleases())
    .filter((release) => release && !release.isUnreleased && /^[A-Za-z0-9._-]+$/.test(text(release.slug)))
    .map((release) => ({ path: `/changelog/${release.slug}`, lastmod: lastmodFrom(release.date) }));
}

/**
 * The candidate route paths for this community in this mode, before the
 * canonical/private/gate filter. In 'standard' mode the blog, what's-on and
 * static pages are not even fetched: they all canonicalise to the main site.
 */
async function candidateEntries(tenant, mode) {
  const entries = [];
  if (mode === 'accessible') {
    entries.push(...STATIC_PUBLIC_PATHS.map((path) => ({ path })));
    // One community's own content pages (routes/tbi-pages.js): every other
    // community answers 404 at these paths, so they are listed for it alone.
    if (isTbiTenant(tenant)) entries.push(...TBI_PAGE_PATHS.map((path) => ({ path })));
    entries.push(...helpGuideEntries(tenant));
    if (routeOpen(tenant, '/blog')) {
      entries.push({ path: '/blog' }, ...(await blogEntries()));
    }
    if (whatsOnOpen(tenant)) {
      entries.push({ path: '/whats-on' }, ...(await eventEntries()));
    }
  }
  entries.push(...changelogEntries());
  entries.push(...(await legalEntries(mode)));
  return entries;
}

/**
 * @param {object} options
 * @param {object} options.tenant   routed tenant bootstrap
 * @param {string} options.protocol 'https' | 'http'
 * @param {string} options.host     public host of the request
 * @param {string} options.prefix   accessible mount prefix ('' on a community's
 *                                  own accessible domain, '/{slug}/accessible'
 *                                  on the shared host)
 * @returns {Promise<string>} the urlset XML
 */
async function buildSitemapXml({ tenant, protocol, host, prefix = '' }) {
  const data = asObject(tenant);
  const mode = seoPrimarySite(data);
  const seen = new Set();
  const urls = [];

  for (const entry of await candidateEntries(data, mode)) {
    const routePath = entry.path;
    if (isPrivatePath(routePath) || !routeOpen(data, routePath)) continue;
    const visiblePath = prefixLocalPath(routePath, prefix);
    const self = canonicalUrlFor({ tenant: { ...data, settings: { ...asObject(data.settings), seo_primary_site: 'accessible' } }, routePath, visiblePath, protocol, host });
    const canonical = canonicalUrlFor({ tenant: data, routePath, visiblePath, protocol, host });
    if (!self || canonical !== self || seen.has(self)) continue;
    seen.add(self);
    urls.push({ loc: self, lastmod: entry.lastmod || '' });
  }

  const body = urls
    .map(({ loc, lastmod }) => `  <url><loc>${xmlEscape(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`)
    .join('\n');
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + (body ? `${body}\n` : '')
    + '</urlset>\n';
}

/**
 * The community this request addresses and the mount it came through: the
 * routed tenant (shared mount or a hub's child path), else the community whose
 * own accessible domain this is. null when none.
 */
async function requestCommunity(req) {
  if (req.accessibleRouting && req.accessibleRouting.tenant && typeof req.accessibleRouting.tenant === 'object') {
    return { tenant: req.accessibleRouting.tenant, prefix: req.accessibleRouting.prefix || '' };
  }
  const tenant = await resolveAccessibleDomainTenant(req);
  return tenant ? { tenant, prefix: '' } : null;
}

function requestProtocol(req) {
  return process.env.NODE_ENV === 'production' ? 'https' : (req.protocol || 'https');
}

function sendXml(res, status, xml, cacheControl) {
  res.status(status);
  res.set('Content-Type', 'application/xml; charset=UTF-8');
  res.set('Cache-Control', cacheControl);
  res.set('X-Robots-Tag', 'noindex');
  return res.send(xml);
}

async function sitemapRoute(req, res, next) {
  try {
    const community = await requestCommunity(req);
    if (!community || !sitemapPublished(community.tenant)) {
      return sendXml(res, 404, EMPTY_URLSET, 'public, max-age=600');
    }

    const { tenant, prefix } = community;
    const protocol = requestProtocol(req);
    const host = requestHost(req);
    const mode = seoPrimarySite(tenant);
    const key = `accessible-sitemap:${Number(tenant.id)}:${mode}:${protocol}://${host}${prefix}`;

    let xml = cache.get(key);
    if (xml === undefined) {
      try {
        xml = await runWithRequestTenant(tenant.slug, () => buildSitemapXml({ tenant, protocol, host, prefix }));
      } catch {
        // An upstream read failed (offline, 5xx): say so, and cache nothing, so
        // a crawler retries rather than dropping the pages it could not see.
        res.set('Retry-After', '600');
        return sendXml(res, 503, EMPTY_URLSET, 'no-store');
      }
      cache.set(key, xml, CACHE_TTL_MS);
    }
    return sendXml(res, 200, xml, 'public, max-age=600');
  } catch (error) {
    return next(error);
  }
}

/**
 * robots.txt. Names this community's accessible sitemap (absolute, on the
 * requesting host and mount) when one is published. Never fails: a lookup
 * fault only drops the Sitemap line, because robots.txt must always answer.
 */
async function robotsRoute(req, res) {
  let sitemapUrl = '';
  try {
    const community = await requestCommunity(req);
    if (community && sitemapPublished(community.tenant)) {
      sitemapUrl = `${requestProtocol(req)}://${requestHost(req)}${community.prefix}/sitemap.xml`;
    }
  } catch {
    sitemapUrl = '';
  }
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('text/plain').send(buildRobotsTxt({ sitemapUrl }));
}

module.exports = {
  EMPTY_URLSET,
  buildSitemapXml,
  robotsRoute,
  sitemapPublished,
  sitemapRoute
};
