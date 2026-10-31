// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Comments on one non-feed target (an event, a volunteering opportunity), read
 * from GET /api/v2/comments?target_type=…&target_id=… and shaped for the shared
 * `feed/_comments.njk` list (same projection as feed.js `feedCommentRows`).
 *
 * A failed read is not an error page: the section says there are no comments
 * yet and the member can still add one. A 401 is re-thrown so the caller's
 * sign-in handling runs.
 */

const { getComments, ApiError } = require('./api');
const { resolveBackendMediaUrl } = require('./accessible-shell');

function projectComment(comment) {
  const source = comment && typeof comment === 'object' ? comment : {};
  const author = source.author && typeof source.author === 'object' ? source.author : {};
  return {
    ...source,
    author: {
      ...author,
      avatarAssetUrl: resolveBackendMediaUrl(author.avatar || author.avatar_url || author.avatarUrl)
    },
    replies: Array.isArray(source.replies) ? source.replies.map(projectComment) : []
  };
}

function commentRows(result) {
  const data = result && typeof result === 'object' && result.data !== undefined ? result.data : result;
  const rows = Array.isArray(data) ? data : (data && Array.isArray(data.comments) ? data.comments : []);
  return rows.map(projectComment);
}

async function loadTargetComments(token, targetType, targetId, req, res) {
  if (!token) return [];
  try {
    const rows = commentRows(await getComments(token, { target_type: targetType, target_id: targetId }));
    return req && res ? require('./ugc-translation').translateCommentTree(req, res, token, rows) : rows;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    return [];
  }
}

const SOCIAL_STATUSES = new Set([
  'comment-created', 'comment-updated', 'comment-deleted', 'like-added', 'like-removed',
  'reaction-added', 'reaction-removed', 'comment-empty', 'comment-failed', 'comment-update-failed',
  'comment-delete-failed', 'like-failed', 'reaction-failed', 'auth-required',
  // Translating one comment (POST /feed/comments/:id/translate, 31 Oct 2026).
  'comment-translate-done', 'comment-translate-failed', 'comment-translate-same',
  'comment-translate-empty', 'translate-unavailable'
]);

function socialStatusFrom(value) {
  const status = String(value ?? '').trim();
  return SOCIAL_STATUSES.has(status) ? status : '';
}

/**
 * A comment translation made on the previous request for this target, shown
 * once under its comment, then forgotten (feed-actions.js stores it).
 */
async function takeCommentTranslation(req, targetType, targetId, res, token, rows = []) {
  const stored = req?.session?.targetCommentTranslation;
  if (!stored) return null;
  delete req.session.targetCommentTranslation;
  if (stored.targetType !== targetType || Number(stored.targetId) !== Number(targetId)) return null;
  const find = list => list.flatMap(row => [row, ...find(row.replies || [])]);
  const source = find(rows).find(row => Number(row.id) === Number(stored.commentId));
  if (!source || !res || !await require('./ugc-translation').validSavedTranslation(req, res, token, stored, 'comment', source.id, { body: require('./html-sanitizer').htmlToPlainText(source.content || source.body || '').slice(0, 8000).trim() })) return null;
  const text = String(stored.text || '').trim();
  if (!text) return null;
  return { commentId: Number(stored.commentId), text, locale: String(stored.locale || 'en').slice(0, 10) };
}

module.exports = { loadTargetComments, commentRows, socialStatusFrom, takeCommentTranslation };
