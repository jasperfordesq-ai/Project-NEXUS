// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 Red is how this app says "this takes something away". `variant` defaulted to
 * `'danger'`, and because most confirmations really are destructive nobody noticed that
 * the ones which are not had gone red too: enrolling on a course, confirming a marketplace
 * purchase, confirming delivery, completing a group exchange and sending credits from the
 * wallet all asked with a red button. Spending the warning colour on ordinary affirmative
 * actions is how it stops meaning anything on the actions that matter. Audit 2026-09-09,
 * item 10.
 *
 * `ConfirmDialog` is stood in for rather than rendered: the real one draws inside a portal
 * that React Native Testing Library cannot see (the pattern in select-tenant.test.tsx).
 * What is under test here is which variant the hook hands it.
 */

import React from 'react';
import { act, render, screen } from '@testing-library/react-native';

import { useConfirm, type ConfirmOptions } from './useConfirm';

jest.mock('./ConfirmDialog', () => {
  const React = require('react');
  const { Text, View } = require('react-native');
  return {
    __esModule: true,
    default: ({ visible, variant, onConfirm }: { visible: boolean; variant?: string; onConfirm: () => Promise<void> }) =>
      visible ? (
        <View>
          <Text testID="confirm-variant">{variant}</Text>
          <Text testID="confirm-action" onPress={onConfirm}>Confirm</Text>
        </View>
      ) : null,
  };
});

const baseOptions: ConfirmOptions = {
  title: 'Are you sure?',
  confirmLabel: 'Yes',
  cancelLabel: 'No',
  onConfirm: () => {},
};

function Harness({ options }: { options: ConfirmOptions }) {
  const { confirm, confirmDialog } = useConfirm();
  const opened = React.useRef(false);
  if (!opened.current) {
    opened.current = true;
    confirm(options);
  }
  return <>{confirmDialog}</>;
}

describe('useConfirm — the warning colour is reserved', () => {
  it('runs a pending confirmation only once even when two events arrive together', async () => {
    let finish!: () => void;
    const action = jest.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    render(<Harness options={{ ...baseOptions, onConfirm: action }} />);
    const confirm = screen.getByTestId('confirm-action').props.onPress;
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => { first = confirm(); second = confirm(); });
    expect(action).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); await Promise.all([first, second]); });
    expect(screen.queryByTestId('confirm-action')).toBeNull();
  });
  it('is not red unless the caller asks for red', () => {
    render(<Harness options={baseOptions} />);

    expect(screen.getByTestId('confirm-variant').props.children).toBe('primary');
  });

  it('is red when the caller asks for red', () => {
    render(<Harness options={{ ...baseOptions, variant: 'danger' }} />);

    expect(screen.getByTestId('confirm-variant').props.children).toBe('danger');
  });
});
