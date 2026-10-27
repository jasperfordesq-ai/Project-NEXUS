// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Group chat channels: /groups/:id/channels (parity with the website's Chat
 * rooms tab — react-frontend/src/components/ideation/TeamChatrooms.tsx rendered
 * by pages/groups/tabs/GroupChatroomsTab.tsx — 27 Oct 2026).
 *
 * - GET  /groups/:id/channels                                   channel list (+ create form for admins)
 * - POST /groups/:id/channels                                   create a channel (admins)
 * - GET  /groups/:id/channels/:roomId                           messages, newest page; ?cursor= for older
 * - POST /groups/:id/channels/:roomId/messages                  post a message
 * - GET  /groups/:id/channels/:roomId/messages/:messageId/delete confirmation page
 * - POST /groups/:id/channels/:roomId/messages/:messageId/delete delete a message
 * - POST /groups/:id/channels/:roomId/messages/:messageId/pin    pin (admins)
 * - POST /groups/:id/channels/:roomId/messages/:messageId/unpin  unpin (admins)
 * - GET  /groups/:id/channels/:roomId/delete                    confirmation page (admins)
 * - POST /groups/:id/channels/:roomId/delete                    delete the channel (admins)
 *
 * Who may do what is the website's rule (TeamChatrooms.tsx): every member reads
 * and posts; a member deletes their own messages; the channel admin — a group
 * admin or a community administrator role — creates and deletes channels, pins
 * and unpins, and deletes any message. The main channel (`is_default`) is never
 * offered for deletion (the API refuses it too).
 *
 * The website updates live over Pusher; this page does not. It says so and
 * offers a Refresh link instead (an HTML-first equivalent, not a live chat).
 *
 * Contract: GET/POST /api/v2/groups/{id}/chatrooms, GET/POST
 * /api/v2/group-chatrooms/{id}/messages, DELETE /api/v2/group-chatrooms/{id},
 * DELETE /api/v2/group-chatroom-messages/{id}, POST/DELETE
 * /api/v2/groups/{groupId}/chatrooms/{chatroomId}/pin/{messageId}, GET
 * /api/v2/groups/{groupId}/chatrooms/{chatroomId}/pinned.
 */

const express = require('express');
const {
  callGroupApi,
  callGroupChatroomApi,
  callGroupChatroomMessageApi,
  ApiError
} = require('../lib/api');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute } = require('../lib/routeHelpers');
const { requireGroupSection, renderRefusal } = require('../lib/group-media-access');
const { getRequestIntlLocale } = require('../lib/request-intl-locale');
const {
  text,
  positiveInteger,
  dataFrom,
  urlFor,
  redirectWithStatus,
  isAuthError,
  loginRedirect,
  apiErrorField,
  isSafeguardingRefusal,
  statusBanner,
  dateTimeLabel
} = require('../lib/group-media-pages');

const router = express.Router();

const NS = 'govuk_alpha_group_media.channels';
const PER_PAGE = 50;
const NAME_MAX = 100;
const BODY_MAX = 5000;
const PAGE_OPTIONS = { redirectOn401: '/login?status=auth-required' };

const SUCCESS_STATES = new Set(['created', 'deleted', 'posted', 'message-deleted', 'pinned', 'unpinned']);
const ERROR_STATES = new Set([
  'name-required', 'name-too-long', 'body-required', 'body-too-long', 'failed', 'forbidden', 'safeguarding'
]);
const LIST_FIELD_FOR = { 'name-required': 'channel-name', 'name-too-long': 'channel-name', safeguarding: 'channel-name' };
const ROOM_FIELD_FOR = { 'body-required': 'message-body', 'body-too-long': 'message-body', safeguarding: 'message-body' };

function normalizeRoom(raw) {
  const room = raw && typeof raw === 'object' ? raw : {};
  const id = positiveInteger(room.id);
  if (id === null) return null;
  return {
    id,
    name: text(room.name) || `#${id}`,
    description: text(room.description),
    isDefault: room.is_default === true || room.is_default === 1,
    isPrivate: room.is_private === true || room.is_private === 1
  };
}

function normalizeMessage(raw, viewerId, locale) {
  const message = raw && typeof raw === 'object' ? raw : {};
  const id = positiveInteger(message.id);
  if (id === null) return null;
  const userId = positiveInteger(message.user_id || message.author?.id);
  return {
    id,
    body: text(message.body),
    authorName: text(message.author?.name),
    postedLabel: dateTimeLabel(message.created_at, locale),
    isOwn: viewerId !== null && userId === viewerId
  };
}

async function loadRooms(token, groupId) {
  const rows = dataFrom(await callGroupApi(token, 'GET', `/${encodeURIComponent(groupId)}/chatrooms`));
  return (Array.isArray(rows) ? rows : []).map(normalizeRoom).filter(Boolean);
}

/** The channel, if it belongs to this group and this person may see it. */
async function findRoom(token, groupId, roomId) {
  const rooms = await loadRooms(token, groupId);
  return rooms.find((room) => room.id === Number(roomId)) || null;
}

function failureStatus(error) {
  if (!(error instanceof ApiError)) return 'failed';
  if (isSafeguardingRefusal(error)) return 'safeguarding';
  if (error.status === 403) return 'forbidden';
  return 'failed';
}

function roomPath(groupId, roomId) {
  return `/groups/${groupId}/channels/${roomId}`;
}

/** Load the section and the channel together; answers the refusal itself and returns null. */
async function requireRoom(req, res) {
  const access = await requireGroupSection(req, res, 'chatrooms');
  if (!access) return null;
  let room;
  try {
    room = await findRoom(req.token, access.group.id, req.params.roomId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      renderRefusal(res, 403);
      return null;
    }
    throw error;
  }
  if (!room) {
    renderRefusal(res, 404);
    return null;
  }
  return { ...access, room };
}

router.get('/:id(\\d+)/channels', requireAuth, asyncRoute(async (req, res) => {
  const access = await requireGroupSection(req, res, 'chatrooms');
  if (!access) return undefined;
  const { group, isChannelAdmin } = access;
  const t = res.locals.t;

  let rooms;
  try {
    rooms = await loadRooms(req.token, group.id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return renderRefusal(res, 403);
    throw error;
  }
  const banner = statusBanner(t, `${NS}.states`, req.query.status, SUCCESS_STATES, ERROR_STATES, LIST_FIELD_FOR);

  return res.render('groups/channels/index', {
    title: t(`${NS}.title`),
    group,
    rooms,
    isChannelAdmin,
    statusBanner: banner,
    hasErrors: Boolean(banner && banner.type === 'error')
  });
}, PAGE_OPTIONS));

router.post('/:id(\\d+)/channels', requireAuth, asyncRoute(async (req, res) => {
  const access = await requireGroupSection(req, res, 'chatrooms');
  if (!access) return undefined;
  const { group, isChannelAdmin } = access;
  if (!isChannelAdmin) return renderRefusal(res, 403);
  const back = `/groups/${group.id}/channels`;

  const name = text(req.body?.name);
  if (name === '') return redirectWithStatus(res, back, 'name-required', '#channel-name');
  if (name.length > NAME_MAX) return redirectWithStatus(res, back, 'name-too-long', '#channel-name');

  let created;
  try {
    created = dataFrom(await callGroupApi(req.token, 'POST', `/${encodeURIComponent(group.id)}/chatrooms`, { name }));
  } catch (error) {
    if (isAuthError(error)) return loginRedirect(res);
    const status = failureStatus(error);
    return redirectWithStatus(res, back, status, status === 'safeguarding' ? '#channel-name' : '');
  }

  const newId = positiveInteger(created?.id);
  return newId
    ? redirectWithStatus(res, roomPath(group.id, newId), 'created')
    : redirectWithStatus(res, back, 'created');
}, PAGE_OPTIONS));

router.get('/:id(\\d+)/channels/:roomId(\\d+)', requireAuth, asyncRoute(async (req, res) => {
  const context = await requireRoom(req, res);
  if (!context) return undefined;
  const { group, room, isChannelAdmin, viewerId } = context;
  const t = res.locals.t;
  const locale = getRequestIntlLocale();

  const cursor = text(req.query.cursor, 200);
  const params = new URLSearchParams({ per_page: String(PER_PAGE) });
  if (cursor) params.set('cursor', cursor);

  let page;
  try {
    page = await callGroupChatroomApi(req.token, 'GET', `/${encodeURIComponent(room.id)}/messages?${params.toString()}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return renderRefusal(res, 403);
    if (error instanceof ApiError && error.status === 404) return renderRefusal(res, 404);
    throw error;
  }

  let pinnedRows = [];
  try {
    pinnedRows = dataFrom(await callGroupApi(req.token, 'GET', `/${encodeURIComponent(group.id)}/chatrooms/${encodeURIComponent(room.id)}/pinned`));
  } catch (error) {
    if (isAuthError(error)) throw error;
    pinnedRows = []; // The pinned list is a convenience; the messages still show.
  }

  const rows = Array.isArray(page?.data) ? page.data : [];
  // The API pages newest first; a conversation reads oldest first, top to bottom.
  const messages = rows.map((row) => normalizeMessage(row, viewerId, locale)).filter(Boolean).reverse();
  const pinned = (Array.isArray(pinnedRows) ? pinnedRows : [])
    .map((row) => normalizeMessage(row, viewerId, locale))
    .filter(Boolean);
  const pinnedIds = new Set(pinned.map((message) => message.id));
  messages.forEach((message) => { message.isPinned = pinnedIds.has(message.id); });

  const nextCursor = page?.meta?.has_more === true ? text(page.meta.cursor) : '';
  const banner = statusBanner(t, `${NS}.states`, req.query.status, SUCCESS_STATES, ERROR_STATES, ROOM_FIELD_FOR);

  return res.render('groups/channels/room', {
    title: room.name,
    group,
    room,
    messages,
    pinned,
    isChannelAdmin,
    canDeleteRoom: isChannelAdmin && !room.isDefault,
    olderHref: nextCursor ? `${roomPath(group.id, room.id)}?cursor=${encodeURIComponent(nextCursor)}` : '',
    latestHref: cursor ? roomPath(group.id, room.id) : '',
    statusBanner: banner,
    hasErrors: Boolean(banner && banner.type === 'error')
  });
}, PAGE_OPTIONS));

router.post('/:id(\\d+)/channels/:roomId(\\d+)/messages', requireAuth, asyncRoute(async (req, res) => {
  const context = await requireRoom(req, res);
  if (!context) return undefined;
  const { group, room } = context;
  const back = roomPath(group.id, room.id);

  const body = text(req.body?.body);
  if (body === '') return redirectWithStatus(res, back, 'body-required', '#message-body');
  if (body.length > BODY_MAX) return redirectWithStatus(res, back, 'body-too-long', '#message-body');

  try {
    await callGroupChatroomApi(req.token, 'POST', `/${encodeURIComponent(room.id)}/messages`, { body });
  } catch (error) {
    if (isAuthError(error)) return loginRedirect(res);
    if (error instanceof ApiError && error.status === 422 && apiErrorField(error) === 'body') {
      return redirectWithStatus(res, back, 'body-too-long', '#message-body');
    }
    return redirectWithStatus(res, back, failureStatus(error), '#message-body');
  }

  return redirectWithStatus(res, back, 'posted', '#latest');
}, PAGE_OPTIONS));

router.get('/:id(\\d+)/channels/:roomId(\\d+)/messages/:messageId(\\d+)/delete', requireAuth, asyncRoute(async (req, res) => {
  const context = await requireRoom(req, res);
  if (!context) return undefined;
  const { group, room } = context;
  const t = res.locals.t;
  return res.render('confirm-delete', {
    title: t(`${NS}.delete_message_title`),
    confirmHeading: t(`${NS}.delete_message_title`),
    confirmWarning: t('govuk_alpha_group_media.common.cannot_undo'),
    confirmButton: t(`${NS}.delete_message_confirm`),
    confirmAction: `${roomPath(group.id, room.id)}/messages/${req.params.messageId}/delete`,
    cancelHref: roomPath(group.id, room.id)
  });
}, PAGE_OPTIONS));

router.post('/:id(\\d+)/channels/:roomId(\\d+)/messages/:messageId(\\d+)/delete', requireAuth, asyncRoute(async (req, res) => {
  const context = await requireRoom(req, res);
  if (!context) return undefined;
  const { group, room } = context;
  const back = roomPath(group.id, room.id);
  try {
    await callGroupChatroomMessageApi(req.token, 'DELETE', `/${encodeURIComponent(req.params.messageId)}`);
  } catch (error) {
    if (isAuthError(error)) return loginRedirect(res);
    return redirectWithStatus(res, back, failureStatus(error));
  }
  return redirectWithStatus(res, back, 'message-deleted');
}, PAGE_OPTIONS));

function pinRoute(action) {
  return asyncRoute(async (req, res) => {
    const context = await requireRoom(req, res);
    if (!context) return undefined;
    const { group, room, isChannelAdmin } = context;
    if (!isChannelAdmin) return renderRefusal(res, 403);
    const back = roomPath(group.id, room.id);
    // Written out in full (not via a shared variable) so the API ledger can
    // match both calls to their Laravel routes.
    try {
      if (action === 'pin') {
        await callGroupApi(req.token, 'POST', `/${encodeURIComponent(group.id)}/chatrooms/${encodeURIComponent(room.id)}/pin/${encodeURIComponent(req.params.messageId)}`, {});
      } else {
        await callGroupApi(req.token, 'DELETE', `/${encodeURIComponent(group.id)}/chatrooms/${encodeURIComponent(room.id)}/pin/${encodeURIComponent(req.params.messageId)}`);
      }
    } catch (error) {
      if (isAuthError(error)) return loginRedirect(res);
      return redirectWithStatus(res, back, failureStatus(error));
    }
    return redirectWithStatus(res, back, action === 'pin' ? 'pinned' : 'unpinned');
  }, PAGE_OPTIONS);
}

router.post('/:id(\\d+)/channels/:roomId(\\d+)/messages/:messageId(\\d+)/pin', requireAuth, pinRoute('pin'));
router.post('/:id(\\d+)/channels/:roomId(\\d+)/messages/:messageId(\\d+)/unpin', requireAuth, pinRoute('unpin'));

router.get('/:id(\\d+)/channels/:roomId(\\d+)/delete', requireAuth, asyncRoute(async (req, res) => {
  const context = await requireRoom(req, res);
  if (!context) return undefined;
  const { group, room, isChannelAdmin } = context;
  if (!isChannelAdmin || room.isDefault) return renderRefusal(res, 403);
  const t = res.locals.t;
  return res.render('confirm-delete', {
    title: t(`${NS}.delete_channel_title`, { name: room.name }),
    confirmHeading: t(`${NS}.delete_channel_title`, { name: room.name }),
    confirmWarning: t(`${NS}.delete_channel_warning`),
    confirmButton: t(`${NS}.delete_channel_confirm`),
    confirmAction: `${roomPath(group.id, room.id)}/delete`,
    cancelHref: roomPath(group.id, room.id)
  });
}, PAGE_OPTIONS));

router.post('/:id(\\d+)/channels/:roomId(\\d+)/delete', requireAuth, asyncRoute(async (req, res) => {
  const context = await requireRoom(req, res);
  if (!context) return undefined;
  const { group, room, isChannelAdmin } = context;
  if (!isChannelAdmin || room.isDefault) return renderRefusal(res, 403);
  try {
    await callGroupChatroomApi(req.token, 'DELETE', `/${encodeURIComponent(room.id)}`);
  } catch (error) {
    if (isAuthError(error)) return loginRedirect(res);
    return redirectWithStatus(res, roomPath(group.id, room.id), failureStatus(error));
  }
  return res.redirect(`${urlFor(res, `/groups/${group.id}/channels`)}?status=deleted`);
}, PAGE_OPTIONS));

module.exports = router;
