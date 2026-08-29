// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import NativePressable from './NativePressable';
import * as Haptics from '@/lib/haptics';

jest.mock('heroui-native', () => {
  const React = require('react');
  const { Pressable, View } = require('react-native');

  /**
   * 🔴 This mock SPREADS its remaining props, because the real component does
   * (`...restProps` onto its AnimatedPressable) and because an earlier version of this
   * mock destructured a fixed list and silently dropped everything else. That made a
   * perfectly working `accessibilityState` look broken: the test reported
   * `selected: undefined` and the near-conclusion was that heroui-native swallows the
   * prop and the API should be removed. It was the mock. A mock that accepts fewer props
   * than the thing it stands in for does not fail — it reports a defect that is not there.
   */
  const PressableFeedback = ({
    children,
    isDisabled,
    onPress,
    ...rest
  }: {
    children: React.ReactNode;
    isDisabled?: boolean;
    onPress?: () => void;
    [key: string]: unknown;
  }) => (
    <Pressable
      {...rest}
      disabled={isDisabled}
      onPress={isDisabled ? undefined : onPress}
      testID="native-pressable"
    >
      {children}
    </Pressable>
  );
  PressableFeedback.Scale = ({ children }: { children: React.ReactNode }) => (
    <View testID="native-pressable-scale">{children}</View>
  );
  PressableFeedback.Highlight = () => <View testID="native-pressable-highlight" />;
  PressableFeedback.Ripple = () => <View testID="native-pressable-ripple" />;

  return { PressableFeedback };
});

describe('NativePressable', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses HeroUI Native press feedback and app haptics for card-like taps', () => {
    const onPress = jest.fn();
    const { getByLabelText, getByTestId, getByText } = render(
      <NativePressable accessibilityLabel="Open listing" feedback="ripple" onPress={onPress}>
        <Text>Open listing</Text>
      </NativePressable>,
    );

    expect(getByText('Open listing')).toBeTruthy();
    expect(getByTestId('native-pressable-scale')).toBeTruthy();
    expect(getByTestId('native-pressable-ripple')).toBeTruthy();

    fireEvent.press(getByLabelText('Open listing'));

    expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire haptics or press handlers while disabled', () => {
    const onPress = jest.fn();
    const { getByLabelText } = render(
      <NativePressable accessibilityLabel="Disabled item" disabled onPress={onPress}>
        <Text>Disabled item</Text>
      </NativePressable>,
    );

    fireEvent.press(getByLabelText('Disabled item'));

    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(onPress).not.toHaveBeenCalled();
  });

  it('uses the plain native press responder when feedback is disabled', () => {
    const onPress = jest.fn();
    const { getByLabelText, queryByTestId } = render(
      <NativePressable accessibilityLabel="Choose community" feedback="none" onPress={onPress}>
        <Text>Choose community</Text>
      </NativePressable>,
    );

    expect(queryByTestId('native-pressable-scale')).toBeNull();
    fireEvent.press(getByLabelText('Choose community'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
  /**
   * 🔴 A row that represents a CHOICE has to be able to say it is the chosen one.
   * Added on 2026-08-20 when select-tenant.tsx moved off HeroButton (which collapsed the
   * community names to zero width) and would otherwise have lost its selected state,
   * leaving the choice expressed only as a background colour — invisible to a screen
   * reader and to anyone who cannot distinguish the two greys.
   */
  it('forwards accessibilityState so a selected row announces itself', () => {
    const { getByLabelText } = render(
      <NativePressable
        accessibilityLabel="Hour Timebank"
        accessibilityState={{ selected: true }}
        onPress={() => {}}
      >
        <Text>Hour Timebank</Text>
      </NativePressable>,
    );

    expect(getByLabelText('Hour Timebank').props.accessibilityState).toMatchObject({ selected: true });
  });
});
