// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * PageTransition — native-app route transitions for phones.
 *
 * Replays a Material "shared axis X" animation (subtle slide + fade) on the
 * routed content whenever the pathname changes: forward navigations slide in
 * from the right, back (POP) navigations from the left. The animation classes
 * only take effect on small screens and are disabled entirely under
 * prefers-reduced-motion — both enforced in CSS (see index.css), so desktop
 * and accessibility behaviour are unchanged.
 *
 * Implementation notes:
 * - The animation is applied imperatively (classList + reflow restart) from a
 *   commit effect rather than via a keyed remount. Route-level layout elements
 *   can be remounted by the router and the app re-renders frequently, so
 *   render-time class logic proved unreliable; the imperative form is immune
 *   to both, and avoids remounting the page tree just to animate it.
 * - The last-animated path lives at module scope so remounts can't replay or
 *   suppress animations.
 * - Deliberately enter-only: exit animations would require keeping the
 *   outgoing page mounted, which fights scroll restoration. OS edge-swipe
 *   gestures already provide back navigation, so no custom swipe handling.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

const ANIMATION_CLASSES = ['nexus-page-enter-forward', 'nexus-page-enter-back'] as const;

// null = app just loaded (never animate the hard load).
let lastAnimatedPath: string | null = null;

function pathDepth(path: string): number {
  return path.split('/').filter(Boolean).length;
}

export function PageTransition({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (lastAnimatedPath === null) {
      // Initial app load — record the path, don't animate.
      lastAnimatedPath = pathname;
      return;
    }
    if (lastAnimatedPath === pathname) return;

    // Direction by path depth: drilling deeper (list → detail) slides in from
    // the right, going shallower slides in from the left. This is deliberate
    // instead of useNavigationType() — router redirect chains in this app
    // report POP for ordinary link clicks, making it unreliable.
    const goingDeeper = pathDepth(pathname) >= pathDepth(lastAnimatedPath);
    lastAnimatedPath = pathname;

    const el = wrapperRef.current;
    if (!el) return;

    el.classList.remove(...ANIMATION_CLASSES);
    // Force a reflow so re-adding the class restarts the animation.
    void el.offsetWidth;
    el.classList.add(goingDeeper ? 'nexus-page-enter-forward' : 'nexus-page-enter-back');
  }, [pathname]);

  return <div ref={wrapperRef}>{children}</div>;
}

export default PageTransition;
