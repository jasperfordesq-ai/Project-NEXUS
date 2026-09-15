// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { Text, TextInput } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import Input from './Input';

describe('Input component', () => {
  it('renders label, value, and validation error', () => {
    const { getByDisplayValue, getByText } = render(
      <Input label="Email" value="member@example.test" error="Email is required" />,
    );

    expect(getByText('Email')).toBeTruthy();
    expect(getByDisplayValue('member@example.test')).toBeTruthy();
    expect(getByText('Email is required')).toBeTruthy();
  });

  it('keeps long guidance outside the fixed-height editable field', () => {
    const { getByText, queryByPlaceholderText } = render(
      <Input label="Password" helper="At least 12 characters" />,
    );

    expect(getByText('At least 12 characters')).toBeTruthy();
    expect(queryByPlaceholderText('At least 12 characters')).toBeNull();
  });

  it('keeps helper icons outside the editable value', () => {
    const { getByText, getByPlaceholderText } = render(
      <Input
        label="Search"
        placeholder="Search members"
        leftIcon={<Text>L</Text>}
        rightIcon={<Text>R</Text>}
      />,
    );

    expect(getByPlaceholderText('Search members')).toBeTruthy();
    expect(getByText('L')).toBeTruthy();
    expect(getByText('R')).toBeTruthy();
  });

  it('forwards refs to the underlying native input', () => {
    const ref = React.createRef<TextInput>();

    render(<Input ref={ref} value="" placeholder="Focusable" />);

    expect(ref.current).toBeTruthy();
  });

  it('preserves caller focus and blur handlers while wiring sheet keyboard awareness', () => {
    const onFocus = jest.fn();
    const onBlur = jest.fn();
    const { getByPlaceholderText } = render(
      <Input placeholder="Sheet field" onFocus={onFocus} onBlur={onBlur} />,
    );
    const input = getByPlaceholderText('Sheet field');

    fireEvent(input, 'focus', { nativeEvent: { target: 1 } });
    fireEvent(input, 'blur', { nativeEvent: { target: 1 } });

    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });
});
