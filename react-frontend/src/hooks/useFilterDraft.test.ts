// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFilterDraft } from './useFilterDraft';

interface TestDraft {
  type: string;
  category: string;
  sort: string;
}

const CURRENT: TestDraft = { type: 'offer', category: 'diy', sort: 'newest' };
// `sort` is deliberately absent — clear() must not reset it.
const EMPTY: Partial<TestDraft> = { type: 'all', category: '' };

describe('useFilterDraft', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts closed with no draft and an unknown count', () => {
    const { result } = renderHook(() => useFilterDraft<TestDraft>({ onApply: vi.fn(), emptyDraft: EMPTY }));

    expect(result.current.isOpen).toBe(false);
    expect(result.current.draft).toBeNull();
    expect(result.current.count).toBeNull();
  });

  it('open() snapshots the live filters and seeds the count', () => {
    const { result } = renderHook(() => useFilterDraft<TestDraft>({ onApply: vi.fn(), emptyDraft: EMPTY }));

    act(() => result.current.open(CURRENT, 42));

    expect(result.current.isOpen).toBe(true);
    expect(result.current.draft).toEqual(CURRENT);
    expect(result.current.count).toBe(42);
  });

  it('patch() updates only the draft and never calls onApply', () => {
    const onApply = vi.fn();
    const { result } = renderHook(() => useFilterDraft<TestDraft>({ onApply, emptyDraft: EMPTY }));

    act(() => result.current.open(CURRENT));
    act(() => result.current.patch({ type: 'request' }));

    expect(result.current.draft).toEqual({ ...CURRENT, type: 'request' });
    expect(onApply).not.toHaveBeenCalled();
  });

  it('patch() is a no-op before the sheet has ever been opened', () => {
    const { result } = renderHook(() => useFilterDraft<TestDraft>({ onApply: vi.fn(), emptyDraft: EMPTY }));

    act(() => result.current.patch({ type: 'request' }));

    expect(result.current.draft).toBeNull();
  });

  it('clear() merges emptyDraft and leaves untouched keys alone', () => {
    const { result } = renderHook(() => useFilterDraft<TestDraft>({ onApply: vi.fn(), emptyDraft: EMPTY }));

    act(() => result.current.open(CURRENT));
    act(() => result.current.clear());

    expect(result.current.draft).toEqual({ type: 'all', category: '', sort: 'newest' });
    expect(result.current.isOpen).toBe(true);
  });

  it('apply() hands the committed draft back and closes', () => {
    const onApply = vi.fn();
    const { result } = renderHook(() => useFilterDraft<TestDraft>({ onApply, emptyDraft: EMPTY }));

    act(() => result.current.open(CURRENT));
    act(() => result.current.patch({ category: 'garden' }));
    act(() => result.current.apply());

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith({ ...CURRENT, category: 'garden' });
    expect(result.current.isOpen).toBe(false);
  });

  it('apply() sees a patch made in the SAME event handler', () => {
    const onApply = vi.fn();
    const { result } = renderHook(() => useFilterDraft<TestDraft>({ onApply, emptyDraft: EMPTY }));

    act(() => result.current.open(CURRENT));
    // One tap that patches then applies — e.g. a "sort and show" row.
    act(() => {
      result.current.patch({ sort: 'oldest' });
      result.current.apply();
    });

    expect(onApply).toHaveBeenCalledWith({ ...CURRENT, sort: 'oldest' });
  });

  it('apply() sees a clear() made in the SAME event handler', () => {
    const onApply = vi.fn();
    const { result } = renderHook(() => useFilterDraft<TestDraft>({ onApply, emptyDraft: EMPTY }));

    act(() => result.current.open(CURRENT));
    // A "reset and show" button must not commit the un-cleared draft.
    act(() => {
      result.current.clear();
      result.current.apply();
    });

    expect(onApply).toHaveBeenCalledWith({ type: 'all', category: '', sort: 'newest' });
  });

  it('accumulates several patches made in one handler', () => {
    const onApply = vi.fn();
    const { result } = renderHook(() => useFilterDraft<TestDraft>({ onApply, emptyDraft: EMPTY }));

    act(() => result.current.open(CURRENT));
    act(() => {
      result.current.patch({ type: 'request' });
      result.current.patch({ category: 'garden' });
    });

    expect(result.current.draft).toEqual({ type: 'request', category: 'garden', sort: 'newest' });
  });

  it('close() leaves the draft intact without applying', () => {
    const onApply = vi.fn();
    const { result } = renderHook(() => useFilterDraft<TestDraft>({ onApply, emptyDraft: EMPTY }));

    act(() => result.current.open(CURRENT));
    act(() => result.current.close());

    expect(onApply).not.toHaveBeenCalled();
    expect(result.current.isOpen).toBe(false);
    expect(result.current.draft).toEqual(CURRENT);
  });

  it('never fetches when no countFor probe is supplied', async () => {
    const { result } = renderHook(() => useFilterDraft<TestDraft>({ onApply: vi.fn(), emptyDraft: EMPTY }));

    act(() => result.current.open(CURRENT));
    act(() => result.current.patch({ type: 'request' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });

    // Pages whose API meta has no total leave the count unknown → "Show results".
    expect(result.current.count).toBeNull();
  });

  it('debounces the probe and publishes its count', async () => {
    const countFor = vi.fn(async () => 7);
    const { result } = renderHook(() => useFilterDraft<TestDraft>({ onApply: vi.fn(), emptyDraft: EMPTY, countFor }));

    act(() => result.current.open(CURRENT));
    expect(countFor).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(249); });
    expect(countFor).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(countFor).toHaveBeenCalledTimes(1);
    expect(countFor.mock.calls[0][0]).toEqual(CURRENT);
    expect(result.current.count).toBe(7);
  });

  it('coalesces rapid draft changes into a single probe', async () => {
    const countFor = vi.fn(async () => 3);
    const { result } = renderHook(() => useFilterDraft<TestDraft>({ onApply: vi.fn(), emptyDraft: EMPTY, countFor }));

    act(() => result.current.open(CURRENT));
    act(() => result.current.patch({ type: 'request' }));
    act(() => result.current.patch({ category: 'garden' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });

    expect(countFor).toHaveBeenCalledTimes(1);
  });

  it('aborts the previous probe when the draft changes again', async () => {
    const signals: AbortSignal[] = [];
    const countFor = vi.fn(async (_draft: TestDraft, signal: AbortSignal) => {
      signals.push(signal);
      return 5;
    });
    const { result } = renderHook(() => useFilterDraft<TestDraft>({ onApply: vi.fn(), emptyDraft: EMPTY, countFor }));

    act(() => result.current.open(CURRENT));
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(signals[0].aborted).toBe(false);

    act(() => result.current.patch({ type: 'request' }));
    expect(signals[0].aborted).toBe(true);
  });

  it('ignores a probe result that resolves after its abort', async () => {
    let release: ((value: number | null) => void) | undefined;
    const countFor = vi.fn(() => new Promise<number | null>((resolve) => { release = resolve; }));
    const { result } = renderHook(() => useFilterDraft<TestDraft>({ onApply: vi.fn(), emptyDraft: EMPTY, countFor }));

    act(() => result.current.open(CURRENT, 1));
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    act(() => result.current.close());

    await act(async () => { release?.(999); await Promise.resolve(); });
    expect(result.current.count).toBe(1);
  });

  it('does not probe while the sheet is closed', async () => {
    const countFor = vi.fn(async () => 9);
    const { result } = renderHook(() => useFilterDraft<TestDraft>({ onApply: vi.fn(), emptyDraft: EMPTY, countFor }));

    act(() => result.current.open(CURRENT));
    act(() => result.current.close());
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });

    expect(countFor).not.toHaveBeenCalled();
  });

  it('re-probes when countKey changes', async () => {
    const countFor = vi.fn(async () => 4);
    const { result, rerender } = renderHook(
      ({ countKey }: { countKey: string }) => useFilterDraft<TestDraft>({ onApply: vi.fn(), emptyDraft: EMPTY, countFor, countKey }),
      { initialProps: { countKey: 'bikes' } },
    );

    act(() => result.current.open(CURRENT));
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(countFor).toHaveBeenCalledTimes(1);

    rerender({ countKey: 'ladders' });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(countFor).toHaveBeenCalledTimes(2);
  });

  it('falls back to an unknown count when the probe rejects', async () => {
    const countFor = vi.fn(async () => { throw new Error('network'); });
    const { result } = renderHook(() => useFilterDraft<TestDraft>({ onApply: vi.fn(), emptyDraft: EMPTY, countFor }));

    act(() => result.current.open(CURRENT, 12));
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });

    expect(result.current.count).toBeNull();
  });

  it('honours a custom debounce', async () => {
    const countFor = vi.fn(async () => 1);
    const { result } = renderHook(() => useFilterDraft<TestDraft>({ onApply: vi.fn(), emptyDraft: EMPTY, countFor, debounceMs: 800 }));

    act(() => result.current.open(CURRENT));
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(countFor).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(550); });
    expect(countFor).toHaveBeenCalledTimes(1);
  });
});
