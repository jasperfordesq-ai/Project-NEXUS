// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * AWID feedback (Nov 2026): "warmth, and community". When a member's
 * confirmation completes an exchange, the page shows a GOV.UK confirmation
 * panel and their own figures for the year (the API's `thanks`), once — as the
 * React site does. Any other action keeps the ordinary "updated" banner.
 */

const express = require('express');
const path = require('path');
const nunjucks = require('nunjucks');
const request = require('supertest');

jest.mock('../src/lib/api', () => {
  class ApiError extends Error {
    constructor(message, status, data = {}) {
      super(message);
      this.status = status;
      this.data = data;
    }
  }
  return new Proxy({ ApiError, ApiOfflineError: class ApiOfflineError extends Error {} }, {
    get(target, prop) {
      if (!(prop in target)) target[prop] = jest.fn();
      return target[prop];
    }
  });
});
jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, res, next) => next(),
  withTokenRefresh: (handler) => handler
}));
jest.mock('../src/lib/request-profile', () => ({ getRequestProfile: jest.fn(async () => ({ data: { id: 11 } })) }));

const api = require('../src/lib/api');
const { createTranslator, createChoiceTranslator } = require('../src/lib/localization');
const { rememberExchangeThanks, takeExchangeThanks } = require('../src/lib/exchange-thanks');
const exchangesRouter = require('../src/routes/exchanges');

const viewsDir = path.join(__dirname, '..', 'src', 'views');
const env = new nunjucks.Environment(new nunjucks.FileSystemLoader([
  viewsDir, path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')
]), { autoescape: true });
require('../src/lib/template-filters').registerTemplateFilters(env);
env.addFilter('nl2br', (value) => value);

function createApp(session, tenant = { modules: {}, features: {} }) {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    const t = createTranslator('en');
    req.token = 'test-token';
    req.session = session;
    req.flash = jest.fn(() => []);
    req.accessibleRouting = { tenant };
    res.locals.t = t;
    res.locals.tc = createChoiceTranslator('en');
    res.locals.urlFor = (value) => value;
    res.render = (view, locals = {}) => res.send(env.render(`${view}.njk`, { ...res.locals, ...locals }));
    next();
  });
  app.use('/exchanges', exchangesRouter);
  // Shows a template error in the failure instead of an empty page.
  app.use((error, req, res, next) => res.status(500).send(`RENDER-ERROR ${error.message}`)); // eslint-disable-line no-unused-vars
  return app;
}

const completed = {
  id: 4, status: 'completed', listing_id: 3, listing_title: 'Garden help', requester_id: 11, provider_id: 12,
  requester_name: 'Aoife', provider_name: 'Brian', proposed_hours: 2, final_hours: 2
};

beforeEach(() => {
  jest.clearAllMocks();
  api.getExchange.mockResolvedValue({ data: completed });
  api.getExchangeRatings.mockResolvedValue({ data: { ratings: [], has_rated: false } });
});

describe('exchange thank-you', () => {
  it('remembers the figures only when the API says the exchange is complete', () => {
    const req = { session: {} };
    expect(rememberExchangeThanks(req, 4, { data: { status: 'pending_confirmation' } })).toBe(false);
    expect(req.session.exchangeThanks).toBeUndefined();
    expect(rememberExchangeThanks(req, 4, { data: { status: 'completed', thanks: { neighbours_this_year: 3, hours_this_year: 7.5 } } })).toBe(true);
    expect(req.session.exchangeThanks).toEqual({ id: 4, neighbours: 3, hours: 7.5 });
  });

  it('is shown once, only for that exchange, and only when it is complete', () => {
    const req = { session: { exchangeThanks: { id: 4, neighbours: 3, hours: 7.5 } } };
    expect(takeExchangeThanks(req, 9, 'completed', 'exchange-completed')).toEqual({ figures: null });
    expect(req.session.exchangeThanks).toBeDefined();
    expect(takeExchangeThanks(req, 4, 'completed', 'exchange-completed')).toEqual({ figures: { neighbours: 3, hours: 7.5 } });
    expect(req.session.exchangeThanks).toBeUndefined();
    expect(takeExchangeThanks({ session: {} }, 4, 'in_progress', 'exchange-completed')).toBeNull();
    expect(takeExchangeThanks({ session: {} }, 4, 'completed', 'exchange-updated')).toBeNull();
  });

  it('redirects a completing confirmation to the thank-you, and shows it with this year\'s figures', async () => {
    const session = {};
    const app = createApp(session);
    api.performExchangeAction.mockResolvedValue({
      data: { ...completed, thanks: { neighbours_this_year: 3, hours_this_year: 7.5 } }
    });

    const post = await request(app).post('/exchanges/4').type('form').send({ action: 'confirm', hours: '2' });
    expect(post.status).toBe(302);
    expect(post.headers.location).toBe('/exchanges/4?status=exchange-completed');

    const page = await request(app).get('/exchanges/4?status=exchange-completed');
    const html = page.text.replace(/\s+/g, ' ');
    expect(html).toContain('<div class="govuk-panel govuk-panel--confirmation" id="exchange-thanks">');
    expect(html).toContain('<h2 class="govuk-panel__title"> Thank you </h2>');
    expect(html).toContain('People you&#39;ve exchanged with this year </dt> <dd class="govuk-summary-list__value"> 3 </dd>');
    expect(html).toContain('Hours exchanged this year </dt> <dd class="govuk-summary-list__value"> 7.5 </dd>');
    expect(html).toContain('<a class="govuk-link" href="/messages/12">Send Brian a thank-you message</a>');
    expect(html).not.toContain('govuk-notification-banner--success');

    // Once only: a reload is the ordinary page.
    const again = await request(app).get('/exchanges/4?status=exchange-completed');
    expect(again.text).toContain('govuk-panel--confirmation');
    expect(again.text).not.toContain('People you&#39;ve exchanged with this year');
  });

  it('keeps the ordinary banner for any other action, and the panel never offers a message link when messaging is off', async () => {
    const session = {};
    api.performExchangeAction.mockResolvedValue({ data: { ...completed, status: 'pending_confirmation' } });
    const post = await request(createApp(session)).post('/exchanges/4').type('form').send({ action: 'confirm', hours: '2' });
    expect(post.headers.location).toBe('/exchanges/4?status=exchange-updated');

    const page = await request(createApp({}, { modules: { messages: false } })).get('/exchanges/4?status=exchange-completed');
    expect(page.text).toContain('govuk-panel--confirmation');
    expect(page.text).not.toContain('thank-you message');
  });
});
