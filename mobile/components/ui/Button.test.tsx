// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
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
