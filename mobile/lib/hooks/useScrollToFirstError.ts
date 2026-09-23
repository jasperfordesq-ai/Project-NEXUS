// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { ScrollView, View } from 'react-native';

/**
 * Brings the first invalid field into view after a rejected submit.
 *
 * Forms that show errors beside their fields, with the submit button in a fixed footer,
 * otherwise appear to do nothing: the error is rendered off-screen and only a haptic
 * buzz tells the member anything happened. Place `anchor(field)` as a ref on a View
 * (collapsable={false}) just above each field, then call `reveal(order, errors)`.
 */
export function useScrollToFirstError<Field extends string>(scrollRef: RefObject<ScrollView | null>) {
  const anchors = useRef<Partial<Record<Field, View | null>>>({});
  const [target, setTarget] = useState<{ field: Field; attempt: number } | null>(null);
  const mounted = useRef(true);
  // Set on every mount: development StrictMode unmounts and remounts once, and a
  // cleanup-only effect would leave the flag false for the life of the screen.
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    if (!target) return;
    const frame = requestAnimationFrame(() => {
      const anchor = anchors.current[target.field];
      // Present at runtime since RN 0.70 but missing from the published ScrollView type.
      const inner = (scrollRef.current as unknown as { getInnerViewRef?: () => View | null } | null)?.getInnerViewRef?.();
      if (!anchor || !inner) return;
      anchor.measureLayout(inner, (_x, y) => {
        if (mounted.current) scrollRef.current?.scrollTo({ y: Math.max(0, y - 16), animated: true });
      }, () => undefined);
    });
    return () => cancelAnimationFrame(frame);
  }, [target, scrollRef]);

  const anchor = useCallback((field: Field) => (view: View | null) => { anchors.current[field] = view; }, []);
  const reveal = useCallback((order: readonly Field[], errors: Partial<Record<Field, unknown>>) => {
    const field = order.find((key) => Boolean(errors[key]));
    if (field) setTarget((previous) => ({ field, attempt: (previous?.attempt ?? 0) + 1 }));
  }, []);
  return { anchor, reveal };
}
