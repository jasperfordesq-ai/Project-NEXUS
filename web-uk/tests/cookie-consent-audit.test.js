// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Cookie consent as a GDPR audit record, not just a browser cookie.
 *
 * 🔴 The gap this closes. Blade persists a `cookie_consents` row for every choice
 * (`CookieConsentService::storeConsent`, which accepts a null user and keys on
 * tenant + IP). web-uk only ever set a cookie in the browser, so a signed-out
 * visitor's consent decision was recorded NOWHERE — the two accessible frontends
 * disagreed about whether a consent decision is auditable at all.
 *
 * 🔴 The most important test here is the one asserting a FAILED audit still honours
 * the member's choice. A consent banner that errors, or that loses the choice
 * because a background call failed, is worse than one that records late.
 */

const express = require('express');
const request = require('supertest');

const mockRecordCookieConsent = jest.fn();

jest.mock('../src/lib/api', () => ({
  recordCookieConsent: (...args) => mockRecordCookieConsent(...args),
}));

const { recordCookieConsent } = require('../src/lib/api');

const COOKIE_NAME = 'nexus_accessible_cookie_consent';

/**
 * Reproduces the real handler's contract: set the cookie, fire the audit without
 * awaiting it, then redirect. Kept in step with `src/server.js` by the source
 * assertions at the bottom of this file.
 */
function buildApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));

  app.post('/cookie-consent', (req, res) => {
    const choice = typeof req.body.cookies === 'string' ? req.body.cookies : '';
    const analyticsOn = choice === 'accept' || (choice === 'save' && req.body.analytics === 'yes');

    res.cookie(COOKIE_NAME, analyticsOn ? 'all' : 'essential', { path: '/', sameSite: 'lax' });

    void recordCookieConsent(
      { analytics: analyticsOn, marketing: false, functional: true },
      req.signedCookies?.token || ''
    ).catch(() => {});

    return res.redirect(302, choice === 'save' ? '/cookies?status=saved' : '/');
  });

  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRecordCookieConsent.mockResolvedValue({ data: { id: 1 } });
});

describe('recording the decision', () => {
  it('records an accept as analytics on', async () => {
    await request(buildApp()).post('/cookie-consent').type('form').send({ cookies: 'accept' });

    expect(mockRecordCookieConsent).toHaveBeenCalledWith(
      { analytics: true, marketing: false, functional: true },
      ''
    );
  });

  it('records a reject as analytics off', async () => {
    await request(buildApp()).post('/cookie-consent').type('form').send({ cookies: 'reject' });

    expect(mockRecordCookieConsent).toHaveBeenCalledWith(
      { analytics: false, marketing: false, functional: true },
      ''
    );
  });

  it('records the settings form the same way as the banner', async () => {
    await request(buildApp())
      .post('/cookie-consent')
      .type('form')
      .send({ cookies: 'save', analytics: 'yes' });

    expect(mockRecordCookieConsent).toHaveBeenCalledWith(
      { analytics: true, marketing: false, functional: true },
      ''
    );
  });

  it('never claims marketing consent, which this frontend does not ask for', async () => {
    await request(buildApp()).post('/cookie-consent').type('form').send({ cookies: 'accept' });

    // Recording a consent the member was never asked for would be worse than
    // recording nothing at all.
    expect(mockRecordCookieConsent.mock.calls[0][0].marketing).toBe(false);
  });
});

describe('🔴 the audit never costs the member their choice', () => {
  it('still sets the cookie when recording fails', async () => {
    mockRecordCookieConsent.mockRejectedValue(new Error('API down'));

    const response = await request(buildApp())
      .post('/cookie-consent')
      .type('form')
      .send({ cookies: 'accept' });

    expect(response.headers['set-cookie'].join(';')).toContain(`${COOKIE_NAME}=all`);
  });

  it('still redirects when recording fails', async () => {
    mockRecordCookieConsent.mockRejectedValue(new Error('API down'));

    const response = await request(buildApp())
      .post('/cookie-consent')
      .type('form')
      .send({ cookies: 'save', analytics: 'yes' });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/cookies?status=saved');
  });

  it('does not wait for the audit before responding', async () => {
    // A hanging API must not hang the banner. The promise is deliberately not
    // awaited, so the response arrives while the call is still in flight.
    let settle;
    mockRecordCookieConsent.mockReturnValue(new Promise((resolve) => { settle = resolve; }));

    const response = await request(buildApp())
      .post('/cookie-consent')
      .type('form')
      .send({ cookies: 'accept' });

    expect(response.status).toBe(302);
    settle({ data: {} });
  });
});

describe('the real handler in src/server.js', () => {
  const source = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'src', 'server.js'),
    'utf8'
  );

  it('records consent from the real handler', () => {
    expect(source).toContain('recordCookieConsent(');
  });

  it('does not await the audit, and swallows its failure', () => {
    // Pinning the shape, because an `await` added here later would make a slow API
    // delay every consent click, and a missing catch would produce an unhandled
    // rejection on a route a signed-out visitor can reach.
    expect(source).toContain('const consentAudit = recordCookieConsent(');
    expect(source).toMatch(/void consentAudit\.catch\(/);
    expect(source).not.toMatch(/await recordCookieConsent\(/);
  });

  it('guards against a SYNCHRONOUS throw as well as a rejection', () => {
    // 🔴 Found by a test, not by inspection. `.catch()` only covers a rejected
    // promise; if the helper throws synchronously — or is not a function, which is
    // what a test mocking this module without it produces — the throw escapes and
    // the handler 500s. A signed-out visitor clicking "reject analytics" would then
    // get an error page and lose their choice, which is the exact opposite of what
    // this code promises. Three existing suites failed this way before the fix.
    // Sliced to the NEXT route registration rather than a fixed character count —
    // a magic window silently cut off before the catch block and failed for the
    // wrong reason.
    const start = source.indexOf("app.post('/cookie-consent'");
    expect(start).toBeGreaterThan(-1);
    const next = source.indexOf('\napp.', start + 1);
    const handler = source.slice(start, next > -1 ? next : source.length);

    expect(handler).toMatch(/try \{/);
    expect(handler).toMatch(/\} catch \{/);
    expect(handler).toContain("typeof consentAudit.catch === 'function'");
  });

  it('uses the translated page title rather than a hardcoded string', () => {
    expect(source).toContain("title: res.locals.t('cookie_settings.title')");
    expect(source).not.toContain("title: 'Cookies',");
  });

  it('passes the already-computed banner flag to the page', () => {
    expect(source).toContain('hasCookieChoice: res.locals.alphaHasCookieChoice');
  });
});
