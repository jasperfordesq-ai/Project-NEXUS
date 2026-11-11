// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { flushSync } from 'react-dom';

/**
 * An offer card's picture grows into the top of the offer's page (warmth plan
 * Phase 4 A1, a trial on offers only).
 *
 * React Router's own `viewTransition` option only works with its data router;
 * this app uses `<BrowserRouter>`, so the card calls the browser's
 * `document.startViewTransition` itself around the navigation. Nothing else
 * in the app changes.
 *
 * Only the picture (the photo, or the coloured cover when there is none) is
 * shared: the card marks it `data-listing-media`, the offer page marks its
 * own `data-listing-media-detail`, and both get the same
 * `view-transition-name` (`listing-media-<id>`, unique per offer) just for the
 * moment of the transition. The rest of the page switches at once (index.css
 * turns off the default cross-fade).
 *
 * Falls back to an ordinary link — returns false — when the browser has no
 * view transitions, when the member or their device asks for reduced motion,
 * or when the card's picture is not on screen.
 */

/** How long to wait for the offer page to draw its picture before giving up. */
const WAIT_FOR_DETAIL_MS = 800;

/**
 * The browser runs the page change only after it has drawn a frame of the old
 * page. If it has not started within this time (a tab that is not drawing,
 * a busy device), the page opens anyway, without the effect: a click must
 * never do nothing.
 */
const START_DEADLINE_MS = 350;

/** Set on <html> while the transition runs; PageTransition skips its phone slide. */
export const SHARED_TRANSITION_ATTR = 'data-shared-transition';

type StartViewTransition = (update: () => Promise<void> | void) => {
  finished: Promise<void>;
  skipTransition?: () => void;
};

function reducedMotion(): boolean {
  if (document.documentElement.getAttribute('data-reduced-motion') === 'true') return true;
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function waitForElement(selector: string, timeoutMs: number): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const started = performance.now();
    const look = () => {
      const found = document.querySelector<HTMLElement>(selector);
      if (found || performance.now() - started > timeoutMs) {
        resolve(found);
        return;
      }
      requestAnimationFrame(look);
    };
    look();
  });
}

/**
 * Navigates to an offer with its picture growing into place. Returns true when
 * it took over the navigation (the caller then prevents the link's default),
 * false when the caller should let the link navigate as usual.
 */
export function navigateWithSharedListingMedia(
  navigate: (path: string) => void,
  path: string,
  listingId: number | string,
): boolean {
  if (typeof document === 'undefined') return false;
  const start = (document as Document & { startViewTransition?: StartViewTransition }).startViewTransition;
  if (typeof start !== 'function' || reducedMotion()) return false;

  const id = String(listingId).replace(/[^\w-]/g, '');
  const source = document.querySelector<HTMLElement>(`[data-listing-media="${id}"]`);
  if (!source) return false;

  const name = `listing-media-${id}`;
  const html = document.documentElement;
  source.style.viewTransitionName = name;
  html.setAttribute(SHARED_TRANSITION_ATTR, 'true');

  let target: HTMLElement | null = null;
  let navigated = false;
  const go = () => {
    if (navigated) return;
    navigated = true;
    flushSync(() => navigate(path));
  };
  const transition = start.call(document, async () => {
    if (navigated) return;
    go();
    target = await waitForElement(`[data-listing-media-detail="${id}"]`, WAIT_FOR_DETAIL_MS);
    if (target) target.style.viewTransitionName = name;
  });

  window.setTimeout(() => {
    if (navigated) return;
    transition.skipTransition?.();
    go();
  }, START_DEADLINE_MS);

  transition.finished.catch(() => undefined).finally(() => {
    source.style.viewTransitionName = '';
    if (target) target.style.viewTransitionName = '';
    html.removeAttribute(SHARED_TRANSITION_ATTR);
  });
  return true;
}
