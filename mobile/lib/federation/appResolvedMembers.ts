// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * F-118: names of external federated members that THIS APP read from the server.
 *
 * A member shared by an external federation partner cannot be looked up again by id,
 * so the directory used to hand their name to the next screen as a route param
 * (`?name=…&community=…`). A deep link can set exactly the same params, so a link's
 * author could open a profile or a compose screen headed with any name they liked
 * ("Community Coordinator"). Screens now ignore those params and show a name only
 * from the server — directly, or from this in-memory record, which only the app's
 * own server-backed lists write to. A deep link cannot reach it.
 */

export type AppResolvedMember = { name: string; community?: string };

const MAX_ENTRIES = 200;
const entries = new Map<string, AppResolvedMember>();

function keyFor(memberId: unknown, tenantId: unknown): string | null {
  const member = String(memberId ?? '').trim();
  const tenant = String(tenantId ?? '').trim();
  return member && tenant ? `${tenant}\u0000${member}` : null;
}

/** Record a member exactly as a server response described them. */
export function rememberAppResolvedMember(memberId: unknown, tenantId: unknown, member: { name?: string | null; community?: string | null }): void {
  const key = keyFor(memberId, tenantId);
  const name = String(member.name ?? '').trim();
  if (!key || !name) return;
  const community = String(member.community ?? '').trim();
  entries.delete(key);
  entries.set(key, community ? { name, community } : { name });
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}

/** The member as the app last read them from the server, or null. */
export function appResolvedMember(memberId: unknown, tenantId: unknown): AppResolvedMember | null {
  const key = keyFor(memberId, tenantId);
  return key ? entries.get(key) ?? null : null;
}

/** Forget every recorded member (sign-out, tests). */
export function clearAppResolvedMembers(): void {
  entries.clear();
}
