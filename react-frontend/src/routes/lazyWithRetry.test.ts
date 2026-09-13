// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ATTEMPT_SERIES_RESET_MS,
  MAX_RECOVERY_ATTEMPTS,
  importWithChunkRecovery,
  isChunkLoadError,
  requestStaleChunkRecovery,
} from './lazyWithRetry';

/** Collect the reload/purge order so escalation can be asserted precisely. */
function makeHarness() {
  const calls: string[] = [];
  const reload = vi.fn(() => { calls.push('reload'); });
  const purge = vi.fn(() => { calls.push('purge'); return Promise.resolve(); });
  const schedule = vi.fn(() => { /* timeout guard never fires in tests */ });
  return { calls, reload, purge, schedule };
}

describe('dynamic import chunk recovery', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    sessionStorage.clear();
  });

  it('recognizes the deployed stale-chunk error variants', () => {
    expect(isChunkLoadError(new Error('Failed to fetch dynamically imported module'))).toBe(true);
    expect(isChunkLoadError(new Error('Unable to preload CSS for /assets/app.css'))).toBe(true);

    const namedError = new Error('chunk failed');
    namedError.name = 'ChunkLoadError';
    expect(isChunkLoadError(namedError)).toBe(true);
    expect(isChunkLoadError(new Error('ordinary API failure'))).toBe(false);
  });

  it('returns a successfully imported module unchanged', async () => {
    const module = { value: 'loaded' };
    await expect(importWithChunkRecovery(async () => module)).resolves.toBe(module);
  });

  it('preserves active text entry and surfaces a retryable chunk failure', async () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    const error = new Error('Loading chunk 42 failed');

    expect(requestStaleChunkRecovery(error)).toBe(false);
    expect(sessionStorage.length).toBe(0);
    await expect(importWithChunkRecovery(async () => Promise.reject(error))).rejects.toBe(error);
  });

  it('retries more than once before giving up', async () => {
    // REGRESSION (2026-09-13): recovery used to allow a single reload per route
    // per 30s and then fall through to the crash screen. A deploy reliably
    // produces two failures in a row — the reload re-requests the same stale
    // shell — so one attempt was never enough and users saw "Something went
    // wrong" instead of a recovered app.
    const error = new Error('Failed to fetch dynamically imported module');
    const { reload, purge, schedule } = makeHarness();

    for (let attempt = 1; attempt <= MAX_RECOVERY_ATTEMPTS; attempt += 1) {
      expect(requestStaleChunkRecovery(error, {
        reload, purge, schedule, now: () => attempt * 1_000,
      })).toBe(true);
      await Promise.resolve();
    }

    expect(reload).toHaveBeenCalledTimes(MAX_RECOVERY_ATTEMPTS);
    expect(MAX_RECOVERY_ATTEMPTS).toBeGreaterThan(1);
  });

  it('gives up once the attempt budget is spent so the error surfaces', async () => {
    const error = new Error('Failed to fetch dynamically imported module');
    const { reload, purge, schedule } = makeHarness();

    for (let attempt = 1; attempt <= MAX_RECOVERY_ATTEMPTS; attempt += 1) {
      requestStaleChunkRecovery(error, { reload, purge, schedule, now: () => attempt * 1_000 });
      await Promise.resolve();
    }

    // One past the budget: no further reload, so the boundary can render.
    expect(requestStaleChunkRecovery(error, {
      reload, purge, schedule, now: () => (MAX_RECOVERY_ATTEMPTS + 1) * 1_000,
    })).toBe(false);
    expect(reload).toHaveBeenCalledTimes(MAX_RECOVERY_ATTEMPTS);
  });

  it('purges cached HTML shells before every retry after the first', async () => {
    // A plain reload asks the service worker for the same URL and gets the same
    // previous-build shell back. Dropping the caches that can hold HTML forces
    // the navigation to the network.
    const error = new Error('Failed to fetch dynamically imported module');
    const { calls, reload, purge, schedule } = makeHarness();

    requestStaleChunkRecovery(error, { reload, purge, schedule, now: () => 1_000 });
    await Promise.resolve();
    expect(calls).toEqual(['reload']);
    expect(purge).not.toHaveBeenCalled();

    requestStaleChunkRecovery(error, { reload, purge, schedule, now: () => 2_000 });
    await Promise.resolve();
    expect(calls).toEqual(['reload', 'purge', 'reload']);
  });

  it('still reloads when the cache purge rejects or hangs', async () => {
    const error = new Error('Failed to fetch dynamically imported module');
    const reload = vi.fn();
    const schedule = vi.fn();
    const rejecting = vi.fn(() => Promise.reject(new Error('Cache API unavailable')));

    requestStaleChunkRecovery(error, { reload, purge: rejecting, schedule, now: () => 1_000 });
    requestStaleChunkRecovery(error, { reload, purge: rejecting, schedule, now: () => 2_000 });
    await Promise.resolve();
    await Promise.resolve();

    expect(reload).toHaveBeenCalledTimes(2);

    // And a hung purge is rescued by the scheduled timeout guard.
    const hanging = vi.fn(() => new Promise<void>(() => { /* never settles */ }));
    const guarded = vi.fn();
    const laterReload = vi.fn();
    requestStaleChunkRecovery(error, {
      reload: laterReload, purge: hanging, schedule: guarded, now: () => 3_000,
    });
    expect(guarded).toHaveBeenCalledTimes(1);
    expect(laterReload).not.toHaveBeenCalled();
    const guardCallback = guarded.mock.calls[0]?.[0];
    expect(guardCallback).toBeTypeOf('function');
    (guardCallback as () => void)();
    expect(laterReload).toHaveBeenCalledTimes(1);
  });

  it('starts a fresh attempt budget after a quiet period', async () => {
    const error = new Error('Failed to fetch dynamically imported module');
    const { reload, purge, schedule } = makeHarness();

    for (let attempt = 1; attempt <= MAX_RECOVERY_ATTEMPTS; attempt += 1) {
      requestStaleChunkRecovery(error, { reload, purge, schedule, now: () => attempt * 1_000 });
      await Promise.resolve();
    }
    expect(requestStaleChunkRecovery(error, {
      reload, purge, schedule, now: () => MAX_RECOVERY_ATTEMPTS * 1_000,
    })).toBe(false);

    // The page ran fine for a while, then a later deploy broke it again.
    const quiet = MAX_RECOVERY_ATTEMPTS * 1_000 + ATTEMPT_SERIES_RESET_MS + 1;
    expect(requestStaleChunkRecovery(error, {
      reload, purge, schedule, now: () => quiet,
    })).toBe(true);
  });

  it('upgrades the legacy single-timestamp record without losing its attempt', () => {
    // Sessions open across the deploy that ships this change still hold the old
    // bare-timestamp value. It must count as one spent attempt, not crash.
    const error = new Error('Failed to fetch dynamically imported module');
    const { reload, purge, schedule } = makeHarness();
    sessionStorage.setItem(`chunk_reload_${window.location.pathname}`, '1000');

    expect(requestStaleChunkRecovery(error, {
      reload, purge, schedule, now: () => 2_000,
    })).toBe(true);
    expect(purge).toHaveBeenCalledTimes(1);
  });
});
