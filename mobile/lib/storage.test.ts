// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * `lib/storage.ts` holds the access and refresh tokens. If it silently loses a
 * value, the member is logged out with no explanation and nothing in the app
 * knows why — which is exactly the "random logouts" symptom the `set()` Sentry
 * call was added to diagnose.
 *
 * Every method here deliberately swallows its errors and returns a falsy value,
 * so a broken store is indistinguishable from an empty one at the call site.
 * That makes the swallowing itself the thing worth pinning: these tests assert
 * that a failure is reported where it should be, and stays quiet where quiet is
 * correct.
 *
 * 🔴 `platformOS` is captured once at module load (`const platformOS =
 * Platform.OS`), so reassigning `Platform.OS` after import does nothing. Each
 * platform case must reset the module registry and re-require. Without that the
 * web branches are unreachable and appear as uncovered lines that no test can
 * ever reach.
 */

import type { storage as StorageModule } from './storage';

const mockGetItemAsync = jest.fn();
const mockSetItemAsync = jest.fn();
const mockDeleteItemAsync = jest.fn();
const mockCaptureException = jest.fn();
const mockReportException = jest.fn();

jest.mock('expo-secure-store', () => ({
  getItemAsync: (...args: unknown[]) => mockGetItemAsync(...args),
  setItemAsync: (...args: unknown[]) => mockSetItemAsync(...args),
  deleteItemAsync: (...args: unknown[]) => mockDeleteItemAsync(...args),
}));

jest.mock('@sentry/react-native', () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

// 🔴 storage.ts reports through `lib/observability/reportSink` — a module with NO
// imports — rather than through the reporter directly. Two earlier attempts failed:
// a static reporter import dragged Sentry and expo-constants into every module that
// touches storage (10 tests in this file died on "requiring the 'ExponentConstants'
// module"), and `await import()` fired nothing at all under Jest, which cannot run a
// native dynamic import without --experimental-vm-modules.
jest.mock('@/lib/observability/reportSink', () => ({
  reportToSink: (...args: unknown[]) => mockReportException(...args),
}));

/**
 * Load a fresh copy of the module with `Platform.OS` pinned to `os`.
 *
 * 🔴 The react-native mock is deliberately `{ Platform }` and nothing else.
 * Spreading `jest.requireActual('react-native')` looks safer but is not: the
 * spread eagerly evaluates every lazy getter on the module (FlatList,
 * VirtualizedList, DevMenu…), each of which reaches for a TurboModule that does
 * not exist under Jest, and the require throws an invariant before reaching
 * storage.ts. `lib/storage.ts` imports only `Platform`, so only `Platform` is
 * needed here.
 */
function loadStorageFor(os: 'ios' | 'android' | 'web'): typeof StorageModule {
  let loaded: typeof StorageModule;
  jest.isolateModules(() => {
    jest.doMock('react-native', () => ({ Platform: { OS: os } }));
    loaded = require('./storage').storage;
  });
  return loaded!;
}

describe('secure storage on a native platform', () => {
  let storage: typeof StorageModule;

  beforeEach(() => {
    jest.clearAllMocks();
    storage = loadStorageFor('ios');
  });

  it('reads through to the encrypted store rather than any plaintext fallback', async () => {
    mockGetItemAsync.mockResolvedValue('token-value');

    await expect(storage.get('auth_token')).resolves.toBe('token-value');
    expect(mockGetItemAsync).toHaveBeenCalledWith('auth_token');
  });

  it('writes through to the encrypted store', async () => {
    mockSetItemAsync.mockResolvedValue(undefined);

    await storage.set('auth_token', 'token-value');

    expect(mockSetItemAsync).toHaveBeenCalledWith('auth_token', 'token-value');
  });

  it('makes a successful secure write immediately visible to this app process', async () => {
    mockSetItemAsync.mockResolvedValue(undefined);

    await storage.set('auth_token', 'token-value');
    await expect(storage.get('auth_token')).resolves.toBe('token-value');

    // The first authenticated screen must not depend on an immediately
    // consistent Keychain read after login has already persisted the token.
    expect(mockGetItemAsync).not.toHaveBeenCalled();
  });

  it('returns null instead of throwing when the store cannot be read', async () => {
    // A throwing read must not crash the app — but the caller then cannot tell
    // "no token" from "keychain unavailable", which is why set() reports and
    // get() does not.
    mockGetItemAsync.mockRejectedValue(new Error('keychain unavailable'));

    await expect(storage.get('auth_token')).resolves.toBeNull();
  });

  it('reports a failed WRITE, with the key, so a silent logout is diagnosable', async () => {
    // 🔴 This used to assert `Sentry.captureException` directly, and passed — while the
    // report reached nobody, because Sentry has no DSN in any of the six build profiles.
    // It now goes through the reporter, which sends to Sentry AND to our own server.
    const failure = new Error('keystore full');
    mockSetItemAsync.mockRejectedValue(failure);

    await expect(storage.set('auth_token', 'token-value')).resolves.toBeUndefined();

    expect(mockReportException).toHaveBeenCalledWith(failure, {
      storage_op: 'set',
      key: 'auth_token',
    });
  });

  it('stays silent when a delete fails, because an absent key is not an error', async () => {
    mockDeleteItemAsync.mockRejectedValue(new Error('not found'));

    await expect(storage.remove('auth_token')).resolves.toBeUndefined();
    expect(mockCaptureException).not.toHaveBeenCalled();
    expect(mockReportException).not.toHaveBeenCalled();
  });

  it('round-trips a JSON value', async () => {
    mockSetItemAsync.mockResolvedValue(undefined);
    await storage.setJson('tenant', { slug: 'hour-timebank', id: 2 });

    expect(mockSetItemAsync).toHaveBeenCalledWith('tenant', '{"slug":"hour-timebank","id":2}');

    mockGetItemAsync.mockResolvedValue('{"slug":"hour-timebank","id":2}');
    await expect(storage.getJson('tenant')).resolves.toEqual({ slug: 'hour-timebank', id: 2 });
  });

  it('returns null for a corrupt JSON value instead of throwing at the call site', async () => {
    // A half-written blob must degrade to "no stored tenant", not crash startup.
    mockGetItemAsync.mockResolvedValue('{"slug":"hour-time');

    await expect(storage.getJson('tenant')).resolves.toBeNull();
  });

  it('treats an empty stored string as absent', async () => {
    mockGetItemAsync.mockResolvedValue('');

    await expect(storage.getJson('tenant')).resolves.toBeNull();
  });
});

describe('storage on web', () => {
  const originalWindow = global.window;

  beforeEach(() => {
    // Without this the "native store is never touched" assertions below see
    // calls left over from the native describe block above.
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.window = originalWindow;
  });

  /**
   * A Map-backed `Storage`. The full DOM interface is implemented rather than
   * cast away: `length`, `key` and `clear` are unused by lib/storage.ts today,
   * but a partial object satisfied only by a cast would hide the day it starts
   * using one.
   */
  function fakeLocalStorage(): Storage {
    const store = new Map<string, string>();
    return {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    };
  }

  it('uses localStorage when the browser provides it', async () => {
    global.window = { localStorage: fakeLocalStorage() } as unknown as Window & typeof globalThis;

    const storage = loadStorageFor('web');

    await storage.set('tenant_slug', 'hour-timebank');
    await expect(storage.get('tenant_slug')).resolves.toBe('hour-timebank');

    await storage.remove('tenant_slug');
    await expect(storage.get('tenant_slug')).resolves.toBeNull();

    // The encrypted native store must never be touched on web.
    expect(mockSetItemAsync).not.toHaveBeenCalled();
    expect(mockGetItemAsync).not.toHaveBeenCalled();
  });

  it('falls back to in-memory storage when localStorage is unavailable', async () => {
    // Server-side rendering and locked-down browsers both hit this path. Values
    // must survive within the session rather than silently vanishing.
    global.window = {} as unknown as Window & typeof globalThis;

    const storage = loadStorageFor('web');

    await storage.set('tenant_slug', 'hour-timebank');
    await expect(storage.get('tenant_slug')).resolves.toBe('hour-timebank');

    await storage.remove('tenant_slug');
    await expect(storage.get('tenant_slug')).resolves.toBeNull();
  });
});
