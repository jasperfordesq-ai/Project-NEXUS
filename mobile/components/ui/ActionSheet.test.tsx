// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import ActionSheet from './ActionSheet';

jest.mock('@/components/ui/BottomSheet', () => {
  const { View } = require('react-native');

  const MockBottomSheet = ({
    visible,
    children,
  }: {
    visible: boolean;
    children: React.ReactNode;
  }) => (visible ? <View>{children}</View> : null);

  return MockBottomSheet;
});

describe('ActionSheet', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('closes before running the selected action', () => {
    const onClose = jest.fn();
    const onPress = jest.fn();
    const { getByLabelText, getByText } = render(
      <ActionSheet
        visible
        onClose={onClose}
        actions={[{ label: 'Archive listing', icon: 'archive-outline', onPress }]}
      />,
    );

    expect(getByText('Archive listing')).toBeTruthy();
    fireEvent.press(getByLabelText('Archive listing'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(200);
    });

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders a header above the rows inside the same sheet', () => {
    const { getByText } = render(
      <ActionSheet
        visible
        onClose={jest.fn()}
        header={<Text>Pick a reaction</Text>}
        actions={[{ label: 'Copy text', onPress: jest.fn() }]}
      />,
    );

    expect(getByText('Pick a reaction')).toBeTruthy();
    expect(getByText('Copy text')).toBeTruthy();
  });
});
