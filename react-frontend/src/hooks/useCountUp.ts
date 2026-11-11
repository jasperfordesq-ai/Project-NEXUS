// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * useCountUp — animates a number towards its target with an ease-out curve
 * (requestAnimationFrame). Shows the target at once when the member prefers
 * reduced motion (device setting or the in-app switch), when rAF is missing
 * (jsdom), or in test mode (deterministic assertions).
 *
 * `fromZero` (member site, warmth plan Phase 4 A2): count up from 0 the first
 * time the number appears. Without it (the broker panel's original use) the
 * first value shows as-is and only later changes animate.
 * `decimals`: keep this many decimal places while counting (hours like 13.5).
 */

import { useEffect, useRef, useState } from 'react';

export function prefersReducedMotion(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.dataset.reducedMotion === 'true') {
    return true;
  }
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  return false;
}

function animationAvailable(): boolean {
  return !(
    import.meta.env.MODE === 'test' ||
    prefersReducedMotion() ||
    typeof window === 'undefined' ||
    typeof window.requestAnimationFrame !== 'function'
  );
}

export interface CountUpOptions {
  durationMs?: number;
  fromZero?: boolean;
  decimals?: number;
}

export function useCountUp(target: number, options: number | CountUpOptions = {}): number {
  const { durationMs = 700, fromZero = false, decimals = 0 } =
    typeof options === 'number' ? { durationMs: options } : options;
  const startsAtZero = fromZero && animationAvailable() && target !== 0;
  const [display, setDisplay] = useState(startsAtZero ? 0 : target);
  const fromRef = useRef(startsAtZero ? 0 : target);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const from = fromRef.current;
    fromRef.current = target;

    if (from === target || !animationAvailable()) {
      setDisplay(target);
      return;
    }

    const factor = 10 ** decimals;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setDisplay(t >= 1 ? target : Math.round((from + (target - from) * eased) * factor) / factor);
      if (t < 1) {
        frameRef.current = window.requestAnimationFrame(step);
      }
    };
    frameRef.current = window.requestAnimationFrame(step);

    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [target, durationMs, decimals]);

  return display;
}

export default useCountUp;
