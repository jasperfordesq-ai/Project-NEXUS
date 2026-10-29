// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Timebank listing form parity with React's ListingForm (27 Oct 2026).
 *
 * - "Hours available": the total hours the member is willing to give. Blank means no
 *   limit, which the API stores as NULL (React sends null, never ''). The API refuses a
 *   cap under 0.5 or below the hours one exchange takes (ListingService rules).
 * - Removing the photo without replacing it: React calls DELETE /v2/listings/{id}/image.
 *   The accessible form could only upload or replace a photo.
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
      this.name = 'ApiError';
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

const flashSpy = jest.fn(() => []);

function createApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.token = 'test-token';
    req.session = {};
    req.flash = flashSpy;
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

describe('hours available', () => {
  it('sends the cap when given', async () => {
    const response = await request(createApp()).post('/listings/new').type('form').send({ ...BASE, hours_available: '20' });
    expect(response.headers.location).toBe('/listings/5?status=listing-created');
    expect(api.createListing).toHaveBeenCalledWith('test-token', expect.objectContaining({ hours_available: 20 }));
  });

  it('sends null (no limit) when left blank, never an empty string', async () => {
    await request(createApp()).post('/listings/new').type('form').send({ ...BASE, hours_available: '' });
    expect(api.createListing.mock.calls[0][1].hours_available).toBeNull();
  });

  it('does not touch the cap when the post did not include the field', async () => {
    await request(createApp()).post('/listings/5/edit').type('form').send({ ...BASE });
    expect(api.updateListing.mock.calls[0][2]).not.toHaveProperty('hours_available');
  });

  it('refuses a cap under half an hour, as React and the API do', async () => {
    const response = await request(createApp()).post('/listings/new').type('form').send({ ...BASE, hours_available: '0.2' });
    expect(api.createListing).not.toHaveBeenCalled();
    expect(response.body.locals.fieldErrors.hours_available).toBe(t('govuk_alpha_listings.create.hours_available_range'));
  });

  it('refuses a cap below the hours one exchange takes', async () => {
    const response = await request(createApp()).post('/listings/new').type('form').send({ ...BASE, hours_estimate: '3', hours_available: '2' });
    expect(api.createListing).not.toHaveBeenCalled();
    expect(response.body.locals.fieldErrors.hours_available).toBe(t('govuk_alpha_listings.create.hours_available_below_estimate'));
    const html = renderForm(response.body.locals);
    expect(html).toContain('id="hours_available"');
    expect(html).toContain('value="2"');
    expect(html).toContain(t('govuk_alpha_listings.create.hours_available_below_estimate'));
  });

  it('shows the stored cap on the edit form', () => {
    const html = renderForm({
      title: 'Edit', listing: { id: 5, title: 'x', hours_available: 12 }, values: null, fieldErrors: {},
      config: {}, categories: []
    });
    expect(html).toContain(t('govuk_alpha_listings.create.hours_available_label'));
    expect(html).toContain('name="hours_available"');
    expect(html).toContain('value="12"');
  });
});

describe('removing the listing photo', () => {
  it('offers "remove the photo" only when the listing has one', () => {
    const withImage = renderForm({ title: 'Edit', listing: { id: 5 }, listingImageUrl: '/img.jpg', values: null, fieldErrors: {}, config: {}, categories: [] });
    expect(withImage).toContain('name="remove_image"');
    expect(withImage).toContain(t('govuk_alpha_listings.create.remove_image_label'));
    const without = renderForm({ title: 'Edit', listing: { id: 5 }, listingImageUrl: '', values: null, fieldErrors: {}, config: {}, categories: [] });
    expect(without).not.toContain('name="remove_image"');
  });

  it('removes the photo when ticked and no new photo is chosen', async () => {
    const response = await request(createApp()).post('/listings/5/edit').type('form').send({ ...BASE, remove_image: '1' });
    expect(response.headers.location).toBe('/listings/5?status=listing-updated');
    expect(api.deleteListingImage).toHaveBeenCalledWith('test-token', 5);
  });

  it('leaves the photo alone when the box is not ticked', async () => {
    await request(createApp()).post('/listings/5/edit').type('form').send({ ...BASE });
    expect(api.deleteListingImage).not.toHaveBeenCalled();
  });

  it('reports a failed removal instead of claiming it worked', async () => {
    api.deleteListingImage.mockRejectedValue(new api.ApiError('nope', 500));
    const response = await request(createApp()).post('/listings/5/edit').type('form').send({ ...BASE, remove_image: '1' });
    expect(response.headers.location).toBe('/listings/5?status=listing-updated');
    expect(flashSpy).toHaveBeenCalledWith('error', t('govuk_alpha_listings.form_messages.updated_photo_remove_failed'));
  });
});

// React ListingForm "Optional service details" (W5, 29 Oct 2026): experience,
// equipment and accessibility notes are appended to the description as
// "Label: value" lines after "---", exactly as React's doSubmit builds them.
describe('optional service details', () => {
  it('offers the three optional fields inside a details section', () => {
    const html = renderForm({ title: 'New', listing: null, values: null, fieldErrors: {}, config: {}, categories: [] });
    expect(html).toContain(t('govuk_alpha_listings.service_details.toggle'));
    expect(html).toContain('name="experience_level"');
    expect(html).toContain('name="equipment_provided"');
    expect(html).toContain('name="accessibility_notes"');
  });

  it('appends the chosen details to the description', async () => {
    await request(createApp()).post('/listings/new').type('form').send({
      ...BASE, experience_level: 'beginner_friendly', equipment_provided: 'bring_own', accessibility_notes: 'Step-free access'
    });
    expect(api.createListing.mock.calls[0][1].description).toBe(
      `${BASE.description}\n\n---\nExperience: Beginner-friendly\nEquipment: You'll need to provide your own\nAccessibility Notes: Step-free access`
    );
  });

  it('leaves the description alone when nothing is chosen, and ignores unknown values', async () => {
    await request(createApp()).post('/listings/new').type('form').send({ ...BASE, experience_level: 'wizard' });
    expect(api.createListing.mock.calls[0][1].description).toBe(BASE.description);
  });

  it('refuses accessibility notes over 200 characters', async () => {
    const response = await request(createApp()).post('/listings/new').type('form').send({ ...BASE, accessibility_notes: 'a'.repeat(201) });
    expect(api.createListing).not.toHaveBeenCalled();
    expect(response.body.locals.fieldErrors.accessibility_notes).toBe(t('govuk_alpha_listings.service_details.accessibility_max_length'));
  });
});
