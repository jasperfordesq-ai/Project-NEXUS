// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import ConfirmDialog from './ConfirmDialog';

jest.mock('heroui-native', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');

  const Dialog = ({ children, isOpen, ...props }: { children: React.ReactNode; isOpen: boolean }) =>
    isOpen ? <View testID="dialog-root" {...props}>{children}</View> : null;
  Dialog.Portal = ({ children }: { children: React.ReactNode }) => <View testID="dialog-portal">{children}</View>;
  Dialog.Overlay = (props: Record<string, unknown>) => <View testID="dialog-overlay" {...props} />;
  Dialog.Content = ({ children, ...props }: { children: React.ReactNode }) => <View testID="dialog-content" {...props}>{children}</View>;
  Dialog.Title = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;
  Dialog.Description = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;

  const Button = ({
    children,
    onPress,
    accessibilityLabel,
    testID,
    isDisabled,
    ...props
  }: {
    children: React.ReactNode;
    onPress?: () => void;
    accessibilityLabel?: string;
    testID?: string;
    isDisabled?: boolean;
    accessibilityState?: object;
  }) => (
    <Pressable
      {...props}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      disabled={isDisabled}
      onPress={onPress}
    >
      {children}
    </Pressable>
  );
  Button.Label = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;

  return {
    Button,
    Dialog,
    Spinner: () => <View testID="confirm-spinner" />,
  };
});

describe('ConfirmDialog', () => {
  it('dismisses the keyboard when opened so it cannot cover the actions', () => {
    const dismiss = jest.spyOn(require('react-native').Keyboard, 'dismiss');
    try {
      const props = { title: 'Discard?', cancelLabel: 'Cancel', confirmLabel: 'Discard', onClose: jest.fn(), onConfirm: jest.fn() };
      const ui = render(<ConfirmDialog {...props} visible={false} />);
      dismiss.mockClear();
      ui.rerender(<ConfirmDialog {...props} visible />);
      expect(dismiss).toHaveBeenCalledTimes(1);
      ui.rerender(<ConfirmDialog {...props} visible isConfirming />);
      expect(dismiss).toHaveBeenCalledTimes(1);
    } finally {
      dismiss.mockRestore();
    }
  });
  it('keeps the dialog open and announces progress while confirmation is pending', () => {
    const onClose = jest.fn();
    const { getByTestId, getByLabelText } = render(
      <ConfirmDialog visible title="Delete item?" cancelLabel="Cancel" confirmLabel="Delete"
        onClose={onClose} onConfirm={jest.fn()} isConfirming />,
    );
    fireEvent(getByTestId('dialog-root'), 'openChange', false);
    expect(onClose).not.toHaveBeenCalled();
    expect(getByTestId('dialog-overlay').props.isCloseOnPress).toBe(false);
    expect(getByTestId('dialog-content').props.isSwipeable).toBe(false);
    expect(getByLabelText('Delete').props.accessibilityState).toMatchObject({ busy: true, disabled: true });
  });

  it('renders a native dialog with caller-provided copy and actions', () => {
    const onClose = jest.fn();
    const onConfirm = jest.fn();

    const { getByText, getByLabelText } = render(
      <ConfirmDialog
        visible
        title="Delete listing?"
        message="This cannot be undone."
        cancelLabel="Keep it"
        confirmLabel="Delete"
        cancelAccessibilityLabel="Cancel delete listing"
        confirmAccessibilityLabel="Confirm delete listing"
        cancelTestID="delete-cancel"
        confirmTestID="delete-confirm"
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );

    expect(getByText('Delete listing?')).toBeTruthy();
    expect(getByText('This cannot be undone.')).toBeTruthy();

    fireEvent.press(getByLabelText('Confirm delete listing'));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.press(getByLabelText('Cancel delete listing'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('passes stable test IDs through to action buttons', () => {
    const { getByTestId } = render(
      <ConfirmDialog
        visible
        title="Sign out?"
        cancelLabel="Cancel"
        confirmLabel="Sign out"
        cancelTestID="logout-cancel"
        confirmTestID="logout-confirm"
        onClose={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );

    expect(getByTestId('logout-cancel')).toBeTruthy();
    expect(getByTestId('logout-confirm')).toBeTruthy();
  });

  it('does not render while closed', () => {
    const { queryByText } = render(
      <ConfirmDialog
        visible={false}
        title="Hidden dialog"
        cancelLabel="Cancel"
        confirmLabel="Confirm"
        onClose={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );

    expect(queryByText('Hidden dialog')).toBeNull();
  });
});
