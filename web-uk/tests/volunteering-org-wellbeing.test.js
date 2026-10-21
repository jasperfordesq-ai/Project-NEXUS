// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The organisation's wellbeing page on the accessible frontend (20 Oct 2026): which of
 * its volunteers said they are low or struggling and asked for someone to get in touch.
 *
 * Pinned here:
 * - the page lists the volunteer by name with how they feel, when they checked in, when
 *   the organisation was told and the plain status word — and never a note;
 * - an open alert shows the "what to do" notice; a message link goes to the member;
 * - 403 from the API (no part in the organisation) is a plain forbidden page;
 * - an empty list says so without a table.
 */

const path = require('path');
const express = require('express');
const session = require('express-session');
const nunjucks = require('nunjucks');
const request = require('supertest');
const { createChoiceTranslator, createTranslator, formatLocaleDate } = require('../src/lib/localization');
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
    searchUsers: jest.fn(),
    getProfile: jest.fn(),
    invalidateUserCache: jest.fn()
  };
});

const api = require('../src/lib/api');
const volunteeringIncidentRoutes = require('../src/routes/volunteering-incidents');

const PREFIX = '/acme/accessible';
const MOUNT = `${PREFIX}/volunteering`;
const VIEWS = path.join(__dirname, '..', 'src', 'views');
const GOVUK = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');
const t = createTranslator('en');

function createApp() {
  const app = express();
  const env = nunjucks.configure([VIEWS, GOVUK], { autoescape: true, express: app, watch: false });
  registerTemplateFilters(env);
  env.addFilter('formatDate', (value) => String(value || ''));
  env.addFilter('nl2br', (value) => String(value || ''));

  app.set('view engine', 'njk');
  app.set('views', VIEWS);
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'org-wellbeing-test-secret', resave: false, saveUninitialized: false }));

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
      // The real formatter, so the page's time handling is what is tested (21 Oct 2026).
      formatLocaleDate: (value, options = {}) => formatLocaleDate(value, 'en', options)
    });
    next();
  }, volunteeringIncidentRoutes);

  return app;
}

const ITEM = {
  alert_id: 22,
  volunteer: { id: 12, name: 'Pat Murphy', avatar_url: null },
  mood: 1,
  checkin_at: '2026-10-20 12:05:22',
  status: 'active',
  told_at: '2026-10-20 12:05:30',
  raised_at: '2026-10-20 12:05:22',
  updated_at: '2026-10-20 12:14:17'
};

describe('accessible organisation wellbeing page', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists the volunteers who asked for someone to get in touch, with how they feel and when the organisation was told', async () => {
    api.callVolunteeringApi.mockResolvedValue({ data: { organisation: { id: 3, name: 'Food Bank' }, items: [ITEM] } });
    const res = await request(createApp()).get(`${MOUNT}/organisations/3/wellbeing`);

    expect(res.status).toBe(200);
    expect(api.callVolunteeringApi).toHaveBeenCalledWith('test-token', 'GET', '/organisations/3/wellbeing');
    expect(res.text).toContain('Pat Murphy');
    expect(res.text).toContain(`href="${PREFIX}/members/12"`);
    expect(res.text).toContain(`href="${PREFIX}/messages/12"`);
    expect(res.text).toContain(t('govuk_alpha_volunteering.org_wellbeing.mood_struggling'));
    // The bare database stamps are UTC and are shown as UTC, saying so.
    expect(res.text).toContain('<td class="govuk-table__cell">20 Oct 2026, 12:05 UTC</td>');
    expect(res.text).toContain(t('govuk_alpha_volunteering.org_wellbeing.status_active'));
    expect(res.text).toContain(t('govuk_alpha_volunteering.org_wellbeing.what_to_do').replace(/'/g, '&#39;'));
  });

  it('says so when nobody has asked, and answers 403 for someone with no part in the organisation', async () => {
    api.callVolunteeringApi.mockResolvedValueOnce({ data: { organisation: { id: 3, name: 'Food Bank' }, items: [] } });
    const empty = await request(createApp()).get(`${MOUNT}/organisations/3/wellbeing`);
    expect(empty.status).toBe(200);
    expect(empty.text).toContain(t('govuk_alpha_volunteering.org_wellbeing.empty'));
    expect(empty.text).not.toContain('govuk-table__body');

    api.callVolunteeringApi.mockRejectedValueOnce(new api.ApiError('No access', 403, { errors: [{ code: 'NOT_ORGANISATION_CONTACT' }] }));
    const forbidden = await request(createApp()).get(`${MOUNT}/organisations/3/wellbeing`);
    expect(forbidden.status).toBe(403);
  });
});

// Wellbeing deep audit, second pass (21 Oct 2026).
describe('accessible organisation wellbeing page — deep audit fixes', () => {
  beforeEach(() => jest.clearAllMocks());

  // C6: an ISO time with an offset is the same moment as the bare UTC stamp.
  it('reads ISO-8601 times by their offset and shows them in UTC', async () => {
    api.callVolunteeringApi.mockResolvedValue({
      data: { organisation: { id: 3, name: 'Food Bank' }, items: [{ ...ITEM, checkin_at: '2026-10-20T13:05:22+01:00', told_at: '2026-10-20T12:05:30+00:00' }] }
    });
    const res = await request(createApp()).get(`${MOUNT}/organisations/3/wellbeing`);
    const cells = res.text.match(/<td class="govuk-table__cell">20 Oct 2026, 12:05 UTC<\/td>/g) || [];
    expect(cells).toHaveLength(2);
  });

  // C17: Polish "few" covers 2–4, 22–24, 32–34 … (but not 12–14), which the old
  // `{1}|[2,4]|[5,*]` ranges sent to the "many" form.
  it.each([
    [1, ':count wolontariusz czeka'],
    [2, ':count wolontariusze czekają'],
    [4, ':count wolontariusze czekają'],
    [5, ':count wolontariuszy czeka'],
    [12, ':count wolontariuszy czeka'],
    [14, ':count wolontariuszy czeka'],
    [21, ':count wolontariuszy czeka'],
    [22, ':count wolontariusze czekają'],
    [24, ':count wolontariusze czekają'],
    [25, ':count wolontariuszy czeka'],
    [33, ':count wolontariusze czekają'],
    [94, ':count wolontariusze czekają'],
    [101, ':count wolontariuszy czeka'],
    [102, ':count wolontariusze czekają'],
    [112, ':count wolontariuszy czeka']
  ])('picks the right Polish plural form of the open-alert summary for %i', (count, expected) => {
    const tcPl = createChoiceTranslator('pl');
    expect(tcPl('govuk_alpha_volunteering.org_wellbeing.summary', count, { count }))
      .toContain(expected.replace(':count', String(count)));
  });

  it.each([
    [1, 'inną osobę'],
    [3, 'inne osoby'],
    [7, 'innych osób'],
    [13, 'innych osób'],
    [23, 'inne osoby'],
    [42, 'inne osoby'],
    [45, 'innych osób']
  ])('picks the right Polish plural form of "we told N other people" for %i', (count, expected) => {
    const tcPl = createChoiceTranslator('pl');
    const text = tcPl('govuk_alpha_volunteering.wellbeing.checkin_saved_shared_count', count);
    expect(text).toContain(`Powiadomiliśmy ${count} ${expected}`);
    expect(text).not.toContain('|');
  });
});
