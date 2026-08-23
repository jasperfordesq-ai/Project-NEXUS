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
  // routeHelpers.handleApiError does `error instanceof ApiOfflineError`, so the
  // mock must supply it too — otherwise an unhandled-error test fails with
  // "Right-hand side of 'instanceof' is not an object" instead of exercising
  // the path under test.
  ApiOfflineError: class ApiOfflineError extends Error {},
  getPublicEvents: jest.fn(),
  getPublicEvent: jest.fn()
}));

const api = require('../src/lib/api');
const whatsOnRouter = require('../src/routes/whats-on');
const { buildNavItems } = require('../src/lib/accessible-shell');

function collection(items, meta = {}) {
  return { data: items, meta: { per_page: 20, has_more: false, ...meta } };
}

/**
 * Renders the view model as JSON instead of HTML so assertions target the
 * contract (which values reach the template) rather than markup, and so an
 * added field cannot break an unrelated expectation.
 */
function testApp({ features = { events: true, public_events: true }, isAuthenticated = false } = {}) {
  const app = express();
  app.use((req, res, next) => {
    req.accessibleRouting = { tenantSlug: 'hour-timebank', tenant: { slug: 'hour-timebank', features } };
    res.locals.t = (key) => key;
    res.locals.locale = 'en';
    res.locals.isAuthenticated = isAuthenticated;
    res.render = (view, locals) => res.json({ view, locals });
    next();
  });
  app.use('/whats-on', whatsOnRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("What's On feature gate parity", () => {
  it.each([
    ['events off', { events: false, public_events: true }],
    ['public_events off', { events: true, public_events: false }],
    ['both off', { events: false, public_events: false }]
  ])('answers 404, not 403, when %s', async (_label, features) => {
    const response = await request(testApp({ features })).get('/whats-on');

    expect(response.status).toBe(404);
    expect(response.body.view).toBe('errors/404');
    // A public page that admits it exists but is forbidden invites probing.
    expect(api.getPublicEvents).not.toHaveBeenCalled();
  });

  it('gates the detail page on the same two features', async () => {
    const response = await request(testApp({ features: { events: true, public_events: false } })).get('/whats-on/7');

    expect(response.status).toBe(404);
    expect(api.getPublicEvent).not.toHaveBeenCalled();
  });

  it('renders when both features are on', async () => {
    api.getPublicEvents.mockResolvedValue(collection([]));

    const response = await request(testApp()).get('/whats-on');

    expect(response.status).toBe(200);
    expect(response.body.view).toBe('whats-on/index');
  });
});

describe("What's On index contract", () => {
  it('requests 20 per page and defaults to upcoming', async () => {
    api.getPublicEvents.mockResolvedValue(collection([]));

    await request(testApp()).get('/whats-on');

    expect(api.getPublicEvents).toHaveBeenCalledWith(expect.objectContaining({ per_page: 20, when: 'upcoming' }));
  });

  it.each(['upcoming', 'past', 'all'])('accepts the "%s" window', async (when) => {
    api.getPublicEvents.mockResolvedValue(collection([]));

    const response = await request(testApp()).get(`/whats-on?when=${when}`);

    expect(api.getPublicEvents).toHaveBeenCalledWith(expect.objectContaining({ when }));
    expect(response.body.locals.when).toBe(when);
  });

  it('falls back to upcoming for a window outside the allow-list', async () => {
    api.getPublicEvents.mockResolvedValue(collection([]));

    const response = await request(testApp()).get('/whats-on?when=everything');

    expect(api.getPublicEvents).toHaveBeenCalledWith(expect.objectContaining({ when: 'upcoming' }));
    expect(response.body.locals.when).toBe('upcoming');
  });

  it('treats a rejected cursor as a fresh first page rather than an error', async () => {
    api.getPublicEvents
      .mockRejectedValueOnce(new api.ApiError('Invalid cursor', 422))
      .mockResolvedValueOnce(collection([{ id: 1, title: 'Repair cafe' }]));

    const response = await request(testApp()).get('/whats-on?cursor=garbled');

    expect(response.status).toBe(200);
    expect(api.getPublicEvents).toHaveBeenCalledTimes(2);
    expect(api.getPublicEvents.mock.calls[1][0]).not.toHaveProperty('cursor');
  });

  it('does not swallow a non-cursor failure', async () => {
    api.getPublicEvents.mockRejectedValue(new api.ApiError('Boom', 500));

    const response = await request(testApp()).get('/whats-on');

    expect(response.status).not.toBe(200);
    expect(api.getPublicEvents).toHaveBeenCalledTimes(1);
  });

  it('publishes a next cursor only when the API reports more results', async () => {
    api.getPublicEvents.mockResolvedValue(collection([{ id: 1 }], { has_more: false, cursor: 'abc' }));
    const withoutMore = await request(testApp()).get('/whats-on');
    expect(withoutMore.body.locals.nextCursor).toBeNull();

    api.getPublicEvents.mockResolvedValue(collection([{ id: 1 }], { has_more: true, cursor: 'abc' }));
    const withMore = await request(testApp()).get('/whats-on');
    expect(withMore.body.locals.nextCursor).toBe('abc');
  });

  it('keeps a literal "0" search term instead of dropping it as falsy', async () => {
    api.getPublicEvents.mockResolvedValue(collection([]));

    const response = await request(testApp()).get('/whats-on?q=0');

    expect(api.getPublicEvents).toHaveBeenCalledWith(expect.objectContaining({ q: '0' }));
    expect(response.body.locals.search).toBe('0');
  });

  it('formats the listed time in the event timezone, and omits the time for an all-day event', async () => {
    api.getPublicEvents.mockResolvedValue(collection([
      { id: 1, title: 'Timed', start_time: '2026-09-04T18:30:00Z', timezone: 'UTC', all_day: false },
      { id: 2, title: 'All day', start_time: '2026-09-04T18:30:00Z', timezone: 'UTC', all_day: true }
    ]));

    const response = await request(testApp()).get('/whats-on');
    const [timed, allDay] = response.body.locals.events;

    // Finding 17 (i18n audit): hour12 is no longer forced — en-GB renders its own 24-hour clock.
    expect(timed.whenLabel).toBe('4 September 2026, 18:30');
    expect(allDay.whenLabel).toBe('4 September 2026');
  });
});

describe("What's On detail contract", () => {
  it('does not call the API for a non-numeric id', async () => {
    const response = await request(testApp()).get('/whats-on/not-a-number');

    expect(response.status).toBe(404);
    expect(api.getPublicEvent).not.toHaveBeenCalled();
  });

  it('renders a 404 page when the event is absent or not publicly visible', async () => {
    api.getPublicEvent.mockRejectedValue(new api.ApiError('Not found', 404));

    const response = await request(testApp()).get('/whats-on/99');

    expect(response.status).toBe(404);
    expect(response.body.view).toBe('errors/404');
  });

  it('unwraps the data envelope and formats both ends of the event', async () => {
    api.getPublicEvent.mockResolvedValue({
      data: {
        id: 12,
        title: 'Community lunch',
        start_time: '2026-09-04T12:00:00Z',
        end_time: '2026-09-04T14:00:00Z',
        timezone: 'UTC',
        all_day: false
      }
    });

    const response = await request(testApp()).get('/whats-on/12');

    expect(response.body.view).toBe('whats-on/detail');
    expect(response.body.locals.event.title).toBe('Community lunch');
    // Finding 17 (i18n audit): en-GB renders its own 24-hour clock now that hour12 is not forced.
    expect(response.body.locals.startsAt).toBe('4 September 2026, 12:00');
    expect(response.body.locals.endsAt).toBe('4 September 2026, 14:00');
  });
});

describe("What's On navigation parity", () => {
  const tenant = { features: { events: true, public_events: true, connections: true } };

  it("offers What's On to anonymous visitors and withholds the member Events link", () => {
    const keys = buildNavItems({ isAuthenticated: false, tenant }).map((item) => item.key);

    expect(keys).toContain('whats_on');
    // Blade unsets 'events' for this visitor; showing both would send an
    // anonymous visitor to a sign-in redirect.
    expect(keys).not.toContain('events');
  });

  it('offers Events, not What\'s On, once signed in', () => {
    const keys = buildNavItems({ isAuthenticated: true, tenant }).map((item) => item.key);

    expect(keys).toContain('events');
    expect(keys).not.toContain('whats_on');
  });

  it("withholds What's On when public_events is off, leaving Events for members", () => {
    const off = { features: { events: true, public_events: false } };

    expect(buildNavItems({ isAuthenticated: false, tenant: off }).map((i) => i.key)).not.toContain('whats_on');
    expect(buildNavItems({ isAuthenticated: true, tenant: off }).map((i) => i.key)).toContain('events');
  });
});
