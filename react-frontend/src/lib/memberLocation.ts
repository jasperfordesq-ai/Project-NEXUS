// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Helpers for asking a member where they are based.
 *
 * The SERVER decides whether a member has no location (`location_missing` on
 * GET /v2/users/me). The website only ever reads that flag — never work it out
 * from `user.location`, which is optional for other reasons.
 */

import type { ApiErrorDetail } from '@/lib/api';
import type { User } from '@/types/api';

export interface MemberLocationValue {
  location: string;
  latitude?: number;
  longitude?: number;
}

export const EMPTY_MEMBER_LOCATION: MemberLocationValue = { location: '' };

/** True only when the server said so. Absent/undefined means "not missing". */
export function isLocationMissing(user: Pick<User, 'location_missing'> | null | undefined): boolean {
  return user?.location_missing === true;
}

/** True once the member has typed something real (whitespace does not count). */
export function hasLocationText(value: MemberLocationValue): boolean {
  return value.location.trim().length > 0;
}

/**
 * The fields to send to PUT /v2/users/me. Coordinates go along only when both
 * are known (a place was picked); free text alone is fine — the background
 * geocoder fills in the coordinates within about a minute.
 */
export function locationUpdatePayload(value: MemberLocationValue): {
  location: string;
  latitude?: number;
  longitude?: number;
} {
  const payload: { location: string; latitude?: number; longitude?: number } = {
    location: value.location.trim(),
  };
  if (typeof value.latitude === 'number' && typeof value.longitude === 'number') {
    payload.latitude = value.latitude;
    payload.longitude = value.longitude;
  }
  return payload;
}

/**
 * Which part of a refused location save the server complained about, so the
 * caller can show its own translated message instead of the server's English.
 * `null` means the refusal was about something else (or there was no detail).
 */
export function locationErrorField(
  errors: ApiErrorDetail[] | undefined,
): 'location' | 'coordinates' | null {
  for (const error of errors ?? []) {
    if (error.field === 'location') return 'location';
    if (error.field === 'latitude' || error.field === 'longitude') return 'coordinates';
  }
  return null;
}
