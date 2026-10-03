// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Keeps broker-panel counts current without anyone pressing Refresh.
 *
 * Calls `refresh` shortly after any successful broker/admin write (approve,
 * review, settle, mark seen…) anywhere on the page, when a page asks for it
 * explicitly, when the tab becomes visible again, and on an interval while it
 * is visible. Writes in quick succession are folded into one refresh.
 *
 * Until this existed the sidebar polled once a minute and only "Mark as seen"
 * asked for an immediate refresh, so a broker who reviewed a message saw the
 * page say 1 and the sidebar say 2.
 */

import { useEffect, useRef } from 'react';
import { API_WRITE_EVENT, type ApiWriteDetail } from '@/lib/api';
import { BROKER_BADGES_REFRESH_EVENT } from '@/admin/modules/safeguarding/safeguardingShared';

/** Writes that can change a broker-panel count. Presence pings and the like are not. */
const COUNT_CHANGING_PREFIX = '/v2/admin/';

/** Time to wait after a write before refreshing, so a burst becomes one call. */
export const BROKER_REFRESH_DEBOUNCE_MS = 600;

export function useBrokerAutoRefresh(refresh: () => void, intervalMs = 60_000): void {
  // Read through a ref so a parent re-render never re-subscribes the listeners.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const soon = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        refreshRef.current();
      }, BROKER_REFRESH_DEBOUNCE_MS);
    };
    const onWrite = (event: Event) => {
      const detail = (event as CustomEvent<ApiWriteDetail>).detail;
      if (detail?.endpoint?.startsWith(COUNT_CHANGING_PREFIX)) soon();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') soon();
    };
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') refreshRef.current();
    }, intervalMs);

    window.addEventListener(API_WRITE_EVENT, onWrite);
    window.addEventListener(BROKER_BADGES_REFRESH_EVENT, soon);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      if (timer) clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener(API_WRITE_EVENT, onWrite);
      window.removeEventListener(BROKER_BADGES_REFRESH_EVENT, soon);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs]);
}
