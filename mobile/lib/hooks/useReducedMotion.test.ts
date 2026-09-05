// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { act, renderHook } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { useReducedMotion } from './useReducedMotion';

describe('useReducedMotion', () => {
  let listener: ((value: boolean) => void) | null = null;
  const remove = jest.fn();

  beforeEach(() => {
    listener = null;
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((event: string, handler: (value: boolean) => void) => {
      if (event === 'reduceMotionChanged') listener = handler;
      return { remove };
    }) as unknown as typeof AccessibilityInfo.addEventListener);
  });

  afterEach(() => jest.restoreAllMocks());

  it('reports the OS setting once it has been read', async () => {
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false); // never blocks first render
    await act(async () => {});
    expect(result.current).toBe(true);
  });

  it('follows live changes and unsubscribes on unmount', async () => {
    const { result, unmount } = renderHook(() => useReducedMotion());
    await act(async () => {});
    act(() => listener?.(false));
    expect(result.current).toBe(false);
    unmount();
    expect(remove).toHaveBeenCalled();
  });
});
