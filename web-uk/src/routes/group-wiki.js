// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Group wiki — list, read, create, edit, delete (with a confirmation page),
 * revision history (React pages/groups/api/wiki.ts, tabs/GroupWikiTab.tsx).
 * Section rule `wiki`: the community's `tab_wiki` switch and an active member or
 * group admin. Members create and edit (the API limits editing to the page's
 * author, last editor or a group admin, and answers 403 otherwise); delete is a
 * group-admin action, as on the website. Content is plain text, shown with its
 * line breaks, exactly as the website shows it.
 *
 * Pages are addressed by slug. Writes look the page up by slug first and use the
 * id the server returns, so a posted id is never trusted.
 */

const express = require('express');
const { callGroupApi, ApiError } = require('../lib/api');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute } = require('../lib/routeHelpers');
const { requireGroupTool, renderRefusal } = require('../lib/group-tool-access');
const {
  NS, text, positiveInteger, collectionFrom, objectFrom, isAuthError,
  redirectWithStatus, loginRedirect, translator, statusBanner, dateTimeLabel
} = require('../lib/group-tool-helpers');

const router = express.Router();

const SLUG = '[A-Za-z0-9][A-Za-z0-9_-]{0,190}';
const STATUS_CODES = {
  created: { type: 'success', key: 'wiki.created' },
  saved: { type: 'success', key: 'wiki.saved' },
  deleted: { type: 'success', key: 'wiki.deleted' },
  'delete-failed': { type: 'error', key: 'wiki.delete_failed' }
};
const AUTH = { redirectOn401: '/login?status=auth-required', notFoundTitle: 'Page not found' };

function wikiPath(id, slug = null, suffix = '') {
  return slug ? `/groups/${id}/wiki/page/${encodeURIComponent(slug)}${suffix}` : `/groups/${id}/wiki`;
}

function normalizePage(item) {
  const raw = item && typeof item === 'object' ? item : {};
  const author = raw.author && typeof raw.author === 'object' ? raw.author : {};
  return {
    id: positiveInteger(raw.id),
    title: text(raw.title),
    slug: text(raw.slug),
    parentId: positiveInteger(raw.parent_id),
    isPublished: raw.is_published === true || raw.is_published === 1,
    authorName: text(author.name),
    updatedAtLabel: dateTimeLabel(raw.updated_at),
    content: typeof raw.content === 'string' ? raw.content : ''
  };
}

function normalizeRevision(item) {
  const raw = item && typeof item === 'object' ? item : {};
  const editor = raw.editor && typeof raw.editor === 'object' ? raw.editor : {};
  return {
    id: positiveInteger(raw.id),
    summary: text(raw.change_summary),
    editorName: text(editor.name),
    createdAtLabel: dateTimeLabel(raw.created_at)
  };
}

/** Order pages as a tree (parents first, children indented under them). */
function orderPages(pages) {
  const byParent = new Map();
  for (const page of pages) {
    const key = page.parentId && pages.some((p) => p.id === page.parentId) ? page.parentId : 0;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(page);
  }
  const ordered = [];
  const visit = (parentKey, depth) => {
    for (const page of byParent.get(parentKey) || []) {
      if (ordered.some((p) => p.id === page.id)) continue;
      ordered.push({ ...page, depth: Math.min(depth, 3) });
      visit(page.id, depth + 1);
    }
  };
  visit(0, 0);
  return ordered;
}

async function loadPages(req, groupId) {
  const result = await callGroupApi(req.token, 'GET', `/${encodeURIComponent(groupId)}/wiki`);
  return orderPages(collectionFrom(result, 'pages').map(normalizePage).filter((page) => page.id !== null && page.slug));
}

async function loadPage(req, groupId, slug) {
  const page = normalizePage(objectFrom(await callGroupApi(req.token, 'GET', `/${encodeURIComponent(groupId)}/wiki/${encodeURIComponent(slug)}`)));
  return page.id === null ? null : page;
}

function notFound(res) {
  return renderRefusal(res, 404);
}

router.get('/:id(\\d+)/wiki', requireAuth, asyncRoute(async (req, res) => {
  const access = await requireGroupTool(req, res, 'wiki');
  if (!access) return undefined;
  const { group } = access;
  let loadFailed = false;
  const pages = await loadPages(req, group.id).catch((error) => {
    if (isAuthError(error) || (error instanceof ApiError && [403, 404].includes(error.status))) throw error;
    loadFailed = true;
    return [];
  });
  return res.render('groups/wiki/index', {
    title: translator(res)(`${NS}.wiki.title`),
    activeNav: 'explore',
    group,
    pages,
    loadFailed,
    statusBanner: statusBanner(res, req.query.status, STATUS_CODES)
  });
}, AUTH));

function renderCreate(res, group, pages, values = {}, errors = {}, statusCode = 200, failed = false) {
  const t = translator(res);
  return res.status(statusCode).render('groups/wiki/new', {
    title: t(`${NS}.wiki.create_title`),
    activeNav: 'explore',
    group,
    values,
    errors,
    errorList: Object.entries(errors).map(([field, message]) => ({ text: message, href: `#${field}` })),
    parentOptions: [{ value: '', text: t(`${NS}.wiki.no_parent`) }].concat(pages.map((page) => ({
      value: String(page.id),
      text: `${'— '.repeat(page.depth || 0)}${page.title}`,
      selected: String(values.parent_id || '') === String(page.id)
    }))),
    statusBanner: failed ? { type: 'error', message: t(`${NS}.wiki.create_failed`) } : null
  });
}

router.get('/:id(\\d+)/wiki/new', requireAuth, asyncRoute(async (req, res) => {
  const access = await requireGroupTool(req, res, 'wiki');
  if (!access) return undefined;
  const pages = await loadPages(req, access.group.id).catch((error) => {
    if (isAuthError(error)) throw error;
    return [];
  });
  return renderCreate(res, access.group, pages);
}, AUTH));

router.post('/:id(\\d+)/wiki/new', requireAuth, asyncRoute(async (req, res) => {
  const access = await requireGroupTool(req, res, 'wiki');
  if (!access) return undefined;
  const { group } = access;
  const t = translator(res);
  const values = {
    title: text(req.body.title, 255),
    content: String(req.body.content ?? '').slice(0, 100000),
    parent_id: positiveInteger(req.body.parent_id)
  };
  const errors = {};
  if (!values.title) errors.title = t(`${NS}.wiki.title_required`);
  if (!values.content.trim()) errors.content = t(`${NS}.wiki.content_required`);
  if (Object.keys(errors).length) {
    const pages = await loadPages(req, group.id).catch(() => []);
    return renderCreate(res, group, pages, values, errors, 422);
  }

  const payload = { title: values.title, content: values.content };
  if (values.parent_id) payload.parent_id = values.parent_id;
  try {
    const created = normalizePage(objectFrom(await callGroupApi(req.token, 'POST', `/${encodeURIComponent(group.id)}/wiki`, payload)));
    return redirectWithStatus(res, created.slug ? wikiPath(group.id, created.slug) : wikiPath(group.id), 'created');
  } catch (error) {
    if (isAuthError(error)) return loginRedirect(res);
    const pages = await loadPages(req, group.id).catch(() => []);
    return renderCreate(res, group, pages, values, {}, 200, true);
  }
}, AUTH));

function slugParam(req) {
  const slug = String(req.params.slug || '');
  return new RegExp(`^${SLUG}$`).test(slug) ? slug : null;
}

router.get(`/:id(\\d+)/wiki/page/:slug([A-Za-z0-9_-]+)`, requireAuth, asyncRoute(async (req, res) => {
  const slug = slugParam(req);
  if (!slug) return notFound(res);
  const access = await requireGroupTool(req, res, 'wiki');
  if (!access) return undefined;
  const { group, isAdmin } = access;
  const page = await loadPage(req, group.id, slug);
  if (!page) return notFound(res);
  return res.render('groups/wiki/page', {
    title: page.title,
    activeNav: 'explore',
    group,
    page,
    canDelete: isAdmin,
    statusBanner: statusBanner(res, req.query.status, STATUS_CODES)
  });
}, AUTH));

function renderEdit(res, group, page, values, errors = {}, statusCode = 200, failed = false) {
  const t = translator(res);
  return res.status(statusCode).render('groups/wiki/edit', {
    title: t(`${NS}.wiki.edit_heading`, { title: page.title }),
    activeNav: 'explore',
    group,
    page,
    values,
    errors,
    errorList: Object.entries(errors).map(([field, message]) => ({ text: message, href: `#${field}` })),
    statusBanner: failed ? { type: 'error', message: t(`${NS}.wiki.save_failed`) } : null
  });
}

router.get(`/:id(\\d+)/wiki/page/:slug([A-Za-z0-9_-]+)/edit`, requireAuth, asyncRoute(async (req, res) => {
  const slug = slugParam(req);
  if (!slug) return notFound(res);
  const access = await requireGroupTool(req, res, 'wiki');
  if (!access) return undefined;
  const page = await loadPage(req, access.group.id, slug);
  if (!page) return notFound(res);
  return renderEdit(res, access.group, page, { content: page.content, change_summary: '' });
}, AUTH));

router.post(`/:id(\\d+)/wiki/page/:slug([A-Za-z0-9_-]+)/edit`, requireAuth, asyncRoute(async (req, res) => {
  const slug = slugParam(req);
  if (!slug) return notFound(res);
  const access = await requireGroupTool(req, res, 'wiki');
  if (!access) return undefined;
  const { group } = access;
  const page = await loadPage(req, group.id, slug);
  if (!page) return notFound(res);
  const t = translator(res);
  const values = {
    content: String(req.body.content ?? '').slice(0, 100000),
    change_summary: text(req.body.change_summary, 255)
  };
  if (!values.content.trim()) {
    return renderEdit(res, group, page, values, { content: t(`${NS}.wiki.content_required`) }, 422);
  }
  const payload = { content: values.content };
  if (values.change_summary) payload.change_summary = values.change_summary;
  try {
    await callGroupApi(req.token, 'PUT', `/${encodeURIComponent(group.id)}/wiki/${encodeURIComponent(page.id)}`, payload);
    return redirectWithStatus(res, wikiPath(group.id, page.slug || slug), 'saved');
  } catch (error) {
    if (isAuthError(error)) return loginRedirect(res);
    return renderEdit(res, group, page, values, {}, 200, true);
  }
}, AUTH));

router.get(`/:id(\\d+)/wiki/page/:slug([A-Za-z0-9_-]+)/delete`, requireAuth, asyncRoute(async (req, res) => {
  const slug = slugParam(req);
  if (!slug) return notFound(res);
  const access = await requireGroupTool(req, res, 'wiki');
  if (!access) return undefined;
  if (!access.isAdmin) return renderRefusal(res, 403);
  const page = await loadPage(req, access.group.id, slug);
  if (!page) return notFound(res);
  return res.render('groups/wiki/delete', {
    title: translator(res)(`${NS}.wiki.delete_title`),
    activeNav: 'explore',
    group: access.group,
    page
  });
}, AUTH));

router.post(`/:id(\\d+)/wiki/page/:slug([A-Za-z0-9_-]+)/delete`, requireAuth, asyncRoute(async (req, res) => {
  const slug = slugParam(req);
  if (!slug) return notFound(res);
  const access = await requireGroupTool(req, res, 'wiki');
  if (!access) return undefined;
  if (!access.isAdmin) return renderRefusal(res, 403);
  const { group } = access;
  const page = await loadPage(req, group.id, slug);
  if (!page) return notFound(res);
  try {
    await callGroupApi(req.token, 'DELETE', `/${encodeURIComponent(group.id)}/wiki/${encodeURIComponent(page.id)}`);
    return redirectWithStatus(res, wikiPath(group.id), 'deleted');
  } catch (error) {
    if (isAuthError(error)) return loginRedirect(res);
    return redirectWithStatus(res, wikiPath(group.id, page.slug || slug), 'delete-failed');
  }
}, AUTH));

router.get(`/:id(\\d+)/wiki/page/:slug([A-Za-z0-9_-]+)/history`, requireAuth, asyncRoute(async (req, res) => {
  const slug = slugParam(req);
  if (!slug) return notFound(res);
  const access = await requireGroupTool(req, res, 'wiki');
  if (!access) return undefined;
  const { group } = access;
  const page = await loadPage(req, group.id, slug);
  if (!page) return notFound(res);
  let loadFailed = false;
  const revisions = await callGroupApi(req.token, 'GET', `/${encodeURIComponent(group.id)}/wiki/${encodeURIComponent(page.id)}/revisions`)
    .then((result) => collectionFrom(result, 'revisions').map(normalizeRevision).filter((rev) => rev.id !== null))
    .catch((error) => {
      if (isAuthError(error)) throw error;
      loadFailed = true;
      return [];
    });
  return res.render('groups/wiki/history', {
    title: translator(res)(`${NS}.wiki.revision_history`),
    activeNav: 'explore',
    group,
    page,
    revisions,
    loadFailed
  });
}, AUTH));

module.exports = router;
