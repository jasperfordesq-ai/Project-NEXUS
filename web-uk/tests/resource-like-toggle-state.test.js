// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The resource library's Like button is a TOGGLE, so it must say which state it is in.
 *
 * Before this was fixed the button carried no `aria-pressed` and no
 * `nexus-alpha-reaction--active`, and its accessible name read "Like <title>" whether or
 * not the member had already liked the resource — identical by eye and identical to a
 * screen reader. resources/comments.njk already did this correctly; the library rows
 * simply never received the viewer's own reaction.
 */

const path = require('path');
const express = require('express');
const nunjucks = require('nunjucks');
const request = require('supertest');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');
const { registerTemplateFilters } = require('../src/lib/template-filters');

jest.mock('../src/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(message, status, data) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  },
  ApiOfflineError: class ApiOfflineError extends Error {},
  getResources: jest.fn(),
  getResourceCategories: jest.fn(),
  getResourceCategoryTree: jest.fn(),
  getReactionSummary: jest.fn(),
  getComments: jest.fn(),
  uploadResource: jest.fn(),
  downloadResource: jest.fn(),
  deleteResource: jest.fn(),
  reorderResources: jest.fn(),
  createComment: jest.fn(),
  deleteComment: jest.fn(),
  toggleReaction: jest.fn(),
  getProfile: jest.fn(),
  invalidateUserCache: jest.fn()
}));

const api = require('../src/lib/api');
const resourceRoutes = require('../src/routes/resources');

const PREFIX = '/acme/accessible';
const MOUNT = `${PREFIX}/resources`;

function createApp() {
  const app = express();
  const views = path.join(__dirname, '..', 'src', 'views');
  const env = nunjucks.configure(
    [views, path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
    { autoescape: true, express: app, watch: false }
  );
  registerTemplateFilters(env);
  env.addFilter('formatDate', (value) => String(value || ''));
  env.addFilter('nl2br', (value) => String(value || ''));
  env.addFilter('string', String);

  app.set('view engine', 'njk');
  app.set('views', views);
  app.use(express.urlencoded({ extended: true }));

  app.use(MOUNT, (req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.token = 'test-token';
    req.accessibleRouting = {
      mode: 'shared',
      tenantSlug: 'acme',
      tenant: { id: 2, slug: 'acme', name: 'Acme Timebank' },
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
      currentPath: `${MOUNT}/library`,
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
  }, resourceRoutes);

  return app;
}

/** The like <button> markup for one resource card, isolated by its form action. */
function likeButtonFor(html, resourceId) {
  const form = new RegExp(
    `<form[^>]*action="[^"]*/resources/${resourceId}/react"[\\s\\S]*?</form>`
  ).exec(html);
  if (!form) return null;
  const button = /<button[\s\S]*?>/.exec(form[0]);
  return button ? button[0] : null;
}

beforeEach(() => {
  api.getProfile.mockReset();
  api.getResources.mockReset();
  api.getResourceCategories.mockReset();
  api.getResourceCategoryTree.mockReset();
  api.getReactionSummary.mockReset();

  api.getProfile.mockResolvedValue({ data: { id: 7, name: 'Test Member' } });
  api.getResourceCategories.mockResolvedValue({ data: [] });
  api.getResourceCategoryTree.mockResolvedValue({ data: [] });
  api.getResources.mockResolvedValue({
    data: [
      { id: 11, title: 'Repair cafe guide', file_path: 'guide.pdf', created_at: '2026-08-01T09:00:00Z' },
      { id: 12, title: 'Tool library rules', file_path: 'rules.pdf', created_at: '2026-08-02T09:00:00Z' }
    ],
    meta: { has_more: false }
  });
});

describe('resource library like button carries its own state', () => {
  it('marks a resource the viewer HAS liked as pressed and active', async () => {
    api.getReactionSummary.mockImplementation(async (token, type, id) => (
      Number(id) === 11
        ? { data: { counts: { like: 3 }, total: 3, user_reaction: 'like' } }
        : { data: { counts: {}, total: 0, user_reaction: null } }
    ));

    const page = await request(createApp()).get(`${MOUNT}/library`);
    expect(page.status).toBe(200);

    const liked = likeButtonFor(page.text, 11);
    expect(liked).toContain('aria-pressed="true"');
    expect(liked).toContain('nexus-alpha-reaction--active');
  });

  it('marks a resource the viewer has NOT liked as not pressed and not active', async () => {
    api.getReactionSummary.mockResolvedValue({
      data: { counts: {}, total: 0, user_reaction: null }
    });

    const page = await request(createApp()).get(`${MOUNT}/library`);
    expect(page.status).toBe(200);

    const notLiked = likeButtonFor(page.text, 11);
    expect(notLiked).toContain('aria-pressed="false"');
    expect(notLiked).not.toContain('nexus-alpha-reaction--active');
  });

  it('distinguishes two cards on the same page', async () => {
    api.getReactionSummary.mockImplementation(async (token, type, id) => (
      Number(id) === 12
        ? { data: { counts: { like: 1 }, total: 1, user_reaction: 'like' } }
        : { data: { counts: {}, total: 0, user_reaction: null } }
    ));

    const page = await request(createApp()).get(`${MOUNT}/library`);

    expect(likeButtonFor(page.text, 11)).toContain('aria-pressed="false"');
    expect(likeButtonFor(page.text, 12)).toContain('aria-pressed="true"');
    expect(likeButtonFor(page.text, 11)).not.toContain('nexus-alpha-reaction--active');
    expect(likeButtonFor(page.text, 12)).toContain('nexus-alpha-reaction--active');
  });

  it('shows a different reaction type as NOT pressed on the Like button', async () => {
    api.getReactionSummary.mockResolvedValue({
      data: { counts: { love: 2 }, total: 2, user_reaction: 'love' }
    });

    const page = await request(createApp()).get(`${MOUNT}/library`);
    expect(likeButtonFor(page.text, 11)).toContain('aria-pressed="false"');
  });

  it('still renders the library when a reaction lookup fails', async () => {
    api.getReactionSummary.mockRejectedValue(new api.ApiError('reactions unavailable', 500, {}));

    const page = await request(createApp()).get(`${MOUNT}/library`);
    expect(page.status).toBe(200);
    expect(likeButtonFor(page.text, 11)).toContain('aria-pressed="false"');
  });

  it('asks for the viewer reaction once per visible resource', async () => {
    api.getReactionSummary.mockResolvedValue({
      data: { counts: {}, total: 0, user_reaction: null }
    });

    await request(createApp()).get(`${MOUNT}/library`);

    expect(api.getReactionSummary).toHaveBeenCalledTimes(2);
    expect(api.getReactionSummary).toHaveBeenCalledWith('test-token', 'resource', 11);
    expect(api.getReactionSummary).toHaveBeenCalledWith('test-token', 'resource', 12);
  });
});
