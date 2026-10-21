// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * An organisation's own opportunities on the accessible site
 * (routes/volunteering-org-opportunities.js, parity gap 1, 21 Oct 2026). Before this
 * the dashboard showed only a count, and a closed or cancelled opportunity could be
 * reached only by its address.
 *
 * Pinned here:
 * - open opportunities are shown by default; closed, cancelled and all are one link
 *   away, and every tab carries its count;
 * - each opportunity links to its page, and to its edit page unless cancelled;
 * - waiting, approved and upcoming-shift figures are shown except on cancelled ones,
 *   and an open opportunity with no upcoming shifts says so;
 * - the organisation dashboard links to the list;
 * - someone who does not run the organisation gets the 403 page.
 */

const request = require('supertest');

jest.mock('../src/lib/api', () => {
  class ApiError extends Error {
    constructor(message, status, data) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  }
  return { ApiError, ApiOfflineError: class ApiOfflineError extends Error {}, callVolunteeringApi: jest.fn() };
});

const api = require('../src/lib/api');
const routes = require('../src/routes/volunteering-org-opportunities');
const { MOUNT, t, createVolunteeringApp, html } = require('./support/volunteering-route-app');

const PAGE = `${MOUNT}/organisations/114/opportunities`;
const K = 'govuk_alpha_volunteering.org_opportunities.';

const ITEMS = [
  { id: 131, title: 'Garden help', state: 'open', location: 'Cork', is_remote: false, start_date: '2026-10-01', end_date: '2026-12-01', pending_applications: 2, approved_volunteers: 5, upcoming_shifts: 3 },
  { id: 132, title: 'Phone befriending', state: 'open', location: null, is_remote: true, start_date: null, end_date: null, pending_applications: 0, approved_volunteers: 0, upcoming_shifts: 0 },
  { id: 133, title: 'Summer fair', state: 'closed', location: 'Mallow', is_remote: false, start_date: '2026-07-01', end_date: '2026-07-01', pending_applications: 1, approved_volunteers: 4, upcoming_shifts: 0 },
  { id: 134, title: 'Old project', state: 'cancelled', location: 'Cork', is_remote: false, start_date: null, end_date: null, pending_applications: 0, approved_volunteers: 0, upcoming_shifts: 0 }
];

function mockApi({ items = ITEMS, listError = null } = {}) {
  api.callVolunteeringApi.mockImplementation(async (token, method, apiPath) => {
    if (method === 'GET' && apiPath === '/organisations/114/opportunities') {
      if (listError) throw listError;
      return { data: { items } };
    }
    if (method === 'GET' && apiPath === '/organisations/114/stats') return { data: { org_name: 'Garden Trust' } };
    throw new api.ApiError('unexpected', 500, {});
  });
}

function card(text, id) {
  const start = text.indexOf(`data-testid="org-opp-${id}"`);
  if (start < 0) return '';
  return text.slice(start, text.indexOf('</article>', start));
}

beforeEach(() => {
  api.callVolunteeringApi.mockReset();
  mockApi();
});

describe("an organisation's opportunities", () => {
  it('shows the open ones by default, with every tab counted', async () => {
    const res = await request(createVolunteeringApp(routes)).get(PAGE);

    expect(res.status).toBe(200);
    expect(res.text).toContain('Garden Trust');
    expect(res.text).toContain(html(t(`${K}title`)));
    expect(card(res.text, 131)).toContain('Garden help');
    expect(card(res.text, 132)).toContain('Phone befriending');
    expect(card(res.text, 133)).toBe('');
    expect(card(res.text, 134)).toBe('');
    expect(res.text).toContain(t(`${K}filters.open`, { count: 2 }));
    expect(res.text).toContain(t(`${K}filters.closed`, { count: 1 }));
    expect(res.text).toContain(t(`${K}filters.cancelled`, { count: 1 }));
    expect(res.text).toContain(t(`${K}filters.all`, { count: 4 }));
    expect(res.text).toMatch(/data-testid="org-opps-filter-open"/);
    expect(res.text).toMatch(/aria-current="page" data-testid="org-opps-filter-open"/);
  });

  it('shows the figures, place and dates, and links to the page and the edit page', async () => {
    const res = await request(createVolunteeringApp(routes)).get(PAGE);
    const garden = card(res.text, 131);

    expect(garden).toContain('href="/acme/accessible/volunteering/opportunities/131"');
    expect(garden).toContain('href="/acme/accessible/volunteering/opportunities/131/edit"');
    expect(garden).toContain('Cork · 1 October 2026 to 1 December 2026');
    expect(garden).toMatch(new RegExp(`${html(t(`${K}pending`))}</dt>\\s*<dd[^>]*>2</dd>`));
    expect(garden).toMatch(new RegExp(`${html(t(`${K}approved`))}</dt>\\s*<dd[^>]*>5</dd>`));
    expect(garden).toMatch(new RegExp(`${html(t(`${K}upcoming_shifts`))}</dt>\\s*<dd[^>]*>3</dd>`));
    expect(garden).not.toContain('data-testid="org-opp-needs-shifts-131"');

    const remote = card(res.text, 132);
    expect(remote).toContain(t(`${K}remote`));
    expect(remote).toContain('data-testid="org-opp-needs-shifts-132"');
  });

  it('lists closed ones under Closed, without the no-shifts note', async () => {
    const res = await request(createVolunteeringApp(routes)).get(`${PAGE}?show=closed`);
    const fair = card(res.text, 133);

    expect(card(res.text, 131)).toBe('');
    expect(fair).toContain(t(`${K}state.closed`));
    expect(fair).toContain('Mallow · 1 July 2026');
    expect(fair).toContain('/opportunities/133/edit');
    expect(fair).not.toContain('org-opp-needs-shifts');
  });

  it('lists cancelled ones with no figures and no edit link', async () => {
    const res = await request(createVolunteeringApp(routes)).get(`${PAGE}?show=cancelled`);
    const old = card(res.text, 134);

    expect(old).toContain(t(`${K}state.cancelled`));
    expect(old).toContain('href="/acme/accessible/volunteering/opportunities/134"');
    expect(old).not.toContain('/edit');
    expect(old).not.toContain(html(t(`${K}pending`)));
  });

  it('shows every opportunity under All, and treats an unknown filter as Open', async () => {
    const all = await request(createVolunteeringApp(routes)).get(`${PAGE}?show=all`);
    [131, 132, 133, 134].forEach((id) => expect(card(all.text, id)).not.toBe(''));

    const unknown = await request(createVolunteeringApp(routes)).get(`${PAGE}?show=deleted`);
    expect(card(unknown.text, 133)).toBe('');
    expect(card(unknown.text, 131)).not.toBe('');
  });

  it('says so when a tab is empty', async () => {
    mockApi({ items: [] });
    const open = await request(createVolunteeringApp(routes)).get(PAGE);
    expect(open.text).toContain(html(t(`${K}empty_open`)));

    const closed = await request(createVolunteeringApp(routes)).get(`${PAGE}?show=closed`);
    expect(closed.text).toContain(html(t(`${K}empty_other`)));
  });

  it('gives someone who does not run the organisation the 403 page', async () => {
    mockApi({ listError: new api.ApiError('denied', 403, {}) });
    expect((await request(createVolunteeringApp(routes)).get(PAGE)).status).toBe(403);
  });

  it('sends a signed-out visitor to sign in', async () => {
    const res = await request(createVolunteeringApp(routes, { signedIn: false })).get(PAGE);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/acme/accessible/login?status=auth-required');
  });
});

describe('the organisation dashboard', () => {
  it('links to the opportunities list', () => {
    const fs = require('fs');
    const path = require('path');
    const view = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'volunteering', 'org-dashboard.njk'), 'utf8');
    expect(view).toContain("'/volunteering/organisations/' ~ orgId ~ '/opportunities'");
    expect(view).toContain('govuk_alpha_volunteering.org_opportunities.title');
  });
});
