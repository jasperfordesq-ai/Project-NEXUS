// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Return a page to where the member left it when they press Back.
 *
 * `ScrollToTop` sends every route change to the top, which is right for new
 * pages but wrong for "open a post, press Back". This hook saves the scroll
 * position when the page unmounts and, on a Back/Forward (POP) navigation,
 * scrolls there again once the page says its content is `ready`. Pages that
 * load more items as you scroll pass `contentSize` so the restore can retry
 * while the list grows, up to a short deadline or until the member scrolls.
 */

import { useEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

const RESTORE_DEADLINE_MS = 8000;

interface SavedPosition {
  search: string;
  y: number;
}

function readSaved(key: string): SavedPosition | null {
  try {
    const raw = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedPosition>;
    return typeof parsed.y === 'number' && typeof parsed.search === 'string'
      ? { search: parsed.search, y: parsed.y }
      : null;
  } catch {
    return null;
  }
}

function writeSaved(key: string, value: SavedPosition): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked (private mode, quota) — restoring is a convenience only.
  }
}

export function useRestoreScrollOnBack(key: string, ready: boolean, contentSize = 0): void {
  const navigationType = useNavigationType();
  const { search } = useLocation();
  const searchRef = useRef(search);
  searchRef.current = search;
  const targetRef = useRef<number | null>(null);
  const deadlineRef = useRef(0);

  useEffect(() => {
    const saved = readSaved(key);
    if (navigationType === 'POP' && saved && saved.y > 0 && saved.search === searchRef.current) {
      targetRef.current = saved.y;
      deadlineRef.current = Date.now() + RESTORE_DEADLINE_MS;
    }

    // The member taking over the scroll cancels any pending restore.
    const cancel = () => { targetRef.current = null; };
    window.addEventListener('wheel', cancel, { passive: true });
    window.addEventListener('touchstart', cancel, { passive: true });
    window.addEventListener('keydown', cancel);

    return () => {
      window.removeEventListener('wheel', cancel);
      window.removeEventListener('touchstart', cancel);
      window.removeEventListener('keydown', cancel);
      writeSaved(key, { search: searchRef.current, y: Math.round(window.scrollY) });
    };
    // Mount/unmount only: navigationType is read once for the arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    const target = targetRef.current;
    if (target === null || !ready) return;
    if (Date.now() > deadlineRef.current) {
      targetRef.current = null;
      return;
    }
    const frame = requestAnimationFrame(() => {
      window.scrollTo(0, target);
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      // Page tall enough to reach the target: done. Otherwise wait for more items.
      if (maxScroll >= target) targetRef.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, contentSize]);
}
