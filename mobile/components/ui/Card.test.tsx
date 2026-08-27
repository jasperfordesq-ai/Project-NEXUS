// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import Card from './Card';

jest.mock('heroui-native', () => {
  const React = require('react');
  const { Pressable, View } = require('react-native');

  const Card = ({ children }: { children: React.ReactNode }) => <View testID="hero-card">{children}</View>;
  Card.Body = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  const Button = ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) => (
    <Pressable onPress={onPress} testID="legacy-hero-button-card">{children}</Pressable>
  );

  return { Button, Card };
});

jest.mock('./NativePressable', () => {
  const React = require('react');
  const { Pressable } = require('react-native');

  return function MockNativePressable({
    children,
    onPress,
  }: {
    children: React.ReactNode;
    onPress?: () => void;
  }) {
    return (
      <Pressable accessibilityRole="button" onPress={onPress} testID="native-pressable-card">
        {children}
      </Pressable>
    );
  };
});

describe('Card', () => {
  it('uses the shared HeroUI Native press feedback wrapper for pressable cards', () => {
    const onPress = jest.fn();
    const { getByTestId, getByText } = render(
      <Card pressable onPress={onPress}>
        <Text>Open profile</Text>
      </Card>,
    );

    expect(getByText('Open profile')).toBeTruthy();

    fireEvent.press(getByTestId('native-pressable-card'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
