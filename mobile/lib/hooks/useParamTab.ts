// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 A deep link that names a tab has to work when the screen is ALREADY OPEN.
 *
 * Every tabbed screen here read its tab parameter with `useState(() => fromParam())`, which
 * runs once. Follow a link to a tab while that screen is already on the stack and expo-router
 * updates the parameters without remounting, so the tab never moved. Measured on a device on
 * 2026-08-21 and recorded as journey 7.2 PARTIAL — "works when the screen is opened fresh by
 * the link; ignored when it is already open".
 *
 * This hook keeps both halves right:
 *
 * - the first render honours the parameter, so a fresh open still lands on the named tab;
 * - a LATER change of the parameter moves the tab, so a second link works;
 * - a member's own tap is never undone, because the effect only fires when the raw parameter
 *   value itself changes — not on every render, and not because state drifted from the URL.
 *
 * `resolve` returns null for a value this screen does not recognise, which leaves the current
 * tab alone rather than bouncing the member somewhere arbitrary.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type ParamTabResolver<T extends string> = (raw: string | undefined) => T | null;

/** Normalise expo-router's `string | string[] | undefined` to a single value. */
export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function useParamTab<T extends string>(
  requested: string | string[] | undefined,
  resolve: ParamTabResolver<T>,
  fallback: T,
): [T, (next: T) => void] {
  const raw = firstParam(requested);
  const [tab, setTab] = useState<T>(() => resolve(raw) ?? fallback);

  // The raw value already applied. Compared by value, so a re-render with the same
  // parameter does nothing and a manual tab change survives.
  const appliedRef = useRef<string | undefined>(raw);

  useEffect(() => {
    if (raw === appliedRef.current) return;
    appliedRef.current = raw;
    const resolved = resolve(raw);
    if (resolved !== null) setTab(resolved);
  }, [raw, resolve]);

  const select = useCallback((next: T) => {
    setTab(next);
  }, []);

  return [tab, select];
}
