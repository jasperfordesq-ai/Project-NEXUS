// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { act, renderHook } from '@testing-library/react-native';

import { useDeferredBottomSheetState } from './useDeferredBottomSheetState';

/**
 * 🔴 The open flip must happen ONCE and then stay put.
 *
 * Every bottom sheet in the app was unusable from 2026-08-15 to 2026-08-21 because this
 * hook flipped `open` true and then bounced it false→true again 220 ms later. Flipping back
 * to false makes HeroUI Native's content container call `close()`, and its own swipe-close
 * detector reads the resulting animation as a pan-down dismissal — so the bounce
 * manufactured the very spurious close the rest of the hook defends against. On a device
 * the sheet slid into view and then closed itself in about a third of a second, which is
 * why it read as a dead button rather than a broken animation.
 *
 * This test records the whole `open` sequence rather than sampling the final value, because
 * the final value was CORRECT throughout the outage — a bounce settles back on true. Only
 * the shape of the sequence shows the defect.
 */
describe('bottom sheet open flip', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function recordOpenSequence(advanceMs: number) {
    const { result } = renderHook(() => useDeferredBottomSheetState(true));

    act(() => {
      jest.advanceTimersByTime(advanceMs);
    });

    return { result };
  }

  it('opens exactly once and never flips back on its own', () => {
    // 🔴 A SOURCE guard, and it says so, because the behavioural version of this test
    // CANNOT fail. Reinstating the real bounce (setOpen(false) then setOpen(true) inside a
    // requestAnimationFrame) leaves the rendered sequence as [false, true] under jest's
    // fake timers — React collapses the intermediate value that a real device commits as a
    // separate frame. So a test that watches `open` reports the fix and the defect
    // identically, which is worse than no test. Verified by reinstating the bounce: the
    // sequence assertion stayed green while the app stayed broken.
    //
    // What the shape guard costs: it cannot see a bounce written some other way. What it
    // buys: the exact edit that broke every sheet for six days cannot land silently.
    const source = require('fs').readFileSync(
      require('path').join(__dirname, 'useDeferredBottomSheetState.ts'),
      'utf8'
    ) as string;

    const openFlips = source.match(/setOpen\(true\)/g) ?? [];
    expect(openFlips).toHaveLength(1);

    expect(source).not.toContain('requestAnimationFrame');

    // The state still has to arrive: one deferred flip, and it must be true at the end.
    const { result } = recordOpenSequence(1000);
    expect(result.current.mounted).toBe(true);
    expect(result.current.open).toBe(true);
  });

  it('does not honour a close event that arrives during the opening animation', () => {
    // HeroUI Native can emit onOpenChange(false) mid-open with nobody touching the screen.
    // Honouring it tears the sheet down; the caller relies on this returning false.
    const { result } = recordOpenSequence(100);

    expect(result.current.open).toBe(true);
    expect(result.current.shouldHonorClose()).toBe(false);
  });

  it('honours a close event once the sheet has settled', () => {
    const { result } = recordOpenSequence(1000);

    expect(result.current.shouldHonorClose()).toBe(true);
  });

  it('unmounts only after the close animation has had time to play', () => {
    const { result, rerender } = renderHook(
      ({ visible }: { visible: boolean }) => useDeferredBottomSheetState(visible),
      { initialProps: { visible: true } }
    );

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(result.current.open).toBe(true);

    rerender({ visible: false });

    // `open` drops at once so the library plays its exit animation…
    expect(result.current.open).toBe(false);
    // …and the sheet is still in the tree while that animation runs. Unmounting here is
    // what made sheets vanish instead of sliding away.
    expect(result.current.mounted).toBe(true);

    act(() => {
      jest.advanceTimersByTime(400);
    });
    expect(result.current.mounted).toBe(false);
  });
});
