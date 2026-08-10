// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  getNotifications,
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
    successMessage: req.flash ? req.flash('success')[0] : null
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
    if (req.flash) req.flash('error', error.message || 'Unable to mark grouped notifications as read');
  }

  return redirectTo(res, `${NOTIFICATIONS_PATH}?status=group-marked-read`);
}));

// Mark single notification as read
router.post('/:id/read', asyncRoute(async (req, res) => {
  const { id } = req.params;
  const { redirect } = req.body;

  try {
    await markNotificationRead(req.token, id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    if (req.flash) req.flash('error', error.message || 'Unable to mark notification as read');
    return redirectTo(res, NOTIFICATIONS_PATH);
  }

  // If redirect URL provided, validate it to prevent open redirect attacks
  if (redirect) {
    const safeRedirect = validateReturnUrl(redirect, NOTIFICATIONS_PATH);
    return redirectTo(res, safeRedirect);
  }

  redirectTo(res, NOTIFICATIONS_PATH);
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
    if (req.flash) req.flash('error', error.message || 'Unable to mark notifications as read');
  }

  redirectTo(res, NOTIFICATIONS_PATH);
}));

// Laravel accessible alias: delete every notification for the signed-in user.
router.post('/delete-all', asyncRoute(async (req, res) => {
  try {
    await deleteAllNotificationsApi(req.token);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    if (req.flash) req.flash('error', error.message || 'Unable to delete notifications');
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
    if (req.flash) req.flash('error', error.message || 'Unable to delete notification');
  }

  redirectTo(res, NOTIFICATIONS_PATH);
}));

module.exports = router;
