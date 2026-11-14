// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * feedSync — lightweight event bus for cross-page social state synchronisation.
 *
 * Problem: FeedPage caches item state. When the user likes/comments on a detail
 * page (listing, event, post, etc.) and returns to the feed, the card shows stale
 * counts. This bus lets any social interaction anywhere in the app broadcast a
 * patch, and FeedPage applies it to the matching item immediately.
 *
 * Usage:
 *   dispatchFeedSync({ targetType: 'listing', targetId: 42, patch: { is_liked: true, likes_count: 5 } });
 *
 * Sources that dispatch:
 *   - useSocialInteractions (listing/event/blog/goal detail pages)
 *   - FeedCard inline comments
 *   - PostDetailPage like handler
 *   - GroupDetailPage embedded-feed like handler
 *
 * Listeners:
 *   - FeedPage (patches items state for the matching card)
 *   - Any other feed-like page that renders FeedCard items
 */

export const FEED_SYNC_EVENT = 'nexus:feedSync';

export interface FeedSyncPatch {
  is_liked?: boolean;
  likes_count?: number;
  is_bookmarked?: boolean;
  is_shared?: boolean;
  share_count?: number;
  /** Delta applied to comments_count: +1 on add, -1 on delete. */
  comments_count_delta?: number;
  reactions?: {
    counts: Record<string, number>;
    total: number;
    user_reaction: string | null;
    top_reactors?: Array<{
      id: number;
      name: string;
      avatar_url?: string | null;
    }>;
  };
}

export interface FeedSyncPayload {
  targetType: string;
  targetId: number;
  patch: FeedSyncPatch;
}

interface SyncableFeedItem {
  id: number;
  type: string;
  is_liked?: boolean;
  likes_count?: number;
  is_bookmarked?: boolean;
  is_shared?: boolean;
  share_count?: number;
  comments_count?: number;
  reactions?: FeedSyncPatch['reactions'];
}

/** Broadcast a social state change to all active feed listeners. */
export function dispatchFeedSync(payload: FeedSyncPayload): void {
  window.dispatchEvent(new CustomEvent<FeedSyncPayload>(FEED_SYNC_EVENT, { detail: payload }));
}

/** Apply a feed-sync payload to one feed-like item, preserving unrelated fields. */
export function applyFeedSyncToItem<T extends SyncableFeedItem>(item: T, payload: FeedSyncPayload): T {
  if (item.type !== payload.targetType || item.id !== payload.targetId) {
    return item;
  }

  const next = { ...item };
  const { patch } = payload;

  if (patch.is_liked !== undefined) {
    next.is_liked = patch.is_liked;
  }
  if (patch.likes_count !== undefined) {
    next.likes_count = Math.max(0, patch.likes_count);
  }
  if (patch.is_bookmarked !== undefined) {
    next.is_bookmarked = patch.is_bookmarked;
  }
  if (patch.is_shared !== undefined) {
    next.is_shared = patch.is_shared;
  }
  if (patch.share_count !== undefined) {
    next.share_count = Math.max(0, patch.share_count);
  }
  if (patch.comments_count_delta !== undefined) {
    next.comments_count = Math.max(0, (item.comments_count ?? 0) + patch.comments_count_delta);
  }
  if (patch.reactions !== undefined) {
    next.reactions = patch.reactions;
    // Likes and reactions are one store: the like fields are just another
    // view of the reactions summary, so they can never disagree with it.
    next.is_liked = patch.reactions.user_reaction != null;
    next.likes_count = Math.max(0, patch.reactions.total);
  }

  return next;
}
