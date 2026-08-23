// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * `Chip` from `@/components/ui/StatusChip` must not offer a decorative chip as a control.
 *
 * 🔴 `heroui-native`'s Chip renders a `Pressable` whether or not it was given an
 * `onPress`, so a chip carrying pure information — "1 conversation", "0 unread",
 * "3 results", "No pending credits" — reached the accessibility tree as an activatable
 * button. Measured with TalkBack on 2026-08-23.
 *
 * The prop that fixes it is `focusable={false}`, established on a device: `accessible`
 * and `importantForAccessibility` had no effect at all, and a `testID` probe was needed
 * to prove the props were reaching the view before that could be believed.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('heroui-native', () => {
  const ReactLocal = require('react');
  const { View, Text } = require('react-native');
  // Recorded on `global` because a jest.mock factory may not close over a module-scope
  // variable.
  (global as unknown as { heroChipProps: unknown[] }).heroChipProps = [];
  const Chip = (props: Record<string, unknown>) => {
    (global as unknown as { heroChipProps: unknown[] }).heroChipProps.push(props);
    return ReactLocal.createElement(View, null, props.children as never);
  };
  Chip.Label = ({ children }: { children?: unknown }) =>
    ReactLocal.createElement(Text, null, children);
  return { Chip };
});

import { Chip } from './StatusChip';

function recordedProps(): Record<string, unknown>[] {
  return (global as unknown as { heroChipProps: Record<string, unknown>[] }).heroChipProps;
}

beforeEach(() => {
  recordedProps().length = 0;
});

describe('StatusChip', () => {
  it('marks a chip with no action as not focusable', () => {
    render(
      <Chip>
        <Chip.Label>1 conversation</Chip.Label>
      </Chip>,
    );

    expect(recordedProps()[0].focusable).toBe(false);
  });

  it('leaves an interactive chip alone', () => {
    render(
      <Chip onPress={() => {}}>
        <Chip.Label>All</Chip.Label>
      </Chip>,
    );

    expect(recordedProps()[0].focusable).toBeUndefined();
  });

  it('treats a long-press-only chip as interactive', () => {
    render(
      <Chip onLongPress={() => {}}>
        <Chip.Label>Held</Chip.Label>
      </Chip>,
    );

    expect(recordedProps()[0].focusable).toBeUndefined();
  });

  it('lets a caller override the default', () => {
    render(
      <Chip focusable>
        <Chip.Label>Deliberate</Chip.Label>
      </Chip>,
    );

    expect(recordedProps()[0].focusable).toBe(true);
  });
  /**
   * 🔴 WCAG 2.2 AA 2.5.8 asks for a 24x24 target. `size="sm"` chips measured 20dp tall on
   * a device at 420dpi, so the Feed's five filter chips — real controls on the app's first
   * screen — failed the minimum. A decorative chip is not a target and is left alone.
   */
  it('gives an interactive chip the WCAG minimum target height', () => {
    render(
      <Chip onPress={() => {}}>
        <Chip.Label>All</Chip.Label>
      </Chip>,
    );

    const style = recordedProps()[0].style as { minHeight?: number }[];
    expect(style[0].minHeight).toBe(24);
  });

  it('does not stretch a decorative chip', () => {
    render(
      <Chip>
        <Chip.Label>1 conversation</Chip.Label>
      </Chip>,
    );

    expect(recordedProps()[0].style).toBeUndefined();
  });
});
