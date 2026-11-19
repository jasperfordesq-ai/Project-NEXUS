// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The member's saved search radius, used as the starting value for every
 * "near me" filter.
 *
 * `match_preferences.max_distance_km` already exists, is already clamped to the
 * tenant ceiling server-side, and is already editable on the Matches
 * preferences page — but nothing outside that page ever read it, so every
 * discovery surface opened at a hardcoded 25 km regardless of what the member
 * had chosen. This hook is the shared reader.
 *
 * Fetched once per session and memoised at module scope: several filters can
 * mount on one page, and this must not become N identical requests.
 *
 * The radius a member picks on a browse page is remembered in this browser
 * (BROWSE_RADIUS_STORAGE_KEY) and is NOT written back to the matching
 * preference. It was until 19 Nov 2026: `max_distance_km` is the hard limit
 * on the member's matches, alerts and digests, so looking at members within
 * 5 km quietly cut their matching down to 5 km, and the Members page wrote
 * it on every "apply filters" whether or not the radius had been touched.
 * The matching distance is still the starting value for a member who has
 * never picked a radius here.
 */

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export const RADIUS_OPTIONS = [5, 10, 25, 50, 100] as const;
export const FALLBACK_RADIUS_KM = 25;
export const BROWSE_RADIUS_STORAGE_KEY = 'nexus:browse_radius_km';

/** The radius last picked on a browse page in this browser, if any. */
function readRememberedRadius(): number | null {
  try {
    const stored = Number(window.localStorage.getItem(BROWSE_RADIUS_STORAGE_KEY));

    return Number.isFinite(stored) && stored > 0 ? snapToRadiusOption(stored) : null;
  } catch {
    // Storage blocked or unavailable: fall back to the matching distance.
    return null;
  }
}

let cachedRadius: number | null = null;
let inFlight: Promise<number> | null = null;

/** Snap an arbitrary saved value to the nearest offered option. */
export function snapToRadiusOption(km: number): number {
  if (!Number.isFinite(km) || km <= 0) return FALLBACK_RADIUS_KM;

  return RADIUS_OPTIONS.reduce((closest, option) => (
    Math.abs(option - km) < Math.abs(closest - km) ? option : closest
  ), RADIUS_OPTIONS[0] as number);
}

async function fetchSavedRadius(): Promise<number> {
  const remembered = readRememberedRadius();
  if (remembered !== null) return remembered;

  // api.ts resolves rather than throws, so a failure arrives as success:false
  // and must fall back rather than surface an error on a discovery page.
  const res = await api.get<{ max_distance_km?: number }>('/v2/users/me/match-preferences');

  const saved = res.success && res.data ? Number(res.data.max_distance_km) : NaN;

  return Number.isFinite(saved) && saved > 0 ? snapToRadiusOption(saved) : FALLBACK_RADIUS_KM;
}

/**
 * Resets the module-level cache. Tests only — a preference change within a
 * session is picked up on the next load, which is soon enough for a default.
 */
export function resetSavedRadiusCache(): void {
  cachedRadius = null;
  inFlight = null;
}

export function useSavedRadiusKm(enabled = true): number {
  const [radius, setRadius] = useState<number>(cachedRadius ?? FALLBACK_RADIUS_KM);

  useEffect(() => {
    if (!enabled || cachedRadius !== null) return;

    let cancelled = false;

    inFlight ??= fetchSavedRadius()
      .then((value) => {
        cachedRadius = value;
        return value;
      })
      .catch(() => FALLBACK_RADIUS_KM)
      .finally(() => {
        inFlight = null;
      });

    void inFlight.then((value) => {
      if (!cancelled) setRadius(value);
    });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return radius;
}

/**
 * Remember a radius the member just chose, so the next browse page opens on
 * it. Kept in this browser only; see the note at the top of this file.
 * A filter must keep working even if it cannot be stored.
 */
export function persistRadiusPreference(km: number): void {
  cachedRadius = km;

  try {
    window.localStorage.setItem(BROWSE_RADIUS_STORAGE_KEY, String(km));
  } catch {
    // The chosen radius already applies for this session.
  }
}
