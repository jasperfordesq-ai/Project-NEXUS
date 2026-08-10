// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const fs = require('fs/promises');
const {
  getResources,
  getResourceCategories,
  getResourceCategoryTree,
  getComments,
  getReactionSummary,
  uploadResource,
  downloadResource,
  deleteResource,
  reorderResources,
  createComment,
  deleteComment,
  toggleReaction,
  ApiError
} = require('../lib/api');
const { asyncRoute, handleApiError } = require('../lib/routeHelpers');
const { getRequestProfile } = require('../lib/request-profile');

const router = express.Router();
const RESOURCE_REACTIONS = new Set(['like', 'love', 'laugh', 'wow', 'sad', 'celebrate']);
const RESOURCE_REACTION_EMOJI = {
  like: '\u{1F44D}',
  love: '\u2764\uFE0F',
  laugh: '\u{1F602}',
  wow: '\u{1F62E}',
  sad: '\u{1F622}',
  celebrate: '\u{1F389}'
};
const DOWNLOAD_HEADER_NAMES = [
  'content-type',
  'content-disposition',
  'content-length',
  'cache-control',
  'pragma',
  'expires',
  'etag',
  'last-modified'
];
const RESOURCE_PAGE_SIZE = 50;
const MAX_RESOURCE_PAGES = 100;
const RESOURCE_MAX_BYTES = 10 * 1024 * 1024;
const RESOURCE_ALLOWED_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'csv', 'jpg', 'png', 'gif', 'webp'
]);

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

function isAuthError(error) {
  return error instanceof ApiError && error.status === 401;
}

function isNotFound(error) {
  return error instanceof ApiError && error.status === 404;
}

function isForbidden(error) {
  return error instanceof ApiError && error.status === 403;
}

function redirectAuthIfNeeded(error, req, res) {
  if (!isAuthError(error)) return false;
  return handleApiError(error, req, res, { redirectOn401: '/login?status=auth-required' });
}

function applyDownloadHeaders(res, headers = {}) {
  DOWNLOAD_HEADER_NAMES.forEach((header) => {
    if (headers[header]) {
      res.set(header, headers[header]);
    }
  });
}

function commentsRedirect(resourceId, status, fragment = 'comments') {
  const suffix = fragment ? `#${fragment}` : '';
  return `/resources/${resourceId}/comments?status=${encodeURIComponent(status)}${suffix}`;
}

function libraryRedirect(req, status = '') {
  const params = new URLSearchParams();
  const q = trimmed(req.body.q);
  const categoryId = positiveInteger(req.body.category_id);
  const reorder = trimmed(req.body.reorder);

  if (q) params.set('q', q);
  if (categoryId !== null) params.set('category_id', String(categoryId));
  if (reorder === '1') params.set('reorder', '1');
  if (status) params.set('status', status);

  const query = params.toString();
  return `/resources/library${query ? `?${query}` : ''}`;
}

function dataFrom(result) {
  return result && typeof result === 'object' && result.data !== undefined
    ? result.data
    : result;
}

function objectFrom(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function resourceItemsFrom(result) {
  const data = dataFrom(result);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  if (result && Array.isArray(result.items)) return result.items;
  return [];
}

function listFrom(result) {
  const data = dataFrom(result);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.categories)) return data.categories;
  if (result && Array.isArray(result.items)) return result.items;
  return [];
}

function metaFrom(result) {
  if (!result || typeof result !== 'object') return {};
  if (result.meta && typeof result.meta === 'object') return result.meta;
  if (result.pagination && typeof result.pagination === 'object') return result.pagination;
  return {};
}

function nextCursorFrom(result) {
  const meta = metaFrom(result);
  return trimmed(meta.cursor || meta.next_cursor || meta.nextCursor);
}

function hasMoreFrom(result) {
  const meta = metaFrom(result);
  return Boolean(meta.has_more || meta.hasMore || nextCursorFrom(result));
}

async function walkResourcePages(token, { targetId = null } = {}) {
  const resources = [];
  const seenCursors = new Set();
  let cursor = '';

  for (let page = 0; page < MAX_RESOURCE_PAGES; page += 1) {
    const params = { per_page: RESOURCE_PAGE_SIZE };
    if (cursor) params.cursor = cursor;

    const result = await getResources(token, params);
    const items = resourceItemsFrom(result);
    resources.push(...items);

    if (targetId !== null) {
      const resource = items.find((item) => positiveInteger(item && item.id) === targetId);
      if (resource) return { resource, resources };
    }

    const hasMore = hasMoreFrom(result);
    const nextCursor = nextCursorFrom(result);
    if (!hasMore) {
      return { resource: null, resources };
    }

    if (!nextCursor || seenCursors.has(nextCursor)) {
      throw new ApiError('Resource pagination did not advance', 503);
    }

    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  throw new ApiError('Resource catalogue exceeded the safe pagination limit', 503);
}

async function findResourceById(token, id) {
  const result = await walkResourcePages(token, { targetId: id });
  return result.resource;
}

async function getAllResources(token) {
  const result = await walkResourcePages(token);
  return result.resources;
}

function resourceHref(resource) {
  const rawPath = trimmed(resource.file_path || resource.url || resource.file_url);
  if (!rawPath) return '';
  if (/^https?:\/\//i.test(rawPath) || rawPath.startsWith('/')) {
    return rawPath;
  }
  return `/${rawPath.replace(/^\/+/, '')}`;
}

function resourceType(resource) {
  const explicitType = trimmed(resource.file_type).toUpperCase();
  if (explicitType) return explicitType;

  const path = trimmed(resource.file_path || resource.url || resource.file_url);
  const match = path.match(/\.([a-z0-9]+)(?:[?#].*)?$/i);
  return match ? match[1].toUpperCase() : '';
}

function truncate(value, length) {
  const text = trimmed(value);
  if (text.length <= length) return text;
  return `${text.slice(0, Math.max(0, length - 3))}...`;
}

function translateOr(t, key, fallback) {
  return typeof t === 'function' ? t(key) : fallback;
}

function normalizeResource(resource, t) {
  const item = resource && typeof resource === 'object' ? resource : {};
  return {
    id: positiveInteger(item.id),
    title: trimmed(item.title) || translateOr(t, 'resources.title', 'Resources'),
    description: truncate(item.description, 200),
    type: resourceType(item),
    href: resourceHref(item)
  };
}

function fileExtension(resource) {
  const path = trimmed(resource.file_path || resource.url || resource.file_url);
  const match = path.match(/\.([a-z0-9]+)(?:[?#].*)?$/i);
  if (match) return match[1].toUpperCase();

  const type = trimmed(resource.file_type);
  if (type.includes('/')) {
    const [, subtype] = type.split('/');
    return trimmed(subtype).toUpperCase() || 'FILE';
  }
  return type.toUpperCase() || 'FILE';
}

function formatFileSize(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function resourceCategory(resource) {
  const category = resource.category && typeof resource.category === 'object' ? resource.category : {};
  const id = positiveInteger(resource.category_id || category.id);
  const name = trimmed(resource.category_name || category.name);
  const color = trimmed(resource.category_color || category.color || 'grey');
  return name ? { id, name, color } : null;
}

function uploaderName(resource) {
  const uploader = resource.uploader && typeof resource.uploader === 'object' ? resource.uploader : {};
  return trimmed(resource.uploader_name || uploader.name || uploader.full_name);
}

function fileTypeLabel(resource, t) {
  const path = trimmed(resource.file_path || resource.url || resource.file_url);
  const match = path.match(/\.([a-z0-9]+)(?:[?#].*)?$/i);
  const extension = match ? match[1].toLowerCase() : '';
  let type = 'file';
  if (extension === 'pdf') type = 'pdf';
  else if (['doc', 'docx', 'rtf', 'odt'].includes(extension)) type = 'doc';
  else if (['xls', 'xlsx', 'csv', 'ods'].includes(extension)) type = 'spreadsheet';
  else if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(extension)) type = 'image';
  else if (extension === 'txt') type = 'text';
  return translateOr(t, `govuk_alpha_resources.file_types.${type}`, 'File');
}

function normalizeLibraryResource(resource, t, formatDate) {
  const item = resource && typeof resource === 'object' ? resource : {};
  const id = positiveInteger(item.id);
  return {
    id,
    title: trimmed(item.title) || translateOr(t, 'govuk_alpha_resources.file_types.file', 'File'),
    description: truncate(item.description, 220),
    fileExtension: fileExtension(item),
    fileTypeLabel: fileTypeLabel(item, t),
    fileSize: formatFileSize(item.file_size),
    downloads: Number.isInteger(Number(item.downloads)) ? Number(item.downloads) : 0,
    uploaderName: uploaderName(item),
    category: resourceCategory(item),
    createdAt: typeof formatDate === 'function' ? formatDate(item.created_at) : trimmed(item.created_at),
    downloadHref: id ? `/resources/${id}/download` : '',
    commentsHref: id ? `/resources/${id}/comments` : '',
    likeCount: Number.isInteger(Number(item.like_count || item.reaction_count || item.reactions_count))
      ? Number(item.like_count || item.reaction_count || item.reactions_count)
      : 0,
    commentCount: Number.isInteger(Number(item.comment_count || item.comments_count))
      ? Number(item.comment_count || item.comments_count)
      : 0,
    canManage: Boolean(item.can_manage || item.can_delete || item.is_owner)
  };
}

function normalizeCategory(category) {
  const item = category && typeof category === 'object' ? category : {};
  const children = Array.isArray(item.children) ? item.children.map(normalizeCategory).filter((child) => child.id && child.name) : [];
  return {
    id: positiveInteger(item.id),
    name: trimmed(item.name),
    color: trimmed(item.color || 'grey'),
    resourceCount: Number.isInteger(Number(item.resource_count || item.resources_count))
      ? Number(item.resource_count || item.resources_count)
      : 0,
    children
  };
}

function normalizeComment(comment, t, formatDate) {
  const item = objectFrom(comment);
  const author = objectFrom(item.author || item.user);
  return {
    id: positiveInteger(item.id),
    content: trimmed(item.content || item.body),
    createdAt: typeof formatDate === 'function' ? formatDate(item.created_at || item.createdAt) : trimmed(item.created_at || item.createdAt),
    userId: positiveInteger(item.user_id || author.id),
    authorName: trimmed(item.author_name || item.user_name || author.name || [author.first_name, author.last_name].filter(Boolean).join(' '))
      || translateOr(t, 'govuk_alpha_resources.social.unknown_author', 'Community member'),
    replies: (Array.isArray(item.replies) ? item.replies : Array.isArray(item.children) ? item.children : [])
      .map((reply) => normalizeComment(reply, t, formatDate))
  };
}

function commentCount(comments) {
  return comments.reduce((total, comment) => total + 1 + commentCount(comment.replies || []), 0);
}

function reactionSummaryFrom(result) {
  const data = objectFrom(dataFrom(result));
  return {
    counts: objectFrom(data.counts),
    total: positiveInteger(data.total) || 0,
    userReaction: trimmed(data.user_reaction || data.userReaction)
  };
}

function canManageResource(resource, currentUserId) {
  const item = objectFrom(resource);
  const uploader = objectFrom(item.uploader);
  const ownerId = positiveInteger(item.user_id || item.owner_id || item.uploader_id || uploader.id);
  return Boolean(item.can_manage || item.can_delete || item.is_owner || item.is_admin || (currentUserId && ownerId === currentUserId));
}

function isResourceAdmin(profile) {
  const user = objectFrom(profile);
  const role = trimmed(user.role || user.user_role || user.account_role);
  return ['admin', 'super_admin', 'tenant_admin'].includes(role) || Boolean(user.is_super_admin);
}

function statusMessage(status, t) {
  const keyByStatus = {
    'resource-uploaded': ['success', 'uploaded'],
    'resource-deleted': ['success', 'deleted'],
    'resource-delete-failed': ['error', 'delete_failed'],
    'resource-reorder-failed': ['error', 'reorder_failed']
  };
  const match = keyByStatus[status];
  if (!match) return null;
  const [type, key] = match;
  return {
    type,
    title: translateOr(t, `govuk_alpha_resources.states.${type === 'success' ? 'success_title' : 'error_title'}`, type === 'success' ? 'Success' : 'There is a problem'),
    message: translateOr(t, `govuk_alpha_resources.states.${key}`, status)
  };
}

function commentsStatusMessage(status, t) {
  const success = ['comment-added', 'reply-added', 'reaction-added', 'reaction-removed', 'comment-deleted'];
  const failure = ['comment-invalid', 'comment-failed', 'comment-delete-failed', 'reaction-failed'];
  if (!success.includes(status) && !failure.includes(status)) return null;
  const type = success.includes(status) ? 'success' : 'error';
  return {
    type,
    title: translateOr(t, `govuk_alpha_resources.states.${type === 'success' ? 'success_title' : 'error_title'}`, type === 'success' ? 'Success' : 'There is a problem'),
    message: translateOr(t, `govuk_alpha_resources.social.status.${status}`, status),
    anchor: ['comment-invalid', 'comment-failed'].includes(status) ? 'body' : undefined
  };
}

function uploadStatusMessage(status, t) {
  if (status !== 'resource-upload-failed') return null;
  return {
    type: 'error',
    title: translateOr(t, 'govuk_alpha_resources.states.error_title', 'There is a problem'),
    message: translateOr(t, 'govuk_alpha_resources.states.upload_failed', status)
  };
}

function resourceUploadValues(body = {}) {
  const categoryId = positiveInteger(body.category_id);
  return {
    title: trimmed(body.title, 255),
    description: trimmed(body.description, 5000),
    category_id: categoryId === null ? '' : String(categoryId)
  };
}

function rememberResourceUpload(req, values, fieldErrors) {
  req.flash('resourceUploadValues', values);
  req.flash('resourceUploadFieldErrors', fieldErrors);
}

function recalledResourceUpload(req, key) {
  const values = req.flash(key);
  return values.length > 0 && values[0] && typeof values[0] === 'object' ? values[0] : {};
}

function uploadFileExtension(file) {
  const filename = trimmed(file && file.originalFilename);
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

function uploadedFile(req, fieldName) {
  const file = req.files && req.files[fieldName];
  if (!file || typeof file !== 'object' || !file.filepath) {
    return null;
  }
  return file;
}

async function removeUploadedFile(file) {
  if (!file || !file.filepath) return;
  try {
    await fs.unlink(file.filepath);
  } catch {
    // Temporary upload cleanup is best-effort only.
  }
}

function libraryQuery(params) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && String(value) !== '') {
      query.set(key, String(value));
    }
  });
  const text = query.toString();
  return text ? `?${text}` : '';
}

function libraryHref(params) {
  return `/resources/library${libraryQuery(params)}`;
}

router.get('/', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  const resourcesQuery = trimmed(req.query && req.query.q);
  const params = { per_page: 30 };
  if (resourcesQuery) {
    params.search = resourcesQuery;
  }

  const result = await getResources(token, params);
  const resources = resourceItemsFrom(result).map((resource) => normalizeResource(resource, res.locals.t));

  return res.render('resources/index', {
    title: res.locals.t('resources.title'),
    activeNav: 'explore',
    resources,
    resourcesQuery
  });
}, { redirectOn401: '/login?status=auth-required', notFoundTitle: 'Resources' }));

router.get('/library', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  const searchQuery = trimmed(req.query && req.query.q);
  const selectedCategory = positiveInteger(req.query && req.query.category_id);
  const cursor = trimmed(req.query && req.query.cursor);
  const reorderMode = trimmed(req.query && req.query.reorder) === '1';

  const params = { per_page: 20 };
  if (searchQuery) params.search = searchQuery;
  if (selectedCategory !== null) params.category_id = selectedCategory;
  if (cursor) params.cursor = cursor;

  const [profileResult, resourcesResult, categoriesResult, treeResult] = await Promise.all([
    getRequestProfile(req, token),
    getResources(token, params),
    getResourceCategories(token),
    getResourceCategoryTree(token)
  ]);

  const profile = objectFrom(dataFrom(profileResult));
  const currentUserId = positiveInteger(profile.id || profile.user_id);
  const isAdmin = isResourceAdmin(profile);
  const resources = resourceItemsFrom(resourcesResult).map((resource) => {
    const normalized = normalizeLibraryResource(resource, res.locals.t, res.locals.formatLocaleDate);
    return {
      ...normalized,
      canManage: isAdmin || normalized.canManage || canManageResource(resource, currentUserId)
    };
  });
  const meta = metaFrom(resourcesResult);
  const nextCursor = trimmed(meta.next_cursor || meta.nextCursor || meta.cursor);
  const hasMore = Boolean(meta.has_more || meta.hasMore || nextCursor);
  const flatCategories = listFrom(categoriesResult).map(normalizeCategory).filter((category) => category.id && category.name);
  const categoryTree = listFrom(treeResult).map(normalizeCategory).filter((category) => category.id && category.name);
  const hasFilters = Boolean(searchQuery || selectedCategory !== null);

  return res.render('resources/library', {
    title: res.locals.t('govuk_alpha_resources.library.title'),
    activeNav: 'explore',
    resources,
    categoryTree,
    flatCategories,
    isAdmin,
    selectedCategory,
    searchQuery,
    cursor,
    hasMore,
    nextCursor,
    hasFilters,
    status: statusMessage(trimmed(req.query && req.query.status), res.locals.t),
    reorderMode: reorderMode && isAdmin,
    reorderOnHref: libraryHref({ q: searchQuery, category_id: selectedCategory, reorder: '1' }),
    reorderOffHref: libraryHref({ q: searchQuery, category_id: selectedCategory }),
    resourceCountText: res.locals.tc('govuk_alpha_resources.library.count', resources.length, {
      count: res.locals.formatLocaleNumber(resources.length)
    }),
    clearHref: '/resources/library',
    loadMoreHref: hasMore && nextCursor ? `/resources/library${libraryQuery({
      q: searchQuery,
      category_id: selectedCategory,
      reorder: reorderMode && isAdmin ? '1' : '',
      cursor: nextCursor
    })}` : ''
  });
}, { redirectOn401: '/login?status=auth-required', notFoundTitle: 'Resource library' }));

router.get('/upload', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  let flatCategories = [];
  try {
    const categoriesResult = await getResourceCategories(token);
    flatCategories = listFrom(categoriesResult).map(normalizeCategory).filter((category) => category.id && category.name);
  } catch (error) {
    if (redirectAuthIfNeeded(error, req, res)) return undefined;
  }

  return res.render('resources/upload', {
    title: res.locals.t('govuk_alpha_resources.upload.title'),
    activeNav: 'explore',
    flatCategories,
    maxSizeLabel: '10MB',
    allowedLabel: 'PDF, DOC, DOCX, XLS, XLSX, TXT, CSV, JPG, PNG, GIF, WEBP',
    status: uploadStatusMessage(trimmed(req.query && req.query.status), res.locals.t),
    values: recalledResourceUpload(req, 'resourceUploadValues'),
    fieldErrors: recalledResourceUpload(req, 'resourceUploadFieldErrors')
  });
}, { redirectOn401: '/login?status=auth-required', notFoundTitle: 'Upload a resource' }));

router.get('/:id(\\d+)/delete', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  const resourceId = Number(req.params.id);
  const [profileResult, resource] = await Promise.all([
    getRequestProfile(req, token),
    findResourceById(token, resourceId)
  ]);
  const profile = objectFrom(dataFrom(profileResult));
  const currentUserId = positiveInteger(profile.id || profile.user_id);

  if (!resource) {
    throw new ApiError('Resource not found', 404);
  }
  if (!isResourceAdmin(profile) && !canManageResource(resource, currentUserId)) {
    throw new ApiError('Resource forbidden', 403);
  }

  return res.render('resources/delete', {
    title: res.locals.t('govuk_alpha_resources.delete.title'),
    activeNav: 'explore',
    resourceId,
    resourceTitle: trimmed(resource.title) || res.locals.t('govuk_alpha_resources.file_types.file')
  });
}, { redirectOn401: '/login?status=auth-required', notFoundTitle: 'Delete resource' }));

router.get('/:id(\\d+)/download', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  const resourceId = Number(req.params.id);
  let download;

  try {
    download = await downloadResource(token, resourceId);
  } catch (error) {
    if (redirectAuthIfNeeded(error, req, res)) return undefined;
    if (error instanceof ApiError && error.status === 403) {
      return res.status(403).render('errors/403', { title: 'Forbidden' });
    }
    if (error instanceof ApiError && error.status === 404) {
      return res.status(404).render('errors/404', { title: 'Page not found' });
    }
    if (error instanceof ApiError && error.status === 429) {
      return res.status(429).render('errors/429', { title: 'Too many requests' });
    }

    return res.status(503).render('errors/503', { title: 'Service unavailable' });
  }

  res.status(download.status || 200);
  applyDownloadHeaders(res, download.headers);
  return res.send(Buffer.isBuffer(download.body) ? download.body : Buffer.from(download.body || ''));
}, { redirectOn401: '/login?status=auth-required', notFoundTitle: 'Resource download' }));

router.get('/:id(\\d+)/comments', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  const resourceId = Number(req.params.id);
  const [profileResult, resource] = await Promise.all([
    getRequestProfile(req, token),
    findResourceById(token, resourceId)
  ]);

  if (!resource) {
    throw new ApiError('Resource not found', 404);
  }

  const [commentsResult, reactionsResult] = await Promise.all([
    getComments(token, { target_type: 'resource', target_id: resourceId }),
    getReactionSummary(token, 'resource', resourceId)
  ]);

  const commentsData = objectFrom(dataFrom(commentsResult));
  const comments = (Array.isArray(commentsData.comments) ? commentsData.comments : resourceItemsFrom(commentsResult))
    .map((comment) => normalizeComment(comment, res.locals.t, res.locals.formatLocaleDate));
  const reactions = reactionSummaryFrom(reactionsResult);
  const profile = objectFrom(dataFrom(profileResult));
  const currentUserId = positiveInteger(profile.id || profile.user_id);

  return res.render('resources/comments', {
    title: res.locals.t('govuk_alpha_resources.social.comments_title', {
      title: trimmed(resource.title) || res.locals.t('govuk_alpha_resources.file_types.file')
    }),
    activeNav: 'explore',
    resourceId,
    resourceTitle: trimmed(resource.title) || res.locals.t('govuk_alpha_resources.file_types.file'),
    comments,
    commentsTotal: positiveInteger(commentsData.count) || commentCount(comments),
    currentUserId,
    reactions,
    reactionLabels: Object.fromEntries([...RESOURCE_REACTIONS].map((type) => [
      type,
      res.locals.t(`govuk_alpha_resources.social.reaction_types.${type}`)
    ])),
    reactionEmoji: RESOURCE_REACTION_EMOJI,
    status: commentsStatusMessage(trimmed(req.query && req.query.status), res.locals.t)
  });
}, { redirectOn401: '/login?status=auth-required', notFoundTitle: 'Resource comments' }));

function normalizeOrderItems(items) {
  if (!Array.isArray(items)) return [];

  return items
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const id = positiveInteger(item.id);
      const sortOrder = Number(item.sort_order);
      if (id === null || !Number.isInteger(sortOrder)) return null;
      return { id, sort_order: sortOrder };
    })
    .filter(Boolean);
}

function parseSubmittedItems(value) {
  if (Array.isArray(value)) {
    return normalizeOrderItems(value);
  }

  if (typeof value === 'string' && value.trim() !== '') {
    try {
      return normalizeOrderItems(JSON.parse(value));
    } catch {
      return [];
    }
  }

  if (value && typeof value === 'object') {
    return normalizeOrderItems(Object.values(value));
  }

  return [];
}

async function buildReorderItems(token, body) {
  const submitted = parseSubmittedItems(body.items);
  if (submitted.length > 0) {
    return submitted;
  }

  const resourceId = positiveInteger(body.resource_id);
  const direction = trimmed(body.direction);
  if (resourceId === null || !['up', 'down'].includes(direction)) {
    return [];
  }

  const resources = await getAllResources(token);
  const rows = resources
    .map((resource, index) => ({
      id: positiveInteger(resource.id),
      sort_order: Number.isInteger(Number(resource.sort_order)) ? Number(resource.sort_order) : index
    }))
    .filter((resource) => resource.id !== null)
    .sort((left, right) => {
      if (left.sort_order !== right.sort_order) return left.sort_order - right.sort_order;
      return right.id - left.id;
    });

  const index = rows.findIndex((resource) => resource.id === resourceId);
  if (index === -1) {
    throw new ApiError('Resource not found', 404);
  }

  const swapWith = direction === 'up' ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= rows.length) {
    return null;
  }

  [rows[index], rows[swapWith]] = [rows[swapWith], rows[index]];
  return rows.map((resource, position) => ({
    id: resource.id,
    sort_order: position
  }));
}

router.post('/upload', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  const file = uploadedFile(req, 'file');
  const values = resourceUploadValues(req.body);
  const fieldErrors = {};
  if (!values.title) {
    fieldErrors.title = res.locals.t('govuk_alpha_resources.upload.error_title_required');
  }
  if (!file) {
    fieldErrors.file = res.locals.t('govuk_alpha_resources.upload.error_file_required');
  } else if (Number(file.size) > RESOURCE_MAX_BYTES) {
    fieldErrors.file = res.locals.t('govuk_alpha_resources.upload.error_too_large');
  } else if (!RESOURCE_ALLOWED_EXTENSIONS.has(uploadFileExtension(file))) {
    fieldErrors.file = res.locals.t('govuk_alpha_resources.upload.error_type');
  }
  if (Object.keys(fieldErrors).length > 0) {
    rememberResourceUpload(req, values, fieldErrors);
    await removeUploadedFile(file);
    return redirectTo(res, '/resources/upload');
  }

  try {
    const buffer = await fs.readFile(file.filepath);
    const submittedCategoryId = positiveInteger(req.body.category_id);
    let categoryId = '';
    if (submittedCategoryId !== null) {
      const categoriesResult = await getResourceCategories(token);
      const categoryBelongsToTenant = listFrom(categoriesResult)
        .some((category) => positiveInteger(category && category.id) === submittedCategoryId);
      if (categoryBelongsToTenant) categoryId = String(submittedCategoryId);
    }

    await uploadResource(token, {
      title: values.title,
      description: values.description,
      category_id: categoryId,
      file: {
        buffer,
        filename: trimmed(file.originalFilename) || 'resource',
        contentType: trimmed(file.mimetype) || 'application/octet-stream',
        size: file.size
      }
    });
  } catch (error) {
    if (redirectAuthIfNeeded(error, req, res)) return undefined;
    if (isForbidden(error)) throw error;
    rememberResourceUpload(req, values, {
      file: res.locals.t('govuk_alpha_resources.upload.error_upload_failed')
    });
    return redirectTo(res, '/resources/upload');
  } finally {
    await removeUploadedFile(file);
  }

  return redirectTo(res, '/resources/library?status=resource-uploaded');
}));

router.post('/reorder', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  try {
    const items = await buildReorderItems(token, req.body);
    if (items === null) {
      return redirectTo(res, libraryRedirect(req));
    }
    if (items.length === 0) {
      return redirectTo(res, libraryRedirect(req, 'resource-reorder-failed'));
    }

    await reorderResources(token, { items });
  } catch (error) {
    if (redirectAuthIfNeeded(error, req, res)) return undefined;
    if (isNotFound(error) || isForbidden(error)) throw error;
    return redirectTo(res, libraryRedirect(req, 'resource-reorder-failed'));
  }

  return redirectTo(res, libraryRedirect(req));
}));

router.post('/:id(\\d+)/delete', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  try {
    await deleteResource(token, id);
  } catch (error) {
    if (redirectAuthIfNeeded(error, req, res)) return undefined;
    if (isNotFound(error) || isForbidden(error)) throw error;
    return redirectTo(res, '/resources/library?status=resource-delete-failed');
  }

  return redirectTo(res, '/resources/library?status=resource-deleted');
}));

router.post('/:id(\\d+)/react', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  const emoji = trimmed(req.body.emoji);
  let status = 'reaction-failed';

  if (RESOURCE_REACTIONS.has(emoji)) {
    try {
      const result = await toggleReaction(token, {
        target_type: 'resource',
        target_id: id,
        reaction_type: emoji
      });
      const action = result && result.data && result.data.action;
      status = action === 'removed' ? 'reaction-removed' : 'reaction-added';
    } catch (error) {
      if (redirectAuthIfNeeded(error, req, res)) return undefined;
      if (isNotFound(error)) throw error;
      status = 'reaction-failed';
    }
  }

  return redirectTo(res, commentsRedirect(id, status, 'resource-reactions'));
}));

router.post('/:id(\\d+)/comments/add', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  const body = trimmed(req.body.body, 5000);
  const parentId = positiveInteger(req.body.parent_id);
  if (body === '') {
    return redirectTo(res, commentsRedirect(id, 'comment-invalid'));
  }

  let status = parentId !== null ? 'reply-added' : 'comment-added';
  try {
    await createComment(token, {
      target_type: 'resource',
      target_id: id,
      content: body,
      parent_id: parentId
    });
  } catch (error) {
    if (redirectAuthIfNeeded(error, req, res)) return undefined;
    if (isNotFound(error)) throw error;
    status = 'comment-failed';
  }

  return redirectTo(res, commentsRedirect(id, status));
}));

router.post('/:id(\\d+)/comments/:commentId(\\d+)/delete', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  const commentId = Number(req.params.commentId);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  let status = 'comment-deleted';
  try {
    await deleteComment(token, commentId);
  } catch (error) {
    if (redirectAuthIfNeeded(error, req, res)) return undefined;
    status = 'comment-delete-failed';
  }

  return redirectTo(res, commentsRedirect(id, status));
}));

module.exports = router;
