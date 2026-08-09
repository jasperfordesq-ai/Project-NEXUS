// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { callPodcastApi, ApiError } = require('../lib/api');
const { resolveBackendAssetUrl } = require('../lib/accessible-shell');
const { getRequestProfile } = require('../lib/request-profile');
const { asyncRoute } = require('../lib/routeHelpers');

const router = express.Router();

const PODCAST_SORTS = ['newest', 'title', 'episodes', 'followers'];
const SHOW_STATUS_LABELS = {
  published: 'Published',
  draft: 'Draft',
  archived: 'Archived'
};
const SHOW_STATUS_TAGS = {
  published: 'govuk-tag--green',
  draft: 'govuk-tag--grey',
  archived: 'govuk-tag--red'
};
const EPISODE_STATUS_LABELS = {
  published: 'Published',
  draft: 'Draft',
  archived: 'Archived'
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
  'episode-deleted': 'status_episode_deleted'
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
  'episode-publish-failed': 'status_episode_publish_failed',
  'episode-delete-failed': 'status_episode_delete_failed'
};
const PODCAST_STATUS_KEYS = {
  subscribed: { type: 'success', key: 'podcast_subscribe_success' },
  unsubscribed: { type: 'success', key: 'podcast_unsubscribe_success' },
  'subscribe-failed': { type: 'error', key: 'podcast_subscribe_failed' }
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
    res.status(404).render('errors/404', { title: 'Page not found' });
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
  return url.startsWith('/') ? resolveBackendAssetUrl(url) : url;
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
  return String(value || '').replace(/<[^>]+>/g, '');
}

function limitedText(value, limit) {
  const text = stripHtml(value).trim();
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 3)).trimEnd()}...` : text;
}

function episodeCountLabel(count) {
  const number = Number.isFinite(Number(count)) ? Number(count) : 0;
  if (number === 0) return 'No episodes';
  if (number === 1) return '1 episode';
  return `${number} episodes`;
}

function decorateShow(show, t = null) {
  const row = show && typeof show === 'object' ? show : {};
  const id = positiveInteger(row.id);
  const title = trimmed(row.title) || (t ? t('govuk_alpha.podcasts.title') : 'Podcasts');
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
      ? (t ? t('govuk_alpha.podcasts.by_label', { name: ownerName }) : `By ${ownerName}`)
      : '',
    artworkUrl: backendRelativeUrl(row.artwork_url),
    rssUrl: backendRelativeUrl(row.rss_url),
    rssEnabled: Boolean(row.rss_enabled) && backendRelativeUrl(row.rss_url),
    episodeCount: Number.isFinite(Number(episodeCount)) ? Number(episodeCount) : 0,
    episodeCountLabel: episodeCountLabel(episodeCount),
    status,
    statusLabel: t && Object.hasOwn(SHOW_STATUS_LABELS, status)
      ? t(`govuk_alpha_commerce.podcast_studio.status_${status}`)
      : (SHOW_STATUS_LABELS[status] || status),
    statusTag: SHOW_STATUS_TAGS[status] || 'govuk-tag--grey',
    visibility: ['public', 'members', 'private'].includes(trimmed(row.visibility)) ? trimmed(row.visibility) : 'public',
    moderationStatus: trimmed(row.moderation_status) || 'approved'
  };
}

function decorateEpisode(episode, showId = null, t = null) {
  const row = episode && typeof episode === 'object' ? episode : {};
  const id = positiveInteger(row.id);
  const status = trimmed(row.status) || 'draft';
  const number = positiveInteger(row.episode_number);

  return {
    ...row,
    id,
    showId: positiveInteger(row.show_id) || showId,
    title: trimmed(row.title) || (t ? t('govuk_alpha.podcasts.episodes_title') : 'Episodes'),
    description: stripHtml(row.description || row.summary || ''),
    cardDescription: limitedText(row.description || row.summary || '', 240),
    audioUrl: backendRelativeUrl(row.audio_url),
    coverImageUrl: backendRelativeUrl(row.cover_image_url),
    transcript: String(row.transcript || '').trim(),
    chaptersJson: Array.isArray(row.chapters) ? JSON.stringify(row.chapters.map((chapter) => ({
      title: trimmed(chapter.title),
      starts_at_seconds: Math.max(0, Number(chapter.starts_at_seconds) || 0),
      ...(trimmed(chapter.url) ? { url: trimmed(chapter.url) } : {})
    })), null, 2) : '',
    scheduledFor: trimmed(row.scheduled_for).slice(0, 16),
    status,
    statusLabel: t && Object.hasOwn(EPISODE_STATUS_LABELS, status)
      ? t(`govuk_alpha_commerce.podcast_studio.episode_status_${status}`)
      : (EPISODE_STATUS_LABELS[status] || status),
    statusTag: EPISODE_STATUS_TAGS[status] || 'govuk-tag--grey',
    episodeNumber: number,
    episodeNumberLabel: number !== null
      ? (t ? t('govuk_alpha_commerce.podcast_studio.episode_number_short', { number }) : `Episode ${number}`)
      : ''
  };
}

function showEpisodes(show) {
  const rows = Array.isArray(show.episodes) ? show.episodes : [];
  return rows
    .filter((episode) => !episode.status || episode.status === 'published')
    .map((episode) => decorateEpisode(episode, show.id))
    .filter((episode) => episode.id !== null);
}

function studioEpisodes(show, t = null) {
  const rows = Array.isArray(show.episodes) ? show.episodes : [];
  return rows
    .map((episode) => decorateEpisode(episode, show.id, t))
    .filter((episode) => episode.id !== null);
}

function statusEntry(status, t = null) {
  const key = trimmed(status);
  if (STUDIO_SUCCESS_KEYS[key]) {
    return {
      type: 'success',
      message: t ? t(`govuk_alpha_commerce.podcast_studio.${STUDIO_SUCCESS_KEYS[key]}`) : STUDIO_SUCCESS_KEYS[key]
    };
  }
  if (STUDIO_ERROR_KEYS[key]) {
    return {
      type: 'error',
      message: t ? t(`govuk_alpha_commerce.podcast_studio.${STUDIO_ERROR_KEYS[key]}`) : STUDIO_ERROR_KEYS[key]
    };
  }
  return null;
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
      .map((show) => decorateShow(show, res.locals.t))
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
      .map((show) => decorateShow(show, res.locals.t))
      .filter((show) => show.id !== null);

    return res.render('podcasts/studio', {
      title: res.locals.t('govuk_alpha_commerce.podcast_studio.title'),
      activeNav: 'explore',
      shows,
      canCreateShow: meta.can_create_show === true,
      status: statusEntry(req.query.status, res.locals.t)
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
      status: statusEntry(req.query.status, res.locals.t)
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
    const shows = rowsFrom(result).map((show) => decorateShow(show, res.locals.t));
    const show = shows.find((row) => row.id === showId);
    if (!show) {
      res.status(404).render('errors/404', { title: 'Page not found' });
      return undefined;
    }

    const episodeVisibilities = meta.enable_private_shows === true
      ? ['inherit', 'public', 'members', 'private']
      : ['inherit', 'public'];
    const episodes = studioEpisodes(show, res.locals.t).map((episode) => ({
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
      status: statusEntry(req.query.status, res.locals.t),
      episodeStoreAction: `/podcasts/studio/${show.id}/episodes`
    });
  } catch (error) {
    return renderPodcastError(error, res, 'Edit your podcast');
  }
}));

router.get('/:showId(\\d+)/episodes/:id(\\d+)', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;

  const showId = positiveInteger(req.params.showId);
  const episodeId = positiveInteger(req.params.id);
  try {
    const result = await callPodcast(token, 'GET', `/${showId}/${episodeId}`);
    const episodeData = objectFrom(result);
    if (!episodeData) {
      res.status(404).render('errors/404', { title: 'Page not found' });
      return undefined;
    }

    const show = decorateShow(episodeData.show || { id: showId });
    const episode = decorateEpisode(episodeData, show.id);
    return res.render('podcasts/episode', {
      title: episode.title,
      activeNav: 'explore',
      show,
      episode
    });
  } catch (error) {
    return renderPodcastError(error, res, 'Podcast episode');
  }
}));

router.get('/:id(\\d+)', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (!token) return undefined;

  const showId = positiveInteger(req.params.id);
  try {
    const result = await callPodcast(token, 'GET', `/${showId}`);
    const showData = objectFrom(result);
    if (!showData) {
      res.status(404).render('errors/404', { title: 'Page not found' });
      return undefined;
    }

    const show = decorateShow({ id: showId, ...showData }, res.locals.t);
    const episodes = showEpisodes(show).map((episode) => decorateEpisode(episode, show.id, res.locals.t));
    const statusConfig = PODCAST_STATUS_KEYS[trimmed(req.query.status)];
    return res.render('podcasts/detail', {
      title: show.title,
      activeNav: 'explore',
      show,
      episodes,
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
