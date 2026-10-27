// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Write a review of a volunteering organisation (React OrganisationDetailPage
 * posts POST /v2/volunteering/reviews { target_type: 'organization', target_id,
 * rating, comment }). Deep audit B, item V1.
 */
const express = require('express');
const request = require('supertest');
const nunjucks = require('nunjucks');
const path = require('node:path');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');

jest.mock('../src/lib/api', () => {
  class ApiError extends Error {
    constructor(message, status, data = {}) {
      super(message);
      this.status = status;
      this.data = data;
    }
  }
  return { ApiError, callVolunteeringApi: jest.fn() };
});

const api = require('../src/lib/api');
const { submitOrganisationReview, organisationReviewView } = require('../src/routes/organisation-reviews');

const t = createTranslator('en');
let flashStore = {};

function mount() {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => {
    req.signedCookies = { token: 'token:test' };
    req.flash = (key, value) => {
      if (value !== undefined) { flashStore[key] = [...(flashStore[key] || []), value]; return undefined; }
      const values = flashStore[key] || [];
      delete flashStore[key];
      return values;
    };
    res.locals.urlFor = (v) => String(v || '/');
    next();
  });
  app.post('/organisations/:id(\\d+)/reviews', submitOrganisationReview);
  app.get('/organisations/:id(\\d+)/review-state', (req, res) => res.json(organisationReviewView(req, res)));
  return app;
}

const app = mount();

function render(context) {
  const environment = new nunjucks.Environment(new nunjucks.FileSystemLoader([
    path.join(__dirname, '..', 'src', 'views'),
    path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')
  ]), { autoescape: true });
  require('../src/lib/template-filters').registerTemplateFilters(environment);
  environment.addFilter('nl2br', (value) => value);
  return environment.render('organisation-detail.njk', {
    serviceName: 'Project NEXUS', tenantName: 'Test', isAuthenticated: true, csrfToken: 'csrf',
    t, tc: createChoiceTranslator('en'), htmlLang: 'en', htmlDirection: 'ltr', urlFor: (v) => String(v || '/'),
    formatLocaleNumber: (v) => String(v),
    organisation: { id: 114, name: 'Garden Trust', description: '' },
    orgStats: { opportunityCount: 0, reviewCount: 0, averageRating: 0, averageRatingLabel: '0.0', totalHoursLabel: '0' },
    orgOpportunities: [],
    orgReviews: [],
    ...context
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  flashStore = {};
});

describe('posting a review', () => {
  it('sends the review to the API and confirms it', async () => {
    api.callVolunteeringApi.mockResolvedValue({ data: { id: 9 } });
    const res = await request(app).post('/organisations/114/reviews').type('form').send({ rating: '4', comment: ' Well run ' });
    expect(api.callVolunteeringApi).toHaveBeenCalledWith('token:test', 'POST', '/reviews', {
      target_type: 'organization', target_id: 114, rating: 4, comment: 'Well run'
    });
    expect(res.headers.location).toBe('/organisations/114?status=review-saved#reviews');
  });

  it('leaves out an empty comment', async () => {
    api.callVolunteeringApi.mockResolvedValue({ data: { id: 9 } });
    await request(app).post('/organisations/114/reviews').type('form').send({ rating: '5', comment: '' });
    expect(api.callVolunteeringApi.mock.calls[0][3]).toEqual({ target_type: 'organization', target_id: 114, rating: 5 });
  });

  it('asks for a rating before calling the API', async () => {
    const res = await request(app).post('/organisations/114/reviews').type('form').send({ rating: '0' });
    expect(api.callVolunteeringApi).not.toHaveBeenCalled();
    expect(res.headers.location).toBe('/organisations/114?status=review-rating-required#write-review');
  });

  it("keeps the API's reason when it refuses", async () => {
    api.callVolunteeringApi.mockRejectedValue(new api.ApiError('refused', 403, {
      errors: [{ code: 'FORBIDDEN', message: 'You can only review organisations you have volunteered with.' }]
    }));
    const res = await request(app).post('/organisations/114/reviews').type('form').send({ rating: '3' });
    expect(res.headers.location).toBe('/organisations/114?status=review-failed#write-review');
    const state = await request(app).get('/organisations/114/review-state?status=review-failed');
    expect(state.body.reviewErrorText).toBe('You can only review organisations you have volunteered with.');
  });

  it('sends a signed-out member to sign in', async () => {
    const signedOut = express();
    signedOut.use(express.urlencoded({ extended: true }));
    signedOut.use((req, res, next) => { req.signedCookies = {}; res.locals.urlFor = (v) => v; next(); });
    signedOut.post('/organisations/:id/reviews', submitOrganisationReview);
    const res = await request(signedOut).post('/organisations/114/reviews').type('form').send({ rating: '3' });
    expect(res.headers.location).toBe('/login?status=auth-required');
  });
});

describe('the organisation page', () => {
  it('shows the review form', () => {
    const html = render({ reviewForm: { status: '', errorText: '', successText: '' } });
    expect(html).toContain('action="/organisations/114/reviews"');
    expect(html).toContain(t('govuk_alpha_organisations.reviews.write_heading'));
    expect(html).toContain('name="rating"');
  });

  it('hides the form when reviews are switched off', () => {
    const html = render({ reviewForm: null });
    expect(html).not.toContain('/organisations/114/reviews');
  });

  it('confirms a submitted review', () => {
    const html = render({ reviewForm: { status: 'review-saved', successText: t('govuk_alpha_organisations.reviews.saved'), errorText: '' } });
    expect(html).toContain(t('govuk_alpha_organisations.reviews.saved'));
  });

  it('links the rating error to the rating field', () => {
    const html = render({ reviewForm: { status: 'review-rating-required', successText: '', errorText: t('govuk_alpha_organisations.reviews.rating_required') } });
    expect(html).toContain('href="#rating"');
    expect(html).toContain('govuk-form-group--error');
  });
});
