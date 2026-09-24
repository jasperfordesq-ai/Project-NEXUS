// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * F-208: the sign-in cookies (token, refresh_token, tenant_slug) and the
 * session cookie were not `__Host-` prefixed, so a sibling subdomain could
 * plant its own signed session cookie and swap a member into another account.
 *
 * In production they are now `__Host-` cookies (Secure, Path=/, no Domain).
 * For one release the old names are still read — but only when no `__Host-`
 * sign-in cookie is present — so nobody is signed out by the change, and a
 * planted old-name cookie can never override a real session.
 */
const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');

jest.mock('../src/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  ApiOfflineError: class ApiOfflineError extends Error {},
  refreshToken: jest.fn(),
  validateToken: jest.fn()
}));

const SECRET = 'test-cookie-secret-value-long-enough';

function loadAuth(nodeEnv) {
  const previous = process.env.NODE_ENV;
  let auth;
  try {
    process.env.NODE_ENV = nodeEnv;
    jest.isolateModules(() => {
      auth = require('../src/middleware/auth');
    });
  } finally {
    process.env.NODE_ENV = previous;
  }
  return auth;
}

function buildApp(auth) {
  const app = express();
  app.use(auth.normalizeAuthCookieNames);
  app.use(cookieParser(SECRET));
  app.get('/sign-in', (req, res) => {
    auth.setAuthCookies(res, String(req.query.who || 'member-a'), `refresh-${req.query.who || 'member-a'}`, {
      expiresIn: 900,
      refreshExpiresIn: 3600,
      tenantSlug: 'acme'
    });
    res.send('ok');
  });
  app.get('/who', (req, res) => res.json({
    token: req.signedCookies.token || null,
    refresh: req.signedCookies.refresh_token || null,
    tenant: req.signedCookies.tenant_slug || null,
    legacy: req.legacyAuthCookies === true,
    rawCookieHeader: req.headers.cookie || ''
  }));
  app.get('/sign-out', (_req, res) => {
    auth.clearAuthCookies(res);
    res.send('bye');
  });
  // What src/lib/errorHandler.js does on a 401: clear the PLAIN names.
  app.get('/api-401', (_req, res) => {
    res.clearCookie('token', { path: '/', httpOnly: true, signed: true, sameSite: 'lax' });
    res.clearCookie('refresh_token', { path: '/', httpOnly: true, signed: true, sameSite: 'lax' });
    res.send('login');
  });
  return app;
}

// Turns Set-Cookie headers into a Cookie request header, optionally renaming.
function cookieHeaderFrom(setCookies, rename = (name) => name) {
  return setCookies
    .map((line) => line.split(';')[0])
    .map((pair) => {
      const index = pair.indexOf('=');
      return `${rename(pair.slice(0, index))}=${pair.slice(index + 1)}`;
    })
    .join('; ');
}

describe('sign-in cookies are __Host- prefixed in production (F-208)', () => {
  const auth = loadAuth('production');
  const app = buildApp(auth);

  it('writes __Host- cookies that are Secure, Path=/ and carry no Domain', async () => {
    const res = await request(app).get('/sign-in');
    const setCookies = res.headers['set-cookie'];
    const names = setCookies.map((line) => line.split('=')[0]);
    expect(names).toEqual(['__Host-token', '__Host-refresh_token', '__Host-tenant_slug']);
    for (const line of setCookies) {
      expect(line).toMatch(/; Secure/);
      expect(line).toMatch(/; Path=\//);
      expect(line).not.toMatch(/Domain=/i);
      expect(line).toMatch(/HttpOnly/);
    }
    expect(auth.sessionCookieName()).toBe('__Host-nexus.sid');
  });

  it('reads the __Host- cookies under the names every route uses', async () => {
    const signIn = await request(app).get('/sign-in?who=member-a');
    const res = await request(app).get('/who').set('Cookie', cookieHeaderFrom(signIn.headers['set-cookie']));
    expect(res.body).toMatchObject({ token: 'member-a', refresh: 'refresh-member-a', tenant: 'acme', legacy: false });
  });

  it('still reads the old names when no __Host- cookie exists, so the deploy signs nobody out', async () => {
    const signIn = await request(app).get('/sign-in?who=member-a');
    const legacyHeader = cookieHeaderFrom(signIn.headers['set-cookie'], (name) => name.replace('__Host-', ''));
    const res = await request(app).get('/who').set('Cookie', legacyHeader);
    expect(res.body).toMatchObject({ token: 'member-a', refresh: 'refresh-member-a', tenant: 'acme', legacy: true });
  });

  it('never lets a planted old-name cookie override a real __Host- session', async () => {
    const victim = await request(app).get('/sign-in?who=victim');
    const attacker = await request(app).get('/sign-in?who=attacker');
    // A sibling subdomain can set `token=` (Domain=.example) but not `__Host-token=`.
    const planted = cookieHeaderFrom(attacker.headers['set-cookie'], (name) => name.replace('__Host-', ''));
    const header = `${planted}; ${cookieHeaderFrom(victim.headers['set-cookie'])}`;
    const res = await request(app).get('/who').set('Cookie', header);
    expect(res.body).toMatchObject({ token: 'victim', refresh: 'refresh-victim', legacy: false });
    expect(res.body.rawCookieHeader).not.toContain('attacker');
  });

  it('ignores a plain nexus.sid session cookie', async () => {
    const res = await request(app).get('/who').set('Cookie', 'nexus.sid=s%3Aplanted.sig; theme=dark');
    expect(res.body.rawCookieHeader).toBe('theme=dark');
  });

  it('signs out of both the __Host- and the old names, securely', async () => {
    const res = await request(app).get('/sign-out');
    const cleared = res.headers['set-cookie'];
    for (const name of ['__Host-token', 'token', '__Host-refresh_token', 'refresh_token', '__Host-tenant_slug', 'tenant_slug']) {
      const line = cleared.find((value) => value.startsWith(`${name}=`));
      expect(line).toBeDefined();
      expect(line).toMatch(/Expires=Thu, 01 Jan 1970/);
      expect(line).toMatch(/; Secure/);
    }
  });

  it('makes the error handlers\' plain-name clear also end the __Host- session', async () => {
    const res = await request(app).get('/api-401');
    const names = res.headers['set-cookie'].map((line) => line.split('=')[0]);
    expect(names).toEqual(expect.arrayContaining(['__Host-token', 'token', '__Host-refresh_token', 'refresh_token']));
  });
});

describe('outside production the plain names are kept (plain-http development)', () => {
  const auth = loadAuth('development');
  const app = buildApp(auth);

  it('writes and reads the plain names without Secure', async () => {
    const signIn = await request(app).get('/sign-in?who=dev');
    const names = signIn.headers['set-cookie'].map((line) => line.split('=')[0]);
    expect(names).toEqual(['token', 'refresh_token', 'tenant_slug']);
    expect(signIn.headers['set-cookie'].join('\n')).not.toMatch(/Secure/);
    expect(auth.sessionCookieName()).toBe('nexus.sid');

    const res = await request(app).get('/who').set('Cookie', cookieHeaderFrom(signIn.headers['set-cookie']));
    expect(res.body).toMatchObject({ token: 'dev', legacy: false });
  });
});
