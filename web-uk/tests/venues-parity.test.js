// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const request = require('supertest');

jest.mock('../src/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(message, status, data = {}) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  },
  ApiOfflineError: class ApiOfflineError extends Error {},
  getPartnerVenues: jest.fn(),
  getVenuePass: jest.fn(),
  rotateVenuePass: jest.fn(),
  getMyVenueVisits: jest.fn(),
  recordVenueVisit: jest.fn()
}));

const api = require('../src/lib/api');
const venuesRouter = require('../src/routes/venues');
const { buildNavItems, flagEnabled } = require('../src/lib/accessible-shell');
const { routeGatesForPath } = require('../src/middleware/tenant-feature-gates');

function testApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.token = 'test-token';
    req.accessibleRouting = { tenantSlug: 'hour-timebank', tenant: { slug: 'hour-timebank' } };
    res.locals.t = (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key);
    res.locals.locale = 'en';
    res.locals.urlFor = (pathname) => `/hour-timebank/accessible${pathname}`;
    res.render = (view, locals) => res.json({ view, locals });
    next();
  });
  app.use('/venues', venuesRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Partner venues gating parity', () => {
  it('is gated on partner_venues with a 403, not the 404 What\'s On uses', () => {
    const gates = routeGatesForPath('/venues');

    expect(gates.map((gate) => gate.featureKey)).toContain('partner_venues');
    // The shared gate table renders 403; Blade gates every venues method with
    // abort_unless(..., 403). Only the public What's On pages answer 404.
    expect(gates.every((gate) => gate.status === undefined)).toBe(true);
  });

  it('covers every venues sub-path, not just the index', () => {
    for (const path of ['/venues', '/venues/pass', '/venues/checkin/abc123']) {
      expect(routeGatesForPath(path).map((g) => g.featureKey)).toContain('partner_venues');
    }
  });

  it('offers the nav item only to signed-in members with the feature', () => {
    const tenant = { features: { partner_venues: true } };

    expect(buildNavItems({ isAuthenticated: true, tenant }).map((i) => i.key)).toContain('venues');
    expect(buildNavItems({ isAuthenticated: false, tenant }).map((i) => i.key)).not.toContain('venues');
    expect(buildNavItems({
      isAuthenticated: true,
      tenant: { features: { partner_venues: false } }
    }).map((i) => i.key)).not.toContain('venues');
  });
});

describe('Opt-in feature defaults match Laravel', () => {
  // 🔴 A key missing from featureDefaults falls through to flagEnabled's
  // `fallback` (true), which silently opts EVERY tenant in. Laravel defaults
  // both of these OFF deliberately: public_events decides whether a community's
  // events appear on the open web to people with no account, and partner_venues
  // exposes a member pass surface. A tenant that has never chosen must get
  // neither.
  it.each(['partner_venues', 'public_events'])('treats %s as off when the tenant has not chosen', (feature) => {
    const tenantWithoutChoice = { slug: 'acme', features: { events: true } };

    expect(flagEnabled(tenantWithoutChoice, feature, 'features', true)).toBe(false);
  });

  it.each(['partner_venues', 'public_events'])('still honours an explicit opt-in for %s', (feature) => {
    expect(flagEnabled({ features: { [feature]: true } }, feature, 'features', true)).toBe(true);
  });

  it('keeps the venues nav item hidden for a tenant that never opted in', () => {
    const keys = buildNavItems({ isAuthenticated: true, tenant: { features: { events: true } } })
      .map((item) => item.key);

    expect(keys).not.toContain('venues');
  });
});

describe('Partner venues directory', () => {
  it('renders the venues list from the data envelope', async () => {
    api.getPartnerVenues.mockResolvedValue({ data: { venues: [{ id: 3, name: 'The Corner Cafe' }] } });

    const response = await request(testApp()).get('/venues');

    expect(response.status).toBe(200);
    expect(response.body.view).toBe('venues/index');
    expect(response.body.locals.venues).toHaveLength(1);
    expect(response.body.locals.venues[0].name).toBe('The Corner Cafe');
  });

  it('renders an empty list rather than failing when the tenant has no venues', async () => {
    api.getPartnerVenues.mockResolvedValue({ data: { venues: [] } });

    const response = await request(testApp()).get('/venues');

    expect(response.status).toBe(200);
    expect(response.body.locals.venues).toEqual([]);
  });
});

describe('Member pass', () => {
  const pass = { qr_url: 'https://hour-timebank.test/hour-timebank/accessible/venues/checkin/abc123XYZ' };

  it('renders the QR server-side as inline SVG so the page works without JavaScript', async () => {
    api.getVenuePass.mockResolvedValue({ data: pass });
    api.getMyVenueVisits.mockResolvedValue({ data: { visits: [] } });

    const response = await request(testApp()).get('/venues/pass');

    expect(response.status).toBe(200);
    expect(response.body.view).toBe('venues/pass');
    expect(response.body.locals.qrSvg).toContain('<svg');
    // No external request and no client-side renderer involved.
    expect(response.body.locals.qrSvg).not.toContain('<script');
    expect(response.body.locals.qrSvg).not.toContain('http://www.w3.org/1999/xlink');
  });

  it('still renders the page when the pass has no encodable QR url', async () => {
    api.getVenuePass.mockResolvedValue({ data: { qr_url: '' } });
    api.getMyVenueVisits.mockResolvedValue({ data: { visits: [] } });

    const response = await request(testApp()).get('/venues/pass');

    expect(response.status).toBe(200);
    // The rotate control is how a member recovers, so the page must not 500.
    expect(response.body.locals.qrSvg).toBeNull();
  });

  it('formats each recorded visit date and shows the rotated banner only when flagged', async () => {
    api.getVenuePass.mockResolvedValue({ data: pass });
    api.getMyVenueVisits.mockResolvedValue({
      data: { visits: [{ venue_name: 'The Corner Cafe', visited_on: '2026-09-04' }] }
    });

    const plain = await request(testApp()).get('/venues/pass');
    expect(plain.body.locals.visits[0].visitedOnLabel).toBe('4 September 2026');
    expect(plain.body.locals.rotated).toBe(false);

    const rotated = await request(testApp()).get('/venues/pass?status=rotated');
    expect(rotated.body.locals.rotated).toBe(true);
  });

  it('rotates then redirects, so a refresh cannot rotate the pass again', async () => {
    api.rotateVenuePass.mockResolvedValue({ data: {} });

    const response = await request(testApp()).post('/venues/pass/rotate').send('');

    expect(api.rotateVenuePass).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/hour-timebank/accessible/venues/pass?status=rotated');
  });
});

describe('Staff check-in', () => {
  it('records nothing on GET, so a link-preview prefetch cannot consume a pass', async () => {
    const response = await request(testApp()).get('/venues/checkin/abc123');

    expect(response.status).toBe(200);
    expect(response.body.view).toBe('venues/checkin');
    expect(response.body.locals.result).toBeNull();
    expect(api.recordVenueVisit).not.toHaveBeenCalled();
  });

  it.each([
    ['GET', (app) => request(app).get('/venues/checkin/not-a-valid-token!')],
    ['POST', (app) => request(app).post('/venues/checkin/not-a-valid-token!').send('')]
  ])('rejects a malformed pass token on %s without calling the API', async (_method, send) => {
    const response = await send(testApp());

    expect(response.status).toBe(404);
    expect(api.recordVenueVisit).not.toHaveBeenCalled();
  });

  it('records the visit on POST and renders the success state', async () => {
    api.recordVenueVisit.mockResolvedValue({
      data: { status: 'recorded', member: { name: 'Ada' }, venue: { name: 'The Corner Cafe' }, visits_this_month: 3 }
    });

    const response = await request(testApp()).post('/venues/checkin/abc123').send('');

    expect(api.recordVenueVisit).toHaveBeenCalledWith('test-token', 'abc123', null);
    expect(response.body.locals.result.status).toBe('recorded');
  });

  it('passes a chosen venue id through as a number', async () => {
    api.recordVenueVisit.mockResolvedValue({ data: { status: 'recorded' } });

    await request(testApp()).post('/venues/checkin/abc123').send('venue_id=42');

    expect(api.recordVenueVisit).toHaveBeenCalledWith('test-token', 'abc123', 42);
  });

  it('offers the venue choices when the service needs one', async () => {
    api.recordVenueVisit.mockResolvedValue({
      data: { status: 'needs_venue', venues: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] }
    });

    const response = await request(testApp()).post('/venues/checkin/abc123').send('');

    expect(response.body.locals.result.status).toBe('needs_venue');
    expect(response.body.locals.venueChoices).toHaveLength(2);
  });

  // The Blade page receives every outcome as a status string because it calls
  // the service directly. The HTTP contract turns two of them into error codes,
  // so they must be mapped back or staff see a dead-end error page.
  it.each([
    [404, 'invalid_pass'],
    [403, 'forbidden']
  ])('maps HTTP %s back to the "%s" page state', async (status, expected) => {
    api.recordVenueVisit.mockRejectedValue(new api.ApiError('nope', status));

    const response = await request(testApp()).post('/venues/checkin/abc123').send('');

    expect(response.status).toBe(200);
    expect(response.body.view).toBe('venues/checkin');
    expect(response.body.locals.result.status).toBe(expected);
  });

  it('does not disguise an unrelated failure as a check-in outcome', async () => {
    api.recordVenueVisit.mockRejectedValue(new api.ApiError('boom', 500));

    const response = await request(testApp()).post('/venues/checkin/abc123').send('');

    expect(response.status).not.toBe(200);
  });
});
