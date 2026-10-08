// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Group sign-ups on the accessible site (gap B5, 8 Oct 2026). Before this the page
 * said a leader "can reserve a block of slots" with nothing to click, asked for a
 * numeric member ID that is shown nowhere, and removed members and cancelled
 * reservations with no confirmation.
 *
 * Pinned here:
 * - the list page links to a reservation form, a member search, and confirmation pages;
 * - the form offers only upcoming shifts and only the groups the member leads or
 *   helps run, refuses a missing or unknown choice before the API, and shows the
 *   API's own refusal in the error summary;
 * - members are found by name and chosen from the results, never typed as a number;
 * - the copy says what now happens: the member is signed up, told, and can leave.
 */

const path = require('path');
const express = require('express');
const session = require('express-session');
const nunjucks = require('nunjucks');
const request = require('supertest');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');
const { registerTemplateFilters } = require('../src/lib/template-filters');
const { characterCountMessages } = require('../src/lib/character-count-messages');

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
    getVolunteeringCategories: jest.fn(),
    searchUsers: jest.fn(),
    getGroups: jest.fn(),
    getProfile: jest.fn(),
    invalidateUserCache: jest.fn()
  };
});

const api = require('../src/lib/api');
const volunteeringActionRoutes = require('../src/routes/volunteering-actions');

const PREFIX = '/acme/accessible';
const MOUNT = `${PREFIX}/volunteering`;
const VIEWS = path.join(__dirname, '..', 'src', 'views');
const GOVUK = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');
const t = createTranslator('en');
const G = 'govuk_alpha_volunteering.group_signups.';
// Nunjucks autoescape turns apostrophes into &#39; and the curly one into itself.
const html = (text) => String(text).replace(/'/g, '&#39;');

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
  app.use(session({ secret: 'group-signups-test-secret', resave: false, saveUninitialized: false }));

  app.use(MOUNT, (req, res, next) => {
    req.signedCookies = { token: 'test-token' };
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
      t,
      tc: createChoiceTranslator('en'),
      characterCountMessages: characterCountMessages(t, 'en'),
      formatLocaleNumber: (value) => String(value ?? ''),
      formatLocaleDate: (value) => String(value ?? '')
    });
    next();
  }, volunteeringActionRoutes);

  return app;
}

// Reservation 30 is led by the member (id 1); 31 is someone else's and cancelled.
const RESERVATIONS = [
  {
    id: 30,
    group_name: 'Wednesday Drivers',
    status: 'active',
    is_leader: true,
    max_members: 3,
    created_at: '2026-07-01T09:00:00Z',
    shift: { id: 71, start_time: '2026-07-12T09:00:00Z', end_time: '2026-07-12T12:00:00Z' },
    opportunity: { id: 77, title: 'Food parcel delivery', location: 'Community depot' },
    organization: { name: 'Community Kitchen' },
    members: [
      { id: 55, name: 'Riley Driver', status: 'confirmed' },
      { id: 56, name: 'Taylor Helper', status: 'pending' },
      { id: 57, name: 'Morgan Maybe', status: 'declined' }
    ]
  },
  {
    id: 31,
    group_name: 'Saturday Garden Team',
    status: 'cancelled',
    is_leader: false,
    max_members: null,
    created_at: '2026-06-20T09:00:00Z',
    shift: { id: 80, start_time: '2026-07-20T09:00:00Z', end_time: '2026-07-20T11:00:00Z' },
    opportunity: { id: 78, title: 'Community garden tidy', location: 'North allotments' },
    organization: { name: 'Mutual Aid Store' },
    members: [{ id: 60, name: 'Jamie Volunteer', status: 'confirmed' }]
  }
];

const OPPORTUNITIES = {
  items: [
    { id: 77, title: 'Food parcel delivery', organization: { name: 'Community Kitchen' } },
    { id: 78, title: 'Community garden tidy' }
  ]
};

const SHIFTS_77 = [
  { id: 71, start_time: '2099-03-27 09:00:00', end_time: '2099-03-27 12:00:00', capacity: 6, spots_available: 4 },
  // Already happened: not offered.
  { id: 61, start_time: '2020-01-08 10:00:00', end_time: '2020-01-08 11:00:00', capacity: 6, spots_available: 6 },
  // No capacity limit: offered without a places-left count.
  { id: 73, start_time: '2099-03-29 14:00:00', end_time: '2099-03-29 16:00:00', capacity: null, spots_available: null }
];

// The member owns 5, helps run 6 as an admin, and is an ordinary member of 7.
const GROUPS = {
  data: {
    items: [
      { id: 5, name: 'Wednesday Drivers', owner_id: 1 },
      { id: 6, name: 'Choir', owner_id: 9, viewer_membership: { status: 'active', role: 'admin' } },
      { id: 7, name: 'Walkers', owner_id: 9, viewer_membership: { status: 'active', role: 'member' } }
    ]
  }
};

function mockApi({ reservations = RESERVATIONS, shifts = SHIFTS_77, groups = GROUPS, postError = null, memberError = null } = {}) {
  api.callVolunteeringApi.mockImplementation(async (token, method, apiPath) => {
    if (method === 'GET' && apiPath === '/group-reservations') return { data: reservations };
    if (method === 'GET' && apiPath === '/opportunities?per_page=100') return { data: OPPORTUNITIES };
    if (method === 'GET' && apiPath === '/opportunities/77') return { data: { id: 77, title: 'Food parcel delivery', organization: { name: 'Community Kitchen' } } };
    if (method === 'GET' && apiPath === '/opportunities/77/shifts') return { data: shifts };
    if (method === 'POST' && apiPath.startsWith('/shifts/') && apiPath.endsWith('/group-reserve')) {
      if (postError) throw postError;
      return { data: { id: 32 } };
    }
    if (method === 'POST' && apiPath === '/group-reservations/30/members') {
      if (memberError) throw memberError;
      return { data: { message: 'ok' } };
    }
    if (method === 'DELETE') return {};
    throw new api.ApiError('unexpected', 500, {});
  });
  api.getGroups.mockResolvedValue(groups);
  api.getProfile.mockResolvedValue({ data: { id: 1, name: 'Me' } });
  api.searchUsers.mockResolvedValue({
    data: [
      { id: 55, name: 'Riley Driver' },
      { id: 58, name: 'Sam New' },
      { id: 1, name: 'Me' }
    ]
  });
}

function posts() {
  return api.callVolunteeringApi.mock.calls.filter(([, method]) => method === 'POST');
}

beforeEach(() => {
  api.callVolunteeringApi.mockReset();
  api.getGroups.mockReset();
  api.getProfile.mockReset();
  api.searchUsers.mockReset();
  mockApi();
});

describe('the group sign-ups page', () => {
  it('offers a way to start a reservation and links each control to its own page', async () => {
    const res = await request(createApp()).get(`${MOUNT}/group-signups`);

    expect(res.status).toBe(200);
    expect(res.text).toContain(`href="${MOUNT}/group-signups/new"`);
    expect(res.text).toContain(t(`${G}reserve_link`));
    // Members are listed with their state; the leader's controls open confirmation pages.
    expect(res.text).toContain('Riley Driver');
    expect(res.text).toContain(`href="${MOUNT}/group-signups/30/members/55/remove"`);
    expect(res.text).toContain(`href="${MOUNT}/group-signups/30/members/new"`);
    expect(res.text).toContain(`href="${MOUNT}/group-signups/30/cancel"`);
    // Someone else's cancelled reservation has no controls at all.
    expect(res.text).not.toContain(`href="${MOUNT}/group-signups/31/cancel"`);
    expect(res.text).not.toContain(`href="${MOUNT}/group-signups/31/members/60/remove"`);
    // No numeric member IDs anywhere.
    expect(res.text).not.toContain('type="number"');
    expect(res.text).not.toMatch(/member ID/i);
    // The copy says what happens to an added member.
    expect(res.text).toContain(html(t(`${G}description`)));
  });

  it('explains how to start when the member has no reservations yet', async () => {
    mockApi({ reservations: [] });
    const res = await request(createApp()).get(`${MOUNT}/group-signups`);
    expect(res.text).toContain(html(t(`${G}empty`)));
    expect(res.text).toContain(`href="${MOUNT}/group-signups/new"`);
  });

  it('shows the reservation success message', async () => {
    const res = await request(createApp()).get(`${MOUNT}/group-signups?status=reserved`);
    expect(res.text).toContain(t(`${G}success_reserved`));
  });
});

describe('reserving places: choosing the opportunity', () => {
  it('lists the opportunities as links to their own shift form', async () => {
    const res = await request(createApp()).get(`${MOUNT}/group-signups/new`);

    expect(res.status).toBe(200);
    expect(res.text).toContain(t(`${G}reserve_title`));
    expect(res.text).toContain(`href="${MOUNT}/group-signups/new/77"`);
    expect(res.text).toContain(`href="${MOUNT}/group-signups/new/78"`);
    expect(res.text).toContain('Food parcel delivery');
    expect(res.text).toContain('Community Kitchen');
  });

  it('says so, with no links, when the member leads no group', async () => {
    mockApi({ groups: { data: { items: [{ id: 7, name: 'Walkers', owner_id: 9, viewer_membership: { status: 'active', role: 'member' } }] } } });
    const res = await request(createApp()).get(`${MOUNT}/group-signups/new`);

    expect(res.status).toBe(200);
    expect(res.text).toContain(t(`${G}reserve_no_groups`));
    expect(res.text).not.toContain(`href="${MOUNT}/group-signups/new/77"`);
  });

  it('says so when there is nothing to reserve places on', async () => {
    api.callVolunteeringApi.mockImplementation(async (token, method, apiPath) => {
      if (apiPath === '/opportunities?per_page=100') return { data: { items: [] } };
      throw new api.ApiError('unexpected', 500, {});
    });
    const res = await request(createApp()).get(`${MOUNT}/group-signups/new`);
    expect(res.text).toContain(t(`${G}reserve_no_opportunities`));
  });
});

describe('reserving places on a shift', () => {
  it('offers only upcoming shifts and only the groups the member leads or helps run', async () => {
    const res = await request(createApp()).get(`${MOUNT}/group-signups/new/77`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('Food parcel delivery');
    expect(res.text).toMatch(/name="shift_id" type="radio" value="71"/);
    expect(res.text).toMatch(/name="shift_id" type="radio" value="73"/);
    expect(res.text).not.toMatch(/name="shift_id" type="radio" value="61"/);
    expect(res.text).toContain(t(`${G}reserve_shift_places_left`, { count: 4 }));
    expect(res.text).toMatch(/name="group_id" type="radio" value="5"/);
    expect(res.text).toMatch(/name="group_id" type="radio" value="6"/);
    expect(res.text).not.toMatch(/name="group_id" type="radio" value="7"/);
    expect(res.text).toContain('Wednesday Drivers');
    expect(res.text).toContain('Choir');
    expect(res.text).toMatch(/name="reserved_slots"[^>]*value="1"/);
    expect(res.text).toContain('name="notes"');
    expect(res.text).toContain(`action="${MOUNT}/group-signups/new/77"`);
    expect(res.text).toContain('name="_csrf"');
  });

  it('says so when the opportunity has no upcoming shifts', async () => {
    mockApi({ shifts: [SHIFTS_77[1]] });
    const res = await request(createApp()).get(`${MOUNT}/group-signups/new/77`);
    expect(res.text).toContain(t(`${G}reserve_no_shifts`));
    expect(res.text).not.toContain('name="shift_id"');
  });

  it('is "not found" for an opportunity that does not exist', async () => {
    api.callVolunteeringApi.mockImplementation(async (token, method, apiPath) => {
      throw new api.ApiError('missing', 404, { errors: [{ code: 'NOT_FOUND' }] });
    });
    expect((await request(createApp()).get(`${MOUNT}/group-signups/new/999`)).status).toBe(404);
  });

  it('reserves the places and sends the leader to add members', async () => {
    const res = await request(createApp()).post(`${MOUNT}/group-signups/new/77`).type('form')
      .send({ shift_id: '71', group_id: '6', reserved_slots: '3', notes: '  Two of us need a lift ' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${MOUNT}/group-signups?status=reserved`);
    expect(posts()).toEqual([['test-token', 'POST', '/shifts/71/group-reserve', {
      group_id: 6,
      reserved_slots: 3,
      notes: 'Two of us need a lift'
    }]]);
  });

  it('leaves the note out when there is none', async () => {
    await request(createApp()).post(`${MOUNT}/group-signups/new/77`).type('form')
      .send({ shift_id: '71', group_id: '5', reserved_slots: '2' });
    expect(posts()[0][3]).toEqual({ group_id: 5, reserved_slots: 2 });
  });

  it('refuses a missing or unknown shift, group or number of places before the API', async () => {
    const none = await request(createApp()).post(`${MOUNT}/group-signups/new/77`).type('form')
      .send({ reserved_slots: '0', notes: 'Kept' });
    expect(none.status).toBe(400);
    expect(none.text).toContain('govuk-error-summary');
    expect(none.text).toContain(t(`${G}error_shift_required`));
    expect(none.text).toContain(t(`${G}error_group_required`));
    expect(none.text).toContain(t(`${G}error_slots_invalid`));
    expect(none.text).toContain('href="#shift_id-71"');
    expect(none.text).toContain('href="#group_id-5"');
    expect(none.text).toContain('href="#reserved_slots"');
    expect(none.text).toContain('Kept');

    // A past shift, a group the member only belongs to, and a fraction are all refused.
    const wrong = await request(createApp()).post(`${MOUNT}/group-signups/new/77`).type('form')
      .send({ shift_id: '61', group_id: '7', reserved_slots: '1.5' });
    expect(wrong.status).toBe(400);
    expect(posts()).toHaveLength(0);
  });

  it('keeps the choices and shows the API refusal in the error summary', async () => {
    mockApi({
      postError: new api.ApiError('refused', 422, {
        errors: [{ code: 'VALIDATION_ERROR', message: 'Only 2 slots available on this shift', field: 'reserved_slots' }]
      })
    });

    const res = await request(createApp()).post(`${MOUNT}/group-signups/new/77`).type('form')
      .send({ shift_id: '71', group_id: '5', reserved_slots: '5', notes: 'Please' });

    expect(res.status).toBe(400);
    expect(res.text).toContain('govuk-error-summary');
    expect(res.text).toContain('Only 2 slots available on this shift');
    expect(res.text).toMatch(/value="71" checked/);
    expect(res.text).toMatch(/value="5" checked/);
    expect(res.text).toMatch(/name="reserved_slots"[^>]*value="5"/);
    expect(res.text).toContain('Please');
  });

  it('falls back to its own words when the API gives none', async () => {
    mockApi({ postError: new api.ApiError('refused', 500, {}) });
    const res = await request(createApp()).post(`${MOUNT}/group-signups/new/77`).type('form')
      .send({ shift_id: '71', group_id: '5', reserved_slots: '1' });
    expect(res.status).toBe(400);
    expect(res.text).toContain(t(`${G}error_reserve_failed`));
  });
});

describe('adding a member by name', () => {
  it('searches by name and offers only people not already on the reservation', async () => {
    const res = await request(createApp()).get(`${MOUNT}/group-signups/30/members/new?q=ri`);

    expect(res.status).toBe(200);
    expect(api.searchUsers).toHaveBeenCalledWith('test-token', 'ri', { limit: 10 });
    expect(res.text).toContain('Wednesday Drivers');
    expect(res.text).toContain(html(t(`${G}add_member_hint`)));
    expect(res.text).toContain('name="q"');
    expect(res.text).toContain('value="ri"');
    expect(res.text).toMatch(/name="user_id" type="radio" value="58"/);
    expect(res.text).toContain('Sam New');
    // Already on the reservation, and the leader themselves: not offered.
    expect(res.text).not.toMatch(/name="user_id" type="radio" value="55"/);
    expect(res.text).not.toMatch(/name="user_id" type="radio" value="1"/);
    expect(res.text).toContain(`action="${MOUNT}/group-signups/30/members"`);
    expect(res.text).not.toContain('type="number"');
    expect(res.text).not.toMatch(/member ID/i);
  });

  it('does not search until there is something to search for, and says when nobody matches', async () => {
    const empty = await request(createApp()).get(`${MOUNT}/group-signups/30/members/new`);
    expect(empty.status).toBe(200);
    expect(api.searchUsers).not.toHaveBeenCalled();
    expect(empty.text).not.toContain('name="user_id"');

    api.searchUsers.mockResolvedValue({ data: [] });
    const none = await request(createApp()).get(`${MOUNT}/group-signups/30/members/new?q=zz`);
    expect(none.text).toContain(t(`${G}add_member_no_results`));
  });

  it('is "not found" for a reservation the member does not lead', async () => {
    expect((await request(createApp()).get(`${MOUNT}/group-signups/31/members/new?q=ri`)).status).toBe(404);
    expect((await request(createApp()).get(`${MOUNT}/group-signups/99/members/new?q=ri`)).status).toBe(404);
  });

  it('adds the chosen person and goes back to the list', async () => {
    const res = await request(createApp()).post(`${MOUNT}/group-signups/30/members`).type('form')
      .send({ user_id: '58', q: 'sam' });

    expect(res.headers.location).toBe(`${MOUNT}/group-signups?status=member-added`);
    expect(posts()).toEqual([['test-token', 'POST', '/group-reservations/30/members', { user_id: 58 }]]);
  });

  it('asks for a choice when none was made, keeping the search', async () => {
    const res = await request(createApp()).post(`${MOUNT}/group-signups/30/members`).type('form')
      .send({ q: 'sam' });
    expect(res.headers.location).toBe(`${MOUNT}/group-signups/30/members/new?status=member-required&q=sam`);
    expect(posts()).toHaveLength(0);

    const page = await request(createApp()).get(`${MOUNT}/group-signups/30/members/new?status=member-required&q=sam`);
    expect(page.text).toContain('govuk-error-summary');
    expect(page.text).toContain(t(`${G}error_member_required`));
  });

  it('sends an API refusal back to the search with its own message', async () => {
    mockApi({ memberError: new api.ApiError('no', 422, { errors: [{ code: 'VALIDATION_ERROR' }] }) });
    const failed = await request(createApp()).post(`${MOUNT}/group-signups/30/members`).type('form')
      .send({ user_id: '58', q: 'sam' });
    expect(failed.headers.location).toBe(`${MOUNT}/group-signups/30/members/new?status=member-add-failed&q=sam`);

    mockApi({ memberError: new api.ApiError('restricted', 403, { errors: [{ code: 'SAFEGUARDING_CONTACT_RESTRICTED' }] }) });
    const restricted = await request(createApp()).post(`${MOUNT}/group-signups/30/members`).type('form')
      .send({ user_id: '58' });
    expect(restricted.headers.location).toBe(`${MOUNT}/group-signups/30/members/new?status=member-safeguarding-restricted`);

    const page = await request(createApp()).get(`${MOUNT}/group-signups/30/members/new?status=member-add-failed&q=sam`);
    expect(page.text).toContain(t(`${G}error_member_add_failed`));
  });
});

describe('removing a member', () => {
  it('asks first, naming the person and saying they will be told', async () => {
    const res = await request(createApp()).get(`${MOUNT}/group-signups/30/members/55/remove`);

    expect(res.status).toBe(200);
    expect(res.text).toContain(t(`${G}remove_member_title`, { name: 'Riley Driver' }));
    expect(res.text).toContain(t(`${G}remove_member_body`));
    expect(res.text).toContain(`method="post" action="${MOUNT}/group-signups/30/members/55/remove"`);
    expect(res.text).toContain('name="_csrf"');
    expect(res.text).toContain(t(`${G}remove_member_confirm`));
    expect(res.text).toContain(`href="${MOUNT}/group-signups"`);
  });

  it('is "not found" for someone who is not on it, or a reservation the member does not lead', async () => {
    expect((await request(createApp()).get(`${MOUNT}/group-signups/30/members/99/remove`)).status).toBe(404);
    expect((await request(createApp()).get(`${MOUNT}/group-signups/31/members/60/remove`)).status).toBe(404);
  });

  it('removes them on confirmation', async () => {
    const res = await request(createApp()).post(`${MOUNT}/group-signups/30/members/55/remove`).type('form').send({});
    expect(res.headers.location).toBe(`${MOUNT}/group-signups?status=member-removed`);
    expect(api.callVolunteeringApi).toHaveBeenLastCalledWith('test-token', 'DELETE', '/group-reservations/30/members/55');
  });
});

describe('cancelling a reservation', () => {
  it('asks first, with the warning', async () => {
    const res = await request(createApp()).get(`${MOUNT}/group-signups/30/cancel`);

    expect(res.status).toBe(200);
    expect(res.text).toContain(t(`${G}cancel_confirm_title`, { group: 'Wednesday Drivers' }));
    expect(res.text).toContain(t(`${G}cancel_warning`));
    expect(res.text).toContain('<span class="govuk-visually-hidden">Warning</span>');
    expect(res.text).toContain(`method="post" action="${MOUNT}/group-signups/30/cancel"`);
    expect(res.text).toContain(t(`${G}cancel_button`));
    expect(res.text).toContain(t(`${G}cancel_keep`));
  });

  it('is "not found" for a reservation that is cancelled already or not the member\'s to cancel', async () => {
    expect((await request(createApp()).get(`${MOUNT}/group-signups/31/cancel`)).status).toBe(404);
  });

  it('cancels on confirmation', async () => {
    const res = await request(createApp()).post(`${MOUNT}/group-signups/30/cancel`).type('form').send({});
    expect(res.headers.location).toBe(`${MOUNT}/group-signups?status=reservation-cancelled`);
    expect(api.callVolunteeringApi).toHaveBeenLastCalledWith('test-token', 'DELETE', '/group-reservations/30');
  });
});
