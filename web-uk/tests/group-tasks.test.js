// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Group task list (deep React parity audit 27 Oct 2026): list with statistics and
 * a status filter, add, change status, delete with confirmation. React
 * components/ideation/TeamTasks.tsx via tabs/GroupTasksTab.tsx; section rule
 * `tasks` (tab_tasks + membership). Per-task actions follow the server's
 * `can_update_status` / `can_delete` flags, as on the website.
 */
const request = require('supertest');

jest.mock('../src/lib/api', () => require('./support/group-tools-app').apiMockFactory());

const api = require('../src/lib/api');
const { mountGroupTools, MEMBER_GROUP, OUTSIDER_GROUP } = require('./support/group-tools-app');
const { createTranslator } = require('../src/lib/localization');
const router = require('../src/routes/group-tasks');

const t = createTranslator('en');
const app = mountGroupTools(router);

const TASK = {
  id: 55, group_id: 974, title: 'Fix the gate', description: 'Hinge is loose', status: 'todo', priority: 'high',
  assigned_to: 9, created_by: 5, due_date: '2020-01-10', created_at: '2026-10-01T10:00:00Z',
  can_update_status: true, can_edit: true, can_delete: true, assignee: { id: 9, name: 'Bo Kim', avatar_url: null }
};
const LOCKED = { ...TASK, id: 56, title: 'Order paint', can_update_status: false, can_delete: false, due_date: null, assignee: null, assigned_to: null };

beforeEach(() => {
  jest.clearAllMocks();
  app.locals.groupTabs = {};
  api.getProfile.mockResolvedValue({ data: { id: 5 } });
  api.getGroup.mockResolvedValue(MEMBER_GROUP);
  api.callGroupApi.mockImplementation(async (token, method, pathValue) => {
    if (pathValue.startsWith('/974/tasks')) return { data: [TASK, LOCKED] };
    if (pathValue === '/974/task-stats') return { data: { total: 2, todo: 2, in_progress: 0, done: 0, overdue: 1 } };
    if (pathValue.startsWith('/974/members')) return { data: [{ id: 9, name: 'Bo Kim' }, { id: 5, name: 'Ann Lee' }] };
    return { data: {} };
  });
  api.callIdeationApi.mockImplementation(async (token, method, pathValue) => {
    if (method === 'GET' && pathValue === '/team-tasks/55') return { data: TASK };
    if (method === 'GET' && pathValue === '/team-tasks/99') return { data: { ...TASK, id: 99, group_id: 12 } };
    return { data: {} };
  });
});

describe('task list', () => {
  it('shows statistics, tasks and per-task actions', async () => {
    const res = await request(app).get('/groups/974/tasks');
    expect(res.status).toBe(200);
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'GET', '/974/tasks?per_page=50');
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'GET', '/974/task-stats');
    expect(res.text).toContain('Fix the gate');
    expect(res.text).toContain('Bo Kim');
    expect(res.text).toContain(t('govuk_alpha_group_tools.tasks.overdue'));
    expect(res.text).toContain('action="/groups/974/tasks/55/status"');
    expect(res.text).toContain('href="/groups/974/tasks/55/delete"');
    expect(res.text).not.toContain('/groups/974/tasks/56/status');
    expect(res.text).not.toContain('/groups/974/tasks/56/delete');
    expect(res.text).toContain('href="/groups/974/tasks/new"');
  });

  it('filters by status with GET', async () => {
    const res = await request(app).get('/groups/974/tasks?show=done');
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'GET', '/974/tasks?per_page=50&status=done');
    expect(res.text).toContain('method="get"');
  });

  it('ignores an unknown status filter', async () => {
    await request(app).get('/groups/974/tasks?show=bogus');
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'GET', '/974/tasks?per_page=50');
  });

  it('answers 404 when the community switched tasks off', async () => {
    app.locals.groupTabs = { tab_tasks: false };
    const res = await request(app).get('/groups/974/tasks');
    expect(res.status).toBe(404);
    expect(api.callGroupApi).not.toHaveBeenCalled();
  });

  it('refuses a non-member', async () => {
    api.getGroup.mockResolvedValue(OUTSIDER_GROUP);
    const res = await request(app).get('/groups/974/tasks');
    expect(res.status).toBe(403);
  });
});

describe('adding a task', () => {
  it('renders the form with group members to assign', async () => {
    const res = await request(app).get('/groups/974/tasks/new');
    expect(res.status).toBe(200);
    expect(res.text).toContain('name="title"');
    expect(res.text).toContain('<option value="9">Bo Kim</option>');
    expect(res.text).toContain('name="due_date-day"');
  });

  it('creates a task with the website payload', async () => {
    const res = await request(app).post('/groups/974/tasks/new').type('form').send({
      title: ' Paint shed ', description: 'Green', status: 'in_progress', priority: 'urgent', assigned_to: '9',
      'due_date-day': '3', 'due_date-month': '11', 'due_date-year': '2026'
    });
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'POST', '/974/tasks', {
      title: 'Paint shed', description: 'Green', status: 'in_progress', priority: 'urgent', assigned_to: 9, due_date: '2026-11-03'
    });
    expect(res.headers.location).toBe('/groups/974/tasks?status=created');
  });

  it('defaults status and priority and leaves assignee and date empty', async () => {
    await request(app).post('/groups/974/tasks/new').type('form').send({ title: 'Sweep' });
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'POST', '/974/tasks', {
      title: 'Sweep', description: null, status: 'todo', priority: 'medium', assigned_to: null, due_date: null
    });
  });

  it('shows errors for a missing title and an impossible date', async () => {
    const res = await request(app).post('/groups/974/tasks/new').type('form').send({
      title: '', 'due_date-day': '31', 'due_date-month': '2', 'due_date-year': '2026'
    });
    expect(res.status).toBe(422);
    expect(res.text).toContain(t('govuk_alpha_group_tools.tasks.title_required'));
    expect(res.text).toContain(t('web_uk.date_input.date_invalid'));
    expect(api.callGroupApi).not.toHaveBeenCalledWith('token:test', 'POST', expect.anything(), expect.anything());
  });
});

describe('changing status', () => {
  it('updates the status', async () => {
    const res = await request(app).post('/groups/974/tasks/55/status').type('form').send({ status: 'done' });
    expect(api.callIdeationApi).toHaveBeenCalledWith('token:test', 'PUT', '/team-tasks/55', { status: 'done' });
    expect(res.headers.location).toBe('/groups/974/tasks?status=updated');
  });

  it('rejects an unknown status', async () => {
    const res = await request(app).post('/groups/974/tasks/55/status').type('form').send({ status: 'lost' });
    expect(res.headers.location).toBe('/groups/974/tasks?status=update-failed');
    expect(api.callIdeationApi).not.toHaveBeenCalledWith('token:test', 'PUT', expect.anything(), expect.anything());
  });

  it('refuses a task from another group', async () => {
    const res = await request(app).post('/groups/974/tasks/99/status').type('form').send({ status: 'done' });
    expect(res.status).toBe(404);
    expect(api.callIdeationApi).not.toHaveBeenCalledWith('token:test', 'PUT', expect.anything(), expect.anything());
  });
});

describe('deleting a task', () => {
  it('asks for confirmation', async () => {
    const res = await request(app).get('/groups/974/tasks/55/delete');
    expect(res.status).toBe(200);
    expect(res.text).toContain(t('govuk_alpha_group_tools.tasks.delete_confirm', { name: 'Fix the gate' }).replace(/"/g, '&quot;'));
    expect(res.text).toContain('action="/groups/974/tasks/55/delete"');
  });

  it('deletes', async () => {
    const res = await request(app).post('/groups/974/tasks/55/delete').type('form').send({});
    expect(api.callIdeationApi).toHaveBeenCalledWith('token:test', 'DELETE', '/team-tasks/55');
    expect(res.headers.location).toBe('/groups/974/tasks?status=deleted');
  });

  it('refuses when the server says this person cannot delete', async () => {
    api.callIdeationApi.mockResolvedValue({ data: { ...TASK, can_delete: false } });
    const res = await request(app).get('/groups/974/tasks/55/delete');
    expect(res.status).toBe(403);
  });
});

describe('translations', () => {
  it('renders no raw translation keys', async () => {
    for (const url of ['/groups/974/tasks?status=created', '/groups/974/tasks/new', '/groups/974/tasks/55/delete']) {
      const res = await request(app).get(url);
      expect(res.status).toBe(200);
      expect(res.text).not.toMatch(/govuk_alpha_group_tools\.|govuk_alpha_groups\.common|web_uk\./);
    }
  });
});
