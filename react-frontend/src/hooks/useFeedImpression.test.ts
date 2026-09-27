// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRef } from 'react';
import { useFeedImpression, resetFeedImpressions } from './useFeedImpression';

// ---------------------------------------------------------------------------
// Mock @/lib/api so no real HTTP requests are made
// ---------------------------------------------------------------------------

vi.mock('@/lib/api', () => ({
  api: {
    post: vi.fn().mockResolvedValue(undefined),
  },
}));

import { api } from '@/lib/api';
const mockApi = api as unknown as { post: ReturnType<typeof vi.fn> };

// ---------------------------------------------------------------------------
// IntersectionObserver mock
//
// The global setup.ts provides a no-op mock. We override it with a
// callback-capturing version so we can simulate visibility changes.
// ---------------------------------------------------------------------------

type IOCallback = (entries: IntersectionObserverEntry[]) => void;

interface MockIOInstance {
  callback: IOCallback;
  options: IntersectionObserverInit | undefined;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

let latestInstance: MockIOInstance | null = null;

function createMockIO() {
  return vi.fn(function mockIntersectionObserver(callback: IOCallback, options?: IntersectionObserverInit) {
    const instance: MockIOInstance = {
      callback,
      options,
      observe: vi.fn(),
      disconnect: vi.fn(),
    };
    latestInstance = instance;
    return instance;
  });
}

/** Fire a fake intersection entry on the most-recently created IO instance. */
function triggerIntersection(isIntersecting: boolean) {
  if (!latestInstance) throw new Error('No MockIO instance exists yet');
  const fakeEntry = { isIntersecting } as IntersectionObserverEntry;
  latestInstance.callback([fakeEntry]);
}

// ---------------------------------------------------------------------------
// Unique post-id counter
// Each test uses a distinct ID to avoid contamination from the module-level
// `reportedIds` Set (deduplication is by design global to the module).
// ---------------------------------------------------------------------------

let nextId = 50000;
function uid() { return ++nextId; }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useFeedImpression', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    latestInstance = null;
    resetFeedImpressions();
    vi.stubGlobal('IntersectionObserver', createMockIO());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // -------------------------------------------------------------------------
  // Observer options
  // -------------------------------------------------------------------------

  it('creates an IntersectionObserver with threshold 0.5', () => {
    const postId = uid();
    renderHook(() => {
      const ref = useRef<HTMLDivElement>(document.createElement('div'));
      useFeedImpression(postId, ref);
    });

    expect(IntersectionObserver).toHaveBeenCalledTimes(1);
    expect(latestInstance!.options).toMatchObject({ threshold: 0.5 });
  });

  it('calls observe() on the element', () => {
    const postId = uid();
    const el = document.createElement('div');

    renderHook(() => {
      const ref = useRef<HTMLDivElement>(el);
      useFeedImpression(postId, ref);
    });

    expect(latestInstance!.observe).toHaveBeenCalledWith(el);
  });

  // -------------------------------------------------------------------------
  // Impression firing
  // -------------------------------------------------------------------------

  it('fires an impression after ≥1 second of sustained visibility', async () => {
    const postId = uid();

    renderHook(() => {
      const ref = useRef<HTMLDivElement>(document.createElement('div'));
      useFeedImpression(postId, ref);
    });

    act(() => { triggerIntersection(true); });
    // Timer hasn't elapsed yet — no impression
    expect(mockApi.post).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(1000); });
    await Promise.resolve(); // flush microtask queue

    expect(mockApi.post).toHaveBeenCalledTimes(1);
    expect(mockApi.post).toHaveBeenCalledWith(`/v2/feed/posts/${postId}/impression`);
  });

  it('does NOT fire if the element leaves the viewport before 1 second', () => {
    const postId = uid();

    renderHook(() => {
      const ref = useRef<HTMLDivElement>(document.createElement('div'));
      useFeedImpression(postId, ref);
    });

    act(() => {
      triggerIntersection(true);
      vi.advanceTimersByTime(500);
      triggerIntersection(false);
      vi.advanceTimersByTime(1000);
    });

    expect(mockApi.post).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Deduplication (module-level reportedIds Set)
  // -------------------------------------------------------------------------

  it('fires the impression at most once per post per session', async () => {
    const postId = uid();

    // First hook instance — fires impression
    const { unmount: unmount1 } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(document.createElement('div'));
      useFeedImpression(postId, ref);
    });

    act(() => { triggerIntersection(true); });
    act(() => { vi.advanceTimersByTime(1000); });
    await Promise.resolve();
    expect(mockApi.post).toHaveBeenCalledTimes(1);
    unmount1();

    // Second hook instance for the SAME postId — should be deduped
    mockApi.post.mockClear();
    latestInstance = null;
    vi.stubGlobal('IntersectionObserver', createMockIO());

    renderHook(() => {
      const ref = useRef<HTMLDivElement>(document.createElement('div'));
      useFeedImpression(postId, ref);
    });

    // useFeedImpression returns early when postId is already in reportedIds
    expect(IntersectionObserver).not.toHaveBeenCalled();
    expect(mockApi.post).not.toHaveBeenCalled();
  });

  it('fires again after resetFeedImpressions()', async () => {
    const postId = uid();

    const { unmount } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(document.createElement('div'));
      useFeedImpression(postId, ref);
    });

    act(() => { triggerIntersection(true); });
    act(() => { vi.advanceTimersByTime(1000); });
    await Promise.resolve();
    expect(mockApi.post).toHaveBeenCalledTimes(1);
    unmount();

    // Reset the dedup set — a new hook instance should create a fresh observer
    resetFeedImpressions();
    mockApi.post.mockClear();
    latestInstance = null;
    vi.stubGlobal('IntersectionObserver', createMockIO());

    renderHook(() => {
      const ref = useRef<HTMLDivElement>(document.createElement('div'));
      useFeedImpression(postId, ref);
    });

    act(() => { triggerIntersection(true); });
    act(() => { vi.advanceTimersByTime(1000); });
    await Promise.resolve();

    expect(mockApi.post).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Cleanup on unmount
  // -------------------------------------------------------------------------

  it('disconnects the observer on unmount', () => {
    const postId = uid();

    const { unmount } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(document.createElement('div'));
      useFeedImpression(postId, ref);
    });

    const instance = latestInstance!;
    unmount();

    expect(instance.disconnect).toHaveBeenCalled();
  });

  it('clears a pending timer when the component unmounts mid-countdown', () => {
    const postId = uid();

    const { unmount } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(document.createElement('div'));
      useFeedImpression(postId, ref);
    });

    act(() => { triggerIntersection(true); });
    act(() => { vi.advanceTimersByTime(500); });

    // Unmount before the 1-second timer fires
    unmount();

    // Advance past the would-be fire time — should not trigger
    act(() => { vi.advanceTimersByTime(600); });

    expect(mockApi.post).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Guard: null ref
  // -------------------------------------------------------------------------

  it('does nothing when the ref element is null', () => {
    const postId = uid();

    renderHook(() => {
      // useRef with null initial value; current stays null
      const ref = useRef<HTMLElement | null>(null);
      useFeedImpression(postId, ref);
    });

    expect(IntersectionObserver).not.toHaveBeenCalled();
    expect(mockApi.post).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Disconnects observer after impression fires (fire-once cleanup)
  // -------------------------------------------------------------------------

  it('disconnects the observer once the impression is reported', async () => {
    const postId = uid();

    renderHook(() => {
      const ref = useRef<HTMLDivElement>(document.createElement('div'));
      useFeedImpression(postId, ref);
    });

    act(() => { triggerIntersection(true); });
    act(() => { vi.advanceTimersByTime(1000); });
    await Promise.resolve();

    expect(latestInstance!.disconnect).toHaveBeenCalled();
  });
});
