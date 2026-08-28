// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import * as SecureStore from 'expo-secure-store';
import { reportToSink } from '@/lib/observability/reportSink';
import { Platform } from 'react-native';

const memoryStorage = new Map<string, string>();
const platformOS = Platform.OS;

function canUseWebStorage(): boolean {
  return platformOS === 'web' && typeof window !== 'undefined' && !!window.localStorage;
}

function isWeb(): boolean {
  return platformOS === 'web';
}

/**
 * Secure key-value storage backed by expo-secure-store.
 * Values are encrypted at rest on both iOS (Keychain) and Android (Keystore).
 * All methods are async and return null on missing/error rather than throwing.
 */
/**
 * Reports a storage failure without dragging the reporter into every consumer.
 *
 * 🔴 Goes through `reportSink`, a module with NO imports, and the reason is measured.
 * A static import of the reporter here pulled `@sentry/react-native` and
 * `expo-constants` into every module that touches storage, breaking 10 tests in
 * `lib/storage.test.ts`. Switching to `await import()` looked cleaner and was worse:
 * Jest cannot run a native dynamic import without `--experimental-vm-modules`, so the
 * report silently never fired under test and the catch hid the reason.
 *
 * Same class of mistake as coupling AuthProvider to the toast provider: infrastructure
 * must stay light enough to be used without a full native environment.
 */
function reportStorageFailure(err: unknown, op: string, key: string): void {
  reportToSink(err, { storage_op: op, key });
}

export const storage = {
  async get(key: string): Promise<string | null> {
    try {
      if (canUseWebStorage()) {
        return window.localStorage.getItem(key);
      }

      if (isWeb()) {
        return memoryStorage.get(key) ?? null;
      }

      // Keep the current process off the Keychain hot path. More importantly,
      // iOS Simulator can briefly return "missing" immediately after a successful
      // SecItemAdd; the first authenticated screen must still see the token that
      // login just persisted.
      if (memoryStorage.has(key)) {
        return memoryStorage.get(key) ?? null;
      }

      const value = await SecureStore.getItemAsync(key);
      if (value !== null) memoryStorage.set(key, value);
      return value;
    } catch {
      return null;
    }
  },

  async set(key: string, value: string): Promise<void> {
    try {
      if (canUseWebStorage()) {
        window.localStorage.setItem(key, value);
        return;
      }

      if (isWeb()) {
        memoryStorage.set(key, value);
        return;
      }

      await SecureStore.setItemAsync(key, value);
      // Only cache after the encrypted write succeeds. A failed Keychain write
      // must not create a session that disappears on the next app launch.
      memoryStorage.set(key, value);
    } catch (err) {
      // Diagnose "random logouts". Reported to BOTH Sentry and our own server —
      // Sentry alone has no DSN in any build profile, so this used to go nowhere.
      reportStorageFailure(err, 'set', key);
    }
  },

  async remove(key: string): Promise<void> {
    try {
      if (canUseWebStorage()) {
        window.localStorage.removeItem(key);
        return;
      }

      if (isWeb()) {
        memoryStorage.delete(key);
        return;
      }

      memoryStorage.delete(key);
      await SecureStore.deleteItemAsync(key);
    } catch {
      // Already absent or unavailable — not an error
    }
  },

  /** Store a JSON-serialisable object */
  async setJson<T>(key: string, value: T): Promise<void> {
    await storage.set(key, JSON.stringify(value));
  },

  /** Retrieve and parse a previously stored JSON object */
  async getJson<T>(key: string): Promise<T | null> {
    const raw = await storage.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },
};
