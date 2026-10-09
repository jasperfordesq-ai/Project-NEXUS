// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiResponse } from '@/lib/api';
import type { BatchResult } from './types';

const batch = vi.fn<(importId: string, from: number, count: number, identityChecked?: boolean, stop?: boolean) => Promise<ApiResponse<BatchResult>>>();
vi.mock('@/admin/api/adminApi', () => ({
  adminMemberImport: {
    batch: (importId: string, from: number, count: number, identityChecked?: boolean, stop?: boolean) =>
      stop === undefined ? batch(importId, from, count, identityChecked) : batch(importId, from, count, identityChecked, stop),
  },
}));

import { useMemberImportRunner } from './useMemberImportRunner';

// Production waits are 1 s (busy), 5 s (rate limited) and 0.5 s doubling
// (failures); tests shorten them so the file stays fast.
const FAST = { timings: { busyMs: 5, rateLimitMs: 5, retryBaseMs: 5, noProgressMs: 1 } };

function ok(from: number, processed: number, total: number, ms: number, extra: Partial<BatchResult> = {}): ApiResponse<BatchResult> {
  const next = from + processed;
  return {
    success: true,
    data: {
      import_id: 'id', status: next >= total ? 'completed' : 'running', next_index: next, total,
      totals: { created: next, balance: '0.00', zeroed: 0, admission_incomplete: 0 },
      admission_incomplete_rows: [], stop: null, held: false,
      batch: { processed, created: processed, duration_ms: ms }, ...extra,
    },
  };
}

function serve(total: number, ms = 200) {
  return (_id: string, from: number, count: number) => Promise.resolve(ok(from, Math.min(count, total - from), total, ms));
}

describe('useMemberImportRunner', () => {
  beforeEach(() => { batch.mockReset(); vi.useRealTimers(); });

  it('imports every row and finishes', async () => {
    batch.mockImplementation(serve(60));
    const { result } = renderHook(() => useMemberImportRunner(FAST));
    act(() => result.current.start('id', 60, false));
    await waitFor(() => expect(result.current.state.phase).toBe('completed'));
    expect(result.current.state.created).toBe(60);
    expect(batch.mock.calls[0]).toEqual(['id', 0, 25, false]);
    expect(batch.mock.calls[1]![3]).toBeUndefined(); // attestation is sent with the first batch only
  });

  it('grows quick batches and shrinks slow ones within 10–200', async () => {
    const sizes: number[] = [];
    batch.mockImplementation((_id: string, from: number, count: number) => {
      sizes.push(count);
      const slow = sizes.length >= 3;
      return Promise.resolve(ok(from, Math.min(count, 400 - from), 400, slow ? 4000 : 300));
    });
    const { result } = renderHook(() => useMemberImportRunner(FAST));
    act(() => result.current.start('id', 400, false));
    await waitFor(() => expect(result.current.state.phase).toBe('completed'));
    expect(sizes[1]).toBeGreaterThan(sizes[0]!);
    expect(sizes[3]).toBeLessThan(sizes[2]!);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(10);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(200);
  });

  // Drives the runner's clock: each request "takes" wallMs on the wall clock
  // while the server reports serverMs of its own work.
  function runSizes(total: number, serverMs: number, wallMs: number, processedPerCall?: number) {
    let clock = 0;
    const sizes: number[] = [];
    batch.mockImplementation((_id: string, from: number, count: number) => {
      sizes.push(count);
      clock += wallMs;
      const processed = processedPerCall ?? Math.min(count, total - from);
      return Promise.resolve(ok(from, processed, total, serverMs, processedPerCall === 0 ? { status: 'running', next_index: from } : {}));
    });
    return { sizes, hook: renderHook(() => useMemberImportRunner({ ...FAST, now: () => clock })) };
  }

  it('grows when the server is quick, even if each round trip takes 1.8 s of overhead', async () => {
    const { sizes, hook } = runSizes(200, 280, 1800);
    act(() => hook.result.current.start('id', 200, false));
    await waitFor(() => expect(hook.result.current.state.phase).toBe('completed'));
    expect(sizes[1]).toBeGreaterThan(sizes[0]!);
    expect(sizes[2]).toBeGreaterThan(sizes[1]!);
  });

  it('shrinks when the round trip is very slow even though the server was quick', async () => {
    const { sizes, hook } = runSizes(200, 280, 12000);
    act(() => hook.result.current.start('id', 200, false));
    await waitFor(() => expect(hook.result.current.state.phase).toBe('completed'));
    expect(sizes[1]).toBeLessThan(sizes[0]!);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(10);
  });

  it('leaves the size alone when a response processed nothing', async () => {
    const { sizes, hook } = runSizes(100, 5, 5, 0);
    act(() => hook.result.current.start('id', 100, false));
    await waitFor(() => expect(hook.result.current.state.phase).toBe('failed'), { timeout: 5000 });
    expect(new Set(sizes)).toEqual(new Set([25]));
  });

  it('retries the same rows after a failed request', async () => {
    batch
      .mockResolvedValueOnce({ success: false, code: 'NETWORK_ERROR' })
      .mockImplementation(serve(20, 100));
    const { result } = renderHook(() => useMemberImportRunner(FAST));
    act(() => result.current.start('id', 20, false));
    await waitFor(() => expect(result.current.state.phase).toBe('completed'), { timeout: 5000 });
    expect(batch.mock.calls[0]![1]).toBe(0);
    expect(batch.mock.calls[1]![1]).toBe(0);
  });

  it('waits and retries when the import is busy', async () => {
    batch
      .mockResolvedValueOnce({ success: false, code: 'IMPORT_BUSY' })
      .mockImplementation(serve(20, 100));
    const { result } = renderHook(() => useMemberImportRunner(FAST));
    act(() => result.current.start('id', 20, false));
    await waitFor(() => expect(result.current.state.phase).toBe('completed'), { timeout: 5000 });
    expect(batch.mock.calls[1]![1]).toBe(0);
  });

  it('waits out a rate limit without counting it as a failure', async () => {
    batch
      .mockResolvedValueOnce({ success: false, code: 'RATE_LIMIT_EXCEEDED' })
      .mockResolvedValueOnce({ success: false, code: 'RATE_LIMIT_EXCEEDED' })
      .mockResolvedValueOnce({ success: false, code: 'RATE_LIMIT_EXCEEDED' })
      .mockResolvedValueOnce({ success: false, code: 'RATE_LIMIT_EXCEEDED' })
      .mockImplementation(serve(20, 100));
    const { result } = renderHook(() => useMemberImportRunner(FAST));
    act(() => result.current.start('id', 20, false));
    await waitFor(() => expect(result.current.state.phase).toBe('completed'), { timeout: 5000 });
    expect(batch).toHaveBeenCalledTimes(5);
    expect(batch.mock.calls.every((c) => c[1] === 0)).toBe(true);
  });

  it('does not wait out the failures budget again after a rate limit', async () => {
    // two ordinary failures, a rate limit, then success: still within budget
    batch
      .mockResolvedValueOnce({ success: false, code: 'SERVER_ERROR' })
      .mockResolvedValueOnce({ success: false, code: 'SERVER_ERROR' })
      .mockResolvedValueOnce({ success: false, code: 'RATE_LIMIT_EXCEEDED' })
      .mockImplementation(serve(20, 100));
    const { result } = renderHook(() => useMemberImportRunner(FAST));
    act(() => result.current.start('id', 20, false));
    await waitFor(() => expect(result.current.state.phase).toBe('completed'), { timeout: 5000 });
  });

  it('stops at once when the held rows have expired', async () => {
    batch.mockResolvedValue({ success: false, code: 'IMPORT_NOT_FOUND', error: 'gone' });
    const { result } = renderHook(() => useMemberImportRunner(FAST));
    act(() => result.current.start('id', 20, false));
    await waitFor(() => expect(result.current.state.phase).toBe('failed'));
    expect(result.current.state.errorCode).toBe('IMPORT_NOT_FOUND');
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it('stops at once when the server has moved on', async () => {
    batch.mockResolvedValue({ success: false, code: 'IMPORT_OUT_OF_ORDER', error: 'elsewhere' });
    const { result } = renderHook(() => useMemberImportRunner(FAST));
    act(() => result.current.start('id', 20, false));
    await waitFor(() => expect(result.current.state.phase).toBe('failed'));
    expect(result.current.state.errorCode).toBe('IMPORT_OUT_OF_ORDER');
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it('keeps asking from the server position until it reports completed', async () => {
    batch
      .mockResolvedValueOnce(ok(0, 12, 12, 100, { status: 'running' }))
      .mockResolvedValueOnce(ok(12, 0, 12, 100, { status: 'completed', next_index: 12 }));
    const { result } = renderHook(() => useMemberImportRunner(FAST));
    act(() => result.current.start('id', 12, false));
    await waitFor(() => expect(result.current.state.phase).toBe('completed'));
    expect(batch).toHaveBeenCalledTimes(2);
    expect(batch.mock.calls[1]![1]).toBe(12);
  });

  it('carries the held and incomplete-identity details through', async () => {
    batch.mockResolvedValue(ok(0, 12, 12, 100, {
      held: true,
      totals: { created: 12, balance: '5.00', zeroed: 1, admission_incomplete: 2 },
      admission_incomplete_rows: [4, 9],
    }));
    const { result } = renderHook(() => useMemberImportRunner(FAST));
    act(() => result.current.start('id', 12, true));
    await waitFor(() => expect(result.current.state.phase).toBe('completed'));
    expect(result.current.state.held).toBe(true);
    expect(result.current.state.admissionIncomplete).toBe(2);
    expect(result.current.state.admissionIncompleteRows).toEqual([4, 9]);
    expect(result.current.state.balance).toBe('5.00');
  });

  it('stops when the server stops, and reports the row', async () => {
    batch.mockResolvedValue(ok(0, 4, 12, 100, {
      status: 'stopped', stop: { row: 6, code: 'email_now_taken', params: {} },
    }));
    const { result } = renderHook(() => useMemberImportRunner(FAST));
    act(() => result.current.start('id', 12, false));
    await waitFor(() => expect(result.current.state.phase).toBe('stopped'));
    expect(result.current.state.stop?.row).toBe(6);
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it('gives up after three failures in a row without losing its place', async () => {
    batch.mockResolvedValue({ success: false, code: 'SERVER_ERROR', error: 'boom' });
    const { result } = renderHook(() => useMemberImportRunner(FAST));
    act(() => result.current.start('id', 12, false));
    await waitFor(() => expect(result.current.state.phase).toBe('failed'), { timeout: 5000 });
    expect(result.current.state.nextIndex).toBe(0);
    expect(result.current.state.errorCode).toBe('SERVER_ERROR');
    expect(batch).toHaveBeenCalledTimes(3);
  });

  it('never goes backwards if the server reports an earlier position', async () => {
    batch
      .mockResolvedValueOnce(ok(0, 25, 100, 100))
      .mockResolvedValueOnce(ok(0, 5, 100, 100, { next_index: 5, status: 'running' }))
      .mockImplementation(serve(100, 100));
    const { result } = renderHook(() => useMemberImportRunner(FAST));
    act(() => result.current.start('id', 100, false));
    await waitFor(() => expect(result.current.state.phase).toBe('completed'));
    expect(batch.mock.calls[2]![1]).toBe(25);
  });

  it('pauses between responses that make no progress, then gives up', async () => {
    batch.mockResolvedValue(ok(0, 0, 100, 10, { status: 'running', next_index: 0 }));
    const { result } = renderHook(() => useMemberImportRunner(FAST));
    act(() => result.current.start('id', 100, false));
    await waitFor(() => expect(result.current.state.phase).toBe('failed'), { timeout: 5000 });
    expect(result.current.state.errorCode).toBe('NO_PROGRESS');
    expect(batch).toHaveBeenCalledTimes(30);
  });

  it('a response that makes progress resets the no-progress count', async () => {
    let calls = 0;
    batch.mockImplementation((_id: string, from: number, count: number) => {
      calls += 1;
      if (calls <= 29) return Promise.resolve(ok(0, 0, 40, 10, { status: 'running', next_index: 0 }));
      return Promise.resolve(ok(from, Math.min(count, 40 - from), 40, 10));
    });
    const { result } = renderHook(() => useMemberImportRunner(FAST));
    act(() => result.current.start('id', 40, false));
    await waitFor(() => expect(result.current.state.phase).toBe('completed'), { timeout: 5000 });
  });

  it('gives up when the import stays busy for too long', async () => {
    batch.mockResolvedValue({ success: false, code: 'IMPORT_BUSY' });
    const { result } = renderHook(() => useMemberImportRunner({ timings: { ...FAST.timings, maxWaitMs: 50 } }));
    act(() => result.current.start('id', 20, false));
    await waitFor(() => expect(result.current.state.phase).toBe('failed'), { timeout: 5000 });
    expect(result.current.state.errorCode).toBe('IMPORT_BUSY');
  });

  it('gives up when rate limited for too long', async () => {
    batch.mockResolvedValue({ success: false, code: 'RATE_LIMIT_EXCEEDED' });
    const { result } = renderHook(() => useMemberImportRunner({ timings: { ...FAST.timings, maxWaitMs: 50 } }));
    act(() => result.current.start('id', 20, false));
    await waitFor(() => expect(result.current.state.phase).toBe('failed'), { timeout: 5000 });
    expect(result.current.state.errorCode).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('turns an unexpected throw into a failed run and can be started again', async () => {
    batch.mockImplementationOnce(() => { throw new Error('kaboom'); });
    const { result } = renderHook(() => useMemberImportRunner(FAST));
    act(() => result.current.start('id', 20, false));
    await waitFor(() => expect(result.current.state.phase).toBe('failed'));
    expect(result.current.state.errorCode).toBe('UNEXPECTED');
    batch.mockImplementation(serve(20, 100));
    act(() => result.current.start('id', 20, false));
    await waitFor(() => expect(result.current.state.phase).toBe('completed'));
  });

  /** The server's answer to the admin's stop call. */
  function stoppedByAdmin(from: number, total: number): ApiResponse<BatchResult> {
    return ok(from, 0, total, 5, { status: 'stopped', stop: { row: from + 2, code: 'stopped_by_admin', params: {} } });
  }

  /** Starts a run whose first batch only returns when the test says so. */
  function startHeldBatch(total: number) {
    let release: () => void = () => {};
    batch.mockImplementationOnce((_id: string, from: number, count: number) => new Promise<ApiResponse<BatchResult>>((r) => {
      release = () => r(ok(from, count, total, 100));
    }));
    const hook = renderHook(() => useMemberImportRunner(FAST));
    act(() => hook.result.current.start('id', total, false));
    return { ...hook, release: () => release() };
  }

  it('stop() finishes the current batch, tells the server once, then halts', async () => {
    batch.mockImplementation((_id: string, from: number) => Promise.resolve(stoppedByAdmin(from, 100)));
    const { result, release } = startHeldBatch(100);
    act(() => result.current.stop());
    expect(result.current.state.phase).toBe('stopping');
    await act(async () => { release(); });
    await waitFor(() => expect(result.current.state.phase).toBe('stopped'));
    // One final call from the next position, flagged as a stop, so the server
    // discards the held rows now instead of keeping them for two hours.
    expect(batch).toHaveBeenCalledTimes(2);
    expect(batch.mock.calls[1]).toEqual(['id', 25, 10, undefined, true]);
    expect(result.current.state.nextIndex).toBe(25);
    expect(result.current.state.created).toBe(25);
  });

  it('stays "stopping" until the stop call has been answered', async () => {
    let answer: () => void = () => {};
    batch.mockImplementation((_id: string, from: number) => new Promise<ApiResponse<BatchResult>>((r) => {
      answer = () => r(stoppedByAdmin(from, 100));
    }));
    const { result, release } = startHeldBatch(100);
    act(() => result.current.stop());
    await act(async () => { release(); });
    await waitFor(() => expect(batch).toHaveBeenCalledTimes(2));
    expect(result.current.state.phase).toBe('stopping');
    await act(async () => { answer(); });
    await waitFor(() => expect(result.current.state.phase).toBe('stopped'));
  });

  it('settles as stopped even when the stop call fails (best effort)', async () => {
    batch.mockResolvedValue({ success: false, code: 'NETWORK_ERROR' });
    const { result, release } = startHeldBatch(100);
    act(() => result.current.stop());
    await act(async () => { release(); });
    await waitFor(() => expect(result.current.state.phase).toBe('stopped'));
    expect(batch).toHaveBeenCalledTimes(2); // never retried
    expect(result.current.state.nextIndex).toBe(25);
    expect(result.current.state.errorCode).toBeNull();
  });

  it('settles as stopped when the stop call throws', async () => {
    batch.mockRejectedValue(new Error('offline'));
    const { result, release } = startHeldBatch(100);
    act(() => result.current.stop());
    await act(async () => { release(); });
    await waitFor(() => expect(result.current.state.phase).toBe('stopped'));
    expect(result.current.state.errorCode).toBeNull();
  });

  it('a stop pressed between batches still sends the stop call', async () => {
    let calls = 0;
    batch.mockImplementation((_id: string, from: number, count: number, _att?: boolean, stop?: boolean) => {
      calls += 1;
      if (stop) return Promise.resolve(stoppedByAdmin(from, 100));
      // First request fails, so the loop waits before retrying: stop lands in that wait.
      if (calls === 1) return Promise.resolve({ success: false, code: 'NETWORK_ERROR' } as ApiResponse<BatchResult>);
      return Promise.resolve(ok(from, count, 100, 100));
    });
    const { result } = renderHook(() => useMemberImportRunner({ timings: { ...FAST.timings, retryBaseMs: 50 } }));
    act(() => result.current.start('id', 100, false));
    await waitFor(() => expect(batch).toHaveBeenCalledTimes(1));
    act(() => result.current.stop());
    await waitFor(() => expect(result.current.state.phase).toBe('stopped'));
    expect(batch.mock.calls[batch.mock.calls.length - 1]).toEqual(['id', 0, 10, undefined, true]);
  });

  it('shows the import as completed if every member was already written when the stop arrived', async () => {
    batch.mockImplementation((_id: string, from: number) => Promise.resolve(ok(from, 0, 25, 5, { status: 'completed' })));
    let release: () => void = () => {};
    batch.mockImplementationOnce((_id: string, from: number, count: number) => new Promise<ApiResponse<BatchResult>>((r) => {
      // All 25 rows written, but the server has not yet marked the import complete.
      release = () => r(ok(from, count, 25, 100, { status: 'running' }));
    }));
    const { result } = renderHook(() => useMemberImportRunner(FAST));
    act(() => result.current.start('id', 25, false));
    act(() => result.current.stop());
    await act(async () => { release(); });
    await waitFor(() => expect(result.current.state.phase).toBe('completed'));
    expect(batch.mock.calls[1]).toEqual(['id', 25, 10, undefined, true]);
  });

  it('does not send a stop call when the server itself stopped or completed the import', async () => {
    batch.mockImplementation(serve(20, 100));
    const { result } = renderHook(() => useMemberImportRunner(FAST));
    act(() => result.current.start('id', 20, false));
    await waitFor(() => expect(result.current.state.phase).toBe('completed'));
    act(() => result.current.stop());
    expect(batch.mock.calls.every((c) => c.length === 4)).toBe(true);
  });
});
