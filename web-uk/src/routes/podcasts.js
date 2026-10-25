// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { callPodcastApi, ApiError } = require('../lib/api');
const { resolveBackendMediaUrl } = require('../lib/accessible-shell');
const { getRequestProfile } = require('../lib/request-profile');
const { asyncRoute } = require('../lib/routeHelpers');
const { htmlToPlainText } = require('../lib/html-sanitizer');
const { splitDateTime } = require('../lib/date-input');
const { translateForRequest } = require('../lib/request-translator');
const { formatApiDateTime, parseApiInstant } = require('../lib/api-instant');
const { getRequestIntlLocale } = require('../lib/request-intl-locale');

const router = express.Router();

const PODCAST_SORTS = ['newest', 'title', 'episodes', 'followers'];
// 🔴 The status label was translated ONLY when a `t` was handed in, with these English
// words as the fallback — and `t` is not passed on every path (an episode inside a show,
// and the single-episode page, both call the decorators without it), so the English leaked
// into those pages in all eleven languages. Translating from the request locale directly
// removes the conditional, so there is no path left that can fall back to English.
const SHOW_STATUS_KEYS = {
  published: 'govuk_alpha_commerce.podcast_studio.status_published',
  draft: 'govuk_alpha_commerce.podcast_studio.status_draft',
  archived: 'govuk_alpha_commerce.podcast_studio.status_archived'
};
const SHOW_STATUS_TAGS = {
  published: 'govuk-tag--green',
  draft: 'govuk-tag--grey',
  archived: 'govuk-tag--red'
};
// Episodes have their own translated set — same words in English, but a separate key so a
// language can distinguish "this show is published" from "this episode is published".
const EPISODE_STATUS_KEYS = {
  published: 'govuk_alpha_commerce.podcast_studio.episode_status_published',
  draft: 'govuk_alpha_commerce.podcast_studio.episode_status_draft',
  archived: 'govuk_alpha_commerce.podcast_studio.episode_status_archived'
};
const EPISODE_STATUS_TAGS = {
  published: 'govuk-tag--green',
  draft: 'govuk-tag--grey',
  archived: 'govuk-tag--red'
};
const STUDIO_SUCCESS_KEYS = {
  'show-deleted': 'status_show_deleted',
  'show-created': 'status_show_created',
  'show-saved': 'status_show_saved',
  'show-published': 'status_show_published',
  'show-pending-review': 'status_show_pending_review',
  'episode-added': 'status_episode_added',
  'episode-saved': 'status_show_saved',
  'episode-published': 'status_episode_published',
  'episode-deleted': 'status_episode_deleted',
  'show-archived': 'status_show_archived',
  'episode-archived': 'status_episode_archived'
};
const STUDIO_ERROR_KEYS = {
  'show-delete-failed': 'status_show_delete_failed',
  'show-save-failed': 'status_show_save_failed',
  'show-publish-failed': 'status_show_publish_failed',
  'show-title-missing': 'error_title',
  'show-create-failed': 'error_create',
  'episode-failed': 'status_episode_failed',
  'episode-save-failed': 'status_episode_failed',
  'episode-title-missing': 'status_episode_title_missing',
  'episode-audio-missing': 'status_episode_audio_missing',
  'episode-invalid-audio': 'status_episode_invalid_audio',
  'episode-schedule-invalid': 'error_schedule',
  'episode-chapters-invalid': 'error_chapters',
  'show-archive-failed': 'status_show_archive_failed',
  'episode-archive-failed': 'status_episode_archive_failed',
  'episode-cover-failed': 'status_episode_cover_failed',
  'episode-publish-failed': 'status_episode_publish_failed',
  'episode-delete-failed': 'status_episode_delete_failed'
};
const PODCAST_STATUS_KEYS = {
  subscribed: { type: 'success', key: 'podcast_subscribe_success' },
  unsubscribed: { type: 'success', key: 'podcast_unsubscribe_success' },
  'subscribe-failed': { type: 'error', key: 'podcast_subscribe_failed' }
};

const EPISODE_PAGE_STATUS_KEYS = {
  liked: { type: 'success', key: 'govuk_alpha.podcasts.liked' },
  unliked: { type: 'success', key: 'govuk_alpha.podcasts.unliked' },
  'like-failed': { type: 'error', key: 'govuk_alpha.podcasts.like_failed' },
  reported: { type: 'success', key: 'govuk_alpha.podcasts.report_sent' },
  'report-failed': { type: 'error', key: 'govuk_alpha.podcasts.report_failed' }
};

function tokenFrom(req) {
  return (req.signedCookies && req.signedCookies.token) || req.token || '';
}

function loginRedirect() {
  return '/login?status=auth-required';
}

function trimmed(value, limit = null) {
  const text = String(value || '').trim();
  return limit === null ? text : text.slice(0, limit);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function dataFrom(result) {
  return result && typeof result === 'object' && result.data !== undefined
    ? result.data
    : result;
}

function rowsFrom(result) {
  const data = dataFrom(result);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  if (result && Array.isArray(result.items)) return result.items;
  return [];
}

function metaFrom(result) {
  if (result && result.meta && typeof result.meta === 'object' && !Array.isArray(result.meta)) {
    return result.meta;
  }
  const data = dataFrom(result);
  if (data && data.meta && typeof data.meta === 'object' && !Array.isArray(data.meta)) {
    return data.meta;
  }
  return {};
}

function objectFrom(result) {
  const data = dataFrom(result);
  return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
}

async function callPodcast(token, method, path = '') {
  return callPodcastApi(token, method, path);
}

function isAuthError(error) {
  return error instanceof ApiError && error.status === 401;
}

function isForbidden(error) {
  return error instanceof ApiError && error.status === 403;
}

function isNotFound(error) {
  return error instanceof ApiError && error.status === 404;
}

function redirectTo(res, pathname) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return res.redirect(urlFor(pathname));
}

function redirectAuthIfNeeded(error, res) {
  if (isAuthError(error)) {
    redirectTo(res, loginRedirect());
    return true;
  }
  return false;
}

function renderPodcastError(error, res, title = 'Podcasts') {
  if (redirectAuthIfNeeded(error, res)) return true;
  if (isForbidden(error)) {
    res.status(403).render('errors/403', { title: 'Access denied' });
    return true;
  }
  if (isNotFound(error)) {
    res.status(404).render('errors/404', { title: (res.locals.t ? res.locals.t('govuk_alpha.error_pages.404_title') : 'Page not found') });
    return true;
  }

  res.status(503).render('static-page', {
    title,
    body: 'Podcast information could not be loaded. Please try again shortly.'
  });
  return true;
}

function safeRelativeOrAbsoluteUrl(value) {
  const url = trimmed(value);
  return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('/')
    ? url
    : '';
}

function backendRelativeUrl(value) {
  const url = safeRelativeOrAbsoluteUrl(value);
  if (!url) return '';
  return url.startsWith('/') ? resolveBackendMediaUrl(url) : url;
}

function sortFrom(query) {
  const sort = trimmed(query.sort);
  return PODCAST_SORTS.includes(sort) ? sort : 'newest';
}

function indexPath(query) {
  const params = new URLSearchParams();
  params.set('page', String(positiveInteger(query.page) || 1));
  params.set('per_page', '30');
  params.set('sort', sortFrom(query));

  const search = trimmed(query.q);
  if (search) params.set('q', search);

  const category = trimmed(query.category);
  if (category) params.set('category', category);

  return `?${params.toString()}`;
}

function positiveCount(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function paginationItems(query, meta) {
  const currentPage = positiveCount(meta.current_page ?? meta.page, positiveInteger(query.page) || 1);
  const perPage = positiveCount(meta.per_page, 30);
  const total = Math.max(0, Number(meta.total) || 0);
  const pageCount = Math.max(1, positiveCount(meta.total_pages, Math.ceil(total / perPage) || 1));
  if (pageCount <= 1) return [];

  return Array.from({ length: pageCount }, (_unused, index) => {
    const number = index + 1;
    const params = new URLSearchParams();
    const search = trimmed(query.q);
    if (search) params.set('q', search);
    params.set('sort', sortFrom(query));
    const category = trimmed(query.category);
    if (category) params.set('category', category);
    params.set('page', String(number));
    return {
      number,
      current: number === currentPage,
      href: `/podcasts?${params.toString()}`
    };
  });
}

function podcastStudioAccessible(meta) {
  return meta.can_create_show === true || positiveCount(meta.current_show_count, 0) > 0;
}

function stripHtml(value) {
  return htmlToPlainText(value);
}

function limitedText(value, limit) {
  const text = stripHtml(value).trim();
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 3)).trimEnd()}...` : text;
}

function decorateShow(show) {
  const row = show && typeof show === 'object' ? show : {};
  const id = positiveInteger(row.id);
  const title = trimmed(row.title) || translateForRequest('govuk_alpha.podcasts.title');
  const ownerName = trimmed(row.owner && row.owner.name);
  const approvedCount = row.approved_episode_count !== undefined ? row.approved_episode_count : row.episodes_count;
  const episodeCount = approvedCount !== undefined ? approvedCount : row.episode_count;
  const status = trimmed(row.status) || 'draft';

  return {
    ...row,
    id,
    title,
    description: stripHtml(row.description || ''),
    browseDescription: limitedText(row.description || '', 160),
    summary: stripHtml(row.summary || ''),
    ownerName,
    byLabel: ownerName
      ? translateForRequest('govuk_alpha.podcasts.by_label', { name: ownerName })
      : '',
    artworkUrl: backendRelativeUrl(row.artwork_url),
    // The API sends no feed address (there is no `rss_url` field — this read one until
    // 2026-10-25, so the link never appeared). Built per request like the website's.
    rssUrl: '',
    rssEnabled: false,
    episodeCount: Number.isFinite(Number(episodeCount)) ? Number(episodeCount) : 0,
    status,
    statusLabel: SHOW_STATUS_KEYS[status] ? translateForRequest(SHOW_STATUS_KEYS[status]) : status,
    statusTag: SHOW_STATUS_TAGS[status] || 'govuk-tag--grey',
    visibility: ['public', 'members', 'private'].includes(trimmed(row.visibility)) ? trimmed(row.visibility) : 'public',
    moderationStatus: trimmed(row.moderation_status) || 'approved'
  };
}

function chapterRows(chapters) {
  return (Array.isArray(chapters) ? chapters : [])
    .map((chapter) => ({
      title: trimmed(chapter && chapter.title),
      starts_at_seconds: Math.max(0, Math.floor(Number(chapter && chapter.starts_at_seconds) || 0)),
      ...(trimmed(chapter && chapter.url) ? { url: trimmed(chapter.url) } : {})
    }))
    .filter((chapter) => chapter.title !== '');
}

function formatChapterTime(totalSeconds) {
  const safe = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = String(safe % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

function chaptersEditText(chapters) {
  const rows = chapterRows(chapters);
  if (rows.some((chapter) => chapter.url)) return JSON.stringify(rows, null, 2);
  return rows.map((chapter) => `${formatChapterTime(chapter.starts_at_seconds)} ${chapter.title}`).join('\n');
}

function decorateEpisode(episode, showId = null) {
  const row = episode && typeof episode === 'object' ? episode : {};
  const id = positiveInteger(row.id);
  const status = trimmed(row.status) || 'draft';
  const number = positiveInteger(row.episode_number);

  return {
    ...row,
    id,
    showId: positiveInteger(row.show_id) || showId,
    title: trimmed(row.title) || translateForRequest('govuk_alpha.podcasts.episodes_title'),
    description: stripHtml(row.description || row.summary || ''),
    // 🔴 The edit form's Description box. `description` above falls back to the summary
    // for display, and the form used it, so saving any edit copied the summary into the
    // description and the episode page then showed it twice.
    descriptionOnly: stripHtml(row.description || ''),
    // Shown above the description on the episode page, as on the website. Empty when
    // there is no separate description, because `description` already carries it.
    // Also empty when the two are the same text, which the old edit form produced (below).
    summaryText: row.description && stripHtml(row.summary || '').trim() !== stripHtml(row.description).trim()
      ? stripHtml(row.summary || '').trim()
      : '',
    cardDescription: limitedText(row.description || row.summary || '', 240),
    audioUrl: backendRelativeUrl(row.audio_url),
    coverImageUrl: backendRelativeUrl(row.cover_image_url),
    transcript: String(row.transcript || '').trim(),
    // Chapters are edited as plain lines ("0:00 Introduction"), as on the website;
    // the form used to ask for raw JSON. A chapter link has no place in that format,
    // so a chapter that carries one keeps the JSON form (podcast-actions.js reads both).
    chapterList: chapterRows(row.chapters).map((chapter) => ({ ...chapter, time: formatChapterTime(chapter.starts_at_seconds) })),
    chaptersText: chaptersEditText(row.chapters),
    scheduledFor: trimmed(row.scheduled_for).slice(0, 16),
    scheduledForParts: splitDateTime(trimmed(row.scheduled_for).slice(0, 16)),
    status,
    statusLabel: EPISODE_STATUS_KEYS[status] ? translateForRequest(EPISODE_STATUS_KEYS[status]) : status,
    statusTag: EPISODE_STATUS_TAGS[status] || 'govuk-tag--grey',
    episodeNumber: number,
    episodeNumberLabel: number !== null
      ? translateForRequest('govuk_alpha_commerce.podcast_studio.episode_number_short', { number })
      : ''
  };
}

/**
 * Why listeners cannot hear an episode yet, or null when they can.
 *
 * The API returns not-yet-live episodes only to the show's owner and to admins
 * (PodcastService::visibleEpisodeQuery / canViewEpisode). This mirrors the same
 * rules so a manager is told which one applies. 🔴 This page used to drop every
 * episode whose status was not "published", so a manager saw "No episodes" while
 * the website listed the episode.
 */
function episodeAvailability(row, now = Date.now()) {
  const status = trimmed(row.status) || 'draft';
  if (status === 'archived') return { key: 'govuk_alpha.podcasts.availability_archived' };
  if (status !== 'published') return { key: 'govuk_alpha.podcasts.availability_draft' };

  const moderation = trimmed(row.moderation_status) || 'approved';
  if (moderation === 'rejected' || moderation === 'flagged') {
    return { key: 'govuk_alpha.podcasts.availability_rejected', tag: 'govuk-tag--red' };
  }
  if (moderation !== 'approved') return { key: 'govuk_alpha.podcasts.availability_pending' };

  const scheduled = parseApiInstant(trimmed(row.scheduled_for));
  if (scheduled && scheduled.getTime() > now) {
    return {
      key: 'govuk_alpha.podcasts.availability_scheduled',
      // In UTC and named as such, the accessible site's rule for times (api-instant.js).
      params: { date: formatApiDateTime(scheduled, getRequestIntlLocale() || 'en-GB') }
    };
  }

  if (row.hosted_audio === true) {
    const scan = trimmed(row.media_scan_status);
    if (['infected', 'failed', 'rejected'].includes(scan) || trimmed(row.media_processing_status) === 'failed') {
      return { key: 'govuk_alpha.podcasts.availability_media_failed', tag: 'govuk-tag--red' };
    }
    if (trimmed(row.media_processing_status) !== 'complete' || !['clean', 'not_required'].includes(scan)) {
      return { key: 'govuk_alpha.podcasts.availability_media_checking' };
    }
  }

  return null;
}

function withAvailability(episode, row) {
  const availability = episodeAvailability(row);
  return {
    ...episode,
    isLive: availability === null,
    availabilityLabel: availability ? translateForRequest(availability.key, availability.params || {}) : '',
    availabilityTag: availability ? (availability.tag || 'govuk-tag--yellow') : ''
  };
}

function showEpisodes(show) {
  const rows = Array.isArray(show.episodes) ? show.episodes : [];
  return rows
    .map((row) => withAvailability(decorateEpisode(row, show.id), row))
    .filter((episode) => episode.id !== null);
}

function studioEpisodes(show) {
  const rows = Array.isArray(show.episodes) ? show.episodes : [];
  return rows
    .map((row) => studioEpisode(decorateEpisode(row, show.id), row))
    .filter((episode) => episode.id !== null);
}

// Which FIELD each show-form error belongs to.
//
// 🔴 views/podcasts/form.njk built its summary with one hardcoded `href="#title"` and no
// field-level error at all. Only `show-title-missing` is genuinely about the Title box;
// `show-create-failed` is the API refusing the save, and pointing that at Title told the
// member their title was wrong when it was not.
const SHOW_ERROR_FIELDS = {
  'show-title-missing': 'title'
};

/**
 * Split a show-form status into per-field errors and one page-level message.
 *
 * Only an ERROR status is considered. The template used to guard its error summary on
 * `{% if status %}`, so a success status rendered inside a box headed "There is a problem";
 * keying off these locals instead makes that impossible.
 */
function showFormErrors(status) {
  const key = trimmed(status);
  if (!STUDIO_ERROR_KEYS[key]) return { errorList: [], fieldErrors: {}, formMessage: '' };

  const message = translateForRequest(`govuk_alpha_commerce.podcast_studio.${STUDIO_ERROR_KEYS[key]}`);
  const field = SHOW_ERROR_FIELDS[key];
  if (!field) return { errorList: [], fieldErrors: {}, formMessage: message };
  return {
    errorList: [{ text: message, href: `#${field}` }],
    fieldErrors: { [field]: message },
    formMessage: ''
  };
}

function statusEntry(status, req = null) {
  const key = trimmed(status);
  if (STUDIO_SUCCESS_KEYS[key]) {
    return {
      type: 'success',
      message: translateForRequest(`govuk_alpha_commerce.podcast_studio.${STUDIO_SUCCESS_KEYS[key]}`)
    };
  }
  if (STUDIO_ERROR_KEYS[key]) {
    // The API's own reason, kept by podcast-actions.js rememberApiReason(), read once.
    const reasons = req && typeof req.flash === 'function' ? req.flash('podcastApiReason') : [];
    return {
      type: 'error',
      message: translateForRequest(`govuk_alpha_commerce.podcast_studio.${STUDIO_ERROR_KEYS[key]}`),
      detail: Array.isArray(reasons) && reasons.length ? String(reasons[0]) : ''
    };
  }
  return null;
}

/** Whether the API will accept "publish" for this episode (PodcastService::publishEpisode). */
function mediaReady(row) {
  if (row.hosted_audio !== true) return true;
  return trimmed(row.media_processing_status) === 'complete'
    && ['clean', 'not_required'].includes(trimmed(row.media_scan_status));
}

/** One label for a show in the studio: draft, archived, awaiting review, not approved, or live. */
function showAvailability(row) {
  const status = trimmed(row.status) || 'draft';
  if (status === 'archived') return { key: 'govuk_alpha.podcasts.availability_archived', tag: 'govuk-tag--grey' };
  if (status !== 'published') return { key: 'govuk_alpha.podcasts.availability_draft', tag: 'govuk-tag--grey' };
  const moderation = trimmed(row.moderation_status) || 'approved';
  if (moderation === 'rejected' || moderation === 'flagged') return { key: 'govuk_alpha.podcasts.availability_rejected', tag: 'govuk-tag--red' };
  if (moderation !== 'approved') return { key: 'govuk_alpha.podcasts.availability_pending', tag: 'govuk-tag--yellow' };
  return { key: 'govuk_alpha_commerce.podcast_studio.status_published', tag: 'govuk-tag--green' };
}

function moderationFeedback(row) {
  const feedback = trimmed(row.moderation_feedback, 1000);
  return feedback
    ? translateForRequest('govuk_alpha_commerce.podcast_studio.moderation_feedback', { feedback })
    : '';
}

/** Studio view of an episode: its label, what can be done with it, and why not. */
function studioEpisode(episode, row) {
  const withLabel = withAvailability(episode, row);
  const status = trimmed(row.status) || 'draft';
  const ready = mediaReady(row);
  // A draft whose audio is not ready says so, because that — not "draft" — is why
  // there is no Publish button. Same rules as episodeAvailability()'s media check.
  const mediaLabel = !ready ? episodeAvailability({ ...row, status: 'published', moderation_status: 'approved', scheduled_for: null }) : null;
  const label = !withLabel.isLive && mediaLabel && status !== 'archived'
    ? { text: translateForRequest(mediaLabel.key), tag: mediaLabel.tag || 'govuk-tag--yellow' }
    : null;
  return {
    ...withLabel,
    // A live episode reads "Published"; anything else names why listeners cannot hear it.
    studioLabel: withLabel.isLive
      ? translateForRequest('govuk_alpha_commerce.podcast_studio.episode_status_published')
      : (label ? label.text : withLabel.availabilityLabel),
    studioTag: withLabel.isLive ? 'govuk-tag--green' : (label ? label.tag : withLabel.availabilityTag),
    // 🔴 Publish was offered for every non-published episode, including ones whose
    // audio was still being scanned or had failed; the API refused (409) and the page
    // said only "could not be published". Offered now only when it can succeed.
    canPublish: ['draft', 'archived'].includes(status) && ready,
    canArchive: status !== 'archived',
    moderationFeedback: moderationFeedback(row)
  };
}

/** Listener figures for a show, or null when listen analytics are switched off. */
function showStatsView(result) {
  const data = objectFrom(result);
  if (!data || data.enabled !== true || !data.totals || typeof data.totals !== 'object') return null;
  const count = (value) => Math.max(0, Math.floor(Number(value) || 0));
  return {
    days: count(data.days) || 30,
    listens: count(data.totals.listens),
    uniqueListeners: count(data.totals.unique_listeners),
    // PodcastService::completionRate() returns a whole-number percentage.
    completionRate: Math.min(100, count(data.totals.completion_rate)),
    subscribers: count(data.totals.subscribers),
    topEpisodes: (Array.isArray(data.top_episodes) ? data.top_episodes : [])
      .map((row) => ({ title: trimmed(row && row.title), listens: count(row && row.listen_count) }))
      .filter((row) => row.title !== '')
      .slice(0, 5)
  };
}

function requireToken(req, res) {
  const token = tokenFrom(req);
  if (!token) {
    redirectTo(res, loginRedirect());
    return '';
  }
  return token;
}

router.get('/', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;

  const path = indexPath(req.query);
  try {
    let result = await callPodcast(token, 'GET', path);
    let meta = metaFrom(result);
    const requestedCategory = trimmed(req.query.category);
    const firstCategories = Array.isArray(meta.categories)
      ? meta.categories.map((category) => trimmed(category)).filter(Boolean)
      : [];
    if (requestedCategory && !firstCategories.includes(requestedCategory)) {
      result = await callPodcast(token, 'GET', indexPath({ ...req.query, category: '' }));
      meta = metaFrom(result);
    }
    const shows = rowsFrom(result)
      .map((show) => decorateShow(show))
      .filter((show) => show.id !== null);

    let canAccessPodcastStudio = false;
    try {
      const studioResult = await callPodcast(token, 'GET', '/mine');
      canAccessPodcastStudio = podcastStudioAccessible(metaFrom(studioResult));
    } catch (error) {
      if (!isForbidden(error) && !isAuthError(error)) {
        canAccessPodcastStudio = false;
      }
    }

    const categories = Array.isArray(meta.categories)
      ? meta.categories.map((category) => trimmed(category)).filter(Boolean)
      : [];
    const category = categories.includes(trimmed(req.query.category)) ? trimmed(req.query.category) : '';

    return res.render('podcasts/index', {
      title: res.locals.t('govuk_alpha.podcasts.title'),
      activeNav: 'explore',
      shows,
      canAccessPodcastStudio,
      query: trimmed(req.query.q),
      sort: sortFrom(req.query),
      category,
      categories,
      paginationItems: paginationItems({ ...req.query, category }, meta)
    });
  } catch (error) {
    return renderPodcastError(error, res);
  }
}));

router.get('/studio', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;

  try {
    const result = await callPodcast(token, 'GET', '/mine');
    const meta = metaFrom(result);
    const shows = rowsFrom(result)
      .map((show) => decorateShow(show))
      .filter((show) => show.id !== null);

    return res.render('podcasts/studio', {
      title: res.locals.t('govuk_alpha_commerce.podcast_studio.title'),
      activeNav: 'explore',
      shows,
      canCreateShow: meta.can_create_show === true,
      status: statusEntry(req.query.status, req)
    });
  } catch (error) {
    return renderPodcastError(error, res, 'Podcast studio');
  }
}));

router.get('/studio/new', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;

  try {
    const [result, profileResult] = await Promise.all([
      callPodcast(token, 'GET', '/mine'),
      getRequestProfile(req, token).catch(() => null)
    ]);
    const profile = objectFrom(profileResult) || {};
    const meta = metaFrom(result);
    if (meta.can_create_show !== true) {
      res.status(403).render('errors/403', { title: 'Access denied' });
      return undefined;
    }

    return res.render('podcasts/form', {
      title: res.locals.t('govuk_alpha_commerce.podcast_studio.title_create'),
      activeNav: 'explore',
      mode: 'create',
      action: '/podcasts/studio/new',
      show: {
        title: '',
        slug: '',
        summary: '',
        description: '',
        category: '',
        language: trimmed(profile.preferred_language || req.locale || 'en', 20),
        author_name: trimmed(profile.name, 200),
        owner_email: trimmed(profile.email, 320),
        copyright: '',
        funding_url: '',
        explicit: false,
        visibility: 'public'
      },
      visibilities: meta.enable_private_shows === true ? ['public', 'members', 'private'] : ['public'],
      status: statusEntry(req.query.status, req),
      ...showFormErrors(req.query.status)
    });
  } catch (error) {
    return renderPodcastError(error, res, 'Create a podcast');
  }
}));

router.get('/studio/:id(\\d+)', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;

  const showId = positiveInteger(req.params.id);
  try {
    const result = await callPodcast(token, 'GET', '/mine');
    const meta = metaFrom(result);
    const shows = rowsFrom(result).map((show) => decorateShow(show));
    const show = shows.find((row) => row.id === showId);
    if (!show) {
      res.status(404).render('errors/404', { title: (res.locals.t ? res.locals.t('govuk_alpha.error_pages.404_title') : 'Page not found') });
      return undefined;
    }

    // Listen figures, as the website's stats panel shows them. Optional: the studio
    // still works when they cannot be read or analytics are switched off.
    let statsResult = null;
    try {
      statsResult = await callPodcast(token, 'GET', `/${encodeURIComponent(show.id)}/stats?days=30`);
    } catch {
      statsResult = null;
    }
    const stats = showStatsView(statsResult);
    const availability = showAvailability(show);
    show.studioLabel = translateForRequest(availability.key);
    show.studioTag = availability.tag;
    show.moderationFeedback = moderationFeedback(show);
    show.subscriberCount = Math.max(0, Math.floor(Number(show.subscriber_count) || 0));

    const episodeVisibilities = meta.enable_private_shows === true
      ? ['inherit', 'public', 'members', 'private']
      : ['inherit', 'public'];
    const episodes = studioEpisodes(show).map((episode) => ({
      ...episode,
      visibility: ['inherit', 'public', 'members', 'private'].includes(trimmed(episode.visibility))
        ? trimmed(episode.visibility)
        : 'inherit',
      visibilityOptions: [...new Set([...episodeVisibilities, trimmed(episode.visibility)].filter(Boolean))]
    }));
    return res.render('podcasts/manage', {
      title: res.locals.t('govuk_alpha_commerce.podcast_studio.title_edit'),
      activeNav: 'explore',
      show,
      episodes,
      visibilities: meta.enable_private_shows === true
        ? ['public', 'members', 'private']
        : [...new Set(['public', ['members', 'private'].includes(show.visibility) ? show.visibility : null].filter(Boolean))],
      episodeVisibilities,
      transcriptsEnabled: meta.enable_transcripts === true,
      chaptersEnabled: meta.enable_chapters === true,
      rssFeedEnabled: meta.enable_rss_feed !== false,
      stats,
      status: statusEntry(req.query.status, req),
      episodeStoreAction: `/podcasts/studio/${show.id}/episodes`
    });
  } catch (error) {
    return renderPodcastError(error, res, 'Edit your podcast');
  }
}));

// Episode-specific feed issues carry the episode id ("episode_12_missing_audio_url");
// the website collapses them the same way (react-frontend/src/lib/podcasts/feedIssues.ts).
const FEED_ISSUE_KEYS = [
  'show_not_public', 'missing_public_episodes', 'missing_title', 'missing_description',
  'missing_language', 'missing_artwork', 'episode_media_not_ready', 'episode_missing_audio_url',
  'episode_missing_audio_length', 'episode_missing_audio_mime'
];

function feedIssueText(issue) {
  const key = trimmed(issue).replace(/^episode_\d+_/, 'episode_');
  return FEED_ISSUE_KEYS.includes(key)
    ? translateForRequest(`govuk_alpha_commerce.podcast_studio.feed_issue_${key}`)
    : translateForRequest('govuk_alpha_commerce.podcast_studio.feed_issue_other', { issue: trimmed(issue, 120) });
}

// RSS feed check, as the website's "Validate feed" (GET /v2/podcasts/{id}/validate-feed):
// whether podcast directories can read the show's feed, and what to fix first.
router.get('/studio/:id(\\d+)/feed-check', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;

  const showId = positiveInteger(req.params.id);
  try {
    const feedResult = await callPodcast(token, 'GET', `/${encodeURIComponent(showId)}/validate-feed`);
    const result = objectFrom(feedResult) || {};
    const unique = (rows) => [...new Set((Array.isArray(rows) ? rows : []).map(feedIssueText))];
    return res.render('podcasts/feed-check', {
      title: res.locals.t('govuk_alpha_commerce.podcast_studio.feed_check_title'),
      activeNav: 'explore',
      showId,
      valid: result.valid === true,
      errors: unique(result.errors),
      warnings: unique(result.warnings),
      skipped: Math.max(0, Math.floor(Number(result.skipped_episode_count) || 0))
    });
  } catch (error) {
    return renderPodcastError(error, res, 'Podcast feed check');
  }
}));

router.get('/:showId(\\d+)/episodes/:id(\\d+)', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;

  const showId = positiveInteger(req.params.showId);
  const episodeId = positiveInteger(req.params.id);
  try {
    const result = await callPodcast(token, 'GET', `/${encodeURIComponent(showId)}/${encodeURIComponent(episodeId)}`);
    const episodeData = objectFrom(result);
    if (!episodeData) {
      res.status(404).render('errors/404', { title: (res.locals.t ? res.locals.t('govuk_alpha.error_pages.404_title') : 'Page not found') });
      return undefined;
    }

    const show = decorateShow(episodeData.show || { id: showId });
    const episode = withAvailability(decorateEpisode(episodeData, show.id), episodeData);
    const statusConfig = EPISODE_PAGE_STATUS_KEYS[trimmed(req.query.status)];
    return res.render('podcasts/episode', {
      title: episode.title,
      activeNav: 'explore',
      show,
      episode,
      // As on the website: likes only when the community has them switched on, and the
      // chapter list and transcript only when those are switched on (the API blanks them).
      reactionsEnabled: episodeData.reactions_enabled !== false,
      viewerLikes: episodeData.viewer_has_reacted === true,
      likeCount: Math.max(0, Math.floor(Number(episodeData.reaction_count) || 0)),
      status: statusConfig ? { type: statusConfig.type, message: res.locals.t(statusConfig.key) } : null
    });
  } catch (error) {
    return renderPodcastError(error, res, 'Podcast episode');
  }
}));

// The transcript as a text file, as the website's "Download transcript". Served from
// here rather than the API's distribution route, which answers only for public episodes.
router.get('/:showId(\\d+)/episodes/:id(\\d+)/transcript.txt', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;

  const showId = positiveInteger(req.params.showId);
  const episodeId = positiveInteger(req.params.id);
  try {
    const episodeData = objectFrom(await callPodcast(token, 'GET', `/${encodeURIComponent(showId)}/${encodeURIComponent(episodeId)}`));
    const transcript = episodeData ? String(episodeData.transcript || '').trim() : '';
    if (!transcript) {
      res.status(404).render('errors/404', { title: res.locals.t('govuk_alpha.error_pages.404_title') });
      return undefined;
    }
    const slug = trimmed(episodeData.slug).replace(/[^a-z0-9-]/gi, '') || `episode-${episodeId}`;
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${slug}-transcript.txt"`);
    res.set('Cache-Control', 'private, no-store');
    return res.send(transcript);
  } catch (error) {
    return renderPodcastError(error, res, 'Podcast episode');
  }
}));

router.get('/:id(\\d+)', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;

  const showId = positiveInteger(req.params.id);
  try {
    const [result, profileResult] = await Promise.all([
      callPodcast(token, 'GET', `/${encodeURIComponent(showId)}`),
      getRequestProfile(req, token).catch(() => null)
    ]);
    const showData = objectFrom(result);
    if (!showData) {
      res.status(404).render('errors/404', { title: (res.locals.t ? res.locals.t('govuk_alpha.error_pages.404_title') : 'Page not found') });
      return undefined;
    }

    const show = decorateShow({ id: showId, ...showData });
    // Same address as the website: /api/v2/podcasts/feed/{tenantId}/{slug}.xml. Podcast
    // apps send no community header, so the tenant id has to be in the address.
    const tenantId = positiveInteger(req.accessibleRouting && req.accessibleRouting.tenant && req.accessibleRouting.tenant.id);
    if (showData.rss_enabled === true && tenantId !== null && trimmed(showData.slug)) {
      show.rssUrl = resolveBackendMediaUrl(`/api/v2/podcasts/feed/${tenantId}/${encodeURIComponent(trimmed(showData.slug))}.xml`);
      show.rssEnabled = Boolean(show.rssUrl);
    }
    const episodes = showEpisodes(show);
    const profile = objectFrom(profileResult) || {};
    const viewerId = positiveInteger(profile.id);
    // As on the website: the owner manages the show and is not offered "Subscribe".
    const isOwner = viewerId !== null && viewerId === positiveInteger(showData.owner_user_id);
    const statusConfig = PODCAST_STATUS_KEYS[trimmed(req.query.status)];
    return res.render('podcasts/detail', {
      title: show.title,
      activeNav: 'explore',
      show,
      episodes,
      isOwner,
      hasUnlistedEpisodes: episodes.some((episode) => !episode.isLive),
      status: statusConfig ? {
        type: statusConfig.type,
        message: res.locals.t(`govuk_alpha.polish_commerce.${statusConfig.key}`)
      } : null,
      isSubscribed: Boolean(showData.is_subscribed || showData.subscribed)
    });
  } catch (error) {
    return renderPodcastError(error, res, 'Podcast');
  }
}));

module.exports = router;
