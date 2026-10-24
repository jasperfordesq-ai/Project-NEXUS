// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Your own profile links each activity figure to your own records, matching
 * the main website (react-frontend ProfilePage, 24 Oct 2026):
 *   Hours given / received -> /wallet
 *   Active listings        -> /listings/mine        (new page, GET /v2/listings/mine)
 *   Groups                 -> /groups?filter=joined (existing filter, member=me)
 *   Events                 -> /events?scope=mine    (new filter, GET /v2/events?scope=mine)
 * A link is offered only where the community has that part switched on, and
 * each "my" view refuses a signed-out visitor by sending them to sign in.
 */
const express = require('express');
const session = require('express-session');
const request = require('supertest');
const nunjucks = require('nunjucks');
const path = require('node:path');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');

jest.mock('../src/lib/api', () => {
  class ApiError extends Error {
    constructor(message, status, data = {}) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  }
  return new Proxy({
    ApiError,
    ApiOfflineError: class ApiOfflineError extends Error {},
    getProfile: jest.fn(),
    getMyListings: jest.fn(),
    getEvents: jest.fn(),
    getEventCategories: jest.fn(),
    getGroups: jest.fn(),
    callAdminEventApi: jest.fn(),
  }, {
    get: (target, prop) => (prop in target ? target[prop] : jest.fn().mockResolvedValue({ data: [] })),
  });
});

jest.mock('../src/lib/auditLogger', () => ({
  audit: new Proxy({}, { get: () => () => (req, res, next) => next() }),
}));

const api = require('../src/lib/api');
const profileRoutes = require('../src/routes/profile');
const listingsRoutes = require('../src/routes/listings');
const eventsRoutes = require('../src/routes/events');
const groupsRoutes = require('../src/routes/groups');

const t = createTranslator('en');

function mount(routes, { signedIn = true, tenant = { id: 2, slug: 'test' } } = {}) {
  const app = express();
  const environment = nunjucks.configure(
    [path.join(__dirname, '..', 'src', 'views'),
      path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
    { autoescape: true, noCache: true, express: app }
  );
  require('../src/lib/template-filters').registerTemplateFilters(environment);
  environment.addFilter('nl2br', (value) => value);
  app.set('view engine', 'njk');
  app.use(session({ secret: 'own-records-links-test-secret-32-chars!!', resave: false, saveUninitialized: false }));
  app.use('/', (req, res, next) => {
    req.signedCookies = signedIn ? { token: 'token:test' } : {};
    if (signedIn) req.token = 'token:test';
    req.csrfToken = () => 'csrf';
    req.flash = () => [];
    req.t = createTranslator('en');
    req.accessibleRouting = { mode: 'shared', tenantSlug: 'test', prefix: '/test/accessible', tenant };
    res.locals.urlFor = (v) => `/test/accessible${String(v || '/')}`;
    Object.assign(res.locals, {
      serviceName: 'Project NEXUS',
      tenantName: 'Test',
      isAuthenticated: signedIn,
      csrfToken: 'csrf',
      t: createTranslator('en'),
      tc: createChoiceTranslator('en'),
      htmlLang: 'en',
      htmlDirection: 'ltr',
      formatLocaleDate: () => '24 October 2026',
    });
    next();
  }, routes);
  return app;
}

const ownProfile = {
  data: {
    id: 42,
    first_name: 'Ada',
    last_name: 'Lovelace',
    name: 'Ada Lovelace',
    total_hours_given: 3.5,
    total_hours_received: 2,
    groups_count: 4,
    events_attended: 7,
    stats: { listings_count: 5, groups_count: 4, events_attended: 7 },
  },
};

function statItem(html, key) {
  const match = html.match(new RegExp(`<div class="nexus-alpha-stat" data-profile-stat="${key}">([\\s\\S]*?)</div>`));
  return match ? match[1] : null;
}

describe('own profile activity figures link to your own records', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.getProfile.mockResolvedValue(ownProfile);
  });

  it('links hours, listings, groups and events to the wallet and the "my" views', async () => {
    const res = await request(mount(profileRoutes)).get('/');
    expect(res.status).toBe(200);

    const expected = {
      'hours-given': '/test/accessible/wallet',
      'hours-received': '/test/accessible/wallet',
      listings: '/test/accessible/listings/mine',
      groups: '/test/accessible/groups?filter=joined',
      events: '/test/accessible/events?scope=mine',
    };
    for (const [key, href] of Object.entries(expected)) {
      const item = statItem(res.text, key);
      expect(item).not.toBeNull();
      // A real GOV.UK link inside the <dt>, never a script-driven clickable box.
      expect(item).toMatch(new RegExp(`<dt><a class="govuk-link" href="${href.replace(/[?]/g, '\\?')}">`));
      expect(item).toContain('<span class="govuk-visually-hidden">');
    }
    expect(statItem(res.text, 'groups')).toContain('<dd>4</dd>');
    expect(statItem(res.text, 'events')).toContain('<dd>7</dd>');
    expect(statItem(res.text, 'listings')).toContain('<dd>5</dd>');
    expect(res.text).toContain(t('govuk_alpha.own_records.open_wallet'));
  });

  it('leaves a figure as plain text, or hides it, when that part of the community is switched off', async () => {
    const tenant = {
      id: 2,
      slug: 'test',
      modules: { wallet: false, listings: false },
      features: { groups: false, events: false },
    };
    const res = await request(mount(profileRoutes, { tenant })).get('/');
    expect(res.status).toBe(200);
    expect(statItem(res.text, 'hours-given')).not.toContain('<a ');
    expect(statItem(res.text, 'listings')).not.toContain('<a ');
    expect(statItem(res.text, 'groups')).toBeNull();
    expect(statItem(res.text, 'events')).toBeNull();
    expect(res.text).not.toContain('/listings/mine');
    expect(res.text).not.toContain('scope=mine');
  });
});

describe('My listings (/listings/mine)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reads GET /v2/listings/mine for the chosen status and type, and renders the status links with counts', async () => {
    api.getMyListings.mockResolvedValue({
      data: [{ id: 9, title: 'Dog walking', type: 'offer', owner_state: 'expired' }],
      meta: { counts: { live: 2, review: 0, rejected: 0, expired: 1, closed: 3 }, has_more: true, cursor: 'abc' },
    });
    const res = await request(mount(listingsRoutes)).get('/mine?status=expired&type=offer');
    expect(res.status).toBe(200);
    expect(api.getMyListings).toHaveBeenCalledWith('token:test', { status: 'expired', limit: 20, type: 'offer' });
    expect(res.text).toContain(t('govuk_alpha.own_records.my_listings'));
    expect(res.text).toContain('href="/test/accessible/listings/9"');
    expect(res.text).toContain('href="/test/accessible/listings/9/edit"');
    // Live and Expired always show; Closed shows because it has listings; empty review/rejected do not.
    expect(res.text).toContain(`${t('govuk_alpha.own_records.status.live')} (2)`);
    expect(res.text).toContain(`${t('govuk_alpha.own_records.status.closed')} (3)`);
    expect(res.text).not.toContain(`${t('govuk_alpha.own_records.status.review')} (0)`);
    expect(res.text).toMatch(/aria-current="page">Expired \(1\)/);
    expect(res.text).toContain('/listings/mine?status=expired&amp;type=offer&amp;cursor=abc');
  });

  it('falls back to live for an unknown status', async () => {
    api.getMyListings.mockResolvedValue({ data: [], meta: { counts: {} } });
    const res = await request(mount(listingsRoutes)).get('/mine?status=everything');
    expect(res.status).toBe(200);
    expect(api.getMyListings).toHaveBeenCalledWith('token:test', { status: 'live', limit: 20 });
    expect(res.text).toContain(t('govuk_alpha.own_records.my_listings_empty'));
  });

  it('sends a signed-out visitor to sign in without calling the API', async () => {
    const res = await request(mount(listingsRoutes, { signedIn: false })).get('/mine');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/login/);
    expect(api.getMyListings).not.toHaveBeenCalled();
  });

  it('offers My listings from the listings index', async () => {
    api.getListings.mockResolvedValue({ data: [], meta: {} });
    const res = await request(mount(listingsRoutes)).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('href="/test/accessible/listings/mine"');
  });
});

describe('My events (/events?scope=mine)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.getEventCategories.mockResolvedValue({ data: [] });
    api.callAdminEventApi.mockRejectedValue(new api.ApiError('forbidden', 403));
  });

  it('passes scope=mine to the events API and keeps it in the heading and the next-page link', async () => {
    api.getEvents.mockResolvedValue({ data: [], meta: { has_more: false } });
    const res = await request(mount(eventsRoutes)).get('/?scope=mine&when=past');
    expect(res.status).toBe(200);
    expect(api.getEvents).toHaveBeenCalledWith('token:test', expect.objectContaining({ scope: 'mine', when: 'past' }));
    expect(res.text).toContain(`<h1 class="govuk-heading-xl">${t('govuk_alpha.own_records.my_events')}</h1>`);
    expect(res.text).toContain('<input type="hidden" name="scope" value="mine">');
    expect(res.text).toContain(t('govuk_alpha.own_records.my_events_empty'));
  });

  it('does not send scope for the ordinary list, and offers a My events button', async () => {
    api.getEvents.mockResolvedValue({ data: [], meta: { has_more: false } });
    const res = await request(mount(eventsRoutes)).get('/');
    expect(res.status).toBe(200);
    expect(api.getEvents.mock.calls[0][1]).not.toHaveProperty('scope');
    expect(res.text).toContain('href="/test/accessible/events?scope=mine"');
  });

  it('sends a signed-out visitor to sign in instead of showing everyone’s events', async () => {
    const res = await request(mount(eventsRoutes, { signedIn: false })).get('/?scope=mine');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/login/);
    expect(api.getEvents).not.toHaveBeenCalled();
  });
});

describe('My groups (/groups?filter=joined)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('offers a My groups button on the groups index, and asks the API for the member’s own groups', async () => {
    api.getGroups.mockResolvedValue({ data: [], meta: {} });
    const all = await request(mount(groupsRoutes)).get('/');
    expect(all.status).toBe(200);
    expect(all.text).toContain('href="/test/accessible/groups?filter=joined"');

    const mine = await request(mount(groupsRoutes)).get('/?filter=joined');
    expect(mine.status).toBe(200);
    expect(api.getGroups).toHaveBeenLastCalledWith('token:test', expect.objectContaining({ member: 'me' }));
    expect(mine.text).toContain(t('govuk_alpha.own_records.all_groups'));
  });
});
