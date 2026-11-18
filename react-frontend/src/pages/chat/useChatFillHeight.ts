// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * useChatFillHeight — how tall the AI Assistant can be so that it ends exactly
 * at the bottom of the screen.
 *
 * The chat used a fixed `100dvh - 4rem`, but what sits above it is not fixed:
 * the site header is 3.5rem on a phone and 7.5rem on a computer (more with a
 * tall logo), the page has its own padding, and a community announcement can
 * appear above it. On a computer the typing box started below the bottom of
 * the screen and the page had to be scrolled to find it. So the chat measures
 * where it starts instead and fills the rest of the screen. The footer stays
 * below it and can still be reached by scrolling the page.
 *
 * Returns the height in CSS pixels, or null before the first measurement.
 * The phone tab bar's space is NOT included here: it comes and goes with the
 * on-screen keyboard, and CSS already knows when (see `[data-ai-chat]` in
 * index.css).
 */

import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';

/** Never shorter than this; on a tiny screen the page scrolls instead. */
export const MIN_CHAT_HEIGHT_PX = 320;

/** Space left under the chat: a little on phones, more on a computer. */
export function bottomGapFor(viewportWidth: number): number {
  return viewportWidth >= 1024 ? 24 : 8;
}

/**
 * The height that makes an element starting `documentTop` pixels down the
 * page end at the bottom of a `viewportHeight` screen.
 */
export function fillHeight(
  viewportHeight: number,
  viewportWidth: number,
  documentTop: number,
  keyboardOffset: number,
): number {
  const available = viewportHeight - documentTop - bottomGapFor(viewportWidth) - Math.max(0, keyboardOffset);
  return Math.max(MIN_CHAT_HEIGHT_PX, Math.floor(available));
}

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function useChatFillHeight(ref: RefObject<HTMLElement | null>, keyboardOffset: number): number | null {
  const [height, setHeight] = useState<number | null>(null);

  useIsomorphicLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof window === 'undefined') return;

    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const current = ref.current;
        if (!current) return;
        // Position on the page, not on the screen, so it does not change when
        // the page itself is scrolled (or when iOS scrolls it for the keyboard).
        const documentTop = current.getBoundingClientRect().top + window.scrollY;
        const next = fillHeight(window.innerHeight, window.innerWidth, documentTop, keyboardOffset);
        setHeight((prev) => (prev === next ? prev : next));
      });
    };

    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    window.visualViewport?.addEventListener('resize', measure);

    // Anything above the chat changing size (an announcement dismissed, the
    // header's top bar folding away) moves where the chat starts.
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      observer.observe(document.body);
    }

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
      window.visualViewport?.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [ref, keyboardOffset]);

  return height;
}

export default useChatFillHeight;
