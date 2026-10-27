// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Group webhooks (deep React parity audit, 27 Oct 2026, item 9:
 * react-frontend/src/pages/groups/api/webhooks.ts +
 * components/WebhookConfigPanel.tsx, in the admin-only Automation tab).
 *
 * Group admins list, add, pause/turn on and delete webhooks. The website has no
 * "send a test" action, so neither does this page. A signing secret is sent once
 * and never shown — the API never returns it.
 */
const request = require('supertest');

jest.mock('../src/lib/api', () => require('./support/api-mock').apiMockFactory([
  'getGroup', 'getProfile', 'callGroupApi'
]));

const api = require('../src/lib/api');
const webhookRoutes = require('../src/routes/group-webhooks');
const { groupMediaApp, t } = require('./support/group-media-app');

const app = groupMediaApp([webhookRoutes]);

const MEMBER = { data: { id: 974, name: 'Repair crew', viewer_membership: { status: 'active', role: 'member', is_admin: false } } };
const ADMIN = { data: { id: 974, name: 'Repair crew', viewer_membership: { status: 'active', role: 'admin', is_admin: true } } };

const HOOKS = [
  { id: 4, url: 'https://hooks.example.org/in', events: ['member.joined', 'post.created'], is_active: true, last_fired_at: '2026-10-20 09:00:00', failure_count: 2 },
  { id: 5, url: 'https://other.example.org/x', events: ['file.uploaded'], is_active: false, last_fired_at: null, failure_count: 0 }
];

beforeEach(() => {
  jest.clearAllMocks();
  api.getProfile.mockResolvedValue({ data: { id: 11 } });
  api.getGroup.mockResolvedValue(ADMIN);
  api.callGroupApi.mockResolvedValue({ data: HOOKS });
});

describe('the webhooks page', () => {
  it('is for group admins only', async () => {
    api.getGroup.mockResolvedValue(MEMBER);
    const res = await request(app).get('/groups/974/webhooks');
    expect(res.status).toBe(403);
    expect(api.callGroupApi).not.toHaveBeenCalled();
  });

  it('lists webhooks with their events in words, status, failures and toggle/delete', async () => {
    const res = await request(app).get('/groups/974/webhooks');
    expect(res.status).toBe(200);
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'GET', '/974/webhooks');
    expect(res.text).toContain('https://hooks.example.org/in');
    expect(res.text).toContain(t('govuk_alpha_group_media.webhooks.events.member_joined'));
    expect(res.text).toContain(t('govuk_alpha_group_media.webhooks.events.post_created'));
    expect(res.text).toContain(t('govuk_alpha_group_media.webhooks.active'));
    expect(res.text).toContain(t('govuk_alpha_group_media.webhooks.inactive'));
    expect(res.text).toContain(t('govuk_alpha_group_media.webhooks.never'));
    expect(res.text).toContain('action="/groups/974/webhooks/4/toggle"');
    expect(res.text).toContain(t('govuk_alpha_group_media.webhooks.turn_off'));
    expect(res.text).toContain(t('govuk_alpha_group_media.webhooks.turn_on'));
    expect(res.text).toContain('href="/groups/974/webhooks/4/delete"');
    expect(res.text).toContain('href="/groups/974/webhooks/new"');
  });

  it('shows the empty state', async () => {
    api.callGroupApi.mockResolvedValue({ data: [] });
    const res = await request(app).get('/groups/974/webhooks');
    expect(res.text).toContain(t('govuk_alpha_group_media.webhooks.empty'));
  });
});

describe('adding a webhook', () => {
  it('shows a form with every supported event and a secret field', async () => {
    const res = await request(app).get('/groups/974/webhooks/new');
    expect(res.status).toBe(200);
    ['member.joined', 'member.left', 'discussion.created', 'post.created', 'file.uploaded']
      .forEach((event) => expect(res.text).toContain(`value="${event}"`));
    expect(res.text).toContain('name="secret"');
    expect(res.text).toContain('type="password"');
  });

  it('sends the webhook and never echoes the secret', async () => {
    api.callGroupApi.mockResolvedValue({ data: { id: 9 } });
    const res = await request(app).post('/groups/974/webhooks/new').type('form')
      .send('_csrf=csrf&url=https%3A%2F%2Fhooks.example.org%2Fnew&events=member.joined&events=file.uploaded&secret=s3cret-value');
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'POST', '/974/webhooks', {
      url: 'https://hooks.example.org/new',
      events: ['member.joined', 'file.uploaded'],
      secret: 's3cret-value'
    });
    expect(res.headers.location).toBe('/groups/974/webhooks?status=created');
    expect(res.headers.location).not.toContain('s3cret');
  });

  it('leaves the secret out when none was given', async () => {
    api.callGroupApi.mockResolvedValue({ data: { id: 9 } });
    await request(app).post('/groups/974/webhooks/new').type('form')
      .send({ _csrf: 'csrf', url: 'https://hooks.example.org/new', events: 'post.created', secret: '' });
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'POST', '/974/webhooks', {
      url: 'https://hooks.example.org/new',
      events: ['post.created']
    });
  });

  it('re-shows the form with errors, keeping the address but never the secret', async () => {
    const res = await request(app).post('/groups/974/webhooks/new').type('form')
      .send({ _csrf: 'csrf', url: 'not a url', secret: 'keep-me-out' });
    expect(res.status).toBe(422);
    expect(api.callGroupApi).not.toHaveBeenCalledWith('token:test', 'POST', expect.anything(), expect.anything());
    expect(res.text).toContain('href="#url"');
    expect(res.text).toContain(t('govuk_alpha_group_media.webhooks.errors.url_invalid'));
    expect(res.text).toContain(t('govuk_alpha_group_media.webhooks.errors.events_required'));
    expect(res.text).toContain('value="not a url"');
    expect(res.text).not.toContain('keep-me-out');
  });

  it('ignores an event the API does not support', async () => {
    const res = await request(app).post('/groups/974/webhooks/new').type('form')
      .send({ _csrf: 'csrf', url: 'https://hooks.example.org/new', events: 'user.deleted' });
    expect(res.status).toBe(422);
    expect(res.text).toContain(t('govuk_alpha_group_media.webhooks.errors.events_required'));
  });

  it('is for group admins only', async () => {
    api.getGroup.mockResolvedValue(MEMBER);
    const res = await request(app).post('/groups/974/webhooks/new').type('form')
      .send({ _csrf: 'csrf', url: 'https://hooks.example.org/new', events: 'post.created' });
    expect(res.status).toBe(403);
  });
});

describe('pausing and deleting', () => {
  it('pauses an active webhook', async () => {
    const res = await request(app).post('/groups/974/webhooks/4/toggle').type('form').send({ _csrf: 'csrf', is_active: '0' });
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'PUT', '/974/webhooks/4/toggle', { is_active: false });
    expect(res.headers.location).toBe('/groups/974/webhooks?status=disabled');
  });

  it('turns a paused webhook on', async () => {
    const res = await request(app).post('/groups/974/webhooks/5/toggle').type('form').send({ _csrf: 'csrf', is_active: '1' });
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'PUT', '/974/webhooks/5/toggle', { is_active: true });
    expect(res.headers.location).toBe('/groups/974/webhooks?status=enabled');
  });

  it('confirms before deleting, naming the address, then deletes', async () => {
    const page = await request(app).get('/groups/974/webhooks/4/delete');
    expect(page.status).toBe(200);
    expect(page.text).toContain(t('govuk_alpha_group_media.webhooks.delete_warning', { url: 'https://hooks.example.org/in' }));
    expect(page.text).toContain('action="/groups/974/webhooks/4/delete"');

    api.callGroupApi.mockResolvedValue({ data: { message: 'Deleted' } });
    const res = await request(app).post('/groups/974/webhooks/4/delete').type('form').send({ _csrf: 'csrf' });
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'DELETE', '/974/webhooks/4');
    expect(res.headers.location).toBe('/groups/974/webhooks?status=deleted');
  });

  it('answers 404 for a webhook that is not in this group', async () => {
    const page = await request(app).get('/groups/974/webhooks/77/delete');
    expect(page.status).toBe(404);
  });
});
