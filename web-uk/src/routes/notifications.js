// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  getNotifications,
  getNotification,
  getGroupedNotifications,
  getNotificationUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  markNotificationGroupRead,
  deleteAllNotifications: deleteAllNotificationsApi,
  deleteNotification,
  ApiError
} = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { validateReturnUrl } = require('../lib/urlValidator');

const router = express.Router();
const NOTIFICATIONS_PATH = '/notifications';
const CATEGORY_COLOURS = Object.freeze({
  messages: 'blue',
  connections: 'purple',
  reviews: 'yellow',
  transactions: 'green',
  social: 'pink',
  events: 'turquoise',
  groups: 'orange',
  listings: 'blue',
  jobs: 'green',
  safeguarding: 'red',
  security: 'red',
  ideation: 'purple',
  system: 'grey',
  other: 'grey'
});

function dataFrom(result) {
  return result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'data')
    ? result.data
    : result;
}

function redirectTo(res, pathname) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return res.redirect(urlFor(pathname));
}

function boolFrom(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  return false;
}

function categoryFromType(value) {
  const type = typeof value === 'string' ? value.toLowerCase() : '';
  if (type.includes('message')) return 'messages';
  if (type.includes('connection') || type.includes('friend')) return 'connections';
  if (type.includes('review')) return 'reviews';
  if (type.includes('transaction') || type.includes('payment') || type.includes('credit')) return 'transactions';
  if (type.includes('event')) return 'events';
  if (type.includes('group')) return 'groups';
  if (type.includes('listing') || type.includes('match')) return 'listings';
  if (type.includes('job')) return 'jobs';
  if (type.includes('safeguard') || type.includes('broker')) return 'safeguarding';
  if (type.includes('security') || type.includes('password') || type.includes('2fa') || type.includes('passkey')) return 'security';
  if (type.includes('like') || type.includes('comment') || type.includes('reaction') || type.includes('mention') || type.includes('post')) return 'social';
  if (type.includes('idea')) return 'ideation';
  if (type === 'system' || type.includes('announce') || type.includes('welcome') || type.includes('badge') || type.includes('achievement') || type.includes('level')) return 'system';
  return 'other';
}

function normalizeNotifications(rows, t, formatRelativeTime) {
  return rows.map((notification) => {
    const grouped = boolFrom(notification.is_grouped);
    const read = grouped
      ? boolFrom(notification.all_read)
      : (Object.prototype.hasOwnProperty.call(notification, 'is_read')
        ? boolFrom(notification.is_read)
        : Boolean(notification.read_at));
    const category = categoryFromType(notification.type);

    const rawText = String(notification.message || notification.body || notification.title || '').trim();
    const translatedText = /^[a-z0-9_]+\.[a-z0-9_.]+$/.test(rawText) ? t(rawText) : rawText;

    return {
      ...notification,
      isGrouped: grouped,
      unread: !read,
      categoryLabel: t(`notifications.types.${category}`),
      categoryColour: CATEGORY_COLOURS[category] || CATEGORY_COLOURS.other,
      displayText: translatedText !== rawText ? translatedText : rawText,
      displayWhen: notification.created_at ? formatRelativeTime(notification.created_at) : ''
    };
  });
}

router.use(requireAuth);

// List notifications
router.get('/', asyncRoute(async (req, res) => {
  const showUnreadOnly = req.query.filter === 'unread' || req.query.unread_only === 'true';
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor.trim() : '';
  const notificationRequest = showUnreadOnly
    ? getNotifications(req.token, {
        per_page: 30,
        ...(cursor ? { cursor } : {}),
        unread_only: true
      })
    : getGroupedNotifications(req.token, {
        per_page: 30,
        ...(cursor ? { cursor } : {})
      });
  const [result, countResult] = await Promise.all([
    notificationRequest,
    getNotificationUnreadCount(req.token)
  ]);

  const notificationRows = Array.isArray(dataFrom(result)) ? dataFrom(result) : [];
  const notifications = normalizeNotifications(
    notificationRows,
    res.locals.t,
    res.locals.formatLocaleRelativeTime
  );
  const counts = dataFrom(countResult) || {};
  const unreadCount = Number(counts.total ?? counts.count ?? 0) || 0;
  const meta = result?.meta || {};

  res.render('notifications/index', {
    title: res.locals.t('notifications.title'),
    communityName: res.locals.tenantName || res.locals.serviceName || '',
    notifications,
    unreadCount,
    meta,
    showUnreadOnly,
    status: typeof req.query.status === 'string' ? req.query.status : '',
    successMessage: req.flash ? req.flash('success')[0] : null,
    // 🔴 Every POST in this file flashes an `error` on failure, and until
    // 2026-08-25 nothing rendered it — the page had a success banner and no
    // error banner at all. A failed "mark all as read" reloaded the inbox
    // unchanged and said nothing, which on a no-JS page a screen reader
    // announces as nothing happening rather than as a failure.
    errorMessage: req.flash ? req.flash('error')[0] : null
  });
}));

// Laravel accessible alias: mark a grouped notification bucket read.
router.post('/group/read', asyncRoute(async (req, res) => {
  const groupKey = typeof req.body.group_key === 'string' ? req.body.group_key.trim() : '';
  if (!groupKey) {
    return redirectTo(res, NOTIFICATIONS_PATH);
  }

  try {
    await markNotificationGroupRead(req.token, groupKey);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    if (req.flash) req.flash('error', res.locals.t('notifications.states.action-failed'));
    // 🔴 Return HERE. Falling through to the success `?status=` below told the
    // member "marked as read" while the notifications stayed unread — the sibling
    // POST /:id/read (below) already returns inside its catch; these two did not.
    return redirectTo(res, NOTIFICATIONS_PATH);
  }

  return redirectTo(res, `${NOTIFICATIONS_PATH}?status=group-marked-read`);
}));

// Mark single notification as read
router.post('/:id/read', asyncRoute(async (req, res) => {
  const { id } = req.params;
  // 🔴 The destination is resolved from the notification's OWN record, never from
  // the request. This route used to accept a `redirect` path in the body — a
  // client-supplied redirect target that nothing ever sent (template-source.test.js
  // forbids emitting one), leaving an open-redirect surface with no caller. The
  // form now posts only the flag `follow=1`; the server looks up where that
  // notification points, so a crafted request cannot choose the destination.
  const follow = boolFrom(req.body.follow);

  try {
    await markNotificationRead(req.token, id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    if (req.flash) req.flash('error', res.locals.t('notifications.states.action-failed'));
    return redirectTo(res, NOTIFICATIONS_PATH);
  }

  if (follow) {
    // A failure here must not lose the successful mark-as-read, so it falls back
    // to the inbox rather than surfacing an error.
    const target = await getNotification(req.token, id)
      .then((result) => {
        const row = dataFrom(result) || {};
        return typeof row.link === 'string' ? row.link : '';
      })
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401) throw error;
        return '';
      });
    // 🔴 Validate against an EMPTY fallback, not NOTIFICATIONS_PATH. With the
    // inbox as the fallback a refused off-site link returned right here, so the
    // member landed on a silent inbox with no word that the mark-as-read had
    // actually succeeded. An empty result now falls through to the announced
    // redirect below, which is the same outcome the plain button gives.
    const safeTarget = validateReturnUrl(target, '');
    if (safeTarget) {
      return redirectTo(res, safeTarget);
    }
  }

  // 🔴 Announce it. `notification-marked-read` and its eleven translations have
  // existed since this page was written, and index.njk already whitelisted the
  // status — the redirect just never carried it, so marking ONE notification
  // read was the only action on this page that confirmed nothing. Its four
  // siblings (read-all, delete, delete-all, group/read) all announce.
  redirectTo(res, `${NOTIFICATIONS_PATH}?status=notification-marked-read`);
}));

// Mark all notifications as read
router.post('/read-all', asyncRoute(async (req, res) => {
  try {
    const result = await markAllNotificationsRead(req.token);

    if (req.flash) {
      const payload = dataFrom(result) || {};
      const count = payload.marked_read || payload.markedCount || payload.marked_count || 0;
      req.flash('success', res.locals.t('notifications.states.marked-read', { count }));
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    if (req.flash) req.flash('error', res.locals.t('notifications.states.action-failed'));
  }

  redirectTo(res, NOTIFICATIONS_PATH);
}));

// Laravel accessible alias: delete every notification for the signed-in user.
router.post('/delete-all', asyncRoute(async (req, res) => {
  try {
    await deleteAllNotificationsApi(req.token);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    if (req.flash) req.flash('error', res.locals.t('notifications.states.action-failed'));
    // 🔴 Return HERE — see the note on group/read above. Without it a failed delete
    // still announced "all notifications deleted".
    return redirectTo(res, NOTIFICATIONS_PATH);
  }

  return redirectTo(res, `${NOTIFICATIONS_PATH}?status=all-notifications-deleted`);
}));

// Delete notification
router.post('/:id/delete', asyncRoute(async (req, res) => {
  const { id } = req.params;

  try {
    await deleteNotification(req.token, id);

    if (req.flash) {
      req.flash('success', res.locals.t('notifications.states.notification-deleted'));
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    if (req.flash) req.flash('error', res.locals.t('notifications.states.action-failed'));
  }

  redirectTo(res, NOTIFICATIONS_PATH);
}));

module.exports = router;
