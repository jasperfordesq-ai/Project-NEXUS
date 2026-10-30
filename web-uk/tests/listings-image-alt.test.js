// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Regression (AWID pilot, Oct 2026): a listing photo could not be described for
 * screen-reader users. The form offers a "describe this photo" field, sends it as
 * `image_alt` (null when blank or when the photo is removed), and the listing page
 * and list use it as the photo's alt text.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const nunjucks = require('nunjucks');
const request = require('supertest');

jest.mock('../src/lib/api', () => {
  class ApiError extends Error {
    constructor(message, status, data = {}) {
      super(message);
      this.status = status;
      this.data = data;
    }
  }
  return new Proxy({
    ApiError,
    ApiOfflineError: class ApiOfflineError extends Error {},
    createListing: jest.fn(),
    updateListing: jest.fn(),
    setListingSkillTags: jest.fn(),
    uploadListingImage: jest.fn(),
    deleteListingImage: jest.fn(),
    getListingCategories: jest.fn()
  }, {
    get(target, prop) {
      if (!(prop in target)) target[prop] = jest.fn();
      return target[prop];
    }
  });
});
jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, res, next) => next(),
  withTokenRefresh: (handler) => handler
}));
jest.mock('../src/lib/auditLogger', () => ({
  audit: new Proxy({}, { get: () => () => (req, res, next) => next() })
}));

const api = require('../src/lib/api');
const { createTranslator, createChoiceTranslator } = require('../src/lib/localization');
const listingsRouter = require('../src/routes/listings');

const t = createTranslator('en');
const viewsDir = path.join(__dirname, '..', 'src', 'views');
const env = nunjucks.configure(
  [viewsDir, path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
  { autoescape: true, noCache: true }
);

function createApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.token = 'test-token';
    req.session = {};
    req.flash = jest.fn(() => []);
    req.t = t;
    res.locals.t = t;
    res.locals.tc = createChoiceTranslator('en');
    res.locals.urlFor = (value) => value;
    res.render = (view, locals = {}) => res.json({ view, locals });
    next();
  });
  app.use('/listings', listingsRouter);
  return app;
}

function renderForm(locals) {
  const source = fs.readFileSync(path.join(viewsDir, 'listings/form.njk'), 'utf8');
  const imports = source.split('\n').filter((line) => line.startsWith('{% from')).join('\n');
  const start = source.indexOf('{% block mainContent %}') + '{% block mainContent %}'.length;
  const end = source.lastIndexOf('{% endblock %}');
  return env.renderString(`${imports}\n${source.slice(start, end)}`, {
    t, tc: createChoiceTranslator('en'), urlFor: (value) => value, csrfToken: 'x', ...locals
  });
}

const BASE = {
  title: 'Garden help on Saturdays',
  description: 'I can help with weeding and lawn mowing in the mornings.',
  type: 'offer',
  category_id: '3',
  hours_estimate: '2'
};

beforeEach(() => {
  jest.clearAllMocks();
  api.getListingCategories.mockResolvedValue({ data: [{ id: 3, name: 'Gardening' }] });
  api.createListing.mockResolvedValue({ data: { id: 5 } });
  api.updateListing.mockResolvedValue({ data: { id: 5 } });
  api.setListingSkillTags.mockResolvedValue({ data: {} });
  api.deleteListingImage.mockResolvedValue({ data: {} });
});

describe('listing photo description', () => {
  it('offers the description field with the stored value on the edit form', () => {
    const html = renderForm({
      title: 'Edit', listing: { id: 5, image_alt: 'A spade in a vegetable bed' }, listingImageUrl: '/img.jpg',
      values: null, fieldErrors: {}, config: {}, categories: []
    });
    expect(html).toContain('name="image_alt"');
    expect(html).toContain(t('govuk_alpha_listings.create.image_alt_label'));
    expect(html).toContain('value="A spade in a vegetable bed"');
  });

  it('sends the description on save', async () => {
    await request(createApp()).post('/listings/5/edit').type('form')
      .send({ ...BASE, image_alt: '  A spade in a vegetable bed ' });
    expect(api.updateListing.mock.calls[0][2].image_alt).toBe('A spade in a vegetable bed');
  });

  it('sends null when the description is left blank', async () => {
    await request(createApp()).post('/listings/new').type('form').send({ ...BASE, image_alt: '' });
    expect(api.createListing.mock.calls[0][1].image_alt).toBeNull();
  });

  it('does not touch the description when the post did not include the field', async () => {
    await request(createApp()).post('/listings/5/edit').type('form').send({ ...BASE });
    expect(api.updateListing.mock.calls[0][2]).not.toHaveProperty('image_alt');
  });

  it('uses the description as the photo alt text on the listing page', () => {
    const source = fs.readFileSync(path.join(viewsDir, 'listings/detail.njk'), 'utf8');
    expect(source).toMatch(/alt="\{\{ listing\.image_alt or t\('listings\.image_alt'/);
    const list = fs.readFileSync(path.join(viewsDir, 'listings/index.njk'), 'utf8');
    expect(list).toMatch(/alt="\{\{ listing\.image_alt or t\('listings\.image_alt'/);
  });
});
