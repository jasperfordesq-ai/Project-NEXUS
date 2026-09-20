// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { Keyboard, Pressable, Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { useAppToast } from './AppToast';

const mockToastShow = jest.fn();
const mockToastHide = jest.fn();

jest.mock('heroui-native', () => ({
  useToast: () => ({
    toast: {
      show: mockToastShow,
      hide: mockToastHide,
    },
    isToastVisible: false,
  }),
}));

jest.mock('@/lib/haptics', () => ({
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

function ToastHarness({ onActionPress }: { onActionPress?: () => void }) {
  const toast = useAppToast();

  return (
    <>
      <Pressable
        accessibilityLabel="show toast"
        onPress={() =>
          toast.show({
            title: 'Saved',
            description: 'Your changes were saved.',
            variant: 'success',
            actionLabel: 'Undo',
            onActionPress,
          })
        }
      >
        <Text>Show</Text>
      </Pressable>
      <Pressable accessibilityLabel="hide toast" onPress={() => toast.hide('toast-1')}>
        <Text>Hide</Text>
      </Pressable>
    </>
  );
}

describe('useAppToast', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Keyboard, 'isVisible').mockReturnValue(false);
  });

  afterEach(() => jest.restoreAllMocks());

  it('keeps feedback visible when the keyboard opens after the screen renders', () => {
    const { getByLabelText } = render(<ToastHarness />);
    jest.mocked(Keyboard.isVisible).mockReturnValue(true);
    fireEvent.press(getByLabelText('show toast'));
    expect(mockToastShow).toHaveBeenLastCalledWith(expect.objectContaining({ placement: 'top' }));

    jest.mocked(Keyboard.isVisible).mockReturnValue(false);
    fireEvent.press(getByLabelText('show toast'));
    expect(mockToastShow).toHaveBeenLastCalledWith(expect.objectContaining({ placement: 'bottom' }));
  });

  it('shows HeroUI Native toasts with the app mobile defaults', () => {
    const onActionPress = jest.fn();
    const { getByLabelText } = render(<ToastHarness onActionPress={onActionPress} />);

    fireEvent.press(getByLabelText('show toast'));

    expect(mockToastShow).toHaveBeenCalledWith(expect.objectContaining({
      actionLabel: 'Undo',
      description: 'Your changes were saved.',
      label: 'Saved',
      placement: 'bottom',
      variant: 'success',
    }));

    const showConfig = mockToastShow.mock.calls[0][0];
    const hide = jest.fn();
    showConfig.onActionPress({ hide, show: mockToastShow });

    expect(onActionPress).toHaveBeenCalledTimes(1);
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it('hides toasts through the HeroUI Native toast manager', () => {
    const { getByLabelText } = render(<ToastHarness />);

    fireEvent.press(getByLabelText('hide toast'));

    expect(mockToastHide).toHaveBeenCalledWith('toast-1');
  });
});
