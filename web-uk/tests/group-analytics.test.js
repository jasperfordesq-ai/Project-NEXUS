// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Group analytics + CSV export, and the group data export (deep React parity
 * audit 27 Oct 2026). React pages/groups/api/analytics.ts + tabs/GroupAnalyticsTab.tsx
 * (section `analytics`: tab_analytics + group admin) and pages/groups/api/dataExport.ts
 * + components/GroupDataExportPanel.tsx (section `automation`: group admin, no
 * tab switch). Downloads are streamed through this server so the bearer token
 * never appears in a URL.
 */
const request = require('supertest');

jest.mock('../src/lib/api', () => require('./support/group-tools-app').apiMockFactory());

const api = require('../src/lib/api');
const { mountGroupTools, MEMBER_GROUP, ADMIN_GROUP } = require('./support/group-tools-app');
const { createTranslator } = require('../src/lib/localization');
const router = require('../src/routes/group-analytics');

const t = createTranslator('en');
const app = mountGroupTools(router);
const EXPORT_ID = '1b4e28ba-2fa1-11d2-883f-0016d3cca427';

const DASHBOARD = {
  overview: { total_members: 40 },
  engagement: {
    summary: { active_members: 12, participation_rate: 30, avg_posts_per_day: 1.5 },
    timeline: [{ date: '2026-10-20', posts: 3, discussions: 1, active_members: 5 }]
  },
  member_growth: [{ date: '2026-10-20', members: 40, new_members: 2 }],
  top_contributors: [{ user_id: 9, name: 'Bo Kim', avatar_url: null, post_count: 7 }],
  activity: { posts: 10, discussions: 4, total: 14 },
  retention: [{ month: '2026-09', joined: 5, still_active: 3, retention_rate: 60 }],
  comparative: { group_members: 40, avg_members: 25, your_activity: 14, avg_activity: 9, percentile: 80 }
};

beforeEach(() => {
  jest.clearAllMocks();
  app.locals.groupTabs = {};
  api.getProfile.mockResolvedValue({ data: { id: 5 } });
  api.getGroup.mockResolvedValue(ADMIN_GROUP);
  api.callGroupApi.mockResolvedValue({ data: DASHBOARD });
  api.downloadGroupFile.mockResolvedValue({
    status: 200,
    body: Buffer.from('name,email\nBo,bo@example.test\n'),
    headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="group-974-members.csv"' }
  });
});

describe('analytics dashboard', () => {
  it('renders figures as summary lists and tables for a group admin', async () => {
    const res = await request(app).get('/groups/974/analytics');
    expect(res.status).toBe(200);
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'GET', '/974/analytics?days=30');
    expect(res.text).toContain('govuk-summary-list');
    expect(res.text).toContain('govuk-table');
    expect(res.text).toContain('Bo Kim');
    expect(res.text).toContain('2026-09');
    expect(res.text).toContain('href="/groups/974/analytics/export/members"');
    expect(res.text).toContain('href="/groups/974/analytics/export/activity"');
    expect(res.text).toContain(t('govuk_alpha_group_tools.analytics.percentile_value', { pct: 80 }));
  });

  it('changes the period with a GET filter', async () => {
    await request(app).get('/groups/974/analytics?days=90');
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'GET', '/974/analytics?days=90');
  });

  it('ignores an unsupported period', async () => {
    await request(app).get('/groups/974/analytics?days=365');
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'GET', '/974/analytics?days=30');
  });

  it('refuses an ordinary member', async () => {
    api.getGroup.mockResolvedValue(MEMBER_GROUP);
    const res = await request(app).get('/groups/974/analytics');
    expect(res.status).toBe(403);
    expect(api.callGroupApi).not.toHaveBeenCalled();
  });

  it('answers 404 when the community switched analytics off', async () => {
    app.locals.groupTabs = { tab_analytics: false };
    const res = await request(app).get('/groups/974/analytics');
    expect(res.status).toBe(404);
  });
});

describe('analytics CSV export', () => {
  it('streams the CSV through the server', async () => {
    const res = await request(app).get('/groups/974/analytics/export/members');
    expect(api.downloadGroupFile).toHaveBeenCalledWith('token:test', '/974/analytics/export/members');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('group-974-members.csv');
    expect(res.text).toContain('bo@example.test');
  });

  it('refuses an ordinary member', async () => {
    api.getGroup.mockResolvedValue(MEMBER_GROUP);
    const res = await request(app).get('/groups/974/analytics/export/activity');
    expect(res.status).toBe(403);
    expect(api.downloadGroupFile).not.toHaveBeenCalled();
  });

  it('returns to the dashboard with a message when the download fails', async () => {
    api.downloadGroupFile.mockRejectedValue(new api.ApiError('Too many', 429, {}));
    const res = await request(app).get('/groups/974/analytics/export/activity');
    expect(res.headers.location).toBe('/groups/974/analytics?status=export-failed');
  });

  it('honours the analytics switch', async () => {
    app.locals.groupTabs = { tab_analytics: false };
    const res = await request(app).get('/groups/974/analytics/export/members');
    expect(res.status).toBe(404);
  });
});

describe('group data export', () => {
  it('explains and offers generating an export', async () => {
    const res = await request(app).get('/groups/974/data-export');
    expect(res.status).toBe(200);
    expect(res.text).toContain(t('govuk_alpha_group_tools.data_export.description').replace(/'/g, '&#39;'));
    expect(res.text).toContain('action="/groups/974/data-export"');
  });

  it('is available even when analytics is switched off (automation has no switch)', async () => {
    app.locals.groupTabs = { tab_analytics: false };
    const res = await request(app).get('/groups/974/data-export');
    expect(res.status).toBe(200);
  });

  it('refuses an ordinary member', async () => {
    api.getGroup.mockResolvedValue(MEMBER_GROUP);
    const res = await request(app).get('/groups/974/data-export');
    expect(res.status).toBe(403);
  });

  it('requests an export and opens its status page', async () => {
    api.callGroupApi.mockResolvedValue({ data: { id: EXPORT_ID, status: 'queued' } });
    const res = await request(app).post('/groups/974/data-export').type('form').send({});
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'POST', '/974/exports', {});
    expect(res.headers.location).toBe(`/groups/974/data-export/${EXPORT_ID}?status=requested`);
  });

  it('reports a failed request', async () => {
    api.callGroupApi.mockRejectedValue(new api.ApiError('Forbidden', 403, {}));
    const res = await request(app).post('/groups/974/data-export').type('form').send({});
    expect(res.headers.location).toBe('/groups/974/data-export?status=request-failed');
  });

  it('shows status with a refresh link while preparing', async () => {
    api.callGroupApi.mockResolvedValue({ data: { id: EXPORT_ID, status: 'processing', created_at: '2026-10-27T09:00:00Z' } });
    const res = await request(app).get(`/groups/974/data-export/${EXPORT_ID}`);
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'GET', `/974/exports/${EXPORT_ID}`);
    expect(res.text).toContain(t('govuk_alpha_group_tools.data_export.status_processing'));
    expect(res.text).toContain(`href="/groups/974/data-export/${EXPORT_ID}"`);
    expect(res.text).not.toContain('/download');
  });

  it('offers the download when ready, without exposing the API URL', async () => {
    api.callGroupApi.mockResolvedValue({ data: { id: EXPORT_ID, status: 'completed', byte_size: 2048, download_url: 'https://api.example/secret?token=x', expires_at: '2026-11-03T09:00:00Z' } });
    const res = await request(app).get(`/groups/974/data-export/${EXPORT_ID}`);
    expect(res.text).toContain(`href="/groups/974/data-export/${EXPORT_ID}/download"`);
    expect(res.text).not.toContain('api.example');
  });

  it('streams the download', async () => {
    api.downloadGroupFile.mockResolvedValue({ status: 200, body: Buffer.from('{"group":1}'), headers: { 'content-type': 'application/json', 'content-disposition': '' } });
    const res = await request(app).get(`/groups/974/data-export/${EXPORT_ID}/download`);
    expect(api.downloadGroupFile).toHaveBeenCalledWith('token:test', `/974/exports/${EXPORT_ID}/download`);
    expect(res.headers['content-disposition']).toContain('group-974-export.json');
  });

  it('rejects an export id that is not a UUID', async () => {
    const res = await request(app).get('/groups/974/data-export/not-a-uuid');
    expect(res.status).toBe(404);
    expect(api.callGroupApi).not.toHaveBeenCalled();
  });
});

describe('translations', () => {
  it('renders no raw translation keys', async () => {
    const pages = [
      ['/groups/974/analytics?status=export-failed', { data: DASHBOARD }],
      ['/groups/974/data-export?status=request-failed', { data: {} }],
      [`/groups/974/data-export/${EXPORT_ID}`, { data: { id: EXPORT_ID, status: 'completed', byte_size: 10, created_at: '2026-10-27T09:00:00Z', expires_at: '2026-11-03T09:00:00Z' } }]
    ];
    for (const [url, payload] of pages) {
      api.callGroupApi.mockResolvedValue(payload);
      const res = await request(app).get(url);
      expect(res.status).toBe(200);
      expect(res.text).not.toMatch(/govuk_alpha_group_tools\.|govuk_alpha_groups\.common|web_uk\./);
    }
  });
});
