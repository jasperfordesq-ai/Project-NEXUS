// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFeedTracking } from './useFeedTracking';

vi.mock('@/lib/api', () => ({
  api: {
    post: vi.fn(),
  },
}));

vi.mock('@/contexts/CookieConsentContext', () => ({
  readStoredConsent: () => ({ necessary: true, analytics: true, marketing: false, preferences: true }),
}));

import { api } from '@/lib/api';
const mockApi = api as unknown as { post: ReturnType<typeof vi.fn> };

// Each test uses a unique postId to avoid cross-test contamination of the
// process-wide impressedIds dedup set.
let postIdCounter = 10000;
function uniquePostId() {
  return ++postIdCounter;
}

describe('useFeedTracking', () => {
  let observerCallbacks: Map<Element, IntersectionObserverCallback>;
  let mockObserverInstances: { observe: ReturnType<typeof vi.fn>; unobserve: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockApi.post.mockResolvedValue({ success: true });
    observerCallbacks = new Map();
    mockObserverInstances = [];

    vi.stubGlobal('IntersectionObserver', vi.fn(function mockIntersectionObserver(callback: IntersectionObserverCallback) {
      const instance = {
        observe: vi.fn((el: Element) => {
          observerCallbacks.set(el, callback);
        }),
        unobserve: vi.fn((el: Element) => {
          observerCallbacks.delete(el);
        }),
        disconnect: vi.fn(),
      };
      mockObserverInstances.push(instance);
      return instance;
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function triggerIntersection(el: Element, isIntersecting: boolean) {
    const cb = observerCallbacks.get(el);
    if (cb) {
      cb([{ target: el, isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver);
    }
  }

  it('returns a ref callback and recordClick function', () => {
    const postId = uniquePostId();
    const { result } = renderHook(() => useFeedTracking(postId, 'post', true));
    expect(typeof result.current.ref).toBe('function');
    expect(typeof result.current.recordClick).toBe('function');
  });

  it('records impression after 1 second of visibility', async () => {
    const postId = uniquePostId();
    const { result } = renderHook(() => useFeedTracking(postId, 'listing', true));

    const div = document.createElement('div');
    act(() => { result.current.ref(div); });

    triggerIntersection(div, true);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    await Promise.resolve();
    expect(mockApi.post).toHaveBeenCalledWith('/v2/feed/impression', {
      target_type: 'listing',
      target_id: postId,
    });
  });

  it('cancels impression timer if element leaves viewport', () => {
    const postId = uniquePostId();
    const { result } = renderHook(() => useFeedTracking(postId, 'post', true));

    const div = document.createElement('div');
    act(() => { result.current.ref(div); });

    triggerIntersection(div, true);
    act(() => {
      vi.advanceTimersByTime(500);
      triggerIntersection(div, false);
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(mockApi.post).not.toHaveBeenCalled();
  });

  it('recordClick fires POST to click endpoint', () => {
    const postId = uniquePostId();
    const { result } = renderHook(() => useFeedTracking(postId, 'event', true));
    act(() => {
      result.current.recordClick();
    });
    expect(mockApi.post).toHaveBeenCalledWith('/v2/feed/click', {
      target_type: 'event',
      target_id: postId,
    });
  });

  it('recordClick does nothing when unauthenticated', () => {
    const postId = uniquePostId();
    const { result } = renderHook(() => useFeedTracking(postId, 'post', false));
    act(() => {
      result.current.recordClick();
    });
    expect(mockApi.post).not.toHaveBeenCalled();
  });

  it('recordClick does nothing when postId is falsy', () => {
    const { result } = renderHook(() => useFeedTracking(0, 'post', true));
    act(() => {
      result.current.recordClick();
    });
    expect(mockApi.post).not.toHaveBeenCalled();
  });

  it('unobserves the element on unmount', () => {
    const postId = uniquePostId();
    const { result, unmount } = renderHook(() => useFeedTracking(postId, 'post', true));
    const div = document.createElement('div');
    act(() => { result.current.ref(div); });
    expect(observerCallbacks.has(div)).toBe(true);
    unmount();
    expect(observerCallbacks.has(div)).toBe(false);
  });
});
