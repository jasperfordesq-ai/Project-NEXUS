// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const fs = require('fs/promises');
const {
  callPodcastApi,
  uploadPodcastArtwork,
  uploadPodcastEpisode,
  updatePodcastEpisode,
  uploadPodcastEpisodeCover,
  ApiError
} = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');

const router = express.Router();

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

function checked(value) {
  return value === true || ['1', 'true', 'on', 'yes'].includes(String(value || '').toLowerCase());
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

function isAuthError(error) {
  return error instanceof ApiError && error.status === 401;
}

function metaFrom(result) {
  if (result && result.meta && typeof result.meta === 'object' && !Array.isArray(result.meta)) {
    return result.meta;
  }
  const data = dataFrom(result);
  return data && data.meta && typeof data.meta === 'object' && !Array.isArray(data.meta) ? data.meta : {};
}

function redirectTo(res, pathname) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return res.redirect(urlFor(pathname));
}

function redirectOnAuthError(error, res) {
  if (isAuthError(error)) {
    redirectTo(res, loginRedirect());
    return true;
  }
  return false;
}

async function callPodcast(token, method, path, data = undefined) {
  if (data === undefined) {
    return callPodcastApi(token, method, path);
  }

  return callPodcastApi(token, method, path, data);
}

function statusRedirect(path, status) {
  return `${path}?status=${encodeURIComponent(status)}`;
}

function studioRedirect(showId, status) {
  return statusRedirect(`/podcasts/studio/${showId}`, status);
}

function allowedVisibility(value) {
  const visibility = trimmed(value);
  return ['public', 'members', 'private'].includes(visibility) ? visibility : 'public';
}

function showPayload(body, defaultLanguage = '') {
  const payload = {
    title: trimmed(body.title, 200),
    summary: trimmed(body.summary, 600),
    description: trimmed(body.description, 20000),
    category: trimmed(body.category, 120),
    language: trimmed(body.language, 20) || trimmed(defaultLanguage, 20),
    author_name: trimmed(body.author_name, 200),
    owner_email: trimmed(body.owner_email, 320),
    copyright: trimmed(body.copyright, 300),
    funding_url: trimmed(body.funding_url),
    explicit: checked(body.explicit),
    visibility: allowedVisibility(body.visibility)
  };

  const slug = trimmed(body.slug, 200);
  if (slug !== '') payload.slug = slug;
  return payload;
}

function nonNegativeInteger(value) {
  const raw = trimmed(value);
  if (raw === '') return { value: null, present: false, valid: true };
  const number = Number(raw);
  const integer = Math.trunc(number);
  return {
    value: Number.isFinite(number) && integer >= 0 ? integer : null,
    present: true,
    valid: Number.isFinite(number) && integer >= 0
  };
}

function episodePayload(body, options = {}) {
  const payload = {
    title: trimmed(body.episode_title || body.title, 200),
    summary: trimmed(body.episode_summary || body.summary, 600),
    description: trimmed(body.episode_description || body.description, 20000),
    explicit: checked(body.episode_explicit),
    episode_type: ['full', 'trailer', 'bonus'].includes(trimmed(body.episode_type))
      ? trimmed(body.episode_type)
      : 'full',
    visibility: ['inherit', 'public', 'members', 'private'].includes(trimmed(body.episode_visibility))
      ? trimmed(body.episode_visibility)
      : 'inherit'
  };
  const errors = [];

  const slug = trimmed(body.episode_slug, 200);
  if (!options.update && slug !== '') payload.slug = slug;

  const audioUrl = trimmed(body.audio_url);
  if (audioUrl !== '') {
    payload.audio_url = audioUrl;
  }

  ['episode_number', 'season_number', 'duration_seconds', 'audio_bytes'].forEach((field) => {
    const parsed = nonNegativeInteger(body[field]);
    if (!parsed.valid) errors.push(field);
    if (parsed.present) payload[field] = parsed.value;
    else if (options.update) payload[field] = null;
  });

  const audioMime = trimmed(body.audio_mime, 120);
  if (audioMime !== '') payload.audio_mime = audioMime;

  const scheduledFor = trimmed(body.scheduled_for);
  if (scheduledFor !== '') payload.scheduled_for = scheduledFor;
  else if (options.update) payload.scheduled_for = null;

  if (options.transcriptsEnabled) {
    payload.transcript = trimmed(body.transcript, 200000);
    payload.transcript_language = trimmed(body.transcript_language, 20);
  }

  if (options.chaptersEnabled) {
    const chaptersJson = trimmed(body.chapters_json);
    if (chaptersJson === '') {
      if (options.update) payload.chapters = [];
    } else {
      try {
        const chapters = JSON.parse(chaptersJson);
        if (!Array.isArray(chapters)) errors.push('chapters_json');
        else payload.chapters = chapters;
      } catch {
        errors.push('chapters_json');
      }
    }
  }

  return { payload, errors };
}

async function podcastMeta(token) {
  return metaFrom(await callPodcast(token, 'GET', '/mine'));
}

async function bufferedUpload(file, fallbackName) {
  return {
    buffer: await fs.readFile(file.filepath),
    filename: trimmed(file.originalFilename) || fallbackName,
    contentType: trimmed(file.mimetype) || 'application/octet-stream',
    size: file.size
  };
}

function exceedsFileLimit(file, maxSizeMb) {
  const limit = Number(maxSizeMb);
  return Boolean(file && Number.isFinite(limit) && limit > 0 && Number(file.size) > limit * 1024 * 1024);
}

function uploadedFile(req, fieldName) {
  const file = req.files && req.files[fieldName];
  return file && typeof file === 'object' ? file : null;
}

async function removeUploadedFile(file) {
  if (!file || !file.filepath) return;
  try {
    await fs.unlink(file.filepath);
  } catch {
    // Temporary upload cleanup is best-effort only.
  }
}

async function updateEpisodeFromStudio(req, res, token, showId, episodeId) {
  const file = uploadedFile(req, 'audio');
  const cover = uploadedFile(req, 'cover');
  let meta;
  try {
    meta = await podcastMeta(token);
  } catch (error) {
    await Promise.all([removeUploadedFile(file), removeUploadedFile(cover)]);
    if (redirectOnAuthError(error, res)) return undefined;
    return redirectTo(res, studioRedirect(showId, 'episode-save-failed'));
  }
  const { payload, errors } = episodePayload(req.body, {
    update: true,
    transcriptsEnabled: meta.enable_transcripts === true,
    chaptersEnabled: meta.enable_chapters === true
  });
  if (exceedsFileLimit(file, meta.max_audio_size_mb) || exceedsFileLimit(cover, 8)) {
    await Promise.all([removeUploadedFile(file), removeUploadedFile(cover)]);
    return redirectTo(res, studioRedirect(showId, 'episode-save-failed'));
  }
  if (payload.title === '') {
    await Promise.all([removeUploadedFile(file), removeUploadedFile(cover)]);
    return redirectTo(res, studioRedirect(showId, 'episode-title-missing'));
  }
  if (errors.length > 0) {
    await Promise.all([removeUploadedFile(file), removeUploadedFile(cover)]);
    return redirectTo(res, studioRedirect(showId, 'episode-save-failed'));
  }

  let status = 'episode-saved';
  try {
    if (file) {
      await updatePodcastEpisode(token, showId, episodeId, {
        ...payload,
        file: await bufferedUpload(file, 'podcast-audio')
      });
    } else {
      await callPodcast(token, 'PUT', `/${showId}/episodes/${episodeId}`, payload);
    }
    if (cover) {
      await uploadPodcastEpisodeCover(
        token,
        showId,
        episodeId,
        await bufferedUpload(cover, 'podcast-episode-cover')
      );
    }
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    status = 'episode-save-failed';
  } finally {
    await Promise.all([removeUploadedFile(file), removeUploadedFile(cover)]);
  }

  return redirectTo(res, studioRedirect(showId, status));
}

router.post('/:id(\\d+)/subscribe', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const id = Number(req.params.id);
  let status = 'subscribe-failed';
  try {
    const result = await callPodcast(token, 'POST', `/${id}/subscribe`);
    const data = dataFrom(result);
    status = data && data.subscribed === false ? 'unsubscribed' : 'subscribed';
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
  }

  return redirectTo(res, statusRedirect(`/podcasts/${id}`, status));
}));

router.post('/studio/new', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const payload = showPayload(req.body, req.locale || 'en');
  const artwork = uploadedFile(req, 'artwork');
  if (payload.title === '') {
    await removeUploadedFile(artwork);
    return redirectTo(res, statusRedirect('/podcasts/studio/new', 'show-title-missing'));
  }

  let showId = null;
  try {
    const result = await callPodcast(token, 'POST', '', payload);
    const data = dataFrom(result);
    showId = positiveInteger(data && (data.id || data.show_id));
  } catch (error) {
    await removeUploadedFile(artwork);
    if (redirectOnAuthError(error, res)) return undefined;
    return redirectTo(res, statusRedirect('/podcasts/studio/new', 'show-create-failed'));
  }

  if (showId === null) {
    await removeUploadedFile(artwork);
    return redirectTo(res, statusRedirect('/podcasts/studio/new', 'show-create-failed'));
  }

  try {
    if (artwork) {
      const buffer = await fs.readFile(artwork.filepath);
      await uploadPodcastArtwork(token, showId, {
        buffer,
        filename: trimmed(artwork.originalFilename) || 'podcast-artwork',
        contentType: trimmed(artwork.mimetype) || 'application/octet-stream'
      });
    }
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    return redirectTo(res, studioRedirect(showId, 'show-save-failed'));
  } finally {
    await removeUploadedFile(artwork);
  }

  return redirectTo(res, studioRedirect(showId, 'show-created'));
}));

router.post('/studio/:id(\\d+)/update', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const id = Number(req.params.id);
  const episodeId = positiveInteger(req.body.episode_id);
  if (episodeId !== null) {
    return updateEpisodeFromStudio(req, res, token, id, episodeId);
  }
  const payload = showPayload(req.body);
  delete payload.slug;
  if (payload.language === '') delete payload.language;
  const artwork = uploadedFile(req, 'artwork');
  if (exceedsFileLimit(artwork, 8)) {
    await removeUploadedFile(artwork);
    return redirectTo(res, studioRedirect(id, 'show-save-failed'));
  }
  if (payload.title === '') {
    await removeUploadedFile(artwork);
    return redirectTo(res, studioRedirect(id, 'show-title-missing'));
  }

  let status = 'show-saved';
  try {
    await callPodcast(token, 'PUT', `/${id}`, payload);
    if (artwork) {
      const buffer = await fs.readFile(artwork.filepath);
      await uploadPodcastArtwork(token, id, {
        buffer,
        filename: trimmed(artwork.originalFilename) || 'podcast-artwork',
        contentType: trimmed(artwork.mimetype) || 'application/octet-stream'
      });
    }
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    status = 'show-save-failed';
  } finally {
    await removeUploadedFile(artwork);
  }

  return redirectTo(res, studioRedirect(id, status));
}));

router.post('/studio/:id(\\d+)/publish', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const id = Number(req.params.id);
  let status = 'show-publish-failed';
  try {
    const result = await callPodcast(token, 'POST', `/${id}/publish`);
    const data = dataFrom(result);
    status = data && data.moderation_status && data.moderation_status !== 'approved'
      ? 'show-pending-review'
      : 'show-published';
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
  }

  return redirectTo(res, studioRedirect(id, status));
}));

router.post('/studio/:id(\\d+)/delete', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const id = Number(req.params.id);
  let status = 'show-deleted';
  try {
    await callPodcast(token, 'DELETE', `/${id}`);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    status = 'show-delete-failed';
  }

  return redirectTo(res, statusRedirect('/podcasts/studio', status));
}));

router.post('/studio/:id(\\d+)/episodes', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const id = Number(req.params.id);
  const file = uploadedFile(req, 'audio');
  const cover = uploadedFile(req, 'cover');
  let meta;
  try {
    meta = await podcastMeta(token);
  } catch (error) {
    await Promise.all([removeUploadedFile(file), removeUploadedFile(cover)]);
    if (redirectOnAuthError(error, res)) return undefined;
    return redirectTo(res, studioRedirect(id, 'episode-failed'));
  }
  const { payload, errors } = episodePayload(req.body, {
    transcriptsEnabled: meta.enable_transcripts === true,
    chaptersEnabled: meta.enable_chapters === true
  });
  if (exceedsFileLimit(file, meta.max_audio_size_mb) || exceedsFileLimit(cover, 8)) {
    await Promise.all([removeUploadedFile(file), removeUploadedFile(cover)]);
    return redirectTo(res, studioRedirect(id, 'episode-invalid-audio'));
  }
  if (payload.title === '') {
    await Promise.all([removeUploadedFile(file), removeUploadedFile(cover)]);
    return redirectTo(res, studioRedirect(id, 'episode-title-missing'));
  }
  if (!payload.audio_url && !file) {
    await removeUploadedFile(cover);
    return redirectTo(res, studioRedirect(id, 'episode-audio-missing'));
  }
  if (errors.length > 0) {
    await Promise.all([removeUploadedFile(file), removeUploadedFile(cover)]);
    return redirectTo(res, studioRedirect(id, 'episode-failed'));
  }

  let status = 'episode-added';
  let episodeId = null;
  try {
    try {
      let result;
      if (file) {
        result = await uploadPodcastEpisode(token, id, {
          ...payload,
          file: await bufferedUpload(file, 'podcast-audio')
        });
      } else {
        result = await callPodcast(token, 'POST', `/${id}/episodes`, payload);
      }
      const data = dataFrom(result);
      episodeId = positiveInteger(data && (data.id || data.episode_id));
    } catch (error) {
      if (redirectOnAuthError(error, res)) return undefined;
      status = error instanceof ApiError && error.status === 422 ? 'episode-invalid-audio' : 'episode-failed';
    }

    if (status === 'episode-added' && cover) {
      try {
        if (episodeId === null) throw new Error('Podcast episode ID missing after create');
        await uploadPodcastEpisodeCover(token, id, episodeId, await bufferedUpload(cover, 'podcast-episode-cover'));
      } catch (error) {
        if (redirectOnAuthError(error, res)) return undefined;
        status = 'episode-save-failed';
      }
    }

    return redirectTo(res, studioRedirect(id, status));
  } finally {
    await Promise.all([removeUploadedFile(file), removeUploadedFile(cover)]);
  }
}));

router.post('/studio/:id(\\d+)/episodes/:episodeId(\\d+)/publish', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const id = Number(req.params.id);
  const episodeId = Number(req.params.episodeId);
  let status = 'episode-published';
  try {
    await callPodcast(token, 'POST', `/${id}/episodes/${episodeId}/publish`);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    status = 'episode-publish-failed';
  }

  return redirectTo(res, studioRedirect(id, status));
}));

router.post('/studio/:id(\\d+)/episodes/:episodeId(\\d+)/delete', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const id = Number(req.params.id);
  const episodeId = Number(req.params.episodeId);
  let status = 'episode-deleted';
  try {
    await callPodcast(token, 'DELETE', `/${id}/episodes/${episodeId}`);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    status = 'episode-delete-failed';
  }

  return redirectTo(res, studioRedirect(id, status));
}));

module.exports = router;
