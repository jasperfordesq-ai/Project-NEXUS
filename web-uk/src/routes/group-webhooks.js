// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Group webhooks: /groups/:id/webhooks (parity with the website's webhook panel,
 * react-frontend/src/pages/groups/components/WebhookConfigPanel.tsx in the
 * admin-only Automation tab, 27 Oct 2026).
 *
 * - GET  /groups/:id/webhooks                   list (group admins)
 * - GET  /groups/:id/webhooks/new               add form
 * - POST /groups/:id/webhooks/new               add
 * - POST /groups/:id/webhooks/:webhookId/toggle pause / turn on (posts the wanted state)
 * - GET  /groups/:id/webhooks/:webhookId/delete confirmation page
 * - POST /groups/:id/webhooks/:webhookId/delete delete
 *
 * The website offers no "send a test" action, so neither does this page. The
 * optional signing secret goes to the API once and is never shown again: the
 * list endpoint does not return it, a failed form never refills it, and nothing
 * here logs it.
 *
 * Contract: GroupWebhookController (GroupAccessService::canIntegrate — a group
 * manager of an active group). Events are GroupWebhookService::SUPPORTED_EVENTS.
 */

const express = require('express');
const { URL } = require('node:url');
const { callGroupApi, ApiError } = require('../lib/api');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute } = require('../lib/routeHelpers');
const { requireGroupSection, renderRefusal } = require('../lib/group-media-access');
const { getRequestIntlLocale } = require('../lib/request-intl-locale');
const {
  text,
  positiveInteger,
  dataFrom,
  redirectWithStatus,
  isAuthError,
  loginRedirect,
  statusBanner,
  dateTimeLabel
} = require('../lib/group-media-pages');

const router = express.Router();

const NS = 'govuk_alpha_group_media.webhooks';
const EVENTS = ['member.joined', 'member.left', 'discussion.created', 'post.created', 'file.uploaded'];
const PAGE_OPTIONS = { redirectOn401: '/login?status=auth-required' };
const SUCCESS_STATES = new Set(['created', 'deleted', 'enabled', 'disabled']);
const ERROR_STATES = new Set(['toggle-failed', 'delete-failed']);

function eventKey(event) {
  return `${NS}.events.${event.replace('.', '_')}`;
}

function normalizeWebhook(raw, t, locale) {
  const hook = raw && typeof raw === 'object' ? raw : {};
  const id = positiveInteger(hook.id);
  if (id === null) return null;
  const events = (Array.isArray(hook.events) ? hook.events : []).map((value) => text(value)).filter((event) => EVENTS.includes(event));
  return {
    id,
    url: text(hook.url),
    eventLabels: events.map((event) => t(eventKey(event))),
    isActive: hook.is_active === true || hook.is_active === 1 || hook.is_active === '1',
    failureCount: Math.max(0, Number(hook.failure_count) || 0),
    lastFiredLabel: dateTimeLabel(hook.last_fired_at, locale)
  };
}

async function loadWebhooks(req, res, group) {
  const t = res.locals.t;
  const locale = getRequestIntlLocale();
  const rows = dataFrom(await callGroupApi(req.token, 'GET', `/${encodeURIComponent(group.id)}/webhooks`));
  return (Array.isArray(rows) ? rows : []).map((row) => normalizeWebhook(row, t, locale)).filter(Boolean);
}

function isWebAddress(value) {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname !== '';
  } catch {
    return false;
  }
}

function postedEvents(value) {
  const list = Array.isArray(value) ? value : (value === undefined ? [] : [value]);
  return [...new Set(list.map((value) => text(value)).filter((event) => EVENTS.includes(event)))];
}

function renderForm(res, group, values, errors = {}, generalError = '') {
  const t = res.locals.t;
  const errorList = Object.entries(errors).map(([field, message]) => ({ text: message, href: `#${field}` }));
  if (generalError) errorList.unshift({ text: generalError });
  return res.status(errorList.length ? 422 : 200).render('groups/webhooks/new', {
    title: t(`${NS}.new_title`),
    group,
    values,
    fieldErrors: errors,
    errorList,
    hasErrors: errorList.length > 0,
    eventItems: EVENTS.map((event) => ({ value: event, text: t(eventKey(event)), checked: values.events.includes(event) }))
  });
}

router.get('/:id(\\d+)/webhooks', requireAuth, asyncRoute(async (req, res) => {
  const access = await requireGroupSection(req, res, 'automation');
  if (!access) return undefined;
  const { group } = access;
  const t = res.locals.t;

  let webhooks;
  try {
    webhooks = await loadWebhooks(req, res, group);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return renderRefusal(res, 403);
    throw error;
  }
  const banner = statusBanner(t, `${NS}.states`, req.query.status, SUCCESS_STATES, ERROR_STATES);

  return res.render('groups/webhooks/index', {
    title: t(`${NS}.title`),
    group,
    webhooks,
    statusBanner: banner,
    hasErrors: Boolean(banner && banner.type === 'error')
  });
}, PAGE_OPTIONS));

router.get('/:id(\\d+)/webhooks/new', requireAuth, asyncRoute(async (req, res) => {
  const access = await requireGroupSection(req, res, 'automation');
  if (!access) return undefined;
  return renderForm(res, access.group, { url: '', events: [] });
}, PAGE_OPTIONS));

router.post('/:id(\\d+)/webhooks/new', requireAuth, asyncRoute(async (req, res) => {
  const access = await requireGroupSection(req, res, 'automation');
  if (!access) return undefined;
  const { group } = access;
  const t = res.locals.t;

  // The secret is read here and passed straight on; it is never put back in a page.
  const values = { url: text(req.body?.url, 2000), events: postedEvents(req.body?.events) };
  const secret = String(req.body?.secret ?? '').trim();

  const errors = {};
  if (values.url === '') errors.url = t(`${NS}.errors.url_required`);
  else if (!isWebAddress(values.url)) errors.url = t(`${NS}.errors.url_invalid`);
  if (values.events.length === 0) errors['events'] = t(`${NS}.errors.events_required`);
  if (Object.keys(errors).length) return renderForm(res, group, values, errors);

  const payload = { url: values.url, events: values.events };
  if (secret) payload.secret = secret;

  try {
    await callGroupApi(req.token, 'POST', `/${encodeURIComponent(group.id)}/webhooks`, payload);
  } catch (error) {
    if (isAuthError(error)) return loginRedirect(res);
    if (error instanceof ApiError && error.status === 403) return renderRefusal(res, 403);
    const message = error instanceof ApiError && error.status === 422 && text(error.message)
      ? text(error.message)
      : t(`${NS}.states.create-failed`);
    return renderForm(res, group, values, {}, message);
  }

  return redirectWithStatus(res, `/groups/${group.id}/webhooks`, 'created');
}, PAGE_OPTIONS));

router.post('/:id(\\d+)/webhooks/:webhookId(\\d+)/toggle', requireAuth, asyncRoute(async (req, res) => {
  const access = await requireGroupSection(req, res, 'automation');
  if (!access) return undefined;
  const { group } = access;
  const back = `/groups/${group.id}/webhooks`;
  const wanted = ['1', 'true', 'on'].includes(text(req.body?.is_active).toLowerCase());

  try {
    await callGroupApi(req.token, 'PUT', `/${encodeURIComponent(group.id)}/webhooks/${encodeURIComponent(req.params.webhookId)}/toggle`, { is_active: wanted });
  } catch (error) {
    if (isAuthError(error)) return loginRedirect(res);
    if (error instanceof ApiError && error.status === 403) return renderRefusal(res, 403);
    return redirectWithStatus(res, back, 'toggle-failed');
  }
  return redirectWithStatus(res, back, wanted ? 'enabled' : 'disabled');
}, PAGE_OPTIONS));

router.get('/:id(\\d+)/webhooks/:webhookId(\\d+)/delete', requireAuth, asyncRoute(async (req, res) => {
  const access = await requireGroupSection(req, res, 'automation');
  if (!access) return undefined;
  const { group } = access;
  const t = res.locals.t;
  const webhookId = Number(req.params.webhookId);
  const webhook = (await loadWebhooks(req, res, group)).find((hook) => hook.id === webhookId);
  if (!webhook) return renderRefusal(res, 404);

  return res.render('confirm-delete', {
    title: t(`${NS}.delete_title`),
    confirmHeading: t(`${NS}.delete_title`),
    confirmWarning: t(`${NS}.delete_warning`, { url: webhook.url }),
    confirmButton: t(`${NS}.delete_confirm`),
    confirmAction: `/groups/${group.id}/webhooks/${webhookId}/delete`,
    cancelHref: `/groups/${group.id}/webhooks`
  });
}, PAGE_OPTIONS));

router.post('/:id(\\d+)/webhooks/:webhookId(\\d+)/delete', requireAuth, asyncRoute(async (req, res) => {
  const access = await requireGroupSection(req, res, 'automation');
  if (!access) return undefined;
  const { group } = access;
  const back = `/groups/${group.id}/webhooks`;
  try {
    await callGroupApi(req.token, 'DELETE', `/${encodeURIComponent(group.id)}/webhooks/${encodeURIComponent(req.params.webhookId)}`);
  } catch (error) {
    if (isAuthError(error)) return loginRedirect(res);
    if (error instanceof ApiError && error.status === 403) return renderRefusal(res, 403);
    return redirectWithStatus(res, back, 'delete-failed');
  }
  return redirectWithStatus(res, back, 'deleted');
}, PAGE_OPTIONS));

module.exports = router;
