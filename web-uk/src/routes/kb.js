// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const {
  ApiError,
  getKnowledgeBaseArticles,
  getKnowledgeBaseArticle,
  submitKnowledgeBaseFeedback,
  downloadKnowledgeBaseAttachment
} = require('../lib/api');
const { sanitizeCmsHtml } = require('../lib/html-sanitizer');
const { asyncRoute } = require('../lib/routeHelpers');

const router = express.Router();

const FEEDBACK_STATUSES = Object.freeze({
  'feedback-saved': { type: 'success', key: 'govuk_alpha_kb.feedback_thanks' },
  'feedback-failed': { type: 'error', key: 'govuk_alpha_kb.feedback_failed' }
});

function tokenFrom(req) {
  return (req.signedCookies && req.signedCookies.token) || '';
}

function redirectTo(res, pathname) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return res.redirect(urlFor(pathname));
}

function trimmed(value, limit = null) {
  const text = String(value || '').trim();
  return limit === null ? text : text.slice(0, limit);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function dataFrom(result) {
  return result && typeof result === 'object' && result.data !== undefined ? result.data : result;
}

function rowsFrom(result) {
  const data = dataFrom(result);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

function metaFrom(result) {
  if (result && typeof result === 'object' && result.meta && typeof result.meta === 'object') return result.meta;
  const data = dataFrom(result);
  if (data && data.meta && typeof data.meta === 'object') return data.meta;
  return {};
}

function communityName(res) {
  const tenant = res.locals.tenant || {};
  return trimmed(tenant.name) || trimmed(tenant.slug) || 'Project NEXUS Accessible';
}

function normalizeArticleSummary(item, t, tc) {
  const row = item && typeof item === 'object' ? item : {};
  const views = Number.isFinite(Number(row.views_count ?? row.viewsCount))
    ? Number(row.views_count ?? row.viewsCount)
    : 0;

  return {
    id: positiveInteger(row.id),
    title: trimmed(row.title) || t('kb.title'),
    contentPreview: trimmed(row.content_preview ?? row.contentPreview ?? row.summary ?? row.excerpt),
    categoryName: trimmed(row.category_name ?? row.categoryName),
    viewsCount: views,
    viewsLabel: tc('kb.views', views, { count: views })
  };
}

function normalizeArticle(result, fallbackId, t) {
  const row = dataFrom(result) || {};
  const author = row.author && typeof row.author === 'object' ? row.author : {};
  const children = Array.isArray(row.children) ? row.children : [];
  const attachments = Array.isArray(row.attachments) ? row.attachments : [];
  const id = positiveInteger(row.id) || fallbackId;

  return {
    id,
    title: trimmed(row.title) || t('kb.title'),
    content: sanitizeCmsHtml(row.content),
    updatedAt: trimmed(row.updated_at ?? row.updatedAt ?? row.created_at ?? row.createdAt),
    authorName: trimmed(author.name),
    children: children
      .map((child) => ({
        id: positiveInteger(child && child.id),
        title: trimmed(child && child.title) || t('kb.related_title')
      }))
      .filter((child) => child.id !== null),
    // "Was this helpful?" (React KBArticlePage): the counts and the member's own
    // earlier answer (true / false / null).
    helpfulYes: nonNegativeInteger(row.helpful_yes),
    helpfulNo: nonNegativeInteger(row.helpful_no),
    myFeedback: row.my_feedback === true || row.my_feedback === false ? row.my_feedback : null,
    // Attachments are downloaded through web-uk, so the member's bearer token
    // never has to reach the browser.
    attachments: attachments
      .map((attachment) => ({
        id: positiveInteger(attachment && attachment.id),
        fileName: trimmed(attachment && attachment.file_name, 255),
      }))
      .filter((attachment) => attachment.id !== null && attachment.fileName)
      .map((attachment) => ({ ...attachment, href: `/kb/${id}/attachments/${attachment.id}` }))
  };
}

function listParams(query) {
  const search = trimmed(query.q);
  if (search) return { q: search, limit: 20 };

  const params = { per_page: 12 };
  const cursor = trimmed(query.cursor);
  if (cursor) params.cursor = cursor;
  const categoryId = positiveInteger(query.category);
  if (categoryId) params.category_id = categoryId;
  return params;
}

// Category choices. React KnowledgeBasePage builds its tabs from the articles it
// has loaded, and so does the unfiltered index here. Once a category is chosen
// the list holds only that category, so one wide page is read to keep the other
// choices on offer. Only categories with an id can be filtered by the API.
function categoriesFrom(rows) {
  const categories = new Map();
  rows.forEach((row) => {
    const id = positiveInteger(row && (row.category_id ?? row.categoryId));
    const name = trimmed(row && (row.category_name ?? row.categoryName));
    if (!id || !name) return;
    const current = categories.get(id) || { id, name, count: 0 };
    current.count += 1;
    categories.set(id, current);
  });
  return [...categories.values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((category) => ({ ...category, label: category.name }));
}

async function allCategories(token) {
  try {
    return categoriesFrom(rowsFrom(await getKnowledgeBaseArticles(token, { per_page: 100 })));
  } catch {
    return [];
  }
}

router.get('/', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  const params = listParams(req.query);
  const activeCategory = params.category_id || null;
  const [result, wideCategories] = await Promise.all([
    getKnowledgeBaseArticles(token, params),
    activeCategory ? allCategories(token) : Promise.resolve(null)
  ]);
  const categories = params.q ? [] : (wideCategories || categoriesFrom(rowsFrom(result)));
  const meta = metaFrom(result);
  const searchQuery = trimmed(req.query.q);
  const nextCursor = trimmed(meta.cursor);
  const hasMore = Boolean(meta.has_more ?? meta.hasMore);

  return res.render('kb/index', {
    title: res.locals.t('kb.title'),
    activeNav: 'kb',
    communityName: communityName(res),
    articles: rowsFrom(result).map((article) => normalizeArticleSummary(article, res.locals.t, res.locals.tc)).filter((article) => article.id !== null),
    searchQuery,
    categories: categories.length > 1 ? categories : [],
    activeCategory,
    hasMore,
    nextCursor,
    nextHref: hasMore && nextCursor
      ? `/kb?${new URLSearchParams({
        ...(searchQuery ? { q: searchQuery } : {}),
        ...(activeCategory ? { category: String(activeCategory) } : {}),
        cursor: nextCursor
      }).toString()}`
      : ''
  });
}));

router.get('/:id(\\d+)', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  const id = Number(req.params.id);
  let article;
  try {
    article = normalizeArticle(await getKnowledgeBaseArticle(token, id), id, res.locals.t);
  } catch (error) {
    if (error && error.status === 404) {
      return res.status(404).render('errors/404', {
        title: res.locals.t('kb.not_found_title'),
        errorTitle: res.locals.t('kb.not_found_title'),
        errorMessage: res.locals.t('kb.not_found_body')
      });
    }
    throw error;
  }

  const statusKey = typeof req.query.status === 'string' ? req.query.status : '';
  const statusEntry = FEEDBACK_STATUSES[statusKey];

  return res.render('kb/article', {
    title: article.title,
    activeNav: 'kb',
    communityName: communityName(res),
    article,
    feedbackStatus: statusEntry ? { type: statusEntry.type, message: res.locals.t(statusEntry.key) } : null,
    csrfToken: req.csrfToken ? req.csrfToken() : res.locals.csrfToken
  });
}));

// "Was this helpful?" (React KBArticlePage).
router.post('/:id(\\d+)/feedback', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  const id = Number(req.params.id);
  const answer = trimmed(req.body && req.body.helpful);
  if (!['yes', 'no'].includes(answer)) {
    return redirectTo(res, `/kb/${id}?status=feedback-failed#feedback`);
  }

  try {
    await submitKnowledgeBaseFeedback(token, id, answer === 'yes');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return redirectTo(res, '/login?status=auth-required');
    }
    return redirectTo(res, `/kb/${id}?status=feedback-failed#feedback`);
  }
  return redirectTo(res, `/kb/${id}?status=feedback-saved#feedback`);
}));

// An article attachment, streamed from the API with the member's token.
router.get('/:id(\\d+)/attachments/:attachmentId(\\d+)', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  let download;
  try {
    download = await downloadKnowledgeBaseAttachment(token, Number(req.params.id), Number(req.params.attachmentId));
  } catch (error) {
    if (error && error.status === 404) {
      return res.status(404).render('errors/404', {
        title: res.locals.t('kb.not_found_title'),
        errorTitle: res.locals.t('kb.not_found_title'),
        errorMessage: res.locals.t('kb.not_found_body')
      });
    }
    throw error;
  }

  const headers = download.headers || {};
  ['content-type', 'content-disposition', 'content-length'].forEach((name) => {
    if (headers[name]) res.set(name, headers[name]);
  });
  res.set('Cache-Control', 'private, no-store');
  return res.status(download.status || 200).send(download.body);
}));

module.exports = router;
