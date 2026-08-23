// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * An error summary must link to the field that is actually wrong.
 *
 * These forms each built their summary with ONE hardcoded href and rendered no field-level
 * error at all, so a member who left the price blank was told "Enter a price" under a link
 * that jumped to the Title box, with nothing on the page marking Price. GDS requires both
 * halves: a summary link per error, in page order, and the field itself marked with
 * `govuk-form-group--error` plus a `govuk-error-message` carrying the visually-hidden
 * "Error:" prefix and wired in through `aria-describedby`.
 *
 * Each test submits with exactly ONE field wrong and asserts the link targets THAT field
 * and only that field's group is marked — so a fix that marks everything, or links
 * everything to the first field, still fails.
 *
 * A page-level failure (the API refused the save) is asserted to be a plain sentence in
 * the summary body rather than a link-less `<li>`: a summary LIST is a list of links to
 * things to fix, and a link-less item is a dead end for a keyboard user.
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
    callMarketplaceApi: jest.fn(),
    getProfile: jest.fn(),
    invalidateUserCache: jest.fn()
  };
});

const api = require('../src/lib/api');
const marketplaceRoutes = require('../src/routes/marketplace');
const marketplaceActionRoutes = require('../src/routes/marketplace-actions');

const PREFIX = '/acme/accessible';
const MOUNT = `${PREFIX}/marketplace`;
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
    secret: 'form-field-error-test-secret',
    resave: false,
    saveUninitialized: false,
    name: 'form-field-error-test.sid'
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
  }, marketplaceActionRoutes, marketplaceRoutes);

  return app;
}

/** The whole `<div class="govuk-error-summary">…</div>` block. */
function summaryOf(html) {
  const match = /<div class="govuk-error-summary"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/.exec(html);
  return match ? match[0] : '';
}

/** Every href in the summary's link list, in order. */
function summaryLinks(html) {
  return [...summaryOf(html).matchAll(/<li><a href="([^"]+)"/g)].map((m) => m[1]);
}

/**
 * Does the form group that CONTAINS this control carry the error class?
 *
 * 🔴 Anchored on `id="<id>" name=`, then scanned BACKWARDS to the nearest opening
 * form-group div. A forward scan gets this wrong: `id="description"` also matches inside
 * `id="description-hint"`, and the nearest preceding form-group div then belongs to the
 * field above — which made this helper report a correct fix as broken.
 */
function groupHasError(html, id) {
  const control = new RegExp(`id="${id}" name=`).exec(html);
  if (!control) return false;
  const before = html.slice(0, control.index);
  const groups = [...before.matchAll(/<div class="govuk-form-group([^"]*)"/g)];
  if (groups.length === 0) return false;
  return groups[groups.length - 1][1].includes('govuk-form-group--error');
}

function hasFieldErrorMessage(html, id) {
  return new RegExp(`id="${id}-error" class="govuk-error-message"`).test(html);
}

function describedByIncludesError(html, id) {
  const match = new RegExp(`id="${id}"[^>]*aria-describedby="([^"]*)"`).exec(html);
  return match ? match[1].split(/\s+/).includes(`${id}-error`) : false;
}

const ERROR_PREFIX = createTranslator('en')('states.error_prefix');

beforeEach(() => {
  api.callMarketplaceApi.mockReset();
  api.getProfile.mockReset();
  api.getProfile.mockResolvedValue({ data: { id: 7, name: 'Test Seller' } });
  api.callMarketplaceApi.mockImplementation(async (token, method, apiPath) => {
    if (method === 'GET' && apiPath.startsWith('/categories')) return { data: [] };
    if (method === 'GET' && /^\/listings\/\d+/.test(apiPath)) {
      return { data: { id: 55, title: 'Saved title', description: 'Saved description' } };
    }
    if (method === 'GET') return { data: [] };
    throw new api.ApiError('marketplace unavailable', 500, {});
  });
});

// --------------------------------------------------------------------------------------
// marketplace/form.njk — title / description / price
// --------------------------------------------------------------------------------------

describe('marketplace listing form points each error at its own field', () => {
  const VALID = {
    _csrf: 'test-csrf-token',
    title: 'Garden shears',
    description: 'Sharp and clean, barely used.',
    price_type: 'fixed',
    price: '12',
    price_currency: 'EUR',
    quantity: '1'
  };

  async function submitCreate(overrides) {
    const agent = request.agent(createApp());
    await agent.post(`${MOUNT}/create`).type('form').send({ ...VALID, ...overrides });
    return agent.get(`${MOUNT}/create`);
  }

  it('links a missing TITLE to #title and marks only that field', async () => {
    const page = await submitCreate({ title: '' });
    expect(page.status).toBe(200);
    expect(summaryLinks(page.text)).toEqual(['#title']);
    expect(groupHasError(page.text, 'title')).toBe(true);
    expect(groupHasError(page.text, 'description')).toBe(false);
    expect(groupHasError(page.text, 'price')).toBe(false);
    expect(hasFieldErrorMessage(page.text, 'title')).toBe(true);
    expect(describedByIncludesError(page.text, 'title')).toBe(true);
  });

  it('links a missing DESCRIPTION to #description and marks only that field', async () => {
    const page = await submitCreate({ description: '' });
    expect(summaryLinks(page.text)).toEqual(['#description']);
    expect(groupHasError(page.text, 'description')).toBe(true);
    expect(groupHasError(page.text, 'title')).toBe(false);
    expect(hasFieldErrorMessage(page.text, 'description')).toBe(true);
    expect(describedByIncludesError(page.text, 'description')).toBe(true);
  });

  it('links a missing PRICE to #price and marks only that field', async () => {
    const page = await submitCreate({ price: '', time_credit_price: '' });
    expect(summaryLinks(page.text)).toEqual(['#price']);
    expect(groupHasError(page.text, 'price')).toBe(true);
    expect(groupHasError(page.text, 'title')).toBe(false);
    expect(groupHasError(page.text, 'description')).toBe(false);
    expect(hasFieldErrorMessage(page.text, 'price')).toBe(true);
    expect(describedByIncludesError(page.text, 'price')).toBe(true);
  });

  it('lists several errors in page order, each linked to its own field', async () => {
    const page = await submitCreate({ title: '', description: '', price: '', time_credit_price: '' });
    expect(summaryLinks(page.text)).toEqual(['#title', '#description', '#price']);
  });

  it('carries the visually-hidden Error: prefix on the field message', async () => {
    const page = await submitCreate({ title: '' });
    expect(page.text).toContain(`<span class="govuk-visually-hidden">${ERROR_PREFIX}</span>`);
  });

  it('renders a whole-page save failure as a sentence, not a link-less list item', async () => {
    const agent = request.agent(createApp());
    // Every field is valid, so the failure can only come from the API refusing the save.
    await agent.post(`${MOUNT}/create`).type('form').send(VALID);
    const page = await agent.get(`${MOUNT}/create`);

    expect(page.status).toBe(200);
    const summary = summaryOf(page.text);
    expect(summary).not.toBe('');
    expect(summaryLinks(page.text)).toEqual([]);
    // No list item at all, linked or otherwise — the message is a paragraph.
    expect(summary).not.toContain('<li>');
    expect(summary).toContain('<p class="govuk-body">');
  });

  it('shows no error summary on a clean visit', async () => {
    const page = await request(createApp()).get(`${MOUNT}/create`);
    expect(page.status).toBe(200);
    expect(summaryOf(page.text)).toBe('');
    expect(groupHasError(page.text, 'title')).toBe(false);
  });
});

// --------------------------------------------------------------------------------------
// marketplace/coupon-form.njk — title / discount value / expiry date
// --------------------------------------------------------------------------------------

describe('coupon form points each error at its own field', () => {
  const VALID = {
    _csrf: 'test-csrf-token',
    title: 'Ten percent off',
    discount_type: 'percent',
    discount_value: '10',
    status: 'draft'
  };

  async function submitCreate(overrides) {
    const agent = request.agent(createApp());
    await agent.post(`${MOUNT}/coupons/new`).type('form').send({ ...VALID, ...overrides });
    return agent.get(`${MOUNT}/coupons/new`);
  }

  it('links a missing TITLE to #coupon_title and marks only that field', async () => {
    const page = await submitCreate({ title: '' });
    expect(page.status).toBe(200);
    expect(summaryLinks(page.text)).toEqual(['#coupon_title']);
    expect(groupHasError(page.text, 'coupon_title')).toBe(true);
    expect(groupHasError(page.text, 'discount_value')).toBe(false);
    expect(hasFieldErrorMessage(page.text, 'coupon_title')).toBe(true);
    expect(describedByIncludesError(page.text, 'coupon_title')).toBe(true);
  });

  // The #discount_value field existed all along and was never linked from the summary.
  it('links a bad DISCOUNT VALUE to #discount_value and marks only that field', async () => {
    const page = await submitCreate({ discount_value: '' });
    expect(summaryLinks(page.text)).toEqual(['#discount_value']);
    expect(groupHasError(page.text, 'discount_value')).toBe(true);
    expect(groupHasError(page.text, 'coupon_title')).toBe(false);
    expect(hasFieldErrorMessage(page.text, 'discount_value')).toBe(true);
    expect(describedByIncludesError(page.text, 'discount_value')).toBe(true);
  });

  // An unreal expiry has a real GOV.UK date-input target; it used to point at the title.
  it('links an unreal EXPIRY DATE to the date input, not the title', async () => {
    const page = await submitCreate({
      'valid_until-day': '31',
      'valid_until-month': '2',
      'valid_until-year': '2027'
    });
    expect(summaryLinks(page.text)).toEqual(['#valid_until-day']);
    expect(groupHasError(page.text, 'coupon_title')).toBe(false);
    expect(groupHasError(page.text, 'discount_value')).toBe(false);
  });

  it('renders a whole-page save failure as a sentence, not a link-less list item', async () => {
    const agent = request.agent(createApp());
    await agent.post(`${MOUNT}/coupons/new`).type('form').send(VALID);
    const page = await agent.get(`${MOUNT}/coupons/new`);

    const summary = summaryOf(page.text);
    expect(summary).not.toBe('');
    expect(summaryLinks(page.text)).toEqual([]);
    expect(summary).not.toContain('<li>');
    expect(summary).toContain('<p class="govuk-body">');
  });

  it('shows no error summary on a clean visit', async () => {
    const page = await request(createApp()).get(`${MOUNT}/coupons/new`);
    expect(page.status).toBe(200);
    expect(summaryOf(page.text)).toBe('');
  });
});
