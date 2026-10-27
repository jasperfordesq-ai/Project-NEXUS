// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Where to send a member once they have signed in.
 *
 * A link from an email lands a signed-out member on the login page. The page
 * they were trying to reach has to survive the whole sign-in, which may leave
 * the app entirely (Google, single sign-on) or pass through the mandatory
 * two-step setup screen. Router state alone does not survive those, so the
 * destination travels three ways:
 *
 * 1. router state (`state.from`), as before;
 * 2. the login address itself (`/login?next=/listings/42`), which survives a
 *    reload, a new tab and any redirect that drops router state;
 * 3. the tab's sessionStorage, written when the login page knows a
 *    destination, read by the screens that finish a sign-in elsewhere.
 *
 * Every value goes through `safeAuthReturnPath`, so only a path on this site
 * is ever followed — a crafted `?next=https://evil.example` falls back.
 */

import { safeAuthReturnPath } from '@/lib/safe-auth-return-path';

export const AUTH_RETURN_QUERY_PARAM = 'next';
const STORAGE_KEY = 'nexus_auth_return';
/** A destination abandoned for longer than this is forgotten. */
const STORAGE_TTL_MS = 30 * 60 * 1000;

export interface LoginTarget {
  to: string;
  state?: { from: string };
}

/**
 * Build the address of a step the member must pass through — the login page,
 * or onboarding after sign-in — that brings them on to `from` afterwards.
 * An unsafe or missing `from` yields the plain address.
 */
export function buildReturnTarget(stepPath: string, from: unknown): LoginTarget {
  const safe = safeAuthReturnPath(from, '');
  if (!safe) return { to: stepPath };
  const separator = stepPath.includes('?') ? '&' : '?';
  return {
    to: `${stepPath}${separator}${AUTH_RETURN_QUERY_PARAM}=${encodeURIComponent(safe)}`,
    state: { from: safe },
  };
}

/**
 * The destination the login page should honour, in order of trust:
 * router state, then the `?next=` parameter, then the stored value.
 */
export function resolveAuthReturn(
  state: unknown,
  search: string,
  fallback: string,
): string {
  return explicitAuthReturn(state, search) || readStoredAuthReturn(fallback);
}

/**
 * The destination this visit to the login page was given (router state or
 * `?next=`), or '' when it was given none. Only this is worth storing:
 * re-storing a value read back from storage would keep renewing it.
 */
export function explicitAuthReturn(state: unknown, search: string): string {
  const fromState = safeAuthReturnPath((state as { from?: unknown } | null)?.from, '');
  if (fromState) return fromState;
  return safeAuthReturnPath(new URLSearchParams(search).get(AUTH_RETURN_QUERY_PARAM), '');
}

/** Remember a destination for screens that finish a sign-in outside the login page. */
export function rememberAuthReturn(path: string): void {
  const safe = safeAuthReturnPath(path, '');
  if (!safe) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ path: safe, at: Date.now() }));
  } catch {
    // Storage unavailable (private mode, blocked site data): the URL and
    // router state still carry the destination for the ordinary sign-in.
  }
}

function readStoredAuthReturn(fallback: string): string {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as { path?: unknown; at?: unknown };
    if (typeof parsed.at !== 'number' || Date.now() - parsed.at > STORAGE_TTL_MS) {
      sessionStorage.removeItem(STORAGE_KEY);
      return fallback;
    }
    return safeAuthReturnPath(parsed.path, fallback);
  } catch {
    return fallback;
  }
}

/** Read the stored destination (or `fallback`) and forget it. */
export function consumeAuthReturn(fallback: string): string {
  const path = readStoredAuthReturn(fallback);
  clearAuthReturn();
  return path;
}

export function clearAuthReturn(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored that we can reach.
  }
}
