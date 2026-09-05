// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const mockInsets = { current: { top: 0, right: 0, bottom: 0, left: 0 } };

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => mockInsets.current,
}));

import { renderHook } from '@testing-library/react-native';

describe('useBottomInset', () => {
  // The module keeps its root inset in module state, so isolate each case.
  function load() {
    jest.resetModules();
    return require('./rootInsets') as typeof import('./rootInsets');
  }

  beforeEach(() => {
    mockInsets.current = { top: 0, right: 0, bottom: 0, left: 0 };
  });

  /**
   * 🔴 The case that put the member-profile action bar under Android's 3-button
   * navigation: inside a `presentation: 'modal'` route the hook reports 0, and
   * only the root-recorded value knows the bar is really 48dp tall.
   */
  it('floors a zero hook value with the inset recorded at the root', () => {
    const { useBottomInset, setRootBottomInset } = load();
    setRootBottomInset(48);

    expect(renderHook(() => useBottomInset()).result.current).toBe(48);
  });

  it('prefers the live hook value when it is the larger of the two', () => {
    const { useBottomInset, setRootBottomInset } = load();
    setRootBottomInset(24);
    mockInsets.current = { top: 0, right: 0, bottom: 34, left: 0 };

    expect(renderHook(() => useBottomInset()).result.current).toBe(34);
  });

  it('is zero when neither source reports an inset (gesture navigation, no bar)', () => {
    const { useBottomInset } = load();

    expect(renderHook(() => useBottomInset()).result.current).toBe(0);
  });

  it('never lets the root inset shrink or go non-finite', () => {
    const { setRootBottomInset, getRootBottomInset } = load();
    setRootBottomInset(48);
    setRootBottomInset(20);
    setRootBottomInset(Number.NaN);

    expect(getRootBottomInset()).toBe(48);
  });
});
