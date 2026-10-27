// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The reactions a member can give in the feed, exactly as React offers them:
 * eight on posts and feed items (react-frontend/src/components/social/reactions.ts)
 * and the first six on comments (hooks/useSocialInteractions.ts AVAILABLE_REACTIONS).
 *
 * The templates carry the same list in views/feed/_reactions.njk, together with
 * the symbols; the routes use this module to refuse anything else.
 */
const POST_REACTION_TYPES = Object.freeze([
  'like', 'love', 'laugh', 'wow', 'sad', 'celebrate', 'clap', 'time_credit'
]);

const COMMENT_REACTION_TYPES = Object.freeze(POST_REACTION_TYPES.slice(0, 6));

module.exports = { POST_REACTION_TYPES, COMMENT_REACTION_TYPES };
