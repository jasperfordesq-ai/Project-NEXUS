// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import Button from './Button';

describe('Button component', () => {
    it('renders correctly', () => {
        const { getByText } = render(<Button>Test Button</Button>);
        expect(getByText('Test Button')).toBeTruthy();
    });

    it('handles press events', () => {
        const onPressMock = jest.fn();
        const { getByText } = render(<Button onPress={onPressMock}>Click Me</Button>);

        fireEvent.press(getByText('Click Me'));
        expect(onPressMock).toHaveBeenCalledTimes(1);
    });

    it('keeps the action label visible and reports busy while loading', () => {
        const { getByText, getByTestId } = render(<Button isLoading={true} testID="btn">Click Me</Button>);
        // 🔴 The label used to be replaced by a bare spinner, leaving the button
        // anonymous mid-action (audit 2026-09-05, F08).
        expect(getByText('Click Me')).toBeTruthy();
        expect(getByTestId('btn').props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    });

    it('does not trigger press when disabled', () => {
        const onPressMock = jest.fn();
        const { getByText } = render(<Button onPress={onPressMock} disabled={true}>Click Me</Button>);

        // toBeDisabled() traverses ancestors — catches disabled set on TouchableOpacity
        expect(getByText('Click Me')).toBeDisabled();
    });
});

/**
 * 🔴 The press vibration fired on EVERY variant. That meant the app buzzed on plain
 * navigation — Back, "See all", a ghost link — exactly as hard as it did on sending
 * credits, and a signal given for everything is a signal for nothing. It is now limited to
 * the variants this app uses for a screen's main action and for destructive ones.
 * Audit 2026-09-09, item 15.
 */
describe('Button — the press vibration is not free', () => {
  const Haptics = require('@/lib/haptics');

  beforeEach(() => {
    (Haptics.impactAsync as jest.Mock).mockClear();
  });

  it.each(['solid', 'danger'] as const)('vibrates on a %s button, where the press is worth feeling', (variant) => {
    render(<Button variant={variant} onPress={() => {}}>Send</Button>);
    fireEvent.press(screen.getByText('Send'));

    expect(Haptics.impactAsync).toHaveBeenCalled();
  });

  it.each(['ghost', 'outline', 'secondary'] as const)('stays silent on a %s button', (variant) => {
    render(<Button variant={variant} onPress={() => {}}>See all</Button>);
    fireEvent.press(screen.getByText('See all'));

    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  it('lets a caller ask for a vibration on a quiet variant', () => {
    render(<Button variant="ghost" haptic onPress={() => {}}>Confirm</Button>);
    fireEvent.press(screen.getByText('Confirm'));

    expect(Haptics.impactAsync).toHaveBeenCalled();
  });

  it('lets a caller silence a loud one', () => {
    render(<Button variant="solid" haptic={false} onPress={() => {}}>Next</Button>);
    fireEvent.press(screen.getByText('Next'));

    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });
});
