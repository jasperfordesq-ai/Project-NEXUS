// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 THE ERROR PAGES MUST NOT BE ABLE TO BECOME THE ERROR.
 *
 * `tests/error-page-localization.test.js` renders the same templates, but it
 * always injects `t` and `urlFor` itself — so it proves the copy is right and
 * cannot see the failure mode here: the locals not being there at all.
 *
 * Production, 2026-08-13 (Sentry NEXUS-WEBUK-3): `generalLimiter` is mounted
 * above the body parsers, the session and `localization` on purpose, so its 429
 * handler rendered `errors/429.njk` with no `res.locals.t`. Nunjucks throws on a
 * missing callable, so the "too many requests" page raised
 * `Unable to call \`t\`, which is undefined or falsey` instead of rendering.
 */

const express = require('express');
const fs = require('fs');
const nunjucks = require('nunjucks');
const path = require('path');
const request = require('supertest');

const { errorPageFallbackLocals } = require('../src/lib/errorHandler');
const { createLimiter } = require('../src/lib/rateLimiter');
const { createTranslator } = require('../src/lib/localization');

const ERROR_TEMPLATES = ['errors/403', 'errors/404', 'errors/419', 'errors/429', 'errors/500', 'errors/503'];

/**
 * A server shaped like the real one at the point of failure: templates wired the
 * same way, but nothing that supplies `t`/`urlFor` — no session, no
 * `localization`, no shell locals.
 */
function buildApp({ withFallback }) {
  const app = express();
  nunjucks.configure(
    [
      path.join(__dirname, '..', 'src', 'views'),
      path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')
    ],
    { autoescape: true, express: app, noCache: true }
  );
  app.set('view engine', 'njk');

  if (withFallback) app.use(errorPageFallbackLocals);

  // The REAL limiter handler, not a copy of it. `skip` is passed through
  // `createLimiter`'s option spread to defeat its develop-mode bypass, so this
  // exercises the exact code path production took.
  app.use('/limited', createLimiter({ windowMs: 60_000, max: 1, skip: () => false }));
  app.get('/limited', (req, res) => res.type('text/plain').send('OK'));

  for (const template of ERROR_TEMPLATES) {
    app.get(`/render/${template.replace('errors/', '')}`, (req, res) => res.render(template));
  }

  // Mirrors server.js: Express's default handler answers 500 if a render throws.
  return app;
}

describe('error pages render when no request locals exist', () => {
  it('🔴 serves a real 429 page when the rate limiter fires before localization', async () => {
    const app = buildApp({ withFallback: true });
    const agent = request.agent(app);

    await agent.get('/limited').expect(200);
    const response = await agent.get('/limited').expect(429);

    expect(response.text).toContain(createTranslator('en')('error_pages.429_title'));
    expect(response.text).toContain('govuk-heading-xl');
    expect(response.text).not.toContain('undefined or falsey');
  });

  it('🔴 fails without the fallback — proving this test can catch the regression', async () => {
    const app = buildApp({ withFallback: false });
    const agent = request.agent(app);

    await agent.get('/limited').expect(200);
    const response = await agent.get('/limited');

    // The status is NOT the tell: Express's finalhandler keeps the 429 that
    // `res.status(429)` already set, so a status check alone looks healthy. What
    // the member actually receives is the framework's fallback body — the styled,
    // localised page never renders, and outside production the body carries a
    // stack trace with absolute server paths.
    expect(response.text).not.toContain(createTranslator('en')('error_pages.429_title'));
    expect(response.text).toContain('Unable to call `t`');
  });

  it.each(ERROR_TEMPLATES)('renders %s with no injected locals', async (template) => {
    const app = buildApp({ withFallback: true });
    const name = template.replace('errors/', '');

    const response = await request(app).get(`/render/${name}`).expect(200);

    expect(response.text).toContain('<main');
    expect(response.text).toContain('id="main-content"');
    // `urlFor` is the other callable the templates use; an unprefixed host
    // serves the bare path.
    expect(response.text).toContain('href="/"');
  });

  it('still honours Accept-Language, so a rate-limited member is not forced into English', async () => {
    const app = buildApp({ withFallback: true });
    const irish = createTranslator('ga')('error_pages.429_title');
    const english = createTranslator('en')('error_pages.429_title');

    const response = await request(app)
      .get('/render/429')
      .set('Accept-Language', 'ga')
      .expect(200);

    expect(irish).not.toBe(english);
    expect(response.text).toContain(irish);
    expect(response.text).toContain('<html lang="ga"');
  });

  it('🔴 is mounted above generalLimiter in server.js', () => {
    // Middleware order is invisible at the call site and there is no runtime
    // signal when it is wrong — the page just breaks for whoever hit the limit.
    // So it is asserted against the source, as /health and /version are.
    const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');

    const fallbackAt = server.indexOf('app.use(errorPageFallbackLocals)');
    const limiterAt = server.indexOf('app.use(generalLimiter)');
    const localizationAt = server.indexOf('app.use(localization)');
    const routingAt = server.indexOf('app.use(tenantRouting)');

    expect(fallbackAt).toBeGreaterThan(-1);
    expect(limiterAt).toBeGreaterThan(-1);
    expect(localizationAt).toBeGreaterThan(-1);
    expect(routingAt).toBeGreaterThan(-1);

    expect(fallbackAt).toBeLessThan(limiterAt);
    expect(fallbackAt).toBeLessThan(localizationAt);
    // After tenantRouting, so a shared-mount request's prefix is already known.
    expect(routingAt).toBeLessThan(fallbackAt);
  });

  it('never overwrites the real localization locals', () => {
    const realTranslator = () => 'REAL';
    const realUrlFor = () => '/REAL';
    const res = { locals: { t: realTranslator, tc: realTranslator, urlFor: realUrlFor, locale: 'de', htmlLang: 'de', htmlDirection: 'ltr' } };
    const next = jest.fn();

    errorPageFallbackLocals({ headers: {} }, res, next);

    expect(res.locals.t).toBe(realTranslator);
    expect(res.locals.tc).toBe(realTranslator);
    expect(res.locals.urlFor).toBe(realUrlFor);
    expect(res.locals.locale).toBe('de');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('prefixes urlFor with the shared-mount tenant prefix when tenantRouting resolved one', () => {
    const res = { locals: {} };
    errorPageFallbackLocals(
      { headers: {}, accessibleRouting: { prefix: '/hour-timebank/accessible' } },
      res,
      () => {}
    );

    expect(res.locals.urlFor('/')).toBe('/hour-timebank/accessible');
    expect(res.locals.urlFor('/login')).toBe('/hour-timebank/accessible/login');
  });
});
