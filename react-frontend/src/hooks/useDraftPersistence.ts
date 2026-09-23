// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState, useCallback, useRef, useEffect } from 'react';
import { safeLocalStorageGet, safeLocalStorageSet, safeLocalStorageRemove } from '@/lib/safeStorage';

/**
 * useDraftPersistence — Saves and restores compose form drafts from localStorage.
 *
 * On mount, checks localStorage for a saved draft under `key`. If found and
 * parseable, uses it as the initial value; otherwise falls back to `initialValue`.
 *
 * `setValue` updates React state immediately and debounce-saves to localStorage
 * after a 2-second delay. Supports both direct value and updater function patterns.
 *
 * `clearDraft` removes the key from localStorage and resets state to `initialValue`.
 *
 * The key must name the tenant and the signed-in member (build it with
 * `userScopedStorageKey` from `@/lib/userScopedStorage`) so that a draft is
 * never shown to another member on a shared browser (F-109). When the key
 * changes, the hook loads the draft stored under the new key.
 *
 * @param key - Unique localStorage key for this draft (e.g., 'compose-draft-post:t2:u17')
 * @param initialValue - Default value when no draft exists
 * @returns [value, setValue, clearDraft]
 */
function readDraft<T>(key: string, initialValue: T): T {
  const stored = safeLocalStorageGet(key);
  if (stored !== null) {
    try {
      return JSON.parse(stored) as T;
    } catch {
      // Corrupt data — remove it and fall back to initialValue
      safeLocalStorageRemove(key);
    }
  }
  return initialValue;
}

export function useDraftPersistence<T>(
  key: string,
  initialValue: T,
): [T, (val: T | ((prev: T) => T)) => void, () => void] {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [value, setValueInternal] = useState<T>(() => readDraft(key, initialValue));

  // F-109: callers key drafts by tenant and member, so the key changes when a
  // different member signs in without this component unmounting. Show that
  // member's own draft (or the initial value) — never keep the previous
  // member's text on screen, where it could be published under the new account.
  const [loadedKey, setLoadedKey] = useState(key);
  if (loadedKey !== key) {
    setLoadedKey(key);
    setValueInternal(readDraft(key, initialValue));
  }

  // Keep initialValue in a ref so clearDraft always uses the latest
  const initialValueRef = useRef(initialValue);
  initialValueRef.current = initialValue;

  // Keep key in a ref for the debounce callback
  const keyRef = useRef(key);
  keyRef.current = key;

  const persistToStorage = useCallback((val: T) => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
    }
    // Capture the key now: a save scheduled for one member must never land
    // under the key of whoever is signed in when the timer fires.
    const targetKey = keyRef.current;
    debounceRef.current = setTimeout(() => {
      try {
        const serialized = JSON.stringify(val);
        // Skip persistence for empty/default drafts to avoid localStorage bloat.
        // Also guard against extremely large drafts (>100KB) that could cause
        // quota issues on mobile browsers with limited localStorage.
        if (serialized === JSON.stringify(initialValueRef.current)) {
          safeLocalStorageRemove(targetKey);
        } else if (serialized.length <= 100_000) {
          safeLocalStorageSet(targetKey, serialized);
        }
        // If >100KB, silently skip — the draft is still in React state
      } catch {
        // JSON.stringify failed (circular ref) — silently skip
      }
      debounceRef.current = null;
    }, 2000);
  }, []);

  const setValue = useCallback(
    (val: T | ((prev: T) => T)) => {
      setValueInternal((prev) => {
        const next = typeof val === 'function' ? (val as (prev: T) => T)(prev) : val;
        persistToStorage(next);
        return next;
      });
    },
    [persistToStorage],
  );

  const clearDraft = useCallback(() => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    safeLocalStorageRemove(keyRef.current);
    setValueInternal(initialValueRef.current);
  }, []);

  // A pending save belongs to the previous key's member — drop it on key change.
  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [key]);

  // Clean up pending timeout on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  return [value, setValue, clearDraft];
}
