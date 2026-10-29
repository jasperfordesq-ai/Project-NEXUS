// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The ideas list offers React's filters — favourites, category and tag — and
 * sends them the way React does (`favorites=1`, `category=<slug>`, `tags=<name>`).
 * Laravel applies them since 29 Oct 2026; before that it ignored every filter,
 * search included.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../src/lib/api', () => ({ callIdeationApi: jest.fn() }));
jest.mock('../src/lib/request-profile', () => ({ getRequestProfile: jest.fn().mockResolvedValue({ data: { id: 1 } }) }));

const api = require('../src/lib/api');
const ideationRoutes = require('../src/routes/ideation');

function buildApp() {
  const app = express();
  app.use((req, res, next) => {
    req.token = 'test-token';
    res.locals.t = (key) => key;
    res.locals.urlFor = (value) => String(value || '/');
    res.render = (view, locals) => res.json({ view, locals });
    next();
  });
  app.use('/ideation', ideationRoutes);
  return app;
}

beforeEach(() => {
  api.callIdeationApi.mockReset();
  api.callIdeationApi.mockImplementation(async (token, method, path) => {
    if (path === '/ideation-categories') return { data: [{ id: 1, slug: 'green-spaces', name: 'Green spaces' }] };
    if (path === '/ideation-tags/popular') return { data: [{ tag: 'parks', count: 2 }] };
    return { data: [], meta: { has_more: true, cursor: 'c2' } };
  });
});

it('sends favourites, category and tag to Laravel and keeps them on the next page link', async () => {
  const res = await request(buildApp()).get('/ideation?status=favorites&category=green-spaces&tag=parks&q=trees');
  expect(res.status).toBe(200);
  const listCall = api.callIdeationApi.mock.calls.find((call) => call[2].startsWith('/ideation-challenges?'));
  const params = new URLSearchParams(listCall[2].split('?')[1]);
  expect(params.get('favorites')).toBe('1');
  expect(params.get('category')).toBe('green-spaces');
  expect(params.get('tags')).toBe('parks');
  expect(params.get('search')).toBe('trees');
  expect(params.has('status')).toBe(false);
  expect(res.body.locals.activeStatus).toBe('favorites');
  expect(res.body.locals.categories).toEqual([{ slug: 'green-spaces', name: 'Green spaces' }]);
  expect(res.body.locals.tags).toEqual(['parks']);
  const next = new URLSearchParams(res.body.locals.nextPageHref.split('?')[1]);
  expect(next.get('status')).toBe('favorites');
  expect(next.get('category')).toBe('green-spaces');
  expect(next.get('tag')).toBe('parks');
});

it('still lists challenges when the filter lists cannot be read', async () => {
  api.callIdeationApi.mockImplementation(async (token, method, path) => {
    if (path === '/ideation-challenges?per_page=30') return { data: [{ id: 3, title: 'Trees' }] };
    throw new Error('unavailable');
  });
  const res = await request(buildApp()).get('/ideation');
  expect(res.status).toBe(200);
  expect(res.body.locals.categories).toEqual([]);
  expect(res.body.locals.challenges).toHaveLength(1);
});
