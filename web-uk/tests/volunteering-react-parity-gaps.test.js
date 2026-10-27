// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Volunteering gaps where the accessible site had fallen behind the website (27 Oct 2026).
 *
 * Pinned here:
 * 1. A pending organisation's owner can reach its dashboard (React 03646304a): My
 *    organisations links it while keeping the "awaiting approval" tag, and the hub's
 *    awaiting-approval banner links the dashboard (one organisation) or the list (several).
 * 2. My hours and Expenses with no organisation to log or claim for show why and where
 *    to go next (React fadb1da29, 9811fcf88) instead of a dead form.
 * 3. Shift swaps follow the API's cursor (React 7df3def06), and a refused accept, decline
 *    or cancel shows the API's own reason (for example "this swap has expired"), never the
 *    text of a server error.
 * 4. The organisation team page names its safeguarding lead and deputy (React d6e0a1c06).
 * 5. The organisation safeguarding pages say who "the safeguarding team" is (React
 *    f331badb6), and Report an incident is one press from the safeguarding landing view
 *    (React 06850f22a).
 * 7. Load failures are translated, not English literals.
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
  return new Proxy({
    ApiError,
    ApiOfflineError: class ApiOfflineError extends Error {},
    callVolunteeringApi: jest.fn(),
    getVolunteeringCategories: jest.fn().mockResolvedValue({ data: [] }),
    searchUsers: jest.fn().mockResolvedValue({ data: [] }),
    getProfile: jest.fn().mockResolvedValue({ data: { id: 1 } }),
    invalidateUserCache: jest.fn()
  }, {
    get: (target, prop) => (prop in target ? target[prop] : jest.fn().mockResolvedValue({ data: [] }))
  });
});

jest.mock('../src/lib/auditLogger', () => ({
  audit: new Proxy({}, { get: () => () => (req, res, next) => next() })
}));

const api = require('../src/lib/api');
const volunteeringActionRoutes = require('../src/routes/volunteering-actions');
const volunteeringIncidentRoutes = require('../src/routes/volunteering-incidents');

const VIEWS = path.join(__dirname, '..', 'src', 'views');
const GOVUK = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');
const t = createTranslator('en');
const V = 'govuk_alpha_volunteering.';
// Nunjucks autoescape turns apostrophes and quotes into entities.
const html = (text) => String(text)
  .replace(/&/g, '&amp;')
  .replace(/'/g, '&#39;')
  .replace(/"/g, '&quot;');

const env = nunjucks.configure([VIEWS, GOVUK], { autoescape: true, noCache: true, watch: false });
registerTemplateFilters(env);
env.addFilter('formatDate', (value) => String(value || ''));
env.addFilter('formatEventDate', (value) => String(value || ''));
env.addFilter('date', (value) => String(value || ''));
env.addFilter('nl2br', (value) => String(value || ''));

function baseLocals(extra = {}) {
  return {
    serviceName: 'Project NEXUS',
    tenantName: 'Acme Timebank',
    isAuthenticated: true,
    csrfToken: 'csrf',
    alphaNavItems: [],
    alphaFooterColumns: [],
    alphaLocaleOptions: [],
    alphaLanguageQueryParams: [],
    htmlLang: 'en',
    htmlDirection: 'ltr',
    t,
    tc: createChoiceTranslator('en'),
    characterCountMessages: characterCountMessages(t, 'en'),
    formatLocaleNumber: (value) => String(value ?? ''),
    formatLocaleDate: (value) => String(value ?? ''),
    ...extra
  };
}

function createApp(routes, tenant = { id: 2, slug: 'acme', features: { volunteering: true } }) {
  const app = express();
  env.express(app);
  app.set('view engine', 'njk');
  app.set('views', VIEWS);
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'volunteering-parity-gaps-test-secret', resave: false, saveUninitialized: false }));
  app.use('/volunteering', (req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.token = 'test-token';
    req.csrfToken = () => 'csrf';
    req.accessibleRouting = { mode: 'shared', tenantSlug: 'acme', prefix: '', tenant };
    res.locals.urlFor = (value) => String(value || '/');
    Object.assign(res.locals, baseLocals());
    next();
  }, routes);
  return app;
}

const actionsApp = createApp(volunteeringActionRoutes);
const incidentsApp = createApp(volunteeringIncidentRoutes);

function routeApi(routes) {
  api.callVolunteeringApi.mockImplementation(async (token, method, apiPath, body) => {
    const key = `${method} ${apiPath}`;
    if (Object.hasOwn(routes, key)) {
      const value = routes[key];
      if (value instanceof Error) throw value;
      return typeof value === 'function' ? value(body) : value;
    }
    return { data: [] };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── 1. Pending organisation owner ───────────────────────────────────────────

describe('1. a pending organisation\'s owner can reach its dashboard', () => {
  it('My organisations links a pending organisation to its dashboard and keeps the tag', async () => {
    routeApi({
      'GET /my-organisations?per_page=20': {
        data: [{ id: 12, name: 'Waiting Org', status: 'pending', member_role: 'owner' }],
        meta: { has_more: false }
      }
    });

    const page = await request(actionsApp).get('/volunteering/my-organisations');

    expect(page.status).toBe(200);
    expect(page.text).toContain('href="/volunteering/organisations/12/dashboard"');
    expect(page.text).toContain(t(`${V}my_orgs.awaiting_approval`));
    expect(page.text).toContain(html(t(`${V}my_orgs.awaiting_approval_hint`)));
  });

  it('does not offer the dashboard to a plain member of a pending organisation', async () => {
    routeApi({
      'GET /my-organisations?per_page=20': {
        data: [{ id: 13, name: 'Joined Org', status: 'pending', member_role: 'member' }],
        meta: { has_more: false }
      }
    });

    const page = await request(actionsApp).get('/volunteering/my-organisations');

    expect(page.text).not.toContain('href="/volunteering/organisations/13/dashboard"');
  });

  it('the reworded hint no longer says the organisation cannot be managed yet', () => {
    const hint = t(`${V}my_orgs.awaiting_approval_hint`);
    expect(hint).not.toBe('An administrator will review this organisation before you can manage opportunities.');
    expect(hint).toMatch(/dashboard/i);
  });

  function renderHub(extra) {
    return env.render('volunteering.njk', baseLocals({
      urlFor: (value) => String(value || '/'),
      activeNav: 'volunteering',
      opportunities: [],
      applications: [],
      applicationsMeta: {},
      hoursSummary: {},
      hoursSummaryLabels: { approved: '0', pending: '0', thisMonth: '0' },
      manageableOrganisations: [],
      pendingOwnedOrganisations: [],
      categories: [],
      recommendedShifts: [],
      communityProjects: [],
      selectedTab: 'opportunities',
      volunteerTools: [],
      volunteerTabs: {},
      authRequired: false,
      ...extra
    }));
  }

  it('the hub banner links the single pending organisation to its dashboard', () => {
    const page = renderHub({ pendingOwnedOrganisations: [{ id: 21, name: 'Waiting Org' }] });
    expect(page).toContain('href="/volunteering/organisations/21/dashboard"');
    expect(page).toContain(t(`${V}my_orgs.pending_setup`));
  });

  it('the hub banner sends the owner of several pending organisations to the list', () => {
    const page = renderHub({
      pendingOwnedOrganisations: [{ id: 21, name: 'Waiting Org' }, { id: 22, name: 'Second Org' }]
    });
    expect(page).toContain('href="/volunteering/my-organisations"');
    expect(page).toContain(t(`${V}my_orgs.pending_see_all`));
    expect(page).not.toContain('href="/volunteering/organisations/21/dashboard"');
  });

  // Item 6: with the organisations feature off the hub offers no organisation door.
  it('the hub hides organisation links when the organisations feature is off', () => {
    const page = renderHub({ organisationsEnabled: false, manageableOrganisations: [{ id: 30, name: 'Run Org' }] });
    expect(page).not.toContain('href="/organisations"');
    expect(page).not.toContain('href="/organisations/register"');
    expect(page).not.toContain('href="/volunteering/organisations/30/dashboard"');
  });

  it('the hub keeps organisation links when the organisations feature is on', () => {
    const page = renderHub({ organisationsEnabled: true });
    expect(page).toContain('href="/organisations"');
    expect(page).toContain('href="/organisations/register"');
  });
});

// ── 2. No organisation to log hours or claim expenses for ───────────────────

describe('2. no organisation to log hours or claim expenses for', () => {
  it('My hours explains why and links onwards, without the dead form', async () => {
    routeApi({
      'GET /hours/summary': { data: {} },
      'GET /hours?per_page=10': { data: [] },
      'GET /applications?status=approved&per_page=50': { data: [] },
      'GET /my-organisations?per_page=50': { data: [] },
      'GET /shifts?per_page=10': { data: { items: [], has_more: false } }
    });

    const page = await request(actionsApp).get('/volunteering/hours');

    expect(page.status).toBe(200);
    expect(page.text).toContain(html(t(`${V}my_hours.no_organisation`)));
    expect(page.text).toContain(t(`${V}shared.find_opportunities`));
    expect(page.text).toContain(t(`${V}shared.check_applications`));
    expect(page.text).toContain('href="/volunteering?tab=applications"');
    // The form posting hours is gone, and so is the "use the form above" advice.
    expect(page.text).not.toContain('action="/volunteering/hours"');
    expect(page.text).not.toContain(html(t('govuk_alpha.vol_clarity.empty_hours_cta')));
  });

  it('My hours keeps the form when there is an organisation', async () => {
    routeApi({
      'GET /hours/summary': { data: {} },
      'GET /hours?per_page=10': { data: [] },
      'GET /applications?status=approved&per_page=50': { data: [] },
      'GET /my-organisations?per_page=50': { data: [{ id: 4, name: 'Food Bank' }] },
      'GET /shifts?per_page=10': { data: { items: [], has_more: false } }
    });

    const page = await request(actionsApp).get('/volunteering/hours');

    expect(page.text).toContain('action="/volunteering/hours"');
    expect(page.text).not.toContain(html(t(`${V}my_hours.no_organisation`)));
  });

  it('My hours does not link to applications when the community has switched that section off', async () => {
    const app = createApp(volunteeringActionRoutes, {
      id: 2, slug: 'acme', features: { volunteering: true }, volunteering_config: { 'volunteering.tab_applications': false }
    });
    routeApi({
      'GET /hours/summary': { data: {} },
      'GET /hours?per_page=10': { data: [] },
      'GET /applications?status=approved&per_page=50': { data: [] },
      'GET /my-organisations?per_page=50': { data: [] },
      'GET /shifts?per_page=10': { data: { items: [], has_more: false } }
    });

    const page = await request(app).get('/volunteering/hours');

    expect(page.text).toContain(t(`${V}shared.find_opportunities`));
    expect(page.text).not.toContain('href="/volunteering?tab=applications"');
  });

  it('Expenses with no organisation links onwards', async () => {
    routeApi({});

    const page = await request(actionsApp).get('/volunteering/expenses');

    expect(page.status).toBe(200);
    expect(page.text).toContain(html(t(`${V}expenses.no_organisation`)));
    expect(page.text).toContain(t(`${V}shared.find_opportunities`));
    expect(page.text).toContain('href="/volunteering?tab=applications"');
  });
});

// ── 3. Shift swaps ───────────────────────────────────────────────────────────

describe('3. shift swaps', () => {
  const swap = (id) => ({
    id,
    direction: 'received',
    status: 'pending',
    requester: { id: 2, name: 'Brendan' },
    recipient: { id: 1, name: 'Aoife' },
    original_shift: { id: 80, start_time: '2099-10-24 10:00:00', end_time: '2099-10-24 13:00:00', opportunity_title: 'Garden' },
    proposed_shift: { id: 81, start_time: '2099-10-26 10:00:00', end_time: '2099-10-26 13:00:00', opportunity_title: 'Garden' }
  });

  it('offers the next page when the API says there is one', async () => {
    routeApi({
      'GET /swaps': { data: [swap(5)], meta: { has_more: true, cursor: 'NQ==' } },
      'GET /shifts?per_page=50': { data: { items: [], has_more: false } }
    });

    const page = await request(actionsApp).get('/volunteering/swaps');

    expect(page.status).toBe(200);
    expect(page.text).toContain('href="/volunteering/swaps?cursor=NQ%3D%3D"');
    expect(page.text).toContain(t('actions.load_more'));
  });

  it('reads the page the cursor names', async () => {
    routeApi({
      'GET /swaps?cursor=NQ%3D%3D': { data: [swap(4)], meta: { has_more: false } },
      'GET /shifts?per_page=50': { data: { items: [], has_more: false } }
    });

    const page = await request(actionsApp).get('/volunteering/swaps?cursor=NQ%3D%3D');

    expect(page.status).toBe(200);
    expect(api.callVolunteeringApi).toHaveBeenCalledWith('test-token', 'GET', '/swaps?cursor=NQ%3D%3D');
    expect(page.text).not.toContain(t('actions.load_more'));
  });

  it('shows no next page on the last page', async () => {
    routeApi({
      'GET /swaps': { data: [swap(5)], meta: { has_more: false } },
      'GET /shifts?per_page=50': { data: { items: [], has_more: false } }
    });

    const page = await request(actionsApp).get('/volunteering/swaps');

    expect(page.text).not.toContain('/volunteering/swaps?cursor=');
  });

  async function followRedirect(agent, response) {
    expect(response.status).toBe(302);
    return agent.get(response.headers.location);
  }

  it('shows the API\'s own reason when an accept is refused (an expired swap)', async () => {
    const expired = 'This swap request has expired: one of the shifts has changed.';
    routeApi({
      'PUT /swaps/5': new api.ApiError('conflict', 409, { errors: [{ code: 'DECISION_CONFLICT', message: expired }] }),
      'GET /swaps': { data: [], meta: { has_more: false } },
      'GET /shifts?per_page=50': { data: { items: [], has_more: false } }
    });
    const agent = request.agent(actionsApp);

    const page = await followRedirect(agent, await agent.post('/volunteering/swaps/5/respond').type('form').send({ action: 'accept' }));

    expect(page.text).toContain(html(expired));
    expect(page.text).not.toContain(html(t('govuk_alpha.vol_depth.swap_respond_failed')));
  });

  it('never shows a server error\'s text', async () => {
    routeApi({
      'PUT /swaps/5': new api.ApiError('boom', 500, { message: 'SQLSTATE[42S22]: Column not found' }),
      'GET /swaps': { data: [], meta: { has_more: false } },
      'GET /shifts?per_page=50': { data: { items: [], has_more: false } }
    });
    const agent = request.agent(actionsApp);

    const page = await followRedirect(agent, await agent.post('/volunteering/swaps/5/respond').type('form').send({ action: 'reject' }));

    expect(page.text).not.toContain('SQLSTATE');
    expect(page.text).toContain(html(t('govuk_alpha.vol_depth.swap_respond_failed')));
  });

  it('shows the API\'s own reason when a cancel is refused', async () => {
    const reason = 'This swap request has already been answered.';
    routeApi({
      'DELETE /swaps/6': new api.ApiError('conflict', 409, { errors: [{ code: 'DECISION_CONFLICT', message: reason }] }),
      'GET /swaps': { data: [], meta: { has_more: false } },
      'GET /shifts?per_page=50': { data: { items: [], has_more: false } }
    });
    const agent = request.agent(actionsApp);

    const page = await followRedirect(agent, await agent.post('/volunteering/swaps/6/cancel').type('form').send({}));

    expect(page.text).toContain(html(reason));
    expect(page.text).not.toContain(html(t('govuk_alpha.vol_depth.swap_cancel_failed')));
  });
});

// ── 4. Organisation team: safeguarding lead and deputy ──────────────────────

describe('4. organisation team names its safeguarding lead and deputy', () => {
  it('shows the lead, and says when no deputy is appointed', async () => {
    routeApi({
      'GET /organisations/7/members': {
        data: {
          items: [{ user_id: 77, name: 'Lena Lead', role: 'owner' }],
          can_manage: false,
          safeguarding: { lead: { user_id: 77, name: 'Lena Lead' }, deputy: null }
        }
      },
      'GET /organisations/7/stats': { data: { org_name: 'Food Bank' } }
    });

    const page = await request(actionsApp).get('/volunteering/organisations/7/team');

    expect(page.status).toBe(200);
    expect(page.text).toContain(t(`${V}org_team.safeguarding_title`));
    expect(page.text).toContain(t(`${V}org_team.safeguarding_lead`));
    expect(page.text).toContain(t(`${V}org_team.safeguarding_deputy`));
    expect(page.text).toContain(t(`${V}org_team.safeguarding_nobody`));
    expect(page.text).toContain(html(t(`${V}org_team.safeguarding_help`)));
    const section = page.text.slice(page.text.indexOf(t(`${V}org_team.safeguarding_title`)));
    expect(section).toContain('Lena Lead');
  });

  it('says nobody is appointed when the API gives no safeguarding block', async () => {
    routeApi({
      'GET /organisations/7/members': { data: { items: [], can_manage: false } },
      'GET /organisations/7/stats': { data: { org_name: 'Food Bank' } }
    });

    const page = await request(actionsApp).get('/volunteering/organisations/7/team');

    expect(page.text).toContain(t(`${V}org_team.safeguarding_nobody`));
  });
});

// ── 5. Safeguarding wording and the way in to reporting ─────────────────────

describe('5. safeguarding', () => {
  it('the organisation safeguarding list says who the safeguarding team is', async () => {
    routeApi({ 'GET /organisations/7/incidents': { data: { items: [] } } });

    const page = await request(incidentsApp).get('/volunteering/organisations/7/safeguarding');

    expect(page.status).toBe(200);
    expect(page.text).toContain(html(t(`${V}org_safeguarding.team_meaning`)));
  });

  it('an organisation safeguarding report says who the safeguarding team is', async () => {
    routeApi({ 'GET /organisations/7/incidents/9': { data: { id: 9, status: 'open' } } });

    const page = await request(incidentsApp).get('/volunteering/organisations/7/safeguarding/9');

    expect(page.status).toBe(200);
    expect(page.text).toContain(html(t(`${V}org_safeguarding.team_meaning`)));
  });

  it('the landing (training) view offers Report an incident', async () => {
    routeApi({ 'GET /training': { data: [] }, 'GET /incidents': { data: [] } });

    const page = await request(actionsApp).get('/volunteering/training');

    expect(page.status).toBe(200);
    expect(page.text).toContain('href="/volunteering/incidents#report-incident"');
    expect(page.text).toContain(t(`${V}safeguarding.report_incident_title`));
  });

  it('the volunteering page\'s safeguarding tool still opens the training view', () => {
    const { volunteeringSections } = require('../src/lib/volunteering-sections');
    const tool = volunteeringSections({}).tools.find((entry) => entry.section === 'safeguarding');
    expect(tool.href).toBe('/volunteering/training');
  });
});

// ── 7. Load failures are translated ─────────────────────────────────────────

describe('7. load failures are translated', () => {
  const failing = new api.ApiError('down', 503, {});

  it.each([
    ['/volunteering/organisations/7/dashboard', 'GET /organisations/7/stats', 'org_dashboard'],
    ['/volunteering/organisations/7/settings', 'GET /organisations/7', 'org_settings'],
    ['/volunteering/organisations/7/wallet', 'GET /organisations/7/stats', 'org_wallet'],
    ['/volunteering/hours', 'GET /hours/summary', 'hours'],
    ['/volunteering/my-organisations', 'GET /my-organisations?per_page=20', 'organisations'],
    ['/volunteering/training', 'GET /training', 'safeguarding']
  ])('%s', async (url, apiCall, key) => {
    routeApi({ [apiCall]: failing });

    const page = await request(actionsApp).get(url);

    const message = t(`${V}load_errors.${key}`);
    expect(message).not.toBe(`${V}load_errors.${key}`);
    expect(page.text).toContain(html(message));
  });

  it('no English load-failure literal is left in the volunteering routes', () => {
    const source = require('fs').readFileSync(path.join(__dirname, '..', 'src', 'routes', 'volunteering-actions.js'), 'utf8');
    expect(source).not.toMatch(/loadError = '[A-Z]/);
  });

  it('no English organisation-name fallback is left in the volunteering routes', () => {
    const source = require('fs').readFileSync(path.join(__dirname, '..', 'src', 'routes', 'volunteering-actions.js'), 'utf8');
    expect(source).not.toContain("'Volunteering organisation'");
    expect(source).not.toMatch(/`Organisation \$\{/);
  });

  it('a dashboard whose stats fail to load is headed with the translated fallback name', async () => {
    routeApi({ 'GET /organisations/7/stats': failing });
    const page = await request(actionsApp).get('/volunteering/organisations/7/dashboard');
    expect(page.text).toContain(html(t('volunteering.organization')));
    expect(page.text).not.toContain('Volunteering organisation');
  });
});
