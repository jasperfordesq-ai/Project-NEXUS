// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useInfiniteScroll } from './useInfiniteScroll';

// ---------------------------------------------------------------------------
// IntersectionObserver mock
//
// The global setup.ts defines a no-op MockIntersectionObserver. We need one
// that captures the callback so we can fire fake intersection entries in tests.
// We override it with vi.stubGlobal and restore in afterEach.
// ---------------------------------------------------------------------------

type IOCallback = (entries: IntersectionObserverEntry[]) => void;

interface MockIOInstance {
  callback: IOCallback;
  options: IntersectionObserverInit | undefined;
  observe: ReturnType<typeof vi.fn>;
  unobserve: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

let latestInstance: MockIOInstance | null = null;
let allInstances: MockIOInstance[] = [];

function createMockIO() {
  return vi.fn(function mockIntersectionObserver(callback: IOCallback, options?: IntersectionObserverInit) {
    const instance: MockIOInstance = {
      callback,
      options,
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    };
    latestInstance = instance;
    allInstances.push(instance);
    return instance;
  });
}

/** Fire a fake intersection entry on the most-recently created IO instance. */
function triggerIntersection(isIntersecting: boolean, instance = latestInstance) {
  if (!instance) throw new Error('No MockIO instance exists yet');
  const fakeEntry = { isIntersecting } as IntersectionObserverEntry;
  instance.callback([fakeEntry]);
}

describe('useInfiniteScroll', () => {
  beforeEach(() => {
    latestInstance = null;
    allInstances = [];
    vi.stubGlobal('IntersectionObserver', createMockIO());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // -------------------------------------------------------------------------
  // Sentinel ref / observer lifecycle
  // -------------------------------------------------------------------------

  it('returns a function (callback ref)', () => {
    const onLoadMore = vi.fn();
    const { result } = renderHook(() =>
      useInfiniteScroll({ hasMore: true, isLoading: false, onLoadMore }),
    );
    expect(typeof result.current).toBe('function');
  });

  it('creates an IntersectionObserver when sentinel mounts', () => {
    const onLoadMore = vi.fn();
    const { result } = renderHook(() =>
      useInfiniteScroll({ hasMore: true, isLoading: false, onLoadMore }),
    );

    const sentinel = document.createElement('div');
    act(() => { result.current(sentinel); });

    expect(IntersectionObserver).toHaveBeenCalledTimes(1);
    expect(latestInstance!.observe).toHaveBeenCalledWith(sentinel);
  });

  it('uses the default rootMargin and threshold when not specified', () => {
    const onLoadMore = vi.fn();
    const { result } = renderHook(() =>
      useInfiniteScroll({ hasMore: true, isLoading: false, onLoadMore }),
    );

    act(() => { result.current(document.createElement('div')); });

    expect(latestInstance!.options).toMatchObject({
      rootMargin: '400px',
      threshold: 0.1,
    });
  });

  it('passes custom rootMargin and threshold to the observer', () => {
    const onLoadMore = vi.fn();
    const { result } = renderHook(() =>
      useInfiniteScroll({
        hasMore: true,
        isLoading: false,
        onLoadMore,
        rootMargin: '200px',
        threshold: 0.5,
      }),
    );

    act(() => { result.current(document.createElement('div')); });

    expect(latestInstance!.options).toMatchObject({
      rootMargin: '200px',
      threshold: 0.5,
    });
  });

  // -------------------------------------------------------------------------
  // Intersection callback behaviour
  // -------------------------------------------------------------------------

  it('calls onLoadMore when sentinel intersects (hasMore=true, isLoading=false)', () => {
    const onLoadMore = vi.fn();
    const { result } = renderHook(() =>
      useInfiniteScroll({ hasMore: true, isLoading: false, onLoadMore }),
    );

    act(() => { result.current(document.createElement('div')); });
    act(() => { triggerIntersection(true); });

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onLoadMore when isIntersecting is false', () => {
    const onLoadMore = vi.fn();
    const { result } = renderHook(() =>
      useInfiniteScroll({ hasMore: true, isLoading: false, onLoadMore }),
    );

    act(() => { result.current(document.createElement('div')); });
    act(() => { triggerIntersection(false); });

    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('does NOT call onLoadMore when hasMore=false', () => {
    const onLoadMore = vi.fn();
    const { result } = renderHook(() =>
      useInfiniteScroll({ hasMore: false, isLoading: false, onLoadMore }),
    );

    act(() => { result.current(document.createElement('div')); });
    act(() => { triggerIntersection(true); });

    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('does NOT call onLoadMore when isLoading=true', () => {
    const onLoadMore = vi.fn();
    const { result } = renderHook(() =>
      useInfiniteScroll({ hasMore: true, isLoading: true, onLoadMore }),
    );

    act(() => { result.current(document.createElement('div')); });
    act(() => { triggerIntersection(true); });

    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('respects the latest hasMore / isLoading values (stale-closure guard)', () => {
    const onLoadMore = vi.fn();
    // Start with isLoading=true so the first intersection is blocked
    const { result, rerender } = renderHook(
      ({ loading }: { loading: boolean }) =>
        useInfiniteScroll({ hasMore: true, isLoading: loading, onLoadMore }),
      { initialProps: { loading: true } },
    );

    act(() => { result.current(document.createElement('div')); });
    act(() => { triggerIntersection(true); });
    expect(onLoadMore).not.toHaveBeenCalled();

    // Flip isLoading to false — hook updates its internal ref
    rerender({ loading: false });
    act(() => { triggerIntersection(true); });
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Cleanup / disconnect
  // -------------------------------------------------------------------------

  it('disconnects the observer when sentinel is set to null (unmount)', () => {
    const onLoadMore = vi.fn();
    const { result } = renderHook(() =>
      useInfiniteScroll({ hasMore: true, isLoading: false, onLoadMore }),
    );

    act(() => { result.current(document.createElement('div')); });
    const instanceAfterMount = latestInstance!;

    // Setting the sentinel to null simulates the element unmounting
    act(() => { result.current(null); });

    expect(instanceAfterMount.disconnect).toHaveBeenCalled();
  });

  it('disconnects the previous observer and creates a new one when rootMargin changes', () => {
    const onLoadMore = vi.fn();
    const { result, rerender } = renderHook(
      ({ margin }: { margin: string }) =>
        useInfiniteScroll({ hasMore: true, isLoading: false, onLoadMore, rootMargin: margin }),
      { initialProps: { margin: '400px' } },
    );

    const sentinel = document.createElement('div');
    act(() => { result.current(sentinel); });
    const firstInstance = latestInstance!;

    // Changing rootMargin causes a new useCallback reference which disconnects
    // and re-observes the current sentinel
    act(() => {
      rerender({ margin: '200px' });
      // Re-apply the new sentinelRef to the same node (simulating React re-run)
      result.current(null);
      result.current(sentinel);
    });

    expect(firstInstance.disconnect).toHaveBeenCalled();
    expect(allInstances).toHaveLength(2);
    expect(allInstances[1].observe).toHaveBeenCalledWith(sentinel);
  });

  // -------------------------------------------------------------------------
  // No observer created when node is null from the start
  // -------------------------------------------------------------------------

  it('does not create an observer when the sentinel ref is called with null initially', () => {
    const onLoadMore = vi.fn();
    const { result } = renderHook(() =>
      useInfiniteScroll({ hasMore: true, isLoading: false, onLoadMore }),
    );

    act(() => { result.current(null); });

    expect(IntersectionObserver).not.toHaveBeenCalled();
    expect(onLoadMore).not.toHaveBeenCalled();
  });
});
