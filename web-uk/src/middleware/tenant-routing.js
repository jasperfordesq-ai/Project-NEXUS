// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const SHARED_MOUNT_RE = /^\/([A-Za-z0-9_-]+)\/(accessible|alpha)(?=\/|$)/;
const UNPREFIXED_PATHS = [
  '/api',
  '/assets',
  '/css',
  '/downloads',
  '/favicon.ico',
  '/health',
  '/js',
  '/manifest.json',
  '/robots.txt',
  '/service-unavailable',
  '/service-worker.js',
  '/session/touch',
  '/sitemap.xml',
  '/uploads',
  '/v2',
  // Deployment identity, used to prove a blue/green cutover switched colour and by
  // the routing-drift check. Must never be tenant-prefixed: the check calls it on a
  // bare hostname, before any tenant is known.
  '/version'
];
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);
const RESERVED_CHILD_SEGMENTS = new Set([
  'about',
  'acceptable-use',
  'accessibility',
  'account-deletion',
  'achievements',
  'activity',
  'admin',
  'admin-legacy',
  'advertise',
  'api',
  'assets',
  'auth',
  'blog',
  'broker',
  'caring',
  'caring-community',
  'changelog',
  'chat',
  'child-safety',
  'classic',
  'clubs',
  'compose',
  'communities',
  'community-groups',
  'community-guidelines',
  'connections',
  'contact',
  'consent',
  'consent-required',
  'cookies',
  'coupons',
  'courses',
  'cron',
  'dashboard',
  'dev',
  'developers',
  'development-status',
  'donations',
  'downloads',
  'events',
  'exchanges',
  'explore',
  'faq',
  'favicon.ico',
  'features',
  'federation',
  'feed',
  'goals',
  'group-exchanges',
  'groups',
  'guide',
  'health',
  'home',
  'help',
  'how-it-works',
  'ideation',
  'impact-report',
  'impact-summary',
  'install-app',
  'join',
  'jobs',
  'kb',
  'leaderboard',
  'legal',
  'linked-accounts',
  'listings',
  'local-groups',
  'login',
  'logout',
  'manifest.json',
  'marketplace',
  'matches',
  'me',
  'members',
  'messages',
  'migrate-messages',
  'mobile',
  'mobile-download',
  'municipality-calendar',
  'newsletter',
  'nexus-score',
  'news',
  'notifications',
  'onboarding',
  'organisations',
  'our-story',
  'page',
  'partner',
  'partner-analytics',
  'partner-timebanks',
  'partner-with-us',
  'password',
  'pilot-apply',
  'pilot-inquiry',
  'polls',
  'podcasts',
  'platform',
  'post',
  'premium',
  'pricing',
  'privacy',
  'profile',
  'proposals',
  'regional-analytics',
  'register',
  'resources',
  'reviews',
  'robots.txt',
  'saved',
  'search',
  'services',
  'service-worker.js',
  'settings',
  'share-target',
  'skills',
  'sitemap.xml',
  'social-prescribing',
  'strategic-plan',
  'super-admin',
  'support-actions',
  'terms',
  'test-email',
  'timebanking-guide',
  'trust-and-safety',
  'uploads',
  'users',
  'v2',
  'verify-email',
  'verify-identity',
  'verify-identity-optional',
  'volunteering',
  'wallet',
  '.well-known'
]);

function withQuery(path, queryIndex, originalUrl) {
  if (queryIndex === -1) return path;
  return `${path}${originalUrl.slice(queryIndex)}`;
}

/**
 * The status code for a permanent redirect, preserving the request method.
 *
 * 🔴 A hardcoded 301 on a non-GET request DROPS THE BODY. Browsers turn a
 * 301/302 on a POST into a GET of the target, so a form submitted from a page
 * rendered before a deploy silently loses everything the member typed and lands
 * on a page that looks like it just did nothing.
 *
 * Laravel already gets this right for the same redirects
 * (`routes/govuk-alpha.php`): 301 for GET/HEAD, 308 otherwise. 308 is the
 * method-preserving permanent redirect, so the POST is replayed against the new
 * URL with its body intact. web-uk hardcoded 301 in both places.
 */
function permanentRedirectStatus(req) {
  const method = String(req.method || 'GET').toUpperCase();
  return method === 'GET' || method === 'HEAD' ? 301 : 308;
}

function splitPathSuffix(value) {
  const match = String(value || '').match(/^([^?#]*)(.*)$/);
  return {
    pathname: match ? match[1] : '',
    suffix: match ? match[2] : ''
  };
}

function shouldPrefixLocalPath(value, prefix) {
  if (!prefix || typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return false;
  }

  const { pathname } = splitPathSuffix(value);
  if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
    return false;
  }

  return !UNPREFIXED_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function prefixLocalPath(value, prefix) {
  if (!shouldPrefixLocalPath(value, prefix)) {
    return value;
  }

  const { pathname, suffix } = splitPathSuffix(value);
  return pathname === '/'
    ? `${prefix}${suffix}`
    : `${prefix}${pathname}${suffix}`;
}

function rewriteHtmlLinks(content, prefix) {
  if (!prefix || typeof content !== 'string' || content === '') {
    return content;
  }

  return content.replace(/\b(href|action)=(["'])(\/[^"']*)\2/g, (match, attribute, quote, value) => {
    return `${attribute}=${quote}${prefixLocalPath(value, prefix)}${quote}`;
  });
}

function looksLikeHtml(content) {
  return /<(?:!doctype|html|head|body|main|form|a)\b/i.test(content);
}

function installSharedMountResponseRewriter(res, prefix) {
  const originalRedirect = res.redirect.bind(res);
  res.redirect = (statusOrUrl, maybeUrl) => {
    if (typeof statusOrUrl === 'number') {
      return originalRedirect(statusOrUrl, prefixLocalPath(maybeUrl, prefix));
    }
    return originalRedirect(prefixLocalPath(statusOrUrl, prefix));
  };

  const originalSend = res.send.bind(res);
  res.send = (body) => {
    const contentType = String(res.get('Content-Type') || '');
    if (typeof body === 'string' && (contentType.includes('text/html') || looksLikeHtml(body))) {
      return originalSend(rewriteHtmlLinks(body, prefix));
    }
    return originalSend(body);
  };
}

function isUnprefixedPath(pathname) {
  return UNPREFIXED_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function normalizeHost(host) {
  const raw = String(host || '').trim().toLowerCase();
  if (!raw) {
    return '';
  }

  const withoutProtocol = raw.replace(/^https?:\/\//, '');
  const withoutPath = withoutProtocol.split('/')[0];
  const withoutPort = withoutPath.startsWith('[')
    ? withoutPath.replace(/^\[|\](?::\d+)?$/g, '')
    : withoutPath.split(':')[0];

  return withoutPort.replace(/^www\./, '');
}

function requestHost(req) {
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  return normalizeHost(forwardedHost || req.hostname || req.headers.host);
}

function shouldResolveCustomAccessibleDomain(host) {
  if (!host || LOCAL_HOSTS.has(host)) {
    return false;
  }

  return !host.endsWith('.localhost');
}

function tenantDataMatchesAccessibleHost(data, host) {
  return data?.slug && normalizeHost(data.accessible_domain) === host;
}

function tenantDataMatchesDomainHost(data, host) {
  return normalizeHost(data?.domain) === host && (data?.slug || Number(data?.id) === 1);
}

function tenantDataMatchesParentHost(data, host) {
  return data?.slug && normalizeHost(data.parent_domain) === host;
}

function firstRoutableSegment(pathname) {
  const segments = String(pathname || '')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
  const first = segments[0] || '';

  if (!first || RESERVED_CHILD_SEGMENTS.has(first.toLowerCase())) {
    return '';
  }

  return first;
}

async function resolveParentDomainChildTenant(req, res, pathname, queryIndex, originalUrl) {
  if (isUnprefixedPath(pathname)) {
    return false;
  }

  const host = requestHost(req);
  if (!shouldResolveCustomAccessibleDomain(host)) {
    return false;
  }

  const childSlug = firstRoutableSegment(pathname);
  if (!childSlug) {
    return false;
  }

  const { ApiError, ApiOfflineError, getTenantBootstrap } = require('../lib/api');

  try {
    const result = await getTenantBootstrap({ slug: childSlug });
    const tenant = result?.data || result?.tenant || result;

    if (!tenantDataMatchesParentHost(tenant, host)) {
      return false;
    }

    const prefix = `/${childSlug}`;
    const rest = pathname.slice(prefix.length) || '/';

    req.accessibleRouting = {
      mode: 'parent-domain-child',
      tenantSlug: tenant.slug,
      tenant,
      prefix,
      routePath: rest
    };
    installSharedMountResponseRewriter(res, prefix);
    req.url = withQuery(rest, queryIndex, originalUrl);

    return true;
  } catch (error) {
    if (error instanceof ApiOfflineError || (error instanceof ApiError && error.status === 404)) {
      return false;
    }

    throw error;
  }
}

async function resolveCustomAccessibleDomain(req, pathname) {
  if (isUnprefixedPath(pathname)) {
    return false;
  }

  const host = requestHost(req);
  if (!shouldResolveCustomAccessibleDomain(host)) {
    return false;
  }

  const { ApiError, ApiOfflineError, getTenantBootstrap } = require('../lib/api');

  try {
    const result = await getTenantBootstrap({ host });
    const tenant = result?.data || result?.tenant || result;

    if (tenantDataMatchesAccessibleHost(tenant, host) || (pathname === '/' && tenantDataMatchesDomainHost(tenant, host))) {
      req.accessibleRouting = {
        mode: 'custom-domain',
        tenantSlug: tenant.slug,
        tenant,
        prefix: '',
        routePath: pathname || '/'
      };
    }

    if (pathname !== '/' && tenantDataMatchesDomainHost(tenant, host)) {
      req.url = REFUSED_PATH;
      return false;
    }

    return false;
  } catch (error) {
    if (error instanceof ApiOfflineError || (error instanceof ApiError && error.status === 404)) {
      return false;
    }

    throw error;
  }
}

async function redirectMatchedCustomDomainMount(req, res, tenantSlug, rest, queryIndex, originalUrl) {
  const host = requestHost(req);
  if (!shouldResolveCustomAccessibleDomain(host)) {
    return false;
  }

  const { ApiError, ApiOfflineError, getTenantBootstrap } = require('../lib/api');

  try {
    const result = await getTenantBootstrap({ host });
    const tenant = result?.data || result?.tenant || result;
    const matchedHost = tenantDataMatchesAccessibleHost(tenant, host);
    const matchedSlug = String(tenant?.slug || '').toLowerCase() === String(tenantSlug || '').toLowerCase();

    if (!matchedHost || !matchedSlug) {
      return false;
    }

    const sluglessPath = rest === '/' ? '/' : rest;
    res.redirect(permanentRedirectStatus(req), withQuery(sluglessPath, queryIndex, originalUrl));
    return true;
  } catch (error) {
    if (error instanceof ApiOfflineError || (error instanceof ApiError && error.status === 404)) {
      return false;
    }

    throw error;
  }
}

/**
 * Resolve the community named by a `/{slug}/accessible/...` URL on the shared host.
 *
 * 🔴 "THIS COMMUNITY DOES NOT EXIST" AND "THE PLATFORM IS UNREACHABLE" ARE NOT THE
 * SAME ANSWER, and treating them as one was a real defect.
 *
 * This function used to catch BOTH an `ApiError` 404 and an `ApiOfflineError` and
 * return a synthetic `{ slug }` — so an unknown slug carried on as though it were a
 * real but empty community, and every page rendered a plausible-looking 200.
 * Measured against production on 2026-08-12: Blade answers
 * `/not-a-real-community/accessible/` with **404**, web-uk answered **200** with a
 * full 24 KB page. No other community's data was exposed — it rendered generic
 * platform chrome — but a member who mistypes an address was told nothing was wrong,
 * and every misspelling became an indexable URL.
 *
 * So the two cases are now separated:
 *
 *   - genuine 404 from the platform ⇒ return `null`, and the caller renders 404,
 *     matching Blade, which is the observable-behaviour specification while Blade
 *     is still deployed.
 *   - platform UNREACHABLE (`ApiOfflineError`) ⇒ keep the previous degraded
 *     behaviour. 🔴 Deliberate: during an outage we must NOT tell members their
 *     community does not exist. That is a false statement about their data, and it
 *     is far worse than a thin page. The pages themselves already degrade.
 *
 * @returns {Promise<object|null>} the tenant, or null when it genuinely does not exist
 */
async function resolveSharedMountTenant(tenantSlug) {
  const { ApiError, ApiOfflineError, getTenantBootstrap } = require('../lib/api');

  try {
    const result = await getTenantBootstrap({ slug: tenantSlug });
    const tenant = result?.data || result?.tenant || result;
    if (tenant && typeof tenant === 'object') {
      return tenant;
    }
    // 🔴 A 200 carrying nothing usable is NOT treated as "no such community", and
    // that restraint is deliberate. Only an explicit 404 from the platform means the
    // community does not exist; an unusable-but-successful response is a transport
    // or shape oddity, and 404ing on it would turn a glitch into "your community
    // does not exist".
    //
    // It also has to stay this way for a concrete reason: the shared-mount path makes
    // TWO bootstrap calls (a host lookup that always misses on the shared host, then
    // the slug lookup), so any caller or fixture that answers only once leaves the
    // second call empty. Being strict here failed 16 existing tests whose mocks are
    // `mockResolvedValueOnce`, none of which describe a missing community.
    return { slug: tenantSlug };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    if (error instanceof ApiOfflineError) {
      // Outage, not a missing community — see the note above. Carries on with just
      // the slug, exactly as before, so pages degrade rather than lying.
      return { slug: tenantSlug };
    }
    throw error;
  }
}

/**
 * 🔴 THE FILE'S OWN IDIOM FOR "REFUSE THIS REQUEST", and the reason to use it rather
 * than send a bespoke 404 here.
 *
 * `resolveCustomAccessibleDomain` already refuses slug-less pages on an ordinary
 * tenant domain by rewriting the URL to a path no router matches, so the request
 * falls through to the app's catch-all and renders the SAME styled "Page not found"
 * page as every other 404. That is better than anything this middleware can render
 * directly, because it runs before the shell middleware and has no `res.locals.t`,
 * no `urlFor` and no tenant branding.
 *
 * An earlier version of this change sent its own minimal HTML body instead, which
 * overrode that styled page and broke the existing test asserting "Page not found".
 * All three refusal paths now share this one constant, so a member cannot tell them
 * apart and there is one place to change the behaviour.
 */
const REFUSED_PATH = '/__accessible-domain-not-found__';

/**
 * On the SHARED platform host, should a slug-less application URL be refused?
 *
 * 🔴 THIS PORTS A LARAVEL GUARD web-uk NEVER HAD. Laravel's
 * `EnsureAccessibleCustomDomain` 404s the slug-less accessible route set on any host
 * that did not resolve via a tenant's `accessible_domain` — see the note at
 * `routes/govuk-alpha.php`. web-uk had no equivalent, so it served the whole route
 * set with NO tenant resolved.
 *
 * Measured against production on 2026-08-12, before cutting the shared host over:
 *
 *     Blade  accessible.project-nexus.ie/listings  →  404
 *     web-uk accessible.project-nexus.ie/listings  →  200, 11,661 bytes
 *
 * Two consequences, neither acceptable on a public host. Every canonical
 * `/{slug}/accessible/...` page gained a slug-less duplicate answering 200. And
 * `tenantFeatureGate` returns `next()` immediately when no tenant is resolved, so on
 * those URLs every module and feature gate was INERT — a community's disabled module
 * was not merely visible, it was unguarded.
 *
 * No data was exposed in the production configuration, because the container sets
 * neither `ACCESSIBLE_TENANT_SLUG` nor `TENANT_ID` (verified), so the API refuses the
 * request and pages render empty. That is luck, not design: `web-uk/.env.docker` DOES
 * set both for local development, and any deployment inheriting those values would
 * have served one community's data at slug-less URLs on the shared host.
 *
 * 🔴 The exemptions are the whole difficulty, so each is deliberate:
 *   - the bare root renders the tenant chooser, which is the one correct slug-less
 *     page on this host;
 *   - system paths (`/version`, `/health`, `/assets`, …) must answer before any
 *     tenant is known — the deploy's drift check calls `/version` on a bare hostname;
 *   - a configured single-tenant fallback keeps LOCAL DEVELOPMENT working, where the
 *     app is browsed slug-less on localhost:5180 with `ACCESSIBLE_TENANT_SLUG` set;
 *   - local hosts are exempt outright for the same reason.
 *
 * A custom accessible domain is unaffected: it resolves a tenant, so this branch is
 * never reached for it.
 */
function deniesSluglessRouteSet(req, pathname) {
  if (pathname === '/') return false;
  if (isUnprefixedPath(pathname)) return false;

  // 🔴 SCOPED TO THE SHARED PLATFORM HOST(S) ONLY, and the narrowing is deliberate.
  //
  // The first version refused slug-less paths on ANY non-local host that resolved no
  // tenant. That is arguably right in principle — serving the app with no tenant
  // means every feature gate is inert — but it changed behaviour for every host at
  // once, and it broke a test asserting the Laravel-compatible Blog RSS contract
  // served slug-less on an arbitrary host. Days before a cutover is the wrong moment
  // to widen a behavioural change beyond the defect actually measured.
  //
  // What WAS measured, on production 2026-08-12:
  //     Blade  accessible.project-nexus.ie/listings  →  404
  //     web-uk accessible.project-nexus.ie/listings  →  200
  // So the guard applies to that host, matching Blade there, and leaves every other
  // host exactly as it was. Broadening it to all unresolved hosts is a separate,
  // reviewable change.
  const host = requestHost(req);
  if (!platformAccessibleHosts().includes(host)) return false;

  // Keeps LOCAL DEVELOPMENT and any single-tenant deployment working: the app is
  // browsed slug-less there with ACCESSIBLE_TENANT_SLUG set (web-uk/.env.docker).
  const configuredFallback = String(process.env.ACCESSIBLE_TENANT_SLUG || '').trim()
    || String(process.env.TENANT_ID || '').trim();
  if (configuredFallback) return false;

  return true;
}

/**
 * The shared platform accessible host(s) — the ones that serve `/{slug}/accessible`
 * rather than a single community's own domain.
 *
 * Overridable so this is not a hostname buried in code, but defaulted so the guard
 * is active in production without needing a new environment variable to be set
 * (an unset variable silently disabling a guard is the failure mode this codebase
 * keeps finding). Laravel hardcodes the same host in
 * `TenantHierarchyService::isReservedPlatformHost()`, which is what guarantees no
 * community can ever claim it as their own domain.
 */
function platformAccessibleHosts() {
  const configured = String(process.env.PLATFORM_ACCESSIBLE_HOSTS || '').trim();
  const raw = configured || 'accessible.project-nexus.ie';
  return raw.split(',').map((entry) => normalizeHost(entry)).filter(Boolean);
}

function tenantRouting(req, res, next) {
  const originalUrl = req.url || '/';
  const queryIndex = originalUrl.indexOf('?');
  const pathname = queryIndex === -1 ? originalUrl : originalUrl.slice(0, queryIndex);
  const match = pathname.match(SHARED_MOUNT_RE);

  if (!match) {
    resolveParentDomainChildTenant(req, res, pathname, queryIndex, originalUrl)
      .then((matchedParentChild) => {
        if (matchedParentChild) {
          return;
        }

        return resolveCustomAccessibleDomain(req, pathname);
      })
      .then((handled) => {
        if (!handled) {
          // 🔴 Gate on `req.accessibleRouting`, NOT on `handled`.
          //
          // `handled` is falsy in two very different situations. When
          // `resolveParentDomainChildTenant` MATCHES it returns early, so this
          // callback receives `undefined` — and the original code correctly called
          // next() for that case, because routing had already been set up. Reading
          // that as "nothing resolved" made this guard refuse requests that had
          // resolved a community perfectly well: it broke 7 existing tests covering
          // custom-domain and parent-domain child serving.
          //
          // `req.accessibleRouting` is the unambiguous signal: any resolver that
          // succeeded has set it.
          if (!req.accessibleRouting && deniesSluglessRouteSet(req, pathname)) {
            req.url = REFUSED_PATH;
          }
          next();
        }
      })
      .catch(next);
    return;
  }

  const [, tenantSlug, mount] = match;
  const rest = pathname.slice(match[0].length) || '/';
  const accessiblePrefix = `/${tenantSlug}/accessible`;

  redirectMatchedCustomDomainMount(req, res, tenantSlug, rest, queryIndex, originalUrl)
    .then((redirected) => {
      if (redirected) {
        return;
      }

      if (mount === 'alpha') {
        res.redirect(permanentRedirectStatus(req), withQuery(`${accessiblePrefix}${rest === '/' ? '' : rest}`, queryIndex, originalUrl));
        return;
      }

      return resolveSharedMountTenant(tenantSlug);
    })
    .then((tenant) => {
      // 🔴 A RESPONSE THAT HAS ALREADY BEEN SENT IS NOT "no such community".
      //
      // Two branches above answer the request and then `return` — the custom-domain
      // mount redirect and the legacy `/alpha/` redirect. Both hand `undefined` to
      // this callback, which is falsy, so reading falsy as "the community does not
      // exist" ran the refusal path on a request that was already finished: it set
      // req.url and called next(), the chain carried on, and helmet threw
      // ERR_HTTP_HEADERS_SENT trying to add a CSP header to a sent response.
      //
      // This was observed in production within minutes of the 2026-08-12 cutover, on
      // GET /hour-timebank/alpha/ — i.e. on the legacy-bookmark path. The redirect
      // itself was still delivered correctly, so members were not broken, but every
      // old bookmark raised an application error.
      //
      // It is the SAME mistake as the one documented in the !match branch above
      // (gating on a falsy `handled` that also means "already succeeded"), made a
      // second time in the sibling branch. The reliable signal differs per branch:
      // there it is req.accessibleRouting, here it is res.headersSent.
      if (res.headersSent) {
        return;
      }

      if (!tenant) {
        // 🔴 The community named in the URL does not exist ⇒ 404, matching Blade.
        //
        // This branch previously did a bare `return`: no response and no next(), so
        // the request would have HUNG rather than answering. It was unreachable
        // before, because resolveSharedMountTenant() always returned a synthetic
        // tenant; now that it can report "no such community", this must actually
        // answer.
        //
        // Refused via REFUSED_PATH rather than a bespoke body, so this renders the
        // same styled "Page not found" page as every other refusal — see the note on
        // that constant.
        req.url = REFUSED_PATH;
        next();
        return;
      }

      req.accessibleRouting = {
        mode: 'shared',
        tenantSlug: tenant.slug || tenantSlug,
        tenant,
        prefix: accessiblePrefix,
        routePath: rest
      };
      installSharedMountResponseRewriter(res, accessiblePrefix);
      req.url = withQuery(rest, queryIndex, originalUrl);

      next();
    })
    .catch(next);
}

module.exports = {
  prefixLocalPath,
  reservedChildSegments: Array.from(RESERVED_CHILD_SEGMENTS),
  rewriteHtmlLinks,
  tenantRouting
};
