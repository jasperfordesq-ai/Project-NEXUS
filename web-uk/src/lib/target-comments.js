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

async function loadTargetComments(token, targetType, targetId) {
  if (!token) return [];
  try {
    return commentRows(await getComments(token, { target_type: targetType, target_id: targetId }));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    return [];
  }
}

const SOCIAL_STATUSES = new Set([
  'comment-created', 'comment-updated', 'comment-deleted', 'like-added', 'like-removed',
  'reaction-added', 'reaction-removed', 'comment-empty', 'comment-failed', 'comment-update-failed',
  'comment-delete-failed', 'like-failed', 'reaction-failed', 'auth-required'
]);

function socialStatusFrom(value) {
  const status = String(value ?? '').trim();
  return SOCIAL_STATUSES.has(status) ? status : '';
}

module.exports = { loadTargetComments, commentRows, socialStatusFrom };
