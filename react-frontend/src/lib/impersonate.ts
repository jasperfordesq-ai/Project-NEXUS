// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Secure impersonation handoff between the admin tab and a new tab.
 *
 * Uses BroadcastChannel for memory-only transfer — the proof never touches
 * localStorage, sessionStorage, URL params, or any persistent store.
 *
 * Flow:
 * 1. Admin tab generates a unique session id, opens the new tab with
 *    `#impersonate=<sessionId>` so the listener can match its own session
 * 2. New tab's listener detects the hash, joins the channel, posts 'ready'
 *    with the session id
 * 3. Admin tab receives 'ready' (matching session id) and sends the proof,
 *    also tagged with the session id
 * 4. New tab EXCHANGES the proof for a real access token, stores that token in
 *    per-tab sessionStorage, and reloads
 * 5. Both sides close the channel
 *
 * The session id is critical: BroadcastChannel delivers messages to EVERY
 * same-origin instance, so without per-session tagging the admin tab's own
 * listener (registered by TenantShell) would catch the broadcast and stomp the
 * admin's auth, logging both tabs out.
 *
 * 🔴 The exchange in step 4 is not optional plumbing. The proof carries
 * `type: impersonation` and the auth middleware only accepts `type: access`, so
 * presenting the proof directly as a bearer token authenticates NOTHING — every
 * request 401s and the tab silently recovers as the admin instead. That was the
 * original defect. `POST /v2/auth/impersonate/exchange` is what turns the proof
 * into a session for the target member.
 */

import {
  API_BASE,
  tokenManager,
  IMPERSONATION_FLAG_KEY,
  IMPERSONATION_CONTEXT_KEY,
} from '@/lib/api';

const CHANNEL_NAME = 'nexus_impersonate';
const HANDOFF_TIMEOUT_MS = 30_000; // 30 seconds for new tab to be ready
const HASH_KEY = 'impersonate';

/** Tenant the impersonated member belongs to — needed to address the exchange. */
export interface ImpersonationHandoff {
  tenantId?: number | string | null;
  tenantSlug?: string | null;
}

/** What the impersonated tab remembers so it can render the exit banner. */
export interface ImpersonationContext {
  userId: number;
  userName: string;
  adminId: number;
  adminName: string;
  startedAt: number;
}

function generateSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Called from the admin tab after receiving the impersonation proof from the
 * API. Opens a new tab and waits for it to request the proof.
 *
 * @param token    The single-use impersonation proof
 * @param url      Target URL — should already be on the impersonated user's
 *                 tenant (e.g. `${origin}/${targetTenantSlug}/dashboard`)
 * @param handoff  Target tenant identifiers, so the new tab can address the
 *                 exchange at the right community rather than inheriting the
 *                 admin's (or defaulting to the master tenant).
 */
export function sendImpersonationToken(
  token: string,
  url: string,
  handoff: ImpersonationHandoff = {},
): void {
  const sessionId = generateSessionId();
  const channel = new BroadcastChannel(CHANNEL_NAME);

  channel.onmessage = (event: MessageEvent) => {
    if (event.data?.type === 'ready' && event.data?.sessionId === sessionId) {
      channel.postMessage({
        type: 'token',
        token,
        sessionId,
        tenantId: handoff.tenantId ?? null,
        tenantSlug: handoff.tenantSlug ?? null,
      });
      // Keep channel open briefly so message is delivered, then close
      setTimeout(() => channel.close(), 1000);
    }
  };

  // Append the session id as a hash fragment — survives the slug-recovery
  // redirect and identifies this tab as an impersonation target on mount.
  const separator = url.includes('#') ? '&' : '#';
  const targetUrl = `${url}${separator}${HASH_KEY}=${sessionId}`;
  window.open(targetUrl, '_blank');

  // Auto-close channel if new tab never signals ready
  setTimeout(() => {
    try { channel.close(); } catch { /* already closed */ }
  }, HANDOFF_TIMEOUT_MS);
}

/**
 * Read the impersonation session id from the current URL hash, if present.
 * Returns null when this tab is not an impersonation target.
 */
function readSessionIdFromHash(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return null;
  // Support both `#impersonate=<id>` and `#foo&impersonate=<id>` shapes
  for (const part of hash.split('&')) {
    const [k, v] = part.split('=');
    if (k === HASH_KEY && v) return decodeURIComponent(v);
  }
  return null;
}

/**
 * Strip the impersonation hash from the URL once consumed. Avoids the hash
 * sticking around after reload (which could trigger another handshake).
 */
function clearImpersonationHash(): void {
  try {
    const hash = window.location.hash.replace(/^#/, '');
    const filtered = hash.split('&').filter(p => !p.startsWith(`${HASH_KEY}=`));
    const newHash = filtered.length ? '#' + filtered.join('&') : '';
    const newUrl = window.location.pathname + window.location.search + newHash;
    window.history.replaceState(null, '', newUrl);
  } catch { /* best-effort */ }
}

function markTabAsImpersonating(): void {
  try {
    sessionStorage.setItem(IMPERSONATION_FLAG_KEY, '1');
  } catch { /* private mode — the session simply will not persist a reload */ }
}

function unmarkTabAsImpersonating(): void {
  try {
    sessionStorage.removeItem(IMPERSONATION_FLAG_KEY);
    sessionStorage.removeItem(IMPERSONATION_CONTEXT_KEY);
  } catch { /* best-effort */ }
}

/** Read this tab's impersonation context, or null when not impersonating. */
export function readImpersonationContext(): ImpersonationContext | null {
  try {
    const raw = sessionStorage.getItem(IMPERSONATION_CONTEXT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ImpersonationContext;
    return typeof parsed?.userId === 'number' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Exchange the single-use proof for a real session scoped to the target member.
 *
 * Raw fetch rather than the api client: the tab is mid-transition between two
 * identities, and this request must carry no Authorization header at all (the
 * admin's token would otherwise ride along) while still naming the target
 * community so the server resolves the right tenant.
 */
async function exchangeProofForSession(
  token: string,
  tenantId: number | string | null,
  tenantSlug: string | null,
): Promise<boolean> {
  // Set the flag FIRST. Everything the token manager writes from here on must
  // land in this tab's sessionStorage, never in the shared localStorage that
  // holds the admin's own session.
  markTabAsImpersonating();

  if (tenantId != null && String(tenantId) !== '') {
    tokenManager.setTenantId(tenantId);
  }
  if (tenantSlug) {
    tokenManager.setTenantSlug(tenantSlug);
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  if (tenantId != null && String(tenantId) !== '') {
    headers['X-Tenant-ID'] = String(tenantId);
  }
  if (tenantSlug) {
    headers['X-Tenant-Slug'] = tenantSlug;
  }

  try {
    const response = await fetch(`${API_BASE}/v2/auth/impersonate/exchange`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ token }),
      credentials: 'include',
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.success || !data?.access_token) {
      unmarkTabAsImpersonating();
      return false;
    }

    tokenManager.setAccessToken(data.access_token);

    const info = data.impersonation ?? {};
    try {
      sessionStorage.setItem(IMPERSONATION_CONTEXT_KEY, JSON.stringify({
        userId: Number(info.user_id ?? 0),
        userName: String(info.user_name ?? ''),
        adminId: Number(info.admin_id ?? 0),
        adminName: String(info.admin_name ?? ''),
        startedAt: Date.now(),
      } satisfies ImpersonationContext));
    } catch { /* banner will fall back to generic copy */ }

    return true;
  } catch {
    unmarkTabAsImpersonating();
    return false;
  }
}

/**
 * Called from TenantShell on mount. Only joins the broadcast channel when the
 * URL hash carries an impersonation session id — that means this tab was opened
 * by the admin tab specifically as an impersonation target.
 *
 * Without the session-id guard, every TenantShell mount (including the admin's
 * own tab) would catch the broadcast and stomp its own auth.
 *
 * @param onReceived  Called only after a session was successfully established.
 * @param onFailed    Called when the proof could not be exchanged (expired,
 *                    already used, target no longer eligible).
 */
export function listenForImpersonationToken(
  onReceived: () => void,
  onFailed?: () => void,
): () => void {
  const sessionId = readSessionIdFromHash();
  if (!sessionId) {
    // Not an impersonation target — do nothing, return a no-op cleanup.
    return () => {};
  }

  const channel = new BroadcastChannel(CHANNEL_NAME);
  let closed = false;

  channel.onmessage = (event: MessageEvent) => {
    if (
      event.data?.type === 'token'
      && typeof event.data.token === 'string'
      && event.data.sessionId === sessionId
    ) {
      const { token, tenantId = null, tenantSlug = null } = event.data;
      // The proof is single-use, so consume it exactly once: stop listening
      // before the async exchange starts.
      cleanup();
      void exchangeProofForSession(token, tenantId, tenantSlug).then((ok) => {
        clearImpersonationHash();
        if (ok) {
          onReceived();
        } else {
          onFailed?.();
        }
      });
    }
  };

  // Signal to the admin tab that this tab is ready to receive (with our id)
  channel.postMessage({ type: 'ready', sessionId });

  // Auto-close after timeout
  const timeout = setTimeout(() => cleanup(), HANDOFF_TIMEOUT_MS);

  function cleanup() {
    if (closed) return;
    closed = true;
    clearTimeout(timeout);
    try { channel.close(); } catch { /* already closed */ }
  }

  return cleanup;
}

/**
 * End the impersonated session in this tab.
 *
 * Revokes the session server-side (so the remaining minutes of the access token
 * cannot be replayed) and clears the per-tab credentials. The member's own
 * sessions are untouched.
 */
export async function endImpersonation(): Promise<void> {
  const token = tokenManager.getAccessToken();

  if (token) {
    try {
      await fetch(`${API_BASE}/v2/auth/impersonate/end`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
        },
        credentials: 'include',
      });
    } catch {
      // Revocation is best-effort; clearing the tab below is what the admin
      // sees, and the token expires on its own within the access-token window.
    }
  }

  tokenManager.clearAll();
  unmarkTabAsImpersonating();
}
