// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Organisers manage an opportunity's shifts on the accessible site
 * (routes/volunteering-shifts.js). Until 2026-10-06 nothing here could create, change or
 * remove a shift: the organiser's own opportunity page offered them the volunteer "Apply"
 * form instead.
 *
 * Pinned here:
 * - the opportunity page shows "Manage shifts" and "Who's coming" to the people who run
 *   it, and the Apply form to everyone else;
 * - the list separates upcoming from past shifts, says how full each is, and shows the
 *   active repeating patterns;
 * - add, change, remove and stop call the right endpoints with the right bodies;
 * - the form is checked locally first, keeps what was typed, and a 400 from the API is
 *   shown on the field it names;
 * - a community with repeating shifts switched off sees no repeating half at all;
 * - who's coming reads "Coming" before the shift starts, and attendance after;
 * - anyone who cannot manage the opportunity gets the 403 page and no shift data.
 */

const path = require('path');
const express = require('express');
const session = require('express-session');
const nunjucks = require('nunjucks');
const request = require('supertest');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');
const { registerTemplateFilters } = require('../src/lib/template-filters');

jest.mock('../src/lib/api', () => {
  class ApiError extends Error {
    constructor(message, status, data) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  }
  return {
    ApiError,
    ApiOfflineError: class ApiOfflineError extends Error {},
    callVolunteeringApi: jest.fn(),
    downloadVolunteerCredential: jest.fn(),
    getVolunteeringCategories: jest.fn(),
    searchUsers: jest.fn(),
    uploadVolunteerCredential: jest.fn(),
    getProfile: jest.fn(),
    invalidateUserCache: jest.fn()
  };
});

const api = require('../src/lib/api');
const volunteeringShiftRoutes = require('../src/routes/volunteering-shifts');
const volunteeringActionRoutes = require('../src/routes/volunteering-actions');

const PREFIX = '/acme/accessible';
const MOUNT = `${PREFIX}/volunteering`;
const VIEWS = path.join(__dirname, '..', 'src', 'views');
const GOVUK = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');
const t = createTranslator('en');
const K = 'govuk_alpha_volunteering.shift_manager.';

function locals(res) {
  res.locals.urlFor = (value) => {
    const target = String(value || '/');
    return target.startsWith(PREFIX) ? target : `${PREFIX}${target.startsWith('/') ? target : `/${target}`}`;
  };
  Object.assign(res.locals, {
    serviceName: 'Project NEXUS',
    tenantName: 'Acme Timebank',
    isAuthenticated: true,
    csrfToken: 'test-csrf-token',
    alphaNavItems: [],
    feedbackUrl: `${PREFIX}/feedback`,
    currentPath: MOUNT,
    alphaLocaleOptions: [],
    alphaLanguageQueryParams: [],
    htmlLang: 'en',
    htmlDirection: 'ltr',
    t: createTranslator('en'),
    tc: createChoiceTranslator('en'),
    formatLocaleNumber: (value) => String(value ?? ''),
    formatLocaleDate: (value) => String(value ?? '')
  });
}

function createApp() {
  const app = express();
  const env = nunjucks.configure([VIEWS, GOVUK], { autoescape: true, express: app, watch: false });
  registerTemplateFilters(env);
  env.addFilter('formatDate', (value) => String(value || ''));
  env.addFilter('formatEventDate', (value) => String(value || ''));
  env.addFilter('date', (value) => String(value || ''));
  env.addFilter('nl2br', (value) => String(value || ''));

  app.set('view engine', 'njk');
  app.set('views', VIEWS);
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'shift-management-test-secret', resave: false, saveUninitialized: false }));

  // The opportunity page itself lives in server.js; render its template directly with
  // an opportunity shaped the way server.js normalises it.
  app.get(`${MOUNT}/opportunities/:id/__page`, (req, res) => {
    locals(res);
    res.render('volunteer-opportunity', {
      title: 'Food bank',
      opportunity: JSON.parse(String(req.query.opportunity)),
      opportunityId: req.params.id,
      authRequired: false,
      status: null,
      csrfToken: 'test-csrf-token'
    });
  });

  app.use(MOUNT, (req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.accessibleRouting = {
      mode: 'shared',
      tenantSlug: 'acme',
      tenant: { id: 2, slug: 'acme', name: 'Acme Timebank', settings: {} },
      prefix: PREFIX
    };
    locals(res);
    next();
  }, volunteeringShiftRoutes, volunteeringActionRoutes);

  return app;
}

const OPPORTUNITY = { id: 131, title: 'Food bank sorting', can_manage: true, is_owner: false };

const SHIFTS = [
  // Upcoming, limited, one volunteer and two group places taken.
  { id: 71, start_time: '2099-03-27 09:00:00', end_time: '2099-03-27 12:00:00', capacity: 5, signup_count: 2, reserved_count: 1, spots_available: 2, recurring_pattern_id: null },
  // Upcoming, no limit, from a repeating pattern.
  { id: 72, start_time: '2099-03-30 14:00:00', end_time: '2099-03-30 16:30:00', capacity: null, signup_count: 3, reserved_count: 0, spots_available: null, recurring_pattern_id: 2 },
  // Already happened.
  { id: 60, start_time: '2020-01-06 10:00:00', end_time: '2020-01-06 11:00:00', capacity: 2, signup_count: 1, reserved_count: 0, spots_available: 1, recurring_pattern_id: null }
];

const PATTERNS = [
  { id: 2, frequency: 'weekly', days_of_week: [3, 1], start_time: '09:00:00', end_time: '12:00:00', capacity: 4, start_date: '2099-01-01', end_date: null, max_occurrences: null, occurrences_generated: 6, is_active: true },
  { id: 3, frequency: 'daily', days_of_week: [], start_time: '08:00:00', end_time: '09:00:00', capacity: 1, start_date: '2099-01-01', end_date: null, max_occurrences: null, occurrences_generated: 0, is_active: false }
];

const ROSTER = {
  summary: { signed_up: 2, checked_in: 0, no_show: 0, group_places: 3, waiting: 2 },
  volunteers: [
    { user: { id: 11, name: 'Ada Lovelace' }, check_in_status: null, checked_in_at: null, checked_out_at: null },
    { user: { id: 12, name: 'Alan Turing' }, check_in_status: 'pending', checked_in_at: null, checked_out_at: null }
  ],
  groups: [
    { id: 5, group_name: 'Rotary Club', reserved_slots: 3, leader: { id: 20, name: 'Grace Hopper' }, members: [{ id: 21, name: 'Katherine Johnson' }] }
  ],
  waitlist: [
    { user: { id: 31, name: 'Second Waiter' }, position: 2 },
    { user: { id: 30, name: 'First Waiter' }, position: 1 }
  ]
};

function apiError(status, data) {
  return new api.ApiError('refused', status, data);
}

function mockApi(overrides = {}) {
  const options = {
    opportunity: OPPORTUNITY,
    shifts: SHIFTS,
    patterns: PATTERNS,
    patternsError: null,
    roster: ROSTER,
    writeError: null,
    ...overrides
  };
  api.callVolunteeringApi.mockImplementation(async (token, method, apiPath) => {
    if (method === 'GET' && apiPath === '/opportunities/131') return { data: options.opportunity };
    if (method === 'GET' && apiPath === '/opportunities/131/shifts') return { data: options.shifts };
    if (method === 'GET' && apiPath === '/opportunities/131/recurring-patterns') {
      if (options.patternsError) throw options.patternsError;
      return { data: { patterns: options.patterns } };
    }
    if (method === 'GET' && /^\/shifts\/\d+\/roster$/.test(apiPath)) return { data: options.roster };
    if (options.writeError) throw options.writeError;
    if (method === 'POST' && apiPath === '/opportunities/131/shifts') return { data: { id: 99 } };
    if (method === 'PUT' && apiPath === '/shifts/71') return { data: { id: 71 } };
    if (method === 'DELETE' && apiPath === '/shifts/71') return { data: { deleted: true, affected_volunteers: 2 } };
    if (method === 'POST' && apiPath === '/opportunities/131/recurring-patterns') return { data: { id: 9, shifts_generated: 4 } };
    if (method === 'DELETE' && apiPath === '/recurring-patterns/2') return { data: { future_shifts_removed: 5 } };
    throw apiError(500, {});
  });
}

function writes() {
  return api.callVolunteeringApi.mock.calls.filter(([, method]) => method !== 'GET');
}

const VALID_SHIFT = {
  _csrf: 'test-csrf-token',
  'date-day': '27',
  'date-month': '3',
  'date-year': '2099',
  start_time: '9:30am',
  end_time: '12:00',
  capacity: '4'
};

beforeEach(() => {
  api.callVolunteeringApi.mockReset();
  mockApi();
});

describe('the opportunity page', () => {
  function page(opportunity) {
    return request(createApp())
      .get(`${MOUNT}/opportunities/131/__page`)
      .query({ opportunity: JSON.stringify(opportunity) });
  }

  it('offers the people who run it "Manage shifts" and "Who\'s coming" instead of the Apply form', async () => {
    const res = await page({
      title: 'Food bank sorting',
      canManage: true,
      shifts: [{ id: 71, start_time: '2099-03-27 09:00:00', end_time: '2099-03-27 12:00:00' }]
    });

    expect(res.status).toBe(200);
    expect(res.text).toContain(`href="${MOUNT}/opportunities/131/shifts"`);
    expect(res.text).toContain(t(`${K}manage_link`));
    expect(res.text).toContain(`href="${MOUNT}/opportunities/131/shifts/71/roster"`);
    expect(res.text).toContain(t(`${K}manager_notice`));
    expect(res.text).not.toContain(`action="${MOUNT}/opportunities/131/apply"`);
  });

  it('shows volunteers the Apply form and no management links', async () => {
    const res = await page({
      title: 'Food bank sorting',
      canManage: false,
      shifts: [{ id: 71, start_time: '2099-03-27 09:00:00', end_time: '2099-03-27 12:00:00' }]
    });

    expect(res.text).toContain(`action="${MOUNT}/opportunities/131/apply"`);
    expect(res.text).not.toContain(`${MOUNT}/opportunities/131/shifts"`);
    expect(res.text).not.toContain('/roster');
    expect(res.text).not.toContain(t(`${K}manager_notice`));
  });
});

describe('the manage-shifts page', () => {
  it('lists upcoming shifts with how full they are, past shifts apart, and the active patterns', async () => {
    const res = await request(createApp()).get(`${MOUNT}/opportunities/131/shifts`);

    expect(res.status).toBe(200);
    expect(api.callVolunteeringApi).toHaveBeenCalledWith('test-token', 'GET', '/opportunities/131');
    expect(api.callVolunteeringApi).toHaveBeenCalledWith('test-token', 'GET', '/opportunities/131/shifts');
    expect(api.callVolunteeringApi).toHaveBeenCalledWith('test-token', 'GET', '/opportunities/131/recurring-patterns');

    expect(res.text).toContain('Food bank sorting');
    expect(res.text).toContain('Friday, 27 March 2099');
    expect(res.text).toContain('09:00 to 12:00');
    // A volunteer plus the group's place count as taken, like the website.
    expect(res.text).toContain(t(`${K}places_of`, { taken: 3, capacity: 5 }));
    expect(res.text).toContain(t(`${K}signed_up`, { count: 3 }));
    expect(res.text).toContain(t(`${K}repeating_tag`));
    for (const action of ['roster', 'edit', 'remove']) {
      expect(res.text).toContain(`href="${MOUNT}/opportunities/131/shifts/71/${action}"`);
    }

    // Past shifts sit behind a details toggle and can only be looked at.
    expect(res.text).toContain(t(`${K}past_heading`, { count: 1 }));
    expect(res.text).toContain(`href="${MOUNT}/opportunities/131/shifts/60/roster"`);
    expect(res.text).not.toContain(`${MOUNT}/opportunities/131/shifts/60/edit`);
    expect(res.text).not.toContain(`${MOUNT}/opportunities/131/shifts/60/remove`);

    // Only the active pattern, with its days in order.
    expect(res.text).toContain(t(`${K}frequency_weekly`));
    expect(res.text).toContain('Monday, Wednesday');
    expect(res.text).toContain(`href="${MOUNT}/opportunities/131/repeating/2/stop"`);
    expect(res.text).not.toContain('/repeating/3/stop');
    expect(res.text).toContain(`href="${MOUNT}/opportunities/131/shifts/new"`);
    expect(res.text).toContain(`href="${MOUNT}/opportunities/131/repeating/new"`);
  });

  it('hides the repeating half quietly when the community has switched it off', async () => {
    mockApi({ patternsError: apiError(403, { errors: [{ code: 'FEATURE_DISABLED', message: 'Off' }] }) });
    const res = await request(createApp()).get(`${MOUNT}/opportunities/131/shifts`);

    expect(res.status).toBe(200);
    expect(res.text).toContain(t(`${K}add_shift`));
    expect(res.text).not.toContain(`${MOUNT}/opportunities/131/repeating/new`);
    expect(res.text).not.toContain(`>${t(`${K}patterns_heading`)}</h2>`);

    const form = await request(createApp()).get(`${MOUNT}/opportunities/131/repeating/new`);
    expect(form.status).toBe(302);
    expect(form.headers.location).toBe(`${MOUNT}/opportunities/131/shifts?status=repeating-off`);
  });

  it('refuses anyone who cannot manage the opportunity, and loads no shift data for them', async () => {
    mockApi({ opportunity: { ...OPPORTUNITY, can_manage: false, is_owner: false } });
    const app = createApp();

    for (const pagePath of ['/shifts', '/shifts/new', '/shifts/71/edit', '/shifts/71/remove', '/shifts/71/roster', '/repeating/new', '/repeating/2/stop']) {
      const res = await request(app).get(`${MOUNT}/opportunities/131${pagePath}`);
      expect(res.status).toBe(403);
      expect(res.text).toContain(t('error_pages.403_title'));
    }
    const calledPaths = api.callVolunteeringApi.mock.calls.map(([, , apiPath]) => apiPath);
    expect(calledPaths.every((apiPath) => apiPath === '/opportunities/131')).toBe(true);
  });

  it('lets the opportunity\'s creator in on is_owner alone', async () => {
    mockApi({ opportunity: { ...OPPORTUNITY, can_manage: false, is_owner: true } });
    const res = await request(createApp()).get(`${MOUNT}/opportunities/131/shifts`);
    expect(res.status).toBe(200);
  });

  it('gives the API\'s own refusal the 403 page when a write is refused', async () => {
    mockApi({ writeError: apiError(403, { errors: [{ code: 'FORBIDDEN', message: 'Forbidden' }] }) });
    const res = await request(createApp()).post(`${MOUNT}/opportunities/131/shifts/new`).type('form').send(VALID_SHIFT);
    expect(res.status).toBe(403);
  });
});

describe('adding and changing a shift', () => {
  it('adds a shift with naive local times and comes back with a confirmation', async () => {
    const agent = request.agent(createApp());
    const post = await agent.post(`${MOUNT}/opportunities/131/shifts/new`).type('form').send(VALID_SHIFT);

    expect(post.status).toBe(302);
    expect(post.headers.location).toBe(`${MOUNT}/opportunities/131/shifts?status=shift-created`);
    expect(writes()).toEqual([[
      'test-token', 'POST', '/opportunities/131/shifts',
      { start_time: '2099-03-27 09:30:00', end_time: '2099-03-27 12:00:00', capacity: 4 }
    ]]);

    const page = await agent.get(post.headers.location);
    expect(page.text).toContain(t(`${K}shift_created`));
  });

  it('sends no limit when places is left blank', async () => {
    await request(createApp()).post(`${MOUNT}/opportunities/131/shifts/new`).type('form').send({ ...VALID_SHIFT, capacity: '' });
    expect(writes()[0][3].capacity).toBeNull();
  });

  it('checks the form locally, links each error to its field, and keeps what was typed', async () => {
    const agent = request.agent(createApp());
    const post = await agent.post(`${MOUNT}/opportunities/131/shifts/new`).type('form').send({
      _csrf: 'test-csrf-token',
      'date-day': '', 'date-month': '', 'date-year': '',
      start_time: 'quarter past',
      end_time: '',
      capacity: '0'
    });

    expect(post.headers.location).toBe(`${MOUNT}/opportunities/131/shifts/new?status=invalid`);
    expect(writes()).toHaveLength(0);

    const page = await agent.get(post.headers.location);
    expect(page.text).toContain(t(`${K}date_required`));
    expect(page.text).toContain(t(`${K}start_invalid`));
    expect(page.text).toContain(t(`${K}end_required`));
    expect(page.text).toContain(t(`${K}places_invalid`));
    for (const anchor of ['#date-day', '#start_time', '#end_time', '#capacity']) {
      expect(page.text).toContain(`href="${anchor}"`);
    }
    expect(page.text).toMatch(/<input[^>]*id="start_time"[^>]*value="quarter past"/);
    expect(page.text).toMatch(/<input[^>]*id="capacity"[^>]*value="0"/);
    expect(page.text).toContain('<title>Error: ');
  });

  it('refuses an end time that is not after the start time', async () => {
    const agent = request.agent(createApp());
    await agent.post(`${MOUNT}/opportunities/131/shifts/new`).type('form').send({ ...VALID_SHIFT, start_time: '14:00', end_time: '2pm' });
    expect(writes()).toHaveLength(0);
    const page = await agent.get(`${MOUNT}/opportunities/131/shifts/new?status=invalid`);
    expect(page.text).toContain(t(`${K}end_before_start`));
  });

  it('refuses a shift in the past without asking the API', async () => {
    await request(createApp()).post(`${MOUNT}/opportunities/131/shifts/new`).type('form').send({ ...VALID_SHIFT, 'date-year': '2020' });
    expect(writes()).toHaveLength(0);
  });

  it('shows the API\'s own 400 message on the field it names', async () => {
    mockApi({ writeError: apiError(400, { errors: [{ code: 'VALIDATION_ERROR', field: 'capacity', message: 'There are already 3 places taken on this shift.' }] }) });
    const agent = request.agent(createApp());
    const post = await agent.post(`${MOUNT}/opportunities/131/shifts/new`).type('form').send(VALID_SHIFT);
    const page = await agent.get(post.headers.location);

    expect(page.text).toContain('There are already 3 places taken on this shift.');
    expect(page.text).toContain('href="#capacity"');
    expect(page.text).toContain('id="capacity-error"');
    // What was typed survives the API refusal too.
    expect(page.text).toMatch(/<input[^>]*id="start_time"[^>]*value="9:30am"/);
  });

  it('pre-fills the change form and sends the change with PUT', async () => {
    const form = await request(createApp()).get(`${MOUNT}/opportunities/131/shifts/71/edit`);
    expect(form.status).toBe(200);
    expect(form.text).toMatch(/<input[^>]*id="date-day"[^>]*value="27"/);
    expect(form.text).toMatch(/<input[^>]*id="date-month"[^>]*value="3"/);
    expect(form.text).toMatch(/<input[^>]*id="date-year"[^>]*value="2099"/);
    expect(form.text).toMatch(/<input[^>]*id="start_time"[^>]*value="09:00"/);
    expect(form.text).toMatch(/<input[^>]*id="end_time"[^>]*value="12:00"/);
    expect(form.text).toMatch(/<input[^>]*id="capacity"[^>]*value="5"/);
    expect(form.text).toContain(`action="${MOUNT}/opportunities/131/shifts/71/edit"`);

    const post = await request(createApp()).post(`${MOUNT}/opportunities/131/shifts/71/edit`).type('form').send({ ...VALID_SHIFT, capacity: '6' });
    expect(post.headers.location).toBe(`${MOUNT}/opportunities/131/shifts?status=shift-updated`);
    expect(writes()).toEqual([[
      'test-token', 'PUT', '/shifts/71',
      { start_time: '2099-03-27 09:30:00', end_time: '2099-03-27 12:00:00', capacity: 6 }
    ]]);
  });

  it('sends a shift that has started back to the list instead of offering to change it', async () => {
    const res = await request(createApp()).get(`${MOUNT}/opportunities/131/shifts/60/edit`);
    expect(res.headers.location).toBe(`${MOUNT}/opportunities/131/shifts?status=shift-started`);
  });
});

describe('removing a shift', () => {
  it('asks first, saying who holds a place and that they keep their application', async () => {
    const res = await request(createApp()).get(`${MOUNT}/opportunities/131/shifts/71/remove`);

    expect(res.status).toBe(200);
    expect(res.text).toContain(t(`${K}remove_title`));
    expect(res.text).toContain(t(`${K}remove_holders`, { count: 2 }));
    expect(res.text).toContain(`action="${MOUNT}/opportunities/131/shifts/71/remove"`);
    expect(writes()).toHaveLength(0);
  });

  it('removes it with DELETE and reports how many volunteers were told', async () => {
    const agent = request.agent(createApp());
    const post = await agent.post(`${MOUNT}/opportunities/131/shifts/71/remove`).type('form').send({ _csrf: 'test-csrf-token' });

    expect(writes()).toEqual([['test-token', 'DELETE', '/shifts/71']]);
    expect(post.headers.location).toBe(`${MOUNT}/opportunities/131/shifts?status=shift-removed&count=2`);
    const page = await agent.get(post.headers.location);
    expect(page.text).toContain(t(`${K}shift_removed_told`, { count: 2 }));
  });

  it('shows the API\'s reason when the shift started in the meantime', async () => {
    mockApi({ writeError: apiError(400, { errors: [{ code: 'VALIDATION_ERROR', message: 'This shift has already started.' }] }) });
    const agent = request.agent(createApp());
    const post = await agent.post(`${MOUNT}/opportunities/131/shifts/71/remove`).type('form').send({ _csrf: 'test-csrf-token' });

    expect(post.headers.location).toBe(`${MOUNT}/opportunities/131/shifts?status=remove-failed`);
    const page = await agent.get(post.headers.location);
    expect(page.text).toContain('This shift has already started.');
  });
});

describe('who is coming', () => {
  it('reads "Coming" before the shift starts, and lists groups and the waitlist in order', async () => {
    const res = await request(createApp()).get(`${MOUNT}/opportunities/131/shifts/71/roster`);

    expect(res.status).toBe(200);
    expect(api.callVolunteeringApi).toHaveBeenCalledWith('test-token', 'GET', '/shifts/71/roster');
    expect(res.text).toContain('Ada Lovelace');
    expect(res.text).toContain(t(`${K}status_coming`));
    expect(res.text).not.toContain(t(`${K}status_not_checked_in`));
    expect(res.text).toContain('Rotary Club');
    expect(res.text).toContain('Grace Hopper');
    expect(res.text).toContain('Katherine Johnson');
    expect(res.text.indexOf('First Waiter')).toBeLessThan(res.text.indexOf('Second Waiter'));
  });

  it('shows attendance once the shift has started', async () => {
    mockApi({
      roster: {
        summary: { signed_up: 3, checked_in: 1, no_show: 1, group_places: 0, waiting: 0 },
        volunteers: [
          { user: { id: 11, name: 'Ada Lovelace' }, check_in_status: 'checked_in', checked_in_at: '2020-01-06 09:55:00', checked_out_at: null },
          { user: { id: 12, name: 'Alan Turing' }, check_in_status: 'no_show', checked_in_at: null, checked_out_at: null },
          { user: { id: 13, name: 'Edsger Dijkstra' }, check_in_status: null, checked_in_at: null, checked_out_at: null }
        ],
        groups: [],
        waitlist: []
      }
    });
    const res = await request(createApp()).get(`${MOUNT}/opportunities/131/shifts/60/roster`);

    expect(res.text).toContain(t(`${K}status_checked_in_at`, { time: '09:55' }));
    expect(res.text).toContain(t(`${K}status_no_show`));
    expect(res.text).toContain(t(`${K}status_not_checked_in`));
    expect(res.text).not.toContain(t(`${K}status_coming`));
  });

  it('says so when nobody has signed up yet', async () => {
    mockApi({ roster: { summary: {}, volunteers: [], groups: [], waitlist: [] } });
    const res = await request(createApp()).get(`${MOUNT}/opportunities/131/shifts/71/roster`);
    expect(res.text).toContain(t(`${K}roster_empty`));
  });
});

describe('repeating shifts', () => {
  const VALID_PATTERN = {
    _csrf: 'test-csrf-token',
    frequency: 'weekly',
    days_of_week: ['3', '1'],
    start_time: '9am',
    end_time: '12:30',
    capacity: '3',
    'start_date-day': '1', 'start_date-month': '6', 'start_date-year': '2099',
    'end_date-day': '31', 'end_date-month': '8', 'end_date-year': '2099',
    max_occurrences: '10'
  };

  it('offers weekday checkboxes and how often, with today as the first date', async () => {
    const res = await request(createApp()).get(`${MOUNT}/opportunities/131/repeating/new`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('name="frequency"');
    expect(res.text).toContain('name="days_of_week"');
    expect(res.text).toContain('Monday');
    expect(res.text).toContain('Sunday');
    expect(res.text).toMatch(/<input[^>]*name="frequency"[^>]*value="weekly"[^>]*checked/);
  });

  it('sets up a weekly pattern on the chosen days', async () => {
    const agent = request.agent(createApp());
    const post = await agent.post(`${MOUNT}/opportunities/131/repeating/new`).type('form').send(VALID_PATTERN);

    expect(writes()).toEqual([[
      'test-token', 'POST', '/opportunities/131/recurring-patterns',
      {
        frequency: 'weekly',
        start_time: '09:00:00',
        end_time: '12:30:00',
        capacity: 3,
        start_date: '2099-06-01',
        days_of_week: [1, 3],
        end_date: '2099-08-31',
        max_occurrences: 10
      }
    ]]);
    expect(post.headers.location).toBe(`${MOUNT}/opportunities/131/shifts?status=pattern-created&count=4`);
    const page = await agent.get(post.headers.location);
    expect(page.text).toContain(t(`${K}pattern_created`, { count: 4 }));
  });

  it('needs at least one day for weekly and fortnightly patterns', async () => {
    const agent = request.agent(createApp());
    const { days_of_week: _ignored, ...withoutDays } = VALID_PATTERN;
    await agent.post(`${MOUNT}/opportunities/131/repeating/new`).type('form').send({ ...withoutDays, frequency: 'biweekly' });

    expect(writes()).toHaveLength(0);
    const page = await agent.get(`${MOUNT}/opportunities/131/repeating/new?status=invalid`);
    expect(page.text).toContain(t(`${K}days_required`));
    expect(page.text).toContain('href="#days_of_week"');
    expect(page.text).toMatch(/<input[^>]*name="frequency"[^>]*value="biweekly"[^>]*checked/);
  });

  it('does not send weekdays for a daily pattern', async () => {
    await request(createApp()).post(`${MOUNT}/opportunities/131/repeating/new`).type('form').send({ ...VALID_PATTERN, frequency: 'daily' });
    expect(writes()[0][3]).not.toHaveProperty('days_of_week');
    expect(writes()[0][3].frequency).toBe('daily');
  });

  it('refuses a last date before the start date and a maximum of zero', async () => {
    const agent = request.agent(createApp());
    await agent.post(`${MOUNT}/opportunities/131/repeating/new`).type('form').send({
      ...VALID_PATTERN, 'end_date-month': '1', max_occurrences: '0'
    });
    expect(writes()).toHaveLength(0);
    const page = await agent.get(`${MOUNT}/opportunities/131/repeating/new?status=invalid`);
    expect(page.text).toContain(t(`${K}end_date_before_start`));
    expect(page.text).toContain(t(`${K}max_invalid`));
  });

  it('shows the API\'s message on the weekday checkboxes', async () => {
    mockApi({ writeError: apiError(400, { errors: [{ code: 'VALIDATION_ERROR', field: 'days_of_week', message: 'Choose at least one weekday.' }] }) });
    const agent = request.agent(createApp());
    const post = await agent.post(`${MOUNT}/opportunities/131/repeating/new`).type('form').send(VALID_PATTERN);
    const page = await agent.get(post.headers.location);
    expect(page.text).toContain('Choose at least one weekday.');
    expect(page.text).toContain('href="#days_of_week"');
  });

  it('asks before stopping a pattern, then stops it with DELETE', async () => {
    const confirm = await request(createApp()).get(`${MOUNT}/opportunities/131/repeating/2/stop`);
    expect(confirm.status).toBe(200);
    expect(confirm.text).toContain(t(`${K}stop_title`));
    expect(confirm.text).toContain(t(`${K}stop_body`));
    expect(confirm.text).toContain('Monday, Wednesday');
    expect(writes()).toHaveLength(0);

    const agent = request.agent(createApp());
    const post = await agent.post(`${MOUNT}/opportunities/131/repeating/2/stop`).type('form').send({ _csrf: 'test-csrf-token' });
    expect(writes()).toEqual([['test-token', 'DELETE', '/recurring-patterns/2']]);
    expect(post.headers.location).toBe(`${MOUNT}/opportunities/131/shifts?status=pattern-stopped&count=5`);
    const page = await agent.get(post.headers.location);
    expect(page.text).toContain(t(`${K}pattern_stopped`, { count: 5 }));
  });

  it('sends an already stopped pattern back to the list', async () => {
    const res = await request(createApp()).get(`${MOUNT}/opportunities/131/repeating/3/stop`);
    expect(res.headers.location).toBe(`${MOUNT}/opportunities/131/shifts?status=pattern-missing`);
  });
});
