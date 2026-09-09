// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import ChoiceChips, { MIN_TARGET_DP, toOptions } from './ChoiceChips';

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({ text: '#000', textSecondary: '#444', textMuted: '#777' }),
}));

const buttonProps: Record<string, unknown>[] = [];

jest.mock('heroui-native', () => {
  const ReactLib = require('react');
  const { Pressable, Text, View } = require('react-native');
  const Button = (props: Record<string, unknown> & { children: React.ReactNode; onPress?: () => void; isDisabled?: boolean }) => {
    buttonProps.push(props);
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={props.accessibilityLabel as string}
        accessibilityState={props.accessibilityState as Record<string, boolean>}
        disabled={props.isDisabled}
        onPress={props.isDisabled ? undefined : props.onPress}
        testID={props.testID as string}
        style={props.style as never}
      >
        <View>{props.children}</View>
      </Pressable>
    );
  };
  Button.Label = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;
  return { Button, __esModule: true, React: ReactLib };
});

const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
type Level = (typeof LEVELS)[number];

describe('ChoiceChips — single selection', () => {
  beforeEach(() => {
    buttonProps.length = 0;
  });

  it('renders every option with its caption and reports which one is chosen', () => {
    render(
      <ChoiceChips<Level>
        label="Level"
        options={toOptions(LEVELS, (value) => value.toUpperCase())}
        selected="intermediate"
        onSelect={jest.fn()}
      />,
    );

    expect(screen.getByText('Level')).toBeTruthy();
    expect(screen.getByLabelText('BEGINNER').props.accessibilityState).toMatchObject({ selected: false });
    expect(screen.getByLabelText('INTERMEDIATE').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByLabelText('ADVANCED').props.accessibilityState).toMatchObject({ selected: false });
  });

  it('paints the chosen chip as the primary (filled) button and the rest as secondary', () => {
    render(
      <ChoiceChips<Level>
        options={toOptions(LEVELS, (value) => value)}
        selected="advanced"
        onSelect={jest.fn()}
      />,
    );

    const variants = buttonProps.map((props) => props.variant);
    expect(variants).toEqual(['secondary', 'secondary', 'primary']);
    // 🔴 The old TagGroup pickers hardcoded the selected label colour; here nothing does.
    for (const props of buttonProps) {
      expect(JSON.stringify(props.style)).not.toMatch(/color/);
    }
  });

  it('is at least the minimum touch target tall on every chip', () => {
    render(
      <ChoiceChips<Level>
        options={toOptions(LEVELS, (value) => value)}
        selected=""
        onSelect={jest.fn()}
      />,
    );

    expect(MIN_TARGET_DP).toBeGreaterThanOrEqual(44);
    for (const props of buttonProps) {
      expect((props.style as { minHeight: number }).minHeight).toBe(MIN_TARGET_DP);
    }
  });

  it('sends the tapped value, and ignores a tap on the chip already chosen', () => {
    const onSelect = jest.fn();
    render(
      <ChoiceChips<Level>
        options={toOptions(LEVELS, (value) => value)}
        selected="beginner"
        onSelect={onSelect}
      />,
    );

    fireEvent.press(screen.getByText('advanced'));
    expect(onSelect).toHaveBeenCalledWith('advanced');

    fireEvent.press(screen.getByText('beginner'));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('clears the choice on a second tap only when the caller allows it', () => {
    const onSelect = jest.fn();
    render(
      <ChoiceChips<Level>
        options={toOptions(LEVELS, (value) => value)}
        selected="beginner"
        onSelect={onSelect}
        allowDeselect
      />,
    );

    fireEvent.press(screen.getByText('beginner'));
    expect(onSelect).toHaveBeenCalledWith('');
  });

  it('does not fire for a disabled option', () => {
    const onSelect = jest.fn();
    render(
      <ChoiceChips<Level>
        options={[
          { value: 'beginner', label: 'Beginner' },
          { value: 'advanced', label: 'Advanced', disabled: true },
        ]}
        selected=""
        onSelect={onSelect}
      />,
    );

    fireEvent.press(screen.getByText('Advanced'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('prefixes each chip test id with the group id', () => {
    render(
      <ChoiceChips<Level>
        testID="level"
        options={toOptions(LEVELS, (value) => value)}
        selected=""
        onSelect={jest.fn()}
      />,
    );

    expect(screen.getByTestId('level-beginner')).toBeTruthy();
  });
});

describe('ChoiceChips — multiple selection', () => {
  it('adds and removes values, preserving the order they were chosen in', () => {
    const onSelectionChange = jest.fn();
    const { rerender } = render(
      <ChoiceChips<Level>
        selectionMode="multiple"
        options={toOptions(LEVELS, (value) => value)}
        selected={['beginner']}
        onSelectionChange={onSelectionChange}
      />,
    );

    fireEvent.press(screen.getByText('advanced'));
    expect(onSelectionChange).toHaveBeenLastCalledWith(['beginner', 'advanced']);

    rerender(
      <ChoiceChips<Level>
        selectionMode="multiple"
        options={toOptions(LEVELS, (value) => value)}
        selected={['beginner', 'advanced']}
        onSelectionChange={onSelectionChange}
      />,
    );
    fireEvent.press(screen.getByText('beginner'));
    expect(onSelectionChange).toHaveBeenLastCalledWith(['advanced']);
    expect(screen.getByLabelText('advanced').props.accessibilityState).toMatchObject({ selected: true });
  });
});
