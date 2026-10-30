// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * AWID pilot (Oct 2026): the accessible site signed members out after a fixed
 * 30 minutes of inactivity and ignored the community's own "Inactivity timeout
 * (minutes)" setting, which the main website honours (useIdleLogout).
 *
 * Same rules as React and the admin screen: 5–480 minutes is a timeout, 0 turns
 * the automatic sign-out off. A community that never set it keeps this site's
 * 30-minute default (React's default is off; this site's was 30 and stays 30).
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const request = require('supertest');
const {
  DEFAULT_SESSION_TIMEOUT_MINUTES,
  sessionTimeoutMinutesFor,
  applyTenantSessionTimeout
} = require('../src/lib/session-timeout');

// express-session writes an Expires date, not Max-Age. Minutes from now, rounded.
function cookieMinutesFromNow(setCookie) {
  const match = /Expires=([^;]+)/i.exec(setCookie || '');
  return match ? Math.round((Date.parse(match[1]) - Date.now()) / 60000) : null;
}

const tenantWith = (value) => ({ settings: value === undefined ? {} : { inactivity_timeout_minutes: value } });

describe('sessionTimeoutMinutesFor', () => {
  it('keeps the 30-minute default when the community never set it', () => {
    expect(DEFAULT_SESSION_TIMEOUT_MINUTES).toBe(30);
    expect(sessionTimeoutMinutesFor(tenantWith(undefined))).toBe(30);
    expect(sessionTimeoutMinutesFor({})).toBe(30);
    expect(sessionTimeoutMinutesFor(null)).toBe(30);
  });

  it('uses the community setting, as a number or a string', () => {
    expect(sessionTimeoutMinutesFor(tenantWith(120))).toBe(120);
    expect(sessionTimeoutMinutesFor(tenantWith('45'))).toBe(45);
  });

  it('caps at 480 minutes, as the main website does', () => {
    expect(sessionTimeoutMinutesFor(tenantWith(9999))).toBe(480);
  });

  it('treats 0 as "automatic sign-out off" (the bootstrap sends a stored 0 as false)', () => {
    expect(sessionTimeoutMinutesFor(tenantWith(0))).toBe(0);
    expect(sessionTimeoutMinutesFor(tenantWith('0'))).toBe(0);
    expect(sessionTimeoutMinutesFor(tenantWith(false))).toBe(0);
  });

  it('falls back to the default for anything unusable', () => {
    expect(sessionTimeoutMinutesFor(tenantWith('soon'))).toBe(30);
    expect(sessionTimeoutMinutesFor(tenantWith(3))).toBe(30);
    expect(sessionTimeoutMinutesFor(tenantWith(true))).toBe(30);
  });
});

describe('applyTenantSessionTimeout', () => {
  function appFor(tenant) {
    const app = express();
    app.use((req, res, next) => { req.accessibleRouting = { tenant }; next(); });
    app.use(session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: { maxAge: 30 * 60 * 1000 }
    }));
    app.use(applyTenantSessionTimeout);
    app.get('/', (req, res) => {
      req.session.touched = true;
      res.json({ timeout: res.locals.sessionTimeout, disabled: res.locals.sessionTimeoutDisabled });
    });
    return app;
  }

  it('sets the session cookie and the page timeout from the community setting', async () => {
    const response = await request(appFor(tenantWith(120))).get('/');
    expect(response.body).toEqual({ timeout: 120, disabled: false });
    expect(cookieMinutesFromNow(response.headers['set-cookie'][0])).toBe(120);
  });

  it('keeps 30 minutes when nothing is set', async () => {
    const response = await request(appFor(tenantWith(undefined))).get('/');
    expect(response.body).toEqual({ timeout: 30, disabled: false });
    expect(cookieMinutesFromNow(response.headers['set-cookie'][0])).toBe(30);
  });

  it('turns the automatic sign-out off when the community chose 0', async () => {
    const response = await request(appFor(tenantWith(false))).get('/');
    expect(response.body).toEqual({ timeout: null, disabled: true });
    // A browser-session cookie: no fixed expiry for an idle member.
    expect(cookieMinutesFromNow(response.headers['set-cookie'][0])).toBeNull();
  });
});

describe('layout', () => {
  it('does not load the sign-out warning when the community turned it off', () => {
    const base = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'layouts', 'base.njk'), 'utf8');
    expect(base).toContain('{% if isAuthenticated and not sessionTimeoutDisabled %}<script src="/js/timeout-warning.js"></script>{% endif %}');
  });

  it('server.js no longer hard-codes the session length into the page timeout', () => {
    const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
    expect(server).toContain('app.use(applyTenantSessionTimeout)');
    expect(server).not.toMatch(/res\.locals\.sessionTimeout = maxAge/);
  });
});
