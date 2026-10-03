// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * "What's next in this queue?" for a broker detail page.
 *
 * A broker works through queues — unreviewed messages, exchanges that need
 * action, matches waiting for approval. Until October 2026 every decision left
 * them on the item they had just finished, to go back to the list and pick the
 * next one. This hook reads the queue through the list's own endpoint, so the
 * "next" item is always one the list would show, and offers:
 *
 * - `remaining` / `nextId` for a "3 more waiting · Next" control, and
 * - `goNext()` for after an action: open the next item, or — when nothing is
 *   left — say so and return to the list.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTenant, useToast } from '@/contexts';

export interface QueuePage {
  /** Ids on the first page of the queue, in the list's order. */
  ids: number[];
  /** Items in the whole queue (the list's own total). */
  total: number;
}

interface Options {
  /** Read the queue through the list's endpoint; null when it could not be read. */
  fetchQueue: () => Promise<QueuePage | null>;
  /** The item on screen; it is never offered as "next". */
  currentId: number | null;
  /** Path of an item, without the tenant prefix (e.g. `/broker/messages/12?queue=urgent`). */
  itemPath: (id: number) => string;
  /** Where to go when the queue is empty (without the tenant prefix). */
  listPath: string;
  /** Turn the whole thing off (e.g. the page is showing history, not a queue). */
  enabled?: boolean;
}

export interface BrokerQueue {
  /** Items still waiting besides the one on screen; null until known. */
  remaining: number | null;
  nextId: number | null;
  /** Open the next item, or report that the queue is empty and go to the list. */
  goNext: () => Promise<void>;
}

export function useBrokerQueue({ fetchQueue, currentId, itemPath, listPath, enabled = true }: Options): BrokerQueue {
  const { t } = useTranslation('broker');
  const { tenantPath } = useTenant();
  const toast = useToast();
  const navigate = useNavigate();
  const [state, setState] = useState<{ remaining: number | null; nextId: number | null }>({ remaining: null, nextId: null });

  // Latest callbacks without re-subscribing on every render.
  const fetchRef = useRef(fetchQueue);
  fetchRef.current = fetchQueue;

  const read = useCallback(async () => {
    if (!enabled) return null;
    try {
      const page = await fetchRef.current();
      if (!page) return null;
      const others = page.ids.filter((id) => id !== currentId);
      const includesCurrent = currentId !== null && page.ids.includes(currentId);
      const next = { remaining: Math.max(0, page.total - (includesCurrent ? 1 : 0)), nextId: others[0] ?? null };
      setState(next);
      return next;
    } catch {
      return null;
    }
  }, [currentId, enabled]);

  useEffect(() => {
    void read();
  }, [read]);

  const goNext = useCallback(async () => {
    const fresh = await read();
    if (fresh?.nextId) {
      navigate(tenantPath(itemPath(fresh.nextId)));
      return;
    }
    if (fresh && fresh.remaining === 0) {
      toast.success(t('queue.all_done'));
    }
    navigate(tenantPath(listPath));
  }, [read, navigate, tenantPath, itemPath, listPath, toast, t]);

  return { ...state, goNext };
}
