// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A safeguarding report's own page on the accessible frontend: the person who made the
 * report follows it in plain words and can add information until it is closed.
 *
 * Pinned here:
 * - the page shows the reference, the plain status word and the reporter's part of the
 *   history — the API only ever sends that part, and the page renders nothing else;
 * - adding information posts `{ body }` to the API and comes back with a confirmation;
 * - fewer than 20 characters is refused locally, with what was typed kept;
 * - a report closed in the meantime (API 409) says so; a closed report has no box;
 * - another member's report (API 404) is a plain "not found";
 * - sending a new report goes straight to its page.
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
const volunteeringIncidentRoutes = require('../src/routes/volunteering-incidents');
const volunteeringActionRoutes = require('../src/routes/volunteering-actions');

const PREFIX = '/acme/accessible';
const MOUNT = `${PREFIX}/volunteering`;
const VIEWS = path.join(__dirname, '..', 'src', 'views');
const GOVUK = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');

function createApp() {
  const app = express();
  const env = nunjucks.configure([VIEWS, GOVUK], { autoescape: true, express: app, watch: false });
  registerTemplateFilters(env);
  env.addFilter('formatDate', (value) => String(value || ''));
  env.addFilter('nl2br', (value) => String(value || ''));

  app.set('view engine', 'njk');
  app.set('views', VIEWS);
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'incident-pages-test-secret', resave: false, saveUninitialized: false }));

  app.use(MOUNT, (req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.accessibleRouting = {
      mode: 'shared',
      tenantSlug: 'acme',
      tenant: { id: 2, slug: 'acme', name: 'Acme Timebank', settings: {} },
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
  }, volunteeringIncidentRoutes, volunteeringActionRoutes);

  return app;
}

const REPORT = {
  id: 7,
  type: 'concern',
  severity: 'medium',
  status: 'investigating',
  incident_date: '2026-10-01',
  created_at: '2026-10-02 09:00:00',
  organization_id: 3,
  organization_name: 'Food Bank',
  opportunity_id: 9,
  opportunity_title: 'Sorting donations',
  title: 'Left alone on shift',
  description: 'A volunteer was left alone with a client for hours.',
  subject_name: 'Sam Jones',
  can_add: true,
  timeline: [
    { id: 1, type: 'reported', created_at: '2026-10-02 09:00:00' },
    { id: 2, type: 'status_changed', created_at: '2026-10-02 10:00:00', from: 'open', to: 'investigating' },
    { id: 3, type: 'message_to_reporter', created_at: '2026-10-02 11:00:00', body: 'Thank you for telling us.' },
    { id: 4, type: 'reporter_addition', created_at: '2026-10-02 12:00:00', body: 'It happened again on Tuesday.' }
  ]
};

function mockApi({ report = REPORT, addError = null } = {}) {
  api.callVolunteeringApi.mockImplementation(async (token, method, apiPath) => {
    if (method === 'GET' && apiPath === '/incidents/7') {
      if (report === null) throw new api.ApiError('Incident not found', 404, {});
      return { data: report };
    }
    if (method === 'POST' && apiPath === '/incidents/7/additions') {
      if (addError) throw addError;
      return { data: { event_id: 10 } };
    }
    if (method === 'POST' && apiPath === '/incidents') {
      return { data: { id: 501 } };
    }
    if (method === 'GET') return { data: { items: [] } };
    throw new api.ApiError('unexpected call', 500, {});
  });
}

function additionPosts() {
  return api.callVolunteeringApi.mock.calls.filter(([, method, apiPath]) => method === 'POST' && apiPath === '/incidents/7/additions');
}

const t = createTranslator('en');
const ADDITION = 'Another volunteer saw it happen on Wednesday too.';

beforeEach(() => {
  api.callVolunteeringApi.mockReset();
  mockApi();
});

describe('safeguarding report page', () => {
  it('shows the reference, the plain status word and the reporter’s part of the history', async () => {
    const res = await request(createApp()).get(`${MOUNT}/incidents/7`);

    expect(res.status).toBe(200);
    expect(api.callVolunteeringApi).toHaveBeenCalledWith('test-token', 'GET', '/incidents/7');
    expect(res.text).toContain('Left alone on shift');
    expect(res.text).toContain(t('govuk_alpha_volunteering.safeguarding.report_reference', { id: 7 }));
    expect(res.text).toContain(t('govuk_alpha_volunteering.safeguarding.member_status_looking_into'));
    expect(res.text).toContain('A volunteer was left alone with a client for hours.');
    expect(res.text).toContain('Food Bank');
    expect(res.text).toContain(t('govuk_alpha_volunteering.safeguarding.timeline_message_from_team'));
    expect(res.text).toContain('Thank you for telling us.');
    expect(res.text).toContain(t('govuk_alpha_volunteering.safeguarding.timeline_your_addition'));
    expect(res.text).toContain('It happened again on Tuesday.');
    expect(res.text).toContain('name="body"');
  });

  it('adds information and comes back with a confirmation', async () => {
    const agent = request.agent(createApp());
    const post = await agent.post(`${MOUNT}/incidents/7/additions`).type('form').send({ _csrf: 'test-csrf-token', body: `  ${ADDITION}  ` });

    expect(post.status).toBe(302);
    expect(post.headers.location).toBe(`${MOUNT}/incidents/7?status=information-added`);
    expect(additionPosts()).toHaveLength(1);
    expect(additionPosts()[0][3]).toEqual({ body: ADDITION });

    const page = await agent.get(post.headers.location);
    expect(page.text).toContain(t('govuk_alpha_volunteering.safeguarding.report_added'));
  });

  it('refuses fewer than 20 characters without sending, and keeps what was typed', async () => {
    const agent = request.agent(createApp());
    const post = await agent.post(`${MOUNT}/incidents/7/additions`).type('form').send({ _csrf: 'test-csrf-token', body: 'Too short.' });

    expect(post.headers.location).toBe(`${MOUNT}/incidents/7?status=addition-too-short#body`);
    expect(additionPosts()).toHaveLength(0);

    const page = await agent.get(`${MOUNT}/incidents/7?status=addition-too-short`);
    expect(page.text).toContain(t('govuk_alpha_volunteering.safeguarding.report_add_too_short'));
    expect(page.text).toContain('href="#body"');
    expect(page.text).toMatch(/<textarea[^>]*name="body"[^>]*>Too short\.<\/textarea>/);
  });

  it('says so when the report was closed in the meantime', async () => {
    mockApi({ addError: new api.ApiError('This report is closed.', 409, { errors: [{ code: 'INCIDENT_CLOSED' }] }) });
    const post = await request(createApp()).post(`${MOUNT}/incidents/7/additions`).type('form').send({ _csrf: 'test-csrf-token', body: ADDITION });

    expect(post.headers.location).toBe(`${MOUNT}/incidents/7?status=report-closed`);
  });

  it('keeps the text when the API refuses it for being too short', async () => {
    mockApi({ addError: new api.ApiError('Write between 20 and 5000 characters.', 422, { errors: [{ code: 'VALIDATION_ERROR', field: 'body' }] }) });
    const agent = request.agent(createApp());
    const post = await agent.post(`${MOUNT}/incidents/7/additions`).type('form').send({ _csrf: 'test-csrf-token', body: ADDITION });

    expect(post.headers.location).toBe(`${MOUNT}/incidents/7?status=addition-too-short#body`);
    const page = await agent.get(`${MOUNT}/incidents/7?status=addition-too-short`);
    expect(page.text).toContain(ADDITION);
  });

  it('shows no box on a closed report, and points to a new report instead', async () => {
    mockApi({ report: { ...REPORT, status: 'closed', can_add: false } });
    const res = await request(createApp()).get(`${MOUNT}/incidents/7`);

    expect(res.text).not.toContain('name="body"');
    expect(res.text).toContain(t('govuk_alpha_volunteering.safeguarding.report_closed_message'));
    expect(res.text).toContain(`href="${MOUNT}/incidents?tab=incidents#report-incident"`);
    expect(res.text).toContain(t('govuk_alpha_volunteering.safeguarding.member_status_closed'));
  });

  it('answers not found for a report that is not the member’s', async () => {
    mockApi({ report: null });
    const res = await request(createApp()).get(`${MOUNT}/incidents/7`);

    expect(res.status).toBe(404);
    expect(res.text).not.toContain('Left alone on shift');
  });

  it('takes a new report straight to its own page', async () => {
    const post = await request(createApp()).post(`${MOUNT}/incidents`).type('form').send({
      _csrf: 'test-csrf-token',
      title: 'Frightened volunteer',
      description: 'A volunteer seemed frightened of another adult and left early.',
      severity: 'high'
    });

    expect(post.headers.location).toBe(`${MOUNT}/incidents/501?status=incident-reported`);
  });

  it('links each report in the list to its page, with its reference', async () => {
    api.callVolunteeringApi.mockImplementation(async (token, method, apiPath) => {
      if (method === 'GET' && apiPath === '/incidents') {
        return { data: { items: [{ id: 7, title: 'Left alone on shift', severity: 'medium', status: 'open', created_at: '2026-10-02' }] } };
      }
      return { data: { items: [] } };
    });
    const res = await request(createApp()).get(`${MOUNT}/incidents?tab=incidents`);

    expect(res.text).toContain(`href="${MOUNT}/incidents/7"`);
    expect(res.text).toContain('#7');
  });
});

describe('organisation safeguarding pages', () => {
  const SUMMARY = {
    id: 12, type: 'allegation', severity: 'high', status: 'investigating', incident_date: '2026-10-01',
    created_at: '2026-10-02 09:00:00', opportunity_title: 'Sorting donations', full_report_shared: false
  };
  const DETAIL = {
    ...SUMMARY,
    relation: 'org_contact',
    timeline: [
      { id: 1, type: 'reported', created_at: '2026-10-02 09:00:00' },
      { id: 2, type: 'message_to_organisation', created_at: '2026-10-02 10:00:00', body: 'Please call the team.' },
      { id: 3, type: 'org_update', created_at: '2026-10-02 11:00:00', body: 'We stood the volunteer down.', actor_name: 'Olive Owner' }
    ]
  };

  function mockOrgApi({ list = { items: [SUMMARY, { ...SUMMARY, id: 13, full_report_shared: true }] }, detail = DETAIL, listError = null, updateError = null } = {}) {
    api.callVolunteeringApi.mockImplementation(async (token, method, apiPath) => {
      if (method === 'GET' && apiPath === '/organisations/3/incidents') {
        if (listError) throw listError;
        return { data: list };
      }
      if (method === 'GET' && apiPath === '/organisations/3/incidents/12') {
        if (detail === null) throw new api.ApiError('Incident not found', 404, {});
        return { data: detail };
      }
      if (method === 'POST' && apiPath === '/organisations/3/incidents/12/updates') {
        if (updateError) throw updateError;
        return { data: { event_id: 30 } };
      }
      throw new api.ApiError('unexpected call', 500, {});
    });
  }

  function updatePosts() {
    return api.callVolunteeringApi.mock.calls.filter(([, method, apiPath]) => method === 'POST' && apiPath === '/organisations/3/incidents/12/updates');
  }

  it('lists the reports linked to the organisation, with reference, plain status and which are shared', async () => {
    mockOrgApi();
    const res = await request(createApp()).get(`${MOUNT}/organisations/3/safeguarding`);

    expect(res.status).toBe(200);
    expect(res.text).toContain(`href="${MOUNT}/organisations/3/safeguarding/12"`);
    expect(res.text).toContain('#12');
    expect(res.text).toContain(t('govuk_alpha_volunteering.safeguarding.incident_type_allegation'));
    expect(res.text).toContain(t('govuk_alpha_volunteering.safeguarding.member_status_looking_into'));
    expect(res.text).toContain('Sorting donations');
    expect(res.text.split(t('govuk_alpha_volunteering.org_safeguarding.shared_chip')).length - 1).toBe(1);
  });

  it('answers 403 with no reports for someone with no part in the organisation', async () => {
    mockOrgApi({ listError: new api.ApiError('No access', 403, { errors: [{ code: 'NOT_ORGANISATION_CONTACT' }] }) });
    const res = await request(createApp()).get(`${MOUNT}/organisations/3/safeguarding`);

    expect(res.status).toBe(403);
    expect(res.text).not.toContain('/safeguarding/12');
  });

  it('shows the summary and history without the report while it is not shared', async () => {
    mockOrgApi();
    const res = await request(createApp()).get(`${MOUNT}/organisations/3/safeguarding/12`);

    expect(res.status).toBe(200);
    expect(res.text).toContain(t('govuk_alpha_volunteering.org_safeguarding.reference', { id: 12 }));
    // Nunjucks escapes the apostrophe in "community's".
    expect(res.text).toContain(t('govuk_alpha_volunteering.org_safeguarding.team_handling').replace(/'/g, '&#39;'));
    expect(res.text).not.toContain(t('govuk_alpha_volunteering.org_safeguarding.full_report_heading'));
    expect(res.text).toContain('Please call the team.');
    expect(res.text).toContain('We stood the volunteer down.');
    expect(res.text).toContain('name="body"');
  });

  it('shows the full report once shared, and never who made it', async () => {
    mockOrgApi({
      detail: {
        ...DETAIL,
        relation: 'org_lead',
        full_report_shared: true,
        title: 'Left alone on shift',
        description: 'A volunteer was left alone with a client.',
        subject_name: 'Sid Subject',
        reporter_name: 'Rita Reporter',
        timeline: [{ id: 4, type: 'reporter_addition', created_at: '2026-10-02 12:00:00', body: 'It happened again on Tuesday.' }]
      }
    });
    const res = await request(createApp()).get(`${MOUNT}/organisations/3/safeguarding/12`);

    expect(res.text).toContain(t('govuk_alpha_volunteering.org_safeguarding.full_report_heading'));
    expect(res.text).toContain('Left alone on shift');
    expect(res.text).toContain('Sid Subject');
    expect(res.text).toContain('It happened again on Tuesday.');
    expect(res.text).not.toContain('Rita Reporter');
  });

  it('sends an update and comes back with a confirmation', async () => {
    mockOrgApi();
    const agent = request.agent(createApp());
    const post = await agent.post(`${MOUNT}/organisations/3/safeguarding/12/updates`).type('form')
      .send({ _csrf: 'test-csrf-token', body: '  We have spoken to the volunteer today.  ' });

    expect(post.headers.location).toBe(`${MOUNT}/organisations/3/safeguarding/12?status=update-sent`);
    expect(updatePosts()[0][3]).toEqual({ body: 'We have spoken to the volunteer today.' });
    const page = await agent.get(post.headers.location);
    expect(page.text).toContain(t('govuk_alpha_volunteering.org_safeguarding.update_sent'));
  });

  it('refuses an update under 20 characters without sending, keeping the text', async () => {
    mockOrgApi();
    const agent = request.agent(createApp());
    const post = await agent.post(`${MOUNT}/organisations/3/safeguarding/12/updates`).type('form')
      .send({ _csrf: 'test-csrf-token', body: 'Too short.' });

    expect(post.headers.location).toBe(`${MOUNT}/organisations/3/safeguarding/12?status=update-too-short#body`);
    expect(updatePosts()).toHaveLength(0);
    const page = await agent.get(`${MOUNT}/organisations/3/safeguarding/12?status=update-too-short`);
    expect(page.text).toMatch(/<textarea[^>]*name="body"[^>]*>Too short\.<\/textarea>/);
  });

  it('answers not found for a report no longer linked to the organisation', async () => {
    mockOrgApi({ detail: null });
    const res = await request(createApp()).get(`${MOUNT}/organisations/3/safeguarding/12`);

    expect(res.status).toBe(404);
  });
});
