// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 WHY THIS FILE EXISTS.
 *
 * On the shared accessible host, a URL names its community in the path:
 * `/{slug}/accessible/...`. `resolveSharedMountTenant()` caught BOTH "the platform
 * says no such community" (404) and "the platform is unreachable"
 * (`ApiOfflineError`) and returned a synthetic `{ slug }` for both — so an unknown
 * slug carried on as though it were a real but empty community.
 *
 * Measured against production on 2026-08-12, immediately before cutting
 * `accessible.project-nexus.ie` over to web-uk:
 *
 *     Blade  /not-a-real-community/accessible/  →  404  (73 bytes)
 *     web-uk /not-a-real-community/accessible/  →  200  (24,159 bytes, full page)
 *
 * No other community's data was exposed — it rendered generic platform chrome — but
 * a member who mistyped an address was told nothing was wrong, and every misspelling
 * became an indexable 200. Blade is the observable-behaviour specification while it
 * is still deployed, so this was a real regression and it would have shipped with
 * the cutover.
 *
 * 🔴 The two error cases must stay SEPARATE, which is the whole point of the fix and
 * the reason this file tests three cases rather than one. During a platform outage
 * web-uk must NOT tell members their community does not exist: that is a false
 * statement about their data and worse than a thin page. The offline case therefore
 * still degrades rather than 404ing, and there is a test below that fails if someone
 * "simplifies" the two branches back together.
 */

const express = require('express');
const request = require('supertest');

class MockApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}
class MockApiOfflineError extends Error {
  constructor(message = 'Unable to connect') {
    super(message);
    this.name = 'ApiOfflineError';
    this.status = 503;
  }
}

const mockGetTenantBootstrap = jest.fn();

jest.mock('../src/lib/api', () => ({
  ApiError: MockApiError,
  ApiOfflineError: MockApiOfflineError,
  getTenantBootstrap: (...args) => mockGetTenantBootstrap(...args),
}));

const { tenantRouting } = require('../src/middleware/tenant-routing');

/**
 * The middleware plus a terminal handler standing in for the rest of the app, so a
 * request that gets THROUGH is visibly different from one that is refused.
 */
function buildApp() {
  const app = express();
  app.use(tenantRouting);
  app.use((req, res) => {
    res.status(200).json({
      reached: true,
      rewrittenUrl: req.url,
      tenantSlug: req.accessibleRouting?.tenantSlug ?? null,
      prefix: req.accessibleRouting?.prefix ?? null,
    });
  });
  return app;
}

beforeEach(() => {
  mockGetTenantBootstrap.mockReset();
});

describe('a community that does not exist', () => {
  it('answers 404 rather than rendering a plausible page', async () => {
    mockGetTenantBootstrap.mockRejectedValue(new MockApiError('Not found', 404));

    const response = await request(buildApp()).get('/not-a-real-community/accessible/');

    // Refused: the URL is rewritten to the path no router matches, which the app's
    // catch-all renders as the styled "Page not found" page.
    expect(response.body.rewrittenUrl).toBe('/__accessible-domain-not-found__');
    // And no synthetic community was invented for it.
    expect(response.body.tenantSlug).toBeNull();
  });

  it('answers 404 for a deeper path under the unknown community too', async () => {
    mockGetTenantBootstrap.mockRejectedValue(new MockApiError('Not found', 404));

    const response = await request(buildApp()).get('/nope/accessible/listings');

    expect(response.body.rewrittenUrl).toBe('/__accessible-domain-not-found__');
  });

  it('does NOT 404 on a successful-but-unusable response', async () => {
    // 🔴 Deliberate restraint. Only an EXPLICIT 404 means "no such community". An
    // unusable 200 is a transport or shape oddity, and 404ing on it would turn a
    // glitch into "your community does not exist".
    //
    // It also must not 404 for a mechanical reason: the shared-mount path makes two
    // bootstrap calls (a host lookup that always misses here, then the slug lookup),
    // so a caller answering only once leaves the second empty. Being strict here
    // failed 16 existing tests whose fixtures use mockResolvedValueOnce.
    mockGetTenantBootstrap.mockResolvedValue(null);

    const response = await request(buildApp()).get('/empty/accessible/');

    expect(response.status).toBe(200);
  });

  it('does not hang', async () => {
    // 🔴 The `if (!tenant) return;` branch used to do a bare return: no response and
    // no next(), so the request would have hung rather than answering. It was
    // unreachable before this fix, and would have become a hang the moment the
    // resolver learned to report a missing community.
    mockGetTenantBootstrap.mockRejectedValue(new MockApiError('Not found', 404));

    const response = await request(buildApp()).get('/ghost/accessible/');

    expect(response.body.rewrittenUrl).toBe('/__accessible-domain-not-found__');
    expect(response.body.tenantSlug).toBeNull();
  });
});

describe('a community that DOES exist still works', () => {
  it('passes the request through with the slug stripped and recorded', async () => {
    // The control. Without this, "always 404" would satisfy every test above.
    mockGetTenantBootstrap.mockResolvedValue({
      data: { id: 2, slug: 'hour-timebank', name: 'Hour Timebank' },
    });

    const response = await request(buildApp()).get('/hour-timebank/accessible/listings');

    expect(response.status).toBe(200);
    expect(response.body.reached).toBe(true);
    expect(response.body.tenantSlug).toBe('hour-timebank');
    // The slug prefix is stripped for the routers and remembered for link building.
    expect(response.body.rewrittenUrl).toBe('/listings');
    expect(response.body.prefix).toBe('/hour-timebank/accessible');
  });
});

describe('🔴 a platform OUTAGE must not be reported as a missing community', () => {
  it('lets the request through when the platform is unreachable', async () => {
    // Telling a member "your community does not exist" during an outage is a false
    // statement about their data, and worse than a degraded page. If someone merges
    // the 404 and offline branches back together, this test fails.
    mockGetTenantBootstrap.mockRejectedValue(new MockApiOfflineError());

    const response = await request(buildApp()).get('/hour-timebank/accessible/');

    expect(response.status).toBe(200);
    expect(response.body.reached).toBe(true);
    expect(response.body.tenantSlug).toBe('hour-timebank');
  });

  it('still surfaces an unexpected error rather than swallowing it', async () => {
    // Anything that is neither "missing" nor "offline" must propagate, so a genuine
    // fault is not quietly turned into a 404 or a thin page.
    mockGetTenantBootstrap.mockRejectedValue(new Error('kaboom'));

    const response = await request(buildApp()).get('/hour-timebank/accessible/');

    expect(response.status).toBeGreaterThanOrEqual(500);
  });
});

describe('legacy /alpha/ URLs are unaffected by the change', () => {
  it('redirects before any tenant lookup happens', async () => {
    // The redirect runs ahead of resolution, so a bookmark keeps working even for a
    // community that no longer exists — and no needless API call is made.
    const response = await request(buildApp()).get('/hour-timebank/alpha/listings');

    expect(response.status).toBe(301);
    expect(response.headers.location).toBe('/hour-timebank/accessible/listings');
    expect(mockGetTenantBootstrap).not.toHaveBeenCalled();
  });
});

describe('🔴 the slug-less route set is refused on the SHARED platform host', () => {
  /**
   * Ports Laravel's `EnsureAccessibleCustomDomain`. Laravel 404s the slug-less
   * accessible routes on any host that did not resolve via a tenant's
   * accessible_domain; web-uk served them with NO tenant, which also made every
   * feature gate inert (`tenantFeatureGate` returns next() when no tenant exists).
   *
   * Measured on production 2026-08-12: Blade 404, web-uk 200 with 11,661 bytes.
   */
  const realSlug = process.env.ACCESSIBLE_TENANT_SLUG;
  const realTenantId = process.env.TENANT_ID;

  beforeEach(() => {
    // The shared host has no single-tenant fallback configured, unlike local dev.
    delete process.env.ACCESSIBLE_TENANT_SLUG;
    delete process.env.TENANT_ID;
  });

  afterAll(() => {
    if (realSlug !== undefined) process.env.ACCESSIBLE_TENANT_SLUG = realSlug;
    if (realTenantId !== undefined) process.env.TENANT_ID = realTenantId;
  });

  function get(path) {
    return request(buildApp()).get(path).set('Host', 'accessible.project-nexus.ie');
  }

  it('404s an application path with no community in the URL', async () => {
    const response = await get('/listings');
    expect(response.body.rewrittenUrl).toBe('/__accessible-domain-not-found__');
    expect(response.body.rewrittenUrl).toBe('/__accessible-domain-not-found__');
  });

  it('404s other slug-less application paths too', async () => {
    for (const path of ['/events', '/members', '/wallet', '/messages']) {
      const response = await get(path);
      expect(response.body.rewrittenUrl).toBe('/__accessible-domain-not-found__');
    }
  });

  it('still serves the bare root, which is the tenant chooser', async () => {
    // The one legitimately slug-less page on this host. If this 404s, the shared
    // host has no landing page at all.
    const response = await get('/');
    expect(response.status).toBe(200);
    expect(response.body.reached).toBe(true);
  });

  it('still serves system paths before any tenant is known', async () => {
    // /version is called by the deploy's routing-drift check on a BARE hostname,
    // before any tenant exists. 404ing it would break cutover verification itself.
    for (const path of ['/version', '/health', '/assets/x.css', '/css/main.css', '/js/init.js']) {
      const response = await get(path);
      expect(response.status).toBe(200);
    }
  });

  it('does NOT refuse when a single-tenant fallback is configured (local dev)', async () => {
    // web-uk/.env.docker sets ACCESSIBLE_TENANT_SLUG, and the app is browsed
    // slug-less on localhost in development. This guard must not break that.
    process.env.ACCESSIBLE_TENANT_SLUG = 'hour-timebank';
    const response = await get('/listings');
    expect(response.status).toBe(200);
  });

  it('does NOT refuse on a local host', async () => {
    const response = await request(buildApp()).get('/listings').set('Host', 'localhost:5180');
    expect(response.status).toBe(200);
  });
});
