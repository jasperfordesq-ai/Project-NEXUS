// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { navigateWithSharedListingMedia, SHARED_TRANSITION_ATTR } from './sharedMediaTransition';

type Doc = { startViewTransition?: unknown };

describe('offer picture grows into its page (warmth plan A1)', () => {
  let card: HTMLDivElement;

  beforeEach(() => {
    card = document.createElement('div');
    card.setAttribute('data-listing-media', '42');
    document.body.appendChild(card);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    delete (document as unknown as Doc).startViewTransition;
    document.documentElement.removeAttribute('data-reduced-motion');
    document.documentElement.removeAttribute(SHARED_TRANSITION_ATTR);
  });

  it('leaves the link alone when the browser has no view transitions', () => {
    const navigate = vi.fn();
    expect(navigateWithSharedListingMedia(navigate, '/t/listings/42', 42)).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('leaves the link alone when the member asked for reduced motion', () => {
    (document as unknown as Doc).startViewTransition = vi.fn();
    document.documentElement.setAttribute('data-reduced-motion', 'true');
    expect(navigateWithSharedListingMedia(vi.fn(), '/t/listings/42', 42)).toBe(false);
    expect((document as unknown as Doc).startViewTransition).not.toHaveBeenCalled();
  });

  it('names only this offer’s picture on both pages, then clears the names', async () => {
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    let update: (() => Promise<void> | void) | undefined;
    (document as unknown as Doc).startViewTransition = vi.fn((cb: () => Promise<void> | void) => {
      update = cb;
      return { finished };
    });
    const navigate = vi.fn(() => {
      card.remove();
      const detail = document.createElement('div');
      detail.setAttribute('data-listing-media-detail', '42');
      document.body.appendChild(detail);
    });

    expect(navigateWithSharedListingMedia(navigate, '/t/listings/42', 42)).toBe(true);
    expect(card.style.viewTransitionName).toBe('listing-media-42');
    expect(document.documentElement.hasAttribute(SHARED_TRANSITION_ATTR)).toBe(true);

    await update!();
    expect(navigate).toHaveBeenCalledWith('/t/listings/42');
    const detail = document.querySelector<HTMLElement>('[data-listing-media-detail="42"]')!;
    expect(detail.style.viewTransitionName).toBe('listing-media-42');

    finish();
    await finished;
    await Promise.resolve();
    expect(detail.style.viewTransitionName).toBe('');
    expect(document.documentElement.hasAttribute(SHARED_TRANSITION_ATTR)).toBe(false);
  });

  it('finds the offer page picture while the browser has paused drawing', async () => {
    // REGRESSION (12 Nov 2026, seen in a recording): during a view transition's
    // update the browser stops drawing, so requestAnimationFrame never fires.
    // The wait for the offer page's picture was built on it, so the screen froze
    // on the list for the browser's 4-second limit before the page appeared.
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
    try {
      let update: (() => Promise<void> | void) | undefined;
      (document as unknown as Doc).startViewTransition = vi.fn((cb: () => Promise<void> | void) => {
        update = cb;
        return { finished: new Promise<void>(() => {}) };
      });
      const navigate = vi.fn(() => {
        card.remove();
        // The offer page draws its picture a moment after the address changes.
        window.setTimeout(() => {
          const detail = document.createElement('div');
          detail.setAttribute('data-listing-media-detail', '42');
          document.body.appendChild(detail);
        }, 50);
      });

      navigateWithSharedListingMedia(navigate, '/t/listings/42', 42);
      const started = performance.now();
      await update!();
      expect(performance.now() - started).toBeLessThan(600);
      const detail = document.querySelector<HTMLElement>('[data-listing-media-detail="42"]');
      expect(detail?.style.viewTransitionName).toBe('listing-media-42');
    } finally {
      raf.mockRestore();
    }
  });

  it('still opens the page when the browser never starts the transition', () => {
    vi.useFakeTimers();
    const skipTransition = vi.fn();
    (document as unknown as Doc).startViewTransition = vi.fn(() => ({ finished: new Promise<void>(() => {}), skipTransition }));
    const navigate = vi.fn();

    expect(navigateWithSharedListingMedia(navigate, '/t/listings/42', 42)).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(skipTransition).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
