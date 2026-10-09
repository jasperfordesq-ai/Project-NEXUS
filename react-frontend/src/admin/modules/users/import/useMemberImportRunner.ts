// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useRef, useState } from 'react';
import { adminMemberImport } from '@/admin/api/adminApi';
import type { ApiResponse } from '@/lib/api';
import type { BatchResult, RunnerState } from './types';

const FIRST_BATCH = 25;
const MIN_BATCH = 10;
const MAX_BATCH = 200;
const QUICK_MS = 1000;
const SLOW_MS = 3000;
// Only a guard for a slow network or a client timeout, never the growth signal.
const WALL_GUARD_MS = 10000;
const MAX_FAILURES = 3;
const MAX_NO_PROGRESS = 30;

/** Waits between attempts. Production values; tests pass shorter ones. */
export interface RunnerTimings {
  /** Another request for the same import is still running on the server. */
  busyMs: number;
  /**
   * The server said "too many requests". Its Retry-After header is not
   * exposed by the API client, so this fixed wait stands in for it.
   */
  rateLimitMs: number;
  /** First wait after an ordinary failure; doubles for each further one. */
  retryBaseMs: number;
  /** Pause after a response that moved the import no further. */
  noProgressMs: number;
  /** Give up after this much consecutive busy / rate-limited waiting (10 minutes). */
  maxWaitMs: number;
}

const DEFAULT_TIMINGS: RunnerTimings = {
  busyMs: 1000, rateLimitMs: 5000, retryBaseMs: 500, noProgressMs: 1000, maxWaitMs: 10 * 60 * 1000,
};

const initial: RunnerState = {
  phase: 'idle', total: 0, nextIndex: 0, batchNumber: 0, batchSize: FIRST_BATCH,
  created: 0, balance: '0.00', zeroed: 0, admissionIncomplete: 0, admissionIncompleteRows: [],
  held: false, stop: null, errorCode: null, startedAt: null, secondsRemaining: null,
};

const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

/**
 * Drives a checked member import batch by batch. The browser only names rows
 * (from/count); the server holds the data. Batch size follows the server's OWN
 * work time for the batch (`batch.duration_ms`): under 1 s it grows by half, over
 * 3 s it shrinks, always within 10–200 rows. The round-trip time is deliberately
 * not the signal: every request carries a fixed overhead (authentication,
 * step-up, framework start-up) that does not depend on batch size, so judging by
 * wall-clock keeps small batches looking "medium" and never grows them, which is
 * exactly when bigger batches help most. Wall-clock only shrinks the batch when a
 * round trip exceeds 10 s (slow network, risk of the 60 s request timeout). A
 * response that processed nothing (a replay or the final completion) leaves the
 * size alone. A failed request is
 * retried with the SAME `from` — safe, because the server answers a repeated
 * batch without writing anything. A busy or rate-limited answer is waited out
 * and does not count towards the three failures that end the run.
 *
 * Stop lets the batch in flight finish, then sends one last call flagged
 * `stop` so the server discards the member data it is holding for the import
 * at once. If that call fails (or the run failed on a lost connection), the
 * server's copy simply expires within two hours.
 *
 * Leaving the page while a run is in progress halts it at the next batch
 * boundary: nobody is left to watch it or to see where it stopped.
 */
export function useMemberImportRunner(options?: { timings?: Partial<RunnerTimings>; now?: () => number }) {
  const [state, setState] = useState<RunnerState>(initial);
  const stopRequested = useRef(false);
  const running = useRef(false);
  const unmounted = useRef(false);
  const timings = useRef<RunnerTimings>({ ...DEFAULT_TIMINGS, ...options?.timings });
  timings.current = { ...DEFAULT_TIMINGS, ...options?.timings };
  const clock = useRef<() => number>(() => performance.now());
  clock.current = options?.now ?? (() => performance.now());

  useEffect(() => {
    unmounted.current = false;
    return () => { unmounted.current = true; };
  }, []);

  useEffect(() => {
    if (state.phase !== 'running' && state.phase !== 'stopping') return undefined;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [state.phase]);

  const start = useCallback((importId: string, total: number, identityChecked: boolean) => {
    if (running.current) return;
    running.current = true;
    stopRequested.current = false;
    const startedAt = Date.now();
    setState({ ...initial, phase: 'running', total, startedAt });

    void (async () => {
      let next = 0;
      let size = FIRST_BATCH;
      let batchNumber = 0;
      let failures = 0;
      let first = true;
      let noProgress = 0;
      let waitedMs = 0;
      // The loop ended because the admin pressed Stop (not because the server stopped it).
      let adminStopped = false;
      // Only the machine code is kept: the window words every failure from its own
      // translations and never shows the server's (or an exception's) raw text.
      const fail = (errorCode: string) => {
        if (!unmounted.current) setState((s) => ({ ...s, phase: 'failed', errorCode }));
      };

      try {
        // The server, not this loop, decides when the import is over. It
        // completes the import in the same request that writes the last row; an
        // import left "running" with every row written (the request ended before
        // completion was saved) is completed by the next request, so keep asking
        // from the server's position until it says completed or stopped.
        for (;;) {
          if (unmounted.current) break;
          if (stopRequested.current) {
            adminStopped = true;
            break;
          }

          const t0 = clock.current();
          // The client reports failures as values; this only guards against a throw
          // leaving the run stuck in "running" with nobody told.
          const res: ApiResponse<BatchResult> = await adminMemberImport
            .batch(importId, next, size, first ? identityChecked : undefined)
            .catch((): ApiResponse<BatchResult> => ({ success: false, code: 'NETWORK_ERROR' }));
          const wallMs = clock.current() - t0;

          if (!res.success || !res.data) {
            if (res.code === 'IMPORT_BUSY' || res.code === 'RATE_LIMIT_EXCEEDED') {
              // Waiting is free of the failure budget, but not endless.
              if (waitedMs >= timings.current.maxWaitMs) { fail(res.code); break; }
              const wait = res.code === 'IMPORT_BUSY' ? timings.current.busyMs : timings.current.rateLimitMs;
              await sleep(wait);
              waitedMs += wait;
              continue;
            }
            waitedMs = 0;
            // Held rows expired, or the server moved on (another tab): retrying cannot help.
            const fatal = res.code === 'IMPORT_NOT_FOUND' || res.code === 'IMPORT_OUT_OF_ORDER';
            failures += 1;
            if (fatal || failures >= MAX_FAILURES) {
              fail(res.code ?? 'UNKNOWN');
              break;
            }
            await sleep(timings.current.retryBaseMs * 2 ** (failures - 1));
            continue;
          }

          failures = 0;
          waitedMs = 0;
          first = false;
          const d = res.data;
          if (d.batch.processed > 0) batchNumber += 1;
          // Never go backwards: the server's position only moves forward.
          const previous = next;
          next = Math.max(next, d.next_index);
          const stalled = d.status === 'running' && d.batch.processed === 0 && next === previous;
          noProgress = stalled ? noProgress + 1 : 0;
          if (d.batch.processed > 0) {
            if (d.batch.duration_ms > SLOW_MS || wallMs > WALL_GUARD_MS) size = Math.max(MIN_BATCH, Math.round(size * 0.6));
            else if (d.batch.duration_ms < QUICK_MS) size = Math.min(MAX_BATCH, Math.round(size * 1.5));
          }

          const rate = next / Math.max(1, (Date.now() - startedAt) / 1000);
          adminStopped = d.status === 'running' && stopRequested.current;
          const phase = d.status === 'completed' ? 'completed'
            : d.status === 'stopped' ? 'stopped'
            : adminStopped ? 'stopping' : 'running';
          if (!unmounted.current) {
            setState((s) => ({
              ...s, phase, nextIndex: next, batchNumber, batchSize: size,
              created: d.totals.created, balance: d.totals.balance, zeroed: d.totals.zeroed,
              admissionIncomplete: d.totals.admission_incomplete ?? 0,
              admissionIncompleteRows: d.admission_incomplete_rows ?? [],
              held: d.held, stop: d.stop,
              secondsRemaining: phase === 'completed' ? 0 : rate > 0 ? Math.ceil(Math.max(0, total - next) / rate) : null,
            }));
          }
          if (phase !== 'running') break;
          if (stalled) {
            // No tight loop on a server that keeps answering without moving.
            if (noProgress >= MAX_NO_PROGRESS) { fail('NO_PROGRESS'); break; }
            await sleep(timings.current.noProgressMs);
          }
        }

        if (adminStopped) {
          // Tell the server once, so it discards the member data it holds for
          // this import now rather than keep it until it expires (two hours).
          // Best effort: if this call fails the data still expires on its own.
          const res: ApiResponse<BatchResult> | null = await adminMemberImport
            .batch(importId, next, MIN_BATCH, undefined, true)
            .catch(() => null);
          const d = res?.success ? res.data : undefined;
          if (!unmounted.current) {
            setState((s) => (d
              ? {
                // "completed" if every member was already written when the stop arrived.
                ...s, phase: d.status === 'completed' ? 'completed' : 'stopped',
                nextIndex: Math.max(next, d.next_index),
                created: d.totals.created, balance: d.totals.balance, zeroed: d.totals.zeroed,
                admissionIncomplete: d.totals.admission_incomplete ?? 0,
                admissionIncompleteRows: d.admission_incomplete_rows ?? [],
                held: d.held, stop: d.stop,
                secondsRemaining: d.status === 'completed' ? 0 : s.secondsRemaining,
              }
              : { ...s, phase: 'stopped' }));
          }
        }
      } catch {
        fail('UNEXPECTED');
      } finally {
        running.current = false;
      }
    })();
  }, []);

  const stop = useCallback(() => {
    stopRequested.current = true;
    setState((s) => (s.phase === 'running' ? { ...s, phase: 'stopping' } : s));
  }, []);

  return { state, start, stop };
}
