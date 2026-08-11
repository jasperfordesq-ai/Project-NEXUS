// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Cloudflare Turnstile on the contact form.
 *
 * `POST /api/v2/contact` is the ONE Laravel endpoint that enforces Turnstile
 * (`CoreController::apiSubmit` → 422 `TURNSTILE_FAILED`). web-uk rendered no
 * widget anywhere, so every contact submission would have failed the moment
 * `TURNSTILE_SECRET_KEY` was set in production. `TurnstileService` fails OPEN
 * when the secret is unset, which is why nothing looked broken locally.
 *
 * Two halves are pinned here:
 *  - the route passes the site key and a fallback contact address into the view;
 *  - the view renders the widget, a no-JS explanation, and a route that does not
 *    depend on the challenge at all.
 */

const nunjucks = require('nunjucks');
const path = require('path');
const express = require('express');
const request = require('supertest');

jest.mock('../src/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(message, status, data) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  },
  submitContact: jest.fn().mockResolvedValue({ data: { sent: true } }),
  submitSupportReport: jest.fn()
}));

const api = require('../src/lib/api');

const VIEW_PATHS = [
  path.join(__dirname, '..', 'src', 'views'),
  path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')
];

const templateEnv = nunjucks.configure(VIEW_PATHS, { autoescape: true, noCache: true });

/**
 * Render `contact.njk` in isolation. The shared layout is exercised elsewhere;
 * rendering only the block under test keeps these assertions about Turnstile.
 */
function renderContact(context = {}) {
  return templateEnv.render('contact.njk', {
    t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
    urlFor: (pathname) => `/acme/accessible${pathname === '/' ? '' : pathname}`,
    isAuthenticated: false,
    tenantName: 'Acme Timebank',
    csrfToken: 'test-csrf',
    values: {},
    errors: {},
    status: '',
    statusMessage: '',
    turnstileSiteKey: '',
    contactEmail: '',
    ...context
  });
}

/**
 * Mount the real contact router with `res.render` replaced by a capture, so the
 * assertions are about the context the route builds rather than about HTML.
 */
function buildRouteApp({ tenant = {}, siteKey = '' } = {}) {
  const captured = { view: null, context: null, redirect: null };
  const app = express();
  app.use(express.urlencoded({ extended: false }));

  app.use((req, res, next) => {
    process.env.TURNSTILE_SITE_KEY = siteKey;
    req.session = {};
    req.signedCookies = {};
    req.accessibleRouting = { tenant };
    res.locals.t = (key) => key;
    res.locals.urlFor = (pathname) => `/acme/accessible${pathname === '/' ? '' : pathname}`;
    res.render = (view, context) => {
      captured.view = view;
      captured.context = context;
      res.status(200).end();
    };
    next();
  });

  // eslint-disable-next-line global-require
  app.use(require('../src/routes/contact-support'));
  return { app, captured };
}

const originalSiteKey = process.env.TURNSTILE_SITE_KEY;

afterEach(() => {
  if (originalSiteKey === undefined) {
    delete process.env.TURNSTILE_SITE_KEY;
  } else {
    process.env.TURNSTILE_SITE_KEY = originalSiteKey;
  }
  jest.clearAllMocks();
});

describe('contact route Turnstile context', () => {
  it('passes the configured site key into the contact view', async () => {
    const { app, captured } = buildRouteApp({ siteKey: '1x00000000000000000000AA' });

    await request(app).get('/contact').expect(200);

    expect(captured.view).toBe('contact');
    expect(captured.context.turnstileSiteKey).toBe('1x00000000000000000000AA');
  });

  it('passes an empty site key when unconfigured, so no widget renders', async () => {
    const { app, captured } = buildRouteApp({ siteKey: '' });

    await request(app).get('/contact').expect(200);

    expect(captured.context.turnstileSiteKey).toBe('');
  });

  it('passes the tenant contact address from the bootstrap contact block', async () => {
    const { app, captured } = buildRouteApp({
      tenant: { contact: { email: 'hello@acme.example' } }
    });

    await request(app).get('/contact').expect(200);

    expect(captured.context.contactEmail).toBe('hello@acme.example');
  });

  it('accepts the flat contact_email shape as a fallback', async () => {
    const { app, captured } = buildRouteApp({ tenant: { contact_email: 'flat@acme.example' } });

    await request(app).get('/contact').expect(200);

    expect(captured.context.contactEmail).toBe('flat@acme.example');
  });

  it('passes an empty address when the tenant published none', async () => {
    const { app, captured } = buildRouteApp({ tenant: {} });

    await request(app).get('/contact').expect(200);

    expect(captured.context.contactEmail).toBe('');
  });

  it('forwards the widget token under Laravel\'s field name', async () => {
    const { app } = buildRouteApp();

    await request(app)
      .post('/contact')
      .type('form')
      .send({
        name: 'Ada Lovelace',
        email: 'ada@example.org',
        subject: 'technical',
        message: 'The page did not load.',
        'cf-turnstile-response': 'widget-token'
      })
      .expect(302);

    expect(api.submitContact).toHaveBeenCalledWith(expect.objectContaining({
      turnstile_token: 'widget-token'
    }));
  });

  it('maps a Laravel Turnstile rejection onto its own status, not a generic failure', async () => {
    const { ApiError } = api;
    api.submitContact.mockRejectedValueOnce(
      new ApiError('Verification failed', 422, { code: 'TURNSTILE_FAILED' })
    );
    const { app } = buildRouteApp();

    const response = await request(app)
      .post('/contact')
      .type('form')
      .send({
        name: 'Ada Lovelace',
        email: 'ada@example.org',
        subject: 'technical',
        message: 'The page did not load.',
        'cf-turnstile-response': 'stale-token'
      });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/acme/accessible/contact?status=contact-turnstile-failed');
  });
});

describe('contact view Turnstile widget', () => {
  it('renders the widget and the challenge script when a site key is set', () => {
    const html = renderContact({ turnstileSiteKey: '1x00000000000000000000AA' });

    expect(html).toContain('class="cf-turnstile"');
    expect(html).toContain('data-sitekey="1x00000000000000000000AA"');
    expect(html).toContain('https://challenges.cloudflare.com/turnstile/v0/api.js');
  });

  it('renders nothing Turnstile-related when no site key is set', () => {
    const html = renderContact({ turnstileSiteKey: '' });

    expect(html).not.toContain('cf-turnstile');
    expect(html).not.toContain('challenges.cloudflare.com');
  });

  it('explains the JavaScript requirement inside noscript, where it is readable', () => {
    const html = renderContact({ turnstileSiteKey: '1x00000000000000000000AA' });

    // Turnstile has no non-JavaScript mode, so a visitor without it can never
    // produce a token. Saying nothing would dead-end them silently.
    const noscript = html.slice(html.indexOf('<noscript>'), html.indexOf('</noscript>'));
    expect(noscript).toContain('contact.other_ways_no_js');
  });

  it('offers the community email whenever one is published, challenge or not', () => {
    const withKey = renderContact({
      turnstileSiteKey: '1x00000000000000000000AA',
      contactEmail: 'hello@acme.example'
    });
    const withoutKey = renderContact({ contactEmail: 'hello@acme.example' });

    for (const html of [withKey, withoutKey]) {
      expect(html).toContain('contact.other_ways_title');
      expect(html).toContain('mailto:hello@acme.example');
    }
  });

  it('still offers another route on the success and failure pages', () => {
    // A security check must never be the only way to reach a community, and a
    // FAILED challenge is exactly when the alternative matters most.
    const sent = renderContact({ status: 'contact-sent', contactEmail: 'hello@acme.example' });
    const failed = renderContact({
      status: 'contact-turnstile-failed',
      statusMessage: 'contact.turnstile_failed',
      contactEmail: 'hello@acme.example'
    });

    expect(sent).toContain('mailto:hello@acme.example');
    expect(failed).toContain('mailto:hello@acme.example');
  });

  it('offers report-a-problem to signed-in members, which is not challenge-gated', () => {
    const html = renderContact({ isAuthenticated: true });

    expect(html).toContain('/acme/accessible/report-a-problem');
    expect(html).toContain('contact.other_ways_report');
  });

  it('omits the whole section when there is nothing to offer', () => {
    const html = renderContact({ contactEmail: '', isAuthenticated: false });

    expect(html).not.toContain('contact.other_ways_title');
  });
});

describe('Turnstile is not rendered on the forms that dropped it', () => {
  it('leaves no site key plumbed into the auth views', () => {
    const fs = require('fs');
    const authSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'auth.js'), 'utf8');

    // Removed server-side on 2026-05-16 in favour of a honeypot, a minimum form
    // time, a per-IP throttle and admin approval. The key was still being passed
    // to eight renders that never used it.
    expect(authSource).not.toContain('turnstileSiteKey');
  });
});
