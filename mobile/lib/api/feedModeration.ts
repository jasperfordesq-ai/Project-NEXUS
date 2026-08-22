// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Getting unwanted content off your own feed, and telling someone about it.
 *
 * 🔴 NEW on 2026-08-22, and it closes a safeguarding gap rather than a nice-to-have. The
 * mobile app had no way to hide, mute or report ANYTHING in the feed: the card's overflow
 * menu offered Share, Save and View post, and `lib/api/` contained no call to any of the
 * four endpoints below. The website has offered hide, not-interested and mute since the V2
 * feed was built (`react-frontend/src/pages/feed/FeedPage.tsx`), and the server has had the
 * report endpoint the whole time — with a moderator alert on the other end of it.
 *
 * Found by walking the feed on a device: opening the "…" menu on another member's post
 * showed three options, none of them about the content itself.
 *
 * Contracts, read from `App\Http\Controllers\Api\SocialController`:
 *
 * - hide / not-interested take `{ type }` — the feed carries listings, events and
 *   volunteering entries as well as posts, and the server reads the type to know which
 *   table the id belongs to. Sending the wrong type hides the wrong thing.
 * - report requires a NON-EMPTY `reason` (400 otherwise), truncates it at 1000 characters,
 *   and answers 409 if this member has already reported this item. It writes to `reports`
 *   and alerts the moderators.
 * - mute is per member, not per post, and is idempotent server-side (`insertOrIgnore`).
 */

import { api } from './client';

const API_V2 = '/api/v2';

/** What kind of feed entry an id belongs to. The server needs this to find the row. */
export type FeedTargetType = 'post' | 'listing' | 'event' | 'volunteering' | 'poll';

/** POST /api/v2/feed/posts/:id/hide — removes it from this member's feed only. */
export function hideFeedItem(
  id: number,
  type: FeedTargetType = 'post',
): Promise<{ data?: { hidden?: boolean } }> {
  return api.post<{ data?: { hidden?: boolean } }>(`${API_V2}/feed/posts/${id}/hide`, { type });
}

/**
 * POST /api/v2/feed/posts/:id/not-interested — a softer signal than hide: it teaches the
 * ranking rather than removing the entry outright.
 */
export function markFeedItemNotInterested(
  id: number,
  type: FeedTargetType = 'post',
): Promise<{ data?: unknown }> {
  return api.post<{ data?: unknown }>(`${API_V2}/feed/posts/${id}/not-interested`, { type });
}

/**
 * POST /api/v2/feed/posts/:id/report — sends it to the community's moderators.
 *
 * 🔴 `reason` is required by the server and must be shown as required to the member: an
 * empty one is a 400, and a report that silently fails is the worst possible outcome for
 * the person who reported something. A second report of the same item answers 409, which
 * the caller should present as "you have already reported this" rather than as a failure.
 */
export function reportFeedItem(
  id: number,
  reason: string,
  type: FeedTargetType = 'post',
): Promise<{ data?: { reported?: boolean } }> {
  return api.post<{ data?: { reported?: boolean } }>(`${API_V2}/feed/posts/${id}/report`, {
    reason,
    target_type: type,
  });
}

/** POST /api/v2/feed/users/:id/mute — hides everything from one member, feed-wide. */
export function muteFeedAuthor(userId: number): Promise<{ data?: unknown }> {
  return api.post<{ data?: unknown }>(`${API_V2}/feed/users/${userId}/mute`, {});
}
