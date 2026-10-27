// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Saved items showed the first 50 bookmarks and nothing else (until 27 Oct 2026).
 * GET /v2/bookmarks is page-numbered (meta.current_page / total_pages), so the page
 * now follows it with Previous / Next links that keep the type filter.
 */

const path = require('path');
const express = require('express');
const nunjucks = require('nunjucks');
const request = require('supertest');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');
const { registerTemplateFilters } = require('../src/lib/template-filters');

jest.mock('../src/lib/api', () => {
  class ApiError extends Error {
    constructor(message, status, data = {}) {
      super(message);
      this.status = status;
      this.data = data;
    }
  }
  return {
    ApiError,
    ApiOfflineError: class ApiOfflineError extends Error {},
    getProfile: jest.fn(),
    getUserV2: jest.fn(),
    getBookmarks: jest.fn(),
    getUserPublicCollections: jest.fn(),
    getUserAppreciations: jest.fn(),
    toggleBookmark: jest.fn(),
    sendAppreciation: jest.fn(),
    reactToAppreciation: jest.fn()
  };
});

const api = require('../src/lib/api');
const savedSocialRoutes = require('../src/routes/saved-social');

const VIEWS = path.join(__dirname, '..', 'src', 'views');
const GOVUK = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');
const t = createTranslator('en');

function createApp() {
  const app = express();
  const env = nunjucks.configure([VIEWS, GOVUK], { autoescape: true, express: app, watch: false });
  registerTemplateFilters(env);
  env.addFilter('formatDate', (value) => String(value || ''));
  app.set('view engine', 'njk');
  app.set('views', VIEWS);
  app.use((req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    Object.assign(res.locals, {
      urlFor: (value) => value,
      serviceName: 'Project NEXUS',
      tenantName: 'Acme Timebank',
      isAuthenticated: true,
      csrfToken: 'test-csrf-token',
      alphaNavItems: [],
      feedbackUrl: '/feedback',
      currentPath: req.path,
      alphaLocaleOptions: [],
      alphaLanguageQueryParams: [],
      htmlLang: 'en',
      htmlDirection: 'ltr',
      t,
      tc: createChoiceTranslator('en'),
      formatLocaleNumber: (value) => String(value ?? ''),
      formatLocaleDate: (value) => String(value ?? '')
    });
    next();
  });
  app.use('/', savedSocialRoutes);
  return app;
}

const BOOKMARK = { id: 1, bookmarkable_type: 'listing', bookmarkable_id: 9, item: { id: 9, title: 'Gardening help' } };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('saved items paging', () => {
  it('asks for the requested page and offers previous and next pages from the API meta', async () => {
    api.getBookmarks.mockResolvedValue({
      data: [BOOKMARK],
      meta: { current_page: 2, per_page: 50, total: 160, total_pages: 4, has_more: true }
    });
    const res = await request(createApp()).get('/saved?type=listing&page=2');
    expect(res.status).toBe(200);
    expect(api.getBookmarks).toHaveBeenCalledWith('test-token', { type: 'listing', page: 2, per_page: 50 });
    expect(res.text).toContain('href="/saved?type=listing&amp;page=1"');
    expect(res.text).toContain('href="/saved?type=listing&amp;page=3"');
    expect(res.text).toContain(t('govuk_alpha_saved.pagination.page_of', { current: 2, last: 4 }));
  });

  it('shows no paging when everything fits on one page', async () => {
    api.getBookmarks.mockResolvedValue({
      data: [BOOKMARK],
      meta: { current_page: 1, per_page: 50, total: 1, total_pages: 1, has_more: false }
    });
    const res = await request(createApp()).get('/saved');
    expect(api.getBookmarks).toHaveBeenCalledWith('test-token', { type: '', page: 1, per_page: 50 });
    expect(res.text).not.toContain('govuk-pagination');
  });

  it('ignores a nonsense page number', async () => {
    api.getBookmarks.mockResolvedValue({ data: [], meta: { current_page: 1, total_pages: 0 } });
    await request(createApp()).get('/saved?page=-4');
    expect(api.getBookmarks).toHaveBeenCalledWith('test-token', { type: '', page: 1, per_page: 50 });
  });
});
