// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * "New here": a member who joined in the last 30 days. One rule for the
 * members list's badge and for the profile's "Say hello" button, so the two
 * can never disagree about who is new.
 */
export const NEW_MEMBER_DAYS = 30;

/** True when the join date is within the last NEW_MEMBER_DAYS days (and not in the future). */
export function isNewMember(createdAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!createdAt) return false;
  // The directory sends "YYYY-MM-DD HH:MM:SS"; older Safari cannot parse the space.
  const joined = new Date(createdAt.includes('T') ? createdAt : createdAt.replace(' ', 'T')).getTime();
  if (Number.isNaN(joined)) return false;
  const age = now - joined;
  return age >= 0 && age < NEW_MEMBER_DAYS * 86_400_000;
}
