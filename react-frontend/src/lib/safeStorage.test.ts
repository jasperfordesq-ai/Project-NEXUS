// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  safeLocalStorageGet,
  safeLocalStorageGetJSON,
  safeLocalStorageRemove,
  safeLocalStorageSet,
  safeLocalStorageSetJSON,
} from './safeStorage';

function quotaError(): DOMException {
  return new DOMException('quota exceeded', 'QuotaExceededError');
}

describe('safeLocalStorage basic round trips', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('stores and reads a string', () => {
    expect(safeLocalStorageSet('k', 'v')).toBe(true);
    expect(safeLocalStorageGet('k')).toBe('v');
  });

  it('returns null for a missing key', () => {
    expect(safeLocalStorageGet('missing')).toBeNull();
  });

  it('removes a key', () => {
    safeLocalStorageSet('k', 'v');
    safeLocalStorageRemove('k');
    expect(safeLocalStorageGet('k')).toBeNull();
  });

  it('round-trips JSON', () => {
    expect(safeLocalStorageSetJSON('obj', { a: 1, b: [2, 3] })).toBe(true);
    expect(safeLocalStorageGetJSON('obj', null)).toEqual({ a: 1, b: [2, 3] });
  });

  it('returns the fallback for missing JSON', () => {
    expect(safeLocalStorageGetJSON('nope', { d: true })).toEqual({ d: true });
  });

  it('returns the fallback for malformed JSON', () => {
    localStorage.setItem('bad', '{not json');
    expect(safeLocalStorageGetJSON('bad', 'fb')).toBe('fb');
  });

  it('returns false when JSON.stringify throws (circular)', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(safeLocalStorageSetJSON('c', circular)).toBe(false);
  });
});

describe('safeLocalStorage failure handling', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('returns null when getItem throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(safeLocalStorageGet('k')).toBeNull();
  });

  it('swallows errors from removeItem', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => safeLocalStorageRemove('k')).not.toThrow();
  });

  it('returns false on a non-quota error during set (private mode)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(safeLocalStorageSet('k', 'v')).toBe(false);
  });
});

describe('safeLocalStorage quota eviction', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('evicts soft caches and retries after one quota error', () => {
    localStorage.setItem('i18n_cache', 'big');
    localStorage.setItem('nexus_recent_searches', 'x');

    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementationOnce(() => {
        throw quotaError();
      });
    // subsequent calls fall through to the real implementation

    expect(safeLocalStorageSet('nexus_theme', 'dark')).toBe(true);
    // soft-evictable keys were cleared
    expect(localStorage.getItem('i18n_cache')).toBeNull();
    expect(localStorage.getItem('nexus_recent_searches')).toBeNull();
    expect(spy).toHaveBeenCalled();
  });

  it('wipes all non-critical keys on the second stage, preserving critical ones', () => {
    localStorage.setItem('nexus_auth_binding:session', 'binding'); // non-secret continuity survives
    localStorage.setItem('nexus_access_token', 'legacy-token'); // retired credential is wiped
    localStorage.setItem('some_draft', 'draft'); // non-critical — wiped

    vi.spyOn(Storage.prototype, 'setItem')
      .mockImplementationOnce(() => {
        throw quotaError();
      })
      .mockImplementationOnce(() => {
        throw quotaError();
      });
    // third call falls through to the real implementation

    expect(safeLocalStorageSet('nexus_tenant_id', '2')).toBe(true);
    expect(localStorage.getItem('nexus_auth_binding:session')).toBe('binding');
    expect(localStorage.getItem('nexus_access_token')).toBeNull();
    expect(localStorage.getItem('some_draft')).toBeNull();
  });

  it('returns false and logs when the value still exceeds quota after full eviction', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw quotaError();
    });

    expect(safeLocalStorageSet('huge', 'x'.repeat(50))).toBe(false);
    expect(errSpy).toHaveBeenCalled();
  });
});
