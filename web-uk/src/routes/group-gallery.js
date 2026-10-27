// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Group photo and video gallery: /groups/:id/gallery (parity with the website's
 * Media tab, react-frontend/src/pages/groups/api/media.ts, 27 Oct 2026).
 *
 * - GET  /groups/:id/gallery                 one cursor page, optional ?type=image|video
 * - GET  /groups/:id/gallery/:mediaId/file   the private file, fetched with the member's token
 * - POST /groups/:id/gallery                 multipart upload (file + caption)
 * - GET  /groups/:id/gallery/:mediaId/delete confirmation page
 * - POST /groups/:id/gallery/:mediaId/delete delete
 *
 * Contract: GET/POST /api/v2/groups/{id}/media, DELETE /api/v2/groups/{id}/media/{mediaId},
 * GET /api/v2/groups/{id}/media?content={mediaId} (GroupMediaController). The API
 * accepts JPEG, PNG, GIF and WebP images and MP4, WebM and QuickTime videos up to
 * 50 MB; it decides who may delete (uploader or group manager) and says so per
 * item in `capabilities.can_delete`, which is all this page uses.
 *
 * The multipart parser for POST /groups/:id/gallery is mounted in server.js
 * BEFORE the CSRF check (the token travels inside the multipart body).
 */

const express = require('express');
const fs = require('fs/promises');
const {
  callGroupApi,
  downloadGroupFile,
  uploadGroupMedia,
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
  statusPath,
  redirectWithStatus,
  isAuthError,
  loginRedirect,
  apiErrorCode,
  apiErrorField,
  isSafeguardingRefusal,
  statusBanner,
  dateLabel
} = require('../lib/group-media-pages');

const router = express.Router();

const PER_PAGE = 20;
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_CAPTION_LENGTH = 2000;
const TYPES = new Set(['image', 'video']);
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm', 'video/quicktime'
]);
const PROXY_HEADERS = ['content-type', 'content-length', 'content-disposition', 'cache-control', 'etag', 'last-modified'];

const SUCCESS_STATES = new Set(['uploaded', 'deleted']);
const ERROR_STATES = new Set([
  'file-missing', 'file-type', 'file-too-large', 'caption-too-long', 'upload-failed',
  'delete-failed', 'forbidden', 'safeguarding'
]);
const FIELD_FOR = {
  'file-missing': 'gallery-file',
  'file-type': 'gallery-file',
  'file-too-large': 'gallery-file',
  'upload-failed': 'gallery-file',
  'caption-too-long': 'gallery-caption'
};

const PAGE_OPTIONS = { redirectOn401: '/login?status=auth-required' };

function galleryPath(id, query = {}) {
  const params = new URLSearchParams();
  if (query.type) params.set('type', query.type);
  if (query.cursor) params.set('cursor', query.cursor);
  const search = params.toString();
  return `/groups/${id}/gallery${search ? `?${search}` : ''}`;
}

function normalizeMedia(raw, groupId, locale) {
  const item = raw && typeof raw === 'object' ? raw : {};
  const id = positiveInteger(item.id);
  if (id === null) return null;
  const type = text(item.type || item.media_type) === 'video' ? 'video' : 'image';
  const uploader = item.uploader && typeof item.uploader === 'object' ? item.uploader : {};
  const name = text(item.original_name);
  return {
    id,
    type,
    name,
    caption: text(item.caption),
    mimeType: text(item.mime_type),
    fileUrl: `/groups/${groupId}/gallery/${id}/file`,
    uploaderName: text(item.uploader_name || uploader.name),
    uploadedAtLabel: dateLabel(item.created_at, locale),
    canDelete: item.capabilities?.can_delete === true
  };
}

function uploadErrorStatus(error) {
  if (!(error instanceof ApiError)) return 'upload-failed';
  if (error.status === 403) return isSafeguardingRefusal(error) ? 'safeguarding' : 'forbidden';
  if (isSafeguardingRefusal(error)) return 'safeguarding';
  const code = apiErrorCode(error);
  if (error.status === 413 || code === 'FILE_TOO_LARGE') return 'file-too-large';
  if (apiErrorField(error) === 'caption') return 'caption-too-long';
  if (error.status === 422 || error.status === 400) {
    return apiErrorField(error) === 'file' || code === 'VALIDATION_ERROR' ? 'file-type' : 'upload-failed';
  }
  return 'upload-failed';
}

/**
 * Formidable refuses an over-size upload before the route runs. Mounted in
 * server.js right after the parser so the member sees a field error rather than
 * a generic failure page.
 */
function galleryMultipartErrorRedirect(error, req, res, next) {
  const match = String(req.originalUrl || req.url || '').match(/\/groups\/(\d+)\/gallery(?:[?#]|$)/);
  if (!match) return next(error);
  const isSizeError = Number(error?.httpCode) === 413
    || Number(error?.code) === 1009
    || /max(?:imum)?\s*(?:total\s*)?file\s*size|too large/i.test(String(error?.message || ''));
  return res.redirect(statusPath(res, `/groups/${match[1]}/gallery`, isSizeError ? 'file-too-large' : 'file-missing'));
}

router.get('/:id(\\d+)/gallery', requireAuth, asyncRoute(async (req, res) => {
  const access = await requireGroupSection(req, res, 'media');
  if (!access) return undefined;
  const { group } = access;
  const locale = getRequestIntlLocale();
  const t = res.locals.t;

  const type = TYPES.has(text(req.query.type)) ? text(req.query.type) : '';
  const cursor = text(req.query.cursor, 200);
  const params = new URLSearchParams({ per_page: String(PER_PAGE) });
  if (cursor) params.set('cursor', cursor);
  if (type) params.set('type', type);

  let page;
  try {
    page = dataFrom(await callGroupApi(req.token, 'GET', `/${encodeURIComponent(group.id)}/media?${params.toString()}`)) || {};
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return renderRefusal(res, 403);
    if (error instanceof ApiError && error.status === 422 && cursor) {
      return res.redirect(urlFor(res, galleryPath(group.id, { type })));
    }
    throw error;
  }

  const items = (Array.isArray(page.items) ? page.items : [])
    .map((item) => normalizeMedia(item, group.id, locale))
    .filter(Boolean);
  const nextCursor = page.has_more === true ? text(page.cursor) : '';
  const banner = statusBanner(t, 'govuk_alpha_group_media.gallery.states', req.query.status, SUCCESS_STATES, ERROR_STATES, FIELD_FOR);

  return res.render('groups/gallery/index', {
    title: t('govuk_alpha_group_media.gallery.title'),
    group,
    items,
    type,
    filters: [
      { value: '', label: t('govuk_alpha_group_media.gallery.filter_all') },
      { value: 'image', label: t('govuk_alpha_group_media.gallery.filter_photos') },
      { value: 'video', label: t('govuk_alpha_group_media.gallery.filter_videos') }
    ],
    emptyMessage: type === 'image'
      ? t('govuk_alpha_group_media.gallery.empty_photos')
      : (type === 'video' ? t('govuk_alpha_group_media.gallery.empty_videos') : t('govuk_alpha_group_media.gallery.empty')),
    pagination: {
      nextHref: nextCursor ? galleryPath(group.id, { type, cursor: nextCursor }) : '',
      firstHref: cursor ? galleryPath(group.id, { type }) : ''
    },
    statusBanner: banner,
    hasErrors: Boolean(banner && banner.type === 'error')
  });
}, PAGE_OPTIONS));

router.get('/:id(\\d+)/gallery/:mediaId(\\d+)/file', requireAuth, asyncRoute(async (req, res) => {
  const access = await requireGroupSection(req, res, 'media');
  if (!access) return undefined;
  const { group } = access;

  let download;
  try {
    download = await downloadGroupFile(req.token, `/${encodeURIComponent(group.id)}/media?content=${encodeURIComponent(req.params.mediaId)}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return renderRefusal(res, 403);
    if (error instanceof ApiError && error.status === 404) return renderRefusal(res, 404);
    throw error;
  }

  const headers = download.headers || {};
  res.status(download.status || 200);
  PROXY_HEADERS.forEach((name) => {
    if (headers[name]) res.set(name, headers[name]);
  });
  if (!headers['cache-control']) res.set('cache-control', 'private, no-store');
  // The API already sends these; repeat them so this origin never sniffs or
  // embeds a member upload as anything other than the declared image/video.
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cross-Origin-Resource-Policy', 'same-origin');
  return res.send(Buffer.isBuffer(download.body) ? download.body : Buffer.from(download.body || ''));
}, PAGE_OPTIONS));

router.post('/:id(\\d+)/gallery', requireAuth, asyncRoute(async (req, res) => {
  const access = await requireGroupSection(req, res, 'media');
  if (!access) return undefined;
  const { group } = access;
  const back = `/groups/${group.id}/gallery`;

  const file = req.files && req.files.file ? (Array.isArray(req.files.file) ? req.files.file[0] : req.files.file) : null;
  const caption = text(req.body?.caption);
  if (!file) return redirectWithStatus(res, back, 'file-missing');
  if (caption.length > MAX_CAPTION_LENGTH) return redirectWithStatus(res, back, 'caption-too-long');
  if (Number(file.size) > MAX_FILE_SIZE) return redirectWithStatus(res, back, 'file-too-large');
  const mimeType = text(file.mimetype).toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(mimeType)) return redirectWithStatus(res, back, 'file-type');

  try {
    const buffer = await fs.readFile(file.filepath);
    await uploadGroupMedia(req.token, req.params.id, {
      caption,
      file: {
        buffer,
        filename: text(file.originalFilename) || 'group-media',
        contentType: mimeType,
        size: file.size
      }
    });
  } catch (error) {
    if (isAuthError(error)) return loginRedirect(res);
    return redirectWithStatus(res, back, uploadErrorStatus(error));
  } finally {
    fs.unlink(file.filepath).catch(() => {});
  }

  return redirectWithStatus(res, back, 'uploaded');
}, PAGE_OPTIONS));

router.get('/:id(\\d+)/gallery/:mediaId(\\d+)/delete', requireAuth, asyncRoute(async (req, res) => {
  const access = await requireGroupSection(req, res, 'media');
  if (!access) return undefined;
  const { group } = access;
  const t = res.locals.t;
  return res.render('confirm-delete', {
    title: t('govuk_alpha_group_media.gallery.delete_title'),
    confirmHeading: t('govuk_alpha_group_media.gallery.delete_title'),
    confirmWarning: t('govuk_alpha_group_media.common.cannot_undo'),
    confirmButton: t('govuk_alpha_group_media.gallery.delete_confirm'),
    confirmAction: `/groups/${group.id}/gallery/${req.params.mediaId}/delete`,
    cancelHref: `/groups/${group.id}/gallery`
  });
}, PAGE_OPTIONS));

router.post('/:id(\\d+)/gallery/:mediaId(\\d+)/delete', requireAuth, asyncRoute(async (req, res) => {
  const access = await requireGroupSection(req, res, 'media');
  if (!access) return undefined;
  const { group } = access;
  const back = `/groups/${group.id}/gallery`;
  try {
    await callGroupApi(req.token, 'DELETE', `/${encodeURIComponent(group.id)}/media/${encodeURIComponent(req.params.mediaId)}`);
  } catch (error) {
    if (isAuthError(error)) return loginRedirect(res);
    if (error instanceof ApiError && error.status === 403) return redirectWithStatus(res, back, 'forbidden');
    return redirectWithStatus(res, back, 'delete-failed');
  }
  return redirectWithStatus(res, back, 'deleted');
}, PAGE_OPTIONS));

module.exports = router;
module.exports.galleryMultipartErrorRedirect = galleryMultipartErrorRedirect;
