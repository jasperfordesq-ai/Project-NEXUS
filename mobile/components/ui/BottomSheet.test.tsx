// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { Text } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';

import BottomSheet from './BottomSheet';

const contentProps: Record<string, unknown>[] = [];
const rootProps: Record<string, unknown>[] = [];

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 24, left: 0 }),
}));

// The sheet closes itself when the screen underneath loses focus (a sheet renders through a
// portal, so navigating away used to leave it sitting over unrelated content). The mock runs
// the effect and lets its cleanup fire on unmount, which is exactly what blur does.
jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => cb(), [cb]);
  },
}));

jest.mock('heroui-native', () => {
  const React = require('react');
  const { Text, View } = require('react-native');

  const MockBottomSheet = (props: { children: React.ReactNode; isOpen: boolean }) => {
    rootProps.push(props);
    return <View testID="bottom-sheet-root">{props.children}</View>;
  };

  MockBottomSheet.Portal = ({ children }: { children: React.ReactNode }) => (
    <View testID="bottom-sheet-portal">{children}</View>
  );
  MockBottomSheet.Overlay = (props: Record<string, unknown>) => <View testID="bottom-sheet-overlay" {...props} />;
  MockBottomSheet.Content = (props: Record<string, unknown> & { children: React.ReactNode }) => {
    contentProps.push(props);
    return <View testID="bottom-sheet-content">{props.children}</View>;
  };
  MockBottomSheet.Title = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;

  return { BottomSheet: MockBottomSheet };
});

describe('BottomSheet', () => {
  beforeEach(() => {
    contentProps.length = 0;
    rootProps.length = 0;
    jest.useRealTimers();
  });

  it('applies native mobile sheet defaults for dark, fixed, keyboard-aware content', async () => {
    const { getByText } = render(
      <BottomSheet visible title="Sheet title" onClose={jest.fn()} snapPoints={['72%', 420]}>
        <Text>Sheet body</Text>
      </BottomSheet>,
    );

    await waitFor(() => {
      expect(getByText('Sheet title')).toBeTruthy();
      expect(getByText('Sheet body')).toBeTruthy();
    });
    expect(contentProps[0]?.enableDynamicSizing).toBe(false);
    expect(contentProps[0]?.enableOverDrag).toBe(false);
    expect(contentProps[0]?.keyboardBehavior).toBe('extend');
    expect(contentProps[0]?.keyboardBlurBehavior).toBe('restore');
    expect(contentProps[0]?.snapPoints).toEqual(['72%', 444]);
    expect(contentProps[0]?.backgroundClassName).toEqual(expect.stringContaining('bg-background'));
    expect(contentProps[0]?.contentContainerClassName).toEqual(expect.stringContaining('h-full'));
    expect(contentProps[0]?.className).toBeUndefined();
    expect(contentProps[0]?.containerClassName).toBeUndefined();
  });

  it('does not render content while closed', () => {
    const { queryByText } = render(
      <BottomSheet visible={false} title="Hidden sheet" onClose={jest.fn()}>
        <Text>Hidden body</Text>
      </BottomSheet>,
    );

    expect(queryByText('Hidden sheet')).toBeNull();
    expect(queryByText('Hidden body')).toBeNull();
  });

  it('mounts closed before opening so HeroUI Native can snap the sheet into view', () => {
    jest.useFakeTimers();
    const { rerender } = render(
      <BottomSheet visible={false} title="Deferred sheet" onClose={jest.fn()}>
        <Text>Deferred body</Text>
      </BottomSheet>,
    );

    rerender(
      <BottomSheet visible title="Deferred sheet" onClose={jest.fn()}>
        <Text>Deferred body</Text>
      </BottomSheet>,
    );

    expect(rootProps.at(-1)?.isOpen).toBe(false);

    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(rootProps.at(-1)?.isOpen).toBe(true);
  });

  it('stays mounted while animating closed, then unmounts', () => {
    jest.useFakeTimers();
    const { rerender, queryByText } = render(
      <BottomSheet visible title="Closing sheet" onClose={jest.fn()}>
        <Text>Closing body</Text>
      </BottomSheet>,
    );

    // Open (flush the open-defer timer).
    act(() => {
      jest.runOnlyPendingTimers();
    });
    expect(rootProps.at(-1)?.isOpen).toBe(true);
    expect(queryByText('Closing body')).toBeTruthy();

    // Close: isOpen must flip false so the library animates the sheet closed,
    // but the sheet must stay mounted so that exit animation can play (the old
    // behavior unmounted synchronously and destroyed it).
    rerender(
      <BottomSheet visible={false} title="Closing sheet" onClose={jest.fn()}>
        <Text>Closing body</Text>
      </BottomSheet>,
    );
    expect(rootProps.at(-1)?.isOpen).toBe(false);
    expect(queryByText('Closing body')).toBeTruthy();

    // Once the close animation window elapses, it unmounts.
    act(() => {
      jest.advanceTimersByTime(400);
    });
    expect(queryByText('Closing body')).toBeNull();
  });

  /**
   * 🔴 A sheet renders through a portal at the app root, so it does not vanish when the
   * screen that opened it goes away. Measured on 2026-08-22: the group "start a discussion"
   * sheet was still sitting on top of an EVENT detail screen after a deep link, over
   * completely unrelated content. It was invisible as a defect until 2026-08-21, because
   * before then no sheet opened at all.
   */
  it('tells its owner to close when the screen loses focus', () => {
    const onClose = jest.fn();
    const { unmount } = render(
      <BottomSheet visible title="Focus sheet" onClose={onClose}>
        <Text>Focus body</Text>
      </BottomSheet>,
    );

    expect(onClose).not.toHaveBeenCalled();

    // Blur/unmount runs the focus effect's cleanup.
    unmount();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not fire a close for a sheet that was already shut', () => {
    const onClose = jest.fn();
    const { unmount } = render(
      <BottomSheet visible={false} title="Shut sheet" onClose={onClose}>
        <Text>Shut body</Text>
      </BottomSheet>,
    );

    unmount();
    // Calling onClose here would push a spurious state update into a screen that is
    // already going away — and on a parent that treats onClose as "the member dismissed
    // it", that is a phantom interaction.
    expect(onClose).not.toHaveBeenCalled();
  });
});
