// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for useWebPush — W3C Push API subscription lifecycle hook.
 *
 * Design notes:
 *
 * 1. `SUPPORTED` is a module-level constant evaluated at import time.
 *    Tests call vi.resetModules() before each dynamic import to force a fresh
 *    evaluation.
 *
 * 2. "Unsupported" tests: we must NOT call Object.defineProperty(window,
 *    'Notification', { value: undefined }) because that CREATES the property
 *    (making `'Notification' in window` === true → SUPPORTED=true).
 *    Instead, we use `delete (window as any).Notification` to truly remove it.
 *
 * 3. Cleanup ordering: each test explicitly calls unmount() inside the test body
 *    before removing globals, so React's useEffect cleanup runs while globals
 *    are still present.  This prevents the "cannot read .removeEventListener of
 *    undefined" crash that occurs when cleanup fires after teardown.
 *
 * 4. Permission-denied test: the hook's mount refresh() reads
 *    Notification.permission from the global mock.  We set the mock's
 *    `.permission` property to 'denied' too so that if refresh() races
 *    subscribe() it still ends up as 'denied'.
 *
 * Branches covered:
 *  - SUPPORTED=false: isSupported, subscribe, unsubscribe
 *  - subscribe: permission denied / dismissed
 *  - subscribe: VAPID key null or absent from response
 *  - subscribe: SW not ready (getRegistration → null)
 *  - subscribe: existing subscription reused
 *  - subscribe: new subscription created + POSTed
 *  - subscribe: api.post success=false with/without error field
 *  - subscribe: thrown Error / non-Error
 *  - unsubscribe: sub present → pushSub.unsubscribe + api.post
 *  - unsubscribe: no sub → skips calls
 *  - unsubscribe: thrown Error
 *  - refresh: reads SW state on mount
 *  - SW message: nexus:push_subscription_changed triggers refresh
 *  - SW message: unrelated types ignored
 *  - Cleanup on unmount: removeEventListener called
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ─── Static vi.mock (hoisted; survives vi.resetModules) ───────────────────────
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

// ─── SW listener registry ─────────────────────────────────────────────────────
let _swListeners: ((e: MessageEvent) => void)[] = [];
function dispatchSwMessage(data: unknown) {
  _swListeners.forEach((fn) => fn({ data } as MessageEvent));
}

// ─── Factories ────────────────────────────────────────────────────────────────

function makeMockSub(endpoint = 'https://fcm.example/push/sub-1') {
  return {
    endpoint,
    unsubscribe: vi.fn().mockResolvedValue(true),
    toJSON: vi.fn(() => ({ endpoint, keys: { p256dh: 'ABC', auth: 'DEF' } })),
  };
}
type MockSub = ReturnType<typeof makeMockSub>;

function makeMockReg(existingSub: MockSub | null = null) {
  return {
    pushManager: {
      getSubscription: vi.fn().mockResolvedValue(existingSub),
      subscribe: vi.fn().mockResolvedValue(makeMockSub('https://fcm.example/push/new')),
    },
  };
}
type MockReg = ReturnType<typeof makeMockReg>;

/**
 * Build a mock navigator.serviceWorker.
 * When reg is null, .ready uses a lazy getter to avoid unhandled-rejection noise
 * (the rejected promise is only created+caught when the hook reads .ready).
 */
function makeSwMock(reg: MockReg | null) {
  _swListeners = [];
  const addEventListener = vi.fn((_: string, fn: (e: MessageEvent) => void) => {
    _swListeners.push(fn);
  });
  const removeEventListener = vi.fn((_: string, fn: (e: MessageEvent) => void) => {
    _swListeners = _swListeners.filter((h) => h !== fn);
  });
  if (reg) {
    return { addEventListener, removeEventListener, ready: Promise.resolve(reg) };
  }
  const mock = { addEventListener, removeEventListener } as { addEventListener: typeof addEventListener; removeEventListener: typeof removeEventListener; ready?: Promise<MockReg> };
  Object.defineProperty(mock, 'ready', {
    get() {
      const p = Promise.reject(new Error('no SW'));
      p.catch(() => { /* intentionally swallowed */ });
      return p;
    },
    configurable: true,
  });
  return mock;
}
type SwMock = ReturnType<typeof makeSwMock>;

// ─── Install / remove browser globals ────────────────────────────────────────

/**
 * Install all globals for SUPPORTED=true.
 * Must be called AFTER vi.resetModules() and BEFORE the dynamic import.
 */
function installGlobals(opts: {
  permission?: NotificationPermission;
  requestPermissionResult?: NotificationPermission;
  reg?: MockReg | null;
} = {}) {
  const {
    permission = 'default',
    requestPermissionResult = 'granted',
    reg = makeMockReg(null),
  } = opts;

  Object.defineProperty(window, 'PushManager', { configurable: true, writable: true, value: class {} });
  const NotifMock = { permission, requestPermission: vi.fn().mockResolvedValue(requestPermissionResult) };
  Object.defineProperty(window, 'Notification', { configurable: true, writable: true, value: NotifMock });
  const swMock = makeSwMock(reg);
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: swMock });
  return { swMock, NotifMock, reg };
}

/**
 * Ensure the three globals do NOT exist (not even as undefined-valued props).
 * Use delete so that `'Notification' in window` is false.
 */
function removeGlobals() {
  try { delete (window as Record<string, unknown>).PushManager; } catch { /* noop */ }
  try { delete (window as Record<string, unknown>).Notification; } catch { /* noop */ }
  try {
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined });
  } catch { /* noop */ }
}

beforeEach(() => {
  // resetModules reimports the hook, but the hoisted API mock keeps its call
  // history; each test must start with a fresh assertion baseline.
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — Unsupported browser
// ─────────────────────────────────────────────────────────────────────────────

describe('useWebPush — unsupported browser (SUPPORTED=false)', () => {
  it('reports isSupported=false and permission=unsupported', async () => {
    vi.resetModules();
    removeGlobals(); // ensure truly absent before import
    const { useWebPush } = await import('./useWebPush');

    const { result, unmount } = renderHook(() => useWebPush());
    expect(result.current.isSupported).toBe(false);
    expect(result.current.permission).toBe('unsupported');
    expect(result.current.isSubscribed).toBe(false);
    expect(result.current.isPending).toBe(false);
    expect(result.current.error).toBeNull();
    unmount();
  });

  it('subscribe() returns false and sets error, without calling any APIs', async () => {
    vi.resetModules();
    removeGlobals();
    const { useWebPush } = await import('./useWebPush');
    const { api } = await import('@/lib/api');
    vi.mocked(api.get).mockClear();
    vi.mocked(api.post).mockClear();

    const { result, unmount } = renderHook(() => useWebPush());
    let ret: boolean;
    await act(async () => { ret = await result.current.subscribe(); });

    expect(ret!).toBe(false);
    expect(result.current.error).toBe('Your browser does not support push notifications.');
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
    unmount();
  });

  it('unsubscribe() returns false immediately', async () => {
    vi.resetModules();
    removeGlobals();
    const { useWebPush } = await import('./useWebPush');
    const { result, unmount } = renderHook(() => useWebPush());
    let ret: boolean;
    await act(async () => { ret = await result.current.unsubscribe(); });
    expect(ret!).toBe(false);
    unmount();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — Initial state
// ─────────────────────────────────────────────────────────────────────────────

describe('useWebPush — initial state', () => {
  it('initialises with isSupported=true, permission=default, isSubscribed=false', async () => {
    vi.resetModules();
    installGlobals();
    const { useWebPush } = await import('./useWebPush');

    const { result, unmount } = renderHook(() => useWebPush());
    expect(result.current.isSupported).toBe(true);
    expect(result.current.permission).toBe('default');
    expect(result.current.isSubscribed).toBe(false);
    expect(result.current.isPending).toBe(false);
    expect(result.current.error).toBeNull();
    expect(typeof result.current.subscribe).toBe('function');
    expect(typeof result.current.unsubscribe).toBe('function');
    expect(typeof result.current.refresh).toBe('function');
    unmount();
    await act(async () => {});
    removeGlobals();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — refresh()
// ─────────────────────────────────────────────────────────────────────────────

describe('useWebPush — refresh()', () => {
  it('on mount sets isSubscribed=true when SW has an existing sub', async () => {
    vi.resetModules();
    const existingSub = makeMockSub('https://fcm.example/push/existing');
    const regWithSub = makeMockReg(existingSub);
    installGlobals({ permission: 'granted', reg: regWithSub });
    const { useWebPush } = await import('./useWebPush');

    const { result, unmount } = renderHook(() => useWebPush());
    await waitFor(() => expect(result.current.isSubscribed).toBe(true));
    expect(result.current.permission).toBe('granted');
    unmount();
    await act(async () => {});
    removeGlobals();
  });

  it('on mount keeps isSubscribed=false when SW has no sub', async () => {
    vi.resetModules();
    installGlobals({ reg: makeMockReg(null) });
    const { useWebPush } = await import('./useWebPush');

    const { result, unmount } = renderHook(() => useWebPush());
    await act(async () => {});
    expect(result.current.isSubscribed).toBe(false);
    unmount();
    await act(async () => {});
    removeGlobals();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — subscribe()
// ─────────────────────────────────────────────────────────────────────────────

describe('useWebPush — subscribe()', () => {
  it('returns false and sets permission=denied when permission is denied', async () => {
    vi.resetModules();
    // Set both .permission (read by readPermission/refresh) and requestPermission
    // return value to 'denied', so both paths agree on the final state.
    installGlobals({ permission: 'denied', requestPermissionResult: 'denied' });
    const { api } = await import('@/lib/api');
    vi.mocked(api.get).mockResolvedValue({ data: { vapid_public_key: 'dGVzdA' } });
    vi.mocked(api.post).mockResolvedValue({ success: true });
    const { useWebPush } = await import('./useWebPush');

    const { result, unmount } = renderHook(() => useWebPush());

    let ret: boolean;
    await act(async () => { ret = await result.current.subscribe(); });

    expect(ret!).toBe(false);
    expect(result.current.permission).toBe('denied');
    expect(result.current.isSubscribed).toBe(false);
    expect(result.current.isPending).toBe(false);
    unmount();
    await act(async () => {});
    removeGlobals();
  });

  it('returns false and keeps permission=default when dismissed (default result)', async () => {
    vi.resetModules();
    installGlobals({ permission: 'default', requestPermissionResult: 'default' });
    const { api } = await import('@/lib/api');
    vi.mocked(api.get).mockResolvedValue({ data: { vapid_public_key: 'dGVzdA' } });
    vi.mocked(api.post).mockResolvedValue({ success: true });
    const { useWebPush } = await import('./useWebPush');

    const { result, unmount } = renderHook(() => useWebPush());

    let ret: boolean;
    await act(async () => { ret = await result.current.subscribe(); });

    expect(ret!).toBe(false);
    expect(result.current.permission).toBe('default');
    unmount();
    await act(async () => {});
    removeGlobals();
  });

  it('returns false when server returns null vapid_public_key', async () => {
    vi.resetModules();
    installGlobals();
    const { api } = await import('@/lib/api');
    vi.mocked(api.get).mockResolvedValue({ data: { vapid_public_key: null } });
    vi.mocked(api.post).mockResolvedValue({ success: true });
    const { useWebPush } = await import('./useWebPush');

    const { result, unmount } = renderHook(() => useWebPush());
    let ret: boolean;
    await act(async () => { ret = await result.current.subscribe(); });

    expect(ret!).toBe(false);
    expect(result.current.error).toBe('Push notifications are not configured yet.');
    unmount();
    await act(async () => {});
    removeGlobals();
  });

  it('returns false when api.get returns null (no data)', async () => {
    vi.resetModules();
    installGlobals();
    const { api } = await import('@/lib/api');
    vi.mocked(api.get).mockResolvedValue(null);
    vi.mocked(api.post).mockResolvedValue({ success: true });
    const { useWebPush } = await import('./useWebPush');

    const { result, unmount } = renderHook(() => useWebPush());
    let ret: boolean;
    await act(async () => { ret = await result.current.subscribe(); });

    expect(ret!).toBe(false);
    expect(result.current.error).toBe('Push notifications are not configured yet.');
    unmount();
    await act(async () => {});
    removeGlobals();
  });

  it('returns false when SW.ready rejects (SW not ready)', async () => {
    vi.resetModules();
    installGlobals({ reg: null }); // lazy-rejected .ready
    const { api } = await import('@/lib/api');
    vi.mocked(api.get).mockResolvedValue({ data: { vapid_public_key: 'dGVzdA' } });
    vi.mocked(api.post).mockResolvedValue({ success: true });
    const { useWebPush } = await import('./useWebPush');

    const { result, unmount } = renderHook(() => useWebPush());
    let ret: boolean;
    await act(async () => { ret = await result.current.subscribe(); });

    expect(ret!).toBe(false);
    expect(result.current.error).toBe('Push notifications are not ready. Reload the page and try again.');
    unmount();
    await act(async () => {});
    removeGlobals();
  });

  it('reuses an existing PushSubscription without calling SW.subscribe()', async () => {
    vi.resetModules();
    const existingSub = makeMockSub('https://fcm.example/push/existing');
    const regWithSub = makeMockReg(existingSub);
    installGlobals({ reg: regWithSub });
    const { api } = await import('@/lib/api');
    vi.mocked(api.get).mockResolvedValue({ data: { vapid_public_key: 'dGVzdA' } });
    vi.mocked(api.post).mockResolvedValue({ success: true });
    const { useWebPush } = await import('./useWebPush');

    const { result, unmount } = renderHook(() => useWebPush());
    let ret: boolean;
    await act(async () => { ret = await result.current.subscribe(); });

    expect(ret!).toBe(true);
    expect(regWithSub.pushManager.subscribe).not.toHaveBeenCalled();
    expect(api.post).toHaveBeenCalledWith('/push/subscribe', expect.objectContaining({
      endpoint: 'https://fcm.example/push/existing',
    }));
    expect(result.current.isSubscribed).toBe(true);
    unmount();
    await act(async () => {});
    removeGlobals();
  });

  it('creates a new subscription and POSTs it to the server', async () => {
    vi.resetModules();
    const newReg = makeMockReg(null);
    installGlobals({ reg: newReg });
    const { api } = await import('@/lib/api');
    vi.mocked(api.get).mockResolvedValue({ data: { vapid_public_key: 'dGVzdA' } });
    vi.mocked(api.post).mockResolvedValue({ success: true });
    const { useWebPush } = await import('./useWebPush');

    const { result, unmount } = renderHook(() => useWebPush());
    let ret: boolean;
    await act(async () => { ret = await result.current.subscribe(); });

    expect(ret!).toBe(true);
    expect(newReg.pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    expect(api.post).toHaveBeenCalledWith('/push/subscribe', expect.objectContaining({ endpoint: 'https://fcm.example/push/new' }));
    expect(result.current.isSubscribed).toBe(true);
    expect(result.current.permission).toBe('granted');
    expect(result.current.isPending).toBe(false);
    expect(result.current.error).toBeNull();
    unmount();
    await act(async () => {});
    removeGlobals();
  });

  it('returns false when api.post returns success=false with error field', async () => {
    vi.resetModules();
    installGlobals();
    const { api } = await import('@/lib/api');
    vi.mocked(api.get).mockResolvedValue({ data: { vapid_public_key: 'dGVzdA' } });
    vi.mocked(api.post).mockResolvedValue({ success: false, error: 'Server rejected.' });
    const { useWebPush } = await import('./useWebPush');

    const { result, unmount } = renderHook(() => useWebPush());
    let ret: boolean;
    await act(async () => { ret = await result.current.subscribe(); });

    expect(ret!).toBe(false);
    expect(result.current.error).toBe("We couldn't enable push notifications. Please try again.");
    expect(result.current.isSubscribed).toBe(false);
    unmount();
    await act(async () => {});
    removeGlobals();
  });

  it('uses fallback error text when api.post returns success=false without error field', async () => {
    vi.resetModules();
    installGlobals();
    const { api } = await import('@/lib/api');
    vi.mocked(api.get).mockResolvedValue({ data: { vapid_public_key: 'dGVzdA' } });
    vi.mocked(api.post).mockResolvedValue({ success: false });
    const { useWebPush } = await import('./useWebPush');

    const { result, unmount } = renderHook(() => useWebPush());
    let ret: boolean;
    await act(async () => { ret = await result.current.subscribe(); });

    expect(ret!).toBe(false);
    expect(result.current.error).toBe("We couldn't enable push notifications. Please try again.");
    unmount();
    await act(async () => {});
    removeGlobals();
  });

  it('catches thrown Error instances and returns false', async () => {
    vi.resetModules();
    installGlobals();
    const { api } = await import('@/lib/api');
    vi.mocked(api.get).mockRejectedValue(new Error('Network failure'));
    vi.mocked(api.post).mockResolvedValue({ success: true });
    const { useWebPush } = await import('./useWebPush');

    const { result, unmount } = renderHook(() => useWebPush());
    let ret: boolean;
    await act(async () => { ret = await result.current.subscribe(); });

    expect(ret!).toBe(false);
    expect(result.current.error).toBe("We couldn't enable push notifications. Please try again.");
    expect(result.current.isPending).toBe(false);
    unmount();
    await act(async () => {});
    removeGlobals();
  });

  it('uses generic fallback message for non-Error throws', async () => {
    vi.resetModules();
    installGlobals();
    const { api } = await import('@/lib/api');
    vi.mocked(api.get).mockRejectedValue('some string error');
    vi.mocked(api.post).mockResolvedValue({ success: true });
    const { useWebPush } = await import('./useWebPush');

    const { result, unmount } = renderHook(() => useWebPush());
    let ret: boolean;
    await act(async () => { ret = await result.current.subscribe(); });

    expect(result.current.error).toBe("We couldn't enable push notifications. Please try again.");
    unmount();
    await act(async () => {});
    removeGlobals();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 5 — unsubscribe()
// ─────────────────────────────────────────────────────────────────────────────

describe('useWebPush — unsubscribe()', () => {
  it('calls pushSub.unsubscribe() and POSTs endpoint to server', async () => {
    vi.resetModules();
    const existingSub = makeMockSub('https://fcm.example/push/sub-99');
    const regWithSub = makeMockReg(existingSub);
    installGlobals({ permission: 'granted', reg: regWithSub });
    const { api } = await import('@/lib/api');
    vi.mocked(api.get).mockResolvedValue({ data: { vapid_public_key: 'dGVzdA' } });
    vi.mocked(api.post).mockResolvedValue({ success: true });
    const { useWebPush } = await import('./useWebPush');

    const { result, unmount } = renderHook(() => useWebPush());
    let ret: boolean;
    await act(async () => { ret = await result.current.unsubscribe(); });

    expect(ret!).toBe(true);
    expect(existingSub.unsubscribe).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/push/unsubscribe', { endpoint: 'https://fcm.example/push/sub-99' });
    expect(result.current.isSubscribed).toBe(false);
    expect(result.current.isPending).toBe(false);
    expect(result.current.error).toBeNull();
    unmount();
    await act(async () => {});
    removeGlobals();
  });

  it('skips api.post when there is no existing subscription', async () => {
    vi.resetModules();
    installGlobals({ reg: makeMockReg(null) });
    const { api } = await import('@/lib/api');
    vi.mocked(api.get).mockResolvedValue({ data: { vapid_public_key: 'dGVzdA' } });
    vi.mocked(api.post).mockResolvedValue({ success: true });
    const { useWebPush } = await import('./useWebPush');

    const { result, unmount } = renderHook(() => useWebPush());
    let ret: boolean;
    await act(async () => { ret = await result.current.unsubscribe(); });

    expect(ret!).toBe(true);
    expect(api.post).not.toHaveBeenCalled();
    expect(result.current.isSubscribed).toBe(false);
    unmount();
    await act(async () => {});
    removeGlobals();
  });

  it('catches errors and returns false', async () => {
    vi.resetModules();
    const throwingReg = {
      pushManager: {
        getSubscription: vi.fn().mockRejectedValue(new Error('SW getSubscription failed')),
        subscribe: vi.fn(),
      },
    } as unknown as MockReg;
    installGlobals({ reg: throwingReg });
    const { api } = await import('@/lib/api');
    vi.mocked(api.get).mockResolvedValue({ data: { vapid_public_key: 'dGVzdA' } });
    vi.mocked(api.post).mockResolvedValue({ success: true });
    const { useWebPush } = await import('./useWebPush');

    const { result, unmount } = renderHook(() => useWebPush());
    let ret: boolean;
    await act(async () => { ret = await result.current.unsubscribe(); });

    expect(ret!).toBe(false);
    expect(result.current.error).toBe("We couldn't disable push notifications. Please try again.");
    expect(result.current.isPending).toBe(false);
    unmount();
    await act(async () => {});
    removeGlobals();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 6 — SW message listener
// ─────────────────────────────────────────────────────────────────────────────

describe('useWebPush — SW message listener', () => {
  it('triggers refresh when SW sends nexus:push_subscription_changed', async () => {
    vi.resetModules();
    const dynamicReg = makeMockReg(null);
    installGlobals({ reg: dynamicReg });
    const { api } = await import('@/lib/api');
    vi.mocked(api.get).mockResolvedValue({ data: { vapid_public_key: 'dGVzdA' } });
    vi.mocked(api.post).mockResolvedValue({ success: true });
    const { useWebPush } = await import('./useWebPush');

    const { result, unmount } = renderHook(() => useWebPush());
    await act(async () => {});
    expect(result.current.isSubscribed).toBe(false);

    // Make the SW report a subscription now
    const newSub = makeMockSub('https://fcm.example/push/after-msg');
    dynamicReg.pushManager.getSubscription.mockResolvedValue(newSub);
    await act(async () => {
      dispatchSwMessage({ type: 'nexus:push_subscription_changed' });
      await new Promise((r) => setTimeout(r, 0));
    });

    await waitFor(() => expect(result.current.isSubscribed).toBe(true));
    unmount();
    await act(async () => {});
    removeGlobals();
  });

  it('does not trigger refresh on unrelated SW message types', async () => {
    vi.resetModules();
    const reg = makeMockReg(null);
    installGlobals({ reg });
    const { api } = await import('@/lib/api');
    vi.mocked(api.get).mockResolvedValue({ data: { vapid_public_key: 'dGVzdA' } });
    vi.mocked(api.post).mockResolvedValue({ success: true });
    const { useWebPush } = await import('./useWebPush');

    const { result, unmount } = renderHook(() => useWebPush());
    await act(async () => {});

    const callsBefore = reg.pushManager.getSubscription.mock.calls.length;
    await act(async () => { dispatchSwMessage({ type: 'some:other:type' }); });

    expect(reg.pushManager.getSubscription.mock.calls.length).toBe(callsBefore);
    unmount();
    await act(async () => {});
    removeGlobals();
  });

  it('removes the SW event listener on unmount', async () => {
    vi.resetModules();
    const { swMock } = installGlobals();
    const { api } = await import('@/lib/api');
    vi.mocked(api.get).mockResolvedValue({ data: { vapid_public_key: 'dGVzdA' } });
    vi.mocked(api.post).mockResolvedValue({ success: true });
    const { useWebPush } = await import('./useWebPush');

    const { result, unmount } = renderHook(() => useWebPush());
    await act(async () => {});
    expect(typeof result.current.subscribe).toBe('function');

    const removeBefore = (swMock.removeEventListener as ReturnType<typeof vi.fn>).mock.calls.length;
    unmount();
    await act(async () => {}); // flush cleanup effects

    expect((swMock.removeEventListener as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(removeBefore);
    removeGlobals();
  });
});
