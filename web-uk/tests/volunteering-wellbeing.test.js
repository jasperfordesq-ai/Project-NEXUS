// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The accessible wellbeing page must say honestly what happened after a shared
 * check-in (20 Oct 2026): how many people were told, that the team was already
 * told today, or that nobody could be told yet — never "someone will be in touch"
 * when nobody was. It also shows the community's "If you need support now" box
 * and when the team was last told, and its load error is translated.
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
    getVolunteeringCategories: jest.fn(),
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

function createApp() {
  const app = express();
  const env = nunjucks.configure([VIEWS, GOVUK], { autoescape: true, express: app, watch: false });
  registerTemplateFilters(env);
  env.addFilter('formatDate', (value) => String(value || ''));
  env.addFilter('nl2br', (value) => String(value || ''));
  env.addFilter('string', String);

  app.set('view engine', 'njk');
  app.set('views', VIEWS);
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'wellbeing-test-secret', resave: false, saveUninitialized: false, name: 'wellbeing-test.sid' }));

  app.use(MOUNT, (req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.token = 'test-token';
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
  }, volunteeringActionRoutes);

  return app;
}

const DASHBOARD = {
  data: {
    score: 45,
    hours_this_week: 2,
    hours_this_month: 8,
    streak_days: 1,
    burnout_risk: 'high',
    warnings: [],
    suggested_rest_days: [],
    recent_checkins: [],
    support: {
      text: 'Ring the office any weekday.',
      links: [{ label: 'Our office', url: 'tel:+353100' }, { label: 'Contact the team', url: '/contact' }],
      is_default: false
    },
    last_team_notified_at: '2026-10-20 12:05:22',
    last_told_count: 2
  }
};

const t = createTranslator('en');
const tc = createChoiceTranslator('en');

// The assessment figures: none of these may appear unless the API really scored the member.
function expectNoAssessment(text) {
  expect(text).not.toContain('id="wellbeing-score"');
  expect(text).not.toContain(t('govuk_alpha_volunteering.wellbeing.score_out_of'));
  expect(text).not.toContain(`${t('govuk_alpha_volunteering.wellbeing.risk_label')}:`);
  expect(text).not.toContain('govuk-tag--green');
  expect(text).not.toContain(t('govuk_alpha_volunteering.wellbeing.no_warnings'));
  expect(text).not.toContain('team was last told on');
}

function expectCheckinFormUsable(text) {
  expect(text).toContain('action="/acme/accessible/volunteering/wellbeing/checkin"');
  expect(text).toContain('name="mood"');
  expect(text).toContain('name="share_with_team"');
}

beforeEach(() => {
  api.callVolunteeringApi.mockReset();
  api.getProfile.mockReset();
  api.getProfile.mockResolvedValue({ data: { id: 7, name: 'Test Volunteer' } });
});

describe('accessible wellbeing page', () => {
  it('shows the community support box with its links, and when the team was last told', async () => {
    api.callVolunteeringApi.mockResolvedValue(DASHBOARD);
    const res = await request(createApp()).get(`${MOUNT}/wellbeing`);

    expect(res.status).toBe(200);
    expect(res.text).toContain(t('govuk_alpha_volunteering.wellbeing.support_title'));
    expect(res.text).toContain('Ring the office any weekday.');
    expect(res.text).toContain('href="tel:+353100"');
    expect(res.text).toContain(`href="${PREFIX}/contact"`);
    // Nunjucks escapes the apostrophe in "community's", so match the unambiguous tail.
    expect(res.text).toContain('team was last told on');
  });

  it('uses a translated message, not hard-coded English, when the dashboard cannot be loaded', async () => {
    api.callVolunteeringApi.mockRejectedValue(new api.ApiError('boom', 500, {}));
    const res = await request(createApp()).get(`${MOUNT}/wellbeing`);

    const key = 'govuk_alpha_volunteering.wellbeing.load_error';
    expect(t(key)).not.toBe(key);
    expect(res.text).toContain(t(key));
  });

  it('shows no score, risk, warnings or last-told line when the dashboard cannot be loaded, but keeps the check-in form', async () => {
    api.callVolunteeringApi.mockRejectedValue(new api.ApiError('boom', 500, {}));
    const res = await request(createApp()).get(`${MOUNT}/wellbeing`);

    expect(res.status).toBe(200);
    expect(res.text).toContain(t('govuk_alpha_volunteering.wellbeing.load_error'));
    const key = 'govuk_alpha_volunteering.wellbeing.assessment_unavailable';
    expect(t(key)).not.toBe(key);
    expect(res.text).toContain(t(key));
    // The old page rendered normalizeWellbeingDashboard({}) beside the error: 100 out of 100, Low risk.
    expect(res.text).not.toContain('100 out of 100');
    expectNoAssessment(res.text);
    expectCheckinFormUsable(res.text);
  });

  it('says there is not enough activity to score, instead of 100/100 and Low, when score_basis is no_data', async () => {
    api.callVolunteeringApi.mockResolvedValue({
      data: { score: 100, burnout_risk: 'low', score_basis: 'no_data', warnings: [], recent_checkins: [], hours_this_week: 0, hours_this_month: 0, streak_days: 0 }
    });
    const res = await request(createApp()).get(`${MOUNT}/wellbeing`);

    expect(res.status).toBe(200);
    const key = 'govuk_alpha_volunteering.wellbeing.score_no_data';
    expect(t(key)).not.toBe(key);
    expect(res.text).toContain(t(key));
    expect(res.text).not.toContain('100 out of 100');
    expectNoAssessment(res.text);
    expect(res.text).not.toContain(t('govuk_alpha_volunteering.wellbeing.load_error'));
    expectCheckinFormUsable(res.text);
  });

  it('still shows the score and risk when score_basis is activity, or when an older API sends no score_basis', async () => {
    for (const extra of [{ score_basis: 'activity' }, {}]) {
      api.callVolunteeringApi.mockResolvedValue({ data: { ...DASHBOARD.data, ...extra } });
      const res = await request(createApp()).get(`${MOUNT}/wellbeing`);
      expect(res.text).toContain('45 out of 100');
      expect(res.text).toContain('govuk-tag--red');
      expect(res.text).not.toContain(t('govuk_alpha_volunteering.wellbeing.score_no_data'));
    }
  });

  it.each([
    [{ team_notified: true, told_count: 2, outcome: 'told' }, '/volunteering/wellbeing?status=checkin-saved-shared&told=2'],
    [{ team_notified: false, told_count: 0, outcome: 'nobody_available' }, '/volunteering/wellbeing?status=checkin-saved-nobody'],
    [{ team_notified: false, told_count: 2, outcome: 'already_told_today' }, '/volunteering/wellbeing?status=checkin-saved-already'],
    // The volunteer is staff and the only person on the team: nobody ELSE was told.
    [{ team_notified: true, told_count: 0, outcome: 'told_self_only' }, '/volunteering/wellbeing?status=checkin-saved-self'],
    [{ team_notified: true, told_count: 1, outcome: 'told' }, '/volunteering/wellbeing?status=checkin-saved-shared&told=1'],
    [{ team_notified: false, told_count: 0, outcome: 'private' }, '/volunteering/wellbeing?status=checkin-saved'],
    // An older API without `outcome` still works from team_notified alone.
    [{ team_notified: true }, '/volunteering/wellbeing?status=checkin-saved-shared'],
    [{ team_notified: false }, '/volunteering/wellbeing?status=checkin-saved']
  ])('redirects a saved check-in %o to %s', async (saved, expected) => {
    api.callVolunteeringApi.mockResolvedValue({ data: { id: 9, mood: 1, note: null, shared: true, ...saved } });
    const res = await request(createApp())
      .post(`${MOUNT}/wellbeing/checkin`)
      .type('form')
      .send({ _csrf: 'test-csrf-token', mood: '1', note: '', share_with_team: '1' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${PREFIX}${expected}`);
  });

  it('renders the three outcomes as notices, with "nobody could be told" as a warning and not an error', async () => {
    api.callVolunteeringApi.mockResolvedValue(DASHBOARD);
    const app = createApp();

    const told = await request(app).get(`${MOUNT}/wellbeing?status=checkin-saved-shared&told=2`);
    const twoOthers = tc('govuk_alpha_volunteering.wellbeing.checkin_saved_shared_count', 2);
    expect(twoOthers).toContain('2 other people');
    expect(told.text).toContain(twoOthers);
    expect(told.text).not.toContain('|');
    expect(told.text).toContain('govuk-notification-banner--success');

    // told_count excludes the volunteer, so one is "1 other person", never "1 people".
    const one = await request(app).get(`${MOUNT}/wellbeing?status=checkin-saved-shared&told=1`);
    const oneOther = tc('govuk_alpha_volunteering.wellbeing.checkin_saved_shared_count', 1);
    expect(oneOther).toContain('1 other person');
    expect(oneOther).not.toContain('people');
    expect(one.text).toContain(oneOther);

    // Without a count the message must not promise when anyone will be in touch.
    const plain = await request(app).get(`${MOUNT}/wellbeing?status=checkin-saved-shared`);
    const plainMessage = t('govuk_alpha_volunteering.wellbeing.checkin_saved_shared');
    expect(plain.text).toContain(plainMessage.replace(/'/g, '&#39;'));
    expect(plainMessage).not.toMatch(/will be in touch|within|today|soon|shortly/i);

    const self = await request(app).get(`${MOUNT}/wellbeing?status=checkin-saved-self`);
    const selfKey = 'govuk_alpha_volunteering.wellbeing.checkin_saved_self';
    expect(t(selfKey)).not.toBe(selfKey);
    expect(self.text).toContain(t(selfKey).replace(/'/g, '&#39;'));
    expect(self.text).toContain(t('govuk_alpha.states.important'));
    expect(self.text).not.toContain('govuk-error-summary__title');
    expect(self.text).not.toContain('govuk-notification-banner--success');

    const already = await request(app).get(`${MOUNT}/wellbeing?status=checkin-saved-already`);
    expect(already.text).toContain(t('govuk_alpha_volunteering.wellbeing.checkin_saved_already'));

    const nobody = await request(app).get(`${MOUNT}/wellbeing?status=checkin-saved-nobody`);
    expect(nobody.text).toContain(t('govuk_alpha_volunteering.wellbeing.checkin_saved_nobody'));
    expect(nobody.text).not.toContain('govuk-error-summary__title');
    expect(nobody.text).toContain('govuk-notification-banner');
  });

  it('tells the member every place a shared check-in goes', async () => {
    api.callVolunteeringApi.mockResolvedValue(DASHBOARD);
    const res = await request(createApp()).get(`${MOUNT}/wellbeing`);
    const hint = t('govuk_alpha_volunteering.wellbeing.share_hint');
    expect(hint).toMatch(/community.s team/);
    expect(hint).toMatch(/network/);
    expect(hint).toMatch(/contact address/);
    expect(hint).toMatch(/organisations you volunteer with/);
    expect(hint).toMatch(/not your note/);
    // Rendered with HTML escaping, so check a fragment without an apostrophe.
    expect(res.text).toContain('part of a larger network');
    expect(res.text).toContain('wellbeing contact address');
  });
});
