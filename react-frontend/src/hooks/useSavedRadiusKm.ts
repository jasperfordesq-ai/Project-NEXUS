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
 */

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export const RADIUS_OPTIONS = [5, 10, 25, 50, 100] as const;
export const FALLBACK_RADIUS_KM = 25;

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
 * Persist a radius the member just chose, so the next page opens on it.
 * Deliberately fire-and-forget: a discovery filter must keep working even if
 * the preference write fails.
 */
export function persistRadiusPreference(km: number): void {
  cachedRadius = km;

  // try/catch as well as .catch(): a rejected promise is not the only way this
  // can fail. A synchronous throw from the client would otherwise propagate
  // into whatever UI flow changed the radius — which is exactly what "the
  // filter keeps working even if the write fails" is supposed to prevent.
  try {
    void api.put('/v2/users/me/match-preferences', { max_distance_km: km })?.catch?.(() => {
      // Non-fatal — the in-session value above still applies.
    });
  } catch {
    // Same posture: the chosen radius already applies for this session.
  }
}
