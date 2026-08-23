// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A failed submission must never throw away what the member typed — the volunteering
 * forms, where the losses were largest.
 *
 * The safeguarding incident form is the worst case on the whole frontend: its
 * `description.length < 20` check rejected the submission and then discarded up to 2,000
 * characters of a written safeguarding report, which a member may not be able to
 * reconstruct from memory.
 *
 * Every case posts the field NAMES THE TEMPLATE EMITS, not the names the handler happens
 * to read, so a template rename cannot leave the test passing against a form nobody fills
 * in.
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
    uploadVolunteerCredential: jest.fn(),
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
  app.use(session({
    secret: 'volunteering-replay-test-secret',
    resave: false,
    saveUninitialized: false,
    name: 'volunteering-replay-test.sid'
  }));

  app.use(MOUNT, (req, res, next) => {
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

// 🔴 The `(?![-\w])` guard matters: `id="amount"` also matches inside `id="amount-hint"`,
// and a hint div has no value attribute — without the guard these helpers reported a
// working fix as broken.
function valueOf(html, id) {
  const match = new RegExp(`id="${id}"(?![-\\w])[^>]*\\svalue="([^"]*)"`).exec(html);
  return match ? match[1] : null;
}

function textareaValue(html, id) {
  const match = new RegExp(`id="${id}"(?![-\\w])[^>]*>([\\s\\S]*?)</textarea>`).exec(html);
  return match ? match[1].trim() : null;
}

function isChecked(html, id) {
  return new RegExp(`id="${id}"(?![-\\w])[^>]*\\schecked`).test(html);
}

function isSelected(html, value) {
  return new RegExp(`<option value="${value}" selected`).test(html);
}

beforeEach(() => {
  api.callVolunteeringApi.mockReset();
  api.getProfile.mockReset();
  api.getProfile.mockResolvedValue({ data: { id: 7, name: 'Test Volunteer' } });
  api.callVolunteeringApi.mockImplementation(async (token, method, apiPath) => {
    // Reads succeed; every WRITE fails, which is the interesting case.
    if (method === 'GET') {
      // The expenses form is only rendered when the member belongs to at least one
      // organisation, and the route reads that list through `collectionFrom`, i.e. `items`.
      if (String(apiPath).startsWith('/my-organisations')) {
        return { data: { items: [{ id: 4, name: 'Bantry Community Trust' }] } };
      }
      return { data: { items: [], payment_methods: [] } };
    }
    throw new api.ApiError('volunteering service unavailable', 503, {});
  });
});

describe('wellbeing check-in keeps the note the member wrote', () => {
  const NOTE = 'Third week of the walking group. My knee is better but Tuesdays are hard.';

  it('refills the note after an invalid mood', async () => {
    const agent = request.agent(createApp());
    const post = await agent
      .post(`${MOUNT}/wellbeing/checkin`)
      .type('form')
      .send({ _csrf: 'test-csrf-token', mood: '9', note: NOTE });
    expect(post.headers.location).toContain('status=mood-invalid');

    const page = await agent.get(`${MOUNT}/wellbeing?status=mood-invalid`);
    expect(page.status).toBe(200);
    expect(textareaValue(page.text, 'note')).toBe(NOTE);
  });

  it('refills the note after the check-in could not be saved', async () => {
    const agent = request.agent(createApp());
    await agent
      .post(`${MOUNT}/wellbeing/checkin`)
      .type('form')
      .send({ _csrf: 'test-csrf-token', mood: '3', note: NOTE });

    const page = await agent.get(`${MOUNT}/wellbeing?status=checkin-failed`);
    expect(textareaValue(page.text, 'note')).toBe(NOTE);
    expect(isChecked(page.text, 'mood-3')).toBe(true);
  });

  it('consumes the stash once', async () => {
    const agent = request.agent(createApp());
    await agent.post(`${MOUNT}/wellbeing/checkin`).type('form')
      .send({ _csrf: 'test-csrf-token', mood: '3', note: NOTE });
    await agent.get(`${MOUNT}/wellbeing?status=checkin-failed`);
    const second = await agent.get(`${MOUNT}/wellbeing`);
    expect(textareaValue(second.text, 'note')).toBe('');
  });
});

describe('donation form keeps the amount and message', () => {
  const MESSAGE = 'For the community fridge, in memory of my mother who used it every week.';

  it('refills the amount and message after the amount is rejected', async () => {
    const agent = request.agent(createApp());
    const post = await agent
      .post(`${MOUNT}/donations`)
      .type('form')
      .send({ _csrf: 'test-csrf-token', amount: '0', message: MESSAGE, is_anonymous: '1' });
    expect(post.headers.location).toContain('donate_error=amount');

    const page = await agent.get(`${MOUNT}/donations?status=donate-failed&donate_error=amount#donate`);
    expect(page.status).toBe(200);
    expect(valueOf(page.text, 'donate-amount')).toBe('0');
    expect(textareaValue(page.text, 'donate-message')).toBe(MESSAGE);
    expect(isChecked(page.text, 'donate-anonymous')).toBe(true);
  });

  it('consumes the stash once', async () => {
    const agent = request.agent(createApp());
    await agent.post(`${MOUNT}/donations`).type('form')
      .send({ _csrf: 'test-csrf-token', amount: '0', message: MESSAGE });
    await agent.get(`${MOUNT}/donations?status=donate-failed&donate_error=amount`);
    const second = await agent.get(`${MOUNT}/donations`);
    expect(valueOf(second.text, 'donate-amount')).toBe('');
    expect(textareaValue(second.text, 'donate-message')).toBe('');
  });
});

describe('expense claim keeps every typed field', () => {
  const DESCRIPTION = 'Return bus fare to the day centre on the 4th, 11th and 18th.';

  it('refills the claim after a rejected amount', async () => {
    const agent = request.agent(createApp());
    const post = await agent
      .post(`${MOUNT}/expenses`)
      .type('form')
      .send({
        _csrf: 'test-csrf-token',
        organization_id: '4',
        expense_type: 'travel',
        amount: '0',
        currency: 'EUR',
        description: DESCRIPTION
      });
    expect(post.headers.location).toContain('status=expense-amount-invalid');

    const page = await agent.get(`${MOUNT}/expenses?status=expense-amount-invalid`);
    expect(page.status).toBe(200);
    expect(valueOf(page.text, 'amount')).toBe('0');
    expect(valueOf(page.text, 'currency')).toBe('EUR');
    expect(textareaValue(page.text, 'description')).toBe(DESCRIPTION);
    expect(isSelected(page.text, '4')).toBe(true);
  });

  it('refills the claim after the API refuses it', async () => {
    const agent = request.agent(createApp());
    await agent
      .post(`${MOUNT}/expenses`)
      .type('form')
      .send({
        _csrf: 'test-csrf-token',
        organization_id: '4',
        expense_type: 'travel',
        amount: '12.50',
        currency: 'EUR',
        description: DESCRIPTION
      });

    const page = await agent.get(`${MOUNT}/expenses?status=expense-failed`);
    expect(valueOf(page.text, 'amount')).toBe('12.50');
    expect(textareaValue(page.text, 'description')).toBe(DESCRIPTION);
  });

  it('consumes the stash once', async () => {
    const agent = request.agent(createApp());
    await agent.post(`${MOUNT}/expenses`).type('form')
      .send({ _csrf: 'test-csrf-token', organization_id: '4', amount: '0', description: DESCRIPTION });
    await agent.get(`${MOUNT}/expenses?status=expense-amount-invalid`);
    const second = await agent.get(`${MOUNT}/expenses`);
    expect(textareaValue(second.text, 'description')).toBe('');
  });
});

describe('safeguarding incident report keeps the written report', () => {
  const REPORT = 'On Tuesday afternoon a visitor became distressed in the hall and left before anyone could speak to them.';

  // 🔴 The rule is "at least 20 characters", so a SHORT report is exactly the case where
  // the old behaviour discarded what was written and asked for more of it.
  it('refills the report after the too-short check rejects it', async () => {
    const agent = request.agent(createApp());
    const post = await agent
      .post(`${MOUNT}/incidents`)
      .type('form')
      .send({
        _csrf: 'test-csrf-token',
        title: 'Distressed visitor',
        description: 'Too short',
        severity: 'high',
        category: 'wellbeing'
      });
    expect(post.headers.location).toContain('status=incident-description-too-short');

    const page = await agent.get(`${MOUNT}/incidents?status=incident-description-too-short&tab=incidents`);
    expect(page.status).toBe(200);
    expect(valueOf(page.text, 'title')).toBe('Distressed visitor');
    expect(textareaValue(page.text, 'description')).toBe('Too short');
    expect(isChecked(page.text, 'severity-high')).toBe(true);
    expect(valueOf(page.text, 'category')).toBe('wellbeing');
  });

  it('refills a full report after the API refuses it', async () => {
    const agent = request.agent(createApp());
    await agent
      .post(`${MOUNT}/incidents`)
      .type('form')
      .send({
        _csrf: 'test-csrf-token',
        title: 'Distressed visitor',
        description: REPORT,
        severity: 'critical'
      });

    const page = await agent.get(`${MOUNT}/incidents?status=incident-failed&tab=incidents`);
    expect(textareaValue(page.text, 'description')).toBe(REPORT);
    expect(isChecked(page.text, 'severity-critical')).toBe(true);
  });

  it('consumes the stash once', async () => {
    const agent = request.agent(createApp());
    await agent.post(`${MOUNT}/incidents`).type('form')
      .send({ _csrf: 'test-csrf-token', title: 'X', description: REPORT });
    await agent.get(`${MOUNT}/incidents?status=incident-failed&tab=incidents`);
    const second = await agent.get(`${MOUNT}/incidents`);
    expect(textareaValue(second.text, 'description')).toBe('');
    // Back to the hardcoded default when there is nothing stashed.
    expect(isChecked(second.text, 'severity-low')).toBe(true);
  });
});

describe('safeguarding training record keeps every typed field', () => {
  it('refills the record, including both date triples, after a failure', async () => {
    const agent = request.agent(createApp());
    const post = await agent
      .post(`${MOUNT}/training`)
      .type('form')
      .send({
        _csrf: 'test-csrf-token',
        training_type: 'children_first',
        training_name: '',
        provider: 'West Cork Development Partnership',
        'completed_at-day': '4',
        'completed_at-month': '3',
        'completed_at-year': '2026',
        'expires_at-day': '4',
        'expires_at-month': '3',
        'expires_at-year': '2029'
      });
    expect(post.headers.location).toContain('status=training-name-required');

    const page = await agent.get(`${MOUNT}/training?status=training-name-required&tab=training`);
    expect(page.status).toBe(200);
    expect(valueOf(page.text, 'provider')).toBe('West Cork Development Partnership');
    expect(valueOf(page.text, 'completed_at-day')).toBe('4');
    expect(valueOf(page.text, 'completed_at-year')).toBe('2026');
    expect(valueOf(page.text, 'expires_at-year')).toBe('2029');
    expect(isSelected(page.text, 'children_first')).toBe(true);
  });

  // 🔴 A separate data-loss bug found while fixing the replay: the handler read
  // `req.body.expires_at`, which the GOV.UK three-field date pattern never posts, so a
  // typed expiry was silently sent as null and every record was saved as never expiring.
  it('sends the typed expiry date to the API instead of null', async () => {
    api.callVolunteeringApi.mockImplementation(async (token, method) => {
      if (method === 'GET') return { data: { items: [] } };
      return { data: { id: 1 } };
    });

    const agent = request.agent(createApp());
    await agent
      .post(`${MOUNT}/training`)
      .type('form')
      .send({
        _csrf: 'test-csrf-token',
        training_type: 'children_first',
        training_name: 'Child protection level 1',
        'completed_at-day': '4',
        'completed_at-month': '3',
        'completed_at-year': '2026',
        'expires_at-day': '4',
        'expires_at-month': '3',
        'expires_at-year': '2029'
      });

    const write = api.callVolunteeringApi.mock.calls.find(([, method]) => method === 'POST');
    expect(write).toBeDefined();
    expect(write[3]).toMatchObject({
      completed_at: '2026-03-04',
      expires_at: '2029-03-04'
    });
  });

  it('consumes the stash once', async () => {
    const agent = request.agent(createApp());
    await agent.post(`${MOUNT}/training`).type('form')
      .send({ _csrf: 'test-csrf-token', training_type: 'safeguarding_children', training_name: '', provider: 'Kept' });
    await agent.get(`${MOUNT}/training?status=training-name-required&tab=training`);
    const second = await agent.get(`${MOUNT}/training`);
    expect(valueOf(second.text, 'provider')).toBe('');
  });
});
