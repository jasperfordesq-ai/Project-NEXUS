// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Donations, the donation receipt and "My volunteering hours" on the accessible
 * frontend, brought level with React (26 Oct 2026).
 *
 * Pinned here:
 * - donations: each campaign and gift names the organisation it is for and links to it;
 *   each past gift names its campaign; only live campaigns are offered to give to;
 *   cash and a payment reference are accepted; the donor tile no longer adds people
 *   up across campaigns — it shows what this member has given;
 * - receipt: the member's own receipt, with "held by the community on behalf of the
 *   organisation"; another member's donation is "not found"; it is linked from a
 *   completed gift;
 * - hours: every logged entry is reachable through the API's cursor, and the member
 *   sees the shifts they hold, upcoming and past.
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
    getDonationReceipt: jest.fn(),
    getVolunteeringCategories: jest.fn(),
    searchUsers: jest.fn(),
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
const html = (value) => String(value).replace(/'/g, '&#39;');

function createApp() {
  const app = express();
  const env = nunjucks.configure([VIEWS, GOVUK], { autoescape: true, express: app, watch: false });
  registerTemplateFilters(env);
  env.addFilter('formatDate', (value) => String(value || ''));
  env.addFilter('nl2br', (value) => String(value || ''));

  app.set('view engine', 'njk');
  app.set('views', VIEWS);
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'donations-hours-test-secret', resave: false, saveUninitialized: false }));

  app.use(MOUNT, (req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.accessibleRouting = {
      mode: 'shared',
      tenantSlug: 'acme',
      tenant: { id: 2, slug: 'acme', name: 'Acme Timebank', settings: { default_currency: 'EUR' } },
      prefix: PREFIX
    };
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
    next();
  }, volunteeringActionRoutes);

  return app;
}

const GIVING_DAYS = [
  { id: 7, title: 'Winter appeal', status: 'active', goal_amount: 500, raised_amount: 120, donor_count: 3, end_date: '2099-12-20', organization_id: 4, organization_name: 'Food Bank' },
  { id: 8, title: 'Spring repairs', status: 'upcoming', goal_amount: 300, raised_amount: 0, donor_count: 0, start_date: '2099-03-01' },
  { id: 9, title: 'Summer fete', status: 'ended', goal_amount: 200, raised_amount: 210, donor_count: 3, end_date: '2026-07-01' }
];

const DONATIONS = {
  items: [
    { id: 41, amount: '25.00', currency: 'EUR', status: 'completed', payment_method: 'cash', giving_day_id: 9, giving_day_title: 'Summer fete', organization_id: null, organization_name: null, created_at: '2026-07-01 10:00:00' },
    { id: 40, amount: '10.00', currency: 'EUR', status: 'pending', payment_method: 'bank_transfer', giving_day_id: 7, giving_day_title: 'Winter appeal', organization_id: 4, organization_name: 'Food Bank', created_at: '2026-10-01 10:00:00' }
  ],
  next_cursor: null
};

describe('donations page — React parity', () => {
  beforeEach(() => jest.clearAllMocks());

  function mockDonationApi() {
    api.callVolunteeringApi.mockImplementation(async (token, method, apiPath) => {
      if (method === 'GET' && apiPath === '/giving-days') return { data: GIVING_DAYS };
      if (method === 'GET' && apiPath === '/donations?per_page=20') return { data: DONATIONS };
      if (method === 'POST' && apiPath === '/donations') return { data: { id: 42, status: 'pending' } };
      throw new api.ApiError('unexpected call', 500, {});
    });
  }

  it('names and links the organisation, names each gift’s campaign and offers only live campaigns', async () => {
    mockDonationApi();
    const res = await request(createApp()).get(`${MOUNT}/donations`);

    expect(res.status).toBe(200);
    expect(res.text).toContain(`href="${PREFIX}/organisations/4"`);
    expect(res.text).toContain(t('govuk_alpha_volunteering.donations.for_organisation', { name: 'Food Bank' }));
    expect(res.text).toContain(t('govuk_alpha_volunteering.donations.live_campaigns'));
    expect(res.text).toContain(t('govuk_alpha_volunteering.donations.past_campaigns'));
    // The past gift still names its ended campaign.
    expect(res.text).toMatch(/<td class="govuk-table__cell">\s*Summer fete/);

    const select = res.text.slice(res.text.indexOf('id="donate-giving-day"'), res.text.indexOf('</select>'));
    expect(select).toContain('value="7"');
    expect(select).not.toContain('value="8"');
    expect(select).not.toContain('value="9"');
    // Only one "donate to this campaign" link: the live one.
    expect(res.text.split('data-vol-giving-day=').length - 1).toBe(1);
  });

  it('offers cash and a payment reference, and shows what this member gave instead of adding donors up', async () => {
    mockDonationApi();
    const res = await request(createApp()).get(`${MOUNT}/donations`);

    expect(res.text).toContain('value="cash"');
    expect(res.text).toContain('name="payment_reference"');
    expect(res.text).not.toContain(t('govuk_alpha_volunteering.donations.stat_total_donors'));
    expect(res.text).toContain(html(t('govuk_alpha_volunteering.donations.stat_you_gave')));
    expect(res.text).toContain('25.00 EUR');
    expect(res.text).toContain(t('govuk_alpha_volunteering.donations.stat_pending_pledges', { number: 1 }));
    expect(res.text).toContain(t('govuk_alpha_volunteering.donations.pending_pledge_note'));
  });

  it('links a completed gift to its receipt, and not a pending one', async () => {
    mockDonationApi();
    const res = await request(createApp()).get(`${MOUNT}/donations`);

    expect(res.text).toContain(`href="${MOUNT}/donations/41/receipt"`);
    expect(res.text).not.toContain(`href="${MOUNT}/donations/40/receipt"`);
  });

  it('records a cash gift with its reference', async () => {
    mockDonationApi();
    const post = await request(createApp()).post(`${MOUNT}/donations`).type('form').send({
      _csrf: 'test-csrf-token', amount: '15', payment_method: 'cash', giving_day_id: '7', payment_reference: ' JS-OCT ', message: ''
    });

    expect(post.headers.location).toBe(`${MOUNT}/donations?status=donate-recorded#donate`);
    expect(api.callVolunteeringApi).toHaveBeenLastCalledWith('test-token', 'POST', '/donations', {
      amount: 15, payment_method: 'cash', giving_day_id: 7, payment_reference: 'JS-OCT', message: '', is_anonymous: false
    });
  });

  it('never sends a method the page does not offer', async () => {
    mockDonationApi();
    await request(createApp()).post(`${MOUNT}/donations`).type('form').send({ _csrf: 'x', amount: '5', payment_method: 'stripe' });
    expect(api.callVolunteeringApi.mock.calls.at(-1)[3].payment_method).toBe('bank_transfer');
  });
});

describe('donation receipt page', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows the member’s receipt, saying the community holds it for the organisation', async () => {
    api.getDonationReceipt.mockResolvedValue({
      data: {
        donation_id: 40, organization_name: 'Food Bank', giving_day_title: 'Winter appeal', donor_name: 'Ada Member',
        amount: '10.00', currency: 'EUR', status: 'completed', payment_method: 'bank_transfer',
        payment_reference: 'JS-OCT', message: 'For the vans', tenant_name: 'Acme Timebank', date: '2026-10-01 10:00:00'
      }
    });
    const res = await request(createApp()).get(`${MOUNT}/donations/40/receipt`);

    expect(res.status).toBe(200);
    expect(api.getDonationReceipt).toHaveBeenCalledWith('test-token', 40);
    expect(res.text).toContain(t('govuk_alpha_volunteering.donations.receipt_title'));
    expect(res.text).toContain('10.00 EUR');
    expect(res.text).toContain('Ada Member');
    expect(res.text).toContain('Winter appeal');
    expect(res.text).toContain('JS-OCT');
    expect(res.text).toContain(t('govuk_alpha_volunteering.donations.method_bank_transfer'));
    expect(res.text).toContain(t('govuk_alpha_volunteering.donations.held_on_behalf', { community: 'Acme Timebank', organisation: 'Food Bank' }));
    expect(res.text).toContain(`href="${MOUNT}/donations"`);
  });

  it('answers not found for a donation that is not the member’s', async () => {
    api.getDonationReceipt.mockRejectedValue(new api.ApiError('Donation not found', 404, {}));
    const res = await request(createApp()).get(`${MOUNT}/donations/99/receipt`);
    expect(res.status).toBe(404);
  });
});

describe('my volunteering hours — every entry and the member’s shifts', () => {
  beforeEach(() => jest.clearAllMocks());

  function mockHoursApi({ hoursPages = {}, shiftsPages = {}, shiftsError = null } = {}) {
    api.callVolunteeringApi.mockImplementation(async (token, method, apiPath) => {
      if (apiPath === '/hours/summary') return { data: { total_approved: 3, total_pending: 0 } };
      if (apiPath.startsWith('/hours?')) return { data: hoursPages[apiPath] || { items: [], cursor: null, has_more: false } };
      if (apiPath.startsWith('/shifts?')) {
        if (shiftsError) throw shiftsError;
        return { data: shiftsPages[apiPath] || { items: [], cursor: null, has_more: false } };
      }
      return { data: { items: [] } };
    });
  }

  const entry = (id, description) => ({ id, date_logged: '2026-10-05', hours: 2, status: 'approved', description, organization: { id: 4, name: 'Food Bank' } });

  it('pages through every logged entry with the API cursor', async () => {
    mockHoursApi({
      hoursPages: {
        '/hours?per_page=10': { items: [entry(12, 'Newest entry')], cursor: 'MTE=', has_more: true },
        '/hours?per_page=10&cursor=MTE%3D': { items: [entry(11, 'Oldest entry')], cursor: null, has_more: false }
      }
    });

    const first = await request(createApp()).get(`${MOUNT}/hours`);
    expect(first.status).toBe(200);
    expect(first.text).toContain('Newest entry');
    expect(first.text).toContain(`href="${MOUNT}/hours?hours_cursor=MTE%3D#logged-hours"`);
    expect(first.text).toContain(t('govuk_alpha_volunteering.my_hours.older_entries'));

    const second = await request(createApp()).get(`${MOUNT}/hours?hours_cursor=MTE%3D`);
    expect(api.callVolunteeringApi).toHaveBeenCalledWith('test-token', 'GET', '/hours?per_page=10&cursor=MTE%3D');
    expect(second.text).toContain('Oldest entry');
    expect(second.text).not.toContain(t('govuk_alpha_volunteering.my_hours.older_entries'));
    expect(second.text).toContain(`href="${MOUNT}/hours#logged-hours"`);
    expect(second.text).toContain(t('govuk_alpha_volunteering.my_hours.newest_entries'));
  });

  it('ignores a cursor that is not one the API issued', async () => {
    mockHoursApi();
    await request(createApp()).get(`${MOUNT}/hours?hours_cursor=${encodeURIComponent('1 OR 1=1')}`);
    expect(api.callVolunteeringApi).toHaveBeenCalledWith('test-token', 'GET', '/hours?per_page=10');
  });

  it('lists the shifts the member holds, upcoming and past, linked to the opportunity', async () => {
    mockHoursApi({
      shiftsPages: {
        '/shifts?per_page=10': {
          items: [
            { id: 31, start_time: '2099-10-13 10:00:00', end_time: '2099-10-13 12:00:00', opportunity_id: 9, opportunity_title: 'Sorting donations', location: 'Main hall' },
            { id: 30, start_time: '2020-01-10 10:00:00', end_time: '2020-01-10 12:00:00', opportunity_id: 9, opportunity_title: 'Sorting donations', location: null }
          ],
          cursor: 'MzA=',
          has_more: true
        }
      }
    });
    const res = await request(createApp()).get(`${MOUNT}/hours`);

    expect(res.text).toContain(t('govuk_alpha_volunteering.my_hours.shifts_list_title'));
    expect(res.text).toContain(`href="${PREFIX}/volunteering/opportunities/9"`);
    expect(res.text).toContain('Main hall');
    expect(res.text).toContain(t('govuk_alpha_volunteering.my_hours.shift_upcoming'));
    expect(res.text).toContain(t('govuk_alpha_volunteering.my_hours.shift_past'));
    expect(res.text).toContain(`href="${MOUNT}/hours?shifts_cursor=MzA%3D#your-shifts"`);
  });

  it('says so when the shifts cannot be loaded, and still shows the hours', async () => {
    mockHoursApi({
      hoursPages: { '/hours?per_page=10': { items: [entry(12, 'Newest entry')], cursor: null, has_more: false } },
      shiftsError: new api.ApiError('down', 500, {})
    });
    const res = await request(createApp()).get(`${MOUNT}/hours`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('Newest entry');
    expect(res.text).toContain(t('govuk_alpha_volunteering.my_hours.shifts_load_error'));
  });
});
