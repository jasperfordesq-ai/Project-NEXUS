// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendImpersonationToken, listenForImpersonationToken, endImpersonation } from './impersonate';

// ── Mock @/lib/api ──────────────────────────────────────────────────────────
vi.mock('@/lib/api', () => ({
  API_BASE: '/api',
  IMPERSONATION_FLAG_KEY: 'nexus_impersonation_active',
  IMPERSONATION_CONTEXT_KEY: 'nexus_impersonation_context',
  isImpersonatedTab: vi.fn(() => false),
  tokenManager: {
    setAccessToken: vi.fn(),
    getAccessToken: vi.fn(() => 'impersonated-access-token'),
    setTenantId: vi.fn(),
    setTenantSlug: vi.fn(),
    clearAll: vi.fn(),
  },
}));

import { tokenManager } from '@/lib/api';

/**
 * Let the exchange's promise chain settle. The handoff is now asynchronous —
 * receiving the proof kicks off POST /v2/auth/impersonate/exchange, and nothing
 * observable happens until that resolves.
 */
async function flushExchange(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
  }
}

/** Successful exchange response, as the endpoint shapes it. */
function mockExchangeOk(accessToken = 'real-access-token') {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      success: true,
      access_token: accessToken,
      impersonation: {
        user_id: 42,
        user_name: 'Sam Member',
        admin_id: 7,
        admin_name: 'Ada Admin',
      },
    }),
  });
}

// ── BroadcastChannel mock ────────────────────────────────────────────────────
// jsdom does not implement BroadcastChannel; we provide a minimal in-memory stub
// that lets tests drive onmessage handlers synchronously.

interface MockBCInstance {
  name: string;
  postMessage: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onmessage: ((event: MessageEvent) => void) | null;
  _simulateMessage: (data: unknown) => void;
}

const bcInstances: MockBCInstance[] = [];

class MockBroadcastChannel {
  name: string;
  postMessage = vi.fn();
  onmessage: ((event: MessageEvent) => void) | null = null;
  private _closed = false;

  close = vi.fn().mockImplementation(() => {
    // Simulate real BroadcastChannel: close silences future messages
    this._closed = true;
  });

  constructor(name: string) {
    this.name = name;
    bcInstances.push(this as unknown as MockBCInstance);
  }

  _simulateMessage(data: unknown) {
    if (!this._closed && this.onmessage) {
      this.onmessage({ data } as MessageEvent);
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function setHash(hash: string) {
  Object.defineProperty(window, 'location', {
    writable: true,
    value: {
      ...window.location,
      hash,
      pathname: '/hour-timebank/dashboard',
      search: '',
    },
  });
}

function clearHash() {
  setHash('');
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  bcInstances.length = 0;
  vi.useFakeTimers();
  vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
  // Provide a stable crypto.randomUUID
  vi.stubGlobal('crypto', {
    randomUUID: vi.fn().mockReturnValue('test-session-uuid-1234'),
  });
  // Stub window.open so it does not throw
  vi.spyOn(window, 'open').mockReturnValue(null);
  // Stub history.replaceState so clearImpersonationHash works
  vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
  clearHash();
  vi.mocked(tokenManager.setAccessToken).mockClear();
  vi.mocked(tokenManager.setTenantId).mockClear();
  vi.mocked(tokenManager.setTenantSlug).mockClear();
  vi.mocked(tokenManager.clearAll).mockClear();
  sessionStorage.clear();
  // Default: the exchange succeeds. Individual tests override.
  vi.stubGlobal('fetch', mockExchangeOk());
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  clearHash();
});

// ── sendImpersonationToken ───────────────────────────────────────────────────

describe('sendImpersonationToken', () => {
  it('opens a new tab with #impersonate=<sessionId> appended', () => {
    sendImpersonationToken('jwt-abc', 'https://example.com/hour-timebank/dashboard');
    expect(window.open).toHaveBeenCalledWith(
      'https://example.com/hour-timebank/dashboard#impersonate=test-session-uuid-1234',
      '_blank',
    );
  });

  it('uses & separator when URL already contains a hash fragment', () => {
    sendImpersonationToken('jwt-abc', 'https://example.com/hour-timebank/dashboard#foo=bar');
    expect(window.open).toHaveBeenCalledWith(
      'https://example.com/hour-timebank/dashboard#foo=bar&impersonate=test-session-uuid-1234',
      '_blank',
    );
  });

  it('creates a BroadcastChannel on the correct channel name', () => {
    sendImpersonationToken('jwt-abc', 'https://example.com/target');
    expect(bcInstances).toHaveLength(1);
    expect(bcInstances[0].name).toBe('nexus_impersonate');
  });

  it('sends the token when a matching ready message arrives', () => {
    sendImpersonationToken('jwt-abc', 'https://example.com/target');
    const bc = bcInstances[0] as unknown as MockBCInstance & MockBroadcastChannel;

    // Simulate new tab posting 'ready' with matching session id
    bc._simulateMessage({ type: 'ready', sessionId: 'test-session-uuid-1234' });

    expect(bc.postMessage).toHaveBeenCalledWith({
      type: 'token',
      token: 'jwt-abc',
      sessionId: 'test-session-uuid-1234',
      tenantId: null,
      tenantSlug: null,
    });
  });

  it('forwards the target tenant so the new tab can address the exchange', () => {
    sendImpersonationToken('jwt-abc', 'https://example.com/target', {
      tenantId: 5,
      tenantSlug: 'other-community',
    });
    const bc = bcInstances[0] as unknown as MockBCInstance & MockBroadcastChannel;

    bc._simulateMessage({ type: 'ready', sessionId: 'test-session-uuid-1234' });

    expect(bc.postMessage).toHaveBeenCalledWith({
      type: 'token',
      token: 'jwt-abc',
      sessionId: 'test-session-uuid-1234',
      tenantId: 5,
      tenantSlug: 'other-community',
    });
  });

  it('ignores a ready message with a mismatched session id', () => {
    sendImpersonationToken('jwt-abc', 'https://example.com/target');
    const bc = bcInstances[0] as unknown as MockBCInstance & MockBroadcastChannel;

    bc._simulateMessage({ type: 'ready', sessionId: 'wrong-session-id' });

    // postMessage should NOT have been called with a token (only close/setup overhead)
    expect(bc.postMessage).not.toHaveBeenCalled();
  });

  it('ignores a message with an unexpected type', () => {
    sendImpersonationToken('jwt-abc', 'https://example.com/target');
    const bc = bcInstances[0] as unknown as MockBCInstance & MockBroadcastChannel;

    bc._simulateMessage({ type: 'unknown', sessionId: 'test-session-uuid-1234' });

    expect(bc.postMessage).not.toHaveBeenCalled();
  });

  it('ignores a null/missing message payload', () => {
    sendImpersonationToken('jwt-abc', 'https://example.com/target');
    const bc = bcInstances[0] as unknown as MockBCInstance & MockBroadcastChannel;

    bc._simulateMessage(null);
    bc._simulateMessage(undefined);

    expect(bc.postMessage).not.toHaveBeenCalled();
  });

  it('closes the channel ~1 s after the token is sent', () => {
    sendImpersonationToken('jwt-abc', 'https://example.com/target');
    const bc = bcInstances[0] as unknown as MockBCInstance & MockBroadcastChannel;

    bc._simulateMessage({ type: 'ready', sessionId: 'test-session-uuid-1234' });

    expect(bc.close).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1001);

    expect(bc.close).toHaveBeenCalledTimes(1);
  });

  it('auto-closes the channel after 30 s if the new tab never signals ready', () => {
    sendImpersonationToken('jwt-abc', 'https://example.com/target');
    const bc = bcInstances[0] as unknown as MockBCInstance & MockBroadcastChannel;

    vi.advanceTimersByTime(30_001);

    expect(bc.close).toHaveBeenCalledTimes(1);
  });

  it('uses the crypto.randomUUID fallback when randomUUID is unavailable', () => {
    // Override crypto to remove randomUUID
    vi.stubGlobal('crypto', {});

    sendImpersonationToken('jwt-fallback', 'https://example.com/target');

    // Should still open a tab (with some generated session id, just not the UUID)
    expect(window.open).toHaveBeenCalled();
    const calledUrl = vi.mocked(window.open).mock.calls[0][0] as string;
    expect(calledUrl).toContain('#impersonate=');
    // The fragment should be a non-empty string
    const fragment = calledUrl.split('#impersonate=')[1];
    expect(fragment.length).toBeGreaterThan(0);
  });
});

// ── listenForImpersonationToken ───────────────────────────────────────────────

describe('listenForImpersonationToken', () => {
  it('returns a no-op cleanup when no impersonation hash is present', () => {
    // No hash set — readSessionIdFromHash returns null
    const onReceived = vi.fn();
    const cleanup = listenForImpersonationToken(onReceived);

    // Should not open a channel
    expect(bcInstances).toHaveLength(0);

    // Cleanup should be callable without throwing
    expect(() => cleanup()).not.toThrow();
    expect(onReceived).not.toHaveBeenCalled();
  });

  it('does NOT join the channel when hash has a different key', () => {
    setHash('#foo=bar&other=value');
    const onReceived = vi.fn();
    listenForImpersonationToken(onReceived);

    expect(bcInstances).toHaveLength(0);
    expect(onReceived).not.toHaveBeenCalled();
  });

  it('joins the channel and posts "ready" with the session id from hash', () => {
    setHash('#impersonate=my-session-id');
    const onReceived = vi.fn();
    listenForImpersonationToken(onReceived);

    expect(bcInstances).toHaveLength(1);
    expect(bcInstances[0].name).toBe('nexus_impersonate');
    expect(bcInstances[0].postMessage).toHaveBeenCalledWith({
      type: 'ready',
      sessionId: 'my-session-id',
    });
  });

  it('reads sessionId from #impersonate=<id> (simple hash)', () => {
    setHash('#impersonate=simple-session');
    const onReceived = vi.fn();
    listenForImpersonationToken(onReceived);

    const bc = bcInstances[0] as unknown as MockBCInstance & MockBroadcastChannel;
    expect(bc.postMessage).toHaveBeenCalledWith({
      type: 'ready',
      sessionId: 'simple-session',
    });
  });

  it('reads sessionId from compound hash (#foo&impersonate=<id>)', () => {
    setHash('#foo=bar&impersonate=compound-session');
    const onReceived = vi.fn();
    listenForImpersonationToken(onReceived);

    const bc = bcInstances[0] as unknown as MockBCInstance & MockBroadcastChannel;
    expect(bc.postMessage).toHaveBeenCalledWith({
      type: 'ready',
      sessionId: 'compound-session',
    });
  });

  it('EXCHANGES the proof rather than using it as a credential', async () => {
    // 🔴 The regression this file previously encoded: it asserted the raw proof
    // was stored as the access token. That is precisely what did not work — the
    // proof is type "impersonation" and the auth middleware only accepts type
    // "access", so every request 401'd. The proof must be exchanged.
    setHash('#impersonate=my-session-id');
    const onReceived = vi.fn();
    listenForImpersonationToken(onReceived);

    const bc = bcInstances[0] as unknown as MockBCInstance & MockBroadcastChannel;
    bc._simulateMessage({
      type: 'token',
      token: 'the-impersonation-proof',
      sessionId: 'my-session-id',
      tenantId: 5,
      tenantSlug: 'other-community',
    });
    await flushExchange();

    expect(fetch).toHaveBeenCalledWith(
      '/api/v2/auth/impersonate/exchange',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ token: 'the-impersonation-proof' }),
      }),
    );
    // The token that gets stored is the exchanged one, never the proof.
    expect(tokenManager.setAccessToken).toHaveBeenCalledWith('real-access-token');
    expect(tokenManager.setAccessToken).not.toHaveBeenCalledWith('the-impersonation-proof');
    expect(onReceived).toHaveBeenCalledTimes(1);
  });

  it('marks the tab as impersonating BEFORE storing the exchanged token', async () => {
    // Ordering matters: the flag is what routes token writes into this tab's
    // sessionStorage instead of the shared localStorage holding the admin's own
    // session.
    setHash('#impersonate=my-session-id');
    let flagWhenTokenStored: string | null = null;
    vi.mocked(tokenManager.setAccessToken).mockImplementation(() => {
      flagWhenTokenStored = sessionStorage.getItem('nexus_impersonation_active');
    });

    listenForImpersonationToken(vi.fn());
    const bc = bcInstances[0] as unknown as MockBCInstance & MockBroadcastChannel;
    bc._simulateMessage({ type: 'token', token: 'proof', sessionId: 'my-session-id' });
    await flushExchange();

    expect(flagWhenTokenStored).toBe('1');
  });

  it('seeds the target tenant so the exchange resolves the right community', async () => {
    setHash('#impersonate=my-session-id');
    listenForImpersonationToken(vi.fn());

    const bc = bcInstances[0] as unknown as MockBCInstance & MockBroadcastChannel;
    bc._simulateMessage({
      type: 'token',
      token: 'proof',
      sessionId: 'my-session-id',
      tenantId: 5,
      tenantSlug: 'other-community',
    });
    await flushExchange();

    expect(tokenManager.setTenantId).toHaveBeenCalledWith(5);
    expect(tokenManager.setTenantSlug).toHaveBeenCalledWith('other-community');
    const init = (vi.mocked(fetch).mock.calls[0]?.[1] ?? {}) as RequestInit;
    expect(init.headers).toMatchObject({
      'X-Tenant-ID': '5',
      'X-Tenant-Slug': 'other-community',
    });
  });

  it('sends no Authorization header — the admin token must not ride along', async () => {
    setHash('#impersonate=my-session-id');
    listenForImpersonationToken(vi.fn());

    const bc = bcInstances[0] as unknown as MockBCInstance & MockBroadcastChannel;
    bc._simulateMessage({ type: 'token', token: 'proof', sessionId: 'my-session-id' });
    await flushExchange();

    const init = (vi.mocked(fetch).mock.calls[0]?.[1] ?? {}) as RequestInit;
    expect(init.headers).not.toHaveProperty('Authorization');
  });

  it('reports failure and clears the flag when the exchange is refused', async () => {
    // Expired or already-spent proof. Leaving the tab silently unchanged is what
    // made this read as "the button did nothing".
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ success: false }),
    }));
    setHash('#impersonate=my-session-id');
    const onReceived = vi.fn();
    const onFailed = vi.fn();
    listenForImpersonationToken(onReceived, onFailed);

    const bc = bcInstances[0] as unknown as MockBCInstance & MockBroadcastChannel;
    bc._simulateMessage({ type: 'token', token: 'stale-proof', sessionId: 'my-session-id' });
    await flushExchange();

    expect(onReceived).not.toHaveBeenCalled();
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('nexus_impersonation_active')).toBeNull();
  });

  it('reports failure when the exchange request itself throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    setHash('#impersonate=my-session-id');
    const onFailed = vi.fn();
    listenForImpersonationToken(vi.fn(), onFailed);

    const bc = bcInstances[0] as unknown as MockBCInstance & MockBroadcastChannel;
    bc._simulateMessage({ type: 'token', token: 'proof', sessionId: 'my-session-id' });
    await flushExchange();

    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('nexus_impersonation_active')).toBeNull();
  });

  it('stores the impersonation context so the banner can render', async () => {
    setHash('#impersonate=my-session-id');
    listenForImpersonationToken(vi.fn());

    const bc = bcInstances[0] as unknown as MockBCInstance & MockBroadcastChannel;
    bc._simulateMessage({ type: 'token', token: 'proof', sessionId: 'my-session-id' });
    await flushExchange();

    const stored = JSON.parse(sessionStorage.getItem('nexus_impersonation_context') ?? '{}');
    expect(stored.userId).toBe(42);
    expect(stored.userName).toBe('Sam Member');
    expect(stored.adminName).toBe('Ada Admin');
  });

  it('calls clearImpersonationHash (replaceState) when token is received', async () => {
    setHash('#impersonate=my-session-id');
    const onReceived = vi.fn();
    listenForImpersonationToken(onReceived);

    const bc = bcInstances[0] as unknown as MockBCInstance & MockBroadcastChannel;
    bc._simulateMessage({
      type: 'token',
      token: 'the-jwt',
      sessionId: 'my-session-id',
    });
    await flushExchange();

    expect(window.history.replaceState).toHaveBeenCalled();
  });

  it('closes the channel after receiving the token', () => {
    setHash('#impersonate=my-session-id');
    const onReceived = vi.fn();
    listenForImpersonationToken(onReceived);

    const bc = bcInstances[0] as unknown as MockBCInstance & MockBroadcastChannel;
    bc._simulateMessage({
      type: 'token',
      token: 'the-jwt',
      sessionId: 'my-session-id',
    });

    expect(bc.close).toHaveBeenCalledTimes(1);
  });

  it('ignores a token message with mismatched session id', () => {
    setHash('#impersonate=my-session-id');
    const onReceived = vi.fn();
    listenForImpersonationToken(onReceived);

    const bc = bcInstances[0] as unknown as MockBCInstance & MockBroadcastChannel;
    bc._simulateMessage({
      type: 'token',
      token: 'the-jwt',
      sessionId: 'wrong-session-id',
    });

    expect(tokenManager.setAccessToken).not.toHaveBeenCalled();
    expect(onReceived).not.toHaveBeenCalled();
    expect(bc.close).not.toHaveBeenCalled();
  });

  it('ignores a token message where token is not a string', () => {
    setHash('#impersonate=my-session-id');
    const onReceived = vi.fn();
    listenForImpersonationToken(onReceived);

    const bc = bcInstances[0] as unknown as MockBCInstance & MockBroadcastChannel;
    bc._simulateMessage({
      type: 'token',
      token: 12345,        // not a string
      sessionId: 'my-session-id',
    });

    expect(tokenManager.setAccessToken).not.toHaveBeenCalled();
    expect(onReceived).not.toHaveBeenCalled();
  });

  it('ignores a message of wrong type', () => {
    setHash('#impersonate=my-session-id');
    const onReceived = vi.fn();
    listenForImpersonationToken(onReceived);

    const bc = bcInstances[0] as unknown as MockBCInstance & MockBroadcastChannel;
    bc._simulateMessage({ type: 'ready', sessionId: 'my-session-id' });

    expect(tokenManager.setAccessToken).not.toHaveBeenCalled();
    expect(onReceived).not.toHaveBeenCalled();
  });

  it('ignores a null message payload', () => {
    setHash('#impersonate=my-session-id');
    const onReceived = vi.fn();
    listenForImpersonationToken(onReceived);

    const bc = bcInstances[0] as unknown as MockBCInstance & MockBroadcastChannel;
    bc._simulateMessage(null);

    expect(onReceived).not.toHaveBeenCalled();
  });

  it('does not call onReceived more than once even if two matching messages arrive', async () => {
    setHash('#impersonate=my-session-id');
    const onReceived = vi.fn();
    listenForImpersonationToken(onReceived);

    const bc = bcInstances[0] as unknown as MockBCInstance & MockBroadcastChannel;
    const msg = { type: 'token', token: 'the-jwt', sessionId: 'my-session-id' };
    bc._simulateMessage(msg);
    // Channel is closed now; second message arrives on the (already closed) handler
    bc._simulateMessage(msg);
    await flushExchange();

    expect(onReceived).toHaveBeenCalledTimes(1);
    // The proof is single-use, so it must be spent exactly once.
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('auto-closes the channel after 30 s without receiving a token', () => {
    setHash('#impersonate=my-session-id');
    const onReceived = vi.fn();
    listenForImpersonationToken(onReceived);

    const bc = bcInstances[0] as unknown as MockBCInstance & MockBroadcastChannel;

    vi.advanceTimersByTime(30_001);

    expect(bc.close).toHaveBeenCalledTimes(1);
    expect(onReceived).not.toHaveBeenCalled();
  });

  it('returned cleanup function closes the channel immediately', () => {
    setHash('#impersonate=my-session-id');
    const onReceived = vi.fn();
    const cleanup = listenForImpersonationToken(onReceived);

    const bc = bcInstances[0] as unknown as MockBCInstance & MockBroadcastChannel;

    cleanup();

    expect(bc.close).toHaveBeenCalledTimes(1);
  });

  it('calling cleanup twice does not close the channel a second time', () => {
    setHash('#impersonate=my-session-id');
    const onReceived = vi.fn();
    const cleanup = listenForImpersonationToken(onReceived);

    const bc = bcInstances[0] as unknown as MockBCInstance & MockBroadcastChannel;

    cleanup();
    cleanup(); // second call — `closed` guard should prevent a double-close

    expect(bc.close).toHaveBeenCalledTimes(1);
  });

  it('decodes a URI-encoded session id from the hash', () => {
    // Session ids from randomUUID are plain, but test defensive decode path
    setHash('#impersonate=hello%20world');
    const onReceived = vi.fn();
    listenForImpersonationToken(onReceived);

    const bc = bcInstances[0] as unknown as MockBCInstance & MockBroadcastChannel;
    expect(bc.postMessage).toHaveBeenCalledWith({
      type: 'ready',
      sessionId: 'hello world',
    });
  });
});

// ── endImpersonation ─────────────────────────────────────────────────────────

describe('endImpersonation', () => {
  it('revokes the session server-side and clears this tab', async () => {
    sessionStorage.setItem('nexus_impersonation_active', '1');
    sessionStorage.setItem('nexus_impersonation_context', '{"userId":42}');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }));

    await endImpersonation();

    expect(fetch).toHaveBeenCalledWith(
      '/api/v2/auth/impersonate/end',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer impersonated-access-token',
        }),
      }),
    );
    expect(tokenManager.clearAll).toHaveBeenCalled();
    expect(sessionStorage.getItem('nexus_impersonation_active')).toBeNull();
    expect(sessionStorage.getItem('nexus_impersonation_context')).toBeNull();
  });

  it('still clears the tab when revocation fails', async () => {
    // The admin pressed "stop viewing" — that must always take effect locally,
    // even offline. The token expires on its own inside the access window.
    sessionStorage.setItem('nexus_impersonation_active', '1');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    await endImpersonation();

    expect(tokenManager.clearAll).toHaveBeenCalled();
    expect(sessionStorage.getItem('nexus_impersonation_active')).toBeNull();
  });
});
