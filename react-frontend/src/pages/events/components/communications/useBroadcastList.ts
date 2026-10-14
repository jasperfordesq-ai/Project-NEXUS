// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The organiser's list of messages for one event (E-106).
 *
 * - Loads a page with the plain-language summary.
 * - Merges by version: a late response never undoes a newer state the page
 *   already knows (ported from the mobile client's `mergeBroadcasts`).
 * - Reloads silently after every action, so a sent message stops claiming
 *   "Scheduled, 0 of N" and the next action uses the current version.
 * - Polls every 12 s, only while something is sending or due and only while
 *   the tab is visible, and stops when nothing is on its way.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { eventCommunicationsApi, type EventBroadcast } from '@/lib/event-communications-api';
import { logError } from '@/lib/logger';
import { needsPolling } from './broadcastPresentation';

export const BROADCAST_POLL_MS = 12_000;
export const BROADCAST_PAGE_SIZE = 20;

export interface BroadcastPagination {
  current_page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_more: boolean;
}

/** Incoming wins when its version is the same or newer; an older one never overwrites. */
export function mergeBroadcast(known: EventBroadcast | undefined, incoming: EventBroadcast): EventBroadcast {
  if (!known) return incoming;
  if (incoming.version < known.version) return known;
  // Mutation responses never carry the summary; keep the last one until the reload replaces it.
  if (incoming.summary === undefined && known.summary !== undefined) {
    return { ...incoming, summary: known.summary };
  }
  return incoming;
}

export function mergeBroadcastPage(current: EventBroadcast[], incoming: EventBroadcast[]): EventBroadcast[] {
  const byId = new Map(current.map((broadcast) => [broadcast.id, broadcast]));
  return incoming.map((broadcast) => mergeBroadcast(byId.get(broadcast.id), broadcast));
}

export interface BroadcastListState {
  broadcasts: EventBroadcast[];
  pagination: BroadcastPagination | null;
  page: number;
  setPage: (page: number) => void;
  isLoading: boolean;
  /** null when the last load succeeded; otherwise the response code (EVENTS_CONTRACT_DRIFT, TIMEOUT…) or 'error'. */
  loadError: string | null;
  /** Reload the current page. `silent` keeps the list on screen. Resolves once the answer is applied. */
  reload: (options?: { silent?: boolean }) => Promise<void>;
  /** Apply a broadcast from a mutation response (version-aware). New ones are added at the top of page 1. */
  upsert: (broadcast: EventBroadcast) => void;
  now: number;
}

export function useBroadcastList(eventId: number): BroadcastListState {
  const [broadcasts, setBroadcasts] = useState<EventBroadcast[]>([]);
  const [pagination, setPagination] = useState<BroadcastPagination | null>(null);
  const [page, setPageState] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const generation = useRef(0);
  const pageRef = useRef(page);
  pageRef.current = page;

  const reload = useCallback(async (options: { silent?: boolean } = {}) => {
    const mine = ++generation.current;
    const requestedPage = pageRef.current;
    if (!options.silent) {
      setIsLoading(true);
      setLoadError(null);
    }
    try {
      const response = await eventCommunicationsApi.list(eventId, requestedPage, BROADCAST_PAGE_SIZE, {
        includeSummary: true,
      });
      if (mine !== generation.current) return;
      setNow(Date.now());
      if (!response.success || !response.data) {
        // A silent refresh that fails keeps what is on screen, except when the
        // client itself is out of date: that must be said, not hidden.
        if (!options.silent || response.code === 'EVENTS_CONTRACT_DRIFT') {
          setLoadError(response.code ?? 'error');
        }
        return;
      }
      const incoming = response.data;
      setBroadcasts((current) => mergeBroadcastPage(current, incoming));
      setPagination(response.meta ?? null);
      setLoadError(null);
    } catch (error) {
      if (mine !== generation.current) return;
      logError('Failed to load event communications', error);
      if (!options.silent) setLoadError('error');
    } finally {
      if (mine === generation.current && !options.silent) setIsLoading(false);
    }
  }, [eventId]);

  const setPage = useCallback((next: number) => {
    pageRef.current = next;
    setPageState(next);
  }, []);

  useEffect(() => {
    setPage(1);
  }, [eventId, setPage]);

  useEffect(() => {
    void reload();
    return () => { generation.current += 1; };
  }, [reload, page]);

  const upsert = useCallback((broadcast: EventBroadcast) => {
    setBroadcasts((current) => {
      const index = current.findIndex((item) => item.id === broadcast.id);
      if (index === -1) return pageRef.current === 1 ? [broadcast, ...current] : current;
      const next = [...current];
      next[index] = mergeBroadcast(current[index], broadcast);
      return next;
    });
  }, []);

  // A scheduled message's description changes with the clock ("Will send on…"
  // becomes "Sending shortly…"), so keep `now` moving while any is scheduled.
  const hasScheduled = broadcasts.some((broadcast) => broadcast.status === 'scheduled');
  useEffect(() => {
    if (!hasScheduled) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [hasScheduled]);

  const shouldPoll = needsPolling(broadcasts, now);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => {
    if (!shouldPoll) return undefined;
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void reloadRef.current({ silent: true });
    }, BROADCAST_POLL_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void reloadRef.current({ silent: true });
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [shouldPoll]);

  return { broadcasts, pagination, page, setPage, isLoading, loadError, reload, upsert, now };
}
