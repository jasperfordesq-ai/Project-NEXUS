// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 WHY THIS FILE EXISTS.
 *
 * web-uk sits behind Apache (mod_proxy_http). Apache does not REPLACE a
 * client-supplied X-Forwarded-Host — it MERGES: the client's value comes first
 * and the Host the proxy actually saw is appended last, so the header reaches
 * this app as
 *
 *     X-Forwarded-Host: evil.example, accessible-hour-timebank.example
 *
 * `requestHost()` took the FIRST value, which handed community resolution to
 * whoever sent the request. It now takes the LAST value — the one our proxy
 * wrote. Found by the 2026-09-11 security audit while reading the header
 * handling; this pins the rule.
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

const HOST = 'accessible-hour-timebank.example';

function buildApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(tenantRouting);
  app.use((req, res) => res.status(200).json({ reached: true }));
  return app;
}

beforeEach(() => {
  mockGetTenantBootstrap.mockReset();
  mockGetTenantBootstrap.mockImplementation(async ({ host, slug }) => {
    if (host === HOST || slug === 'hour-timebank') {
      return { data: { id: 2, slug: 'hour-timebank', name: 'Hour Timebank', accessible_domain: HOST } };
    }
    throw new MockApiError('Not found', 404);
  });
});

describe('X-Forwarded-Host as merged by the proxy', () => {
  it('resolves the community from the value the proxy appended, not the one the client sent first', async () => {
    const response = await request(buildApp())
      .get('/listings')
      .set('Host', HOST)
      .set('X-Forwarded-Host', `evil.example, ${HOST}`);

    expect(response.status).toBe(200);
    const hostsLookedUp = mockGetTenantBootstrap.mock.calls.map(([args]) => args.host).filter(Boolean);
    expect(hostsLookedUp).toContain(HOST);
    expect(hostsLookedUp).not.toContain('evil.example');
  });

  it('behaves identically with no forwarded header at all (the control)', async () => {
    const response = await request(buildApp())
      .get('/listings')
      .set('Host', HOST);

    expect(response.status).toBe(200);
    const hostsLookedUp = mockGetTenantBootstrap.mock.calls.map(([args]) => args.host).filter(Boolean);
    expect(hostsLookedUp).toContain(HOST);
  });

  it('ignores surrounding whitespace and empty entries in the merged header', async () => {
    const response = await request(buildApp())
      .get('/listings')
      .set('Host', HOST)
      .set('X-Forwarded-Host', ` evil.example ,, ${HOST} `);

    expect(response.status).toBe(200);
    const hostsLookedUp = mockGetTenantBootstrap.mock.calls.map(([args]) => args.host).filter(Boolean);
    expect(hostsLookedUp).toContain(HOST);
    expect(hostsLookedUp).not.toContain('evil.example');
  });
});
