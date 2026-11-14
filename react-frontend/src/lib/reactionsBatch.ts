// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * reactionsBatch — loads reaction summaries for whatever is on the page in one
 * request.
 *
 * Every screen that is not the feed (a listing's own page, an event, a list of
 * polls or reviews) asks here for its reactions rather than trusting whatever
 * like state its own detail endpoint happened to send. Most of those endpoints
 * never sent any, so a like used to vanish on reload and the next tap took it
 * back off. Asking the one reactions store is what keeps a detail page and the
 * item's feed card showing the same thing.
 *
 * Calls made in the same tick are collected and sent together as
 * GET /v2/reactions/batch?items=type:id,type:id — a page of twenty reviews is
 * one request, not twenty.
 */

import { api } from '@/lib/api';
import { logError } from '@/lib/logger';

export interface ReactionState {
  counts: Record<string, number>;
  total: number;
  user_reaction: string | null;
  top_reactors?: Array<{ id: number; name: string; avatar_url?: string | null }>;
}

export const EMPTY_REACTIONS: ReactionState = {
  counts: {},
  total: 0,
  user_reaction: null,
  top_reactors: [],
};

/** The server answers at most this many items per request. */
const MAX_ITEMS_PER_REQUEST = 50;

type Resolver = (state: ReactionState | null) => void;

const pending = new Map<string, Resolver[]>();
let flushScheduled = false;

async function flush(): Promise<void> {
  flushScheduled = false;
  const batch = new Map(pending);
  pending.clear();
  const keys = [...batch.keys()];

  for (let start = 0; start < keys.length; start += MAX_ITEMS_PER_REQUEST) {
    const chunk = keys.slice(start, start + MAX_ITEMS_PER_REQUEST);
    let summaries: Record<string, ReactionState> = {};
    let failed = false;

    try {
      const res = await api.get<Record<string, ReactionState>>(
        `/v2/reactions/batch?items=${encodeURIComponent(chunk.join(','))}`
      );
      if (res.success && res.data) {
        summaries = res.data;
      } else {
        failed = true;
      }
    } catch (err) {
      failed = true;
      logError('Failed to load reactions', err);
    }

    for (const key of chunk) {
      // A failed request resolves null ("unknown"), so the caller keeps what it
      // has. An item missing from a successful answer has no reactions the
      // viewer may see, which is the empty state.
      const state = failed ? null : summaries[key] ?? EMPTY_REACTIONS;
      for (const resolve of batch.get(key) ?? []) {
        resolve(state);
      }
    }
  }
}

/**
 * The reaction summary for one item. Resolves null when it could not be loaded.
 */
export function loadReactions(targetType: string, targetId: number): Promise<ReactionState | null> {
  if (!targetType || !Number.isInteger(targetId) || targetId <= 0) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const key = `${targetType}:${targetId}`;
    const resolvers = pending.get(key);
    if (resolvers) {
      resolvers.push(resolve);
    } else {
      pending.set(key, [resolve]);
    }

    if (!flushScheduled) {
      flushScheduled = true;
      // A macrotask, so every component mounting in this render pass joins the
      // same request.
      setTimeout(() => {
        void flush();
      }, 0);
    }
  });
}
