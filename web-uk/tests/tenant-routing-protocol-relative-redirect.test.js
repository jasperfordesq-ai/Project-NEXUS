// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 WHY THIS FILE EXISTS.
 *
 * On a community's own accessible domain, a request that still carries the
 * shared-host prefix (`/{slug}/accessible/...`) is redirected to the slugless
 * path. The remainder after the prefix was taken verbatim, so
 *
 *     https://accessible-hour-timebank.example/hour-timebank/accessible//evil.example
 *
 * produced `Location: //evil.example` — a protocol-relative URL, which browsers
 * resolve to https://evil.example. That is an open redirect on a host members
 * trust, and the classic phishing primitive. Found by CodeQL
 * (js/server-side-unvalidated-url-redirection) during the 2026-09-10 security
 * assessment and fixed by collapsing leading slashes in the remainder.
 *
 * The /alpha/ legacy redirect was never affected because it prepends the
 * accessible prefix, so its output always starts with `/{slug}`; it is here as
 * the control that the collapse does not disturb it.
 */

const express = require('express');
const request = require('supertest');
const net = require('node:net');
const { once } = require('node:events');

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
  app.use(tenantRouting);
  app.use((req, res) => res.status(200).json({ reached: true, rewrittenUrl: req.url }));
  return app;
}

beforeEach(() => {
  mockGetTenantBootstrap.mockReset();
  mockGetTenantBootstrap.mockResolvedValue({
    data: { id: 2, slug: 'hour-timebank', name: 'Hour Timebank', accessible_domain: HOST },
  });
});

describe('slug-prefixed requests on a custom accessible domain', () => {
  it('redirects to the slugless path (the control)', async () => {
    const response = await request(buildApp())
      .get('/hour-timebank/accessible/listings?page=2')
      .set('Host', HOST);

    expect(response.status).toBe(301);
    expect(response.headers.location).toBe('/listings?page=2');
  });

  it('never emits a protocol-relative Location, whatever the remainder', async () => {
    const response = await request(buildApp())
      .get('/hour-timebank/accessible//evil.example/phish')
      .set('Host', HOST);

    expect(response.status).toBe(301);
    expect(response.headers.location).toBe('/evil.example/phish');
    expect(response.headers.location.startsWith('//')).toBe(false);
  });

  it('collapses any run of leading slashes, not just two', async () => {
    const response = await request(buildApp())
      .get('/hour-timebank/accessible////evil.example')
      .set('Host', HOST);

    expect(response.status).toBe(301);
    expect(response.headers.location).toBe('/evil.example');
  });

  it('rejects an encoded backslash authority in the slugless redirect', async () => {
    const response = await request(buildApp())
      .get('/hour-timebank/accessible/%5Cevil.example/phish?next=%5Cok')
      .set('Host', HOST);

    expect(response.status).toBe(301);
    expect(response.headers.location).toBe('/?next=%5Cok');
    expect(new URL(response.headers.location, `https://${HOST}`).host).toBe(HOST);
  });

  it('rejects a literal backslash authority before any client normalizes the URL', async () => {
    const server = buildApp().listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const response = await new Promise((resolve, reject) => {
        const socket = net.createConnection(server.address().port, '127.0.0.1');
        let body = '';
        socket.on('connect', () => {
          socket.write(`GET /hour-timebank/accessible/\\evil.example/phish?next=%5Cok HTTP/1.0\r\nHost: ${HOST}\r\nConnection: close\r\n\r\n`);
        });
        socket.on('data', (chunk) => { body += chunk.toString(); });
        socket.on('end', () => resolve(body));
        socket.on('error', reject);
      });
      const location = response.match(/^Location:\s*([^\r\n]+)/mi)?.[1];
      expect(location).toBe('/?next=%5Cok');
      expect(new URL(location, `https://${HOST}`).host).toBe(HOST);
    } finally {
      server.close();
    }
  });
});

describe('the legacy /alpha/ redirect is unaffected', () => {
  it('still prepends the accessible prefix and keeps the query', async () => {
    const response = await request(buildApp()).get('/hour-timebank/alpha//odd?x=1');

    expect(response.status).toBe(301);
    expect(response.headers.location).toBe('/hour-timebank/accessible/odd?x=1');
    expect(mockGetTenantBootstrap).not.toHaveBeenCalled();
  });
});
