// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * An organisation reviews its volunteers' expense claims on the accessible site
 * (routes/volunteering-org-expenses.js, gap B7 part 1, 7 Oct 2026). Before this a
 * volunteer could claim here but the organisation had nowhere to see the claim.
 *
 * Pinned here:
 * - the list shows waiting claims by default, the organisation's totals, and each claim
 *   with only the next step the API accepts (pending → approve / reject, approved → paid);
 * - a reviewer's own claim offers no action, only a note that someone else must review it;
 * - approve / reject (with an optional reason) / paid (with an optional reference) send
 *   exactly that to the API, and each refusal comes back with its own message;
 * - a receipt is always sent as a download, never rendered on this site;
 * - someone who does not run the organisation gets the 403 page.
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
    downloadOrgExpenseReceipt: jest.fn(),
    getProfile: jest.fn()
  };
});
jest.mock('../src/lib/request-profile', () => ({ getRequestProfile: jest.fn() }));

const api = require('../src/lib/api');
const { getRequestProfile } = require('../src/lib/request-profile');
const expenseRoutes = require('../src/routes/volunteering-org-expenses');

const PREFIX = '/acme/accessible';
const MOUNT = `${PREFIX}/volunteering`;
const PAGE = `${MOUNT}/organisations/114/expenses`;
const VIEWS = path.join(__dirname, '..', 'src', 'views');
const GOVUK = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');
const t = createTranslator('en');
const K = 'govuk_alpha_volunteering.org_expenses.';
const html = (text) => String(text).replace(/'/g, '&#39;');

function createApp() {
  const app = express();
  const env = nunjucks.configure([VIEWS, GOVUK], { autoescape: true, express: app, watch: false });
  registerTemplateFilters(env);
  app.set('view engine', 'njk');
  app.set('views', VIEWS);
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'org-expenses-test-secret', resave: false, saveUninitialized: false }));
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
      formatLocaleNumber: (value) => String(value ?? ''),
      formatLocaleDate: (value) => String(value ?? '')
    });
    next();
  }, expenseRoutes);
  return app;
}

const CLAIMS = [
  { id: 1, user_id: 50, volunteer_name: 'Ada Lovelace', expense_type: 'travel', amount: 12.5, currency: 'EUR', description: 'Bus fare', status: 'pending', has_receipt: true, submitted_at: '2026-10-01 09:00:00' },
  { id: 2, user_id: 51, volunteer_name: 'Alan Turing', expense_type: 'meals', amount: 8, currency: 'EUR', description: 'Lunch', status: 'approved', has_receipt: false, submitted_at: '2026-10-02 09:00:00' },
  { id: 3, user_id: 7, volunteer_name: 'Me Myself', expense_type: 'supplies', amount: 20, currency: 'EUR', description: 'Gloves', status: 'pending', has_receipt: false, submitted_at: '2026-10-03 09:00:00' },
  { id: 4, user_id: 52, volunteer_name: 'Grace Hopper', expense_type: 'parking', amount: 4, currency: 'EUR', description: 'Car park', status: 'paid', payment_reference: 'BANK-42', has_receipt: false, submitted_at: '2026-09-20 09:00:00' }
];

function mockApi({ claims = CLAIMS, listError = null, writeError = null } = {}) {
  getRequestProfile.mockResolvedValue({ data: { id: 7 } });
  api.callVolunteeringApi.mockImplementation(async (token, method, apiPath) => {
    if (method === 'GET' && apiPath === '/organisations/114/expenses?per_page=1') {
      // The unfiltered totals, as the API computes them over every claim.
      return { data: { items: claims.slice(0, 1), stats: { total_submitted: 44.5, pending_review: 32.5, approved_total: 12, paid_total: 4 }, cursor: null, has_more: true } };
    }
    if (method === 'GET' && apiPath.startsWith('/organisations/114/expenses?')) {
      if (listError) throw listError;
      // Filtered: the API's totals follow the filter, which the page must not show.
      return { data: { items: claims, stats: { total_submitted: 32.5, pending_review: 32.5, approved_total: 0, paid_total: 0 }, cursor: null, has_more: false } };
    }
    if (method === 'GET' && apiPath === '/organisations/114/stats') return { data: { org_name: 'Garden Trust' } };
    if (method === 'PUT' && /^\/organisations\/114\/expenses\/\d+$/.test(apiPath)) {
      if (writeError) throw writeError;
      return { data: { success: true } };
    }
    throw new api.ApiError('unexpected', 500, {});
  });
}

function card(text, id) {
  const start = text.indexOf(`data-testid="org-expense-${id}"`);
  const end = text.indexOf('</article>', start);
  return text.slice(start, end);
}

function writes() {
  return api.callVolunteeringApi.mock.calls.filter(([, method]) => method !== 'GET');
}

beforeEach(() => {
  api.callVolunteeringApi.mockReset();
  api.downloadOrgExpenseReceipt.mockReset();
  getRequestProfile.mockReset();
  mockApi();
});

describe('the expense claims page', () => {
  it('shows waiting claims by default, with the totals and the organisation', async () => {
    const res = await request(createApp()).get(PAGE);

    expect(res.status).toBe(200);
    const listCall = api.callVolunteeringApi.mock.calls.find(([, , p]) => p.startsWith('/organisations/114/expenses?') && p !== '/organisations/114/expenses?per_page=1');
    expect(listCall[2]).toBe('/organisations/114/expenses?per_page=20&status=pending');
    expect(res.text).toContain('Garden Trust');
    expect(res.text).toContain(t(`${K}title`));
    expect(res.text).toContain('€32.50');
    // Totals cover every claim, not just the filtered ones.
    expect(res.text).toContain('€12.00');
    expect(res.text).toContain('€44.50');
    expect(res.text).toMatch(/govuk-tabs__list-item--selected">\s*<a[^>]*aria-current="page">Pending</);
  });

  it('offers only the next step the API accepts', async () => {
    const res = await request(createApp()).get(PAGE);

    const pending = card(res.text, 1);
    expect(pending).toContain('name="decision" value="approved"');
    expect(pending).toContain('name="decision" value="rejected"');
    expect(pending).not.toContain('name="decision" value="paid"');
    expect(pending).toContain(`href="${PAGE}/1/receipt"`);

    const approved = card(res.text, 2);
    expect(approved).toContain('name="decision" value="paid"');
    expect(approved).not.toContain('value="approved"');
    expect(approved).not.toContain('receipt');

    const paid = card(res.text, 4);
    expect(paid).not.toContain('name="decision"');
    expect(paid).toContain('BANK-42');
  });

  it('offers no action on the reviewer\'s own claim, only a note', async () => {
    const res = await request(createApp()).get(PAGE);

    const own = card(res.text, 3);
    expect(own).not.toContain('name="decision"');
    expect(own).toContain(html(t(`${K}own_claim_note`)));
  });

  it('asks the API for every status under "All"', async () => {
    await request(createApp()).get(`${PAGE}?show=all`);

    const listCall = api.callVolunteeringApi.mock.calls.find(([, , p]) => p.startsWith('/organisations/114/expenses?') && p !== '/organisations/114/expenses?per_page=1');
    expect(listCall[2]).toBe('/organisations/114/expenses?per_page=20');
  });

  it('gives someone who does not run the organisation the 403 page', async () => {
    mockApi({ listError: new api.ApiError('denied', 403, {}) });
    expect((await request(createApp()).get(PAGE)).status).toBe(403);
  });
});

describe('reviewing a claim', () => {
  function review(id, body) {
    return request(createApp()).post(`${PAGE}/${id}/review`).type('form').send(body);
  }

  it('approves', async () => {
    const res = await review(1, { decision: 'approved', review_notes: 'ignored', show: 'pending' });

    expect(res.headers.location).toBe(`${PAGE}?status=expense-approved`);
    expect(writes()).toEqual([['test-token', 'PUT', '/organisations/114/expenses/1', { status: 'approved' }]]);
  });

  it('rejects with the reason given', async () => {
    const res = await review(1, { decision: 'rejected', review_notes: '  No receipt  ', show: 'all' });

    expect(res.headers.location).toBe(`${PAGE}?show=all&status=expense-rejected`);
    expect(writes()[0][3]).toEqual({ status: 'rejected', review_notes: 'No receipt' });
  });

  it('marks as paid with the reference given', async () => {
    await review(2, { decision: 'paid', payment_reference: 'BANK-77' });
    expect(writes()[0][3]).toEqual({ status: 'paid', payment_reference: 'BANK-77' });
  });

  it.each([
    [new api.ApiError('done', 409, { errors: [{ code: 'INVALID_STATE' }] }), 'expense-already-handled'],
    [new api.ApiError('gone', 404, {}), 'expense-already-handled'],
    [new api.ApiError('own claim', 403, {}), 'expense-forbidden'],
    [new api.ApiError('broken', 500, {}), 'expense-failed']
  ])('answers a refusal with its own message (%#)', async (error, outcome) => {
    mockApi({ writeError: error });
    const res = await review(1, { decision: 'approved' });
    expect(res.headers.location).toBe(`${PAGE}?status=${outcome}`);
  });

  it('shows the outcome on the page', async () => {
    const res = await request(createApp()).get(`${PAGE}?status=expense-already-handled`);
    expect(res.text).toContain(t(`${K}already_handled`));
  });

  it('refuses an unknown decision without calling the API', async () => {
    const res = await review(1, { decision: 'delete' });
    expect(res.headers.location).toBe(`${PAGE}?status=expense-failed`);
    expect(writes()).toHaveLength(0);
  });
});

describe('a receipt', () => {
  it('is passed through as a download', async () => {
    api.downloadOrgExpenseReceipt.mockResolvedValue({
      status: 200,
      body: Buffer.from('%PDF-1.4'),
      headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="bus.pdf"' }
    });

    const res = await request(createApp()).get(`${PAGE}/1/receipt`);

    expect(api.downloadOrgExpenseReceipt).toHaveBeenCalledWith('test-token', 114, 1);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="bus.pdf"');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('is forced to download even if the API ever sent it inline', async () => {
    api.downloadOrgExpenseReceipt.mockResolvedValue({
      status: 200,
      body: Buffer.from('<svg onload="alert(1)"></svg>'),
      headers: { 'content-type': 'image/svg+xml', 'content-disposition': 'inline' }
    });

    const res = await request(createApp()).get(`${PAGE}/1/receipt`);
    expect(res.headers['content-disposition']).toMatch(/^attachment/);
  });

  it('is "not found" when there is none', async () => {
    api.downloadOrgExpenseReceipt.mockRejectedValue(new api.ApiError('none', 404, {}));
    expect((await request(createApp()).get(`${PAGE}/2/receipt`)).status).toBe(404);
  });
});
