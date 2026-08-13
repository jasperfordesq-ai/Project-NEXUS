// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A signed-in member must not be served member-private pages under ANOTHER community's
 * URL prefix.
 *
 * 🔴 Found by running two synthetic communities against one Laravel. A member of
 * community A requesting `/community-b/accessible/dashboard` received a 200 whose
 * content was their OWN community-A data — the API resolves the member from the token,
 * not from the URL, so nothing leaked. The defect is that the page rendered at all: it
 * showed one community in the address and another's data in the body, and every link on
 * it carried the foreign prefix, so the member stayed in that hybrid state.
 */

jest.mock('../src/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  },
  ApiOfflineError: class ApiOfflineError extends Error {},
  refreshToken: jest.fn(),
  invalidateUserCache: jest.fn(),
  getTenantBootstrap: jest.fn()
}));

const { requireAuth } = require('../src/middleware/auth');

/**
 * A token with a far-future expiry, so `ensureAuthSession` treats the session as live
 * and does not try to refresh it. Not a real credential — the signature is not checked.
 */
function futureToken() {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64url');
  return `header.${payload}.signature`;
}

function createRequest({ routedSlug, sessionSlug, routePath = '/dashboard', prefix = null, mode = 'shared' }) {
  return {
    path: routePath,
    signedCookies: {
      token: futureToken(),
      ...(sessionSlug ? { tenant_slug: sessionSlug } : {})
    },
    accessibleRouting: routedSlug
      ? {
        mode,
        tenantSlug: routedSlug,
        prefix: prefix === null ? `/${routedSlug}/accessible` : prefix,
        routePath
      }
      : undefined
  };
}

function createResponse() {
  const state = { status: null, location: null, ended: false, redirectedVia: null };
  const res = {
    locals: {},
    status(code) {
      state.status = code;
      return res;
    },
    location(value) {
      state.location = value;
      return res;
    },
    end() {
      state.ended = true;
      return res;
    },
    // 🔴 On a shared mount, tenant routing REPLACES res.redirect with a wrapper that
    // prefixes local paths with the current mount. Modelled here so the test would catch
    // the double-prefixing this fix produced on its first attempt
    // (/community-b/accessible/community-a/accessible/dashboard).
    redirect(value) {
      state.redirectedVia = `${res.locals.__mountPrefix || ''}${value}`;
      state.location = state.redirectedVia;
      return res;
    },
    cookie() { return res; },
    clearCookie() { return res; }
  };
  return { res, state };
}

async function run(options) {
  const req = createRequest(options);
  const { res, state } = createResponse();
  res.locals.__mountPrefix = options.routedSlug ? `/${options.routedSlug}/accessible` : '';
  let nextCalled = false;
  await requireAuth(req, res, () => { nextCalled = true; });
  return { state, nextCalled, req };
}

describe('member-private pages refuse a foreign community mount', () => {
  it("redirects to the member's own community, exactly once, with no doubled prefix", async () => {
    const { state, nextCalled } = await run({
      routedSlug: 'community-b',
      sessionSlug: 'community-a',
      routePath: '/dashboard'
    });

    expect(nextCalled).toBe(false);
    expect(state.status).toBe(302);
    expect(state.location).toBe('/community-a/accessible/dashboard');

    // The mount rewriter must NOT have been involved: going through res.redirect would
    // have produced '/community-b/accessible/community-a/accessible/dashboard'.
    expect(state.redirectedVia).toBeNull();
    expect(state.location).not.toContain('community-b');
    expect(state.location.match(/\/accessible\//g)).toHaveLength(1);
  });

  it('preserves the requested path and query-free sub-paths', async () => {
    const { state } = await run({
      routedSlug: 'community-b',
      sessionSlug: 'community-a',
      routePath: '/messages/conversation/42'
    });

    expect(state.location).toBe('/community-a/accessible/messages/conversation/42');
  });

  it('does not interfere when the member is already on their own community', async () => {
    const { state, nextCalled } = await run({
      routedSlug: 'community-a',
      sessionSlug: 'community-a'
    });

    expect(nextCalled).toBe(true);
    expect(state.status).toBeNull();
    expect(state.location).toBeNull();
  });

  it('ignores case differences rather than redirecting in a loop', async () => {
    // A redirect here would send the member to a path that resolves back to the same
    // mount, producing a loop.
    const { state, nextCalled } = await run({
      routedSlug: 'Community-A',
      sessionSlug: 'community-a'
    });

    expect(nextCalled).toBe(true);
    expect(state.location).toBeNull();
  });

  it('does nothing when no community is routed', async () => {
    const { state, nextCalled } = await run({
      routedSlug: null,
      sessionSlug: 'community-a'
    });

    expect(nextCalled).toBe(true);
    expect(state.location).toBeNull();
  });

  it('does nothing when the session has no remembered community', async () => {
    // Sessions predating the tenant_slug cookie, and custom-domain sign-ins, have none.
    // Guessing would strand those members.
    const { state, nextCalled } = await run({
      routedSlug: 'community-b',
      sessionSlug: null
    });

    expect(nextCalled).toBe(true);
    expect(state.location).toBeNull();
  });

  it('leaves custom-domain mounts alone', async () => {
    // 🔴 There is no slug in a custom domain's address to be wrong about, and
    // redirecting to /slug/accessible/... on that host would send the member to a path
    // that community does not serve.
    const { state, nextCalled } = await run({
      routedSlug: 'community-b',
      sessionSlug: 'community-a',
      mode: 'custom-domain',
      prefix: ''
    });

    expect(nextCalled).toBe(true);
    expect(state.location).toBeNull();
  });
});
