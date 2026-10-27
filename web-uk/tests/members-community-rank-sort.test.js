// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * "Community rank" sort in the members directory (27 Oct 2026).
 *
 * React's MembersPage offers a Community rank sort, and makes it the default, when the
 * community has CommunityRank switched on (`/v2/config/algorithms` reports the members
 * algorithm key `communityrank`); otherwise it is not offered and the directory sorts by
 * name. The accessible directory only ever offered name, joined, rating and hours given.
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
    getUsers: jest.fn(),
    getAlgorithmInfo: jest.fn(),
    getMemberConnectionStatus: jest.fn()
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

const api = require('../src/lib/api');
const { createTranslator, createChoiceTranslator } = require('../src/lib/localization');
const membersRouter = require('../src/routes/members');

const t = createTranslator('en');
const viewsDir = path.join(__dirname, '..', 'src', 'views');
const env = nunjucks.configure(
  [viewsDir, path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
  { autoescape: true, noCache: true }
);

function createApp() {
  const app = express();
  app.use((req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.token = 'test-token';
    req.flash = () => [];
    req.t = t;
    res.locals.t = t;
    res.locals.tc = createChoiceTranslator('en');
    res.locals.urlFor = (value) => value;
    res.render = (view, locals = {}) => res.json({ view, locals });
    next();
  });
  app.use('/members', membersRouter);
  return app;
}

function renderDirectory(locals) {
  const source = fs.readFileSync(path.join(viewsDir, 'members/index.njk'), 'utf8');
  const imports = source.split('\n').filter((line) => line.startsWith('{% from')).join('\n');
  const start = source.indexOf('{% block mainContent %}') + '{% block mainContent %}'.length;
  const end = source.indexOf('{% endblock %}', start);
  return env.renderString(`${imports}\n${source.slice(start, end)}`, {
    t, tc: createChoiceTranslator('en'), urlFor: (value) => value, ...locals
  });
}

function algorithms(membersKey) {
  api.getAlgorithmInfo.mockResolvedValue({ data: { members: { key: membersKey, name: 'x' } } });
}

beforeEach(() => {
  jest.clearAllMocks();
  api.getUsers.mockResolvedValue({ data: [], meta: { total_items: 0, per_page: 20, offset: 0, has_more: false } });
});

describe('members directory community rank sort', () => {
  it('defaults to community rank, and offers it, when the community has CommunityRank on', async () => {
    algorithms('communityrank');
    const response = await request(createApp()).get('/members');

    expect(api.getAlgorithmInfo).toHaveBeenCalledWith('test-token');
    expect(api.getUsers).toHaveBeenCalledWith('test-token', expect.objectContaining({ sort: 'communityrank' }));
    expect(response.body.locals.sort).toBe('communityrank');
    expect(response.body.locals.sortOptions).toEqual(['communityrank', 'name', 'joined', 'rating', 'hours_given']);
    expect(response.body.locals.hasFilters).toBe(false);

    const html = renderDirectory(response.body.locals);
    expect(html).toContain('<option value="communityrank" selected>');
    expect(html).toContain(t('govuk_alpha_members.sort_communityrank'));
  });

  it('still lets the member choose name order when community rank is the default', async () => {
    algorithms('communityrank');
    const response = await request(createApp()).get('/members?sort=name');
    expect(api.getUsers).toHaveBeenCalledWith('test-token', expect.objectContaining({ sort: 'name' }));
    expect(response.body.locals.hasFilters).toBe(true);
  });

  it('neither offers nor accepts community rank when the community does not use it', async () => {
    algorithms('alphabetical');
    const response = await request(createApp()).get('/members?sort=communityrank');

    expect(api.getUsers).toHaveBeenCalledWith('test-token', expect.objectContaining({ sort: 'name' }));
    expect(response.body.locals.sortOptions).toEqual(['name', 'joined', 'rating', 'hours_given']);
    expect(renderDirectory(response.body.locals)).not.toContain('value="communityrank"');
  });

  it('falls back to name order when the algorithm setting cannot be read', async () => {
    api.getAlgorithmInfo.mockRejectedValue(new api.ApiError('down', 503));
    const response = await request(createApp()).get('/members');
    expect(response.status).toBe(200);
    expect(response.body.locals.sort).toBe('name');
  });
});
