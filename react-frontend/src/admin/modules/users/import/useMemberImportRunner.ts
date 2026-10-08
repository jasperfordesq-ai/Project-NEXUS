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
const MAX_FAILURES = 3;

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
}

const DEFAULT_TIMINGS: RunnerTimings = { busyMs: 1000, rateLimitMs: 5000, retryBaseMs: 500 };

const initial: RunnerState = {
  phase: 'idle', total: 0, nextIndex: 0, batchNumber: 0, batchSize: FIRST_BATCH,
  created: 0, balance: '0.00', zeroed: 0, admissionIncomplete: 0, admissionIncompleteRows: [],
  held: false, stop: null, errorMessage: null, errorCode: null, startedAt: null, secondsRemaining: null,
};

const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

/**
 * Drives a checked member import batch by batch. The browser only names rows
 * (from/count); the server holds the data. Each batch is timed: quick batches
 * grow, slow ones shrink, always within 10–200 rows. A failed request is
 * retried with the SAME `from` — safe, because the server answers a repeated
 * batch without writing anything. A busy or rate-limited answer is waited out
 * and does not count towards the three failures that end the run.
 *
 * Leaving the page while a run is in progress halts it at the next batch
 * boundary: nobody is left to watch it or to see where it stopped.
 */
export function useMemberImportRunner(options?: { timings?: Partial<RunnerTimings> }) {
  const [state, setState] = useState<RunnerState>(initial);
  const stopRequested = useRef(false);
  const running = useRef(false);
  const unmounted = useRef(false);
  const timings = useRef<RunnerTimings>({ ...DEFAULT_TIMINGS, ...options?.timings });
  timings.current = { ...DEFAULT_TIMINGS, ...options?.timings };

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

      try {
        // The server, not this loop, decides when the import is over: when the
        // last row is done it still answers "running" once more and completes
        // on the next request, so keep asking from its position until then.
        for (;;) {
          if (unmounted.current) break;
          if (stopRequested.current) {
            setState((s) => ({ ...s, phase: 'stopped' }));
            break;
          }

          const t0 = performance.now();
          // The client reports failures as values; this only guards against a throw
          // leaving the run stuck in "running" with nobody told.
          const res: ApiResponse<BatchResult> = await adminMemberImport
            .batch(importId, next, size, first ? identityChecked : undefined)
            .catch((): ApiResponse<BatchResult> => ({ success: false, code: 'NETWORK_ERROR' }));
          // Wall-clock time includes the network. The server's own figure can never
          // be larger in practice, so taking the larger of the two changes nothing
          // live; it keeps the pacing decision driven by what the server reports.
          const elapsed = res.success && res.data
            ? Math.max(performance.now() - t0, res.data.batch.duration_ms)
            : performance.now() - t0;

          if (!res.success || !res.data) {
            if (res.code === 'IMPORT_BUSY') { await sleep(timings.current.busyMs); continue; }
            if (res.code === 'RATE_LIMIT_EXCEEDED') { await sleep(timings.current.rateLimitMs); continue; }
            // Held rows expired, or the server moved on (another tab): retrying cannot help.
            const fatal = res.code === 'IMPORT_NOT_FOUND' || res.code === 'IMPORT_OUT_OF_ORDER';
            failures += 1;
            if (fatal || failures >= MAX_FAILURES) {
              if (!unmounted.current) {
                setState((s) => ({ ...s, phase: 'failed', errorMessage: res.error ?? res.code ?? null, errorCode: res.code ?? null }));
              }
              break;
            }
            await sleep(timings.current.retryBaseMs * 2 ** (failures - 1));
            continue;
          }

          failures = 0;
          first = false;
          const d = res.data;
          if (d.batch.processed > 0) batchNumber += 1;
          next = d.next_index;
          if (elapsed < QUICK_MS) size = Math.min(MAX_BATCH, Math.round(size * 1.5));
          else if (elapsed > SLOW_MS) size = Math.max(MIN_BATCH, Math.round(size * 0.6));

          const rate = next / Math.max(1, (Date.now() - startedAt) / 1000);
          const phase = d.status === 'completed' ? 'completed'
            : d.status === 'stopped' ? 'stopped'
            : stopRequested.current ? 'stopped' : 'running';
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
        }
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
