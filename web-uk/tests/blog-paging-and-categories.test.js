// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * GET /api/v2/blog answers with respondWithCollection: `data` is a plain list of
 * posts and the paging (`has_more`, `cursor`) is in `meta`. The blog list read
 * paging and categories out of `data`, so "load more" never appeared (the list
 * stopped at 12) and the category filter never rendered. Categories come from
 * GET /api/v2/blog/categories, as React BlogPage does.
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
  return new Proxy({
    ApiError,
    ApiOfflineError: class ApiOfflineError extends Error {},
    getBlogPosts: jest.fn(),
    getBlogCategories: jest.fn(),
  }, {
    get: (target, prop) => (prop in target ? target[prop] : jest.fn().mockResolvedValue({ data: [] })),
  });
});

const api = require('../src/lib/api');
const blogRoutes = require('../src/routes/blog-posts');

function mount() {
  const app = express();
  const environment = nunjucks.configure(
    [path.join(__dirname, '..', 'src', 'views'),
      path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
    { autoescape: true, noCache: true, express: app }
  );
  require('../src/lib/template-filters').registerTemplateFilters(environment);
  app.set('view engine', 'njk');
  app.use((req, res, next) => {
    req.signedCookies = {};
    res.locals.urlFor = (v) => String(v || '/');
    Object.assign(res.locals, {
      serviceName: 'Project NEXUS', tenantName: 'Test', isAuthenticated: false, csrfToken: 'csrf',
      t: createTranslator('en'), tc: createChoiceTranslator('en'),
      htmlLang: 'en', htmlDirection: 'ltr', locale: 'en',
      formatLocaleDate: () => '20 September 2026',
    });
    next();
  });
  app.use('/blog', blogRoutes);
  return app;
}

const app = mount();
const POSTS = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, slug: `post-${i + 1}`, title: `Post ${i + 1}` }));

beforeEach(() => {
  jest.clearAllMocks();
  api.getBlogPosts.mockResolvedValue({ data: POSTS, meta: { per_page: 12, has_more: true, cursor: 'abc123' } });
  api.getBlogCategories.mockResolvedValue({ data: [{ id: 7, name: 'Community news', slug: 'news', post_count: 3 }] });
});

describe('blog list paging and categories', () => {
  it('offers "load more" from the cursor in meta', async () => {
    const res = await request(app).get('/blog');
    expect(res.status).toBe(200);
    expect(res.text).toContain('cursor=abc123');
  });

  it('keeps the category filter on the next-page link', async () => {
    const res = await request(app).get('/blog?category=7');
    expect(api.getBlogPosts).toHaveBeenCalledWith('', expect.objectContaining({ category_id: 7 }));
    expect(res.text).toMatch(/category=7&amp;cursor=abc123|category=7&cursor=abc123/);
  });

  it('shows no "load more" when meta says there is nothing more', async () => {
    api.getBlogPosts.mockResolvedValue({ data: POSTS, meta: { per_page: 12, has_more: false } });
    const res = await request(app).get('/blog');
    expect(res.text).not.toContain('cursor=');
  });

  it('renders the category filter from GET /v2/blog/categories', async () => {
    const res = await request(app).get('/blog');
    expect(api.getBlogCategories).toHaveBeenCalled();
    expect(res.text).toContain('<option value="7"');
    expect(res.text).toContain('Community news');
  });

  it('still renders the list when the categories read fails', async () => {
    api.getBlogCategories.mockRejectedValue(new api.ApiError('boom', 500));
    const res = await request(app).get('/blog');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Post 1');
    expect(res.text).not.toContain('<select class="govuk-select" id="category"');
  });

  it('the RSS feed lists the posts from the plain data list', async () => {
    const res = await request(app).get('/blog/feed.xml');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<title>Post 1</title>');
  });
});
