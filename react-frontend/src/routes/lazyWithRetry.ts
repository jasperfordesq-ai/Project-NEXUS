// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { lazy, type ComponentType } from 'react';

/** Reloads allowed for one route before the error boundary is left to render. */
export const MAX_RECOVERY_ATTEMPTS = 3;

/** A route that has behaved for this long starts a fresh attempt budget. */
export const ATTEMPT_SERIES_RESET_MS = 60_000;

/** Never let a stuck Cache API hold a recovery reload hostage. */
export const PURGE_TIMEOUT_MS = 2_000;

export function isChunkLoadError(error: unknown): error is Error {
  if (!(error instanceof Error)) return false;

  return (
    error.message?.includes('Failed to fetch dynamically imported module') ||
    error.message?.includes('error loading dynamically imported module') ||
    error.message?.includes('Loading chunk') ||
    error.message?.includes('Loading CSS chunk') ||
    error.message?.includes('Unable to preload CSS') ||
    error.name === 'ChunkLoadError'
  );
}

interface StaleChunkRecoveryOptions {
  now?: () => number;
  reload?: () => void;
  /** Test seam for {@link purgeCachedHtmlShells}. */
  purge?: () => Promise<void>;
  /** Test seam for the purge timeout guard. */
  schedule?: (callback: () => void, delayMs: number) => void;
}

interface AttemptSeries {
  attempts: number;
  lastAt: number;
}

function seriesKey(): string {
  return `chunk_reload_${window.location.pathname}`;
}

/**
 * Read the attempt series for this route, tolerating the legacy format (a bare
 * timestamp string) written by builds before 2026-09-13. A session that is
 * open across the deploy shipping this change must not crash on it, and its
 * already-spent reload must still count.
 */
function readSeries(key: string, now: number): AttemptSeries {
  const empty: AttemptSeries = { attempts: 0, lastAt: 0 };

  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(key);
  } catch {
    // Private-mode storage denial — behave as a first attempt.
    return empty;
  }
  if (!raw) return empty;

  let series: AttemptSeries;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'number') {
      series = { attempts: 1, lastAt: parsed };
    } else if (
      typeof parsed === 'object' && parsed !== null
      && typeof (parsed as AttemptSeries).attempts === 'number'
      && typeof (parsed as AttemptSeries).lastAt === 'number'
    ) {
      series = parsed as AttemptSeries;
    } else {
      return empty;
    }
  } catch {
    return empty;
  }

  // A quiet period means the route recovered; the next failure is unrelated.
  if (now - series.lastAt > ATTEMPT_SERIES_RESET_MS) return empty;
  return series;
}

function writeSeries(key: string, series: AttemptSeries): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(series));
  } catch {
    // Storage denial only costs us the attempt counter, not the reload.
  }
}

/**
 * Drop every cache that can hand back HTML: the Workbox precache (which holds
 * the index.html of the build that installed the worker) and any runtime HTML
 * shell cache.
 *
 * The service-worker *registration* is deliberately left alone — it owns the
 * push subscription, and unregistering it would silently disable web push for
 * the user just to recover a page load.
 */
export function purgeCachedHtmlShells(): Promise<void> {
  if (typeof caches === 'undefined') return Promise.resolve();

  return caches.keys()
    .then((names) => Promise.all(
      names
        .filter((name) => name.startsWith('workbox-precache') || name.includes('html-shell'))
        .map((name) => caches.delete(name)),
    ))
    .then(() => undefined)
    .catch(() => undefined);
}

/**
 * Apply the app's stale-chunk recovery policy. Returns true when a reload was
 * requested; false means the caller should let the error reach the boundary.
 *
 * Active text entry is never discarded automatically.
 *
 * 🔴 This allowed exactly ONE reload per route per 30 seconds until
 * 2026-09-13, which is why a deploy showed users the root crash screen: the
 * reload asked the service worker for the same URL and was handed the same
 * previous-build shell, the second failure landed inside the 30-second window,
 * and recovery declined. Retries after the first now purge cached HTML first,
 * so the navigation is forced to the network.
 */
export function requestStaleChunkRecovery(
  error: unknown,
  options: StaleChunkRecoveryOptions = {},
): boolean {
  if (!isChunkLoadError(error)) return false;

  const active = document.activeElement;
  const isUserTyping = active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    active?.getAttribute('contenteditable') === 'true';

  if (isUserTyping) return false;

  const now = (options.now ?? Date.now)();
  const key = seriesKey();
  const series = readSeries(key, now);

  if (series.attempts >= MAX_RECOVERY_ATTEMPTS) return false;

  const attempt = series.attempts + 1;
  writeSeries(key, { attempts: attempt, lastAt: now });

  const reload = options.reload ?? (() => window.location.reload());

  if (attempt === 1) {
    reload();
    return true;
  }

  const purge = options.purge ?? purgeCachedHtmlShells;
  const schedule = options.schedule
    ?? ((callback: () => void, delayMs: number) => { window.setTimeout(callback, delayMs); });

  let reloaded = false;
  const reloadOnce = () => {
    if (reloaded) return;
    reloaded = true;
    reload();
  };

  schedule(reloadOnce, PURGE_TIMEOUT_MS);
  void purge().then(reloadOnce, reloadOnce);
  return true;
}

/** Load any dynamic module using the same recovery policy as React.lazy. */
export async function importWithChunkRecovery<T>(importFn: () => Promise<T>): Promise<T> {
  try {
    return await importFn();
  } catch (error) {
    requestStaleChunkRecovery(error);
    throw error;
  }
}

/**
 * Wrapper around React.lazy() that handles stale chunk errors after deployment.
 * When a new build changes chunk hashes, users with a cached index.html will
 * try to load old chunk filenames that no longer exist. This catches that error
 * and forces a reload to fetch the current index.html.
 */
export function lazyWithRetry(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  importFn: () => Promise<{ default: ComponentType<any> }>
) {
  return lazy(() => importWithChunkRecovery(importFn));
}
