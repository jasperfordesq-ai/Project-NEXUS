// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Whether the member has asked the OS to reduce motion.
 *
 * HeroUI components honour this on their own; hand-written `Animated` code does
 * not, so anything that springs, bounces or slides must check here first (audit
 * 2026-09-05, F09 — the unread badge on the Messages tab bounced regardless).
 * Starts `false` and settles once the OS answers, so a first render never blocks
 * on a native round-trip.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (!cancelled) setReduced(Boolean(value));
      })
      .catch(() => {
        // Unknown platform answer: keep motion, which is the documented default.
      });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      setReduced(Boolean(value));
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduced;
}
