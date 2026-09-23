// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDraftPersistence } from './useDraftPersistence';

describe('useDraftPersistence', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('returns initialValue when no draft stored', () => {
    const { result } = renderHook(() => useDraftPersistence('test-key', ''));
    expect(result.current[0]).toBe('');
  });

  it('returns stored value from localStorage on mount', () => {
    localStorage.setItem('test-key', JSON.stringify('saved draft'));
    const { result } = renderHook(() => useDraftPersistence('test-key', ''));
    expect(result.current[0]).toBe('saved draft');
  });

  it('falls back to initialValue when stored JSON is corrupt', () => {
    localStorage.setItem('test-key', 'INVALID_JSON{{{');
    const { result } = renderHook(() => useDraftPersistence('test-key', 'default'));
    expect(result.current[0]).toBe('default');
    // Also removes the corrupt item
    expect(localStorage.getItem('test-key')).toBeNull();
  });

  it('setValue updates state immediately', () => {
    const { result } = renderHook(() => useDraftPersistence('test-key', ''));
    act(() => {
      result.current[1]('new value');
    });
    expect(result.current[0]).toBe('new value');
  });

  it('setValue accepts updater function', () => {
    const { result } = renderHook(() => useDraftPersistence('test-key', 'hello'));
    act(() => {
      result.current[1]((prev) => prev + ' world');
    });
    expect(result.current[0]).toBe('hello world');
  });

  it('persists to localStorage after 2-second debounce', () => {
    const { result } = renderHook(() => useDraftPersistence('test-key', ''));
    act(() => {
      result.current[1]('debounced value');
    });
    expect(localStorage.getItem('test-key')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(localStorage.getItem('test-key')).toBe(JSON.stringify('debounced value'));
  });

  it('removes key from localStorage when value equals initialValue', () => {
    localStorage.setItem('test-key', JSON.stringify('old'));
    const { result } = renderHook(() => useDraftPersistence('test-key', ''));
    act(() => {
      result.current[1]('');
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(localStorage.getItem('test-key')).toBeNull();
  });

  it('clearDraft resets to initialValue and removes from localStorage', () => {
    localStorage.setItem('test-key', JSON.stringify('existing'));
    const { result } = renderHook(() => useDraftPersistence('test-key', 'initial'));
    expect(result.current[0]).toBe('existing');

    act(() => {
      result.current[2](); // clearDraft
    });
    expect(result.current[0]).toBe('initial');
    expect(localStorage.getItem('test-key')).toBeNull();
  });

  it('clearDraft cancels pending debounce', () => {
    const { result } = renderHook(() => useDraftPersistence('test-key', ''));
    act(() => {
      result.current[1]('unsaved value');
    });
    act(() => {
      result.current[2](); // clearDraft before debounce fires
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    // Nothing should have been saved
    expect(localStorage.getItem('test-key')).toBeNull();
  });

  it('works with object type', () => {
    const initial = { title: '', content: '' };
    const { result } = renderHook(() => useDraftPersistence('obj-key', initial));
    act(() => {
      result.current[1]((prev) => ({ ...prev, title: 'My Post' }));
    });
    expect(result.current[0]).toEqual({ title: 'My Post', content: '' });
  });

  it('does not persist values larger than 100KB', () => {
    const { result } = renderHook(() => useDraftPersistence('test-key', ''));
    const largeString = 'x'.repeat(101_000);
    act(() => {
      result.current[1](largeString);
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(localStorage.getItem('test-key')).toBeNull();
    // State is still updated
    expect(result.current[0]).toBe(largeString);
  });

  it('debounces rapid updates — only saves the last value', () => {
    const { result } = renderHook(() => useDraftPersistence('test-key', ''));
    act(() => {
      result.current[1]('value1');
    });
    act(() => {
      vi.advanceTimersByTime(500);
      result.current[1]('value2');
    });
    act(() => {
      vi.advanceTimersByTime(500);
      result.current[1]('value3');
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(localStorage.getItem('test-key')).toBe(JSON.stringify('value3'));
  });

  // F-109: the key names the member, so when the member changes the hook must
  // show that member's draft and must never write the previous member's text
  // under the new member's key.
  it('reloads the draft when the key changes to another member', () => {
    localStorage.setItem('draft:t1:u2', JSON.stringify('second member draft'));
    const { result, rerender } = renderHook(({ k }) => useDraftPersistence(k, ''), {
      initialProps: { k: 'draft:t1:u1' },
    });
    act(() => {
      result.current[1]('first member text');
    });

    rerender({ k: 'draft:t1:u2' });

    expect(result.current[0]).toBe('second member draft');
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(localStorage.getItem('draft:t1:u2')).toBe(JSON.stringify('second member draft'));
  });

  it('falls back to the initial value when the new key has no draft', () => {
    const { result, rerender } = renderHook(({ k }) => useDraftPersistence(k, ''), {
      initialProps: { k: 'draft:t1:u1' },
    });
    act(() => {
      result.current[1]('first member text');
    });

    rerender({ k: 'draft:t1:u2' });

    expect(result.current[0]).toBe('');
  });
});
