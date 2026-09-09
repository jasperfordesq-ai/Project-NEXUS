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
import { render, screen } from '@testing-library/react-native';

import { useConfirm, type ConfirmOptions } from './useConfirm';

jest.mock('./ConfirmDialog', () => {
  const React = require('react');
  const { Text, View } = require('react-native');
  return {
    __esModule: true,
    default: ({ visible, variant }: { visible: boolean; variant?: string }) =>
      visible ? (
        <View>
          <Text testID="confirm-variant">{variant}</Text>
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
  it('is not red unless the caller asks for red', () => {
    render(<Harness options={baseOptions} />);

    expect(screen.getByTestId('confirm-variant').props.children).toBe('primary');
  });

  it('is red when the caller asks for red', () => {
    render(<Harness options={{ ...baseOptions, variant: 'danger' }} />);

    expect(screen.getByTestId('confirm-variant').props.children).toBe('danger');
  });
});
