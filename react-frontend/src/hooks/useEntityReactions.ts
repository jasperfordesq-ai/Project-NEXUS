// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * useEntityReactions — the reactions on one item, for any screen that is not a
 * feed card (the feed already receives reactions with each item).
 *
 * It reads from and writes to the same store the feed card uses
 * (GET /v2/reactions/batch, POST /v2/reactions), and it listens on the feedSync
 * bus, so a reaction given on a listing's page and one given on that listing's
 * feed card are the same reaction wherever it is shown.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { FEED_SYNC_EVENT, dispatchFeedSync, type FeedSyncPayload } from '@/lib/feedSync';
import { EMPTY_REACTIONS, loadReactions, type ReactionState } from '@/lib/reactionsBatch';
import type { ReactionType } from '@/components/social/reactions';

export interface EntityReactionsOptions {
  targetType: string;
  targetId: number;
  /** The signed-in member's id. A change of viewer reloads "my reaction". */
  viewerId?: number | string | null;
  /**
   * Reactions are members-only on the server (they name who reacted), so a
   * visitor who is not signed in must not ask. Pass `isAuthenticated`.
   */
  enabled?: boolean;
  /**
   * What a signed-out visitor sees instead: a bare count the page already has
   * from its own public endpoint (a listing's `likes_count`), or nothing.
   */
  visitorTotal?: number;
}

/** What the item looks like the moment the member taps, before the server answers. */
export function applyReaction(current: ReactionState, reactionType: ReactionType): ReactionState {
  const counts = { ...current.counts };
  let total = current.total;
  const previous = current.user_reaction;
  let userReaction: string | null;

  const decrement = (type: string) => {
    const next = Math.max(0, (counts[type] ?? 0) - 1);
    if (next === 0) {
      delete counts[type];
    } else {
      counts[type] = next;
    }
  };

  if (previous === reactionType) {
    decrement(reactionType);
    total = Math.max(0, total - 1);
    userReaction = null;
  } else {
    if (previous) {
      decrement(previous);
    } else {
      total += 1;
    }
    counts[reactionType] = (counts[reactionType] ?? 0) + 1;
    userReaction = reactionType;
  }

  return { ...current, counts, total, user_reaction: userReaction };
}

export function useEntityReactions({
  targetType,
  targetId,
  viewerId = null,
  enabled = true,
  visitorTotal = 0,
}: EntityReactionsOptions) {
  const [loadedReactions, setReactions] = useState<ReactionState>(EMPTY_REACTIONS);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isReacting, setIsReacting] = useState(false);
  const [failed, setFailed] = useState(false);

  // A visitor gets the page's own count, as plain likes, and nothing else.
  const visitorReactions = useMemo<ReactionState>(
    () => (visitorTotal > 0
      ? { counts: { like: visitorTotal }, total: visitorTotal, user_reaction: null, top_reactors: [] }
      : EMPTY_REACTIONS),
    [visitorTotal]
  );
  const reactions = enabled ? loadedReactions : visitorReactions;

  // The latest state, readable from callbacks without re-creating them.
  const reactionsRef = useRef(reactions);
  reactionsRef.current = reactions;
  const reactingRef = useRef(false);

  // Load, and reload when the item or the viewer changes.
  useEffect(() => {
    let cancelled = false;
    setIsLoaded(false);
    setReactions(EMPTY_REACTIONS);

    if (!enabled) {
      return undefined;
    }

    void loadReactions(targetType, targetId).then((state) => {
      if (cancelled) return;
      if (state) {
        setReactions(state);
      }
      setIsLoaded(true);
    });

    return () => {
      cancelled = true;
    };
  }, [targetType, targetId, viewerId, enabled]);

  // A reaction made on this item elsewhere on the page (its feed card, another
  // panel) arrives on the feedSync bus.
  useEffect(() => {
    const handler = (event: Event) => {
      const payload = (event as CustomEvent<FeedSyncPayload>).detail;
      if (!payload || payload.targetType !== targetType || payload.targetId !== targetId) return;
      if (payload.patch.reactions) {
        setReactions(payload.patch.reactions);
      }
    };

    window.addEventListener(FEED_SYNC_EVENT, handler);
    return () => window.removeEventListener(FEED_SYNC_EVENT, handler);
  }, [targetType, targetId]);

  const react = useCallback(
    async (reactionType: ReactionType) => {
      if (!enabled || reactingRef.current || targetId <= 0) return;
      reactingRef.current = true;
      setIsReacting(true);
      setFailed(false);

      const before = reactionsRef.current;
      setReactions(applyReaction(before, reactionType));

      try {
        const res = await api.post<{ reactions?: ReactionState }>('/v2/reactions', {
          target_type: targetType,
          target_id: targetId,
          reaction_type: reactionType,
        });
        if (!res.success || !res.data?.reactions) {
          throw new Error(res.error || 'Reaction request failed');
        }

        const server = res.data.reactions;
        setReactions(server);
        dispatchFeedSync({ targetType, targetId, patch: { reactions: server } });
      } catch (err) {
        setReactions(before);
        setFailed(true);
        logError('Failed to react', err);
      } finally {
        reactingRef.current = false;
        setIsReacting(false);
      }
    },
    [targetType, targetId, enabled]
  );

  return { reactions, react, isReacting, isLoaded, failed };
}
