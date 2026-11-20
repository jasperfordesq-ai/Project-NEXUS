// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The API's COMMUNITY_PAUSED refusal reaches the paused page even when a route
 * swallows the error.
 *
 * Many pages here catch an API failure and render an empty state ("no listings
 * yet"). For a paused community that empty page would be a lie, so the API
 * client notes the refusal for the request and the gate swaps whatever the
 * route renders for the paused page. Uses the real API client with a stubbed
 * fetch, so the note is proved to survive the client's shared-GET path.
 */

const express = require('express');
const request = require('supertest');

const {
  COMMUNITY_PAUSED_CODE,
  COMMUNITY_PAUSED_VIEW,
  isCommunityPausedError,
  isCommunityPausedTenant
} = require('../src/lib/community-paused');
const { communityPausedGate } = require('../src/middleware/community-paused-gate');

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

function appWithRoute(handler) {
  const app = express();
  app.use((req, res, next) => {
    res.locals.t = (key, replacements = {}) => `${key}${replacements.community ? `|${replacements.community}` : ''}`;
    res.locals.urlFor = (value) => value;
    res.render = (view, options = {}) => res.json({ view, status: res.statusCode, community: options.communityName || '' });
    next();
  });
  app.use(communityPausedGate);
  app.get('*', handler);
  return app;
}

describe('recognising the pause', () => {
  it('reads the code from the top level or from errors[0]', () => {
    expect(COMMUNITY_PAUSED_CODE).toBe('COMMUNITY_PAUSED');
    expect(isCommunityPausedError({ status: 403, data: { code: 'COMMUNITY_PAUSED' } })).toBe(true);
    expect(isCommunityPausedError({ status: 403, data: { errors: [{ code: 'COMMUNITY_PAUSED' }] } })).toBe(true);
  });

  it('ignores another status or another code', () => {
    expect(isCommunityPausedError({ status: 503, data: { code: 'COMMUNITY_PAUSED' } })).toBe(false);
    expect(isCommunityPausedError({ status: 403, data: { code: 'FORBIDDEN' } })).toBe(false);
    expect(isCommunityPausedError(null)).toBe(false);
  });

  it('treats only an explicit true bootstrap flag as paused', () => {
    expect(isCommunityPausedTenant({ billing_paused: true })).toBe(true);
    expect(isCommunityPausedTenant({ billing_paused: false })).toBe(false);
    expect(isCommunityPausedTenant({ billing_paused: 'true' })).toBe(false);
    expect(isCommunityPausedTenant({})).toBe(false);
    expect(isCommunityPausedTenant(undefined)).toBe(false);
  });
});

describe('a route that swallows the refusal', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('still gets the paused page, with 503 and Retry-After', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(403, {
      success: false,
      error: 'This community is paused.',
      code: 'COMMUNITY_PAUSED'
    }));
    const { getPlatformStats } = require('../src/lib/api');

    const app = appWithRoute(async (req, res) => {
      try {
        await getPlatformStats({ slug: 'acme' });
      } catch {
        // An empty state, as many pages render when the API fails.
      }
      return res.render('listings/index', {});
    });

    const response = await request(app).get('/listings');

    expect(response.body.view).toBe(COMMUNITY_PAUSED_VIEW);
    expect(response.status).toBe(503);
    expect(response.headers['retry-after']).toBe('86400');
  });

  it('leaves the page alone when the API refuses for another reason', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(403, { success: false, code: 'FORBIDDEN' }));
    const { getPlatformStats } = require('../src/lib/api');

    const app = appWithRoute(async (req, res) => {
      try {
        await getPlatformStats({ slug: 'other' });
      } catch {
        // swallowed
      }
      return res.render('listings/index', {});
    });

    const response = await request(app).get('/listings');

    expect(response.body.view).toBe('listings/index');
    expect(response.status).toBe(200);
  });

  it('does not touch the sign-in pages', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(403, { success: false, code: 'COMMUNITY_PAUSED' }));
    const { getPlatformStats } = require('../src/lib/api');

    const app = appWithRoute(async (req, res) => {
      try {
        await getPlatformStats({ slug: 'login-check' });
      } catch {
        // swallowed
      }
      return res.render('auth/login', {});
    });

    const response = await request(app).get('/login');

    expect(response.body.view).toBe('auth/login');
  });
});
