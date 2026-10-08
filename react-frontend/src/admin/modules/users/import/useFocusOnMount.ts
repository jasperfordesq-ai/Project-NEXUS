// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useRef } from 'react';

/**
 * Each import screen replaces the last one, and the button the admin just pressed
 * disappears with it, which would drop keyboard and screen-reader focus back to the
 * top of the page. The screen's lead element (give it `tabIndex={-1}`) takes focus
 * when the screen appears, so the new heading or alert is read out and Tab carries on from there.
 */
export function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return ref;
}
