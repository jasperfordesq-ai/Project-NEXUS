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

it('distinguishes an unreadable required security preference from an absent value', async () => {
  const storage = loadStorageFor('android');
  mockGetItemAsync.mockRejectedValueOnce(new Error('Keychain unavailable'));
  await expect(storage.get('nexus_biometric_lock_enabled_v1', { required: true })).rejects.toThrow('Keychain unavailable');
  mockGetItemAsync.mockResolvedValueOnce(null);
  await expect(storage.get('nexus_biometric_lock_enabled_v1', { required: true })).resolves.toBeNull();
});

it('does not let a delayed read repopulate the cache after removal', async () => {
  const storage = loadStorageFor('android');
  let finish!: (value: string) => void;
  mockGetItemAsync.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
  mockGetItemAsync.mockResolvedValue(null);
  mockDeleteItemAsync.mockResolvedValue(undefined);
  const read = storage.get('nexus_auth_token');
  await Promise.resolve();
  const remove = storage.remove('nexus_auth_token');
  finish('old-token');
  await Promise.all([read, remove]);
  await expect(storage.get('nexus_auth_token')).resolves.toBeNull();
});

it('keeps a logout removal after an already-running credential write', async () => {
  const storage = loadStorageFor('android');
  const disk = new Map<string, string>();
  let finish!: () => void;
  mockSetItemAsync.mockImplementationOnce((key, value) => new Promise<void>(resolve => {
    finish = () => { disk.set(key, value); resolve(); };
  }));
  mockDeleteItemAsync.mockImplementationOnce(async key => { disk.delete(key); });
  mockGetItemAsync.mockImplementation(async key => disk.get(key) ?? null);
  const write = storage.set('nexus_auth_token', 'late-token', { required: true });
  await Promise.resolve();
  const remove = storage.remove('nexus_auth_token');
  finish();
  await Promise.all([write, remove]);
  expect(disk.has('nexus_auth_token')).toBe(false);
  await expect(storage.get('nexus_auth_token')).resolves.toBeNull();
});

const mockGetItemAsync = jest.fn();
const mockSetItemAsync = jest.fn();
const mockDeleteItemAsync = jest.fn();
const mockCaptureException = jest.fn();
const mockReportException = jest.fn();
const mockPublicRead = jest.fn();
const mockPublicWrite = jest.fn();
const mockPublicInfo = jest.fn();
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  getInfoAsync: (...args: unknown[]) => mockPublicInfo(...args),
  readAsStringAsync: (...args: unknown[]) => mockPublicRead(...args),
  writeAsStringAsync: (...args: unknown[]) => mockPublicWrite(...args),
  deleteAsync: jest.fn(),
}));

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
    mockPublicInfo.mockResolvedValue({ exists: false });
    mockPublicWrite.mockResolvedValue(undefined);
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
      // Not on the memory-fallback allowlist: a credential is still dropped
      // rather than cached, so the report says the value was genuinely lost.
      recovered_in_memory: false,
    });
  });

  it('does NOT cache a credential whose encrypted write failed', async () => {
    // A failed token write must not manufacture a session that looks alive now
    // and disappears on the next launch. This is the rule MEMORY_FALLBACK_KEYS
    // deliberately does not relax.
    mockSetItemAsync.mockRejectedValue(new Error('keychain unavailable'));
    mockGetItemAsync.mockResolvedValue(null);

    await storage.set('nexus_auth_token', 'token-value');

    await expect(storage.get('nexus_auth_token')).resolves.toBeNull();
    expect(mockGetItemAsync).toHaveBeenCalledWith('nexus_auth_token');
  });

  it('keeps a non-secret value for this session when the Keychain refuses the write', async () => {
    // 🔴 The measured fault: expo-secure-store fails outright on a build with no
    // keychain-sharing entitlement ("A required entitlement isn't present"),
    // writing nexus_tenant_slug. Before this, set() cached nothing on failure,
    // so the community the member was browsing was lost for the whole session.
    const failure = new Error("A required entitlement isn't present.");
    mockSetItemAsync.mockRejectedValue(failure);
    mockPublicWrite.mockRejectedValue(failure);

    await expect(storage.set('nexus_tenant_slug', 'hour-timebank')).resolves.toBeUndefined();

    // Survives in memory, and without touching the store that just failed.
    await expect(storage.get('nexus_tenant_slug')).resolves.toBe('hour-timebank');
    expect(mockGetItemAsync).not.toHaveBeenCalled();

    // Still reported — a working fallback must not hide that the write failed.
    expect(mockReportException).toHaveBeenCalledWith(failure, {
      storage_op: 'set',
      key: 'nexus_tenant_slug',
      recovered_in_memory: true,
    });
  });

  it('applies the memory fallback to every allowlisted non-secret key', async () => {
    mockSetItemAsync.mockRejectedValue(new Error('keychain unavailable'));
    mockPublicWrite.mockRejectedValue(new Error('disk unavailable'));

    for (const key of ['nexus_tenant_slug', 'nexus_language', 'nexus_theme_mode']) {
      await storage.set(key, `value-for-${key}`);
      await expect(storage.get(key)).resolves.toBe(`value-for-${key}`);
    }
  });

  it('treats an unknown key strictly, so a new key does not silently opt in', async () => {
    // The allowlist exists so that adding a key later keeps the strict
    // behaviour until someone decides it is safe to relax.
    mockSetItemAsync.mockRejectedValue(new Error('keychain unavailable'));
    mockGetItemAsync.mockResolvedValue(null);

    await storage.set('nexus_some_future_key', 'value');

    await expect(storage.get('nexus_some_future_key')).resolves.toBeNull();
  });

  it('surfaces required credential write failures to the sign-in caller', async () => {
    mockSetItemAsync.mockRejectedValueOnce(new Error('Encrypted storage unavailable'));
    await expect(storage.set('nexus_auth_token', 'credential', { required: true })).rejects.toThrow('Encrypted storage unavailable');
    expect(mockPublicWrite).not.toHaveBeenCalled();
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

  it('stores large public configuration in files without writing it to the Keychain', async () => {
    const config = JSON.stringify({ description: 'a'.repeat(6000) });
    await storage.set('nexus_tenant_config_test', config);
    expect(mockPublicWrite).toHaveBeenCalledWith('file:///documents/public-nexus_tenant_config_test.json', config);
    expect(mockSetItemAsync).not.toHaveBeenCalled();
    await expect(storage.get('nexus_tenant_config_test')).resolves.toBe(config);
  });

  it('migrates existing public preferences only after the file write succeeds', async () => {
    mockGetItemAsync.mockResolvedValue('hour-timebank');
    await expect(storage.get('nexus_tenant_slug')).resolves.toBe('hour-timebank');
    expect(mockPublicWrite).toHaveBeenCalledWith('file:///documents/public-nexus_tenant_slug.json', 'hour-timebank');
    expect(mockDeleteItemAsync).toHaveBeenCalledWith('nexus_tenant_slug');
    const restarted = loadStorageFor('ios');
    mockPublicInfo.mockResolvedValue({ exists: true });
    mockPublicRead.mockResolvedValue('hour-timebank');
    mockGetItemAsync.mockClear();
    await expect(restarted.get('nexus_tenant_slug')).resolves.toBe('hour-timebank');
    expect(mockGetItemAsync).not.toHaveBeenCalled();
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
