// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Group chat channels (deep React parity audit, 27 Oct 2026, item 1:
 * react-frontend/src/components/ideation/TeamChatrooms.tsx via
 * pages/groups/tabs/GroupChatroomsTab.tsx).
 *
 * List channels, read a channel with paging back through older messages,
 * post, delete your own message (an admin may delete any), pin and unpin
 * (admins, as on the website), and create and delete channels (admins). There
 * are no live updates: the page refreshes.
 */
const request = require('supertest');

jest.mock('../src/lib/api', () => require('./support/api-mock').apiMockFactory([
  'getGroup', 'getProfile', 'callGroupApi', 'callGroupChatroomApi', 'callGroupChatroomMessageApi'
]));

const api = require('../src/lib/api');
const channelRoutes = require('../src/routes/group-channels');
const { groupMediaApp, t } = require('./support/group-media-app');

const app = groupMediaApp([channelRoutes]);

const MEMBER = { data: { id: 974, name: 'Repair crew', viewer_membership: { status: 'active', role: 'member', is_admin: false } } };
const ADMIN = { data: { id: 974, name: 'Repair crew', viewer_membership: { status: 'active', role: 'admin', is_admin: true } } };

const ROOMS = [
  { id: 7, group_id: 974, name: 'General', description: null, is_default: true, is_private: false, created_by: 1 },
  { id: 8, group_id: 974, name: 'Lifts', description: 'Sharing lifts', is_default: false, is_private: true, created_by: 11 }
];

function message(id, userId, body, name = 'Ann Lee') {
  return { id, body, user_id: userId, author: { id: userId, name, avatar_url: null }, created_at: `2026-10-2${id % 10} 10:00:00` };
}

function routeApi({ rooms = ROOMS, messages = [], cursor = null, hasMore = false, pinned = [] } = {}) {
  api.callGroupApi.mockImplementation(async (token, method, path) => {
    if (method === 'GET' && path === '/974/chatrooms') return { data: rooms };
    if (method === 'GET' && /\/974\/chatrooms\/\d+\/pinned$/.test(path)) return { data: pinned };
    return { data: {} };
  });
  api.callGroupChatroomApi.mockImplementation(async (token, method) => {
    if (method === 'GET') return { data: messages, meta: { cursor, has_more: hasMore } };
    return { data: { id: 99 } };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  api.getProfile.mockResolvedValue({ data: { id: 11, role: 'member' } });
  api.getGroup.mockResolvedValue(MEMBER);
  routeApi();
});

describe('the channel list', () => {
  it('lists the channels with links, marking the main and private ones', async () => {
    const res = await request(app).get('/groups/974/channels');
    expect(res.status).toBe(200);
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'GET', '/974/chatrooms');
    expect(res.text).toContain('href="/groups/974/channels/7"');
    expect(res.text).toContain('href="/groups/974/channels/8"');
    expect(res.text).toContain(t('govuk_alpha_group_media.channels.default_tag'));
    expect(res.text).toContain(t('govuk_alpha_group_media.channels.private_tag'));
    // Creating a channel is an admin tool on the website.
    expect(res.text).not.toContain('action="/groups/974/channels"');
  });

  it('gives an admin the create form', async () => {
    api.getGroup.mockResolvedValue(ADMIN);
    const res = await request(app).get('/groups/974/channels');
    expect(res.text).toContain('action="/groups/974/channels"');
  });

  it('treats a community administrator as a channel admin, as the website does', async () => {
    api.getProfile.mockResolvedValue({ data: { id: 11, role: 'tenant_admin' } });
    const res = await request(app).get('/groups/974/channels');
    expect(res.text).toContain('action="/groups/974/channels"');
  });

  it('is not there when the community switched channels off', async () => {
    const offApp = groupMediaApp([channelRoutes], { tenant: { group_tabs: { tab_chatrooms: false } } });
    const res = await request(offApp).get('/groups/974/channels');
    expect(res.status).toBe(404);
    expect(api.callGroupApi).not.toHaveBeenCalled();
  });

  it('is not there when the community does not have the feature the channels belong to', async () => {
    const offApp = groupMediaApp([channelRoutes], { tenant: { features: { ideation_challenges: false } } });
    const res = await request(offApp).get('/groups/974/channels');
    expect(res.status).toBe(404);
  });

  it('is for members only — even a group admin who is not a member, as on the website', async () => {
    api.getGroup.mockResolvedValue({ data: { id: 974, name: 'Repair crew', viewer_membership: { status: 'none', is_admin: true } } });
    const res = await request(app).get('/groups/974/channels');
    expect(res.status).toBe(403);
  });
});

describe('reading a channel', () => {
  it('shows messages oldest first, a refresh link, older-message paging and the post form', async () => {
    routeApi({
      messages: [message(12, 11, 'Newest from me'), message(11, 22, 'Older from Bob', 'Bob Ray')],
      cursor: 'MTE=',
      hasMore: true
    });
    const res = await request(app).get('/groups/974/channels/7');
    expect(res.status).toBe(200);
    expect(api.callGroupChatroomApi).toHaveBeenCalledWith('token:test', 'GET', '/7/messages?per_page=50');
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'GET', '/974/chatrooms/7/pinned');
    expect(res.text.indexOf('Older from Bob')).toBeLessThan(res.text.indexOf('Newest from me'));
    expect(res.text).toContain('href="/groups/974/channels/7?cursor=MTE%3D"');
    expect(res.text).toContain(t('govuk_alpha_group_media.channels.refresh'));
    expect(res.text).toContain('action="/groups/974/channels/7/messages"');
    // Delete only on my own message; no pinning for a member.
    expect(res.text).toContain('href="/groups/974/channels/7/messages/12/delete"');
    expect(res.text).not.toContain('href="/groups/974/channels/7/messages/11/delete"');
    expect(res.text).not.toContain('/messages/12/pin');
    // The main channel cannot be deleted, and members cannot delete channels.
    expect(res.text).not.toContain('href="/groups/974/channels/7/delete"');
  });

  it('gives an admin pin, unpin and delete on every message, and shows the pinned list', async () => {
    api.getGroup.mockResolvedValue(ADMIN);
    routeApi({
      messages: [message(12, 11, 'Newest'), message(11, 22, 'Pinned one', 'Bob Ray')],
      pinned: [{ ...message(11, 22, 'Pinned one', 'Bob Ray'), pinned_by: 11, pinned_at: '2026-10-21 10:00:00' }]
    });
    const res = await request(app).get('/groups/974/channels/8');
    expect(res.text).toContain(t('govuk_alpha_group_media.channels.pinned_heading'));
    expect(res.text).toContain('action="/groups/974/channels/8/messages/12/pin"');
    expect(res.text).toContain('action="/groups/974/channels/8/messages/11/unpin"');
    expect(res.text).toContain('href="/groups/974/channels/8/messages/11/delete"');
    expect(res.text).toContain('href="/groups/974/channels/8/delete"');
  });

  it('answers 404 for a channel that is not in this group', async () => {
    const res = await request(app).get('/groups/974/channels/55');
    expect(res.status).toBe(404);
    expect(api.callGroupChatroomApi).not.toHaveBeenCalled();
  });

  it('pages back with the cursor and offers the latest page', async () => {
    routeApi({ messages: [message(5, 22, 'Old', 'Bob Ray')] });
    const res = await request(app).get('/groups/974/channels/7?cursor=MTE%3D');
    expect(api.callGroupChatroomApi).toHaveBeenCalledWith('token:test', 'GET', '/7/messages?per_page=50&cursor=MTE%3D');
    expect(res.text).toContain('href="/groups/974/channels/7"');
  });
});

describe('posting and managing messages', () => {
  it('posts a message and returns to the channel', async () => {
    const res = await request(app).post('/groups/974/channels/7/messages').type('form').send({ _csrf: 'csrf', body: '  Anyone free Saturday?  ' });
    expect(api.callGroupChatroomApi).toHaveBeenCalledWith('token:test', 'POST', '/7/messages', { body: 'Anyone free Saturday?' });
    expect(res.headers.location).toBe('/groups/974/channels/7?status=posted#latest');
  });

  it('asks for a message when the box was empty', async () => {
    const res = await request(app).post('/groups/974/channels/7/messages').type('form').send({ _csrf: 'csrf', body: '   ' });
    expect(api.callGroupChatroomApi).not.toHaveBeenCalledWith('token:test', 'POST', expect.anything(), expect.anything());
    expect(res.headers.location).toBe('/groups/974/channels/7?status=body-required#message-body');
  });

  it('shows a safeguarding refusal in words', async () => {
    api.callGroupChatroomApi.mockRejectedValue(new api.ApiError('No', 403, { errors: [{ code: 'SAFEGUARDING_RESTRICTED' }] }));
    const res = await request(app).post('/groups/974/channels/7/messages').type('form').send({ _csrf: 'csrf', body: 'Hi' });
    expect(res.headers.location).toBe('/groups/974/channels/7?status=safeguarding#message-body');
  });

  it('confirms before deleting a message, then deletes it', async () => {
    const page = await request(app).get('/groups/974/channels/7/messages/12/delete');
    expect(page.status).toBe(200);
    expect(page.text).toContain(t('govuk_alpha_group_media.channels.delete_message_title'));
    expect(page.text).toContain('action="/groups/974/channels/7/messages/12/delete"');

    const res = await request(app).post('/groups/974/channels/7/messages/12/delete').type('form').send({ _csrf: 'csrf' });
    expect(api.callGroupChatroomMessageApi).toHaveBeenCalledWith('token:test', 'DELETE', '/12');
    expect(res.headers.location).toBe('/groups/974/channels/7?status=message-deleted');
  });

  it('lets an admin pin and unpin', async () => {
    api.getGroup.mockResolvedValue(ADMIN);
    let res = await request(app).post('/groups/974/channels/7/messages/12/pin').type('form').send({ _csrf: 'csrf' });
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'POST', '/974/chatrooms/7/pin/12', {});
    expect(res.headers.location).toBe('/groups/974/channels/7?status=pinned');
    res = await request(app).post('/groups/974/channels/7/messages/12/unpin').type('form').send({ _csrf: 'csrf' });
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'DELETE', '/974/chatrooms/7/pin/12');
    expect(res.headers.location).toBe('/groups/974/channels/7?status=unpinned');
  });

  it('does not let a member pin', async () => {
    const res = await request(app).post('/groups/974/channels/7/messages/12/pin').type('form').send({ _csrf: 'csrf' });
    expect(res.status).toBe(403);
  });
});

describe('creating and deleting channels', () => {
  it('lets an admin create a channel and opens it', async () => {
    api.getGroup.mockResolvedValue(ADMIN);
    api.callGroupApi.mockResolvedValue({ data: { id: 31, name: 'Tools' } });
    const res = await request(app).post('/groups/974/channels').type('form').send({ _csrf: 'csrf', name: ' Tools ' });
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'POST', '/974/chatrooms', { name: 'Tools' });
    expect(res.headers.location).toBe('/groups/974/channels/31?status=created');
  });

  it('asks for a name', async () => {
    api.getGroup.mockResolvedValue(ADMIN);
    const res = await request(app).post('/groups/974/channels').type('form').send({ _csrf: 'csrf', name: '' });
    expect(res.headers.location).toBe('/groups/974/channels?status=name-required#channel-name');
  });

  it('does not let a member create a channel', async () => {
    const res = await request(app).post('/groups/974/channels').type('form').send({ _csrf: 'csrf', name: 'Mine' });
    expect(res.status).toBe(403);
  });

  it('confirms before deleting a channel, then deletes it', async () => {
    api.getGroup.mockResolvedValue(ADMIN);
    const page = await request(app).get('/groups/974/channels/8/delete');
    expect(page.status).toBe(200);
    expect(page.text).toContain(t('govuk_alpha_group_media.channels.delete_channel_title', { name: 'Lifts' }));

    const res = await request(app).post('/groups/974/channels/8/delete').type('form').send({ _csrf: 'csrf' });
    expect(api.callGroupChatroomApi).toHaveBeenCalledWith('token:test', 'DELETE', '/8');
    expect(res.headers.location).toBe('/groups/974/channels?status=deleted');
  });

  it('will not offer to delete the main channel', async () => {
    api.getGroup.mockResolvedValue(ADMIN);
    const page = await request(app).get('/groups/974/channels/7/delete');
    expect(page.status).toBe(403);
  });
});
