// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const request = require('supertest');
const { login, callWalletDownload } = require('../src/lib/api');
const { requestClientContext } = require('../src/middleware/request-client-context');

// F-110: every accessible-frontend request reaches Laravel from the web-uk
// container's own address, so Laravel's per-address limits (login lockout,
// forgot-password, resend-verification) were shared by every visitor. web-uk
// must tell Laravel which visitor each API call is for, in a dedicated header
// that only web-uk sets.

function jsonResponse(body = { data: {} }) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => '',
    arrayBuffer: async () => new ArrayBuffer(0)
  };
}

describe('client address forwarding to Laravel (F-110)', () => {
  const originalFetch = global.fetch;
  let observed;

  beforeEach(() => {
    observed = [];
    global.fetch = jest.fn(async (url, options) => {
      observed.push({ url, headers: { ...options.headers } });
      await new Promise((resolve) => global.setImmediate(resolve));
      return jsonResponse({ success: true, data: {} });
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function buildApp() {
    const app = express();
    app.set('trust proxy', 1);
    app.use(requestClientContext);
    app.post('/login', async (req, res) => {
      await login('member@example.test', 'pw', 'acme');
      res.json({ ip: req.ip });
    });
    app.get('/download', async (_req, res) => {
      await callWalletDownload('member-token', '/statement.csv');
      res.json({ ok: true });
    });
    return app;
  }

  it('sends each visitor\'s own address, isolated across concurrent requests', async () => {
    const app = buildApp();
    await Promise.all([
      request(app).post('/login').set('X-Forwarded-For', '203.0.113.10'),
      request(app).post('/login').set('X-Forwarded-For', '198.51.100.20')
    ]);

    expect(observed).toHaveLength(2);
    expect(observed.map(({ headers }) => headers['X-Forwarded-For']).sort())
      .toEqual(['198.51.100.20', '203.0.113.10']);
  });

  it('uses the address the trusted proxy appended, not one the visitor prepended', async () => {
    const app = buildApp();
    await request(app).post('/login').set('X-Forwarded-For', '10.9.9.9, 203.0.113.10');
    expect(observed[0].headers['X-Forwarded-For']).toBe('203.0.113.10');
  });

  it('forwards the address on download requests too', async () => {
    const app = buildApp();
    await request(app).get('/download').set('X-Forwarded-For', '203.0.113.30');
    expect(observed[0].headers['X-Forwarded-For']).toBe('203.0.113.30');
  });

  it('sends no client header outside a request context', async () => {
    await login('member@example.test', 'pw', 'acme');
    expect(observed[0].headers).not.toHaveProperty('X-Forwarded-For');
  });
});
