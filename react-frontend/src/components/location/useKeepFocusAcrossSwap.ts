// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Keeps keyboard focus in a text field that is replaced by a different input
 * element while the member is using it.
 *
 * The location fields start as a plain box and swap to the lazily loaded place
 * search on first focus. The swap (plain box -> loading fallback -> real search,
 * and any swaps inside the search itself) creates NEW input elements, so the
 * browser drops focus to the page body and the first letters typed go nowhere.
 *
 * Usage: put `containerRef` on a wrapper around the field and call `arm()` from
 * the handler that triggers the swap. While armed, whenever the wrapper's
 * contents change and focus has been left on the page body, focus moves to the
 * wrapper's input with the caret at the end. It disarms as soon as the member
 * deliberately goes elsewhere (clicks outside or tabs to another control), and
 * after a short safety window.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const ARMED_WINDOW_MS = 10_000;

export function useKeepFocusAcrossSwap<T extends HTMLElement = HTMLDivElement>() {
  // A callback ref held in state: the wrapper may mount long after the page
  // does (e.g. a form that appears once its settings have loaded).
  const [container, setContainer] = useState<T | null>(null);
  const containerRef = useCallback((node: T | null) => setContainer(node), []);
  const armedAtRef = useRef<number | null>(null);

  const arm = useCallback(() => {
    armedAtRef.current = Date.now();
  }, []);

  useEffect(() => {
    if (!container || typeof MutationObserver === 'undefined') return undefined;

    const isArmed = () =>
      armedAtRef.current !== null && Date.now() - armedAtRef.current < ARMED_WINDOW_MS;
    const disarm = () => {
      armedAtRef.current = null;
    };

    const restoreFocus = () => {
      if (!isArmed()) return;
      const active = document.activeElement;
      // Focus is somewhere real (this field, or another control): leave it.
      if (active && active !== document.body) return;
      const input = container.querySelector<HTMLInputElement>(
        'input:not([type="hidden"]):not([disabled])',
      );
      if (!input) return;
      input.focus({ preventScroll: true });
      try {
        const end = input.value.length;
        input.setSelectionRange(end, end);
      } catch {
        // Some input types do not support selection; focus alone is enough.
      }
    };

    const observer = new MutationObserver(restoreFocus);
    observer.observe(container, { childList: true, subtree: true });

    const onPointerDown = (event: Event) => {
      if (!container.contains(event.target as Node)) disarm();
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as Node | null;
      if (target && target !== document.body && !container.contains(target)) disarm();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('focusin', onFocusIn, true);

    return () => {
      observer.disconnect();
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('focusin', onFocusIn, true);
    };
  }, [container]);

  return { containerRef, arm };
}
