// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Group wiki (deep React parity audit 27 Oct 2026): list pages, read, create,
 * edit, delete with confirmation, revision history. React pages/groups/api/wiki.ts,
 * tabs/GroupWikiTab.tsx, section rule `wiki` (tab_wiki + membership). Delete is
 * offered to group admins only, as on the website.
 */
const request = require('supertest');

jest.mock('../src/lib/api', () => require('./support/group-tools-app').apiMockFactory());

const api = require('../src/lib/api');
const { mountGroupTools, MEMBER_GROUP, ADMIN_GROUP, OUTSIDER_GROUP } = require('./support/group-tools-app');
const { createTranslator } = require('../src/lib/localization');
const router = require('../src/routes/group-wiki');

const t = createTranslator('en');
const app = mountGroupTools(router);

const SUMMARY = {
  id: 7, title: 'Tool library', slug: 'tool-library', parent_id: null, sort_order: 0,
  is_published: true, author: { id: 5, name: 'Ann Lee' }, updated_at: '2026-10-20T10:00:00Z'
};
const DRAFT = { ...SUMMARY, id: 8, title: 'Rota draft', slug: 'rota-draft', is_published: false };
const PAGE = { ...SUMMARY, content: 'Drills are in the blue box.\nReturn within a week.' };

beforeEach(() => {
  jest.clearAllMocks();
  app.locals.groupTabs = {};
  api.getProfile.mockResolvedValue({ data: { id: 5 } });
  api.getGroup.mockResolvedValue(MEMBER_GROUP);
  api.callGroupApi.mockImplementation(async (token, method, pathValue) => {
    if (method === 'GET' && pathValue === '/974/wiki') return { data: [SUMMARY, DRAFT] };
    if (method === 'GET' && pathValue === '/974/wiki/tool-library') return { data: PAGE };
    if (method === 'GET' && pathValue === '/974/wiki/7/revisions') {
      return { data: [{ id: 3, change_summary: 'Added return rule', editor: { id: 9, name: 'Bo Kim' }, created_at: '2026-10-21T10:00:00Z' }] };
    }
    return { data: {} };
  });
});

describe('wiki index', () => {
  it('lists pages with links and a new-page link', async () => {
    const res = await request(app).get('/groups/974/wiki');
    expect(res.status).toBe(200);
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'GET', '/974/wiki');
    expect(res.text).toContain('href="/groups/974/wiki/page/tool-library"');
    expect(res.text).toContain('Rota draft');
    expect(res.text).toContain(t('govuk_alpha_group_tools.wiki.draft'));
    expect(res.text).toContain('href="/groups/974/wiki/new"');
  });

  it('answers 404 when the community switched the wiki off', async () => {
    app.locals.groupTabs = { tab_wiki: false };
    const res = await request(app).get('/groups/974/wiki');
    expect(res.status).toBe(404);
    expect(api.callGroupApi).not.toHaveBeenCalled();
  });

  it('refuses a non-member', async () => {
    api.getGroup.mockResolvedValue(OUTSIDER_GROUP);
    const res = await request(app).get('/groups/974/wiki');
    expect(res.status).toBe(403);
  });
});

describe('reading a page', () => {
  it('shows the content as text with edit and history links, no delete for a member', async () => {
    const res = await request(app).get('/groups/974/wiki/page/tool-library');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Drills are in the blue box.');
    expect(res.text).toContain('href="/groups/974/wiki/page/tool-library/edit"');
    expect(res.text).toContain('href="/groups/974/wiki/page/tool-library/history"');
    expect(res.text).not.toContain('/wiki/page/tool-library/delete');
  });

  it('offers delete to a group admin', async () => {
    api.getGroup.mockResolvedValue(ADMIN_GROUP);
    const res = await request(app).get('/groups/974/wiki/page/tool-library');
    expect(res.text).toContain('href="/groups/974/wiki/page/tool-library/delete"');
  });

  it('rejects an unsafe slug', async () => {
    const res = await request(app).get('/groups/974/wiki/page/..%2Fadmin');
    expect(res.status).toBe(404);
  });
});

describe('creating a page', () => {
  it('renders the form with parent choices', async () => {
    const res = await request(app).get('/groups/974/wiki/new');
    expect(res.status).toBe(200);
    expect(res.text).toContain('name="title"');
    expect(res.text).toContain('name="content"');
    expect(res.text).toContain('<option value="7"');
  });

  it('creates and opens the new page', async () => {
    api.callGroupApi.mockImplementation(async (token, method) => {
      if (method === 'POST') return { data: { ...PAGE, id: 9, slug: 'bikes', title: 'Bikes' } };
      return { data: [SUMMARY] };
    });
    const res = await request(app).post('/groups/974/wiki/new').type('form').send({ title: 'Bikes', content: 'Two bikes.', parent_id: '7' });
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'POST', '/974/wiki', { title: 'Bikes', content: 'Two bikes.', parent_id: 7 });
    expect(res.headers.location).toBe('/groups/974/wiki/page/bikes?status=created');
  });

  it('leaves parent out when none is chosen', async () => {
    api.callGroupApi.mockImplementation(async (token, method) => (method === 'POST' ? { data: { ...PAGE, slug: 'x' } } : { data: [] }));
    await request(app).post('/groups/974/wiki/new').type('form').send({ title: 'X', content: 'Y', parent_id: '' });
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'POST', '/974/wiki', { title: 'X', content: 'Y' });
  });

  it('shows errors for empty fields', async () => {
    const res = await request(app).post('/groups/974/wiki/new').type('form').send({ title: '', content: '' });
    expect(res.status).toBe(422);
    expect(res.text).toContain(t('govuk_alpha_group_tools.wiki.title_required'));
    expect(res.text).toContain(t('govuk_alpha_group_tools.wiki.content_required'));
    expect(api.callGroupApi).not.toHaveBeenCalledWith('token:test', 'POST', expect.anything(), expect.anything());
  });
});

describe('editing a page', () => {
  it('pre-fills the content', async () => {
    const res = await request(app).get('/groups/974/wiki/page/tool-library/edit');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Drills are in the blue box.');
    expect(res.text).toContain('name="change_summary"');
  });

  it('saves content and summary against the page id read from the server', async () => {
    const res = await request(app).post('/groups/974/wiki/page/tool-library/edit').type('form').send({ content: 'New text', change_summary: 'Tidy' });
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'PUT', '/974/wiki/7', { content: 'New text', change_summary: 'Tidy' });
    expect(res.headers.location).toBe('/groups/974/wiki/page/tool-library?status=saved');
  });

  it('reports a refused save', async () => {
    api.callGroupApi.mockImplementation(async (token, method) => {
      if (method === 'PUT') throw new api.ApiError('Forbidden', 403, {});
      return { data: PAGE };
    });
    const res = await request(app).post('/groups/974/wiki/page/tool-library/edit').type('form').send({ content: 'New text' });
    expect(res.status).toBe(200);
    expect(res.text).toContain(t('govuk_alpha_group_tools.wiki.save_failed'));
  });

  it('requires content', async () => {
    const res = await request(app).post('/groups/974/wiki/page/tool-library/edit').type('form').send({ content: ' ' });
    expect(res.status).toBe(422);
    expect(api.callGroupApi).not.toHaveBeenCalledWith('token:test', 'PUT', expect.anything(), expect.anything());
  });
});

describe('deleting a page', () => {
  it('refuses the confirmation page to a member', async () => {
    const res = await request(app).get('/groups/974/wiki/page/tool-library/delete');
    expect(res.status).toBe(403);
  });

  it('asks a group admin to confirm', async () => {
    api.getGroup.mockResolvedValue(ADMIN_GROUP);
    const res = await request(app).get('/groups/974/wiki/page/tool-library/delete');
    expect(res.status).toBe(200);
    expect(res.text).toContain(t('govuk_alpha_group_tools.wiki.delete_confirm', { name: 'Tool library' }).replace(/"/g, '&quot;'));
    expect(res.text).toContain('action="/groups/974/wiki/page/tool-library/delete"');
  });

  it('deletes for a group admin', async () => {
    api.getGroup.mockResolvedValue(ADMIN_GROUP);
    const res = await request(app).post('/groups/974/wiki/page/tool-library/delete').type('form').send({});
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'DELETE', '/974/wiki/7');
    expect(res.headers.location).toBe('/groups/974/wiki?status=deleted');
  });

  it('does not delete for a member', async () => {
    const res = await request(app).post('/groups/974/wiki/page/tool-library/delete').type('form').send({});
    expect(res.status).toBe(403);
    expect(api.callGroupApi).not.toHaveBeenCalledWith('token:test', 'DELETE', expect.anything());
  });
});

describe('revision history', () => {
  it('lists revisions', async () => {
    const res = await request(app).get('/groups/974/wiki/page/tool-library/history');
    expect(res.status).toBe(200);
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'GET', '/974/wiki/7/revisions');
    expect(res.text).toContain('Added return rule');
    expect(res.text).toContain('Bo Kim');
  });
});

describe('translations', () => {
  it('renders no raw translation keys', async () => {
    api.getGroup.mockResolvedValue(ADMIN_GROUP);
    for (const url of ['/groups/974/wiki?status=deleted', '/groups/974/wiki/new', '/groups/974/wiki/page/tool-library',
      '/groups/974/wiki/page/tool-library/edit', '/groups/974/wiki/page/tool-library/delete', '/groups/974/wiki/page/tool-library/history']) {
      const res = await request(app).get(url);
      expect(res.status).toBe(200);
      expect(res.text).not.toMatch(/govuk_alpha_group_tools\.|govuk_alpha_groups\.common|web_uk\./);
    }
  });
});
