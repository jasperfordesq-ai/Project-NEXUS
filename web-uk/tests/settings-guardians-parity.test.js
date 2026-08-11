// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const nunjucks = require('nunjucks');
const path = require('path');
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
  getMyGuardians: jest.fn(),
  getMyWards: jest.fn(),
  respondToGuardian: jest.fn(),
  updateGuardianPermissions: jest.fn()
}));

const api = require('../src/lib/api');
const guardiansRouter = require('../src/routes/settings-guardians');

function testApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.token = 'test-token';
    req.accessibleRouting = { tenantSlug: 'hour-timebank', tenant: { slug: 'hour-timebank' } };
    res.locals.t = (key, params) => (params ? `${key}(${JSON.stringify(params)})` : key);
    res.locals.locale = 'en';
    res.locals.urlFor = (pathname) => `/hour-timebank/accessible${pathname}`;
    res.render = (view, locals) => res.json({ view, locals });
    next();
  });
  app.use('/settings/guardians', guardiansRouter);
  return app;
}

function guardian(overrides = {}) {
  return { id: 7, guardian_name: 'Bridget', state: 'pending', assigned_at: '2026-08-05', ...overrides };
}

beforeEach(() => {
  jest.clearAllMocks();
  api.getMyGuardians.mockResolvedValue({ data: { guardians: [], pending_count: 0 } });
  api.getMyWards.mockResolvedValue({ data: { wards: [] } });
});

describe('Guardian arrangements — what the member is offered', () => {
  it.each([
    ['pending', ['consented', 'declined']],
    ['consented', ['withdrawn']],
    ['declined', ['consented']],
    ['withdrawn', ['consented']]
  ])('offers exactly the answers allowed from "%s"', async (state, expected) => {
    api.getMyGuardians.mockResolvedValue({ data: { guardians: [guardian({ state })] } });

    const response = await request(testApp()).get('/settings/guardians');

    // Mirrors GuardianArrangementService::ALLOWED_FROM so the page never offers
    // an answer the backend will refuse.
    expect(response.body.locals.guardians[0].allowedActions).toEqual(expected);
  });

  it('offers the capability levels only once the member has agreed', async () => {
    api.getMyGuardians.mockResolvedValue({
      data: { guardians: [guardian({ state: 'consented', tiers: { listings: 'co_decide' } })] }
    });

    const response = await request(testApp()).get('/settings/guardians');
    const row = response.body.locals.guardians[0];

    expect(row.state).toBe('consented');
    expect(row.capabilities).toEqual([
      { key: 'listings', current: 'co_decide' },
      { key: 'credits', current: 'none' }
    ]);
  });

  it('never offers "assist" as a grantable level', async () => {
    const response = await request(testApp()).get('/settings/guardians');

    // There is no draft-only screen behind `assist`, so it is deliberately not
    // offered here. Message viewing is a separate consent path entirely.
    expect(response.body.locals.grantableTiers).toEqual(['none', 'co_decide', 'represent']);
    expect(response.body.locals.grantableTiers).not.toContain('assist');
  });

  it('keeps showing the arrangements that loaded when the wards call fails', async () => {
    api.getMyGuardians.mockResolvedValue({ data: { guardians: [guardian()] } });
    api.getMyWards.mockRejectedValue(new api.ApiError('boom', 500));

    const response = await request(testApp()).get('/settings/guardians');

    expect(response.status).toBe(200);
    expect(response.body.locals.guardians).toHaveLength(1);
    expect(response.body.locals.wards).toEqual([]);
  });
});

describe('Recording the member’s answer', () => {
  it.each(['consented', 'declined', 'withdrawn'])('sends "%s" to the API and reports it back', async (action) => {
    api.respondToGuardian.mockResolvedValue({ data: {} });

    const response = await request(testApp())
      .post('/settings/guardians/respond')
      .send(`assignment_id=7&action=${action}`);

    expect(api.respondToGuardian).toHaveBeenCalledWith('test-token', action, 7, '');
    expect(response.headers.location).toContain(`status=guardian-${action}`);
  });

  it('passes a reason when one is given', async () => {
    api.respondToGuardian.mockResolvedValue({ data: {} });

    await request(testApp())
      .post('/settings/guardians/respond')
      .send('assignment_id=7&action=declined&reason=I%20did%20not%20ask%20for%20this');

    expect(api.respondToGuardian).toHaveBeenCalledWith('test-token', 'declined', 7, 'I did not ask for this');
  });

  it('records a refusal with NO reason, because requiring one is pressure to agree', async () => {
    api.respondToGuardian.mockResolvedValue({ data: {} });

    const response = await request(testApp())
      .post('/settings/guardians/respond')
      .send('assignment_id=7&action=declined');

    expect(api.respondToGuardian).toHaveBeenCalledWith('test-token', 'declined', 7, '');
    expect(response.headers.location).toContain('status=guardian-declined');
  });

  it('refuses an action outside the ward vocabulary without calling the API', async () => {
    const response = await request(testApp())
      .post('/settings/guardians/respond')
      .send('assignment_id=7&action=revoked');

    // `revoked` is the STAFF exit, never a ward answer.
    expect(api.respondToGuardian).not.toHaveBeenCalled();
    expect(response.headers.location).toContain('status=guardian-failed');
  });

  it.each([
    [404, 'guardian-not-found'],
    [422, 'guardian-not-allowed'],
    [500, 'guardian-failed']
  ])('reports HTTP %s distinctly as "%s"', async (status, expected) => {
    api.respondToGuardian.mockRejectedValue(Object.assign(new Error('nope'), { status }));

    const response = await request(testApp())
      .post('/settings/guardians/respond')
      .send('assignment_id=7&action=consented');

    // "That is not yours" and "you cannot do that from here" need different
    // wording for the member.
    expect(response.headers.location).toContain(`status=${expected}`);
  });
});

describe('Setting what the guardian may do', () => {
  it('sends one capability at a time', async () => {
    api.updateGuardianPermissions.mockResolvedValue({ data: {} });

    const response = await request(testApp())
      .post('/settings/guardians/permissions')
      .send('assignment_id=7&capability=credits&tier=co_decide');

    expect(api.updateGuardianPermissions).toHaveBeenCalledWith('test-token', 7, 'credits', 'co_decide');
    expect(response.headers.location).toContain('status=guardian-tiers-saved');
  });

  it('refuses a hand-edited "assist" tier without calling the API', async () => {
    const response = await request(testApp())
      .post('/settings/guardians/permissions')
      .send('assignment_id=7&capability=credits&tier=assist');

    expect(api.updateGuardianPermissions).not.toHaveBeenCalled();
    expect(response.headers.location).toContain('status=guardian-tiers-failed');
  });

  it('refuses an unknown capability without calling the API', async () => {
    const response = await request(testApp())
      .post('/settings/guardians/permissions')
      .send('assignment_id=7&capability=messages&tier=co_decide');

    // Message viewing is never granted from this page — it has its own consent
    // machinery, and the dead can_view_messages boolean must stay dead.
    expect(api.updateGuardianPermissions).not.toHaveBeenCalled();
    expect(response.headers.location).toContain('status=guardian-tiers-failed');
  });
});

describe('Guardian page renders', () => {
  const env = nunjucks.configure(
    [path.join(__dirname, '..', 'src', 'views'), path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
    { autoescape: true, noCache: true }
  );

  function render(context) {
    return env.render('settings/guardians.njk', {
      t: (key, params) => (params ? `${key}(${JSON.stringify(params)})` : key),
      urlFor: (pathname) => `/hour-timebank/accessible${pathname}`,
      isAuthenticated: true,
      alphaNavItems: [], alphaFooterColumns: [], alphaLocaleOptions: [], alphaCurrentLocale: 'en',
      csrfToken: 'test-csrf',
      guardians: [], wards: [], grantableTiers: ['none', 'co_decide', 'represent'],
      statusKey: null, statusIsSuccess: false, statusIsError: false,
      ...context
    });
  }

  it('renders agree, refuse and withdraw as plain form posts with no JavaScript', () => {
    const html = render({
      guardians: [{
        id: 7, guardian_name: 'Bridget', state: 'pending', stateTagClass: 'govuk-tag--yellow',
        allowedActions: ['consented', 'declined'], addedOnLabel: '5 August 2026', capabilities: []
      }]
    });

    expect(html).toContain('name="assignment_id" value="7"');
    expect(html).toContain('value="consented"');
    expect(html).toContain('value="declined"');
    expect(html).toContain('name="_csrf"');
    // The reason field exists and is not marked required anywhere.
    expect(html).toContain('name="reason"');
    expect(html).not.toContain('required');

    // Every action is a plain form POST with a real submit button. The shared
    // layout does load GOV.UK's JavaScript, but only as progressive
    // enhancement, so the assertion that matters is that nothing here depends
    // on script running: no inline handlers, and no button outside a form.
    expect(html).not.toMatch(/on(click|submit|change)=/i);
    expect(html).toContain('method="post"');
    expect(html).toContain('type="submit"');
  });

  it('shows the capability selects only for an agreed arrangement', () => {
    const consented = render({
      guardians: [{
        id: 7, guardian_name: 'Bridget', state: 'consented', stateTagClass: 'govuk-tag--green',
        allowedActions: ['withdrawn'], addedOnLabel: '5 August 2026',
        capabilities: [{ key: 'listings', current: 'co_decide' }, { key: 'credits', current: 'none' }]
      }]
    });
    expect(consented).toContain('tiers_capability_listings');
    expect(consented).toContain('tiers_explainer');

    const pending = render({
      guardians: [{
        id: 7, guardian_name: 'Bridget', state: 'pending', stateTagClass: 'govuk-tag--yellow',
        allowedActions: ['consented', 'declined'], addedOnLabel: null, capabilities: []
      }]
    });
    // A grant must never stand in for the consent.
    expect(pending).not.toContain('tiers_capability_listings');
  });

  it('states plainly that an arrangement is a record, not a permission', () => {
    const html = render({});

    expect(html).toContain('govuk_alpha_settings.guardians.intro');
    expect(html).toContain('govuk_alpha_settings.guardians.none');
  });

  it('hides the wards section entirely when the member supports nobody', () => {
    expect(render({})).not.toContain('guardians.wards_title');
    expect(render({ wards: [{ ward_name: 'Sam', state: 'consented', stateTagClass: 'govuk-tag--green' }] }))
      .toContain('guardians.wards_title');
  });
});
