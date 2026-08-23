// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Field-level error targeting for the rest of the forms that built their error summary
 * from ONE hardcoded href. See tests/form-field-error-targeting.test.js for the doctrine;
 * this file covers polls, podcasts, seller onboarding and federation transfers.
 *
 * Each case drives the real route so the assertion is about what a member would actually
 * see, and each submits with exactly one thing wrong so a fix that marks everything, or
 * links everything to the first field, still fails.
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
    callPollApi: jest.fn(),
    getPollCategories: jest.fn(),
    callPodcastApi: jest.fn(),
    callFederationApi: jest.fn(),
    getBalance: jest.fn(),
    callMarketplaceApi: jest.fn(),
    callMerchantOnboardingApi: jest.fn(),
    callEventApi: jest.fn(),
    callEventBroadcastApi: jest.fn(),
    callAdminEventApi: jest.fn(),
    callEventTemplateApi: jest.fn(),
    downloadEventApi: jest.fn(),
    downloadEventRegistrationSubmissions: jest.fn(),
    getEventCategories: jest.fn(),
    uploadEventImage: jest.fn(),
    callUgcTranslateApi: jest.fn(),
    getEvents: jest.fn(),
    getEvent: jest.fn(),
    createEvent: jest.fn(),
    updateEvent: jest.fn(),
    cancelEvent: jest.fn(),
    deleteEvent: jest.fn(),
    getEventRsvps: jest.fn(),
    rsvpToEvent: jest.fn(),
    votePoll: jest.fn(),
    getPolls: jest.fn(),
    getPoll: jest.fn(),
    getProfile: jest.fn(),
    invalidateUserCache: jest.fn()
  };
});

const api = require('../src/lib/api');

const PREFIX = '/acme/accessible';
const VIEWS = path.join(__dirname, '..', 'src', 'views');
const GOVUK = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');
const ERROR_PREFIX = createTranslator('en')('states.error_prefix');

function createApp(mountPath, routers) {
  const app = express();
  const env = nunjucks.configure([VIEWS, GOVUK], { autoescape: true, express: app, watch: false });
  registerTemplateFilters(env);
  env.addFilter('formatDate', (value) => String(value || ''));
  env.addFilter('nl2br', (value) => String(value || ''));
  env.addFilter('string', String);

  app.set('view engine', 'njk');
  app.set('views', VIEWS);
  app.use(express.urlencoded({ extended: true }));
  app.use(session({
    secret: 'field-error-more-test-secret',
    resave: false,
    saveUninitialized: false,
    name: 'field-error-more-test.sid'
  }));

  app.use(mountPath, (req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.token = 'test-token';
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
      currentPath: mountPath,
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
  }, ...routers);

  return app;
}

function summaryOf(html) {
  const match = /<div class="govuk-error-summary"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/.exec(html);
  return match ? match[0] : '';
}

function summaryLinks(html) {
  return [...summaryOf(html).matchAll(/<li><a href="([^"]+)"/g)].map((m) => m[1]);
}

/** Backwards scan from the control to the nearest opening form group. */
function groupHasError(html, id) {
  const control = new RegExp(`id="${id}" name=`).exec(html);
  if (!control) return false;
  const groups = [...html.slice(0, control.index).matchAll(/<div class="govuk-form-group([^"]*)"/g)];
  if (groups.length === 0) return false;
  return groups[groups.length - 1][1].includes('govuk-form-group--error');
}

function hasFieldErrorMessage(html, id) {
  return new RegExp(`id="${id}-error" class="govuk-error-message"`).test(html);
}

// --------------------------------------------------------------------------------------
// polls/create.njk
// --------------------------------------------------------------------------------------

describe('poll create form points each error at its own field', () => {
  const MOUNT = `${PREFIX}/polls`;
  const VALID = {
    _csrf: 'test-csrf-token',
    question: 'Which night suits the repair cafe?',
    'options[]': ['Tuesday', 'Thursday'],
    poll_type: 'standard'
  };

  function pollApp() {
    const pollActionRoutes = require('../src/routes/poll-actions');
    return createApp(MOUNT, [pollActionRoutes]);
  }

  beforeEach(() => {
    api.getPollCategories.mockReset();
    api.callPollApi.mockReset();
    api.getProfile.mockReset();
    api.getProfile.mockResolvedValue({ data: { id: 7, name: 'Test Member' } });
    api.getPollCategories.mockResolvedValue({ data: [] });
    api.callPollApi.mockResolvedValue({ data: { id: 9 } });
  });

  async function submit(overrides) {
    const agent = request.agent(pollApp());
    await agent.post(`${MOUNT}/parity/create`).type('form').send({ ...VALID, ...overrides });
    return agent;
  }

  it('links a missing QUESTION to #poll-question and marks only that field', async () => {
    const agent = await submit({ question: '' });
    const page = await agent.get(`${MOUNT}/parity/create?status=poll-create-failed`);
    expect(page.status).toBe(200);
    expect(summaryLinks(page.text)).toEqual(['#poll-question']);
    expect(groupHasError(page.text, 'poll-question')).toBe(true);
    expect(hasFieldErrorMessage(page.text, 'poll-question')).toBe(true);
  });

  it('links too-few OPTIONS to the first option box, not the question', async () => {
    const agent = await submit({ 'options[]': ['Tuesday', ''] });
    const page = await agent.get(`${MOUNT}/parity/create?status=poll-create-failed`);
    expect(summaryLinks(page.text)).toEqual(['#poll-option-1']);
    expect(groupHasError(page.text, 'poll-question')).toBe(false);
    expect(page.text).toContain('id="poll-options-error" class="govuk-error-message"');
  });

  // 🔴 This is the one that used to be plainly wrong: an unreal closing DATE moved focus
  // to the question box.
  it('links an unreal closing DATE to the date input, not the question', async () => {
    const agent = await submit({
      'expires_at-day': '31',
      'expires_at-month': '2',
      'expires_at-year': '2027'
    });
    const page = await agent.get(`${MOUNT}/parity/create?status=poll-expires-invalid`);
    expect(summaryLinks(page.text)).toEqual(['#poll-expires-day']);
    expect(groupHasError(page.text, 'poll-question')).toBe(false);
  });

  it('links a past closing DATE to the date input too', async () => {
    const agent = await submit({
      'expires_at-day': '1',
      'expires_at-month': '1',
      'expires_at-year': '2020'
    });
    const page = await agent.get(`${MOUNT}/parity/create?status=poll-expires-past`);
    expect(summaryLinks(page.text)).toEqual(['#poll-expires-day']);
  });

  it('renders an API save failure as a sentence, not a link to the question', async () => {
    api.callPollApi.mockRejectedValueOnce(new api.ApiError('polls unavailable', 500, {}));
    const agent = await submit({});
    const page = await agent.get(`${MOUNT}/parity/create?status=poll-create-failed`);

    expect(summaryLinks(page.text)).toEqual([]);
    expect(summaryOf(page.text)).toContain('<p class="govuk-body">');
    expect(groupHasError(page.text, 'poll-question')).toBe(false);
  });

  it('shows no error summary on a clean visit', async () => {
    const page = await request(pollApp()).get(`${MOUNT}/parity/create`);
    expect(page.status).toBe(200);
    expect(summaryOf(page.text)).toBe('');
  });
});

// --------------------------------------------------------------------------------------
// podcasts/form.njk
// --------------------------------------------------------------------------------------

describe('podcast show form points its error at the title, and never dresses success as an error', () => {
  const MOUNT = `${PREFIX}/podcasts`;

  function podcastApp() {
    const podcastRoutes = require('../src/routes/podcasts');
    return createApp(MOUNT, [podcastRoutes]);
  }

  beforeEach(() => {
    api.callPodcastApi.mockReset();
    api.getProfile.mockReset();
    api.getProfile.mockResolvedValue({ data: { id: 7, name: 'Test Member', email: 'a@b.test' } });
    //  gates the studio; without it the route 403s before rendering.
    api.callPodcastApi.mockResolvedValue({ data: [], meta: { can_create_show: true, enable_private_shows: false } });
  });

  it('marks the title field on show-title-missing', async () => {
    const page = await request(podcastApp()).get(`${MOUNT}/studio/new?status=show-title-missing`);
    expect(page.status).toBe(200);
    expect(summaryLinks(page.text)).toEqual(['#title']);
    expect(groupHasError(page.text, 'title')).toBe(true);
    expect(hasFieldErrorMessage(page.text, 'title')).toBe(true);
    expect(page.text).toContain(`<span class="govuk-visually-hidden">${ERROR_PREFIX}</span>`);
  });

  // 🔴 An API save failure is not the title being wrong.
  it('renders a create failure as a sentence rather than a link to the title', async () => {
    const page = await request(podcastApp()).get(`${MOUNT}/studio/new?status=show-create-failed`);
    expect(summaryLinks(page.text)).toEqual([]);
    expect(summaryOf(page.text)).toContain('<p class="govuk-body">');
    expect(groupHasError(page.text, 'title')).toBe(false);
  });

  // 🔴 The old guard was `{% if status %}`, so a SUCCESS status rendered inside a box
  // headed "There is a problem".
  it('does NOT render an error summary for a success status', async () => {
    const page = await request(podcastApp()).get(`${MOUNT}/studio/new?status=show-created`);
    expect(page.status).toBe(200);
    expect(summaryOf(page.text)).toBe('');
  });

  it('shows no error summary on a clean visit', async () => {
    const page = await request(podcastApp()).get(`${MOUNT}/studio/new`);
    expect(page.status).toBe(200);
    expect(summaryOf(page.text)).toBe('');
  });
});

// --------------------------------------------------------------------------------------
// federation/transfer.njk
// --------------------------------------------------------------------------------------

describe('federation transfer form points each error at its own field', () => {
  const MOUNT = `${PREFIX}/federation`;

  function federationApp() {
    const federationRoutes = require('../src/routes/federation');
    return createApp(MOUNT, [federationRoutes]);
  }

  beforeEach(() => {
    api.callFederationApi.mockReset();
    api.getBalance.mockReset();
    api.getProfile.mockReset();
    api.getProfile.mockResolvedValue({ data: { id: 7, name: 'Test Member' } });
    api.getBalance.mockResolvedValue({ data: { balance: 40 } });
    api.callFederationApi.mockImplementation(async (token, method, apiPath) => {
      if (apiPath.startsWith('/settings')) {
        return {
          data: {
            settings: { federation_optin: true, transactions_enabled_federated: true }
          }
        };
      }
      if (/^\/members\/\d+/.test(apiPath)) {
        //  gates the transfer page; without it the route 404s.
        return { data: { id: 88, name: 'Distant Member', tenant_id: 3, tenant_name: 'Other timebank', transactions_enabled: true } };
      }
      return { data: [] };
    });
  });

  it('links an invalid AMOUNT to #amount', async () => {
    const page = await request(federationApp())
      .get(`${MOUNT}/members/88/transfer?status=transfer-amount-invalid`);
    expect(page.status).toBe(200);
    expect(summaryLinks(page.text)).toEqual(['#amount']);
    expect(groupHasError(page.text, 'amount')).toBe(true);
    expect(groupHasError(page.text, 'description')).toBe(false);
    expect(hasFieldErrorMessage(page.text, 'amount')).toBe(true);
  });

  // 🔴 This used to send the member to the Amount box to fix a missing description.
  it('links a missing DESCRIPTION to #description, not #amount', async () => {
    const page = await request(federationApp())
      .get(`${MOUNT}/members/88/transfer?status=transfer-description-required`);
    expect(summaryLinks(page.text)).toEqual(['#description']);
    expect(groupHasError(page.text, 'description')).toBe(true);
    expect(groupHasError(page.text, 'amount')).toBe(false);
    expect(hasFieldErrorMessage(page.text, 'description')).toBe(true);
  });

  it('renders a whole-page condition as a sentence, marking no field', async () => {
    const page = await request(federationApp())
      .get(`${MOUNT}/members/88/transfer?status=transfer-safeguarding-restricted`);
    expect(summaryLinks(page.text)).toEqual([]);
    expect(summaryOf(page.text)).toContain('<p class="govuk-body">');
    expect(groupHasError(page.text, 'amount')).toBe(false);
    expect(groupHasError(page.text, 'description')).toBe(false);
  });

  it('shows no error summary on a clean visit', async () => {
    const page = await request(federationApp()).get(`${MOUNT}/members/88/transfer`);
    expect(page.status).toBe(200);
    expect(summaryOf(page.text)).toBe('');
  });
});

// --------------------------------------------------------------------------------------
// events/registration-form.njk
// --------------------------------------------------------------------------------------

describe('event registration form editor names the field at fault', () => {
  const MOUNT = `${PREFIX}/events`;

  function eventsApp() {
    const eventRoutes = require('../src/routes/events');
    return createApp(MOUNT, [eventRoutes]);
  }

  const VALID = {
    _csrf: 'test-csrf-token',
    idempotency_key: 'test-key',
    expected_settings_revision: '3',
    name: 'Attendee details',
    'questions[0][enabled]': '1',
    'questions[0][stable_key]': 'question_1',
    'questions[0][question_type]': 'short_text',
    'questions[0][data_classification]': 'internal',
    'questions[0][prompt]': 'What is your name?',
    'questions[0][purpose]': 'Contacting you about the event',
    'questions[0][retention_days]': '30'
  };

  beforeEach(() => {
    api.callEventApi.mockReset();
    api.getProfile.mockReset();
    api.getProfile.mockResolvedValue({ data: { id: 7, name: 'Test Organiser' } });
    api.callEventApi.mockImplementation(async (token, method, apiPath) => {
      if (method === 'GET' && /\/registration-product\/manage/.test(apiPath)) {
        return { data: { settings: { revision: 3 }, forms: [] } };
      }
      if (method === 'GET' && /\/registration-product$/.test(apiPath)) return { data: {} };
      if (method === 'GET') return { data: {} };
      throw new api.ApiError('registration service unavailable', 503, {});
    });
  });

  async function submit(overrides, removeKeys = []) {
    const body = { ...VALID, ...overrides };
    removeKeys.forEach((key) => { delete body[key]; });
    const agent = request.agent(eventsApp());
    await agent.post(`${MOUNT}/12/registration/forms/new`).type('form').send(body);
    return agent;
  }

  it('links a missing NAME to #form-name and marks that field', async () => {
    const agent = await submit({ name: '' });
    const page = await agent.get(`${MOUNT}/12/registration/forms/new?status=invalid`);
    expect(page.status).toBe(200);
    expect(summaryLinks(page.text)).toEqual(['#form-name']);
    expect(groupHasError(page.text, 'form-name')).toBe(true);
    expect(hasFieldErrorMessage(page.text, 'form-name')).toBe(true);
  });

  // 🔴 This used to show "Check the information you entered and try again." pointing at
  // the NAME box, when the name was fine and the member had simply enabled no question.
  it('links NO ENABLED QUESTION to the first question row, not the name box', async () => {
    const agent = await submit({}, ['questions[0][enabled]']);
    const page = await agent.get(`${MOUNT}/12/registration/forms/new?status=invalid`);
    expect(page.status).toBe(200);
    expect(summaryLinks(page.text)).toEqual(['#question-0-enabled']);
    expect(groupHasError(page.text, 'form-name')).toBe(false);
    expect(page.text).toContain('id="question-0-enabled-error" class="govuk-error-message"');
  });

  it('lists both errors separately when the name AND the questions are wrong', async () => {
    const agent = await submit({ name: '' }, ['questions[0][enabled]']);
    const page = await agent.get(`${MOUNT}/12/registration/forms/new?status=invalid`);
    expect(summaryLinks(page.text)).toEqual(['#form-name', '#question-0-enabled']);
  });

  // A missing hidden revision means the page is stale, not that a field is wrong.
  it('renders a stale-page submission as a sentence, marking no field', async () => {
    const agent = await submit({}, ['expected_settings_revision']);
    const page = await agent.get(`${MOUNT}/12/registration/forms/new?status=invalid`);
    expect(summaryLinks(page.text)).toEqual([]);
    expect(summaryOf(page.text)).toContain('<p class="govuk-body">');
    expect(groupHasError(page.text, 'form-name')).toBe(false);
  });

  it('renders an API refusal as a sentence, marking no field', async () => {
    const agent = await submit({});
    const page = await agent.get(`${MOUNT}/12/registration/forms/new?status=failed`);
    expect(summaryLinks(page.text)).toEqual([]);
    expect(summaryOf(page.text)).toContain('<p class="govuk-body">');
    expect(groupHasError(page.text, 'form-name')).toBe(false);
  });

  it('shows no error summary on a clean visit', async () => {
    const page = await request(eventsApp()).get(`${MOUNT}/12/registration/forms/new`);
    expect(page.status).toBe(200);
    expect(summaryOf(page.text)).toBe('');
  });
});
